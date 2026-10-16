// THERMAL CONVECTION · sim/gpu.js — the WebGPU solver. It runs the scheme of
// sim/ref.js (the spec) pass for pass in shaders/sim-*.wgsl. No DOM; the
// module imports in node (the tests use the exported tables and a fake device).
//
// API (CONTRACT.md "sim/gpu.js"):
//   const sim = await createSim(device, { quality, nx?, ny?, nz?, seed, loadText })
//   sim.dims        { nx, ny, nz, Lx, Ly, dx }
//   sim.buffers     { T, vel, tracers }  STORAGE buffers for the views:
//                   T f32 x n, vel vec4f x n (cell-centred u, v, w, 0), tracers
//                   vec4f x capacity (x, y, z, age); index i + nx (j + ny k)
//   sim.set(p), sim.params, sim.reset(seed), sim.setTracers(count), sim.tracerCount
//   sim.step(encoder, frameDt)   encode the substeps of one display frame.
//                   Submit the encoder before the next step() call: the stats
//                   readback maps its buffer on the next call.
//   sim.stats()     latest readback (<= 4 Hz, mapAsync, never stalls):
//                   { simTime, Nu, vmax, Tmean, ke, hot, cold, plume, Ttop, nanResets }
//                   hot / cold: top-layer T max / min position, plume: max w at
//                   mid-height (box units). Ttop: [min, max, mean] of the top layer T.
//   sim.time, sim.frame, sim.lastPlan, sim.destroy()
//
// One substep (all in one compute pass; ref.js header has the math):
//   advA, advB (sim-advect) -> fwdX, fwdY (sim-fft) -> tri (sim-tri)
//   -> invY, invX (sim-fft) -> tracerStep, velPass (sim-misc)
// Stats every 250 ms: statsA, statsB (sim-misc), copy 64 B to a MAP_READ buffer.
// No CPU readback in the frame path. dt comes from planFrame (params.js)
// with the last read vmax (x 1.2); a stale vmax only costs accuracy, as
// the clamped MacCormack and the implicit solves are stable at any CFL.
//
// GPU cost, desktop 128 x 128 x 32 (n = 524288), estimate by design, not
// measured (no browser runs here). Memory traffic per substep:
//   advA 4 traces + samples, mostly cache hits; DRAM about 8 MB in, 8 MB out
//   advB about 16 MB in, 8 MB out
//   FFT x / y and inverse (4 passes) + tri: 4 fields x 8.5 MB spectral, r + w,
//   about 90 MB; vel + tracers about 15 MB.  Total about 150 MB per substep.
//   At 200 GB/s (M1 Pro class) that is about 0.8 ms + ALU of the traces
//   (36 trilinear samples per cell) about 0.4 ms: about 1.2 ms per substep.
//   A frame at default Ra needs 1 to 2 substeps (cap 3): 1.2 to 3.6 ms on
//   desktop. A 68 GB/s GPU (base M1) is about 2.5x slower: 3 ms per substep,
//   so 2 substeps hit the 6 ms budget; quality 1 is the fallback there.
//
// Listing (grep -n "^export" sim/gpu.js):
//   UNIFORM_FIELDS     [name, 'u' | 'f'] in struct Prm order (sim-common.wgsl)
//   SHADER_FILES       module -> WGSL file (each is sim-common.wgsl + the file)
//   LAYOUTS            module -> bindings in its bind group layout
//   ENTRIES            module -> entry points
//   BINDING_NAMES      binding -> sim buffer name
//   radixCode(N)       { stages, code } for the uniform
//   packUniform(D, dims, extra)  ArrayBuffer(144)
//   cellGroups(n)      [gx, gy] workgroups for a 64-thread cell kernel
//   createSim(device, opts)
import { GRIDS, TRACERS, MAX_SUBSTEPS, TRACER_LIFE, planFrame } from './params.js';
import { derived, initialState, initTracers, radices } from './ref.js';

// WebGPU flag values (the globals do not exist in node).
const BU = { MAP_READ: 0x0001, COPY_SRC: 0x0004, COPY_DST: 0x0008, UNIFORM: 0x0040, STORAGE: 0x0080 };
const MAP_READ_MODE = 0x0001;
const COMPUTE = 0x4;

export const UNIFORM_FIELDS = [
  ['nx', 'u'], ['ny', 'u'], ['nz', 'u'], ['nh', 'u'],
  ['n', 'u'], ['nxy', 'u'], ['specN', 'u'], ['tracerCount', 'u'],
  ['dx', 'f'], ['dt', 'f'], ['nu', 'f'], ['kappa', 'f'],
  ['Lx', 'f'], ['Ly', 'f'], ['maEff', 'f'], ['life', 'f'],
  ['mode', 'u'], ['topFree', 'u'], ['tRobin', 'u'], ['botNeumann', 'u'],
  ['rTop', 'f'], ['gTop', 'f'], ['hConst', 'f'], ['relax', 'f'],
  ['nHeat', 'u'], ['frame', 'u'], ['seed', 'u'], ['stX', 'u'],
  ['radX', 'u'], ['stY', 'u'], ['radY', 'u'], ['kMid', 'u'],
  ['bx', 'f'], ['by', 'f'], ['br', 'f'], ['bpow', 'f'],
];
export const SHADER_FILES = { advect: 'sim-advect.wgsl', fft: 'sim-fft.wgsl', tri: 'sim-tri.wgsl', misc: 'sim-misc.wgsl' };
export const COMMON_FILE = 'sim-common.wgsl';
export const LAYOUTS = { advect: [0, 1, 2, 3, 4, 5], fft: [0, 1, 2, 4, 6], tri: [0, 6, 7], misc: [0, 1, 2, 5, 8, 9, 10] };
export const ENTRIES = { advect: ['advA', 'advB'], fft: ['fwdX', 'fwdY', 'invY', 'invX'], tri: ['tri'], misc: ['velPass', 'tracerStep', 'statsA', 'statsB'] };
export const BINDING_NAMES = { 0: 'uni', 1: 'uvw', 2: 'T', 3: 'hat', 4: 'rhs', 5: 'vel', 6: 'spec', 7: 'pspec', 8: 'tracers', 9: 'partials', 10: 'statsOut' };
export const TRACER_CAPACITY = 65536;
const STATS_MS = 250;

export function radixCode(N) {
  const r = radices(N);
  if (N > 256) throw new Error(`line length ${N} > 256 (sim-fft.wgsl sh)`);
  if (r.length > 8) throw new Error('too many FFT stages');
  let code = 0;
  r.forEach((v, s) => { code += v * 2 ** (4 * s); });
  return { stages: r.length, code: code >>> 0 };
}

export function packUniform(D, dims, extra = {}) {
  const { nx, ny, nz } = dims;
  const nh = nx / 2 + 1, n = nx * ny * nz;
  const rx = radixCode(nx), ry = radixCode(ny);
  const v = {
    nx, ny, nz, nh, n, nxy: nx * ny, specN: nh * ny * nz, tracerCount: extra.tracerCount | 0,
    dx: 1 / nz, dt: extra.dt || 0, nu: D.nu, kappa: D.kappa,
    Lx: D.Lx, Ly: D.Ly, maEff: D.maEff, life: TRACER_LIFE,
    mode: D.mode, topFree: D.topFree ? 1 : 0, tRobin: D.tRobin ? 1 : 0, botNeumann: D.botNeumann ? 1 : 0,
    rTop: D.rTop, gTop: D.gTop, hConst: D.hConst, relax: D.relax,
    nHeat: D.nHeat, frame: extra.frame >>> 0, seed: extra.seed >>> 0, stX: rx.stages,
    radX: rx.code, stY: ry.stages, radY: ry.code, kMid: nz >> 1,
    bx: D.bx, by: D.by, br: D.br, bpow: D.bpow,
  };
  const buf = new ArrayBuffer(UNIFORM_FIELDS.length * 4);
  const u = new Uint32Array(buf), f = new Float32Array(buf);
  UNIFORM_FIELDS.forEach(([name, t], i) => {
    const x = v[name];
    if (x === undefined) throw new Error(`uniform field ${name} missing`);
    if (t === 'u') u[i] = x >>> 0; else f[i] = x;
  });
  return buf;
}

export function cellGroups(n) {
  const g = Math.ceil(n / 64);
  const gx = Math.min(g, 32768);
  return [gx, Math.ceil(g / gx)];
}

const defaultLoad = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
});

export async function createSim(device, opts = {}) {
  const quality = opts.quality in GRIDS ? opts.quality : 2;
  const g = GRIDS[quality];
  const nx = opts.nx || g[0], ny = opts.ny || g[1], nz = opts.nz || g[2];
  if (nx % 2 || nz < 2 || nz > 64) throw new Error('grid: nx even, 2 <= nz <= 64');
  radixCode(nx); radixCode(ny);
  const dims = { nx, ny, nz, Lx: nx / nz, Ly: ny / nz, dx: 1 / nz };
  const n = nx * ny * nz, nxy = nx * ny, nh = nx / 2 + 1, S = nh * ny * nz;
  const nPart = Math.ceil(nxy / 64);
  const maxSub = MAX_SUBSTEPS[quality] ?? 3;
  const loadText = opts.loadText || defaultLoad;
  let seed = (opts.seed ?? 1) >>> 0;
  let D = derived({}, dims), P = D.P;
  let tracerCount = Math.min(TRACERS[quality] ?? 20000, TRACER_CAPACITY);
  let frame = 0, destroyed = false;

  // ── buffers ──
  const mk = (size, usage, label) => device.createBuffer({ size: Math.max(16, size), usage, label: `tc-${label}` });
  const B = {
    uni: mk(UNIFORM_FIELDS.length * 4, BU.UNIFORM | BU.COPY_DST, 'uni'),
    uvw: mk(12 * n, BU.STORAGE | BU.COPY_DST | BU.COPY_SRC, 'uvw'),
    T: mk(4 * n, BU.STORAGE | BU.COPY_DST | BU.COPY_SRC, 'T'),
    hat: mk(16 * n, BU.STORAGE, 'hat'),
    rhs: mk(16 * n, BU.STORAGE, 'rhs'),
    vel: mk(16 * n, BU.STORAGE | BU.COPY_DST | BU.COPY_SRC, 'vel'),
    spec: mk(32 * S, BU.STORAGE, 'spec'),
    pspec: mk(8 * S, BU.STORAGE | BU.COPY_DST, 'pspec'),
    tracers: mk(16 * TRACER_CAPACITY, BU.STORAGE | BU.COPY_DST, 'tracers'),
    partials: mk(48 * nPart, BU.STORAGE, 'partials'),
    statsOut: mk(64, BU.STORAGE | BU.COPY_SRC, 'stats'),
  };
  const readback = [0, 1].map(i => ({ buf: mk(64, BU.MAP_READ | BU.COPY_DST, `readback${i}`), state: 'idle', meta: null }));

  // ── pipelines ──
  const base = new URL('../shaders/', import.meta.url);
  const common = await loadText(new URL(COMMON_FILE, base).href);
  const pipes = {}, groups = {};
  for (const mod of Object.keys(SHADER_FILES)) {
    const code = common + '\n' + await loadText(new URL(SHADER_FILES[mod], base).href);
    const module = device.createShaderModule({ code, label: `tc-${mod}` });
    if (module.getCompilationInfo) {
      const info = await module.getCompilationInfo();
      const errs = (info.messages || []).filter(m => m.type === 'error');
      if (errs.length) throw new Error(`${SHADER_FILES[mod]}: ${errs.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('; ')}`);
    }
    const layout = device.createBindGroupLayout({
      label: `tc-${mod}`,
      entries: LAYOUTS[mod].map(b => ({ binding: b, visibility: COMPUTE, buffer: { type: b === 0 ? 'uniform' : 'storage' } })),
    });
    const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    groups[mod] = device.createBindGroup({
      layout, label: `tc-${mod}`,
      entries: LAYOUTS[mod].map(b => ({ binding: b, resource: { buffer: B[BINDING_NAMES[b]] } })),
    });
    for (const e of ENTRIES[mod]) {
      pipes[e] = await device.createComputePipelineAsync({ layout: pl, compute: { module, entryPoint: e }, label: `tc-${e}` });
      pipes[e].mod = mod;
    }
  }

  const [cgx, cgy] = cellGroups(n);
  const dispatch = (pass, e, x, y = 1) => { pass.setPipeline(pipes[e]); pass.setBindGroup(0, groups[pipes[e].mod]); pass.dispatchWorkgroups(x, y); };
  const writeUni = dt => device.queue.writeBuffer(B.uni, 0, packUniform(D, dims, { dt, frame, seed, tracerCount }));

  // ── stats ──
  let latest = { simTime: 0, Nu: 1, vmax: 0, Tmean: 0, ke: 0, hot: [0, 0], cold: [0, 0], plume: [0, 0], Ttop: [0, 0, 0], nanResets: 0 };
  const vHist = [0, 0];
  let lastStatsAt = -1e9, nanResets = 0;
  const pos = col => [((col % nx) + 0.5) / nz, (Math.floor(col / nx) + 0.5) / nz];
  function parse(a, meta) {
    if (!Number.isFinite(a[0]) || !Number.isFinite(a[1])) {
      nanResets++; sim.reset(seed); return;
    }
    if (meta.epoch !== epoch) return; // a reset happened after this copy
    const vmax = Math.sqrt(a[3]);
    vHist[0] = vHist[1]; vHist[1] = vmax;
    latest = {
      simTime: meta.simTime,
      Nu: meta.sun ? a[10] / nxy / meta.heatCond : a[2] / nxy / meta.fluxRef,
      vmax, Tmean: a[1] / n, ke: (0.5 * a[0]) / n,
      hot: pos(a[5]), cold: pos(a[7]), plume: pos(a[9]),
      Ttop: [a[6], a[4], a[11] / nxy], nanResets,
    };
  }
  function poll() {
    for (const rb of readback) {
      if (rb.state !== 'copied') continue;
      rb.state = 'mapping';
      rb.buf.mapAsync(MAP_READ_MODE).then(() => {
        const a = new Float32Array(rb.buf.getMappedRange().slice(0));
        rb.buf.unmap(); rb.state = 'idle';
        if (!destroyed) parse(a, rb.meta);
      }).catch(() => { rb.state = 'idle'; });
    }
  }
  const now = () => (globalThis.performance ? performance.now() : Date.now());

  let epoch = 0;
  const sim = {
    dims, buffers: { T: B.T, vel: B.vel, tracers: B.tracers }, quality,
    time: 0, lastPlan: { n: 0, dt: 0, simDt: 0 },
    get frame() { return frame; },
    get params() { return P; },
    get tracerCount() { return tracerCount; },
    get tracerCapacity() { return TRACER_CAPACITY; },
    set(p = {}) {
      const b = Object.assign({}, P.burner, p.burner || {});
      D = derived(Object.assign({}, P, p, { burner: b }), dims); P = D.P;
    },
    setTracers(count) { tracerCount = Math.max(0, Math.min(TRACER_CAPACITY, count | 0)); },
    reset(s = seed) {
      if (destroyed) return;
      seed = s >>> 0; epoch++;
      const st = initialState(dims, P, seed);
      const uvw = new Float32Array(3 * n);
      uvw.set(st.U, 0); uvw.set(st.V, n); uvw.set(st.W, 2 * n);
      device.queue.writeBuffer(B.uvw, 0, uvw);
      device.queue.writeBuffer(B.T, 0, st.T);
      device.queue.writeBuffer(B.tracers, 0, initTracers(TRACER_CAPACITY, dims, seed));
      writeUni(0);
      const enc = device.createCommandEncoder({ label: 'tc-reset' });
      enc.clearBuffer(B.pspec);
      const pass = enc.beginComputePass();
      dispatch(pass, 'velPass', cgx, cgy);
      pass.end();
      device.queue.submit([enc.finish()]);
      sim.time = 0; vHist[0] = vHist[1] = 0; lastStatsAt = -1e9;
      latest = Object.assign({}, latest, { simTime: 0, Nu: 1, vmax: 0, ke: 0 });
    },
    step(encoder, frameDt) {
      if (destroyed) return sim.lastPlan;
      poll();
      const vEst = 1.2 * Math.max(vHist[0], vHist[1]);
      const plan = planFrame(frameDt, P.speed, vEst, dims.dx, maxSub);
      sim.lastPlan = plan;
      const t = now();
      const rb = t - lastStatsAt >= STATS_MS ? readback.find(r => r.state === 'idle') : null;
      if (plan.n === 0 && !rb) return plan;
      frame = (frame + 1) >>> 0;
      writeUni(plan.dt);
      const pass = encoder.beginComputePass({ label: 'tc-sim' });
      for (let s = 0; s < plan.n; s++) {
        dispatch(pass, 'advA', cgx, cgy);
        dispatch(pass, 'advB', cgx, cgy);
        dispatch(pass, 'fwdX', ny, nz);
        dispatch(pass, 'fwdY', nh, nz);
        dispatch(pass, 'tri', Math.ceil((nh * ny) / 64));
        dispatch(pass, 'invY', nh, nz);
        dispatch(pass, 'invX', ny, nz);
        if (tracerCount > 0) dispatch(pass, 'tracerStep', Math.ceil(tracerCount / 64));
        dispatch(pass, 'velPass', cgx, cgy);
      }
      sim.time += plan.simDt;
      if (rb) {
        dispatch(pass, 'statsA', nPart);
        dispatch(pass, 'statsB', 1);
      }
      pass.end();
      if (rb) {
        encoder.copyBufferToBuffer(B.statsOut, 0, rb.buf, 0, 64);
        rb.state = 'copied';
        rb.meta = { simTime: sim.time, epoch, sun: D.botNeumann, heatCond: D.heatCond, fluxRef: D.fluxRef };
        lastStatsAt = t;
      }
      return plan;
    },
    stats() { latest.nanResets = nanResets; return latest; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const b of Object.values(B)) b.destroy();
      for (const r of readback) { if (r.state !== 'mapping') r.buf.destroy(); }
    },
  };
  sim.reset(seed);
  return sim;
}

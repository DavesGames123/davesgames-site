// ============================================================================
//  STORM GLOBE  ·  solver.js  ·  the WebGPU flow solver on the sphere
// ----------------------------------------------------------------------------
//  No DOM. shaders/solver.wgsl holds the method (see its header). This
//  file makes the buffers and pipelines and encodes the steps.
//
//  Grid choice: latitude-longitude, not cubed sphere. The poles are the
//  usual problem of that grid, and three parts of the method answer it:
//    - advection is semi-Lagrangian along great circles in 3D, so it is
//      stable at any Courant number and has no pole singularity;
//    - the pressure solve is direct (FFT in longitude, one tridiagonal per
//      wavenumber in latitude), so the thin polar cells cost nothing extra
//      and the projection is exact;
//    - a Fourier polar filter damps zonal wavenumbers that the polar rows
//      cannot carry (m > NX/2 cos(lat)/cos(60 deg)).
//  A cubed sphere would need six panels, edge exchange and a panel-aware
//  Poisson solver; the latitude-longitude grid also matches the GFS data.
//
//  createSolver(device, { nx, ny, fnx, fny, shader }) -> solver
//    solver.setFrames(a, b)   two frames { u, v, p } on the fnx x fny grid
//    solver.set({ ... })      dt, fmix, nudge, coriolis, massFix, ... (Params)
//    solver.setStorms(list)   [{ lat, lon (deg), vmax (m/s), rmax, rout (rad),
//                              alpha, pc, penv (hPa), ue, vn (m/s), w }]
//    solver.init()            velocity = target, dye = pattern
//    solver.setState({u,v,dye})   upload a state (tests)
//    solver.step(n)           n steps in one submit (keep n small)
//    solver.run(n)            n steps in chunks, awaits the queue (tests)
//    solver.readState()       -> { u, v, dye, p } Float32Array (async)
//    solver.state, solver.diag (texture), solver.diagView, solver.destroy()
//
//  grep -n targets: "function encodeStep", "PARAM_ORDER", "function setStorms"
// ============================================================================

export const OMEGA = 7.292e-5, R_EARTH = 6.371e6;
// Params fields in the order of struct Params in solver.wgsl
const PARAM_ORDER = [
  ['nx', 'u'], ['ny', 'u'], ['log2nx', 'u'], ['fnx', 'u'],
  ['fny', 'u'], ['nstorm', 'u'], ['massFix', 'u'], ['filterOn', 'u'],
  ['dt', 'f'], ['R', 'f'], ['omega', 'f'], ['tauBg', 'f'],
  ['tauStorm', 'f'], ['fmix', 'f'], ['nudge', 'f'], ['coriolis', 'f'],
  ['cosFilter', 'f'], ['dyeRelax', 'f'], ['pad0', 'f'], ['pad1', 'f'],
];
const ENTRIES = ['init', 'vort', 'goalpass', 'zeta_rhs', 'solve_psi', 'psi_store', 'psi_apply', 'advect', 'reduce1', 'reduce2', 'forces', 'commit', 'fft_rows', 'filt_load', 'filt_apply', 'filt_store', 'div', 'solve', 'pstore', 'project', 'diag'];

export async function loadSolverShader(base = import.meta.url) {
  const r = await fetch(new URL('shaders/solver.wgsl', base));
  if (!r.ok) throw new Error('solver.wgsl ' + r.status);
  return r.text();
}

export async function createSolver(device, opt) {
  const nx = opt.nx, ny = opt.ny, log2nx = Math.round(Math.log2(nx));
  if (2 ** log2nx !== nx || nx > 1024 || nx < 8) throw new Error('nx must be a power of two, 8..1024');
  const fnx = opt.fnx || 4, fny = opt.fny || 3, n = nx * ny;
  const code = opt.shader || await loadSolverShader();
  const module = device.createShaderModule({ code, label: 'storm-globe solver' });
  if (module.getCompilationInfo) {
    const info = await module.getCompilationInfo();
    const errs = info.messages.filter(m => m.type === 'error');
    if (errs.length) throw new Error('solver.wgsl: ' + errs.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('; '));
  }
  const SB = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const buf = (size, usage, label) => device.createBuffer({ size: Math.max(16, size), usage, label });
  const B = {
    params: buf(80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'params'),
    S: buf(n * 16, SB, 'S'), S2: buf(n * 16, SB, 'S2'), C: buf(n * 8, SB, 'C'),
    F: buf(2 * 3 * fnx * fny * 4, SB, 'frames'),
    ST: buf(32 * 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'storms'),
    SUM: buf((8 + Math.ceil(n / 256)) * 4, SB, 'sums'),
    SCR: buf(n * 16, SB, 'scratch'),
    Z: buf(n * 16, SB, 'Z'),
  };
  const diag = device.createTexture({ size: [nx, ny], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING, label: 'diag' });
  const diagView = diag.createView();
  const L0 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ...[1, 2, 3].map(b => ({ binding: b, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } })),
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const L1 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [L0, L1] });
  const pipes = {};
  await Promise.all(ENTRIES.map(async e => {
    pipes[e] = await device.createComputePipelineAsync({ layout, compute: { module, entryPoint: e }, label: e });
  }));
  const g0 = device.createBindGroup({
    layout: L0, entries: [
      { binding: 0, resource: { buffer: B.params } }, { binding: 1, resource: { buffer: B.S } }, { binding: 2, resource: { buffer: B.S2 } },
      { binding: 3, resource: { buffer: B.C } }, { binding: 4, resource: { buffer: B.F } }, { binding: 5, resource: { buffer: B.ST } },
      { binding: 6, resource: { buffer: B.SUM } }, { binding: 7, resource: { buffer: B.SCR } }, { binding: 8, resource: diagView },
      { binding: 9, resource: { buffer: B.Z } },
    ],
  });
  // per-dispatch constants (Op): one small uniform buffer each
  const op = (kind, slot, dir) => {
    const b = buf(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'op');
    const d = new ArrayBuffer(16); new Uint32Array(d, 0, 2).set([kind, slot]); new Float32Array(d, 8, 1)[0] = dir;
    device.queue.writeBuffer(b, 0, d);
    return device.createBindGroup({ layout: L1, entries: [{ binding: 0, resource: { buffer: b } }] });
  };
  const OPS = { none: op(0, 0, 0), slot0: op(0, 0, 0), slot1: op(0, 1, 0), fwd: op(0, 0, -1), inv: op(0, 0, 1) };

  const P = {
    nx, ny, log2nx, fnx, fny, nstorm: 0, massFix: 1, filterOn: 1,
    dt: 600, R: R_EARTH, omega: OMEGA, tauBg: 6 * 3600, tauStorm: 3600, fmix: 0, nudge: 1, coriolis: 1,
    cosFilter: Math.cos(60 * Math.PI / 180), dyeRelax: 0, pad0: 0, pad1: 0,
    ivock: 1,   // JS only: the vorticity correction on or off
  };
  const writeParams = () => {
    const d = new ArrayBuffer(80), u = new Uint32Array(d), f = new Float32Array(d);
    PARAM_ORDER.forEach(([k, t], i) => { if (t === 'u') u[i] = P[k] >>> 0; else f[i] = P[k]; });
    device.queue.writeBuffer(B.params, 0, d);
  };
  writeParams();
  const WG = Math.ceil(n / 64), WG256 = Math.ceil(n / 256);
  const pass = (enc, name, x, g1 = OPS.none) => {
    const p = enc.beginComputePass({ label: name });
    p.setPipeline(pipes[name]); p.setBindGroup(0, g0); p.setBindGroup(1, g1);
    p.dispatchWorkgroups(x); p.end();
  };

  function encodeStep(enc) {
    pass(enc, 'vort', WG);
    if (P.massFix) { pass(enc, 'reduce1', WG256, OPS.slot0); pass(enc, 'reduce2', 1, OPS.slot0); }
    pass(enc, 'advect', WG);
    if (P.massFix) { pass(enc, 'reduce1', WG256, OPS.slot1); pass(enc, 'reduce2', 1, OPS.slot1); }
    if (P.nudge > 0) pass(enc, 'goalpass', WG);
    pass(enc, 'forces', WG); pass(enc, 'commit', WG);
    if (P.filterOn) {
      pass(enc, 'filt_load', WG); pass(enc, 'fft_rows', ny, OPS.fwd);
      pass(enc, 'filt_apply', WG); pass(enc, 'fft_rows', ny, OPS.inv); pass(enc, 'filt_store', WG);
    }
    pass(enc, 'div', WG); pass(enc, 'fft_rows', ny, OPS.fwd);
    pass(enc, 'solve', Math.ceil(nx / 64));
    pass(enc, 'fft_rows', ny, OPS.inv); pass(enc, 'pstore', WG); pass(enc, 'project', WG);
    if (P.ivock) {
      pass(enc, 'zeta_rhs', WG); pass(enc, 'fft_rows', ny, OPS.fwd);
      pass(enc, 'solve_psi', Math.ceil(nx / 64));
      pass(enc, 'fft_rows', ny, OPS.inv); pass(enc, 'psi_store', WG); pass(enc, 'psi_apply', WG);
    }
  }

  const solver = {
    nx, ny, fnx, fny, P, state: B.S, diag, diagView, buffers: B,
    set(o) { Object.assign(P, o); writeParams(); },
    setFrames(a, b) {
      const m = fnx * fny, d = new Float32Array(6 * m);
      [a, b].forEach((fr, k) => { d.set(fr.u, (k * 3) * m); d.set(fr.v, (k * 3 + 1) * m); d.set(fr.p, (k * 3 + 2) * m); });
      device.queue.writeBuffer(B.F, 0, d);
    },
    setStorms(list) {
      const D = Math.PI / 180, d = new Float32Array(32 * 12), k = Math.min(32, list.length);
      for (let i = 0; i < k; i++) {
        const s = list[i];
        d.set([s.lat * D, ((s.lon % 360) + 360) % 360 * D, s.vmax, s.lat >= 0 ? 1 : -1,
          s.rmax, s.rout, s.alpha, s.pc, s.ue || 0, s.vn || 0, s.penv || 1010, s.w ?? 1], i * 12);
      }
      device.queue.writeBuffer(B.ST, 0, d);
      if (P.nstorm !== k) { P.nstorm = k; writeParams(); }
    },
    init() { const e = device.createCommandEncoder(); pass(e, 'init', WG); pass(e, 'diag', WG); device.queue.submit([e.finish()]); },
    setState(s) {
      const d = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { d[4 * i] = s.u[i]; d[4 * i + 1] = s.v[i]; d[4 * i + 2] = s.dye ? s.dye[i] : 0; }
      device.queue.writeBuffer(B.S, 0, d);
    },
    step(k = 1, enc = null) {
      const e = enc || device.createCommandEncoder();
      for (let i = 0; i < k; i++) encodeStep(e);
      pass(e, 'diag', WG);
      if (!enc) device.queue.submit([e.finish()]);
    },
    // many steps, in submits of `chunk` (one huge command buffer can fail)
    async run(k, chunk = 40) {
      for (let i = 0; i < k; i += chunk) { solver.step(Math.min(chunk, k - i)); await device.queue.onSubmittedWorkDone(); }
    },
    encodeDiag(e) { pass(e, 'diag', WG); },
    // run named passes once (tests and debugging): ['div', ['fft_rows', 'fwd'], ...]
    passes(list) {
      const e = device.createCommandEncoder();
      for (const it of list) {
        const [name, o] = Array.isArray(it) ? it : [it, 'none'];
        const x = name === 'fft_rows' ? ny : (name === 'solve' || name === 'solve_psi') ? Math.ceil(nx / 64) : name === 'reduce2' ? 1 : name === 'reduce1' ? WG256 : WG;
        pass(e, name, x, OPS[o]);
      }
      device.queue.submit([e.finish()]);
    },
    async readBuffer(name) {
      const b = B[name], rb = device.createBuffer({ size: b.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const e = device.createCommandEncoder(); e.copyBufferToBuffer(b, 0, rb, 0, b.size); device.queue.submit([e.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const a = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
      return a;
    },
    async readState() {
      const rb = device.createBuffer({ size: n * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const e = device.createCommandEncoder(); e.copyBufferToBuffer(B.S, 0, rb, 0, n * 16); device.queue.submit([e.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const a = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
      const u = new Float32Array(n), v = new Float32Array(n), dye = new Float32Array(n), p = new Float32Array(n);
      for (let i = 0; i < n; i++) { u[i] = a[4 * i]; v[i] = a[4 * i + 1]; dye[i] = a[4 * i + 2]; p[i] = a[4 * i + 3]; }
      return { u, v, dye, p };
    },
    destroy() { for (const b of Object.values(B)) b.destroy(); diag.destroy(); },
  };
  return solver;
}

// ── CPU helpers for the tests (same discrete operators as solver.wgsl) ───
export function gridGeom(nx, ny) {
  const dl = 2 * Math.PI / nx, dp = Math.PI / ny;
  const latC = j => -Math.PI / 2 + (j + 0.5) * dp, latF = j => -Math.PI / 2 + (j + 1) * dp;
  const cosF = j => (j < 0 || j >= ny - 1) ? 0 : Math.cos(latF(j));
  return { nx, ny, dl, dp, latC, latF, cosF };
}
// max |div| (1/s) of a C-grid state, and the RMS of div
export function divergence(st, nx, ny, R = R_EARTH) {
  const g = gridGeom(nx, ny);
  const vS = (i, j) => (j < 0 || j >= ny - 1) ? 0 : st.v[j * nx + ((i % nx) + nx) % nx];
  let mx = 0, ss = 0;
  for (let j = 0; j < ny; j++) {
    const cj = Math.cos(g.latC(j));
    for (let i = 0; i < nx; i++) {
      const du = (st.u[j * nx + i] - st.u[j * nx + (i + nx - 1) % nx]) / (cj * g.dl);
      const dv = (vS(i, j) * g.cosF(j) - vS(i, j - 1) * g.cosF(j - 1)) / (cj * g.dp);
      const d = (du + dv) / R;
      mx = Math.max(mx, Math.abs(d)); ss += d * d;
    }
  }
  return { max: mx, rms: Math.sqrt(ss / (nx * ny)) };
}
export function dyeMass(st, nx, ny) {
  const g = gridGeom(nx, ny);
  let m = 0;
  for (let j = 0; j < ny; j++) { const c = Math.cos(g.latC(j)); for (let i = 0; i < nx; i++) m += st.dye[j * nx + i] * c; }
  return m;
}

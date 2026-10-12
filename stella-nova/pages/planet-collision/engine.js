// ============================================================================
//  PLANET COLLISION  ·  engine.js — the WebGPU SPH solver (no DOM)
// ----------------------------------------------------------------------------
//  SphGPU owns the particle buffers and the compute pipelines of
//  shaders/sph.wgsl. sph.js CpuSPH is its f64 reference; tests.mjs (under
//  Deno) checks one against the other. CONTRACT.md is the API for the
//  render and UI code.
//
//  LIFE OF A RUN
//    const sim = await SphGPU.create(device, cap)     buffers for cap particles
//    sim.upload(setup, prm)                           build.js + sph.js makeParams
//    sim.relaxSteps(n) ... (several frames)           damped, per-body gravity
//    sim.launch()                                     velocities, spins, prime
//    sim.step(n) or sim.encodeSteps(enc, n)           every frame
//    await sim.stats()                                counters for the page
//    sim.destroy()                                    on pagehide (with the device)
//
//  THE TIME STEP lives on the GPU (ctl.dt): cs_forces and cs_kick2 write
//  candidates with atomicMin, cs_dtUpdate takes the next dt. The CPU does
//  not know dt or t until stats() reads them. A frame runs a number of
//  steps, so sim time per frame shrinks when the shock is fast (slow motion
//  at the impact: that is the CFL condition, not an effect).
//
//  PARAMS WRITES (queue.writeBuffer) take effect at the next submit. A mode
//  change (relax -> run) therefore submits the work before it: relaxSteps()
//  and launch() submit their own command buffers.
//
//  grep -n targets
//    buffers ............ "function makeBuffers"
//    pipelines .......... "const LAYOUTS", "function makePipelines"
//    params ............. "writeParams("
//    upload ............. "upload("
//    one step ........... "_encodeStep("
//    prime / launch ..... "prime(", "launch("
//    stats .............. "async stats"
//    readback ........... "async readback"
// ============================================================================
import { FLAG } from './sph.js';
import { UNIT } from './data.js';

const PARAM_BYTES = 528;
const CTL_BYTES = 256;
const DT_INF = 0x7f7fffff;

export async function loadSphCode() {
  const r = await fetch(new URL('./shaders/sph.wgsl', import.meta.url));
  if (!r.ok) throw new Error('sph.wgsl: HTTP ' + r.status);
  return r.text();
}
export function tableSize(cap) { return Math.min(1 << 18, 1 << Math.max(12, Math.ceil(Math.log2(2 * cap)))); }

export class SphGPU {
  static async create(device, cap, code) { return new SphGPU(device, cap, code || await loadSphCode()); }
  constructor(device, cap, code) {
    if (cap > 131072) throw new Error('SphGPU: at most 131072 particles');
    this.dev = device; this.cap = cap;
    this.np = Math.ceil(cap / 256) * 256;
    this.H = tableSize(cap); this.nblk = this.H / 256;
    this.n = 0; this.k = 0; this.prm = null; this.busy = false; this.destroyed = false;
    this.paramData = new ArrayBuffer(PARAM_BYTES);
    makeBuffers(this); makePipelines(this, code);
  }
  // Pack and write the Params uniform. prm: sph.js makeParams.
  writeParams(prm, flags = prm.flags) {
    this.prm = prm; this.flags = flags;
    const u = new Uint32Array(this.paramData), f = new Float32Array(this.paramData);
    u[0] = this.n; u[1] = this.np; u[2] = this.H - 1; u[3] = flags;
    f[4] = prm.cell; f[5] = prm.hmin; f[6] = prm.hmax; f[7] = prm.etaH;
    f[8] = prm.alpha; f[9] = prm.beta; f[10] = prm.cfl; f[11] = prm.cacc;
    f[12] = prm.eps * prm.eps; f[13] = prm.dtMax; f[14] = prm.damp; f[15] = prm.T0;
    f[16] = prm.dtMin; f[17] = prm.growth; u[18] = this.nblk; f[19] = 1 / prm.eps;
    for (let m = 0; m < 4; m++) {
      const M = prm.mats[m], o = 20 + 16 * m;
      if (!M) continue;
      f.set([M.rho0, M.A, M.B, M.E0, M.Eiv, M.Ecv, M.a, M.b, M.alpha, M.beta, M.kT, 0.25 * M.A / M.rho0, M.Tmelt, 0, 0, 0], o);
    }
    for (let b = 0; b < 4; b++) {
      const B = prm.bodies[b], o = 84 + 12 * b;
      if (!B) continue;
      f.set([B.X[0], B.X[1], B.X[2], 0, B.V[0], B.V[1], B.V[2], 0, B.W[0], B.W[1], B.W[2], 0], o);
    }
    this.dev.queue.writeBuffer(this.bufParams, 0, this.paramData);
  }
  // Upload a setup (build.js buildScenario) with parameters prm. Resets
  // the clock. Needs setup.N <= cap.
  upload(setup, prm) {
    if (setup.N > this.cap) throw new Error('SphGPU.upload: N > cap');
    const np = this.np, N = this.n = setup.N, q = this.dev.queue;
    const pos = new Float32Array(np * 4), vel = new Float32Array(np * 4), aux = new Float32Array(np * 4);
    const uu = new Float32Array(np), tag = new Uint32Array(np);
    for (let i = 0; i < N; i++) {
      pos.set([setup.pos[3 * i], setup.pos[3 * i + 1], setup.pos[3 * i + 2], setup.h[i]], 4 * i);
      vel.set([setup.vel[3 * i], setup.vel[3 * i + 1], setup.vel[3 * i + 2], setup.mass[i]], 4 * i);
      aux.set([prm.T0, setup.h[i], 0, 0], 4 * i);
      uu[i] = setup.u[i]; tag[i] = setup.mat[i] | (setup.body[i] << 4);
    }
    q.writeBuffer(this.bufPos, 0, pos); q.writeBuffer(this.bufVel, 0, vel); q.writeBuffer(this.bufAux, 0, aux);
    q.writeBuffer(this.bufU, 0, uu); q.writeBuffer(this.bufTag, 0, tag);
    for (const b of [this.bufPred, this.bufTh, this.bufAcc, this.bufGrav]) q.writeBuffer(b, 0, new Uint8Array(b.size));
    const c = new ArrayBuffer(CTL_BYTES); new Uint32Array(c)[4] = DT_INF;
    q.writeBuffer(this.bufCtl, 0, c);
    this.setup = setup;
    this.writeParams(prm);
    this.k = 0;
  }
  _dispatch(pass, name, n, wg) {
    pass.setPipeline(this.pipe[name]); pass.setBindGroup(0, this.bg[name]);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(n / wg)));
  }
  _grid(pass) {
    const N = this.n, H = this.H;
    this._dispatch(pass, 'gridClear', H, 256);
    this._dispatch(pass, 'gridCount', N, 64);
    this._dispatch(pass, 'scanLocal', H, 256);
    this._dispatch(pass, 'scanBlocks', 1, 1);
    this._dispatch(pass, 'scanAdd', H, 256);
    this._dispatch(pass, 'gridScatter', N, 64);
    this._dispatch(pass, 'reorder', N, 64);
  }
  _encodeStep(pass, nGrav) {
    const N = this.n;
    this._dispatch(pass, 'kickDrift', N, 64);
    this._grid(pass);
    const gp = this.flags & FLAG.SELF_ONLY ? 'gravitySelf' : 'gravity';
    for (let g = 0; g < nGrav; g++) this._dispatch(pass, gp, this.np, 256);
    this._dispatch(pass, 'density', N, 64);
    this._dispatch(pass, 'forces', N, 64);
    this._dispatch(pass, 'kick2', N, 64);
    this._dispatch(pass, 'dtUpdate', 1, 1);
  }
  // Encode n steps into enc (one compute pass). Gravity runs on every
  // KG-th step (prm.KG).
  encodeSteps(enc, n) {
    if (!(n > 0) || !this.n) return;
    const pass = enc.beginComputePass(this.tw ? { timestampWrites: this.tw() } : undefined);
    for (let s = 0; s < n; s++) { this._encodeStep(pass, this.k % this.prm.KG === 0 ? 1 : 0); this.k++; }
    pass.end();
  }
  step(n) { const enc = this.dev.createCommandEncoder(); this.encodeSteps(enc, n); this.dev.queue.submit([enc.finish()]); }
  // A step with dt = 0 and two gravity sums: every derived field is
  // filled, no state moves (sph.js prime). Submits.
  prime(enc0) {
    const q = this.dev.queue;
    q.writeBuffer(this.bufCtl, 4, new Float32Array([0]));
    q.writeBuffer(this.bufCtl, 16, new Uint32Array([DT_INF]));
    const enc = enc0 || this.dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    this._encodeStep(pass, 2);
    pass.end();
    if (!enc0) q.submit([enc.finish()]);
    this.k = 0;
  }
  // Relax: damped, isentropic, each body under its own gravity only.
  // The first call primes. Call it over several frames, then launch().
  relaxSteps(n) {
    if (!this.relaxing) { this.writeParams(this.prm, this.prm.flags | FLAG.RELAX | FLAG.SELF_ONLY); this.prime(); this.relaxing = true; }
    this.step(n);
  }
  // End the relax: run mode, each body gets prm.bodies[b].V and spin W
  // about X; then prime. Submits.
  launch() {
    this.relaxing = false;
    this.writeParams(this.prm, this.prm.flags & ~(FLAG.RELAX | FLAG.SELF_ONLY));
    const enc = this.dev.createCommandEncoder(), pass = enc.beginComputePass();
    this._dispatch(pass, 'boost', this.n, 64); pass.end();
    this.dev.queue.submit([enc.finish()]);
    this.prime();
  }
  // The counters in ctl. null while a read is in flight (one at a time).
  async stats() {
    if (this.busy || this.destroyed) return null;
    this.busy = true;
    const enc = this.dev.createCommandEncoder(), pass = enc.beginComputePass();
    this._dispatch(pass, 'statsClear', 1, 1);
    this._dispatch(pass, 'stats', this.n, 64);
    pass.end();
    enc.copyBufferToBuffer(this.bufCtl, 0, this.stCtl, 0, CTL_BYTES);
    this.dev.queue.submit([enc.finish()]);
    try { await this.stCtl.mapAsync(GPUMapMode.READ); } catch (e) { this.busy = false; return null; }
    if (this.destroyed) { this.busy = false; return null; }
    const b = this.stCtl.getMappedRange().slice(0); this.stCtl.unmap(); this.busy = false;
    return parseCtl(b, this.setup);
  }
  // Copy buffers out. names: any of pos vel pred th aux acc grav uu tag.
  // Returns { name: Float32Array | Uint32Array, ctl }. One at a time.
  async readback(names = ['pos', 'vel', 'th', 'aux', 'uu', 'grav']) {
    if (this.busy || this.destroyed) return null;
    this.busy = true;
    const dev = this.dev, enc = dev.createCommandEncoder(), st = {};
    for (const nm of names) {
      const src = this.buf[nm];
      st[nm] = dev.createBuffer({ size: src.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyBufferToBuffer(src, 0, st[nm], 0, src.size);
    }
    enc.copyBufferToBuffer(this.bufCtl, 0, this.stCtl, 0, CTL_BYTES);
    dev.queue.submit([enc.finish()]);
    const out = {};
    try {
      await Promise.all([...Object.values(st).map(b => b.mapAsync(GPUMapMode.READ)), this.stCtl.mapAsync(GPUMapMode.READ)]);
      for (const nm of names) { const a = st[nm].getMappedRange().slice(0); out[nm] = nm === 'tag' ? new Uint32Array(a) : new Float32Array(a); st[nm].unmap(); }
      out.ctl = parseCtl(this.stCtl.getMappedRange().slice(0), this.setup); this.stCtl.unmap();
    } catch (e) { out.error = e; }
    for (const b of Object.values(st)) b.destroy();
    this.busy = false;
    return out.error ? null : out;
  }
  destroy() { this.destroyed = true; for (const b of this.all) b.destroy(); }
}

// ctl words -> numbers (code units and SI)
function parseCtl(b, setup) {
  const f = new Float32Array(b), u = new Uint32Array(b), s = new Int32Array(b);
  const asF = w => new Float32Array(new Uint32Array([w]).buffer)[0];
  const com = [0, 1, 2, 3].map(k => u[20 + k] ? [s[24 + k] / 256 / u[20 + k], s[28 + k] / 256 / u[20 + k], s[32 + k] / 256 / u[20 + k]] : null);
  const unboundMass = setup ? [0, 1, 2, 3].reduce((a, k) => a + (setup.bodies[k] ? u[16 + k] * setup.bodies[k].mp : 0), 0) : 0;
  return {
    t: f[0], dt: f[1], steps: u[5], tSec: f[0] * UNIT.T, dtSec: f[1] * UNIT.T,
    maxT: asF(u[8]), maxPGPa: asF(u[9]) * UNIT.P / 1e9, maxVkms: asF(u[10]) * UNIT.V / 1e3,
    touching: u[11], melt: u[12], vapour: u[13],
    unbound: [u[16], u[17], u[18], u[19]], count: [u[20], u[21], u[22], u[23]], com, unboundMass,
  };
}

function makeBuffers(s) {
  const dev = s.dev, np = s.np, H = s.H, S = GPUBufferUsage;
  s.all = [];
  const mk = (size, usage, label) => { const b = dev.createBuffer({ size: Math.max(16, size), usage, label: 'pc ' + label }); s.all.push(b); return b; };
  const st = S.STORAGE | S.COPY_DST | S.COPY_SRC;
  s.bufParams = mk(PARAM_BYTES, S.UNIFORM | S.COPY_DST, 'params');
  s.bufCtl = mk(CTL_BYTES, st, 'ctl');
  s.bufPos = mk(np * 16, st, 'pos'); s.bufVel = mk(np * 16, st, 'vel'); s.bufPred = mk(np * 16, st, 'pred');
  s.bufTh = mk(np * 16, st, 'th'); s.bufAux = mk(np * 16, st, 'aux'); s.bufAcc = mk(np * 16, st, 'acc');
  s.bufGrav = mk(np * 32, st, 'grav'); s.bufU = mk(np * 4, st, 'u'); s.bufTag = mk(np * 4, st, 'tag');
  s.bufHash = mk(np * 4, st, 'hash'); s.bufCount = mk(H * 4, st, 'count'); s.bufRange = mk(H * 8, st, 'range');
  s.bufCursor = mk(H * 4, st, 'cursor'); s.bufBlocks = mk(Math.max(1024, s.nblk) * 4, st, 'blocks'); s.bufSorted = mk(np * 4, st, 'sorted');
  s.bufSA = mk(np * 16, st, 'sA'); s.bufSB = mk(np * 16, st, 'sB'); s.bufSC = mk(np * 8, st, 'sC'); s.bufThS = mk(np * 16, st, 'thS');
  s.stCtl = mk(CTL_BYTES, S.COPY_DST | S.MAP_READ, 'ctl read');
  s.buf = { pos: s.bufPos, vel: s.bufVel, pred: s.bufPred, th: s.bufTh, aux: s.bufAux, acc: s.bufAcc, grav: s.bufGrav, uu: s.bufU, tag: s.bufTag };
}
// GPU bytes of one SphGPU with capacity cap (budget.js uses the same sum)
export function sphBytes(cap) {
  const np = Math.ceil(cap / 256) * 256, H = tableSize(cap);
  return PARAM_BYTES + 2 * CTL_BYTES + np * (16 * 6 + 32 + 4 * 4 + 16 * 3 + 8) + H * 16 + Math.max(1024, H / 256) * 4;
}

// binding -> 'u' uniform, 's' storage. Each entry point lists what it uses.
const LAYOUTS = {
  kickDrift:   [0, 1, 2, 3, 4, 6, 7, 9],
  gridClear:   [0, 12],
  gridCount:   [0, 2, 11, 12],
  scanLocal:   [12, 13, 15],
  scanBlocks:  [0, 15],
  scanAdd:     [0, 13, 14, 15],
  gridScatter: [0, 11, 14, 16],
  reorder:     [0, 2, 3, 4, 10, 16, 17, 18, 19],
  gravity:     [0, 1, 2, 3, 8, 10],
  gravitySelf: [0, 1, 2, 3, 8, 10],
  density:     [0, 5, 6, 13, 16, 17, 18, 19, 20],
  forces:      [0, 1, 7, 13, 16, 17, 18, 20],
  kick2:       [0, 1, 2, 3, 5, 7, 8, 9, 10],
  dtUpdate:    [0, 1],
  boost:       [0, 2, 3, 10],
  statsClear:  [1],
  stats:       [0, 1, 2, 3, 5, 6, 8, 10],
};
function makePipelines(s, code) {
  const dev = s.dev;
  const module = dev.createShaderModule({ code, label: 'planet-collision sph.wgsl' });
  const res = {
    0: s.bufParams, 1: s.bufCtl, 2: s.bufPos, 3: s.bufVel, 4: s.bufPred, 5: s.bufTh, 6: s.bufAux, 7: s.bufAcc,
    8: s.bufGrav, 9: s.bufU, 10: s.bufTag, 11: s.bufHash, 12: s.bufCount, 13: s.bufRange, 14: s.bufCursor,
    15: s.bufBlocks, 16: s.bufSorted, 17: s.bufSA, 18: s.bufSB, 19: s.bufSC, 20: s.bufThS,
  };
  s.pipe = {}; s.bg = {};
  for (const [name, L] of Object.entries(LAYOUTS)) {
    const entries = L.map(b => ({ binding: b, visibility: GPUShaderStage.COMPUTE, buffer: { type: b === 0 ? 'uniform' : 'storage' } }));
    const bgl = dev.createBindGroupLayout({ entries, label: 'pc ' + name });
    s.pipe[name] = dev.createComputePipeline({ layout: dev.createPipelineLayout({ bindGroupLayouts: [bgl] }), compute: { module, entryPoint: 'cs_' + name }, label: 'pc ' + name });
    s.bg[name] = dev.createBindGroup({ layout: bgl, entries: L.map(b => ({ binding: b, resource: { buffer: res[b] } })), label: 'pc ' + name });
  }
}

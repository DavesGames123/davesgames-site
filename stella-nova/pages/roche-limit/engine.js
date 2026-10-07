// ============================================================================
//  ROCHE LIMIT  ·  engine.js — the WebGPU rubble pile (no DOM)
// ----------------------------------------------------------------------------
//  SimGPU owns the buffers and the compute pipelines of shaders/sim.wgsl for
//  one satellite. The page (main.js) runs one SimGPU per satellite. The tests
//  (tests.mjs, under Deno) run it against the CPU reference in physics.js.
//
//  GRAVITY: a tiled direct sum, not a Barnes-Hut tree. The sum runs once per
//  block of K = 32 contact steps (physics.js INTEGRATOR), so its cost is
//  spread over 32 steps. At N <= 32k a 256-wide tile sum takes a few ms on a
//  laptop GPU, about the cost of a tree build (sort, link, sum, walk) at
//  this N. It has no opening-angle error, it gives the same force for i on
//  j as for j on i, and so it keeps the energy ledger tight.
//
//  STEP UNIFORM. Each dispatch reads one 256-byte Step record (dynamic
//  offset): the frame point X(t), V(t), dt, the kick factor cF, the gravity
//  extrapolation fraction and the drift flag. encode() writes the records
//  for a frame in one writeBuffer, then encodes every dispatch in one
//  compute pass. The CPU steps the reference orbit (f64) as it writes them.
//
//  KICK MERGE. The closing half kick of one step and the opening half kick
//  of the next are one kick of dt. After the last step of a frame, v is a
//  half step behind. readback() first adds the half kick (synced).
//
//  grep -n targets
//    buffers ............ "function makeBuffers"
//    pipelines .......... "function makePipelines"
//    parameters ......... "setParams("
//    upload ............. "setState("
//    first forces ....... "prime()"
//    blocks ............. "encode(", "encodeSteps("
//    readback ........... "async readback"
// ============================================================================
import { NB, K_STEP, KNL, SKIN, R_MAX, PARK } from './physics.js';

export const CAP = 16;
const STEP_BYTES = 256;
const MAX_STEPS = 4096;

export async function loadSimCode() {
  const r = await fetch(new URL('./shaders/sim.wgsl', import.meta.url));
  if (!r.ok) throw new Error('sim.wgsl: HTTP ' + r.status);
  return r.text();
}

export class SimGPU {
  constructor(device, N, code, K = K_STEP) {
    this.dev = device; this.N = N; this.K = K;
    this.np = Math.ceil(N / 256) * 256;
    this.H = 1 << Math.max(12, Math.ceil(Math.log2(8 * N)));
    this.params = new ArrayBuffer(96);
    this.cur = 0;           // which neighbour list (0: A, 1: B) is current
    this.synced = true;     // v at the same time as x
    this.ref = null;        // RefOrbit (f64), stepped by encode()
    this.dt = 1e-3;
    this.t = 0;             // sim time of the GPU state
    this.W = 0; this.Llost = [0, 0, 0];   // f64 ledger totals (readback)
    this.stepData = new ArrayBuffer(STEP_BYTES * MAX_STEPS);
    this.stepF = new Float32Array(this.stepData); this.stepU = new Uint32Array(this.stepData);
    this.busy = false;
    makeBuffers(this); makePipelines(this, code);
  }
  // C: contact constants (physics.js contactParams); P: planet
  // { GM, Rp, J2, drag }; settle: the settle drag (0 on an orbit).
  setParams(C, P, settle = 0) {
    this.C = C; this.P = P; this.dt = C.dt;
    const u = new Uint32Array(this.params), f = new Float32Array(this.params);
    u[0] = this.N; u[1] = this.np; u[2] = this.H - 1; u[3] = 0;
    f[4] = C.kn; f[5] = C.kt; f[6] = C.gnK; f[7] = C.gtK;
    f[8] = C.mu; f[9] = C.muR; f[10] = C.coh; f[11] = C.cohGap;
    f[12] = SKIN; f[13] = 2 * R_MAX + SKIN; f[14] = C.w0r; f[15] = settle;
    f[16] = P.GM || 0; f[17] = P.Rp || 1; f[18] = P.J2 || 0; f[19] = P.drag || 0;
    f[20] = PARK;
    this.dev.queue.writeBuffer(this.bufParams, 0, this.params);
  }
  // Upload a state. Arrays are f64, stride 3 (pos, vel, spin), plus rad and
  // mass. Rows past N are padding: mass 0, parked.
  setState(pos, vel, spin, rad, mass) {
    const np = this.np, b = new Float32Array(np * 12);
    for (let i = 0; i < np; i++) {
      const o = i * 12;
      if (i < this.N) {
        b[o] = pos[3 * i]; b[o + 1] = pos[3 * i + 1]; b[o + 2] = pos[3 * i + 2]; b[o + 3] = rad[i];
        b[o + 4] = vel[3 * i]; b[o + 5] = vel[3 * i + 1]; b[o + 6] = vel[3 * i + 2]; b[o + 7] = mass[i];
        b[o + 8] = spin[3 * i]; b[o + 9] = spin[3 * i + 1]; b[o + 10] = spin[3 * i + 2];
      } else { b[o] = b[o + 1] = b[o + 2] = PARK; b[o + 3] = 1; }
    }
    const q = this.dev.queue;
    q.writeBuffer(this.bufBody, 0, b);
    this.rad = Float32Array.from(rad); this.mass = Float32Array.from(mass);
    for (const buf of [this.bufAcc, this.bufGrav, this.bufLedger, this.bufDiag, this.bufXi[0], this.bufXi[1]]) q.writeBuffer(buf, 0, new Uint8Array(buf.size));
    const z = new Uint32Array(np * NB + np); q.writeBuffer(this.bufNbr[0], 0, z); q.writeBuffer(this.bufNbr[1], 0, z);
    this.cur = 0; this.synced = true; this.sIn = 0; this.W = 0; this.Llost = [0, 0, 0];
  }
  // Record one Step entry; returns its byte offset.
  _step(k, dt, cF, frac, drift) {
    const o = k * 64, X = this.ref ? this.ref.X : [1e30, 0, 0], V = this.ref ? this.ref.V : [0, 0, 0];
    const f = this.stepF, u = this.stepU;
    f[o] = X[0]; f[o + 1] = X[1]; f[o + 2] = X[2]; f[o + 3] = dt;
    f[o + 4] = V[0]; f[o + 5] = V[1]; f[o + 6] = V[2]; f[o + 7] = cF;
    f[o + 8] = frac; u[o + 9] = drift ? 1 : 0;
    return k * STEP_BYTES;
  }
  _dispatch(pass, name, bg, off, n) {
    pass.setPipeline(this.pipe[name]);
    if (off === null) pass.setBindGroup(0, bg); else pass.setBindGroup(0, bg, [off]);
    pass.dispatchWorkgroups(Math.ceil(n / (name === 'gravity' || name === 'potential' ? 256 : 64)));
  }
  _rebuild(pass, off) {
    const p = this.cur;
    this._dispatch(pass, 'gridClear', this.bg.gridClear, null, this.H);
    this._dispatch(pass, 'gridScatter', this.bg.gridScatter, null, this.N);
    this._dispatch(pass, 'nlist', this.bg.nlist[p], null, this.N);
    this.cur = 1 - p;
  }
  // First neighbour lists, gravity (twice: g and gp equal) and forces at
  // the uploaded state. dt 0: the springs and the ledger do not change.
  // It submits its own encoder: its Step record must not share a submit
  // with an encode() (both write record 0).
  prime() {
    const enc = this.dev.createCommandEncoder();
    const off = this._step(0, 0, 0, 0, false);
    this.dev.queue.writeBuffer(this.bufStep, 0, this.stepData, 0, STEP_BYTES);
    const pass = enc.beginComputePass();
    this._rebuild(pass, off);
    this._dispatch(pass, 'gravity', this.bg.gravity, null, this.np);
    this._dispatch(pass, 'gravity', this.bg.gravity, null, this.np);
    this._dispatch(pass, 'forces', this.bg.forces[this.cur], off, this.N);
    pass.end();
    this.dev.queue.submit([enc.finish()]);
    this.synced = true;
  }
  // Encode nBlocks blocks of K steps. sync: end with the half kick, so a
  // readback sees x and v at the same time.
  encode(enc, nBlocks, sync = false) { this.encodeSteps(enc, nBlocks * this.K, sync); }
  // Encode nSteps steps, going on from where the last encode stopped in
  // the current block (this.sIn): a frame can run part of a block, so the
  // gravity sum (the costly pass) falls on one frame in K / nSteps and the
  // frame time stays even. The block's gravity sum runs after its K-th step.
  encodeSteps(enc, nSteps, sync = false) {
    const K = this.K, dt = this.dt;
    if (!(nSteps > 0)) return;
    if (nSteps + 1 > MAX_STEPS) throw new Error('too many steps in one encode');
    const offs = [], fr = [];
    let k = 0, sIn = this.sIn || 0;
    for (let i = 0; i < nSteps; i++) {
      const cF = this.synced ? 0.5 * dt : dt;
      this.synced = false;
      if (this.ref) this.ref.step(dt);
      offs.push(this._step(k++, dt, cF, (sIn + 1) / K, true));
      fr.push(sIn);
      sIn = (sIn + 1) % K;
    }
    let syncOff = -1;
    if (sync && !this.synced) { syncOff = this._step(k++, dt, 0.5 * dt, 0, false); }
    this.dev.queue.writeBuffer(this.bufStep, 0, this.stepData, 0, k * STEP_BYTES);
    // tw: optional timestamp writes (profiling)
    const pass = enc.beginComputePass(this.tw ? { timestampWrites: this.tw() } : undefined);
    for (let i = 0; i < nSteps; i++) {
      const off = offs[i], s = fr[i];
      this._dispatch(pass, 'kick', this.bg.kick, off, this.N);
      if ((s + 1) % KNL === 0) this._rebuild(pass, off);
      this._dispatch(pass, 'forces', this.bg.forces[this.cur], off, this.N);
      if (s === K - 1) this._dispatch(pass, 'gravity', this.bg.gravity, null, this.np);
    }
    if (syncOff >= 0) { this._dispatch(pass, 'kick', this.bg.kick, syncOff, this.N); this.synced = true; }
    pass.end();
    this.sIn = sIn;
    this.t += nSteps * dt;
  }
  // Copy the state out (call after an encode with sync = true, in the same
  // submit or later). Returns f32 arrays: body (12 per row), grav (8 per
  // row), and the f64 ledger totals. The ledger buffer is cleared after the
  // copy, and its sum goes into this.W and this.Llost.
  // potential false: skip the O(N^2) potential pass (phi stays stale; the
  // result says so with fresh: false).
  async readback(potential = true) {
    if (this.busy) return null;
    this.busy = true;
    const dev = this.dev, enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    if (!this.synced) {
      const off = this._step(0, this.dt, 0.5 * this.dt, 0, false);
      dev.queue.writeBuffer(this.bufStep, 0, this.stepData, 0, STEP_BYTES);
      this._dispatch(pass, 'kick', this.bg.kick, off, this.N);
      this.synced = true;
    }
    if (potential) this._dispatch(pass, 'potential', this.bg.potential, null, this.np);
    pass.end();
    const X = this.ref ? this.ref.X.slice() : [0, 0, 0], V = this.ref ? this.ref.V.slice() : [0, 0, 0], t = this.t;
    enc.copyBufferToBuffer(this.bufBody, 0, this.stBody, 0, this.stBody.size);
    enc.copyBufferToBuffer(this.bufGrav, 0, this.stGrav, 0, this.stGrav.size);
    enc.copyBufferToBuffer(this.bufLedger, 0, this.stLedger, 0, this.stLedger.size);
    enc.copyBufferToBuffer(this.bufCount, this.H * 4, this.stCount, 0, 16);   // [H] bucket full, [H+1] list full
    enc.clearBuffer(this.bufLedger);
    dev.queue.submit([enc.finish()]);
    // a run that is replaced while the copy is in flight destroys the
    // buffers; the map then rejects, and the readback gives null
    try {
      await Promise.all([this.stBody.mapAsync(GPUMapMode.READ), this.stGrav.mapAsync(GPUMapMode.READ), this.stLedger.mapAsync(GPUMapMode.READ), this.stCount.mapAsync(GPUMapMode.READ)]);
    } catch (e) { this.busy = false; return null; }
    if (this.destroyed) { this.busy = false; return null; }
    { const c = new Uint32Array(this.stCount.getMappedRange()); this.overflow = c[0]; this.listFull = c[1]; } this.stCount.unmap();
    const body = new Float32Array(this.stBody.getMappedRange().slice(0));
    const grav = new Float32Array(this.stGrav.getMappedRange().slice(0));
    const led = new Float32Array(this.stLedger.getMappedRange().slice(0));
    this.stBody.unmap(); this.stGrav.unmap(); this.stLedger.unmap();
    for (let i = 0; i < this.N; i++) { this.Llost[0] += led[4 * i]; this.Llost[1] += led[4 * i + 1]; this.Llost[2] += led[4 * i + 2]; this.W += led[4 * i + 3]; }
    this.busy = false;
    return { body, grav, X, V, t, W: this.W, Llost: this.Llost.slice(), overflow: this.overflow, listFull: this.listFull, fresh: potential };
  }
  // Read the fast acceleration and angular acceleration (tests).
  async readAccs() {
    const dev = this.dev, enc = dev.createCommandEncoder();
    const st = dev.createBuffer({ size: this.bufAcc.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyBufferToBuffer(this.bufAcc, 0, st, 0, st.size);
    dev.queue.submit([enc.finish()]);
    await st.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(st.getMappedRange().slice(0)); st.unmap(); st.destroy();
    return a;
  }
  destroy() { this.destroyed = true; for (const b of this.all) b.destroy(); }
}

function makeBuffers(s) {
  const dev = s.dev, np = s.np, S = GPUBufferUsage;
  const mk = (size, usage) => { const b = dev.createBuffer({ size: Math.max(16, size), usage }); s.all.push(b); return b; };
  s.all = [];
  const st = S.STORAGE | S.COPY_DST | S.COPY_SRC;
  s.bufParams = mk(96, S.UNIFORM | S.COPY_DST);
  s.bufStep = mk(STEP_BYTES * MAX_STEPS, S.UNIFORM | S.COPY_DST);
  s.bufBody = mk(np * 48, st);
  s.bufAcc = mk(np * 64, st);
  s.bufGrav = mk(np * 32, st);
  s.bufLedger = mk(np * 16, st);
  s.bufDiag = mk(np * 16, st);
  s.bufNbr = [mk((np * NB + np) * 4, st), mk((np * NB + np) * 4, st)];
  s.bufXi = [mk(np * NB * 16, st), mk(np * NB * 16, st)];
  s.bufCount = mk(s.H * 4 + 16, st);
  s.bufItems = mk(s.H * CAP * 4, st);
  s.stBody = mk(np * 48, S.COPY_DST | S.MAP_READ);
  s.stGrav = mk(np * 32, S.COPY_DST | S.MAP_READ);
  s.stLedger = mk(np * 16, S.COPY_DST | S.MAP_READ);
  s.stCount = mk(16, S.COPY_DST | S.MAP_READ);
}

// Each entry point gets a layout with only its bindings. 'u' uniform,
// 'd' uniform with a dynamic offset, 's' storage.
const LAYOUTS = {
  kick:        { 0: 'u', 1: 'd', 2: 's', 3: 's', 4: 's', 5: 's' },
  forces:      { 0: 'u', 1: 'd', 2: 's', 3: 's', 4: 's', 5: 's', 6: 's', 7: 's', 12: 's' },
  gravity:     { 0: 'u', 2: 's', 4: 's' },
  potential:   { 0: 'u', 2: 's', 4: 's' },
  gridClear:   { 0: 'u', 10: 's' },
  gridScatter: { 0: 'u', 2: 's', 10: 's', 11: 's' },
  nlist:       { 0: 'u', 2: 's', 6: 's', 7: 's', 8: 's', 9: 's', 10: 's', 11: 's' },
};
function makePipelines(s, code) {
  const dev = s.dev;
  const module = dev.createShaderModule({ code, label: 'roche sim.wgsl' });
  s.module = module;
  s.pipe = {}; s.bgl = {};
  for (const [name, L] of Object.entries(LAYOUTS)) {
    const entries = Object.entries(L).map(([b, t]) => ({
      binding: +b, visibility: GPUShaderStage.COMPUTE,
      buffer: t === 's' ? { type: 'storage' } : { type: 'uniform', hasDynamicOffset: t === 'd', minBindingSize: t === 'd' ? 48 : 0 },
    }));
    const bgl = dev.createBindGroupLayout({ entries, label: 'roche ' + name });
    s.bgl[name] = bgl;
    s.pipe[name] = dev.createComputePipeline({ layout: dev.createPipelineLayout({ bindGroupLayouts: [bgl] }), compute: { module, entryPoint: 'cs_' + name }, label: 'roche ' + name });
  }
  const res = (b, parity) => {
    const A = parity, B = 1 - parity;
    switch (b) {
      case 0: return { buffer: s.bufParams };
      case 1: return { buffer: s.bufStep, offset: 0, size: 48 };
      case 2: return { buffer: s.bufBody };
      case 3: return { buffer: s.bufAcc };
      case 4: return { buffer: s.bufGrav };
      case 5: return { buffer: s.bufLedger };
      case 6: return { buffer: s.bufNbr[A] };
      case 7: return { buffer: s.bufXi[A] };
      case 8: return { buffer: s.bufNbr[B] };
      case 9: return { buffer: s.bufXi[B] };
      case 10: return { buffer: s.bufCount };
      case 11: return { buffer: s.bufItems };
      case 12: return { buffer: s.bufDiag };
    }
  };
  const bg = (name, parity = 0) => dev.createBindGroup({ layout: s.bgl[name], entries: Object.keys(LAYOUTS[name]).map(b => ({ binding: +b, resource: res(+b, parity) })) });
  s.bg = {
    kick: bg('kick'), gravity: bg('gravity'), potential: bg('potential'), gridClear: bg('gridClear'), gridScatter: bg('gridScatter'),
    forces: [bg('forces', 0), bg('forces', 1)], nlist: [bg('nlist', 0), bg('nlist', 1)],
  };
}

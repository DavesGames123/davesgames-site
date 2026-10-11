// ============================================================================
//  GRAVITY LAB  ·  engine.js — the particle backends on WebGPU (no DOM)
// ----------------------------------------------------------------------------
//  Two backends for lab.js Lab, with the interface of its CPU backends:
//    RestrictedGPU  test particles against the bodies (cs_restricted)
//    SelfGPU        every particle pulls on every other (cs_gravity, a
//                   tiled direct sum with Plummer softening; cs_kick)
//  makeLab(device, spec, code) picks the backend for an experiment.
//
//  THE PARTICLE BUFFER has the row layout of the roche-limit grains
//  (pages/roche-limit/engine.js bufBody: pos.xyz radius · vel.xyz mass ·
//  spin), and a diag buffer of one vec4 per row, so a renderer built on
//  roche-limit/shaders/particles.wgsl can bind bufBody and bufDiag as they
//  are. A row with mass 0 is gone (parked); spin.w > 0 is its impact time.
//
//  ONE SUBMIT PER STEP CALL. step() writes the trajectory rows and the
//  parameters with queue.writeBuffer, then submits its own encoder. Two
//  step() calls in one encoder would both read the second write.
//
//  KICK MERGE (SelfGPU). The closing half kick of a step and the opening
//  half kick of the next are one kick of dt. After stepSelf(S, dt, false)
//  v is half a step behind x; stepSelf(..., true) or readback() adds the
//  closing half kick first (synced).
//
//  grep -n targets: "export class RestrictedGPU", "export class SelfGPU",
//  "export function makeLab", "async readback", "spawn("
// ============================================================================
import { MAXB, TRAJ_STRIDE, PARK } from './nbody.js';
import { Lab, MAX_S, packRows } from './lab.js';

export async function loadNbodyCode() {
  const r = await fetch(new URL('./shaders/nbody.wgsl', import.meta.url));
  if (!r.ok) throw new Error('nbody.wgsl: HTTP ' + r.status);
  return r.text();
}

// Each entry point gets a layout with only its bindings. 'u' uniform,
// 's' storage, 'r' read-only storage.
const LAYOUTS = {
  restricted: { 0: 'u', 1: 'r', 2: 's', 3: 's', 4: 's' },
  gravity: { 5: 'u', 2: 's', 7: 's' },
  kick: { 5: 'u', 6: 'u', 2: 's', 7: 's' },
};
function layout(dev, L, name) {
  return dev.createBindGroupLayout({ label: 'glab ' + name, entries: Object.entries(L).map(([b, t]) => ({
    binding: +b, visibility: GPUShaderStage.COMPUTE,
    buffer: { type: t === 'u' ? 'uniform' : t === 'r' ? 'read-only-storage' : 'storage' } })) });
}
function pipeline(dev, module, name) {
  const bgl = layout(dev, LAYOUTS[name], name);
  return { bgl, pipe: dev.createComputePipeline({ label: 'glab ' + name, layout: dev.createPipelineLayout({ bindGroupLayouts: [bgl] }), compute: { module, entryPoint: 'cs_' + name } }) };
}

class Base {
  constructor(device, cap) {
    this.dev = device; this.cap = cap; this.all = []; this.busy = false;
    const S = GPUBufferUsage, st = S.STORAGE | S.COPY_DST | S.COPY_SRC;
    this.bufBody = this._mk(cap * 48, st);
    this.bufDiag = this._mk(cap * 16, st);
    this.stBody = this._mk(cap * 48, S.COPY_DST | S.MAP_READ);
    this.stDiag = this._mk(cap * 16, S.COPY_DST | S.MAP_READ);
  }
  _mk(size, usage) { const b = this.dev.createBuffer({ size: Math.max(16, size), usage }); this.all.push(b); return b; }
  get np() { return this.cap; }
  get N() { return this.cap; }
  setParticles(P) {
    this.dev.queue.writeBuffer(this.bufBody, 0, packRows(P.n, this.cap, P));
    this.dev.queue.writeBuffer(this.bufDiag, 0, new Float32Array(this.cap * 4));
  }
  spawn(start, n, pos, vel, size) {
    const b = new Float32Array(n * 12);
    for (let i = 0; i < n; i++) {
      const o = 12 * i;
      for (let k = 0; k < 3; k++) { b[o + k] = pos[3 * i + k]; b[o + 4 + k] = vel[3 * i + k]; }
      b[o + 3] = size; b[o + 7] = 1;
    }
    this.dev.queue.writeBuffer(this.bufBody, start * 48, b);
    this.dev.queue.writeBuffer(this.bufDiag, start * 16, new Float32Array(n * 4));
  }
  async _read(extra) {
    if (this.busy) return null;
    this.busy = true;
    const dev = this.dev, enc = dev.createCommandEncoder();
    enc.copyBufferToBuffer(this.bufBody, 0, this.stBody, 0, this.stBody.size);
    enc.copyBufferToBuffer(this.bufDiag, 0, this.stDiag, 0, this.stDiag.size);
    if (extra) enc.copyBufferToBuffer(extra[0], 0, extra[1], 0, extra[1].size);
    dev.queue.submit([enc.finish()]);
    try { await Promise.all([this.stBody.mapAsync(GPUMapMode.READ), this.stDiag.mapAsync(GPUMapMode.READ), extra ? extra[1].mapAsync(GPUMapMode.READ) : null]); }
    catch (e) { this.busy = false; return null; }
    if (this.destroyed) { this.busy = false; return null; }
    const body = new Float32Array(this.stBody.getMappedRange().slice(0)), diag = new Float32Array(this.stDiag.getMappedRange().slice(0));
    this.stBody.unmap(); this.stDiag.unmap();
    let x = null;
    if (extra) { x = new Uint32Array(extra[1].getMappedRange().slice(0)); extra[1].unmap(); }
    this.busy = false;
    return { body, diag, x };
  }
  destroy() { this.destroyed = true; for (const b of this.all) b.destroy(); }
}

export class RestrictedGPU extends Base {
  constructor(device, cap, code) {
    super(device, cap);
    const S = GPUBufferUsage;
    this.bufParams = this._mk(32, S.UNIFORM | S.COPY_DST);
    this.bufTraj = this._mk((MAX_S + 1) * MAXB * TRAJ_STRIDE * 4, S.STORAGE | S.COPY_DST);
    this.bufHits = this._mk(MAXB * 4, S.STORAGE | S.COPY_DST | S.COPY_SRC);
    this.stHits = this._mk(MAXB * 4, S.COPY_DST | S.MAP_READ);
    const module = device.createShaderModule({ code, label: 'glab nbody.wgsl' });
    this.module = module;
    const p = pipeline(device, module, 'restricted');
    this.pipe = p.pipe;
    const res = { 0: this.bufParams, 1: this.bufTraj, 2: this.bufBody, 3: this.bufDiag, 4: this.bufHits };
    this.bg = device.createBindGroup({ layout: p.bgl, entries: Object.keys(LAYOUTS.restricted).map(b => ({ binding: +b, resource: { buffer: res[b] } })) });
    this.params = new ArrayBuffer(32);
  }
  // S steps of dt against traj rows 0..S (Float32Array); t0 the sim time
  // of row 0; nb the bodies to visit (highest live index + 1).
  step(traj, S, dt, t0, nb) {
    const q = this.dev.queue, u = new Uint32Array(this.params), f = new Float32Array(this.params);
    u[0] = this.cap; u[1] = S; u[2] = Math.min(MAXB, nb); u[3] = 0;
    f[4] = dt; f[5] = t0; f[6] = PARK; f[7] = 0;
    q.writeBuffer(this.bufParams, 0, this.params);
    q.writeBuffer(this.bufTraj, 0, traj, 0, (S + 1) * MAXB * TRAJ_STRIDE);
    const enc = this.dev.createCommandEncoder(), pass = enc.beginComputePass();
    pass.setPipeline(this.pipe); pass.setBindGroup(0, this.bg); pass.dispatchWorkgroups(Math.ceil(this.cap / 64));
    pass.end();
    q.submit([enc.finish()]);
  }
  async readback() {
    const r = await this._read([this.bufHits, this.stHits]);
    if (!r) return null;
    return { body: r.body, diag: r.diag, hits: r.x };
  }
}

export class SelfGPU extends Base {
  constructor(device, cap, code, eps) {
    cap = Math.ceil(cap / 256) * 256;
    super(device, cap);
    const S = GPUBufferUsage;
    this.eps = eps; this.synced = true; this.primed = false;
    this.bufAcc = this._mk(cap * 16, S.STORAGE | S.COPY_DST | S.COPY_SRC);
    this.bufSP = this._mk(16, S.UNIFORM | S.COPY_DST);
    this.bufK = [0, 1, 2].map(() => this._mk(16, S.UNIFORM | S.COPY_DST));
    const module = device.createShaderModule({ code, label: 'glab nbody.wgsl' });
    this.module = module;
    const g = pipeline(device, module, 'gravity'), k = pipeline(device, module, 'kick');
    this.pGrav = g.pipe; this.pKick = k.pipe;
    this.bgGrav = device.createBindGroup({ layout: g.bgl, entries: [{ binding: 5, resource: { buffer: this.bufSP } }, { binding: 2, resource: { buffer: this.bufBody } }, { binding: 7, resource: { buffer: this.bufAcc } }] });
    this.bgKick = this.bufK.map(b => device.createBindGroup({ layout: k.bgl, entries: [{ binding: 5, resource: { buffer: this.bufSP } }, { binding: 6, resource: { buffer: b } }, { binding: 2, resource: { buffer: this.bufBody } }, { binding: 7, resource: { buffer: this.bufAcc } }] }));
    this.dtK = -1;
  }
  setParticles(P) {
    this.n = P.n;
    super.setParticles(P);
    const sp = new ArrayBuffer(16), u = new Uint32Array(sp), f = new Float32Array(sp);
    u[0] = P.n; u[1] = this.cap; f[2] = this.eps * this.eps;
    this.dev.queue.writeBuffer(this.bufSP, 0, sp);
    this.synced = true; this.primed = false;
  }
  _kicks(dt) {
    if (dt === this.dtK) return;
    this.dtK = dt;
    const w = (b, cF, drift) => { const a = new ArrayBuffer(16), f = new Float32Array(a), u = new Uint32Array(a); f[0] = cF; f[1] = dt; u[2] = drift; this.dev.queue.writeBuffer(b, 0, a); };
    w(this.bufK[0], 0.5 * dt, 1); w(this.bufK[1], dt, 1); w(this.bufK[2], 0.5 * dt, 0);
  }
  _grav(pass) { pass.setPipeline(this.pGrav); pass.setBindGroup(0, this.bgGrav); pass.dispatchWorkgroups(this.cap / 256); }
  _kick(pass, which) { pass.setPipeline(this.pKick); pass.setBindGroup(0, this.bgKick[which]); pass.dispatchWorkgroups(Math.ceil(this.n / 64)); }
  // S kick-drift-kick steps; sync: end with v at the time of x
  stepSelf(S, dt, sync = false) {
    if (this.dtK >= 0 && dt !== this.dtK && !this.synced) this.syncNow();
    this._kicks(dt);
    const enc = this.dev.createCommandEncoder(), pass = enc.beginComputePass();
    if (!this.primed) { this._grav(pass); this.primed = true; }
    for (let s = 0; s < S; s++) {
      this._kick(pass, this.synced ? 0 : 1); this.synced = false;
      this._grav(pass);
    }
    if (sync) { this._kick(pass, 2); this.synced = true; }
    pass.end();
    this.dev.queue.submit([enc.finish()]);
  }
  prime() {
    if (this.primed) return;
    const enc = this.dev.createCommandEncoder(), pass = enc.beginComputePass();
    this._grav(pass); pass.end(); this.dev.queue.submit([enc.finish()]); this.primed = true;
  }
  syncNow() {
    if (this.synced) return;
    const enc = this.dev.createCommandEncoder(), pass = enc.beginComputePass();
    this._kick(pass, 2); pass.end(); this.dev.queue.submit([enc.finish()]); this.synced = true;
  }
  // body, diag, and acc (xyz, potential w) for the energy
  async readback() {
    this.prime(); this.syncNow();
    const st = this.stAcc || (this.stAcc = this._mk(this.cap * 16, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ));
    const r = await this._read([this.bufAcc, st]);
    if (!r) return null;
    return { body: r.body, diag: r.diag, acc: new Float32Array(r.x.buffer), hits: new Uint32Array(MAXB) };
  }
}

// A Lab on the GPU for an experiment spec (experiments.js).
export function makeLab(device, spec, code) {
  return new Lab(spec, (cap, sp) => sp.self ? new SelfGPU(device, cap, code, sp.self.eps) : new RestrictedGPU(device, cap, code));
}

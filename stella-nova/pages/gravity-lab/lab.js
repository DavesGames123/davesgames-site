// ============================================================================
//  GRAVITY LAB  ·  lab.js — one running experiment (no DOM, no GPU)
// ----------------------------------------------------------------------------
//  Lab joins the bodies (nbody.js System, f64 on the CPU) and a particle
//  backend. engine.js has the GPU backends (RestrictedGPU, SelfGPU); this
//  file has the CPU backends with the same interface (CpuRestricted,
//  CpuSelf), so the node tests run the same path as the page.
//
//  BACKEND INTERFACE
//    cap                       rows (initial particles + spawn pool)
//    setParticles(P)           P = { n, pos, vel, size, mass? } (f64)
//    spawn(start, n, pos, vel, size)   write rows start .. start + n - 1
//    step(traj, S, dt, t0, nb) restricted: S steps against traj rows
//    stepSelf(S, dt)           self-gravity: S steps
//    readback()                -> { body: Float32Array (12 per row),
//                                 diag, hits } (a Promise on the GPU)
//    destroy()
//
//  ONE FRAME (Lab.frame(h)): S whole particle steps of spec.dt, at most
//  MAX_S (the part of h short of a whole step waits for the next frame,
//  the part over MAX_S is dropped and counted in lag); the bodies move by S dt (System.advance writes the S + 1 rows),
//  the backend moves the particles, then the events of the bodies are
//  returned. A breakup or a merge with ejecta spawns tracers into the pool
//  (a ring: the oldest spawned rows are reused first).
//
//  grep -n targets: "export class Lab", "frame(", "_spawn(",
//  "export class CpuRestricted", "export class CpuSelf"
// ============================================================================
import { System, CpuParticles, MAXB, TRAJ_STRIDE, PARK, selfStep, selfAccel } from './nbody.js';

export const MAX_S = 512;

export class Lab {
  // spec: experiments.js build() result. backend(cap, spec) -> backend.
  constructor(spec, makeBackend) {
    this.spec = spec;
    this.sys = new System(spec.bodies || [], spec.opts || {});
    this.self = !!spec.self;
    const P = spec.self || spec.particles || { n: 0, pos: [], vel: [] };
    this.n0 = P.n;
    this.pool = this.self ? 0 : (spec.pool ?? 0);
    this.cap = Math.ceil(Math.max(1, this.n0 + this.pool) / 64) * 64;
    this.be = makeBackend(this.cap, spec);
    this.be.setParticles(P);
    this.cursor = this.n0;
    this.traj = new Float32Array((MAX_S + 1) * MAXB * TRAJ_STRIDE);
    this.t = 0; this.lag = 0; this.frames = 0;
    this.nb = this._nb();
    this.hitsSeen = new Uint32Array(MAXB);
  }
  _nb() { let nb = 0; for (let i = 0; i < this.sys.n; i++) if (this.sys.alive[i]) nb = i + 1; return nb; }
  // Advance by h (sim time). Returns the events of this frame.
  frame(h) {
    const dt = this.spec.dt;
    // whole steps only: the rest of h waits for the next frame (debt)
    this.debt = (this.debt || 0) + h;
    let S = Math.floor(this.debt / dt + 1e-9);
    if (S > MAX_S) { this.lag += (S - MAX_S) * dt; this.debt -= (S - MAX_S) * dt; S = MAX_S; }
    this.debt -= S * dt;
    if (S < 1) return [];
    if (this.self) {
      this.be.stepSelf(S, dt);
      this.t += S * dt; this.frames++;
      return [];
    }
    const t0 = this.t;
    this.sys.advance(S * dt, S, this.traj);
    const nb = Math.max(this.nb, this._nb());
    if (this.n0 + this.pool > 0) this.be.step(this.traj, S, dt, t0, nb);
    this.nb = this._nb();
    this.t = this.sys.t; this.frames++;
    const ev = this.sys.drain();
    for (const e of ev) if (e.spawn) e.rows = this._spawn(e.spawn);
    return ev;
  }
  // Spawned tracers go into the pool ring. Returns [start, count] pairs.
  _spawn(sp) {
    if (!this.pool) return [];
    const out = []; let k = 0, n = Math.min(sp.n, this.pool);
    while (n > 0) {
      if (this.cursor >= this.n0 + this.pool) this.cursor = this.n0;
      const c = Math.min(n, this.n0 + this.pool - this.cursor);
      this.be.spawn(this.cursor, c, sp.pos.subarray(3 * k, 3 * (k + c)), sp.vel.subarray(3 * k, 3 * (k + c)), sp.size ?? this.spec.debrisSize ?? 0.01);
      out.push([this.cursor, c]);
      this.cursor += c; k += c; n -= c;
    }
    return out;
  }
  destroy() { this.be.destroy(); }
}

// Rows of 12 floats as the GPU buffer holds them.
function packRows(n, cap, P) {
  const b = new Float32Array(cap * 12);
  for (let i = 0; i < cap; i++) {
    const o = 12 * i;
    if (i < n) {
      for (let k = 0; k < 3; k++) { b[o + k] = P.pos[3 * i + k]; b[o + 4 + k] = P.vel[3 * i + k]; }
      b[o + 3] = typeof P.size === 'number' ? P.size : (P.size ? P.size[i] : 0.01);
      b[o + 7] = P.mass ? P.mass[i] : 1;
    } else { b[o] = b[o + 1] = b[o + 2] = PARK; b[o + 3] = 0; }
  }
  return b;
}
export { packRows };

// ── CPU backends (tests, and a fallback) ─────────────────────────────────────
export class CpuRestricted {
  constructor(cap) { this.cap = cap; this.p = null; this.hits = new Uint32Array(MAXB); this.size = new Float64Array(cap); }
  setParticles(P) {
    const pos = new Float64Array(3 * this.cap).fill(PARK), vel = new Float64Array(3 * this.cap);
    pos.set(Array.from(P.pos).slice(0, 3 * P.n)); vel.set(Array.from(P.vel).slice(0, 3 * P.n));
    this.p = new CpuParticles(this.cap, pos, vel);
    for (let i = P.n; i < this.cap; i++) this.p.alive[i] = 0;
    for (let i = 0; i < P.n; i++) this.size[i] = typeof P.size === 'number' ? P.size : (P.size ? P.size[i] : 0.01);
  }
  spawn(start, n, pos, vel, size) {
    for (let i = 0; i < n; i++) {
      const r = start + i;
      for (let k = 0; k < 3; k++) { this.p.x[3 * r + k] = pos[3 * i + k]; this.p.v[3 * r + k] = vel[3 * i + k]; }
      this.p.alive[r] = 1; this.p.hitBody[r] = -1; this.size[r] = size;
    }
  }
  step(traj, S, dt, t0) {
    const before = this.p.hitBody.slice();
    this.p.run(traj, S, dt, t0);
    for (let i = 0; i < this.cap; i++) if (this.p.hitBody[i] >= 0 && before[i] !== this.p.hitBody[i]) this.hits[this.p.hitBody[i]]++;
  }
  readback() {
    const b = new Float32Array(this.cap * 12);
    for (let i = 0; i < this.cap; i++) {
      const o = 12 * i;
      if (this.p.alive[i]) { for (let k = 0; k < 3; k++) { b[o + k] = this.p.x[3 * i + k]; b[o + 4 + k] = this.p.v[3 * i + k]; } b[o + 7] = 1; }
      else { b[o] = b[o + 1] = b[o + 2] = PARK; b[o + 11] = this.p.hitT[i]; }
      b[o + 3] = this.size[i];
    }
    return { body: b, hits: this.hits.slice(), alive: this.p.alive.slice() };
  }
  destroy() {}
}

export class CpuSelf {
  constructor(cap, spec) { this.cap = cap; this.eps = spec.self.eps; }
  setParticles(P) {
    this.st = { n: P.n, pos: Float64Array.from(P.pos), vel: Float64Array.from(P.vel), mass: Float64Array.from(P.mass), eps: this.eps };
    this.size = P.size;
  }
  stepSelf(S, dt) { for (let k = 0; k < S; k++) selfStep(this.st, dt); }
  readback() {
    const { n, pos, vel, mass } = this.st, b = new Float32Array(this.cap * 12);
    for (let i = 0; i < n; i++) { const o = 12 * i; for (let k = 0; k < 3; k++) { b[o + k] = pos[3 * i + k]; b[o + 4 + k] = vel[3 * i + k]; } b[o + 7] = mass[i]; b[o + 3] = typeof this.size === 'number' ? this.size : 0.01; }
    return { body: b, hits: new Uint32Array(MAXB) };
  }
  destroy() {}
}
export { selfAccel };

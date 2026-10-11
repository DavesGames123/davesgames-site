// ============================================================================
//  GRAVITY LAB  ·  nbody.js — the f64 N-body core on the CPU (no DOM, no GPU)
// ----------------------------------------------------------------------------
//  Units: G = 1. Each experiment picks its length and mass units
//  (data.js unitsOf). The z axis is up; most orbits lie in the x-y plane.
//
//  TWO KINDS OF MATTER
//    bodies     at most MAXB massive (or massless) bodies: stars, planets,
//               moons, probes, galaxy cores. class System integrates them
//               here in f64 with an adaptive 6th-order symplectic
//               composition (Yoshida 1990, solution A) of the leapfrog.
//               Close encounters (the Pythagorean problem) need it.
//    particles  thousands of test particles: dust, debris, stars of a
//               disk. They feel the bodies and do not pull back (the
//               restricted method of Toomre & Toomre 1972). engine.js
//               moves them on the GPU (shaders/nbody.wgsl cs_restricted);
//               class CpuParticles here is the f64 reference of the same
//               arithmetic.
//  A third mode, self-gravity (all particles pull on all, tiled direct
//  sum on the GPU), has its f64 reference in selfAccel / selfStep here.
//
//  THE TRAJECTORY. System.advance(h, S, out) moves the bodies by h in S
//  particle steps and writes S + 1 rows of the body states into out
//  (TRAJ_STRIDE floats per body: pos.xyz, GM, vel.xyz, R, eps, absorb,
//  epsP, 0). eps softens body-body pairs; a particle feels a body with
//  the softening sqrt(eps^2 + epsP^2) (epsP keeps a test particle from
//  the singular point of a point mass of radius 0). The particles take S kick-drift-kick steps of h / S against
//  those rows: one force pass per step, at the body positions of the row.
//
//  EVENTS (System.events, drained by the caller): merge (two bodies
//  touch), breakup (a fragile body inside the fluid Roche limit of a
//  heavier body: it becomes debris particles), periapsis (a watched pair
//  at closest approach), capture and release (a watched pair becomes
//  bound or unbound), ejection (a body leaves the system unbound), burn
//  (a scheduled velocity change), hit (a massless body hits a body).
//
//  grep -n targets
//    random ............. "export function rng"
//    Kepler ............. "export function elementsToState",
//                         "export function stateToElements"
//    Lagrange ........... "export function lagrangePoints"
//    integrator ......... "_y6(", "Y6"
//    adaptive step ...... "_tmin("
//    trajectory ......... "advance("
//    merge .............. "_merge("
//    breakup ............ "_breakup("
//    events ............. "_events("
//    particles (ref) .... "export class CpuParticles"
//    self-gravity (ref) . "export function selfAccel"
// ============================================================================

export const MAXB = 32;
export const TRAJ_STRIDE = 12;
export const PARK = 1e9;

// ── random numbers (mulberry32) ─────────────────────────────────────────────
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gauss(r) { const u = Math.max(1e-12, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
export const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
export const lerp = (a, b, t) => a + (b - a) * t;
export const range = (r, a, b) => a + (b - a) * r();

// ── small vector helpers ────────────────────────────────────────────────────
export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
// Rotate a about the unit axis k by angle t (Rodrigues)
export function rotate(a, k, t) {
  const c = Math.cos(t), s = Math.sin(t), d = v3.dot(k, a), x = v3.cross(k, a);
  return [a[0] * c + x[0] * s + k[0] * d * (1 - c), a[1] * c + x[1] * s + k[1] * d * (1 - c), a[2] * c + x[2] * s + k[2] * d * (1 - c)];
}

// ── Kepler ──────────────────────────────────────────────────────────────────
export const period = (GM, a) => 2 * Math.PI * Math.sqrt(a ** 3 / GM);
export function solveKepler(M, e) {
  M = ((M % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let k = 0; k < 60; k++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-15) break; }
  return E;
}
// el: { a, e, i, O, w, f } or { ..., M } (angles in rad). An elliptic
// orbit (e < 1) or a hyperbolic one (e > 1, a < 0, needs f). Returns the
// state relative to the focus.
export function elementsToState(GM, el) {
  const e = el.e || 0, a = el.a, i = el.i || 0, O = el.O || 0, w = el.w || 0;
  let f = el.f;
  if (f === undefined) {
    const E = solveKepler(el.M || 0, e);
    f = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  }
  const p = a * (1 - e * e), r = p / (1 + e * Math.cos(f));
  const xo = r * Math.cos(f), yo = r * Math.sin(f);
  const s = Math.sqrt(GM / p), vxo = -s * Math.sin(f), vyo = s * (e + Math.cos(f));
  const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
  const R = (x, y) => [
    (cO * cw - sO * sw * ci) * x + (-cO * sw - sO * cw * ci) * y,
    (sO * cw + cO * sw * ci) * x + (-sO * sw + cO * cw * ci) * y,
    (sw * si) * x + (cw * si) * y];
  return { r: R(xo, yo), v: R(vxo, vyo) };
}
export function stateToElements(GM, r, v) {
  const rl = v3.len(r), v2 = v3.dot(v, v), h = v3.cross(r, v), hl = v3.len(h);
  const E = 0.5 * v2 - GM / rl, a = -GM / (2 * E);
  const ev = v3.sub(v3.mul(v3.cross(v, h), 1 / GM), v3.mul(r, 1 / rl)), e = v3.len(ev);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / (hl || 1))));
  const n = [-h[1], h[0], 0], nl = Math.hypot(n[0], n[1]);
  const O = nl > 1e-12 ? Math.atan2(n[1], n[0]) : 0;
  let f = e > 1e-10 ? Math.acos(Math.max(-1, Math.min(1, v3.dot(ev, r) / (e * rl)))) : 0;
  if (v3.dot(r, v) < 0) f = 2 * Math.PI - f;
  return { a, e, i, O, f, h: hl, E, ev };
}
// The five Lagrange points of the circular restricted three-body problem
// in the rotating frame: separation 1, primary at (-mu, 0), secondary at
// (1 - mu, 0). Returns [[x, y] x 5] (L1..L5).
export function lagrangePoints(mu) {
  const f = x => x - (1 - mu) * (x + mu) / Math.abs(x + mu) ** 3 - mu * (x - 1 + mu) / Math.abs(x - 1 + mu) ** 3;
  const bis = (lo, hi) => { let flo = f(lo); for (let k = 0; k < 200; k++) { const m = 0.5 * (lo + hi), fm = f(m); if ((fm < 0) === (flo < 0)) { lo = m; flo = fm; } else hi = m; } return 0.5 * (lo + hi); };
  const e = 1e-9;
  return [[bis(-mu + e, 1 - mu - e), 0], [bis(1 - mu + e, 3), 0], [bis(-3, -mu - e), 0],
    [0.5 - mu, Math.sqrt(3) / 2], [0.5 - mu, -Math.sqrt(3) / 2]];
}
export const rocheFluid = (R, rhoP, rhoS, k = 2.44) => k * R * Math.cbrt(rhoP / rhoS);
export const hill = (a, m, M) => a * Math.cbrt(m / (3 * M));

// Shift a body list (and optional particle arrays) to the barycentre at
// rest. Bodies: { m, x:[3], v:[3] }. Returns the shift.
export function toCOM(bodies, parts) {
  let M = 0; const X = [0, 0, 0], V = [0, 0, 0];
  for (const b of bodies) { M += b.m; for (let k = 0; k < 3; k++) { X[k] += b.m * b.x[k]; V[k] += b.m * b.v[k]; } }
  if (M <= 0) return { X, V };
  for (let k = 0; k < 3; k++) { X[k] /= M; V[k] /= M; }
  for (const b of bodies) for (let k = 0; k < 3; k++) { b.x[k] -= X[k]; b.v[k] -= V[k]; }
  if (parts) for (let i = 0; i < parts.n; i++) for (let k = 0; k < 3; k++) { parts.pos[3 * i + k] -= X[k]; parts.vel[3 * i + k] -= V[k]; }
  return { X, V };
}

// Yoshida 1990 6th-order, solution A: w1..w3, w0 = 1 - 2 (w1 + w2 + w3)
const W1 = -1.17767998417887, W2 = 0.235573213359357, W3 = 0.784513610477560, W0 = 1 - 2 * (W1 + W2 + W3);
export const Y6 = [W3, W2, W1, W0, W1, W2, W3];

// ── the bodies ──────────────────────────────────────────────────────────────
// bodies: [{ name, m, r (collision radius), x, v, eps (softening),
//   epsP (extra softening for particles only), absorb (particles that
//   touch it end; default r > 0), merge (takes part
//   in merges; default true when r > 0), fragile: { rho, n } (breaks up
//   inside the fluid Roche limit of a body 10x heavier; n debris),
//   rho (density for the Roche limit; default from m and r), track (watch
//   for ejection; default true) }]
// opts: { eta, maxSub, watch: [[i, j]], burns: [{ t, i, dv:[3] | prograde }],
//   escapeR, debrisN, ejecta (particles sprayed per merge), rand (rng) }
export class System {
  constructor(bodies, opts = {}) {
    if (bodies.length > MAXB) throw new Error(`at most ${MAXB} bodies`);
    const n = this.n = bodies.length;
    this.spec = bodies;
    this.names = bodies.map((b, i) => b.name || 'body ' + i);
    this.m = new Float64Array(n); this.R = new Float64Array(n); this.eps = new Float64Array(n); this.epsP = new Float64Array(n);
    this.x = new Float64Array(3 * n); this.v = new Float64Array(3 * n); this.a = new Float64Array(3 * n);
    this.alive = new Uint8Array(n); this.absorb = new Uint8Array(n); this.mergeOK = new Uint8Array(n);
    this.rho = new Float64Array(n); this.fragile = bodies.map(b => b.fragile || null); this.track = new Uint8Array(n);
    bodies.forEach((b, i) => {
      this.m[i] = b.m; this.R[i] = b.r || 0; this.eps[i] = b.eps || 0; this.epsP[i] = b.epsP || 0;
      for (let k = 0; k < 3; k++) { this.x[3 * i + k] = b.x[k]; this.v[3 * i + k] = b.v[k]; }
      this.alive[i] = 1; this.absorb[i] = b.absorb ?? (b.r > 0 ? 1 : 0); this.mergeOK[i] = b.merge ?? (b.r > 0 ? 1 : 0);
      this.rho[i] = b.rho || (b.r > 0 ? b.m / (4 / 3 * Math.PI * b.r ** 3) : 0); this.track[i] = b.track ?? 1;
    });
    this.eta = opts.eta ?? 0.02; this.maxSub = opts.maxSub ?? 4000;
    this.watch = (opts.watch || []).map(([i, j]) => ({ i, j, d: [Infinity, Infinity], bound: null }));
    this.burns = (opts.burns || []).slice().sort((p, q) => p.t - q.t);
    this.escapeR = opts.escapeR ?? Infinity;
    this.debrisN = opts.debrisN ?? 2000; this.ejectaN = opts.ejecta ?? 0;
    this.rand = opts.rand || rng(1);
    this.t = 0; this.events = []; this.ejected = new Uint8Array(n);
    this.Eloss = 0;   // energy that left the bodies (merges, breakups, hits)
    this.strained = 0; // particle steps where the substep cap was hit
    this.subTotal = 0;
    this._acc();
    for (const w of this.watch) w.bound = this._pairE(w.i, w.j) < 0;
  }
  // softened pair accelerations into this.a
  _acc(x = this.x, a = this.a) {
    const n = this.n, m = this.m, e = this.eps, al = this.alive;
    a.fill(0);
    for (let i = 0; i < n; i++) {
      if (!al[i]) continue;
      const xi = x[3 * i], yi = x[3 * i + 1], zi = x[3 * i + 2];
      for (let j = i + 1; j < n; j++) {
        if (!al[j]) continue;
        const dx = x[3 * j] - xi, dy = x[3 * j + 1] - yi, dz = x[3 * j + 2] - zi;
        const r2 = dx * dx + dy * dy + dz * dz + e[i] * e[i] + e[j] * e[j];
        const inv = 1 / (r2 * Math.sqrt(r2));
        const fi = m[j] * inv, fj = m[i] * inv;
        a[3 * i] += fi * dx; a[3 * i + 1] += fi * dy; a[3 * i + 2] += fi * dz;
        a[3 * j] -= fj * dx; a[3 * j + 1] -= fj * dy; a[3 * j + 2] -= fj * dz;
      }
    }
  }
  // the shortest dynamical time of any pair: min(sqrt(r^3 / M), r / v)
  _tmin() {
    const n = this.n, x = this.x, v = this.v, m = this.m, e = this.eps, al = this.alive;
    let t = Infinity;
    for (let i = 0; i < n; i++) {
      if (!al[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!al[j]) continue;
        const M = m[i] + m[j]; if (!(M > 0)) continue;
        const dx = x[3 * j] - x[3 * i], dy = x[3 * j + 1] - x[3 * i + 1], dz = x[3 * j + 2] - x[3 * i + 2];
        const r2 = dx * dx + dy * dy + dz * dz + e[i] * e[i] + e[j] * e[j], r = Math.sqrt(r2);
        const ux = v[3 * j] - v[3 * i], uy = v[3 * j + 1] - v[3 * i + 1], uz = v[3 * j + 2] - v[3 * i + 2];
        const u = Math.sqrt(ux * ux + uy * uy + uz * uz);
        t = Math.min(t, Math.sqrt(r2 * r / M), u > 0 ? r / u : Infinity);
      }
    }
    return t;
  }
  // one 6th-order step of size h (seven kick-drift-kick leapfrogs, the
  // acceleration of each end reused by the next start)
  _y6(h) {
    const n3 = 3 * this.n, x = this.x, v = this.v, a = this.a;
    for (const w of Y6) {
      const hk = 0.5 * w * h, hd = w * h;
      for (let k = 0; k < n3; k++) { v[k] += hk * a[k]; x[k] += hd * v[k]; }
      this._acc();
      for (let k = 0; k < n3; k++) v[k] += hk * a[k];
    }
    this.t += h;
  }
  // Move the bodies by h with adaptive substeps; contacts and breakups
  // after each substep.
  step(h) {
    let left = h, nsub = 0;
    while (left > 1e-15 * Math.max(1, Math.abs(this.t))) {
      let dt = Math.min(left, this.eta * this._tmin());
      if (nsub >= this.maxSub - 1) { dt = left; this.strained++; }
      this._y6(dt); left -= dt; nsub++;
      if (this._contacts()) this._acc();
    }
    this.subTotal += nsub;
    return nsub;
  }
  // Advance by h in S equal particle steps; write the S + 1 trajectory
  // rows into out (Float32Array, (S + 1) * MAXB * TRAJ_STRIDE), if given.
  advance(h, S = 1, out = null) {
    const dt = h / S;
    if (out) this.writeRow(out, 0);
    for (let s = 0; s < S; s++) {
      const t1 = this.t + dt;
      while (this.burns.length && this.burns[0].t <= t1) {
        const b = this.burns.shift();
        if (b.t > this.t) this.step(b.t - this.t);
        this._burn(b);
      }
      if (t1 > this.t) this.step(t1 - this.t);
      this._events();
      if (out) this.writeRow(out, s + 1);
    }
  }
  writeRow(out, s) {
    const o0 = s * MAXB * TRAJ_STRIDE;
    for (let i = 0; i < MAXB; i++) {
      const o = o0 + i * TRAJ_STRIDE;
      if (i < this.n && this.alive[i]) {
        out[o] = this.x[3 * i]; out[o + 1] = this.x[3 * i + 1]; out[o + 2] = this.x[3 * i + 2]; out[o + 3] = this.m[i];
        out[o + 4] = this.v[3 * i]; out[o + 5] = this.v[3 * i + 1]; out[o + 6] = this.v[3 * i + 2]; out[o + 7] = this.R[i];
        out[o + 8] = this.eps[i]; out[o + 9] = this.absorb[i]; out[o + 10] = this.epsP[i]; out[o + 11] = 0;
      } else {
        out[o] = out[o + 1] = out[o + 2] = PARK; out[o + 3] = 0;
        for (let k = 4; k < TRAJ_STRIDE; k++) out[o + k] = 0;
      }
    }
  }
  _burn(b) {
    const i = b.i; if (!this.alive[i]) return;
    let dv = b.dv;
    if (typeof dv === 'number') { const u = v3.norm([this.v[3 * i], this.v[3 * i + 1], this.v[3 * i + 2]]); dv = v3.mul(u, dv); }
    const before = 0.5 * this.m[i] * (this.v[3 * i] ** 2 + this.v[3 * i + 1] ** 2 + this.v[3 * i + 2] ** 2);
    for (let k = 0; k < 3; k++) this.v[3 * i + k] += dv[k];
    const after = 0.5 * this.m[i] * (this.v[3 * i] ** 2 + this.v[3 * i + 1] ** 2 + this.v[3 * i + 2] ** 2);
    this.Eloss -= after - before;   // a burn adds energy from outside
    this.events.push({ type: 'burn', t: this.t, i, dv: v3.len(dv), label: b.label || '' });
  }
  pos(i) { return [this.x[3 * i], this.x[3 * i + 1], this.x[3 * i + 2]]; }
  vel(i) { return [this.v[3 * i], this.v[3 * i + 1], this.v[3 * i + 2]]; }
  _pairE(i, j) {
    const d = v3.sub(this.pos(j), this.pos(i)), u = v3.sub(this.vel(j), this.vel(i));
    return 0.5 * v3.dot(u, u) - (this.m[i] + this.m[j]) / Math.hypot(v3.len(d), this.eps[i], this.eps[j]);
  }
  // merges and breakups; true when the body list changed
  _contacts() {
    const n = this.n, x = this.x, al = this.alive;
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (!al[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!al[j] || !al[i]) continue;
        const dx = x[3 * j] - x[3 * i], dy = x[3 * j + 1] - x[3 * i + 1], dz = x[3 * j + 2] - x[3 * i + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        // a fragile body and a body ten times heavier: the Roche test
        for (const [s, p] of [[i, j], [j, i]]) {
          const fr = this.fragile[s];
          if (!fr || !al[s] || !al[p] || !(this.m[p] > 10 * this.m[s]) || !(this.R[p] > 0)) continue;
          const dR = rocheFluid(this.R[p], this.rho[p], fr.rho || this.rho[s]);
          if (d2 < dR * dR) { this._breakup(s, p, Math.sqrt(d2), dR); changed = true; }
        }
        if (!al[i] || !al[j]) continue;
        const rr = this.R[i] + this.R[j];
        if (rr > 0 && d2 < rr * rr && (this.mergeOK[i] || this.mergeOK[j])) { this._merge(i, j); changed = true; }
      }
    }
    return changed;
  }
  // Perfect merger: mass, momentum and volume add. A massless body (a
  // probe) that touches a body ends there (event 'hit').
  _merge(i, j) {
    const m = this.m, [big, small] = m[i] >= m[j] ? [i, j] : [j, i];
    const xb = this.pos(big), xs = this.pos(small), vb = this.vel(big), vs = this.vel(small);
    const u = v3.sub(vs, vb), d = v3.sub(xs, xb), M = m[big] + m[small];
    const vimp = v3.len(u);
    if (!(m[small] > 0)) {
      this.alive[small] = 0;
      this.events.push({ type: 'hit', t: this.t, i: small, j: big, v: vimp, pos: xs });
      return;
    }
    const mu = m[big] * m[small] / M;
    const Ebefore = 0.5 * mu * v3.dot(u, u) - m[big] * m[small] / Math.hypot(v3.len(d), this.eps[big], this.eps[small]);
    const X = v3.mul(v3.add(v3.mul(xb, m[big]), v3.mul(xs, m[small])), 1 / M);
    const V = v3.mul(v3.add(v3.mul(vb, m[big]), v3.mul(vs, m[small])), 1 / M);
    // the pair's internal energy leaves as heat (Eloss)
    const U0 = this.potential();
    for (let k = 0; k < 3; k++) { this.x[3 * big + k] = X[k]; this.v[3 * big + k] = V[k]; }
    const Rn = Math.cbrt(this.R[big] ** 3 + this.R[small] ** 3);
    this.rho[big] = M / (4 / 3 * Math.PI * Rn ** 3);
    m[big] = M; this.R[big] = Rn; this.alive[small] = 0; m[small] = 0;
    const U1 = this.potential();
    // the books: E_before - E_after = (1/2) mu u^2 + U0 - U1 (U0 holds the
    // pair's own term; U1 has the merged point in its place)
    this.Eloss += 0.5 * mu * v3.dot(u, u) + (U0 - U1);
    const n = v3.norm(d), vesc = Math.sqrt(2 * M / Rn);
    const ev = { type: 'merge', t: this.t, i: big, j: small, v: vimp, vesc, pos: v3.add(X, v3.mul(n, Rn)), normal: n, E: Ebefore, names: [this.names[big], this.names[small]] };
    if (this.ejectaN > 0) ev.spawn = this._ejecta(big, n, u, vesc);
    this.events.push(ev);
  }
  // Ejecta: tracers from the impact point, in a cone about the impact
  // normal, at 0.6 to 1.6 escape speed. Their mass stays in the body.
  _ejecta(b, nrm, u, vesc) {
    const N = this.ejectaN, r = this.rand, X = this.pos(b), V = this.vel(b), R = this.R[b];
    const pos = new Float64Array(3 * N), vel = new Float64Array(3 * N);
    const t1 = v3.norm(Math.abs(nrm[2]) < 0.9 ? v3.cross(nrm, [0, 0, 1]) : v3.cross(nrm, [1, 0, 0])), t2 = v3.cross(nrm, t1);
    const uhat = v3.norm(u);
    for (let k = 0; k < N; k++) {
      const th = 0.9 * Math.sqrt(r()), ph = 2 * Math.PI * r();
      let d = v3.add(v3.mul(nrm, Math.cos(th)), v3.add(v3.mul(t1, Math.sin(th) * Math.cos(ph)), v3.mul(t2, Math.sin(th) * Math.sin(ph))));
      d = v3.norm(v3.add(d, v3.mul(uhat, -0.35)));   // the spray leans along the impactor's path
      const s = vesc * (0.6 + r() ** 2);
      const p = v3.add(X, v3.mul(v3.norm(v3.add(nrm, v3.mul(d, 0.3))), R * 1.02));
      for (let c = 0; c < 3; c++) { pos[3 * k + c] = p[c]; vel[3 * k + c] = V[c] + s * d[c]; }
    }
    return { n: N, pos, vel, group: 'ejecta' };
  }
  // A fragile body inside the fluid Roche limit becomes N debris tracers:
  // a uniform sphere of its radius that turns with the orbit (tidally
  // locked), so the debris starts with the body's real velocity field.
  _breakup(s, p, d, dR) {
    const N = (this.fragile[s] && this.fragile[s].n) || this.debrisN, r = this.rand;
    const X = this.pos(s), V = this.vel(s), Xp = this.pos(p), Vp = this.vel(p), R = this.R[s];
    const rel = v3.sub(X, Xp), u = v3.sub(V, Vp), w = v3.mul(v3.cross(rel, u), 1 / v3.dot(rel, rel));
    const pos = new Float64Array(3 * N), vel = new Float64Array(3 * N);
    for (let k = 0; k < N; k++) {
      let q;
      do { q = [2 * r() - 1, 2 * r() - 1, 2 * r() - 1]; } while (v3.dot(q, q) > 1);
      q = v3.mul(q, R);
      const vq = v3.cross(w, q);
      for (let c = 0; c < 3; c++) { pos[3 * k + c] = X[c] + q[c]; vel[3 * k + c] = V[c] + vq[c]; }
    }
    const U0 = this.potential(), K = 0.5 * this.m[s] * v3.dot(V, V);
    this.alive[s] = 0; const ms = this.m[s]; this.m[s] = 0;
    const U1 = this.potential();
    this.Eloss += K + (U0 - U1);
    this.events.push({ type: 'breakup', t: this.t, i: s, j: p, d, dRoche: dR, pos: X, mass: ms, name: this.names[s], parent: this.names[p], spawn: { n: N, pos, vel, group: 'debris' } });
  }
  // periapsis, capture / release of watched pairs; ejections
  _events() {
    for (const w of this.watch) {
      if (!this.alive[w.i] || !this.alive[w.j]) continue;
      const d = v3.len(v3.sub(this.pos(w.j), this.pos(w.i)));
      if (w.d[1] < w.d[0] && w.d[1] <= d) this.events.push({ type: 'periapsis', t: this.t, i: w.i, j: w.j, d: w.d[1], names: [this.names[w.i], this.names[w.j]] });
      w.d[0] = w.d[1]; w.d[1] = d;
      const bound = this._pairE(w.i, w.j) < 0;
      if (bound !== w.bound) { this.events.push({ type: bound ? 'capture' : 'release', t: this.t, i: w.i, j: w.j, names: [this.names[w.i], this.names[w.j]] }); w.bound = bound; }
    }
    if (this.escapeR < Infinity) {
      for (let i = 0; i < this.n; i++) {
        if (!this.alive[i] || this.ejected[i] || !this.track[i]) continue;
        let M = 0; const X = [0, 0, 0], V = [0, 0, 0];
        for (let j = 0; j < this.n; j++) if (j !== i && this.alive[j]) { M += this.m[j]; for (let k = 0; k < 3; k++) { X[k] += this.m[j] * this.x[3 * j + k]; V[k] += this.m[j] * this.v[3 * j + k]; } }
        if (!(M > 0)) continue;
        const d = v3.sub(this.pos(i), v3.mul(X, 1 / M)), u = v3.sub(this.vel(i), v3.mul(V, 1 / M));
        const r = v3.len(d);
        if (r > this.escapeR && 0.5 * v3.dot(u, u) - (M + this.m[i]) / r > 0 && v3.dot(d, u) > 0) {
          this.ejected[i] = 1;
          this.events.push({ type: 'ejection', t: this.t, i, v: v3.len(u), vinf: Math.sqrt(Math.max(0, v3.dot(u, u) - 2 * (M + this.m[i]) / r)), name: this.names[i] });
        }
      }
    }
  }
  drain() { const e = this.events; this.events = []; return e; }
  potential() {
    let U = 0; const n = this.n, m = this.m, x = this.x, e = this.eps, al = this.alive;
    for (let i = 0; i < n; i++) if (al[i]) for (let j = i + 1; j < n; j++) if (al[j]) {
      const dx = x[3 * j] - x[3 * i], dy = x[3 * j + 1] - x[3 * i + 1], dz = x[3 * j + 2] - x[3 * i + 2];
      U -= m[i] * m[j] / Math.sqrt(dx * dx + dy * dy + dz * dz + e[i] * e[i] + e[j] * e[j]);
    }
    return U;
  }
  kinetic() { let K = 0; for (let i = 0; i < this.n; i++) if (this.alive[i]) K += 0.5 * this.m[i] * (this.v[3 * i] ** 2 + this.v[3 * i + 1] ** 2 + this.v[3 * i + 2] ** 2); return K; }
  energy() { return this.kinetic() + this.potential(); }
  momentum() { const p = [0, 0, 0]; for (let i = 0; i < this.n; i++) if (this.alive[i]) for (let k = 0; k < 3; k++) p[k] += this.m[i] * this.v[3 * i + k]; return p; }
  angmom() { let L = [0, 0, 0]; for (let i = 0; i < this.n; i++) if (this.alive[i]) L = v3.add(L, v3.mul(v3.cross(this.pos(i), this.vel(i)), this.m[i])); return L; }
  mass() { let M = 0; for (let i = 0; i < this.n; i++) if (this.alive[i]) M += this.m[i]; return M; }
  com() { let M = 0; const X = [0, 0, 0]; for (let i = 0; i < this.n; i++) if (this.alive[i] && this.m[i] > 0) { M += this.m[i]; for (let k = 0; k < 3; k++) X[k] += this.m[i] * this.x[3 * i + k]; } return M > 0 ? v3.mul(X, 1 / M) : X; }
  elementsOf(i, j) { return stateToElements(this.m[i] + this.m[j], v3.sub(this.pos(i), this.pos(j)), v3.sub(this.vel(i), this.vel(j))); }
}

// ── test particles: the f64 reference of shaders/nbody.wgsl cs_restricted ──
// Each step: v += dt/2 a ; x += dt v ; (hit test against row k+1) ;
// a = a(x, row k+1) ; v += dt/2 a. The first a comes from row 0.
export class CpuParticles {
  constructor(n, pos, vel) {
    this.n = n; this.x = Float64Array.from(pos); this.v = Float64Array.from(vel);
    this.alive = new Uint8Array(n).fill(1); this.hitBody = new Int32Array(n).fill(-1); this.hitT = new Float64Array(n);
  }
  static acc(traj, row, x, y, z, out) {
    let ax = 0, ay = 0, az = 0;
    const o0 = row * MAXB * TRAJ_STRIDE;
    for (let j = 0; j < MAXB; j++) {
      const o = o0 + j * TRAJ_STRIDE, GM = traj[o + 3];
      if (!(GM > 0)) continue;
      const dx = traj[o] - x, dy = traj[o + 1] - y, dz = traj[o + 2] - z, e = traj[o + 8], ep = traj[o + 10];
      const r2 = dx * dx + dy * dy + dz * dz + e * e + ep * ep, inv = GM / (r2 * Math.sqrt(r2));
      ax += dx * inv; ay += dy * inv; az += dz * inv;
    }
    out[0] = ax; out[1] = ay; out[2] = az;
  }
  // S steps of dt against traj rows 0..S; t0: the time of row 0
  run(traj, S, dt, t0 = 0) {
    const a = [0, 0, 0];
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      let x = this.x[3 * i], y = this.x[3 * i + 1], z = this.x[3 * i + 2];
      let vx = this.v[3 * i], vy = this.v[3 * i + 1], vz = this.v[3 * i + 2];
      CpuParticles.acc(traj, 0, x, y, z, a);
      for (let k = 0; k < S; k++) {
        vx += 0.5 * dt * a[0]; vy += 0.5 * dt * a[1]; vz += 0.5 * dt * a[2];
        x += dt * vx; y += dt * vy; z += dt * vz;
        const hit = CpuParticles.hit(traj, k + 1, x, y, z);
        if (hit >= 0) { this.alive[i] = 0; this.hitBody[i] = hit; this.hitT[i] = t0 + (k + 1) * dt; break; }
        CpuParticles.acc(traj, k + 1, x, y, z, a);
        vx += 0.5 * dt * a[0]; vy += 0.5 * dt * a[1]; vz += 0.5 * dt * a[2];
      }
      this.x[3 * i] = x; this.x[3 * i + 1] = y; this.x[3 * i + 2] = z;
      this.v[3 * i] = vx; this.v[3 * i + 1] = vy; this.v[3 * i + 2] = vz;
    }
  }
  static hit(traj, row, x, y, z) {
    const o0 = row * MAXB * TRAJ_STRIDE;
    for (let j = 0; j < MAXB; j++) {
      const o = o0 + j * TRAJ_STRIDE, R = traj[o + 7];
      if (!(traj[o + 9] > 0) || !(R > 0)) continue;
      const dx = traj[o] - x, dy = traj[o + 1] - y, dz = traj[o + 2] - z;
      if (dx * dx + dy * dy + dz * dz < R * R) return j;
    }
    return -1;
  }
}

// ── self-gravity: the f64 reference of cs_gravity (tiled direct sum) ────────
// pos stride 3, mass; eps the Plummer softening. Returns acc (stride 3)
// and the potential per particle (self term excluded).
export function selfAccel(n, pos, mass, eps, acc = new Float64Array(3 * n), phi = new Float64Array(n)) {
  const e2 = eps * eps;
  acc.fill(0); phi.fill(0);
  for (let i = 0; i < n; i++) {
    const xi = pos[3 * i], yi = pos[3 * i + 1], zi = pos[3 * i + 2];
    let ax = 0, ay = 0, az = 0, p = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = pos[3 * j] - xi, dy = pos[3 * j + 1] - yi, dz = pos[3 * j + 2] - zi;
      const r2 = dx * dx + dy * dy + dz * dz + e2, ir = 1 / Math.sqrt(r2), f = mass[j] * ir * ir * ir;
      ax += f * dx; ay += f * dy; az += f * dz; p -= mass[j] * ir;
    }
    acc[3 * i] = ax; acc[3 * i + 1] = ay; acc[3 * i + 2] = az; phi[i] = p;
  }
  return { acc, phi };
}
// One kick-drift-kick step of the whole self-gravitating set (reference).
export function selfStep(st, dt) {
  const { n, pos, vel, mass, eps } = st;
  if (!st.acc) st.acc = selfAccel(n, pos, mass, eps).acc;
  const a = st.acc;
  for (let k = 0; k < 3 * n; k++) { vel[k] += 0.5 * dt * a[k]; pos[k] += dt * vel[k]; }
  selfAccel(n, pos, mass, eps, a, st.phi || (st.phi = new Float64Array(n)));
  for (let k = 0; k < 3 * n; k++) vel[k] += 0.5 * dt * a[k];
}
export function selfEnergy(st) {
  const { n, pos, vel, mass, eps } = st;
  const { phi } = selfAccel(n, pos, mass, eps);
  let K = 0, U = 0;
  for (let i = 0; i < n; i++) { K += 0.5 * mass[i] * (vel[3 * i] ** 2 + vel[3 * i + 1] ** 2 + vel[3 * i + 2] ** 2); U += 0.5 * mass[i] * phi[i]; }
  return { K, U, E: K + U };
}

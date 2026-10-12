// ============================================================================
//  PLANET COLLISION  ·  sph.js — the SPH solver on the CPU (f64 reference)
// ----------------------------------------------------------------------------
//  CpuSPH does the same steps as engine.js + shaders/sph.wgsl, in the same
//  order, in f64. tests.mjs runs it for small N (physics checks) and
//  checks the GPU against it. Code units: G = 1, Earth radius, Earth mass.
//
//  THE STEP (one call of step()):
//    1 kickDrift  h = hNext; v += dt/2 a; u += dt/2 du; x += dt v;
//                 predicted v and u at the end of the step (vp, up)
//    2 grid       cells of size 2 hmax (the support of the widest kernel)
//    3 gravity    every KG steps: direct sum with Plummer softening eps;
//                 between, g is extrapolated in time from the last two sums
//    4 density    rho_i = sum_j m_j W(r_ij, h_i); div v, curl v (Balsara);
//                 the EOS (P, c, T, vapour weight); hNext from rho
//    5 forces     a_i = -sum_j m_j (P_i/rho_i^2 + P_j/rho_j^2 + Pi_ij) grad W_ij
//                 du_i = sum_j m_j (P_i/rho_i^2 + Pi_ij/2) v_ij . grad W_ij
//                 grad W_ij is the mean of the gradients with h_i and h_j.
//                 Pi_ij: Monaghan (1992) viscosity, times the mean Balsara
//                 factor; the CFL time step candidate
//    6 kick2      a = a_sph + g; v += dt/2 a; u += dt/2 du; the time step
//                 candidate from |a|. Relax mode: v is damped, du = 0, and
//                 u = u_cold(rho) at the SPH density (the body ends cold).
//    7 dtUpdate   t += dt; dt = min(candidates, dtMax, growth * dt)
//  A step with dt = 0 changes no state and fills every derived field:
//  prime() is that step (with two gravity sums, so the extrapolation has
//  no slope).
//
//  Kernel: Wendland C2 with support H = 2h (Dehnen & Aly 2012).
//
//  grep -n targets: "export function makeParams", "export class CpuSPH",
//  "kickDrift(", "gravity(", "density(", "forces(", "kick2(", "dtUpdate(",
//  "energy(", "export function boundMass", "export const FLAG"
// ============================================================================
import { tillotson, soundSpeed, uCold, MATS_CODE } from './eos.js';
import { ETA_H } from './build.js';

export const FLAG = { RELAX: 1, SELF_ONLY: 2 };
export const WN = 21 / (2 * Math.PI);
export function Wk(r, h) { const H = 2 * h, q = r / H; if (q >= 1) return 0; const a = 1 - q; return WN / (H * H * H) * a * a * a * a * (1 + 4 * q); }
export function dWk(r, h) { const H = 2 * h, q = r / H; if (q >= 1) return 0; const a = 1 - q; return WN / (H * H * H * H) * (-20 * q * a * a * a); }

// The solver parameters for a setup (build.js buildScenario). o overrides.
export function makeParams(setup, o = {}) {
  let hTop = 0, hSurfMin = Infinity;
  for (let b = 0; b < setup.bodies.length; b++) {
    let m = 0;
    for (let i = 0; i < setup.N; i++) if (setup.body[i] === b && setup.h[i] > m) m = setup.h[i];
    hTop = Math.max(hTop, m); hSurfMin = Math.min(hSurfMin, m);
  }
  const hmax = 1.05 * hTop;
  return Object.assign({
    n: setup.N, etaH: ETA_H, hmax, hmin: hmax / 30, cell: 2 * hmax,
    alpha: 1.5, beta: 3.0, cfl: 0.3, cacc: 0.25,
    eps: 0.5 * hSurfMin, dtMax: 0.02, dtMin: 1e-7, growth: 1.25, damp: 0.4, T0: 300,
    KG: 4, flags: 0, mats: MATS_CODE,
    bodies: setup.bodies.map(b => ({ X: b.X.slice(), V: b.V.slice(), W: b.W.slice() })),
  }, o);
}

export class CpuSPH {
  constructor(setup, prm) {
    const N = this.N = setup.N; this.prm = prm;
    const F = n => new Float64Array(n);
    this.x = Float64Array.from(setup.pos); this.v = Float64Array.from(setup.vel);
    this.m = Float64Array.from(setup.mass); this.u = Float64Array.from(setup.u);
    this.h = Float64Array.from(setup.h); this.hn = Float64Array.from(setup.h);
    this.mat = Uint8Array.from(setup.mat); this.body = Uint8Array.from(setup.body);
    this.vp = F(3 * N); this.up = F(N); this.rho = F(N); this.P = F(N); this.cs = F(N); this.bal = F(N);
    this.T = F(N); this.nOther = F(N); this.xv = F(N);
    this.a = F(3 * N); this.du = F(N); this.g = F(3 * N); this.phi = F(N); this.gp = F(3 * N); this.phip = F(N);
    this.t = 0; this.dt = 0; this.tg = 0; this.tgp = 0; this.k = 0; this.cand = Infinity;
  }
  // one step; grav: run the gravity sum in this step
  step(grav) {
    this.cand = Infinity;
    this.kickDrift(); this.grid();
    if (grav) this.gravity();
    this.density(); this.forces(); this.kick2(); this.dtUpdate();
  }
  prime() {
    this.dt = 0; this.cand = Infinity;
    this.kickDrift(); this.grid(); this.gravity(); this.gravity();
    this.density(); this.forces(); this.kick2(); this.dtUpdate();
    this.k = 0;
  }
  run(nSteps) { for (let s = 0; s < nSteps; s++) { this.step(this.k % this.prm.KG === 0); this.k++; } }
  // relax: damped, isentropic, self-gravity of each body only
  relax(nSteps) {
    const f = this.prm.flags; this.prm.flags = f | FLAG.RELAX | FLAG.SELF_ONLY;
    this.prime(); this.run(nSteps); this.prm.flags = f;
  }
  // give each body its velocity V and spin W about its centre X (prm.bodies)
  launch() {
    for (let i = 0; i < this.N; i++) {
      const B = this.prm.bodies[this.body[i]], r = [0, 1, 2].map(c => this.x[3 * i + c] - B.X[c]);
      const w = B.W, wx = [w[1] * r[2] - w[2] * r[1], w[2] * r[0] - w[0] * r[2], w[0] * r[1] - w[1] * r[0]];
      for (let c = 0; c < 3; c++) this.v[3 * i + c] = B.V[c] + wx[c];
    }
    this.prime();
  }
  kickDrift() {
    const dt = this.dt, N = this.N;
    for (let i = 0; i < N; i++) {
      this.h[i] = this.hn[i];
      const uh = Math.max(0, this.u[i] + 0.5 * dt * this.du[i]);
      for (let c = 0; c < 3; c++) {
        const k = 3 * i + c, vh = this.v[k] + 0.5 * dt * this.a[k];
        this.x[k] += dt * vh; this.v[k] = vh; this.vp[k] = vh + 0.5 * dt * this.a[k];
      }
      this.u[i] = uh; this.up[i] = Math.max(0, uh + 0.5 * dt * this.du[i]);
    }
  }
  cellOf(i) { const s = this.prm.cell; return [Math.floor(this.x[3 * i] / s), Math.floor(this.x[3 * i + 1] / s), Math.floor(this.x[3 * i + 2] / s)]; }
  grid() {
    const map = this.map = new Map();
    for (let i = 0; i < this.N; i++) {
      const c = this.cellOf(i), key = c.join(',');
      let l = map.get(key); if (!l) map.set(key, l = []); l.push(i);
    }
  }
  near(i, fn) {
    const c = this.cellOf(i);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const l = this.map.get((c[0] + dx) + ',' + (c[1] + dy) + ',' + (c[2] + dz));
      if (l) for (const j of l) fn(j);
    }
  }
  gravity() {
    const N = this.N, e2 = this.prm.eps ** 2, self = (this.prm.flags & FLAG.SELF_ONLY) !== 0, x = this.x, m = this.m;
    this.gp.set(this.g); this.phip.set(this.phi);
    for (let i = 0; i < N; i++) {
      let ax = 0, ay = 0, az = 0, ph = 0;
      for (let j = 0; j < N; j++) {
        if (self && this.body[j] !== this.body[i]) continue;
        const dx = x[3 * j] - x[3 * i], dy = x[3 * j + 1] - x[3 * i + 1], dz = x[3 * j + 2] - x[3 * i + 2];
        const ir = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz + e2), k = m[j] * ir * ir * ir;
        ax += k * dx; ay += k * dy; az += k * dz; ph -= m[j] * ir;
      }
      this.g[3 * i] = ax; this.g[3 * i + 1] = ay; this.g[3 * i + 2] = az; this.phi[i] = ph + m[i] / Math.sqrt(e2);
    }
    this.tgp = this.tg; this.tg = this.t + this.dt;
  }
  density() {
    const p = this.prm, x = this.x, N = this.N;
    for (let i = 0; i < N; i++) {
      const hi = this.h[i], H2 = 4 * hi * hi;
      let rho = 0, dv = 0, cx = 0, cy = 0, cz = 0, nO = 0;
      this.near(i, j => {
        const dx = x[3 * i] - x[3 * j], dy = x[3 * i + 1] - x[3 * j + 1], dz = x[3 * i + 2] - x[3 * j + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 >= H2) return;
        const r = Math.sqrt(r2);
        rho += this.m[j] * Wk(r, hi);
        if (this.body[j] !== this.body[i]) nO++;
        if (r > 0) {
          const k = this.m[j] * dWk(r, hi) / r;   // grad_i W = k/m_j * (x_i - x_j)
          const vx = this.vp[3 * j] - this.vp[3 * i], vy = this.vp[3 * j + 1] - this.vp[3 * i + 1], vz = this.vp[3 * j + 2] - this.vp[3 * i + 2];
          dv += k * (vx * dx + vy * dy + vz * dz);
          cx += k * (vy * dz - vz * dy); cy += k * (vz * dx - vx * dz); cz += k * (vx * dy - vy * dx);
        }
      });
      const M = p.mats[this.mat[i]], u = this.up[i];
      const P = tillotson(M, rho, u), c = soundSpeed(M, rho, u, P);
      const div = Math.abs(dv / rho), curl = Math.hypot(cx, cy, cz) / rho;
      this.rho[i] = rho; this.P[i] = P; this.cs[i] = c; this.bal[i] = div / (div + curl + 1e-4 * c / hi);
      this.T[i] = p.T0 + Math.max(0, u - uCold(M, rho / M.rho0)) * M.kT;
      this.xv[i] = rho >= M.rho0 ? 0 : Math.min(1, Math.max(0, (u - M.Eiv) / (M.Ecv - M.Eiv)));
      this.nOther[i] = nO;
      this.hn[i] = Math.min(p.hmax, Math.max(p.hmin, p.etaH * Math.cbrt(this.m[i] / rho)));
    }
  }
  forces() {
    const p = this.prm, x = this.x, N = this.N;
    for (let i = 0; i < N; i++) {
      const hi = this.h[i], Ai = this.P[i] / (this.rho[i] * this.rho[i]), ci = this.cs[i];
      let ax = 0, ay = 0, az = 0, du = 0, vs = 2 * ci;
      this.near(i, j => {
        if (j === i) return;
        const hj = this.h[j], hm = Math.max(hi, hj);
        const dx = x[3 * i] - x[3 * j], dy = x[3 * i + 1] - x[3 * j + 1], dz = x[3 * i + 2] - x[3 * j + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 >= 4 * hm * hm || r2 === 0) return;
        const r = Math.sqrt(r2), gk = 0.5 * (dWk(r, hi) + dWk(r, hj)) / r;
        const vx = this.vp[3 * i] - this.vp[3 * j], vy = this.vp[3 * i + 1] - this.vp[3 * j + 1], vz = this.vp[3 * i + 2] - this.vp[3 * j + 2];
        const vr = vx * dx + vy * dy + vz * dz;
        let Pi = 0;
        const cj = this.cs[j];
        if (vr < 0) {
          const hb = 0.5 * (hi + hj), mu = hb * vr / (r2 + 0.01 * hb * hb);
          const cb = 0.5 * (ci + cj), rb = 0.5 * (this.rho[i] + this.rho[j]), fb = 0.5 * (this.bal[i] + this.bal[j]);
          Pi = fb * (-p.alpha * cb * mu + p.beta * mu * mu) / rb;
        }
        const Aj = this.P[j] / (this.rho[j] * this.rho[j]);
        const k = this.m[j] * (Ai + Aj + Pi) * gk;
        ax -= k * dx; ay -= k * dy; az -= k * dz;
        du += this.m[j] * (Ai + 0.5 * Pi) * gk * vr;
        const w = Math.min(0, vr / r);
        vs = Math.max(vs, ci + cj - 3 * w);
      });
      this.a[3 * i] = ax; this.a[3 * i + 1] = ay; this.a[3 * i + 2] = az; this.du[i] = du;
      this.cand = Math.min(this.cand, p.cfl * hi / vs);
    }
  }
  kick2() {
    const p = this.prm, dt = this.dt, N = this.N, relax = (p.flags & FLAG.RELAX) !== 0;
    const tn = this.t + dt, span = this.tg - this.tgp;
    const fr = span > 0 ? Math.min(2, Math.max(0, (tn - this.tg) / span)) : 0;
    const damp = relax ? Math.exp(-dt / p.damp) : 1;
    for (let i = 0; i < N; i++) {
      let a2 = 0;
      for (let c = 0; c < 3; c++) {
        const k = 3 * i + c, g = this.g[k] + fr * (this.g[k] - this.gp[k]);
        const a = this.a[k] + g;
        this.a[k] = a; a2 += a * a;
        this.v[k] = (this.v[k] + 0.5 * dt * a) * damp;
      }
      if (relax) { this.du[i] = 0; const M = p.mats[this.mat[i]]; this.u[i] = uCold(M, this.rho[i] / M.rho0); }
      else this.u[i] = Math.max(0, this.u[i] + 0.5 * dt * this.du[i]);
      this.cand = Math.min(this.cand, p.cacc * Math.sqrt(this.h[i] / Math.max(Math.sqrt(a2), 1e-20)));
    }
  }
  dtUpdate() {
    const p = this.prm;
    this.t += this.dt;
    let d = Math.min(this.cand, p.dtMax);
    if (this.dt > 0) d = Math.min(d, this.dt * p.growth);
    this.dt = Math.max(d, p.dtMin);
  }
  // Energy at the synced state (after a step): kinetic, internal, and
  // gravitational (1/2 sum m phi, phi from the last sum: exact with KG = 1).
  energy() {
    let K = 0, U = 0, W = 0;
    for (let i = 0; i < this.N; i++) {
      const v2 = this.v[3 * i] ** 2 + this.v[3 * i + 1] ** 2 + this.v[3 * i + 2] ** 2;
      K += 0.5 * this.m[i] * v2; U += this.m[i] * this.u[i]; W += 0.5 * this.m[i] * this.phi[i];
    }
    return { K, U, W, E: K + U + W };
  }
  momentum() {
    const P = [0, 0, 0], L = [0, 0, 0];
    for (let i = 0; i < this.N; i++) {
      const m = this.m[i], x = this.x.subarray(3 * i, 3 * i + 3), v = this.v.subarray(3 * i, 3 * i + 3);
      for (let c = 0; c < 3; c++) P[c] += m * v[c];
      L[0] += m * (x[1] * v[2] - x[2] * v[1]); L[1] += m * (x[2] * v[0] - x[0] * v[2]); L[2] += m * (x[0] * v[1] - x[1] * v[0]);
    }
    return { P, L };
  }
}

// The gravitationally bound mass of the largest remnant, by the usual
// iteration (Benz & Asphaug 1999 style): start from the densest particle's
// neighbourhood, keep particles with negative energy relative to the
// remnant's centre of mass and its point-mass potential plus the particle's
// own potential phi. x, v, m, phi: f64 or f32 arrays. Returns
// { M, X, V, members (Uint8Array) }.
export function boundMass(x, v, m, phi, N, iters = 12) {
  let X = [0, 0, 0], V = [0, 0, 0], Mb = 0;
  // seed: particles in the deepest 10 % of the potential
  const ord = Array.from({ length: N }, (_, i) => i).sort((a, b) => phi[a] - phi[b]);
  const mem = new Uint8Array(N);
  for (let k = 0; k < Math.max(1, Math.floor(N / 10)); k++) mem[ord[k]] = 1;
  for (let it = 0; it < iters; it++) {
    Mb = 0; X = [0, 0, 0]; V = [0, 0, 0];
    for (let i = 0; i < N; i++) if (mem[i]) { Mb += m[i]; for (let c = 0; c < 3; c++) { X[c] += m[i] * x[3 * i + c]; V[c] += m[i] * v[3 * i + c]; } }
    for (let c = 0; c < 3; c++) { X[c] /= Mb; V[c] /= Mb; }
    let changed = 0;
    for (let i = 0; i < N; i++) {
      const dv2 = (v[3 * i] - V[0]) ** 2 + (v[3 * i + 1] - V[1]) ** 2 + (v[3 * i + 2] - V[2]) ** 2;
      const b = 0.5 * dv2 + phi[i] < 0 ? 1 : 0;   // phi includes every particle: the remnant and the debris
      if (b !== mem[i]) { mem[i] = b; changed++; }
    }
    if (!changed) break;
  }
  return { M: Mb, X, V, members: mem };
}

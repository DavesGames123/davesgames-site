// ============================================================================
//  ROCHE LIMIT  ·  physics.js — the model, the CPU reference and the analysis
// ----------------------------------------------------------------------------
//  This module has no DOM and no GPU. The page (main.js), the GPU engine
//  (engine.js) and the tests (tests.mjs) all import it. It holds:
//    - the analytic Roche limits and the real body data
//    - the units, the grain sizes and the contact law constants
//    - the pile build (a loose cloud that settles under its own gravity)
//    - the reference orbit that carries the simulation frame
//    - CpuSim: the CPU reference of the force law and the integrator. The
//      GPU kernels in shaders/sim.wgsl do the same arithmetic in f32.
//    - the bound mass analysis and the Kepler conic prediction
//
//  UNITS. G = 1. The mean grain radius is 1. The grain density is 1/PHI0,
//  so a pile at packing PHI0 has a bulk density near 1, and the unit of
//  time is near 1/sqrt(G rho_s). The planet is a point mass M_p at the
//  origin. It does not move: M_s/M_p is near 1e-4.
//
//  FRAME. Particle positions are relative to a reference point X(t). X(t)
//  follows the start orbit of the satellite centre (RefOrbit, f64 on the
//  CPU). A particle feels the planet minus the frame acceleration:
//      a_tide = G M_p [ X/|X|^3 - (X+x)/|X+x|^3 ]
//  tideAccel() uses an exact form with no cancellation, so f32 is enough
//  near the satellite.
//
//  FORCES ON GRAIN i FROM GRAIN j (n points from j to i, s = r_i + r_j)
//    gravity   G m_j d / |d|^3 when |d| >= SMIN = 2 R_MIN, G m_j d / SMIN^3
//              inside. SMIN is the smallest radius sum, so grains that do
//              not overlap feel the exact force of two spheres.
//    normal    (k_n delta - g_n v_n) n when delta = s - |d| > 0, with the
//              total not below 0 (a dashpot does not pull)
//    friction  tangential spring xi (Cundall-Strack), F_t = -k_t xi - g_t v_t,
//              capped at mu (F_n + C); xi is kept per contact in the neighbour
//              list and copied when the list is rebuilt. Lever arms reach
//              the middle of the overlap (a_i = r_i - delta/2), so the
//              torques keep the angular momentum.
//    rolling   torque -mu_r R_eff F_n w_perp / sqrt(|w_perp|^2 + w0^2)
//    cohesion  a pull of C along -n while the grains touch, falling
//              linearly to 0 at a gap of COH_GAP
//
//  INTEGRATOR. Kick-drift-kick (velocity Verlet) at the contact step dt.
//  Self-gravity is the slow force: the direct sum runs once every K steps
//  (h = K dt) and the steps between use a linear extrapolation,
//      aG(t) = aG_k + (t - t_k)/h (aG_k - aG_k-1)
//  An impulse split (r-RESPA, a kick of h/2 aG at each block edge) made the
//  grains rattle on their contacts once per block. The dashpots then took
//  that energy away, and a rough pile could creep. The extrapolation gives
//  no impulse. Its force error is O(h^2 d2a/dt2). Block layout:
//      K times:  v += dt/2 a ; x += dt v ; a = fast(x, v) + aG(t) ; v += dt/2 a
//      aG_k+1 = grav(x_k+1)
//  The fast force uses the half-step velocity for the dashpots (as LAMMPS
//  does). The neighbour lists are rebuilt every KNL steps with a skin.
//  The work of the contact forces uses the trapezoid rule over each step,
//  1/2 (F_old + F_new) . dx, so a ringing contact does not show a false loss.
//
//  grep -n targets
//    Roche formulas ........ "export function rocheRigid"
//    body data ............. "export const BODIES"
//    materials ............. "export const MATERIALS"
//    contact constants ..... "export function contactParams"
//    pile build ............ "export function makeCloud"
//    scenario build ........ "export function placeOnOrbit"
//    reference orbit ....... "export class RefOrbit"
//    tide (stable form) .... "export function tideAccel"
//    CPU reference ......... "export class CpuSim"
//    bound mass ............ "export function analyzeBound"
//    Kepler conic .......... "export function keplerPath"
//    energy ledger ......... "export function energyOf"
// ============================================================================

export const G = 1;
export const PHI0 = 0.6;                  // nominal packing of a settled pile
export const RHO_GRAIN = 1 / PHI0;        // grain density: bulk density near 1
export const R_MIN = 0.85, R_MAX = 1.15;  // grain radius range (mean 1)
export const NB = 24;                     // neighbour slots per grain
export const SKIN = 0.6;                  // neighbour list skin, in grain radii
export const COH_GAP = 0.1;               // cohesion reach past contact
export const K_STEP = 32;                 // fast steps per gravity kick (h = K dt)
export const KNL = 8;                     // fast steps per neighbour rebuild
export const SMIN = 2 * R_MIN;            // gravity: Newton outside, linear field inside
export const PARK = 1e7;                  // where a grain that hit the planet is parked

// ── Roche limits ──────────────────────────────────────────────────────────
// Rigid sphere, no spin: the tide 2 G M r/d^3 equals the surface gravity
// G m/r^2. Synchronous spin adds the centrifugal term (3 instead of 2).
// Fluid: Roche's 2.44 (1849). Chandrasekhar's ellipsoid gives 2.455.
export const K_RIGID = Math.cbrt(2);       // 1.2599
export const K_RIGID_SYNC = Math.cbrt(3);  // 1.4422
export const K_FLUID = 2.44;
export const K_FLUID_CH = 2.455;
export function rocheRigid(Rp, rhoP, rhoS) { return Rp * Math.cbrt(2 * rhoP / rhoS); }
export function rocheRigidSync(Rp, rhoP, rhoS) { return Rp * Math.cbrt(3 * rhoP / rhoS); }
export function rocheFluid(Rp, rhoP, rhoS, k = K_FLUID) { return k * Rp * Math.cbrt(rhoP / rhoS); }
export function hillRadius(d, m, M) { return d * Math.cbrt(m / (3 * M)); }
// The live gauge: tide at the surface point under the planet, and the
// surface gravity, for a sphere of mass m and radius r at distance d.
export function tideGauge(Mp, m, r, d) {
  const tide = 2 * G * Mp * r / (d * d * d), self = G * m / (r * r);
  return { tide, self, ratio: tide / self };
}

// ── real bodies ───────────────────────────────────────────────────────────
// Radii in km, densities in g/cm^3. Sources: NASA planetary fact sheets
// (radii, J2), the 2020 Wikipedia Roche limit tables (densities used there).
export const BODIES = {
  earth:   { name: 'Earth',   R: 6378.137, rho: 5.513, J2: 1.0826e-3 },
  moon:    { name: 'Moon',    R: 1737.1,   rho: 3.346, a: 384399 },
  mars:    { name: 'Mars',    R: 3396.2,   rho: 3.9335, J2: 1.9605e-3 },
  phobos:  { name: 'Phobos',  R: 11.08,    rho: 1.876, a: 9376, peri: 9234.42 },
  jupiter: { name: 'Jupiter', R: 71492,    rho: 1.326, J2: 1.4736e-2 },
  io:      { name: 'Io',      R: 1821.6,   rho: 3.528, a: 421700 },
  saturn:  { name: 'Saturn',  R: 60268,    rho: 0.687, J2: 1.6298e-2 },
  pan:     { name: 'Pan',     R: 14.1,     rho: 0.42,  a: 133584 },
  ice:     { name: 'Water ice grains', rho: 0.92 },
  ringA:   { name: 'A ring outer edge', a: 136775 },
  sl9:     { name: 'Comet Shoemaker-Levy 9', R: 1.0, rho: 0.5, peri: 1.6 * 71492 },
  comet:   { name: 'Average comet', rho: 0.5 },
};

// ── materials ─────────────────────────────────────────────────────────────
// e: coefficient of restitution. mu: sliding friction. muR: rolling
// resistance. coh: cohesive strength in units of the central pressure of
// the pile P_c = (2 pi/3) G rho_s^2 R_s^2.
export const MATERIALS = {
  fluid:    { name: 'Fluid',      e: 0.5, mu: 0.0, muR: 0.0,  coh: 0.0, note: 'frictionless grains, no cohesion: flows like a liquid' },
  rigid:    { name: 'Rigid-ish',  e: 0.5, mu: 0.6, muR: 0.05, coh: 0.0, note: 'rough grains (friction 0.6, rolling resistance): a granular solid' },
  cohesive: { name: 'Cohesive',   e: 0.5, mu: 0.6, muR: 0.05, coh: 0.4, note: 'rough grains with a weak cement between touching grains' },
};

// ── random numbers ────────────────────────────────────────────────────────
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ── contact constants ─────────────────────────────────────────────────────
// The stiffness keeps the overlap of a head-on hit at the escape speed of
// the pile near DELTA_HIT of a grain radius. A settled pile then has an
// overlap near 1% at its centre. dt is 1/14 of the contact time of the
// lightest pair.
export const DELTA_HIT = 0.3;
export function expectedRadius(N) { return Math.cbrt(N * meanR3() / PHI0); }
export function meanR3() { return (R_MAX ** 4 - R_MIN ** 4) / (4 * (R_MAX - R_MIN)); }
export function contactParams(N, mat) {
  const Rs = expectedRadius(N), rhoS = RHO_GRAIN * PHI0;
  const vesc = Rs * Math.sqrt(8 * Math.PI / 3 * G * rhoS);
  const mMean = RHO_GRAIN * 4 / 3 * Math.PI;
  const kn = mMean * (vesc / DELTA_HIT) ** 2;
  const kt = 2 / 7 * kn;
  const le = Math.log(Math.max(1e-3, mat.e));
  const beta = -le / Math.sqrt(Math.PI * Math.PI + le * le);   // damping ratio
  const mMin = RHO_GRAIN * 4 / 3 * Math.PI * R_MIN ** 3;
  const w0 = Math.sqrt(kn / (mMin / 2));                       // lightest pair
  const tc = Math.PI / (w0 * Math.sqrt(Math.max(0.05, 1 - beta * beta)));
  const dt = tc / 14;
  const Pc = 2 * Math.PI / 3 * G * rhoS * rhoS * Rs * Rs;
  const coh = mat.coh * Pc * Math.PI;                           // force per contact (grain area pi a^2, a = 1)
  return { Rs, vesc, kn, kt, beta, gnK: 2 * beta * Math.sqrt(kn), gtK: 2 * beta * Math.sqrt(kt),
    mu: mat.mu, muR: mat.muR, coh, cohGap: COH_GAP, w0r: 0.05 * vesc / Rs, tc, dt, Pc };
}

// ── pile build ────────────────────────────────────────────────────────────
// Random sequential addition in a sphere at packing near 0.3, with grain
// radii uniform in [R_MIN, R_MAX]. The engine then lets the cloud fall
// together under self-gravity with a velocity drag (settle).
export function makeCloud(N, seed = 1, phi = 0.3) {
  const r = rng(seed);
  const rad = new Float64Array(N);
  let vol = 0;
  for (let i = 0; i < N; i++) { rad[i] = R_MIN + (R_MAX - R_MIN) * r(); vol += rad[i] ** 3; }
  const R = Math.cbrt(vol / phi);
  const pos = new Float64Array(N * 3);
  const cell = 2 * R_MAX, inv = 1 / cell;
  const grid = new Map();
  const key = (a, b, c) => (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  let placed = 0, tries = 0, Rcur = R;
  while (placed < N) {
    if (++tries > N * 400) { Rcur *= 1.02; tries = 0; }   // never seen; a guard
    let x, y, z;
    do { x = (2 * r() - 1) * Rcur; y = (2 * r() - 1) * Rcur; z = (2 * r() - 1) * Rcur; } while (x * x + y * y + z * z > (Rcur - R_MAX) ** 2);
    const ci = Math.floor(x * inv), cj = Math.floor(y * inv), ck = Math.floor(z * inv);
    let ok = true;
    for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1 && ok; b++) for (let c = -1; c <= 1 && ok; c++) {
      const list = grid.get(key(ci + a, cj + b, ck + c)); if (!list) continue;
      for (const j of list) {
        const dx = x - pos[3 * j], dy = y - pos[3 * j + 1], dz = z - pos[3 * j + 2], s = rad[placed] + rad[j];
        if (dx * dx + dy * dy + dz * dz < s * s) { ok = false; break; }
      }
    }
    if (!ok) continue;
    pos[3 * placed] = x; pos[3 * placed + 1] = y; pos[3 * placed + 2] = z;
    const k = key(ci, cj, ck); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(placed);
    placed++;
  }
  const mass = new Float64Array(N);
  for (let i = 0; i < N; i++) mass[i] = RHO_GRAIN * 4 / 3 * Math.PI * rad[i] ** 3;
  return { N, pos, rad, mass };
}

// Centre of mass, mass, effective radius and bulk density of a set of
// grains (all, or those with mask[i]). R_eff = sqrt(5/3 <r^2>), exact for a
// uniform sphere.
export function pileStats(pos, mass, vel = null, mask = null) {
  let M = 0, cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
  const N = mass.length;
  for (let i = 0; i < N; i++) {
    if (mask && !mask[i]) continue;
    const m = mass[i]; M += m; cx += m * pos[3 * i]; cy += m * pos[3 * i + 1]; cz += m * pos[3 * i + 2];
    if (vel) { vx += m * vel[3 * i]; vy += m * vel[3 * i + 1]; vz += m * vel[3 * i + 2]; }
  }
  if (M <= 0) return { M: 0, com: [0, 0, 0], vcm: [0, 0, 0], R: 0, rho: 0 };
  cx /= M; cy /= M; cz /= M; vx /= M; vy /= M; vz /= M;
  let s2 = 0;
  for (let i = 0; i < N; i++) {
    if (mask && !mask[i]) continue;
    const dx = pos[3 * i] - cx, dy = pos[3 * i + 1] - cy, dz = pos[3 * i + 2] - cz;
    s2 += mass[i] * (dx * dx + dy * dy + dz * dz);
  }
  const R = Math.sqrt(5 / 3 * s2 / M);
  return { M, com: [cx, cy, cz], vcm: [vx, vy, vz], R, rho: M / (4 / 3 * Math.PI * R ** 3) };
}

// ── the planet ────────────────────────────────────────────────────────────
// Point mass with an optional J2 term (spin axis z). primaryAccel returns
// the full acceleration at r (f64, CPU).
export function primaryAccel(P, x, y, z, out) {
  const r2 = x * x + y * y + z * z, r = Math.sqrt(r2), ir3 = 1 / (r2 * r);
  let ax = -P.GM * x * ir3, ay = -P.GM * y * ir3, az = -P.GM * z * ir3;
  if (P.J2) {
    const k = 1.5 * P.J2 * P.GM * P.Rp * P.Rp / (r2 * r2 * r), z2 = 5 * z * z / r2;
    ax += k * x * (z2 - 1); ay += k * y * (z2 - 1); az += k * z * (z2 - 3);
  }
  out[0] = ax; out[1] = ay; out[2] = az;
  return out;
}

// The stable tide: GM [X/|X|^3 - R/|R|^3] with R = X + x, written so that
// no large terms cancel. Also used, in f32, by the GPU kernel.
export function tideAccel(GM, X, Y, Z, x, y, z, out) {
  const Rx = X + x, Ry = Y + y, Rz = Z + z;
  const R2 = Rx * Rx + Ry * Ry + Rz * Rz, X2 = X * X + Y * Y + Z * Z;
  const R = Math.sqrt(R2), Xm = Math.sqrt(X2);
  const R3 = R2 * R, X3 = X2 * Xm;
  // |R| - |X| = (2 X.x + x.x) / (|R| + |X|)
  const dR = (2 * (X * x + Y * y + Z * z) + x * x + y * y + z * z) / (R + Xm);
  // |R|^3 - |X|^3 = (|R| - |X|)(R^2 + R X + X^2)
  const d3 = dR * (R2 + R * Xm + X2);
  const f = d3 / (X3 * R3);
  out[0] = GM * (-x / X3 + Rx * f);
  out[1] = GM * (-y / X3 + Ry * f);
  out[2] = GM * (-z / X3 + Rz * f);
  return out;
}

// The J2 part of the tide: a_J2(X + x) - a_J2(X), added to out.
export function j2Accel(GM, Rp, J2, x, y, z, out) {
  const r2 = x * x + y * y + z * z, r = Math.sqrt(r2);
  const k = 1.5 * J2 * GM * Rp * Rp / (r2 * r2 * r), z2 = 5 * z * z / r2;
  out[0] = k * x * (z2 - 1); out[1] = k * y * (z2 - 1); out[2] = k * z * (z2 - 3);
  return out;
}
const _j2a = [0, 0, 0], _j2b = [0, 0, 0];
export function j2Diff(P, X, x, y, z, out) {
  j2Accel(P.GM, P.Rp, P.J2, X[0] + x, X[1] + y, X[2] + z, _j2a);
  j2Accel(P.GM, P.Rp, P.J2, X[0], X[1], X[2], _j2b);
  out[0] += _j2a[0] - _j2b[0]; out[1] += _j2a[1] - _j2b[1]; out[2] += _j2a[2] - _j2b[2];
  return out;
}

// ── reference orbit ───────────────────────────────────────────────────────
// The frame point X(t), V(t): f64 RK4 with the same planet as the grains,
// plus the linear drag of the spiral scenario (a = -kappa V).
export class RefOrbit {
  constructor(P, X, V) { this.P = P; this.X = X.slice(); this.V = V.slice(); this.t = 0; }
  acc(x, v, o) {
    primaryAccel(this.P, x[0], x[1], x[2], o);
    if (this.P.drag) { o[0] -= this.P.drag * v[0]; o[1] -= this.P.drag * v[1]; o[2] -= this.P.drag * v[2]; }
    return o;
  }
  step(dt) {
    const x = this.X, v = this.V, a = [0, 0, 0];
    const k1v = this.acc(x, v, [0, 0, 0]), k1x = v.slice();
    const x2 = x.map((q, i) => q + 0.5 * dt * k1x[i]), v2 = v.map((q, i) => q + 0.5 * dt * k1v[i]);
    const k2v = this.acc(x2, v2, [0, 0, 0]), k2x = v2;
    const x3 = x.map((q, i) => q + 0.5 * dt * k2x[i]), v3 = v.map((q, i) => q + 0.5 * dt * k2v[i]);
    const k3v = this.acc(x3, v3, [0, 0, 0]), k3x = v3;
    const x4 = x.map((q, i) => q + dt * k3x[i]), v4 = v.map((q, i) => q + dt * k3v[i]);
    const k4v = this.acc(x4, v4, a), k4x = v4;
    for (let i = 0; i < 3; i++) {
      x[i] += dt / 6 * (k1x[i] + 2 * k2x[i] + 2 * k3x[i] + k4x[i]);
      v[i] += dt / 6 * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]);
    }
    this.t += dt;
  }
}

// ── scenario build ────────────────────────────────────────────────────────
// planetFor(stats, spec): the planet for a settled pile. spec.q is
// rho_p/rho_s (rho_s measured on the pile), spec.s is R_s/R_p.
export function planetFor(st, spec) {
  const Rp = st.R / spec.s;
  const rhoP = spec.q * st.rho;
  const GM = G * rhoP * 4 / 3 * Math.PI * Rp ** 3;
  return { Rp, rhoP, rhoS: st.rho, GM, Mp: GM / G, J2: spec.J2 || 0, drag: spec.drag || 0 };
}
// The start state of the satellite centre. kind 'circular': distance d.
// kind 'flyby': pericentre q, eccentricity e (1 = parabolic), start at
// distance r0 on the way in. Returns { X, V, Omega } (Omega: the spin for a
// synchronous start, about +z).
export function orbitStart(P, spec) {
  if (spec.kind === 'flyby') {
    const q = spec.peri * P.Rp, e = spec.e, r0 = spec.r0 * P.Rp;
    const p = q * (1 + e);                          // semi-latus rectum
    // true anomaly at r0 on the way in (negative)
    const cnu = Math.min(1, Math.max(-1, (p / r0 - 1) / e));
    const nu = -Math.acos(cnu);
    const r = p / (1 + e * Math.cos(nu));
    const h = Math.sqrt(P.GM * p);
    const X = [r * Math.cos(nu), r * Math.sin(nu), 0];
    const vr = P.GM / h * e * Math.sin(nu), vt = h / r;
    const V = [vr * Math.cos(nu) - vt * Math.sin(nu), vr * Math.sin(nu) + vt * Math.cos(nu), 0];
    return { X, V, Omega: spec.spin || 0 };
  }
  const d = spec.d * P.Rp, vc = Math.sqrt(P.GM / d);
  return { X: [d, 0, 0], V: [0, vc, 0], Omega: vc / d };
}
// Move a settled pile (pos relative to its centre, at rest) onto the start
// state: positions stay relative to the frame point, velocities get the
// rigid spin Omega about z. The COM velocity lives in the frame (V).
export function placeOnOrbit(pos, vel, spin, mass, Omega) {
  const st = pileStats(pos, mass);
  const N = mass.length;
  for (let i = 0; i < N; i++) {
    const x = pos[3 * i] - st.com[0], y = pos[3 * i + 1] - st.com[1], z = pos[3 * i + 2] - st.com[2];
    pos[3 * i] = x; pos[3 * i + 1] = y; pos[3 * i + 2] = z;
    vel[3 * i] = -Omega * y; vel[3 * i + 1] = Omega * x; vel[3 * i + 2] = 0;
    spin[3 * i] = 0; spin[3 * i + 1] = 0; spin[3 * i + 2] = Omega;
  }
}

// ── CPU reference simulation ──────────────────────────────────────────────
// Same algorithm as the GPU (shaders/sim.wgsl), in f64. Used by the tests
// at low N, and to check the GPU forces.
export class CpuSim {
  constructor(N, rad, mass, C, P) {
    this.N = N; this.rad = Float64Array.from(rad); this.mass = Float64Array.from(mass);
    this.C = C; this.P = P;                // contact constants, planet (GM, Rp, J2, drag)
    this.x = new Float64Array(N * 3); this.v = new Float64Array(N * 3); this.w = new Float64Array(N * 3);
    this.aF = new Float64Array(N * 3); this.al = new Float64Array(N * 3); this.aG = new Float64Array(N * 3);
    this.aGp = new Float64Array(N * 3);   // gravity at the block before (extrapolation)
    this.fc = new Float64Array(N * 6);    // last contact force and torque (work ledger)
    this.phi = new Float64Array(N);       // self potential per unit mass
    this.work = new Float64Array(N);      // work done by contact forces and torques
    this.nbr = new Int32Array(N * NB).fill(-1); this.cnt = new Int32Array(N);
    this.xi = new Float64Array(N * NB * 3);
    this.tide = new Float64Array(N * 3);
    this.ref = [1e30, 0, 0];              // frame point X for the tide (GM 0: no planet)
    this.settleDrag = 0;
    this.overflow = 0;
  }
  buildNeighbors() {
    const { N, x, rad } = this;
    const cell = 2 * R_MAX + SKIN, inv = 1 / cell;
    const head = new Map();
    const key = (a, b, c) => `${a},${b},${c}`;
    for (let i = 0; i < N; i++) {
      if (this.mass[i] === 0) continue;
      const k = key(Math.floor(x[3 * i] * inv), Math.floor(x[3 * i + 1] * inv), Math.floor(x[3 * i + 2] * inv));
      let l = head.get(k); if (!l) head.set(k, l = []); l.push(i);
    }
    const nbr = new Int32Array(N * NB).fill(-1), cnt = new Int32Array(N), xi = new Float64Array(N * NB * 3);
    for (let i = 0; i < N; i++) {
      if (this.mass[i] === 0) continue;
      const ci = Math.floor(x[3 * i] * inv), cj = Math.floor(x[3 * i + 1] * inv), ck = Math.floor(x[3 * i + 2] * inv);
      let c = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
        const l = head.get(key(ci + a, cj + b, ck + d)); if (!l) continue;
        for (const j of l) {
          if (j === i) continue;
          const dx = x[3 * i] - x[3 * j], dy = x[3 * i + 1] - x[3 * j + 1], dz = x[3 * i + 2] - x[3 * j + 2];
          const s = rad[i] + rad[j] + SKIN;
          if (dx * dx + dy * dy + dz * dz >= s * s) continue;
          if (c >= NB) { this.overflow++; continue; }
          nbr[i * NB + c] = j;
          // copy the spring of this contact from the old list
          for (let o = 0; o < this.cnt[i]; o++) if (this.nbr[i * NB + o] === j) {
            for (let q = 0; q < 3; q++) xi[(i * NB + c) * 3 + q] = this.xi[(i * NB + o) * 3 + q];
            break;
          }
          c++;
        }
      }
      cnt[i] = c;
    }
    this.nbr = nbr; this.cnt = cnt; this.xi = xi;
  }
  // Contact forces and torques, the tide, the settle drag. dt is the step
  // for the spring update (0: evaluate without a spring update).
  fast(dt, frac = 0) {
    const { N, x, v, w, rad, mass, C, nbr, cnt, xi, aG, aGp, fc } = this;
    const t = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const o = 3 * i;
      let fx = 0, fy = 0, fz = 0, tx = 0, ty = 0, tz = 0, pw = 0;
      if (mass[i] === 0) { this.aF[o] = this.aF[o + 1] = this.aF[o + 2] = 0; this.al[o] = this.al[o + 1] = this.al[o + 2] = 0; continue; }
      const ri = rad[i], mi = mass[i];
      for (let s = 0; s < cnt[i]; s++) {
        const j = nbr[i * NB + s], q = (i * NB + s) * 3;
        const dx = x[o] - x[3 * j], dy = x[o + 1] - x[3 * j + 1], dz = x[o + 2] - x[3 * j + 2];
        const d2 = dx * dx + dy * dy + dz * dz, dist = Math.sqrt(d2), sr = ri + rad[j];
        const gap = dist - sr;
        const reach = C.coh > 0 ? C.cohGap : 0;
        if (gap >= reach) { xi[q] = xi[q + 1] = xi[q + 2] = 0; continue; }
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;
        let Fn = 0, Fx = 0, Fy = 0, Fz = 0;
        // cohesion: C while touching, falling linearly to 0 at a gap of
        // cohGap (shaders/sim.wgsl does the same)
        const coh = C.coh > 0 ? C.coh * Math.min(1, Math.max(0, 1 - gap / C.cohGap)) : 0;
        if (gap < 0) {
          const mj = mass[j], meff = mi * mj / (mi + mj);
          const delta = -gap;
          // lever arms to the middle of the overlap (a_i + a_j = |d|), so the
          // friction torques and the pair's orbital torque cancel exactly
          const ai = ri + 0.5 * gap, aj = rad[j] + 0.5 * gap;
          // relative velocity of the contact point: v_i - v_j - (a_i w_i + a_j w_j) x n
          const wx = ai * w[o] + aj * w[3 * j], wy = ai * w[o + 1] + aj * w[3 * j + 1], wz = ai * w[o + 2] + aj * w[3 * j + 2];
          const cxw = wy * nz - wz * ny, cyw = wz * nx - wx * nz, czw = wx * ny - wy * nx;
          const vx = v[o] - v[3 * j] - cxw, vy = v[o + 1] - v[3 * j + 1] - cyw, vz = v[o + 2] - v[3 * j + 2] - czw;
          const vn = vx * nx + vy * ny + vz * nz;
          const vtx = vx - vn * nx, vty = vy - vn * ny, vtz = vz - vn * nz;
          const gn = C.gnK * Math.sqrt(meff), gt = C.gtK * Math.sqrt(meff);
          Fn = Math.max(0, C.kn * delta - gn * vn);
          Fx = Fn * nx; Fy = Fn * ny; Fz = Fn * nz;
          if (C.mu > 0) {
            // rotate the spring into the tangent plane, keep its length
            let sx = xi[q], sy = xi[q + 1], sz = xi[q + 2];
            const l0 = Math.sqrt(sx * sx + sy * sy + sz * sz);
            const sn = sx * nx + sy * ny + sz * nz;
            sx -= sn * nx; sy -= sn * ny; sz -= sn * nz;
            const l1 = Math.sqrt(sx * sx + sy * sy + sz * sz);
            if (l1 > 1e-12) { const k = l0 / l1; sx *= k; sy *= k; sz *= k; }
            sx += vtx * dt; sy += vty * dt; sz += vtz * dt;
            let ftx = -C.kt * sx - gt * vtx, fty = -C.kt * sy - gt * vty, ftz = -C.kt * sz - gt * vtz;
            const ft = Math.sqrt(ftx * ftx + fty * fty + ftz * ftz), cap = C.mu * (Fn + coh);
            if (ft > cap) {
              const k = cap / ft; ftx *= k; fty *= k; ftz *= k;
              // sliding: the spring keeps the elastic part only (Luding 2008)
              sx = -(ftx + gt * vtx) / C.kt; sy = -(fty + gt * vty) / C.kt; sz = -(ftz + gt * vtz) / C.kt;
            }
            xi[q] = sx; xi[q + 1] = sy; xi[q + 2] = sz;
            Fx += ftx; Fy += fty; Fz += ftz;
            // torque on i: (-a_i n) x F_t
            tx += -ai * (ny * ftz - nz * fty); ty += -ai * (nz * ftx - nx * ftz); tz += -ai * (nx * fty - ny * ftx);
          }
          if (C.muR > 0) {
            const rx = w[o] - w[3 * j], ry = w[o + 1] - w[3 * j + 1], rz = w[o + 2] - w[3 * j + 2];
            const rn = rx * nx + ry * ny + rz * nz;
            const px = rx - rn * nx, py = ry - rn * ny, pz = rz - rn * nz;
            const pm = Math.sqrt(px * px + py * py + pz * pz + C.w0r * C.w0r);
            const k = -C.muR * (ri * rad[j] / sr) * Fn / pm;
            tx += k * px; ty += k * py; tz += k * pz;
          }
        }
        Fx -= coh * nx; Fy -= coh * ny; Fz -= coh * nz;
        fx += Fx; fy += Fy; fz += Fz;
      }
      const im = 1 / mi, iI = 1 / (0.4 * mi * ri * ri);
      // contact work over the step: trapezoid, displacement dt v_half
      const q6 = 6 * i;
      pw = (fx + fc[q6]) * v[o] + (fy + fc[q6 + 1]) * v[o + 1] + (fz + fc[q6 + 2]) * v[o + 2]
         + (tx + fc[q6 + 3]) * w[o] + (ty + fc[q6 + 4]) * w[o + 1] + (tz + fc[q6 + 5]) * w[o + 2];
      this.work[i] += 0.5 * pw * dt;
      fc[q6] = fx; fc[q6 + 1] = fy; fc[q6 + 2] = fz; fc[q6 + 3] = tx; fc[q6 + 4] = ty; fc[q6 + 5] = tz;
      let ax = fx * im + aG[o] + frac * (aG[o] - aGp[o]);
      let ay = fy * im + aG[o + 1] + frac * (aG[o + 1] - aGp[o + 1]);
      let az = fz * im + aG[o + 2] + frac * (aG[o + 2] - aGp[o + 2]);
      if (this.P.GM > 0) {
        tideAccel(this.P.GM, this.ref[0], this.ref[1], this.ref[2], x[o], x[o + 1], x[o + 2], t);
        if (this.P.J2) j2Diff(this.P, this.ref, x[o], x[o + 1], x[o + 2], t);
        this.tide[o] = t[0]; this.tide[o + 1] = t[1]; this.tide[o + 2] = t[2];
        ax += t[0]; ay += t[1]; az += t[2];
        if (this.P.drag) { ax -= this.P.drag * v[o]; ay -= this.P.drag * v[o + 1]; az -= this.P.drag * v[o + 2]; }
      }
      if (this.settleDrag) { ax -= this.settleDrag * v[o]; ay -= this.settleDrag * v[o + 1]; az -= this.settleDrag * v[o + 2]; }
      this.aF[o] = ax; this.aF[o + 1] = ay; this.aF[o + 2] = az;
      this.al[o] = tx * iI; this.al[o + 1] = ty * iI; this.al[o + 2] = tz * iI;
    }
  }
  // Newton for r >= SMIN, the linear field of a uniform sphere inside
  // (shaders/sim.wgsl cs_gravity and cs_potential use the same law).
  gravity() {
    const { N, x, mass } = this, S2 = SMIN * SMIN;
    for (let i = 0; i < N; i++) {
      let ax = 0, ay = 0, az = 0, ph = 0;
      const xi0 = x[3 * i], yi0 = x[3 * i + 1], zi0 = x[3 * i + 2];
      for (let j = 0; j < N; j++) {
        if (j === i || mass[j] === 0) continue;
        const dx = x[3 * j] - xi0, dy = x[3 * j + 1] - yi0, dz = x[3 * j + 2] - zi0;
        const r2 = dx * dx + dy * dy + dz * dz;
        let f, p;
        if (r2 >= S2) { const r = Math.sqrt(r2); f = mass[j] / (r2 * r); p = -mass[j] / r; }
        else { f = mass[j] / (S2 * SMIN); p = -mass[j] * (1.5 - 0.5 * r2 / S2) / SMIN; }
        ax += f * dx; ay += f * dy; az += f * dz; ph += p;
      }
      this.aG[3 * i] = G * ax; this.aG[3 * i + 1] = G * ay; this.aG[3 * i + 2] = G * az; this.phi[i] = G * ph;
    }
  }
  // Prepare: neighbours, gravity and fast forces at the start state.
  init(ref) {
    if (ref) { this.ref = ref.X.slice(); this.refV = ref.V.slice(); }
    this.buildNeighbors(); this.gravity(); this.aGp.set(this.aG); this.fast(0, 0);
  }
  // One block of K steps, then the gravity sum at the end positions (so
  // phi matches x for the energy). ref: a RefOrbit (stepped here) or null.
  // x, v and w are synchronous at the end of each step.
  block(dt, K = K_STEP, ref = null) {
    const { N, x, v, w, aF, al } = this;
    for (let s = 0; s < K; s++) {
      for (let i = 0; i < 3 * N; i++) { v[i] += 0.5 * dt * aF[i]; w[i] += 0.5 * dt * al[i]; x[i] += dt * v[i]; }
      if (ref) { ref.step(dt); this.ref = ref.X.slice(); this.refV = ref.V.slice(); }
      this.accrete();
      if ((s + 1) % KNL === 0) this.buildNeighbors();
      this.fast(dt, (s + 1) / K);
      for (let i = 0; i < 3 * N; i++) { v[i] += 0.5 * dt * aF[i]; w[i] += 0.5 * dt * al[i]; }
    }
    this.aGp.set(this.aG); this.gravity();
  }
  // Grains that hit the planet leave the simulation: mass 0, parked far
  // away. Their energy (orbit, spin and their share of the self potential)
  // goes into the work ledger, so E - W stays constant.
  accrete() {
    if (!(this.P.GM > 0)) return;
    const { N, x, v, w, mass, rad } = this, R2 = this.P.Rp * this.P.Rp;
    for (let i = 0; i < N; i++) {
      if (mass[i] === 0) continue;
      const o = 3 * i;
      const X = this.ref[0] + x[o], Y = this.ref[1] + x[o + 1], Z = this.ref[2] + x[o + 2];
      const r2 = X * X + Y * Y + Z * Z;
      if (r2 >= R2) continue;
      // v is the half-step velocity here. Moving it to the time of x
      // (v + dt/2 a) was tried: at N = 1500, d = 1.55 R_p, the ledger drift
      // after 2 orbits went from 5.4e-4 to 2.3e-3 |U_self|, so it stays
      const V = this.refV || [0, 0, 0];
      const vx = V[0] + v[o], vy = V[1] + v[o + 1], vz = V[2] + v[o + 2];
      const m = mass[i];
      const e = 0.5 * m * (vx * vx + vy * vy + vz * vz) + 0.2 * m * rad[i] * rad[i] * (w[o] ** 2 + w[o + 1] ** 2 + w[o + 2] ** 2)
        - this.P.GM * m / Math.sqrt(r2) + m * this.phi[i];
      this.work[i] -= e;
      mass[i] = 0; x[o] = x[o + 1] = x[o + 2] = PARK; v[o] = v[o + 1] = v[o + 2] = 0; w[o] = w[o + 1] = w[o + 2] = 0;
      this.accreted = (this.accreted || 0) + 1;
    }
  }
}

// ── energy and angular momentum (inertial planet frame) ───────────────────
// E = sum 1/2 m |V+v|^2 + 1/2 I w^2 - G M_p m/|X+x| + 1/2 sum m phi.
// ledger = E - W_contact: constant up to integration error when the drag is 0.
export function energyOf(x, v, w, rad, mass, phi, X, V, GM) {
  let K = 0, Kr = 0, Up = 0, Us = 0;
  const N = mass.length;
  const Lt = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const m = mass[i]; if (!m) continue;
    const vx = V[0] + v[3 * i], vy = V[1] + v[3 * i + 1], vz = V[2] + v[3 * i + 2];
    const rx = X[0] + x[3 * i], ry = X[1] + x[3 * i + 1], rz = X[2] + x[3 * i + 2];
    K += 0.5 * m * (vx * vx + vy * vy + vz * vz);
    const I = 0.4 * m * rad[i] * rad[i];
    Kr += 0.5 * I * (w[3 * i] ** 2 + w[3 * i + 1] ** 2 + w[3 * i + 2] ** 2);
    Up -= GM * m / Math.sqrt(rx * rx + ry * ry + rz * rz);
    Us += 0.5 * m * phi[i];
    Lt[0] += m * (ry * vz - rz * vy) + I * w[3 * i];
    Lt[1] += m * (rz * vx - rx * vz) + I * w[3 * i + 1];
    Lt[2] += m * (rx * vy - ry * vx) + I * w[3 * i + 2];
  }
  return { K, Kr, Up, Us, E: K + Kr + Up + Us, L: Lt };
}

// ── bound mass ────────────────────────────────────────────────────────────
// 1. friends-of-friends with a link of 1.1 (r_i + r_j) + 0.1: the largest
//    group of touching grains.
// 2. three passes: centre of mass and mass of the bound set, Hill radius
//    r_H = |X_c| (M_b / 3 M_p)^(1/3), then every grain inside r_H with
//    1/2 |v - v_c|^2 < G M_b / |x - x_c| is bound.
// pos, vel: arrays with stride `stride` (3 or 4). Returns the mask, the
// bound mass, its centre and velocity (frame), r_H and the group count.
export function analyzeBound(pos, vel, mass, rad, stride, X, GMp, N = mass.length) {
  const link = 2 * R_MAX * 1.1 + 0.1, inv = 1 / link;
  const parent = new Int32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  // a hashed grid: head/next chains
  const HS = 1 << Math.max(10, Math.ceil(Math.log2(N * 2)));
  const head = new Int32Array(HS).fill(-1), next = new Int32Array(N);
  const cx = new Int32Array(N), cy = new Int32Array(N), cz = new Int32Array(N);
  const hash = (a, b, c) => (((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0) & (HS - 1);
  for (let i = 0; i < N; i++) {
    if (!mass[i]) continue;
    const o = i * stride;
    cx[i] = Math.floor(pos[o] * inv); cy[i] = Math.floor(pos[o + 1] * inv); cz[i] = Math.floor(pos[o + 2] * inv);
    const h = hash(cx[i], cy[i], cz[i]); next[i] = head[h]; head[h] = i;
  }
  for (let i = 0; i < N; i++) {
    if (!mass[i]) continue;
    const o = i * stride;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      for (let j = head[hash(cx[i] + a, cy[i] + b, cz[i] + c)]; j >= 0; j = next[j]) {
        if (j <= i) continue;
        const p = j * stride;
        const dx = pos[o] - pos[p], dy = pos[o + 1] - pos[p + 1], dz = pos[o + 2] - pos[p + 2];
        const L = 1.1 * (rad[i] + rad[j]) + 0.1;
        if (dx * dx + dy * dy + dz * dz < L * L) { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj; }
      }
    }
  }
  const gm = new Float64Array(N);
  let best = -1, bestM = 0, groups = 0;
  for (let i = 0; i < N; i++) { if (!mass[i]) continue; const r = find(i); if (gm[r] === 0) groups++; gm[r] += mass[i]; }
  for (let i = 0; i < N; i++) if (gm[i] > bestM) { bestM = gm[i]; best = i; }
  const mask = new Uint8Array(N);
  if (best < 0) return { mask, M: 0, com: [0, 0, 0], vcm: [0, 0, 0], rH: 0, groups: 0, largest: 0 };
  for (let i = 0; i < N; i++) if (mass[i] && find(i) === best) mask[i] = 1;
  let M = 0, com = [0, 0, 0], vcm = [0, 0, 0], rH = 0;
  for (let pass = 0; pass < 3; pass++) {
    let m0 = 0; const c0 = [0, 0, 0], v0 = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      if (!mask[i]) continue;
      const m = mass[i], o = i * stride; m0 += m;
      for (let k = 0; k < 3; k++) { c0[k] += m * pos[o + k]; v0[k] += m * vel[o + k]; }
    }
    // a pass that keeps no grain ends the search; the last set stays
    if (!(m0 > 0)) { if (pass === 0) return { mask, M: 0, com: [0, 0, 0], vcm: [0, 0, 0], rH: 0, groups, largest: bestM }; break; }
    M = m0; for (let k = 0; k < 3; k++) { com[k] = c0[k] / M; vcm[k] = v0[k] / M; }
    const Xc = [X[0] + com[0], X[1] + com[1], X[2] + com[2]];
    const dc = Math.hypot(Xc[0], Xc[1], Xc[2]);
    rH = GMp > 0 ? dc * Math.cbrt(G * M / (3 * GMp)) : Infinity;
    const rH2 = rH * rH;
    for (let i = 0; i < N; i++) {
      if (!mass[i]) { mask[i] = 0; continue; }
      const o = i * stride;
      const dx = pos[o] - com[0], dy = pos[o + 1] - com[1], dz = pos[o + 2] - com[2];
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 > rH2) { mask[i] = 0; continue; }
      const ux = vel[o] - vcm[0], uy = vel[o + 1] - vcm[1], uz = vel[o + 2] - vcm[2];
      const r = Math.max(Math.sqrt(r2), rad[i]);
      mask[i] = 0.5 * (ux * ux + uy * uy + uz * uz) < G * M / r ? 1 : 0;
    }
  }
  M = 0; for (let i = 0; i < N; i++) if (mask[i]) M += mass[i];
  return { mask, M, com, vcm, rH, groups, largest: bestM };
}

// ── Kepler conic ──────────────────────────────────────────────────────────
// keplerPath(r, v, GM, tAhead, n): n points of the two-body path from the
// state (r, v) about a point mass at the origin, over tAhead. Ellipse and
// hyperbola from the elements, by the mean anomaly. Returns a Float64Array
// of n*3, and the elements.
export function keplerElements(r, v, GM) {
  const rm = Math.hypot(r[0], r[1], r[2]), v2 = v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
  const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  const rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
  const ev = [0, 1, 2].map(k => ((v2 - GM / rm) * r[k] - rv * v[k]) / GM);
  const e = Math.hypot(ev[0], ev[1], ev[2]);
  const en = v2 / 2 - GM / rm;
  const a = -GM / (2 * en);
  const hm = Math.hypot(h[0], h[1], h[2]);
  const p = hm * hm / GM;
  return { e, a, p, h, hm, ev, rp: p / (1 + e), en };
}
export function keplerPath(r, v, GM, tAhead, n) {
  const el = keplerElements(r, v, GM);
  const out = new Float64Array(n * 3);
  const rm = Math.hypot(r[0], r[1], r[2]);
  // perifocal frame: P toward pericentre, Q = h x P / |h|
  const hn = el.h.map(q => q / el.hm);
  let P = el.e > 1e-8 ? el.ev.map(q => q / el.e) : r.map(q => q / rm);
  const Q = [hn[1] * P[2] - hn[2] * P[1], hn[2] * P[0] - hn[0] * P[2], hn[0] * P[1] - hn[1] * P[0]];
  const cosnu = (r[0] * P[0] + r[1] * P[1] + r[2] * P[2]) / rm, sinnu = (r[0] * Q[0] + r[1] * Q[1] + r[2] * Q[2]) / rm;
  const nu0 = Math.atan2(sinnu, cosnu), e = el.e;
  const put = (k, nu) => {
    const rr = el.p / (1 + e * Math.cos(nu));
    const px = rr * Math.cos(nu), py = rr * Math.sin(nu);
    for (let c = 0; c < 3; c++) out[3 * k + c] = px * P[c] + py * Q[c];
  };
  if (e < 1 - 1e-6) {
    const nmot = Math.sqrt(GM / el.a ** 3);
    const E0 = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu0 / 2));
    const M0 = E0 - e * Math.sin(E0);
    for (let k = 0; k < n; k++) {
      const M = M0 + nmot * tAhead * k / (n - 1);
      let E = M; for (let it = 0; it < 30; it++) { const f = E - e * Math.sin(E) - M; E -= f / (1 - e * Math.cos(E)); if (Math.abs(f) < 1e-13) break; }
      put(k, 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)));
    }
  } else if (e > 1 + 1e-6) {
    const nmot = Math.sqrt(GM / (-el.a) ** 3);
    const H0 = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu0 / 2));
    const M0 = e * Math.sinh(H0) - H0;
    for (let k = 0; k < n; k++) {
      const M = M0 + nmot * tAhead * k / (n - 1);
      let H = Math.asinh(M / e); for (let it = 0; it < 50; it++) { const f = e * Math.sinh(H) - H - M; H -= f / (e * Math.cosh(H) - 1); if (Math.abs(f) < 1e-12) break; }
      put(k, 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(H / 2)));
    }
  } else {
    // parabola: Barker's equation
    const q = el.p / 2, nmot = Math.sqrt(GM / (2 * q ** 3));
    const D0 = Math.tan(nu0 / 2), M0 = D0 + D0 ** 3 / 3;
    for (let k = 0; k < n; k++) {
      const M = M0 + nmot * tAhead * k / (n - 1);
      const A = 1.5 * M, B = Math.cbrt(A + Math.sqrt(A * A + 1));
      put(k, 2 * Math.atan(B - 1 / B));
    }
  }
  return { pts: out, el };
}
export function orbitalPeriod(GM, a) { return 2 * Math.PI * Math.sqrt(a ** 3 / GM); }

// ============================================================================
//  PARTICLE COLLIDER  ·  physics.js — energy loss, cross sections, sampling
// ----------------------------------------------------------------------------
//  No DOM. The formulas follow the Geant4 Physics Reference Manual (PRM)
//  and the PDG review "Passage of particles through matter". This file is
//  an original JavaScript implementation of those formulas. It holds no
//  Geant4 source code and no Geant4 data table.
//
//  CONTINUOUS LOSS
//    bbHeavy ....... restricted Bethe-Bloch with the density effect, for
//                    mu, pi, K, p (no shell correction; below 2 MeV per
//                    nucleon mass the loss falls as sqrt(T), a Bragg peak
//                    stand-in). Muons add a radiative term b(Z) E.
//    bsElectron .... restricted Berger-Seltzer loss for e- (Moller) and e+
//                    (Bhabha), the PRM form with F-(tau, Delta), F+(tau, Delta)
//    bremLoss ...... restricted radiative loss under the photon cut kc,
//                    complete screening, times a low-energy factor
//  DISCRETE PROCESSES (cross sections per mm and samplers)
//    delta rays (heavy: spin 0 + spin 1/2 term; e-: Moller; e+: Bhabha),
//    bremsstrahlung, pair production, Compton (Klein-Nishina), photoelectric
//    (an empirical Z^4/A E^-3 fit), multiple scattering (Highland width,
//    Gaussian core and a single-scattering tail).
//  TABLES (Geant4 style)
//    buildTables(mat, cuts) tabulates dE/dx, range and the mean free paths
//    on a log grid (24 points per decade, 1 keV to 10 TeV); lookups
//    interpolate in ln T. rangeCut(mat, mm) turns a range cut into an
//    electron energy cut for this material, as Geant4 production cuts do.
//
//  GREP MAP
//    function bbHeavy / bsElectron / bremLoss / deltaXS / bremXS / pairXS
//    function comptonXS / photoXS / highland / sampleMsc / sampleLoss
//    function buildTables / rangeCut / class Table
// ============================================================================
import { ME, K_BB, RE, NA, delta } from './materials.js';

const LN10 = Math.LN10;
export const T_MIN = 1e-3, T_MAX = 1e7, PER_DEC = 24;
export const NBIN = Math.round(Math.log10(T_MAX / T_MIN) * PER_DEC) + 1;
const LT0 = Math.log(T_MIN), DLT = LN10 / PER_DEC;
export const gridT = i => Math.exp(LT0 + i * DLT);

// ── heavy charged particles ───────────────────────────────────────────────
// Restricted Bethe-Bloch, MeV/mm. M mass (MeV), z charge, T kinetic (MeV).
export function bbHeavy(m, M, z, T, Tcut = Infinity, rad = 0) {
  if (m.vac) return 0;
  const Tlow = 2 * M / 938.272;
  if (T < Tlow) return bbHeavy(m, M, z, Tlow, Tcut, 0) * Math.sqrt(T / Tlow);
  const g = 1 + T / M, b2 = 1 - 1 / (g * g), bg2 = g * g - 1, r = ME / M;
  const Wmax = 2 * ME * bg2 / (1 + 2 * g * r + r * r), Tup = Math.min(Tcut, Wmax);
  const x = 0.5 * Math.log10(bg2);
  const L = 0.5 * Math.log(2 * ME * bg2 * Tup / (m.I * m.I)) - 0.5 * b2 * (1 + Tup / Wmax) - 0.5 * delta(m, x);
  let dedx = K_BB * z * z * m.ZA / b2 * Math.max(L, 0.05);       // MeV cm2/g
  // muon radiative loss (bremsstrahlung, pairs, photonuclear) as b E,
  // b ~ 3.5e-6 cm2/g in iron, scaled by Z(Z+1)/A
  if (rad) dedx += 3.5e-6 * (m.zEff * (m.zEff + 1) / (m.ZA ? m.zEff / m.ZA : 1)) / (26 * 27 / 55.845) * (T + M);
  return dedx * m.rho / 10;
}
export function wmax(M, T) {
  const g = 1 + T / M, bg2 = g * g - 1, r = ME / M;
  return 2 * ME * bg2 / (1 + 2 * g * r + r * r);
}

// ── electrons and positrons ───────────────────────────────────────────────
export function bsElectron(m, T, Tcut = Infinity, positron = false) {
  if (m.vac) return 0;
  const tau = T / ME, g = tau + 1, bg2 = tau * (tau + 2), b2 = bg2 / (g * g);
  const Iu = m.I / ME;
  let D, F;
  if (!positron) {
    D = Math.min(Tcut / ME, tau / 2);
    F = -1 - b2 + Math.log((tau - D) * D) + tau / (tau - D) + (D * D / 2 + (2 * tau + 1) * Math.log(1 - D / tau)) / (g * g);
  } else {
    D = Math.min(Tcut / ME, tau);
    const y = 1 / (1 + g), D2 = D * D, D3 = D2 * D, D4 = D3 * D;
    F = Math.log(tau * D) - b2 / tau * (tau + 2 * D - 1.5 * D2 * y - (D - D3 / 3) * y * y - (D2 / 2 - tau * D3 / 3 + D4 / 4) * y * y * y);
  }
  const L = Math.log(2 * (tau + 2) / (Iu * Iu)) + F - delta(m, 0.5 * Math.log10(bg2));
  return 0.5 * K_BB * m.ZA / b2 * Math.max(L, 0.05) * m.rho / 10;
}

// Complete-screening bremsstrahlung, dsigma/dk ~ (4/3 - 4/3 y + y^2)/k.
// The low-energy factor scales it toward the radiative stopping power of
// the ESTAR tables (read off for lead: 0.55 at 1 MeV, 0.80 at 10 MeV,
// 0.95 at 100 MeV), where screening is not complete.
const LOWF = [[0, 0.55], [1, 0.80], [2, 0.95], [3, 0.99], [4, 1]];
function lowFactor(E) {
  const l = Math.log10(Math.max(1, E));
  for (let i = 1; i < LOWF.length; i++) if (l <= LOWF[i][0]) { const [a, fa] = LOWF[i - 1], [b, fb] = LOWF[i]; return fa + (fb - fa) * (l - a) / (b - a); }
  return 1;
}
export function bremLoss(m, T, kc) {
  if (m.vac) return 0;
  const E = T + ME, yc = Math.min(T, kc) / E;
  return E / m.X0 * (4 / 3 * yc - 2 / 3 * yc * yc + yc * yc * yc / 3) * lowFactor(E);
}
export function bremXS(m, T, kc) {             // per mm
  if (m.vac || T <= kc) return 0;
  const E = T + ME, r = kc / E, rt = T / E;      // photons from kc to T
  const s = 4 / 3 * Math.log(rt / r) - 4 / 3 * (rt - r) + (rt * rt - r * r) / 2;
  return Math.max(0, s) / m.X0 * lowFactor(E);
}

// ── delta rays ────────────────────────────────────────────────────────────
// heavy: spin 0 + spin 1/2 term; e-: Moller; e+: Bhabha. Per mm.
export function deltaXS(m, kind, M, T, Tcut) {
  if (m.vac) return 0;
  const pre = 0.5 * K_BB * m.ZA * m.rho / 10;   // (K/2) ZA rho, MeV/mm
  if (kind === 'e-' || kind === 'e+') {
    const g = 1 + T / ME, b2 = 1 - 1 / (g * g), x = Tcut / T;
    if (kind === 'e-') {
      if (x >= 0.5) return 0;
      const C1 = ((g - 1) / g) ** 2, C2 = (2 * g - 1) / (g * g);
      return pre / (b2 * T) * (C1 * (0.5 - x) + 1 / x - 1 / (1 - x) - C2 * Math.log((1 - x) / x));
    }
    if (x >= 1) return 0;
    const y = 1 / (g + 1), B1 = 2 - y * y, B2 = (1 - 2 * y) * (3 + y * y), B4 = (1 - 2 * y) ** 3, B3 = B4 + (1 - 2 * y) ** 2;
    return pre / T * ((1 / x - 1) / b2 - B1 * Math.log(1 / x) + B2 * (1 - x) - B3 * (1 - x * x) / 2 + B4 * (1 - x * x * x) / 3);
  }
  const Tm = wmax(M, T);
  if (Tcut >= Tm) return 0;
  const g = 1 + T / M, b2 = 1 - 1 / (g * g), E = T + M;
  return pre / b2 * ((1 / Tcut - 1 / Tm) - b2 / Tm * Math.log(Tm / Tcut) + (M > 100 ? (Tm - Tcut) / (2 * E * E) : 0));
}

// ── photons ───────────────────────────────────────────────────────────────
export function comptonXS(m, E) {              // per mm, Klein-Nishina
  if (m.vac) return 0;
  const k = E / ME, l = Math.log(1 + 2 * k);
  const s = 2 * Math.PI * RE * RE * ((1 + k) / (k * k) * (2 * (1 + k) / (1 + 2 * k) - l / k) + l / (2 * k) - (1 + 3 * k) / ((1 + 2 * k) ** 2));
  return s * NA * m.ZA * m.rho / 10;
}
export function pairXS(m, E) {                 // per mm
  if (m.vac || E <= 2 * ME) return 0;
  const L = Math.log(E / (2 * ME));
  return 7 / 9 / m.X0 * (1 - Math.exp(-0.13 * Math.pow(L, 1.75)));
}
export function photoXS(m, E) {                // per mm: mu/rho = 26.9 sum(w Z^4/A) / E_keV^3
  if (m.vac) return 0;
  const ek = E * 1000;
  return 26.9 * m.z4a / (ek * ek * ek) * m.rho / 10;
}

// ── multiple scattering ───────────────────────────────────────────────────
// Highland: theta0 = 13.6 MeV / (beta c p) z sqrt(x/X0) [1 + 0.038 ln(x z^2 / (X0 beta^2))]
export function highland(p, beta, x, X0, z = 1) {
  const t = x / X0;
  if (t <= 0) return 0;
  return 13.6 / (beta * p) * Math.abs(z) * Math.sqrt(t) * Math.max(0.2, 1 + 0.038 * Math.log(t * z * z / (beta * beta)));
}

// ── random helpers (rng() -> [0, 1)) ──────────────────────────────────────
export function gauss(rng) {
  let u = 0; while (u < 1e-300) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
export function gammaVar(rng, k) {             // Marsaglia-Tsang, mean k
  if (k < 1) return gammaVar(rng, k + 1) * Math.pow(rng() || 1e-12, 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v; do { x = gauss(rng); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// The step's mean loss with a Gamma-shaped fluctuation of Bohr variance:
// sigma^2 = (K/2) ZA rho x z^2 Tup (1 - beta^2/2) / beta^2. The delta rays
// above the cut give the Landau tail as separate tracks.
export function sampleLoss(rng, m, mean, x, beta2, Tup, z = 1) {
  if (mean <= 0) return 0;
  const s2 = 0.5 * K_BB * m.ZA * m.rho * (x / 10) * z * z * Tup * (1 - beta2 / 2) / beta2;
  if (s2 <= 0) return mean;
  const k = mean * mean / s2;
  if (k > 400) return Math.max(0, mean + Math.sqrt(s2) * gauss(rng));
  return gammaVar(rng, k) * s2 / mean;
}

// Plane angles of a multiple-scattering kick: a Gaussian core of width
// theta0 (98 %) and a single-scattering tail ~ 1/theta^3 beyond 2 theta0
// (2 %), as in the Urban-type models. Returns [thx, thy].
export function sampleMsc(rng, th0) {
  if (th0 <= 0) return [0, 0];
  if (rng() < 0.98) return [th0 * gauss(rng), th0 * gauss(rng)];
  const tmin = 2 * th0, tmax = Math.min(Math.PI, 50 * th0);
  const u = rng(), t = tmin / Math.sqrt(1 - u * (1 - (tmin / tmax) ** 2)), f = 2 * Math.PI * rng();
  return [t * Math.cos(f), t * Math.sin(f)];
}

// delta-ray energy from 1/T^2, with the spin-0 rejection (1 - beta^2 T/Tmax)
export function sampleDeltaHeavy(rng, M, T, Tcut) {
  const Tm = wmax(M, T), g = 1 + T / M, b2 = 1 - 1 / (g * g);
  for (let i = 0; i < 100; i++) {
    const u = rng(), Td = Tcut * Tm / (Tm - u * (Tm - Tcut));
    if (rng() < 1 - b2 * Td / Tm) return Td;
  }
  return Tcut;
}
export function sampleMoller(rng, T, Tcut) {
  const g = 1 + T / ME, C1 = ((g - 1) / g) ** 2, C2 = (2 * g - 1) / (g * g), x = Tcut / T;
  const G = e => 1 + C1 * e * e - C2 * e + (e / (1 - e)) ** 2 - C2 * e * e / (1 - e);
  const bound = Math.max(G(x), G(0.5), 1) * 1.05;
  for (let i = 0; i < 200; i++) {
    const u = rng(), e = x * 0.5 / (0.5 - u * (0.5 - x));
    if (rng() * bound < G(e)) return e * T;
  }
  return x * T;
}
export function sampleBhabha(rng, T, Tcut) {
  const g = 1 + T / ME, b2 = 1 - 1 / (g * g), y = 1 / (g + 1), B1 = 2 - y * y, B2 = (1 - 2 * y) * (3 + y * y), B4 = (1 - 2 * y) ** 3, B3 = B4 + (1 - 2 * y) ** 2, x = Tcut / T;
  const G = e => 1 / b2 - B1 * e + B2 * e * e - B3 * e * e * e + B4 * e * e * e * e;
  const bound = Math.max(G(x), G(1), 1 / b2) * 1.05;
  for (let i = 0; i < 200; i++) {
    const u = rng(), e = x / (1 - u * (1 - x));
    if (rng() * bound < G(e)) return e * T;
  }
  return x * T;
}
// bremsstrahlung photon energy, kc < k < T: proposal 1/k, accept (4/3 - 4/3 y + y^2)/(4/3)
export function sampleBremK(rng, T, kc) {
  const E = T + ME;
  for (let i = 0; i < 100; i++) {
    const k = kc * Math.pow(T / kc, rng()), y = k / E;
    if (rng() < (4 / 3 - 4 / 3 * y + y * y) / (4 / 3)) return k;
  }
  return kc;
}
// pair: the e- share of the total energy, from 1 - 4/3 eps (1 - eps)
export function samplePairEps(rng, Eg) {
  const e0 = ME / Eg;
  for (let i = 0; i < 100; i++) {
    const e = e0 + (1 - 2 * e0) * rng();
    if (rng() < 1 - 4 / 3 * e * (1 - e)) return e;
  }
  return 0.5;
}
// Compton: eps = E'/E from 1/eps + eps, rejection 1 - eps sin^2 / (1 + eps^2)
export function sampleCompton(rng, Eg) {
  const k = Eg / ME, e0 = 1 / (1 + 2 * k), a1 = -Math.log(e0), a2 = (1 - e0 * e0) / 2;
  for (let i = 0; i < 200; i++) {
    let e, e2;
    if (rng() * (a1 + a2) < a1) { e = Math.exp(-a1 * rng()); e2 = e * e; }
    else { e2 = e0 * e0 + (1 - e0 * e0) * rng(); e = Math.sqrt(e2); }
    const t = (1 - e) / (k * e), s2 = t * (2 - t);
    if (rng() < 1 - e * s2 / (1 + e2)) return [e, 1 - t];
  }
  return [1, 1];
}
// polar angle scale u of a brem photon or a pair lepton: theta = u m_e / E
export function sampleAngleU(rng) {
  const a = rng() < 9 / 36 ? 0.625 : 1.875;
  return -Math.log(Math.max(1e-12, rng() * rng())) / a;
}

// ── Geant4-style physics tables ───────────────────────────────────────────
export class Table {
  constructor(n = NBIN) { this.v = new Float64Array(n); }
  at(T) {
    const f = (Math.log(T) - LT0) / DLT;
    if (f <= 0) return this.v[0];
    const i = Math.min(NBIN - 2, Math.floor(f)), w = Math.min(1, f - i);
    return this.v[i] + (this.v[i + 1] - this.v[i]) * w;
  }
}
// range table from a dE/dx table; below T_MIN the loss goes as sqrt(T)
function rangeOf(dedx) {
  const R = new Table();
  R.v[0] = 2 * T_MIN / Math.max(1e-30, dedx.v[0]);
  for (let i = 1; i < NBIN; i++) {
    const a = gridT(i - 1), b = gridT(i), ia = 1 / Math.max(1e-30, dedx.v[i - 1]), ib = 1 / Math.max(1e-30, dedx.v[i]);
    // trapezoid in ln T: dR = integral T/dEdx dlnT
    R.v[i] = R.v[i - 1] + 0.5 * (a * ia + b * ib) * DLT;
  }
  return R;
}
// T at a given residual range (binary search, linear between nodes)
export function invRange(R, r) {
  if (r <= R.v[0]) return T_MIN * (r / R.v[0]) ** 2;
  let lo = 0, hi = NBIN - 1;
  if (r >= R.v[hi]) return T_MAX;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (R.v[mid] > r) hi = mid; else lo = mid; }
  const w = (r - R.v[lo]) / (R.v[hi] - R.v[lo]);
  return Math.exp(LT0 + (lo + w) * DLT);
}

// electron energy whose CSDA range in mat is rangeMm (Geant4 production cut)
export function rangeCut(m, rangeMm) {
  if (m.vac) return T_MAX;
  const d = new Table();
  for (let i = 0; i < NBIN; i++) { const T = gridT(i); d.v[i] = bsElectron(m, T) + bremLoss(m, T, T); }
  return invRange(rangeOf(d), rangeMm);
}

export const HEAVY = { mu: 105.6583755, pi: 139.57039, K: 493.677, p: 938.27208816 };
// cuts: { e: Tcut for delta rays (MeV), g: kc photon cut (MeV) }
export function buildTables(m, cuts) {
  const T = { mat: m, cuts, heavy: {} };
  const mk = f => { const t = new Table(); for (let i = 0; i < NBIN; i++) t.v[i] = f(gridT(i)); return t; };
  for (const [k, M] of Object.entries(HEAVY)) {
    const dedx = mk(t => bbHeavy(m, M, 1, t, cuts.e, k === 'mu'));
    T.heavy[k] = { M, dedx, range: rangeOf(dedx), lamD: mk(t => deltaXS(m, 'h', M, t, cuts.e)) };
  }
  for (const s of ['e-', 'e+']) {
    const ion = mk(t => bsElectron(m, t, cuts.e, s === 'e+')), br = mk(t => bremLoss(m, t, cuts.g));
    const dedx = new Table(); for (let i = 0; i < NBIN; i++) dedx.v[i] = ion.v[i] + br.v[i];
    T[s] = { ion, brem: br, dedx, range: rangeOf(dedx), xsD: mk(t => deltaXS(m, s, ME, t, cuts.e)), xsB: mk(t => bremXS(m, t, cuts.g)) };
  }
  T.gamma = { compt: mk(e => comptonXS(m, e)), pair: mk(e => pairXS(m, e)), phot: mk(e => photoXS(m, e)) };
  return T;
}

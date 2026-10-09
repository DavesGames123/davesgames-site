// ============================================================================
//  CIRCULAR RYDBERG  ·  physics.js — hydrogen-like circular states (no DOM)
// ----------------------------------------------------------------------------
//  A circular Rydberg state |nC> has l = |m| = n - 1. Its density is
//      |psi|^2 ~ r^(2n-2) e^(-2r/n) sin^(2n-2)(theta)
//  a thin torus of radius about n^2 a0. Atomic units: a0 = 1, hbar = 1,
//  m_e = 1, e = 1, c = 1/alpha.
//
//  The general radial function follows pages/hydrogen-table/physics.js
//  (R_nl with the Laguerre polynomial L^(2l+1)_(n-l-1)). This file keeps
//  the normalization in logs, so it works for n above 100, where the
//  factorials of hydrogen-table overflow. laguerre and legendre are
//  imported from that page.
//
//  Rates (zero field, hydrogen):
//      A(i -> j) = (4 w^3 / 3 c^3) |<j| r |i>|^2       state to state
//      Gamma_BBR = nbar(w, T) A                        Planck occupation
//  The capacitor model is the textbook one for a dipole midway between two
//  perfect parallel plates (Kleppner 1981), with a floor 1 - R for the
//  finite mirror reflectivity. The paper's own model (Pultinevicius et al.
//  2026) uses parabolic states in the 5.9 V/cm field and a finite-element
//  simulation of the real electrodes. This simpler model is illustrative.
//
//  GREP MAP
//    export const AU ............ unit constants
//    export function lfact ...... log n!
//    export function logRadial .. log |R_nl(r)| and its sign
//    export function radialMoment  <n'l'| r |nl> by quadrature
//    export function circularDipole  <n-1 C| r |n C>, closed form
//    export function meanR / sigmaR   <r> and the radial width of |nC>
//    export function freqHz ..... transition frequency n -> n'
//    export function nbar ....... Planck occupation number
//    export function xiPar / xiPerp   Purcell factors between plates
//    export function circularRates    every decay channel of |nC>
//    export function lifetime ... 1 / sum of the rates
//    export function cascade .... populations of the circular ladder
//    export function sampleCircular / sampleState   point clouds
// ============================================================================
import { laguerre, legendre } from '../hydrogen-table/physics.js';

export const AU = {
  t: 2.4188843265857e-17,    // s, atomic unit of time (CODATA 2018)
  c: 137.035999084,          // speed of light in atomic units (1/alpha)
  a0: 52.917721090e-12,      // m, Bohr radius
  hartreeHz: 6.579683920502e15, // Hz, hartree / h
  kBoverH: 2.083661912e10,   // Hz per K
  cSI: 299792458,
};

// log n! with a cache (n up to a few thousand)
const LF = [0];
export function lfact(n) {
  for (let k = LF.length; k <= n; k++) LF[k] = LF[k - 1] + Math.log(k);
  return LF[n];
}

// log|R_nl(r)| and the sign of R_nl(r). R = N rho^l e^(-rho/2) L(rho),
// rho = 2r/n, N^2 = (2/n)^3 (n-l-1)! / (2n (n+l)!).
export function logRadial(n, l, r) {
  const rho = 2 * r / n;
  const logN = 0.5 * (3 * Math.log(2 / n) + lfact(n - l - 1) - Math.log(2 * n) - lfact(n + l));
  const L = laguerre(n - l - 1, 2 * l + 1, rho);
  if (L === 0 || r <= 0) return { log: -Infinity, sign: 0 };
  return { log: logN + l * Math.log(rho) - rho / 2 + Math.log(Math.abs(L)), sign: Math.sign(L) };
}

// <n2 l2| r |n1 l1> = int R1 R2 r^3 dr, Simpson on a grid that covers both.
export function radialMoment(n1, l1, n2, l2, steps = 6000) {
  const rMax = 4 * Math.max(n1, n2) ** 2 + 40;
  const h = rMax / steps;
  let s = 0;
  for (let i = 1; i < steps; i++) {
    const r = i * h, a = logRadial(n1, l1, r), b = logRadial(n2, l2, r);
    if (!a.sign || !b.sign) continue;
    const v = a.sign * b.sign * Math.exp(a.log + b.log + 3 * Math.log(r));
    s += (i % 2 ? 4 : 2) * v;
  }
  return s * h / 3;
}

// <n-1 C| r |n C>: R_{n,n-1} = N_n r^(n-1) e^(-r/n), N_n^2 = (2/n)^(2n+1)/(2n)!
// so the integral is N_(n-1) N_n (2n)! / beta^(2n+1), beta = (2n-1)/(n(n-1)).
export function circularDipole(n) {
  const logN = k => 0.5 * ((2 * k + 1) * Math.log(2 / k) - lfact(2 * k));
  const beta = (2 * n - 1) / (n * (n - 1));
  return Math.exp(logN(n - 1) + logN(n) + lfact(2 * n) - (2 * n + 1) * Math.log(beta));
}

// <r> = n(n + 1/2) and the radial width sigma_r = n sqrt(2n+1) / 2 for l = n-1
export const meanR = n => n * (n + 0.5);
export const sigmaR = n => n * Math.sqrt(2 * n + 1) / 2;
// the polar width of sin^(2l) theta about the equator, about 1/sqrt(2l)
export const sigmaTheta = n => 1 / Math.sqrt(Math.max(1, 2 * (n - 1)));

export const energyHartree = n => -0.5 / (n * n);
// |frequency| of n -> n2 in Hz (hydrogen, infinite nuclear mass)
export const freqHz = (n, n2) => Math.abs(0.5 / (n * n) - 0.5 / (n2 * n2)) * AU.hartreeHz;
export const wavelengthM = (n, n2) => AU.cSI / freqHz(n, n2);

// Planck occupation number at frequency f (Hz) and temperature T (K)
export function nbar(f, T) {
  if (T <= 0) return 0;
  const x = f / (AU.kBoverH * T);
  return x > 700 ? 0 : 1 / Math.expm1(x);
}

// Purcell factors for a dipole midway between perfect plates at spacing d,
// x = 2d / lambda (Kleppner 1981). Parallel dipole (sigma light here):
// (3/(2x)) sum over odd k < x of (1 + k^2/x^2). Perpendicular (pi light):
// (3/x) [1/2 + sum over even k < x of (1 - k^2/x^2)].
export function xiPar(x, floor = 0) {
  let s = 0;
  for (let k = 1; k < x; k += 2) s += 1 + (k * k) / (x * x);
  return Math.max(floor, (3 / (2 * x)) * s);
}
export function xiPerp(x) {
  let s = 0.5;
  for (let k = 2; k < x; k += 2) s += 1 - (k * k) / (x * x);
  return (3 / x) * s;
}

// rate of one state-to-state dipole transition, s^-1
const rateSI = (fHz, r2) => {
  const w = 2 * Math.PI * fHz * AU.t;            // angular frequency, a.u.
  return (4 * w ** 3 / (3 * AU.c ** 3)) * r2 / AU.t;
};

const momentCache = new Map();
function moment(n1, l1, n2, l2) {
  const key = `${n1},${l1},${n2},${l2}`;
  if (!momentCache.has(key)) momentCache.set(key, n2 === n1 - 1 && l1 === n1 - 1 && l2 === n2 - 1 ? circularDipole(n1) : radialMoment(n1, l1, n2, l2));
  return momentCache.get(key);
}

// Every decay channel of |nC> (l = m = n-1) in zero field. opts:
//   T (K), cap: null (free space) or { d (m), R (mirror reflectivity) },
//   up: highest n' above n to include (default n + 3).
// Each channel: { to, kind: 'circ' | 'ell' | 'other', pol: 'sigma' | 'pi',
//   f (Hz), A (s^-1, spontaneous, state to state), rate (s^-1, with BBR
//   and Purcell), down (bool) }.
export function circularRates(n, { T = 300, cap = null, up = 3 } = {}) {
  const l = n - 1, out = [];
  const xi = (f, pol) => {
    if (!cap) return 1;
    const x = 2 * cap.d * f / AU.cSI;
    return pol === 'pi' ? xiPerp(x) : xiPar(x, 1 - (cap.R == null ? 0.96 : cap.R));
  };
  // down: only |n-1 C>, sigma (Delta m = -1)
  {
    const f = freqHz(n, n - 1), r = moment(n, l, n - 1, l - 1);
    const A = rateSI(f, r * r * l / (2 * l + 1));
    out.push({ to: n - 1, kind: 'circ', pol: 'sigma', f, A, rate: A * (1 + nbar(f, T)) * xi(f, 'sigma'), down: true });
  }
  // up: n' = n+1 .. n+up, to l' = n (three m') and to l' = n-2 (one m')
  for (let n2 = n + 1; n2 <= n + up; n2++) {
    const f = freqHz(n, n2), nb = nbar(f, T);
    const rUp = moment(n, l, n2, l + 1), r2 = rUp * rUp;
    const D = (2 * l + 1) * (2 * l + 3);
    const parts = [
      { kind: n2 === n + 1 ? 'circ' : 'ell', pol: 'sigma', ang: (l + 1) * (2 * l + 1) / D },  // m' = n   (circular when n' = n+1)
      { kind: 'ell', pol: 'pi', ang: (2 * l + 1) / D },                                   // m' = n-1
      { kind: 'ell', pol: 'sigma', ang: 1 / D },                                          // m' = n-2
    ];
    for (const p of parts) {
      const A = rateSI(f, r2 * p.ang);
      out.push({ to: n2, kind: p.kind, pol: p.pol, f, A, rate: A * nb * xi(f, p.pol), down: false });
    }
    if (l - 1 >= 0) {
      const rDn = moment(n, l, n2, l - 1), A = rateSI(f, rDn * rDn * l / (2 * l + 1));
      out.push({ to: n2, kind: 'other', pol: 'sigma', f, A, rate: A * nb * xi(f, 'sigma'), down: false });
    }
  }
  return out;
}
export const totalRate = (n, opts) => circularRates(n, opts).reduce((s, c) => s + c.rate, 0);
export const lifetime = (n, opts) => 1 / totalRate(n, opts);
// radiative lifetime at 0 K in free space: only |nC> -> |n-1 C>
export const radiativeLifetime = n => lifetime(n, { T: 0, up: 0 });

// Populations of the circular ladder around n0 against time (rate model).
// Circular states n0-W .. n0+W exchange population through the 'circ'
// channels; every other channel goes to one 'other' bin. Returns
// { ns, times, pops: [time][state], other: [time] }.
export function cascade(n0, { T = 300, cap = null, W = 5, tMax = 0.03, steps = 240 } = {}) {
  const ns = []; for (let n = n0 - W; n <= n0 + W; n++) ns.push(n);
  const idx = new Map(ns.map((n, i) => [n, i]));
  const ch = ns.map(n => circularRates(n, { T, cap, up: 2 }));
  let p = ns.map(n => (n === n0 ? 1 : 0)), other = 0;
  const times = [], pops = [], oth = [];
  const sub = 40, dt = tMax / steps / sub;
  for (let s = 0; s <= steps; s++) {
    times.push(s * tMax / steps); pops.push(p.slice()); oth.push(other);
    for (let k = 0; k < sub && s < steps; k++) {
      const q = p.slice();
      ns.forEach((n, i) => {
        if (!p[i]) return;
        for (const c of ch[i]) {
          const dp = p[i] * c.rate * dt;
          q[i] -= dp;
          if (c.kind === 'circ' && idx.has(c.to)) q[idx.get(c.to)] += dp; else other += dp;
        }
      });
      p = q;
    }
  }
  return { ns, times, pops, other: oth };
}

// ---------------------------------------------------------------- clouds
// Seeded random numbers (mulberry32), Gaussian, Gamma (Marsaglia-Tsang).
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = R => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); };
function gammaDraw(R, k) {
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = gauss(R); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = R();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// N points of |nC> in atomic units, as a Float32Array [x, y, z, phi, ...].
// The orbit lies in the x-y plane (z is the quantization axis).
// r ~ Gamma(2n+1, n/2); cos(theta) = 2B - 1 with B ~ Beta(n, n).
export function sampleCircular(n, N, seed = 1) {
  const R = rng(seed), out = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const r = gammaDraw(R, 2 * n + 1) * n / 2;
    const a = gammaDraw(R, n), b = gammaDraw(R, n), ct = 2 * a / (a + b) - 1, st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * R();
    out.set([r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct, ph], i * 4);
  }
  return out;
}

// N points of |n l m> (complex, |m| <= l) by Metropolis on |psi|^2 r^2 sin(theta).
export function sampleState(n, l, m, N, seed = 1) {
  if (l === n - 1 && Math.abs(m) === l) return sampleCircular(n, N, seed);
  const R = rng(seed), am = Math.abs(m);
  const logP = (r, ct) => {
    if (r <= 0 || ct <= -1 || ct >= 1) return -Infinity;
    const a = logRadial(n, l, r); if (!a.sign) return -Infinity;
    const P = legendre(l, am, ct);
    if (!P) return -Infinity;
    return 2 * a.log + 2 * Math.log(Math.abs(P)) + 2 * Math.log(r);
  };
  let r = meanR(n) * (1 - l * (l + 1) / (3 * n * n)), ct = 0.1, lp = logP(r, ct);
  const step = 0.6 * n * n / 2 + 1, burn = 400, thin = 6, out = new Float32Array(N * 4);
  for (let i = -burn, k = 0; k < N; i++) {
    const r2 = r + step * gauss(R) * 0.5, c2 = ct + 0.35 * gauss(R);
    const lp2 = logP(r2, c2);
    if (Math.log(R()) < lp2 - lp) { r = r2; ct = c2; lp = lp2; }
    if (i >= 0 && i % thin === 0) {
      const st = Math.sqrt(1 - ct * ct), ph = 2 * Math.PI * R();
      out.set([r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct, ph], k * 4); k++;
    }
  }
  return out;
}

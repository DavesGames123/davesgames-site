// ============================================================================
//  EXOTIC ATOMS  ·  states.js — point clouds and densities of each state
// ----------------------------------------------------------------------------
//  Every sampler returns a cloud { pts, dens, ext, ... } in scaled atomic
//  units of the species (a = 1):
//    pts   Float32Array [x, y, z, phi, ...]; z is the quantization axis,
//          phi is the azimuth (cloud.js colours the phase as m * phi)
//    dens  Float32Array, |psi|^2 at each point over the largest sample
//          value (the density floor control cuts on it)
//    ext   a radius that holds the cloud (for the camera)
//  and, for the field solver (bfield.js), an axisymmetric density
//  rhoz(rho, z) = |psi|^2 (any scale; bfield normalizes it) with its m.
//
//  The samplers are exact draws, not Metropolis chains:
//    |n l m>       inverse CDF of R^2 r^2 on a sqrt grid, times inverse
//                  CDF of |Theta|^2 sin(theta), times a uniform phi
//    |n n1 n2 m>   parabolic coordinates xi = r + z, eta = r - z; the
//                  volume element (xi + eta)/4 makes the density a sum of
//                  two separable parts, drawn as a mixture
//    grid states   trilobite, butterfly: |psi|^2 on an (r, cos theta)
//                  grid, cells drawn by CDF, jittered inside the cell
//    strong B      psi = exp(-sqrt(rho^2/a^2 + z^2/b^2)): a Gamma(3)
//                  radius on a stretched sphere
//    packets       points drawn from the incoherent mixture q = sum
//                  |c_n|^2 |psi_n|^2, then weighted by |psi(t)|^2 / q
//                  each frame (importance weights; see packet())
//
//  GREP MAP
//    export function sampleNLM ...... |n l m>
//    export function densityNLM ..... |psi_nlm|^2 (rho, z)
//    export function sampleParabolic  |n1 n2 m>, Stark states
//    export function densityParabolic
//    export function trilobite ...... ultralong-range molecule states
//    export function triloCurve ..... the Born-Oppenheimer curve U(R)
//    export function strongBState ... the variational strong-field state
//    export function packet ......... circular (Kepler) and radial packets
//    export function pairByAzimuth .. order two clouds for a morph
// ============================================================================
import { logRnl, logTheta, logLaguerre, rMaxOf, meanR, Rnl, lfact } from './physics.js';
import { rng, sampleCircular } from '../circular-rydberg/physics.js';

const TAU = 2 * Math.PI;
function gauss(R) { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * R()); }

// inverse-CDF table: x (grid), cdf (cumulative, last = 1)
function table(x, w) {
  const c = new Float64Array(w.length);
  let s = 0;
  for (let i = 0; i < w.length; i++) { s += w[i]; c[i] = s; }
  for (let i = 0; i < w.length; i++) c[i] /= s || 1;
  return { x, c, total: s };
}
// draw a cell index from a CDF table (binary search)
function pick(t, u) {
  let lo = 0, hi = t.c.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (t.c[mid] < u) lo = mid + 1; else hi = mid; }
  return lo;
}
// draw x from a piecewise-constant density on cells [x[i], x[i+1]]
const drawX = (t, R) => { const i = pick(t, R()); return t.x[i] + (t.x[i + 1] - t.x[i]) * R(); };

// radial table of |n l>: cells on a sqrt-spaced grid, weight R^2 r^2 dr
const radCache = new Map();
function radialTable(n, l) {
  const key = n * 1000 + l;
  if (radCache.has(key)) return radCache.get(key);
  const G = Math.min(12000, 1500 + 20 * (n - l)), rM = rMaxOf(n, l);
  const x = new Float64Array(G + 1), w = new Float64Array(G);
  for (let i = 0; i <= G; i++) { const u = i / G; x[i] = rM * u * u; }
  for (let i = 0; i < G; i++) {
    const r = 0.5 * (x[i] + x[i + 1]), v = logRnl(n, l, r);
    w[i] = v.sign ? Math.exp(2 * v.log + 2 * Math.log(r)) * (x[i + 1] - x[i]) : 0;
  }
  const t = table(x, w);
  if (radCache.size > 40) radCache.clear();
  radCache.set(key, t);
  return t;
}
// polar table of |Theta_lm|^2 over cos(theta) (dOmega = dc dphi)
const angCache = new Map();
function angularTable(l, m) {
  const key = l * 1000 + Math.abs(m);
  if (angCache.has(key)) return angCache.get(key);
  const G = Math.max(400, 6 * l), x = new Float64Array(G + 1), w = new Float64Array(G);
  for (let i = 0; i <= G; i++) x[i] = -1 + 2 * i / G;
  for (let i = 0; i < G; i++) { const v = logTheta(l, m, 0.5 * (x[i] + x[i + 1])); w[i] = v.sign ? Math.exp(2 * v.log) : 0; }
  const t = table(x, w);
  if (angCache.size > 80) angCache.clear();
  angCache.set(key, t);
  return t;
}

// log |psi_nlm|^2 at (r, cos theta)
export const logDensNLM = (n, l, m, r, c) => {
  const a = logRnl(n, l, r), b = logTheta(l, m, c);
  return a.sign && b.sign ? 2 * (a.log + b.log) : -Infinity;
};

// ---------------------------------------------------------------- |n l m>
export function sampleNLM(n, l, m, N, seed = 1) {
  const R = rng(seed), out = new Float32Array(N * 4), lg = new Float64Array(N);
  if (l === n - 1 && Math.abs(m) === l && n > 1) {
    // circular: exact Gamma/Beta draws from circular-rydberg
    const p = sampleCircular(n, N, seed);
    for (let i = 0; i < N; i++) {
      const x = p[i * 4], y = p[i * 4 + 1], z = p[i * 4 + 2], r = Math.hypot(x, y, z);
      lg[i] = logDensNLM(n, l, m, r, z / r);
    }
    out.set(p);
  } else {
    const rt = radialTable(n, l), at = angularTable(l, m);
    for (let i = 0; i < N; i++) {
      const r = drawX(rt, R), c = Math.max(-1, Math.min(1, drawX(at, R))), s = Math.sqrt(1 - c * c), ph = TAU * R();
      out[i * 4] = r * s * Math.cos(ph); out[i * 4 + 1] = r * s * Math.sin(ph); out[i * 4 + 2] = r * c; out[i * 4 + 3] = ph;
      lg[i] = logDensNLM(n, l, m, r, c);
    }
  }
  return { pts: out, dens: relDens(lg), ext: Math.min(rMaxOf(n, l), l === n - 1 ? meanR(n, l) + 3.4 * n * Math.sqrt(2 * n + 1) / 2 : 1.12 * rTurnish(n, l)), m, kind: 'nlm', n, l };
}
const rTurnish = (n, l) => n * n + n * Math.sqrt(Math.max(0, n * n - l * (l + 1)));
function relDens(lg) {
  let mx = -Infinity;
  for (const v of lg) if (v > mx) mx = v;
  const d = new Float32Array(lg.length);
  for (let i = 0; i < lg.length; i++) d[i] = Number.isFinite(lg[i]) ? Math.exp(lg[i] - mx) : 0;
  return d;
}
export function densityNLM(n, l, m) {
  return { m, ext: rMaxOf(n, l), f: (rho, z) => { const r = Math.hypot(rho, z); return r > 0 ? Math.exp(logDensNLM(n, l, m, r, z / r)) : 0; } };
}

// ---------------------------------------------------------------- parabolic
// psi = N e^{i m phi} f_{n1}(xi) f_{n2}(eta),
// f_k(x) = e^{-x/2n} (x/n)^{|m|/2} L^{|m|}_k(x/n),  n = n1 + n2 + |m| + 1.
const logF = (k, am, n, x) => {
  if (x <= 0) return am === 0 ? logLaguerre(k, 0, 0).log : -Infinity;
  const L = logLaguerre(k, am, x / n);
  return L.sign ? -x / (2 * n) + 0.5 * am * Math.log(x / n) + L.log : -Infinity;
};
function paraTables(k, am, n) {
  const G = 3000, xM = n * (4 * (k + am + 1) + 8 * Math.sqrt(k + am + 1) + 20);
  const x = new Float64Array(G + 1), w0 = new Float64Array(G), w1 = new Float64Array(G);
  for (let i = 0; i <= G; i++) { const u = i / G; x[i] = xM * u * u; }
  for (let i = 0; i < G; i++) {
    const xc = 0.5 * (x[i] + x[i + 1]), lf = logF(k, am, n, xc), dx = x[i + 1] - x[i];
    const v = Number.isFinite(lf) ? Math.exp(2 * lf) * dx : 0;
    w0[i] = v; w1[i] = v * xc;
  }
  return { g: table(x, w0), xg: table(x, w1) };
}
export function sampleParabolic(n1, n2, m, N, seed = 1) {
  const am = Math.abs(m), n = n1 + n2 + am + 1, R = rng(seed);
  const A = paraTables(n1, am, n), B = paraTables(n2, am, n);
  // p ~ xi g1 g2 + eta g1 g2: mixture weights int(xi g1) int(g2) : int(g1) int(eta g2)
  const wA = A.xg.total * B.g.total, wB = A.g.total * B.xg.total, pA = wA / (wA + wB);
  const out = new Float32Array(N * 4), lg = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const first = R() < pA;
    const xi = drawX(first ? A.xg : A.g, R), eta = drawX(first ? B.g : B.xg, R);
    const z = (xi - eta) / 2, rho = Math.sqrt(Math.max(0, xi * eta)), ph = TAU * R();
    out[i * 4] = rho * Math.cos(ph); out[i * 4 + 1] = rho * Math.sin(ph); out[i * 4 + 2] = z; out[i * 4 + 3] = ph;
    lg[i] = 2 * (logF(n1, am, n, xi) + logF(n2, am, n, eta));
  }
  return { pts: out, dens: relDens(lg), ext: n * n * 2.2 + 4 * n, m, kind: 'para', n, n1, n2 };
}
export function densityParabolic(n1, n2, m) {
  const am = Math.abs(m), n = n1 + n2 + am + 1;
  return { m, ext: n * n * 2.4 + 6 * n, f: (rho, z) => { const r = Math.hypot(rho, z), xi = r + z, eta = r - z; const v = logF(n1, am, n, xi) + logF(n2, am, n, eta); return Number.isFinite(v) ? Math.exp(2 * v) : 0; } };
}

// ---------------------------------------------------------------- grid states
// sample an axisymmetric |psi|^2 given on an (r, c = cos theta) grid
function sampleGrid(rg, cg, F, N, seed, gamma = 1) {
  const Nr = rg.length - 1, Nc = cg.length - 1, w = new Float64Array(Nr * Nc);
  let mx = 0;
  for (let i = 0; i < Nr; i++) {
    const r = 0.5 * (rg[i] + rg[i + 1]), dr = rg[i + 1] - rg[i];
    for (let j = 0; j < Nc; j++) { const v = gamma === 1 ? F[i * Nc + j] : Math.pow(F[i * Nc + j], gamma); mx = Math.max(mx, v); w[i * Nc + j] = v * r * r * dr * (cg[j + 1] - cg[j]); }
  }
  const t = table(null, w), R = rng(seed), out = new Float32Array(N * 4), dens = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const id = pick(t, R()), i = (id / Nc) | 0, j = id % Nc;
    const r = rg[i] + (rg[i + 1] - rg[i]) * R(), c = cg[j] + (cg[j + 1] - cg[j]) * R(), s = Math.sqrt(Math.max(0, 1 - c * c)), ph = TAU * R();
    out[k * 4] = r * s * Math.cos(ph); out[k * 4 + 1] = r * s * Math.sin(ph); out[k * 4 + 2] = r * c; out[k * 4 + 3] = ph;
    dens[k] = mx > 0 ? (gamma === 1 ? F[i * Nc + j] : Math.pow(F[i * Nc + j], gamma)) / mx : 0;
  }
  return { pts: out, dens };
}
// bilinear lookup of a grid density at (rho, z)
function gridLookup(rg, cg, F) {
  const Nr = rg.length - 1, Nc = cg.length - 1, rM = rg[Nr];
  return (rho, z) => {
    const r = Math.hypot(rho, z); if (r >= rM) return 0;
    const c = r > 0 ? z / r : 1;
    // the r grid is sqrt-spaced: u = sqrt(r / rM)
    const ui = Math.sqrt(r / rM) * Nr - 0.5, ci = (c + 1) / 2 * Nc - 0.5;
    const i = Math.max(0, Math.min(Nr - 1, Math.round(ui))), j = Math.max(0, Math.min(Nc - 1, Math.round(ci)));
    return F[i * Nc + j];
  };
}

// Ultralong-range Rydberg molecule (Greene, Dickinson & Sadeghpour 2000).
// A ground-state atom at z = R scatters the Rydberg electron through the
// Fermi pseudopotential 2 pi a_s delta(r - R). Inside the degenerate
// manifold of n (l >= lmin), the bound state is the projection of the
// delta function onto that manifold:
//   trilobite  psi(r) ~ sum_l R_nl(R) R_nl(r) (2l+1)/(4 pi) P_l(cos theta)
//   butterfly  psi(r) ~ sum_l R'_nl(R) R_nl(r) (2l+1)/(4 pi) P_l(cos theta)
// (the butterfly is the radial-gradient p-wave state of Hamilton, Greene &
// Sadeghpour 2002). Only m = 0 terms survive for a perturber on the axis.
export function trilobite(n, Rp, { kind = 'trilobite', lmin = 3, Nr = 420, Nc = 260 } = {}) {
  const rM = 2 * n * n + 8 * n + 20, rg = new Float64Array(Nr + 1), cg = new Float64Array(Nc + 1);
  for (let i = 0; i <= Nr; i++) { const u = i / Nr; rg[i] = rM * u * u; }
  for (let j = 0; j <= Nc; j++) cg[j] = -1 + 2 * j / Nc;
  const L = [];
  for (let l = lmin; l < n; l++) L.push(l);
  // coefficients
  const coef = L.map(l => {
    const v = kind === 'butterfly' ? (Rnl(n, l, Rp * 1.0005) - Rnl(n, l, Rp * 0.9995)) / (Rp * 0.001) : Rnl(n, l, Rp);
    return v * (2 * l + 1) / (4 * Math.PI);
  });
  const rc = new Float64Array(Nr), cc = new Float64Array(Nc);
  for (let i = 0; i < Nr; i++) rc[i] = 0.5 * (rg[i] + rg[i + 1]);
  for (let j = 0; j < Nc; j++) cc[j] = 0.5 * (cg[j] + cg[j + 1]);
  // P_l(c) for every l up to n-1 on the c grid
  const P = new Float64Array(n * Nc);
  for (let j = 0; j < Nc; j++) {
    const x = cc[j]; let p0 = 1, p1 = x; P[j] = 1; if (n > 1) P[Nc + j] = x;
    for (let l = 2; l < n; l++) { const t = ((2 * l - 1) * x * p1 - (l - 1) * p0) / l; p0 = p1; p1 = t; P[l * Nc + j] = t; }
  }
  const psi = new Float64Array(Nr * Nc);
  L.forEach((l, k) => {
    if (!coef[k]) return;
    for (let i = 0; i < Nr; i++) {
      const a = coef[k] * Rnl(n, l, rc[i]);
      if (!a) continue;
      const row = i * Nc, pl = l * Nc;
      for (let j = 0; j < Nc; j++) psi[row + j] += a * P[pl + j];
    }
  });
  const F = new Float64Array(Nr * Nc);
  let s = 0;
  for (let i = 0; i < Nr; i++) for (let j = 0; j < Nc; j++) { const v = psi[i * Nc + j] ** 2; F[i * Nc + j] = v; s += v * rc[i] * rc[i] * (rg[i + 1] - rg[i]) * (cg[j + 1] - cg[j]) * TAU; }
  for (let i = 0; i < F.length; i++) F[i] /= s || 1;
  // dipole <z> of the electron (the ion sits at the origin)
  let dz = 0;
  for (let i = 0; i < Nr; i++) for (let j = 0; j < Nc; j++) dz += F[i * Nc + j] * rc[i] * cc[j] * rc[i] * rc[i] * (rg[i + 1] - rg[i]) * (cg[j + 1] - cg[j]) * TAU;
  return {
    n, R: Rp, kind, lmin, rg, cg, F, psi, Nr, Nc, dipole: dz, ext: rM * 0.95,
    // gamma < 1 draws from |psi|^(2 gamma): the page uses 1/2 so the
    // ridges far from the perturber show next to its bright lump
    sample: (N, seed = 1, gamma = 1) => Object.assign(sampleGrid(rg, cg, F, N, seed, gamma), { ext: Rp * 1.3, m: 0, kind, gamma }),
    rhoz: { m: 0, ext: rM, f: gridLookup(rg, cg, F) },
  };
}
// The molecular potential in the degenerate manifold (first order):
//   U(R) = 2 pi a_s sum_l (2l+1)/(4 pi) R_nl(R)^2   (a.u.)
// a_s < 0 (the triplet e-Rb scattering length is about -16 a0) makes the
// wells at the maxima of the sum. Returns { R, U } sampled on (0, rMax).
export function triloCurve(n, { lmin = 3, as = -16.1, pts = 1200 } = {}) {
  const rM = 2 * n * n + 6 * n, R = new Float64Array(pts), U = new Float64Array(pts);
  for (let i = 0; i < pts; i++) {
    const r = rM * (i + 0.5) / pts; let s = 0;
    for (let l = lmin; l < n; l++) { const v = Rnl(n, l, r); s += (2 * l + 1) / (4 * Math.PI) * v * v; }
    R[i] = r; U[i] = 2 * Math.PI * as * s;
  }
  return { R, U };
}
// the outermost well of U(R): the default perturber distance
export function outerWell(n, lmin = 3) {
  const { R, U } = triloCurve(n, { lmin, pts: 1600 });
  for (let i = U.length - 2; i > 0; i--) if (U[i] < U[i - 1] && U[i] <= U[i + 1] && U[i] < 0.02 * Math.min(...U)) return R[i];
  return 1.8 * n * n;
}

// ---------------------------------------------------------------- strong B
// the variational state of physics.js strongB, drawn from a grid
const sbDens = st => (rho, z) => Math.exp(-2 * (rho * rho / (4 * st.s * st.s) + Math.sqrt(rho * rho / (st.a * st.a) + z * z / (st.b * st.b))));
export function strongBState(st, N, seed = 1) {
  const ext = 4.2 * Math.max(st.zRms, st.rhoRms), Nr = 260, Nc = 260, rg = new Float64Array(Nr + 1), cg = new Float64Array(Nc + 1), F = new Float64Array(Nr * Nc), f = sbDens(st);
  for (let i = 0; i <= Nr; i++) rg[i] = ext * (i / Nr) ** 2;
  for (let j = 0; j <= Nc; j++) cg[j] = -1 + 2 * j / Nc;
  for (let i = 0; i < Nr; i++) for (let j = 0; j < Nc; j++) { const r = 0.5 * (rg[i] + rg[i + 1]), c = 0.5 * (cg[j] + cg[j + 1]); F[i * Nc + j] = f(r * Math.sqrt(1 - c * c), r * c); }
  return Object.assign(sampleGrid(rg, cg, F, N, seed), { ext: ext * 0.75, m: 0, kind: 'strongB' });
}
export const densityStrongB = st => ({ m: 0, ext: 4.5 * Math.max(st.zRms, st.rhoRms), f: sbDens(st) });

// ---------------------------------------------------------------- packets
// A coherent sum psi(t) = sum_n c_n psi_n e^{-i E_n t}, c_n Gaussian in n
// about n0 with width sig. kind 'circular': psi_n = |n, n-1, n-1> (a
// Kepler packet that goes round the ring, spreads, and revives at
// T_rev = (2 n0 / 3) T_K); kind 'radial': psi_n = |n, l, 0> (it breathes
// in and out at the Kepler period T_K = 2 pi n0^3).
// Points come from q = sum |c_n|^2 |psi_n|^2 (normalized); the weight of a
// point at time t is |psi(t)|^2 / q, so the weighted cloud is |psi(t)|^2.
// update(t) writes the weights (mean 1) and the phase arg psi into pts[3].
export function packet(kind, n0, sig, N, seed = 1, l = 1) {
  const R = rng(seed), K = Math.max(1, Math.ceil(2.6 * sig));
  const ns = [], c = [];
  for (let n = n0 - K; n <= n0 + K; n++) { if (n < (kind === 'circular' ? 2 : l + 1)) continue; ns.push(n); c.push(Math.exp(-((n - n0) ** 2) / (4 * sig * sig))); }
  const cn = Math.hypot(...c); for (let i = 0; i < c.length; i++) c[i] /= cn;
  const M = ns.length, amp = new Float32Array(N * M), ph = new Float32Array(N * M), q = new Float64Array(N);
  const pts = new Float32Array(N * 4);
  // draw: pick a component by |c|^2, then a point of that component
  const cum = []; let s = 0; for (const v of c) { s += v * v; cum.push(s); }
  const per = ns.map((n, k) => kind === 'circular' ? null : sampleNLM(n, l, 0, Math.ceil(N * c[k] * c[k] * 1.3) + 20, seed + 31 * k));
  const used = new Array(M).fill(0);
  for (let i = 0; i < N; i++) {
    const u = R(); let k = 0; while (k < M - 1 && cum[k] < u) k++;
    let x, y, z;
    if (kind === 'circular') {
      const n = ns[k], p = sampleCircular(n, 1, (seed * 7919 + i * 31 + 1) >>> 0); x = p[0]; y = p[1]; z = p[2];
    } else {
      const src = per[k], j = used[k]++ % (src.pts.length / 4); x = src.pts[j * 4]; y = src.pts[j * 4 + 1]; z = src.pts[j * 4 + 2];
    }
    pts[i * 4] = x; pts[i * 4 + 1] = y; pts[i * 4 + 2] = z; pts[i * 4 + 3] = Math.atan2(y, x);
    const r = Math.hypot(x, y, z), cth = r > 0 ? z / r : 1, phi = Math.atan2(y, x);
    let qq = 0;
    for (let kk = 0; kk < M; kk++) {
      const n = ns[kk], ll = kind === 'circular' ? n - 1 : l, mm = kind === 'circular' ? n - 1 : 0;
      const lg = logRnl(n, ll, r), th = logTheta(ll, mm, cth);
      const a = lg.sign && th.sign ? lg.sign * th.sign * Math.exp(lg.log + th.log) : 0;
      amp[i * M + kk] = a * c[kk]; ph[i * M + kk] = mm * phi;
      qq += c[kk] * c[kk] * a * a;
    }
    q[i] = qq;
  }
  const E = ns.map(n => -0.5 / (n * n));
  const w = new Float32Array(N), dens = new Float32Array(N);
  const TK = TAU * n0 ** 3, Trev = (2 * n0 / 3) * TK;
  function update(t) {
    let mx = 0;
    for (let i = 0; i < N; i++) {
      let re = 0, im = 0;
      for (let k = 0; k < M; k++) { const a = amp[i * M + k], p = ph[i * M + k] - E[k] * t; re += a * Math.cos(p); im += a * Math.sin(p); }
      const p2 = re * re + im * im;
      w[i] = q[i] > 0 ? p2 / q[i] : 0; dens[i] = p2; if (p2 > mx) mx = p2;
      pts[i * 4 + 3] = Math.atan2(im, re);
    }
    for (let i = 0; i < N; i++) dens[i] /= mx || 1;
    return w;
  }
  update(0);
  const nMax = ns[M - 1];
  return { pts, dens, w, update, ns, c, E, TK, Trev, kind, n0, sig, m: kind === 'circular' ? n0 - 1 : 0, ext: kind === 'circular' ? meanR(nMax, nMax - 1) * 1.35 : 2.1 * nMax * nMax,
    // complex psi and its gradient at a sample point, for the current
    // (used by bfield.js for the circular packet): returns [|psi|^2, jx, jy, jz]
    current(i, t) {
      const x = pts[i * 4], y = pts[i * 4 + 1], z = pts[i * 4 + 2], r = Math.hypot(x, y, z), rho = Math.hypot(x, y);
      if (kind !== 'circular' || rho < 1e-9) return [0, 0, 0, 0];
      let re = 0, im = 0, gr_re = 0, gr_im = 0, gt_re = 0, gt_im = 0;
      const cth = z / r, sth = rho / r;
      for (let k = 0; k < M; k++) {
        const n = ns[k], ll = n - 1, a = amp[i * M + k], p = ph[i * M + k] - E[k] * t, cr = a * Math.cos(p), ci = a * Math.sin(p);
        re += cr; im += ci;
        // d/dr: (l/r - 1/n), d/dtheta / r: l cot(theta) / r, phi: i l / rho
        const fr = ll / r - 1 / n, ft = ll * cth / (sth * r);
        gr_re += cr * fr; gr_im += ci * fr; gt_re += cr * ft; gt_im += ci * ft;
      }
      // j = Im(psi* grad psi); the azimuthal gradient of psi_l is i l psi_l / rho
      let gp_re = 0, gp_im = 0;
      for (let k = 0; k < M; k++) { const ll = ns[k] - 1, a = amp[i * M + k], p = ph[i * M + k] - E[k] * t; gp_re += -ll * a * Math.sin(p) / rho; gp_im += ll * a * Math.cos(p) / rho; }
      const jr = re * gr_im - im * gr_re, jt = re * gt_im - im * gt_re, jp = re * gp_im - im * gp_re;
      const cp = x / rho, sp = y / rho;
      // spherical unit vectors -> cartesian
      const jx = jr * sth * cp + jt * cth * cp - jp * sp, jy = jr * sth * sp + jt * cth * sp + jp * cp, jz = jr * cth - jt * sth;
      return [re * re + im * im, jx, jy, jz];
    },
    q,
  };
}

// order the points of a cloud by azimuth, so a morph between two clouds
// turns instead of scrambling (after pages/circular-rydberg)
export function pairByAzimuth(c) {
  const n = c.pts.length / 4, idx = [...Array(n).keys()].sort((i, j) => Math.atan2(c.pts[i * 4 + 1], c.pts[i * 4]) - Math.atan2(c.pts[j * 4 + 1], c.pts[j * 4]));
  const o = new Float32Array(c.pts.length), d = new Float32Array(n);
  idx.forEach((s, k) => { o.set(c.pts.subarray(s * 4, s * 4 + 4), k * 4); d[k] = c.dens[s]; });
  return Object.assign({}, c, { pts: o, dens: d });
}
export { lfact };

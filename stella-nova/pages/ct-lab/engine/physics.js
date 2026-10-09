// physics.js - X-ray physics for the CT engine.
// Beer-Lambert transmission, Poisson photon noise, a simple tube spectrum,
// polychromatic projection over three basis materials (beam hardening, metal),
// detector gain errors and dead elements (ring artefacts), motion, and simulateScan.
//
// grep handles:
//   MATERIALS, COMPOSITIONS, muAt, muOfComposition, spectrum, transmit, poissonNoise,
//   toLineIntegral, polychromaticSinogram, detectorDefects, simulateScan, mulberry32

import { forwardProject } from './project.js';

// Linear attenuation coefficients (1/cm) at nominal density, from approximate
// NIST XCOM mass attenuation values (total with coherent). Basis materials only.
const KEV = [20, 30, 40, 50, 60, 80, 100, 150];
export const MATERIALS = {
  water: { density: 1.0, keV: KEV, mu: [0.810, 0.376, 0.268, 0.227, 0.206, 0.184, 0.171, 0.150] },
  bone: { density: 1.92, keV: KEV, mu: [4.001, 1.331, 0.6655, 0.4242, 0.3148, 0.2229, 0.1855, 0.1480].map((v) => v * 1.92) },
  iron: { density: 7.874, keV: KEV, mu: [25.68, 8.176, 3.629, 1.958, 1.205, 0.5952, 0.3717, 0.1964].map((v) => v * 7.874) },
};
export const BASIS = ['water', 'bone', 'iron'];

// Each named material is a mix of basis densities [water, bone, iron] (fractions of nominal density).
// The mixes are coarse stand-ins chosen for legible contrast, not exact chemistry.
export const COMPOSITIONS = {
  air: [0, 0, 0], lung: [0.26, 0, 0], fat: [0.92, 0, 0], soft: [1.04, 0, 0], muscle: [1.05, 0, 0],
  gray: [1.04, 0, 0], white: [1.028, 0, 0], csf: [1.0, 0, 0], water: [1, 0, 0], blood: [1.06, 0, 0],
  bleed: [1.085, 0, 0], infarct: [0.99, 0, 0], bone: [0, 1, 0], spongy: [0.75, 0.3, 0], enamel: [0, 1.4, 0],
  plastic: [1.18, 0, 0], rubber: [1.3, 0, 0], fabric: [0.22, 0, 0], paper: [0.8, 0, 0], wood: [0.55, 0, 0],
  glass: [0, 1.25, 0], aluminium: [0, 1.28, 0], titanium: [0, 0, 0.38], steel: [0, 0, 1.0], copper: [0, 0, 1.12],
  shell: [1.15, 0.12, 0], kernel: [0.68, 0, 0], pith: [0.35, 0, 0],
};

function interpLogLog(xs, ys, x) {
  if (x <= xs[0]) return ys[0] * Math.pow(x / xs[0], Math.log(ys[1] / ys[0]) / Math.log(xs[1] / xs[0]));
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = Math.log(x / xs[i - 1]) / Math.log(xs[i] / xs[i - 1]);
      return Math.exp(Math.log(ys[i - 1]) + t * (Math.log(ys[i]) - Math.log(ys[i - 1])));
    }
  }
  const n = xs.length;
  return ys[n - 1] * Math.pow(x / xs[n - 1], Math.log(ys[n - 1] / ys[n - 2]) / Math.log(xs[n - 1] / xs[n - 2]));
}

export function muAt(material, keV) {
  const m = MATERIALS[material];
  return interpLogLog(m.keV, m.mu, keV);
}

export function muOfComposition(comp, keV = 70) {
  if (typeof comp === 'string') comp = COMPOSITIONS[comp];
  return comp[0] * muAt('water', keV) + comp[1] * muAt('bone', keV) + comp[2] * muAt('iron', keV);
}

// Kramers bremsstrahlung (w ~ (kVp - E)) with Al filtration. Returns normalised weights.
export function spectrum(kVp = 120, o = {}) {
  const bins = o.bins ?? 24, filt = (o.filterMmAl ?? 2.5) / 10; // cm Al
  const e0 = 15, keV = [], w = [];
  let sum = 0;
  for (let k = 0; k < bins; k++) {
    const E = e0 + ((kVp - e0) * (k + 0.5)) / bins;
    // aluminium approximated by 1.4x the bone basis per cm (2.7 g/cc vs 1.92 g/cc)
    const muAl = 1.4 * muAt('bone', E);
    const v = Math.max(0, kVp - E) * Math.exp(-muAl * filt);
    keV.push(E); w.push(v); sum += v;
  }
  for (let k = 0; k < bins; k++) w[k] /= sum;
  let mean = 0; for (let k = 0; k < bins; k++) mean += keV[k] * w[k];
  return { kVp, keV, w, meanKeV: mean };
}

export function mulberry32(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  let u = 0; while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function poisson(lambda, rng) {
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= rng(); } while (p > L);
    return k - 1;
  }
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss(rng)));
}

// Beer-Lambert: counts = I0 * exp(-p).
export function transmit(sino, o = {}) {
  const I0 = o.I0 ?? 1e5, d = sino.data, out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = I0 * Math.exp(-d[i]);
  return { ...sino, data: out };
}

export function poissonNoise(counts, o = {}) {
  const rng = o.rng ?? mulberry32(o.seed ?? 7), d = counts.data;
  for (let i = 0; i < d.length; i++) d[i] = poisson(d[i], rng);
  return counts;
}

export function toLineIntegral(counts, o = {}) {
  const I0 = o.I0 ?? 1e5, d = counts.data, out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = -Math.log(Math.max(d[i], 0.5) / I0);
  return { ...counts, data: out };
}

// basisSinos: { water, bone, iron } sinograms of basis path lengths (density-weighted cm).
// Returns the effective line integral -ln(sum_E w(E) exp(-sum_m mu_m(E) L_m)).
export function polychromaticSinogram(basisSinos, spec) {
  const W = basisSinos.water.data, B = basisSinos.bone.data, F = basisSinos.iron.data;
  const nE = spec.keV.length;
  const mw = spec.keV.map((E) => muAt('water', E));
  const mb = spec.keV.map((E) => muAt('bone', E));
  const mf = spec.keV.map((E) => muAt('iron', E));
  const out = new Float32Array(W.length);
  for (let i = 0; i < W.length; i++) {
    let I = 0;
    for (let e = 0; e < nE; e++) I += spec.w[e] * Math.exp(-(mw[e] * W[i] + mb[e] * B[i] + mf[e] * F[i]));
    out[i] = -Math.log(Math.max(I, 1e-30));
  }
  return { ...basisSinos.water, data: out };
}

// Per-element gain errors (sigma, fraction) and dead elements (read as no attenuation).
// Works on line integrals: a gain g changes p by -ln(g).
export function detectorDefects(sino, o = {}) {
  const rng = mulberry32(o.seed ?? 11), n = sino.nDet, d = sino.data;
  const gain = new Float32Array(n);
  for (let i = 0; i < n; i++) gain[i] = -Math.log(Math.max(0.05, 1 + (o.gainSigma ?? 0) * gauss(rng)));
  const dead = new Set(o.dead ?? []);
  for (let a = 0; a < sino.nAngles; a++) {
    const row = a * n;
    for (let i = 0; i < n; i++) d[row + i] = dead.has(i) ? 0 : d[row + i] + gain[i];
  }
  return sino;
}

// One-stop scan simulator.
// phantom: { image, basis } from phantom2D. Options:
//   dose (I0, default Infinity = no noise), poly (beam hardening), kVp, filterMmAl,
//   motion: fn(a) -> {dx, dy} or { amplitude, cycles } (sinusoidal shift along x),
//   gainSigma, dead: [detector indices], seed.
export function simulateScan(phantom, geom, o = {}) {
  let motion = o.motion;
  if (motion && typeof motion !== 'function') {
    const amp = motion.amplitude ?? 0.5, cyc = motion.cycles ?? 1, n = geom.nAngles;
    motion = (a) => ({ dx: amp * Math.sin((2 * Math.PI * cyc * a) / n), dy: 0 });
  }
  const P = { motion };
  let sino;
  let spec = null;
  if (o.poly) {
    spec = spectrum(o.kVp ?? 120, { filterMmAl: o.filterMmAl });
    const bs = {};
    for (const k of ['water', 'bone', 'iron']) bs[k] = forwardProject(phantom.basis[k], geom, P);
    sino = polychromaticSinogram(bs, spec);
  } else {
    sino = forwardProject(phantom.image, geom, P);
  }
  const clean = { ...sino, data: Float32Array.from(sino.data) };
  const I0 = o.dose ?? Infinity;
  if (Number.isFinite(I0)) {
    const counts = transmit(sino, { I0 });
    poissonNoise(counts, { seed: o.seed ?? 7 });
    sino = toLineIntegral(counts, { I0 });
  }
  if (o.gainSigma || (o.dead && o.dead.length)) detectorDefects(sino, o);
  return { sino, clean, spectrum: spec };
}

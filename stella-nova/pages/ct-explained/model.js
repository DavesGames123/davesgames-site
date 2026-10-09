// ============================================================================
//  CT EXPLAINED  ·  model  (ES module, no DOM)
// ----------------------------------------------------------------------------
//  The numbers behind every figure. The module calls the shared CT engine in
//  ../ct-lab/engine/ and returns plain arrays. The figures in figs.js only
//  draw what this module computes. tests.mjs runs every function in Node.
//
//  Units: procedural phantoms use cm and mu in 1/cm at 70 keV. Shepp-Logan
//  uses its unit square (width 2) and arbitrary mu.
//
//  GREP MAP
//    grep -n 'export function phantom'      cached phantoms, a point object
//    grep -n 'export function beamRow'      Beer-Lambert along one row
//    grep -n 'export function oneView'      one parallel projection
//    grep -n 'export function scanSet'      sinogram + filtered sinogram
//    grep -n 'export function viewOrder'    spread-out view order
//    grep -n 'export function bpAccum'      add views to a back-projection
//    grep -n 'export function fft2Mag'      2D spectrum, centred, log
//    grep -n 'export function kSlice'       one projection into k-space
//    grep -n 'export function filterCurves' the five FBP windows
//    grep -n 'export function filteredRow'  one projection before/after
//    grep -n 'export function iterSetup'    sparse scan for the solvers
//    grep -n 'export function kaczmarz'     two-unknown ART toy
//    grep -n 'export function artefact'     the seven artefact cases
//    grep -n 'export function toHU'         mu to Hounsfield units
//    grep -n 'export const WINDOWS'         lung, soft, bone, brain
//    grep -n 'export function coneView'     one cone-beam projection
// ============================================================================
import * as E from '../ct-lab/engine/index.js';

export { E };
export const N = 128;
export const MU_WATER = E.muOfComposition('water', 70);
export const MU_AIR = 0;

const cache = new Map();
function memo(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

// A cached 2D phantom: { image, basis, shapes, meta }.
export function phantom(name, n = N, o = {}) {
  return memo(`ph:${name}:${n}:${o.seed ?? ''}`, () => E.phantom2D(name, n, { supersample: 2, ...o }));
}

// A small object: bright dots of mu `v` on an empty field (Shepp-Logan
// width 2). pts are world [x, y]. Each dot is a soft disc of radius r.
export function pointImage(n, pts, { width = 2, r = 0.035, v = 1 } = {}) {
  const img = { nx: n, ny: n, width, data: new Float32Array(n * n) };
  const px = width / n;
  for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
    const x = (ix + 0.5) * px - width / 2, y = width / 2 - (iy + 0.5) * px;
    let s = 0;
    for (const [qx, qy] of pts) {
      const d = Math.hypot(x - qx, y - qy) / r;
      if (d < 1.5) s += v * Math.max(0, Math.min(1, 1.5 - d));
    }
    img.data[iy * n + ix] = s;
  }
  return img;
}

// Beer-Lambert along image row iy, left to right. Returns mu per pixel,
// the running line integral p(x) and the surviving fraction I/I0 = e^-p.
export function beamRow(img, iy) {
  const n = img.nx, px = img.width / n;
  const mu = new Float32Array(n), p = new Float32Array(n + 1), I = new Float32Array(n + 1);
  I[0] = 1;
  for (let ix = 0; ix < n; ix++) {
    mu[ix] = img.data[iy * n + ix];
    p[ix + 1] = p[ix] + mu[ix] * px;
    I[ix + 1] = Math.exp(-p[ix + 1]);
  }
  return { mu, p, I, px };
}

// One parallel projection at angle b (radians). Returns { geom, data }.
export function oneView(img, b) {
  const geom = E.fitGeometry('parallel', img, { angles: [b] });
  const s = E.forwardProject(img, geom);
  return { geom, data: s.data };
}

// A full scan: { geom, sino, q (ramp-filtered), weights }. kind 'parallel'
// (nAngles over pi) or 'fan' (flat detector, nAngles over 2 pi).
export function scanSet(img, { kind = 'parallel', nAngles = 180, filter = 'ram-lak', cutoff = 1, key = null, sodFactor = 0.7, radius } = {}) {
  const make = () => {
    const geom = kind === 'fan'
      ? E.fitGeometry('fan', img, { nAngles, sodFactor, radius })
      : E.fitGeometry('parallel', img, { nAngles });
    const sino = E.forwardProject(img, geom);
    const q = E.filterSinogram(sino, geom, { filter, cutoff });
    const weights = E.angleWeights(geom);
    return { geom, sino, q, weights, dims: { nx: img.nx, ny: img.ny, width: img.width } };
  };
  return key ? memo(`scan:${key}:${kind}:${nAngles}:${filter}:${cutoff}:${sodFactor}:${radius}`, make) : make();
}

// View order that spreads views over the arc: bit-reversed index. After k
// views the used angles are close to evenly spaced, so a partial
// back-projection shows streaks from few views, not a missing wedge.
export function viewOrder(n) {
  let bits = 0; while ((1 << bits) < n) bits++;
  const out = [];
  for (let k = 0; k < (1 << bits); k++) {
    let r = 0; for (let b = 0; b < bits; b++) if (k & (1 << b)) r |= 1 << (bits - 1 - b);
    if (r < n) out.push(r);
  }
  return out;
}

// Add views order[from..to) of sinogram s into image out (pixel driven).
// The weight per view is pi / nUsed of the final count, so the caller
// rescales by total / used to show a partial sum at the right level.
export function bpAccum(s, geom, out, order, from, to) {
  const w = new Float32Array(geom.nAngles).fill(Math.PI / geom.nAngles);
  if (geom.type !== 'parallel') w.fill((2 * Math.PI) / geom.nAngles);
  for (let k = from; k < to && k < order.length; k++) {
    const a = order[k];
    E.fbpBackProject(s, geom, out, { out, a0: a, a1: a + 1, weights: w });
  }
  return out;
}

const pow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };

// Centred 2D Fourier magnitude of an image, log scaled: log(1 + |F|).
// Row index runs down, so frequency row r stands for -f_y.
export function fft2Mag(img) {
  const n = img.nx, P = pow2(n);
  const re = new Float64Array(P * P), im = new Float64Array(P * P);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) re[y * P + x] = img.data[y * n + x];
  const rr = new Float64Array(P), ii = new Float64Array(P);
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) { rr[x] = re[y * P + x]; ii[x] = im[y * P + x]; }
    E.fft(rr, ii);
    for (let x = 0; x < P; x++) { re[y * P + x] = rr[x]; im[y * P + x] = ii[x]; }
  }
  for (let x = 0; x < P; x++) {
    for (let y = 0; y < P; y++) { rr[y] = re[y * P + x]; ii[y] = im[y * P + x]; }
    E.fft(rr, ii);
    for (let y = 0; y < P; y++) { re[y * P + x] = rr[y]; im[y * P + x] = ii[y]; }
  }
  const out = new Float32Array(P * P), h = P / 2;
  for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
    const sy = (y + h) % P, sx = (x + h) % P;
    out[sy * P + sx] = Math.log1p(Math.hypot(re[y * P + x], im[y * P + x]));
  }
  return { n: P, data: out };
}

// The Fourier slice theorem in one function. The 1D spectrum of view a
// equals the 2D spectrum of the image along the line through the centre
// at the view's normal angle. Paints that line into grid (n x n, centred,
// log magnitude) and its hit counts into cnt. Pixel size px, detector du.
export function kSlice(row, du, b, px, grid, cnt, n) {
  const m = row.length, P = pow2(2 * m);
  const re = new Float64Array(P), im = new Float64Array(P);
  for (let i = 0; i < m; i++) re[i] = row[i];
  E.fft(re, im);
  // Scale: P-point FFT bin k is k/(P du) cycles per unit; an image grid of
  // n pixels has bin j = f * n * px. The continuous transforms agree when
  // the 1D sum is scaled by du / px^2 (2D sum times px^2, 1D times du).
  const scale = (n * px) / (P * du), mag = du / (px * px), h = n / 2;
  const c = Math.cos(b), s = Math.sin(b);
  for (let k = -P / 2; k < P / 2; k++) {
    const j = k * scale;
    if (Math.abs(j) > h - 1) continue;
    const kk = (k + P) % P;
    const v = Math.log1p(Math.hypot(re[kk], im[kk]) * mag);
    const gx = Math.round(h + j * c), gy = Math.round(h - j * s);
    const at = gy * n + gx;
    grid[at] = (grid[at] * cnt[at] + v) / (cnt[at] + 1);
    cnt[at]++;
  }
}

// Frequency responses of the five windows, normalised so the ramp peaks
// at 1 at Nyquist. Returns { nu: Float32Array, curves: { name: Float32Array } }.
export function filterCurves(cutoff = 1, P = 256) {
  const nu = new Float32Array(P / 2 + 1), curves = {};
  for (let k = 0; k <= P / 2; k++) nu[k] = k / (P / 2);
  const ref = E.filterResponse('ram-lak', P, 1, 1);
  const top = Math.max(...Array.from(ref).slice(0, P / 2 + 1));
  for (const f of E.FILTERS) {
    const H = E.filterResponse(f, P, 1, cutoff);
    curves[f] = Float32Array.from({ length: P / 2 + 1 }, (_, k) => H[k] / top);
  }
  return { nu, curves };
}

// One projection row before and after the ramp filter with a window.
export function filteredRow(img, b, filter, cutoff) {
  const v = oneView(img, b);
  const q = E.filterSinogram({ nAngles: 1, nDet: v.geom.nDet, data: v.data }, v.geom, { filter, cutoff });
  return { raw: v.data, filtered: q.data, geom: v.geom };
}

// A sparse noisy scan for the solvers, plus the FBP of the same data.
export function iterSetup(name = 'shepp-logan-modified', { n = 96, nAngles = 36, dose = 2e5 } = {}) {
  const ph = phantom(name, n);
  const geom = E.fitGeometry('parallel', ph.image, { nAngles });
  const { sino } = E.simulateScan(ph, geom, { dose, seed: 11 });
  const dims = { nx: n, ny: n, width: ph.image.width };
  const fbpImg = E.fbp(sino, geom, dims, {});
  return { ph, geom, sino, dims, fbpImg };
}

// Kaczmarz (ART) on two equations in two unknowns. Each line is
// a.x = b; one step projects x onto the next line. Returns the path.
export function kaczmarz(lines, x0, steps, relax = 1) {
  const path = [x0.slice()];
  let x = x0.slice();
  for (let k = 0; k < steps; k++) {
    const L = lines[k % lines.length];
    const aa = L.a[0] * L.a[0] + L.a[1] * L.a[1];
    const r = (L.b - (L.a[0] * x[0] + L.a[1] * x[1])) / aa;
    x = [x[0] + relax * r * L.a[0], x[1] + relax * r * L.a[1]];
    path.push(x);
  }
  return path;
}

// The artefact cases. Each returns { recon, ref, lo, hi, note, extra }.
// p is the case's one control in 0..1 (dose, views, arc, kVp, and so on).
export const ARTEFACTS = [
  { id: 'noise', label: 'Noise and dose', phantom: 'chest', preset: 'low-dose' },
  { id: 'views', label: 'Too few views', phantom: 'chest', preset: 'sparse-36' },
  { id: 'limited', label: 'Limited angle', phantom: 'shepp-logan-modified', preset: 'limited-90' },
  { id: 'hardening', label: 'Beam hardening', phantom: 'head', preset: 'beam-hardening' },
  { id: 'metal', label: 'Metal', phantom: 'metal-implant', preset: 'metal-streaks' },
  { id: 'rings', label: 'Rings', phantom: 'contrast-detail', preset: 'rings' },
  { id: 'motion', label: 'Motion', phantom: 'suitcase', preset: 'motion' },
];

export function artefactParam(id, p) {
  switch (id) {
    case 'noise': return { dose: Math.round(10 ** (2.5 + 3.5 * p)) };          // 316 .. 1e6
    case 'views': return { views: Math.max(6, Math.round(6 + p * 174)) };       // 6 .. 180
    case 'limited': return { arcDeg: Math.round(60 + 120 * p) };                // 60 .. 180
    case 'hardening': return { kVp: Math.round(60 + 80 * p) };                  // 60 .. 140
    case 'metal': return { kVp: Math.round(80 + 60 * p) };
    case 'rings': return { dead: Math.round(1 + 7 * p) };
    case 'motion': return { amp: +(p * 2).toFixed(2) };                         // 0 .. 2 cm
    default: return {};
  }
}

export function artefact(id, p, n = N) {
  const A = ARTEFACTS.find((a) => a.id === id);
  const ph = phantom(A.phantom, n);
  const dims = { nx: n, ny: n, width: ph.image.width };
  const ref = ph.image;
  const P = artefactParam(id, p);
  let geom = E.fitGeometry('parallel', ph.image, { nAngles: 180 });
  let o = {}, note = '', extra = null;
  if (id === 'noise') { o = { dose: P.dose, seed: 3 }; note = `I0 = ${P.dose.toLocaleString('en')} photons per detector`; }
  if (id === 'views') { geom = E.fitGeometry('parallel', ph.image, { nAngles: P.views }); note = `${P.views} views over 180°`; }
  if (id === 'limited') { geom = E.limitedAngle(E.fitGeometry('parallel', ph.image, { nAngles: 180 }), (P.arcDeg * Math.PI) / 180); note = `${P.arcDeg}° of the 180° needed`; }
  if (id === 'hardening') { o = { poly: true, kVp: P.kVp }; note = `${P.kVp} kVp polychromatic beam`; }
  if (id === 'metal') { o = { poly: true, kVp: P.kVp, dose: 2e5, seed: 5 }; note = `${P.kVp} kVp, steel head, titanium cup`; }
  if (id === 'rings') {
    // a full turn, as in a clinical scanner, so each ring closes
    geom = E.fitGeometry('parallel', ph.image, { nAngles: 360, arc: 2 * Math.PI });
    o = { gainSigma: 0.002, seed: 4 };
    note = `${P.dead} miscalibrated detector element${P.dead > 1 ? 's' : ''}`;
  }
  if (id === 'motion') { o = { motion: { amplitude: P.amp, cycles: 1 } }; note = `the bag shifts ±${P.amp} cm during the scan`; }
  const { sino } = E.simulateScan(ph, geom, o);
  if (id === 'rings') {
    // A few elements read a fixed few percent off in every view. In a
    // parallel scan each one draws a ring of radius |s| about the centre.
    const nd = geom.nDet;
    for (let k = 0; k < P.dead; k++) {
      const i = Math.round(nd / 2 + (k % 2 ? 1 : -1) * (5 + 8 * k)), off = (k % 3 === 1 ? -1 : 1) * (0.05 + 0.02 * k);
      for (let a = 0; a < geom.nAngles; a++) sino.data[a * nd + i] += off;
    }
  }
  let recon;
  if (id === 'limited') {
    // FBP on a short arc: weight each view as part of a full pi scan.
    const q = E.filterSinogram(sino, geom, {});
    const w = new Float32Array(geom.nAngles).fill(Math.PI / 180);
    recon = E.fbpBackProject(q, geom, dims, { weights: w });
  } else recon = E.fbp(sino, geom, dims, {});
  // display window from the reference
  let lo = 0, hi = 0;
  for (const v of ref.data) if (v > hi) hi = v;
  if (id === 'hardening' || id === 'noise' || id === 'motion') hi = MU_WATER * 1.6;
  if (id === 'metal') hi = MU_WATER * 2.4;
  if (id === 'hardening') {
    // profile through the brain, row at the centre
    const r = n >> 1;
    extra = { profile: recon.data.slice(r * n, r * n + n), refProfile: ref.data.slice(r * n, r * n + n) };
  }
  return { recon, ref, lo, hi, note, extra, psnr: E.psnr(ref, recon) };
}

// Hounsfield units: HU = 1000 (mu - mu_water) / (mu_water - mu_air).
export function toHU(mu) { return (1000 * (mu - MU_WATER)) / (MU_WATER - MU_AIR); }
export function huImage(img) {
  const out = new Float32Array(img.data.length);
  for (let i = 0; i < out.length; i++) out[i] = toHU(img.data[i]);
  return out;
}
// Standard display windows [level, width] in HU.
export const WINDOWS = [
  { id: 'brain', label: 'Brain', L: 40, W: 80 },
  { id: 'soft', label: 'Soft tissue', L: 40, W: 400 },
  { id: 'lung', label: 'Lung', L: -600, W: 1500 },
  { id: 'bone', label: 'Bone', L: 400, W: 1800 },
];
// Typical HU of the materials on the scale bar, from the engine's own mu.
export function huScale() {
  return ['air', 'lung', 'fat', 'water', 'blood', 'muscle', 'spongy', 'bone'].map((m) => ({ m, hu: Math.round(toHU(E.muOfComposition(m, 70))) }));
}

// An FBP slice for the HU figure, with a little noise.
export function huSlice(name, n = 192) {
  return memo(`hu:${name}:${n}`, () => {
    const ph = phantom(name, n);
    const geom = E.fitGeometry('parallel', ph.image, { nAngles: 270 });
    const { sino } = E.simulateScan(ph, geom, { dose: 4e5, seed: 2 });
    const img = E.fbp(sino, geom, { nx: n, ny: n, width: ph.image.width }, { filter: 'shepp-logan' });
    return { img, hu: huImage(img), width: ph.image.width };
  });
}

// One cone-beam projection of a small 3D head at angle b.
export function coneView(b, n = 40) {
  const vol = memo(`vol:${n}`, () => E.phantom3D('shepp-logan', n, { supersample: 1 }).volume);
  const geom = E.fitGeometry('cone', vol, { angles: [b], sodFactor: 1.6 });
  const pr = E.forwardProjectCone(vol, geom);
  return { nu: geom.nu, nv: geom.nv, data: pr.data };
}

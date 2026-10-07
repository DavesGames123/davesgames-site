// ============================================================================
//  THIN-FILM CLOTH  ·  film.js — thin-film interference optics (DOM-free)
// ----------------------------------------------------------------------------
//  The cloth colours come from one physical layer: a transparent film of
//  index n1 and thickness d on a substrate of complex index n2 = n + ik,
//  in air (n0 = 1). Light reflects at the top and at the bottom of the film.
//  The two waves interfere, so the reflectance depends on the wavelength,
//  the angle and the thickness.
//
//  ONE LAYER (Airy sum of all the internal reflections), per polarisation:
//      r = (r01 + r12 e^{2i beta}) / (1 + r01 r12 e^{2i beta})
//      beta = 2 pi n1 d cos(theta1) / lambda,   R = |r|^2
//  r_ij are the Fresnel amplitude coefficients with complex cosines from
//  Snell's law (a metal substrate gives a complex r12). Unpolarised light:
//  R = (Rs + Rp) / 2.
//
//  COLOUR. R(lambda) is weighted by the CIE 1931 colour matching functions
//  (the multi-lobe Gaussian fit of Wyman, Sloan and Shirley 2013) over 380
//  to 780 nm for an equal-energy light, then XYZ goes to linear sRGB. The
//  three channels are scaled so that R = 1 at all wavelengths gives (1,1,1).
//  This is a white balance to the light, not a D65 table.
//
//  LUT. The shader does not do the spectral sum. buildLUT() fills a table of
//  linear RGB reflectance against thickness (0..dMax nm) and cos(theta0)
//  (0..1). The shader reads it with bilinear filtering. The LUT is exact at
//  its nodes, so no fitted curve is involved.
//
//  STRAIN. The film is incompressible: volume d A stays constant. A patch
//  whose area grows by the ratio a gets d = d0 / a (thinnedThickness), so a
//  stretched film thins and its colours move to shorter wavelengths.
//
//  GREP MAP
//    grep -n 'export const MEDIA'          substrates (n, k against lambda)
//    grep -n 'export function filmReflectance'  the Airy sum, s and p
//    grep -n 'function cmf'                the colour matching fit
//    grep -n 'export function spectralRGB'  one thickness and angle to RGB
//    grep -n 'export function buildLUT'    the table for the shader
//    grep -n 'export const SOAP'           the soap film (bubble mode)
// ============================================================================

// Complex numbers as [re, im] pairs. Only what the Airy sum needs.
const C = (re, im = 0) => [re, im];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a, b) => { const q = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / q, (a[1] * b[0] - a[0] * b[1]) / q]; };
const abs2 = a => a[0] * a[0] + a[1] * a[1];
const expi = t => [Math.cos(t), Math.sin(t)];
function csqrt(a) {                      // principal root, Im >= 0 (decays in the medium)
  const m = Math.hypot(a[0], a[1]);
  let re = Math.sqrt(Math.max(0, (m + a[0]) / 2)), im = Math.sqrt(Math.max(0, (m - a[0]) / 2));
  if (a[1] < 0) im = -im;
  if (im < 0) { re = -re; im = -im; }
  return [re, im];
}
export const complex = { C, add, sub, mul, div, abs2, expi, csqrt };

// Substrates: [lambda nm, n, k] rows, linear between rows. Aluminium and
// steel are approximate values read from published optical constants
// (aluminium after Rakic 1995, steel near iron); they set the tint of the
// bare metal, not a measured product. 'dye' is a dark absorbing polymer.
export const MEDIA = {
  air: [[380, 1, 0], [780, 1, 0]],
  aluminium: [[400, 0.49, 4.86], [450, 0.62, 5.47], [500, 0.77, 6.08], [550, 0.96, 6.69], [600, 1.20, 7.26], [650, 1.49, 7.82], [700, 1.83, 8.31], [780, 2.40, 9.10]],
  steel: [[400, 2.10, 2.90], [500, 2.55, 3.15], [600, 2.85, 3.35], [700, 3.05, 3.60], [780, 3.15, 3.80]],
  dye: [[380, 1.56, 0.12], [780, 1.54, 0.12]],
  glass: [[380, 1.53, 0], [780, 1.51, 0]],
};
export function indexOf(medium, lambda) {
  const t = typeof medium === 'string' ? MEDIA[medium] : medium;
  if (typeof t === 'number') return C(t);
  if (lambda <= t[0][0]) return C(t[0][1], t[0][2]);
  for (let i = 1; i < t.length; i++) if (lambda <= t[i][0]) {
    const a = t[i - 1], b = t[i], f = (lambda - a[0]) / (b[0] - a[0]);
    return C(a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2]));
  }
  const z = t[t.length - 1]; return C(z[1], z[2]);
}

// The thin-film reflectance at one wavelength (nm), thickness d (nm) and
// incidence cosine cos0 in a medium of index n0. nFilm is real or complex,
// sub a MEDIA key or an index. Returns { Rs, Rp, R }.
export function filmReflectance(lambda, d, cos0, nFilm, subst, n0 = 1) {
  const N0 = C(n0), N1 = typeof nFilm === 'number' ? C(nFilm) : nFilm, N2 = indexOf(subst, lambda);
  const s0 = C(n0 * Math.sqrt(Math.max(0, 1 - cos0 * cos0)));
  const cosIn = N => csqrt(sub(C(1), mul(div(s0, N), div(s0, N))));
  const c0 = C(cos0), c1 = cosIn(N1), c2 = cosIn(N2);
  const rs = (Na, ca, Nb, cb) => div(sub(mul(Na, ca), mul(Nb, cb)), add(mul(Na, ca), mul(Nb, cb)));
  const rp = (Na, ca, Nb, cb) => div(sub(mul(Nb, ca), mul(Na, cb)), add(mul(Nb, ca), mul(Na, cb)));
  const beta = mul(C(2 * Math.PI * d / lambda), mul(N1, c1));
  // e^{2 i beta} with a complex beta (an absorbing film): e^{-2 Im} e^{2 i Re}
  const ph = mul(C(Math.exp(-2 * beta[1])), expi(2 * beta[0]));
  const airy = (a, b) => div(add(a, mul(b, ph)), add(C(1), mul(mul(a, b), ph)));
  const Rs = abs2(airy(rs(N0, c0, N1, c1), rs(N1, c1, N2, c2)));
  const Rp = abs2(airy(rp(N0, c0, N1, c1), rp(N1, c1, N2, c2)));
  return { Rs, Rp, R: 0.5 * (Rs + Rp) };
}

// CIE 1931 2-degree colour matching functions, multi-lobe fit (Wyman,
// Sloan, Shirley, JCGT 2013). g() is a Gaussian with a different width on
// each side of its peak.
function g(x, mu, s1, s2) { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); }
export function cmf(l) {
  return [
    1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
    0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
    1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8),
  ];
}
const XYZ2RGB = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.2040, 1.0570];
function xyzToRGB(x, y, z) {
  const M = XYZ2RGB;
  return [M[0] * x + M[1] * y + M[2] * z, M[3] * x + M[4] * y + M[5] * z, M[6] * x + M[7] * y + M[8] * z];
}
// The white of the equal-energy light, per step size (cached).
const whites = new Map();
function white(step) {
  if (whites.has(step)) return whites.get(step);
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += step) { const c = cmf(l); X += c[0]; Y += c[1]; Z += c[2]; }
  const w = xyzToRGB(X, Y, Z); whites.set(step, w); return w;
}

// Linear RGB of the film reflectance. film = { n, sub }. step in nm.
export function spectralRGB(d, cos0, film, step = 10, n0 = 1) {
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += step) {
    const R = filmReflectance(l, d, cos0, film.n, film.sub, n0).R, c = cmf(l);
    X += R * c[0]; Y += R * c[1]; Z += R * c[2];
  }
  const rgb = xyzToRGB(X, Y, Z), w = white(step);
  return [rgb[0] / w[0], rgb[1] / w[1], rgb[2] / w[2]];
}

// The film table for the shader: nd thickness columns (0..dMax nm) by nc
// rows of cos(theta0) (0..1). Float RGBA, row-major, row 0 at grazing.
export function buildLUT(film, { nd = 192, nc = 24, dMax = 1200, step = 10 } = {}) {
  const data = new Float32Array(nd * nc * 4);
  for (let j = 0; j < nc; j++) {
    const cos0 = Math.max(0.02, j / (nc - 1));
    for (let i = 0; i < nd; i++) {
      const rgb = spectralRGB(i / (nd - 1) * dMax, cos0, film, step);
      const o = 4 * (j * nd + i);
      data[o] = Math.max(0, rgb[0]); data[o + 1] = Math.max(0, rgb[1]); data[o + 2] = Math.max(0, rgb[2]); data[o + 3] = 1;
    }
  }
  return { data, nd, nc, dMax };
}

// Volume conservation: d A = d0 A0.
export function thinnedThickness(d0, areaRatio) { return d0 / Math.max(1e-6, areaRatio); }

// A soap film: water with surfactant, in air on both sides.
export const SOAP = { n: 1.33, sub: 'air' };

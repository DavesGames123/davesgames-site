// ============================================================================
//  PATTERN DESIGNER  ·  color.js — colour maths for palettes (no DOM)
// ----------------------------------------------------------------------------
//  sRGB hex <-> OKLab <-> OKLCH, the WCAG contrast ratio, a distance
//  between two palettes, and the harmony generator for the palette tools.
//  The tests, the page and the surprise pick (taste.js) use these.
//
//  OKLab: L in [0, 1], a and b about [-0.4, 0.4]. One unit of OKLab
//  distance is large: 0.02 is about the smallest step an eye sees.
//
//  HARMONY. A seed colour gives a hue h in OKLCH. Each kind is a set of
//  hue offsets from h (HARMONY_KINDS). The inks take those hues at a
//  spread of lightness, and a chroma that the sRGB gamut allows. The paper
//  is a light or dark neutral with a trace of the seed hue. The first ink
//  is then moved in lightness until its WCAG contrast on the paper is 3
//  or more (ensureContrast).
//
//  grep -n targets
//    conversions .......... "export function hexToOklab"  "export function oklchToHex"
//    contrast ............. "export function contrast"
//    palette distance ..... "export function paletteDistance"
//    harmony .............. "export const HARMONY_KINDS"  "export function harmony"
//    contrast repair ...... "export function ensureContrast"
//    palette score ........ "export function paletteScore"
// ============================================================================
const TAU = Math.PI * 2;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

// ── sRGB ───────────────────────────────────────────────────────────────────
export function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
export function rgbToHex(rgb) {
  return '#' + rgb.map(v => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');
}
const toLin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const toGam = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

// ── WCAG ───────────────────────────────────────────────────────────────────
// The relative luminance of WCAG 2: linear sRGB, Rec. 709 weights.
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// The WCAG contrast ratio, 1 to 21.
export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ── OKLab ──────────────────────────────────────────────────────────────────
function linToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function oklabToLin([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
export function hexToOklab(hex) { return linToOklab(hexToRgb(hex).map(toLin)); }
export function oklabToHex(lab) { return rgbToHex(oklabToLin(lab).map(c => toGam(clamp01(c)))); }
// OKLCH: [L, C, h], h in degrees 0..360.
export function hexToOklch(hex) {
  const [L, a, b] = hexToOklab(hex);
  let h = Math.atan2(b, a) * 360 / TAU; if (h < 0) h += 360;
  return [L, Math.hypot(a, b), h];
}
function inGamut(lab) { return oklabToLin(lab).every(c => c >= -1e-4 && c <= 1 + 1e-4); }
// OKLCH to hex. A colour outside sRGB keeps its L and h, and loses chroma
// (bisection) until it fits.
export function oklchToHex(L, C, h) {
  L = clamp01(L); const t = h * TAU / 360, lab = c => [L, c * Math.cos(t), c * Math.sin(t)];
  if (inGamut(lab(C))) return oklabToHex(lab(C));
  let lo = 0, hi = C;
  for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (inGamut(lab(m))) lo = m; else hi = m; }
  return oklabToHex(lab(lo));
}
// The Euclidean OKLab distance between two hex colours.
export function deltaE(a, b) {
  const p = hexToOklab(a), q = hexToOklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// ── palette distance ───────────────────────────────────────────────────────
// How far apart two palettes look. Each ink set is sorted by OKLab L.
// With the same ink count, the inks pair up in that order; else each ink
// takes its nearest ink in the other set (both ways, a mean). The paper
// counts as much as one ink pair. 0 means the same colours.
export function paletteDistance(p, q) {
  const A = p.ink.map(hexToOklab).sort((x, y) => x[0] - y[0]), B = q.ink.map(hexToOklab).sort((x, y) => x[0] - y[0]);
  const d = (x, y) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  let ink;
  if (A.length === B.length) ink = A.reduce((s, x, i) => s + d(x, B[i]), 0) / A.length;
  else {
    const near = (X, Y) => X.reduce((s, x) => s + Math.min(...Y.map(y => d(x, y))), 0) / X.length;
    ink = (near(A, B) + near(B, A)) / 2;
  }
  return (ink * 2 + d(hexToOklab(p.bg), hexToOklab(q.bg))) / 3;
}

// ── contrast repair ────────────────────────────────────────────────────────
// Move the lightness of ink away from the paper until the contrast is at
// least min. Hue and chroma stay (chroma shrinks only to fit the gamut).
export function ensureContrast(ink, bg, min = 3) {
  if (contrast(ink, bg) >= min) return ink;
  const [L, C, h] = hexToOklch(ink), up = luminance(bg) < 0.18;
  for (let k = 1; k <= 40; k++) {
    const q = oklchToHex(clamp01(L + (up ? 1 : -1) * k * 0.025), C, h);
    if (contrast(q, bg) >= min) return q;
  }
  return up ? '#ffffff' : '#000000';
}

// ── harmony ────────────────────────────────────────────────────────────────
// Hue offsets in degrees from the seed hue.
export const HARMONY_KINDS = {
  complementary: { name: 'Complementary', hues: [0, 180] },
  analogous: { name: 'Analogous', hues: [-30, 0, 30] },
  triadic: { name: 'Triadic', hues: [0, 120, 240] },
  split: { name: 'Split complementary', hues: [0, 150, 210] },
  tetradic: { name: 'Tetradic', hues: [0, 90, 180, 270] },
};
// A palette from one seed colour. o: { n inks (2..5), dark paper (bool
// or null: from the seed), rnd () -> [0, 1) for small changes }.
// Returns { id, name, bg, ink, hues } (hues: the target hue of each ink).
export function harmony(seedHex, kind = 'triadic', o = {}) {
  const K = HARMONY_KINDS[kind] || HARMONY_KINDS.triadic, rnd = o.rnd || (() => 0.5);
  const [L0, C0, h0] = hexToOklch(seedHex), n = Math.max(2, Math.min(5, o.n || Math.max(3, K.hues.length)));
  const dark = o.dark ?? L0 > 0.72;
  const C = Math.max(0.06, Math.min(0.2, C0 < 0.03 ? 0.12 : C0));
  const bg = dark ? oklchToHex(0.17 + 0.05 * rnd(), 0.012 + 0.012 * rnd(), h0) : oklchToHex(0.955 - 0.03 * rnd(), 0.012 + 0.014 * rnd(), h0 + 40);
  const ink = [], hues = [];
  for (let i = 0; i < n; i++) {
    // Inks past the hue set repeat the hues at another lightness.
    const lap = Math.floor(i / K.hues.length), h = (h0 + K.hues[i % K.hues.length] + 360 * 4) % 360;
    let L = i === 0 ? (dark ? Math.max(0.72, L0) : Math.min(0.5, L0)) : (dark ? 0.62 + 0.25 * rnd() : 0.42 + 0.3 * rnd());
    if (lap) L = dark ? 0.9 - 0.08 * rnd() : 0.26 + 0.06 * rnd();
    const c = lap ? C * 0.5 : C * (0.8 + 0.4 * rnd());
    ink.push(oklchToHex(L, c, h)); hues.push(h);
  }
  ink[0] = ensureContrast(ink[0], bg, 3.2);
  return { id: 'custom', name: `${K.name} from ${seedHex}`, bg, ink, hues };
}

// ── score ──────────────────────────────────────────────────────────────────
// A contrast score for a palette with n inks in use: the lowest WCAG
// contrast of those inks on the paper. The surprise pick prefers a high
// score.
export function paletteScore(pal, n = pal.ink.length) {
  let lo = 21;
  for (let k = 0; k < Math.max(1, n); k++) lo = Math.min(lo, contrast(pal.ink[k % pal.ink.length], pal.bg));
  return lo;
}

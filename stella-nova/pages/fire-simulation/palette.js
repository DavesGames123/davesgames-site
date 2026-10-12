// ============================================================================
//  FIRE SIMULATION  ·  pages/fire-simulation/palette.js — physical flame colour
// ----------------------------------------------------------------------------
//  Our code (davesgames.io). No DOM, so render.js, scene.js and tests.mjs use
//  the same maths. The sim gives one value t per cell (0 cold .. 1 hot).
//  t >= 0.3 is flame, t < 0.3 is smoke (the solver cooling break).
//
//  Pipeline for one value of t:
//    1. Flame: u = (t - 0.3) / 0.7, then T = Tmin + (Tmax - Tmin) * u^gamma.
//    2. Colour of T: Planck's law integrated against the CIE 1931 2 degree
//       colour matching functions (Wyman, Sloan and Shirley 2013 fit),
//       380..780 nm, then XYZ to linear sRGB (D65). Max channel = 1.
//    3. Intensity: (T / Tmax)^4 (Stefan-Boltzmann), times the exposure.
//       A line palette adds atomic or molecular emission lines.
//    4. Tone map: ACES filmic fit (Narkowicz 2015) per channel.
//    5. Smoke: cool soot absorbs (alpha from t) and is dark grey-brown, lit
//       a little by the flame. It does not glow.
//    6. Composite in linear light, then the sRGB transfer curve.
//  The canvas gets straight RGBA, so the output alpha is max(smoke alpha,
//  max channel), and the colour is the premultiplied value / alpha.
//
//  grep -n targets: "export const PALETTES", "export function planckRGB",
//  "export function flameLinear", "export function samplePalette",
//  "export function paletteLut", "export function aces"
// ============================================================================

const FLAME_T = 0.3;          // solver break between smoke and flame cooling

// ---- colour science ---------------------------------------------------------
// CIE 1931 2 degree colour matching functions, multi-lobe Gaussian fit
// (Wyman, Sloan, Shirley, JCGT 2013). Lambda in nm.
const lobe = (x, mu, s1, s2) => { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
export function cmf(l) {
  return [
    1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2),
    0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1),
    1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8),
  ];
}
export function xyzToLinearSRGB([X, Y, Z]) {
  return [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ];
}
export const luminance = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
// XYZ scaled so that X + Y + Z = 1 (chromaticity only, no underflow).
const unitXYZ = v => { const s = v[0] + v[1] + v[2]; return s > 0 ? v.map(x => x / s) : [0, 0, 0]; };
// Max channel = 1, negative channels clipped to 0. The Planck locus
// leaves the sRGB gamut only a little at the red corner (under about
// 1100 K), so a clip keeps it pure red there and keeps the order.
function clipMax1(c) {
  const r = c.map(v => Math.max(0, v)), M = Math.max(r[0], r[1], r[2]);
  return M > 0 ? r.map(v => v / M) : [0, 0, 0];
}
// A spectral line is far out of gamut. It moves toward white until no
// channel is negative, at the same luminance. Then max channel = 1.
function gamutMax1(c) {
  const Y = Math.max(1e-9, luminance(c)), m = Math.min(0, c[0], c[1], c[2]);
  let r = c;
  if (m < 0) { const k = -m / (Y - m); r = c.map(v => v + (Y - v) * k); }
  const M = Math.max(1e-9, r[0], r[1], r[2]);
  return r.map(v => Math.max(0, v) / M);
}
// Planck's law, relative spectral radiance. The constant c1 and the
// scale of lambda (nm / 500) cancel in the max-1 normalisation.
// c2 = 1.4388e-2 m K, lambda in nm.
const planck = (l, T) => 1 / (Math.pow(l / 500, 5) * (Math.exp(1.4388e7 / (l * T)) - 1));
const PLANCK_CACHE = new Map();
export function planckRGB(T) {
  const key = Math.round(T);
  if (PLANCK_CACHE.has(key)) return PLANCK_CACHE.get(key);
  const xyz = [0, 0, 0];
  for (let l = 380; l <= 780; l += 2) { const b = planck(l, T), c = cmf(l); xyz[0] += b * c[0]; xyz[1] += b * c[1]; xyz[2] += b * c[2]; }
  const out = clipMax1(xyzToLinearSRGB(unitXYZ(xyz)));
  PLANCK_CACHE.set(key, out);
  return out;
}
// Colour of a set of emission lines [[nm, weight], ..], max channel 1.
// sat < 1 moves the colour toward grey of the same luminance (a flame
// also has a weak continuum, so its line colour is not fully saturated).
export function lineRGB(lines, sat = 1) {
  const xyz = [0, 0, 0];
  for (const [l, w] of lines) { const c = cmf(l); xyz[0] += w * c[0]; xyz[1] += w * c[1]; xyz[2] += w * c[2]; }
  const c = gamutMax1(xyzToLinearSRGB(unitXYZ(xyz))), Y = luminance(c);
  return gamutMax1(c.map(v => Y + (v - Y) * sat));
}
// ACES filmic tone curve, Narkowicz 2015 fit, per channel, output 0..1.
export function aces(x) { x = Math.max(0, x); return Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)); }
export const srgbEncode = v => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
export const srgbDecode = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- palettes ---------------------------------------------------------------
// kind 'physical': blackbody soot (Tmin..Tmax K, exposure) plus optional
// emission lines [[nm, weight]] with the strength 'line'.
// Optional: soot (smoke alpha scale, default 1) and smoke (linear base
// colour of the smoke, default dark grey-brown).
// kind 'ramp': a stylised sRGB ramp, not physical, drawn as before.
// 'upstream' is getFireColor of the upstream 21-fire.html.
export const PALETTES = [
  { id: 'blackbody', label: 'Blackbody (soot, 900-2700 K)', kind: 'physical', Tmin: 900, Tmax: 2700, gamma: 1.25, exposure: 4.5 },
  { id: 'campfire', label: 'Wood fire (cooler soot, 850-2000 K)', kind: 'physical', Tmin: 850, Tmax: 2000, gamma: 1.2, exposure: 3.2 },
  { id: 'sodium', label: 'Sodium (589 nm line + soot)', kind: 'physical', Tmin: 900, Tmax: 2000, gamma: 1.2, exposure: 1.2, lines: [[589.0, 1], [589.6, 1]], sat: 0.95, line: 1.6 },
  { id: 'green', label: 'Copper (green bands 510-526 nm)', kind: 'physical', Tmin: 900, Tmax: 1800, gamma: 1.2, exposure: 0.5, lines: [[510, 0.7], [526, 1], [538, 0.4]], sat: 0.8, line: 1.6 },
  { id: 'violet', label: 'Potassium (lilac, 404 + 767 nm)', kind: 'physical', Tmin: 900, Tmax: 1800, gamma: 1.2, exposure: 0.4, lines: [[404.4, 1], [766.5, 60]], sat: 0.55, line: 1.4 },
  { id: 'blue', label: 'Gas flame (CH 431 nm, C2 473 + 516 nm)', kind: 'physical', Tmin: 900, Tmax: 1700, gamma: 1.2, exposure: 0.15, lines: [[431, 1], [473, 0.5], [516, 0.2]], sat: 0.7, line: 1.4, soot: 0.35 },
  { id: 'white', label: 'Magnesium (white-hot, 1200-3600 K, white MgO smoke)', kind: 'physical', Tmin: 1200, Tmax: 3600, gamma: 0.9, exposure: 10, smoke: [0.30, 0.30, 0.29], soot: 0.6 },
  { id: 'upstream', label: 'Classic (upstream sRGB ramp, not physical)', kind: 'ramp', colors: ['#000000', '#333333', '#ff1a1a', '#ff9900', '#ffff00'] },
  { id: 'ghost', label: 'Ghost (stylised, not physical)', kind: 'ramp', colors: ['#000306', '#062430', '#18a3b8', '#9ef3ff', '#ffffff'] },
];
export const RAMP_STOPS = [0, 0.3, 0.5, 0.75, 1];
export const paletteById = id => PALETTES.find(p => p.id === id) || PALETTES[0];

// Soot and smoke. Base colour is a dark grey-brown in linear light. The
// flame light is a warm tint that grows as t nears the flame break.
const SMOKE_BASE = [0.030, 0.025, 0.020], SMOKE_LIT = [0.022, 0.009, 0.003];
export function smokeAlpha(t, soot = 1) { return t > 0 ? 0.8 * soot * (1 - Math.exp(-3.2 * Math.min(t, FLAME_T) / FLAME_T)) : 0; }

// Temperature in K at t (flame only, null below the break).
export function temperatureAt(p, t) {
  if (!(t >= FLAME_T)) return null;
  const u = Math.min(1, (t - FLAME_T) / (1 - FLAME_T));
  return p.Tmin + (p.Tmax - p.Tmin) * Math.pow(u, p.gamma || 1);
}
// Scene-linear emission (before the tone map) at t.
export function flameLinear(p, t) {
  const T = temperatureAt(p, t);
  if (T == null) return [0, 0, 0];
  const u = Math.min(1, (t - FLAME_T) / (1 - FLAME_T));
  // smooth(0, 0.08, u): the flame edge fades in from zero, so the smoke
  // and the flame meet without a step at t = 0.3
  const c = planckRGB(T), I = Math.pow(T / p.Tmax, 4) * p.exposure * smooth(0, 0.08, u);
  const out = [c[0] * I, c[1] * I, c[2] * I];
  if (p.lines) {
    if (!p._line) p._line = lineRGB(p.lines, p.sat);
    const L = p.line * smooth(0, 0.35, u) * (0.35 + 0.65 * u);
    for (let k = 0; k < 3; k++) out[k] += p._line[k] * L;
  }
  return out;
}
// Display colour of t: { rgb (0..1 sRGB, straight), a (0..1), lin (display-
// linear premultiplied), emit (display-linear tone-mapped emission) }.
export function samplePalette(p, t) {
  t = t > 0 ? Math.min(1, t) : 0;
  const e = flameLinear(p, t).map(aces), a0 = smokeAlpha(t, p.soot == null ? 1 : p.soot), base = p.smoke || SMOKE_BASE;
  const lit = smooth(0.04, FLAME_T, t);
  const s = [0, 1, 2].map(k => base[k] + SMOKE_LIT[k] * lit);
  const pre = [0, 1, 2].map(k => s[k] * a0 + e[k]);
  const a = Math.min(1, Math.max(a0, pre[0], pre[1], pre[2]));
  const rgb = a > 0 ? pre.map(v => srgbEncode(Math.min(1, v / a))) : [0, 0, 0];
  return { rgb, a, lin: pre, emit: e };
}

// RGBA LUT of n entries for render.js (index = round(t * (n - 1))):
//   rgba  straight sRGB colour and alpha of smoke + flame
//   glow  emission only (alpha = max channel), for the additive glow pass
export function paletteLut(id, n = 1024) {
  const p = paletteById(id);
  const rgba = new Uint8ClampedArray(n * 4), glow = new Uint8ClampedArray(n * 4);
  if (p.kind === 'ramp') {
    const C = p.colors.map(h => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }), st = RAMP_STOPS;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1); let i = 0; while (i < st.length - 2 && t > st[i + 1]) i++;
      const u = Math.min(1, Math.max(0, (t - st[i]) / (st[i + 1] - st[i])));
      for (let c = 0; c < 3; c++) rgba[k * 4 + c] = glow[k * 4 + c] = Math.round(C[i][c] + (C[i + 1][c] - C[i][c]) * u);
      rgba[k * 4 + 3] = glow[k * 4 + 3] = Math.round(Math.min(255, t * 255 * 3.5));
    }
    return { id: p.id, n, rgba, glow };
  }
  for (let k = 0; k < n; k++) {
    const s = samplePalette(p, k / (n - 1)), o = k * 4;
    for (let c = 0; c < 3; c++) rgba[o + c] = Math.round(s.rgb[c] * 255);
    rgba[o + 3] = Math.round(s.a * 255);
    const m = Math.max(s.emit[0], s.emit[1], s.emit[2]);
    for (let c = 0; c < 3; c++) glow[o + c] = m > 0 ? Math.round(srgbEncode(s.emit[c] / m) * 255) : 0;
    glow[o + 3] = Math.round(m * 255);
  }
  return { id: p.id, n, rgba, glow };
}
// Swatch colours for the GUI: the flame at five values of t, as hex.
export function swatchColors(id) {
  const p = paletteById(id);
  if (p.kind === 'ramp') return p.colors.slice();
  return [0.36, 0.5, 0.65, 0.82, 1].map(t => '#' + flameDisplay(p, t).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''));
}
// The flame colour alone (tone-mapped emission over black, sRGB 0..1).
export function flameDisplay(p, t) { return flameLinear(p, t).map(v => srgbEncode(aces(v))); }
// HSV hue in degrees of an sRGB colour (0..1).
export function hue([r, g, b]) {
  const M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m;
  if (d < 1e-9) return 0;
  let h = M === r ? ((g - b) / d) % 6 : M === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; return h < 0 ? h + 360 : h;
}

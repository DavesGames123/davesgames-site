// ============================================================================
//  THERMAL CONVECTION  ·  render/palettes.js — temperature colour maps (VIEW)
// ----------------------------------------------------------------------------
//  No DOM. The views map a nondimensional temperature t in [0, 1] (after the
//  auto range, gain and bias, see views.js toneT) to sRGB with these ramps.
//
//  PALETTES[id] = { id, name, stops: [[t, '#rrggbb'], ...], sheen, relief }
//    solar    blackbody photosphere: dark red-brown lanes, orange flanks,
//             white-yellow cell tops (the look of solar granulation images)
//    broth    amber soup: dark umber lanes to bright gold, fat-sheen
//             highlight (sheen > 0 adds a specular term to the relief light)
//    inferno  the matplotlib perceptual map (Smith and van der Walt 2015)
//    icefire  diverging: cold blue, dark mean, hot orange (about tn = 0.5)
//    sheen    0..1 specular strength of the relief light (views.js)
//    relief   0..1 how strongly the w relief shades this palette
//  ramp(id, t) -> [r, g, b] in 0..1 sRGB, linear between stops in sRGB.
//  lut(id, n = 256) -> Uint8Array(4n) RGBA8 for the 256 x 1 LUT texture.
//  luminance([r, g, b]) -> relative luminance (WCAG, linear-light Y).
//  The tests check that solar, broth and inferno rise in luminance with t.
//
//  grep -n targets: "export const PALETTES", "export const PALETTE_IDS",
//  "export function ramp", "export function lut", "export function luminance",
//  "export function hexRgb"
// ============================================================================

const P = (id, name, stops, sheen = 0, relief = 1) => Object.freeze({ id, name, stops: Object.freeze(stops), sheen, relief });

export const PALETTES = Object.freeze({
  solar: P('solar', 'Solar', [
    [0.00, '#120200'], [0.12, '#360900'], [0.26, '#6c1900'], [0.42, '#a83d02'],
    [0.58, '#de730c'], [0.74, '#fbad35'], [0.88, '#ffdc84'], [1.00, '#fff8e0'],
  ], 0.0, 0.85),
  broth: P('broth', 'Broth', [
    [0.00, '#160a03'], [0.18, '#3a1d07'], [0.38, '#71400c'], [0.58, '#ad7015'],
    [0.76, '#dca22f'], [0.90, '#f4cd68'], [1.00, '#fff0c0'],
  ], 0.55, 1.0),
  inferno: P('inferno', 'Inferno', [
    [0.0, '#000004'], [0.1, '#160b39'], [0.2, '#420a68'], [0.3, '#6a176e'],
    [0.4, '#932667'], [0.5, '#bc3754'], [0.6, '#dd513a'], [0.7, '#f37819'],
    [0.8, '#fca50a'], [0.9, '#f6d746'], [1.0, '#fcffa4'],
  ], 0.0, 0.7),
  icefire: P('icefire', 'Ice and fire', [
    [0.00, '#bde6e2'], [0.14, '#64aedc'], [0.28, '#3b66c4'], [0.40, '#2a3270'],
    [0.50, '#1b1a23'], [0.60, '#5c1e3c'], [0.72, '#b52c36'], [0.86, '#ec6f2c'],
    [1.00, '#fbd5a8'],
  ], 0.0, 0.6),
});

export const PALETTE_IDS = Object.freeze(Object.keys(PALETTES));

export function hexRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const cache = new Map();
function rgbStops(id) {
  let s = cache.get(id);
  if (!s) {
    const pal = PALETTES[id] || PALETTES.solar;
    s = pal.stops.map(([t, h]) => [t, hexRgb(h)]);
    cache.set(id, s);
  }
  return s;
}

export function ramp(id, t) {
  const s = rgbStops(id);
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  if (x <= s[0][0]) return s[0][1].slice();
  for (let i = 1; i < s.length; i++) {
    if (x <= s[i][0]) {
      const [t0, c0] = s[i - 1], [t1, c1] = s[i];
      const f = (x - t0) / Math.max(1e-9, t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return s[s.length - 1][1].slice();
}

export function lut(id, n = 256) {
  const out = new Uint8Array(4 * n);
  for (let i = 0; i < n; i++) {
    const c = ramp(id, n > 1 ? i / (n - 1) : 0);
    out[4 * i] = Math.round(c[0] * 255);
    out[4 * i + 1] = Math.round(c[1] * 255);
    out[4 * i + 2] = Math.round(c[2] * 255);
    out[4 * i + 3] = 255;
  }
  return out;
}

const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function luminance([r, g, b]) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

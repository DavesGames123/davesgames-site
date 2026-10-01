// ============================================================================
//  MATERIAL STUDIO  ·  panels/color.js — sRGB hex, linear and HSV conversions
// ────────────────────────────────────────────────────────────────────────────
//  A color param value is an sRGB hex string (contract). An array value is
//  linear rgb. colorToHex and hexLike convert between the two forms, and
//  keep the form of the value that came in.
//
//  GREP TARGETS
//      hexToRgb rgbToHex toLin toSrgb rgbToHsv hsvToRgb colorToHex hexLike
// ============================================================================
import { clamp } from './util.js';

// sRGB hex <-> linear / hsv
export function hexToRgb(hex) {
  let s = String(hex || '').trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}/i.test(s)) return [0, 0, 0];
  const n = parseInt(s.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const rgbToHex = c => '#' + c.slice(0, 3).map(x => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
export const toLin = x => x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
export const toSrgb = x => x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
export function rgbToHsv([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d > 0) {
    if (mx === r) hh = ((g - b) / d) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4;
    hh /= 6; if (hh < 0) hh += 1;
  }
  return [hh, mx > 0 ? d / mx : 0, mx];
}
export function hsvToRgb([hh, s, v]) {
  const i = Math.floor(hh * 6) % 6, f = hh * 6 - Math.floor(hh * 6);
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
}
/** A color param value is an sRGB hex string (contract). An array is taken as linear rgb. */
export const colorToHex = v => Array.isArray(v) ? rgbToHex(v.map(x => toSrgb(clamp(x, 0, 1)))) : (typeof v === 'string' ? v : '#808080');
export const hexLike = (hex, like) => Array.isArray(like) ? hexToRgb(hex).map(toLin) : hex;

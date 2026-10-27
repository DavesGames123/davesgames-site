// ============================================================================
//  MUSHROOM DRAW  ·  engine/shade.js — colour, vectors and the light
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). No DOM. hsl() gives a hex colour.
//  dot, norm and cross work on [x, y, z]. LIGHT is the unit light
//  vector; dark(n, L) is the darkness 0..1 of a normal n.
//
//  GREP MAP
//    grep -n 'export function hsl'   a hex colour from hue, saturation, lightness
//    grep -n 'export const dot'      the vector helpers
//    grep -n 'export const LIGHT'    the light vector
//    grep -n 'export const dark'     the darkness of a normal
// ============================================================================
import { clamp } from '../geom.js';

// ── colour ──────────────────────────────────────────────────────────────────
export function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const f = n => {
    const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(clamp(c, 0, 1) * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

// ── vectors ─────────────────────────────────────────────────────────────────
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// The light: from the upper left and a little in front.
export const LIGHT = norm([-0.55, 0.62, 0.56]);
// darkness 0 (lit) .. 1 (away from the light).
export const dark = (n, L) => clamp((0.5 - dot(n, L)) / 1.0, 0, 1);

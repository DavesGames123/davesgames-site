// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · stringlut.js — a colour map with a visible floor for strings
// ────────────────────────────────────────────────────────────────────────────
//  The string views colour each point by a field (default: the acceleration
//  in magma). A string at rest has zero field, and magma, inferno and the
//  other dark-start maps give black there. Black on the dark fretboard and
//  sound hole made a resting string disappear.
//
//  floorLut(lut) returns a copy of a 256-entry sRGB LUT where no entry is
//  darker than CIE L* = L_FLOOR. A dark entry is mixed toward CORE (a cool
//  steel grey) just enough to reach the floor, so the hue of the map stays
//  where the map is bright, and the low end reads as a dim steel core.
//  The views use the floored LUT for the string itself only. The legend and
//  the field-over-time strip keep the true map, so the data scale is honest.
//
//  GREP MAP
//    export const L_FLOOR ...... lightness floor (CIE L*)
//    export const CORE ......... the colour a dark entry mixes toward
//    export function floorLut .. the floored LUT
// ════════════════════════════════════════════════════════════════════════════

import { cieL } from '../ct-lab/colormaps/maps.js';

export const L_FLOOR = 34;
export const CORE = [150, 160, 182];

const cache = new WeakMap();

/** Copy of a 768-byte sRGB LUT with every entry at or above L_FLOOR. */
export function floorLut(lut, Lmin = L_FLOOR) {
  if (Lmin === L_FLOOR && cache.has(lut)) return cache.get(lut);
  const out = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    const o = i * 3, r = lut[o], g = lut[o + 1], b = lut[o + 2];
    if (cieL(r, g, b) >= Lmin) { out[o] = r; out[o + 1] = g; out[o + 2] = b; continue; }
    // smallest mix m toward CORE with L* >= Lmin (L* rises with m)
    let lo = 0, hi = 1;
    for (let k = 0; k < 18; k++) {
      const m = (lo + hi) / 2;
      const L = cieL(r + (CORE[0] - r) * m, g + (CORE[1] - g) * m, b + (CORE[2] - b) * m);
      if (L >= Lmin + 0.3) hi = m; else lo = m;   // margin for byte rounding
    }
    out[o] = Math.round(r + (CORE[0] - r) * hi);
    out[o + 1] = Math.round(g + (CORE[1] - g) * hi);
    out[o + 2] = Math.round(b + (CORE[2] - b) * hi);
  }
  if (Lmin === L_FLOOR) cache.set(lut, out);
  return out;
}

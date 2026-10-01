// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  dials.js — paint a dial for a face spec
// ────────────────────────────────────────────────────────────────────────────
//  dialPainter(face, o) returns a canvas painter for B.dialFace (mm units,
//  origin at the centre, y down). o: { sub: [cy, r] | null, aperture: [cy, r]
//  | null, line: caption, serifBrand }. The shared paintDial() of
//  watch-movement draws the bases, numerals and tracks in catalog.js; a
//  style it does not know is drawn here.
// ============================================================================
import { paintDial } from '../watch-movement/scenes/shared.js';

export function dialPainter(f, o) {
  return paintDial({
    base: f.base, numerals: f.numerals, track: f.track, accent: f.accent, serifBrand: o.serifBrand,
    sub: o.sub, aperture: o.aperture, brand: f.brand.toUpperCase(), line: o.line,
  });
}

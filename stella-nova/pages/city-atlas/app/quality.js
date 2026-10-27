// ============================================================================
//  QUALITY  ·  city-atlas/app/quality.js — the quality levels and their rule
// ----------------------------------------------------------------------------
//  QUALITY GOVERNOR, aiming at 60 fps. lib/render-scale.js handles the pixels
//  from the frame rate. This rule reads the GPU time (submit to done) every
//  2 s: over 13 ms it lowers, in order, the wind lattice steps per frame, the
//  streak count, then the pixel budget; under 6.5 ms for 6 s it raises them
//  back in the reverse order. Level 0 is full quality. app/layout.js applies
//  a level. No DOM.
//
//  RENDER SIZE. The budget (PIXELS) was 3600 px long side, MSAA 4x: 2880 x
//  1800 x 4 samples on a 1440 x 900 Retina laptop.
//
//  grep -n targets
//    levels ............... "export const QUALITY"
//    pixel budget ......... "export const PIXELS"
//    median ............... "export const med"
//    the rule ............. "export function stepQuality"
// ============================================================================

export const QUALITY = [
  { wind: 1, share: 1, pix: 1 },
  { wind: 0.6, share: 1, pix: 1 },
  { wind: 0.4, share: 0.7, pix: 1 },
  { wind: 0.4, share: 0.6, pix: 0.75 },
  { wind: 0.25, share: 0.5, pix: 0.55 },
  { wind: 0.25, share: 0.4, pix: 0.4 },
];
export const PIXELS = { desktop: 2.4e6, phone: 1.3e6, min: 0.7e6 };

// The median of the positive values of a (0 when there are none).
export const med = (a) => { const s = a.filter((x) => x > 0).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

// q = { level, good }: good counts the quiet reads in a row. g: median GPU ms.
// Returns the next level; q.good changes in place.
export function stepQuality(q, g) {
  let next = q.level;
  if (g > 13 && q.level < QUALITY.length - 1) { next = q.level + 1; q.good = 0; }
  else if (g < 6.5) { if (++q.good >= 3 && q.level > 0) { next = q.level - 1; q.good = 0; } }
  else q.good = 0;
  return next;
}

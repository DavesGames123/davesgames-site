// ============================================================================
//  PBF BOUNDARIES BUDGET  ·  pages/pbf-boundary/budget.js
// ----------------------------------------------------------------------------
//  Pure size rules for the renderer and the solver (no DOM, so tests.mjs
//  checks them):
//    pickDpr(raw, phone, cssW, cssH)   canvas pixels per CSS pixel
//    fieldCell(s)                      world size of one surface field cell
//    COUNT, CAP                        start and maximum particle counts
//
//  The canvas backing store is CSS size x dpr. The dpr is the device value,
//  with a cap of 2 on a desktop and 1.75 on a phone, and a pixel budget:
//  a 4K desktop gets at most 8.3 M canvas pixels, a phone 3 M.
//
//  The surface is a vector contour of a kernel field (render.js). The field
//  cell sets the spacing of the contour vertices. fieldCell() keeps that
//  spacing near FIELD_PX canvas pixels, between D / 6 and D / 2.5. The cost
//  of the field splat goes up as the cell gets smaller, so the D / 6 limit
//  holds the cost on a zoomed saver shot.
//
//  Measured costs (node on the development laptop, tests.mjs "budget"):
//  the solver takes about 6 to 8 ms a frame for 2000 particles at 3
//  substeps. The surface script takes about 1.5 to 2 ms at a 1440 x 900
//  window, dpr 2, and about 3.5 ms on a 2x saver zoom.
//
//  grep -n targets: "export function pickDpr", "export function fieldCell",
//  "export const COUNT"
// ============================================================================
import { D } from './solver.js';

export const DPR_CAP = { desktop: 2, phone: 1.75 };
export const PIXEL_BUDGET = { desktop: 8.3e6, phone: 3.0e6 };

export function pickDpr(raw, phone, cssW, cssH) {
  const cap = phone ? DPR_CAP.phone : DPR_CAP.desktop;
  let d = Math.min(cap, raw > 0 ? raw : 1);
  const area = Math.max(1, cssW) * Math.max(1, cssH);
  const budget = phone ? PIXEL_BUDGET.phone : PIXEL_BUDGET.desktop;
  if (area * d * d > budget) d = Math.sqrt(budget / area);
  return Math.max(1, d);
}

export const FIELD_PX = 5;
export const CELL_MIN = D / 6, CELL_MAX = D / 2.5;
// s: canvas pixels per metre (render.fitView).
export function fieldCell(s) {
  const c = s > 0 ? FIELD_PX / s : CELL_MAX;
  return Math.max(CELL_MIN, Math.min(CELL_MAX, c));
}

// Particle counts. The start values stay at 2000 and 1100: at 2400 the
// solver took 9.5 ms a frame with three bodies and an obstacle, which left
// too little of a 16.7 ms frame for the canvas. The slider goes higher.
// A phone CPU is about two to three times slower than a laptop here.
export const COUNT = { desktop: 2000, phone: 1100 };
export const CAP = { desktop: 3600, phone: 1800 };

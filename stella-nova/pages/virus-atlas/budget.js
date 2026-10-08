// ============================================================================
//  VIRUS ATLAS  ·  budget.js — the GPU memory budget of the 3D view
// ----------------------------------------------------------------------------
//  No DOM and no three.js: tests.mjs checks the arithmetic.
//
//  The view draws straight to the canvas: no render targets and no post
//  passes. The canvas holds two colour buffers (front and back, 4 B/px
//  each) and depth (4 B/px). With MSAA, the multisample buffer holds a
//  colour and a depth value per sample (8 B/px/sample).
//  A page crashed Safari when it allocated full-size multisample HalfFloat
//  targets at a device pixel ratio of 2. So:
//    - the pixel ratio falls until the drawing buffer is at most MAX_PX;
//    - MSAA is on only at a pixel ratio below 1.5 (at 2 the beads are
//      smooth without it) and only when its buffer fits in MS_BYTES.
//  The bead data on the GPU is small (textures of the asymmetric unit,
//  16 B per bead), and gpuBeadBytes() reports it.
//
//  maxInstances(coarse) is the instance budget per frame: the stride
//  (LOD) of a part is the smallest whole number that keeps it inside.
//
//  EXPORTS  MAX_PX, MS_BYTES, canvasBudget, gpuBeadBytes, maxInstances,
//           strideFor
// ============================================================================
export const MAX_PX = 2560 * 1440;
export const MS_BYTES = 48e6;

export function canvasBudget(cssW, cssH, dpr = 1, opts = {}) {
  const maxPx = opts.maxPx || MAX_PX;
  const area = Math.max(1, cssW * cssH);
  let pr = Math.min(dpr || 1, 2, Math.sqrt(maxPx / area));
  pr = Math.max(0.25, Math.floor(pr * 1000) / 1000);
  const px = Math.round(cssW * pr) * Math.round(cssH * pr);
  const samples = pr < 1.5 && px * 4 * 8 <= (opts.msBytes || MS_BYTES) ? 4 : 0;
  const bytes = px * 12 + px * samples * 8;
  return { pr, px, samples, antialias: samples > 0, bytes };
}

// Bead, operator and unit textures of one part, in bytes (RGBA32F, rows of
// 2048 texels, padded to a whole row).
export function gpuBeadBytes(nBeads, nOps, nUnits) {
  const tex = n => Math.ceil(Math.max(1, n) / 2048) * 2048 * 16;
  return tex(nBeads) + tex(3 * nOps) + tex(2 * nUnits);
}

export function maxInstances(coarse) { return coarse ? 260000 : 900000; }

// The smallest stride that keeps beads * copies / stride under the cap.
export function strideFor(nBeads, nCopies, cap) {
  return Math.max(1, Math.ceil(nBeads * nCopies / Math.max(1, cap)));
}

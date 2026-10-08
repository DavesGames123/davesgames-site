// ============================================================================
//  OUTBREAK  ·  budget.js — the GPU memory budget of the globe canvas
// ----------------------------------------------------------------------------
//  No DOM and no three.js, so node tests can check the arithmetic.
//
//  The page draws straight to the canvas (no EffectComposer, no render
//  targets). The canvas has antialias on, so the browser keeps a
//  multisample colour and depth buffer (MSAA_SAMPLES x 8 B/px), a resolve
//  buffer, a second colour buffer for the swap, and depth: 12 B/px.
//
//  canvasBudget(cssW, cssH, dpr) gives the pixel ratio for a window. The
//  pixel ratio is at most MAX_PR (2). It falls until the drawing buffer is
//  at most MAX_PX device px (the area of 2560 x 1440).
//
//  grep -n targets: "export const MAX_PX", "export function canvasBytes",
//                   "export function canvasBudget"
// ============================================================================

export const MAX_PX = 2560 * 1440;
export const MAX_PR = 2;
export const MIN_PR = 0.25;
export const MSAA_SAMPLES = 4;

// Bytes of an antialiased canvas with px device pixels.
export function canvasBytes(px, samples = MSAA_SAMPLES) { return px * (samples * 8 + 12); }

// -> { pr, w, h, px, bytes }; w, h = drawing buffer in device px.
export function canvasBudget(cssW, cssH, dpr = 1, opts = {}) {
  const maxPx = opts.maxPx || MAX_PX, maxPr = opts.maxPr || MAX_PR;
  const cw = Math.max(1, cssW || 1), ch = Math.max(1, cssH || 1);
  let pr = Math.min(dpr > 0 ? dpr : 1, maxPr, Math.sqrt(maxPx / (cw * ch)));
  pr = Math.max(MIN_PR, Math.floor(pr * 1000) / 1000);
  const w = Math.round(cw * pr), h = Math.round(ch * pr), px = w * h;
  return { pr, w, h, px, bytes: canvasBytes(px) };
}

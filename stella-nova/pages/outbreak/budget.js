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
//  A phone (phoneView: the same media query as ui.js PHONE_QUERY) gets a
//  smaller cap, PHONE_MAX_PX device px, so a dpr 3 phone draws at 2x and a
//  large touch screen falls below 2x before it heats up.
//
//  grep -n targets: "export const MAX_PX", "export function canvasBytes",
//                   "export function canvasBudget", "export function phoneView"
// ============================================================================

export const MAX_PX = 2560 * 1440;
export const MAX_PR = 2;
export const MIN_PR = 0.25;
export const MSAA_SAMPLES = 4;
export const PHONE_MAX_PX = 1600 * 1000;
export const PHONE_QUERY = '(max-width:760px), (max-height:520px) and (pointer:coarse)';

// True on a phone layout. win = window (or a stub with matchMedia).
export function phoneView(win) {
  try { return !!(win && win.matchMedia && win.matchMedia(PHONE_QUERY).matches); } catch { return false; }
}

// Bytes of an antialiased canvas with px device pixels.
export function canvasBytes(px, samples = MSAA_SAMPLES) { return px * (samples * 8 + 12); }

// -> { pr, w, h, px, bytes }; w, h = drawing buffer in device px.
// opts: { maxPx, maxPr, phone } (phone: the cap is PHONE_MAX_PX).
export function canvasBudget(cssW, cssH, dpr = 1, opts = {}) {
  const maxPx = opts.maxPx || (opts.phone ? PHONE_MAX_PX : MAX_PX), maxPr = opts.maxPr || MAX_PR;
  const cw = Math.max(1, cssW || 1), ch = Math.max(1, cssH || 1);
  let pr = Math.min(dpr > 0 ? dpr : 1, maxPr, Math.sqrt(maxPx / (cw * ch)));
  pr = Math.max(MIN_PR, Math.floor(pr * 1000) / 1000);
  const w = Math.round(cw * pr), h = Math.round(ch * pr), px = w * h;
  return { pr, w, h, px, bytes: canvasBytes(px) };
}

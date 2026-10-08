// ============================================================================
//  HOPF FIBRATION  ·  budget.js — the GPU memory budget of the 3D view
// ----------------------------------------------------------------------------
//  No DOM and no three.js, so tests.mjs can check the arithmetic.
//
//  The desktop view renders through an EffectComposer. Its scene target is
//  RGBA HalfFloat (8 B/px) with a depth buffer (4 B/px). With MSAA, each
//  sample holds a colour and a depth value, and a resolve texture holds the
//  result: bytes per px = samples * 12 + 12. The bloom pass runs at a
//  quarter of the target area. The canvas holds a colour buffer, a second
//  colour buffer for the swap, and depth: 12 B/px.
//
//  postBudget(cssW, cssH, dpr) gives the pixel ratio and the MSAA sample
//  count for a window. The pixel ratio falls until the drawing buffer is at
//  most MAX_PX (the area of 2560 x 1440 at 1x). The sample count is the
//  largest of 4, 2, 0 whose scene target fits in MS_BYTES.
//
//  A touch screen (opts.coarse) gets the phone profile: at most PHONE_MAX_PX
//  device px (1920 x 1080) and a pixel ratio of at most 2. A coarse pointer
//  draws no composer, so this profile sets the fill cost of the canvas only.
//
//  rebuildDue(frameNo, coarse) tells main.js when the per-frame animation
//  (breathing, sweep, trace) may write the instance data again. A touch
//  screen writes it on every PHONE_REBUILD_EVERY-th frame only.
//
//  EXPORTS  MAX_PX, MS_BYTES, PHONE_MAX_PX, PHONE_REBUILD_EVERY, postBudget,
//           targetBytes, legacyBytes, rebuildDue
// ============================================================================

export const MAX_PX = 2560 * 1440;
export const MS_BYTES = 160e6;
export const PHONE_MAX_PX = 1920 * 1080;
export const PHONE_REBUILD_EVERY = 2;

// True when the animation may rebuild the instance data on this frame.
export function rebuildDue(frameNo, coarse) {
  return !coarse || frameNo % PHONE_REBUILD_EVERY === 0;
}

// One scene target: MSAA colour + depth per sample, plus the resolve.
export function targetBytes(px, samples) { return px * (samples * 12 + 12); }

export function postBudget(cssW, cssH, dpr = 1, opts = {}) {
  const maxPx = opts.maxPx || (opts.coarse ? PHONE_MAX_PX : MAX_PX), msBytes = opts.msBytes || MS_BYTES;
  const area = Math.max(1, cssW * cssH);
  let pr = Math.min(dpr || 1, 2, Math.sqrt(maxPx / area));
  pr = Math.max(0.25, Math.floor(pr * 1000) / 1000);
  const px = Math.round(cssW * pr) * Math.round(cssH * pr);
  let samples = 0;
  for (const s of [4, 2]) if (targetBytes(px, s) <= msBytes) { samples = s; break; }
  const bytes = {
    target: targetBytes(px, samples),
    bloom: px * 8 * (1 / 16 + 2 * (1 / 16) * (4 / 3) * (1 - Math.pow(1 / 4, 5))),
    canvas: px * 12,
  };
  bytes.total = bytes.target + bytes.bloom + bytes.canvas;
  return { pr, px, samples, bytes };
}

// The estimate before the budget: two 4x MSAA targets at the full device
// pixel ratio (capped at 2), the bloom chain at half size, the canvas.
export function legacyBytes(cssW, cssH, dpr = 1) {
  const pr = Math.min(2, dpr), px = Math.round(cssW * pr) * Math.round(cssH * pr);
  const bloom = px * 8 * (1 / 4 + 2 * (1 / 4) * (4 / 3) * (1 - Math.pow(1 / 4, 5)));
  return 2 * targetBytes(px, 4) + bloom + px * 12;
}

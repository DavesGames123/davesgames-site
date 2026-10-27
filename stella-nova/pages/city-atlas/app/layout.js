// ============================================================================
//  LAYOUT  ·  city-atlas/app/layout.js — canvas size and the quality governor
// ----------------------------------------------------------------------------
//  RENDER SIZE. lib/render-scale.js sizes the canvas: the window x dpr (at
//  most 2), then a pixel budget (app/quality.js PIXELS), then a factor that
//  its frame-rate control lowers below 45 fps. Without render-scale.js the
//  canvas takes the same budget by hand. The GPU-time rule in governor()
//  lowers the budget too, for a browser whose rAF does not slow.
//
//  grep -n targets
//    render scale ......... "function makeScale"
//    renderer size ........ "function syncCanvas"
//    window layout ........ "export function relayout"
//    per-frame scale ...... "export function tickScale"
//    quality level ........ "export const quality"
//    governor ............. "export function governor"
// ============================================================================

import { S, invalidate } from './state.js';
import { canvas, device } from './dom.js';
import { forgetBoxes } from './foot.js';
import { QUALITY, PIXELS, med, stepQuality } from './quality.js';

let pixelBudget = 0, rs = null;
function makeScale() {
  const { phone } = device();
  if (!pixelBudget) pixelBudget = phone ? PIXELS.phone : PIXELS.desktop;
  rs = window.RenderScale?.create({ canvas, maxDpr: 2, fracDesktop: 1, fracMobile: 1, maxPixels: pixelBudget }) || null;
}
function syncCanvas() {
  const r = S.renderer;
  if (r && (r.width !== canvas.width || r.height !== canvas.height)) {
    r.resize(canvas.width, canvas.height);
    invalidate(2);    // a new canvas size clears it
  }
}
export function relayout() {
  const { phone } = device();
  document.body.classList.toggle('phone', phone);
  if (!rs) makeScale();
  if (rs) rs.resize();
  else {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const k = Math.min(1, Math.sqrt(pixelBudget / Math.max(1, innerWidth * innerHeight * dpr * dpr)));
    canvas.width = Math.max(1, Math.round(innerWidth * dpr * k)); canvas.height = Math.max(1, Math.round(innerHeight * dpr * k));
  }
  syncCanvas();
  for (const it of S.ui.labels || []) it.w = 0;
  forgetBoxes();
  invalidate(3);
}

// Each frame (not in the saver): the frame-rate control of render-scale.js.
export function tickScale(t) {
  if (rs) { rs.tick(t); syncCanvas(); }
}

// QUALITY GOVERNOR (app/quality.js), every 2 s. level indexes QUALITY.
export const quality = { level: 0, good: 0 };
let govAt = 0;
export function governor(t) {
  const r = S.renderer;
  if (t - govAt < 2000 || !r) return;
  govAt = t;
  const g = med(r.info.gpuHist);
  if (!g) return;
  const next = stepQuality(quality, g);
  if (next === quality.level) return;
  const pixBefore = QUALITY[quality.level].pix;
  quality.level = next;
  S.renderScale = QUALITY[next].pix;
  if (QUALITY[next].pix !== pixBefore) {
    const { phone } = device();
    pixelBudget = Math.max(PIXELS.min, (phone ? PIXELS.phone : PIXELS.desktop) * QUALITY[next].pix);
    makeScale();
    relayout();
  }
  r.info.gpuHist.length = 0;
}

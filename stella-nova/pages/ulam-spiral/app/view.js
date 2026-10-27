// ============================================================================
//  ULAM SPIRAL  ·  app/view.js — canvas size and the clear area
// ----------------------------------------------------------------------------
//  The clear area is the canvas minus the overlays (function occlusion);
//  in the saver also minus the shell label plate (lib/saver-clear.js).
//  view() measures it once a frame and keeps the result in rt.VW. The
//  pixel ratio and the cell-loop cap come from fieldPlan (glsl.js): a
//  phone or a tablet reads fewer cells per frame than a desktop.
//
//  GREP MAP
//    grep -n 'export function initView'  the resize listener, the plate band
//    grep -n 'function resize'           canvas size, rt.dpr, rt.boxMax
//    grep -n 'function occlusion'        the overlay edges, or the plate
//    grep -n 'export function view'      { w, h, o, cx, cy, cw, ch }
// ============================================================================
import { fieldPlan } from '../glsl.js';
import { S, rt } from './state.js';
import { $, PHONE_Q, TOUCH_Q, cv, ov } from './dom.js';

function resize() {
  const w = cv.clientWidth, h = cv.clientHeight;
  ({ dpr: rt.dpr, boxMax: rt.boxMax } = fieldPlan({ w, h, dpr: window.devicePixelRatio || 1, touch: PHONE_Q.matches || TOUCH_Q.matches }));
  cv.width = Math.max(1, Math.round(w * rt.dpr)); cv.height = Math.max(1, Math.round(h * rt.dpr));
  ov.width = cv.width; ov.height = cv.height;
  S.dirty = true;
}

let OVERLAYS = [], plateBandFn = null, band = null, bandAt = -1e9;
export function initView() {
  addEventListener('resize', resize);
  resize();
  OVERLAYS = ['panel', 'dock', 'status', 'readout'].map($).filter(Boolean);
  import('../../../lib/saver-clear.js').then(m => { plateBandFn = m.plateBand; }).catch(() => { /* no shell: no plate */ });
}
function occlusion(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  if (!S.saver) {
    for (const el of OVERLAYS) {
      const q = el.getBoundingClientRect();
      const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right), y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
      if (x1 - x0 < 1 || y1 - y0 < 1 || getComputedStyle(el).display === 'none') continue;
      const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
      if (fw >= fh) { if (fw < 0.5) continue; if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1); }
      else { if (fh < 0.5) continue; if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0); }
    }
  } else if (plateBandFn) {
    const now = performance.now();
    if (now - bandAt > 250) { bandAt = now; band = plateBandFn(h); }
    if (band) {
      let t = band.t, b = band.b; const k = (t + b) / (0.65 * h);
      if (k > 1) { t /= k; b /= k; }
      o.t = t; o.b = b;
    }
  }
  return o;
}
export function view() {
  const w = cv.clientWidth, h = cv.clientHeight, o = occlusion(w, h);
  return (rt.VW = { w, h, o, cx: o.l + (w - o.l - o.r) / 2, cy: o.t + (h - o.t - o.b) / 2, cw: Math.max(40, w - o.l - o.r), ch: Math.max(40, h - o.t - o.b) });
}

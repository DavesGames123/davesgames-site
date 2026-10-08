// ============================================================================
//  ROCHE LIMIT  ·  app/occlusion.js — overlay margins for the framing
// ----------------------------------------------------------------------------
//  occlusion() measures the parts of the canvas that the page UI
//  covers, or the plate band of the screensaver. poseOf() in the
//  camera frames the view in the clear rest.
//
//  grep -n targets
//    margins .... "function occlusion"
// ============================================================================
import { plateBand } from '../../../lib/saver-clear.js';
import { $, PHONE_Q } from './env.js';
import { S } from './state.js';

// Overlay margins in CSS px. The bar covers the top; the story strip and
// the readout card (and the dock on a phone) cover the bottom; an open
// drawer covers its side. The saver uses the plate band instead.
let band = null, bandAt = -1e9;
export function occlusion(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  if (S.saverOn) {
    const now = performance.now();
    if (now - bandAt > 250) { bandAt = now; band = plateBand(h); }
    if (band) { let t = band.t, b = band.b; const k = (t + b) / (0.65 * h); if (k > 1) { t /= k; b /= k; } o.t = t; o.b = b; }
    return o;
  }
  const rect = id => { const el = $(id); if (!el || el.classList.contains('off') || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return null; const q = el.getBoundingClientRect(); return q.width > 1 && q.height > 1 ? q : null; };
  const bar = rect('bar'); if (bar) o.t = Math.max(o.t, Math.min(h * 0.3, bar.bottom));
  const ro = rect('readouts'); if (ro && ro.width < w * 0.6 && !PHONE_Q.matches) { /* a corner card: the moon may pass behind it, the planet stays clear */ }
  else if (ro && PHONE_Q.matches) o.t = Math.max(o.t, Math.min(h * 0.4, ro.bottom));
  for (const id of ['story', 'dock']) { const q = rect(id); if (q && q.top > h * 0.4) o.b = Math.max(o.b, Math.min(h * 0.45, h - q.top)); }
  for (const id of ['advanced', 'details']) {
    const q = rect(id); if (!q || PHONE_Q.matches) continue;
    if (q.left > w / 2) o.r = Math.max(o.r, w - q.left); else o.l = Math.max(o.l, q.right);
  }
  return o;
}

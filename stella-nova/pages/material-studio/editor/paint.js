// ============================================================================
//  MATERIAL STUDIO  ·  editor/paint.js — canvas 2D primitives
// ────────────────────────────────────────────────────────────────────────────
//  Small drawing helpers on the editor canvas context (state.js `cx`). They
//  set no transform and no style that the caller does not ask for.
//
//  GREP TARGETS
//      fitText ......... cut a string with an ellipsis to fit a width (cached)
//      checkerPattern .. the 16 px checker under node thumbnails
//      roundRect ....... a rounded rect path (arcTo fallback)
// ============================================================================
import { cx } from './state.js';

const textCache = new Map();
export function fitText(t, maxW) {
  const k = cx.font + '\u0000' + t + '\u0000' + Math.round(maxW);
  let r = textCache.get(k);
  if (r !== undefined) return r;
  if (textCache.size > 4000) textCache.clear();
  if (cx.measureText(t).width <= maxW) r = t;
  else {
    let lo = 0, hi = t.length;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cx.measureText(t.slice(0, m) + '…').width <= maxW) lo = m; else hi = m - 1; }
    r = t.slice(0, lo) + '…';
  }
  textCache.set(k, r);
  return r;
}
let checker = null;
export function checkerPattern() {
  if (checker) return checker;
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const k = c.getContext('2d');
  k.fillStyle = '#2a3140'; k.fillRect(0, 0, 16, 16);
  k.fillStyle = '#1e2430'; k.fillRect(0, 0, 8, 8); k.fillRect(8, 8, 8, 8);
  checker = cx.createPattern(c, 'repeat');
  return checker;
}
export function roundRect(x, y, w, h, r) {
  cx.beginPath();
  if (cx.roundRect) cx.roundRect(x, y, w, h, r);
  else { cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }
}

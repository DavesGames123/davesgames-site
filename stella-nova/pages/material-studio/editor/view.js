// ============================================================================
//  MATERIAL STUDIO  ·  editor/view.js — zoom, fit and the view center
// ────────────────────────────────────────────────────────────────────────────
//  Changes the pan/zoom transform (state.js `view`) and asks for a redraw.
//  The fit functions use the node sizes from layout.js. The skip-fit flag
//  lets selfTest load a graph back without a fit.
//
//  GREP TARGETS
//      zoomAt ........ zoom by a factor about a screen point
//      fitRect ....... fit a graph-space rect into the canvas
//      fitAll / fitSelection
//      sizeOf ........ {w, h} of a node (for graph.js bounds and layout)
//      unionRect ..... bounding rect of two rects
//      viewCenterG ... graph point under the canvas center (below the bar)
//      holdFit / takeSkipFit ... skip the fit on the next load
// ============================================================================
import * as G from '../graph.js';
import { state } from '../store.js';
import { view, toG, W, H, ZMIN, ZMAX } from './state.js';
import { layout } from './layout.js';
import { sel, selFrames } from './selection.js';
import { dirty } from './render.js';

export function zoomAt(sx, sy, f) {
  const s = Math.min(ZMAX, Math.max(ZMIN, view.s * f));
  const [gx, gy] = toG(sx, sy);
  view.s = s; view.tx = sx - gx * s; view.ty = sy - gy * s;
  dirty();
}
/** Fit a graph-space rect into the canvas. */
export function fitRect(r, pad = 40, maxS = 1.25) {
  if (!r || !W || !H) return;
  const s = Math.min(maxS, Math.max(ZMIN, Math.min((W - pad * 2) / Math.max(1, r.w), (H - pad * 2 - 26) / Math.max(1, r.h))));
  view.s = s;
  view.tx = W / 2 - (r.x + r.w / 2) * s;
  view.ty = (H + 26) / 2 - (r.y + r.h / 2) * s;
  dirty();
}
export function sizeOf(n) { const L = layout(n); return { w: L.w, h: L.h }; }
export function fitAll() {
  const g = state.graph; if (!g) return;
  let b = G.bounds(g, null, sizeOf);
  for (const f of g.frames) b = unionRect(b, f);
  fitRect(b);
}
export function fitSelection() {
  const g = state.graph; if (!g) return;
  if (!sel.size && !selFrames.size) return fitAll();
  let b = sel.size ? G.bounds(g, [...sel], sizeOf) : null;
  for (const f of g.frames) if (selFrames.has(f.id)) b = unionRect(b, f);
  fitRect(b, 60, 1.5);
}
export function unionRect(a, b) {
  if (!a) return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
export function viewCenterG() { return toG(W / 2, H / 2 + 13); }

let skipFit = false;
export function holdFit(on) { skipFit = on; }
/** True once after holdFit(true): the caller then skips its fit. */
export function takeSkipFit() { if (!skipFit) return false; skipFit = false; return true; }

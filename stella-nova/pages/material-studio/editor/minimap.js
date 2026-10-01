// ============================================================================
//  MATERIAL STUDIO  ·  editor/minimap.js — the minimap corner
// ────────────────────────────────────────────────────────────────────────────
//  Draws all frames and nodes, and the view rect, in the bottom-right corner
//  in screen space. It keeps the screen rect and the graph mapping of the
//  last draw, so a click or drag in the corner moves the view there.
//
//  GREP TARGETS
//      drawMinimap ... the corner box (skipped when the canvas is small)
//      inMinimap ..... true when a screen point is on the minimap
//      minimapTo ..... center the view on the graph point under (sx, sy)
// ============================================================================
import * as G from '../graph.js';
import { cx, W, H, view, toG, C, catColor, prefs } from './state.js';
import { layout } from './layout.js';
import { sizeOf, unionRect } from './view.js';
import { sel } from './selection.js';
import { errors } from './thumbs.js';
import { roundRect } from './paint.js';
import { dirty } from './render.js';

let mmRect = null, mmMap = null;
export function drawMinimap(g) {
  const mw = Math.min(176, W * 0.3), mh = Math.min(116, H * 0.3, mw * 0.7);
  if (mw < 70 || mh < 50 || !g.nodes.length) { mmRect = null; return; }
  const x0 = W - mw - 8, y0 = H - mh - 8;
  let b = G.bounds(g, null, sizeOf);
  for (const f of g.frames) b = unionRect(b, f);
  const [vx0, vy0] = toG(0, 0), [vx1, vy1] = toG(W, H);
  b = unionRect(b, { x: vx0, y: vy0, w: vx1 - vx0, h: vy1 - vy0 });
  const pad = 6;
  const k = Math.min((mw - pad * 2) / b.w, (mh - pad * 2) / b.h);
  const ox = x0 + pad + ((mw - pad * 2) - b.w * k) / 2, oy = y0 + pad + ((mh - pad * 2) - b.h * k) / 2;
  mmRect = { x: x0, y: y0, w: mw, h: mh };
  mmMap = { k, ox, oy, bx: b.x, by: b.y };
  cx.fillStyle = 'rgba(9,12,20,0.88)'; roundRect(x0, y0, mw, mh, 4); cx.fill();
  cx.strokeStyle = 'rgba(150,200,255,0.18)'; cx.lineWidth = 1; roundRect(x0 + 0.5, y0 + 0.5, mw - 1, mh - 1, 4); cx.stroke();
  for (const f of g.frames) { cx.strokeStyle = (f.color || '#5a8cc0') + '99'; cx.strokeRect(ox + (f.x - b.x) * k, oy + (f.y - b.y) * k, f.w * k, f.h * k); }
  for (const n of g.nodes) {
    const L = layout(n);
    cx.fillStyle = sel.has(n.id) ? C.sel : errors.has(n.id) ? C.err : catColor(L.def?.category);
    cx.globalAlpha = sel.has(n.id) ? 1 : 0.7;
    cx.fillRect(ox + (n.x - b.x) * k, oy + (n.y - b.y) * k, Math.max(1.5, L.w * k), Math.max(1.5, L.h * k));
  }
  cx.globalAlpha = 1;
  cx.strokeStyle = C.sel; cx.lineWidth = 1;
  cx.strokeRect(ox + (vx0 - b.x) * k + 0.5, oy + (vy0 - b.y) * k + 0.5, (vx1 - vx0) * k, (vy1 - vy0) * k);
}
export function inMinimap(sx, sy) { return prefs.minimap && mmRect && sx >= mmRect.x && sx <= mmRect.x + mmRect.w && sy >= mmRect.y && sy <= mmRect.y + mmRect.h; }
export function minimapTo(sx, sy) {
  if (!mmMap) return;
  const gx = (sx - mmMap.ox) / mmMap.k + mmMap.bx, gy = (sy - mmMap.oy) / mmMap.k + mmMap.by;
  view.tx = W / 2 - gx * view.s; view.ty = H / 2 - gy * view.s; dirty();
}

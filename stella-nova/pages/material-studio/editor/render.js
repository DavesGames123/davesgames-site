// ============================================================================
//  MATERIAL STUDIO  ·  editor/render.js — the frame: grid, frames, wires
// ────────────────────────────────────────────────────────────────────────────
//  dirty() asks for one draw on the next animation frame. render() draws the
//  grid, then in graph space the frames, the wires, the nodes (unselected
//  first) and the drag overlays, then the minimap in screen space. It skips
//  frames, wires and nodes outside the view. A change in the registry size
//  rebuilds the library.
//
//  GREP TARGETS
//      dirty / renderNow . request a draw / draw now and time it
//      render ............ the full frame
//      frameTime ......... ms of the last render
//      drawGrid .......... minor and major grid lines
//      drawFrame ......... a frame box, its label and resize grip
//      drawLinks ......... wires, implicit-cast dots; returns out-port types
//      drawOverlays ...... wire drag, box select, knife cut
// ============================================================================
import * as G from '../graph.js';
import { state } from '../store.js';
import { cx, W, H, dpr, view, toG, C, typeColor, FONT, HEAD, FRAME_HEAD, prefs } from './state.js';
import { layout, portPos, wireCtl } from './layout.js';
import { sel, selFrames } from './selection.js';
import { drag } from './pointer.js';
import { drawNode } from './node-draw.js';
import { drawMinimap } from './minimap.js';
import { fitText, roundRect } from './paint.js';
import { scheduleLib } from './library.js';
import { updateStatus } from './toolbar.js';

let raf = 0;
export let frameTime = 0;
let lastRegSize = -1;

export function dirty() { if (!raf) raf = requestAnimationFrame(render); }

/** Draw everything. Called from rAF (or directly by selfTest). */
function render() {
  raf = 0;
  const t0 = performance.now();
  const g = state.graph;
  if (!cx || !W || !H) return;
  if (state.registry.size !== lastRegSize) { lastRegSize = state.registry.size; scheduleLib(); }
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.fillStyle = C.bg; cx.fillRect(0, 0, W, H);
  drawGrid();
  if (!g) return;
  const s = view.s;
  cx.setTransform(dpr * s, 0, 0, dpr * s, dpr * view.tx, dpr * view.ty);
  const [vx0, vy0] = toG(0, 0), [vx1, vy1] = toG(W, H);
  const vis = r => r.x < vx1 && r.x + r.w > vx0 && r.y < vy1 && r.y + r.h > vy0;
  const byId = new Map();
  for (const n of g.nodes) byId.set(n.id, n);
  // frames
  for (const f of g.frames) if (vis(f)) drawFrame(f);
  // links
  const linkTypes = drawLinks(g, byId, vis);
  // nodes: unselected first, then selected on top
  const order = [];
  for (const n of g.nodes) if (!sel.has(n.id)) order.push(n);
  for (const n of g.nodes) if (sel.has(n.id)) order.push(n);
  const linkedIn = new Set(), linkedOut = new Set();
  for (const l of g.links) { linkedIn.add(l.to[0] + '\u0000' + l.to[1]); linkedOut.add(l.from[0] + '\u0000' + l.from[1]); }
  let visible = 0;
  for (const n of order) {
    const L = layout(n);
    if (!vis({ x: n.x - 8, y: n.y - 8, w: L.w + 16, h: L.h + 16 })) continue;
    visible++;
    drawNode(n, L, linkedIn, linkedOut, linkTypes);
  }
  drawOverlays(g, byId);
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (prefs.minimap) drawMinimap(g);
  frameTime = performance.now() - t0;
  updateStatus(visible);
}

/** Draw now and return the time in ms. */
export function renderNow() { if (raf) { cancelAnimationFrame(raf); raf = 0; } const t = performance.now(); render(); return performance.now() - t; }

function drawGrid() {
  const s = view.s;
  const step = s * 20 >= 9 ? 20 : s * 100 >= 9 ? 100 : 500;
  const major = step * 5;
  for (const [st, col] of [[step, C.grid], [major, C.gridMajor]]) {
    const px = st * s;
    if (px < 6) continue;
    cx.beginPath();
    let x = ((view.tx % px) + px) % px;
    for (; x < W; x += px) { cx.moveTo(Math.round(x) + 0.5, 0); cx.lineTo(Math.round(x) + 0.5, H); }
    let y = ((view.ty % px) + px) % px;
    for (; y < H; y += px) { cx.moveTo(0, Math.round(y) + 0.5); cx.lineTo(W, Math.round(y) + 0.5); }
    cx.strokeStyle = col; cx.lineWidth = 1; cx.stroke();
  }
}

function drawFrame(f) {
  const col = f.color || '#5a8cc0';
  const on = selFrames.has(f.id);
  cx.globalAlpha = 0.07; cx.fillStyle = col; roundRect(f.x, f.y, f.w, f.h, 6); cx.fill();
  cx.globalAlpha = 0.2; roundRect(f.x, f.y, f.w, FRAME_HEAD, 6); cx.fill();
  cx.globalAlpha = 1;
  cx.lineWidth = (on ? 2 : 1) / view.s; cx.strokeStyle = on ? C.sel : col + '88';
  roundRect(f.x, f.y, f.w, f.h, 6); cx.stroke();
  if (view.s > 0.18) {
    const fs = Math.max(12, 11 / Math.min(1, view.s));
    cx.font = `600 ${Math.min(fs, 40)}px ${FONT}`; cx.fillStyle = C.bright; cx.textBaseline = 'middle';
    cx.fillText(fitText(f.label || 'Frame', f.w - 24), f.x + 8, f.y + FRAME_HEAD / 2 + 0.5);
  }
  // resize grip
  cx.beginPath(); cx.moveTo(f.x + f.w - 2, f.y + f.h - 12); cx.lineTo(f.x + f.w - 2, f.y + f.h - 2); cx.lineTo(f.x + f.w - 12, f.y + f.h - 2);
  cx.strokeStyle = col; cx.lineWidth = 1.5 / view.s; cx.stroke();
}

function drawLinks(g, byId, vis) {
  const s = view.s;
  const lw = Math.max(1.8, 1.1 / s);
  const types = new Map(); // "node\0port" (out) -> effective type
  const eff = (id, port) => {
    const k = id + '\u0000' + port;
    if (!types.has(k)) types.set(k, G.portType(g, id, 'out', port) || 'texture');
    return types.get(k);
  };
  const hl = drag?.mode === 'nodes' && drag.insertLink;
  for (const l of g.links) {
    const a = byId.get(l.from[0]), b = byId.get(l.to[0]);
    if (!a || !b) continue;
    const p = portPos(a, 'out', l.from[1]) || [a.x + layout(a).w, a.y + HEAD / 2];
    const q = portPos(b, 'in', l.to[1]) || [b.x, b.y + HEAD / 2];
    const [c1x, c1y, c2x, c2y] = wireCtl(p[0], p[1], q[0], q[1]);
    const bx = Math.min(p[0], q[0], c2x), by = Math.min(p[1], q[1]);
    if (!vis({ x: bx, y: by, w: Math.max(p[0], q[0], c1x) - bx, h: Math.max(p[1], q[1]) - by + 1 })) continue;
    const ft = eff(l.from[0], l.from[1]);
    const on = sel.has(a.id) || sel.has(b.id);
    const hot = hl && hl === l;
    const dim = drag?.mode === 'wire' && drag.detached === l;
    if (dim) continue;
    cx.beginPath(); cx.moveTo(p[0], p[1]); cx.bezierCurveTo(c1x, c1y, c2x, c2y, q[0], q[1]);
    cx.strokeStyle = hot ? C.bright : typeColor(ft);
    cx.globalAlpha = on || hot ? 1 : 0.62;
    cx.lineWidth = on || hot ? lw * 1.6 : lw;
    cx.stroke();
    cx.globalAlpha = 1;
    // implicit cast: a dot of the target type at the input end
    if (s > 0.35) {
      const tt = G.portType(g, b.id, 'in', l.to[1]);
      if (tt && tt !== ft && ft !== 'any' && tt !== 'any') {
        cx.beginPath(); cx.arc(q[0] - 9, q[1], 2.4, 0, Math.PI * 2); cx.fillStyle = typeColor(tt); cx.fill();
      }
    }
  }
  return types;
}

function drawOverlays(g, byId) {
  const s = view.s;
  if (drag?.mode === 'wire') {
    let a = drag.anchor, b = [drag.gx, drag.gy];
    if (drag.target) { const n = byId.get(drag.target[0]); const pp = n && portPos(n, drag.target[2], drag.target[1]); if (pp) b = pp; }
    let p = a, q = b;
    if (drag.dir === 'in') { p = b; q = a; }
    const [c1x, c1y, c2x, c2y] = wireCtl(p[0], p[1], q[0], q[1]);
    cx.beginPath(); cx.moveTo(p[0], p[1]); cx.bezierCurveTo(c1x, c1y, c2x, c2y, q[0], q[1]);
    cx.strokeStyle = typeColor(drag.type === 'any' ? 'float' : drag.type); cx.lineWidth = Math.max(2, 1.4 / s);
    cx.setLineDash(drag.target ? [] : [6 / s, 4 / s]); cx.stroke(); cx.setLineDash([]);
  }
  if (drag?.mode === 'box' && drag.moved) {
    const x = Math.min(drag.gx0, drag.gx), y = Math.min(drag.gy0, drag.gy);
    cx.fillStyle = 'rgba(150,200,255,0.06)'; cx.fillRect(x, y, Math.abs(drag.gx - drag.gx0), Math.abs(drag.gy - drag.gy0));
    cx.lineWidth = 1 / s; cx.strokeStyle = 'rgba(150,200,255,0.6)'; cx.setLineDash([4 / s, 3 / s]);
    cx.strokeRect(x, y, Math.abs(drag.gx - drag.gx0), Math.abs(drag.gy - drag.gy0)); cx.setLineDash([]);
  }
  if (drag?.mode === 'cut' && drag.path.length > 1) {
    cx.beginPath(); cx.moveTo(drag.path[0][0], drag.path[0][1]);
    for (const [x, y] of drag.path) cx.lineTo(x, y);
    cx.strokeStyle = C.err; cx.lineWidth = 1.5 / s; cx.setLineDash([5 / s, 4 / s]); cx.stroke(); cx.setLineDash([]);
  }
}

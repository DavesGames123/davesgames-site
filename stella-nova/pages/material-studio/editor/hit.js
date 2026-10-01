// ============================================================================
//  MATERIAL STUDIO  ·  editor/hit.js — what is under a graph point
// ────────────────────────────────────────────────────────────────────────────
//  Hit tests in graph units against the cached layout (layout.js). The
//  tolerances are in screen px and are divided by the zoom. Nodes are tested
//  top first: selected nodes draw last, so they are tested first.
//
//  GREP TARGETS
//      hitPort ........ nearest port within a tolerance ('in', 'out' or both)
//      hitNode ........ topmost node and part (chevron, head, preview, row, param)
//      hitFrame ....... frame and part (resize, head, body)
//      hitLink ........ nearest wire within a tolerance
//      linksCrossing .. wires that a knife path crosses
//      segDist2 / segCross ... segment math
// ============================================================================
import { state } from '../store.js';
import { view, HEAD, ROW, FRAME_HEAD } from './state.js';
import { layout, linkPoly } from './layout.js';
import { sel } from './selection.js';

/** Nearest port within `tolPx` screen px. side: 'in' | 'out' | undefined (both). */
export function hitPort(gx, gy, side, tolPx = 9) {
  const g = state.graph; if (!g) return null;
  const tol = tolPx / view.s;
  let best = null, bd = tol * tol;
  for (let i = g.nodes.length - 1; i >= 0; i--) {
    const n = g.nodes[i];
    const L = layout(n);
    if (gx < n.x - tol || gx > n.x + L.w + tol || gy < n.y - tol || gy > n.y + L.h + tol) continue;
    if (n.collapsed && !L.reroute) continue;
    const t = L.reroute ? Math.min(tol, 5 / view.s) : tol;
    for (const sd of side ? [side] : ['in', 'out']) {
      for (const [pid, p] of (sd === 'in' ? L.ins : L.outs)) {
        const d = (n.x + p.x - gx) ** 2 + (n.y + p.y - gy) ** 2;
        if (d < bd && d < t * t) { bd = d; best = { node: n, side: sd, pid, port: p.port }; }
      }
    }
  }
  return best;
}
/** Topmost node under a point, with what part was hit. */
export function hitNode(gx, gy) {
  const g = state.graph; if (!g) return null;
  // selected nodes draw last, so test them first
  const test = n => {
    const L = layout(n);
    if (gx < n.x || gx > n.x + L.w || gy < n.y || gy > n.y + L.h) return null;
    const lx = gx - n.x, ly = gy - n.y;
    if (L.reroute) return { node: n, part: 'body', L };
    if (ly < HEAD) return { node: n, part: lx < 17 ? 'chevron' : 'head', L };
    if (L.preview && ly >= L.preview.y && ly < L.preview.y + L.preview.h) return { node: n, part: 'preview', L };
    for (const r of L.rows) {
      if (ly >= r.y && ly < r.y + ROW) {
        if (r.kind === 'param' && lx >= 8 && lx <= L.w - 8) return { node: n, part: 'param', p: r.p, row: r, L };
        return { node: n, part: r.kind, row: r, L };
      }
    }
    return { node: n, part: 'body', L };
  };
  const selected = g.nodes.filter(n => sel.has(n.id));
  for (let i = selected.length - 1; i >= 0; i--) { const h = test(selected[i]); if (h) return h; }
  for (let i = g.nodes.length - 1; i >= 0; i--) { if (sel.has(g.nodes[i].id)) continue; const h = test(g.nodes[i]); if (h) return h; }
  return null;
}
export function hitFrame(gx, gy) {
  const g = state.graph; if (!g) return null;
  for (let i = g.frames.length - 1; i >= 0; i--) {
    const f = g.frames[i];
    if (gx < f.x || gx > f.x + f.w || gy < f.y || gy > f.y + f.h) continue;
    const c = 14 / Math.max(view.s, 0.5);
    if (gx > f.x + f.w - c && gy > f.y + f.h - c) return { frame: f, part: 'resize' };
    if (gy < f.y + FRAME_HEAD / Math.min(1, Math.max(view.s, 0.4))) return { frame: f, part: 'head' };
    return { frame: f, part: 'body' };
  }
  return null;
}
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / ((dx * dx + dy * dy) || 1)));
  return (ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2;
}
export function hitLink(gx, gy, tolPx = 6, skip) {
  const g = state.graph; if (!g) return null;
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  const tol = tolPx / view.s;
  let best = null, bd = tol * tol;
  for (const l of g.links) {
    if (skip && skip(l)) continue;
    const pts = linkPoly(l, byId); if (!pts) continue;
    for (let i = 1; i < pts.length; i++) {
      const d = segDist2(gx, gy, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      if (d < bd) { bd = d; best = l; }
    }
  }
  return best;
}
function segCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
export function linksCrossing(path) {
  const g = state.graph; if (!g || path.length < 2) return [];
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  const out = [];
  for (const l of g.links) {
    const pts = linkPoly(l, byId); if (!pts) continue;
    let hit = false;
    for (let i = 1; i < pts.length && !hit; i++) for (let j = 1; j < path.length && !hit; j++) if (segCross(pts[i - 1], pts[i], path[j - 1], path[j])) hit = true;
    if (hit) out.push(l);
  }
  return out;
}

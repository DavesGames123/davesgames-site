// ============================================================================
//  MATERIAL STUDIO  ·  editor/layout.js — node and wire geometry
// ────────────────────────────────────────────────────────────────────────────
//  Gives the size of a node and the positions of its rows and ports, in graph
//  units relative to (node.x, node.y). The result is cached per node object
//  and is calculated again when the type, the collapse state, the preview
//  state or the def changes. It also gives the bezier of a wire, for draw
//  and for hit tests.
//
//  GREP TARGETS
//      inlineParams ... params that show as widgets on the node
//      previewOn ...... true when a node shows a thumbnail square
//      layout ......... {w,h,def,missing,reroute,rows,ins,outs,preview}
//      portPos ........ graph position of one port
//      wireCtl ........ bezier control points of a wire
//      linkPoly ....... a link sampled to a polyline (hit tests)
// ============================================================================
import { OUTPUT_TYPE } from '../contract.js';
import * as G from '../graph.js';
import { state } from '../store.js';
import { NODE_W, OUT_W, HEAD, ROW, PREV, THUMB, RR, INLINE_KINDS, prefs } from './state.js';

const layCache = new WeakMap();

/** The params that show as inline widgets: def.inline ids, else the first 3 inline kinds. */
export function inlineParams(def) {
  if (!def?.params?.length) return [];
  if (Array.isArray(def.inline)) return def.inline.map(id => def.params.find(p => p.id === id)).filter(Boolean);
  if (def.type === OUTPUT_TYPE) return [];
  return def.params.filter(p => INLINE_KINDS.has(p.kind)).slice(0, 3);
}
export function previewOn(node, def) {
  return prefs.preview && node.preview !== false && !!def && !def.reroute
    && node.type !== OUTPUT_TYPE && (def.outputs || []).length > 0;
}

/**
 * Node geometry in graph units, relative to (node.x, node.y).
 * @returns {{w,h,def,missing,reroute,rows:Array,ins:Map,outs:Map,preview:{x,y,w,h}|null}}
 *   rows: {kind:'out'|'in'|'param', y, port?, p?}; ins/outs: portId -> {x, y, port}
 */
export function layout(node) {
  const g = state.graph;
  const def = G.getDef(node.type);
  const pv = previewOn(node, def);
  const key = `${node.type}|${node.collapsed ? 1 : 0}|${pv ? 1 : 0}|${def ? 1 : 0}`;
  const c = layCache.get(node);
  if (c && c.key === key && def) return c.L;
  const ports = G.nodePorts(g, node);
  const L = { w: NODE_W, h: HEAD, def, missing: ports.missing, reroute: !!def?.reroute, rows: [], ins: new Map(), outs: new Map(), preview: null };
  if (L.reroute) {
    L.w = RR; L.h = RR;
    for (const p of ports.inputs) L.ins.set(p.id, { x: 0, y: RR / 2, port: p });
    for (const p of ports.outputs) L.outs.set(p.id, { x: RR, y: RR / 2, port: p });
  } else {
    if (node.type === OUTPUT_TYPE) L.w = OUT_W;
    if (node.collapsed) {
      for (const p of ports.inputs) L.ins.set(p.id, { x: 0, y: HEAD / 2, port: p });
      for (const p of ports.outputs) L.outs.set(p.id, { x: L.w, y: HEAD / 2, port: p });
    } else {
      let y = HEAD;
      if (pv) { L.preview = { x: (L.w - THUMB) / 2, y: y + 4, w: THUMB, h: THUMB }; y += PREV; }
      for (const p of ports.outputs) { L.rows.push({ kind: 'out', y, port: p }); L.outs.set(p.id, { x: L.w, y: y + ROW / 2, port: p }); y += ROW; }
      for (const p of inlineParams(def)) { L.rows.push({ kind: 'param', y, p }); y += ROW; }
      for (const p of ports.inputs) { L.rows.push({ kind: 'in', y, port: p }); L.ins.set(p.id, { x: 0, y: y + ROW / 2, port: p }); y += ROW; }
      L.h = y + 5;
    }
  }
  if (def) layCache.set(node, { key, L });
  return L;
}
export function portPos(node, side, id) {
  const L = layout(node);
  const p = (side === 'in' ? L.ins : L.outs).get(id);
  return p ? [node.x + p.x, node.y + p.y] : null;
}

/** Bezier control points for a wire from (x1,y1) to (x2,y2). */
export function wireCtl(x1, y1, x2, y2) {
  const dx = Math.max(36, Math.abs(x2 - x1) * 0.5, x2 < x1 ? Math.min(160, (x1 - x2) * 0.6 + 40) : 0);
  return [x1 + dx, y1, x2 - dx, y2];
}
/** Sampled polyline of a link in graph units. */
export function linkPoly(l, byId) {
  const a = byId.get(l.from[0]), b = byId.get(l.to[0]);
  if (!a || !b) return null;
  const p = portPos(a, 'out', l.from[1]), q = portPos(b, 'in', l.to[1]);
  if (!p || !q) return null;
  const [c1x, c1y, c2x, c2y] = wireCtl(p[0], p[1], q[0], q[1]);
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, u = 1 - t;
    pts.push([u * u * u * p[0] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * q[0], u * u * u * p[1] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * q[1]]);
  }
  return pts;
}

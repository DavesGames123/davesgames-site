// ============================================================================
//  MATERIAL STUDIO  ·  editor.js — the node graph editor (canvas 2D)
// ────────────────────────────────────────────────────────────────────────────
//  Owner: GRAPH-EDITOR agent. Draws state.graph into #graph-wrap on one 2D
//  canvas and turns pointer, wheel, touch and key input into graph.js
//  actions. It also fills the node library in #lib-body. It never changes
//  the graph directly: every edit goes through graph.js `actions` (or a
//  raw position change during a drag, closed by actions.commit), so undo,
//  'graph:changed' and 'graph:layout' stay in one place.
//
//  DATA FLOW
//      state.graph ─▶ layout(node) (cached per node object) ─▶ render()
//      pointer / keys ─▶ drag modes ─▶ graph.js actions ─▶ store events
//      'graph:changed' / 'graph:layout' / 'graph:select' ─▶ dirty() ─▶ rAF
//      'bake:done' ─▶ thumbGen++ ─▶ __studio.bake.thumb(nodeId) per visible
//                     node ─▶ thumbs cache ─▶ node preview square
//      'bake:error' {nodeId} ─▶ red outline on that node
//
//  SECTIONS  (grep -n the name to jump)
//      CONSTANTS .......... sizes, category colors, keys
//      VIEW ............... pan / zoom transform, fit, zoomAt
//      LAYOUT ............. layout(node): size, port and row positions
//      SELECTION .......... setSel, selected ids, frames
//      THUMBS ............. live thumbnails from __studio.bake.thumb
//      RENDER ............. grid, frames, links, nodes, overlays, minimap
//      HIT TEST ........... hitPort / hitNode / hitFrame / hitLink
//      POINTER ............ drag modes: pan nodes box wire cut param frame pinch
//      WHEEL .............. trackpad pan, pinch zoom, mouse-wheel zoom
//      KEYS ............... shortcuts (see KEYMAP)
//      CLIPBOARD .......... copy / paste through localStorage + system clipboard
//      PALETTE ............ searchable add-node box, type filtered on wire drop
//      MENU ............... context menu and enum menus
//      INLINE INPUT ....... rename, typed values, color picker
//      TOOLBAR ............ breadcrumb, tool buttons, status line
//      LIBRARY ............ the #lib-body node list (search, groups, drag);
//                           it stands down when panels.js owns #lib-body
//      SHORTCUTS / API .... __studio.editor (touch, addNodeAt, screenToGraph,
//                           panBy, shortcuts, focusNode, stress, selfTest)
//      init
//
//  KEYMAP  (when the graph has focus or the pointer is over it)
//      Tab / Space / Shift+A  add-node palette     Del / Backspace  delete
//      Ctrl+Del               dissolve (keep wire) Ctrl+D  duplicate
//      Ctrl+Shift+D           duplicate + inputs   Ctrl+C / X / V  clipboard
//      Ctrl+A / Alt+A         select all / none    Ctrl+I  invert selection
//      F  frame selection     Home / Shift+F  frame all     H  collapse
//      P  toggle preview      Ctrl+G  frame (group) the selection
//      L  auto layout         M  minimap           arrows  nudge (Shift x10)
//      F2 rename              Esc  cancel / close  Ctrl+Z / Y  (main.js)
//  MOUSE
//      left drag empty: box select (Shift add, Ctrl toggle) · middle or
//      Alt+left drag: pan · right drag: cut wires · right click: menu ·
//      wheel: zoom (mouse) or pan (trackpad) · pinch: zoom · Alt+drag node:
//      duplicate · drop a lone node on a wire: insert · double-click wire:
//      reroute dot · double-click empty: palette · drop wire on empty: palette
// ============================================================================
import { PORT_COLORS, OUTPUT_TYPE, NODE_CATEGORIES } from './contract.js';
import * as G from './graph.js';
import { state, on, select as storeSelect, toast } from './store.js';

// ------------------------------------------------------------ CONSTANTS
const NODE_W = 168, OUT_W = 184, HEAD = 20, ROW = 18, PREV = 88, THUMB = 80, RR = 18;
const PORT_R = 4.5, SNAP = 10, FRAME_HEAD = 22;
const ZMIN = 0.08, ZMAX = 3;
const INLINE_KINDS = new Set(['slider', 'int', 'color', 'enum', 'bool', 'vec2']);
const CLIP_KEY = 'material-studio.clipboard';
const PREF_KEY = 'material-studio.editor';
const RECENT_KEY = 'material-studio.recent';
const LIB_KEY = 'material-studio.lib-open';
const FONT = '"IBM Plex Sans", system-ui, -apple-system, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

/** Category colors (header stripe, library dot, minimap). */
export const CATEGORY_COLORS = Object.freeze({
  Output: '#ff6a6a', Input: '#96c8ff', Generator: '#64c864', Noise: '#7ad0c0', Pattern: '#4fb39a',
  Math: '#a0a8b8', Vector: '#b090ff', Color: '#ffc832', Adjust: '#e0a050', Blend: '#ff9a4a',
  Filter: '#d080c0', 'Height & Normal': '#8a9cff', Transform: '#60a0d0', Utility: '#708090', Bench: '#ff8a5c',
});
const catColor = c => CATEGORY_COLORS[c] || '#8090b0';
const C = {
  bg: '#0e1118', grid: 'rgba(150,200,255,0.035)', gridMajor: 'rgba(150,200,255,0.07)',
  node: '#1a2030', nodeHead: '#202838', border: 'rgba(150,200,255,0.16)', borderHover: 'rgba(150,200,255,0.4)',
  sel: '#ffc832', err: '#ff6a6a', text: '#c8d0e0', dim: '#8090b0', faint: '#506080', bright: '#e8ecf4',
  widget: '#10141d', widgetHover: '#151b27',
};

let wrap, cv, cx, bar, crumbs, statusEl, palEl, menuEl, colorEl, inlineEl;
let W = 0, H = 0, dpr = 1;
let raf = 0;
const prefs = { minimap: true, preview: true, snap: true, boxMode: false };

// ------------------------------------------------------------ VIEW
const view = { s: 1, tx: 0, ty: 0 };
const toG = (sx, sy) => [(sx - view.tx) / view.s, (sy - view.ty) / view.s];
const toS = (gx, gy) => [gx * view.s + view.tx, gy * view.s + view.ty];

function zoomAt(sx, sy, f) {
  const s = Math.min(ZMAX, Math.max(ZMIN, view.s * f));
  const [gx, gy] = toG(sx, sy);
  view.s = s; view.tx = sx - gx * s; view.ty = sy - gy * s;
  dirty();
}
/** Fit a graph-space rect into the canvas. */
function fitRect(r, pad = 40, maxS = 1.25) {
  if (!r || !W || !H) return;
  const s = Math.min(maxS, Math.max(ZMIN, Math.min((W - pad * 2) / Math.max(1, r.w), (H - pad * 2 - 26) / Math.max(1, r.h))));
  view.s = s;
  view.tx = W / 2 - (r.x + r.w / 2) * s;
  view.ty = (H + 26) / 2 - (r.y + r.h / 2) * s;
  dirty();
}
const sizeOf = n => { const L = layout(n); return { w: L.w, h: L.h }; };
function fitAll() {
  const g = state.graph; if (!g) return;
  let b = G.bounds(g, null, sizeOf);
  for (const f of g.frames) b = unionRect(b, f);
  fitRect(b);
}
function fitSelection() {
  const g = state.graph; if (!g) return;
  if (!sel.size && !selFrames.size) return fitAll();
  let b = sel.size ? G.bounds(g, [...sel], sizeOf) : null;
  for (const f of g.frames) if (selFrames.has(f.id)) b = unionRect(b, f);
  fitRect(b, 60, 1.5);
}
function unionRect(a, b) {
  if (!a) return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
function viewCenterG() { return toG(W / 2, H / 2 + 13); }

// ------------------------------------------------------------ LAYOUT
const layCache = new WeakMap();

/** The params that show as inline widgets: def.inline ids, else the first 3 inline kinds. */
function inlineParams(def) {
  if (!def?.params?.length) return [];
  if (Array.isArray(def.inline)) return def.inline.map(id => def.params.find(p => p.id === id)).filter(Boolean);
  if (def.type === OUTPUT_TYPE) return [];
  return def.params.filter(p => INLINE_KINDS.has(p.kind)).slice(0, 3);
}
const previewOn = (node, def) => prefs.preview && node.preview !== false && !!def && !def.reroute
  && node.type !== OUTPUT_TYPE && (def.outputs || []).length > 0;

/**
 * Node geometry in graph units, relative to (node.x, node.y).
 * @returns {{w,h,def,missing,reroute,rows:Array,ins:Map,outs:Map,preview:{x,y,w,h}|null}}
 *   rows: {kind:'out'|'in'|'param', y, port?, p?}; ins/outs: portId -> {x, y, port}
 */
function layout(node) {
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
function portPos(node, side, id) {
  const L = layout(node);
  const p = (side === 'in' ? L.ins : L.outs).get(id);
  return p ? [node.x + p.x, node.y + p.y] : null;
}

// ------------------------------------------------------------ SELECTION
let sel = new Set();
let selFrames = new Set();
let lastEmitted = '';
function setSel(ids, opts = {}) {
  sel = new Set(ids);
  if (!opts.keepFrames) selFrames = new Set();
  const key = [...sel].sort().join(',');
  if (opts.emit !== false && key !== lastEmitted) { lastEmitted = key; storeSelect([...sel]); }
  else if (opts.emit === false) lastEmitted = key;
  dirty();
}
function pruneSel() {
  const g = state.graph; if (!g) return;
  const ids = new Set(g.nodes.map(n => n.id)), fids = new Set(g.frames.map(f => f.id));
  const keep = [...sel].filter(id => ids.has(id));
  selFrames = new Set([...selFrames].filter(id => fids.has(id)));
  if (keep.length !== sel.size) setSel(keep, { keepFrames: true });
}

// ------------------------------------------------------------ THUMBS
const thumbs = new Map();   // nodeId -> {img, gen}
const thumbBusy = new Set();
const thumbQueue = new Set();
let thumbGen = 0, thumbTimer = 0;
const errors = new Map();   // nodeId -> message

function wantThumb(id) {
  const t = thumbs.get(id);
  if ((t && t.gen === thumbGen) || thumbBusy.has(id)) return;
  thumbQueue.add(id);
  if (!thumbTimer) thumbTimer = setTimeout(pumpThumbs, 30);
}
function pumpThumbs() {
  thumbTimer = 0;
  const bake = window.__studio?.bake;
  if (!bake || typeof bake.thumb !== 'function') { thumbQueue.clear(); return; }
  let n = 0;
  for (const id of thumbQueue) {
    if (n++ >= 8) break;
    thumbQueue.delete(id);
    const gen = thumbGen;
    thumbBusy.add(id);
    let r;
    try { r = bake.thumb(id); } catch (e) { r = null; }
    Promise.resolve(r).then(img => {
      thumbBusy.delete(id);
      if (img && typeof ImageData !== 'undefined' && img instanceof ImageData) {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').putImageData(img, 0, 0); img = c;
      }
      const old = thumbs.get(id);
      thumbs.set(id, { img: img || old?.img || null, gen });
      if (img) dirty();
    }, () => { thumbBusy.delete(id); thumbs.set(id, { img: thumbs.get(id)?.img || null, gen }); });
  }
  if (thumbQueue.size) thumbTimer = setTimeout(pumpThumbs, 30);
}

// ------------------------------------------------------------ RENDER
function dirty() { if (!raf) raf = requestAnimationFrame(render); }

const textCache = new Map();
function fitText(t, maxW) {
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
function checkerPattern() {
  if (checker) return checker;
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const k = c.getContext('2d');
  k.fillStyle = '#2a3140'; k.fillRect(0, 0, 16, 16);
  k.fillStyle = '#1e2430'; k.fillRect(0, 0, 8, 8); k.fillRect(8, 8, 8, 8);
  checker = cx.createPattern(c, 'repeat');
  return checker;
}
const fmtNum = (v, p) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v ?? '');
  const step = p?.step || (p?.kind === 'int' ? 1 : 0.001);
  const d = Math.min(4, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
  return v.toFixed(p?.kind === 'int' ? 0 : d);
};
const fmtDefault = d => Array.isArray(d) ? d.map(x => +(+x).toFixed(2)).join(' ') : (typeof d === 'number' ? +d.toFixed(3) + '' : '');
const typeColor = t => PORT_COLORS[t] || '#8090b0';
const hexOk = h => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h);
function roundRect(x, y, w, h, r) {
  cx.beginPath();
  if (cx.roundRect) cx.roundRect(x, y, w, h, r);
  else { cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }
}

let hover = null;                // {kind, id, port?, side?, row?} under the pointer
let mouse = { sx: -1, sy: -1, inside: false };
let drag = null;
let frameTime = 0;
let lastRegSize = -1;

/** Draw everything. Called from rAF (or directly by selfTest). */
function render() {
  raf = 0;
  const t0 = performance.now();
  const g = state.graph;
  if (!cx || !W || !H) return;
  if (state.registry.size !== lastRegSize) { lastRegSize = state.registry.size; libDirty = true; scheduleLib(); }
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

/** Bezier control points for a wire from (x1,y1) to (x2,y2). */
function wireCtl(x1, y1, x2, y2) {
  const dx = Math.max(36, Math.abs(x2 - x1) * 0.5, x2 < x1 ? Math.min(160, (x1 - x2) * 0.6 + 40) : 0);
  return [x1 + dx, y1, x2 - dx, y2];
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

function drawPort(x, y, type, linked, state0) {
  const r = PORT_R;
  if (state0 === 'off') cx.globalAlpha = 0.18;
  cx.beginPath(); cx.arc(x, y, state0 === 'hot' ? r + 2 : r, 0, Math.PI * 2);
  cx.fillStyle = linked || state0 === 'hot' ? typeColor(type) : C.node;
  cx.fill();
  cx.lineWidth = 1.5; cx.strokeStyle = typeColor(type); cx.stroke();
  if (state0 === 'ok') { cx.beginPath(); cx.arc(x, y, r + 3.5, 0, Math.PI * 2); cx.lineWidth = 1; cx.strokeStyle = typeColor(type) + 'aa'; cx.stroke(); }
  cx.globalAlpha = 1;
}

/** Port state during a wire drag: 'ok' (compatible), 'off', 'hot' (snap target) or ''. */
function portState(node, side, pid) {
  if (drag?.mode !== 'wire') return '';
  const tgt = drag.target;
  if (tgt && tgt[0] === node.id && tgt[1] === pid && tgt[2] === side) return 'hot';
  const need = drag.dir === 'out' ? 'in' : 'out';
  if (side !== need) return 'off';
  return drag.okPorts?.has(node.id + '\u0000' + pid) ? 'ok' : 'off';
}

function drawNode(n, L, linkedIn, linkedOut, linkTypes) {
  const s = view.s;
  const def = L.def;
  const g = state.graph;
  const isSel = sel.has(n.id);
  const isHover = hover && hover.id === n.id;
  const err = errors.get(n.id);
  const col = L.missing ? C.err : catColor(def?.category);
  if (L.reroute) {
    const t = G.portType(g, n.id, 'out', 'out');
    const c = t === 'any' ? '#8090b0' : typeColor(t);
    cx.beginPath(); cx.arc(n.x + RR / 2, n.y + RR / 2, 5.5, 0, Math.PI * 2);
    cx.fillStyle = c; cx.fill();
    if (isSel || isHover) { cx.lineWidth = 2 / s; cx.strokeStyle = isSel ? C.sel : C.bright; cx.stroke(); }
    if (drag?.mode === 'wire') {
      const st = portState(n, drag.dir === 'out' ? 'in' : 'out', drag.dir === 'out' ? 'in' : 'out');
      if (st === 'ok' || st === 'hot') { cx.beginPath(); cx.arc(n.x + RR / 2, n.y + RR / 2, 9, 0, Math.PI * 2); cx.lineWidth = 1.2 / s; cx.strokeStyle = c; cx.stroke(); }
    }
    return;
  }
  const w = L.w, h = L.h;
  // body
  if (isSel && s > 0.3) { cx.shadowColor = 'rgba(255,200,50,0.25)'; cx.shadowBlur = 12 * s; }
  cx.fillStyle = C.node; roundRect(n.x, n.y, w, h, 4); cx.fill();
  cx.shadowBlur = 0; cx.shadowColor = 'transparent';
  // header
  cx.fillStyle = C.nodeHead; roundRect(n.x, n.y, w, HEAD, n.collapsed ? 4 : [4, 4, 0, 0]); cx.fill();
  cx.fillStyle = col; cx.globalAlpha = 0.9; cx.fillRect(n.x, n.y + 3, 3, HEAD - 6); cx.globalAlpha = 0.14;
  roundRect(n.x, n.y, w, HEAD, n.collapsed ? 4 : [4, 4, 0, 0]); cx.fill(); cx.globalAlpha = 1;
  // border
  cx.lineWidth = (isSel || err ? 1.6 : 1) / s;
  cx.strokeStyle = err ? C.err : isSel ? C.sel : isHover ? C.borderHover : C.border;
  roundRect(n.x, n.y, w, h, 4); cx.stroke();
  const lod = s >= 0.42, lodLow = s >= 0.22;
  if (lodLow) {
    // collapse chevron + title + badges
    cx.fillStyle = C.dim; cx.beginPath();
    if (n.collapsed) { cx.moveTo(n.x + 8, n.y + 6); cx.lineTo(n.x + 12, n.y + 10); cx.lineTo(n.x + 8, n.y + 14); }
    else { cx.moveTo(n.x + 6, n.y + 8); cx.lineTo(n.x + 14, n.y + 8); cx.lineTo(n.x + 10, n.y + 12); }
    cx.fill();
    let badge = '';
    if (def?.pass) badge = 'PASS';
    if (def?.source === 'bench' || n.type.startsWith('bench.')) badge = 'BENCH';
    if (L.missing) badge = 'MISSING';
    cx.textBaseline = 'middle';
    let bw = 0;
    if (badge && lod) {
      cx.font = `500 8px ${MONO}`;
      bw = cx.measureText(badge).width + 6;
      cx.fillStyle = L.missing ? C.err : badge === 'BENCH' ? '#ff8a5c' : '#5a8cc0';
      cx.globalAlpha = 0.25; roundRect(n.x + w - bw - 5, n.y + 5, bw, 10, 2); cx.fill(); cx.globalAlpha = 1;
      cx.fillStyle = L.missing ? C.err : C.text; cx.fillText(badge, n.x + w - bw - 2, n.y + 10.5);
    }
    cx.font = `600 11px ${FONT}`; cx.fillStyle = C.bright;
    const title = n.label || (L.missing ? n.type : def?.label || n.type);
    cx.fillText(fitText(title, w - 24 - bw - 6), n.x + 18, n.y + HEAD / 2 + 0.5);
  }
  if (!n.collapsed) {
    // preview
    if (L.preview) {
      const p = L.preview;
      const t = thumbs.get(n.id);
      if (!t || t.gen !== thumbGen) wantThumb(n.id);
      cx.fillStyle = checkerPattern(); cx.fillRect(n.x + p.x, n.y + p.y, p.w, p.h);
      if (t?.img) {
        try { cx.imageSmoothingEnabled = true; cx.drawImage(t.img, n.x + p.x, n.y + p.y, p.w, p.h); } catch (e) { /* closed bitmap */ }
      } else if (lod) {
        cx.fillStyle = col; cx.globalAlpha = 0.12; cx.fillRect(n.x + p.x, n.y + p.y, p.w, p.h); cx.globalAlpha = 0.55;
        cx.font = `500 9px ${MONO}`; cx.textAlign = 'center'; cx.fillStyle = C.dim;
        cx.fillText(def?.pass ? 'pass' : 'no preview', n.x + p.x + p.w / 2, n.y + p.y + p.h / 2);
        cx.textAlign = 'left'; cx.globalAlpha = 1;
      }
      cx.lineWidth = 1 / s; cx.strokeStyle = C.border; cx.strokeRect(n.x + p.x, n.y + p.y, p.w, p.h);
    }
    // rows
    for (const r of L.rows) {
      const y = n.y + r.y, cy = y + ROW / 2;
      if (r.kind === 'out') {
        const t = linkTypes.get(n.id + '\u0000' + r.port.id) || r.port.type;
        if (lod) { cx.font = `400 10.5px ${FONT}`; cx.fillStyle = C.text; cx.textAlign = 'right'; cx.fillText(fitText(r.port.label || r.port.id, w - 20), n.x + w - 10, cy + 0.5); cx.textAlign = 'left'; }
        drawPort(n.x + w, cy, t, linkedOut.has(n.id + '\u0000' + r.port.id), portState(n, 'out', r.port.id));
      } else if (r.kind === 'in') {
        const linked = linkedIn.has(n.id + '\u0000' + r.port.id);
        if (lod) {
          cx.font = `400 10.5px ${FONT}`; cx.fillStyle = linked ? C.text : C.dim;
          cx.fillText(fitText(r.port.label || r.port.id, w - 70), n.x + 10, cy + 0.5);
          if (!linked && r.port.default !== undefined) {
            cx.font = `400 9.5px ${MONO}`; cx.fillStyle = C.faint; cx.textAlign = 'right';
            cx.fillText(fitText(fmtDefault(r.port.default), 56), n.x + w - 8, cy + 0.5); cx.textAlign = 'left';
          }
        }
        drawPort(n.x, cy, r.port.type, linked, portState(n, 'in', r.port.id));
      } else if (r.kind === 'param' && lod) drawParam(n, r, y, w);
    }
  } else {
    // collapsed: one port dot per side
    const ins = [...L.ins.values()], outs = [...L.outs.values()];
    if (ins.length) drawPort(n.x, n.y + HEAD / 2, ins.length === 1 ? ins[0].port.type : 'float', ins.some(p => linkedIn.has(n.id + '\u0000' + p.port.id)), '');
    if (outs.length) drawPort(n.x + w, n.y + HEAD / 2, outs.length === 1 ? outs[0].port.type : 'float', outs.some(p => linkedOut.has(n.id + '\u0000' + p.port.id)), '');
  }
}

function drawParam(n, r, y, w) {
  const p = r.p;
  const v = n.params[p.id] !== undefined ? n.params[p.id] : p.default;
  const x0 = n.x + 8, ww = w - 16, yy = y + 2, hh = ROW - 4;
  const hot = hover && hover.id === n.id && hover.kind === 'param' && hover.pid === p.id;
  const col = catColor(state.registry.get(n.type)?.category);
  cx.fillStyle = hot ? C.widgetHover : C.widget; roundRect(x0, yy, ww, hh, 2); cx.fill();
  cx.textBaseline = 'middle';
  const cy = yy + hh / 2 + 0.5;
  if (p.kind === 'slider' || p.kind === 'int') {
    const min = p.min ?? 0, max = p.max ?? 1;
    const f = Math.max(0, Math.min(1, ((+v) - min) / ((max - min) || 1)));
    cx.fillStyle = col; cx.globalAlpha = 0.3; cx.fillRect(x0, yy, ww * f, hh); cx.globalAlpha = 1;
    cx.font = `400 10px ${FONT}`; cx.fillStyle = C.text; cx.fillText(fitText(p.label, ww - 50), x0 + 5, cy);
    cx.font = `400 10px ${MONO}`; cx.fillStyle = C.bright; cx.textAlign = 'right'; cx.fillText(fmtNum(+v, p), x0 + ww - 5, cy); cx.textAlign = 'left';
  } else if (p.kind === 'color') {
    cx.font = `400 10px ${FONT}`; cx.fillStyle = C.text; cx.fillText(fitText(p.label, ww - 52), x0 + 5, cy);
    cx.fillStyle = hexOk(v) ? v : '#808080'; roundRect(x0 + ww - 42, yy + 2, 40, hh - 4, 2); cx.fill();
  } else if (p.kind === 'enum') {
    cx.font = `400 10px ${FONT}`; cx.fillStyle = C.dim; cx.fillText(fitText(p.label, ww * 0.45), x0 + 5, cy);
    const opt = (p.options || []).map(o => typeof o === 'string' ? { value: o, label: o } : o).find(o => o.value === v);
    cx.fillStyle = C.bright; cx.textAlign = 'right'; cx.fillText(fitText((opt?.label ?? String(v)) + ' ▾', ww * 0.55 - 6), x0 + ww - 5, cy); cx.textAlign = 'left';
  } else if (p.kind === 'bool') {
    cx.strokeStyle = C.dim; cx.lineWidth = 1 / view.s; cx.strokeRect(x0 + 4, yy + 3, hh - 6, hh - 6);
    if (v) { cx.fillStyle = col; cx.fillRect(x0 + 6, yy + 5, hh - 10, hh - 10); }
    cx.font = `400 10px ${FONT}`; cx.fillStyle = C.text; cx.fillText(fitText(p.label, ww - hh - 8), x0 + hh + 2, cy);
  } else if (p.kind === 'vec2') {
    const a = Array.isArray(v) ? v : [0, 0];
    const half = ww / 2;
    cx.font = `400 10px ${MONO}`; cx.fillStyle = C.bright;
    cx.fillText(fitText(`${p.label} x ${fmtNum(+a[0], p)}`, half - 8), x0 + 5, cy);
    cx.fillText(fitText(`y ${fmtNum(+a[1], p)}`, half - 8), x0 + half + 5, cy);
    cx.fillStyle = C.border; cx.fillRect(x0 + half, yy + 2, 1, hh - 4);
  }
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

let mmRect = null, mmMap = null;
function drawMinimap(g) {
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

// ------------------------------------------------------------ HIT TEST
/** Nearest port within `tolPx` screen px. side: 'in' | 'out' | undefined (both). */
function hitPort(gx, gy, side, tolPx = 9) {
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
function hitNode(gx, gy) {
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
function hitFrame(gx, gy) {
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
/** Sampled polyline of a link in graph units. */
function linkPoly(l, byId) {
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
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / ((dx * dx + dy * dy) || 1)));
  return (ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2;
}
function hitLink(gx, gy, tolPx = 6, skip) {
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
function linksCrossing(path) {
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
const inMinimap = (sx, sy) => prefs.minimap && mmRect && sx >= mmRect.x && sx <= mmRect.x + mmRect.w && sy >= mmRect.y && sy <= mmRect.y + mmRect.h;
function minimapTo(sx, sy) {
  if (!mmMap) return;
  const gx = (sx - mmMap.ox) / mmMap.k + mmMap.bx, gy = (sy - mmMap.oy) / mmMap.k + mmMap.by;
  view.tx = W / 2 - gx * view.s; view.ty = H / 2 - gy * view.s; dirty();
}

// ------------------------------------------------------------ POINTER
const pointers = new Map();
let longPress = 0;
const evPos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

/** Ports that accept a wire from the drag source, keyed "node\0port". */
function computeOkPorts(dir, srcNodeId, srcPort) {
  const g = state.graph, ok = new Set();
  for (const n of g.nodes) {
    if (n.id === srcNodeId) continue;
    const L = layout(n);
    if (dir === 'out') { for (const pid of L.ins.keys()) if (G.canLink(g, [srcNodeId, srcPort], [n.id, pid]).ok) ok.add(n.id + '\u0000' + pid); }
    else for (const pid of L.outs.keys()) if (G.canLink(g, [n.id, pid], [srcNodeId, srcPort]).ok) ok.add(n.id + '\u0000' + pid);
  }
  return ok;
}
/** Best port on node `n` for a wire of the drag (prefers the exact type, then a free input). */
function bestPortOn(n, dir, type, okPorts) {
  const L = layout(n);
  const g = state.graph;
  const cands = [...(dir === 'out' ? L.ins : L.outs).entries()].filter(([pid]) => okPorts.has(n.id + '\u0000' + pid));
  if (!cands.length) return null;
  const free = pid => dir !== 'out' || !G.linkInto(g, [n.id, pid]);
  cands.sort(([a, pa], [b, pb]) => ((pb.port.type === type) - (pa.port.type === type)) * 2 + (free(b) - free(a)));
  return cands[0][0];
}

function onPointerDown(e) {
  closeMenu();
  if (palEl && !palEl.hidden && !palEl.contains(e.target)) closePalette();
  commitInline();
  cv.focus({ preventScroll: true });
  const [sx, sy] = evPos(e);
  pointers.set(e.pointerId, { sx, sy });
  cv.setPointerCapture(e.pointerId);
  if (pointers.size === 2) { startPinch(); return; }
  if (pointers.size > 2) return;
  const [gx, gy] = toG(sx, sy);
  const touch = e.pointerType === 'touch';
  clearTimeout(longPress);
  if (touch) longPress = setTimeout(() => { if (drag && !drag.moved && drag.mode !== 'pinch') { const d = drag; cancelDrag(); openContext(d.sx0, d.sy0); } }, 550);

  if (e.button === 1 || (e.button === 0 && e.altKey && !hitNode(gx, gy))) { drag = { mode: 'pan', sx0: sx, sy0: sy, tx0: view.tx, ty0: view.ty, moved: false }; return; }
  if (e.button === 2) { drag = { mode: 'rclick', sx0: sx, sy0: sy, path: [[gx, gy]], moved: false }; return; }
  if (e.button !== 0) return;
  if (inMinimap(sx, sy)) { drag = { mode: 'minimap', moved: true }; minimapTo(sx, sy); return; }

  const g = state.graph;
  const hp = hitPort(gx, gy, undefined, touch ? 16 : 9);
  if (hp) {
    if (hp.side === 'out') { startWire('out', [hp.node.id, hp.pid], sx, sy); return; }
    const l = G.linkInto(g, [hp.node.id, hp.pid]);
    if (l) {
      // pull the wire off this input and carry it from its source
      G.disconnect(g, l.to);
      G.queueChanged({ reason: 'edit', nodeIds: [l.to[0]] });
      startWire('out', l.from, sx, sy, l);
      return;
    }
    startWire('in', [hp.node.id, hp.pid], sx, sy); return;
  }
  const hn = hitNode(gx, gy);
  if (hn) {
    const id = hn.node.id;
    if (hn.part === 'chevron') { G.actions.setCollapsed([id], !hn.node.collapsed); return; }
    if (hn.part === 'param') { startParam(hn, sx, sy, gx, e); if (!sel.has(id)) setSel([id]); return; }
    if (e.shiftKey) { const s2 = new Set(sel); s2.add(id); setSel(s2, { keepFrames: true }); }
    else if (e.ctrlKey || e.metaKey) { const s2 = new Set(sel); if (s2.has(id)) s2.delete(id); else s2.add(id); setSel(s2, { keepFrames: true }); }
    else if (!sel.has(id)) setSel([id]);
    if (!sel.has(id)) return;
    drag = { mode: 'nodes', sx0: sx, sy0: sy, gx0: gx, gy0: gy, id, moved: false, alt: e.altKey, click: !(e.shiftKey || e.ctrlKey || e.metaKey) };
    return;
  }
  const hf = hitFrame(gx, gy);
  if (hf && hf.part !== 'body') {
    const f = hf.frame;
    if (hf.part === 'resize') { drag = { mode: 'frame-resize', id: f.id, sx0: sx, sy0: sy, w0: f.w, h0: f.h, moved: false }; return; }
    if (e.shiftKey || e.ctrlKey || e.metaKey) selFrames.add(f.id); else if (!selFrames.has(f.id)) { selFrames = new Set([f.id]); setSel([], { keepFrames: true }); }
    const fids = [...selFrames];
    const nodeIds = new Set(sel);
    for (const fid of fids) for (const nid of G.frameNodes(g, fid)) nodeIds.add(nid);
    drag = {
      mode: 'frame', sx0: sx, sy0: sy, moved: false, fids,
      orig: Object.fromEntries([...nodeIds].map(nid => { const n = G.nodeById(g, nid); return [nid, [n.x, n.y]]; })),
      forig: Object.fromEntries(fids.map(fid => { const fr = g.frames.find(q => q.id === fid); return [fid, [fr.x, fr.y]]; })),
    };
    dirty(); return;
  }
  // empty space
  if (touch && !prefs.boxMode) { drag = { mode: 'pan', sx0: sx, sy0: sy, tx0: view.tx, ty0: view.ty, moved: false, tapEmpty: true }; return; }
  drag = { mode: 'box', sx0: sx, sy0: sy, gx0: gx, gy0: gy, gx, gy, moved: false, add: e.shiftKey, toggle: e.ctrlKey || e.metaKey, base: new Set(sel) };
}

function startWire(dir, src, sx, sy, detached) {
  const g = state.graph;
  const n = G.nodeById(g, src[0]);
  const anchor = portPos(n, dir === 'out' ? 'out' : 'in', src[1]);
  const type = G.portType(g, src[0], dir, src[1]) || 'float';
  const [gx, gy] = toG(sx, sy);
  drag = { mode: 'wire', dir, src, anchor, type, gx, gy, sx0: sx, sy0: sy, moved: !!detached, detached, target: null, okPorts: computeOkPorts(dir, src[0], src[1]) };
  dirty();
}

let paramSeq = 0;
function startParam(hn, sx, sy, gx, e) {
  const n = hn.node, p = hn.p, L = hn.L;
  const v = n.params[p.id] !== undefined ? n.params[p.id] : p.default;
  const lx = gx - n.x;
  if (p.kind === 'bool') { G.actions.setParam(n.id, p.id, !v, { merge: null }); return; }
  if (p.kind === 'enum') { openEnumMenu(n, p, sx, sy); return; }
  if (p.kind === 'color') { openColor(n, p, sx, sy); return; }
  const half = p.kind === 'vec2' ? (lx - 8 < (L.w - 16) / 2 ? 0 : 1) : -1;
  drag = {
    mode: 'param', id: n.id, p, half, sx0: sx, sy0: sy, v0: v, moved: false,
    wpx: (p.kind === 'vec2' ? (L.w - 16) / 2 : L.w - 16) * view.s,
    fx: (lx - 8 - (half === 1 ? (L.w - 16) / 2 : 0)) / (p.kind === 'vec2' ? (L.w - 16) / 2 : L.w - 16),
    merge: `param:${n.id}.${p.id}:${++paramSeq}`, fine: e.shiftKey,
  };
}
function quant(v, p) {
  const min = p.min ?? (p.kind === 'vec2' ? -Infinity : 0), max = p.max ?? (p.kind === 'vec2' ? Infinity : 1);
  v = Math.max(min, Math.min(max, v));
  const step = p.kind === 'int' ? Math.max(1, p.step || 1) : (p.step || 0.001);
  v = Math.round(v / step) * step;
  return +v.toFixed(p.kind === 'int' ? 0 : Math.min(6, Math.max(0, -Math.floor(Math.log10(step) - 1e-9))));
}
function paramValueAt(d, sx, e, absolute) {
  const p = d.p;
  const min = p.min ?? 0, max = p.max ?? 1, range = (max - min) || 1;
  let base = d.half >= 0 ? (Array.isArray(d.v0) ? d.v0[d.half] : 0) : +d.v0;
  let nv;
  if (absolute) nv = min + Math.max(0, Math.min(1, d.fx)) * range;
  else nv = base + ((sx - d.sx0) / Math.max(20, d.wpx)) * range * (e.shiftKey ? 0.1 : 1);
  nv = quant(nv, p);
  if (d.half >= 0) { const a = Array.isArray(d.v0) ? [...d.v0] : [0, 0]; a[d.half] = nv; return a; }
  return nv;
}

function onPointerMove(e) {
  const [sx, sy] = evPos(e);
  mouse = { sx, sy, inside: true };
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { sx, sy });
  if (drag?.mode === 'pinch') { movePinch(); return; }
  if (!drag) { updateHover(sx, sy); return; }
  const dist = Math.hypot(sx - drag.sx0, sy - drag.sy0);
  if (!drag.moved && dist > (e.pointerType === 'touch' ? 8 : 3)) { drag.moved = true; clearTimeout(longPress); onDragStart(e); }
  if (!drag) return;
  const [gx, gy] = toG(sx, sy);
  switch (drag.mode) {
    case 'pan': view.tx = drag.tx0 + (sx - drag.sx0); view.ty = drag.ty0 + (sy - drag.sy0); dirty(); break;
    case 'minimap': minimapTo(sx, sy); break;
    case 'nodes': if (drag.moved) moveDragNodes(gx, gy, e); break;
    case 'frame': {
      if (!drag.moved) break;
      const dx = (sx - drag.sx0) / view.s, dy = (sy - drag.sy0) / view.s;
      const snap = v => prefs.snap && !e.ctrlKey ? Math.round(v / SNAP) * SNAP : Math.round(v);
      const g = state.graph;
      const fid0 = drag.fids[0], fo = drag.forig[fid0];
      const ddx = snap(fo[0] + dx) - fo[0], ddy = snap(fo[1] + dy) - fo[1];
      for (const f of g.frames) if (drag.forig[f.id]) { f.x = drag.forig[f.id][0] + ddx; f.y = drag.forig[f.id][1] + ddy; }
      for (const n of g.nodes) if (drag.orig[n.id]) { n.x = drag.orig[n.id][0] + ddx; n.y = drag.orig[n.id][1] + ddy; }
      dirty(); break;
    }
    case 'frame-resize': {
      const f = state.graph.frames.find(q => q.id === drag.id);
      if (f) { f.w = Math.max(80, Math.round(drag.w0 + (sx - drag.sx0) / view.s)); f.h = Math.max(50, Math.round(drag.h0 + (sy - drag.sy0) / view.s)); dirty(); }
      break;
    }
    case 'box': drag.gx = gx; drag.gy = gy; if (drag.moved) applyBox(); dirty(); break;
    case 'rclick': case 'cut':
      drag.path.push([gx, gy]);
      if (drag.moved) drag.mode = 'cut';
      dirty(); break;
    case 'wire': {
      drag.gx = gx; drag.gy = gy;
      const want = drag.dir === 'out' ? 'in' : 'out';
      let tgt = null;
      const hp = hitPort(gx, gy, want, e.pointerType === 'touch' ? 26 : 18);
      if (hp && drag.okPorts.has(hp.node.id + '\u0000' + hp.pid)) tgt = [hp.node.id, hp.pid, want];
      else {
        // over a node: a port row of the wanted side takes only its own port;
        // the header, the preview and other rows pick the best free port
        const hn = hitNode(gx, gy);
        if (hn && hn.node.id !== drag.src[0]) {
          if (hn.part === want && hn.row) { const k = hn.node.id + '\u0000' + hn.row.port.id; if (drag.okPorts.has(k)) tgt = [hn.node.id, hn.row.port.id, want]; }
          else { const pid = bestPortOn(hn.node, drag.dir, drag.type, drag.okPorts); if (pid) tgt = [hn.node.id, pid, want]; }
        }
      }
      drag.target = tgt;
      setStatusHover(tgt ? `${drag.dir === 'out' ? 'into' : 'from'} ${tgt[0]}.${tgt[1]}` : `${drag.type}: drop on empty space to add a node`);
      dirty(); break;
    }
    case 'param': {
      if (!drag.moved) break;
      const v = paramValueAt(drag, sx, e, false);
      G.actions.setParam(drag.id, drag.p.id, v, { checkpoint: false });
      dirty(); break;
    }
  }
}

function onDragStart(e) {
  const g = state.graph;
  if (drag.mode === 'nodes') {
    if (drag.alt) {
      // Alt+drag: duplicate the selection, then drag the copies
      const ids = G.duplicateNodes(g, [...sel], 0, 0);
      G.queueChanged({ reason: 'edit', nodeIds: ids });
      drag.dup = true;
      setSel(ids);
    }
    drag.orig = Object.fromEntries([...sel].map(id => { const n = G.nodeById(g, id); return n ? [id, [n.x, n.y]] : null; }).filter(Boolean));
    const lone = sel.size === 1 ? G.nodeById(g, [...sel][0]) : null;
    drag.lone = lone && !g.links.some(l => l.from[0] === lone.id || l.to[0] === lone.id) && (layout(lone).ins.size && layout(lone).outs.size) ? lone : null;
  }
}

function moveDragNodes(gx, gy, e) {
  const g = state.graph;
  const dx = gx - drag.gx0, dy = gy - drag.gy0;
  const lead = G.nodeById(g, drag.id) ? drag.id : Object.keys(drag.orig)[0];
  const o = drag.orig[lead];
  if (!o) return;
  const snap = v => prefs.snap && !e.ctrlKey ? Math.round(v / SNAP) * SNAP : Math.round(v);
  const ddx = snap(o[0] + dx) - o[0], ddy = snap(o[1] + dy) - o[1];
  for (const n of g.nodes) { const p = drag.orig[n.id]; if (p) { n.x = p[0] + ddx; n.y = p[1] + ddy; } }
  if (drag.lone) {
    const L = layout(drag.lone);
    const cxp = drag.lone.x + L.w / 2, cyp = drag.lone.y + HEAD / 2;
    drag.insertLink = hitLink(cxp, cyp, 14) || null;
  }
  dirty();
}

function applyBox(d = drag) {
  const g = state.graph;
  const x0 = Math.min(d.gx0, d.gx), y0 = Math.min(d.gy0, d.gy), x1 = Math.max(d.gx0, d.gx), y1 = Math.max(d.gy0, d.gy);
  const hit = g.nodes.filter(n => { const L = layout(n); return n.x < x1 && n.x + L.w > x0 && n.y < y1 && n.y + L.h > y0; }).map(n => n.id);
  let next;
  if (d.toggle) { next = new Set(d.base); for (const id of hit) if (d.base.has(id)) next.delete(id); else next.add(id); }
  else if (d.add) next = new Set([...d.base, ...hit]);
  else next = new Set(hit);
  sel = next; // emit on pointerup
  selFrames = new Set(g.frames.filter(f => f.x >= x0 && f.y >= y0 && f.x + f.w <= x1 && f.y + f.h <= y1).map(f => f.id));
}

function onPointerUp(e) {
  pointers.delete(e.pointerId);
  clearTimeout(longPress);
  if (drag?.mode === 'pinch') { if (pointers.size < 2) drag = null; return; }
  const d = drag; drag = null;
  if (!d) return;
  const [sx, sy] = evPos(e);
  const [gx, gy] = toG(sx, sy);
  const g = state.graph;
  switch (d.mode) {
    case 'pan': if (d.tapEmpty && !d.moved) setSel([]); break;
    case 'nodes':
      if (d.moved) {
        if (d.lone && d.insertLink) insertOnLink(d.lone, d.insertLink);
        else if (d.dup) G.actions.edit(`Duplicate ${sel.size} node${sel.size === 1 ? '' : 's'}`, () => true, { kind: 'layout', nodeIds: [...sel] });
        else G.actions.edit(`Move ${Object.keys(d.orig).length} node${Object.keys(d.orig).length === 1 ? '' : 's'}`, () => true, { kind: 'layout', nodeIds: Object.keys(d.orig) });
      } else if (d.click && sel.size > 1) setSel([d.id]);
      break;
    case 'frame':
      if (d.moved) G.actions.edit('Move frame', () => true, { kind: 'layout', nodeIds: Object.keys(d.orig) });
      break;
    case 'frame-resize': if (d.moved) G.actions.edit('Resize frame', () => true, { kind: 'layout' }); break;
    case 'box':
      if (d.moved) { d.gx = gx; d.gy = gy; applyBox(d); setSel([...sel], { keepFrames: true }); }
      else if (!d.add && !d.toggle) setSel([]);
      break;
    case 'rclick': openContext(d.sx0, d.sy0); break;
    case 'cut': {
      const ls = linksCrossing(d.path);
      if (ls.length) G.actions.cutLinks(ls);
      break;
    }
    case 'wire': endWire(d, sx, sy, gx, gy); break;
    case 'param':
      if (!d.moved) { const v = paramValueAt(d, sx, e, true); G.actions.setParam(d.id, d.p.id, v, { checkpoint: false }); }
      G.actions.commit(`Set ${d.p.label}`, { merge: d.merge });
      break;
  }
  updateHover(sx, sy);
  dirty();
}

function endWire(d, sx, sy, gx, gy) {
  const g = state.graph;
  if (d.target) {
    const [nid, pid] = d.target;
    const from = d.dir === 'out' ? d.src : [nid, pid];
    const to = d.dir === 'out' ? [nid, pid] : d.src;
    if (d.detached && d.detached.to[0] === to[0] && d.detached.to[1] === to[1] && d.detached.from[0] === from[0] && d.detached.from[1] === from[1]) {
      G.connect(g, from, to); G.queueChanged({ reason: 'edit', nodeIds: [to[0]] }); return; // dropped back where it was
    }
    G.actions.edit(d.detached ? 'Reconnect' : 'Connect', gg => G.connect(gg, from, to), { nodeIds: [to[0]] });
    return;
  }
  if (d.detached) { G.actions.commit('Disconnect'); return; }
  if (!d.moved) return;
  openPalette({ sx, sy, gx, gy, wire: { dir: d.dir, src: d.src, type: d.type } });
}

/** Drop a lone node onto a wire: wire.from -> node -> wire.to. */
function insertOnLink(n, l) {
  const g = state.graph;
  const L = layout(n);
  const ft = G.portType(g, l.from[0], 'out', l.from[1]);
  const tt = G.portType(g, l.to[0], 'in', l.to[1]);
  const inP = [...L.ins.values()].sort((a, b) => (b.port.type === ft) - (a.port.type === ft)).find(p => G.typesCompatible(ft, p.port.type));
  const outP = [...L.outs.values()].sort((a, b) => (b.port.type === tt) - (a.port.type === tt)).find(p => G.typesCompatible(p.port.type, tt));
  if (!inP || !outP) { G.actions.edit('Move node', () => true, { kind: 'layout', nodeIds: [n.id] }); return; }
  G.actions.edit(`Insert ${L.def?.label || n.type}`, gg => {
    G.disconnect(gg, l.to);
    G.connect(gg, l.from, [n.id, inP.port.id]);
    G.connect(gg, [n.id, outP.port.id], l.to);
    return true;
  }, { nodeIds: [n.id, l.to[0]] });
}

function cancelDrag() {
  const d = drag; drag = null;
  if (!d) return;
  const g = state.graph;
  if (d.mode === 'nodes' && d.orig && d.moved) for (const n of g.nodes) if (d.orig[n.id]) [n.x, n.y] = d.orig[n.id];
  if (d.mode === 'wire' && d.detached) { G.connect(g, d.detached.from, d.detached.to); G.queueChanged({ reason: 'edit' }); }
  if (d.mode === 'param' && d.moved) { G.actions.setParam(d.id, d.p.id, d.v0, { checkpoint: false }); }
  dirty();
}

function startPinch() {
  if (drag && drag.mode !== 'pinch') cancelDrag();
  const [a, b] = [...pointers.values()];
  drag = { mode: 'pinch', d0: Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1, m0: [(a.sx + b.sx) / 2, (a.sy + b.sy) / 2], s0: view.s, tx0: view.tx, ty0: view.ty, moved: true };
}
function movePinch() {
  const ps = [...pointers.values()];
  if (ps.length < 2) return;
  const [a, b] = ps;
  const d = Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1;
  const m = [(a.sx + b.sx) / 2, (a.sy + b.sy) / 2];
  const s = Math.min(ZMAX, Math.max(ZMIN, drag.s0 * d / drag.d0));
  const gx = (drag.m0[0] - drag.tx0) / drag.s0, gy = (drag.m0[1] - drag.ty0) / drag.s0;
  view.s = s; view.tx = m[0] - gx * s; view.ty = m[1] - gy * s;
  dirty();
}

function updateHover(sx, sy) {
  if (!state.graph) return;
  const [gx, gy] = toG(sx, sy);
  let h = null, cursor = 'default', tip = '';
  if (inMinimap(sx, sy)) { cursor = 'pointer'; tip = 'Minimap: click or drag to move the view'; }
  else {
    const hp = hitPort(gx, gy);
    if (hp) {
      h = { kind: 'port', id: hp.node.id, side: hp.side, pid: hp.pid };
      cursor = 'crosshair';
      const t = G.portType(state.graph, hp.node.id, hp.side, hp.pid);
      tip = `${hp.port.label || hp.pid} · ${t}${hp.side === 'in' ? ' input' : ' output'}`;
    } else {
      const hn = hitNode(gx, gy);
      if (hn) {
        h = { kind: hn.part === 'param' ? 'param' : 'node', id: hn.node.id, pid: hn.p?.id };
        cursor = hn.part === 'param' ? (['slider', 'int', 'vec2'].includes(hn.p.kind) ? 'ew-resize' : 'pointer') : hn.part === 'chevron' ? 'pointer' : 'move';
        const def = hn.L.def;
        tip = hn.part === 'param' ? `${hn.p.label} · ${hn.p.kind}${hn.p.kind === 'slider' || hn.p.kind === 'int' ? ' · drag, Shift fine, double-click to type' : ''}`
          : `${def?.label || hn.node.type} · ${hn.node.type}${def?.doc ? ' · ' + def.doc : ''}`;
      } else {
        const hf = hitFrame(gx, gy);
        if (hf && hf.part !== 'body') { cursor = hf.part === 'resize' ? 'nwse-resize' : 'move'; tip = `Frame ${hf.frame.label}`; h = { kind: 'frame', id: hf.frame.id }; }
      }
    }
  }
  const changed = JSON.stringify(h) !== JSON.stringify(hover);
  hover = h;
  cv.style.cursor = cursor;
  setStatusHover(tip);
  if (changed) dirty();
}

function onDblClick(e) {
  const [sx, sy] = evPos(e);
  const [gx, gy] = toG(sx, sy);
  const g = state.graph;
  if (hitPort(gx, gy)) return;
  const hn = hitNode(gx, gy);
  if (hn) {
    if (hn.part === 'param' && ['slider', 'int', 'vec2'].includes(hn.p.kind)) { typeParam(hn); return; }
    if (hn.part === 'head' || hn.part === 'chevron') { renameNode(hn.node); return; }
    if (hn.node.type === g.output) return;
    return;
  }
  const hf = hitFrame(gx, gy);
  if (hf && hf.part === 'head') { renameFrame(hf.frame); return; }
  const l = hitLink(gx, gy, 7);
  if (l) { addReroute(l, gx, gy); return; }
  openPalette({ sx, sy, gx, gy });
}

function addReroute(l, gx, gy) {
  G.actions.edit('Add reroute', gg => {
    const r = G.addNode(gg, G.REROUTE_TYPE, gx - RR / 2, gy - RR / 2);
    G.disconnect(gg, l.to);
    G.connect(gg, l.from, [r.id, 'in'], undefined, { force: true });
    G.connect(gg, [r.id, 'out'], l.to, undefined, { force: true });
    return r;
  }, { nodeIds: [l.to[0]] });
}

// ------------------------------------------------------------ WHEEL
let lastCtrlWheel = 0;
function onWheel(e) {
  e.preventDefault();
  const [sx, sy] = evPos(e);
  if (e.ctrlKey || e.metaKey) { lastCtrlWheel = performance.now(); zoomAt(sx, sy, Math.exp(-e.deltaY * 0.01)); return; }
  const lines = e.deltaMode === 1, pages = e.deltaMode === 2;
  const mouseWheel = lines || pages || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
  if (mouseWheel && !e.shiftKey) { zoomAt(sx, sy, Math.exp(-(lines ? e.deltaY * 33 : pages ? e.deltaY * 400 : e.deltaY) * 0.0016)); return; }
  const k = lines ? 33 : pages ? 400 : 1;
  if (e.shiftKey && e.deltaX === 0) view.tx -= e.deltaY * k; else { view.tx -= e.deltaX * k; view.ty -= e.deltaY * k; }
  dirty();
}
// Safari trackpad pinch (gesture events) when no ctrl+wheel arrives
let gsScale = 1;
function onGesture(e) {
  e.preventDefault();
  if (e.type === 'gesturestart') { gsScale = 1; return; }
  if (performance.now() - lastCtrlWheel < 200) return;
  const [sx, sy] = evPos(e);
  zoomAt(sx, sy, e.scale / gsScale); gsScale = e.scale;
}

// ------------------------------------------------------------ KEYS
function editorActive() {
  const a = document.activeElement;
  if (a === cv) return true;
  if (a && a !== document.body && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return false;
  if (a && wrap.contains(a)) return true;
  return mouse.inside && (!a || a === document.body);
}
function onKey(e) {
  if (!state.graph || !editorActive()) return;
  if (palEl && !palEl.hidden) return;
  const k = e.key, mod = e.ctrlKey || e.metaKey, lk = k.toLowerCase();
  const g = state.graph;
  const ids = [...sel];
  const handled = () => { e.preventDefault(); e.stopPropagation(); };
  if (k === 'Escape') { if (drag) cancelDrag(); else if (menuEl && !menuEl.hidden) closeMenu(); else setSel([]); return handled(); }
  if (mod && (lk === 'z' || lk === 'y')) return; // main.js
  if (k === 'Tab' || (k === ' ' && !mod) || (k === 'A' && e.shiftKey && !mod)) {
    handled();
    const [sx, sy] = mouse.inside ? [mouse.sx, mouse.sy] : [W / 2, H / 2];
    const [gx, gy] = toG(sx, sy);
    openPalette({ sx, sy, gx, gy }); return;
  }
  if ((k === 'Delete' || k === 'Backspace') && !e.altKey) {
    handled();
    if (mod) { if (ids.length) G.actions.dissolve(ids); return; }
    if (ids.length || selFrames.size) G.actions.remove(ids, { frames: [...selFrames] });
    return;
  }
  if (mod && lk === 'd') { handled(); if (ids.length) { const r = G.actions.duplicate(ids, 30, 30, e.shiftKey); if (r) setSel(r); } return; }
  if (mod && lk === 'c') { handled(); copySel(); return; }
  if (mod && lk === 'x') { handled(); if (copySel()) G.actions.remove(ids, { frames: [...selFrames], label: 'Cut' }); return; }
  if (mod && lk === 'v') { pasteSoon(); return; } // the paste event usually wins; this is the fallback
  if (mod && lk === 'a') { handled(); selFrames = new Set(g.frames.map(f => f.id)); setSel(g.nodes.map(n => n.id), { keepFrames: true }); return; }
  if (e.altKey && lk === 'a') { handled(); setSel([]); return; }
  if (mod && lk === 'i') { handled(); setSel(g.nodes.filter(n => !sel.has(n.id)).map(n => n.id)); return; }
  if (mod && lk === 'g') { handled(); groupSel(); return; }
  if (mod) return;
  if (k === 'F2') { handled(); const n = G.nodeById(g, ids[0]); if (n) renameNode(n); return; }
  if (lk === 'f') { handled(); if (e.shiftKey) fitAll(); else fitSelection(); return; }
  if (k === 'Home') { handled(); fitAll(); return; }
  if (lk === 'h') { handled(); if (ids.length) { const any = ids.some(id => !G.nodeById(g, id)?.collapsed); G.actions.setCollapsed(ids, any); } return; }
  if (lk === 'p') { handled(); if (ids.length) { const any = ids.some(id => G.nodeById(g, id)?.preview !== false); G.actions.setPreview(ids, !any); } else togglePref('preview'); return; }
  if (lk === 'l') { handled(); G.actions.autoLayout(ids.length > 1 ? ids : null, sizeOf); return; }
  if (lk === 'm') { handled(); togglePref('minimap'); return; }
  if (k.startsWith('Arrow') && ids.length) {
    handled();
    const st = e.shiftKey ? 100 : SNAP;
    const dx = k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0, dy = k === 'ArrowUp' ? -st : k === 'ArrowDown' ? st : 0;
    G.actions.move(ids, dx, dy, { merge: 'nudge:' + ids.join(','), label: 'Nudge' });
  }
}

function groupSel() {
  if (!sel.size) return;
  const f = G.actions.frameNodes([...sel], sizeOf, 'Frame');
  if (f) { selFrames = new Set([f.id]); dirty(); renameFrame(f); }
}

// ------------------------------------------------------------ CLIPBOARD
function copySel() {
  if (!sel.size && !selFrames.size) return false;
  const clip = G.actions.copy([...sel], [...selFrames]);
  if (!clip.nodes.length && !clip.frames.length) return false;
  const json = JSON.stringify(clip);
  try { localStorage.setItem(CLIP_KEY, json); } catch (e) { /* storage off */ }
  try { navigator.clipboard?.writeText(json).catch(() => {}); } catch (e) { /* no clipboard */ }
  toast(`Copied ${clip.nodes.length} node${clip.nodes.length === 1 ? '' : 's'}`, 'info', 1200);
  return true;
}
let pasteTimer = 0, pasteHandled = false;
function pasteSoon() {
  pasteHandled = false;
  clearTimeout(pasteTimer);
  pasteTimer = setTimeout(() => { if (!pasteHandled) { let json = null; try { json = localStorage.getItem(CLIP_KEY); } catch (e) {} pasteText(json); } }, 60);
}
function onPaste(e) {
  if (!editorActive()) return;
  const text = e.clipboardData?.getData('text/plain');
  let ok = false;
  if (text && /^\s*\{/.test(text)) ok = pasteText(text, true);
  if (ok) { pasteHandled = true; e.preventDefault(); }
}
/** Paste clip JSON (or full Graph JSON) at the pointer. @returns {boolean} */
function pasteText(json, quiet) {
  if (!json) return false;
  let data; try { data = JSON.parse(json); } catch (e) { return false; }
  const clip = G.toClip(data);
  if (!clip || (!clip.nodes.length && !clip.frames?.length)) { if (!quiet) toast('Nothing to paste', 'warn', 1500); return false; }
  const [gx, gy] = mouse.inside ? toG(mouse.sx, mouse.sy) : viewCenterG();
  const r = G.actions.paste(clip, Math.round(gx / SNAP) * SNAP, Math.round(gy / SNAP) * SNAP);
  if (r) { selFrames = new Set(r.frameIds); setSel(r.nodeIds, { keepFrames: true }); }
  return !!r;
}

// ------------------------------------------------------------ PALETTE
let pal = null;  // {gx, gy, wire, items, idx}
function recent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } }
function pushRecent(type) {
  const r = [type, ...recent().filter(t => t !== type)].slice(0, 10);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch (e) {}
}
function allDefs() {
  const hasOut = state.graph?.nodes.some(n => n.type === OUTPUT_TYPE);
  const defs = [...state.registry.values()].filter(d => !(d.type === OUTPUT_TYPE && hasOut));
  if (!state.registry.has(G.REROUTE_TYPE)) defs.push(G.REROUTE_DEF);
  return defs;
}
const catRank = c => { const i = NODE_CATEGORIES.indexOf(c); return i < 0 ? 99 : i; };
const hayCache = new WeakMap();   // defs can be frozen: cache the search text outside them
const hay = d => {
  let h = hayCache.get(d);
  if (h === undefined) { h = `${d.label} ${d.type} ${d.category} ${(d.tags || []).join(' ')} ${d.doc || ''}`.toLowerCase(); hayCache.set(d, h); }
  return h;
};
/** Search defs. wire: {dir, type} keeps only defs with a compatible port. */
function searchDefs(q, wire, limit = 300) {
  q = q.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const rec = recent();
  const out = [];
  for (const d of allDefs()) {
    let wireScore = 0;
    if (wire) {
      const ports = wire.dir === 'out' ? d.inputs || [] : d.outputs || [];
      const ok = ports.filter(p => wire.dir === 'out' ? G.typesCompatible(wire.type, p.type) : G.typesCompatible(p.type, wire.type));
      if (!ok.length) continue;
      wireScore = ok.some(p => p.type === wire.type) ? 2 : 0;
    }
    let score = 0;
    if (terms.length) {
      const label = d.label.toLowerCase(), h = hay(d);
      let all = true;
      for (const t of terms) {
        if (label.startsWith(t)) score += 6;
        else if (label.split(/[\s\-_/]+/).some(wd => wd.startsWith(t))) score += 4;
        else if (label.includes(t)) score += 3;
        else if (h.includes(t)) score += 1;
        else { all = false; break; }
      }
      if (!all) continue;
    }
    const ri = rec.indexOf(d.type);
    if (ri >= 0) score += terms.length ? 1.5 : 0;
    score += wireScore;
    if (d.source === 'bench' && !terms.length) score -= 0.5;
    out.push({ d, score, ri });
  }
  out.sort((a, b) => b.score - a.score || catRank(a.d.category) - catRank(b.d.category) || a.d.label.localeCompare(b.d.label));
  if (!terms.length) {
    const recents = rec.map(t => out.find(o => o.d.type === t)).filter(Boolean).slice(0, 6).map(o => ({ ...o, recent: true }));
    return [...recents, ...out.filter(o => !recents.some(r => r.d.type === o.d.type))].slice(0, limit);
  }
  return out.slice(0, limit);
}

function openPalette({ sx, sy, gx, gy, wire }) {
  closeMenu();
  pal = { gx, gy, wire, items: [], idx: 0 };
  palEl.hidden = false;
  const phone = W < 520;
  const pw = Math.min(300, W - 16), ph = Math.min(380, H - 50);
  palEl.style.width = pw + 'px';
  palEl.style.left = (phone ? (W - pw) / 2 : Math.max(8, Math.min(W - pw - 8, sx))) + 'px';
  palEl.style.top = (phone ? 34 : Math.max(32, Math.min(H - ph - 8, sy))) + 'px';
  palEl.style.maxHeight = ph + 'px';
  const head = palEl.querySelector('.ge-pal-head');
  head.textContent = wire ? `${wire.dir === 'out' ? 'Feed' : 'Take'} ${wire.type} · ${wire.src.join('.')}` : 'Add node';
  const q = palEl.querySelector('input');
  q.value = '';
  fillPalette();
  setTimeout(() => q.focus({ preventScroll: true }), 0);
}
function closePalette() { if (!palEl || palEl.hidden) return; palEl.hidden = true; pal = null; if (cv) cv.focus({ preventScroll: true }); }
function fillPalette() {
  if (!pal) return;
  const q = palEl.querySelector('input').value;
  pal.items = searchDefs(q, pal.wire, 250);
  pal.idx = 0;
  const list = palEl.querySelector('.ge-pal-list');
  const frag = document.createDocumentFragment();
  let lastCat = null;
  pal.items.forEach((it, i) => {
    const d = it.d;
    const cat = it.recent ? 'Recent' : (q.trim() ? null : d.category);
    if (cat && cat !== lastCat) { const h = document.createElement('div'); h.className = 'ge-pal-cat'; h.textContent = cat; frag.appendChild(h); lastCat = cat; }
    const el = document.createElement('div');
    el.className = 'ge-pal-it'; el.dataset.i = i;
    el.innerHTML = `<i style="background:${catColor(d.category)}"></i><b></b><span class="ge-pal-types"></span><em></em>`;
    el.querySelector('b').textContent = d.label;
    el.querySelector('em').textContent = d.source === 'bench' ? d.type.split('.')[1] || 'bench' : d.category;
    const tps = el.querySelector('.ge-pal-types');
    for (const p of (d.outputs || []).slice(0, 3)) { const s = document.createElement('u'); s.style.background = typeColor(p.type); s.title = `${p.label}: ${p.type}`; tps.appendChild(s); }
    el.title = `${d.type}${d.doc ? '\n' + d.doc : ''}`;
    frag.appendChild(el);
  });
  if (!pal.items.length) { const e = document.createElement('div'); e.className = 'ge-pal-empty'; e.textContent = 'No matching node'; frag.appendChild(e); }
  list.replaceChildren(frag);
  markPal();
}
function markPal() {
  const list = palEl.querySelector('.ge-pal-list');
  for (const el of list.querySelectorAll('.ge-pal-it.on')) el.classList.remove('on');
  const el = list.querySelector(`.ge-pal-it[data-i="${pal.idx}"]`);
  if (el) { el.classList.add('on'); el.scrollIntoView({ block: 'nearest' }); }
  const d = pal.items[pal.idx]?.d;
  palEl.querySelector('.ge-pal-doc').textContent = d ? (d.doc || d.type) : '';
}
function choosePal(i) {
  const it = pal?.items[i];
  if (!it) return;
  const { gx, gy, wire } = pal;
  closePalette();
  const id = addFromDef(it.d, gx, gy, wire);
  if (id) setSel([id]);
}
/** Add a node of def at (gx, gy); with a wire, connect its best port and line it up. @returns {string|null} id */
function addFromDef(d, gx, gy, wire) {
  pushRecent(d.type);
  const r = G.actions.edit(`Add ${d.label}`, g => {
    const n = G.addNode(g, d.type, gx, gy);
    if (!n) return null;
    const L = layout(n);
    if (wire) {
      const ok = new Set();
      for (const pid of (wire.dir === 'out' ? L.ins : L.outs).keys()) {
        const okk = wire.dir === 'out' ? G.canLink(g, wire.src, [n.id, pid]).ok : G.canLink(g, [n.id, pid], wire.src).ok;
        if (okk) ok.add(n.id + '\u0000' + pid);
      }
      const pid = bestPortOn(n, wire.dir, wire.type, ok);
      if (pid) {
        const pp = (wire.dir === 'out' ? L.ins : L.outs).get(pid);
        n.x = Math.round(gx - pp.x + (wire.dir === 'out' ? 0 : 0)); n.y = Math.round(gy - pp.y);
        if (wire.dir === 'out') G.connect(g, wire.src, [n.id, pid]); else G.connect(g, [n.id, pid], wire.src);
      }
    } else if (prefs.snap) { n.x = Math.round(n.x / SNAP) * SNAP; n.y = Math.round(n.y / SNAP) * SNAP; }
    return n;
  }, { nodeIds: [] });
  return r ? r.id : null;
}
function onPalKey(e) {
  if (!pal) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); pal.idx = Math.min(pal.items.length - 1, pal.idx + 1); markPal(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); pal.idx = Math.max(0, pal.idx - 1); markPal(); }
  else if (e.key === 'PageDown') { e.preventDefault(); pal.idx = Math.min(pal.items.length - 1, pal.idx + 10); markPal(); }
  else if (e.key === 'PageUp') { e.preventDefault(); pal.idx = Math.max(0, pal.idx - 10); markPal(); }
  else if (e.key === 'Enter') { e.preventDefault(); choosePal(pal.idx); }
  else if (e.key === 'Escape' || (e.key === 'Tab' && !palEl.querySelector('input').value)) { e.preventDefault(); closePalette(); }
  e.stopPropagation();
}

// ------------------------------------------------------------ MENU
/** Show a menu. items: {label, key?, run?, disabled?, sep?, swatches?} */
function openMenu(sx, sy, items, title) {
  closePalette();
  const frag = document.createDocumentFragment();
  if (title) { const h = document.createElement('div'); h.className = 'ge-menu-title'; h.textContent = title; frag.appendChild(h); }
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { const s = document.createElement('div'); s.className = 'ge-menu-sep'; frag.appendChild(s); continue; }
    if (it.swatches) {
      const row = document.createElement('div'); row.className = 'ge-menu-sw';
      for (const c of it.swatches) { const b = document.createElement('button'); b.type = 'button'; b.style.background = c; b.title = c; b.onclick = () => { closeMenu(); it.run(c); }; row.appendChild(b); }
      frag.appendChild(row); continue;
    }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ge-menu-it' + (it.on ? ' on' : '');
    b.disabled = !!it.disabled;
    b.innerHTML = '<span></span><kbd></kbd>';
    b.firstChild.textContent = it.label;
    b.lastChild.textContent = it.key || '';
    b.onclick = () => { closeMenu(); it.run && it.run(); };
    frag.appendChild(b);
  }
  menuEl.replaceChildren(frag);
  menuEl.hidden = false;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.max(4, Math.min(W - r.width - 4, sx)) + 'px';
  menuEl.style.top = Math.max(4, Math.min(H - r.height - 4, sy)) + 'px';
  menuEl.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
function closeMenu() { if (menuEl && !menuEl.hidden) { menuEl.hidden = true; menuEl.replaceChildren(); } }
function onMenuKey(e) {
  const bs = [...menuEl.querySelectorAll('button:not(:disabled)')];
  const i = bs.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length]?.focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length]?.focus(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); cv.focus(); }
  e.stopPropagation();
}

function alignItems(ids) {
  const A = (mode, label) => ({ label, run: () => G.actions.align(ids, mode, sizeOf), disabled: ids.length < 2 });
  return [A('left', 'Align left'), A('centerX', 'Align center'), A('right', 'Align right'), A('top', 'Align top'), A('centerY', 'Align middle'),
    A('bottom', 'Align bottom'), A('distributeX', 'Distribute horizontally'), A('distributeY', 'Distribute vertically'), A('stackY', 'Stack in a column')];
}
function selectConnected(id, dir) {
  const g = state.graph, out = new Set([id]), stack = [id];
  while (stack.length) {
    const c = stack.pop();
    for (const l of g.links) {
      const nx = dir === 'up' ? (l.to[0] === c ? l.from[0] : null) : (l.from[0] === c ? l.to[0] : null);
      if (nx && !out.has(nx)) { out.add(nx); stack.push(nx); }
    }
  }
  setSel([...out]);
}
function openContext(sx, sy) {
  const g = state.graph; if (!g) return;
  const [gx, gy] = toG(sx, sy);
  const hn = hitNode(gx, gy);
  if (hn) {
    const n = hn.node;
    if (!sel.has(n.id)) setSel([n.id]);
    const ids = [...sel];
    const isOut = n.type === OUTPUT_TYPE;
    openMenu(sx, sy, [
      { label: 'Rename', key: 'F2', run: () => renameNode(n) },
      { label: 'Duplicate', key: 'Ctrl+D', disabled: isOut && ids.length === 1, run: () => { const r = G.actions.duplicate(ids); if (r) setSel(r); } },
      { label: 'Duplicate with inputs', key: 'Ctrl+Shift+D', disabled: isOut && ids.length === 1, run: () => { const r = G.actions.duplicate(ids, 30, 30, true); if (r) setSel(r); } },
      { label: 'Copy', key: 'Ctrl+C', run: copySel },
      { sep: true },
      { label: n.collapsed ? 'Expand' : 'Collapse', key: 'H', run: () => G.actions.setCollapsed(ids, !n.collapsed) },
      { label: n.preview === false ? 'Show preview' : 'Hide preview', key: 'P', run: () => G.actions.setPreview(ids, n.preview === false) },
      { label: 'Disconnect all wires', run: () => G.actions.edit('Disconnect', gg => ids.reduce((s, id) => s + G.disconnectNode(gg, id), 0) || false, { nodeIds: ids }) },
      { label: 'Select upstream', run: () => selectConnected(n.id, 'up') },
      { label: 'Select downstream', run: () => selectConnected(n.id, 'down') },
      { sep: true },
      { label: 'Frame selection', key: 'Ctrl+G', run: groupSel },
      { label: 'Auto layout selection', key: 'L', disabled: ids.length < 2, run: () => G.actions.autoLayout(ids, sizeOf) },
      ...alignItems(ids),
      { sep: true },
      { label: 'Dissolve (keep wire)', key: 'Ctrl+Del', disabled: isOut && ids.length === 1, run: () => G.actions.dissolve(ids) },
      { label: 'Delete', key: 'Del', disabled: isOut && ids.length === 1, run: () => G.actions.remove(ids) },
    ], ids.length > 1 ? `${ids.length} nodes` : (n.label || hn.L.def?.label || n.type));
    return;
  }
  const hf = hitFrame(gx, gy);
  if (hf) {
    const f = hf.frame;
    openMenu(sx, sy, [
      { label: 'Rename frame', run: () => renameFrame(f) },
      { swatches: G.FRAME_COLORS, run: c => G.actions.setFrame(f.id, { color: c }, { label: 'Frame color' }) },
      { label: 'Fit to contents', run: () => G.actions.edit('Fit frame', gg => G.fitFrame(gg, f.id, null, sizeOf), { kind: 'layout' }) },
      { label: 'Select nodes inside', run: () => { selFrames = new Set([f.id]); setSel(G.frameNodes(g, f.id), { keepFrames: true }); } },
      { label: 'Auto layout inside', run: () => G.actions.autoLayout(G.frameNodes(g, f.id), sizeOf) },
      { sep: true },
      { label: 'Delete frame', run: () => G.actions.removeFrames([f.id]) },
      { label: 'Delete frame and nodes', run: () => G.actions.remove(G.frameNodes(g, f.id), { frames: [f.id], label: 'Delete frame and nodes' }) },
    ], f.label || 'Frame');
    return;
  }
  const l = hitLink(gx, gy, 7);
  openMenu(sx, sy, [
    { label: 'Add node…', key: 'Tab', run: () => openPalette({ sx, sy, gx, gy }) },
    l ? { label: 'Add reroute on wire', run: () => addReroute(l, gx, gy) } : null,
    l ? { label: 'Delete wire', run: () => G.actions.disconnect(l.to) } : null,
    { label: 'Paste', key: 'Ctrl+V', run: () => { let j = null; try { j = localStorage.getItem(CLIP_KEY); } catch (e) {} mouse = { sx, sy, inside: true }; pasteText(j); } },
    { label: 'Add frame', run: () => { const f = G.actions.addFrame({ x: gx, y: gy, w: 360, h: 240 }, 'Frame'); if (f) renameFrame(f); } },
    { sep: true },
    { label: 'Select all', key: 'Ctrl+A', run: () => setSel(g.nodes.map(n => n.id)) },
    { label: 'Frame all', key: 'Home', run: fitAll },
    { label: 'Auto layout all', key: 'L', run: () => G.actions.autoLayout(null, sizeOf) },
    { sep: true },
    { label: 'Show node previews', on: prefs.preview, run: () => togglePref('preview') },
    { label: 'Show minimap', key: 'M', on: prefs.minimap, run: () => togglePref('minimap') },
    { label: 'Snap to grid', on: prefs.snap, run: () => togglePref('snap') },
  ], 'Graph');
}

function openEnumMenu(n, p, sx, sy) {
  const v = n.params[p.id] !== undefined ? n.params[p.id] : p.default;
  const opts = (p.options || []).map(o => typeof o === 'string' ? { value: o, label: o } : o);
  openMenu(sx, sy, opts.map(o => ({ label: o.label, on: o.value === v, run: () => G.actions.setParam(n.id, p.id, o.value, { merge: null }) })), p.label);
}

// ------------------------------------------------------------ INLINE INPUT
let inlineCommit = null;
function inlineInput(sx, sy, w, value, onCommit, opts = {}) {
  commitInline();
  inlineEl.hidden = false;
  inlineEl.style.left = Math.max(2, Math.min(W - w - 2, sx)) + 'px';
  inlineEl.style.top = Math.max(2, Math.min(H - 24, sy)) + 'px';
  inlineEl.style.width = w + 'px';
  inlineEl.value = value;
  inlineEl.inputMode = opts.numeric ? 'decimal' : 'text';
  inlineCommit = onCommit;
  setTimeout(() => { inlineEl.focus(); inlineEl.select(); }, 0);
}
function commitInline(cancel) {
  if (!inlineCommit) return;
  const fn = inlineCommit; inlineCommit = null;
  inlineEl.hidden = true;
  if (!cancel) fn(inlineEl.value);
  if (cv && document.activeElement === inlineEl) cv.focus({ preventScroll: true });
}
function renameNode(n) {
  const L = layout(n);
  const [sx, sy] = toS(n.x + 16, n.y + 1);
  inlineInput(sx, sy, Math.max(120, (L.w - 20) * view.s), n.label || L.def?.label || n.type, v => {
    const def = L.def;
    G.actions.rename(n.id, v.trim() && v.trim() !== def?.label ? v.trim() : null);
  });
}
function renameFrame(f) {
  const [sx, sy] = toS(f.x + 4, f.y + 1);
  inlineInput(sx, sy, Math.max(140, Math.min(320, (f.w - 10) * view.s)), f.label || 'Frame', v => G.actions.setFrame(f.id, { label: v.trim() || 'Frame' }, { label: 'Rename frame' }));
}
function renameGraph() {
  const r = crumbs.firstChild?.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
  const g = state.graph;
  inlineInput(r ? r.left - wr.left : 8, r ? r.top - wr.top : 4, 200, g.name || 'Untitled material', v => {
    G.actions.edit('Rename material', gg => { gg.name = v.trim() || undefined; if (!gg.name) delete gg.name; return true; }, { kind: 'layout' });
    renderCrumbs();
  });
}
function typeParam(hn) {
  const n = hn.node, p = hn.p, L = hn.L;
  const v = n.params[p.id] !== undefined ? n.params[p.id] : p.default;
  const [sx, sy] = toS(n.x + 8, n.y + hn.row.y + 1);
  const str = p.kind === 'vec2' ? (Array.isArray(v) ? v.join(', ') : '0, 0') : String(v);
  inlineInput(sx, sy, Math.max(90, (L.w - 16) * view.s), str, s => {
    let nv;
    if (p.kind === 'vec2') { const a = s.split(/[\s,;]+/).filter(Boolean).map(Number); if (a.length < 2 || a.some(x => !Number.isFinite(x))) return; nv = [quant(a[0], p), quant(a[1], p)]; }
    else {
      // allow simple math: "0.5*2"
      let x = Number(s);
      if (!Number.isFinite(x) && /^[\d\s.+\-*/()eE]+$/.test(s)) { try { x = Function(`"use strict";return (${s})`)(); } catch (e) { x = NaN; } }
      if (!Number.isFinite(x)) return;
      nv = quant(x, p);
    }
    G.actions.setParam(n.id, p.id, nv, { merge: null });
  }, { numeric: true });
}
let colorTarget = null;
function openColor(n, p, sx, sy) {
  const v = n.params[p.id] !== undefined ? n.params[p.id] : p.default;
  colorTarget = { id: n.id, pid: p.id, label: p.label, merge: `param:${n.id}.${p.id}:${++paramSeq}`, changed: false };
  colorEl.value = hexOk(v) ? v : '#808080';
  colorEl.style.left = Math.min(W - 30, sx) + 'px'; colorEl.style.top = Math.min(H - 30, sy) + 'px';
  try { colorEl.showPicker ? colorEl.showPicker() : colorEl.click(); } catch (e) { colorEl.click(); }
}

// ------------------------------------------------------------ TOOLBAR
let statusHover = '';
function setStatusHover(t) { if (t !== statusHover) { statusHover = t; renderStatusSoon(); } }
let statusRaf = 0;
function renderStatusSoon() { if (!statusRaf) statusRaf = requestAnimationFrame(() => { statusRaf = 0; updateStatus(); }); }
let lastVisible = 0;
function updateStatus(visible) {
  if (!statusEl || !state.graph) return;
  if (visible !== undefined) lastVisible = visible;
  const g = state.graph;
  const left = `${g.nodes.length} nodes · ${g.links.length} wires${sel.size ? ` · ${sel.size} sel` : ''} · ${Math.round(view.s * 100)}%`;
  const a = statusEl.firstChild, b = statusEl.lastChild;
  if (a.textContent !== left) a.textContent = left;
  if (b.textContent !== statusHover) b.textContent = statusHover;
}
function renderCrumbs() {
  if (!crumbs || !state.graph) return;
  const g = state.graph;
  const parts = [{ label: g.name || 'Untitled material', run: fitAll, dbl: renameGraph, title: 'Frame all · double-click to rename' }];
  const ids = [...sel];
  if (ids.length) {
    const n = G.nodeById(g, ids[0]);
    const f = n && g.frames.find(fr => n.x >= fr.x && n.y >= fr.y && n.x < fr.x + fr.w && n.y < fr.y + fr.h);
    if (f) parts.push({ label: f.label || 'Frame', run: () => fitRect({ x: f.x, y: f.y, w: f.w, h: f.h }, 30), title: 'Frame this group' });
    parts.push({ label: ids.length > 1 ? `${ids.length} nodes` : (n?.label || G.getDef(n?.type)?.label || n?.type || ''), run: fitSelection, title: 'Frame the selection (F)' });
  } else if (selFrames.size === 1) {
    const f = g.frames.find(fr => selFrames.has(fr.id));
    if (f) parts.push({ label: f.label || 'Frame', run: () => fitRect({ x: f.x, y: f.y, w: f.w, h: f.h }, 30) });
  }
  const key = parts.map(p => p.label).join('\u0000');
  if (crumbs.dataset.key === key) return;
  crumbs.dataset.key = key;
  const frag = document.createDocumentFragment();
  parts.forEach((p, i) => {
    if (i) { const s = document.createElement('span'); s.className = 'ge-crumb-sep'; s.textContent = '›'; frag.appendChild(s); }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ge-crumb'; b.textContent = p.label; b.title = p.title || '';
    b.onclick = p.run; if (p.dbl) b.ondblclick = p.dbl;
    frag.appendChild(b);
  });
  crumbs.replaceChildren(frag);
}

const TOOLS = [
  ['add', 'Add', 'Add a node (Tab)'],
  ['fit', 'Fit', 'Frame the selection or all (F / Home)'],
  ['align', 'Align', 'Align and distribute the selection'],
  ['layout', 'Layout', 'Auto layout the selection or all (L)'],
  ['group', 'Frame', 'Put a frame around the selection (Ctrl+G)'],
  ['collapse', 'Fold', 'Collapse or expand the selection (H)'],
  ['dup', 'Dup', 'Duplicate the selection (Ctrl+D)'],
  ['del', 'Del', 'Delete the selection (Del)'],
  ['sep'],
  ['preview', 'Prev', 'Node previews (P)', 'preview'],
  ['minimap', 'Map', 'Minimap (M)', 'minimap'],
  ['snap', 'Snap', 'Snap to the grid', 'snap'],
  ['box', 'Box', 'Touch: one finger draws a selection box', 'boxMode'],
];
function onTool(id, btn) {
  const ids = [...sel];
  const r = btn.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
  const bx = r.left - wr.left, by = r.bottom - wr.top + 2;
  switch (id) {
    case 'add': { const [gx, gy] = viewCenterG(); openPalette({ sx: bx, sy: by, gx, gy }); break; }
    case 'fit': if (ids.length) fitSelection(); else fitAll(); break;
    case 'align': openMenu(bx, by, alignItems(ids), ids.length < 2 ? 'Select 2+ nodes' : 'Align'); break;
    case 'layout': G.actions.autoLayout(ids.length > 1 ? ids : null, sizeOf); break;
    case 'group': if (ids.length) groupSel(); else toast('Select nodes to frame', 'info', 1400); break;
    case 'collapse': if (ids.length) { const any = ids.some(i => !G.nodeById(state.graph, i)?.collapsed); G.actions.setCollapsed(ids, any); } break;
    case 'dup': if (ids.length) { const n = G.actions.duplicate(ids); if (n) setSel(n); } break;
    case 'del': if (ids.length || selFrames.size) G.actions.remove(ids, { frames: [...selFrames] }); break;
    case 'preview': togglePref('preview'); break;
    case 'minimap': togglePref('minimap'); break;
    case 'snap': togglePref('snap'); break;
    case 'box': togglePref('boxMode'); break;
  }
}
function togglePref(k) {
  prefs[k] = !prefs[k];
  for (const b of bar.querySelectorAll('button[data-pref]')) b.classList.toggle('on', !!prefs[b.dataset.pref]);
  dirty(); savePrefs();
}
function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ prefs })); } catch (e) {}
}
function loadPrefs() {
  try {
    const j = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
    if (j?.prefs) for (const k of Object.keys(prefs)) if (typeof j.prefs[k] === 'boolean') prefs[k] = j.prefs[k];
  } catch (e) {}
}

// ------------------------------------------------------------ LIBRARY
let libDirty = true, libTimer = 0, libOpen = new Set(['Recent', 'Input', 'Generator', 'Noise']);
try { const j = JSON.parse(localStorage.getItem(LIB_KEY) || 'null'); if (Array.isArray(j)) libOpen = new Set(j); } catch (e) {}
function scheduleLib() { clearTimeout(libTimer); libTimer = setTimeout(buildLibrary, 50); }
function libGroups() {
  const groups = new Map();
  const add = (key, d, label, color) => { if (!groups.has(key)) groups.set(key, { key, label, color, defs: [] }); groups.get(key).defs.push(d); };
  for (const d of allDefs()) {
    if (d.source === 'bench' || d.type.startsWith('bench.')) {
      const lib = d.lib || d.type.split('.')[1] || 'bench';
      add('Bench/' + lib, d, lib, catColor('Bench'));
    } else add(d.category || 'Other', d, d.category || 'Other', catColor(d.category));
  }
  const arr = [...groups.values()];
  arr.sort((a, b) => {
    const ab = a.key.startsWith('Bench/'), bb = b.key.startsWith('Bench/');
    if (ab !== bb) return ab ? 1 : -1;
    return catRank(a.key) - catRank(b.key) || a.label.localeCompare(b.label);
  });
  for (const gr of arr) gr.defs.sort((a, b) => a.label.localeCompare(b.label));
  return arr;
}
function libItem(d) {
  const el = document.createElement('div');
  el.className = 'ge-lib-it'; el.draggable = true; el.dataset.type = d.type; el.tabIndex = 0;
  el.innerHTML = '<i></i><span></span><em></em>';
  el.firstChild.style.background = catColor(d.category);
  el.children[1].textContent = d.label;
  el.lastChild.textContent = (d.outputs || []).map(p => p.type[0]).join('');
  el.title = `${d.label} · ${d.type}${d.doc ? '\n' + d.doc : ''}\nClick to add · drag onto the graph`;
  return el;
}
function buildLibrary() {
  libTimer = 0;
  const body = document.getElementById('lib-body');
  if (!body) return;
  libDirty = false;
  // panels.js can own #lib-body (class pn-lib): then this library stands down
  if (body.classList.contains('pn-lib')) return;
  if (!body.querySelector('.ge-lib-q')) {
    body.innerHTML = '<div class="ge-lib-search"><input class="ge-lib-q" type="search" placeholder="Search nodes" aria-label="Search nodes" spellcheck="false"><span class="ge-lib-n"></span></div><div class="ge-lib-tree"></div>';
    const q = body.querySelector('.ge-lib-q');
    q.addEventListener('input', () => buildLibrary());
    q.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const first = body.querySelector('.ge-lib-it'); if (first) addFromLib(first.dataset.type); }
      if (e.key === 'Escape') { q.value = ''; buildLibrary(); }
      e.stopPropagation();
    });
    const tree = body.querySelector('.ge-lib-tree');
    tree.addEventListener('click', e => {
      const head = e.target.closest('.ge-lib-head');
      if (head) { const k = head.dataset.key; if (libOpen.has(k)) libOpen.delete(k); else libOpen.add(k); try { localStorage.setItem(LIB_KEY, JSON.stringify([...libOpen])); } catch (er) {} buildLibrary(); return; }
      const it = e.target.closest('.ge-lib-it');
      if (it) addFromLib(it.dataset.type);
    });
    tree.addEventListener('keydown', e => { const it = e.target.closest('.ge-lib-it'); if (it && e.key === 'Enter') addFromLib(it.dataset.type); });
    tree.addEventListener('dragstart', e => {
      const it = e.target.closest('.ge-lib-it'); if (!it) return;
      e.dataTransfer.setData('application/x-material-node', it.dataset.type);
      e.dataTransfer.setData('text/plain', it.dataset.type);
      e.dataTransfer.effectAllowed = 'copy';
    });
  }
  const q = body.querySelector('.ge-lib-q').value.trim();
  const tree = body.querySelector('.ge-lib-tree');
  const frag = document.createDocumentFragment();
  const total = allDefs().length;
  if (q) {
    const res = searchDefs(q, null, 400);
    body.querySelector('.ge-lib-n').textContent = `${res.length}${res.length >= 400 ? '+' : ''}`;
    for (const r of res) frag.appendChild(libItem(r.d));
    if (!res.length) { const e = document.createElement('div'); e.className = 'ge-lib-empty'; e.textContent = 'No match'; frag.appendChild(e); }
  } else {
    body.querySelector('.ge-lib-n').textContent = String(total);
    const rec = recent().map(t => state.registry.get(t)).filter(Boolean).slice(0, 8);
    const groups = libGroups();
    if (rec.length) groups.unshift({ key: 'Recent', label: 'Recent', color: '#e8ecf4', defs: rec });
    let benchHead = false;
    for (const gr of groups) {
      if (gr.key.startsWith('Bench/') && !benchHead) {
        benchHead = true;
        const h = document.createElement('div'); h.className = 'ge-lib-sec'; h.textContent = 'Composition Bench'; frag.appendChild(h);
      }
      const open = libOpen.has(gr.key);
      const head = document.createElement('button');
      head.type = 'button'; head.className = 'ge-lib-head' + (open ? ' open' : ''); head.dataset.key = gr.key;
      head.innerHTML = '<b></b><i></i><span></span><em></em>';
      head.children[1].style.background = gr.color;
      head.children[2].textContent = gr.label;
      head.lastChild.textContent = gr.defs.length;
      frag.appendChild(head);
      if (open) { const box = document.createElement('div'); box.className = 'ge-lib-group'; for (const d of gr.defs) box.appendChild(libItem(d)); frag.appendChild(box); }
    }
  }
  tree.replaceChildren(frag);
}
let libCascade = 0;
function addFromLib(type) {
  const d = G.getDef(type); if (!d) return;
  const [gx, gy] = viewCenterG();
  const off = (libCascade++ % 6) * 24;
  const id = addFromDef(d, gx - 80 + off, gy - 40 + off);
  if (id) { setSel([id]); toast(`Added ${d.label}`, 'ok', 1000); }
  else if (type === OUTPUT_TYPE) toast('The graph has one Material Output', 'warn', 1600);
  if (!libTimer) scheduleLib();
}

// ------------------------------------------------------------ API
/** Build `n` nodes in a grid with chains of links (stress test). Returns ids. */
function stress(n = 200) {
  const defs = allDefs().filter(d => (d.outputs || []).length && d.type !== OUTPUT_TYPE);
  const withIn = defs.filter(d => (d.inputs || []).length);
  return G.actions.edit(`Stress ${n}`, g => {
    const ids = [];
    let prev = null;
    for (let i = 0; i < n; i++) {
      const pool = i % 3 && withIn.length ? withIn : defs;
      const d = pool[i % pool.length] || G.REROUTE_DEF;
      const node = G.addNode(g, d.type, (i % 20) * 200, Math.floor(i / 20) * 190);
      ids.push(node.id);
      if (prev && (d.inputs || []).length) {
        const L = layout(node);
        for (const pid of L.ins.keys()) { const pn = G.nodeById(g, prev); const op = [...layout(pn).outs.keys()][0]; if (op && G.connect(g, [prev, op], [node.id, pid])) break; }
      }
      prev = node.id;
    }
    return ids;
  }, {});
}

/** Draw now and return the time in ms. */
function renderNow() { if (raf) { cancelAnimationFrame(raf); raf = 0; } const t = performance.now(); render(); return performance.now() - t; }

/** Shortcut list for a help overlay (panels.js reads editor.shortcuts). */
export const SHORTCUTS = Object.freeze([
  { keys: 'Tab / Space / Shift+A', label: 'Add a node (search palette)' },
  { keys: 'Drag a socket', label: 'Connect; drop on empty space to add a typed node' },
  { keys: 'Drag an input wire', label: 'Detach and move the wire' },
  { keys: 'Right drag', label: 'Cut wires (knife)' },
  { keys: 'Double-click a wire', label: 'Add a reroute dot' },
  { keys: 'Drop a lone node on a wire', label: 'Insert it in the wire' },
  { keys: 'Alt+drag a node', label: 'Duplicate and move' },
  { keys: 'Del / Backspace', label: 'Delete the selection' },
  { keys: 'Ctrl+Del', label: 'Dissolve: delete and keep the wire' },
  { keys: 'Ctrl+D / Ctrl+Shift+D', label: 'Duplicate (with inputs)' },
  { keys: 'Ctrl+C / X / V', label: 'Copy, cut, paste (works across tabs)' },
  { keys: 'Ctrl+A / Alt+A / Ctrl+I', label: 'Select all, none, invert' },
  { keys: 'Ctrl+G', label: 'Frame (group) the selection' },
  { keys: 'F / Home', label: 'Frame the selection / all' },
  { keys: 'H / P', label: 'Collapse / toggle preview' },
  { keys: 'L', label: 'Auto layout the selection or all' },
  { keys: 'M', label: 'Minimap' },
  { keys: 'Arrows (Shift)', label: 'Nudge 10 (100) units' },
  { keys: 'F2 / double-click header', label: 'Rename' },
  { keys: 'Slider: drag (Shift fine)', label: 'Change a value; double-click to type' },
  { keys: 'Wheel / pinch / middle drag', label: 'Zoom / zoom / pan' },
]);

export const api = {
  /** The editor does its own touch pan and pinch (mobile.js reads this). */
  touch: true,
  shortcuts: SHORTCUTS,
  /** Client (page) px -> graph units. */
  screenToGraph(clientX, clientY) { const r = cv.getBoundingClientRect(); return toG(clientX - r.left, clientY - r.top); },
  /** Pan the view by screen px. */
  panBy(dx, dy) { view.tx += dx; view.ty += dy; dirty(); },
  /**
   * Add a node of `type` under a client point (or at the view center when the
   * point is missing or outside the canvas), select it. @returns {string|null} id
   */
  addNodeAt(type, clientX, clientY) {
    const d = G.getDef(type); if (!d) return null;
    const r = cv.getBoundingClientRect();
    let gx, gy;
    if (Number.isFinite(clientX) && Number.isFinite(clientY) && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) [gx, gy] = toG(clientX - r.left, clientY - r.top);
    else { [gx, gy] = viewCenterG(); const off = (libCascade++ % 6) * 24; gx += off - 80; gy += off - 40; }
    const id = addFromDef(d, gx, gy);
    if (id) setSel([id]);
    return id;
  },
  get view() { return { ...view }; },
  get selection() { return [...sel]; },
  get frames() { return [...selFrames]; },
  get prefs() { return { ...prefs }; },
  get frameTime() { return frameTime; },
  select: ids => setSel(ids),
  fitAll, fitSelection, zoomAt, dirty, renderNow, stress, layout: n => layout(n), sizeOf,
  /** Center the view on a node and select it. */
  focusNode(id) { const n = G.nodeById(state.graph, id); if (!n) return false; setSel([id]); fitRect(G.bounds(state.graph, [id], sizeOf), 80, 1); return true; },
  openPalette(opts = {}) { const [gx, gy] = viewCenterG(); openPalette({ sx: W / 2 - 150, sy: 40, gx, gy, ...opts }); },
  closePalette, search: (q, wire) => searchDefs(q, wire).map(r => r.d.type),
  addFromDef: (type, x, y, wire) => { const d = G.getDef(type); return d ? addFromDef(d, x, y, wire) : null; },
  copy: copySel, pasteText, togglePref,
  invalidateThumbs(id) { if (id) thumbs.delete(id); else thumbGen++; dirty(); },
  toGraph: toG, toScreen: toS,
  refreshLibrary: () => buildLibrary(),
  selfTest: editorSelfTest,
};

// ------------------------------------------------------------ selfTest
/**
 * Render checks: a 200-node stress graph draws, a palette search returns
 * results, a type-filtered search keeps only compatible nodes, fit and zoom
 * work, then the old graph comes back (the undo history is reset).
 */
async function editorSelfTest() {
  const checks = {}, detail = {};
  const saved = state.graph ? G.serialize(state.graph) : null;
  const savedView = { ...view };
  try {
    checks.canvas = !!cx && W > 0 && H > 0;
    detail.size = [W, H];
    const ids = stress(200);
    checks.stress = Array.isArray(ids) && ids.length === 200;
    fitAll();
    const times = [];
    for (let i = 0; i < 20; i++) { view.tx += (i % 2 ? 7 : -7); times.push(renderNow()); }
    times.sort((a, b) => a - b);
    detail.render200 = { median: +times[10].toFixed(2), max: +times[19].toFixed(2), links: state.graph.links.length };
    checks.smooth = times[10] < 16;
    view.s = 1; renderNow();
    detail.render200zoom1 = +renderNow().toFixed(2);
    checks.search = searchDefs('value', null).length > 0;
    const wired = searchDefs('', { dir: 'in', type: 'normal' });
    checks.wireFilter = wired.every(r => (r.d.outputs || []).some(p => G.typesCompatible(p.type, 'normal')));
    detail.normalFeeders = wired.length;
    setSel(ids.slice(0, 5));
    checks.select = state.selection.length === 5;
    openPalette({ sx: 20, sy: 40, gx: 0, gy: 0 });
    checks.palette = !palEl.hidden && pal.items.length > 0;
    closePalette();
    checks.paletteClosed = palEl.hidden;
  } catch (e) {
    checks.threw = false; detail.error = String(e && e.stack || e);
  } finally {
    G.flushChanged();
    skipFit = true;
    if (saved) G.actions.load(saved);
    skipFit = false;
    Object.assign(view, savedView);
    setSel([]);
    dirty();
  }
  return { ok: Object.values(checks).every(Boolean), checks, detail };
}

// ------------------------------------------------------------ init
function buildDom() {
  wrap = document.getElementById('graph-wrap');
  wrap.classList.add('ge');
  wrap.innerHTML = `
    <div class="ge-bar"><nav class="ge-crumbs" aria-label="Graph path"></nav><div class="ge-tools" role="toolbar" aria-label="Graph tools"></div></div>
    <canvas class="ge-cv" tabindex="0" aria-label="Node graph canvas. Tab adds a node."></canvas>
    <div class="ge-status"><span></span><span></span></div>
    <div class="ge-pal" hidden><div class="ge-pal-head"></div><input type="search" placeholder="Search nodes" spellcheck="false" aria-label="Search nodes"><div class="ge-pal-list" role="listbox"></div><div class="ge-pal-doc"></div></div>
    <div class="ge-menu" role="menu" hidden></div>
    <input class="ge-inline" hidden spellcheck="false">
    <input class="ge-color" type="color" tabindex="-1" aria-hidden="true">`;
  bar = wrap.querySelector('.ge-bar');
  crumbs = wrap.querySelector('.ge-crumbs');
  cv = wrap.querySelector('.ge-cv');
  cx = cv.getContext('2d');
  statusEl = wrap.querySelector('.ge-status');
  palEl = wrap.querySelector('.ge-pal');
  menuEl = wrap.querySelector('.ge-menu');
  inlineEl = wrap.querySelector('.ge-inline');
  colorEl = wrap.querySelector('.ge-color');
  const tools = wrap.querySelector('.ge-tools');
  for (const [id, label, title, pref] of TOOLS) {
    if (id === 'sep') { const s = document.createElement('span'); s.className = 'ge-tsep'; tools.appendChild(s); continue; }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ge-tool'; b.dataset.tool = id; b.textContent = label; b.title = title;
    if (pref) { b.dataset.pref = pref; b.classList.toggle('on', !!prefs[pref]); }
    tools.appendChild(b);
  }
  tools.addEventListener('click', e => { const b = e.target.closest('button[data-tool]'); if (b) onTool(b.dataset.tool, b); });

  cv.addEventListener('pointerdown', onPointerDown);
  cv.addEventListener('pointermove', onPointerMove);
  cv.addEventListener('pointerup', onPointerUp);
  cv.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); if (drag?.mode !== 'pinch') cancelDrag(); else if (pointers.size < 2) drag = null; });
  cv.addEventListener('pointerleave', () => { mouse.inside = false; if (!drag && hover) { hover = null; dirty(); } });
  cv.addEventListener('pointerenter', () => { mouse.inside = true; });
  cv.addEventListener('dblclick', onDblClick);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('gesturestart', onGesture); cv.addEventListener('gesturechange', onGesture);
  cv.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('application/x-material-node')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  cv.addEventListener('drop', e => {
    const type = e.dataTransfer.getData('application/x-material-node');
    if (!type) return;
    e.preventDefault();
    const [sx, sy] = evPos(e); const [gx, gy] = toG(sx, sy);
    const d = G.getDef(type); if (!d) return;
    // dropped on a wire: insert
    const id = addFromDef(d, gx - 20, gy - 10);
    if (id) setSel([id]);
  });
  palEl.querySelector('input').addEventListener('input', fillPalette);
  palEl.querySelector('input').addEventListener('keydown', onPalKey);
  palEl.querySelector('.ge-pal-list').addEventListener('pointerdown', e => { const it = e.target.closest('.ge-pal-it'); if (it) { e.preventDefault(); choosePal(+it.dataset.i); } });
  palEl.querySelector('.ge-pal-list').addEventListener('pointermove', e => { const it = e.target.closest('.ge-pal-it'); if (it && pal && pal.idx !== +it.dataset.i) { pal.idx = +it.dataset.i; markPal(); } });
  palEl.querySelector('input').addEventListener('blur', () => setTimeout(() => { if (pal && !palEl.contains(document.activeElement)) closePalette(); }, 120));
  menuEl.addEventListener('keydown', onMenuKey);
  inlineEl.addEventListener('keydown', e => { if (e.key === 'Enter') commitInline(); else if (e.key === 'Escape') commitInline(true); e.stopPropagation(); });
  inlineEl.addEventListener('blur', () => commitInline());
  colorEl.addEventListener('input', () => { if (colorTarget) { G.actions.setParam(colorTarget.id, colorTarget.pid, colorEl.value, { checkpoint: false }); colorTarget.changed = true; dirty(); } });
  colorEl.addEventListener('change', () => { if (colorTarget) { G.actions.setParam(colorTarget.id, colorTarget.pid, colorEl.value, { checkpoint: false }); G.actions.commit(`Set ${colorTarget.label}`, { merge: colorTarget.merge }); colorTarget = null; } });
  window.addEventListener('keydown', onKey);
  window.addEventListener('paste', onPaste);
  window.addEventListener('pointerdown', e => { if (menuEl && !menuEl.hidden && !menuEl.contains(e.target)) closeMenu(); }, true);

  const resize = () => {
    const r = wrap.getBoundingClientRect();
    const cr = cv.getBoundingClientRect();
    const nw = Math.max(0, Math.round(cr.width || r.width)), nh = Math.max(0, Math.round(cr.height || r.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (nw === W && nh === H && cv.width === Math.round(nw * dpr)) return;
    const first = !W || !H;
    W = nw; H = nh;
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    // the first real size (a phone sheet opens later): fit the graph
    if (first && W && H) fitAll();
    dirty();
  };
  new ResizeObserver(resize).observe(wrap);
  window.addEventListener('resize', resize);
  resize();
}

let skipFit = false;
/** @param {object} ctx main.js module context */
export async function init(ctx) {
  loadPrefs();
  buildDom();
  buildLibrary();
  on('graph:changed', p => {
    const r = p?.reason;
    if (r === 'undo' || r === 'redo' || r === 'load' || r === 'boot') {
      if (drag) { drag = null; }
      pruneSel();
      if (skipFit) skipFit = false;
      else if (r === 'load' || r === 'boot') requestAnimationFrame(() => fitAll());
      thumbGen++;
    } else pruneSel();
    renderCrumbs();
    dirty();
  });
  on('graph:layout', () => { renderCrumbs(); dirty(); });
  on('graph:select', ({ ids }) => {
    const key = [...ids].sort().join(',');
    if (key !== [...sel].sort().join(',')) { sel = new Set(ids); lastEmitted = key; dirty(); }
    renderCrumbs();
  });
  on('bake:done', () => { thumbGen++; errors.clear(); for (const e of state.compiled?.errors || []) if (e.nodeId) errors.set(e.nodeId, e.message); dirty(); });
  on('bake:error', p => { if (p?.nodeId) errors.set(p.nodeId, p.message || 'error'); dirty(); });
  on('bake:thumb', p => { if (p?.nodeId) { thumbs.delete(p.nodeId); dirty(); } });
  ctx.register('editor', api);
}

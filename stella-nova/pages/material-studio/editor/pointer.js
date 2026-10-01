// ============================================================================
//  MATERIAL STUDIO  ·  editor/pointer.js — pointer gestures and drag modes
// ────────────────────────────────────────────────────────────────────────────
//  Owns the active drag, the hover target and the last pointer position.
//  pointerdown picks a drag mode from what is under the pointer. pointermove
//  updates the mode after a small dead zone. pointerup closes it with one
//  graph.js action (one undo step). A second touch starts a pinch. A touch
//  held 550 ms without a move opens the context menu.
//
//  DRAG MODES (drag.mode)
//      pan · minimap · nodes · frame · frame-resize · box · rclick · cut
//      wire · param · pinch
//
//  GREP TARGETS
//      export let drag / hover / mouse ... live state that render reads
//      onPointerDown / onPointerMove / onPointerUp
//      onPointerCancel / onPointerLeave / onPointerEnter
//      startWire / startParam / paramValueAt
//      onDragStart .... Alt+drag duplicate, lone node for wire insert
//      moveDragNodes .. snap move, insert target under a lone node
//      applyBox ....... box selection preview
//      cancelDrag / clearDrag
//      startPinch / movePinch
//      updateHover .... cursor, hover target, status tip
//      onDblClick ..... type a value, rename, reroute, palette
//      evPos .......... event -> canvas px
// ============================================================================
import * as G from '../graph.js';
import { state } from '../store.js';
import { cv, palEl, view, toG, prefs, SNAP, HEAD, ZMIN, ZMAX } from './state.js';
import { layout, portPos } from './layout.js';
import { sel, selFrames, setSel, setSelFrames, setBoxSel } from './selection.js';
import { hitPort, hitNode, hitFrame, hitLink, linksCrossing } from './hit.js';
import { inMinimap, minimapTo } from './minimap.js';
import { dirty } from './render.js';
import { computeOkPorts, bestPortOn, endWire, insertOnLink, addReroute } from './wire.js';
import { quant, nextMerge } from './params.js';
import { closeMenu, openContext, openEnumMenu } from './menu.js';
import { openPalette, closePalette } from './palette.js';
import { commitInline, typeParam, renameNode, renameFrame, openColor } from './inline.js';
import { setStatusHover } from './toolbar.js';

export let hover = null;                // {kind, id, port?, side?, row?} under the pointer
export let mouse = { sx: -1, sy: -1, inside: false };
export let drag = null;
export function setMouse(m) { mouse = m; }
export function clearDrag() { if (drag) { drag = null; } }

const pointers = new Map();
let longPress = 0;
export function evPos(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

export function onPointerDown(e) {
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
    if (e.shiftKey || e.ctrlKey || e.metaKey) selFrames.add(f.id); else if (!selFrames.has(f.id)) { setSelFrames(new Set([f.id])); setSel([], { keepFrames: true }); }
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
    merge: nextMerge(n, p), fine: e.shiftKey,
  };
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

export function onPointerMove(e) {
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
  // emit on pointerup
  setBoxSel(next, new Set(g.frames.filter(f => f.x >= x0 && f.y >= y0 && f.x + f.w <= x1 && f.y + f.h <= y1).map(f => f.id)));
}

export function onPointerUp(e) {
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

export function cancelDrag() {
  const d = drag; drag = null;
  if (!d) return;
  const g = state.graph;
  if (d.mode === 'nodes' && d.orig && d.moved) for (const n of g.nodes) if (d.orig[n.id]) [n.x, n.y] = d.orig[n.id];
  if (d.mode === 'wire' && d.detached) { G.connect(g, d.detached.from, d.detached.to); G.queueChanged({ reason: 'edit' }); }
  if (d.mode === 'param' && d.moved) { G.actions.setParam(d.id, d.p.id, d.v0, { checkpoint: false }); }
  dirty();
}
export function onPointerCancel(e) { pointers.delete(e.pointerId); if (drag?.mode !== 'pinch') cancelDrag(); else if (pointers.size < 2) drag = null; }
export function onPointerLeave() { mouse.inside = false; if (!drag && hover) { hover = null; dirty(); } }
export function onPointerEnter() { mouse.inside = true; }

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

export function onDblClick(e) {
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

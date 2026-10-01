// ============================================================================
//  MATERIAL STUDIO  ·  editor/selection.js — the selected nodes and frames
// ────────────────────────────────────────────────────────────────────────────
//  Owns the selected node ids (`sel`) and frame ids (`selFrames`). setSel
//  sends 'graph:select' through store.js only when the node set changes.
//  syncSel takes a selection that came from another module back in without
//  a new event.
//
//  GREP TARGETS
//      export let sel ....... selected node ids (Set)
//      setSel ............... set the node ids, emit, redraw
//      setSelFrames ......... set the frame ids
//      setBoxSel ............ box-drag preview (no emit, pointerup emits)
//      syncSel .............. 'graph:select' from outside the editor
//      pruneSel ............. drop ids that left the graph
//      selectConnected ...... upstream / downstream walk
// ============================================================================
import { state, select as storeSelect } from '../store.js';
import { dirty } from './render.js';

export let sel = new Set();
export let selFrames = new Set();
let lastEmitted = '';

export function setSel(ids, opts = {}) {
  sel = new Set(ids);
  if (!opts.keepFrames) selFrames = new Set();
  const key = [...sel].sort().join(',');
  if (opts.emit !== false && key !== lastEmitted) { lastEmitted = key; storeSelect([...sel]); }
  else if (opts.emit === false) lastEmitted = key;
  dirty();
}
export function setSelFrames(fids) { selFrames = fids; }
export function setBoxSel(ids, fids) { sel = ids; selFrames = fids; }
export function syncSel(ids) {
  const key = [...ids].sort().join(',');
  if (key !== [...sel].sort().join(',')) { sel = new Set(ids); lastEmitted = key; dirty(); }
}
export function pruneSel() {
  const g = state.graph; if (!g) return;
  const ids = new Set(g.nodes.map(n => n.id)), fids = new Set(g.frames.map(f => f.id));
  const keep = [...sel].filter(id => ids.has(id));
  selFrames = new Set([...selFrames].filter(id => fids.has(id)));
  if (keep.length !== sel.size) setSel(keep, { keepFrames: true });
}
export function selectConnected(id, dir) {
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

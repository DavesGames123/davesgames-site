// ============================================================================
//  MATERIAL STUDIO  ·  editor/api.js — __studio.editor and the shortcut list
// ────────────────────────────────────────────────────────────────────────────
//  The public face of the editor. init() in editor.js registers `api` as
//  __studio.editor. panels.js reads `shortcuts` for its help overlay and
//  calls toGraph / addFromDef. mobile.js reads `touch` and calls addNodeAt.
//
//  GREP TARGETS
//      SHORTCUTS ... [{keys, label}] for a help overlay
//      export const api ... the __studio.editor object
//      addNodeAt ... add under a client point or at the view center
//      focusNode ... select a node and center the view on it
//      stress ...... n nodes in a grid with chains of links
// ============================================================================
import { OUTPUT_TYPE } from '../contract.js';
import * as G from '../graph.js';
import { state } from '../store.js';
import { cv, W, view, prefs, toG, toS } from './state.js';
import { layout } from './layout.js';
import { fitRect, fitAll, fitSelection, zoomAt, sizeOf, viewCenterG } from './view.js';
import { sel, selFrames, setSel } from './selection.js';
import { dirty, renderNow, frameTime } from './render.js';
import { invalidateThumbs } from './thumbs.js';
import { allDefs, searchDefs } from './search.js';
import { openPalette, closePalette, addFromDef } from './palette.js';
import { copySel, pasteText } from './clipboard.js';
import { togglePref } from './toolbar.js';
import { buildLibrary, nextCascade } from './library.js';
import { editorSelfTest } from './selftest.js';

/** Build `n` nodes in a grid with chains of links (stress test). Returns ids. */
export function stress(n = 200) {
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
    else { [gx, gy] = viewCenterG(); const off = nextCascade(); gx += off - 80; gy += off - 40; }
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
  invalidateThumbs,
  toGraph: toG, toScreen: toS,
  refreshLibrary: () => buildLibrary(),
  selfTest: editorSelfTest,
};

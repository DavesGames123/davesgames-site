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
//  This file is the entry that main.js loads. It keeps the module exports
//  and init(). The work is in editor/, one concern per file. Each file
//  opens with a header and its grep targets.
//
//  DATA FLOW
//      state.graph ─▶ layout(node) (cached per node object) ─▶ render()
//      pointer / keys ─▶ drag modes ─▶ graph.js actions ─▶ store events
//      'graph:changed' / 'graph:layout' / 'graph:select' ─▶ dirty() ─▶ rAF
//      'bake:done' ─▶ thumbGen++ ─▶ __studio.bake.thumb(nodeId) per visible
//                     node ─▶ thumbs cache ─▶ node preview square
//      'bake:error' {nodeId} ─▶ red outline on that node
//
//  MODULES  (editor/<name>.js)
//      state ........ constants, colors, DOM and size bindings, view, prefs
//      view ......... zoomAt, fitRect, fitAll, fitSelection, viewCenterG
//      layout ....... layout(node): size, port and row positions; wire curve
//      selection .... sel / selFrames, setSel, syncSel, pruneSel
//      thumbs ....... live thumbnails from __studio.bake.thumb, bake errors
//      render ....... dirty, render: grid, frames, links, overlays
//      node-draw .... one node: header, preview, rows, param widgets, ports
//      minimap ...... the minimap corner: draw, hit, move the view
//      paint ........ fitText, checkerPattern, roundRect
//      params ....... param value format, quantize, undo merge key
//      hit .......... hitPort / hitNode / hitFrame / hitLink / linksCrossing
//      pointer ...... drag modes: pan nodes box wire cut param frame pinch
//      wire ......... connect, reconnect, insert on a wire, reroute
//      wheel ........ trackpad pan, pinch zoom, mouse-wheel zoom
//      keys ......... shortcuts (see KEYMAP)
//      clipboard .... copy / paste through localStorage + system clipboard
//      search ....... def search ranking and the recent list
//      palette ...... searchable add-node box, type filtered on wire drop
//      menu ......... context menu and enum menus
//      inline ....... rename, typed values, color picker
//      toolbar ...... breadcrumb, tool buttons, status line
//      library ...... the #lib-body node list (search, groups, drag); it
//                     stands down when panels.js owns #lib-body
//      api .......... __studio.editor (touch, addNodeAt, screenToGraph,
//                     panBy, shortcuts, focusNode, stress)
//      selftest ..... __studio.editor.selfTest
//      dom .......... #graph-wrap markup, event binding, resize
//
//  GREP TARGETS (this file)
//      export { CATEGORY_COLORS } / export { SHORTCUTS, api }
//      init ......... store subscriptions and ctx.register('editor', api)
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
import { on } from './store.js';
import { loadPrefs } from './editor/state.js';
import { fitAll, takeSkipFit } from './editor/view.js';
import { pruneSel, syncSel } from './editor/selection.js';
import { clearDrag } from './editor/pointer.js';
import { dirty } from './editor/render.js';
import { staleThumbs, onBakeDone, onBakeError, onBakeThumb } from './editor/thumbs.js';
import { renderCrumbs } from './editor/toolbar.js';
import { buildLibrary } from './editor/library.js';
import { buildDom } from './editor/dom.js';
import { api } from './editor/api.js';

export { CATEGORY_COLORS } from './editor/state.js';
export { SHORTCUTS, api } from './editor/api.js';

/** @param {object} ctx main.js module context */
export async function init(ctx) {
  loadPrefs();
  buildDom();
  buildLibrary();
  on('graph:changed', p => {
    const r = p?.reason;
    if (r === 'undo' || r === 'redo' || r === 'load' || r === 'boot') {
      clearDrag();
      pruneSel();
      // selfTest loads its saved graph back without a fit
      if (!takeSkipFit() && (r === 'load' || r === 'boot')) requestAnimationFrame(() => fitAll());
      staleThumbs();
    } else pruneSel();
    renderCrumbs();
    dirty();
  });
  on('graph:layout', () => { renderCrumbs(); dirty(); });
  on('graph:select', ({ ids }) => { syncSel(ids); renderCrumbs(); });
  on('bake:done', onBakeDone);
  on('bake:error', onBakeError);
  on('bake:thumb', onBakeThumb);
  ctx.register('editor', api);
}

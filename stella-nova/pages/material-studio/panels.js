// ============================================================================
//  MATERIAL STUDIO  ·  panels.js — inspector, library, maps strip, light,
//                                   export, topbar and the shortcut sheet
// ────────────────────────────────────────────────────────────────────────────
//  Owner: PANELS agent. This module fills the static regions of index.html
//  that belong to no other module:
//      #inspector ....... params of the selected nodes, or Material settings
//      #lib-body ........ the node library: search, favorites, recent, tree
//      #maps-strip ...... one live thumbnail per baked map channel
//      #env-panel ....... HDRI presets, rotation, intensity, lights, view
//      #export-panel .... target cards and options; calls export.js
//      #tb-file / #tb-right  project name, File menu, bake meter, Export, ?
//
//  DATA FLOW
//      read:   state.graph, state.registry, state.selection, state.maps,
//              state.env, state.view, state.settings, state.compiled
//      write:  node params through the graph module (setParam if it exists,
//              else node.params), then emit graph:changed {reason:'param'}
//              and store.checkpoint(label, {merge}) once per frame.
//              One drag gesture is one merge key, so it is one undo step.
//      events: graph:select / graph:changed -> inspector
//              bake:done -> maps strip, bake meter, material stats
//              env:changed / view:changed -> env panel, strip solo marker
//
//  MODULE TREE  (panels.js is the entry: api and init; one concern per file)
//      panels/ctx.js ............. bind(c): ctx, store, state, M, $
//      panels/util.js ............ numbers, strings, localStorage
//      panels/color.js ........... sRGB hex, linear, HSV
//      panels/dom.js ............. h(), icons, file pick, download
//      panels/graph-access.js .... getNode, commitParam, editDone, loadGraph
//      panels/widgets/ ........... index.js (makeWidget), number, slider,
//                                  picker, color, basic, gradient, curve, image
//      panels/rows.js ............ paramRow, section, envRow, kv
//      panels/inspector.js ....... renderInspector, nodeView
//      panels/material-view.js ... materialView, statsLine, loadPreset
//      panels/library.js ......... addNodeAt, renderLibrary, fuzzy, drag
//      panels/maps-strip.js ...... TILES, renderTiles, updateStrip, lightbox
//      panels/env-panel.js ....... renderEnv, viewSection, lightRow
//      panels/export-panel.js .... renderExport, runExport
//      panels/topbar/ ............ topbar.js, file-menu.js, bake-meter.js
//      panels/shortcuts.js ....... SHORTCUTS, toggleShortcuts, onKey
//      panels/panels.test.mjs .... node test of the pure helpers
//      Each file opens with a header that lists its grep targets.
//
//  CONTRACT ADDITIONS  (fields this module adds; see the report)
//      GraphNode.exposed  string[] of param ids shown on the Material view
//      light.az / light.el  degrees, kept beside light.dir for the editor;
//                           dir is the unit vector from the surface to the light
//      optional hooks it calls when they exist:
//        graph.getNode / graph.setParam / graph.addNode / graph.removeNode
//        editor.addNodeAt(type, clientX, clientY) | editor.screenToGraph(x, y)
//        editor.shortcuts [{keys, label}] (listed in the ? overlay)
//        env.ENV_PRESETS | env.PRESETS [{id,label,thumb?}], env.setPreset, env.loadHDR
//        export.exportPackage(target, opts), export.FORMATS
//        import.importMaps(files), import.imageToPBR(file)
//        bench.importBenchGraph(json), mobile.setSheet(name)
//      optional event it reads: 'bake:progress' {done, total}
// ============================================================================
import { ctx, store, state, $, bind } from './panels/ctx.js';
import { graph, getNode, selfEmit, loadGraph } from './panels/graph-access.js';
import { wSlider } from './panels/widgets/slider.js';
import { wGradient } from './panels/widgets/gradient.js';
import { WIDGETS, makeWidget } from './panels/widgets/index.js';
import { insRows, renderInspector, refreshInspector } from './panels/inspector.js';
import { statsLine } from './panels/material-view.js';
import {
  addNodeAt, lib, buildLibrary, fuzzy, renderLibrary, initLibrary,
} from './panels/library.js';
import {
  TILES, thumbs, initThumbPipeline, initStrip, markSolo, updateStrip,
} from './panels/maps-strip.js';
import { envPresets, envSelf, renderEnv, renderEnvSoft, envDragging } from './panels/env-panel.js';
import { exp, renderExport } from './panels/export-panel.js';
import { meter, meterStart, meterDone } from './panels/topbar/bake-meter.js';
import { initTopbar, openExport } from './panels/topbar/topbar.js';
import { toggleShortcuts, onKey } from './panels/shortcuts.js';

// ------------------------------------------------------------ init / api
export const api = {
  renderInspector, renderLibrary, renderEnv, renderExport, updateStrip, addNodeAt, loadGraph,
  toggleShortcuts, openExport,
  get thumbs() { return { ready: !!thumbs.pipe, rendered: thumbs.n, err: thumbs.err }; },
  async selfTest() {
    const r = {
      inspector: !!$('inspector')?.children.length,
      libEntries: lib.entries.length,
      libRows: lib.listEl ? lib.listEl.querySelectorAll('.pn-li').length : 0,
      tiles: thumbs.tiles.size, thumbPipe: !!thumbs.pipe, thumbsRendered: thumbs.n, thumbErr: thumbs.err,
      envPresets: envPresets().length,
      exportTargets: document.querySelectorAll('#export-panel .ex-card').length,
    };
    // widget round trip, detached from the document
    const got = [];
    const s = wSlider({ id: 't', label: 't', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5 }, 0.5, v => got.push(v));
    s.set(0.25);
    const g = wGradient({ id: 'g', label: 'g', kind: 'gradient', default: [{ t: 0, color: '#000000' }, { t: 1, color: '#ffffff' }] }, null, v => got.push(v));
    void g;
    r.widgets = Object.keys(WIDGETS).every(k => { try { return !!makeWidget({ id: 'x', label: 'x', kind: k, default: k === 'color' ? '#808080' : k === 'vec2' ? [0, 0] : k === 'bool' ? false : k === 'enum' ? 'a' : 0, options: ['a', 'b'] }, undefined, () => {}).el; } catch (e) { return false; } });
    r.fuzzy = fuzzy('prln', 'perlin noise') > 0 && fuzzy('zz', 'perlin') < 0;
    r.ok = r.inspector && r.tiles === TILES.length && r.widgets && r.fuzzy && r.libEntries > 0;
    return r;
  },
};

/** @param {object} c main.js module context */
export async function init(c) {
  bind(c);
  initTopbar();
  initLibrary();
  initStrip();
  renderInspector(); renderEnv(); renderExport();
  try { await initThumbPipeline(); } catch (e) { thumbs.err = String(e.message || e); console.warn('[panels] thumbnail pipeline', e); }

  store.on('graph:select', () => renderInspector());
  store.on('graph:changed', ev => {
    const r = ev && ev.reason;
    if (r === 'boot' || r === 'load') { buildLibrary(); renderLibrary(); const nm = $('pn-projname'); if (nm) nm.value = graph()?.name || ''; }
    if (r === 'undo' || r === 'redo') { const nm = $('pn-projname'); if (nm) nm.value = graph()?.name || ''; }
    if (selfEmit) { const st = $('pn-stats'); if (st) st.replaceChildren(...statsLine().filter(Boolean)); return; }
    const alive = (state.selection || []).filter(id => getNode(id));
    if (alive.length !== (state.selection || []).length) { store.select(alive); return; }
    if (r === 'param' && insRows.length) refreshInspector(); else renderInspector(true);
  });
  store.on('bake:start', meterStart);
  store.on('bake:progress', ({ done, total } = {}) => { if (meter.bar && total) meter.bar.firstChild.style.width = (100 * done / total).toFixed(0) + '%'; });
  store.on('bake:done', maps => {
    meterDone(maps);
    updateStrip();
    const st = $('pn-stats'); if (st) st.replaceChildren(...statsLine().filter(Boolean));
    const es = $('pn-ex-status'); if (es && !exp.busy && !exp.last) es.textContent = `Maps ready: ${maps.res}²`;
  });
  store.on('bake:error', () => { meter.bar?.classList.remove('busy'); meter.bar?.classList.add('err'); });
  store.on('view:changed', () => { markSolo(); if (!envSelf && !envDragging()) renderEnvSoft(); });
  store.on('env:changed', () => { if (!envSelf && !envDragging()) renderEnvSoft(); });
  store.on('res:changed', ({ res }) => { const g = graph(); if (g?.settings) g.settings.res = res; if (!state.selection.length) renderInspector(true); renderExport(); });
  store.on('boot:done', () => { buildLibrary(); renderLibrary(); renderInspector(true); renderExport(); renderEnv(); });
  window.addEventListener('keydown', onKey);
  ctx.register('panels', api);
}

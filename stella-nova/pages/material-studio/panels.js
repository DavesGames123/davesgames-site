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
//  SECTIONS  (grep -n the banner to jump)
//      util ............. h(), icons, numbers, colors, localStorage
//      graph access ..... getNode, defOf, commitParam, addNodeAt, loadGraph
//      widgets .......... wSlider wColor (picker) wEnum wBool wVec2
//                         wGradient wCurve wImage wText, makeWidget
//      param rows ....... paramRow (reset + expose buttons)
//      inspector ........ renderInspector, nodeView, materialView
//      library .......... buildLibrary, renderLibrary, fuzzy, drag
//      maps strip ....... TILES, thumbnail pipeline, renderTiles, lightbox
//      env panel ........ renderEnv, light editor, view controls
//      export panel ..... renderExport, runExport
//      topbar ........... file menu, project name, bake meter
//      shortcuts ........ SHORTCUTS, overlay, key handler
//      init / api ....... init(ctx), __studio.panels, selfTest
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
import { emptyGraph } from './contract.js';
import { ctx, store, state, M, $, bind } from './panels/ctx.js';
import { lsGet, lsSet, clamp, slug } from './panels/util.js';
import { h, icon, ibtn, download, pickFiles, typing, isPhone } from './panels/dom.js';
import { graph, getNode, selfEmit, loadGraph, serializeGraph } from './panels/graph-access.js';
import { wSlider } from './panels/widgets/slider.js';
import { wGradient } from './panels/widgets/gradient.js';
import { WIDGETS, makeWidget } from './panels/widgets/index.js';
import { insRows, renderInspector, refreshInspector } from './panels/inspector.js';
import { statsLine, ballCss, loadPreset, setName } from './panels/material-view.js';
import {
  addNodeAt, lib, buildLibrary, fuzzy, renderLibrary, initLibrary,
} from './panels/library.js';
import {
  TILES, thumbs, initThumbPipeline, initStrip, markSolo, updateStrip,
} from './panels/maps-strip.js';
import { envPresets, envSelf, renderEnv, renderEnvSoft, envDragging } from './panels/env-panel.js';
import { exp, renderExport } from './panels/export-panel.js';

// ------------------------------------------------------------ topbar
const meter = { t0: 0, hist: lsGet('bakeHist', []) };
function initTopbar() {
  const file = $('tb-file'), right = $('tb-right');
  // project name + File menu
  const nm = h('input', { id: 'pn-projname', class: 'tb-name', type: 'text', spellcheck: 'false', placeholder: 'Untitled material', 'aria-label': 'Project name', value: graph()?.name || '' });
  nm.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') nm.blur(); });
  nm.addEventListener('change', () => { setName(nm.value); if (!state.selection.length) renderInspector(true); });
  const fileBtn = h('button', { type: 'button', class: 'tb-btn', 'aria-haspopup': 'menu', title: 'File' }, 'File ▾');
  fileBtn.addEventListener('click', e => { e.stopPropagation(); toggleMenu(fileBtn, fileMenuItems()); });
  file?.prepend(nm, fileBtn);
  // bake meter + export + help
  const bar = h('i', { class: 'tb-prog' }, h('i'));
  const spark = h('canvas', { class: 'tb-spark', width: 120, height: 36, title: 'Bake time, last 24 bakes' });
  meter.bar = bar; meter.spark = spark;
  $('bake-status')?.after(bar, spark);
  // export.js puts Open / Save / Import / Export buttons in #tb-file; add an
  // Export button here only when it did not.
  const ioBar = !!file?.querySelector('.io-tb');
  const exportBtn = ioBar ? null : h('button', { type: 'button', class: 'tb-btn tb-pri', title: 'Export (Ctrl+E)', onclick: openExport }, icon('down'), 'Export');
  const helpBtn = h('button', { type: 'button', class: 'tb-btn', title: 'Keyboard shortcuts (?)', 'aria-label': 'Keyboard shortcuts', onclick: toggleShortcuts }, '?');
  right?.append(...[exportBtn, helpBtn].filter(Boolean));
  drawSpark();
  // undo/redo labels
  store.on('history:changed', ({ label, canUndo, canRedo }) => {
    const u = $('btn-undo'), r = $('btn-redo');
    if (u) u.title = canUndo ? `Undo ${label || ''} (Ctrl+Z)` : 'Nothing to undo';
    if (r) r.title = canRedo ? 'Redo (Ctrl+Shift+Z)' : 'Nothing to redo';
  });
}
function openExport() {
  if (isPhone() && M.mobile?.setSheet) M.mobile.setSheet('export');
  else { document.querySelector('#side-tabs button[data-tab="export"]')?.click(); }
}
function fileMenuItems() {
  const presets = M.presets?.MATERIAL_PRESETS || [];
  const io = window.__studio?.io || {};
  const imp = M.import || {};
  const items = [
    { label: 'New material', kbd: '', run: () => loadGraph(emptyGraph(), 'New material', { keepRes: true }) },
    { label: typeof imp.pickFiles === 'function' ? 'Open project, graph, maps or zip…' : 'Open graph JSON…', kbd: 'Ctrl+O', run: () => typeof imp.pickFiles === 'function' ? imp.pickFiles() : openGraphFile() },
    typeof io.saveProject === 'function' ? { label: 'Save project (.studio.json)', kbd: 'Ctrl+S', run: () => io.saveProject().catch(e => store.toast(String(e.message || e), 'error')) } : null,
    { label: 'Save graph JSON', kbd: typeof io.saveProject === 'function' ? '' : 'Ctrl+S', run: saveGraphFile },
    { label: 'Copy graph JSON', run: async () => { try { await navigator.clipboard.writeText(JSON.stringify(serializeGraph(), null, 1)); store.toast('Graph JSON copied', 'ok'); } catch (e) { store.toast('Clipboard is blocked', 'warn'); } } },
    { label: 'Paste graph JSON', run: async () => { try { const t = await navigator.clipboard.readText(); openGraphText(t, 'clipboard'); } catch (e) { store.toast('Clipboard is blocked', 'warn'); } } },
    { sep: true },
    { label: 'Import maps / images…', disabled: typeof M.import?.importMaps !== 'function', run: async () => {
      const files = await pickFiles('image/*', true); if (!files.length) return;
      try { const r = await M.import.importMaps(files); store.toast(`Imported ${r.added.length} map(s)${r.skipped.length ? `, skipped ${r.skipped.length}` : ''}`, r.added.length ? 'ok' : 'warn'); } catch (e) { store.toast('Import failed: ' + (e.message || e), 'error'); }
    } },
    { label: 'Import Composition Bench graph…', disabled: typeof M.bench?.importBenchGraph !== 'function', run: async () => {
      const [f] = await pickFiles('.json,application/json'); if (!f) return;
      try { const g = M.bench.importBenchGraph(JSON.parse(await f.text())); loadGraph(g, 'Import bench graph', { keepRes: true }); } catch (e) { store.toast('Bench import failed: ' + (e.message || e), 'error'); }
    } },
    { label: 'Open in Composition Bench', disabled: typeof M.bench?.openInBench !== 'function', run: () => {
      try { M.bench.openInBench(serializeGraph()); } catch (e) { store.toast('Bench hand-off failed: ' + (e.message || e), 'error'); }
    } },
    { label: 'Image to PBR (server)…', disabled: typeof (imp.imageToPBR || io.imageToPBR) !== 'function', run: async () => {
      const [f] = await pickFiles('image/*'); if (!f) return;
      try { await (imp.imageToPBR || io.imageToPBR)(f); } catch (e) { store.toast('Image to PBR failed: ' + (e.message || e), 'error'); }
    } },
    { sep: true },
    { label: 'Export…', kbd: 'Ctrl+E', run: openExport },
  ];
  if (presets.length) {
    items.push({ sep: true }, { head: 'Starter materials' });
    for (const pr of presets) items.push({ label: pr.label, ball: pr.swatch, run: () => loadPreset(pr) });
  }
  return items.filter(Boolean);
}
let menuEl = null;
function toggleMenu(anchor, items) {
  if (menuEl) { const was = menuEl._anchor === anchor; closeMenu(); if (was) return; }
  menuEl = h('div', { class: 'pn-menu', role: 'menu' }, items.map(it => it.sep ? h('hr') : it.head ? h('div', { class: 'pn-menu-h' }, it.head)
    : h('button', { type: 'button', role: 'menuitem', disabled: !!it.disabled, onclick: () => { closeMenu(); it.run(); } },
      it.ball ? h('i', { class: 'pn-ball sm', style: { background: ballCss(it.ball) } }) : null, h('span', null, it.label), it.kbd ? h('kbd', null, it.kbd) : null)));
  menuEl._anchor = anchor;
  document.body.appendChild(menuEl);
  const r = anchor.getBoundingClientRect();
  menuEl.style.left = clamp(r.left, 6, window.innerWidth - menuEl.offsetWidth - 6) + 'px';
  menuEl.style.top = (r.bottom + 4) + 'px';
  menuEl.style.maxHeight = (window.innerHeight - r.bottom - 16) + 'px';
  menuEl.querySelector('button:not(:disabled)')?.focus();
}
function closeMenu() { menuEl?.remove(); menuEl = null; }
document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target) && !menuEl._anchor.contains(e.target)) closeMenu(); });
async function openGraphFile() {
  const [f] = await pickFiles('.json,application/json'); if (!f) return;
  openGraphText(await f.text(), f.name);
}
function openGraphText(text, src) {
  let j; try { j = JSON.parse(text); } catch (e) { store.toast(`${src} is not JSON`, 'error'); return; }
  if (j && j.version === 1 && Array.isArray(j.nodes) && j.output) { if (loadGraph(j, 'Open ' + src)) store.toast(`Opened ${src}`, 'ok'); return; }
  if (typeof M.bench?.importBenchGraph === 'function') {
    try { const g = M.bench.importBenchGraph(j); if (loadGraph(g, 'Import bench graph', { keepRes: true })) store.toast(`Imported Composition Bench graph from ${src}`, 'ok'); return; }
    catch (e) { store.toast(`${src}: not a material graph, and the bench import failed: ${e.message}`, 'error'); return; }
  }
  store.toast(`${src} is not a material graph (version 1)`, 'error');
}
function saveGraphFile() {
  const j = serializeGraph();
  const blob = new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' });
  download(blob, `${slug(j.name || 'material')}.material.json`);
}
function meterStart() {
  meter.t0 = performance.now();
  meter.bar?.classList.add('busy'); meter.bar?.classList.remove('err');
  if (meter.bar) meter.bar.firstChild.style.width = '0%';
}
function meterDone(maps) {
  const ms = maps && maps.ms != null ? maps.ms : performance.now() - meter.t0;
  meter.bar?.classList.remove('busy');
  if (meter.bar) meter.bar.firstChild.style.width = '100%';
  meter.hist.push(+ms.toFixed(1)); meter.hist = meter.hist.slice(-24); lsSet('bakeHist', meter.hist);
  const st = $('bake-status');
  if (st) {
    const a = meter.hist, avg = a.reduce((x, y) => x + y, 0) / a.length;
    st.title = `last ${ms.toFixed(1)} ms · avg ${avg.toFixed(1)} · min ${Math.min(...a).toFixed(1)} · max ${Math.max(...a).toFixed(1)} (${a.length} bakes)`;
  }
  drawSpark();
}
function drawSpark() {
  const cv = meter.spark; if (!cv) return;
  const c = cv.getContext('2d'), a = meter.hist, W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  if (!a.length) return;
  const mx = Math.max(16, ...a);
  const bw = W / 24;
  a.forEach((v, i) => {
    const hh = Math.max(2, (v / mx) * (H - 2));
    c.fillStyle = v > 250 ? '#ff9a4a' : v > 60 ? '#ffc832' : '#64c864';
    c.globalAlpha = i === a.length - 1 ? 1 : 0.55;
    c.fillRect(W - (a.length - i) * bw + 1, H - hh, bw - 2, hh);
  });
  c.globalAlpha = 1;
}

// ------------------------------------------------------------ shortcuts
const SHORTCUTS = [
  ['General', [['?', 'Show or hide this sheet'], ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z / Ctrl+Y', 'Redo'], ['Ctrl+S', 'Save graph JSON'], ['Ctrl+O', 'Open graph JSON'], ['Ctrl+E', 'Export panel'], ['Esc', 'Close a menu, picker or sheet']]],
  ['Library', [['/', 'Search nodes'], ['↑ ↓', 'Move in the list'], ['Enter', 'Add the node'], ['Double-click', 'Add the node'], ['Drag', 'Drop the node on the graph']]],
  ['Viewport', [['Alt+1 … Alt+9', 'Solo a map in the viewport'], ['Alt+0', 'Lit view'], ['Click a map tile', 'Solo it; click again for lit'], ['Double-click a map', 'Enlarge it with a texel readout']]],
  ['Params', [['Drag a number', 'Scrub (Shift fine, Alt coarse)'], ['↑ ↓ in a number', 'Step (Shift ×10)'], ['Type 0.5*2', 'Simple arithmetic'], ['Shift+drag a bar', 'Fine adjust'], ['Gradient: drag a stop down', 'Delete the stop'], ['Curve: double-click', 'Delete a point']]],
];
let helpEl = null;
function toggleShortcuts() {
  if (helpEl) { helpEl.remove(); helpEl = null; return; }
  const groups = [...SHORTCUTS];
  const ed = M.editor?.shortcuts || window.__studio?.editor?.shortcuts;
  if (Array.isArray(ed) && ed.length) groups.splice(1, 0, ['Graph editor', ed.map(s => Array.isArray(s) ? s : [s.keys, s.label])]);
  helpEl = h('div', { class: 'pn-modal', role: 'dialog', 'aria-label': 'Keyboard shortcuts', onclick: e => { if (e.target === helpEl) toggleShortcuts(); } },
    h('div', { class: 'pn-modal-c keys' },
      h('div', { class: 'pn-modal-h' }, icon('key'), h('b', null, 'Keyboard shortcuts'), h('span', { class: 'pn-sp' }), ibtn('close', 'Close', toggleShortcuts)),
      h('div', { class: 'keys-g' }, groups.map(([t, list]) => h('div', { class: 'keys-c' }, h('h4', null, t), list.map(([k, d]) => h('div', { class: 'keys-r' }, h('kbd', null, k), h('span', null, d))))))));
  document.body.appendChild(helpEl);
}
function onKey(e) {
  if (e.defaultPrevented) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (k === 'Escape') { if (helpEl) { toggleShortcuts(); return; } if (menuEl) { closeMenu(); return; } }
  if (mod && !e.altKey && !window.__studio?.io) { // export.js owns these keys when it is loaded
    const kk = k.toLowerCase();
    if (kk === 's') { e.preventDefault(); saveGraphFile(); return; }
    if (kk === 'o') { e.preventDefault(); openGraphFile(); return; }
    if (kk === 'e') { e.preventDefault(); openExport(); return; }
  }
  if (typing(e.target)) return;
  if (k === '?' || (k === '/' && e.shiftKey)) { e.preventDefault(); toggleShortcuts(); return; }
  if (k === '/' && !mod) { e.preventDefault(); if (isPhone()) M.mobile?.setSheet?.('lib'); lib.searchEl?.focus(); lib.searchEl?.select(); return; }
  if (e.altKey && !mod && /^Digit\d$/.test(e.code)) {
    const d = +e.code.slice(5);
    const views = TILES.filter(t => t.view);
    e.preventDefault();
    if (d === 0) store.setView({ debug: 'lit' });
    else if (views[d - 1]) store.setView({ debug: views[d - 1].view });
  }
}

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

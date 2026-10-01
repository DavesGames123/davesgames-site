// ============================================================================
//  MATERIAL STUDIO  ·  panels/topbar/file-menu.js — the File menu and graph JSON open and save
// ────────────────────────────────────────────────────────────────────────────
//  fileMenuItems lists the menu for the current modules. toggleMenu
//  shows it under the anchor. A pointerdown outside closes it (the
//  listener goes on document when this module loads).
//
//  GREP TARGETS
//      fileMenuItems menuEl toggleMenu closeMenu openGraphFile openGraphText
//      saveGraphFile
// ============================================================================
import { emptyGraph } from '../../contract.js';
import { store, M } from '../ctx.js';
import { clamp, slug } from '../util.js';
import { h, download, pickFiles } from '../dom.js';
import { loadGraph, serializeGraph } from '../graph-access.js';
import { ballCss, loadPreset } from '../material-view.js';
import { openExport } from './topbar.js';

export function fileMenuItems() {
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
export let menuEl = null;
export function toggleMenu(anchor, items) {
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
export function closeMenu() { menuEl?.remove(); menuEl = null; }
document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target) && !menuEl._anchor.contains(e.target)) closeMenu(); });
export async function openGraphFile() {
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
export function saveGraphFile() {
  const j = serializeGraph();
  const blob = new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' });
  download(blob, `${slug(j.name || 'material')}.material.json`);
}

// ============================================================================
//  MATERIAL STUDIO  ·  panels/topbar/topbar.js — project name, File button, Export and ? buttons
// ────────────────────────────────────────────────────────────────────────────
//  initTopbar fills #tb-file and #tb-right and puts the bake meter after
//  #bake-status. It also keeps the undo and redo button titles current.
//
//  GREP TARGETS
//      initTopbar openExport
// ============================================================================
import { store, state, M, $ } from '../ctx.js';
import { h, icon, isPhone } from '../dom.js';
import { graph } from '../graph-access.js';
import { renderInspector } from '../inspector.js';
import { setName } from '../material-view.js';
import { meter, drawSpark } from './bake-meter.js';
import { fileMenuItems, toggleMenu } from './file-menu.js';
import { toggleShortcuts } from '../shortcuts.js';

export function initTopbar() {
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
export function openExport() {
  if (isPhone() && M.mobile?.setSheet) M.mobile.setSheet('export');
  else { document.querySelector('#side-tabs button[data-tab="export"]')?.click(); }
}

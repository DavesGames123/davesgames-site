// ============================================================================
//  MATERIAL STUDIO  ·  export/ui/place.js — where the export UI goes
// ────────────────────────────────────────────────────────────────────────────
//  placeUI runs on boot:done. When panels.js owns #export-panel, it mounts
//  the extra block, and a MutationObserver puts the block back after each
//  panels re-render. Else it mounts the full panel. topbar puts the Open,
//  Save, Import and Export buttons in an empty #tb-file. showExportTab
//  clicks the Export side tab.
//
//  GREP TARGETS
//      placeUI  topbar  showExportTab  MutationObserver  io-host
// ============================================================================
import * as IMP from '../../import.js';
import { C, UI, err } from '../ctx.js';
import { saveProject } from '../project.js';
import { h } from './dom.js';
import { mountExportUI, refresh } from './panel.js';
import { runExport } from './run.js';

function topbar() {
  const tb = C.$('tb-file');
  if (!tb) return;
  tb.append(h('span', { class: 'io-tb' },
    h('button', { type: 'button', class: 'tb-btn', title: 'Open a project, graph, maps or a zip (Ctrl+O)', onclick: () => IMP.pickFiles() }, 'Open'),
    h('button', { type: 'button', class: 'tb-btn', title: 'Save the project as .studio.json (Ctrl+S)', onclick: () => saveProject().catch(err) }, 'Save'),
    h('button', { type: 'button', class: 'tb-btn', title: 'Import texture maps as image nodes', onclick: () => IMP.pickFiles('image/*,.zip,.tga') }, 'Import'),
    h('button', { type: 'button', class: 'tb-btn', title: 'Export with the Export tab options (Ctrl+E)', onclick: () => { showExportTab(); runExport(); } }, 'Export')));
}
export function showExportTab() { C.$('side-tabs')?.querySelector('button[data-tab="export"]')?.click(); }

/**
 * Put the UI in place after every module ran init. panels.js may own
 * #export-panel (target cards) and #tb-file (File menu). Then this module
 * adds only the extra block, and a MutationObserver puts it back each time
 * panels re-renders the pane with replaceChildren.
 */
export function placeUI() {
  const host = C.$('export-panel');
  if (!host || UI.box) return;
  const panelsOwns = !!host.querySelector('.ex-cards') || typeof C.modules.panels?.api?.renderExport === 'function';
  host.classList.add('io-host');
  mountExportUI(host, { mode: panelsOwns ? 'extra' : 'full' });
  if (panelsOwns) {
    new MutationObserver(() => {
      if (!host.contains(UI.box)) host.append(UI.box);
      refresh();
    }).observe(host, { childList: true });
  }
  const tb = C.$('tb-file');
  if (tb && !tb.children.length) topbar();
}

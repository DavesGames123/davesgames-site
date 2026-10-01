// ============================================================================
//  MATERIAL STUDIO  ·  panels/shortcuts.js — the ? shortcut sheet and the panel keys
// ────────────────────────────────────────────────────────────────────────────
//  toggleShortcuts shows the sheet (with editor.shortcuts when the editor
//  gives them). onKey handles ?, /, Alt+digit map solo, Escape, and
//  Ctrl+S/O/E when export.js is not loaded.
//
//  GREP TARGETS
//      SHORTCUTS helpEl toggleShortcuts onKey
// ============================================================================
import { store, M } from './ctx.js';
import { h, icon, ibtn, typing, isPhone } from './dom.js';
import { lib } from './library.js';
import { TILES } from './maps-strip.js';
import { menuEl, closeMenu, openGraphFile, saveGraphFile } from './topbar/file-menu.js';
import { openExport } from './topbar/topbar.js';

const SHORTCUTS = [
  ['General', [['?', 'Show or hide this sheet'], ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z / Ctrl+Y', 'Redo'], ['Ctrl+S', 'Save graph JSON'], ['Ctrl+O', 'Open graph JSON'], ['Ctrl+E', 'Export panel'], ['Esc', 'Close a menu, picker or sheet']]],
  ['Library', [['/', 'Search nodes'], ['↑ ↓', 'Move in the list'], ['Enter', 'Add the node'], ['Double-click', 'Add the node'], ['Drag', 'Drop the node on the graph']]],
  ['Viewport', [['Alt+1 … Alt+9', 'Solo a map in the viewport'], ['Alt+0', 'Lit view'], ['Click a map tile', 'Solo it; click again for lit'], ['Double-click a map', 'Enlarge it with a texel readout']]],
  ['Params', [['Drag a number', 'Scrub (Shift fine, Alt coarse)'], ['↑ ↓ in a number', 'Step (Shift ×10)'], ['Type 0.5*2', 'Simple arithmetic'], ['Shift+drag a bar', 'Fine adjust'], ['Gradient: drag a stop down', 'Delete the stop'], ['Curve: double-click', 'Delete a point']]],
];
let helpEl = null;
export function toggleShortcuts() {
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
export function onKey(e) {
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

// ============================================================================
//  MATERIAL STUDIO  ·  editor/toolbar.js — breadcrumb, tool buttons, status
// ────────────────────────────────────────────────────────────────────────────
//  The bar above the canvas: a breadcrumb (material › frame › selection;
//  a click frames that part) and the tool buttons. Pref buttons toggle a
//  pref and keep their 'on' class. The status line under the canvas shows
//  the counts and the zoom on the left and the hover tip on the right.
//
//  GREP TARGETS
//      setStatusHover / renderStatusSoon / updateStatus ... status line
//      renderCrumbs ... rebuilt only when the labels change
//      TOOLS .......... [id, label, title, pref?]
//      buildTools ..... the buttons and their click handler
//      onTool ......... one tool button
//      togglePref ..... flip a pref, sync buttons, save, redraw
// ============================================================================
import * as G from '../graph.js';
import { state, toast } from '../store.js';
import { wrap, bar, crumbs, statusEl, view, prefs, savePrefs } from './state.js';
import { fitRect, fitAll, fitSelection, sizeOf, viewCenterG } from './view.js';
import { sel, selFrames, setSel } from './selection.js';
import { dirty } from './render.js';
import { openMenu, alignItems } from './menu.js';
import { openPalette } from './palette.js';
import { renameGraph } from './inline.js';
import { groupSel } from './keys.js';

let statusHover = '';
export function setStatusHover(t) { if (t !== statusHover) { statusHover = t; renderStatusSoon(); } }
let statusRaf = 0;
function renderStatusSoon() { if (!statusRaf) statusRaf = requestAnimationFrame(() => { statusRaf = 0; updateStatus(); }); }
let lastVisible = 0;
export function updateStatus(visible) {
  if (!statusEl || !state.graph) return;
  if (visible !== undefined) lastVisible = visible;
  const g = state.graph;
  const left = `${g.nodes.length} nodes · ${g.links.length} wires${sel.size ? ` · ${sel.size} sel` : ''} · ${Math.round(view.s * 100)}%`;
  const a = statusEl.firstChild, b = statusEl.lastChild;
  if (a.textContent !== left) a.textContent = left;
  if (b.textContent !== statusHover) b.textContent = statusHover;
}
export function renderCrumbs() {
  if (!crumbs || !state.graph) return;
  const g = state.graph;
  const parts = [{ label: g.name || 'Untitled material', run: fitAll, dbl: renameGraph, title: 'Frame all · double-click to rename' }];
  const ids = [...sel];
  if (ids.length) {
    const n = G.nodeById(g, ids[0]);
    const f = n && g.frames.find(fr => n.x >= fr.x && n.y >= fr.y && n.x < fr.x + fr.w && n.y < fr.y + fr.h);
    if (f) parts.push({ label: f.label || 'Frame', run: () => fitRect({ x: f.x, y: f.y, w: f.w, h: f.h }, 30), title: 'Frame this group' });
    parts.push({ label: ids.length > 1 ? `${ids.length} nodes` : (n?.label || G.getDef(n?.type)?.label || n?.type || ''), run: fitSelection, title: 'Frame the selection (F)' });
  } else if (selFrames.size === 1) {
    const f = g.frames.find(fr => selFrames.has(fr.id));
    if (f) parts.push({ label: f.label || 'Frame', run: () => fitRect({ x: f.x, y: f.y, w: f.w, h: f.h }, 30) });
  }
  const key = parts.map(p => p.label).join('\u0000');
  if (crumbs.dataset.key === key) return;
  crumbs.dataset.key = key;
  const frag = document.createDocumentFragment();
  parts.forEach((p, i) => {
    if (i) { const s = document.createElement('span'); s.className = 'ge-crumb-sep'; s.textContent = '›'; frag.appendChild(s); }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ge-crumb'; b.textContent = p.label; b.title = p.title || '';
    b.onclick = p.run; if (p.dbl) b.ondblclick = p.dbl;
    frag.appendChild(b);
  });
  crumbs.replaceChildren(frag);
}

const TOOLS = [
  ['add', 'Add', 'Add a node (Tab)'],
  ['fit', 'Fit', 'Frame the selection or all (F / Home)'],
  ['align', 'Align', 'Align and distribute the selection'],
  ['layout', 'Layout', 'Auto layout the selection or all (L)'],
  ['group', 'Frame', 'Put a frame around the selection (Ctrl+G)'],
  ['collapse', 'Fold', 'Collapse or expand the selection (H)'],
  ['dup', 'Dup', 'Duplicate the selection (Ctrl+D)'],
  ['del', 'Del', 'Delete the selection (Del)'],
  ['sep'],
  ['preview', 'Prev', 'Node previews (P)', 'preview'],
  ['minimap', 'Map', 'Minimap (M)', 'minimap'],
  ['snap', 'Snap', 'Snap to the grid', 'snap'],
  ['box', 'Box', 'Touch: one finger draws a selection box', 'boxMode'],
];
/** Fill the .ge-tools element with TOOLS and listen for clicks. */
export function buildTools(tools) {
  for (const [id, label, title, pref] of TOOLS) {
    if (id === 'sep') { const s = document.createElement('span'); s.className = 'ge-tsep'; tools.appendChild(s); continue; }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ge-tool'; b.dataset.tool = id; b.textContent = label; b.title = title;
    if (pref) { b.dataset.pref = pref; b.classList.toggle('on', !!prefs[pref]); }
    tools.appendChild(b);
  }
  tools.addEventListener('click', e => { const b = e.target.closest('button[data-tool]'); if (b) onTool(b.dataset.tool, b); });
}
function onTool(id, btn) {
  const ids = [...sel];
  const r = btn.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
  const bx = r.left - wr.left, by = r.bottom - wr.top + 2;
  switch (id) {
    case 'add': { const [gx, gy] = viewCenterG(); openPalette({ sx: bx, sy: by, gx, gy }); break; }
    case 'fit': if (ids.length) fitSelection(); else fitAll(); break;
    case 'align': openMenu(bx, by, alignItems(ids), ids.length < 2 ? 'Select 2+ nodes' : 'Align'); break;
    case 'layout': G.actions.autoLayout(ids.length > 1 ? ids : null, sizeOf); break;
    case 'group': if (ids.length) groupSel(); else toast('Select nodes to frame', 'info', 1400); break;
    case 'collapse': if (ids.length) { const any = ids.some(i => !G.nodeById(state.graph, i)?.collapsed); G.actions.setCollapsed(ids, any); } break;
    case 'dup': if (ids.length) { const n = G.actions.duplicate(ids); if (n) setSel(n); } break;
    case 'del': if (ids.length || selFrames.size) G.actions.remove(ids, { frames: [...selFrames] }); break;
    case 'preview': togglePref('preview'); break;
    case 'minimap': togglePref('minimap'); break;
    case 'snap': togglePref('snap'); break;
    case 'box': togglePref('boxMode'); break;
  }
}
export function togglePref(k) {
  prefs[k] = !prefs[k];
  for (const b of bar.querySelectorAll('button[data-pref]')) b.classList.toggle('on', !!prefs[b.dataset.pref]);
  dirty(); savePrefs();
}

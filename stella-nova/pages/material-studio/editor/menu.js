// ============================================================================
//  MATERIAL STUDIO  ·  editor/menu.js — context menu and enum menus
// ────────────────────────────────────────────────────────────────────────────
//  One DOM menu (.ge-menu) for all menus. openContext picks the items from
//  what is under the point: a node (the menu then acts on the selection),
//  a frame, or empty space (with wire items when a wire is near). The
//  arrow keys move the focus. Escape closes the menu.
//
//  GREP TARGETS
//      openMenu ....... items {label, key?, run?, disabled?, on?, sep?, swatches?}
//      closeMenu / onMenuKey
//      alignItems ..... align and distribute items (menu and toolbar)
//      openContext .... node, frame or graph menu at a screen point
//      openEnumMenu ... the options of an enum param
// ============================================================================
import { OUTPUT_TYPE } from '../contract.js';
import * as G from '../graph.js';
import { state } from '../store.js';
import { cv, menuEl, W, H, toG, CLIP_KEY, prefs } from './state.js';
import { sel, setSel, setSelFrames, selectConnected } from './selection.js';
import { hitNode, hitFrame, hitLink } from './hit.js';
import { fitAll, sizeOf } from './view.js';
import { setMouse } from './pointer.js';
import { addReroute } from './wire.js';
import { openPalette, closePalette } from './palette.js';
import { renameNode, renameFrame } from './inline.js';
import { copySel, pasteText } from './clipboard.js';
import { groupSel } from './keys.js';
import { togglePref } from './toolbar.js';

/** Show a menu. items: {label, key?, run?, disabled?, sep?, swatches?} */
export function openMenu(sx, sy, items, title) {
  closePalette();
  const frag = document.createDocumentFragment();
  if (title) { const h = document.createElement('div'); h.className = 'ge-menu-title'; h.textContent = title; frag.appendChild(h); }
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { const s = document.createElement('div'); s.className = 'ge-menu-sep'; frag.appendChild(s); continue; }
    if (it.swatches) {
      const row = document.createElement('div'); row.className = 'ge-menu-sw';
      for (const c of it.swatches) { const b = document.createElement('button'); b.type = 'button'; b.style.background = c; b.title = c; b.onclick = () => { closeMenu(); it.run(c); }; row.appendChild(b); }
      frag.appendChild(row); continue;
    }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ge-menu-it' + (it.on ? ' on' : '');
    b.disabled = !!it.disabled;
    b.innerHTML = '<span></span><kbd></kbd>';
    b.firstChild.textContent = it.label;
    b.lastChild.textContent = it.key || '';
    b.onclick = () => { closeMenu(); it.run && it.run(); };
    frag.appendChild(b);
  }
  menuEl.replaceChildren(frag);
  menuEl.hidden = false;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.max(4, Math.min(W - r.width - 4, sx)) + 'px';
  menuEl.style.top = Math.max(4, Math.min(H - r.height - 4, sy)) + 'px';
  menuEl.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
export function closeMenu() { if (menuEl && !menuEl.hidden) { menuEl.hidden = true; menuEl.replaceChildren(); } }
export function onMenuKey(e) {
  const bs = [...menuEl.querySelectorAll('button:not(:disabled)')];
  const i = bs.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length]?.focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length]?.focus(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); cv.focus(); }
  e.stopPropagation();
}

export function alignItems(ids) {
  const A = (mode, label) => ({ label, run: () => G.actions.align(ids, mode, sizeOf), disabled: ids.length < 2 });
  return [A('left', 'Align left'), A('centerX', 'Align center'), A('right', 'Align right'), A('top', 'Align top'), A('centerY', 'Align middle'),
    A('bottom', 'Align bottom'), A('distributeX', 'Distribute horizontally'), A('distributeY', 'Distribute vertically'), A('stackY', 'Stack in a column')];
}
export function openContext(sx, sy) {
  const g = state.graph; if (!g) return;
  const [gx, gy] = toG(sx, sy);
  const hn = hitNode(gx, gy);
  if (hn) {
    const n = hn.node;
    if (!sel.has(n.id)) setSel([n.id]);
    const ids = [...sel];
    const isOut = n.type === OUTPUT_TYPE;
    openMenu(sx, sy, [
      { label: 'Rename', key: 'F2', run: () => renameNode(n) },
      { label: 'Duplicate', key: 'Ctrl+D', disabled: isOut && ids.length === 1, run: () => { const r = G.actions.duplicate(ids); if (r) setSel(r); } },
      { label: 'Duplicate with inputs', key: 'Ctrl+Shift+D', disabled: isOut && ids.length === 1, run: () => { const r = G.actions.duplicate(ids, 30, 30, true); if (r) setSel(r); } },
      { label: 'Copy', key: 'Ctrl+C', run: copySel },
      { sep: true },
      { label: n.collapsed ? 'Expand' : 'Collapse', key: 'H', run: () => G.actions.setCollapsed(ids, !n.collapsed) },
      { label: n.preview === false ? 'Show preview' : 'Hide preview', key: 'P', run: () => G.actions.setPreview(ids, n.preview === false) },
      { label: 'Disconnect all wires', run: () => G.actions.edit('Disconnect', gg => ids.reduce((s, id) => s + G.disconnectNode(gg, id), 0) || false, { nodeIds: ids }) },
      { label: 'Select upstream', run: () => selectConnected(n.id, 'up') },
      { label: 'Select downstream', run: () => selectConnected(n.id, 'down') },
      { sep: true },
      { label: 'Frame selection', key: 'Ctrl+G', run: groupSel },
      { label: 'Auto layout selection', key: 'L', disabled: ids.length < 2, run: () => G.actions.autoLayout(ids, sizeOf) },
      ...alignItems(ids),
      { sep: true },
      { label: 'Dissolve (keep wire)', key: 'Ctrl+Del', disabled: isOut && ids.length === 1, run: () => G.actions.dissolve(ids) },
      { label: 'Delete', key: 'Del', disabled: isOut && ids.length === 1, run: () => G.actions.remove(ids) },
    ], ids.length > 1 ? `${ids.length} nodes` : (n.label || hn.L.def?.label || n.type));
    return;
  }
  const hf = hitFrame(gx, gy);
  if (hf) {
    const f = hf.frame;
    openMenu(sx, sy, [
      { label: 'Rename frame', run: () => renameFrame(f) },
      { swatches: G.FRAME_COLORS, run: c => G.actions.setFrame(f.id, { color: c }, { label: 'Frame color' }) },
      { label: 'Fit to contents', run: () => G.actions.edit('Fit frame', gg => G.fitFrame(gg, f.id, null, sizeOf), { kind: 'layout' }) },
      { label: 'Select nodes inside', run: () => { setSelFrames(new Set([f.id])); setSel(G.frameNodes(g, f.id), { keepFrames: true }); } },
      { label: 'Auto layout inside', run: () => G.actions.autoLayout(G.frameNodes(g, f.id), sizeOf) },
      { sep: true },
      { label: 'Delete frame', run: () => G.actions.removeFrames([f.id]) },
      { label: 'Delete frame and nodes', run: () => G.actions.remove(G.frameNodes(g, f.id), { frames: [f.id], label: 'Delete frame and nodes' }) },
    ], f.label || 'Frame');
    return;
  }
  const l = hitLink(gx, gy, 7);
  openMenu(sx, sy, [
    { label: 'Add node…', key: 'Tab', run: () => openPalette({ sx, sy, gx, gy }) },
    l ? { label: 'Add reroute on wire', run: () => addReroute(l, gx, gy) } : null,
    l ? { label: 'Delete wire', run: () => G.actions.disconnect(l.to) } : null,
    { label: 'Paste', key: 'Ctrl+V', run: () => { let j = null; try { j = localStorage.getItem(CLIP_KEY); } catch (e) {} setMouse({ sx, sy, inside: true }); pasteText(j); } },
    { label: 'Add frame', run: () => { const f = G.actions.addFrame({ x: gx, y: gy, w: 360, h: 240 }, 'Frame'); if (f) renameFrame(f); } },
    { sep: true },
    { label: 'Select all', key: 'Ctrl+A', run: () => setSel(g.nodes.map(n => n.id)) },
    { label: 'Frame all', key: 'Home', run: fitAll },
    { label: 'Auto layout all', key: 'L', run: () => G.actions.autoLayout(null, sizeOf) },
    { sep: true },
    { label: 'Show node previews', on: prefs.preview, run: () => togglePref('preview') },
    { label: 'Show minimap', key: 'M', on: prefs.minimap, run: () => togglePref('minimap') },
    { label: 'Snap to grid', on: prefs.snap, run: () => togglePref('snap') },
  ], 'Graph');
}

export function openEnumMenu(n, p, sx, sy) {
  const v = n.params[p.id] !== undefined ? n.params[p.id] : p.default;
  const opts = (p.options || []).map(o => typeof o === 'string' ? { value: o, label: o } : o);
  openMenu(sx, sy, opts.map(o => ({ label: o.label, on: o.value === v, run: () => G.actions.setParam(n.id, p.id, o.value, { merge: null }) })), p.label);
}

// ============================================================================
//  MATERIAL STUDIO  ·  editor/keys.js — keyboard shortcuts
// ────────────────────────────────────────────────────────────────────────────
//  One window keydown handler. It acts only when the editor is active: the
//  canvas or a child of #graph-wrap has focus, or the pointer is over the
//  canvas and no text field has focus. It does nothing while the palette is
//  open (the palette has its own keys). Ctrl+Z / Y stay with main.js. The
//  key list is in the KEYMAP of editor.js.
//
//  GREP TARGETS
//      editorActive ... true when the keys go to the editor
//      onKey .......... the shortcut switch
//      groupSel ....... Ctrl+G: frame the selection, then rename the frame
// ============================================================================
import * as G from '../graph.js';
import { state } from '../store.js';
import { cv, wrap, palEl, menuEl, W, H, toG, SNAP } from './state.js';
import { sel, selFrames, setSel, setSelFrames } from './selection.js';
import { drag, mouse, cancelDrag } from './pointer.js';
import { fitAll, fitSelection, sizeOf } from './view.js';
import { dirty } from './render.js';
import { closeMenu } from './menu.js';
import { openPalette } from './palette.js';
import { renameNode, renameFrame } from './inline.js';
import { copySel, pasteSoon } from './clipboard.js';
import { togglePref } from './toolbar.js';

export function editorActive() {
  const a = document.activeElement;
  if (a === cv) return true;
  if (a && a !== document.body && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return false;
  if (a && wrap.contains(a)) return true;
  return mouse.inside && (!a || a === document.body);
}
export function onKey(e) {
  if (!state.graph || !editorActive()) return;
  if (palEl && !palEl.hidden) return;
  const k = e.key, mod = e.ctrlKey || e.metaKey, lk = k.toLowerCase();
  const g = state.graph;
  const ids = [...sel];
  const handled = () => { e.preventDefault(); e.stopPropagation(); };
  if (k === 'Escape') { if (drag) cancelDrag(); else if (menuEl && !menuEl.hidden) closeMenu(); else setSel([]); return handled(); }
  if (mod && (lk === 'z' || lk === 'y')) return; // main.js
  if (k === 'Tab' || (k === ' ' && !mod) || (k === 'A' && e.shiftKey && !mod)) {
    handled();
    const [sx, sy] = mouse.inside ? [mouse.sx, mouse.sy] : [W / 2, H / 2];
    const [gx, gy] = toG(sx, sy);
    openPalette({ sx, sy, gx, gy }); return;
  }
  if ((k === 'Delete' || k === 'Backspace') && !e.altKey) {
    handled();
    if (mod) { if (ids.length) G.actions.dissolve(ids); return; }
    if (ids.length || selFrames.size) G.actions.remove(ids, { frames: [...selFrames] });
    return;
  }
  if (mod && lk === 'd') { handled(); if (ids.length) { const r = G.actions.duplicate(ids, 30, 30, e.shiftKey); if (r) setSel(r); } return; }
  if (mod && lk === 'c') { handled(); copySel(); return; }
  if (mod && lk === 'x') { handled(); if (copySel()) G.actions.remove(ids, { frames: [...selFrames], label: 'Cut' }); return; }
  if (mod && lk === 'v') { pasteSoon(); return; } // the paste event usually wins; this is the fallback
  if (mod && lk === 'a') { handled(); setSelFrames(new Set(g.frames.map(f => f.id))); setSel(g.nodes.map(n => n.id), { keepFrames: true }); return; }
  if (e.altKey && lk === 'a') { handled(); setSel([]); return; }
  if (mod && lk === 'i') { handled(); setSel(g.nodes.filter(n => !sel.has(n.id)).map(n => n.id)); return; }
  if (mod && lk === 'g') { handled(); groupSel(); return; }
  if (mod) return;
  if (k === 'F2') { handled(); const n = G.nodeById(g, ids[0]); if (n) renameNode(n); return; }
  if (lk === 'f') { handled(); if (e.shiftKey) fitAll(); else fitSelection(); return; }
  if (k === 'Home') { handled(); fitAll(); return; }
  if (lk === 'h') { handled(); if (ids.length) { const any = ids.some(id => !G.nodeById(g, id)?.collapsed); G.actions.setCollapsed(ids, any); } return; }
  if (lk === 'p') { handled(); if (ids.length) { const any = ids.some(id => G.nodeById(g, id)?.preview !== false); G.actions.setPreview(ids, !any); } else togglePref('preview'); return; }
  if (lk === 'l') { handled(); G.actions.autoLayout(ids.length > 1 ? ids : null, sizeOf); return; }
  if (lk === 'm') { handled(); togglePref('minimap'); return; }
  if (k.startsWith('Arrow') && ids.length) {
    handled();
    const st = e.shiftKey ? 100 : SNAP;
    const dx = k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0, dy = k === 'ArrowUp' ? -st : k === 'ArrowDown' ? st : 0;
    G.actions.move(ids, dx, dy, { merge: 'nudge:' + ids.join(','), label: 'Nudge' });
  }
}

export function groupSel() {
  if (!sel.size) return;
  const f = G.actions.frameNodes([...sel], sizeOf, 'Frame');
  if (f) { setSelFrames(new Set([f.id])); dirty(); renameFrame(f); }
}

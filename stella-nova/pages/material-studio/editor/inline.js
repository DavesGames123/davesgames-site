// ============================================================================
//  MATERIAL STUDIO  ·  editor/inline.js — inline text input and color picker
// ────────────────────────────────────────────────────────────────────────────
//  One text input (.ge-inline) floats over the canvas for a rename or a
//  typed value. Enter or blur commits, Escape cancels. A typed number can be
//  simple math ("0.5*2"). One hidden color input (.ge-color) edits a color
//  param: each input event sets the value without an undo step, and the
//  change event commits one undo step.
//
//  GREP TARGETS
//      inlineInput / commitInline / onInlineKey
//      renameNode / renameFrame / renameGraph
//      typeParam ........ typed slider, int or vec2 value
//      openColor ........ color picker for a color param
//      onColorInput / onColorChange
// ============================================================================
import * as G from '../graph.js';
import { state } from '../store.js';
import { cv, wrap, crumbs, inlineEl, colorEl, W, H, view, toS } from './state.js';
import { layout } from './layout.js';
import { dirty } from './render.js';
import { quant, hexOk, nextMerge } from './params.js';
import { renderCrumbs } from './toolbar.js';

let inlineCommit = null;
function inlineInput(sx, sy, w, value, onCommit, opts = {}) {
  commitInline();
  inlineEl.hidden = false;
  inlineEl.style.left = Math.max(2, Math.min(W - w - 2, sx)) + 'px';
  inlineEl.style.top = Math.max(2, Math.min(H - 24, sy)) + 'px';
  inlineEl.style.width = w + 'px';
  inlineEl.value = value;
  inlineEl.inputMode = opts.numeric ? 'decimal' : 'text';
  inlineCommit = onCommit;
  setTimeout(() => { inlineEl.focus(); inlineEl.select(); }, 0);
}
export function commitInline(cancel) {
  if (!inlineCommit) return;
  const fn = inlineCommit; inlineCommit = null;
  inlineEl.hidden = true;
  if (!cancel) fn(inlineEl.value);
  if (cv && document.activeElement === inlineEl) cv.focus({ preventScroll: true });
}
export function onInlineKey(e) { if (e.key === 'Enter') commitInline(); else if (e.key === 'Escape') commitInline(true); e.stopPropagation(); }

export function renameNode(n) {
  const L = layout(n);
  const [sx, sy] = toS(n.x + 16, n.y + 1);
  inlineInput(sx, sy, Math.max(120, (L.w - 20) * view.s), n.label || L.def?.label || n.type, v => {
    const def = L.def;
    G.actions.rename(n.id, v.trim() && v.trim() !== def?.label ? v.trim() : null);
  });
}
export function renameFrame(f) {
  const [sx, sy] = toS(f.x + 4, f.y + 1);
  inlineInput(sx, sy, Math.max(140, Math.min(320, (f.w - 10) * view.s)), f.label || 'Frame', v => G.actions.setFrame(f.id, { label: v.trim() || 'Frame' }, { label: 'Rename frame' }));
}
export function renameGraph() {
  const r = crumbs.firstChild?.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
  const g = state.graph;
  inlineInput(r ? r.left - wr.left : 8, r ? r.top - wr.top : 4, 200, g.name || 'Untitled material', v => {
    G.actions.edit('Rename material', gg => { gg.name = v.trim() || undefined; if (!gg.name) delete gg.name; return true; }, { kind: 'layout' });
    renderCrumbs();
  });
}
export function typeParam(hn) {
  const n = hn.node, p = hn.p, L = hn.L;
  const v = n.params[p.id] !== undefined ? n.params[p.id] : p.default;
  const [sx, sy] = toS(n.x + 8, n.y + hn.row.y + 1);
  const str = p.kind === 'vec2' ? (Array.isArray(v) ? v.join(', ') : '0, 0') : String(v);
  inlineInput(sx, sy, Math.max(90, (L.w - 16) * view.s), str, s => {
    let nv;
    if (p.kind === 'vec2') { const a = s.split(/[\s,;]+/).filter(Boolean).map(Number); if (a.length < 2 || a.some(x => !Number.isFinite(x))) return; nv = [quant(a[0], p), quant(a[1], p)]; }
    else {
      // allow simple math: "0.5*2"
      let x = Number(s);
      if (!Number.isFinite(x) && /^[\d\s.+\-*/()eE]+$/.test(s)) { try { x = Function(`"use strict";return (${s})`)(); } catch (e) { x = NaN; } }
      if (!Number.isFinite(x)) return;
      nv = quant(x, p);
    }
    G.actions.setParam(n.id, p.id, nv, { merge: null });
  }, { numeric: true });
}

let colorTarget = null;
export function openColor(n, p, sx, sy) {
  const v = n.params[p.id] !== undefined ? n.params[p.id] : p.default;
  colorTarget = { id: n.id, pid: p.id, label: p.label, merge: nextMerge(n, p), changed: false };
  colorEl.value = hexOk(v) ? v : '#808080';
  colorEl.style.left = Math.min(W - 30, sx) + 'px'; colorEl.style.top = Math.min(H - 30, sy) + 'px';
  try { colorEl.showPicker ? colorEl.showPicker() : colorEl.click(); } catch (e) { colorEl.click(); }
}
export function onColorInput() { if (colorTarget) { G.actions.setParam(colorTarget.id, colorTarget.pid, colorEl.value, { checkpoint: false }); colorTarget.changed = true; dirty(); } }
export function onColorChange() { if (colorTarget) { G.actions.setParam(colorTarget.id, colorTarget.pid, colorEl.value, { checkpoint: false }); G.actions.commit(`Set ${colorTarget.label}`, { merge: colorTarget.merge }); colorTarget = null; } }

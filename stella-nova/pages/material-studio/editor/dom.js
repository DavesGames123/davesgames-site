// ============================================================================
//  MATERIAL STUDIO  ·  editor/dom.js — build #graph-wrap and bind its events
// ────────────────────────────────────────────────────────────────────────────
//  Runs once from init(). It writes the editor DOM into #graph-wrap (bar,
//  canvas, status, palette, menu, inline input, color input), gives the
//  elements to state.js and binds every listener to its handler module. It
//  also keeps the canvas size in step with #graph-wrap (ResizeObserver).
//  The first real size fits the graph, because a phone sheet opens later.
//
//  GREP TARGETS
//      buildDom ....... markup, setDom, listeners
//      drop ........... a library row dropped on the canvas adds that node
//      resize ......... CSS size, devicePixelRatio (max 2), first fit
// ============================================================================
import * as G from '../graph.js';
import { setDom, setSize, setDpr, W, H, dpr, toG } from './state.js';
import { fitAll } from './view.js';
import { setSel } from './selection.js';
import { dirty } from './render.js';
import { evPos, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, onPointerEnter, onDblClick } from './pointer.js';
import { onWheel, onGesture } from './wheel.js';
import { onKey } from './keys.js';
import { onPaste } from './clipboard.js';
import { pal, fillPalette, markPal, choosePal, closePalette, onPalKey, addFromDef } from './palette.js';
import { closeMenu, onMenuKey } from './menu.js';
import { onInlineKey, commitInline, onColorInput, onColorChange } from './inline.js';
import { buildTools } from './toolbar.js';

export function buildDom() {
  const wrap = document.getElementById('graph-wrap');
  wrap.classList.add('ge');
  wrap.innerHTML = `
    <div class="ge-bar"><nav class="ge-crumbs" aria-label="Graph path"></nav><div class="ge-tools" role="toolbar" aria-label="Graph tools"></div></div>
    <canvas class="ge-cv" tabindex="0" aria-label="Node graph canvas. Tab adds a node."></canvas>
    <div class="ge-status"><span></span><span></span></div>
    <div class="ge-pal" hidden><div class="ge-pal-head"></div><input type="search" placeholder="Search nodes" spellcheck="false" aria-label="Search nodes"><div class="ge-pal-list" role="listbox"></div><div class="ge-pal-doc"></div></div>
    <div class="ge-menu" role="menu" hidden></div>
    <input class="ge-inline" hidden spellcheck="false">
    <input class="ge-color" type="color" tabindex="-1" aria-hidden="true">`;
  const cv = wrap.querySelector('.ge-cv');
  const palEl = wrap.querySelector('.ge-pal');
  const menuEl = wrap.querySelector('.ge-menu');
  const inlineEl = wrap.querySelector('.ge-inline');
  const colorEl = wrap.querySelector('.ge-color');
  setDom({
    wrap, cv, cx: cv.getContext('2d'), palEl, menuEl, inlineEl, colorEl,
    bar: wrap.querySelector('.ge-bar'), crumbs: wrap.querySelector('.ge-crumbs'), statusEl: wrap.querySelector('.ge-status'),
  });
  buildTools(wrap.querySelector('.ge-tools'));

  cv.addEventListener('pointerdown', onPointerDown);
  cv.addEventListener('pointermove', onPointerMove);
  cv.addEventListener('pointerup', onPointerUp);
  cv.addEventListener('pointercancel', onPointerCancel);
  cv.addEventListener('pointerleave', onPointerLeave);
  cv.addEventListener('pointerenter', onPointerEnter);
  cv.addEventListener('dblclick', onDblClick);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('gesturestart', onGesture); cv.addEventListener('gesturechange', onGesture);
  cv.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('application/x-material-node')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  cv.addEventListener('drop', e => {
    const type = e.dataTransfer.getData('application/x-material-node');
    if (!type) return;
    e.preventDefault();
    const [sx, sy] = evPos(e); const [gx, gy] = toG(sx, sy);
    const d = G.getDef(type); if (!d) return;
    // dropped on a wire: insert
    const id = addFromDef(d, gx - 20, gy - 10);
    if (id) setSel([id]);
  });
  palEl.querySelector('input').addEventListener('input', fillPalette);
  palEl.querySelector('input').addEventListener('keydown', onPalKey);
  palEl.querySelector('.ge-pal-list').addEventListener('pointerdown', e => { const it = e.target.closest('.ge-pal-it'); if (it) { e.preventDefault(); choosePal(+it.dataset.i); } });
  palEl.querySelector('.ge-pal-list').addEventListener('pointermove', e => { const it = e.target.closest('.ge-pal-it'); if (it && pal && pal.idx !== +it.dataset.i) { pal.idx = +it.dataset.i; markPal(); } });
  palEl.querySelector('input').addEventListener('blur', () => setTimeout(() => { if (pal && !palEl.contains(document.activeElement)) closePalette(); }, 120));
  menuEl.addEventListener('keydown', onMenuKey);
  inlineEl.addEventListener('keydown', onInlineKey);
  inlineEl.addEventListener('blur', () => commitInline());
  colorEl.addEventListener('input', onColorInput);
  colorEl.addEventListener('change', onColorChange);
  window.addEventListener('keydown', onKey);
  window.addEventListener('paste', onPaste);
  window.addEventListener('pointerdown', e => { if (menuEl && !menuEl.hidden && !menuEl.contains(e.target)) closeMenu(); }, true);

  const resize = () => {
    const r = wrap.getBoundingClientRect();
    const cr = cv.getBoundingClientRect();
    const nw = Math.max(0, Math.round(cr.width || r.width)), nh = Math.max(0, Math.round(cr.height || r.height));
    setDpr(Math.min(window.devicePixelRatio || 1, 2));
    if (nw === W && nh === H && cv.width === Math.round(nw * dpr)) return;
    const first = !W || !H;
    setSize(nw, nh);
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    // the first real size (a phone sheet opens later): fit the graph
    if (first && W && H) fitAll();
    dirty();
  };
  new ResizeObserver(resize).observe(wrap);
  window.addEventListener('resize', resize);
  resize();
}

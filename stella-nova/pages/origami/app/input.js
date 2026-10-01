// app/input.js -- the pointer gestures, the phone sheet grip, and the DOM listener wiring.
//
// One finger or the left button draws in the diagram and orbits the fold.
// The right or middle button, or space plus drag, pans. Two fingers pinch to
// zoom and pan. The wheel zooms. wire attaches every listener once at boot:
// the data-act click dispatch, the fraction sliders, the file input, the
// canvas pointer events, the keys and the resize observer.
//
// grep map:
//   ptrs / gesture / spaceDown -- the live pointers and the current gesture
//   onDown / onMove / onUp / onWheel -- pointer input  [app.rs on_press, on_release, on_move, on_scroll]
//   panBy / zoom2dAbout -- the pan and the fixed-point zoom
//   wireSheet           -- the phone sheet grip
//   wire                -- every DOM listener

import { snap } from '../view.js';
import { $, TOOLS, S, gpu } from './state.js';
import { stage, canvas, dpr, applyLayout, view2d, phys, paneAt, snapPx, resize } from './layout.js';
import { syncUI } from './readouts.js';
import { rebuild, pushUndo, eraseNear } from './edit.js';
import { updateHover } from './hover.js';
import { importFold } from './files.js';
import { apply, resetView, onKey } from './controls.js';

// ── pointer input (app.rs on_press, on_release, on_move, on_scroll) ─────────
const ptrs = new Map();   // pointerId -> { x, y }
let gesture = null;       // { kind: 'draw'|'orbit'|'pan'|'pinch', pane, ... }
let spaceDown = false;

function cssPoint(e) {
  const c = canvas.getBoundingClientRect();
  return [e.clientX - c.left, e.clientY - c.top];
}

function onDown(e) {
  if (!gpu) return;
  // The library has no scrim. A press on the canvas closes it and does no more.
  if (S.libraryOpen) { S.libraryOpen = false; syncUI(); return; }
  const p = cssPoint(e);
  const pane = paneAt(p);
  if (!pane) return;
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, p);
  S.cursor = p;
  if (ptrs.size === 2) {
    // A second finger: drop the one-finger action and start a pinch.
    const [a, b] = [...ptrs.values()];
    gesture = { kind: 'pinch', pane: gesture ? gesture.pane : pane, d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1,
      mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], zoom0: S.zoom2d, dist0: S.orbit.dist };
    S.drawing = null;
    return;
  }
  if (ptrs.size > 2) return;
  const panBtn = e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown);
  if (panBtn) { gesture = { kind: 'pan', pane, last: p }; return; }
  if (e.button !== 0) return;
  if (pane === '2d') {
    const v = view2d();
    S.drawing = snap(v.toWorld(phys(p)), S.pattern, S.gridN, v, snapPx());
    gesture = { kind: 'draw', pane };
  } else {
    gesture = { kind: 'orbit', pane, last: p };
  }
}

function onMove(e) {
  const p = cssPoint(e);
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
  S.cursor = p;
  if (gesture && gesture.kind === 'pinch' && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const s = d / gesture.d0;
    if (gesture.pane === '2d') zoom2dAbout(gesture.mid, (gesture.zoom0 * s) / S.zoom2d);
    else S.orbit.dist = Math.min(Math.max(gesture.dist0 / s, 0.7), 9.0);
    panBy(gesture.pane, mid[0] - gesture.mid[0], mid[1] - gesture.mid[1]);
    gesture.mid = mid;
    gesture.zoom0 = S.zoom2d / 1; gesture.d0 = d; gesture.dist0 = S.orbit.dist;
  } else if (gesture && gesture.kind === 'orbit') {
    // The native deltas are physical pixels at 2x; scale CSS px to match.
    const dx = (p[0] - gesture.last[0]) * 2, dy = (p[1] - gesture.last[1]) * 2;
    S.orbit.yaw += dx * 0.01;
    S.orbit.pitch = Math.min(Math.max(S.orbit.pitch + dy * 0.01, -1.45), 1.45);
    gesture.last = p;
  } else if (gesture && gesture.kind === 'pan') {
    panBy(gesture.pane, p[0] - gesture.last[0], p[1] - gesture.last[1]);
    gesture.last = p;
  }
  updateHover();
}

function onUp(e) {
  const p = cssPoint(e);
  const had = ptrs.delete(e.pointerId);
  if (!had) return;
  if (gesture && gesture.kind === 'pinch') {
    if (ptrs.size === 0) gesture = null;
    return;
  }
  if (gesture && gesture.kind === 'draw' && S.drawing && e.type === 'pointerup' && paneAt(p) === '2d') {
    const v = view2d();
    const end = snap(v.toWorld(phys(p)), S.pattern, S.gridN, v, snapPx());
    if (S.tool === 'erase') eraseNear(end);
    else if (Math.hypot(S.drawing[0] - end[0], S.drawing[1] - end[1]) > 1e-3) {
      pushUndo();
      S.pattern.addCrease(S.drawing, end, TOOLS[S.tool].kind);
      rebuild();
    }
    syncUI();
  }
  S.drawing = null;
  gesture = null;
  if (e.pointerType !== 'mouse') S.cursor = null;
  updateHover();
}

function panBy(pane, dx, dy) {
  if (pane === '2d') { S.pan2d[0] += dx; S.pan2d[1] += dy; }
  else { S.pan3d[0] += dx; S.pan3d[1] += dy; }
}

// Zoom the diagram by factor f about a CSS point, keeping that point fixed.
function zoom2dAbout(cssP, f) {
  const z = Math.min(Math.max(S.zoom2d * f, 0.4), 12);
  const v0 = view2d();
  const w = v0.toWorld(phys(cssP));
  S.zoom2d = z;
  const v1 = view2d();
  const q = v1.toPx(w);
  S.pan2d[0] += (cssP[0] * dpr - q[0]) / dpr;
  S.pan2d[1] += (cssP[1] * dpr - q[1]) / dpr;
}

function onWheel(e) {
  const p = cssPoint(e);
  const pane = paneAt(p);
  if (!pane) return;
  e.preventDefault();
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  const f = Math.exp(-dy * 0.0015);
  if (pane === '2d') zoom2dAbout(p, f);
  else S.orbit.dist = Math.min(Math.max(S.orbit.dist / f, 0.7), 9.0);
  updateHover();
}

// ── the phone sheet grip (as in wave-membrane) ──────────────────────────────
function wireSheet() {
  const grip = $('sheetGrip'), panel = $('panel');
  let y0 = null, moved = false;
  grip.addEventListener('pointerdown', (e) => { y0 = e.clientY; moved = false; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointermove', (e) => { if (y0 !== null && Math.abs(e.clientY - y0) > 8) moved = true; });
  grip.addEventListener('pointerup', (e) => {
    if (y0 === null) return;
    const dy = e.clientY - y0; y0 = null;
    if (!moved) panel.classList.toggle('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else { S.panelOpen = false; syncUI(); } }
    else if (dy < -40) panel.classList.add('full');
  });
}

// ── wiring ──────────────────────────────────────────────────────────────────
export function wire() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    apply(el.dataset.act, el);
  });
  document.querySelectorAll('input[data-act="fraction"]').forEach((el) => {
    el.addEventListener('input', () => { S.dragFraction = true; apply('fraction', el); });
    el.addEventListener('change', () => { S.dragFraction = false; });
    el.addEventListener('pointerup', () => { S.dragFraction = false; });
  });
  $('foldFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importFold(f);
    e.target.value = '';
  });
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', (e) => { if (!ptrs.size && e.pointerType === 'mouse') { S.cursor = null; updateHover(); } });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('dblclick', (e) => { const pane = paneAt(cssPoint(e)); if (pane) resetView(pane); });
  window.addEventListener('keydown', (e) => { if (e.key === ' ' && !(e.target && e.target.tagName === 'BUTTON')) spaceDown = true; onKey(e); });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });
  window.addEventListener('resize', () => { applyLayout(); resize(); });
  new ResizeObserver(() => { applyLayout(); resize(); }).observe(stage);
  wireSheet();
}

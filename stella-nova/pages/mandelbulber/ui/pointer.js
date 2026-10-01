// ui/pointer.js — Mandelbulber page: the mouse and touch camera input on the canvas.
//
// Mouse: drag orbits, right drag or Shift drag pans, the wheel dollies. Touch: one finger
// orbits, two fingers pinch (dolly) and drag (pan), a double tap runs Frame, and a long
// press opens the menu (Frame, Reset view, Fly). A touch orbit keeps turning after the
// release and slows down (inertia); any new input stops it. In fly mode a drag looks.
//
// grep: const pointers  const inertia  const two  const endPointer  function inertiaStep  function stopInertia
//       const ctxMenu  function openCtx  function hideCtx  function initPointer

import { $, canvas, clamp } from './dom.js';
import { touchSeen, noteTouch } from './state.js';
import { refreshAll, hideTip } from './controls.js';
import { camFromScene, camToScene, resetCamera, frameView, panBy, orbitBy, lookBy } from './camera.js';
import { flying, toggleFly } from './fly.js';
import { applyLayout } from './layout.js';

// Mouse: drag orbit, right or Shift drag pan, wheel dolly. Touch: one finger orbit, two
// fingers pinch (dolly) and drag (pan), double tap Frame, long press menu. A touch orbit
// keeps turning after release and slows down (inertia); any new input stops it.
const pointers = new Map();
let dragCam = null, gest = null, lastTap = null, lpTimer = 0;
export const inertia = { on: false, vx: 0, vy: 0, cam: null };

const two = () => { const [a, b] = [...pointers.values()]; return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: Math.hypot(a.x - b.x, a.y - b.y) }; };

export function initPointer() {
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !touchSeen) { noteTouch(); applyLayout(); }
    if (!e.target.closest?.('#ctx')) hideCtx();
    if (!e.target.closest?.('#tip, .ctl .k')) hideTip();
  }, true);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    stopInertia();
    canvas.setPointerCapture(e.pointerId);
    const now = performance.now();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: now, button: e.button, type: e.pointerType, hist: [{ x: e.clientX, y: e.clientY, t: now }] });
    canvas.classList.add('dragging');
    dragCam = camFromScene();
    if (pointers.size === 1) {
      gest = { multi: false, moved: false, lp: false };
      if (e.pointerType !== 'mouse') {
        lpTimer = setTimeout(() => {
          if (pointers.size === 1 && gest && !gest.moved) { gest.lp = true; openCtx(e.clientX, e.clientY); }
        }, 520);
      }
    } else if (gest) {
      clearTimeout(lpTimer);
      gest.multi = true; gest.moved = true;
      const t = two(); gest.mid = t.mid; gest.d = t.d;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || !dragCam || !gest) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const now = performance.now();
    p.hist.push({ x: p.x, y: p.y, t: now });
    if (p.hist.length > 8) p.hist.shift();
    if (!gest.moved && Math.hypot(p.x - p.x0, p.y - p.y0) > 8) { gest.moved = true; clearTimeout(lpTimer); }
    if (gest.lp) return;
    const c = dragCam;
    if (pointers.size >= 2) {                              // pinch = dolly, midpoint drag = pan
      const t = two();
      if (gest.d > 0 && t.d > 0) c.dist = clamp(c.dist * gest.d / t.d, 1e-6, 1e6);
      panBy(c, t.mid.x - gest.mid.x, t.mid.y - gest.mid.y);
      gest.mid = t.mid; gest.d = t.d;
    } else if (gest.multi) return;                         // one finger left after a pinch: wait
    else if (p.button === 2 || e.shiftKey) panBy(c, dx, dy);
    else if (flying) lookBy(c, dx * 0.004, dy * 0.004);
    else orbitBy(c, dx, dy);
    camToScene(c, true);
  });
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    stopInertia();
    const c = camFromScene();
    c.dist = clamp(c.dist * Math.exp(e.deltaY * 0.0015), 1e-6, 1e6);
    camToScene(c, true);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(refreshAll, 200);
  }, { passive: false });
  ctxMenu.addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    hideCtx();
    if (a === 'frame') frameView(false);
    else if (a === 'reset') resetCamera();
    else if (a === 'fly') toggleFly();
  });
}

const endPointer = (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  clearTimeout(lpTimer);
  const now = performance.now();
  const g = gest;
  if (e.type === 'pointerup' && p.type !== 'mouse' && g && !g.multi && !g.lp && !g.moved && now - p.t0 < 300) {
    if (lastTap && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) { lastTap = null; frameView(false); }
    else lastTap = { t: now, x: e.clientX, y: e.clientY };
  }
  if (pointers.size) return;
  if (e.type === 'pointerup' && p.type !== 'mouse' && !flying && g && g.moved && !g.multi && !g.lp && dragCam) {
    p.hist.push({ x: e.clientX, y: e.clientY, t: now });
    const h = p.hist.filter((q) => now - q.t < 90);
    if (h.length >= 2) {
      const a = h[0], b = h[h.length - 1], dt = Math.max(b.t - a.t, 8);
      const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;   // CSS px per ms
      if (Math.hypot(vx, vy) > 0.25) Object.assign(inertia, { on: true, vx, vy, cam: dragCam });
    }
  }
  canvas.classList.remove('dragging');
  dragCam = null; gest = null;
  if (!inertia.on) refreshAll();
};

let wheelTimer = 0;

export function inertiaStep(dt) {
  if (!inertia.on) return;
  orbitBy(inertia.cam, inertia.vx * 1000 * dt, inertia.vy * 1000 * dt);
  const k = Math.exp(-dt * 3.5);
  inertia.vx *= k; inertia.vy *= k;
  camToScene(inertia.cam, true);
  if (Math.hypot(inertia.vx, inertia.vy) < 0.02) stopInertia();
}

export function stopInertia() {
  if (!inertia.on) return;
  inertia.on = false; inertia.cam = null;
  refreshAll();
}

// Long-press menu on the canvas.
const ctxMenu = $('ctx');
function openCtx(x, y) {
  ctxMenu.querySelector('[data-a=fly]').textContent = flying ? 'Leave fly mode' : 'Fly mode';
  ctxMenu.hidden = false;
  const w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
  ctxMenu.style.left = `${clamp(x - w / 2, 8, innerWidth - w - 8)}px`;
  ctxMenu.style.top = `${clamp(y - h - 16, 8, innerHeight - h - 8)}px`;
  navigator.vibrate?.(8);
}

function hideCtx() { ctxMenu.hidden = true; }

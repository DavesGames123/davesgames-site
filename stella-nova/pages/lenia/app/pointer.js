// ============================================================================
//  LENIA  ·  app/pointer.js — tools, zoom and pan on the world canvas
// ----------------------------------------------------------------------------
//  Pointer events on #gl: stamp, draw and erase, the wheel zoom, the right
//  drag pan, and the two-finger pinch.
//
//  GREP MAP
//    grep -n 'function bindPointer'  bind the canvas pointer events
//    grep -n 'function brushAt'      one brush dab: draw or erase
//    grep -n 'function brushLine'    dabs along a drag
//    grep -n 'function stampAt'      stamp a turned copy
//    grep -n 'function zoomAt'       zoom about a point
//    grep -n ''pointerdown''         the start of a gesture
// ============================================================================
import { resample } from '../engine.js';
import { wrap } from './torus.js';
import { cellsOf, rotate } from './catalog.js';
import { $, PHONE_Q, S, det } from './state.js';
import { openBrowser } from './browser.js';
import { setOpen, setZoom } from './controls.js';
import { worldXY } from './world.js';

// Mouse: the left button uses the tool, the right button (or shift + left)
// pans, the wheel zooms at the cursor. Touch and pen: one finger uses the
// tool (stamp on a tap), two fingers zoom and pan.
export function bindPointer() {
  const cv = $('gl'), cursor = $('cursor');
  const ptrs = new Map();
  let mode = null, last = null, tap = null, pinch = null;

  function brushAt(p) {
    const R = S.engine.info.R, r = Math.max(1.5, S.brush * R);
    const n = Math.ceil(r) * 2 + 1, data = new Float32Array(n * n), c = (n - 1) / 2;
    // The draw noise is made at detail 1 and scaled up, as in soup().
    let noise = null;
    if (S.tool !== 'erase') {
      const k = Math.max(1, Math.ceil(n / det()));
      noise = resample({ w: k, h: k, data: new Float32Array(k * k).map(Math.random) }, n / k);
    }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - c, y - c) / r;
      if (d >= 1) continue;
      data[y * n + x] = S.tool === 'erase' ? Math.min(1, (1 - d) * 3) : noise.data[Math.min(y, noise.h - 1) * noise.w + Math.min(x, noise.w - 1)];
    }
    S.engine.stamp({ w: n, h: n, data }, p.x, p.y, S.tool === 'erase' ? 'erase' : 'set');
  }
  function brushLine(p) {
    const R = S.engine.info.R, step = Math.max(1, S.brush * R * 0.5);
    if (last) {
      const d = Math.hypot(p.x - last.x, p.y - last.y);
      const n = Math.min(32, Math.floor(d / step));
      for (let k = 1; k < n; k++) brushAt({ x: last.x + (p.x - last.x) * k / n, y: last.y + (p.y - last.y) * k / n });
    }
    brushAt(p);
    last = p;
  }
  function stampAt(p) {
    const patch = rotate(resample(cellsOf(S.c), S.rule.scale * det()), Math.floor(Math.random() * 4));
    S.engine.stamp(patch, p.x, p.y, 'set');
  }
  function pan(dxPx, dyPx) {
    const { W, H } = S.engine.info, v = S.engine.view, k = S.engine.cellPx();
    S.engine.setView({ cx: wrap(v.cx - dxPx / k, W), cy: wrap(v.cy - dyPx / k, H) });
  }
  // Zoom so that the world point under (clientX, clientY) stays under it.
  function zoomAt(clientX, clientY, z) {
    const before = worldXY(clientX, clientY);
    setZoom(z);
    const after = worldXY(clientX, clientY);
    const { W, H } = S.engine.info, v = S.engine.view;
    S.engine.setView({ cx: wrap(v.cx + before.x - after.x, W), cy: wrap(v.cy + before.y - after.y, H) });
  }
  const mid = () => { const a = [...ptrs.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) }; };

  cv.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { cv.setPointerCapture(e.pointerId); } catch (x) { /* none */ }
    e.preventDefault();
    if (ptrs.size === 2) { mode = 'pinch'; pinch = { ...mid(), zoom: S.view.zoom }; tap = null; return; }
    if (ptrs.size > 2) return;
    const p = worldXY(e.clientX, e.clientY);
    last = null;
    if (e.pointerType === 'mouse' && (e.button === 2 || e.button === 1 || e.shiftKey)) { mode = 'pan'; last = { x: e.clientX, y: e.clientY }; return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (S.tool === 'stamp') {
      if (e.pointerType === 'mouse') { stampAt(p); mode = null; }
      else { mode = 'tap'; tap = { x: e.clientX, y: e.clientY, t: performance.now() }; }
    } else { mode = 'brush'; brushLine(p); }
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') {
      const d = (S.tool === 'stamp' ? S.c.R * S.rule.scale * det() : Math.max(1.5, S.brush * S.engine.info.R)) * 2 * S.engine.cellPx();
      cursor.style.width = cursor.style.height = d + 'px';
      cursor.style.left = e.clientX + 'px'; cursor.style.top = e.clientY + 'px';
      cursor.classList.add('on');
    }
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pinch' && ptrs.size === 2) {
      const m = mid();
      pan(m.x - pinch.x, m.y - pinch.y);
      zoomAt(m.x, m.y, pinch.zoom * m.d / Math.max(1, pinch.d));
      pinch.x = m.x; pinch.y = m.y;
    } else if (mode === 'pan') {
      pan(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
    } else if (mode === 'brush') {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const c of (evs.length ? evs : [e])) brushLine(worldXY(c.clientX, c.clientY));
    }
  });
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') cursor.classList.remove('on'); });
  const end = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    try { cv.releasePointerCapture(e.pointerId); } catch (x) { /* none */ }
    if (e.type === 'pointerup' && mode === 'tap' && tap && performance.now() - tap.t < 400 &&
        Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 14) {
      if (PHONE_Q.matches && ($('panel').classList.contains('open') || $('browser').classList.contains('open'))) {
        setOpen(false); openBrowser(false);
      } else stampAt(worldXY(e.clientX, e.clientY));
    }
    if (ptrs.size === 0) { mode = null; last = null; tap = null; pinch = null; }
    else if (mode === 'pinch') mode = null;
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, S.view.zoom * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
}

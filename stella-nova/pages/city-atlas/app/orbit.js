// ============================================================================
//  ORBIT  ·  city-atlas/app/orbit.js — the orbit camera input on the map
// ----------------------------------------------------------------------------
//  ORBIT INPUT. One pointer orbits (mouse: left button; right or shift pans),
//  two pointers pinch to zoom and pan. The wheel zooms. A double-click eases
//  back to the default view. Every input stops the camera ease and marks
//  the input time (S.lastInput), so the slow auto-orbit waits.
//
//  grep -n targets
//    bind ................. "export function bindOrbit"
//    pan .................. "const pan"
//    pinch ................ "pts.size === 2"
//    wheel ................ "'wheel'"
// ============================================================================

import { S, cam, invalidate } from './state.js';
import { canvas, homeView } from './dom.js';
import { clamp } from './text.js';

export function bindOrbit() {
  const pts = new Map();
  let last = null;
  const note = () => { S.lastInput = performance.now(); S.camGoal = null; invalidate(2); };
  const pan = (dx, dy) => {
    const k = cam.dist / Math.max(window.innerHeight, 1) * 1.1;
    const s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
    // screen right = (-cos, sin) east/north, screen up (forward) = (-sin, -cos);
    // the target moves against the drag
    cam.target[0] += (c * dx - s * dy) * k;
    cam.target[1] += (-s * dx - c * dy) * k;
    const lim = (S.meta?.r || 2.5) * 1000 * 1.6;
    cam.target[0] = clamp(cam.target[0], -lim, lim);
    cam.target[1] = clamp(cam.target[1], -lim, lim);
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = null;
    note();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    note();
    if (pts.size === 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      if (e.buttons & 2 || e.shiftKey) pan(dx, dy);
      else {
        cam.yaw -= dx * 0.0055;
        cam.pitch = clamp(cam.pitch + dy * 0.004, 0.08, 1.45);
      }
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d = Math.hypot(a.x - b.x, a.y - b.y);
      if (last) {
        cam.dist = clamp(cam.dist * last.d / Math.max(d, 1), 350, 40000);
        pan(mid.x - last.mid.x, mid.y - last.mid.y);
      }
      last = { mid, d };
    }
  });
  const up = (e) => { pts.delete(e.pointerId); last = null; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    note();
    const k = Math.exp(clamp(e.deltaY, -200, 200) * (e.ctrlKey ? 0.01 : 0.0015));
    cam.dist = clamp(cam.dist * k, 350, 40000);
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { S.camGoal = homeView(S.meta); });
}

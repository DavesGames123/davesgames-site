// ============================================================================
//  ROCHE LIMIT  ·  app/pointer.js — drag, pinch and wheel on the canvas
// ----------------------------------------------------------------------------
//  A drag turns the view, a pinch or the wheel zooms, a double click
//  resets the view.
//
//  grep -n targets
//    pointer .... "function bindPointer"
// ============================================================================
import { SCENARIOS } from '../scenarios.js';
import { cam } from './camera.js';
import { $, UI } from './env.js';

// pointer: drag to orbit, pinch or wheel to zoom, double-click to reset
export function bindPointer() {
  const c = $('gpu'), pts = new Map();
  let pinch0 = 0, zoom0 = 1;
  c.addEventListener('pointerdown', e => { pts.set(e.pointerId, [e.clientX, e.clientY]); try { c.setPointerCapture(e.pointerId); } catch (x) {} if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = cam.zoom; } });
  c.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) {
      cam.az -= (e.clientX - prev[0]) * 0.006; cam.el = Math.max(-1.45, Math.min(1.45, cam.el + (e.clientY - prev[1]) * 0.006));
      cam.dragging = true;
    } else if (pts.size === 2 && pinch0 > 0) {
      const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      cam.zoom = Math.max(0.08, Math.min(8, zoom0 * pinch0 / d)); cam.dragging = true;
    }
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = 0; if (!pts.size) { cam.dragging = false; cam.userUntil = performance.now() + 250; } };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  c.addEventListener('wheel', e => { e.preventDefault(); cam.zoom = Math.max(0.08, Math.min(8, cam.zoom * Math.exp(e.deltaY * 0.0012))); cam.userUntil = performance.now() + 250; }, { passive: false });
  c.addEventListener('dblclick', () => { const sc = SCENARIOS.find(s => s.key === UI.scen); cam.zoom = 1; cam.az = 0.9; cam.el = sc.el ?? 0.42; cam.boostUntil = performance.now() + 3000; });
}

// ============================================================================
//  MATERIAL STUDIO  ·  editor/wheel.js — wheel and trackpad gestures
// ────────────────────────────────────────────────────────────────────────────
//  Ctrl/Cmd+wheel (a trackpad pinch in Chrome and Firefox) zooms. A mouse
//  wheel (line or page deltas, or large integer pixel steps) zooms. A
//  trackpad two-finger scroll pans. Shift+wheel pans across. Safari sends a
//  pinch as gesture events: these zoom when no Ctrl+wheel came in the last
//  200 ms.
//
//  GREP TARGETS
//      onWheel ..... zoom or pan from a wheel event
//      onGesture ... Safari gesturestart / gesturechange
// ============================================================================
import { view } from './state.js';
import { zoomAt } from './view.js';
import { dirty } from './render.js';
import { evPos } from './pointer.js';

let lastCtrlWheel = 0;
export function onWheel(e) {
  e.preventDefault();
  const [sx, sy] = evPos(e);
  if (e.ctrlKey || e.metaKey) { lastCtrlWheel = performance.now(); zoomAt(sx, sy, Math.exp(-e.deltaY * 0.01)); return; }
  const lines = e.deltaMode === 1, pages = e.deltaMode === 2;
  const mouseWheel = lines || pages || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
  if (mouseWheel && !e.shiftKey) { zoomAt(sx, sy, Math.exp(-(lines ? e.deltaY * 33 : pages ? e.deltaY * 400 : e.deltaY) * 0.0016)); return; }
  const k = lines ? 33 : pages ? 400 : 1;
  if (e.shiftKey && e.deltaX === 0) view.tx -= e.deltaY * k; else { view.tx -= e.deltaX * k; view.ty -= e.deltaY * k; }
  dirty();
}
// Safari trackpad pinch (gesture events) when no ctrl+wheel arrives
let gsScale = 1;
export function onGesture(e) {
  e.preventDefault();
  if (e.type === 'gesturestart') { gsScale = 1; return; }
  if (performance.now() - lastCtrlWheel < 200) return;
  const [sx, sy] = evPos(e);
  zoomAt(sx, sy, e.scale / gsScale); gsScale = e.scale;
}

// ============================================================================
//  ULAM SPIRAL  ·  app/input.js — wheel, pointer, pinch, tap and keys
// ----------------------------------------------------------------------------
//  2D: drag pans, wheel and pinch zoom at the cursor, double tap zooms in,
//  a tap selects the number under it, a mouse hover shows its readout.
//  3D: drag orbits, wheel and pinch change the distance. Keys: + - zoom,
//  arrows pan, h home, w walk. main.js calls installInput once at boot.
//
//  GREP MAP
//    grep -n 'export function zoomAt'        zoom at a screen point
//    grep -n 'export function userMoved'     stop flights and walk-follow
//    grep -n 'export function installInput'  the canvas and key listeners
// ============================================================================
import { S, rt } from './state.js';
import { cv } from './dom.js';
import { clamp, is3D, toWorld } from './camera.js';
import { view } from './view.js';
import { home3 } from './framing.js';
import { hoverAt, showReadout } from './readout.js';
import { goHome, toggleWalk } from './controls.js';

export function zoomAt(sx, sy, f) {
  const v = rt.VW || view();
  if (is3D(S.shape)) { const c = S.cam3 || (S.cam3 = home3(S.shape)); c.dist = clamp(c.dist / f, 3, 6000); S.dirty = true; return; }
  const [wx, wy] = toWorld(sx, sy, v);
  S.cam.z = clamp(S.cam.z * f, 0.002, 400);
  const [nx, ny] = toWorld(sx, sy, v);
  S.cam.x += wx - nx; S.cam.y += wy - ny;
  S.dirty = true;
}
export function userMoved() { S.fly = null; if (S.walk) S.walk.follow = false; }

export function installInput() {
  const ptrs = new Map();
  let pinch = null, dragMoved = false, lastTap = 0;
  cv.addEventListener('wheel', e => {
    e.preventDefault(); userMoved();
    const k = e.deltaMode === 1 ? 0.05 : 0.0018;
    zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * k));
  }, { passive: false });
  cv.addEventListener('pointerdown', e => {
    try { cv.setPointerCapture(e.pointerId); } catch (x) { /* a synthetic pointer */ }
    ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    dragMoved = false;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
  });
  cv.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') { const h = hoverAt(e.offsetX, e.offsetY); if (!h || !S.hover || h.n !== S.hover.n) { S.hover = h; showReadout(h); S.overlayDirty = true; } }
      return;
    }
    const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
    p.x = e.offsetX; p.y = e.offsetY;
    if (Math.abs(dx) + Math.abs(dy) > 0) { if (!dragMoved && Math.hypot(dx, dy) < 2) return; dragMoved = true; userMoved(); }
    if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      zoomAt(mx, my, d / pinch.d);
      if (!is3D(S.shape)) { S.cam.x -= (mx - pinch.mx) / S.cam.z; S.cam.y += (my - pinch.my) / S.cam.z; }
      pinch = { d, mx, my }; S.dirty = true; return;
    }
    if (ptrs.size !== 1) return;
    if (is3D(S.shape)) {
      const c = S.cam3 || (S.cam3 = home3(S.shape));
      c.yaw -= dx * 0.006; c.pitch = clamp(c.pitch + dy * 0.006, -1.45, 1.55);
    } else { S.cam.x -= dx / S.cam.z; S.cam.y += dy / S.cam.z; }
    S.dirty = true;
  });
  const endPtr = e => {
    const had = ptrs.has(e.pointerId);
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (had && !dragMoved && e.type === 'pointerup') {
      const now = performance.now();
      if (now - lastTap < 300) { userMoved(); zoomAt(e.offsetX, e.offsetY, 2.2); lastTap = 0; }
      else {
        lastTap = now;
        const h = hoverAt(e.offsetX, e.offsetY);
        S.sel = h && h.n >= 0 ? h : null; showReadout(S.sel); S.overlayDirty = true;
      }
    }
  };
  cv.addEventListener('pointerup', endPtr);
  cv.addEventListener('pointercancel', endPtr);
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !ptrs.size) { S.hover = null; showReadout(S.sel); S.overlayDirty = true; } });
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    const v = rt.VW || view();
    if (e.key === '+' || e.key === '=') zoomAt(v.cx, v.cy, 1.5);
    else if (e.key === '-' || e.key === '_') zoomAt(v.cx, v.cy, 1 / 1.5);
    else if (e.key === 'h' || e.key === 'H') goHome();
    else if (e.key === 'w' || e.key === 'W') toggleWalk();
    else if (e.key.startsWith('Arrow')) { const d = 80 / S.cam.z; if (e.key === 'ArrowLeft') S.cam.x -= d; if (e.key === 'ArrowRight') S.cam.x += d; if (e.key === 'ArrowUp') S.cam.y += d; if (e.key === 'ArrowDown') S.cam.y -= d; }
    else return;
    userMoved(); S.dirty = true;
  });
}

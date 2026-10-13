// ============================================================================
//  GRAVITY LAB  ·  app/pointer.js — turn, zoom, pick, and throw
// ----------------------------------------------------------------------------
//  With no tray item armed:
//    drag            turn the camera (one finger on a touch screen)
//    wheel / pinch   zoom (the camera director gives the distance back
//                    10 s after the last zoom: app/camera.js USER_HOLD)
//    tap             select the body under the pointer (24 px), or none
//    double tap      follow the body (the frame moves with it); again: stop
//  With a tray item armed (UI.item):
//    press           the start point, on the plane z = 0 of the frame
//    drag            the throw velocity (items.js throwVelocity: a drag of
//                    0.3 view extents is one local circular speed); the
//                    path ahead shows as a dashed line (predictPath, about
//                    6 s at Normal speed), red when it ends in a hit
//    release         throw. A tap without a drag gives a circular orbit.
//    two fingers     still zoom and turn
//
//  grep -n targets: "export function bindPointer", "function planePoint",
//  "function updateAim", "function pick"
// ============================================================================
import { S, UI, $ } from './state.js';
import { cam } from './camera.js';
import { throwItem } from './run.js';
import { toWorld, toFrame, frameOf, dirToWorld } from '../frame.js';
import { makeItem, throwVelocity, predictPath, dominant, itemMass, ITEM } from '../items.js';
import { v3 } from '../nbody.js';

const pts = new Map();
let pinch = null, down = null, lastTap = 0, predAt = 0;

// The point under the pointer (CSS px) on the plane z = 0 of the frame,
// or on the plane through the target facing the camera when z = 0 is
// edge-on or behind.
function planePoint(x, y) {
  const R = S.ren; if (!R || !R.basis) return null;
  const dpr = R.W / $('gpu').clientWidth;
  const px = x * dpr - 0.5 * R.W, py = 0.5 * R.H - y * dpr;
  // undo the lens shift (render.js persp: NDC y moves by shiftY)
  const pyc = py - cam.shiftY * 0.5 * R.H;
  const { r, u, f } = R.basis, eye = S.camNow.eye;
  const d = v3.norm([f[0] * R.focal + px * r[0] + pyc * u[0], f[1] * R.focal + px * r[1] + pyc * u[1], f[2] * R.focal + px * r[2] + pyc * u[2]]);
  if (Math.abs(d[2]) > 0.08) {
    const t = -eye[2] / d[2];
    if (t > 0) return v3.add(eye, v3.mul(d, t));
  }
  const tg = cam.target, t = v3.dot(v3.sub(tg, eye), f) / v3.dot(d, f);
  return v3.add(eye, v3.mul(d, t));
}
function pick(x, y) {
  const sys = S.lab && S.lab.sys, R = S.ren; if (!sys || !R) return -1;
  const dpr = R.W / $('gpu').clientWidth;
  let best = -1, bd = 24 * dpr;
  for (let i = 0; i < sys.n; i++) {
    if (!sys.alive[i]) continue;
    const q = R.project(toFrame(S.frame, sys.pos(i))); if (!q) continue;
    const d = Math.hypot(q.x - x * dpr, q.y - y * dpr);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
// the throw preview: from (frame), to (frame); path and its end
function updateAim(force) {
  const A = S.aim; if (!A) return;
  const sys = S.lab.sys, f = S.frame, ext = S.spec.view.extent, now = performance.now();
  const pW = toWorld(f, A.from), dragW = dirToWorld(f, v3.sub(A.to, A.from));
  A.v = throwVelocity(pW, dragW, dominant(sys), ext, itemMass(A.key, sys));
  A.pW = pW;
  if (!UI.predict || (!force && now - predAt < 60)) return;
  predAt = now;
  const it = ITEM[A.key];
  const b = it.parts ? { name: 'probe', kind: 'probe', m: 0, r: 0, x: pW, v: A.v } : makeItem(A.key, sys, pW, A.v, ext);
  const view = S.spec.view, follow = S.follow;
  const T = S.spec.rate * 6;
  const res = predictPath(sys, b, T, 110, 250, (ns, x) => toFrame(frameOf(ns, view, follow), x));
  A.path = res.pts; A.end = res.end;
}
function armedOK() { return UI.item && S.lab && S.lab.sys && !S.spec.self; }

export function bindPointer(onPick, onThrow) {
  const cv = $('gpu');
  cv.addEventListener('pointerdown', e => {
    if (S.saverOn) return;
    cv.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      S.aim = null; down = null;
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cam.dist, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, az: cam.az, el: cam.el };
      return;
    }
    down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, az: cam.az, el: cam.el };
    if (armedOK()) {
      const p = planePoint(e.clientX, e.clientY);
      if (p) { S.aim = { key: UI.item, from: p, to: p.slice(), path: null }; updateAim(true); }
    }
  });
  cv.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      cam.dist = Math.max(1e-6, pinch.dist * pinch.d / Math.max(10, d)); cam.zoomAt = performance.now();
      cam.az = pinch.az - (mx - pinch.mx) * 0.006; cam.el = pinch.el + (my - pinch.my) * 0.006;
      return;
    }
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.hypot(dx, dy) > 6) down.moved = true;
    if (S.aim) {
      const p = planePoint(e.clientX, e.clientY);
      if (p) { S.aim.to = p; updateAim(false); }
      return;
    }
    if (down.moved) { cam.az = down.az - dx * 0.006; cam.el = down.el + dy * 0.006; cam.userAt = performance.now(); }
  });
  const end = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!down) return;
    const d = down; down = null;
    if (S.aim) {
      updateAim(true);
      const A = S.aim; S.aim = null;
      if (e.type === 'pointerup') {
        const name = throwItem(A.key, A.pW, A.v);
        onThrow && onThrow(A.key, name);
      }
      return;
    }
    if (!d.moved && e.type === 'pointerup') {
      const i = pick(e.clientX, e.clientY), now = performance.now();
      if (now - lastTap < 320 && i >= 0) { S.follow = S.follow === i ? -1 : i; onPick && onPick(i, true); }
      else { S.sel = i; onPick && onPick(i, false); }
      lastTap = now;
    }
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    if (S.saverOn) return;
    cam.dist *= Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0012)));
    cam.zoomAt = performance.now();   // the distance is the user's for a while (camera.js USER_HOLD)
  }, { passive: false });
}

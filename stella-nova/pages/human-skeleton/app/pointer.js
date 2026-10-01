// ============================================================================
//  HUMAN SKELETON  ·  app/pointer.js — tap, double tap, hover, drag out
// ────────────────────────────────────────────────────────────────────────────
//  The canvas listeners use the capture phase, so they see a press before
//  OrbitControls. A press on the selected bone drags that bone on a plane
//  that faces the camera, and the orbit does not start. On release the
//  bone springs back (the loop runs the spring). A short press with no
//  movement is a tap: it selects, and a second tap on the same bone
//  focuses it. With a mouse, hoverPick shows the tip once a frame.
//
//  GREP MAP
//    const tip / downs / let multi / lastTap / mouse   pointer state
//    function ndc / planeHit                         drag plane
//    canvas.addEventListener                         pointer listeners
//    const endPointer / function onTap               tap and double tap
//    function dVelZero                               stop a spring
//    function setHover / moveTip / hoverPick         the hover tip
// ============================================================================
import * as THREE from 'three';
import { $, COARSE, HOVER, esc, SIDE_NAME } from './env.js';
import { canvas, camera } from './stage.js';
import { S, dirty, hideHint } from './state.js';
import { pickAt } from './pick.js';
import { boneCentre, setHi, select, clearSelection } from './select.js';
import { focusBone } from './inspect.js';

// Registered before OrbitControls reads the event: a press on the picked
// bone drags that bone and the orbit does not start.
const tip = $('tip');
const downs = new Map();
let multi = false, lastTap = { t: 0, i: -1 }, mouse = null;
const ray = new THREE.Raycaster(), plane = new THREE.Plane(), hitV = new THREE.Vector3();
function ndc(x, y) {
  const cr = canvas.getBoundingClientRect();
  return new THREE.Vector2(((x - cr.left) / cr.width) * 2 - 1, -((y - cr.top) / cr.height) * 2 + 1);
}
function planeHit(x, y, out) { ray.setFromCamera(ndc(x, y), camera); return ray.ray.intersectPlane(plane, out); }
canvas.addEventListener('pointerdown', e => {
  downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  if (downs.size > 1) { multi = true; return; }
  if (S.sel < 0 || e.button > 0) return;
  const i = pickAt(e.clientX, e.clientY, COARSE ? 12 : 3);
  if (i !== S.sel) return;
  const c = boneCentre(i);
  plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), c);
  const h = planeHit(e.clientX, e.clientY, new THREE.Vector3());
  if (!h) return;
  S.drag = { i, id: e.pointerId, start: h, base: new THREE.Vector3(S.dOff[i * 3], S.dOff[i * 3 + 1], S.dOff[i * 3 + 2]), moved: false };
  S.springing.delete(i);
  try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* old browsers */ }
  e.stopImmediatePropagation();
}, true);
canvas.addEventListener('pointermove', e => {
  if (S.drag && e.pointerId === S.drag.id) {
    if (downs.size > 1) return;
    if (!planeHit(e.clientX, e.clientY, hitV)) return;
    const d = hitV.sub(S.drag.start).add(S.drag.base);
    S.dOff[S.drag.i * 3] = d.x; S.dOff[S.drag.i * 3 + 1] = d.y; S.dOff[S.drag.i * 3 + 2] = d.z;
    const dn = downs.get(e.pointerId);
    if (dn && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > (COARSE ? 10 : 5)) { S.drag.moved = true; hideHint(); }
    dirty();
    e.stopImmediatePropagation();
    return;
  }
  if (HOVER && e.pointerType === 'mouse') mouse = { x: e.clientX, y: e.clientY, b: e.buttons };
}, true);
const endPointer = e => {
  const d = downs.get(e.pointerId);
  downs.delete(e.pointerId);
  const drag = S.drag && e.pointerId === S.drag.id ? S.drag : null;
  if (drag) {
    S.drag = null;
    S.springing.add(drag.i);
    dVelZero(drag.i);
    e.stopImmediatePropagation();
    if (drag.moved) return;
  }
  if (!d) return;
  const wasMulti = multi;
  if (!downs.size) multi = false;
  if (e.type === 'pointercancel' || wasMulti) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > (COARSE ? 10 : 6) || performance.now() - d.t > 600) return;
  onTap(e.clientX, e.clientY);
};
export function dVelZero(i) { S.dVel[i * 3] = S.dVel[i * 3 + 1] = S.dVel[i * 3 + 2] = 0; }
canvas.addEventListener('pointerup', endPointer, true);
canvas.addEventListener('pointercancel', endPointer, true);
canvas.addEventListener('pointerleave', () => { mouse = null; setHover(-1); });
function onTap(x, y) {
  const i = pickAt(x, y);
  const now = performance.now();
  if (i >= 0) {
    hideHint();
    if (now - lastTap.t < 380 && lastTap.i === i) { focusBone(i); lastTap = { t: 0, i: -1 }; return; }
    lastTap = { t: now, i };
    if (S.iso >= 0 && i !== S.iso) return;
    select(i, { scroll: true });
  } else {
    lastTap = { t: 0, i: -1 };
    if (S.iso < 0) clearSelection();
  }
}
export function setHover(i, x, y) {
  if (i === S.hov) { if (i >= 0) moveTip(x, y); return; }
  if (S.hov >= 0) setHi(S.hov, 1, 0);
  S.hov = i;
  if (i < 0) { tip.classList.remove('show'); canvas.style.cursor = ''; dirty(); return; }
  setHi(i, 1, 1);
  const b = S.bones[i];
  tip.innerHTML = `${esc(b.name)}${b.side ? ' · ' + SIDE_NAME[b.side] : ''} <i>${esc(b.latin)}</i>`;
  moveTip(x, y);
  tip.classList.add('show');
  canvas.style.cursor = i === S.sel ? 'grab' : 'pointer';
  dirty();
}
function moveTip(x, y) {
  const cr = canvas.getBoundingClientRect();
  tip.style.transform = `translate(${x - cr.left + 14}px,${y - cr.top + 16}px)`;
}
// hover pick, once a frame, while the mouse is still
export function hoverPick() {
  if (mouse && !mouse.b && !S.drag && S.groups.size) {
    const m = mouse; mouse = null;
    setHover(pickAt(m.x, m.y, 3), m.x, m.y);
  }
}

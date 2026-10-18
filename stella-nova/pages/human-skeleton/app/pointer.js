// ============================================================================
//  HUMAN SKELETON  ·  app/pointer.js — click to isolate, hover, long press
// ────────────────────────────────────────────────────────────────────────────
//  The canvas listeners use the capture phase, so they see a press before
//  OrbitControls. Each press keeps its largest travel, and focus.js
//  pressKind sorts it on release: a tap, a drag (it moved, or two fingers)
//  or a long press. Only a tap acts, so an orbit never selects.
//  A tap on a bone isolates it: the camera glides to frame it and the
//  others turn to ghosts (inspect.js isolate). A tap on the isolated bone
//  shows all again, and the camera stays. A double click acts once. A
//  tap on a ghost (a direct hit, app/pick.js) moves the isolation to it.
//  A tap on empty space shows all and flies back, or closes the card.
//  Outside isolation, a press on the selected bone drags it out on a
//  plane that faces the camera, and it springs back (the loop runs the
//  spring). In isolation a press always orbits.
//  The name of a bone shows in the tip: on hover with a mouse (once a
//  frame), and for a long press or a tap on a touch screen.
//
//  GREP MAP
//    const tip / downs / let multi / lastTap / mouse   pointer state
//    function ndc / planeHit                         drag plane
//    canvas.addEventListener                         pointer listeners
//    const endPointer / function onTap               tap, double tap
//    function dVelZero                               stop a spring
//    function setHover / moveTip / showTip           the tip
//    function hoverPick                              hover and long press, once a frame
// ============================================================================
import * as THREE from 'three';
import { $, COARSE, HOVER, esc, SIDE_NAME } from './env.js';
import { canvas, camera } from './stage.js';
import { S, dirty, hideHint } from './state.js';
import { pickAt, TOL_PX } from './pick.js';
import { boneCentre, setHi, clearSelection } from './select.js';
import { isolate, exitIsolate } from './inspect.js';
import { pressKind, TAP_PX } from '../focus.js';

const tip = $('tip');
const downs = new Map();
let multi = false, lastTap = { t: 0, i: -1 }, mouse = null, tipT = 0;
const ray = new THREE.Raycaster(), plane = new THREE.Plane(), hitV = new THREE.Vector3();
const isTouch = e => e.pointerType === 'touch' || e.pointerType === 'pen' || (!e.pointerType && COARSE);
function ndc(x, y) {
  const cr = canvas.getBoundingClientRect();
  return new THREE.Vector2(((x - cr.left) / cr.width) * 2 - 1, -((y - cr.top) / cr.height) * 2 + 1);
}
function planeHit(x, y, out) { ray.setFromCamera(ndc(x, y), camera); return ray.ray.intersectPlane(plane, out); }
canvas.addEventListener('pointerdown', e => {
  if (S.saver) return;
  const touch = isTouch(e);
  downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, touch, long: false });
  if (touch) hideTip();
  if (downs.size > 1) { multi = true; return; }
  // the drag out: the selected bone, outside isolation (there a drag orbits)
  if (S.sel < 0 || S.iso >= 0 || e.button > 0) return;
  const i = pickAt(e.clientX, e.clientY, touch ? 12 : 3);
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
  const dn = downs.get(e.pointerId);
  if (dn) dn.moved = Math.max(dn.moved, Math.hypot(e.clientX - dn.x, e.clientY - dn.y));
  if (S.drag && e.pointerId === S.drag.id) {
    if (downs.size > 1) return;
    if (!planeHit(e.clientX, e.clientY, hitV)) return;
    const d = hitV.sub(S.drag.start).add(S.drag.base);
    S.dOff[S.drag.i * 3] = d.x; S.dOff[S.drag.i * 3 + 1] = d.y; S.dOff[S.drag.i * 3 + 2] = d.z;
    if (dn && dn.moved > (dn.touch ? TAP_PX.touch : TAP_PX.mouse)) { S.drag.moved = true; hideHint(); }
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
  if (e.type === 'pointercancel' || S.saver) return;
  // a long press showed the name: it does not select
  if (d.long) { hideTip(1600); return; }
  const kind = pressKind(d, { x: e.clientX, y: e.clientY, t: performance.now() }, d.moved, d.touch, wasMulti);
  if (kind === 'tap') onTap(e.clientX, e.clientY, d.touch);
};
export function dVelZero(i) { S.dVel[i * 3] = S.dVel[i * 3 + 1] = S.dVel[i * 3 + 2] = 0; }
canvas.addEventListener('pointerup', endPointer, true);
canvas.addEventListener('pointercancel', endPointer, true);
canvas.addEventListener('pointerleave', () => { mouse = null; setHover(-1); });
function onTap(x, y, touch) {
  const i = pickAt(x, y, touch ? TOL_PX.touch : TOL_PX.mouse);
  const now = performance.now();
  if (i < 0) {
    lastTap = { t: 0, i: -1 };
    if (S.iso >= 0) exitIsolate(true); else clearSelection();
    return;
  }
  hideHint();
  // the second click of a double click: the first one did the toggle
  const dbl = lastTap.i === i && now - lastTap.t < 380;
  lastTap = { t: now, i };
  if (dbl) return;
  if (touch) showTip(i, x, y, 1400);
  if (S.iso === i) exitIsolate(false);
  else isolate(i);
}
function tipText(i) {
  const b = S.bones[i];
  return `${esc(b.name)}${b.side ? ' · ' + SIDE_NAME[b.side] : ''} <i>${esc(b.latin)}</i>`;
}
export function setHover(i, x, y) {
  if (i === S.hov) { if (i >= 0) moveTip(x, y); return; }
  if (S.hov >= 0) setHi(S.hov, 1, 0);
  S.hov = i;
  if (i < 0) { tip.classList.remove('show'); canvas.style.cursor = ''; dirty(); return; }
  setHi(i, 1, 1);
  tip.innerHTML = tipText(i);
  moveTip(x, y);
  tip.classList.add('show');
  canvas.style.cursor = i === S.sel && S.iso < 0 ? 'grab' : 'pointer';
  dirty();
}
function moveTip(x, y, touch = false) {
  const cr = canvas.getBoundingClientRect();
  // on a touch screen the tip goes above the finger
  tip.style.transform = `translate(${Math.max(4, x - cr.left + (touch ? -40 : 14))}px,${Math.max(4, y - cr.top + (touch ? -48 : 16))}px)`;
}
// the tip for a touch: the name, for ms (0: until the next press)
export function showTip(i, x, y, ms = 0) {
  clearTimeout(tipT);
  tip.innerHTML = tipText(i);
  moveTip(x, y, true);
  tip.classList.add('show');
  if (ms) tipT = setTimeout(() => tip.classList.remove('show'), ms);
}
function hideTip(ms = 0) {
  clearTimeout(tipT);
  if (ms) tipT = setTimeout(() => tip.classList.remove('show'), ms);
  else if (S.hov < 0) tip.classList.remove('show');
}
// once a frame: the hover pick while the mouse is still, and the long press
export function hoverPick() {
  if (S.saver) return;
  if (mouse && !mouse.b && !S.drag && S.groups.size) {
    const m = mouse; mouse = null;
    setHover(pickAt(m.x, m.y, TOL_PX.mouse), m.x, m.y);
  }
  if (downs.size === 1 && !multi && !S.drag) {
    const d = downs.values().next().value;
    if (d.touch && !d.long && d.moved <= TAP_PX.touch && performance.now() - d.t >= TAP_PX.longMs) {
      d.long = true;
      const i = pickAt(d.x, d.y, TOL_PX.touch);
      if (i >= 0) { hideHint(); showTip(i, d.x, d.y); }
    }
  }
}

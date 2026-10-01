// ui/fly.js — Mandelbulber page: fly mode, its keys and its two thumbsticks.
//
// In fly mode W A S D move, Q E move down / up, Shift moves faster, and a drag turns
// the view around the eye (the pointer code calls lookBy). On a touch screen the left
// stick moves and the right stick looks. flyStep runs once per frame. The speed follows
// the distance estimate of the engine, else the distance to the target.
//
// grep: let flying  const keys  const fly  function toggleFly  function flyStep  function stick  function initFly

import { $ } from './dom.js';
import { engine, info, touchUI } from './state.js';
import { flash } from './hud.js';
import { refreshAll } from './controls.js';
import { V, camFromScene, camBasis, camToScene, lookBy } from './camera.js';
import { L, snapTo } from './layout.js';
import { stopInertia } from './pointer.js';

export let flying = false;
export const keys = new Set();
export const fly = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 } };   // thumbstick values, -1..1

export function toggleFly() {
  stopInertia();
  flying = !flying;
  document.body.classList.toggle('flying', flying);
  $('flyBtn').classList.toggle('on', flying);
  $('flyBtn2')?.classList.toggle('on', flying);
  if (flying && L.mode === 'sheet' && L.snap !== 'peek') snapTo('peek');
  flash(flying ? (touchUI() ? 'fly mode: left stick moves, right stick looks' : 'fly mode: W A S D move, Q E down / up, drag to look') : 'orbit mode');
}

export function initFly() {
  $('flyBtn').addEventListener('click', toggleFly);
  stick($('stickL'), fly.move);
  stick($('stickR'), fly.look);
}

// Fly step: keys and thumbsticks. Speed follows the distance estimate when the engine reports one.
export function flyStep(dt) {
  if (!flying) return;
  const mag = (v) => Math.hypot(v.x, v.y);
  const sticks = mag(fly.move) > 0.04 || mag(fly.look) > 0.04;
  if (!keys.size && !sticks) return;
  const c = camFromScene();
  if (mag(fly.look) > 0.04) lookBy(c, fly.look.x * Math.abs(fly.look.x) * 1.8 * dt, fly.look.y * Math.abs(fly.look.y) * 1.4 * dt);
  const { fwd, right, top } = camBasis(c);
  let mv = { x: 0, y: 0, z: 0 };
  if (keys.has('w')) mv = V.add(mv, fwd);
  if (keys.has('s')) mv = V.sub(mv, fwd);
  if (keys.has('d')) mv = V.add(mv, right);
  if (keys.has('a')) mv = V.sub(mv, right);
  if (keys.has('e')) mv = V.add(mv, top);
  if (keys.has('q')) mv = V.sub(mv, top);
  let amount = V.len(mv) ? 1 : 0;
  if (mag(fly.move) > 0.04) {
    mv = V.add(mv, V.add(V.mul(fwd, -fly.move.y), V.mul(right, fly.move.x)));
    amount = Math.max(amount, Math.min(1, mag(fly.move)));
  }
  if (V.len(mv)) {
    const de = Number(engine?.distanceEstimate?.() ?? info?.distance ?? NaN);
    const scale = Number.isFinite(de) && de > 0 ? de : c.dist;
    const speed = scale * 0.6 * (keys.has('shift') ? 4 : 1) * amount;
    c.target = V.add(c.target, V.mul(V.norm(mv), speed * dt));
  }
  camToScene(c, true);
}

// One thumbstick: writes -1..1 into out while a finger holds it.
function stick(elm, out) {
  const knob = elm.querySelector('i');
  let id = null;
  const update = (e) => {
    const r = elm.getBoundingClientRect(), R = r.width / 2, m = R * 0.62;
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
    const l = Math.hypot(dx, dy);
    if (l > m) { dx *= m / l; dy *= m / l; }
    out.x = dx / m; out.y = dy / m;
    knob.style.setProperty('--kx', `${dx}px`); knob.style.setProperty('--ky', `${dy}px`);
  };
  elm.addEventListener('pointerdown', (e) => { e.preventDefault(); stopInertia(); id = e.pointerId; elm.setPointerCapture(id); update(e); });
  elm.addEventListener('pointermove', (e) => { if (e.pointerId === id) update(e); });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null; out.x = 0; out.y = 0;
    knob.style.setProperty('--kx', '0px'); knob.style.setProperty('--ky', '0px');
    refreshAll();
  };
  elm.addEventListener('pointerup', end);
  elm.addEventListener('pointercancel', end);
}

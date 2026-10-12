// ============================================================================
//  FLY DUEL  ·  node tests for the play-mode orbit
//  (node tests/play-orbit.test.mjs)
// ----------------------------------------------------------------------------
//    classify   ui/play/orbit.js classifyGesture: tap, drag, hold by
//               distance and time; a pinch is a drag
//    clamps     ui/fly3d/director.js ORBIT: orbitDrag and orbitZoom never
//               leave the elevation and distance limits; orbitFrom and
//               orbitPos are inverse
//    wheel      wheelZoom is limited per event and keeps its sign
//    gestures   attachOrbit on a fake element: a small move is a tap (no
//               turn, the click is not eaten), a drag turns the camera
//               and eats its click, a pinch zooms, blocked() (a hand card
//               drags) never turns, seat() gives the seat back
//    scene      orbitBy / zoomBy / seatView of ui/fly3d/scene.js: only in
//               first person, the camera moves, stays in the clamps and
//               above the table, and goes back to the seat
//  Exit code 1 on any failure.
// ============================================================================
import { registerHooks } from 'node:module';

const vendor = new URL('../../../vendor/three@0.160.0/', import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'three') return { url: new URL('build/three.module.js', vendor).href, shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: new URL('examples/jsm/' + spec.slice(13), vendor).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

const { classifyGesture, wheelZoom, attachOrbit, TAP, WHEEL } = await import('../ui/play/orbit.js');
const { ORBIT, orbitFrom, orbitPos, orbitDrag, orbitZoom, clampOrbit } = await import('../ui/fly3d/director.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// ------------------------------------------------------------- classify
ok(classifyGesture({ dx: 0, dy: 0, ms: 120 }) === 'tap', 'still and short: tap');
ok(classifyGesture({ dx: TAP.move, dy: 0, ms: 120 }) === 'tap', 'a move at the mouse limit is still a tap');
ok(classifyGesture({ dx: TAP.move + 1, dy: 0, ms: 120 }) === 'drag', 'past the mouse limit: drag');
ok(classifyGesture({ dx: 10, dy: 6, ms: 120, touch: true }) === 'tap', 'touch has a larger limit (finger jitter)');
ok(classifyGesture({ dx: 12, dy: 10, ms: 120, touch: true }) === 'drag', 'past the touch limit: drag');
ok(classifyGesture({ dx: 1, dy: 1, ms: TAP.ms + 200 }) === 'hold', 'still and long: hold (long-press inspect)');
ok(classifyGesture({ dx: 0, dy: 0, ms: 50, pointers: 2 }) === 'drag', 'two pointers: drag (pinch)');

// --------------------------------------------------------------- clamps
const look = { x: 0, y: 2, z: 0.4 };
let o = orbitFrom({ x: 0, y: 4.2, z: 5.2 }, look);
const back = orbitPos(o, look);
ok(near(back.x, 0) && near(back.y, 4.2) && near(back.z, 5.2), 'orbitPos(orbitFrom(p)) = p');
let minEl = 9, maxEl = -9, minD = 99, maxD = -1;
for (let i = 0; i < 400; i++) {
  o = i % 3 ? orbitDrag(o, (i * 37 % 200) - 100, (i * 53 % 300) - 150) : orbitZoom(o, i < 200 ? 1.9 : 0.4);
  minEl = Math.min(minEl, o.el); maxEl = Math.max(maxEl, o.el); minD = Math.min(minD, o.dist); maxD = Math.max(maxD, o.dist);
  if (o.az < -Math.PI - 1e-9 || o.az > Math.PI + 1e-9) { ok(false, 'az wraps to [-pi, pi]'); break; }
}
ok(minEl >= ORBIT.minEl - 1e-9 && maxEl <= ORBIT.maxEl + 1e-9, `elevation stays in [${ORBIT.minEl}, ${ORBIT.maxEl}] (${minEl.toFixed(3)}..${maxEl.toFixed(3)})`);
ok(near(minD, ORBIT.minDist) && near(maxD, ORBIT.maxDist), `distance reaches and keeps the limits (${minD}..${maxD})`);
ok(orbitDrag(clampOrbit({ az: 0, el: 0.5, dist: 6 }), 0, 1e6).el === ORBIT.maxEl, 'a huge drag down stops at maxEl');
ok(orbitDrag(clampOrbit({ az: 0, el: 0.5, dist: 6 }), 0, -1e6).el === ORBIT.minEl, 'a huge drag up stops at minEl (above the table)');
ok(orbitZoom({ az: 0, el: 0.5, dist: 6 }, NaN).dist === 6 && orbitZoom({ az: 0, el: 0.5, dist: 6 }, -2).dist === 6, 'a bad zoom factor does nothing');
ok(orbitDrag({ az: 0, el: 0.5, dist: 6 }, 10, 0).az < 0, 'a drag to the right turns the camera to the left (az down)');

// ---------------------------------------------------------------- wheel
ok(wheelZoom(100) > 1 && wheelZoom(-100) < 1, 'wheel down zooms out, up zooms in');
ok(wheelZoom(1e6) <= WHEEL.max && wheelZoom(-1e6) >= 1 / WHEEL.max, 'one wheel event is limited');
ok(wheelZoom(3, 1) > wheelZoom(3, 0), 'line mode counts more than pixel mode');

// ------------------------------------------------------------- gestures
globalThis.performance ??= { now: () => Date.now() };
function fakeEl() {
  const ls = {};
  return { addEventListener(t, f) { (ls[t] ||= []).push(f); }, removeEventListener(t, f) { ls[t] = (ls[t] || []).filter(x => x !== f); }, fire(t, e) { for (const f of ls[t] || []) f({ pointerType: 'mouse', button: 0, pointerId: 1, preventDefault() {}, ...e }); }, ls };
}
const calls = { orbit: 0, zoom: [], seat: 0 };
const fscene = { orbitBy(dx, dy) { calls.orbit++; return { dx, dy }; }, zoomBy(k) { calls.zoom.push(k); return {}; }, seatView() { calls.seat++; } };
let dragging = false, changes = [];
const el = fakeEl();
const g = attachOrbit(el, fscene, { blocked: () => dragging, onChange: v => changes.push(v) });
// a tap with a little jitter
el.fire('pointerdown', { clientX: 100, clientY: 100 });
el.fire('pointermove', { clientX: 103, clientY: 102 });
el.fire('pointerup', { clientX: 103, clientY: 102 });
ok(calls.orbit === 0 && g.consumeDrag() === false && !g.orbiting, 'a tap with jitter does not turn and its click picks');
// a drag
el.fire('pointerdown', { clientX: 100, clientY: 100 });
for (let i = 1; i <= 10; i++) el.fire('pointermove', { clientX: 100 + i * 6, clientY: 100 });
el.fire('pointerup', { clientX: 160, clientY: 100 });
ok(calls.orbit > 0 && g.orbiting && changes.at(-1) === true, `a drag turns the camera (${calls.orbit} turns)`);
ok(g.consumeDrag() === true && g.consumeDrag() === false, 'the click after a drag is eaten once');
// a hand card drags: blocked
const before = calls.orbit; dragging = true;
el.fire('pointerdown', { clientX: 100, clientY: 300 });
for (let i = 1; i <= 10; i++) el.fire('pointermove', { clientX: 100, clientY: 300 - i * 10 });
el.fire('pointerup', { clientX: 100, clientY: 200 });
ok(calls.orbit === before && g.consumeDrag() === false, 'while a hand card drags, the camera never turns');
dragging = false;
// a pinch (touch)
el.fire('pointerdown', { pointerType: 'touch', pointerId: 5, clientX: 100, clientY: 100 });
el.fire('pointerdown', { pointerType: 'touch', pointerId: 6, clientX: 200, clientY: 100 });
el.fire('pointermove', { pointerType: 'touch', pointerId: 6, clientX: 300, clientY: 100 });
el.fire('pointerup', { pointerType: 'touch', pointerId: 6, clientX: 300, clientY: 100 });
el.fire('pointerup', { pointerType: 'touch', pointerId: 5, clientX: 100, clientY: 100 });
ok(calls.zoom.length === 1 && near(calls.zoom[0], 0.5), `a pinch out zooms in (k = ${calls.zoom[0]})`);
ok(g.consumeDrag() === true, 'the click after a pinch is eaten');
// a right button press does nothing
el.fire('pointerdown', { button: 2, clientX: 0, clientY: 0 });
el.fire('pointermove', { clientX: 90, clientY: 0 });
ok(calls.orbit === before, 'a right-button drag does not turn (context menu inspect)');
g.seat();
ok(calls.seat === 1 && !g.orbiting && changes.at(-1) === false, 'seat() gives the seat back and hides the button');
g.dispose();
ok(Object.values(el.ls).every(a => a.length === 0), 'dispose removes every listener');

// ---------------------------------------------------------------- scene
const THREE = await import('three');
const rules = await import('../game/rules.js');
const { greedyBot } = await import('../game/bots.js');
const { Match, agentFromBot } = await import('../ui/match.js');
const { createDuelScene, TABLE } = await import('../ui/fly3d/scene.js');
for (const [w, h] of [[960, 540], [390, 760]]) {
  const tag = `${w}x${h}`;
  const style = {};
  const canvas = { clientWidth: w, clientHeight: h, style, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) };
  const sc = createDuelScene(canvas, { headless: true });
  await sc.ready;
  const M = new Match(rules, [agentFromBot(greedyBot(), 'a'), agentFromBot(greedyBot(), 'b')], { seed: 3 });
  sc.setState(M.state);
  ok(sc.orbitBy(50, 0) === null && sc.zoomBy(0.5) === null, `${tag}: no orbit in watch mode`);
  sc.setFirstPerson(0);
  ok(style.touchAction === 'none', `${tag}: first person takes the touch gestures`);
  for (let k = 0; k < 60; k++) sc.render(1 / 30);
  const seat = sc.camera.position.clone();
  const o0 = sc.orbitBy(0, 0);
  ok(o0 && sc.stats().orbit, `${tag}: orbit starts from the seat`);
  for (let k = 0; k < 5; k++) sc.render(1 / 30);
  ok(sc.camera.position.distanceTo(seat) < 0.05, `${tag}: a zero drag does not move the camera (${sc.camera.position.distanceTo(seat).toFixed(3)})`);
  sc.orbitBy(-400, 0);
  for (let k = 0; k < 90; k++) sc.render(1 / 30);
  ok(sc.camera.position.distanceTo(seat) > 1.5 && sc.stats().shot === 'seat', `${tag}: a drag moves the camera (${sc.camera.position.distanceTo(seat).toFixed(2)})`);
  let low = Infinity, far = 0;
  for (let k = 0; k < 40; k++) {
    sc.orbitBy(k * 13 % 90 - 45, k % 2 ? 300 : -300); sc.zoomBy(k % 3 ? 3 : 0.2);
    for (let j = 0; j < 6; j++) sc.render(1 / 30);
    low = Math.min(low, sc.camera.position.y); far = Math.max(far, sc.stats().orbit.dist);
  }
  ok(low > TABLE.y && far <= ORBIT.maxDist + 1e-9, `${tag}: the camera stays above the table top (lowest y ${low.toFixed(2)}) and in range`);
  sc.seatView();
  for (let k = 0; k < 90; k++) sc.render(1 / 30);
  ok(sc.stats().orbit === null && sc.camera.position.distanceTo(seat) < 0.05, `${tag}: seatView goes back to the seat`);
  sc.orbitBy(100, 0); sc.setFirstPerson(null);
  ok(sc.stats().orbit === null && style.touchAction === 'pan-y', `${tag}: watch mode drops the orbit and gives the page scroll back`);
  sc.dispose();
}

console.log(`play-orbit: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

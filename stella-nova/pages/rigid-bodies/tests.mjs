// ============================================================================
//  RIGID BODIES TESTS  ·  node stella-nova/pages/rigid-bodies/tests.mjs
// ----------------------------------------------------------------------------
//  upstream      the upstream chain (4 boxes, mass doubling, compliance
//                0.001, damping 5) settles with the top thread force near
//                the weight of the chain, 150 N, as its labels show
//  mobile        the upstream crib mobile hangs in balance: every bar
//                stays level within 3 degrees after it settles
//  pendulums     the pendulum wave threads give periods T / (N0 + k)
//  random scenes N seeds of the randomizer (scenes.js with its guard) run
//                600 steps each: no NaN, no body below the floor or far
//                off. N = 40 (RB_FULL=1: 200).
//  drag          the upstream drag constraint pulls a body to the pointer
//  determinism   one seed, one scene, one result
//  hash          every control round-trips through the share link
//  saver         the saver plan: no back-to-back repeats, 6-12 s cuts
//  page          main.js boots under the DOM stub (no WebGL), autoplays,
//                rebuilds on a new scene, and the saver cuts with TeX
// ============================================================================
import vm from 'node:vm';
import fs from 'node:fs';
import { installDom } from '../../widgets/sim-kit/test/stubs.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
installDom({ w: 1280, h: 800 });
vm.runInThisContext(fs.readFileSync(new URL('../../vendor/three@0.139.2/build/three.min.js', import.meta.url), 'utf8'));
const SC = await import('./scenes.js');
const { SHOTS } = await import('./saver.js');
const K = await import('../../widgets/sim-kit/core.js');
const SCHEMA = SC.makeSchema(false);
const sceneOf = (seed, over = {}) => Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SC.guard }).state, over);
const build = (st, seed) => SC.buildScene(new THREE.Group(), SC.sceneConfig(SC.guard(st)), SC.sceneRng(seed));
const finite = sim => sim.rigidBodies.every(b => Number.isFinite(b.pos.x + b.pos.y + b.pos.z + b.rot.x + b.rot.w) && b.pos.y > -0.2 && Math.abs(b.pos.x) < 6 && Math.abs(b.pos.z) < 6);

{
  const st = Object.assign(K.defaults(SCHEMA), { scene: 'chain', links: 4, growth: 2, density: 1000, compliance: 0.001, damping: 5, labels: false, g: 10, dt: '0.02' });
  const sim = build(st, 1);
  for (let i = 0; i < 600; i++) sim.simulate();
  const c = sim.distanceConstraints[0];
  c.body0.localToWorld(c.localPos0, c.worldPos0);
  const stretch = c.worldPos0.distanceTo(c.worldPos1) - c.distance, mass = sim.rigidBodies.reduce((a, b) => a + 1 / b.invMass, 0), F = stretch / 0.001;
  ok(Math.abs(F - mass * 10) / (mass * 10) < 0.05, 'upstream: the mass chain top thread holds the chain weight (labels: 150 N, 0.15 m)', `${mass.toFixed(1)} kg, stretch ${stretch.toFixed(3)} m, force ${F.toFixed(0)} N`);
}
{
  const st = Object.assign(K.defaults(SCHEMA), { scene: 'mobile', levels: 5, spin: 0, labels: false });
  const sim = build(st, 1);
  for (let i = 0; i < 900; i++) sim.simulate();
  const tilt = sim.rigidBodies.filter(b => b.type === 'box').map(b => { const x = new THREE.Vector3(1, 0, 0).applyQuaternion(b.rot); return Math.asin(Math.min(1, Math.abs(x.y))) * 180 / Math.PI; });
  ok(tilt.every(a => a < 3), 'mobile: the upstream crib mobile hangs in balance (bars level within 3°)', tilt.map(a => a.toFixed(2)).join(' '));
}
{
  const st = Object.assign(K.defaults(SCHEMA), { scene: 'pendulums', count: 8, g: 10, angle: 5, density: 1000 });
  const sim = build(st, 1);
  const L = sim.distanceConstraints.map(c => c.distance), want = L.map((_, k) => 30 / (18 + k)), T = L.map(l => 2 * Math.PI * Math.sqrt(l / 10));
  ok(T.every((t, k) => Math.abs(t - want[k]) < 1e-9), 'pendulums: thread k has the period T / (N0 + k)', T.map(t => t.toFixed(3)).join(' '));
}
{
  const N = process.env.RB_FULL ? 200 : 40, bad = [];
  for (let s = 1; s <= N; s++) { const st = sceneOf(s, { labels: false }); const sim = build(st, s); for (let i = 0; i < 600; i++) { sim.gravity.set(st.windX, -st.g, st.windZ); sim.simulate(); } if (!finite(sim)) bad.push(s + ':' + st.scene); }
  ok(!bad.length, `random scenes: ${N} seeds x 600 steps stay finite, above the floor and near`, bad.slice(0, 6).join(' '));
}
{
  const st = Object.assign(K.defaults(SCHEMA), { scene: 'pendulums', count: 5, angle: 0, labels: false });
  const sim = build(st, 1), b = sim.rigidBodies[2], target = b.pos.clone().add(new THREE.Vector3(0.2, 0.1, 0.1));
  sim.startDrag(b, b.pos.clone());
  for (let i = 0; i < 120; i++) { sim.drag(target.clone()); sim.simulate(); }
  sim.endDrag();
  ok(b.pos.distanceTo(target) < 0.05, 'drag: the upstream drag constraint pulls a body to the pointer', `${b.pos.distanceTo(target).toFixed(3)} m off`);
}
{
  const st = sceneOf(77, { labels: false }), a = build(st, 77), b = build(st, 77);
  for (let i = 0; i < 300; i++) { a.simulate(); b.simulate(); }
  ok(a.rigidBodies.every((x, i) => x.pos.x === b.rigidBodies[i].pos.x && x.rot.w === b.rigidBodies[i].rot.w), 'determinism: one seed gives one result');
}
{
  let bad = [];
  for (let s = 1; s <= 30; s++) { const st = sceneOf(s), d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); for (const k of Object.keys(st)) if (JSON.stringify(d.state[k]) !== JSON.stringify(st[k])) bad.push(k); }
  ok(!bad.length, 'hash: every control round-trips through the share link', bad.slice(0, 5).join(' '));
}
{
  const plan = K.planShots(SHOTS, 5, 200);
  ok(SHOTS.length >= 6 && plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12) && SHOTS.every(s => s.tex && !s.code), `saver plan: ${SHOTS.length} shots, no repeats, 6-12 s cuts, TeX and no code`);
}
{
  globalThis.TMP = { page() {}, creditLines: () => ['Rigid Bodies by Matthias Müller'] };
  await import('./main.js');
  const P = window.__rb;
  runRaf(30);
  ok(P.kit.playing && P.sim && P.sim.rigidBodies.length > 0 && !P.stage.gl, 'page: boots without WebGL, builds a random scene and autoplays', `${P.kit.state.scene}, ${P.sim.rigidBodies.length} bodies`);
  const s0 = P.sim; P.kit.newScene(); runRaf(3);
  ok(P.sim !== s0, 'page: a new scene rebuilds the sim');
  const labels = [];
  await window.snSaver.enter({ seed: 9, label: L => labels.push(L) });
  for (let k = 0; k < 10; k++) { window.snSaver.cut(); runRaf(30); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  const cam = P.stage.camera.position;
  ok(hist.length === 11 && rep === 0 && finite(P.sim) && Number.isFinite(cam.x + cam.y + cam.z) && labels.every(L => L.tex && !L.code), 'page saver: 11 cuts, no repeats, finite sim and camera, TeX plates, no code', hist.map(x => x.shot).join(' '));
  window.snSaver.exit();
  ok(!document.documentElement.classList.contains('sk-saver') && !P.stage.cam.auto, 'page saver: exit restores the page');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

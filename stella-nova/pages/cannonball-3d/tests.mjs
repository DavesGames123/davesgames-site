// ============================================================================
//  CANNONBALL 3D TESTS  ·  node stella-nova/pages/cannonball-3d/tests.mjs
// ----------------------------------------------------------------------------
//  random scenes  N seeds of the page randomizer (scene.js with its guard)
//                 run 600 frames each: no NaN, every ball inside the box,
//                 on or above the floor. N = 40 (CB_FULL=1: 200).
//  upstream       the upstream scene (one ball, e = 1) keeps its energy
//                 bounded within 15 % over 20 s (the upstream floor clamp
//                 is not energy exact) and bounces off the walls
//  impulse        two balls head on, no gravity: momentum kept, e = 1
//                 swaps the velocities of equal balls
//  throw          a grabbed ball follows the pointer; release sets its
//                 velocity
//  determinism    one seed, one scene, one result
//  hash           every control round-trips through the share link
//  saver          the saver plan: no back-to-back repeats, 6-12 s cuts
//  page           main.js boots under the DOM stub (no WebGL: the stage
//                 runs without a renderer), autoplays, rebuilds on a new
//                 scene, and the saver cuts with TeX plates and no code
// ============================================================================
import vm from 'node:vm';
import fs from 'node:fs';
import * as SIM from './sim.js';
import * as SC from './scene.js';
import { SHOTS } from './saver.js';
import * as K from '../../widgets/sim-kit/core.js';
import { installDom } from '../../widgets/sim-kit/test/stubs.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const SCHEMA = SC.makeSchema(false);
const sceneOf = (seed, over = {}) => Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SC.guard }).state, over);
function run(st, seed, frames) {
  const S = SIM.createSim();
  SC.applyParams(S, st);
  SIM.buildScene(S, SC.sceneConfig(st), SC.sceneRng(seed));
  for (let f = 0; f < frames; f++) S.step(1 / 60);
  return S;
}
const inside = (S, b) => Number.isFinite(b.x + b.y + b.z + b.vx + b.vy + b.vz) && Math.abs(b.x) <= S.P.hx - b.r + 1e-6 && Math.abs(b.z) <= S.P.hz - b.r + 1e-6 && b.y >= b.r - 1e-6 && b.y < 80;

{
  const N = process.env.CB_FULL ? 200 : 40, bad = [];
  let balls = 0;
  for (let s = 1; s <= N; s++) {
    const st = sceneOf(s), S = run(st, s, 600);
    balls += S.balls.length;
    if (!S.balls.every(b => inside(S, b))) bad.push(s + ':' + st.start);
  }
  ok(!bad.length, `random scenes: ${N} seeds x 600 frames stay finite and inside the box`, bad.length ? 'bad ' + bad.slice(0, 6).join(' ') : `${balls} balls at the end`);
}
{
  const st = sceneOf(5, { start: 'upstream' }), S = SIM.createSim();
  SC.applyParams(S, SC.guard(st)); SIM.buildScene(S, SC.sceneConfig(SC.guard(st)), SC.sceneRng(5));
  const E0 = SIM.energy(S); let walls = 0, emax = 0;
  for (let f = 0; f < 1200; f++) { const vx = S.balls[0].vx, vz = S.balls[0].vz; S.step(1 / 60); if (Math.sign(vx) !== Math.sign(S.balls[0].vx) || Math.sign(vz) !== Math.sign(S.balls[0].vz)) walls++; emax = Math.max(emax, Math.abs(SIM.energy(S) - E0) / E0); }
  ok(S.balls.length === 1 && emax < 0.15 && walls > 4, 'upstream: one ball, e = 1, energy bounded within 15 %, wall bounces', `drift ${(100 * emax).toFixed(2)} %, ${walls} wall hits in 20 s`);
}
{
  const S = SIM.createSim();
  Object.assign(S.P, { g: 0, drag: 0, e: 1, collide: true, substeps: 4 });
  S.balls = [SIM.makeBall(-0.5, 1, 0, 2, 0, 0, 0.2, 1), SIM.makeBall(0.5, 1, 0, -1, 0, 0, 0.2, 1)];
  const p0 = S.balls.reduce((a, b) => a + b.m * b.vx, 0);
  for (let f = 0; f < 40; f++) S.step(1 / 60);
  const p1 = S.balls.reduce((a, b) => a + b.m * b.vx, 0);
  ok(Math.abs(p1 - p0) < 1e-9 && Math.abs(S.balls[0].vx + 1) < 1e-6 && Math.abs(S.balls[1].vx - 2) < 1e-6, 'impulse: momentum kept; e = 1 swaps equal balls', `p ${p0.toFixed(3)} -> ${p1.toFixed(3)}, v ${S.balls[0].vx.toFixed(3)}, ${S.balls[1].vx.toFixed(3)}`);
}
{
  const S = SIM.createSim(); Object.assign(S.P, { g: 10, drag: 0 });
  S.balls = [SIM.makeBall(0, 1, 0, 0, 0, 0, 0.2, 1)];
  const hit = SIM.pick(S, [0, 1, 5], [0, 0, -1]);
  SIM.grab(S, hit.i, [0, 1, 0]);
  for (let f = 0; f < 30; f++) { SIM.hold(S, [0.5, 1.2, 0], [2, 0, 0]); S.step(1 / 60); }
  const b = S.balls[0], near = Math.hypot(b.x - 0.5, b.y - 1.2, b.z) < 0.05;
  SIM.release(S, [3, 4, 0]);
  ok(hit.i === 0 && near && b.vx === 3 && b.vy === 4 && S.held === -1, 'throw: a held ball follows the pointer; release sets its velocity', `at ${b.x.toFixed(2)}, ${b.y.toFixed(2)}`);
}
{
  const st = sceneOf(77), a = run(st, 77, 300), b = run(st, 77, 300);
  ok(a.balls.length === b.balls.length && a.balls.every((x, i) => x.x === b.balls[i].x && x.vy === b.balls[i].vy), 'determinism: one seed gives one result');
}
{
  let bad = [];
  for (let s = 1; s <= 30; s++) {
    const st = sceneOf(s), str = K.encodeHash(SCHEMA, st, s), d = K.decodeHash(SCHEMA, str);
    for (const k of Object.keys(st)) if (JSON.stringify(d.state[k]) !== JSON.stringify(st[k])) bad.push(k);
  }
  ok(!bad.length, 'hash: every control round-trips through the share link', bad.slice(0, 5).join(' '));
}
{
  const plan = K.planShots(SHOTS, 5, 200);
  ok(SHOTS.length >= 6 && plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12) && SHOTS.every(s => s.tex && !s.code),
    `saver plan: ${SHOTS.length} shots, no repeats, 6-12 s cuts, TeX and no code`);
}
{
  installDom({ w: 1280, h: 800 });
  vm.runInThisContext(fs.readFileSync(new URL('../../vendor/three@0.139.2/build/three.min.js', import.meta.url), 'utf8'));
  globalThis.TMP = { page() {}, creditLines: () => ['Cannonball 3D by Matthias Müller'] };
  globalThis.performance = globalThis.performance || { now: () => Date.now() };
  await import('./main.js');
  const P = window.__cb;
  runRaf(40);
  const n0 = P.S.balls.length, f0 = P.S.frame;
  ok(P.kit.playing && f0 > 0 && n0 > 0 && !P.stage.gl, 'page: boots without WebGL, builds a random scene and autoplays', `${n0} balls, ${f0} frames, seed ${P.kit.seed}`);
  const seed0 = P.kit.seed; P.kit.newScene(); runRaf(5);
  ok(P.kit.seed !== seed0 && P.S.frame < f0, 'page: a new scene rebuilds the sim');
  const labels = [];
  await window.snSaver.enter({ seed: 9, label: L => labels.push(L) });
  for (let k = 0; k < 12; k++) { window.snSaver.cut(); runRaf(20); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  const fin = P.S.balls.every(b => inside(P.S, b)), cam = P.stage.camera.position;
  ok(hist.length === 13 && rep === 0 && fin && Number.isFinite(cam.x + cam.y + cam.z) && labels.every(L => L.tex && !L.code), 'page saver: 13 cuts, no repeats, finite sim and camera, TeX plates, no code', hist.map(x => x.shot).join(' '));
  window.snSaver.exit();
  ok(!document.documentElement.classList.contains('sk-saver') && !P.stage.cam.auto, 'page saver: exit restores the page');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

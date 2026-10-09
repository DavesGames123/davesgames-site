// ============================================================================
//  SOFT BODIES TESTS  ·  node stella-nova/pages/soft-bodies/tests.mjs
// ----------------------------------------------------------------------------
//  The upstream main.js runs in a node vm (test-vm.mjs: real three.js
//  objects, no WebGL). The scene build and the obstacle pass are the page's
//  own scene.js and stage3d.js.
//    random      N seeds of the randomizer (with the guard) run 240 frames:
//                every particle finite, above the floor, inside the world.
//                N = 6; SB_FULL=1 runs 60.
//    determinism one seed, one scene, one result
//    obstacles   a particle in a sphere or box is pushed to its surface; a
//                bunny dropped on a sphere ends above it
//    hash        every control round-trips through the share link
//    saver       every shot builds a stable scene; the plan has no
//                back-to-back repeats and 6-12 s cuts
// ============================================================================
import { loadUpstream, reporter } from './test-vm.mjs';
import * as SC from './scene.js';
import * as S3 from './stage3d.js';
import { makeShots } from './shots.js';
import * as K from '../../widgets/sim-kit/core.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { ok, done } = reporter();
const SCHEMA = K.normalize(SC.makeSchema(false));
const VM = loadUpstream(HERE);
const U = { THREE: VM.ctx.THREE, scene: VM.ctx.gThreeScene, P: VM.ctx.gPhysicsScene, SoftBody: VM.lex('SoftBody'), bunnyMesh: VM.ctx.bunnyMesh };
SC.install(U);
// Drawing is not tested: skip the per-substep normals of the upstream mesh update.
U.SoftBody.prototype.updateMeshes = function () {};
const H = 1 / 60;
const sceneOf = (seed, over = {}) => SC.guard(Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SC.guard }).state, over));
function run(st, seed, frames) {
  SC.build(U, st, K.rng((seed ^ 0x2545f491) >>> 0));
  U.P.dt = H;
  for (let f = 0; f < frames; f++) SC.simulate(U);
  return U.P.objects;
}
function health(list) {
  let bad = 0, below = 0, out = 0, ymin = Infinity, rmax = 0;
  for (const b of list) for (let i = 0; i < b.numParticles; i++) {
    const x = b.pos[3 * i], y = b.pos[3 * i + 1], z = b.pos[3 * i + 2];
    if (!Number.isFinite(x + y + z)) bad++; else { ymin = Math.min(ymin, y); rmax = Math.max(rmax, Math.hypot(x, z)); if (y < -0.05) below++; if (Math.abs(x) > 30 || Math.abs(z) > 30 || y > 40) out++; }
  }
  return { bad, below, out, ymin, rmax };
}

{
  const N = process.env.SB_FULL ? 60 : 6, bad = [];
  let n = 0;
  for (let s = 1; s <= N; s++) {
    const seed = s * 7919, st = sceneOf(seed);
    const h = health(run(st, seed, 150)); n += U.P.objects.length;
    if (h.bad || h.below || h.out) bad.push(`seed ${seed} n=${st.count} ${st.layout} edgeC ${st.edgeC} volC ${st.volC} subs ${st.subs}: NaN ${h.bad} below ${h.below} out ${h.out} ymin ${h.ymin.toFixed(3)}`);
  }
  ok(!bad.length, `random: ${N} seeds x 150 frames stay finite, above the floor and in the world (${n} bunnies)`, bad.slice(0, 3).join('; '));
}
{
  const st = sceneOf(4242);
  const a = run(st, 4242, 120).map(b => Array.from(b.pos));
  const b = run(st, 4242, 120).map(b => Array.from(b.pos));
  ok(a.length === b.length && a.every((p, i) => p.every((v, k) => v === b[i][k])), 'determinism: one seed gives the same particle positions after 120 frames');
}
{
  const sph = { type: 'sphere', c: [0, 0.5, 0], r: 0.3, v: [0, 0, 0] }, box = { type: 'box', c: [1, 0.2, 0], h: [0.2, 0.2, 0.2], v: [0, 0, 0] };
  const pos = new Float32Array([0.05, 0.55, 0, 1.05, 0.3, 0.02]), prev = pos.slice(), inv = new Float32Array([1, 1]);
  S3.collide([sph, box], pos, prev, inv, 2, 0.01, 0, 0);
  const d0 = Math.hypot(pos[0] - 0, pos[1] - 0.5, pos[2]), top = pos[4];
  ok(Math.abs(d0 - 0.31) < 1e-5 && Math.abs(top - 0.41) < 1e-5, 'obstacles: points inside a sphere and a box go to the padded surface', `sphere ${d0.toFixed(4)} box top ${top.toFixed(4)}`);
  const st = Object.assign(sceneOf(11), { count: 1, layout: 'drop', height: 0.6, spin: 0, tumble: false, obstacles: 0, tilt: 0, edgeC: 50, volC: 0, subs: 10, g: 10 });
  SC.build(U, st, K.rng(5));
  SC.W.obs = [{ type: 'sphere', c: [0, 0.35, 0], r: 0.35, v: [0, 0, 0] }];
  U.P.dt = H;
  const b = U.P.objects[0];
  let inside = 0, touch = Infinity;
  const gap = () => { let m = Infinity; for (let i = 0; i < b.numParticles; i++) m = Math.min(m, Math.hypot(b.pos[3 * i], b.pos[3 * i + 1] - 0.35, b.pos[3 * i + 2]) - 0.35); return m; };
  for (let f = 0; f < 150; f++) { SC.simulate(U); const g = gap(); touch = Math.min(touch, g); if (g < -0.02) inside++; }
  ok(inside === 0 && touch < 0.03, 'obstacles: a bunny dropped on a sphere lands on it and no particle goes inside', `frames inside ${inside}, closest ${touch.toFixed(4)} m`);
}
{
  let bad = 0;
  for (let s = 1; s <= 60; s++) {
    const st = sceneOf(s * 31), seed = s * 31;
    const d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, seed));
    if (d.seed !== seed || Object.keys(st).some(k => d.state[k] !== undefined && d.state[k] !== st[k])) bad++;
  }
  ok(!bad, 'hash: 60 random scenes round-trip through the share link');
}
{
  const shots = makeShots({ squash() {}, later() {} });
  const bad = [];
  for (const sh of shots) {
    const r = K.rng(99), st = SC.guard(Object.assign(sceneOf(1234), sh.scene(r, sceneOf(1234))));
    const h = health(run(st, 77, 120)), cam = sh.camera(K.rng(3));
    if (h.bad || h.below || h.out || !['az', 'el', 'r'].every(k => Number.isFinite(cam[k]))) bad.push(`${sh.key} (NaN ${h.bad} below ${h.below} out ${h.out} ymin ${h.ymin.toFixed(3)} r ${h.rmax.toFixed(1)})`);
  }
  ok(!bad.length, `saver: all ${shots.length} shots build a stable scene with a finite camera`, bad.join(' '));
  const plan = K.planShots(shots, 2024, 60);
  let rep = 0, len = 0;
  for (let i = 0; i < plan.length; i++) { if (i && plan[i].key === plan[i - 1].key) rep++; if (!(plan[i].sec >= 6 && plan[i].sec <= 12)) len++; }
  ok(!rep && !len, 'saver: 60 cuts, no shot twice in a row, every cut 6-12 s', `repeats ${rep}, bad lengths ${len}`);
}
done();

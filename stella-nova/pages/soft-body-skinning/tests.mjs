// ============================================================================
//  SOFT BODY SKINNING TESTS  ·  node stella-nova/pages/soft-body-skinning/tests.mjs
// ----------------------------------------------------------------------------
//  The upstream main.js runs in a node vm (../soft-bodies/test-vm.mjs:
//  real three.js objects, no WebGL). The scene build and the obstacle pass
//  are the page's own scene.js and ../soft-bodies/stage3d.js.
//    random      N seeds of the randomizer (with the guard) run 90 frames:
//                every particle finite, above the floor, in the world.
//                N = 4; SK_FULL=1 runs 30.
//    determinism one seed, one scene, one result
//    skin        after a fall the skinned surface stays on the cage: every
//                surface vertex is within 0.1 m of the tet mesh bounds
//    obstacles   a dragon dropped on a sphere ends with no particle inside
//    hash        every control round-trips through the share link
//    saver       every shot builds a stable scene; the plan has no
//                back-to-back repeats and 6-12 s cuts
// ============================================================================
import { loadUpstream, reporter } from '../soft-bodies/test-vm.mjs';
import * as SC from './scene.js';
import { makeShots } from './shots.js';
import * as K from '../../widgets/sim-kit/core.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { ok, done } = reporter();
const SCHEMA = K.normalize(SC.makeSchema(false));
const VM = loadUpstream(HERE);
const U = { THREE: VM.ctx.THREE, scene: VM.ctx.gThreeScene, P: VM.ctx.gPhysicsScene, SoftBody: VM.lex('SoftBody'), tetMesh: VM.ctx.dragonTetMesh, visMesh: VM.ctx.dragonVisMesh };
SC.install(U);
// The fine surface update is only drawing; the skin test calls it itself.
const visUpdate = U.SoftBody.prototype.updateVisMesh;
U.SoftBody.prototype.updateVisMesh = function () {}; U.SoftBody.prototype.updateTetMesh = function () {};
const H = 1 / 60;
const sceneOf = (seed, over = {}) => SC.guard(Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SC.guard }).state, over));
function run(st, seed, frames) { SC.build(U, st, K.rng((seed ^ 0x2545f491) >>> 0)); U.P.dt = H; for (let f = 0; f < frames; f++) SC.simulate(U); return U.P.objects; }
function health(list) {
  let bad = 0, below = 0, out = 0;
  for (const b of list) for (let i = 0; i < b.numParticles; i++) {
    const x = b.pos[3 * i], y = b.pos[3 * i + 1], z = b.pos[3 * i + 2];
    if (!Number.isFinite(x + y + z)) bad++; else { if (y < -0.05) below++; if (Math.abs(x) > 30 || Math.abs(z) > 30 || y > 40) out++; }
  }
  return { bad, below, out };
}
{
  const N = process.env.SK_FULL ? 30 : 4, bad = [];
  for (let s = 1; s <= N; s++) { const seed = s * 7919, st = sceneOf(seed), h = health(run(st, seed, 90)); if (h.bad || h.below || h.out) bad.push(`seed ${seed} n ${st.count} ${st.layout}: NaN ${h.bad} below ${h.below} out ${h.out}`); }
  ok(!bad.length, `random: ${N} seeds x 90 frames stay finite, above the floor and in the world`, bad.slice(0, 3).join('; '));
}
{
  const st = sceneOf(4242, { count: 1 });
  const a = run(st, 4242, 40).map(b => Array.from(b.pos)), b = run(st, 4242, 40).map(b => Array.from(b.pos));
  ok(a.every((p, i) => p.every((v, k) => v === b[i][k])), 'determinism: one seed gives the same particle positions after 40 frames');
}
{
  const st = sceneOf(3, { count: 1, layout: 'drop', height: 0.6, tumble: true, obstacles: 0, edgeC: 20, volC: 0 });
  const [b] = run(st, 3, 90);
  visUpdate.call(b);
  const v = b.visMesh.geometry.attributes.position.array;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < b.numParticles; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], b.pos[3 * i + k]); hi[k] = Math.max(hi[k], b.pos[3 * i + k]); }
  let off = 0, nan = 0;
  for (let i = 0; i < v.length; i += 3) { if (!Number.isFinite(v[i] + v[i + 1] + v[i + 2])) { nan++; continue; } for (let k = 0; k < 3; k++) if (v[i + k] < lo[k] - 0.1 || v[i + k] > hi[k] + 0.1) { off++; break; } }
  ok(!nan && !off, 'skin: after a tumbling fall every surface vertex stays on the tet cage', `${v.length / 3} vertices, ${off} outside, ${nan} NaN`);
}
{
  const st = sceneOf(11, { count: 1, layout: 'drop', height: 0.5, tumble: false, obstacles: 0, edgeC: 10, volC: 0 });
  SC.build(U, st, K.rng(5)); SC.W.obs = [{ type: 'sphere', c: [0, 0.4, 0], r: 0.4, v: [0, 0, 0] }];
  const b = U.P.objects[0]; U.P.dt = H; let inside = 0;
  for (let f = 0; f < 90; f++) { SC.simulate(U); for (let i = 0; i < b.numParticles; i++) if (Math.hypot(b.pos[3 * i], b.pos[3 * i + 1] - 0.4, b.pos[3 * i + 2]) < 0.4 - 0.02) inside++; }
  ok(inside === 0, 'obstacles: a dragon dropped on a sphere never puts a particle inside it', `${inside} particle-frames inside`);
}
{
  let bad = 0;
  for (let s = 1; s <= 60; s++) { const st = sceneOf(s * 31), seed = s * 31, d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, seed)); if (d.seed !== seed || Object.keys(st).some(k => d.state[k] !== undefined && d.state[k] !== st[k])) bad++; }
  ok(!bad, 'hash: 60 random scenes round-trip through the share link');
}
{
  const shots = makeShots({ squash: () => { for (const b of U.P.objects) b.squash(); }, later: (s, f) => f() }), bad = [];
  for (const sh of shots) {
    const st = SC.guard(Object.assign(sceneOf(1234), sh.scene(K.rng(99), sceneOf(1234))));
    SC.build(U, st, K.rng(77)); if (sh.start) sh.start();
    U.P.dt = H; for (let f = 0; f < 50; f++) SC.simulate(U);
    const h = health(U.P.objects), cam = sh.camera(K.rng(3));
    if (h.bad || h.below || h.out || !['az', 'el', 'r'].every(k => Number.isFinite(cam[k]))) bad.push(sh.key);
  }
  ok(!bad.length, `saver: all ${shots.length} shots build a stable scene with a finite camera`, bad.join(' '));
  const plan = K.planShots(shots, 2024, 60);
  let rep = 0, len = 0;
  for (let i = 0; i < plan.length; i++) { if (i && plan[i].key === plan[i - 1].key) rep++; if (!(plan[i].sec >= 6 && plan[i].sec <= 12)) len++; }
  ok(!rep && !len, 'saver: 60 cuts, no shot twice in a row, every cut 6-12 s', `repeats ${rep}, bad lengths ${len}`);
}
done();

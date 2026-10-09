// ============================================================================
//  GRAB INTERACTION TESTS  ·  node stella-nova/pages/soft-body-interaction/tests.mjs
// ----------------------------------------------------------------------------
//  The upstream main.js runs in a node vm (../soft-bodies/test-vm.mjs:
//  real three.js objects, no WebGL). The build, restitution, contacts and
//  substeps are the page's own scene.js.
//    random      40 seeds of the randomizer (with the guard) run 300
//                frames: every ball finite, inside the box, above the floor
//    determinism one seed, one scene, one result
//    bounce      a ball dropped from h bounces back to about e^2 h
//    contacts    two balls in a head-on hit keep the momentum; after the
//                pile settles no two balls overlap by more than 2 % of r
//    obstacles   no ball ends inside an obstacle
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
const U = { THREE: VM.ctx.THREE, scene: VM.ctx.gThreeScene, P: VM.ctx.gPhysicsScene, Ball: VM.lex('Ball') };
SC.install(U);
const H = 1 / 60;
const sceneOf = (seed, over = {}) => SC.guard(Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SC.guard }).state, over));
function run(st, seed, frames) { SC.build(U, st, K.rng((seed ^ 0x2545f491) >>> 0)); U.P.dt = H; for (let f = 0; f < frames; f++) SC.simulate(U); return U.P.objects; }
function health(list, st) {
  let bad = 0, out = 0;
  for (const b of list) {
    const p = b.pos;
    if (!Number.isFinite(p.x + p.y + p.z + b.vel.x + b.vel.y + b.vel.z)) { bad++; continue; }
    if (Math.abs(p.x) > st.width / 2 + 1e-6 || Math.abs(p.z) > st.depth / 2 + 1e-6 || p.y < b.radius - 0.01) out++;
  }
  return { bad, out };
}
{
  const bad = [];
  for (let s = 1; s <= 40; s++) { const seed = s * 7919, st = sceneOf(seed), h = health(run(st, seed, 300), st); if (h.bad || h.out) bad.push(`seed ${seed} n ${st.count} ${st.launch}: NaN ${h.bad} out ${h.out}`); }
  ok(!bad.length, '40 random seeds x 300 frames: every ball finite, in the box, above the floor', bad.slice(0, 3).join('; '));
}
{
  const st = sceneOf(4242);
  const a = run(st, 4242, 200).map(b => [b.pos.x, b.pos.y, b.pos.z]), b = run(st, 4242, 200).map(b => [b.pos.x, b.pos.y, b.pos.z]);
  ok(a.length && a.every((p, i) => p.every((v, k) => v === b[i][k])), 'determinism: one seed gives the same ball positions after 200 frames');
}
{
  const st = sceneOf(5, { count: 1, launch: 'stack', radius: 0.1, mix: 0, e: 0.8, g: 10, obstacles: 0, subs: 8 });
  SC.build(U, st, K.rng(5)); const b = U.P.objects[0]; b.pos.set(0, 1.1, 0); b.vel.set(0, 0, 0);
  U.P.dt = H; let peak = 0, seenBounce = false;
  for (let f = 0; f < 120; f++) { SC.simulate(U); if (b.vel.y > 0) seenBounce = true; if (seenBounce) peak = Math.max(peak, b.pos.y - b.radius); }
  const want = 0.8 * 0.8 * 1.0;
  ok(seenBounce && Math.abs(peak - want) < 0.06, 'bounce: a ball dropped 1 m with e = 0.8 comes back to about e² = 0.64 m', `peak ${peak.toFixed(3)} m`);
}
{
  const st = sceneOf(6, { count: 2, launch: 'stack', radius: 0.15, mix: 0, e: 1, g: 0, obstacles: 0, collide: true, subs: 4, width: 4, depth: 4 });
  SC.build(U, st, K.rng(6)); const [a, b] = U.P.objects;
  a.pos.set(-0.6, 1, 0); b.pos.set(0.6, 1, 0); a.vel.set(2, 0, 0); b.vel.set(-1, 0, 0);
  const p0 = a.vel.x * a.radius ** 3 + b.vel.x * b.radius ** 3;
  U.P.dt = H; for (let f = 0; f < 40; f++) SC.simulate(U);
  const p1 = a.vel.x * a.radius ** 3 + b.vel.x * b.radius ** 3;
  ok(Math.abs(p1 - p0) < 1e-6 && a.vel.x < 0 && b.vel.x > 0, 'contacts: a head-on hit swaps the motion and keeps the momentum', `p ${p0.toFixed(5)} -> ${p1.toFixed(5)}`);
  const pile = run(sceneOf(7, { count: 20, launch: 'rain', collide: true, g: 10, e: 0.6, subs: 6, width: 2, depth: 2, radius: 0.12, mix: 0.3 }), 7, 360);
  let worst = 0;
  for (let i = 0; i < pile.length; i++) for (let j = i + 1; j < pile.length; j++) { const A = pile[i], B = pile[j]; const ov = A.radius + B.radius - A.pos.distanceTo(B.pos); if (ov > 0) worst = Math.max(worst, ov / Math.min(A.radius, B.radius)); }
  ok(worst < 0.02, 'contacts: after 6 s the pile of 20 has no overlap above 2 % of r', `worst ${(worst * 100).toFixed(2)} %`);
}
{
  const st = sceneOf(8, { obstacles: 5, obKind: 'mixed', count: 14, launch: 'throw' });
  const list = run(st, 8, 300); let inside = 0;
  for (const b of list) for (const o of SC.W.obs) {
    if (o.type === 'sphere') { if (b.pos.distanceTo(new U.THREE.Vector3(...o.c)) < o.r + b.radius - 0.01) inside++; }
    else if (Math.abs(b.pos.x - o.c[0]) < o.h[0] && Math.abs(b.pos.y - o.c[1]) < o.h[1] && Math.abs(b.pos.z - o.c[2]) < o.h[2]) inside++;
  }
  ok(SC.W.obs.length > 0 && !inside, 'obstacles: no ball ends inside an obstacle', `${SC.W.obs.length} obstacles, ${inside} inside`);
}
{
  let bad = 0;
  for (let s = 1; s <= 60; s++) { const st = sceneOf(s * 31), seed = s * 31, d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, seed)); if (d.seed !== seed || Object.keys(st).some(k => d.state[k] !== undefined && d.state[k] !== st[k])) bad++; }
  ok(!bad, 'hash: 60 random scenes round-trip through the share link');
}
{
  const shots = makeShots(), bad = [];
  for (const sh of shots) {
    const st = SC.guard(Object.assign(sceneOf(1234), sh.scene(K.rng(99), sceneOf(1234))));
    const h = health(run(st, 77, 240), st), cam = sh.camera(K.rng(3));
    if (h.bad || h.out || !['az', 'el', 'r'].every(k => Number.isFinite(cam[k]))) bad.push(sh.key);
  }
  ok(!bad.length, `saver: all ${shots.length} shots build a stable scene with a finite camera`, bad.join(' '));
  const plan = K.planShots(shots, 2024, 60);
  let rep = 0, len = 0;
  for (let i = 0; i < plan.length; i++) { if (i && plan[i].key === plan[i - 1].key) rep++; if (!(plan[i].sec >= 6 && plan[i].sec <= 12)) len++; }
  ok(!rep && !len, 'saver: 60 cuts, no shot twice in a row, every cut 6-12 s', `repeats ${rep}, bad lengths ${len}`);
}
done();

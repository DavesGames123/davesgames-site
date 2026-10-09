// ============================================================================
//  CLOTH TESTS  ·  node stella-nova/pages/cloth/tests.mjs
// ----------------------------------------------------------------------------
//  The upstream main.js runs in a node vm (../soft-bodies/test-vm.mjs:
//  real three.js objects, no WebGL). The scene build, wind and obstacle
//  wraps are the page's own scene.js and ../soft-bodies/stage3d.js.
//    random      N seeds of the randomizer (with the guard) run 90
//                frames: every particle finite, above the floor, in the
//                world. N = 4; CL_FULL=1 runs 40.
//    determinism one seed, one scene, one result
//    pins        each pin pattern pins particles that stay where they are
//    drape       a flat sheet dropped on a sphere covers it: no particle
//                inside, the cloth top sits on the sphere top
//    wind        a hanging sheet in wind billows downwind of a still one
//    hash        every control round-trips through the share link
//    saver       every shot builds a stable scene; the plan has no
//                back-to-back repeats and 6-12 s cuts
// ============================================================================
import { loadUpstream, reporter } from '../soft-bodies/test-vm.mjs';
import * as SC from './scene.js';
import * as S3 from '../soft-bodies/stage3d.js';
import { makeShots } from './shots.js';
import * as K from '../../widgets/sim-kit/core.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { ok, done } = reporter();
const SCHEMA = K.normalize(SC.makeSchema(false));
const VM = loadUpstream(HERE);
const U = { THREE: VM.ctx.THREE, scene: VM.ctx.gThreeScene, P: VM.ctx.gPhysicsScene, Cloth: VM.lex('Cloth'), meshes: VM.ctx.meshes };
SC.install(U);
// Drawing is not tested: skip the per-frame normals of the upstream mesh update.
U.Cloth.prototype.updateMeshes = function () {};
const H = 1 / 60;
const sceneOf = (seed, over = {}) => SC.guard(Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SC.guard }).state, over));
function build(st, seed) { SC.W.t = 0; return SC.build(U, st, K.rng((seed ^ 0x2545f491) >>> 0)); }
function run(st, seed, frames) { build(st, seed); U.P.dt = H; for (let f = 0; f < frames; f++) SC.simulate(U); return U.P.objects[0]; }
function health(b) {
  let bad = 0, below = 0, out = 0;
  for (let i = 0; i < b.numParticles; i++) {
    const x = b.pos[3 * i], y = b.pos[3 * i + 1], z = b.pos[3 * i + 2];
    if (!Number.isFinite(x + y + z)) bad++; else { if (y < -0.03) below++; if (Math.abs(x) > 20 || Math.abs(z) > 20 || y > 20) out++; }
  }
  return { bad, below, out };
}

{
  const N = process.env.CL_FULL ? 40 : 4, bad = [];
  for (let s = 1; s <= N; s++) {
    const seed = s * 7919, st = sceneOf(seed), h = health(run(st, seed, 90));
    if (h.bad || h.below || h.out) bad.push(`seed ${seed} ${st.start}/${st.pins} bend ${st.bendC} wind ${st.wind} subs ${st.subs}: NaN ${h.bad} below ${h.below} out ${h.out}`);
  }
  ok(!bad.length, `random: ${N} seeds x 90 frames stay finite, above the floor and in the world`, bad.slice(0, 3).join('; '));
}
{
  const st = sceneOf(4242);
  const a = Array.from(run(st, 4242, 40).pos), b = Array.from(run(st, 4242, 40).pos);
  ok(a.every((v, k) => v === b[k]), 'determinism: one seed gives the same particle positions after 40 frames');
}
{
  const bad = [];
  for (const pins of ['corners', 'top', 'one', 'three', 'left', 'center']) {
    const st = sceneOf(5, { start: 'hang', pins, wind: 0, obstacles: 0 });
    const info = build(st, 5), c = U.P.objects[0];
    const fixed = []; for (let i = 0; i < c.numParticles; i++) if (c.invMass[i] === 0) fixed.push([i, c.pos[3 * i], c.pos[3 * i + 1], c.pos[3 * i + 2]]);
    U.P.dt = H; for (let f = 0; f < 30; f++) SC.simulate(U);
    const moved = fixed.filter(([i, x, y, z]) => Math.hypot(c.pos[3 * i] - x, c.pos[3 * i + 1] - y, c.pos[3 * i + 2] - z) > 1e-9).length;
    if (!info.pinned || moved || !fixed.length) bad.push(`${pins}: ${fixed.length} pinned, ${moved} moved`);
  }
  ok(!bad.length, 'pins: every pin pattern pins particles and they stay put', bad.join('; '));
}
{
  const st = sceneOf(8, { start: 'drop', pins: 'none', obstacles: 0, wind: 0, size: 1.4, height: 0.3, bendC: 1, stretchC: 0, subs: 15, g: 10, fric: 0.6 });
  build(st, 8);
  SC.W.obs = [{ type: 'sphere', c: [0, 0.25, 0], r: 0.25, v: [0, 0, 0] }];
  const c = U.P.objects[0];
  // lift the flat sheet over the sphere
  for (let i = 0; i < c.numParticles; i++) { c.pos[3 * i + 1] = 0.62; c.prevPos[3 * i + 1] = 0.62; }
  U.P.dt = H;
  let inside = 0;
  for (let f = 0; f < 110; f++) { SC.simulate(U); for (let i = 0; i < c.numParticles; i += 5) if (Math.hypot(c.pos[3 * i], c.pos[3 * i + 1] - 0.25, c.pos[3 * i + 2]) < 0.25 - 0.004) inside++; }
  let top = 0; for (let i = 0; i < c.numParticles; i++) top = Math.max(top, c.pos[3 * i + 1]);
  ok(inside === 0 && top > 0.5 && top < 0.56, 'drape: a sheet dropped on a sphere covers it, no particle inside', `inside ${inside}, top ${top.toFixed(3)} m (sphere top 0.50 + pad)`);
}
{
  // the hanging sheet lies in the x-y plane: wind along +z blows it out
  const hang = w => { const c = run(sceneOf(9, { start: 'hang', pins: 'top', wind: w, windDir: 90, gust: 0, obstacles: 0, bendC: 1 }), 9, 60); return S3.centroid([c]); };
  const a = hang(0), b = hang(8), dz = (b[2] - a[2]);
  ok(dz > 0.05, 'wind: a sheet in wind along +z billows downwind', `centroid z still ${a[2].toFixed(3)}, in wind ${b[2].toFixed(3)}`);
}
{
  let bad = 0;
  for (let s = 1; s <= 60; s++) {
    const st = sceneOf(s * 31), seed = s * 31, d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, seed));
    if (d.seed !== seed || Object.keys(st).some(k => d.state[k] !== undefined && d.state[k] !== st[k])) bad++;
  }
  ok(!bad, 'hash: 60 random scenes round-trip through the share link');
}
{
  const shots = makeShots({ release: () => SC.release(U), later: (s, f) => f() });
  const bad = [];
  for (const sh of shots) {
    const st = SC.guard(Object.assign(sceneOf(1234), sh.scene(K.rng(99), sceneOf(1234))));
    build(st, 77); if (sh.start) sh.start();
    U.P.dt = H; for (let f = 0; f < 50; f++) SC.simulate(U);
    const h = health(U.P.objects[0]), cam = sh.camera(K.rng(3));
    if (h.bad || h.below || h.out || !['az', 'el', 'r'].every(k => Number.isFinite(cam[k]))) bad.push(`${sh.key} (NaN ${h.bad} below ${h.below} out ${h.out})`);
  }
  ok(!bad.length, `saver: all ${shots.length} shots build a stable scene with a finite camera`, bad.join(' '));
  const plan = K.planShots(shots, 2024, 60);
  let rep = 0, len = 0;
  for (let i = 0; i < plan.length; i++) { if (i && plan[i].key === plan[i - 1].key) rep++; if (!(plan[i].sec >= 6 && plan[i].sec <= 12)) len++; }
  ok(!rep && !len, 'saver: 60 cuts, no shot twice in a row, every cut 6-12 s', `repeats ${rep}, bad lengths ${len}`);
}
done();

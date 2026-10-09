// ============================================================================
//  CLOTH SELF COLLISION TESTS  ·  node stella-nova/pages/cloth-self-collision/tests.mjs
// ----------------------------------------------------------------------------
//  The upstream main.js runs in a node vm (../soft-bodies/test-vm.mjs:
//  real three.js objects, no WebGL). The build, wind and obstacle wrap are
//  the page's own scene.js and ../soft-bodies/stage3d.js.
//    random      N seeds of the randomizer (with the guard) run 120
//                frames: every particle finite, above the floor, in the
//                world. N = 4; CS_FULL=1 runs 30.
//    determinism one seed (the upstream jitter is seeded), one result
//    self        a strip that piles keeps its layers apart: with self
//                collision on, far fewer close non-neighbour pairs than off
//    obstacles   no particle ends inside an obstacle
//    hash        every control round-trips through the share link
//    guard       particles and particles x substeps stay in the budget
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
const U = { THREE: VM.ctx.THREE, scene: VM.ctx.gThreeScene, P: VM.ctx.gPhysicsScene, Cloth: VM.lex('Cloth'), Math: VM.lex('Math') };
SC.install(U);
U.Cloth.prototype.updateVisMeshes = function () {};
const H = 1 / 60;
const sceneOf = (seed, over = {}) => SC.guard(Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SC.guard }).state, over));
function build(st, seed) { SC.W.t = 0; return SC.build(U, st, K.rng((seed ^ 0x2545f491) >>> 0)); }
function run(st, seed, frames) { build(st, seed); U.P.dt = H; for (let f = 0; f < frames; f++) SC.simulate(U); return U.P.cloth; }
function health(c) {
  let bad = 0, below = 0, out = 0;
  for (let i = 0; i < c.numParticles; i++) {
    const x = c.pos[3 * i], y = c.pos[3 * i + 1], z = c.pos[3 * i + 2];
    if (!Number.isFinite(x + y + z)) bad++; else { if (y < -0.02) below++; if (Math.abs(x) > 20 || Math.abs(z) > 20 || y > 20) out++; }
  }
  return { bad, below, out };
}
// Pairs closer than half the thickness that were far apart at rest.
function overlaps(c) {
  const h = c.thickness * 0.5, cell = new Map(), key = (x, y, z) => `${Math.floor(x / h)},${Math.floor(y / h)},${Math.floor(z / h)}`;
  for (let i = 0; i < c.numParticles; i++) { const k = key(c.pos[3 * i], c.pos[3 * i + 1], c.pos[3 * i + 2]); (cell.get(k) || cell.set(k, []).get(k)).push(i); }
  let n = 0;
  for (const ids of cell.values()) for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
    const i = ids[a], j = ids[b];
    const rest = Math.hypot(c.restPos[3 * i] - c.restPos[3 * j], c.restPos[3 * i + 1] - c.restPos[3 * j + 1], c.restPos[3 * i + 2] - c.restPos[3 * j + 2]);
    if (rest > 3 * c.thickness) n++;
  }
  return n;
}

{
  const N = process.env.CS_FULL ? 30 : 4, bad = [];
  for (let s = 1; s <= N; s++) {
    const seed = s * 7919, st = sceneOf(seed), h = health(run(st, seed, 120));
    if (h.bad || h.below || h.out) bad.push(`seed ${seed} ${st.start} ${st.nx}x${st.ny}: NaN ${h.bad} below ${h.below} out ${h.out}`);
  }
  ok(!bad.length, `random: ${N} seeds x 120 frames stay finite, above the floor and in the world`, bad.slice(0, 3).join('; '));
}
{
  const st = sceneOf(4242, { nx: 20, ny: 80 });
  const a = Array.from(run(st, 4242, 40).pos), b = Array.from(run(st, 4242, 40).pos);
  ok(a.every((v, k) => v === b[k]), 'determinism: one seed gives the same particle positions after 40 frames (seeded jitter)');
}
{
  const base = { start: 'strip', pins: 'none', nx: 20, ny: 160, spacing: 0.01, height: 0.1, obstacles: 0, wind: 0, subs: 10, g: 10, bendC: 1 };
  const on = overlaps(run(sceneOf(3, Object.assign({}, base, { selfColl: true })), 3, 150));
  const off = overlaps(run(sceneOf(3, Object.assign({}, base, { selfColl: false })), 3, 150));
  ok(off > 20 && on < off * 0.2, 'self: with self collision the pile keeps its layers apart', `close far pairs: on ${on}, off ${off}`);
}
{
  const st = sceneOf(12, { start: 'sheet', obstacles: 2, obKind: 'spheres', nx: 30, ny: 60, pins: 'none', fric: 0.6 });
  run(st, 12, 120);
  const c = U.P.cloth; let inside = 0;
  for (const o of SC.W.obs) for (let i = 0; i < c.numParticles; i++) if (o.type === 'sphere' && Math.hypot(c.pos[3 * i] - o.c[0], c.pos[3 * i + 1] - o.c[1], c.pos[3 * i + 2] - o.c[2]) < o.r - 0.003) inside++;
  ok(SC.W.obs.length > 0 && inside === 0, 'obstacles: a sheet on spheres ends with no particle inside', `${SC.W.obs.length} spheres, ${inside} inside`);
}
{
  let bad = 0;
  for (let s = 1; s <= 60; s++) {
    const st = sceneOf(s * 31), seed = s * 31, d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, seed));
    if (d.seed !== seed || Object.keys(st).some(k => d.state[k] !== undefined && d.state[k] !== st[k])) bad++;
  }
  ok(!bad, 'hash: 60 random scenes round-trip through the share link');
  let over = 0;
  for (let s = 1; s <= 200; s++) { const st = sceneOf(s * 13); if (st.nx * st.ny > 6000 || st.nx * st.ny * st.subs > 60000) over++; const p = SC.guard(Object.assign({}, st, { nx: 50, ny: 200 }), null, null, 2500); if (p.nx * p.ny > 2500) over++; }
  ok(!over, 'guard: 200 scenes stay inside 6000 particles and 60000 particle-substeps; phone cap 2500 holds');
}
{
  const shots = makeShots({ lift: () => SC.lift(U), later: (s, f) => f() });
  const bad = [];
  for (const sh of shots) {
    const st = SC.guard(Object.assign(sceneOf(1234), sh.scene(K.rng(99), sceneOf(1234))));
    build(st, 77); if (sh.start) sh.start();
    U.P.dt = H; for (let f = 0; f < 60; f++) SC.simulate(U);
    const h = health(U.P.cloth), cam = sh.camera(K.rng(3));
    if (h.bad || h.below || h.out || !['az', 'el', 'r'].every(k => Number.isFinite(cam[k]))) bad.push(`${sh.key} (NaN ${h.bad} below ${h.below} out ${h.out})`);
  }
  ok(!bad.length, `saver: all ${shots.length} shots build a stable scene with a finite camera`, bad.join(' '));
  const plan = K.planShots(shots, 2024, 60);
  let rep = 0, len = 0;
  for (let i = 0; i < plan.length; i++) { if (i && plan[i].key === plan[i - 1].key) rep++; if (!(plan[i].sec >= 6 && plan[i].sec <= 12)) len++; }
  ok(!rep && !len, 'saver: 60 cuts, no shot twice in a row, every cut 6-12 s', `repeats ${rep}, bad lengths ${len}`);
}
done();

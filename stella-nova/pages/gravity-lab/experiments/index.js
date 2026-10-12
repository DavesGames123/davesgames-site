// ============================================================================
//  GRAVITY LAB  ·  experiments/index.js — the library of experiments
// ----------------------------------------------------------------------------
//  EXPERIMENTS  the registry, in menu order (key -> experiment)
//  build(key, seed, o)     one spec (common.js "THE SPEC"); o.variant picks
//                          a variant, else the seed picks one
//  randomSpec(seed, o)     a random experiment and variant from one seed
//  bag(seed)               every [key, variant] pair once, in a seeded
//                          shuffle (the screensaver draws from it, so each
//                          run differs and nothing repeats until all ran)
//  runChecks({ ok, only }) the tests (tests.mjs): the shape of every spec
//                          of every variant, the seed rules, then each
//                          experiment's own physics check on the CPU
//
//  FILES
//    common.js    the spec, builders (Parts, disk, halo, body), runCpu
//    orbits.js    kepler, transfers, slingshot, solar, hill
//    points.js    lagrange, horseshoe, trojans
//    threebody.js choreography, pythagorean, sitnikov, kozai, triton
//    systems.js   circumbinary, resonance, flyby, rings, sl9
//    extreme.js   galaxies, blackhole, tde, disk
// ============================================================================
import { kepler, transfers, slingshot, solar, hill } from './orbits.js';
import { lagrange, horseshoe, trojans } from './points.js';
import { choreography, pythagorean, sitnikov, kozai, triton } from './threebody.js';
import { circumbinary, resonance, flyby, rings, sl9 } from './systems.js';
import { galaxies, blackhole, tde, diskGI } from './extreme.js';
import { rng } from './common.js';
import { MAXB } from '../nbody.js';
import { MAX_S } from '../lab.js';
import { SOURCES } from '../data.js';

const LIST = [galaxies, choreography, pythagorean, tde, sl9, rings, lagrange, horseshoe, trojans, slingshot, kepler, transfers,
  circumbinary, resonance, kozai, flyby, triton, blackhole, diskGI, sitnikov, hill, solar];
export const EXPERIMENTS = Object.fromEntries(LIST.map(x => [x.key, x]));
export const GROUPS = {
  orbits: 'Orbits', points: 'Lagrange points', 'three-body': 'Three bodies', systems: 'Planets and moons',
  galaxies: 'Galaxies', 'black-holes': 'Black holes', disks: 'Disks',
};

export function build(key, seed = 1, o = {}) {
  const X = EXPERIMENTS[key];
  if (!X) throw new Error('no experiment ' + key);
  return X.build(seed >>> 0, o);
}
export function randomSpec(seed, o = {}) {
  const r = rng(seed ^ 0x51ed27);
  const X = LIST[Math.floor(r() * LIST.length) % LIST.length];
  const variant = X.variants[Math.floor(r() * X.variants.length) % X.variants.length];
  return X.build((seed * 2654435761) >>> 0, Object.assign({ variant }, o));
}
export function bag(seed) {
  const all = [];
  for (const X of LIST) for (const v of X.variants) all.push([X.key, v]);
  const r = rng(seed ^ 0x2b0f);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  // no experiment twice in a row
  for (let i = 1; i < all.length; i++) if (all[i][0] === all[i - 1][0]) { const j = all.findIndex((p, k) => k > i && p[0] !== all[i][0] && (k + 1 >= all.length || all[k + 1][0] !== all[i][0]) && all[k - 1][0] !== all[i][0]); if (j > 0) [all[i], all[j]] = [all[j], all[i]]; }
  return all;
}

// ── tests ───────────────────────────────────────────────────────────────────
export function shapeErrors(spec, n) {
  const err = [], fin = x => typeof x === 'number' && isFinite(x);
  if (!spec.key || !spec.title || !spec.blurb) err.push('key, title or blurb missing');
  if (!(spec.dt > 0) || !(spec.rate > 0) || !(spec.duration > 0)) err.push('dt, rate or duration not positive');
  if (spec.rate / 60 / spec.dt > MAX_S) err.push(`Normal speed needs ${Math.ceil(spec.rate / 60 / spec.dt)} steps per frame (max ${MAX_S})`);
  if (!spec.view || !(spec.view.extent > 0)) err.push('view.extent');
  if (!(spec.tex && spec.tex.length) || !(spec.facts && spec.facts.length) || !(spec.notes && spec.notes.length)) err.push('tex, facts or notes empty');
  for (const s of spec.sources || []) if (!SOURCES[s]) err.push('unknown source ' + s);
  const B = spec.bodies || [];
  if (B.length > MAXB) err.push('too many bodies');
  B.forEach((b, i) => {
    if (!b.name || !b.kind || !Array.isArray(b.color)) err.push(`body ${i}: name, kind or color`);
    if (![b.m, b.r, b.rDraw, ...b.x, ...b.v].every(fin) || b.m < 0) err.push(`body ${i} (${b.name}): not finite`);
  });
  const P = spec.self || spec.particles;
  if (!P) err.push('no particles');
  else {
    if (P.n > n + 1) err.push(`${P.n} particles over the budget ${n}`);
    if (P.pos.length !== 3 * P.n || P.vel.length !== 3 * P.n) err.push('particle arrays');
    for (let k = 0; k < 3 * P.n; k++) if (!fin(P.pos[k]) || !fin(P.vel[k])) { err.push('particle not finite at ' + Math.floor(k / 3)); break; }
    if (P.group) { const ng = (P.groups || []).length; for (let i = 0; i < P.n; i++) if (P.group[i] >= ng) { err.push('group index past groups'); break; } }
    if (spec.self && !(spec.self.eps > 0)) err.push('self-gravity needs eps > 0');
  }
  if ((spec.pool || 0) + (P ? P.n : 0) > n + 1) err.push('pool + particles over the budget');
  return err;
}
export async function runChecks({ ok, only = null, log = console.log }) {
  const list = only ? LIST.filter(x => x.key === only) : LIST;
  // shapes: every variant at two budgets, two seeds
  let specs = 0, bad = [];
  for (const X of list) for (const v of X.variants) for (const n of [16384, 4096]) for (const seed of [1, 99]) {
    const s = X.build(seed, { n, variant: v }); specs++;
    for (const e of shapeErrors(s, n)) bad.push(`${X.key}/${v}/${n}/${seed}: ${e}`);
  }
  ok('experiments: every spec well formed (finite, budget, groups, steps per frame, sources)', bad.length === 0, `${specs} specs from ${list.length} experiments; ${bad.slice(0, 4).join(' | ') || 'no errors'}`);
  if (!only) {
    const a = JSON.stringify(Array.from(randomSpec(7, { n: 512 }).bodies.map(b => b.x))), b = JSON.stringify(Array.from(randomSpec(7, { n: 512 }).bodies.map(b => b.x)));
    const keys = new Set(); for (let s = 1; s <= 40; s++) keys.add(randomSpec(s, { n: 256 }).key);
    const b1 = bag(3), b2 = bag(4), b3 = bag(3);
    let rep = 0; for (let i = 1; i < b1.length; i++) if (b1[i][0] === b1[i - 1][0]) rep++;
    ok('experiments: seeded (same seed same run), varied (40 seeds), shuffle bag', a === b && keys.size >= 12 && JSON.stringify(b1) === JSON.stringify(b3) && JSON.stringify(b1) !== JSON.stringify(b2) && rep === 0,
      `${keys.size} experiments from 40 seeds; bag of ${b1.length} variants, ${rep} back-to-back repeats`);
  }
  // physics: each experiment's own check, each variant, seed 1
  for (const X of list) for (const v of X.variants) {
    const t0 = Date.now(), spec = X.build(1, { n: X.test.n, variant: v });
    let res; try { res = X.check(spec); } catch (e) { res = { pass: false, info: String(e && e.stack || e) }; }
    ok(`${X.key}/${v}: ${X.title}`, res.pass, `${res.info} [${Date.now() - t0} ms]`);
  }
}

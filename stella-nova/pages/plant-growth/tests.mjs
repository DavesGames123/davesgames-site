// ============================================================================
//  PLANT GROWTH  ·  node tests for the DOM-free modules
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/plant-growth/tests.mjs   (exit 1 on a failure)
//  Covers grow.js (growth over time, buds, Borchert-Honda, shedding in
//  shade, pipe model, leaf counts, competition), season.js (the calendar
//  and its GLSL copy), pose.js (packing, frames, the CPU twin), mesh.js,
//  ground.js (micro-relief, pads), eco.js (the ground ecosystem: Ripley's
//  L for drifts, tussocks and outcrops, the hard core of large stones, the
//  power law of stone sizes, the shade response, grass and flower seasons,
//  leaf litter, gusts, seedling survival, real-world scale, phone caps),
//  roots.js (DLA roots and their GPU rows), saver.js and layout.js (phone
//  layout, occlusion, gestures, dock clock). The DOM and CSS checks at
//  phone viewports are in dom-check.mjs (needs jsdom); glsl-check.mjs
//  compiles the shaders (needs glslangValidator).
//  Set PG_QUICK=1 to skip the full lives of all species, PG_VERBOSE=1 to
//  print each check that passes.
// ============================================================================
import { SPECIES, SPECIES_IDS, TREE_IDS, createSim, growLife, standLayout, internode, LEAF_STRIDE, OPEN, KIND } from './grow.js';
import { CAL, leafState, seasonOf, snowCover, girthPhase, deathDrop, deathFade, SEASON_GLSL } from './season.js';
import { COLOUR_MODES, COLOUR_IDS, createHistory, addToHistory, packYear, nodeFrames, nodeShown, leafPose, quatRotate, frameQuat, CELLS, cellIndex, speciesTables, TEX_W } from './pose.js';
import { plantMesh } from './mesh.js';
import { groundY, FLAT_R, inCutaway, GROUND_GLSL, setPads, relief, RELIEF_AMP, PAD_RISE } from './ground.js';
import * as E from './eco.js';
import { createRoots, packRoots } from './roots.js';
import { makeShots, shotPlan, bandFrame, fitDistance, projectedRadius, codeExtract, SHOT_KINDS, meadowCamera } from './saver.js';
import { ATLAS_CELLS } from './atlas.js';
import { LOOK, BARKS } from './look.js';
import { rng } from '../../lib/dla-engine.js';
import { PHONE_QUERY, layoutFor, occlusion, clearFractions, createGestures, dockClock, nextId, pixelRatioStep, ecoLimits, ECO_LIMITS } from './layout.js';
import fs from 'node:fs';

let pass = 0, fail = 0;
const VERBOSE = !!process.env.PG_VERBOSE;
const ok = (c, msg, why) => { if (c) { pass++; if (VERBOSE) console.log('ok  ', msg); } else { fail++; console.log('FAIL', msg, why || ''); } };
const finite = (a, n = a.length) => { for (let i = 0; i < n; i++) if (!Number.isFinite(a[i])) return false; return true; };
const QUICK = !!process.env.PG_QUICK;

// --- one oak, year by year ---------------------------------------------------
const oak = createSim({ species: 'oak', seed: 11 });
const oakYears = [];
{
  let prevCount = 0, prevH = 0, monoCount = true, monoH = true;
  while (!oak.done) {
    oak.stepYear();
    const Y = oak.year - 1, st = oak.stats[Y];
    let h = 0; for (let i = 0; i < oak.count; i++) if (!oak.dead[i]) h = Math.max(h, oak.py[i]);
    oakYears.push({ Y, count: oak.count, live: st.live, h, leaves: st.leaves, buds: st.buds, shed: st.shed });
    if (oak.count < prevCount) monoCount = false;
    if (h < prevH - 0.3) monoH = false;      // shedding may drop a stray top twig
    prevCount = oak.count; prevH = Math.max(prevH, h);
  }
  ok(monoCount, 'growth over time: the node count never falls');
  ok(monoH, 'growth over time: the height never falls by more than a twig');
  const y5 = oakYears[5], y15 = oakYears[15], yEnd = oakYears[oakYears.length - 1];
  ok(oakYears[0].h < 0.4 && oakYears[0].count < 12, `year 1 is a seedling (${oakYears[0].h.toFixed(2)} m, ${oakYears[0].count} nodes)`);
  ok(y5.h > oakYears[1].h && y15.h > y5.h * 1.6 && yEnd.h >= y15.h, `the oak grows taller (${oakYears[1].h.toFixed(2)}, ${y5.h.toFixed(2)}, ${y15.h.toFixed(2)}, ${yEnd.h.toFixed(2)} m)`);
  ok(yEnd.h > 8 && yEnd.h < SPECIES.oak.size.h * 1.3, `a mature oak is tree sized (${yEnd.h.toFixed(1)} m)`);
  ok(oakYears.every(r => r.buds > 0), 'there are buds every year');
  let maxLeaves = 0; for (const r of oakYears) maxLeaves = Math.max(maxLeaves, r.leaves);
  ok(maxLeaves >= 40000, `tens of thousands of leaves at maturity (${maxLeaves})`);
  let branches = 0; for (let i = 0; i < oak.count; i++) if (!oak.dead[i] && oak.order[i] >= 1) branches++;
  ok(branches > 5000, `many live lateral branches (${branches} metamers of order >= 1)`);
  const shedTotal = oakYears.reduce((a, r) => a + r.shed, 0);
  ok(shedTotal > 100, `branches are shed (${shedTotal})`);
  // radius per year: never shrinks; parent never thinner than child
  let mono = true;
  for (let y = 1; y < oak.radHist.length; y++) {
    const a = oak.radHist[y - 1], b = oak.radHist[y];
    for (let i = 0; i < a.length; i += 7) if (b[i] + 1e-7 < a[i]) { mono = false; break; }
  }
  ok(mono, 'secondary growth: no radius ever shrinks from one year to the next');
  let pipeOk = true;
  for (let i = 1; i < oak.count; i++) { const p = oak.parent[i]; if (!oak.dead[i] && oak.radius[p] + 1e-7 < oak.radius[i]) { pipeOk = false; break; } }
  ok(pipeOk, 'pipe model: a parent is never thinner than its child');
  ok(finite(oak.px, oak.count) && finite(oak.py, oak.count) && finite(oak.radius, oak.count), 'no NaN in positions and radii');
  // metamers grow at the tip, one after another
  let seq = true;
  for (let i = 1; i < oak.count; i++) { const p = oak.parent[i]; if (oak.born[i] + 1e-6 < oak.born[p]) { seq = false; break; } }
  ok(seq, 'a metamer is never born before its parent');
  const b2 = createSim({ species: 'oak', seed: 11 }); while (!b2.done) b2.stepYear();
  ok(b2.count === oak.count && b2.px[b2.count - 1] === oak.px[oak.count - 1], 'the same seed gives the same plant');
}

// --- Borchert-Honda and the light grid ---------------------------------------
{
  const s = createSim({ species: 'maple', seed: 4 });
  for (let k = 0; k < 9; k++) s.stepYear();
  s.allocate();
  const buds = s.buds(), root = s.plants[0].root;
  let sumV = 0; for (const b of buds) sumV += b.v;
  const vBase = s.vigor[root];
  ok(Math.abs(sumV - vBase) / vBase < 1e-3, `allocation conserves the resource (${sumV.toFixed(2)} of ${vBase.toFixed(2)})`);
  // the leader bud gets more than the average lateral bud (apical dominance)
  let lead = null; for (const b of buds) if (b.term && s.order[b.node] === 0) lead = b;
  const lat = buds.filter(b => !b.term && b.q > 0.2);
  const meanLat = lat.reduce((a, b) => a + b.v, 0) / Math.max(1, lat.length);
  ok(lead && lead.v > meanLat * 2, `the leader gets more resource (${lead && lead.v.toFixed(2)} vs mean lateral ${meanLat.toFixed(2)})`);
  // light: the top is bright, deep inside is dark
  let top = 0; for (let i = 0; i < s.count; i++) if (!s.dead[i] && s.py[i] > s.py[top]) top = i;
  let lo = 1; for (let i = 0; i < s.count; i++) if (!s.dead[i]) lo = Math.min(lo, s.light[i]);
  ok(s.light[top] > 0.6 && lo < 0.3, `light: top ${s.light[top].toFixed(2)}, inside ${lo.toFixed(2)}`);
  ok(s.exposure(0, 50, 0, 0) === 1, 'light above the crown is full');
}
// shedding happens in shade: the shed branches had less light than the rest
{
  const s = createSim({ species: 'oak', seed: 2 });
  let shedLight = 0, shedN = 0, liveLight = 0, liveN = 0;
  for (let y = 0; y < 22; y++) {
    const before = new Uint8Array(s.count); for (let i = 0; i < s.count; i++) before[i] = s.dead[i];
    const lt = s.light.slice(0, s.count);
    s.stepYear();
    for (let i = 0; i < before.length; i++) {
      if (before[i]) continue;
      if (s.dead[i]) { shedLight += lt[i]; shedN++; } else { liveLight += lt[i]; liveN++; }
    }
  }
  ok(shedN > 50, `branches were shed (${shedN} metamers)`);
  ok(shedLight / shedN < 0.6 * liveLight / liveN, `shed metamers were in shade (light ${(shedLight / shedN).toFixed(3)} vs ${(liveLight / liveN).toFixed(3)})`);
}

// --- species --------------------------------------------------------------------
const lives = {};
for (const id of QUICK ? ['conifer', 'willow', 'fern', 'cherry', 'bush'] : SPECIES_IDS) {
  const s = growLife(id, { seed: 5 });
  lives[id] = s;
  const sp = SPECIES[id];
  let h = 0, w = 0;
  for (let i = 0; i < s.count; i++) if (!s.dead[i]) { h = Math.max(h, s.py[i]); w = Math.max(w, Math.hypot(s.px[i], s.pz[i])); }
  let maxLeaves = 0; for (const st of s.stats) maxLeaves = Math.max(maxLeaves, st.leaves);
  const target = sp.form === 'tree' ? 25000 : sp.form === 'shrub' ? 15000 : 400;
  ok(s.done && s.year === sp.years, `${id}: lives ${sp.years} years`);
  ok(maxLeaves >= target, `${id}: leaves reach ${target} (${maxLeaves})`);
  ok(h > sp.size.h * 0.55 && h < sp.size.h * 1.35, `${id}: height ${h.toFixed(1)} m near ${sp.size.h} m`);
  ok(finite(s.px, s.count) && finite(s.radius, s.count), `${id}: no NaN`);
  ok(s.stats.every(st => st.live <= 60000 * 1.35), `${id}: live metamers stay near the budget`);
  if (sp.flower) {
    let fl = 0; for (let k = 0; k < s.leafCount; k++) if ((s.leaves[k * LEAF_STRIDE + 7] & 3) === KIND.flower) fl++;
    ok(fl > 50, `${id}: flowers (${fl})`);
  }
  let coty = 0; for (let k = 0; k < s.leafCount; k++) if ((s.leaves[k * LEAF_STRIDE + 7] & 3) === KIND.cotyledon) coty++;
  ok(sp.form === 'fern' ? coty === 0 : coty >= 2, `${id}: cotyledons ${coty}`);
  ok(s.yearOff.length === sp.years + 1 && s.yearOff[sp.years] === s.count, `${id}: node ids grow year by year`);
}
{
  // the crown radius: the 90th percentile reach of the leafy metamers
  const width = s => { const r = []; let h = 0; for (let i = 0; i < s.count; i++) if (!s.dead[i]) { if (s.leafy[i]) r.push(Math.hypot(s.px[i], s.pz[i])); h = Math.max(h, s.py[i]); } r.sort((a, b) => a - b); return { w: r[Math.floor(r.length * 0.9)] || 1, h }; };
  const c = width(lives.conifer), wl = lives.willow;
  ok(c.h / c.w > 1.8, `spruce is slender (h / crown radius ${(c.h / c.w).toFixed(2)})`);
  let hang = 0; for (let i = 0; i < wl.count; i++) if (!wl.dead[i] && wl.dy[i] < -0.8) hang++;
  ok(hang > 2000, `willow shoots hang (${hang} downward metamers)`);
  const f = lives.fern; let fronds = 0; for (let i = 0; i < f.count; i++) if (f.parent[i] === f.plants[0].root && f.year0[i] === f.year - 1) fronds++;
  ok(fronds >= 10, `fern grows ${fronds} fronds from one crown`);
  const bush = lives.bush; let stems = 0; for (let i = 0; i < bush.count; i++) if (bush.parent[i] === bush.plants[0].root && !bush.dead[i]) stems++;
  ok(stems >= 4, `azalea has ${stems} stems from the base`);
}
// competition: a grove shares one light grid; the plants shade each other
{
  const lay = standLayout('grove', 'birch', 3);
  ok(lay.length === 5 && lay[0].x === 0, 'a grove has five plants');
  const mix = standLayout('mixed', 'oak', 3);
  ok(mix.length === 9 && new Set(mix.map(p => p.species)).size >= 3, 'a woodland edge mixes species');
  const g = createSim({ species: 'birch', stand: 'grove', seed: 3, years: 18 });
  while (!g.done) g.stepYear();
  const solo = createSim({ species: 'birch', seed: g.plants[0].rand ? 3 : 3, years: 18, plants: [{ species: 'birch', x: 0, z: 0, seed: lay[0].seed }] });
  while (!solo.done) solo.stepYear();
  const width0 = s => { let w = 0; for (let i = 0; i < s.count; i++) if (!s.dead[i] && s.plant[i] === 0) w = Math.max(w, Math.hypot(s.px[i], s.pz[i])); return w; };
  ok(width0(g) < width0(solo), `a tree in a grove has a narrower crown (${width0(g).toFixed(2)} vs ${width0(solo).toFixed(2)} m)`);
}

// --- the calendar ------------------------------------------------------------
{
  const ph = SPECIES.oak.pheno, rec = { kind: 0, y0: 3, y1: OPEN, rand: 0.5, nodeBorn: 3.28, ever: false, falls: true };
  const at = t => leafState(ph, rec, t, {});
  ok(at(3.1).show === 0, 'winter before the bud break: no leaf');
  ok(at(3.31).show > 0 && at(3.31).show < 1, 'spring: the leaf unfolds');
  ok(at(3.5).show === 1 && at(3.5).colour === 0 && at(3.5).fall < 0, 'summer: a full green leaf on the twig');
  const au = at(3 + ph.col + 0.06);
  ok(au.colour > 0.3 && au.fall < 0, 'autumn: the colour turns before the leaf falls');
  const fa = at(3 + ph.fall + CAL.FALL_SPREAD * 0.5 + CAL.FALL_DUR * 0.5);
  ok(fa.fall > 0 && fa.fall < 1, 'leaf fall: the leaf is in the air');
  const gr = at(3.95);
  ok(gr.fall === 1 && gr.litter === 1, 'late autumn: the leaf lies on the ground');
  const sp4 = at(4.1);
  ok(sp4.fall === 1 && sp4.litter > 0 && sp4.litter <= 1, 'next winter: last year\'s litter still lies there');
  ok(at(4.24).litter === 0 || at(4.24).fall < 0, 'next spring: the litter has rotted');
  ok(at(4.5).show === 1 && at(4.5).fall < 0, 'the next summer the node leafs again');
  const ever = { kind: 0, y0: 3, y1: 8, rand: 0.3, nodeBorn: 3.3, ever: true, falls: false };
  const pe = SPECIES.conifer.pheno;
  ok(leafState(pe, ever, 5.05, {}).show === 1 && leafState(pe, ever, 5.9, {}).fall < 0, 'a needle stays through winter');
  ok(leafState(pe, ever, 8.95, {}).fall > 0 || leafState(pe, ever, 8.85, {}).colour > 0, 'an old needle browns and falls in its last year');
  const fl = { kind: 1, y0: 5, y1: 5, rand: 0.4, nodeBorn: 3.2, ever: false, falls: true }, pc = SPECIES.cherry.pheno;
  ok(leafState(pc, fl, 5 + pc.bloom + 0.05, {}).show > 0.8, 'cherry blossom opens in spring');
  ok(leafState(pc, fl, 5 + pc.bloom + 0.05, {}).show > 0 && leafState(SPECIES.cherry.pheno, { ...rec, y0: 5, nodeBorn: 4.2 }, 5 + pc.bloom + 0.05, {}).show === 0, 'blossom opens before the leaves');
  ok(leafState(pc, fl, 5 + pc.bloomEnd + 0.03, {}).fall > 0, 'petals fall at the end of the bloom');
  const co = { kind: 2, y0: 0, y1: 1, rand: 0.5, nodeBorn: 0.2, ever: false, falls: true };
  ok(leafState(pc, co, 0.3, {}).show === 1 && leafState(pc, co, 1.8, {}).show === 0, 'cotyledons open, then wither in the second summer');
  ok(seasonOf(0.5).season === 'summer' && seasonOf(2.05).season === 'winter' && seasonOf(7.3).season === 'spring' && seasonOf(1.8).season === 'autumn', 'season names');
  ok(seasonOf(3.5).month === 'July' && seasonOf(3.5).year === 3, 'month and year');
  ok(snowCover(4.0) === 1 && snowCover(4.5) === 0 && snowCover(4.96) > 0.9, 'snow in winter only');
  ok(girthPhase(0.1) === 0 && girthPhase(0.9) === 1, 'girth grows in the season');
  ok(deathDrop(0.05, 5, 0) === 5 - 0.02 && deathDrop(0, 5, 0) === 0 && deathFade(1, 0) === 0, 'a dead branch falls and rots');
  // the GLSL copy uses the same constants
  for (const k of Object.keys(CAL)) ok(SEASON_GLSL.includes(`const float ${k} = ${CAL[k].toFixed(4)};`), `GLSL constant ${k}`);
  ok(GROUND_GLSL.includes(`FLAT_R = ${FLAT_R.toFixed(1)}`), 'GLSL ground radius');
}

// --- packing and the CPU twin ---------------------------------------------------
{
  const s = createSim({ species: 'cherry', seed: 9 }), hist = createHistory();
  for (let y = 0; y < 12; y++) { s.stepYear(); addToHistory(hist, s.snapshot()); }
  const snap = s.snapshot();
  const pk = packYear(snap, hist, 10, { mode: 'order' });
  ok(pk.n > 1000 && pk.leafN > 3000, `pack: ${pk.n} nodes, ${pk.leafN} leaves for year 11`);
  let parentsOk = true, fin = true;
  for (let j = 0; j < pk.n; j++) {
    const pe = pk.T[1][j * 4 + 2], q = pe >= 0 ? pe : -pe - 1;
    if (q > j || q < 0) parentsOk = false;
    for (let k = 0; k < 5; k++) for (let c = 0; c < 4; c++) if (!Number.isFinite(pk.T[k][j * 4 + c])) fin = false;
  }
  ok(parentsOk, 'pack: a parent comes before its child');
  ok(fin, 'pack: all rows finite');
  ok(pk.T[0].length % (TEX_W * 4) === 0, 'pack: whole texture rows');
  let leavesOk = true; for (let k = 0; k < pk.leafN; k++) { const j = pk.leaves[k * 8]; if (j < 0 || j >= pk.n || (pk.leaves[k * 8 + 7] >> 2) >= CELLS.length) leavesOk = false; }
  ok(leavesOk, 'pack: every leaf points at a packed node and a real atlas cell');
  let born = true; for (let j = 0; j < pk.n; j++) if (pk.T[0][j * 4 + 3] >= 11) born = false;
  ok(born, 'pack: only nodes born by the end of the year');
  // frames are orthonormal, and the quaternion gives the tangent back
  const fr = nodeFrames(snap);
  let orth = true, quat = true;
  const q = new Float32Array(4), v = [0, 0, 0];
  for (let i = 0; i < snap.count; i += 13) {
    const t = [fr.tan[i * 3], fr.tan[i * 3 + 1], fr.tan[i * 3 + 2]], n = [fr.nrm[i * 3], fr.nrm[i * 3 + 1], fr.nrm[i * 3 + 2]];
    if (Math.abs(Math.hypot(...t) - 1) > 1e-4 || Math.abs(Math.hypot(...n) - 1) > 1e-4 || Math.abs(t[0] * n[0] + t[1] * n[1] + t[2] * n[2]) > 1e-4) orth = false;
    frameQuat(t[0], t[1], t[2], n[0], n[1], n[2], q, 0);
    quatRotate(q, 0, 0, 1, 0, v);
    if (Math.hypot(v[0] - t[0], v[1] - t[1], v[2] - t[2]) > 1e-3) quat = false;
  }
  ok(orth, 'frames: unit tangent and normal at right angles');
  ok(quat, 'frames: the quaternion turns +y onto the tangent');
  // a shoot grows from its parent: at born it has length 0, after dur its full length
  let j = -1; for (let k = pk.n - 1; k >= 0; k--) { if (pk.T[1][k * 4 + 2] >= 0 && pk.T[0][k * 4 + 3] > 10.2) { j = k; break; } }
  ok(j > 0, 'a node born in year 11');
  if (j > 0) {
    const pe = pk.T[1][j * 4 + 2], b = pk.T[0][j * 4 + 3], A = nodeShown(pk, pe, b + 0.5, null), B0 = nodeShown(pk, j, b, null), B1 = nodeShown(pk, j, b + 0.05, null);
    ok(Math.hypot(B0[0] - A[0], B0[1] - A[1], B0[2] - A[2]) < 1e-6, 'twin: a new metamer starts at its parent');
    const full = Math.hypot(pk.T[0][j * 4] - pk.T[0][pe * 4], pk.T[0][j * 4 + 1] - pk.T[0][pe * 4 + 1], pk.T[0][j * 4 + 2] - pk.T[0][pe * 4 + 2]);
    ok(Math.abs(Math.hypot(B1[0] - A[0], B1[1] - A[1], B1[2] - A[2]) - full) < 1e-5, 'twin: it reaches its full length');
  }
  // the root of the plant does not move in the wind; a twig does
  const still = nodeShown(pk, 0, 10.5, null).slice(), windy = nodeShown(pk, 0, 10.5, { k: 1, time: 3 });
  ok(Math.hypot(still[0] - windy[0], still[2] - windy[2]) < 1e-9, 'wind: the root stays');
  let tw = 0; for (let k = pk.n - 1; k > pk.n - 200; k--) { const a = nodeShown(pk, k, 10.6, null).slice(), b = nodeShown(pk, k, 10.6, { k: 1, time: 3 }); tw = Math.max(tw, Math.hypot(a[0] - b[0], a[2] - b[2])); }
  ok(tw > 0.01, `wind: twigs move (${tw.toFixed(3)} m)`);
  // leaves: in summer on the tree, in late autumn on the ground
  const summer = [], late = [];
  for (let k = 0; k < pk.leafN; k += 17) { const a = leafPose(pk, k, 10.55); if (a) summer.push(a); const b = leafPose(pk, k, 10.97, { groundY }); if (b) late.push(b); }
  ok(summer.length > 100 && summer.every(l => l.fall < 0), 'twin: summer leaves hang on the tree');
  ok(late.length > 50 && late.filter(l => l.kind === 0).every(l => l.fall === 1 && Math.abs(l.o[1] - groundY(l.o[0], l.o[2])) < 0.03), 'twin: in late autumn the leaves lie on the ground');
  ok(summer.every(l => Math.abs(l.nL[0] * l.dL[0] + l.nL[1] * l.dL[1] + l.nL[2] * l.dL[2]) < 1e-3), 'twin: a leaf normal is at right angles to its blade');
  // colour modes
  ok(COLOUR_IDS[0] === 'natural' && COLOUR_MODES.length === 7, 'seven colour modes, natural first');
  for (const mode of ['order', 'flow', 'vigour', 'light']) {
    const p2 = packYear(snap, hist, 10, { mode });
    let lo = 1, hi = 0; for (let j2 = 0; j2 < p2.n; j2++) { const v2 = p2.T[3][j2 * 4 + 3]; lo = Math.min(lo, v2); hi = Math.max(hi, v2); }
    ok(lo >= 0 && hi <= 1 && hi - lo > 0.3, `${mode}: spans the gradient (${lo.toFixed(2)}..${hi.toFixed(2)})`);
  }
  // atlas and looks
  for (const id of SPECIES_IDS) {
    const L = LOOK[id]; const k = SPECIES_IDS.indexOf(id);
    ok(ATLAS_CELLS[L.leaf] && ATLAS_CELLS[L.coty] && (!L.flower || ATLAS_CELLS[L.flower]) && BARKS.includes(L.bark), `${id}: atlas cells and bark exist`);
    ok(cellIndex(k, 0, 9) < CELLS.length, `${id}: cell index in range`);
  }
  const tab = speciesTables();
  ok(tab.n === SPECIES_IDS.length && finite(tab.pheno) && finite(tab.leafA), 'species tables');
  // a mesh for a thumbnail
  const m = plantMesh(s, { t: 11.5 });
  ok(m.branches.idx.length > 3000 && m.leaves.idx.length > 3000 && finite(m.branches.pos) && finite(m.leaves.pos), `mesh: ${m.branches.idx.length / 3} tube and ${m.leaves.idx.length / 3} leaf triangles`);
}

// --- ground: micro-relief and flat pads -------------------------------------
{
  setPads([]);
  let mx = 0, sum = 0, n = 0;
  for (let x = -15; x <= 15; x += 0.37) for (let z = -15; z <= 15; z += 0.41) { if (Math.hypot(x, z) > FLAT_R) continue; const y = groundY(x, z); mx = Math.max(mx, Math.abs(y)); sum += y; n++; }
  ok(mx > 0.05 && mx <= RELIEF_AMP + 1e-9 && mx < 0.16 && Math.abs(sum / n) < 0.02, `micro-relief: gentle, +-${mx.toFixed(3)} m, mean ${(sum / n).toFixed(3)} m`);
  setPads([{ x: 0, z: 0, r: 0.5 }, { x: 6, z: -2, r: 0.5 }]);
  ok(groundY(0.3, 0.2) === 0 && groundY(6.2, -2.1) === 0, 'a pad keeps the ground level at a trunk base');
  ok(Math.abs(groundY(0, 0.5 + PAD_RISE + 0.5) - relief(0, 0.5 + PAD_RISE + 0.5)) < 1e-9, 'past the pad the full relief comes back');
  ok(groundY(60, 10) > 0.5 && Number.isFinite(groundY(200, -300)), 'hills beyond');
  const mixed = standLayout('mixed', 'oak', 3);
  setPads([{ x: 0, z: 0, r: 3.7 }, ...mixed.map(p => ({ x: p.x, z: p.z, r: 0.5 }))]);
  ok(mixed.length >= 9 && mixed.every(p => groundY(p.x, p.z) === 0), `every plant of a mixed stand (${mixed.length}) stands on a level pad, with the cut-away pad too`);
  ok(GROUND_GLSL.includes(`FLAT_R = ${FLAT_R.toFixed(1)}`) && GROUND_GLSL.includes(PAD_RISE.toFixed(2)) && GROUND_GLSL.includes('uPads'), 'GLSL ground: the same radius, pad rise and pads');
  setPads([]);
}

// --- the ground ecosystem (eco.js) --------------------------------------------
const OAK_PLANT = [{ x: 0, z: 0, species: 'oak', form: 'tree', rMature: SPECIES.oak.size.r * 0.9, disperse: 'gravity' }];
const eco7 = E.buildEco({ seed: 7, plants: OAK_PLANT });
{
  // the integer hash: the same bits as the GLSL (uint mod 2^32)
  ok(E.hash3(3, -7, 11) === E.hash3(3, -7, 11) && E.hash3(3, -7, 11) !== E.hash3(4, -7, 11), 'hash3: deterministic, varies by cell');
  let lo = 1, hi = 0; for (let i = 0; i < 4000; i++) { const v = E.vnoise(i * 0.37 - 300, i * 0.21 + 50, 5); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  ok(lo >= 0 && hi < 1 && hi - lo > 0.7, `vnoise in [0, 1): ${lo.toFixed(2)}..${hi.toFixed(2)}`);
  ok(E.ECO_GLSL.includes('0x27d4eb2du') && E.ECO_GLSL.includes('0x85ebca6bu') && E.ECO_GLSL.includes(`grow = smoothstep(${E.GRASS_CAL.grow[0].toFixed(4)}`), 'GLSL eco: the same hash constants and grass calendar');
  const again = E.buildEco({ seed: 7, plants: OAK_PLANT });
  ok(again.tussocks.length === eco7.tussocks.length && again.tussocks.every((v, i) => v === eco7.tussocks[i]) && JSON.stringify(again.forbs) === JSON.stringify(eco7.forbs) && JSON.stringify(again.stones) === JSON.stringify(eco7.stones), 'buildEco: the same seed places the same community');
  const other = E.buildEco({ seed: 8, plants: OAK_PLANT });
  ok(other.tussocks[0] !== eco7.tussocks[0], 'buildEco: another seed, another community');
}
{
  // clustering: forbs come in drifts by species, tussocks in swards
  const LR = (pts, r, R) => E.ripleyL(pts, r, R) - r;
  const msg = [];
  let drifts = 0, checked = 0;
  for (const id of ['daisy', 'buttercup', 'dandelion', 'periwinkle']) {
    const pts = eco7.forbs.filter(f => f.id === id).map(f => [f.x, f.z]);
    if (pts.length < 15) continue;
    checked++; const l = LR(pts, 1.0, E.ECO_R); msg.push(`${id} ${l.toFixed(2)}`);
    if (l > 0.6) drifts++;
  }
  ok(checked >= 3 && drifts === checked, `forbs in drifts: L(1 m) - 1 m > 0.6 for each species (${msg.join(', ')})`);
  const T = eco7.tussocks, near = [];
  for (let q = 0; q < T.length; q += 8) if (T[q + 2] === 0 && Math.hypot(T[q], T[q + 1]) < 7) near.push([T[q], T[q + 1]]);
  const lT = LR(near, 0.5, 7);
  ok(near.length > 300 && lT > 0.12, `tall grass in tussock clusters: L(0.5 m) - 0.5 m = ${lT.toFixed(2)} (${near.length} tussocks)`);
  // a Poisson pattern of the same count and window gives L(r) - r near 0
  const r = rng(5), csr = [];
  while (csr.length < near.length) { const x = (r() * 2 - 1) * 7, z = (r() * 2 - 1) * 7; if (x * x + z * z < 49) csr.push([x, z]); }
  const lC = LR(csr, 0.5, 7);
  ok(Math.abs(lC) < 0.05, `control: a Poisson pattern gives L(0.5) - 0.5 = ${lC.toFixed(3)}`);
  // moisture: tall meadow grass is denser on wet ground, fine sward on dry
  let wetT = 0, dryT = 0, wetF = 0, dryF = 0;
  for (let q = 0; q < T.length; q += 8) {
    if (Math.hypot(T[q], T[q + 1]) > 20) continue;
    const mo = eco7.fields.moist(T[q], T[q + 1]);
    if (mo > 0.5) { if (T[q + 2] === 0) wetT++; if (T[q + 2] === 1) wetF++; }
    else if (mo < 0.38) { if (T[q + 2] === 0) dryT++; if (T[q + 2] === 1) dryF++; }
  }
  ok(wetT / Math.max(1, wetF) > 1.5 * dryT / Math.max(1, dryF), `moisture: tall grass to fine sward ${(wetT / Math.max(1, wetF)).toFixed(2)} on wet ground, ${(dryT / Math.max(1, dryF)).toFixed(2)} on dry`);
}
{
  // stones: a power law of sizes, a hard core between large stones, outcrops
  const r = rng(9), xs = [];
  for (let i = 0; i < 40000; i++) xs.push(E.stoneSize(r()));
  const cnt = s => xs.filter(v => v > s).length;
  const s1 = 0.03, s2 = 0.3, slope = Math.log(cnt(s2) / cnt(s1)) / Math.log(s2 / s1);
  ok(Math.abs(slope + E.STONE_B) < 0.12, `stone sizes: N(> s) ~ s^${slope.toFixed(2)} (power law, b = ${E.STONE_B})`);
  ok(Math.min(...xs) >= E.STONE_MIN && Math.max(...xs) <= E.STONE_MAX, `stone sizes within ${E.STONE_MIN}..${E.STONE_MAX} m`);
  let closePairs = 0, bigs = 0, seeds = 0, order = 0, withBoulder = 0;
  const outPts = [];
  for (let sd = 1; sd <= 24; sd++) {
    const e = sd === 7 ? eco7 : E.buildEco({ seed: sd, plants: OAK_PLANT, limits: { tussocks: 10, forbs: 10, stones: 1400, litter: 10, woodland: 10 } });
    const big = e.stones.filter(s => s.s > 0.35);
    bigs += big.length; seeds++;
    for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) if (Math.hypot(big[i].x - big[j].x, big[i].z - big[j].z) < 0.55 * (big[i].s + big[j].s) + 0.35) closePairs++;
    const c = [0, 0, 0]; for (const s of e.stones) c[s.cls]++;
    if (c[0] > c[1] && c[1] > c[2]) order++;
    if (c[2] >= 1) withBoulder++;
    if (sd === 3) for (const s of e.stones) if (s.s > 0.1) outPts.push([s.x, s.z]);
  }
  ok(bigs > 50 && closePairs === 0, `large stones inhibit: no pair inside the hard core (${bigs} stones over ${seeds} seeds)`);
  ok(order === seeds && withBoulder >= seeds * 0.8, `many pebbles, fewer cobbles, a few boulders (${order}/${seeds}; a boulder in ${withBoulder})`);
  const lO = E.ripleyL(outPts, 3, E.ECO_R) - 3;
  ok(lO > 0.8, `cobbles and boulders group in outcrops: L(3 m) - 3 m = ${lO.toFixed(2)}`);
  const peb = eco7.stones.filter(s => s.cls === 0);
  ok(peb.every(s => s.s >= 0.02 && s.s <= 0.1), 'pebbles are 2 to 10 cm');
}
{
  // the shade response: fewer tussocks show under a mature crown than in sun
  const crowns = [{ x: 0, z: 0, r: SPECIES.oak.size.r * 0.9, w: 1 }], F = eco7.fields, T = eco7.tussocks;
  // density per m2, each tussock weighted by its LOD share (widthK^2 = 1 / LOD weight)
  let inN = 0, inW = 0, outW = 0, shadeKind = 0;
  const rc = crowns[0].r, r0 = 0.5 * rc, r1 = 1.4 * rc, r2 = 19;
  for (let q = 0; q < T.length; q += 8) {
    const x = T[q], z = T[q + 1], d = Math.hypot(x, z), w = T[q + 7] * T[q + 7];
    const shown = E.grassKeep(T[q + 2] | 0, E.lightAt(x, z, crowns, F)) > T[q + 6];
    if (!shown) continue;
    if (d < r0) { inN++; inW += w; if (T[q + 2] === 2) shadeKind++; }
    else if (d > r1 && d < r2 && F.woodShade(x, z) < 0.02) outW += w;
  }
  let openA = 0;   // the open ring area without the wood shade (Monte Carlo)
  { const rr = rng(2); let hit = 0; const N = 20000; for (let i = 0; i < N; i++) { const a = rr() * 6.2832, d = Math.sqrt(r1 * r1 + rr() * (r2 * r2 - r1 * r1)); if (F.woodShade(Math.cos(a) * d, Math.sin(a) * d) < 0.02) hit++; } openA = Math.PI * (r2 * r2 - r1 * r1) * hit / N; }
  const dIn = inW / (Math.PI * r0 * r0), dOut = outW / openA;
  ok(openA > 200 && dIn < 0.45 * dOut, `grass under the crown is sparse: ${dIn.toFixed(1)} against ${dOut.toFixed(1)} tussocks per m2 in the open`);
  ok(shadeKind > inN * 0.4, `under the crown the grass that grows is mostly shade grass (${shadeKind} of ${inN})`);
  const Lsun = E.lightAt(15, 15, [], F), Lshade = E.lightAt(0.5, 0.5, crowns, F);
  ok(Lsun > 0.95 && Lshade < 0.3, `light: ${Lsun.toFixed(2)} in the open, ${Lshade.toFixed(2)} under the crown`);
  // forb niches: ferns and periwinkle in shade, daisies in sun
  const fern = E.FORBS.find(f => f.id === 'fern'), daisy = E.FORBS.find(f => f.id === 'daisy');
  ok(E.niche(fern, 0.2) > 0.8 && E.niche(fern, 0.95) < 0.05 && E.niche(daisy, 0.95) > 0.8 && E.niche(daisy, 0.2) < 0.05, 'niches: ferns grow in shade, daisies in sun');
  const fernD = eco7.forbs.filter(f => f.id === 'fern').map(f => E.lightAt(f.x, f.z, crowns, F));
  const daisyD = eco7.forbs.filter(f => f.id === 'daisy').map(f => E.lightAt(f.x, f.z, crowns, F));
  const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  ok(fernD.length > 5 && daisyD.length > 5 && mean(fernD) < 0.5 && mean(daisyD) > 0.8, `placement: ferns at mean light ${mean(fernD).toFixed(2)}, daisies at ${mean(daisyD).toFixed(2)}`);
  // ecotone: from the open meadow to the woodland edge, light falls and the wood begins
  const ed = eco7.params.edge, at = d => [ed[0] * d, ed[1] * d];
  const l1 = E.lightAt(...at(12), [], F), l2 = E.lightAt(...at(ed[2] - 2), [], F), l3 = E.lightAt(...at(ed[2] + 6), [], F);
  ok(l1 > 0.95 && l2 < l1 && l3 < 0.3 && F.wood(...at(ed[2] + 6)) > 0.9, `ecotone to the wood: light ${l1.toFixed(2)} > ${l2.toFixed(2)} > ${l3.toFixed(2)}`);
  ok(eco7.shrubs.length > 10 && eco7.woodland.length > 100, `a shrub mantle (${eco7.shrubs.length}) and woodland (${eco7.woodland.length} trees)`);
}
{
  // seasons of the grass
  const g = p => E.grassState(p, 0, 0);
  const w = g(0.05), su = g(0.5), lsu = g(0.62), au = g(0.88), w2 = g(0.999);
  ok(w[0] < 0.45 && w[1] < 0.35 && w[4] > 0.6, `winter: low brown lodged stubble (h ${w[0].toFixed(2)}, green ${w[1].toFixed(2)}, lodge ${w[4].toFixed(2)})`);
  ok(su[0] > 0.95 && su[1] > 0.75 && su[2] > 0.9 && su[4] < 0.1, `midsummer: full height, green, seed heads up (${su.map(v => v.toFixed(2)).join(' ')})`);
  ok(lsu[3] > 0.9 && lsu[1] < su[1], 'late summer: the heads ripen and the sward cures');
  ok(au[1] < 0.5 && au[4] > 0.4 && au[0] < su[0], `autumn: browning and lodging (green ${au[1].toFixed(2)}, lodge ${au[4].toFixed(2)})`);
  ok(Math.abs(w2[0] - g(0)[0]) < 0.01 && Math.abs(w2[1] - g(0)[1]) < 0.01 && Math.abs(w2[4] - g(0)[4]) < 0.01, 'the grass year joins at 31 December');
  const sn = E.grassState(0.05, 0, 1);
  ok(sn[0] < w[0] * 0.4 && sn[4] > 0.9, 'snow flattens the grass');
  ok(E.grassState(0.5, 2, 0)[1] > su[1] - 1e-9 && E.grassState(0.5, 3, 0)[2] === 0, 'shade grass stays greener; trampled turf has no seed heads');
  // flowers bloom in their real season, then the petals fall
  const month = p => Math.floor(p * 12) + 1;
  const cel = E.FORBS.find(f => f.id === 'celandine'), dai = E.FORBS.find(f => f.id === 'daisy'), but = E.FORBS.find(f => f.id === 'buttercup');
  ok(E.bloomAt(cel, 0.25) > 0.99 && E.bloomAt(cel, 0.5) === 0 && month(cel.bloom[0]) >= 3 && month(cel.bloom[1]) <= 4, 'celandine flowers in March and April');
  ok(E.bloomAt(dai, 0.5) > 0.99 && E.bloomAt(dai, 0.3) === 0 && month(dai.bloom[0]) >= 6, 'oxeye daisies flower in June and July');
  ok(E.bloomAt(but, 0.42) > 0.99 && E.bloomAt(but, 0.7) === 0, 'buttercups in May and June');
  ok(E.forbLife(cel, 0.5) < 0.01 && E.forbLife(cel, 0.25) > 0.99, 'celandine dies back by early summer (a spring ephemeral)');
  ok(E.FORBS.filter(f => f.kind === 'flower').every(f => f.bloom && f.petal && f.bloom[1] > f.bloom[0]), 'every flower has a bloom window and a petal colour for the falling petals');
  // leaf litter: falls in autumn, rots over the winter
  const l7 = E.litterSeason(0.55), l11 = E.litterSeason(0.92), l1 = E.litterSeason(0.03), l3 = E.litterSeason(0.22), l6 = E.litterSeason(0.48);
  ok(l7.k < 0.01 && l11.k > 0.99 && l1.k > 0.9 && l3.k < l1.k && l6.k < 0.01, `litter: none in July, full in late November, less by spring (${l3.k.toFixed(2)} in March)`);
  ok(l11.decay < l1.decay && l1.decay < l3.decay, 'litter darkens as it rots over the winter');
}
{
  // gusts travel downwind at about 5 m/s
  const dir = [0.93, 0.37], c = 2.2 / 0.42;
  let err = 0;
  for (let i = 0; i < 50; i++) { const x = i * 0.7 - 10, z = i * 0.3, t = i * 0.1; err += Math.abs(E.gust(x, z, t, dir) - E.gust(x + dir[0] * c * 0.2, z + dir[1] * c * 0.2, t + 0.2, dir)); }
  ok(err / 50 < 0.12, `a gust front moves downwind at ${c.toFixed(1)} m/s (mean error ${(err / 50).toFixed(3)})`);
}
{
  // leaf litter piles up in hollows and against stones
  const L = eco7.litter, rnd = rng(3);
  let hl = 0, hr = 0, n = 0;
  for (let q = 0; q < L.length; q += 8) { hl += -relief(L[q], L[q + 1]); n++; }
  for (let i = 0; i < n; i++) { const a = rnd() * 6.283, d = 1.5 * OAK_PLANT[0].rMature * Math.sqrt(rnd()); hr += -relief(Math.cos(a) * d, Math.sin(a) * d); }
  ok(n > 1000 && hl / n > hr / n + 0.01, `litter lies deeper in the hollows (mean depth ${(hl / n * 100).toFixed(1)} cm against ${(hr / n * 100).toFixed(1)} cm)`);
  // against stones: the litter density in a ring round each stone in the
  // litter area is higher than the mean density of that area
  let ringN = 0, ringA = 0, allN = 0;
  const RL = 1.5 * OAK_PLANT[0].rMature;
  for (let sd = 1; sd <= 10; sd++) {
    const e = sd === 7 ? eco7 : E.buildEco({ seed: sd, plants: OAK_PLANT });
    const st = e.stones.filter(s => s.s >= 0.25 && Math.hypot(s.x, s.z) < RL * 0.8), Lp = e.litter;
    for (const s of st) {
      const r0 = s.s * 0.45, r1 = s.s * 0.55 + 0.4;
      ringA += Math.PI * (r1 * r1 - r0 * r0);
      for (let q = 0; q < Lp.length; q += 8) { const d = Math.hypot(Lp[q] - s.x, Lp[q + 1] - s.z); if (d >= r0 && d < r1) ringN++; }
    }
    allN += Lp.length / 8;
  }
  const dRing = ringN / Math.max(1e-6, ringA), dAll = allN / (10 * Math.PI * RL * RL);
  ok(ringA > 1 && dRing > 1.5 * dAll, `litter drifts against stones: ${dRing.toFixed(1)} leaves per m2 at stones, ${dAll.toFixed(1)} on average`);
  // the ground mix: litter under the crown in November, bare soil on the path, snow in winter
  const crowns = [{ x: 0, z: 0, r: 7, w: 1 }], env = { F: eco7.fields, crowns, litter: 1, decay: 0.1, snow: 0 };
  const under = E.groundMix(1.2, -1.5, env), open = E.groundMix(16, 14, env);
  ok(under.litter > 0.6 && open.litter < 0.1 && under.turf < open.turf, 'ground: litter under the crown in autumn, turf in the open');
  let best = [0, 0], bp = 0;
  for (let x = -20; x <= 20; x += 0.25) for (let z = -20; z <= 20; z += 0.25) { const v = eco7.fields.path(x, z); if (v > bp && Math.hypot(x, z) > 9) { bp = v; best = [x, z]; } }
  ok(bp > 0.95 && E.groundMix(best[0], best[1], env).soil > 0.7, `ground: the trampled path is bare soil (soil ${E.groundMix(best[0], best[1], env).soil.toFixed(2)})`);
}
{
  // seedlings: seeds fall under and round the crown; in shade most die
  const crowns = [];
  for (let y = 0; y < 60; y++) crowns.push([Math.min(7, 0.3 + y * 0.25)]);
  const list = E.seedlings({ seed: 4, plants: OAK_PLANT, crowns, years: 60, fields: eco7.fields });
  const live = OAK_PLANT.map(() => ({ x: 0, z: 0, r: 7, w: 1 }));
  let sh = 0, shOk = 0, sun = 0, sunOk = 0;
  for (const s of list) {
    if (s.born > 55) continue;
    const L = E.lightAt(s.x, s.z, live, eco7.fields), survived = s.died > s.born + 3;
    if (L < 0.3) { sh++; if (survived) shOk++; } else if (L > 0.6) { sun++; if (survived) sunOk++; }
  }
  ok(sh > 20 && sun > 5 && shOk / sh < 0.5 * (sunOk / sun), `seedlings: ${(100 * shOk / sh).toFixed(0)} % live 3 years in shade (${sh}), ${(100 * sunOk / sun).toFixed(0)} % in light (${sun})`);
  ok(E.seedlingSurvival(0.15, 0) < E.seedlingSurvival(0.55, 0) && E.seedlingSurvival(1, 0.9) < E.seedlingSurvival(1, 0), 'seedling survival rises with light and falls on the path');
  const part = E.seedlings({ seed: 4, plants: OAK_PLANT, crowns, years: 40, fields: eco7.fields });
  const same = part.every(p => { const q = list.find(o => o.id === p.id); return q && q.born === p.born && (q.died === p.died || p.died === Infinity); });
  ok(same, 'seedlings: more years do not change the past');
  ok(list.every(s => E.seedlingHeight(s, s.born + 100) <= E.SEEDLING.hMax), `saplings stay under ${E.SEEDLING.hMax} m`);
}
{
  // real-world scale
  const man = JSON.parse(fs.readFileSync(new URL('../../assets/nature/manifest.json', import.meta.url)));
  const H = id => (man.assets.find(a => a.id === id) || {}).height;
  const bad = [];
  for (const f of E.FORBS) for (const id of f.assets) {
    if (!H(id)) { bad.push(id + ' missing'); continue; }
    const lo = H(id) * f.scale[0], hi = H(id) * f.scale[1];
    if (f.kind === 'flower' && (lo < 0.05 || hi > 0.5)) bad.push(`${id} ${lo.toFixed(2)}..${hi.toFixed(2)} m`);
    if (f.kind === 'fern' && (lo < 0.2 || hi > 1.0)) bad.push(`${id} ${lo.toFixed(2)}..${hi.toFixed(2)} m`);
  }
  ok(!bad.length, 'flowers are 5 to 50 cm tall and ferns 20 cm to 1 m', bad.join(', '));
  for (const c of E.STONE_CLASSES) for (const id of c.assets) if (!H(id)) bad.push(id);
  for (const w of eco7.woodland) if (!H(w.asset) || H(w.asset) * w.scale < 7 || H(w.asset) * w.scale > 26) bad.push(w.asset);
  ok(!bad.length, 'stone and woodland assets exist; woodland trees are 7 to 26 m', [...new Set(bad)].join(', '));
  const env = { p: 0.5, snow: 0, time: 0, wind: 0.35, crowns: [], F: eco7.fields, R: E.ECO_R };
  const hs = [], culms = [];
  const T = eco7.tussocks;
  for (let q = 0; q < T.length; q += 8 * 7) {
    if (T[q + 2] === 3 || Math.hypot(T[q], T[q + 1]) > 0.8 * E.ECO_R) continue;
    for (let b = 0; b < E.BLADES; b++) { const B = E.bladeAt(T, q, b, env); if (B.vis < 0.99) continue; (B.culm ? culms : hs).push(B.h); }
  }
  hs.sort((a, b) => a - b); culms.sort((a, b) => a - b);
  const pc = (a, f) => a[Math.floor(a.length * f)];
  ok(pc(hs, 0.05) >= 0.12 && pc(hs, 0.5) >= 0.2 && pc(hs, 0.5) <= 0.45 && pc(hs, 0.95) <= 0.7, `grass blades at midsummer: ${(pc(hs, 0.05) * 100).toFixed(0)} / ${(pc(hs, 0.5) * 100).toFixed(0)} / ${(pc(hs, 0.95) * 100).toFixed(0)} cm (5th / 50th / 95th percentile)`);
  ok(culms.length > 100 && pc(culms, 0.95) <= 1.0 && pc(culms, 0.5) > pc(hs, 0.5), `flowering culms stand over the leaves (median ${(pc(culms, 0.5) * 100).toFixed(0)} cm)`);
  ok(SPECIES.oak.size.r * 2 >= 15 && SPECIES.oak.size.r * 2 <= 25, `a mature oak crown is ${SPECIES.oak.size.r * 2} m across`);
}
{
  // the far meadow round the camera: no bare disc edge past the tussocks
  const F = eco7.fields, cam = [30, 26];
  const a = E.procGrass(cam[0], cam[1], F, E.ECO_R), b = E.procGrass(cam[0], cam[1], F, E.ECO_R);
  ok(a.length > 2000 && JSON.stringify(a.slice(0, 50)) === JSON.stringify(b.slice(0, 50)), `far meadow: ${a.length} tussocks round the camera, the same each frame`);
  ok(a.every(o => Math.hypot(o.rec[0], o.rec[1]) >= 0.82 * E.ECO_R), 'far meadow: none inside the tussocks of buildEco (it fades in at 0.82 R)');
  const moved = E.procGrass(cam[0] + 0.25 * 3, cam[1], F, E.ECO_R);
  const key = o => o.rec[0].toFixed(4) + ',' + o.rec[1].toFixed(4);
  const setA = new Set(a.map(key)), shared = moved.filter(o => setA.has(key(o))).length;
  ok(shared > 0.8 * Math.min(a.length, moved.length), `far meadow: the cells are anchored in the world (${shared} of ${moved.length} stay when the camera moves)`);
  let wrongPath = 0, wrongWood = 0, inner = 0;
  for (const o of a) {
    const [x, z, kind] = o.rec, pth = F.path(x, z);
    if (pth > 0.08 && pth < 0.75 && F.wood(x, z) <= 0.5 && kind !== 3) wrongPath++;
    if (F.wood(x, z) > 0.5 && kind !== 2) wrongWood++;
    if (Math.max(Math.abs(x - cam[0]), Math.abs(z - cam[1])) < 5 && o.keep > 0.99) inner++;
  }
  const dIn = inner / 100;
  ok(wrongPath === 0 && wrongWood === 0, 'far meadow: path turf on the path, shade grass in the wood');
  ok(dIn > 4, `far meadow: ${dIn.toFixed(1)} tussocks per m2 near the camera`);
  const env = { p: 0.5, snow: 0, time: 0, wind: 0.35, crowns: [], F, R: E.ECO_R };
  const T = new Float32Array(a.length * 8); a.forEach((o, i) => T.set(o.rec, i * 8));
  const hs = [];
  for (let q = 0; q < T.length; q += 8 * 5) if (T[q + 2] !== 3) for (let bI = 1; bI < E.BLADES; bI++) { const B = E.bladeAt(T, q, bI, env, a[q / 8].keep); if (B.vis > 0.99) hs.push(B.h); }
  hs.sort((x, y) => x - y);
  ok(hs.length > 500 && hs[Math.floor(hs.length * 0.5)] >= 0.2 && hs[Math.floor(hs.length * 0.95)] <= 0.7, `far meadow blades: median ${(hs[Math.floor(hs.length * 0.5)] * 100).toFixed(0)} cm`);
}
{
  // distance LOD of the grass: fewer, wider blades far from the camera, the same cover
  const T = eco7.tussocks, F = eco7.fields;
  const cover = cam => { let w = 0, n = 0; for (let q = 0; q < T.length; q += 8 * 11) for (let b = 0; b < E.BLADES; b++) { const B = E.bladeAt(T, q, b, { p: 0.5, snow: 0, crowns: [], F, R: E.ECO_R, cam }); if (B) { w += B.width * B.h; n++; } } return { w, n }; };
  const near = cover([0, 0]), far = cover([200, 0]);
  ok(far.n < near.n * 0.3 && Math.abs(far.w / near.w - 1) < 0.25, `grass LOD: ${far.n} blades far against ${near.n} near, cover ratio ${(far.w / near.w).toFixed(2)}`);
}
{
  // phones: the caps of layout.js
  const ph = ecoLimits(true), dk = ecoLimits(false);
  ok(ph === ECO_LIMITS.phone && dk === ECO_LIMITS.desktop && ph.tussocks < dk.tussocks / 2 && ph.forbs < dk.forbs && ph.stones < dk.stones && ph.litter < dk.litter && ph.lod >= dk.lod && ph.procN * ph.procN < dk.procN * dk.procN / 3, `phones get smaller ecosystem caps (far meadow ${2 * ph.procN * ph.procN} against ${2 * dk.procN * dk.procN} tussocks)`);
  const e = E.buildEco({ seed: 7, plants: OAK_PLANT, limits: ph, R: ph.R });
  ok(e.tussocks.length / 8 <= ph.tussocks && e.forbs.length <= ph.forbs + 60 && e.stones.length <= ph.stones && e.litter.length / 8 <= ph.litter && e.woodland.length <= ph.woodland, `phone community: ${e.tussocks.length / 8} tussocks, ${e.forbs.length} forbs, ${e.stones.length} stones`);
  // nothing in the soil cut-away or on a trunk
  const c = E.buildEco({ seed: 5, plants: OAK_PLANT, cut: 3 });
  let badN = 0;
  for (let q = 0; q < c.tussocks.length; q += 8) if (inCutaway(c.tussocks[q], c.tussocks[q + 1], 3) || Math.hypot(c.tussocks[q], c.tussocks[q + 1]) < 0.35) badN++;
  for (const f of c.forbs) if (inCutaway(f.x, f.z, 3) || Math.hypot(f.x, f.z) < 0.35) badN++;
  for (const s of c.stones) if (inCutaway(s.x, s.z, 3)) badN++;
  ok(badN === 0, 'no grass, forb or stone in the cut-away or on the trunk');
}

// --- roots by DLA ---------------------------------------------------------------
{
  const r = createRoots({ seed: 4, max: 900, scale: 0.08 });
  r.grow(900); r.stamp(3);
  const m = r.model;
  let maxY = -Infinity, depth = 0, lat = 0;
  for (let i = 1; i < m.count; i++) { maxY = Math.max(maxY, m.pos[i * 3 + 1]); depth = Math.max(depth, -m.pos[i * 3 + 1]); lat = Math.max(lat, Math.hypot(m.pos[i * 3], m.pos[i * 3 + 2])); }
  ok(m.count === 900, 'roots reach the cap');
  ok(maxY < 0, `roots stay under the ground (top ${maxY.toFixed(2)})`);
  ok(depth > lat * 1.2, `roots grow down (depth ${depth.toFixed(1)} vs lateral ${lat.toFixed(1)})`);
  let mono = true; for (let i = 1; i < m.count; i++) if (r.radius[m.parent[i]] < r.radius[i]) mono = false;
  ok(mono, 'root radius never falls toward the crown');
  ok(r.grow(10) === 0, 'roots stop at the cap');
  const rp = packRoots(r, { x: 1, z: 2, spIndex: 0, mode: 'flow' });
  let fin = true, under = true; for (let i = 0; i < rp.n; i++) { if (!finite(rp.T[0].subarray(i * 4, i * 4 + 4))) fin = false; if (i > 0 && rp.T[0][i * 4 + 1] > 0) under = false; }
  ok(rp.n === 900 && fin && under, 'root rows: finite, under the ground');
  ok(Math.abs(rp.T[0][0] - 1) < 1e-6 && Math.abs(rp.T[0][2] - 2) < 1e-6, 'root rows: at the plant');
  let mains = 0; for (let i = 1; i < rp.n; i++) if (rp.T[1][i * 4 + 2] >= 0) mains++;
  ok(mains > rp.n * 0.4 && mains < rp.n, `root rows: main axes and laterals (${mains} main)`);
}

// --- saver --------------------------------------------------------------------
{
  const a = makeShots(rng(42), 21), b = makeShots(rng(42), 21), c = makeShots(rng(43), 21);
  ok(JSON.stringify(a) === JSON.stringify(b), 'shots: the same seed gives the same list');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'shots: another seed gives another list');
  ok(a.every(s => s.dur >= 5 && s.dur <= 12), 'shots: 5 to 12 s each');
  ok(a.every((s, i) => i === 0 || s.species !== a[i - 1].species), 'shots: no species twice in a row');
  ok(SHOT_KINDS.every(k => a.some(s => s.kind === k)), 'shots: every kind (life, autumn, grove, spring, heat, winter, summer, meadow)');
  ok(a.filter(s => s.kind === 'autumn' || s.kind === 'winter' || s.kind === 'grove' || s.kind === 'meadow').every(s => SPECIES[s.species].form === 'tree'), 'shots: autumn, winter, grove and meadow shots show trees');
  const me = a.find(s => s.kind === 'meadow'), mp = shotPlan(me), ph0 = mp.t0 - Math.floor(mp.t0);
  ok(ph0 > 0.33 && mp.t1 - Math.floor(mp.t0) < 0.6 && mp.t1 > Math.floor(mp.t0) + 0.5, 'a meadow shot shows late May to early July of a mature year');
  const daisy = E.FORBS.find(f => f.id === 'daisy'), but = E.FORBS.find(f => f.id === 'buttercup');
  ok(but.bloom[0] < mp.t1 - Math.floor(mp.t0) && daisy.bloom[0] < mp.t1 - Math.floor(mp.t0) && E.grassState(0.47, 0, 0)[2] > 0.9, 'the meadow shot holds the buttercup and daisy bloom and the grass in flower');
  let inWood = 0, eye = true;
  for (let i = 0; i < 40; i++) {
    const mc = meadowCamera({ c: [0, 7, 0], r: 11 }, 40, i * 0.37, groundY, eco7.params.edge);
    if (eco7.fields.wood(mc.pos[0], mc.pos[2]) > 0.01 || eco7.fields.woodShade(mc.pos[0], mc.pos[2]) > 0.3) inWood++;
    const hh = mc.pos[1] - groundY(mc.pos[0], mc.pos[2]);
    if (!(hh > 1 && hh < 1.3 && mc.target[1] > mc.pos[1] && Math.hypot(mc.pos[0], mc.pos[2]) > 15)) eye = false;
  }
  ok(eye && inWood === 0, 'the meadow camera stands at eye height in the open meadow, the wood behind the tree');
  for (const s of a) {
    const p = shotPlan(s), years = SPECIES[s.species].years;
    if (!(p.t0 >= 0 && p.t1 > p.t0 && p.t1 <= years && p.rate > 0 && p.rate * s.dur >= (p.t1 - p.t0) * 0.99)) { ok(false, `plan ${s.kind} ${s.species} ${JSON.stringify(p)}`); break; }
  }
  const life = a.find(s => s.kind === 'life'), lp = shotPlan(life);
  ok(lp.t0 < 0.5 && lp.t1 > SPECIES[life.species].years - 1, 'a life shot runs from the seed to the last year');
  const au = a.find(s => s.kind === 'autumn'), ap = shotPlan(au), ph = SPECIES[au.species].pheno;
  ok(ap.t0 - Math.floor(ap.t0) < ph.col && ap.t1 - Math.floor(ap.t0) > ph.fall, 'an autumn shot spans the colour and the fall');
  const fov = 40;
  for (const [w, h] of [[1920, 1080], [1080, 1920], [390, 844]]) {
    const band = { t: h * 0.24, b: h * 0.3, w };
    const f = bandFrame(band, w, h);
    ok(Math.abs(f.offY - (band.b - band.t) / 2) < 1e-9 && f.offY > 0, `${w}x${h}: offset puts the band centre at the image centre`);
    for (const r of [0.2, 3, 9]) {
      const d = fitDistance(r, fov, w / h, f.hFrac, f.wFrac, 0.8);
      const pr = projectedRadius(r, d, fov, h), bandH = h - f.t - f.b;
      ok(2 * pr <= bandH * 0.81 && 2 * pr <= w * 0.81 && 2 * pr > Math.min(bandH, w) * 0.7, `${w}x${h} r ${r}: fits the band (${(2 * pr).toFixed(0)} px of ${bandH.toFixed(0)} x ${w})`);
    }
  }
  ok(bandFrame(null, 100, 100).hFrac === 1, 'no band: the full frame');
  const code = codeExtract(createSim.toString(), '// apical dominance eases', 13);
  ok(code.startsWith('// apical dominance eases') && code.includes('lam * Qm[i]') && code.split('\n').length === 13, 'code extract is the real allocation');
}

// --- layout.js: phones --------------------------------------------------------
{
  const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8');
  ok(css.includes('@media ' + PHONE_QUERY.replace(/, /g, ', ') + '{'), 'PHONE_QUERY is the query of the PHONE block in style.css');
  const VP = [[360, 740, 'sheet'], [390, 844, 'sheet'], [430, 932, 'sheet'], [768, 1024, 'sheet'], [844, 390, 'drawer'], [1440, 900, 'desktop']];
  for (const [w, h, want] of VP) ok(layoutFor(w, h, w < 1000) === want, `${w}x${h}: layout ${want}`);
  ok(layoutFor(900, 450, false) === 'desktop', 'a short desktop window keeps the desktop layout');
  // the sheet, dock and status bar at each phone viewport (style.css numbers)
  const fov = 40;
  for (const [w, h, kind] of VP.slice(0, 5)) {
    const dock = 64, status = 56, sheetH = Math.min(h * 0.5, 540);
    const rects = kind === 'sheet'
      ? [{ left: 0, right: w, top: h - dock - sheetH, bottom: h - dock }, { left: 0, right: w, top: h - dock, bottom: h }, { left: 0, right: w, top: h - dock - status, bottom: h - dock }, { left: 0, right: w, top: 0, bottom: 48 }]
      : [{ left: w - Math.min(w * 0.46, 380), right: w, top: 0, bottom: h }, { left: 0, right: Math.min(460, w * 0.58), top: h - dock, bottom: h }];
    const o = occlusion(rects, w, h);
    if (kind === 'sheet') ok(o.b === dock + sheetH && o.t === 48 && o.l === 0 && o.r === 0, `${w}x${h}: the open sheet covers the base (${o.b} px)`);
    else ok(o.r === Math.min(w * 0.46, 380) && o.b === dock, `${w}x${h}: the drawer covers the right side and the dock the base`);
    const { hF, wF } = clearFractions(o, w, h);
    const clearH = h - o.t - o.b, clearW = w - o.l - o.r;
    // the crown grows: a seedling, a young tree, a tall tree
    let prevD = 0;
    for (const r of [0.15, 2, 9]) {
      const d = fitDistance(r, fov, w / h, hF, wF, 0.86);
      const pr = projectedRadius(r, d, fov, h);
      ok(2 * pr <= Math.max(clearH, h * 0.3) * 0.87 && 2 * pr <= clearW * 0.87 + 1, `${w}x${h} r ${r}: plant fits the clear area (${(2 * pr).toFixed(0)} of ${clearH.toFixed(0)} x ${clearW.toFixed(0)} px)`);
      ok(d > prevD, `${w}x${h} r ${r}: the camera backs off as the crown grows`);
      prevD = d;
    }
  }
  ok(occlusion([{ left: 0, right: 100, top: 900, bottom: 1300 }], 400, 800).b === 0, 'an overlay off the screen (a closed sheet) does not count');
  ok(clearFractions({ l: 0, r: 0, t: 40, b: 780 }, 400, 800).hF === 0.3, 'a full-height sheet keeps a floor of 0.3');

  // gestures: one finger orbits and keeps follow, a pinch or wheel stops it, a double tap restores it
  const G = createGestures();
  const T = (id, x, y, t, type = 'touch', button = 0, mod = false) => ({ id, type, x, y, t, button, mod });
  ok(G.down(T(1, 100, 100, 0)) === null, 'one finger down keeps follow');
  G.move(T(1, 160, 120, 60));
  ok(G.up(T(1, 160, 120, 400)) === null, 'a one-finger orbit keeps follow');
  G.down(T(2, 100, 100, 1000)); ok(G.up(T(2, 101, 100, 1080)) === null, 'one tap is not a double tap');
  G.down(T(3, 104, 98, 1250)); ok(JSON.stringify(G.up(T(3, 104, 98, 1320))) === '{"follow":true}', 'a double tap turns follow on');
  G.down(T(4, 100, 100, 2000)); ok(JSON.stringify(G.down(T(5, 200, 220, 2040))) === '{"follow":false}', 'a second finger (pinch) turns follow off');
  ok(G.up(T(4, 100, 100, 2100)) === null && G.up(T(5, 200, 220, 2110)) === null, 'the end of a pinch is not a tap');
  G.down(T(6, 100, 100, 2200)); ok(G.up(T(6, 100, 100, 2260)) === null, 'a tap just after a pinch is not a double tap');
  G.down(T(7, 100, 100, 3000)); G.up(T(7, 100, 100, 3050)); G.down(T(8, 100, 100, 3600)); ok(G.up(T(8, 100, 100, 3650)) === null, 'taps far apart in time are not a double tap');
  G.down(T(9, 100, 100, 4000)); G.up(T(9, 100, 100, 4050)); G.down(T(10, 220, 100, 4200)); ok(G.up(T(10, 220, 100, 4250)) === null, 'taps far apart in space are not a double tap');
  G.down(T(11, 100, 100, 5000)); G.up(T(11, 100, 100, 5500)); G.down(T(12, 100, 100, 5600)); ok(G.up(T(12, 100, 100, 5650)) === null, 'a long press is not a tap');
  ok(JSON.stringify(G.down(T(13, 0, 0, 6000, 'mouse', 2))) === '{"follow":false}', 'a right drag (pan) turns follow off');
  G.up(T(13, 0, 0, 6100, 'mouse', 2));
  ok(JSON.stringify(G.down(T(14, 0, 0, 6200, 'mouse', 0, true))) === '{"follow":false}', 'a modifier drag (pan) turns follow off');
  G.up(T(14, 0, 0, 6300, 'mouse'));
  ok(G.down(T(15, 0, 0, 6400, 'mouse', 0)) === null && G.up(T(15, 0, 0, 6450, 'mouse')) === null, 'a left mouse drag orbits and keeps follow');
  ok(G.wheel().follow === false && G.pointers === 0, 'a wheel turns follow off; no pointer stays live');
  G.down(T(16, 0, 0, 7000)); G.cancel(T(16, 0, 0, 7010)); ok(G.pointers === 0, 'pointercancel drops the pointer');

  // the dock clock
  const c0 = dockClock(0, seasonOf), c1 = dockClock(11.8, seasonOf);
  ok(c0.year === 'Year 1' && c0.sub === 'Jan · winter' && c0.frac === 0, `clock at the sowing: ${c0.year} ${c0.sub}`);
  ok(c1.year === 'Year 12' && c1.sub === 'Oct · autumn' && Math.abs(c1.frac - 0.8) < 1e-9, `clock in year 12: ${c1.year} ${c1.sub}`);
  let longest = 0; for (let t = 0; t < 45; t += 0.01) longest = Math.max(longest, dockClock(t, seasonOf).sub.length, dockClock(t, seasonOf).year.length);
  ok(longest <= 12, `the dock clock text stays short (${longest} chars), so it fits 84 px at 11 to 15 px`);
  ok(nextId(SPECIES_IDS, 'oak') === SPECIES_IDS[1] && nextId(SPECIES_IDS, SPECIES_IDS[7]) === SPECIES_IDS[0] && nextId(SPECIES_IDS, 'x') === SPECIES_IDS[0], 'the dock species button cycles all species');
  ok(SPECIES_IDS.every(id => SPECIES[id].label.split(' ').pop().length <= 6), 'dock species names have six letters or fewer');

  // pixel ratio on a slow phone
  const st = { ratio: 1.6, min: 1, slow: 0 };
  let changes = 0; for (let i = 0; i < 30; i++) if (pixelRatioStep(st, 1 / 60)) changes++;
  ok(changes === 0 && st.ratio === 1.6, 'fast frames keep the pixel ratio');
  for (let i = 0; i < 50; i++) if (pixelRatioStep(st, 0.05)) changes++;
  ok(changes === 1 && Math.abs(st.ratio - 1.35) < 1e-9, `2.5 s of slow frames lowers the ratio one step (${st.ratio})`);
  for (let i = 0; i < 400; i++) pixelRatioStep(st, 0.05);
  ok(st.ratio === 1 && pixelRatioStep(st, 0.05) === 0, 'the ratio stops at 1');
  // the phone caps in main.js and render.js
  const mainSrc = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8'), renSrc = fs.readFileSync(new URL('./render.js', import.meta.url), 'utf8');
  ok(/MAX_NODES = COARSE \? 24000/.test(mainSrc) && /LEAF_BUDGET = COARSE \? 40000/.test(mainSrc), 'phones cap 24k metamers and 40k leaves');
  ok(/coarse \? 1\.6 : 2/.test(renSrc) && /SM = coarse \? 2048 : 4096/.test(renSrc), 'phones cap the pixel ratio at 1.6 and the shadow map at 2048');
}

// --- misc ---------------------------------------------------------------------
ok(internode(SPECIES.oak, 0) === SPECIES.oak.L[0] && internode(SPECIES.oak, 99) === SPECIES.oak.L[1], 'internode length ramps from seedling to mature');
ok(TREE_IDS.length === 6 && SPECIES_IDS.length === 8, 'eight species, six of them trees');

console.log(`plant-growth tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

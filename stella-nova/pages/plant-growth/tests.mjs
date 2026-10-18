// ============================================================================
//  PLANT GROWTH  ·  node tests for the DOM-free modules
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/plant-growth/tests.mjs   (exit 1 on a failure)
//  Covers grow.js (growth over time, buds, Borchert-Honda, shedding in
//  shade, pipe model, leaf counts, competition), season.js (the calendar
//  and its GLSL copy), pose.js (packing, frames, the CPU twin), mesh.js,
//  ground.js, roots.js (DLA roots and their GPU rows), saver.js and
//  layout.js (phone layout, occlusion, gestures, dock clock). The DOM and
//  CSS checks at phone viewports are in dom-check.mjs (needs jsdom).
//  Set PG_QUICK=1 to skip the full lives of all species.
// ============================================================================
import { SPECIES, SPECIES_IDS, TREE_IDS, createSim, growLife, standLayout, internode, LEAF_STRIDE, OPEN, KIND } from './grow.js';
import { CAL, leafState, seasonOf, snowCover, girthPhase, deathDrop, deathFade, SEASON_GLSL } from './season.js';
import { COLOUR_MODES, COLOUR_IDS, createHistory, addToHistory, packYear, nodeFrames, nodeShown, leafPose, quatRotate, frameQuat, CELLS, cellIndex, speciesTables, TEX_W } from './pose.js';
import { plantMesh } from './mesh.js';
import { groundY, FLAT_R, grassField, inCutaway, GROUND_GLSL } from './ground.js';
import { createRoots, packRoots } from './roots.js';
import { makeShots, shotPlan, bandFrame, fitDistance, projectedRadius, codeExtract, SHOT_KINDS } from './saver.js';
import { ATLAS_CELLS } from './atlas.js';
import { LOOK, BARKS } from './look.js';
import { rng } from '../../lib/dla-engine.js';
import { scatterProps, decodeMesh } from './props.js';
import { PHONE_QUERY, layoutFor, occlusion, clearFractions, createGestures, dockClock, nextId, pixelRatioStep } from './layout.js';
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
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
  for (let k = 0; k < pk.leafN; k += 17) { const a = leafPose(pk, k, 10.55); if (a) summer.push(a); const b = leafPose(pk, k, 10.97); if (b) late.push(b); }
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

// --- ground and grass ---------------------------------------------------------
{
  ok(groundY(3, 4) === 0 && groundY(0, FLAT_R) === 0, 'the garden is flat');
  ok(groundY(60, 10) !== 0 && Number.isFinite(groundY(200, -300)), 'hills beyond');
  const f = grassField({ n: 5000, seed: 2, avoid: [{ x: 0, z: 0, r: 0.5 }], cut: 2 });
  let bad = 0; for (let k = 0; k < f.length; k += 4) if (Math.hypot(f[k], f[k + 1]) < 0.5 || inCutaway(f[k], f[k + 1], 2)) bad++;
  ok(f.length / 4 > 4000 && bad === 0, 'grass keeps off the trunk and the cut-away');
}

// --- props: scanned rocks, stump, ferns, flowers, grass ----------------------
{
  const table = JSON.parse(fs.readFileSync(new URL('./assets/props.json', import.meta.url)));
  const b = fs.readFileSync(new URL('./assets/props.bin', import.meta.url)), buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  ok(table.bytes === buf.byteLength && table.meshes.length === 33, `props: ${table.meshes.length} meshes in ${buf.byteLength} bytes`);
  let fin = true; for (const m of table.meshes) { const d = decodeMesh(buf, m); if (!finite(d.pos) || !finite(d.uv) || d.idx.some(i => i >= m.n)) fin = false; }
  ok(fin, 'props: decoded meshes are finite and their indices in range');
  const plants = [{ x: 0, z: 0, r: 6, trunk: 0.9 }];
  const a = scatterProps({ seed: 4, meshes: table.meshes, plants, cut: 3 }), c = scatterProps({ seed: 4, meshes: table.meshes, plants, cut: 3 });
  ok(JSON.stringify(a) === JSON.stringify(c), 'props: the same seed places the same props');
  const sets = new Set(a.map(o => o.set));
  ok(['rocks', 'stump', 'fern', 'celandine', 'grass'].every(k => sets.has(k)), 'props: every kind is placed');
  ok(a.every(o => !inCutaway(o.x, o.z, 3) && Math.hypot(o.x, o.z) > 0.9), 'props: none on the trunk or in the cut-away');
  const ph = scatterProps({ seed: 4, meshes: table.meshes, plants, coarse: true });
  ok(ph.length < a.length * 0.7, `props: fewer on a phone (${ph.length} of ${a.length})`);
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
  ok(SHOT_KINDS.every(k => a.some(s => s.kind === k)), 'shots: every kind (life, autumn, grove, spring, heat, winter, summer)');
  ok(a.filter(s => s.kind === 'autumn' || s.kind === 'winter' || s.kind === 'grove').every(s => SPECIES[s.species].form === 'tree'), 'shots: autumn, winter and grove shots show trees');
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

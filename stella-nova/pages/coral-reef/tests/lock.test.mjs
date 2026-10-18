// ============================================================================
//  CORAL REEF  ·  grown corals stay locked in (node, no browser)
//                 node tests/lock.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "the corals get reconstructed over and over
//  in front of my very eyes instead of staying totally locked in".
//  A reef grows to its end in the reef worker (mesh-worker.js, on a fake
//  clock). Then the main camera and two ROV cameras move round the reef
//  for 60 s; the page gets a view message each 0.4 s, as main.js sendView.
//  Each frame of 16 ms: one worker tick, then the page side as main.js:
//  scene.js applyBricks, flushChunks, fine-view.js, render (fake GL).
//    worker ... no fine brick of a colony whose focus did not change is
//               meshed again, and no coarse brick is meshed again (the
//               reef does not grow any more)
//    focus .... the focus changes only when the cameras move far
//               (hysteresis, reef.js holdFocus)
//    frames ... in each frame each colony shows a full mesh: its coarse
//               mesh (no negative radius in the data texture), or its
//               fine mesh complete (the worker field has no brick to
//               mesh, the scene group shows and has no dirty chunk)
//  With an older page (no fine-view.js; CORAL_OLD_DIR = a folder with the
//  old files) the page side is the old rule of main.js 248ce90b
//  (trackFocus: the coarse mesh hides at the first fine brick), so the
//  test shows the old fault.
// ============================================================================
import { installThree, installDom, fakeCanvas } from './fake-gl.mjs';
installThree(); installDom();
const DIR = process.env.CORAL_OLD_DIR ? new URL('file://' + process.env.CORAL_OLD_DIR.replace(/\/?$/, '/')) : new URL('../', import.meta.url);
const imp = f => import(new URL(f, DIR).href);
const { createRock } = await imp('rock/index.js');
const { createReefRunner } = await imp('mesh-worker.js');
const { createReefMirror, SPECIES, createReef, colonyInfo } = await imp('reef.js');
const { createCoralMesher } = await imp('coral-sdf.js');
const { createScene } = await imp('scene.js');
const FV = await imp('fine-view.js').catch(() => null);

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name} ${info}`); } };

const rock = createRock({ seed: 3, radius: 30, quality: 'low' });
let T = 0;
const q = [];
const timers = { set: f => { q.push(f); return q.length; }, clear() {} };
const mirror = createReefMirror();
const f = fakeCanvas({ w: 640, h: 400 });
const S = createScene({ canvas: f.canvas, coarse: false, R: 30, maxParticles: 20000 });
S.resize();
if (S.setFineGate) S.setFineGate(true);
const fineView = FV ? FV.createFineView({ scene: S, reef: () => mirror, now: () => T }) : null;

// the old page rule (main.js 248ce90b trackFocus): a fine brick that holds
// a gid of colony k hides the coarse mesh of k
const legacy = { brickCols: new Map(), focusN: new Map() };
function legacyTrack(list) {
  for (const r of list) {
    if ((r.lod || 0) !== 0) continue;
    const key = `${r.sp}|${r.key}`, old = legacy.brickCols.get(key);
    if (old) for (const k of old) { const n = (legacy.focusN.get(k) || 1) - 1; if (n) legacy.focusN.set(k, n); else legacy.focusN.delete(k); }
    if (!r.indices || !r.indices.length) { legacy.brickCols.delete(key); continue; }
    const set = new Set();
    for (let i = 0; i < r.gids.length; i += 7) { const g = r.gids[i]; if (g >= 0 && g < mirror.count) set.add(mirror.col[g]); }
    for (const k of set) legacy.focusN.set(k, (legacy.focusN.get(k) || 0) + 1);
    legacy.brickCols.set(key, set);
  }
}

let rec = null;                    // the record of the moving phase
let idle = false;
const run = createReefRunner({
  post(m) {
    if (m.type === 'idle') idle = true;
    if (m.type === 'colonies') mirror.setColonies(m.list);
    if (m.type === 'particles') {
      mirror.addParticles(m.from, m.data);
      S.setParticles(m.from, m.from + m.data.length / 8, (g, A, B, o) => { B[o] = -1e3; B[o + 1] = 0.01; });
    }
    if (m.type === 'bricks') {
      S.applyBricks(m.list);
      if (!fineView) legacyTrack(m.list);
      if (rec) for (const r of m.list) {
        const cs = new Set();
        for (let i = 0; i < r.gids.length; i++) { const g = r.gids[i]; if (g >= 0 && g < mirror.count) cs.add(mirror.col[g]); }
        for (const k of cs) { const o = rec.bricks.get(k) || { fine: 0, coarse: 0 }; if (r.lod) o.coarse++; else o.fine++; rec.bricks.set(k, o); }
      }
    }
    if (m.type === 'fine' && fineView) fineView.onFine(m.list);
  },
  makeRock: () => rock, timers, clock: () => T,
});
function frame() {
  T += 16;
  const fn = q.shift(); if (fn) fn();
  S.flushChunks(3.5, T);
  if (fineView) fineView.afterFlush();
  S.render(1 / 60, T);
}

const sites = rock.sampleSurface(16 * 24, null);
await run.onMessage({ type: 'init', seed: 4, quality: 'phone', radius: 30, sites, preset: 'staghorn', budget: { particles: 9000, colonies: 16, tris: 600000 }, rate: Infinity });
const t0 = performance.now();
for (let i = 0; i < 400000 && !(idle && run.reef.done()); i++) frame();
const R = run.reef, M = run.mesher;
ok(R.done(), 'grow: the reef grows to its end in the worker', `${R.count} particles, ${R.colonies.length} colonies in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

// a fine budget for about half of the colonies, so the focus has an edge
const est = c => Math.max(c.count, c.cap * 0.6) * SPECIES[c.id].tpp;
const budget = R.colonies.reduce((a, c) => a + est(c), 0) * 0.45;
const ptsAt = t => {
  const a = t / 60 * Math.PI * 2;
  return [[Math.cos(a) * 14, 5, Math.sin(a) * 14], [Math.cos(-a * 0.7 + 2) * 8, 2, Math.sin(-a * 0.7 + 2) * 8], [Math.cos(a * 0.5 + 4) * 10, 3, Math.sin(a * 0.5 + 4) * 10]];
};
await run.onMessage({ type: 'view', points: ptsAt(0), budget });
idle = false;
for (let i = 0; i < 200000 && !(idle && M.dirty() === 0); i++) frame();
for (let i = 0; i < 30; i++) frame();

// ── the moving phase: 60 s, a view message each 0.4 s ──
rec = { bricks: new Map(), changes: new Map(), bad: [], frames: 0 };
let focus = new Set(M.focus());
const focus0 = new Set(focus);
const colOf = new Map(R.colonies.map(c => [c.k, c]));
function texSign() {
  const neg = new Set();
  S.setParticles(0, mirror.count, (g, A, B, o) => { if (B[o + 1] < 0) neg.add(mirror.col[g]); });
  return neg;
}
function fineFull(k) {
  const c = colOf.get(k);
  if (fineView) {
    const F = M.fields.get(`${c.id}|0|${k}`), st = S.fineState(k);
    return !!(F && !F.wait && F.tree.sdf.dirtyCount === 0 && st && st.shown && st.dirty === 0);
  }
  const F = M.fields.get(`${c.id}|0`) || M.fields.get(`${c.id}|0|${k}`);
  return !!(F && F.tree.sdf.dirtyCount === 0 && S.dirtyChunks === 0);
}
for (let v = 0; v < 150; v++) {
  await run.onMessage({ type: 'view', points: ptsAt(v * 0.4), budget });
  const now = new Set(M.focus());
  for (const k of new Set([...now, ...focus])) if (now.has(k) !== focus.has(k)) rec.changes.set(k, (rec.changes.get(k) || 0) + 1);
  focus = now;
  for (let i = 0; i < 25; i++) {
    frame();
    rec.frames++;
    const hidden = fineView ? texSign() : new Set(legacy.focusN.keys());
    for (const c of R.colonies) {
      if (!hidden.has(c.k)) continue;          // the coarse mesh shows
      if (!fineFull(c.k)) rec.bad.push([rec.frames, c.k]);
    }
  }
}
const same = R.colonies.filter(c => !rec.changes.has(c.k));
const sameIn = same.filter(c => focus0.has(c.k));
let refine = 0, recoarse = 0;
for (const c of same) { const o = rec.bricks.get(c.k); if (o) { refine += o.fine; recoarse += o.coarse; } }
let allCoarse = 0; for (const o of rec.bricks.values()) allCoarse += o.coarse;
const nChange = [...rec.changes.values()].reduce((a, b) => a + b, 0);
console.log(`     ${R.colonies.length} colonies, ${focus0.size} in the focus at the start, ${rec.changes.size} changed focus (${nChange} changes), ${same.length} did not (${sameIn.length} of them fine)`);
ok(same.length > 0 && sameIn.length > 0, 'worker: some focus colonies keep their fine mesh over the 60 s', `${sameIn.length} fine, ${same.length - sameIn.length} coarse`);
ok(refine === 0, 'worker: zero fine bricks meshed again for the colonies whose focus did not change', `${refine} fine bricks`);
ok(recoarse === 0 && allCoarse === 0, 'worker: zero coarse bricks meshed again on the grown reef', `${allCoarse} coarse bricks`);
ok(nChange <= R.colonies.length, 'focus: at most one change per colony on average over the 60 s orbit', `${nChange} changes for ${R.colonies.length} colonies`);
ok(rec.bad.length === 0, 'frames: no frame shows a colony with neither a full fine nor a full coarse mesh', `${rec.bad.length} bad colony-frames of ${rec.frames} frames${rec.bad.length ? ', first ' + rec.bad.slice(0, 3).map(b => b.join(':')).join(' ') : ''}`);

// ── standing still on the grown reef: no focus change at all ──
{
  const pts = ptsAt(59.6);
  const before = M.focus().join(','), b0 = rec.bricks.size;
  rec.bricks.clear();
  for (let v = 0; v < 50; v++) { await run.onMessage({ type: 'view', points: pts.map(p => [p[0] + Math.sin(v) * 0.3, p[1], p[2] + Math.cos(v) * 0.3]), budget }); for (let i = 0; i < 25; i++) frame(); }
  let n = 0; for (const o of rec.bricks.values()) n += o.fine + o.coarse;
  ok(M.focus().join(',') === before && n === 0, 'focus: a camera that only drifts 0.3 m for 20 s changes no focus and meshes no brick', `${n} bricks, ${b0} colonies had bricks before`);
}
// the fine-view module: a drop shows the coarse mesh before the fine group goes
if (fineView) {
  const k = M.focus()[0];
  const st0 = S.fineState(k);
  await run.onMessage({ type: 'view', points: [[500, 50, 500]], budget: 1 });
  for (let i = 0; i < 40; i++) frame();
  const hidden = texSign();
  ok(st0 && st0.shown && !hidden.has(k) && !S.fineState(k) && S.dyingGroups === 0, 'frames: a colony that leaves the focus shows its coarse mesh and its fine group goes', `colony ${k}`);
}

// ── the mesher alone: three staghorn colonies on a flat rock ──
// A and B are in the focus and meshed; then C comes into the focus. No
// brick of A or B may be meshed again (one species: the old mesher had
// one fine field for all three and filled it again).
{
  const flat = { sdf: (x, y) => y, normal: () => [0, 1, 0], radius: 30, sand: { heightAt: () => -50 }, bounds: { min: [-30, -3, -30], max: [30, 8, 30] }, sampleSurface: () => [], features: [] };
  const site = (x, z) => ({ p: [x, 0, z], n: [0, 1, 0], exposure: 1, overhang: false });
  const Rf = createReef({ rock: flat, seed: 5, quality: 'phone' });
  for (const x of [-3, 0, 3]) Rf.addColony('staghorn', site(x, 0), { size: 1.6, cap: 700 });
  Rf.growAll(Infinity, 2e6);
  const Mf = createCoralMesher({ fine: Rf.fine, radius: 30, polyps: 1, lod: true });
  for (const c of Rf.colonies) Mf.addColony(colonyInfo(c));
  for (let g = 0; g < Rf.count; g++) Mf.add(g, Rf.parent[g], Rf.px[g], Rf.py[g], Rf.pz[g], Rf.col[g]);
  Mf.setFocus([0, 1]);
  Mf.update(1e9); Mf.update(1e9);
  Mf.setFocus([0, 1, 2]);
  const out = [];
  for (let i = 0; i < 20; i++) out.push(...Mf.update(1e9));
  let ab = 0, cN = 0;
  for (const r of out) {
    if (r.lod) continue;
    const ks = new Set(); for (const g of r.gids) if (g >= 0) ks.add(Rf.col[g]);
    if (ks.has(0) || ks.has(1) || !r.indices.length) ab++;
    if (ks.has(2)) cN++;
  }
  ok(ab === 0 && cN > 0, 'mesher: a new focus colony meshes only its own bricks; the fine bricks of the other colonies of its species stay', `${ab} bricks of A and B (or removals), ${cN} bricks of C (${Rf.count} particles)`);
}

console.log(`\nlock: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

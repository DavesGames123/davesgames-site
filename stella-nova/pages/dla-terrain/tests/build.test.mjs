// tests/build.test.mjs — "Watch it build" checks (node; jsdom for the bar).
// Run alone: JSDOM_DIR=<a folder with node_modules/jsdom> node stella-nova/pages/dla-terrain/tests/build.test.mjs
//
// The user asked (2026-10-17): "make sure we have an animated verison of the
// DLA terrain where we can see it being built up one stage at a time as an
// option both for screensaver and for the main page".
//
// What it checks: the timeline (8 stages in the generator order, the
// durations, segStart and locate agree), the scrub maps to the right stage
// at every time, every stage has a caption and a name, the recorder keeps
// a real generation (lib/dla-terrain.js at n 256) with every stage, the
// player plan (stateAt) for each stage (flat ground and the growing tree
// in DLA, ridges rise in upscale, rays then channels in flow, rivers,
// erosion with a base, climate, veil then water then plants in biomes),
// the held clock while the generator is behind, determinism (the same
// seed gives the same frames and the same plan), the overlay fields, the
// walkers, the camera plan (top-down DLA, oblique, low over rivers), the
// saver build channel (seeded, all build shots, speed from the shell
// seconds, label with stage and caption), and in jsdom the bar: the
// toggle, eight stage cells, 44 px targets, Play/Pause, Prev, Next, the
// speed, the scrub and Close call the app, and the bar fits 360 px.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  SEGMENTS, TOTAL_S, SPEEDS, segStart, locate, timeOfSeg, createRecorder, ready, stateAt, camFor, walkers,
  treeField, raysField, flowField, erosionField, climateField, captionOf, shrink,
} from '../build.js';
import { buildShotPlan, buildSpeed, shotLabel, BUILD_SHOT, SHOT_CODE, extractFn } from '../saver.js';
import { STAGE_IDS, generateTerrain, PRESETS } from '../../../lib/dla-terrain.js';
import { createHash } from 'node:crypto';

const here = p => fileURLToPath(new URL('../' + p, import.meta.url));
let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} build: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} build: ${name} ${extra}`); }
}

// ── timeline
ok(SEGMENTS.map(s => s.id).join() === STAGE_IDS.join(), 'the 8 segments are the generator stages in order', SEGMENTS.map(s => s.id).join());
ok(SEGMENTS.every(s => s.dur >= 6 && s.dur <= 16), 'each stage plays 6 to 16 s at 1x', SEGMENTS.map(s => s.dur).join());
ok(TOTAL_S === SEGMENTS.reduce((a, s) => a + s.dur, 0) && TOTAL_S >= 60 && TOTAL_S <= 100, `the whole build is ${TOTAL_S} s at 1x`);
ok(SEGMENTS[0].dur === Math.max(...SEGMENTS.map(s => s.dur)), 'DLA growth has the longest stage');
ok(SEGMENTS.every(s => s.caption && s.caption.length > 60 && s.caption.length < 200 && /\.$/.test(s.caption) && s.name && s.label && s.label.length <= 8),
  'every stage has a name, a short bar label and a caption (what and why)');
ok(SEGMENTS.every(s => s.phases.length >= 1 && s.phases[0][1] === 0 && s.phases.every((p, i) => i === 0 || p[1] > s.phases[i - 1][1])), 'phases start at 0 and rise');
ok(SEGMENTS.find(s => s.id === 'biomes').phases.map(p => p[0]).join() === 'colour,water,vegetation', 'biomes: colour, then water, then vegetation');
ok(SEGMENTS.find(s => s.id === 'rivers').phases.map(p => p[0]).join() === 'accumulate,beds', 'rivers: accumulation lights up, then the beds');
ok(SPEEDS.includes(1) && SPEEDS.length >= 3, 'speeds include 1x');
{
  let okScrub = true, prev = -1, bad = '';
  for (let k = 0; k <= 1000; k++) {
    const t = k / 1000 * TOTAL_S, L = locate(t);
    if (L.i < prev) { okScrub = false; bad = 'not monotone at ' + t; break; }
    prev = L.i;
    if (!(t >= segStart(L.i) - 1e-9 && (t < segStart(L.i) + SEGMENTS[L.i].dur + 1e-9))) { okScrub = false; bad = 't ' + t + ' i ' + L.i; break; }
    if (Math.abs(timeOfSeg(L.i, L.u) - t) > 1e-6) { okScrub = false; bad = 'timeOfSeg ' + t; break; }
  }
  ok(okScrub, 'the scrub maps every time to its stage (monotone, inside, invertible)', bad);
  ok(SEGMENTS.every((s, i) => locate(segStart(i) + 0.01).i === i && locate(segStart(i) + s.dur - 0.01).i === i), 'each stage start and end map to that stage');
  ok(locate(-5).i === 0 && locate(TOTAL_S + 5).i === 7 && locate(TOTAL_S).u === 1, 'the scrub clamps at both ends');
}

// ── a real generation, recorded
async function record(preset, seed, n = 256) {
  const rec = createRecorder({ maxN: 128 });
  const order = [];
  const t = await generateTerrain({ ...PRESETS[preset].opts, seed, n }, p => { order.push(p.stage); rec.add(p); });
  rec.finish(t);
  return { rec, t, order };
}
const A = await record('alpine', 7);
{
  const { rec, t } = A;
  ok(SEGMENTS.every(s => rec.frames(s.id).length > 0), 'the recorder keeps frames of all 8 stages', SEGMENTS.map(s => s.id + ':' + rec.frames(s.id).length).join(' '));
  ok(rec.order.every(f => f.snap.n <= 128) && rec.order.some(f => f.snap.n === 128), 'snapshots over maxN are shrunk to maxN');
  const L = rec.dlaLevels();
  ok(L >= 2 && Array.from({ length: L }, (_, k) => rec.levelFrame(k)).every(Boolean), `every one of the ${L} DLA levels has its last snapshot`);
  const lf = rec.levelFrame(L - 1).snap.dla;
  ok(lf.count > lf.start && lf.start > 0 && lf.pos.length === lf.count * 2, 'the DLA snapshot has the level start (the copied tree) and the new particles');
  const fl = rec.frames('flow')[0].snap;
  ok(fl.rays && fl.rays.off.length > 50 && fl.rays.pts.length > 1000, 'the flow snapshot carries the ray paths', fl.rays && (fl.rays.off.length - 1) + ' rays');
  ok(rec.frames('erosion').length >= 3 && rec.frames('erosion').at(-1).snap.sediment, 'erosion has several snapshots, the last with sediment');
  ok(rec.frames('climate')[0].snap.temperature && rec.frames('climate')[0].snap.moisture, 'climate has temperature and moisture');
  ok(rec.frames('biomes').at(-1).snap.biome && rec.terrain === t, 'biomes has the biome snapshot and the final terrain');
  ok([...Array(1001).keys()].every(k => ready(rec, k / 1000 * TOTAL_S)), 'with all data recorded, every time is ready');
  ok(shrink(new Float32Array([1, 2, 3, 4]), 2, 2).length === 4 && shrink(new Float32Array(16).map((_, i) => i), 4, 2).join() === '5,7,13,15', 'shrink is a nearest resample');
}

// ── the plan of each stage
{
  const { rec } = A;
  const at = (id, u) => stateAt(rec, timeOfSeg(SEGMENTS.findIndex(s => s.id === id), u));
  const d0 = at('dla', 0.02), d1 = at('dla', 0.6);
  ok(d0.ground.kind === 'flat' && d0.overlay.kind === 'tree' && d0.overlay.reveal < 0.5, 'DLA: flat ground, the tree starts to grow');
  ok(d1.overlay.kind === 'tree' && d1.level > d0.level, 'DLA: later times show finer levels', `${d0.level} -> ${d1.level}`);
  const lv = rec.dlaLevels();
  const reveals = [0.01, 0.05, 0.1, 0.15, 0.2].map(u => at('dla', u / lv).overlay.reveal);
  ok(reveals.every((v, i) => i === 0 || v > reveals[i - 1]), 'DLA: the reveal grows through a level', reveals.map(v => v.toFixed(2)).join());
  const u0 = at('upscale', 0.02), u1 = at('upscale', 0.9);
  ok(u0.ground.kind === 'frame' && u1.ground.kind === 'frame' && u1.ground.frame.at > u0.ground.frame.at, 'upscale: the ground steps through the upscale snapshots');
  ok(u0.overlay.kind === 'tree' && u0.overlay.amount > 0.9 && u1.overlay.amount < 0.05, 'upscale: the tree fades as the ridges rise');
  ok(at('shape', 0.5).ground.frame.stage === 'shape', 'shape: the shaped ground');
  const f0 = at('flow', 0.2), f1 = at('flow', 0.9);
  ok(f0.overlay.kind === 'rays' && f0.overlay.reveal > 0.2 && f0.overlay.reveal < 0.6 && f0.overlay.amount2 < 0.05, 'flow: the rays fan out first');
  ok(f0.ground.frame.stage === 'shape' && f1.ground.frame.stage === 'flow' && f1.overlay.amount2 > 0.3, 'flow: then the channels show and cut the valleys');
  const r0 = at('rivers', 0.3), r1 = at('rivers', 0.9);
  ok(r0.overlay.kind === 'flow' && r0.overlay.reveal < 1 && r1.overlay.amount2 > 0.5 && r1.ground.frame.stage === 'rivers', 'rivers: the flow lights up, then the rivers');
  const e0 = at('erosion', 0.1), e1 = at('erosion', 0.95);
  ok(e0.overlay.kind === 'erosion' && e0.overlay.base && e0.ground.frame.stage === 'erosion' && e1.ground.frame.at > e0.ground.frame.at, 'erosion: the snapshots step on, tinted against the river stage');
  const c0 = at('climate', 0.25), c1 = at('climate', 0.8);
  ok(c0.overlay.kind === 'climate' && c0.overlay.amount > 0.8 && c0.overlay.amount2 < 0.1 && c1.overlay.amount2 > 0.8 && c1.overlay.amount < 0.1, 'climate: temperature, then moisture');
  const b0 = at('biomes', 0.05), b1 = at('biomes', 0.5), b2 = at('biomes', 0.85);
  ok(b0.veil > 0.8 && !b0.rivers && !b0.veg && b0.ground.kind === 'snapFinal', 'biomes: grey first (the colour fades in)');
  ok(b1.veil === 0 && b1.rivers && !b1.veg && b1.ground.kind === 'final', 'biomes: then the water (the final terrain)');
  ok(b2.veg && b2.rivers, 'biomes: then the vegetation');
  const keys = [];
  for (let k = 0; k <= 400; k++) keys.push(stateAt(rec, k / 400 * TOTAL_S).ground.key);
  const changes = keys.filter((x, i) => i && x !== keys[i - 1]).length;
  ok(changes >= 10 && changes <= 60, `the ground changes ${changes} times over the build (not every frame)`);
  ok(SEGMENTS.every((s, i) => { const c = captionOf(stateAt(rec, timeOfSeg(i, 0.5))); return c.caption === s.caption && c.name.startsWith(s.name) && c.index === i; }), 'captionOf names the stage and its caption');
}

// ── the held clock: a recorder that is behind
{
  const rec = createRecorder({ maxN: 64 });
  ok(!ready(rec, 0), 'nothing recorded: the clock holds at the start');
  for (const p of A.rec.order.filter(f => f.stage === 'dla').slice(0, 4)) rec.add({ stage: p.stage, label: p.label, frac: p.frac, stageFrac: p.stageFrac, snapshot: { ...p.snap } });
  ok(ready(rec, 0.1) && !ready(rec, timeOfSeg(0, 0.99)), 'level 1 grown: its part plays, the last level holds');
  ok(!ready(rec, timeOfSeg(3, 0.1)), 'branched flow not computed: that stage holds');
  ok(stateAt(rec, timeOfSeg(4, 0.5)).ground.kind === 'flat' || stateAt(rec, timeOfSeg(4, 0.5)).ground.frame === null || true, 'a plan with missing data does not throw');
}

// ── determinism
{
  const B = await record('alpine', 7);
  const hashRec = r => { const h = createHash('sha256'); for (const f of r.order) { h.update(f.stage); h.update(Buffer.from(f.snap.height.buffer)); } return h.digest('hex').slice(0, 16); };
  ok(hashRec(A.rec) === hashRec(B.rec) && A.rec.order.length === B.rec.order.length, 'the same seed records the same frames', hashRec(A.rec) + ' ' + hashRec(B.rec));
  const plan = r => JSON.stringify([0, 3, 9, 17, 25, 33, 41, 50, 60, 70, TOTAL_S].map(t => { const s = stateAt(r, t); return [s.i, s.phase, s.ground.key, s.overlay.key, +s.overlay.reveal.toFixed(4), +s.veil.toFixed(4)]; }));
  ok(plan(A.rec) === plan(B.rec), 'the same seed gives the same plan');
  const C = await record('alpine', 8);
  ok(hashRec(C.rec) !== hashRec(A.rec), 'a new seed records new frames');
}

// ── overlay fields and walkers
{
  const { rec } = A;
  const lv = rec.dlaLevels(), tree = rec.levelFrame(lv - 1).snap.dla, ws = A.t.worldSize;
  const tf = treeField(tree, ws, 256);
  let lit = 0, early = 0, late = 0;
  for (let i = 0; i < 256 * 256; i++) { if (tf.data[i * 4 + 1] > 0) { lit++; if (tf.data[i * 4] <= 0.001) early++; else if (tf.data[i * 4] > 0.5) late++; } }
  ok(tf.n === 256 && lit > 500 && early > 50 && late > 50, `the tree field draws the branches (${lit} lit texels, ${early} from the level before, ${late} late)`);
  const rf = raysField(rec.frames('flow')[0].snap, ws, 256);
  let rays = 0, mxk = 0;
  for (let i = 0; i < 256 * 256; i++) if (rf.data[i * 4] < 2) { rays++; mxk = Math.max(mxk, rf.data[i * 4]); }
  ok(rays > 2000 && mxk > 0.2 && mxk <= 1.01, `the ray field holds the fans (${rays} texels, keys to ${mxk.toFixed(2)})`);
  const ff = flowField(rec.frames('rivers')[0].snap);
  let trunk = 0;
  for (let i = 0; i < ff.n * ff.n; i++) if (ff.data[i * 4 + 1] > 0.8 && ff.data[i * 4] < 0.25) trunk++;
  ok(trunk > 0, 'the flow field shows the trunks first (high flow, low key)');
  const ef = erosionField(rec.frames('erosion').at(-1).snap, rec.frames('rivers')[0]);
  let cut = 0, dep = 0;
  for (let i = 0; i < ef.n * ef.n; i++) { if (ef.data[i * 4 + 1] > 0.1) cut++; if (ef.data[i * 4 + 2] > 0.1) dep++; }
  ok(cut > 20 && dep > 20, `the erosion field has cuts (${cut}) and deposits (${dep})`);
  const cf = climateField(rec.frames('climate')[0].snap);
  let cmin = 1, cmax = 0;
  for (let i = 0; i < cf.n * cf.n; i++) { cmin = Math.min(cmin, cf.data[i * 4 + 1]); cmax = Math.max(cmax, cf.data[i * 4 + 1]); }
  ok(cmax - cmin > 0.15, 'the climate field spans a range of temperature');
  const w = walkers(tree, 0.4, 64, 3.2, ws), w2 = walkers(tree, 0.4, 64, 3.2, ws);
  const on = [...Array(64).keys()].filter(j => w[j * 4 + 2] > 0);
  ok(on.length === 64 && w.join() === w2.join(), 'walkers: 64 lit, the same for the same time');
  const near = on.filter(j => j < 4).every(j => {
    const p = Math.floor(tree.start + (0.4 + (j + 0.5) / 64 * 0.14) * (tree.count - tree.start));
    return Math.hypot(w[j * 4] - tree.pos[p * 2], w[j * 4 + 1] - tree.pos[p * 2 + 1]) < ws * 0.02;
  });
  ok(near, 'walkers about to stick sit next to their particle');
  ok(walkers(tree, 1, 8, 0, ws).every((v, i) => i % 4 !== 2 || v === 0), 'a grown level has no walkers');
}

// ── camera plan
{
  const c0 = camFor(0, 0.5, { yaw0: 1 }), c1 = camFor(1, 1, { yaw0: 1, t: 20 }), cr = camFor(4, 0.9, { yaw0: 1, t: 50 }), cp = camFor(4, 0.9, { yaw0: 1, t: 50, portrait: true });
  ok(c0.pitch < -1.4 && c0.distK >= 1, 'DLA is seen top-down over the whole world');
  ok(c1.pitch > -0.7 && c1.pitch < -0.4 && c1.yaw !== 1, 'as the relief rises the camera turns oblique and orbits');
  ok(cr.low && cr.pitch > -0.3 && cr.distK < 0.4, 'low over the rivers');
  ok(cp.distK > cr.distK, '9:16 frames from farther');
  let smooth = true;
  for (let k = 1; k <= 1000; k++) {
    const a = locate((k - 1) / 1000 * TOTAL_S), b = locate(k / 1000 * TOTAL_S);
    const ca = camFor(a.i, a.u, { t: (k - 1) / 1000 * TOTAL_S }), cb = camFor(b.i, b.u, { t: k / 1000 * TOTAL_S });
    if (a.i === b.i && (Math.abs(ca.pitch - cb.pitch) > 0.05 || Math.abs(ca.distK - cb.distK) > 0.05)) smooth = false;
  }
  ok(smooth, 'inside a stage the camera plan moves smoothly');
}

// ── saver build channel
{
  const a = buildShotPlan(5, 6, { channel: 'build' }), b = buildShotPlan(5, 6, { channel: 'build' }), c = buildShotPlan(6, 6, { channel: 'build' });
  ok(a.length === 6 && a.every(s => s.kind === 'build' && s.regen && s.cam.type === 'build'), 'the build channel: every shot builds a new world');
  ok(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c), 'the build channel is seeded');
  ok(new Set(a.map(s => s.seed)).size === 6 && new Set(a.map(s => s.preset.toFixed(3))).size >= 4, 'each shot has its own seed and preset pick (variety)');
  ok(a.every(s => s.dur > TOTAL_S / s.speed && s.tod > 0.25 && s.tod < 0.72 && s.weather), 'a build shot lasts the whole build, in daylight');
  ok(buildSpeed(30) === 2.94 && buildSpeed(0) === 1.25 && buildSpeed(1000) === 1 && buildSpeed(5) === 4, 'the speed fits the shell page time (1 to 4x)', [buildSpeed(30), buildSpeed(0), buildSpeed(1000), buildSpeed(5)].join());
  ok(buildShotPlan(5, 24)[0].kind === 'forming' && !buildShotPlan(5, 24).some(s => s.kind === 'build'), 'the mixed plan stays as it was');
  ok(BUILD_SHOT.total === TOTAL_S, 'the saver uses the real build length');
  const st = stateAt(A.rec, timeOfSeg(3, 0.3));
  const cap = captionOf(st);
  const L = shotLabel(a[0], { preset: 'Alpine', seed: 9, worldSize: 16000, n: 1024, tod: 0.3, weather: 'Fair', build: { name: cap.name, caption: cap.caption, index: cap.index, label: cap.label } });
  ok(/Watch it build · Branched flow/.test(L.sub) && L.lines[0] === SEGMENTS[3].caption && L.params[0].name === 'Stage' && L.params[0].value === '4 of 8 · Flow', 'the plate names the stage and shows its caption');
  const src = readFileSync(here(SHOT_CODE.build[0]), 'utf8');
  ok(!!extractFn(src, SHOT_CODE.build[1]), 'the build shot has a real code extract for the plate');
}

// ── jsdom: the bar
let JSDOM = null, VirtualConsole = null;
try {
  const d = process.env.JSDOM_DIR;
  if (d && existsSync(d + '/node_modules/jsdom')) ({ JSDOM, VirtualConsole } = await import(pathToFileURL(d + '/node_modules/jsdom/lib/api.js').href));
  else if (process.env.NODE_PATH) ({ JSDOM, VirtualConsole } = createRequire(process.env.NODE_PATH.split(':')[0] + '/')('jsdom'));
} catch { JSDOM = null; }
if (!JSDOM) console.log('# build: jsdom not found (set JSDOM_DIR): the bar checks are skipped');
else {
  const html = readFileSync(here('index.html'), 'utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
  const css = readFileSync(here('style.css'), 'utf8');
  const { createUI } = await import('../ui.js');
  for (const [W, H, coarse] of [[360, 740, true], [1440, 900, false]]) {
    const dom = new JSDOM(html.replace('<link rel="stylesheet" href="style.css">', `<style>${css}</style>`), { url: 'http://localhost/stella-nova/pages/dla-terrain/', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
    const win = dom.window, doc = win.document;
    win.matchMedia = q => ({ matches: coarse ? /max-width:768px|coarse/.test(q) : false, addEventListener() {} });
    Object.defineProperty(win, 'innerWidth', { value: W }); Object.defineProperty(win, 'innerHeight', { value: H });
    win.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ data: new Uint8ClampedArray(4) })), set: (t, k, v) => { t[k] = v; return true; } });
    const calls = [];
    const app = {
      buildMode: false, layers: {}, look: { ev: 0, bloom: 0, fov: 50 }, opts: {}, lib: { PRESETS: {} }, veg: {}, water: {}, locks: new Set(), hist: { pos: () => 0, size: () => 0, canBack: () => false, canForward: () => false },
      setBuildMode: on => { calls.push('mode:' + on); app.buildMode = on; },
      build: { play: () => calls.push('play'), step: d => calls.push('step' + d), seekFrac: f => calls.push('seek:' + f.toFixed(2)), seekSeg: i => calls.push('seg:' + i), speed: () => calls.push('speed'), close: () => calls.push('close') },
    };
    let ui;
    try { ui = createUI(app, doc); } catch (e) { ok(false, `${W}: createUI runs`, e.message); continue; }
    const tag = `${W}x${H}`;
    const bar = doc.getElementById('build');
    ok(bar && bar.hidden, `${tag}: the bar is hidden until a build plays`);
    const btn = doc.getElementById('buildBtn');
    ok(btn && btn.getAttribute('aria-pressed') === 'false' && btn.closest('section.tab[data-tab="terrain"]'), `${tag}: the toggle is in the Terrain tab (the phone sheet too)`);
    btn.click();
    ok(calls.includes('mode:true'), `${tag}: the toggle turns the mode on`);
    ui.syncBuild();
    ok(btn.getAttribute('aria-pressed') === 'true' && btn.classList.contains('on'), `${tag}: the toggle shows on`);
    ui.buildSync({ t: 20, total: TOTAL_S, i: 1, u: 0.5, name: 'Upscale', caption: SEGMENTS[1].caption, label: 'Upscale', playing: true, held: false, ended: false, speed: 2 });
    ok(!bar.hidden && doc.body.classList.contains('building'), `${tag}: a sync shows the bar`);
    ok(doc.getElementById('bdStage').textContent === 'Upscale' && doc.getElementById('bdCap').textContent === SEGMENTS[1].caption, `${tag}: the stage name and caption`);
    const cells = doc.querySelectorAll('#bdStages li');
    ok(cells.length === 8 && cells[1].classList.contains('on') && cells[0].classList.contains('done') && !cells[2].classList.contains('done'), `${tag}: 8 stage cells, the second on`);
    ok(doc.getElementById('bdSpeed').textContent === '2×' && doc.getElementById('bdPlay').getAttribute('aria-label') === 'Pause', `${tag}: speed and Pause shown`);
    ok(Math.abs(+doc.getElementById('bdScrub').value - Math.round(20 / TOTAL_S * 1000)) <= 1, `${tag}: the scrub follows the clock`);
    for (const [id, want] of [['bdPlay', 'play'], ['bdPrev', 'step-1'], ['bdNext', 'step1'], ['bdSpeed', 'speed'], ['bdClose', 'close']]) {
      doc.getElementById(id).click();
      ok(calls.at(-1) === want, `${tag}: ${id} calls ${want}`);
    }
    cells[5].querySelector('button').click();
    ok(calls.at(-1) === 'seg:5', `${tag}: a stage cell jumps to that stage`);
    const sc = doc.getElementById('bdScrub');
    sc.value = '500'; sc.dispatchEvent(new win.Event('input'));
    ok(calls.at(-1) === 'seek:0.50', `${tag}: the scrub seeks`);
    ui.buildSync({ t: TOTAL_S, total: TOTAL_S, i: 7, u: 1, name: 'Biomes', caption: SEGMENTS[7].caption, label: 'Biomes', playing: true, held: false, ended: true, speed: 1 });
    ok(doc.getElementById('bdPlay').textContent === '↻' && [...cells].every(c => c.classList.contains('done')), `${tag}: at the end Play becomes Replay`);
    ui.buildSync({ t: 30, total: TOTAL_S, i: 3, u: 0.1, name: 'Branched flow · rays', caption: SEGMENTS[3].caption, label: 'Flow', playing: true, held: true, ended: false, speed: 1 });
    ok(/computing/.test(doc.getElementById('bdStage').textContent), `${tag}: a held clock says the stage is computing`);
    ok(ui.overlays().length >= 1, `${tag}: the bar counts in the clear rect`);
    ui.buildShow(false);
    ok(bar.hidden && !doc.body.classList.contains('building'), `${tag}: buildShow(false) hides it`);
  }
  // 44 px targets and the 360 px fit, from the CSS rules
  const touch = css.slice(css.indexOf('/* touch: 44 px targets'));
  ok(/#bdStages\{height:44px\}/.test(touch) && /#bdScrub\{height:44px/.test(touch) && /\.bd-ctl button\{height:44px\}/.test(touch), 'touch: the stage cells, scrub and buttons are 44 px tall');
  ok(/#bdPlay\{flex-basis:56px/.test(css) && /\.bd-ctl button\{flex:0 0 44px/.test(css), 'the control buttons are 44 px (Play 56 px) wide');
  const ctlW = 4 * 44 + 56 + 4 * 6, inner = 360 - 16 - 16 - 2;
  ok(ctlW <= inner, `the control row (${ctlW} px) fits a 360 px phone (${inner} px inside the bar)`);
  ok(/#build,body\.panel-open #build\{top:calc\(var\(--top-h\) \+ 4px\);left:calc\(8px/.test(css), 'phone: the bar spans the width with 8 px margins');
  ok(/body\.building #map\{display:none\}/.test(css), 'phone: the map inset steps aside while the bar shows');
}

console.log(`# build: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

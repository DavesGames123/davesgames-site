// ============================================================================
//  CORAL REEF  ·  one camera feed per ROV in the old render budget (node)
//                 node tests/feeds.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "we should be able to see the camera from all
//  three ROV's on the right side". rov/feeds.js gives every ROV a feed and
//  spends the budget of the old single feed on all of them. Checks:
//    rr ........ the weighted round robin gives 3:1:1, spread out
//    budget .... with a stand-in renderer, for each profile and 2 to 4
//                ROVs: the scene renders a second of all the feeds are not
//                more than the old single feed (and at most one a main
//                frame), the pixels a second are not more, the main feed
//                gets the most; one shown card (phone) gets the full rate;
//                SSTV starts one capture a frame at most; sync and sizes
//    cards ..... the small card HUD (rov/hud.js) and the ROV colours
// ============================================================================
import * as THREE from '../../../vendor/three@0.160.0/build/three.module.js';
import { createFeed } from '../rov/feed.js';
import { createFeedSet, createScheduler, liveShares, feedSizeFor, FEED_WEIGHT } from '../rov/feeds.js';
import { drawHud, hudFields, ROV_COLOURS, rovColour } from '../rov/hud.js';
import { PROFILES, PROFILE_ORDER } from '../budget.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name} ${info}`); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ── a stand-in renderer that counts the scene renders ──────────────────────
function fakeRenderer() {
  const calls = { scene: 0, quad: 0, read: 0, px: 0, perFrame: 0, maxPerFrame: 0 };
  let tgt = null, vp = new THREE.Vector4(0, 0, 1280, 720), sc = new THREE.Vector4(0, 0, 1280, 720), st = false;
  const R = {
    capabilities: { isWebGL2: true }, extensions: { has: () => true }, shadowMap: { autoUpdate: true }, autoClear: true,
    getRenderTarget: () => tgt, setRenderTarget: (t) => { tgt = t; }, clear: () => {},
    render: (s, c) => {
      if (c.isPerspectiveCamera) { calls.scene++; calls.perFrame++; if (tgt) calls.px += tgt.width * tgt.height; }
      else calls.quad++;
    },
    readRenderTargetPixels: () => { calls.read++; },
    getViewport: (v) => v.copy(vp), setViewport: (x, y, w, h) => { if (x.isVector4) vp.copy(x); else vp.set(x, y, w, h); },
    getScissor: (v) => v.copy(sc), setScissor: (x, y, w, h) => { if (x.isVector4) sc.copy(x); else sc.set(x, y, w, h); },
    getScissorTest: () => st, setScissorTest: (v) => { st = v; },
    getSize: (v) => v.set(1280, 720), getPixelRatio: () => 1,
  };
  const frame = () => { calls.maxPerFrame = Math.max(calls.maxPerFrame, calls.perFrame); calls.perFrame = 0; };
  return { R, calls, frame };
}
const vehicles = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, camera: new THREE.PerspectiveCamera(60, 1.25, 0.05, 100), group: { position: { y: 0 } } }));

// ── the round robin ────────────────────────────────────────────────────────
{
  const S = createScheduler(), n = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 500; i++) n[S.pick([{ id: 1, w: 3 }, { id: 2, w: 1 }, { id: 3, w: 1 }])]++;
  ok(n[1] === 300 && n[2] === 100 && n[3] === 100, 'rr: the weighted round robin gives the main feed 3 of 5 frames and each other 1', JSON.stringify(n));
  const seq = []; const S2 = createScheduler();
  for (let i = 0; i < 10; i++) seq.push(S2.pick([{ id: 1, w: 3 }, { id: 2, w: 1 }, { id: 3, w: 1 }]));
  let run = 0, maxRun = 0; for (let i = 0; i < seq.length; i++) { run = i && seq[i] === seq[i - 1] ? run + 1 : 1; maxRun = Math.max(maxRun, run); }
  ok(maxRun <= 2, 'rr: the frames are spread (no long run of one feed)', seq.join(''));
  const sh = liveShares([1, 2, 3], 1, 30);
  ok(near(sh[1], 18) && near(sh[2], 6) && near(sh[3], 6), 'rr: 30 fps and 3 ROVs: main 18 fps, others 6 fps', JSON.stringify(sh));
  const sh1 = liveShares([1, 2, 3], 2, 15, [2]);
  ok(sh1[2] === 15 && sh1[1] === 0 && sh1[3] === 0, 'rr: one shown card (phone) gets the full rate', JSON.stringify(sh1));
  ok(FEED_WEIGHT.main === 3 && FEED_WEIGHT.other === 1, 'rr: the weights are 3 and 1');
}

// ── the render budget per profile ──────────────────────────────────────────
const budgetRows = [];
for (const pid of PROFILE_ORDER) {
  const prof = PROFILES[pid], fps = prof.feed.fps, secs = 10, hz = 60;
  // the old cost: one feed
  const old = fakeRenderer();
  const V1 = vehicles(1);
  const f1 = createFeed(THREE, { renderer: old.R, scene: new THREE.Scene(), mode: 'live', size: prof.feed, adapt: false, worker: false, document: null, getVehicle: () => V1[0] });
  for (let i = 0; i < secs * hz; i++) { f1.update(1 / hz); old.frame(); }
  f1.dispose();
  for (const n of [2, 3, 4]) {
    const now = fakeRenderer(), V = vehicles(n);
    const set = createFeedSet(THREE, { renderer: now.R, scene: new THREE.Scene(), mode: 'live', size: prof.feed, adapt: false, worker: false, document: null, getVehicle: (id) => V.find(v => v.id === id), ids: V.map(v => v.id), main: 2 });
    for (let i = 0; i < secs * hz; i++) { set.update(1 / hz); now.frame(); }
    const per = set.stats.perId, others = V.filter(v => v.id !== 2).map(v => per[v.id]);
    budgetRows.push(`${pid} n=${n}: old ${old.calls.scene / secs}/s ${(old.calls.px / secs / 1e6).toFixed(2)} Mpx/s, new ${now.calls.scene / secs}/s ${(now.calls.px / secs / 1e6).toFixed(2)} Mpx/s, main ${per[2] / secs}/s, each other ${others.map(x => x / secs).join(',')}/s`);
    ok(now.calls.scene <= old.calls.scene + 1 && now.calls.maxPerFrame <= 1, `budget ${pid}, ${n} ROVs: scene renders a second of all the feeds <= the old single feed (${fps} fps), one a frame at most`, `${now.calls.scene} vs ${old.calls.scene}, max ${now.calls.maxPerFrame} a frame`);
    ok(now.calls.px <= old.calls.px * 1.001, `budget ${pid}, ${n} ROVs: rendered pixels a second <= the old feed`, `${now.calls.px} vs ${old.calls.px}`);
    ok(others.every(x => x > 0 && per[2] > x), `budget ${pid}, ${n} ROVs: every feed gets frames and the main (selected) feed the most`, JSON.stringify(per));
    // one shown card (phone): the full rate to it alone
    set.setActiveIds([2]);
    const s0 = Object.assign({}, set.stats.perId);
    for (let i = 0; i < secs * hz; i++) { set.update(1 / hz); now.frame(); }
    const got = set.stats.perId[2] - s0[2], rest = V.filter(v => v.id !== 2).reduce((s, v) => s + set.stats.perId[v.id] - s0[v.id], 0);
    ok(rest === 0 && Math.abs(got - fps * secs) <= 1, `budget ${pid}, ${n} ROVs: one shown card gets the full ${fps} fps, the hidden ones none`, `${got} / ${rest}`);
    set.dispose();
  }
}
for (const r of budgetRows) console.log(`     ${r}`);
{
  // SSTV: one capture a main frame at most, with 4 feeds that all want one
  const now = fakeRenderer(), V = vehicles(4);
  const set = createFeedSet(THREE, { renderer: now.R, scene: new THREE.Scene(), mode: 'r8', size: { w: 320, h: 256, fps: 30 }, adapt: false, worker: false, document: null, getVehicle: (id) => V.find(v => v.id === id), ids: [1, 2, 3, 4], main: 1 });
  let maxReads = 0;
  for (let i = 0; i < 30; i++) { const r0 = now.calls.read; set.update(1 / 60); maxReads = Math.max(maxReads, now.calls.read - r0); }
  ok(now.calls.read === 4 && maxReads === 1, 'budget sstv: 4 feeds start their first pictures on 4 frames, one capture a frame', `${now.calls.read} reads, ${maxReads} max a frame`);
  set.setMode('live');
  ok(set.live && set.ids.every(id => set.feedOf(id).live), 'budget sstv: setMode goes to every feed');
  set.sync([1, 2]);
  ok(set.ids.join() === '1,2' && set.size.w === 320, 'budget: sync to 2 ROVs drops feeds 3 and 4 and gives the full size again', JSON.stringify(set.size));
  set.sync([1, 2, 3]);
  ok(set.ids.join() === '1,2,3' && set.size.w === 240 && set.vehicle === 1, 'budget: 3 ROVs: 0.75 x size; the main feed holds', JSON.stringify(set.size));
  set.dispose();
  const fs = feedSizeFor({ w: 224, h: 180, fps: 15 }, 4);
  ok(fs.w === 168 && fs.h === 136 && fs.fps === 15, 'budget: feedSizeFor scales 4 feeds to 0.75 (multiples of 4)', JSON.stringify(fs));
}

// ── the cards ──────────────────────────────────────────────────────────────
{
  const ops = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { ops.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; ops.push(['set', k, v]); return true; } });
  const info = { id: 3, depth: 21.4, heading: 93, time: 75, task: 'inspect', status: { live: true, fps: 6, frames: 120, signal: { db: 33, level: 0.8 } }, t: 0 };
  const F = drawHud(ctx, info, null, { hole: true, aspect: 1.25, colour: rovColour(3), compact: true });
  const id = ops.findIndex(o => o[0] === 'fillText' && o[1] === 'ROV-3');
  const col = ops.slice(0, id).reverse().find(o => o[0] === 'set' && o[1] === 'fillStyle');
  ok(id >= 0 && col && col[2] === ROV_COLOURS[2], 'cards: a small card writes the ROV id in the ROV colour', JSON.stringify(col));
  ok(ops.some(o => o[0] === 'fillText' && o[1] === '21.4 m') && ops.some(o => o[0] === 'fillText' && o[1] === '093°') && ops.some(o => o[0] === 'fillText' && o[1] === 'LIVE 6 FPS'), 'cards: a small card has the depth, the heading and the mode');
  ok(ops.some(o => o[0] === 'set' && o[1] === 'font' && /20px/.test(o[2])), 'cards: a small card has 20 px text in the 352 px panel (about 11 px at 200 px)');
  ok(F.cam === 'INSPECT' && hudFields({ status: {} }).cam === 'CAM 1 HD', 'cards: the vehicle mode replaces CAM 1 HD when given', F.cam);
  ok(new Set(ROV_COLOURS).size === 4 && rovColour(1) === '#f2b705' && rovColour(5) === rovColour(1), 'cards: four different ROV colours; ROV 1 keeps the old amber');
}

console.log(`feeds: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

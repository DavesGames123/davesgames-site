// ============================================================================
//  CORAL REEF  ·  ROV tests (node, no browser):  node tests/rov.test.mjs
// ----------------------------------------------------------------------------
//  tests.mjs in the page folder runs this file with the other packages'
//  tests/*.test.mjs files.
//    paths ........ every survey and approach path stays out of the rock:
//                   10 samples on each segment have sdf > 0 (and over half
//                   the clearance), on the stub rock and on the real ROCK
//                   field (rock/index.js, when it imports); the vehicles
//                   never enter the rock either
//    determinism .. one seed gives the same dive twice, bit for bit; a
//                   new seed gives a new dive
//    sstv ......... link.js over pages/sstv: a test frame encodes, decodes
//                   from its VIS and matches the source (PSNR) with no
//                   noise; the PSNR falls as the noise rises; the measured
//                   line period is the period of the mode (Robot 36 and
//                   Martin M1); the picture builds row by row in time
//    hud .......... every HUD field is there, as text and on the canvas
//    focus ........ focusOn: while a colony grows from 0.05 m to 1.6 m
//                   (from the start of the orbit, as in the saver),
//                   its bounding sphere stays in the feed camera frustum,
//                   and the orbit widens as it grows
//    vehicle ...... the model has its parts, lights, camera and shadows
//    capture ...... the render-target path of feed.js with a stand-in
//                   renderer: a frame goes to the link, the AGC moves;
//                   the camera curve shader passes glslangValidator (GLSL
//                   ES 3.00 with the three.js prefix) when it is there
// ============================================================================
import * as THREE from '../../../vendor/three@0.160.0/build/three.module.js';
import { createROVs, colonyBounds } from '../rov/index.js';
import { createStubRock } from '../rov/stub-rock.js';
import { buildPath, createGrid, rng, pathAt } from '../rov/pilot.js';
import { SstvLink, makeSamples, frameToMode, byId } from '../rov/link.js';
import { hudFields, drawHud } from '../rov/hud.js';
import { CURVE_VS, CURVE_FS } from '../rov/feed.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { psnr } from '../../sstv/codec.js';
import { LEAD } from '../../sstv/session.js';
import { VIS_MS } from '../../sstv/modes.js';

let pass = 0, fail = 0;
export function ok(cond, name, info = '') {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); }
}
const f2 = v => (+v).toFixed(2), f3 = v => (+v).toFixed(3);
const noFeed = { worker: false, document: null, source: () => ({ w: 2, h: 2, data: new Uint8Array(16) }) };

// run a dive; collect every path and the minimum sdf of the vehicles
function dive(rock, seed, seconds, o = {}) {
  const R = createROVs(THREE, Object.assign({ rock, seed, feed: noFeed }, o));
  const paths = new Set();
  let minPos = Infinity, worstMs = 0;
  for (let i = 0; i < seconds * 30; i++) {
    const t0 = performance.now();
    R.update(1 / 30, i / 30);
    worstMs = Math.max(worstMs, performance.now() - t0);
    for (const v of R.vehicles) {
      const st = v.pilot.state;
      minPos = Math.min(minPos, R.sdf(st.p[0], st.p[1], st.p[2]));
      if (st.path) paths.add(st.path);
    }
  }
  let minPath = Infinity, segs = 0;
  for (const p of paths) {
    for (let k = 1; k < p.pts.length; k++) {
      const a = p.pts[k - 1], b = p.pts[k];
      for (let u = 0; u <= 1.0001; u += 0.1) minPath = Math.min(minPath, R.sdf(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u));
      segs++;
    }
  }
  return { R, paths, minPos, minPath, segs, worstMs };
}

// ── paths ───────────────────────────────────────────────────────────────────
{
  for (const seed of [1, 2, 3]) {
    const rock = createStubRock({ seed });
    const D = dive(rock, seed, 90);
    ok(D.paths.size >= 2 && D.minPath > D.R.clear * 0.5, `paths: stub rock seed ${seed}, every path sample is out of the rock`, `paths ${D.paths.size} segments ${D.segs} min sdf ${f3(D.minPath)} clear ${f2(D.R.clear)}`);
    ok(D.minPos > 0, `paths: stub rock seed ${seed}, the vehicles stay out of the rock`, `min sdf ${f3(D.minPos)}`);
    if (seed === 1) console.log(`  paths stub seed 1: ${D.paths.size} paths, ${D.segs} segments, min path sdf ${f3(D.minPath)}, min vehicle sdf ${f3(D.minPos)}, clear ${f2(D.R.clear)}`);
  }
  // control points in and behind the canyon walls and the arch
  const rock = createStubRock({ seed: 1 });
  const P = buildPath(rock.sdf, [[-8, 1, 0], [0, 1.5, 0], [8, 1, 0], [10, 0.6, -6]], 0.9);
  let m = Infinity;
  for (let k = 1; k < P.pts.length; k++) for (let u = 0; u <= 1; u += 0.1) { const a = P.pts[k - 1], b = P.pts[k]; m = Math.min(m, rock.sdf(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u)); }
  ok(m > 0.45, 'paths: the fallback marcher (no grid) keeps its path out of the rock', `min sdf ${f3(m)} length ${f2(P.length)}`);
  // the same with the free-water grid (A* and string pulling)
  const grid = createGrid(rock.sdf, { radius: 30, ymin: -3.5, ymax: 14, cell: 0.6 });
  const G = buildPath(rock.sdf, [[-8, 1, 0], [0, 1.5, 0], [8, 1, 0], [10, 0.6, -6]], 0.9, { grid });
  let mg = Infinity;
  for (let k = 1; k < G.pts.length; k++) for (let u = 0; u <= 1; u += 0.1) { const a = G.pts[k - 1], b = G.pts[k]; mg = Math.min(mg, rock.sdf(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u)); }
  const end = G.pts[G.pts.length - 1];
  ok(mg > 0.45 && Math.hypot(end[0] - 10, end[2] + 6) < 1.5, 'paths: the grid route (A*) reaches the far side of the arch with clearance', `min sdf ${f3(mg)} length ${f2(G.length)} end ${end.map(f2)}`);
  const mid = pathAt(P, P.length / 2);
  ok(Math.abs(Math.hypot(...mid.t) - 1) < 1e-6, 'paths: pathAt gives a unit tangent');

  let createRock = null;
  try { ({ createRock } = await import('../rock/index.js')); } catch (e) { console.log('  paths: rock/index.js does not import yet, real rock skipped: ' + e.message); }
  if (createRock) {
    for (const seed of [1, 2]) {
      let rk = null;
      try { rk = createRock({ seed, mesh: false }); } catch (e) { console.log('  paths: createRock failed, real rock skipped: ' + e.message); }
      if (!rk) continue;
      const D = dive(rk, seed, 100);
      ok(D.minPath > 0, `paths: real ROCK seed ${seed}, every path sample is out of the rock and sand`, `min sdf ${f3(D.minPath)}`);
      ok(D.minPos > 0, `paths: real ROCK seed ${seed}, the vehicles stay out of the rock and sand`, `min sdf ${f3(D.minPos)}`);
      console.log(`  paths real ROCK seed ${seed}: ${D.paths.size} paths, ${D.segs} segments, min path sdf ${f3(D.minPath)}, min vehicle sdf ${f3(D.minPos)}, worst update ${f2(D.worstMs)} ms`);
    }
  }
}

// ── determinism ─────────────────────────────────────────────────────────────
{
  const run = (seed) => {
    const R = createROVs(THREE, { rock: createStubRock({ seed: 2 }), seed, feed: noFeed });
    for (let i = 0; i < 30 * 60; i++) R.update(1 / 30, i / 30);
    return JSON.stringify(R.vehicles.map(v => [v.pilot.state.p, v.pilot.state.yaw, v.pilot.state.mode, v.target.toArray(), v.lights[0].intensity]));
  };
  const a = run(7), b = run(7), c = run(8);
  ok(a === b, 'determinism: the same seed gives the same dive (60 s, 3 vehicles)');
  ok(a !== c, 'determinism: another seed gives another dive');
  const L1 = new SstvLink({ seed: 4 }), L2 = new SstvLink({ seed: 4 });
  ok(JSON.stringify(L1.nextParams()) === JSON.stringify(L2.nextParams()), 'determinism: the link noise is seeded');
}

// ── sstv ────────────────────────────────────────────────────────────────────
function testFrame(m) {
  const img = { w: m.W, h: m.H, data: new Uint8ClampedArray(m.W * m.H * 4) };
  for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
    const i = (y * m.W + x) * 4, r = Math.hypot(x - m.W * 0.55, y - m.H * 0.5);
    img.data[i] = 40 + 160 * Math.exp(-r * r / 3000); img.data[i + 1] = 30 + 0.6 * y; img.data[i + 2] = 128 + 90 * Math.sin(x * 0.05) * Math.cos(y * 0.04); img.data[i + 3] = 255;
  }
  return img;
}
function receive(mode, noise, dt = 0.25, watch = null) {
  const m = byId(mode), img = testFrame(m);
  const L = new SstvLink({ mode, seed: 3, noise, speed: 1 });
  L.advance(0); L.begin(img);
  while (L.state === 'rx') { L.advance(dt); if (watch) watch(L); }
  return { L, img, m, p: psnr(img.data, L.picture) };
}
{
  for (const mode of ['r36', 'm1']) {
    const clean = receive(mode, false);
    const st = clean.L.status();
    ok(st.vis === clean.m.vis && st.modeId === mode, `sstv ${mode}: the receiver decodes VIS ${clean.m.vis} from the audio`, `vis ${st.vis} mode ${st.modeId}`);
    ok(clean.p > 30, `sstv ${mode}: no noise, the picture matches the source`, `PSNR ${f2(clean.p)} dB`);
    const n30 = receive(mode, { snr: 30, fade: 0, lean: 0, dips: false });
    const n18 = receive(mode, { snr: 18, fade: 0, lean: 0, dips: false });
    const n10 = receive(mode, { snr: 10, fade: 0.3, lean: 0, dips: false });
    ok(clean.p > n30.p && n30.p > n18.p && n18.p > n10.p, `sstv ${mode}: the PSNR falls as the noise rises`, `${f2(clean.p)} > ${f2(n30.p)} > ${f2(n18.p)} > ${f2(n10.p)}`);
    console.log(`  sstv ${mode}: PSNR clean ${f2(clean.p)}, snr 30 ${f2(n30.p)}, snr 18 ${f2(n18.p)}, snr 10 + fades ${f2(n10.p)} dB`);
    // line timing: the receiver line fit against the mode
    const rx = clean.L.session.rx, P = rx.fit.P / rx.fs * 1000;
    ok(Math.abs(P - clean.m.lineMs) / clean.m.lineMs < 0.001, `sstv ${mode}: the measured line period is the mode line period`, `${f3(P)} ms, mode ${f3(clean.m.lineMs)} ms`);
    console.log(`  sstv ${mode}: line period measured ${f3(P)} ms, mode ${f3(clean.m.lineMs)} ms`);
  }
  // progressive: rows arrive in order, at the line rate, from line 0
  {
    const m = byId('r36'), seen = [];
    let t = 0;
    receive('r36', false, 0.5, (L) => { t += 0.5; const s = L.status(); if (s.phase === 'image') seen.push([t, s.line, s.row]); });
    let mono = true;
    for (let i = 1; i < seen.length; i++) if (seen[i][1] < seen[i - 1][1]) mono = false;
    ok(mono && seen.length > 50, 'sstv: the picture builds line by line (the line count never goes back)', `samples ${seen.length}`);
    const a = seen[10], b = seen[seen.length - 10];
    const rate = (b[1] - a[1]) / (b[0] - a[0]), want = 1000 / m.lineMs;
    ok(Math.abs(rate - want) / want < 0.03, 'sstv: lines arrive at the Robot 36 rate in real time', `${f2(rate)} lines/s, want ${f2(want)}`);
    const t0 = LEAD + VIS_MS.total / 1000;   // line 0 starts after the VIS
    const lineAt = (tt) => Math.floor((tt - t0) * 1000 / m.lineMs);
    const mid = seen[Math.floor(seen.length / 2)];
    ok(Math.abs(mid[1] - lineAt(mid[0])) <= 3, 'sstv: the line count at the play head follows the mode timing', `line ${mid[1]} at ${f2(mid[0])} s, timing says ${lineAt(mid[0])}`);
  }
  // speed: 2 x audio time per wall second
  {
    const L = new SstvLink({ mode: 'r36', seed: 1, noise: false, speed: 2 });
    L.advance(0); L.begin(testFrame(byId('r36')));
    let t = 0; while (L.state === 'rx') { L.advance(0.1); t += 0.1; }
    const want = (L.session.dur - 0.5) / 2;   // the tail (0.5 s of silence) is not waited for
    ok(Math.abs(t - want) < 0.3, 'sstv: speed 2 sends a picture in half the time', `${f2(t)} s, want ${f2(want)} s`);
  }
  // no VIS in deep noise: the link says so and holds the last picture
  {
    const L = new SstvLink({ mode: 'r36', seed: 1, noise: { snr: -12, fade: 0, lean: 0, dips: false } });
    const before = L.picture.slice();
    L.advance(0); L.begin(testFrame(byId('r36')));
    let novis = false; while (L.state === 'rx') { L.advance(0.5); if (L.status().phase === 'novis') novis = true; }
    ok(novis && L.status().vis == null, 'sstv: with no VIS in the noise the HUD shows no signal', `vis ${L.status().vis}`);
    ok(psnr(before, L.picture) === 99, 'sstv: with no VIS the last picture holds');
  }
  // deep fades darken the signal meter during the fade
  {
    const S = makeSamples(testFrame(byId('r36')), { mode: 'r36', snr: 25, dips: [{ at: 5, len: 1.5, floor: 0.1 }] });
    const e = (t) => S.env[Math.floor(t * S.envHz)];
    ok(e(5.7) < 0.15 && e(3) > 0.95, 'sstv: a deep fade shows in the signal envelope', `in ${f2(e(5.7))} out ${f2(e(3))}`);
  }
  // the camera curve: a dark linear frame gets the AGC gain, rows flip
  {
    const w = 8, h = 4, src = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; src[i] = src[i + 1] = src[i + 2] = y === 0 ? 0.02 : 0.002; src[i + 3] = 1; }
    const img = frameToMode(src, w, h, { W: 8, H: 4 }, {});
    ok(img.data[(3 * 8) * 4] > img.data[0] && img.data[(3 * 8) * 4] > 120 && img.gain > 5, 'sstv: frameToMode flips GL rows and lifts a dark frame (AGC)', `bottom ${img.data[(3 * 8) * 4]} top ${img.data[0]} gain ${f2(img.gain)}`);
  }
}

// ── hud ─────────────────────────────────────────────────────────────────────
{
  const L = new SstvLink({ seed: 1, noise: { snr: 24, fade: 0, lean: 0, dips: false } });
  L.advance(0); L.begin(testFrame(byId('r36')));
  for (let i = 0; i < 60; i++) L.advance(0.25);
  const info = { id: 2, depth: 24.37, heading: 7.6, time: 3725.2, status: L.status(), t: 3 };
  const F = hudFields(info);
  const want = { id: 'ROV-2', depth: 'DEPTH 24.4 m', heading: 'HDG 008°', time: 'T+01:02:05', mode: 'ROBOT 36', vis: 'VIS 8' };
  for (const k in want) ok(F[k] === want[k], `hud: field ${k}`, `${F[k]} want ${want[k]}`);
  ok(/^SNR \d+ dB$/.test(F.signal) && F.level > 0, 'hud: field signal', F.signal);
  ok(/^LN \d{3}\/240$/.test(F.line), 'hud: field line', F.line);
  const texts = [], calls = { drawImage: 0 };
  const ctx = new Proxy({}, {
    get(o, k) {
      if (k === 'fillText') return (s) => texts.push(s);
      if (k === 'drawImage') return () => calls.drawImage++;
      if (k in o) return o[k];
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  });
  drawHud(ctx, info, { width: 320, height: 240 });
  const all = texts.join(' | ');
  for (const k of ['id', 'depth', 'heading', 'time', 'mode', 'vis', 'signal', 'line']) ok(all.includes(F[k]), `hud: ${k} is drawn on the panel`, all);
  ok(calls.drawImage === 1, 'hud: the received picture is drawn');
  // through createROVs: the feed fields come from the lead vehicle
  const R = createROVs(THREE, { rock: createStubRock({ seed: 1 }), seed: 1, feed: noFeed, depthBase: 30 });
  for (let i = 0; i < 30 * 5; i++) R.update(1 / 30, i / 30);
  const H = R.feed.hud(), v = R.vehicles[0];
  ok(H.id === 'ROV-1' && H.depth === 'DEPTH ' + (30 - v.group.position.y).toFixed(1) + ' m', 'hud: createROVs gives the lead vehicle id and depth', `${H.id} ${H.depth}`);
  ok(H.time === 'T+00:00:04' || H.time === 'T+00:00:05', 'hud: mission time runs', H.time);
}

// ── focus ───────────────────────────────────────────────────────────────────
{
  for (const seed of [1, 4]) {
    const rock = createStubRock({ seed });
    const site = rock.sampleSurface(1, rng(seed * 13 + 1), s => s.exposure > 0.85 && Math.hypot(s.p[0], s.p[2]) < 20)[0];
    const colony = { k: 0, base: site.p.slice(), top: site.p[1], ext: 0.03, count: 1 };
    const reef = { colonies: [colony] };
    const R = createROVs(THREE, { rock, reef, seed, feed: noFeed });
    const v = R.focusOn(0, 'inspect');
    ok(v && v.id === 1 && R.feed.vehicle === 1, `focus seed ${seed}: focusOn picks the feed vehicle`);
    const fr = new THREE.Frustum(), M = new THREE.Matrix4(), S = new THREE.Sphere();
    let checks = 0, inside = 0, worst = Infinity, dSmall = [], dBig = [], orbitAt = null;
    const T = 260;
    for (let i = 0; i < T * 30; i++) {
      const t = i / 30;
      // the colony grows from the orbit start: 0.05 m to 1.6 m radius in 160 s
      const g = orbitAt == null ? 0 : Math.min(1, (t - orbitAt) / 160), r = 0.05 + 1.55 * g;
      colony.top = site.p[1] + r * 1.2; colony.ext = r * 0.8;
      R.update(1 / 30, t);
      if (v.phase === 'orbit' && orbitAt == null) orbitAt = t;
      if (orbitAt == null || t < orbitAt + 4 || i % 15) continue;
      const b = colonyBounds(reef, 0);
      v.camera.updateMatrixWorld(true);
      M.multiplyMatrices(v.camera.projectionMatrix, v.camera.matrixWorldInverse);
      fr.setFromProjectionMatrix(M);
      S.center.fromArray(b.center); S.radius = b.radius;
      let m = Infinity;
      for (const p of fr.planes) m = Math.min(m, p.distanceToPoint(S.center) - S.radius);
      worst = Math.min(worst, m);
      checks++; if (m >= -1e-6) inside++;
      const d = v.group.position.distanceTo(S.center);
      if (b.radius < 0.3) dSmall.push(d); else if (b.radius > 1.3) dBig.push(d);
    }
    const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
    ok(orbitAt != null && checks > 200 && inside === checks, `focus seed ${seed}: the colony sphere stays inside the camera frustum while it grows`, `orbit from ${f2(orbitAt)} s, ${inside}/${checks} in, worst plane margin ${f3(worst)} m`);
    ok(mean(dBig) > mean(dSmall) + 1, `focus seed ${seed}: the orbit widens as the colony grows`, `small ${f2(mean(dSmall))} m, big ${f2(mean(dBig))} m`);
    console.log(`  focus seed ${seed}: orbit from ${f2(orbitAt)} s, ${inside}/${checks} frames hold the colony, worst margin ${f3(worst)} m, distance ${f2(mean(dSmall))} -> ${f2(mean(dBig))} m`);
    R.focusOn(null);
    ok(v.mode === 'survey', `focus seed ${seed}: focusOn(null) gives the vehicle back to the survey`);
  }
  // a reef mirror: the bounds come from the particles of the colony
  {
    const M = { count: 0, px: new Float32Array(64), py: new Float32Array(64), pz: new Float32Array(64), col: new Uint16Array(64), colonies: [{ k: 0, base: [1, 0, 2], count: 0 }, { k: 1, base: [5, 0, 5], count: 0 }] };
    const add = (k, x, y, z) => { const i = M.count++; M.px[i] = x; M.py[i] = y; M.pz[i] = z; M.col[i] = k; };
    add(0, 1, 0.1, 2); add(1, 5, 0.2, 5);
    const b0 = colonyBounds(M, 0);
    add(0, 1.5, 1.1, 2); add(0, 0.5, 0.6, 2.4);
    const b1 = colonyBounds(M, 0);
    ok(b0.radius < 0.2 && b1.radius > 0.6 && Math.abs(b1.center[1] - 0.55) < 1e-6, 'focus: colony bounds follow the particles of a reef mirror', `${f3(b0.radius)} -> ${f3(b1.radius)} centre y ${f3(b1.center[1])}`);
    M.count = 0; add(0, 3, 0, 3);
    const b2 = colonyBounds(M, 0);
    ok(b2.radius < 1.5 && Math.abs(b2.center[0] - 2) < 1e-6, 'focus: a reset of the mirror (count down) starts the boxes again', `${f3(b2.radius)} ${b2.center.map(f2)}`);
  }
  // a point target, orbit mode
  const R = createROVs(THREE, { rock: createStubRock({ seed: 2 }), seed: 2, feed: noFeed });
  const v = R.focusOn([3, 0, 4], 'orbit', { radius: 0.5, vehicle: 2 });
  ok(v && v.id === 2 && v.mode === 'focus' && R.feed.vehicle === 2, 'focus: a point target on vehicle 2 also moves the feed to it');
}

// ── vehicle ─────────────────────────────────────────────────────────────────
{
  const scene = new THREE.Scene();
  const R = createROVs(THREE, { scene, rock: createStubRock({ seed: 1 }), seed: 1, count: 3, feed: noFeed });
  const v = R.vehicles[0], P = v.parts;
  let tris = 0;
  v.group.traverse(m => { if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });
  ok(P.props.length === 6 && P.props.filter(p => p.kind === 'v').length === 2, 'vehicle: 4 horizontal and 2 vertical thrusters');
  ok(v.lights.length === 2 && v.lights[0].isSpotLight && v.lights[0].castShadow && !R.vehicles[1].lights[0].castShadow, 'vehicle: the lead has 2 SpotLights, the first casts shadows, the others do not');
  ok(R.lights.length === 4, 'vehicle: rovs.lights lists every SpotLight', R.lights.length);
  ok(P.leds.length >= 4 && P.camera.isPerspectiveCamera && P.arm.wrist && P.tetherPoint, 'vehicle: LEDs, the feed camera, the arm and the tether point');
  ok(tris > 4000 && tris < 30000, 'vehicle: a careful model in a frame budget', `${tris} triangles`);
  ok(scene.children.length === 1 + 3 * 2, 'vehicle: the vehicles, tethers and wash are in the scene', scene.children.length);
  let col = false;
  v.group.traverse(m => { if (m.isMesh && m.material === P.materials.foam && m.geometry.attributes.color) col = true; });
  ok(col, 'vehicle: the foam has a vertex-colour wear tint');
  for (let i = 0; i < 30 * 20; i++) R.update(1 / 30, i / 30);
  const spun = P.props.some(p => Math.abs(p.spin.rotation.y) > 1);
  ok(spun, 'vehicle: the props turn');
  const tp = v.tether.points, n = v.tether.count - 1;
  const top = [tp[n * 3], tp[n * 3 + 1], tp[n * 3 + 2]];
  ok(top[1] > v.group.position.y + 20, 'vehicle: the tether goes up into the dark', `top y ${f2(top[1])}`);
  R.dispose();
  ok(scene.children.length === 0, 'vehicle: dispose removes everything from the scene', scene.children.length);
}

// ── capture ─────────────────────────────────────────────────────────────────
{
  const calls = [];
  const fakeR = {
    capabilities: { isWebGL2: true }, extensions: { has: () => true },
    getRenderTarget: () => null, setRenderTarget: (t) => calls.push(['target', t && t.texture.type]), clear: () => {},
    render: (sc, cam) => calls.push(['render', cam.type]),
    readRenderTargetPixels: (rt, x, y, w, h, buf) => { for (let i = 0; i < w * h; i++) { buf[i * 4] = buf[i * 4 + 1] = buf[i * 4 + 2] = (i % w) * 255 / w * 0.3; buf[i * 4 + 3] = 255; } calls.push(['read', buf.length]); },
  };
  const R = createROVs(THREE, { scene: new THREE.Scene(), renderer: fakeR, rock: createStubRock({ seed: 1 }), seed: 1, feed: { worker: false, document: null } });
  R.update(1 / 30, 0); R.update(1 / 30, 1 / 30);
  const reads = calls.filter(c => c[0] === 'read').length, renders = calls.filter(c => c[0] === 'render').map(c => c[1]);
  ok(reads === 1 && renders.includes('PerspectiveCamera') && renders.includes('OrthographicCamera'), 'capture: one frame renders the ROV camera, the curve pass, and one byte read', JSON.stringify(calls.slice(0, 6)));
  ok(R.feed.link.state === 'rx', 'capture: the captured frame goes over the link', R.feed.link.state);
  for (let i = 0; i < 30 * 2; i++) R.update(1 / 30, i / 30);
  ok(R.feed.link.status().vis === 8, 'capture: the receiver decodes the VIS of the captured frame', R.feed.link.status().vis);
  const GLSLANG = ['/opt/homebrew/bin/glslangValidator', '/usr/local/bin/glslangValidator'].find(p => fs.existsSync(p));
  if (GLSLANG) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-glsl-'));
    const fp = '#version 300 es\nprecision highp float;\n#define varying in\nout highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n#define texture2D texture\n';
    const vp = '#version 300 es\nprecision highp float;\n#define varying out\nin vec3 position;\nin vec2 uv;\n';
    fs.writeFileSync(path.join(dir, 'c.frag'), fp + CURVE_FS); fs.writeFileSync(path.join(dir, 'c.vert'), vp + CURVE_VS);
    let log = '', good = true;
    for (const f of ['c.vert', 'c.frag']) { try { execFileSync(GLSLANG, [path.join(dir, f)]); } catch (e) { good = false; log += String(e.stdout || e.message); } }
    fs.rmSync(dir, { recursive: true, force: true });
    ok(good, 'capture: the camera curve shader passes glslangValidator (GLSL ES 3.00)', log);
  } else console.log('  capture: glslangValidator not found, shader check skipped');
  R.dispose();
}

export function done(tag = 'rov') {
  console.log(`${tag}: ${pass} passed, ${fail} failed`);
  return fail;
}
if (import.meta.url === `file://${process.argv[1]}`) process.exit(done() ? 1 : 0);

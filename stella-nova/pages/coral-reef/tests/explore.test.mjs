// ============================================================================
//  CORAL REEF  ·  explore camera and fast feed tests (node, no browser)
//    node tests/explore.test.mjs        (tests.mjs runs it with the others)
// ----------------------------------------------------------------------------
//  The user asked (2026-10-17): "the only time we should see the reef isn't
//  through the ROV camera we should be able to explore the thing oursleves.
//  the ROV cemera shouldr ender much faster framerates".
//    spring ....... the critically damped step: no overshoot, exact in time
//    orbit ........ zoom to the cursor keeps the point under the cursor; the
//                   grab pan keeps the grip under the pointer; a turn round
//                   the pivot keeps the eye to pivot distance
//    swim ......... random swims (keys, look, boost, odd frame times and
//                   stalls) on the real rock of 3 seeds: the eye never comes
//                   under 0.3 m of rock (rock.sdfAll / rock.sdfScale, the
//                   metres of NOTES.md) and it does not stick
//    orbit drive .. random turns, zooms, pans and fly-tos: the same limit
//    tours ........ every canyon and arch tour of 3 seeds: the path samples
//                   have TOUR_CLEAR of water and a trace along each segment
//                   finds no rock; the arch tours pass under rock; the
//                   camera flies each tour to its end above the limit
//    follow/saver . the chase camera and saver goals in the rock: the eye
//                   stays out of the rock
//    live rate .... the live frame cadence is the target fps (30, 15) over
//                   dt schedules (60, 144, 30, 20 Hz, jitter, stalls); never
//                   two frames in one update; the governor steps down when
//                   frames slow, and up again
//    live feed .... with a stand-in renderer: live mode renders at the
//                   rate, reads no pixels back, keeps the shadow maps,
//                   present() draws at the card rect and restores the
//                   viewport; the HUD has the live fields; the mode switch
//                   to SSTV and back
//    sstv ......... Robot 8 B&W (the fast true mode) decodes from its VIS
//                   with PSNR > 30 dB; Robot 36 still does
//    glsl ......... AGC_FS, ANALOG_FS and BLIT_FS pass glslangValidator
// ============================================================================
import * as THREE from '../../../vendor/three@0.160.0/build/three.module.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRock } from '../rock/index.js';
import { createExploreCamera, createField, spring, project, buildTours, tourGrid, CLEAR_HARD, TOUR_CLEAR } from '../camera.js';
import { liveRate, createFeed, analogFrame, AGC_FS, ANALOG_FS, BLIT_FS, CURVE_VS } from '../rov/feed.js';
import { hudFields, drawHud } from '../rov/hud.js';
import { SstvLink, byId } from '../rov/link.js';
import { psnr } from '../../sstv/codec.js';
import { tapKind } from '../input.js';

let pass = 0, fail = 0;
function ok(cond, name, info = '') {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); }
}
const f2 = v => (+v).toFixed(2), f3 = v => (+v).toFixed(3);
const LIMIT = 0.3;                 // m: the eye never comes nearer the rock
function rng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ── spring ──────────────────────────────────────────────────────────────────
{
  let x = 0, v = 0, over = false;
  for (let i = 0; i < 600; i++) { [x, v] = spring(x, v, 1, 6, 1 / 60); if (x > 1 + 1e-9) over = true; }
  ok(!over && Math.abs(x - 1) < 1e-6, 'spring: a critically damped spring reaches the goal with no overshoot', f3(x));
  const a = spring(0.2, 3, 1, 5, 0.1), b0 = spring(0.2, 3, 1, 5, 0.05), b = spring(b0[0], b0[1], 1, 5, 0.05);
  ok(Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12, 'spring: two half steps are one step (exact in time, so the frame rate does not change the motion)');
}
{
  ok(tapKind({ x: 0, y: 0, t: 0 }, { x: 2, y: 1, t: 120 }, null) === 'tap' && tapKind({ x: 0, y: 0, t: 0 }, { x: 40, y: 0, t: 120 }, null) === 'drag'
    && tapKind({ x: 0, y: 0, t: 400 }, { x: 1, y: 0, t: 500 }, { x: 3, y: 2, t: 250 }) === 'double', 'input: tap, drag and double tap');
}

// ── the real rock ───────────────────────────────────────────────────────────
const SEEDS = [1, 2, 3];
const rocks = SEEDS.map(seed => { const r = createRock({ seed, radius: 30, quality: 'low', mesh: false }); return { seed, rock: r, F: createField(r) }; });
const metresOf = (F, p) => F.metres(p);

// ── orbit: zoom to cursor, pan, pivot ──────────────────────────────────────
{
  const { rock, F } = rocks[0];
  const cam = createExploreCamera({ rock, R: 30, eye: [16, 12, 20], look: [0, 2, 0] });
  cam.setProjection({ fov: 50, aspect: 16 / 9, shift: [0.12, -0.05] });
  cam.update(0.5); cam.snap();
  const P = cam.proj, R = rng(7);
  let worst = 0, n = 0, worstPan = 0, worstPiv = 0;
  for (let i = 0; i < 40; i++) {
    const nx = R() * 1.6 - 0.8, ny = R() * 1.2 - 0.6;
    const hit = cam.pick(nx, ny, true);
    if (!hit) continue;
    const before = project(cam.orbitPose(), P, hit);
    cam.zoomAt(nx, ny, R() < 0.5 ? 0.8 : 1.25);
    const after = project(cam.orbitPose(), P, hit);
    if (!before || !after) continue;
    // the point is still under the cursor (the goal pose, before the boom)
    worst = Math.max(worst, Math.hypot(after[0] - nx, after[1] - ny), Math.hypot(before[0] - nx, before[1] - ny));
    n++;
    cam.update(1 / 60);
  }
  ok(n > 20 && worst < 2e-3, 'orbit: the wheel zoom keeps the rock point under the cursor', `${n} zooms, worst ${worst.toExponential(2)} NDC`);
  for (let i = 0; i < 20; i++) {
    const a = [R() - 0.5, R() - 0.5], b = [a[0] + (R() - 0.5) * 0.4, a[1] + (R() - 0.5) * 0.4];
    cam.update(1, null); cam.snap();
    cam.panBegin(a[0], a[1]);
    const grip = cam.orbit.grip.slice();
    cam.panMove(b[0], b[1]);
    const q = project(cam.orbitPose(), P, grip);
    if (q) worstPan = Math.max(worstPan, Math.hypot(q[0] - b[0], q[1] - b[1]));
    cam.orbitEnd();
  }
  ok(worstPan < 2e-3, 'orbit: the grab pan keeps the grip point under the pointer', `worst ${worstPan.toExponential(2)} NDC`);
  for (let i = 0; i < 20; i++) {
    cam.update(1); cam.snap();
    cam.orbitBegin(R() - 0.5, R() - 0.5);
    const piv = cam.orbit.pivot.slice(), e0 = cam.orbitPose().eye, d0 = Math.hypot(e0[0] - piv[0], e0[1] - piv[1], e0[2] - piv[2]);
    cam.orbitRotate((R() - 0.5) * 300, (R() - 0.5) * 120, 800);
    const e1 = cam.orbitPose().eye, d1 = Math.hypot(e1[0] - piv[0], e1[1] - piv[1], e1[2] - piv[2]);
    worstPiv = Math.max(worstPiv, Math.abs(d1 - d0));
    cam.orbitStop(); cam.orbitEnd();
  }
  ok(worstPiv < 1e-6, 'orbit: a turn pivots round the rock under the pointer (the eye keeps its distance to it)', `worst ${worstPiv.toExponential(2)} m`);
}

// ── swim: random swims ──────────────────────────────────────────────────────
{
  let frames = 0, worst = Infinity, travel = 0, stuck = 0, runs = 0;
  for (const { seed, rock, F } of rocks) {
    const R = rng(seed * 31 + 5);
    for (let run = 0; run < 6; run++) {
      runs++;
      // start: a free point in the plot, 1 to 4 m over the rock
      let s = null;
      for (let k = 0; k < 200 && !s; k++) { const a = R() * 6.283, d = 26 * Math.sqrt(R()), p = [Math.cos(a) * d, 1 + R() * 6, Math.sin(a) * d]; const m = F.metres(p); if (m > 1 && m < 4) s = p; }
      const cam = createExploreCamera({ rock, R: 30, eye: s, look: [0, s[1], 0] });
      cam.setMode('swim', { snap: true });
      let mv = [0, 0, 1], t = 0, moved = 0, last = s.slice();
      for (let i = 0; i < 2400; i++) {
        const dt = R() < 0.01 ? 0.1 + R() * 0.15 : 1 / (30 + R() * 114);
        if (R() < 0.02) mv = [Math.round(R() * 2 - 1), Math.round(R() * 2 - 1), R() < 0.8 ? 1 : -1];
        // look: wander, and every few seconds aim at the rock (the worst case)
        let look = [(R() - 0.5) * 0.05, (R() - 0.5) * 0.04];
        if (R() < 0.004) { const e = cam.eye; const a = Math.atan2(-e[2], -e[0]); look = [a - cam.swim.yawT, -0.5 - cam.swim.pitchT]; }
        cam.swimInput(mv, look, R() < 0.3);
        cam.update(dt);
        const m = F.metres(cam.eye);
        if (m < worst) worst = m;
        frames++; t += dt;
        moved += Math.hypot(cam.eye[0] - last[0], cam.eye[1] - last[1], cam.eye[2] - last[2]); last = cam.eye.slice();
      }
      travel += moved;
      if (moved < 20) stuck++;
    }
  }
  ok(worst > LIMIT, 'swim: random swims never bring the eye under 0.3 m of rock (3 seeds, 18 swims)', `${frames} frames, nearest ${f2(worst)} m`);
  ok(stuck === 0, 'swim: no swim sticks to the rock', `${stuck} of ${runs} moved under 20 m, mean travel ${f2(travel / runs)} m`);
  console.log(`  swim: ${runs} swims, ${frames} frames, nearest ${f2(worst)} m (hard limit ${CLEAR_HARD} m), mean travel ${f2(travel / runs)} m`);
}

// ── orbit drive: random gestures ───────────────────────────────────────────
{
  let worst = Infinity, frames = 0, flies = 0;
  for (const { seed, rock, F } of rocks) {
    const R = rng(seed * 17 + 3);
    const cam = createExploreCamera({ rock, R: 30, eye: [18, 12, 22], look: [0, 2, 0] });
    cam.setProjection({ fov: 50, aspect: 1.6 });
    for (let i = 0; i < 1800; i++) {
      const u = R();
      if (u < 0.05) { cam.orbitBegin(R() * 2 - 1, R() * 2 - 1); }
      else if (u < 0.35) cam.orbitRotate((R() - 0.5) * 60, (R() - 0.5) * 40, 800);
      else if (u < 0.5) cam.zoomAt(R() * 2 - 1, R() * 2 - 1, R() < 0.6 ? 0.85 : 1.15);
      else if (u < 0.55) { cam.panBegin(R() - 0.5, R() - 0.5); cam.panMove(R() - 0.5, R() - 0.5); cam.orbitEnd(); }
      else if (u < 0.565) { if (cam.flyTo(R() * 1.6 - 0.8, R() * 1.2 - 0.6)) flies++; }
      cam.update(1 / 60);
      const m = F.metres(cam.eye); if (m < worst) worst = m;
      frames++;
    }
  }
  ok(worst > LIMIT, 'orbit: random turns, zooms, pans and fly-tos keep the eye over 0.3 m from rock (3 seeds)', `${frames} frames, ${flies} fly-tos, nearest ${f2(worst)} m`);
  console.log(`  orbit: ${frames} frames, ${flies} fly-tos, nearest ${f2(worst)} m`);
}

// ── tours ───────────────────────────────────────────────────────────────────
{
  let total = 0, good = 0, arches = 0, under = 0, canyons = 0, minClear = Infinity, segBad = 0, worstFly = Infinity, ended = 0, flown = 0, eyeUnder = 0, ms = 0;
  for (const { seed, rock, F } of rocks) {
    const t0 = Date.now();
    const grid = tourGrid(rock);
    const T = buildTours(rock, { field: F, grid });
    ms += Date.now() - t0;
    for (const t of T) {
      total++;
      if (!t.ok) continue;
      good++;
      if (t.kind === 'arch') { arches++; if (t.under) under++; } else canyons++;
      for (let i = 0; i < t.pts.length; i++) {
        minClear = Math.min(minClear, metresOf(F, t.pts[i]));
        if (i) { const a = t.pts[i - 1], b = t.pts[i], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d); if (L > 1e-6 && Number.isFinite(F.trace(a, d.map(v => v / L), L, LIMIT))) segBad++; }
      }
    }
    // fly every good tour with the camera from a page start pose
    for (const t of T.filter(x => x.ok)) {
      const cam = createExploreCamera({ rock, R: 30, eye: [18, 12, 22], look: [0, 2, 0], grid });
      const got = cam.startTour(t.id);
      if (!got) continue;
      flown++;
      let wasUnder = false;
      for (let i = 0; i < 60 * 240 && cam.mode === 'tour'; i++) {
        cam.update(1 / 60);
        const m = F.metres(cam.eye); if (m < worstFly) worstFly = m;
        if (t.kind === 'arch' && !wasUnder && Number.isFinite(F.trace(cam.eye, [0, 1, 0], 6, 0))) wasUnder = true;
      }
      if (cam.mode !== 'tour' && cam.tour.done) ended++;
      if (t.kind === 'arch' && t.under && wasUnder) eyeUnder++;
    }
  }
  ok(good >= total * 0.8 && canyons >= 3 && arches >= 6, 'tours: canyon and arch tours plan on 3 seeds', `${good} of ${total} ok (${canyons} canyons, ${arches} arches)`);
  ok(minClear >= TOUR_CLEAR && minClear > LIMIT && segBad === 0, 'tours: every path sample has the tour clearance and no segment cuts rock', `nearest ${f2(minClear)} m, ${segBad} bad segments`);
  ok(under >= arches * 0.8, 'tours: the arch tours pass under the arch (rock over the path)', `${under} of ${arches}`);
  ok(flown === good && ended === flown && worstFly > LIMIT, 'tours: the camera flies each tour to its end, never under 0.3 m of rock', `${ended} of ${flown} ended, nearest ${f2(worstFly)} m`);
  ok(eyeUnder >= under * 0.8, 'tours: the camera eye goes under the arch rock', `${eyeUnder} of ${under}`);
  console.log(`  tours: ${good} of ${total} ok, ${under} of ${arches} arches pass under rock, path nearest ${f2(minClear)} m, flight nearest ${f2(worstFly)} m, plan ${ms} ms for 3 seeds`);
  // a take-over: input in a tour gives swim at the same pose
  const { rock } = rocks[0];
  const cam = createExploreCamera({ rock, R: 30 });
  const id = cam.tourList()[0].id;
  cam.startTour(id);
  for (let i = 0; i < 600; i++) cam.update(1 / 60);
  const e0 = cam.eye.slice(); cam.takeOver(); cam.update(1 / 60);
  ok(cam.mode === 'swim' && Math.hypot(cam.eye[0] - e0[0], cam.eye[1] - e0[1], cam.eye[2] - e0[2]) < 0.2, 'tours: a take-over goes to swim at the same pose', `${cam.mode}`);
}

// ── follow and saver ────────────────────────────────────────────────────────
{
  let worst = Infinity, n = 0;
  for (const { rock, F } of rocks) {
    const cam = createExploreCamera({ rock, R: 30 });
    const t = buildTours(rock, { field: F }).find(x => x.ok);
    // a stand-in ROV that flies the tour path
    let s = 0;
    const veh = { pos: t.at(0), yaw: 0 };
    cam.follow(1);
    for (let i = 0; i < 60 * 40; i++) {
      s += 1.2 / 60; const p = t.at(s), q = t.at(s + 0.5);
      veh.pos = p; veh.yaw = Math.atan2(q[2] - p[2], q[0] - p[0]);
      if (i % 200 === 100) cam.followLook(1.5, 0.4);
      cam.update(1 / 60, { getVehicle: () => veh });
      const m = F.metres(cam.eye); if (m < worst) worst = m; n++;
    }
    // saver goals inside the rock
    const R = rng(11);
    for (let i = 0; i < 600; i++) {
      const g = [(R() - 0.5) * 40, R() * 6 - 1, (R() - 0.5) * 40];
      cam.saverGoal(g, [0, 1, 0], i % 120 === 0);
      cam.update(1 / 60);
      const m = F.metres(cam.eye); if (m < worst) worst = m; n++;
    }
  }
  ok(worst > LIMIT, 'follow and saver: the chase camera and saver goals in the rock keep the eye out of the rock', `${n} frames, nearest ${f2(worst)} m`);
}

// ── follow start at a wall ──────────────────────────────────────────────────
// The user said (2026-10-18): "the camera for the ROV animation always
// starts stuck up against a rock". An ROV hovers 1.2 m out from a rock wall
// and looks away from it, so the boom straight behind it goes into the
// rock. The camera starts at the page's overview eye. After 3 s the eye
// must be clear of the rock, at least 2 m from the ROV, with a clear line
// to it; with snap the same holds on the first frame.
{
  let tried = 0, squeezed = 0, stuck = 0, snapBad = 0, worstGap = Infinity, nearest = Infinity;
  for (const { rock, F } of rocks) {
    const S = rock.sampleSurface(400, rng(rock.seed + 5)).filter(s => Math.abs(s.n[1]) < 0.35);
    for (const s of S.slice(0, 12)) {
      const h = Math.hypot(s.n[0], s.n[2]) || 1;
      const pos = [s.p[0] + s.n[0] / h * 1.2, s.p[1] + 0.2, s.p[2] + s.n[2] / h * 1.2];
      if (F.metres(pos) < 0.8 || Math.hypot(pos[0], pos[2]) > 26) continue;
      const veh = { pos, yaw: Math.atan2(s.n[2], s.n[0]) };
      for (const snap of [false, true]) {
        const cam = createExploreCamera({ rock, R: 30 });
        cam.follow(1, { snap });
        let first = null;
        for (let i = 0; i < 180; i++) { cam.update(1 / 60, { getVehicle: () => veh }); if (!first) first = cam.eye.slice(); }
        const E = cam.eye, d = Math.hypot(E[0] - pos[0], E[1] - pos[1], E[2] - pos[2]);
        const dir = [(pos[0] - E[0]) / d, (pos[1] - E[1]) / d, (pos[2] - E[2]) / d];
        const blocked = Number.isFinite(F.trace(E, dir, Math.max(0, d - 0.6), 0.05));
        const m = F.metres(E); if (m < nearest) nearest = m;
        if (!snap) { tried++; if (d < 2) squeezed++; if (blocked || d > 8) stuck++; if (d < worstGap) worstGap = d; }
        else { const d0 = Math.hypot(first[0] - pos[0], first[1] - pos[1], first[2] - pos[2]); if (d0 > 8 || d0 < 1.5 || F.metres(first) < LIMIT) snapBad++; }
      }
    }
  }
  ok(tried >= 6, 'follow start: wall sites found', `${tried}`);
  ok(squeezed === 0, 'follow start: the boom finds water round the ROV (eye 2 m or more from it)', `${squeezed} of ${tried} squeezed, nearest ${f2(worstGap)} m`);
  ok(stuck === 0, 'follow start: the glide from the overview does not stick on rock (clear line to the ROV)', `${stuck} of ${tried} stuck`);
  ok(snapBad === 0, 'follow start: a snap puts the eye beside the ROV on the first frame', `${snapBad} bad`);
  ok(nearest > LIMIT, 'follow start: the eye stays out of the rock', `nearest ${f2(nearest)} m`);
}

// ── live rate ───────────────────────────────────────────────────────────────
{
  const schedules = {
    '60 Hz': () => 1 / 60, '144 Hz': () => 1 / 144, '30 Hz': () => 1 / 30, '20 Hz': () => 1 / 20,
    jitter: (R) => 1 / (40 + R() * 50), stalls: (R) => (R() < 0.02 ? 0.25 : 1 / 60),
  };
  const lines = [];
  let worstErr = 0;
  for (const target of [30, 15]) for (const [name, f] of Object.entries(schedules)) {
    const R = rng(3), rate = liveRate({ fps: target, adapt: false });
    let T = 0, frames = 0, ticks = 0, stallT = 0, stalls = 0;
    for (let i = 0; T < 60; i++) {
      const dt = f(R); T += dt; ticks++;
      const got = rate.tick(dt);
      if (got) frames++;
      if (dt > 0.2) { stallT += dt; stalls++; }
    }
    // the main loop caps the cadence; a stall gives one frame
    const main = (ticks - stalls) / (T - stallT), want = (Math.min(target, main) * (T - stallT) + stalls) / T;
    const err = Math.abs(frames / T - want) / want;
    worstErr = Math.max(worstErr, err);
    lines.push(`${target} fps @ ${name}: ${f2(frames / T)} fps (want ${f2(want)})`);
  }
  ok(worstErr < 0.04, 'live rate: the frame cadence is the target fps over 60, 144, 30 and 20 Hz frames, jitter and stalls', `worst ${f2(worstErr * 100)} %`);
  console.log('  live rate: ' + lines.join('; '));
  // never two frames in one update (one tick gives at most one frame)
  const rate = liveRate({ fps: 30, adapt: false });
  let burst = 0; for (let i = 0; i < 100; i++) { rate.tick(0.5); if (rate.tick(1 / 240)) burst++; }
  ok(burst === 0 && rate.acc < 1 / 30, 'live rate: a long frame gives one frame and no burst of frames after it', `${burst} bursts`);
  // the governor: slow main frames step the rate down, good ones step it up
  const g = liveRate({ fps: 30 });
  for (let i = 0; i < 300; i++) g.tick(1 / 60);
  const f0 = g.fps;
  for (let i = 0; i < 200; i++) g.tick(1 / 30);
  const f1 = g.fps;
  for (let i = 0; i < 60 * 40; i++) g.tick(1 / 60);
  const f2v = g.fps;
  const h = liveRate({ fps: 30 }); for (let i = 0; i < 400; i++) { h.used(6); h.tick(1 / 60); }
  ok(f0 === 30 && f1 < 30 && f2v === 30 && h.fps < 30, 'live rate: the governor drops the rate when the frames slow or the feed costs too much, and comes back', `${f0} -> ${f1} -> ${f2v}; cost 6 ms -> ${h.fps}`);
}

// ── live feed with a stand-in renderer ─────────────────────────────────────
function fakeRenderer() {
  const calls = { render: 0, read: 0, targets: [], viewport: [], scissor: [], shadowOff: 0, last: null };
  let vp = new THREE.Vector4(0, 0, 1280, 720), sc = new THREE.Vector4(0, 0, 1280, 720), st = false, tgt = null;
  const R = {
    capabilities: { isWebGL2: true }, extensions: { has: () => true }, shadowMap: { autoUpdate: true }, autoClear: true,
    getRenderTarget: () => tgt, setRenderTarget: (t) => { tgt = t; calls.targets.push(t); }, clear: () => {},
    render: (s, c) => { calls.render++; calls.last = c.type; if (!R.shadowMap.autoUpdate) calls.shadowOff++; },
    readRenderTargetPixels: () => { calls.read++; },
    getViewport: (v) => v.copy(vp), setViewport: (x, y, w, h) => { if (x.isVector4) vp.copy(x); else vp.set(x, y, w, h); calls.viewport.push(vp.toArray()); },
    getScissor: (v) => v.copy(sc), setScissor: (x, y, w, h) => { if (x.isVector4) sc.copy(x); else sc.set(x, y, w, h); calls.scissor.push(sc.toArray()); },
    getScissorTest: () => st, setScissorTest: (v) => { st = v; },
    getSize: (v) => v.set(1280, 720), getPixelRatio: () => 2,
  };
  return { R, calls };
}
{
  const { R, calls } = fakeRenderer();
  const cam = new THREE.PerspectiveCamera(60, 1.25, 0.05, 100);
  const veh = { id: 1, camera: cam };
  const feed = createFeed(THREE, { renderer: R, scene: new THREE.Scene(), mode: 'live', fps: 30, adapt: false, worker: false, document: null, getVehicle: () => veh });
  for (let i = 0; i < 120; i++) feed.update(1 / 60);
  ok(feed.live && feed.liveFrames === 60, 'live feed: 2 s at 60 Hz renders 60 live frames (30 fps)', `${feed.liveFrames}`);
  ok(calls.read === 0, 'live feed: no pixels are read back in live mode', `${calls.read} reads`);
  ok(calls.render === 60 * 3 && calls.shadowOff >= 60, 'live feed: each live frame is the scene from the ROV camera (shadow maps kept) and two small passes', `${calls.render} renders, ${calls.shadowOff} with the shadow maps off`);
  ok(R.shadowMap.autoUpdate === true && R.getRenderTarget() === null, 'live feed: the shadow map update and the render target are restored');
  calls.viewport.length = 0;
  const pr = feed.pictureRect({ x: 900, y: 380, w: 352, h: 322 });
  const drew = feed.present(pr, 1);
  const vp0 = calls.viewport[0], vpEnd = R.getViewport(new THREE.Vector4()).toArray();
  ok(drew && vp0 && Math.abs(vp0[0] - Math.round(pr.x)) < 1 && Math.abs(vp0[1] - Math.round(720 - pr.y - pr.h)) < 1 && vpEnd.join() === '0,0,1280,720' && R.autoClear === true, 'live feed: present() draws at the card picture rect and restores the viewport', `${JSON.stringify(vp0)} rect ${JSON.stringify(pr)}`);
  feed.setActive(false);
  const r0 = calls.render; for (let i = 0; i < 60; i++) feed.update(1 / 60);
  ok(calls.render === r0 && !feed.present(pr, 1), 'live feed: a hidden card renders no live frames');
  feed.setActive(true);
  const F = hudFields({ id: 2, depth: 21.4, heading: 93, time: 75, status: { live: true, fps: 30, frames: 1234, signal: { db: 33, level: 0.8 } } });
  ok(F.id === 'ROV-2' && F.mode === 'LIVE 30 FPS' && F.vis === 'ANALOG' && F.signal === 'SNR 33 dB' && F.depth === 'DEPTH 21.4 m' && F.heading === 'HDG 093°' && F.time === 'T+00:01:15' && F.phase === 'LIVE', 'live feed: the HUD shows ROV id, depth, heading, time, live mode and signal', JSON.stringify(F));
  // a canvas stand-in: the picture box is cleared (the hole for WebGL)
  const ops = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => ops.push([k, ...a])), set: (t, k, v) => { t[k] = v; return true; } });
  drawHud(ctx, { id: 1, status: { live: true, fps: 30, frames: 1, signal: { db: 30, level: 0.7 } } }, null, { hole: true, aspect: 4 / 3 });
  ok(ops.some(o => o[0] === 'clearRect' && o[3] === 320 && o[4] === 240), 'live feed: the HUD clears a 4:3 box for the live picture', JSON.stringify(ops.filter(o => o[0] === 'clearRect')));
  // to SSTV and back
  feed.setMode('r8');
  for (let i = 0; i < 4; i++) feed.update(1 / 60);
  ok(!feed.live && feed.mode === 'r8' && calls.read === 1 && feed.link.state === 'rx', 'live feed: the switch to SSTV (Robot 8) captures one frame and sends it', `mode ${feed.mode} reads ${calls.read} state ${feed.link.state}`);
  feed.setMode('live');
  const r1 = calls.read; for (let i = 0; i < 30; i++) feed.update(1 / 60);
  ok(feed.live && calls.read === r1, 'live feed: back to live, no more reads');
  feed.setVehicle(2);
  ok(feed.vehicle === 2, 'live feed: the feed takes another ROV');
  feed.dispose();
  // node: the CPU look from a source frame
  const src = new Float32Array(160 * 120 * 4);
  for (let y = 0; y < 120; y++) for (let x = 0; x < 160; x++) { const i = (y * 160 + x) * 4, r = Math.hypot(x - 80, y - 60); src[i] = src[i + 1] = src[i + 2] = 0.02 * Math.exp(-r * r / 900); src[i + 3] = 1; }
  const A = analogFrame(src, 160, 120, { time: 1, seed: 3, noise: 0.15 });
  let c = 0, e = 0; for (let x = 70; x < 90; x++) { c += A.data[(60 * 160 + x) * 4 + 1]; e += A.data[(60 * 160 + x - 65) * 4 + 1]; }
  ok(A.gain > 5 && c / 20 > 90 && c > e * 2, 'live feed: the analog look lifts a dark frame (AGC) and keeps the picture', `gain ${f2(A.gain)} centre ${f2(c / 20)} edge ${f2(e / 20)}`);
}

// ── sstv: Robot 8 B&W and Robot 36 still decode ────────────────────────────
function testFrame(m) {
  const img = { w: m.W, h: m.H, data: new Uint8ClampedArray(m.W * m.H * 4) };
  for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
    const i = (y * m.W + x) * 4, r = Math.hypot(x - m.W * 0.55, y - m.H * 0.5), v = 40 + 160 * Math.exp(-r * r / (m.W * 10)) + 0.2 * y;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  return img;
}
for (const mode of ['r8', 'r36']) {
  const m = byId(mode), img = testFrame(m);
  const L = new SstvLink({ mode, seed: 3, noise: false, speed: 2 });
  L.advance(0); L.begin(img);
  let t = 0; while (L.state === 'rx') { L.advance(0.25); t += 0.25; }
  const p = psnr(img.data, L.picture), st = L.status();
  ok(st.vis === m.vis && p > 30, `sstv ${mode}: decodes from its VIS ${m.vis} with no noise`, `vis ${st.vis} PSNR ${f2(p)} dB`);
  console.log(`  sstv ${mode}: VIS ${st.vis}, PSNR ${f2(p)} dB, one picture in ${f2(t)} s at speed 2`);
}

// ── glsl ────────────────────────────────────────────────────────────────────
{
  const GLSLANG = ['/opt/homebrew/bin/glslangValidator', '/usr/local/bin/glslangValidator'].find(p => fs.existsSync(p));
  if (GLSLANG) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explore-glsl-'));
    const fp = '#version 300 es\nprecision highp float;\n#define varying in\nout highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n#define texture2D texture\n';
    const vp = '#version 300 es\nprecision highp float;\n#define varying out\nin vec3 position;\nin vec2 uv;\n';
    let log = '', good = true;
    const files = { 'v.vert': vp + CURVE_VS, 'agc.frag': fp + AGC_FS, 'ana.frag': fp + ANALOG_FS, 'blit.frag': fp + BLIT_FS };
    for (const [n, src] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, n), src);
      try { execFileSync(GLSLANG, [path.join(dir, n)]); } catch (e) { good = false; log += n + ': ' + String(e.stdout || e.message); }
    }
    fs.rmSync(dir, { recursive: true, force: true });
    ok(good, 'glsl: the live AGC, analog and blit shaders pass glslangValidator (GLSL ES 3.00)', log);
  } else console.log('  glsl: glslangValidator not found, shader check skipped');
}

console.log(`explore: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// ============================================================================
//  DLAF PAGE  ·  tests.mjs — node tests, no browser
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/dlaf/tests.mjs
//  Covers the DOM-free modules (sim.js, walk.js, camera.js, saver.js): the
//  engine under each preset hook, the colour mapping, the CSV format, the
//  replay indexing, the walker record, the saver shot list and the framing
//  maths for 16:9 and 9:16. The last part boots main.js on a stub DOM and a
//  stub WebGL2 context: it finds wiring errors (a bad id, a missing name),
//  not render errors. Browser checks do not run here. The surface part
//  checks the SDF mesher (incremental = full rebuild), the vertex colours,
//  the arena, the frame maths, the saver shots and the GLSL (glslang).
//
//  grep -n targets: "section(" opens each group.
// ============================================================================
import { PRESETS, presetById, createSim, COLOUR_MODES, valueOf, maxOf, colourT, fillValues, subtreePrefix,
  replayRange, replayFrac, lineIndex, csvTail, engineExtract, centroid, DEFAULTS, PARAM_INFO } from './sim.js';
import { recordWalk, timeline, frameAt, overlay, CAPTIONS } from './walk.js';
import { clearRect, bandRect, fit2D, ortho2D, project, fit3D, orbitMatrix } from './camera.js';
import { SHOTS, planShots, paceTarget, frameShot, shotLabel } from './saver.js';
import { GRADIENTS } from '../../lib/growth-gradients.js';
import { readFileSync } from 'node:fs';
import { createSurfaceCore, surfaceOptions, surfaceCap, vertexT, RESOLUTIONS } from './surface-core.js';
import { createArena } from './arena.js';
import { MATERIALS, PROGRAMS, RIGS, materialById } from './surface-shaders.js';
import { surfaceFrame } from './surface-frame.js';
import { checkPrograms } from './glsl-check.mjs';
import { meshStats, pipeRadius } from '../../lib/dla-sdf.js';

let pass = 0, fail = 0, cur = '';
function section(s) { cur = s; console.log('\n# ' + s); }
function ok(c, msg) { if (c) pass++; else { fail++; console.log(`  FAIL [${cur}] ${msg}`); } }
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ---------------------------------------------------------------- presets
section('presets: engine under each hook');
const grown = {};
for (const pr of PRESETS) {
  const N = pr.dim === 3 ? 1500 : 2500;
  const m = createSim({ preset: pr.id, seed: 11 });
  const seeds = m.count;
  m.grow(N);
  grown[pr.id] = m;
  ok(m.count === seeds + N, `${pr.id}: count ${m.count} = seeds ${seeds} + ${N}`);
  ok(m.dim === pr.dim, `${pr.id}: dim ${m.dim}`);
  // every joined particle sits ParticleSpacing from its parent (PlaceParticle
  // of every preset keeps the spacing)
  let bad = 0, sp = m.params.particleSpacing;
  for (let i = seeds; i < m.count; i++) {
    const p = m.parent[i];
    if (p < 0 || p >= i) { bad++; continue; }
    const d = Math.hypot(m.pos[i * 3] - m.pos[p * 3], m.pos[i * 3 + 1] - m.pos[p * 3 + 1], m.pos[i * 3 + 2] - m.pos[p * 3 + 2]);
    if (!near(d, sp, 1e-6)) bad++;
  }
  ok(bad === 0, `${pr.id}: ${bad} particles off spacing or with a later parent`);
  ok(pr.code && pr.code.text.length > 20, `${pr.id}: code extract`);
  ok(typeof pr.hook === 'string' && pr.hook.length > 2, `${pr.id}: hook name`);
  if (pr.dim === 2) { let z = 0; for (let i = 0; i < m.count; i++) z = Math.max(z, Math.abs(m.pos[i * 3 + 2])); ok(z === 0, `${pr.id}: 2D keeps z = 0`); }
  const b = pr.frame(m);
  ok(b.x1 > b.x0 && b.y1 > b.y0, `${pr.id}: frame box`);
  console.log(`  ${pr.id.padEnd(9)} n ${m.count} walks ${m.walks} resets ${m.resets} R ${m.boundingRadius.toFixed(1)}`);
}
{
  const m = grown.ring, rr = m.user.ringR;
  ok(m.seedCount === Math.round(3.6 * rr), `ring: ${m.seedCount} seeds = 3.6 r (3600 at r = 1000 in dlaf.cpp)`);
  let inside = 0, mean = 0;
  for (let i = m.seedCount; i < m.count; i++) { const r = Math.hypot(m.pos[i * 3], m.pos[i * 3 + 1]); if (r < rr) inside++; mean += r; }
  mean /= m.count - m.seedCount;
  ok(inside / (m.count - m.seedCount) > 0.97, `ring: ${(100 * inside / (m.count - m.seedCount)).toFixed(1)}% of growth inside the ring`);
  ok(mean < rr * 0.95, `ring: mean radius ${mean.toFixed(1)} < ring ${rr} (grows inward)`);
}
{
  const m = grown.wind, c = centroid(m);
  ok(c[0] < -10, `wind: centroid x ${c[0].toFixed(1)} < -10 (grows upwind, against +x drift)`);
  ok(Math.abs(c[1]) < Math.abs(c[0]) / 2, `wind: skew is along x (y ${c[1].toFixed(1)})`);
  const cc = centroid(grown.classic);
  ok(Math.abs(cc[0]) < Math.abs(c[0]) / 2, `classic: no skew (x ${cc[0].toFixed(1)})`);
}
{
  const m = grown.line; let below = 0;
  for (let i = m.seedCount; i < m.count; i++) if (m.pos[i * 3 + 1] < -1e-9) below++;
  ok(below < (m.count - m.seedCount) * 0.02, `line: ${below} particles below the line`);
  ok(m.user.ext[3] > 20, `line: grows up to y ${m.user.ext[3].toFixed(0)}`);
}
{
  // low stickiness makes push-backs, and a denser cluster than the default
  const a = grown.sticky, b = grown.classic;
  ok(a.params.stickiness < 0.1, 'sticky: stickiness param');
  ok(a.boundingRadius < b.boundingRadius * 0.85, `sticky: R ${a.boundingRadius.toFixed(0)} < classic R ${b.boundingRadius.toFixed(0)} (denser)`);
  const c = grown.stubborn;
  ok(c.params.stubbornness >= 10, 'stubborn: stubbornness param');
  ok(c.boundingRadius < b.boundingRadius * 0.85, `stubborn: R ${c.boundingRadius.toFixed(0)} < classic R (denser)`);
  let maxJA = 0; for (let i = 0; i < c.count; i++) maxJA = Math.max(maxJA, c.joinAttempts[i]);
  ok(maxJA >= c.params.stubbornness, `stubborn: join attempts reach ${maxJA}`);
}
{
  // needle: straighter branches. The mean turn angle between a link and its parent link is smaller.
  const turn = m => { let s = 0, n = 0; const P = m.pos;
    for (let i = m.seedCount; i < m.count; i++) { const p = m.parent[i], g = m.parent[p]; if (g < 0) continue;
      const ax = P[i * 3] - P[p * 3], ay = P[i * 3 + 1] - P[p * 3 + 1], bx = P[p * 3] - P[g * 3], by = P[p * 3 + 1] - P[g * 3 + 1];
      s += Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by))))); n++; }
    return s / n; };
  const tn = turn(grown.needle), tc = turn(grown.classic);
  ok(tn < tc * 0.7, `needle: mean turn ${tn.toFixed(2)} rad < classic ${tc.toFixed(2)} rad`);
}
{
  const m = grown.three; let z = 0; for (let i = 0; i < m.count; i++) z = Math.max(z, Math.abs(m.pos[i * 3 + 2]));
  ok(z > 5, `three: z extent ${z.toFixed(1)}`);
  const m3 = createSim({ preset: 'wind', seed: 2, dim: 3 }); m3.grow(300);
  ok(m3.dim === 3 && m3.count === 301, 'wind in 3D: dim override');
}
{
  const a = createSim({ preset: 'classic', seed: 5 }); a.grow(400);
  const b = createSim({ preset: 'classic', seed: 5 }); b.grow(400);
  ok(a.toCSV() === b.toCSV(), 'same seed, same cluster');
  const c = createSim({ preset: 'classic', seed: 6 }); c.grow(400);
  ok(a.toCSV() !== c.toCSV(), 'new seed, new cluster');
  const d = createSim({ preset: 'classic', seed: 5, params: { attractionDistance: 6 } });
  ok(d.params.attractionDistance === 6 && d.params.particleSpacing === DEFAULTS.particleSpacing, 'params override');
}
ok(PARAM_INFO.map(p => p.dlaf).join() === 'ParticleSpacing,AttractionDistance,MinMoveDistance,Stubbornness,Stickiness', 'PARAM_INFO has the five dlaf names');

// ---------------------------------------------------------------- colour
section('colour mapping');
{
  const m = grown.classic, sub = m.subtreeSizes();
  ok(COLOUR_MODES.map(c => c.id).join() === 'age,depth,distance,flow', 'four colour modes');
  for (const c of COLOUR_MODES) {
    const max = maxOf(c.id, m);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < m.count; i++) { const t = colourT(c.id, valueOf(c.id, m, i, sub), max); lo = Math.min(lo, t); hi = Math.max(hi, t); }
    ok(lo >= c.floor - 1e-9 && hi <= 1 + 1e-9, `${c.id}: t in [${c.floor}, 1] (${lo.toFixed(3)}..${hi.toFixed(3)})`);
    ok(hi > 0.99, `${c.id}: something reaches the hot end (${hi.toFixed(3)})`);
  }
  // age: the newest is hottest; gamma keeps the middle cool
  const n = m.count;
  ok(near(colourT('age', valueOf('age', m, n - 1), maxOf('age', m)), 1), 'age: newest particle at t = 1');
  ok(colourT('age', valueOf('age', m, Math.floor(n / 2)), maxOf('age', m)) < 0.45, 'age: the middle particle is cool');
  ok(near(colourT('age', 0, maxOf('age', m)), modeInfo('age').floor), 'age: the seed at the floor');
  // depth: a child is one hop more than its parent
  let dbad = 0; for (let i = 1; i < n; i++) if (valueOf('depth', m, i) !== valueOf('depth', m, m.parent[i]) + 1) dbad++;
  ok(dbad === 0, 'depth: child = parent + 1');
  // flow: the seed carries all particles, so it is the hottest
  ok(sub[0] === n && near(colourT('flow', valueOf('flow', m, 0, sub), maxOf('flow', m)), 1), 'flow: the seed carries the whole cluster, t = 1');
  let leaves = 0; for (let i = 0; i < n; i++) if (sub[i] === 1) leaves++;
  ok(leaves > n * 0.1, `flow: ${leaves} tips at the cool end`);
  // distance of the ring preset counts inward from the ring
  const r = grown.ring;
  ok(valueOf('distance', r, 0) < 1e-6 && maxOf('distance', r) === r.user.ringR, 'distance: ring seeds at 0, centre at the hot end');
  // fillValues and a gradient change: the values do not depend on the gradient
  const v = fillValues('depth', m, new Float32Array(n));
  ok(v[n - 1] === m.depth[n - 1], 'fillValues depth');
  ok(Object.keys(GRADIENTS).length === 13 && GRADIENTS.inferno, '13 gradients, inferno present');
  // a large cluster recolours fast: values for 50k particles
  const big = createSim({ preset: 'classic', seed: 9 }); big.grow(20000);
  const t0 = performance.now(); const vb = new Float32Array(big.count);
  for (const c of COLOUR_MODES) fillValues(c.id, big, vb);
  const ms = performance.now() - t0;
  ok(ms < 60, `recolour 4 modes x ${big.count} particles in ${ms.toFixed(1)} ms`);
}
function modeInfo(id) { return COLOUR_MODES.find(c => c.id === id); }

// ---------------------------------------------------------------- CSV
section('CSV format (dlaf output)');
{
  const m = createSim({ preset: 'classic', seed: 3 }); m.grow(50);
  const lines = m.toCSV().trimEnd().split('\n');
  ok(lines.length === 51, `51 lines (${lines.length})`);
  ok(lines[0] === '0,-1,0,0,0', `first line "${lines[0]}" like dlaf`);
  const re = /^\d+,-?\d+,-?[\d.e-]+,-?[\d.e-]+,-?[\d.e-]+$/;
  ok(lines.every(l => re.test(l)), 'every line is id,parent_id,x,y,z');
  ok(lines.every((l, i) => +l.split(',')[0] === i), 'ids in order');
  ok(lines.slice(1).every(l => { const [id, p] = l.split(',').map(Number); return p >= 0 && p < id; }), 'parent before child');
  ok(lines.every(l => l.split(',')[4] === '0'), '2D: z is 0');
  const tail = csvTail(m, 5).trimEnd().split('\n');
  ok(tail.length === 5 && tail[4] === lines[50], 'csvTail gives the last lines');
  const t2 = csvTail(m, 5, 10).trimEnd().split('\n');
  ok(t2[4] === lines[9], 'csvTail of a replay prefix');
  const m3 = createSim({ preset: 'three', seed: 3 }); m3.grow(20);
  ok(m3.toCSV().trimEnd().split('\n').some(l => l.split(',')[4] !== '0'), '3D: z is not 0');
}

// ---------------------------------------------------------------- replay
section('replay indexing');
{
  const m = grown.classic, n = m.count;
  const r = replayRange(0.5, n);
  ok(r.k === Math.round(n / 2) && r.points === r.k && r.lineIndices === 2 * r.k, 'replayRange half');
  ok(replayRange(0, n).k === 0 && replayRange(1, n).k === n && replayRange(2, n).k === n && replayRange(-1, n).k === 0, 'replayRange clamps');
  ok(near(replayFrac(r.k, n), r.k / n) && replayFrac(5, 0) === 1, 'replayFrac');
  const idx = lineIndex(m.parent, 0, n, new Uint32Array(2 * n));
  ok(idx[0] === 0 && idx[1] === 0, 'seed link is (0, 0)');
  let bad = 0; for (let i = 1; i < n; i++) if (idx[2 * i] !== m.parent[i] || idx[2 * i + 1] !== i || idx[2 * i] >= i) bad++;
  ok(bad === 0, 'link i is (parent, i), parent < i: a prefix of 2k indices is the cluster at k');
  // the prefix subtree sizes equal the sizes of a model that stopped at k
  const k = 900, a = createSim({ preset: 'classic', seed: 21 }); a.grow(k - 1);
  const b = createSim({ preset: 'classic', seed: 21 }); b.grow(2000);
  const sa = a.subtreeSizes(), sb = subtreePrefix(b.parent, k);
  let sbad = 0; for (let i = 0; i < k; i++) if (sa[i] !== sb[i]) sbad++;
  ok(a.count === k && sbad === 0, 'subtreePrefix(k) = subtree sizes of the model at k');
  // prefix maxima for depth and distance
  ok(b.user.maxDepthAt[k - 1] === a.user.maxDepth && near(b.user.maxDistAt[k - 1], a.user.maxDist, 1e-4), 'prefix max depth and distance at k');
  ok(maxOf('age', b, k) === k - 1, 'age max of a replay prefix is k - 1');
}

// ---------------------------------------------------------------- walker
section('walker record and timing');
{
  const m = createSim({ preset: 'classic', seed: 5, params: { stickiness: 0.35 } }); m.grow(250);
  const kinds = {}; let anyPush = false, total = 0;
  for (let j = 0; j < 12; j++) {
    const n0 = m.count, rec = recordWalk(m);
    ok(rec.id === n0 && m.count === n0 + 1, `walk ${j}: one particle joined`);
    const ev = rec.events;
    ok(ev[0].kind === 'start' && ev[ev.length - 1].kind === 'join', `walk ${j}: start ... join`);
    for (const e of ev) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    // a jump never passes a particle: the jump circle (radius r around the start) holds no particle
    for (const e of ev) if (e.kind === 'jump') {
      let dmin = Infinity; for (let i = 0; i < n0; i++) dmin = Math.min(dmin, Math.hypot(m.pos[i * 3] - e.from[0], m.pos[i * 3 + 1] - e.from[1]));
      if (dmin < e.r + m.params.attractionDistance - 1e-6) { ok(false, `walk ${j}: a jump of ${e.r.toFixed(2)} with a particle at ${dmin.toFixed(2)}`); break; }
    }
    const last = ev[ev.length - 1];
    ok(near(Math.hypot(last.to[0] - m.pos[last.parent * 3], last.to[1] - m.pos[last.parent * 3 + 1]), m.params.particleSpacing), `walk ${j}: join at ParticleSpacing`);
    ok(last.d < m.params.attractionDistance + 1e-9, `walk ${j}: join inside AttractionDistance (${last.d.toFixed(2)})`);
    for (const e of ev) if (e.kind === 'push') {
      anyPush = true;
      const P = m.pos, d = Math.hypot(e.to[0] - P[e.parent * 3], e.to[1] - P[e.parent * 3 + 1]);
      ok(near(d, m.params.attractionDistance + m.params.minMoveDistance, 1e-6), `walk ${j}: push-back to A + MinMove (${d.toFixed(3)})`);
    }
    const t = timeline(rec);
    total += t[t.length - 1];
    ok(t[t.length - 1] < 45, `walk ${j}: plays in ${t[t.length - 1].toFixed(1)} s`);
    const fr = frameAt(t, t[t.length - 1] / 2);
    ok(fr.i >= 0 && fr.i < ev.length && fr.f >= 0 && fr.f <= 1, `walk ${j}: frameAt middle`);
    ok(frameAt(t, 1e9).done && frameAt(t, 0).i === 0, `walk ${j}: frameAt ends`);
    const ov = overlay(m, rec, fr, { walker: [1, 1, 1], ring: [1, 0, 0], jump: [0, 1, 0], push: [0, 0, 1], join: [1, 1, 0], trail: [1, 1, 1], bound: [.5, .5, .5] });
    ok(ov.lines.length % 16 === 0 && ov.points.length % 8 === 0 && ov.points.length >= 8, `walk ${j}: overlay vertices`);
    ok(ov.lines.every(Number.isFinite) && ov.points.every(Number.isFinite), `walk ${j}: finite overlay`);
  }
  ok(kinds.jump > 0 && kinds.step > 0, `jumps ${kinds.jump}, steps ${kinds.step}`);
  ok(anyPush, `push-backs at stickiness 0.35 (${kinds.push || 0})`);
  ok(Object.keys(CAPTIONS).sort().join() === 'join,jump,push,reset,start,step', 'a caption for each event kind');
  console.log(`  12 walks: ${JSON.stringify(kinds)}, ${total.toFixed(0)} s of slow motion`);
}

// ---------------------------------------------------------------- camera
section('view maths');
{
  const w = 1200, h = 800;
  const r = clearRect(w, h, { l: 300, b: 40 });
  ok(r.x === 300 && r.y === 0 && r.w === 900 && r.h === 760, 'clearRect minus the panel and the status bar');
  const v = fit2D({ x0: -50, x1: 50, y0: -50, y1: 50 }, r, w, h, 0.9);
  const M = ortho2D(v, w, h);
  const c = project(M, [0, 0, 0], w, h), top = project(M, [0, 50, 0], w, h), rt = project(M, [50, 0, 0], w, h);
  ok(near(c[0], r.x + r.w / 2, 1e-3) && near(c[1], r.y + r.h / 2, 1e-3), 'the box centre maps to the rect centre');
  ok(top[1] < c[1] && near(c[1] - top[1], 0.45 * r.h, 1e-3), 'y is up and the box fills 90% of the short side');
  ok(near(rt[0] - c[0], c[1] - top[1], 1e-3), 'square pixels');
  // 3D: the ball of radius r stays inside the rect
  const R3 = 40, d = fit3D(R3, r, w, h);
  const O = orbitMatrix({ dist: d, yaw: 0.7, pitch: 0.3, ox: r.x + r.w / 2 - w / 2, oy: r.y + r.h / 2 - h / 2 }, w, h);
  const o = project(O, [0, 0, 0], w, h);
  ok(near(o[0], r.x + r.w / 2, 1e-2) && near(o[1], r.y + r.h / 2, 1e-2), '3D: the origin maps to the rect centre');
  let inside = true;
  for (let i = 0; i < 200; i++) {
    const a = i * 2.39996, z = 1 - 2 * (i + 0.5) / 200, s = Math.sqrt(1 - z * z);
    const p = project(O, [Math.cos(a) * s * R3, z * R3, Math.sin(a) * s * R3], w, h);
    if (p[0] < r.x || p[0] > r.x + r.w || p[1] < r.y || p[1] > r.y + r.h) inside = false;
  }
  ok(inside, '3D: a ball of the fit radius is inside the rect');
}

// ---------------------------------------------------------------- saver
section('saver shots and framing');
{
  ok(SHOTS.length >= 8 && new Set(SHOTS.map(s => s.id)).size === SHOTS.length, `${SHOTS.length} unique shots`);
  ok(SHOTS.every(s => presetById(s.preset).id === s.preset && GRADIENTS[s.grad] && COLOUR_MODES.some(c => c.id === s.mode)), 'each shot names a real preset, gradient and mode');
  for (const id of ['classic', 'ring', 'wind', 'orbit', 'walker', 'trunk']) ok(SHOTS.some(s => s.id === id), `shot ${id}`);
  ok(SHOTS.find(s => s.id === 'trunk').mode === 'flow' && SHOTS.find(s => s.id === 'classic').grad === 'inferno', 'trunk is flow, classic is inferno');
  const a = planShots(42, 0.7, 30), b = planShots(42, 0.7, 30), c = planShots(43, 0.7, 30);
  ok(a.map(x => x.shot.id + x.seed).join() === b.map(x => x.shot.id + x.seed).join(), 'same seed, same plan');
  ok(a.map(x => x.shot.id).join() !== c.map(x => x.shot.id).join(), 'new seed, new order');
  ok(a.every(x => x.dur >= 5 && x.dur <= 12), `durations 5..12 s (${Math.min(...a.map(x => x.dur)).toFixed(1)}..${Math.max(...a.map(x => x.dur)).toFixed(1)})`);
  ok(a.every((x, i) => i === 0 || x.shot.id !== a[i - 1].shot.id), 'no shot twice in a row');
  ok(new Set(a.slice(0, SHOTS.length).map(x => x.shot.id)).size === SHOTS.length, 'the first round shows every shot');
  ok(new Set(a.map(x => x.seed)).size === a.length, 'each shot a new growth seed');
  const lo = planShots(7, 0, 60), hi = planShots(7, 1, 60), avg = p => p.reduce((s, x) => s + x.dur, 0) / p.length;
  ok(avg(hi) > avg(lo), `calm 1 gives longer shots (${avg(lo).toFixed(1)} -> ${avg(hi).toFixed(1)} s)`);
  ok(paceTarget(1000, 0, 8) === 1 && paceTarget(1000, 7.2, 8) === 1000 && paceTarget(1000, 3.6, 8) < 500, 'pace: ease-in to the target at 90%');
  // framing for 16:9 and 9:16, with and without a plate band
  const cases = [
    { name: '16:9 plate', w: 1920, h: 1080, band: { t: 250, b: 290, w: 1920 } },
    { name: '9:16 plate', w: 1080, h: 1920, band: { t: 420, b: 520, w: 1080 } },
    { name: '9:16 column in 16:9', w: 1920, h: 1080, band: { t: 200, b: 240, w: 608 } },
    { name: '16:9 no plate', w: 1920, h: 1080, band: null },
  ];
  for (const k of cases) {
    for (const id of ['classic', 'ring', 'line', 'three']) {
      const m = grown[id], box = presetById(id).frame(m), f = frameShot(box, k.w, k.h, k.band, m.dim);
      const rc = f.rect;
      ok(rc.y >= (k.band ? Math.min(k.band.t, k.h * 0.42) : 0) - 1e-6 && rc.y + rc.h <= k.h - (k.band ? Math.min(k.band.b, k.h * 0.42) : 0) + 1e-6, `${k.name} ${id}: rect in the band`);
      ok(rc.x >= 0 && rc.x + rc.w <= k.w + 1e-6 && near(rc.x + rc.w / 2, k.w / 2), `${k.name} ${id}: rect centred`);
      let M;
      if (f.kind === '2d') M = ortho2D(f.view, k.w, k.h);
      else M = orbitMatrix({ dist: f.dist, yaw: 1.1, pitch: 0.3, ox: f.ox, oy: f.oy }, k.w, k.h);
      let out = 0;
      for (let i = 0; i < m.count; i += 7) {
        const p = project(M, [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]], k.w, k.h);
        if (p[0] < rc.x - 1 || p[0] > rc.x + rc.w + 1 || p[1] < rc.y - 1 || p[1] > rc.y + rc.h + 1) out++;
      }
      ok(out === 0, `${k.name} ${id}: all particles inside the clear band (${out} out)`);
    }
  }
  const lab = shotLabel(SHOTS[0], grown.classic, engineExtract(grown.classic));
  ok(lab.title && lab.sub.includes('dlaf') && lab.params.some(p => p.name === 'AttractionDistance' && p.value === '3'), 'label: title, sub, AttractionDistance');
  ok(lab.params.find(p => p.name === 'particles').value === String(grown.classic.count), 'label: live particle count');
  ok(lab.code.text.includes('attractionDistance') && lab.code.text.split('\n').length >= 6, 'label: code is a real engine extract');
  ok(lab.lines.some(l => l.includes('Fogleman')), 'label: credit line');
  for (const id of ['sdf-orbit', 'copper-relief']) {
    const sh = SHOTS.find(x => x.id === id);
    ok(sh && sh.surface && MATERIALS.some(m => m.id === sh.material), `surface shot ${id} has a real material`);
    ok(new Set(a.slice(0, SHOTS.length).map(x => x.shot.id)).has(id), `the first round of the plan shows ${id}`);
  }
  ok(SHOTS.find(x => x.id === 'sdf-orbit').dim === 3 && SHOTS.find(x => x.id === 'copper-relief').material === 'copper' && !SHOTS.find(x => x.id === 'copper-relief').dim, 'sdf-orbit is 3D, copper-relief is a 2D copper relief');
  ok(shotLabel(SHOTS.find(x => x.id === 'sdf-orbit'), grown.three, 'x').lines.some(l => l.includes('smooth minimum')), 'surface shot label names the SDF');
}

// ---------------------------------------------------------------- surface
section('surface: SDF mesh, incremental = full rebuild');
function buildSurface(m, chunk, sliceMs) {
  const core = createSurfaceCore(surfaceOptions({ res: 'low' }));
  const recs = new Map();
  const take = list => { for (const r of list) { if (r.indices.length) recs.set(r.key, r); else recs.delete(r.key); } };
  for (let a = 0; a < m.count; a += chunk) { core.add(m.pos, m.parent, a, Math.min(m.count, a + chunk)); take(core.update(sliceMs)); }
  take(core.drain());
  return { core, recs };
}
const sameArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
for (const [id, n] of [['classic', 1200], ['three', 900]]) {
  const m = createSim({ preset: id, seed: 5 }); m.grow(n);
  const inc = buildSurface(m, 37, 2), full = buildSurface(m, m.count, Infinity);
  const ki = [...inc.recs.keys()].sort(), kf = [...full.recs.keys()].sort();
  ok(sameArr(ki, kf), `${id}: same bricks (${ki.length} incremental, ${kf.length} full)`);
  let diff = 0, aoDiff = 0;
  for (const k of kf) {
    const a = inc.recs.get(k), b = full.recs.get(k); if (!a) { diff++; continue; }
    if (!sameArr(a.positions, b.positions) || !sameArr(a.normals, b.normals) || !sameArr(a.ids, b.ids) || !sameArr(a.indices, b.indices)) diff++;
    for (let v = 0; v < b.ao.length; v++) aoDiff = Math.max(aoDiff, Math.abs(a.ao[v] - b.ao[v]));
  }
  ok(diff === 0, `${id}: incremental meshes equal the full build bit for bit (${diff} differ)`);
  ok(aoDiff < 1e-6, `${id}: incremental AO equals the full build (max diff ${aoDiff.toExponential(1)})`);
  // the lib's own full rebuild of the same primitives gives the same meshes
  inc.core.sdf.rebuildAll();
  const lib = new Map(inc.core.sdf.meshAll().map(r => [r.key, r]));
  let libDiff = 0;
  for (const k of kf) { const a = lib.get(k), b = inc.recs.get(k); if (!a || !sameArr(a.positions, b.positions) || !sameArr(a.indices, b.indices) || !sameArr(a.ids, b.ids)) libDiff++; }
  ok(libDiff === 0 && lib.size === kf.length, `${id}: lib rebuildAll + meshAll equals the live meshes (${libDiff} differ)`);
  const o = inc.core.opts;
  let badR = 0;
  for (let i = 0; i < m.count; i++) if (inc.core.radius(i) !== Math.fround(pipeRadius(inc.core.sub(i), o.rTip, o.pipe, o.rMax, o.quant, o.sub0))) badR++;
  ok(badR === 0, `${id}: after finish every radius follows the pipe rule (${badR} off)`);
  const st = meshStats([...inc.recs.values()]);
  ok(st.boundaryEdges === 0, `${id}: closed surface (${st.tris} tris, ${st.boundaryEdges} boundary edges, ${st.nonManifold} non-manifold)`);
  console.log(`  ${id.padEnd(8)} n ${m.count} bricks ${kf.length} verts ${inc.core.stats.verts} tris ${inc.core.stats.tris} flushes ${inc.core.stats.flushes} cone resets ${inc.core.stats.coneResets}`);
  // colour per vertex: every id is a particle, every t is in [floor, 1]
  let badId = 0, badT = 0, badAO = 0, badN = 0, nv = 0;
  for (const c of COLOUR_MODES) {
    const vals = fillValues(c.id, m, new Float32Array(m.count)), max = maxOf(c.id, m);
    for (const r of inc.recs.values()) for (let v = 0; v < r.ids.length; v++) {
      const t = vertexT(vals, r.ids, v, max, c.floor, c.gamma);
      if (!(t >= c.floor - 1e-6 && t <= 1 + 1e-6)) badT++;
      if (c.id === 'age') {
        nv++;
        if (!(r.ids[v] >= 0 && r.ids[v] < m.count && Number.isInteger(r.ids[v]))) badId++;
        if (!(r.ao[v] >= 0 && r.ao[v] <= 1)) badAO++;
        if (Math.abs(Math.hypot(r.normals[v * 3], r.normals[v * 3 + 1], r.normals[v * 3 + 2]) - 1) > 1e-3) badN++;
      }
    }
  }
  ok(badId === 0, `${id}: every vertex id is a particle (${nv} vertices, ${badId} bad)`);
  ok(badT === 0, `${id}: every vertex colour t is in [floor, 1] for all ${COLOUR_MODES.length} modes (${badT} bad)`);
  ok(badAO === 0 && badN === 0, `${id}: AO in 0..1 and unit normals (${badAO}, ${badN} bad)`);
}
{
  // the newest particles own vertices at the front: the age glow has a target
  const m = createSim({ preset: 'three', seed: 9 }); m.grow(600);
  const { recs } = buildSurface(m, 50, 3);
  let front = 0; for (const r of recs.values()) for (const id of r.ids) if (id >= m.count - 24) front++;
  ok(front > 0, `the 24 newest particles own ${front} vertices (the growth-front glow shows)`);
  // a vertex near a branch tip in a crevice is darker than one on the outside
  let lo = 1, hi = 0; for (const r of recs.values()) for (const a of r.ao) { lo = Math.min(lo, a); hi = Math.max(hi, a); }
  ok(lo < 0.6 && hi > 0.95, `AO spans crevices to open tips (${lo.toFixed(2)}..${hi.toFixed(2)})`);
}

section('surface: worker protocol (worker module on stub globals)');
await (async () => {
  const got = [];
  globalThis.postMessage = (m) => got.push(m);
  await import('./surface-worker.js');
  const m = createSim({ preset: 'three', seed: 4 }); m.grow(300);
  const opts = surfaceOptions({ res: 'low' });
  globalThis.onmessage({ data: { type: 'reset', gen: 3, opts } });
  globalThis.onmessage({ data: { type: 'add', gen: 3, from: 0, pos: new Float32Array(m.pos.subarray(0, 450)), parent: new Int32Array(m.parent.subarray(0, 150)) } });
  globalThis.onmessage({ data: { type: 'add', gen: 2, from: 150, pos: new Float32Array(3), parent: new Int32Array(1) } });   // an old gen: dropped
  globalThis.onmessage({ data: { type: 'add', gen: 3, from: 150, pos: new Float32Array(m.pos.subarray(450, m.count * 3)), parent: new Int32Array(m.parent.subarray(150, m.count)) } });
  globalThis.onmessage({ data: { type: 'finish', gen: 3 } });
  for (let i = 0; i < 400 && !(got.length && got[got.length - 1].busy === false); i++) await new Promise(r => setTimeout(r, 5));
  const last = got[got.length - 1];
  ok(last && last.gen === 3 && last.applied === m.count && last.busy === false, `worker meshes all ${m.count} particles and goes idle (${got.length} messages)`);
  const keys = new Map(); for (const g of got) for (const r of g.list) { if (r.indices.length) keys.set(r.key, r); else keys.delete(r.key); }
  const ref = createSurfaceCore(opts); ref.add(m.pos, m.parent, 0, m.count); ref.drain();
  let d = 0; for (const [k, r] of ref.meshes) { const a = keys.get(k); if (!a || a.indices.length !== r.indices.length) d++; }
  ok(d === 0 && keys.size === ref.meshes.size, `worker bricks match an inline core (${keys.size} bricks, ${d} differ)`);
  delete globalThis.postMessage; delete globalThis.onmessage;
})();

section('surface: options, arena, frame, shaders');
{
  const d = surfaceOptions({}), ph = surfaceOptions({ res: 'high', phone: true });
  ok(ph.res === 'medium' && ph.cell > surfaceOptions({ res: 'high' }).cell, 'phones cap the resolution at medium');
  ok(RESOLUTIONS.every((r, i) => i === 0 || r.cell < RESOLUTIONS[i - 1].cell), 'resolutions get finer in order');
  ok(surfaceOptions({ flow: 0 }).rMax === d.rTip && surfaceOptions({ flow: 1 }).rMax > d.rMax, 'flow 0 gives one tube width, flow 1 the thickest trunks');
  ok(surfaceOptions({ blend: 0 }).k > 0 && surfaceOptions({ blend: 1 }).k > d.k, 'blend k stays above 0 and grows');
  ok(surfaceCap(2, true) < surfaceCap(2, false) && surfaceCap(3, true) < surfaceCap(3, false), 'phones stop the surface growth earlier');
  const A = createArena(64), slots = [];
  for (let i = 0; i < 200; i++) slots.push(A.alloc(1 + (i * 37) % 300));
  for (let i = 0; i < 200; i += 3) A.free(slots[i]);
  for (let i = 0; i < 80; i++) slots.push(A.alloc(1 + (i * 53) % 300));
  const live = slots.filter((s, i) => !(i < 200 && i % 3 === 0)).sort((a, b) => a.off - b.off);
  let overlap = 0; for (let i = 1; i < live.length; i++) if (live[i].off < live[i - 1].off + live[i - 1].size) overlap++;
  ok(overlap === 0 && live.every(s => s.off + s.size <= A.top && A.top <= A.cap), `arena: ${live.length} live slots, no overlap, top ${A.top} <= cap ${A.cap}`);
  ok(A.live === live.length, 'arena: live count');
  ok(MATERIALS.length === 4 && ['porcelain', 'glass', 'copper', 'bio'].every(id => materialById(id).id === id && RIGS[id]), 'four materials with light rigs');
  const opts = surfaceOptions({});
  for (const dim of [2, 3]) {
    const f = surfaceFrame({ dim, mat: new Float32Array(16), cam: { yaw: 0.7, pitch: 0.4, dist: 120 }, center: [0, 0, 0], radius: 60, minUp: -58, opts, material: 'copper', w: 800, h: 600, max: 1, floor: 0.1, gamma: 1, count: 10 });
    const pr = (M, p) => { const x = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], y = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], z = M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]; return [x, y, z]; };
    let inside = true;
    for (const p of [[60, 0, 0], [-60, 0, 0], [0, 60, 0], [0, -60, 0], [0, 0, 60], [0, 0, -60]]) { const q = pr(f.light, p); if (q.some(v => Math.abs(v) > 1)) inside = false; }
    ok(inside, `${dim}D: the shadow map holds the cluster ball`);
    const g = f.ground.height, gp = dim === 3 ? [5, g, 5] : [5, 5, g];
    ok(Math.abs(pr(f.below, gp)[2] + 1) < 1e-4, `${dim}D: the below map puts the ground at depth 0`);
    const up = f.up, Lup = f.L[0] * up[0] + f.L[1] * up[1] + f.L[2] * up[2];
    ok(Lup > 0.3 && Lup < 0.9, `${dim}D: key light above the ground (sin elevation ${Lup.toFixed(2)})`);
    ok(dim === 3 ? g < -58 : g < 0 && g > -opts.rTip, `${dim}D: ground under the cluster (${g.toFixed(2)})`);
  }
  const res = checkPrograms(PROGRAMS);
  if (!res) console.log('  glslangValidator not found: GLSL compile check skipped');
  else for (const r of res) ok(r.ok, `GLSL ES 3.00 compiles and links (glslang): ${r.name}${r.ok ? '' : ' ' + r.log.slice(0, 300)}`);
}

// ---------------------------------------------------------------- files
section('page files');
{
  const dir = new URL('.', import.meta.url);
  const html = readFileSync(new URL('index.html', dir), 'utf8'), css = readFileSync(new URL('style.css', dir), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  const order = ['gpu-guard.js', 'wishlist.js', 'stats-beacon.js', 'viewport-fit=cover', 'name="description"', 'style.css', 'sci.css', 'growth-gradients.css'].map(s => head.indexOf(s));
  ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), `head order (${order.join(',')})`);
  ok(html.includes("if(window!==window.top)document.documentElement.classList.add('in-frame')"), 'in-frame script');
  ok(/\[hidden\]\{display:none!important\}/.test(css), '[hidden] rule');
  const ids = [...html.matchAll(/id="([^"]+)"[^>]*\shidden\b|\shidden\b[^>]*id="([^"]+)"/g)].map(x => x[1] || x[2]);
  for (const id of ids) ok(!new RegExp('#' + id + '\\s*\\{[^}]*display\\s*:\\s*(?!none)').test(css), `#${id} has hidden and no display rule`);
  ok(!/https?:\/\/(?!github\.com\/fogleman\/dlaf)/.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'no external URL but the dlaf link');
  for (const f of ['main.js', 'sim.js', 'walk.js', 'camera.js', 'saver.js', 'render.js', 'surface.js', 'surface-core.js', 'surface-worker.js', 'surface-render.js', 'surface-shaders.js', 'surface-frame.js', 'arena.js']) {
    const s = readFileSync(new URL(f, dir), 'utf8');
    ok(!/fetch\(|XMLHttpRequest|https?:\/\/(?!github\.com\/fogleman\/dlaf)/.test(s.replace(/\/\/.*$/gm, '')), `${f}: no network call`);
  }
  const cr = readFileSync(new URL('CREDITS.txt', dir), 'utf8');
  ok(cr.includes('Copyright (C) 2019 Michael Fogleman') && cr.includes('Permission is hereby granted') && cr.includes('https://github.com/fogleman/dlaf'), 'CREDITS.txt has the MIT notice');
}

// ---------------------------------------------------------------- main.js on a stub DOM
section('main.js boot on a stub DOM (wiring only)');
await (async () => {
  const els = new Map(), listeners = [];
  const mkClass = () => { const s = new Set(); return { add: (...a) => a.forEach(x => s.add(x)), remove: (...a) => a.forEach(x => s.delete(x)), toggle: (x, f) => { const on = f === undefined ? !s.has(x) : !!f; if (on) s.add(x); else s.delete(x); return on; }, contains: x => s.has(x) }; };
  const glStub = () => new Proxy({}, { get(t, k) {
    if (k in t) return t[k];
    if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return 1;
    if (k === 'getShaderParameter' || k === 'getProgramParameter') return (o, p) => p === 'n' ? 0 : true;
    if (k === 'getActiveUniform') return () => ({ name: 'u' });
    return () => ({});
  } });
  function el(id, tag = 'div') {
    if (id && els.has(id)) return els.get(id);
    const e = {
      id, tagName: tag.toUpperCase(), hidden: false, style: {}, dataset: {}, classList: mkClass(), children: [], textContent: '', innerHTML: '', value: '0', max: '1',
      clientWidth: 1200, clientHeight: 800, width: 0, height: 0,
      addEventListener(ev, fn) { listeners.push({ el: e, ev, fn }); }, setAttribute() {}, appendChild(c) { e.children.push(c); return c; }, remove() {},
      querySelector(sel) { return el(null, sel.includes('input') ? 'input' : 'span'); }, querySelectorAll() { return []; },
      getBoundingClientRect() { return id === 'panel' ? { left: 0, right: 300, top: 0, bottom: 800, width: 300, height: 800 } : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; },
      getContext(kind) { return kind === 'webgl2' ? glStub() : null; }, setPointerCapture() {}, click() {},
    };
    if (id) els.set(id, e);
    return e;
  }
  const html = readFileSync(new URL('index.html', import.meta.url), 'utf8');
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) el(id);
  let raf = [];
  Object.assign(globalThis, {
    window: globalThis, devicePixelRatio: 2, location: { search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: fn => { raf.push(fn); return raf.length; },
    document: {
      getElementById: id => els.get(id) || null, createElement: tag => el(null, tag), querySelector: () => el(null),
      querySelectorAll: () => [], documentElement: el('html'), body: el('body'), head: el('head'),
    },
    URL: Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL() {} }),
  });
  let err = null;
  try {
    await import('./main.js');
    const step = n => { for (let i = 0; i < n; i++) { const q = raf; raf = []; const t = 16.7 * (i + 1) + (step.t = (step.t || 0) + 16.7); q.forEach(f => f(t)); } };
    step(20);
    const S = window.dlaf || (await import('./main.js')).S;
    ok(S.m && S.m.count > 20, `grows in the frame loop (${S.m.count} particles after 20 frames)`);
    const fire = (id, ev = 'click') => listeners.filter(l => l.el.id === id && l.ev === ev).forEach(l => l.fn({ clientX: 0, clientY: 0, pointerId: 1, preventDefault() {}, deltaY: 1 }));
    fire('modeWalk'); step(30);
    ok(S.mode === 'walk' && S.walk && S.walk.rec, 'walk mode records a walker');
    fire('walkNext'); step(5); fire('modeGrow'); step(5);
    fire('dim3'); step(10);
    ok(S.dim === 3 && S.m.dim === 3, '3D regrow');
    fire('dim2'); step(5);
    els.get('replay').value = '500'; fire('replay', 'input'); step(3);
    ok(S.replay && S.replay.k === Math.round(S.m.count / 2), 'replay slider sets k');
    fire('replayPlay'); step(5); fire('replayLive'); step(2);
    ok(!S.replay, 'live again');
    fire('csvBtn'); fire('regrowBtn'); fire('pauseBtn'); step(3); fire('pauseBtn');
    fire('surfOn'); step(40);
    ok(S.surf.on && !S.surf.err && S.surf.sf && S.surf.sf.mode === 'inline', `surface on, inline core in node (${S.surf.err || 'no error'})`);
    ok(S.surf.sf.applied > 0 && S.surf.SR.bricks > 0, `surface grows and uploads (${S.surf.sf.applied} particles meshed, ${S.surf.SR.bricks} bricks, ${S.surf.SR.verts} verts)`);
    ok(S.m.count <= S.surf.sf.applied + 400, `growth waits for the mesher (${S.m.count} grown, ${S.surf.sf.applied} meshed)`);
    fire('dim3'); step(20);
    ok(S.surf.sf.applied > 0 && S.m.dim === 3, `3D surface after a regrow (${S.surf.sf.applied} meshed)`);
    fire('surfOff'); step(2); fire('dim2'); step(2);
    const labels = [];
    const ret = await window.snSaver.enter({ seed: 5, calm: 0.7, label: i => labels.push(i) });
    ok(ret.canvas === els.get('gl'), 'snSaver.enter returns the page canvas');
    for (let i = 0; i < 1400; i++) step(1);
    ok(labels.length > 3 && labels[0].title === 'Diffusion-limited aggregation', `saver labels (${labels.length})`);
    const titles = new Set(labels.map(l => l.sub));
    ok(titles.size >= 2, `saver cut ${titles.size} shots in about 23 s`);
    window.snSaver.exit(); step(3);
    ok(!S.saverOn && S.mode === 'grow', 'snSaver.exit returns to the page');
  } catch (e) { err = e; }
  ok(!err, 'no error in the stub boot' + (err ? ': ' + (err.stack || err).toString().split('\n').slice(0, 3).join(' | ') : ''));
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

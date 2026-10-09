// ============================================================================
//  FLIP WATER  ·  tests.mjs  —  node checks (no browser)
// ----------------------------------------------------------------------------
//  Run: node tests.mjs            (all checks; the seed sweep uses workers)
//       node tests.mjs --quick    (20 seeds instead of 200)
//
//  Checks
//    sweep        200 random seeds x 600 frames: no NaN, no particle out of
//                 the tank, particle count = initial + emitted - drained,
//                 water area from the grid within 0.6..1.6 of the particle
//                 area (no collapse, no blow-up)
//    determinism  the same seed gives the same particles after 120 frames
//    hash         encodeHash / decodeHash round-trip of random states
//    preset       the default 'harbour' scene builds and runs
//    bodies       still pool: a crate of density 0.5 floats half
//                 submerged, the wet fraction follows the density, a
//                 rock sinks, a capsized boat rights itself, floating
//                 bodies raise the level by their
//                 displaced area; the sweep also checks every body
//                 stays finite and inside the tank
//    looks        every view x scheme x background draws finite numbers
//    saver        each shot runs finite; TeX plates, no code; no water
//                 scheme twice in a row; the close-up zoom
//    tools        palette drop, grab spring, throw, eraser, clear
//    import       main.js links in node (a SyntaxError is a bug; a
//                 ReferenceError on a browser global is expected)
//
//  grep -n targets: function sweepSeeds  function check  CHECKS.push
// ============================================================================
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import * as SC from './scenes.js';
import * as B from './bodies.js';

const FRAMES = 600;
const ENV = { budget: 2400, minRes: 30, portrait: false };

function randomState(i) {
  const st = SC.defaultState();
  st.seed = 'test' + i;
  return st;
}

export function runSeed(i, frames = FRAMES) {
  const st = randomState(i);
  const spec = SC.build(st, ENV);
  const sim = SC.createSim(spec, B.makeBodies);
  const res = { i, kind: spec.waterKind, bad: [], bodies: spec.objects.length };
  let minRatio = 9, maxRatio = 0;
  for (let f = 0; f < frames; f++) {
    sim.step();
    if (f % 100 === 99 || f === frames - 1) {
      const s = sim.stats();
      if (s.nan) res.bad.push(`frame ${f}: ${s.nan} NaN`);
      if (s.out) res.bad.push(`frame ${f}: ${s.out} particles out of the tank`);
      if (s.n !== s.initial + s.emitted - s.drained) res.bad.push(`frame ${f}: count ${s.n} != ${s.initial}+${s.emitted}-${s.drained}`);
      if (s.n > 50) {
        const ratio = s.area / s.particleArea;
        minRatio = Math.min(minRatio, ratio); maxRatio = Math.max(maxRatio, ratio);
      }
      for (const b of sim.solids) if (!b.kinematic && !(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.a))) res.bad.push(`frame ${f}: body ${b.kind} not finite`);
      for (const b of sim.solids) if (!b.kinematic && (b.x < 0 || b.x > spec.W || b.y < 0 || b.y > spec.H)) res.bad.push(`frame ${f}: body ${b.kind} left the tank`);
      if (res.bad.length) break;
    }
  }
  if (minRatio < 0.6 || maxRatio > 1.6) res.bad.push(`area ratio ${minRatio.toFixed(2)}..${maxRatio.toFixed(2)} outside 0.6..1.6`);
  res.minRatio = minRatio; res.maxRatio = maxRatio;
  return res;
}

if (!isMainThread) {
  const out = [];
  for (const i of workerData.seeds) out.push(runSeed(i));
  parentPort.postMessage(out);
} else {
  await main();
}

async function sweepSeeds(n) {
  const cores = Math.max(1, Math.min(8, os.cpus().length - 1));
  const buckets = Array.from({ length: cores }, () => []);
  for (let i = 0; i < n; i++) buckets[i % cores].push(i);
  const file = fileURLToPath(import.meta.url);
  const parts = await Promise.all(buckets.map(seeds => new Promise((res, rej) => {
    const w = new Worker(file, { workerData: { seeds } });
    w.on('message', res); w.on('error', rej);
  })));
  return parts.flat().sort((a, b) => a.i - b.i);
}

async function main() {
  const quick = process.argv.includes('--quick');
  let pass = 0, fail = 0;
  const check = (name, ok, info = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

  // hash round-trip
  {
    let ok = true, n = 0;
    const r = (k) => Math.abs(Math.sin(k * 12.9898) * 43758.5453) % 1;
    for (let k = 0; k < 300; k++) {
      const st = SC.defaultState();
      st.seed = SC.newSeed(() => r(k + 0.1));
      const cats = SC.CATS.concat(['objects']);
      for (const c of cats) if (r(k * 7 + c.length) < 0.3) st.sub[c] = SC.newSeed(() => r(k + c.length * 3.3));
      st.locks = cats.filter((c, j) => r(k * 3 + j) < 0.25).sort();
      for (const key of Object.keys(SC.OVERRIDES)) if (r(k * 11 + key.length) < 0.3) st.over[key] = +(r(k + key.length) * 3).toFixed(3);
      const back = SC.decodeHash(SC.encodeHash(st));
      const norm = (s) => JSON.stringify({ seed: s.seed, sub: Object.fromEntries(Object.entries(s.sub).sort()), locks: s.locks.slice().sort(), colours: Object.fromEntries(Object.entries(s.colours).map(([a, b]) => [a, String(b)]).sort()), over: Object.fromEntries(Object.entries(s.over).sort()) });
      if (norm(back) !== norm(st)) { ok = false; console.log('  mismatch', norm(st), norm(back)); break; }
      n++;
    }
    check('hash round-trip of seed, sub-seeds, locks, colours and overrides', ok, `${n} states`);
    const a = SC.decodeHash('#s=abc&lock=tank.water&tank=zzz&o.flip=0.5&o.bogus=3');
    check('hash decode keeps known keys only', a.seed === 'abc' && a.sub.tank === 'zzz' && a.locks.join() === 'tank.water'.replace('.', ',') && a.over.flip === 0.5 && !('bogus' in a.over));
  }

  // rolls and locks
  {
    const st = SC.defaultState(); st.seed = 'lockme'; st.locks = ['tank', 'gravity'];
    const s0 = SC.build(st, ENV);
    const next = SC.rollAll(st, () => 0.42);
    const s1 = SC.build(next, ENV);
    check('a locked category keeps its draws after New scene', s0.g === s1.g && s0.tilt === s1.tilt && s0.W === s1.W && s0.H === s1.H, `seed ${st.seed} -> ${next.seed}`);
    const st2 = SC.rollCat(st, 'gravity', () => 0.9);
    const s2 = SC.build(st2, ENV);
    check('rolling one category leaves the others', s2.W === s0.W && s2.flip === s0.flip && s2.waterKind === s0.waterKind);
  }

  // determinism
  {
    const st = SC.defaultState(); st.seed = 'det42';
    const run = () => { const sim = SC.createSim(SC.build(st, ENV), B.makeBodies); for (let f = 0; f < 120; f++) sim.step(); return sim; };
    const a = run(), b = run();
    let same = a.numParticles === b.numParticles;
    for (let i = 0; same && i < 2 * a.numParticles; i++) if (a.particlePos[i] !== b.particlePos[i]) same = false;
    const ba = a.solids.filter(s => !s.kinematic), bb = b.solids.filter(s => !s.kinematic);
    for (let k = 0; same && k < ba.length; k++) if (ba[k].x !== bb[k].x || ba[k].y !== bb[k].y || ba[k].a !== bb[k].a) same = false;
    check('same seed, same particles and bodies after 120 frames', same, `${a.numParticles} particles, ${ba.length} bodies`);
  }

  // default preset
  {
    const spec = SC.build(SC.defaultState(), ENV);
    const sim = SC.createSim(spec);
    for (let f = 0; f < 200; f++) sim.step();
    const s = sim.stats();
    check('default harbour scene runs (gate lifts, water moves)', !s.nan && !s.out && spec.gate && s.maxSpeed > 0.5, `${s.n} particles, max speed ${s.maxSpeed.toFixed(2)} m/s`);
  }

  // bodies in still water: buoyancy, sinking, displacement
  {
    const pool = (objects, frames = 600) => {
      const st = SC.defaultState(); st.seed = 'still-1';
      const spec = SC.build(st, { budget: 6000, minRes: 30 });
      const W = spec.W, H = spec.H;
      spec.water = [{ kind: 'rect', x0: 0, y0: 0, x1: W, y1: 0.4 * H }];
      spec.statics = []; spec.gate = null; spec.paddle = null; spec.emitters = []; spec.drains = []; spec.wind = 0;
      spec.gx = 0; spec.gy = -9.81; spec.damping = 0.05;
      spec.objects = objects(W, H);
      const sim = SC.createSim(spec, B.makeBodies);
      const bodies = sim.solids.filter(s => !s.kinematic);
      const wet = bodies.map(() => 0);
      for (let f = 0; f < frames; f++) { sim.step(); if (f >= frames - 150) bodies.forEach((b, k) => { wet[k] += b.wet / 150; }); }
      return { sim, bodies, wet, W, H };
    };
    const level = (sim) => {
      // mean top particle height in two side columns (away from the body)
      const P = sim.particlePos, h = sim.h, xs = [0.08, 0.92].map(f => f * sim.fNumX * h), top = [0, 0];
      for (let i = 0; i < sim.numParticles; i++) for (let k = 0; k < 2; k++) if (Math.abs(P[2 * i] - xs[k]) < 2 * h) top[k] = Math.max(top[k], P[2 * i + 1]);
      return (top[0] + top[1]) / 2;
    };
    const one = (kind, density, size = 1) => (W, H) => [{ kind, x: W / 2, y: 0.4 * H + 0.15, a: 0, size, density, colour: 0, look: 1 }];
    const f5 = pool(one('box', 0.5));
    check('a crate of density 0.5 settles about half submerged', Math.abs(f5.wet[0] - 0.5) < 0.08, `wet fraction ${f5.wet[0].toFixed(3)}`);
    const f25 = pool(one('box', 0.25)), f8 = pool(one('box', 0.8));
    check('the wet fraction follows the density (0.25, 0.8)', Math.abs(f25.wet[0] - 0.25) < 0.08 && Math.abs(f8.wet[0] - 0.8) < 0.08, `${f25.wet[0].toFixed(3)}, ${f8.wet[0].toFixed(3)}`);
    const rk = pool(one('rock', 2.6));
    const rb = rk.bodies[0];
    check('a rock (density 2.6) sinks to the floor', rb.y < 0.12 * rk.H && Math.abs(rb.vy) < 0.2, `y ${rb.y.toFixed(3)} m of H ${rk.H.toFixed(2)} m`);
    const capsized = pool((W, H) => [{ kind: 'boat', x: W / 2, y: 0.4 * H + 0.12, a: 3.0, size: 1, density: 0.35, colour: 0, look: 1 }], 700);
    const ca = Math.atan2(Math.sin(capsized.bodies[0].a), Math.cos(capsized.bodies[0].a));
    check('a capsized boat rights itself (keel ballast)', Math.abs(ca) < 0.2, `start 3.0 rad, end ${ca.toFixed(3)} rad`);
    // displacement: a large neutral-density raft of planks raises the level
    const none = pool(() => []), big = pool((W, H) => [0, 1, 2].map(k => ({ kind: 'box', x: (0.3 + 0.2 * k) * W, y: 0.4 * H + 0.2, a: 0, size: 1.13, density: 0.8, colour: 0, look: 1 })));
    const rise = level(big.sim) - level(none.sim);
    const displaced = big.bodies.reduce((s, b, k) => s + b.area * big.wet[k], 0);
    const expect = displaced / (big.W - 2 * big.sim.h);
    check('floating bodies raise the water level by their displaced area', Math.abs(rise - expect) < Math.max(0.35 * expect, 1.2 * big.sim.particleRadius), `rise ${(rise * 100).toFixed(2)} cm, expected ${(expect * 100).toFixed(2)} cm`);
  }

  // tools: palette, grab and throw, eraser (DOM stubs, no browser)
  {
    const el = () => { const e = { children: [], classList: { toggle() {}, add() {}, remove() {} }, style: {}, dataset: {}, setAttribute() {}, appendChild(c) { this.children.push(c); return c; }, querySelectorAll() { return this.children; }, getContext: () => null, textContent: '' }; return e; };
    const els = {};
    globalThis.document = globalThis.document || { createElement: () => el() };
    globalThis.matchMedia = globalThis.matchMedia || (() => ({ matches: false }));
    globalThis.window = globalThis.window || { devicePixelRatio: 1 };
    const $ = (id) => (els[id] = els[id] || el());
    const { installTools } = await import('./tools.js');
    const st = SC.defaultState(); st.seed = 'tools-1';
    const spec = SC.build(st, ENV); spec.objects = [];
    const app = { spec, sim: SC.createSim(spec, B.makeBodies), canvas: el() };
    const T = installTools(app, $);
    let r = 3; T.rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    const n0 = app.sim.solids.filter(s => !s.kinematic).length;
    app.objects.dropRandom(3);
    const dyn = () => app.sim.solids.filter(s => !s.kinematic);
    const b = dyn()[n0];
    const grabbed = app.tools.down({ x: b.x, y: b.y });
    app.tools.move({ x: b.x + 0.4, y: b.y + 0.3 });
    for (let f = 0; f < 20; f++) app.sim.step();
    const moved = Math.hypot(b.x - (b.grab ? b.grab.x : 0), b.y - (b.grab ? b.grab.y : 0));
    app.tools.up();
    const speed = Math.hypot(b.vx, b.vy);
    T.erase = true; app.tools.down({ x: b.x, y: b.y }); T.erase = false;
    const left = dyn().length;
    app.objects.clearObjects();
    check('tools: drop 3, grab and drag (spring follows), release keeps speed, eraser and clear', dyn().length === 0 && left === n0 + 2 && grabbed && moved < 0.25 && speed > 0.05,
      `dropped ${n0 + 3 - n0}, grab gap ${moved.toFixed(3)} m, release speed ${speed.toFixed(2)} m/s`);
  }

  // looks: every view, scheme and background draws with finite numbers
  {
    const R = await import('./render.js'), LK = await import('./looks.js');
    let bad = 0, calls = 0, water = 0;
    const mkCtx = (w, h) => {
      const c = { canvas: { width: w, height: h } };
      const num = (...a) => { calls++; for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) bad++; };
      for (const k of ['fillRect', 'moveTo', 'lineTo', 'arc', 'ellipse', 'bezierCurveTo', 'strokeRect', 'drawImage', 'setTransform', 'transform', 'translate']) c[k] = num;
      for (const k of ['beginPath', 'closePath', 'fill', 'stroke', 'save', 'restore', 'clip']) c[k] = () => {};
      c.createLinearGradient = (...a) => { num(...a); return { addColorStop() {} }; };
      c.createImageData = (iw, ih) => ({ width: iw, height: ih, data: new Uint8ClampedArray(iw * ih * 4) });
      c.putImageData = (img) => { let a = 0; for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) a++; water = Math.max(water, a / (img.data.length / 4)); };
      return c;
    };
    const st = SC.defaultState(); st.seed = 'look-1';
    const spec = SC.build(st, ENV);
    const sim = SC.createSim(spec, B.makeBodies);
    for (let f = 0; f < 60; f++) sim.step();
    const ctx = mkCtx(800, 500);
    const r = R.createRenderer(ctx, { makeCanvas: (w, h) => ({ width: w, height: h, getContext: () => mkCtx(w, h) }) });
    const view = R.fitView(spec.W, spec.H, 800, 500);
    let n = 0;
    for (const v of Object.keys(LK.VIEWS)) for (const w of Object.keys(LK.SCHEMES)) for (const bg of Object.keys(LK.BACKGROUNDS)) { r.draw(sim, view, { colours: { view: v, water: w, bg } }); n++; }
    let rr = 5; const rnd = () => { rr = (rr * 16807) % 2147483647; return rr / 2147483647; };
    const a = JSON.stringify(LK.randomLook(rnd)); rr = 5; const b = JSON.stringify(LK.randomLook(rnd));
    check('looks: every view x scheme x background draws finite; random looks are seeded', bad === 0 && water > 0.05 && a === b, `${n} looks, ${calls} draw calls, water cover ${(water * 100).toFixed(0)} % of the texel image`);
  }

  // saver: every shot builds and runs; plates have TeX and no code; the
  // water scheme never repeats back to back; the zoom stays finite
  {
    const { makeShots } = await import('./saver.js');
    const app = { state: SC.defaultState(), sim: null, spec: null, zoom: null };
    app.loadState = (st) => { app.state = st; app.spec = SC.build(st, { budget: 2400, minRes: 30 }); app.sim = SC.createSim(app.spec, B.makeBodies); };
    app.objects = {
      clearObjects() { for (const b of app.sim.solids.slice()) if (!b.kinematic) app.sim.removeSolid(b); },
      dropAt(kind, x, y, extra = {}) { return B.spawn(app.sim, app.spec, Object.assign({ kind, x, y, a: 0, size: 1, density: B.KINDS[kind].density, colour: 0, look: 1 }, extra)); },
    };
    const S = makeShots(app);
    let r = 11; const rng = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    const bad = [], waters = [];
    let repeats = 0, plates = 0, maxK = 1;
    for (let k = 0; k < 21; k++) {
      const shot = S.SHOTS[k % S.SHOTS.length];
      shot.run({ rng, calm: 0.7, w: 800, h: 500 });
      const w = app.state.colours.view && app.state.colours.view !== 'surface' && app.state.colours.view !== 'particles' ? 'field:' + app.state.colours.map : app.state.colours.water;
      if (waters.length && waters[waters.length - 1] === app.state.colours.water) repeats++;
      waters.push(app.state.colours.water);
      for (let f = 0; f < 90; f++) { app.sim.step(); S.tick(1 / 60); }
      const s = app.sim.stats();
      if (s.nan || s.out) bad.push(`${shot.key}: ${s.nan} NaN, ${s.out} out`);
      if (app.zoom) { if (!(Number.isFinite(app.zoom.x) && Number.isFinite(app.zoom.y) && Number.isFinite(app.zoom.k))) bad.push(shot.key + ': zoom not finite'); maxK = Math.max(maxK, app.zoom.k); }
      if (shot.label.tex && shot.label.tex.length && !shot.label.code && shot.label.title && shot.label.sub) plates++;
    }
    check('saver: 7 shots x 3 run finite, TeX plates without code, no water scheme twice in a row, close-ups zoom in',
      bad.length === 0 && repeats === 0 && plates === 21 && S.SHOTS.length >= 7 && maxK > 1.5,
      `${bad.join('; ') || 'ok'} · ${new Set(waters).size} schemes · zoom up to ${maxK.toFixed(2)}x`);
  }

  // sweep
  {
    const n = quick ? 20 : 200;
    const t0 = Date.now();
    const res = await sweepSeeds(n);
    const bad = res.filter(r => r.bad.length);
    for (const r of bad.slice(0, 8)) console.log(`  seed test${r.i} (${r.kind}): ${r.bad.join('; ')}`);
    const kinds = {};
    for (const r of res) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    const lo = Math.min(...res.map(r => r.minRatio)), hi = Math.max(...res.map(r => r.maxRatio));
    check(`${n} random seeds x ${FRAMES} frames: no NaN, no escape, count balance, area ratio`, bad.length === 0,
      `${bad.length} bad · area ratio ${lo.toFixed(2)}..${hi.toFixed(2)} · ${JSON.stringify(kinds)} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }

  // main.js link check
  {
    let msg = 'ok';
    try { await import('./main.js'); }
    catch (e) { msg = `${e.name}: ${e.message}`; }
    check('main.js links in node (no SyntaxError)', !/SyntaxError/.test(msg), msg.slice(0, 90));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

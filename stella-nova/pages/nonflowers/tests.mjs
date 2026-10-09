// ============================================================================
//  NONFLOWERS  ·  tests.mjs — node tests of the DOM-free modules
// ----------------------------------------------------------------------------
//  Run from the repo root:   node stella-nova/pages/nonflowers/tests.mjs
//  Each test prints "ok" or "FAIL" with a reason. The exit code is the
//  number of failures. upstream/main.js is read as text, as the worker
//  does. Node has no canvas, so the engine draws on engine.js
//  recorderCanvas(): it hashes each draw call. The random stream does not
//  read pixels, so the calls, the plant type and PAR are the same as in a
//  browser. The pixel parity with the upstream page is a headless Chrome
//  check (see the commit body), not a node test.
//
//  STEPS. The record.js tests compare the recorded strokes with the canvas
//  calls of a plain paint() (no tap) on an exact recorder: each call with
//  its full-precision numbers and strings, per canvas.
//
//  GREP MAP
//    grep -n "test('"   one line per test
//    grep -n 'STEPS'    the step recorder and stepper tests
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { UPSTREAM, makeEngine, paint, plainPAR, hsvToRgb, recorderCanvas, seedToken, cleanSeed, randomSeed, flowerFocus, inkFocus } from './engine.js';
import { layoutGrid, fitScale, parseSeedFrom, pngWithText, crc32 } from './view.js';
import { recordPaint, drawStroke, chapters, createStepper, timeline, totalMs, SPEEDS, STAGES, KINDS } from './record.js';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const SRC = fs.readFileSync(path.join(DIR, 'upstream/main.js'), 'utf8');
let fails = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`); }
function ok(c, msg) { if (!c) throw new Error(msg); }
const env = log => ({ canvas: () => recorderCanvas(log) });
function run(seed) {
  const log = { h: 2166136261, n: 0 };
  const r = paint(SRC, seed, env(log));
  return { type: r.type, calls: log.n, hash: log.h, par: JSON.stringify(plainPAR(r.PAR)), r };
}

// ── one raster path ─────────────────────────────────────────────────────────
test('every engine 2D context asks for willReadFrequently (CPU raster, one result per seed)', () => {
  const asks = [];
  const log = { h: 2166136261, n: 0 };
  const canvas = () => { const c = recorderCanvas(log), g = c.getContext; c.getContext = (t, o) => { asks.push([t, o && o.willReadFrequently]); return g(t, o); }; return c; };
  paint(SRC, '1', { canvas });
  ok(asks.length > 3, 'too few getContext calls: ' + asks.length);
  ok(asks.every(([t, w]) => t === '2d' && w === true), 'a 2D context without willReadFrequently: ' + JSON.stringify(asks.find(([, w]) => w !== true)));
});

// ── upstream file ───────────────────────────────────────────────────────────
test('upstream/main.js is the pinned copy (sha256)', () => {
  eq(createHash('sha256').update(fs.readFileSync(path.join(DIR, 'upstream/main.js'))).digest('hex'), UPSTREAM.sha256, 'sha256');
});
test('the licence file is the upstream MIT text with the copyright line', () => {
  const t = fs.readFileSync(path.join(DIR, 'LICENSE-nonflowers.txt'), 'utf8');
  ok(t.startsWith('MIT License'), 'MIT header');
  ok(t.includes('Copyright (c) 2018 Lingdong Huang'), 'copyright line');
});
test('without the Object shim a second run of the raw source throws', () => {
  // The first run in this realm may already have made the getters.
  const stub = new Proxy(function () {}, { get: (t, k) => (k === 'innerHTML' ? '' : stub), set: () => true, apply: () => stub });
  const raw = () => new Function('window', 'document', 'Math', 'console', SRC + ';return 1')(
    { btoa, location: { href: 'x?seed=1' } }, { createElement: () => recorderCanvas({ h: 0, n: 0 }), getElementById: () => stub }, Object.create(Math), { log() {} });
  try { raw(); } catch (e) { /* first run in this realm: may pass */ }
  let threw = false;
  try { raw(); } catch (e) { threw = /redefine/i.test(String(e)); }
  ok(threw, 'the second raw run did not throw "Cannot redefine property"');
  for (const k of ['SEED', 'CTX', 'v3', 'context', 'PAPER_COL0', 'PAPER_COL1', 'vtxlist0', 'vtxlist1', 'vtxlist']) delete globalThis[k];
});

// ── the shim ────────────────────────────────────────────────────────────────
test('no global leaks, Math.random and Object.defineProperty stay as they were', () => {
  const before = new Set(Object.getOwnPropertyNames(globalThis));
  const r0 = Math.random, d0 = Object.defineProperty;
  run('leak-check');
  const leaked = Object.getOwnPropertyNames(globalThis).filter(k => !before.has(k));
  eq(leaked.join(','), '', 'leaked globals');
  ok(Math.random === r0, 'Math.random changed');
  ok(Object.defineProperty === d0, 'Object.defineProperty changed');
  ok(!('oldRandom' in Math) && !('seed' in Math), 'Math got upstream fields');
});
test('same seed gives the same draw calls, type and PAR (three seeds, two engines)', () => {
  for (const s of ['1', 'hello', 'Gongbi 7']) {
    const a = run(s), b = run(s);
    ok(a.calls > 10000, s + ' made only ' + a.calls + ' calls');
    eq(a.hash, b.hash, s + ' draw-call hash'); eq(a.calls, b.calls, s + ' call count');
    eq(a.type, b.type, s + ' type'); eq(a.par, b.par, s + ' PAR');
  }
});
test('different seeds give different plants', () => {
  const h = new Set(['1', '2', '3', '4', '5'].map(s => run(s).hash));
  eq(h.size, 5, 'distinct hashes');
});
test('plant types match the headless Chrome parity run (1 herbal, 2 woody, hello herbal)', () => {
  eq(run('1').type, 'herbal', 'seed 1'); eq(run('2').type, 'woody', 'seed 2'); eq(run('hello').type, 'herbal', 'seed hello');
});
test('both plant types come up over 10 seeds', () => {
  const t = new Set(); for (let i = 0; i < 10; i++) t.add(run('mix' + i).type);
  ok(t.has('woody') && t.has('herbal'), [...t].join(','));
});
test('the engine sees the seed token as upstream SEED', () => {
  const E = makeEngine(SRC, 'a b', env({ h: 0, n: 0 }));
  eq(E.getSEED(), 'a%20b', 'SEED');
  ok(Number.isFinite(E.Prng.s) && E.Prng.s > 1, 'Prng state');
});

test('paint() records the two plant blits and puts Layer.blit back', () => {
  const r = run('blits').r;
  eq(r.blits.map(b => b.ble).join(','), 'multiply,normal', 'blend order');
  ok(!/blits\.push/.test(String(r.E.Layer.blit)), 'Layer.blit is the upstream function again');
  eq(flowerFocus(r.blits), null, 'the recorder canvas has no pixels: no focus');
});
test('flowerFocus finds a synthetic petal patch', () => {
  const W = 200, data = new Uint8ClampedArray(W * W * 4);
  for (let y = 120; y < 160; y++) for (let x = 30; x < 70; x++) data[(y * W + x) * 4 + 3] = 255;
  const ctx = { canvas: { width: W, height: W }, getImageData: () => ({ data }) };
  const f = flowerFocus([{ ble: 'multiply' }, { ble: 'normal', ctx, xof: 100, yof: 200 }]);
  ok(f && Math.abs(f.x - 150) <= 40 && Math.abs(f.y - 340) <= 40, 'focus near (150, 340): ' + JSON.stringify(f));
  ok(f.ink > 0.99, 'all ink in the window');
  // avoid: a second patch far from the first is found instead.
  for (let y = 20; y < 50; y++) for (let x = 150; x < 190; x++) data[(y * W + x) * 4 + 3] = 128;
  const g = inkFocus([{ ble: 'normal', ctx, xof: 100, yof: 200 }], 'normal', { avoid: { x: f.x, y: f.y, d: 150 } });
  ok(g && Math.hypot(g.x - f.x, g.y - f.y) >= 150 && Math.abs(g.x - 270) <= 40 && Math.abs(g.y - 235) <= 40, 'second patch: ' + JSON.stringify(g));
});

// ── PAR ─────────────────────────────────────────────────────────────────────
test('PAR as plain data: 33 fields, finite numbers, 100-point curves, colours in range', () => {
  for (const s of ['1', '2', 'hello', 'Gongbi 7']) {
    const p = JSON.parse(run(s).par), keys = Object.keys(p);
    eq(keys.length, 33, s + ' field count');
    ok(keys[0] === 'flowerChance', 'upstream order');
    for (const k of keys) {
      const { kind, value } = p[k];
      if (kind === 'number') ok(Number.isFinite(value), `${s} ${k} not finite`);
      else if (kind === 'curve') { eq(value.length, 100, k + ' points'); ok(value.every(Number.isFinite), k + ' NaN'); }
      else if (kind === 'colour') for (const e of [value.min, value.max]) {
        eq(e.length, 4, k + ' hsva');
        ok(e[0] >= 0 && e[0] < 360 && e[1] >= 0 && e[1] <= 1.3 && e[2] >= 0 && e[2] <= 1 && e[3] >= 0 && e[3] <= 1, `${s} ${k} out of range ${e}`);
      } else if (kind === 'list') ok(value.every(Number.isFinite), k + ' list');
      else throw new Error(`${s} ${k}: kind ${kind}`);
    }
    for (const k of ['flowerShape', 'leafShape', 'flowerOpenCurve', 'flowerColorCurve', 'innerShape']) eq(p[k].kind, 'curve', k);
    for (const k of ['flowerColor', 'leafColor', 'innerColor', 'branchColor']) eq(p[k].kind, 'colour', k);
  }
});
test('hsvToRgb equals the upstream hsv() string', () => {
  const E = makeEngine(SRC, 'hsv', env({ h: 0, n: 0 }));
  for (let i = 0; i < 400; i++) {
    const h = (i * 37.3) % 360, s = (i % 11) / 10, v = (i % 7) / 6;
    eq('rgba(' + hsvToRgb(h, s, v).join(',') + ',1.000)', E.hsv(h, s, v, 1), `hsv ${h} ${s} ${v}`);
  }
});

// ── seeds ───────────────────────────────────────────────────────────────────
test('seed token, trim and cut; a long token overflows upstream Prng.hash', () => {
  eq(seedToken(' hello '), 'hello', 'trim'); eq(seedToken('a&b=c'), 'a%26b%3Dc', 'encode');
  eq(cleanSeed('x'.repeat(100)).length, 48, 'cut');
  let threw = false; try { makeEngine(SRC, '  ', env({ h: 0, n: 0 })); } catch (e) { threw = true; } ok(threw, 'empty seed');
  // Why the cut: an untrimmed 140-character token gives Prng.s = NaN upstream.
  const E = makeEngine(SRC, 'ok', env({ h: 0, n: 0 }));
  ok(!Number.isFinite(E.Prng.hash('y'.repeat(140))), 'a long token should overflow');
  const t = seedToken('%'.repeat(48));
  ok(t.length <= 96 && Number.isFinite(E.Prng.hash(t)), 'the token of 48 x % is cut and stays finite: ' + t.length);
  eq(cleanSeed('\u{1F33C}'.repeat(40)).length % 2, 0, 'no broken surrogate pair');
  const r = () => 0.5; eq(randomSeed(r), '5500000000', 'randomSeed');
});

// ── view.js helpers ─────────────────────────────────────────────────────────
test('seed from ?seed= or #seed=, decoded', () => {
  eq(parseSeedFrom('?seed=hello%20world', ''), 'hello world', 'search');
  eq(parseSeedFrom('', '#seed=42'), '42', 'hash');
  eq(parseSeedFrom('?x=1', '#nothing'), null, 'none');
  eq(parseSeedFrom('?seed=%E0%A4%A', ''), '%E0%A4%A', 'bad escape kept raw');
});
test('fitScale keeps the painting crisp: whole multiples or 1/n', () => {
  eq(fitScale(600, 600, 1, 1300, 1300), 2, 'room for 2x');
  eq(fitScale(600, 600, 1, 700, 900), 1, '1x');
  eq(fitScale(600, 600, 2, 350, 350), 0.5, 'dpr 2: 300 css px is 600 device px');
  ok(fitScale(600, 600, 1, 350, 330) <= 0.55, 'small box');
});
test('herbarium grid fits n cells in a box', () => {
  for (const [w, h, n] of [[1200, 800, 12], [390, 600, 8], [800, 400, 6]]) {
    const g = layoutGrid(w, h, n);
    ok(g.cols * g.rows >= n, 'cells'); ok(g.cell * g.cols + g.gap * (g.cols - 1) <= w, `fits ${w}x${h}`); ok(g.cell > 100, "cell size");
  }
});
test('PNG tEXt chunks: CRC32 and a valid chunk after IHDR', () => {
  eq(crc32(new TextEncoder().encode('IEND')).toString(16), 'ae426082', 'IEND crc');
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
  const out = pngWithText(png, { Author: 'Lingdong Huang', Title: 'Nonflowers' });
  eq(String.fromCharCode(...out.slice(37, 41)), 'tEXt', 'chunk type after IHDR');
  const len = (out[33] << 24 | out[34] << 16 | out[35] << 8 | out[36]) >>> 0;
  eq(new TextDecoder().decode(out.slice(41, 41 + len)), 'Author\0Lingdong Huang', 'first chunk text: Author first');
  const crc = (out[41 + len] << 24 | out[42 + len] << 16 | out[43 + len] << 8 | out[44 + len]) >>> 0;
  eq(crc, crc32(out.slice(37, 41 + len)), 'chunk crc');
});

// ── STEPS: record.js ────────────────────────────────────────────────────────
// An exact recorder: a list of call strings per canvas, numbers at full
// precision. Getters return the canvas; any other property is a call.
function exactCanvas(all) {
  const c = { width: 300, height: 150, calls: [] };
  all.push(c);
  const ctx = new Proxy({ canvas: c }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'getImageData') return (x, y, w, h) => { c.calls.push('gid'); return { data: new Uint8ClampedArray(0), width: w, height: h }; };
      return function () { c.calls.push(String(k) + '(' + Array.prototype.map.call(arguments, a => (typeof a === 'number' ? String(a) : typeof a === 'string' ? a : '#')).join(',') + ')'); };
    },
    set(t, k, v) { t[k] = v; c.calls.push('set ' + String(k) + '=' + (typeof v === 'string' || typeof v === 'number' ? v : '#')); return true; },
  });
  c.getContext = () => ctx;
  return c;
}
// The draw calls of one layer before the first pixel read (the filters).
const drawPrefix = c => { const i = c.calls.indexOf('gid'); return i < 0 ? c.calls : c.calls.slice(0, i); };
const STEP_SEEDS = ['1', '2', '3', '77', 'hello', 'Gongbi 7', 'x9'];
const recCache = new Map();
function recorded(seed) {
  if (!recCache.has(seed)) recCache.set(seed, recordPaint(SRC, seed, { canvas: () => recorderCanvas({ h: 0, n: 0 }) }));
  return recCache.get(seed);
}
test('STEPS: the recorded strokes replay to the same layer draw calls as a plain paint (7 seeds)', () => {
  const types = new Set();
  for (const seed of STEP_SEEDS) {
    const all = [], r = paint(SRC, seed, { canvas: () => exactCanvas(all) });
    const lay = [r.blits[0].ctx.canvas, r.blits[1].ctx.canvas];
    const { rec } = recorded(seed);
    types.add(rec.type);
    eq(rec.type, r.type, seed + ' type');
    ok(rec.n > 1000, seed + ' strokes ' + rec.n);
    for (const L of [0, 1]) {
      const out = [], c = exactCanvas(out), g = c.getContext('2d');
      // In playback order: the order between the layers changes, the order in one layer does not.
      for (let j = 0; j < rec.n; j++) { const i = rec.order[j]; if (rec.layer[i] === L) drawStroke(g, rec, i); }
      const want = drawPrefix(lay[L]), got = c.calls;
      eq(got.length, want.length, `${seed} layer ${L} call count`);
      for (let k = 0; k < want.length; k++) if (got[k] !== want[k]) throw new Error(`${seed} layer ${L} call ${k}: ${got[k]} !== ${want[k]}`);
    }
  }
  ok(types.has('woody') && types.has('herbal'), 'both plant types: ' + [...types]);
});
test('STEPS: the tap does not change the painting (draw-call hash with and without it)', () => {
  for (const seed of ['1', '2', 'x9']) {
    const log = { h: 2166136261, n: 0 };
    recordPaint(SRC, seed, { canvas: () => recorderCanvas(log) });
    const plain = run(seed);
    // recordPaint also copies two snapshots (sheet, plant): drawImage calls on
    // their own canvases. Compare the painting canvas only.
    const a = [], b = [];
    paint(SRC, seed, { canvas: () => exactCanvas(a) });
    recordPaint(SRC, seed, { canvas: () => exactCanvas(b) });
    const main = list => list.find(c => c.width === 600 && c.calls.some(s => s.startsWith('set globalCompositeOperation')));
    eq(main(b).calls.join('|'), main(a).calls.join('|'), seed + ' painting calls');
    ok(plain.calls > 0, 'plain run');
  }
});
test('STEPS: every stroke has a kind, and the stages come in the documented order', () => {
  const woodyRe = /^paper (trunk )?(branch )?(foliage )?(flower )?shade mount$/;
  const herbalRe = /^paper (stem (leaf )?(sheath )?(shoot )?(flower )?)+(basal )?shade mount$/;
  for (const seed of STEP_SEEDS) {
    const { rec } = recorded(seed), ch = chapters(rec);
    eq(rec.kind.filter(k => KINDS[k] === 'other').length, 0, seed + ' strokes of no kind');
    const seq = ch.map(c => c.key).join(' ');
    ok((rec.type === 'woody' ? woodyRe : herbalRe).test(seq), `${seed} ${rec.type}: ${seq}`);
    // The chapters cover the playback order once, without a gap.
    let at = 0;
    for (const c of ch) { eq(c.from, at, seed + ' chapter start ' + c.key); at = c.to; ok(STAGES[c.key], 'stage text ' + c.key); }
    eq(at, rec.n, seed + ' chapters end at n');
  }
});
test('STEPS: the stepper keeps a consistent state on stage steps, seeks and speed changes', () => {
  for (const seed of ['1', '2']) {
    const ch = chapters(recorded(seed).rec), S = createStepper(ch);
    let a = S.at();
    eq(a.ci, 0, 'start in paper'); eq(a.strokes, 0, 'no strokes at 0');
    const seen = [0];
    for (let i = 1; i < ch.length; i++) { a = S.next(); seen.push(a.ci); eq(a.strokes, ch[a.ci].from, `${seed} next ${i} strokes`); }
    eq(seen.join(','), ch.map((_, i) => i).join(','), seed + ' next visits every stage');
    a = S.next(); ok(a.done, 'next at the last stage ends'); eq(a.strokes, recorded(seed).rec.n, 'all strokes at the end');
    for (let i = ch.length - 1; i >= 0; i--) { a = S.prev(); eq(a.ci, i, `${seed} prev to ${i}`); eq(a.u, 0, 'prev lands on a stage start'); }
    a = S.prev(); eq(a.ci, 0, 'prev at 0 stays');
    // Forward then back returns to the same place.
    S.goto(3); const t3 = S.t; S.next(); S.prev(); eq(S.t, t3, 'next then prev');
    // Strokes never go down as the clock goes up.
    let last = -1;
    for (let t = 0; t <= S.total; t += S.total / 500) { const s = S.seek(t).strokes; ok(s >= last, 'monotone strokes at ' + t); last = s; }
    // timeOfStrokes is the inverse of at().strokes within one step.
    for (const n of [0, 5, 500, ch[ch.length - 3].to - 1]) { const st = S.seek(S.timeOfStrokes(n)).strokes; ok(Math.abs(st - n) <= 1, `timeOfStrokes ${n} -> ${st}`); }
    // A speed change keeps the stage and the share of it.
    S.goto(4); S.seek(S.t + S.chapters[4].dur * 0.5);
    const before = S.at();
    S.setSpeed(4);
    const after = S.at();
    eq(after.ci, before.ci, 'speed keeps the stage'); ok(Math.abs(after.u - before.u) < 1e-9, 'speed keeps the share');
    S.setSpeed(1);
  }
});
test('STEPS: the replay ends in the expected time at each speed', () => {
  const ch = chapters(recorded('77').rec);
  const T1 = totalMs(timeline(ch, 1));
  ok(T1 > 8000 && T1 < 60000, 'speed 1 total ' + T1);
  for (const v of SPEEDS) {
    const S = createStepper(ch, v);
    ok(Math.abs(S.total - T1 / v) < 1e-6, `total at ${v}x`);
    S.play();
    let t = 0;
    const dt = 1000 / 60;
    while (S.playing && t < T1 * 8) { S.advance(dt); t += dt; }
    ok(S.at().done && !S.playing, `done at ${v}x`);
    ok(Math.abs(t - T1 / v) <= dt + 1e-6, `${v}x ended at ${t.toFixed(0)} ms, want ${(T1 / v).toFixed(0)} ms`);
  }
});

for (const [name, fn] of tests) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { fails++; console.log('FAIL ' + name + '\n     ' + (e && e.message)); }
}
console.log(`${tests.length - fails}/${tests.length} passed`);
process.exit(fails);

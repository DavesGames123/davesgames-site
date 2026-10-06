// ============================================================================
//  FISHDRAW  ·  tests.mjs — node tests of the DOM-free modules
// ----------------------------------------------------------------------------
//  Run from the repo root:   node stella-nova/pages/fishdraw/tests.mjs
//  Each test prints "ok" or "FAIL" with a reason. The exit code is the
//  number of failures. fishdraw.js is read as text, as the worker does.
//
//  GREP MAP
//    grep -n "test('"   one line per test
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { layoutPlate, pageSize, PAGES, GRID_PRESETS, cellAt, MM_PER_PX } from './plate.js';
import { makeEngine, drawFish, baseParams, PARAMS, GROUPS, sanitize, mutate, mulberry, diffParams,
  encodeShare, decodeShare, randomName, relativeName, flatten, unflatten, blendParams, upstreamCSV } from './engine.js';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const SRC = fs.readFileSync(path.join(DIR, 'fishdraw.js'), 'utf8');
let fails = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`); }
function ok(c, msg) { if (!c) throw new Error(msg); }
const sameLines = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── engine ──────────────────────────────────────────────────────────────────
test('upstream file is the pinned copy (sha256)', async () => {
  const { createHash } = await import('node:crypto');
  eq(createHash('sha256').update(fs.readFileSync(path.join(DIR, 'fishdraw.js'))).digest('hex'),
    'eedd3cfd816e78374bca3a62f30d900b1faacddfb5f49f49f04284a39285f1e0', 'sha256');
});
test('same seed gives identical polylines (two engines, three names)', () => {
  for (const name of ['Biggus fishus', 'Xipola nare', 'Colus splennita']) {
    const a = drawFish(makeEngine(SRC), name).polylines;
    const E = makeEngine(SRC);
    drawFish(E, 'Warm up the engine');
    const b = drawFish(E, name).polylines;
    ok(a.length > 50, name + ' has polylines');
    ok(sameLines(a, b), name + ' differs between engines');
  }
});
test('drawFish equals the upstream main() of a fresh engine', () => {
  for (const name of ['Biggus fishus', 'Tautes hyptigbota']) {
    const up = makeEngine(SRC).main(name);
    const ours = drawFish(makeEngine(SRC), name).polylines;
    ok(sameLines(up, ours), name + ': drawFish differs from main()');
  }
});
test('every generate_params field is in PARAMS and back', () => {
  const E = makeEngine(SRC);
  const keys = Object.keys(E.default_params()).sort();
  eq(PARAMS.map(d => d.key).sort().join(), keys.join(), 'keys');
  for (const d of PARAMS) ok(GROUPS.some(g => g.id === d.group), d.key + ' group');
});
test('sanitize keeps 300 generated param sets unchanged', () => {
  const E = makeEngine(SRC);
  for (let i = 1; i <= 300; i++) {
    const p = baseParams(E, randomName(E, i * 7919));
    const s = sanitize(p);
    for (const d of PARAMS) eq(s[d.key], p[d.key], `seed ${i} ${d.key}`);
  }
});
test('passing the base params gives the same drawing as none', () => {
  const E = makeEngine(SRC);
  const a = drawFish(E, 'Setilus odemus');
  const b = drawFish(E, 'Setilus odemus', a.base);
  ok(sameLines(a.polylines, b.polylines), 'base params changed the drawing');
});
test('one edited field changes the drawing, the name keeps the noise', () => {
  const E = makeEngine(SRC);
  const a = drawFish(E, 'Setilus odemus');
  const b = drawFish(E, 'Setilus odemus', { tail_type: (a.base.tail_type + 2) % 6 });
  ok(!sameLines(a.polylines, b.polylines), 'edit did nothing');
  const c = drawFish(E, 'Setilus odemus', { tail_type: (a.base.tail_type + 2) % 6 });
  ok(sameLines(b.polylines, c.polylines), 'edited fish is not repeatable');
});
test('params round-trip through the share link', () => {
  const E = makeEngine(SRC), rnd = mulberry(42);
  for (let i = 0; i < 40; i++) {
    const name = randomName(E, 1000 + i);
    const base = baseParams(E, name);
    const p = mutate(base, 0.3 + (i % 5) * 0.15, rnd);
    const hash = '#' + encodeShare({ f: name, p: diffParams(p, base), m: 'single', t: 'cream' });
    const back = decodeShare(hash);
    eq(back.f, name, 'name');
    eq(back.m, 'single', 'mode');
    const q = sanitize(Object.assign({}, base, back.p));
    for (const d of PARAMS) eq(q[d.key], p[d.key], `${name} ${d.key}`);
  }
});
test('a typed name with spaces and accents survives the link', () => {
  const back = decodeShare('#' + encodeShare({ f: 'Biggus fishus & co., é', p: {} }));
  eq(back.f, 'Biggus fishus & co., é', 'name');
});
test('mutate at spread 1 never breaks the engine (24 fish)', () => {
  const E = makeEngine(SRC), rnd = mulberry(7);
  for (let i = 0; i < 24; i++) {
    const name = randomName(E, 50 + i);
    const p = mutate(baseParams(E, name), 1, rnd);
    const f = drawFish(E, name, p);
    ok(f.polylines.length > 20, name + ' drew too few lines');
  }
});
test('the extreme corners of every slider draw', () => {
  const E = makeEngine(SRC);
  for (const end of ['min', 'max']) {
    const p = {};
    for (const d of PARAMS) p[d.key] = d[end];
    const f = drawFish(E, 'Extremus ' + end, p);
    ok(f.polylines.length > 20, end + ' corner drew too few lines');
  }
});
test('mutate keeps locked fields and stays in range', () => {
  const E = makeEngine(SRC), rnd = mulberry(3);
  const base = baseParams(E, 'Xipola nare');
  const locked = new Set(['tail_type', 'body_length', 'eye_size']);
  for (let i = 0; i < 50; i++) {
    const p = mutate(base, 0.6, rnd, locked);
    for (const k of locked) eq(p[k], base[k], 'locked ' + k);
    for (const d of PARAMS) if (d.kind !== 'float') ok(p[d.key] >= d.min && p[d.key] <= d.max, d.key + ' out of range');
  }
});
test('relatives keep the genus; blend ends match its inputs', () => {
  const E = makeEngine(SRC);
  const r = relativeName(E, 'Colus splennita', 99);
  ok(r.startsWith('Colus '), r);
  const a = baseParams(E, 'Colus splennita'), b = baseParams(E, 'Xipola nare');
  for (const d of PARAMS) { eq(blendParams(a, b, 0)[d.key], sanitize(a)[d.key], 'blend 0 ' + d.key); eq(blendParams(a, b, 1)[d.key], sanitize(b)[d.key], 'blend 1 ' + d.key); }
});
test('flatten and unflatten are exact; csv matches the upstream format', () => {
  const pl = drawFish(makeEngine(SRC), 'Myna nafasburons').polylines;
  const f = flatten(pl);
  ok(sameLines(unflatten(f), pl), 'round trip');
  eq(f.offs.length, pl.length + 1, 'offs');
  eq(upstreamCSV(pl).split('\n').length, pl.length, 'csv lines');
  ok(f.total > 1000 && f.bbox.w > 100, 'length and bbox');
});

// ── plate layout ────────────────────────────────────────────────────────────
const overlap = (a, b) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
function layouts() {
  const out = [];
  const grids = [[1, 1], [2, 2], [3, 3], [3, 4], [4, 6], [5, 8], [5, 3], [10, 12], [1, 12], [10, 1]];
  for (const key of Object.keys(PAGES)) for (const orient of ['portrait', 'landscape'])
    for (const [rows, cols] of grids) for (const flags of [0, 1, 2, 3, 7]) {
      const sz = pageSize(key, orient, { w: 1280 * MM_PER_PX, h: 760 * MM_PER_PX });
      out.push({ desc: `${key} ${orient} ${rows}x${cols} f${flags}`, L: layoutPlate({ w: sz.w, h: sz.h, rows, cols, border: !!(flags & 1), title: !!(flags & 2), labels: !!(flags & 4), screen: key === 'screen', names: [] }) });
    }
  return out;
}
test('grid layout: no two cells overlap, for every page and grid', () => {
  for (const { desc, L } of layouts()) {
    for (let i = 0; i < L.cells.length; i++) for (let j = i + 1; j < L.cells.length; j++)
      ok(!overlap(L.cells[i], L.cells[j]), desc + `: cells ${i} and ${j} overlap`);
  }
});
test('grid layout: fish boxes and labels stay inside their cell and the page', () => {
  for (const { desc, L } of layouts()) {
    for (const c of L.cells) {
      ok(c.fx >= c.x - 1e-6 && c.fy >= c.y - 1e-6 && c.fx + c.fw <= c.x + c.w + 1e-6 && c.fy + c.fh <= c.y + c.h + 1e-6, desc + ' fish box out of cell ' + c.i);
      ok(Math.abs(c.fw / c.fh - 5 / 3) < 1e-6, desc + ' fish box is not 5:3');
      ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= L.w + 1e-6 && c.y + c.h <= L.h + 1e-6, desc + ' cell off the page');
      if (c.ls) ok(c.ly <= c.y + c.h + 1e-6, desc + ' label below the cell ' + c.i);
    }
    for (const t of L.texts) if (t.role === 'title' || t.role === 'sub') ok(t.y <= L.content.y, desc + ' title runs into the cells');
    for (const r of L.rules) for (const c of L.cells) ok(c.x > r.x && c.y > r.y && c.x + c.w < r.x + r.w && c.y + c.h < r.y + r.h, desc + ' cell crosses the border');
  }
});
test('grid layout: cellAt finds the centre of every cell', () => {
  const L = layoutPlate({ w: 420, h: 297, rows: 4, cols: 6, border: true, title: true, labels: true, names: [] });
  for (const c of L.cells) eq(cellAt(L, c.x + c.w / 2, c.y + c.h / 2), c.i, 'cellAt');
  eq(cellAt(L, 1, 1), -1, 'margin');
  ok(GRID_PRESETS.every(p => p.rows * p.cols >= 4), 'presets');
});

for (const [name, fn] of tests) {
  try { await fn(); console.log('ok   ', name); }
  catch (e) { fails++; console.log('FAIL ', name, '\n      ', e.message); }
}
console.log(`${tests.length - fails}/${tests.length} passed`);
process.exit(fails);

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
import { plateSVG, platePolylines } from './svg.js';
import { buildTree, layoutTree, tipBoxes, drift, lineage, paramChanges, TIP_CAP, T_MAX } from './tree.js';
import { THEMES } from './plate.js';
import { layoutPlate, pageSize, PAGES, GRID_PRESETS, cellAt, MM_PER_PX } from './plate.js';
import { PART_ORDER, partsOf } from './engine.js';
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
// ── draw-on order ───────────────────────────────────────────────────────────
// An engine with no wrappers at all: the upstream file and a plain return.
const rawEngine = () => new Function(SRC + '\n;return {main};')();
test('the part tags leave the drawing identical to an unwrapped upstream engine', () => {
  for (const name of ['Biggus fishus', 'Colus splennita', 'Tautes hyptigbota', 'Xipola nare']) {
    const up = rawEngine().main(name), ours = drawFish(makeEngine(SRC), name).polylines;
    ok(sameLines(up, ours), name + ' differs from the unwrapped upstream main()');
  }
});
test('the draw-on order is a permutation of the upstream polylines (same set)', () => {
  const E = makeEngine(SRC), rnd = mulberry(9);
  for (let i = 0; i < 6; i++) {
    const name = randomName(E, 300 + i);
    const f = drawFish(E, name, i % 2 ? mutate(baseParams(E, name), 0.5, rnd) : null, i % 3 !== 0);
    eq(f.order.length, f.polylines.length, 'order length');
    eq(new Set(f.order).size, f.polylines.length, 'order repeats an index');
    const key = pl => JSON.stringify(pl);
    const a = f.polylines.map(key).sort(), b = f.order.map(k => key(f.polylines[k])).sort();
    eq(JSON.stringify(a), JSON.stringify(b), name + ': reordered set differs');
  }
});
test('the draw-on order starts with the body outline and the head', () => {
  const E = makeEngine(SRC);
  for (const name of ['Biggus fishus', 'Colus splennita', 'Xipola nare']) {
    const f = drawFish(E, name), seq = f.order.map(k => f.parts[k]);
    ok(seq[0] === 'body', name + ' does not start with the body: ' + seq[0]);
    const rank = p => PART_ORDER.indexOf(p);
    for (let i = 1; i < seq.length; i++) ok(rank(seq[i]) >= rank(seq[i - 1]), name + ' order goes back at ' + i);
    for (const p of ['body', 'head', 'eye', 'fins', 'scales', 'name']) ok(f.parts.includes(p), name + ' has no ' + p);
    eq(seq[seq.length - 1], 'name', name + ' does not end with the name');
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

// ── SVG ─────────────────────────────────────────────────────────────────────
// A small XML well-formedness check: one root, every tag closed in order,
// quoted attributes with no raw < or &, no raw < or & in text.
function wellFormed(xml) {
  let s = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  const stack = [];
  let i = 0, roots = 0;
  const badAmp = /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const text = lt < 0 ? s.slice(i) : s.slice(i, lt);
    if (badAmp.test(text)) throw new Error('raw & in text near ' + text.slice(0, 40));
    if (text.trim() && !stack.length) throw new Error('text outside the root');
    if (lt < 0) break;
    const gt = s.indexOf('>', lt);
    if (gt < 0) throw new Error('unclosed tag');
    const tag = s.slice(lt + 1, gt);
    if (tag.startsWith('/')) {
      const nm = tag.slice(1).trim();
      if (stack.pop() !== nm) throw new Error('mismatched </' + nm + '>');
    } else {
      const self = tag.endsWith('/');
      const m = tag.replace(/\/$/, '').match(/^([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*$/);
      if (!m) throw new Error('bad tag <' + tag.slice(0, 60) + '>');
      if (badAmp.test(m[2])) throw new Error('raw & in attribute of <' + m[1] + '>');
      if (!stack.length) roots++;
      if (!self) stack.push(m[1]);
    }
    i = gt + 1;
  }
  if (stack.length) throw new Error('unclosed ' + stack.join(','));
  if (roots !== 1) throw new Error('roots ' + roots);
  return true;
}
function plateFixture(rows, cols, names) {
  const E = makeEngine(SRC);
  const fishes = names.map(n => { const f = drawFish(E, n, null, false); return { ...flatten(f.polylines), seed: f.seed, name: n }; });
  const L = layoutPlate({ w: 297, h: 210, rows, cols, border: true, title: true, labels: true, titleText: 'Tom & Jerry <fish> "plate"', subText: "it's & <i>", names });
  return { L, fishes };
}
test('the plate SVG is well formed, with hostile names escaped', () => {
  const names = ['Biggus fishus', 'A & B <c>', 'Quote "q" fish', "Apos 'a' fish"];
  const { L, fishes } = plateFixture(2, 2, names);
  for (const theme of Object.values(THEMES)) for (const jitter of [0, 0.6]) {
    const svg = plateSVG(L, fishes, { theme, pen: 0.3, jitter, title: 'A & B' });
    ok(wellFormed(svg), 'not well formed');
    ok(svg.includes('width="297mm"') && svg.includes('viewBox="0 0 297 210"'), 'mm units');
    eq((svg.match(/<path data-cell=/g) || []).length, 4, 'one path per fish');
  }
});
test('every plate SVG credits Lingdong Huang, with and without a title block', () => {
  const E = makeEngine(SRC), f = drawFish(E, 'Biggus fishus', null, false);
  const fish = { ...flatten(f.polylines), seed: f.seed, name: f.name };
  for (const title of [true, false]) {
    const L = layoutPlate({ w: 297, h: 210, rows: 1, cols: 1, border: title, title, labels: false, names: [] });
    const svg = plateSVG(L, [fish], { theme: THEMES.cream, pen: 0.3 });
    ok(wellFormed(svg), 'not well formed');
    ok(/<desc>[^<]*Lingdong Huang[^<]*github\.com\/LingDong-\/fishdraw/.test(svg), 'desc credit');
    ok(/<text[^>]*>Fish by fishdraw, created by Lingdong Huang \(MIT\)/.test(svg), 'visible credit line, title ' + title);
    eq((svg.match(/created by Lingdong Huang \(MIT\) ·/g) || []).length, 1, 'one credit line');
  }
});
test('the licence file is the upstream MIT text', () => {
  const t = fs.readFileSync(path.join(DIR, 'LICENSE-fishdraw.txt'), 'utf8');
  ok(t.startsWith('MIT License\n\nCopyright (c) 2021 Lingdong Huang\n'), 'copyright line');
  ok(t.includes('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND'), 'warranty text');
});
test('the checker itself rejects broken SVG', () => {
  for (const bad of ['<svg><g></svg>', '<svg>a & b</svg>', '<svg x=1></svg>', '<svg></svg><svg></svg>', '<svg><text>x</tex></svg>']) {
    let threw = false; try { wellFormed(bad); } catch (e) { threw = true; }
    ok(threw, 'accepted: ' + bad);
  }
});
test('plate polylines stay in their cells, in mm', () => {
  const { L, fishes } = plateFixture(1, 2, ['Xipola nare', 'Colus splennita']);
  const lines = platePolylines(L, fishes, 0);
  eq(lines.length, fishes.reduce((a, f) => a + f.offs.length - 1, 0), 'line count');
  for (const pl of lines) for (const [x, y] of pl) ok(x >= 0 && y >= 0 && x <= L.w && y <= L.h, 'point off the plate');
});

// ── tree of life ────────────────────────────────────────────────────────────
function treeOf(seed, extra = {}) {
  const E = makeEngine(SRC), name = 'Colus splennita';
  return buildTree(Object.assign({ E, rootName: name, rootParams: baseParams(E, name), seed, maxTips: 24 }, extra));
}
const treeKey = t => JSON.stringify(t.nodes.map(n => [n.parent, n.kind, +n.t.toFixed(9), n.name, PARAMS.map(d => n.params[d.key])]));
test('tree: the same seed gives the same tree, names and fish', () => {
  for (const seed of [1, 7, 99]) {
    const a = treeOf(seed), b = treeOf(seed);
    eq(treeKey(a), treeKey(b), 'tree ' + seed);
    const tip = a.nodes[a.tips[a.tips.length - 1]];
    const fa = drawFish(makeEngine(SRC), tip.name, tip.params, false).polylines;
    const fb = drawFish(makeEngine(SRC), tip.name, tip.params, false).polylines;
    ok(sameLines(fa, fb), 'tip fish ' + seed);
  }
  ok(treeKey(treeOf(1)) !== treeKey(treeOf(2)), 'seeds 1 and 2 give the same tree');
});
test('tree: shape rules (root, first split, tips at T, cap, living tips)', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const t = treeOf(seed, { maxTips: 4 + (seed % 5) * 12 });
    eq(t.nodes[0].kind, 'root', 'root');
    for (const n of t.nodes) {
      if (n.parent >= 0) ok(n.t >= t.nodes[n.parent].t, 'child before parent');
      if (n.kind === 'tip') eq(n.t, T_MAX, 'tip time');
      if (n.kind === 'split') ok(n.children.length === 2, 'split with two children');
    }
    const alive = t.nodes.filter(n => n.kind === 'tip').length;
    ok(alive <= Math.min(TIP_CAP, t.opts.maxTips), `seed ${seed}: ${alive} tips over the cap`);
    ok(alive >= Math.min(3, t.opts.maxTips), `seed ${seed}: only ${alive} living tips`);
    eq(new Set(t.nodes.map(n => n.name)).size, t.nodes.length, 'names are unique');
  }
});
test('tree: drift and mutate keep every param in its valid range', () => {
  const rnd = mulberry(5);
  const check = (p, why) => {
    for (const d of PARAMS) {
      const v = p[d.key];
      ok(Number.isFinite(v), why + ' ' + d.key + ' not finite');
      if (d.kind === 'float') ok(v >= d.min - 1e-9 && v <= d.max + 1e-9, `${why} ${d.key}=${v}`);
      else { ok(Number.isInteger(v) && v >= d.min && v <= d.max, `${why} ${d.key}=${v}`); }
    }
  };
  for (let seed = 1; seed <= 12; seed++) for (const n of treeOf(seed, { mut: 3 }).nodes) check(n.params, 'tree node');
  const E = makeEngine(SRC);
  let p = baseParams(E, 'Xipola nare');
  for (let i = 0; i < 400; i++) { p = drift(p, 60, 3, rnd); check(p, 'drift'); }
  for (let i = 0; i < 200; i++) check(mutate(p, 1, rnd), 'mutate');
});
test('tree: every tip fish draws, no NaN in any polyline', () => {
  const t = treeOf(11, { maxTips: 14, mut: 2 }), E = makeEngine(SRC);
  for (const id of t.tips) {
    const n = t.nodes[id], f = drawFish(E, n.name, n.params, false);
    ok(f.polylines.length > 20, n.name + ' drew too few lines');
    for (const pl of f.polylines) for (const pt of pl) ok(Number.isFinite(pt[0]) && Number.isFinite(pt[1]), n.name + ' has NaN');
  }
});
test('tree layout: no two tip slots overlap (3 layouts, 4 sizes, up to 64 tips)', () => {
  const sizes = [[300, 200], [120, 260], [400, 120], [90, 90]];
  for (const seed of [2, 3, 6]) for (const maxTips of [3, 24, 64]) {
    const t = treeOf(seed, { maxTips, spec: maxTips > 30 ? 2.5 : 1 });
    for (const kind of ['clado', 'radial', 'fan']) for (const [w, h] of sizes) for (const xMode of ['time', 'change']) {
      const L = layoutTree(t, kind, { w, h, ox: 10, oy: 5, xMode });
      const B = tipBoxes(t, L);
      for (const b of B) ok([b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0, 'bad box');
      for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++)
        ok(!overlap(B[i], B[j]), `${kind} ${w}x${h} ${maxTips} tips: slots ${i} and ${j} overlap`);
    }
  }
});
test('tree natural layout: tips keep their size and never overlap (3 layouts, up to 64 tips)', () => {
  for (const seed of [2, 3, 6, 11]) for (const maxTips of [3, 10, 24, 64]) {
    const t = treeOf(seed, { maxTips, spec: maxTips > 30 ? 2.5 : 1 });
    for (const kind of ['clado', 'radial', 'fan']) {
      const L = layoutTree(t, kind, { tip: 40, ox: 7, oy: 3 });
      ok(L.natural && L.w > 0 && L.h > 0, 'natural size');
      const B = tipBoxes(t, L);
      for (const b of B) {
        const living = t.nodes[b.id].kind === 'tip';
        ok(Math.abs(b.w - (living ? 40 : 34)) < 1e-9, `${kind}: tip box width ${b.w}`);
        ok(b.x >= 7 - 1e-6 && b.y >= 3 - 1e-6 && b.x + b.w <= 7 + L.w + 1e-6 && b.y + b.h <= 3 + L.h + 1e-6, `${kind} ${maxTips}: tip box outside the layout`);
      }
      for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++)
        ok(!overlap(B[i], B[j]), `${kind} ${maxTips} tips: natural slots ${i} and ${j} overlap`);
      for (const q of t.nodes) if (q.children.length) ok(Math.abs(L.fish[q.id].w - 28) < 1e-9, 'ancestor fish is 0.7 of a tip');
    }
  }
});
test('tree: lineage runs root to node; param changes list real changes', () => {
  const t = treeOf(4), tip = t.tips[0], L = lineage(t, tip);
  eq(L[0], 0, 'starts at root'); eq(L[L.length - 1], tip, 'ends at tip');
  for (let i = 1; i < L.length; i++) eq(t.nodes[L[i]].parent, L[i - 1], 'parent chain');
  const ch = paramChanges(t.nodes[0].params, t.nodes[tip].params);
  for (const c of ch) ok(t.nodes[0].params[c.key] !== t.nodes[tip].params[c.key], 'listed a field that did not change');
});

// node tests.mjs <text> runs only the tests whose name holds <text>.
const only = process.argv[2] || '';
for (const [name, fn] of tests) {
  if (only && !name.includes(only)) continue;
  const t0 = Date.now();
  try { await fn(); console.log('ok   ', name, `(${Date.now() - t0} ms)`); }
  catch (e) { fails++; console.log('FAIL ', name, '\n      ', e.message); }
}
const ran = tests.filter(([n]) => !only || n.includes(only)).length;
console.log(`${ran - fails}/${ran} passed`);
process.exit(fails);

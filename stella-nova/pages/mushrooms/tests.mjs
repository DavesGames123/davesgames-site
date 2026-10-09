// ============================================================================
//  MUSHROOM DRAW  ·  tests.mjs — node tests of the DOM-free modules
// ----------------------------------------------------------------------------
//  Run from the repo root:   node stella-nova/pages/mushrooms/tests.mjs
//  Each test prints "ok" or "FAIL" with a reason. The exit code is the
//  number of failures.
//
//  GREP MAP
//    grep -n "test('"   one line per test
// ============================================================================
import { buildSpecimen, formParams, randomParams, FORMS, FORM_KEYS, PARAMS, DEFAULTS, sanitize, mutate, blendParams,
  diffParams, randomName, encodeShare, decodeShare, PROFILES } from './engine.js';
import { hideLines, mulberry, rdp, brushPoly, pointInPoly } from './geom.js';
import { layoutPlate, fitSpec, pngSize, scaleBar, THEMES, STYLE_KEYS, cellAt } from './plate.js';
import { plateSVG } from './svg.js';
import { CODE, extract } from './saver.js';
import fs from 'node:fs';
import { buildTree, layoutTree, tipBoxes, drift, drawParams, lineage, paramChanges, cladeName, TIP_CAP, T_MAX, ASPECT, ANC } from './tree.js';

let fails = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function ok(c, msg) { if (!c) throw new Error(msg); }
const finite = s => { for (const v of s.xy) if (!Number.isFinite(v)) return false; for (const w of s.washes) for (const v of w.xy) if (!Number.isFinite(v)) return false; return Number.isFinite(s.total) && Number.isFinite(s.bbox.w) && Number.isFinite(s.bbox.h); };
const same = (a, b) => a.xy.length === b.xy.length && a.xy.every((v, i) => v === b.xy[i]) && a.offs.every((v, i) => v === b.offs[i]);

// ── engine ──────────────────────────────────────────────────────────────────
test('same params and seed give identical polylines', () => {
  for (const f of ['fly', 'bolete', 'morel', 'random']) {
    const p = formParams(f, 42);
    const a = buildSpecimen(p, 777);
    buildSpecimen(formParams('parasol', 1), 5);
    const b = buildSpecimen(p, 777);
    ok(same(a, b), f + ' differs between runs');
    ok(a.washes.length === b.washes.length, f + ' washes differ');
  }
});
test('a new seed gives a new drawing and a new name', () => {
  const p = formParams('fly', 1), a = buildSpecimen(p, 1), b = buildSpecimen(p, 2);
  ok(!same(a, b), 'seed 1 and 2 are the same');
  ok(a.name !== b.name, 'same name');
});
test('every form builds, with no NaN and a sane line count', () => {
  for (const f of [...FORM_KEYS, 'random']) for (const seed of [1, 99, 4242]) {
    const t0 = performance.now(), s = buildSpecimen(formParams(f, seed), seed), ms = performance.now() - t0;
    ok(finite(s), `${f}/${seed} has a NaN`);
    ok(s.stats.lines >= 60 && s.stats.lines <= 20000, `${f}/${seed} has ${s.stats.lines} lines`);
    ok(s.bbox.w > 10 && s.bbox.h > 10, `${f}/${seed} bbox ${s.bbox.w} x ${s.bbox.h}`);
    ok(ms < 8000, `${f}/${seed} took ${ms.toFixed(0)} ms (a guard against a runaway build; the usual time is under 150 ms)`);
    ok(s.offs[s.offs.length - 1] * 2 === s.xy.length, 'offs end');
    ok(s.order.length === s.offs.length - 1 && s.kinds.length === s.order.length, 'order and kinds length');
  }
});
test('each form has its signature parts', () => {
  const pp = f => buildSpecimen(formParams(f, 3), 3).stats.perPart;
  ok(pp('fly').marks > 5, 'fly agaric warts');
  ok(pp('fly').ring > 0 && pp('fly').volva > 0, 'fly agaric ring and volva');
  ok(pp('bolete').under > 50, 'bolete pores (seen from below)');
  ok(pp('chanterelle').under > 10, 'chanterelle ridges');
  ok(pp('inkcap').marks > 20, 'ink cap scales');
  ok(pp('morel').cap > 100, 'morel net');
  ok(pp('puffball').marks > 20, 'puffball granules');
  ok(buildSpecimen(formParams('bonnet', 3), 3).stats.bodies === 6, 'bonnet cluster of six');
});
test('30 random species and the extreme params build with no NaN', () => {
  for (let i = 0; i < 30; i++) { const s = buildSpecimen(randomParams(1000 + i), i); ok(finite(s), 'random ' + i); ok(s.stats.lines > 20, 'random ' + i + ' lines ' + s.stats.lines); }
  const lo = {}, hi = {};
  for (const d of PARAMS) { lo[d.key] = d.min; hi[d.key] = d.max; }
  for (const prof of [0, 3, 6, 8, 9]) for (const P of [lo, hi]) {
    const s = buildSpecimen(Object.assign({}, P, { profile: prof, count: 2 }), 9);
    ok(finite(s), `extreme ${PROFILES[prof]} has a NaN`);
  }
  for (const elev of [-0.45, -0.01, 0, 0.45]) ok(finite(buildSpecimen(Object.assign(formParams('fly', 1), { elev }), 3)), 'elev ' + elev);
  ok(finite(buildSpecimen({ capR: NaN, age: 'x', count: 99 }, 1)), 'junk params');
});
test('the age slider changes the cap from button to upturned', () => {
  const p = formParams('fly', 1);
  const h = age => { const s = buildSpecimen(Object.assign({}, p, { age, count: 1, ground: 0, litter: 0, grass: 0, moss: 0 }), 5); return s.bbox; };
  const y = h(0.05), o = h(0.95);
  ok(y.w < o.w * 0.8, `a young cap is narrower (${y.w.toFixed(0)} vs ${o.w.toFixed(0)})`);
});
test('sanitize clamps and rounds; mutate keeps locked fields', () => {
  const s = sanitize({ capR: 9999, gills: 12.7, profile: -3, elev: 2 });
  ok(s.capR === 120 && s.gills === 13 && s.profile === 0 && s.elev === 0.45, JSON.stringify(s).slice(0, 80));
  const base = formParams('parasol', 1), m = mutate(base, 0.9, mulberry(3), new Set(['capR', 'profile']));
  ok(m.capR === base.capR && m.profile === base.profile, 'locked field moved');
  ok(Object.keys(diffParams(m, base)).length > 0, 'mutate changed nothing');
  const bl = blendParams(Object.assign({}, base, { capHue: 350 }), Object.assign({}, base, { capHue: 10 }), 0.5);
  ok(bl.capHue < 1 || bl.capHue > 359, 'hue blends the short way round: ' + bl.capHue);
});
test('names are seeded binomials', () => {
  ok(randomName(5) === randomName(5), 'not deterministic');
  const set = new Set();
  for (let i = 0; i < 200; i++) { const n = randomName(i); ok(/^[A-Z][a-z]+ [a-z]+$/.test(n), 'bad name ' + n); set.add(n); }
  ok(set.size > 190, 'too many repeats: ' + set.size);
});
test('share link round trip', () => {
  const st = { f: 'fly', s: 1234, p: { capR: 81, age: 0.31, bogus: 3 }, m: 'single', t: 'cream' };
  const q = decodeShare('#' + encodeShare(st));
  ok(q.f === 'fly' && +q.s === 1234 && q.p.capR === 81 && q.p.age === 0.31 && !('bogus' in q.p) && q.t === 'cream', JSON.stringify(q));
});

// ── clipper ─────────────────────────────────────────────────────────────────
test('hideLines removes the part of a line inside a later fill', () => {
  const sq = [[4, -2], [6, -2], [6, 2], [4, 2]];
  const out = hideLines([{ pts: [[0, 0], [10, 0]], ord: 0 }], [{ poly: sq, ord: 1 }], 0.5, 0.01);
  ok(out.length === 2, 'two pieces, got ' + out.length);
  const a = out[0].pts, b = out[1].pts;
  ok(Math.abs(a[a.length - 1][0] - 4) < 0.01 && Math.abs(b[0][0] - 6) < 0.01, `cut at ${a[a.length - 1][0]} and ${b[0][0]}`);
  const inside = hideLines([{ pts: [[4.5, 0], [5.5, 0]], ord: 0 }], [{ poly: sq, ord: 1 }]);
  ok(inside.length === 0, 'a segment inside a later fill stays');
  const earlier = hideLines([{ pts: [[0, 0], [10, 0]], ord: 2 }], [{ poly: sq, ord: 1 }]);
  ok(earlier.length === 1 && earlier[0].pts.length === 2, 'an earlier fill hid a later line');
});
test('no visible line runs inside a fill drawn after it', () => {
  for (const [f, elev] of [['fly', 0.14], ['bolete', -0.3], ['bonnet', 0.1], ['parasol', 0]]) {
    const s = buildSpecimen(Object.assign(formParams(f, 2), { count: 4, elev }), 11, { debug: true });
    const { occs, vis } = s.debug;
    ok(occs.length > 8, f + ' occluders ' + occs.length);
    let bad = 0, n = 0;
    for (const l of vis) for (let i = 1; i < l.pts.length; i++) {
      const mx = (l.pts[i][0] + l.pts[i - 1][0]) / 2, my = (l.pts[i][1] + l.pts[i - 1][1]) / 2;
      n++;
      for (const o of occs) if (o.ord > l.ord && mx > o.bb.x0 && mx < o.bb.x1 && my > o.bb.y0 && my < o.bb.y1 && pointInPoly(o.poly, mx, my)) { bad++; break; }
    }
    ok(bad <= n * 0.002, `${f}: ${bad} of ${n} segment midpoints inside a later fill`);
  }
});
test('rdp and brushPoly', () => {
  const line = []; for (let i = 0; i <= 100; i++) line.push([i, 0.001 * Math.sin(i)]);
  ok(rdp(line, 0.01).length === 2, 'rdp keeps a straight line as two points');
  const xy = new Float64Array([0, 0, 5, 1, 10, 0, 15, 2]);
  const p = brushPoly(xy, 0, 4, 1, 3);
  ok(p && p.length === 16 && [...p].every(Number.isFinite), 'brush polygon');
});

// ── plate and SVG ───────────────────────────────────────────────────────────
function wellFormed(svg) {
  const body = svg.replace(/^<\?xml[^>]*\?>\s*/, '');
  const stack = [], re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/g;
  let m, pos = 0;
  while ((m = re.exec(body))) {
    if (m.index !== pos) return 'stray markup at ' + pos + ': ' + body.slice(pos, pos + 40);
    pos = re.lastIndex;
    if (m[5] !== undefined) { if (/&(?!(amp|lt|gt|quot|apos);)/.test(m[5])) return 'bare & in text'; continue; }
    if (m[1]) { if (stack.pop() !== m[2]) return 'unbalanced </' + m[2] + '>'; }
    else if (!m[4]) stack.push(m[2]);
  }
  if (pos !== body.length) return 'trailing markup';
  return stack.length ? 'unclosed ' + stack.join(',') : '';
}
test('plate SVG is well-formed in every style, in mm', () => {
  const specs = ['fly', 'morel', 'chanterelle', 'random'].map((f, i) => buildSpecimen(formParams(f, i), i + 1));
  const L = layoutPlate({ w: 297, h: 210, rows: 2, cols: 2, border: true, title: true, labels: true, titleText: 'A & B <test>', names: specs.map(s => s.name) });
  for (const style of STYLE_KEYS) {
    const svg = plateSVG(L, specs, { theme: THEMES.cream, style, pen: 0.3, jitter: style === 'brush' ? 0.4 : 0, scale: true, title: 'x"y' });
    const err = wellFormed(svg);
    ok(!err, style + ': ' + err);
    ok(svg.includes('width="297mm"') && svg.includes('viewBox="0 0 297 210"'), style + ': mm size');
    ok(!/NaN|undefined/.test(svg), style + ': NaN in SVG');
  }
});
test('layout cells, fit and the PNG clamp', () => {
  const L = layoutPlate({ w: 300, h: 200, rows: 3, cols: 4, labels: true, names: [] });
  ok(L.cells.length === 12, 'cells');
  ok(cellAt(L, L.cells[5].x + 1, L.cells[5].y + 1) === 5, 'cellAt');
  const s = buildSpecimen(formParams('parasol', 1), 1), c = L.cells[0], f = fitSpec(s, c);
  const x0 = f.ox + s.bbox.x * f.k, x1 = f.ox + (s.bbox.x + s.bbox.w) * f.k, y0 = f.oy + s.bbox.y * f.k, y1 = f.oy + (s.bbox.y + s.bbox.h) * f.k;
  ok(x0 >= c.ax - 1e-6 && x1 <= c.ax + c.aw + 1e-6 && y0 >= c.ay - 1e-6 && y1 <= c.ay + c.ah + 1e-6, 'the specimen fits its art box');
  const z = pngSize({ w: 420, h: 297 }, 600);
  ok(z.clamped && z.w * z.h <= 16777216 && z.w <= 4096 * 2, 'A3 at 600 dpi is clamped: ' + JSON.stringify(z));
  ok(!pngSize({ w: 100, h: 100 }, 96).clamped, 'small plate not clamped');
  ok(['1 mm', '2 mm', '5 mm', '1 cm', '2 cm', '5 cm', '10 cm', '20 cm'].includes(scaleBar(0.5, 10).text), 'scale bar text');
});
test('every form key has a label and only known params', () => {
  for (const k of FORM_KEYS) {
    ok(FORMS[k].label, k + ' label');
    for (const key of Object.keys(FORMS[k].p)) ok(key in DEFAULTS, k + ' has unknown ' + key);
  }
});

// From above, the front rim is the cap silhouette; the contour does not
// draw it, so the rim crease must (before the fix the cap was open there).
test('a camera above the cap draws the front rim', () => {
  const capI = 0;
  for (const f of ['bolete', 'chanterelle', 'bonnet', 'fly']) {
    const p = Object.assign(formParams(f, 11), { elev: 0.42, count: 1 });
    const s = buildSpecimen(p, 11);
    const w = s.washes.find(q => q.part === capI || q.part === 'cap');
    ok(w, f + ': no cap wash');
    let bx = 0, by = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (let i = 0; i < w.xy.length; i += 2) { if (w.xy[i + 1] > by) { by = w.xy[i + 1]; bx = w.xy[i]; } x0 = Math.min(x0, w.xy[i]); x1 = Math.max(x1, w.xy[i]); }
    const tol = (x1 - x0) * 0.03;
    let hit = false;
    for (let i = 0; i + 1 < s.offs.length && !hit; i++) {
      if (s.part[i] !== capI || s.kinds[i] !== 0) continue;
      for (let k = s.offs[i]; k < s.offs[i + 1]; k++) if (Math.hypot(s.xy[k * 2] - bx, s.xy[k * 2 + 1] - by) < tol) { hit = true; break; }
    }
    ok(hit, f + ': no outline at the lowest point of the cap silhouette');
  }
});
test('every saver code extract resolves in the shipped source', () => {
  const src = { engine: fs.readFileSync(new URL('./engine.js', import.meta.url), 'utf8'), geom: fs.readFileSync(new URL('./geom.js', import.meta.url), 'utf8') };
  for (const [key, [fn, from, file]] of Object.entries(CODE)) {
    const t = extract(src[file], fn, from, 7);
    ok(t && t.split('\n').length >= 4, `${key}: ${file}.js ${fn}() from "${from}" gave ${t ? t.split('\n').length : 0} lines`);
    if (from !== 'start') ok(t.split('\n')[0].includes(from), `${key}: extract does not start at "${from}"`);
  }
});

// ── tree of life ────────────────────────────────────────────────────────────
const treeOf = (seed, extra = {}) => buildTree(Object.assign({ rootParams: formParams('fly', 1), rootSeed: 77, seed, maxTips: 24 }, extra));
const treeKey = t => JSON.stringify(t.nodes.map(n => [n.parent, n.kind, +n.t.toFixed(9), n.name, n.seed, PARAMS.map(d => n.params[d.key])]));
const overlap = (a, b) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
test('tree: the same seed gives the same tree, names and mushrooms', () => {
  for (const seed of [1, 7, 99]) {
    const a = treeOf(seed), b = treeOf(seed);
    ok(treeKey(a) === treeKey(b), 'tree ' + seed);
    const tip = a.nodes[a.tips[a.tips.length - 1]];
    ok(same(buildSpecimen(drawParams(tip.params), tip.seed), buildSpecimen(drawParams(tip.params), tip.seed)), 'tip mushroom ' + seed);
  }
  ok(treeKey(treeOf(1)) !== treeKey(treeOf(2)), 'seeds 1 and 2 give the same tree');
});
test('tree: shape rules (root, splits, living tips at T, cap, names from seeds)', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const t = treeOf(seed, { maxTips: 4 + (seed % 5) * 12 });
    ok(t.nodes[0].kind === 'root' && t.nodes[0].children.length === 1, 'root with one child');
    ok(t.nodes[0].name === randomName(77), 'the root is the specimen name');
    for (const n of t.nodes) {
      if (n.parent >= 0) ok(n.t >= t.nodes[n.parent].t, 'child before parent');
      if (n.kind === 'tip') ok(n.t === T_MAX, 'tip time');
      if (n.kind === 'split') ok(n.children.length === 2, 'split with two children');
      ok(n.name === randomName(n.seed), 'name comes from the seed');
      if (n.founder !== n.id) ok(n.genus === t.nodes[n.parent].genus, 'a non-founder keeps the genus');
    }
    const alive = t.nodes.filter(n => n.kind === 'tip').length;
    ok(alive <= Math.min(TIP_CAP, t.opts.maxTips), `seed ${seed}: ${alive} tips over the cap`);
    ok(alive >= Math.min(3, t.opts.maxTips), `seed ${seed}: only ${alive} living tips`);
    ok(new Set(t.nodes.map(n => n.name)).size === t.nodes.length, 'names are unique');
  }
  ok(cladeName('Amanita') === 'Amanitaceae' && cladeName('Boletus') === 'Boletaceae' && cladeName('Agaromyces') === 'Agaromycetaceae', 'family names');
});
test('tree: params stay in range under drift; habitat and camera do not drift', () => {
  const check = (p, why) => {
    for (const d of PARAMS) {
      const v = p[d.key];
      ok(Number.isFinite(v), why + ' ' + d.key + ' not finite');
      ok(v >= d.min - 1e-9 && v <= d.max + 1e-9, `${why} ${d.key}=${v}`);
      if (d.kind !== 'float') ok(Number.isInteger(v), `${why} ${d.key}=${v} not an integer`);
    }
    if (p.profile >= 8) ok(p.under === 4, why + ': a morel or puffball with a gilled underside');
  };
  for (let seed = 1; seed <= 12; seed++) for (const n of treeOf(seed, { mut: 3 }).nodes) check(n.params, 'tree node');
  const rnd = mulberry(5);
  let p = formParams('bolete', 1);
  for (let i = 0; i < 400; i++) {
    const q = drift(p, 60, 3, rnd); check(q, 'drift');
    for (const k of ['ground', 'moss', 'grass', 'litter', 'elev']) ok(q[k] === p[k], k + ' drifted');
    p = q;
  }
  ok(paramChanges(formParams('bolete', 1), p).length > 10, 'drift changes many fields');
});
test('tree: every tip and ancestor draws, no NaN', () => {
  const t = treeOf(11, { maxTips: 14, mut: 2 });
  for (const n of t.nodes) {
    const f = buildSpecimen(drawParams(n.params), n.seed);
    ok(finite(f), n.name + ' has NaN');
    ok(f.offs.length - 1 > 20, n.name + ' drew too few lines');
  }
});
test('tree layout: no two tip boxes overlap (3 layouts, 4 sizes, up to 64 tips)', () => {
  const sizes = [[300, 200], [120, 260], [400, 120], [90, 90]];
  for (const seed of [2, 3, 6]) for (const maxTips of [3, 24, 64]) {
    const t = treeOf(seed, { maxTips, spec: maxTips > 30 ? 2.5 : 1 });
    for (const kind of ['clado', 'radial', 'fan']) for (const [w, h] of sizes) for (const xMode of ['time', 'change']) {
      const B = tipBoxes(t, layoutTree(t, kind, { w, h, ox: 10, oy: 5, xMode }));
      for (const b of B) ok([b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0, 'bad box');
      for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++)
        ok(!overlap(B[i], B[j]), `${kind} ${w}x${h} ${maxTips} tips: boxes ${i} and ${j} overlap`);
    }
  }
});
test('tree natural layout: tips keep their size, stay inside, never overlap (3 layouts)', () => {
  for (const seed of [2, 3, 6, 11]) for (const maxTips of [3, 10, 24, 64]) {
    const t = treeOf(seed, { maxTips, spec: maxTips > 30 ? 2.5 : 1 });
    for (const kind of ['clado', 'radial', 'fan']) {
      const L = layoutTree(t, kind, { tip: 40, ox: 7, oy: 3 });
      ok(L.natural && L.w > 0 && L.h > 0, 'natural size');
      const B = tipBoxes(t, L);
      for (const b of B) {
        const living = t.nodes[b.id].kind === 'tip';
        ok(Math.abs(b.w - (living ? 40 : 34)) < 1e-9 && Math.abs(b.h - b.w * ASPECT) < 1e-9, `${kind}: tip box ${b.w} x ${b.h}`);
        ok(b.x >= 7 - 1e-6 && b.y >= 3 - 1e-6 && b.x + b.w <= 7 + L.w + 1e-6 && b.y + b.h <= 3 + L.h + 1e-6, `${kind} ${maxTips}: tip box outside the layout`);
      }
      for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++)
        ok(!overlap(B[i], B[j]), `${kind} ${maxTips} tips: natural boxes ${i} and ${j} overlap`);
      for (const q of t.nodes) if (q.children.length) ok(Math.abs(L.box[q.id].w - 40 * ANC) < 1e-9, 'ancestor box is ANC of a tip');
    }
  }
});
test('tree: lineage runs root to node; param changes list real changes', () => {
  const t = treeOf(4);
  for (const tip of t.tips) {
    const L = lineage(t, tip);
    ok(L[0] === 0 && L[L.length - 1] === tip, 'root to tip');
    for (let i = 1; i < L.length; i++) ok(t.nodes[L[i]].parent === L[i - 1], 'parent chain');
    for (const c of paramChanges(t.nodes[0].params, t.nodes[tip].params)) ok(t.nodes[0].params[c.key] !== t.nodes[tip].params[c.key] && c.d > 0, 'listed a field that did not change');
  }
});

for (const [name, fn] of tests) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { fails++; console.log('FAIL ' + name + ': ' + e.message); }
}
console.log(fails ? `${fails} failed` : `all ${tests.length} passed`);
process.exitCode = fails;

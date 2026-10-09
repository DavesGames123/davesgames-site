// tests.mjs — node checks for the City Generator. Run: node tests.mjs
// No browser and no GPU. Each check prints one line; exit 1 on a failure.
//
// SECTIONS (grep -n 'section(')
//   generator   determinism by seed, event log, roads and water, separation,
//               blocks, lots, buildings
//   playback    the last frame equals the map, the first frame is empty

import { generate, fieldSampler, SIZES } from './gen.js';
import { timeline, frameAt, cut } from './playback.js';

let fails = 0, passes = 0;
const results = [];
function check(name, ok, info = '') {
  if (ok) passes++; else fails++;
  results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? '  ' + info : ''}`);
  console.log(results[results.length - 1]);
}
function section(name) { console.log(`\n# ${name}`); }

// ─── geometry helpers ───────────────────────────────────────────────────────
function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function area(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return a / 2;
}
function segX(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
function simple(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segX(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
  }
  return true;
}
function resample(l, step) {
  const out = [];
  for (let i = 1; i < l.length; i++) {
    const [ax, ay] = l[i - 1], [bx, by] = l[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  out.push(l[l.length - 1]);
  return out;
}
function distToRing(p, poly) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return d;
}
// in the polygon by more than tol (the coast road lies on the sea edge;
// coordinates are rounded to 0.01)
const deepIn = (p, poly, tol = 0.5) => inside(p, poly) && distToRing(p, poly) > tol;
const centroid = (p) => p.reduce((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length], [0, 0]);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// ─── generator ──────────────────────────────────────────────────────────────
section('generator');
const A = await generate({ seed: 7, size: 'town' });
const A2 = await generate({ seed: 7, size: 'town' });
const B = await generate({ seed: 8, size: 'town' });
const strip = (c) => JSON.stringify({ ...c, stats: { ...c.stats, ms: 0 } });
check('same seed gives the same city', strip(A) === strip(A2), `${strip(A).length} chars`);
check('another seed gives another city', strip(A) !== strip(B));
check('Math.random is restored after generate()', Math.random !== undefined && Math.random.name === 'random');
check('city has roads, blocks, lots', A.roads.main.length > 0 && A.roads.major.length > 0 && A.roads.minor.length > 0 && A.blocks.length > 0 && A.lots.length > 0,
  `main ${A.roads.main.length} major ${A.roads.major.length} minor ${A.roads.minor.length} blocks ${A.blocks.length} lots ${A.lots.length}`);
check('all coordinates are finite', [A.sea, A.river, A.coastline, ...Object.values(A.roads).flat(), ...A.parks, ...A.blocks, ...A.lots]
  .every((l) => l.every((p) => finite(p[0]) && finite(p[1]))));

// event log
{
  const ev = A.events;
  const kinds = ev.map((e) => e.k);
  const firstOf = (k) => kinds.indexOf(k), lastOf = (k) => kinds.lastIndexOf(k);
  check('events start with the field, then the coast and the river', kinds[0] === 'field' && firstOf('coast') === 1 && firstOf('river') === 2);
  const roadEv = ev.filter((e) => e.k === 'road');
  check('one road event per road line', roadEv.length === A.roads.main.length + A.roads.major.length + A.roads.minor.length);
  const clsOrder = roadEv.map((e) => e.cls);
  const firstMinor = clsOrder.indexOf('minor');
  check('road events: main, then major, then minor', clsOrder.lastIndexOf('main') < clsOrder.indexOf('major') && clsOrder.lastIndexOf('major') < firstMinor);
  check('road events keep creation order inside a class', ['main', 'major', 'minor'].every((c) => roadEv.filter((e) => e.cls === c).every((e, i) => e.i === i)));
  check('parks come after the major roads and before the minor roads', firstOf('parks') > ev.findIndex((e) => e.cls === 'major') && firstOf('parks') < ev.findIndex((e) => e.cls === 'minor'));
  check('blocks, lots, buildings come last, in that order', lastOf('road') < firstOf('block') && lastOf('block') < firstOf('lots') && lastOf('lots') < firstOf('building'));
  const lotEv = ev.filter((e) => e.k === 'lots');
  let next = 0, okLots = true;
  for (const e of lotEv) { if (e.from !== next || e.n < 1) okLots = false; next = e.from + e.n; }
  check('lot events cover every lot once, in order', okLots && next === A.lots.length, `${lotEv.length} groups`);
  check('one building event per lot', ev.filter((e) => e.k === 'building').length === A.lots.length);
}

// roads and water
for (const C of [A, B]) {
  let seaHits = 0, riverHits = 0, n = 0;
  for (const cls of ['main', 'major', 'minor']) {
    for (const l of C.roads[cls]) {
      for (let i = 1; i < l.length - 1; i++) {
        n++;
        if (C.sea.length > 2 && deepIn(l[i], C.sea)) seaHits++;
        // main and major roads are made with tensorField.ignoreRiver (upstream): they bridge the river
        if (cls === 'minor' && C.river.length > 2 && deepIn(l[i], C.river)) riverHits++;
      }
    }
  }
  check(`seed ${C.seed}: no road vertex in the sea (0.5 tolerance)`, seaHits === 0, `${seaHits}/${n} inner vertices`);
  check(`seed ${C.seed}: no minor road vertex in the river`, riverHits === 0, `${riverHits}`);
}

// separation: two roads of the same class and family keep dtest apart,
// away from their ends (joinDanglingStreamlines pulls the ends to other roads)
for (const cls of ['major', 'minor']) {
  const C = A, prm = C.roadParams[cls];
  const lines = C.roads[cls];
  const pts = lines.map((l) => resample(l, 2));
  // keep points more than dlookahead from both ends of their line
  const inner = pts.map((p) => {
    const cum = [0];
    for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    const L = cum[cum.length - 1];
    return p.filter((_, i) => cum[i] > prm.dlookahead && L - cum[i] > prm.dlookahead);
  });
  const cell = prm.dtest, grid = new Map();
  inner.forEach((p, li) => p.forEach((q) => {
    const k = `${Math.floor(q[0] / cell)},${Math.floor(q[1] / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push([q[0], q[1], li]);
  }));
  let worst = Infinity, tested = 0, close = 0;
  const lim = prm.dtest - 1.5;   // simplify tolerance 0.5 per line, and the step
  inner.forEach((p, li) => p.forEach((q) => {
    const cx = Math.floor(q[0] / cell), cy = Math.floor(q[1] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const r of grid.get(`${cx + dx},${cy + dy}`) || []) {
        if (r[2] === li || C.roadFamily[cls][r[2]] !== C.roadFamily[cls][li]) continue;
        const d = Math.hypot(r[0] - q[0], r[1] - q[1]);
        tested++;
        if (d < worst) worst = d;
        if (d < lim) close++;
      }
    }
  }));
  const frac = close / Math.max(1, inner.flat().length);
  check(`${cls} roads: same-family streamlines keep dtest = ${prm.dtest} apart`, frac < 0.002, `closest ${worst === Infinity ? '-' : worst.toFixed(2)}, points under ${lim}: ${close} (${(frac * 100).toFixed(3)}%)`);
}

// blocks and lots
{
  const C = A;
  const badBlocks = C.blocks.filter((b) => b.length < 3 || Math.abs(area(b)) < 1 || !simple(b));
  check('blocks are closed simple polygons with area', badBlocks.length === 0, `${C.blocks.length} blocks, ${badBlocks.length} bad`);
  check('lots are polygons with area', C.lots.every((l) => l.length >= 3 && Math.abs(area(l)) > 0.5));
  let out = 0;
  C.lots.forEach((l, i) => {
    const b = C.blocks[C.lotBlock[i]];
    if (!b || !inside(centroid(l), b)) out++;
  });
  check('each lot lies in its block', out === 0, `${out} of ${C.lots.length} outside`);
  check('one building per lot, heights finite and > 0', C.buildings.length === C.lots.length && C.buildings.every((b) => finite(b.h) && b.h > 0),
    `tallest ${C.stats.tallest} m`);
  // lots do not overlap: a lot centroid lies in no other lot
  const cell = 30, grid = new Map();
  C.lots.forEach((l, i) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of l) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    for (let x = Math.floor(x0 / cell); x <= Math.floor(x1 / cell); x++) for (let y = Math.floor(y0 / cell); y <= Math.floor(y1 / cell); y++) {
      const k = x + ',' + y; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
    }
  });
  let overlap = 0;
  C.lots.forEach((l, i) => {
    const c = centroid(l);
    if (!inside(c, l)) return;
    for (const j of grid.get(Math.floor(c[0] / cell) + ',' + Math.floor(c[1] / cell)) || []) if (j !== i && inside(c, C.lots[j])) { overlap++; break; }
  });
  check('lots do not overlap (centroid test)', overlap === 0, `${overlap}`);
}
{
  const f = fieldSampler(A);
  const v = f(A.view.w / 2, A.view.h / 2);
  check('field sampler gives unit vectors on land', !v || Math.abs(Math.hypot(v[0], v[1]) - 1) < 1e-6);
}

// ─── playback ───────────────────────────────────────────────────────────────
section('playback');
{
  const tl = timeline(A);
  check('timeline has a length and its phases in order', tl.dur > 10 && tl.phases.every((p, i) => p.t1 > p.t0 && (i === 0 || p.t0 >= tl.phases[i - 1].t1 - 1e-6)),
    `${tl.dur.toFixed(1)} s, ${tl.phases.map((p) => p.k).join(' ')}`);
  const end = frameAt(A, tl, tl.dur);
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  check('last frame: every road line, whole', ['coast', 'river', 'main', 'major', 'minor'].every((k) => same(end.roads[k], A.roads[k].filter((l) => l.length > 1))));
  check('last frame: every park, block and lot', same(end.parks, A.parks) && same(end.blocks, A.blocks) && same(end.lots, A.lots));
  check('last frame: every building at full height', end.buildings.length === A.buildings.length && end.buildings.every((b, i) => b.h === A.buildings[i].h && b.lot === A.lots[i]));
  check('last frame: water whole, field off', end.coast === 1 && end.river === 1 && end.field === 0 && end.phase === 'done');
  const start = frameAt(A, tl, 0);
  check('first frame: nothing built yet', Object.values(start.roads).every((r) => r.length === 0) && !start.lots.length && !start.buildings.length && start.coast === 0);
  // monotonic: the drawn road length never goes down
  let prev = -1, mono = true;
  for (let t = 0; t <= tl.dur; t += tl.dur / 40) {
    const f = frameAt(A, tl, t);
    const n = Object.values(f.roads).flat().reduce((s, l) => s + l.length, 0) + f.lots.length + f.buildings.length;
    if (n < prev) mono = false;
    prev = n;
  }
  check('playback only adds things as time goes on', mono);
  const l = [[0, 0], [10, 0], [10, 10]];
  const h = cut(l, 0.5);
  check('cut() takes the first half of a line by length', h.length === 2 && Math.abs(h[1][0] - 10) < 1e-9 && Math.abs(h[1][1]) < 1e-9);
}

// ─── end ────────────────────────────────────────────────────────────────────
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

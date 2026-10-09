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

// ─── 2D map and exports ────────────────────────────────────────────────────
section('2D map and exports');
{
  const { drawMap, fullFrame, fitView, toSVG, toJSON, CREDIT } = await import('./draw2d.js');
  // a recording 2D context: counts calls and checks every number is finite
  const rec = { calls: 0, bad: 0, fills: 0, strokes: 0 };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      return (...a) => { rec.calls++; if (k === 'fill') rec.fills++; if (k === 'stroke') rec.strokes++; for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) rec.bad++; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  const v = fitView(A, 800, 500, 10);
  check('fitView puts the map inside the box', v.s > 0 && v.ox >= 0 && v.oy >= 0 && v.ox + A.view.w * v.s <= 800 + 1e-6 && v.oy + A.view.h * v.s <= 500 + 1e-6);
  const tl = timeline(A);
  for (const [name, fr] of [['finished map', fullFrame(A)], ['mid playback', frameAt(A, tl, tl.dur * 0.5)], ['first frame', frameAt(A, tl, 0)]]) {
    rec.calls = 0; rec.bad = 0;
    let err = null;
    try { drawMap(ctx, A, fr, { w: 800, h: 500, dpr: 2, ...v, fieldAt: fieldSampler(A), layers: {} }); } catch (e) { err = e; }
    check(`drawMap draws the ${name} with finite numbers`, !err && rec.calls > 0 && rec.bad === 0, err ? err.message : `${rec.calls} calls`);
  }
  const svg = toSVG(A, { title: 'test' });
  // well-formed: every opened tag closes, in order
  const stack = [];
  let wellFormed = true;
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    if (m[3] === '/') continue;
    if (m[1] === '/') { if (stack.pop() !== m[2]) { wellFormed = false; break; } } else stack.push(m[2]);
  }
  check('SVG export is well formed', wellFormed && stack.length === 0, `${(svg.length / 1024).toFixed(0)} KB`);
  const nPoly = (svg.match(/<polygon /g) || []).length;
  check('SVG export has every lot, block and park', nPoly === A.lots.length + A.blocks.length + A.parks.length + (A.sea.length > 2) + (A.river.length > 2), `${nPoly} polygons`);
  check('SVG export carries the credit', svg.includes(CREDIT) && svg.includes('ProbableTrain'));
  const j = JSON.parse(toJSON(A));
  check('JSON export parses and keeps the city', j.seed === A.seed && j.lots.length === A.lots.length && j.buildings.length === A.lots.length && j.roads.minor.length === A.roads.minor.length && j.credit === CREDIT);
}

// ─── 3D mesh ────────────────────────────────────────────────────────────────
section('3D mesh');
{
  const { buildMesh, toSTL, earcut, fieldLines, buildingAt, STRIDE, Z } = await import('./mesh3d.js');
  const tl = timeline(A);
  const m = buildMesh(A, tl);
  const nv = m.vertices.byteLength / STRIDE;
  const f32 = new Float32Array(m.vertices);
  let bad = 0;
  for (let i = 0; i < nv; i++) for (const k of [0, 1, 2, 5, 6, 7, 8, 9, 10, 11]) if (!Number.isFinite(f32[i * 13 + k])) bad++;
  check('mesh: every vertex number is finite', bad === 0 && nv > 0, `${nv} vertices, ${(m.vertices.byteLength / 1e6).toFixed(1)} MB`);
  let maxI = 0;
  for (const i of m.indices) if (i > maxI) maxI = i;
  check('mesh: indices are in range, whole triangles', maxI < nv && m.indices.length % 3 === 0, `${m.indices.length / 3} triangles`);
  const r = m.ranges;
  check('mesh: ranges cover the index buffer in order (opaque, roads)', r.opaque[0] === 0 && r.opaque[1] === r.roads[0] && r.roads[0] + r.roads[1] === m.indices.length && r.buildings[0] + r.buildings[1] === r.opaque[1] && r.roads[1] > 0);
  // flat layers: one z per layer, and no two layers share a z
  const zOf = new Map();
  for (let i = 0; i < nv; i++) {
    const kind = Math.round(f32[i * 13 + 8]);
    if (kind === 2 || kind === 3) continue;   // z there is a 0/1 flag the shader scales
    const z = f32[i * 13 + 2];
    if (!zOf.has(kind)) zOf.set(kind, new Set());
    zOf.get(kind).add(+z.toFixed(4));
  }
  const allZ = [...zOf.values()].map((s2) => [...s2]);
  check('mesh: each flat layer has one z', allZ.every((a) => a.length === 1), [...zOf.entries()].map(([k, s2]) => `${k}:${[...s2]}`).join(' '));
  const zs = allZ.flat();
  check('mesh: no two flat layers are coplanar', new Set(zs).size === zs.length && Math.min(...zs.filter((z) => z > 0)) > 0);
  check('mesh: roofs always above the block tops, block tops above the roads', Z.block + Z.pad > Z.block && Z.block > Z.field && Z.field > Z.road && Z.road > Z.park && Z.park > Z.sea && Z.sea > Z.river && Z.river > Z.ground);
  // building footprints: no vertex of one footprint inside another (no shared wall planes)
  {
    const foot = [];
    for (let i = 0; i < nv; i++) {
      const kind = Math.round(f32[i * 13 + 8]);
      if (kind !== 3 || f32[i * 13 + 2] !== 1) continue;
      const nz = new Int8Array(m.vertices, i * STRIDE + 12, 3)[2];
      if (nz < 100) continue;   // roof vertices only
      foot.push([f32[i * 13], f32[i * 13 + 1], f32[i * 13 + 9]]);
    }
    check('mesh: buildings have roof vertices', foot.length >= A.lots.length * 3, `${foot.length} roof vertices`);
  }
  // building footprints: no vertex of one footprint inside another (no shared wall planes)
  {
    let overlaps = 0;
    const cx = A.view.w / 2, cy = A.view.h / 2;
    const polys = A.lots.map((l) => {
      const p = l.map((q) => [q[0] - cx, cy - q[1]]);
      const c = p.reduce((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length], [0, 0]);
      let rr = 0; for (const q of p) rr = Math.max(rr, Math.hypot(q[0] - c[0], q[1] - c[1]));
      const k = rr > 3 * 0.35 ? 1 - 0.35 / rr : 0.85;
      return p.map((q) => [c[0] + (q[0] - c[0]) * k, c[1] + (q[1] - c[1]) * k]);
    });
    const cell = 30, grid = new Map();
    polys.forEach((p, i) => {
      for (const q of p) { const k = Math.floor(q[0] / cell) + ',' + Math.floor(q[1] / cell); if (!grid.has(k)) grid.set(k, new Set()); grid.get(k).add(i); }
    });
    polys.forEach((p, i) => {
      for (const q of p) {
        for (const j of grid.get(Math.floor(q[0] / cell) + ',' + Math.floor(q[1] / cell)) || []) {
          if (j !== i && inside(q, polys[j]) && distToRing(q, polys[j]) > 1e-3) { overlaps++; return; }
        }
      }
    });
    check('mesh: building footprints (lots inset 0.35 m) do not overlap', overlaps === 0, `${overlaps} of ${polys.length}`);
  }
  // triangulation keeps the area
  {
    let worst = 0;
    for (const b of A.blocks.slice(0, 400)) {
      const t = earcut(b);
      let s2 = 0;
      for (let i = 0; i < t.length; i += 3) { const [a1, b1, c1] = [b[t[i]], b[t[i + 1]], b[t[i + 2]]]; s2 += Math.abs((b1[0] - a1[0]) * (c1[1] - a1[1]) - (b1[1] - a1[1]) * (c1[0] - a1[0])) / 2; }
      worst = Math.max(worst, Math.abs(s2 - Math.abs(area(b))) / Math.abs(area(b)));
    }
    check('earcut: the triangles of a block add up to its area', worst < 1e-6, `worst ${worst.toExponential(1)}`);
  }
  // playback in 3D: at the end every building stands at full height, at 0 none shows
  {
    const endOk = A.buildings.every((b, i) => { const s2 = buildingAt(tl, i, tl.dur + 1, b.h); return s2.shown && Math.abs(s2.top - (Z.block + b.h)) < 1e-6; });
    const startOk = A.buildings.every((b, i) => !buildingAt(tl, i, 0, b.h).shown);
    check('3D playback: every building at full height at the end, none at t = 0', endOk && startOk);
  }
  const fl = fieldLines(A, fieldSampler(A));
  check('field lines: finite, whole segments', fl.length > 0 && fl.length % 6 === 0 && fl.every(Number.isFinite), `${fl.length / 6} segments`);
  const stl = toSTL(A);
  const dv = new DataView(stl);
  const nt = dv.getUint32(80, true);
  let stlBad = 0;
  for (let i = 0; i < Math.min(nt, 20000); i++) for (let k = 0; k < 12; k++) if (!Number.isFinite(dv.getFloat32(84 + i * 50 + k * 4, true))) stlBad++;
  check('STL export parses: header, count, size, finite numbers', stl.byteLength === 84 + nt * 50 && nt > 0 && stlBad === 0, `${nt} triangles, ${(stl.byteLength / 1e6).toFixed(1)} MB`);
}

// ─── page module with DOM stubs ────────────────────────────────────────────
section('page module (DOM stubs, no browser)');
{
  const rec = { draws: 0 };
  const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { if (k === 'fill') rec.draws++; }), set: (t, k, v) => { t[k] = v; return true; } });
  const el = () => {
    const kids = [];
    const node = {
      hidden: false, width: 0, height: 0, style: { setProperty() {} }, dataset: {}, children: kids,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      textContent: '', innerHTML: '', value: '1',
      setAttribute() {}, getAttribute: () => null, addEventListener() {}, appendChild() {}, prepend() {}, remove() {}, click() {},
      querySelector: () => el(), querySelectorAll: () => [], contains: () => false, closest: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 60, width: 800, height: 60 }),
      setPointerCapture() {}, getContext: () => ctx2d, toBlob() {},
    };
    return node;
  };
  const els = new Map();
  globalThis.window = globalThis;
  globalThis.innerWidth = 1280; globalThis.innerHeight = 800; globalThis.devicePixelRatio = 1;
  globalThis.document = {
    getElementById: (id) => { if (!els.has(id)) els.set(id, el()); return els.get(id); },
    createElement: () => el(), documentElement: el(), body: el(), addEventListener() {},
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.location = { hash: '#seed=5&size=town' };
  globalThis.history = { replaceState() {} };
  globalThis.addEventListener = () => {};
  let err = null;
  try { await import('./main.js'); await globalThis.__mapGen.started; } catch (e) { err = e; }
  const g = globalThis.__mapGen;
  check('main.js loads and generates with stubs (no Worker: main-thread path)', !err && g && g.city && g.city.seed === 5, err ? err.message : `seed ${g.city.seed}, ${g.city.lots.length} lots`);
  check('the page starts the playback at t = 0', g && g.state.T === 0 && g.state.playing === true);
}

// ─── end ────────────────────────────────────────────────────────────────────
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

// tests.mjs — node checks for the City Generator. Run: node tests.mjs
// No browser and no GPU. Each check prints one line; exit 1 on a failure.
//
// SECTIONS (grep -n 'section(')
//   generator   determinism by seed, event log, roads and water, separation,
//               blocks, lots, buildings
//   playback    the last frame equals the map, the first frame is empty
//   2D map and exports, 3D mesh (terrain off: the city as before)
//   terrain     terrain on and off, determinism, coast and river from the
//               terrain, no lot in water, road grades, the terrain phase,
//               the 3D ground and city bases, the 2D underlay, exports
//   layout      layout.js: phone modes and media queries, framing, sheet grip,
//               pinch, pan clamp, double tap, scrub, pixel ratio, progress
//   progress    the gen.js progress hooks: stage order, same city, clonable
//   page module main.js with DOM stubs (terrain on: the page default)
//   worker path main.js with a stand-in Worker: progress, then the city

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
  // road trim: no 3D road end past the built area or over the sea
  {
    const { trimRoads, ANCHOR, extent } = await import('./mesh3d.js');
    const tr = trimRoads(A);
    const ex = extent(A);
    const keptBlocks = A.blocks.filter((_, i) => ex.block[i]);
    check('3D extent keeps the blocks of the 2D view and drops the margin', keptBlocks.length > 0 && keptBlocks.length < A.blocks.length && ex.lot.filter(Boolean).length > 0, `${keptBlocks.length} of ${A.blocks.length} blocks, ${ex.lot.filter(Boolean).length} of ${A.lots.length} lots`);
    const edgePts = [];
    for (const b of keptBlocks) for (let i = 0; i < b.length; i++) {
      const p = b[i], q = b[(i + 1) % b.length], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2));
      for (let k = 0; k < n; k++) edgePts.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]);
    }
    const nearBlock = (x, y) => edgePts.some((e) => (e[0] - x) ** 2 + (e[1] - y) ** 2 <= (ANCHOR + 1) ** 2);
    const inPark = (x, y) => A.parks.some((pk) => inside([x, y], pk));
    let ends = 0, loose = 0, wet = 0, kept = 0, dropped = 0, cut = 0;
    for (const cls of Object.keys(tr)) tr[cls].forEach((r, i) => {
      if (!r) { dropped++; return; }
      kept++;
      const l0 = A.roads[cls][i];
      if (r.line.length !== l0.length || r.a > 0) cut++;
      for (const e of [r.line[0], r.line[r.line.length - 1]]) {
        ends++;
        if (!nearBlock(e[0], e[1]) && !inPark(e[0], e[1])) loose++;
        // an end that joins the coast road sits up to dstep into the sea, under
        // that road (10 m wide); deeper than half its width would show as a pier
        if (A.sea.length > 2 && deepIn(e, A.sea, 5)) wet++;
      }
    });
    check(`3D roads: every road end within ${ANCHOR} m of a block edge or in a park`, loose === 0, `${ends} ends, ${loose} loose; ${cut} roads cut, ${dropped} dropped, ${kept} kept`);
    check('3D roads: no road ends over the sea past the coast road (bridges keep their middles)', wet === 0, `${wet}`);
    // the stub test for the untrimmed roads, to show the trim does work
    let rawLoose = 0;
    for (const cls of Object.keys(tr)) for (const l of A.roads[cls]) for (const e of [l[0], l[l.length - 1]]) if (!nearBlock(e[0], e[1]) && !inPark(e[0], e[1])) rawLoose++;
    check('the untrimmed roads do have loose ends (the case the trim fixes)', rawLoose > 0, `${rawLoose}`);
  }
  const stl = toSTL(A);
  const dv = new DataView(stl);
  const nt = dv.getUint32(80, true);
  let stlBad = 0;
  for (let i = 0; i < Math.min(nt, 20000); i++) for (let k = 0; k < 12; k++) if (!Number.isFinite(dv.getFloat32(84 + i * 50 + k * 4, true))) stlBad++;
  check('STL export parses: header, count, size, finite numbers', stl.byteLength === 84 + nt * 50 && nt > 0 && stlBad === 0, `${nt} triangles, ${(stl.byteLength / 1e6).toFixed(1)} MB`);
}

// ─── terrain ────────────────────────────────────────────────────────────────
section('terrain');
{
  const { presetValues, groundAt, riverAt, snapshotRaster, CITY_PRESETS } = await import('./terrain.js');
  const { buildMesh, STRIDE, toSTL, fieldLines } = await import('./mesh3d.js');
  const { TSTRIDE } = await import('./terrain3d.js');
  const { drawMap, fullFrame, fitView, toSVG, toJSON } = await import('./draw2d.js');
  const opt = (p, extra = {}) => ({ seed: 7, size: 'town', terrain: true, tPreset: p, ...presetValues(p), tSeed: 3, ...extra });
  // a hash of the city with its typed arrays (JSON of 20 MB is slow)
  const hash = (c) => {
    let h = 2166136261 >>> 0;
    const mix = (x) => { h = Math.imul(h ^ x, 16777619) >>> 0; };
    const walk = (v) => {
      if (v == null) { mix(1); return; }
      if (ArrayBuffer.isView(v)) { const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength); for (let i = 0; i < b.length; i++) mix(b[i]); return; }
      if (Array.isArray(v)) { mix(v.length); for (const x of v) walk(x); return; }
      if (typeof v === 'object') { for (const k of Object.keys(v).sort()) { if (k === 'ms' || k === 'terrainMs') continue; for (let i = 0; i < k.length; i++) mix(k.charCodeAt(i)); walk(v[k]); } return; }
      const s = String(v); for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
    };
    walk(c);
    return h.toString(16);
  };
  const t0 = Date.now();
  const D = await generate(opt('river-delta'));
  const tD = Date.now() - t0;
  const D2 = await generate(opt('river-delta'));
  const D3 = await generate(opt('river-delta', { tSeed: 4 }));
  const Hl = await generate(opt('highlands'));
  const T = D.terrain;
  check('terrain off: the city has no terrain and starts with the field', A.terrain === undefined && A.events[0].k === 'field' && A.opts.terrain === false);
  check('terrain on: the events start with the terrain, then the field', D.events[0].k === 'terrain' && D.events[1].k === 'field', `${tD} ms, ${D.lots.length} lots, relief ${D.stats.relief} m`);
  check('terrain: the same seeds and options give the same city and ground', hash(D) === hash(D2), hash(D));
  check('terrain: another world seed gives another world', hash(D) !== hash(D3) && T.site.x !== D3.terrain.site.x || T.site.z !== D3.terrain.site.z || hash(D) !== hash(D3));
  check('terrain: the city on terrain differs from the flat city of the same seed', hash(D) !== hash(await generate({ seed: 7, size: 'town' })));
  check('terrain: Math.random is restored', Math.random.name === 'random');
  // the coast from the terrain sea level
  {
    const inV = (p) => p[0] > 0 && p[1] > 0 && p[0] < D.view.w && p[1] < D.view.h;
    let n = 0, off = 0, worst = 0;
    let mouth = 0;
    for (const l of D.roads.coast) for (const p of l) {
      if (!inV(p)) continue;
      // where the shore crosses the river mouth the ground is the carved bed
      const r = riverAt(T, p[0], p[1]);
      if (r && r.d < T.river.halfW + 12) { mouth++; continue; }
      n++;
      const d = Math.abs(groundAt(T, p[0], p[1]) - T.seaLevel);
      worst = Math.max(worst, d);
      if (d > 2.5) off++;
    }
    check('terrain: the coast roads lie on the terrain sea level (within 2.5 m, off the river mouth)', n > 20 && off === 0, `${n} vertices in the view, ${off} off, worst ${worst.toFixed(2)} m, ${mouth} at the river mouth`);
    let agree = 0, tot = 0;
    for (let y = 5; y < D.view.h; y += 23) for (let x = 5; x < D.view.w; x += 23) {
      const g = groundAt(T, x, y);
      if (Math.abs(g - T.seaLevel) < 1.5) continue;
      if (riverAt(T, x, y) && riverAt(T, x, y).d < T.river.halfW + 20) continue;
      tot++;
      if ((g < T.seaLevel) === inside([x, y], D.sea)) agree++;
    }
    check('terrain: the sea polygon is the ground under the sea level', tot > 100 && agree / tot > 0.995, `${agree} of ${tot} samples agree`);
    check('terrain: the sea is an even-odd polygon of the shore rings', D.sea.length > 2 && T.waterRings.length >= 1 && D.coastlines.length === D.roads.coast.length, `${T.waterRings.length} rings, ${D.sea.length} points`);
  }
  // the river from the largest LIB river
  {
    const rv = T.river;
    check('terrain: a river from the terrain crosses the view', !!rv && D.river.length > 3 && D.roads.river.length >= 1, rv ? `half width ${rv.halfW} m, ${rv.line.length} points, ${D.roads.river.length} bank roads` : 'none');
    const tex = T.worldSize / 512;
    const dTo = (p, l) => { let b = Infinity; for (let i = 1; i < l.length; i++) { const a = l[i - 1], c = l[i], dx = c[0] - a[0], dy = c[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); b = Math.min(b, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)); } return b; };
    let far = 0, worst = 0;
    for (const p of rv.line) { const d = dTo(p, rv.lib); worst = Math.max(worst, d); if (d > 1.5 * tex) far++; }
    check('terrain: the river follows the LIB river (within 1.5 texels)', far === 0, `worst ${worst.toFixed(1)} m, texel ${tex.toFixed(1)} m`);
    const inPoly = rv.line.slice(1, -1).filter((p) => inside(p, D.river)).length;
    check('terrain: the river polygon holds its centreline', inPoly >= 0.95 * (rv.line.length - 2), `${inPoly} of ${rv.line.length - 2}`);
    check('terrain: the river surface never rises downstream', rv.surf.every((v, i) => i === 0 || v <= rv.surf[i - 1] + 1e-6), `${rv.surf[0].toFixed(2)} .. ${rv.surf[rv.surf.length - 1].toFixed(2)} m`);
  }
  // no buildings in water, roads under the grade bound
  for (const C of [D, Hl]) {
    const TT = C.terrain;
    let wet = 0, low = 0;
    C.lots.forEach((l) => {
      const c = centroid(l);
      if ((C.sea.length > 2 && inside(c, C.sea)) || (C.river.length > 2 && inside(c, C.river))) wet++;
      if (TT.hasSea && groundAt(TT, c[0], c[1]) < TT.seaLevel) low++;
    });
    check(`terrain ${TT.preset}: no lot in the sea, a lake or the river`, wet === 0 && low === 0 && C.lots.length > 200, `${C.lots.length} lots, ${wet} in water, ${low} under the sea level`);
    let L = 0, over = 0, over2 = 0;
    for (const cls of ['main', 'major', 'minor']) for (const l of C.roads[cls]) for (const q of [resample(l, 4)]) for (let i = 1; i < q.length; i++) {
      const d = Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
      if (!d) continue;
      const r = riverAt(TT, q[i][0], q[i][1]);
      if (r && r.d < TT.river.halfW + 20) continue;   // bridges
      const g = Math.abs(groundAt(TT, q[i][0], q[i][1]) - groundAt(TT, q[i - 1][0], q[i - 1][1])) / d;
      L += d; if (g > TT.grade) over += d; if (g > 1.5 * TT.grade) over2 += d;
    }
    check(`terrain ${TT.preset}: road grades stay under the street grade (${TT.grade})`, over / L < 0.05 && over2 / L < 0.02,
      `${(L / 1000).toFixed(1)} km of road, ${(over / L * 100).toFixed(2)} % over the grade, ${(over2 / L * 100).toFixed(2)} % over 1.5 times`);
  }
  // more presets: each gives a city with lots, none in water
  for (const p of ['archipelago', 'canyonlands', 'alpine']) {
    const C = await generate(opt(p));
    const wet = C.lots.filter((l) => { const c = centroid(l); return (C.sea.length > 2 && inside(c, C.sea)) || (C.river.length > 2 && inside(c, C.river)); }).length;
    check(`terrain ${p}: a city with lots, none in water`, C.lots.length > 100 && wet === 0, `${C.lots.length} lots, roads ${C.roads.main.length + C.roads.major.length + C.roads.minor.length}, coast ${C.roads.coast.length}, river ${C.river.length > 2 ? 'yes' : 'no'}`);
  }
  check('terrain: every preset is a LIB preset', CITY_PRESETS.length >= 8);
  // playback
  {
    const tl = timeline(D);
    check('terrain playback: the terrain phase comes first', tl.phases[0].k === 'terrain' && tl.terrain && tl.phases[1].k === 'field', tl.phases.map((p) => p.k).join(' '));
    const f0 = frameAt(D, tl, 0), fm = frameAt(D, tl, tl.terrain[1] * 0.5), fe = frameAt(D, tl, tl.dur);
    check('terrain playback: at t = 0 the terrain starts and nothing is built', f0.terrain === 0 && f0.snap === 0 && !f0.lots.length && Object.values(f0.roads).every((r) => !r.length));
    check('terrain playback: half way through the terrain phase, the middle snapshot', Math.abs(fm.snap - T.snaps.length / 2) < 1e-6 && fm.phase === 'terrain');
    check('terrain playback: the last frame is the whole city on the finished ground', fe.terrain === 1 && fe.phase === 'done' && fe.lots.length === D.lots.length && fe.buildings.length === D.buildings.length);
    check('terrain playback: the field fades as before (field phase after the terrain)', frameAt(D, tl, tl.field[0] + tl.field[1]).field > 0.9 && fe.field === 0);
    check('terrain: 7 stage snapshots, each over the world and the domain', T.snaps.length === 7 && T.snaps.every((sn) => sn.world.every(Number.isFinite) && sn.crop.length === T.crop.w * T.crop.h), T.snaps.map((sn) => sn.stage).join(' '));
  }
  // 3D
  {
    const tl = timeline(D);
    const m = buildMesh(D, tl);
    const nv = m.vertices.byteLength / STRIDE, f32 = new Float32Array(m.vertices);
    let bad = 0;
    for (let i = 0; i < nv; i++) for (const k of [0, 1, 2, 5, 6, 7, 8, 9, 10, 11, 12]) if (!Number.isFinite(f32[i * 13 + k])) bad++;
    let mx = 0; for (const i of m.indices) if (i > mx) mx = i;
    check('terrain mesh: city vertices finite, indices in range', bad === 0 && mx < nv, `${nv} vertices`);
    const t = m.terrain, tv = t.vertices.byteLength / TSTRIDE, tf = new Float32Array(t.vertices);
    let tbad = 0, tmx = 0;
    for (let i = 0; i < tv; i++) for (const k of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13]) if (!Number.isFinite(tf[i * 14 + k])) tbad++;
    for (const i of t.indices) if (i > tmx) tmx = i;
    check('terrain mesh: ground vertices finite, 8 heights, indices in range', tbad === 0 && tmx < tv && t.K === 8 && t.indices.length % 3 === 0, `${tv} vertices, ${t.indices.length / 3} triangles`);
    // the patch vertices carry the graded ground as their last height
    const NO = T.outer.G + 1, base = NO * NO;
    let off = 0;
    for (let q = 0; q < T.grid.h.length; q += 97) if (Math.abs(tf[(base + q) * 14 + 9] - T.grid.h[q]) > 1e-3) off++;
    check('terrain mesh: the patch ends on the graded city ground', off === 0);
    // building roofs and block tops stand on their ground
    const cx = D.view.w / 2, cy = D.view.h / 2;
    let under = 0, n3 = 0;
    for (let i = 0; i < nv; i++) {
      const kind = Math.round(f32[i * 13 + 8]);
      if ((kind !== 3 && kind !== 2) || f32[i * 13 + 2] !== 1) continue;
      n3++;
      const g = groundAt(T, f32[i * 13] + cx, cy - f32[i * 13 + 1]);
      if (f32[i * 13 + 12] < g + 0.4) under++;
    }
    check('terrain mesh: block and roof corners sit on or over the ground', n3 > 0 && under === 0, `${n3} corners, ${under} under`);
    let feet = 0, nf = 0;
    for (let i = 0; i < nv; i++) {
      if (Math.round(f32[i * 13 + 8]) !== 3 || f32[i * 13 + 2] !== 0) continue;
      nf++;
      const g = groundAt(T, f32[i * 13] + cx, cy - f32[i * 13 + 1]);
      if (f32[i * 13 + 12] + 0.6 > g + 0.6) feet++;
    }
    check('terrain mesh: building feet go into the ground', nf > 0 && feet === 0, `${nf} feet, ${feet} above`);
    check('terrain mesh: the camera looks at the ground (or the water) under the centre', Number.isFinite(m.groundZ) && Math.abs(m.groundZ - Math.max(groundAt(T, cx, cy), T.hasSea ? T.seaLevel : -Infinity)) < 1e-6, `ground ${m.groundZ.toFixed(1)} m, yaw ${m.homeYaw == null ? '-' : m.homeYaw.toFixed(2)}`);
    const fl = fieldLines(D, fieldSampler(D));
    check('terrain: field lines finite, on the ground', fl.length > 0 && fl.every(Number.isFinite));
    const stl = toSTL(D);
    check('terrain: STL export parses', stl.byteLength === 84 + new DataView(stl).getUint32(80, true) * 50);
  }
  // 2D
  {
    const rec = { calls: 0, bad: 0, images: 0 };
    const ctx = new Proxy({}, {
      get(t2, k) { if (k in t2) return t2[k]; return (...a) => { rec.calls++; if (k === 'drawImage') rec.images++; for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) rec.bad++; }; },
      set(t2, k, v) { t2[k] = v; return true; },
    });
    const v = fitView(D, 800, 500, 10), tl = timeline(D);
    const img = { width: T.under.w, height: T.under.h };
    let err = null;
    try {
      drawMap(ctx, D, fullFrame(D), { w: 800, h: 500, dpr: 2, ...v, fieldAt: fieldSampler(D), layers: {}, terrain: { a: img, b: null, k: 0 } });
      drawMap(ctx, D, frameAt(D, tl, 2), { w: 800, h: 500, dpr: 2, ...v, fieldAt: null, layers: {}, terrain: { a: img, b: img, k: 0.4 } });
    } catch (e) { err = e; }
    check('terrain 2D: the underlay and the contours draw with finite numbers', !err && rec.bad === 0 && rec.images === 3, err ? err.message : `${rec.calls} calls, ${rec.images} images`);
    const u = T.under;
    check('terrain 2D: the underlay covers the domain, opaque', u.data.length === u.w * u.h * 4 && u.w * u.m >= D.domain.w - u.m && u.data.every((x, i) => i % 4 !== 3 || x === 255), `${u.w} x ${u.h} at ${u.m} m`);
    check('terrain 2D: contour lines at a round interval', T.contours.interval > 0 && T.contours.minor.length % 4 === 0 && T.contours.minor.length + T.contours.major.length > 0, `every ${T.contours.interval} m, ${T.contours.minor.length / 4 + T.contours.major.length / 4} segments`);
    const r = snapshotRaster(T, 0);
    check('terrain 2D: the snapshot rasters fill their crop', r.data.length === T.crop.w * T.crop.h * 4);
    const svg = toSVG(D);
    check('terrain SVG: contours, an even-odd sea, the coastlines', svg.includes('id="contours"') && svg.includes('fill-rule="evenodd"') && (svg.match(/class="coastline"/g) || []).length === D.coastlines.length);
    const j = JSON.parse(toJSON(D));
    check('terrain JSON: the terrain summary, no grids', j.terrain && j.terrain.preset === T.preset && j.terrain.options.seed === T.opts.seed && !('grid' in j.terrain));
  }
}

// ─── page module with DOM stubs ────────────────────────────────────────────
section('layout (layout.js: phone modes, framing, gestures; no DOM)');
{
  const L = await import('./layout.js');
  const VIEWPORTS = [[360, 740, true, 'sheet'], [390, 844, true, 'sheet'], [430, 932, true, 'sheet'], [768, 1024, true, 'sheet'], [844, 390, true, 'drawer'], [1280, 800, false, 'desk'], [1024, 768, true, 'desk']];
  check('layoutMode gives the planned layout at each viewport', VIEWPORTS.every(([w, h, c, m]) => L.layoutMode(w, h, c) === m), VIEWPORTS.map(([w, h, c]) => `${w}x${h} ${L.layoutMode(w, h, c)}`).join(', '));
  let agree = true, bad = '';
  for (let w = 300; w <= 1400; w += 37) for (let h = 300; h <= 1100; h += 41) for (const c of [false, true]) {
    const m = L.layoutMode(w, h, c), env = { w, h, coarse: c };
    if (L.mediaMatches(L.PHONE_Q, env) !== (m !== 'desk') || L.mediaMatches(L.LAND_Q, env) !== (m === 'drawer')) { agree = false; bad = `${w}x${h} ${c}`; }
  }
  check('PHONE_Q and LAND_Q (the CSS queries) agree with layoutMode on a grid of sizes', agree, bad);
  const D = L.DOCK;
  check('the dock fits 360 px: four 48 px buttons, a two-target view switch, gaps and pads', 4 * D.button + 2 * D.target + 5 * D.gap + 2 * D.pad <= 360 && D.target >= 44);
  // portrait sheet: head 120 px, half sheet + dock from 400 px down
  const occ = L.occlusion(390, 844, [{ left: 0, top: 0, right: 390, bottom: 120 }, { left: 0, top: 440, right: 390, bottom: 780 }, { left: 0, top: 780, right: 390, bottom: 844 }, { left: 300, top: 300, right: 380, bottom: 340 }]);
  check('occlusion: head on the top, sheet and dock on the base, a small box is ignored', occ.t === 120 && occ.b === 404 && occ.l === 0 && occ.r === 0, JSON.stringify(occ));
  const occL = L.occlusion(844, 390, [{ left: 450, top: 0, right: 844, bottom: 390 }, { left: 0, top: 326, right: 440, bottom: 390 }]);
  check('occlusion: a landscape drawer covers the right side', occL.r === 394 && occL.b === 64 && occL.l === 0, JSON.stringify(occL));
  const occBig = L.occlusion(400, 800, [{ left: 0, top: 0, right: 400, bottom: 300 }, { left: 0, top: 300, right: 400, bottom: 800 }]);
  check('occlusion keeps 30% of the height clear', 800 - occBig.t - occBig.b >= 0.3 * 800 - 1e-6, JSON.stringify(occBig));
  const v = L.fitClear(960, 640, 390, 844, occ, 6);
  const inClear = v.ox >= 6 - 1e-6 && v.ox + 960 * v.s <= 390 - 6 + 1e-6 && v.oy >= occ.t + 6 - 1e-6 && v.oy + 640 * v.s <= 844 - occ.b - 6 + 1e-6;
  check('fitClear puts the town in the clear area above the sheet', inClear, `s ${v.s.toFixed(3)}, y ${v.oy.toFixed(0)}..${(v.oy + 640 * v.s).toFixed(0)}`);
  const vl = L.fitClear(960, 640, 844, 390, occL, 6);
  check('fitClear puts the town left of the landscape drawer', vl.ox + 960 * vl.s <= 844 - occL.r - 6 + 1e-6 && vl.oy + 640 * vl.s <= 390 - 64 - 6 + 1e-6);
  const o3 = L.offsets3D(390, 844, occ);
  check('offsets3D moves the 3D view up into the clear area (and left for a right drawer)', o3.y > 0 && Math.abs(o3.y - (404 - 120) / 844) < 1e-9 && o3.x === 0 && L.offsets3D(844, 390, occL).x < 0);
  {
    const { viewProj, project } = await import('./camera.js');
    const cam = { target: [0, 0, 0], yaw: 0.4, pitch: 0.6, dist: 900 };
    const m = viewProj(cam, 390 / 844).vp, q0 = project(m, [50, 20, 10], 390, 844);
    const q1 = project(L.shiftX(Float32Array.from(m), -0.25), [50, 20, 10], 390, 844);
    check('shiftX moves every point by offsetX x w / 2 px (the 3D framing)', Math.abs(q1.x - q0.x + 0.25 * 390 / 2) < 1e-3 && Math.abs(q1.y - q0.y) < 1e-6);
  }
  const S = L.sheetSnap;
  check('sheetSnap: open gives half, a tap toggles half and full, a drag down steps to closed',
    S('closed', 0) === 'half' && S('half', 2) === 'full' && S('full', 0) === 'half' && S('half', -80) === 'full' && S('full', 90) === 'half' && S('half', 90) === 'closed' && S('half', 20) === 'half');
  const p0 = { s: 1, ox: 0, oy: 0 }, mid = { x: 100, y: 100 };
  const p1 = L.pinchStep(p0, { mid, d: 100 }, { mid, d: 200 });
  check('pinchStep zooms about the mid point (the point under the fingers stays)', Math.abs(p1.s - 2) < 1e-9 && Math.abs((100 - p1.ox) / p1.s - 100) < 1e-9 && Math.abs((100 - p1.oy) / p1.s - 100) < 1e-9);
  const p2 = L.pinchStep(p0, { mid, d: 100 }, { mid: { x: 130, y: 90 }, d: 100 });
  check('pinchStep pans with the mid point at a fixed distance', p2.s === 1 && p2.ox === 30 && p2.oy === -10);
  check('pinchStep clamps the zoom', L.pinchStep(p0, { mid, d: 1 }, { mid, d: 1e5 }).s === 40 && L.pinchStep(p0, { mid, d: 1e5 }, { mid, d: 1 }).s === 0.05);
  const cp = L.clampPan({ s: 0.4, ox: -5000, oy: 9000 }, 960, 640, 390, 844);
  check('clampPan keeps 80 px of the map in the window', cp.ox + 960 * 0.4 >= 80 - 1e-9 && cp.oy <= 844 - 80 + 1e-9);
  check('isDoubleTap: two near taps in 320 ms', L.isDoubleTap({ t: 0, x: 10, y: 10 }, { t: 250, x: 20, y: 18 }) && !L.isDoubleTap({ t: 0, x: 10, y: 10 }, { t: 400, x: 10, y: 10 }) && !L.isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 100, x: 60, y: 0 }) && !L.isDoubleTap(null, { t: 1, x: 0, y: 0 }));
  check('scrubTime maps the bar to the time and clamps it', L.scrubTime(150, 50, 200, 40) === 20 && L.scrubTime(0, 50, 200, 40) === 0 && L.scrubTime(999, 50, 200, 40) === 40);
  check('dprFor caps the 3D view at 1.5 on a phone and 2 elsewhere', L.dprFor(3, true, '3d') === 1.5 && L.dprFor(3, false, '3d') === 2 && L.dprFor(3, true, '2d') === 2 && L.dprFor(1, true, '3d') === 1);
  check('citySizeFor: a town on a phone', L.citySizeFor(true, 'city') === 'town' && L.citySizeFor(false, 'city') === 'city');
  const ks = L.STAGES.map((s) => s[0]);
  let mono = true, prev = -1;
  for (const k of ks) for (const sub of [0, 0.5, 1]) { const f = L.progressShare(k, sub); if (f < prev - 1e-9) mono = false; prev = f; }
  check('progressShare grows through the stages from 0 to 1', mono && L.progressShare('terrain', 0) === 0 && L.progressShare('done') === 1);
  check('progressShare with no terrain starts the bar at the tensor field', L.progressShare('field', 0, false) === 0 && L.progressShare('lots', 0, false) > 0.8 && L.progressShare('terrain', 0.5, false) === 0);
  const A = L.accordionToggle;
  check('accordionToggle: one section at a time on a phone, many on a desktop', JSON.stringify(A(['city'], 'terrain', true)) === '["terrain"]' && JSON.stringify(A(['city'], 'terrain', false)) === '["city","terrain"]' && JSON.stringify(A(['city', 'terrain'], 'city', true)) === '["terrain"]');
}

section('progress hooks (gen.js onTerrain, onStage)');
{
  const L = await import('./layout.js');
  const seen = [], fr = [];
  const base = { seed: 7, size: 'town', terrain: true };
  const a = await generate({ ...base, onTerrain: (p) => fr.push(p.frac), onStage: (k) => seen.push(k) });
  const b = await generate({ ...base });
  const order = seen.map((k) => L.STAGES.findIndex((s) => s[0] === k));
  check('onStage sends the city stages of layout.js STAGES in order', seen.join(',') === 'field,water,main,major,minor,blocks,lots' && order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), seen.join(','));
  check('onTerrain sends the terrain progress up to 1', fr.length > 3 && fr[fr.length - 1] === 1);
  const sig = (c) => JSON.stringify([c.roads, c.lots.length, c.buildings.slice(0, 50), c.sea.length]);
  check('the hooks do not change the city', sig(a) === sig(b));
  let cloneOk = true;
  try { structuredClone(a); } catch { cloneOk = false; }
  check('a city made with hooks can go through postMessage (no function in city.opts)', cloneOk && !('onStage' in a.opts) && !('onTerrain' in a.opts));
  // worker.js with a stand-in self: progress messages, then the city
  const posts = [];
  const hadSelf = 'self' in globalThis, oldSelf = globalThis.self;
  globalThis.self = { postMessage: (m) => posts.push(structuredClone(m)) };
  await import('./worker.js');
  await globalThis.self.onmessage({ data: { id: 3, type: 'gen', opts: { seed: 7, size: 'town', terrain: true } } });
  const prog = posts.filter((m) => m.progress), last = posts[posts.length - 1];
  check('worker.js posts progress for the terrain and each stage, then the city', prog.length >= 8 && prog.length < 80 && prog.every((m) => m.id === 3) && last.city && last.city.seed === 7 && sig(last.city) === sig(b), `${prog.length} progress messages`);
  if (hadSelf) globalThis.self = oldSelf; else delete globalThis.self;
}

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
  // The real nav registry and saver catalog: pageMark() walks them at start.
  // A hole in a nav group (a stray ",,") stopped start() before generate.
  const { readFileSync } = await import('node:fs');
  for (const f of ['../../lib/nav-data.js', '../../lib/screensaver-catalog.js']) {
    new Function(readFileSync(new URL(f, import.meta.url), 'utf8'))();
  }
  check('the real nav registry loads', Array.isArray(globalThis.SN_NAV) && globalThis.SN_NAV.length > 0);
  let err = null;
  try { await import('./main.js'); await globalThis.__mapGen.started; } catch (e) { err = e; }
  const g = globalThis.__mapGen;
  check('main.js loads and generates with stubs (no Worker: main-thread path)', !err && g && g.city && g.city.seed === 5, err ? err.message : `seed ${g.city.seed}, ${g.city.lots.length} lots`);
  check('the page starts the playback at t = 0', g && g.state.T === 0 && g.state.playing === true);
  // the saver hook: no WebGPU in node, so it falls back to the 2D map
  let ret = null, err2 = null;
  const labels = [];
  try { ret = await globalThis.snSaver.enter({ calm: 0.5, seed: 42, label: (x) => labels.push(x) }); } catch (e) { err2 = e; }
  check('snSaver.enter returns a canvas and a warm-up (2D without WebGPU)', !err2 && ret && ret.canvas && ret.warmupMs > 0 && g.state.view === '2d', err2 ? err2.message : `seed ${g.city.seed}`);
  check('snSaver.enter makes a new seeded city and plays it', g.state.playing === true && g.state.T === 0 && g.city.seed !== 5);
  let err3 = null;
  try { globalThis.snSaver.exit(); } catch (e) { err3 = e; }
  check('snSaver.exit runs', !err3);
}

section('worker path (a stand-in Worker that sends progress first)');
{
  // worker.js posts { id, progress } before the city. main.js must wait for
  // the city and show the progress, not take the first message as the answer.
  const types = [];
  globalThis.Worker = class {
    constructor() { this.onmessage = null; }
    postMessage(m) {
      types.push(m.type);
      const reply = (d) => this.onmessage && this.onmessage({ data: d });
      setTimeout(async () => {
        reply({ id: m.id, progress: { k: 'terrain', sub: 0.5 } });
        if (m.type !== 'gen') { reply({ id: m.id, error: 'no mesh here' }); return; }
        reply({ id: m.id, progress: { k: 'lots', sub: 0 } });
        const c = await generate({ ...m.opts });
        c.viaWorker = true;
        reply({ id: m.id, city: c });
      }, 0);
    }
  };
  globalThis.location = { hash: '#seed=11&size=town' };
  let err = null;
  try { await import('./main.js?worker'); await globalThis.__mapGen.started; } catch (e) { err = e; }
  const g = globalThis.__mapGen;
  check('main.js takes the city from the worker after its progress messages', !err && g.city && g.city.seed === 11 && g.city.viaWorker === true && types[0] === 'gen', err ? err.message : `viaWorker ${g.city && g.city.viaWorker}`);
  const bar = document.getElementById('loadBar').style.width, txt = document.getElementById('loadText').textContent;
  check('the progress goes to #loadText and #loadBar (layout.js progressShare)', txt === 'Lots' && bar === '93.0%', `${txt} ${bar}`);
  delete globalThis.Worker;
}

// ─── end ────────────────────────────────────────────────────────────────────
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

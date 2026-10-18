// ============================================================================
//  CORAL REEF  ·  tests/world.test.mjs  ·  the infinite world (node, no browser)
//    node tests/world.test.mjs [--quick]
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "i want to reimagine the coral reef
//  exploration region with the ROV's as an infinite procedurally generated
//  seafloor/seamount terrain". Checks of world/field.js and world/mesh.js:
//    determinism ... one seed gives the same heights, field values, sand,
//                    features and chunk meshes (bit for bit); a new seed
//                    gives a new world
//    bound ......... |sdf(a) - sdf(b)| <= lipschitz |a - b| on 5 cm steps
//                    near the surface (rock over the sand, and rock with
//                    sand), 3 seeds; the tile field (the one walkers, ROVs
//                    and the camera read) against the exact field
//    structure ..... seamounts (more than 35 m of relief in 4 km), sand
//                    plains, arches (a vertical ray: water, rock, water),
//                    pinnacles, canyons (a floor with rock walls both sides)
//    seams ......... two neighbour chunks (x and z) at LOD 0 and 1: every
//                    border vertex that both chunks make has the same
//                    position (1e-5 m) and normal; the union of the two
//                    meshes has no open edge in the border band (no
//                    edge there has one triangle only)
//    mesh .......... the mesh vertices are on the surface (|sdf| small);
//                    the sand grids of two chunks meet exactly
//    speed ......... chunk mesh times per LOD (printed; L0 under 4 s)
//    regions ....... shallows, reef, twilight, abyss and trenches exist at
//                    their depths, with no hard border, under the surface
// ============================================================================
import { createWorld, SDF_SCALE } from '../world/field.js';
import { meshRock, meshSand, meshChunk, chunkYRange, CH } from '../world/mesh.js';

const QUICK = process.argv.includes('--quick');
let pass = 0, fail = 0;
function ok(c, name, info = '') { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } }
const rng = (s) => { let a = s >>> 0 || 1; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; };
const fnv = (arr) => { let h = 2166136261; const u = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619); } return h >>> 0; };

// ── determinism ──────────────────────────────────────────────────────────────
{
  const A = createWorld({ seed: 7 }), B = createWorld({ seed: 7 }), C = createWorld({ seed: 8 });
  const r = rng(3);
  let same = true, diff = 0;
  for (let i = 0; i < 400; i++) {
    const x = (r() - 0.5) * 20000, z = (r() - 0.5) * 20000, y = A.height(x, z) + (r() - 0.5) * 4;
    if (A.height(x, z) !== B.height(x, z) || A.sdf(x, y, z) !== B.sdf(x, y, z) || A.sandAt(x, z) !== B.sandAt(x, z) || A.sdfExact(x, y, z) !== B.sdfExact(x, y, z)) same = false;
    if (Math.abs(A.height(x, z) - C.height(x, z)) > 0.5) diff++;
  }
  ok(same, 'determinism: heights, sand and the field match for one seed (400 points over 20 km)');
  ok(diff > 300, 'determinism: a new seed gives a new world', `${diff}/400 points differ by > 0.5 m`);
  const fa = JSON.stringify(A.features(1000, 1000, 120).map(f => [f.kind, f.center])), fb = JSON.stringify(B.features(1000, 1000, 120).map(f => [f.kind, f.center]));
  ok(fa === fb && fa.length > 2, 'determinism: the feature list matches', `${A.features(1000, 1000, 120).length} features`);
  const ma = meshRock(A, 5, -3, 0.5), mb = meshRock(createWorld({ seed: 7 }), 5, -3, 0.5);
  ok(ma && mb && fnv(ma.positions) === fnv(mb.positions) && fnv(ma.indices) === fnv(mb.indices), 'determinism: a chunk mesh is the same bit for bit', ma ? `${ma.tris} tris` : 'no mesh');
}

// ── the bound ────────────────────────────────────────────────────────────────
for (const seed of QUICK ? [1] : [1, 2, 3]) {
  const W = createWorld({ seed }), r = rng(seed * 11);
  const all = (x, y, z) => Math.min(W.sdfExact(x, y, z), W.sand.sdf(x, y, z));
  let wRock = 0, wAll = 0, n = 0;
  for (let i = 0; i < (QUICK ? 6000 : 12000); i++) {
    const x = r() * 4000, z = r() * 4000, h = Math.max(W.height(x, z), W.sandAt(x, z)) + (r() - 0.4) * 6;
    const d = [r() - 0.5, r() - 0.5, r() - 0.5], l = Math.hypot(...d), st = 0.05, q = [x + d[0] / l * st, h + d[1] / l * st, z + d[2] / l * st];
    const ga = Math.abs(all(x, h, z) - all(...q)) / st; if (ga > wAll) wAll = ga;
    if (h > W.sandAt(x, z) + 0.05) { const gr = Math.abs(W.sdfExact(x, h, z) - W.sdfExact(...q)) / st; if (gr > wRock) wRock = gr; }
    n++;
  }
  ok(wRock <= W.lipschitz && wAll <= W.lipschitz, `bound: seed ${seed}: the field changes by at most ${W.lipschitz} per m`, `rock ${wRock.toFixed(2)}, rock and sand ${wAll.toFixed(2)} (${n} steps)`);
}
{
  // the tile field (bilinear columns) against the exact field, near the surface
  const W = createWorld({ seed: 1 }), r = rng(5);
  let worst = 0;
  for (let i = 0; i < 3000; i++) {
    const x = 400 + r() * 64, z = 700 + r() * 64, y = Math.max(W.height(x, z), W.sandAt(x, z)) + (r() - 0.3) * 3;
    worst = Math.max(worst, Math.abs(W.sdf(x, y, z) - W.sdfExact(x, y, z)) / SDF_SCALE);
  }
  ok(worst < 0.25, 'bound: the tile field is within 0.25 m of the exact field', `worst ${worst.toFixed(3)} m`);
}

// ── structure ────────────────────────────────────────────────────────────────
{
  const W = createWorld({ seed: 1 }), r = rng(9);
  let lo = Infinity, hi = -Infinity, sand = 0, N = 4000;
  for (let i = 0; i < N; i++) { const x = r() * 4000, z = r() * 4000, h = W.height(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); if (W.sandAt(x, z) > h) sand++; }
  ok(hi - lo > 35, 'structure: seamounts and plains (relief over 4 km)', `${lo.toFixed(1)} .. ${hi.toFixed(1)} m`);
  ok(sand / N > 0.15 && sand / N < 0.75, 'structure: sand plains and rock', `sand ${(100 * sand / N).toFixed(0)} %`);
  // arches: a vertical ray under the arch top goes water, rock, water
  let arches = 0, under = 0, pins = 0;
  for (let j = 0; j < 14; j++) for (let i = 0; i < 14; i++) for (const f of W.cellFeatures(i, j)) {
    if (f.kind === 'pinnacle') { pins++; continue; }
    if (f.kind !== 'arch') continue;
    arches++;
    let pat = '', last = '';
    for (let y = f.ground + 0.3; y < f.top + 2; y += 0.05) { const s = W.sdfExact(f.x, y, f.z) < 0 ? 'R' : 'o'; if (s !== last) { pat += s; last = s; } }
    if (/^o+R+o/.test(pat)) under++;
  }
  ok(arches >= 20 && under >= arches * 0.6, 'structure: natural arches with open water under them', `${under} of ${arches} arches in 14 x 14 cells`);
  ok(pins >= 30, 'structure: pinnacles and hoodoos', `${pins}`);
  // canyons: a floor point with rock on both sides at 1.5 m over the floor
  let can = 0, walls = 0;
  for (let i = 0; i < 6000 && can < 40; i++) {
    const x = r() * 6000, z = r() * 6000, c = W.channel(x, z);
    if (c.mask < 0.8 || c.d > 0.6) continue;
    can++;
    const y = c.floor + 1.5, gx = c.gx, gz = c.gz;
    let side = 0;
    for (const s of [-1, 1]) { for (let t = 0.5; t < c.w + 6; t += 0.25) if (W.sdfExact(x + gx * t * s, y, z + gz * t * s) < 0) { side++; break; } }
    if (side === 2 && W.sdfExact(x, y, z) > 0) walls++;
  }
  ok(can >= 10 && walls >= can * 0.6, 'structure: canyons with open floors and rock walls on both sides', `${walls} of ${can}`);
}

// ── depth regions (CONTRACT-V4.md addendum) ─────────────────────────────────
{
  // the user: "reefs, shallows, twilight zone, absolute ocean depths"
  const W = createWorld({ seed: 1 }), r = rng(21), by = {};
  let jump = 0;
  for (let i = 0; i < (QUICK ? 1500 : 4000); i++) {
    const x = (r() - 0.5) * 120000, z = (r() - 0.5) * 120000, g = W.regionAt(x, z);
    (by[g.id] || (by[g.id] = [])).push(g.depth);
    jump = Math.max(jump, Math.abs(W.height(x + 0.5, z) - W.height(x - 0.5, z)));
  }
  const med = id => { const a = (by[id] || []).slice().sort((p, q) => p - q); return a.length ? a[a.length >> 1] : NaN; };
  const info = Object.keys(by).map(k => `${k} ${by[k].length} (median ${med(k).toFixed(0)} m)`).join(', ');
  ok(['shallows', 'reef', 'twilight', 'abyss', 'trench'].every(k => by[k] && by[k].length > 5), 'regions: shallows, reef, twilight, abyss and trenches all exist', info);
  ok(med('shallows') < 30 && med('reef') > 5 && med('reef') < 45 && med('twilight') > 40 && med('twilight') < 1100 && med('abyss') > 1000 && med('trench') > 3500, 'regions: their depths are the depths of the contract', info);
  ok(jump < 4, 'regions: no hard border (the ground changes by under 4 m over 1 m)', `${jump.toFixed(2)} m`);
  const top = Math.max(...Object.values(by).flat().map(d => -d));
  ok(top <= -1.4, 'regions: the ground stays under the sea surface', `shallowest ${(-top).toFixed(1)} m`);
  const a1 = W.regionAt(1234, -5678), a2 = createWorld({ seed: 1 }).regionAt(1234, -5678);
  ok(a1.id === a2.id && a1.depth === a2.depth, 'regions: one seed gives the same regions');
}

// ── seams ────────────────────────────────────────────────────────────────────
function borderCheck(W, cell, a, b, axis) {
  const ma = meshRock(W, a[0], a[1], cell), mb = meshRock(W, b[0], b[1], cell);
  if (!ma || !mb) return { ok: false, info: 'no mesh' };
  const ya = chunkYRange(W, a[0], a[1], cell), yb = chunkYRange(W, b[0], b[1], cell);
  const yLo = Math.max(ya[0], yb[0]) + 3 * cell, yHi = Math.min(ya[1], yb[1]) - 3 * cell;
  const B = axis === 0 ? b[0] * CH : b[1] * CH, ax = axis === 0 ? 0 : 2;
  const world = (m, c) => { const out = []; const cx = (c[0] + 0.5) * CH, cz = (c[1] + 0.5) * CH; for (let v = 0; v < m.verts; v++) out.push([m.positions[v * 3] + cx, m.positions[v * 3 + 1], m.positions[v * 3 + 2] + cz]); return out; };
  const Pa = world(ma, a), Pb = world(mb, b);
  // surface nets: one vertex per lattice cell, inside the cell: the cell
  // index is the key of a vertex
  const key = p => `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`;
  const shared = p => p[ax] < B && p[ax] > B - cell;        // the cells that both chunks make
  const map = new Map();
  Pa.forEach((p, v) => { if (shared(p)) map.set(key(p), v); });
  let match = 0, perr = 0, nerr = 0;
  Pb.forEach((p, v) => {
    if (!shared(p)) return;
    const u = map.get(key(p)); if (u === undefined) return;
    match++;
    perr = Math.max(perr, Math.hypot(Pa[u][0] - p[0], Pa[u][1] - p[1], Pa[u][2] - p[2]));
    nerr = Math.max(nerr, Math.hypot(ma.normals[u * 3] - mb.normals[v * 3], ma.normals[u * 3 + 1] - mb.normals[v * 3 + 1], ma.normals[u * 3 + 2] - mb.normals[v * 3 + 2]));
  });
  // the union, welded by cell: edges in the border band have two triangles
  const ids = new Map(), weld = p => { const k = key(p); let i = ids.get(k); if (i === undefined) { i = ids.size; ids.set(k, i); } return i; };
  const Wa = Pa.map(weld), Wb = Pb.map(weld), pos = new Map();
  Pa.forEach((p, v) => pos.set(Wa[v], p)); Pb.forEach((p, v) => pos.set(Wb[v], p));
  const edges = new Map();
  const addTris = (m, Wm) => { const I = m.indices; for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const u = Wm[I[t + e]], w = Wm[I[t + (e + 1) % 3]]; const k = u < w ? `${u},${w}` : `${w},${u}`; edges.set(k, (edges.get(k) || 0) + 1); } };
  addTris(ma, Wa); addTris(mb, Wb);
  // the band: within 1.5 cells of the border, away from the ends of the
  // border line and from the y ends of the two lattices
  const other = axis === 0 ? 2 : 0, o0 = (axis === 0 ? a[1] : a[0]) * CH;
  let open = 0, band = 0, multi = 0;
  for (const [k, n] of edges) {
    const [u, w] = k.split(',').map(Number), p = pos.get(u), q = pos.get(w);
    if (Math.abs(p[ax] - B) > cell * 1.5 || Math.abs(q[ax] - B) > cell * 1.5) continue;
    if (p[other] < o0 + 2 || p[other] > o0 + CH - 2) continue;
    if (Math.min(p[1], q[1]) < yLo || Math.max(p[1], q[1]) > yHi) continue;
    band++;
    // one triangle: a hole. More than two: a non-manifold edge of thin
    // rock at a coarse cell (surface nets make those inside a chunk too)
    if (n === 1) open++; else if (n > 2) multi++;
  }
  return { ok: match > 20 && perr < 1e-5 && nerr < 1e-5 && open === 0 && band > 50, info: `${match} shared vertices, position error ${perr.toExponential(1)} m, normal error ${nerr.toExponential(1)}, ${band} band edges, ${open} open, ${multi} non-manifold` };
}
{
  const W = createWorld({ seed: 1, fine: 0.6 });
  for (const [cell, lod] of [[0.4, 0], [0.8, 1]]) {
    const rx = borderCheck(W, cell, [12, 4], [13, 4], 0);
    ok(rx.ok, `seams: LOD ${lod} (cell ${cell} m), chunks 12,4 | 13,4 along x`, rx.info);
    const rz = borderCheck(W, cell, [-3, 7], [-3, 8], 2);
    ok(rz.ok, `seams: LOD ${lod} (cell ${cell} m), chunks -3,7 | -3,8 along z`, rz.info);
  }
  // sand grids meet exactly
  const sa = meshSand(W, 12, 4, 0.8), sb = meshSand(W, 13, 4, 0.8);
  let m = 0, e = 0;
  if (sa && sb) {
    const N = Math.round(CH / 0.8) + 1;
    for (let k = 0; k < N; k++) {
      const va = k * N + N - 1, vb = k * N;                       // right column of a, left column of b
      const xa = sa.positions[va * 3] + 12.5 * CH, xb = sb.positions[vb * 3] + 13.5 * CH;
      e = Math.max(e, Math.abs(xa - xb), Math.abs(sa.positions[va * 3 + 1] - sb.positions[vb * 3 + 1]), Math.abs(sa.positions[va * 3 + 2] - sb.positions[vb * 3 + 2]));
      m++;
    }
  }
  ok(m > 20 && e < 1e-5, 'seams: the sand grids of two chunks share their border vertices', `${m} vertices, error ${e.toExponential(1)} m`);
}

// ── mesh on the surface, and speed ──────────────────────────────────────────
{
  const W = createWorld({ seed: 2, fine: 1 });
  const r = meshChunk(W, 9, 9, 0, 0.25);
  let worst = 0;
  if (r.rock) for (let v = 0; v < r.rock.verts; v += 7) { const x = r.rock.positions[v * 3] + 9.5 * CH, y = r.rock.positions[v * 3 + 1], z = r.rock.positions[v * 3 + 2] + 9.5 * CH; worst = Math.max(worst, Math.abs(W.sdfExact(x, y, z)) / SDF_SCALE); }
  ok(r.rock && worst < 0.25, 'mesh: the vertices are on the surface of the field', `worst ${worst.toFixed(3)} m over ${r.rock ? r.rock.verts : 0} vertices`);
  const times = [];
  for (const [lod, c0] of [[0, 0.25], [1, 0.25], [2, 0.25], [0, 0.4], [1, 0.4]]) {
    const W2 = createWorld({ seed: 2, fine: Math.min(1, 0.25 / (c0 * (1 << lod))) });
    const m = meshChunk(W2, 3, 11, lod, c0);
    times.push(`c0 ${c0} L${lod}: ${m.ms.toFixed(0)} ms, ${m.rock ? m.rock.tris : 0} + ${m.sand ? m.sand.tris : 0} tris, ${(m.bytes / 1048576).toFixed(2)} MB`);
    if (lod === 0 && c0 === 0.25) ok(m.ms < 4000, 'speed: a desktop LOD 0 chunk meshes in under 4 s (one thread)', `${m.ms.toFixed(0)} ms`);
  }
  console.log('     ' + times.join('\n     '));
}

console.log(`world: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

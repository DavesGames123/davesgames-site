// tests/ground.test.mjs — GROUND package checks (node, no GPU, no browser).
// Run alone: node stella-nova/pages/dla-terrain/tests/ground.test.mjs
// CORE's tests.mjs also runs every file in tests/.
//
// What it checks: the CDLOD set-up rules, the min / max pyramid, that the
// selected nodes tile the world with no gap and no overlap, that every seam
// between two nodes has the same vertices on both sides after the morph
// (no cracks, no T-junctions) for many random cameras, frustum planes, the
// grid winding, the manifest texture match, static WGSL rules (Tint
// rejects unparenthesised mixed && / || and mixed * / ^), the hex tiling
// weights (sum 1), the POM step bounds, the GroundU size and the GPU
// memory model of the ground sets and surface fields.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  lodConfig, buildMinMax, nodeBounds, selectNodes, morphVertex, gridIndices,
  frustumPlanes, groundLayerMap, groundRecords, LAYERS, SKIP_SETS,
  fitLapse, farRingParams, farRingMesh,
  hexWeights, pomSteps, POM_MAX, effectUniforms, rockUniforms, U_FLOATS, MAX_SETS,
} from '../render/ground.js';
import { estimate, PROFILES, GROUND_SETS, MB } from '../gpu/budget.js';

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} ground: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} ground: ${name} ${extra}`); }
}

// deterministic random
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// ---- a height field over a 16 km world
const W = 16384, origin = -W / 2, n = 257;
const hf = (x, z) => 600 * Math.sin(x / 1900) * Math.cos(z / 1400) + 250 * Math.sin((x + z) / 600) + 900;
const height = new Float32Array(n * n);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) height[j * n + i] = hf(origin + (i + 0.5) * W / n, origin + (j + 0.5) * W / n);
const mm = buildMinMax(height, n);

// ---- lodConfig rules
for (const q of [0.2, 0.6, 1.0]) {
  const c = lodConfig(W, q);
  let good = c.levels >= 2 && Number.isFinite(c.ranges[0]);
  for (let i = 0; i < c.levels; i++) {
    const size = c.leaf * 2 ** i;
    if (!(c.mStart[i] < c.mEnd[i])) good = false;
    if (i > 0 && c.mStart[i] < c.ranges[i - 1] + 1.6 * size / 2 - 1e-6) good = false;
    if (i < c.levels - 1 && c.ranges[i] < 2 * size) good = false;
  }
  ok(good, `lodConfig q=${q}: N ${c.N}, leaf ${c.leaf.toFixed(2)} m, ${c.levels} levels, morph start past the finer level`);
}

// ---- min / max pyramid against brute force
{
  let good = true;
  const b = [0, 0];
  for (let t = 0; t < 200; t++) {
    const size = W / 2 ** Math.floor(rnd() * 8);
    const x0 = origin + Math.floor(rnd() * (W / size)) * size, z0 = origin + Math.floor(rnd() * (W / size)) * size;
    nodeBounds(mm, origin, W, x0, z0, size, b);
    let lo = Infinity, hi = -Infinity;
    const tex = W / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const cx = origin + (i + 0.5) * tex, cz = origin + (j + 0.5) * tex;
      if (cx >= x0 && cx <= x0 + size && cz >= z0 && cz <= z0 + size) { lo = Math.min(lo, height[j * n + i]); hi = Math.max(hi, height[j * n + i]); }
    }
    if (lo !== Infinity && (b[0] > lo + 1e-3 || b[1] < hi - 1e-3)) { good = false; break; }
  }
  ok(good, 'nodeBounds contains the true height range of 200 random nodes');
}

// ---- tiling and seams
function seamCheck(cfg, cam, label) {
  const hTop = mm.levels[mm.levels.length - 1].data[1] + 12;
  const s = selectNodes({ cfg, cam, origin, mm, pad: 12, hTop, planes: null });
  const nodes = [];
  for (let k = 0; k < s.count; k++) nodes.push(Array.from(s.out.subarray(k * 8, k * 8 + 8)));
  // tiling: area sum and no overlap (sweep on a coarse test grid)
  let area = 0;
  for (const a of nodes) area += a[2] * a[2];
  const tileOK = Math.abs(area - W * W) / (W * W) < 1e-9;
  let overlap = false;
  for (let i = 0; i < nodes.length && !overlap; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const ox = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
      const oz = Math.min(a[1] + a[2], b[1] + b[2]) - Math.max(a[1], b[1]);
      if (ox > 1e-6 && oz > 1e-6) { overlap = true; break; }
    }
  }
  // seams
  const wMin = origin, wMax = origin + W;
  const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const edgePts = (a, axis, value, lo, hi) => {
    const N = a[3], sp = a[2] / N, set = new Set();
    for (let t = 0; t <= N; t++) {
      const gx = axis === 'x' ? Math.round((value - a[0]) / sp) : t;
      const gz = axis === 'x' ? t : Math.round((value - a[1]) / sp);
      const x = a[0] + gx * sp, z = a[1] + gz * sp;
      const along = axis === 'x' ? z : x;
      if (along < lo - 1e-6 || along > hi + 1e-6) continue;
      set.add(key(morphVertex(gx, gz, a, cam, hTop, wMin, wMax)));
    }
    return set;
  };
  let seams = 0, bad = 0, firstBad = '';
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const a = nodes[i], b = nodes[j];
      // a's right edge on b's left edge, or a's top edge on b's bottom edge
      for (const axis of ['x', 'z']) {
        const ai = axis === 'x' ? 0 : 1, oi = axis === 'x' ? 1 : 0;
        if (Math.abs(a[ai] + a[2] - b[ai]) > 1e-6) continue;
        const lo = Math.max(a[oi], b[oi]), hi = Math.min(a[oi] + a[2], b[oi] + b[2]);
        if (hi - lo <= 1e-6) continue;
        seams++;
        const v = a[ai] + a[2];
        const pa = edgePts(a, axis, v, lo, hi), pb = edgePts(b, axis, v, lo, hi);
        let same = pa.size === pb.size;
        if (same) for (const p of pa) if (!pb.has(p)) { same = false; break; }
        if (!same) { bad++; if (!firstBad) firstBad = `levels ${a[6]}/${b[6]} sizes ${a[2]}/${b[2]} (${pa.size} vs ${pb.size} pts)`; }
      }
    }
  }
  return { tileOK, overlap, seams, bad, firstBad, count: s.count, full: s.full, half: s.half, label };
}

for (const q of [1.0, 0.3]) {
  const cfg = lodConfig(W, q);
  let tiles = true, cracks = 0, seams = 0, first = '', counts = [];
  for (let t = 0; t < 24; t++) {
    const x = origin + rnd() * W, z = origin + rnd() * W;
    const y = hf(x, z) + 2 + rnd() * (t % 3 === 0 ? 3000 : 120);
    const r = seamCheck(cfg, [x, y, z], `cam ${t}`);
    if (!r.tileOK || r.overlap) tiles = false;
    cracks += r.bad; seams += r.seams; counts.push(r.count);
    if (r.bad && !first) first = r.firstBad;
  }
  ok(tiles, `q=${q}: selected nodes tile the world with no gap or overlap (24 cameras, ${Math.min(...counts)}..${Math.max(...counts)} patches)`);
  ok(cracks === 0, `q=${q}: ${seams} seams, ${cracks} with a crack after the morph`, first);
}
// the shadow list (ranges x 0.55) keeps the same rule
{
  const cfg = lodConfig(W, 1, false, 0.55);
  let cracks = 0, seams = 0, first = '';
  for (let t = 0; t < 12; t++) {
    const x = origin + rnd() * W, z = origin + rnd() * W;
    const r = seamCheck(cfg, [x, hf(x, z) + 30, z], `sh ${t}`);
    cracks += r.bad; seams += r.seams; if (r.bad && !first) first = r.firstBad;
  }
  ok(cracks === 0, `shadow LOD: ${seams} seams, ${cracks} with a crack`, first);
}

// ---- morph: fully morphed odd vertices land on even ones
{
  const inst = [0, 0, 64, 32, 0, 1, 0, 0];
  const far = [1e6, 0, 0];
  const p = morphVertex(3, 5, inst, far, 0, -1e9, 1e9);
  ok(p[2] === 1 && p[0] === 4 && p[1] === 8, 'morph k = 1 moves vertex (3, 5) onto (2, 4)', JSON.stringify(p));
  const near = morphVertex(3, 5, [0, 0, 64, 32, 1e5, 2e5, 0, 0], [0, 0, 0], 0, -1e9, 1e9);
  ok(near[2] === 0 && near[0] === 6 && near[1] === 10, 'morph k = 0 keeps the vertex', JSON.stringify(near));
}

// ---- frustum planes: a camera at the origin looking down -z
{
  const f = 1 / Math.tan(Math.PI / 6), a = 16 / 9, nr = 0.1;
  // reverse-Z infinite perspective (column-major), view = identity
  const m = new Float32Array([f / a, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, nr, 0]);
  const pl = frustumPlanes(m);
  const inside = (x, y, z) => pl.every((p) => p[0] * x + p[1] * y + p[2] * z + p[3] >= 0);
  ok(inside(0, 0, -50) && !inside(0, 0, 50) && !inside(500, 0, -50) && inside(0, 0, -1e6), 'frustum planes: front in, behind and side out, far in (infinite)');
}

// ---- grid winding
{
  const N = 8, idx = gridIndices(N);
  let pos = 0, neg = 0;
  for (let k = 0; k < idx.length; k += 3) {
    const p = [idx[k], idx[k + 1], idx[k + 2]].map((v) => [v % (N + 1), Math.floor(v / (N + 1))]);
    // y of (b - a) x (c - a) with x -> x, z -> z
    const cy = (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]) - (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]);
    if (cy > 0) pos++; else if (cy < 0) neg++;
  }
  ok(neg === 0 && pos === N * N * 2, `grid ${N}: ${pos} triangles, all with +y normals`);
}

// ---- ASSETS ground sets -> logical layers
{
  const manPath = fileURLToPath(new URL('../../../assets/nature/manifest.json', import.meta.url));
  let man = null;
  try { man = JSON.parse(readFileSync(manPath, 'utf8')); } catch { man = null; }
  if (man) {
    const all = groundRecords(man);
    const recs = all.filter((r) => !SKIP_SETS.has(r.id));
    const m = groundLayerMap(recs);
    const name = (k) => (k === 255 ? 'none' : recs[k].id);
    const prim = LAYERS.map((l, i) => `${l}=${name(m.map[i])}`).join(' ');
    // every layer has a set, except a layer whose only set is in SKIP_SETS
    const allSet = [...m.map.slice(0, 8)].every((k, l) => k !== 255 || (l === 6 && all.some((r) => SKIP_SETS.has(r.id))));
    ok(recs.length >= 8 && allSet && name(m.map[2]) === 'ground_grass' && name(m.map[10]) === 'ground_dry_grass' && name(m.map[1]) === 'ground_cliff' && m.meadow !== 255,
      `groundLayerMap on the ASSETS manifest (${recs.length} sets): every layer has a set (skipped: ${[...SKIP_SETS].join(', ')})`, prim);
    ok(m.rsets.length === 4 && [...m.rsets].every((k) => k !== 255) && name(m.map[6]) === 'ground_stony_soil',
      `groundLayerMap: the layered, blocky, outcrop and stony sets are found (${[...m.rsets].map(name).join(', ')}), stony soil is the bare-soil set`);
    ok([...m.tiles.slice(0, recs.length)].every((t, k) => t === Math.fround(recs[k].tile)), 'groundLayerMap keeps the tile size of each set');
  } else {
    ok(true, 'groundLayerMap: no ASSETS manifest yet (skipped)');
  }
  const none = groundLayerMap([]);
  ok([...none.map].every((k) => k === 255) && groundRecords(null).length === 0, 'groundLayerMap with no sets maps every layer to none (procedural only)');
  const part = groundLayerMap([{ id: 'x_rock', tile: 3 }]);
  ok(part.map[0] === 0 && part.map[1] === 0 && part.map[2] === 255, 'a missing cliff set falls back to rock');
}

// ---- static WGSL rules
{
  const src = readFileSync(fileURLToPath(new URL('../shaders/ground.wgsl', import.meta.url)), 'utf8');
  const code = src.split('\n').map((l) => l.replace(/\/\/.*$/, ''));
  // a line with both && and || must have each group in parentheses: flag
  // lines where && and || sit at the same parenthesis depth
  const mixed = (line, a, b) => {
    let depth = 0; const seen = {};
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '(') depth++; else if (c === ')') depth--;
      else {
        const two = line.slice(i, i + a.length);
        if (two === a) (seen[depth] ||= new Set()).add('a');
        const tw = line.slice(i, i + b.length);
        if (tw === b) (seen[depth] ||= new Set()).add('b');
      }
    }
    return Object.values(seen).some((s) => s.size > 1);
  };
  const bad = code.map((l, i) => [l, i + 1]).filter(([l]) => mixed(l, '&&', '||') || (/\^/.test(l) && mixed(l.replace(/\*\*/g, ''), '*', '^')));
  ok(bad.length === 0, 'ground.wgsl: no unparenthesised mixed && / || or * / ^', bad.map(([, n]) => n).join(','));
  const falling = [...src.matchAll(/smoothstep\(\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*,/g)].filter((m) => +m[1] >= +m[2]).map((m) => m[0]);
  ok(falling.length === 0, 'ground.wgsl: no smoothstep with falling or equal edges (undefined on Metal)', falling.join(' '));
  ok(/fn vs\(/.test(src) && /fn vsShadow\(/.test(src) && /fn vsRing\(/.test(src) && /fn fs\(/.test(src), 'ground.wgsl has the vs, vsShadow, vsRing and fs entry points');
  ok(!/@group\(0\)/.test(src), 'ground.wgsl declares no group 0 binding (common.wgsl owns group 0)');
}

// ---- the climate snow line fit and the far ring
{
  const N = 4096, h = new Float32Array(N), T = new Float32Array(N);
  for (let i = 0; i < N; i++) { h[i] = (i % 64) * 50; T[i] = 8.2 - 0.0064 * h[i] + ((i * 7919) % 13 - 6) * 0.01; }
  const f = fitLapse(h, T);
  ok(f[2] === 1 && Math.abs(f[0] - 8.2) < 0.05 && Math.abs(f[1] + 0.0064) < 1e-4, 'fitLapse recovers T = a + b h', f.join(','));
  // the snow line for summer (-7 C): (tSnow - a) / b, as in ground.wgsl
  const line = (-7 - f[0]) / f[1];
  ok(line > 2300 && line < 2450, 'the summer snow line of an alpine fit lies near 2.4 km', line.toFixed(0));
  const flat = fitLapse(new Float32Array(100).fill(5), new Float32Array(100).fill(3));
  ok(flat[2] === 0, 'fitLapse: a flat world gives no fit');
  const dry = farRingParams({ worldSize: 20000, seaLevel: -100 }, 5, 3400);
  const wet = farRingParams({ worldSize: 20000, seaLevel: 0 }, -180, 1400);
  ok(dry[0] > 5 && dry[2] > 0, 'far ring: a world with no sea gets a low land floor with relief', dry.join(','));
  ok(wet[0] < 0 && wet[2] === 0, 'far ring: a world with a sea sinks the ring under the sea', wet.join(','));
  const M = 32, K = 8, g = farRingMesh(20000, M, K);
  const P = 4 * M, R = K + 3;   // skirt, edge, K rings, the flat band to 2000 km
  ok(g.pos.length === R * P * 3 && g.idx.length === (R - 1) * P * 6, 'far ring mesh: vertex and index counts');
  let inside = 0, maxIdx = 0, onEdge = 0;
  for (let v = 0; v < R * P; v++) {
    const x = g.pos[v * 3], z = g.pos[v * 3 + 1], c = Math.max(Math.abs(x), Math.abs(z));
    if (c < 10000 - 1e-3) inside++;
    if (Math.abs(c - 10000) < 1e-3 && g.pos[v * 3 + 2] === 0) onEdge++;
  }
  for (const i of g.idx) maxIdx = Math.max(maxIdx, i);
  ok(inside === P && onEdge === P && maxIdx < R * P, 'far ring mesh: one skirt ring inside, one ring on the world edge', `${inside} ${onEdge}`);
  ok(Math.abs(g.pos[(R - 1) * P * 3 + 1]) >= 2e6, 'far ring mesh: the last ring is 2000 km out (the land reaches the horizon)');
}

// ---- hex tiling: the weights of the three hex vertices (ground.wgsl fn
// hexGrid + fn hexSharp) sum to 1 and are not negative, everywhere
{
  let worstB = 0, worstW = 0, neg = 0, same = 0;
  for (let t = 0; t < 20000; t++) {
    const u = (rnd() - 0.5) * 400, v = (rnd() - 0.5) * 400;
    const lum = [rnd(), rnd(), rnd()];
    const h = hexWeights(u, v, lum);
    worstB = Math.max(worstB, Math.abs(h.base[0] + h.base[1] + h.base[2] - 1));
    worstW = Math.max(worstW, Math.abs(h.w[0] + h.w[1] + h.w[2] - 1));
    if (Math.min(...h.base) < -1e-5 || Math.min(...h.w) < 0) neg++;
    const k = h.verts.map((q) => q.join(','));
    if (new Set(k).size !== 3) same++;
  }
  ok(worstB < 1e-5 && worstW < 1e-9 && neg === 0 && same === 0, `hex tiling: barycentric and sharpened weights sum to 1 (worst ${worstB.toExponential(1)}, ${worstW.toExponential(1)}), none negative, three distinct vertices (20000 points)`);
  // at a hex vertex one weight is 1: the uv of the vertex shows alone
  const h0 = hexWeights(0, 0);
  ok(Math.max(...h0.w) > 0.999, 'hex tiling: a lattice vertex takes all of the weight');
  const src = readFileSync(fileURLToPath(new URL('../shaders/ground.wgsl', import.meta.url)), 'utf8');
  ok(/uv \* 3\.4641016/.test(src) && /0\.57735027 \* st\.y/.test(src) && /1\.15470054 \* st\.y/.test(src) && /vec3f\(0\.6\)\)/.test(src),
    'fn hexGrid / fn hexSharp use the constants of hexWeights');
  ok(/max\(w, vec3f\(0\.0\)\) \* pow\(/.test(src), 'fn hexSharp clamps the weights before pow() (pow of a negative is NaN in WGSL)');
}

// ---- POM: the step count is bounded, ends at the range and is off on a
// phone profile and at low quality (ground.wgsl fn pomSteps)
{
  const fx = effectUniforms(1, false, 64);
  let maxS = 0, mono = true, beyond = 0;
  for (let ndv = 0; ndv <= 1.0001; ndv += 0.05) {
    let prev = Infinity;
    for (let d = 0; d < 120; d += 0.5) {
      const n = pomSteps(d, ndv, fx);
      maxS = Math.max(maxS, n);
      if (n > prev) mono = false;
      if (d >= fx[2] && n !== 0) beyond++;
      prev = n;
    }
  }
  ok(maxS <= POM_MAX && maxS >= 12 && mono && beyond === 0, `POM: at most ${POM_MAX} steps (max ${maxS}), no more steps farther away, none past ${fx[2]} m`);
  ok(pomSteps(5, 0.2, effectUniforms(1, true, 64)) === 0 && pomSteps(5, 0.2, effectUniforms(0.5, false, 64)) === 0, 'POM: off on a phone profile and at quality 0.5 (the cheap path)');
  const v = effectUniforms(1, false, 64);
  ok(v[1] === 1 && v[3] <= 64 * 0.85 && effectUniforms(0.75, false, 64)[1] === 0 && effectUniforms(1, true, 64)[1] === 0, 'vertex relief: on from quality 0.8 on desktop, inside the LOD 0 range, off on a phone');
  const src = readFileSync(fileURLToPath(new URL('../shaders/ground.wgsl', import.meta.url)), 'utf8');
  ok(new RegExp(`const POM_MAX: i32 = ${POM_MAX};`).test(src), 'fn pomSteps and pomSteps share POM_MAX');
}

// ---- GroundU: the WGSL struct size is U_FLOATS; the uniforms fit
{
  const src = readFileSync(fileURLToPath(new URL('../shaders/ground.wgsl', import.meta.url)), 'utf8');
  const body = src.slice(src.indexOf('struct GroundU {'), src.indexOf('};', src.indexOf('struct GroundU {')));
  let floats = 0;
  for (const m of body.matchAll(/:\s*(vec4f|array<vec4f,\s*(\d+)>)/g)) floats += m[2] ? 4 * +m[2] : 4;
  ok(floats === U_FLOATS, `struct GroundU is ${floats} floats, ground.js U_FLOATS ${U_FLOATS}`);
  const r = rockUniforms(null);
  ok(r.length === 4 && Math.abs(Math.hypot(r[0], r[1]) - 1) < 1e-6 && r[2] > 0, 'rockUniforms: a unit joint direction and a bed spacing with no fields');
}

// ---- the GPU memory model (gpu/budget.js) has the ground sets the
// module loads and the surface fields; every profile stays in its budget
{
  const manPath = fileURLToPath(new URL('../../../assets/nature/manifest.json', import.meta.url));
  let man = null;
  try { man = JSON.parse(readFileSync(manPath, 'utf8')); } catch { man = null; }
  const used = man ? Math.min(groundRecords(man).filter((r) => !SKIP_SETS.has(r.id)).length, MAX_SETS) : GROUND_SETS;
  ok(GROUND_SETS === used, `budget: GROUND_SETS ${GROUND_SETS} = the sets ground.js loads (${used})`);
  const d = estimate(PROFILES.desktop, { cssW: 1280, cssH: 800, qualityIndex: 3, n: 1024 });
  const exp = 1024 * 1024 * 16 * 4 * 3 * (4 / 3) + 2 * 6144 * 32;
  ok(Math.abs(d.parts.ground - exp) < 1 && d.parts.groundSurface === 1024 * 1024 * 16, `budget: desktop High ground ${(d.parts.ground / MB).toFixed(0)} MB + surface fields ${(d.parts.groundSurface / MB).toFixed(0)} MB`);
  for (const id of ['phone', 'phone-min']) {
    const e = estimate(PROFILES[id], { cssW: 390, cssH: 844, qualityIndex: 0, n: 1024 });
    const sm = Math.min(PROFILES[id].maxN, 512);
    ok(e.parts.groundSurface === sm * sm * 16 && e.peak < e.budget, `budget: ${id} surface fields ${(e.parts.groundSurface / MB).toFixed(0)} MB, peak ${(e.peak / MB).toFixed(0)} MB under ${(e.budget / MB).toFixed(0)} MB`);
  }
  // (the desktop profile has no caps: its model total is a report, not a
  // limit; the four rock and soil sets add 4 x 16.8 MB at 1024)
  console.log(`# desktop 1280x800 High: ground ${(d.parts.ground / MB).toFixed(0)} MB of ${(d.total / MB).toFixed(0)} MB (peak ${(d.peak / MB).toFixed(0)} MB)`);
}

console.log(`# ground: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
export default { pass, fail };

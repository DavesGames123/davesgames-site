// tests/ground.test.mjs — GROUND package checks (node, no GPU, no browser).
// Run alone: node stella-nova/pages/dla-terrain/tests/ground.test.mjs
// CORE's tests.mjs also runs every file in tests/.
//
// What it checks: the CDLOD set-up rules, the min / max pyramid, that the
// selected nodes tile the world with no gap and no overlap, that every seam
// between two nodes has the same vertices on both sides after the morph
// (no cracks, no T-junctions) for many random cameras, frustum planes, the
// grid winding, the manifest texture match, and static WGSL rules (Tint
// rejects unparenthesised mixed && / || and mixed * / ^).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  lodConfig, buildMinMax, nodeBounds, selectNodes, morphVertex, gridIndices,
  frustumPlanes, matchGroundTextures, LAYERS,
} from '../render/ground.js';

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

// ---- ASSETS manifest match
{
  const man = {
    assets: [
      { id: 'rock_face_03', kind: 'ground texture', files: { albedo: 'tex/rock_diff.webp', normal: 'tex/rock_nor.webp', orm: 'tex/rock_arm.webp' } },
      { id: 'forest_leaves_02', kind: 'ground texture', files: { albedo: 'tex/fl_diff.webp', normal: 'tex/fl_nor.webp' } },
      { id: 'aerial_grass_rock', kind: 'ground texture', files: { diffuse: 'tex/g_diff.webp' } },
      { id: 'pine_01', kind: 'tree', files: { lod0: 'pine.glb' } },
    ],
  };
  const m = matchGroundTextures(man);
  const by = Object.fromEntries(m.map((e) => [LAYERS[e.layer], e.id]));
  ok(by.rock === 'rock_face_03' && by['forest floor'] === 'forest_leaves_02' && by.grass === 'aerial_grass_rock' && by.cliff === 'rock_face_03' && m.length === 4,
    'matchGroundTextures maps rock, forest floor, grass, and cliff to rock', JSON.stringify(by));
  ok(matchGroundTextures(null).length === 0 && matchGroundTextures({ assets: [] }).length === 0, 'matchGroundTextures with no manifest gives no layers');
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
  ok(/fn vs\(/.test(src) && /fn vsShadow\(/.test(src) && /fn fs\(/.test(src), 'ground.wgsl has the vs, vsShadow and fs entry points');
  ok(!/@group\(0\)/.test(src), 'ground.wgsl declares no group 0 binding (common.wgsl owns group 0)');
}

console.log(`# ground: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
export default { pass, fail };

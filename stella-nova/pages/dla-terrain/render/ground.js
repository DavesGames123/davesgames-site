// ============================================================================
//  DLA TERRAIN  ·  render/ground.js — the terrain surface (GROUND package)
// ----------------------------------------------------------------------------
//  createGround(gpu) -> module (CONTRACT.md "Module interface").
//
//  MESH  CDLOD (Strugar 2010, "Continuous Distance-Dependent Level of Detail
//  for Rendering Heightmaps"). One quadtree over the whole world. Each frame
//  update() selects nodes by distance spheres: a node of level i is drawn
//  where it is inside range r[i] and out of r[i-1]. A node that is partly
//  inside r[i-1] recurses; a child quadrant that the finer level does not
//  take is drawn at the parent resolution (a half grid). All patches share
//  one index buffer per grid size; the vertex shader (ground.wgsl fn vs)
//  morphs the odd vertices onto the even ones as the camera distance goes
//  from morph start to morph end. Morph start of level i is past the far
//  edge of any level i-1 node (r[i-1] + 1.6 node size), so at a level seam
//  the fine side is fully morphed and the coarse side is not morphed: no
//  cracks and no T-junctions. tests/ground.test.mjs checks this on random
//  cameras with the JS twin of the vertex shader (morphVertex).
//  Node height bounds come from a min / max pyramid of Terrain.height plus a
//  pad for detailHeight. Frustum culling uses the planes of G.viewProj.
//  The shadow pass draws its own node list (no frustum cull, ranges at
//  0.55 of the view ranges, within the shadow distance): coarser, and
//  crack-free by the same rule.
//
//  MATERIAL  shaders/ground.wgsl. The ASSETS ground sets (manifest kind
//  "ground texture", gpu.assets.loadGround) load into three texture arrays
//  (albedo, normal, ORM with height in b) with mips, at 256, 512 or 1024 by
//  quality. groundLayerMap gives each of the eight logical layers of the
//  shader a primary and an alternate set (grass / dry grass / meadow,
//  forest floor / pine floor, sand / desert, rock / scree, ...). Until the
//  sets load, the procedural layers draw alone.
//
//  Shadows: CORE owns the cascaded map (gpu/shadows.js) and sets group 2
//  on the pass: gpu.shadowSampleLayout for drawOpaque (common.wgsl fn
//  sunShadow), gpu.shadowPassLayout (SP, one cascade) for drawShadow. The
//  height-field march in ground.wgsl adds long ridge shadows past the
//  cascades.
//
//  FAR RING  farRingMesh: square rings round the world out to max(5 x
//  world, 80 km) past the edge, drawn after the CDLOD mesh with the same
//  fs (ground.wgsl fn vsRing). Past the edge the shader mirrors the world
//  (fn foldXZ) and flattens it over farRingParams' fade length to a low
//  floor (no sea) or under the sea (a world with a sea), so no cut edge
//  shows. A skirt ring 200 m down hides the seam. setFarRing(on).
//
//  SNOW LINE  fitLapse fits T = a + b h to Terrain.temperature on each
//  final terrain; ground.wgsl puts the snow line where T falls to the
//  season's limit (-7 C summer, +1 C winter), lowered by G.weather2.y.
//
//  SURFACE  render/surface-sim.js derives material fields from the history
//  of each final terrain (bedrock and regolith, scree, alluvium, wet banks,
//  snow drift and cornices, exposure age, playa, strata warp, glacial
//  polish, erosion scars, the D8 drainage field). startSurface runs it in
//  render/surface-worker.js (or on this thread with pauses), applySurface
//  uploads the 4 layers as one rgba8unorm 2D array (group 1 binding 7) and
//  sets U.surf / U.geo / U.geo2 (surfaceUniforms). Until then, and while a
//  new terrain forms, U.surf.x = 0 and the shader keeps its slope rules.
//  The grid is min(n, 1024), 512 on Low and phones (4 MB). setSurface(on)
//  and surfaceReady() are for tests and debug views 7 to 9.
//
//  grep -n targets: "export function lodConfig", "export function buildMinMax",
//  "export function fitLapse", "export function farRingParams",
//  "export function farRingMesh", "function buildRing",
//  "export function nodeBounds", "export function frustumPlanes",
//  "export function selectNodes", "export function morphVertex",
//  "export function gridIndices", "export function groundLayerMap",
//  "export async function createGround", "drawOpaque", "drawShadow",
//  "export function surfaceUniforms", "function startSurface", "function applySurface"
// ============================================================================

import { simulateSurface, surfRes, SURF_LAYERS } from './surface-sim.js';

const INST_FLOATS = 8;          // a: x0, z0, size, N; b: morph start, morph end, level, 0
const MAX_INST = 6144;
// GroundU (ground.wgsl struct GroundU) in floats: 18 vec4
export const U_FLOATS = 72;
export const LAYERS = ['rock', 'cliff', 'grass', 'forest floor', 'sand', 'snow', 'mud', 'gravel'];
// texture array size per quality (three arrays of 13 sets: about 180 MB at 1024)
export const layerRes = (q) => (q >= 0.95 ? 1024 : q >= 0.45 ? 512 : 256);

// ------------------------------------------------------------ LOD config --

// LOD set-up for a world. quality 0..1 sets the patch grid, the leaf
// spacing and the range factor.
export function lodConfig(worldSize, quality = 1, coarse = false, rangeScale = 1) {
  const q = Math.max(0, Math.min(1, quality));
  const N = q >= 0.45 ? 32 : 16;
  const spacing = q >= 0.8 ? 0.5 : q >= 0.45 ? 1.0 : 2.0;
  const want = Math.max(N * spacing, 4);
  const levels = Math.max(1, Math.min(14, Math.round(Math.log2(worldSize / want)) + 1));
  const leaf = worldSize / Math.pow(2, levels - 1);
  const rangeK = Math.max(2.2, (q >= 0.45 ? 4.0 : 3.4) * (coarse ? 0.9 : 1) * rangeScale);
  const ranges = [];
  const mStart = [];
  const mEnd = [];
  for (let i = 0; i < levels; i++) {
    const size = leaf * Math.pow(2, i);
    ranges.push(rangeK * size);
  }
  ranges[levels - 1] = Infinity;
  for (let i = 0; i < levels; i++) {
    const size = leaf * Math.pow(2, i);
    const r = ranges[i];
    const prev = i === 0 ? 0 : ranges[i - 1] + 1.6 * (size / 2);
    const end = Number.isFinite(r) ? r * 0.96 : 1e12;
    const start = i === 0 ? end * 0.6 : Math.min(prev, end - 1);
    mStart.push(start);
    mEnd.push(end);
  }
  return { N, leaf, levels, ranges, mStart, mEnd, worldSize };
}

// --------------------------------------------------------- height bounds --

// Min / max pyramid of an n x n height grid: level k holds cells of 2^k
// texels (min, max interleaved).
export function buildMinMax(height, n) {
  const levels = [];
  let w = n;
  let cur = new Float32Array(n * n * 2);
  for (let i = 0; i < n * n; i++) { cur[2 * i] = height[i]; cur[2 * i + 1] = height[i]; }
  levels.push({ w, data: cur });
  while (w > 1) {
    const nw = Math.ceil(w / 2);
    const nx = new Float32Array(nw * nw * 2);
    for (let y = 0; y < nw; y++) {
      for (let x = 0; x < nw; x++) {
        let lo = Infinity, hi = -Infinity;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(2 * x + dx, w - 1), sy = Math.min(2 * y + dy, w - 1);
            const k = 2 * (sy * w + sx);
            if (cur[k] < lo) lo = cur[k];
            if (cur[k + 1] > hi) hi = cur[k + 1];
          }
        }
        nx[2 * (y * nw + x)] = lo;
        nx[2 * (y * nw + x) + 1] = hi;
      }
    }
    levels.push({ w: nw, data: nx });
    cur = nx;
    w = nw;
  }
  return { n, levels };
}

// Height range over the world rect [x0, x0 + size] x [z0, z0 + size].
export function nodeBounds(mm, origin, worldSize, x0, z0, size, out) {
  if (!mm) { out[0] = -1e4; out[1] = 1e4; return out; }
  if (mm.bounds) return mm.bounds(origin, worldSize, x0, z0, size, out);
  const n = mm.n;
  const tex = worldSize / n;
  const tx0 = Math.floor((x0 - origin) / tex - 1), tz0 = Math.floor((z0 - origin) / tex - 1);
  const tx1 = Math.ceil((x0 + size - origin) / tex + 1), tz1 = Math.ceil((z0 + size - origin) / tex + 1);
  const span = Math.max(tx1 - tx0, tz1 - tz0, 1);
  const k = Math.min(mm.levels.length - 1, Math.max(0, Math.ceil(Math.log2(span)) - 1));
  const L = mm.levels[k];
  const c = 1 << k;
  const cx0 = Math.max(0, Math.floor(tx0 / c)), cz0 = Math.max(0, Math.floor(tz0 / c));
  const cx1 = Math.min(L.w - 1, Math.floor(tx1 / c)), cz1 = Math.min(L.w - 1, Math.floor(tz1 / c));
  let lo = Infinity, hi = -Infinity;
  for (let z = cz0; z <= cz1; z++) {
    for (let x = cx0; x <= cx1; x++) {
      const i = 2 * (z * L.w + x);
      if (L.data[i] < lo) lo = L.data[i];
      if (L.data[i + 1] > hi) hi = L.data[i + 1];
    }
  }
  if (lo === Infinity) { lo = 0; hi = 0; }
  out[0] = lo; out[1] = hi;
  return out;
}

// ---------------------------------------------------------------- frustum --

// Side and near planes of a column-major view-projection (WebGPU clip,
// reverse-Z, infinite far: no far plane). Each plane: a, b, c, d with
// a x + b y + c z + d >= 0 inside.
export function frustumPlanes(m) {
  const row = (i) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const add = (a, b, s) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2], a[3] + s * b[3]];
  const planes = [add(r3, r0, 1), add(r3, r0, -1), add(r3, r1, 1), add(r3, r1, -1), add(r3, r2, -1)];
  for (const p of planes) {
    const l = Math.hypot(p[0], p[1], p[2]) || 1;
    p[0] /= l; p[1] /= l; p[2] /= l; p[3] /= l;
  }
  return planes;
}

function boxInFrustum(planes, x0, y0, z0, x1, y1, z1) {
  for (const p of planes) {
    const x = p[0] >= 0 ? x1 : x0, y = p[1] >= 0 ? y1 : y0, z = p[2] >= 0 ? z1 : z0;
    if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
  }
  return true;
}

// LOD distance: horizontal distance, plus the camera height over the top
// of the terrain (one constant per frame). ground.wgsl uses the same
// metric, so the distance of any vertex of a node is at most the node
// distance + its diagonal, and the seam rule of lodConfig holds for any
// relief (a full 3D distance broke it on tall nodes).
export function lodDistance(cam, hTop, x, z) {
  const dy = Math.max(cam[1] - hTop, 0);
  return Math.sqrt((cam[0] - x) ** 2 + (cam[2] - z) ** 2 + dy * dy);
}
function rectSphere(cam, hTop, r, x0, z0, x1, z1) {
  const dx = Math.max(x0 - cam[0], 0, cam[0] - x1);
  const dz = Math.max(z0 - cam[2], 0, cam[2] - z1);
  const dy = Math.max(cam[1] - hTop, 0);
  return dx * dx + dy * dy + dz * dz <= r * r;
}

// ------------------------------------------------------------- selection --

// CDLOD selection. opts: { cfg, cam [x, y, z], origin, mm (minmax), pad,
// hTop (top of the terrain, m), planes (or null: no cull), maxRange,
// out (Float32Array), max }. Returns { count, full, half } where the
// instances in out are sorted: full grids first (count full), then half
// grids (count half).
export function selectNodes(o) {
  const { cfg, cam, origin, mm, pad = 12, planes = null, maxRange = Infinity } = o;
  const hTop = o.hTop ?? (mm ? mm.levels[mm.levels.length - 1].data[1] + pad : 0);
  const full = [];
  const half = [];
  const b = [0, 0];
  const top = cfg.levels - 1;
  const R = (lvl) => cfg.ranges[lvl];
  const emit = (list, x0, z0, size, lvl, N) => {
    list.push(x0, z0, size, N, cfg.mStart[lvl], cfg.mEnd[lvl], lvl, 0);
  };
  const visible = (x0, z0, size, lo, hi) => {
    if (!planes) return true;
    return boxInFrustum(planes, x0, lo, z0, x0 + size, hi, z0 + size);
  };
  const select = (x0, z0, size, lvl) => {
    nodeBounds(mm, origin, cfg.worldSize, x0, z0, size, b);
    const lo = b[0] - pad, hi = b[1] + pad;
    const near = (r) => rectSphere(cam, hTop, r, x0, z0, x0 + size, z0 + size);
    if (lvl < top && !near(R(lvl))) return false;
    if (!rectSphere(cam, hTop, maxRange, x0, z0, x0 + size, z0 + size)) return true;
    if (!visible(x0, z0, size, lo, hi)) return true;
    if (lvl === 0 || !near(R(lvl - 1))) { emit(full, x0, z0, size, lvl, cfg.N); return true; }
    const h = size / 2;
    for (let c = 0; c < 4; c++) {
      const cx = x0 + (c & 1) * h, cz = z0 + (c >> 1) * h;
      if (!select(cx, cz, h, lvl - 1)) {
        nodeBounds(mm, origin, cfg.worldSize, cx, cz, h, b);
        if (visible(cx, cz, h, b[0] - pad, b[1] + pad)) emit(half, cx, cz, h, lvl, cfg.N / 2);
      }
    }
    return true;
  };
  select(origin, origin, cfg.worldSize, top);
  const max = o.max ?? MAX_INST;
  const nf = Math.min(full.length / INST_FLOATS, max);
  const nh = Math.min(half.length / INST_FLOATS, max - nf);
  const out = o.out && o.out.length >= (nf + nh) * INST_FLOATS ? o.out : new Float32Array((nf + nh) * INST_FLOATS);
  out.set(full.slice(0, nf * INST_FLOATS), 0);
  out.set(half.slice(0, nh * INST_FLOATS), nf * INST_FLOATS);
  return { count: nf + nh, full: nf, half: nh, out };
}

// JS twin of ground.wgsl fn cdlodVertex: grid vertex (gx, gz) of instance
// inst (8 floats) -> [x, z, k]. hTop: the top of the terrain (U.misc.z).
export function morphVertex(gx, gz, inst, cam, hTop, worldMin, worldMax) {
  const N = inst[3];
  const sp = inst[2] / N;
  const clampW = (v) => Math.min(worldMax, Math.max(worldMin, v));
  const x0 = inst[0] + gx * sp, z0 = inst[1] + gz * sp;
  const d = lodDistance(cam, hTop, x0, z0);
  const k = Math.min(1, Math.max(0, (d - inst[4]) / Math.max(inst[5] - inst[4], 1e-3)));
  const fx = ((gx * 0.5) % 1) * 2, fz = ((gz * 0.5) % 1) * 2;
  return [clampW(x0 - fx * sp * k), clampW(z0 - fz * sp * k), k];
}

// Index buffer of an N x N quad grid ((N + 1)^2 vertices). Winding is
// counter-clockwise seen from +y.
export function gridIndices(N) {
  const idx = new Uint32Array(N * N * 6);
  let k = 0;
  const v = (x, z) => z * (N + 1) + x;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const a = v(x, z), b = v(x + 1, z), c = v(x, z + 1), d = v(x + 1, z + 1);
      // alternate the diagonal for a symmetric mesh
      if ((x + z) & 1) { idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
      else { idx[k++] = a; idx[k++] = c; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = b; }
    }
  }
  return idx;
}

// ------------------------------------------------------- ground textures --

// The ASSETS ground sets (manifest kind "ground texture") by role. The
// test order puts the specific names first ("dry grass" before "grass").
const SET_ROLES = [
  ['cliff', /cliff/i], ['scree', /scree/i], ['dry', /dry/i], ['meadow', /meadow|damp/i],
  ['pine', /pine|needle/i], ['desert', /desert|cracked/i], ['forest', /forest|leaf|litter/i],
  ['gravel', /gravel|pebble/i], ['mud', /mud/i], ['snow', /snow/i], ['sand', /sand|beach/i],
  ['rock', /rock/i], ['grass', /grass/i],
];
// logical layer -> [primary role, fallback], and its alternate role
const PRIMARY = [['rock', 'cliff'], ['cliff', 'rock'], ['grass', 'meadow'], ['forest', 'pine'],
  ['sand', 'desert'], ['snow', null], ['mud', null], ['gravel', 'scree']];
const ALTERNATE = ['scree', 'rock', 'dry', 'pine', 'desert', null, null, 'scree'];
export const MAX_SETS = 16;
// Sets with a known defect are not used (the layer then draws procedural):
// ground_mud has a 4 x 4 grid of seams in its albedo (NOTES.md, 2026-10-17,
// GROUND to ASSETS). Remove the id when the set is fixed.
export const SKIP_SETS = new Set(['ground_mud']);

// records: the ground sets in texture array order. Returns { roles, tiles
// (Float32Array 16, m), map (Float32Array 16: [0..7] primary array layer of
// each logical layer, [8..15] alternate, 255 = none), meadow (layer) }.
export function groundLayerMap(records) {
  const roles = {};
  const tiles = new Float32Array(MAX_SETS).fill(2);
  records.slice(0, MAX_SETS).forEach((r, k) => {
    tiles[k] = r.tile || 2;
    if (SKIP_SETS.has(r.id)) return;
    const name = `${r.id || ''} ${r.name || ''}`;
    for (const [role, re] of SET_ROLES) {
      if (re.test(name) && roles[role] === undefined) { roles[role] = k; break; }
    }
  });
  const idx = (role) => (role && roles[role] !== undefined ? roles[role] : 255);
  const map = new Float32Array(16);
  PRIMARY.forEach(([a, b], l) => { map[l] = idx(a) !== 255 ? idx(a) : idx(b); });
  ALTERNATE.forEach((a, l) => { map[8 + l] = idx(a); });
  return { roles, tiles, map, meadow: idx('meadow') };
}

// ground set records of a manifest (kind "ground texture"), in the order of
// manifest.groundLayers when it is there
export function groundRecords(manifest) {
  if (!manifest) return [];
  const list = Array.isArray(manifest) ? manifest : (manifest.assets || []);
  const g = list.filter((a) => a && /ground/i.test(String(a.kind || '')) && a.textures && a.textures.albedo);
  if (manifest.groundLayers) {
    const by = new Map(g.map((a) => [a.id, a]));
    const ordered = manifest.groundLayers.map((id) => by.get(id)).filter(Boolean);
    if (ordered.length) return ordered;
  }
  return g;
}

// ---------------------------------------------------- snow line and ring --

// Least-squares fit T = a + b h of the LIB temperature (C) against the
// height (m), on a stride of the grid. -> [a, b, valid, 0]. ground.wgsl
// puts the snow line where T falls to the season's limit.
export function fitLapse(height, temp) {
  const n = Math.min(height.length, temp.length);
  const step = Math.max(1, Math.floor(n / 65536));
  let sx = 0, sy = 0, sxx = 0, sxy = 0, k = 0;
  for (let i = 0; i < n; i += step) {
    const x = height[i], y = temp[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x; sy += y; sxx += x * x; sxy += x * y; k++;
  }
  const den = k * sxx - sx * sx;
  if (k < 16 || Math.abs(den) < 1e-6) return [0, 0, 0, 0];
  const b = (k * sxy - sx * sy) / den, a = (sy - b * sx) / k;
  // a flat or inverted fit (no relief) gives no climate snow line
  if (!(b < -1e-5)) return [a, 0, 0, 0];
  return [a, b, 1, 0];
}

// Far ring parameters: [floor height m, fade length m, floor relief m, 0].
// A world with a sea sinks the ring under the sea; a world with no sea
// (LIB seaLevel under the lowest land) flattens it to low rolling land.
export function farRingParams(t, hMin, hMax) {
  const ws = t.worldSize || 1;
  const sea = t.seaLevel ?? 0;
  const span = Math.max(1, hMax - Math.max(hMin, sea));
  const hasSea = sea > hMin + 0.5;
  if (hasSea) return [sea - 30 - span * 0.03, ws * 0.9, 0, 0];
  return [hMin + span * 0.10, ws * 1.1, span * 0.10, 0];
}

// The far ring mesh: K + 2 square rings round the world square, M segments
// per side. Ring 0 is a skirt just inside the edge, 200 m down (it hides
// the hairline between the CDLOD edge and the ring). Ring 1 lies on the
// edge, then the rings spread out (power 2.2) to the half size plus
// max(5 x world, 80 km), and one flat band on to 2000 km. Vertex = x, z,
// drop m; index uint32.
export function farRingMesh(ws, M = 160, K = 56) {
  const half = ws / 2, rMax = half + Math.max(ws * 5, 80000);
  const radii = [half - Math.min(2, ws * 1e-4), half];
  for (let k = 1; k <= K; k++) radii.push(half + (rMax - half) * Math.pow(k / K, 2.2));
  // one flat band on to 2000 km: the land plane reaches the horizon line
  // (with no sea, the end of the ring showed as a line under the horizon)
  radii.push(half + Math.max(2e6, rMax * 4));
  const P = 4 * M, R = radii.length;
  const pos = new Float32Array(R * P * 3);
  for (let r = 0; r < R; r++) {
    const h = radii[r];
    for (let i = 0; i < P; i++) {
      const side = Math.floor(i / M), f = (i % M) / M;
      const s = -h + 2 * h * f;
      // corners in order: bottom edge (+x), right (+z), top (-x), left (-z)
      const xz = side === 0 ? [s, -h] : side === 1 ? [h, s] : side === 2 ? [-s, h] : [-h, -s];
      const o = (r * P + i) * 3;
      pos[o] = xz[0]; pos[o + 1] = xz[1]; pos[o + 2] = r === 0 ? 200 : 0;
    }
  }
  const idx = new Uint32Array((R - 1) * P * 6);
  let q = 0;
  for (let r = 0; r < R - 1; r++) {
    for (let i = 0; i < P; i++) {
      const a = r * P + i, b = r * P + ((i + 1) % P), c = a + P, d = b + P;
      idx[q++] = a; idx[q++] = b; idx[q++] = c;
      idx[q++] = b; idx[q++] = d; idx[q++] = c;
    }
  }
  return { pos, idx };
}

// U.surf, U.geo, U.geo2 of a finished surface job r (render/surface-sim.js)
// on terrain cpu: [on, grid m, wind x, wind z, strata hmin, hspan, layers,
// strength, glacier, hemisphere (1 north, -1 south), dune wavelength m, 0]
export function surfaceUniforms(r, cpu) {
  const o = (cpu && cpu.opts) || {};
  const lat = o.latitude ?? 45;
  const lam = 150 + (90 * Math.min(1, Math.max(0, o.dunes || 0)));
  return [1, r.m, r.wind[0], r.wind[1], ...r.strata, r.glacier || 0, lat < 0 ? -1 : 1, lam, 0];
}

// ----------------------------------------------------------------- module --

const MIP_WGSL = /* wgsl */`
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct VO { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  let q = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VO; o.p = vec4f(q * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2f(q.x, 1.0 - q.y); return o;
}
@fragment fn fs(v: VO) -> @location(0) vec4f { return textureSampleLevel(src, smp, v.uv, 0.0); }`;

export async function createGround(gpu) {
  const { device, queue } = gpu;
  const hdrFormat = gpu.hdrFormat || 'rgba16float';
  const depthFormat = gpu.depthFormat || 'depth32float';
  let quality = gpu.quality ?? 1;
  const code = await gpu.loadWGSL(new URL('../shaders/ground.wgsl', import.meta.url).href);
  const module = device.createShaderModule({ code, label: 'ground' });
  if (module.getCompilationInfo) {
    const info = await module.getCompilationInfo();
    const errs = info.messages.filter((m) => m.type === 'error');
    if (errs.length) throw new Error('ground.wgsl: ' + errs.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
  }

  // group 1: uniform + layer textures + repeat sampler
  const groundLayout = device.createBindGroupLayout({
    label: 'ground g1',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
    ],
  });
  // the shadow pass reads U (group 1) too: the morph needs the terrain top
  const uBuf = device.createBuffer({ size: U_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'ground U' });
  const uData = new Float32Array(U_FLOATS);
  // SKY's cloud shadow map (module.cloudShadow), when CORE hands it over as
  // gpu.cloudShadow or frame.cloudShadow; a lit 1 x 1 stand-in until then
  const litTex = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, label: 'ground lit' });
  queue.writeTexture({ texture: litTex }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
  const litSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  let cloud = null;
  let layerMap = groundLayerMap([]);
  const sRepeat = gpu.sRepeat || device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 });

  // layer arrays: a 4x4 dummy until ASSETS textures arrive
  const mkArray = (size, format, mips, label, layers = 1) => device.createTexture({
    size: [size, size, layers], format, mipLevelCount: mips, label,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  let texAlb = mkArray(4, 'rgba8unorm-srgb', 1, 'ground alb dummy');
  let texNrm = mkArray(4, 'rgba8unorm', 1, 'ground nrm dummy');
  let texOrm = mkArray(4, 'rgba8unorm', 1, 'ground orm dummy');
  let texOn = 0;
  // the surface fields (render/surface-sim.js): a neutral 1 x 1 stand-in
  // until the simulation of the final terrain is done (U.surf.x = 0)
  const mkSurf = (m) => device.createTexture({
    size: [m, m, SURF_LAYERS], format: 'rgba8unorm', label: `ground surface ${m}`,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  let surfTex = mkSurf(1);
  const makeBG = () => device.createBindGroup({
    layout: groundLayout, label: 'ground g1',
    entries: [
      { binding: 0, resource: { buffer: uBuf } },
      { binding: 1, resource: texAlb.createView({ dimension: '2d-array' }) },
      { binding: 2, resource: texNrm.createView({ dimension: '2d-array' }) },
      { binding: 3, resource: texOrm.createView({ dimension: '2d-array' }) },
      { binding: 4, resource: sRepeat },
      { binding: 5, resource: cloud ? cloud.view : litTex.createView() },
      { binding: 6, resource: cloud ? cloud.sampler : litSampler },
      { binding: 7, resource: surfTex.createView({ dimension: '2d-array' }) },
    ],
  });
  let groundBG = makeBG();

  const vbufs = [{
    arrayStride: INST_FLOATS * 4, stepMode: 'instance',
    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }],
  }];
  // group 2 is CORE's: the shadow sample group in the opaque pass, the
  // shadow pass group (SP) in drawShadow; CORE sets both bind groups
  const mainPipe = await device.createRenderPipelineAsync({
    label: 'ground opaque',
    layout: device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, groundLayout, gpu.shadowSampleLayout] }),
    vertex: { module, entryPoint: 'vs', buffers: vbufs },
    fragment: { module, entryPoint: 'fs', targets: [{ format: hdrFormat }] },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
    depthStencil: gpu.depthState ? gpu.depthState(true, 'greater') : { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' },
  });
  // the far ring (ground.wgsl fn vsRing): the same material, no LOD
  const ringPipe = await device.createRenderPipelineAsync({
    label: 'ground far ring',
    layout: device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, groundLayout, gpu.shadowSampleLayout] }),
    vertex: { module, entryPoint: 'vsRing', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
    fragment: { module, entryPoint: 'fs', targets: [{ format: hdrFormat }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: gpu.depthState ? gpu.depthState(true, 'greater') : { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' },
  });
  let ring = null;   // { ws, vbuf, ibuf, count }
  function buildRing(ws) {
    if (ring && Math.abs(ring.ws - ws) < 1) return;
    if (ring) { ring.vbuf.destroy(); ring.ibuf.destroy(); }
    const g = farRingMesh(ws, gpu.coarse || quality < 0.45 ? 96 : 160, gpu.coarse || quality < 0.45 ? 40 : 56);
    const vbuf = device.createBuffer({ size: g.pos.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'ground ring v' });
    const ibuf = device.createBuffer({ size: g.idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, label: 'ground ring i' });
    queue.writeBuffer(vbuf, 0, g.pos); queue.writeBuffer(ibuf, 0, g.idx);
    ring = { ws, vbuf, ibuf, count: g.idx.length };
  }
  const snowFit = new Float32Array(4);
  const ringU = new Float32Array(4);
  // U.surf, U.geo, U.geo2 (see surfaceUniforms)
  const surfU = new Float32Array(12);

  // ---- the surface simulation of each final terrain: in a module worker
  // (render/surface-worker.js), else on this thread with pauses between
  // the passes. A newer terrain drops the older job (surfJob).
  let surfJob = 0, surfCpu = null, surfRes0 = 0, surfStats = null, surfAllow = true, surfReady = false;
  let surfWorker = null, surfWorkerBad = typeof Worker === 'undefined';
  let surfDone = Promise.resolve(false), surfResolve = null;
  function applySurface(r) {
    if (!r || r.id !== surfJob) return;
    if (r.error) { console.warn('ground: surface fields', r.error); surfResolve && surfResolve(false); return; }
    const m = r.m;
    const tex = mkSurf(m);
    for (let k = 0; k < SURF_LAYERS; k++) {
      queue.writeTexture({ texture: tex, origin: [0, 0, k] }, r.data, { offset: k * m * m * 4, bytesPerRow: m * 4, rowsPerImage: m }, [m, m, 1]);
    }
    surfTex.destroy();
    surfTex = tex;
    groundBG = makeBG();
    surfU.set(surfaceUniforms(r, surfCpu));
    surfReady = true;
    if (!surfAllow) surfU[0] = 0;
    surfStats = { m, ...r.stats };
    surfResolve && surfResolve(true);
  }
  function startSurface(cpu) {
    const res = surfRes(cpu.n, quality, gpu.coarse);
    if (cpu === surfCpu && res === surfRes0) return;
    surfCpu = cpu; surfRes0 = res;
    const id = ++surfJob;
    surfU[0] = 0; surfReady = false;
    surfDone = new Promise((r) => { surfResolve = r; });
    const t = { n: cpu.n, worldSize: cpu.worldSize, seaLevel: cpu.seaLevel, opts: cpu.opts, height: cpu.height, flow: cpu.flow,
      sediment: cpu.sediment, water: cpu.water, river: cpu.river, moisture: cpu.moisture, temperature: cpu.temperature };
    const local = () => simulateSurface(cpu, { res, yieldFn: () => new Promise((ok) => setTimeout(ok, 0)) })
      .then((s) => applySurface({ id, m: s.m, data: s.data, wind: s.wind, strata: s.strata, glacier: s.glacier, stats: s.stats }))
      .catch((e) => applySurface({ id, error: e.message }));
    if (!surfWorkerBad && !surfWorker) {
      try {
        surfWorker = new Worker(new URL('./surface-worker.js', import.meta.url), { type: 'module' });
        surfWorker.onmessage = (e) => applySurface(e.data);
        surfWorker.onerror = (e) => { console.warn('ground: surface worker', e.message || e); surfWorkerBad = true; surfWorker = null; if (surfCpu) { const c = surfCpu; surfCpu = null; startSurface(c); } };
      } catch (e) { surfWorkerBad = true; surfWorker = null; }
    }
    if (surfWorker) {
      try { surfWorker.postMessage({ id, res, t }); return; } catch (e) { surfWorkerBad = true; }
    }
    local();
  }

  const shadowPipe = await device.createRenderPipelineAsync({
    label: 'ground shadow',
    layout: device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, groundLayout, gpu.shadowPassLayout] }),
    vertex: { module, entryPoint: 'vsShadow', buffers: vbufs },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: gpu.shadowDepthState,
  });

  // grids
  const idxBufs = {};
  const gridBuf = (N) => {
    if (!idxBufs[N]) {
      const idx = gridIndices(N);
      const b = device.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, label: `ground grid ${N}` });
      queue.writeBuffer(b, 0, idx);
      idxBufs[N] = { buf: b, count: idx.length };
    }
    return idxBufs[N];
  };
  const instBuf = device.createBuffer({ size: MAX_INST * INST_FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'ground inst' });
  const shInstBuf = device.createBuffer({ size: MAX_INST * INST_FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'ground shadow inst' });
  let instArr = new Float32Array(MAX_INST * INST_FLOATS);
  let shArr = new Float32Array(MAX_INST * INST_FLOATS);

  let terrain = null;
  let mm = null, mmPrev = null, mmPrevUntil = 0;
  let hMin = 0, hMax = 1, hMaxPrev = 1;
  let cfg = null, cfgSh = null;
  let sel = { count: 0, full: 0, half: 0 };
  let shSel = { count: 0, full: 0, half: 0 };
  let debug = 0;
  let aerialOn = gpu.groundAerial === false ? 0 : 1;
  let lastTime = 0;
  let ringOn = true;

  // the min / max pyramid of the newest heights; during the stage blend
  // (gpu/terrain-gpu.js BLEND_S) the bounds are the union of old and new
  function setTerrain(t) {
    terrain = t;
    const src = (t.cpu && t.cpu.height) ? t.cpu : (t.snapshot && t.snapshot.height ? t.snapshot : null);
    const h = src ? src.height : null;
    const n = src ? (src.n || Math.round(Math.sqrt(h.length))) : 0;
    mmPrev = mm; hMaxPrev = hMax; mmPrevUntil = lastTime + 1.2;
    if (h && n && h.length >= n * n) {
      mm = buildMinMax(h, n);
      const top = mm.levels[mm.levels.length - 1].data;
      hMin = top[0]; hMax = top[1];
    } else {
      mm = null; hMin = t.minH ?? 0; hMax = t.maxH ?? (t.heightScale || 1000);
    }
    cfg = lodConfig(t.worldSize, quality, gpu.coarse);
    cfgSh = lodConfig(t.worldSize, quality, gpu.coarse, 0.55);
    buildRing(t.worldSize);
    // the climate snow line: T = a + b h over the final terrain (a stage
    // snapshot with no temperature keeps the last fit)
    const tc = t.cpu && t.cpu.temperature && t.cpu.height ? t.cpu : null;
    if (tc) snowFit.set(fitLapse(tc.height, tc.temperature));
    // the surface fields follow the final terrain; a forming one has none
    if (t.cpu && t.cpu.height && t.cpu.flow) startSurface(t.cpu);
    else if (!t.cpu) { surfJob++; surfCpu = null; surfU[0] = 0; surfReady = false; }
    ringU.set(farRingParams(t, hMin, hMax));
  }

  const unionMM = {
    get n() { return mm.n; },
    bounds(origin, ws, x0, z0, size, out) {
      nodeBounds(mm, origin, ws, x0, z0, size, out);
      const lo = out[0], hi = out[1];
      nodeBounds(mmPrev, origin, ws, x0, z0, size, out);
      out[0] = Math.min(lo, out[0]); out[1] = Math.max(hi, out[1]);
      return out;
    },
  };

  function update(frame) {
    if (!terrain) return;
    const g = frame.globals;
    lastTime = frame.time || 0;
    const q = frame.quality ?? (g ? g[130] : quality);
    if (Math.abs(q - quality) > 1e-3) {
      quality = q;
      cfg = lodConfig(terrain.worldSize, quality, frame.coarse);
      cfgSh = lodConfig(terrain.worldSize, quality, frame.coarse, 0.55);
      if (surfCpu) startSurface(surfCpu);   // the field grid follows the quality
    }
    const cam = frame.camera?.pos ? [frame.camera.pos[0], frame.camera.pos[1], frame.camera.pos[2]] : [g[80], g[81], g[82]];
    const origin = -terrain.worldSize / 2;
    const planes = g ? frustumPlanes(g.subarray(0, 16)) : null;
    const pad = 12 + (terrain.heightScale || 0) * 0.002;
    const blending = mm && mmPrev && lastTime < mmPrevUntil;
    const mmUse = blending ? unionMM : mm;
    const hTop = (blending ? Math.max(hMax, hMaxPrev) : hMax) + pad;
    sel = selectNodes({ cfg, cam, origin, mm: mmUse, pad, hTop, planes, out: instArr });
    instArr = sel.out;
    queue.writeBuffer(instBuf, 0, instArr, 0, sel.count * INST_FLOATS);
    const splits = frame.shadowInfo?.splits || gpu.shadowSplits;
    const shDist = frame.shadowDistance || (splits ? splits[splits.length - 1] * 1.5 : Math.min(terrain.worldSize, 4000));
    shSel = selectNodes({ cfg: cfgSh, cam, origin, mm: mmUse, pad, hTop, planes: null, maxRange: shDist, out: shArr });
    shArr = shSel.out;
    queue.writeBuffer(shInstBuf, 0, shArr, 0, shSel.count * INST_FLOATS);

    const cs = frame.cloudShadow || gpu.cloudShadow || null;
    if (cs && cs.view && cs.sampler) {
      if (!cloud || cloud.view !== cs.view) { cloud = { view: cs.view, sampler: cs.sampler }; groundBG = makeBG(); }
      const r = cs.rect ? cs.rect() : [0, 0, 1];
      uData[48] = r[0]; uData[49] = r[1]; uData[50] = r[2]; uData[51] = cs.base ? cs.base() : 2000;
    } else if (cloud) { cloud = null; groundBG = makeBG(); }
    uData.set([cfg.N, cfg.ranges[0], cfg.levels, pad,
      texOn, layerMap.meadow, debug, quality,
      aerialOn, 1, Math.min(terrain.worldSize * 0.3, 8000), cloud ? 1 : 0,
      frame.time || 0, hMin, hTop, 1]);
    uData.set(layerMap.tiles, 16);
    uData.set(layerMap.map, 32);
    uData.set(snowFit, 52);
    uData.set(ringU, 56);
    uData.set(surfU, 60);
    queue.writeBuffer(uBuf, 0, uData);
  }

  function drawList(pass, buf, s, c) {
    if (s.full) {
      const g = gridBuf(c.N);
      pass.setVertexBuffer(0, buf, 0);
      pass.setIndexBuffer(g.buf, 'uint32');
      pass.drawIndexed(g.count, s.full);
    }
    if (s.half) {
      const g = gridBuf(c.N / 2);
      pass.setVertexBuffer(0, buf, s.full * INST_FLOATS * 4);
      pass.setIndexBuffer(g.buf, 'uint32');
      pass.drawIndexed(g.count, s.half);
    }
  }

  // CORE has set group 0 (Globals) and group 2 (shadow sample) on the pass
  function drawOpaque(pass) {
    if (!terrain || !sel.count) return;
    pass.setPipeline(mainPipe);
    pass.setBindGroup(1, groundBG);
    drawList(pass, instBuf, sel, cfg);
    if (ring && ringOn) {
      pass.setPipeline(ringPipe);
      pass.setVertexBuffer(0, ring.vbuf);
      pass.setIndexBuffer(ring.ibuf, 'uint32');
      pass.drawIndexed(ring.count);
    }
  }

  // CORE has set group 0 and group 2 (SP of cascade frame.cascade)
  function drawShadow(pass) {
    if (!terrain || !shSel.count) return;
    pass.setPipeline(shadowPipe);
    pass.setBindGroup(1, groundBG);
    drawList(pass, shInstBuf, shSel, cfgSh);
  }

  // ---- ASSETS ground textures
  const mipPipes = {};
  const mipSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  function genMips(tex, format, layer, levels) {
    if (!mipPipes[format]) {
      const m = device.createShaderModule({ code: MIP_WGSL });
      mipPipes[format] = device.createRenderPipeline({
        layout: 'auto', vertex: { module: m, entryPoint: 'vs' },
        fragment: { module: m, entryPoint: 'fs', targets: [{ format }] },
      });
    }
    const pipe = mipPipes[format];
    const enc = device.createCommandEncoder();
    for (let l = 1; l < levels; l++) {
      const src = tex.createView({ dimension: '2d', baseMipLevel: l - 1, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
      const dst = tex.createView({ dimension: '2d', baseMipLevel: l, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
      const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: src }, { binding: 1, resource: mipSampler }] });
      const p = enc.beginRenderPass({ colorAttachments: [{ view: dst, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      p.setPipeline(pipe); p.setBindGroup(0, bg); p.draw(3); p.end();
    }
    queue.submit([enc.finish()]);
  }

  // a bitmap (browser) or { width, height, data } RGBA bytes (tests) into
  // layer k of tex, at res x res
  async function upload(img, tex, k, res) {
    if (!img) return false;
    if (img.data) {
      if (img.width !== res || img.height !== res) return false;
      queue.writeTexture({ texture: tex, origin: [0, 0, k] }, img.data, { bytesPerRow: res * 4 }, [res, res, 1]);
      return true;
    }
    let src = img;
    if ((img.width !== res || img.height !== res) && typeof createImageBitmap !== 'undefined') {
      src = await createImageBitmap(img, { resizeWidth: res, resizeHeight: res, resizeQuality: 'high' });
    }
    queue.copyExternalImageToTexture({ source: src }, { texture: tex, origin: [0, 0, k] }, [res, res, 1]);
    return true;
  }

  async function fetchBitmap(u, size = 0) {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`${u}: ${r.status}`);
    const o = { colorSpaceConversion: 'none' };
    if (size) { o.resizeWidth = size; o.resizeHeight = size; o.resizeQuality = 'high'; }
    return createImageBitmap(await r.blob(), o);
  }
  // a phone profile (gpu/budget.js): fewer sets, decoded at the array size
  // (not 1024) and not kept in the glb-lite image cache
  const PHONE_SETS = ['ground_grass', 'ground_forest_floor', 'ground_rock', 'ground_cliff', 'ground_gravel', 'ground_sand', 'ground_snow', 'ground_meadow', 'ground_desert', 'ground_scree'];
  const pf = gpu.profile && gpu.profile.groundRes ? gpu.profile : null;

  // Load the ASSETS ground sets into the three arrays. gpu.assets is the
  // glb-lite library (loadGround) or a bare manifest. Resolves to the
  // number of sets loaded (0: the procedural layers stay alone).
  async function loadAssetTextures() {
    const a = gpu.assets;
    if (!a) return 0;
    let sets = null;
    if (gpu.groundImageLoader) {
      // a test harness with no image decoder (Deno): loader(url, size) ->
      // { data RGBA, width, height }
      const recs = groundRecords(a.manifest || a);
      const base = a.baseUrl || a.baseURL || new URL('../../../assets/nature/', import.meta.url).href;
      const r0 = layerRes(quality);
      sets = await Promise.all(recs.map(async (rec) => {
        const t = rec.textures;
        const get = (f) => (f ? gpu.groundImageLoader(new URL(f, base).href, r0).catch(() => null) : null);
        const [albedo, normal, orm] = await Promise.all([get(t.albedo), get(t.normal), get(t.orm)]);
        return { record: rec, albedo, normal, orm };
      }));
    } else if (a.loadGround && !pf) sets = await a.loadGround();
    else {
      let recs = groundRecords(a.manifest || a);
      if (pf) recs = recs.filter((r) => PHONE_SETS.includes(r.id)).sort((x, y) => PHONE_SETS.indexOf(x.id) - PHONE_SETS.indexOf(y.id)).slice(0, pf.groundLayers || 8);
      if (!recs.length || typeof createImageBitmap === 'undefined') return 0;
      const base = a.baseUrl || a.baseURL || new URL('../../../assets/nature/', import.meta.url).href;
      sets = await Promise.all(recs.map(async (rec) => {
        const t = rec.textures;
        const get = (f) => (f ? fetchBitmap(new URL(f, base).href, pf ? Math.min(layerRes(quality), pf.groundRes) : 0).catch(() => null) : null);
        const [albedo, normal, orm] = await Promise.all([get(t.albedo), get(t.normal), get(t.orm)]);
        return { record: rec, albedo, normal, orm };
      }));
    }
    sets = (sets || []).filter((x) => x && x.albedo).slice(0, MAX_SETS);
    if (!sets.length) return 0;
    const res = pf ? Math.min(layerRes(quality), pf.groundRes) : layerRes(quality);
    const mips = Math.floor(Math.log2(res)) + 1;
    const L = sets.length;
    const alb = mkArray(res, 'rgba8unorm-srgb', mips, 'ground alb', L);
    const nrm = mkArray(res, 'rgba8unorm', mips, 'ground nrm', L);
    const orm = mkArray(res, 'rgba8unorm', mips, 'ground orm', L);
    const flat = { width: res, height: res, data: new Uint8Array(res * res * 4) };
    let ok = 0;
    for (let k = 0; k < L; k++) {
      const st = sets[k];
      try {
        await upload(st.albedo, alb, k, res);
        // a missing normal map is flat, a missing ORM is AO 1, rough 0.8, height 0.5
        if (!(await upload(st.normal, nrm, k, res))) { flat.data.fill(0); for (let i = 0; i < res * res; i++) { flat.data[i * 4] = 128; flat.data[i * 4 + 1] = 128; flat.data[i * 4 + 2] = 255; } await upload(flat, nrm, k, res); }
        if (!(await upload(st.orm, orm, k, res))) { for (let i = 0; i < res * res; i++) { flat.data[i * 4] = 255; flat.data[i * 4 + 1] = 204; flat.data[i * 4 + 2] = 128; } await upload(flat, orm, k, res); }
        genMips(alb, 'rgba8unorm-srgb', k, mips);
        genMips(nrm, 'rgba8unorm', k, mips);
        genMips(orm, 'rgba8unorm', k, mips);
        ok++;
      } catch (e) {
        console.warn('ground: texture set', st.record && st.record.id, e.message);
      }
    }
    if (!ok) { alb.destroy(); nrm.destroy(); orm.destroy(); return 0; }
    texAlb.destroy(); texNrm.destroy(); texOrm.destroy();
    texAlb = alb; texNrm = nrm; texOrm = orm;
    layerMap = groundLayerMap(sets.map((x) => x.record));
    groundBG = makeBG();
    texOn = 1;
    return ok;
  }
  let texturesReady = loadAssetTextures().catch((e) => { console.warn('ground: textures', e.message); return 0; });

  return {
    name: 'ground',
    role: 'ground',
    setTerrain,
    update,
    drawOpaque,
    drawShadow,
    get texturesReady() { return texturesReady; },
    // load the ground sets again (after gpu.groundImageLoader is set)
    reloadTextures() { texturesReady = loadAssetTextures().catch((e) => { console.warn('ground: textures', e.message); return 0; }); return texturesReady; },
    // resolves true when the surface fields of the current terrain are on
    surfaceReady: () => surfDone,
    // 0 lit, 1 layer weights, 2 normals, 3 LOD, 4 sun shadow, 5 albedo,
    // 6 geometric normal, 7 fields (bedrock, scree, alluvium + gullies),
    // 8 fields (snow drift, cornice + glacial, age)
    setDebug(mode) { debug = mode | 0; },
    // the simulated surface on or off (off: the slope and biome rules alone)
    setSurface(on) { surfAllow = !!on; surfU[0] = surfAllow && surfReady ? 1 : 0; },
    setAerial(on) { aerialOn = on ? 1 : 0; }, // off when SKY's volume does all of the haze
    setFarRing(on) { ringOn = !!on; },          // the mirrored land past the world edge
    stats() { return { patches: sel.count, full: sel.full, half: sel.half, shadowPatches: shSel.count, levels: cfg?.levels, N: cfg?.N, textures: texOn, surface: surfU[0] ? surfStats : null }; },
    resize() {},
    dispose() {
      for (const b of [uBuf, instBuf, shInstBuf]) b.destroy();
      if (ring) { ring.vbuf.destroy(); ring.ibuf.destroy(); }
      for (const k of Object.keys(idxBufs)) idxBufs[k].buf.destroy();
      texAlb.destroy(); texNrm.destroy(); texOrm.destroy(); litTex.destroy(); surfTex.destroy();
      surfJob++;
      if (surfWorker) { surfWorker.terminate(); surfWorker = null; }
    },
  };
}

// ============================================================================
//  CORAL REEF  ·  rock/index.js  ·  the ROCK package (DOM-free)
// ----------------------------------------------------------------------------
//  Seeded reef rock for one circular plot: natural arches, winding canyons
//  with undercut walls, bridges, pinnacles and hoodoos, caves, overhangs,
//  strata ledges, boulders and scree, sand pockets and channels. One signed
//  distance field (rock/geology.js), meshed in chunks (rock/mesh.js),
//  textured with a real CC0 stone set (rock/material.js).
//
//  API (CONTRACT-V3.md "ROCK API")
//
//    import { createRock, createRockAsync } from './rock/index.js';
//
//    const rock = createRock({ seed, radius = 30, detail = 1, quality = 'high', mesh = true });
//    const rock = await createRockAsync(opts, { workers, workerUrl, Worker });
//      same object; the chunks are meshed in module workers (rock/worker.js).
//      On the page this is the fast path (budget 2.5 s on desktop).
//
//    rock.sdf(x, y, z) -> d          signed distance in metres, < 0 inside
//                                    rock (the sand is not in it, see sand)
//    rock.normal(x, y, z) -> [nx, ny, nz]   unit gradient of sdf
//    rock.meshes: [{ key, positions, normals, indices, cavity, band,
//                    bounds: { min, max }, material }]
//                  chunks of one closed surface. No uv: map it triplanar.
//                  cavity: 0 open .. 1 deep crevice. band: strata bed
//                  coordinate (fract = place in the bed). indices are
//                  Uint16 or Uint32. material is rock.material (shared).
//    rock.sand: { heightAt(x, z), mesh: { positions, normals, uv, indices, material } }
//                  sand floor (a grid to 1.4 R). The rock goes on under it
//                  to y = -2.5, so there is no gap at the wall bases.
//    rock.bounds: { min: [x, y, z], max: [x, y, z] }
//    rock.sampleSurface(n, rng?, filter?) -> [{ p, n, exposure, overhang }]
//                  points on exposed rock (above the sand, inside R).
//                  exposure 0..1: faces up and is open to the water.
//                  overhang: faces down, or rock is over it (a roof).
//                  filter(sample) -> false drops a sample.
//    rock.features: [{ kind, center, size, ... }]
//        kind 'canyon'   path [[x, y, z] ...] on the floor, width, id
//        kind 'arch'     type 'bridge' (over a canyon) or 'free'; gap
//                        [y0, y1] open under it; top; axis: horizontal
//                        unit vector through the opening (fly along it)
//        kind 'pinnacle' radius, hoodoo (true when it has a cap)
//        kind 'overhang' type 'cap' (wall lip) or 'hoodoo cap'
//        kind 'cave'     mouth [x, y, z], axis (into the rock), radius
//        kind 'ledge'    a strata ledge on a wall, size = bed period
//    rock.textures: { albedo, normal, orm }   paths (pages/coral-reef/)
//    rock.material   rock/material.js rockMaterial(): triplanar scale,
//                    strata tints, cavity and encrust terms. ROCK_GLSL in
//                    rock/material.js has the shader helpers.
//    rock.radius, rock.seed, rock.stats { planMs, meshMs, chunks, tris, verts, cell }
//
//  Quality: 'high' cell 0.2 m (desktop), 'medium' 0.28 m, 'low' 0.4 m
//  (phones). detail 0..2 scales the crag relief (1 default).
//
//  grep -n targets
//    sync build ............ "export function createRock"
//    worker build .......... "export async function createRockAsync"
//    surface samples ....... "function sampleSurface"
//    sand mesh ............. "function sandMesh"
// ============================================================================
import { makeGeology, Y_BOTTOM } from './geology.js';
import { meshLayout, meshChunk, QUALITY } from './mesh.js';
import { mulberry32 } from './noise.js';
import { rockMaterial, sandMaterial, ROCK_TEXTURES } from './material.js';

export { QUALITY, Y_BOTTOM };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function chunkBounds(m) {
  const P = m.positions, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = P[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  return { min: mn, max: mx };
}

function sandMesh(geo, quality) {
  const step = quality === 'low' ? 0.7 : quality === 'medium' ? 0.5 : 0.35;
  const E = 1.4 * geo.R, n = Math.ceil(2 * E / step), N1 = n + 1;
  const pos = new Float32Array(N1 * N1 * 3), nrm = new Float32Array(N1 * N1 * 3), uv = new Float32Array(N1 * N1 * 2);
  for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) {
    const x = -E + 2 * E * i / n, z = -E + 2 * E * j / n, k = j * N1 + i;
    pos[k * 3] = x; pos[k * 3 + 1] = geo.sandAt(x, z); pos[k * 3 + 2] = z;
    const e = 0.25, gx = geo.sandAt(x + e, z) - geo.sandAt(x - e, z), gz = geo.sandAt(x, z + e) - geo.sandAt(x, z - e);
    const l = Math.hypot(gx, 2 * e, gz);
    nrm[k * 3] = -gx / l; nrm[k * 3 + 1] = 2 * e / l; nrm[k * 3 + 2] = -gz / l;
    uv[k * 2] = x / 2; uv[k * 2 + 1] = z / 2;
  }
  const idx = new Uint32Array(n * n * 6);
  for (let j = 0, q = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * N1 + i, b = a + 1, c = a + N1, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  return { positions: pos, normals: nrm, uv, indices: idx, material: sandMaterial() };
}

// The object without meshes; build() adds them.
function shell(opts) {
  const t0 = now();
  const quality = opts.quality || 'high';
  const geo = makeGeology({ seed: opts.seed ?? 1, radius: opts.radius ?? 30, detail: opts.detail ?? 1, quality });
  const material = rockMaterial(geo);
  const R = geo.R;
  const normal = (x, y, z, e = 0.04) => {
    const s = geo.sdf;
    const gx = s(x + e, y, z) - s(x - e, y, z), gy = s(x, y + e, z) - s(x, y - e, z), gz = s(x, y, z + e) - s(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  };
  const rock = {
    seed: geo.seed, radius: R, quality, detail: geo.detail,
    sdf: geo.sdf, normal,
    meshes: [],
    sand: { heightAt: geo.sandAt, mesh: null },
    bounds: { min: [-1.32 * R, Y_BOTTOM, -1.32 * R], max: [1.32 * R, geo.yMax, 1.32 * R] },
    features: geo.features,
    textures: { albedo: ROCK_TEXTURES.albedo, normal: ROCK_TEXTURES.normal, orm: ROCK_TEXTURES.orm },
    material,
    strata: geo.strata,
    stats: { planMs: now() - t0, meshMs: 0, chunks: 0, tris: 0, verts: 0, cell: 0 },
    sampleSurface: (n, rng, filter) => sampleSurface(rock, n, rng, filter),
    _geo: geo,
  };
  return rock;
}

function addMesh(rock, m) {
  if (!m || m.empty || !m.indices || !m.indices.length) return;
  rock.meshes.push({ key: m.key, positions: m.positions, normals: m.normals, indices: m.indices, cavity: m.cavity, band: m.band, bounds: chunkBounds(m), material: rock.material });
  rock.stats.tris += m.indices.length / 3; rock.stats.verts += m.positions.length / 3;
}

export function createRock(opts = {}) {
  const rock = shell(opts);
  rock.sand.mesh = sandMesh(rock._geo, rock.quality);
  if (opts.mesh === false) return rock;
  const t0 = now();
  const lay = meshLayout(rock._geo, rock.quality);
  rock.stats.cell = lay.cell; rock.stats.chunks = lay.chunks.length;
  for (const [i, j, k] of lay.chunks) addMesh(rock, meshChunk(rock._geo, lay, i, j, k));
  sortMeshes(rock);
  rock.stats.meshMs = now() - t0;
  return rock;
}

function sortMeshes(rock) {
  const key = k => k.split(',').map(Number);
  rock.meshes.sort((a, b) => { const p = key(a.key), q = key(b.key); return p[2] - q[2] || p[1] - q[1] || p[0] - q[0]; });
}

// Mesh the chunks in module workers. opts as createRock. w.workers: count
// (default hardwareConcurrency - 1, 2..8); w.workerUrl: URL of
// rock/worker.js; w.Worker: a Worker class (tests pass a node adapter).
export async function createRockAsync(opts = {}, w = {}) {
  const WorkerClass = w.Worker || (typeof Worker !== 'undefined' ? Worker : null);
  if (!WorkerClass) return createRock(opts);
  const rock = shell(opts);
  rock.sand.mesh = sandMesh(rock._geo, rock.quality);
  const t0 = now();
  const lay = meshLayout(rock._geo, rock.quality);
  rock.stats.cell = lay.cell; rock.stats.chunks = lay.chunks.length;
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const nW = Math.max(1, Math.min(lay.chunks.length, w.workers ?? Math.max(2, Math.min(8, hc - 1))));
  const url = w.workerUrl || new URL('./worker.js', import.meta.url);
  // Deal the chunks round robin (neighbours cost about the same).
  const parts = Array.from({ length: nW }, () => []);
  lay.chunks.forEach((c, i) => parts[i % nW].push(c));
  const job = { seed: rock.seed, radius: rock.radius, detail: rock.detail, quality: rock.quality };
  const results = await Promise.all(parts.map(chunks => new Promise((resolve, reject) => {
    const wk = new WorkerClass(url, { type: 'module' });
    wk.onmessage = e => { resolve(e.data); wk.terminate(); };
    wk.onerror = e => { wk.terminate(); reject(e instanceof Error ? e : new Error(e.message || 'rock worker failed')); };
    wk.postMessage({ ...job, chunks });
  })));
  for (const r of results) for (const m of r.meshes) addMesh(rock, m);
  sortMeshes(rock);
  rock.stats.meshMs = now() - t0;
  rock.stats.workers = nW;
  return rock;
}

// ── surface samples for the coral seeds ──────────────────────────────────
function sampleSurface(rock, n, rng, filter) {
  const geo = rock._geo, R = rock.radius;
  rng = rng || mulberry32((rock.seed * 7919 + 13) >>> 0);
  if (!rock._cdf) {
    // area-weighted triangle table over all chunks
    const tris = [], acc = [];
    let A = 0;
    rock.meshes.forEach((m, mi) => {
      const P = m.positions, I = m.indices;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        if (P[a + 1] < geo.sandAt(P[a], P[a + 2]) + 0.05) continue;
        if (Math.hypot(P[a], P[a + 2]) > R) continue;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        if (ar <= 0) continue;
        A += ar; tris.push(mi, t); acc.push(A);
      }
    });
    rock._cdf = { tris, acc: Float64Array.from(acc), A };
  }
  const { tris, acc, A } = rock._cdf;
  const out = [];
  if (!acc.length) return out;
  const dirs = [[0, 1, 0], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7]];
  for (let tries = 0; out.length < n && tries < n * 20; tries++) {
    const r = rng() * A;
    let lo = 0, hi = acc.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (acc[mid] < r) lo = mid + 1; else hi = mid; }
    const m = rock.meshes[tris[lo * 2]], t = tris[lo * 2 + 1], P = m.positions, I = m.indices;
    let u = rng(), v = rng(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    let x = P[a] + (P[b] - P[a]) * u + (P[c] - P[a]) * v;
    let y = P[a + 1] + (P[b + 1] - P[a + 1]) * u + (P[c + 1] - P[a + 1]) * v;
    let z = P[a + 2] + (P[b + 2] - P[a + 2]) * u + (P[c + 2] - P[a + 2]) * v;
    // project onto the zero level of the field (Newton steps on the raw gradient)
    let d = geo.sdf(x, y, z);
    for (let it = 0; it < 10 && Math.abs(d) > 2e-3; it++) {
      const e = 0.02, s0 = geo.sdf;
      const gx = (s0(x + e, y, z) - s0(x - e, y, z)) / (2 * e), gy = (s0(x, y + e, z) - s0(x, y - e, z)) / (2 * e), gz = (s0(x, y, z + e) - s0(x, y, z - e)) / (2 * e);
      const g2 = gx * gx + gy * gy + gz * gz || 1;
      x -= gx * d / g2; y -= gy * d / g2; z -= gz * d / g2;
      d = geo.sdf(x, y, z);
    }
    if (Math.abs(d) > 5e-3) continue;
    const nn = rock.normal(x, y, z, 0.08);
    if (y < geo.sandAt(x, z) + 0.05 || Math.hypot(x, z) > R) continue;
    // openness: rays into the upper half space around the normal
    let open = 0;
    for (const dv of dirs) {
      let dx = dv[0] + nn[0], dy = dv[1] + nn[1], dz = dv[2] + nn[2];
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      if (geo.sdf(x + dx * 1.5, y + dy * 1.5, z + dz * 1.5) > 0.4 && geo.sdf(x + dx * 3.5, y + dy * 3.5, z + dz * 3.5) > 0.6) open++;
    }
    open /= dirs.length;
    let roof = false;
    for (let h = 0.6; h < 5 && !roof; h += 0.5) if (geo.sdf(x + nn[0] * 0.3, y + 0.3 * nn[1] + h, z + nn[2] * 0.3) < 0) roof = true;
    const exposure = open * (0.3 + 0.7 * Math.max(0, nn[1]));
    const s = { p: [x, y, z], n: nn, exposure, overhang: nn[1] < -0.25 || roof };
    if (filter && !filter(s)) continue;
    out.push(s);
  }
  return out;
}

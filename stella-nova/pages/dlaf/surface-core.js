// ============================================================================
//  DLAF PAGE  ·  surface-core.js — the DLA cluster as a smooth SDF mesh
// ----------------------------------------------------------------------------
//  DOM-free. The module worker (surface-worker.js), the inline fallback in
//  surface.js and tests.mjs use it. The field and the mesher are
//  lib/dla-sdf.js (createSdf): each particle with a parent is a round cone
//  from the parent to the particle, joined with the smooth minimum of
//  blend k, on a sparse brick lattice. This file adds three things that the
//  page needs and that lib/createTreeSdf does not give:
//
//    1. Pipe radii in batches. The radius of a particle comes from its
//       subtree size (the pipe rule, r^pipe adds at a fork). createTreeSdf
//       resets a cone each time a quantised radius steps. In a dlaf cluster
//       that is about 40 000 cone resets for 10 000 particles, and the lib
//       recompute of the trunk bricks is then 90% of the cost. Here a
//       particle joins with the radius of the moment, and the radius steps
//       wait in a set. A flush applies them when the cluster has grown by
//       15% (at least 256 particles), and when the caller says that the
//       growth stopped (finish). One flush resets each changed cone
//       once, so the cost drops by about 4 and the final field is the same
//       as a full build with the final radii (tests.mjs checks the bits).
//    2. Ambient occlusion per vertex, from the field: 4 samples along the
//       normal (after Quilez, "ambient occlusion from a distance field").
//       The lib lattice clamps the field to the band, which is too short
//       for this, so the samples use the cones directly (a capsule with a
//       linear radius) from a hash grid of the particles, with no clamp.
//       New particles and radius steps mark the near meshes for a new AO.
//    3. Mesh records for the GPU: { key, positions, normals, ids, ao,
//       indices }. ids are particle ids (the nearest cone of the vertex),
//       so the colour of a vertex is the colour value of that particle.
//
//  API
//    const core = createSurfaceCore(opts)   opts from surfaceOptions()
//    core.add(pos, parent, from, to, base = 0)
//                                     particles from..to-1 (ids in order).
//                                     pos[3 (i - base)] is the xyz of id i,
//                                     parent[i - base] its parent (-1 = seed)
//    core.update(ms) -> records       a record with no indices = remove
//    core.finish()                    flush the radius steps now
//    core.busy                        work is left (call update again)
//    core.count, core.stats, core.meshes (Map key -> record)
//
//  grep -n targets
//    resolutions ........... "export const RESOLUTIONS"
//    options ............... "export function surfaceOptions"
//    the core .............. "export function createSurfaceCore"
//    radius flush .......... "function flush"
//    occlusion ............. "function occlusion"
//    update loop ........... "function update"
// ============================================================================
import { createSdf, pipeRadius } from '../../lib/dla-sdf.js';

// Lattice spacing per resolution, in units of ParticleSpacing. rTip is 0.6,
// so a tip tube is 2 cells wide at low and 3.6 cells wide at high.
export const RESOLUTIONS = Object.freeze([
  { id: 'low', label: 'Low', cell: 0.6 },
  { id: 'medium', label: 'Medium', cell: 0.45 },
  { id: 'high', label: 'High', cell: 0.34 },
]);
export const RES_IDS = RESOLUTIONS.map(r => r.id);

// Page defaults. Phones start at low and cannot go past medium.
export const SURFACE_DEFAULTS = Object.freeze({ res: 'medium', blend: 0.55, flow: 0.6, material: 'porcelain' });
export const PHONE_RES_CAP = 'medium';

// The particle count where the surface growth stops, per dim and device.
// Past it the mesh is more than about a million vertices.
export function surfaceCap(dim, phone) {
  if (phone) return dim === 3 ? 5000 : 7000;
  return dim === 3 ? 12000 : 20000;
}

// UI values -> core options. blend and flow are 0..1. The pipe exponent is
// 3 (Murray's law: r^3 of the parent is the sum of r^3 of the kids).
export function surfaceOptions(o = {}) {
  const sp = o.spacing ?? 1;
  let res = RESOLUTIONS.find(r => r.id === o.res) || RESOLUTIONS[1];
  if (o.phone && RES_IDS.indexOf(res.id) > RES_IDS.indexOf(PHONE_RES_CAP)) res = RESOLUTIONS.find(r => r.id === PHONE_RES_CAP);
  const blend = Math.min(1, Math.max(0, o.blend ?? SURFACE_DEFAULTS.blend));
  const flow = Math.min(1, Math.max(0, o.flow ?? SURFACE_DEFAULTS.flow));
  const cell = res.cell * sp, rTip = 0.6 * sp;
  return {
    res: res.id, cell, brick: 8,
    k: (0.12 + 1.5 * blend) * rTip,        // the smooth-min width
    band: 1.5 * cell,
    rTip, rMax: rTip * (1 + 3.5 * flow), pipe: 3, quant: 0.3, sub0: 4,
    seedScale: 1.25,                        // a seed is a sphere this much larger
    aoStep: 0.55 * sp,
  };
}

// The round-cone distance, approximated: a capsule from a to b with a
// radius that goes linearly from ra to rb. AO only (the mesh uses the exact
// lib field).
function capsule(px, py, pz, ax, ay, az, ra, bx, by, bz, rb) {
  const ux = bx - ax, uy = by - ay, uz = bz - az, wx = px - ax, wy = py - ay, wz = pz - az;
  const l2 = ux * ux + uy * uy + uz * uz;
  let t = l2 > 0 ? (wx * ux + wy * uy + wz * uz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = wx - ux * t, dy = wy - uy * t, dz = wz - uz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t);
}

export function createSurfaceCore(opts = surfaceOptions()) {
  const sdf = createSdf({ cell: opts.cell, brick: opts.brick ?? 8, k: opts.k, band: opts.band, maxPrims: 1 << 20 });
  const B = sdf.brick, BW = opts.cell * B;          // brick width in world units
  const rTip = opts.rTip, rMax = opts.rMax, pipe = opts.pipe, quant = opts.quant, sub0 = opts.sub0;
  const seedScale = opts.seedScale ?? 1.25, aoStep = opts.aoStep ?? 0.55;
  const aoReach = 4 * aoStep + rMax + 0.5;           // a cone further than this cannot change a vertex AO

  let cap = 1024, n = 0;
  let X = new Float64Array(cap * 3), par = new Int32Array(cap), sub = new Int32Array(cap);
  let rad = new Float32Array(cap), want = new Float32Array(cap);
  const kids = [];
  const steps = new Set();                          // particles whose quantised radius stepped
  let sinceFlush = 0;

  // hash grid of particle ids for the AO samples
  const G = Math.max(1, aoReach * 0.5), grid = new Map();
  const gk = (x, y, z) => ((Math.floor(x / G) + 4096) * 8192 + (Math.floor(y / G) + 4096)) * 8192 + (Math.floor(z / G) + 4096);

  const meshes = new Map();                         // lib brick key -> record
  const byCoord = new Map();                        // "bx,by,bz" -> lib brick key
  const aoDirty = new Set();
  const stats = { flushes: 0, coneResets: 0, meshed: 0, aoRefresh: 0, verts: 0, tris: 0 };

  function growCap() {
    cap *= 2;
    const x = new Float64Array(cap * 3); x.set(X); X = x;
    const p = new Int32Array(cap); p.set(par); par = p;
    const s = new Int32Array(cap); s.set(sub); sub = s;
    const r = new Float32Array(cap); r.set(rad); rad = r;
    const w = new Float32Array(cap); w.set(want); want = w;
  }

  function cone(i) {
    const p = par[i], o = i * 3;
    if (p < 0) { const r = rad[i] * seedScale; sdf.setPrim(i, X[o], X[o + 1], X[o + 2], r, X[o], X[o + 1], X[o + 2], r); }
    else { const q = p * 3; sdf.setPrim(i, X[q], X[q + 1], X[q + 2], rad[p], X[o], X[o + 1], X[o + 2], rad[i]); }
  }

  // Mark the meshed bricks within aoReach of a box for a new AO.
  function markAO(x0, y0, z0, x1, y1, z1) {
    if (!meshes.size) return;
    const R = aoReach;
    const bx0 = Math.floor((x0 - R) / BW), by0 = Math.floor((y0 - R) / BW), bz0 = Math.floor((z0 - R) / BW);
    const bx1 = Math.floor((x1 + R) / BW), by1 = Math.floor((y1 + R) / BW), bz1 = Math.floor((z1 + R) / BW);
    for (let bz = bz0; bz <= bz1; bz++) for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
      const key = byCoord.get(bx + ',' + by + ',' + bz);
      if (key !== undefined) aoDirty.add(key);
    }
  }
  function markCone(i) {
    const o = i * 3, p = par[i] >= 0 ? par[i] * 3 : o;
    markAO(Math.min(X[o], X[p]), Math.min(X[o + 1], X[p + 1]), Math.min(X[o + 2], X[p + 2]),
      Math.max(X[o], X[p]), Math.max(X[o + 1], X[p + 1]), Math.max(X[o + 2], X[p + 2]));
  }

  function add(pos, parent, from = n, to = from + 1, base = 0) {
    for (let i = from; i < to; i++) {
      if (i !== n) throw new Error(`surface-core: ids must come in order (got ${i}, want ${n})`);
      if (n === cap) growCap();
      const j = i - base, o = i * 3, x = pos[j * 3], y = pos[j * 3 + 1], z = pos[j * 3 + 2], p = parent[j];
      X[o] = x; X[o + 1] = y; X[o + 2] = z; par[i] = p; sub[i] = 1;
      rad[i] = want[i] = pipeRadius(1, rTip, pipe, rMax, quant, sub0);
      kids.push(null);
      if (p >= 0) (kids[p] || (kids[p] = [])).push(i);
      n++;
      cone(i);
      const key = gk(x, y, z); let L = grid.get(key); if (!L) grid.set(key, L = []); L.push(i);
      markCone(i);
      for (let a = p; a >= 0; a = par[a]) {
        sub[a]++;
        const r = pipeRadius(sub[a], rTip, pipe, rMax, quant, sub0);
        if (r !== want[a]) { want[a] = r; steps.add(a); }
      }
      sinceFlush++;
    }
  }

  // Apply the waiting radius steps: each changed particle and its kids get
  // one new cone, in id order.
  function flush() {
    if (!steps.size) { sinceFlush = 0; return 0; }
    const set = new Set();
    for (const a of steps) if (want[a] !== rad[a]) {
      rad[a] = want[a]; set.add(a);
      const K = kids[a]; if (K) for (const c of K) set.add(c);
    }
    steps.clear(); sinceFlush = 0;
    const ids = [...set].sort((a, b) => a - b);
    for (const i of ids) { cone(i); markCone(i); }
    stats.flushes++; stats.coneResets += ids.length;
    return ids.length;
  }

  // AO of one vertex: 4 samples at aoStep * j along the normal. occ is the
  // weighted share of each sample that a cone fills. The cones near a
  // brick are packed once per brick (C, 12 floats each: a, ra, b, rb, the
  // bounding sphere centre and radius); each vertex keeps the ones whose
  // bounding sphere comes within 4 aoStep of it (L), and the samples test
  // only those.
  let C = new Float64Array(12 * 256), nc = 0, L = new Int32Array(256);
  const hMax = 4 * aoStep;
  function gatherCones(x0, y0, z0, x1, y1, z1) {
    nc = 0;
    const R = aoReach;
    const g0x = Math.floor((x0 - R) / G), g1x = Math.floor((x1 + R) / G), g0y = Math.floor((y0 - R) / G), g1y = Math.floor((y1 + R) / G);
    const g0z = Math.floor((z0 - R) / G), g1z = Math.floor((z1 + R) / G);
    for (let gz = g0z; gz <= g1z; gz++) for (let gy = g0y; gy <= g1y; gy++) for (let gx = g0x; gx <= g1x; gx++) {
      const list = grid.get(((gx + 4096) * 8192 + (gy + 4096)) * 8192 + (gz + 4096));
      if (!list) continue;
      for (let q = 0; q < list.length; q++) {
        const i = list[q], o = i * 3, p = par[i];
        if ((nc + 1) * 12 > C.length) { const c2 = new Float64Array(C.length * 2); c2.set(C); C = c2; }
        const c = nc * 12;
        if (p < 0) { const r = rad[i] * seedScale; C[c] = C[c + 4] = X[o]; C[c + 1] = C[c + 5] = X[o + 1]; C[c + 2] = C[c + 6] = X[o + 2]; C[c + 3] = C[c + 7] = r; }
        else { const u = p * 3; C[c] = X[u]; C[c + 1] = X[u + 1]; C[c + 2] = X[u + 2]; C[c + 3] = rad[p]; C[c + 4] = X[o]; C[c + 5] = X[o + 1]; C[c + 6] = X[o + 2]; C[c + 7] = rad[i]; }
        C[c + 8] = (C[c] + C[c + 4]) / 2; C[c + 9] = (C[c + 1] + C[c + 5]) / 2; C[c + 10] = (C[c + 2] + C[c + 6]) / 2;
        C[c + 11] = Math.hypot(C[c + 4] - C[c], C[c + 5] - C[c + 1], C[c + 6] - C[c + 2]) / 2 + Math.max(C[c + 3], C[c + 7]);
        nc++;
      }
    }
    if (L.length < nc) L = new Int32Array(nc * 2);
  }
  function occlusion(px, py, pz, nx, ny, nz) {
    let nl = 0;
    for (let q = 0; q < nc; q++) {
      const c = q * 12, dx = px - C[c + 8], dy = py - C[c + 9], dz = pz - C[c + 10], r = C[c + 11] + hMax;
      if (dx * dx + dy * dy + dz * dz < r * r) L[nl++] = c;
    }
    let occ = 0, wsum = 0;
    for (let j = 1; j <= 4; j++) {
      const h = aoStep * j, sx = px + nx * h, sy = py + ny * h, sz = pz + nz * h;
      let d = h;
      for (let q = 0; q < nl; q++) {
        const c = L[q];
        const e = capsule(sx, sy, sz, C[c], C[c + 1], C[c + 2], C[c + 3], C[c + 4], C[c + 5], C[c + 6], C[c + 7]);
        if (e < d) d = e;
      }
      const w = 1 / j;
      occ += w * Math.max(0, h - Math.max(0, d)) / h; wsum += w;
    }
    const a = 1 - 1.15 * occ / wsum;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  function fillAO(rec) {
    const P = rec.positions, N = rec.normals, nv = P.length / 3;
    const ao = rec.ao && rec.ao.length === nv ? rec.ao : new Float32Array(nv);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let v = 0; v < nv; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    gatherCones(x0, y0, z0, x1, y1, z1);
    for (let v = 0; v < nv; v++) ao[v] = occlusion(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
    rec.ao = ao;
    return rec;
  }

  function store(m) {
    const old = meshes.get(m.key);
    if (old) { stats.verts -= old.positions.length / 3; stats.tris -= old.indices.length / 3; }
    const ck = m.bx + ',' + m.by + ',' + m.bz;
    if (!m.indices.length) { meshes.delete(m.key); byCoord.delete(ck); aoDirty.delete(m.key); return { key: m.key, bx: m.bx, by: m.by, bz: m.bz, positions: m.positions, normals: m.normals, ids: m.ids, ao: new Float32Array(0), indices: m.indices }; }
    const rec = fillAO({ key: m.key, bx: m.bx, by: m.by, bz: m.bz, positions: m.positions, normals: m.normals, ids: m.ids, ao: null, indices: m.indices });
    meshes.set(m.key, rec); byCoord.set(ck, m.key); aoDirty.delete(m.key);
    stats.verts += rec.positions.length / 3; stats.tris += rec.indices.length / 3; stats.meshed++;
    return rec;
  }

  const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

  // One slice of work: the radius flush when it is due, the lib update
  // (recompute and mesh), then new AO for the marked meshes, for about ms.
  function update(ms = Infinity) {
    const t0 = now(), out = [];
    if (steps.size && sinceFlush >= Math.max(256, 0.15 * n)) flush();
    const raw = sdf.update(ms * 0.8);
    for (const m of raw) out.push(store(m));
    if (sdf.dirtyCount === 0) {
      for (const key of aoDirty) {
        if (now() - t0 > ms) break;
        aoDirty.delete(key);
        const rec = meshes.get(key); if (!rec) continue;
        fillAO(rec); stats.aoRefresh++;
        out.push(rec);
      }
    }
    return out;
  }

  // Drain all work (tests, thumbnails): flush, then update until idle.
  function drain() {
    finish();
    const all = [];
    let guard = 0;
    while (busy() && guard++ < 1e6) for (const r of update(Infinity)) all.push(r);
    return all;
  }
  function finish() { flush(); }
  function busy() { return steps.size > 0 || sdf.dirtyCount > 0 || aoDirty.size > 0; }

  return {
    opts, sdf, add, update, finish, drain, meshes, stats,
    get busy() { return busy(); },
    get count() { return n; },
    get pendingSteps() { return steps.size; },
    radius: i => rad[i], sub: i => sub[i],
  };
}

// The colour t of a vertex: the value of its particle through the same
// sum as sim.js colourT and the shader. vals is the per-particle value
// array, ids the vertex ids (a -1 id takes particle 0).
export function vertexT(vals, ids, v, max, floor, gamma) {
  const id = Math.max(0, Math.round(ids[v]));
  const x = Math.min(1, Math.max(0, max > 0 ? vals[id] / max : 0));
  return floor + (1 - floor) * Math.pow(x, gamma);
}

// ============================================================================
//  CORAL REEF  ·  coral surfaces from the DLA trees (DOM-free)
// ----------------------------------------------------------------------------
//  Each colony is one createTreeSdf of lib/dla-sdf.js: round cones along
//  the parent links, radius from the subtree size (pipe rule), joined with
//  a smooth minimum, meshed brick by brick with surface nets. The species
//  set the look with the cone radii, the blend and a post term (a pure
//  per-point shape term that lib/dla-sdf.js applies at mesh time):
//    staghorn ... thin tapered branches, round tips, thick trunks
//    fan ........ thin branch ribs, and a web: a slab in the fan plane
//                 where two ribs are near, so the fan is a webbed net
//    table ...... a stalk, then a flat plate: wide cones cut to a slab at
//                 the height of each plate particle
//    boulder .... fat cones and a wide blend give a smooth dome; a groove
//                 term cuts meandering valleys (contour lines of a slow
//                 noise field, so the valleys run side by side like the
//                 valleys of a brain coral)
//    finger ..... fat soft lobes with a wide blend
//
//  The mesher works in the local frame of the colony (seed at the
//  origin). The page puts each colony in a group at its base. Each vertex
//  carries the global particle index (gid), so the page colours the
//  surface from per-particle data textures (no re-mesh on a colour change).
//
//  Polyps: scatterPolyps() puts polyp cups on the triangles of a brick by
//  area (density per species), more at the tips (small subtrees). Each
//  polyp is 8 floats: x y z, nx ny nz (surface normal), gid, rand.
//
//  USE (page worker, page main thread fallback, node tests)
//    const M = createCoralMesher();
//    M.addColony({ k, id: 'staghorn', normal: [nx, nz] });
//    M.add(k, local, parent, x, y, z, gid);     // local frame, ids in order
//    const out = M.update(ms);                  // [{ k, key, chunk, positions, normals, gids, indices, polyps }]
//    M.meshColony(k) -> all brick results now (tests, thumbnails)
//
//  grep -n targets
//    species shapes ......... "export const SHAPES"
//    the post terms ......... "function postFor"
//    brain groove ........... "export function groove"
//    polyp scatter .......... "export function scatterPolyps"
//    the mesher ............. "export function createCoralMesher"
//    chunk of a brick ....... "export function chunkKey"
// ============================================================================
import { createTreeSdf, smin } from '../../lib/dla-sdf.js';
import { noise3 } from './terrain.js';

// cell: lattice spacing. k: blend. bend, hold: branch smoothing (the cone
// ends follow part of the parent direction, then move back toward the
// particle). rTip, pipe, rMax, sub0, quant: the pipe
// rule (lib/dla-sdf.js pipeRadius). rootScale: a root sphere is this much
// larger. band: stored field band (past the largest outward post term).
// polyp: density (per unit area), tip (extra density at the tips), size.
export const SHAPES = {
  staghorn: { cell: 0.27, k: 0.8, bend: 0.5, hold: 0.25, rTip: 0.42, pipe: 3.2, rMax: 1.35, sub0: 2, quant: 0.16, rootScale: 1.7, band: 0.55,
    polyp: { density: 0.9, tip: 2.5, size: 0.2, max: 120 } },
  fan: { cell: 0.16, k: 0.25, rTip: 0.2, pipe: 3, rMax: 0.55, sub0: 3, quant: 0.2, rootScale: 2, band: 0.85,
    web: 0.62, half: 0.11, polyp: { density: 3.2, tip: 1, size: 0.1, max: 260 } },
  table: { cell: 0.3, k: 0.5, bend: 0.3, hold: 0.4, rTip: 0.6, pipe: 3, rMax: 1.5, sub0: 2, quant: 0.2, rootScale: 1.6, band: 0.72,
    inflate: 0.35, half: 0.38, polyp: { density: 1.8, tip: 1.5, size: 0.17, max: 260 } },
  boulder: { cell: 0.34, k: 1.0, rTip: 1.0, pipe: 4, rMax: 1.4, sub0: 3, quant: 0.25, rootScale: 1.4, band: 0.5,
    groove: 0.22, polyp: { density: 0.25, tip: 0, size: 0.16, max: 80 } },
  finger: { cell: 0.32, k: 0.75, bend: 0.4, hold: 0.3, rTip: 0.6, pipe: 3, rMax: 1.5, sub0: 2, quant: 0.22, rootScale: 1.5, band: 0.45,
    polyp: { density: 2.0, tip: 1, size: 0.24, max: 200 } },
};
export const SHAPE_IDS = Object.keys(SHAPES);
export const BRICK = 8;
export const CHUNK = 6;        // bricks per chunk edge (the page draws one mesh per chunk)

export function chunkKey(bx, by, bz) {
  const c = v => Math.floor(v / CHUNK);
  return `${c(bx)},${c(by)},${c(bz)}`;
}

function smax(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; }

// Brain coral valleys: the contour lines of a slow noise field f, at
// spacing 1 / 3.4 of its range, so the valleys run side by side and
// meander. 0 on a ridge, 1 in the middle of a valley.
export function groove(x, y, z) {
  const f = noise3(x * 0.16 + 3.1, y * 0.16, z * 0.16) * 3.4 + noise3(x * 0.55, y * 0.55 + 5, z * 0.55) * 0.35;
  const s = Math.abs(Math.sin(f * Math.PI * 2));
  const t = Math.min(1, s / 0.42);
  return 1 - t * t * (3 - 2 * t);
}

// The post term of a colony: (x, y, z, d, id) -> d', local frame.
function postFor(sh, col) {
  if (col.id === 'fan') {
    // ribs: the tree field d; web: a slab in the fan plane where the field
    // inflated by sh.web is inside
    const nx = col.normal[0], nz = col.normal[1], W = sh.web, T = sh.half;
    return (x, y, z, d) => {
      const pd = Math.abs(x * nx + z * nz);
      const web = smax(d - W, pd - T, 0.18);
      return smin(d, web, 0.12);
    };
  }
  if (col.id === 'table') {
    // plate particles (depth >= stalk) are cut to a slab at their height
    const stalk = col.stalk || 7, I = sh.inflate, T = sh.half;
    return (x, y, z, d, id) => {
      if (id < 0 || col.depth[id] < stalk) return d;
      const slab = Math.abs(y - col.local[id * 3 + 1]) - T;
      return smax(d - I, slab, 0.3);
    };
  }
  if (col.id === 'boulder') {
    const A = sh.groove;
    return (x, y, z, d) => d > 0.6 ? d : d + A * groove(x, y, z) * Math.min(1, Math.max(0, 1 - d / 0.6));
  }
  return null;
}

// Hash of two ints to 0..1 (deterministic polyp places).
function h01(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Polyps on a brick mesh: about density x area x (1 + tip x tipness)
// per triangle. tipOf(local id) -> 0..1 (1 at a tip). gidOf(local id).
export function scatterPolyps(mesh, pol, tipOf, gidOf, seed) {
  const P = mesh.positions, N = mesh.normals, I = mesh.indices, ID = mesh.ids;
  const out = [];
  let n = 0;
  for (let t = 0; t < I.length && n < pol.max; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const id = ID[a] >= 0 ? ID[a] : ID[b] >= 0 ? ID[b] : ID[c];
    if (id < 0) continue;
    const tip = tipOf(id);
    let want = area * pol.density * (1 + pol.tip * tip);
    const r0 = h01(seed, t);
    let k = Math.floor(want) + (r0 < want - Math.floor(want) ? 1 : 0);
    for (let q = 0; q < k && n < pol.max; q++) {
      let s1 = h01(seed + q * 7919, t + 1), s2 = h01(seed + q * 104729, t + 2);
      if (s1 + s2 > 1) { s1 = 1 - s1; s2 = 1 - s2; }
      const w0 = 1 - s1 - s2;
      let nx = N[a * 3] * w0 + N[b * 3] * s1 + N[c * 3] * s2;
      let ny = N[a * 3 + 1] * w0 + N[b * 3 + 1] * s1 + N[c * 3 + 1] * s2;
      let nz = N[a * 3 + 2] * w0 + N[b * 3 + 2] * s1 + N[c * 3 + 2] * s2;
      const l = Math.hypot(nx, ny, nz) || 1;
      out.push(
        P[a * 3] * w0 + P[b * 3] * s1 + P[c * 3] * s2,
        P[a * 3 + 1] * w0 + P[b * 3 + 1] * s1 + P[c * 3 + 1] * s2,
        P[a * 3 + 2] * w0 + P[b * 3 + 2] * s1 + P[c * 3 + 2] * s2,
        nx / l, ny / l, nz / l, gidOf(id), h01(seed ^ 0x5bd1e995, t + q));
      n++;
    }
  }
  return new Float32Array(out);
}

export function createCoralMesher(opts = {}) {
  const cols = new Map();
  const polypScale = opts.polyps ?? 1;
  let turn = 0;
  const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

  // desc: { k, id, normal: [nx, nz], stalk }
  function addColony(desc) {
    const sh = SHAPES[desc.id] || SHAPES.staghorn;
    const col = { k: desc.k, id: desc.id, sh, normal: desc.normal || [1, 0], stalk: desc.stalk,
      local: new Float64Array(3 * 1024), sm: new Float64Array(3 * 1024), dir: new Float64Array(3 * 1024),
      depth: new Int32Array(1024), gid: new Int32Array(1024), n: 0 };
    col.tree = createTreeSdf({
      cell: sh.cell, brick: BRICK, k: sh.k, band: sh.band, rTip: sh.rTip, pipe: sh.pipe, rMax: sh.rMax,
      sub0: sh.sub0, quant: sh.quant, rootScale: sh.rootScale, post: postFor(sh, col),
    });
    cols.set(desc.k, col);
    return col;
  }

  function add(k, i, parent, x, y, z, gid) {
    const col = cols.get(k); if (!col) return;
    if (i !== col.n) return;                     // ids in order (a gap means a lost message)
    if (i * 3 + 3 > col.local.length) {
      const L = new Float64Array(col.local.length * 2); L.set(col.local); col.local = L;
      const SM = new Float64Array(col.sm.length * 2); SM.set(col.sm); col.sm = SM;
      const DI = new Float64Array(col.dir.length * 2); DI.set(col.dir); col.dir = DI;
      const D = new Int32Array(col.depth.length * 2); D.set(col.depth); col.depth = D;
      const G = new Int32Array(col.gid.length * 2); G.set(col.gid); col.gid = G;
    }
    col.local[i * 3] = x; col.local[i * 3 + 1] = y; col.local[i * 3 + 2] = z;
    col.depth[i] = parent < 0 ? 0 : col.depth[parent] + 1;
    col.gid[i] = gid;
    col.n++;
    // the cone end: a smoothed copy of the particle, so a DLA chain that
    // zig-zags becomes a smooth branch. The direction keeps part of the
    // parent's direction (sh.bend), then the point is pulled back toward
    // the particle (sh.hold), so the drift stays small.
    let sx = x, sy = y, sz = z;
    const S = col.sm, sh = col.sh;
    if (parent >= 0 && sh.bend > 0) {
      const px = S[parent * 3], py = S[parent * 3 + 1], pz = S[parent * 3 + 2];
      let dx = x - col.local[parent * 3], dy = y - col.local[parent * 3 + 1], dz = z - col.local[parent * 3 + 2];
      const l = Math.hypot(dx, dy, dz) || 1;
      const qx = col.dir[parent * 3], qy = col.dir[parent * 3 + 1], qz = col.dir[parent * 3 + 2];
      dx = dx / l * (1 - sh.bend) + qx * sh.bend; dy = dy / l * (1 - sh.bend) + qy * sh.bend; dz = dz / l * (1 - sh.bend) + qz * sh.bend;
      const m = Math.hypot(dx, dy, dz) || 1;
      dx /= m; dy /= m; dz /= m;
      col.dir[i * 3] = dx; col.dir[i * 3 + 1] = dy; col.dir[i * 3 + 2] = dz;
      sx = px + dx * l; sy = py + dy * l; sz = pz + dz * l;
      sx += (x - sx) * sh.hold; sy += (y - sy) * sh.hold; sz += (z - sz) * sh.hold;
    } else if (parent >= 0) {
      const dx = x - col.local[parent * 3], dy = y - col.local[parent * 3 + 1], dz = z - col.local[parent * 3 + 2], l = Math.hypot(dx, dy, dz) || 1;
      col.dir[i * 3] = dx / l; col.dir[i * 3 + 1] = dy / l; col.dir[i * 3 + 2] = dz / l;
    } else { col.dir[i * 3 + 1] = 1; }
    S[i * 3] = sx; S[i * 3 + 1] = sy; S[i * 3 + 2] = sz;
    col.tree.add(i, sx, sy, sz, parent);
  }

  function result(col, m) {
    const sh = col.sh, pol = sh.polyp;
    const tipOf = id => { const s = col.tree.sub(id); return s <= 1 ? 1 : Math.max(0, 1 - Math.log2(s) / 5); };
    const gidOf = id => col.gid[id];
    const gids = new Float32Array(m.ids.length);
    for (let v = 0; v < m.ids.length; v++) gids[v] = m.ids[v] >= 0 ? col.gid[m.ids[v]] : -1;
    const polyps = m.indices.length && polypScale > 0
      ? scatterPolyps(m, { density: pol.density * polypScale, tip: pol.tip, max: Math.ceil(pol.max * polypScale) }, tipOf, gidOf, (m.key % 2147483647) ^ (col.k * 7919))
      : new Float32Array(0);
    return { k: col.k, key: m.key, chunk: chunkKey(m.bx, m.by, m.bz), bx: m.bx, by: m.by, bz: m.bz,
      positions: m.positions, normals: m.normals, gids, indices: m.indices, polyps };
  }

  // Mesh dirty bricks of all colonies for about ms, colonies in turn.
  function update(ms = 8, out = []) {
    const t0 = now();
    const list = [...cols.values()];
    if (!list.length) return out;
    for (let q = 0; q < list.length; q++) {
      const col = list[(turn + q) % list.length];
      if (!col.tree.sdf.dirtyCount) continue;
      const left = ms - (now() - t0);
      if (left <= 0) break;
      const share = Math.max(1, left / Math.max(1, list.length - q));
      const res = col.tree.update(share);
      for (const m of res) out.push(result(col, m));
    }
    turn++;
    return out;
  }

  function meshColony(k) {
    const col = cols.get(k); if (!col) return [];
    return col.tree.sdf.meshAll().map(m => result(col, m));
  }

  function dirty() { let n = 0; for (const c of cols.values()) n += c.tree.sdf.dirtyCount; return n; }

  return {
    addColony, add, update, meshColony, dirty, cols,
    reset() { cols.clear(); turn = 0; },
    stats() { let b = 0, p = 0; for (const c of cols.values()) { b += c.tree.sdf.stats.bricks; p += c.n; } return { colonies: cols.size, bricks: b, particles: p }; },
  };
}

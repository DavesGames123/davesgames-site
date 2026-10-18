// ============================================================================
//  CORAL REEF  ·  coral surfaces from the shared DLA tree (DOM-free)
// ----------------------------------------------------------------------------
//  One createTreeSdf of lib/dla-sdf.js per SPECIES, in the world frame
//  (metres). All colonies of a species write into the same field, so two
//  colonies of one species that touch fuse into one smooth surface (the
//  smooth minimum joins them). Colonies of two species have two fields:
//  where they meet, one surface grows over the other. Each field: round
//  cones along the parent links, radius from the subtree size (pipe rule),
//  joined with a smooth minimum, meshed brick by brick with surface nets,
//  only the bricks that changed. The species set the look with the cone
//  radii, the blend and a post term (a pure per-point shape term that
//  lib/dla-sdf.js applies at mesh time):
//    staghorn ... thin tapered branches (1.2 cm tips), round tips
//    fan ........ thin ribs, and a web: a slab in the fan plane where two
//                 ribs are near, so the fan is a fine webbed net
//    table ...... a stalk, then a flat plate: cones cut to a slab at the
//                 height of each plate particle
//    boulder .... (brain coral) fat cones and a wide blend give a smooth
//                 dome; a groove term cuts meandering valleys
//    finger ..... soft lobes with a wide blend
//
//  Each vertex carries the global particle id (gid), so the page colours
//  the surface from per-particle data (no re-mesh on a colour change).
//
//  POLYPS. scatterPolyps() puts polyp cups on the triangles of a brick by
//  area: SHAPES[id].polyp.density per m^2 (x the quality scale), more at
//  the tips. Each polyp is 8 floats: x y z, nx ny nz (surface normal),
//  gid, rand. rand is uniform in 0..1 and independent of the place, so the
//  page can cull polyps by distance (LOD): draw a polyp when rand < keep(d).
//  SHAPES[id].polyp.size is the polyp radius (m) for the page template.
//
//  LOD. Each species has two fields: a fine one (the SHAPES cell) that
//  holds only the FOCUS colonies (the nearest to the cameras, set by
//  setFocus) and a coarse one (LOD_K x the cell, thin parts made half a
//  coarse cell thick) that holds every colony. So the fine triangles stay
//  in the budget, and far colonies cost little. Polyps are only on the
//  fine bricks. A focus change refills the fine field of that species.
//
//  USE (the reef worker, node tests, thumbnails)
//    const M = createCoralMesher({ polyps, fine, radius, lod = true });
//                                  // lod false: one fine field, all colonies
//    M.addColony({ k, id, base, plane, stalk });   // colonyInfo() of reef.js
//    M.add(g, parent, x, y, z, k);                 // world metres, ids in order
//    M.fields: Map field key -> { id, lev, cell, origin, tree, SM (cone
//              ends, field frame), localOf (global id -> field id), ... }
//    M.setFocus([k, ...])                          // the fine-mesh colonies
//    const out = M.update(ms);   // [{ sp, lod, field, k: -1, key, chunk, bx, by, bz,
//                                //    cell, positions, normals, gids, indices,
//                                //    polyps, tris }]
//    M.meshAll(lev?) -> all brick results now (tests, thumbnails)
//    M.stats() -> { colonies, particles, bricks, tris, trisFine, trisCoarse,
//                   polyps, dirty, focus }
//
//  A result with no indices means "remove this brick". A brick is unique
//  by field + key (field: 'staghorn|0', 'staghorn|1', 'fan|0|12', ...).
//  chunk is a CHUNK_M cube in world metres: the page draws one mesh per
//  sp + lod + chunk.
//
//  grep -n targets
//    species shapes ......... "export const SHAPES"
//    the post terms ......... "function postFor"
//    brain groove ........... "export function groove"
//    polyp scatter .......... "export function scatterPolyps"
//    the mesher ............. "export function createCoralMesher"
//    chunk of a brick ....... "export function chunkKey"
//    smooth branch points ... "function smoothPoint"
//    the coarse field ....... "function makeField"
//    focus change ........... "function setFocus"
// ============================================================================
import { createTreeSdf, smin } from '../../lib/dla-sdf.js';

// Metres. cell: lattice spacing. k: blend. bend, hold: branch smoothing
// (the cone ends keep part of the parent direction, then move back toward
// the particle). rTip, pipe, rMax, sub0, quant: the pipe rule (lib/dla-sdf.js
// pipeRadius). rootScale: a root sphere is this much larger. band: stored
// field band (past the largest outward post term). polyp: density per m^2,
// tip (extra density at the tips), size (polyp radius, m), max per brick.
export const SHAPES = {
  staghorn: { cell: 0.0115, k: 0.018, bend: 0.5, hold: 0.25, rTip: 0.011, pipe: 4, rMax: 0.019, sub0: 3, quant: 0.16, rootScale: 1.4, band: 0.022,
    polyp: { density: 3600, tip: 2.5, size: 0.0032, max: 700 } },
  fan: { own: true, cell: 0.0055, k: 0.005, bend: 0.25, hold: 0.4, rTip: 0.0028, pipe: 3.5, rMax: 0.008, sub0: 3, quant: 0.2, rootScale: 2, band: 0.03,
    web: 0.011, half: 0.0028, polyp: { density: 14000, tip: 1, size: 0.0016, max: 900 } },
  table: { cell: 0.016, k: 0.02, bend: 0.3, hold: 0.4, rTip: 0.015, pipe: 3, rMax: 0.05, sub0: 2, quant: 0.2, rootScale: 1.6, band: 0.034,
    inflate: 0.012, half: 0.011, polyp: { density: 5000, tip: 1.5, size: 0.003, max: 700 } },
  boulder: { cell: 0.022, k: 0.08, rTip: 0.06, pipe: 4, rMax: 0.08, sub0: 3, quant: 0.25, rootScale: 1.4, band: 0.035,
    groove: 0.03, polyp: { density: 240, tip: 0, size: 0.006, max: 160 } },
  finger: { cell: 0.012, k: 0.018, bend: 0.4, hold: 0.3, rTip: 0.013, pipe: 3.4, rMax: 0.032, sub0: 2, quant: 0.22, rootScale: 1.5, band: 0.03,
    polyp: { density: 5000, tip: 1, size: 0.0045, max: 700 } },
};
export const SHAPE_IDS = Object.keys(SHAPES);
export const BRICK = 8;
export const CHUNK_M = 2;      // chunk edge (m): the page draws one mesh per chunk and species

// The chunk of a brick: bricks whose lower corner (world metres, field
// origin O added) is in one CHUNK_M cube.
export function chunkKey(bx, by, bz, cell, O = [0, 0, 0]) {
  const B = BRICK * cell, c = v => Math.floor(v / CHUNK_M);
  return `${c(bx * B + O[0])},${c(by * B + O[1])},${c(bz * B + O[2])}`;
}

function smax(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; }

// value noise (own code), -1..1
function vh(i, j, k) { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1440662683); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1; }
export function noise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = x - i, fy = y - j, fz = z - k;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const a = vh(i, j, k) + (vh(i + 1, j, k) - vh(i, j, k)) * u, b = vh(i, j + 1, k) + (vh(i + 1, j + 1, k) - vh(i, j + 1, k)) * u;
  const c = vh(i, j, k + 1) + (vh(i + 1, j, k + 1) - vh(i, j, k + 1)) * u, d = vh(i, j + 1, k + 1) + (vh(i + 1, j + 1, k + 1) - vh(i, j + 1, k + 1)) * u;
  const e = a + (b - a) * v, f = c + (d - c) * v;
  return e + (f - e) * w;
}

// Brain coral valleys: the contour lines of a slow noise field f (metres),
// so the valleys run side by side and meander, about 9 cm apart. 0 on a
// ridge, 1 in the middle of a valley.
export function groove(x, y, z) {
  const f = noise3(x * 1.6 + 3.1, y * 1.6, z * 1.6) * 3.4 + noise3(x * 5.5, y * 5.5 + 5, z * 5.5) * 0.35;
  const s = Math.abs(Math.sin(f * Math.PI * 2));
  const t = Math.min(1, s / 0.42);
  return 1 - t * t * (3 - 2 * t);
}

// The post term of a species field: (x, y, z, d, id) -> d', id = the
// local prim id (the nearest cone). C: the colony of each prim.
function postFor(id, sh, S) {
  if (id === 'fan') {
    // ribs: the tree field d; web: a slab in the plane of the colony where
    // the field inflated by sh.web is inside
    const W = sh.web, T = sh.half;
    return (x, y, z, d, pid) => {
      if (pid < 0 || d > W + 0.01) return d;
      const c = S.cols.get(S.colOf[pid]);
      const pd = Math.abs((x - c.base[0]) * c.plane[0] + (z - c.base[2]) * c.plane[1]);
      const web = smax(d - W, pd - T, 0.006);
      return smin(d, web, 0.005);
    };
  }
  if (id === 'table') {
    // plate particles (depth >= stalk) are cut to a slab at their height
    const I = sh.inflate, T = sh.half;
    return (x, y, z, d, pid) => {
      if (pid < 0) return d;
      const c = S.cols.get(S.colOf[pid]);
      if (S.depth[pid] < (c.stalk || 7)) return d;
      const slab = Math.abs(y - S.Y[pid]) - T;
      return smax(d - I, slab, 0.012);
    };
  }
  if (id === 'boulder') {
    const A = sh.groove;
    return (x, y, z, d) => d > 0.03 ? d : d + A * groove(x, y, z) * Math.min(1, Math.max(0, 1 - d / 0.03));
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
    const want = area * pol.density * (1 + pol.tip * tip);
    const r0 = h01(seed, t);
    const k = Math.floor(want) + (r0 < want - Math.floor(want) ? 1 : 0);
    for (let q = 0; q < k && n < pol.max; q++) {
      let s1 = h01(seed + q * 7919, t + 1), s2 = h01(seed + q * 104729, t + 2);
      if (s1 + s2 > 1) { s1 = 1 - s1; s2 = 1 - s2; }
      const w0 = 1 - s1 - s2;
      const nx = N[a * 3] * w0 + N[b * 3] * s1 + N[c * 3] * s2;
      const ny = N[a * 3 + 1] * w0 + N[b * 3 + 1] * s1 + N[c * 3 + 1] * s2;
      const nz = N[a * 3 + 2] * w0 + N[b * 3 + 2] * s1 + N[c * 3 + 2] * s2;
      const l = Math.hypot(nx, ny, nz) || 1;
      out.push(
        P[a * 3] * w0 + P[b * 3] * s1 + P[c * 3] * s2,
        P[a * 3 + 1] * w0 + P[b * 3 + 1] * s1 + P[c * 3 + 1] * s2,
        P[a * 3 + 2] * w0 + P[b * 3 + 2] * s1 + P[c * 3 + 2] * s2,
        nx / l, ny / l, nz / l, gidOf(id), h01(seed ^ 0x5bd1e995, t * 31 + q));
      n++;
    }
  }
  return new Float32Array(out);
}

export const LOD_K = 3;         // coarse cell = LOD_K x fine cell

export function createCoralMesher(opts = {}) {
  const polypScale = opts.polyps ?? 1;
  const fine = opts.fine ?? 1;
  const radius = opts.radius ?? 30;
  const useLod = opts.lod !== false;
  const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
  // the brick keys of lib/dla-sdf.js hold -512..511 bricks per axis: the
  // cell is at least (radius x 1.1) / (511 x BRICK), so the plot fits
  const minCell = radius * 1.1 / (511 * BRICK);
  const cols = new Map();          // k -> { k, id, base, plane, stalk, focus }
  const fields = new Map();        // id|lev -> F
  // every particle, in global order (to refill a fine field on a focus change)
  let cap = 4096, n = 0;
  let PX = new Float64Array(cap * 3), PAR = new Int32Array(cap), PCOL = new Int32Array(cap);
  let turn = 0;
  const removals = [];             // results that remove bricks (focus changes)
  let tris = [0, 0], polypN = 0;

  // The key of the fine field of a colony: one per species, or one per
  // colony for a species with own: true (sea fans: they do not fuse, and a
  // field with its origin at the colony base can have a cell finer than
  // the plot-wide limit minCell).
  function fineKey(c) { return (SHAPES[c.id] || SHAPES.staghorn).own ? `${c.id}|0|${c.k}` : `${c.id}|0`; }

  function makeField(id, lev, c) {
    const sh0 = SHAPES[id] || SHAPES.staghorn;
    const own = lev === 0 && sh0.own && c;
    const key = own ? fineKey(c) : id + '|' + lev;
    let F = fields.get(key);
    if (F) return F;
    const cell0 = own ? sh0.cell * fine : Math.max(minCell, sh0.cell * fine);
    const r = cell0 / sh0.cell;                 // everything scales with the cell
    const sh = scaled(sh0, r);
    let cell = cell0;
    if (lev === 1) {
      // the coarse field: LOD_K x the cell; thin parts are made just thick
      // enough for the coarse lattice (half a cell), slabs too
      cell = cell0 * LOD_K;
      sh.rTip = Math.max(sh.rTip, 0.5 * cell); sh.rMax = Math.max(sh.rMax, sh.rTip * 1.25);
      sh.k = Math.max(sh.k, cell); sh.band = Math.max(sh.band, 2.2 * cell);
      if (sh.half !== undefined) sh.half = Math.max(sh.half, 0.55 * cell);
      if (sh.web !== undefined) sh.web = Math.max(sh.web, 1.5 * cell);
      if (sh.inflate !== undefined) sh.inflate = Math.max(sh.inflate, 0.5 * cell);
      sh.groove = 0;
    }
    const O = own ? c.base.slice() : [0, 0, 0];
    F = { key, id, lev, sh, cell, cols, n: 0, cap: 1024, live: new Map(), origin: O,
      X: new Float64Array(3 * 1024), Y: new Float64Array(1024), SM: new Float64Array(3 * 1024), DIR: new Float64Array(3 * 1024),
      depth: new Int32Array(1024), gid: new Int32Array(1024), colOf: new Int32Array(1024), localOf: new Map() };
    F.tree = createTreeSdf({
      cell, brick: BRICK, k: sh.k, band: sh.band, rTip: sh.rTip, pipe: sh.pipe, rMax: sh.rMax,
      sub0: sh.sub0, quant: sh.quant, rootScale: sh.rootScale, maxPrims: 1 << 22,
      post: wrapPost(postFor(id, sh, F), O),
    });
    fields.set(key, F);
    return F;
  }
  // post terms work in world metres: add the field origin
  function wrapPost(f, O) {
    if (!f || (O[0] === 0 && O[1] === 0 && O[2] === 0)) return f;
    return (x, y, z, d, id) => f(x + O[0], y + O[1], z + O[2], d, id);
  }
  function scaled(sh, r) {
    const o = Object.assign({}, sh);
    for (const k of ['cell', 'k', 'band', 'rTip', 'rMax', 'web', 'half', 'inflate', 'groove']) if (o[k] !== undefined) o[k] *= r;
    return o;
  }

  // desc: colonyInfo() of reef.js { k, id, base, plane, stalk }
  function addColony(desc) {
    const c = { k: desc.k, id: desc.id, base: desc.base.slice(), plane: (desc.plane || [1, 0]).slice(), stalk: desc.stalk, focus: !useLod || !!desc.focus };
    cols.set(desc.k, c);
    if (c.focus) makeField(desc.id, 0, c);
    if (useLod) makeField(desc.id, 1);
  }

  function growF(F) {
    F.cap *= 2;
    for (const [k, T, w] of [['X', Float64Array, 3], ['Y', Float64Array, 1], ['SM', Float64Array, 3], ['DIR', Float64Array, 3], ['depth', Int32Array, 1], ['gid', Int32Array, 1], ['colOf', Int32Array, 1]]) {
      const a = new T(F.cap * w); a.set(F[k]); F[k] = a;
    }
  }

  // The cone end of particle i: a smoothed copy of the particle, so a DLA
  // chain that zig-zags becomes a smooth branch. The direction keeps part
  // of the parent's direction (sh.bend), then the point moves back toward
  // the particle (sh.hold), so the drift stays small.
  function smoothPoint(F, i, p, x, y, z) {
    const sh = F.sh, SM = F.SM, D = F.DIR, X = F.X;
    if (p < 0) { D[i * 3] = 0; D[i * 3 + 1] = 1; D[i * 3 + 2] = 0; SM[i * 3] = x; SM[i * 3 + 1] = y; SM[i * 3 + 2] = z; return; }
    let dx = x - X[p * 3], dy = y - X[p * 3 + 1], dz = z - X[p * 3 + 2];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    if (sh.bend > 0) {
      dx = dx * (1 - sh.bend) + D[p * 3] * sh.bend; dy = dy * (1 - sh.bend) + D[p * 3 + 1] * sh.bend; dz = dz * (1 - sh.bend) + D[p * 3 + 2] * sh.bend;
      const m = Math.hypot(dx, dy, dz) || 1; dx /= m; dy /= m; dz /= m;
    }
    D[i * 3] = dx; D[i * 3 + 1] = dy; D[i * 3 + 2] = dz;
    let sx = SM[p * 3] + dx * l, sy = SM[p * 3 + 1] + dy * l, sz = SM[p * 3 + 2] + dz * l;
    const hold = sh.bend > 0 ? sh.hold : 1;
    sx += (x - sx) * hold; sy += (y - sy) * hold; sz += (z - sz) * hold;
    SM[i * 3] = sx; SM[i * 3 + 1] = sy; SM[i * 3 + 2] = sz;
  }

  function addTo(F, g, parent, wx, wy, wz, k) {
    const x = wx - F.origin[0], y = wy - F.origin[1], z = wz - F.origin[2];
    let p = -1;
    if (parent >= 0) { p = F.localOf.get(parent); if (p === undefined) return false; }
    if (F.n === F.cap) growF(F);
    const i = F.n++;
    F.X[i * 3] = x; F.X[i * 3 + 1] = y; F.X[i * 3 + 2] = z; F.Y[i] = wy;
    F.depth[i] = p < 0 ? 0 : F.depth[p] + 1; F.gid[i] = g; F.colOf[i] = k;
    F.localOf.set(g, i);
    smoothPoint(F, i, p, x, y, z);
    F.tree.add(i, F.SM[i * 3], F.SM[i * 3 + 1], F.SM[i * 3 + 2], p);
    return true;
  }

  // Particle g (global id, in order) at world (x, y, z), parent (global id
  // or -1), colony k. Returns false for a particle out of order.
  function add(g, parent, x, y, z, k) {
    const c = cols.get(k); if (!c || g !== n) return false;
    if (n === cap) {
      cap *= 2;
      const a = new Float64Array(cap * 3); a.set(PX); PX = a;
      const b = new Int32Array(cap); b.set(PAR); PAR = b;
      const d = new Int32Array(cap); d.set(PCOL); PCOL = d;
    }
    PX[g * 3] = x; PX[g * 3 + 1] = y; PX[g * 3 + 2] = z; PAR[g] = parent; PCOL[g] = k; n++;
    if (useLod) addTo(fields.get(c.id + '|1'), g, parent, x, y, z, k);
    if (c.focus) addTo(makeField(c.id, 0, c), g, parent, x, y, z, k);
    return true;
  }

  // The fine field of each species holds only the focus colonies. A
  // change of focus refills each fine field whose colonies changed: its
  // old bricks are removed (empty results), then the particles of its
  // focus colonies are added again in global order.
  function setFocus(ks) {
    if (!useLod) return false;
    const want = new Set(ks);
    const changed = new Set();
    for (const c of cols.values()) { const f = want.has(c.k); if (f !== c.focus) { c.focus = f; changed.add(fineKey(c)); } }
    for (const key of changed) {
      const old = fields.get(key);
      if (old) {
        for (const [bk, b] of old.live) {
          tris[0] -= b[0]; polypN -= b[1];
          removals.push({ sp: old.id, lod: 0, k: -1, key: bk, field: key, chunk: b[2], cell: old.cell, positions: new Float32Array(0), normals: new Float32Array(0), gids: new Float32Array(0), indices: new Uint16Array(0), polyps: new Float32Array(0), tris: 0 });
        }
        fields.delete(key);
      }
      const members = [...cols.values()].filter(c => c.focus && fineKey(c) === key);
      if (!members.length) continue;
      const F = makeField(members[0].id, 0, members[0]);
      const inF = new Set(members.map(c => c.k));
      for (let g = 0; g < n; g++) if (inF.has(PCOL[g])) addTo(F, g, PAR[g], PX[g * 3], PX[g * 3 + 1], PX[g * 3 + 2], PCOL[g]);
    }
    return changed.size > 0;
  }
  function focus() { const out = []; for (const c of cols.values()) if (c.focus) out.push(c.k); return out; }

  function result(F, m) {
    const pol = F.sh.polyp, O = F.origin;
    if (O[0] !== 0 || O[1] !== 0 || O[2] !== 0) {
      const P = m.positions;
      for (let v = 0; v < P.length; v += 3) { P[v] += O[0]; P[v + 1] += O[1]; P[v + 2] += O[2]; }
    }
    const tipOf = id => { const s = F.tree.sub(id); return s <= 1 ? 1 : Math.max(0, 1 - Math.log2(s) / 5); };
    const gidOf = id => F.gid[id];
    const gids = new Float32Array(m.ids.length);
    for (let v = 0; v < m.ids.length; v++) gids[v] = m.ids[v] >= 0 ? F.gid[m.ids[v]] : -1;
    const polyps = F.lev === 0 && m.indices.length && polypScale > 0
      ? scatterPolyps(m, { density: pol.density * polypScale, tip: pol.tip, max: Math.ceil(pol.max * Math.max(1, polypScale)) }, tipOf, gidOf, (m.key % 2147483647) ^ (F.id.length * 7919))
      : new Float32Array(0);
    const nt = m.indices.length / 3;
    const chunk = chunkKey(m.bx, m.by, m.bz, F.cell, O);
    const old = F.live.get(m.key);
    if (old) { tris[F.lev] -= old[0]; polypN -= old[1]; }
    if (nt) { F.live.set(m.key, [nt, polyps.length / 8, chunk]); tris[F.lev] += nt; polypN += polyps.length / 8; } else F.live.delete(m.key);
    return { sp: F.id, lod: F.lev, k: -1, key: m.key, field: F.key, chunk, bx: m.bx, by: m.by, bz: m.bz, cell: F.cell,
      positions: m.positions, normals: m.normals, gids, indices: m.indices, polyps, tris: nt };
  }

  // Removals first, then mesh dirty bricks of all fields for about ms, in
  // turn (the coarse fields first in each round, so the whole reef shows).
  function update(ms = 8, out = []) {
    const t0 = now();
    while (removals.length) out.push(removals.shift());
    const list = [...fields.values()].sort((a, b) => b.lev - a.lev);
    if (!list.length) return out;
    for (let q = 0; q < list.length; q++) {
      const F = list[(turn + q) % list.length];
      if (!F.tree.sdf.dirtyCount) continue;
      const left = ms - (now() - t0);
      if (left <= 0) break;
      const share = Math.max(1, left / Math.max(1, list.length - q));
      for (const m of F.tree.update(share)) out.push(result(F, m));
    }
    turn++;
    return out;
  }

  // Every brick now. lev: 0 fine, 1 coarse, undefined both.
  function meshAll(lev) {
    const out = [];
    while (removals.length) removals.shift();
    for (const F of fields.values()) if (lev === undefined || F.lev === lev) for (const m of F.tree.sdf.meshAll()) out.push(result(F, m));
    return out;
  }

  function dirty() { let d = removals.length; for (const F of fields.values()) d += F.tree.sdf.dirtyCount; return d; }

  return {
    addColony, add, update, meshAll, dirty, setFocus, focus, cols, fields, lod: useLod,
    // the cone radius of global particle g in the fine (or coarse) field
    radius(g) {
      const c = cols.get(PCOL[g]); if (!c) return 0;
      for (const key of [fineKey(c), c.id + '|1']) { const F = fields.get(key); const i = F && F.localOf.get(g); if (i !== undefined && F) return F.tree.radius(i); }
      return 0;
    },
    stats() {
      let b = 0;
      for (const F of fields.values()) b += F.tree.sdf.stats.bricks;
      return { colonies: cols.size, particles: n, bricks: b, tris: tris[0] + tris[1], trisFine: tris[0], trisCoarse: tris[1], polyps: polypN, dirty: dirty(), focus: focus().length };
    },
  };
}

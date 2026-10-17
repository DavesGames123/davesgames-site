// ============================================================================
//  DLA SDF  ·  a signed distance field of a DLA tree, meshed brick by brick
// ----------------------------------------------------------------------------
//  DOM-free ES module (page, module worker, node). It turns a particle tree
//  (positions, parents) into a smooth surface:
//    1. Each particle i with a parent p is a round cone from p to i (a
//       capsule with two radii). A seed is a sphere. The radius comes from
//       the subtree size (the pipe rule): r = rTip * sub^(1/pipe), capped
//       at rMax and quantised in steps of (1 + quant), so a trunk gets
//       thicker as the tree grows above it, in a few steps.
//    2. The cones are joined with the polynomial smooth minimum
//       smin(a, b, k) = min(a, b) - h*h*k/4, h = max(k - |a - b|, 0) / k.
//    3. The field lives on a sparse lattice of bricks (B^3 points each,
//       spacing cell). Only points nearer than band + k to a primitive are
//       written. The stored value is clamped to <= band, so a primitive
//       further than band + k from a point cannot change it: an append is
//       an exact local update. A radius change recomputes only the points
//       near that primitive, from the primitives of those bricks, in id
//       order. So incremental growth gives the same field, bit for bit, as
//       a full rebuild (the node tests check this).
//    4. Surface nets meshes each dirty brick: one vertex per cell that
//       the surface crosses (the mean of the edge crossings), one quad per
//       lattice edge with a sign change. Each edge belongs to the brick
//       that holds its lower point, and the vertex math uses global
//       lattice indices, so brick meshes meet with no cracks. The normal
//       is the field gradient (central differences, trilinear at the
//       vertex). Each vertex carries the id of the nearest primitive.
//
//  API (other packages build against this header)
//
//    import { createSdf, createTreeSdf, meshField, meshStats, smin } from '../../lib/dla-sdf.js';
//
//    const sdf = createSdf({ cell, brick, k, band, post });
//      cell   lattice spacing (world units), default 0.25
//      brick  points per brick edge, default 8
//      k      smooth-min blend width, default 2 * cell
//      band   the stored field is clamped to -band..band, default 2 * cell.
//             Make it larger than any outward push of post().
//      maxPrims  65534 by default (Uint16 ids in the bricks)
//      post   optional (x, y, z, d, id) -> d', a pure per-point shape term
//             (grooves, webs, plates). It runs at mesh time only, so it
//             costs nothing per particle and keeps the field exact.
//    sdf.setPrim(id, ax, ay, az, ra, bx, by, bz, rb)
//             add (new id) or change (old id) a round cone. A sphere is a
//             cone with a == b. Ids are small integers. Add them in
//             increasing order: the fold uses id order.
//    sdf.update(ms = Infinity, out = [])
//             recompute queued bricks (half of ms at most), then mesh the
//             dirty bricks, for about ms milliseconds in all. Work that
//             does not fit waits and merges with later changes. Call it
//             until sdf.dirtyCount is 0 for the exact final surface.
//             Returns out: brick meshes
//             { key, bx, by, bz, positions (Float32 xyz), normals (Float32
//             xyz), ids (Float32, primitive id per vertex), indices
//             (Uint16) }. An empty mesh (no indices) means "remove it".
//    sdf.dirtyCount   bricks that wait for a mesh
//    sdf.distance(x, y, z)  the field at any point (same fold, no post)
//    sdf.valueAt(ix, iy, iz) the stored value at a lattice point
//    sdf.meshAll()    a mesh of every brick (tests, thumbnails)
//    sdf.rebuildAll() recompute every point from the primitives
//    sdf.bricks       Map key -> brick { bx, by, bz, s, id, prims }
//    sdf.stats        { prims, bricks, applied, recomputed, meshed }
//    sdf.clear()
//
//    const tree = createTreeSdf({ rTip, rMax, pipe, quant, sub0, rootScale, offset, ...sdf opts });
//             radius of particle i: pipeRadius(subtree size of i, ...)
//    tree.sync(model, from?)  read new particles of a lib/dla-engine.js
//             model (or any { count, pos, parent }) and add or resize
//             the cones. Positions may be offset with opts.offset [x, y, z].
//    tree.add(i, x, y, z, parent)  one particle, by hand
//    tree.radius(i), tree.sub(i), tree.sdf, tree.update(ms, out)
//
//    meshField(fn, { x0, y0, z0, nx, ny, nz, cell })
//             surface nets of any field fn(x, y, z) on a dense grid (rocks,
//             terrain). Returns one mesh like a brick mesh (Uint32 indices).
//    meshStats(meshes, weld = 1e-4)
//             { verts, tris, boundaryEdges, nonManifold, area } after a
//             weld by position. A closed surface has boundaryEdges 0.
//
//  grep -n targets
//    smooth minimum ......... "export function smin"
//    round cone distance .... "function coneDist"
//    write one primitive .... "function applyPrim"
//    radius recompute ....... "function recompute"
//    brick mesher ........... "function meshBrick"
//    the update loop ........ "function update"
//    pipe rule .............. "function pipeRadius"
//    dense mesher ........... "export function meshField"
//    weld and edge counts ... "export function meshStats"
// ============================================================================

const OFF = 2048, KS = 4096;   // brick coordinates -2048..2047 per axis
const bkey = (x, y, z) => ((x + OFF) * KS + (y + OFF)) * KS + (z + OFF);

// The polynomial smooth minimum (Quilez). k = 0 gives min.
export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// Primitive record: 16 doubles per id.
//  0 ax 1 ay 2 az 3 ra 4 bx 5 by 6 bz 7 rb 8 bax 9 bay 10 baz 11 l2 12 rr 13 a2 14 il2 15 flag(1 = live)
//  16 cx 17 cy 18 cz 19 (bounding radius + reach)^2: a quick reject
const PS = 20;

// Signed distance from (x, y, z) to the round cone of record P at o.
// After Inigo Quilez, "sdRoundCone (a, b, r1, r2)" (MIT). When one end
// sphere holds the other, the distance is to the larger sphere.
function coneDist(P, o, x, y, z) {
  const ax = P[o], ay = P[o + 1], az = P[o + 2], r1 = P[o + 3], r2 = P[o + 7];
  const l2 = P[o + 11];
  const px = x - ax, py = y - ay, pz = z - az;
  if (P[o + 13] <= 1e-9) {                   // degenerate: a sphere holds the other
    const da = Math.sqrt(px * px + py * py + pz * pz) - r1;
    const qx = x - P[o + 4], qy = y - P[o + 5], qz = z - P[o + 6];
    const db = Math.sqrt(qx * qx + qy * qy + qz * qz) - r2;
    return da < db ? da : db;
  }
  const bax = P[o + 8], bay = P[o + 9], baz = P[o + 10], rr = P[o + 12], a2 = P[o + 13], il2 = P[o + 14];
  const yy = px * bax + py * bay + pz * baz;
  const z0 = yy - l2;
  const xx = px * l2 - bax * yy, xy = py * l2 - bay * yy, xz = pz * l2 - baz * yy;
  const x2 = xx * xx + xy * xy + xz * xz;
  const y2 = yy * yy * l2, z2 = z0 * z0 * l2;
  const kk = (rr > 0 ? 1 : rr < 0 ? -1 : 0) * rr * rr * x2;
  if ((z0 > 0 ? 1 : z0 < 0 ? -1 : 0) * a2 * z2 > kk) return Math.sqrt(x2 + z2) * il2 - r2;
  if ((yy > 0 ? 1 : yy < 0 ? -1 : 0) * a2 * y2 < kk) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
}

export function createSdf(opts = {}) {
  const cell = opts.cell ?? 0.25;
  const B = opts.brick ?? 8, B3 = B * B * B;
  const k = opts.k ?? 2 * cell;
  const T = opts.band ?? 2 * cell;
  // Storage: the value as Int16 in steps of band / 32000 (clamped to
  // -band..band), the primitive id + 1 as Uint16 (Int32 when maxPrims is
  // past 65534). Both the append and the recompute round after each step,
  // so the two give the same bits.
  const QS = T / 32000, QT = 32000;
  const IdArray = (opts.maxPrims ?? 65534) > 65534 ? Int32Array : Uint16Array;
  const quant = v => Math.round((v < -T ? -T : v > T ? T : v) / QS);
  const reach = T + k;                      // a primitive writes points nearer than this
  const post = opts.post || null;
  const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

  let P = new Float64Array(PS * 256), nPrim = 0;
  const bricks = new Map();
  const dirty = new Set();                   // brick keys that need a mesh (insertion order = FIFO)
  const pending = new Map();                 // brick key -> local box [x0, y0, z0, x1, y1, z1] to recompute
  const stats = { prims: 0, bricks: 0, applied: 0, recomputed: 0, meshed: 0 };

  function brickAt(bx, by, bz, make) {
    const key = bkey(bx, by, bz);
    let b = bricks.get(key);
    if (!b && make) {
      b = { key, bx, by, bz, s: null, id: null, prims: [] };   // s, id made on the first write
      bricks.set(key, b); stats.bricks++;
    }
    return b;
  }

  function alloc(b) { b.s = new Int16Array(B3).fill(QT); b.id = new IdArray(B3); }

  // The lattice box (inclusive) that a primitive can write.
  function primBox(o, out) {
    const r = Math.max(P[o + 3], P[o + 7]) + reach;
    out[0] = Math.ceil((Math.min(P[o], P[o + 4]) - r) / cell);
    out[1] = Math.ceil((Math.min(P[o + 1], P[o + 5]) - r) / cell);
    out[2] = Math.ceil((Math.min(P[o + 2], P[o + 6]) - r) / cell);
    out[3] = Math.floor((Math.max(P[o], P[o + 4]) + r) / cell);
    out[4] = Math.floor((Math.max(P[o + 1], P[o + 5]) + r) / cell);
    out[5] = Math.floor((Math.max(P[o + 2], P[o + 6]) + r) / cell);
    return out;
  }

  // Mark the bricks whose mesh window (own points -2..B+1) holds lattice
  // points of the box [lo, hi] of brick b (local offsets). Missing
  // neighbours are made: their points are all band (no primitive came
  // near), but they can own an edge into b.
  function markDirty(b, lx0, ly0, lz0, lx1, ly1, lz1) {
    const ax0 = lx0 <= 1 ? -1 : 0, ax1 = lx1 >= B - 2 ? 1 : 0;
    const ay0 = ly0 <= 1 ? -1 : 0, ay1 = ly1 >= B - 2 ? 1 : 0;
    const az0 = lz0 <= 1 ? -1 : 0, az1 = lz1 >= B - 2 ? 1 : 0;
    for (let dz = az0; dz <= az1; dz++) for (let dy = ay0; dy <= ay1; dy++) for (let dx = ax0; dx <= ax1; dx++) {
      const n = (dx | dy | dz) === 0 ? b : brickAt(b.bx + dx, b.by + dy, b.bz + dz, true);
      dirty.add(n.key);
    }
  }

  const BOX = [0, 0, 0, 0, 0, 0];

  // Write primitive c into the lattice: s = min(band, smin(s, d, k)) at
  // each point with d < band + k. Exact: a further primitive cannot move
  // a value that is <= band.
  function applyPrim(c) {
    const o = c * PS;
    if (!P[o + 15]) return;
    primBox(o, BOX);
    const [gx0, gy0, gz0, gx1, gy1, gz1] = BOX;
    const bx0 = Math.floor(gx0 / B), by0 = Math.floor(gy0 / B), bz0 = Math.floor(gz0 / B);
    const bx1 = Math.floor(gx1 / B), by1 = Math.floor(gy1 / B), bz1 = Math.floor(gz1 / B);
    for (let bz = bz0; bz <= bz1; bz++) for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
      let b = brickAt(bx, by, bz, false);
      const ox = bx * B, oy = by * B, oz = bz * B;
      const lx0 = Math.max(0, gx0 - ox), lx1 = Math.min(B - 1, gx1 - ox);
      const ly0 = Math.max(0, gy0 - oy), ly1 = Math.min(B - 1, gy1 - oy);
      const lz0 = Math.max(0, gz0 - oz), lz1 = Math.min(B - 1, gz1 - oz);
      let cx0 = B, cy0 = B, cz0 = B, cx1 = -1, cy1 = -1, cz1 = -1;
      for (let lz = lz0; lz <= lz1; lz++) {
        const z = (oz + lz) * cell;
        for (let ly = ly0; ly <= ly1; ly++) {
          const y = (oy + ly) * cell;
          for (let lx = lx0; lx <= lx1; lx++) {
            const x = (ox + lx) * cell;
            const ex = x - P[o + 16], ey = y - P[o + 17], ez = z - P[o + 18];
            if (ex * ex + ey * ey + ez * ez >= P[o + 19]) continue;
            const d = coneDist(P, o, x, y, z);
            if (d >= reach) continue;
            if (!b) { b = brickAt(bx, by, bz, true); }
            if (!b.s) alloc(b);
            const j = (lz * B + ly) * B + lx, q0 = b.s[j], s0 = q0 * QS;
            const q = quant(smin(s0, d, k));
            if (d < s0) b.id[j] = c + 1;
            if (q !== q0) {
              b.s[j] = q;
              if (lx < cx0) cx0 = lx; if (lx > cx1) cx1 = lx;
              if (ly < cy0) cy0 = ly; if (ly > cy1) cy1 = ly;
              if (lz < cz0) cz0 = lz; if (lz > cz1) cz1 = lz;
            }
          }
        }
      }
      if (b) {
        const L = b.prims;
        if (!L.length || L[L.length - 1] < c) L.push(c);
        else if (!L.includes(c)) { L.push(c); L.sort((p, q) => p - q); }
        if (cx1 >= 0) markDirty(b, cx0, cy0, cz0, cx1, cy1, cz1);
      }
      stats.applied++;
    }
  }

  // Recompute the local box [l0, l1] of brick b from scratch: each point
  // starts at band, then takes every primitive of the brick (id order)
  // that reaches it.
  function recompute(b, lx0, ly0, lz0, lx1, ly1, lz1) {
    const ox = b.bx * B, oy = b.by * B, oz = b.bz * B;
    const L = b.prims;
    let cx0 = B, cy0 = B, cz0 = B, cx1 = -1, cy1 = -1, cz1 = -1;
    for (let lz = lz0; lz <= lz1; lz++) {
      const z = (oz + lz) * cell;
      for (let ly = ly0; ly <= ly1; ly++) {
        const y = (oy + ly) * cell;
        for (let lx = lx0; lx <= lx1; lx++) {
          const x = (ox + lx) * cell;
          let qv = QT, id = 0;
          for (let q = 0; q < L.length; q++) {
            const c = L[q], o = c * PS;
            if (!P[o + 15]) continue;
            const ex = x - P[o + 16], ey = y - P[o + 17], ez = z - P[o + 18];
            if (ex * ex + ey * ey + ez * ez >= P[o + 19]) continue;
            const d = coneDist(P, o, x, y, z);
            if (d >= reach) continue;
            const v = qv * QS;
            if (d < v) id = c + 1;
            qv = quant(smin(v, d, k));
          }
          const j = (lz * B + ly) * B + lx;
          if (!b.s) { if (qv === QT && id === 0) continue; alloc(b); }
          if (b.s[j] !== qv || b.id[j] !== id) {
            b.s[j] = qv; b.id[j] = id;
            if (lx < cx0) cx0 = lx; if (lx > cx1) cx1 = lx;
            if (ly < cy0) cy0 = ly; if (ly > cy1) cy1 = ly;
            if (lz < cz0) cz0 = lz; if (lz > cz1) cz1 = lz;
          }
        }
      }
    }
    if (cx1 >= 0) markDirty(b, cx0, cy0, cz0, cx1, cy1, cz1);
    stats.recomputed++;
  }

  // Queue a recompute of the lattice box [g0, g1]: per brick, the union
  // of the local boxes, so many changes in one frame cost one pass.
  function queue(gx0, gy0, gz0, gx1, gy1, gz1) {
    const bx0 = Math.floor(gx0 / B), by0 = Math.floor(gy0 / B), bz0 = Math.floor(gz0 / B);
    const bx1 = Math.floor(gx1 / B), by1 = Math.floor(gy1 / B), bz1 = Math.floor(gz1 / B);
    for (let bz = bz0; bz <= bz1; bz++) for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
      const b = brickAt(bx, by, bz, false); if (!b) continue;
      const ox = bx * B, oy = by * B, oz = bz * B;
      const q = [Math.max(0, gx0 - ox), Math.max(0, gy0 - oy), Math.max(0, gz0 - oz), Math.min(B - 1, gx1 - ox), Math.min(B - 1, gy1 - oy), Math.min(B - 1, gz1 - oz)];
      const r = pending.get(b.key);
      if (!r) pending.set(b.key, q);
      else { for (let i = 0; i < 3; i++) { if (q[i] < r[i]) r[i] = q[i]; if (q[i + 3] > r[i + 3]) r[i + 3] = q[i + 3]; } }
    }
  }

  function setPrim(id, ax, ay, az, ra, bx, by, bz, rb) {
    if (id < 0 || !Number.isInteger(id)) throw new Error('dla-sdf: prim id must be an integer >= 0');
    while ((id + 1) * PS > P.length) { const q = new Float64Array(P.length * 2); q.set(P); P = q; }
    const o = id * PS, old = P[o + 15] === 1;
    let oldBox = null;
    if (old) oldBox = primBox(o, [0, 0, 0, 0, 0, 0]);
    P[o] = ax; P[o + 1] = ay; P[o + 2] = az; P[o + 3] = ra;
    P[o + 4] = bx; P[o + 5] = by; P[o + 6] = bz; P[o + 7] = rb;
    const bax = bx - ax, bay = by - ay, baz = bz - az, l2 = bax * bax + bay * bay + baz * baz;
    const rr = ra - rb;
    P[o + 8] = bax; P[o + 9] = bay; P[o + 10] = baz; P[o + 11] = l2; P[o + 12] = rr;
    P[o + 13] = l2 - rr * rr; P[o + 14] = l2 > 0 ? 1 / l2 : 0; P[o + 15] = 1;
    P[o + 16] = (ax + bx) / 2; P[o + 17] = (ay + by) / 2; P[o + 18] = (az + bz) / 2;
    const br = Math.sqrt(l2) / 2 + Math.max(ra, rb) + reach;
    P[o + 19] = br * br;
    if (id >= nPrim) nPrim = id + 1;
    stats.prims = nPrim;
    if (!old && id === nPrim - 1) { applyPrim(id); return; }
    // a change, or an id out of order: list it in the new bricks, then
    // recompute the old and the new box
    const nb = primBox(o, [0, 0, 0, 0, 0, 0]);
    registerPrim(id, nb);
    if (oldBox) queue(Math.min(oldBox[0], nb[0]), Math.min(oldBox[1], nb[1]), Math.min(oldBox[2], nb[2]), Math.max(oldBox[3], nb[3]), Math.max(oldBox[4], nb[4]), Math.max(oldBox[5], nb[5]));
    else queue(nb[0], nb[1], nb[2], nb[3], nb[4], nb[5]);
  }

  // Put primitive c in the list of each brick that it can reach. A brick
  // that does not exist yet is made when a point of it is near the cone.
  function registerPrim(c, box) {
    const o = c * PS;
    const bx0 = Math.floor(box[0] / B), by0 = Math.floor(box[1] / B), bz0 = Math.floor(box[2] / B);
    const bx1 = Math.floor(box[3] / B), by1 = Math.floor(box[4] / B), bz1 = Math.floor(box[5] / B);
    for (let bz = bz0; bz <= bz1; bz++) for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
      let b = brickAt(bx, by, bz, false);
      if (!b) {
        // make it only if the cone reaches one of its points
        const ox = bx * B, oy = by * B, oz = bz * B;
        let hit = false;
        for (let lz = 0; lz < B && !hit; lz++) for (let ly = 0; ly < B && !hit; ly++) for (let lx = 0; lx < B; lx++) {
          if (coneDist(P, o, (ox + lx) * cell, (oy + ly) * cell, (oz + lz) * cell) < reach) { hit = true; break; }
        }
        if (!hit) continue;
        b = brickAt(bx, by, bz, true);
      }
      const L = b.prims;
      if (!L.includes(c)) { L.push(c); if (L.length > 1 && L[L.length - 2] > c) L.sort((p, q) => p - q); }
    }
  }

  function flushPending() {
    for (const [key, q] of pending) { const b = bricks.get(key); if (b) recompute(b, q[0], q[1], q[2], q[3], q[4], q[5]); }
    pending.clear();
  }

  // The field at any point: the same fold as the lattice (no post).
  function distance(x, y, z) {
    const gx = Math.floor(x / cell / B), gy = Math.floor(y / cell / B), gz = Math.floor(z / cell / B);
    const b = brickAt(gx, gy, gz, false);
    if (!b) return QT * QS;
    let v = QT * QS;
    for (const c of b.prims) {
      const o = c * PS; if (!P[o + 15]) continue;
      const d = coneDist(P, o, x, y, z);
      if (d >= reach) continue;
      v = quant(smin(v, d, k)) * QS;
    }
    return v;
  }

  function valueAt(ix, iy, iz) {
    const bx = Math.floor(ix / B), by = Math.floor(iy / B), bz = Math.floor(iz / B);
    const b = brickAt(bx, by, bz, false);
    if (!b || !b.s) return QT * QS;
    return b.s[((iz - bz * B) * B + (iy - by * B)) * B + (ix - bx * B)] * QS;
  }

  // ── brick mesher ──────────────────────────────────────────────────────────
  const W = B + 4;                          // window: own points -2..B+1
  const WS = new Float32Array(W * W * W), WI = new Int32Array(W * W * W);
  const GX = new Float32Array(W * W * W), GY = new Float32Array(W * W * W), GZ = new Float32Array(W * W * W);
  const C = B + 1;                          // cells -1..B-1
  const VIDX = new Int32Array(C * C * C);

  function gather(b) {
    const ox = b.bx * B - 2, oy = b.by * B - 2, oz = b.bz * B - 2;
    let nb = null, nkey = -1;
    for (let wz = 0; wz < W; wz++) {
      const gz = oz + wz, bz = Math.floor(gz / B), lz = gz - bz * B;
      for (let wy = 0; wy < W; wy++) {
        const gy = oy + wy, by = Math.floor(gy / B), ly = gy - by * B;
        for (let wx = 0; wx < W; wx++) {
          const gx = ox + wx, bx = Math.floor(gx / B), lx = gx - bx * B;
          const key = bkey(bx, by, bz);
          if (key !== nkey) { nkey = key; nb = bricks.get(key) || null; }
          const w = (wz * W + wy) * W + wx;
          let v = QT * QS, id = -1;
          if (nb && nb.s) { const j = (lz * B + ly) * B + lx; v = nb.s[j] * QS; id = nb.id[j] - 1; }
          if (post) v = post(gx * cell, gy * cell, gz * cell, v, id);
          WS[w] = v; WI[w] = id;
        }
      }
    }
    // gradients at window points 1..W-2 (central differences)
    for (let wz = 1; wz < W - 1; wz++) for (let wy = 1; wy < W - 1; wy++) for (let wx = 1; wx < W - 1; wx++) {
      const w = (wz * W + wy) * W + wx;
      GX[w] = WS[w + 1] - WS[w - 1];
      GY[w] = WS[w + W] - WS[w - W];
      GZ[w] = WS[w + W * W] - WS[w - W * W];
    }
  }

  // Cube corner offsets and the 12 edges as corner pairs.
  const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const CW = CO.map(([x, y, z]) => (z * W + y) * W + x);

  function meshBrick(b) {
    gather(b);
    const ox = b.bx * B, oy = b.by * B, oz = b.bz * B;
    const pos = [], nrm = [], ids = [], idx = [];
    VIDX.fill(-1);
    // a vertex in each crossed cell -1..B-1 (window offset +2: cell c uses window points c+2 .. c+3)
    const vert = (cx, cy, cz) => {
      const ci = ((cz + 1) * C + (cy + 1)) * C + (cx + 1);
      let vi = VIDX[ci];
      if (vi >= 0) return vi;
      const w0 = ((cz + 2) * W + (cy + 2)) * W + (cx + 2);
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let e = 0; e < 12; e++) {
        const a = EDGES[e][0], c = EDGES[e][1];
        const va = WS[w0 + CW[a]], vc = WS[w0 + CW[c]];
        if ((va < 0) === (vc < 0)) continue;
        const t = va / (va - vc);
        sx += CO[a][0] + (CO[c][0] - CO[a][0]) * t;
        sy += CO[a][1] + (CO[c][1] - CO[a][1]) * t;
        sz += CO[a][2] + (CO[c][2] - CO[a][2]) * t;
        n++;
      }
      const fx = n ? sx / n : 0.5, fy = n ? sy / n : 0.5, fz = n ? sz / n : 0.5;
      // trilinear gradient and the nearest corner id
      let gx = 0, gy = 0, gz = 0, best = -1, bd = Infinity;
      for (let q = 0; q < 8; q++) {
        const wx = CO[q][0] ? fx : 1 - fx, wy = CO[q][1] ? fy : 1 - fy, wz = CO[q][2] ? fz : 1 - fz;
        const wgt = wx * wy * wz, w = w0 + CW[q];
        gx += GX[w] * wgt; gy += GY[w] * wgt; gz += GZ[w] * wgt;
        const dd = (CO[q][0] - fx) ** 2 + (CO[q][1] - fy) ** 2 + (CO[q][2] - fz) ** 2;
        if (WI[w] >= 0 && dd < bd) { bd = dd; best = WI[w]; }
      }
      const gl = Math.hypot(gx, gy, gz) || 1;
      vi = pos.length / 3;
      pos.push((ox + cx + fx) * cell, (oy + cy + fy) * cell, (oz + cz + fz) * cell);
      nrm.push(gx / gl, gy / gl, gz / gl);
      ids.push(best);
      VIDX[ci] = vi;
      return vi;
    };
    // quads: one per owned lattice edge (lower point in 0..B-1) with a sign change
    for (let lz = 0; lz < B; lz++) for (let ly = 0; ly < B; ly++) for (let lx = 0; lx < B; lx++) {
      const w = ((lz + 2) * W + (ly + 2)) * W + (lx + 2);
      const inside = WS[w] < 0;
      // x edge: cells share it in y and z
      if (inside !== (WS[w + 1] < 0)) quad(inside, vert(lx, ly - 1, lz - 1), vert(lx, ly, lz - 1), vert(lx, ly, lz), vert(lx, ly - 1, lz));
      if (inside !== (WS[w + W] < 0)) quad(inside, vert(lx - 1, ly, lz - 1), vert(lx - 1, ly, lz), vert(lx, ly, lz), vert(lx, ly, lz - 1));
      if (inside !== (WS[w + W * W] < 0)) quad(inside, vert(lx - 1, ly - 1, lz), vert(lx, ly - 1, lz), vert(lx, ly, lz), vert(lx - 1, ly, lz));
    }
    function quad(inside, a, b2, c, d) {
      // counter-clockwise seen from outside: the edge axis points out when the lower end is inside
      if (inside) idx.push(a, b2, c, a, c, d); else idx.push(a, c, b2, a, d, c);
    }
    stats.meshed++;
    return {
      key: b.key, bx: b.bx, by: b.by, bz: b.bz,
      positions: new Float32Array(pos), normals: new Float32Array(nrm), ids: new Float32Array(ids),
      indices: new Uint16Array(idx),
    };
  }

  // Recompute queued bricks (oldest first) for up to half of ms, then
  // mesh dirty bricks with no queued recompute for the rest. Work that
  // does not fit waits for the next call, where it is merged with new
  // changes: a busy trunk brick is recomputed once, not once per change.
  function update(ms = Infinity, out = []) {
    const t0 = now();
    for (const [key, q] of pending) {
      pending.delete(key);
      const b = bricks.get(key); if (b) recompute(b, q[0], q[1], q[2], q[3], q[4], q[5]);
      if (now() - t0 > ms * 0.5) break;
    }
    for (const key of dirty) {
      if (pending.has(key)) continue;
      dirty.delete(key);
      const b = bricks.get(key);
      if (b) out.push(meshBrick(b));
      if (now() - t0 > ms) break;
    }
    return out;
  }

  function meshAll() {
    flushPending();
    dirty.clear();
    const out = [];
    for (const b of bricks.values()) { const m = meshBrick(b); if (m.indices.length) out.push(m); }
    return out;
  }

  function rebuildAll() {
    pending.clear();
    for (const b of bricks.values()) { b.s = null; b.id = null; }
    for (let c = 0; c < nPrim; c++) applyPrim(c);
  }

  function clear() {
    bricks.clear(); dirty.clear(); pending.clear(); nPrim = 0; P.fill(0);
    stats.prims = stats.bricks = stats.applied = stats.recomputed = stats.meshed = 0;
  }

  return {
    cell, brick: B, k, band: T, reach, bricks, stats,
    setPrim, update, meshAll, rebuildAll, distance, valueAt, clear,
    get dirtyCount() { return dirty.size + pending.size; },
    get primCount() { return nPrim; },
    prim(id) { const o = id * PS; return P[o + 15] ? Array.from(P.subarray(o, o + 8)) : null; },
  };
}

// ── DLA tree to cones ───────────────────────────────────────────────────────
// The pipe rule: r = rTip * (sub / sub0)^(1/pipe), at least rTip, at most
// rMax, in steps of (1 + quant), so that a radius changes a few times, not
// on each particle. sub0 > 1 keeps young tips at rTip.
export function pipeRadius(sub, rTip, pipe, rMax, quant, sub0 = 1) {
  let r = rTip * Math.pow(Math.max(1, sub / sub0), 1 / pipe);
  if (r > rMax) r = rMax;
  if (quant > 0) { const q = Math.round(Math.log(r / rTip) / Math.log(1 + quant)); r = Math.min(rMax, rTip * Math.pow(1 + quant, q)); }
  return r;
}

export function createTreeSdf(opts = {}) {
  const sdf = createSdf(opts);
  const rTip = opts.rTip ?? 0.5, pipe = opts.pipe ?? 3, rMax = opts.rMax ?? 4 * rTip, quant = opts.quant ?? 0.12, sub0 = opts.sub0 ?? 2;
  const rootScale = opts.rootScale ?? 1;     // a seed sphere radius, times its pipe radius
  const off = opts.offset || [0, 0, 0];
  let cap = 1024, n = 0;
  let X = new Float64Array(cap * 3), par = new Int32Array(cap), sub = new Int32Array(cap), rad = new Float32Array(cap);
  let kids = [];

  function grow() {
    cap *= 2;
    const x = new Float64Array(cap * 3); x.set(X); X = x;
    const p = new Int32Array(cap); p.set(par); par = p;
    const s = new Int32Array(cap); s.set(sub); sub = s;
    const r = new Float32Array(cap); r.set(rad); rad = r;
  }

  function cone(i) {
    const p = par[i], ri = rad[i];
    if (p < 0) sdf.setPrim(i, X[i * 3], X[i * 3 + 1], X[i * 3 + 2], ri * rootScale, X[i * 3], X[i * 3 + 1], X[i * 3 + 2], ri * rootScale);
    else sdf.setPrim(i, X[p * 3], X[p * 3 + 1], X[p * 3 + 2], rad[p], X[i * 3], X[i * 3 + 1], X[i * 3 + 2], ri);
  }

  // Particle i at (x, y, z) with parent p (-1: a seed). Ids in order.
  function add(i, x, y, z, p) {
    if (i !== n) throw new Error(`dla-sdf: tree ids must come in order (got ${i}, want ${n})`);
    if (n === cap) grow();
    n++;
    X[i * 3] = x; X[i * 3 + 1] = y; X[i * 3 + 2] = z; par[i] = p; sub[i] = 1;
    rad[i] = pipeRadius(1, rTip, pipe, rMax, quant, sub0);
    kids.push(null);
    if (p >= 0) (kids[p] || (kids[p] = [])).push(i);
    cone(i);
    // the subtree of each ancestor grows by one: resize the cones of a
    // particle whose quantised radius changes (its own and its kids')
    for (let a = p; a >= 0; a = par[a]) {
      sub[a]++;
      const r = pipeRadius(sub[a], rTip, pipe, rMax, quant, sub0);
      if (r !== rad[a]) {
        rad[a] = r;
        cone(a);
        const K = kids[a]; if (K) for (const c of K) cone(c);
      }
    }
  }

  // Read new particles from a dla-engine model (or { count, pos, parent }).
  function sync(model) {
    const N = model.count, pos = model.pos, pa = model.parent;
    for (let i = n; i < N; i++) add(i, pos[i * 3] + off[0], pos[i * 3 + 1] + off[1], pos[i * 3 + 2] + off[2], pa[i]);
    return N;
  }

  return {
    sdf, add, sync,
    update: (ms, out) => sdf.update(ms, out),
    radius: i => rad[i], sub: i => sub[i], parent: i => par[i],
    get count() { return n; },
    pos: i => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]],
  };
}

// ── dense surface nets (rocks, terrain) ─────────────────────────────────────
// fn(x, y, z) -> signed distance (negative inside). Grid points
// x0 + i * cell, i = 0..nx (and so on). Returns one mesh with Uint32
// indices and normals from central differences of fn.
export function meshField(fn, { x0, y0, z0, nx, ny, nz, cell }) {
  const X = nx + 1, Y = ny + 1, Z = nz + 1;
  const S = new Float32Array(X * Y * Z);
  for (let k = 0; k < Z; k++) for (let j = 0; j < Y; j++) for (let i = 0; i < X; i++) S[(k * Y + j) * X + i] = fn(x0 + i * cell, y0 + j * cell, z0 + k * cell);
  const V = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [], nrm = [], idx = [];
  const at = (i, j, k) => S[(k * Y + j) * X + i];
  const h = cell * 0.5;
  function vert(i, j, k) {
    const c = (k * ny + j) * nx + i;
    if (V[c] >= 0) return V[c];
    let sx = 0, sy = 0, sz = 0, n = 0;
    const v = [];
    for (let q = 0; q < 8; q++) v.push(at(i + (q & 1), j + ((q >> 1) & 1), k + ((q >> 2) & 1)));
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [a, b] of E) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t;
      sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
      sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
      n++;
    }
    const x = x0 + (i + sx / n) * cell, y = y0 + (j + sy / n) * cell, z = z0 + (k + sz / n) * cell;
    const gx = fn(x + h, y, z) - fn(x - h, y, z), gy = fn(x, y + h, z) - fn(x, y - h, z), gz = fn(x, y, z + h) - fn(x, y, z - h);
    const gl = Math.hypot(gx, gy, gz) || 1;
    V[c] = pos.length / 3;
    pos.push(x, y, z); nrm.push(gx / gl, gy / gl, gz / gl);
    return V[c];
  }
  const quad = (inside, a, b, c, d) => { if (inside) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c); };
  for (let k = 1; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) {
    const s = at(i, j, k), inside = s < 0;
    if (i < nx && inside !== (at(i + 1, j, k) < 0)) quad(inside, vert(i, j - 1, k - 1), vert(i, j, k - 1), vert(i, j, k), vert(i, j - 1, k));
    if (j < ny && inside !== (at(i, j + 1, k) < 0)) quad(inside, vert(i - 1, j, k - 1), vert(i - 1, j, k), vert(i, j, k), vert(i, j, k - 1));
    if (k < nz && inside !== (at(i, j, k + 1) < 0)) quad(inside, vert(i - 1, j - 1, k), vert(i, j - 1, k), vert(i, j, k), vert(i - 1, j, k));
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx) };
}

// ── mesh checks ─────────────────────────────────────────────────────────────
// Weld the vertices of all meshes by position (grid weld), then count the
// edges that only one triangle uses (boundary) and the edges that more
// than two use (non-manifold).
export function meshStats(meshes, weld = 1e-4) {
  const map = new Map();
  let nv = 0, tris = 0, area = 0;
  const edges = new Map();
  const list = Array.isArray(meshes) ? meshes : [meshes];
  for (const m of list) {
    const P = m.positions, I = m.indices, remap = new Int32Array(P.length / 3);
    for (let v = 0; v < remap.length; v++) {
      const key = `${Math.round(P[v * 3] / weld)},${Math.round(P[v * 3 + 1] / weld)},${Math.round(P[v * 3 + 2] / weld)}`;
      let id = map.get(key); if (id === undefined) { id = nv++; map.set(key, id); }
      remap[v] = id;
    }
    for (let t = 0; t < I.length; t += 3) {
      const a = remap[I[t]], b = remap[I[t + 1]], c = remap[I[t + 2]];
      if (a === b || b === c || a === c) continue;
      tris++;
      const ux = P[I[t + 1] * 3] - P[I[t] * 3], uy = P[I[t + 1] * 3 + 1] - P[I[t] * 3 + 1], uz = P[I[t + 1] * 3 + 2] - P[I[t] * 3 + 2];
      const vx = P[I[t + 2] * 3] - P[I[t] * 3], vy = P[I[t + 2] * 3 + 1] - P[I[t] * 3 + 1], vz = P[I[t + 2] * 3 + 2] - P[I[t] * 3 + 2];
      area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const key = p < q ? p * 4294967296 + q : q * 4294967296 + p;
        edges.set(key, (edges.get(key) || 0) + 1);
      }
    }
  }
  let boundaryEdges = 0, nonManifold = 0;
  for (const c of edges.values()) { if (c === 1) boundaryEdges++; else if (c > 2) nonManifold++; }
  return { verts: nv, tris, edges: edges.size, boundaryEdges, nonManifold, area };
}

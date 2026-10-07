// ============================================================================
//  IMAGE WORLDS  ·  ground.js — floor height and wall tests on the collider
// ────────────────────────────────────────────────────────────────────────────
//  DOM-free (tests.mjs runs it). A World Labs collider mesh can hold 100k+
//  triangles, too many to ray-test each frame. createGround() puts each
//  triangle (already in world space) in the cells of a 0.5 m grid in x-z
//  that its box touches. A test then reads only the cells under the ray.
//
//  groundAt(x, y, z)   the highest surface at or below y at (x, z): the
//                      collider, or the plane y = 0 when plane is on.
//                      -Infinity when there is neither.
//  blockAt(from, d, r) true when the segment from -> from + d (+ r more)
//                      at height from.y hits a collider triangle.
//
//  EXPORTS  createGround({ positions, index, plane, cell }) -> { groundAt,
//           blockAt, tris, cells }
//           positions: Float32Array xyz in world space; index: Uint32Array
//           or null (non-indexed)
// ============================================================================
export function createGround({ positions, index = null, plane = true, cell = 0.5 } = {}) {
  const P = positions || new Float32Array(0);
  const I = index || (() => { const a = new Uint32Array(P.length / 3); for (let i = 0; i < a.length; i++) a[i] = i; return a; })();
  const tris = Math.floor(I.length / 3);
  const grid = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  const cx = x => Math.floor(x / cell);
  for (let t = 0; t < tris; t++) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) { const v = I[3 * t + k] * 3; x0 = Math.min(x0, P[v]); x1 = Math.max(x1, P[v]); z0 = Math.min(z0, P[v + 2]); z1 = Math.max(z1, P[v + 2]); }
    // A huge triangle (a floor quad) spans many cells: cap the walk so a
    // bad mesh cannot build millions of entries.
    const i0 = cx(x0), i1 = cx(x1), j0 = cx(z0), j1 = cx(z1);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 40000) continue;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(t);
    }
  }
  // Moller-Trumbore. Returns the distance t along d, or Infinity.
  function hit(t, ox, oy, oz, dx, dy, dz) {
    const a = I[3 * t] * 3, b = I[3 * t + 1] * 3, c = I[3 * t + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return Infinity;
    const inv = 1 / det, tx = ox - P[a], ty = oy - P[a + 1], tz = oz - P[a + 2];
    const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) return Infinity;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) return Infinity;
    const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return d >= 0 ? d : Infinity;
  }
  function groundAt(x, y, z) {
    let best = plane && y >= 0 ? 0 : -Infinity;
    const a = grid.get(key(cx(x), cx(z)));
    if (a) for (const t of a) { const d = hit(t, x, y, z, 0, -1, 0); if (d < Infinity) best = Math.max(best, y - d); }
    return best;
  }
  function blockAt(from, d, r = 0.3) {
    const len = Math.hypot(d.x, d.z); if (!(len > 0)) return false;
    const dx = d.x / len, dz = d.z / len, far = len + r;
    const seen = new Set();
    for (let s = 0; s <= far + cell; s += cell / 2) {
      const a = grid.get(key(cx(from.x + dx * Math.min(s, far)), cx(from.z + dz * Math.min(s, far))));
      if (!a) continue;
      for (const t of a) { if (seen.has(t)) continue; seen.add(t); if (hit(t, from.x, from.y, from.z, dx, 0, dz) <= far) return true; }
    }
    return false;
  }
  return { groundAt, blockAt, tris, cells: grid.size };
}

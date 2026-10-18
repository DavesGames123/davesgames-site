// ============================================================================
//  CORAL REEF  ·  world/mesh.js  ·  rock and sand meshes of one world chunk
// ----------------------------------------------------------------------------
//  A chunk is a 32 m x 32 m column of the world (world/field.js). Its rock
//  is meshed with narrow-band surface nets (the method of rock/mesh.js,
//  adapted: no plot, chunk-local output) and its sand is a height grid.
//
//  SEAMS. The lattice is global: the point (gi, gj, gk) is at (gi cell,
//  gj cell, gk cell) in world metres, and the chunk (ci, cj) owns the
//  points gi in [ci N, ci N + N) and gk in [cj N, cj N + N), N = CH /
//  cell. An edge belongs to the chunk that owns its lower point, so each
//  quad is made once. A vertex of a cell on the border is computed by
//  both chunks from the same global samples, so both get the same
//  position and normal (no skirt, no overlap). The narrow band (a coarse
//  lattice every K cells decides which cells can hold surface) is also
//  global, so both chunks skip the same cells. The sand grid is on the
//  global lattice too. Between two LODs (cells) there can be a small
//  crack; the LOD rings put it 30 m or more from the eye, in the fog.
//
//  OUTPUT. Positions are chunk-local: x and z from the chunk centre, y in
//  world metres (|x|, |z| <= 16 + 2 cells: float32 keeps 2 um). Per rock
//  vertex: normal, cavity (0 open .. 1 deep crevice) and band (the strata
//  bed coordinate), as scene.js geomOf and shaders.js ROCK_VS read them.
//
//    meshRock(W, ci, cj, cell) -> { positions, normals, cavity, band,
//                                   indices, verts, tris, exact, ms } | null
//    meshSand(W, ci, cj, cell) -> { positions, normals, indices, tris } | null
//    meshChunk(W, ci, cj, lod, c0) -> { rock, sand, lod, cell, ms, bytes }
//    chunkCentre(ci, cj) -> [x, z]; CH (m); lodCell(c0, lod)
//
//  grep -n targets: "export function meshRock", "export function meshSand",
//  "export function meshChunk", "function vert("
// ============================================================================
import { SDF_SCALE, D_OUT, D_IN } from './field.js';

export const CH = 32;
export const lodCell = (c0, lod) => c0 * (1 << lod);
export const chunkCentre = (ci, cj) => [(ci + 0.5) * CH, (cj + 0.5) * CH];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// The y range of the rock surface in a chunk (with a margin of 2 cells
// round the square, so the border cells of both chunks are in range).
// The lattice starts 0.8 m under the lowest sand: the rock walls stop
// under the sand there (no hidden bottom face is meshed).
export function chunkYRange(W, ci, cj, cell) {
  const m = 2 * cell, r = W.columnRange(ci * CH - m, cj * CH - m, CH + 2 * m, 2);
  let sMin = Infinity;
  for (let z = cj * CH - m; z <= cj * CH + CH + m; z += 2) for (let x = ci * CH - m; x <= ci * CH + CH + m; x += 2) sMin = Math.min(sMin, W.sandAt(x, z));
  return [Math.max(r[0], sMin - 0.8 - 2 * cell), r[1]];
}

export function meshRock(W, ci, cj, cell, yr) {
  const t0 = now();
  const N = Math.round(CH / cell), K = 3;
  const [ylo, yhi] = yr || chunkYRange(W, ci, cj, cell);
  const gy0 = Math.floor(ylo / cell), gy1 = Math.ceil(yhi / cell);
  // owned points (edges): x pa0..pb0-1, y gy0..gy1-1, z pa2..pb2-1
  const pa = [ci * N, gy0, cj * N], pb = [ci * N + N, gy1, cj * N + N];
  // sample range: points pa-2 .. pb+1 (cells pa-1 .. pb-1 and their gradients)
  const sa = [pa[0] - 2, pa[1] - 2, pa[2] - 2];
  const SX = pb[0] - pa[0] + 4, SY = pb[1] - pa[1] + 4, SZ = pb[2] - pa[2] + 4;
  const cx = (ci + 0.5) * CH, cz = (cj + 0.5) * CH;
  // exact columns at every lattice (x, z) of the sample range
  const cols = new Array(SX * SZ);
  for (let k = 0; k < SZ; k++) for (let i = 0; i < SX; i++) cols[k * SX + i] = W.column((sa[0] + i) * cell, (sa[2] + k) * cell, {});
  // coarse lattice (every K points, global) over the sample range
  const ca = [Math.floor(sa[0] / K), Math.floor(sa[1] / K), Math.floor(sa[2] / K)];
  const cb = [Math.ceil((sa[0] + SX - 1) / K), Math.ceil((sa[1] + SY - 1) / K), Math.ceil((sa[2] + SZ - 1) / K)];
  const CX = cb[0] - ca[0] + 1, CY = cb[1] - ca[1] + 1, CZ = cb[2] - ca[2] + 1;
  const Cv = new Float32Array(CX * CY * CZ);
  const ccols = new Array(CX * CZ);
  for (let k = 0; k < CZ; k++) for (let i = 0; i < CX; i++) {
    const gi = (ca[0] + i) * K, gk = (ca[2] + k) * K, li = gi - sa[0], lk = gk - sa[2];
    ccols[k * CX + i] = li >= 0 && li < SX && lk >= 0 && lk < SZ ? cols[lk * SX + li] : W.column(gi * cell, gk * cell, {});
  }
  for (let k = 0; k < CZ; k++) for (let j = 0; j < CY; j++) for (let i = 0; i < CX; i++) {
    const c = ccols[k * CX + i];
    Cv[(k * CY + j) * CX + i] = W.baseCol(c, (ca[0] + i) * K * cell, (ca[1] + j) * K * cell, (ca[2] + k) * K * cell);
  }
  const thr = 1.35 * K * cell * 0.866 + 0.55 * 1 + 4 * cell;
  const far = new Uint8Array((CX - 1) * (CY - 1) * (CZ - 1));
  for (let k = 0; k < CZ - 1; k++) for (let j = 0; j < CY - 1; j++) for (let i = 0; i < CX - 1; i++) {
    let lo = Infinity, pos = 0;
    for (let q = 0; q < 8; q++) {
      const v = Cv[((k + (q >> 2)) * CY + j + ((q >> 1) & 1)) * CX + i + (q & 1)];
      const a = v < 0 ? -v : v; if (a < lo) lo = a; if (v > 0) pos++;
    }
    far[(k * (CY - 1) + j) * (CX - 1) + i] = lo > thr && (pos === 0 || pos === 8) ? 1 : 0;
  }
  const S = new Float32Array(SX * SY * SZ);
  let exact = 0;
  for (let k = 0; k < SZ; k++) {
    const gk = sa[2] + k, z = gk * cell, ck2 = Math.floor(gk / K) - ca[2], tz = gk / K - Math.floor(gk / K);
    for (let j = 0; j < SY; j++) {
      const gj = sa[1] + j, y = gj * cell, cj2 = Math.floor(gj / K) - ca[1], ty = gj / K - Math.floor(gj / K);
      for (let i = 0; i < SX; i++) {
        const gi = sa[0] + i, ci2 = Math.floor(gi / K) - ca[0], tx = gi / K - Math.floor(gi / K);
        const a = Math.min(ci2, CX - 2), b = Math.min(cj2, CY - 2), c = Math.min(ck2, CZ - 2);
        let v;
        if (far[(c * (CY - 1) + b) * (CX - 1) + a]) {
          const ux = ci2 > CX - 2 ? 1 : tx, uy = cj2 > CY - 2 ? 1 : ty, uz = ck2 > CZ - 2 ? 1 : tz;
          const g = (di, dj, dk) => Cv[((c + dk) * CY + b + dj) * CX + a + di];
          const c00 = g(0, 0, 0) + (g(1, 0, 0) - g(0, 0, 0)) * ux, c10 = g(0, 1, 0) + (g(1, 1, 0) - g(0, 1, 0)) * ux;
          const c01 = g(0, 0, 1) + (g(1, 0, 1) - g(0, 0, 1)) * ux, c11 = g(0, 1, 1) + (g(1, 1, 1) - g(0, 1, 1)) * ux;
          const d0 = c00 + (c10 - c00) * uy, d1 = c01 + (c11 - c01) * uy;
          v = (d0 + (d1 - d0) * uz) * SDF_SCALE;
          v = v > D_OUT ? D_OUT : v < -D_IN ? -D_IN : v;
        } else { v = W.sdfCol(cols[k * SX + i], gi * cell, y, z); exact++; }
        S[(k * SY + j) * SX + i] = v;
      }
    }
  }
  const at = (i, j, k) => S[(k * SY + j) * SX + i];
  const grad = (i, j, k, o) => {
    const i1 = Math.min(SX - 1, i + 1), i_ = Math.max(0, i - 1), j1 = Math.min(SY - 1, j + 1), j_ = Math.max(0, j - 1), k1 = Math.min(SZ - 1, k + 1), k_ = Math.max(0, k - 1);
    o[0] = (at(i1, j, k) - at(i_, j, k)) / (i1 - i_); o[1] = (at(i, j1, k) - at(i, j_, k)) / (j1 - j_); o[2] = (at(i, j, k1) - at(i, j, k_)) / (k1 - k_);
  };
  const CXn = pb[0] - pa[0] + 1, CYn = pb[1] - pa[1] + 1, CZn = pb[2] - pa[2] + 1;
  const V = new Int32Array(CXn * CYn * CZn).fill(-1);
  const pos = [], nrm = [], idx = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float64Array(8), g = [0, 0, 0];
  function vert(gi, gj, gk) {
    const li = gi - (pa[0] - 1), lj = gj - (pa[1] - 1), lk = gk - (pa[2] - 1);
    const c = (lk * CYn + lj) * CXn + li;
    if (V[c] >= 0) return V[c];
    const si = gi - sa[0], sj = gj - sa[1], sk = gk - sa[2];
    for (let q = 0; q < 8; q++) cv[q] = at(si + (q & 1), sj + ((q >> 1) & 1), sk + ((q >> 2) & 1));
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let e = 0; e < 12; e++) {
      const a = E[e][0], b = E[e][1];
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t;
      sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
      sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
      n++;
    }
    const fx = sx / n, fy = sy / n, fz = sz / n;
    let nx2 = 0, ny2 = 0, nz2 = 0;
    for (let q = 0; q < 8; q++) {
      grad(si + (q & 1), sj + ((q >> 1) & 1), sk + ((q >> 2) & 1), g);
      const w = ((q & 1) ? fx : 1 - fx) * (((q >> 1) & 1) ? fy : 1 - fy) * (((q >> 2) & 1) ? fz : 1 - fz);
      nx2 += g[0] * w; ny2 += g[1] * w; nz2 += g[2] * w;
    }
    const gl = Math.hypot(nx2, ny2, nz2) || 1;
    V[c] = pos.length / 3;
    // world x, z from global indices, then local to the chunk centre
    pos.push((gi + fx) * cell - cx, (gj + fy) * cell, (gk + fz) * cell - cz);
    nrm.push(nx2 / gl, ny2 / gl, nz2 / gl);
    return V[c];
  }
  const quad = (inside, a, b, c, d) => { if (inside) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c); };
  for (let k = pa[2]; k < pb[2]; k++) for (let j = pa[1]; j < pb[1]; j++) for (let i = pa[0]; i < pb[0]; i++) {
    const li = i - sa[0], lj = j - sa[1], lk = k - sa[2];
    const s = at(li, lj, lk), inside = s < 0;
    if (inside !== (at(li + 1, lj, lk) < 0)) quad(inside, vert(i, j - 1, k - 1), vert(i, j, k - 1), vert(i, j, k), vert(i, j - 1, k));
    if (inside !== (at(li, lj + 1, lk) < 0)) quad(inside, vert(i - 1, j, k - 1), vert(i - 1, j, k), vert(i, j, k), vert(i, j, k - 1));
    if (inside !== (at(li, lj, lk + 1) < 0)) quad(inside, vert(i - 1, j - 1, k), vert(i, j - 1, k), vert(i, j, k), vert(i - 1, j, k));
  }
  if (!idx.length) return null;
  const nv = pos.length / 3;
  const P = new Float32Array(pos), Nn = new Float32Array(nrm);
  const cavity = new Float32Array(nv), band = new Float32Array(nv);
  // cavity: the field (tile cache) at 0.6 and 1.6 m along the normal, and
  // the crag groove depth; band: the strata bed coordinate
  const amp = 0.4;
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3] + cx, y = P[v * 3 + 1], z = P[v * 3 + 2] + cz;
    const ax = Nn[v * 3], ay = Nn[v * 3 + 1], az = Nn[v * 3 + 2];
    const o1 = Math.max(0, W.sdf(x + ax * 0.6, y + ay * 0.6, z + az * 0.6) / SDF_SCALE);
    const o2 = Math.max(0, W.sdf(x + ax * 1.6, y + ay * 1.6, z + az * 1.6) / SDF_SCALE);
    const occ = Math.max(0, (0.6 - o1) / 0.6) * 0.55 + Math.max(0, (1.6 - o2) / 1.6) * 0.45;
    const groove = Math.max(0, W.crag(x, y, z)) / amp;
    cavity[v] = Math.min(1, occ * 0.8 + groove * 0.5);
    band[v] = W.bedAt(x, y, z);
  }
  const I = nv < 65536 ? new Uint16Array(idx) : new Uint32Array(idx);
  return { positions: P, normals: Nn, cavity, band, indices: I, verts: nv, tris: idx.length / 3, exact, ms: now() - t0 };
}

// The sand of a chunk: a grid on the global lattice (cell), with the
// normals from the height differences. A quad is left out when the rock
// covers all its corners (the sand is inside the rock there).
export function meshSand(W, ci, cj, cell) {
  const N = Math.round(CH / cell), M = N + 3;      // samples -1 .. N+1
  const cx = (ci + 0.5) * CH, cz = (cj + 0.5) * CH;
  const H = new Float32Array(M * M), hid = new Uint8Array((N + 1) * (N + 1));
  const col = {};
  for (let k = 0; k < M; k++) for (let i = 0; i < M; i++) {
    const gi = ci * N + i - 1, gk = cj * N + k - 1;
    const c = W.column(gi * cell, gk * cell, col);
    H[k * M + i] = c.S;
    if (i >= 1 && k >= 1 && i <= N + 1 && k <= N + 1) hid[(k - 1) * (N + 1) + i - 1] = W.sdfCol(c, gi * cell, c.S + 0.25, gk * cell) < -0.04 ? 1 : 0;
  }
  const P = new Float32Array((N + 1) * (N + 1) * 3), Nn = new Float32Array((N + 1) * (N + 1) * 3);
  for (let k = 0; k <= N; k++) for (let i = 0; i <= N; i++) {
    const q = k * (N + 1) + i, h = H[(k + 1) * M + i + 1];
    P[q * 3] = (ci * N + i) * cell - cx; P[q * 3 + 1] = h; P[q * 3 + 2] = (cj * N + k) * cell - cz;
    const gx = (H[(k + 1) * M + i + 2] - H[(k + 1) * M + i]) / (2 * cell), gz = (H[(k + 2) * M + i + 1] - H[k * M + i + 1]) / (2 * cell);
    const l = Math.hypot(gx, 1, gz);
    Nn[q * 3] = -gx / l; Nn[q * 3 + 1] = 1 / l; Nn[q * 3 + 2] = -gz / l;
  }
  const idx = [];
  for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) {
    const a = k * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    if (hid[a] && hid[b] && hid[c] && hid[d]) continue;
    idx.push(a, c, b, b, c, d);
  }
  if (!idx.length) return null;
  const I = (N + 1) * (N + 1) < 65536 ? new Uint16Array(idx) : new Uint32Array(idx);
  return { positions: P, normals: Nn, indices: I, tris: idx.length / 3 };
}

const bytesOf = m => (m ? m.positions.byteLength + m.normals.byteLength + m.indices.byteLength + (m.cavity ? m.cavity.byteLength : 0) + (m.band ? m.band.byteLength : 0) : 0);
export function meshChunk(W, ci, cj, lod, c0) {
  const t0 = now(), cell = lodCell(c0, lod);
  const rock = meshRock(W, ci, cj, cell);
  const sand = meshSand(W, ci, cj, Math.min(4, cell * 2));
  return { rock, sand, lod, cell, ms: now() - t0, bytes: bytesOf(rock) + bytesOf(sand) };
}
export { bytesOf as meshBytes };

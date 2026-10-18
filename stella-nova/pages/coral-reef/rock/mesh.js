// ============================================================================
//  CORAL REEF  ·  rock/mesh.js  ·  chunked narrow-band surface nets (DOM-free)
// ----------------------------------------------------------------------------
//  The rock field is meshed on one global lattice (spacing cell) split into
//  chunks of N^3 cells. Each chunk is independent (a worker can do any
//  chunk) and the chunks meet with no cracks:
//    - every lattice point is computed from global indices, so two chunks
//      that share a point get the same value and the same vertex
//    - an edge belongs to the chunk that holds its lower point
//  Narrow band: a coarse lattice (every K cells) of the cheap base field
//  decides which coarse cells can hold the surface. The fine points in the
//  other coarse cells get the trilinear value of the coarse corners (the
//  sign is right, the value is far from 0), so the full field with crag
//  detail runs only near the surface.
//  Normals: the lattice gradient (central differences) at the 8 cell
//  corners, trilinear at the vertex. Per vertex the chunk also writes
//    cavity  0 open .. 1 deep crevice (base-field occlusion at 0.6 and
//            1.6 m along the normal, plus the crag groove depth)
//    band    the strata bed coordinate (geo.strata.bedAt): fract() of it
//            is the place in the bed, floor() the bed number
//
//  grep -n targets
//    lattice and chunk list ... "export function meshLayout"
//    one chunk ................ "export function meshChunk"
// ============================================================================
import { Y_BOTTOM } from './geology.js';

export const QUALITY = Object.freeze({
  high: { cell: 0.2, chunk: 32 },
  medium: { cell: 0.28, chunk: 32 },
  low: { cell: 0.4, chunk: 24 },
});

// The lattice and the chunks that can hold surface.
export function meshLayout(geo, quality = 'high') {
  const q = typeof quality === 'object' ? quality : (QUALITY[quality] || QUALITY.high);
  const cell = q.cell, N = q.chunk;
  const ext = 1.32 * geo.R + 4 * cell;
  const nx = 2 * Math.ceil(ext / cell), nz = nx;
  const x0 = -nx / 2 * cell, z0 = x0;
  const y0 = Math.floor((Y_BOTTOM - 0.8) / cell) * cell;
  const ny = Math.ceil((geo.yMax + 0.8 - y0) / cell);
  const cx = Math.ceil(nx / N), cy = Math.ceil(ny / N), cz = Math.ceil(nz / N);
  const chunks = [];
  const L = 1.35, half = N * cell * 0.866, margin = 0.8 * geo.detail + 1;
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const mx = x0 + (i + 0.5) * N * cell, my = y0 + (j + 0.5) * N * cell, mz = z0 + (k + 0.5) * N * cell;
    const d = geo.base(mx, my, mz);
    if (Math.abs(d) > L * half + margin) continue;
    chunks.push([i, j, k]);
  }
  return { cell, N, K: 3, x0, y0, z0, nx, ny, nz, chunks };
}

export function meshChunk(geo, lay, ci, cj, ck) {
  const { cell, N, K, x0, y0, z0, nx, ny, nz } = lay;
  const i0 = ci * N, j0 = cj * N, k0 = ck * N;
  // point range that owns edges
  const pa = [Math.max(1, i0), Math.max(1, j0), Math.max(1, k0)];
  const pb = [Math.min(nx - 1, i0 + N), Math.min(ny - 1, j0 + N), Math.min(nz - 1, k0 + N)];
  if (pa[0] >= pb[0] || pa[1] >= pb[1] || pa[2] >= pb[2]) return null;
  // sample range: points pa-2 .. pb+1 (cells pa-1 .. pb-1 and their gradients)
  const sa = [pa[0] - 2, pa[1] - 2, pa[2] - 2];
  const SX = pb[0] - pa[0] + 4, SY = pb[1] - pa[1] + 4, SZ = pb[2] - pa[2] + 4;
  const S = new Float32Array(SX * SY * SZ);
  // coarse lattice over the sample range
  const ca = [Math.floor(sa[0] / K), Math.floor(sa[1] / K), Math.floor(sa[2] / K)];
  const cb = [Math.ceil((sa[0] + SX - 1) / K), Math.ceil((sa[1] + SY - 1) / K), Math.ceil((sa[2] + SZ - 1) / K)];
  const CX = cb[0] - ca[0] + 1, CY = cb[1] - ca[1] + 1, CZ = cb[2] - ca[2] + 1;
  const Cv = new Float32Array(CX * CY * CZ);
  for (let k = 0; k < CZ; k++) for (let j = 0; j < CY; j++) for (let i = 0; i < CX; i++) {
    Cv[(k * CY + j) * CX + i] = geo.base(x0 + (ca[0] + i) * K * cell, y0 + (ca[1] + j) * K * cell, z0 + (ca[2] + k) * K * cell);
  }
  // A coarse cell is "far" when every corner is far from the surface.
  const thr = 1.35 * K * cell * 0.866 + 0.55 * geo.detail + 4 * cell;
  const far = new Uint8Array((CX - 1) * (CY - 1) * (CZ - 1));
  for (let k = 0; k < CZ - 1; k++) for (let j = 0; j < CY - 1; j++) for (let i = 0; i < CX - 1; i++) {
    let lo = Infinity, pos = 0;
    for (let q = 0; q < 8; q++) {
      const v = Cv[((k + (q >> 2)) * CY + j + ((q >> 1) & 1)) * CX + i + (q & 1)];
      const a = v < 0 ? -v : v; if (a < lo) lo = a; if (v > 0) pos++;
    }
    far[(k * (CY - 1) + j) * (CX - 1) + i] = lo > thr && (pos === 0 || pos === 8) ? 1 : 0;
  }
  let exact = 0;
  for (let k = 0; k < SZ; k++) {
    const gk = sa[2] + k, z = z0 + gk * cell, ck2 = Math.floor(gk / K) - ca[2], tz = gk / K - Math.floor(gk / K);
    for (let j = 0; j < SY; j++) {
      const gj = sa[1] + j, y = y0 + gj * cell, cj2 = Math.floor(gj / K) - ca[1], ty = gj / K - Math.floor(gj / K);
      for (let i = 0; i < SX; i++) {
        const gi = sa[0] + i, ci2 = Math.floor(gi / K) - ca[0], tx = gi / K - Math.floor(gi / K);
        const fi = (Math.min(ck2, CZ - 2) * (CY - 1) + Math.min(cj2, CY - 2)) * (CX - 1) + Math.min(ci2, CX - 2);
        let v;
        if (far[fi]) {
          const a = Math.min(ci2, CX - 2), b = Math.min(cj2, CY - 2), c = Math.min(ck2, CZ - 2);
          const ux = ci2 > CX - 2 ? 1 : tx, uy = cj2 > CY - 2 ? 1 : ty, uz = ck2 > CZ - 2 ? 1 : tz;
          const g = (di, dj, dk) => Cv[((c + dk) * CY + b + dj) * CX + a + di];
          const c00 = g(0, 0, 0) + (g(1, 0, 0) - g(0, 0, 0)) * ux, c10 = g(0, 1, 0) + (g(1, 1, 0) - g(0, 1, 0)) * ux;
          const c01 = g(0, 0, 1) + (g(1, 0, 1) - g(0, 0, 1)) * ux, c11 = g(0, 1, 1) + (g(1, 1, 1) - g(0, 1, 1)) * ux;
          const d0 = c00 + (c10 - c00) * uy, d1 = c01 + (c11 - c01) * uy;
          v = d0 + (d1 - d0) * uz;
        } else { v = geo.sdf(x0 + gi * cell, y, z); exact++; }
        S[(k * SY + j) * SX + i] = v;
      }
    }
  }
  const at = (i, j, k) => S[(k * SY + j) * SX + i];      // local sample index
  // gradient at a local sample (central differences, clamped)
  const grad = (i, j, k, o) => {
    const i1 = Math.min(SX - 1, i + 1), i_ = Math.max(0, i - 1), j1 = Math.min(SY - 1, j + 1), j_ = Math.max(0, j - 1), k1 = Math.min(SZ - 1, k + 1), k_ = Math.max(0, k - 1);
    o[0] = (at(i1, j, k) - at(i_, j, k)) / (i1 - i_); o[1] = (at(i, j1, k) - at(i, j_, k)) / (j1 - j_); o[2] = (at(i, j, k1) - at(i, j, k_)) / (k1 - k_);
  };
  // cells pa-1 .. pb-1 -> local sample index (cell + 1 - sa)
  const CXn = pb[0] - pa[0] + 1, CYn = pb[1] - pa[1] + 1, CZn = pb[2] - pa[2] + 1;
  const V = new Int32Array(CXn * CYn * CZn).fill(-1);
  const pos = [], nrm = [], idx = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float64Array(8), g = [0, 0, 0], gs = new Float64Array(24);
  function vert(gi, gj, gk) {          // global cell index
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
    pos.push(x0 + (gi + fx) * cell, y0 + (gj + fy) * cell, z0 + (gk + fz) * cell);
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
  if (!idx.length) return { key: `${ci},${cj},${ck}`, empty: true, exact };
  const nv = pos.length / 3;
  const P = new Float32Array(pos), Nn = new Float32Array(nrm);
  const cavity = new Float32Array(nv), band = new Float32Array(nv);
  const amp = Math.max(0.05, 0.4 * geo.detail);
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const ax = Nn[v * 3], ay = Nn[v * 3 + 1], az = Nn[v * 3 + 2];
    const o1 = Math.max(0, geo.base(x + ax * 0.6, y + ay * 0.6, z + az * 0.6));
    const o2 = Math.max(0, geo.base(x + ax * 1.6, y + ay * 1.6, z + az * 1.6));
    const occ = Math.max(0, (0.6 - o1) / 0.6) * 0.55 + Math.max(0, (1.6 - o2) / 1.6) * 0.45;
    const groove = geo.detail > 0 ? Math.max(0, geo.crag(x, y, z)) / amp : 0;
    cavity[v] = Math.min(1, occ * 0.8 + groove * 0.6);
    band[v] = geo.strata.bedAt(x, y, z);
  }
  const I = nv < 65536 ? new Uint16Array(idx) : new Uint32Array(idx);
  return { key: `${ci},${cj},${ck}`, positions: P, normals: Nn, cavity, band, indices: I, exact };
}

// ============================================================================
//  PROTEIN VIEWER  ·  surface.js — a Gaussian molecular surface
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no THREE.
//
//  density   each atom adds  exp(-K * (d^2 / r^2 - 1))  on a grid, with
//            r = vdW radius + 0.5 A and K = 1.6, so the level 1 contour
//            lies near the solvent-accessible skin of each atom and fills
//            the narrow crevices a 1.4 A probe cannot enter. Each grid point
//            also keeps the atom that adds the most, for the colour.
//  contour   surface nets: one vertex in each grid cube that the level-1
//            contour crosses, placed at the mean of the edge crossings;
//            one quad for each grid edge the contour crosses, joining the
//            four cubes round that edge. No lookup tables are needed.
//  normals   the density gradient, by central differences, interpolated
//            to each vertex
//  The grid spacing grows until the grid has no more than maxCells points.
//
//  grep: export function gaussianSurface  const K  vdw
// ============================================================================

export const VDW = { H: 1.1, C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, SE: 1.9, F: 1.47, CL: 1.75, BR: 1.85, I: 1.98, FE: 1.4, ZN: 1.39, MG: 1.73, CA: 1.7, NA: 2.27, K: 2.75, MN: 1.4 };
export const vdw = el => VDW[el] ?? 1.7;
const K = 1.6, PAD = 0.5;

export function gaussianSurface(wpos, atoms, opts = {}) {
  const maxCells = opts.maxCells || 2.5e6;
  const n = atoms.length;
  if (!n) return null;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const i of atoms) {
    const x = wpos[3 * i], y = wpos[3 * i + 1], z = wpos[3 * i + 2];
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
    if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
  }
  const m = 4.5;
  x0 -= m; y0 -= m; z0 -= m; x1 += m; y1 += m; z1 += m;
  let h = opts.spacing || 0.9;
  const dims = () => [Math.ceil((x1 - x0) / h) + 1, Math.ceil((y1 - y0) / h) + 1, Math.ceil((z1 - z0) / h) + 1];
  let [nx, ny, nz] = dims();
  while (nx * ny * nz > maxCells) { h *= 1.12; [nx, ny, nz] = dims(); }
  const F = new Float32Array(nx * ny * nz);
  const best = new Float32Array(nx * ny * nz);
  const owner = new Int32Array(nx * ny * nz).fill(-1);
  const at = (i, j, k) => (k * ny + j) * nx + i;
  for (const a of atoms) {
    const r = (opts.radius ? opts.radius(a) : 1.7) + PAD, r2 = r * r;
    const cut = r * 1.9;
    const ax = wpos[3 * a], ay = wpos[3 * a + 1], az = wpos[3 * a + 2];
    const i0 = Math.max(0, Math.floor((ax - cut - x0) / h)), i1 = Math.min(nx - 1, Math.ceil((ax + cut - x0) / h));
    const j0 = Math.max(0, Math.floor((ay - cut - y0) / h)), j1 = Math.min(ny - 1, Math.ceil((ay + cut - y0) / h));
    const k0 = Math.max(0, Math.floor((az - cut - z0) / h)), k1 = Math.min(nz - 1, Math.ceil((az + cut - z0) / h));
    for (let k = k0; k <= k1; k++) {
      const dz = z0 + k * h - az;
      for (let j = j0; j <= j1; j++) {
        const dy = y0 + j * h - ay;
        const row = (k * ny + j) * nx;
        for (let i = i0; i <= i1; i++) {
          const dx = x0 + i * h - ax;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > cut * cut) continue;
          const v = Math.exp(-K * (d2 / r2 - 1));
          const q = row + i;
          F[q] += v;
          if (v > best[q]) { best[q] = v; owner[q] = a; }
        }
      }
    }
  }
  // surface nets
  const ISO = 1;
  const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
  const pos = [], nor = [], own = [], idx = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const corner = new Float32Array(8);
  const sample = (x, y, z) => {
    // trilinear density at grid coordinates
    const i = Math.max(0, Math.min(nx - 2, Math.floor(x))), j = Math.max(0, Math.min(ny - 2, Math.floor(y))), k = Math.max(0, Math.min(nz - 2, Math.floor(z)));
    const fx = x - i, fy = y - j, fz = z - k;
    const c = (a, b, d) => F[at(i + a, j + b, k + d)];
    const l00 = c(0, 0, 0) * (1 - fx) + c(1, 0, 0) * fx, l10 = c(0, 1, 0) * (1 - fx) + c(1, 1, 0) * fx;
    const l01 = c(0, 0, 1) * (1 - fx) + c(1, 0, 1) * fx, l11 = c(0, 1, 1) * (1 - fx) + c(1, 1, 1) * fx;
    return (l00 * (1 - fy) + l10 * fy) * (1 - fz) + (l01 * (1 - fy) + l11 * fy) * fz;
  };
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = F[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
      corner[c] = v;
      if (v > ISO) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [a, b] of E) {
      const va = corner[a], vb = corner[b];
      if ((va > ISO) === (vb > ISO)) continue;
      const t = (ISO - va) / (vb - va);
      sx += (a & 1) + (((b & 1) - (a & 1)) * t);
      sy += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
      sz += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
      cnt++;
    }
    const gx = i + sx / cnt, gy = j + sy / cnt, gz = k + sz / cnt;
    cellV[cid(i, j, k)] = pos.length / 3;
    pos.push(x0 + gx * h, y0 + gy * h, z0 + gz * h);
    const e = 0.5;
    const nxv = sample(gx - e, gy, gz) - sample(gx + e, gy, gz);
    const nyv = sample(gx, gy - e, gz) - sample(gx, gy + e, gz);
    const nzv = sample(gx, gy, gz - e) - sample(gx, gy, gz + e);
    const l = Math.hypot(nxv, nyv, nzv) || 1;
    nor.push(nxv / l, nyv / l, nzv / l);
    own.push(owner[at(Math.round(gx), Math.round(gy), Math.round(gz))]);
  }
  // quads across each crossed grid edge
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const inside = F[at(i, j, k)] > ISO;
    if (i < nx - 1 && inside !== (F[at(i + 1, j, k)] > ISO))
      quad(cellV[cid(i, j - 1, k - 1)], cellV[cid(i, j, k - 1)], cellV[cid(i, j, k)], cellV[cid(i, j - 1, k)], !inside);
    if (j < ny - 1 && inside !== (F[at(i, j + 1, k)] > ISO))
      quad(cellV[cid(i - 1, j, k - 1)], cellV[cid(i - 1, j, k)], cellV[cid(i, j, k)], cellV[cid(i, j, k - 1)], !inside);
    if (k < nz - 1 && inside !== (F[at(i, j, k + 1)] > ISO))
      quad(cellV[cid(i - 1, j - 1, k)], cellV[cid(i, j - 1, k)], cellV[cid(i, j, k)], cellV[cid(i - 1, j, k)], !inside);
  }
  // owners that came out -1 (far from any atom) take a neighbour's
  for (let v = 0; v < own.length; v++) if (own[v] < 0) own[v] = atoms[0];
  return {
    position: new Float32Array(pos), normal: new Float32Array(nor), owner: new Int32Array(own),
    index: new Uint32Array(idx), spacing: h, cells: nx * ny * nz,
  };
}

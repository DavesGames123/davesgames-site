// ============================================================================
//  VIRUS ATLAS  ·  blobs.js — one smooth body per piece of chain (no DOM)
// ----------------------------------------------------------------------------
//  The blob view draws each chain as a few overlapping ellipsoids of one
//  colour, so a capsomer reads as a smooth tile. chainBlobs(d) splits
//  each chain of the asymmetric unit into pieces of at most maxRes
//  residues (in sequence order, equal sizes) and fits one ellipsoid to
//  each piece; a piece with an axis longer than maxLen (2.6 nm) splits
//  in two until it fits (or has 6 residues), so long arms stay thin:
//    centre   the mean of its beads
//    axes     the eigenvectors of the covariance (Jacobi, 3 x 3)
//    lengths  sqrt(eigenvalue), scaled by the largest Mahalanobis
//             distance of a bead, so every bead centre is inside; then
//             + pad, and at least minAxis
//  An ellipsoid is a drawing aid, not a measured surface.
//
//  OUTPUT  { n, data: Float32Array(16 n), owner: Int32Array(d.n) }
//    data   4 texels per blob (view.js uploads it as RGBA32F):
//           centre xyz + chain, then each axis as a vector of its length
//           (v1 a1 / v2 a2 / v3 a3), w = 0
//    owner  the blob of each bead
//  insideBlob(data, b, x, y, z) is the containment test of tests.mjs.
//
//  grep -n targets: "export function chainBlobs", "function jacobi3",
//                   "export function insideBlob"
// ============================================================================

// eigen of a symmetric 3 x 3 (a: [xx, xy, xz, yy, yz, zz]) -> { val[3], vec[3][3] }
export function jacobi3(a) {
  const A = [[a[0], a[1], a[2]], [a[1], a[3], a[4]], [a[2], a[4], a[5]]];
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep++) {
    const off = Math.abs(A[0][1]) + Math.abs(A[0][2]) + Math.abs(A[1][2]);
    if (off < 1e-12) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(A[p][q]) < 1e-15) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = A[k][p], y = A[k][q]; A[k][p] = c * x - s * y; A[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = A[p][k], y = A[q][k]; A[p][k] = c * x - s * y; A[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y; }
    }
  }
  return { val: [A[0][0], A[1][1], A[2][2]], vec: [0, 1, 2].map(j => [V[0][j], V[1][j], V[2][j]]) };
}

export function chainBlobs(d, opts = {}) {
  const maxRes = opts.maxRes || 48, minAxis = opts.minAxis ?? 0.45, pad = opts.pad ?? 0.2;
  const maxLen = opts.maxLen || 2.6;
  // fit one ellipsoid to beads a..b-1: { c, vec, len }
  const fit = (a, b) => {
    const m = b - a;
    let cx = 0, cy = 0, cz = 0;
    for (let i = a; i < b; i++) { cx += d.pos[3 * i]; cy += d.pos[3 * i + 1]; cz += d.pos[3 * i + 2]; }
    cx /= m; cy /= m; cz /= m;
    const C = [0, 0, 0, 0, 0, 0];
    for (let i = a; i < b; i++) {
      const x = d.pos[3 * i] - cx, y = d.pos[3 * i + 1] - cy, z = d.pos[3 * i + 2] - cz;
      C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z;
    }
    for (let k = 0; k < 6; k++) C[k] /= m;
    const { val, vec } = jacobi3(C);
    const s = val.map(v => Math.sqrt(Math.max(v, 1e-4)));
    let M = 0;
    for (let i = a; i < b; i++) {
      const x = d.pos[3 * i] - cx, y = d.pos[3 * i + 1] - cy, z = d.pos[3 * i + 2] - cz;
      let q2 = 0;
      for (let k = 0; k < 3; k++) { const p = (x * vec[k][0] + y * vec[k][1] + z * vec[k][2]) / s[k]; q2 += p * p; }
      M = Math.max(M, Math.sqrt(q2));
    }
    M = Math.max(M, 1e-3);
    return { c: [cx, cy, cz], vec, len: s.map(v => Math.max(minAxis, v * M + pad)) };
  };
  // a piece longer than maxLen splits in two, down to 6 residues
  const out = [];
  const add = (a, b, ch) => {
    const f = fit(a, b);
    if (Math.max(...f.len) > maxLen && b - a > 6) { const h = (a + b) >> 1; add(a, h, ch); add(h, b, ch); return; }
    out.push({ a, b, ch, f });
  };
  // runs of one chain (beads of a chain are contiguous in the files)
  for (let i = 0; i < d.n;) {
    let j = i;
    while (j < d.n && d.chain[j] === d.chain[i]) j++;
    const len = j - i, np = Math.max(1, Math.round(len / maxRes));
    for (let p = 0; p < np; p++) add(i + Math.floor(len * p / np), i + Math.floor(len * (p + 1) / np), d.chain[i]);
    i = j;
  }
  const pieces = out;
  const data = new Float32Array(16 * pieces.length), owner = new Int32Array(d.n);
  pieces.forEach(({ a, b, ch, f }, q) => {
    for (let i = a; i < b; i++) owner[i] = q;
    const o = 16 * q;
    data[o] = f.c[0]; data[o + 1] = f.c[1]; data[o + 2] = f.c[2]; data[o + 3] = ch;
    for (let k = 0; k < 3; k++) {
      data[o + 4 + 4 * k] = f.vec[k][0] * f.len[k]; data[o + 5 + 4 * k] = f.vec[k][1] * f.len[k]; data[o + 6 + 4 * k] = f.vec[k][2] * f.len[k];
    }
  });
  return { n: pieces.length, data, owner };
}

// Is point (x, y, z) inside blob b? sum (dot(p - c, v_k) / |v_k|^2)^2 <= 1
export function insideBlob(data, b, x, y, z, slack = 1e-4) {
  const o = 16 * b, px = x - data[o], py = y - data[o + 1], pz = z - data[o + 2];
  let q2 = 0;
  for (let k = 0; k < 3; k++) {
    const vx = data[o + 4 + 4 * k], vy = data[o + 5 + 4 * k], vz = data[o + 6 + 4 * k], l2 = vx * vx + vy * vy + vz * vz;
    const p = (px * vx + py * vy + pz * vz) / l2;
    q2 += p * p;
  }
  return q2 <= 1 + slack;
}

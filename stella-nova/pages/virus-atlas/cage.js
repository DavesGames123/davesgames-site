// ============================================================================
//  VIRUS ATLAS  ·  cage.js — the lattice view: nodes and edges (no DOM)
// ----------------------------------------------------------------------------
//  The cage view draws the symmetry of a particle as glowing lines and
//  nodes, with no atoms:
//    icosaCage(axes, R)  the icosahedron of an icosahedral capsid: 12
//        vertices on the 5-fold axes, 30 edges between neighbour
//        vertices (63.43 deg apart), 20 face nodes on the 3-fold axes
//        and 30 edge nodes on the 2-fold axes, all at radius R.
//    unitNet(cent, nc, keep, opts)  the subunit lattice: one node per
//        kept unit (one chain of one copy, at its centroid), each joined
//        to its nearest neighbours (k of them, no further than `reach`
//        times the nearest). On a capsid this is the geodesic net of the
//        capsomers; on the TMV rod the helical lattice; on a fibril the
//        stack of layers. perCopy: one node per copy (spikes).
//  Node records: { p: [x, y, z], unit (or -1), kind: 0 unit, 5, 3, 2 axis }.
//  Edges: [i, j] node indices. view.js moves unit nodes with their units.
//
//  grep -n targets: "export function icosaCage", "export function unitNet"
// ============================================================================

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sc = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const nrm = a => sc(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

export const ICO_EDGE_COS = 1 / Math.sqrt(5);   // 63.43 deg between neighbour vertices

export function icosaCage(axes, R) {
  const both = o => axes.filter(a => a.order === o).flatMap(a => [a.dir, sc(a.dir, -1)]);
  const V = both(5), nodes = [], edges = [];
  for (const v of V) nodes.push({ p: sc(nrm(v), R), unit: -1, kind: 5 });
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
    if (Math.abs(dot(nrm(V[i]), nrm(V[j])) - ICO_EDGE_COS) < 0.02) edges.push([i, j]);
  }
  // face centres lie at R cos(37.38 deg) ... drawn on the same sphere for
  // a clean frame: the 3- and 2-fold nodes mark where the axes cross it
  for (const v of both(3)) nodes.push({ p: sc(nrm(v), R), unit: -1, kind: 3 });
  for (const v of both(2)) nodes.push({ p: sc(nrm(v), R), unit: -1, kind: 2 });
  return { nodes, edges };
}

// cent: unit centroids (unit u = k nc + c), keep[c]: use chain c.
export function unitNet(cent, nc, keep, opts = {}) {
  const k = opts.k || 4, reach = opts.reach || 1.45, U = cent.length / 3, m = U / nc;
  const nodes = [];
  if (opts.perCopy) {
    for (let cp = 0; cp < m; cp++) {
      let x = 0, y = 0, z = 0, w = 0, first = -1;
      for (let c = 0; c < nc; c++) if (keep[c]) { const u = cp * nc + c; x += cent[3 * u]; y += cent[3 * u + 1]; z += cent[3 * u + 2]; w++; if (first < 0) first = u; }
      if (w) nodes.push({ p: [x / w, y / w, z / w], unit: first, kind: 0 });
    }
  } else {
    for (let u = 0; u < U; u++) if (keep[u % nc]) nodes.push({ p: [cent[3 * u], cent[3 * u + 1], cent[3 * u + 2]], unit: u, kind: 0 });
  }
  const n = nodes.length, edges = [], seen = new Set();
  // nearest neighbours through a hash on cells of the mean spacing
  if (n < 2) return { nodes, edges };
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const q of nodes) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], q.p[a]); hi[a] = Math.max(hi[a], q.p[a]); }
  const vol = Math.max(1e-6, (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1));
  let cell = Math.max(0.5, Math.cbrt(vol / n) * 1.5);
  const key = (x, y, z) => Math.floor((x - lo[0]) / cell) + ',' + Math.floor((y - lo[1]) / cell) + ',' + Math.floor((z - lo[2]) / cell);
  let grid;
  const build = () => { grid = new Map(); nodes.forEach((q, i) => { const s = key(...q.p); if (!grid.has(s)) grid.set(s, []); grid.get(s).push(i); }); };
  build();
  for (let i = 0; i < n; i++) {
    const p = nodes[i].p;
    let cand = [], ring = 1;
    for (; ring <= 4; ring++) {
      cand = [];
      const g = [Math.floor((p[0] - lo[0]) / cell), Math.floor((p[1] - lo[1]) / cell), Math.floor((p[2] - lo[2]) / cell)];
      for (let a = -ring; a <= ring; a++) for (let b = -ring; b <= ring; b++) for (let c = -ring; c <= ring; c++) {
        const L = grid.get((g[0] + a) + ',' + (g[1] + b) + ',' + (g[2] + c));
        if (L) for (const j of L) if (j !== i) cand.push(j);
      }
      if (cand.length >= k) break;
    }
    const ds = cand.map(j => [j, Math.hypot(nodes[j].p[0] - p[0], nodes[j].p[1] - p[1], nodes[j].p[2] - p[2])]).sort((a, b) => a[1] - b[1]);
    if (!ds.length) continue;
    const lim = ds[0][1] * reach;
    for (const [j, dd] of ds.slice(0, k)) {
      if (dd > lim) break;
      const s = i < j ? i + ':' + j : j + ':' + i;
      if (!seen.has(s)) { seen.add(s); edges.push([Math.min(i, j), Math.max(i, j)]); }
    }
  }
  return { nodes, edges };
}

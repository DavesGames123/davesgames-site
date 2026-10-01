// ============================================================================
//  SDF FORGE  ·  mc.js — marching cubes on the CPU
// ----------------------------------------------------------------------------
//  PURE. The field is sampled on a grid, and every cell the surface crosses
//  becomes a few triangles (Lorensen and Cline 1987). The worker runs this;
//  the tests run it too.
//
//  THE CASE TABLE IS BUILT, NOT TYPED. For each of the 256 corner sign cases,
//  each cube face contributes the segments where the surface crosses it. A
//  face is walked counter-clockwise from outside; where the walk enters the
//  inside it is an ENTRY, where it leaves it is an EXIT, and each entry joins
//  the next exit. That rule reads only the four corners of the face, so the
//  two cells that share a face always cut it the same way, and the mesh is
//  closed with no hole at an ambiguous face. Every crossing point is the end
//  of one segment and the start of one, so the segments close into loops; a
//  loop is fanned into triangles. Entry-to-exit gives outward normals (the
//  test checks the signed volume).
//
//  VERTICES ARE WELDED by grid edge, so a closed surface gives a mesh where
//  every directed edge appears once and its reverse appears once.
//
//  SPEED: the field is first read at the centre of 4x4x4 blocks of cells. A
//  block whose centre is further from the surface than its half diagonal
//  (times the Lipschitz bound) holds no surface; its grid points take the
//  centre value, whose sign is right, and are never evaluated.
//
//  GREP MAP
//    CASES ........ the generated table: CASES[c] = list of loops of edge ids
//    polygonize ... field, bounds, resolution -> { pos, idx }
//    vertexNormals / toOBJ / meshStats
// ============================================================================

// corners: bit 0 = x, bit 1 = y, bit 2 = z
const EDGES = [];          // [a, b] with a < b, b = a | bit
const EDGE_ID = {};
for (let a = 0; a < 8; a++) for (const bit of [1, 2, 4]) if (!(a & bit)) { EDGE_ID[a * 8 + (a | bit)] = EDGES.length; EDGES.push([a, a | bit]); }
const edgeOf = (a, b) => EDGE_ID[Math.min(a, b) * 8 + Math.max(a, b)];
// faces, counter-clockwise seen from outside
const FACES = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];

function buildCase(c) {
  const inside = i => (c >> i) & 1;
  const next = new Map();
  for (const f of FACES) {
    const cr = [];
    for (let i = 0; i < 4; i++) {
      const a = f[i], b = f[(i + 1) % 4];
      if (inside(a) !== inside(b)) cr.push({ e: edgeOf(a, b), entry: !inside(a) });
    }
    if (!cr.length) continue;
    for (let i = 0; i < cr.length; i++) {
      if (!cr[i].entry) continue;
      for (let j = 1; j < cr.length; j++) {
        const x = cr[(i + j) % cr.length];
        if (!x.entry) { next.set(cr[i].e, x.e); break; }
      }
    }
  }
  const loops = [], seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let e = start;
    while (!seen.has(e)) { seen.add(e); loop.push(e); e = next.get(e); }
    loops.push(loop);
  }
  return loops;
}
export const CASES = Array.from({ length: 256 }, (_, c) => buildCase(c));

// f(x, y, z) -> distance. bounds { lo, hi }. res: cells along the longest side.
export function polygonize(f, bounds, res, opt = {}) {
  const k = opt.stepK ?? 1, onProgress = opt.onProgress || (() => {});
  const size = [0, 1, 2].map(j => bounds.hi[j] - bounds.lo[j]);
  const h = Math.max(...size) / res;
  const n = size.map(s => Math.max(2, Math.ceil(s / h) + 2));   // cells per axis, with a margin
  const lo = [0, 1, 2].map(j => (bounds.lo[j] + bounds.hi[j]) / 2 - n[j] * h / 2);
  const nx = n[0] + 1, ny = n[1] + 1, nz = n[2] + 1;
  const val = new Float32Array(nx * ny * nz);
  const done = new Uint8Array(nx * ny * nz);
  const at = (i, j, l) => i + nx * (j + ny * l);
  const X = i => lo[0] + i * h, Y = j => lo[1] + j * h, Z = l => lo[2] + l * h;
  // coarse pass
  const B = 4, bx = Math.ceil(n[0] / B), by = Math.ceil(n[1] / B), bz = Math.ceil(n[2] / B);
  const half = Math.sqrt(3) * B * h / 2;
  const cval = new Float32Array(bx * by * bz), live = new Uint8Array(bx * by * bz);
  let evals = 0;
  for (let c = 0; c < bz; c++) for (let b = 0; b < by; b++) for (let a = 0; a < bx; a++) {
    const v = f(X(a * B + B / 2), Y(b * B + B / 2), Z(c * B + B / 2)); evals++;
    const id = a + bx * (b + by * c);
    cval[id] = v; live[id] = Math.abs(v) * k <= half * 1.05 ? 1 : 0;
  }
  for (let c = 0; c < bz; c++) {
    for (let b = 0; b < by; b++) for (let a = 0; a < bx; a++) {
      if (!live[a + bx * (b + by * c)]) continue;
      for (let l = c * B; l <= Math.min((c + 1) * B, n[2]); l++) for (let j = b * B; j <= Math.min((b + 1) * B, n[1]); j++) for (let i = a * B; i <= Math.min((a + 1) * B, n[0]); i++) {
        const q = at(i, j, l);
        if (done[q]) continue;
        val[q] = f(X(i), Y(j), Z(l)); done[q] = 1; evals++;
      }
    }
    onProgress(0.7 * (c + 1) / bz);
  }
  for (let l = 0; l < nz; l++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q = at(i, j, l);
    if (!done[q]) val[q] = cval[Math.min(bx - 1, (i / B) | 0) + bx * (Math.min(by - 1, (j / B) | 0) + by * Math.min(bz - 1, (l / B) | 0))];
  }
  // the cells
  const pos = [], idx = [], vmap = new Map();
  const off = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const vert = (i, j, l, e) => {
    const [a, b] = EDGES[e];
    const ia = i + off[a][0], ja = j + off[a][1], la = l + off[a][2];
    const axis = b - a === 1 ? 0 : b - a === 2 ? 1 : 2;
    const key = at(ia, ja, la) * 3 + axis;
    let v = vmap.get(key);
    if (v !== undefined) return v;
    const va = val[at(ia, ja, la)], vb = val[at(i + off[b][0], j + off[b][1], l + off[b][2])];
    const t = va / (va - vb);
    const p = [X(ia), Y(ja), Z(la)];
    p[axis] += t * h;
    v = pos.length / 3; pos.push(p[0], p[1], p[2]); vmap.set(key, v);
    return v;
  };
  for (let l = 0; l < n[2]; l++) {
    for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
      let c = 0;
      for (let q = 0; q < 8; q++) if (val[at(i + off[q][0], j + off[q][1], l + off[q][2])] < 0) c |= 1 << q;
      if (c === 0 || c === 255) continue;
      for (const loop of CASES[c]) {
        const vs = loop.map(e => vert(i, j, l, e));
        for (let t = 1; t + 1 < vs.length; t++) idx.push(vs[0], vs[t], vs[t + 1]);
      }
    }
    onProgress(0.7 + 0.3 * (l + 1) / n[2]);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), h, evals, cells: n };
}

export function vertexNormals(f, pos, e) {
  const N = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e);
    const L = Math.hypot(gx, gy, gz) || 1;
    N[i] = gx / L; N[i + 1] = gy / L; N[i + 2] = gz / L;
  }
  return N;
}

export function toOBJ(m, N, name = 'sdf') {
  const out = [`# SDF Forge export: ${m.pos.length / 3} vertices, ${m.idx.length / 3} triangles`, `o ${name}`];
  const r = x => +x.toFixed(5);
  for (let i = 0; i < m.pos.length; i += 3) out.push(`v ${r(m.pos[i])} ${r(m.pos[i + 1])} ${r(m.pos[i + 2])}`);
  if (N) for (let i = 0; i < N.length; i += 3) out.push(`vn ${r(N[i])} ${r(N[i + 1])} ${r(N[i + 2])}`);
  for (let i = 0; i < m.idx.length; i += 3) {
    const a = m.idx[i] + 1, b = m.idx[i + 1] + 1, c = m.idx[i + 2] + 1;
    out.push(N ? `f ${a}//${a} ${b}//${b} ${c}//${c}` : `f ${a} ${b} ${c}`);
  }
  return out.join('\n') + '\n';
}

// Closed means every directed edge appears once and its reverse appears once.
export function meshStats(m) {
  const E = new Map();
  let vol = 0, degenerate = 0;
  const P = m.pos;
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t], b = m.idx[t + 1], c = m.idx[t + 2];
    if (a === b || b === c || a === c) degenerate++;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u * 4294967296 + v; E.set(k, (E.get(k) || 0) + 1); }
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2], cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  let twice = 0, unmatched = 0;
  for (const [k, cnt] of E) {
    if (cnt > 1) twice++;
    const u = Math.floor(k / 4294967296), v = k - u * 4294967296;
    if (!E.has(v * 4294967296 + u)) unmatched++;
  }
  return { tris: m.idx.length / 3, verts: P.length / 3, closed: twice === 0 && unmatched === 0, twice, unmatched, volume: vol, degenerate };
}

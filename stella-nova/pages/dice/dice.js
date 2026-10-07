// ============================================================================
//  DICE LAB  ·  dice.js — die shapes, numbering and the face reader (no DOM)
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs, physics.js and the batch worker import
//  this file. Units are cm. Quaternions are [x, y, z, w]. World up is +y.
//
//  SIZE. DIE_TYPES size is the distance across opposite faces, the edge
//  for the d4 and the diameter for the coin.
//
//  SHAPES. Each die is a convex polyhedron. hullFaces() finds the faces of
//  the vertex set (planes with all points on one side), and orders each
//  face counter-clockwise about its outward normal. The shapes:
//    d4   tetrahedron            4 faces, read at the top vertex
//    d6   cube                   6 faces, pips or numbers
//    d8   octahedron             8 faces
//    d10  pentagonal trapezohedron, 10 kites, 0-9 (and 00-90 for d%)
//    d12  dodecahedron           12 pentagons
//    d20  icosahedron            20 triangles
//    dF   cube, Fate faces       + + - - and two blanks
//    coin 32-gon prism           2 caps, the sides carry no value
//  A d10 kite is planar only when the apex height b and the ring height a
//  obey b = a (1 + cos 36°) / (1 - cos 36°). d10Shape uses that relation.
//
//  NUMBERING. Opposite faces sum to n + 1 on d6, d8, d12 and d20, and to 9
//  on the 0-9 d10 (so the odd numbers meet at one apex, the even numbers
//  at the other). The d6 has 1, 2, 3 counter-clockwise about their common
//  corner (the western convention). A d4 has a number at each vertex.
//  Each face shows the three numbers of its own corners, and the value is
//  the number at the top vertex.
//
//  CHAMFER. buildDie() cuts each edge with a small flat (bevel). Each face
//  polygon is offset inward by the bevel width in its own plane. The edge
//  strips and the corner caps join the offset faces. The hull of all the
//  offset points is the physics collider, so the collider and the mesh are
//  the same shape.
//
//  FACE READER. readDie() turns world up into the body frame (conj(q) up)
//  and takes the face whose normal is closest to it. A d4 takes the vertex
//  with the largest height. A die is cocked when its resting face (the
//  face closest to down) is more than TILT_DEG from flat.
//
//  GREP MAP
//    export const DIE_TYPES ..... the type table (size, numbering, colour)
//    function hullFaces ......... faces of a convex vertex set
//    function numberFaces ....... opposite-sum numbering
//    export function buildDie ... shape + chamfer + face table + UV cells
//    export function readDie .... the face reader
//    export function orientFor .. a quaternion that puts a face up
//    export function mulberry32 . the seeded random source
// ============================================================================

export const TILT_DEG = 10;
const PHI = (1 + Math.sqrt(5)) / 2;

// ── small vector and quaternion helpers ────────────────────────────────────
export const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
export const Q = {
  // rotate vector v by unit quaternion q
  rot(q, v) {
    const [x, y, z, w] = q, [a, b, c] = v;
    const ix = w * a + y * c - z * b, iy = w * b + z * a - x * c, iz = w * c + x * b - y * a, iw = -x * a - y * b - z * c;
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  },
  conj: q => [-q[0], -q[1], -q[2], q[3]],
  mul(a, b) {
    const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
    return [ax * bw + aw * bx + ay * bz - az * by, ay * bw + aw * by + az * bx - ax * bz, az * bw + aw * bz + ax * by - ay * bx, aw * bw - ax * bx - ay * by - az * bz];
  },
  axisAngle(ax, t) { const s = Math.sin(t / 2), n = V.norm(ax); return [n[0] * s, n[1] * s, n[2] * s, Math.cos(t / 2)]; },
  // the shortest rotation that takes unit vector a to unit vector b
  between(a, b) {
    const d = V.dot(a, b);
    if (d < -0.999999) { let ax = V.cross([1, 0, 0], a); if (V.len(ax) < 1e-6) ax = V.cross([0, 1, 0], a); return Q.axisAngle(ax, Math.PI); }
    const c = V.cross(a, b), q = [c[0], c[1], c[2], 1 + d], l = Math.hypot(...q);
    return q.map(v => v / l);
  },
  // a uniform random rotation (Shoemake), from three uniforms
  random(rnd) {
    const u1 = rnd(), u2 = rnd() * 2 * Math.PI, u3 = rnd() * 2 * Math.PI, s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
    return [s1 * Math.sin(u2), s1 * Math.cos(u2), s2 * Math.sin(u3), s2 * Math.cos(u3)];
  },
};

// mulberry32: a small seeded generator, 32-bit state, uniform in [0, 1)
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// ── the type table ─────────────────────────────────────────────────────────
// size: the distance across opposite faces (d6: edge), cm. bevel: the
// chamfer width as a share of the mean edge. colour/ink: resin defaults.
export const DIE_TYPES = {
  d4:   { name: 'd4',  sides: 4,  label: 'd4',  size: 2.0, bevel: 0.06, colour: '#c8343a', ink: '#fbf3e4', density: 1.2 },
  d6:   { name: 'd6',  sides: 6,  label: 'd6',  size: 1.6, bevel: 0.09, colour: '#efe8d8', ink: '#1d1b22', density: 1.2 },
  d8:   { name: 'd8',  sides: 8,  label: 'd8',  size: 1.3, bevel: 0.07, colour: '#2f6fd0', ink: '#f6f1e2', density: 1.2 },
  d10:  { name: 'd10', sides: 10, label: 'd10', size: 1.6, bevel: 0.06, colour: '#7d4fd0', ink: '#f6f1e2', density: 1.2 },
  d100: { name: 'd%',  sides: 10, label: 'd%',  size: 1.6, bevel: 0.06, colour: '#4a3496', ink: '#f2d37a', density: 1.2 },
  d12:  { name: 'd12', sides: 12, label: 'd12', size: 1.75, bevel: 0.08, colour: '#e0892c', ink: '#1d1b22', density: 1.2 },
  d20:  { name: 'd20', sides: 20, label: 'd20', size: 1.95, bevel: 0.06, colour: '#202026', ink: '#e7c56a', density: 1.2 },
  dF:   { name: 'dF',  sides: 6,  label: 'Fate', size: 1.6, bevel: 0.09, colour: '#2f9e8f', ink: '#f6f1e2', density: 1.2 },
  coin: { name: 'coin', sides: 2, label: 'coin', size: 2.4, bevel: 0.25, colour: '#c9a14a', ink: '#5a4214', density: 8.5 },
};
export const TYPE_ORDER = ['d4', 'd6', 'd8', 'd10', 'd100', 'd12', 'd20', 'dF', 'coin'];

// ── convex hull faces (brute force; at most 64 points here) ────────────────
function hullFaces(P, eps = 1e-6) {
  const n = P.length, planes = [];
  const have = (nv, d) => planes.some(p => V.dot(p.n, nv) > 1 - 1e-6 && Math.abs(p.d - d) < 1e-5);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    let nv = V.cross(V.sub(P[j], P[i]), V.sub(P[k], P[i]));
    if (V.len(nv) < 1e-9) continue;
    nv = V.norm(nv);
    let d = V.dot(nv, P[i]), pos = 0, neg = 0;
    for (let m = 0; m < n; m++) { const s = V.dot(nv, P[m]) - d; if (s > eps) pos++; else if (s < -eps) neg++; }
    if (pos && neg) continue;
    if (pos) { nv = V.mul(nv, -1); d = -d; }
    if (have(nv, d)) continue;
    planes.push({ n: nv, d });
  }
  return planes.map(({ n: nv, d }) => {
    const idx = []; for (let m = 0; m < n; m++) if (Math.abs(V.dot(nv, P[m]) - d) < 1e-5) idx.push(m);
    const c = V.mul(idx.reduce((s, m) => V.add(s, P[m]), [0, 0, 0]), 1 / idx.length);
    const u = V.norm(V.sub(P[idx[0]], c)), w = V.cross(nv, u);
    idx.sort((a, b) => { const pa = V.sub(P[a], c), pb = V.sub(P[b], c); return Math.atan2(V.dot(pa, w), V.dot(pa, u)) - Math.atan2(V.dot(pb, w), V.dot(pb, u)); });
    return { n: nv, d, v: idx, c };
  });
}

// ── base vertex sets ───────────────────────────────────────────────────────
function baseShape(type) {
  const T = DIE_TYPES[type];
  let P;
  switch (type) {
    case 'd4': P = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]; break;
    case 'd6': case 'dF': P = []; for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) P.push([x, y, z]); break;
    case 'd8': P = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]; break;
    case 'd10': case 'd100': {
      const c = Math.cos(Math.PI / 5), a = 0.105, b = a * (1 + c) / (1 - c);
      P = [[0, b, 0], [0, -b, 0]];
      for (let k = 0; k < 10; k++) { const t = k * Math.PI / 5; P.push([Math.cos(t), k % 2 ? -a : a, Math.sin(t)]); }
      break;
    }
    case 'd12': {
      const g = 1 / PHI; P = [];
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) P.push([x, y, z]);
      for (const s of [-1, 1]) for (const t of [-1, 1]) { P.push([0, s * g, t * PHI]); P.push([s * g, t * PHI, 0]); P.push([s * PHI, 0, t * g]); }
      break;
    }
    case 'd20': P = []; for (const s of [-1, 1]) for (const t of [-1, 1]) { P.push([0, s, t * PHI]); P.push([s, t * PHI, 0]); P.push([s * PHI, 0, t]); } break;
    case 'coin': { P = []; const N = 32; for (let k = 0; k < N; k++) { const t = (k + 0.5) * 2 * Math.PI / N; for (const y of [-1, 1]) P.push([Math.cos(t), y * 0.075, Math.sin(t)]); } break; }
  }
  // scale: across-flats = size (the smallest face distance, doubled), or
  // the diameter for the coin
  let s;
  if (type === 'coin') s = T.size / 2;
  else if (type === 'd4') s = T.size / V.len(V.sub(P[0], P[1]));   // d4: size is the edge
  else { const F = hullFaces(P); s = T.size / (2 * Math.min(...F.map(f => f.d))); }
  return P.map(p => V.mul(p, s));
}

// ── numbering ──────────────────────────────────────────────────────────────
// opposite(i): the face whose normal is -n_i (all shapes but d4 are
// centrally symmetric)
function opposite(F, i) { let best = -1, bd = 2; F.forEach((f, j) => { const d = V.dot(f.n, F[i].n); if (d < bd) { bd = d; best = j; } }); return best; }
const azim = n => Math.atan2(n[2], n[0]);

function numberFaces(type, F) {
  const vals = new Array(F.length).fill(null);
  if (type === 'd6' || type === 'dF') {
    // axis faces: +y 1, +x 2, +z 3 is clockwise seen from (1,1,1); the
    // western die has 1-2-3 counter-clockwise, so use +y, +z, +x
    const find = ax => F.findIndex(f => V.dot(f.n, ax) > 0.99);
    const set = (ax, v) => { vals[find(ax)] = v; vals[find(V.mul(ax, -1))] = 7 - v; };
    set([0, 1, 0], 1); set([0, 0, 1], 2); set([1, 0, 0], 3);
    // Fate: 1, 2 -> +; 5, 6 -> -; 3, 4 -> blank, so + is opposite -
    if (type === 'dF') return vals.map(v => v <= 2 ? 1 : v >= 5 ? -1 : 0);
    return vals;
  }
  if (type === 'coin') {
    return F.map(f => f.n[1] > 0.99 ? 1 : f.n[1] < -0.99 ? 0 : null);
  }
  if (type === 'd10' || type === 'd100') {
    // upper kites (normal y > 0) get the odd numbers, by azimuth; the
    // opposite kite gets 9 - v
    const up = F.map((f, i) => i).filter(i => F[i].n[1] > 0).sort((a, b) => azim(F[a].n) - azim(F[b].n));
    const odd = [1, 7, 3, 9, 5];
    up.forEach((i, k) => { vals[i] = odd[k]; vals[opposite(F, i)] = 9 - odd[k]; });
    return vals;
  }
  // d8, d12, d20: pair the opposite faces; sort the pairs by the azimuth and
  // height of the upper face; alternate low and high numbers so that the
  // upper half mixes them
  const n = F.length, done = new Set(), pairs = [];
  F.forEach((f, i) => {
    if (done.has(i)) return;
    const j = opposite(F, i); done.add(i); done.add(j);
    const [a, b] = (F[i].n[1] > F[j].n[1] + 1e-9 || (Math.abs(F[i].n[1] - F[j].n[1]) < 1e-9 && azim(F[i].n) > azim(F[j].n))) ? [i, j] : [j, i];
    pairs.push([a, b]);
  });
  pairs.sort((p, q) => (F[q[0]].n[1] - F[p[0]].n[1]) || (azim(F[p[0]].n) - azim(F[q[0]].n)));
  pairs.forEach(([a, b], k) => { const v = k + 1; if (k % 2) { vals[a] = n + 1 - v; vals[b] = v; } else { vals[a] = v; vals[b] = n + 1 - v; } });
  return vals;
}

// ── build ─────────────────────────────────────────────────────────────────
// A built die: { type, faces: [{ n, c, poly, value, label, up, uv }],
//   verts (base), vLabels (d4), hull (Float32Array of chamfer points),
//   mesh: { pos, nrm, uv, index }, cells, cols }.
// The UV cell of face i is i; the last cell is blank (the bevel).
const cache = new Map();
export function buildDie(type) {
  if (cache.has(type)) return cache.get(type);
  const T = DIE_TYPES[type];
  const P = baseShape(type), F = hullFaces(P), vals = numberFaces(type, F);
  // d4: vertex labels 1..4, value of face = label of its opposite vertex
  // (the vertex that is up when that face is down)
  let vLabels = null;
  if (type === 'd4') vLabels = [1, 2, 3, 4];
  const faces = F.map((f, i) => {
    const poly = f.v.map(m => P[m]);
    // text up direction in the face plane: to the farthest vertex (kites,
    // triangles, pentagons), or to the middle of the first edge (squares)
    let up;
    if (poly.length === 4 && type !== 'd10' && type !== 'd100') up = V.norm(V.sub(V.mul(V.add(poly[0], poly[1]), 0.5), f.c));
    else if (poly.length > 8) up = [0, 0, 1];
    else { let far = 0, fd = 0; poly.forEach((p, k) => { const d = V.len(V.sub(p, f.c)); if (d > fd + 1e-9) { fd = d; far = k; } }); up = V.norm(V.sub(poly[far], f.c)); }
    up = V.norm(V.sub(up, V.mul(f.n, V.dot(up, f.n))));
    let value = vals[i], label = value == null ? '' : String(value);
    if (type === 'd100') { label = value === 0 ? '00' : String(value * 10); value = value * 10; }
    if (type === 'dF') label = value > 0 ? '+' : value < 0 ? '−' : '';
    if (type === 'coin') label = value === 1 ? 'H' : value === 0 ? 'T' : '';
    let corners = null;
    if (type === 'd4') {
      // the three corner numbers on this face, each by its own vertex
      corners = f.v.map(m => ({ p: P[m], label: String(vLabels[m]) }));
      const opp = [0, 1, 2, 3].find(m => !f.v.includes(m));
      value = vLabels[opp]; label = String(value);
    }
    return { n: f.n, c: f.c, d: f.d, poly, vIdx: f.v, value, label, up, corners, valued: value != null && !(type === 'coin' && Math.abs(f.n[1]) < 0.99) };
  });
  // UV cells: a square grid; face polygons in their (right, up) basis,
  // one scale for the whole die
  const cells = faces.length + 1, cols = Math.ceil(Math.sqrt(cells));
  let rMax = 0;
  faces.forEach(f => f.poly.forEach(p => { rMax = Math.max(rMax, V.len(V.sub(p, f.c))); }));
  const uvScale = 0.46 / rMax;      // cell units per cm
  faces.forEach((f, i) => {
    f.right = V.cross(f.up, f.n);
    f.cell = i; f.cellX = i % cols; f.cellY = Math.floor(i / cols);
    f.to2 = p => { const d = V.sub(p, f.c); return [V.dot(d, f.right) * uvScale, V.dot(d, f.up) * uvScale]; };
  });
  const blank = faces.length;
  const cellUV = (i, x, y) => [((i % cols) + 0.5 + x) / cols, 1 - (Math.floor(i / cols) + 0.5 - y) / cols];

  // chamfer: offset each face polygon inward by b in its plane
  let edgeSum = 0, edgeN = 0;
  faces.forEach(f => f.poly.forEach((p, k) => { edgeSum += V.len(V.sub(f.poly[(k + 1) % f.poly.length], p)); edgeN++; }));
  const b = T.bevel * (type === 'coin' ? 0.12 : edgeSum / edgeN);
  faces.forEach(f => {
    const m = f.poly.length, ins = [];
    for (let k = 0; k < m; k++) {
      const p0 = f.poly[(k + m - 1) % m], p1 = f.poly[k], p2 = f.poly[(k + 1) % m];
      const e0 = V.norm(V.sub(p1, p0)), e1 = V.norm(V.sub(p2, p1));
      const n0 = V.cross(f.n, e0), n1 = V.cross(f.n, e1);        // inward edge normals
      // the point at distance b from both edge lines
      const bis = V.norm(V.add(n0, n1)), cosh = V.dot(bis, n0);
      ins.push(V.add(p1, V.mul(bis, b / Math.max(0.05, cosh))));
    }
    f.inset = ins;
  });
  // mesh
  const pos = [], nrm = [], uv = [], index = [];
  const vert = (p, n, t) => { pos.push(...p); nrm.push(...n); uv.push(...t); return pos.length / 3 - 1; };
  const tri = (a, b2, c, outward) => {
    const pa = pos.slice(a * 3, a * 3 + 3), pb = pos.slice(b2 * 3, b2 * 3 + 3), pc = pos.slice(c * 3, c * 3 + 3);
    const nn = V.cross(V.sub(pb, pa), V.sub(pc, pa));
    if (V.dot(nn, outward) < 0) index.push(a, c, b2); else index.push(a, b2, c);
  };
  const blankUV = cellUV(blank, 0, 0);
  faces.forEach((f, i) => {
    const ids = f.inset.map(p => { const [x, y] = f.to2(p); return vert(p, f.n, cellUV(i, x, y)); });
    for (let k = 1; k < ids.length - 1; k++) tri(ids[0], ids[k], ids[k + 1], f.n);
  });
  // edge strips: for each pair of faces that share an edge (two base verts)
  const key = (a, c) => a < c ? a + '_' + c : c + '_' + a, edges = new Map();
  faces.forEach((f, i) => f.vIdx.forEach((m, k) => {
    const m2 = f.vIdx[(k + 1) % f.vIdx.length], kk = key(m, m2);
    if (!edges.has(kk)) edges.set(kk, []);
    edges.get(kk).push({ f: i, a: k, b: (k + 1) % f.vIdx.length, ma: m, mb: m2 });
  }));
  for (const [, list] of edges) {
    if (list.length !== 2) continue;
    const [e, g] = list, F1 = faces[e.f], F2 = faces[g.f];
    const gA = F2.vIdx.indexOf(e.ma), gB = F2.vIdx.indexOf(e.mb);
    const out = V.norm(V.add(F1.n, F2.n));
    const q = [vert(F1.inset[e.a], F1.n, blankUV), vert(F1.inset[e.b], F1.n, blankUV), vert(F2.inset[gB], F2.n, blankUV), vert(F2.inset[gA], F2.n, blankUV)];
    tri(q[0], q[1], q[2], out); tri(q[0], q[2], q[3], out);
  }
  // corner caps
  P.forEach((p, m) => {
    const inc = faces.map((f, i) => ({ f, i, k: f.vIdx.indexOf(m) })).filter(o => o.k >= 0);
    if (inc.length < 3) return;
    const dir = V.norm(p), u = V.norm(V.cross(dir, Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), w = V.cross(dir, u);
    const pts = inc.map(o => ({ p: o.f.inset[o.k], n: o.f.n })).sort((A, B) => {
      const a = V.sub(A.p, p), c = V.sub(B.p, p); return Math.atan2(V.dot(a, w), V.dot(a, u)) - Math.atan2(V.dot(c, w), V.dot(c, u));
    });
    const ids = pts.map(o => vert(o.p, o.n, blankUV));
    for (let k = 1; k < ids.length - 1; k++) tri(ids[0], ids[k], ids[k + 1], dir);
  });
  // collider points: every inset point, once
  const hullPts = [];
  faces.forEach(f => f.inset.forEach(p => hullPts.push(...p)));
  // bounding radius (for the throw spacing and the camera)
  let R = 0; P.forEach(p => { R = Math.max(R, V.len(p)); });
  const die = { type, T, faces, verts: P, vLabels, hull: new Float32Array(hullPts), mesh: { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), index }, cells, cols, uvScale, bevel: b, R, valued: faces.filter(f => f.valued) };
  // values that a fair throw gives, with their number of faces
  die.outcomes = type === 'd4' ? vLabels.slice() : die.valued.map(f => f.value);
  cache.set(type, die);
  return die;
}

// ── the face reader ────────────────────────────────────────────────────────
// q: body to world rotation [x, y, z, w]. Returns { value, label, face,
// tilt (deg, of the resting face from flat), cocked }.
export function readDie(die, q, tiltDeg = TILT_DEG) {
  const up = Q.rot(Q.conj(q), [0, 1, 0]);          // world up in the body frame
  let down = -1, dd = -2;
  die.faces.forEach((f, i) => { const d = -V.dot(f.n, up); if (d > dd) { dd = d; down = i; } });
  const tilt = Math.acos(Math.min(1, dd)) * 180 / Math.PI;
  const cocked = tilt > tiltDeg || !die.faces[down].valued && die.type === 'coin';
  if (die.type === 'd4') {
    let top = 0, th = -1e9;
    die.verts.forEach((p, m) => { const h = V.dot(p, up); if (h > th) { th = h; top = m; } });
    const value = die.vLabels[top];
    return { value, label: String(value), face: down, vertex: top, tilt, cocked };
  }
  let top = -1, tu = -2;
  die.faces.forEach((f, i) => { if (!f.valued) return; const d = V.dot(f.n, up); if (d > tu) { tu = d; top = i; } });
  const f = die.faces[top];
  return { value: f.value, label: f.label, face: top, tilt, cocked };
}

// orientFor: a rotation that puts face i up (d4: face i down, so its
// opposite vertex is up), then turns it by yaw about world up
export function orientFor(die, i, yaw = 0) {
  const n = die.faces[i].n;
  const q0 = die.type === 'd4' ? Q.between(n, [0, -1, 0]) : Q.between(n, [0, 1, 0]);
  return Q.mul(Q.axisAngle([0, 1, 0], yaw), q0);
}

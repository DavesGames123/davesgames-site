// ============================================================================
//  DIAMOND LAB  ·  cuts.js — procedural gem cuts as convex polyhedra
// ----------------------------------------------------------------------------
//  DOM-free ES module. A cut is a set of half-spaces n.x <= d (one per
//  facet plane). Their intersection is the stone, and it is convex by
//  construction. The shader needs only the planes: a ray enters at the
//  largest entry t and leaves at the smallest exit t (Haines 1991).
//  The faces (polygons) come from clipping a big cube by every plane, for
//  the facet diagram and the tests (closed, convex, Euler V - E + F = 2).
//
//  Frame: y is up, the table faces +y, the girdle is the plane y = 0
//  before centring. The outline (the girdle seen from above) is in x, z
//  and its largest half-width is 1.
//
//  How a facet plane is made: a horizontal outward normal N of the
//  outline, tilted by the facet angle a from the horizontal plane, gives
//      crown facet     n = N sin a + up cos a
//      pavilion facet  n = N sin a - up cos a
//  and the plane goes through a chosen point (a girdle point, a table
//  edge point). A plane that adds no face to the solid is dropped, so a
//  pattern can ask for facets that a shape does not have.
//
//  Patterns
//    brilliant crown   table, M mains, M stars, 2M upper girdle facets
//    brilliant pavil.  M mains, 2M lower girdle facets, culet
//    step crown/pavil. K tiers of facets parallel to each outline side
//
//  GREP MAP
//    const CUTS ............. the cut list: outline, patterns, proportions
//    function outline* ...... outlines: circle, ellipse, superellipse, hull
//    function outlineAt ..... point and outward normal at parameter u
//    function brilliantCrown / brilliantPavilion / stepCrown / stepPavilion
//    function buildCut ...... planes + faces + stats for one cut
//    function clipPolyhedron  faces of the intersection of half-spaces
//    function topology ...... welded vertices, edges, Euler number
// ============================================================================

const TAU = Math.PI * 2, RAD = Math.PI / 180;
export const MAX_PLANES = 192;

// ── outlines ────────────────────────────────────────────────────────────────
// An outline is a convex polygon pts (CCW seen from +y, as [x, z]) and
// sides: the long straight sides for a step pattern ({ p, n } each).
function convexHull(points) {
  const P = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 1e-12) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 1e-12) up.pop(); up.push(p); }
  up.pop(); lo.pop();
  return lo.concat(up);
}
function circlePts(cx, cz, r, n = 256) { const o = []; for (let i = 0; i < n; i++) { const a = i / n * TAU; o.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); } return o; }
function finish(pts, sides = null) {
  // Orient CCW about +y: with x right and z toward the viewer, CCW in (x, z)
  // seen from +y means the signed area in (x, -z) is positive. We keep the
  // math simple: we only need outward normals, made from the centroid.
  let mx = 0, mz = 0; for (const p of pts) { mx += p[0]; mz += p[1]; } mx /= pts.length; mz /= pts.length;
  let ex = 0; for (const p of pts) ex = Math.max(ex, Math.hypot(p[0], p[1]));
  const ext = Math.max(...pts.map(p => Math.abs(p[0]))), exz = Math.max(...pts.map(p => Math.abs(p[1])));
  const k = 1 / Math.max(ext, exz);
  const P = pts.map(p => [p[0] * k, p[1] * k]);
  const S = sides ? sides.map(s => ({ p: [s.p[0] * k, s.p[1] * k], n: s.n })) : null;
  return { pts: P, sides: S, hx: ext * k, hz: exz * k };
}
export function outlineCircle() { return finish(circlePts(0, 0, 1, 512)); }
export function outlineEllipse(a, b) { return finish(circlePts(0, 0, 1, 512).map(([x, z]) => [a * x, b * z])); }
export function outlineSuper(a, b, p) {
  const o = [];
  for (let i = 0; i < 512; i++) { const t = i / 512 * TAU, c = Math.cos(t), s = Math.sin(t); o.push([a * Math.sign(c) * Math.abs(c) ** (2 / p), b * Math.sign(s) * Math.abs(s) ** (2 / p)]); }
  return finish(convexHull(o));
}
export function outlinePear() { return finish(convexHull(circlePts(-0.36, 0, 0.64, 400).concat(circlePts(0.96, 0, 0.04, 40)))); }
export function outlineMarquise() {
  // a lens: two circles of radius R with centres at z = +-c; tips at x = +-1
  const c = 0.75, R = 1.25, o = [];
  for (const sgn of [1, -1]) for (const p of circlePts(0, -sgn * c, R, 2048)) if (Math.hypot(p[0], p[1] - sgn * c) <= R + 1e-9) o.push(p);
  return finish(convexHull(o));
}
export function outlineTrillion() {
  const o = [];
  for (let k = 0; k < 3; k++) { const a = k / 3 * TAU; o.push(...circlePts(0.86 * Math.cos(a), 0.86 * Math.sin(a), 0.16, 90)); }
  return finish(convexHull(o));
}
// A rectangle hx x hz with 45° corner cuts of size c (an octagon). sides
// are the eight straight sides, for the step pattern.
export function outlineOctagon(hx, hz, c) {
  const pts = [[hx, -hz + c], [hx, hz - c], [hx - c, hz], [-hx + c, hz], [-hx, hz - c], [-hx, -hz + c], [-hx + c, -hz], [hx - c, -hz]];
  const sides = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let n = [b[1] - a[1], -(b[0] - a[0])]; const L = Math.hypot(n[0], n[1]); n = [n[0] / L, n[1] / L];
    if (n[0] * mid[0] + n[1] * mid[1] < 0) n = [-n[0], -n[1]];
    if (L > 1e-9) sides.push({ p: mid, n });
  }
  return finish(pts, sides);
}

// The outline point hit by the ray from the centre toward (hx cos u, hz sin
// u), and the outward normal there. At a corner (a hit within 2% of a
// vertex) the normal is the mean of the two side normals.
export function outlineAt(O, u) {
  const dx = O.hx * Math.cos(u), dz = O.hz * Math.sin(u), P = O.pts, n = P.length;
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-14) continue;
    const t = (a[0] * ez - a[1] * ex) / den, s = (a[0] * dz - a[1] * dx) / den;
    if (t <= 0 || s < -1e-9 || s > 1 + 1e-9) continue;
    const nrm = sideNormal(a, b);
    let N = nrm;
    const L = Math.hypot(ex, ez), near = 0.02 / Math.max(L, 1e-9);
    if (s < near) N = avg(nrm, sideNormal(P[(i - 1 + n) % n], a));
    else if (s > 1 - near) N = avg(nrm, sideNormal(b, P[(i + 2) % n]));
    return { p: [t * dx, t * dz], n: N };
  }
  throw new Error('outlineAt: no hit');
}
function sideNormal(a, b) {
  let n = [b[1] - a[1], -(b[0] - a[0])]; const L = Math.hypot(n[0], n[1]); n = [n[0] / L, n[1] / L];
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return n[0] * m[0] + n[1] * m[1] < 0 ? [-n[0], -n[1]] : n;
}
function avg(a, b) { const x = a[0] + b[0], z = a[1] + b[1], L = Math.hypot(x, z); return [x / L, z / L]; }

// ── planes ──────────────────────────────────────────────────────────────────
// A facet plane through point q (x, y, z) with horizontal outward normal N
// (x, z), tilted by angle a. top: crown (normal up) or pavilion (down).
function facet(N, q, a, top, kind) {
  const s = Math.sin(a), c = Math.cos(a) * (top ? 1 : -1);
  const n = [N[0] * s, c, N[1] * s];
  return { n, d: n[0] * q[0] + n[1] * q[1] + n[2] * q[2], kind };
}
// The support distance of the outline in direction N: max over pts of N.p.
function support(O, N) { let m = -Infinity; for (const p of O.pts) m = Math.max(m, N[0] * p[0] + N[1] * p[1]); return m; }

function girdlePlanes(O, P, out) {
  if (O.sides) { for (const s of O.sides) out.push({ n: [s.n[0], 0, s.n[1]], d: s.n[0] * s.p[0] + s.n[1] * s.p[1], kind: 'girdle' }); return; }
  for (let k = 0; k < P.girdleN; k++) {
    const { n } = outlineAt(O, k / P.girdleN * TAU + P.phase);
    out.push({ n: [n[0], 0, n[1]], d: support(O, n), kind: 'girdle' });
  }
}
// The normal of a star or girdle facet: the outline normal turned a quarter
// to the radial direction. On a circle the two are the same. On a straight
// side the turn fans the facets, so they cut a face (the chevrons of a
// princess) and do not hide behind the main facet of that side.
const FAN = 0.25;
function fan(n, p) {
  const L = Math.hypot(p[0], p[1]); if (L < 1e-9) return n;
  const r = [p[0] / L, p[1] / L], x = n[0] + FAN * (r[0] - n[0]), z = n[1] + FAN * (r[1] - n[1]), M = Math.hypot(x, z);
  return [x / M, z / M];
}
// Brilliant crown. M mains through the girdle top at u_m; the table at the
// height where a main at the mean main distance reaches the table ratio;
// M stars through the table edge between mains; 2M upper girdle facets
// through the girdle top between main and star.
function brilliantCrown(O, P, out) {
  const M = P.mains, y0 = P.girdle / 2, a = P.crown * RAD;
  let sMean = 0;
  for (let m = 0; m < M; m++) {
    const u = m / M * TAU + P.phase, { p, n } = outlineAt(O, u);
    out.push(facet(n, [p[0], y0, p[1]], a, true, 'crown main'));
    sMean += n[0] * p[0] + n[1] * p[1];
  }
  sMean /= M;
  const yt = y0 + (1 - P.table) * sMean * Math.tan(a);
  out.push({ n: [0, 1, 0], d: yt, kind: 'table' });
  for (let m = 0; m < M; m++) {
    const u = (m + 0.5) / M * TAU + P.phase, { p, n } = outlineAt(O, u);
    out.push(facet(fan(n, p), [p[0] * P.table, yt, p[1] * P.table], P.star * RAD, true, 'star'));
    for (const f of [0.25, 0.75]) {
      const v = (m + f) / M * TAU + P.phase, h = outlineAt(O, v);
      out.push(facet(fan(h.n, h.p), [h.p[0], y0, h.p[1]], P.upperGirdle * RAD, true, 'upper girdle'));
    }
  }
}
function brilliantPavilion(O, P, out) {
  const M = P.mains, y0 = -P.girdle / 2, b = P.pav * RAD;
  let sMin = Infinity;
  for (let m = 0; m < M; m++) {
    const u = m / M * TAU + P.phase, { p, n } = outlineAt(O, u);
    out.push(facet(n, [p[0], y0, p[1]], b, false, 'pavilion main'));
    sMin = Math.min(sMin, n[0] * p[0] + n[1] * p[1]);
    for (const f of [-0.25, 0.25]) {
      const h = outlineAt(O, (m + f) / M * TAU + P.phase);
      out.push(facet(fan(h.n, h.p), [h.p[0], y0, h.p[1]], P.lowerGirdle * RAD, false, 'lower girdle'));
    }
  }
  out.push({ n: [0, -1, 0], d: -(y0 - sMin * Math.tan(b) * (1 - P.culet)), kind: 'culet' });
}
// Step tiers. Each side gets K facets; tier k starts where tier k-1 ends,
// in from the side by w and up (or down) by w tan(angle_k).
function stepTiers(O, P, out, top) {
  const y0 = (top ? 1 : -1) * P.girdle / 2;
  const angles = top ? P.crownTiers.map(t => (P.crown + t) * RAD) : P.pavTiers.map(t => (P.pav + t) * RAD);
  const K = angles.length;
  let sMin = Infinity; for (const s of O.sides) sMin = Math.min(sMin, s.n[0] * s.p[0] + s.n[1] * s.p[1]);
  const W = top ? (1 - P.table) * sMin : sMin * (1 - P.culet);
  let yEnd = y0;
  for (const s of O.sides) {
    let w = 0, y = y0;
    for (let k = 0; k < K; k++) {
      out.push(facet(s.n, [s.p[0] - s.n[0] * w, y, s.p[1] - s.n[1] * w], angles[k], top, top ? 'crown step' : 'pavilion step'));
      const dw = W / K;
      w += dw; y += (top ? 1 : -1) * dw * Math.tan(angles[k]);
    }
    yEnd = top ? Math.max(yEnd, y) : Math.min(yEnd, y);
  }
  if (top) { let y = y0; for (let k = 0; k < K; k++) y += W / K * Math.tan(angles[k]); out.push({ n: [0, 1, 0], d: y, kind: 'table' }); }
  else { let y = y0; for (let k = 0; k < K; k++) y -= W / K * Math.tan(angles[k]); out.push({ n: [0, -1, 0], d: -y, kind: 'culet' }); }
}
const stepCrown = (O, P, out) => stepTiers(O, P, out, true);
const stepPavilion = (O, P, out) => stepTiers(O, P, out, false);

// ── the cut list ────────────────────────────────────────────────────────────
// p: the default proportions. table is the table width over the girdle
// width (brilliant), crown and pav the main facet angles in degrees,
// girdle the girdle thickness in units of the half-width.
const BRILLIANT = { table: 0.56, crown: 34.5, pav: 40.75, girdle: 0.03, star: 21, upperGirdle: 41.5, lowerGirdle: 42.3, culet: 0.02, mains: 8, girdleN: 48, phase: 0 };
export const CUTS = {
  round:    { name: 'Round brilliant', outline: outlineCircle, crown: brilliantCrown, pav: brilliantPavilion, p: { ...BRILLIANT }, note: 'Tolkowsky (1919): crown 34.5°, pavilion 40.75°, table 53%. 57 facets.' },
  oval:     { name: 'Oval',            outline: () => outlineEllipse(1, 0.7), crown: brilliantCrown, pav: brilliantPavilion, p: { ...BRILLIANT, table: 0.58, girdleN: 56 }, note: 'A stretched brilliant. Along the long axis the pavilion gets shallow: the dark bow tie.' },
  cushion:  { name: 'Cushion',         outline: () => outlineSuper(1, 0.93, 3.2), crown: brilliantCrown, pav: brilliantPavilion, p: { ...BRILLIANT, table: 0.6, crown: 36, pav: 41.5, girdleN: 56 }, note: 'A pillow outline with brilliant facets. Its broad mains give large flashes.' },
  pear:     { name: 'Pear',            outline: outlinePear, crown: brilliantCrown, pav: brilliantPavilion, p: { ...BRILLIANT, table: 0.55, girdleN: 64 }, note: 'A brilliant drawn out to one point. The pavilion makes a keel toward the tip.' },
  marquise: { name: 'Marquise',        outline: outlineMarquise, crown: brilliantCrown, pav: brilliantPavilion, p: { ...BRILLIANT, table: 0.55, girdleN: 64 }, note: 'A lens outline with two points. The keel runs from tip to tip.' },
  trillion: { name: 'Trillion',        outline: outlineTrillion, crown: brilliantCrown, pav: brilliantPavilion, p: { ...BRILLIANT, mains: 6, table: 0.6, crown: 32, pav: 41, girdleN: 48 }, note: 'A triangle with six-fold brilliant facets and curved sides.' },
  princess: { name: 'Princess',        outline: () => outlineOctagon(1, 1, 0.06), crown: stepCrown, pav: brilliantPavilion, p: { ...BRILLIANT, table: 0.68, crown: 36, crownTiers: [6, -8], pav: 41.5, lowerGirdle: 43, culet: 0.01 }, note: 'A square: step facets on the crown, chevrons of brilliant facets below.' },
  emerald:  { name: 'Emerald',         outline: () => outlineOctagon(1, 0.7, 0.18), crown: stepCrown, pav: stepPavilion, p: { ...BRILLIANT, table: 0.62, crown: 40, crownTiers: [6, -6, -18], pav: 44, pavTiers: [12, 2, -8], culet: 0.04 }, note: 'Step facets parallel to the sides. Few large mirrors: flashes, a hall of mirrors, little fire.' },
  asscher:  { name: 'Asscher',         outline: () => outlineOctagon(1, 1, 0.3), crown: stepCrown, pav: stepPavilion, p: { ...BRILLIANT, table: 0.56, crown: 40, crownTiers: [6, -6, -18], pav: 44, pavTiers: [12, 2, -8], culet: 0.03 }, note: 'A square step cut with large corners (Asscher, 1902). The steps make concentric squares.' },
};
export const CUT_KEYS = Object.keys(CUTS);
// The proportion ranges the sliders allow. Every cut must close at every
// corner of this box (tests.mjs builds them all).
export const RANGES = { table: [0.45, 0.72], crown: [25, 42], pav: [34, 56], girdle: [0.01, 0.08] };

// ── build ───────────────────────────────────────────────────────────────────
// buildCut(key, over) -> { key, name, planes, faces, stats }
//   over: proportion overrides { table, crown, pav, girdle }
//   planes: [{ n, d, kind }], only the planes that make a face, with the
//           solid centred on the box centre of its vertices
//   faces:  [{ plane (index into planes), kind, verts: [[x, y, z]..] }]
//   stats:  { facets, radius, height, crownH, pavD, tableW, width }
export function buildCut(key, over = {}) {
  const C = CUTS[key]; if (!C) throw new Error('no cut ' + key);
  const P = { ...C.p };
  for (const k of Object.keys(RANGES)) if (over[k] != null) P[k] = Math.min(RANGES[k][1], Math.max(RANGES[k][0], over[k]));
  // Facet angles that go with the main angles: the stars and girdle facets
  // keep their offsets from the defaults.
  P.star = C.p.star + (P.crown - C.p.crown) * 0.6;
  P.upperGirdle = C.p.upperGirdle + (P.crown - C.p.crown);
  P.lowerGirdle = C.p.lowerGirdle + (P.pav - C.p.pav);
  const O = C.outline();
  const raw = [];
  girdlePlanes(O, P, raw);
  C.crown(O, P, raw);
  C.pav(O, P, raw);
  // drop repeated planes (parallel sides of an outline give the same plane)
  const uniq = [];
  for (const p of raw) {
    const L = Math.hypot(...p.n), q = { n: p.n.map(v => v / L), d: p.d / L, kind: p.kind };
    if (!uniq.some(o => Math.abs(o.d - q.d) < 1e-7 && Math.abs(o.n[0] - q.n[0]) < 1e-7 && Math.abs(o.n[1] - q.n[1]) < 1e-7 && Math.abs(o.n[2] - q.n[2]) < 1e-7)) uniq.push(q);
  }
  let faces = clipPolyhedron(uniq);
  // keep only the planes that make a face, then centre the solid
  const used = [...new Set(faces.map(f => f.plane))].filter(i => i >= 0).sort((a, b) => a - b);
  const remap = new Map(used.map((i, j) => [i, j]));
  let planes = used.map(i => uniq[i]);
  faces = faces.map(f => ({ ...f, plane: remap.has(f.plane) ? remap.get(f.plane) : -1 }));
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const f of faces) for (const v of f.verts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], v[i]); hi[i] = Math.max(hi[i], v[i]); }
  const c = lo.map((v, i) => (v + hi[i]) / 2);
  planes = planes.map(p => ({ ...p, d: p.d - (p.n[0] * c[0] + p.n[1] * c[1] + p.n[2] * c[2]) }));
  faces = faces.map(f => ({ ...f, kind: f.plane >= 0 ? planes[f.plane].kind : 'box', verts: f.verts.map(v => [v[0] - c[0], v[1] - c[1], v[2] - c[2]]) }));
  let radius = 0; for (const f of faces) for (const v of f.verts) radius = Math.max(radius, Math.hypot(...v));
  const width = Math.max(hi[0] - lo[0], hi[2] - lo[2]);
  const girdleY = -c[1];
  const tableF = faces.find(f => f.kind === 'table');
  let tableW = 0;
  if (tableF) { let mn = Infinity, mx = -Infinity; for (const v of tableF.verts) { mn = Math.min(mn, v[0]); mx = Math.max(mx, v[0]); } tableW = mx - mn; }
  const stats = {
    facets: faces.filter(f => f.kind !== 'girdle').length, planes: planes.length, radius, width,
    height: hi[1] - lo[1], crownH: (hi[1] - c[1]) - (girdleY + P.girdle / 2), pavD: (girdleY - P.girdle / 2) - (lo[1] - c[1]),
    tableW, params: P,
  };
  return { key, name: C.name, note: C.note, planes, faces, stats };
}

// ── half-space intersection by clipping ─────────────────────────────────────
// Start from a cube of half-size B (faces CCW seen from outside) and clip
// every face by each plane in turn (Sutherland-Hodgman). The points on the
// cut make a new face on that plane, sorted CCW about its normal.
export function clipPolyhedron(planes, B = 4) {
  const cube = [
    { plane: -1, verts: [[B, -B, -B], [B, B, -B], [B, B, B], [B, -B, B]] },
    { plane: -2, verts: [[-B, -B, -B], [-B, -B, B], [-B, B, B], [-B, B, -B]] },
    { plane: -3, verts: [[-B, B, -B], [-B, B, B], [B, B, B], [B, B, -B]] },
    { plane: -4, verts: [[-B, -B, -B], [B, -B, -B], [B, -B, B], [-B, -B, B]] },
    { plane: -5, verts: [[-B, -B, B], [B, -B, B], [B, B, B], [-B, B, B]] },
    { plane: -6, verts: [[-B, -B, -B], [-B, B, -B], [B, B, -B], [B, -B, -B]] },
  ];
  let faces = cube;
  const EPS = 1e-10;
  planes.forEach((pl, pi) => {
    const sd = v => pl.n[0] * v[0] + pl.n[1] * v[1] + pl.n[2] * v[2] - pl.d;
    const next = [], cut = [];
    for (const f of faces) {
      const V = f.verts, out = [];
      for (let i = 0; i < V.length; i++) {
        const a = V[i], b = V[(i + 1) % V.length], da = sd(a), db = sd(b);
        if (da <= EPS) out.push(a);
        if (da <= EPS && Math.abs(da) <= EPS) cut.push(a);
        if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
          const t = da / (da - db), q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          out.push(q); cut.push(q);
        }
      }
      const clean = dedupe(out);
      if (clean.length >= 3 && polyArea(clean) > 1e-12) next.push({ plane: f.plane, verts: clean });
    }
    const cap = capPolygon(dedupe(uniquePts(cut)), pl.n);
    if (cap.length >= 3 && polyArea(cap) > 1e-12) next.push({ plane: pi, verts: cap });
    faces = next;
  });
  return faces;
}
function uniquePts(P) { const o = []; for (const p of P) if (!o.some(q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-9)) o.push(p); return o; }
function dedupe(V) {
  const o = [];
  for (const v of V) { const l = o[o.length - 1]; if (!l || Math.hypot(v[0] - l[0], v[1] - l[1], v[2] - l[2]) > 1e-9) o.push(v); }
  while (o.length > 1) { const a = o[0], b = o[o.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= 1e-9) o.pop(); else break; }
  return o;
}
function capPolygon(P, n) {
  if (P.length < 3) return P;
  const c = [0, 1, 2].map(i => P.reduce((a, p) => a + p[i], 0) / P.length);
  const t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(t, n)), v = cross(n, u);
  return P.map(p => ({ p, a: Math.atan2(dot3(sub(p, c), v), dot3(sub(p, c), u)) })).sort((x, y) => x.a - y.a).map(o => o.p);
}
export function polyArea(V) { return Math.hypot(...polyAreaVec(V)) / 2; }
export function polyAreaVec(V) {
  let s = [0, 0, 0];
  for (let i = 0; i < V.length; i++) { const c = cross(V[i], V[(i + 1) % V.length]); s = [s[0] + c[0], s[1] + c[1], s[2] + c[2]]; }
  return s;   // twice the vector area
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const L = Math.hypot(a[0], a[1], a[2]); return [a[0] / L, a[1] / L, a[2] / L]; };

// Welded topology of the faces: vertices merged within eps, consecutive
// repeats removed. edges counts each undirected edge once. bad lists the
// directed edges that do not have exactly one reverse partner (a closed,
// consistently oriented surface has none).
export function topology(faces, eps = 1e-6) {
  const V = [], loops = [];
  const id = p => { for (let i = 0; i < V.length; i++) if (Math.hypot(p[0] - V[i][0], p[1] - V[i][1], p[2] - V[i][2]) < eps) return i; V.push(p); return V.length - 1; };
  for (const f of faces) {
    const L = []; for (const v of f.verts) { const i = id(v); if (L[L.length - 1] !== i) L.push(i); }
    while (L.length > 1 && L[0] === L[L.length - 1]) L.pop();
    loops.push(L);
  }
  const dir = new Map();
  for (const L of loops) for (let i = 0; i < L.length; i++) { const k = L[i] + ',' + L[(i + 1) % L.length]; dir.set(k, (dir.get(k) || 0) + 1); }
  const bad = [];
  for (const [k, c] of dir) { const [a, b] = k.split(','); if (c !== 1 || dir.get(b + ',' + a) !== 1) bad.push(k); }
  return { V: V.length, E: dir.size / 2, F: faces.length, euler: V.length - dir.size / 2 + faces.length, bad, verts: V };
}

// Planes packed for the GPU: vec4 (n.xyz, d) each, MAX_PLANES slots.
export function packPlanes(planes, out = new Float32Array(MAX_PLANES * 4)) {
  out.fill(0);
  planes.forEach((p, i) => out.set([p.n[0], p.n[1], p.n[2], p.d], i * 4));
  return out;
}

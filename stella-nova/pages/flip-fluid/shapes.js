// ============================================================================
//  FLIP WATER  ·  shapes.js  —  2D shape geometry for solids and bodies
// ----------------------------------------------------------------------------
//  Our addition to the Ten Minute Physics port (not upstream code).
//
//  A shape is a simple polygon in local coordinates plus a radius r. The
//  solid is every point within r of the polygon. One vertex gives a disc,
//  two vertices give a capsule, three or more give a rounded polygon. The
//  signed distance (SDF) is negative inside. The polygon distance follows
//  Inigo Quilez, "2D distance functions" (iquilezles.org), sdPolygon.
//
//  A placed shape is { shape, x, y, a }: the local origin goes to (x, y)
//  and the shape turns by angle a (radians, counter-clockwise).
//
//  grep -n targets
//    function sdfLocal     signed distance in local coordinates
//    function sdfWorld     signed distance of a placed shape
//    function normalWorld  outward unit normal by central differences
//    function box / disc / capsule / poly / segment   constructors
//    function areaSamples  interior sample points (mass, inertia, buoyancy)
//    function bound        bounding radius about the local origin
// ============================================================================

export function makeShape(points, r) {
  const n = points.length;
  const v = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) { v[2 * i] = points[i][0]; v[2 * i + 1] = points[i][1]; }
  const s = { v, n, r: r || 0, bound: 0 };
  s.bound = bound(s);
  return s;
}

export const disc = (r) => makeShape([[0, 0]], r);
export const capsule = (len, r) => makeShape([[-len / 2, 0], [len / 2, 0]], r);
export function box(w, h, round = 0) {
  const a = Math.max(1e-4, w / 2 - round), b = Math.max(1e-4, h / 2 - round);
  return makeShape([[-a, -b], [a, -b], [a, b], [-a, b]], round);
}
export const poly = (points, r = 0) => makeShape(points, r);
// A thick line from (x0, y0) to (x1, y1) in local coordinates.
export const segment = (x0, y0, x1, y1, thick) => makeShape([[x0, y0], [x1, y1]], thick / 2);

export function bound(s) {
  let m = 0;
  for (let i = 0; i < s.n; i++) m = Math.max(m, Math.hypot(s.v[2 * i], s.v[2 * i + 1]));
  return m + s.r;
}

export function sdfLocal(s, px, py) {
  const v = s.v, n = s.n;
  if (n === 1) return Math.hypot(px - v[0], py - v[1]) - s.r;
  if (n === 2) {
    const ex = v[2] - v[0], ey = v[3] - v[1], wx = px - v[0], wy = py - v[1];
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
    return Math.hypot(wx - ex * t, wy - ey * t) - s.r;
  }
  let d = (px - v[0]) * (px - v[0]) + (py - v[1]) * (py - v[1]);
  let sign = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const vix = v[2 * i], viy = v[2 * i + 1], vjx = v[2 * j], vjy = v[2 * j + 1];
    const ex = vjx - vix, ey = vjy - viy, wx = px - vix, wy = py - viy;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const bx = wx - ex * t, by = wy - ey * t;
    d = Math.min(d, bx * bx + by * by);
    const c1 = py >= viy, c2 = py < vjy, c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sign = -sign;
  }
  return sign * Math.sqrt(d) - s.r;
}

export function sdfWorld(p, x, y) {
  const c = Math.cos(p.a), s = Math.sin(p.a), dx = x - p.x, dy = y - p.y;
  return sdfLocal(p.shape, c * dx + s * dy, -s * dx + c * dy);
}

// Outward normal at (x, y). Writes into out[0], out[1]; no allocation.
export function normalWorld(p, x, y, out, eps = 1e-3) {
  const gx = sdfWorld(p, x + eps, y) - sdfWorld(p, x - eps, y);
  const gy = sdfWorld(p, x, y + eps) - sdfWorld(p, x, y - eps);
  const l = Math.hypot(gx, gy) || 1;
  out[0] = gx / l; out[1] = gy / l;
  return out;
}

// Interior sample points on a square lattice of pitch d: [x0, y0, x1, y1, ...]
// in local coordinates, each standing for an area d * d.
export function areaSamples(s, d) {
  const B = s.bound, pts = [];
  for (let y = -B + d / 2; y < B; y += d)
    for (let x = -B + d / 2; x < B; x += d)
      if (sdfLocal(s, x, y) < 0) pts.push(x, y);
  if (!pts.length) pts.push(0, 0);
  return Float64Array.from(pts);
}

// Area-weighted centroid of the samples, and the shape moved so that the
// centroid is the local origin (bodies turn about their centre of mass).
export function centred(s, d) {
  const pts = areaSamples(s, d);
  let cx = 0, cy = 0;
  const m = pts.length / 2;
  for (let i = 0; i < m; i++) { cx += pts[2 * i]; cy += pts[2 * i + 1]; }
  cx /= m; cy /= m;
  const q = [];
  for (let i = 0; i < s.n; i++) q.push([s.v[2 * i] - cx, s.v[2 * i + 1] - cy]);
  return { shape: makeShape(q, s.r), cx, cy };
}

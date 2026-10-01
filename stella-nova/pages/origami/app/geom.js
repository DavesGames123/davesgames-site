// app/geom.js -- the 2D hit tests: point in polygon, point in triangle, point to segment.
//
// Port of app.rs point_in_poly, point_in_tri2 and point_seg_dist. The
// functions are pure: they read no state.
//
// grep map:
//   pointInPoly  -- even-odd test against a polygon
//   pointInTri2  -- sign test against a 2D triangle
//   pointSegDist -- distance from a point to a segment
//   findIndex    -- the first index that passes a test, or null

export function pointInPoly(p, poly) {
  const n = poly.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function pointInTri2(p, a, b, c) {
  const cr = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const d1 = cr(p, a, b), d2 = cr(p, b, c), d3 = cr(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
export function pointSegDist(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const l2 = Math.max(abx * abx + aby * aby, 1e-12);
  const t = Math.min(Math.max(((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2, 0), 1);
  return Math.hypot(a[0] + abx * t - p[0], a[1] + aby * t - p[1]);
}

// The index of the first item that passes fn, or null.
export function findIndex(list, fn) { for (let i = 0; i < list.length; i++) if (fn(list[i])) return i; return null; }

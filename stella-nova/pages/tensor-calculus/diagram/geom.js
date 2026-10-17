// ============================================================================
//  DIAGRAM GEOM  ·  curves, resampling and crossings  (DOM-free ES module)
// ----------------------------------------------------------------------------
//  The diagram keeps every leg as a polyline of N points. The layout samples
//  each wire (cubic Bezier or rounded waypoint route) into dense points, then
//  resamples them to N points by arc length. The same N on every leg lets the
//  transitions interpolate point by point between two layouts. The renderer
//  turns the points back into a smooth path (Catmull-Rom to cubic Bezier).
//
//  EXPORTS   (jump with grep -n "<anchor>" geom.js)
//      N_PTS ........... "export const N_PTS"        points per leg
//      cubicPts ........ "export function cubicPts"  sample one cubic
//      routePts ........ "export function routePts"  rounded waypoint route
//      resample ........ "export function resample"  N points by arc length
//      splitHalf ....... "export function splitHalf" two halves at mid length
//      smoothD ......... "export function smoothD"   points -> SVG path d
//      pointAt ......... "export function pointAt"   point and tangent at s
//      countCrossings .. "export function countCrossings" strand crossings
//      boxesOverlap .... "export function boxesOverlap"
// ============================================================================

export const N_PTS = 28;

export function cubicPts(p0, p1, p2, p3, n = 40) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
              a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
  return out;
}

// Polyline through waypoints, each inner corner rounded by a quadratic
// Bezier of radius r (clamped to half of each adjacent segment).
export function routePts(wp, r = 12, per = 10) {
  if (wp.length < 3) return wp.map(p => p.slice());
  const out = [wp[0].slice()];
  for (let i = 1; i < wp.length - 1; i++) {
    const a = wp[i - 1], b = wp[i], c = wp[i + 1];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const p = [b[0] + (a[0] - b[0]) * rr / l1, b[1] + (a[1] - b[1]) * rr / l1];
    const q = [b[0] + (c[0] - b[0]) * rr / l2, b[1] + (c[1] - b[1]) * rr / l2];
    out.push(p);
    for (let k = 1; k < per; k++) {
      const t = k / per, u = 1 - t;
      out.push([u * u * p[0] + 2 * u * t * b[0] + t * t * q[0],
                u * u * p[1] + 2 * u * t * b[1] + t * t * q[1]]);
    }
    out.push(q);
  }
  out.push(wp[wp.length - 1].slice());
  return out;
}

function cumLen(pts) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) {
    L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return L;
}

export function resample(pts, n = N_PTS) {
  if (pts.length === 0) return [];
  if (pts.length === 1) return Array.from({ length: n }, () => pts[0].slice());
  const L = cumLen(pts), total = L[L.length - 1];
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = total * i / (n - 1);
    while (j < pts.length - 2 && L[j + 1] < s) j++;
    const seg = (L[j + 1] - L[j]) || 1;
    const t = Math.min(1, Math.max(0, (s - L[j]) / seg));
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t,
              pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
  }
  return out;
}

// Two halves of a wire, each from its own end to the middle (by length).
export function splitHalf(pts, n = N_PTS) {
  const dense = resample(pts, 2 * n * 3 + 1);
  const mid = (dense.length - 1) / 2;
  const a = dense.slice(0, mid + 1);
  const b = dense.slice(mid).reverse();
  return [resample(a, n), resample(b, n)];
}

export function smoothD(pts) {
  if (!pts.length) return '';
  const f = v => (Math.round(v * 100) / 100).toString();
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  if (pts.length === 2) return d + `L${f(pts[1][0])} ${f(pts[1][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

// Point and unit tangent at fraction s (0..1) of the arc length.
export function pointAt(pts, s) {
  const L = cumLen(pts), total = L[L.length - 1] || 1, want = total * s;
  let j = 0;
  while (j < pts.length - 2 && L[j + 1] < want) j++;
  const a = pts[j], b = pts[j + 1] || a;
  const seg = (L[j + 1] - L[j]) || 1, t = Math.min(1, Math.max(0, (want - L[j]) / seg));
  const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1;
  return { p: [a[0] + dx * t, a[1] + dy * t], t: [dx / m, dy / m] };
}

function segX(a, b, c, d) {
  const d1x = b[0] - a[0], d1y = b[1] - a[1], d2x = d[0] - c[0], d2y = d[1] - c[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return false;
  const s = ((c[0] - a[0]) * d2y - (c[1] - a[1]) * d2x) / den;
  const u = ((c[0] - a[0]) * d1y - (c[1] - a[1]) * d1x) / den;
  return s > 1e-6 && s < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

// strands: [{ id, pts }]. Counts proper crossings between different strands.
// Bounding boxes cut the pair work first.
export function countCrossings(strands) {
  const bb = strands.map(s => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of s.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return [x0, y0, x1, y1];
  });
  let n = 0;
  for (let i = 0; i < strands.length; i++) {
    for (let j = i + 1; j < strands.length; j++) {
      if (strands[i].id === strands[j].id) continue;
      const A = bb[i], B = bb[j];
      if (A[2] < B[0] || B[2] < A[0] || A[3] < B[1] || B[3] < A[1]) continue;
      const P = strands[i].pts, Q = strands[j].pts;
      for (let a = 0; a < P.length - 1; a++) {
        for (let b = 0; b < Q.length - 1; b++) if (segX(P[a], P[a + 1], Q[b], Q[b + 1])) n++;
      }
    }
  }
  return n;
}

// Boxes { x0, y0, x1, y1 }; true when they overlap by more than eps.
export function boxesOverlap(a, b, eps = 0.5) {
  return a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps;
}

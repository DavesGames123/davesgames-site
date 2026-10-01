// ============================================================================
//  WATCH MOVEMENT  ·  geom.js — 2D geometry shared by every calibre
// ────────────────────────────────────────────────────────────────────────────
//  Points are [x, y] in millimetres. Polygons are closed, counterclockwise.
//  No DOM and no THREE, so tests.mjs runs it in Node.
//
//  MESH PHASE
//    Each gear has tooth k at angle th + k * TAU / N. For driver A and
//    driven B on the line of centres at angle f, a tooth of A at f must face
//    a gap of B at f + PI. drive() returns that angle of B; driveInv() the
//    angle of A that puts B at a given angle.
//
//  GREP MAP
//    function gearProfile ......... wheel teeth and pinion leaves
//    function escapeProfile ....... Swiss club teeth
//    function crownTeeth .......... verge crown-wheel saw teeth, unrolled
//    function hullOfCircles ....... bridge outlines
//    function spokeWindows ........ the crossings of a wheel (holes)
//    function polysOverlap ........ the collision test
//    const drive / const driveInv . mesh phase
// ============================================================================

export const TAU = Math.PI * 2;
export const D = Math.PI / 180;
export const pol = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const len = a => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
export const rot = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; };
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;

export const pitchR = (m, N) => m * N / 2;
export const centreDist = (m, N1, N2) => m * (N1 + N2) / 2;

// intersection of two circles, the one on the side of sgn
export function circleX(c0, r0, c1, r1, sgn) {
  const d = dist(c0, c1);
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r0 * r0 - a * a));
  const u = [(c1[0] - c0[0]) / d, (c1[1] - c0[1]) / d];
  const m = add(c0, [u[0] * a, u[1] * a]);
  return [m[0] - sgn * u[1] * h, m[1] + sgn * u[0] * h];
}

// ── profiles (local frame, tooth 0 on +x) ──────────────────────────────────
// Wheel teeth: radial flanks under the pitch circle and a half-ellipse
// addendum, the classic horological ogive. Pinion leaves are thinner and
// lower. o.t is the tooth share of the pitch at the pitch circle.
export function gearProfile(N, m, o = {}) {
  const R = m * N / 2, ha = (o.ha ?? 1.25) * m, hf = (o.hf ?? 1.6) * m, t = o.t ?? 0.46, S = o.seg ?? 5;
  const Rf = R - hf, pitch = TAU / N, half = t * Math.PI / N, out = [];
  for (let k = 0; k < N; k++) {
    const c = k * pitch;
    out.push(pol(Rf, c - half), pol(R, c - half));
    for (let i = 1; i < S; i++) { const f = i / S * Math.PI / 2, r = R + ha * Math.sin(f); out.push(pol(r, c - half * R * Math.cos(f) / r)); }
    out.push(pol(R + ha, c));
    for (let i = S - 1; i >= 1; i--) { const f = i / S * Math.PI / 2, r = R + ha * Math.sin(f); out.push(pol(r, c + half * R * Math.cos(f) / r)); }
    out.push(pol(R, c + half), pol(Rf, c + half));
    const gap = pitch - 2 * half;
    for (let j = 1; j <= 2; j++) out.push(pol(Rf, c + half + gap * j / 3));
  }
  return out;
}
export const wheelProfile = (N, m) => gearProfile(N, m, { t: 0.46, ha: 1.25, hf: 1.6 });
export const pinionProfile = (N, m) => gearProfile(N, m, { t: 0.36, ha: 0.7, hf: 1.6, seg: 4 });
export const rootR = (N, m) => m * N / 2 - 1.6 * m;
export const tipR = (N, m) => m * N / 2 + 1.25 * m;

// Swiss club teeth. The wheel turns toward -angle, so each tooth leans
// that way: the locking corner leads, the club face slopes back to the
// trailing root.
export function escapeProfile(N, Ra, Rf) {
  const p = TAU / N, out = [], h = Ra - Rf, k1 = 0.02 * h / 0.58, k2 = 0.13 * h / 0.58;
  for (let k = 0; k < N; k++) {
    const c = k * p;
    for (let j = 0; j <= 3; j++) out.push(pol(Rf, c - 0.72 * p + 0.57 * p * j / 3));
    out.push(pol(Ra, c - 0.30 * p));           // locking corner
    out.push(pol(Ra - k1, c - 0.22 * p));
    out.push(pol(Ra - k2, c - 0.10 * p));      // end of the club face
    out.push(pol(Rf + 0.48 * h, c + 0.05 * p));
    out.push(pol(Rf + 0.10 * h, c + 0.22 * p));
  }
  return out;
}

// A verge crown wheel, unrolled: one row of saw teeth along y, standing on
// x = 0 and pointing to +x (height h, pitch p). The locking face of each
// tooth faces +y, the direction of travel. Tooth k has its face at y = k p.
export function crownTeeth(kFrom, kTo, p, h) {
  const out = [];
  for (let k = kFrom; k <= kTo; k++) {
    const y = k * p;
    out.push([[0, y - 0.62 * p], [0, y], [h, y], [h - 0.12 * h, y - 0.12 * p]]);
  }
  return out;
}

export function circlePoly(r, n = 48, c = [0, 0]) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(add(c, pol(r, i / n * TAU)));
  return out;
}

// convex hull (monotone chain) of sampled circles, CCW
export function hullOfCircles(circles, n = 40) {
  const pts = [];
  for (const [c, r] of circles) for (let i = 0; i < n; i++) pts.push(add(c, pol(r, i / n * TAU)));
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}

// windows between the spokes of a wheel (holes for the THREE shape)
export function spokeWindows(rIn, rOut, spokes, spokeW, n = 14) {
  const out = [];
  for (let s = 0; s < spokes; s++) {
    const a0 = s * TAU / spokes, a1 = a0 + TAU / spokes;
    const wi = spokeW / 2 / rIn, wo = spokeW / 2 / rOut, w = [];
    for (let i = 0; i <= n; i++) w.push(pol(rOut, a0 + wo + (a1 - a0 - 2 * wo) * i / n));
    for (let i = n; i >= 0; i--) w.push(pol(rIn, a0 + wi + (a1 - a0 - 2 * wi) * i / n));
    out.push(w);
  }
  return out;
}

// a stadium from a to b, width w
export function capsule(a, b, w, n = 10) {
  const an = Math.atan2(b[1] - a[1], b[0] - a[0]), out = [];
  for (let i = 0; i <= n; i++) out.push([b[0] + w / 2 * Math.cos(an - Math.PI / 2 + Math.PI * i / n), b[1] + w / 2 * Math.sin(an - Math.PI / 2 + Math.PI * i / n)]);
  for (let i = 0; i <= n; i++) out.push([a[0] + w / 2 * Math.cos(an + Math.PI / 2 + Math.PI * i / n), a[1] + w / 2 * Math.sin(an + Math.PI / 2 + Math.PI * i / n)]);
  return out;
}

// mirror in x (keeps the winding counterclockwise)
export const mirrorX = poly => poly.map(([x, y]) => [-x, y]).reverse();

// ── polygon tests ──────────────────────────────────────────────────────────
export function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function segX(a, b, c, d) {
  const d1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
  const d3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]);
  const d4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
  return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
}
export function polysOverlap(A, Bp) {
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = A[(i + 1) % A.length];
    for (let j = 0; j < Bp.length; j++) if (segX(a, b, Bp[j], Bp[(j + 1) % Bp.length])) return true;
  }
  return inPoly(A[0], Bp) || inPoly(Bp[0], A);
}
// depth of a point inside a polygon: its distance to the nearest edge
export function depthIn(p, poly) {
  let d = Infinity;
  for (let j = 0; j < poly.length; j++) {
    const a = poly[j], b = poly[(j + 1) % poly.length], ab = [b[0] - a[0], b[1] - a[1]];
    const t = clamp(((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2), 0, 1);
    d = Math.min(d, Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1]));
  }
  return d;
}
export const place = (poly, c, a) => poly.map(p => add(c, rot(p, a)));

// ── mesh phase ──────────────────────────────────────────────────────────────
export const drive = (thA, NA, NB, f) => f + Math.PI - Math.PI / NB + (f - thA) * NA / NB;
export const driveInv = (thB, NA, NB, f) => f - (thB - f - Math.PI + Math.PI / NB) * NB / NA;

// gear spec lines for the part cards
export function gearSpec(N, m, extra = []) {
  return [['Teeth', String(N)], ['Module', `${m.toFixed(3)} mm`], ['Pitch Ø', `${(m * N).toFixed(2)} mm`], ['Tip Ø', `${(m * N + 2.5 * m).toFixed(2)} mm`], ...extra];
}
export function fmtPeriod(s) {
  if (!isFinite(s) || s <= 0) return '—';
  if (s >= 3600) return `${+(s / 3600).toFixed(2)} h`;
  if (s >= 60) return `${+(s / 60).toFixed(2)} min`;
  return `${+s.toFixed(3)} s`;
}

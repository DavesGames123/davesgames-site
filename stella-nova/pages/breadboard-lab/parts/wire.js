// ============================================================================
//  BREADBOARD LAB  ·  parts/wire.js — jumper wire paths and meshes
// ----------------------------------------------------------------------------
//  wirePath is pure: two end points (world mm, the hole tops) and a style give
//  a polyline that starts and ends exactly at those points (CONTRACT 3.10).
//
//    arch  rises 3 mm straight up from each hole, then arcs. The top of the
//          arc is min(25, 3 + 0.25 * len) mm above the higher end, where len
//          is the horizontal distance. The arc is two half-parabolas that
//          meet at the top with zero slope, so the top is exact.
//    flat  a pre-cut jumper: up 0.8 mm, along X, along Z, down. One bend.
//    free  up 3 mm, through the user's bend points, down 3 mm.
//
//  buildWire sweeps an insulated tube along the polyline. Corners are mitred:
//  the ring at a corner lies in the bisector plane and stretches along the
//  bend by 1 / cos(half angle), so an L-bend keeps its full width. Each end
//  gets a bare tinned tip that goes 2.5 mm down into the hole.
//
//  GREP MAP
//    ARCH_RISE / archHeight .. the arch numbers of 3.10
//    wirePath ............... (a, b, style, via) -> [[x,y,z], ...]
//    polylineLength / samplePolyline / trimPolyline ... path helpers
//    gaugeRadius ............ AWG -> insulation radius (mm)
//    sweepGeometry .......... mitred tube along a polyline
//    buildWire .............. { object, setPoints, setColor, dispose }
// ============================================================================

export const ARCH_RISE = 3;
export const FLAT_LIFT = 0.8;
export const archHeight = len => Math.min(25, 3 + 0.25 * len);

const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9 && Math.abs(p[2] - q[2]) < 1e-9;
function dedupe(pts) {
  const out = [];
  for (const p of pts) if (!out.length || !same(out[out.length - 1], p)) out.push(p);
  return out;
}

export function wirePath(a, b, style = 'arch', via = []) {
  const A = [a[0], a[1], a[2]], B = [b[0], b[1], b[2]];
  if (style === 'flat') {
    const y = Math.max(A[1], B[1]) + FLAT_LIFT;
    return dedupe([A, [A[0], y, A[2]], [B[0], y, A[2]], [B[0], y, B[2]], B]);
  }
  const A1 = [A[0], A[1] + ARCH_RISE, A[2]], B1 = [B[0], B[1] + ARCH_RISE, B[2]];
  if (style === 'free') {
    const V = (via || []).filter(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)).map(p => [p[0], p[1], p[2]]);
    return dedupe([A, A1, ...V, B1, B]);
  }
  // arch
  const len = Math.hypot(B[0] - A[0], B[2] - A[2]);
  if (len < 1e-6) return dedupe([A, A1, B1, B]);
  const peak = Math.max(A[1], B[1]) + archHeight(len);
  const n = Math.max(9, Math.min(41, Math.round(len / 2.5) | 1));
  const N = n % 2 ? n : n + 1;
  const pts = [A];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const x = A1[0] + (B1[0] - A1[0]) * t, z = A1[2] + (B1[2] - A1[2]) * t;
    const y = t <= 0.5 ? peak - (peak - A1[1]) * (1 - 2 * t) ** 2 : peak - (peak - B1[1]) * (2 * t - 1) ** 2;
    pts.push([x, y, z]);
  }
  pts.push(B);
  return dedupe(pts);
}

export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  return L;
}
// The point at arc-length fraction t (0..1).
export function samplePolyline(pts, t) {
  const L = polylineLength(pts);
  let want = Math.max(0, Math.min(1, t)) * L;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    const s = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    if (want <= s || i === pts.length - 1) {
      const f = s > 0 ? Math.min(1, want / s) : 0;
      return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
    }
    want -= s;
  }
  return pts[pts.length - 1].slice();
}
// The part of the path from arc length d0 to L - d1.
export function trimPolyline(pts, d0, d1) {
  const L = polylineLength(pts);
  if (L <= d0 + d1 + 1e-6) return [];
  const out = [samplePolyline(pts, d0 / L)];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    acc += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    if (acc > d0 + 1e-6 && acc < L - d1 - 1e-6) out.push(q.slice());
  }
  out.push(samplePolyline(pts, (L - d1) / L));
  return dedupe(out);
}

export const gaugeRadius = (gauge = 22) => 0.8 * Math.pow(1.122, (22 - gauge) / 2);

// ---------------------------------------------------------------- sweep
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Tube along a polyline, radius r, `seg` sides, end caps. Returns raw arrays.
export function sweepArrays(pts, r, seg = 8) {
  const n = pts.length;
  const pos = [], nrm = [], idx = [];
  if (n < 2) return { pos, nrm, idx };
  const dirs = [];
  for (let i = 0; i < n - 1; i++) dirs.push(norm(sub(pts[i + 1], pts[i])));
  const T = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) T.push(dirs[0]);
    else if (i === n - 1) T.push(dirs[n - 2]);
    else { const s = add(dirs[i - 1], dirs[i]); T.push(Math.hypot(...s) < 1e-6 ? dirs[i] : norm(s)); }
  }
  // initial normal: the axis least aligned with T0
  const t0 = T[0];
  const ax = Math.abs(t0[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  let N = norm(cross(cross(t0, ax), t0));
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      // parallel transport: remove the T component and renormalise
      N = norm(sub(N, mul(T[i], dot(N, T[i]))));
    }
    const B = cross(T[i], N);
    let k = null, s = 1;
    if (i > 0 && i < n - 1) {
      const c = dot(dirs[i - 1], T[i]);
      s = Math.min(3, 1 / Math.max(1e-3, c));
      const kk = sub(dirs[i], dirs[i - 1]);
      if (Math.hypot(...kk) > 1e-6) k = norm(kk);
    }
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      let o = add(mul(N, Math.cos(a)), mul(B, Math.sin(a)));
      const nv = o;
      if (k) o = add(o, mul(k, dot(o, k) * (s - 1)));
      const p = add(pts[i], mul(o, r));
      pos.push(p[0], p[1], p[2]);
      nrm.push(nv[0], nv[1], nv[2]);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + (j + 1) % seg, c = (i + 1) * seg + j, d = (i + 1) * seg + (j + 1) % seg;
    idx.push(a, c, b, b, c, d);
  }
  // caps
  for (const [i, sgn] of [[0, -1], [n - 1, 1]]) {
    const base = pos.length / 3;
    const tn = mul(T[i], sgn);
    pos.push(pts[i][0], pts[i][1], pts[i][2]); nrm.push(tn[0], tn[1], tn[2]);
    for (let j = 0; j < seg; j++) {
      const q = (i * seg + j) * 3;
      pos.push(pos[q], pos[q + 1], pos[q + 2]); nrm.push(tn[0], tn[1], tn[2]);
    }
    for (let j = 0; j < seg; j++) {
      const a = base + 1 + j, b = base + 1 + (j + 1) % seg;
      if (sgn < 0) idx.push(base, b, a); else idx.push(base, a, b);
    }
  }
  return { pos, nrm, idx };
}

function toGeometry(THREE, parts) {
  const pos = [], nrm = [], idx = [];
  for (const p of parts) {
    const off = pos.length / 3;
    pos.push(...p.pos); nrm.push(...p.nrm);
    for (const i of p.idx) idx.push(i + off);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const TIP_DOWN = 2.5, TIP_UP = 1.6;
const tipMats = new WeakMap();
function tipMaterial(THREE) {
  let m = tipMats.get(THREE);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: 0xcfd2d6, metalness: 1, roughness: 0.3 }); tipMats.set(THREE, m); }
  return m;
}

// { points, color, gauge, quality } -> { object, insulation, tips, setPoints, setColor, dispose }
export function buildWire(THREE, opts) {
  const seg = opts.quality === 'low' ? 6 : 8;
  const r = gaugeRadius(opts.gauge || 22);
  const rt = r * 0.42;
  const insMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(opts.color || '#d63b3b'), roughness: 0.45, metalness: 0 });
  const object = new THREE.Group();
  object.name = 'wire';
  const insulation = new THREE.Mesh(new THREE.BufferGeometry(), insMat);
  const tips = new THREE.Mesh(new THREE.BufferGeometry(), tipMaterial(THREE));
  insulation.castShadow = true;
  object.add(insulation, tips);
  let points = [];
  function setPoints(pts) {
    points = pts.map(p => [p[0], p[1], p[2]]);
    const L = polylineLength(points);
    const up = Math.min(TIP_UP, L / 3);
    const body = trimPolyline(points, up, up);
    insulation.geometry.dispose();
    insulation.geometry = toGeometry(THREE, body.length >= 2 ? [sweepArrays(body, r, seg)] : []);
    const tipParts = [];
    if (points.length >= 2) {
      const a = points[0], b = points[points.length - 1];
      const head = trimPolyline(points, 0, Math.max(0, L - up));
      const tail = trimPolyline(points, Math.max(0, L - up), 0);
      tipParts.push(sweepArrays(dedupe([[a[0], a[1] - TIP_DOWN, a[2]], ...head]), rt, Math.max(5, seg - 2)));
      tipParts.push(sweepArrays(dedupe([...tail, [b[0], b[1] - TIP_DOWN, b[2]]]), rt, Math.max(5, seg - 2)));
    }
    tips.geometry.dispose();
    tips.geometry = toGeometry(THREE, tipParts);
  }
  setPoints(opts.points || []);
  return {
    object, insulation, tips,
    get points() { return points; },
    setPoints,
    setColor(hex) { insMat.color.set(hex); },
    dispose() {
      insulation.geometry.dispose(); tips.geometry.dispose(); insMat.dispose();
      object.removeFromParent();
    },
  };
}

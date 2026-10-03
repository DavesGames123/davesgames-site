// ============================================================================
//  SPHERE TRACING LAB  ·  scene.js — the scene model and the CPU tracer
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no GPU. main.js packs this model into the uniform buffer, and
//  shaders/lab.wgsl evaluates the same field on the GPU. The CPU copy of the
//  field (map) lets main.js trace the one probe ray for the slice diagram,
//  project its steps into the 3D view and count average steps for the
//  readouts. The two copies must stay in step: same primitives, same order,
//  same operators, same domain warps.
//
//  CREDITS
//    Sphere tracing after Hart 1996. Over-relaxed tracing after Keinert,
//    Schäfer, Korndörfer, Ganse and Stamminger 2014 (enhanced sphere
//    tracing). Primitives and the smooth minimum after Inigo Quilez. The
//    presets and the code are original.
//
//  GREP MAP
//    TYPES / OPS ......... primitive and operator names (index = WGSL code)
//    PRESETS ............. the teaching scenes
//    function sdPrim ..... one primitive at a point
//    function map ........ the whole field: domain warps, then the op chain
//    function primRadius . the bounding radius of one primitive
//    function shadowBound  the sphere outside which a shadow sample has no effect
//    function march ...... plain or over-relaxed tracer with a step record
//    function camera ..... orbit camera basis, ray for a pixel, projection
//    function plane ...... slice plane basis from an axis and an offset
// ============================================================================
export const TYPES = ['sphere', 'box', 'round box', 'torus', 'cylinder', 'capsule', 'octahedron'];
export const OPS = ['union', 'subtract', 'intersect', 'smooth union', 'smooth subtract', 'smooth intersect'];
export const COLORS = ['#ffd49a', '#5a8dff', '#ff8a6a', '#6fe3c1', '#c3a2ff', '#f2c14e'];
export const MAX_PRIMS = 6;
// size labels per type: which of the three size fields mean something
export const SIZE_LABELS = [
  ['radius'], ['half x', 'half y', 'half z'], ['half x', 'half y', 'half z'],
  ['ring R', 'tube r'], ['radius', 'half h'], ['radius', 'half h'], ['size'],
];

const P = (type, op, pos, size, extra = {}) => Object.assign({ type, op, k: 0.3, pos, size, rot: 0, color: 0 }, extra);

// Each preset is a full scene: primitives, modifiers, slice plane, probe ray.
export const PRESETS = {
  'one sphere': {
    note: 'One sphere. Every circle on the slice touches the contour, because the field is exact: d is the true distance.',
    prims: [P(0, 0, [0, 0, 0], [1, 1, 1], { color: 0 })],
    twist: 0, rep: 0, period: 1.6, stepScale: 1, axis: 'xy', offset: 0, extent: 2.6,
    ray: { o: [-2.3, 0.75], a: -0.12 }, cam: { yaw: 0.5, pitch: 0.32, dist: 5.6 },
  },
  'sphere minus box': {
    note: 'A box cut out of a sphere. max(a, -b) is only a bound: near the cut, d is less than the true distance, so the steps get short.',
    prims: [P(0, 0, [0, 0, 0], [1.05, 1, 1], { color: 1 }), P(1, 1, [0.55, 0.55, 0.35], [0.62, 0.62, 0.62], { color: 2, rot: 0.5 })],
    twist: 0, rep: 0, period: 1.6, stepScale: 1, axis: 'xy', offset: 0, extent: 2.6,
    ray: { o: [-2.2, 1.6], a: -0.42 }, cam: { yaw: 0.7, pitch: 0.42, dist: 5.4 },
  },
  'smooth blobs': {
    note: 'Four spheres joined by a smooth union. The fillet has |∇d| < 1, so the field is still a safe bound.',
    prims: [
      P(0, 0, [-0.7, -0.2, 0], [0.62, 1, 1], { color: 0 }),
      P(0, 3, [0.55, 0.15, 0.1], [0.55, 1, 1], { color: 1, k: 0.55 }),
      P(0, 3, [0.0, 0.75, -0.1], [0.42, 1, 1], { color: 2, k: 0.55 }),
      P(0, 3, [0.25, -0.7, 0.0], [0.36, 1, 1], { color: 3, k: 0.45 }),
    ],
    twist: 0, rep: 0, period: 1.6, stepScale: 1, axis: 'xy', offset: 0, extent: 2.4,
    ray: { o: [-2.1, -1.5], a: 0.5 }, cam: { yaw: 0.3, pitch: 0.25, dist: 5.4 },
  },
  'repeated pillars': {
    note: 'One rounded pillar, repeated on a 5 × 5 grid by folding space. A ray that grazes the rows takes many short steps.',
    prims: [P(2, 0, [0, 0, 0], [0.22, 1.1, 0.22], { color: 4 }), P(0, 3, [0, 1.15, 0], [0.32, 1, 1], { color: 0, k: 0.25 })],
    twist: 0, rep: 2, period: 1.3, stepScale: 1, axis: 'xz', offset: 0.2, extent: 3.6,
    ray: { o: [-3.4, -1.95], a: 0.1 }, cam: { yaw: 0.62, pitch: 0.55, dist: 9.0 },
  },
  'twisted bar': {
    note: 'A bar twisted about y. The twist stretches space, so |∇d| reaches about 2 near the bar and a full step overshoots: the surface tears and rays stop inside. Set step × s to 0.5 (that is, 1/L) to fix it.',
    prims: [P(1, 0, [0, 0, 0], [0.55, 1.4, 0.22], { color: 5 })],
    twist: 3, rep: 0, period: 1.6, stepScale: 1, axis: 'xy', offset: 0, extent: 2.4,
    ray: { o: [-2.0, -0.6], a: -0.25 }, cam: { yaw: 0.25, pitch: 0.2, dist: 5.4 },
  },
};

export function clonePreset(name) { return JSON.parse(JSON.stringify(PRESETS[name])); }

// ── the field ───────────────────────────────────────────────────────────────
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
function sdBox(x, y, z, bx, by, bz) {
  const qx = Math.abs(x) - bx, qy = Math.abs(y) - by, qz = Math.abs(z) - bz;
  return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
}
export function sdPrim(pr, px, py, pz) {
  let x = px - pr.pos[0], y = py - pr.pos[1], z = pz - pr.pos[2];
  const c = Math.cos(pr.rot), s = Math.sin(pr.rot);
  const rx = c * x - s * z, rz = s * x + c * z; x = rx; z = rz;
  const [a, b, cc] = pr.size;
  switch (pr.type) {
    case 0: return len3(x, y, z) - a;
    case 1: return sdBox(x, y, z, a, b, cc);
    case 2: { const r = 0.25 * Math.min(a, b, cc); return sdBox(x, y, z, a - r, b - r, cc - r) - r; }
    case 3: { const q = Math.hypot(x, z) - a; return Math.hypot(q, y) - b; }
    case 4: { const dx = Math.hypot(x, z) - a, dy = Math.abs(y) - b; return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)); }
    case 5: { const yy = y - Math.max(-b, Math.min(b, y)); return len3(x, yy, z) - a; }
    default: return (Math.abs(x) + Math.abs(y) + Math.abs(z) - a) * 0.57735027;
  }
}
const sminP = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
export function combine(d, di, op, k) {
  switch (op) {
    case 0: return Math.min(d, di);
    case 1: return Math.max(d, -di);
    case 2: return Math.max(d, di);
    case 3: return sminP(d, di, k);
    case 4: return -sminP(-d, di, k);
    default: return -sminP(-d, -di, k);
  }
}
// space folds applied before the primitives: limited repetition in xz, then twist about y
export function domain(S, x, y, z) {
  if (S.rep > 0) {
    const per = S.period, n = S.rep;
    x -= per * Math.max(-n, Math.min(n, Math.round(x / per)));
    z -= per * Math.max(-n, Math.min(n, Math.round(z / per)));
  }
  if (S.twist !== 0) {
    const a = S.twist * y, c = Math.cos(a), s = Math.sin(a);
    const rx = c * x - s * z, rz = s * x + c * z; x = rx; z = rz;
  }
  return [x, y, z];
}
export function map(S, px, py, pz) {
  const [x, y, z] = domain(S, px, py, pz);
  let d = 1e9;
  S.prims.forEach((pr, i) => { const di = sdPrim(pr, x, y, z); d = i === 0 ? di : combine(d, di, pr.op, Math.max(pr.k, 1e-3)); });
  return d;
}
// The radius of a sphere about pr.pos that holds the primitive. Each exact
// primitive is >= |q - pos| - r; the octahedron bound is >= (|q - pos| - r)
// times 1/sqrt(3).
export function primRadius(pr) {
  const [a, b, c] = pr.size, rb = 0.25 * Math.min(a, b, c);
  return [a, len3(a, b, c), len3(a - rb, b - rb, c - rb) + rb, a + b, Math.hypot(a, b), a + b, a][pr.type] ?? a;
}
// A radius R about the origin such that map(p) > 0.84 when |p| > R. The soft
// shadow in lab.wgsl (k = 12, t <= 10, steps of at most 0.3) gets nothing from
// a sample with d > max(0.3, 10/12), so it marches only inside this sphere.
// Each exact primitive at c is >= |q - c| - r (r: its bounding radius); the
// octahedron bound is >= (|q - c| - s)/sqrt(3). A union or a cut keeps the
// least of these. A smooth union can go k/4 below the min, so the sum of
// those k/4 comes off. A subtract or an intersect can only raise d. The
// twist turns about y, so |q| = |p|; the repeat fold moves a point by at
// most period * n * sqrt(2).
export function shadowBound(S, need = 0.84) {
  const fold = S.rep > 0 ? S.period * S.rep * Math.SQRT2 : 0;
  let K = 0;
  S.prims.forEach((pr, i) => { if (i && (pr.op === 3)) K += Math.max(pr.k, 1e-3) / 4; });
  let R = 0;
  S.prims.forEach((pr, i) => {
    if (i && pr.op !== 0 && pr.op !== 3) return;
    const L = pr.type === 6 ? 0.57735027 : 1;
    R = Math.max(R, len3(...pr.pos) + primRadius(pr) + fold + (need + K) / L);
  });
  return R + 0.01;
}
export function grad(S, x, y, z) {
  const e = 1e-3;
  const g = [map(S, x + e, y, z) - map(S, x - e, y, z), map(S, x, y + e, z) - map(S, x, y - e, z), map(S, x, y, z + e) - map(S, x, y, z - e)].map(v => v / (2 * e));
  return g;
}

// ── the tracer ──────────────────────────────────────────────────────────────
// Returns { steps:[{t, d, fail}], hit, t, n }. Plain: t += s d. Relaxed
// (Keinert et al. 2014): t += w s d; when the sphere at the new point and the
// sphere at the old point do not overlap, the big step may have skipped a
// surface, so step back to the plain step and continue with w = 1. A relaxed
// step that lands inside (d < 0) also steps back, so a hit is never inside.
export const EPS = 1e-3, TMAX = 14;
export function march(S, o, r, opt = {}) {
  const maxSteps = opt.maxSteps || S.maxSteps || 128, scale = opt.stepScale ?? S.stepScale ?? 1;
  let w = opt.relax ? (opt.omega || 1.6) : 1;
  let t = 0, prevR = 0, stepLen = 0, tPrev = 0;
  const steps = [];
  for (let i = 0; i < maxSteps; i++) {
    const d = map(S, o[0] + r[0] * t, o[1] + r[1] * t, o[2] + r[2] * t);
    const rad = Math.abs(d) * scale;
    if (w > 1 && (rad + prevR < stepLen || d < 0)) {
      steps.push({ t, d, fail: true });
      t = tPrev + prevR; w = 1; stepLen = prevR; prevR = 0;   // back to the plain step from the last good point
      continue;
    }
    steps.push({ t, d, fail: false });
    if (d < EPS) return { steps, hit: true, t, n: steps.length };
    tPrev = t; prevR = rad; stepLen = w * d * scale;
    t += stepLen;
    if (t > TMAX) break;
  }
  return { steps, hit: false, t, n: steps.length };
}

// ── camera ──────────────────────────────────────────────────────────────────
export const FOCAL = 1 / Math.tan(Math.PI * 45 / 360);
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function camera(c) {
  const cp = Math.cos(c.pitch), tgt = c.target || [0, 0, 0];
  const eye = [tgt[0] + c.dist * cp * Math.sin(c.yaw), tgt[1] + c.dist * Math.sin(c.pitch), tgt[2] + c.dist * cp * Math.cos(c.yaw)];
  const fwd = norm([tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]]);
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { eye, fwd, right, up };
}
// ray for a point in uv (x right, y up, the short side of the view spans -1..1)
export function rayFor(C, ux, uy) { return norm([0, 1, 2].map(i => C.fwd[i] * FOCAL + C.right[i] * ux + C.up[i] * uy)); }
// world point to CSS px in a w x h view; null when behind the eye. The
// short side of the view spans uv -1..1, as in fs_view.
export function project(C, X, w, h) {
  const rel = [X[0] - C.eye[0], X[1] - C.eye[1], X[2] - C.eye[2]];
  const z = dot(rel, C.fwd); if (z < 0.05) return null;
  const x = dot(rel, C.right) / z * FOCAL, y = dot(rel, C.up) / z * FOCAL;
  const m = Math.min(w, h); return [w / 2 + x * m / 2, h / 2 - y * m / 2];
}

// ── slice plane ─────────────────────────────────────────────────────────────
// u and v span the plane, n is its normal; a point is n*off + u*a + v*b.
export function plane(axis, off) {
  if (axis === 'xz') return { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], off, name: 'y' };
  if (axis === 'yz') return { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], off, name: 'x' };
  return { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], off, name: 'z' };
}
export function onPlane(Pl, a, b) { return [0, 1, 2].map(i => Pl.n[i] * Pl.off + Pl.u[i] * a + Pl.v[i] * b); }
export function toPlane(Pl, X) { return [dot(X, Pl.u), dot(X, Pl.v), dot(X, Pl.n) - Pl.off]; }

// ============================================================================
//  TENSOR CALCULUS  ·  viz/vmath.js  ·  small maths for the 3D scenes  (VIZ)
// ----------------------------------------------------------------------------
//  DOM-free and three-free, so tests/viz.test.mjs can check it. Vectors are
//  plain arrays [x, y, z]. A 3x3 matrix is an array of 3 rows. The world of
//  every scene has y up.
//
//  The physics helpers are closed forms or small integrators. The tests
//  compare them with the MATH engine (tensor/*.js) where MATH has the same
//  operation.
//
//  ANCHORS   (grep -n "<anchor>" vmath.js)
//      vectors ............. "export const add"
//      matrices ............ "export function mat3Mul", "export function mat3Inv"
//      eigen (symmetric) ... "export function eigSym3"
//      time shapes ......... "export function wave", "export function ease"
//      random .............. "export function rng"
//      sphere ............. "export function sph", "export function transportSphere"
//      holonomy ............ "export function holonomyLatitude"
//      Lorentz ............. "export function boostX", "export function boostF"
//      Schwarzschild ....... "export function flammZ", "export function orbitSchw"
//      graph geodesics ..... "export function graphGeodesic"
//      rigid body .......... "export function eulerStep"
// ============================================================================

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

// Any unit vector at right angles to n.
export function perp(n) {
  const a = Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(n, a));
}

export function mat3Mul(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
  return C;
}
export const mat3T = A => [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];
export const mat3Vec = (A, v) => [dot(A[0], v), dot(A[1], v), dot(A[2], v)];
export function mat3Det(A) {
  return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
}
export function mat3Inv(A) {
  const d = mat3Det(A) || 1e-12;
  const c = (i, j) => {
    const r = [0, 1, 2].filter(x => x !== i), s = [0, 1, 2].filter(x => x !== j);
    return ((i + j) % 2 ? -1 : 1) * (A[r[0]][s[0]] * A[r[1]][s[1]] - A[r[0]][s[1]] * A[r[1]][s[0]]);
  };
  return [0, 1, 2].map(i => [0, 1, 2].map(j => c(j, i) / d));
}
export const I3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
// Rotation by angle a about the unit axis n (Rodrigues).
export function rotAxis(n, a) {
  const [x, y, z] = unit(n), c = Math.cos(a), s = Math.sin(a), C = 1 - c;
  return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
    [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
    [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
}
// Rotate v about the unit axis n by angle a.
export const rotVec = (v, n, a) => mat3Vec(rotAxis(n, a), v);

// Eigen pairs of a symmetric 3x3 matrix (cyclic Jacobi). Returns
// { values: [3], vectors: [3 column vectors as arrays] }, values descending.
export function eigSym3(S) {
  const A = S.map(r => r.slice()), V = I3();
  for (let sweep = 0; sweep < 40; sweep++) {
    const off = A[0][1] ** 2 + A[0][2] ** 2 + A[1][2] ** 2;
    if (off < 1e-22) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(A[p][q]) < 1e-30) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { // A <- J^T A J
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const pairs = [0, 1, 2].map(i => ({ v: A[i][i], e: [V[0][i], V[1][i], V[2][i]] })).sort((a, b) => b.v - a.v);
  return { values: pairs.map(p => p.v), vectors: pairs.map(p => p.e) };
}

// Time shapes. wave(time, period) goes 0 -> 1 -> 0 with smooth ends.
export function wave(time, period = 8, phase = 0) {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * (time / period + phase));
}
export const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// The part of t inside [a, b], eased, 0..1.
export const seg = (t, a, b) => ease((t - a) / (b - a));
// Hold, move, hold: a loop that rests at 0 and at 1 for part of each period.
export function dwell(time, period = 10) {
  const u = ((time / period) % 1 + 1) % 1;
  return u < 0.5 ? seg(u, 0.1, 0.4) : 1 - seg(u, 0.6, 0.9);
}

// A seeded random source (mulberry32) in [0, 1).
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- sphere ---------------------------------------------------------------
// The point at colatitude th and longitude ph on a sphere of radius R, y up.
export function sph(th, ph, R = 1) {
  return [R * Math.sin(th) * Math.cos(ph), R * Math.cos(th), R * Math.sin(th) * Math.sin(ph)];
}
// The coordinate basis d/dth and d/dph at (th, ph) (not unit length).
export function sphBasis(th, ph, R = 1) {
  return {
    eth: [R * Math.cos(th) * Math.cos(ph), -R * Math.sin(th), R * Math.cos(th) * Math.sin(ph)],
    eph: [-R * Math.sin(th) * Math.sin(ph), 0, R * Math.sin(th) * Math.cos(ph)],
  };
}

// Parallel transport of the tangent vector v0 along a polyline of points
// on a sphere about the origin. At each point the vector is projected onto
// the new tangent plane and given its length again. This is the
// Levi-Civita transport of the round metric in the limit of a fine path.
// Returns the vector at each point.
export function transportSphere(pts, v0) {
  const out = [v0.slice()];
  let v = v0.slice();
  const L = len(v0);
  for (let i = 1; i < pts.length; i++) {
    const n = unit(pts[i]);
    v = sub(v, scl(n, dot(v, n)));
    v = scl(unit(v), L);
    out.push(v);
  }
  return out;
}

// Closed form: transport round the latitude circle at colatitude th0 turns
// a vector by 2 pi (1 - cos th0) = the enclosed cap area / R^2 (K = 1/R^2).
export const holonomyLatitude = th0 => 2 * Math.PI * (1 - Math.cos(th0));

// The signed angle from a to b about the axis n.
export function signedAngle(a, b, n) {
  return Math.atan2(dot(cross(a, b), n), dot(a, b));
}

// A latitude loop (colatitude th0) as points, ph from 0 to 2 pi.
export function latitudeLoop(th0, N = 256, R = 1) {
  const p = [];
  for (let i = 0; i <= N; i++) p.push(sph(th0, (2 * Math.PI * i) / N, R));
  return p;
}
// A great-circle arc from a to b (unit vectors), N + 1 points, radius R.
export function greatArc(a, b, N = 64, R = 1) {
  const A = unit(a), B = unit(b), w = Math.acos(clamp(dot(A, B), -1, 1)), s = Math.sin(w) || 1;
  const p = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, ka = Math.sin((1 - t) * w) / s, kb = Math.sin(t * w) / s;
    p.push(scl(add(scl(A, ka), scl(B, kb)), R));
  }
  return p;
}

// ---- Lorentz ---------------------------------------------------------------
// The boost along x with speed beta (c = 1), as Lambda^mu_nu on (t, x, y, z).
export function boostX(beta) {
  const g = 1 / Math.sqrt(1 - beta * beta);
  return [[g, -g * beta, 0, 0], [-g * beta, g, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
}
export function mat4Vec(L, v) { return L.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2] + r[3] * v[3]); }
// F_{mu nu} from E and B, signature (-+++), F_{0i} = -E_i, F_{ij} = eps_ijk B_k.
export function fieldTensor(E, B) {
  return [[0, -E[0], -E[1], -E[2]], [E[0], 0, B[2], -B[1]], [E[1], -B[2], 0, B[0]], [E[2], B[1], -B[0], 0]];
}
export function fieldEB(F) { return { E: [F[1][0], F[2][0], F[3][0]], B: [F[2][3], F[3][1], F[1][2]] }; }
// F'_{mu nu} = (L^-1)^a_mu (L^-1)^b_nu F_ab, the lower-index transformation law.
export function boostF(F, beta) {
  const Li = boostX(-beta), out = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
  for (let m = 0; m < 4; m++) for (let n = 0; n < 4; n++) {
    let s = 0;
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) s += Li[a][m] * Li[b][n] * F[a][b];
    out[m][n] = s;
  }
  return out;
}
// The Minkowski interval -t^2 + x^2 + y^2 + z^2.
export const interval = v => -v[0] * v[0] + v[1] * v[1] + v[2] * v[2] + v[3] * v[3];

// ---- Schwarzschild ---------------------------------------------------------
// Flamm's paraboloid: the embedding height of the t = const equator slice.
export const flammZ = (r, rs) => r <= rs ? 0 : 2 * Math.sqrt(rs * (r - rs));
// Proper radial distance from rs to r: integral of dr / sqrt(1 - rs/r).
export function properRadial(r, rs) {
  if (r <= rs) return 0;
  return Math.sqrt(r * (r - rs)) + rs * Math.log((Math.sqrt(r) + Math.sqrt(r - rs)) / Math.sqrt(rs));
}
// A bound timelike orbit in the equator, by the Binet form
// u'' + u = M / L^2 + 3 M u^2 with u = 1/r (G = c = 1, rs = 2M).
// Returns [r, phi] points for nPhi steps of dphi.
export function orbitSchw(M, r0, L, nPhi = 4000, dphi = 0.01) {
  let u = 1 / r0, w = 0, ph = 0;
  const out = [];
  const f = (u) => M / (L * L) + 3 * M * u * u - u;
  for (let i = 0; i < nPhi; i++) {
    out.push([1 / u, ph]);
    // RK4 on (u, w = du/dphi)
    const k1u = w, k1w = f(u);
    const k2u = w + 0.5 * dphi * k1w, k2w = f(u + 0.5 * dphi * k1u);
    const k3u = w + 0.5 * dphi * k2w, k3w = f(u + 0.5 * dphi * k2u);
    const k4u = w + dphi * k3w, k4w = f(u + dphi * k3u);
    u += (dphi / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
    w += (dphi / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    ph += dphi;
    if (!(u > 0) || 1 / u < 2 * M * 1.05) break;
  }
  return out;
}

// ---- geodesics on a graph surface y = f(x, z) -----------------------------
// For the metric induced on a graph, Gamma^k_ij = f_k f_ij / (1 + |grad f|^2),
// so the geodesic equation is q'' = -grad f (q'^T H q') / (1 + |grad f|^2).
// f(x, z) -> { f, fx, fz, fxx, fxz, fzz }. Returns 3D points.
export function graphGeodesic(f, q0, v0, steps = 200, ds = 0.02) {
  let q = q0.slice(), v = v0.slice();
  const acc = (q, v) => {
    const F = f(q[0], q[1]);
    const h = F.fxx * v[0] * v[0] + 2 * F.fxz * v[0] * v[1] + F.fzz * v[1] * v[1];
    const d = 1 + F.fx * F.fx + F.fz * F.fz;
    return [-F.fx * h / d, -F.fz * h / d];
  };
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    pts.push([q[0], f(q[0], q[1]).f, q[1]]);
    const a1 = acc(q, v);
    const q2 = [q[0] + 0.5 * ds * v[0], q[1] + 0.5 * ds * v[1]], v2 = [v[0] + 0.5 * ds * a1[0], v[1] + 0.5 * ds * a1[1]];
    const a2 = acc(q2, v2);
    const q3 = [q[0] + 0.5 * ds * v2[0], q[1] + 0.5 * ds * v2[1]], v3 = [v[0] + 0.5 * ds * a2[0], v[1] + 0.5 * ds * a2[1]];
    const a3 = acc(q3, v3);
    const q4 = [q[0] + ds * v3[0], q[1] + ds * v3[1]], v4 = [v[0] + ds * a3[0], v[1] + ds * a3[1]];
    const a4 = acc(q4, v4);
    q = [q[0] + ds / 6 * (v[0] + 2 * v2[0] + 2 * v3[0] + v4[0]), q[1] + ds / 6 * (v[1] + 2 * v2[1] + 2 * v3[1] + v4[1])];
    v = [v[0] + ds / 6 * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]), v[1] + ds / 6 * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1])];
  }
  return pts;
}

// ---- rigid body -------------------------------------------------------------
// One RK4 step of the torque-free Euler equations in the body frame:
// I1 w1' = (I2 - I3) w2 w3, and the cycle. Also turns the body attitude R
// (body to world, 3x3) by w (body frame).
export function eulerStep(st, Ib, dt) {
  const f = w => [(Ib[1] - Ib[2]) * w[1] * w[2] / Ib[0], (Ib[2] - Ib[0]) * w[2] * w[0] / Ib[1], (Ib[0] - Ib[1]) * w[0] * w[1] / Ib[2]];
  const w = st.w;
  const k1 = f(w), k2 = f(madd(w, k1, dt / 2)), k3 = f(madd(w, k2, dt / 2)), k4 = f(madd(w, k3, dt));
  const wn = [0, 1, 2].map(i => w[i] + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  const wm = scl(add(w, wn), 0.5), a = len(wm) * dt;
  // R <- R * exp(dt [wm]x): the body turns about its own axis wm
  const R = a > 1e-12 ? mat3Mul(st.R, rotAxis(wm, a)) : st.R;
  // re-orthonormalise the columns now and then (Gram-Schmidt on rows of R^T)
  const c0 = unit([R[0][0], R[1][0], R[2][0]]);
  let c1 = [R[0][1], R[1][1], R[2][1]];
  c1 = unit(sub(c1, scl(c0, dot(c0, c1))));
  const c2 = cross(c0, c1);
  return { w: wn, R: [[c0[0], c1[0], c2[0]], [c0[1], c1[1], c2[1]], [c0[2], c1[2], c2[2]]] };
}

// ---- 2D -----------------------------------------------------------------
export function solve2(a, b, c, d, x, y) { // [a b; c d] [p q] = [x y]
  const det = a * d - b * c || 1e-12;
  return [(d * x - b * y) / det, (a * y - c * x) / det];
}

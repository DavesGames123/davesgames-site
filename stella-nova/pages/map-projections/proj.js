// ============================================================================
//  MAP PROJECTIONS  ·  proj.js — the projection engine  (ES module, no DOM)
// ----------------------------------------------------------------------------
//  Every formula here is written for this page. The sphere has radius 1; the
//  ellipsoid functions take WGS84 (a = 6378137 m, f = 1/298.257223563).
//  tests.mjs checks them against PROJ 9.8 (tests/proj-ref.json).
//
//  FRAMES. A map is built in three steps:
//    world (lon, lat)  --R-->  centre frame  --Q-->  clip frame  --raw-->  x, y
//  R is the aspect rotation (the "globe under the map"): it moves the chosen
//  centre to (0, 0) and can roll the globe. Q is fixed per projection. It
//  puts the edges of the projection where geo.js can cut them simply: the
//  cut is always the meridian lon = +-pi of the clip frame, and the edges
//  are lon/lat rectangles ("rects") in the clip frame. For cylinders and
//  most world maps Q is the identity. For the azimuthal maps Q moves the
//  centre to the pole of the clip frame, so the edge circle is a parallel.
//  For the transverse Mercator Q puts its two singular points at the poles.
//  raw() takes clip-frame lon and lat and gives x, y with y up (east and
//  north at the centre point in the normal aspect).
//
//  GREP MAP
//    grep -n 'export const PROJ'          the table of projections
//    grep -n 'export function makeMap'    a map: R, Q, rects, raw, inverse
//    grep -n 'export function distortion' Tissot: a, b, area scale, angle
//    grep -n 'ELLIPSOID'                  Mercator, transverse Mercator
//                                         (Kruger series), Lambert conic
//    grep -n 'GEODESY'                    great circle, rhumb, Vincenty
// ============================================================================

export const D = Math.PI / 180, PI = Math.PI, HALF = PI / 2, TAU = 2 * PI;
const { sin, cos, tan, atan, atan2, asin, acos, sqrt, log, exp, abs, sinh, atanh, asinh, cosh, hypot } = Math;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const asinC = v => asin(clamp(v, -1, 1));
const acosC = v => acos(clamp(v, -1, 1));
export const wrap = a => a - TAU * Math.floor((a + PI) / TAU);   // to [-pi, pi)

// ── vectors and rotations ──────────────────────────────────────────────────
export function vec(lon, lat) { const c = cos(lat); return [c * cos(lon), c * sin(lon), sin(lat)]; }
// atan2 for the latitude: asin loses half the digits near the poles.
export function lonlat(v) { return [atan2(v[1], v[0]), atan2(v[2], hypot(v[0], v[1]))]; }
export const latOf = v => atan2(v[2], hypot(v[0], v[1]));
// Rows of a 3x3 matrix, flat.
export function mul(A, B) {
  const C = new Float64Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return C;
}
export function tr(A) { return Float64Array.from([A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]]); }
export function apply(A, v, o = [0, 0, 0]) {
  const x = v[0], y = v[1], z = v[2];
  o[0] = A[0] * x + A[1] * y + A[2] * z; o[1] = A[3] * x + A[4] * y + A[5] * z; o[2] = A[6] * x + A[7] * y + A[8] * z;
  return o;
}
export const I3 = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
// The aspect rotation: world -> centre frame. (lon0, lat0) goes to (0, 0),
// then the globe rolls by gamma about the view axis. Radians.
export function rotation(lon0, lat0, gamma = 0) {
  const a = cos(lon0), b = sin(lon0), c = cos(lat0), d = sin(lat0), e = cos(gamma), f = sin(gamma);
  const Rz = [a, b, 0, -b, a, 0, 0, 0, 1];
  const Ry = [c, 0, d, 0, 1, 0, -d, 0, c];
  const Rx = [1, 0, 0, 0, e, -f, 0, f, e];
  return mul(Rx, mul(Ry, Rz));
}
// The fixed clip frames (centre frame -> clip frame).
const Q_AZ = Float64Array.from([0, 0, -1, 0, 1, 0, 1, 0, 0]);   // centre -> pole
const Q_TM = Float64Array.from([1, 0, 0, 0, 0, 1, 0, -1, 0]);   // (+-90, 0) -> poles

// ── raw formulas (sphere, R = 1) ───────────────────────────────────────────
const LIM_MERC = atan(sinh(PI));          // 85.0511287798 deg: the square world
const SQ2 = Math.SQRT2;

function mollTheta(phi) {
  // 2t + sin 2t = pi sin(phi), solved for t2 = 2t by Newton.
  if (abs(abs(phi) - HALF) < 1e-12) return Math.sign(phi) * HALF;
  const k = PI * sin(phi);
  let t = phi * 2;   // a good start away from the poles
  if (abs(phi) > 1.4) t = Math.sign(phi) * (PI - Math.cbrt(12 * PI * (1 - abs(sin(phi)))) );   // near a pole: t2 ~ pi - (12 pi (1 - |sin phi|))^(1/3)
  for (let i = 0; i < 30; i++) {
    const d = (t + sin(t) - k) / (1 + cos(t));
    t -= d;
    if (abs(d) < 1e-13) break;
  }
  return t / 2;
}
// The quartic in theta whose root gives the Mollweide parallel. A second
// form used near the poles converges slowly; the cap below avoids it.
const mollweide = (l, p) => { const t = mollTheta(p); return [2 * SQ2 / PI * l * cos(t), SQ2 * sin(t)]; };
const mollweideInv = (x, y) => {
  const s = y / SQ2; if (abs(s) > 1 + 1e-12) return null;
  const t = asinC(s), c = cos(t);
  const l = c < 1e-12 ? 0 : PI * x / (2 * SQ2 * c);
  if (abs(l) > PI + 1e-9) return null;
  return [l, asinC((2 * t + sin(2 * t)) / PI)];
};

const aitoff = (l, p) => {
  const a = acosC(cos(p) * cos(l / 2));
  const s = a < 1e-12 ? 1 : sin(a) / a;
  return [2 * cos(p) * sin(l / 2) / s, sin(p) / s];
};
const PHI_W = acos(2 / PI);
const winkel = (l, p) => { const a = aitoff(l, p); return [(l * cos(PHI_W) + a[0]) / 2, (p + a[1]) / 2]; };

// Robinson (1963): his table of the parallel length X and the distance from
// the equator Y, every 5 degrees (as printed by Snyder, 1993), scaled by
// 0.8487 and 1.3523. Between the nodes: the cubic through four nodes
// (Catmull-Rom), the same order PROJ uses.
const ROB_X = [1.0000, 0.9986, 0.9954, 0.9900, 0.9822, 0.9730, 0.9600, 0.9427, 0.9216, 0.8962, 0.8679, 0.8350, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322];
const ROB_Y = [0.0000, 0.0620, 0.1240, 0.1860, 0.2480, 0.3100, 0.3720, 0.4340, 0.4958, 0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1.0000];
function robTab(T, deg) {
  const u = clamp(abs(deg) / 5, 0, 18), i = Math.min(17, Math.floor(u)), t = u - i;
  const p0 = i > 0 ? T[i - 1] : 2 * T[0] - T[1], p1 = T[i], p2 = T[i + 1], p3 = i + 2 <= 18 ? T[i + 2] : 2 * T[18] - T[17];
  // Mirror at the equator for X (even), extend linearly at the pole.
  const q0 = i > 0 ? p0 : (T === ROB_X ? T[1] : -T[1]);
  return 0.5 * (2 * p1 + (-q0 + p2) * t + (2 * q0 - 5 * p1 + 4 * p2 - p3) * t * t + (-q0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}
const robinson = (l, p) => { const d = p / D; return [0.8487 * robTab(ROB_X, d) * l, 1.3523 * Math.sign(d) * robTab(ROB_Y, d)]; };

// Equal Earth (Savric, Patterson, Jenny 2018).
const EA1 = 1.340264, EA2 = -0.081106, EA3 = 0.000893, EA4 = 0.003796, EM = sqrt(3) / 2;
const equalEarth = (l, p) => {
  const t = asin(EM * sin(p)), t2 = t * t, t6 = t2 * t2 * t2;
  return [l * cos(t) / (EM * (EA1 + 3 * EA2 * t2 + t6 * (7 * EA3 + 9 * EA4 * t2))), t * (EA1 + EA2 * t2 + t6 * (EA3 + EA4 * t2))];
};
const equalEarthInv = (x, y) => {
  let t = y / EA1;
  for (let i = 0; i < 30; i++) {
    const t2 = t * t, t6 = t2 * t2 * t2;
    const f = t * (EA1 + EA2 * t2 + t6 * (EA3 + EA4 * t2)) - y, df = EA1 + 3 * EA2 * t2 + t6 * (7 * EA3 + 9 * EA4 * t2);
    t -= f / df; if (abs(f) < 1e-14) break;
  }
  const t2 = t * t, t6 = t2 * t2 * t2;
  const l = EM * x * (EA1 + 3 * EA2 * t2 + t6 * (7 * EA3 + 9 * EA4 * t2)) / cos(t);
  const s = sin(t) / EM; if (abs(s) > 1 + 1e-12 || abs(l) > PI + 1e-9) return null;
  return [l, asinC(s)];
};

// Natural Earth (Patterson design, polynomials by Savric et al. 2011).
const natEarth = (l, p) => {
  const p2 = p * p, p4 = p2 * p2;
  return [l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * p2 * (0.003971 - 0.001529 * p2))),
    p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)))];
};

// Eckert IV.
const E4K = (2 + HALF);
function eck4Theta(p) {
  const k = E4K * sin(p);
  let t = p / 2;
  for (let i = 0; i < 40; i++) {
    const f = t + sin(t) * cos(t) + 2 * sin(t) - k, df = 1 + cos(2 * t) + 2 * cos(t);
    if (abs(df) < 1e-15) break;
    const d = f / df; t -= d; if (abs(d) < 1e-13) break;
  }
  return t;
}
const E4X = 2 / sqrt(PI * (4 + PI)), E4Y = 2 * sqrt(PI / (4 + PI));
const eckert4 = (l, p) => { const t = eck4Theta(p); return [E4X * l * (1 + cos(t)), E4Y * sin(t)]; };
const eckert4Inv = (x, y) => {
  const s = y / E4Y; if (abs(s) > 1 + 1e-12) return null;
  const t = asinC(s), l = x / (E4X * (1 + cos(t)));
  if (abs(l) > PI + 1e-9) return null;
  return [l, asinC((t + sin(t) * cos(t) + 2 * sin(t)) / E4K)];
};

// Goode homolosine: sinusoidal below 40 deg 44' 11.8", Mollweide above,
// shifted so the two meet. The lobes are the rects of the projection.
const GOODE_P = (40 + 44 / 60 + 11.8 / 3600) * D;
const GOODE_DY = mollweide(0, GOODE_P)[1] - GOODE_P;   // 0.05280...
const homolosine = (l, p) => {
  if (abs(p) <= GOODE_P) return [l * cos(p), p];
  const m = mollweide(l, p); return [m[0], m[1] - Math.sign(p) * GOODE_DY];
};
const homolosineInv = (x, y) => {
  if (abs(y) <= GOODE_P) { const c = cos(y); return c < 1e-12 ? null : [x / c, y]; }
  return mollweideInv(x, y + Math.sign(y) * GOODE_DY);
};

// Azimuthal maps in the clip frame: c = pi/2 - lat is the distance from
// the centre, the clip lon is the azimuth (pi = north, pi/2 = east).
const azim = rho => (l, p) => { const r = rho(HALF - p); return [r * sin(l), -r * cos(l)]; };
const azimInv = cOf => (x, y) => { const c = cOf(hypot(x, y)); if (!(c >= 0)) return null; return [atan2(x, -y), HALF - c]; };

// Conic maps: the cone constant n, the radius rho(phi) and rho0 at lat0.
function conic(n, rho, rho0) {
  return {
    f: (l, p) => { const r = rho(p), t = n * l; return [r * sin(t), rho0 - r * cos(t)]; },
    i: (x, y, rhoInv) => {
      const yy = rho0 - y; let r = Math.sign(n) * hypot(x, yy);
      const t = n > 0 ? atan2(x, yy) : atan2(-x, -yy);
      const l = t / n; if (abs(l) > PI + 1e-9) return null;
      const p = rhoInv(r); return p == null || isNaN(p) ? null : [l, p];
    },
  };
}
function albers(p0, p1, p2) {
  const n0 = (sin(p1) + sin(p2)) / 2, n = abs(n0) < 1e-10 ? 1e-10 : n0, C = cos(p1) * cos(p1) + 2 * n * sin(p1);
  const rho = p => sqrt(Math.max(0, C - 2 * n * sin(p))) / n, k = conic(n, rho, rho(p0));
  return { n, f: k.f, i: (x, y) => k.i(x, y, r => { const s = (C - r * r * n * n) / (2 * n); return abs(s) > 1 + 1e-9 ? null : asinC(s); }) };
}
function lccSphere(p0, p1, p2) {
  const tq = p => tan(PI / 4 + p / 2);
  let n = abs(p1 - p2) < 1e-10 ? sin(p1) : log(cos(p1) / cos(p2)) / log(tq(p2) / tq(p1));
  if (abs(n) < 1e-10) n = 1e-10;
  const F = cos(p1) * Math.pow(tq(p1), n) / n;
  const rho = p => abs(abs(p) - HALF) < 1e-12 ? (p * n > 0 ? 0 : Infinity) : F / Math.pow(tq(p), n), k = conic(n, rho, rho(p0));
  return { n, f: k.f, i: (x, y) => k.i(x, y, r => 2 * atan(Math.pow(F / r, 1 / n)) - HALF) };
}
function eqdc(p0, p1, p2) {
  let n = abs(p1 - p2) < 1e-10 ? sin(p1) : (cos(p1) - cos(p2)) / (p2 - p1);
  if (abs(n) < 1e-10) n = 1e-10;
  const G = cos(p1) / n + p1, rho = p => G - p, k = conic(n, rho, rho(p0));
  return { n, f: k.f, i: (x, y) => k.i(x, y, r => G - r) };
}
function bonne(p1) {
  const c = 1 / tan(p1);
  return {
    f: (l, p) => { const r = c + p1 - p, E = abs(r) < 1e-12 ? 0 : l * cos(p) / r; return [r * sin(E), c - r * cos(E)]; },
    i: (x, y) => {
      const yy = c - y, r = Math.sign(p1) * hypot(x, yy), p = c + p1 - r;
      if (abs(p) > HALF + 1e-9) return null;
      const E = atan2(x * Math.sign(p1), yy * Math.sign(p1)), cp = cos(p);
      const l = cp < 1e-12 ? 0 : r * E / cp; return abs(l) > PI + 1e-9 ? null : [l, p];
    },
  };
}
function polyconic(p0) {
  return (l, p) => {
    if (abs(p) < 1e-10) return [l, -p0];
    const E = l * sin(p), ct = 1 / tan(p);
    return [ct * sin(E), p - p0 + ct * (1 - cos(E))];
  };
}

// ── the table ──────────────────────────────────────────────────────────────
// family: cylindrical | pseudocylindrical | conic | azimuthal | interrupted
// prop:   conformal | equal-area | equidistant | compromise | perspective
// build(par) -> { raw, inv?, rects, Q? }. par holds lat0, lat1, lat2 (rad)
// and clip (rad, the azimuthal edge). rects are [lon0, lon1, lat0, lat1, cm]
// in the clip frame; cm is the central meridian of an interrupted lobe.
const R_ALL = [[-PI, PI, -HALF, HALF, 0]];
const deg = a => a.map(r => [r[0] * D, r[1] * D, r[2] * D, r[3] * D, r[4] * D]);
export const PROJ = [
  { key: 'mercator', name: 'Mercator', family: 'cylindrical', prop: 'conformal', ell: true,
    build: () => ({ raw: (l, p) => [l, asinh(tan(p))], inv: (x, y) => [x, atan(sinh(y))], rects: [[-PI, PI, -LIM_MERC, LIM_MERC, 0]] }) },
  { key: 'web-mercator', name: 'Web Mercator', family: 'cylindrical', prop: 'conformal',
    build: () => ({ raw: (l, p) => [l, asinh(tan(p))], inv: (x, y) => [x, atan(sinh(y))], rects: [[-PI, PI, -LIM_MERC, LIM_MERC, 0]] }) },
  { key: 'transverse-mercator', name: 'Transverse Mercator', family: 'cylindrical', prop: 'conformal', ell: true, Q: Q_TM,
    build: () => ({ raw: (l, p) => [-asinh(tan(p)), l], inv: (x, y) => [y, -atan(sinh(x))], rects: [[-PI, PI, -82 * D, 82 * D, 0]] }) },
  { key: 'equirectangular', name: 'Equirectangular', family: 'cylindrical', prop: 'equidistant',
    build: () => ({ raw: (l, p) => [l, p], inv: (x, y) => [x, y], rects: R_ALL }) },
  { key: 'lambert-cylindrical', name: 'Lambert cylindrical equal-area', short: 'Lambert cylindrical', family: 'cylindrical', prop: 'equal-area',
    build: () => ({ raw: (l, p) => [l, sin(p)], inv: (x, y) => abs(y) > 1 ? null : [x, asin(y)], rects: R_ALL }) },
  { key: 'gall-peters', name: 'Gall–Peters', family: 'cylindrical', prop: 'equal-area',
    build: () => { const c = cos(PI / 4); return { raw: (l, p) => [l * c, sin(p) / c], inv: (x, y) => abs(y * c) > 1 ? null : [x / c, asin(y * c)], rects: R_ALL }; } },
  { key: 'mollweide', name: 'Mollweide', family: 'pseudocylindrical', prop: 'equal-area',
    build: () => ({ raw: mollweide, inv: mollweideInv, rects: R_ALL }) },
  { key: 'hammer', name: 'Hammer', family: 'pseudocylindrical', prop: 'equal-area',
    build: () => ({
      raw: (l, p) => { const d = sqrt(1 + cos(p) * cos(l / 2)); return [2 * SQ2 * cos(p) * sin(l / 2) / d, SQ2 * sin(p) / d]; },
      inv: (x, y) => {
        const z2 = 1 - (x / 4) ** 2 - (y / 2) ** 2; if (z2 < 0.5 - 1e-9) return null;
        const z = sqrt(z2); return [2 * atan2(z * x, 2 * (2 * z2 - 1)), asinC(z * y)];
      }, rects: R_ALL }) },
  { key: 'aitoff', name: 'Aitoff', family: 'pseudocylindrical', prop: 'compromise',
    build: () => ({ raw: aitoff, rects: R_ALL }) },
  { key: 'winkel-tripel', name: 'Winkel tripel', family: 'pseudocylindrical', prop: 'compromise',
    build: () => ({ raw: winkel, rects: R_ALL }) },
  { key: 'robinson', name: 'Robinson', family: 'pseudocylindrical', prop: 'compromise',
    build: () => ({ raw: robinson, rects: R_ALL }) },
  { key: 'equal-earth', name: 'Equal Earth', family: 'pseudocylindrical', prop: 'equal-area',
    build: () => ({ raw: equalEarth, inv: equalEarthInv, rects: R_ALL }) },
  { key: 'natural-earth', name: 'Natural Earth', family: 'pseudocylindrical', prop: 'compromise',
    build: () => ({ raw: natEarth, rects: R_ALL }) },
  { key: 'eckert-iv', name: 'Eckert IV', family: 'pseudocylindrical', prop: 'equal-area',
    build: () => ({ raw: eckert4, inv: eckert4Inv, rects: R_ALL }) },
  { key: 'sinusoidal', name: 'Sinusoidal', family: 'pseudocylindrical', prop: 'equal-area',
    build: () => ({ raw: (l, p) => [l * cos(p), p], inv: (x, y) => { const c = cos(y); return abs(y) > HALF || c < 1e-12 || abs(x / c) > PI + 1e-9 ? null : [x / c, y]; }, rects: R_ALL }) },
  { key: 'goode', name: 'Goode homolosine', family: 'interrupted', prop: 'equal-area', noAspect: true,
    build: () => ({ raw: homolosine, inv: homolosineInv,
      rects: deg([[-180, -40, 0, 90, -100], [-40, 180, 0, 90, 30], [-180, -100, -90, 0, -160], [-100, -20, -90, 0, -60], [-20, 80, -90, 0, 20], [80, 180, -90, 0, 140]]) }) },
  { key: 'orthographic', name: 'Orthographic', family: 'azimuthal', prop: 'perspective', Q: Q_AZ, clip: 90,
    build: par => ({ raw: azim(sin), inv: azimInv(r => r > 1 + 1e-12 ? NaN : asinC(r)), rects: [[-PI, PI, HALF - Math.min(par.clip, HALF), HALF, 0]] }) },
  { key: 'stereographic', name: 'Stereographic', family: 'azimuthal', prop: 'conformal', Q: Q_AZ, clip: 120,
    build: par => ({ raw: azim(c => 2 * tan(c / 2)), inv: azimInv(r => 2 * atan(r / 2)), rects: [[-PI, PI, HALF - par.clip, HALF, 0]] }) },
  { key: 'gnomonic', name: 'Gnomonic', family: 'azimuthal', prop: 'perspective', Q: Q_AZ, clip: 62,
    build: par => ({ raw: azim(tan), inv: azimInv(atan), rects: [[-PI, PI, HALF - Math.min(par.clip, 80 * D), HALF, 0]] }) },
  { key: 'azimuthal-equidistant', name: 'Azimuthal equidistant', family: 'azimuthal', prop: 'equidistant', Q: Q_AZ, clip: 180,
    build: par => ({ raw: azim(c => c), inv: azimInv(r => r > PI + 1e-12 ? NaN : r), rects: [[-PI, PI, HALF - par.clip, HALF, 0]] }) },
  { key: 'lambert-azimuthal', name: 'Lambert azimuthal equal-area', short: 'Lambert azimuthal', family: 'azimuthal', prop: 'equal-area', Q: Q_AZ, clip: 180,
    build: par => ({ raw: azim(c => 2 * sin(c / 2)), inv: azimInv(r => r > 2 + 1e-12 ? NaN : 2 * asinC(r / 2)), rects: [[-PI, PI, HALF - par.clip, HALF, 0]] }) },
  { key: 'albers', name: 'Albers equal-area conic', short: 'Albers', family: 'conic', prop: 'equal-area', conic: true,
    build: par => { const c = albers(par.lat0, par.lat1, par.lat2); return { raw: c.f, inv: c.i, rects: R_ALL, n: c.n }; } },
  { key: 'lambert-conformal', name: 'Lambert conformal conic', short: 'Lambert conformal', family: 'conic', prop: 'conformal', conic: true, ell: true,
    build: par => {
      const c = lccSphere(par.lat0, par.lat1, par.lat2), lim = 55 * D;
      return { raw: c.f, inv: c.i, rects: [[-PI, PI, c.n > 0 ? -lim : -HALF, c.n > 0 ? HALF : lim, 0]], n: c.n };
    } },
  { key: 'equidistant-conic', name: 'Equidistant conic', family: 'conic', prop: 'equidistant', conic: true,
    build: par => { const c = eqdc(par.lat0, par.lat1, par.lat2); return { raw: c.f, inv: c.i, rects: R_ALL, n: c.n }; } },
  { key: 'bonne', name: 'Bonne', family: 'conic', prop: 'equal-area', conic: 'one',
    build: par => { const c = bonne(abs(par.lat1) < 1 * D ? 1 * D : par.lat1); return { raw: c.f, inv: c.i, rects: R_ALL }; } },
  { key: 'polyconic', name: 'American polyconic', short: 'Polyconic', family: 'conic', prop: 'compromise', conic: 'zero',
    build: par => ({ raw: polyconic(par.lat0), rects: R_ALL }) },
];
export const BY_KEY = Object.fromEntries(PROJ.map(p => [p.key, p]));

// The default view of each projection: the centre (degrees), the aspect
// and, for conics, the standard parallels.
export const HOME = {
  'transverse-mercator': { lon: 15 },
  orthographic: { lon: -25, lat: 30, aspect: 'oblique' },
  stereographic: { lon: 0, lat: 90, aspect: 'normal' },
  gnomonic: { lon: -40, lat: 45, aspect: 'oblique' },
  'azimuthal-equidistant': { lon: 0, lat: 90, aspect: 'normal' },
  'lambert-azimuthal': { lon: 10, lat: 52, aspect: 'oblique' },
  albers: { lon: -96, lat0: 23, lat1: 29.5, lat2: 45.5 },
  'lambert-conformal': { lon: 10, lat0: 50, lat1: 35, lat2: 65 },
  'equidistant-conic': { lon: 60, lat0: 45, lat1: 30, lat2: 60 },
  bonne: { lon: 10, lat1: 45 },
  polyconic: { lon: 0, lat0: 0 },
};

// ── a map ──────────────────────────────────────────────────────────────────
// st: { lon, lat, roll (degrees), aspect: 'normal'|'transverse'|'oblique',
//       lat0, lat1, lat2 (degrees, conics), clip (degrees, azimuthal) }
// Returns { def, M (world -> clip), Mt, rects, raw, inv, rot90 }.
//   aspect normal: cylinders and conics turn about the polar axis only
//     (lon); an azimuthal map is polar (centre at the pole nearer lat).
//   transverse: cylinders lie along a meridian (the globe rolls 90 deg,
//     and the map turns back 90 deg so north is up); an azimuthal map is
//     equatorial.
//   oblique: any centre and roll.
export function makeMap(key, st = {}) {
  const def = BY_KEY[key]; if (!def) throw new Error('no projection ' + key);
  const lon = (st.lon ?? 0) * D, lat = (st.lat ?? 0) * D, roll = (st.roll ?? 0) * D;
  let aspect = def.noAspect ? 'normal' : (st.aspect || 'normal');
  let R, rot90 = false;
  if (def.family === 'azimuthal') {
    if (aspect === 'normal') R = rotation(lon, (lat < 0 ? -90 : 90) * D, 0);
    else if (aspect === 'transverse') R = rotation(lon, 0, 0);
    else R = rotation(lon, lat, roll);
  } else if (aspect === 'transverse') { R = rotation(lon, 0, HALF); rot90 = true; }
  else if (aspect === 'oblique') R = rotation(lon, lat, roll);
  else R = rotation(lon, 0, 0);
  const par = {
    lat0: (aspect === 'normal' ? (st.lat0 ?? 0) : 0) * D, lat1: (st.lat1 ?? 30) * D, lat2: (st.lat2 ?? 60) * D,
    clip: (st.clip ?? def.clip ?? 180) * D,
  };
  if (def.conic === 'zero' && aspect === 'normal') par.lat0 = (st.lat0 ?? 0) * D;
  const b = def.build(par);
  const M = def.Q ? mul(def.Q, R) : R;
  const m = { key, def, aspect, R, M, Mt: tr(M), rects: b.rects, raw: b.raw, rawInv: b.inv || null, rot90, n: b.n, par, st };
  m.fwd = (lo, la) => fwdWorld(m, lo, la);
  m.inv = (x, y, guess) => invWorld(m, x, y, guess);
  return m;
}

// The rect of map m that holds clip point (l, p), or -1.
export function rectOf(m, l, p, eps = 1e-12) {
  const R = m.rects;
  for (let i = 0; i < R.length; i++) { const r = R[i]; if (l >= r[0] - eps && l <= r[1] + eps && p >= r[2] - eps && p <= r[3] + eps) return i; }
  return -1;
}
// Raw x, y of a clip point in rect i (the lobe offset and the 90 deg turn
// of the transverse aspect included).
export function rawIn(m, l, p, i) {
  const cm = m.rects[i][4], xy = m.raw(l - cm, p);
  xy[0] += cm;
  if (m.rot90) { const t = xy[0]; xy[0] = xy[1]; xy[1] = -t; }
  return xy;
}
// World lon, lat (radians) -> x, y, or null outside the map.
const _v = [0, 0, 0];
export function fwdWorld(m, lo, la) {
  const c = cos(la); _v[0] = c * cos(lo); _v[1] = c * sin(lo); _v[2] = sin(la);
  apply(m.M, _v, _v);
  const l = atan2(_v[1], _v[0]), p = latOf(_v);
  const i = rectOf(m, l, p); if (i < 0) return null;
  return rawIn(m, l, p, i);
}
// Inverse: x, y -> world lon, lat (radians), or null outside the map.
// Analytic where the table has one, else Newton on the raw formula from a
// guess (a clip lon, lat) or from a coarse search.
export function rawInverse(m, x, y, guess) {
  if (m.rot90) { const t = x; x = -y; y = t; }
  const R = m.rects;
  for (let i = 0; i < R.length; i++) {
    const r = R[i], cm = r[4];
    let lp = m.rawInv ? m.rawInv(x - cm, y) : newtonInv(m.raw, x - cm, y, guess ? [guess[0] - cm, guess[1]] : null, r);
    if (!lp || !isFinite(lp[0]) || !isFinite(lp[1])) continue;
    lp = [lp[0] + cm, lp[1]];
    if (rectOf(m, lp[0], lp[1], 1e-9) !== i) continue;
    // Accept only a true root (the analytic forms can return a point that
    // maps elsewhere, for example outside the Hammer ellipse).
    const q = m.raw(lp[0] - cm, lp[1]);
    if (hypot(q[0] - (x - cm), q[1] - y) > 1e-6 * (1 + hypot(x, y))) continue;
    return { l: lp[0], p: lp[1], i };
  }
  return null;
}
export function invWorld(m, x, y, guess) {
  const r = rawInverse(m, x, y, guess); if (!r) return null;
  const v = apply(m.Mt, vec(r.l, r.p));
  const ll = lonlat(v);
  ll.clip = [r.l, r.p];
  return ll;
}
function newtonInv(raw, x, y, guess, rect) {
  let l, p;
  if (guess) { l = guess[0]; p = guess[1]; }
  else {
    // coarse search over the rect for a start
    let best = Infinity;
    for (let a = 0; a <= 24; a++) for (let b = 0; b <= 12; b++) {
      const L = rect[0] - rect[4] + (rect[1] - rect[0]) * (a + 0.5) / 25, P = rect[2] + (rect[3] - rect[2]) * (b + 0.5) / 13;
      const q = raw(L, P), d = (q[0] - x) ** 2 + (q[1] - y) ** 2;
      if (d < best) { best = d; l = L; p = P; }
    }
  }
  const h = 1e-7;
  for (let it = 0; it < 60; it++) {
    const q = raw(l, p), fx = q[0] - x, fy = q[1] - y;
    if (fx * fx + fy * fy < 1e-26) return [l, p];
    const ql = raw(l + h, p), qp = raw(l, p + h);
    const a = (ql[0] - q[0]) / h, b = (qp[0] - q[0]) / h, c = (ql[1] - q[1]) / h, d = (qp[1] - q[1]) / h;
    const det = a * d - b * c; if (abs(det) < 1e-14) break;
    let dl = (d * fx - b * fy) / det, dp = (a * fy - c * fx) / det;
    const s = Math.max(1, hypot(dl, dp) / 0.3); dl /= s; dp /= s;   // damped
    l = clamp(l - dl, -PI, PI); p = clamp(p - dp, -HALF + 1e-9, HALF - 1e-9);
  }
  const q = raw(l, p);
  return hypot(q[0] - x, q[1] - y) < 1e-9 ? [l, p] : null;
}

// ── distortion ─────────────────────────────────────────────────────────────
// Tissot's indicatrix at world (lon, lat), radians, from the derivatives of
// the full map (central differences, h = 1e-6 rad; the error is near 1e-10).
// E: the map image of one radian east, N: one radian north, both on the
// ground of the unit sphere (or of the ellipsoid, with ell = {e2}).
// a, b: the semi-axes of the ellipse (max and min scale), s = a b the area
// scale, w the maximum angular distortion 2 asin((a - b)/(a + b)), theta
// the angle between the images of the meridian and the parallel.
// rawFn(lon, lat) is optional: a world -> x, y function to use instead of m.
export function distortion(m, lo, la, ell = null, rawFn = null) {
  const h = 1e-6;
  let f = rawFn;
  if (!f) {
    // Hold the clip lon branch and the rect of the centre point.
    const v = apply(m.M, vec(lo, la)), l0 = atan2(v[1], v[0]), p0 = latOf(v);
    let i = rectOf(m, l0, p0); if (i < 0) return null;
    f = (a, b) => {
      const w = apply(m.M, vec(a, b));
      let l = atan2(w[1], w[0]); if (l - l0 > PI) l -= TAU; else if (l0 - l > PI) l += TAU;
      return rawIn(m, l, latOf(w), i);
    };
  }
  const xe = f(lo + h, la), xw = f(lo - h, la), xn = f(lo, la + h), xs = f(lo, la - h);
  let kx = cos(la), ky = 1;
  if (ell) { const s2 = sin(la) ** 2, w = sqrt(1 - ell.e2 * s2); kx = cos(la) / w; ky = (1 - ell.e2) / (w * w * w); }
  const E = [(xe[0] - xw[0]) / (2 * h * kx), (xe[1] - xw[1]) / (2 * h * kx)];
  const N = [(xn[0] - xs[0]) / (2 * h * ky), (xn[1] - xs[1]) / (2 * h * ky)];
  return tissot(E, N);
}
export function tissot(E, N) {
  // Singular values of [E N] (2x2).
  const h2 = N[0] * N[0] + N[1] * N[1], k2 = E[0] * E[0] + E[1] * E[1];
  const det = E[0] * N[1] - E[1] * N[0], s = abs(det);
  const ap = sqrt(Math.max(0, h2 + k2 + 2 * s)), am = sqrt(Math.max(0, h2 + k2 - 2 * s));
  const a = (ap + am) / 2, b = (ap - am) / 2;
  return { E, N, h: sqrt(h2), k: sqrt(k2), a, b, s, det, w: a + b > 0 ? 2 * asinC((a - b) / (a + b)) : 0 };
}

// ── ELLIPSOID ──────────────────────────────────────────────────────────────
// WGS84. These are for the readouts and the tests; the drawn world map uses
// the sphere (at world scale the difference is under a pixel or two, and
// the transverse Mercator series is valid only near its central meridian).
export const WGS84 = (() => { const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f); return { a, f, e2, e: sqrt(e2), n: f / (2 - f) }; })();
export function mercEll(lon, lat, E = WGS84) {
  return [E.a * lon, E.a * (asinh(tan(lat)) - E.e * atanh(E.e * sin(lat)))];
}
export function mercEllInv(x, y, E = WGS84) {
  const tp = sinh(y / E.a);   // tan of the conformal latitude
  return [x / E.a, atan(tauFromConformal(tp, E))];
}
// tan(phi) from tan(chi), chi the conformal latitude (Karney 2011, eq 19-21).
function tauFromConformal(tp, E) {
  let t = tp;
  for (let i = 0; i < 20; i++) {
    const s = sinh(E.e * atanh(E.e * t / sqrt(1 + t * t)));
    const tpi = t * sqrt(1 + s * s) - s * sqrt(1 + t * t);
    const dt = (tp - tpi) / ((1 - E.e2) * sqrt(1 + tpi * tpi) * sqrt(1 + t * t) / (1 + (1 - E.e2) * t * t)) * 1;
    t += dt; if (abs(dt) < 1e-15 * Math.max(1, abs(t))) break;
  }
  return t;
}
// Transverse Mercator on the ellipsoid: Kruger's series to n^6 as given by
// Karney (2011), "Transverse Mercator with an accuracy of a few nanometers",
// J. Geodesy 85, eq 35-36. Good to about a millimetre within a few thousand
// kilometres of the central meridian.
const KR = (() => {
  const n = WGS84.n, n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
  const A = WGS84.a / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  const al = [0,
    n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
    13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
    61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
    49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
    34729 * n5 / 80640 - 3418889 * n6 / 1995840,
    212378941 * n6 / 319334400];
  const be = [0,
    n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360 - 81 * n5 / 512 + 96199 * n6 / 604800,
    n2 / 48 + n3 / 15 - 437 * n4 / 1440 + 46 * n5 / 105 - 1118711 * n6 / 3870720,
    17 * n3 / 480 - 37 * n4 / 840 - 209 * n5 / 4480 + 5569 * n6 / 90720,
    4397 * n4 / 161280 - 11 * n5 / 504 - 830251 * n6 / 7257600,
    4583 * n5 / 161280 - 108847 * n6 / 3991680,
    20648693 * n6 / 638668800];
  return { A, al, be };
})();
export function tmEll(lon, lat, lon0 = 0, k0 = 1) {
  const E = WGS84, l = wrap(lon - lon0);
  const t = sinh(asinh(tan(lat)) - E.e * atanh(E.e * sin(lat)));
  const xi1 = atan2(t, cos(l)), eta1 = atanh(sin(l) / sqrt(1 + t * t));
  let xi = xi1, eta = eta1;
  for (let j = 1; j <= 6; j++) { xi += KR.al[j] * sin(2 * j * xi1) * cosh(2 * j * eta1); eta += KR.al[j] * cos(2 * j * xi1) * sinh(2 * j * eta1); }
  return [k0 * KR.A * eta, k0 * KR.A * xi];
}
export function tmEllInv(x, y, lon0 = 0, k0 = 1) {
  const E = WGS84, xi = y / (k0 * KR.A), eta = x / (k0 * KR.A);
  let xi1 = xi, eta1 = eta;
  for (let j = 1; j <= 6; j++) { xi1 -= KR.be[j] * sin(2 * j * xi) * cosh(2 * j * eta); eta1 -= KR.be[j] * cos(2 * j * xi) * sinh(2 * j * eta); }
  const tp = sin(xi1) / sqrt(sinh(eta1) ** 2 + cos(xi1) ** 2);
  const l = atan2(sinh(eta1), cos(xi1));
  return [wrap(l + lon0), atan(tauFromConformal(tp, E))];
}
// UTM: zone 1..60, 6 degrees wide, k0 = 0.9996, false easting 500 km, and
// 10 000 km false northing south of the equator.
export function utm(lon, lat) {
  const zone = clamp(Math.floor((lon / D + 180) / 6) + 1, 1, 60), lon0 = (zone * 6 - 183) * D;
  const [x, y] = tmEll(lon, lat, lon0, 0.9996);
  return { zone, hemi: lat < 0 ? 'S' : 'N', e: x + 500000, n: lat < 0 ? y + 10000000 : y };
}
// Lambert conformal conic on the ellipsoid (Snyder 1987, eq 15-1 to 15-10).
export function lccEll(lat0, lat1, lat2, E = WGS84) {
  const m = p => cos(p) / sqrt(1 - E.e2 * sin(p) ** 2);
  const t = p => tan(PI / 4 - p / 2) / Math.pow((1 - E.e * sin(p)) / (1 + E.e * sin(p)), E.e / 2);
  const n = abs(lat1 - lat2) < 1e-10 ? sin(lat1) : (log(m(lat1)) - log(m(lat2))) / (log(t(lat1)) - log(t(lat2)));
  const F = m(lat1) / (n * Math.pow(t(lat1), n)), rho = p => E.a * F * Math.pow(t(p), n), r0 = rho(lat0);
  return { n, fwd: (l, p) => { const r = rho(p), th = n * l; return [r * sin(th), r0 - r * cos(th)]; } };
}

// ── GEODESY ────────────────────────────────────────────────────────────────
export const R_EARTH = 6371.0088;   // km, the IUGG mean radius
export function gcDist(lo1, la1, lo2, la2) {
  const s = sin((la2 - la1) / 2) ** 2 + cos(la1) * cos(la2) * sin((lo2 - lo1) / 2) ** 2;
  return 2 * asin(Math.min(1, sqrt(s)));
}
export function bearing(lo1, la1, lo2, la2) {
  return atan2(sin(lo2 - lo1) * cos(la2), cos(la1) * sin(la2) - sin(la1) * cos(la2) * cos(lo2 - lo1));
}
// n + 1 points on the great circle (slerp).
export function gcPath(lo1, la1, lo2, la2, n = 64) {
  const a = vec(lo1, la1), b = vec(lo2, la2), w = gcDist(lo1, la1, lo2, la2), out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (w < 1e-12) { out.push([lo1, la1]); continue; }
    const A = sin((1 - t) * w) / sin(w), B = sin(t * w) / sin(w);
    out.push(lonlat([A * a[0] + B * b[0], A * a[1] + B * b[1], A * a[2] + B * b[2]]));
  }
  return out;
}
// Rhumb line (loxodrome): constant bearing; straight on the Mercator map.
const psi = la => asinh(tan(clamp(la, -HALF + 1e-9, HALF - 1e-9)));
export function rhumb(lo1, la1, lo2, la2) {
  const dl = wrap(lo2 - lo1), dpsi = psi(la2) - psi(la1), dp = la2 - la1;
  const q = abs(dpsi) > 1e-12 ? dp / dpsi : cos(la1);
  return { dist: hypot(dp, q * dl), brg: atan2(dl, dpsi), dl, dpsi };
}
export function rhumbPath(lo1, la1, lo2, la2, n = 64) {
  const r = rhumb(lo1, la1, lo2, la2), out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, ps = psi(la1) + t * r.dpsi;
    out.push([lo1 + t * r.dl, atan(sinh(ps))]);
  }
  return out;
}
// Vincenty inverse on WGS84: metres and the initial bearing (radians).
// Returns null for nearly antipodal points where it does not converge.
export function vincenty(lo1, la1, lo2, la2, E = WGS84) {
  const f = E.f, b = E.a * (1 - f), L = wrap(lo2 - lo1);
  const U1 = atan((1 - f) * tan(la1)), U2 = atan((1 - f) * tan(la2));
  const sU1 = sin(U1), cU1 = cos(U1), sU2 = sin(U2), cU2 = cos(U2);
  let lam = L, it = 0, sS, cS, sig, ca2, c2m;
  do {
    const sl = sin(lam), cl = cos(lam);
    sS = sqrt((cU2 * sl) ** 2 + (cU1 * sU2 - sU1 * cU2 * cl) ** 2);
    if (sS === 0) return { m: 0, brg: 0 };
    cS = sU1 * sU2 + cU1 * cU2 * cl; sig = atan2(sS, cS);
    const sa = cU1 * cU2 * sl / sS; ca2 = 1 - sa * sa;
    c2m = ca2 ? cS - 2 * sU1 * sU2 / ca2 : 0;
    const C = f / 16 * ca2 * (4 + f * (4 - 3 * ca2));
    const prev = lam;
    lam = L + (1 - C) * f * sa * (sig + C * sS * (c2m + C * cS * (-1 + 2 * c2m * c2m)));
    if (abs(lam - prev) < 1e-13) break;
  } while (++it < 200);
  if (it >= 200) return null;
  const u2 = ca2 * (E.a * E.a - b * b) / (b * b);
  const A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const ds = B * sS * (c2m + B / 4 * (cS * (-1 + 2 * c2m * c2m) - B / 6 * c2m * (-3 + 4 * sS * sS) * (-3 + 4 * c2m * c2m)));
  const sl = sin(lam), cl = cos(lam);
  return { m: b * A * (sig - ds), brg: atan2(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl) };
}
// Signed area of a spherical polygon ring (unit sphere, steradians) from a
// flat [lon, lat, ...] list in radians. Each edge adds the signed area of
// the triangle it makes with the south pole (the half-angle form of the
// spherical excess). A counter-clockwise ring (interior on the left) is
// positive; a hole is negative.
export function sphArea(ring) {
  let s = 0; const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dl = wrap(ring[2 * j] - ring[2 * i]);
    const a = ring[2 * i + 1] / 2 + PI / 4, b = ring[2 * j + 1] / 2 + PI / 4;
    const k = sin(a) * sin(b);
    s += atan2(k * sin(dl), cos(a) * cos(b) + k * cos(dl));
  }
  return -2 * s;
}

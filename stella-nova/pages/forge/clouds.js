// ============================================================================
//  PLANET FORGE  ·  clouds.js — the evolving cloud field (no DOM)
// ----------------------------------------------------------------------------
//  One cloud deck and one thin cirrus layer, both functions of the point p
//  on the unit sphere and the simulated time in hours (clock.js). The view
//  evaluates the same field on the GPU (shaders/clouds.wgsl, into a cloud
//  map each frame); this file is the CPU reference. maps.js uses it at
//  hour 0 for the exported cloud map, and tests.mjs checks it.
//
//  Why not a texture that slides: before, the view drew one static cloud
//  map through a two-phase flow map. The two phases were the same clouds
//  at two offsets, cross-faded, so every cloud showed twice ("doubled"),
//  and the field never changed shape.
//
//  DECK  cover(p, t) = smooth(thr - 0.02, thr + 0.16, n)
//    n    8 octaves of simplex noise. Octave i turns about the pole at its
//         own rate w_i and moves through the 3D noise at v_i cells per hour,
//         so the octaves slide past each other and the pattern changes
//         shape (it evolves) instead of moving as one image. A small
//         time-varying domain warp folds the edges.
//    thr  0.35 - 0.9 cover - band(lat) - storms. The band is wet at the
//         equator, clear in the subtropics, stormy at mid-latitudes.
//  CYCLONES  MAX_CYC slots. Each slot lives LIFE hours (3-7 days), then a
//    new cyclone is born elsewhere (seeded by slot and generation). In its
//    life it drifts west in the tropics or east at mid-latitudes, moves
//    toward the pole, grows and fades (e = sin(pi a)^0.6). Round it the
//    noise is turned by an angle that falls with distance (spiral arms,
//    a clear eye); the angle grows with age but is bounded by the life.
//    Mid-latitude lows trail a curved cold front (a cloud band) toward
//    the equator and west.
//  CIRRUS  4 octaves stretched 3 x east-west, ridged into thin streaks,
//    on its own seed and faster rates (the jet stream).
//  The whole deck also turns slowly against the ground (DECK_RATE rad/h,
//  cirrus CIRRUS_RATE): the view adds that as a u offset when it samples,
//  so the solid motion is smooth at any frame rate.
//
//  packClouds(setup, hours) -> ArrayBuffer for the WGSL struct CloudU.
//
//  grep -n targets: "export function cloudSetup", "export function cyclones",
//  "export function cloudField", "export function packClouds", "const MAX_CYC"
// ============================================================================
import { simplex3, mulberry, clamp, smooth } from './noise.js';

export const MAX_CYC = 12;
export const DECK_RATE = 0.0035, CIRRUS_RATE = 0.012;   // rad per simulated hour
const D = Math.PI / 180;

// Per-planet constants. The seed matches rocky.js sCloud, so a planet keeps
// its clouds when only the shader changes.
export function cloudSetup(P) {
  const seed = P.seed >>> 0;
  const S = k => (Math.imul(seed ^ 0x5bd1e995, 2654435761) + Math.imul(k, 40503)) | 0;
  const gas = P.kind === 'gas', C = P.clouds || {};
  return {
    seed: S(7), cirrusSeed: S(17), cycSeed: S(27),
    deck: gas ? 0 : 1,
    cover: C.cover || 0, freq: C.freq || 1.5, swirl: C.swirl ?? 0.6,
    cirrus: gas ? (C.cover || 0) : (C.cover > 0 ? C.cirrus ?? 0.3 : 0),
    nCyc: gas ? 0 : Math.min(MAX_CYC, C.cyclones | 0),
  };
}

// The cyclones at time hours: Float32Array(MAX_CYC * 8) of
// [cx, cy, cz, r, twist, front, hemisphere sign, intensity].
export function cyclones(su, hours) {
  const out = new Float32Array(MAX_CYC * 8);
  for (let k = 0; k < su.nCyc; k++) {
    const r0 = mulberry((su.cycSeed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0);
    const life = 72 + 96 * r0(), off = r0() * life;
    const ph = (hours + off) / life, g = Math.floor(ph), a = ph - g, age = a * life;
    const r = mulberry((su.cycSeed + Math.imul(k + 1, 0x85ebca6b) + Math.imul(g + 7, 0xc2b2ae35)) >>> 0);
    const sg = r() < 0.5 ? -1 : 1;
    let lat = (12 + 48 * r()) * D, lon = r() * Math.PI * 2;
    const tropic = lat < 25 * D;
    lon += (tropic ? -0.35 : 0.45) * D * age;
    lat = Math.min(80 * D, lat + (tropic ? 0.08 : 0.05) * D * age);
    const e = Math.pow(Math.sin(Math.PI * a), 0.6);
    const rad = (0.1 + 0.1 * r()) * (0.6 + 0.4 * e);
    const twist = sg * e * (su.swirl * 6 + 0.03 * age);
    const front = tropic ? 0 : e * (0.5 + 0.5 * r());
    const la = sg * lat, j = k * 8;
    out[j] = Math.cos(la) * Math.cos(lon); out[j + 1] = Math.sin(la); out[j + 2] = Math.cos(la) * Math.sin(lon);
    out[j + 3] = rad; out[j + 4] = twist; out[j + 5] = front; out[j + 6] = sg; out[j + 7] = e;
  }
  return out;
}

// Rodrigues rotation of v about unit axis k by angle a (in place).
function rot(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), d = (k[0] * v[0] + k[1] * v[1] + k[2] * v[2]) * (1 - c);
  const x = v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d;
  const y = v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d;
  const z = v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d;
  v[0] = x; v[1] = y; v[2] = z;
}

const _q = [0, 0, 0], _c = [0, 0, 0];
// Octave rates: turn about the pole (rad/h) and drift in noise cells per hour.
export const OCT_W = [0.0, 0.002, -0.0015, 0.003, -0.0025, 0.004, -0.005, 0.006];
export const OCT_V = [0.004, 0.006, 0.009, 0.013, 0.018, 0.025, 0.034, 0.045];

// { deck, cirrus } in [0, 1] at unit vector p and time hours. cyc from cyclones().
export function cloudField(su, p, hours, cyc, out = {}) {
  out.deck = 0; out.cirrus = 0;
  const lat = Math.asin(clamp(p[1], -1, 1));
  if (su.deck && su.cover > 0) {
    _q[0] = p[0]; _q[1] = p[1]; _q[2] = p[2];
    let storm = 0, eye = 0;
    for (let k = 0; k < su.nCyc; k++) {
      const j = k * 8;
      _c[0] = cyc[j]; _c[1] = cyc[j + 1]; _c[2] = cyc[j + 2];
      const r = cyc[j + 3], dx = p[0] - _c[0], dy = p[1] - _c[1], dz = p[2] - _c[2];
      const d2 = (dx * dx + dy * dy + dz * dz) / (r * r);
      if (d2 > 30) continue;
      if (d2 < 9) rot(_q, _c, cyc[j + 4] * Math.exp(-d2) * (1 - Math.exp(-3 * d2)));
      storm += cyc[j + 7] * Math.exp(-d2 * 0.7);
      eye = Math.max(eye, cyc[j + 7] * Math.exp(-d2 * 60));
      if (cyc[j + 5] > 0) storm += cyc[j + 5] * frontBand(p, _c, r, cyc[j + 6]);
    }
    const t = hours, f0 = su.freq * 1.3;
    // time-varying warp
    const wx = simplex3(_q[0] * 1.6 + t * 0.004, _q[1] * 1.6, _q[2] * 1.6, su.seed + 1);
    const wy = simplex3(_q[0] * 1.6, _q[1] * 1.6 + t * 0.004, _q[2] * 1.6, su.seed + 2);
    const wz = simplex3(_q[0] * 1.6, _q[1] * 1.6, _q[2] * 1.6 + t * 0.004, su.seed + 3);
    const qx = _q[0] + 0.12 * wx, qy = _q[1] + 0.12 * wy, qz = _q[2] + 0.12 * wz;
    let n = 0, a = 1, norm = 0, f = f0;
    for (let i = 0; i < 8; i++) {
      const w = OCT_W[i] * t, c = Math.cos(w), s = Math.sin(w), v = OCT_V[i] * t;
      const x = (qx * c - qz * s) * f, y = qy * f * 1.4, z = (qx * s + qz * c) * f;
      n += a * simplex3(x + v, y + 0.6 * v, z - 0.8 * v, su.seed + 11 + i * 1013);
      norm += a; a *= 0.58; f *= 2.05;
    }
    n /= Math.sqrt(norm) * 1.1;
    const band = 0.12 * Math.cos(6 * lat) + 0.08 * Math.cos(2 * lat);
    const thr = 0.35 - su.cover * 0.9 - band - 0.45 * Math.min(storm, 1.2) + 0.6 * eye;
    const c0 = smooth(thr - 0.02, thr + 0.16, n);
    out.deck = clamp(c0 * (0.7 + 0.3 * smooth(thr + 0.1, thr + 0.5, n)));
  }
  if (su.cirrus > 0) {
    const t = hours;
    let n = 0, a = 1, norm = 0, f = su.freq * 0.8;
    for (let i = 0; i < 4; i++) {
      const w = -OCT_W[i + 1] * t * 2, c = Math.cos(w), s = Math.sin(w), v = OCT_V[i + 1] * t * 1.5;
      const x = (p[0] * c - p[2] * s) * f, y = p[1] * f * 3, z = (p[0] * s + p[2] * c) * f;
      n += a * (1 - Math.abs(simplex3(x - v, y, z + v, su.cirrusSeed + i * 977)));
      norm += a; a *= 0.55; f *= 2.1;
    }
    n /= norm;
    const zone = 0.55 + 0.45 * smooth(0.15, 0.7, Math.abs(Math.sin(lat)));
    out.cirrus = clamp(smooth(0.8 - 0.2 * su.cirrus, 0.98, n) * zone * Math.min(1, su.cirrus * 1.6));
  }
  return out;
}

// A cold front: a curved band trailing from the low toward the equator and west.
function frontBand(p, c, r, sg) {
  // east = c x up, north = up - c (c . up), both normalized
  let ex = -c[2], ez = c[0];
  const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
  let nx = -c[0] * c[1], ny = 1 - c[1] * c[1], nz = -c[2] * c[1];
  const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
  // axis: south-west in the north, north-west in the south
  let ax = -0.6 * ex - 0.8 * sg * nx, ay = -0.8 * sg * ny, az = -0.6 * ez - 0.8 * sg * nz;
  const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
  const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2];
  const s = dx * ax + dy * ay + dz * az;
  // the side axis b = c x a
  const bx = c[1] * az - c[2] * ay, by = c[2] * ax - c[0] * az, bz = c[0] * ay - c[1] * ax;
  const dp = dx * bx + dy * by + dz * bz - 0.18 * s * s / r;
  return Math.exp(-((dp / (0.3 * r)) ** 2)) * smooth(0, 0.6 * r, s) * smooth(5 * r, 2 * r, s);
}

// The uniform block for clouds.wgsl (struct CloudU): 4 vec4 + MAX_CYC x 2 vec4.
export const CLOUD_U_BYTES = (4 + MAX_CYC * 2) * 16;
export function packClouds(su, hours, buf = new ArrayBuffer(CLOUD_U_BYTES)) {
  const f = new Float32Array(buf), i = new Int32Array(buf);
  f[0] = hours; f[1] = su.cover; f[2] = su.freq; f[3] = su.swirl;
  f[4] = su.cirrus; f[5] = su.deck; f[6] = su.nCyc; f[7] = 0;
  i[8] = su.seed; i[9] = su.cirrusSeed; i[10] = 0; i[11] = 0;
  f[12] = 0; f[13] = 0; f[14] = 0; f[15] = 0;
  f.set(cyclones(su, hours), 16);
  return buf;
}

// ============================================================================
//  CORAL REEF  ·  world/field.js  ·  the infinite seafloor field (DOM-free)
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "i want to reimagine the coral reef
//  exploration region with the ROV's as an infinite procedurally generated
//  seafloor/seamount terrain". This file makes that terrain as one seeded
//  field with no edge. The same seed gives the same world in node, in a
//  worker and on the page. Metres, y up, the old plot datum (the sea
//  surface is at y = 55, shaders.js SURF_Y).
//
//  LARGE SCALE (2D, height(x, z))
//    plains ..... an abyssal plain at about -38 m, with a slow swell
//    seamounts .. one per 520 m cell (55 %), radius 90 to 220 m, 35 to
//                 62 m high, rift lobes; a guyot has a flat top
//    ridges ..... ridged noise lines of up to 14 m
//    plateaus ... soft terraces of 6 m where a mask is on
//    drop-offs .. cliff lines of 22 m where a slow noise crosses 0
//  SAND (sandAt): a sediment mask (low slope, low ground, noise). In
//    sand areas the sand is over the rock top, and the rock under it is
//    cut away, so no buried rock is meshed. Canyon floors get sand too.
//  3D (the rock field)
//    canyons .... channels of a warped noise, cut as 3D voids: vertical
//                 walls with an undercut near the floor, a flare at the
//                 rim, a sand floor 9 to 16 m down
//    strata ..... beds of 1.6 to 2.4 m; soft beds recess on steep walls,
//                 so hard beds stand out as ledges and overhangs
//    features ... per 48 m cell (hash): natural arches (half tori with a
//                 carved gap), pinnacles and hoodoos (with caps); per 16 m
//                 cell: boulders and scree
//    crag ....... domain-warped noise and Worley joints in a band near the
//                 surface (rock/geology.js crag, our own code)
//
//  THE BOUND. sdf = clamp(raw x SDF_SCALE, -0.8, 1.6). The raw field
//  changes by about 3.5 m per m at worst (crag band, terraces, canyon
//  walls), so |sdf(a) - sdf(b)| <= LIPSCHITZ |a - b| (tests/world.test.mjs
//  measures it). sdf / SDF_SCALE is about metres on open ground. The same
//  conventions as rock/index.js, so reef.js, camera.js and rov/pilot.js
//  use it as they use the plot rock.
//
//  API
//    const W = createWorld({ seed, fine = 1 });   // fine: crag octaves (1 desktop L0)
//    W.height(x, z), W.sandAt(x, z), W.sdf(x, y, z), W.sdfAll(x, y, z),
//    W.sand.sdf(x, y, z), W.normal(x, y, z), W.base(x, y, z) (no crag),
//    W.column(x, z, out) the 2D values of a column (the mesher caches it),
//    W.baseCol(col, x, y, z), W.sdfCol(col, x, y, z) the same with a column,
//    W.channel(x, z) -> { d (m from the canyon line), w (half width),
//                          floor, mask }
//    W.habitat(x, z) 0..1, W.features(x, z, r), W.canyonPath(x, z, len),
//    W.ground(x, z) the top of the solid (a canyon floor in a canyon),
//    W.columnRange(x0, z0, size) -> [ymin, ymax] of the surface in a square
//    W.bedAt(x, y, z) the strata bed coordinate (mesh attribute band)
//    W.localRock(ox, oy, oz, o) the field in local metres for reef.js
//
//  grep -n targets
//    constants ........ "export const SDF_SCALE"
//    the world ........ "export function createWorld"
//    bathymetry ....... "function heightRaw"
//    canyons .......... "function channelAt"
//    a column ......... "function column("
//    the base field ... "function baseCol"
//    crag detail ...... "function crag("
//    feature cells .... "function cellFeatures", "function boulderCell"
//    feature list ..... "function features("
//    rock adapter ..... "function localRock"
// ============================================================================
import { makeNoise, mulberry32 } from '../rock/noise.js';

export const SDF_SCALE = 0.4;
export const LIPSCHITZ = 1.5;
export const D_OUT = 4 * SDF_SCALE, D_IN = 2 * SDF_SCALE;
export const FEATURE_CELL = 48;          // m, arches and pinnacles
export const BOULDER_CELL = 16;          // m, boulders and scree
export const MOUNT_CELL = 520;           // m, seamounts
export const Y_MIN = -80, Y_MAX = 40;    // the world y range (m)
// The rock top term is (y - height) / SLOPE_K: a bound on slopes up to
// about 1.9 (62 degrees), so the field is never more than the distance.
// REACH: a feature is dropped only past this distance (m): there its raw
// distance is over the clamp range, so the drop does not show.
export const SLOPE_K = 1.5, REACH = 4.8;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
export function smax(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; }

// An integer hash of a cell and the seed, to 0..1, and a seeded generator.
export function hash3(i, j, s) {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
export const cellRand = (i, j, s) => mulberry32(hash3(i, j, s) || 1);

// Strata: u the place in a bed (0..1), soft the recess of a soft bed.
function strataProfile(u, soft) {
  const j = u < 0.5 ? u : 1 - u;
  return 0.4 * (1 - sstep(0.0, 0.2, j)) + soft * (sstep(0.22, 0.48, u) - sstep(0.74, 0.98, u));
}

export function createWorld(opts = {}) {
  const seed = (opts.seed ?? 1) >>> 0;
  const fine = clamp(opts.fine ?? 1, 0.2, 1);
  const N = makeNoise(seed), N2 = makeNoise(seed * 7 + 3);
  const rs = mulberry32(seed * 2654435761 + 11);
  // seed-level numbers
  const P = 1.6 + rs() * 0.8;                       // strata period (m)
  const strA = 0.32 + rs() * 0.18;                  // strata recess (m)
  const dipX = (rs() - 0.5) * 0.05, dipZ = (rs() - 0.5) * 0.05;
  const off = Array.from({ length: 16 }, () => (rs() - 0.5) * 200);
  const bseed = Math.floor(rs() * 1e6);
  const detail = 1;
  const BAND = 0.8 + 0.35 * detail;

  // ── seamounts: one per MOUNT_CELL cell (55 %) ─────────────────────────────
  const mountCache = new Map();
  function mountOf(i, j) {
    const key = i * 65536 + j;
    let m = mountCache.get(key);
    if (m !== undefined) return m;
    const r = cellRand(i, j, seed ^ 0x51ed);
    if (r() > 0.55) m = null;
    else {
      const R = 90 + r() * 130;
      m = {
        x: (i + 0.2 + 0.6 * r()) * MOUNT_CELL, z: (j + 0.2 + 0.6 * r()) * MOUNT_CELL, R, H: 35 + r() * 27,
        guyot: r() < 0.4, lobes: 3 + Math.floor(r() * 3), ph: r() * 6.283, lobeA: 0.12 + r() * 0.16,
      };
    }
    if (mountCache.size > 4096) mountCache.clear();
    mountCache.set(key, m);
    return m;
  }
  function seamounts(x, z) {
    const ci = Math.floor(x / MOUNT_CELL), cj = Math.floor(z / MOUNT_CELL);
    let h = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const m = mountOf(ci + di, cj + dj); if (!m) continue;
      const dx = x - m.x, dz = z - m.z, d2 = dx * dx + dz * dz;
      if (d2 > m.R * m.R * 1.7) continue;
      const a = Math.atan2(dz, dx);
      const rr = Math.sqrt(d2) / (m.R * (1 + m.lobeA * Math.sin(m.lobes * a + m.ph)));
      if (rr >= 1) continue;
      let hh = m.H * Math.pow(1 - rr, 1.35) * (1 + 0.35 * rr);
      if (m.guyot) { const top = m.H * 0.72; hh = hh > top ? top + (hh - top) * 0.08 : hh; }
      if (hh > h) h = hh;
    }
    return h;
  }

  // ── the bathymetry (no canyons) ──────────────────────────────────────────
  // q is a warped copy of (x, z), so no line of the noise lattice shows.
  function heightRaw(x, z) {
    const wx = 60 * N.fbm2(x / 400 + off[0], z / 400 + off[1], 3), wz = 60 * N.fbm2(x / 400 + off[2], z / 400 + off[3], 3);
    const qx = x + wx, qz = z + wz;
    let h = -38 + 9 * N.fbm2(qx / 900 + off[4], qz / 900 + off[5], 3);
    h += seamounts(qx, qz);
    // ridges where a slow mask is on
    const rm = sstep(-0.1, 0.25, N2.fbm2(qx / 700 + off[6], qz / 700 + off[7], 2));
    if (rm > 0) { const r = 1 - Math.abs(N2.g2(qx / 180 + off[8], qz / 180 + off[9])); h += 14 * rm * r * r * r; }
    // drop-offs: a cliff line where a slow noise crosses 0
    const dn = N.fbm2(qx / 650 + off[10], qz / 650 + off[11], 2);
    h += 22 * sstep(-0.07, 0.07, dn);
    // plateaus: soft terraces of 6 m where a mask is on
    const tm = sstep(0.25, 0.5, N2.fbm2(qx / 500 + off[12], qz / 500 + off[13], 2));
    if (tm > 0) {
      const t = h / 8, f = Math.floor(t), fr = t - f;
      h = h + tm * ((f + sstep(0.35, 0.95, fr)) * 8 - h);
    }
    return h;
  }
  // rubble relief: small, everywhere (out of the slope that sets the sand)
  // knolls and reef mounds of 1 to 5 m where the ground is rocky (not
  // where the sediment noise is high), so the rock rises out of the sand
  const rubble = (x, z) => {
    const rocky = 1 - sstep(-0.45, 0.05, N2.fbm2(x / 120 + 2.2, z / 120 - 6.6, 3));
    const k = N.fbm2(x / 38 + 5.1, z / 38 - 2.7, 3);
    return 0.9 * N.fbm2(x / 14 + off[14], z / 14 + off[15], 3) + rocky * (1.2 + 4.2 * Math.max(0, k) * Math.max(0, k) * 2.5);
  };
  function height(x, z) { return heightRaw(x, z) + rubble(x, z); }

  // ── canyons: channels of a warped noise ───────────────────────────────────
  // ch = |n| / |grad n| is about the distance (m) from the channel line.
  // The mask keeps the canyons to the slopes and plateaus above the plain.
  const CH = { d: 0, w: 0, floor: 0, mask: 0 };
  function chRaw(x, z) {
    const wx = 40 * N2.fbm2(x / 300 + 11.3, z / 300 - 4.1, 2), wz = 40 * N2.fbm2(x / 300 - 7.7, z / 300 + 2.9, 2);
    return N2.fbm2((x + wx) / 260 + 31.7, (z + wz) / 260 - 17.2, 3);
  }
  function channelAt(x, z, hTop, out = CH) {
    const e = 1.5, n = chRaw(x, z);
    const gx = (chRaw(x + e, z) - chRaw(x - e, z)) / (2 * e), gz = (chRaw(x, z + e) - chRaw(x, z - e)) / (2 * e);
    const g = Math.max(Math.hypot(gx, gz), 0.0016);
    out.d = Math.abs(n) / g;
    // half width 2.5 to 6 m, depth 9 to 16 m; only where the ground is
    // over the plain (canyons cut into the slopes)
    out.w = 2.5 + 3.5 * (0.5 + 0.5 * N.g2(x / 90 + 5.5, z / 90 - 3.3));
    const depth = 9 + 7 * (0.5 + 0.5 * N.g2(x / 140 - 9.1, z / 140 + 1.7));
    out.mask = sstep(-36, -26, hTop) * sstep(0.05, 0.35, N.fbm2(x / 800 + 3.7, z / 800 + 8.1, 2));
    out.floor = hTop - depth * out.mask;
    out.gx = gx / g; out.gz = gz / g;
    return out;
  }

  // ── a column: the 2D values at (x, z) ────────────────────────────────────
  // T top of the rock, gT the slope, S sand, C the canyon values, U the
  // strata phase, feats the 3D features whose bounds hold the column.
  function column(x, z, out = {}) {
    const e = 0.6;
    const TL = heightRaw(x, z), rb = rubble(x, z), T = TL + rb;
    const tx = (heightRaw(x + e, z) - heightRaw(x - e, z)) / (2 * e), tz = (heightRaw(x, z + e) - heightRaw(x, z - e)) / (2 * e);
    const slope = Math.hypot(tx, tz);
    const C = channelAt(x, z, TL, out.C || (out.C = { d: 0, w: 0, floor: 0, mask: 0 }));
    // sediment: low slope, low ground, a noise; and the canyon floors
    const sedN = N2.fbm2(x / 120 + 2.2, z / 120 - 6.6, 3);
    let sed = sstep(0.75, 0.25, slope) * (0.35 + 0.65 * sstep(-14, -32, TL)) * sstep(-0.35, 0.15, sedN);
    // the floor sand reaches past the widest part of the void (the flare
    // at the rim), then climbs inside the rock to the rim sand
    const hwRim = C.w + 1 + 0.22 * Math.max(0, T - C.floor - 4);
    const inCh = C.mask * (1 - sstep(hwRim, hwRim + 3, C.d));
    const rip = 0.035 * Math.sin(x * 2.9 + z * 0.8 + 3 * N.g2(x * 0.08, z * 0.08)) + 0.25 * N.fbm2(x / 30 + 1.1, z / 30 + 2.3, 2);
    let S = TL + 0.3 * rb + (sed - 0.42) * 1.3 + rip * sed;
    // canyon floor: sand a little over the floor
    if (inCh > 0) S = S + (Math.min(S, C.floor + 0.35 + rip) - S) * inCh;
    out.T = T; out.tx = tx; out.tz = tz; out.slope = slope; out.S = S; out.sed = sed; out.inCh = inCh;
    out.U = dipX * x + dipZ * z + 0.8 * N.fbm2(x / 25 - 9, z / 25 + 4, 2);
    out.wall = sstep(0.5, 1.4, slope);
    out.feats = featsAt(x, z, out.feats || (out.feats = []));
    out.x = x; out.z = z;
    return out;
  }

  // ── strata beds ───────────────────────────────────────────────────────────
  const bp1 = rs() * 6.283, bp2 = rs() * 6.283;
  function bedCoord(y, ph) { const u = (y + ph) / P; return u + 0.12 * Math.sin(u * 2.31 + bp1) + 0.05 * Math.sin(u * 5.13 + bp2); }
  function bedAmp(b) { let h = Math.imul(b + bseed, 0x2c1b3c6d) ^ 0x297a2d39; h = Math.imul(h ^ (h >>> 12), 0x297a2d39); const r = ((h ^ (h >>> 15)) >>> 0) / 4294967296; return r < 0.45 ? 0 : 0.5 + 0.9 * (r - 0.45); }

  // ── 3D features per cell ─────────────────────────────────────────────────
  // Each cell of FEATURE_CELL m has 0 or 1 arch and 0 to 2 pinnacles, on
  // the ground at their place (heightRaw, or the sand). Each cell of
  // BOULDER_CELL m has 0 to 3 boulders with scree. The lists are cached.
  const featCache = new Map(), bouldCache = new Map();
  function groundAt(x, z) {
    const c = column2(x, z), C = c.ch;
    // in a canyon the ground is the floor sand (the void is open water)
    if (C.mask > 0.02 && C.d < C.w + 1 + 0.22 * Math.max(0, c.T - C.floor - 4)) return C.floor + 0.35;
    return Math.max(c.T, c.S);
  }
  // A light column (no features): for the feature placement.
  const C2 = { C: { d: 0, w: 0, floor: 0, mask: 0 } };
  function column2(x, z) {
    const TL = heightRaw(x, z), rb = rubble(x, z), T = TL + rb;
    const e = 0.8, tx = (heightRaw(x + e, z) - heightRaw(x - e, z)) / (2 * e), tz = (heightRaw(x, z + e) - heightRaw(x, z - e)) / (2 * e);
    const slope = Math.hypot(tx, tz);
    const C = channelAt(x, z, TL, C2.C);
    const sedN = N2.fbm2(x / 120 + 2.2, z / 120 - 6.6, 3);
    const sed = sstep(0.75, 0.25, slope) * (0.35 + 0.65 * sstep(-14, -32, TL)) * sstep(-0.35, 0.15, sedN);
    C2.T = T; C2.S = TL + 0.3 * rb + (sed - 0.42) * 1.3; C2.slope = slope; C2.ch = C;
    return C2;
  }
  function cellFeatures(i, j) {
    const key = i * 65536 + j;
    let L = featCache.get(key);
    if (L) return L;
    L = [];
    const r = cellRand(i, j, seed ^ 0xfea7);
    const x0 = i * FEATURE_CELL, z0 = j * FEATURE_CELL;
    // an arch: on flat to gentle ground, not in a canyon
    if (r() < 0.32) {
      const x = x0 + 8 + r() * (FEATURE_CELL - 16), z = z0 + 8 + r() * (FEATURE_CELL - 16);
      const c = column2(x, z);
      if (c.slope < 0.55 && c.ch.d > c.ch.w + 8) {
        const Ra = 3.4 + r() * 3.2, rt = 0.8 + r() * 0.6, vs = 1.0 + r() * 0.35, a = r() * Math.PI;
        const g = Math.max(c.T, c.S);
        const f = { kind: 'arch', x, z, yc: g - Ra * 0.22, ground: g, Ra, rt, vs, ax: Math.cos(a), az: Math.sin(a) };
        f.R = Ra + rt * 2.2 + REACH; f.top = f.yc + (Ra + rt * 1.3) * vs;
        L.push(f);
      }
    }
    // pinnacles and hoodoos
    const np = r() < 0.5 ? (r() < 0.4 ? 2 : 1) : 0;
    for (let k = 0; k < np; k++) {
      const x = x0 + 6 + r() * (FEATURE_CELL - 12), z = z0 + 6 + r() * (FEATURE_CELL - 12);
      if (L.some(q => Math.hypot(q.x - x, q.z - z) < (q.R || 3) + 4)) continue;
      const c = column2(x, z);
      if (c.slope > 0.9 || c.ch.d < c.ch.w + 4) continue;
      const r0 = 0.9 + r() * 1.4, h = 5 + r() * 9, cap = r() < 0.5;
      const f = { kind: 'pinnacle', x, z, y0: Math.max(c.T, c.S) - 0.6, r0, h, ph: r() * 6.283, lx: (r() - 0.5) * 0.14, lz: (r() - 0.5) * 0.14, cap, capR: r0 * (1.35 + r() * 0.4), capT: 0.7 + r() * 0.5 };
      f.R = Math.max(r0 * 2.2, f.capR + 0.5) + h * 0.08 + REACH;
      L.push(f);
    }
    if (featCache.size > 8192) featCache.clear();
    featCache.set(key, L);
    return L;
  }
  function boulderCell(i, j) {
    const key = i * 65536 + j;
    let L = bouldCache.get(key);
    if (L) return L;
    L = [];
    const r = cellRand(i, j, seed ^ 0xb01d);
    const x0 = i * BOULDER_CELL, z0 = j * BOULDER_CELL;
    const n = Math.floor(r() * 3.6);
    for (let k = 0; k < n; k++) {
      const x = x0 + r() * BOULDER_CELL, z = z0 + r() * BOULDER_CELL, rad = 0.4 + r() * r() * 1.4;
      const g = groundAt(x, z), rot = r() * 3.1416;
      L.push({ x, z, y: g + rad * (0.3 - 0.25 * r()), rx: rad * (0.8 + r() * 0.4), ry: rad * (0.55 + r() * 0.3), rz: rad * (0.8 + r() * 0.4), c: Math.cos(rot), s: Math.sin(rot), R: rad * 1.4 + REACH });
      // scree round a large one
      if (rad > 0.9) for (let q = 0; q < 3; q++) {
        const a = r() * 6.283, d = rad + 0.3 + r() * 1.4, rs2 = 0.18 + r() * 0.25, sx = x + Math.cos(a) * d, sz = z + Math.sin(a) * d;
        L.push({ x: sx, z: sz, y: groundAt(sx, sz) + rs2 * 0.2, rx: rs2, ry: rs2 * 0.7, rz: rs2 * 0.9, c: 1, s: 0, R: rs2 * 1.2 + REACH });
      }
    }
    if (bouldCache.size > 16384) bouldCache.clear();
    bouldCache.set(key, L);
    return L;
  }
  // The features whose bounds hold the column (x, z).
  function featsAt(x, z, out) {
    out.length = 0;
    const fi = Math.floor(x / FEATURE_CELL), fj = Math.floor(z / FEATURE_CELL);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      for (const f of cellFeatures(fi + di, fj + dj)) { const dx = x - f.x, dz = z - f.z; if (dx * dx + dz * dz < f.R * f.R) out.push(f); }
    }
    const bi = Math.floor(x / BOULDER_CELL), bj = Math.floor(z / BOULDER_CELL);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      for (const f of boulderCell(bi + di, bj + dj)) { const dx = x - f.x, dz = z - f.z; if (dx * dx + dz * dz < f.R * f.R) out.push(f); }
    }
    return out;
  }

  // ── the base field (no crag) at a column ─────────────────────────────────
  function baseCol(c, x, y, z) {
    // the rock top: the height over the slope bound
    let d = (y - c.T) / SLOPE_K;
    // strata recess on steep walls: soft beds go in, hard beds stand out
    if (c.wall > 0 && y < c.T + 0.5) {
      const ub = bedCoord(y, c.U), bi = Math.floor(ub);
      d += c.wall * strA * 1.6 * strataProfile(ub - bi, bedAmp(bi)) * sstep(c.T + 0.5, c.T - 1.2, y);
    }
    // the rock under the sand: cut away where the sand covers it, so no
    // buried rock is meshed; else the rock goes 2.5 m under the sand
    // Near a canyon the rock goes down to the canyon floor, so its walls
    // are rock from the rim to the floor.
    const C = c.C;
    const bury = sstep(-0.05, -0.35, c.T - c.S);
    let B = c.S - 2.5 + 2.65 * bury;
    if (C.mask > 0.02) { const prox = C.mask * (1 - sstep(C.w + 6, C.w + 14, C.d)); if (prox > 0) B = Math.min(B, B + (C.floor - 2.5 - B) * prox); }
    d = smax(d, B - y, 0.3);
    // canyon void: vertical walls, an undercut near the floor, a flare at the rim
    if (C.mask > 0.02 && C.d < C.w + 12 && y > C.floor - 3) {
      const yf = y - C.floor;
      const und = 0.9 * Math.exp(-((yf - 1.4) * (yf - 1.4)) / 2.2);
      const fl = Math.max(0, yf - 4) * 0.22;
      const hw = (C.w + und + fl) * C.mask;
      const cv = Math.max(C.d - hw, C.floor - y);
      if (cv < 3) d = smax(d, -cv, 0.6);
    }
    // 3D features
    const F = c.feats;
    for (let k = 0; k < F.length; k++) {
      const f = F[k];
      if (f.kind === 'arch') {
        const dx = x - f.x, dz = z - f.z;
        if (dx * dx + dz * dz > f.R * f.R) continue;
        const uu = dx * f.ax + dz * f.az, ww = -dx * f.az + dz * f.ax, vv = (y - f.yc) / f.vs;
        // the gap: a tunnel through the ground under the arch (above the floor)
        const rho = Math.sqrt(uu * uu + vv * vv);
        const gap = Math.max(rho - (f.Ra - f.rt * 1.15), Math.abs(ww) - (f.rt * 2.4 + 1.2), f.ground + 0.2 - y);
        if (gap < 2.6) d = smax(d, -gap, 0.5);
        const sinT = vv / (rho || 1);
        const rt = f.rt * (1 + 0.5 * (1 - Math.max(0, sinT)) + 0.15 * Math.sin(uu * 1.3));
        const qx = (rho - f.Ra) * Math.min(1, f.vs), qy = ww / 1.35;
        // only the upper half of the torus (the legs go into the ground)
        const da = Math.max(Math.sqrt(qx * qx + qy * qy) - rt, f.ground - 1.5 - y);
        d = smin(d, da, 0.9);
      } else if (f.kind === 'pinnacle') {
        const yy = y - f.y0;
        if (yy > f.h + f.capT + REACH || yy < -REACH) continue;
        const dx = x - f.x - f.lx * yy, dz = z - f.z - f.lz * yy;
        if (dx * dx + dz * dz > f.R * f.R) continue;
        const tH = clamp(yy / f.h, 0, 1), th = Math.atan2(dz, dx);
        const rho = Math.sqrt(dx * dx + dz * dz), lob = rho / (rho + 0.5 * f.r0);
        const rad = f.r0 * (1 - 0.38 * tH) * (1 + lob * (0.18 * Math.sin(3 * th + f.ph + yy * 0.35) + 0.1 * Math.sin(5 * th - yy * 0.6))) + 0.8 * Math.exp(-Math.max(0, yy) / 0.8);
        let dp = smax(rho - rad, yy - f.h, 0.5);
        if (f.cap) { const cy = yy - (f.h - f.capT * 0.5); dp = smin(dp, Math.max(rho - f.capR, Math.abs(cy) - f.capT * 0.5), 0.5); }
        d = smin(d, dp, 0.8);
      } else {
        // a boulder: an ellipsoid distance (Quilez)
        const dx = x - f.x, dy = y - f.y, dz = z - f.z;
        if (dx * dx + dz * dz > f.R * f.R || dy > f.ry + REACH) continue;
        const lx = (dx * f.c - dz * f.s) / f.rx, lz = (dx * f.s + dz * f.c) / f.rz, ly = dy / f.ry;
        const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
        const k1 = Math.sqrt(lx * lx / (f.rx * f.rx) + ly * ly / (f.ry * f.ry) + lz * lz / (f.rz * f.rz)) || 1e-6;
        const db = k0 < 1 ? (k0 - 1) * Math.min(f.rx, f.ry, f.rz) : k0 * (k0 - 1) / k1;
        d = smin(d, db, 0.22);
      }
    }
    return d;
  }

  // ── crag detail (near the surface only) ──────────────────────────────────
  const W3 = [0, 0, 0];
  const crackW = 0.3 + 0.15 * (1 - fine);
  const ampR = 0.34 * detail, ampR2 = 0.15 * detail * fine, ampW = 0.2 * detail * (0.4 + 0.6 * fine), ampP = 0.05 * detail * (fine > 0.9 ? 1 : 0);
  function crag(x, y, z) {
    const wx = N.g3(x * 0.19, y * 0.19, z * 0.19 + 5.2), wy = N.g3(x * 0.19 + 9.7, y * 0.19, z * 0.19) * 0.45, wz = N.g3(x * 0.19, y * 0.19 - 3.3, z * 0.19);
    const qx = x + wx, qy = y + wy, qz = z + wz;
    let disp = ampR * 1.4 * N.g3(qx * 0.18, qy * 0.12, qz * 0.18);
    N.worley3(qx * 0.45, qy * 0.2, qz * 0.45, W3);
    const e = W3[1] - W3[0];
    disp += ampW * 1.5 * Math.max(0, 1 - e / crackW) + ampW * 0.5 * (W3[2] - 0.5) * sstep(0.02, crackW, e);
    if (fine > 0.9) {
      N.worley3(qx + 7, qy * 0.6, qz, W3);
      const e2 = W3[1] - W3[0];
      disp += ampR2 * 0.8 * Math.max(0, 1 - e2 / 0.35) + ampR2 * 0.4 * (W3[2] - 0.5) * sstep(0.02, 0.35, e2);
    }
    if (ampP > 0) disp += ampP * N.g3(x * 2.3, y * 2.3, z * 2.3);
    return disp;
  }
  // sand areas get less crag (the rock there is low boulders and outcrops)
  function rawCol(c, x, y, z) {
    const b = baseCol(c, x, y, z);
    if (b <= -0.8 || b >= BAND) return b;
    const cr = crag(x, y, z) * (1 - 0.6 * c.sed);
    return b + (cr > 0 ? Math.min(cr, 0.5 * (b + 0.8), BAND - b) : Math.max(cr, -0.5 * (BAND - b), -(b + 0.8)));
  }
  const scaleClamp = v => { const d = v * SDF_SCALE; return d > D_OUT ? D_OUT : d < -D_IN ? -D_IN : d; };
  function sdfCol(c, x, y, z) { return scaleClamp(rawCol(c, x, y, z)); }

  // The point field reads a column from a cache of tiles: TILE m squares
  // of columns every TS m, read with bilinear weights (the terrain is
  // smooth at that scale: the error is a few mm), and the superset list
  // of the 3D features of the tile (each feature is exact). The mesher
  // (world/mesh.js) reads exact columns at its lattice points instead.
  const TILE = 16, TS = 0.5, TN = TILE / TS + 1, NF = 9;
  const tiles = new Map();
  let tileN = 0;
  function tileAt(ti, tj) {
    const key = ti * 1048576 + tj;
    let t = tiles.get(key);
    if (t) return t;
    t = { v: new Float32Array(TN * TN * NF), feats: [], top: -Infinity };
    const c = {};
    for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) {
      column(ti * TILE + i * TS, tj * TILE + j * TS, c);
      const o = (j * TN + i) * NF, v = t.v;
      v[o] = c.T; v[o + 1] = c.S; v[o + 2] = c.wall; v[o + 3] = c.U; v[o + 4] = c.sed;
      v[o + 5] = c.C.d; v[o + 6] = c.C.w; v[o + 7] = c.C.floor; v[o + 8] = c.C.mask;
      if (c.T > t.top) t.top = c.T; if (c.S > t.top) t.top = c.S;
    }
    // the features whose bounds meet the tile
    const x0 = ti * TILE, z0 = tj * TILE;
    const fi0 = Math.floor((x0 - 24) / FEATURE_CELL), fi1 = Math.floor((x0 + TILE + 24) / FEATURE_CELL);
    const fj0 = Math.floor((z0 - 24) / FEATURE_CELL), fj1 = Math.floor((z0 + TILE + 24) / FEATURE_CELL);
    const meets = f => f.x + f.R > x0 && f.x - f.R < x0 + TILE && f.z + f.R > z0 && f.z - f.R < z0 + TILE;
    for (let j = fj0; j <= fj1; j++) for (let i = fi0; i <= fi1; i++) for (const f of cellFeatures(i, j)) if (meets(f)) {
      t.feats.push(f); t.top = Math.max(t.top, f.kind === 'arch' ? f.top + 1 : f.y0 + f.h + (f.cap ? f.capT : 0) + 1);
    }
    const bi0 = Math.floor((x0 - 4) / BOULDER_CELL), bi1 = Math.floor((x0 + TILE + 4) / BOULDER_CELL);
    const bj0 = Math.floor((z0 - 4) / BOULDER_CELL), bj1 = Math.floor((z0 + TILE + 4) / BOULDER_CELL);
    for (let j = bj0; j <= bj1; j++) for (let i = bi0; i <= bi1; i++) for (const f of boulderCell(i, j)) if (meets(f)) { t.feats.push(f); t.top = Math.max(t.top, f.y + f.ry + 0.5); }
    if (tiles.size >= 96) { const k0 = tiles.keys().next().value; tiles.delete(k0); }
    tiles.set(key, t); tileN++;
    return t;
  }
  const IC = { C: { d: 0, w: 0, floor: 0, mask: 0 }, feats: null, T: 0, S: 0, wall: 0, U: 0, sed: 0, top: 0 };
  let lastT = null, lastTi = NaN, lastTj = NaN;
  function colAt(x, z) {
    const ti = Math.floor(x / TILE), tj = Math.floor(z / TILE);
    const t = ti === lastTi && tj === lastTj ? lastT : (lastT = tileAt(ti, tj), lastTi = ti, lastTj = tj, lastT);
    const u = Math.min((x - ti * TILE) / TS, TN - 1.0001), w = Math.min((z - tj * TILE) / TS, TN - 1.0001);
    const i = Math.floor(u), j = Math.floor(w), fu = u - i, fw = w - j;
    const o = (j * TN + i) * NF, o1 = o + NF, o2 = o + TN * NF, o3 = o2 + NF, v = t.v;
    const a = (1 - fu) * (1 - fw), b = fu * (1 - fw), c = (1 - fu) * fw, d = fu * fw;
    const L = k => v[o + k] * a + v[o1 + k] * b + v[o2 + k] * c + v[o3 + k] * d;
    IC.T = L(0); IC.S = L(1); IC.wall = L(2); IC.U = L(3); IC.sed = L(4);
    IC.C.d = L(5); IC.C.w = L(6); IC.C.floor = L(7); IC.C.mask = L(8);
    IC.feats = t.feats; IC.top = t.top;
    return IC;
  }
  // the exact field: the column at (x, z) itself (tests, normals)
  const EX = {};
  function sdfExact(x, y, z) { if (y > Y_MAX + 10) return D_OUT; if (y < Y_MIN - 10) return -D_IN; return sdfCol(column(x, z, EX), x, y, z); }
  function sdf(x, y, z) {
    if (y > Y_MAX + 10) return D_OUT;
    if (y < Y_MIN - 10) return -D_IN;
    const c = colAt(x, z);
    // a point far over the tile: the height bound alone
    const top = Math.max(c.T, c.S, c.top);
    if (y > top + 6) return scaleClamp((y - top) / SLOPE_K + 4);
    return sdfCol(c, x, y, z);
  }
  function sandAt(x, z) { return colAt(x, z).S; }
  // the sand: a height term over the slope bound, as the rock top
  const sandSdf = (x, y, z) => scaleClamp((y - sandAt(x, z)) / SLOPE_K);
  function sdfAll(x, y, z) { const a = sdf(x, y, z), b = sandSdf(x, y, z); return a < b ? a : b; }
  function normal(x, y, z, e = 0.04) {
    const gx = sdfExact(x + e, y, z) - sdfExact(x - e, y, z), gy = sdfExact(x, y + e, z) - sdfExact(x, y - e, z), gz = sdfExact(x, y, z + e) - sdfExact(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  }
  function base(x, y, z) { return baseCol(column(x, z, EX), x, y, z); }

  // ── queries for the planner, the camera and the corals ───────────────────
  function channel(x, z) { const T = heightRaw(x, z); const o = channelAt(x, z, T, {}); return o; }
  function habitat(x, z) {
    const c = column2(x, z);
    const depth = sstep(-48, -8, Math.max(c.T, c.S));
    const rocky = 1 - 0.75 * sstep(0.1, 0.6, c.S - c.T + 0.42 * 1.3 - 0.42);
    const n = 0.55 + 0.45 * N2.fbm2(x / 160 - 3.3, z / 160 + 7.7, 2);
    return clamp(depth * (0.35 + 0.65 * rocky) * n + 0.08, 0, 1);
  }
  // The y range of the surface (rock and sand) in a square: samples of
  // the columns, the 3D features and a margin for the crag.
  function columnRange(x0, z0, size, step = 4) {
    let lo = Infinity, hi = -Infinity;
    for (let z = z0; z <= z0 + size + 1e-6; z += step) for (let x = x0; x <= x0 + size + 1e-6; x += step) {
      const c = column2(x, z), g = Math.max(c.T, c.S);
      lo = Math.min(lo, c.T, c.S, c.ch.mask > 0.02 ? c.ch.floor : Infinity); hi = Math.max(hi, g);
    }
    const fi0 = Math.floor((x0 - 20) / FEATURE_CELL), fi1 = Math.floor((x0 + size + 20) / FEATURE_CELL);
    const fj0 = Math.floor((z0 - 20) / FEATURE_CELL), fj1 = Math.floor((z0 + size + 20) / FEATURE_CELL);
    for (let j = fj0; j <= fj1; j++) for (let i = fi0; i <= fi1; i++) for (const f of cellFeatures(i, j)) {
      if (f.x < x0 - f.R || f.x > x0 + size + f.R || f.z < z0 - f.R || f.z > z0 + size + f.R) continue;
      hi = Math.max(hi, f.kind === 'arch' ? f.top + 1 : f.y0 + f.h + (f.cap ? f.capT : 0) + 1);
    }
    return [lo - 4, hi + 3.5];
  }
  // The features near (x, z) within r, in the forms of rock/index.js.
  function features(x, z, r = 40) {
    const out = [];
    const i0 = Math.floor((x - r) / FEATURE_CELL), i1 = Math.floor((x + r) / FEATURE_CELL), j0 = Math.floor((z - r) / FEATURE_CELL), j1 = Math.floor((z + r) / FEATURE_CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const f of cellFeatures(i, j)) {
      if (Math.hypot(f.x - x, f.z - z) > r) continue;
      if (f.kind === 'arch') {
        const inner = f.yc + (f.Ra - f.rt * 1.05) * f.vs;
        out.push({ kind: 'arch', type: 'free', id: `arch:${Math.round(f.x)},${Math.round(f.z)}`, center: [f.x, (f.ground + inner) / 2, f.z], size: 2 * f.Ra, gap: [f.ground, inner], top: f.top, axis: [-f.az, 0, f.ax] });
      } else {
        out.push({ kind: 'pinnacle', id: `pin:${Math.round(f.x)},${Math.round(f.z)}`, center: [f.x, f.y0 + f.h / 2, f.z], size: f.h, radius: f.r0, hoodoo: f.cap });
        if (f.cap) out.push({ kind: 'overhang', type: 'hoodoo cap', center: [f.x, f.y0 + f.h - f.capT, f.z], size: 2 * f.capR });
      }
    }
    // canyons: the nearest channel line on a grid of samples
    let best = null;
    for (let dz = -r; dz <= r; dz += 8) for (let dx = -r; dx <= r; dx += 8) {
      const qx = x + dx, qz = z + dz, T = heightRaw(qx, qz), c = channelAt(qx, qz, T, {});
      if (c.mask < 0.5 || c.d > c.w) continue;
      const s = c.d + Math.hypot(dx, dz) * 0.15;
      if (!best || s < best.s) best = { s, x: qx, z: qz };
    }
    if (best) {
      const path = canyonPath(best.x, best.z, 48);
      if (path.length > 3) {
        const mid = path[Math.floor(path.length / 2)];
        let len = 0; for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]);
        out.push({ kind: 'canyon', id: `canyon:${Math.round(mid[0] / 8)},${Math.round(mid[2] / 8)}`, center: mid, size: len, width: 2 * channelAt(mid[0], mid[2], heightRaw(mid[0], mid[2]), {}).w, path });
      }
    }
    return out;
  }
  // A path on a canyon floor (the floor height) from near (x, z), both
  // ways along the channel line, about len m, every 2 m.
  function canyonPath(x, z, len = 48) {
    const snap = (p) => {
      for (let it = 0; it < 6; it++) {
        const T = heightRaw(p[0], p[1]), c = channelAt(p[0], p[1], T, {}), n = chRaw(p[0], p[1]);
        const s = Math.sign(n) * Math.min(c.d, 2);
        p[0] -= c.gx * s; p[1] -= c.gz * s;
      }
      return p;
    };
    const walk = (dir) => {
      const pts = []; let p = snap([x, z]), t = null;
      for (let s = 0; s < len / 2; s += 2) {
        const T = heightRaw(p[0], p[1]), c = channelAt(p[0], p[1], T, {});
        if (c.mask < 0.3) break;
        let tx = -c.gz * dir, tz = c.gx * dir;
        if (t && tx * t[0] + tz * t[1] < 0) { tx = -tx; tz = -tz; }
        t = [tx, tz];
        pts.push([p[0], Math.max(c.floor, sandAt(p[0], p[1])), p[1]]);
        p = snap([p[0] + tx * 2, p[1] + tz * 2]);
      }
      return pts;
    };
    const a = walk(1), b = walk(-1);
    return b.reverse().concat(a.slice(1));
  }

  // ── reef.js adapter: the field in local metres ────────────────────────────
  // reef.js works best near the origin (its cached field keys and the
  // coral-sdf.js brick keys have a range): a chunk grows its corals in
  // metres from (ox, oy, oz). sites come from world/corals.js.
  function localRock(ox, oy, oz, o = {}) {
    const lsdf = (x, y, z) => sdf(x + ox, y + oy, z + oz);
    return {
      sdf: lsdf, sdfAll: (x, y, z) => sdfAll(x + ox, y + oy, z + oz),
      normal: (x, y, z, e) => normal(x + ox, y + oy, z + oz, e),
      sand: { heightAt: (x, z) => sandAt(x + ox, z + oz) - oy, sdf: (x, y, z) => sandSdf(x + ox, y + oy, z + oz) },
      lipschitz: LIPSCHITZ, sdfScale: SDF_SCALE, sdfClamp: [-D_IN, D_OUT], seed,
      bounds: { min: [-(o.half || 24), (o.ymin ?? Y_MIN) - oy, -(o.half || 24)], max: [o.half || 24, (o.ymax ?? Y_MAX) - oy, o.half || 24] },
      radius: 1e4, quality: 'world', detail: 1,
      sampleSurface: () => [],
    };
  }

  return {
    seed, fine, period: P, lipschitz: LIPSCHITZ, sdfScale: SDF_SCALE, sdfClamp: [-D_IN, D_OUT], band: BAND,
    height, heightLarge: heightRaw, sandAt, sdf, sdfAll, sdfExact, sand: { heightAt: sandAt, sdf: sandSdf }, normal, base,
    column, baseCol, sdfCol, rawCol, crag, channel, habitat, columnRange, features, canyonPath, localRock, ground: groundAt,
    bedAt: (x, y, z) => bedCoord(y, colAt(x, z).U), bedCoord,
    cellFeatures, boulderCell, get tiles() { return tiles.size; }, get tileBuilds() { return tileN; },
  };
}

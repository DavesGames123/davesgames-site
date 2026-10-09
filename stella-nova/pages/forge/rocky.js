// ============================================================================
//  PLANET FORGE  ·  rocky.js — the terrestrial generator (no DOM)
// ----------------------------------------------------------------------------
//  prepareRocky(P) builds everything that does not depend on the texel: the
//  derived seeds, the plates, the crater fields, the calderas and the height
//  range. ctx.sample(p, out) then gives one texel at the unit vector p.
//
//  HEIGHT (heightCore), in order
//    1. q = warp(p)                     two-level domain warp of the input
//    2. c = fbm(q) + fbm(p)             continents: 3 low octaves warped,
//                                       the fine ones on the plain point
//    3. plates: nearest two of N seeded Voronoi sites on the sphere. Each
//       plate is continental or oceanic and has a drift vector. Where two
//       plates converge, the boundary lifts (uplift); where they part, it
//       sinks (rift). A small dichotomy term lowers one hemisphere.
//    4. mountains = ridged(q) * mask    mask = uplift + high continent
//       terraces (terrain.terraces): the height is quantized to benches
//       with flat treads and steep risers (mesas of flat-lying layers)
//    5. detail = fbmEroded(p)           derivative-damped fBm: less detail on
//                                       steep slopes, so slopes read eroded
//    6. dunes, cracks (lineae), calderas, craters. Lineae are zero sets of
//       noise on their own warp (crackWarp); lineDist gives the distance
//       to a line, so a line keeps its width and never breaks into dots
//    Valleys and rivers come later: erode.js cuts drainage networks into
//    the joined height map, and maps.js finish lays rivers and snow.
//  The sea level is the quantile of the height at ocean.level over 6000
//  Fibonacci points, so it does not depend on the map size.
//
//  CRATERS  a truncated power law N(>r) ~ r^-alpha from rMin to rMax. Each
//  crater has an age (more old than young). craterProfile gives the shape
//  in km: simple bowls below the transition diameter, complex craters
//  (flat floor, terraced wall, central peak, peak ring past 10 Dt) above
//  it. Lookups lay craters oldest first; a new bowl erases older crater
//  relief inside it (saturation). Old craters lose rim and terraces and
//  fill in; old large basins and low plains flood to dark maria, and the
//  craters younger than the flood land on top. Only the youngest keep
//  bright floors, blankets and rays. Lookups
//  go through three uniform grids on [-1, 1]^3 (cell >= influence radius)
//  plus a short brute-force list for the largest.
//
//  COLOUR  temperature T = equator..pole by sin^2(lat), minus the lapse rate
//  times the height above the sea. Moisture M = Hadley pattern cos(6 lat)
//  + noise + coast. Biomes are a soft Whittaker lookup in (T, M). Ice
//  where T < iceC (land and sea). Barren worlds use the palette ramp.
//  A lava sea is plates of dark basalt crust: Worley cells (noise.js
//  worley3) at two scales; F2 - F1 near 0 marks the glowing cracks. The
//  crust keeps a dull red glow so the sea reads apart from the land at night.
//  Volcanic plume rings take palette.ring.
//
//  grep -n targets: "export function prepareRocky", "function heightCore",
//  "function craterField", "function buildCraters", "export function craterProfile", "function shade",
//  "const BIOMES", "export function craterList", "function crackWarp", "function lineDist"
// ============================================================================
import { fbm, fbmEroded, ridged, warp, simplex3, worley3, mulberry, onSphere, fibonacci, clamp, mix, smooth, texelAngle } from './noise.js';
import { cloudSetup, cyclones, cloudField } from './clouds.js';
import { buildGeology, geologyHeight, geologyColour, geologyProbes } from './geology.js';

// Linear sRGB-ish biome colours (sRGB triples) and their (T °C, M) centres.
const BIOMES = [
  // T, M, colour
  [27, 0.86, [0.09, 0.19, 0.06]],   // rain forest
  [22, 0.56, [0.2, 0.27, 0.1]],     // seasonal forest
  [25, 0.33, [0.46, 0.41, 0.22]],   // savanna
  [27, 0.06, [0.8, 0.66, 0.46]],    // hot desert
  [12, 0.66, [0.12, 0.21, 0.08]],   // temperate forest
  [12, 0.32, [0.36, 0.39, 0.2]],    // grassland
  [7, 0.07, [0.56, 0.5, 0.4]],      // cold desert
  [0, 0.6, [0.11, 0.17, 0.11]],     // taiga
  [-7, 0.34, [0.43, 0.41, 0.35]],   // tundra
];

const D = d => d * Math.PI / 180;
const _q = [0, 0, 0], _t = [0, 0, 0], _v = [0, 0, 0], _m = [0, 0, 0];

// Planck colour of a black body at T kelvin, normalised to max channel 1
// (fit of the CIE result; good from 1000 K to 3000 K, which is all we use).
export function blackbody(T) {
  const t = T / 100;
  const r = 1;
  const g = clamp((99.47 * Math.log(t) - 161.12) / 255);
  const b = t <= 19 ? 0 : clamp((138.52 * Math.log(t - 10) - 305.04) / 255);
  return [r, g * g, b * b];
}

export function prepareRocky(P) {
  const seed = P.seed >>> 0;
  const S = k => (Math.imul(seed ^ 0x5bd1e995, 2654435761) + Math.imul(k, 40503)) | 0;
  const ctx = {
    P, kind: 'rocky',
    sWarp: S(1), sCont: S(2), sMtn: S(3), sEro: S(4), sTemp: S(5), sMoist: S(6), sCloud: S(7),
    sDune: S(8), sCrack: S(9), sRiver: S(10), sCity: S(11), sVar: S(12), sRay: S(13), sLava: S(14), sWind: S(15),
    terrainO: { freq: P.terrain.freq, octaves: P.terrain.octaves, lacunarity: P.terrain.lacunarity, gain: P.terrain.gain },
    terrainLo: { freq: P.terrain.freq, octaves: Math.min(3, P.terrain.octaves), lacunarity: P.terrain.lacunarity, gain: P.terrain.gain },
    terrainHi: { freq: P.terrain.freq * P.terrain.lacunarity ** 3, octaves: Math.max(0, P.terrain.octaves - 3), lacunarity: P.terrain.lacunarity, gain: P.terrain.gain },
    hiGain: P.terrain.gain ** 3 * 1.6,
    mtnO: { freq: P.mountains.freq, octaves: P.mountains.octaves, lacunarity: P.mountains.lacunarity, gain: P.mountains.gain },
    eroO: { freq: P.erosion.freq, octaves: P.erosion.octaves, lacunarity: 2.0, gain: 0.5 },
  };
  const rnd = mulberry(S(20));
  // plates: sites, continental (+1) or oceanic (-1) bias, drift vector
  const np = P.plates.count | 0;
  ctx.plates = [];
  for (let i = 0; i < np; i++) {
    const c = onSphere(rnd);
    const ocean = rnd() < P.plates.oceanic;
    const m = onSphere(rnd);
    // drift: tangent part of a random vector
    const d = m[0] * c[0] + m[1] * c[1] + m[2] * c[2];
    ctx.plates.push({ c, e: ocean ? -0.6 - 0.4 * rnd() : 0.5 + 0.5 * rnd(), m: [m[0] - d * c[0], m[1] - d * c[1], m[2] - d * c[2]] });
  }
  // the dichotomy axis: near a pole, tilted by a seeded angle
  const da = rnd() * Math.PI * 2, dt = 0.25 + 0.3 * rnd();
  ctx.dichAxis = [Math.sin(dt) * Math.cos(da), Math.cos(dt), Math.sin(dt) * Math.sin(da)];
  ctx.windDir = onSphere(rnd);
  // the cloud field at hour 0 (clouds.js; the view evolves it on the GPU)
  ctx.cloudSu = cloudSetup(P); ctx.cloudCyc = cyclones(ctx.cloudSu, 0);
  // crater heights are in km; height units span about 2 per P.relief km
  ctx.craterUPK = 2 / Math.max(P.relief, 0.5);
  ctx.craters = buildCraters(P, S(21));
  ctx.volcs = buildVolcanoes(P, S(22));
  // large landforms of dry worlds (geology.js; off unless P.features asks)
  ctx.geo = buildGeology(P, S(23), ctx.craters, ctx.craterUPK);
  // height range and sea level over Fibonacci points
  const N = 6000, pts = fibonacci(N), hs = new Float64Array(N), st = {};
  const p = [0, 0, 0];
  ctx.seaH = -Infinity;
  for (let i = 0; i < N; i++) { p[0] = pts[i * 3]; p[1] = pts[i * 3 + 1]; p[2] = pts[i * 3 + 2]; heightCore(ctx, p, st); hs[i] = st.h; }
  hs.sort();
  const q = f => hs[Math.min(N - 1, Math.max(0, Math.round(f * (N - 1))))];
  let lo = q(0), hi = q(1);
  // small, tall landforms (shield summits, canyon floors) can fall between
  // the Fibonacci points: sample them directly so they are not clipped
  for (const pt of geologyProbes(ctx.geo)) { heightCore(ctx, pt, st); lo = Math.min(lo, st.h); hi = Math.max(hi, st.h); }
  const pad = (hi - lo) * 0.08 + 1e-6;
  ctx.hMin = lo - pad; ctx.hMax = hi + pad;
  ctx.seaH = P.ocean.level > 0 ? q(P.ocean.level) : ctx.hMin - 1;
  // the datum of the lapse rate: the sea, or the median height when dry
  ctx.datum = P.ocean.level > 0 ? ctx.seaH : q(0.5);
  ctx.kmPerUnit = P.relief / (ctx.hMax - ctx.hMin);
  ctx.sample = (pp, out) => sampleRocky(ctx, pp, out);
  ctx.heightAt = pp => { heightCore(ctx, pp, st); return (st.h - ctx.hMin) / (ctx.hMax - ctx.hMin); };
  return ctx;
}

// ── craters ─────────────────────────────────────────────────────────────
// Radii come from the truncated power law; each crater gets an age in
// [0, 1] (1 = oldest). The list is sorted oldest first, so a lookup can
// lay craters in impact order: a new bowl erases the older relief inside
// it (overprint, which is how crater fields saturate).
//
// No two craters share a shape. Each crater draws, from its own seed:
//   rim     a radius warp of angle harmonics 2..6 (low-frequency noise
//           round the rim), and for about a third a polygon outline
//           (mostly hexagons, as on the Moon, where joints guide the
//           excavation)
//   shape   depth x 0.8..1.25, rim height x 0.65..1.35, a tilt of the rim
//           (asymmetry), a terrace phase that wanders with the angle
//           (slumped walls), a central peak cluster of 2..5 summits, and
//           how fast it softens with age (0.7..1.3)
//   oblique 8 % hit at a low angle: an ellipse (axis ratio to 1.7), the
//           ejecta in two lobes across the track (butterfly) or with an
//           uprange gap
// Craters over SEC_R spawn chains of secondaries (small, the same age).
// craterList() gives the primaries only, so the size-frequency test fits
// the primary power law. Small craters below rMin come from a cellular
// field (microCraters) whose octaves fade in with the map width, so a
// 4k map gets small craters, not a sharper copy of the 2k map.
const LEVELS = [96, 24, 6, 2];
const MARIA_AGE = 0.4;   // craters younger than this land on the flooded maria
const SEC_R = 0.07;      // parent radius (rad) for secondary chains
const TAU2 = Math.PI * 2;
function frame3(c) {
  const up = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let e = [up[1] * c[2] - up[2] * c[1], up[2] * c[0] - up[0] * c[2], up[0] * c[1] - up[1] * c[0]];
  const el = Math.hypot(e[0], e[1], e[2]); e = [e[0] / el, e[1] / el, e[2] / el];
  return [e, [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]]];
}
export function makeCrater(c, r, age, rnd, C, i) {
  const fresh = age < 0.06 && C.ejecta > 0;
  const [e, n] = frame3(c);
  // rim harmonics k = 2..6: amplitude falls as k^-1.3, larger on big
  // and old craters (slumps, later degradation)
  const A = (0.025 + 0.05 * rnd()) * (1 + 0.6 * age);
  const hc = new Float64Array(5), hs = new Float64Array(5);
  let sumA = 0;
  for (let k = 0; k < 5; k++) { const a = A * Math.pow(k + 2, -1.3) * (0.4 + rnd()), ph = rnd() * TAU2; hc[k] = a * Math.cos(ph); hs[k] = a * Math.sin(ph); sumA += a; }
  const poly = rnd() < 0.35 ? 0.3 + 0.4 * rnd() : 0, sides = rnd() < 0.7 ? 6 : 5 + Math.floor(rnd() * 3);
  const elong = rnd() < 0.08 ? 1.15 + 0.55 * rnd() : 1, axis = rnd() * TAU2;
  const ell = Math.sqrt(elong);
  // ejecta: oblique impacts lose the uprange side; the lowest angles
  // throw two lobes across the track (butterfly)
  const peaks = [];
  const np = 2 + Math.floor(rnd() * 4);
  for (let k = 0; k < np; k++) { const a = rnd() * TAU2, d = 0.13 * Math.sqrt(rnd()); peaks.push(d * Math.cos(a), d * Math.sin(a), 0.4 + 0.6 * rnd(), 0.05 + 0.05 * rnd()); }
  const reach = (fresh ? 7 : 2.6) * r * (1 + sumA + 0.08 * poly) * ell;
  return {
    c, r, age, fresh, reach, e, n, id: i, terr: 3 + Math.floor(rnd() * 3),
    hc, hs, poly, sides, pa: rnd() * TAU2, ell, ca: Math.cos(axis), sa: Math.sin(axis), but: elong > 1.4 ? 1 : 0, obl: elong > 1 ? 1 : 0,
    dm: 0.8 + 0.45 * rnd(), rm: 0.65 + 0.7 * rnd(), asym: 0.3 * rnd(), aa: rnd() * TAU2,
    tph: rnd() * TAU2, tamp: 0.2 + 0.3 * rnd(), soft: 0.7 + 0.6 * rnd(), peaks: new Float64Array(peaks), seed: (rnd() * 1e9) | 0,
  };
}
function buildCraters(P, seed) {
  const C = P.craters, n = Math.round(C.density * 9000);
  const rnd = mulberry(seed);
  const a = C.slope, rmin = Math.min(C.rMin, C.rMax * 0.95), rmax = C.rMax;
  const k = 1 - Math.pow(rmin / rmax, a);
  const list = [];
  for (let i = 0; i < n; i++) {
    const c = onSphere(rnd), u = rnd();
    const r = rmin * Math.pow(1 - u * k, -1 / a);
    // more old craters than young ones (the impact rate fell with time)
    const age = 1 - Math.pow(rnd(), 1.6);
    list.push(makeCrater(c, r, age, rnd, C, i));
  }
  // secondary chains: 1-4 radial chains of 4-9 small craters from 1.7 to
  // 4.5 radii out, a little younger than the parent (they land after it)
  const srnd = mulberry(seed ^ 0x2545f491);
  const nPrim = list.length;
  for (let i = 0; i < nPrim; i++) {
    const pc = list[i];
    if (pc.r < SEC_R) continue;
    const chains = 1 + Math.floor(srnd() * 4);
    for (let ch = 0; ch < chains; ch++) {
      const psi = srnd() * TAU2, d0 = (1.7 + 0.6 * srnd()) * pc.r, len = (1.2 + 1.6 * srnd()) * pc.r, m = 4 + Math.floor(srnd() * 6);
      const rs0 = pc.r * (0.03 + 0.04 * srnd());
      for (let j = 0; j < m; j++) {
        const t = j / Math.max(1, m - 1), d = d0 + len * t, w = (srnd() - 0.5) * 0.25 * pc.r;
        const dx = Math.cos(psi), dy = Math.sin(psi);
        const tx = pc.e[0] * dx + pc.n[0] * dy, ty = pc.e[1] * dx + pc.n[1] * dy, tz = pc.e[2] * dx + pc.n[2] * dy;
        const sx = -pc.e[0] * dy + pc.n[0] * dx, sy = -pc.e[1] * dy + pc.n[1] * dx, sz = -pc.e[2] * dy + pc.n[2] * dx;
        const cd = Math.cos(d), sd = Math.sin(d);
        let q = [pc.c[0] * cd + tx * sd + sx * w, pc.c[1] * cd + ty * sd + sy * w, pc.c[2] * cd + tz * sd + sz * w];
        const ql = Math.hypot(q[0], q[1], q[2]); q = [q[0] / ql, q[1] / ql, q[2] / ql];
        const cr = makeCrater(q, rs0 * (1 - 0.45 * t) * (0.7 + 0.6 * srnd()), Math.max(0, pc.age - 0.002 * srnd()), srnd, C, list.length);
        cr.fresh = false; cr.reach = 2.6 * cr.r * (1 + 0.2) * cr.ell; cr.sec = 1;
        list.push(cr);
      }
    }
  }
  list.sort((x, y) => y.age - x.age);
  list.forEach((cr, i) => { cr.ord = i; });
  // grids: a crater goes in the finest level whose cell is at least twice
  // its reach, so a lookup needs only the 2 x 2 x 2 cells nearest the point
  const grids = LEVELS.map(G => ({ G, cs: 2 / G, cells: new Map() }));
  const big = [];
  for (const cr of list) {
    const g = grids.find(gg => gg.cs >= 2 * cr.reach);
    if (!g) { big.push(cr); continue; }
    const ix = Math.floor((cr.c[0] + 1) / g.cs), iy = Math.floor((cr.c[1] + 1) / g.cs), iz = Math.floor((cr.c[2] + 1) / g.cs);
    const key = (ix * g.G + iy) * g.G + iz;
    let a2 = g.cells.get(key); if (!a2) g.cells.set(key, a2 = []);
    a2.push(cr);
  }
  return { list, grids, big };
}

// The radii of the primary crater field, for tests.mjs (size distribution).
export function craterList(P) { return craterSet(P).filter(c => !c.sec).map(c => c.r); }
// The whole crater list (primaries and secondaries), for tests.mjs.
export function craterSet(P) {
  const seed = P.seed >>> 0;
  const S = k => (Math.imul(seed ^ 0x5bd1e995, 2654435761) + Math.imul(k, 40503)) | 0;
  return buildCraters(P, S(21)).list;
}

// Crater shape in km against x = distance / radius (Pike 1977, Melosh 1989).
// D = 2 R km. Below the simple-to-complex diameter Dt (15 km on the Moon,
// scaled by 1 / gravity ~ 1 / radius) a crater is a parabolic bowl, depth
// 0.2 D, rim 0.04 D. Above it: depth 0.2 Dt (D / Dt)^0.3, a flat floor, a
// terraced wall, a central peak, and past 10 Dt a peak ring instead.
// age (0 fresh .. 1 old) lowers the rim, fills the floor and smooths the
// terraces. Outside the rim the ejecta blanket thins as x^-3.
// o (optional, craterField): dm, rm depth and rim factors, tph terrace
// phase shift (0..1 of a step), peak (0..1, the peak cluster height that
// craterField lays; undefined = the single central peak). With no o the
// shape is the reference profile (tests.mjs).
const _prof = { d: 0, xf: 0, complex: false };
export function craterProfile(x, Dkm, Dt, age, terr = 4, o) {
  const dm = o ? o.dm : 1, rm = o ? o.rm : 1;
  const deg = 1 - 0.55 * age;
  if (Dkm < Dt) {
    const d = 0.2 * Dkm * deg * dm, hr = 0.04 * Dkm * (1 - 0.6 * age) * rm;
    _prof.d = d; _prof.complex = false; _prof.xf = 0;
    if (x < 1) return -d + (d + hr) * x * x;
    return x < 3 ? hr * Math.pow(x, -3) * smooth(3, 2, x) : 0;
  }
  const d = 0.2 * Dt * Math.pow(Dkm / Dt, 0.3) * deg * dm, hr = 0.12 * d / deg * (1 - 0.6 * age) * rm / dm;
  const xf = Math.min(0.7, 0.4 + 0.08 * Math.log(Dkm / Dt + 1));
  _prof.d = d; _prof.complex = true; _prof.xf = xf;
  if (x < 1) {
    let h;
    if (x < xf) h = -d;
    else {
      // o.tph shifts the terrace steps inside the wall (0 at the floor and the rim)
      const sx = (x - xf) / (1 - xf), n = terr, f = sx * n + (o ? o.tph * Math.sin(Math.PI * sx) : 0), st = (Math.floor(f) + smooth(0.55, 1, f - Math.floor(f))) / n;
      const wall = mix(st, sx, 0.35 + 0.65 * age);
      h = -d + (d + hr) * Math.pow(wall, 1.6);
    }
    if (!o || o.peak === undefined) {
      if (Dkm < 10 * Dt) h += 0.45 * d * (1 - 0.7 * age) * Math.exp(-((x / (0.13 + 0.05 * age)) ** 2));
    }
    if (Dkm >= 10 * Dt) h += 0.3 * d * (1 - 0.7 * age) * Math.exp(-(((x - 0.5 * xf) / 0.07) ** 2));
    // old floors fill in (lava, slumps)
    return mix(h, Math.max(h, -0.45 * d), age);
  }
  return x < 3 ? hr * Math.pow(x, -3) * smooth(3, 2, x) : 0;
}

// One crater at point p (km of relief, before the depth scale upk and the
// rim factor). _ca gets x (distance / rim radius), ej (ejecta weight) and
// the angle (cs, sn) for craterField. tests.mjs calls it (craterProbe).
const _ca = { x: 0, ej: 1, cs: 1, sn: 0, D: 0 };
function craterAt(ctx, cr, p, ta, R, Dt) {
  const dx = p[0] - cr.c[0], dy = p[1] - cr.c[1], dz = p[2] - cr.c[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  // local tangent coordinates (u east-ish, v north-ish) and the angle
  const u = dx * cr.e[0] + dy * cr.e[1] + dz * cr.e[2], v = dx * cr.n[0] + dy * cr.n[1] + dz * cr.n[2];
  const ul = Math.hypot(u, v) || 1e-12, cs = u / ul, sn = v / ul;
  // the rim radius at this angle: harmonics, then the polygon
  let f = 1, ck = cs, sk = sn;
  for (let k = 0; k < 5; k++) {
    const c2 = ck * cs - sk * sn, s2 = sk * cs + ck * sn; ck = c2; sk = s2;   // angle (k + 2) theta
    f += cr.hc[k] * ck - cr.hs[k] * sk;
  }
  if (cr.poly > 0) {
    const seg = TAU2 / cr.sides, th = Math.atan2(sn, cs) - cr.pa;
    const t = th - seg * Math.round(th / seg), pf = Math.cos(Math.PI / cr.sides) / Math.cos(t);
    f *= 1 + cr.poly * (pf / (0.5 + 0.5 * Math.cos(Math.PI / cr.sides)) - 1);
  }
  // oblique craters: an ellipse along the track
  let dd = dist;
  if (cr.ell !== 1) { const a = u * cr.ca + v * cr.sa, b = -u * cr.sa + v * cr.ca; dd = Math.hypot(a / cr.ell, b * cr.ell); }
  const x = dd / (cr.r * f), D = 2 * cr.r * R;
  // ejecta directions: an uprange gap, or two lobes across the track
  const along = cs * cr.ca + sn * cr.sa;
  const ej = cr.obl ? (cr.but ? smooth(0.15, 0.6, Math.sqrt(Math.max(0, 1 - along * along))) : smooth(-0.95, -0.35, along)) : 1;
  // per-crater shape; the terrace phase and the rim height wander with the angle
  const tilt = 1 + cr.asym * (cs * Math.cos(cr.aa) + sn * Math.sin(cr.aa));
  _po.dm = cr.dm; _po.rm = cr.rm * tilt; _po.tph = cr.tamp * (0.5 + 0.5 * Math.sin(3 * Math.atan2(sn, cs) + cr.tph));
  const age = Math.min(1, cr.age * cr.soft);
  let prof = craterProfile(x, D, Dt, age, cr.terr, _po);
  if (x >= 1) prof *= ej;
  // central peak cluster (complex craters below the peak-ring size)
  if (_prof.complex && D < 10 * Dt && x < 0.4) {
    const pu = u / cr.r, pv = v / cr.r, pk = cr.peaks;
    let s = 0;
    for (let k = 0; k < pk.length; k += 4) { const ex = pu - pk[k], ey = pv - pk[k + 1], w = pk[k + 3] * (1 + 0.6 * age); s += pk[k + 2] * Math.exp(-(ex * ex + ey * ey) / (w * w)); }
    prof += 0.45 * _prof.d * (1 - 0.7 * age) * Math.min(1.2, s);
  }
  // floor hummocks and rim texture where the crater spans many texels
  if (ta > 0 && cr.r > 6 * ta) {
    if (_prof.complex && x < _prof.xf + 0.05) {
      CR_O.freq = 7 / cr.r;
      prof += 0.07 * _prof.d * (1 - 0.5 * age) * fbm(p, CR_O, cr.seed);
    } else if (x > 0.8 && x < 1.5) {
      const nz = simplex3(p[0] * 14 / cr.r, p[1] * 14 / cr.r, p[2] * 14 / cr.r, cr.seed + 7);
      // a third of the rim height (0.04 D on bowls, 0.12 d on complex craters)
      const rimH = _prof.complex ? 0.12 * _prof.d : 0.2 * _prof.d;
      prof += 0.3 * rimH * cr.rm * (1 - 0.6 * age) * nz * smooth(1.5, 1.0, x) * smooth(0.8, 0.95, x);
    }
  }
  _ca.x = x; _ca.ej = ej; _ca.cs = cs; _ca.sn = sn; _ca.D = D;
  return prof;
}
// The rim radius factor of crater cr at angle th (round the centre, in its
// e/n frame), for tests.mjs.
export function rimFactor(cr, th) {
  const cs = Math.cos(th), sn = Math.sin(th);
  let f = 1, ck = cs, sk = sn;
  for (let k = 0; k < 5; k++) { const c2 = ck * cs - sk * sn, s2 = sk * cs + ck * sn; ck = c2; sk = s2; f += cr.hc[k] * ck - cr.hs[k] * sk; }
  if (cr.poly > 0) {
    const seg = TAU2 / cr.sides, t0 = th - cr.pa, t = t0 - seg * Math.round(t0 / seg), pf = Math.cos(Math.PI / cr.sides) / Math.cos(t);
    f *= 1 + cr.poly * (pf / (0.5 + 0.5 * Math.cos(Math.PI / cr.sides)) - 1);
  }
  return f;
}
// The relief (km) of crater cr alone at point p, for tests.mjs.
export function craterProbe(ctx, cr, p) {
  const R = ctx.P.radiusKm;
  return craterAt(ctx, cr, p, texelAngle(), R, 15 * 1737 / R);
}

const _cands = [];
const _po = { dm: 1, rm: 1, tph: 0, peak: 1 };
const CR_O = { freq: 1, octaves: 2, lacunarity: 2.3, gain: 0.5 };
function craterField(ctx, p, st) {
  st.cOld = 0; st.cYoung = 0; st.rays = 0; st.floor = 0; st.cInside = 0; st.blanket = 0;
  const F = ctx.craters;
  if (!F.list.length) return;
  _cands.length = 0;
  const p0 = p[0] + 1, p1 = p[1] + 1, p2 = p[2] + 1;
  for (const g of F.grids) {
    if (!g.cells.size) continue;
    const fx = p0 / g.cs, fy = p1 / g.cs, fz = p2 / g.cs;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    // the two cells per axis nearest the point (cell >= 2 x reach)
    const ax = fx - ix < 0.5 ? -1 : 1, by = fy - iy < 0.5 ? -1 : 1, cz = fz - iz < 0.5 ? -1 : 1;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
      const arr = g.cells.get(((ix + a * ax) * g.G + iy + b * by) * g.G + iz + c * cz);
      if (arr) for (let q = 0; q < arr.length; q++) {
        const cr = arr[q];
        const dx = p[0] - cr.c[0], dy = p[1] - cr.c[1], dz = p[2] - cr.c[2];
        if (dx * dx + dy * dy + dz * dz < cr.reach * cr.reach) _cands.push(cr);
      }
    }
  }
  for (const cr of F.big) { const dx = p[0] - cr.c[0], dy = p[1] - cr.c[1], dz = p[2] - cr.c[2]; if (dx * dx + dy * dy + dz * dz < cr.reach * cr.reach) _cands.push(cr); }
  // impact order (insertion sort: the list is short)
  for (let i = 1; i < _cands.length; i++) { const v = _cands[i]; let j = i - 1; while (j >= 0 && _cands[j].ord > v.ord) { _cands[j + 1] = _cands[j]; j--; } _cands[j + 1] = v; }
  const C = ctx.P.craters, R = ctx.P.radiusKm, Dt = 15 * 1737 / R, upk = ctx.craterUPK * C.depth;
  const ta = texelAngle();
  for (let q = 0; q < _cands.length; q++) {
    const cr = _cands[q];
    let prof = craterAt(ctx, cr, p, ta, R, Dt);
    const x = _ca.x, ej = _ca.ej, cs = _ca.cs, sn = _ca.sn, D = _ca.D;
    prof *= upk * (x < 1 ? 1 : C.rim);
    // overprint: inside the new bowl the older crater relief is erased
    const erase = smooth(1.05, 0.75, x) * 0.92;
    if (cr.age >= MARIA_AGE) st.cOld = st.cOld * (1 - erase) + prof;
    else { st.cOld *= 1 - erase; st.cYoung = st.cYoung * (1 - erase) + prof; }
    if (x < 1) st.floor = Math.max(st.floor, smooth(1, 0.75, x) * (cr.age > 0.6 && D > 6 * Dt ? 1 : 0));
    if (x < 1.05) st.cInside = Math.max(st.cInside, smooth(1.05, 0.8, x) * Math.max(0, 1 - cr.age * 4));
    if (x > 1 && x < 2.5 && cr.age < 0.25) st.blanket = Math.max(st.blanket, smooth(2.5, 1.1, x) * (1 - cr.age / 0.25) * ej);
    if (cr.fresh && x > 0.9) {
      // rays: angle round the centre, noise in angle, fading with distance,
      // broken into streaks by a second noise along the ray
      const rn = simplex3(cs * 4.5, sn * 4.5, cr.id * 1.37 + x * 0.15, ctx.sRay);
      const brk = smooth(-0.2, 0.45, simplex3(cs * 11, sn * 11, cr.id * 2.1 + x * 0.9, ctx.sRay + 1));
      const ray = smooth(0.15, 0.7, rn) * brk * Math.exp(-(x - 1) / 2.2) * smooth(7, 4, x) * ej;
      st.rays = Math.max(st.rays, C.ejecta * (1 - cr.age / 0.06) * ray);
    }
  }
  if (ta > 0) microCraters(ctx, p, st, ta, upk, R, Dt);
}

// Small craters below rMin: a cellular field on the sphere (worley3).
// Octave k has cells of size cs = 3 rMin / 2^k; each cell holds one
// crater of radius 0.12..0.38 cs (a third of the cells are empty). An
// octave fades in when its craters span 1.2-2.5 texels (texelAngle), so a
// wider map shows the next octave. Fresh bowls with low rims, no rays.
const _wo = [0, 0, 0];
function microCraters(ctx, p, st, ta, upk, R, Dt) {
  const C = ctx.P.craters;
  let cs = 3 * Math.min(C.rMin, C.rMax * 0.95);
  let add = 0;
  for (let k = 0; k < 4; k++, cs *= 0.5) {
    const rTyp = 0.25 * cs, vis = smooth(1.2, 2.5, rTyp / ta);
    if (vis <= 0) break;
    const f = 1 / cs;
    worley3(p[0] * f, p[1] * f, p[2] * f, ctx.sRay + 101 + k * 17, _wo);
    const hsh = _wo[2] >>> 0;
    if ((hsh & 7) < 3) continue;
    const r = (0.12 + 0.26 * ((hsh >>> 3) & 255) / 255) * cs, x = _wo[0] * cs / r;
    if (x >= 2) continue;
    const age = ((hsh >>> 11) & 255) / 255;
    _po.dm = 0.8 + 0.4 * ((hsh >>> 19) & 15) / 15; _po.rm = 0.8; _po.tph = 0;
    add += vis * craterProfile(x, 2 * r * R, Dt, 0.3 + 0.7 * age, 3, _po) * upk;
  }
  st.cYoung += add;
}
// The small-crater relief at p for a map of width W, for tests.mjs.
export function microProbe(ctx, p, W) {
  const R = ctx.P.radiusKm, st = { cYoung: 0 };
  microCraters(ctx, p, st, Math.PI / (8 * (W / 16)), ctx.craterUPK * ctx.P.craters.depth, R, 15 * 1737 / R);
  return st.cYoung;
}

// Volcanic calderas (paterae): dark floors, some with a plume ring.
function buildVolcanoes(P, seed) {
  const rnd = mulberry(seed), out = [];
  for (let i = 0; i < (P.volcanoes.count | 0); i++) {
    const c = onSphere(rnd);
    out.push({ c, r: 0.008 + 0.03 * rnd() ** 2, plume: rnd() < 0.18 ? 3.5 + 3 * rnd() : 0, heat: rnd() });
  }
  return out;
}
function volcanoField(ctx, p, st) {
  st.vDark = 0; st.vRing = 0; st.vHot = 0; st.vH = 0;
  for (const v of ctx.volcs) {
    const dx = p[0] - v.c[0], dy = p[1] - v.c[1], dz = p[2] - v.c[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz), x = d / v.r;
    if (x < 1.3) { const f = smooth(1.15, 0.85, x); st.vDark = Math.max(st.vDark, f); st.vH -= 0.02 * f; }
    if (x < 0.35) st.vHot = Math.max(st.vHot, smooth(0.35, 0.05, x) * (0.4 + 0.6 * v.heat));
    if (v.plume && x < v.plume * 1.25) st.vRing = Math.max(st.vRing, Math.exp(-(((x - v.plume) / (0.22 * v.plume)) ** 2)));
  }
}

// ── height ──────────────────────────────────────────────────────────────
// Lineae: half width LINE_W / freq rad (0.05 of a noise unit at the median
// gradient 2.15 of simplex3 near 0), at least LINE_MIN map texels.
const LINE_W = 0.05 / 2.15, LINE_MIN = 0.8, CW_K = [1.2, 2.6];
const _g = [0, 0, 0];
// _cw: [qx, qy, qz, J (3 x 3, row-major)] of the crack warp
// q = p + A sum_o 0.5^o (s_o1, s_o2, s_o3)(p k_o), two octaves.
const _cw = new Float64Array(12);
function crackWarp(p, A, seed) {
  _cw[0] = p[0]; _cw[1] = p[1]; _cw[2] = p[2];
  for (let r = 0; r < 9; r++) _cw[3 + r] = r % 4 === 0 ? 1 : 0;
  for (let o = 0; o < 2; o++) {
    const k = CW_K[o], a = A * (o ? 0.5 : 1);
    for (let c = 0; c < 3; c++) {
      const v = simplex3(p[0] * k, p[1] * k, p[2] * k, seed + c * 31 + o * 7, _g);
      _cw[c] += a * v;
      _cw[3 + c * 3] += a * k * _g[0]; _cw[4 + c * 3] += a * k * _g[1]; _cw[5 + c * 3] += a * k * _g[2];
    }
  }
}
// Distance (rad) from p to the zero set of simplex(q f) on the warp w:
// grad_p = f J^T g, taken along the sphere (the radial part does not
// move the line).
function lineDist(w, f, seed, p) {
  const n = simplex3(w[0] * f, w[1] * f, w[2] * f, seed, _g);
  const gx = f * (w[3] * _g[0] + w[6] * _g[1] + w[9] * _g[2]);
  const gy = f * (w[4] * _g[0] + w[7] * _g[1] + w[10] * _g[2]);
  const gz = f * (w[5] * _g[0] + w[8] * _g[1] + w[11] * _g[2]);
  const r = gx * p[0] + gy * p[1] + gz * p[2];
  const gt = Math.hypot(gx - r * p[0], gy - r * p[1], gz - r * p[2]);
  return Math.abs(n) / Math.max(gt, 0.05 * f);
}
function heightCore(ctx, p, st) {
  const P = ctx.P;
  warp(p, P.terrain.warp, P.terrain.warpFreq, ctx.sWarp, _q);
  // continents: the low octaves on the warped point, the fine octaves on
  // the plain point (warped fine octaves comb into hair-like streaks)
  const c = (fbm(_q, ctx.terrainLo, ctx.sCont) + (ctx.terrainHi.octaves > 0 ? fbm(p, ctx.terrainHi, ctx.sCont + 77) * ctx.hiGain : 0)) * P.terrain.amp;
  let h = c, uplift = 0, rift = 0, pe = 0;
  const pl = ctx.plates;
  if (pl.length > 1) {
    // nearest two plate sites, using the warped point for ragged edges
    const ql = Math.hypot(_q[0], _q[1], _q[2]) || 1;
    const qx = _q[0] / ql, qy = _q[1] / ql, qz = _q[2] / ql;
    let d1 = 9, d2 = 9, i1 = 0, i2 = 0;
    for (let i = 0; i < pl.length; i++) {
      const s = pl[i].c, ex = qx - s[0], ey = qy - s[1], ez = qz - s[2], d = ex * ex + ey * ey + ez * ez;
      if (d < d1) { d2 = d1; i2 = i1; d1 = d; i1 = i; } else if (d < d2) { d2 = d; i2 = i; }
    }
    d1 = Math.sqrt(d1); d2 = Math.sqrt(d2);
    const A = pl[i1], B = pl[i2];
    const w = P.plates.width, edge = d2 - d1;
    const bnd = 1 - smooth(0, w, edge);
    pe = mix((A.e + B.e) * 0.5, A.e, smooth(0, w * 1.5, edge));
    // convergence: relative drift along the line between the sites
    let lx = B.c[0] - A.c[0], ly = B.c[1] - A.c[1], lz = B.c[2] - A.c[2];
    const ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
    const conv = (A.m[0] - B.m[0]) * lx + (A.m[1] - B.m[1]) * ly + (A.m[2] - B.m[2]) * lz;
    uplift = bnd * Math.max(conv, 0) * P.plates.uplift;
    rift = bnd * Math.max(-conv, 0);
    h += pe * P.plates.weight + uplift * 0.45 + rift * 0.12 * P.plates.weight * (A.e < 0 && B.e < 0 ? 1 : -1.5);
  }
  if (P.terrain.dichotomy > 0) {
    const ax = ctx.dichAxis, t = p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2];
    h -= P.terrain.dichotomy * 0.45 * smooth(-0.35, 0.45, t + 0.12 * simplex3(p[0] * 2, p[1] * 2, p[2] * 2, ctx.sVar));
  }
  const mmask = clamp(uplift * 1.3 + smooth(0.05, 0.55, c + pe * P.plates.weight) * 0.55);
  // ranges follow the warped plates only partly: a fully warped ridged field
  // reads as marble swirls, not as mountain ranges
  _m[0] = p[0] + 0.35 * (_q[0] - p[0]); _m[1] = p[1] + 0.35 * (_q[1] - p[1]); _m[2] = p[2] + 0.35 * (_q[2] - p[2]);
  const r = P.mountains.amp > 0 ? ridged(_m, ctx.mtnO, ctx.sMtn, P.mountains.sharpness) : 0;
  h += P.mountains.amp * mmask * r;
  st.mtn = mmask * r; st.mmask = mmask; st.c = c; st.uplift = uplift; st.rift = rift;
  // terraces (mesas and benches of flat-lying layers): flat treads, steep risers
  st.riser = 0;
  if (P.terrain.terraces > 0) {
    const n = 7 + 5 * P.terrain.terraces, q = h * n + 0.3 * simplex3(p[0] * 5, p[1] * 5, p[2] * 5, ctx.sVar + 5), f = Math.floor(q);
    const sr = smooth(0.55, 0.85, q - f);
    h = mix(h, (f + sr) / n, P.terrain.terraces);
    st.riser = 4 * sr * (1 - sr) * P.terrain.terraces;
  }
  // basins, shields, the canyon, caps (geology.js); their floors are smooth
  let calm = 1;
  if (ctx.geo.on) { h += geologyHeight(ctx.geo, p, st); calm = 1 - 0.7 * st.basinFloor - 0.5 * st.cFloor; }
  else { st.basinFloor = 0; st.shield = 0; st.summit = 0; st.flows = 0; st.cFloor = 0; st.cWall = 0; st.streak = 0; st.capIce = 0; st.capTrough = 0; }
  const e = P.erosion.detail > 0 ? fbmEroded(p, ctx.eroO, ctx.sEro, P.erosion.strength) : 0;
  h += P.erosion.detail * e * (0.35 + mmask) * calm;
  // dunes: crests across a seeded wind, bent by low noise, only in dry basins
  st.dune = 0;
  if (P.dunes.amount > 0) {
    const w = ctx.windDir, f = P.dunes.freq;
    const ph = (p[0] * w[0] + p[1] * w[1] + p[2] * w[2]) * f + 3 * simplex3(p[0] * 3, p[1] * 3, p[2] * 3, ctx.sDune);
    const s = 1 - Math.abs(Math.sin(ph));
    const dune = s * s * (0.6 + 0.4 * simplex3(p[0] * f * 0.3, p[1] * f * 0.3, p[2] * f * 0.3, ctx.sDune + 1));
    const basin = smooth(0.35, 0.0, st.mtn) * smooth(0.3, -0.2, c);
    st.dune = dune * basin * P.dunes.amount;
    h += 0.035 * st.dune;
  }
  // cracks / lineae: the zero sets of two noise fields, raised as double
  // ridges. The lines run on their own smooth warp (crackWarp), whose
  // Jacobian is known, so the distance to a zero set is |n| / |grad n|
  // with the full gradient along the sphere. A line keeps one width along
  // its length, at least LINE_MIN map texels: it never breaks into dots
  // where the noise is steep, the warp folds, or the map is coarse.
  st.crack = 0;
  if (P.cracks.amount > 0) {
    const f = P.cracks.freq, tx = texelAngle();
    crackWarp(p, 0.05 + 0.3 * P.terrain.warp, ctx.sCrack + 9);
    const d1 = lineDist(_cw, f, ctx.sCrack, p), d2 = lineDist(_cw, f * 2.3, ctx.sCrack + 5, p);
    // the width swells and thins along a line (a low noise, 0.45..1.25)
    const sw = 0.85 + 0.4 * simplex3(p[0] * 4, p[1] * 4, p[2] * 4, ctx.sCrack + 3);
    // a line thinner than LINE_MIN texels is drawn LINE_MIN wide and dimmer
    // by the same ratio (its coverage), so a small map is not brighter
    const t1 = sw * LINE_W / f, t2 = sw * 0.67 * LINE_W / (2.3 * f);
    const w1 = Math.max(t1, LINE_MIN * tx), w2 = Math.max(t2, LINE_MIN * tx);
    const e = 0.5 * tx;
    const l = Math.max(smooth(w1 + e, 0, d1) * t1 / w1, 0.7 * smooth(w2 + e, 0, d2) * t2 / w2);
    st.crack = l * P.cracks.amount;
    const wc = Math.max(0.25 * LINE_W / f, 0.5 * tx);
    h += 0.02 * st.crack - 0.035 * smooth(wc + e, 0.0, d1) * P.cracks.amount;
  }
  volcanoField(ctx, p, st); h += st.vH;
  // craters in impact order: the old ones, then the maria flood, then the
  // young ones on top of the flooded plains
  craterField(ctx, p, st); h += st.cOld;
  st.maria = 0;
  if (P.craters.maria > 0) {
    const low = smooth(-0.05, -0.35, c + 0.15 * simplex3(p[0] * 4, p[1] * 4, p[2] * 4, ctx.sVar + 3));
    st.maria = clamp(Math.max(st.floor, low) * P.craters.maria);
    h = mix(h, Math.min(h, -0.25 * P.terrain.amp), st.maria * 0.85);
  }
  h += st.cYoung;
  st.h = h;
}

// ── colour and materials ───────────────────────────────────────────────
function biome(T, M, out) {
  let wr = 0, wg = 0, wb = 0, ws = 0;
  for (const b of BIOMES) {
    const dt = (T - b[0]) / 7, dm = (M - b[1]) / 0.14;
    const w = Math.exp(-(dt * dt + dm * dm));
    wr += w * b[2][0]; wg += w * b[2][1]; wb += w * b[2][2]; ws += w;
  }
  ws = ws || 1;
  out[0] = wr / ws; out[1] = wg / ws; out[2] = wb / ws;
  return out;
}
const lerp3 = (o, a, b, t) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };
const mixIn = (o, b, t) => { o[0] += (b[0] - o[0]) * t; o[1] += (b[1] - o[1]) * t; o[2] += (b[2] - o[2]) * t; };

const _w1 = [0, 0, 0], _w2 = [0, 0, 0], _cf = {}, _st = {}, _col = [0, 0, 0], _bio = [0, 0, 0], _bar = [0, 0, 0], _cp = [0, 0, 0];
const VAR_O = { freq: 7, octaves: 4, lacunarity: 2.2, gain: 0.5 };
const MOIST_O = { freq: 2.2, octaves: 4, lacunarity: 2.1, gain: 0.5 };
const CITY_O = { freq: 16, octaves: 3, lacunarity: 2.3, gain: 0.5 };
const SULF_O = { freq: 2.5, octaves: 4, lacunarity: 2.2, gain: 0.55 };

// out: { h (0..1), r, g, b (0..1 sRGB), rough, metal, spec, er, eg, eb, night, cloud, fu, fv, fb }
function sampleRocky(ctx, p, out) {
  const P = ctx.P, st = _st, pal = P.palette;
  heightCore(ctx, p, st);
  const hn = (st.h - ctx.hMin) / (ctx.hMax - ctx.hMin);
  out.h = clamp(hn);
  const hk = (st.h - ctx.datum) * ctx.kmPerUnit;      // km above the sea (or the median)
  const lat = Math.asin(clamp(p[1], -1, 1));
  const sl = Math.sin(lat);
  const tn = simplex3(p[0] * 3, p[1] * 3, p[2] * 3, ctx.sTemp);
  let T = P.climate.equatorC + (P.climate.poleC - P.climate.equatorC) * Math.pow(Math.abs(sl), 3) + 4 * tn - P.climate.lapse * Math.max(hk, 0);
  const wet = P.ocean.level > 0 && P.ocean.liquid === 0;
  let M = 0.5 + 0.28 * Math.cos(6 * lat) + 0.38 * fbm(p, MOIST_O, ctx.sMoist);
  if (wet) M += 0.25 * smooth(1.2, 0, hk);            // coasts and lowlands are wetter
  M -= 0.25 * st.mtn;                                  // rain shadow on ranges
  M = clamp(M * P.climate.moisture * 2 - (1 - P.climate.moisture) * 0.15 + 0.5 * (P.climate.moisture - 0.5));
  const vary = fbm(p, VAR_O, ctx.sVar);
  out.er = 0; out.eg = 0; out.eb = 0; out.night = 0; out.metal = 0; out.snow = 0;

  const polarOnly = (P.ocean.liquid | 0) === 2 ? smooth(0.75, 1.0, Math.abs(lat) + 0.15 * vary) : 1;
  if (hk < 0 && P.ocean.level > 0 && polarOnly > 0.5) {
    // ── liquid ──
    const depth = -hk;
    const liq = P.ocean.liquid | 0;
    if (liq === 1) {
      // lava sea: plates of dark basalt crust (Worley cells at two scales)
      // broken by glowing cracks; the crust is thin and hot near the
      // shore rifts and where the seed's hot spots sit
      worley3(p[0] * 7, p[1] * 7, p[2] * 7, ctx.sLava, _w1);
      worley3(p[0] * 17, p[1] * 17, p[2] * 17, ctx.sLava + 1, _w2);
      const wob = 0.04 * simplex3(p[0] * 40, p[1] * 40, p[2] * 40, ctx.sLava + 2);
      // F2 - F1 is about twice the distance to the plate edge (in cells),
      // so a crack is at least 1.3 map texels wide at any map width
      // (dimmer by the width ratio when widened: the same coverage)
      const tx = texelAngle(), k1 = Math.max(0.09, 2.6 * 7 * tx), k2 = Math.max(0.1, 2.6 * 17 * tx);
      const crack1 = smooth(k1, 0.0, _w1[1] - _w1[0] + wob) * 0.09 / k1, crack2 = smooth(k2, 0.0, _w2[1] - _w2[0] + wob * 0.6) * 0.8 * 0.1 / k2;
      const hot = smooth(0.2, 0.7, 0.5 + 0.5 * fbm(p, VAR_O, ctx.sLava + 3)) * 0.6 + smooth(0.6, 0.0, depth) * 0.4;
      const open = clamp(Math.max(crack1, crack2 * (0.35 + 0.65 * hot)) + hot * 0.12);
      const plateTone = 0.75 + 0.5 * ((_w1[2] >>> 8) & 255) / 255;
      _col[0] = pal.dark[0] * plateTone; _col[1] = pal.dark[1] * plateTone; _col[2] = pal.dark[2] * plateTone;
      mixIn(_col, [0.32, 0.09, 0.03], open);
      const bb = blackbody(1050 + 350 * open);
      // the crust itself is warm: a dull red floor (0.05 at 900 K) keeps
      // the sea apart from the black land at night
      const g = open * open * 1.6 + 0.05 * (0.6 + 0.4 * hot);
      out.er = bb[0] * g; out.eg = bb[1] * g * (0.3 + 0.7 * open); out.eb = bb[2] * g * open;
      out.rough = mix(0.9, 0.4, open); out.spec = 0.45;
    } else if (liq === 2) {
      lerp3(_col, pal.shallow, pal.deep, 1 - Math.exp(-depth / 0.15));
      out.rough = 0.05; out.spec = 0.2;
    } else {
      lerp3(_col, pal.shallow, pal.deep, 1 - Math.exp(-depth / 1.2));
      // shelf turquoise in the first tens of metres
      mixIn(_col, pal.beach, 0.25 * Math.exp(-depth / 0.05));
      out.rough = 0.07 + 0.08 * clamp(0.5 + 0.5 * simplex3(p[0] * 9, p[1] * 9, p[2] * 9, ctx.sWind));
      out.spec = 0.25;   // F0 = 0.02 (water)
      // sea ice
      if (T < P.climate.iceC + 3) {
        const ice = smooth(P.climate.iceC + 2, P.climate.iceC - 4, T + 3 * vary);
        mixIn(_col, pal.ice, ice * 0.92);
        out.rough = mix(out.rough, 0.45, ice); out.spec = mix(out.spec, 0.23, ice);
      }
    }
  } else {
    // ── land ──
    const hl = clamp(hk / Math.max(1, P.relief * 0.5));
    lerp3(_bar, pal.low, pal.high, smooth(0.0, 1.0, hl + 0.25 * vary));
    mixIn(_bar, pal.rock, smooth(0.15, 0.55, st.mtn));
    const v = 1 + 0.18 * vary;
    _bar[0] *= v; _bar[1] *= v; _bar[2] *= v;
    let rough = 0.88, spec = 0.5;
    if (P.climate.life > 0 && T > -15 && T < 45 && wet) {
      biome(T, M, _bio);
      const grow = P.climate.life * smooth(-14, -4, T) * smooth(45, 35, T) * smooth(0.6, 0.25, st.mtn);
      lerp3(_col, _bar, _bio, grow);
      // beaches
      mixIn(_col, pal.beach, smooth(0.12, 0.0, hk) * (0.3 + 0.3 * smooth(0.0, 0.3, M)));
      rough = mix(0.88, 0.78, grow);
    } else {
      _col[0] = _bar[0]; _col[1] = _bar[1]; _col[2] = _bar[2];
      if (P.dunes.amount > 0) { mixIn(_col, pal.bright, st.dune * 0.35); rough = mix(rough, 0.95, smooth(0, 0.3, st.dune)); }
    }
    // landforms: provinces, basin plains, shields, canyon floors, strata, streaks
    if (ctx.geo.on) geologyColour(ctx.geo, p, st, pal, _col, hn);
    // maria, craters, rays
    if (st.maria > 0) mixIn(_col, pal.dark, st.maria * 0.85);
    // fresh craters are bright (unweathered rock), their blankets less so;
    // rays only on the youngest
    if (st.cInside > 0) mixIn(_col, pal.bright, st.cInside * 0.35);
    if (st.blanket > 0) mixIn(_col, pal.bright, st.blanket * 0.2);
    if (st.rays > 0) mixIn(_col, pal.bright, clamp(st.rays) * 0.6);
    // volcanic moons: surface deposits, calderas, plume rings, hot vents
    if (ctx.volcs.length) {
      const s1 = fbm(p, SULF_O, ctx.sVar + 7);
      mixIn(_col, pal.accent, smooth(0.1, 0.45, s1) * 0.7);
      mixIn(_col, pal.bright, smooth(-0.15, -0.45, s1) * 0.6);
      mixIn(_col, pal.rock, smooth(0.55, 0.85, Math.abs(lat) / (Math.PI / 2)) * 0.5);
      mixIn(_col, pal.ring || [0.62, 0.22, 0.08], st.vRing * 0.65);
      mixIn(_col, pal.dark, st.vDark * 0.9);
      if (st.vHot > 0 && P.volcanoes.glow > 0) {
        const bb = blackbody(1500), g = st.vHot * P.volcanoes.glow * 4;
        out.er += bb[0] * g; out.eg += bb[1] * g; out.eb += bb[2] * g;
      }
      rough = mix(rough, 0.7, st.vDark);
    }
    // snow: only the potential from temperature (latitude, altitude by the
    // lapse rate). maps.js finish lays it where the slope holds it.
    if (T < P.climate.iceC + 6) out.snow = smooth(P.climate.iceC + 2, P.climate.iceC - 5, T + 4 * vary);
    // structured polar caps replace the temperature caps (geology.js)
    if (ctx.geo.caps) out.snow = st.capIce;
    // city lights at night: temperate, wet, lowland, clustered near coasts
    if (P.climate.cities > 0 && P.climate.life > 0) {
      const hab = smooth(-2, 8, T) * smooth(32, 24, T) * smooth(0.12, 0.35, M) * smooth(2.5, 0.2, hk) * smooth(0.4, 0.1, st.mtn);
      if (hab > 0) {
        const n = fbm(p, CITY_O, ctx.sCity);
        const dots = smooth(0.35, 0.85, simplex3(p[0] * 140, p[1] * 140, p[2] * 140, ctx.sCity + 2));
        const pop = hab * smooth(0.1, 0.5, n) * (0.15 + 0.85 * dots) * P.climate.cities * 0.45;
        out.er += 1.0 * pop * 0.9; out.eg += 0.72 * pop * 0.9; out.eb += 0.38 * pop * 0.9;
        out.night = pop > 0.01 ? 1 : 0;
      }
    }
    out.rough = rough; out.spec = spec;
  }
  // cracks (land and frozen sea): dark reddish lineae, glowing on lava worlds
  if (st.crack > 0) {
    mixIn(_col, pal.accent, clamp(st.crack) * 0.7);
    if (P.cracks.glow > 0) {
      // the glow fades under the ranges by the smooth range mask, not by the
      // ridged relief (that cut the lines into dashes)
      const bb = blackbody(1400), g = clamp(st.crack) * P.cracks.glow * 2.4 * smooth(0.75, 0.15, st.mmask);
      out.er += bb[0] * g; out.eg += bb[1] * g; out.eb += bb[2] * g;
    }
  }
  out.r = clamp(_col[0]); out.g = clamp(_col[1]); out.b = clamp(_col[2]);
  out.cloud = P.clouds.cover > 0 ? cloudField(ctx.cloudSu, p, 0, ctx.cloudCyc, _cf).deck : 0;
  out.fu = 0.5; out.fv = 0.5; out.fb = 0;
  return out;
}

// Rodrigues rotation of v about unit axis k by angle a (in place).
export function rotateAbout(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), d = (k[0] * v[0] + k[1] * v[1] + k[2] * v[2]) * (1 - c);
  const x = v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d;
  const y = v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d;
  const z = v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d;
  v[0] = x; v[1] = y; v[2] = z;
}

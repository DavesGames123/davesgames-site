// ============================================================================
//  PLANET FORGE  ·  rocky.js — the terrestrial generator (no DOM)
// ----------------------------------------------------------------------------
//  prepareRocky(P) builds everything that does not depend on the texel: the
//  derived seeds, the plates, the crater fields, the calderas and the height
//  range. ctx.sample(p, out) then gives one texel at the unit vector p.
//
//  HEIGHT (heightCore), in order
//    1. q = warp(p)                     two-level domain warp of the input
//    2. c = fbm(q)                      continents
//    3. plates: nearest two of N seeded Voronoi sites on the sphere. Each
//       plate is continental or oceanic and has a drift vector. Where two
//       plates converge, the boundary lifts (uplift); where they part, it
//       sinks (rift). A small dichotomy term lowers one hemisphere (Mars).
//    4. mountains = ridged(q) * mask    mask = uplift + high continent
//    5. detail = fbmEroded(p)           derivative-damped fBm: less detail on
//                                       steep slopes, so slopes read eroded
//    6. dunes, cracks (lineae), calderas, craters
//  The sea level is the quantile of the height at ocean.level over 6000
//  Fibonacci points, so it does not depend on the map size.
//
//  CRATERS  a truncated power law N(>r) ~ r^-alpha from rMin to rMax. Each
//  crater has an age: young ones keep sharp rims and bright rays, old ones
//  are shallow and soft, and old large ones fill with dark maria. Lookups
//  go through three uniform grids on [-1, 1]^3 (cell >= influence radius)
//  plus a short brute-force list for the largest.
//
//  COLOUR  temperature T = equator..pole by sin^2(lat), minus the lapse rate
//  times the height above the sea. Moisture M = Hadley pattern cos(6 lat)
//  + noise + coast. Biomes are a soft Whittaker lookup in (T, M). Ice
//  where T < iceC (land and sea). Barren worlds use the palette ramp.
//
//  grep -n targets: "export function prepareRocky", "function heightCore",
//  "function craterField", "function buildCraters", "function shade",
//  "function cloudAlpha", "const BIOMES", "export function craterList"
// ============================================================================
import { fbm, fbmEroded, ridged, warp, simplex3, mulberry, onSphere, fibonacci, clamp, mix, smooth, curl } from './noise.js';

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
const _q = [0, 0, 0], _t = [0, 0, 0], _v = [0, 0, 0];

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
  // cyclones for the cloud layer: mid-latitude centres, hemisphere spin
  ctx.cyclones = [];
  for (let i = 0; i < (P.clouds.cyclones | 0); i++) {
    const lat = D(20 + 45 * rnd()) * (rnd() < 0.5 ? -1 : 1), lon = rnd() * Math.PI * 2;
    ctx.cyclones.push({ c: [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)], r: 0.08 + 0.1 * rnd(), s: Math.sign(lat) });
  }
  ctx.craters = buildCraters(P, S(21));
  ctx.volcs = buildVolcanoes(P, S(22));
  // height range and sea level over Fibonacci points
  const N = 6000, pts = fibonacci(N), hs = new Float64Array(N), st = {};
  const p = [0, 0, 0];
  ctx.seaH = -Infinity;
  for (let i = 0; i < N; i++) { p[0] = pts[i * 3]; p[1] = pts[i * 3 + 1]; p[2] = pts[i * 3 + 2]; heightCore(ctx, p, st); hs[i] = st.h; }
  hs.sort();
  const q = f => hs[Math.min(N - 1, Math.max(0, Math.round(f * (N - 1))))];
  const lo = q(0), hi = q(1), pad = (hi - lo) * 0.08 + 1e-6;
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
// Draw radii from the truncated power law and sort them into grids by size.
const LEVELS = [48, 12, 3];
function buildCraters(P, seed) {
  const C = P.craters, n = Math.round(C.density * 9000);
  const rnd = mulberry(seed);
  const a = C.slope, rmin = Math.min(C.rMin, C.rMax * 0.95), rmax = C.rMax;
  const k = 1 - Math.pow(rmin / rmax, a);
  const list = [];
  for (let i = 0; i < n; i++) {
    const c = onSphere(rnd), u = rnd();
    const r = rmin * Math.pow(1 - u * k, -1 / a);
    const age = rnd();
    const fresh = age < 0.12 && C.ejecta > 0;
    // influence: rays reach 7 r on fresh craters, ejecta 2.6 r on others
    const reach = (fresh ? 7 : 2.6) * r;
    // frame for the ray angle
    const up = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let e = [up[1] * c[2] - up[2] * c[1], up[2] * c[0] - up[0] * c[2], up[0] * c[1] - up[1] * c[0]];
    const el = Math.hypot(...e); e = e.map(v => v / el);
    const nn = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]];
    list.push({ c, r, age, fresh, reach, e, n: nn, id: i });
  }
  // grids: a crater goes to the finest level whose cell >= reach
  const grids = LEVELS.map(G => ({ G, cs: 2 / G, cells: new Map() }));
  const big = [];
  for (const cr of list) {
    const g = grids.find(gg => gg.cs >= cr.reach);
    if (!g) { big.push(cr); continue; }
    const ix = Math.floor((cr.c[0] + 1) / g.cs), iy = Math.floor((cr.c[1] + 1) / g.cs), iz = Math.floor((cr.c[2] + 1) / g.cs);
    const key = (ix * g.G + iy) * g.G + iz;
    let a2 = g.cells.get(key); if (!a2) g.cells.set(key, a2 = []);
    a2.push(cr);
  }
  return { list, grids, big };
}

// The radii of a crater field, for tests.mjs (size distribution).
export function craterList(P) {
  const seed = P.seed >>> 0;
  const S = k => (Math.imul(seed ^ 0x5bd1e995, 2654435761) + Math.imul(k, 40503)) | 0;
  return buildCraters(P, S(21)).list.map(c => c.r);
}

// Crater depth in height units: grows as r^0.5 (big basins are shallow
// for their size; small craters are deep for theirs).
const craterDepth = r => 0.3 * Math.sqrt(r / 0.2);

function craterOne(ctx, cr, p, st) {
  const C = ctx.P.craters;
  const dx = p[0] - cr.c[0], dy = p[1] - cr.c[1], dz = p[2] - cr.c[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > cr.reach * cr.reach) return;
  const d = Math.sqrt(d2), x = d / cr.r;
  const deg = 1 - 0.65 * cr.age;                   // old craters are worn down
  const D0 = C.depth * craterDepth(cr.r) * deg;
  const complex = cr.r > 0.03;
  let h = 0;
  if (x < 1) {
    let bowl = D0 * (x * x - 1);
    if (complex) bowl = Math.max(bowl, -0.72 * D0);
    h += bowl;
    if (complex) h += 0.4 * D0 * Math.exp(-(((x / 0.16)) ** 2));  // central peak
    st.floor = Math.max(st.floor, smooth(1, 0.75, x) * (cr.age > 0.5 && cr.r > 0.11 ? 1 : 0));
  }
  const rw = 0.16 + 0.2 * cr.age;
  h += D0 * C.rim * 0.36 * Math.exp(-((((x - 1) / rw)) ** 2));
  if (x > 1 && x < 2.6) h += D0 * C.rim * 0.1 * (1 / (x * x * x)) * smooth(2.6, 2.0, x);
  st.cH += h;
  if (x < 1.05) st.cInside = Math.max(st.cInside, smooth(1.05, 0.8, x) * (1 - cr.age));
  if (cr.fresh && x > 0.9) {
    // rays: angle around the centre, noise in angle, fading with distance
    const a = Math.atan2(dx * cr.n[0] + dy * cr.n[1] + dz * cr.n[2], dx * cr.e[0] + dy * cr.e[1] + dz * cr.e[2]);
    const rn = simplex3(Math.cos(a) * 4.5, Math.sin(a) * 4.5, cr.id * 1.37 + x * 0.15, ctx.sRay);
    const ray = smooth(0.15, 0.7, rn) * Math.exp(-(x - 1) / 2.2) * smooth(7, 4, x);
    const blanket = smooth(2.2, 1.0, x);
    st.rays = Math.max(st.rays, C.ejecta * (1 - cr.age / 0.12) * Math.max(ray, blanket * 0.8));
  }
}

function craterField(ctx, p, st) {
  st.cH = 0; st.rays = 0; st.floor = 0; st.cInside = 0;
  const F = ctx.craters;
  if (!F.list.length) return;
  for (const g of F.grids) {
    if (!g.cells.size) continue;
    const ix = Math.floor((p[0] + 1) / g.cs), iy = Math.floor((p[1] + 1) / g.cs), iz = Math.floor((p[2] + 1) / g.cs);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const arr = g.cells.get(((ix + a) * g.G + iy + b) * g.G + iz + c);
      if (arr) for (const cr of arr) craterOne(ctx, cr, p, st);
    }
  }
  for (const cr of F.big) craterOne(ctx, cr, p, st);
}

// Io-like calderas (paterae): dark floors, some with a red plume ring.
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
function heightCore(ctx, p, st) {
  const P = ctx.P;
  warp(p, P.terrain.warp, P.terrain.warpFreq, ctx.sWarp, _q);
  const c = fbm(_q, ctx.terrainO, ctx.sCont) * P.terrain.amp;
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
  const r = P.mountains.amp > 0 ? ridged(_q, ctx.mtnO, ctx.sMtn, P.mountains.sharpness) : 0;
  h += P.mountains.amp * mmask * r;
  st.mtn = mmask * r; st.c = c; st.uplift = uplift; st.rift = rift;
  const e = P.erosion.detail > 0 ? fbmEroded(p, ctx.eroO, ctx.sEro, P.erosion.strength) : 0;
  h += P.erosion.detail * e * (0.35 + mmask);
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
  // cracks / lineae: thin ridged lines, raised as double ridges
  st.crack = 0;
  if (P.cracks.amount > 0) {
    const f = P.cracks.freq;
    _t[0] = _q[0] * f; _t[1] = _q[1] * f; _t[2] = _q[2] * f;
    const n1 = Math.abs(simplex3(_t[0], _t[1], _t[2], ctx.sCrack));
    const n2 = Math.abs(simplex3(_t[0] * 2.3, _t[1] * 2.3, _t[2] * 2.3, ctx.sCrack + 5));
    const l = Math.max(smooth(0.06, 0.0, n1), 0.7 * smooth(0.04, 0.0, n2));
    st.crack = l * P.cracks.amount;
    h += 0.02 * st.crack - 0.035 * smooth(0.015, 0.0, n1) * P.cracks.amount;
  }
  volcanoField(ctx, p, st); h += st.vH;
  craterField(ctx, p, st); h += st.cH;
  // maria: old basins and low plains flood to a flat dark floor
  st.maria = 0;
  if (P.craters.maria > 0) {
    const low = smooth(-0.05, -0.35, c + 0.15 * simplex3(p[0] * 4, p[1] * 4, p[2] * 4, ctx.sVar + 3));
    st.maria = clamp(Math.max(st.floor, low) * P.craters.maria);
    h = mix(h, Math.min(h, -0.25 * P.terrain.amp), st.maria * 0.7);
  }
  // rivers: ridged lines in a warped field, carved where wet and low
  st.river = 0;
  if (P.rivers.amount > 0 && h > ctx.seaH) {
    const n = Math.abs(simplex3(_q[0] * 9, _q[1] * 9, _q[2] * 9, ctx.sRiver)) + 0.5 * Math.abs(simplex3(_q[0] * 19, _q[1] * 19, _q[2] * 19, ctx.sRiver + 1));
    const land = smooth(0, 0.02, h - ctx.seaH) * smooth(0.5, 0.1, st.mtn);
    st.river = smooth(0.05, 0.0, n) * land * P.rivers.amount;
    h -= 0.012 * st.river;
  }
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

const _st = {}, _col = [0, 0, 0], _bio = [0, 0, 0], _bar = [0, 0, 0], _cp = [0, 0, 0];
const VAR_O = { freq: 7, octaves: 4, lacunarity: 2.2, gain: 0.5 };
const MOIST_O = { freq: 2.2, octaves: 4, lacunarity: 2.1, gain: 0.5 };
const CITY_O = { freq: 16, octaves: 3, lacunarity: 2.3, gain: 0.5 };
const SULF_O = { freq: 2.5, octaves: 4, lacunarity: 2.2, gain: 0.55 };
const CLOUD_O = { freq: 2.2, octaves: 6, lacunarity: 2.15, gain: 0.52 };

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
  out.er = 0; out.eg = 0; out.eb = 0; out.night = 0; out.metal = 0;

  const polarOnly = (P.ocean.liquid | 0) === 2 ? smooth(0.75, 1.0, Math.abs(lat) + 0.15 * vary) : 1;
  if (hk < 0 && P.ocean.level > 0 && polarOnly > 0.5) {
    // ── liquid ──
    const depth = -hk;
    const liq = P.ocean.liquid | 0;
    if (liq === 1) {
      // lava sea: a black crust broken by glowing seams
      const n1 = Math.abs(simplex3(p[0] * 14, p[1] * 14, p[2] * 14, ctx.sLava)), n2 = Math.abs(simplex3(p[0] * 41, p[1] * 41, p[2] * 41, ctx.sLava + 1));
      const crust = clamp(smooth(0.0, 0.09, n1) * (0.55 + 0.45 * smooth(0.0, 0.12, n2)) + smooth(1.5, 0.2, depth) * 0.0);
      lerp3(_col, [0.3, 0.08, 0.03], pal.dark, crust);
      const bb = blackbody(1250 + 400 * (1 - crust));
      const g = (1 - crust) * 3.2;
      out.er = bb[0] * g; out.eg = bb[1] * g; out.eb = bb[2] * g;
      out.rough = mix(0.35, 0.92, crust); out.spec = 0.5;
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
      mixIn(_col, pal.beach, smooth(0.04, 0.0, hk) * smooth(0.0, 0.3, M) * 0.8);
      rough = mix(0.88, 0.78, grow);
    } else {
      _col[0] = _bar[0]; _col[1] = _bar[1]; _col[2] = _bar[2];
      if (P.dunes.amount > 0) { mixIn(_col, pal.bright, st.dune * 0.35); rough = mix(rough, 0.95, smooth(0, 0.3, st.dune)); }
    }
    // maria, craters, rays
    if (st.maria > 0) mixIn(_col, pal.dark, st.maria * 0.85);
    if (st.cInside > 0) mixIn(_col, pal.rock, st.cInside * 0.25);
    if (st.rays > 0) mixIn(_col, pal.bright, clamp(st.rays) * 0.75);
    // Io: sulphur variety, calderas, plume rings, hot vents
    if (ctx.volcs.length) {
      const s1 = fbm(p, SULF_O, ctx.sVar + 7);
      mixIn(_col, pal.accent, smooth(0.1, 0.45, s1) * 0.7);
      mixIn(_col, pal.bright, smooth(-0.15, -0.45, s1) * 0.6);
      mixIn(_col, pal.rock, smooth(0.55, 0.85, Math.abs(lat) / (Math.PI / 2)) * 0.5);
      mixIn(_col, [0.62, 0.22, 0.08], st.vRing * 0.65);
      mixIn(_col, pal.dark, st.vDark * 0.9);
      if (st.vHot > 0 && P.volcanoes.glow > 0) {
        const bb = blackbody(1500), g = st.vHot * P.volcanoes.glow * 4;
        out.er += bb[0] * g; out.eg += bb[1] * g; out.eb += bb[2] * g;
      }
      rough = mix(rough, 0.7, st.vDark);
    }
    // rivers
    if (st.river > 0) { mixIn(_col, pal.deep, st.river * 0.8); rough = mix(rough, 0.1, st.river); spec = mix(spec, 0.25, st.river); }
    // snow and ice
    if (T < P.climate.iceC + 6) {
      const snow = smooth(P.climate.iceC + 2, P.climate.iceC - 5, T + 4 * vary);
      mixIn(_col, pal.ice, snow * 0.95);
      rough = mix(rough, 0.55, snow); spec = mix(spec, 0.28, snow);
    }
    // city lights at night: temperate, wet, lowland, clustered near coasts
    if (P.climate.cities > 0 && P.climate.life > 0) {
      const hab = smooth(-2, 8, T) * smooth(32, 24, T) * smooth(0.12, 0.35, M) * smooth(2.5, 0.2, hk) * smooth(0.4, 0.1, st.mtn);
      if (hab > 0) {
        const n = fbm(p, CITY_O, ctx.sCity);
        const dots = smooth(0.25, 0.75, simplex3(p[0] * 140, p[1] * 140, p[2] * 140, ctx.sCity + 2));
        const pop = hab * smooth(0.0, 0.45, n + 0.2) * (0.35 + 0.65 * dots) * P.climate.cities;
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
      const bb = blackbody(1400), g = clamp(st.crack) * P.cracks.glow * 2.4 * smooth(0.6, 0.0, st.mtn);
      out.er += bb[0] * g; out.eg += bb[1] * g; out.eb += bb[2] * g;
    }
  }
  out.r = clamp(_col[0]); out.g = clamp(_col[1]); out.b = clamp(_col[2]);
  out.cloud = P.clouds.cover > 0 ? cloudAlpha(ctx, p) : 0;
  out.fu = 0.5; out.fv = 0.5; out.fb = 0;
  return out;
}

// Cloud cover: a warped fBm, swirled round seeded cyclones, thresholded by
// a latitude pattern (wet equator, clear subtropics, stormy mid-latitudes).
function cloudAlpha(ctx, p) {
  const P = ctx.P;
  _cp[0] = p[0]; _cp[1] = p[1]; _cp[2] = p[2];
  for (const cy of ctx.cyclones) {
    const dx = _cp[0] - cy.c[0], dy = _cp[1] - cy.c[1], dz = _cp[2] - cy.c[2];
    const d2 = (dx * dx + dy * dy + dz * dz) / (cy.r * cy.r);
    if (d2 > 9) continue;
    // rotate about the cyclone axis by an angle that falls with distance
    const ang = P.clouds.swirl * 5 * cy.s * Math.exp(-d2) * (1 - Math.exp(-d2 * 3));
    rotateAbout(_cp, cy.c, ang);
  }
  curl(_cp, 3, ctx.sCloud + 9, _v);
  _cp[0] += _v[0] * 0.02 * P.clouds.swirl; _cp[1] += _v[1] * 0.02 * P.clouds.swirl; _cp[2] += _v[2] * 0.02 * P.clouds.swirl;
  warp(_cp, 0.25, 2.5, ctx.sCloud, _t);
  CLOUD_O.freq = P.clouds.freq;
  // stretch along the east-west direction a little (y gets more frequency)
  _t[1] *= 1.6;
  const n = fbm(_t, CLOUD_O, ctx.sCloud + 1);
  const lat = Math.asin(clamp(p[1], -1, 1));
  const band = 0.12 * Math.cos(6 * lat) + 0.08 * Math.cos(2 * lat);
  const cov = P.clouds.cover;
  const thr = 0.35 - cov * 0.9 - band;
  const a = smooth(thr, thr + 0.32, n);
  return clamp(a * (0.75 + 0.25 * smooth(thr + 0.1, thr + 0.6, n)));
}

// Rodrigues rotation of v about unit axis k by angle a (in place).
export function rotateAbout(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), d = (k[0] * v[0] + k[1] * v[1] + k[2] * v[2]) * (1 - c);
  const x = v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d;
  const y = v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d;
  const z = v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d;
  v[0] = x; v[1] = y; v[2] = z;
}

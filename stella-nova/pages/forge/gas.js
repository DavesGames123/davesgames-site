// ============================================================================
//  PLANET FORGE  ·  gas.js — the gas and ice giant generator (no DOM)
// ----------------------------------------------------------------------------
//  A giant has no surface. Its "albedo" is the cloud deck, which the zonal
//  winds stretch into bands. prepareGas(P) builds the band profile, the
//  wind profile and the storm list; ctx.sample(p, out) gives one texel.
//
//  BAND PROFILE  bandEdges: the latitudes between bands, from a seeded
//  width jitter. With bands.symmetric the south is the mirror of the north
//  (tests.mjs checks it). Bands alternate zone (bright, high) and belt
//  (dark, low); bandValue(lat) blends across each edge over bands.soft of
//  the band width.
//
//  WINDS  u(lat) = an equatorial jet (equatorJet, jetWidth; negative is a
//  retrograde ice-giant jet) + one jet at each band edge, alternating in
//  sign, weaker toward the poles. The shear |du/dlat| sets where the
//  turbulence is strongest (turbulence.shear).
//
//  TEXEL  (sampleGas)
//    1. storms swirl the point: each vortex turns p about its centre by an
//       angle that falls off as exp(-d^2) on an E-W ellipse
//    2. flow-advected noise: the point walks `steps` steps along curl noise
//       (divergence-free), scaled by the local shear
//    3. lat' = latitude of the walked point, nudged by zonally stretched
//       fBm; band value at lat' plus streaks
//    4. palette ramp, then storm colours, polar hexagon or cyclones, haze
//  Outputs: albedo, cloud-top height, roughness, emissive (thermal glow),
//  high cirrus (cloud alpha) and the flow map (u, v, band value).
//
//  grep -n targets: "export function prepareGas", "function bandValue",
//  "function windAt", "function sampleGas", "export function ringProfile",
//  "export function bandEdges"
//  P.gx (gasx.js prepareGasX) and P.ringx (gasx.js ringProfileX) take over
//  the texel and the ring strip; recipes without them are unchanged.
// ============================================================================
import { fbm, simplex3, curl, mulberry, clamp, mix, smooth } from './noise.js';
import { rotateAbout, blackbody } from './rocky.js';
import { prepareGasX, ringProfileX } from './gasx.js';

const D = Math.PI / 180, HALF = Math.PI / 2;
const _p = [0, 0, 0], _c = [0, 0, 0], _s = [0, 0, 0];

// Band edges in latitude (radians, ascending, -pi/2 .. pi/2) and the value
// of each band. Exported for tests.mjs.
export function bandEdges(P) {
  const B = P.bands, seed = P.seed >>> 0;
  const rnd = mulberry((seed * 2246822519 + 77) >>> 0);
  const n = Math.max(2, B.count | 0);
  // one hemisphere: the equatorial band straddles the equator (half width)
  const half = (rnds) => {
    const k = Math.ceil(n / 2);
    const w = []; for (let i = 0; i < k; i++) w.push(1 + B.jitter * (rnds() * 2 - 1) * 0.8);
    w[0] *= 0.5;
    // bands narrow a little toward the pole (in latitude)
    for (let i = 0; i < k; i++) w[i] *= 1 - 0.25 * (i / k);
    const s = w.reduce((a, b) => a + b, 0);
    const edges = []; let acc = 0;
    for (let i = 0; i < k - 1; i++) { acc += w[i] / s * HALF; edges.push(acc); }
    const vals = []; for (let i = 0; i < k; i++) vals.push((i % 2 === 0 ? 1 : -1) * (0.55 + 0.45 * rnds()));
    return { edges, vals };
  };
  const N = half(rnd);
  const S = B.symmetric ? N : half(mulberry((seed * 3266489917 + 13) >>> 0));
  // assemble ascending: south (mirrored) then north; the equatorial band
  // takes the mean of both hemispheres' first band
  const edges = [], vals = [];
  for (let i = S.edges.length - 1; i >= 0; i--) edges.push(-S.edges[i]);
  for (let i = 0; i < N.edges.length; i++) edges.push(N.edges[i]);
  for (let i = S.vals.length - 1; i >= 1; i--) vals.push(S.vals[i]);
  vals.push((N.vals[0] + S.vals[0]) / 2);
  for (let i = 1; i < N.vals.length; i++) vals.push(N.vals[i]);
  return { edges, vals };
}

// Smooth band value at latitude lat, in about [-1, 1]: the value of the
// southmost band plus one smoothstep per edge, each as wide as bands.soft
// times the narrower of its two bands. Continuous, and mirror-symmetric
// when the edges and values are.
function bandValue(ctx, lat) {
  const E = ctx.edges, V = ctx.vals, W = ctx.edgeW;
  let v = V[0];
  for (let j = 0; j < E.length; j++) {
    const x = lat - E[j], bw = W[j];
    if (x <= -bw) break;
    const t = x >= bw ? 1 : (() => { const s = (x + bw) / (2 * bw); return s * s * (3 - 2 * s); })();
    v += (V[j + 1] - V[j]) * t;
  }
  return v;
}
export function bandProfile(ctx, lat) { return bandValue(ctx, lat); }

// Zonal wind in about [-1.5, 1.5] (east positive).
function windAt(ctx, lat) {
  const B = ctx.P.bands;
  let u = B.equatorJet * Math.exp(-((lat / B.jetWidth) ** 2));
  const E = ctx.edges;
  for (let i = 0; i < E.length; i++) {
    const s = (ctx.edgeSign[i]) * 0.45 * (1 - 0.6 * Math.abs(E[i]) / HALF);
    u += s * Math.exp(-(((lat - E[i]) / 0.035) ** 2));
  }
  return u;
}
export function windProfile(ctx, lat) { return windAt(ctx, lat); }

export function prepareGas(P) {
  // a recipe with P.gx (randomizer, new families) uses the varied generator
  if (P.gx) return prepareGasX(P);
  const seed = P.seed >>> 0;
  const S = k => (Math.imul(seed ^ 0x27d4eb2f, 2654435761) + Math.imul(k, 40503)) | 0;
  const { edges, vals } = bandEdges(P);
  const ctx = {
    P, kind: 'gas', edges, vals,
    sTurb: S(1), sStreak: S(2), sDetail: S(3), sCirrus: S(4), sStorm: S(5),
    turbO: { freq: P.turbulence.freq, octaves: P.turbulence.octaves, lacunarity: P.turbulence.lacunarity, gain: P.turbulence.gain },
  };
  // jets alternate in sign at the edges; mirrored hemispheres share signs
  ctx.edgeSign = edges.map((e, i) => (Math.sign(vals[i + 1] - vals[i]) || 1) * (e < 0 ? -1 : 1));
  // blend half-width of each edge: soft x the narrower neighbouring band
  ctx.edgeW = edges.map((e, i) => {
    const lo = i > 0 ? e - edges[i - 1] : e + HALF, hi = i < edges.length - 1 ? edges[i + 1] - e : HALF - e;
    return Math.max(0.003, P.bands.soft * 0.5 * Math.min(lo, hi));
  });
  // wind shear normaliser
  let um = 0.3; for (let i = 0; i <= 180; i++) um = Math.max(um, Math.abs(windAt(ctx, (i / 180 - 0.5) * Math.PI)));
  ctx.uMax = um;
  // tabled profile (2049 latitudes) for the per-texel lookups
  const NT = 2048, tab = new Float32Array(NT + 1);
  for (let i = 0; i <= NT; i++) tab[i] = windAt(ctx, (i / NT - 0.5) * Math.PI);
  ctx.windTab = tab;
  // storms
  const rnd = mulberry(S(20));
  const st = [];
  const add = (lat, lon, a, b, twist, kind, sign) => {
    const cl = Math.cos(lat), c = [-Math.cos(lon) * cl, Math.sin(lat), Math.sin(lon) * cl];
    const e = [Math.sin(lon), 0, Math.cos(lon)];
    const n = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]];
    st.push({ c, e, n, a, b, twist, kind, sign });
  };
  const SG = P.storms;
  if (SG.spot) {
    const lat = SG.spotLat * D;
    // anticyclone: counter-clockwise in the south, clockwise in the north
    add(lat, SG.spotLon * Math.PI * 2, SG.spotSize, SG.spotSize * 0.55, 2.4, 'spot', lat < 0 ? 1 : -1);
  }
  for (let i = 0; i < (SG.ovals | 0); i++) {
    const lat = (SG.ovalLat + (rnd() - 0.5) * 2) * D, lon = (i / Math.max(1, SG.ovals) + rnd() * 0.04) * Math.PI * 2;
    const r = 0.03 + 0.02 * rnd();
    add(lat, lon, r, r * 0.75, 2.0, 'oval', lat < 0 ? 1 : -1);
  }
  for (let i = 0; i < (SG.small | 0); i++) {
    // small storms sit near band edges
    const e = edges[Math.floor(rnd() * edges.length)] || 0;
    const lat = clamp(e + (rnd() - 0.5) * 0.06, -1.35, 1.35), lon = rnd() * Math.PI * 2;
    const r = 0.008 + 0.018 * rnd() ** 1.5;
    const barge = rnd() < 0.3;
    add(lat, lon, r * 1.4, r, 1.6 + rnd(), barge ? 'barge' : 'oval', (barge ? -1 : 1) * (lat < 0 ? 1 : -1));
  }
  if (SG.polar === 1) {
    // Jupiter-like polar cyclone clusters: one central, eight around
    for (const pole of [1, -1]) {
      add(pole * 89.5 * D, 0, 0.05, 0.05, 2.6, 'polar', pole);
      const k = pole > 0 ? 8 : 5;
      for (let i = 0; i < k; i++) add(pole * 83.5 * D, (i / k) * Math.PI * 2 + rnd() * 0.2, 0.035, 0.035, 2.6, 'polar', pole);
    }
  }
  ctx.storms = st;
  ctx.sample = (pp, out) => sampleGas(ctx, pp, out);
  ctx.hMin = 0; ctx.hMax = 1; ctx.kmPerUnit = P.relief;
  return ctx;
}

function ramp(stops, t, out) {
  t = clamp(t);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t <= b[0]) { const f = (t - a[0]) / ((b[0] - a[0]) || 1); for (let k = 0; k < 3; k++) out[k] = a[1][k] + (b[1][k] - a[1][k]) * f; return out; }
  }
  const l = stops[stops.length - 1][1]; out[0] = l[0]; out[1] = l[1]; out[2] = l[2]; return out;
}
const mixIn = (o, b, t) => { o[0] += (b[0] - o[0]) * t; o[1] += (b[1] - o[1]) * t; o[2] += (b[2] - o[2]) * t; };
const STREAK_O = { freq: 3, octaves: 4, lacunarity: 2.2, gain: 0.55 };
const DET_O = { freq: 18, octaves: 3, lacunarity: 2.2, gain: 0.5 };
const CIRRUS_O = { freq: 5, octaves: 4, lacunarity: 2.1, gain: 0.5 };

function windFast(ctx, lat) {
  const t = clamp(lat / Math.PI + 0.5) * 2048, i = Math.min(2047, t | 0), f = t - i;
  return ctx.windTab[i] * (1 - f) + ctx.windTab[i + 1] * f;
}

function sampleGas(ctx, p, out) {
  const P = ctx.P, T = P.turbulence, pal = P.palette;
  _p[0] = p[0]; _p[1] = p[1]; _p[2] = p[2];
  // 1. storm swirls (and masks from the unswirled point)
  let mSpot = 0, mOval = 0, mBarge = 0, mPolar = 0, dome = 0, collar = 0;
  for (const s of ctx.storms) {
    const dx = p[0] - s.c[0], dy = p[1] - s.c[1], dz = p[2] - s.c[2];
    const x = (dx * s.e[0] + dy * s.e[1] + dz * s.e[2]) / s.a, y = (dx * s.n[0] + dy * s.n[1] + dz * s.n[2]) / s.b;
    const d2 = x * x + y * y;
    if (d2 > 9) continue;
    const ang = s.sign * s.twist * Math.exp(-d2 * 0.8) * (0.3 + T.amount);
    rotateAbout(_p, s.c, ang);
    const inner = smooth(1.0, 0.55, Math.sqrt(d2));
    if (s.kind === 'spot') { mSpot = Math.max(mSpot, inner); collar = Math.max(collar, Math.exp(-(((Math.sqrt(d2) - 1.15) / 0.18) ** 2))); }
    else if (s.kind === 'oval') mOval = Math.max(mOval, inner);
    else if (s.kind === 'barge') mBarge = Math.max(mBarge, inner);
    else mPolar = Math.max(mPolar, inner);
    dome = Math.max(dome, inner * (s.kind === 'barge' ? -0.5 : 1));
  }
  // 2. flow-advected noise: walk along curl noise, scaled by local shear
  const lat0 = Math.asin(clamp(_p[1], -1, 1));
  const du = Math.abs(windFast(ctx, lat0 + 0.01) - windFast(ctx, lat0 - 0.01)) / 0.02 / (ctx.uMax * 12);
  const shearW = mix(1, clamp(du * 2.2), T.shear);
  const steps = Math.max(1, T.steps | 0), k = T.advect * T.amount * 0.22 * (0.25 + shearW) / steps;
  if (k > 0) {
    for (let i = 0; i < steps; i++) {
      curl(_p, T.freq * 1.3, ctx.sTurb + i * 3, _c);
      _p[0] += _c[0] * k; _p[1] += _c[1] * k; _p[2] += _c[2] * k;
      const l = Math.hypot(_p[0], _p[1], _p[2]); _p[0] /= l; _p[1] /= l; _p[2] /= l;
    }
  }
  // 3. latitude lookup, nudged by zonally stretched noise
  _s[0] = _p[0]; _s[1] = _p[1] * T.streak; _s[2] = _p[2];
  STREAK_O.freq = T.freq; STREAK_O.stretch = T.streak; DET_O.stretch = T.streak;
  const streak = T.amount > 0 ? fbm(_s, STREAK_O, ctx.sStreak) : 0;
  const lat = Math.asin(clamp(_p[1], -1, 1)) + streak * 0.05 * T.amount * (0.3 + shearW);
  const band = bandValue(ctx, lat);
  const turb = T.amount > 0 ? fbm(_p, ctx.turbO, ctx.sTurb + 50) : 0;
  const det = T.amount > 0 ? fbm(_s, DET_O, ctx.sDetail) : 0;
  let val = 0.5 + 0.5 * band * P.bands.contrast + T.amount * (0.12 * streak + 0.08 * turb * shearW + 0.04 * det);
  val = clamp(val);
  ramp(pal.stops, val, _c);
  // 4. storm colours
  if (mSpot > 0) { mixIn(_c, pal.spot, mSpot * 0.92); }
  if (collar > 0) mixIn(_c, pal.oval, collar * 0.35);
  if (mOval > 0) mixIn(_c, pal.oval, mOval * 0.9);
  if (mBarge > 0) mixIn(_c, pal.barge, mBarge * 0.85);
  if (mPolar > 0) mixIn(_c, pal.polar, mPolar * 0.6);
  // polar region: hexagon (north) or a darkened, bluer cap
  const alat = Math.abs(lat0);
  let cap = smooth(62 * D, 82 * D, alat);
  if (P.storms.polar === 2 && _p[1] > 0) {
    const lon = Math.atan2(p[2], -p[0]);
    const seg = Math.PI / 3, a = ((lon % seg) + seg) % seg - seg / 2;
    const rHex = (14 * D) * Math.cos(Math.PI / 6) / Math.cos(a);
    const colat = HALF - lat0;
    const inside = smooth(rHex + 0.01, rHex - 0.01, colat);
    const line = Math.exp(-(((colat - rHex) / 0.006) ** 2));
    mixIn(_c, pal.polar, inside * 0.85);
    mixIn(_c, pal.oval, line * 0.4);
    cap = Math.max(cap * 0.5, inside);
  }
  mixIn(_c, pal.polar, cap * P.haze.polar * 0.7);
  const dark = 1 - cap * P.haze.polar * 0.35;
  _c[0] *= dark; _c[1] *= dark; _c[2] *= dark;
  // haze: pull toward the mean colour (lower contrast)
  const mean = ramp(pal.stops, 0.55, [0, 0, 0]);
  mixIn(_c, mean, P.haze.amount * 0.45);
  // cloud decks reflect about half the light (geometric albedo ~0.5)
  out.r = clamp(_c[0] * 0.72); out.g = clamp(_c[1] * 0.72); out.b = clamp(_c[2] * 0.72);
  // cloud-top height: zones high, belts low, storms domed
  out.h = clamp(0.5 + 0.28 * band * P.bands.contrast + 0.1 * T.amount * turb + 0.15 * dome);
  out.rough = clamp(0.9 - 0.12 * val, 0, 1);
  out.metal = 0; out.spec = 0.35;
  // thermal glow: deeper (darker) belts are hotter
  out.night = 0;
  if (P.glow > 0) {
    const bb = blackbody(1300 + 500 * (1 - val));
    const g = P.glow * (0.15 + 0.85 * (1 - val) ** 2) * 1.6;
    out.er = bb[0] * g; out.eg = bb[1] * g; out.eb = bb[2] * g;
  } else { out.er = 0; out.eg = 0; out.eb = 0; }
  // high cirrus: bright zonal streaks, more in zones
  if (P.clouds.cover > 0) {
    _s[1] = _p[1] * T.streak; CIRRUS_O.stretch = T.streak;
    const n = fbm(_s, CIRRUS_O, ctx.sCirrus);
    const thr = 0.55 - P.clouds.cover * 0.8;
    out.cloud = clamp(smooth(thr, thr + 0.25, n) * (0.6 + 0.4 * smooth(-0.2, 0.6, band)) + mOval * 0.0);
  } else out.cloud = 0;
  // flow map: zonal and meridional wind, band value
  const u = windFast(ctx, lat0) / ctx.uMax;
  curl(p, T.freq * 1.3, ctx.sTurb, _c);
  const north = (_c[0] * (-p[0] * p[1]) + _c[1] * (1 - p[1] * p[1]) + _c[2] * (-p[2] * p[1])) / Math.max(1e-6, Math.sqrt(1 - p[1] * p[1]));
  out.fu = clamp(0.5 + 0.5 * u);
  out.fv = clamp(0.5 + 0.05 * north * T.amount);
  out.fb = clamp(0.5 + 0.5 * band);
  return out;
}

// The ring strip: a 1D radial profile (inner -> outer) of colour and
// opacity. Gaps (a Cassini-like division at 0.62 of the width, an
// Encke-like gap at 0.93) and many ringlets from layered 1D noise.
export function ringProfile(P, n = 1024) {
  if (P.ringx) return ringProfileX(P, n);
  const R = P.rings, rnd = mulberry(((P.seed >>> 0) * 1597334677 + 5) >>> 0);
  const out = new Uint8ClampedArray(n * 4);
  const s = (P.seed * 7919) | 0;
  const div = 0.6 + 0.06 * rnd(), enc = 0.9 + 0.05 * rnd();
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n;
    let d = 0.55 + 0.25 * simplex3(x * 9, 0.5, 0.5, s) + 0.15 * simplex3(x * 37, 1.5, 0.5, s) + 0.1 * simplex3(x * 140, 2.5, 0.5, s);
    d *= smooth(0, 0.06, x) * smooth(1, 0.94, x);
    d *= 0.35 + 0.65 * smooth(0.0, 0.3, x);                   // faint inner C ring
    d *= 1 - 0.92 * Math.exp(-(((x - div) / 0.022) ** 2));    // the division
    d *= 1 - 0.8 * Math.exp(-(((x - enc) / 0.005) ** 2));     // a narrow gap
    d = clamp(d * R.opacity * 1.2);
    const tint = 0.85 + 0.15 * simplex3(x * 20, 3.5, 0.5, s);
    out[i * 4] = Math.round(clamp(R.color[0] * tint) * 255);
    out[i * 4 + 1] = Math.round(clamp(R.color[1] * tint) * 255);
    out[i * 4 + 2] = Math.round(clamp(R.color[2] * tint * (0.9 + 0.1 * x)) * 255);
    out[i * 4 + 3] = Math.round(d * 255);
  }
  return out;
}

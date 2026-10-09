// ============================================================================
//  PLANET FORGE  ·  gasx.js — the varied giant generator (no DOM)
// ----------------------------------------------------------------------------
//  gas.js prepareGas(P) hands a giant to prepareGasX(P) when P.gx is set.
//  The old presets have no P.gx, so they keep their look. The randomizer
//  (randomize.js) and the new giant families (archetypes.js) set P.gx.
//
//  P.gx keys (GX_RANGE has the range of each number; sanitizeGx clamps):
//    jets, profile, asym   band edges per hemisphere, the width profile
//                          (edge = 90 deg x x^profile: < 1 wide polar
//                          bands, > 1 wide equatorial bands), N/S asymmetry
//    eqJet, eqWidth        equatorial jet (negative: retrograde)
//    jetAmp, jetDecay      off-equator jets and their fall toward the poles
//    kh, khWaves           Kelvin-Helmholtz billows on the band edges
//    accent, patchy        share of bands in the accent chromophore, and
//                          large colour patches in the alt colour
//    spots, spotSize       great spots (0..4), each with its own colour
//    ovalChains            chains of white ovals
//    polar, polySides, polyLat, cyclones, hood
//                          0 none, 1 cyclone clusters, 2 polygon jet,
//                          3 polygon north and cyclones south, 4 hood vortex
//    albedo                reflectance factor (ice giants bright, hot dark)
//    aurora, auroraLat     night-only auroral ovals (emissive, night mask)
//    glowT                 base temperature of the thermal glow (K)
//    col                   { accent, alt, haze, aurora, spots: [rgb x 4] }
//  The bands, turbulence, storms.small, haze, glow and clouds keys of the
//  old recipe keep their meaning (contrast, soft, turbulence, cirrus).
//
//  P.ringx (any kind) varies the ring strip: gaps, ringlets, a dusty
//  component and an outer colour. gas.js ringProfile hands it here.
//
//  TEXEL  (sampleGasX)
//    1. storms swirl the point (vortex turn, falls off as exp(-d^2))
//    2. curl-noise advection scaled by the local wind shear
//    3. latitude + streak noise + KH billow offset -> band tone and accent
//    4. palette ramp, accent and patch colours, storm colours, polar
//       polygon or hood, haze; aurora and thermal glow as emission
//
//  grep -n targets: "export const GX_DEFAULT", "export const GX_RANGE",
//  "export function sanitizeGx", "export function prepareGasX",
//  "function sampleGasX", "export function ringProfileX", "function hemi"
// ============================================================================
import { fbm, simplex3, curl, mulberry, clamp, mix, smooth } from './noise.js';
import { rotateAbout, blackbody } from './rocky.js';

const D = Math.PI / 180, HALF = Math.PI / 2, TAU = Math.PI * 2;

export const GX_DEFAULT = {
  v: 1, jets: 6, profile: 1, asym: 0, eqJet: 1, eqWidth: 0.25, jetAmp: 0.45, jetDecay: 0.6,
  kh: 0.4, khWaves: 24, accent: 0.3, patchy: 0.2, spots: 1, spotSize: 0.16, ovalChains: 1,
  polar: 1, polySides: 6, polyLat: 76, cyclones: 8, hood: 0.4, albedo: 1, aurora: 0, auroraLat: 72, glowT: 1300,
  col: { accent: [0.78, 0.45, 0.22], alt: [0.62, 0.52, 0.46], haze: [0.8, 0.74, 0.62], aurora: [0.3, 1, 0.55],
    spots: [[0.72, 0.32, 0.18], [0.95, 0.94, 0.9], [0.2, 0.16, 0.14], [0.85, 0.55, 0.3]] },
};
// [min, max, integer]
export const GX_RANGE = {
  jets: [1, 16, 1], profile: [0.45, 2.2, 0], asym: [0, 1, 0], eqJet: [-2, 2, 0], eqWidth: [0.05, 0.8, 0],
  jetAmp: [0, 1.2, 0], jetDecay: [0, 1, 0], kh: [0, 1, 0], khWaves: [4, 80, 1], accent: [0, 1, 0], patchy: [0, 1, 0],
  spots: [0, 4, 1], spotSize: [0.04, 0.32, 0], ovalChains: [0, 3, 1], polar: [0, 4, 1], polySides: [4, 9, 1],
  polyLat: [60, 84, 0], cyclones: [3, 10, 1], hood: [0, 1, 0], albedo: [0.45, 1.3, 0], aurora: [0, 1, 0],
  auroraLat: [58, 82, 0], glowT: [700, 2600, 0],
};
const RX_RANGE = { gaps: [0, 7, 1], ringlets: [0, 1, 0], dust: [0, 1, 0], bright: [0, 1, 0] };

const rgbOk = (c, d) => Array.isArray(c) && c.length === 3 && c.every(Number.isFinite) ? c.map(v => clamp(v)) : d.slice();
function clampTable(src, def, table) {
  const out = {};
  for (const k of Object.keys(table)) {
    const [lo, hi, int] = table[k];
    let v = Number(src && src[k]);
    if (!Number.isFinite(v)) v = def[k];
    v = Math.min(hi, Math.max(lo, v));
    out[k] = int ? Math.round(v) : v;
  }
  return out;
}

// A clean gx: every number finite and in range, every colour in [0, 1].
export function sanitizeGx(gx) {
  const out = { v: 1, ...clampTable(gx, GX_DEFAULT, GX_RANGE) };
  const c = (gx && gx.col) || {}, d = GX_DEFAULT.col;
  out.col = { accent: rgbOk(c.accent, d.accent), alt: rgbOk(c.alt, d.alt), haze: rgbOk(c.haze, d.haze), aurora: rgbOk(c.aurora, d.aurora),
    spots: [0, 1, 2, 3].map(i => rgbOk(c.spots && c.spots[i], d.spots[i])) };
  return out;
}
export function sanitizeRingx(rx) {
  const out = clampTable(rx, { gaps: 2, ringlets: 0.5, dust: 0, bright: 0.5 }, RX_RANGE);
  out.c2 = rgbOk(rx && rx.c2, [0.7, 0.66, 0.6]);
  return out;
}

// One hemisphere's band edges (rad, ascending, 0 .. 90 deg).
function hemi(n, profile, jitter, rnd) {
  const e = [];
  for (let i = 1; i <= n; i++) {
    const x = clamp((i + (rnd() - 0.5) * 0.7 * jitter) / (n + 0.75), 0.02, 0.985);
    e.push(HALF * Math.pow(x, profile));
  }
  e.sort((a, b) => a - b);
  for (let i = 0; i < e.length; i++) e[i] = Math.min(HALF - 0.03, Math.max(e[i], (i ? e[i - 1] : 0) + 0.012));
  return e.filter(v => v < HALF - 0.02);
}

export function prepareGasX(P) {
  const G = sanitizeGx(P.gx), seed = P.seed >>> 0;
  const S = k => (Math.imul(seed ^ 0x5bd1e995, 2654435761) + Math.imul(k, 40503)) | 0;
  const rnd = mulberry(S(1));
  const n = G.jets, jit = P.bands.jitter;
  const eN = hemi(n, G.profile, jit, rnd);
  let eS;
  if (G.asym > 0.5 && rnd() < G.asym) eS = hemi(Math.max(1, n + (rnd() < 0.5 ? -1 : 1)), G.profile * (1 + (rnd() - 0.5) * 0.4 * G.asym), jit, mulberry(S(2)));
  else { eS = eN.map(e => Math.min(HALF - 0.03, e * (1 + G.asym * 0.3 * (rnd() * 2 - 1)))); eS.sort((a, b) => a - b); }
  const edges = [];
  for (let i = eS.length - 1; i >= 0; i--) edges.push(-eS[i]);
  for (const e of eN) edges.push(e);
  // band tones t (ramp position) and accent weights; the equatorial band
  // is index eS.length. Zones and belts alternate away from the equator.
  const nb = edges.length + 1, eq = eS.length, c = P.bands.contrast;
  const eqDark = rnd() < 0.3 ? 1 : 0;
  const tN = [], aN = [];
  for (let k = 0; k < nb; k++) {
    const par = (Math.abs(k - eq) + eqDark) % 2 === 0 ? 1 : -1;
    tN.push(clamp(0.5 + par * c * (0.14 + 0.24 * rnd())));
    aN.push(rnd() < G.accent ? 0.35 + 0.6 * rnd() : 0);
  }
  // mirrored tones in the south unless asymmetric
  const sym = P.bands.symmetric && G.asym < 0.3;
  const tones = [], acc = [];
  for (let k = 0; k < nb; k++) {
    const m = 2 * eq - k;
    const useMirror = sym && k < eq && m < nb;
    tones.push(useMirror ? tN[m] : tN[k]); acc.push(useMirror ? aN[m] : aN[k]);
  }
  const width = j => { const lo = j > 0 ? edges[j] - edges[j - 1] : edges[j] + HALF, hi = j < edges.length - 1 ? edges[j + 1] - edges[j] : HALF - edges[j]; return Math.min(lo, hi); };
  const edgeW = edges.map((e, j) => Math.max(0.003, P.bands.soft * 0.5 * width(j)));
  const edgeSign = edges.map((e, j) => (Math.sign(tones[j + 1] - tones[j]) || 1) * (e < 0 ? -1 : 1));
  const jetW = edges.map((e, j) => clamp(0.3 * width(j), 0.01, 0.06));
  const kh = edges.map((e, j) => ({ k: Math.max(3, Math.round(G.khWaves * (0.6 + 0.8 * rnd()) * Math.cos(e))), ph: rnd() * TAU, a: G.kh * (0.4 + 0.6 * rnd()) }));
  const ctx = {
    P, G, kind: 'gas', edges, tones, acc, edgeW, edgeSign, jetW, kh,
    sTurb: S(3), sStreak: S(4), sDetail: S(5), sCirrus: S(6), sPatch: S(7), sAur: S(8),
    turbO: { freq: P.turbulence.freq, octaves: P.turbulence.octaves, lacunarity: P.turbulence.lacunarity, gain: P.turbulence.gain },
    streakO: { freq: P.turbulence.freq, octaves: 4, lacunarity: 2.2, gain: 0.55, stretch: P.turbulence.streak },
    detO: { freq: 18, octaves: 3, lacunarity: 2.2, gain: 0.5, stretch: P.turbulence.streak },
    cirrusO: { freq: 5, octaves: 4, lacunarity: 2.1, gain: 0.5, stretch: P.turbulence.streak },
    patchO: { freq: 1.3, octaves: 3, lacunarity: 2, gain: 0.5 },
  };
  // wind table
  const wind = lat => {
    let u = G.eqJet * Math.exp(-((lat / G.eqWidth) ** 2));
    for (let j = 0; j < edges.length; j++) u += edgeSign[j] * G.jetAmp * (1 - G.jetDecay * Math.abs(edges[j]) / HALF) * Math.exp(-(((lat - edges[j]) / jetW[j]) ** 2));
    return u;
  };
  const NT = 2048, tab = new Float32Array(NT + 1);
  let um = 0.3;
  for (let i = 0; i <= NT; i++) { tab[i] = wind((i / NT - 0.5) * Math.PI); um = Math.max(um, Math.abs(tab[i])); }
  ctx.windTab = tab; ctx.uMax = um;
  // storms: { c, e, n, a, b, twist, sign, col, op, cosR, collar }
  const st = [], rs = mulberry(S(20));
  const add = (lat, lon, a, b, twist, sign, col, op, collar = 0) => {
    const cl = Math.cos(lat), cc = [-Math.cos(lon) * cl, Math.sin(lat), Math.sin(lon) * cl];
    const e = [Math.sin(lon), 0, Math.cos(lon)];
    const nn = [cc[1] * e[2] - cc[2] * e[1], cc[2] * e[0] - cc[0] * e[2], cc[0] * e[1] - cc[1] * e[0]];
    st.push({ c: cc, e, n: nn, a, b, twist, sign, col, op, collar, cosR: Math.cos(Math.min(Math.PI, 3 * Math.max(a, b))) });
  };
  const pal = P.palette, anti = lat => lat < 0 ? 1 : -1;
  const spotLats = [];
  for (let i = 0; i < G.spots; i++) {
    let lat = (rs() < 0.5 ? -1 : 1) * (10 + 38 * rs()) * D;
    if (i === 0 && P.storms.spot) lat = P.storms.spotLat * D;
    const lon = i === 0 && P.storms.spot ? P.storms.spotLon * TAU : rs() * TAU;
    const a = G.spotSize * (i === 0 ? 1 : 0.4 + 0.45 * rs());
    add(lat, lon, a, a * (0.5 + 0.2 * rs()), 2.4, anti(lat), G.col.spots[i % 4], 0.92, 0.35);
    spotLats.push(lat);
  }
  for (let ch = 0; ch < G.ovalChains; ch++) {
    const lat = (rs() < 0.5 ? -1 : 1) * (22 + 34 * rs()) * D, k = 3 + Math.floor(rs() * 7), l0 = rs() * TAU, rr = 0.022 + 0.03 * rs();
    for (let i = 0; i < k; i++) { const r = rr * (0.7 + 0.5 * rs()); add(lat + (rs() - 0.5) * 0.03, l0 + (i / k + rs() * 0.05) * TAU * (0.35 + 0.5 * rs()), r, r * 0.75, 2.0, anti(lat), pal.oval, 0.9); }
  }
  for (let i = 0; i < (P.storms.small | 0); i++) {
    const e = edges[Math.floor(rs() * edges.length)] || 0;
    const lat = clamp(e + (rs() - 0.5) * 0.06, -1.35, 1.35), lon = rs() * TAU;
    const r = 0.008 + 0.018 * rs() ** 1.5, barge = rs() < 0.3;
    add(lat, lon, r * 1.4, r, 1.6 + rs(), (barge ? -1 : 1) * anti(lat), barge ? pal.barge : pal.oval, 0.85);
  }
  const cyc = pole => {
    add(pole * 89.3 * D, rs() * TAU, 0.05, 0.05, 2.6, pole, pal.polar, 0.6);
    const k = G.cyclones, ring = (6 + 3 * rs()) * D;
    for (let i = 0; i < k; i++) add(pole * (90 * D - ring), (i / k) * TAU + rs() * 0.2, 0.03 + 0.015 * rs(), 0.03 + 0.015 * rs(), 2.6, pole, i % 2 ? pal.oval : pal.polar, 0.6);
  };
  if (G.polar === 1) { cyc(1); cyc(-1); }
  if (G.polar === 3) cyc(-1);
  if (G.polar === 4) { add(89.5 * D, 0, 0.28, 0.28, 1.4, 1, pal.polar, 0.35); add(-89.5 * D, 0, 0.28, 0.28, 1.4, -1, pal.polar, 0.35); }
  ctx.storms = st;
  ctx.mask = new Float32Array(st.length);
  ctx.hit = new Int32Array(st.length);
  ctx.polyRot = rs() * TAU;
  ctx.aurAxis = (() => { const a = 4 * D * rs(), l = rs() * TAU; return [Math.sin(a) * Math.cos(l), Math.cos(a), Math.sin(a) * Math.sin(l)]; })();
  ctx.mean = ramp(pal.stops, 0.55, [0, 0, 0]);
  ctx.sample = (pp, out) => sampleGasX(ctx, pp, out);
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
const _p = [0, 0, 0], _c = [0, 0, 0], _s = [0, 0, 0], _q = [0, 0, 0], _B = [0, 0];

function windFast(ctx, lat) {
  const t = clamp(lat / Math.PI + 0.5) * 2048, i = Math.min(2047, t | 0), f = t - i;
  return ctx.windTab[i] * (1 - f) + ctx.windTab[i + 1] * f;
}
// band tone and accent at a latitude: smoothsteps across each edge
function bandAt(ctx, lat, out) {
  const E = ctx.edges, T = ctx.tones, A = ctx.acc, W = ctx.edgeW;
  let t = T[0], a = A[0];
  for (let j = 0; j < E.length; j++) {
    const x = lat - E[j], bw = W[j];
    if (x <= -bw) break;
    let s = 1;
    if (x < bw) { s = (x + bw) / (2 * bw); s = s * s * (3 - 2 * s); }
    t += (T[j + 1] - T[j]) * s; a += (A[j + 1] - A[j]) * s;
  }
  out[0] = t; out[1] = a; return out;
}
// KH billows: a latitude offset near each edge, waves along the edge that
// lean with the shear (phase grows across the edge)
function billow(ctx, lat, lon) {
  const E = ctx.edges, W = ctx.edgeW;
  let d = 0;
  for (let j = 0; j < E.length; j++) {
    const k = ctx.kh[j]; if (k.a <= 0) continue;
    const w = Math.max(W[j], 0.012), x = (lat - E[j]) / w;
    if (x < -3 || x > 3) continue;
    d += k.a * w * 1.4 * Math.sin(k.k * lon + k.ph + 2.4 * x) * Math.exp(-x * x / 2.25);
  }
  return d;
}

function sampleGasX(ctx, p, out) {
  const P = ctx.P, G = ctx.G, T = P.turbulence, pal = P.palette, st = ctx.storms;
  _p[0] = p[0]; _p[1] = p[1]; _p[2] = p[2];
  // 1. storm swirls; masks from the unswirled point
  let nh = 0, dome = 0;
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    if (p[0] * s.c[0] + p[1] * s.c[1] + p[2] * s.c[2] < s.cosR) continue;
    const dx = p[0] - s.c[0], dy = p[1] - s.c[1], dz = p[2] - s.c[2];
    const x = (dx * s.e[0] + dy * s.e[1] + dz * s.e[2]) / s.a, y = (dx * s.n[0] + dy * s.n[1] + dz * s.n[2]) / s.b;
    const d2 = x * x + y * y;
    if (d2 > 9) continue;
    rotateAbout(_p, s.c, s.sign * s.twist * Math.exp(-d2 * 0.8) * (0.3 + T.amount));
    const r = Math.sqrt(d2), inner = smooth(1.0, 0.55, r);
    ctx.mask[nh] = inner; ctx.hit[nh] = i; nh++;
    dome = Math.max(dome, inner * (s.col === pal.barge ? -0.5 : 1));
  }
  // 2. curl advection scaled by the shear
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
  // 3. latitude lookup: streak noise and the KH billows
  _s[0] = _p[0]; _s[1] = _p[1] * T.streak; _s[2] = _p[2];
  const streak = T.amount > 0 ? fbm(_s, ctx.streakO, ctx.sStreak) : 0;
  const lon = Math.atan2(_p[2], -_p[0]);
  let lat = Math.asin(clamp(_p[1], -1, 1)) + streak * 0.05 * T.amount * (0.3 + shearW);
  lat += billow(ctx, lat, lon);
  bandAt(ctx, lat, _B);
  const turb = T.amount > 0 ? fbm(_p, ctx.turbO, ctx.sTurb + 50) : 0;
  const det = T.amount > 0 ? fbm(_s, ctx.detO, ctx.sDetail) : 0;
  const val = clamp(_B[0] + T.amount * (0.12 * streak + 0.08 * turb * shearW + 0.04 * det));
  ramp(pal.stops, val, _c);
  // 4. chromophores: band accent, large patches
  if (_B[1] > 0) mixIn(_c, G.col.accent, clamp(_B[1] * (0.6 + 0.5 * streak + 0.3 * turb)));
  if (G.patchy > 0) mixIn(_c, G.col.alt, G.patchy * smooth(0.0, 0.55, fbm(p, ctx.patchO, ctx.sPatch)) * 0.8);
  // storm colours (a collar of the oval colour round each great spot)
  for (let h = 0; h < nh; h++) {
    const s = st[ctx.hit[h]], m = ctx.mask[h];
    if (s.collar) {
      const dx = p[0] - s.c[0], dy = p[1] - s.c[1], dz = p[2] - s.c[2];
      const x = (dx * s.e[0] + dy * s.e[1] + dz * s.e[2]) / s.a, y = (dx * s.n[0] + dy * s.n[1] + dz * s.n[2]) / s.b;
      mixIn(_c, pal.oval, s.collar * Math.exp(-(((Math.sqrt(x * x + y * y) - 1.15) / 0.18) ** 2)));
    }
    if (m > 0) mixIn(_c, s.col, m * s.op);
  }
  // polar region: polygon jet, hood or a darker cap
  const alat = Math.abs(lat0);
  let cap = smooth(58 * D, 82 * D, alat);
  if ((G.polar === 2 || G.polar === 3) && _p[1] > 0) {
    const plon = Math.atan2(p[2], -p[0]) + ctx.polyRot, n = G.polySides;
    const seg = TAU / n, a = ((plon % seg) + seg) % seg - seg / 2;
    const r0 = (90 - G.polyLat) * D, rHex = r0 * Math.cos(Math.PI / n) / Math.cos(a);
    const colat = HALF - lat0;
    const inside = smooth(rHex + 0.01, rHex - 0.01, colat), line = Math.exp(-(((colat - rHex) / 0.006) ** 2));
    mixIn(_c, pal.polar, inside * 0.85); mixIn(_c, pal.oval, line * 0.4);
    cap = Math.max(cap * 0.5, inside);
  }
  mixIn(_c, pal.polar, cap * Math.max(P.haze.polar, G.hood) * 0.7);
  const dark = 1 - cap * P.haze.polar * 0.35;
  _c[0] *= dark; _c[1] *= dark; _c[2] *= dark;
  // haze layer: toward its colour (lower contrast, a tint)
  mixIn(_c, ctx.mean, P.haze.amount * 0.25);
  mixIn(_c, G.col.haze, P.haze.amount * 0.3);
  const alb = 0.72 * G.albedo;
  out.r = clamp(_c[0] * alb); out.g = clamp(_c[1] * alb); out.b = clamp(_c[2] * alb);
  out.h = clamp(0.5 + 0.56 * (_B[0] - 0.5) + 0.1 * T.amount * turb + 0.15 * dome);
  out.rough = clamp(0.9 - 0.12 * val, 0, 1);
  out.metal = 0; out.spec = 0.35;
  out.er = 0; out.eg = 0; out.eb = 0; out.night = 0;
  // aurora: a night-only oval round a slightly offset magnetic pole
  let aur = 0;
  if (G.aurora > 0) {
    const ax = ctx.aurAxis, cz = Math.abs(p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2]);
    const colat = Math.acos(clamp(cz)), r0 = (90 - G.auroraLat) * D;
    const ring = Math.exp(-(((colat - r0) / 0.03) ** 2));
    if (ring > 0.01) {
      _q[0] = p[0] * 9; _q[1] = p[1] * 2; _q[2] = p[2] * 9;
      aur = G.aurora * ring * (0.35 + 0.65 * smooth(-0.3, 0.6, simplex3(_q[0], _q[1], _q[2], ctx.sAur)));
    }
  }
  if (aur > 0.03) {
    const g = Math.min(1, aur * 1.4);
    out.er = G.col.aurora[0] * g; out.eg = G.col.aurora[1] * g; out.eb = G.col.aurora[2] * g; out.night = 1;
  } else if (P.glow > 0) {
    const bb = blackbody(G.glowT + 600 * (1 - val));
    const g = P.glow * (0.15 + 0.85 * (1 - val) ** 2) * 1.6;
    out.er = bb[0] * g; out.eg = bb[1] * g; out.eb = bb[2] * g;
  }
  // high cirrus
  if (P.clouds.cover > 0) {
    const nn = fbm(_s, ctx.cirrusO, ctx.sCirrus), thr = 0.55 - P.clouds.cover * 0.8;
    out.cloud = clamp(smooth(thr, thr + 0.25, nn) * (0.6 + 0.4 * smooth(0.3, 0.8, _B[0])));
  } else out.cloud = 0;
  // flow map
  const u = windFast(ctx, lat0) / ctx.uMax;
  curl(p, T.freq * 1.3, ctx.sTurb, _c);
  const north = (_c[0] * (-p[0] * p[1]) + _c[1] * (1 - p[1] * p[1]) + _c[2] * (-p[2] * p[1])) / Math.max(1e-6, Math.sqrt(1 - p[1] * p[1]));
  out.fu = clamp(0.5 + 0.5 * u);
  out.fv = clamp(0.5 + 0.05 * north * T.amount);
  out.fb = clamp(_B[0]);
  return out;
}

// The varied ring strip (inner -> outer): seeded gaps, ringlets, a dense
// bright ring, a dusty component and a colour gradient to ringx.c2.
export function ringProfileX(P, n = 1024) {
  const R = P.rings, X = sanitizeRingx(P.ringx), rnd = mulberry(((P.seed >>> 0) * 2654435761 + 91) >>> 0);
  const s = ((P.seed >>> 0) * 7919 + 17) | 0, out = new Uint8ClampedArray(n * 4);
  const gaps = []; for (let i = 0; i < X.gaps; i++) gaps.push([0.12 + 0.84 * rnd(), 0.003 + 0.025 * rnd() ** 2, 0.6 + 0.38 * rnd()]);
  const bc = 0.3 + 0.4 * rnd(), bw = 0.12 + 0.2 * rnd();
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n;
    let d = 0.5 + 0.2 * simplex3(x * 7, 0.5, 0.5, s);
    d += X.ringlets * (0.22 * simplex3(x * 60, 1.5, 0.5, s) + 0.14 * simplex3(x * 210, 2.5, 0.5, s));
    d += X.bright * 0.35 * Math.exp(-(((x - bc) / bw) ** 2));
    d = mix(d, 0.22 + 0.06 * simplex3(x * 15, 4.5, 0.5, s), X.dust);
    d *= smooth(0, 0.05, x) * smooth(1, 0.95, x);
    for (const [c, w, k] of gaps) d *= 1 - k * Math.exp(-(((x - c) / w) ** 2));
    d = clamp(d * R.opacity * 1.2);
    const tint = 0.88 + 0.12 * simplex3(x * 24, 3.5, 0.5, s), f = smooth(0, 1, x);
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(clamp(mix(R.color[k], X.c2[k], f) * tint) * 255);
    out[i * 4 + 3] = Math.round(d * 255);
  }
  return out;
}

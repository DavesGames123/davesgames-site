// ============================================================================
//  PLANET FORGE  ·  archetypes.js — new planet families and giant palettes
// ----------------------------------------------------------------------------
//  New families, registered into presets.js PRESETS at import (main.js
//  imports this module through randomize.js), so the preset buttons, the
//  saver and fromPreset(id, seed) see them. The worker does not need them:
//  a recipe carries every key it needs.
//
//    rocky  carbon (graphite, tar seas, soot haze), iron (dense cratered
//           metal world with scarps), eyeball (tidally locked: warm at the
//           pole that faces the sun, P.view locks the sun on it),
//           superearth (big, thick sky, many plates)
//    gas    icegiant, hotneptune, puffy (low density, hazy), browndwarf
//           (thermal glow and aurorae), ringed (varied ring systems),
//           exotic (purple, green, red, sulphur chromophores)
//  Every giant family here uses the varied generator (gasx.js P.gx).
//
//  GAS_PAL: chromophore palettes { stops (5, dark -> light), accent, alt,
//  haze, polar, oval, barge, spots[4], atmo (an ATMO key) }.
//  gasWild(F, opts) draws one giant from palettes and wide ranges;
//  rockyWiden(F, P, k) widens a rocky family member by strength k (0..1).
//  F is a dice (makeDice): r, u, i, pick, tint, f, coin.
//
//  grep -n targets: "export const GAS_PAL", "export function makeDice",
//  "export function gasWild", "export function rockyWiden", "export const NEW_PRESETS",
//  "export function hueShift", "const GAS_FAMILY"
// ============================================================================
import * as PR from './presets.js';

const clamp01 = v => Math.min(1, Math.max(0, v));

// A seeded dice with the API of presets.js dice, plus r() and coin(p).
export function makeDice(seed, salt = '') {
  let h = (seed >>> 0) ^ 0x2545F491;
  for (let k = 0; k < salt.length; k++) h = Math.imul(h ^ salt.charCodeAt(k), 0x9E3779B1) >>> 0;
  let s = h >>> 0;
  const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  return {
    r,
    u: (a, b) => a + (b - a) * r(),
    i: (a, b) => a + Math.floor(r() * (b - a + 1)),
    pick: l => l[Math.floor(r() * l.length)],
    tint: (c, sd) => c.map(v => clamp01(v * (1 + sd * (2 * r() - 1)))),
    f: sd => [0, 1, 2].map(() => 1 + sd * (2 * r() - 1)),
    coin: p => r() < p,
  };
}

// ── colour helpers ──────────────────────────────────────────────────────
function rgb2hsv([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx > 0 ? d / mx : 0, mx];
}
function hsv2rgb([h, s, v]) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [clamp01(r + m), clamp01(g + m), clamp01(b + m)];
}
// Turn the hue by dh degrees, scale saturation and value.
export function hueShift(c, dh, ks = 1, kv = 1) {
  const [h, s, v] = rgb2hsv(c);
  return hsv2rgb([((h + dh) % 360 + 360) % 360, clamp01(s * ks), clamp01(v * kv)]);
}
const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// ── giant palettes ──────────────────────────────────────────────────────
const P5 = (...c) => c;
export const GAS_PAL = {
  jupiter: { stops: P5([0.42, 0.26, 0.16], [0.66, 0.48, 0.34], [0.86, 0.76, 0.62], [0.95, 0.91, 0.84], [0.98, 0.96, 0.92]), accent: [0.8, 0.48, 0.24], alt: [0.55, 0.5, 0.52], haze: [0.85, 0.78, 0.66], polar: [0.36, 0.38, 0.42], oval: [0.97, 0.96, 0.94], barge: [0.32, 0.18, 0.12], spots: [[0.72, 0.32, 0.18], [0.95, 0.94, 0.9], [0.55, 0.28, 0.16], [0.88, 0.6, 0.35]], atmo: 'jupiter' },
  saturn: { stops: P5([0.55, 0.44, 0.3], [0.74, 0.63, 0.45], [0.86, 0.78, 0.6], [0.92, 0.86, 0.7], [0.95, 0.92, 0.82]), accent: [0.85, 0.7, 0.42], alt: [0.7, 0.66, 0.55], haze: [0.9, 0.84, 0.66], polar: [0.42, 0.52, 0.6], oval: [0.96, 0.94, 0.88], barge: [0.5, 0.4, 0.3], spots: [[0.92, 0.9, 0.82], [0.78, 0.62, 0.4], [0.6, 0.5, 0.36], [0.95, 0.92, 0.85]], atmo: 'saturn' },
  uranus: { stops: P5([0.42, 0.66, 0.7], [0.52, 0.74, 0.78], [0.6, 0.8, 0.84], [0.68, 0.86, 0.88], [0.8, 0.92, 0.93]), accent: [0.75, 0.9, 0.9], alt: [0.48, 0.7, 0.8], haze: [0.65, 0.85, 0.88], polar: [0.78, 0.9, 0.92], oval: [0.92, 0.97, 0.98], barge: [0.32, 0.52, 0.6], spots: [[0.9, 0.96, 0.97], [0.28, 0.48, 0.58], [0.85, 0.95, 0.96], [0.58, 0.8, 0.85]], atmo: 'neptune' },
  neptune: { stops: P5([0.1, 0.2, 0.48], [0.18, 0.32, 0.66], [0.26, 0.44, 0.78], [0.36, 0.54, 0.84], [0.55, 0.7, 0.9]), accent: [0.5, 0.72, 0.95], alt: [0.2, 0.3, 0.6], haze: [0.4, 0.55, 0.85], polar: [0.26, 0.4, 0.7], oval: [0.92, 0.95, 1], barge: [0.08, 0.13, 0.32], spots: [[0.08, 0.13, 0.32], [0.92, 0.95, 1], [0.12, 0.2, 0.45], [0.7, 0.82, 0.98]], atmo: 'neptune' },
  hot: { stops: P5([0.08, 0.04, 0.035], [0.2, 0.1, 0.07], [0.36, 0.2, 0.14], [0.5, 0.34, 0.24], [0.62, 0.48, 0.36]), accent: [0.5, 0.22, 0.12], alt: [0.25, 0.18, 0.2], haze: [0.35, 0.2, 0.15], polar: [0.15, 0.08, 0.06], oval: [0.7, 0.55, 0.45], barge: [0.05, 0.03, 0.02], spots: [[0.5, 0.2, 0.1], [0.7, 0.55, 0.45], [0.1, 0.05, 0.04], [0.6, 0.35, 0.2]], atmo: 'hot' },
  purple: { stops: P5([0.2, 0.1, 0.28], [0.36, 0.2, 0.48], [0.55, 0.38, 0.66], [0.72, 0.58, 0.8], [0.88, 0.8, 0.92]), accent: [0.85, 0.5, 0.75], alt: [0.35, 0.3, 0.6], haze: [0.7, 0.55, 0.85], polar: [0.25, 0.18, 0.4], oval: [0.95, 0.9, 0.97], barge: [0.15, 0.06, 0.2], spots: [[0.9, 0.45, 0.7], [0.95, 0.9, 0.97], [0.25, 0.1, 0.3], [0.6, 0.4, 0.85]], atmo: 'saturn' },
  green: { stops: P5([0.16, 0.26, 0.14], [0.3, 0.44, 0.24], [0.5, 0.62, 0.38], [0.7, 0.78, 0.55], [0.86, 0.9, 0.74]), accent: [0.75, 0.72, 0.3], alt: [0.3, 0.5, 0.45], haze: [0.65, 0.8, 0.55], polar: [0.2, 0.32, 0.3], oval: [0.92, 0.96, 0.86], barge: [0.1, 0.18, 0.08], spots: [[0.85, 0.8, 0.35], [0.92, 0.96, 0.86], [0.12, 0.25, 0.15], [0.4, 0.65, 0.5]], atmo: 'saturn' },
  red: { stops: P5([0.3, 0.06, 0.05], [0.52, 0.14, 0.1], [0.72, 0.3, 0.2], [0.86, 0.5, 0.36], [0.95, 0.72, 0.58]), accent: [0.95, 0.6, 0.25], alt: [0.5, 0.2, 0.3], haze: [0.85, 0.45, 0.35], polar: [0.3, 0.1, 0.12], oval: [0.98, 0.88, 0.8], barge: [0.18, 0.03, 0.03], spots: [[0.98, 0.85, 0.6], [0.25, 0.04, 0.04], [0.95, 0.6, 0.3], [0.7, 0.2, 0.3]], atmo: 'jupiter' },
  sulphur: { stops: P5([0.4, 0.34, 0.1], [0.62, 0.55, 0.2], [0.8, 0.74, 0.4], [0.9, 0.86, 0.6], [0.96, 0.94, 0.8]), accent: [0.85, 0.5, 0.15], alt: [0.55, 0.6, 0.35], haze: [0.9, 0.85, 0.5], polar: [0.4, 0.38, 0.25], oval: [0.97, 0.96, 0.85], barge: [0.3, 0.22, 0.05], spots: [[0.9, 0.45, 0.12], [0.97, 0.96, 0.85], [0.35, 0.3, 0.08], [0.7, 0.75, 0.3]], atmo: 'saturn' },
  silver: { stops: P5([0.42, 0.44, 0.48], [0.6, 0.62, 0.66], [0.76, 0.78, 0.8], [0.86, 0.88, 0.9], [0.95, 0.96, 0.97]), accent: [0.6, 0.7, 0.85], alt: [0.7, 0.68, 0.65], haze: [0.85, 0.88, 0.92], polar: [0.5, 0.55, 0.65], oval: [0.98, 0.98, 0.99], barge: [0.3, 0.32, 0.36], spots: [[0.98, 0.98, 0.99], [0.35, 0.4, 0.5], [0.7, 0.75, 0.85], [0.55, 0.5, 0.45]], atmo: 'saturn' },
  browndwarf: { stops: P5([0.12, 0.04, 0.06], [0.24, 0.08, 0.1], [0.38, 0.15, 0.14], [0.5, 0.25, 0.2], [0.6, 0.36, 0.28]), accent: [0.55, 0.15, 0.3], alt: [0.3, 0.1, 0.25], haze: [0.4, 0.15, 0.2], polar: [0.2, 0.06, 0.1], oval: [0.65, 0.4, 0.35], barge: [0.06, 0.02, 0.03], spots: [[0.6, 0.25, 0.2], [0.08, 0.02, 0.04], [0.5, 0.3, 0.4], [0.7, 0.45, 0.3]], atmo: 'hot' },
  cream: { stops: P5([0.66, 0.62, 0.56], [0.78, 0.74, 0.68], [0.86, 0.83, 0.77], [0.92, 0.9, 0.85], [0.97, 0.96, 0.93]), accent: [0.85, 0.75, 0.6], alt: [0.75, 0.78, 0.8], haze: [0.92, 0.9, 0.85], polar: [0.6, 0.62, 0.68], oval: [0.99, 0.98, 0.96], barge: [0.5, 0.45, 0.4], spots: [[0.95, 0.85, 0.7], [0.6, 0.55, 0.5], [0.99, 0.98, 0.96], [0.8, 0.7, 0.55]], atmo: 'saturn' },
};

// One palette: a pick, sometimes blended with a second, then a hue turn
// and a saturation/value change. Returns P.palette plus gx.col.
function drawPalette(F, names, wild = 0.5) {
  const A = GAS_PAL[F.pick(names)];
  const B = F.coin(0.35 * wild) ? GAS_PAL[F.pick(Object.keys(GAS_PAL))] : null, bt = B ? F.u(0.15, 0.45) : 0;
  const dh = F.u(-18, 18) * wild, ks = F.u(1 - 0.35 * wild, 1 + 0.35 * wild), kv = F.u(0.92, 1.06);
  const c = (k, i) => {
    let v = i == null ? A[k] : A[k][i];
    if (B) v = lerp3(v, i == null ? B[k] : B[k][i], bt);
    return hueShift(v, dh, ks, kv);
  };
  // the ramp: 5 stops at seeded positions, sometimes two swapped
  const pos = [0, F.u(0.18, 0.4), F.u(0.45, 0.62), F.u(0.7, 0.86), 1];
  const stops = A.stops.map((s, i) => [pos[i], c('stops', i)]);
  if (F.coin(0.15 * wild)) { const t = stops[1][1]; stops[1][1] = stops[2][1]; stops[2][1] = t; }
  const spots = [0, 1, 2, 3].map(i => c('spots', i));
  // shuffle the spot colours so the first great spot is not always the same hue
  for (let i = 3; i > 0; i--) { const j = F.i(0, i); const t = spots[i]; spots[i] = spots[j]; spots[j] = t; }
  return {
    palette: { stops, spot: spots[0], polar: c('polar'), oval: c('oval'), barge: c('barge') },
    col: { accent: c('accent'), alt: c('alt'), haze: c('haze'), aurora: F.pick([[0.3, 1, 0.55], [1, 0.35, 0.6], [0.55, 0.45, 1], [0.35, 0.85, 1]]), spots },
    atmo: (B && bt > 0.35 ? B : A).atmo,
  };
}

// A giant with a varied band, storm and colour layout (gasx.js).
// o: { pals, jets [a, b], eqJet [a, b], contrast [a, b], haze [a, b],
//      radius [a, b], glow [a, b], glowT [a, b], aurora (chance), rings
//      (chance), albedo [a, b], wild (0..1), spots [a, b], polar (list) }
export function gasWild(F, o = {}) {
  const wild = o.wild ?? 1, R = (k, a, b) => o[k] ? F.u(o[k][0], o[k][1]) : F.u(a, b);
  const pal = drawPalette(F, o.pals || Object.keys(GAS_PAL), wild);
  const jets = o.jets ? F.i(o.jets[0], o.jets[1]) : F.i(1, 13);
  const spots = o.spots ? F.i(o.spots[0], o.spots[1]) : F.pick([0, 1, 1, 1, 2, 2, 3, 4]);
  const polar = F.pick(o.polar || [0, 1, 1, 2, 3, 4]);
  const gx = {
    v: 1, jets, profile: F.coin(0.5) ? F.u(0.5, 1) : F.u(1, 2.1), asym: F.coin(0.45) ? F.u(0.2, 1) : F.u(0, 0.15),
    eqJet: R('eqJet', -1.6, 1.8), eqWidth: F.u(0.12, 0.6), jetAmp: F.u(0.15, 1.1), jetDecay: F.u(0, 0.9),
    kh: F.coin(0.75) ? F.u(0.3, 1) : F.u(0, 0.25), khWaves: F.i(8, 64), accent: F.u(0, 0.75), patchy: F.coin(0.5) ? F.u(0.2, 0.9) : F.u(0, 0.2),
    spots, spotSize: F.u(0.07, 0.26), ovalChains: F.i(0, 3), polar, polySides: F.i(4, 9), polyLat: F.u(66, 82), cyclones: F.i(4, 10),
    hood: F.u(0, 0.8), albedo: R('albedo', 0.75, 1.15), aurora: F.coin(o.aurora ?? 0.35) ? F.u(0.3, 1) : 0, auroraLat: F.u(62, 80),
    glowT: R('glowT', 1100, 1800), col: pal.col,
  };
  const base = PR.ATMO[pal.atmo] || PR.ATMO.jupiter;
  // thin the sky: a full Jupiter sky washes the chromophores to lavender
  const rk = F.u(0.25, 0.9), mk = F.u(0.3, 1.1), hz = pal.col.haze;
  const atmo = { ...base, rayleigh: base.rayleigh.map(v => v * rk), mie: base.mie.map(v => v * mk),
    mieAbs: base.mieAbs.map((v, i) => v * (1.5 - hz[i])), density: F.u(0.45, 1.0) };
  const ringOn = F.coin(o.rings ?? 0.3);
  const rc = F.pick([[0.82, 0.76, 0.64], [0.6, 0.58, 0.56], [0.75, 0.62, 0.5], [0.85, 0.85, 0.88], [0.45, 0.4, 0.38], pal.palette.stops[3][1]]);
  const out = {
    kind: 'gas',
    bands: { count: Math.min(32, 2 * jets + 1), contrast: R('contrast', 0.15, 1.25), jitter: F.u(0.1, 0.8), symmetric: F.coin(0.55) ? 1 : 0, soft: F.u(0.12, 0.65), equatorJet: gx.eqJet, jetWidth: gx.eqWidth },
    turbulence: { amount: F.u(0.15, 1.2), freq: F.u(1.5, 7.5), octaves: F.u(4, 6), lacunarity: 2.1, gain: F.u(0.45, 0.62), advect: F.u(0.15, 1.5), steps: F.i(3, 5), streak: F.u(3, 16), shear: F.u(0.3, 1) },
    storms: { spot: spots > 0 ? 1 : 0, spotLat: F.u(-38, 38), spotLon: F.u(0, 1), spotSize: gx.spotSize, ovals: 0, ovalLat: 0, small: F.coin(0.7) ? F.i(5, 110) : F.i(0, 6), polar: 0 },
    haze: { amount: R('haze', 0.03, 0.45), polar: F.u(0, 0.8) },
    glow: o.glow ? F.u(o.glow[0], o.glow[1]) : 0,
    clouds: { cover: F.coin(0.6) ? F.u(0.02, 0.35) : 0, color: F.tint([1, 1, 1], 0.05) },
    relief: F.u(25, 70), radiusKm: R('radius', 40000, 100000), bump: F.u(3, 9), tilt: F.coin(0.15) ? F.u(50, 90) : F.u(0, 32), spin: F.u(1.4, 3.2),
    palette: pal.palette, atmo,
    rings: { on: ringOn ? 1 : 0, inner: F.u(1.12, 1.5), outer: F.u(1.8, 2.9), opacity: F.u(0.35, 0.95), color: F.tint(rc, 0.08) },
    gx,
  };
  const rx = { gaps: F.i(0, 7), ringlets: F.u(0, 1), dust: F.coin(0.25) ? F.u(0.4, 1) : F.u(0, 0.2), bright: F.u(0, 1), c2: F.tint(rc.map(v => v * F.u(0.7, 1.1)), 0.12) };
  if (ringOn) out.ringx = rx;
  return out;
}

// Widen a rocky family member: shape, sea and land colours, sky tint,
// clouds, a rare ring. k = 0 changes nothing; k = 1 is the widest.
export function rockyWiden(F, P, k = 1) {
  const Q = PR.clone(P), m = (v, a, b) => v * F.u(1 - a * k, 1 + b * k);
  Q.terrain.freq = m(Q.terrain.freq, 0.4, 0.7); Q.terrain.amp = m(Q.terrain.amp, 0.3, 0.3);
  Q.terrain.warp = Math.max(0, Q.terrain.warp + F.u(-0.08, 0.35) * k);
  Q.mountains.amp = m(Q.mountains.amp, 0.5, 0.6); Q.mountains.sharpness = m(Q.mountains.sharpness, 0.25, 0.35);
  if (Q.plates.count > 0) Q.plates.count = Math.round(m(Q.plates.count, 0.5, 0.8));
  if (Q.craters.density > 0) Q.craters.density = m(Q.craters.density, 0.5, 0.6);
  else if (F.coin(0.15 * k)) Q.craters.density = F.u(0.03, 0.25);
  if (Q.terrain.dichotomy === 0 && F.coin(0.25 * k)) Q.terrain.dichotomy = F.u(0.3, 1);
  // land minerals turn together; the sea turns on its own
  const dh = F.u(-28, 28) * k, ks = F.u(1 - 0.35 * k, 1 + 0.45 * k), kv = F.u(1 - 0.15 * k, 1 + 0.12 * k);
  for (const key of ['beach', 'low', 'high', 'rock', 'dark', 'bright', 'accent']) Q.palette[key] = hueShift(Q.palette[key], dh, ks, kv);
  const ds = F.u(-35, 35) * k, dk = F.u(1 - 0.2 * k, 1 + 0.3 * k);
  for (const key of ['deep', 'shallow']) Q.palette[key] = hueShift(Q.palette[key], ds, dk, 1);
  if (Q.atmo.on) {
    const t = F.f(0.45 * k), mk = F.u(1 - 0.4 * k, 1 + 0.6 * k);
    Q.atmo = { ...Q.atmo, rayleigh: Q.atmo.rayleigh.map((v, i) => v * t[i]), mie: Q.atmo.mie.map(v => v * mk), density: Q.atmo.density * F.u(1 - 0.3 * k, 1 + 0.4 * k) };
  }
  if (Q.clouds.cover > 0) Q.clouds.cover = Math.min(0.65, Math.max(0.02, Q.clouds.cover + F.u(-0.18, 0.08) * k));
  if (F.coin(0.1 * k) && !(Q.view && Q.view.lockSun)) Q.tilt = F.u(40, 85);
  if (!Q.rings.on && F.coin(0.12 * k)) {
    const rc = F.pick([[0.62, 0.6, 0.58], [0.75, 0.66, 0.55], [0.85, 0.86, 0.9], [0.5, 0.42, 0.36]]);
    Q.rings = { on: 1, inner: F.u(1.3, 1.8), outer: F.u(2, 3), opacity: F.u(0.3, 0.8), color: F.tint(rc, 0.08) };
    Q.ringx = { gaps: F.i(0, 5), ringlets: F.u(0, 1), dust: F.u(0, 0.6), bright: F.u(0, 1), c2: F.tint(rc, 0.15) };
  }
  return Q;
}

// ── new families ────────────────────────────────────────────────────────
const SOOT = { ...PR.ATMO.titan, radiusKm: 6000, heightKm: 140, rayleigh: [0.6, 1.2, 2.6], mie: [12, 9.5, 7], mieAbs: [7, 9, 12], mieH: 12, density: 1, clarity: 0.75 };
const SUPER = { ...PR.ATMO.earth, radiusKm: 6360, heightKm: 130, rayleighH: 9 };
const GAS_FAMILY = {
  icegiant: { pals: ['uranus', 'neptune', 'uranus', 'silver'], jets: [1, 5], eqJet: [-1.8, -0.5], contrast: [0.08, 0.55], haze: [0.35, 0.85], radius: [21000, 29000], aurora: 0.4, rings: 0.35, albedo: [0.95, 1.25], spots: [0, 2], polar: [0, 0, 4, 1], wild: 0.45 },
  hotneptune: { pals: ['neptune', 'purple', 'silver', 'hot', 'uranus'], jets: [1, 6], contrast: [0.15, 0.7], haze: [0.5, 1], radius: [15000, 32000], glow: [0.25, 0.9], glowT: [1000, 1500], rings: 0.05, albedo: [0.7, 1.05], wild: 0.8 },
  puffy: { pals: ['cream', 'silver', 'saturn', 'cream'], jets: [2, 8], contrast: [0.06, 0.4], haze: [0.55, 1], radius: [100000, 150000], rings: 0.2, albedo: [1.05, 1.3], spots: [0, 1], wild: 0.4 },
  browndwarf: { pals: ['browndwarf', 'red', 'browndwarf'], jets: [6, 14], contrast: [0.4, 1.1], haze: [0.05, 0.3], radius: [60000, 85000], glow: [1.3, 2], glowT: [850, 1500], aurora: 0.8, rings: 0.03, albedo: [0.5, 0.8], wild: 0.5 },
  ringed: { pals: ['saturn', 'jupiter', 'silver', 'cream', 'sulphur', 'uranus'], rings: 1, wild: 0.6 },
  exotic: { pals: ['purple', 'green', 'red', 'sulphur'], rings: 0.3, wild: 1 },
  // the old giant presets, for "within this type"
  jupiter: { pals: ['jupiter'], jets: [4, 10], wild: 0.5, rings: 0.08 },
  saturn: { pals: ['saturn', 'saturn', 'cream'], jets: [5, 12], contrast: [0.15, 0.55], rings: 0.92, wild: 0.45, polar: [2, 2, 3, 1] },
  neptune: { pals: ['neptune', 'uranus'], jets: [1, 5], eqJet: [-1.8, -0.5], contrast: [0.1, 0.6], radius: [21000, 29000], wild: 0.45, rings: 0.2 },
  hotjupiter: { pals: ['hot', 'hot', 'browndwarf', 'red'], glow: [0.6, 1.6], glowT: [1100, 1800], wild: 0.5, albedo: [0.55, 0.9], rings: 0.03 },
};
export { GAS_FAMILY };

// presets.js hands vary() its own dice (u, i, pick, tint, f); X adds r and coin
const X = F => F.coin ? F : { ...F, r: () => F.u(0, 1), coin: p => F.u(0, 1) < p };
const gasPreset = (id, name, seed, blurb) => ({ id, name, kind: 'gas', seed, blurb, gen: true, p: {}, vary: F => gasWild(X(F), GAS_FAMILY[id]) });

export const NEW_PRESETS = [
  { id: 'carbon', name: 'Carbon world', kind: 'rocky', seed: 6012, gen: true, blurb: 'graphite plains, silicon carbide ridges and black tar seas under a sooty brown haze',
    p: { terrain: { amp: 0.8, warp: 0.3 }, plates: { count: 8, weight: 0.25 }, mountains: { amp: 0.5, sharpness: 2.8 }, erosion: { strength: 1.2, flow: 0.4 },
      ocean: { level: 0.28, liquid: 0 }, climate: { equatorC: 260, poleC: 140, lapse: 3, moisture: 0, life: 0, iceC: -300, cities: 0 },
      dunes: { amount: 0.5, freq: 44 }, craters: { density: 0.06, ejecta: 0.2 },
      clouds: { cover: 0.25, color: [0.5, 0.44, 0.38], cirrus: 0.2 }, relief: 12, radiusKm: 7000, tilt: 14,
      palette: { deep: [0.015, 0.012, 0.01], shallow: [0.05, 0.04, 0.03], beach: [0.18, 0.17, 0.16], low: [0.12, 0.12, 0.13], high: [0.24, 0.24, 0.26], rock: [0.16, 0.16, 0.17], dark: [0.06, 0.06, 0.07], bright: [0.55, 0.56, 0.6], accent: [0.3, 0.22, 0.14] },
      atmo: SOOT },
    vary: F => ({ ocean: { level: F.u(0.05, 0.5) }, plates: { count: F.i(3, 14) }, terrain: { freq: F.u(0.7, 1.6), warp: F.u(0.15, 0.5) },
      climate: { equatorC: F.u(150, 420), poleC: F.u(60, 250) }, clouds: { cover: F.u(0.05, 0.45) }, dunes: { amount: F.u(0, 1) },
      radiusKm: F.u(4500, 11000), tilt: F.u(0, 40),
      palette: { bright: F.tint([0.55, 0.56, 0.6], 0.15), accent: F.tint([0.3, 0.22, 0.14], 0.3), low: F.tint([0.12, 0.12, 0.13], 0.25) },
      atmo: { density: F.u(0.5, 1.6), mie: SOOT.mie.map(v => v * F.u(0.6, 1.4)) } }) },
  { id: 'iron', name: 'Iron world', kind: 'rocky', seed: 2604, gen: true, blurb: 'a dense, metal-rich world stripped of its mantle: dark cratered plains, lobate scarps, bright young rays',
    p: { terrain: { amp: 0.3, warp: 0.15 }, plates: { count: 0 }, mountains: { amp: 0.12 }, erosion: { strength: 0.3, detail: 0.08 },
      craters: { density: 0.9, rMin: 0.005, rMax: 0.22, slope: 2.0, depth: 1.0, rim: 1.1, ejecta: 1.0, maria: 0.3 },
      cracks: { amount: 0.35, freq: 1.6 }, ocean: { level: 0 }, climate: { equatorC: 330, poleC: -160, lapse: 0, moisture: 0, life: 0, iceC: -300 },
      clouds: { cover: 0 }, relief: 14, radiusKm: 2440, tilt: 0.1, spin: 0.4, bump: 4,
      palette: { low: [0.36, 0.34, 0.33], high: [0.5, 0.48, 0.46], rock: [0.3, 0.29, 0.28], dark: [0.14, 0.13, 0.13], bright: [0.7, 0.68, 0.66], accent: [0.45, 0.3, 0.22] },
      atmo: PR.ATMO.none },
    vary: F0 => {
      const F = X(F0), dh = F.u(-25, 35), kv = F.u(0.75, 1.15), ks = F.u(0.6, 1.8), sh = c => hueShift(c, dh, ks, kv);
      const hot = F.coin(0.25);
      return { craters: { density: F.u(0.4, 1.3), maria: F.u(0, 0.6), ejecta: F.u(0.6, 1.3) }, cracks: { amount: F.u(0.15, 0.7), freq: F.u(1, 3), glow: hot ? F.u(0.4, 1.2) : 0 },
        terrain: { amp: F.u(0.15, 0.5) }, radiusKm: F.u(1500, 5200), tilt: F.u(0, 5),
        palette: { low: sh([0.36, 0.34, 0.33]), high: sh([0.5, 0.48, 0.46]), rock: sh([0.3, 0.29, 0.28]), dark: sh([0.14, 0.13, 0.13]), bright: sh([0.7, 0.68, 0.66]), accent: sh([0.45, 0.3, 0.22]) } };
    } },
  { id: 'eyeball', name: 'Eyeball world', kind: 'rocky', seed: 1214, gen: true, blurb: 'tidally locked: one face to its star, an open sea at the warm pole, ice over the rest; the sun stays put',
    p: { ocean: { level: 0.6 }, plates: { count: 12 }, climate: { equatorC: -55, poleC: 28, lapse: 6, moisture: 0.6, life: 0.7, iceC: -6, cities: 0 },
      clouds: { cover: 0.4, cyclones: 2 }, relief: 10, radiusKm: 6900, tilt: 90, spin: 0.15, view: { sunAz: 0, sunEl: 0, lockSun: 1 } },
    vary: F => ({ ocean: { level: F.u(0.45, 0.85) }, plates: { count: F.i(6, 18) }, climate: { equatorC: F.u(-80, -35), poleC: F.u(12, 42), moisture: F.u(0.4, 0.9), life: F.u(0, 1) },
      clouds: { cover: F.u(0.25, 0.55) }, radiusKm: F.u(5000, 9000),
      palette: { deep: F.tint([0.03, 0.07, 0.17], 0.3), shallow: F.tint([0.06, 0.2, 0.32], 0.3) } }) },
  { id: 'superearth', name: 'Super-Earth', kind: 'rocky', seed: 5521, gen: true, blurb: 'twice the size of Earth: many small plates, deep seas, low relief, a thick bright sky',
    p: { ocean: { level: 0.7 }, plates: { count: 24, uplift: 0.6, width: 0.08 }, mountains: { amp: 0.4 }, terrain: { freq: 1.4 },
      climate: { equatorC: 32, poleC: -8, moisture: 0.75, life: 0.9, cities: 0 }, clouds: { cover: 0.58, cyclones: 8 },
      relief: 7, radiusKm: 12500, tilt: 18, atmo: { ...SUPER, density: 1.8 } },
    vary: F => ({ ocean: { level: F.u(0.5, 0.92) }, plates: { count: F.i(16, 32) }, terrain: { freq: F.u(1, 2.2) }, mountains: { amp: F.u(0.25, 0.6) },
      climate: { equatorC: F.u(18, 42), poleC: F.u(-30, 10), moisture: F.u(0.4, 0.95), life: F.u(0.3, 1) }, clouds: { cover: F.u(0.45, 0.62), cyclones: F.i(3, 10) },
      relief: F.u(4, 10), radiusKm: F.u(9000, 16000), tilt: F.u(0, 40), atmo: { density: F.u(1.3, 2.6) },
      palette: { deep: F.tint([0.03, 0.07, 0.17], 0.3), shallow: F.tint([0.06, 0.2, 0.32], 0.3) } }) },
  gasPreset('icegiant', 'Ice giant', 2286, 'a methane-blue or cyan giant: few broad bands, a retrograde equator, dark spots, faint rings'),
  gasPreset('hotneptune', 'Hot Neptune', 4361, 'a small, hazy, heated giant close to its star: thick haze, a warm glow in the deep belts'),
  gasPreset('puffy', 'Puffy planet', 9104, 'a super-puff: a huge, low-density giant under a pale haze with soft, washed bands'),
  gasPreset('browndwarf', 'Brown dwarf', 1995, 'too small to be a star: a glowing banded body with patchy cloud decks and strong aurorae'),
  gasPreset('ringed', 'Ringed giant', 3306, 'a giant with a wide ring system: its own gaps, ringlets, dusty and bright rings'),
  gasPreset('exotic', 'Exotic giant', 7177, 'chromophores not seen in the solar system: purple, green, red or sulphur hazes'),
];

// register once (presets.js PRESETS is the one list the page reads)
for (const p of NEW_PRESETS) if (!PR.PRESETS.some(q => q.id === p.id)) PR.PRESETS.push(p);

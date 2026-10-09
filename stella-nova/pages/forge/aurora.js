// ============================================================================
//  PLANET FORGE  ·  aurora.js — aurorae: who has them, where, what colour
// ----------------------------------------------------------------------------
//  The recipe key P.aurora = { on, strength, activity, field, tilt, lon,
//  offset } (presets.js SCHEMA, group Aurora). planet.wgsl draws the
//  aurora as an emission marched along the view ray through a shell 100 to
//  300 km over the ground (scaled by the planet radius); this module gives
//  it the uniforms (auroraPack).
//
//  FIELD  field -1 = auto from the family: dipole on Earth-like, ocean,
//         ice, desert, lava and the other large rocky worlds with air;
//         crustal (patchy, no oval) on rust worlds; none on airless
//         worlds, Titan-like hazes and small bodies. Every giant has a
//         dipole. 0 none, 1 dipole, 2 crustal force it.
//         No field or no atmosphere: no aurora (auroraInfo().active 0).
//  OVAL   the oval sits round each magnetic pole at colatitude colat0:
//         about 20 deg (70 deg magnetic latitude) on Earth-like worlds,
//         15 deg on gas giants. activity (0..1) and a storm move it toward
//         the equator (up to +12 deg) and widen and brighten it. The
//         dipole axis is tilted from the spin axis by tilt (deg, from the
//         seed: 4-14 on rocky worlds, 2-10 on gas giants, 45-60 on ice
//         giants, which also get an offset centre of 0.3 radii).
//  COLOUR by composition (gas):
//         n2o2  N2+ 427.8 nm blue-violet at the lower edge, O 557.7 nm
//               green in the curtain, O 630 nm red at the top
//         h2    H-alpha pink and H3+ infrared shown as magenta-violet
//         co2   CO Cameron-band ultraviolet shown as violet, O green
//  GIANTS main ovals, the footprint of an inner moon (a spot with a trail
//         equatorward of the oval, its longitude turning with time) and
//         diffuse polar emission inside the oval.
//
//  grep -n targets: "export function auroraInfo", "export function auroraPack",
//  "export const AURORA_FLOATS", "const COLOURS", "function fieldOf"
// ============================================================================

export const AURORA_DEFAULT = { on: 1, strength: 1, activity: 0.35, field: -1, tilt: -1, lon: -1, offset: -1 };
export const AURORA_FLOATS = 24;

// low edge, curtain, top: linear RGB
const COLOURS = {
  n2o2: [[0.32, 0.16, 1.0], [0.18, 1.0, 0.38], [1.0, 0.12, 0.1]],
  h2: [[0.55, 0.16, 1.0], [1.0, 0.25, 0.75], [0.75, 0.25, 1.0]],
  co2: [[0.45, 0.25, 1.0], [0.35, 0.95, 0.45], [0.7, 0.45, 1.0]],
};
const ICE_GIANTS = new Set(['neptune', 'icegiant', 'hotneptune']);
const NO_FIELD = new Set(['titan', 'moon', 'volcanic', 'iron']);

// a hash of the seed to 0..1 (k picks the stream)
function u01(seed, k) {
  let h = Math.imul((seed >>> 0) ^ 0x51ed27, 0x9E3779B1) ^ Math.imul(k + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
function fieldOf(P) {
  const a = P.aurora || AURORA_DEFAULT;
  if (a.field >= 0) return a.field | 0;
  if (P.kind === 'gas') return 1;
  if (P.preset === 'rust') return 2;
  if (NO_FIELD.has(P.preset) || P.radiusKm < 2000) return 0;
  return 1;
}
function gasOf(P) {
  if (P.kind === 'gas') return 'h2';
  if (P.preset === 'rust' || P.preset === 'carbon') return 'co2';
  return 'n2o2';
}

// What the view draws for P: { active, field, gas, colat0 (rad), tilt (rad),
// lon (rad), offset (radii), giant, ice }.
export function auroraInfo(P) {
  const a = { ...AURORA_DEFAULT, ...(P && P.aurora) };
  const field = fieldOf(P), giant = P.kind === 'gas', ice = giant && ICE_GIANTS.has(P.preset);
  const air = !!(P.atmo && P.atmo.on);
  const D = Math.PI / 180, s = P.seed >>> 0;
  const tilt = a.tilt >= 0 ? a.tilt : ice ? 45 + 15 * u01(s, 1) : giant ? 2 + 8 * u01(s, 1) : 4 + 10 * u01(s, 1);
  return {
    active: a.on && field > 0 && air && a.strength > 0 ? 1 : 0,
    field, gas: gasOf(P), giant, ice,
    colat0: (giant ? 15 : 20) * D, tilt: tilt * D,
    lon: (a.lon >= 0 ? a.lon : u01(s, 2)) * 2 * Math.PI,
    offset: a.offset >= 0 ? a.offset : ice ? 0.3 : 0,
    strength: a.strength, activity: a.activity,
  };
}

// Uniform floats (6 vec4) for planet.wgsl, in the body frame:
//   aur0 axis.xyz, strength (0 = off: the shader skips the march)
//   aur1 colat0 + activity shift, width, r0, r1 (radii)
//   aur2 activity, time (sim minutes), kind (0 oval, 1 giant, 2 crustal), offset
//   aur3..5 colours low, curtain, top (w: 0)
// cam.auroraOn false turns it off; cam.storm (0..1) adds to the activity.
export function auroraPack(P, cam = {}, out = new Float32Array(AURORA_FLOATS), at = 0) {
  out.fill(0, at, at + AURORA_FLOATS);
  if (!P || cam.auroraOn === false) return out;
  const I = auroraInfo(P);
  if (!I.active) return out;
  const act = Math.min(1, Math.max(I.activity, cam.storm || 0) + 0.6 * (cam.storm || 0) * (1 - I.activity));
  const ax = [Math.sin(I.tilt) * Math.cos(I.lon), Math.cos(I.tilt), Math.sin(I.tilt) * Math.sin(I.lon)];
  const R = P.kind === 'gas' ? P.radiusKm : (P.atmo.radiusKm || P.radiusKm);
  // the curtains: 100 to 300 km on a 6371 km world, at least 0.6 % of the
  // radius thick (so they read on small worlds and on the display giants)
  const r0 = 1 + Math.max(100 / R, 0.004), r1 = 1 + Math.max(300 / R, 0.012);
  const C = COLOURS[I.gas];
  const v = [
    ax[0], ax[1], ax[2], I.strength * (1 + 1.2 * act),
    I.colat0 + 0.21 * act, (I.giant ? 0.016 : 0.02) * (1 + 1.5 * act), r0, r1,
    act, (cam.hours || 0) * 60, I.field === 2 ? 2 : I.giant ? 1 : 0, I.offset,
    ...C[0], 0, ...C[1], 0, ...C[2], 0,
  ];
  out.set(v, at);
  return out;
}

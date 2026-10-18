// ============================================================================
//  DLA TERRAIN  ·  world/celestial-gen.js — the bodies in the night sky as
//  numbers (package CELESTIAL). DOM-free ES module: node tests import it.
// ----------------------------------------------------------------------------
//  The user: "use a real starfield and raondomize number of moons and
//  texture/if orbiting a gas giant like in avatar during nighttime (wiht
//  realistic solar system /lighting) that should all be random but weighted
//  towards a single earthlike moon".
//
//  SYSTEM  celestialSystem(seed, mode) picks the sky of a world. With mode
//    'random' the split is SKY_WEIGHTS: 70 % one Moon-like moon, 18 % two or
//    three moons, 12 % a world that is itself a moon of a gas giant (as
//    Pandora and Polyphemus in Avatar). 'one', 'several' and 'giant' force
//    a kind. Each moon takes a real map (NASA, assets/sky/CREDITS.txt), the
//    real radius and geometric albedo of that body, and a random orbit.
//  FRAMES  equatorial (J2000): x to the vernal equinox, z to the north
//    celestial pole. World: x east, y up, z south (sky-state.js).
//    eqToWorld(lst, lat) is the 3 x 3 rotation; the local sidereal time is
//    the hour angle of the sun (sky-state.js solarPosition) plus the right
//    ascension of the sun, so the stars, the sun and the bodies agree.
//  ORBITS  moons of the home world: Kepler orbits round a planet of one
//    Earth mass, inclined to the ecliptic, seen from a point on the surface
//    (the topocentric parallax of a near moon is about 1 deg). Gas giant
//    worlds: the home world is tidally locked, so the giant stands still in
//    the local sky at a fixed hour angle on the celestial equator and goes
//    through its phases once a day (full at midnight). In the eclipse
//    seasons (the sun near the equator, that is near the equinoxes) the sun
//    goes behind the giant once a day. The other moons of the giant orbit
//    it with the Kepler ratio of periods, so they transit and pass behind it.
//  PHASE  the sun is far, so a body is lit from the world sun direction:
//    lit fraction (1 - dot(sun, body)) / 2. The shader shades each sphere
//    with that direction, so the lit side faces the sun.
//  LIGHT  irradiance at the top of the air: E_sun x p x (R / d)^2 x phi(a),
//    p the geometric albedo, phi the phase law (rocky: the lunar law of
//    Allen; gas giant: a Lambert sphere). A full Moon gives 0.32 lux above
//    the air, 0.25 lux at the ground. Light at the ground: extinction of
//    0.25 mag per airmass (Kasten and Young). nightLights() lists the
//    bodies above the horizon, brightest first, for ATMO (NOTES.md).
//  ECLIPSES  the sun: the part of the sun disc a body hides (circle
//    overlap). A moon in the umbra of its planet turns dark red.
//  TIME  createCelestial(seed, mode).at(tod, season, latitude) counts the
//    day wraps of tod, so a moon keeps moving from day to day.
//
//  grep -n targets
//    "export const SKY_WEIGHTS", "export const BODY_MAPS", "function rng",
//    "export function systemKind", "export function celestialSystem",
//    "export function eqToWorld", "export function localSidereal",
//    "export function phaseLaw", "export function hdrIrradiance",
//    "export function discOverlap", "export function celestialAt",
//    "export function nightLights", "export function createCelestial",
//    "export function starColor", "export function parseStars"
// ============================================================================
import { solarPosition, MOON_ILLUM } from '../sky-state.js';

export const SKY_MODES = Object.freeze(['random', 'one', 'several', 'giant']);
export const SKY_MODE_LABELS = Object.freeze({ random: 'Random', one: 'One moon', several: 'Several moons', giant: 'Gas giant' });
// The split of 'random' (the user: "weighted towards a single earthlike
// moon"). tests/celestial.test.mjs checks it over 10,000 seeds.
export const SKY_WEIGHTS = Object.freeze({ one: 0.70, several: 0.18, giant: 0.12 });

export const SUN_LUX = 1.27e5;         // solar illuminance at 1 AU, top of the air (V band)
export const FULL_MOON_LUX = 0.25;     // at the ground, the reference of MOON_ILLUM
export const SUN_ANG_R = 0.2665 * Math.PI / 180;
export const OBLIQUITY = 23.44 * Math.PI / 180;
export const HOME = Object.freeze({ R: 6371, albedo: 0.30, gm: 398600 });  // km, Bond-ish, km^3/s^2
export const MAX_BODIES = 5;

const D2R = Math.PI / 180, TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

// Real bodies: radius km, geometric albedo p (V), map id in assets/sky,
// sat = colour saturation of the map in the shader (the NASA Titan map is
// a flat orange, 0.45 keeps it a haze colour).
export const BODY_MAPS = Object.freeze({
  moon:      { name: 'Moon-like',      R: 1737.4, p: 0.12, law: 'rocky', sat: 1 },
  io:        { name: 'Io-like',        R: 1821.6, p: 0.63, law: 'rocky', sat: 1 },
  europa:    { name: 'Europa-like',    R: 1560.8, p: 0.67, law: 'rocky', sat: 1 },
  ganymede:  { name: 'Ganymede-like',  R: 2634.1, p: 0.43, law: 'rocky', sat: 1 },
  callisto:  { name: 'Callisto-like',  R: 2410.3, p: 0.22, law: 'rocky', sat: 1 },
  titan:     { name: 'Titan-like',     R: 2574.7, p: 0.22, law: 'giant', sat: 0.45 },
  enceladus: { name: 'Enceladus-like', R: 252.1,  p: 0.99, law: 'rocky', sat: 1 },
  rhea:      { name: 'Rhea-like',      R: 763.8,  p: 0.95, law: 'rocky', sat: 1 },
  iapetus:   { name: 'Iapetus-like',   R: 734.5,  p: 0.30, law: 'rocky', sat: 1 },
  // Phobos is 11 km: the map goes on a captured body of 150 .. 450 km
  phobos:    { name: 'Phobos-like',    R: 300,    p: 0.07, law: 'rocky', sat: 1, Rrange: [150, 450] },
  triton:    { name: 'Triton-like',    R: 1353.4, p: 0.72, law: 'rocky', sat: 1 },
  jupiter:   { name: 'Jupiter-like',   R: 69911,  p: 0.52, law: 'giant', sat: 1, gm: 1.26687e8, rot: 0.414 },
  saturn:    { name: 'Saturn-like',    R: 58232,  p: 0.47, law: 'giant', sat: 1, gm: 3.7931e7, rot: 0.444, ring: true },
  uranus:    { name: 'Uranus-like',    R: 25362,  p: 0.49, law: 'giant', sat: 1, gm: 5.7940e6, rot: 0.718 },
  neptune:   { name: 'Neptune-like',   R: 24622,  p: 0.44, law: 'giant', sat: 1, gm: 6.8365e6, rot: 0.671 },
});
const MOON_POOL = ['moon', 'io', 'europa', 'ganymede', 'callisto', 'titan', 'enceladus', 'rhea', 'iapetus', 'phobos', 'triton'];
const GIANT_POOL = [['jupiter', 0.45], ['saturn', 0.30], ['neptune', 0.15], ['uranus', 0.10]];

// mulberry32 on the seed and a salt: one stream per use, so a change in one
// part of the generator leaves the others as they are.
function rng(seed, salt) {
  let a = ((seed >>> 0) ^ Math.imul(salt + 0x9e37, 0x85ebca6b)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickW = (r, list) => { let u = r() * list.reduce((s, x) => s + x[1], 0); for (const [k, w] of list) { u -= w; if (u <= 0) return k; } return list[list.length - 1][0]; };
const logU = (r, a, b) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * r());

export function systemKind(seed, mode = 'random') {
  if (mode === 'one' || mode === 'several' || mode === 'giant') return mode;
  const u = rng(seed, 1)();
  return u < SKY_WEIGHTS.one ? 'one' : u < SKY_WEIGHTS.one + SKY_WEIGHTS.several ? 'several' : 'giant';
}

function tintFor(r, amount) {
  // a small change of hue and value of a real map, per seed
  const h = (r() - 0.5) * amount, v = 1 + (r() - 0.5) * amount * 0.6;
  return [v * (1 + h), v * (1 - Math.abs(h) * 0.3), v * (1 - h)];
}

function moonBody(r, id, a, parent, extra = {}) {
  const m = BODY_MAPS[id];
  const R = m.Rrange ? m.Rrange[0] + (m.Rrange[1] - m.Rrange[0]) * r() : m.R * (0.88 + 0.24 * r());
  return {
    id: id + '-' + Math.floor(r() * 1e6), map: id, name: m.name, kind: 'moon', parent,
    R, a, p: m.p, law: m.law, sat: m.sat, tint: id === 'moon' ? [1, 1, 1] : tintFor(r, 0.25),
    incl: (parent === 'home' ? 1 + 7 * r() : 3 * r()) * D2R, node: TAU * r(), phase0: TAU * r(),
    ...extra,
  };
}

// The sky of a world. Pure function of (seed, mode).
export function celestialSystem(seed, mode = 'random') {
  const kind = systemKind(seed, mode);
  const r = rng(seed, 2);
  const sys = { seed: seed >>> 0, mode, kind, bodies: [], giant: null };
  const kepler = (a, gm) => TAU * Math.sqrt(a * a * a / gm) / 86400;   // days
  if (kind === 'one') {
    // the Moon: real radius, albedo, inclination and the LRO map; the
    // distance and the start of the orbit change per seed
    const b = moonBody(r, 'moon', 384400 * (0.93 + 0.14 * r()), 'home');
    b.R = 1737.4; b.incl = 5.145 * D2R;
    b.P = kepler(b.a, HOME.gm) * 0.9877;   // the Moon's mass adds 1.2 % to G M
    sys.bodies.push(b);
  } else if (kind === 'several') {
    const n = r() < 0.65 ? 2 : 3;
    const pool = MOON_POOL.slice();
    // half of these skies keep the Moon among them
    if (r() < 0.5) pool.splice(0, 0, 'moon', 'moon');
    const used = new Set(), as = [];
    for (let i = 0; i < n; i++) {
      let id; do { id = pool[Math.floor(r() * pool.length)]; } while (used.has(id));
      used.add(id);
      let a = 0, R0 = BODY_MAPS[id].R;
      for (let k = 0; k < 24; k++) {
        const rho = logU(r, 0.07, 0.75) * D2R;
        a = clamp(R0 / Math.tan(rho), 2.6 * HOME.R, 1.2e6);
        if (as.every((x) => Math.max(a / x, x / a) > 1.4)) break;
      }
      as.push(a);
      const b = moonBody(r, id, a, 'home');
      b.P = kepler(a, HOME.gm);
      sys.bodies.push(b);
    }
  } else {
    const gid = pickW(r, GIANT_POOL), g = BODY_MAPS[gid];
    const sc = 0.85 + 0.35 * r();
    const R = g.R * sc;
    const rho = logU(r, 3.5, 12) * D2R;                  // angular radius 3.5 .. 12 deg
    const aH = R / Math.sin(rho);
    const ringOn = g.ring || r() < 0.3;
    sys.giant = {
      id: gid + '-giant', map: gid, name: g.name, kind: 'giant', parent: null, R, a: aH, p: g.p, law: 'giant', sat: 0.75 + 0.5 * r(),
      tint: tintFor(r, 0.45), gm: g.gm * sc * sc * sc, rot: g.rot * (0.8 + 0.4 * r()),
      // locked: the hour angle where it stands, the tilt of its equator
      // (the ring plane) to the home orbit, the start of its spin
      lockH: (r() * 2 - 1) * 55 * D2R, ringTilt: (1.5 + 8 * r()) * D2R, ringNode: TAU * r(), spin0: TAU * r(),
      ring: ringOn ? { inner: g.ring ? 1.11 : 1.3 + 0.2 * r(), outer: g.ring ? 2.33 : 1.8 + 0.5 * r(), opacity: g.ring ? 1 : 0.2 + 0.3 * r() } : null,
    };
    sys.giant.P = kepler(aH, sys.giant.gm);              // the home orbit = the day (days)
    // other moons of the giant
    const u = r(), nS = u < 0.25 ? 0 : u < 0.6 ? 1 : u < 0.85 ? 2 : 3;
    const as = [aH];
    for (let i = 0; i < nS; i++) {
      let a = aH;
      for (let k = 0; k < 24; k++) {
        a = aH * logU(r, 0.45, 3.2);
        if (a > 1.6 * R && as.every((x) => Math.max(a / x, x / a) > 1.25)) break;
      }
      as.push(a);
      const id = MOON_POOL[1 + Math.floor(r() * (MOON_POOL.length - 1))];
      const b = moonBody(r, id, a, 'giant');
      b.ratio = Math.pow(aH / a, 1.5);   // its angular speed over that of the home world
      sys.bodies.push(b);
    }
    sys.bodies.push(sys.giant);
  }
  return sys;
}

// ── frames ─────────────────────────────────────────────────────────────────
// World vector = M x equatorial vector (rows of M), lst local sidereal time
// rad, lat rad. Same relations as sky-state.js altAz.
export function eqToWorld(lst, lat) {
  const sL = Math.sin(lst), cL = Math.cos(lst), sp = Math.sin(lat), cp = Math.cos(lat);
  return [
    -sL, cL, 0,
    cp * cL, cp * sL, sp,
    sp * cL, sp * sL, -cp,
  ];
}
const mul = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
const mulT = (M, v) => [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const eclToEq = (v) => [v[0], v[1] * Math.cos(OBLIQUITY) - v[2] * Math.sin(OBLIQUITY), v[1] * Math.sin(OBLIQUITY) + v[2] * Math.cos(OBLIQUITY)];

// Right ascension of the sun for season 0..1 (0 the March equinox) and the
// local sidereal time for tod (0.5 solar noon), as sky-state.js has the sun.
export function sunRA(season) {
  const lam = TAU * season;
  return Math.atan2(Math.cos(OBLIQUITY) * Math.sin(lam), Math.cos(lam));
}
export function localSidereal(tod, season) { return (tod - 0.5) * TAU + sunRA(season); }

// RA, Dec (rad) -> equatorial unit vector
export const radecToEq = (ra, dec) => [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];

// ── light ──────────────────────────────────────────────────────────────────
// Phase law phi(alpha) with phi(0) = 1. alpha the phase angle rad.
export function phaseLaw(alpha, law) {
  const a = clamp(alpha, 0, Math.PI);
  if (law === 'giant') return (Math.sin(a) + (Math.PI - a) * Math.cos(a)) / Math.PI;   // Lambert sphere
  const d = a / D2R;
  if (d > 165) return 0;
  return Math.pow(10, -0.4 * (0.026 * d + 4e-9 * d * d * d * d));    // the Moon (Allen)
}
// lux at the ground -> the HDR irradiance units of G.moonDir.w. Linear up to
// a full Moon (MOON_ILLUM at 0.25 lux, as sky-state.js), then a power 0.45,
// which reaches the sun value SUN_ILLUM = 20 at 1e5 lux: a full gas giant
// (hundreds of lux) gives a night far brighter than the Moon, still under
// the day.
export function hdrIrradiance(lux) {
  const x = Math.max(lux, 0) / FULL_MOON_LUX;
  return MOON_ILLUM * (x <= 1 ? x : Math.pow(x, 0.45));
}
// Airmass (Kasten and Young 1989) and V-band extinction 0.25 mag / airmass.
export function extinction(elevRad) {
  const h = elevRad / D2R;
  if (h < -1) return 0;
  const X = 1 / (Math.sin(Math.max(h, 0) * D2R) + 0.50572 * Math.pow(Math.max(h, 0) + 6.07995, -1.6364));
  return Math.pow(10, -0.4 * 0.25 * X) * smooth(-1, 0.5, h);
}
// The part of disc 1 (radius r1) that disc 2 (radius r2) covers, centres d
// apart (all angles in rad, small-angle plane geometry).
export function discOverlap(r1, r2, d) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r2 - r1)) return r2 >= r1 ? 1 : (r2 * r2) / (r1 * r1);
  const a = r1 * r1 * Math.acos(clamp((d * d + r1 * r1 - r2 * r2) / (2 * d * r1), -1, 1));
  const b = r2 * r2 * Math.acos(clamp((d * d + r2 * r2 - r1 * r1) / (2 * d * r2), -1, 1));
  const c = 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  return (a + b - c) / (Math.PI * r1 * r1);
}

// Fraction of the sun that reaches a point at pos (km, equatorial, from the
// shadow body centre at c, radius R): 0 in the umbra, 1 outside the penumbra.
function sunReach(pos, c, R, sunEq) {
  const v = sub(pos, c), along = dot(v, sunEq);
  if (along > 0) return 1;                  // the body is on the sun side of the caster
  const perp = len(sub(v, scl(sunEq, along)));
  const w = -along * Math.tan(SUN_ANG_R);
  return smooth(R - w, R + w, perp);
}

// ── state at a time ────────────────────────────────────────────────────────
// days: the day count (tod + whole days, continuous). Returns the bodies in
// world space and the light list. sun: optional world sun vector (else
// sky-state.js solarPosition).
export function celestialAt(sys, tod, season, latitude, days = tod, sun = null) {
  const lat = latitude * D2R;
  const lst = localSidereal(tod, season);
  const M = eqToWorld(lst, lat);
  const sunW = sun || solarPosition(((tod % 1) + 1) % 1, season, latitude).dir;
  const sunEq = norm(mulT(M, sunW));
  const obs = scl(mulT(M, [0, 1, 0]), HOME.R);        // observer, from the home centre (km, eq)
  const D = season * 365.25 + days;                     // days since a fixed epoch
  const out = [];
  let giantPos = null;
  const g = sys.giant;
  if (g) {
    // the giant stands at hour angle lockH on the equator: RA = lst - lockH
    const ra = lst - g.lockH;
    giantPos = scl([Math.cos(ra), Math.sin(ra), 0], g.a);
  }
  // the unwrapped orbit angle of the home world round the giant
  const thetaH = TAU * (days - 0.5) + sunRA(season) - (g ? g.lockH : 0) + Math.PI;
  for (const b of sys.bodies) {
    let pos, pole, prime, parentPos;
    if (b.kind === 'giant') {
      pos = giantPos;
      const tn = b.ringTilt, nn = b.ringNode;
      pole = [Math.sin(tn) * Math.cos(nn), Math.sin(tn) * Math.sin(nn), Math.cos(tn)];
      const spin = b.spin0 + TAU * D / b.rot;
      const e1 = norm(cross(pole, [1, 0, 0])), e2 = cross(pole, e1);
      prime = add(scl(e1, Math.cos(spin)), scl(e2, Math.sin(spin)));
      parentPos = null;
    } else {
      let th, orbitPos;
      if (b.parent === 'giant') th = b.phase0 + thetaH * b.ratio;
      else th = b.phase0 + TAU * D / b.P;
      // orbit plane: inclined by incl about the line of nodes
      const c = Math.cos(th), s = Math.sin(th), ci = Math.cos(b.incl), si = Math.sin(b.incl);
      const cn = Math.cos(b.node), sn = Math.sin(b.node);
      const o = [c, s * ci, s * si];
      const onode = [o[0] * cn - o[1] * sn, o[0] * sn + o[1] * cn, o[2]];
      const nrm0 = [0, -si, ci], nrm = [nrm0[0] * cn - nrm0[1] * sn, nrm0[0] * sn + nrm0[1] * cn, nrm0[2]];
      if (b.parent === 'giant') {
        // round the giant, in its equator (the celestial equator here)
        orbitPos = scl(onode, b.a);
        pos = add(giantPos, orbitPos);
        pole = nrm; parentPos = giantPos;
      } else {
        // round the home world, inclined to the ecliptic
        pos = scl(eclToEq(onode), b.a);
        pole = eclToEq(nrm); parentPos = [0, 0, 0];
      }
      // tidally locked: longitude 0 of the map faces the parent
      const toP = sub(parentPos, pos);
      prime = norm(sub(toP, scl(pole, dot(toP, pole))));
    }
    const rel = sub(pos, obs);
    const dist = len(rel);
    const dirEq = scl(rel, 1 / dist);
    const dir = mul(M, dirEq);
    const angR = Math.asin(clamp(b.R / dist, 0, 1));
    const cosA = -dot(sunW, dir);                     // phase angle: sun - body - observer
    const alpha = Math.acos(clamp(cosA, -1, 1));
    const litFrac = (1 + cosA) / 2;
    // sunlight on the body: the shadow of its parent (lunar eclipse), or of
    // the giant for its moons
    let reach = 1;
    if (b.kind !== 'giant') {
      if (b.parent === 'home') reach = sunReach(pos, [0, 0, 0], HOME.R, sunEq);
      else if (giantPos) reach = sunReach(pos, giantPos, g.R, sunEq);
    }
    const luxTop = SUN_LUX * b.p * (b.R / dist) ** 2 * phaseLaw(alpha, b.law) * reach;
    const elev = Math.asin(clamp(dir[1], -1, 1));
    const lux = luxTop * extinction(elev);
    // light on the dark side, from the parent (earthshine, giantshine): the
    // parent shows the opposite phase, Lambert law
    let shine = 0;
    if (b.kind !== 'giant') {
      const pR = b.parent === 'home' ? HOME.R : g.R, pP = b.parent === 'home' ? HOME.albedo : g.p;
      const toPar = sub(parentPos, pos), dP = len(toPar);
      const aP = Math.acos(clamp(dot(scl(toPar, -1 / dP), sunEq), -1, 1));   // phase of the parent seen from the body
      shine = pP * (pR / dP) ** 2 * phaseLaw(aP, 'giant');
    } else {
      shine = HOME.albedo * (HOME.R / dist) ** 2 * phaseLaw(Math.PI - alpha, 'giant');
    }
    out.push({
      id: b.id, map: b.map, name: b.name, kind: b.kind, body: b,
      dir, dist, R: b.R, angRadius: angR, pole: mul(M, pole), prime: mul(M, prime),
      phaseAngle: alpha, phase: litFrac, reach, shine, luxTop, lux, irradiance: hdrIrradiance(lux),
      elevation: elev / D2R, above: elev > -0.5 * D2R - angR,
      ring: b.ring || null, ringNormal: b.ring ? mul(M, pole) : null,
    });
  }
  // eclipse of the sun: the part of the sun disc the bodies hide
  let vis = 1;
  for (const o of out) {
    const sep = Math.acos(clamp(dot(o.dir, sunW), -1, 1));
    vis *= 1 - discOverlap(SUN_ANG_R, o.angRadius, sep);
  }
  return { system: sys, M, lst, sunDir: sunW, bodies: out, eclipse: 1 - vis, lights: nightLights(out) };
}

// The light sources for ATMO: bodies above the horizon, brightest first.
// colour: the mean of the map times the tint, luminance 1 (linear).
export function nightLights(bodies, maps = null) {
  const L = [];
  for (const o of bodies) {
    if (!o.above || o.lux <= 0) continue;
    const mean = (maps && maps[o.map] && maps[o.map].meanLinear) || [1, 1, 1];
    const t = o.body.tint || [1, 1, 1];
    let c = [mean[0] * t[0], mean[1] * t[1], mean[2] * t[2]];
    const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] || 1;
    const sat = o.body.sat ?? 1;
    c = c.map((x) => (1 + (x / y - 1) * sat));
    L.push({ id: o.id, kind: o.kind, name: o.name, dir: o.dir, lux: o.lux, irradiance: o.irradiance, color: c, phase: o.phase, angRadius: o.angRadius });
  }
  L.sort((a, b) => b.lux - a.lux);
  return L;
}

// The stateful clock: counts the wraps of tod so the bodies move on from
// day to day. A jump of more than half a day is taken as a wrap.
export function createCelestial(seed, mode = 'random') {
  const sys = celestialSystem(seed, mode);
  let day = 0, last = null;
  return {
    seed, mode, system: sys, maps: null,
    at(tod, season, latitude, sun = null) {
      if (last !== null) { const d = tod - last; if (d < -0.5) day++; else if (d > 0.5) day--; }
      last = tod;
      const r = celestialAt(sys, tod, season, latitude, day + tod, sun);
      if (this.maps) r.lights = nightLights(r.bodies, this.maps);
      return r;
    },
    get day() { return day; },
  };
}

// ── stars ──────────────────────────────────────────────────────────────────
// Effective temperature from B-V (Ballesteros 2012), then the Planck locus
// (Kim et al. 2002 cubic fits of CIE 1931 x, y), XYZ -> linear sRGB,
// luminance 1. sat 0..1 pulls the colour toward white (the eye sees star
// colours pale; 1 = the colour of the light).
export function starColor(bv, sat = 1) {
  const b = clamp(Number.isFinite(bv) ? bv : 0.65, -0.4, 2.0);
  const T = clamp(4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62)), 1667, 25000);
  const t = 1e3 / T, t2 = t * t, t3 = t2 * t;
  const x = T <= 4000 ? -0.2661239 * t3 - 0.2343589 * t2 + 0.8776956 * t + 0.179910 : -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t + 0.240390;
  const x2 = x * x, x3 = x2 * x;
  const y = T <= 2222 ? -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683
    : T <= 4000 ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
      : 3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;
  const X = x / y, Y = 1, Z = (1 - x - y) / y;
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, bl = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  r = Math.max(r, 0); g = Math.max(g, 0); bl = Math.max(bl, 0);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl || 1;
  return { T, rgb: [1 + (r / l - 1) * sat, 1 + (g / l - 1) * sat, 1 + (bl / l - 1) * sat] };
}

// assets/sky/stars.bin (10-byte records, sky-maps.json "stars") -> arrays.
export function parseStars(buf) {
  const dv = new DataView(buf.buffer ? buf.buffer : buf, buf.byteOffset || 0, buf.byteLength);
  const n = Math.floor(dv.byteLength / 10);
  const hr = new Uint16Array(n), ra = new Float32Array(n), dec = new Float32Array(n), mag = new Float32Array(n), bv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 10;
    hr[i] = dv.getUint16(o, true);
    ra[i] = dv.getUint16(o + 2, true) / 65536 * TAU;
    dec[i] = dv.getInt16(o + 4, true) / 32767 * Math.PI / 2;
    mag[i] = dv.getInt16(o + 6, true) / 1000;
    const q = dv.getInt16(o + 8, true);
    bv[i] = q === 32767 ? NaN : q / 1000;
  }
  return { n, hr, ra, dec, mag, bv };
}

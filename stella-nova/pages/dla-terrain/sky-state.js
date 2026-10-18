// ============================================================================
//  DLA TERRAIN  ·  sky-state.js — the sun, the moon, the weather and the
//  day-night cycle as numbers. DOM-free ES module (node tests read it).
// ----------------------------------------------------------------------------
//  skyState(tod, weatherId, season, latitude, t, prev) gives every Globals
//  field that SKY owns (CONTRACT.md "Shared GPU state"):
//    sunDir, sunColor, moonDir, ambient.rgb, fog, wind, weather, weather2.
//  CORE calls it once per frame and copies the result with writeSkyGlobals.
//
//  FRAME   world metres, y up, +x east, +z south (so north is -z).
//  TIME    tod 0..1 (0.5 is solar noon), season 0..1 (0 spring equinox,
//          0.25 June solstice), latitude in degrees (+ north), t seconds.
//  SUN     declination 23.44 deg * sin(2 pi season), hour angle from tod,
//          the usual alt-azimuth relations. The sun colour is the solar
//          irradiance times the transmittance of the same atmosphere as
//          shaders/sky.wgsl (Rayleigh, Mie, ozone, 6360 km planet), found
//          by a 48-step integration along the sun ray (sunTransmittance).
//  MOON    phase from the season (12.37 lunations a year), 0 new, 0.5 full.
//          It trails the sun by phase * 24 h.
//  WEATHER the WEATHER presets. A change of weather starts a front: the
//          values move from the old preset to the new one over FRONT_S
//          seconds. Cloud comes first and rain follows it; rain stops first
//          and the cloud breaks up after it. Pass the previous result as
//          `prev` to get the transition. When the sixth argument is not a
//          previous result, it is a set of overrides of the preset (for
//          example { cover: 0.5 }), and the module keeps the last result
//          itself: a call 0 .. 2 s after the last one continues its front.
//          A call at the same t or after a jump gives the steady state.
//  CORE    the result also has the field names of gpu/globals.js
//          packGlobals (sunIlluminance, fogDensity, cover, rain, ...).
//  GROUND  wetness builds up in rain and fog and dries in sun and wind.
//          Snow cover builds up in snowfall and melts above 0 C.
//  FLASH   lightning strokes come from a seeded hash of t, so a replay is
//          the same. weather.w is the flash, state.bolt names the stroke.
//  MODEL   createSky() (the page's sky) runs weather-model.js, a 2D
//          atmosphere over the world, in weather-worker.js (inline in
//          node). The values at the camera (state.sim.setCamera, called by
//          render/sky.js) replace the preset values: cover, rain or snow
//          (by the freezing level), storminess, low wind, valley fog. The
//          air-mass values (haze, aerosol, cirrus, temperature) fold the
//          presets across the model's fronts. Lightning comes from the
//          model's storm cells, as the mean flash over the frame
//          (lightningCells), so 30 and 144 fps give the same light.
//  CLOCK   weather time = sky time x RATE; RATE follows the day clock
//          (game s per sky s from the change of tod), RATE_MIN .. RATE_MAX.
//          The model steps a fixed 60 s; the driver interpolates the two
//          snapshots round the weather time, so the result does not depend
//          on the frame times. A new world or reset() spins the model up
//          over the 4 h before now. The stateless skyState() keeps the old
//          preset fronts (FRONT_S) for callers without a model.
//
//  grep -n targets
//    "export const WEATHER", "export const ATMO", "export const GLOBALS",
//    "export function solarPosition", "export function todForSunElevation",
//    "export function moonPosition",
//    "export function sunTransmittance", "function presetVec",
//    "export function skyState", "function lightning",
//    "export function writeSkyGlobals", "export function airTemps",
//    "function composeSky", "export function weatherEnv",
//    "export function createDriver", "function airMassAt",
//    "function upperWindAt", "export function lightningCells",
//    "export function createSky"
// ============================================================================

import { createModel, terrainCells, sampleSnap, CH, DT, N as WN, FORCING } from './weather-model.js';

export const FRONT_S = 40;          // seconds for a weather front to pass
export const SUN_ILLUM = 20;        // solar irradiance outside the air (HDR units)
export const SUN_RADIUS = 0.2665 * Math.PI / 180;   // angular radius of the sun disc, rad (0.533 deg across)
export const MOON_ILLUM = 0.06;     // full moon, artistic (real ratio is 1/400000)

// The atmosphere of shaders/sky.wgsl (Hillaire 2020 values). km and 1/km.
export const ATMO = Object.freeze({
  bottom: 6360, top: 6460,
  rayleigh: [5.802e-3, 13.558e-3, 33.1e-3], rayleighH: 8,
  mieS: 3.996e-3, mieA: 4.4e-3, mieH: 1.2, mieG: 0.8,
  ozone: [0.650e-3, 1.881e-3, 0.085e-3], ozoneC: 25, ozoneW: 15,
});

// Presets. cover 0..1, rain and snow 0..1 (rate), storm 0..1, fog = haze
// extinction per m at the ground (Rayleigh is extra), wind m/s, cumulus
// 0 (flat stratus) .. 1 (towers), cirrus 0..1, mie = aerosol scale of the
// atmosphere, temp = offset in C, valley = morning valley fog gain.
export const WEATHER = Object.freeze([
  { id: 'clear',        label: 'Clear',            cover: 0.04, rain: 0,    snow: 0,   storm: 0,    fog: 2.4e-5, wind: 3,  cumulus: 0.8, cirrus: 0.25, mie: 0.8, temp: 2,  valley: 1.0 },
  { id: 'fair',         label: 'Fair weather',     cover: 0.30, rain: 0,    snow: 0,   storm: 0,    fog: 4e-5,   wind: 4,  cumulus: 1.0, cirrus: 0.35, mie: 1.0, temp: 1,  valley: 0.8 },
  { id: 'cloudy',       label: 'Cloudy',           cover: 0.58, rain: 0,    snow: 0,   storm: 0.05, fog: 5.5e-5, wind: 6,  cumulus: 0.75, cirrus: 0.5, mie: 1.3, temp: 0,  valley: 0.5 },
  { id: 'overcast',     label: 'Overcast',         cover: 0.92, rain: 0,    snow: 0,   storm: 0.1,  fog: 9e-5,   wind: 6,  cumulus: 0.2, cirrus: 0.2,  mie: 2.0, temp: -2, valley: 0.3 },
  { id: 'fog',          label: 'Fog',              cover: 0.7,  rain: 0,    snow: 0,   storm: 0,    fog: 6e-3,   wind: 1,  cumulus: 0.0, cirrus: 0.0,  mie: 4.0, temp: -3, valley: 1.6 },
  { id: 'drizzle',      label: 'Drizzle',          cover: 0.88, rain: 0.25, snow: 0,   storm: 0.1,  fog: 1.3e-4, wind: 5,  cumulus: 0.25, cirrus: 0.1, mie: 2.5, temp: -3, valley: 0.6 },
  { id: 'rain',         label: 'Rain',             cover: 0.95, rain: 0.75, snow: 0,   storm: 0.3,  fog: 1.6e-4, wind: 8,  cumulus: 0.45, cirrus: 0.1, mie: 2.5, temp: -4, valley: 0.3 },
  { id: 'thunderstorm', label: 'Thunderstorm',     cover: 0.9,  rain: 1.0,  snow: 0,   storm: 1.0,  fog: 1.8e-4,   wind: 13, cumulus: 1.0, cirrus: 0.6,  mie: 2.2, temp: -5, valley: 0.2 },
  { id: 'snow',         label: 'Snow',             cover: 0.9,  rain: 0,    snow: 0.6, storm: 0.1,  fog: 2.6e-4,   wind: 4,  cumulus: 0.3, cirrus: 0.1,  mie: 2.0, temp: -14, valley: 0.4 },
  { id: 'blizzard',     label: 'Blizzard',         cover: 1.0,  rain: 0,    snow: 1.0, storm: 0.5,  fog: 1.6e-3, wind: 17, cumulus: 0.4, cirrus: 0.0,  mie: 3.0, temp: -20, valley: 0.0 },
  { id: 'golden-haze',  label: 'Golden hour haze', cover: 0.18, rain: 0,    snow: 0,   storm: 0,    fog: 1.15e-4, wind: 2,  cumulus: 0.9, cirrus: 0.6,  mie: 3.5, temp: 3,  valley: 1.2 },
]);
const BY_ID = new Map(WEATHER.map((w) => [w.id, w]));
const KEYS = ['cover', 'rain', 'snow', 'storm', 'fog', 'wind', 'cumulus', 'cirrus', 'mie', 'temp', 'valley'];

// Float offsets of the SKY fields in the Globals uniform (common.wgsl):
// 5 mat4 (80 floats), then vec4 fields in contract order.
export const GLOBALS = Object.freeze({
  camPos: 80, sunDir: 84, sunColor: 88, moonDir: 92, ambient: 96, fog: 100,
  wind: 104, weather: 108, weather2: 112, terrain: 116, terrainOrigin: 120,
  screen: 124, frame: 128, floats: 132,
});

const D2R = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const mix = (a, b, u) => a + (b - a) * u;
function hash1(n) {   // integer -> [0, 1)
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// Unit vector toward a body at declination dec and hour angle H (radians)
// seen from latitude lat (radians). World frame: x east, y up, z south.
function altAz(dec, H, lat) {
  const east = -Math.cos(dec) * Math.sin(H);
  const north = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H);
  const up = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const l = Math.hypot(east, north, up) || 1;
  return [east / l, up / l, -north / l];
}

export function solarPosition(tod, season, latitude) {
  const dec = 23.44 * D2R * Math.sin(2 * Math.PI * season);
  const H = (tod - 0.5) * 2 * Math.PI;
  const dir = altAz(dec, H, latitude * D2R);
  return { dir, elevation: Math.asin(clamp(dir[1], -1, 1)) / D2R, declination: dec / D2R };
}

// The time of day (0..1) when the sun stands at elevDeg, in the morning
// (evening false) or the evening. Golden hour is about 2 .. 6 deg; the
// clock time of it moves with the season and the latitude, so a fixed tod
// is golden in one season and plain daylight in another. Returns null when
// the sun never reaches that height that day (polar day or night).
export function todForSunElevation(elevDeg, season, latitude, evening = false) {
  const el = (tod) => solarPosition(tod, season, latitude).elevation;
  // noon is the highest point: bisect on the rising or the falling half
  let a = evening ? 0.5 : 0.0, b = evening ? 1.0 : 0.5;
  const fa = el(a) - elevDeg, fb = el(b) - elevDeg;
  if (fa * fb > 0) return null;
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2, fm = el(m) - elevDeg;
    if ((fm > 0) === (fa > 0)) a = m; else b = m;
  }
  return (a + b) / 2;
}

export function moonPosition(tod, season, latitude) {
  const phase = ((season * 12.37 + 0.31) % 1 + 1) % 1;
  const sunDec = 23.44 * D2R * Math.sin(2 * Math.PI * season);
  const dec = sunDec * Math.cos(2 * Math.PI * phase) + 5.1 * D2R * Math.sin(2 * Math.PI * (season * 13.4 + 0.2));
  const H = (tod - 0.5 - phase) * 2 * Math.PI;
  const dir = altAz(dec, H, latitude * D2R);
  // lit fraction of the disc: 0 new, 1 full
  const lit = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
  return { dir, phase, lit, elevation: Math.asin(clamp(dir[1], -1, 1)) / D2R };
}

// Transmittance from altitude hKm along a ray with cosine-zenith mu, to the
// top of the atmosphere. 0 when the planet blocks the ray. mie scales the
// aerosol densities (haze presets).
export function sunTransmittance(mu, hKm = 0.2, mie = 1) {
  const A = ATMO;
  const r = A.bottom + hKm;
  // planet hit?
  const b = r * mu, cG = r * r - A.bottom * A.bottom;
  if (mu < 0 && b * b - cG >= 0) {
    // soft edge: the sun sinks through about 0.3 deg of horizon haze
    const dip = -mu;
    const horizonMu = Math.sqrt(Math.max(0, 1 - (A.bottom / r) ** 2));
    if (dip > horizonMu + 0.006) return [0, 0, 0];
  }
  const cT = r * r - A.top * A.top;
  const tTop = -b + Math.sqrt(Math.max(0, b * b - cT));
  const n = 48, dt = tTop / n;
  let tr = 0, tg = 0, tb = 0;
  const sx = Math.sqrt(Math.max(0, 1 - mu * mu));
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * dt;
    const px = sx * s, py = r + mu * s;
    const h = Math.max(0, Math.hypot(px, py) - A.bottom);
    const dR = Math.exp(-h / A.rayleighH), dM = Math.exp(-h / A.mieH) * mie;
    const dO = Math.max(0, 1 - Math.abs(h - A.ozoneC) / A.ozoneW);
    const m = (A.mieS + A.mieA) * dM;
    tr += (A.rayleigh[0] * dR + m + A.ozone[0] * dO) * dt;
    tg += (A.rayleigh[1] * dR + m + A.ozone[1] * dO) * dt;
    tb += (A.rayleigh[2] * dR + m + A.ozone[2] * dO) * dt;
  }
  return [Math.exp(-tr), Math.exp(-tg), Math.exp(-tb)];
}

function presetVec(id) {
  const w = BY_ID.get(id) || BY_ID.get('clear');
  const o = {};
  for (const k of KEYS) o[k] = w[k];
  return o;
}

// The weather values now. A front eases from `from` to `to` with progress
// p (0..1). Each field has its own window, so cloud leads and rain lags.
function frontMix(from, to, p) {
  const o = {};
  for (const k of KEYS) {
    let a = 0, b = 1;
    if (k === 'rain' || k === 'snow' || k === 'storm') {
      // precipitation arrives late and leaves early
      if (to[k] > from[k]) { a = 0.45; b = 1.0; } else { a = 0.0; b = 0.45; }
    } else if (k === 'cover' || k === 'cumulus') {
      if (to.cover > from.cover) { a = 0.0; b = 0.6; } else { a = 0.35; b = 1.0; }
    } else if (k === 'fog') {
      a = 0.15; b = 0.9;
    }
    const u = smooth(a, b, p);
    // fog extinction spans 3 decades: ease it in the log domain
    o[k] = k === 'fog' ? Math.exp(mix(Math.log(from[k]), Math.log(to[k]), u)) : mix(from[k], to[k], u);
  }
  return o;
}

// Lightning strokes. Slots of 0.25 s; a slot holds a stroke with a chance
// set by the storminess. Each stroke flickers with 2 to 4 return strokes.
export function lightning(t, storm, seed = 0) {
  const SLOT = 0.25;
  const rate = storm > 0.45 ? 0.45 * ((storm - 0.45) / 0.55) ** 1.5 : 0;  // strokes per s
  let flash = 0, bolt = null;
  if (rate <= 0) return { flash, bolt };
  const k0 = Math.floor(t / SLOT);
  for (let k = k0; k >= k0 - 6; k--) {
    if (hash1(k * 7 + seed) > rate * SLOT) continue;
    const t0 = (k + hash1(k * 13 + seed + 1)) * SLOT;
    const age = t - t0;
    if (age < 0 || age > 1.4) continue;
    const pulses = 2 + Math.floor(hash1(k * 17 + seed + 2) * 3);
    let f = 0;
    for (let j = 0; j < pulses; j++) {
      const tj = j === 0 ? 0 : 0.05 + j * 0.06 + 0.08 * hash1(k * 31 + j);
      const a = age - tj;
      if (a >= 0) f = Math.max(f, (j === 0 ? 1 : 0.55 + 0.4 * hash1(k * 37 + j)) * Math.exp(-a / 0.045));
    }
    const near = hash1(k * 19 + seed + 3);
    const gain = mix(1.0, 0.25, near);   // far strokes flash less
    if (f * gain > flash) {
      flash = f * gain;
      bolt = {
        id: k, age,
        angle: hash1(k * 23 + seed + 4) * Math.PI * 2,   // bearing from the camera
        dist: mix(1500, 14000, near * near),             // m
        visible: age < 0.5,
        cloudToGround: hash1(k * 29 + seed + 5) < 0.6,
      };
    }
  }
  return { flash: clamp(flash, 0, 1), bolt };
}

// The sea-level air temperature of the place and season with no weather
// (baseC) and the phase of the day (diurnal -1 .. 1, highest at 15:00).
export function airTemps(tod, season, latitude) {
  const lat = Math.abs(latitude);
  const north = latitude >= 0 ? 1 : -1;
  const summer = Math.sin(2 * Math.PI * season) * north;   // +1 June in the north
  return { baseC: 27 - 0.42 * lat + summer * (4 + 0.22 * lat), diurnal: Math.sin(2 * Math.PI * (tod - 0.375)) };
}
function temperatureC(tod, season, latitude, wx, sunElev) {
  const a = airTemps(tod, season, latitude);
  return a.baseC + (3 + 4 * (1 - wx.cover)) * a.diurnal + wx.temp + (sunElev > 0 ? 0 : -1);
}

// The whole SKY state. See the header for the arguments.
let LAST = null;   // the last result, for callers that do not pass prev

export function skyState(tod, weatherId, season = 0.3, latitude = 46, t = 0, prevOrOver = null) {
  tod = ((tod % 1) + 1) % 1;
  season = ((season % 1) + 1) % 1;
  const id = BY_ID.has(weatherId) ? weatherId : 'clear';
  let prev = null, over = null;
  if (prevOrOver && prevOrOver.front && typeof prevOrOver.t === 'number') prev = prevOrOver;
  else {
    over = prevOrOver;
    if (!(over && over.stateless) && LAST && t - LAST.t > 0 && t - LAST.t <= 2) prev = LAST;
  }
  const dt = prev && t >= prev.t && t - prev.t < 600 ? t - prev.t : null;

  // ---- the front -----------------------------------------------------------
  let from, to = presetVec(id), progress = 1;
  if (over) for (const k of KEYS) if (typeof over[k] === 'number') to[k] = over[k];
  if (dt !== null) {
    if (prev.weatherId !== id) {             // a new front starts from the values now
      from = { ...prev.wx };
      progress = 0;
    } else {
      from = prev.front.from;
      progress = Math.min(1, prev.front.progress + dt / FRONT_S);
    }
  } else {
    from = to;
  }
  const wx = progress >= 1 ? { ...to } : frontMix(from, to, progress);
  const out = composeSky(tod, id, season, latitude, t, wx, prev, dt, { front: { from, to, progress } });
  if (!over || !over.stateless) LAST = out;
  return out;
}

// Everything that follows from the weather values wx at the camera: sun,
// moon, ambient, fog colour, wind, ground state, valley fog, exposure.
// extra: { front, light (a lightning result), windVec ([x, z] m/s of the
// low wind at the camera), valleyFog }
function composeSky(tod, id, season, latitude, t, wx, prev, dt, extra) {
  // ---- sun and moon ----------------------------------------------------------
  const sun = solarPosition(tod, season, latitude);
  const moon = moonPosition(tod, season, latitude);
  const Tsun = sunTransmittance(sun.dir[1], 0.2, wx.mie);
  const overcast = smooth(0.55, 1.0, wx.cover) * 0.9 + clamp(wx.fog * 120, 0, 0.6);
  const direct = Math.max(0, 1 - overcast);
  const sunClear = Tsun.map((x) => x * SUN_ILLUM);
  const sunColor = sunClear.map((x) => x * direct);
  const Tmoon = sunTransmittance(moon.dir[1], 0.2, wx.mie);
  const TmoonL = 0.2126 * Tmoon[0] + 0.7152 * Tmoon[1] + 0.0722 * Tmoon[2];
  const moonScale = MOON_ILLUM * moon.lit * smooth(-0.02, 0.05, moon.dir[1]) * Math.max(0.15, direct);

  // ---- ambient irradiance (hemisphere) --------------------------------------
  // day: Rayleigh blue scaled by sun height; twilight: blue-violet tail;
  // night: airglow plus the moon. Overcast: the cloud deck turns part of
  // the direct sun into grey diffuse light.
  const se = sun.dir[1];
  const day = smooth(-0.10, 0.45, se);
  const tw = smooth(-0.21, 0.0, se) * (1 - smooth(0.0, 0.2, se));
  const Tz = sunTransmittance(Math.max(se, 0.02), 0.2, wx.mie);
  const amb = [0, 0, 0];
  const skyBlue = [0.30, 0.44, 0.78];
  for (let c = 0; c < 3; c++) {
    let a = SUN_ILLUM * 0.16 * skyBlue[c] * day * (0.35 + 0.65 * Tz[c]);
    a += SUN_ILLUM * 0.012 * [0.28, 0.32, 0.6][c] * tw;
    a += [0.0012, 0.0016, 0.003][c];                               // airglow and stars
    // the eye sees moonlight as a cool grey (Purkinje shift): keep only a
    // fifth of the reddening of a low moon, or a night turns brown
    a += moonScale * 0.35 * [0.55, 0.65, 0.85][c] * mix(TmoonL, Tmoon[c], 0.2);
    // overcast: grey light from the deck, the direct sun spread out
    const grey = (sunClear[0] + sunClear[1] + sunClear[2]) / 3;
    a = mix(a, 0.22 * grey * Math.max(se, 0) + a * 0.55, smooth(0.5, 1.0, wx.cover));
    amb[c] = a + sunColor[c] * 0.06 * (1 - day * 0.5);          // ground bounce
  }
  const flashObj = extra.light || lightning(t, wx.storm);
  const flash = flashObj.flash;

  // ---- fog ---------------------------------------------------------------------
  const fogCol = amb.map((a, c) => a * 0.12 + sunColor[c] * 0.025 + flash * 0.4);

  // ---- wind --------------------------------------------------------------------
  const gust = clamp(0.5 + 0.35 * Math.sin(t * 0.43) * Math.sin(t * 0.17 + 2.0) + 0.15 * Math.sin(t * 1.3), 0, 1);
  let ang, speed;
  if (extra.windVec) {
    // the low wind of the model at the camera (it turns with the terrain)
    ang = Math.atan2(extra.windVec[1], extra.windVec[0]);
    speed = Math.hypot(extra.windVec[0], extra.windVec[1]) * (0.75 + 0.5 * gust);
  } else {
    ang = 0.6 + 0.35 * Math.sin(t * 0.011) + 0.2 * Math.sin(t * 0.027 + 1.3);
    speed = wx.wind * (0.75 + 0.5 * gust);
  }
  const windPhase = dt !== null ? prev.windPhase + dt * speed / 5 : t * wx.wind / 5;

  // ---- ground state --------------------------------------------------------------
  const tempC = temperatureC(tod, season, latitude, wx, sun.elevation);
  let wet, snowCover;
  if (dt !== null) {
    const dry = 0.0018 * (0.25 + 1.2 * Math.max(se, 0) * direct) * (1 + speed / 8) * (1 - 0.6 * wx.cover);
    wet = clamp(prev.wetness + dt * (wx.rain * 0.03 + (wx.fog > 1e-3 ? 0.004 : 0) + wx.snow * (tempC > 0 ? 0.01 : 0)) - dt * dry, 0, 1);
    const melt = tempC > 0 ? 0.0012 * (tempC / 5 + Math.max(se, 0) * 2 + wx.rain * 3) : 0;
    snowCover = clamp(prev.snowCover + dt * wx.snow * 0.015 - dt * melt, 0, 1);
    if (melt > 0 && prev.snowCover > 0) wet = Math.min(1, wet + dt * melt * 0.6);
  } else {
    wet = clamp(wx.rain * 1.4 + (wx.fog > 1e-3 ? 0.35 : 0) + (wx.cover > 0.85 ? 0.1 : 0), 0, 1);
    snowCover = clamp(wx.snow * 1.3, 0, 1);
  }

  // ---- morning valley fog: forms on clear, calm nights, burns off as the sun climbs
  const hourDeg = (tod - 0.5) * 360;
  let valleyFog;
  if (typeof extra.valleyFog === 'number') valleyFog = extra.valleyFog;
  else {
    const morning = smooth(-0.22, -0.02, -Math.abs(tod - 0.27) * 1.0); // peaks near 06:30
    const burn = 1 - smooth(4, 22, sun.elevation);
    valleyFog = clamp(wx.valley * (0.25 + 0.75 * morning) * burn * (sun.elevation > -18 ? 1 : 0.6) * (1 - smooth(4, 12, speed)), 0, 1.5);
  }

  const out = {
    t, tod, season, latitude, weatherId: id,
    label: (BY_ID.get(id) || {}).label,
    front: extra.front,
    wx, windPhase,
    sunDir: sun.dir, sunElevation: sun.elevation, sunScale: SUN_ILLUM * direct,
    sunColor, sunColorClear: sunClear, sunTrans: Tsun,
    moonDir: moon.dir, moonPhase: moon.phase, moonLit: moon.lit, moonScale,
    ambient: amb,
    fog: [fogCol[0], fogCol[1], fogCol[2], wx.fog],
    wind: [Math.cos(ang) * speed, Math.sin(ang) * speed, gust, windPhase],
    weather: [wx.cover, wx.rain, wx.snow, flash],
    weather2: [wet, snowCover, wx.storm, season],
    wetness: wet, snowCover, temperature: tempC,
    valleyFog, hourDeg,
    flash, bolt: flashObj.bolt,
    // a linear exposure that maps this light to mid grey; night is kept
    // darker than day (capped), so a moonlit scene still reads as night
    exposureHint: Math.min(0.55 / ((amb[0] + 2 * amb[1] + amb[2]) / 4 * 0.9 + 0.02 * sunColor[1] + 1e-4), 45) * (0.35 + 0.65 * day),
  };
  // the names of gpu/globals.js packGlobals (CORE)
  Object.assign(out, {
    sunIlluminance: out.sunScale, moonIlluminance: moonScale, fogDensity: wx.fog,
    gust, cover: wx.cover, rain: wx.rain, snow: wx.snow, lightning: flash,
    storminess: wx.storm,
  });
  return out;
}

// Copy the SKY fields into the Globals Float32Array. CORE owns the rest
// (ambient.w is the exposure: this leaves it as it is).
export function writeSkyGlobals(f, s) {
  const O = GLOBALS;
  f.set(s.sunDir, O.sunDir); f[O.sunDir + 3] = s.sunScale;
  f.set(s.sunColor, O.sunColor); f[O.sunColor + 3] = s.tod;
  f.set(s.moonDir, O.moonDir); f[O.moonDir + 3] = s.moonScale;
  f.set(s.ambient, O.ambient);
  f.set(s.fog, O.fog);
  f.set(s.wind, O.wind);
  f.set(s.weather, O.weather);
  f.set(s.weather2, O.weather2);
  return f;
}

// ── the weather model (weather-model.js) and its clock ────────────────────
// Weather time runs RATE x faster than sky time: RATE follows the day clock
// (game seconds per sky second, from the change of tod), kept in
// RATE_MIN .. RATE_MAX. A front at its real speed (m/s of weather time)
// then crosses the world in the time the sun needs for the same hours.
export const RATE_MIN = 30, RATE_MAX = 400;

export function weatherEnv(tod, season, latitude) {
  const s = solarPosition(((tod % 1) + 1) % 1, season, latitude).dir, a = airTemps(tod, season, latitude);
  return { sunX: s[0], sunY: s[1], sunZ: s[2], baseC: a.baseC, diurnal: a.diurnal };
}

// The driver keeps the snapshots that bracket the weather time gT and asks
// the model for the next ones: from a module worker in the page, inline in
// node (or when the worker fails). The display interpolates two snapshots,
// so the weather moves smoothly whatever the frame rate. When the worker
// lags, gT waits for it (the weather holds, it does not jump).
export function createDriver(o = {}) {
  const d = {
    snaps: [], gT: 0, pending: 0, cells: terrainCells(null, WN), epoch: 0, mode: 'inline',
    seed: o.seed ?? 1, prevail: o.prevail ?? 0.35, last: null, error: null,
  };
  let W = null, model = null;
  const push = (snap) => {
    d.snaps.push(snap);
    d.snaps.sort((a, b) => a.t - b.t);
    while (d.snaps.length > 2 && d.snaps[1].t <= d.gT) d.snaps.shift();
    while (d.snaps.length > 6) d.snaps.shift();
  };
  const inlineSnap = () => { const s = model.snapshot(); s.fronts = model.frontPos(); s.baseId = model.baseId; s.epoch = d.epoch; return s; };
  function startInline() {
    d.mode = 'inline';
    model = createModel({ seed: d.seed, prevail: d.prevail });
    if (d.last) {
      model.setCells(d.cells);
      model.setPreset(d.last.id, d.last.over, true);
      model.init(d.last.env, d.last.spin);
      model.t = d.gT;
      d.snaps = []; push(inlineSnap());
    }
  }
  if (o.worker && typeof Worker !== 'undefined') {
    try {
      W = new Worker(new URL('./weather-worker.js', import.meta.url), { type: 'module' });
      d.mode = 'worker';
      W.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'snap') {
          if (m.snap.epoch !== d.epoch) return;
          m.snap.data = new Float32Array(m.snap.data.buffer || m.snap.data);
          if (m.snap.kind === 'step') d.pending = Math.max(0, d.pending - 1);
          push(m.snap);
        } else if (m.type === 'error') { d.error = m.message; W.terminate(); W = null; startInline(); }
      };
      W.onerror = (e) => { d.error = (e && e.message) || 'worker error'; if (e && e.preventDefault) e.preventDefault(); if (W) W.terminate(); W = null; startInline(); };
    } catch (e) { W = null; d.error = String(e); }
  }
  if (!W) startInline();

  d.reset = (id, over, env, spin = 90) => {   // env: one env or one per spin-up step
    d.epoch++; d.pending = 0; d.snaps = [];
    d.last = { id, over: over || null, env, spin };
    if (W) W.postMessage({ type: 'reset', epoch: d.epoch, seed: d.seed, prevail: d.prevail, id, over: over || null, env, cells: d.cells, t: d.gT, spin });
    else {
      model.setCells(d.cells);
      model.setPreset(id, over, true);
      model.init(env, spin);
      model.t = d.gT;
      push(inlineSnap());
    }
  };
  d.setPreset = (id, over) => {
    if (d.last) d.last = { ...d.last, id, over: over || null };
    if (W) W.postMessage({ type: 'preset', id, over: over || null }); else model.setPreset(id, over, false);
  };
  d.setCells = (cells) => { d.cells = cells; if (W) W.postMessage({ type: 'cells', cells }); else model.setCells(cells); };
  // envAt(t) -> the env of the step that ends at weather time t
  d.advance = (gDt, envAt) => {
    if (!d.snaps.length) return;                 // waiting for the first snapshot
    d.gT += Math.max(gDt, 0);
    if (W) {
      let newest = d.snaps[d.snaps.length - 1].t + d.pending * DT;
      while (d.pending < 3 && newest < d.gT + 2 * DT) {
        newest += DT;
        W.postMessage({ type: 'step', env: envAt(newest), kind: 'step' });
        d.pending++;
      }
      const have = d.snaps[d.snaps.length - 1].t;
      if (have < d.gT) d.gT = have;
    } else {
      let guard = 0;
      while (model.t < d.gT && guard++ < 40) { model.step(envAt(model.t + DT)); push(inlineSnap()); }
      if (model.t < d.gT) d.gT = model.t;
    }
    while (d.snaps.length > 2 && d.snaps[1].t <= d.gT) d.snaps.shift();
  };
  // the two snapshots round gT and the weight of the second
  d.bracket = () => {
    const S = d.snaps;
    if (!S.length) return null;
    let a = S[0], b = S[0];
    for (let i = 0; i < S.length; i++) { if (S[i].t <= d.gT) a = S[i]; }
    b = S.find((s) => s.t > a.t) || a;
    const w = b === a ? 0 : clamp((d.gT - a.t) / (b.t - a.t), 0, 1);
    return { a, b, w };
  };
  d.sample = (x, z, out = new Float32Array(CH)) => {
    const br = d.bracket();
    if (!br) return null;
    const A = sampleSnap(br.a, x, z), B = br.b === br.a ? A : sampleSnap(br.b, x, z);
    for (let c = 0; c < CH; c++) out[c] = A[c] + (B[c] - A[c]) * br.w;
    return out;
  };
  d.dispose = () => { if (W) W.terminate(); W = null; };
  Object.defineProperty(d, 'model', { get: () => model });
  return d;
}

// The air-mass values (the KEYS of WEATHER: haze, mie, cirrus, temp, wind,
// ...) at world x, z: the base preset folded with the fronts of snapshot
// `snap`, moved on to weather time gT. The same fold as weather-model.js.
function airMassAt(snap, gT, x, z) {
  let v = presetVec(snap.baseId || 'clear');
  for (const f of snap.fronts || []) {
    const s = f.s + f.v * (gT - snap.t);
    const d = x * f.nx + z * f.nz - s;
    const u = 1 - smooth(-3000, 3000, d);
    const to = presetVec(f.id);
    const o = {};
    for (const k of KEYS) o[k] = k === 'fog' ? Math.exp(mix(Math.log(v[k]), Math.log(to[k]), u)) : mix(v[k], to[k], u);
    v = o;
  }
  return v;
}

// The upper (cloud level) wind at world x, z, m/s of weather time: the
// FORCING wind and direction folded with the fronts as in weather-model.js.
function upperWindAt(snap, gT, x, z, prevail) {
  const F = (id) => FORCING[id] || FORCING.clear;
  let w = F(snap.baseId).wind, dir = F(snap.baseId).dir;
  for (const f of snap.fronts || []) {
    const s = f.s + f.v * (gT - snap.t);
    const u = 1 - smooth(-3000, 3000, x * f.nx + z * f.nz - s);
    w = mix(w, F(f.id).wind, u); dir = mix(dir, F(f.id).dir, u);
  }
  const U = w * 1.3 + 2, a = prevail + dir;
  return [Math.cos(a) * U, Math.sin(a) * U];
}

// Lightning from the storm cells of the model. Slots of 0.25 s; each slot
// holds a stroke with a chance set by the summed storm strength, at a cell
// picked by weight (a stroke keeps its cell: `memo`). The flash is the mean
// of the pulses over the frame [t0, t1] (not a point sample), so the light
// of a flash is the same at 30 and at 144 fps.
export function lightningCells(t0, t1, cells, cam, seed = 0, memo = new Map()) {
  const SLOT = 0.25, TAU = 0.045;
  let rate = 0;
  for (const c of cells) rate += 0.55 * Math.pow(c.s, 1.5);
  rate = Math.min(rate, 2.5);
  let flash = 0, bolt = null, best = 0;
  const span = Math.max(t1 - t0, 0);
  const kLo = Math.floor((t0 - 1.4) / SLOT), kHi = Math.floor(t1 / SLOT);
  for (let k = kHi; k >= kLo; k--) {
    let st = memo.get(k);
    if (st === undefined) {
      st = null;
      if (rate > 0 && hash1(k * 7 + seed) <= rate * SLOT && cells.length) {
        let u = hash1(k * 13 + seed + 1) * rate, c = cells[0];
        for (const cc of cells) { u -= 0.55 * Math.pow(cc.s, 1.5); if (u <= 0) { c = cc; break; } }
        st = {
          t0: (k + hash1(k * 11 + seed + 9)) * SLOT,
          x: c.x + (hash1(k * 17 + seed + 4) - 0.5) * 3000, z: c.z + (hash1(k * 19 + seed + 5) - 0.5) * 3000,
          pulses: 2 + Math.floor(hash1(k * 17 + seed + 2) * 3), cg: hash1(k * 29 + seed + 5) < 0.6, s: c.s,
        };
      }
      memo.set(k, st);
    }
    if (!st) continue;
    const dist = Math.hypot(st.x - cam[0], st.z - cam[2]);
    const gain = Math.max(0.05, 1 / (1 + (dist / 7000) * (dist / 7000)));
    let avg = 0, now = 0;
    for (let j = 0; j < st.pulses; j++) {
      const tj = st.t0 + (j === 0 ? 0 : 0.05 + j * 0.06 + 0.08 * hash1(k * 31 + j));
      const A = j === 0 ? 1 : 0.55 + 0.4 * hash1(k * 37 + j);
      if (t1 < tj) continue;
      now += A * Math.exp(-(t1 - tj) / TAU);
      if (span > 1e-4) { const a0 = Math.max(t0, tj); avg += A * TAU * (Math.exp(-(a0 - tj) / TAU) - Math.exp(-(t1 - tj) / TAU)) / span; }
    }
    if (span <= 1e-4) avg = now;
    flash += avg * gain;
    const age = t1 - st.t0;
    if (age >= 0 && age <= 1.4 && now * gain > best) {
      best = now * gain;
      bolt = { id: k, age, x: st.x, z: st.z, angle: Math.atan2(st.z - cam[2], st.x - cam[0]), dist, visible: age < 0.5, cloudToGround: st.cg };
    }
  }
  for (const k of memo.keys()) if (k < kLo - 8) memo.delete(k);
  return { flash: clamp(flash, 0, 1), bolt };
}

// A stateful sky with the weather model. update(tod, weatherId, season,
// lat, t) advances the model and gives the skyState fields for the camera
// (set by render/sky.js through state.sim.setCamera). opts.worker: run the
// model in weather-worker.js (default: when the page has Worker and
// document).
export function createSky(opts = {}) {
  let prev = null;
  const seed = opts.seed ?? 1;
  const useWorker = opts.worker ?? (typeof Worker !== 'undefined' && typeof document !== 'undefined');
  const drv = createDriver({ worker: useWorker, seed, prevail: opts.prevail });
  const memo = new Map();
  const L = new Float32Array(CH), tmp = new Float32Array(CH);
  const sim = {
    driver: drv, cam: [0, 300, 0], terrain: null, wantReset: true, id: null, rate: 100, follow: 1,
    setCamera(p) { sim.cam[0] = p[0]; sim.cam[1] = p[1]; sim.cam[2] = p[2]; },
    // a new final terrain: the model starts again for it (a new world)
    setTerrain(ter) {
      if (!ter || !ter.height || ter === sim.terrain) return;
      sim.terrain = ter;
      drv.setCells(terrainCells(ter, WN));
      sim.wantReset = true;
    },
    get bracket() { return drv.bracket(); },
  };
  return {
    sim,
    update(tod, weatherId, season, latitude, t, over = null) {
      tod = ((tod % 1) + 1) % 1;
      season = ((season % 1) + 1) % 1;
      const id = BY_ID.has(weatherId) ? weatherId : 'clear';
      const dt = prev && t > prev.t && t - prev.t < 600 ? t - prev.t : (prev && t === prev.t ? 0 : null);
      // the weather clock follows the day clock
      if (dt > 0) {
        let dTod = tod - prev.tod; dTod -= Math.round(dTod);
        if (Math.abs(dTod) < 0.01) {
          const obs = dTod * 86400 / dt;
          sim.rate += (obs - sim.rate) * (1 - Math.exp(-dt / 1.5));
        }
      }
      const R = clamp(sim.rate, RATE_MIN, RATE_MAX);
      sim.follow = clamp(sim.rate / R, 0, 1);
      if (dt === null || sim.wantReset || !prev) {
        // spin up over the 4 h before now, so the state fits the hour
        const envs = [];
        for (let i = 79; i >= 0; i--) envs.push(weatherEnv(tod - i * 3 * DT / 86400, season, latitude));
        drv.reset(id, over, envs);
        sim.wantReset = false; sim.id = id;
      } else {
        if (id !== sim.id) { drv.setPreset(id, over); sim.id = id; }
        const g0 = drv.gT, follow = sim.follow;
        drv.advance(dt * R, (gt) => weatherEnv(tod + (gt - g0) * follow / 86400, season, latitude));
      }
      const cam = sim.cam;
      const have = drv.sample(cam[0], cam[2], L);
      const br = drv.bracket();
      // the air mass at the camera (haze, aerosol, temperature) and the
      // model values there (cloud, rain, snow, storms, fog, wind)
      const wx = br ? airMassAt(br.a, drv.gT, cam[0], cam[2]) : presetVec(id);
      let storm = 0, windVec = null, valleyFog = 0, light = null;
      // the cover of the air mass (the preset folded with the fronts): the
      // clouds take a floor of scattered cloud from it (render/sky.js)
      wx.coverAir = wx.cover;
      if (have) {
        wx.cover = L[0];
        wx.cumulus = L[1];
        const fz = L[11];
        const snowFrac = smooth(fz - 150, fz + 150, cam[1]);   // above the freezing level: snow
        wx.rain = L[3] * (1 - snowFrac);
        wx.snow = L[3] * snowFrac;
        wx.cirrus = L[7];
        // storminess: the strongest cell within 6 km
        storm = L[4];
        for (let a = 0; a < 6; a++) {
          const s = drv.sample(cam[0] + Math.cos(a * 1.047) * 6000, cam[2] + Math.sin(a * 1.047) * 6000, tmp);
          if (s) storm = Math.max(storm, s[4] * 0.8);
        }
        wx.storm = storm;
        windVec = [L[9], L[10]];
        valleyFog = L[5];
        light = lightningCells(prev ? prev.t : t, t, br.a.cells || [], cam, seed, memo);
      }
      const out = composeSky(tod, id, season, latitude, t, wx, prev && dt !== null ? prev : null, dt || null,
        { front: { from: wx, to: wx, progress: 1 }, light, windVec, valleyFog });
      out.sim = sim;
      out.local = have ? L.slice() : null;
      out.gameT = drv.gT;
      out.gameRate = R;
      out.upperWind = br ? upperWindAt(br.a, drv.gT, cam[0], cam[2], drv.prevail) : [3, 0];
      prev = out;
      return out;
    },
    get state() { return prev; },
    reset() { prev = null; sim.wantReset = true; },
    dispose() { drv.dispose(); },
    seed,
  };
}

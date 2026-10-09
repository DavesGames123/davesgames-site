// ============================================================================
//  PLANET FORGE  ·  presets.js — parameters, presets, schema, JSON (no DOM)
// ----------------------------------------------------------------------------
//  A planet is one plain object: kind ('rocky' or 'gas'), seed, the noise
//  parameters of its generator, a palette, the atmosphere and the rings.
//  The object is the whole recipe: the JSON of it reproduces the maps bit
//  for bit (tests.mjs "json round trip").
//
//  ROCKY_DEFAULT / GAS_DEFAULT hold every key with a neutral value. A preset
//  is a partial object that merge() lays over the default. normalize() fills
//  missing keys and clamps each number to its SCHEMA range, so an old or
//  hand-edited JSON still loads.
//
//  atmo.clarity (view only, default 1) keeps that share of the haze over
//  the ground at the nadir; the Earth-like skies use 0.45 so the ground
//  reads from orbit while the optical depths stay real (tests.mjs).
//  atmo.glow scales the haze light from a hot surface (lava worlds).
//
//  Colours are sRGB triples in 0..1. The atmosphere coefficients are in
//  1/km times 1e-3 (the units of Hillaire 2020), so Earth reads
//  rayleigh = [5.802, 13.558, 33.1].
//
//  grep -n targets: "export const ROCKY_DEFAULT", "export const GAS_DEFAULT",
//  "export const ATMO", "export const PRESETS", "export const SCHEMA",
//  "export function normalize", "export function toJSON", "export function fromJSON"
// ============================================================================

export const FORMAT = 'stella-nova-planet';
export const VERSION = 1;

// Atmospheres. radiusKm and heightKm set the scale of the shell against the
// planet (the render takes the planet radius as 1). Gas giants use a display
// radius: at the true radius their haze would be thinner than one pixel.
export const ATMO = {
  none: { on: 0, radiusKm: 1737, heightKm: 10, rayleigh: [0, 0, 0], rayleighH: 8, mie: [0, 0, 0], mieAbs: [0, 0, 0], mieH: 1.2, mieG: 0.8, absorb: [0, 0, 0], absorbC: 25, absorbW: 15, density: 1, sun: 10, ground: 0.12 },
  earth: { on: 1, radiusKm: 6360, heightKm: 100, rayleigh: [5.802, 13.558, 33.1], rayleighH: 8, mie: [3.996, 3.996, 3.996], mieAbs: [4.4, 4.4, 4.4], mieH: 1.2, mieG: 0.8, absorb: [0.65, 1.881, 0.085], absorbC: 25, absorbW: 15, density: 1, sun: 10, ground: 0.3, clarity: 0.45 },
  // Mars: a thin CO2 sky lit mostly by dust that absorbs blue (butterscotch noon)
  mars: { on: 1, radiusKm: 3390, heightKm: 80, rayleigh: [0.19, 0.42, 1.0], rayleighH: 11, mie: [16, 13, 10], mieAbs: [2, 4.5, 9], mieH: 9, mieG: 0.72, absorb: [0, 0, 0], absorbC: 25, absorbW: 15, density: 1, sun: 10, ground: 0.25 },
  // dusty orange desert sky
  dust: { on: 1, radiusKm: 6000, heightKm: 100, rayleigh: [4.2, 9.8, 23.9], rayleighH: 8, mie: [14, 11.5, 8.5], mieAbs: [3, 5, 9], mieH: 2.6, mieG: 0.78, absorb: [0, 0, 0], absorbC: 25, absorbW: 15, density: 1, sun: 10, ground: 0.4 },
  // thin, pale blue sky of a frozen world
  thin: { on: 1, radiusKm: 5200, heightKm: 70, rayleigh: [3.4, 8, 19.5], rayleighH: 7, mie: [1.5, 1.5, 1.5], mieAbs: [0.3, 0.3, 0.3], mieH: 1.2, mieG: 0.8, absorb: [0, 0, 0], absorbC: 25, absorbW: 15, density: 0.7, sun: 10, ground: 0.6 },
  // Venus-like: dense CO2 with a sulphuric haze that absorbs blue
  venus: { on: 1, radiusKm: 6050, heightKm: 140, rayleigh: [9, 21, 51], rayleighH: 15, mie: [40, 36, 26], mieAbs: [0.6, 2, 9], mieH: 6, mieG: 0.7, absorb: [0, 0, 0], absorbC: 60, absorbW: 20, density: 1, sun: 10, ground: 0.2 },
  // Titan-like: thick orange tholin haze, almost no surface contrast
  titan: { on: 1, radiusKm: 2575, heightKm: 200, rayleigh: [1.2, 2.8, 6.8], rayleighH: 21, mie: [26, 18, 9], mieAbs: [1.5, 5, 14], mieH: 30, mieG: 0.65, absorb: [0, 0, 0], absorbC: 60, absorbW: 20, density: 1, sun: 10, ground: 0.2 },
  // ocean world: Earth air, a little more water haze
  ocean: { on: 1, radiusKm: 6800, heightKm: 100, rayleigh: [5.802, 13.558, 33.1], rayleighH: 8, mie: [6, 6, 6], mieAbs: [2, 2, 2], mieH: 1.4, mieG: 0.8, absorb: [0.65, 1.881, 0.085], absorbC: 25, absorbW: 15, density: 1, sun: 10, ground: 0.25, clarity: 0.45 },
  // lava world: a dark, sooty, ash-laden haze. Its soot absorbs more than
  // it scatters (single-scattering albedo about 0.3) and absorbs blue most,
  // so the sky is grey-brown and dim; at night the lava lights it from below
  // (glow x the mean surface emission, render.js).
  lava: { on: 1, radiusKm: 6200, heightKm: 120, rayleigh: [1.2, 2.8, 6.8], rayleighH: 10, mie: [9, 8, 7], mieAbs: [20, 24, 30], mieH: 10, mieG: 0.7, absorb: [0, 0, 0], absorbC: 25, absorbW: 15, density: 1, sun: 10, ground: 0.12, glow: 0.6 },
  // gas giants: H2/He Rayleigh plus a coloured haze; absorb is methane (red)
  jupiter: { on: 1, radiusKm: 7000, heightKm: 260, rayleigh: [1.6, 3.7, 9], rayleighH: 30, mie: [4.5, 4, 3], mieAbs: [0.6, 1.2, 2.6], mieH: 22, mieG: 0.7, absorb: [0, 0, 0], absorbC: 60, absorbW: 40, density: 1, sun: 10, ground: 0.5 },
  saturn: { on: 1, radiusKm: 7000, heightKm: 300, rayleigh: [1.3, 3, 7.4], rayleighH: 34, mie: [5, 4.6, 3.6], mieAbs: [0.4, 0.9, 2.2], mieH: 30, mieG: 0.7, absorb: [0, 0, 0], absorbC: 60, absorbW: 40, density: 1, sun: 10, ground: 0.5 },
  neptune: { on: 1, radiusKm: 7000, heightKm: 300, rayleigh: [2.4, 5.6, 13.6], rayleighH: 34, mie: [1.6, 1.6, 1.6], mieAbs: [0.2, 0.2, 0.2], mieH: 20, mieG: 0.7, absorb: [5.5, 1.2, 0.15], absorbC: 40, absorbW: 120, density: 1, sun: 10, ground: 0.4 },
  hot: { on: 1, radiusKm: 7000, heightKm: 320, rayleigh: [1.0, 2.4, 5.8], rayleighH: 40, mie: [6, 4, 2.4], mieAbs: [2, 4, 8], mieH: 30, mieG: 0.6, absorb: [0, 0, 0], absorbC: 60, absorbW: 40, density: 1, sun: 10, ground: 0.2 },
};

// every sky has both view keys: clear ground (1) and no surface glow (0) unless set
for (const a of Object.values(ATMO)) { a.clarity ??= 1; a.glow ??= 0; }

export const ROCKY_DEFAULT = {
  kind: 'rocky', name: 'Rocky world', seed: 1,
  terrain: { amp: 1, freq: 0.9, octaves: 7, lacunarity: 2.05, gain: 0.47, warp: 0.14, warpFreq: 0.9, dichotomy: 0 },
  plates: { count: 14, weight: 0.32, uplift: 0.7, width: 0.12, oceanic: 0.55 },
  mountains: { amp: 0.55, freq: 2.4, octaves: 6, lacunarity: 2.1, gain: 0.5, sharpness: 2.2 },
  erosion: { strength: 1.5, detail: 0.16, freq: 6, octaves: 6, flow: 1, talus: 0.4 },
  craters: { density: 0, rMin: 0.006, rMax: 0.2, slope: 2.0, depth: 1, rim: 1, ejecta: 0.6, maria: 0 },
  ocean: { level: 0.6, liquid: 0 },   // liquid: 0 water, 1 lava, 2 methane
  climate: { equatorC: 28, poleC: -28, lapse: 6.5, moisture: 0.55, life: 1, iceC: -12, cities: 0 },
  rivers: { amount: 0 },
  dunes: { amount: 0, freq: 40 },
  cracks: { amount: 0, freq: 2.5, glow: 0 },
  volcanoes: { count: 0, glow: 0 },
  clouds: { cover: 0.5, freq: 1.5, swirl: 0.6, cyclones: 6, height: 0.006, cirrus: 0.3, color: [1, 1, 1] },
  relief: 12, radiusKm: 6371, bump: 3, tilt: 23, spin: 1,
  palette: {
    deep: [0.03, 0.07, 0.17], shallow: [0.06, 0.2, 0.32], beach: [0.62, 0.56, 0.42],
    low: [0.42, 0.36, 0.28], high: [0.56, 0.52, 0.46], rock: [0.34, 0.31, 0.28],
    dark: [0.16, 0.15, 0.14], bright: [0.82, 0.8, 0.76], ice: [0.92, 0.95, 0.98],
    accent: [0.6, 0.3, 0.15],
  },
  atmo: ATMO.earth,
  rings: { on: 0, inner: 1.3, outer: 2.1, opacity: 0.7, color: [0.75, 0.7, 0.62] },
};

export const GAS_DEFAULT = {
  kind: 'gas', name: 'Gas giant', seed: 1,
  bands: { count: 14, contrast: 0.75, jitter: 0.35, symmetric: 1, soft: 0.35, equatorJet: 0.7, jetWidth: 0.22 },
  turbulence: { amount: 0.6, freq: 3.2, octaves: 5, lacunarity: 2.1, gain: 0.55, advect: 0.5, steps: 4, streak: 7, shear: 0.7 },
  storms: { spot: 1, spotLat: -22, spotLon: 0.35, spotSize: 0.16, ovals: 6, ovalLat: -33, small: 40, polar: 1 },
  haze: { amount: 0.25, polar: 0.5 },
  glow: 0,
  clouds: { cover: 0.12, color: [1, 1, 1] },
  relief: 40, radiusKm: 69911, bump: 6, tilt: 3, spin: 2.4,
  palette: {
    stops: [[0, [0.42, 0.26, 0.16]], [0.3, [0.66, 0.48, 0.34]], [0.55, [0.86, 0.76, 0.62]], [0.8, [0.95, 0.91, 0.84]], [1, [0.98, 0.96, 0.92]]],
    spot: [0.72, 0.32, 0.18], polar: [0.36, 0.38, 0.42], oval: [0.97, 0.96, 0.94], barge: [0.32, 0.18, 0.12],
  },
  atmo: ATMO.jupiter,
  rings: { on: 0, inner: 1.24, outer: 2.27, opacity: 0.9, color: [0.82, 0.76, 0.64] },
};

// Presets: { id, name, kind, blurb, seed, p } with p laid over the default.
export const PRESETS = [
  { id: 'earth', name: 'Earth-like', kind: 'rocky', seed: 4127, blurb: 'continents on 14 plates, biomes from temperature and rain, ice caps, city lights',
    p: { climate: { cities: 0.7 }, rivers: { amount: 0.5 }, clouds: { cover: 0.42 } } },
  { id: 'mars', name: 'Mars-like', kind: 'rocky', seed: 2203, blurb: 'a crustal dichotomy, layered craters, dust and two CO2 caps',
    p: { terrain: { amp: 0.7, warp: 0.25, dichotomy: 0.8 }, plates: { count: 5, weight: 0.2, uplift: 0.9 },
      mountains: { amp: 0.4, sharpness: 2.6 }, erosion: { detail: 0.12 },
      craters: { density: 0.45, rMin: 0.006, rMax: 0.16, slope: 1.9, depth: 0.9, ejecta: 0.2, maria: 0.35 },
      ocean: { level: 0 }, climate: { equatorC: -20, poleC: -110, lapse: 2.5, moisture: 0, life: 0, iceC: -95 },
      clouds: { cover: 0.04, color: [0.95, 0.9, 0.85] }, relief: 20, radiusKm: 3390, tilt: 25,
      palette: { low: [0.62, 0.36, 0.2], high: [0.74, 0.5, 0.32], rock: [0.45, 0.28, 0.18], dark: [0.3, 0.18, 0.12], bright: [0.8, 0.6, 0.45], ice: [0.94, 0.92, 0.9], accent: [0.55, 0.25, 0.12] },
      atmo: ATMO.mars } },
  { id: 'moon', name: 'Moon-like', kind: 'rocky', seed: 1969, blurb: 'an airless body: power-law crater fields with rims, ejecta and rays, dark maria',
    p: { terrain: { amp: 0.25, octaves: 6, warp: 0.2 }, plates: { count: 0 }, mountains: { amp: 0.05 }, erosion: { strength: 0.3, detail: 0.08 },
      craters: { density: 1, rMin: 0.005, rMax: 0.24, slope: 2.0, depth: 1.1, rim: 1.1, ejecta: 0.9, maria: 0.7 },
      ocean: { level: 0 }, climate: { equatorC: 100, poleC: -150, lapse: 0, moisture: 0, life: 0, iceC: -300 },
      clouds: { cover: 0 }, relief: 18, radiusKm: 1737, tilt: 1.5, spin: 0.6,
      palette: { low: [0.4, 0.39, 0.37], high: [0.6, 0.59, 0.56], rock: [0.48, 0.47, 0.45], dark: [0.2, 0.2, 0.2], bright: [0.86, 0.85, 0.83], accent: [0.5, 0.48, 0.45] },
      atmo: ATMO.none } },
  { id: 'io', name: 'Io-like', kind: 'rocky', seed: 1610, blurb: 'sulphur plains, dark calderas with red plume rings and glowing vents',
    p: { terrain: { amp: 0.35, freq: 1.6, warp: 0.6 }, plates: { count: 0 }, mountains: { amp: 0.25, sharpness: 3 }, erosion: { detail: 0.08 },
      volcanoes: { count: 70, glow: 1 }, ocean: { level: 0 }, climate: { equatorC: -140, poleC: -160, lapse: 0, moisture: 0, life: 0, iceC: -300 },
      clouds: { cover: 0 }, relief: 10, radiusKm: 1822, tilt: 0.1, spin: 0.8,
      palette: { low: [0.86, 0.76, 0.38], high: [0.92, 0.88, 0.7], rock: [0.62, 0.5, 0.3], dark: [0.12, 0.09, 0.07], bright: [0.94, 0.92, 0.84], accent: [0.72, 0.34, 0.12] },
      atmo: ATMO.none } },
  { id: 'ocean', name: 'Ocean world', kind: 'rocky', seed: 808, blurb: '96 % sea, volcanic island arcs on the plate edges, a cloudy wet sky',
    p: { ocean: { level: 0.955 }, plates: { count: 16, uplift: 1.2, width: 0.08 }, mountains: { amp: 0.7 },
      climate: { equatorC: 30, poleC: -14, moisture: 0.9 }, clouds: { cover: 0.5, cyclones: 9 }, relief: 14, radiusKm: 6800,
      palette: { deep: [0.02, 0.06, 0.18], shallow: [0.05, 0.28, 0.38] },
      atmo: ATMO.ocean } },
  { id: 'desert', name: 'Desert world', kind: 'rocky', seed: 1965, blurb: 'no sea, dune seas in the basins, bare ranges, small caps, a dusty sky',
    p: { terrain: { warp: 0.5 }, plates: { count: 9, weight: 0.25 }, mountains: { amp: 0.6, sharpness: 2.8 }, erosion: { strength: 2.2, detail: 0.2 },
      craters: { density: 0.05, ejecta: 0.1 }, ocean: { level: 0 }, dunes: { amount: 1, freq: 42 },
      climate: { equatorC: 45, poleC: -45, lapse: 7, moisture: 0.04, life: 0, iceC: -30 },
      clouds: { cover: 0.06, color: [0.98, 0.92, 0.84] }, relief: 14, radiusKm: 6000,
      palette: { low: [0.78, 0.6, 0.38], high: [0.66, 0.5, 0.34], rock: [0.48, 0.36, 0.26], dark: [0.38, 0.27, 0.18], bright: [0.9, 0.78, 0.58], accent: [0.62, 0.36, 0.2] },
      atmo: ATMO.dust } },
  { id: 'ice', name: 'Ice world', kind: 'rocky', seed: 3141, blurb: 'a frozen sea cut by cracked ridges, ice sheets on the land, a thin pale sky',
    p: { ocean: { level: 0.55 }, plates: { count: 10 }, cracks: { amount: 0.9, freq: 2.2 },
      climate: { equatorC: -25, poleC: -70, lapse: 6, moisture: 0.4, life: 0, iceC: -4 },
      craters: { density: 0.08, ejecta: 0.3 }, clouds: { cover: 0.25 }, relief: 8, radiusKm: 5200, tilt: 12,
      palette: { deep: [0.05, 0.12, 0.2], shallow: [0.12, 0.26, 0.34], low: [0.62, 0.62, 0.62], high: [0.78, 0.78, 0.8], rock: [0.38, 0.38, 0.4], ice: [0.86, 0.92, 0.97], accent: [0.56, 0.38, 0.28] },
      atmo: ATMO.thin } },
  { id: 'lava', name: 'Lava world', kind: 'rocky', seed: 666, blurb: 'molten lowlands, glowing rifts between plates, a thick hot haze',
    p: { ocean: { level: 0.42, liquid: 1 }, plates: { count: 16, uplift: 1.0, width: 0.1 }, mountains: { amp: 0.65, sharpness: 2.8 },
      cracks: { amount: 0.8, freq: 3, glow: 1 }, craters: { density: 0.05, ejecta: 0 },
      climate: { equatorC: 420, poleC: 380, lapse: 4, moisture: 0, life: 0, iceC: -300 },
      clouds: { cover: 0.18, color: [0.55, 0.5, 0.46] }, relief: 12, radiusKm: 6200, tilt: 8,
      palette: { low: [0.09, 0.08, 0.08], high: [0.2, 0.18, 0.17], rock: [0.13, 0.12, 0.11], dark: [0.05, 0.05, 0.05], bright: [0.4, 0.37, 0.34], accent: [0.3, 0.12, 0.06] },
      atmo: ATMO.lava } },
  { id: 'titan', name: 'Haze moon', kind: 'rocky', seed: 1655, blurb: 'Titan-like: methane lakes at the poles under a thick orange tholin haze',
    p: { ocean: { level: 0.1, liquid: 2 }, plates: { count: 0 }, terrain: { amp: 0.8, warp: 0.6 }, mountains: { amp: 0.25 }, dunes: { amount: 0.8, freq: 46 },
      climate: { equatorC: -179, poleC: -183, lapse: 1, moisture: 0.3, life: 0, iceC: -300 },
      craters: { density: 0.02 }, clouds: { cover: 0.08, color: [0.96, 0.86, 0.7] }, relief: 3, radiusKm: 2575, tilt: 27,
      palette: { deep: [0.03, 0.03, 0.03], shallow: [0.06, 0.05, 0.04], low: [0.34, 0.26, 0.17], high: [0.5, 0.42, 0.3], rock: [0.42, 0.35, 0.26], dark: [0.2, 0.15, 0.1], bright: [0.62, 0.55, 0.42] },
      atmo: ATMO.titan } },
  { id: 'jupiter', name: 'Jupiter-like', kind: 'gas', seed: 1979, blurb: 'cream zones and brown belts, a great red anticyclone, white ovals, polar cyclones',
    p: {} },
  { id: 'saturn', name: 'Saturn-like', kind: 'gas', seed: 1610, blurb: 'soft butterscotch bands under haze, a polar hexagon and ringed shadow',
    p: { bands: { count: 18, contrast: 0.35, jitter: 0.25, equatorJet: 1, jetWidth: 0.3 }, turbulence: { amount: 0.3, advect: 0.35, streak: 9 },
      storms: { spot: 0, ovals: 2, ovalLat: 42, small: 10, polar: 2 }, haze: { amount: 0.6, polar: 0.6 }, clouds: { cover: 0.06 },
      tilt: 26.7, radiusKm: 58232, spin: 2.2,
      palette: { stops: [[0, [0.55, 0.44, 0.3]], [0.35, [0.74, 0.63, 0.45]], [0.65, [0.86, 0.78, 0.6]], [1, [0.94, 0.9, 0.78]]], spot: [0.9, 0.86, 0.76], polar: [0.42, 0.52, 0.6], oval: [0.96, 0.94, 0.88], barge: [0.5, 0.4, 0.3] },
      atmo: ATMO.saturn, rings: { on: 1, inner: 1.24, outer: 2.27, opacity: 0.92, color: [0.84, 0.78, 0.66] } } },
  { id: 'neptune', name: 'Neptune-like', kind: 'gas', seed: 1846, blurb: 'an ice giant: a retrograde equator jet, a dark spot and bright methane cirrus',
    p: { bands: { count: 8, contrast: 0.3, jitter: 0.5, equatorJet: -1, jetWidth: 0.55 }, turbulence: { amount: 0.45, freq: 2.6, advect: 0.6, streak: 10 },
      storms: { spot: 1, spotLat: -20, spotLon: 0.6, spotSize: 0.1, ovals: 1, ovalLat: -55, small: 6, polar: 0 }, haze: { amount: 0.5, polar: 0.3 },
      clouds: { cover: 0.32 }, tilt: 28.3, radiusKm: 24622, spin: 2.0, bump: 4,
      palette: { stops: [[0, [0.12, 0.22, 0.5]], [0.4, [0.22, 0.38, 0.72]], [0.7, [0.3, 0.48, 0.8]], [1, [0.44, 0.6, 0.86]]], spot: [0.08, 0.13, 0.32], polar: [0.26, 0.4, 0.7], oval: [0.92, 0.95, 1], barge: [0.14, 0.24, 0.5] },
      atmo: ATMO.neptune } },
  { id: 'hotjupiter', name: 'Hot Jupiter', kind: 'gas', seed: 51, blurb: 'a tidally heated giant: dark absorbing clouds, thermal glow from the deep belts',
    p: { bands: { count: 10, contrast: 0.55, jitter: 0.45, equatorJet: 1.4, jetWidth: 0.4 }, turbulence: { amount: 0.8, advect: 0.8, streak: 5 },
      storms: { spot: 0, ovals: 0, small: 25, polar: 0 }, haze: { amount: 0.3, polar: 0.2 }, glow: 1, clouds: { cover: 0.1, color: [0.8, 0.6, 0.45] },
      tilt: 0, radiusKm: 95000, spin: 3,
      palette: { stops: [[0, [0.1, 0.05, 0.04]], [0.4, [0.25, 0.12, 0.08]], [0.75, [0.42, 0.26, 0.18]], [1, [0.58, 0.42, 0.3]]], spot: [0.5, 0.2, 0.1], polar: [0.15, 0.08, 0.06], oval: [0.7, 0.55, 0.45], barge: [0.08, 0.04, 0.03] },
      atmo: ATMO.hot } },
];

// The UI builds its sliders from SCHEMA: [group, path, label, min, max, step].
export const SCHEMA = {
  rocky: [
    ['Continents', 'terrain.amp', 'amplitude', 0, 1.5, 0.01],
    ['Continents', 'terrain.freq', 'frequency', 0.3, 4, 0.01],
    ['Continents', 'terrain.octaves', 'octaves', 1, 10, 0.25],
    ['Continents', 'terrain.lacunarity', 'lacunarity', 1.5, 3, 0.01],
    ['Continents', 'terrain.gain', 'gain', 0.2, 0.8, 0.01],
    ['Continents', 'terrain.warp', 'warp strength', 0, 1.5, 0.01],
    ['Continents', 'terrain.warpFreq', 'warp frequency', 0.3, 4, 0.01],
    ['Continents', 'terrain.dichotomy', 'hemisphere dichotomy', 0, 1.5, 0.01],
    ['Plates', 'plates.count', 'plates', 0, 32, 1],
    ['Plates', 'plates.weight', 'plate relief', 0, 1, 0.01],
    ['Plates', 'plates.uplift', 'collision uplift', 0, 2, 0.01],
    ['Plates', 'plates.width', 'boundary width', 0.02, 0.3, 0.005],
    ['Plates', 'plates.oceanic', 'oceanic share', 0, 1, 0.01],
    ['Mountains', 'mountains.amp', 'height', 0, 1.5, 0.01],
    ['Mountains', 'mountains.freq', 'frequency', 0.5, 8, 0.01],
    ['Mountains', 'mountains.octaves', 'octaves', 1, 10, 0.25],
    ['Mountains', 'mountains.gain', 'gain', 0.2, 0.8, 0.01],
    ['Mountains', 'mountains.sharpness', 'ridge sharpness', 0.5, 5, 0.05],
    ['Erosion', 'erosion.strength', 'slope damping', 0, 5, 0.05],
    ['Erosion', 'erosion.detail', 'detail', 0, 0.5, 0.005],
    ['Erosion', 'erosion.freq', 'detail frequency', 2, 20, 0.1],
    ['Erosion', 'erosion.octaves', 'detail octaves', 1, 10, 0.25],
    ['Erosion', 'erosion.flow', 'river erosion (air only)', 0, 3, 0.01],
    ['Erosion', 'erosion.talus', 'talus slopes', 0, 1, 0.01],
    ['Craters', 'craters.density', 'density', 0, 1.5, 0.01],
    ['Craters', 'craters.rMin', 'smallest radius (rad)', 0.002, 0.05, 0.001],
    ['Craters', 'craters.rMax', 'largest radius (rad)', 0.02, 0.4, 0.005],
    ['Craters', 'craters.slope', 'size power law α', 1.2, 3.5, 0.05],
    ['Craters', 'craters.depth', 'depth', 0, 2.5, 0.01],
    ['Craters', 'craters.rim', 'rim height', 0, 2.5, 0.01],
    ['Craters', 'craters.ejecta', 'ejecta and rays', 0, 1.5, 0.01],
    ['Craters', 'craters.maria', 'maria (dark basins)', 0, 1, 0.01],
    ['Surface', 'ocean.level', 'sea cover', 0, 0.99, 0.005],
    ['Surface', 'ocean.liquid', 'liquid: water · lava · methane', 0, 2, 1],
    ['Surface', 'rivers.amount', 'rivers', 0, 1, 0.01],
    ['Surface', 'dunes.amount', 'dunes', 0, 1.5, 0.01],
    ['Surface', 'dunes.freq', 'dune frequency', 10, 90, 1],
    ['Surface', 'cracks.amount', 'cracks and lineae', 0, 1.5, 0.01],
    ['Surface', 'cracks.freq', 'crack frequency', 0.5, 8, 0.05],
    ['Surface', 'cracks.glow', 'crack glow', 0, 2, 0.01],
    ['Surface', 'volcanoes.count', 'volcanic calderas', 0, 200, 1],
    ['Surface', 'volcanoes.glow', 'vent glow', 0, 2, 0.01],
    ['Climate', 'climate.equatorC', 'equator °C', -200, 500, 1],
    ['Climate', 'climate.poleC', 'pole °C', -250, 450, 1],
    ['Climate', 'climate.lapse', 'lapse °C/km', 0, 12, 0.1],
    ['Climate', 'climate.moisture', 'moisture', 0, 1, 0.01],
    ['Climate', 'climate.life', 'vegetation', 0, 1, 0.01],
    ['Climate', 'climate.iceC', 'freeze °C', -300, 20, 1],
    ['Climate', 'climate.cities', 'city lights', 0, 1, 0.01],
    ['Clouds', 'clouds.cover', 'cover', 0, 1, 0.01],
    ['Clouds', 'clouds.freq', 'frequency', 0.5, 6, 0.01],
    ['Clouds', 'clouds.swirl', 'swirl', 0, 2, 0.01],
    ['Clouds', 'clouds.cyclones', 'cyclones', 0, 12, 1],
    ['Clouds', 'clouds.cirrus', 'high cirrus', 0, 1, 0.01],
    ['Clouds', 'clouds.height', 'deck height (radii)', 0.002, 0.02, 0.0005],
    ['Body', 'relief', 'relief km', 0.5, 40, 0.1],
    ['Body', 'radiusKm', 'radius km', 200, 20000, 1],
    ['Body', 'bump', 'normal strength', 0, 8, 0.05],
    ['Body', 'tilt', 'axial tilt °', 0, 90, 0.1],
    ['Body', 'spin', 'spin (view)', 0, 4, 0.01],
  ],
  gas: [
    ['Bands', 'bands.count', 'band count', 2, 32, 1],
    ['Bands', 'bands.contrast', 'contrast', 0, 1.5, 0.01],
    ['Bands', 'bands.jitter', 'width jitter', 0, 1, 0.01],
    ['Bands', 'bands.symmetric', 'mirror N/S', 0, 1, 1],
    ['Bands', 'bands.soft', 'edge softness', 0.02, 1, 0.01],
    ['Bands', 'bands.equatorJet', 'equator jet', -2, 2, 0.01],
    ['Bands', 'bands.jetWidth', 'equator jet width', 0.05, 0.8, 0.01],
    ['Turbulence', 'turbulence.amount', 'turbulence', 0, 1.5, 0.01],
    ['Turbulence', 'turbulence.freq', 'frequency', 0.5, 10, 0.05],
    ['Turbulence', 'turbulence.octaves', 'octaves', 1, 8, 0.25],
    ['Turbulence', 'turbulence.lacunarity', 'lacunarity', 1.5, 3, 0.01],
    ['Turbulence', 'turbulence.gain', 'gain', 0.2, 0.8, 0.01],
    ['Turbulence', 'turbulence.advect', 'curl advection', 0, 2, 0.01],
    ['Turbulence', 'turbulence.steps', 'advection steps', 1, 8, 1],
    ['Turbulence', 'turbulence.streak', 'zonal stretch', 1, 20, 0.1],
    ['Turbulence', 'turbulence.shear', 'shear focus', 0, 1, 0.01],
    ['Storms', 'storms.spot', 'great spot', 0, 1, 1],
    ['Storms', 'storms.spotLat', 'spot latitude °', -60, 60, 0.5],
    ['Storms', 'storms.spotLon', 'spot longitude', 0, 1, 0.005],
    ['Storms', 'storms.spotSize', 'spot size (rad)', 0.03, 0.35, 0.005],
    ['Storms', 'storms.ovals', 'oval chain', 0, 16, 1],
    ['Storms', 'storms.ovalLat', 'oval latitude °', -70, 70, 0.5],
    ['Storms', 'storms.small', 'small storms', 0, 160, 1],
    ['Storms', 'storms.polar', 'poles: none · cyclones · hexagon', 0, 2, 1],
    ['Haze', 'haze.amount', 'haze', 0, 1, 0.01],
    ['Haze', 'haze.polar', 'polar darkening', 0, 1, 0.01],
    ['Haze', 'glow', 'thermal glow', 0, 2, 0.01],
    ['Haze', 'clouds.cover', 'high cirrus', 0, 1, 0.01],
    ['Rings', 'rings.on', 'rings', 0, 1, 1],
    ['Rings', 'rings.inner', 'inner radius', 1.05, 3, 0.01],
    ['Rings', 'rings.outer', 'outer radius', 1.2, 4, 0.01],
    ['Rings', 'rings.opacity', 'opacity', 0, 1, 0.01],
    ['Body', 'relief', 'cloud relief km', 1, 200, 1],
    ['Body', 'radiusKm', 'radius km', 15000, 150000, 1],
    ['Body', 'bump', 'normal strength', 0, 20, 0.1],
    ['Body', 'tilt', 'axial tilt °', 0, 90, 0.1],
    ['Body', 'spin', 'spin (view)', 0, 6, 0.01],
  ],
  atmo: [
    ['Atmosphere', 'atmo.on', 'atmosphere', 0, 1, 1],
    ['Atmosphere', 'atmo.density', 'density ×', 0, 4, 0.01],
    ['Atmosphere', 'atmo.heightKm', 'height km', 10, 600, 1],
    ['Atmosphere', 'atmo.radiusKm', 'scale radius km', 500, 12000, 1],
    ['Atmosphere', 'atmo.rayleighH', 'Rayleigh scale height km', 1, 80, 0.1],
    ['Atmosphere', 'atmo.mieH', 'Mie scale height km', 0.2, 60, 0.1],
    ['Atmosphere', 'atmo.mieG', 'Mie anisotropy g', 0, 0.95, 0.01],
    ['Atmosphere', 'atmo.sun', 'sun illuminance', 1, 40, 0.1],
    ['Atmosphere', 'atmo.clarity', 'ground clarity (view)', 0.1, 1, 0.01],
    ['Atmosphere', 'atmo.glow', 'haze glow from the surface', 0, 2, 0.01],
  ],
};

// ── helpers ─────────────────────────────────────────────────────────────
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
export function clone(v) { return JSON.parse(JSON.stringify(v)); }
export function merge(base, over) {
  const out = clone(base);
  if (!isObj(over)) return out;
  for (const k of Object.keys(over)) {
    if (isObj(over[k]) && isObj(out[k])) out[k] = merge(out[k], over[k]);
    else out[k] = clone(over[k]);
  }
  return out;
}
export function getPath(o, path) { return path.split('.').reduce((a, k) => a == null ? a : a[k], o); }
export function setPath(o, path, v) {
  const ks = path.split('.'); let a = o;
  for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]] = isObj(a[ks[i]]) ? a[ks[i]] : {};
  a[ks[ks.length - 1]] = v;
}

export function presetById(id) { return PRESETS.find(p => p.id === id) || PRESETS[0]; }
export function fromPreset(id, seed) {
  const pr = presetById(id);
  const P = merge(pr.kind === 'gas' ? GAS_DEFAULT : ROCKY_DEFAULT, pr.p);
  P.name = pr.name; P.preset = pr.id; P.seed = seed != null ? seed >>> 0 : pr.seed;
  return normalize(P);
}

// Fill missing keys from the default and clamp every SCHEMA number.
export function normalize(P) {
  const kind = P && P.kind === 'gas' ? 'gas' : 'rocky';
  const out = merge(kind === 'gas' ? GAS_DEFAULT : ROCKY_DEFAULT, P || {});
  out.kind = kind;
  out.seed = (Number(out.seed) >>> 0) || 0;
  for (const [, path, , lo, hi, step] of [...SCHEMA[kind], ...SCHEMA.atmo]) {
    let v = Number(getPath(out, path));
    if (!Number.isFinite(v)) v = Number(getPath(kind === 'gas' ? GAS_DEFAULT : ROCKY_DEFAULT, path));
    v = Math.min(hi, Math.max(lo, v));
    if (step >= 1) v = Math.round(v);
    setPath(out, path, v);
  }
  return out;
}

// The JSON a planet saves as. width is the map width it was made at.
export function toJSON(P, width) {
  return JSON.stringify({ format: FORMAT, version: VERSION, width: width | 0, planet: P }, null, 1);
}
export function fromJSON(text) {
  const o = typeof text === 'string' ? JSON.parse(text) : text;
  if (!o || o.format !== FORMAT) throw new Error('not a ' + FORMAT + ' file');
  return { width: o.width | 0, planet: normalize(o.planet) };
}

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
//  Families: a preset is a family, not one planet. fromPreset(id, seed)
//  lays pr.p over the default, then pr.vary(F) with F a dice seeded by the
//  seed: sea cover, temperatures, palette hue, crater and volcano counts,
//  radius and so on. So each seed gives a different member of the family,
//  and the same seed always gives the same member. ALIASES maps old preset
//  ids (saved JSON files, links) to the family that replaced them.
//
//  atmo.clarity (view only, default 1) keeps that share of the haze over
//  the ground at the nadir; the Earth-like skies use 0.45 so the ground
//  reads from orbit while the optical depths stay real (tests.mjs).
//  atmo.glow scales the haze light from a hot surface (lava worlds).
//  lava = { heat, age, sulfur } (0..1) shapes a lava sea (rocky.js
//  lavaSea) and the lava channels (maps.js): tidal heating, crust age,
//  sulfur frost. Other worlds do not read it.
//
//  Colours are sRGB triples in 0..1. The atmosphere coefficients are in
//  1/km times 1e-3 (the units of Hillaire 2020), so Earth reads
//  rayleigh = [5.802, 13.558, 33.1].
//
//  grep -n targets: "export const ROCKY_DEFAULT", "export const GAS_DEFAULT",
//  "export const ALIASES", "function dice", "export function fromPreset",
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
  // rust world: a thin CO2 sky lit mostly by iron-oxide dust that absorbs
  // blue (butterscotch noon); the family varies the dust load and tint
  rust: { on: 1, radiusKm: 3390, heightKm: 80, rayleigh: [0.19, 0.42, 1.0], rayleighH: 11, mie: [16, 13, 10], mieAbs: [2, 4.5, 9], mieH: 9, mieG: 0.72, absorb: [0, 0, 0], absorbC: 25, absorbW: 15, density: 1, sun: 10, ground: 0.25 , clarity: 0.6 },
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
  // lava world: a thin, dark sulfurous sky. SO2 and sulfate haze over
  // soot: the sulfate scatters (single-scattering albedo 0.45-0.7) and the
  // soot and SO2 absorb blue most, so the day sky is a smoky tan with
  // little blue Rayleigh light, not mud; the ground stays legible (clarity). At
  // night the lava lights the haze from below (glow x the mean surface
  // emission, render.js).
  lava: { on: 1, radiusKm: 6200, heightKm: 120, rayleigh: [0.35, 0.7, 1.4], rayleighH: 10, mie: [6, 5.2, 4.0], mieAbs: [2.8, 4.2, 6.8], mieH: 8, mieG: 0.66, absorb: [0, 0, 0], absorbC: 25, absorbW: 15, density: 1, sun: 10, ground: 0.1, glow: 1.2, clarity: 0.7 },
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
  terrain: { amp: 1, freq: 0.9, octaves: 7, lacunarity: 2.05, gain: 0.47, warp: 0.14, warpFreq: 0.9, dichotomy: 0, terraces: 0 },
  plates: { count: 14, weight: 0.32, uplift: 0.7, width: 0.12, oceanic: 0.55 },
  mountains: { amp: 0.55, freq: 2.4, octaves: 6, lacunarity: 2.1, gain: 0.5, sharpness: 2.2 },
  erosion: { strength: 1.5, detail: 0.16, freq: 6, octaves: 6, flow: 1, talus: 0.4 },
  craters: { density: 0, rMin: 0.006, rMax: 0.2, slope: 2.0, depth: 1, rim: 1, ejecta: 0.6, maria: 0 },
  ocean: { level: 0.6, liquid: 0 },   // liquid: 0 water, 1 lava, 2 methane
  climate: { equatorC: 28, poleC: -28, lapse: 6.5, moisture: 0.55, life: 1, iceC: -12, cities: 0 },
  rivers: { amount: 0 },
  features: { basins: 0, shields: 0, canyon: 0, streaks: 0, provinces: 0, caps: 0, layers: 0 },
  dunes: { amount: 0, freq: 40 },
  cracks: { amount: 0, freq: 2.5, glow: 0 },
  volcanoes: { count: 0, glow: 0 },
  lava: { heat: 0.6, age: 0.5, sulfur: 0.2 },
  clouds: { cover: 0.5, freq: 1.5, swirl: 0.6, cyclones: 6, height: 0.006, cirrus: 0.3, color: [1, 1, 1] },
  relief: 12, radiusKm: 6371, bump: 3, tilt: 23, spin: 1,
  palette: {
    deep: [0.03, 0.07, 0.17], shallow: [0.06, 0.2, 0.32], beach: [0.62, 0.56, 0.42],
    low: [0.42, 0.36, 0.28], high: [0.56, 0.52, 0.46], rock: [0.34, 0.31, 0.28],
    dark: [0.16, 0.15, 0.14], bright: [0.82, 0.8, 0.76], ice: [0.92, 0.95, 0.98],
    accent: [0.6, 0.3, 0.15], ring: [0.62, 0.22, 0.08],
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

// Presets: { id, name, kind, blurb, seed, p, vary }. p is laid over the
// default, then vary(F) over that (F: the seeded dice of function dice).
// The preset seed is only the first member shown; every seed is a member.
export const PRESETS = [
  { id: 'earth', name: 'Earth-like', kind: 'rocky', seed: 4127, blurb: 'continents on plates, biomes from temperature and rain, ice caps, city lights; each seed moves the sea, the climate and the plates',
    p: { climate: { cities: 0.7 }, rivers: { amount: 0.5 }, clouds: { cover: 0.6 } },
    vary: F => ({ ocean: { level: F.u(0.48, 0.74) }, plates: { count: F.i(8, 20), uplift: F.u(0.5, 0.95) },
      terrain: { freq: F.u(0.7, 1.2), warp: F.u(0.08, 0.22) }, mountains: { amp: F.u(0.4, 0.7) },
      climate: { equatorC: F.u(20, 34), poleC: F.u(-40, -12), moisture: F.u(0.35, 0.8), life: F.u(0.6, 1), cities: F.u(0, 0.8) },
      clouds: { cover: F.u(0.44, 0.61), cyclones: F.i(2, 6) }, tilt: F.u(5, 35), radiusKm: F.u(5200, 7600),
      palette: { deep: F.tint([0.03, 0.07, 0.17], 0.25), shallow: F.tint([0.06, 0.2, 0.32], 0.25) } }) },
  { id: 'rust', name: 'Rust world', kind: 'rocky', seed: 2203, blurb: 'a cold, dry iron-oxide world under a thin dusty sky: each seed draws its own tint, basins, mesas, craters and caps',
    p: { terrain: { amp: 0.7, warp: 0.25 }, plates: { count: 5, weight: 0.2, uplift: 0.9 },
      mountains: { amp: 0.4, sharpness: 2.6 }, erosion: { detail: 0.12, flow: 0.4 },
      craters: { density: 0.3, rMin: 0.006, rMax: 0.16, slope: 1.9, depth: 0.9, ejecta: 0.2, maria: 0.2 },
      ocean: { level: 0 }, climate: { equatorC: -20, poleC: -110, lapse: 2.5, moisture: 0, life: 0, iceC: -95 },
      clouds: { cover: 0, cyclones: 0, color: [0.95, 0.9, 0.85] }, relief: 20, radiusKm: 3390, tilt: 25,
      atmo: ATMO.rust },
    vary: F => {
      // iron oxides from ochre to oxblood to brown-grey (the hue of the dust)
      const base = F.pick([[0.66, 0.4, 0.22], [0.58, 0.26, 0.15], [0.7, 0.52, 0.32], [0.5, 0.36, 0.28], [0.62, 0.32, 0.24], [0.74, 0.46, 0.3]]);
      const b = F.tint(base, 0.1), sh = (k, d = 0) => b.map((v, i) => Math.min(1, v * k + d * (i === 2 ? 0.6 : 1)));
      const dust = F.u(0.5, 1.2), cold = F.u(0, 1);
      return { terrain: { amp: F.u(0.5, 0.95), freq: F.u(0.7, 1.6), warp: F.u(0.12, 0.35), dichotomy: F.u(0, 1) < 0.55 ? F.u(0.3, 1.0) : 0, terraces: F.u(0, 1) < 0.5 ? F.u(0.25, 0.7) : 0 },
        plates: { count: F.i(0, 9) }, mountains: { amp: F.u(0.15, 0.6), sharpness: F.u(2, 3.2) },
        craters: { density: F.u(0.02, 0.6), slope: F.u(1.8, 2.2), maria: F.u(0, 0.4) },
        dunes: { amount: F.u(0, 1) < 0.5 ? F.u(0.3, 0.9) : 0, freq: F.u(34, 56) },
        cracks: { amount: F.u(0, 1) < 0.25 ? F.u(0.2, 0.6) : 0, freq: F.u(1.5, 4) },
        climate: { equatorC: F.u(-40, 0), poleC: F.u(-130, -80), iceC: -110 + 40 * cold },
        relief: F.u(10, 26), radiusKm: F.u(2400, 5400), tilt: F.u(0, 40),
        palette: { low: b, high: sh(1.15, 0.04), rock: sh(0.7), dark: sh(0.45), bright: sh(1.28, 0.1), accent: sh(0.8), ice: F.tint([0.94, 0.92, 0.9], 0.04) },
        atmo: { density: F.u(0.4, 1.2), mie: ATMO.rust.mie.map(v => v * dust), mieAbs: base[1] < 0.3 ? [2, 6.5, 12] : [2, 4.5, 9] },
        // large landforms (geology.js), drawn after the old dice so older
        // members keep their other keys
        features: { basins: F.i(1, 4), shields: F.u(0, 1) < 0.7 ? F.i(1, 5) : 0, canyon: F.u(0, 1) < 0.6 ? F.u(0.5, 1) : 0,
          streaks: F.u(0.4, 1), provinces: F.u(0.5, 0.9), caps: F.u(0.5, 1), layers: F.u(0.3, 0.8) },
        bump: F.u(4, 5.5) };
    } },
  { id: 'moon', name: 'Moon-like', kind: 'rocky', seed: 1969, blurb: 'an airless body: power-law crater fields with rims, ejecta and rays, dark maria; each seed sets the age, the maria and the tint',
    p: { terrain: { amp: 0.25, octaves: 6, warp: 0.2 }, plates: { count: 0 }, mountains: { amp: 0.05 }, erosion: { strength: 0.3, detail: 0.08 },
      craters: { density: 1, rMin: 0.005, rMax: 0.24, slope: 2.0, depth: 1.1, rim: 1.1, ejecta: 0.9, maria: 0.7 },
      ocean: { level: 0 }, climate: { equatorC: 100, poleC: -150, lapse: 0, moisture: 0, life: 0, iceC: -300 },
      clouds: { cover: 0 }, relief: 18, radiusKm: 1737, tilt: 1.5, spin: 0.6,
      palette: { low: [0.4, 0.39, 0.37], high: [0.6, 0.59, 0.56], rock: [0.48, 0.47, 0.45], dark: [0.2, 0.2, 0.2], bright: [0.86, 0.85, 0.83], accent: [0.5, 0.48, 0.45] },
      atmo: ATMO.none },
    vary: F => {
      const t = F.f(0.035), k = F.u(0.7, 1.15), m = (c) => c.map((v, i) => Math.min(1, v * k * t[i]));
      return { craters: { density: F.u(0.55, 1.25), slope: F.u(1.8, 2.3), rMax: F.u(0.14, 0.3), maria: F.u(0, 0.9), ejecta: F.u(0.6, 1.1) },
        terrain: { amp: F.u(0.15, 0.4) }, mountains: { amp: F.u(0, 0.15) }, radiusKm: F.u(700, 2700), tilt: F.u(0, 8),
        palette: { low: m([0.4, 0.39, 0.37]), high: m([0.6, 0.59, 0.56]), rock: m([0.48, 0.47, 0.45]), dark: m([0.2, 0.2, 0.2]), bright: m([0.86, 0.85, 0.83]), accent: m([0.5, 0.48, 0.45]) } };
    } },
  { id: 'volcanic', name: 'Volcanic moon', kind: 'rocky', seed: 1610, blurb: 'a tidally heated airless moon: fresh lava plains, dark calderas, plume rings and glowing vents; each seed draws its own deposits',
    p: { terrain: { amp: 0.35, freq: 1.6, warp: 0.5 }, plates: { count: 0 }, mountains: { amp: 0.25, sharpness: 3 }, erosion: { detail: 0.08 },
      volcanoes: { count: 60, glow: 1 }, ocean: { level: 0 }, climate: { equatorC: -140, poleC: -160, lapse: 0, moisture: 0, life: 0, iceC: -300 },
      clouds: { cover: 0 }, relief: 10, radiusKm: 1822, tilt: 0.1, spin: 0.8, atmo: ATMO.none },
    vary: F => {
      // surface deposits: sulphur frost, basalt with white frost, ash and
      // oxides, greenish olivine plains, salt crust (low, high, rock, accent, ring)
      const D = F.pick([
        [[0.78, 0.7, 0.42], [0.9, 0.86, 0.68], [0.58, 0.48, 0.32], [0.7, 0.36, 0.14], [0.6, 0.24, 0.1]],
        [[0.32, 0.31, 0.3], [0.78, 0.8, 0.82], [0.22, 0.21, 0.2], [0.5, 0.46, 0.42], [0.86, 0.86, 0.84]],
        [[0.5, 0.4, 0.32], [0.68, 0.6, 0.5], [0.36, 0.28, 0.22], [0.55, 0.3, 0.18], [0.2, 0.16, 0.14]],
        [[0.48, 0.47, 0.32], [0.68, 0.66, 0.5], [0.34, 0.33, 0.24], [0.4, 0.42, 0.24], [0.62, 0.5, 0.3]],
        [[0.8, 0.78, 0.74], [0.92, 0.9, 0.86], [0.52, 0.48, 0.44], [0.66, 0.5, 0.36], [0.4, 0.3, 0.26]],
      ]).map(c => F.tint(c, 0.08));
      return { volcanoes: { count: F.i(15, 130), glow: F.u(0.4, 1.5) }, terrain: { amp: F.u(0.2, 0.55), freq: F.u(1, 2.2), warp: F.u(0.2, 0.7) },
        mountains: { amp: F.u(0.1, 0.4) }, craters: { density: F.u(0, 1) < 0.4 ? F.u(0.02, 0.15) : 0 },
        cracks: { amount: F.u(0, 1) < 0.3 ? F.u(0.2, 0.6) : 0, freq: F.u(1.5, 4), glow: F.u(0, 0.6) },
        radiusKm: F.u(900, 2700), tilt: F.u(0, 3),
        palette: { low: D[0], high: D[1], rock: D[2], accent: D[3], ring: D[4], dark: F.tint([0.1, 0.08, 0.07], 0.2), bright: D[1].map(v => Math.min(1, v * 1.06)) } };
    } },
  { id: 'ocean', name: 'Ocean world', kind: 'rocky', seed: 808, blurb: 'a global sea with volcanic island arcs on the plate edges, a thin blue sky and living weather',
    p: { ocean: { level: 0.955 }, plates: { count: 16, uplift: 1.2, width: 0.08 }, mountains: { amp: 0.7 },
      climate: { equatorC: 30, poleC: -14, moisture: 0.9 }, clouds: { cover: 0.62, cyclones: 9 }, relief: 14, radiusKm: 6800,
      palette: { deep: [0.02, 0.06, 0.18], shallow: [0.05, 0.28, 0.38] },
      atmo: ATMO.ocean },
    vary: F => ({ ocean: { level: F.u(0.92, 0.985) }, plates: { count: F.i(10, 24) },
      climate: { equatorC: F.u(22, 36), poleC: F.u(-25, 5) }, clouds: { cover: F.u(0.48, 0.62), cyclones: F.i(3, 8) },
      radiusKm: F.u(5500, 9000), tilt: F.u(0, 30),
      palette: { deep: F.tint([0.02, 0.06, 0.18], 0.3), shallow: F.tint([0.05, 0.28, 0.38], 0.3) } }) },
  { id: 'desert', name: 'Desert world', kind: 'rocky', seed: 1965, blurb: 'a hot world with no sea: dune seas in the basins, bare ranges and mesas, a dusty sky',
    p: { terrain: { warp: 0.5 }, plates: { count: 9, weight: 0.25 }, mountains: { amp: 0.6, sharpness: 2.8 }, erosion: { strength: 2.2, detail: 0.2 },
      craters: { density: 0.05, ejecta: 0.1 }, ocean: { level: 0 }, dunes: { amount: 1, freq: 42 },
      climate: { equatorC: 45, poleC: -45, lapse: 7, moisture: 0.04, life: 0, iceC: -30 },
      clouds: { cover: 0.06, color: [0.98, 0.92, 0.84] }, relief: 14, radiusKm: 6000,
      palette: { low: [0.78, 0.6, 0.38], high: [0.66, 0.5, 0.34], rock: [0.48, 0.36, 0.26], dark: [0.38, 0.27, 0.18], bright: [0.9, 0.78, 0.58], accent: [0.62, 0.36, 0.2] },
      atmo: ATMO.dust },
    vary: F => {
      const t = F.f(0.12), m = c => c.map((v, i) => Math.min(1, v * t[i]));
      return { terrain: { warp: F.u(0.25, 0.6), terraces: F.u(0, 1) < 0.5 ? F.u(0.2, 0.6) : 0 }, plates: { count: F.i(4, 14) },
        dunes: { amount: F.u(0.4, 1.2), freq: F.u(30, 60) }, climate: { equatorC: F.u(30, 60), poleC: F.u(-60, 0) },
        radiusKm: F.u(4500, 7500), tilt: F.u(0, 35),
        palette: { low: m([0.78, 0.6, 0.38]), high: m([0.66, 0.5, 0.34]), rock: m([0.48, 0.36, 0.26]), dark: m([0.38, 0.27, 0.18]), bright: m([0.9, 0.78, 0.58]), accent: m([0.62, 0.36, 0.2]) } };
    } },
  { id: 'ice', name: 'Ice world', kind: 'rocky', seed: 3141, blurb: 'a frozen sea cut by cracked ridges, ice sheets on the land, a thin pale sky',
    p: { ocean: { level: 0.55 }, plates: { count: 10 }, cracks: { amount: 0.9, freq: 2.2 },
      climate: { equatorC: -25, poleC: -70, lapse: 6, moisture: 0.4, life: 0, iceC: -4 },
      craters: { density: 0.08, ejecta: 0.3 }, clouds: { cover: 0.44 }, relief: 8, radiusKm: 5200, tilt: 12,
      palette: { deep: [0.05, 0.12, 0.2], shallow: [0.12, 0.26, 0.34], low: [0.62, 0.62, 0.62], high: [0.78, 0.78, 0.8], rock: [0.38, 0.38, 0.4], ice: [0.86, 0.92, 0.97], accent: [0.56, 0.38, 0.28] },
      atmo: ATMO.thin },
    vary: F => ({ ocean: { level: F.u(0.3, 0.75) }, plates: { count: F.i(4, 16) }, cracks: { amount: F.u(0.4, 1.2), freq: F.u(1.5, 3.5) },
      climate: { equatorC: F.u(-40, -12), poleC: F.u(-90, -50) }, craters: { density: F.u(0, 0.25) }, clouds: { cover: F.u(0.3, 0.53) },
      radiusKm: F.u(2500, 6500), tilt: F.u(0, 30),
      palette: { ice: F.tint([0.86, 0.92, 0.97], 0.05), accent: F.tint([0.56, 0.38, 0.28], 0.25), deep: F.tint([0.05, 0.12, 0.2], 0.25) } }) },
  { id: 'lava', name: 'Lava world', kind: 'rocky', seed: 666, blurb: 'a tidally heated world: a magma sea of crusted rafts with glowing seams, lava rivers from the vents, sulfur frost on old crust, a thin sulfurous sky lit from below',
    p: { ocean: { level: 0.34, liquid: 1 }, plates: { count: 16, uplift: 1.0, width: 0.1 }, mountains: { amp: 0.65, sharpness: 2.8 },
      erosion: { flow: 1.2 }, rivers: { amount: 0.5 },
      cracks: { amount: 0, freq: 2.5, glow: 0 }, craters: { density: 0.05, ejecta: 0 }, volcanoes: { count: 14, glow: 1 },
      lava: { heat: 0.6, age: 0.5, sulfur: 0.25 },
      climate: { equatorC: 420, poleC: 380, lapse: 4, moisture: 0, life: 0, iceC: -300 },
      clouds: { cover: 0.28, color: [0.5, 0.47, 0.4], cirrus: 0.12 }, relief: 12, radiusKm: 6200, tilt: 8,
      palette: { low: [0.07, 0.06, 0.055], high: [0.2, 0.17, 0.14], rock: [0.11, 0.1, 0.09], dark: [0.04, 0.035, 0.03], bright: [0.5, 0.45, 0.3], accent: [0.62, 0.5, 0.14], ring: [0.55, 0.45, 0.2] },
      atmo: ATMO.lava },
    vary: F => {
      const airless = F.u(0, 1) < 0.25;
      return { ocean: { level: F.u(0.15, 0.6) }, plates: { count: F.i(8, 24) }, mountains: { amp: F.u(0.4, 0.8) },
        rivers: { amount: F.u(0.3, 0.7) },
        volcanoes: { count: F.i(4, 30), glow: F.u(0.6, 1.4) },
        lava: { heat: F.u(0.25, 1), age: F.u(0.1, 0.95), sulfur: F.u(0, 0.8) },
        clouds: { cover: airless ? 0 : F.u(0.1, 0.4) }, radiusKm: F.u(4000, 8000), tilt: F.u(0, 25),
        atmo: airless ? ATMO.none : { density: F.u(0.6, 1.5), glow: F.u(0.8, 1.4) } };
    } },
  { id: 'titan', name: 'Haze moon', kind: 'rocky', seed: 1655, blurb: 'Titan-like: methane lakes at the poles under a thick orange tholin haze',
    p: { ocean: { level: 0.1, liquid: 2 }, plates: { count: 0 }, terrain: { amp: 0.8, warp: 0.6 }, mountains: { amp: 0.25 }, dunes: { amount: 0.8, freq: 46 },
      climate: { equatorC: -179, poleC: -183, lapse: 1, moisture: 0.3, life: 0, iceC: -300 },
      craters: { density: 0.02 }, clouds: { cover: 0.08, color: [0.96, 0.86, 0.7] }, relief: 3, radiusKm: 2575, tilt: 27,
      palette: { deep: [0.03, 0.03, 0.03], shallow: [0.06, 0.05, 0.04], low: [0.34, 0.26, 0.17], high: [0.5, 0.42, 0.3], rock: [0.42, 0.35, 0.26], dark: [0.2, 0.15, 0.1], bright: [0.62, 0.55, 0.42] },
      atmo: ATMO.titan },
    vary: F => ({ ocean: { level: F.u(0.04, 0.25) }, dunes: { amount: F.u(0.3, 1.1) }, terrain: { amp: F.u(0.5, 1) },
      radiusKm: F.u(1500, 3200), tilt: F.u(0, 35), atmo: { density: F.u(0.6, 1.4) } }) },
  { id: 'jupiter', name: 'Jupiter-like', kind: 'gas', seed: 1979, blurb: 'cream zones and brown belts, a great anticyclone, white ovals, polar cyclones; each seed redraws the bands and storms',
    p: {}, vary: F => gasVary(F, GAS_DEFAULT) },
  { id: 'saturn', name: 'Saturn-like', kind: 'gas', seed: 1610, blurb: 'soft butterscotch bands under haze, a polar hexagon and ringed shadow',
    p: { bands: { count: 18, contrast: 0.35, jitter: 0.25, equatorJet: 1, jetWidth: 0.3 }, turbulence: { amount: 0.3, advect: 0.35, streak: 9 },
      storms: { spot: 0, ovals: 2, ovalLat: 42, small: 10, polar: 2 }, haze: { amount: 0.6, polar: 0.6 }, clouds: { cover: 0.06 },
      tilt: 26.7, radiusKm: 58232, spin: 2.2,
      palette: { stops: [[0, [0.55, 0.44, 0.3]], [0.35, [0.74, 0.63, 0.45]], [0.65, [0.86, 0.78, 0.6]], [1, [0.94, 0.9, 0.78]]], spot: [0.9, 0.86, 0.76], polar: [0.42, 0.52, 0.6], oval: [0.96, 0.94, 0.88], barge: [0.5, 0.4, 0.3] },
      atmo: ATMO.saturn, rings: { on: 1, inner: 1.24, outer: 2.27, opacity: 0.92, color: [0.84, 0.78, 0.66] } },
    vary: F => ({ ...gasVary(F, PRESET_P('saturn')), rings: { inner: F.u(1.15, 1.4), outer: F.u(1.9, 2.6), opacity: F.u(0.6, 0.95) } }) },
  { id: 'neptune', name: 'Neptune-like', kind: 'gas', seed: 1846, blurb: 'an ice giant: a retrograde equator jet, a dark spot and bright methane cirrus',
    p: { bands: { count: 8, contrast: 0.3, jitter: 0.5, equatorJet: -1, jetWidth: 0.55 }, turbulence: { amount: 0.45, freq: 2.6, advect: 0.6, streak: 10 },
      storms: { spot: 1, spotLat: -20, spotLon: 0.6, spotSize: 0.1, ovals: 1, ovalLat: -55, small: 6, polar: 0 }, haze: { amount: 0.5, polar: 0.3 },
      clouds: { cover: 0.32 }, tilt: 28.3, radiusKm: 24622, spin: 2.0, bump: 4,
      palette: { stops: [[0, [0.12, 0.22, 0.5]], [0.4, [0.22, 0.38, 0.72]], [0.7, [0.3, 0.48, 0.8]], [1, [0.44, 0.6, 0.86]]], spot: [0.08, 0.13, 0.32], polar: [0.26, 0.4, 0.7], oval: [0.92, 0.95, 1], barge: [0.14, 0.24, 0.5] },
      atmo: ATMO.neptune },
    vary: F => gasVary(F, PRESET_P('neptune')) },
  { id: 'hotjupiter', name: 'Hot Jupiter', kind: 'gas', seed: 51, blurb: 'a tidally heated giant: dark absorbing clouds, thermal glow from the deep belts',
    p: { bands: { count: 10, contrast: 0.55, jitter: 0.45, equatorJet: 1.4, jetWidth: 0.4 }, turbulence: { amount: 0.8, advect: 0.8, streak: 5 },
      storms: { spot: 0, ovals: 0, small: 25, polar: 0 }, haze: { amount: 0.3, polar: 0.2 }, glow: 1, clouds: { cover: 0.1, color: [0.8, 0.6, 0.45] },
      tilt: 0, radiusKm: 95000, spin: 3,
      palette: { stops: [[0, [0.1, 0.05, 0.04]], [0.4, [0.25, 0.12, 0.08]], [0.75, [0.42, 0.26, 0.18]], [1, [0.58, 0.42, 0.3]]], spot: [0.5, 0.2, 0.1], polar: [0.15, 0.08, 0.06], oval: [0.7, 0.55, 0.45], barge: [0.08, 0.04, 0.03] },
      atmo: ATMO.hot },
    vary: F => ({ ...gasVary(F, PRESET_P('hotjupiter')), glow: F.u(0.6, 1.6) }) },
];

// Old preset ids and names (saved JSON files, links, saver logs).
export const ALIASES = { mars: 'rust', io: 'volcanic' };
const OLD_NAMES = { 'Mars-like': 'rust', 'Io-like': 'volcanic' };

// The p of a preset merged over the gas default (for gasVary).
function PRESET_P(id) { return merge(GAS_DEFAULT, PRESETS.find(p => p.id === id).p); }

// A giant's family: band count and contrast, jets, storm places and sizes,
// and a small hue shift of the palette.
function gasVary(F, G) {
  const t = F.f(0.1), m = c => c.map((v, i) => Math.min(1, v * t[i]));
  return {
    bands: { count: Math.max(4, Math.round(G.bands.count * F.u(0.7, 1.35))), contrast: G.bands.contrast * F.u(0.75, 1.3), jitter: F.u(0.2, 0.6), equatorJet: G.bands.equatorJet * F.u(0.7, 1.3), jetWidth: G.bands.jetWidth * F.u(0.8, 1.25) },
    turbulence: { amount: G.turbulence.amount * F.u(0.7, 1.3), freq: G.turbulence.freq * F.u(0.8, 1.25) },
    storms: { spotLat: F.u(-35, 35), spotLon: F.u(0, 1), spotSize: G.storms.spotSize * F.u(0.7, 1.4), ovals: Math.round(G.storms.ovals * F.u(0.5, 1.6)), ovalLat: F.u(-50, 50), small: Math.round(G.storms.small * F.u(0.5, 1.6)) },
    tilt: F.u(0, 35), spin: G.spin * F.u(0.8, 1.2),
    palette: { stops: G.palette.stops.map(([s, c]) => [s, m(c)]), spot: m(G.palette.spot), oval: G.palette.oval, polar: m(G.palette.polar), barge: m(G.palette.barge) },
  };
}

// The seeded dice of a family: u(a, b) uniform, i(a, b) integer in [a, b],
// pick(list), tint(rgb, s) each channel times 1 +- s (clamped to [0, 1]),
// f(s) three channel factors 1 +- s (a hue shift for a whole palette).
// The preset id is part of the seed, so two families with one seed differ.
function dice(seed, id) {
  let h = seed >>> 0;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 0x9E3779B1) >>> 0;
  let s = h;
  const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const F = {
    u: (a, b) => a + (b - a) * r(),
    i: (a, b) => a + Math.floor(r() * (b - a + 1)),
    pick: l => l[Math.floor(r() * l.length)],
    tint: (c, s) => c.map(v => Math.min(1, Math.max(0, v * (1 + s * (2 * r() - 1))))),
    f: s => [0, 1, 2].map(() => 1 + s * (2 * r() - 1)),
  };
  return F;
}

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
    ['Continents', 'terrain.terraces', 'mesa terraces', 0, 1, 0.01],
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
    ['Geology', 'features.basins', 'impact basins', 0, 6, 1],
    ['Geology', 'features.shields', 'volcanic shields', 0, 8, 1],
    ['Geology', 'features.canyon', 'rift canyon', 0, 1, 0.01],
    ['Geology', 'features.streaks', 'wind streaks', 0, 1, 0.01],
    ['Geology', 'features.provinces', 'dust provinces', 0, 1, 0.01],
    ['Geology', 'features.caps', 'layered polar caps', 0, 1, 0.01],
    ['Geology', 'features.layers', 'strata on risers', 0, 1, 0.01],
    ['Surface', 'volcanoes.count', 'volcanic calderas', 0, 200, 1],
    ['Surface', 'volcanoes.glow', 'vent glow', 0, 2, 0.01],
    ['Lava', 'lava.heat', 'tidal heating', 0, 1, 0.01],
    ['Lava', 'lava.age', 'crust age', 0, 1, 0.01],
    ['Lava', 'lava.sulfur', 'sulfur', 0, 1, 0.01],
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

export function presetById(id) { id = ALIASES[id] || id; return PRESETS.find(p => p.id === id) || PRESETS[0]; }
// One member of a family: the preset, then its seeded variation.
export function fromPreset(id, seed) {
  const pr = presetById(id);
  let P = merge(pr.kind === 'gas' ? GAS_DEFAULT : ROCKY_DEFAULT, pr.p);
  P.seed = seed != null ? seed >>> 0 : pr.seed;
  if (pr.vary) P = merge(P, pr.vary(dice(P.seed, pr.id)));
  P.name = pr.name; P.preset = pr.id;
  return normalize(P);
}

// Fill missing keys from the default and clamp every SCHEMA number.
export function normalize(P) {
  const kind = P && P.kind === 'gas' ? 'gas' : 'rocky';
  const out = merge(kind === 'gas' ? GAS_DEFAULT : ROCKY_DEFAULT, P || {});
  out.kind = kind;
  out.seed = (Number(out.seed) >>> 0) || 0;
  // old preset ids and names map to the families that replaced them
  if (ALIASES[out.preset]) out.preset = ALIASES[out.preset];
  if (OLD_NAMES[out.name]) out.name = presetById(OLD_NAMES[out.name]).name;
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

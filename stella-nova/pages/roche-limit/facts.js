// ============================================================================
//  ROCHE LIMIT  ·  facts.js — the real bodies of the random runs (no DOM)
// ----------------------------------------------------------------------------
//  roll.js reads these values to build a run. Each entry gives its source.
//  physics.js BODIES keeps the bodies of the first scenarios; this module
//  adds the primaries and the small bodies of the random runs.
//
//  PRIMARIES  the body that the moon falls toward. R: equatorial radius in
//             km. rho: bulk density in g/cm^3. J2 and flattening for the
//             planets. style: the look in shaders/planet.wgsl (0 ice giant,
//             1 Saturn, 2 Jupiter, 3 Mars, 4 Earth, 5 Saturn map,
//             6 Uranus, 7 hot Jupiter, 8 brown dwarf, 9 white dwarf,
//             10 neutron star). compact: no surface to graze in view.
//  SMALL      the kinds of small body: a density range in g/cm^3 and a
//             named example with its measured density.
//
//  Densities of the stars and the brown dwarf come from a mass and a
//  radius: rho = M / (4/3 pi R^3), with the IAU nominal solar values and
//  the NASA value of Jupiter's mass and radius.
//
//  grep -n targets: "export const PRIMARIES", "export const SMALL",
//  "function rhoOf", "export const SOURCES"
// ============================================================================

const M_SUN_G = 1.98847e33;      // g (IAU 2015 nominal G M_sun / G)
const R_SUN_KM = 695700;         // km (IAU 2015 nominal)
const M_JUP_G = 1.89813e30;      // g (NASA Jupiter fact sheet)
const R_JUP_KM = 71492;          // km, equatorial (NASA Jupiter fact sheet)

// Bulk density in g/cm^3 of a mass in g and a radius in km.
export function rhoOf(Mg, Rkm) { const R = Rkm * 1e5; return Mg / (4 / 3 * Math.PI * R * R * R); }

export const PRIMARIES = {
  saturn:  { name: 'Saturn',  R: 60268, rho: 0.687, J2: 1.6298e-2, flattening: 0.098, style: 5, rings: true, src: 'NASA Saturn fact sheet' },
  jupiter: { name: 'Jupiter', R: 71492, rho: 1.326, J2: 1.4736e-2, flattening: 0.065, style: 2, src: 'NASA Jupiter fact sheet' },
  uranus:  { name: 'Uranus',  R: 25559, rho: 1.270, J2: 3.3434e-3, flattening: 0.023, style: 6, src: 'NASA Uranus fact sheet' },
  neptune: { name: 'Neptune', R: 24764, rho: 1.638, J2: 3.411e-3,  flattening: 0.017, style: 0, src: 'NASA Neptune fact sheet' },
  earth:   { name: 'Earth',   R: 6378.137, rho: 5.513, J2: 1.0826e-3, flattening: 0.0034, style: 4, src: 'NASA Earth fact sheet' },
  mars:    { name: 'Mars',    R: 3396.2, rho: 3.9335, J2: 1.9605e-3, flattening: 0.0059, style: 3, src: 'NASA Mars fact sheet' },
  // WASP-12b: 1.47 M_J, 1.90 R_J (Collins, Kielkopf and Stassun 2017, AJ 153, 78)
  hotjup:  { name: 'the hot Jupiter WASP-12b', short: 'WASP-12b', R: 1.90 * R_JUP_KM, rho: rhoOf(1.47 * M_JUP_G, 1.90 * R_JUP_KM), J2: 0, flattening: 0.02, style: 7, src: 'Collins et al. 2017 (1.47 M_J, 1.90 R_J)' },
  // an old brown dwarf of 60 M_J: models give 0.8 to 1 R_J (Burrows et al.
  // 2001, Rev. Mod. Phys. 73, 719); 0.8 R_J here
  bdwarf:  { name: 'a brown dwarf', short: 'brown dwarf', R: 0.8 * R_JUP_KM, rho: rhoOf(60 * M_JUP_G, 0.8 * R_JUP_KM), J2: 0, flattening: 0, style: 8, src: 'typical old brown dwarf: 60 M_J, 0.8 R_J (Burrows et al. 2001 models)' },
  // Sirius B: 1.018 M_sun, 0.00864 R_sun (Bond et al. 2017, ApJ 840, 70)
  wdwarf:  { name: 'a white dwarf', short: 'white dwarf', R: 0.00864 * R_SUN_KM, rho: rhoOf(1.018 * M_SUN_G, 0.00864 * R_SUN_KM), J2: 0, flattening: 0, style: 9, compact: true, src: 'Sirius B: 1.018 M_sun, 0.00864 R_sun (Bond et al. 2017)' },
  // PSR J0030+0451: 1.44 M_sun, 13.02 km (Miller et al. 2019, ApJL 887, L24)
  nstar:   { name: 'a neutron star', short: 'neutron star', R: 13.02, rho: rhoOf(1.44 * M_SUN_G, 13.02), J2: 0, flattening: 0, style: 10, compact: true, src: 'PSR J0030+0451: 1.44 M_sun, 13.02 km (Miller et al. 2019)' },
};
export const PRIMARY_KEYS = Object.keys(PRIMARIES);

// The kinds of small body. rho: [low, high] in g/cm^3 for a random run;
// ex: a measured example. layout: the start shape (initial.js).
export const SMALL = {
  icy:     { name: 'icy rubble moon', noun: 'An icy moon', rho: [0.6, 1.2], layout: 'single', tint: 'ice', ex: 'water ice 0.92 g/cm³; Saturn’s Pan 0.42' },
  rocky:   { name: 'rocky rubble pile', noun: 'A rocky rubble pile', rho: [1.2, 2.6], layout: 'single', tint: 'rock', ex: 'Itokawa 1.90 g/cm³ (Fujiwara et al. 2006); Bennu 1.19 (Lauretta et al. 2019)' },
  fluid:   { name: 'fluid moon', noun: 'A molten moon', rho: [1.5, 3.4], layout: 'single', tint: 'melt', material: 'fluid', ex: 'the Moon 3.34 g/cm³ (NASA)' },
  comet:   { name: 'comet nucleus', noun: 'A comet nucleus', rho: [0.4, 0.6], layout: 'single', tint: 'comet', ex: '67P/Churyumov-Gerasimenko 0.533 g/cm³ (Pätzold et al. 2016)' },
  contact: { name: 'contact binary', noun: 'A contact binary', rho: [0.5, 2.0], layout: 'contact', tint: 'comet', ex: '67P is two lobes on a neck, 0.533 g/cm³' },
  binary:  { name: 'binary asteroid', noun: 'A binary asteroid', rho: [1.5, 2.6], layout: 'binary', tint: 'rock', ex: 'Didymos and Dimorphos, about 2.4 g/cm³ (Daly et al. 2023)' },
  core:    { name: 'moon with a dense core', noun: 'A moon with a rocky core', rho: [1.2, 2.2], layout: 'core', tint: 'ice', ex: 'Ganymede 1.94 g/cm³: ice over rock (NASA)' },
  train:   { name: 'train of fragments', noun: 'A train of comet fragments', rho: [0.4, 0.7], layout: 'train', tint: 'comet', ex: 'Shoemaker-Levy 9: some 21 fragments, about 0.5 g/cm³ (Asphaug and Benz 1996)' },
  two:     { name: 'two moons', noun: 'Two moons', rho: [0.8, 2.0], layout: 'two', tint: 'ice', ex: 'Phobos 1.88 and Deimos 1.47 g/cm³ (NASA)' },
};
export const SMALL_KEYS = Object.keys(SMALL);

// Named small bodies of the presets (NASA fact sheets unless named).
export const NAMED = {
  triton: { name: 'Triton', R: 1353.4, rho: 2.061, src: 'NASA Neptunian satellite fact sheet' },
  phobos: { name: 'Phobos', R: 11.08, rho: 1.876, src: 'NASA Martian satellite fact sheet' },
  moon:   { name: 'the Moon', R: 1737.4, rho: 3.344, src: 'NASA Moon fact sheet' },
  sl9:    { name: 'Shoemaker-Levy 9', rho: 0.5, src: 'Asphaug and Benz 1996, Icarus 121, 225' },
  p67:    { name: '67P', rho: 0.533, src: 'Pätzold et al. 2016, Nature 530, 63' },
  itokawa: { name: 'Itokawa', rho: 1.90, src: 'Fujiwara et al. 2006, Science 312, 1330' },
};

export const SOURCES = [
  'Planets: NASA planetary fact sheets (radius, density, J2).',
  'WASP-12b: Collins, Kielkopf and Stassun 2017, AJ 153, 78.',
  'Sirius B: Bond et al. 2017, ApJ 840, 70.',
  'PSR J0030+0451: Miller et al. 2019, ApJL 887, L24.',
  'Brown dwarf radii: Burrows et al. 2001, Rev. Mod. Phys. 73, 719.',
  'Small bodies: Pätzold et al. 2016 (67P), Fujiwara et al. 2006 (Itokawa), Lauretta et al. 2019 (Bennu), Asphaug and Benz 1996 (SL9).',
];

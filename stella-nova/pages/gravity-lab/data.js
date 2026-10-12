// ============================================================================
//  GRAVITY LAB  ·  data.js — real body data, constants and their sources
// ----------------------------------------------------------------------------
//  No DOM and no GPU. experiments.js builds every initial condition from
//  these numbers; the page shows them on the plates. SI units in this file
//  (kg, m, s). A value marked "approx" is rounded from the source.
//
//  SOURCES (key -> reference). Every body and constant names one key.
//    codata   CODATA 2018, G = 6.67430e-11 m^3 kg^-1 s^-2
//    iau      IAU 2012 Resolution B2 (astronomical unit) and IAU 2015
//             Resolution B3 (nominal solar values)
//    nssdc    NASA Planetary Fact Sheet (D. Williams, NSSDCA, 2024)
//    jplsat   JPL Solar System Dynamics, planetary satellite physical
//             parameters and mean orbital elements (2024)
//    agol21   Agol et al. 2021, Planet. Sci. J. 2, 1 (TRAPPIST-1)
//    doyle11  Doyle et al. 2011, Science 333, 1602 (Kepler-16)
//    grav22   GRAVITY Collaboration 2022, A&A 657, L12 (Sgr A*, S2)
//    ab96     Asphaug & Benz 1996, Icarus 121, 225 (Shoemaker-Levy 9)
//    sp67     Szebehely & Peters 1967, AJ 72, 876 (Pythagorean problem)
//    cm00     Chenciner & Montgomery 2000, Ann. Math. 152, 881; initial
//             values of Simo 2002 (figure-eight)
//    tt72     Toomre & Toomre 1972, ApJ 178, 623 (tidal tails)
//    hw99     Holman & Wiegert 1999, AJ 117, 621 (circumbinary stability)
//    kozai62  Kozai 1962, AJ 67, 591; Lidov 1962, Planet. Space Sci. 9, 719
//    ah06     Agnor & Hamilton 2006, Nature 441, 192 (Triton capture)
//    routh    Routh 1875 (stability of L4 and L5: mu < 0.0385)
//    roche    Roche 1849; Chandrasekhar 1969 (fluid limit 2.44 to 2.46)
//    toomre64 Toomre 1964, ApJ 139, 1217 (disk stability, Q)
//    sd13     Suvakov & Dmitrasinovic 2013, PRL 110, 114301 (three-body
//             choreographies: butterfly, moth, yin-yang, goggles)
//    sitnikov Sitnikov 1960; Moser 1973 (the Sitnikov problem)
//    rees88   Rees 1988, Nature 333, 523 (tidal disruption radius)
//    gillessen Gillessen et al. 2017, ApJ 837, 30 (S-star orbits)
//    vallado  Vallado, Fundamentals of Astrodynamics, 4th ed. (Hohmann,
//             bi-elliptic transfers)
//
//  grep -n targets: "export const C", "export const BODY", "export const
//  TRAPPIST1", "export const KEPLER16", "export const SGRA", "export const
//  SL9", "export function unitsOf", "export const SOURCES"
// ============================================================================

export const SOURCES = {
  codata: 'CODATA 2018 recommended values',
  iau: 'IAU 2012 Res. B2; IAU 2015 Res. B3',
  nssdc: 'NASA Planetary Fact Sheet (NSSDCA, 2024)',
  jplsat: 'JPL SSD planetary satellite parameters (2024)',
  agol21: 'Agol et al. 2021, PSJ 2, 1',
  doyle11: 'Doyle et al. 2011, Science 333, 1602',
  grav22: 'GRAVITY Collab. 2022, A&A 657, L12',
  ab96: 'Asphaug & Benz 1996, Icarus 121, 225',
  sp67: 'Szebehely & Peters 1967, AJ 72, 876',
  cm00: 'Chenciner & Montgomery 2000; Simó 2002',
  tt72: 'Toomre & Toomre 1972, ApJ 178, 623',
  hw99: 'Holman & Wiegert 1999, AJ 117, 621',
  kozai62: 'Kozai 1962, AJ 67, 591; Lidov 1962',
  ah06: 'Agnor & Hamilton 2006, Nature 441, 192',
  routh: 'Routh 1875',
  roche: 'Roche 1849; Chandrasekhar 1969',
  toomre64: 'Toomre 1964, ApJ 139, 1217',
  sd13: 'Šuvakov & Dmitrašinović 2013, PRL 110, 114301',
  sitnikov: 'Sitnikov 1960; Moser 1973',
  rees88: 'Rees 1988, Nature 333, 523',
  gillessen: 'Gillessen et al. 2017, ApJ 837, 30',
  vallado: 'Vallado, Fundamentals of Astrodynamics, 4th ed.',
};

// Physical constants (SI)
export const C = {
  G: 6.67430e-11,          // codata
  AU: 1.495978707e11,      // iau (exact)
  MSUN: 1.98847e30,        // iau: GM_sun / G
  RSUN: 6.957e8,           // iau nominal
  MEARTH: 5.9722e24,       // nssdc
  REARTH: 6.371e6,         // nssdc mean
  MJUP: 1.89813e27,        // nssdc
  RJUP: 6.9911e7,          // nssdc mean
  DAY: 86400,
  YEAR: 3.15576e7,         // Julian year
  PC: 3.0856775814913673e16,
  KMS: 1e3,
};

// Bodies of the Solar System. m kg, R m (mean), a m (semi-major axis about
// the parent), e, i deg (to the ecliptic, or to the parent's equator for a
// moon), P s (sidereal period), rho kg/m^3.
const km = 1e3;
export const BODY = {
  sun:        { m: C.MSUN, R: C.RSUN, rho: 1408, src: 'iau' },
  mercury:    { m: 3.3010e23, R: 2439.7 * km, a: 57.909e9, e: 0.2056, i: 7.00, rho: 5429, src: 'nssdc' },
  venus:      { m: 4.8673e24, R: 6051.8 * km, a: 108.210e9, e: 0.0068, i: 3.39, rho: 5243, src: 'nssdc' },
  earth:      { m: C.MEARTH, R: C.REARTH, a: 149.598e9, e: 0.0167, i: 0, rho: 5513, src: 'nssdc' },
  moon:       { m: 7.346e22, R: 1737.4 * km, a: 384.4e6, e: 0.0549, i: 5.1, rho: 3344, src: 'nssdc' },
  mars:       { m: 6.4169e23, R: 3389.5 * km, a: 227.956e9, e: 0.0935, i: 1.85, rho: 3934, src: 'nssdc' },
  jupiter:    { m: C.MJUP, R: C.RJUP, a: 778.479e9, e: 0.0487, i: 1.30, rho: 1326, src: 'nssdc' },
  saturn:     { m: 5.6832e26, R: 58232 * km, a: 1432.041e9, e: 0.0520, i: 2.49, rho: 687, src: 'nssdc' },
  uranus:     { m: 8.6811e25, R: 25362 * km, a: 2867.043e9, e: 0.0469, i: 0.77, rho: 1270, src: 'nssdc' },
  neptune:    { m: 1.02409e26, R: 24622 * km, a: 4514.953e9, e: 0.0097, i: 1.77, rho: 1638, src: 'nssdc' },
  // moons (jplsat; masses approx from GM / G)
  io:         { m: 8.932e22, R: 1821.6 * km, a: 421.8e6, P: 1.769138 * C.DAY, rho: 3528, src: 'jplsat' },
  europa:     { m: 4.800e22, R: 1560.8 * km, a: 671.1e6, P: 3.551181 * C.DAY, rho: 3013, src: 'jplsat' },
  ganymede:   { m: 1.4819e23, R: 2631.2 * km, a: 1070.4e6, P: 7.154553 * C.DAY, rho: 1942, src: 'jplsat' },
  janus:      { m: 1.898e18, R: 89.2 * km, a: 151.46e6, rho: 630, src: 'jplsat' },
  epimetheus: { m: 5.266e17, R: 58.2 * km, a: 151.41e6, rho: 640, src: 'jplsat' },
  prometheus: { m: 1.595e17, R: 43.1 * km, a: 139.38e6, rho: 480, src: 'jplsat' },
  pandora:    { m: 1.371e17, R: 40.7 * km, a: 141.72e6, rho: 490, src: 'jplsat' },
  pan:        { m: 4.95e15, R: 14.1 * km, a: 133.584e6, rho: 420, src: 'jplsat' },
  callisto:   { m: 1.0759e23, R: 2410.3 * km, a: 1882.7e6, P: 16.689018 * C.DAY, rho: 1834, src: 'jplsat' },
  pluto:      { m: 1.303e22, R: 1188.3 * km, a: 5906.38e9, e: 0.2488, i: 17.16, rho: 1854, src: 'nssdc' },
  charon:     { m: 1.586e21, R: 606 * km, a: 19.596e6, rho: 1702, src: 'jplsat' },
  phobos:     { m: 1.0659e16, R: 11.08 * km, a: 9.376e6, rho: 1876, src: 'jplsat' },
  triton:     { m: 2.139e22, R: 1353.4 * km, a: 354.759e6, i: 156.9, rho: 2061, src: 'jplsat' },
};
// Saturn's rings (nssdc Saturnian rings fact sheet), m from Saturn's centre
export const SATURN_RINGS = { B: [92.0e6, 117.58e6], A: [122.17e6, 136.775e6], F: 140.22e6, enckeGap: 133.59e6, enckeWidth: 325e3, src: 'nssdc' };

// TRAPPIST-1 (agol21): star mass, radius; planets P d, m Earth masses,
// R Earth radii. The seven periods form a chain of near-resonances:
// 8:5, 5:3, 3:2, 3:2, 4:3, 3:2.
export const TRAPPIST1 = {
  Mstar: 0.0898 * C.MSUN, Rstar: 0.1192 * C.RSUN, src: 'agol21',
  planets: [
    { name: 'b', P: 1.510826, m: 1.374, R: 1.116 },
    { name: 'c', P: 2.421937, m: 1.308, R: 1.097 },
    { name: 'd', P: 4.049219, m: 0.388, R: 0.788 },
    { name: 'e', P: 6.101013, m: 0.692, R: 0.920 },
    { name: 'f', P: 9.207540, m: 1.039, R: 1.045 },
    { name: 'g', P: 12.352446, m: 1.321, R: 1.129 },
    { name: 'h', P: 18.772866, m: 0.326, R: 0.755 },
  ],
  ratios: ['8:5', '5:3', '3:2', '3:2', '4:3', '3:2'],
};

// Kepler-16 (doyle11): the first transiting circumbinary planet.
export const KEPLER16 = {
  MA: 0.6897 * C.MSUN, MB: 0.20255 * C.MSUN, RA: 0.6489 * C.RSUN, RB: 0.22623 * C.RSUN,
  Pbin: 41.079220 * C.DAY, abin: 0.22431 * C.AU, ebin: 0.15944,
  planet: { m: 0.333 * C.MJUP, R: 0.7538 * C.RJUP, P: 228.776 * C.DAY, a: 0.7048 * C.AU, e: 0.0069 },
  src: 'doyle11',
};

// Sgr A* and the star S2 (grav22).
export const SGRA = {
  M: 4.297e6 * C.MSUN, R0: 8277 * C.PC, src: 'grav22',
  S2: { aArcsec: 0.125058, e: 0.884649, P: 16.0455 * C.YEAR, i: 134.70, mStar: 13.6 * C.MSUN },
};
// semi-major axis of S2 in m (small angle: a = theta R0)
SGRA.S2.a = SGRA.S2.aArcsec / 206264.806 * SGRA.R0;
// S2 orientation (grav22, approx): Omega 228.2 deg, omega 66.3 deg
SGRA.S2.O = 228.2; SGRA.S2.w = 66.3;
// Schwarzschild radius 2 G M / c^2 (m)
export const C_LIGHT = 299792458;
SGRA.rs = 2 * C.G * SGRA.M / C_LIGHT ** 2;

// Shoemaker-Levy 9 (ab96): perijove of 7 July 1992 about 1.33 R_J from
// Jupiter's centre; nucleus about 1.5 km in diameter, density near 600.
export const SL9 = { q: 1.33 * C.RJUP, Rnuc: 0.75e3, rho: 600, fragments: 21, src: 'ab96' };

// Fluid Roche limit coefficient (roche)
export const ROCHE_FLUID = 2.44;
// Routh's critical mass ratio for stable L4 and L5 (routh)
export const ROUTH_MU = 0.03852;

// A unit system with G = 1. L metres, M kilograms. T follows:
// T = sqrt(L^3 / (G M)). The page converts sim numbers to real ones with it.
export function unitsOf(L, M, names = {}) {
  const T = Math.sqrt(L ** 3 / (C.G * M));
  return { L, M, T, V: L / T, nameL: names.L || 'L', nameM: names.M || 'M', nameT: names.T || 'T' };
}
// Common unit systems
export const UNITS = {
  solar: () => unitsOf(C.AU, C.MSUN, { L: 'AU', M: 'M☉', T: 'yr/2π' }),
  earthMoon: () => unitsOf(BODY.moon.a, BODY.earth.m + BODY.moon.m, { L: 'Earth-Moon distance', M: 'M⊕+M☾', T: 'T' }),
};

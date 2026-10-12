// ============================================================================
//  PLANET COLLISION  ·  data.js — units, materials and bodies, with sources
// ----------------------------------------------------------------------------
//  No DOM and no GPU. The solver (sph.js, engine.js) works in code units
//  with G = 1: length in Earth radii, mass in Earth masses. UNIT gives the
//  SI value of one code unit of each quantity, so the page can show real
//  numbers (km, km/s, GPa, K, hours).
//
//  MATERIALS holds the Tillotson equation of state parameters in SI, from
//  the published tables (sources in each row). eos.js converts them with
//  matCode(). Each row also has a heat capacity c_v and a melt temperature
//  at 1 bar. Tillotson has no temperature: the page shows an estimate,
//  T = T0 + (u - u_cold) / c_v (eos.js "function temperature").
//
//  BODIES holds real masses, mean radii and bulk densities, and a layer
//  model (core, mantle, ice shell as mass fractions) for each body. The
//  layer fractions are estimates from the cited papers, rounded.
//
//  grep -n targets: "export const UNIT", "export const MATERIALS",
//  "export const BODIES", "export const SOURCES", "export function code"
// ============================================================================

const G_SI = 6.6743e-11;                 // CODATA 2018
const L = 6.371e6, M = 5.9722e24;        // Earth mean radius (m), Earth mass (kg)
const T = Math.sqrt(L ** 3 / (G_SI * M)); // 805.5 s
export const UNIT = {
  G: G_SI, L, M, T,
  V: L / T,                              // 7.91 km/s
  RHO: M / L ** 3,                       // 23.1 g/cm^3
  E: (L / T) ** 2,                       // specific energy, 6.26e7 J/kg
  P: (M / L ** 3) * (L / T) ** 2,        // 1.44e12 Pa
};
// SI <-> code helpers
export const code = {
  len: m => m / UNIT.L, mass: kg => kg / UNIT.M, time: s => s / UNIT.T, vel: ms => ms / UNIT.V,
  rho: r => r / UNIT.RHO, pres: p => p / UNIT.P, spec: e => e / UNIT.E,
};
export const si = {
  len: x => x * UNIT.L, mass: x => x * UNIT.M, time: x => x * UNIT.T, vel: x => x * UNIT.V,
  rho: x => x * UNIT.RHO, pres: x => x * UNIT.P, spec: x => x * UNIT.E,
};

// Tillotson parameters (SI). rho0 kg/m^3, A B Pa, E0 Eiv Ecv J/kg, a b
// alpha beta dimensionless. cv J/(kg K), Tmelt K at 1 bar.
// id is the material index in the GPU meta word (bits 0-3).
export const MATERIALS = {
  iron: {
    id: 0, name: 'Iron', rho0: 7800, A: 1.28e11, B: 1.05e11, E0: 9.5e6, Eiv: 2.4e6, Ecv: 8.67e6,
    a: 0.5, b: 1.5, alpha: 5, beta: 5, cv: 449, Tmelt: 1811,
    src: 'Tillotson (1962); Melosh (1989) Impact Cratering, table AII.3',
  },
  granite: {
    id: 1, name: 'Granite', rho0: 2680, A: 1.8e10, B: 1.8e10, E0: 1.6e7, Eiv: 3.5e6, Ecv: 1.8e7,
    a: 0.5, b: 1.3, alpha: 5, beta: 5, cv: 790, Tmelt: 1500,
    src: 'Benz & Asphaug (1999) Icarus 142, 5, table II; Melosh (1989)',
  },
  basalt: {
    id: 2, name: 'Basalt', rho0: 2700, A: 2.67e10, B: 2.67e10, E0: 4.87e8, Eiv: 4.72e6, Ecv: 1.82e7,
    a: 0.5, b: 1.5, alpha: 5, beta: 5, cv: 840, Tmelt: 1400,
    src: 'Benz & Asphaug (1999) Icarus 142, 5, table II',
  },
  ice: {
    id: 3, name: 'Water ice', rho0: 917, A: 9.47e9, B: 9.47e9, E0: 1.0e7, Eiv: 7.73e5, Ecv: 3.04e6,
    a: 0.3, b: 0.1, alpha: 10, beta: 5, cv: 2090, Tmelt: 273,
    src: 'Benz & Asphaug (1999) Icarus 142, 5, table II',
  },
};
export const MAT_LIST = Object.values(MATERIALS).sort((p, q) => p.id - q.id);

// Bodies. mass kg, radius m (mean), rho kg/m^3 (bulk), layers from the
// centre out: [material, mass fraction]. dayH: sidereal rotation period
// in hours (negative: retrograde), for the optional spin.
export const BODIES = {
  earth: {
    name: 'Earth', mass: 5.9722e24, radius: 6.3710e6, rho: 5513, dayH: 23.934,
    layers: [['iron', 0.325], ['granite', 0.675]],
    src: 'NASA Earth fact sheet (Williams 2024); core mass 1.94e24 kg, PREM (Dziewonski & Anderson 1981)',
  },
  protoEarth: {
    name: 'Proto-Earth', mass: 0.90 * 5.9722e24, radius: null, rho: null, dayH: null,
    layers: [['iron', 0.30], ['granite', 0.70]],
    src: 'Canup (2004) Icarus 168, 433: target of the late Moon-forming impact, M_T + M_I = 1.02 M_E',
  },
  theia: {
    name: 'Theia', mass: 0.12 * 5.9722e24, radius: null, rho: null, dayH: null,
    layers: [['iron', 0.30], ['granite', 0.70]],
    src: 'Canup (2004) Icarus 168, 433: impactor-to-total mass ratio 0.11-0.14; a model body, not observed',
  },
  moon: {
    name: 'Moon', mass: 7.346e22, radius: 1.7374e6, rho: 3344, dayH: 655.72,
    layers: [['iron', 0.015], ['granite', 0.985]],
    src: 'NASA Moon fact sheet; core radius about 330 km, Weber et al. (2011) Science 331, 309',
  },
  mars: {
    name: 'Mars', mass: 6.4171e23, radius: 3.3895e6, rho: 3933, dayH: 24.623,
    layers: [['iron', 0.24], ['granite', 0.76]],
    src: 'NASA Mars fact sheet; core radius 1830 km, Stähler et al. (2021) Science 373, 443',
  },
  venus: {
    name: 'Venus', mass: 4.8673e24, radius: 6.0518e6, rho: 5243, dayH: -5832.6,
    layers: [['iron', 0.30], ['granite', 0.70]],
    src: 'NASA Venus fact sheet; core fraction assumed Earth-like (no seismic data)',
  },
  mercury: {
    name: 'Mercury', mass: 3.3010e23, radius: 2.4397e6, rho: 5429, dayH: 1407.6,
    layers: [['iron', 0.70], ['granite', 0.30]],
    src: 'NASA Mercury fact sheet; core radius 2020 km, Hauck et al. (2013) JGR Planets 118, 1204',
  },
  ceres: {
    name: 'Ceres', mass: 9.3835e20, radius: 4.697e5, rho: 2162, dayH: 9.074,
    layers: [['basalt', 0.75], ['ice', 0.25]],
    src: 'Park et al. (2016) Nature 537, 515 (GM 62.63 km^3/s^2, mean radius 469.7 km); ice-rich shell fraction rounded',
  },
  pluto: {
    name: 'Pluto', mass: 1.303e22, radius: 1.1883e6, rho: 1854, dayH: -153.29,
    layers: [['basalt', 0.66], ['ice', 0.34]],
    src: 'Stern et al. (2015) Science 350, aad1815; radius 1188.3 km, Nimmo et al. (2017) Icarus 287, 12; rock fraction about 2/3',
  },
  charon: {
    name: 'Charon', mass: 1.586e21, radius: 6.060e5, rho: 1702, dayH: 153.29,
    layers: [['basalt', 0.60], ['ice', 0.40]],
    src: 'Stern et al. (2015) Science 350, aad1815; Nimmo et al. (2017) Icarus 287, 12',
  },
  vesta: {
    name: 'Vesta', mass: 2.59076e20, radius: 2.627e5, rho: 3456, dayH: 5.342,
    layers: [['iron', 0.18], ['basalt', 0.82]],
    src: 'Russell et al. (2012) Science 336, 684 (mass, core radius 107-113 km); core fraction rounded',
  },
};

export const SOURCES = [
  'J. H. Tillotson (1962) Metallic equations of state for hypervelocity impact. General Atomic report GA-3216.',
  'H. J. Melosh (1989) Impact Cratering: A Geologic Process. Oxford University Press. Appendix II.',
  'W. Benz and E. Asphaug (1999) Catastrophic disruptions revisited. Icarus 142, 5-20.',
  'R. M. Canup (2004) Simulations of a late lunar-forming impact. Icarus 168, 433-456.',
  'J. J. Monaghan (1992) Smoothed particle hydrodynamics. ARA&A 30, 543-574 (artificial viscosity).',
  'D. S. Balsara (1995) von Neumann stability analysis of SPH. J. Comput. Phys. 121, 357 (shear switch).',
  'W. Dehnen and H. Aly (2012) Improving convergence in SPH simulations without pairing instability. MNRAS 425, 1068 (Wendland C2 kernel).',
  'NASA Planetary Fact Sheets, D. R. Williams, NSSDCA (masses, radii, densities, rotation).',
];

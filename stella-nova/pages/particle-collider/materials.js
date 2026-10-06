// ============================================================================
//  PARTICLE COLLIDER  ·  materials.js — detector media and their constants
// ----------------------------------------------------------------------------
//  No DOM, no THREE. The transport engine (transport.js), the physics tables
//  (physics.js) and tests.mjs read this module.
//
//  DATA SOURCE
//    Density, mean excitation energy I, Z/A, the Sternheimer density-effect
//    parameters, nuclear interaction lengths and critical energies are the
//    values of the PDG "Atomic and Nuclear Properties of Materials" tables.
//    Where a compound has no tabulated Sternheimer set here (PbWO4, brass),
//    the set comes from the Sternheimer-Peierls rules (function spRules).
//    The radiation length X0 is not copied: function tsaiX0 computes it from
//    the Tsai formula (PDG review "Passage of particles through matter",
//    eq. 34.25), and tests.mjs compares it with the PDG table value.
//
//  UNITS  mm, MeV, ns, g/cm3. A material record carries both g/cm2 and mm.
//
//  RECORD FIELDS (grep -n 'function mat')
//    key name rho ZA I(MeV) elems[[Z,A,w]] X0g X0(mm) lamI(mm) Ec RM(mm)
//    dens{C,x0,x1,a,k,d0} n(refractive index, 0 = opaque) scint(photons/MeV)
//    birks(mm/MeV) z4a(sum w Z^4/A, photoelectric) zmax(heaviest Z)
//    pdgX0 (the PDG X0 in g/cm2, for the test only)
//
//  EXPORTS
//    MAT ........... the materials by key
//    tsaiX0(Z, A) .. radiation length of an element, g/cm2
//    delta(mat, x) . density-effect correction at x = log10(beta gamma)
//    NA ME K_BB ALPHA RE ES  physical constants (PDG 2024)
// ============================================================================
export const NA = 6.02214076e23;
export const ME = 0.51099895;        // electron mass, MeV
export const K_BB = 0.307075;        // 4 pi N_A r_e^2 m_e c^2, MeV cm2/mol
export const ALPHA = 1 / 137.035999;
export const RE = 2.8179403262e-13;  // classical electron radius, cm
export const ES = 21.2052;           // multiple-scattering scale energy, MeV
const LN10 = Math.LN10;

// Element data: Z, A (g/mol), I (eV), lambda_I (g/cm2, PDG), Ec of the element (MeV)
const EL = {
  H: [1, 1.008, 19.2, 52.0], C: [6, 12.011, 78.0, 85.8], N: [7, 14.007, 82.0, 89.7],
  O: [8, 15.999, 95.0, 90.1], Ar: [18, 39.948, 188.0, 119.7], Be: [4, 9.0122, 63.7, 77.8],
  Al: [13, 26.9815, 166.0, 107.2], Si: [14, 28.0855, 173.0, 108.4], Fe: [26, 55.845, 286.0, 132.1],
  Cu: [29, 63.546, 322.0, 137.3], Zn: [30, 65.38, 330.0, 138.0], W: [74, 183.84, 727.0, 191.9],
  Pb: [82, 207.2, 823.0, 199.6],
};

// Radiation length of one element (Tsai). Light elements use the Tsai
// table values of L_rad and L'_rad; Z > 4 uses the logarithm forms.
export function tsaiX0(Z, A) {
  const a = ALPHA * Z, a2 = a * a;
  const f = a2 * (1 / (1 + a2) + 0.20206 - 0.0369 * a2 + 0.0083 * a2 * a2 - 0.002 * a2 * a2 * a2);
  const LT = { 1: [5.31, 6.144], 2: [4.79, 5.621], 3: [4.74, 5.805], 4: [4.71, 5.924] };
  const [L, Lp] = LT[Z] || [Math.log(184.15 * Math.pow(Z, -1 / 3)), Math.log(1194 * Math.pow(Z, -2 / 3))];
  return 716.408 * A / (Z * Z * (L - f) + Z * Lp);
}

// Sternheimer-Peierls rules for a solid or liquid with no tabulated set
function spRules(I_eV, rho, ZA) {
  const hwp = 28.816 * Math.sqrt(rho * ZA);           // plasma energy, eV
  const C = 2 * Math.log(I_eV / hwp) + 1;
  let x0, x1;
  if (I_eV < 100) { x1 = 2; x0 = C < 3.681 ? 0.2 : 0.326 * C - 1.0; }
  else { x1 = 3; x0 = C < 5.215 ? 0.2 : 0.326 * C - 1.5; }
  const k = 3, a = (C - 4.606 * x0) / Math.pow(x1 - x0, k);
  return { C, x0, x1, a, k, d0: 0 };
}

// density-effect correction delta(x), x = log10(beta gamma)
export function delta(m, x) {
  const d = m.dens;
  if (x >= d.x1) return 2 * LN10 * x - d.C;
  if (x >= d.x0) return 2 * LN10 * x - d.C + d.a * Math.pow(d.x1 - x, d.k);
  return d.d0 ? d.d0 * Math.pow(10, 2 * (x - d.x0)) : 0;
}

function mat(key, o) {
  const elems = o.elems.map(([s, w]) => [EL[s][0], EL[s][1], w, s]);
  const ZA = o.ZA ?? elems.reduce((s, [Z, A, w]) => s + w * Z / A, 0);
  const X0g = 1 / elems.reduce((s, [Z, A, w]) => s + w / tsaiX0(Z, A), 0);
  const lamIg = o.lamIg ?? 1 / elems.reduce((s, e) => s + e[2] / EL[e[3]][3], 0);
  // I: tabulated, or Bragg additivity in ln I weighted by electrons
  const I_eV = o.I ?? Math.exp(elems.reduce((s, [Z, A, w, sy]) => s + w * Z / A * Math.log(EL[sy][2]), 0) / ZA);
  const zEff = elems.reduce((s, [Z, , w]) => s + w * Z, 0);
  const Ec = o.Ec ?? 610 / (zEff + 1.24);
  const X0 = X0g / o.rho * 10, RM = X0 * ES / Ec;
  return {
    key, name: o.name, rho: o.rho, ZA, I: I_eV * 1e-6, I_eV, elems, X0g, X0, lamIg, lamI: lamIg / o.rho * 10,
    Ec, RM, dens: o.dens ? { C: o.dens[4], x0: o.dens[2], x1: o.dens[3], a: o.dens[0], k: o.dens[1], d0: o.dens[5] } : spRules(I_eV, o.rho, ZA),
    n: o.n || 0, scint: o.scint || 0, birks: o.birks || 0, pdgX0: o.pdgX0 || 0, vac: !!o.vac,
    z4a: elems.reduce((s, [Z, A, w]) => s + w * Z ** 4 / A, 0), zmax: Math.max(...elems.map(e => e[0])), zEff,
  };
}

// Sternheimer sets are [a, k, x0, x1, C, delta0] (PDG table order a, k, x0, x1, Cbar, delta0)
export const MAT = {
  vacuum: mat('vacuum', { name: 'Vacuum', rho: 1e-25, elems: [['H', 1]], I: 19.2, vac: true, Ec: 1e9 }),
  air: mat('air', { name: 'Air (dry, 1 atm)', rho: 1.205e-3, elems: [['N', 0.7553], ['O', 0.2318], ['Ar', 0.0129]], I: 85.7, ZA: 0.49919, lamIg: 90.1, Ec: 87.92, dens: [0.1091, 3.3994, 1.7418, 4.2759, 10.5961, 0], pdgX0: 36.62, n: 1.000293 }),
  gas: mat('gas', { name: 'Ar/CO2 chamber gas', rho: 1.66e-3, elems: [['Ar', 0.85], ['C', 0.041], ['O', 0.109]], I: 172, lamIg: 115, Ec: 38, dens: [0.1091, 3.3994, 1.7418, 4.2759, 10.5961, 0], n: 1.000283 }),   // density effect: the air set
  Be: mat('Be', { name: 'Beryllium', rho: 1.848, elems: [['Be', 1]], I: 63.7, ZA: 0.44384, lamIg: 77.8, Ec: 113.70, dens: [0.8039, 2.4339, 0.0592, 1.6922, 2.7847, 0.14], pdgX0: 65.19 }),
  Si: mat('Si', { name: 'Silicon', rho: 2.329, elems: [['Si', 1]], I: 173.0, ZA: 0.49848, lamIg: 108.4, Ec: 40.19, dens: [0.1492, 3.2546, 0.2015, 2.8716, 4.4355, 0.14], pdgX0: 21.82 }),
  Al: mat('Al', { name: 'Aluminium', rho: 2.699, elems: [['Al', 1]], I: 166.0, ZA: 0.48181, lamIg: 107.2, Ec: 42.70, dens: [0.0802, 3.6345, 0.1708, 3.0127, 4.2395, 0.12], pdgX0: 24.01 }),
  Fe: mat('Fe', { name: 'Iron', rho: 7.874, elems: [['Fe', 1]], I: 286.0, ZA: 0.46557, lamIg: 132.1, Ec: 21.68, dens: [0.1468, 2.9632, -0.0012, 3.1531, 4.2911, 0.12], pdgX0: 13.84 }),
  Cu: mat('Cu', { name: 'Copper', rho: 8.96, elems: [['Cu', 1]], I: 322.0, ZA: 0.45636, lamIg: 137.3, Ec: 19.42, dens: [0.1434, 2.9044, -0.0254, 3.2792, 4.4190, 0.08], pdgX0: 12.86 }),
  Pb: mat('Pb', { name: 'Lead', rho: 11.35, elems: [['Pb', 1]], I: 823.0, ZA: 0.39575, lamIg: 199.6, Ec: 7.43, dens: [0.0936, 3.1608, 0.3776, 3.8073, 6.2018, 0.14], pdgX0: 6.37 }),
  LAr: mat('LAr', { name: 'Liquid argon', rho: 1.396, elems: [['Ar', 1]], I: 188.0, ZA: 0.45059, lamIg: 119.7, Ec: 32.84, dens: [0.1956, 3.0, 0.2, 3.0, 5.2146, 0], pdgX0: 19.55, n: 1.23, scint: 40000 }),
  PbWO4: mat('PbWO4', { name: 'Lead tungstate', rho: 8.30, elems: [['Pb', 0.45537], ['W', 0.40403], ['O', 0.14060]], I: 600.7, ZA: 0.41315, lamIg: 168.3, Ec: 9.64, pdgX0: 7.39, n: 2.20, scint: 200, birks: 0 }),
  brass: mat('brass', { name: 'Brass (Cu 70, Zn 30)', rho: 8.53, elems: [['Cu', 0.7], ['Zn', 0.3]] }),
  scint: mat('scint', { name: 'Plastic scintillator (PVT)', rho: 1.032, elems: [['C', 0.9147], ['H', 0.0853]], I: 64.7, ZA: 0.54141, lamIg: 81.3, Ec: 94.11, dens: [0.1610, 3.2393, 0.1464, 2.4855, 3.1997, 0], pdgX0: 43.90, n: 1.58, scint: 10000, birks: 0.126 }),
};

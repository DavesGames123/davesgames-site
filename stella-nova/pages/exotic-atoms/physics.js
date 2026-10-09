// ============================================================================
//  EXOTIC ATOMS  ·  physics.js — states, species and scalings (no DOM)
// ----------------------------------------------------------------------------
//  Atomic units for one hydrogen-like system: hbar = m = e = a = 1, where
//  a is the Bohr radius of the species (a0 / mu for a reduced mass mu in
//  electron masses). Every wave function here is in these scaled units.
//  The species table (SPECIES) carries the factors that turn the scaled
//  numbers into metres, electron volts, tesla and volts per centimetre.
//
//  HIGH n. The radial function R_nl uses a Laguerre recurrence that is
//  rescaled in log space (logLaguerre), and the normalization is a sum of
//  logs (lfact). The angular function uses the normalized associated
//  Legendre recurrence, scaled by its first term (logTheta). Both stay
//  finite at n = l = 300, where plain factorials and P_l^m overflow.
//
//  WHAT IS EXACT, WHAT IS A MODEL
//    exact (non-relativistic, point nucleus): hydrogen-like energies,
//      R_nl, Y_lm, parabolic states, <r>, the probability current, the
//      orbital moment, the Zeeman shift (orbital and spin, no fine
//      structure), the linear and quadratic Stark terms.
//    fitted data: alkali and strontium quantum defects (Rydberg-Ritz),
//      the Cu2O exciton Rydberg energy and Bohr radius.
//    model: alkali lifetimes (hydrogen at the same n, l), the blackbody
//      rate (Cooke-Gallagher high-n formula), the strong-field ground
//      state (variational), the trilobite (Fermi pseudopotential in the
//      degenerate manifold).
//
//  GREP MAP
//    export const C ............... physical constants (CODATA 2018)
//    export const SOURCES ......... references, with DOIs
//    export const SPECIES ......... species table and unit factors
//    export function logLaguerre .. L^a_k(x) as { log, sign }, no overflow
//    export function logRnl ....... log |R_nl(r)| and sign
//    export function logTheta ..... log |Theta_lm(theta)| (normalized)
//    export function meanR / meanR2  <r>, <r^2>
//    export function quantumDefect  delta_l(n) of a species
//    export function energyEV ..... E(n, l) of a species, eV
//    export function transition ... photon of n,l -> n',l': eV, Hz, m, band
//    export function orbitalG ..... orbital moment per hbar (two-body)
//    export function zeemanEV ..... Zeeman shift, eV
//    export function starkEV ...... parabolic Stark energy, eV
//    export function inglisTeller . F_IT(n) and n_IT(F)
//    export function polarizability  second-order Stark of |n k m>
//    export function radiativeLifetimeH  exact hydrogen tau(n, l), s
//    export function bbrRate ...... Cooke-Gallagher blackbody rate, s^-1
//    export function lifetime ..... a species tau(n, l, T) with notes
//    export function strongB ...... variational ground state in a field
//    export function bandOf / photonRGB   photon band and colour
// ============================================================================
import { lfact } from '../circular-rydberg/physics.js';
export { lfact };

export const C = {
  alpha: 7.2973525693e-3,
  hartreeEV: 27.211386245988,
  ryEV: 13.605693122994,          // h c R_inf
  a0: 5.29177210903e-11,          // m
  tAU: 2.4188843265857e-17,       // s
  hartreeHz: 6.579683920502e15,
  hc_eVm: 1.23984198e-6,          // eV m
  cmToEV: 1.239841984e-4,         // 1 cm^-1 in eV
  B0: 2.35051757077e5,            // T, atomic unit of magnetic field
  F0: 5.14220674763e9,            // V/cm, atomic unit of electric field
  muB_eVT: 5.7883818060e-5,       // eV / T
  kB_eVK: 8.617333262e-5,
  mp: 1836.15267343, mmu: 206.7682830, gs: 2.00231930436,
};

// ---------------------------------------------------------------- sources
export const SOURCES = {
  codata: { cite: 'Tiesinga et al., CODATA recommended values of the fundamental physical constants: 2018, Rev. Mod. Phys. 93, 025010 (2021).', doi: '10.1103/RevModPhys.93.025010' },
  bethe: { cite: 'Bethe & Salpeter, Quantum Mechanics of One- and Two-Electron Atoms (Springer, 1957).', doi: '10.1007/978-3-662-12869-5' },
  gallagher: { cite: 'Gallagher, Rydberg Atoms (Cambridge University Press, 1994).', doi: '10.1017/CBO9780511524530' },
  li03: { cite: 'Li, Mourachko, Noel & Gallagher, Millimeter-wave spectroscopy of cold Rb Rydberg atoms in a magneto-optical trap: quantum defects of the ns, np and nd series, Phys. Rev. A 67, 052502 (2003).', doi: '10.1103/PhysRevA.67.052502' },
  han06: { cite: 'Han, Jamil, Norum, Tanner & Gallagher, Rb nf quantum defects from millimeter-wave spectroscopy of cold 85Rb Rydberg atoms, Phys. Rev. A 74, 054502 (2006).', doi: '10.1103/PhysRevA.74.054502' },
  deig16: { cite: 'Deiglmayr et al., Precision measurement of the ionization energy of Cs I, Phys. Rev. A 93, 013424 (2016).', doi: '10.1103/PhysRevA.93.013424' },
  arc: { cite: 'Šibalić, Pritchard, Adams & Weatherill, ARC: an open-source library for calculating properties of alkali Rydberg atoms, Comput. Phys. Commun. 220, 319 (2017). Sodium defects as compiled there.', doi: '10.1016/j.cpc.2017.06.015' },
  vail12: { cite: 'Vaillant, Jones & Potvliege, Long-range Rydberg–Rydberg interactions in calcium, strontium and ytterbium, J. Phys. B 45, 135004 (2012).', doi: '10.1088/0953-4075/45/13/135004' },
  kaz14: { cite: 'Kazimierczuk, Fröhlich, Scheel, Stolz & Bayer, Giant Rydberg excitons in the copper oxide Cu2O, Nature 514, 343 (2014).', doi: '10.1038/nature13832' },
  pohl10: { cite: 'Pohl et al., The size of the proton, Nature 466, 213 (2010).', doi: '10.1038/nature09250' },
  alpha18: { cite: 'Ahmadi et al. (ALPHA), Characterization of the 1S–2S transition in antihydrogen, Nature 557, 71 (2018).', doi: '10.1038/s41586-018-0017-2' },
  cassidy18: { cite: 'Cassidy, Experimental progress in positronium laser physics, Eur. Phys. J. D 72, 53 (2018).', doi: '10.1140/epjd/e2018-80721-y' },
  gds00: { cite: 'Greene, Dickinson & Sadeghpour, Creation of polar and nonpolar ultra-long-range Rydberg molecules, Phys. Rev. Lett. 85, 2458 (2000).', doi: '10.1103/PhysRevLett.85.2458' },
  bend09: { cite: 'Bendkowsky et al., Observation of ultralong-range Rydberg molecules, Nature 458, 1005 (2009).', doi: '10.1038/nature07945' },
  booth15: { cite: 'Booth, Rittenhouse, Yang, Sadeghpour & Shaffer, Production of trilobite Rydberg molecule dimers with kilo-Debye permanent electric dipole moments, Science 348, 99 (2015).', doi: '10.1126/science.aaa3739' },
  hgs02: { cite: 'Hamilton, Greene & Sadeghpour, Shape-resonance-induced long-range molecular Rydberg states, J. Phys. B 35, L199 (2002).', doi: '10.1088/0953-4075/35/10/102' },
  nied16: { cite: 'Niederprüm et al., Observation of pendular butterfly Rydberg molecules, Nat. Commun. 7, 12820 (2016).', doi: '10.1038/ncomms12820' },
  krav96: { cite: 'Kravchenko, Liberman & Johansson, Exact solution for a hydrogen atom in a magnetic field of arbitrary strength, Phys. Rev. Lett. 77, 619 (1996).', doi: '10.1103/PhysRevLett.77.619' },
  garton69: { cite: 'Garton & Tomkins, Diamagnetic Zeeman effect and magnetic configuration mixing in long spectral series of Ba I, Astrophys. J. 158, 839 (1969).', doi: '10.1086/150243' },
  ruder94: { cite: 'Ruder, Wunner, Herold & Geyer, Atoms in Strong Magnetic Fields (Springer, 1994).', doi: '10.1007/978-3-642-78820-7' },
  inglis39: { cite: 'Inglis & Teller, Ionic depression of series limits in one-electron spectra, Astrophys. J. 90, 439 (1939).', doi: '10.1086/144118' },
  cooke80: { cite: 'Cooke & Gallagher, Effects of blackbody radiation on highly excited atoms, Phys. Rev. A 21, 588 (1980).', doi: '10.1103/PhysRevA.21.588' },
  parker86: { cite: 'Parker & Stroud, Coherence and decay of Rydberg wave packets, Phys. Rev. Lett. 56, 716 (1986).', doi: '10.1103/PhysRevLett.56.716' },
  yeazell88: { cite: 'Yeazell & Stroud, Observation of spatially localized atomic electron wave packets, Phys. Rev. Lett. 60, 1494 (1988).', doi: '10.1103/PhysRevLett.60.1494' },
  nist: { cite: 'Sansonetti, Wavelengths, transition probabilities and energy levels for the spectra of rubidium (Rb I through Rb XXXVII), J. Phys. Chem. Ref. Data 35, 301 (2006); and the NIST compilations for Cs, Na and Sr by Sansonetti and co-workers (2008-2010).', doi: '10.1063/1.2035718' },
  pult26: { cite: 'Pultinevicius, Götzelmann, Thielemann, Hölzl & Meinert, Long-lived giant circular Rydberg atoms at room temperature, Nat. Commun. 17, 9834 (2026).', doi: '10.1038/s41467-026-77764-x' },
  hulet83: { cite: 'Hulet & Kleppner, Rydberg atoms in "circular" states, Phys. Rev. Lett. 51, 1430 (1983).', doi: '10.1103/PhysRevLett.51.1430' },
};

// ---------------------------------------------------------------- species
// Two-body masses (electron masses) and charges (units of e) give the
// reduced mass and the orbital magnetic moment. 'orb' orbits 'nuc'.
// kind: 'hyd' (pure Coulomb), 'qd' (quantum defects), 'exc' (exciton).
// Quantum defects: delta_l(n) = d0 + d2 / (n - d0)^2 (modified
// Rydberg-Ritz). Above the table, alkalis use the core-polarization
// model with the core dipole polarizability alphaD (a.u.).
const RB = { S: [3.1311804, 0.1784], P: [2.6416737, 0.2950], D: [1.34646572, -0.59600], F: [0.0165192, -0.085] };
const CS = { S: [4.0493532, 0.2391], P: [3.5590676, 0.37469], D: [2.4663144, 0.01381], F: [0.0334987, -0.198674] };
const NA = { S: [1.34796938, 0.0609892], P: [0.85462615, 0.112344], D: [0.014909286, -0.042506], F: [0.001632977, -0.0069906] };
const SR = { S: [3.26896, -0.138], P: [2.7295, -4.67], D: [2.3807, -39.41], F: [0.089, -2.0] };

export const SPECIES = {
  H: { id: 'H', name: 'Hydrogen', sym: 'H', kind: 'hyd', orb: [1, -1], nuc: [C.mp, 1], nMin: 1, nMax: 300, src: ['codata', 'bethe'],
    note: 'An electron bound to a proton. Non-relativistic, point nucleus: the energies, shapes and currents shown are exact solutions.' },
  antiH: { id: 'antiH', name: 'Antihydrogen', sym: 'H̄', kind: 'hyd', orb: [1, 1], nuc: [C.mp, -1], nMin: 1, nMax: 300, src: ['alpha18', 'codata'],
    note: 'A positron bound to an antiproton. CPT symmetry gives the same levels and clouds as hydrogen (ALPHA measured 1S–2S to 2 parts in 10¹²). The positron carries +e, so its current and orbital moment point the other way.' },
  Ps: { id: 'Ps', name: 'Positronium', sym: 'Ps', kind: 'hyd', orb: [1, -1], nuc: [1, 1], nMin: 1, nMax: 300, src: ['cassidy18', 'bethe'],
    note: 'An electron and a positron orbit their common centre. The reduced mass is m/2: every level is half as deep and the cloud is twice as large. Equal masses with opposite charges cancel the orbital magnetic moment exactly.' },
  muH: { id: 'muH', name: 'Muonic hydrogen', sym: 'μp', kind: 'hyd', orb: [C.mmu, -1], nuc: [C.mp, 1], nMin: 1, nMax: 300, src: ['pohl10', 'codata'],
    note: 'A negative muon (207 electron masses) bound to a proton. The reduced mass is 185.8 m: the atom is 186 times smaller and 186 times deeper. The muon decays in 2.2 µs.' },
  Rb: { id: 'Rb', name: 'Rubidium', sym: 'Rb', kind: 'qd', low: { '5,0': 33690.8048, '5,1': 20874.256 }, orb: [1, -1], nuc: [85 * C.mp, 1], nMin: 5, nMax: 300, Rcm: 109736.605, ionCm: 33690.8048, qd: RB, alphaD: 9.12, src: ['li03', 'han06', 'nist', 'gallagher'],
    note: 'One valence electron outside a closed Rb⁺ core. Low-l orbits dive into the core and are bound deeper: the quantum defect δ_l. High-l orbits stay outside and act like hydrogen.' },
  Cs: { id: 'Cs', name: 'Caesium', sym: 'Cs', kind: 'qd', low: { '6,0': 31406.4677, '6,1': 19674.161 }, orb: [1, -1], nuc: [133 * C.mp, 1], nMin: 6, nMax: 300, Rcm: 109736.8627339, ionCm: 31406.4677325, qd: CS, alphaD: 15.644, src: ['deig16', 'nist', 'gallagher'],
    note: 'The heaviest stable alkali. Its large core gives the largest quantum defects here (δ_S = 4.05).' },
  Na: { id: 'Na', name: 'Sodium', sym: 'Na', kind: 'qd', low: { '3,0': 41449.451, '3,1': 24476.085 }, orb: [1, -1], nuc: [23 * C.mp, 1], nMin: 3, nMax: 300, Rcm: 109734.69, ionCm: 41449.451, qd: NA, alphaD: 0.998, src: ['arc', 'nist', 'gallagher'],
    note: 'A small Na⁺ core: only S and P have large quantum defects. The D series is already almost hydrogenic.' },
  Sr: { id: 'Sr', name: 'Strontium', sym: 'Sr', kind: 'qd', low: { '5,0': 45932.2036, '5,1': 24233.751 }, orb: [1, -1], nuc: [88 * C.mp, 1], nMin: 5, nMax: 300, Rcm: 109736.631, ionCm: 45932.2036, qd: SR, alphaD: 0, src: ['vail12', 'nist', 'pult26'],
    note: 'Two valence electrons: one stays in 5s, one goes to the Rydberg orbit (singlet series shown). The ¹D₂ series is perturbed below n ≈ 20. Circular Sr states held for 11.5 ms at room temperature (2026).' },
  X: { id: 'X', name: 'Cu₂O exciton', sym: 'X', kind: 'exc', orb: [1, -1], nuc: [1, 1], nMin: 2, nMax: 30, ryEV: 0.092, aM: 1.11e-9, gapEV: 2.17208, src: ['kaz14'],
    note: 'An electron and a hole bound inside a copper-oxide crystal. Screening and light effective masses make a Rydberg energy of 92 meV and a Bohr radius of 1.11 nm. States up to n = 25 were seen, more than 2 µm across. Quantum defects of the exciton series are left out here.' },
};

// Unit factors of a species: a (m), Eh (eV: twice the species Rydberg
// energy), the field unit (V/cm), mu (reduced mass) and the moment factor.
export function units(sp) {
  sp = typeof sp === 'string' ? SPECIES[sp] : sp;
  if (sp._u) return sp._u;
  let mu, a, Eh;
  if (sp.kind === 'exc') { mu = 1; a = sp.aM; Eh = 2 * sp.ryEV; }
  else {
    const [m1] = sp.orb, [m2] = sp.nuc; mu = m1 * m2 / (m1 + m2);
    a = C.a0 / mu; Eh = sp.kind === 'qd' ? 2 * sp.Rcm * C.cmToEV : C.hartreeEV * mu;
  }
  return (sp._u = { mu, a, Eh, F: Eh / a / 100, g: orbitalG(sp) });
}

// Orbital magnetic moment per unit angular momentum, in Bohr magnetons per
// hbar. For charges q1, q2 and masses m1, m2 about the centre of mass:
//   mu = (L / 2) (q1 m2^2 + q2 m1^2) / (M m1 m2)    (e = m_e = 1)
// mu_B = 1/2, so g = (q1 m2^2 + q2 m1^2) / (M m1 m2): hydrogen -> -0.99946,
// positronium -> 0, antihydrogen -> +0.99946.
export function orbitalG(sp) {
  sp = typeof sp === 'string' ? SPECIES[sp] : sp;
  if (sp.kind === 'exc') return NaN;
  const [m1, q1] = sp.orb, [m2, q2] = sp.nuc, M = m1 + m2;
  return (q1 * m2 * m2 + q2 * m1 * m1) / (M * m1 * m2);
}

// ---------------------------------------------------------------- radial
// L^a_k(x) by the upward recurrence, rescaled when it grows, so the result
// is { log: log|L|, sign }. (k + 1) L_{k+1} = (2k + 1 + a - x) L_k - (k + a) L_{k-1}.
export function logLaguerre(k, a, x) {
  if (k === 0) return { log: 0, sign: 1 };
  let p = 1, q = 1 + a - x, lg = 0;
  for (let j = 1; j < k; j++) {
    const t = ((2 * j + 1 + a - x) * q - (j + a) * p) / (j + 1);
    p = q; q = t;
    const s = Math.abs(q);
    if (s > 1e150) { p /= s; q /= s; lg += Math.log(s); }
    else if (s < 1e-150 && s > 0 && Math.abs(p) < 1e-150) { p *= 1e150; q *= 1e150; lg -= 150 * Math.LN10; }
  }
  if (q === 0) return { log: -Infinity, sign: 0 };
  return { log: lg + Math.log(Math.abs(q)), sign: Math.sign(q) };
}
const logNorm = (n, l) => 0.5 * (3 * Math.log(2 / n) + lfact(n - l - 1) - Math.log(2 * n) - lfact(n + l));
// log |R_nl(r)| and the sign, with int R^2 r^2 dr = 1
export function logRnl(n, l, r) {
  if (r <= 0) return l === 0 ? { log: logNorm(n, 0) + logLaguerre(n - 1, 1, 0).log, sign: 1 } : { log: -Infinity, sign: 0 };
  const rho = 2 * r / n, L = logLaguerre(n - l - 1, 2 * l + 1, rho);
  if (!L.sign) return { log: -Infinity, sign: 0 };
  return { log: logNorm(n, l) + l * Math.log(rho) - rho / 2 + L.log, sign: L.sign };
}
export const Rnl = (n, l, r) => { const v = logRnl(n, l, r); return v.sign ? v.sign * Math.exp(v.log) : 0; };

// Theta_lm(theta) with int |Theta|^2 2 pi sin(theta) dtheta = 1, that is
// |Y_lm| = |Theta_lm|. Normalized recurrence (P-bar), scaled by P-bar_mm:
//   P_l = sqrt((4l^2-1)/(l^2-m^2)) [x P_{l-1} - sqrt(((l-1)^2-m^2)/(4(l-1)^2-1)) P_{l-2}]
const LPM = [0];
const logPmmC = m => { for (let k = LPM.length; k <= m; k++) LPM[k] = LPM[k - 1] + Math.log((2 * k - 1) / (2 * k)); return LPM[m]; };
export function logTheta(l, m, x) {
  m = Math.abs(m);
  const s2 = Math.max(0, (1 - x) * (1 + x));
  const base = 0.5 * (Math.log((2 * m + 1) / (4 * Math.PI)) + logPmmC(m)) + (m ? 0.5 * m * Math.log(s2) : 0);
  if (m > 0 && s2 === 0) return { log: -Infinity, sign: 0 };
  if (l === m) return { log: base, sign: 1 };
  let p0 = 1, p1 = x * Math.sqrt(2 * m + 3), lg = 0;
  for (let ll = m + 2; ll <= l; ll++) {
    const a = Math.sqrt((4 * ll * ll - 1) / (ll * ll - m * m)), b = Math.sqrt(((ll - 1) * (ll - 1) - m * m) / (4 * (ll - 1) * (ll - 1) - 1));
    const t = a * (x * p1 - b * p0); p0 = p1; p1 = t;
    const s = Math.abs(p1); if (s > 1e100) { p0 /= s; p1 /= s; lg += Math.log(s); }
  }
  if (p1 === 0) return { log: -Infinity, sign: 0 };
  return { log: base + lg + Math.log(Math.abs(p1)), sign: Math.sign(p1) };
}

export const meanR = (n, l) => (3 * n * n - l * (l + 1)) / 2;
export const meanR2 = (n, l) => n * n * (5 * n * n + 1 - 3 * l * (l + 1)) / 2;
// outer classical turning point of |n l>, and a radius past which the
// density is negligible (the Airy tail falls over about n^(4/3))
export const rTurn = (n, l) => n * n + n * Math.sqrt(Math.max(0, n * n - l * (l + 1)));
export const rMaxOf = (n, l) => rTurn(n, l) + 7 * Math.pow(n, 4 / 3) + 12;

// ---------------------------------------------------------------- energies
const LET = 'SPDF';
export function quantumDefect(sp, n, l) {
  sp = typeof sp === 'string' ? SPECIES[sp] : sp;
  if (sp.kind !== 'qd') return 0;
  const row = sp.qd[LET[l]];
  if (row) { const [d0, d2] = row, x = n - d0; return d0 + d2 / (x * x); }
  if (!sp.alphaD) return 0;
  // core polarization: delta_l = (3 alphaD / 4) / [(l+3/2)(l+1)(l+1/2) l (l-1/2)]
  return 0.75 * sp.alphaD / ((l + 1.5) * (l + 1) * (l + 0.5) * l * (l - 0.5));
}
export const nStar = (sp, n, l) => n - quantumDefect(sp, n, l);

// Energy of |n l> in eV. Hydrogen-like: -Eh / (2 n^2) (reduced mass in Eh).
// Quantum defects: -R hc / (n - delta)^2 below the ionization limit; the
// ground state and the first P level (D2 line, J = 3/2) of the alkalis
// and Sr (5s5p 1P1) use measured term values (NIST compilations).
// Exciton: gap - Ry / n^2, measured from the crystal ground state; the
// binding is Ry / n^2. bindingEV is always positive.
export function bindingEV(sp, n, l = 0) {
  sp = typeof sp === 'string' ? SPECIES[sp] : sp;
  if (sp.low && sp.low[n + ',' + l] != null) return sp.low[n + ',' + l] * C.cmToEV;
  const u = units(sp), ns = nStar(sp, n, l);
  return u.Eh / (2 * ns * ns);
}
export function energyEV(sp, n, l = 0) {
  sp = typeof sp === 'string' ? SPECIES[sp] : sp;
  if (sp.kind === 'exc') return sp.gapEV - bindingEV(sp, n, l);
  return -bindingEV(sp, n, l);
}
// mean radius in metres (quantum-defect species: n* in place of n, a model)
export function sizeM(sp, n, l = 0) {
  sp = typeof sp === 'string' ? SPECIES[sp] : sp;
  return meanR(nStar(sp, n, l), Math.min(l, nStar(sp, n, l) - 0.5)) * units(sp).a;
}

// photon bands by vacuum wavelength
export function bandOf(lam) {
  if (lam < 1e-8) return 'X-ray';
  if (lam < 3.8e-7) return 'UV';
  if (lam < 7.8e-7) return 'visible';
  if (lam < 3e-5) return 'infrared';
  if (lam < 1e-3) return 'terahertz';
  if (lam < 1) return 'microwave';
  return 'radio';
}
// photon of an absorption n,l -> n2,l2 (or the exciton creation, n = 0)
export function transition(sp, n, l, n2, l2) {
  sp = typeof sp === 'string' ? SPECIES[sp] : sp;
  const e1 = n === 0 ? 0 : energyEV(sp, n, l), e2 = energyEV(sp, n2, l2);
  const eV = e2 - e1, lam = C.hc_eVm / Math.abs(eV), hz = Math.abs(eV) / C.hartreeEV * C.hartreeHz;
  return { eV, lam, hz, band: bandOf(lam) };
}
// an sRGB colour for a vacuum wavelength (visible: a standard piecewise
// fit; outside: violet for UV and X-ray, deep red for infrared, cool grey
// blues for terahertz, microwave and radio)
export function photonRGB(lam) {
  const nm = lam * 1e9;
  if (nm < 380) return nm < 10 ? [200, 220, 255] : [170, 110, 255];
  if (nm > 780) { if (lam < 3e-5) return [190, 40, 40]; if (lam < 1e-3) return [200, 120, 170]; return lam < 1 ? [110, 200, 255] : [150, 170, 210]; }
  let r = 0, g = 0, b = 0;
  if (nm < 440) { r = -(nm - 440) / 60; b = 1; } else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = -(nm - 510) / 20; } else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; } else r = 1;
  const f = nm < 420 ? 0.3 + 0.7 * (nm - 380) / 40 : nm > 700 ? 0.3 + 0.7 * (780 - nm) / 80 : 1;
  return [r, g, b].map(v => Math.round(255 * Math.pow(v * f, 0.8)));
}

// ---------------------------------------------------------------- fields
// Zeeman shift (eV) of m, m_s in a field B (T) along z: -mu . B with the
// two-body orbital moment g m mu_B and the spin moment of the orbiting
// lepton (electron -g_s m_s mu_B, positron +g_s m_s mu_B). Positronium:
// the orbital term is zero; its spin mixing is left out.
export function zeemanEV(sp, m, ms, B) {
  sp = typeof sp === 'string' ? SPECIES[sp] : sp;
  if (sp.kind === 'exc') return NaN;
  const g = orbitalG(sp), q = sp.orb[1];
  const spin = sp.id === 'muH' ? 0 : -q * C.gs * ms;   // the muon moment is 207 times smaller; left out
  return -(g * m - spin) * C.muB_eVT * B;
}
// Larmor angular frequency (rad/s) of the orbital moment in B (T)
export const larmor = (sp, B) => Math.abs(orbitalG(sp)) * C.muB_eVT * B / 6.582119569e-16;

// Parabolic Stark energy of |n n1 n2 m> in a field F (V/cm), eV, to
// second order (Bethe & Salpeter sec. 51-52):
//   E = -1/(2n^2) + (3/2) F n k - F^2 n^4 (17 n^2 - 3 k^2 - 9 m^2 + 19) / 16,  k = n1 - n2
export function starkEV(sp, n, k, m, FVcm) {
  const u = units(sp), F = FVcm / u.F;
  return u.Eh * (-0.5 / (n * n) + 1.5 * F * n * k - F * F * Math.pow(n, 4) * (17 * n * n - 3 * k * k - 9 * m * m + 19) / 16);
}
export const starkDipole = (n, k) => 1.5 * n * k;          // e a, along z
// alpha = n^4 (17 n^2 - 3 k^2 - 9 m^2 + 19) / 8 (scaled atomic units, a^3)
export const polarizability = (n, k, m) => Math.pow(n, 4) * (17 * n * n - 3 * k * k - 9 * m * m + 19) / 8;
// Inglis-Teller: the n and n+1 manifolds touch when 3 n^2 F ~ 1/n^3,
// F_IT = 1/(3 n^5) (scaled a.u.). field in V/cm for a species, and the
// largest n still resolved at a stray field F (V/cm).
export function inglisTeller(sp, n) { return units(sp).F / (3 * Math.pow(n, 5)); }
export function inglisTellerN(sp, FVcm) { return Math.pow(units(sp).F / (3 * FVcm), 0.2); }
// classical saddle-point field ionization, F = 1/(16 n*^4)
export function ionField(sp, n, l = 0) { return units(sp).F / (16 * Math.pow(nStar(sp, n, l), 4)); }

// ---------------------------------------------------------------- lifetimes
// exact radiative lifetime of hydrogen |n l> (infinite nuclear mass),
// seconds: A = (4/3) alpha^3 w^3 (l_> / (2l+1)) |<n' l'| r |n l>|^2.
// R_nl is tabulated once on a sqrt-spaced grid; each channel integrates
// (trapezoid) only over the grid points inside its own lower state.
// Channels go to the 60 lowest n' of each l' = l +- 1 (the higher ones
// add less than 0.1 %).
const tauCache = new Map();
export function radiativeLifetimeH(n, l) {
  const key = n * 1000 + l;
  if (tauCache.has(key)) return tauCache.get(key);
  const G = 30000, rM = rMaxOf(n, l), r = new Float64Array(G + 1), R = new Float64Array(G + 1);
  for (let i = 1; i <= G; i++) { const u = i / G; r[i] = rM * u * u; R[i] = Rnl(n, l, r[i]) * r[i] * r[i] * r[i]; }
  let rate = 0;
  for (const l2 of [l - 1, l + 1]) {
    if (l2 < 0) continue;
    for (let n2 = l2 + 1, c = 0; n2 < n && c < 60; n2++, c++) {
      const w = 0.5 / (n2 * n2) - 0.5 / (n * n), top = Math.min(G, Math.ceil(G * Math.sqrt(rMaxOf(n2, l2) * 1.05 / rM)));
      let d = 0, pv = 0;
      for (let i = 1; i <= top; i++) { const v = R[i] * Rnl(n2, l2, r[i]); d += 0.5 * (v + pv) * (r[i] - r[i - 1]); pv = v; }
      rate += (4 / 3) * Math.pow(C.alpha, 3) * w * w * w * (Math.max(l, l2) / (2 * l + 1)) * d * d;
    }
  }
  const tau = rate > 0 ? C.tAU / rate : Infinity;
  tauCache.set(key, tau);
  return tau;
}
// Cooke-Gallagher blackbody depopulation rate, s^-1, valid when the
// neighbouring level spacing is below kT: Gamma = 4 alpha^3 kT / (3 n*^2)
export function bbrRate(sp, n, l, T) {
  const u = units(sp), ns = nStar(sp, n, l), kT = C.kB_eVK * T / u.Eh;
  if (T <= 0) return 0;
  const spacing = 1 / (ns * ns * ns);
  if (spacing > 3 * kT) return 0;               // hard photons: the rate is negligible
  return 4 * Math.pow(C.alpha, 3) * kT / (3 * ns * ns) / C.tAU * u.mu;
}
// A lifetime estimate with its basis. T in K. Returns { s, basis, cap }.
export function lifetime(sp, n, l, T = 300) {
  sp = typeof sp === 'string' ? SPECIES[sp] : sp;
  if (sp.kind === 'exc') return { s: NaN, basis: 'measured linewidths scale as n⁻³ (Kazimierczuk 2014); no model here' };
  const u = units(sp), ns = Math.max(1, Math.round(nStar(sp, n, l)));
  const lh = Math.min(l, ns - 1);
  if (ns < 2 && lh === 0) return { s: Infinity, basis: 'ground state: stable' };
  // hydrogen tau scales as 1/mu (A ~ w^3 d^2, w ~ mu, d ~ 1/mu)
  let rad = radiativeLifetimeH(ns, lh) / u.mu;
  let basis = sp.kind === 'qd' ? 'hydrogen model at n* (model)' : 'exact radiative decay';
  let cap = '';
  if (sp.id === 'muH') { const tm = 2.1969811e-6; if (rad > tm) { cap = 'muon decay, 2.2 µs'; } rad = 1 / (1 / rad + 1 / tm); }
  if (sp.id === 'Ps' && lh === 0) { const ta = 142.05e-9 * n * n * n; rad = 1 / (1 / rad + 1 / ta); basis += ' + o-Ps annihilation (142 ns × n³)'; }
  const bbr = bbrRate(sp, n, l, T);
  return { s: 1 / (1 / rad + bbr), rad, bbr, basis, cap };
}

// ---------------------------------------------------------------- strong B
// Variational ground state (m = 0, spin down) of hydrogen in a field
// beta = B / B0 along z. Trial function (three parameters):
//   psi = exp(-rho^2 / (4 s^2) - sqrt(rho^2/a^2 + z^2/b^2))
// It is the hydrogen 1s state when s -> infinity, a = b = 1, and the
// lowest Landau orbital times a 1D cusp when a -> infinity (s = 1/sqrt(beta)).
//   E = [ (1/2) int |grad psi|^2 - int psi^2 / r + (beta^2/8) int rho^2 psi^2 ] / int psi^2
// on a sqrt-spaced (rho, z) grid. The binding energy quoted in the
// literature is beta/2 - E. Exact values: Kravchenko et al. 1996.
export function strongEnergy(beta, s, a, b, G = 150) {
  const Lr = 9 * Math.min(a, 1.6 * s), Lz = 9 * b;
  let N = 0, T = 0, V = 0, D = 0, R2 = 0, Z2 = 0;
  for (let i = 0; i < G; i++) {
    const u0 = i / G, u1 = (i + 1) / G, rho = Lr * ((u0 + u1) / 2) ** 2, dr = Lr * (u1 * u1 - u0 * u0);
    for (let j = 0; j < G; j++) {
      const v0 = j / G, v1 = (j + 1) / G, z = Lz * ((v0 + v1) / 2) ** 2, dz = Lz * (v1 * v1 - v0 * v0);
      const q = Math.sqrt(rho * rho / (a * a) + z * z / (b * b)) || 1e-12, lp = -rho * rho / (4 * s * s) - q;
      const p2 = Math.exp(2 * lp), w = p2 * rho * dr * dz;          // 2 pi and the z mirror cancel
      const gr = -rho / (2 * s * s) - rho / (a * a * q), gz = -z / (b * b * q);
      N += w; T += 0.5 * (gr * gr + gz * gz) * w; V += w / Math.hypot(rho, z); D += rho * rho * w; Z2 += z * z * w;
    }
  }
  return { E: (T - V + beta * beta / 8 * D) / N, rho2: D / N, z2: Z2 / N };
}
export function strongB(beta) {
  const f = (ls, la, lb) => strongEnergy(beta, Math.exp(ls), Math.exp(la), Math.exp(lb), 90).E;
  // start: hydrogen at weak field, Landau width at strong field
  let x = [beta > 0.05 ? Math.log(1 / Math.sqrt(beta)) : 4, 0, beta > 1 ? -0.4 * Math.log(beta) : 0], best = f(...x);
  for (let step = 0.8; step > 2e-3; step *= 0.5) {
    for (let it = 0; it < 40; it++) {
      let moved = false;
      for (let d = 0; d < 3; d++) for (const sg of [1, -1]) {
        const y = x.slice(); y[d] += sg * step; const v = f(...y);
        if (v < best - 1e-12) { best = v; x = y; moved = true; }
      }
      if (!moved) break;
    }
  }
  const [s, a, b] = x.map(Math.exp), fine = strongEnergy(beta, s, a, b, 220);
  return { beta, s, a, b, E: fine.E, binding: beta / 2 - fine.E, rhoRms: Math.sqrt(fine.rho2), zRms: Math.sqrt(fine.z2), aspect: Math.sqrt(fine.z2) / Math.sqrt(fine.rho2 / 2), landau: beta > 0 ? 1 / Math.sqrt(beta) : Infinity };
}
// published binding energies (hartree) of the ground state, for checks
export const STRONG_B_EXACT = { 1: 0.831168896, 10: 1.747797163, 100: 3.789804236, 1000: 7.662423247 };

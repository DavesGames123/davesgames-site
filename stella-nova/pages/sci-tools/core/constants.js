// ============================================================================
//  SCIENCE TOOLKIT  ·  core/constants.js  ·  CODATA 2022 and IAU values
// ----------------------------------------------------------------------------
//  The physical constants are the CODATA 2022 recommended values (E. Tiesinga
//  et al., NIST, published May 2024, https://physics.nist.gov/cuu/Constants/).
//  The rows were copied from scipy.constants 1.15 (which ships CODATA 2022)
//  by a generator script, and tests.mjs checks spot values against NIST. An
//  uncertainty of 0 marks an exact value (the 2019 SI defines h, e, k, N_A
//  and c; R, F, sigma and so on follow from them).
//
//  The astronomical rows are IAU 2012 Resolution B2 (au) and IAU 2015
//  Resolution B3 (nominal solar and terrestrial values). They are
//  conventional values, not measurements.
//
//  Row: [id, group, TeX symbol, name, value, standard uncertainty, unit].
//  The id is the name for the calculator: "$c", "$hbar", "$me".
//
//  GREP MAP
//    grep -n "export const GROUPS"  group ids and names
//    grep -n "export const ROWS"    the table
//    grep -n "export const CONST"   id -> { v, unc, unit, name, tex, grp }
// ============================================================================

export const GROUPS = {
  u: 'Universal', pc: 'Physico-chemical', em: 'Electromagnetic', at: 'Atomic and nuclear',
  pa: 'Particle masses', pl: 'Planck units', iau: 'Astronomical (IAU, conventional)',
};

export const ROWS = [
  ["c", "u", "c", "speed of light in vacuum", 299792458.0, 0.0, "m s^-1"],
  ["h", "u", "h", "Planck constant", 6.62607015e-34, 0.0, "J Hz^-1"],
  ["hbar", "u", "\\hbar", "reduced Planck constant", 1.0545718176461565e-34, 0.0, "J s"],
  ["qe", "u", "e", "elementary charge", 1.602176634e-19, 0.0, "C"],
  ["kB", "u", "k_\\mathrm{B}", "Boltzmann constant", 1.380649e-23, 0.0, "J K^-1"],
  ["NA", "u", "N_\\mathrm{A}", "Avogadro constant", 6.02214076e+23, 0.0, "mol^-1"],
  ["R", "pc", "R", "molar gas constant", 8.31446261815324, 0.0, "J mol^-1 K^-1"],
  ["F", "pc", "F", "Faraday constant", 96485.33212331001, 0.0, "C mol^-1"],
  ["sigma", "pc", "\\sigma", "Stefan-Boltzmann constant", 5.6703744191844314e-08, 0.0, "W m^-2 K^-4"],
  ["b", "pc", "b", "Wien wavelength displacement law constant", 0.0028977719551851727, 0.0, "m K"],
  ["bnu", "pc", "b'", "Wien frequency displacement law constant", 58789257576.468254, 0.0, "Hz K^-1"],
  ["c1", "pc", "c_1", "first radiation constant", 3.7417718521927573e-16, 0.0, "W m^2"],
  ["c2", "pc", "c_2", "second radiation constant", 0.014387768775039337, 0.0, "m K"],
  ["Vm", "pc", "V_\\mathrm{m}", "molar volume of ideal gas (273.15 K, 101.325 kPa)", 0.022413969545014137, 0.0, "m^3 mol^-1"],
  ["n0", "pc", "n_0", "Loschmidt constant (273.15 K, 101.325 kPa)", 2.686780111798444e+25, 0.0, "m^-3"],
  ["kBeV", "pc", "k_\\mathrm{B}", "Boltzmann constant in eV/K", 8.617333262145179e-05, 0.0, "eV K^-1"],
  ["heV", "pc", "h", "Planck constant in eV/Hz", 4.135667696923859e-15, 0.0, "eV Hz^-1"],
  ["hbarc", "pc", "\\hbar c", "reduced Planck constant times c in MeV fm", 197.3269804593025, 0.0, "MeV fm"],
  ["eV", "pc", "\\mathrm{eV}", "electron volt", 1.602176634e-19, 0.0, "J"],
  ["G", "u", "G", "Newtonian constant of gravitation", 6.6743e-11, 1.5e-15, "m^3 kg^-1 s^-2"],
  ["gn", "u", "g_\\mathrm{n}", "standard acceleration of gravity", 9.80665, 0.0, "m s^-2"],
  ["atm", "u", "\\mathrm{atm}", "standard atmosphere", 101325.0, 0.0, "Pa"],
  ["mu0", "em", "\\mu_0", "vacuum mag. permeability", 1.25663706127e-06, 2e-16, "N A^-2"],
  ["eps0", "em", "\\varepsilon_0", "vacuum electric permittivity", 8.8541878188e-12, 1.4e-21, "F m^-1"],
  ["Z0", "em", "Z_0", "characteristic impedance of vacuum", 376.730313412, 5.9e-08, "ohm"],
  ["Phi0", "em", "\\Phi_0", "mag. flux quantum", 2.0678338484619295e-15, 0.0, "Wb"],
  ["G0", "em", "G_0", "conductance quantum", 7.748091729863649e-05, 0.0, "S"],
  ["KJ", "em", "K_\\mathrm{J}", "Josephson constant", 483597848416983.6, 0.0, "Hz V^-1"],
  ["RK", "em", "R_\\mathrm{K}", "von Klitzing constant", 25812.807459304513, 0.0, "ohm"],
  ["muB", "em", "\\mu_\\mathrm{B}", "Bohr magneton", 9.2740100657e-24, 2.9e-33, "J T^-1"],
  ["muN", "em", "\\mu_\\mathrm{N}", "nuclear magneton", 5.0507837393e-27, 1.6e-36, "J T^-1"],
  ["alpha", "at", "\\alpha", "fine-structure constant", 0.0072973525643, 1.1e-12, ""],
  ["alphainv", "at", "\\alpha^{-1}", "inverse fine-structure constant", 137.035999177, 2.1e-08, ""],
  ["Rinf", "at", "R_\\infty", "Rydberg constant", 10973731.568157, 1.2e-05, "m^-1"],
  ["Ry", "at", "hcR_\\infty", "Rydberg constant times hc in eV", 13.60569312299, 1.5e-11, "eV"],
  ["a0", "at", "a_0", "Bohr radius", 5.29177210544e-11, 8.2e-21, "m"],
  ["Eh", "at", "E_\\mathrm{h}", "Hartree energy", 4.359744722206e-18, 4.8e-30, "J"],
  ["EheV", "at", "E_\\mathrm{h}", "Hartree energy in eV", 27.211386245981, 3e-11, "eV"],
  ["re", "at", "r_\\mathrm{e}", "classical electron radius", 2.8179403205e-15, 1.3e-24, "m"],
  ["sigmae", "at", "\\sigma_\\mathrm{e}", "Thomson cross section", 6.6524587051e-29, 6.2e-38, "m^2"],
  ["lambdaC", "at", "\\lambda_\\mathrm{C}", "Compton wavelength", 2.42631023538e-12, 7.6e-22, "m"],
  ["ge", "at", "g_\\mathrm{e}", "electron g factor", -2.00231930436092, 3.6e-13, ""],
  ["mue", "at", "\\mu_\\mathrm{e}", "electron mag. mom.", -9.2847646917e-24, 2.9e-33, "J T^-1"],
  ["mup", "at", "\\mu_\\mathrm{p}", "proton mag. mom.", 1.41060679545e-26, 6e-36, "J T^-1"],
  ["gammap", "at", "\\gamma_\\mathrm{p}", "proton gyromag. ratio", 267522187.08, 0.11, "s^-1 T^-1"],
  ["me", "pa", "m_\\mathrm{e}", "electron mass", 9.1093837139e-31, 2.8e-40, "kg"],
  ["mec2", "pa", "m_\\mathrm{e}c^2", "electron mass energy equivalent in MeV", 0.51099895069, 1.6e-10, "MeV"],
  ["emme", "pa", "-e/m_\\mathrm{e}", "electron charge to mass quotient", -175882000838.0, 55.0, "C kg^-1"],
  ["mp", "pa", "m_\\mathrm{p}", "proton mass", 1.67262192595e-27, 5.2e-37, "kg"],
  ["mpc2", "pa", "m_\\mathrm{p}c^2", "proton mass energy equivalent in MeV", 938.27208943, 2.9e-07, "MeV"],
  ["mn", "pa", "m_\\mathrm{n}", "neutron mass", 1.67492750056e-27, 8.5e-37, "kg"],
  ["mnc2", "pa", "m_\\mathrm{n}c^2", "neutron mass energy equivalent in MeV", 939.56542194, 4.8e-07, "MeV"],
  ["mu", "pa", "m_\\mathrm{u}", "atomic mass constant", 1.66053906892e-27, 5.2e-37, "kg"],
  ["muc2", "pa", "m_\\mathrm{u}c^2", "atomic mass constant energy equivalent in MeV", 931.49410372, 2.9e-07, "MeV"],
  ["md", "pa", "m_\\mathrm{d}", "deuteron mass", 3.3435837768e-27, 1e-36, "kg"],
  ["malpha", "pa", "m_\\alpha", "alpha particle mass", 6.644657345e-27, 2.1e-36, "kg"],
  ["mmu", "pa", "m_\\mu", "muon mass", 1.883531627e-28, 4.2e-36, "kg"],
  ["mpme", "pa", "m_\\mathrm{p}/m_\\mathrm{e}", "proton-electron mass ratio", 1836.152673426, 3.2e-08, ""],
  ["MC12", "pa", "M(^{12}\\mathrm{C})", "molar mass of carbon-12", 0.0120000000126, 3.7e-12, "kg mol^-1"],
  ["mP", "pl", "m_\\mathrm{P}", "Planck mass", 2.176434e-08, 2.4e-13, "kg"],
  ["lP", "pl", "l_\\mathrm{P}", "Planck length", 1.616255e-35, 1.8e-40, "m"],
  ["tP", "pl", "t_\\mathrm{P}", "Planck time", 5.391247e-44, 6e-49, "s"],
  ["TP", "pl", "T_\\mathrm{P}", "Planck temperature", 1.416784e+32, 1.6e+27, "K"],
  ["au", "iau", "\\mathrm{au}", "astronomical unit", 149597870700, 0, "m"],
  ["pc", "iau", "\\mathrm{pc}", "parsec (648000/pi au)", 3.0856775814913674e16, 0, "m"],
  ["ly", "iau", "\\mathrm{ly}", "light year (Julian year x c)", 9460730472580800, 0, "m"],
  ["GMsun", "iau", "\\mathcal{GM}_\\odot^\\mathrm{N}", "nominal solar mass parameter", 1.3271244e20, 0, "m^3 s^-2"],
  ["Rsun", "iau", "\\mathcal{R}_\\odot^\\mathrm{N}", "nominal solar radius", 6.957e8, 0, "m"],
  ["Lsun", "iau", "\\mathcal{L}_\\odot^\\mathrm{N}", "nominal solar luminosity", 3.828e26, 0, "W"],
  ["Teffsun", "iau", "\\mathcal{T}_{\\mathrm{eff}\\odot}^\\mathrm{N}", "nominal solar effective temperature", 5772, 0, "K"],
  ["GMearth", "iau", "\\mathcal{GM}_\\oplus^\\mathrm{N}", "nominal terrestrial mass parameter", 3.986004e14, 0, "m^3 s^-2"],
  ["Rearth", "iau", "\\mathcal{R}_{\\mathrm{e}\\oplus}^\\mathrm{N}", "nominal Earth equatorial radius", 6.3781e6, 0, "m"],
];

export const CONST = Object.fromEntries(ROWS.map(([id, grp, tex, name, v, unc, unit]) => [id, { id, grp, tex, name, v, unc, unit }]));

// Chemistry: molar masses from IUPAC standard atomic weights (sums done by
// hand here), balancing of known equations, stoichiometry, dilution, pH
// against closed forms, gas laws against CODATA, decay.
import { formula, molarMass, parseEquation, balance, acidBase, vdwConst } from '../core/chem.js';
import { TOOLS } from '../tools/chem.js';

export default function ({ ok, near, throws }) {
  const A = { H: 1.008, C: 12.011, N: 14.007, O: 15.999, Na: 22.98976928, Cl: 35.45, Cu: 63.546, S: 32.06, P: 30.973762, K: 39.0983, Fe: 55.845, Ca: 40.078 };
  const mm = [
    ['H2O', 2 * A.H + A.O], ['NaCl', A.Na + A.Cl], ['C6H12O6', 6 * A.C + 12 * A.H + 6 * A.O],
    ['CuSO4·5H2O', A.Cu + A.S + 4 * A.O + 5 * (2 * A.H + A.O)], ['CuSO4*5H2O', A.Cu + A.S + 9 * A.O + 10 * A.H],
    ['Ca3(PO4)2', 3 * A.Ca + 2 * (A.P + 4 * A.O)], ['K4[Fe(CN)6]', 4 * A.K + A.Fe + 6 * (A.C + A.N)],
    ['(NH4)2SO4', 2 * (A.N + 4 * A.H) + A.S + 4 * A.O], ['SO4^2-', A.S + 4 * A.O], ['C₂H₅OH', 2 * A.C + 6 * A.H + A.O],
  ];
  const bad = mm.filter(([f, w]) => Math.abs(molarMass(f).M - w) > 1e-9);
  ok(!bad.length, `molar masses match IUPAC standard atomic weights (${mm.length} formulas)`, bad.map(([f, w]) => `${f}: ${molarMass(f).M} vs ${w}`).join(' | '));
  near(molarMass('H2O').M, 18.015, 1e-12, 'H2O = 18.015 g/mol');
  near(molarMass('CuSO4·5H2O').M, 249.677, 1e-12, 'CuSO4·5H2O = 249.677 g/mol');
  ok(formula('SO4^2-').charge === -2 && formula('NH4+').charge === 1 && formula('Fe^3+').charge === 3 && formula('e-').electron, 'charges: SO4^2-, NH4+, Fe^3+, e-');
  ok(molarMass('Tc2O7').noStd.includes('Tc'), 'Tc is flagged: no standard atomic weight');
  throws(() => formula('XyO2'), /not an element/, 'an unknown symbol is an error');
  throws(() => formula('Ca(OH2'), /no matching/, 'an open parenthesis is an error');
  const bal = (s) => balance(parseEquation(s)).join(' ');
  const eqs = [
    ['C3H8 + O2 -> CO2 + H2O', '1 5 3 4'], ['KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2', '2 16 2 2 8 5'],
    ['Fe2O3 + CO -> Fe + CO2', '1 3 2 3'], ['CO2 + H2O -> C6H12O6 + O2', '6 6 1 6'],
    ['Cr2O7^2- + Fe^2+ + H^+ -> Cr^3+ + Fe^3+ + H2O', '1 6 14 2 6 7'], ['MnO4^- + e- + H^+ -> Mn^2+ + H2O', '1 5 8 1 4'],
    ['Cu + HNO3 -> Cu(NO3)2 + NO + H2O', '3 8 3 2 4'], ['C8H18 + O2 -> CO2 + H2O', '2 25 16 18'],
    ['Al + O2 -> Al2O3', '4 3 2'], ['NH3 + O2 -> NO + H2O', '4 5 4 6'],
  ];
  const badEq = eqs.filter(([e, w]) => bal(e) !== w);
  ok(!badEq.length, `balancer: ${eqs.length} known equations (incl. ionic redox)`, badEq.map(([e, w]) => `${e}: ${bal(e)} want ${w}`).join(' | '));
  throws(() => bal('H2O -> CO2'), /cannot be balanced/, 'balancer: mismatched elements');
  throws(() => bal('H2 + O2 -> H2O + H2O2'), /independent/, 'balancer: two independent reactions are reported');
  const st = TOOLS.stoich.run({ eq: '2H2 + O2 -> 2H2O', a: 'H2 = 4 g\nO2 = 40 g' });
  ok(st.rows.find(r => r[0] === 'Limiting reagent')[1] === 'H2', 'stoichiometry: 4 g H2 with 40 g O2: H2 limits');
  near(parseFloat(st.rows.find(r => r[0].startsWith('Theoretical yield'))[1]), 4 / (2 * A.H) * (2 * A.H + A.O), 1e-7, 'stoichiometry: water yield = n(H2) M(H2O)');
  const dl = TOOLS.dilution.run({ c1: '2 M', v1: '', c2: '0.1 M', v2: '250 mL' });
  near(parseFloat(dl.rows[0][1]), 12.5, 1e-12, 'dilution: 2 M to 0.1 M in 250 mL needs 12.5 mL');
  near(parseFloat(TOOLS.dilution.run({ c1: '1 mol/L', v1: '10 mL', c2: '', v2: '1 L' }).rows[0][1]), 0.01, 1e-12, 'dilution: 10 mL of 1 M to 1 L gives 0.01 mol/L');
  // pH: closed forms.
  const Kw = 1e-14;
  near(acidBase({ Ca: 0.1 }).pH, -Math.log10((0.1 + Math.sqrt(0.01 + 4 * Kw)) / 2), 1e-12, 'pH of 0.1 M HCl = 1.0000');
  near(acidBase({ Ca: 1e-8 }).pH, -Math.log10((1e-8 + Math.sqrt(1e-16 + 4 * Kw)) / 2), 1e-10, 'pH of 1e-8 M HCl = 6.9788 (water counts)');
  near(acidBase({ Cb: 0.01 }).pH, 12, 1e-9, 'pH of 0.01 M NaOH = 12');
  const Ka = 10 ** -4.756, C = 0.1;
  // Weak acid: exact cubic h^3 + Ka h^2 - (Ka C + Kw) h - Ka Kw = 0; the quadratic is within 1e-6 here.
  const hq = (-Ka + Math.sqrt(Ka * Ka + 4 * Ka * C)) / 2;
  near(acidBase({ C, pKa: [4.756] }).pH, -Math.log10(hq), 1e-5, `pH of 0.1 M acetic acid = ${(-Math.log10(hq)).toFixed(4)} (quadratic)`);
  const h = 10 ** -acidBase({ C, pKa: [4.756] }).pH;
  near(h ** 3 + Ka * h * h - (Ka * C + Kw) * h - Ka * Kw, 0, 0, 'weak acid [H+] is a root of the exact cubic', 1e-22);
  const buf = acidBase({ C: 0.2, pKa: [4.756], Cb: 0.1 });
  near(buf.pH, 4.756, 2e-3, 'acetate buffer 0.1/0.1 M: pH = pKa (Henderson–Hasselbalch) within 0.01');
  const nh3 = acidBase({ C: 0.1, pKa: [14 - 4.75], z0: 1 });
  const ohq = (-1.778279e-5 + Math.sqrt(1.778279e-5 ** 2 + 4 * 1.778279e-5 * 0.1)) / 2;
  near(nh3.pH, 14 + Math.log10(ohq), 1e-4, `pH of 0.1 M NH3 (pKb 4.75) = ${(14 + Math.log10(ohq)).toFixed(3)}`);
  const ph7 = acidBase({ C: 0.1, pKa: [2.15, 7.20, 12.35], Cb: 0.15 });
  near(ph7.pH, 7.20, 0.01, 'phosphate 0.05/0.05 M H2PO4-/HPO4 2-: pH 7.20');
  // Gases.
  const v = TOOLS.gas.run({ law: 'ideal', gas: 'CO2', P: '101.325 kPa', V: '', n: '1 mol', T: '273.15 K' });
  near(parseFloat(v.rows[0][1]), 22.413969545014137, 1e-9, 'ideal gas: molar volume at 273.15 K, 101.325 kPa = V_m (CODATA)');
  const { a, b } = vdwConst('CO2');
  near(a * 10, 3.6556, 1e-3, 'CO2: a from Tc, Pc = 3.656 L² bar/mol² (CRC lists 3.658)');
  near(b * 1000, 0.042850, 1e-3, 'CO2: b from Tc, Pc = 0.04285 L/mol (CRC lists 0.04286)');
  const P = 8.31446261815324 * 300 / (1e-3 - b) - a / 1e-6;
  const vv = TOOLS.gas.run({ law: 'vdw', gas: 'CO2', P: `${P} Pa`, V: '', n: '1 mol', T: '300 K' });
  near(parseFloat(vv.rows[0][1]), 1, 1e-9, 'van der Waals: solving V gives back 1 L');
  const nn = TOOLS.gas.run({ law: 'vdw', gas: 'CO2', P: `${P} Pa`, V: '1 L', n: '', T: '300 K' });
  near(parseFloat(nn.rows[0][1]), 1, 1e-9, 'van der Waals: solving n gives back 1 mol');
  // Decay.
  near(parseFloat(TOOLS.decay.run({ h: '5730 yr', n0: '100', t: '11460 yr', n: '' }).rows[0][1]), 25, 1e-12, 'two half-lives leave 25 %');
  near(parseFloat(TOOLS.decay.run({ h: '5730 yr', n0: '100', t: '', n: '50' }).rows[0][1]), 5730, 1e-12, 'time to half is one half-life');
  near(parseFloat(TOOLS.decay.run({ h: '', n0: '1000', t: '2 h', n: '250' }).rows[0][1]), 1, 1e-12, 'half-life from 1000 -> 250 in 2 h is 1 h');
}

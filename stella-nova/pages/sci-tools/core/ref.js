// ============================================================================
//  SCIENCE TOOLKIT  ·  core/ref.js  ·  the cheat sheet tables (no DOM)
// ----------------------------------------------------------------------------
//  The "back of the composition book" tables: SI prefixes, acid pKa values,
//  densities and common unit equivalences. The scratchpad (intent.js) reads
//  ACIDS to solve "pH of 0.1 M acetic acid". The cheat sheet (sheet.js)
//  shows every table. Constants come from core/constants.js and elements
//  from core/chem.js, so they are not repeated here.
//
//  Each table has a SRC entry. A value with no measured source is marked
//  "computed": it comes from CODATA constants or the unit table.
//
//  GREP MAP
//    grep -n "export const SRC"       the sources of the tables
//    grep -n "export const PREFIXES"  SI prefixes with their names
//    grep -n "export const ACIDS"     pKa values at 25 °C
//    grep -n "export function acid"   name or formula -> acid row
//    grep -n "export const DENSITY"   densities of common substances
//    grep -n "export function equivalences"  unit equivalences (computed)
// ============================================================================
import { PREFIX, convert, constQty } from './units.js';

export const SRC = {
  si: 'BIPM, The International System of Units (SI Brochure), 9th ed. (2019), and CGPM 2022 Resolution 3 (ronna, quetta, ronto, quecto).',
  pka: 'D. C. Harris, Quantitative Chemical Analysis, 9th ed. (2016), Appendix G (25 °C, ionic strength 0). Compilations differ by a few hundredths.',
  water: 'IAPWS-95: W. Wagner and A. Pruß, J. Phys. Chem. Ref. Data 31, 387 (2002), at 101.325 kPa.',
  crc: 'CRC Handbook of Chemistry and Physics, 97th ed. (2016), §6 and §15 (densities of liquids and solids).',
  sea: 'IOC, SCOR and IAPSO, TEOS-10: The international thermodynamic equation of seawater (2010).',
  air: 'Computed: ideal gas, dry air molar mass 28.96546 g/mol (A. Picard et al., Metrologia 45, 149 (2008), CIPM-2007).',
  elements: "Element densities from this site's Periodic Table data (near room temperature).",
  units: 'Computed from the unit table (NIST SP 811, NIST HB 44) and CODATA 2022 constants.',
};

const PREFIX_NAMES = { Q: 'quetta', R: 'ronna', Y: 'yotta', Z: 'zetta', E: 'exa', P: 'peta', T: 'tera', G: 'giga', M: 'mega', k: 'kilo', h: 'hecto', da: 'deca', d: 'deci', c: 'centi', m: 'milli', 'µ': 'micro', n: 'nano', p: 'pico', f: 'femto', a: 'atto', z: 'zepto', y: 'yocto', r: 'ronto', q: 'quecto' };

// [symbol, name, factor], from the largest to the smallest.
export const PREFIXES = Object.entries(PREFIX_NAMES).map(([s, n]) => [s, n, PREFIX[s]]);

// Acid–base systems. kind: 'strong-acid' and 'strong-base' (fully
// dissociated, n = H+ or OH- per formula unit), 'acid' (weak, all pKa
// values), 'base' (weak base, pKa of the conjugate acid BH+), 'sulfuric'
// (first step strong, then HSO4- with pKa 1.99).
// Row: [name, formula, kind, pKa list or n, other names].
export const ACIDS = [
  ['hydrochloric acid', 'HCl', 'strong-acid', 1, ''],
  ['hydrobromic acid', 'HBr', 'strong-acid', 1, ''],
  ['hydroiodic acid', 'HI', 'strong-acid', 1, ''],
  ['nitric acid', 'HNO3', 'strong-acid', 1, ''],
  ['perchloric acid', 'HClO4', 'strong-acid', 1, ''],
  ['sulfuric acid', 'H2SO4', 'sulfuric', [1.99], ''],
  ['sodium hydroxide', 'NaOH', 'strong-base', 1, 'lye'],
  ['potassium hydroxide', 'KOH', 'strong-base', 1, ''],
  ['lithium hydroxide', 'LiOH', 'strong-base', 1, ''],
  ['calcium hydroxide', 'Ca(OH)2', 'strong-base', 2, 'lime water'],
  ['barium hydroxide', 'Ba(OH)2', 'strong-base', 2, ''],
  ['acetic acid', 'CH3COOH', 'acid', [4.756], 'ethanoic acid, HOAc, AcOH, vinegar'],
  ['formic acid', 'HCOOH', 'acid', [3.745], 'methanoic acid'],
  ['benzoic acid', 'C6H5COOH', 'acid', [4.202], ''],
  ['hydrofluoric acid', 'HF', 'acid', [3.17], ''],
  ['hypochlorous acid', 'HOCl', 'acid', [7.53], 'HClO'],
  ['hydrocyanic acid', 'HCN', 'acid', [9.21], ''],
  ['boric acid', 'H3BO3', 'acid', [9.237], 'B(OH)3'],
  ['carbonic acid', 'H2CO3', 'acid', [6.351, 10.329], 'CO2(aq)'],
  ['oxalic acid', 'H2C2O4', 'acid', [1.25, 4.266], ''],
  ['phosphoric acid', 'H3PO4', 'acid', [2.148, 7.198, 12.375], 'orthophosphoric acid'],
  ['citric acid', 'C6H8O7', 'acid', [3.128, 4.761, 6.396], ''],
  ['ammonia', 'NH3', 'base', [9.245], 'ammonium (pKa of NH4+)'],
  ['methylamine', 'CH3NH2', 'base', [10.645], ''],
  ['pyridine', 'C5H5N', 'base', [5.2], ''],
  ['tris', 'C4H11NO3', 'base', [8.072], 'TRIS, THAM, tris(hydroxymethyl)aminomethane'],
].map(([name, formula, kind, p, alt]) => ({ name, formula, kind, pKa: Array.isArray(p) ? p : [], n: Array.isArray(p) ? 1 : p, alt }));

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9()]+/g, ' ').trim();

// Name, other name or formula -> acid row, or null. A formula must match
// with its case ("HCl"); a name matches with or without "acid".
export function acid(text) {
  const t = String(text).trim();
  if (!t) return null;
  const byF = ACIDS.find(a => a.formula === t || a.alt.split(/,\s*/).includes(t));
  if (byF) return byF;
  const n = norm(t), bare = n.replace(/ acid$/, '');
  return ACIDS.find(a => {
    const names = [a.name, ...a.alt.split(/,\s*/)].map(norm);
    return names.some(x => x === n || x.replace(/ acid$/, '') === bare);
  }) || null;
}

// Densities in g/cm³ (= g/mL = kg/L). Row: [substance, value, condition, source key].
export const DENSITY = [
  ['water', 0.99997, '4 °C', 'water'],
  ['water', 0.99821, '20 °C', 'water'],
  ['water', 0.99705, '25 °C', 'water'],
  ['ice', 0.9167, '0 °C', 'crc'],
  ['seawater', 1.0248, 'S = 35, 20 °C', 'sea'],
  ['ethanol', 0.7893, '20 °C', 'crc'],
  ['methanol', 0.7914, '20 °C', 'crc'],
  ['glycerol', 1.2613, '20 °C', 'crc'],
  ['mercury', 13.5336, '25 °C', 'crc'],
  ['dry air', 1.2041e-3, '20 °C, 101.325 kPa', 'air'],
];

// Metals to take from the element data, in this order.
export const DENSITY_ELEMENTS = ['Al', 'Ti', 'Fe', 'Ni', 'Cu', 'Zn', 'Ag', 'Pb', 'Au', 'Pt'];

// Molar mass of dry air (kg/mol) for the computed air density.
export const M_AIR = 0.02896546;

// Common unit equivalences, computed from the unit table so they match the
// converter exactly. Row: [left text, right value, right unit].
export function equivalences() {
  const pairs = [
    ['1 in', 'cm'], ['1 ft', 'm'], ['1 mi', 'km'], ['1 nmi', 'km'], ['1 Å', 'nm'], ['1 au', 'km'], ['1 ly', 'pc'],
    ['1 lb', 'kg'], ['1 oz', 'g'], ['1 Da', 'kg'], ['1 gal', 'L'],
    ['1 atm', 'kPa'], ['1 atm', 'Torr'], ['1 bar', 'psi'], ['1 mmHg', 'Pa'],
    ['1 cal', 'J'], ['1 eV', 'J'], ['1 kWh', 'MJ'], ['1 Btu', 'kJ'], ['1 hp', 'W'],
    ['1 mph', 'm/s'], ['1 kn', 'km/h'], ['1 T', 'G'],
  ];
  const rows = pairs.map(([a, b]) => [a, convert(a, b), b]);
  // Energy scales at 25 °C, from CODATA constants.
  const kB = constQty('kB').v, NA = constQty('NA').v, qe = constQty('qe').v, F = constQty('F').v, R = constQty('R').v, h = constQty('h').v, c = constQty('c').v;
  rows.push(['1 eV', qe * NA / 1000, 'kJ/mol'], ['1 kcal/mol', 4.184, 'kJ/mol'], ['1 cm⁻¹', h * c * 100 / qe * 1000, 'meV']);
  rows.push(['kT at 25 °C', kB * 298.15 / qe * 1000, 'meV'], ['RT at 25 °C', R * 298.15 / 1000, 'kJ/mol'], ['ln10·RT/F at 25 °C', Math.LN10 * R * 298.15 / F * 1000, 'mV']);
  return rows;
}

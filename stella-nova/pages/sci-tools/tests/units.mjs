// Units and constants: conversions against defined values (NIST SP 811,
// NIST HB 44), round trips, dimension errors, CODATA 2022 spot values.
import { convert, qty, dimText, named } from '../core/units.js';
import { CONST } from '../core/constants.js';
import { count, round, sci, eng, roundUnc } from '../core/sigfig.js';
import { TOOLS } from '../tools/units.js';

export default function ({ ok, near, throws }) {
  const cases = [
    ['1 in', 'cm', 2.54], ['1 ft', 'm', 0.3048], ['1 mi', 'km', 1.609344], ['1 lb', 'kg', 0.45359237],
    ['1 lbf', 'N', 4.4482216152605], ['1 psi', 'Pa', 6894.757293168361], ['1 atm', 'Torr', 760], ['1 atm', 'bar', 1.01325],
    ['1 cal', 'J', 4.184], ['1 kcal', 'kJ', 4.184], ['1 eV', 'J', 1.602176634e-19], ['1 kWh', 'MJ', 3.6],
    ['1 L*atm', 'J', 101.325], ['1 kg*m/s^2', 'N', 1], ['1 kg m^2 s^-2', 'J', 1], ['1 J/(mol K)', 'cal/(mol degC)', 1 / 4.184],
    ['60 mph', 'km/h', 96.56064], ['1 kn', 'm/s', 1852 / 3600], ['1 au', 'km', 149597870.7], ['1 ly', 'm', 9460730472580800],
    ['1 pc', 'au', 206264.80624709636], ['1 Å', 'nm', 0.1], ['1 µm', 'm', 1e-6], ['1 μm', 'nm', 1000], ['1 mM', 'mol/m^3', 1],
    ['1 hp', 'W', 745.69987158227022], ['1 Btu', 'J', 1055.05585262], ['1 gal', 'L', 3.785411784], ['1 ha', 'm^2', 1e4],
    ['1 T', 'G', 1e4], ['1 W', 'J/s', 1], ['1 V*A', 'W', 1], ['1 ohm', 'V/A', 1], ['1 F*V', 'C', 1], ['1 Wb', 'T m^2', 1],
    ['1 H', 'Wb/A', 1], ['1 S', '1/ohm', 1], ['1 Hz', '1/s', 1], ['90 deg', 'rad', Math.PI / 2], ['1 cP', 'Pa s', 1e-3],
    ['3 m²', 'cm^2', 30000], ['2 s⁻¹', 'Hz', 2], ['5 kg·m/s²', 'N', 5], ['1 yr', 'd', 365.25], ['1 Ma', 'yr', 1e6],
    ['0 degC', 'degF', 32], ['-40 degC', 'degF', -40], ['100 degF', 'K', 310.92777777777775], ['300 K', 'degC', 26.85],
    ['491.67 degR', 'degC', 0], ['25 °C', 'K', 298.15], ['1 $me $c^2', 'MeV', 0.51099895069], ['1 $h $c / (500 nm)', 'eV', 2.4796839686640024],
    ['1 $kB * 300 K', 'meV', 8.617333262145179e-5 * 300 * 1000],
  ];
  let bad = [];
  for (const [q, to, want] of cases) {
    const got = convert(q, to);
    if (!(Math.abs(got - want) <= 1e-9 * Math.max(1e-12, Math.abs(want)) || Math.abs(got - want) < 1e-12)) bad.push(`${q} -> ${to}: ${got} (want ${want})`);
  }
  ok(!bad.length, `unit conversions match defined values (${cases.length})`, bad.slice(0, 3).join(' | '));
  // Round trips.
  bad = [];
  for (const [a, b] of [['m', 'ft'], ['kg', 'lb'], ['Pa', 'psi'], ['J', 'Btu'], ['degC', 'degF'], ['K', 'degR'], ['W', 'hp'], ['m/s', 'kn'], ['eV', 'kJ/mol*mol']]) {
    for (const x of [1, 0.1234, 987.6, -3.5]) {
      if (a === 'eV') continue;
      const y = convert(`${x} ${a}`, b), z = convert(`${y} ${b}`, a);
      if (Math.abs(z - x) > 1e-12 * Math.max(1, Math.abs(x))) bad.push(`${x} ${a} -> ${b} -> ${z}`);
    }
  }
  ok(!bad.length, 'round trips return the start value (36)', bad.join(' | '));
  throws(() => convert('5 kg', 'm'), /Cannot convert M \[kg\] to L \[m\]/, 'dimension error: kg to m');
  throws(() => convert('1 N', 'J'), /Cannot convert/, 'dimension error: N to J');
  throws(() => convert('1 m + 1 s', 'm'), /Cannot add L and T/, 'dimension error: adding length and time');
  throws(() => convert('1 furlong', 'm'), /Unknown unit "furlong"/, 'unknown unit is named');
  throws(() => qty('sin(1 m)'), /no dimension/, 'sin() of a length is an error');
  ok(dimText(qty('1 N').d) === 'kg m s^-2', 'N in base units is "kg m s^-2"');
  ok(named(qty('kg m^2 s^-3 A^-1').d) === 'V', 'kg m^2 s^-3 A^-1 is named V');
  ok(convert('1 min', 's') === 60 && convert('1 cd', 'cd') === 1 && convert('1 Gy', 'J/kg') === 1, 'exact symbols win over prefixes (min, cd, Gy)');
  ok(convert('1 J/mol K', 'J/(mol*K)') === 1, 'juxtaposition binds tighter than "/" (J/mol K)');
  // CODATA 2022 spot values (NIST, May 2024).
  near(CONST.alpha.v, 7.2973525643e-3, 0, 'CODATA 2022 alpha = 7.2973525643(11)e-3');
  ok(CONST.alpha.unc === 1.1e-12, 'CODATA 2022 alpha uncertainty 1.1e-12');
  near(CONST.me.v, 9.1093837139e-31, 0, 'CODATA 2022 m_e = 9.1093837139(28)e-31 kg');
  near(CONST.mp.v, 1.67262192595e-27, 0, 'CODATA 2022 m_p = 1.67262192595(52)e-27 kg');
  near(CONST.G.v, 6.67430e-11, 0, 'CODATA 2022 G = 6.67430(15)e-11');
  near(CONST.mu0.v, 1.25663706127e-6, 0, 'CODATA 2022 mu_0 = 1.25663706127(20)e-6 N A^-2');
  near(CONST.Rinf.v, 10973731.568157, 0, 'CODATA 2022 R_inf = 10973731.568157(12) m^-1');
  ok(CONST.h.v === 6.62607015e-34 && CONST.h.unc === 0 && CONST.c.v === 299792458 && CONST.NA.v === 6.02214076e23 && CONST.kB.v === 1.380649e-23 && CONST.qe.v === 1.602176634e-19, 'SI defining constants are exact');
  near(CONST.hbar.v, 6.62607015e-34 / (2 * Math.PI), 1e-15, 'hbar = h / 2 pi');
  near(CONST.R.v, 6.02214076e23 * 1.380649e-23, 1e-15, 'R = N_A k');
  near(CONST.sigma.v, 2 * Math.PI ** 5 * 1.380649e-23 ** 4 / (15 * 6.62607015e-34 ** 3 * 299792458 ** 2), 1e-14, 'sigma = 2 pi^5 k^4 / (15 h^3 c^2)');
  // Significant figures.
  const sf = [['0.0045600', 5], ['1.20e3', 3], ['100.', 3], ['0.0', 1], ['602.214076e21', 9], ['1.00', 3], ['7', 1]];
  ok(sf.every(([x, n]) => count(x).n === n), 'sig-fig counts (0.0045600 -> 5, 1.20e3 -> 3, 100. -> 3, ...)', sf.map(([x]) => `${x}:${count(x).n}`).join(' '));
  const c12 = count('1200');
  ok(c12.ambiguous && c12.min === 2 && c12.max === 4, '"1200" is ambiguous: 2 to 4 figures');
  ok(round(2.5, 3) === '2.50' && round(0.00123456, 3) === '0.00123' && round(123456, 2) === '120000' && round(9.996, 3) === '10.0', 'rounding keeps trailing zeros (2.50, 0.00123, 10.0)');
  ok(sci(6.02214076e23, 4).m === '6.022' && sci(6.02214076e23, 4).e === 23, 'scientific notation 6.022 x 10^23');
  const e1 = eng(12345, 3), e2 = eng(0.00047, 2);
  ok(e1.m === '12.3' && e1.e === 3 && e2.m === '470' && e2.e === -6, 'engineering notation 12.3e3 and 470e-6', `${e1.m}e${e1.e} ${e2.m}e${e2.e}`);
  const u1 = roundUnc(9.81234, 0.0237), u2 = roundUnc(1.23456, 0.0456), u3 = roundUnc(5.0123, 0.0987);
  ok(u1.x === '9.812' && u1.u === '0.024' && u2.x === '1.23' && u2.u === '0.05' && u3.x === '5.01' && u3.u === '0.10', 'PDG rounding: 9.812 ± 0.024, 1.23 ± 0.05, 5.01 ± 0.10', `${u1.x}±${u1.u} ${u2.x}±${u2.u} ${u3.x}±${u3.u}`);
  // Cross table.
  const sc = TOOLS.scales.run({ x: '1', u: 'eV' }).rows;
  const g = (lab) => Number(sc.find(r => r[0].startsWith(lab))[1]);
  near(g('wavenumber'), 8065.543937, 1e-9, '1 eV = 8065.543937 cm^-1 (NIST energy equivalents)');
  near(g('temperature'), 11604.51812, 1e-9, '1 eV = 11604.51812 K');
  near(g('frequency'), 241.7989242, 1e-9, '1 eV = 241.7989242 THz');
  near(g('molar energy (kJ'), 96.48533212, 1e-9, '1 eV = 96.48533212 kJ/mol');
  near(g('hartree'), 0.03674932217565499, 1e-9, '1 eV = 0.036749322176 E_h');
  near(g('wavelength'), 1239.841984, 1e-9, '1 eV photon = 1239.841984 nm');
  const tc = TOOLS.scales.run({ x: '-40', u: 'C' }).rows;
  ok(Math.abs(Number(tc.find(r => r[0].startsWith('Fahrenheit'))[1]) + 40) < 1e-9, 'cross table: -40 °C = -40 °F');
}

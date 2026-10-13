// Scratchpad lines (intent.js): each line goes through the intent layer
// and its number is checked against a value made another way: closed
// forms, defined unit factors, CODATA, IUPAC sums, and the SciPy fixtures.
import { evalLine, evalNotebook, newEnv, suggest, toolByName, nice, prettyUnit, EXAMPLES, STARTER, DEFS } from '../intent.js';
import { acidBase } from '../core/chem.js';
import { ACIDS, acid, DENSITY, M_AIR, equivalences } from '../core/ref.js';
import { TOOLS } from '../registry.js';

export default function ({ ok, near, FIX }) {
  const A = { H: 1.008, C: 12.011, N: 14.007, O: 15.999, Na: 22.98976928, Cl: 35.45, Cu: 63.546, S: 32.06, K: 39.0983, Fe: 55.845 };
  const hc_eV = 2.4796839686640024;            // 1 $h $c / (500 nm) in eV, tests/units.mjs
  const g = 9.80665, R = 8.31446261815324, kB = 1.380649e-23, qe = 1.602176634e-19;
  const Ka = 10 ** -4.756, hq = (-Ka + Math.sqrt(Ka * Ka + 4 * Ka * 0.1)) / 2;
  const Kb = 10 ** -(14 - 9.245), ohq = (-Kb + Math.sqrt(Kb * Kb + 4 * Kb * 0.1)) / 2;
  const { A: SA, B: SB } = FIX.data;

  // [line, expected value, unit or null, relative tolerance]. The lines run
  // in one notebook, so variables and "ans" carry down.
  const cases = [
    ['500 nm photon in eV', hc_eV, 'eV', 1e-12],
    ['h*c/500 nm in eV', hc_eV, 'eV', 1e-12],
    ['molar mass CuSO4·5H2O', A.Cu + A.S + 4 * A.O + 5 * (2 * A.H + A.O), 'g/mol', 1e-12],
    ['molar mass K4[Fe(CN)6]', 4 * A.K + A.Fe + 6 * (A.C + A.N), 'g/mol', 1e-12],
    ['NaCl', A.Na + A.Cl, 'g/mol', 1e-12],
    ['10 g NaCl in mol', 10 / (A.Na + A.Cl), 'mol', 1e-12],
    ['0.25 mol CuSO4·5H2O in g', 0.25 * (A.Cu + A.S + 9 * A.O + 10 * A.H), 'g', 1e-12],
    ['dilute 2 M HCl to 0.5 M, 50 mL', 12.5, 'mL', 1e-12],
    ['dilute 10 mL of 1 M to 1 L', 0.01, 'M', 1e-12],
    ['pH of 0.1 M acetic acid', -Math.log10(hq), '', 1e-5],
    ['pH of 0.1 M HCl', -Math.log10((0.1 + Math.sqrt(0.01 + 4e-14)) / 2), '', 1e-12],
    ['pH of 0.01 M NaOH', 12, '', 1e-9],
    ['pH of 0.1 M ammonia', 14 + Math.log10(ohq), '', 1e-4],
    ['3 ft to m', 0.9144, 'm', 1e-12],
    ['12 in to cm', 30.48, 'cm', 1e-12],
    ['37 degC to degF', 98.6, '°F', 1e-12],
    ['1 atm in psi', 101325 / 6894.757293168361, 'psi', 1e-12],
    ['60 mph in km/h', 96.56064, 'km/h', 1e-12],
    ['9.81 m/s^2 * 2 s', 19.62, 'm/s', 1e-12],
    ['0.5 * 1200 kg * (27 m/s)^2', 437.4, 'kJ', 1e-12],
    ['sqrt(2 * 9.81 m/s^2 * 10 m) in km/h', Math.sqrt(196.2) * 3.6, 'km/h', 1e-12],
    ['R * 298.15 K in kJ/mol', R * 298.15 / 1000, 'kJ/mol', 1e-12],
    ['kB * 300 K in meV', 8.617333262145179e-5 * 300 * 1000, 'meV', 1e-12],
    ['G * 5.972e24 kg / (6371 km)^2', 6.6743e-11 * 5.972e24 / 6371000 ** 2, 'm/s²', 1e-12],
    ['c', 299792458, 'm/s', 0],
    ['2 h in min', 120, 'min', 1e-12],
    ['100 J/h in W', 100 / 3600, 'W', 1e-12],
    ['x = 3 mm', 3, 'mm', 0],
    ['pi x^2 in mm^2', 9 * Math.PI, 'mm²', 1e-12],
    ['x * 2', 6, 'mm', 1e-12],
    ['ans in cm', 0.6, 'cm', 1e-12],
    ['M = molar mass NaCl', A.Na + A.Cl, 'g/mol', 1e-12],
    ['5.844 g / M in mmol', 5.844 / (A.Na + A.Cl) * 1000, 'mmol', 1e-12],
    ['ideal gas 1 mol, 0 degC, 1 atm', 22.413969545014137, 'L', 1e-9],
    ['half-life 5730 yr after 10000 yr', 100 * 2 ** (-10000 / 5730), '%', 1e-7],
    ['half-life 5730 yr 23.5 % left', 5730 * Math.log2(100 / 23.5), 'yr', 1e-7],
    ['half-life 1000 to 250 in 2 h', 1, 'h', 1e-12],
    ['mean 5.1 4.9 6.2 5.8 6.0', 5.6, '', 1e-12],
    ['sd 2, 4, 4, 4, 5, 5, 7, 9', Math.sqrt(32 / 7), '', 1e-12],
    [`t-test ${SA.join(' ')} vs ${SB.join(' ')}`, FIX.twelch.p, '', 1e-3],
    ['pendulum 1 m', 2 * Math.PI * Math.sqrt(1 / g), 's', 1e-7],
    ['spring 50 N/m 0.5 kg', 2 * Math.PI * Math.sqrt(0.5 / 50), 's', 1e-7],
    ['projectile 20 m/s 45 deg', 400 / g, 'm', 1e-7],
    ['blackbody 5772 K', 0.0028977719551851727 / 5772 * 1e9, 'nm', 1e-7],
    ['lorentz 0.6c', 1.25, '', 1e-12],
    ['parallel 100 220 470', 1 / (1 / 100 + 1 / 220 + 1 / 470), 'Ω', 1e-5],
    ['yellow violet red gold', 4700, 'Ω', 1e-12],
    ['percent error 9.72 vs 9.80665', 100 * (9.72 - 9.80665) / 9.80665, '%', 1e-5],
    ['round 0.0045600 to 2 sig figs', 0.0046, '', 0],
    ['integrate exp(-x^2) from -inf to inf', Math.sqrt(Math.PI), '', 1e-10],
    ['solve x^3 - 2x - 5 = 0', 2.0945514815423265, '', 1e-12],
    ['jd 2000-01-01 12:00', 2451545, '', 0],
  ];
  const res = evalNotebook(cases.map(c => c[0]));
  const bad = [];
  cases.forEach(([line, want, unit, rtol], i) => {
    const r = res[i];
    const good = r && (r.kind === 'value' || r.kind === 'assign') && Math.abs(r.value - want) <= rtol * Math.abs(want) + 1e-15 && (unit === null || r.unit === unit);
    if (!good) bad.push(`"${line}": got ${r && (r.kind === 'error' ? r.error : `${r.value} ${r.unit}`)}, want ${want} ${unit}`);
  });
  ok(!bad.length, `scratchpad: ${cases.length} lines give the expected numbers`, bad.slice(0, 4).join(' | '));
  ok(cases.length >= 30, 'scratchpad: at least 30 numeric example lines');

  // Answers as text.
  const t = (line) => evalLine(line, newEnv());
  ok(t('500 nm photon in eV').answer === '2.4797 eV' && /E = hc\/λ/.test(t('500 nm photon in eV').method), 'photon line: "= 2.4797 eV" with the method E = hc/λ');
  ok(t('dilute 2 M HCl to 0.5 M, 50 mL').answer === 'take 12.5 mL, add 37.5 mL', 'dilution line: "take 12.5 mL, add 37.5 mL"');
  ok(t('molar mass CuSO4·5H2O').answer === '249.68 g/mol', 'molar mass line: "249.68 g/mol"');
  ok(t('balance C3H8 + O2 -> CO2 + H2O').answer === 'C3H8 + 5 O2 → 3 CO2 + 4 H2O', 'balance line gives the balanced equation');
  ok(t('Fe + O2 -> Fe2O3').answer === '4 Fe + 3 O2 → 2 Fe2O3', 'an arrow alone means balance');
  ok(t('255 in hex').answer === '0xFF' && t('0b1010 in dec').answer === '10', 'number bases: 255 in hex, 0b1010 in dec');
  ok(nice(2.4796839686640024) === '2.4797' && nice(101325) === '101325' && nice(12.5) === '12.5' && nice(3.97e-19) === '3.97e-19', 'nice(): 5 figures, whole integers, e-notation for small values');
  ok(prettyUnit('m s^-2') === 'm/s²' && prettyUnit('J mol^-1 K^-1') === 'J/(mol·K)' && prettyUnit('mm^2') === 'mm²', 'prettyUnit(): m/s², J/(mol·K), mm²');

  // Constants and units with the same name.
  ok(/Planck/.test(t('h').method) && t('2 h in min').value === 120 && !/Planck/.test(t('2 h in min').method || ''), '"h" alone is Planck; "2 h" is hours');
  ok(t('1 L*atm to J').method === '' && Math.abs(t('1 L*atm to J').value - 101.325) < 1e-9, '"atm" stays a unit (same size as the constant)');

  // Forms, tools and errors: no dead ends.
  const f = t('dilute 2 M to 0.5 M');
  ok(f.kind === 'form' && f.tool === 'dilution' && f.vals.c1 === '2 M' && f.vals.c2 === '0.5 M', 'a dilution with one value missing opens the form with the values filled');
  const ph = t('pH of 0.1 M foo');
  ok(ph.kind === 'form' && ph.tool === 'ph' && /pKa/.test(ph.note), 'an unknown acid opens the pH form and asks for a pKa');
  ok(t('t-test').kind === 'form' && t('t-test').tool === 'ttest' && t('open fft').tool === 'fft' && t('gas laws').tool === 'gas', 'a tool name alone opens that tool inline');
  const allNamed = TOOLS.filter(x => toolByName(x.name) !== x.id);
  ok(!allNamed.length, `every tool (${TOOLS.length}) opens by its name`, allNamed.map(x => x.name).join(', '));
  const e = t('foo bar');
  ok(e.kind === 'error' && /foo/.test(e.error), 'an unreadable line is an error with a message');
  ok(t('# a note').kind === 'note' && t('   ').kind === 'blank', 'notes and blank lines');
  ok(t('ans = 3').kind === 'error', '"ans" cannot be assigned');

  // Inline forms: the tool and values a line gives must run in the tool.
  const formErr = [];
  const starterEnv = newEnv();
  for (const [line, env] of [...EXAMPLES.map(l => [l, newEnv()]), ...STARTER.map(l => [l, starterEnv])]) {
    const r = evalLine(line, env);
    if (r.kind === 'error') { formErr.push(`${line}: ${r.error}`); continue; }
    if (r.tool) { try { DEFS[r.tool].run(r.vals ? { ...Object.fromEntries(DEFS[r.tool].inputs.map(i => [i.k, i.def ?? ''])), ...r.vals } : {}); } catch (err) { if (r.kind !== 'form') formErr.push(`${line} -> ${r.tool}: ${err.message}`); } }
  }
  ok(!formErr.length, `every example and starter line reads, and its tool runs with the line's values (${EXAMPLES.length + STARTER.length})`, formErr.slice(0, 3).join(' | '));
  const exVar = evalNotebook(['x = 3 mm', 'pi x^2']);
  ok(exVar[1].vals.vars === 'x = 0.003 m', 'the full method of a line with a variable passes the variable to the calculator');

  // Suggestions.
  const s = suggest('dil');
  ok(s.length && s[0].text.startsWith('dilute'), 'suggest("dil") starts with a dilution example');
  ok(suggest('molar').some(x => x.tool === 'molar-mass'), 'suggest("molar") lists the molar mass tool');
  ok(suggest('').length === 0, 'suggest("") is empty');

  // Reference tables.
  ok(ACIDS.every(a => a.kind.startsWith('strong') || a.pKa.length), 'every weak acid or base row has pKa values');
  ok(acid('acetic acid').pKa[0] === 4.756 && acid('HCl').kind === 'strong-acid' && acid('vinegar').formula === 'CH3COOH', 'acid lookup by name, formula and other name');
  ok(Math.abs(acidBase({ C: 0.1, pKa: acid('acetic acid').pKa }).pH - -Math.log10(hq)) < 1e-5, 'acetic acid pKa from the table gives the textbook pH');
  const air = DENSITY.find(r => r[0] === 'dry air')[1];
  near(air, 101325 * M_AIR / (R * 293.15) / 1000, 1e-4, 'dry-air density row = PM/(RT) at 20 °C, 101.325 kPa');
  const eq = equivalences();
  near(eq.find(r => r[0] === 'kT at 25 °C')[1], kB * 298.15 / qe * 1000, 1e-12, 'kT at 25 °C = 25.693 meV (CODATA)');
  near(eq.find(r => r[0] === '1 in')[1], 2.54, 1e-12, '1 in = 2.54 cm (defined)');
}

// ============================================================================
//  SCIENCE TOOLKIT  ·  tools/units.js  ·  units and constants
// ----------------------------------------------------------------------------
//  Tool definitions for the "units" category. No DOM: main.js draws the
//  inputs, calls run() with the input values and shows what run() gives.
//
//  A tool: { inputs, run(values), tex: [TeX], how: text, refs: [text],
//            examples: [{ label, v }] }
//  run() returns { rows: [[label, value text, note]], html, svg, copy } or
//  throws an Error with a message for the reader.
//
//  GREP MAP
//    grep -n "'unit-convert'"  the converter
//    grep -n "constants:"      the CODATA table
//    grep -n "'sig-figs'"      significant figures
//    grep -n "scales:"         the cross table
// ============================================================================
import { qty, convert, dimText, dimName, named, UNITS, dimEq, constQty } from '../core/units.js';
import { ROWS, GROUPS } from '../core/constants.js';
import { count, round, sci, eng, roundUnc } from '../core/sigfig.js';
import { fmt, esc, num } from '../kit.js';

const SI_REFS = [
  'BIPM, The International System of Units (SI Brochure), 9th edition, 2019.',
  'NIST Special Publication 811, Guide for the Use of the International System of Units, 2008 edition.',
  'NIST Handbook 44 (2024), Appendix C: General Tables of Units of Measurement (US customary units).',
];

export const TOOLS = {
  'unit-convert': {
    inputs: [
      { k: 'q', label: 'Quantity', def: '9.80665 m/s^2', w: 2, hint: 'value and unit, for example 3 kg*m/s^2 or 25 degC' },
      { k: 'to', label: 'Convert to', def: 'ft/s^2', hint: 'empty for SI' },
    ],
    examples: [
      { label: 'force', v: { q: '3 kg*m/s^2', to: 'N' } },
      { label: 'energy', v: { q: '1 kWh', to: 'MJ' } },
      { label: 'temperature', v: { q: '37 degC', to: 'degF' } },
      { label: 'pressure', v: { q: '1 atm', to: 'psi' } },
      { label: 'speed', v: { q: '60 mph', to: 'km/h' } },
      { label: 'heat capacity', v: { q: '4.184 J/(g K)', to: 'cal/(g degC)' } },
      { label: 'wrong dimension', v: { q: '5 kg', to: 'm' }, err: true },
    ],
    run({ q, to }) {
      const Q = qty(q);
      const rows = [];
      if (to.trim()) {
        const x = convert(q, to);
        rows.push(['Result', `${fmt(x, 10)} ${to.trim()}`]);
      }
      const nm = named(Q.d);
      rows.push(['In SI base units', `${fmt(Q.v, 10)} ${dimText(Q.d)}`]);
      if (nm && nm !== dimText(Q.d)) rows.push(['As a named SI unit', `${fmt(Q.v, 10)} ${nm}`]);
      rows.push(['Dimension', dimName(Q.d)]);
      if (Q.temp && !to.trim()) rows.push(['Note', 'A lone temperature unit converts with its offset (absolute temperature).']);
      // The same quantity in every listed unit of the same dimension.
      const same = Object.keys(UNITS).filter(u => /^[A-Za-z]/.test(u) && dimEq(UNITS[u][1], Q.d) && !UNITS[u][3] && u !== 'l' && u !== 'gauss' && u !== 'angstrom');
      let html = '';
      if (same.length > 1 && !Q.temp) {
        html = `<h4>Same quantity in other units</h4><table class="t"><tbody>${same.map(u => `<tr><td class="num">${esc(fmt(Q.v / UNITS[u][0], 8))}</td><td>${esc(u)}</td></tr>`).join('')}</tbody></table>`;
      }
      return { rows, html, copy: rows[0][1] };
    },
    tex: [
      'x_\\text{to} = x_\\text{from}\\,\\frac{f_\\text{from}}{f_\\text{to}}',
      '\\dim Q = \\mathsf{L}^{a}\\,\\mathsf{M}^{b}\\,\\mathsf{T}^{c}\\,\\mathsf{I}^{d}\\,\\Theta^{e}\\,\\mathsf{N}^{f}\\,\\mathsf{J}^{g}',
      'T_\\mathrm{K} = (x + o)\\,f \\quad (o = 273.15 \\text{ for } {}^\\circ\\mathrm{C},\\; 459.67 \\text{ for } {}^\\circ\\mathrm{F})',
    ],
    how: 'Each unit has a factor f to SI and a dimension vector. A compound unit multiplies the factors and adds the exponents. The conversion is allowed only when both dimension vectors are equal. Juxtaposition binds tighter than "/", so "J/mol K" is J/(mol K). Constants go in with $, for example "$me $c^2" to MeV.',
    refs: SI_REFS,
  },

  constants: {
    inputs: [{ k: 'f', label: 'Search', def: '', w: 3, hint: 'name, symbol or id, for example planck, mass, magneton' }],
    run({ f }) {
      const w = f.toLowerCase().split(/\s+/).filter(Boolean);
      const hit = ROWS.filter(r => w.every(x => (r[0] + ' ' + r[3] + ' ' + r[6] + ' ' + GROUPS[r[1]]).toLowerCase().includes(x)));
      if (!hit.length) throw new Error('No constant matches the search.');
      let html = '<table class="t const"><thead><tr><th>Quantity</th><th>Symbol</th><th>Value</th><th>Uncertainty</th><th>Unit</th><th>Id</th><th></th></tr></thead><tbody>';
      let grp = null;
      for (const [id, g, tex, name, v, unc, unit] of hit) {
        if (g !== grp) { grp = g; html += `<tr class="grp"><td colspan="7">${esc(GROUPS[g])}</td></tr>`; }
        const rel = unc ? fmt(unc / Math.abs(v), 2) : '';
        html += `<tr><td>${esc(name)}</td><td><span class="sci-sym" data-tex="${esc(tex)}" data-inline></span></td><td class="num">${esc(String(v))}</td>` +
          `<td class="num">${unc ? esc(String(unc)) + ` <span class="dim">(${rel} rel.)</span>` : '<span class="dim">exact</span>'}</td><td>${esc(unit)}</td><td class="dim">$${esc(id)}</td>` +
          `<td><button class="mini" data-copy="${esc(String(v))}" aria-label="Copy ${esc(name)}">copy</button></td></tr>`;
      }
      html += '</tbody></table>';
      const copy = hit.map(r => `${r[3]}\t${r[4]}\t${r[5]}\t${r[6]}`).join('\n');
      return { rows: [['Constants shown', String(hit.length)]], html, copy };
    },
    tex: ['u_r(x) = \\frac{u(x)}{|x|}', 'h = 6.626\\,070\\,15\\times10^{-34}\\ \\mathrm{J\\,s}\\quad(\\text{exact since 2019})'],
    how: 'Values are the CODATA 2022 recommended values. An exact value has no uncertainty: since the 2019 SI revision h, e, k, N_A and c are fixed numbers, and R, F, σ and the radiation constants follow from them. The astronomical rows are IAU conventional values. Use the id in the calculator, for example $hbar.',
    refs: [
      'E. Tiesinga, P. J. Mohr, D. B. Newell, B. N. Taylor and others, CODATA Recommended Values of the Fundamental Physical Constants: 2022, NIST (2024). physics.nist.gov/constants.',
      'IAU 2012 Resolution B2 (astronomical unit); IAU 2015 Resolution B3 (nominal solar and planetary values).',
    ],
  },

  'sig-figs': {
    inputs: [
      { k: 'x', label: 'Number', def: '0.0045600', hint: 'as written, for example 1200, 1.20e3, 0.0450' },
      { k: 'n', label: 'Round to (figures)', def: '3' },
      { k: 'u', label: 'Uncertainty (optional)', def: '', hint: 'rounds the value with it' },
      { k: 'rule', label: 'Uncertainty rule', type: 'select', def: 'pdg', opts: [['pdg', 'PDG rule'], ['1', '1 figure'], ['2', '2 figures']] },
    ],
    examples: [
      { label: 'trailing zeros', v: { x: '1200', n: '2' } },
      { label: 'Avogadro', v: { x: '602214076000000000000000', n: '4' } },
      { label: 'with uncertainty', v: { x: '9.81234', n: '3', u: '0.0237', rule: 'pdg' } },
    ],
    run({ x, n, u, rule }) {
      const c = count(x), v = num(x), N = Math.round(num(n));
      const rows = [];
      rows.push(['Significant figures in the input', c.ambiguous ? `${c.min} to ${c.max} (trailing zeros of an integer are ambiguous)` : String(c.n)]);
      const r = round(v, N);
      rows.push([`Rounded to ${N}`, r]);
      const s = sci(v, N), e = eng(v, N);
      rows.push(['Scientific notation', `${s.m} × 10^${s.e}`]);
      rows.push(['Engineering notation', `${e.m} × 10^${e.e}`]);
      rows.push(['E-notation', `${s.m}e${s.e}`]);
      if (u && u.trim()) {
        const ru = roundUnc(v, num(u), rule);
        rows.push(['Value with uncertainty', `${ru.x} ± ${ru.u}`, rule === 'pdg' ? `PDG rule: ${ru.figs} figure${ru.figs > 1 ? 's' : ''} in the uncertainty` : '']);
      }
      return { rows, copy: r };
    },
    tex: ['x = m \\times 10^{n},\\quad 1 \\le |m| < 10', 'x = m \\times 10^{3k},\\quad 1 \\le |m| < 1000'],
    how: 'Leading zeros are never significant. Zeros between digits are. Trailing zeros are significant when the number has a decimal point; in an integer such as 1200 they are ambiguous, so write 1.20e3. Rounding is half away from zero on the decimal value. With an uncertainty, the PDG rule keeps two figures when its three leading digits are 100 to 354, one figure for 355 to 949, and rounds 950 to 999 up to two figures; the value is rounded to the same decimal place.',
    refs: ['Particle Data Group, Review of Particle Physics, Introduction §5.3 (rounding).', 'JCGM 100:2008 (GUM), §7.2.6: report the uncertainty with at most two significant digits.'],
  },

  scales: {
    inputs: [
      { k: 'x', label: 'Value', def: '1' },
      { k: 'u', label: 'Unit', type: 'select', def: 'eV', opts: [] },
    ],
    run({ x, u }) {
      const v = num(x);
      const scale = SCALE_OF[u];
      if (!scale) throw new Error('Choose a unit.');
      const base = scale.to(v, u);
      const rows = scale.units.map(([k, label]) => [label, fmt(scale.from(base, k), 10), k === u ? 'input' : '']);
      return { rows, copy: rows.map(r => `${r[0]}\t${r[1]}`).join('\n') };
    },
    tex: [
      'E = h\\nu = hc\\tilde\\nu = \\frac{hc}{\\lambda} = k_\\mathrm{B}T = \\frac{E_\\text{molar}}{N_\\mathrm{A}}',
      'T_\\mathrm{K} = T_{{}^\\circ\\mathrm{C}} + 273.15 = \\tfrac59\\,(T_{{}^\\circ\\mathrm{F}} + 459.67)',
      '1\\ \\mathrm{atm} = 101\\,325\\ \\mathrm{Pa},\\quad 1\\ \\mathrm{Torr} = \\tfrac{101\\,325}{760}\\ \\mathrm{Pa}',
    ],
    how: 'Temperature converts with offsets. Pressure converts with factors. Energy is per particle: a frequency, a wavenumber, a wavelength or a temperature is the energy hν, hcν̃, hc/λ or k_B T, and a molar energy is divided by N_A. Constants are CODATA 2022.',
    refs: ['CODATA 2022 (NIST). Energy equivalents table: physics.nist.gov/cuu/Constants/energy.html.', 'NIST SP 811 (2008), Appendix B.8 and B.9.'],
  },
};

// ── cross table scales ──────────────────────────────────────────────────────
const K = (id) => constQty(id).v;
const TEMP = {
  units: [['K', 'kelvin (K)'], ['C', 'Celsius (°C)'], ['F', 'Fahrenheit (°F)'], ['R', 'Rankine (°R)']],
  to: (v, u) => ({ K: v, C: v + 273.15, F: (v + 459.67) * 5 / 9, R: v * 5 / 9 })[u],
  from: (k, u) => ({ K: k, C: k - 273.15, F: k * 9 / 5 - 459.67, R: k * 9 / 5 })[u],
};
const PU = [['Pa', 'pascal (Pa)', 1], ['kPa', 'kilopascal (kPa)', 1e3], ['MPa', 'megapascal (MPa)', 1e6], ['bar', 'bar', 1e5], ['mbar', 'millibar (hPa)', 100],
  ['atm', 'standard atmosphere (atm)', 101325], ['Torr', 'torr', 101325 / 760], ['mmHg', 'mm of mercury (conventional)', 133.322387415], ['inHg', 'inch of mercury (conventional)', 3386.389], ['psi', 'pound per square inch (psi)', UNITS.psi[0]]];
const PRES = {
  units: PU.map(([k, l]) => [k, l]),
  to: (v, u) => v * PU.find(p => p[0] === u)[2],
  from: (b, u) => b / PU.find(p => p[0] === u)[2],
};
const EU = () => [
  ['J', 'joule (J)', 1], ['eV', 'electronvolt (eV)', K('qe')], ['meV', 'millielectronvolt (meV)', K('qe') / 1000],
  ['cm-1', 'wavenumber (cm⁻¹)', K('h') * K('c') * 100], ['THz', 'frequency (THz)', K('h') * 1e12], ['Kel', 'temperature (K)', K('kB')],
  ['kJmol', 'molar energy (kJ/mol)', 1000 / K('NA')], ['kcalmol', 'molar energy (kcal/mol)', 4184 / K('NA')],
  ['Eh', 'hartree (E_h)', K('Eh')], ['Ry', 'rydberg (Ry)', K('Eh') / 2], ['nm', 'wavelength (nm)', null],
];
const ENER = {
  get units() { return EU().map(([k, l]) => [k, l]); },
  to: (v, u) => { const e = EU().find(p => p[0] === u); return e[2] == null ? K('h') * K('c') / (v * 1e-9) : v * e[2]; },
  from: (b, u) => { const e = EU().find(p => p[0] === u); return e[2] == null ? K('h') * K('c') / b * 1e9 : b / e[2]; },
};
const SCALE_OF = {};
for (const [k] of TEMP.units) SCALE_OF[k] = TEMP;
for (const [k] of PRES.units) SCALE_OF[k] = PRES;
for (const [k] of ENER.units) SCALE_OF[k] = ENER;
TOOLS.scales.inputs[1].opts = [
  ...TEMP.units.map(([k, l]) => [k, 'Temperature: ' + l]),
  ...PRES.units.map(([k, l]) => [k, 'Pressure: ' + l]),
  ...ENER.units.map(([k, l]) => [k, 'Energy: ' + l]),
];

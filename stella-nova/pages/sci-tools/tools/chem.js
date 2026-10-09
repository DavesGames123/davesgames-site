// ============================================================================
//  SCIENCE TOOLKIT  ·  tools/chem.js  ·  chemistry
// ----------------------------------------------------------------------------
//  Tool definitions for the "chem" category (contract: tools/units.js).
//  The maths is in core/chem.js; amounts with units go through
//  core/units.js, so "4 g", "0.25 mol", "250 mL" and "0.1 M" all work.
//
//  GREP MAP
//    grep -n "'molar-mass':"  "stoich:"  "balance:"  "dilution:"
//    grep -n "solution:"      "ph:"      "gas:"      "decay:"
// ============================================================================
import { formula, molarMass, parseEquation, balance, equationText, acidBase, GASES, vdwConst } from '../core/chem.js';
import { qty, dimEq, dimName, convert, constQty } from '../core/units.js';
import { brent } from '../core/numeric.js';
import { fmt, esc, num, plot, linspace } from '../kit.js';

const IUPAC = 'IUPAC Commission on Isotopic Abundances and Atomic Weights, Standard atomic weights (2021), Pure Appl. Chem. 94, 573 (2022); masses from this site\'s Periodic Table data.';
const R = () => constQty('R').v;
const D = (o) => { const d = [0, 0, 0, 0, 0, 0, 0]; for (const [k, v] of Object.entries(o)) d[['m', 'kg', 's', 'A', 'K', 'mol', 'cd'].indexOf(k)] = v; return d; };
const DIM = { mass: D({ kg: 1 }), amount: D({ mol: 1 }), volume: D({ m: 3 }), molar: D({ mol: 1, m: -3 }), massConc: D({ kg: 1, m: -3 }), pressure: D({ kg: 1, m: -1, s: -2 }), temp: D({ K: 1 }), time: D({ s: 1 }) };
const isDim = (q, d) => dimEq(q.d, DIM[d]);
const blank = (s) => !String(s ?? '').trim();
const unitOf = (s) => String(s).trim().replace(/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*/, '');

// Amount in mol from "4 g" (needs M) or "0.5 mol".
function moles(text, M, what) {
  const q = qty(text);
  if (isDim(q, 'amount')) return q.v;
  if (isDim(q, 'mass')) return q.v * 1000 / M;
  throw new Error(`${what}: give a mass (g, kg) or an amount (mol), not ${dimName(q.d)}.`);
}

export const TOOLS = {
  'molar-mass': {
    inputs: [
      { k: 'f', label: 'Formula', def: 'CuSO4·5H2O', w: 2, hint: 'parentheses, [ ], hydrates with · or *, charges as ^2-' },
      { k: 'm', label: 'Mass or amount (optional)', def: '10 g', hint: 'converts between mass, moles and particles' },
    ],
    examples: [
      { label: 'glucose', v: { f: 'C6H12O6', m: '1 g' } },
      { label: 'calcium phosphate', v: { f: 'Ca3(PO4)2', m: '' } },
      { label: 'potassium ferrocyanide', v: { f: 'K4[Fe(CN)6]', m: '0.25 mol' } },
      { label: 'not an element', v: { f: 'XyO2', m: '' }, err: true },
    ],
    run({ f, m }) {
      const r = molarMass(f);
      const rows = [['Molar mass', `${fmt(r.M, 8)} g/mol`]];
      if (r.charge) rows.push(['Charge', (r.charge > 0 ? '+' : '−') + Math.abs(r.charge), 'electron mass not included']);
      if (r.noStd.length) rows.push(['Note', `${r.noStd.join(', ')} has no standard atomic weight; the mass of its longest-lived isotope is used.`]);
      if (!blank(m)) {
        const q = qty(m);
        const NA = constQty('NA').v;
        if (isDim(q, 'mass')) { const n = q.v * 1000 / r.M; rows.push(['Amount', `${fmt(n, 8)} mol`], ['Particles', fmt(n * NA, 8)]); }
        else if (isDim(q, 'amount')) rows.push(['Mass', `${fmt(q.v * r.M, 8)} g`], ['Particles', fmt(q.v * NA, 8)]);
        else throw new Error(`Give a mass or an amount, not ${dimName(q.d)}.`);
      }
      const html = `<h4>Composition by mass</h4><table class="t"><thead><tr><th>Element</th><th>Atoms</th><th>Atomic weight</th><th>Mass</th><th>Mass %</th></tr></thead><tbody>${r.parts.map(p =>
        `<tr><td>${esc(p.el)} <span class="dim">${esc(p.name)}</span></td><td class="num">${p.n}</td><td class="num">${p.mass}</td><td class="num">${fmt(p.sub, 8)}</td><td class="num">${(100 * p.frac).toFixed(3)}</td></tr>`).join('')}</tbody></table>`;
      return { rows, html, copy: fmt(r.M, 8) };
    },
    tex: ['M = \\sum_i n_i\\,A_r(\\mathrm{E}_i)\\ \\mathrm{g\\,mol^{-1}},\\qquad w_i = \\frac{n_i A_r(\\mathrm{E}_i)}{M}', 'n = \\frac{m}{M},\\qquad N = n\\,N_\\mathrm{A}'],
    how: 'The parser expands parentheses and brackets, multiplies counts, and adds hydrate parts after · or *. The atomic weights are the IUPAC standard values; for elements with an interval (H, C, N, O, ...) these are the conventional values. A single trailing + or − is a charge of one; write larger charges with ^, as in SO4^2-.',
    refs: [IUPAC, 'IUPAC, Quantities, Units and Symbols in Physical Chemistry (Green Book), 3rd ed. (2007), §2.10.'],
  },

  balance: {
    inputs: [{ k: 'eq', label: 'Equation (coefficients optional)', def: 'KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2', w: 3, hint: 'separate species with " + " (spaces); ions as Fe^3+, e- for an electron' }],
    examples: [
      { label: 'propane combustion', v: { eq: 'C3H8 + O2 -> CO2 + H2O' } },
      { label: 'ionic redox', v: { eq: 'Cr2O7^2- + Fe^2+ + H^+ -> Cr^3+ + Fe^3+ + H2O' } },
      { label: 'photosynthesis', v: { eq: 'CO2 + H2O -> C6H12O6 + O2' } },
      { label: 'impossible', v: { eq: 'H2O -> CO2' }, err: true },
    ],
    run({ eq }) {
      const E = parseEquation(eq), c = balance(E);
      const text = equationText(E, c);
      const species = [...E.left, ...E.right];
      const els = [...new Set(species.flatMap(s => Object.keys(s.f.counts)))];
      const count = (from, to) => (el) => species.slice(from, to).reduce((s, sp, i) => s + c[from + i] * (sp.f.counts[el] || 0), 0);
      const L = count(0, E.left.length), Rt = count(E.left.length, species.length);
      const html = `<h4>Check: atoms on each side</h4><table class="t"><thead><tr><th>Element</th><th>Left</th><th>Right</th></tr></thead><tbody>${els.map(el => `<tr><td>${esc(el)}</td><td class="num">${L(el)}</td><td class="num">${Rt(el)}</td></tr>`).join('')}</tbody></table>`;
      const given = species.every(s => s.coef != null);
      const rows = [['Balanced', text]];
      if (given) {
        const k = species[0].coef / c[0];
        rows.push(['Your coefficients', species.every((s, i) => Math.abs(s.coef - k * c[i]) < 1e-9) ? 'balanced (a multiple of the result)' : 'not balanced']);
      }
      return { rows, html, copy: text };
    },
    tex: ['A\\,\\boldsymbol\\nu = \\mathbf 0,\\qquad A_{ej} = \\pm\\,n_{e}(\\text{species } j)', '\\boldsymbol\\nu \\in \\ker A,\\quad \\dim\\ker A = 1,\\quad \\nu_j > 0'],
    how: 'Each element (and the charge, when there are ions) gives one row of a matrix A, with the counts of the reactants as positive and of the products as negative. The coefficients span the null space of A, found by exact Gauss–Jordan elimination on fractions, then scaled to the smallest whole numbers. No null space means the sides cannot match; a null space of dimension 2 or more means the equation mixes independent reactions.',
    refs: ['R. Thorne, An Algebraic Approach to Balancing Chemical Equations, arXiv:1110.4321 (2011).', 'G. Strang, Introduction to Linear Algebra, 5th ed. (2016), §3.2 (null space).'],
  },

  stoich: {
    inputs: [
      { k: 'eq', label: 'Equation', def: '2H2 + O2 -> 2H2O', w: 3 },
      { k: 'a', label: 'Reactant amounts, one per line', type: 'area', rows: 3, def: 'H2 = 4 g\nO2 = 40 g', hint: 'mass or moles: H2 = 4 g, O2 = 1.2 mol' },
    ],
    examples: [
      { label: 'Haber process', v: { eq: 'N2 + H2 -> NH3', a: 'N2 = 28 kg\nH2 = 5 kg' } },
      { label: 'thermite', v: { eq: 'Fe2O3 + Al -> Al2O3 + Fe', a: 'Fe2O3 = 100 g\nAl = 30 g' } },
    ],
    run({ eq, a }) {
      const E = parseEquation(eq), c = balance(E);
      const species = [...E.left, ...E.right];
      const M = species.map(s => molarMass(s.f).M);
      const given = {};
      for (const line of String(a).split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
        const m = /^(.+?)\s*[=:]\s*(.+)$/.exec(line);
        if (!m) throw new Error(`Cannot read "${line}". Write: H2 = 4 g`);
        const j = E.left.findIndex(s => s.text === m[1].trim());
        if (j < 0) throw new Error(`"${m[1].trim()}" is not a reactant of this equation.`);
        given[j] = moles(m[2], M[j], m[1].trim());
      }
      const keys = Object.keys(given).map(Number);
      if (!keys.length) throw new Error('Give the amount of at least one reactant.');
      const ext = Math.min(...keys.map(j => given[j] / c[j]));
      const lim = keys.filter(j => Math.abs(given[j] / c[j] - ext) <= 1e-12 * ext).map(j => E.left[j].text);
      const rows = [['Balanced', equationText(E, c)], ['Limiting reagent', lim.join(', '), keys.length < E.left.length ? 'reactants with no amount are taken to be in excess' : ''], ['Extent of reaction ξ', `${fmt(ext, 8)} mol`]];
      let html = '<h4>Amounts</h4><table class="t"><thead><tr><th>Species</th><th>M (g/mol)</th><th>Start (mol)</th><th>Used or made (mol)</th><th>End (mol)</th><th>End (g)</th></tr></thead><tbody>';
      species.forEach((s, j) => {
        const left = j < E.left.length;
        const start = left ? given[j] : 0, change = c[j] * ext;
        const end = left ? (start == null ? null : start - change) : change;
        html += `<tr><td>${esc(s.text)}</td><td class="num">${fmt(M[j], 7)}</td><td class="num">${start == null ? 'excess' : fmt(start, 6)}</td><td class="num">${left ? '−' : '+'}${fmt(change, 6)}</td><td class="num">${end == null ? '—' : fmt(Math.abs(end) < 1e-12 * change ? 0 : end, 6)}</td><td class="num">${end == null ? '—' : fmt(Math.abs(end) < 1e-12 * change ? 0 : end * M[j], 6)}</td></tr>`;
        if (!left) rows.push([`Theoretical yield of ${s.text}`, `${fmt(change * M[j], 7)} g`, `${fmt(change, 7)} mol`]);
      });
      html += '</tbody></table>';
      return { rows, html, copy: rows.slice(3).map(r => `${r[0]}\t${r[1]}`).join('\n') };
    },
    tex: ['\\xi = \\min_j \\frac{n_j^{0}}{\\nu_j}\\quad\\text{(reactants)},\\qquad n_j = n_j^{0} \\mp \\nu_j\\,\\xi', 'm_\\text{product} = \\nu_\\text{p}\\,\\xi\\,M_\\text{p}'],
    how: 'The equation is balanced first (the same method as the balancer). Each given reactant converts to moles; the extent of reaction ξ is the smallest n/ν, and the reactant that sets it is limiting. Products form ν ξ; the other reactants keep what is left.',
    refs: ['IUPAC Green Book (2007), §2.10.1 (extent of reaction).', IUPAC],
  },

  dilution: {
    inputs: [
      { k: 'c1', label: 'C₁ (stock)', def: '2 M' }, { k: 'v1', label: 'V₁', def: '' },
      { k: 'c2', label: 'C₂ (final)', def: '0.1 M' }, { k: 'v2', label: 'V₂', def: '250 mL' },
    ],
    examples: [
      { label: 'final concentration', v: { c1: '1 mol/L', v1: '10 mL', c2: '', v2: '1 L' } },
      { label: 'percent solution', v: { c1: '70 %', v1: '', c2: '25 %', v2: '500 mL' } },
      { label: 'g/L stock', v: { c1: '50 g/L', v1: '5 mL', c2: '', v2: '200 mL' } },
    ],
    run({ c1, v1, c2, v2 }) {
      const vals = { c1, v1, c2, v2 };
      const empty = Object.keys(vals).filter(k => blank(vals[k]));
      if (empty.length !== 1) throw new Error('Leave exactly one of the four fields empty: that is the one to solve for.');
      const Q = Object.fromEntries(Object.entries(vals).filter(([, v]) => !blank(v)).map(([k, v]) => [k, qty(v)]));
      const cs = ['c1', 'c2'].filter(k => Q[k]), vs = ['v1', 'v2'].filter(k => Q[k]);
      if (cs.length === 2 && !dimEq(Q.c1.d, Q.c2.d)) throw new Error('C₁ and C₂ need the same kind of unit.');
      for (const k of vs) if (!isDim(Q[k], 'volume')) throw new Error(`${k.toUpperCase()} must be a volume.`);
      const x = empty[0];
      let v, unit;
      if (x === 'v1') { v = Q.c2.v * Q.v2.v / Q.c1.v; unit = unitOf(v2) || 'L'; v = convert(`${v} m^3`, unit); }
      else if (x === 'v2') { v = Q.c1.v * Q.v1.v / Q.c2.v; unit = unitOf(v1) || 'L'; v = convert(`${v} m^3`, unit); }
      else if (x === 'c2') { v = Q.c1.v * Q.v1.v / Q.v2.v; unit = unitOf(c1); v = v / qty('1 ' + (unit || '1')).v; }
      else { v = Q.c2.v * Q.v2.v / Q.v1.v; unit = unitOf(c2); v = v / qty('1 ' + (unit || '1')).v; }
      const rows = [[x.toUpperCase().replace('1', '₁').replace('2', '₂'), `${fmt(v, 8)} ${unit}`.trim()]];
      if (x === 'v1') {
        const add = convert(`${Q.v2.v - qty(`${v} ${unit}`).v} m^3`, unit);
        rows.push(['Solvent to add', `${fmt(add, 8)} ${unit}`, 'V₂ − V₁ (volumes taken as additive)']);
        if (add < 0) throw new Error('The final concentration is above the stock: a dilution cannot do that.');
      }
      return { rows, copy: rows[0][1] };
    },
    tex: ['C_1 V_1 = C_2 V_2'],
    how: 'The amount (or mass) of solute is the same before and after the dilution. Any concentration unit works if C₁ and C₂ use the same kind (mol/L, mM, g/L, %), and the volumes can be in different units. The volume of solvent to add assumes the volumes add, which is close for dilute water solutions.',
    refs: ['D. C. Harris, Quantitative Chemical Analysis, 9th ed. (2016), §1-3.'],
  },

  solution: {
    inputs: [
      { k: 'f', label: 'Solute formula', def: 'NaCl' },
      { k: 'm', label: 'Solute mass or amount', def: '5.844 g' },
      { k: 'v', label: 'Solution volume', def: '100 mL' },
      { k: 'ms', label: 'Solvent mass (for molality)', def: '' },
      { k: 'rho', label: 'Solution density (optional)', def: '1.04 g/mL', hint: 'gives the solvent mass when it is empty' },
      { k: 'sv', label: 'Solvent formula', def: 'H2O' },
    ],
    examples: [{ label: '1 molal glucose', v: { f: 'C6H12O6', m: '180.156 g', v: '1.11 L', ms: '1 kg', rho: '', sv: 'H2O' } }],
    run({ f, m, v, ms, rho, sv }) {
      const M = molarMass(f).M, n = moles(m, M, 'Solute'), mass = n * M / 1000;
      const V = qty(v);
      if (!isDim(V, 'volume')) throw new Error('The solution volume must be a volume.');
      let mSolv = null, mSoln = null;
      if (!blank(rho)) { const d = qty(rho); if (!isDim(d, 'massConc')) throw new Error('The density must be a mass per volume, for example 1.04 g/mL.'); mSoln = d.v * V.v; }
      if (!blank(ms)) { const q = qty(ms); if (!isDim(q, 'mass')) throw new Error('The solvent mass must be a mass.'); mSolv = q.v; if (mSoln == null) mSoln = mSolv + mass; }
      else if (mSoln != null) mSolv = mSoln - mass;
      const rows = [['Molarity c', `${fmt(n / (V.v * 1000), 8)} mol/L`], ['Mass concentration', `${fmt(mass / V.v, 8)} g/L`]];
      if (mSolv != null) {
        if (mSolv <= 0) throw new Error('The solution mass is less than the solute mass. Check the density.');
        rows.push(['Molality b', `${fmt(n / mSolv, 8)} mol/kg`]);
        rows.push(['Mass fraction w', `${fmt(100 * mass / mSoln, 8)} %`]);
        rows.push(['Mass ppm (mg/kg)', fmt(1e6 * mass / mSoln, 8)]);
        const Ms = molarMass(sv).M, ns = mSolv * 1000 / Ms;
        rows.push(['Mole fraction x (solute)', fmt(n / (n + ns), 8), `solvent ${sv}, M = ${fmt(Ms, 6)} g/mol`]);
      } else rows.push(['Note', 'Add the solvent mass or the solution density for molality, mass fraction, ppm and mole fraction.']);
      rows.push(['Amount of solute', `${fmt(n, 8)} mol`]);
      return { rows, copy: rows[0][1] };
    },
    tex: ['c = \\frac{n}{V_\\text{soln}},\\quad b = \\frac{n}{m_\\text{solvent}},\\quad w = \\frac{m_\\text{solute}}{m_\\text{soln}},\\quad x = \\frac{n}{n + n_\\text{solvent}}', 'm_\\text{soln} = \\rho V_\\text{soln},\\qquad \\text{ppm} = 10^6\\,w'],
    how: 'The solute amount comes from its mass and molar mass. Molality, mass fraction and mole fraction need the solvent mass: give it, or give the solution density, from which the solvent mass is ρV minus the solute mass. ppm here is by mass (mg/kg).',
    refs: ['IUPAC Green Book (2007), §2.10 (amount concentration, molality, mass fraction).', IUPAC],
  },

  ph: {
    inputs: [
      { k: 'mode', label: 'System', type: 'select', def: 'weak', opts: [['strong-acid', 'Strong acid'], ['strong-base', 'Strong base'], ['weak', 'Weak acid (pKa values)'], ['weak-base', 'Weak base (pKb)'], ['buffer', 'Buffer HA / A⁻'], ['mix', 'Acid system + strong base (titration point)']] },
      { k: 'c', label: 'Concentration C (mol/L)', def: '0.1', hint: 'acid or base; HA in a buffer' },
      { k: 'pk', label: 'pKa (or pKb for a weak base)', def: '4.756', hint: 'polyprotic: 2.15, 7.20, 12.35' },
      { k: 'cb', label: 'C of A⁻ (buffer) or added strong base (mol/L)', def: '0.1' },
      { k: 'kw', label: 'pKw', def: '14.00', hint: '14.00 at 25 °C' },
    ],
    examples: [
      { label: '0.1 M HCl', v: { mode: 'strong-acid', c: '0.1' } },
      { label: '1e-8 M HCl', v: { mode: 'strong-acid', c: '1e-8' } },
      { label: 'acetate buffer', v: { mode: 'buffer', c: '0.1', pk: '4.756', cb: '0.1' } },
      { label: 'ammonia 0.1 M', v: { mode: 'weak-base', c: '0.1', pk: '4.75' } },
      { label: 'phosphate pH 7.2', v: { mode: 'mix', c: '0.1', pk: '2.15, 7.20, 12.35', cb: '0.15' } },
    ],
    run({ mode, c, pk, cb, kw }) {
      const C = num(c), pKw = num(kw), Kw = 10 ** -pKw;
      if (!(C >= 0)) throw new Error('C must be 0 or more.');
      const pKa = String(pk).split(/[,;\s]+/).filter(Boolean).map(num);
      let r, note = '';
      if (mode === 'strong-acid') r = acidBase({ Ca: C, Kw });
      else if (mode === 'strong-base') r = acidBase({ Cb: C, Kw });
      else if (mode === 'weak') r = acidBase({ C, pKa, Kw });
      else if (mode === 'weak-base') { r = acidBase({ C, pKa: [pKw - pKa[0]], z0: 1, Kw }); note = `pKa of BH⁺ = pKw − pKb = ${fmt(pKw - pKa[0], 5)}`; }
      else if (mode === 'buffer') {
        const Cb = num(cb);
        r = acidBase({ C: C + Cb, pKa: [pKa[0]], Cb, Kw });
        note = `Henderson–Hasselbalch: pH = pKa + log([A⁻]/[HA]) = ${fmt(pKa[0] + Math.log10(Cb / C), 6)}`;
      } else r = acidBase({ C, pKa, Cb: num(cb), Kw });
      const rows = [['pH', r.pH.toFixed(4)], ['pOH', r.pOH.toFixed(4)], ['[H⁺]', `${fmt(r.h, 6)} mol/L`], ['[OH⁻]', `${fmt(r.oh, 6)} mol/L`]];
      if (note) rows.push(['Check', note]);
      let html = '';
      if (r.alpha.length) {
        const n = r.alpha.length - 1, z0 = mode === 'weak-base' ? 1 : 0;
        const name = (j) => mode === 'weak-base' ? (j === 0 ? 'BH⁺' : 'B') : `H${n - j > 1 ? n - j : n - j === 1 ? '' : '₀'}A${j ? (j > 1 ? j : '') + '⁻' : ''}`.replace('H₀', '');
        html = `<h4>Species fractions</h4><table class="t"><thead><tr><th>Species</th><th>Charge</th><th>Fraction</th></tr></thead><tbody>${r.alpha.map((a, j) => `<tr><td>${esc(name(j))}</td><td class="num">${z0 - j}</td><td class="num">${fmt(a, 6)}</td></tr>`).join('')}</tbody></table>`;
        const Kas = mode === 'weak-base' ? [pKw - pKa[0]] : pKa;
        const ps = linspace(0, 14, 281);
        const series = Kas.concat([0]).map((_, j) => ({ x: ps, y: ps.map(p => { const h = 10 ** -p, K = Kas.map(q => 10 ** -q); let prod = 1; const t = []; for (let i = 0; i <= K.length; i++) { t.push(h ** (K.length - i) * prod); if (i < K.length) prod *= K[i]; } const s = t.reduce((a, b) => a + b, 0); return t[j] / s; }), name: name(j) }));
        return { rows, html, svg: plot(series, { xlabel: 'pH', ylabel: 'fraction', yr: [0, 1.02], vlines: [{ x: r.pH }], title: 'Species against pH (yellow: this solution)' }), copy: rows[0][1] };
      }
      return { rows, html, copy: rows[0][1] };
    },
    tex: [
      '[\\mathrm H^+] + \\sum_j z_j\\,C\\,\\alpha_j + C_\\text{base} = [\\mathrm{OH^-}] + C_\\text{acid},\\qquad [\\mathrm{OH^-}] = K_w/[\\mathrm H^+]',
      '\\alpha_j = \\frac{[\\mathrm H^+]^{n-j}\\prod_{i\\le j}K_{a,i}}{\\sum_{k=0}^{n}[\\mathrm H^+]^{n-k}\\prod_{i\\le k}K_{a,i}}',
      '\\mathrm{pH} = \\mathrm{p}K_a + \\log_{10}\\frac{[\\mathrm{A^-}]}{[\\mathrm{HA}]}',
    ],
    how: 'The tool solves the full charge balance for [H⁺] (Brent on pH), with water autoionization, so very dilute acids come out right (10⁻⁸ M HCl gives pH 6.98, not 8). A polyprotic acid takes all its pKa values. A buffer is the acid system with the salt cation as a strong base; the Henderson–Hasselbalch value is shown as a check. Concentrations are used as activities (no Debye–Hückel correction), which is good below about 0.01 M ionic strength and approximate above.',
    refs: ['D. C. Harris, Quantitative Chemical Analysis, 9th ed. (2016), ch. 8-11.', 'W. Stumm and J. J. Morgan, Aquatic Chemistry, 3rd ed. (1996), ch. 3.'],
  },

  gas: {
    inputs: [
      { k: 'law', label: 'Equation of state', type: 'select', def: 'ideal', opts: [['ideal', 'Ideal gas'], ['vdw', 'van der Waals']] },
      { k: 'gas', label: 'Gas (van der Waals)', type: 'select', def: 'CO2', opts: Object.entries(GASES).map(([k, g]) => [k, `${k} (${g[0]})`]) },
      { k: 'P', label: 'Pressure P', def: '' }, { k: 'V', label: 'Volume V', def: '22.4 L' },
      { k: 'n', label: 'Amount n', def: '1 mol' }, { k: 'T', label: 'Temperature T', def: '273.15 K' },
    ],
    examples: [
      { label: 'molar volume at STP', v: { law: 'ideal', P: '101.325 kPa', V: '', n: '1 mol', T: '0 degC' } },
      { label: 'CO2 in a 1 L flask', v: { law: 'vdw', gas: 'CO2', P: '', V: '1 L', n: '1 mol', T: '300 K' } },
      { label: 'tyre: amount of air', v: { law: 'ideal', P: '220 kPa', V: '25 L', n: '', T: '20 degC' } },
    ],
    run({ law, gas, P, V, n, T }) {
      const vals = { P, V, n, T };
      const empty = Object.keys(vals).filter(k => blank(vals[k]));
      if (empty.length !== 1) throw new Error('Leave exactly one of P, V, n and T empty: that is the one to solve for.');
      const want = { P: 'pressure', V: 'volume', n: 'amount', T: 'temp' };
      const q = {};
      for (const k of Object.keys(vals)) if (!blank(vals[k])) {
        const Q = qty(vals[k]);
        if (!isDim(Q, want[k])) throw new Error(`${k} has the wrong dimension (${dimName(Q.d)}).`);
        q[k] = Q.v;
      }
      const Rg = R(), x = empty[0];
      let a = 0, b = 0;
      if (law === 'vdw') ({ a, b } = vdwConst(gas));
      const Pof = (V, n, T) => n * Rg * T / (V - n * b) - a * n * n / (V * V);
      let v, unit, note = '';
      if (x === 'P') { v = Pof(q.V, q.n, q.T); unit = 'kPa'; }
      else if (x === 'T') { v = (q.P + a * q.n ** 2 / q.V ** 2) * (q.V - q.n * b) / (q.n * Rg); unit = 'K'; }
      else if (x === 'V') {
        if (law === 'ideal') v = q.n * Rg * q.T / q.P;
        else {
          const f = (V) => Pof(V, q.n, q.T) - q.P, lo = q.n * b * (1 + 1e-9);
          // Scan for every root (up to three); the largest is the gas.
          const hi = Math.max(10 * q.n * Rg * q.T / q.P, lo * 100);
          const grid = linspace(Math.log(lo), Math.log(hi), 2000).map(Math.exp);
          const roots = [];
          for (let i = 1; i < grid.length; i++) if (f(grid[i - 1]) * f(grid[i]) < 0) roots.push(brent(f, grid[i - 1], grid[i]).x);
          if (!roots.length) throw new Error('No volume gives that pressure at this temperature.');
          v = roots[roots.length - 1];
          if (roots.length > 1) note = `${roots.length} real roots (below the critical point): the largest is the gas, the smallest the liquid (${fmt(roots[0] * 1000, 6)} L).`;
        }
        unit = 'L';
      } else {
        if (law === 'ideal') v = q.P * q.V / (Rg * q.T);
        else v = brent((nn) => Pof(q.V, nn, q.T) - q.P, 1e-15, q.V / b * (1 - 1e-9)).x;
        unit = 'mol';
      }
      const shown = unit === 'kPa' ? v / 1000 : unit === 'L' ? v * 1000 : v;
      const rows = [[x, `${fmt(shown, 10)} ${unit}`]];
      if (x === 'T') rows.push(['T in °C', `${fmt(v - 273.15, 8)} °C`]);
      if (x === 'P') rows.push(['P in atm', `${fmt(v / 101325, 8)} atm`], ['P in bar', `${fmt(v / 1e5, 8)} bar`]);
      if (law === 'vdw') {
        const all = { ...q, [x]: v };
        rows.push(['Compressibility Z = PV/nRT', fmt(all.P * all.V / (all.n * Rg * all.T), 6)]);
        rows.push(['a, b', `${fmt(a * 10, 5)} L²·bar/mol², ${fmt(b * 1000, 5)} L/mol`, `from T_c = ${vdwConst(gas).Tc} K, P_c = ${GASES[gas][2]} MPa`]);
      }
      if (note) rows.push(['Note', note]);
      return { rows, copy: rows[0][1] };
    },
    tex: ['PV = nRT', '\\Big(P + \\frac{a n^2}{V^2}\\Big)(V - nb) = nRT,\\qquad a = \\frac{27R^2T_c^2}{64P_c},\\quad b = \\frac{RT_c}{8P_c}'],
    how: 'Leave one of P, V, n, T empty. The van der Waals a and b come from the critical temperature and pressure of each gas (NIST Chemistry WebBook), which makes the equation exact at the critical point. P and T solve directly; V and n are roots of a cubic, found by a scan and Brent. Below the critical temperature V can have three roots: the largest is the gas.',
    refs: ['CODATA 2022: R = 8.314 462 618... J mol⁻¹ K⁻¹ (exact).', 'P. Atkins and J. de Paula, Physical Chemistry, 11th ed. (2018), §1C.', 'NIST Chemistry WebBook, SRD 69, webbook.nist.gov (critical constants).'],
  },

  decay: {
    inputs: [
      { k: 'h', label: 'Half-life T½', def: '5730 yr', hint: 'empty to solve for it' },
      { k: 'n0', label: 'Initial amount N₀', def: '100', hint: 'any unit: g, mol, Bq, % ...' },
      { k: 't', label: 'Elapsed time t', def: '10000 yr', hint: 'empty to solve for it' },
      { k: 'n', label: 'Remaining N', def: '', hint: 'empty to solve for it' },
    ],
    examples: [
      { label: 'carbon-14 dating', v: { h: '5730 yr', n0: '100', t: '', n: '23.5' } },
      { label: 'iodine-131 after 30 d', v: { h: '8.0252 d', n0: '1 GBq', t: '30 d', n: '' } },
      { label: 'measure a half-life', v: { h: '', n0: '1000', t: '2 h', n: '250' } },
    ],
    run({ h, n0, t, n }) {
      const vals = { h, t, n };
      const empty = Object.keys(vals).filter(k => blank(vals[k]));
      if (empty.length !== 1) throw new Error('Leave exactly one of T½, t and N empty.');
      const N0 = qty(n0);
      const tq = (s, what) => { const q = qty(s); if (!isDim(q, 'time')) throw new Error(`${what} must be a time.`); return q.v; };
      const amount = (s) => { const q = qty(s); if (!dimEq(q.d, N0.d)) throw new Error('N and N₀ need the same kind of unit.'); return q.v; };
      const tUnit = unitOf(blank(h) ? t : h) || 's';
      let T, tt, N;
      if (empty[0] === 'n') { T = tq(h, 'T½'); tt = tq(t, 't'); N = N0.v * 2 ** (-tt / T); }
      else if (empty[0] === 't') { T = tq(h, 'T½'); N = amount(n); if (!(N > 0 && N <= N0.v)) throw new Error('N must be greater than 0 and not more than N₀.'); tt = T * Math.log2(N0.v / N); }
      else { tt = tq(t, 't'); N = amount(n); if (!(N > 0 && N < N0.v)) throw new Error('N must be between 0 and N₀.'); T = tt / Math.log2(N0.v / N); }
      const inU = (s) => convert(`${s} s`, tUnit);
      const nUnit = unitOf(n0);
      const scaleN = nUnit ? qty('1 ' + nUnit).v : 1;
      const lam = Math.LN2 / T;
      const rows = [];
      if (empty[0] === 'n') rows.push(['Remaining N', `${fmt(N / scaleN, 8)} ${nUnit}`.trim()]);
      if (empty[0] === 't') rows.push(['Elapsed time t', `${fmt(inU(tt), 8)} ${tUnit}`]);
      if (empty[0] === 'h') rows.push(['Half-life T½', `${fmt(inU(T), 8)} ${tUnit}`]);
      rows.push(['Fraction remaining', fmt(N / N0.v, 8)], ['Decay constant λ', `${fmt(1 / inU(1 / lam), 8)} /${tUnit}`, `${fmt(lam, 8)} s⁻¹`], ['Mean lifetime τ = 1/λ', `${fmt(inU(1 / lam), 8)} ${tUnit}`], ['Half-lives elapsed', fmt(tt / T, 6)]);
      const ts = linspace(0, Math.max(tt * 1.3, T * 4), 300);
      const svg = plot([{ x: ts.map(inU), y: ts.map(s => N0.v / scaleN * 2 ** (-s / T)) }, { x: [inU(tt)], y: [N / scaleN], type: 'scatter', r: 4, color: '#ffd666' }], { xlabel: `t (${tUnit})`, ylabel: `N${nUnit ? ' (' + nUnit + ')' : ''}`, title: 'Decay curve' });
      return { rows, svg, copy: rows[0][1] };
    },
    tex: ['N(t) = N_0\\,2^{-t/T_{1/2}} = N_0\\,e^{-\\lambda t},\\qquad \\lambda = \\frac{\\ln 2}{T_{1/2}},\\quad \\tau = \\frac1\\lambda', 't = T_{1/2}\\log_2\\frac{N_0}{N},\\qquad A = \\lambda N'],
    how: 'First-order decay: the same fraction decays in each half-life. Leave one of T½, t and N empty. N and N₀ can be in any unit (mass, moles, activity, counts, %), as long as both use the same kind. Times can be in different units.',
    refs: ['IUPAC Gold Book, "half life" and "decay constant".', 'NIST, Radionuclide Half-Life Measurements (nist.gov/pml/radionuclide-half-life-measurements) for reference half-lives.'],
  },
};

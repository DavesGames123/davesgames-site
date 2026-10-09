// ============================================================================
//  SCIENCE TOOLKIT  ·  tools/measure.js  ·  measurement and errors
// ----------------------------------------------------------------------------
//  Tool definitions for the "measure" category (contract: tools/units.js).
//
//  uncertainty  propagates independent standard uncertainties through a
//               formula two ways: first order (GUM law of propagation,
//               sensitivity coefficients by Ridders' differences) and Monte
//               Carlo (GUM Supplement 1, normal inputs, seeded).
//  wmean        inverse-variance weighted mean, chi-square, Birge ratio
//  pct-error    percent error and percent difference, with units
//
//  GREP MAP
//    grep -n "export function propagate"   the shared core of "uncertainty"
//    grep -n "export function weightedMean"
//    grep -n "uncertainty:"  "wmean:"  "'pct-error':"
// ============================================================================
import { parse, compile, freeVars } from '../core/expr.js';
import { deriv } from '../core/numeric.js';
import { DIST } from '../core/special.js';
import { qty, dimEq, dimName, dimText } from '../core/units.js';
import { roundUnc } from '../core/sigfig.js';
import { fmt, esc, num, pm, rng, histogram } from '../kit.js';

// Parse "name = value ± u" lines (also "name value u").
export function parseVars(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    let m = /^([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(.+)$/.exec(line);
    let name, rest;
    if (m) { name = m[1]; rest = m[2]; }
    else if ((m = /^([A-Za-z_][A-Za-z0-9_]*)\s+(\S+)\s+(\S+)$/.exec(line))) { name = m[1]; rest = `${m[2]} ± ${m[3]}`; }
    else throw new Error(`Cannot read "${line}". Write: L = 1.000 ± 0.002`);
    let x, u;
    try { [x, u] = pm(rest); } catch (e) { x = num(rest); u = 0; }
    if (u < 0) throw new Error(`The uncertainty of ${name} is negative.`);
    out[name] = [x, u];
  }
  return out;
}

// Propagate. Returns value, linear sigma, budget and Monte Carlo summary.
export function propagate(formula, vars, { n = 100000, seed = 1 } = {}) {
  let tree = parse(formula), name = 'f';
  if (tree.t === 'eq' && tree.a.t === 'id') { name = tree.a.name; tree = tree.b; }
  else if (tree.t === 'eq') throw new Error('Write the formula as "name = expression" or as the expression only.');
  const names = freeVars(tree);
  const missing = names.filter(k => !(k in vars));
  if (missing.length) throw new Error(`No value for ${missing.join(', ')}. Add a line such as "${missing[0]} = 1.0 ± 0.1".`);
  const f = compile(tree);
  const x0 = Object.fromEntries(names.map(k => [k, vars[k][0]]));
  const y = f(x0);
  if (!Number.isFinite(y)) throw new Error('The formula is not finite at the given values.');
  const budget = names.map(k => {
    const [x, u] = vars[k];
    let c = 0, cerr = 0;
    if (u > 0) {
      const s = { ...x0 };
      const g = (t) => { s[k] = t; return f(s); };
      const d = deriv(g, x, 1, Math.max(u, Math.abs(x) * 1e-6, 1e-300));
      c = d.value; cerr = d.err;
    }
    return { k, x, u, c, cerr, contrib: Math.abs(c * u) };
  });
  const varLin = budget.reduce((s, b) => s + b.contrib ** 2, 0);
  const sLin = Math.sqrt(varLin);
  budget.forEach(b => { b.share = varLin > 0 ? b.contrib ** 2 / varLin : 0; });
  // Monte Carlo.
  const r = rng(seed), s = { ...x0 }, ys = new Float64Array(n);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    for (const b of budget) s[b.k] = b.u > 0 ? b.x + b.u * r.normal() : b.x;
    const v = f(s);
    if (Number.isFinite(v)) ys[i - bad] = v; else bad++;
  }
  const m = n - bad, arr = ys.subarray(0, m).slice().sort();
  let mean = 0;
  for (let i = 0; i < m; i++) mean += arr[i];
  mean /= m;
  let ss = 0;
  for (let i = 0; i < m; i++) ss += (arr[i] - mean) ** 2;
  const sd = Math.sqrt(ss / (m - 1));
  const q = (p) => { const h = (m - 1) * p, i = Math.floor(h); return arr[i] + (h - i) * ((arr[i + 1] ?? arr[i]) - arr[i]); };
  return { name, names, y, sLin, budget, mc: { n: m, bad, mean, sd, lo: q(0.025), hi: q(0.975), median: q(0.5), samples: arr } };
}

// Inverse-variance weighted mean.
export function weightedMean(pairs) {
  if (pairs.length < 1) throw new Error('Enter at least one value.');
  for (const [, u] of pairs) if (!(u > 0)) throw new Error('Every uncertainty must be greater than 0.');
  let sw = 0, swx = 0;
  for (const [x, u] of pairs) { const w = 1 / (u * u); sw += w; swx += w * x; }
  const mean = swx / sw, sigma = 1 / Math.sqrt(sw);
  const chi2 = pairs.reduce((s, [x, u]) => s + ((x - mean) / u) ** 2, 0);
  const dof = pairs.length - 1;
  const p = dof > 0 ? DIST.chi2.sf(chi2, { df: dof }) : NaN;
  const birge = dof > 0 ? Math.sqrt(chi2 / dof) : NaN;
  return { mean, sigma, chi2, dof, p, birge, scaled: sigma * Math.max(1, birge || 1) };
}

export const TOOLS = {
  uncertainty: {
    inputs: [
      { k: 'f', label: 'Formula', def: 'g = 4*pi^2*L/T^2', w: 3, hint: 'name = expression, or the expression only' },
      { k: 'v', label: 'Values and standard uncertainties, one per line', type: 'area', rows: 4, def: 'L = 1.0000 ± 0.0020\nT = 2.0060 ± 0.0040' },
      { k: 'n', label: 'Monte Carlo draws', type: 'select', def: '100000', opts: [['10000', '10 000'], ['100000', '100 000'], ['1000000', '1 000 000']] },
    ],
    examples: [
      { label: 'pendulum g', v: { f: 'g = 4*pi^2*L/T^2', v: 'L = 1.0000 ± 0.0020\nT = 2.0060 ± 0.0040' } },
      { label: 'density of a cylinder', v: { f: 'rho = m/(pi*(d/2)^2*h)', v: 'm = 25.30 ± 0.05\nd = 1.270 ± 0.005\nh = 2.540 ± 0.005' } },
      { label: 'non-linear: ratio near 0', v: { f: 'q = a/b', v: 'a = 1.0 ± 0.1\nb = 0.5 ± 0.15' } },
      { label: 'missing value', v: { f: 'y = a*b', v: 'a = 1 ± 0.1' }, err: true },
    ],
    run({ f, v, n }) {
      const r = propagate(f, parseVars(v), { n: Number(n) });
      const ru = r.sLin > 0 ? roundUnc(r.y, r.sLin) : null;
      const rows = [
        [`${r.name} (first order)`, ru ? `${ru.x} ± ${ru.u}` : fmt(r.y, 10), ru ? `value ${fmt(r.y, 10)}, u = ${fmt(r.sLin, 6)}` : 'no input has an uncertainty'],
        ['Relative uncertainty', r.y ? `${fmt(100 * r.sLin / Math.abs(r.y), 4)} %` : '—'],
        [`${r.name} (Monte Carlo, ${r.mc.n.toLocaleString('en-US')} draws)`, `${fmt(r.mc.mean, 8)} ± ${fmt(r.mc.sd, 4)}`, 'mean ± standard deviation of the draws'],
        ['95 % coverage interval (Monte Carlo)', `[${fmt(r.mc.lo, 8)}, ${fmt(r.mc.hi, 8)}]`, 'the 2.5 % and 97.5 % quantiles'],
      ];
      if (r.mc.bad) rows.push(['Draws dropped', String(r.mc.bad), 'the formula was not finite for these draws']);
      if (r.sLin > 0) {
        const ratio = r.mc.sd / r.sLin;
        rows.push(['Monte Carlo / first-order spread', fmt(ratio, 4), Math.abs(ratio - 1) > 0.05 ? 'more than 5 % apart: the formula is not linear over the spread, so prefer the Monte Carlo interval' : 'agree within 5 %: first order is adequate']);
      }
      const html = `<h4>Uncertainty budget</h4><table class="t"><thead><tr><th>Input</th><th>Value</th><th>u(x)</th><th>∂${esc(r.name)}/∂x</th><th>|c·u|</th><th>Share of variance</th></tr></thead><tbody>${r.budget.map(b =>
        `<tr><td>${esc(b.k)}</td><td class="num">${fmt(b.x, 8)}</td><td class="num">${fmt(b.u, 4)}</td><td class="num">${fmt(b.c, 6)}</td><td class="num">${fmt(b.contrib, 4)}</td><td class="num">${(100 * b.share).toFixed(1)} %</td></tr>`).join('')}</tbody></table>`;
      const hs = r.mc.samples;
      const step = Math.max(1, Math.floor(hs.length / 20000));
      const sub = []; for (let i = 0; i < hs.length; i += step) sub.push(hs[i]);
      const svg = histogram(sub, { xlabel: r.name, bins: 60, clip: [0.002, 0.998], vlines: [{ x: r.y - r.sLin }, { x: r.y + r.sLin }, { x: r.mc.lo, color: '#e889dc' }, { x: r.mc.hi, color: '#e889dc' }], title: 'Monte Carlo draws, central 99.6 % (yellow: ± first-order u, pink: 95 % interval)' }).svg;
      return { rows, html, svg, copy: rows[0][1] };
    },
    tex: [
      'u_c^2(y) = \\sum_{i} \\left(\\frac{\\partial f}{\\partial x_i}\\right)^{2} u^2(x_i)',
      'y^{(r)} = f\\big(x_1^{(r)},\\dots,x_N^{(r)}\\big),\\quad x_i^{(r)} \\sim \\mathcal{N}\\big(x_i,\\,u^2(x_i)\\big)',
    ],
    how: 'First order: the sensitivity coefficient ∂f/∂xᵢ is a Ridders central difference at the given values, and the standard uncertainties add in quadrature. The inputs are taken as independent (no correlation terms). Monte Carlo: each input is drawn from a normal law with its value and standard uncertainty (seeded, so a link gives the same numbers), the formula is evaluated for each draw, and the result is the mean, the standard deviation and the 2.5 % and 97.5 % quantiles of the draws. When the two spreads differ, the formula is not linear across the uncertainty and the Monte Carlo interval is the better one.',
    refs: [
      'JCGM 100:2008, Evaluation of measurement data — Guide to the expression of uncertainty in measurement (GUM), §5.1.',
      'JCGM 101:2008, GUM Supplement 1 — Propagation of distributions using a Monte Carlo method.',
      'B. N. Taylor and C. E. Kuyatt, NIST Technical Note 1297 (1994).',
    ],
  },

  wmean: {
    inputs: [{ k: 'v', label: 'Values with standard uncertainties, one per line', type: 'area', rows: 6, def: '9.81 ± 0.02\n9.79 ± 0.03\n9.84 ± 0.04\n9.80 ± 0.01' }],
    examples: [
      { label: 'consistent', v: { v: '9.81 ± 0.02\n9.79 ± 0.03\n9.84 ± 0.04\n9.80 ± 0.01' } },
      { label: 'discrepant (Birge ratio > 1)', v: { v: '10.0 ± 0.1\n10.6 ± 0.1\n9.7 ± 0.2' } },
    ],
    run({ v }) {
      const pairs = String(v).split(/\r?\n/).map(l => l.replace(/#.*/, '').trim()).filter(Boolean).map(pm);
      const r = weightedMean(pairs);
      const ru = roundUnc(r.mean, r.sigma);
      const rows = [
        ['Weighted mean', `${ru.x} ± ${ru.u}`, `${fmt(r.mean, 10)} ± ${fmt(r.sigma, 6)} (internal)`],
        ['χ²', fmt(r.chi2, 6), `${r.dof} degrees of freedom`],
      ];
      if (r.dof > 0) {
        rows.push(['p-value (χ² ≥ observed)', fmt(r.p, 4)]);
        rows.push(['Birge ratio √(χ²/ν)', fmt(r.birge, 4), r.birge > 1 ? 'above 1: the values scatter more than their uncertainties allow' : 'at or below 1: consistent']);
        rows.push(['Scaled uncertainty', fmt(r.scaled, 6), 'u × max(1, Birge ratio), the PDG scale factor']);
      }
      return { rows, copy: rows[0][1] };
    },
    tex: [
      '\\bar x = \\frac{\\sum_i w_i x_i}{\\sum_i w_i},\\quad w_i = \\frac{1}{u_i^2},\\quad u(\\bar x) = \\Big(\\sum_i w_i\\Big)^{-1/2}',
      '\\chi^2 = \\sum_i \\frac{(x_i - \\bar x)^2}{u_i^2},\\quad R_\\mathrm{B} = \\sqrt{\\chi^2/(N-1)}',
    ],
    how: 'Each value is weighted by the inverse of its variance. χ² with N − 1 degrees of freedom tests if the values agree within their uncertainties. When the Birge ratio is above 1, the PDG practice scales the uncertainty of the mean by it.',
    refs: ['P. R. Bevington and D. K. Robinson, Data Reduction and Error Analysis for the Physical Sciences, 3rd ed. (2003), §4.1.', 'R. T. Birge, Phys. Rev. 40, 207 (1932).', 'Particle Data Group, Review of Particle Physics, Introduction §5.2 (scale factor).'],
  },

  'pct-error': {
    inputs: [
      { k: 'm', label: 'Measured', def: '9.72 m/s^2' },
      { k: 'a', label: 'Accepted (reference)', def: '9.80665 m/s^2' },
      { k: 'u', label: 'Standard uncertainty of the measurement (optional)', def: '0.05 m/s^2' },
    ],
    examples: [
      { label: 'different units', v: { m: '32.0 ft/s^2', a: '9.80665 m/s^2', u: '' } },
      { label: 'no units', v: { m: '2.68', a: '2.70', u: '0.01' } },
      { label: 'wrong units', v: { m: '9.7 m/s', a: '9.80665 m/s^2', u: '' }, err: true },
    ],
    run({ m, a, u }) {
      const M = qty(m), A = qty(a);
      if (!dimEq(M.d, A.d)) throw new Error(`The measured value is ${dimName(M.d)} and the accepted value is ${dimName(A.d)}: they cannot be compared.`);
      if (A.v === 0) throw new Error('The accepted value is 0, so a percent error has no meaning.');
      const unit = /[A-Za-z°µμΩÅ%$]/.test(a) ? a.replace(/^\s*[-+]?[\d.eE+-]+\s*/, '') : '';
      const scale = unit ? qty('1 ' + unit).v : 1;
      const diff = M.v - A.v;
      const rows = [
        ['Percent error', `${fmt(100 * diff / Math.abs(A.v), 6)} %`, '(measured − accepted) / |accepted|'],
        ['Absolute error', `${fmt(diff / scale, 6)}${unit ? ' ' + unit : (dimText(A.d) !== '1' ? ' ' + dimText(A.d) : '')}`],
        ['Percent difference', `${fmt(100 * Math.abs(diff) / Math.abs((M.v + A.v) / 2), 6)} %`, '|a − b| / mean, for two measurements with no reference'],
      ];
      if (u && u.trim()) {
        const U = qty(u);
        if (!dimEq(U.d, A.d)) throw new Error('The uncertainty must have the same dimension as the values.');
        const z = Math.abs(diff) / U.v;
        rows.push(['Deviation in units of u', fmt(z, 4), z <= 2 ? 'within 2u: consistent' : z <= 3 ? 'between 2u and 3u: marginal' : 'beyond 3u: a significant difference']);
      }
      return { rows, copy: rows[0][1] };
    },
    tex: [
      '\\delta = \\frac{x_\\text{meas} - x_\\text{ref}}{|x_\\text{ref}|}\\times 100\\,\\%',
      '\\text{percent difference} = \\frac{|a-b|}{(a+b)/2}\\times 100\\,\\%,\\quad z = \\frac{|x_\\text{meas} - x_\\text{ref}|}{u}',
    ],
    how: 'Both values convert to SI first, so they can be in different units of the same dimension. A different dimension is an error. With an uncertainty, z counts how many standard uncertainties the measurement is from the reference.',
    refs: ['J. R. Taylor, An Introduction to Error Analysis, 2nd ed. (1997), §2.5 and §5.', 'JCGM 200:2012 (VIM), 2.16 measurement error.'],
  },
};

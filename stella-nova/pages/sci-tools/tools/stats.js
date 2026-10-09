// ============================================================================
//  SCIENCE TOOLKIT  ·  tools/stats.js  ·  statistics
// ----------------------------------------------------------------------------
//  Tool definitions for the "stats" category (contract: tools/units.js).
//  The maths is in core/stats.js, core/fit.js and core/special.js.
//
//  GREP MAP
//    grep -n "describe:"   "ttest:"   "chisq:"   "anova:"   "corr:"
//    grep -n "fit:"        "dist:"    "power:"
//    grep -n "function xyRows"   pasted x y [sigma] columns
// ============================================================================
import { describe, ttest, chisqGof, chisqTable, anova1, pearson, spearman, powerT, powerProp, cohenH, solveN } from '../core/stats.js';
import { fitModel, MODELS } from '../core/fit.js';
import { DIST } from '../core/special.js';
import { fmt, pfmt, esc, nums, num, table, plot, histogram, boxplot, linspace } from '../kit.js';

const CONF = { k: 'conf', label: 'Confidence level', type: 'select', def: '0.95', opts: [['0.9', '90 %'], ['0.95', '95 %'], ['0.99', '99 %']] };
const ALT = { k: 'alt', label: 'Alternative', type: 'select', def: 'two-sided', opts: [['two-sided', 'two-sided (≠)'], ['less', 'less (<)'], ['greater', 'greater (>)']] };
const REF_STATS = [
  'D. C. Montgomery and G. C. Runger, Applied Statistics and Probability for Engineers, 7th ed. (2018).',
  'NIST/SEMATECH e-Handbook of Statistical Methods, itl.nist.gov/div898/handbook (2012).',
  'Results checked against SciPy 1.15 (scipy.stats) in tests/fixtures.json.',
];
const ci = (c) => `[${fmt(c[0], 6)}, ${fmt(c[1], 6)}]`;
const sig = (p, a = 0.05) => p < a ? `significant at α = ${a}` : `not significant at α = ${a}`;

// Rows "x y [sigma]" to arrays.
export function xyRows(text) {
  const rows = table(text).filter(r => r.length >= 2 && /^[-+.\d]/.test(r[0]));
  if (rows.length < 2) throw new Error('Enter at least two rows of x and y.');
  const x = rows.map(r => num(r[0])), y = rows.map(r => num(r[1]));
  const s = rows.every(r => r.length >= 3 && r[2] !== '') ? rows.map(r => num(r[2])) : null;
  if (s && s.some(v => !(v > 0))) throw new Error('Every σ in the third column must be greater than 0.');
  return { x, y, s };
}
const lines = (text) => String(text).split(/\r?\n/).map(l => l.replace(/#.*/, '').trim()).filter(Boolean).map(nums);

export const TOOLS = {
  describe: {
    inputs: [
      { k: 'd', label: 'Data (any separators)', type: 'area', rows: 5, def: '5.1 4.9 6.2 5.8 6.0 5.5 5.3 6.1 4.7 5.6' },
      CONF,
    ],
    examples: [{ label: 'skewed sample', v: { d: '1.2 1.5 1.1 2.8 1.9 1.3 6.4 2.2 1.7 1.4 3.9 1.6 2.0 1.8' } }],
    run({ d, conf }) {
      const s = describe(nums(d), Number(conf));
      const rows = [
        ['n', String(s.n)], ['Mean', fmt(s.mean, 8)], ['Median', fmt(s.median, 8)],
        ['Standard deviation (n − 1)', fmt(s.sd, 8)], ['Variance (n − 1)', fmt(s.var, 8)],
        ['Standard error of the mean', fmt(s.sem, 8)],
        [`${Math.round(Number(conf) * 100)} % CI of the mean (t)`, ci(s.ci), `t = ${fmt(s.tq, 6)} with ${s.n - 1} df`],
        ['Minimum', fmt(s.min, 8)], ['First quartile Q1', fmt(s.q1, 8)], ['Third quartile Q3', fmt(s.q3, 8)], ['Maximum', fmt(s.max, 8)],
        ['IQR', fmt(s.q3 - s.q1, 8)], ['Range', fmt(s.max - s.min, 8)], ['Sum', fmt(s.sum, 10)],
        ['Skewness g₁ (G₁ adjusted)', `${fmt(s.skew, 6)} (${fmt(s.skewAdj, 6)})`],
        ['Excess kurtosis g₂', fmt(s.kurt, 6)], ['Coefficient of variation', `${fmt(100 * s.cv, 5)} %`],
      ];
      const h = histogram(s.sorted, { vlines: [{ x: s.mean, color: '#ff9a62' }, { x: s.median, color: '#ffd666' }], title: 'Histogram (Freedman–Diaconis bins); orange: mean, yellow: median' });
      return { rows, svg: [h.svg, boxplot(s)], copy: rows.map(r => `${r[0]}\t${r[1]}`).join('\n') };
    },
    tex: [
      '\\bar x = \\frac1n\\sum x_i,\\quad s = \\sqrt{\\frac{1}{n-1}\\sum (x_i - \\bar x)^2},\\quad \\mathrm{SEM} = \\frac{s}{\\sqrt n}',
      '\\bar x \\pm t_{1-\\alpha/2,\\,n-1}\\,\\frac{s}{\\sqrt n}',
      'Q(p) = x_{(\\lfloor h\\rfloor)} + (h - \\lfloor h\\rfloor)\\big(x_{(\\lfloor h\\rfloor+1)} - x_{(\\lfloor h\\rfloor)}\\big),\\quad h = (n-1)p',
    ],
    how: 'Quartiles use linear interpolation between order statistics (Hyndman and Fan type 7, the default of R and NumPy). The confidence interval of the mean uses Student t with n − 1 degrees of freedom. Skewness g₁ is the moment coefficient; G₁ = g₁√(n(n−1))/(n−2). The box plot whiskers end at the last points within 1.5 IQR; points beyond are drawn as circles.',
    refs: ['R. J. Hyndman and Y. Fan, Sample quantiles in statistical packages, Am. Stat. 50, 361 (1996).', ...REF_STATS],
  },

  ttest: {
    inputs: [
      { k: 'mode', label: 'Test', type: 'select', def: 'welch', opts: [['one', 'One sample'], ['paired', 'Paired'], ['welch', 'Two samples, Welch (unequal variances)'], ['student', 'Two samples, Student (pooled variance)']] },
      { k: 'mu', label: 'Hypothesised mean or difference μ₀', def: '0' },
      ALT,
      { k: 'a', label: 'Sample A', type: 'area', rows: 3, def: '5.1 4.9 6.2 5.8 6.0 5.5 5.3 6.1 4.7 5.6' },
      { k: 'b', label: 'Sample B (not used for one sample)', type: 'area', rows: 3, def: '6.0 5.4 6.8 6.1 6.6 5.9 5.5 6.9 5.2 6.3' },
      CONF,
    ],
    examples: [
      { label: 'one sample vs 5', v: { mode: 'one', mu: '5' } },
      { label: 'paired', v: { mode: 'paired' } },
      { label: 'Student', v: { mode: 'student' } },
    ],
    run({ mode, mu, alt, a, b, conf }) {
      const A = nums(a), B = mode === 'one' ? [] : nums(b);
      const r = ttest(mode, A, B, { mu: num(mu), alt, conf: Number(conf) });
      const what = mode === 'one' ? 'mean of A' : mode === 'paired' ? 'mean of A − B' : 'mean A − mean B';
      const rows = [
        ['t', fmt(r.t, 8)], ['Degrees of freedom', fmt(r.df, 8)],
        ['p-value', pfmt(r.p), `${alt}; ${sig(r.p)}`],
        [`Estimate (${what})`, fmt(r.est, 8)], ['Standard error', fmt(r.se, 6)],
        [`${Math.round(Number(conf) * 100)} % confidence interval`, ci(r.ci)],
        ["Cohen's d", fmt(r.d, 5), mode === 'one' || mode === 'paired' ? '(mean − μ₀) / SD' : 'difference / pooled SD'],
      ];
      return { rows, copy: `t = ${fmt(r.t, 6)}, df = ${fmt(r.df, 6)}, p = ${pfmt(r.p)}` };
    },
    tex: [
      't = \\frac{\\bar x - \\mu_0}{s/\\sqrt n}\\ \\ (\\nu = n-1)',
      't = \\frac{\\bar x_A - \\bar x_B - \\mu_0}{\\sqrt{s_A^2/n_A + s_B^2/n_B}},\\quad \\nu = \\frac{(s_A^2/n_A + s_B^2/n_B)^2}{\\frac{(s_A^2/n_A)^2}{n_A-1} + \\frac{(s_B^2/n_B)^2}{n_B-1}}',
      's_p^2 = \\frac{(n_A-1)s_A^2 + (n_B-1)s_B^2}{n_A+n_B-2},\\quad t = \\frac{\\bar x_A - \\bar x_B - \\mu_0}{s_p\\sqrt{1/n_A + 1/n_B}}',
    ],
    how: 'The paired test is the one-sample test on the differences A − B. Welch does not assume equal variances and uses the Welch–Satterthwaite degrees of freedom; it is the safer default. The p-value comes from the Student t law through the regularized incomplete beta function.',
    refs: ['B. L. Welch, Biometrika 34, 28 (1947).', 'Student, Biometrika 6, 1 (1908).', ...REF_STATS],
  },

  chisq: {
    inputs: [
      { k: 'mode', label: 'Test', type: 'select', def: 'table', opts: [['table', 'Contingency table (independence)'], ['gof', 'Goodness of fit']] },
      { k: 'd', label: 'Table rows, or for goodness of fit: observed on line 1, expected (counts or probabilities, optional) on line 2', type: 'area', rows: 4, def: '10 20 30\n15 25 5' },
      { k: 'yates', label: 'Yates correction (2 × 2 only)', type: 'check', def: '0' },
      { k: 'ddof', label: 'Parameters estimated from the data (goodness of fit)', def: '0' },
    ],
    examples: [
      { label: 'fair die?', v: { mode: 'gof', d: '16 18 16 14 12 12\n1 1 1 1 1 1' } },
      { label: '2 × 2 with Yates', v: { mode: 'table', d: '12 5\n7 15', yates: '1' } },
    ],
    run({ mode, d, yates, ddof }) {
      const L = lines(d);
      if (mode === 'gof') {
        const r = chisqGof(L[0] || [], L[1] || [], Math.round(num(ddof || '0')));
        const rows = [['χ²', fmt(r.chi2, 8)], ['Degrees of freedom', String(r.df)], ['p-value', pfmt(r.p), sig(r.p)]];
        if (r.small) rows.push(['Note', `${r.small} expected count${r.small > 1 ? 's are' : ' is'} under 5: the χ² approximation is poor.`]);
        const html = `<h4>Expected counts</h4><table class="t"><tbody><tr>${r.expected.map(e => `<td class="num">${fmt(e, 5)}</td>`).join('')}</tr></tbody></table>`;
        return { rows, html, copy: `χ² = ${fmt(r.chi2, 6)}, df = ${r.df}, p = ${pfmt(r.p)}` };
      }
      const r = chisqTable(L, yates === '1');
      const rows = [['χ²', fmt(r.chi2, 8), r.yates ? 'with Yates correction' : ''], ['Degrees of freedom', String(r.df)], ['p-value', pfmt(r.p), sig(r.p)], ["Cramér's V", fmt(r.cramerV, 5)], ['N', String(r.N)]];
      const small = r.expected.flat().filter(x => x < 5).length;
      if (small) rows.push(['Note', `${small} expected count${small > 1 ? 's are' : ' is'} under 5: consider an exact test.`]);
      const html = `<h4>Expected counts under independence</h4><table class="t"><tbody>${r.expected.map(row => `<tr>${row.map(e => `<td class="num">${fmt(e, 5)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      return { rows, html, copy: `χ² = ${fmt(r.chi2, 6)}, df = ${r.df}, p = ${pfmt(r.p)}` };
    },
    tex: [
      '\\chi^2 = \\sum_i \\frac{(O_i - E_i)^2}{E_i},\\quad \\nu = k - 1 - m',
      'E_{ij} = \\frac{R_i\\,C_j}{N},\\quad \\nu = (r-1)(c-1),\\quad V = \\sqrt{\\frac{\\chi^2}{N(\\min(r,c)-1)}}',
    ],
    how: 'Expected counts in a goodness-of-fit test may be counts or probabilities; they are scaled to the observed total, and an empty line means equal cells. m is the number of parameters fitted from the data. The p-value is the upper tail of the χ² law. Yates subtracts 0.5 from each |O − E| of a 2 × 2 table.',
    refs: ['K. Pearson, Phil. Mag. 50, 157 (1900).', 'F. Yates, Suppl. J. R. Stat. Soc. 1, 217 (1934).', ...REF_STATS],
  },

  anova: {
    inputs: [{ k: 'd', label: 'One group per line', type: 'area', rows: 5, def: '5.1 4.9 6.2 5.8 6.0 5.5 5.3 6.1 4.7 5.6\n6.0 5.4 6.8 6.1 6.6 5.9 5.5 6.9 5.2 6.3\n4.5 5.0 4.8 5.2 4.9 5.1' }],
    run({ d }) {
      const G = lines(d), r = anova1(G);
      const rows = [['F', fmt(r.F, 8), `(${r.df1}, ${r.df2}) degrees of freedom`], ['p-value', pfmt(r.p), sig(r.p)], ['η² (effect size)', fmt(r.eta2, 5)]];
      const html = `<h4>ANOVA table</h4><table class="t"><thead><tr><th>Source</th><th>SS</th><th>df</th><th>MS</th><th>F</th><th>p</th></tr></thead><tbody>
        <tr><td>Between groups</td><td class="num">${fmt(r.ssb, 6)}</td><td class="num">${r.df1}</td><td class="num">${fmt(r.msb, 6)}</td><td class="num">${fmt(r.F, 6)}</td><td class="num">${pfmt(r.p)}</td></tr>
        <tr><td>Within groups</td><td class="num">${fmt(r.ssw, 6)}</td><td class="num">${r.df2}</td><td class="num">${fmt(r.msw, 6)}</td><td></td><td></td></tr>
        <tr><td>Total</td><td class="num">${fmt(r.sst, 6)}</td><td class="num">${r.df1 + r.df2}</td><td></td><td></td><td></td></tr></tbody></table>
        <h4>Groups</h4><table class="t"><thead><tr><th>Group</th><th>n</th><th>Mean</th></tr></thead><tbody>${r.means.map((m, i) => `<tr><td>${i + 1}</td><td class="num">${r.ns[i]}</td><td class="num">${fmt(m, 6)}</td></tr>`).join('')}</tbody></table>`;
      return { rows, html, copy: `F(${r.df1}, ${r.df2}) = ${fmt(r.F, 6)}, p = ${pfmt(r.p)}` };
    },
    tex: [
      'F = \\frac{SS_B/(k-1)}{SS_W/(N-k)},\\quad SS_B = \\sum_j n_j(\\bar x_j - \\bar x)^2,\\quad SS_W = \\sum_j\\sum_i (x_{ij} - \\bar x_j)^2',
      '\\eta^2 = \\frac{SS_B}{SS_B + SS_W}',
    ],
    how: 'One-way ANOVA tests if k group means are equal, with the assumption of normal groups of equal variance. The p-value is the upper tail of the F law with (k − 1, N − k) degrees of freedom. A significant F does not say which groups differ: follow with pairwise tests and a correction.',
    refs: ['R. A. Fisher, Statistical Methods for Research Workers (1925).', ...REF_STATS],
  },

  corr: {
    inputs: [{ k: 'd', label: 'Pairs: x y per line', type: 'area', rows: 6, def: '5.1 6.0\n4.9 5.4\n6.2 6.8\n5.8 6.1\n6.0 6.6\n5.5 5.9\n5.3 5.5\n6.1 6.9\n4.7 5.2\n5.6 6.3' }, CONF],
    run({ d, conf }) {
      const { x, y } = xyRows(d);
      const p = pearson(x, y, Number(conf)), s = spearman(x, y);
      const rows = [
        ['Pearson r', fmt(p.r, 8), `r² = ${fmt(p.r * p.r, 6)}`], ['p-value (Pearson)', pfmt(p.p), `t = ${fmt(p.t, 6)}, ${p.df} df; ${sig(p.p)}`],
        [`${Math.round(Number(conf) * 100)} % CI of r (Fisher z)`, ci(p.ci)],
        ['Spearman ρ', fmt(s.rho, 8), 'Pearson r of the ranks (ties get the mean rank)'], ['p-value (Spearman)', pfmt(s.p), 't approximation, as SciPy'],
        ['n', String(p.n)],
      ];
      const svg = plot([{ x, y, type: 'scatter' }], { xlabel: 'x', ylabel: 'y', title: `r = ${fmt(p.r, 4)}, ρ = ${fmt(s.rho, 4)}` });
      return { rows, svg, copy: `r = ${fmt(p.r, 6)}, p = ${pfmt(p.p)}` };
    },
    tex: [
      'r = \\frac{\\sum (x_i-\\bar x)(y_i-\\bar y)}{\\sqrt{\\sum (x_i-\\bar x)^2\\sum (y_i-\\bar y)^2}},\\quad t = r\\sqrt{\\frac{n-2}{1-r^2}}',
      'z = \\operatorname{artanh} r,\\quad z \\pm \\frac{z_{1-\\alpha/2}}{\\sqrt{n-3}}',
    ],
    how: 'The p-value of r uses Student t with n − 2 degrees of freedom. The interval transforms r with Fisher z, adds the normal quantile over √(n − 3), and transforms back. Spearman ρ is Pearson r on the ranks; it measures a monotonic link and resists outliers.',
    refs: ['R. A. Fisher, Biometrika 10, 507 (1915).', 'C. Spearman, Am. J. Psychol. 15, 72 (1904).', ...REF_STATS],
  },

  fit: {
    inputs: [
      { k: 'model', label: 'Model', type: 'select', def: 'linear', opts: Object.entries(MODELS).map(([k, m]) => [k, m.name]) },
      { k: 'deg', label: 'Polynomial degree', def: '2' },
      { k: 'expr', label: 'Custom model y =', def: 'a*sin(b*x)+c', hint: 'x and any parameter names' },
      { k: 'start', label: 'Start values (optional)', def: '', hint: 'for example a=1.5, b=1.2' },
      { k: 'd', label: 'Data: x y [σ] per line (a σ column gives a weighted fit)', type: 'area', rows: 7, def: '0 2.59\n1 3.04\n2 4.37\n3 5.18\n4 5.11\n5 6.11\n6 7.34\n7 8.08\n8 9.00\n9 9.85' },
    ],
    examples: [
      { label: 'decay with baseline', v: { model: 'expc', d: '0 2.41\n0.5 1.68\n1 1.21\n1.5 0.92\n2 0.73\n2.5 0.61\n3 0.53\n3.5 0.48\n4 0.45\n4.5 0.43\n5 0.42' } },
      { label: 'Gaussian peak', v: { model: 'gauss', d: '-3 0.05\n-2 0.32\n-1 1.36\n-0.5 2.38\n0 3.47\n0.5 3.95\n1 3.62\n1.5 2.57\n2 1.48\n3 0.27\n4 0.03' } },
      { label: 'custom sine', v: { model: 'custom', expr: 'a*sin(b*x)+c', start: 'a=1.5, b=1.2, c=0', d: '0 0.48\n0.5 1.68\n1 2.42\n1.5 2.36\n2 1.53\n2.5 0.30\n3 -0.89\n3.5 -1.41\n4 -1.26\n4.5 -0.30\n5 0.98\n5.5 2.06\n6 2.49' } },
      { label: 'weighted line', v: { model: 'linear', d: '1 1.52 0.10\n2 2.05 0.15\n3 2.38 0.20\n4 3.07 0.25\n5 3.39 0.30\n6 4.12 0.35' } },
    ],
    run({ model, deg, expr, start, d }) {
      const { x, y, s } = xyRows(d);
      const r = fitModel(model, x, y, s, { deg: Math.round(num(deg)), expr, start });
      const rows = r.names.map((n, i) => [n, `${fmt(r.p[i], 8)} ± ${fmt(r.err[i], 4)}`, 'value ± standard error']);
      rows.push(['R²', fmt(r.r2, 8)], ['Adjusted R²', fmt(r.adjR2, 8)]);
      if (s) rows.push(['χ² / ν', `${fmt(r.chi2, 6)} / ${r.dof} = ${fmt(r.redChi2, 5)}`, 'near 1 when the σ column is right']);
      else rows.push(['Residual standard error', fmt(r.rmse, 6), `${r.dof} degrees of freedom`]);
      if (r.converged === false) rows.push(['Warning', 'The fit stopped before it converged. Try other start values.']);
      const lo = Math.min(...x), hi = Math.max(...x), xs = linspace(lo, hi, 300);
      const svg1 = plot([{ x, y, type: 'scatter', name: 'data' }, { x: xs, y: xs.map(r.f), name: 'fit' }], { xlabel: 'x', ylabel: 'y', title: MODELS[model].name });
      const res = x.map((xi, i) => y[i] - r.yhat[i]);
      const svg2 = plot([{ x, y: res, type: 'scatter', color: '#ff9a62' }], { xlabel: 'x', ylabel: 'residual', h: 200, hlines: [{ y: 0, color: '#8fa3a8' }], title: 'Residuals' });
      return { rows, svg: [svg1, svg2], copy: rows.map(rw => `${rw[0]}\t${rw[1]}`).join('\n') };
    },
    tex: [
      '\\min_{\\mathbf p}\\ \\chi^2(\\mathbf p) = \\sum_i w_i\\,\\big(y_i - f(x_i;\\mathbf p)\\big)^2,\\quad w_i = 1/\\sigma_i^2 \\text{ or } 1',
      'C = s^2\\,(J^\\mathsf{T} J)^{-1},\\ s^2 = \\frac{\\mathrm{SSR}}{n-p}\\qquad C = (J^\\mathsf{T} W J)^{-1} \\text{ with } \\sigma_i',
      '(J^\\mathsf{T} W J + \\lambda\\,\\mathrm{diag}\\,J^\\mathsf{T} W J)\\,\\delta = J^\\mathsf{T} W\\,\\mathbf r',
      'R^2 = 1 - \\frac{\\sum (y_i - \\hat y_i)^2}{\\sum (y_i - \\bar y)^2}',
    ],
    how: 'Lines and polynomials are linear least squares, solved by Householder QR. The other models use Levenberg–Marquardt with a numeric Jacobian; start values come from the data (a log-linear fit for exponentials and power laws, the peak and its width for a Gaussian), or from the start-values field. Without a σ column the covariance is scaled by the residual variance, as scipy.optimize.curve_fit does by default. With a σ column the σ values are taken as absolute (absolute_sigma=True) and χ²/ν tells if they are right. Standard errors assume the model is right and the errors are independent.',
    refs: ['K. Levenberg, Q. Appl. Math. 2, 164 (1944); D. W. Marquardt, J. SIAM 11, 431 (1963).', 'W. H. Press et al., Numerical Recipes, 3rd ed. (2007), §15.4-15.5.', 'P. R. Bevington and D. K. Robinson, Data Reduction and Error Analysis, 3rd ed. (2003), ch. 6-8.', 'Results checked against scipy.optimize.curve_fit (SciPy 1.15).'],
  },

  dist: {
    inputs: [
      { k: 'law', label: 'Distribution', type: 'select', def: 'normal', opts: Object.entries(DIST).map(([k, v]) => [k, v.name]) },
      { k: 'prm', label: 'Parameters (empty: defaults)', def: '', w: 2, hint: 'normal: mu=0, sigma=1 · t: df=10 · chi2: df=3 · f: d1=5, d2=20 · binom: n=20, p=0.3 · poisson: lambda=4' },
      { k: 'x', label: 'x (or k)', def: '1.96' },
      { k: 'p', label: 'Probability for the quantile', def: '0.975' },
    ],
    examples: [
      { label: 't critical value', v: { law: 't', prm: 'df=9', x: '2.262', p: '0.975' } },
      { label: 'binomial', v: { law: 'binom', prm: 'n=20, p=0.3', x: '8', p: '0.95' } },
      { label: 'Poisson counts', v: { law: 'poisson', prm: 'lambda=4', x: '7', p: '0.99' } },
    ],
    run({ law, prm, x, p }) {
      const D = DIST[law];
      const P = Object.fromEntries(D.params.map(([k, , def]) => [k, def]));
      for (const part of String(prm).split(/[,;]/)) {
        const m = /^\s*([A-Za-zμσνλ0-9_]+)\s*=\s*([-+0-9.eE]+)\s*$/.exec(part);
        if (m) { if (!(m[1] in P)) throw new Error(`${D.name} has no parameter "${m[1]}". Its parameters: ${D.params.map(q => q[0]).join(', ')}.`); P[m[1]] = Number(m[2]); }
        else if (part.trim()) throw new Error(`Cannot read "${part.trim()}". Write name=value.`);
      }
      D.check(P);
      const X = num(x), Pr = num(p);
      if (!(Pr >= 0 && Pr <= 1)) throw new Error('The probability must be from 0 to 1.');
      const q = D.ppf(Pr, P);
      const rows = [
        [D.discrete ? 'P(X = k)' : 'Density f(x)', fmt(D.pdf(X, P), 10)],
        ['P(X ≤ x)  cdf', fmt(D.cdf(X, P), 10)], ['P(X > x)  sf', fmt(D.sf(X, P), 10)],
        [`Quantile for p = ${Pr}`, fmt(q, 10), D.discrete ? 'smallest k with P(X ≤ k) ≥ p' : ''],
        ['Mean', fmt(D.mean(P), 10)], ['Variance', fmt(D.var(P), 10)],
      ];
      const mu = D.mean(P), sd = Math.sqrt(D.var(P));
      let svg;
      if (D.discrete) {
        const k0 = Math.max(0, Math.floor((Number.isFinite(mu) ? mu : 0) - 5 * sd - 1)), k1 = Math.ceil((Number.isFinite(mu) ? mu : 10) + 5 * sd + 1);
        const ks = []; for (let k = k0; k <= Math.min(k1, k0 + 400); k++) ks.push(k);
        svg = plot([{ x: ks, y: ks.map(k => D.pdf(k, P)), type: 'bar', w: 1 }, { x: ks.filter(k => k <= X), y: ks.filter(k => k <= X).map(k => D.pdf(k, P)), type: 'bar', w: 1, color: '#ff9a62' }], { xlabel: 'k', ylabel: 'P(X = k)', title: `${D.name}: orange bars sum to P(X ≤ ${X})` });
      } else {
        const lo = Number.isFinite(mu) && Number.isFinite(sd) ? Math.min(mu - 4.5 * sd, X) : D.ppf(0.001, P);
        const hi = Number.isFinite(mu) && Number.isFinite(sd) ? Math.max(mu + 4.5 * sd, X) : D.ppf(0.995, P);
        const a = law === 'chi2' || law === 'f' ? Math.max(0, lo) : lo;
        const xs = linspace(a, hi, 400), ys = xs.map(t => D.pdf(t, P));
        const xa = xs.filter(t => t <= X);
        svg = plot([{ x: xa, y: xa.map(t => D.pdf(t, P)), type: 'area', color: '#ff9a62' }, { x: xs, y: ys }], { xlabel: 'x', ylabel: 'density', title: `${D.name}: the shaded area is P(X ≤ ${X})`, yr: [0, Math.min(Math.max(...ys.filter(Number.isFinite)) * 1.08, 50)] });
      }
      return { rows, svg, copy: rows.map(r => `${r[0]}\t${r[1]}`).join('\n') };
    },
    tex: [
      'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-(x-\\mu)^2/2\\sigma^2},\\quad F(x) = \\tfrac12\\operatorname{erfc}\\!\\Big(\\!-\\frac{x-\\mu}{\\sigma\\sqrt2}\\Big)',
      'F_t(x) = 1 - \\tfrac12 I_{\\nu/(\\nu+x^2)}\\big(\\tfrac\\nu2,\\tfrac12\\big)\\ (x>0),\\quad F_{\\chi^2}(x) = P\\big(\\tfrac k2,\\tfrac x2\\big),\\quad F_F(x) = I_{\\frac{d_1x}{d_1x+d_2}}\\big(\\tfrac{d_1}2,\\tfrac{d_2}2\\big)',
      'P(X\\le k) = I_{1-p}(n-k,\\,k+1)\\ \\text{(binomial)},\\quad P(X\\le k) = Q(k+1,\\lambda)\\ \\text{(Poisson)}',
    ],
    how: 'Every cdf goes through the regularized incomplete gamma P, Q or beta I function (series and continued fractions, Numerical Recipes §6.2-6.4), so tails keep their relative precision. Quantiles of continuous laws invert the cdf by bisection to full double precision; the normal quantile uses Acklam\'s fit with Halley steps. Discrete quantiles are the smallest k with cdf ≥ p, as SciPy.',
    refs: ['W. H. Press et al., Numerical Recipes, 3rd ed. (2007), §6.1-6.4, 6.14.', 'M. Abramowitz and I. A. Stegun, Handbook of Mathematical Functions (1964), ch. 26.', 'Results checked against scipy.stats (SciPy 1.15) to 1e-10 relative.'],
  },

  power: {
    inputs: [
      { k: 'kind', label: 'Test', type: 'select', def: 'two', opts: [['two', 't-test, two independent groups'], ['one', 't-test, one sample or paired'], ['prop', 'Two proportions (z test)']] },
      { k: 'solve', label: 'Solve for', type: 'select', def: 'n', opts: [['n', 'sample size'], ['power', 'power']] },
      { k: 'd', label: "Effect size: Cohen's d (t-tests)", def: '0.5' },
      { k: 'p1', label: 'Proportion 1 (z test)', def: '0.6' },
      { k: 'p2', label: 'Proportion 2 (z test)', def: '0.5' },
      { k: 'alpha', label: 'Significance level α', def: '0.05' },
      { k: 'pow', label: 'Target power 1 − β', def: '0.8' },
      { k: 'n', label: 'Sample size (per group, or pairs)', def: '30' },
      ALT,
    ],
    examples: [
      { label: 'power at n = 30', v: { solve: 'power', n: '30' } },
      { label: 'paired, small effect', v: { kind: 'one', d: '0.3', pow: '0.9' } },
      { label: 'A/B test 60 % vs 50 %', v: { kind: 'prop' } },
    ],
    run({ kind, solve, d, p1, p2, alpha, pow, n, alt }) {
      const a = num(alpha);
      if (!(a > 0 && a < 1)) throw new Error('α must be between 0 and 1.');
      let f, eff, effName;
      if (kind === 'prop') {
        const P1 = num(p1), P2 = num(p2);
        if (!(P1 > 0 && P1 < 1 && P2 > 0 && P2 < 1)) throw new Error('Proportions must be between 0 and 1.');
        eff = cohenH(P1, P2); effName = "Cohen's h";
        f = (m) => powerProp(eff, m, a, alt === 'two-sided' ? 'two-sided' : 'one');
      } else {
        eff = num(d); effName = "Cohen's d";
        if (eff === 0) throw new Error('An effect of 0 cannot be detected.');
        if (alt === 'less' && eff > 0) eff = -eff;
        f = (m) => powerT(kind, alt === 'two-sided' ? Math.abs(eff) : eff, m, a, alt);
      }
      const per = kind === 'two' || kind === 'prop' ? 'per group' : kind === 'one' ? 'pairs or observations' : '';
      const rows = [[effName, fmt(eff, 6)]];
      if (solve === 'n') {
        const N = solveN(f, num(pow), kind === 'prop' ? 1 : 2);
        rows.unshift([`Sample size (${per})`, String(Math.ceil(N - 1e-9)), `exact solution ${fmt(N, 7)}, rounded up`]);
        if (kind !== 'one') rows.push(['Total', String(2 * Math.ceil(N - 1e-9))]);
        rows.push(['Power at that n', fmt(f(Math.ceil(N - 1e-9)), 5)]);
      } else {
        const N = num(n);
        rows.unshift([`Power at n = ${N} (${per})`, fmt(f(N), 6)]);
      }
      const ns = linspace(kind === 'prop' ? 2 : 3, Math.max(20, (solve === 'n' ? Number(rows[0][1]) : num(n)) * 2), 120);
      const svg = plot([{ x: ns, y: ns.map(f) }], { xlabel: `n (${per})`, ylabel: 'power', yr: [0, 1.02], hlines: [{ y: num(pow) }], title: 'Power curve' });
      return { rows, svg, copy: rows[0][1] };
    },
    tex: [
      '1-\\beta = P\\big(|T_{\\nu,\\delta}| > t_{1-\\alpha/2,\\nu}\\big),\\quad \\delta = d\\sqrt{n/2},\\ \\nu = 2n-2\\ \\text{(two groups)}',
      'P(T_{\\nu,\\delta}\\le t) = \\int_0^\\infty \\Phi\\!\\Big(t\\sqrt{v/\\nu} - \\delta\\Big)\\,f_{\\chi^2_\\nu}(v)\\,dv',
      'h = 2\\arcsin\\sqrt{p_1} - 2\\arcsin\\sqrt{p_2},\\quad 1-\\beta = \\Phi\\big(|h|\\sqrt{n/2} - z_{1-\\alpha/2}\\big) + \\Phi\\big(-|h|\\sqrt{n/2} - z_{1-\\alpha/2}\\big)',
    ],
    how: 'The power of a t-test is the probability that the noncentral t statistic passes the critical value. The noncentral t cdf is an integral of the normal cdf over the χ² law, done by adaptive Gauss–Kronrod quadrature. The sample size is the n where the power reaches the target (Brent), rounded up; the result agrees with statsmodels. The proportions test uses Cohen\'s h and the normal approximation.',
    refs: ['J. Cohen, Statistical Power Analysis for the Behavioral Sciences, 2nd ed. (1988), ch. 2 and 6.', 'Results checked against statsmodels 0.14 (TTestIndPower, TTestPower, NormalIndPower).'],
  },
};

// Statistics: special functions and distributions, descriptive statistics,
// tests, fits and power against SciPy / statsmodels results in
// tests/fixtures.json (made by tests/make-fixtures.py).
import { DIST, lgamma, gammaP, betaI, erf, erfc } from '../core/special.js';
import { describe, ttest, chisqGof, chisqTable, anova1, pearson, spearman, nctCdf, powerT, powerProp, cohenH, solveN } from '../core/stats.js';
import { fitModel } from '../core/fit.js';
import { TOOLS } from '../tools/stats.js';

export default function ({ ok, near, throws, FIX }) {
  const { A, B, C } = FIX.data;
  // Special functions with closed forms.
  near(lgamma(10), Math.log(362880), 1e-14, 'lgamma(10) = ln 9!');
  near(lgamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-14, 'lgamma(1/2) = ln √π');
  near(gammaP(1, 2), 1 - Math.exp(-2), 1e-14, 'P(1, x) = 1 − e^−x');
  near(betaI(2, 3, 0.4), 0.5248, 1e-13, 'I_0.4(2, 3) = 0.5248 (closed form)');
  near(erf(1), 0.8427007929497149, 1e-14, 'erf(1)');
  near(erfc(5), 1.5374597944280349e-12, 1e-12, 'erfc(5) keeps relative precision in the tail');
  // Distributions vs scipy.stats.
  let worst = 0, where = '';
  for (const c of FIX.dist) {
    const D = DIST[c.d];
    const cmp = (got, want, what) => {
      const e = Math.abs(got - want) / Math.max(Math.abs(want), 1e-300);
      const tol = want === 0 ? Math.abs(got) : e;
      if (tol > worst) { worst = tol; where = `${c.d} ${JSON.stringify(c.prm)} ${what}: ${got} vs ${want}`; }
    };
    if ('x' in c) { cmp(D.pdf(c.x, c.prm), c.pdf, `pdf(${c.x})`); cmp(D.cdf(c.x, c.prm), c.cdf, `cdf(${c.x})`); cmp(D.sf(c.x, c.prm), c.sf, `sf(${c.x})`); }
    else cmp(D.ppf(c.p, c.prm), c.ppf, `ppf(${c.p})`);
  }
  ok(worst < 1e-9, `distributions: pdf, cdf, sf and quantiles match scipy.stats (${FIX.dist.length} cases, worst rel. error ${worst.toExponential(1)})`, where);
  // SciPy's t quantile is off by about 2e-11 here; mpmath (30 digits)
  // gives 2.26215716279820554 for t(0.975, 9). Ours matches that.
  near(DIST.t.ppf(0.975, { df: 9 }), 2.2621571627982055, 1e-14, 't quantile (0.975, ν = 9) matches mpmath to 1e-14');
  // Descriptive.
  const d = describe(A), F = FIX.describe;
  const dk = ['mean', 'median', 'sd', 'sem', 'q1', 'q3', 'skew', 'skewAdj', 'kurt'];
  ok(dk.every(k => Math.abs(d[k] - F[k]) <= 1e-12 * Math.max(1, Math.abs(F[k]))) && Math.abs(d.ci[0] - F.ci[0]) < 1e-10 && Math.abs(d.ci[1] - F.ci[1]) < 1e-10, 'descriptive statistics match numpy/scipy (mean, median, SD, SEM, CI, Q1, Q3, skew, kurtosis)', dk.map(k => `${k} ${d[k]} vs ${F[k]}`).join('; '));
  // t-tests.
  const tt = (r, f, name) => ok(Math.abs(r.t - f.t) < 1e-12 * Math.abs(f.t) + 1e-14 && Math.abs(r.p - f.p) < 1e-10 * f.p + 1e-15 && (!f.ci || (Math.abs(r.ci[0] - f.ci[0]) < 1e-10 && Math.abs(r.ci[1] - f.ci[1]) < 1e-10)) && (!f.df || Math.abs(r.df - f.df) < 1e-10 * f.df), name, `t ${r.t} vs ${f.t}, p ${r.p} vs ${f.p}`);
  tt(ttest('one', A, [], { mu: 5 }), FIX.t1, 'one-sample t-test matches scipy (t, p, CI)');
  tt(ttest('one', A, [], { mu: 5, alt: 'greater' }), FIX.t1g, 'one-sided ("greater") one-sample t-test');
  tt(ttest('paired', A, B), FIX.tpaired, 'paired t-test matches scipy');
  tt(ttest('welch', A, B), FIX.twelch, 'Welch t-test matches scipy (t, p, df, CI)');
  tt(ttest('student', A, B), FIX.tstudent, 'Student pooled t-test matches scipy');
  tt(ttest('welch', A, C, { alt: 'less' }), FIX.twelchLess, 'one-sided ("less") Welch test');
  throws(() => ttest('paired', A, C), /equal lengths/, 'paired test with unequal lengths is an error');
  // chi-square.
  const cs = (r, f, name) => ok(Math.abs(r.chi2 - f.chi2) < 1e-12 * f.chi2 && Math.abs(r.p - f.p) < 1e-10 * f.p, name, `${r.chi2} ${r.p} vs ${f.chi2} ${f.p}`);
  cs(chisqGof([18, 22, 30, 30]), FIX.gof1, 'goodness of fit (equal cells) matches scipy');
  cs(chisqGof([18, 22, 30, 30], [20, 20, 30, 30]), FIX.gof2, 'goodness of fit (given expected) matches scipy');
  cs(chisqTable([[10, 20, 30], [15, 25, 5]]), FIX.ct1, '2 × 3 contingency table matches scipy');
  cs(chisqTable([[12, 5], [7, 15]]), FIX.ct2, '2 × 2 table without correction matches scipy');
  cs(chisqTable([[12, 5], [7, 15]], true), FIX.ct2y, '2 × 2 table with Yates correction matches scipy');
  // ANOVA, correlation.
  const an = anova1([A, B, C]);
  ok(Math.abs(an.F - FIX.anova.F) < 1e-11 * FIX.anova.F && Math.abs(an.p - FIX.anova.p) < 1e-9 * FIX.anova.p, 'one-way ANOVA matches scipy f_oneway', `${an.F} ${an.p}`);
  const pr = pearson(A, B);
  ok(Math.abs(pr.r - FIX.pearson.r) < 1e-13 && Math.abs(pr.p - FIX.pearson.p) < 1e-9 * FIX.pearson.p && Math.abs(pr.ci[0] - FIX.pearson.ci[0]) < 1e-12 && Math.abs(pr.ci[1] - FIX.pearson.ci[1]) < 1e-12, 'Pearson r, p and Fisher CI match scipy');
  const sp = spearman(FIX.spearman.x, FIX.spearman.y);
  ok(Math.abs(sp.rho - FIX.spearman.rho) < 1e-13 && Math.abs(sp.p - FIX.spearman.p) < 1e-9 * FIX.spearman.p, 'Spearman ρ with ties matches scipy');
  // Fits.
  for (const [k, f] of Object.entries(FIX.fits)) {
    const model = k === 'poly2' ? 'poly' : k === 'wlinear' ? 'linear' : k;
    const r = fitModel(model, f.x, f.y, f.sigma, { deg: f.deg || 2, expr: f.expr || '', start: f.start || '' });
    const pe = Math.max(...r.p.map((v, i) => Math.abs(v - f.p[i]) / Math.max(1e-12, Math.abs(f.p[i]))));
    const ee = Math.max(...r.err.map((v, i) => Math.abs(v - f.err[i]) / f.err[i]));
    ok(pe < 1e-6 && ee < 1e-4 && Math.abs(r.r2 - f.r2) < 1e-8, `fit "${k}" recovers SciPy curve_fit parameters (rel ${pe.toExponential(1)}) and errors (rel ${ee.toExponential(1)})`, `${r.p} vs ${f.p}; ${r.err} vs ${f.err}`);
  }
  const ex = fitModel('poly', [0, 1, 2, 3, 4], [1, 3, 9, 19, 33], null, { deg: 2 });
  ok(ex.p.every((v, i) => Math.abs(v - [1, 0, 2][i]) < 1e-12), 'exact quadratic data gives exact coefficients (1, 0, 2)');
  throws(() => fitModel('custom', [1, 2, 3], [1, 2, 3], null, { expr: '2*x' }), /no parameters/, 'a custom model with no parameters is an error');
  // Power.
  const P = FIX.power;
  FIX.power.nct.forEach(([t, df, nc, want]) => near(nctCdf(t, df, nc), want, 1e-9, `noncentral t cdf(${t}; ν=${df}, δ=${nc}) matches scipy`));
  near(solveN((n) => powerT('two', 0.5, n), 0.8), P.nTwo, 1e-6, `two-group t: n = ${P.nTwo.toFixed(4)} for d = 0.5, power 0.8 (statsmodels)`);
  near(powerT('two', 0.5, 30), P.pTwo30, 1e-8, 'two-group t: power at n = 30 (statsmodels)');
  near(solveN((n) => powerT('one', 0.3, n), 0.9), P.nOne, 1e-6, 'one-sample t: n for d = 0.3, power 0.9 (statsmodels)');
  near(powerT('one', 0.4, 25, 0.05, 'greater'), P.pOneGreater, 1e-8, 'one-sided one-sample power (statsmodels)');
  near(cohenH(0.6, 0.5), P.h, 1e-14, "Cohen's h for 0.6 vs 0.5");
  near(solveN((n) => powerProp(P.h, n), 0.8, 1), P.nProp, 1e-6, 'two proportions: n per group (statsmodels NormalIndPower)');
  const pw = TOOLS.power.run({ kind: 'two', solve: 'n', d: '0.5', p1: '0.6', p2: '0.5', alpha: '0.05', pow: '0.8', n: '30', alt: 'two-sided' });
  ok(pw.rows[0][1] === '64', 'power tool: d = 0.5 needs 64 per group');
}

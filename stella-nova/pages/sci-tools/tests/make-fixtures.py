#!/usr/bin/env python3
# ============================================================================
#  SCIENCE TOOLKIT  ·  tests/make-fixtures.py  ·  reference values from SciPy
# ----------------------------------------------------------------------------
#  Writes tests/fixtures.json. tests.mjs compares the page's own code with
#  these values. Run it once in an isolated venv (python -I) that has
#  numpy, scipy and statsmodels; the page itself never runs Python.
#  Versions used for the committed file are stored in the "versions" key.
#    python -I tests/make-fixtures.py
# ============================================================================
import json, os, sys
import numpy as np, scipy, scipy.stats as st
from scipy.optimize import curve_fit
import statsmodels
from statsmodels.stats.power import TTestIndPower, TTestPower, NormalIndPower
from statsmodels.stats.proportion import proportion_effectsize

out = {"versions": {"numpy": np.__version__, "scipy": scipy.__version__, "statsmodels": statsmodels.__version__}}
f = lambda a: [float(v) for v in a]

A = [5.1, 4.9, 6.2, 5.8, 6.0, 5.5, 5.3, 6.1, 4.7, 5.6]
B = [6.0, 5.4, 6.8, 6.1, 6.6, 5.9, 5.5, 6.9, 5.2, 6.3]
C = [4.5, 5.0, 4.8, 5.2, 4.9, 5.1]
a = np.array(A)
out["data"] = {"A": A, "B": B, "C": C}
ci = st.t.interval(0.95, len(a) - 1, loc=a.mean(), scale=st.sem(a))
out["describe"] = {"mean": a.mean(), "median": float(np.median(a)), "sd": a.std(ddof=1), "sem": float(st.sem(a)),
  "ci": f(ci), "q1": float(np.percentile(a, 25)), "q3": float(np.percentile(a, 75)),
  "skew": float(st.skew(a)), "skewAdj": float(st.skew(a, bias=False)), "kurt": float(st.kurtosis(a))}
r = st.ttest_1samp(A, 5.0); out["t1"] = {"t": r.statistic, "p": r.pvalue, "ci": f(r.confidence_interval(0.95))}
r = st.ttest_1samp(A, 5.0, alternative="greater"); out["t1g"] = {"t": r.statistic, "p": r.pvalue}
r = st.ttest_rel(A, B); out["tpaired"] = {"t": r.statistic, "p": r.pvalue, "ci": f(r.confidence_interval(0.95))}
r = st.ttest_ind(A, B, equal_var=False); out["twelch"] = {"t": r.statistic, "p": r.pvalue, "df": float(r.df), "ci": f(r.confidence_interval(0.95))}
r = st.ttest_ind(A, B, equal_var=True); out["tstudent"] = {"t": r.statistic, "p": r.pvalue, "ci": f(r.confidence_interval(0.95))}
r = st.ttest_ind(A, C, equal_var=False, alternative="less"); out["twelchLess"] = {"t": r.statistic, "p": r.pvalue}
r = st.chisquare([18, 22, 30, 30]); out["gof1"] = {"chi2": r.statistic, "p": r.pvalue}
r = st.chisquare([18, 22, 30, 30], [20, 20, 30, 30]); out["gof2"] = {"chi2": r.statistic, "p": r.pvalue}
T1 = [[10, 20, 30], [15, 25, 5]]; T2 = [[12, 5], [7, 15]]
c = st.chi2_contingency(T1, correction=False); out["ct1"] = {"chi2": c.statistic, "p": c.pvalue, "df": int(c.dof)}
c = st.chi2_contingency(T2, correction=False); out["ct2"] = {"chi2": c.statistic, "p": c.pvalue}
c = st.chi2_contingency(T2, correction=True); out["ct2y"] = {"chi2": c.statistic, "p": c.pvalue}
r = st.f_oneway(A, B, C); out["anova"] = {"F": r.statistic, "p": r.pvalue}
r = st.pearsonr(A, B); out["pearson"] = {"r": r.statistic, "p": r.pvalue, "ci": f(r.confidence_interval(0.95))}
x2 = [1, 2, 2, 3, 4, 5, 5, 6]; y2 = [2, 1, 3, 3, 5, 4, 6, 7]
r = st.spearmanr(x2, y2); out["spearman"] = {"x": x2, "y": y2, "rho": r.statistic, "p": r.pvalue}

D = []
for name, law, prm, xs, ps in [
  ("normal", st.norm(0, 1), {"mu": 0, "sigma": 1}, [-3, -1.5, 0, 0.7, 2.5, 8], [1e-10, 0.001, 0.025, 0.5, 0.9, 0.975, 0.999999]),
  ("normal", st.norm(10, 2.5), {"mu": 10, "sigma": 2.5}, [4, 10, 13.3], [0.05, 0.8]),
  ("t", st.t(3), {"df": 3}, [-4, -0.5, 0, 1.2, 10], [0.001, 0.025, 0.3, 0.975, 0.9999]),
  ("t", st.t(29.5), {"df": 29.5}, [2.045, -1], [0.975, 0.1]),
  ("chi2", st.chi2(1), {"df": 1}, [0.01, 1, 3.841458820694124, 20], [0.05, 0.95, 0.999]),
  ("chi2", st.chi2(17), {"df": 17}, [5, 17, 40], [0.01, 0.5, 0.99]),
  ("f", st.f(5, 20), {"d1": 5, "d2": 20}, [0.2, 1, 2.71, 6], [0.05, 0.5, 0.95, 0.999]),
  ("f", st.f(1, 2), {"d1": 1, "d2": 2}, [0.5, 18.5], [0.9]),
]:
  for x in xs: D.append({"d": name, "prm": prm, "x": x, "pdf": float(law.pdf(x)), "cdf": float(law.cdf(x)), "sf": float(law.sf(x))})
  for p in ps: D.append({"d": name, "prm": prm, "p": p, "ppf": float(law.ppf(p))})
for name, law, prm, ks, ps in [
  ("binom", st.binom(20, 0.3), {"n": 20, "p": 0.3}, [0, 3, 6, 12, 20], [0.01, 0.5, 0.95]),
  ("binom", st.binom(1000, 0.002), {"n": 1000, "p": 0.002}, [0, 2, 9], [0.5, 0.999]),
  ("poisson", st.poisson(4), {"lambda": 4}, [0, 2, 4, 11], [0.05, 0.5, 0.99]),
  ("poisson", st.poisson(250.5), {"lambda": 250.5}, [200, 250, 300], [0.025, 0.975]),
]:
  for k in ks: D.append({"d": name, "prm": prm, "x": k, "pdf": float(law.pmf(k)), "cdf": float(law.cdf(k)), "sf": float(law.sf(k))})
  for p in ps: D.append({"d": name, "prm": prm, "p": p, "ppf": float(law.ppf(p))})
out["dist"] = D

rng = np.random.default_rng(42)
R = lambda v: [round(float(t), 6) for t in v]
fits = {}
def cf(name, model, x, y, p0, sigma=None, extra=None):
  p, cov = curve_fit(model, np.array(x), np.array(y), p0=p0, sigma=None if sigma is None else np.array(sigma), absolute_sigma=sigma is not None, maxfev=20000, xtol=1e-14, ftol=1e-14, gtol=1e-14)
  yh = model(np.array(x), *p); ssr = float(((np.array(y) - yh) ** 2).sum()); sst = float(((np.array(y) - np.mean(y)) ** 2).sum())
  fits[name] = {"x": x, "y": y, "sigma": sigma, "p": f(p), "err": f(np.sqrt(np.diag(cov))), "r2": 1 - ssr / sst, **(extra or {})}
x = R(np.arange(10)); y = R(2.5 + 0.8 * np.array(x) + rng.normal(0, 0.3, 10))
cf("linear", lambda t, a, b: a + b * t, x, y, [1, 1])
x = R(np.linspace(-3, 3, 15)); y = R(1 - 2 * np.array(x) + 0.5 * np.array(x) ** 2 + rng.normal(0, 0.2, 15))
cf("poly2", lambda t, c0, c1, c2: c0 + c1 * t + c2 * t * t, x, y, [1, 1, 1], extra={"deg": 2})
x = R(np.linspace(0, 4, 12)); y = R(3 * np.exp(-0.7 * np.array(x)) + rng.normal(0, 0.03, 12))
cf("exp", lambda t, a, b: a * np.exp(b * t), x, y, [3, -0.5])
x = R(np.linspace(0, 5, 16)); y = R(2 * np.exp(-0.9 * np.array(x)) + 0.4 + rng.normal(0, 0.02, 16))
cf("expc", lambda t, a, b, c: a * np.exp(b * t) + c, x, y, [2, -1, 0.3])
x = R(np.linspace(1, 10, 10)); y = R(2 * np.array(x) ** 1.5 + rng.normal(0, 0.2, 10))
cf("power", lambda t, a, b: a * t ** b, x, y, [1, 1])
x = R(np.linspace(-5, 5, 31)); y = R(4 * np.exp(-(np.array(x) - 0.5) ** 2 / (2 * 1.2 ** 2)) + rng.normal(0, 0.05, 31))
cf("gauss", lambda t, A, mu, s: A * np.exp(-(t - mu) ** 2 / (2 * s * s)), x, y, [4, 0.5, 1.2])
x = R(np.linspace(-5, 5, 31)); y = R(3 * np.exp(-(np.array(x) + 1) ** 2 / (2 * 0.8 ** 2)) + 1.5 + rng.normal(0, 0.05, 31))
cf("gaussc", lambda t, A, mu, s, c: A * np.exp(-(t - mu) ** 2 / (2 * s * s)) + c, x, y, [3, -1, 0.8, 1.5])
x = R(np.linspace(0, 6, 25)); y = R(2 * np.sin(1.3 * np.array(x)) + 0.5 + rng.normal(0, 0.05, 25))
cf("custom", lambda t, a, b, c: a * np.sin(b * t) + c, x, y, [1.5, 1.2, 0], extra={"expr": "a*sin(b*x)+c", "start": "a=1.5, b=1.2, c=0"})
x = R(np.arange(1, 9)); s = R(0.1 + 0.05 * np.arange(8)); y = R(1.0 + 0.5 * np.array(x) + rng.normal(0, 1, 8) * np.array(s))
cf("wlinear", lambda t, a, b: a + b * t, x, y, [1, 1], sigma=s)
out["fits"] = fits

out["power"] = {
  "nTwo": TTestIndPower().solve_power(effect_size=0.5, alpha=0.05, power=0.8),
  "pTwo30": TTestIndPower().power(effect_size=0.5, nobs1=30, alpha=0.05),
  "nOne": TTestPower().solve_power(effect_size=0.3, alpha=0.05, power=0.9),
  "pOneGreater": TTestPower().power(effect_size=0.4, nobs=25, alpha=0.05, alternative="larger"),
  "h": float(proportion_effectsize(0.6, 0.5)),
  "nProp": NormalIndPower().solve_power(effect_size=float(proportion_effectsize(0.6, 0.5)), alpha=0.05, power=0.8),
  "nct": [[2.0, 10, 1.5, float(st.nct.cdf(2.0, 10, 1.5))], [-1.0, 4, 0.5, float(st.nct.cdf(-1.0, 4, 0.5))], [3.0, 60, 2.8, float(st.nct.cdf(3.0, 60, 2.8))]],
}

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures.json")
old = json.load(open(path)) if os.path.exists(path) else {}
old.update(out)
json.dump(old, open(path, "w"), indent=1, default=float)
print("wrote", path)

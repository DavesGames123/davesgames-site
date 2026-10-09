// Measurement and errors: propagation against analytic first-order
// results, Monte Carlo against the first order (linear formulas) and
// against the exact lognormal spread (exp), weighted mean, percent error.
import { propagate, weightedMean, parseVars, TOOLS } from '../tools/measure.js';

export default function ({ ok, near, throws }) {
  const P = (f, v, n = 200000) => propagate(f, parseVars(v), { n });
  let r = P('a + b', 'a = 1 ± 0.3\nb = 2 ± 0.4');
  near(r.y, 3, 1e-15, 'a + b: value 3');
  near(r.sLin, 0.5, 1e-9, 'a + b: u = sqrt(0.3² + 0.4²) = 0.5');
  near(r.mc.sd, 0.5, 0.01, 'a + b: Monte Carlo SD within 1 % of 0.5');
  near(r.mc.mean, 3, 0.002, 'a + b: Monte Carlo mean within 0.2 % of 3');
  r = P('a*b', 'a = 2 ± 0.02\nb = 3 ± 0.06');
  near(r.sLin, 6 * Math.hypot(0.01, 0.02), 1e-9, 'a·b: relative uncertainties add in quadrature');
  r = P('a/b', 'a = 5 ± 0.1\nb = 2 ± 0.05');
  near(r.sLin, 2.5 * Math.hypot(0.02, 0.025), 1e-9, 'a/b: relative uncertainties add in quadrature');
  r = P('x^2', 'x = 3 ± 0.1');
  near(r.sLin, 0.6, 1e-9, 'x²: u = 2 x u(x) = 0.6');
  r = P('sin(x)', 'x = 1 ± 0.01');
  near(r.sLin, Math.cos(1) * 0.01, 1e-9, 'sin x: u = cos(x) u(x)');
  r = P('g = 4*pi^2*L/T^2', 'L = 1.0000 ± 0.0020\nT = 2.0060 ± 0.0040');
  const g = 4 * Math.PI ** 2 / 2.006 ** 2;
  near(r.y, g, 1e-14, 'pendulum: g = 4π²L/T² = 9.8107');
  near(r.sLin, g * Math.hypot(0.002, 2 * 0.004 / 2.006), 1e-9, 'pendulum: u(g)/g = sqrt((u_L/L)² + (2u_T/T)²)');
  ok(r.name === 'g' && r.budget.length === 2, 'pendulum: named result and a two-line budget');
  near(r.budget.find(b => b.k === 'T').share, (2 * 0.004 / 2.006) ** 2 / ((0.002) ** 2 + (2 * 0.004 / 2.006) ** 2), 1e-6, 'pendulum: T share of the variance');
  r = P('exp(x)', 'x = 0 ± 0.5');
  near(r.sLin, 0.5, 1e-9, 'exp x at 0: first-order u = 0.5');
  const lnSd = Math.sqrt((Math.exp(0.25) - 1) * Math.exp(0.25));
  near(r.mc.sd, lnSd, 0.02, `exp x: Monte Carlo SD matches the lognormal SD ${lnSd.toFixed(5)} (2 %)`);
  near(r.mc.mean, Math.exp(0.125), 0.01, 'exp x: Monte Carlo mean matches exp(σ²/2) (1 %)');
  const r1 = P('a*b', 'a = 2 ± 0.1\nb = 3 ± 0.1', 20000), r2 = P('a*b', 'a = 2 ± 0.1\nb = 3 ± 0.1', 20000);
  ok(r1.mc.mean === r2.mc.mean, 'Monte Carlo is seeded: two runs give the same draws');
  throws(() => P('a*b', 'a = 1 ± 0.1'), /No value for b/, 'a missing input is named');
  const w = weightedMean([[1, 1], [3, 1]]);
  near(w.mean, 2, 1e-15, 'weighted mean of 1 ± 1 and 3 ± 1 is 2');
  near(w.sigma, Math.SQRT1_2, 1e-15, 'its uncertainty is 1/√2');
  near(w.chi2, 2, 1e-15, 'χ² = 2');
  near(w.p, 0.15729920705028513, 1e-12, 'p = P(χ²₁ ≥ 2) = erfc(1) = 0.1572992071');
  const w2 = weightedMean([[10, 0.1], [20, 0.2]]);
  near(w2.mean, (10 / 0.01 + 20 / 0.04) / (1 / 0.01 + 1 / 0.04), 1e-15, 'weights are 1/u²');
  const pe = (m, a, u = '') => TOOLS['pct-error'].run({ m, a, u }).rows;
  near(Number(pe('9.72 m/s^2', '9.80665 m/s^2')[0][1].replace(' %', '')), 100 * (9.72 - 9.80665) / 9.80665, 1e-5, 'percent error 9.72 vs 9.80665 m/s²');
  near(Number(pe('32.0 ft/s^2', '9.80665 m/s^2')[0][1].replace(' %', '')), 100 * (32 * 0.3048 - 9.80665) / 9.80665, 1e-5, 'percent error across units (ft/s² vs m/s²)');
  throws(() => pe('9.7 m/s', '9.80665 m/s^2'), /cannot be compared/, 'percent error: a dimension mismatch is an error');
  const z = pe('9.72 m/s^2', '9.80665 m/s^2', '0.05 m/s^2').find(x => x[0].startsWith('Deviation'));
  near(Number(z[1]), 0.08665 / 0.05, 1e-4, 'deviation in units of u: 1.733');
}

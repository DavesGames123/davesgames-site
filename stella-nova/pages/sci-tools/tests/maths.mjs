// Maths and numerics: Brent roots, quadrature, derivatives, matrices vs
// NumPy, complex identities, FFT of known signals and vs NumPy, spline and
// Savitzky–Golay vs SciPy, bases and IEEE 754.
import { brent, roots, integrate, deriv } from '../core/numeric.js';
import { fn1 } from '../core/expr.js';
import { det, inv, solve, eig, eigSym, rank } from '../core/linalg.js';
import { evalC } from '../core/complex.js';
import { fft, spectrum, spline, savgol } from '../core/signal.js';
import { TOOLS, float754, parseInt36 } from '../tools/maths.js';

export default function ({ ok, near, throws, FIX }) {
  near(brent(fn1('x^2 - 2'), 0, 2).x, Math.SQRT2, 1e-15, 'Brent: √2 from x² − 2');
  near(brent(fn1('cos(x) - x'), 0, 1).x, 0.7390851332151607, 1e-15, 'Brent: Dottie number 0.7390851332151607');
  near(brent(fn1('x^3 - 2x - 5'), 2, 3).x, 2.0945514815423265, 1e-15, "Brent: Wallis' cubic root 2.0945514815423265");
  near(brent(fn1('(x - 5) exp(x) + 5'), 1, 10).x, 4.965114231744276, 1e-14, 'Brent: Wien x = 4.965114231744276');
  const tr = roots(fn1('tan(x) - x'), 0.1, 10, 2000);
  ok(tr.length === 2 && Math.abs(tr[0] - 4.493409457909064) < 1e-12 && Math.abs(tr[1] - 7.725251836937707) < 1e-12, 'all roots of tan x = x in (0.1, 10): 4.4934 and 7.7253 only (the 3 poles rejected)', tr.join(' '));
  throws(() => brent(fn1('x^2 + 1'), -1, 1), /same sign/, 'Brent: a bracket with no sign change is an error');
  near(integrate(Math.sin, 0, Math.PI).value, 2, 1e-14, '∫₀^π sin x dx = 2');
  near(integrate(fn1('4/(1+x^2)'), 0, 1).value, Math.PI, 1e-14, '∫₀¹ 4/(1+x²) dx = π');
  near(integrate(fn1('exp(-x^2)'), -Infinity, Infinity).value, Math.sqrt(Math.PI), 1e-12, '∫ e^{−x²} over ℝ = √π');
  near(integrate(fn1('x^3/(exp(x)-1)'), 1e-12, Infinity).value, Math.PI ** 4 / 15, 1e-10, '∫₀^∞ x³/(eˣ−1) dx = π⁴/15');
  near(integrate(fn1('1/sqrt(x)'), 0, 1).value, 2, 1e-7, '∫₀¹ x^(−1/2) dx = 2 (end-point singularity)');
  near(deriv(Math.sin, 0).value, 1, 1e-12, 'd/dx sin x at 0 = 1');
  near(deriv(Math.exp, 1).value, Math.E, 1e-12, 'd/dx eˣ at 1 = e');
  near(deriv(Math.exp, 1, 2).value, Math.E, 1e-8, 'd²/dx² eˣ at 1 = e');
  const M = FIX.matrix;
  near(det(M.M1), M.detM1, 1e-12, 'det of a 4×4 matches NumPy');
  const maxErr = (A, B) => Math.max(...A.flat().map((v, i) => Math.abs(v - B.flat()[i])));
  ok(maxErr(inv(M.M1), M.invM1) < 1e-14 && maxErr(inv(M.M2), M.invM2) < 1e-13, 'inverses match NumPy (4×4 and 3×3)');
  ok(Math.max(...solve(M.M1, [1, 2, 3, 4]).map((v, i) => Math.abs(v - M.solveM1[i]))) < 1e-14, 'solve A x = b matches NumPy');
  const e = eig(M.NS);
  ok(e.length === 4 && e.every((z, i) => Math.abs(z[0] - M.eigNS[i][0]) < 1e-12 && Math.abs(z[1] - M.eigNS[i][1]) < 1e-12), 'eigenvalues of a non-symmetric 4×4 (with a complex pair) match NumPy', JSON.stringify(e));
  const es = eigSym(M.S4);
  ok(es.values.every((v, i) => Math.abs(v - M.eigS4[i]) < 1e-12), 'symmetric eigenvalues (Jacobi) match NumPy eigvalsh');
  const v0 = es.vectors[0], Av = M.S4.map(r => r.reduce((s, a, k) => s + a * v0[k], 0));
  ok(Av.every((x, i) => Math.abs(x - es.values[0] * v0[i]) < 1e-12), 'Jacobi eigenvector satisfies A v = λ v');
  ok(rank([[1, 2, 3], [2, 4, 6], [1, 0, 1]]) === M.rankDef, 'rank of a rank-deficient 3×3 = 2');
  throws(() => inv([[1, 2], [2, 4]]), /singular/, 'a singular inverse is an error');
  const c = (s) => evalC(s);
  const cz = (s, re, im, name) => { const z = c(s); ok(Math.abs(z[0] - re) < 1e-15 && Math.abs(z[1] - im) < 1e-15, name, `${z}`); };
  cz('exp(i pi) + 1', 0, 1.2246467991473532e-16, "e^{iπ} + 1 = 0 (to 1.2e-16)");
  cz('sqrt(-4)', 0, 2, '√−4 = 2i');
  cz('(1+2i)(3-i)', 5, 5, '(1 + 2i)(3 − i) = 5 + 5i');
  cz('(1+i)^4', -4, 0, '(1 + i)⁴ = −4 exactly');
  cz('i^i', Math.exp(-Math.PI / 2), 0, 'iⁱ = e^{−π/2}');
  cz('ln(-1)', 0, Math.PI, 'ln(−1) = iπ (principal branch)');
  // FFT.
  const F = fft(FIX.fft.x);
  ok(F.re.every((v, k) => Math.abs(v - FIX.fft.re[k]) < 1e-12 && Math.abs(F.im[k] - FIX.fft.im[k]) < 1e-12), 'FFT of N = 37 (Bluestein) matches numpy.fft');
  const x64 = Array.from({ length: 64 }, (_, n) => Math.cos(2 * Math.PI * 5 * n / 64));
  const F64 = fft(x64);
  ok(Math.abs(F64.re[5] - 32) < 1e-12 && Math.abs(F64.re[59] - 32) < 1e-12 && F64.re.every((v, k) => k === 5 || k === 59 || Math.abs(v) < 1e-12), 'FFT of cos(2π·5n/64): 32 in bins 5 and 59, 0 elsewhere');
  const sig = Array.from({ length: 1000 }, (_, n) => Math.sin(2 * Math.PI * 50 * n / 1000) + 0.5 * Math.sin(2 * Math.PI * 120 * n / 1000));
  const sp = spectrum(sig, 1000, { window: 'none' });
  ok(Math.abs(sp.peaks[0].f - 50) < 1e-9 && Math.abs(sp.peaks[0].amp - 1) < 1e-9 && Math.abs(sp.peaks[1].f - 120) < 1e-9 && Math.abs(sp.peaks[1].amp - 0.5) < 1e-9, 'spectrum: 50 Hz amplitude 1 and 120 Hz amplitude 0.5 (N = 1000, Bluestein)');
  const sh = spectrum(sig, 1000, { window: 'hann' });
  ok(Math.abs(sh.peaks[0].amp - 1) < 1e-6 && Math.abs(sh.peaks[1].amp - 0.5) < 1e-6, 'spectrum with Hann window: amplitudes corrected by the coherent gain');
  const off = Array.from({ length: 1024 }, (_, n) => Math.sin(2 * Math.PI * 37.3 * n / 1024));
  ok(Math.abs(spectrum(off, 1024, { window: 'hann' }).peaks[0].f - 37.3) < 0.02, 'spectrum: an off-bin tone at 37.3 Hz is located within 0.02 Hz by interpolation');
  // Spline, Savitzky–Golay.
  const s = spline(FIX.spline.x, FIX.spline.y);
  ok(FIX.spline.q.every((t, i) => Math.abs(s(t) - FIX.spline.v[i]) < 1e-13), 'natural cubic spline matches SciPy CubicSpline(bc_type="natural")');
  const sg7 = savgol(FIX.savgol.y, 7, 2), sg9 = savgol(FIX.savgol.y, 9, 3);
  ok(sg7.every((v, i) => Math.abs(v - FIX.savgol.w7p2[i]) < 1e-12) && sg9.every((v, i) => Math.abs(v - FIX.savgol.w9p3[i]) < 1e-12), 'Savitzky–Golay (7, 2) and (9, 3) match SciPy savgol_filter, edges included');
  // Bases and IEEE 754.
  ok(parseInt36('0xFF', 0).v === 255n && parseInt36('-0b101', 0).v === -5n && parseInt36('zz', 36).v === 1295n, 'base parsing: 0xFF, −0b101, zz (base 36)');
  const b8 = TOOLS.base.run({ x: '-5', from: '10', bits: '8', op: 'none', y: '', fl: '' });
  ok(b8.rows.find(r => r[0].startsWith('8-bit'))[1] === '1111 1011', "−5 in 8-bit two's complement is 1111 1011");
  const andr = TOOLS.base.run({ x: '0b10110110', from: '0', bits: '8', op: 'and', y: '0x0F', fl: '' });
  ok(andr.rows[0][1] === '6', '0b10110110 AND 0x0F = 6');
  const big = TOOLS.base.run({ x: '18446744073709551615', from: '10', bits: '64', op: 'none', y: '', fl: '' });
  ok(big.rows[1][1] === 'FFFFFFFFFFFFFFFF', '2⁶⁴ − 1 is FFFFFFFFFFFFFFFF (BigInt, exact)');
  ok(float754(0.1, 64).hex === '3fb999999999999a' && float754(0.1, 32).hex === '3dcccccd' && float754(-2, 64).hex === 'c000000000000000', 'IEEE 754: 0.1 is 0x3FB999999999999A (double) and 0x3DCCCCCD (single)');
  // Calculator.
  near(parseFloat(TOOLS.calc.run({ e: '0.5 * 1200 kg * (27 m/s)^2', to: 'kJ', vars: '' }).rows[0][1]), 437.4, 1e-12, 'calculator: ½ m v² with units = 437.4 kJ');
  near(parseFloat(TOOLS.calc.run({ e: '4 pi $eps0 $hbar^2 / ($me $qe^2)', to: 'pm', vars: '' }).rows[0][1]), 52.9177210544, 1e-9, 'calculator: Bohr radius from constants = 52.9177210544 pm (CODATA 2022)');
  throws(() => TOOLS.calc.run({ e: '1 m + 1 s', to: '', vars: '' }), /Cannot add/, 'calculator: adding metres and seconds is an error');
}

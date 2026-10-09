// ============================================================================
//  SCIENCE TOOLKIT  ·  tools/maths.js  ·  maths and numerics
// ----------------------------------------------------------------------------
//  Tool definitions for the "maths" category (contract: tools/units.js).
//
//  GREP MAP
//    grep -n "calc:"  "roots:"  "integrate:"  "matrix:"  "base:"
//    grep -n "complex:"  "fft:"  "interp:"
//    grep -n "export function float754"   IEEE 754 bit view
// ============================================================================
import { parse, fn1, compile } from '../core/expr.js';
import { evalQty, qty, dimText, dimName, named } from '../core/units.js';
import { brent, roots, integrate, deriv } from '../core/numeric.js';
import { parseMatrix, det, inv, solve, mul, T, rank, eig, eigSym, isSym } from '../core/linalg.js';
import { evalC, C } from '../core/complex.js';
import { spectrum, spline, linear, movingAvg, savgol } from '../core/signal.js';
import { fmt, esc, num, nums, plot, linspace } from '../kit.js';
import { xyRows } from './stats.js';

const blank = (s) => !String(s ?? '').trim();
const cfmt = ([re, im], s = 10) => {
  const z = (v) => Math.abs(v) < 1e-15 * Math.max(1, Math.abs(re), Math.abs(im)) ? 0 : v;
  const a = z(re), b = z(im);
  if (b === 0) return fmt(a, s);
  if (a === 0) return `${fmt(b, s)}i`;
  return `${fmt(a, s)} ${b < 0 ? '−' : '+'} ${fmt(Math.abs(b), s)}i`;
};
const matHtml = (M, s = 8) => `<table class="t mat"><tbody>${M.map(r => `<tr>${r.map(v => `<td class="num">${esc(typeof v === 'string' ? v : fmt(v, s))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const matText = (M, s = 12) => M.map(r => r.map(v => fmt(v, s)).join('\t')).join('\n');

// IEEE 754 view of a number: sign, exponent and fraction bits.
export function float754(x, bits = 64) {
  const buf = new ArrayBuffer(8), dv = new DataView(buf);
  if (bits === 32) dv.setFloat32(0, x); else dv.setFloat64(0, x);
  const n = bits / 8;
  const bytes = [...new Uint8Array(buf, 0, n)];
  const bin = bytes.map(b => b.toString(2).padStart(8, '0')).join('');
  const eb = bits === 32 ? 8 : 11;
  const stored = bits === 32 ? dv.getFloat32(0) : dv.getFloat64(0);
  return { hex: bytes.map(b => b.toString(16).padStart(2, '0')).join(''), sign: bin[0], exp: bin.slice(1, 1 + eb), frac: bin.slice(1 + eb), stored, bias: bits === 32 ? 127 : 1023, e: parseInt(bin.slice(1, 1 + eb), 2) };
}

// Parse an integer in base 2-36 (prefixes 0x, 0o, 0b), with sign, to BigInt.
export function parseInt36(text, base) {
  let t = String(text).trim().replace(/[_\s]/g, '').toLowerCase();
  let neg = false;
  if (t.startsWith('-')) { neg = true; t = t.slice(1); }
  if (base === 0) {
    if (t.startsWith('0x')) { base = 16; t = t.slice(2); } else if (t.startsWith('0b')) { base = 2; t = t.slice(2); } else if (t.startsWith('0o')) { base = 8; t = t.slice(2); } else base = 10;
  }
  if (!t) throw new Error('Enter a number.');
  let v = 0n;
  const B = BigInt(base);
  for (const ch of t) {
    const d = parseInt(ch, 36);
    if (Number.isNaN(d) || d >= base) throw new Error(`"${ch}" is not a digit in base ${base}.`);
    v = v * B + BigInt(d);
  }
  return { v: neg ? -v : v, base };
}
const toBase = (v, b) => (v < 0n ? '-' + (-v).toString(b) : v.toString(b));
const group = (s, n) => s.replace(new RegExp(`\\B(?=(.{${n}})+$)`, 'g'), ' ');

export const TOOLS = {
  calc: {
    inputs: [
      { k: 'e', label: 'Expression', def: '0.5 * 1200 kg * (27 m/s)^2', w: 3, hint: 'units, $constants, functions; for example sqrt(2 * 9.81 m/s^2 * 10 m)' },
      { k: 'to', label: 'Show in unit (optional)', def: 'kJ' },
      { k: 'vars', label: 'Variables (optional), one per line', type: 'area', rows: 2, def: '', hint: 'm = 1200 kg; a name hides a unit of the same name in the expression' },
    ],
    examples: [
      { label: 'free-fall speed', v: { e: 'sqrt(2 * 9.81 m/s^2 * 10 m)', to: 'km/h' } },
      { label: 'Bohr radius', v: { e: '4 pi $eps0 $hbar^2 / ($me $qe^2)', to: 'pm' } },
      { label: 'plain numbers', v: { e: 'sin(pi/6) + ln(e^2) + 2^10', to: '' } },
      { label: 'with variables', v: { e: 'm g h', to: 'J', vars: 'm = 75 kg\ng = 9.81 m/s^2\nh = 3.2 m' } },
    ],
    run({ e, to, vars }) {
      const scope = {};
      for (const line of String(vars).split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
        if (!m) throw new Error(`Cannot read "${line}". Write: m = 1200 kg`);
        // A definition reads units only, so "m = 75 kg" then "g = 9.81 m/s^2" keeps m as metre there.
        scope[m[1]] = evalQty(parse(m[2]), {});
      }
      const Q = evalQty(parse(e), scope);
      const rows = [];
      if (!blank(to)) {
        const t = qty(to);
        if (!Q.d.every((x, i) => Math.abs(x - t.d[i]) < 1e-9)) throw new Error(`The result is ${dimName(Q.d)} [${dimText(Q.d)}]; it cannot be shown in ${to}.`);
        rows.push(['Result', `${fmt(Q.v / t.v, 12)} ${to.trim()}`]);
      }
      const nm = named(Q.d);
      rows.push(['In SI base units', `${fmt(Q.v, 12)}${dimText(Q.d) === '1' ? '' : ' ' + dimText(Q.d)}`]);
      if (nm) rows.push(['As a named unit', `${fmt(Q.v, 12)} ${nm}`]);
      rows.push(['Dimension', dimName(Q.d)]);
      return { rows, copy: rows[0][1] };
    },
    tex: ['[\\,a\\,b\\,] = [a][b],\\quad [\\,a + b\\,] \\text{ needs } [a] = [b],\\quad [\\,a^p\\,] = [a]^p', '\\text{precedence: } {}^\\wedge \\;>\\; \\text{juxtaposition} \\;>\\; \\text{unary } - \\;>\\; \\times\\,\\div \\;>\\; +\\,-'],
    how: 'Each number carries its SI value and a dimension vector. Products add dimension exponents; sums and differences need equal dimensions; functions such as sin and exp need a pure number. Juxtaposition binds tighter than "/", so "J/mol K" is J/(mol K). Constants: $c, $h, $hbar, $kB, $NA, $qe, $me, $mp, $G, $eps0, $mu0 and the other ids of the constants table.',
    refs: ['BIPM SI Brochure, 9th ed. (2019), §5.4 (quantity calculus).', 'CODATA 2022 (NIST) for the $ constants.'],
  },

  roots: {
    inputs: [
      { k: 'f', label: 'f(x) = 0, or an equation in x', def: 'cos(x) = x', w: 3, hint: 'for example x^3 - 2x - 5, or tan(x) = x' },
      { k: 'a', label: 'From a', def: '0' }, { k: 'b', label: 'To b', def: '2' },
      { k: 'mode', label: 'Find', type: 'select', def: 'all', opts: [['all', 'every root in [a, b] (scan + Brent)'], ['one', 'one root in the bracket [a, b] (Brent)']] },
    ],
    examples: [
      { label: "Wallis' cubic", v: { f: 'x^3 - 2x - 5', a: '2', b: '3', mode: 'one' } },
      { label: 'tan x = x', v: { f: 'tan(x) = x', a: '0.1', b: '10', mode: 'all' } },
      { label: 'Wien constant', v: { f: '(x - 5) exp(x) + 5', a: '1', b: '10', mode: 'all' } },
      { label: 'no sign change', v: { f: 'x^2 + 1', a: '-1', b: '1', mode: 'one' }, err: true },
    ],
    run({ f, a, b, mode }) {
      const F = fn1(f), A = num(a), B = num(b);
      if (!(B > A)) throw new Error('b must be greater than a.');
      let rs, note = '';
      if (mode === 'one') { const r = brent(F, A, B); rs = [r.x]; note = `${r.iter} iterations`; }
      else { rs = roots(F, A, B, 2000); note = 'scan of 2000 cells; a double root with no sign change is not found'; }
      if (!rs.length) throw new Error('No root in [a, b]: f does not change sign on the scan grid.');
      const rows = rs.slice(0, 50).map((x, i) => [`Root ${i + 1}`, fmt(x, 15), `f(x) = ${fmt(F(x), 3)}`]);
      rows.push(['Method', mode === 'one' ? 'Brent' : 'scan + Brent', note]);
      const xs = linspace(A, B, 600), ys = xs.map(F);
      const sorted = ys.filter(Number.isFinite).map(Math.abs).sort((p, q) => p - q);
      const lim = (sorted[Math.floor(sorted.length * 0.9)] || 1) * 1.5;
      const svg = plot([{ x: xs, y: ys.map(y => Math.abs(y) > lim * 4 ? NaN : y) }, { x: rs, y: rs.map(() => 0), type: 'scatter', r: 4, color: '#ffd666' }], { xlabel: 'x', ylabel: 'f(x)', hlines: [{ y: 0, color: '#8fa3a8' }], yr: [-lim, lim], title: 'f(x) with the roots' });
      return { rows, svg, copy: rs.map(x => fmt(x, 15)).join('\n') };
    },
    tex: ['f(a)\\,f(b) < 0 \\;\\Rightarrow\\; \\exists\\, x^* \\in (a,b):\\ f(x^*) = 0', 'x_{k+1} = \\text{inverse quadratic interpolation, secant, or bisection (Brent)}'],
    how: 'Brent\'s method keeps a bracket with a sign change and takes an inverse quadratic or secant step when it is safe, else a bisection step. It always converges and is usually superlinear. "Every root" scans [a, b] in 2000 cells and refines each sign change; poles that change sign are rejected when f does not go to 0 there.',
    refs: ['R. P. Brent, Algorithms for Minimization without Derivatives (1973), ch. 4.', 'G. E. Forsythe, M. A. Malcolm and C. B. Moler, Computer Methods for Mathematical Computations (1977), zeroin.'],
  },

  integrate: {
    inputs: [
      { k: 'f', label: 'f(x)', def: 'exp(-x^2)', w: 3 },
      { k: 'a', label: 'From a', def: '-inf', hint: 'inf allowed' }, { k: 'b', label: 'To b', def: 'inf' },
      { k: 'x0', label: 'Derivatives at x₀ (optional)', def: '0.5' },
    ],
    examples: [
      { label: '∫₀^π sin', v: { f: 'sin(x)', a: '0', b: 'pi', x0: '0' } },
      { label: '4/(1+x²) on [0,1]', v: { f: '4/(1+x^2)', a: '0', b: '1', x0: '1' } },
      { label: 'Planck integral', v: { f: 'x^3/(exp(x)-1)', a: '1e-12', b: 'inf', x0: '' } },
    ],
    run({ f, a, b, x0 }) {
      const F = fn1(f);
      const lim = (s) => { const t = String(s).trim().toLowerCase(); if (/^\+?(inf|infinity|∞)$/.test(t)) return Infinity; if (/^-(inf|infinity|∞)$/.test(t)) return -Infinity; return compile(parse(s))({}); };
      const A = lim(a), B = lim(b);
      const r = integrate(F, A, B, { tol: 1e-13 });
      if (!Number.isFinite(r.value)) throw new Error('The integral does not converge to a finite value.');
      const rows = [['∫ f(x) dx', fmt(r.value, 15)], ['Error estimate', fmt(r.err, 3)], ['Function evaluations', String(r.evals)]];
      if (r.warn) rows.push(['Warning', r.warn + ': the integrand may be singular or oscillate.']);
      if (!blank(x0)) {
        const X = num(x0), d1 = deriv(F, X, 1), d2 = deriv(F, X, 2);
        rows.push([`f(${fmt(X, 6)})`, fmt(F(X), 15)], [`f′(${fmt(X, 6)})`, fmt(d1.value, 13), `error ≈ ${fmt(d1.err, 2)}`], [`f″(${fmt(X, 6)})`, fmt(d2.value, 11), `error ≈ ${fmt(d2.err, 2)}`]);
      }
      const lo = Number.isFinite(A) ? A : (Number.isFinite(B) ? B - 10 : -5), hi = Number.isFinite(B) ? B : lo + 10;
      const xs = linspace(lo, hi, 400);
      const svg = plot([{ x: xs, y: xs.map(F), type: 'area' }], { xlabel: 'x', ylabel: 'f(x)', title: Number.isFinite(A) && Number.isFinite(B) ? 'The shaded area is the integral' : 'f(x) over part of the range' });
      return { rows, svg, copy: fmt(r.value, 15) };
    },
    tex: ['\\int_a^b f(x)\\,dx \\approx \\sum_{k=1}^{15} w_k f(x_k)\\ \\ \\text{(Gauss–Kronrod 7–15, adaptive)}', 'x = \\frac{t}{1-t^2}\\ \\ \\text{maps } (-\\infty,\\infty) \\text{ to } (-1, 1)', 'f\'(x) \\approx \\frac{f(x+h) - f(x-h)}{2h},\\ \\ h \\to 0 \\text{ by Richardson extrapolation (Ridders)}'],
    how: 'The integrator bisects the interval with the largest Gauss–Kronrod error estimate until the total estimate is below 1e-13 of the result, as QUADPACK\'s QAG. Infinite limits map to a finite interval first. Derivatives use Ridders\' table of central differences with decreasing steps, which gives an error estimate too.',
    refs: ['R. Piessens et al., QUADPACK (1983), qag and qk15.', 'C. J. F. Ridders, Adv. Eng. Software 4, 75 (1982).', 'W. H. Press et al., Numerical Recipes, 3rd ed. (2007), §4.7 and §5.7.'],
  },

  matrix: {
    inputs: [
      { k: 'op', label: 'Operation', type: 'select', def: 'eig', opts: [['det', 'determinant'], ['inv', 'inverse'], ['eig', 'eigenvalues (and vectors if symmetric)'], ['solve', 'solve A x = b'], ['mul', 'product A · B'], ['add', 'A + B'], ['sub', 'A − B'], ['T', 'transpose'], ['rank', 'rank and trace']] },
      { k: 'A', label: 'Matrix A (rows on lines)', type: 'area', rows: 4, def: '2 -1 0\n-1 2 -1\n0 -1 2' },
      { k: 'B', label: 'Matrix B or vector b (for solve, product, sum)', type: 'area', rows: 3, def: '1\n0\n1' },
    ],
    examples: [
      { label: 'complex eigenvalues', v: { op: 'eig', A: '0 -1 0\n1 0 0\n0 0 2' } },
      { label: 'solve a system', v: { op: 'solve', A: '3 2 -1\n2 -2 4\n-1 0.5 -1', B: '1\n-2\n0' } },
      { label: 'inverse', v: { op: 'inv', A: '4 7\n2 6' } },
      { label: 'singular', v: { op: 'inv', A: '1 2\n2 4' }, err: true },
    ],
    run({ op, A, B }) {
      const M = parseMatrix(A);
      const need = () => parseMatrix(B);
      if (op === 'det') { const d = det(M); return { rows: [['det A', fmt(d, 14)]], copy: fmt(d, 14) }; }
      if (op === 'inv') { const I = inv(M); return { rows: [['A⁻¹', `${I.length}×${I.length}`]], html: matHtml(I), copy: matText(I) }; }
      if (op === 'T') { const t = T(M); return { rows: [['Aᵀ', `${t.length}×${t[0].length}`]], html: matHtml(t), copy: matText(t) }; }
      if (op === 'rank') {
        const r = rank(M), tr = M.length === M[0].length ? M.reduce((s, row, i) => s + row[i], 0) : NaN;
        return { rows: [['Rank', String(r)], ['Trace', Number.isFinite(tr) ? fmt(tr, 14) : 'not square'], ['Size', `${M.length}×${M[0].length}`]], copy: String(r) };
      }
      if (op === 'eig') {
        if (isSym(M)) {
          const { values, vectors } = eigSym(M);
          const rows = values.map((v, i) => [`λ${i + 1}`, fmt(v, 14)]);
          rows.push(['Note', 'A is symmetric: real eigenvalues; columns below are unit eigenvectors in the same order (Jacobi).']);
          const V = M.map((_, r) => vectors.map(v => v[r]));
          return { rows, html: matHtml(V, 10), copy: values.map(v => fmt(v, 14)).join('\n') };
        }
        const ev = eig(M);
        const rows = ev.map((z, i) => [`λ${i + 1}`, cfmt(z, 12)]);
        rows.push(['Note', 'A is not symmetric: eigenvalues from the shifted QR algorithm; eigenvectors are not shown.']);
        return { rows, copy: ev.map(z => cfmt(z, 14)).join('\n') };
      }
      if (op === 'solve') {
        const b = need();
        const rhs = b[0].length === 1 ? b.map(r => r[0]) : b.length === 1 ? b[0] : b;
        const x = solve(M, rhs);
        const xs = Array.isArray(x[0]) ? x : x.map(v => [v]);
        const resid = Math.max(...mul(M, xs).map((r, i) => Math.max(...r.map((v, j) => Math.abs(v - (Array.isArray(rhs[0]) ? rhs[i][j] : rhs[i]))))));
        return { rows: [['x', xs.map(r => r.map(v => fmt(v, 12)).join(' ')).join(';  ')], ['Largest residual |Ax − b|', fmt(resid, 3)]], html: matHtml(xs, 12), copy: matText(xs) };
      }
      const N = need();
      if (op === 'mul') { const P = mul(M, N); return { rows: [['A · B', `${P.length}×${P[0].length}`]], html: matHtml(P), copy: matText(P) }; }
      if (M.length !== N.length || M[0].length !== N[0].length) throw new Error('A and B need the same size.');
      const S = M.map((r, i) => r.map((v, j) => op === 'add' ? v + N[i][j] : v - N[i][j]));
      return { rows: [[op === 'add' ? 'A + B' : 'A − B', `${S.length}×${S[0].length}`]], html: matHtml(S), copy: matText(S) };
    },
    tex: ['\\det A = (-1)^{s}\\prod_i U_{ii}\\quad (PA = LU)', 'A\\mathbf v = \\lambda\\mathbf v,\\qquad A^{-1} = U^{-1}L^{-1}P'],
    how: 'Determinant, inverse and solve use LU decomposition with partial pivoting; a pivot below 1e-14 of the largest entry is reported as singular. Rank uses elimination with full pivoting and a tolerance. A symmetric matrix gets real eigenvalues and orthonormal eigenvectors by cyclic Jacobi rotations; a general matrix is balanced, reduced to Hessenberg form and solved by the shifted QR algorithm, which also finds complex pairs.',
    refs: ['G. H. Golub and C. F. Van Loan, Matrix Computations, 4th ed. (2013), ch. 3, 7 and 8.', 'W. H. Press et al., Numerical Recipes, 3rd ed. (2007), §2.3, §11.1, §11.6-11.7.', 'Results checked against NumPy (numpy.linalg).'],
  },

  base: {
    inputs: [
      { k: 'x', label: 'Number', def: '0xFF', hint: 'prefix 0x, 0o or 0b, or choose the base' },
      { k: 'from', label: 'Base of the input', def: '0', hint: '0 = from the prefix (else 10); 2 to 36' },
      { k: 'bits', label: 'Bit width', type: 'select', def: '32', opts: [['8', '8'], ['16', '16'], ['32', '32'], ['64', '64']] },
      { k: 'op', label: 'Bit operation', type: 'select', def: 'none', opts: [['none', 'none'], ['and', 'AND'], ['or', 'OR'], ['xor', 'XOR'], ['not', 'NOT'], ['shl', 'shift left'], ['shr', 'shift right (logical)'], ['sar', 'shift right (arithmetic)']] },
      { k: 'y', label: 'Second operand or shift', def: '0x0F' },
      { k: 'fl', label: 'IEEE 754 view of a decimal (optional)', def: '0.1' },
    ],
    examples: [{ label: 'negative in 8 bits', v: { x: '-5', from: '10', bits: '8', op: 'none' } }, { label: 'mask', v: { x: '0b10110110', op: 'and', y: '0x0F', bits: '8' } }, { label: 'base 36', v: { x: 'zz', from: '36', op: 'none' } }],
    run({ x, from, bits, op, y, fl }) {
      const W = BigInt(bits), mask = (1n << W) - 1n;
      let { v } = parseInt36(x, Math.round(num(from)));
      if (op !== 'none') {
        const b = op === 'not' ? 0n : parseInt36(y, 0).v;
        const u = (t) => t & mask;
        if (op === 'and') v = u(v) & u(b); else if (op === 'or') v = u(v) | u(b); else if (op === 'xor') v = u(v) ^ u(b);
        else if (op === 'not') v = ~u(v) & mask;
        else if (op === 'shl') v = (u(v) << b) & mask; else if (op === 'shr') v = u(v) >> b;
        else if (op === 'sar') { const s = u(v) >= (1n << (W - 1n)) ? u(v) - (1n << W) : u(v); v = (s >> b) & mask; }
      }
      const twos = v & mask;
      const signed = twos >= (1n << (W - 1n)) ? twos - (1n << W) : twos;
      const fits = v >= -(1n << (W - 1n)) && v <= mask;
      const rows = [
        ['Decimal', v.toString()], ['Hexadecimal', toBase(v, 16).toUpperCase()], ['Octal', toBase(v, 8)], ['Binary', group(toBase(v, 2), 4)],
        [`${bits}-bit two's complement`, group(twos.toString(2).padStart(Number(W), '0'), 4), `hex ${twos.toString(16).toUpperCase().padStart(Number(W) / 4, '0')}`],
        [`As unsigned / signed ${bits}-bit`, `${twos} / ${signed}`, fits ? '' : `the value does not fit in ${bits} bits; these are its low ${bits} bits`],
        ['Base 36', toBase(v, 36)],
      ];
      if (!blank(fl)) {
        const d = num(fl);
        for (const b of [32, 64]) {
          const f = float754(d, b);
          rows.push([`float${b} (IEEE 754)`, `0x${f.hex.toUpperCase()}`, `sign ${f.sign} · exponent ${f.exp} (${f.e} − ${f.bias}) · fraction ${f.frac.slice(0, 23)}${b === 64 ? '…' : ''}; stored value ${f.stored.toPrecision(b === 32 ? 9 : 17)}`]);
        }
      }
      return { rows, copy: rows[1][1] };
    },
    tex: ['N = \\sum_k d_k\\,b^k,\\quad 0 \\le d_k < b', 'x_{\\text{two\'s}} = x \\bmod 2^{w},\\qquad v = (-1)^s\\,(1.f)_2 \\times 2^{e - \\text{bias}}'],
    how: 'Integers are exact at any size (BigInt). Two\'s complement is the value modulo 2^w, read back as signed when the top bit is set. Bit operations work on the w-bit pattern. The IEEE 754 view shows the stored bits of the nearest float32 and float64 and the exact stored value, which shows why 0.1 is not exact.',
    refs: ['IEEE Std 754-2019, Standard for Floating-Point Arithmetic.', 'D. E. Knuth, The Art of Computer Programming, vol. 2, 3rd ed. (1997), §4.1.'],
  },

  complex: {
    inputs: [{ k: 'e', label: 'Expression (i or j is √−1)', def: '(3 + 4i) * exp(i pi/4)', w: 3, hint: 'sqrt, exp, ln, log, sin, cos, tan, sinh, cosh, tanh, asin, acos, atan, abs, arg, conj, re, im' }],
    examples: [{ label: "Euler's identity", v: { e: 'exp(i pi) + 1' } }, { label: 'square root of −4', v: { e: 'sqrt(-4)' } }, { label: 'i^i', v: { e: 'i^i' } }, { label: 'impedance', v: { e: '50 + 1/(i * 2 pi * 1e3 * 1e-6)' } }],
    run({ e }) {
      const z = evalC(parse(e));
      if (!Number.isFinite(z[0]) || !Number.isFinite(z[1])) throw new Error('The result is not finite.');
      const r = C.abs(z), th = C.arg(z);
      const rows = [['Rectangular a + bi', cfmt(z, 14)], ['Modulus |z|', fmt(r, 14)], ['Argument arg z', `${fmt(th, 14)} rad`, `${fmt(th * 180 / Math.PI, 12)}°`], ['Polar r∠θ', `${fmt(r, 10)} ∠ ${fmt(th * 180 / Math.PI, 10)}°`], ['Exponential r e^{iθ}', `${fmt(r, 10)} e^(${fmt(th, 10)} i)`], ['Conjugate', cfmt([z[0], -z[1]], 14)]];
      return { rows, copy: cfmt(z, 15) };
    },
    tex: ['z = a + bi = r\\,e^{i\\theta},\\quad r = \\sqrt{a^2+b^2},\\quad \\theta = \\operatorname{atan2}(b, a)', '\\ln z = \\ln r + i\\theta\\ (-\\pi < \\theta \\le \\pi),\\qquad z^w = e^{w\\ln z}'],
    how: 'Principal branches throughout: ln and sqrt are cut along the negative real axis, and the argument lies in (−π, π]. Integer powers use repeated squaring, so (1 + i)⁴ is exactly −4; other powers use e^{w ln z}. Division uses Smith\'s method to avoid overflow.',
    refs: ['NIST DLMF §4.2 (logarithm, powers), dlmf.nist.gov/4.2.', 'R. L. Smith, Commun. ACM 5, 435 (1962).'],
  },

  fft: {
    inputs: [
      { k: 'd', label: 'Samples (equally spaced)', type: 'area', rows: 5, def: '', hint: 'empty: a demo of 50 Hz + 0.5 × 120 Hz at 1 kHz' },
      { k: 'fs', label: 'Sample rate', def: '1000 Hz' },
      { k: 'win', label: 'Window', type: 'select', def: 'hann', opts: [['none', 'none (rectangular)'], ['hann', 'Hann']] },
      { k: 'logy', label: 'Log amplitude axis', type: 'check', def: '0' },
    ],
    run({ d, fs, win, logy }) {
      const F = qty(fs);
      if (!F.d.every((x, i) => x === [0, 0, -1, 0, 0, 0, 0][i])) throw new Error('The sample rate must be a frequency, for example 1000 Hz or 1 kHz.');
      let x = nums(d || '');
      if (!x.length) x = Array.from({ length: 1000 }, (_, n) => Math.sin(2 * Math.PI * 50 * n / 1000) + 0.5 * Math.sin(2 * Math.PI * 120 * n / 1000));
      const s = spectrum(x, F.v, { window: win });
      const rows = [['Samples N', String(x.length), x.length & (x.length - 1) ? 'not a power of 2: Bluestein (exact DFT)' : 'radix-2'], ['Frequency resolution fₛ/N', `${fmt(s.df, 8)} Hz`], ['Mean (DC, removed)', fmt(s.mean, 8)]];
      s.peaks.slice(0, 6).forEach((p, i) => rows.push([`Peak ${i + 1}`, `${fmt(p.f, 8)} Hz`, `amplitude ${fmt(p.amp, 5)}`]));
      const svg = plot([{ x: s.f, y: logy === '1' ? s.amp.map(v => Math.max(v, 1e-12)) : s.amp }], { xlabel: 'frequency (Hz)', ylabel: 'amplitude', logy: logy === '1', title: `One-sided amplitude spectrum (${win === 'hann' ? 'Hann window' : 'no window'})` });
      return { rows, svg, copy: s.f.map((f, i) => `${f}\t${s.amp[i]}`).join('\n') };
    },
    tex: ['X_k = \\sum_{n=0}^{N-1} x_n\\,w_n\\,e^{-2\\pi i kn/N},\\qquad f_k = k\\,\\frac{f_s}{N}', 'A_k = \\frac{2\\,|X_k|}{N\\,\\bar w}\\ \\ (0 < k < N/2),\\qquad w_n = \\tfrac12 - \\tfrac12\\cos\\frac{2\\pi n}{N}\\ \\text{(Hann)}'],
    how: 'The mean is removed, the window is applied, and the DFT is computed exactly: radix-2 Cooley–Tukey when N is a power of two, Bluestein\'s chirp-z transform otherwise. Amplitudes are one-sided and divided by the window\'s coherent gain, so a sine of amplitude 1 on a bin shows as 1. Peak frequencies are refined by a parabola through the log magnitude of three bins.',
    refs: ['J. W. Cooley and J. W. Tukey, Math. Comput. 19, 297 (1965).', 'L. I. Bluestein, IEEE Trans. Audio Electroacoust. 18, 451 (1970).', 'F. J. Harris, Proc. IEEE 66, 51 (1978) (windows).'],
  },

  interp: {
    inputs: [
      { k: 'mode', label: 'Method', type: 'select', def: 'spline', opts: [['spline', 'Natural cubic spline'], ['linear', 'Linear interpolation'], ['ma', 'Moving average'], ['sg', 'Savitzky–Golay smoothing']] },
      { k: 'at', label: 'Evaluate at x (interpolation)', def: '2.5, 4.75' },
      { k: 'w', label: 'Window (smoothing, odd)', def: '5' }, { k: 'p', label: 'Polynomial order (Savitzky–Golay)', def: '2' },
      { k: 'd', label: 'Data: x y per line (x increasing)', type: 'area', rows: 6, def: '0 0\n1 0.84\n2 0.91\n3 0.14\n4 -0.76\n5 -0.96\n6 -0.28' },
    ],
    examples: [{ label: 'smooth noisy data', v: { mode: 'sg', w: '7', p: '2', d: '0 0.12\n1 0.79\n2 1.02\n3 0.05\n4 -0.66\n5 -1.07\n6 -0.21\n7 0.71\n8 1.05\n9 0.37\n10 -0.62\n11 -0.95\n12 -0.48' } }],
    run({ mode, at, w, p, d }) {
      const { x, y } = xyRows(d);
      let curve, rows = [];
      if (mode === 'spline' || mode === 'linear') {
        const f = mode === 'spline' ? spline(x, y) : (t) => linear(x, y, t);
        if (mode === 'linear') for (let i = 1; i < x.length; i++) if (!(x[i] > x[i - 1])) throw new Error('x must increase strictly for interpolation.');
        const ts = blank(at) ? [] : nums(at);
        rows = ts.map(t => [`y(${fmt(t, 8)})`, fmt(f(t), 12), t < x[0] || t > x[x.length - 1] ? 'outside the data: extrapolated' : '']);
        const xs = linspace(x[0], x[x.length - 1], 400);
        curve = { x: xs, y: xs.map(f), name: mode === 'spline' ? 'natural spline' : 'linear' };
        if (!rows.length) rows.push(['Note', 'Enter x values to evaluate.']);
      } else {
        const W = Math.round(num(w));
        const ys = mode === 'ma' ? movingAvg(y, W) : savgol(y, W, Math.round(num(p)));
        rows = [['Points smoothed', String(ys.length)], ['RMS change', fmt(Math.sqrt(ys.reduce((s, v, i) => s + (v - y[i]) ** 2, 0) / ys.length), 6)]];
        curve = { x, y: ys, name: mode === 'ma' ? `moving average (${W})` : `Savitzky–Golay (${W}, ${num(p)})` };
        return { rows, svg: plot([{ x, y, type: 'scatter', name: 'data' }, curve], { xlabel: 'x', ylabel: 'y' }), copy: ys.map((v, i) => `${x[i]}\t${v}`).join('\n') };
      }
      return { rows, svg: plot([{ x, y, type: 'scatter', name: 'data' }, curve], { xlabel: 'x', ylabel: 'y' }), copy: rows.map(r => r[1]).join('\n') };
    },
    tex: ['S_i(x) = A\\,y_i + B\\,y_{i+1} + \\frac{(A^3-A)M_i + (B^3-B)M_{i+1}}{6}h_i^2,\\quad M_0 = M_n = 0', '\\hat y_i = \\sum_{j=-h}^{h} c_j\\,y_{i+j},\\quad c = \\text{row 0 of } (V^\\mathsf T V)^{-1}V^\\mathsf T\\ \\ \\text{(Savitzky–Golay)}'],
    how: 'The natural spline solves a tridiagonal system for the second derivatives M with M = 0 at both ends. Savitzky–Golay fits a polynomial of the given order to each window by least squares and keeps its centre value; at the edges it evaluates a polynomial fitted to the first or last window, as SciPy\'s savgol_filter(mode="interp"). Smoothing assumes equally spaced x.',
    refs: ['C. de Boor, A Practical Guide to Splines (1978), ch. 4.', 'A. Savitzky and M. J. E. Golay, Anal. Chem. 36, 1627 (1964).', 'Results checked against scipy.interpolate.CubicSpline and scipy.signal.savgol_filter.'],
  },
};

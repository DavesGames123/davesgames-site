// ============================================================================
//  SCIENCE TOOLKIT  ·  core/complex.js  ·  complex arithmetic
// ----------------------------------------------------------------------------
//  Evaluates an expression tree of core/expr.js on complex numbers [re, im].
//  i and j are the imaginary unit. Functions: sqrt, exp, ln, log (base 10),
//  sin, cos, tan, sinh, cosh, tanh, asin, acos, atan, abs, arg, conj, re,
//  im. Branch cuts are the principal ones (ln and sqrt cut along the
//  negative real axis), as in C99 <complex.h> and NumPy. An integer power
//  uses repeated squaring, so (1+i)^4 is exactly −4.
//
//  GREP MAP
//    grep -n "export const C"         the arithmetic
//    grep -n "export function evalC"  tree -> [re, im]
// ============================================================================
import { parse } from './expr.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
function div(a, b) {
  // Smith's method: no overflow for large components.
  if (Math.abs(b[1]) <= Math.abs(b[0])) {
    const r = b[1] / b[0], d = b[0] + b[1] * r;
    return [(a[0] + a[1] * r) / d, (a[1] - a[0] * r) / d];
  }
  const r = b[0] / b[1], d = b[0] * r + b[1];
  return [(a[0] * r + a[1]) / d, (a[1] * r - a[0]) / d];
}
const abs = (a) => Math.hypot(a[0], a[1]);
const arg = (a) => Math.atan2(a[1], a[0]);
const exp = (a) => { const e = Math.exp(a[0]); return [e * Math.cos(a[1]), e * Math.sin(a[1])]; };
const ln = (a) => [Math.log(abs(a)), arg(a)];
function sqrt(a) {
  const r = abs(a);
  if (r === 0) return [0, 0];
  const t = Math.sqrt((r + Math.abs(a[0])) / 2);
  return a[0] >= 0 ? [t, a[1] / (2 * t)] : [Math.abs(a[1]) / (2 * t), a[1] >= 0 ? t : -t];
}
function pow(a, b) {
  if (b[1] === 0 && Number.isInteger(b[0]) && Math.abs(b[0]) <= 1024) {
    let n = Math.abs(b[0]), base = a, out = [1, 0];
    while (n) { if (n & 1) out = mul(out, base); base = mul(base, base); n >>= 1; }
    return b[0] < 0 ? div([1, 0], out) : out;
  }
  if (a[0] === 0 && a[1] === 0) return b[0] > 0 ? [0, 0] : [NaN, NaN];
  return exp(mul(b, ln(a)));
}
const I = [0, 1];
const sin = (a) => [Math.sin(a[0]) * Math.cosh(a[1]), Math.cos(a[0]) * Math.sinh(a[1])];
const cos = (a) => [Math.cos(a[0]) * Math.cosh(a[1]), -Math.sin(a[0]) * Math.sinh(a[1])];
const sinh = (a) => [Math.sinh(a[0]) * Math.cos(a[1]), Math.cosh(a[0]) * Math.sin(a[1])];
const cosh = (a) => [Math.cosh(a[0]) * Math.cos(a[1]), Math.sinh(a[0]) * Math.sin(a[1])];
// asin z = −i ln(iz + √(1 − z²)); acos z = π/2 − asin z; atan z = (i/2) ln((i + z)/(i − z)).
const asin = (a) => mul([0, -1], ln(add(mul(I, a), sqrt(sub([1, 0], mul(a, a))))));
const acos = (a) => sub([Math.PI / 2, 0], asin(a));
const atan = (a) => mul([0, 0.5], ln(div(add(I, a), sub(I, a))));

export const C = { add, sub, mul, div, abs, arg, exp, ln, sqrt, pow, sin, cos, sinh, cosh, asin, acos, atan };

const F = {
  sqrt, exp, ln, log: (a) => { const l = ln(a); return [l[0] / Math.LN10, l[1] / Math.LN10]; },
  sin, cos, tan: (a) => div(sin(a), cos(a)), sinh, cosh, tanh: (a) => div(sinh(a), cosh(a)), asin, acos, atan,
  abs: (a) => [abs(a), 0], arg: (a) => [arg(a), 0], conj: (a) => [a[0], -a[1]], re: (a) => [a[0], 0], im: (a) => [a[1], 0],
};

export function evalC(tree, scope = {}) {
  const ev = (n) => {
    switch (n.t) {
      case 'n': return [n.v, 0];
      case 'id':
        if (n.name in scope) return scope[n.name];
        if (n.name === 'i' || n.name === 'j') return [0, 1];
        if (n.name === 'pi' || n.name === 'π') return [Math.PI, 0];
        if (n.name === 'e') return [Math.E, 0];
        throw new Error(`"${n.name}" has no value.`);
      case 'neg': { const a = ev(n.a); return [0 - a[0], 0 - a[1]]; }   // 0 - x: no negative zero, so ln(-1) = +iπ
      case 'call': {
        const f = F[n.name];
        if (!f || n.args.length !== 1) throw new Error(`${n.name}() is not available for complex numbers.`);
        return f(ev(n.args[0]));
      }
      case 'op': {
        const a = ev(n.a), b = ev(n.b);
        if (n.op === '+') return add(a, b);
        if (n.op === '-') return sub(a, b);
        if (n.op === '*' || n.op === 'j') return mul(a, b);
        if (n.op === '/') return div(a, b);
        if (n.op === '^') return pow(a, b);
      }
    }
    throw new Error('"=" is not valid here.');
  };
  return ev(typeof tree === 'string' ? parse(tree) : tree);
}

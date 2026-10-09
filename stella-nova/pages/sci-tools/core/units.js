// ============================================================================
//  SCIENCE TOOLKIT  ·  core/units.js  ·  quantities with dimensions
// ----------------------------------------------------------------------------
//  A quantity is { v, d }: v is the value in SI base units and d is the
//  exponent of each SI base dimension, in the order
//      m  kg  s  A  K  mol  cd
//  The unit table gives each unit symbol its SI factor and its dimension.
//  An SI prefix can go in front of a unit that permits it ("kPa", "µm",
//  "MeV"). An exact symbol wins over prefix + symbol, so "min" is minutes,
//  "cd" is candela and "Gy" is gray. Angles (rad, sr, deg) have no
//  dimension.
//
//  Expressions use core/expr.js, so "kg*m/s^2", "J/(mol K)", "kWh" and
//  "1/s" are all valid. Constants from core/constants.js go in with a
//  leading $ ("$c", "$hbar", "$me").
//
//  Temperature: K, degC (°C), degF (°F) and degR (°R). A unit with an
//  offset converts as a temperature only when the quantity is that unit
//  alone ("25 degC" to "degF"). Inside a compound unit ("J/(kg degC)") it
//  is a temperature difference, with factor 1 or 5/9.
//
//  GREP MAP
//    grep -n "export const UNITS"       the unit table
//    grep -n "export const PREFIX"      SI prefixes
//    grep -n "export function unit"     symbol -> { f, d }
//    grep -n "export function qty"      text -> quantity
//    grep -n "export function convert"  text, target unit -> value
//    grep -n "export function dimText"  dimension exponents -> "kg m s^-2"
//    grep -n "export function named"    dimension -> a named SI unit
// ============================================================================
import { parse, FN } from './expr.js';
import { CONST } from './constants.js';

export const BASE = ['m', 'kg', 's', 'A', 'K', 'mol', 'cd'];
const D = (o = {}) => BASE.map(b => o[b] || 0);
const ONE = D();

const PI = Math.PI;
const lbf = 0.45359237 * 9.80665;

// symbol: [factor to SI, dimension, prefixable, offset]. SI = (x + offset) * factor.
const U = {
  m: [1, D({ m: 1 }), 1], g: [1e-3, D({ kg: 1 }), 1], s: [1, D({ s: 1 }), 1], A: [1, D({ A: 1 }), 1],
  K: [1, D({ K: 1 }), 1], mol: [1, D({ mol: 1 }), 1], cd: [1, D({ cd: 1 }), 1],
  rad: [1, ONE, 1], sr: [1, ONE, 0],
  Hz: [1, D({ s: -1 }), 1], N: [1, D({ kg: 1, m: 1, s: -2 }), 1], Pa: [1, D({ kg: 1, m: -1, s: -2 }), 1],
  J: [1, D({ kg: 1, m: 2, s: -2 }), 1], W: [1, D({ kg: 1, m: 2, s: -3 }), 1], C: [1, D({ s: 1, A: 1 }), 1],
  V: [1, D({ kg: 1, m: 2, s: -3, A: -1 }), 1], F: [1, D({ kg: -1, m: -2, s: 4, A: 2 }), 1],
  ohm: [1, D({ kg: 1, m: 2, s: -3, A: -2 }), 1], 'Ω': [1, D({ kg: 1, m: 2, s: -3, A: -2 }), 1],
  S: [1, D({ kg: -1, m: -2, s: 3, A: 2 }), 1], Wb: [1, D({ kg: 1, m: 2, s: -2, A: -1 }), 1],
  T: [1, D({ kg: 1, s: -2, A: -1 }), 1], H: [1, D({ kg: 1, m: 2, s: -2, A: -2 }), 1],
  lm: [1, D({ cd: 1 }), 1], lx: [1, D({ cd: 1, m: -2 }), 1], Bq: [1, D({ s: -1 }), 1],
  Gy: [1, D({ m: 2, s: -2 }), 1], Sv: [1, D({ m: 2, s: -2 }), 1], kat: [1, D({ mol: 1, s: -1 }), 1],
  // Accepted non-SI and common units.
  L: [1e-3, D({ m: 3 }), 1], l: [1e-3, D({ m: 3 }), 1], cc: [1e-6, D({ m: 3 }), 0],
  t: [1000, D({ kg: 1 }), 1], Da: [CONST.mu.v, D({ kg: 1 }), 1], u: [CONST.mu.v, D({ kg: 1 }), 0],
  eV: [CONST.qe.v, D({ kg: 1, m: 2, s: -2 }), 1],
  min: [60, D({ s: 1 }), 0], h: [3600, D({ s: 1 }), 0], d: [86400, D({ s: 1 }), 0], wk: [604800, D({ s: 1 }), 0],
  yr: [31557600, D({ s: 1 }), 1], a: [31557600, D({ s: 1 }), 1], ha: [1e4, D({ m: 2 }), 0],
  bar: [1e5, D({ kg: 1, m: -1, s: -2 }), 1], atm: [101325, D({ kg: 1, m: -1, s: -2 }), 0],
  Torr: [101325 / 760, D({ kg: 1, m: -1, s: -2 }), 1], mmHg: [133.322387415, D({ kg: 1, m: -1, s: -2 }), 0],
  inHg: [3386.389, D({ kg: 1, m: -1, s: -2 }), 0], psi: [lbf / 0.0254 ** 2, D({ kg: 1, m: -1, s: -2 }), 1],
  cal: [4.184, D({ kg: 1, m: 2, s: -2 }), 1], Cal: [4184, D({ kg: 1, m: 2, s: -2 }), 0],
  Btu: [1055.05585262, D({ kg: 1, m: 2, s: -2 }), 0], erg: [1e-7, D({ kg: 1, m: 2, s: -2 }), 0],
  Wh: [3600, D({ kg: 1, m: 2, s: -2 }), 1], dyn: [1e-5, D({ kg: 1, m: 1, s: -2 }), 0],
  hp: [745.69987158227022, D({ kg: 1, m: 2, s: -3 }), 0], lbf: [lbf, D({ kg: 1, m: 1, s: -2 }), 0],
  P: [0.1, D({ kg: 1, m: -1, s: -1 }), 1], St: [1e-4, D({ m: 2, s: -1 }), 1],
  ft: [0.3048, D({ m: 1 }), 0], in: [0.0254, D({ m: 1 }), 0], yd: [0.9144, D({ m: 1 }), 0], mi: [1609.344, D({ m: 1 }), 0],
  nmi: [1852, D({ m: 1 }), 0], 'Å': [1e-10, D({ m: 1 }), 0], angstrom: [1e-10, D({ m: 1 }), 0],
  au: [149597870700, D({ m: 1 }), 0], ly: [9460730472580800, D({ m: 1 }), 0], pc: [149597870700 * 648000 / PI, D({ m: 1 }), 1],
  lb: [0.45359237, D({ kg: 1 }), 0], oz: [0.028349523125, D({ kg: 1 }), 0],
  kn: [1852 / 3600, D({ m: 1, s: -1 }), 0], mph: [0.44704, D({ m: 1, s: -1 }), 0], kph: [1 / 3.6, D({ m: 1, s: -1 }), 0],
  gal: [3.785411784e-3, D({ m: 3 }), 0], M: [1000, D({ mol: 1, m: -3 }), 1],
  G: [1e-4, D({ kg: 1, s: -2, A: -1 }), 0], gauss: [1e-4, D({ kg: 1, s: -2, A: -1 }), 0],
  b: [1e-28, D({ m: 2 }), 1], Ci: [3.7e10, D({ s: -1 }), 1], Jy: [1e-26, D({ kg: 1, s: -2 }), 1],
  rpm: [1 / 60, D({ s: -1 }), 0],
  deg: [PI / 180, ONE, 0], '°': [PI / 180, ONE, 0], arcmin: [PI / 10800, ONE, 0], arcsec: [PI / 648000, ONE, 1],
  '%': [0.01, ONE, 0], ppm: [1e-6, ONE, 0], ppb: [1e-9, ONE, 0],
  degC: [1, D({ K: 1 }), 0, 273.15], '°C': [1, D({ K: 1 }), 0, 273.15], '℃': [1, D({ K: 1 }), 0, 273.15],
  degF: [5 / 9, D({ K: 1 }), 0, 459.67], '°F': [5 / 9, D({ K: 1 }), 0, 459.67],
  degR: [5 / 9, D({ K: 1 }), 0, 0], '°R': [5 / 9, D({ K: 1 }), 0, 0],
};
export const UNITS = U;

export const PREFIX = { Q: 1e30, R: 1e27, Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 1e1, d: 1e-1, c: 1e-2, m: 1e-3, 'µ': 1e-6, 'μ': 1e-6, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24, r: 1e-27, q: 1e-30 };
const PREFIX_ORDER = Object.keys(PREFIX).sort((a, b) => b.length - a.length);

// Symbol to { f, d, o }. Throws for an unknown symbol.
export function unit(sym) {
  const e = U[sym];
  if (e) return { f: e[0], d: e[1], o: e[3] || 0 };
  for (const p of PREFIX_ORDER) {
    if (sym.length > p.length && sym.startsWith(p)) {
      const r = U[sym.slice(p.length)];
      if (r && r[2]) return { f: r[0] * PREFIX[p], d: r[1], o: 0 };
    }
  }
  throw new Error(`Unknown unit "${sym}".`);
}

const same = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
export const dimEq = same;

// Dimension exponents to text, for example "kg m s^-2". Re-parseable.
export function dimText(d) {
  const parts = [];
  for (const i of [1, 0, 2, 3, 4, 5, 6]) { const b = BASE[i], e = +d[i].toFixed(6); if (e) parts.push(e === 1 ? b : `${b}^${e}`); }
  return parts.join(' ') || '1';
}

// Dimension name, for error text.
const DIM_NAME = ['L', 'M', 'T', 'I', 'Θ', 'N', 'J'];
export function dimName(d) {
  const p = [];
  DIM_NAME.forEach((b, i) => { const e = +d[i].toFixed(6); if (e) p.push(e === 1 ? b : `${b}^${e}`); });
  return p.length ? p.join(' ') : 'dimensionless';
}

const NAMED = ['N', 'Pa', 'J', 'W', 'C', 'V', 'F', 'Ω', 'S', 'Wb', 'T', 'H', 'Hz', 'kat'];
// A named SI unit with this dimension, or null.
export function named(d) {
  for (const n of NAMED) if (same(U[n][1], d)) return n;
  return null;
}

// Quantity arithmetic.
const qmul = (a, b) => ({ v: a.v * b.v, d: a.d.map((x, i) => x + b.d[i]) });
const qdiv = (a, b) => ({ v: a.v / b.v, d: a.d.map((x, i) => x - b.d[i]) });
function qadd(a, b, sign) {
  if (!same(a.d, b.d)) throw new Error(`Cannot add ${dimName(a.d)} and ${dimName(b.d)}.`);
  return { v: a.v + sign * b.v, d: a.d };
}
function qpow(a, b) {
  if (!same(b.d, ONE)) throw new Error('An exponent must have no dimension.');
  return { v: a.v ** b.v, d: a.d.map(x => x * b.v) };
}
const pure = (q, name) => { if (!same(q.d, ONE)) throw new Error(`${name}() needs a quantity with no dimension, not ${dimName(q.d)}.`); return q.v; };

const QFN = {
  sqrt: (q) => qpow(q, { v: 0.5, d: ONE }), cbrt: (q) => qpow(q, { v: 1 / 3, d: ONE }),
  abs: (q) => ({ v: Math.abs(q.v), d: q.d }),
};
const MATH1 = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'ln', 'log', 'log10', 'log2', 'floor', 'ceil', 'round', 'erf', 'gamma'];

// Evaluate a tree as a quantity. scope: name -> quantity or number.
export function evalQty(n, scope = {}) {
  switch (n.t) {
    case 'n': return { v: n.v, d: ONE };
    case 'id': {
      const k = n.name;
      if (k in scope) { const s = scope[k]; return typeof s === 'number' ? { v: s, d: ONE } : s; }
      if (k[0] === '$') {
        return constQty(k.slice(1));
      }
      if (k === 'pi' || k === 'π') return { v: PI, d: ONE };
      try { const u = unit(k); return { v: u.f, d: u.d }; }
      catch (e) { if (k === 'e') return { v: Math.E, d: ONE }; throw e; }
    }
    case 'neg': { const a = evalQty(n.a, scope); return { v: -a.v, d: a.d }; }
    case 'eq': throw new Error('"=" is not valid here.');
    case 'call': {
      const args = n.args.map(a => evalQty(a, scope));
      if (QFN[n.name]) return QFN[n.name](args[0]);
      if (n.name === 'min' || n.name === 'max' || n.name === 'hypot') {
        for (const a of args) if (!same(a.d, args[0].d)) throw new Error(`${n.name}() needs arguments with the same dimension.`);
        const f = Math[n.name];
        return { v: f(...args.map(a => a.v)), d: args[0].d };
      }
      if (n.name === 'atan2') { if (!same(args[0].d, args[1].d)) throw new Error('atan2() needs two arguments with the same dimension.'); return { v: Math.atan2(args[0].v, args[1].v), d: ONE }; }
      if (n.name === 'pow') return qpow(args[0], args[1]);
      if (MATH1.includes(n.name) || /^(sind|cosd|tand|asinh|acosh|atanh|sign|erfc)$/.test(n.name)) {
        const f = { sind: (x) => Math.sin(x * PI / 180), cosd: (x) => Math.cos(x * PI / 180), tand: (x) => Math.tan(x * PI / 180) }[n.name];
        const v = pure(args[0], n.name);
        if (f) return { v: f(v), d: ONE };
        return { v: callMath(n.name, v), d: ONE };
      }
      throw new Error(`${n.name}() is not available with units.`);
    }
    case 'op': {
      const a = evalQty(n.a, scope), b = evalQty(n.b, scope);
      switch (n.op) {
        case '+': return qadd(a, b, 1);
        case '-': return qadd(a, b, -1);
        case '*': case 'j': return qmul(a, b);
        case '/': return qdiv(a, b);
        case '^': return qpow(a, b);
      }
    }
  }
  throw new Error('Bad expression.');
}

const callMath = (name, v) => FN[name][1](v);

// A constant from core/constants.js as an SI quantity (value x unit).
const constCache = {};
export function constQty(id) {
  if (constCache[id]) return constCache[id];
  const c = CONST[id];
  if (!c) throw new Error(`Unknown constant "$${id}". See the constants table for the names.`);
  const u = c.unit ? evalQty(parse(c.unit)) : { v: 1, d: ONE };
  return (constCache[id] = { v: c.v * u.v, d: u.d });
}

// "25 degC", "-40 °F", "300 K": a number and one offset unit. Returns
// { x, sym } or null.
const TEMP_RE = /^\s*([-+−]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)?\s*(degC|°C|℃|degF|°F|degR|°R|K)\s*$/;

// Text to a quantity in SI. A bare temperature carries { temp: true }.
export function qty(text, scope) {
  const t = TEMP_RE.exec(String(text));
  if (t) {
    const u = U[t[2]], x = t[1] == null ? 1 : Number(t[1].replace('−', '-'));
    return { v: (x + (u[3] || 0)) * u[0], d: u[1], temp: true };
  }
  return evalQty(parse(text), scope);
}

// Convert a quantity (text) into a target unit (text). Returns the number.
// A temperature converts with offsets when both sides are a lone
// temperature unit.
export function convert(text, target) {
  const q = qty(text);
  const tt = TEMP_RE.exec(String(target));
  if (q.temp && tt && tt[1] == null) {
    const u = U[tt[2]];
    return q.v / u[0] - (u[3] || 0);
  }
  const t = evalQty(parse(target));
  if (!same(q.d, t.d)) throw new Error(`Cannot convert ${dimName(q.d)} [${dimText(q.d)}] to ${dimName(t.d)} [${dimText(t.d)}].`);
  return q.v / t.v;
}

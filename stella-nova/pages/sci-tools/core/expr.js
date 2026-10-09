// ============================================================================
//  SCIENCE TOOLKIT  ·  core/expr.js  ·  the expression parser
// ----------------------------------------------------------------------------
//  One parser for every tool that reads a formula: the calculator, the unit
//  converter, uncertainty propagation, the root finder, the integrator, the
//  custom fit model and the complex calculator. parse() makes a tree once.
//  compile() turns the tree into a JavaScript closure for fast repeated use
//  (Monte Carlo, quadrature, curve fits). core/units.js and core/complex.js
//  walk the same tree with their own number types.
//
//  PRECEDENCE (high to low)
//    ^ (right to left; the exponent may have a sign)
//    juxtaposition: "2 x", "3 kg m", "4(x+1)"
//    unary + and -
//    * and / (left to right)
//    + and -
//  Juxtaposition is above "/", so "J/mol K" is J/(mol K) and "2 pi/3 x" is
//  (2 pi)/(3 x). Write "*" to get the other reading.
//
//  Unicode input: · × ⋅ for *, ÷ for /, − for -, ² ³ and ⁻¹ style exponents.
//
//  GREP MAP
//    grep -n "export function parse"     text -> tree
//    grep -n "export function compile"   tree -> (scope) => number
//    grep -n "export function freeVars"  names that are not functions or constants
//    grep -n "export const FN"           the function table
// ============================================================================

const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };

// Text to tokens: {k:'n', v} {k:'id', v} {k:'op', v}.
export function tokenize(src) {
  let s = String(src).replace(/[·×⋅]/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\*\*/g, '^');
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (m) => '^' + [...m].map(c => SUP[c]).join(''));
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const n = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s.slice(i));
    if (n) {
      // "2e" followed by a letter that is not an exponent stays 2 then e.
      out.push({ k: 'n', v: Number(n[0]) }); i += n[0].length; continue;
    }
    const id = /^[A-Za-z_$µμΩÅ°℃%‰][A-Za-z0-9_µμΩÅ°℃'%]*/.exec(s.slice(i));
    if (id) { out.push({ k: 'id', v: id[0] }); i += id[0].length; continue; }
    if ('+-*/^(),='.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    throw new Error(`Unexpected character "${c}".`);
  }
  return out;
}

// Functions: name -> [arity (or -1 for 1 or more), fn].
export const FN = {
  sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan],
  asin: [1, Math.asin], acos: [1, Math.acos], atan: [1, Math.atan], atan2: [2, Math.atan2],
  sinh: [1, Math.sinh], cosh: [1, Math.cosh], tanh: [1, Math.tanh],
  asinh: [1, Math.asinh], acosh: [1, Math.acosh], atanh: [1, Math.atanh],
  exp: [1, Math.exp], ln: [1, Math.log], log: [1, Math.log10], log10: [1, Math.log10], log2: [1, Math.log2],
  sqrt: [1, Math.sqrt], cbrt: [1, Math.cbrt], abs: [1, Math.abs], sign: [1, Math.sign],
  floor: [1, Math.floor], ceil: [1, Math.ceil], round: [1, Math.round],
  min: [-1, Math.min], max: [-1, Math.max], hypot: [-1, Math.hypot], pow: [2, Math.pow],
  sind: [1, (x) => Math.sin(x * Math.PI / 180)], cosd: [1, (x) => Math.cos(x * Math.PI / 180)], tand: [1, (x) => Math.tan(x * Math.PI / 180)],
  erf: [1, erf], erfc: [1, (x) => 1 - erf(x)], gamma: [1, gammaFn],
};

// Constants that numeric mode knows.
export const NUM_CONST = { pi: Math.PI, π: Math.PI, e: Math.E, tau: 2 * Math.PI, inf: Infinity };

// erf with |error| < 1.2e-7 everywhere would be too coarse; this uses the
// series for |x| < 2.5 and the continued fraction above (|rel err| ~1e-15).
function erf(x) {
  const a = Math.abs(x);
  let r;
  if (a < 2.5) {
    let term = a, sum = a, k = 0;
    const x2 = a * a;
    while (Math.abs(term) > 1e-17 * Math.abs(sum) && k < 200) { k++; term *= -x2 / k; sum += term / (2 * k + 1); }
    r = 2 / Math.sqrt(Math.PI) * sum;
  } else {
    // erfc continued fraction (Lentz).
    let f = a, C = a, D = 0;
    for (let n = 1; n < 300; n++) {
      const an = n / 2;
      D = a + an * D; D = D === 0 ? 1e-300 : 1 / D;
      C = a + an / C; if (C === 0) C = 1e-300;
      const del = C * D; f *= del;
      if (Math.abs(del - 1) < 1e-16) break;
    }
    r = 1 - Math.exp(-a * a) / Math.sqrt(Math.PI) / f;
  }
  return x < 0 ? -r : r;
}

function gammaFn(x) {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * t ** (x + 0.5) * Math.exp(-t) * a;
}

// Text to tree. Node kinds: n (number), id (name), call, op (+ - * / ^ and
// "j" for juxtaposition), neg, eq (a = b, used by the root finder).
export function parse(src) {
  const tk = tokenize(src);
  if (!tk.length) throw new Error('The expression is empty.');
  let p = 0;
  const peek = () => tk[p];
  const isOp = (v) => tk[p] && tk[p].k === 'op' && tk[p].v === v;
  const expect = (v) => { if (!isOp(v)) throw new Error(`"${v}" expected${tk[p] ? ` before "${tk[p].v}"` : ' at the end'}.`); p++; };

  function equation() {
    const a = add();
    if (isOp('=')) { p++; const b = add(); return { t: 'eq', a, b }; }
    return a;
  }
  function add() {
    let a = mul();
    while (isOp('+') || isOp('-')) { const op = tk[p++].v; a = { t: 'op', op, a, b: mul() }; }
    return a;
  }
  function mul() {
    let a = unary();
    while (isOp('*') || isOp('/')) { const op = tk[p++].v; a = { t: 'op', op, a, b: unary() }; }
    return a;
  }
  function unary() {
    if (isOp('-')) { p++; return { t: 'neg', a: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    return juxt();
  }
  const startsPrimary = () => { const t = peek(); return t && (t.k === 'n' || t.k === 'id' || (t.k === 'op' && t.v === '(')); };
  function juxt() {
    let a = pow();
    while (startsPrimary()) a = { t: 'op', op: 'j', a, b: pow() };
    return a;
  }
  function pow() {
    const a = primary();
    if (isOp('^')) {
      p++;
      let neg = false;
      if (isOp('-')) { p++; neg = true; } else if (isOp('+')) p++;
      let b = pow();
      if (neg) b = { t: 'neg', a: b };
      return { t: 'op', op: '^', a, b };
    }
    return a;
  }
  function primary() {
    const t = tk[p];
    if (!t) throw new Error('The expression ends too early.');
    if (t.k === 'n') { p++; return { t: 'n', v: t.v }; }
    if (t.k === 'id') {
      p++;
      if (FN[t.v] && isOp('(')) {
        p++;
        const args = [];
        if (!isOp(')')) { args.push(add()); while (isOp(',')) { p++; args.push(add()); } }
        expect(')');
        const ar = FN[t.v][0];
        if (ar > 0 && args.length !== ar) throw new Error(`${t.v}() takes ${ar} argument${ar > 1 ? 's' : ''}.`);
        if (ar < 0 && !args.length) throw new Error(`${t.v}() needs an argument.`);
        return { t: 'call', name: t.v, args };
      }
      return { t: 'id', name: t.v };
    }
    if (t.k === 'op' && t.v === '(') { p++; const e = add(); expect(')'); return e; }
    throw new Error(`Unexpected "${t.v}".`);
  }
  const tree = equation();
  if (p < tk.length) throw new Error(`Unexpected "${tk[p].v}".`);
  return tree;
}

// Names in the tree that are not numeric-mode constants, in first-seen order.
export function freeVars(tree, known = NUM_CONST) {
  const out = [];
  (function walk(n) {
    if (!n) return;
    if (n.t === 'id') { if (!(n.name in known) && !out.includes(n.name)) out.push(n.name); }
    else if (n.t === 'call') n.args.forEach(walk);
    else { walk(n.a); walk(n.b); }
  })(tree);
  return out;
}

// Tree (or text) to a closure (scope) => number. An "eq" node gives a - b,
// so the root finder can take "x^2 = 2". Unknown names throw at call time.
export function compile(src) {
  const tree = typeof src === 'string' ? parse(src) : src;
  const c = (n) => {
    switch (n.t) {
      case 'n': { const v = n.v; return () => v; }
      case 'id': {
        const name = n.name;
        if (name in NUM_CONST) { const v = NUM_CONST[name]; return (s) => (s && name in s) ? s[name] : v; }
        return (s) => { const v = s && s[name]; if (v === undefined) throw new Error(`"${name}" has no value.`); return v; };
      }
      case 'neg': { const a = c(n.a); return (s) => -a(s); }
      case 'eq': { const a = c(n.a), b = c(n.b); return (s) => a(s) - b(s); }
      case 'call': {
        const f = FN[n.name][1], args = n.args.map(c);
        if (args.length === 1) { const a = args[0]; return (s) => f(a(s)); }
        if (args.length === 2) { const a = args[0], b = args[1]; return (s) => f(a(s), b(s)); }
        return (s) => f(...args.map(g => g(s)));
      }
      case 'op': {
        const a = c(n.a), b = c(n.b);
        switch (n.op) {
          case '+': return (s) => a(s) + b(s);
          case '-': return (s) => a(s) - b(s);
          case '*': case 'j': return (s) => a(s) * b(s);
          case '/': return (s) => a(s) / b(s);
          case '^': return (s) => a(s) ** b(s);
        }
      }
    }
    throw new Error('Bad expression tree.');
  };
  return c(tree);
}

// Function of one variable from text, for the root finder and integrator.
export function fn1(src, v = 'x') {
  const tree = parse(src);
  const extra = freeVars(tree).filter(n => n !== v);
  if (extra.length) throw new Error(`Unknown name${extra.length > 1 ? 's' : ''}: ${extra.join(', ')}. Use ${v} as the variable.`);
  const f = compile(tree), sc = {};
  return (x) => { sc[v] = x; return f(sc); };
}

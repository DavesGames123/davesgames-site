// ============================================================================
//  tensor/expr.js  ·  index-notation TeX: parse, print, check (DOM-free)
// ----------------------------------------------------------------------------
//  Shapes (CONTRACT.md "TensorExpr"):
//      Index   = { sym: 'mu', up: true, fixed?: true }
//                sym is a Greek name without the backslash ('mu'), a Latin
//                letter ('a'), either with primes ("mu'"), or a digit
//                ('0', fixed: true) for one explicit component.
//      Factor  = { name, tex, indices: [Index], kind, deriv?: [Index],
//                  derivKind?: 'partial'|'nabla', derivStyle?: 'prefix'|'comma'|'semicolon',
//                  sym?: [{ type: 'sym'|'antisym', slots: [k, ...] }],
//                  (slots index factorIndices(f): the indices, then deriv)
//                  power?: number, stagger?: boolean }
//      Term    = { coeff: number | string, factors: [Factor], side?: 0|1 }
//      TensorExpr = { terms, free, dummies, tex, rel?: '=', lhs?, rhs? }
//  An equation has rel '=', lhs and rhs (each a TensorExpr), and terms =
//  lhs terms (side 0) then rhs terms (side 1). free is the lhs free list,
//  in written order (a prefix derivative index comes first). Numeric
//  bindings of a derivative factor put the derivative slots last.
//
//  Grammar of parseIndexTex (restricted TeX):
//      equation := sum [ '=' sum ]
//      sum      := [+|-] product { (+|-) product }
//      product  := { number | \frac{..}{..} | ( sum ) | derivative | factor | \sqrt{..} }
//      factor   := name [primes] { ^script | _script | {} }
//      name     := letter | \Greek | \tilde{..} | \hat{..} | \bar{..} | \mathcal{..} | \mathbf{..} ...
//      script   := one index token | { indices }   with ( ) [ ] for sym and
//                  antisym groups, and , or ; that start derivative indices
//      derivative := \partial script | \nabla script   (applies to the next factor)
//  A bracket ( sum ) is multiplied out, so a(b+c) becomes ab + ac.
//  Spacing commands (\, \; \! \quad), \left, \right, \cdot and \otimes are skipped.
//  A digit in braces is a component index (A^{0}, g_{01}); a power is c^4
//  (no braces) or ^{-1}, ^{1.5} (with a sign or a point).
//
//  toTex colours each index with \class{iN}{...}. N is the order of first
//  appearance of the sym in the printed expression, modulo 8 (stable).
//
//  ANCHORS   (grep -n "<anchor>" expr.js)
//      parseIndexTex ..... "export function parseIndexTex"
//      toTex ............. "export function toTex"
//      indexColorMap ..... "export function indexColorMap"
//      validate .......... "export function validate"
//      builders .......... "export function idx", "export function fac", "export function term", "export function makeExpr"
//      relabel ........... "export function relabel"
// ============================================================================

export class TexParseError extends Error {
  constructor(msg, pos, src) {
    super(pos != null ? `${msg} (at character ${pos + 1})` : msg);
    this.name = 'TexParseError'; this.pos = pos; this.src = src;
  }
}

export const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa',
  'lambda', 'mu', 'nu', 'xi', 'pi', 'varpi', 'rho', 'varrho', 'sigma', 'varsigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega']);
const SKIP = new Set([',', ';', '!', ':', ' ', 'quad', 'qquad', 'left', 'right', 'cdot', 'otimes', 'displaystyle', 'big', 'Big', 'bigl', 'bigr']);
const DECOR = new Set(['tilde', 'hat', 'bar', 'mathcal', 'mathbf', 'mathrm', 'boldsymbol', 'mathbb', 'operatorname', 'check', 'breve', 'vec', 'mathsf', 'dot', 'ddot']);

// ---- tokenizer -------------------------------------------------------------
function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
      if (!m) throw new TexParseError('a backslash ends the text', i, src);
      toks.push({ t: 'cmd', v: m[1], pos: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+|^[0-9]+/.exec(src.slice(i));
      toks.push({ t: 'num', v: m[0], pos: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(c)) { toks.push({ t: 'let', v: c, pos: i, end: i + 1 }); i++; continue; }
    if ('{}^_+-=()[],;\'|*/'.includes(c)) { toks.push({ t: c, v: c, pos: i, end: i + 1 }); i++; continue; }
    throw new TexParseError(`the character '${c}' is not part of the index grammar`, i, src);
  }
  return toks.filter(k => !(k.t === 'cmd' && SKIP.has(k.v)));
}

// ---- parser ----------------------------------------------------------------
export function parseIndexTex(src) {
  if (typeof src !== 'string') throw new TexParseError('parseIndexTex needs a TeX string');
  const toks = tokenize(src);
  let p = 0;
  const peek = (o = 0) => toks[p + o];
  const at = () => (peek() ? peek().pos : src.length);
  const err = msg => { throw new TexParseError(msg, at(), src); };
  const expect = t => { if (!peek() || peek().t !== t) err(`expected '${t}'`); return toks[p++]; };

  // Brace group as raw source text.
  function rawGroup() {
    const open = expect('{');
    let depth = 1;
    while (peek() && depth) { if (peek().t === '{') depth++; else if (peek().t === '}') depth--; p++; }
    if (depth) throw new TexParseError('a { has no matching }', open.pos, src);
    return src.slice(open.pos + 1, toks[p - 1].pos);
  }

  function indexToken() {
    const k = peek();
    if (!k) err('an index is missing at the end');
    let sym, fixed = false;
    if (k.t === 'let') { sym = k.v; p++; }
    else if (k.t === 'num') { if (!/^[0-9]+$/.test(k.v)) err(`'${k.v}' is not an index`); sym = k.v; fixed = true; p++; }
    else if (k.t === 'cmd' && GREEK.has(k.v)) { sym = k.v; p++; }
    else err(`'${k.v}' is not an index; use a letter, a Greek letter or a digit`);
    // Multi-digit numbers are separate component indices: g_{01}.
    while (peek() && peek().t === "'") { sym += "'"; p++; }
    return { sym, up: false, fixed };
  }

  // One script after ^ or _. Gives { idx: [Index], marks: [{type, from, to}], deriv: [{Index}], dkind }.
  // Bracket marks may span index groups and a prefix derivative
  // (\partial_{[\lambda} F_{\mu\nu]}), so they live in one context per
  // factor: positions count the indices in written order.
  let mctx = null;
  const newCtx = () => ({ stack: [], marks: [], count: 0 });
  function script(up) {
    if (!mctx) mctx = newCtx();
    const out = { idx: [], deriv: [], dkind: null };
    const push = ix => { ix.up = up; if (!ix.fixed) delete ix.fixed; (out.dkind ? out.deriv : out.idx).push(ix); mctx.count++; };
    if (peek() && peek().t === '{') {
      p++;
      const stack = mctx.stack;
      while (peek() && peek().t !== '}') {
        const k = peek();
        if (k.t === '(' || k.t === '[') { stack.push({ type: k.t === '(' ? 'sym' : 'antisym', from: mctx.count, close: k.t === '(' ? ')' : ']' }); p++; continue; }
        if (k.t === ')' || k.t === ']') {
          const s = stack.pop();
          if (!s || s.close !== k.t) err(`'${k.t}' does not close a group`);
          mctx.marks.push({ type: s.type, from: s.from, to: mctx.count });
          p++; continue;
        }
        if (k.t === ',' || k.t === ';') { out.dkind = k.t === ',' ? 'partial' : 'nabla'; out.dstyle = k.t === ',' ? 'comma' : 'semicolon'; p++; continue; }
        if (k.t === '|') { p++; continue; }
        if (k.t === 'num' && /^[0-9]{2,}$/.test(k.v)) { for (const d of k.v) push({ sym: d, fixed: true }); p++; continue; }
        push(indexToken());
      }
      expect('}');
    } else {
      push(indexToken());
    }
    return out;
  }

  // Scalar power. A digit in braces is a component index (A^{0}), so a
  // power is an unbraced number (c^4, r^2) or a braced number with a sign
  // or a decimal point (^{-1}, ^{1.5}), and no index script follows it.
  function tryPower() {
    if (!peek() || peek().t !== '^') return null;
    const a = peek(1);
    const noScript = q => !toks[q] || (toks[q].t !== '_' && toks[q].t !== '^');
    if (a && a.t === 'num' && noScript(p + 2)) { p += 2; return +a.v; }
    if (a && a.t === '{') {
      let q = p + 2, s = '';
      if (toks[q] && toks[q].t === '-') { s = '-'; q++; }
      if (toks[q] && toks[q].t === 'num' && toks[q + 1] && toks[q + 1].t === '}' && (s || toks[q].v.includes('.')) && noScript(q + 2)) { p = q + 2; return +(s + toks[q].v); }
    }
    return null;
  }

  function nameToken() {
    const k = peek();
    if (k.t === 'let') { p++; return { name: k.v, tex: k.v }; }
    if (k.t === 'cmd' && GREEK.has(k.v)) { p++; return { name: k.v, tex: '\\' + k.v }; }
    if (k.t === 'cmd' && DECOR.has(k.v)) {
      p++;
      const inner = peek() && peek().t === '{' ? rawGroup() : (p++, toks[p - 1].v);
      const tex = `\\${k.v}{${inner}}`;
      return { name: tex, tex };
    }
    return null;
  }

  function kindOf(name, indices) {
    if (!indices.length) return 'scalar';
    if (name === 'g' || name === 'eta') return indices.every(i => i.up) ? 'inverseMetric' : 'metric';
    if (name === 'delta') return 'delta';
    if (name === 'epsilon' || name === 'varepsilon') return 'epsilon';
    if (name === 'Gamma') return 'christoffel';
    return 'tensor';
  }

  function factor(pre) {
    const nm = pre || nameToken();
    if (!nm) err(`'${peek().v}' cannot start a factor`);
    const f = { name: nm.name, tex: nm.tex, indices: [], kind: 'tensor' };
    while (peek() && peek().t === "'") { f.tex += "'"; f.name += "'"; p++; }
    const pw = tryPower();
    if (pw != null) { f.indices = []; f.kind = 'scalar'; f.power = pw; return f; }
    let deriv = [], dkind = null, dstyle = null, groups = 0, spacer = false;
    for (;;) {
      const k = peek();
      if (!k) break;
      if (k.t === '{' && peek(1) && peek(1).t === '}') { p += 2; spacer = true; continue; }
      if (k.t !== '^' && k.t !== '_') break;
      p++;
      const s = script(k.t === '^');
      f.indices.push(...s.idx);
      if (s.deriv.length) { deriv = deriv.concat(s.deriv); dkind = s.dkind; dstyle = s.dstyle; }
      groups++;
    }
    if (deriv.length) { f.deriv = deriv; f.derivKind = dkind; f.derivStyle = dstyle; }
    if (spacer) f.stagger = true;
    f.kind = kindOf(f.name, f.indices);
    const pw2 = f.indices.length ? null : tryPower();
    if (pw2 != null) f.power = pw2;
    return f;
  }

  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

  const mulTerms = (A, B) => {
    const out = [];
    for (const a of A) for (const b of B) out.push({ coeff: mulCoeff(a.coeff, b.coeff), factors: a.factors.concat(b.factors.map(cloneFactor)) });
    return out;
  };

  function product() {
    let acc = [{ coeff: 1, factors: [] }];
    let pendingDeriv = [];
    let any = false;
    for (;;) {
      const k = peek();
      if (!k || k.t === '+' || k.t === '-' || k.t === '=' || k.t === ')' || k.t === '}') {
        if (k && k.t === '=' && !any && p > 0 && toks[p - 1].t === '=') err('only one = is supported');
        break;
      }
      any = true;
      if (k.t === 'num') { p++; const pw = tryPower(); acc = mulTerms(acc, [{ coeff: pw != null ? (+k.v) ** pw : +k.v, factors: [] }]); continue; }
      if (k.t === '*' || k.t === '/') err(`use \\frac{a}{b} or a juxtaposed product, not '${k.t}'`);
      if (k.t === '(' || (k.t === 'cmd' && k.v === 'lbrack')) {
        if (pendingDeriv.length) err('a derivative before a bracket is not supported; write the product rule out, or put the derivative next to one tensor');
        const open = toks[p++];
        const inner = sum();
        const close = expect(')');
        // (J^{-1})^{a}{}_{b}: a bracketed name that takes indices.
        if (peek() && (peek().t === '^' || peek().t === '_') && inner.length === 1 && inner[0].coeff === 1 && inner[0].factors.length === 1 && !inner[0].factors[0].indices.length) {
          const tex = src.slice(open.pos, close.end);
          mctx = newCtx();
          const f = factor({ name: tex, tex });
          if (mctx.stack.length) err('a ( or [ in the indices has no match');
          mctx = null;
          acc = mulTerms(acc, [{ coeff: 1, factors: [f] }]);
          continue;
        }
        acc = mulTerms(acc, inner);
        continue;
      }
      if (k.t === 'cmd' && k.v === 'frac') {
        p++;
        const start = p;
        const num = subSum(), den = subSum();
        if (isNumeric(num) && isNumeric(den)) acc = mulTerms(acc, [{ coeff: num[0].coeff / den[0].coeff, factors: [] }]);
        else {
          const tex = src.slice(toks[start].pos, toks[p - 1].end);
          acc = mulTerms(acc, [{ coeff: 1, factors: [{ name: 'frac', tex: '\\frac' + tex, indices: [], kind: 'scalar' }] }]);
        }
        continue;
      }
      if (k.t === 'cmd' && k.v === 'sqrt') {
        p++;
        const inner = rawGroup();
        acc = mulTerms(acc, [{ coeff: 1, factors: [{ name: 'sqrt', tex: `\\sqrt{${inner}}`, indices: [], kind: 'scalar' }] }]);
        continue;
      }
      if (k.t === 'cmd' && k.v === 'sum') err('leave out the sum sign: in Einstein notation a repeated index is summed');
      if (k.t === 'cmd' && (k.v === 'partial' || k.v === 'nabla')) {
        p++;
        const kind = k.v;
        if (!pendingDeriv.length) mctx = newCtx();
        if (peek() && (peek().t === '_' || peek().t === '^')) {
          const up = toks[p++].t === '^';
          const s = script(up);
          for (const ix of s.idx) pendingDeriv.push({ ix, kind });
        } else err(`\\${kind} needs an index, for example \\${kind}_\\mu`);
        const nx = peek();
        const isFactorNext = nx && (nx.t === 'let' || (nx.t === 'cmd' && (GREEK.has(nx.v) || DECOR.has(nx.v))));
        const isDerivNext = nx && nx.t === 'cmd' && (nx.v === 'partial' || nx.v === 'nabla');
        if (!isFactorNext && !isDerivNext) {
          // Free-standing operator, for example the end of "\partial_\mu".
          if (mctx.stack.length || mctx.marks.length) err('a ( or [ bracket over a derivative must close on the next factor');
          mctx = null;
          for (const d of pendingDeriv) acc = mulTerms(acc, [{ coeff: 1, factors: [{ name: d.kind, tex: '\\' + d.kind, indices: [d.ix], kind: d.kind }] }]);
          pendingDeriv = [];
        }
        continue;
      }
      if (k.t === 'cmd' && !GREEK.has(k.v) && !DECOR.has(k.v)) {
        // Unknown command with no indices: a scalar symbol such as \infty.
        p++;
        acc = mulTerms(acc, [{ coeff: 1, factors: [{ name: k.v, tex: '\\' + k.v, indices: [], kind: 'scalar' }] }]);
        continue;
      }
      if (!pendingDeriv.length) mctx = newCtx();
      const nPre = pendingDeriv.length;
      const f = factor();
      if (mctx.stack.length) err('a ( or [ in the indices has no match');
      if (mctx.marks.length) {
        // written position -> position in factorIndices(f) (indices, then deriv)
        const nI = f.indices.length;
        const map = w => (w < nPre ? nI + w : (w - nPre < nI ? w - nPre : nI + nPre + (w - nPre - nI)));
        f.sym = mctx.marks.map(m => ({ type: m.type, slots: range(m.from, m.to).map(map) }));
      }
      mctx = null;
      if (pendingDeriv.length) {
        const kinds = new Set(pendingDeriv.map(d => d.kind));
        if (kinds.size > 1) err('mixing \\partial and \\nabla on one factor is not supported');
        f.deriv = pendingDeriv.map(d => d.ix).concat(f.deriv || []);
        f.derivKind = pendingDeriv[0].kind; f.derivStyle = 'prefix';
        pendingDeriv = [];
      }
      acc = mulTerms(acc, [{ coeff: 1, factors: [f] }]);
    }
    if (!any) err('a term is empty');
    return acc;
  }
  function subSum() {
    expect('{');
    const s = sum();
    expect('}');
    return s;
  }
  function sum() {
    let terms = [];
    let sign = 1;
    if (peek() && (peek().t === '+' || peek().t === '-')) { sign = peek().t === '-' ? -1 : 1; p++; }
    for (;;) {
      const pr = product();
      for (const t of pr) terms.push({ coeff: mulCoeff(sign, t.coeff), factors: t.factors });
      if (peek() && (peek().t === '+' || peek().t === '-')) { sign = peek().t === '-' ? -1 : 1; p++; continue; }
      break;
    }
    return terms;
  }

  const lhs = sum();
  let rhs = null;
  if (peek() && peek().t === '=') {
    p++;
    rhs = sum();
    if (peek() && peek().t === '=') err('only one = is supported');
  }
  if (peek()) err(`'${peek().v}' is not expected here`);
  return rhs ? makeExpr({ lhs, rhs }) : makeExpr(lhs);
}

function isNumeric(terms) { return terms.length === 1 && terms[0].factors.length === 0 && typeof terms[0].coeff === 'number'; }
function mulCoeff(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a * b;
  const s = x => typeof x === 'number' ? (x === 1 ? '' : x === -1 ? '-' : fmtNum(x)) : x;
  return (s(a) + ' ' + s(b)).trim();
}

// ---- builders ---------------------------------------------------------------
export function idx(sym, up = false) {
  const o = { sym: String(sym), up: !!up };
  if (/^[0-9]$/.test(o.sym)) o.fixed = true;
  return o;
}
// fac('R', 'u:rho d:sigma d:mu d:nu') or fac('T', [idx('a', true), idx('b')], { kind, deriv, ... })
export function fac(name, indices = [], opts = {}) {
  if (typeof indices === 'string') indices = indices.trim() ? indices.trim().split(/\s+/).map(s => { const [v, sy] = s.split(':'); return idx(sy, v === 'u'); }) : [];
  const tex = opts.tex ?? (GREEK.has(name) ? '\\' + name : name);
  const f = { name, tex, indices: indices.map(i => ({ ...i })) };
  f.kind = opts.kind ?? (!indices.length ? 'scalar' : (name === 'g' || name === 'eta') ? (indices.every(i => i.up) ? 'inverseMetric' : 'metric')
    : name === 'delta' ? 'delta' : (name === 'epsilon' || name === 'varepsilon') ? 'epsilon' : name === 'Gamma' ? 'christoffel' : 'tensor');
  for (const k of ['deriv', 'derivKind', 'derivStyle', 'sym', 'power', 'stagger']) if (opts[k] != null) f[k] = opts[k];
  if (f.deriv) f.deriv = f.deriv.map(i => ({ ...i }));
  if (f.deriv && !f.derivKind) f.derivKind = 'nabla';
  return f;
}
export function term(coeff, factors) { return { coeff, factors }; }

export function cloneFactor(f) {
  const g = { ...f, indices: f.indices.map(i => ({ ...i })) };
  if (f.deriv) g.deriv = f.deriv.map(i => ({ ...i }));
  if (f.sym) g.sym = f.sym.map(s => ({ type: s.type, slots: s.slots.slice() }));
  return g;
}
export function cloneExpr(e) {
  if (e.rel) return makeExpr({ lhs: e.lhs.terms, rhs: e.rhs.terms });
  return makeExpr(e.terms);
}

// All indices of a factor in reading order (slots then derivative indices).
export const factorIndices = f => f.indices.concat(f.deriv || []);

// Indices of a factor in written order: a prefix derivative comes first.
export const writtenIndices = f => (f.deriv && (f.derivStyle || 'prefix') === 'prefix' ? f.deriv.concat(f.indices) : factorIndices(f));

// Free indices keep their written order: \nabla_\mu V^\nu has free [mu, nu].
function termIndexInfo(t) {
  const seen = new Map();
  for (const f of t.factors) for (const ix of writtenIndices(f)) {
    if (ix.fixed) continue;
    if (!seen.has(ix.sym)) seen.set(ix.sym, []);
    seen.get(ix.sym).push(ix);
  }
  const free = [], dummies = [];
  for (const [sym, list] of seen) {
    if (list.length === 1) free.push({ sym, up: list[0].up });
    else dummies.push(sym);
  }
  return { free, dummies, seen };
}

// makeExpr([terms]) or makeExpr({ lhs: [terms], rhs: [terms] }).
export function makeExpr(x) {
  if (x && !Array.isArray(x) && x.lhs) {
    const lhs = makeExpr(x.lhs), rhs = makeExpr(x.rhs);
    const e = {
      terms: lhs.terms.map(t => ({ ...t, side: 0 })).concat(rhs.terms.map(t => ({ ...t, side: 1 }))),
      free: lhs.free.length ? lhs.free : rhs.free,
      dummies: [...new Set(lhs.dummies.concat(rhs.dummies))],
      rel: '=', lhs, rhs, tex: '',
    };
    e.tex = toTex(e, { colors: false });
    return e;
  }
  const terms = x.map(t => ({ coeff: t.coeff, factors: t.factors.map(cloneFactor) }));
  const free = terms.length ? termIndexInfo(terms[0]).free : [];
  const dummies = [...new Set(terms.flatMap(t => termIndexInfo(t).dummies))];
  const e = { terms, free, dummies, tex: '' };
  e.tex = toTex(e, { colors: false });
  return e;
}

// ---- printer ---------------------------------------------------------------
export function symTex(sym) {
  const m = /^([A-Za-z]+)('*)$/.exec(sym);
  if (m && GREEK.has(m[1])) return '\\' + m[1] + m[2];
  return sym;
}

// Map sym -> colour slot 0..7, by first appearance in print order.
export function indexColorMap(expr) {
  const map = new Map();
  const visit = f => {
    const pre = f.deriv && (f.derivStyle || 'prefix') === 'prefix';
    const order = pre ? f.deriv.concat(f.indices) : factorIndices(f);
    for (const ix of order) if (!ix.fixed && !map.has(ix.sym)) map.set(ix.sym, map.size % 8);
  };
  for (const t of expr.terms) for (const f of t.factors) visit(f);
  return map;
}

export function fmtNum(x) {
  if (Number.isInteger(x)) return String(x);
  for (let q = 2; q <= 24; q++) {
    const pn = Math.round(x * q);
    if (Math.abs(pn / q - x) < 1e-12) return `${pn < 0 ? '-' : ''}\\frac{${Math.abs(pn)}}{${q}}`;
  }
  return String(+x.toPrecision(6));
}

// factorTex(f, { colors, colorMap, subst }) prints one factor. subst maps
// an index sym to a TeX label (a component value such as 0 or \theta); the
// label keeps the colour of its index.
export function factorTex(f, opts = {}) {
  const cmap = opts.colorMap || indexColorMap({ terms: [{ coeff: 1, factors: [f] }] });
  return printFactor(f, cmap, opts.colors !== false, opts.subst);
}

function printFactor(f, cmap, colors, subst) {
  const c = ix => {
    const s = subst && subst[ix.sym] != null ? String(subst[ix.sym]) : symTex(ix.sym);
    if (!colors || ix.fixed || !cmap.has(ix.sym)) return s;
    return `\\class{i${cmap.get(ix.sym)}}{${s}}`;
  };
  let out = '';
  const style = f.derivStyle || 'prefix';
  const n = f.indices.length, nd = (f.deriv || []).length;
  // Bracket marks: slots index factorIndices(f); open before the slot that
  // is written first, close after the slot that is written last.
  const written = style === 'prefix' && nd ? [...Array(nd).keys()].map(j => n + j).concat([...Array(n).keys()]) : [...Array(n + nd).keys()];
  const wpos = new Map(written.map((q, w) => [q, w]));
  const open = new Map(), close = new Map();
  for (const s of f.sym || []) {
    const ws = s.slots.map(q => wpos.get(q)).filter(w => w != null);
    if (!ws.length) continue;
    const a = written[Math.min(...ws)], b = written[Math.max(...ws)];
    open.set(a, (open.get(a) || '') + (s.type === 'sym' ? '(' : '['));
    close.set(b, (s.type === 'sym' ? ')' : ']') + (close.get(b) || ''));
  }
  const cw = (ix, q) => (open.get(q) || '') + c(ix) + (close.get(q) || '');
  if (f.deriv && style === 'prefix') {
    const op = f.derivKind === 'partial' ? '\\partial' : '\\nabla';
    f.deriv.forEach((d, j) => { out += `${op}${d.up ? '^' : '_'}{${cw(d, n + j)}} `; });
  }
  if (f.kind === 'partial' || f.kind === 'nabla') {
    const ix = f.indices[0];
    return `\\${f.kind}${ix.up ? '^' : '_'}{${c(ix)}}`;
  }
  out += f.tex;
  if (f.power != null && !f.indices.length) out += Number.isInteger(f.power) && f.power >= 0 && f.power < 10 ? `^${f.power}` : `^{${f.power}}`;
  const mixed = f.indices.some(i => i.up) && f.indices.some(i => !i.up);
  const stagger = f.stagger ?? (mixed && f.kind !== 'christoffel' && f.kind !== 'delta');
  const groups = [];
  for (let k = 0; k < n; k++) {
    const ix = f.indices[k];
    if (!groups.length || groups[groups.length - 1].up !== ix.up) groups.push({ up: ix.up, s: '' });
    groups[groups.length - 1].s += cw(ix, k);
  }
  const suffix = f.deriv && style !== 'prefix' ? (style === 'comma' ? ',' : ';') + f.deriv.map((d, j) => cw(d, n + j)).join('') : '';
  if (suffix) {
    const last = groups[groups.length - 1];
    if (last && !last.up && !f.deriv.some(d => d.up)) last.s += suffix;
    else groups.push({ up: false, s: suffix });
  }
  // Without staggering, ^{..}_{..} pairs stack; a third group still needs {}.
  groups.forEach((g, k) => {
    if (k > 0 && (stagger || k > 1 || g.up === groups[k - 1].up)) out += '{}';
    out += (g.up ? '^' : '_') + '{' + g.s + '}';
  });
  return out;
}

function printTerms(terms, cmap, colors) {
  if (!terms.length) return '0';
  let out = '';
  terms.forEach((t, k) => {
    let co = t.coeff, neg = false;
    if (typeof co === 'number') { neg = co < 0; co = Math.abs(co); }
    else if (co.startsWith('-')) { neg = true; co = co.slice(1).trim(); }
    let body = t.factors.map(f => printFactor(f, cmap, colors)).join(' ');
    let cs = typeof co === 'number' ? (co === 1 && body ? '' : fmtNum(co)) : co;
    if (cs && body) cs += ' ';
    const piece = cs + body;
    if (k === 0) out += (neg ? '-' : '') + piece;
    else out += (neg ? ' - ' : ' + ') + piece;
  });
  return out;
}

// toTex(expr, { colors: true, colorMap }) -> TeX string.
export function toTex(expr, opts = {}) {
  const colors = opts.colors !== false;
  const cmap = opts.colorMap || indexColorMap(expr);
  if (expr.rel) {
    const L = expr.terms.filter(t => t.side === 0), R = expr.terms.filter(t => t.side === 1);
    return printTerms(L, cmap, colors) + ' = ' + printTerms(R, cmap, colors);
  }
  return printTerms(expr.terms, cmap, colors);
}

// ---- validation --------------------------------------------------------------
const show = sym => (GREEK.has(sym.replace(/'+$/, '')) ? '\\' : '') + sym;
const listSyms = list => list.length ? list.map(i => `${show(i.sym)} (${i.up ? 'upper' : 'lower'})`).join(', ') : 'none';

// validate(expr, { dim, euclidean }) -> { ok, errors: [{ msg, term?, sym? }], warnings, free, dummies, rank: { up, down } }
export function validate(expr, opts = {}) {
  const errors = [], warnings = [];
  const termSets = [];
  const sides = expr.rel ? [expr.terms.filter(t => t.side === 0), expr.terms.filter(t => t.side === 1)] : [expr.terms];
  sides.forEach((terms, sideNo) => {
    terms.forEach((t, k) => {
      const where = `${expr.rel ? (sideNo ? 'right side, ' : 'left side, ') : ''}term ${k + 1}`;
      const { free, seen } = termIndexInfo(t);
      for (const [sym, list] of seen) {
        if (list.length > 2) errors.push({ msg: `In ${where}, the index ${show(sym)} appears ${list.length} times. An index may appear once (free) or twice (summed), never more. Rename one pair.`, term: k, sym });
        else if (list.length === 2 && list[0].up === list[1].up && !opts.euclidean)
          errors.push({ msg: `In ${where}, ${show(sym)} appears twice as ${list[0].up ? 'an upper' : 'a lower'} index. The Einstein rule sums one upper and one lower index; use the metric to ${list[0].up ? 'lower' : 'raise'} one of them.`, term: k, sym });
      }
      for (const f of t.factors) {
        const fi = factorIndices(f);
        for (const s of f.sym || []) {
          const vs = new Set(s.slots.map(q => fi[q] && fi[q].up));
          if (s.slots.some(q => !fi[q])) errors.push({ msg: `In ${where}, a (anti)symmetrization bracket on ${f.tex} has no index inside it.`, term: k });
          else if (vs.size > 1) errors.push({ msg: `In ${where}, the bracket on ${f.tex} mixes upper and lower indices. Symmetrize indices of one kind only.`, term: k });
        }
        if (f.kind === 'delta' && f.indices.length === 2 && f.indices[0].up === f.indices[1].up)
          warnings.push({ msg: `In ${where}, \\delta has two ${f.indices[0].up ? 'upper' : 'lower'} indices. The Kronecker delta is a mixed tensor \\delta^a_b; with two indices of one kind it is the metric only in an orthonormal frame.`, term: k });
        if ((f.kind === 'metric' || f.kind === 'inverseMetric') && f.indices.length !== 2)
          errors.push({ msg: `In ${where}, the metric ${f.tex} has ${f.indices.length} indices; it needs exactly two.`, term: k });
        if (f.kind === 'christoffel' && (f.indices.length !== 3 || !f.indices[0].up || f.indices[1].up || f.indices[2].up))
          warnings.push({ msg: `In ${where}, \\Gamma is usually written with one upper and two lower indices, \\Gamma^\\lambda_{\\mu\\nu}.`, term: k });
        if (f.kind === 'epsilon' && opts.dim && f.indices.length !== opts.dim)
          errors.push({ msg: `In ${where}, the Levi-Civita symbol has ${f.indices.length} indices, but in ${opts.dim} dimensions it needs ${opts.dim}.`, term: k });
      }
      // A bare 0 is the zero tensor of any rank: it matches every free list.
      if (!(t.factors.length === 0 && t.coeff === 0)) termSets.push({ where, free, k, sideNo });
    });
  });
  const ref = termSets[0];
  const key = fr => fr.map(i => (i.up ? '^' : '_') + i.sym).sort().join(' ');
  for (const ts of termSets.slice(1)) {
    if (key(ts.free) !== key(ref.free)) {
      const syms = ref.free.map(i => i.sym).sort().join(), syms2 = ts.free.map(i => i.sym).sort().join();
      const msg = syms === syms2
        ? `The ${ts.where} has the free indices ${listSyms(ts.free)}, but the ${ref.where} has ${listSyms(ref.free)}. A free index must be at the same height in every term${expr.rel ? ' and on both sides' : ''}.`
        : `The ${ts.where} has the free indices ${listSyms(ts.free)}, but the ${ref.where} has ${listSyms(ref.free)}. Every term must have the same free indices${expr.rel ? ', on both sides of =' : ''}.`;
      errors.push({ msg, term: ts.k });
    }
  }
  const free = ref ? ref.free : [];
  return {
    ok: errors.length === 0, errors, warnings, free, dummies: expr.dummies.slice(),
    rank: { up: free.filter(i => i.up).length, down: free.filter(i => !i.up).length },
  };
}

// Rename index syms: relabel(expr, { mu: 'alpha' }).
export function relabel(expr, map) {
  const r = ix => (map[ix.sym] != null ? { ...ix, sym: map[ix.sym] } : { ...ix });
  const fix = terms => terms.map(t => ({ coeff: t.coeff, factors: t.factors.map(f => { const g = cloneFactor(f); g.indices = g.indices.map(r); if (g.deriv) g.deriv = g.deriv.map(r); return g; }) }));
  if (expr.rel) return makeExpr({ lhs: fix(expr.lhs.terms), rhs: fix(expr.rhs.terms) });
  return makeExpr(fix(expr.terms));
}

// Structural key of an expression (for round-trip tests and caches).
export function exprKey(expr) {
  const fk = f => [f.name, f.kind, f.power ?? '', f.indices.map(i => (i.up ? '^' : '_') + i.sym).join(''),
    (f.deriv || []).map(i => (i.up ? '^' : '_') + i.sym).join(''), f.derivKind || '',
    (f.sym || []).map(s => s.type + s.slots.join('.')).join('|')].join('/');
  const tk = t => `${typeof t.coeff === 'number' ? +t.coeff.toPrecision(12) : t.coeff}*${t.factors.map(fk).join(' ')}@${t.side ?? 0}`;
  return (expr.rel ? '=' : '') + expr.terms.map(tk).join(' + ');
}

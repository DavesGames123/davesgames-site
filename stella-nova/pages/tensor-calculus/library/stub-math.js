// ============================================================================
//  library/stub-math.js  ·  local stand-in for the MATH engine (DOM-free)
// ----------------------------------------------------------------------------
//  The LIBRARY package wrote this file before the MATH package committed
//  tensor/index.js. It gives the subset of the MATH API (CONTRACT.md) that
//  the library entries use. library/math.js picks MATH when MATH is
//  there and this file when it is not, so each entry calls one API only.
//
//  Components are plain contract objects:
//      { shape: [n, ...], variance: ['u'|'d', ...], data: Float64Array }
//  Row-major: the last slot changes fastest. 'u' upper, 'd' lower.
//
//  Metrics are LIBRARY metric objects:
//      { id, dim, coords: ['t', 'r', ...], signature, g(x) -> n x n nested }
//  Derivatives are central finite differences (step H1 for the metric,
//  H2 for the Christoffel symbols). The error is near 1e-7 for smooth
//  metrics with x of order 1. Tests compare against closed forms.
//
//  ANCHORS   (grep -n "<anchor>" stub-math.js)
//      components ......... "export function T("
//      einsum ............. "export function einsum"
//      transform .......... "export function transform"
//      symmetrize ......... "export function symmetrize"
//      levi-civita ........ "export function leviCivita"
//      matrices ........... "export function matInverse"
//      christoffel ........ "export function christoffel"
//      riemann ............ "export function riemann"
//      ricci / scalar ..... "export function ricci", "export function scalarCurvature"
//      einstein ........... "export function einsteinTensor"
//      geodesic ........... "export function geodesic"
//      parallel transport . "export function parallelTransport"
//      index TeX parser ... "export function parseIndexTex"
//      validate ........... "export function validate"
// ============================================================================

const sizeOf = shape => shape.reduce((a, b) => a * b, 1);
const stridesOf = shape => { const s = []; let k = 1; for (let i = shape.length - 1; i >= 0; i--) { s[i] = k; k *= shape[i]; } return s; };

function* tuples(shape) {
  const r = shape.length, idx = new Array(r).fill(0), n = sizeOf(shape);
  for (let k = 0; k < n; k++) {
    yield idx.slice();
    for (let d = r - 1; d >= 0; d--) { if (++idx[d] < shape[d]) break; idx[d] = 0; }
  }
}
export { tuples as indexTuples };

// Components from a nested array, a number, or Components.
export function T(x, variance) {
  if (typeof x === 'number') return { shape: [], variance: [], data: Float64Array.of(x) };
  if (x && x.shape && x.data) return { shape: x.shape.slice(), variance: (variance ?? x.variance).slice(), data: Float64Array.from(x.data) };
  const shape = []; let a = x;
  while (Array.isArray(a)) { shape.push(a.length); a = a[0]; }
  const flat = (function rec(v) { return Array.isArray(v) ? v.flatMap(rec) : [+v]; })(x);
  if (typeof variance === 'string') variance = variance.split('');
  return { shape, variance: variance ?? shape.map(() => 'u'), data: Float64Array.from(flat) };
}
export function zeros(shape, variance) { return { shape: shape.slice(), variance: variance.slice(), data: new Float64Array(sizeOf(shape)) }; }
export function get(t, ...idx) { const s = stridesOf(t.shape); let o = 0; for (let i = 0; i < idx.length; i++) o += idx[i] * s[i]; return t.data[o]; }
export function toNested(t) {
  const s = stridesOf(t.shape);
  const rec = (d, off) => d === t.shape.length ? t.data[off] : Array.from({ length: t.shape[d] }, (_, i) => rec(d + 1, off + i * s[d]));
  return rec(0, 0);
}
export function maxAbs(t) { let m = 0; for (const v of t.data) m = Math.max(m, Math.abs(v)); return m; }
export function sub(a, b) { const o = T(a); for (let i = 0; i < o.data.length; i++) o.data[i] -= b.data[i]; return o; }
export function scale(a, k) { const o = T(a); for (let i = 0; i < o.data.length; i++) o.data[i] *= k; return o; }

// einsum('ij,jk->ik', A, B). A repeated letter is summed. The output
// variance of a letter is the variance of its first input slot.
export function einsum(spec, ...ts) {
  ts = ts.map(t => (t && t.data ? t : T(t)));
  spec = spec.replace(/\s+/g, '');
  let [lhs, rhs] = spec.split('->');
  const ins = lhs.split(',');
  if (ins.length !== ts.length) throw new Error(`einsum: '${spec}' names ${ins.length} inputs, ${ts.length} given`);
  const range = {}, vari = {}, count = {};
  ins.forEach((s, q) => {
    if (s.length !== ts[q].shape.length) throw new Error(`einsum: input ${q + 1} has rank ${ts[q].shape.length}, '${s}' has ${s.length} letters`);
    [...s].forEach((c, k) => {
      const n = ts[q].shape[k];
      if (range[c] != null && range[c] !== n) throw new Error(`einsum: letter ${c} has range ${range[c]} and ${n}`);
      range[c] = n; count[c] = (count[c] || 0) + 1; vari[c] ??= ts[q].variance[k];
    });
  });
  if (rhs == null) rhs = Object.keys(count).filter(c => count[c] === 1).sort().join('');
  const outL = [...rhs], sumL = Object.keys(range).filter(c => !outL.includes(c));
  const out = zeros(outL.map(c => range[c]), outL.map(c => vari[c]));
  const letters = outL.concat(sumL), pos = Object.fromEntries(letters.map((c, k) => [c, k]));
  const maps = ins.map((s, q) => { const st = stridesOf(ts[q].shape); return [...s].map((c, k) => [pos[c], st[k]]); });
  const val = new Array(letters.length).fill(0), sumShape = sumL.map(c => range[c]);
  let w = 0;
  for (const oi of tuples(out.shape)) {
    for (let k = 0; k < outL.length; k++) val[k] = oi[k];
    let s = 0;
    for (const si of tuples(sumShape)) {
      for (let k = 0; k < sumL.length; k++) val[outL.length + k] = si[k];
      let p = 1;
      for (let q = 0; q < ts.length && p !== 0; q++) { let o = 0; for (const [l, st] of maps[q]) o += val[l] * st; p *= ts[q].data[o]; }
      s += p;
    }
    out.data[w++] = s;
  }
  return out;
}

// Transform every slot. J[a][b] = dx'^a/dx^b. Upper slots take J, lower
// slots take the inverse, transposed (the same rule as MATH tensor.js).
export function transform(t, J) {
  const Ji = matInverse(J);
  let cur = T(t);
  const r = cur.shape.length, L = 'abcdefgh', M = 'ABCDEFGH';
  for (let s = 0; s < r; s++) {
    const inL = [...L.slice(0, r)], outL = inL.slice(); outL[s] = M[s];
    const mat = cur.variance[s] === 'u' ? T(J) : T(transposeM(Ji));
    const res = einsum(`${M[s]}${L[s]},${inL.join('')}->${outL.join('')}`, mat, cur);
    res.variance = cur.variance.slice();
    cur = res;
  }
  return cur;
}

export function permutations(arr) {
  if (arr.length <= 1) return [{ p: arr.slice(), sign: 1 }];
  const out = [];
  arr.forEach((x, i) => {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const { p, sign } of permutations(rest)) out.push({ p: [x, ...p], sign: i % 2 ? -sign : sign });
  });
  return out;
}
function symCore(t, slots, anti) {
  const out = zeros(t.shape, t.variance), perms = permutations(slots.map((_, i) => i)), f = 1 / perms.length;
  for (const idx of tuples(t.shape)) {
    let s = 0;
    for (const { p, sign } of perms) {
      const j = idx.slice();
      slots.forEach((slot, k) => { j[slot] = idx[slots[p[k]]]; });
      s += (anti ? sign : 1) * get(t, ...j);
    }
    out.data[stridesOf(t.shape).reduce((o, st, k) => o + st * idx[k], 0)] = s * f;
  }
  return out;
}
export function symmetrize(t, slots) { return symCore(t, slots, false); }
export function antisymmetrize(t, slots) { return symCore(t, slots, true); }

export function leviCivita(n, variance) {
  const out = zeros(new Array(n).fill(n), variance ?? new Array(n).fill('d'));
  const st = stridesOf(out.shape);
  for (const { p, sign } of permutations([...Array(n).keys()])) out.data[p.reduce((o, v, k) => o + v * st[k], 0)] = sign;
  return out;
}
export function kroneckerDelta(n, variance = ['u', 'd']) {
  const out = zeros([n, n], variance);
  for (let i = 0; i < n; i++) out.data[i * n + i] = 1;
  return out;
}

// ---- dense matrices (nested arrays) ----------------------------------------
export function transposeM(A) { return A[0].map((_, j) => A.map(r => r[j])); }
export function matMul(A, B) { return A.map(r => B[0].map((_, j) => r.reduce((s, x, k) => s + x * B[k][j], 0))); }
export function matInverse(A) {
  const n = A.length, M = A.map((r, i) => r.concat(Array.from({ length: n }, (_, j) => +(i === j))));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) throw new Error('singular matrix');
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let k = 0; k < 2 * n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c && M[r][c] !== 0) { const f = M[r][c]; for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map(r => r.slice(n));
}
export function matDet(A) {
  const n = A.length, M = A.map(r => r.slice());
  let d = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (M[p][c] === 0) return 0;
    if (p !== c) { [M[c], M[p]] = [M[p], M[c]]; d = -d; }
    d *= M[c][c];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k < n; k++) M[r][k] -= f * M[c][k]; }
  }
  return d;
}

// ---- geometry from a metric (finite differences) ---------------------------
const H1 = 1e-4, H2 = 1e-3;
function dMetric(metric, x, h = H1) {
  const n = metric.dim, out = [];
  for (let k = 0; k < n; k++) {
    const xp = x.slice(), xm = x.slice(); xp[k] += h; xm[k] -= h;
    const gp = metric.g(xp), gm = metric.g(xm);
    out.push(gp.map((r, i) => r.map((v, j) => (v - gm[i][j]) / (2 * h))));
  }
  return out; // out[k][i][j] = d_k g_ij
}
function gammaArr(metric, x) {
  const n = metric.dim, gi = matInverse(metric.g(x)), dg = dMetric(metric, x);
  const G = [];
  for (let l = 0; l < n; l++) {
    G.push([]);
    for (let i = 0; i < n; i++) {
      G[l].push([]);
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += gi[l][k] * (dg[i][k][j] + dg[j][k][i] - dg[k][i][j]);
        G[l][i].push(s / 2);
      }
    }
  }
  return G;
}
// Gamma^l_{ij}, variance u d d.
export function christoffel(metric, x) { return T(gammaArr(metric, x), ['u', 'd', 'd']); }

// R^r_{s m n} = d_m G^r_{n s} - d_n G^r_{m s} + G^r_{m l} G^l_{n s} - G^r_{n l} G^l_{m s}
// (MTW and Carroll sign convention).
export function riemann(metric, x) {
  const n = metric.dim, G = gammaArr(metric, x), dG = [];
  for (let k = 0; k < n; k++) {
    const xp = x.slice(), xm = x.slice(); xp[k] += H2; xm[k] -= H2;
    const Gp = gammaArr(metric, xp), Gm = gammaArr(metric, xm);
    dG.push(Gp.map((a, l) => a.map((b, i) => b.map((v, j) => (v - Gm[l][i][j]) / (2 * H2)))));
  }
  const out = zeros([n, n, n, n], ['u', 'd', 'd', 'd']);
  let w = 0;
  for (let r = 0; r < n; r++) for (let s = 0; s < n; s++) for (let m = 0; m < n; m++) for (let q = 0; q < n; q++) {
    let v = dG[m][r][q][s] - dG[q][r][m][s];
    for (let l = 0; l < n; l++) v += G[r][m][l] * G[l][q][s] - G[r][q][l] * G[l][m][s];
    out.data[w++] = v;
  }
  return out;
}
// R_{s n} = R^r_{s r n}
export function ricci(metric, x, Riem) {
  const R = Riem ?? riemann(metric, x), n = metric.dim, out = zeros([n, n], ['d', 'd']);
  for (let s = 0; s < n; s++) for (let q = 0; q < n; q++) { let v = 0; for (let r = 0; r < n; r++) v += get(R, r, s, r, q); out.data[s * n + q] = v; }
  return out;
}
export function scalarCurvature(metric, x, Ric) {
  const Rc = Ric ?? ricci(metric, x), gi = matInverse(metric.g(x)), n = metric.dim;
  let s = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s += gi[i][j] * Rc.data[i * n + j];
  return s;
}
export function einsteinTensor(metric, x) {
  const Rc = ricci(metric, x), R = scalarCurvature(metric, x, Rc), g = metric.g(x), n = metric.dim, out = zeros([n, n], ['d', 'd']);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.data[i * n + j] = Rc.data[i * n + j] - 0.5 * R * g[i][j];
  return out;
}

// RK4 for d2x/dt2 = -G^l_{mn} u^m u^n. Returns { xs: [x], vs: [v] }.
export function geodesic(metric, x0, v0, opts = {}) {
  const dt = opts.dt ?? 0.01, steps = opts.steps ?? 200, n = metric.dim;
  const f = (x, v) => { const G = gammaArr(metric, x); return v.map((_, l) => { let s = 0; for (let m = 0; m < n; m++) for (let q = 0; q < n; q++) s -= G[l][m][q] * v[m] * v[q]; return s; }); };
  let x = x0.slice(), v = v0.slice();
  const xs = [x.slice()], vs = [v.slice()];
  const add = (a, b, k) => a.map((ai, i) => ai + k * b[i]);
  for (let s = 0; s < steps; s++) {
    const a1 = f(x, v), k1x = v;
    const k2x = add(v, a1, dt / 2), a2 = f(add(x, k1x, dt / 2), k2x);
    const k3x = add(v, a2, dt / 2), a3 = f(add(x, k2x, dt / 2), k3x);
    const k4x = add(v, a3, dt), a4 = f(add(x, k3x, dt), k4x);
    x = x.map((xi, i) => xi + dt / 6 * (k1x[i] + 2 * k2x[i] + 2 * k3x[i] + k4x[i]));
    v = v.map((vi, i) => vi + dt / 6 * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i]));
    xs.push(x.slice()); vs.push(v.slice());
  }
  return { xs, vs };
}

// dV^m/dt = -G^m_{n l} (dx^n/dt) V^l along curve(t), t in [0, 1]. RK4.
export function parallelTransport(metric, curve, V0, opts = {}) {
  const steps = opts.steps ?? 400, h = 1 / steps, n = metric.dim, e = 1e-5;
  const vel = t => { const a = curve(t + e), b = curve(t - e); return a.map((ai, i) => (ai - b[i]) / (2 * e)); };
  const f = (t, V) => { const x = curve(t), u = vel(t), G = gammaArr(metric, x); return V.map((_, m) => { let s = 0; for (let q = 0; q < n; q++) for (let l = 0; l < n; l++) s -= G[m][q][l] * u[q] * V[l]; return s; }); };
  let V = V0.slice(); const Vs = [V.slice()];
  const add = (a, b, k) => a.map((ai, i) => ai + k * b[i]);
  for (let s = 0; s < steps; s++) {
    const t = s * h;
    const k1 = f(t, V), k2 = f(t + h / 2, add(V, k1, h / 2)), k3 = f(t + h / 2, add(V, k2, h / 2)), k4 = f(t + h, add(V, k3, h));
    V = V.map((v, i) => v + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    Vs.push(V.slice());
  }
  return { V, Vs };
}

// ---- index TeX parser (restricted grammar of CONTRACT.md) ------------------
//  parseIndexTex('R^{\\rho}{}_{\\sigma\\mu\\nu}') -> TensorExpr. Accepted:
//  names (letters, \greek, \cmd{x}), index groups ^{..} _{..} ^x _x, the {}
//  spacer, (..) and [..] symmetry marks inside a group, ',' and ';'
//  derivative marks, \partial_\mu, \nabla_\mu, numbers, \frac{..}{..},
//  \sqrt{..}, parentheses round sub-sums, + - and one '='.
const GREEK = new Set('alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega ell'.split(' '));
const KIND = { g: 'metric', '\\eta': 'metric', '\\delta': 'delta', '\\epsilon': 'epsilon', '\\Gamma': 'christoffel', '\\partial': 'partial', '\\nabla': 'nabla' };
// Name macros that carry no indices of their own (operators, text).
const OPNAMES = new Set(['\\det', '\\operatorname', '\\mathrm', '\\mathcal', '\\mathbf', '\\tilde', '\\bar', '\\hat', '\\dot', '\\ddot', '\\text', '\\exp', '\\sin', '\\cos', '\\ln', '\\mathbb', '\\boldsymbol', '\\mathbb']);

function lex(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
      const name = '\\' + m[1];
      i += m[0].length;
      if (name === '\\,' || name === '\\;' || name === '\\!' || name === '\\quad' || name === '\\qquad' || name === '\\left' || name === '\\right' || name === '\\ ') continue;
      out.push({ t: 'cmd', v: name }); continue;
    }
    if (/[0-9.]/.test(c)) { const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i)); out.push({ t: 'num', v: +m[0] }); i += m[0].length; continue; }
    if (/[A-Za-z]/.test(c)) { out.push({ t: 'let', v: c }); i++; continue; }
    out.push({ t: 'sym', v: c }); i++;
  }
  return out;
}

export function parseIndexTex(src) {
  const toks = lex(src); let p = 0;
  const peek = () => toks[p], next = () => toks[p++];
  const isSym = v => peek() && peek().t === 'sym' && peek().v === v;
  const expect = v => { if (!isSym(v)) throw new Error(`parseIndexTex: expected '${v}' at token ${p} in ${src}`); p++; };
  const group = () => { // raw tokens of a {...} group
    expect('{'); let depth = 1; const start = p;
    while (p < toks.length) { const t = next(); if (t.t === 'sym' && t.v === '{') depth++; if (t.t === 'sym' && t.v === '}' && !--depth) return toks.slice(start, p - 1); }
    throw new Error('parseIndexTex: unclosed { in ' + src);
  };
  // Index list from tokens; returns { idx: [Index], deriv: [Index], sym: [] }
  const indexList = (ts, up, slot0) => {
    const idx = [], deriv = [], sym = []; let mode = 'idx', open = null;
    for (const t of ts) {
      if (t.t === 'sym' && (t.v === ',' || t.v === ';')) { mode = t.v === ',' ? 'partial' : 'covariant'; continue; }
      if (t.t === 'sym' && (t.v === '(' || t.v === '[')) { open = { type: t.v === '(' ? 'sym' : 'antisym', from: slot0 + idx.length }; continue; }
      if (t.t === 'sym' && (t.v === ')' || t.v === ']')) { if (open) sym.push({ type: open.type, slots: [open.from, slot0 + idx.length - 1] }); open = null; continue; }
      if (t.t === 'sym' && t.v === '|') continue;
      if (t.t === 'sym' && t.v === "'") { const last = (mode === 'idx' ? idx : deriv).at(-1); if (last) last.sym += "'"; continue; }
      if (t.t === 'num') continue; // a power such as r^2: not an index
      let sym2 = null;
      if (t.t === 'let') sym2 = t.v;
      else if (t.t === 'cmd' && GREEK.has(t.v.slice(1))) sym2 = t.v.slice(1);
      if (sym2 == null) continue;
      const I = { sym: sym2, up };
      if (mode === 'idx') idx.push(I); else { I.deriv = mode; deriv.push(I); }
    }
    return { idx, deriv, sym };
  };
  const scripts = f => {
    for (;;) {
      if (isSym('{') && toks[p + 1] && toks[p + 1].t === 'sym' && toks[p + 1].v === '}') { p += 2; continue; }
      if (isSym('^') || isSym('_')) {
        const up = next().v === '^';
        let ts;
        if (isSym('{')) ts = group(); else ts = [next()];
        // \prime as a prime mark
        ts = ts.map(t => (t.t === 'cmd' && t.v === '\\prime') ? { t: 'sym', v: "'" } : t);
        const r = indexList(ts, up, f.indices.length);
        f.indices.push(...r.idx); f.deriv.push(...r.deriv); f.sym.push(...r.sym);
        continue;
      }
      if (isSym("'")) { p++; continue; }
      break;
    }
    return f;
  };
  const factor = () => {
    const t = peek();
    if (!t) return null;
    if (t.t === 'num') { next(); return { coeff: t.v }; }
    if (t.t === 'sym' && t.v === '(') {
      next(); const inner = sum(')'); expect(')');
      const f = { name: '()', tex: '', kind: 'scalar', indices: inner.free.map(i => ({ ...i })), deriv: [], sym: [], group: inner };
      return scripts(f);
    }
    if (t.t === 'sym' && t.v === '{') { const ts = group(); const inner = parseIndexTex(ts.map(untok).join(' ')); return { name: '{}', tex: '', kind: 'scalar', indices: inner.free.map(i => ({ ...i })), deriv: [], sym: [], group: inner }; }
    if (t.t === 'let') { next(); return scripts({ name: t.v, tex: t.v, kind: t.v === 'g' ? 'metric' : 'tensor', indices: [], deriv: [], sym: [] }); }
    if (t.t === 'cmd') {
      next();
      if (t.v === '\\frac' || t.v === '\\tfrac' || t.v === '\\dfrac') {
        const a = group(), b = group();
        const allNum = ts => ts.every(x => x.t === 'num');
        if (allNum(a) && allNum(b) && a.length === 1 && b.length === 1) return { coeff: a[0].v / b[0].v };
        const na = parseIndexTex(a.map(untok).join(' ')), nb = parseIndexTex(b.map(untok).join(' '));
        const idx = na.free.map(i => ({ ...i })).concat(nb.free.map(i => ({ sym: i.sym, up: !i.up })));
        return scripts({ name: 'frac', tex: '', kind: 'scalar', indices: idx, deriv: [], sym: [] });
      }
      if (t.v === '\\sqrt') { if (isSym('[')) { while (!isSym(']')) next(); next(); } group(); return scripts({ name: 'sqrt', tex: '\\sqrt{}', kind: 'scalar', indices: [], deriv: [], sym: [] }); }
      if (OPNAMES.has(t.v)) {
        let label = t.v;
        if (isSym('{')) { const ts = group(); label += ts.map(untok).join(''); if (['\\dot', '\\ddot', '\\tilde', '\\bar', '\\hat', '\\mathcal', '\\mathbf', '\\boldsymbol', '\\mathbb'].includes(t.v)) return scripts({ name: label, tex: label, kind: 'tensor', indices: [], deriv: [], sym: [] }); }
        return scripts({ name: label, tex: label, kind: 'scalar', indices: [], deriv: [], sym: [] });
      }
      if (t.v === '\\sum') { scripts({ indices: [], deriv: [], sym: [] }); return { coeff: 1 }; }
      if (t.v === '\\cdot' || t.v === '\\times' || t.v === '\\otimes') return { coeff: 1 };
      return scripts({ name: t.v.slice(1), tex: t.v, kind: KIND[t.v] || 'tensor', indices: [], deriv: [], sym: [] });
    }
    throw new Error(`parseIndexTex: unexpected '${t.v}' in ${src}`);
  };
  const term = stop => {
    let coeff = 1; const factors = [];
    while (peek() && !(peek().t === 'sym' && ['+', '-', '=', stop].includes(peek().v))) {
      const f = factor();
      if (f == null) break;
      if ('coeff' in f) coeff *= f.coeff; else factors.push(f);
    }
    return { coeff, factors };
  };
  const sum = stop => {
    const terms = [];
    let sign = 1;
    if (isSym('-')) { sign = -1; p++; } else if (isSym('+')) p++;
    for (;;) {
      const tm = term(stop); tm.coeff *= sign; terms.push(tm);
      if (isSym('+')) { p++; sign = 1; continue; }
      if (isSym('-')) { p++; sign = -1; continue; }
      break;
    }
    const info = termInfo(terms[0]);
    return { terms, free: info.free, dummies: info.dummies, tex: '' };
  };
  const sides = [sum(null)];
  while (isSym('=')) { p++; sides.push(sum(null)); }
  if (p < toks.length) throw new Error(`parseIndexTex: stray '${toks[p].v}' in ${src}`);
  const main = sides[0];
  main.tex = src;
  if (sides.length > 1) { main.sides = sides.map((s, k) => ({ ...s, tex: src.split('=')[k]?.trim() ?? '' })); }
  return main;
}
function untok(t) { return t.t === 'cmd' ? t.v + ' ' : String(t.v); }

// Free and dummy indices of one term (derivative indices count).
function termInfo(term) {
  const occ = new Map();
  for (const f of term.factors) for (const I of f.indices.concat(f.deriv || [])) {
    if (!occ.has(I.sym)) occ.set(I.sym, []);
    occ.get(I.sym).push(I.up);
  }
  const free = [], dummies = [], errors = [];
  for (const [sym, ups] of occ) {
    if (ups.length === 1) free.push({ sym, up: ups[0] });
    else if (ups.length === 2 && ups[0] !== ups[1]) dummies.push(sym);
    else if (ups.length === 2) errors.push(`index ${sym} is repeated with the same variance (${ups[0] ? 'up' : 'down'} twice)`);
    else errors.push(`index ${sym} appears ${ups.length} times`);
  }
  return { free, dummies, errors };
}

// validate(expr) -> { ok, errors, free, dummies }. Checks every term of
// every side: the Einstein rule, and the same free indices with the same
// variance in each term and on each side of '='.
export function validate(expr, opts = {}) {
  const sides = expr.sides ?? [expr];
  const errors = []; let ref = null;
  const key = fr => fr.map(i => i.sym + (i.up ? '^' : '_')).sort().join(' ');
  for (const s of sides) for (const tm of s.terms) {
    if (!tm.factors.length && tm.coeff === 0) continue; // '= 0' is a zero tensor of any shape
    const info = termInfo(tm);
    if (!opts.euclidean) errors.push(...info.errors);
    const k = key(info.free);
    if (ref == null) ref = k; else if (k !== ref) errors.push(`free indices differ: {${ref}} and {${k}}`);
  }
  const first = termInfo(sides[0].terms[0]);
  return { ok: errors.length === 0, errors, free: first.free, dummies: first.dummies };
}

// toTex: the stub gives the source TeX back. With colors, it wraps each
// index letter of a group in \class{iN}{..}, N from the colors map.
export function toTex(expr, opts = {}) {
  if (!opts.colors) return expr.tex;
  return expr.tex.replace(/([\^_])\{([^{}]*)\}/g, (m, s, body) => s + '{' + body.replace(/\\([A-Za-z]+)|([A-Za-z])/g, (mm, gk, l) => {
    const sym = gk || l; if (gk && !GREEK.has(gk)) return mm;
    const c = opts.colors[sym]; return c == null ? mm : `\\class{i${c}}{${mm}}`;
  }) + '}');
}

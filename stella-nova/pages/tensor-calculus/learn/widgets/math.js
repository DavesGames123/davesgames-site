// ============================================================================
//  TENSOR CALCULUS  ·  learn/widgets/math.js  ·  widget maths  (LEARN)
// ----------------------------------------------------------------------------
//  DOM-free. Each inline widget in a chapter reads its numbers from here, so
//  tests/learn.test.mjs can check them against closed forms and against
//  MATH (tensor/index.js) transform and christoffel.
//
//  CONVENTIONS
//    A basis change is a matrix A. Column j of A holds the new basis vector
//    e'_j in the old basis: e'_j = e_i A^i_j. Then an upper (contravariant)
//    index takes A^{-1}: v'^j = (A^{-1})^j_i v^i, and a lower (covariant)
//    index takes A: w'_j = w_i A^i_j. The coordinate Jacobian is
//    J = dx'/dx = A^{-1}.
//    Components = { shape: [n...], variance: ['u'|'d'...], data: Float64Array },
//    row major, the same shape as MATH Components.
//
//  EXPORTS   (grep -n "^export" math.js)
//      inv, matmul, matvec, det ......... small dense linear algebra
//      basisComponents(E, v, w) ......... v^i, w_i, dual basis, w(v)
//      stretchComponents(s, v, w) ....... x' = s x: v' = s v, w' = w / s
//      transformComponents(T, A) ........ any rank, by variance
//      lowerIndex(g, v), raiseIndex(gi, w), metricLength(g, v)
//      rotation2(theta), rotateRank2(T, theta)
//      classifyTerm(factors) ............ free and dummy indices, errors
//      checkEquation(sides) ............. free indices balance on each side
//      expandEinstein(factors, n, opts) . every term of an Einstein sum
//      countComponents(n, r, kind) ...... closed form counts
//      bruteCount(n, r, kind) ........... the same count by linear algebra
//      polarChristoffel(r) .............. closed form, polar coordinates
//      christoffelNumeric(gFn, x, h) .... finite differences, any metric
//      holonomyAngle(colat) ............. 2 pi (1 - cos theta)
//      transportLatitude(colat, steps) .. numeric parallel transport
// ============================================================================

// ------------------------------------------------------------ linear algebra
export function det(M) {
  const n = M.length;
  if (n === 1) return M[0][0];
  if (n === 2) return M[0][0] * M[1][1] - M[0][1] * M[1][0];
  let d = 0;
  for (let j = 0; j < n; j++) {
    const minor = M.slice(1).map(row => row.filter((_, k) => k !== j));
    d += (j % 2 ? -1 : 1) * M[0][j] * det(minor);
  }
  return d;
}

export function inv(M) {
  const n = M.length;
  const a = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-14) throw new Error('singular matrix');
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let k = 0; k < 2 * n; k++) a[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = a[r][c];
      if (f) for (let k = 0; k < 2 * n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map(row => row.slice(n));
}

export function matmul(A, B) {
  return A.map(row => B[0].map((_, j) => row.reduce((s, x, k) => s + x * B[k][j], 0)));
}
export function matvec(A, v) { return A.map(row => row.reduce((s, x, k) => s + x * v[k], 0)); }
const transpose = M => M[0].map((_, j) => M.map(r => r[j]));

// ------------------------------------------------------------ basis widget
// E: columns are the basis vectors e_1, e_2 (Cartesian). v: a vector
// (Cartesian). w: a covector, given by its Cartesian row (a gradient).
export function basisComponents(E, v, w) {
  const Ei = inv(E);
  const up = matvec(Ei, v);                        // v = v^i e_i
  const down = E[0].map((_, j) => w.reduce((s, wk, k) => s + wk * E[k][j], 0)); // w_i = w(e_i)
  const dual = Ei;                                 // row i of E^-1 is the dual basis covector e^i
  const pairing = up.reduce((s, x, i) => s + x * down[i], 0);
  return { up, down, dual, pairing, cartesianPairing: v.reduce((s, x, i) => s + x * w[i], 0) };
}

// The coordinate x' = s x (every axis). The coordinate basis vector
// d/dx' = (1/s) d/dx, so vector components grow and covector components
// shrink.
export function stretchComponents(s, v, w) {
  return { up: v.map(x => x * s), down: w.map(x => x / s), pairing: v.reduce((a, x, i) => a + x * w[i], 0) };
}

// ------------------------------------------------------------ any rank
export function transformComponents(T, A) {
  const n = A.length, r = T.shape.length;
  const Ai = inv(A);
  let data = Float64Array.from(T.data);
  const strides = T.shape.map((_, k) => T.shape.slice(k + 1).reduce((p, x) => p * x, 1));
  for (let slot = 0; slot < r; slot++) {
    // up: new[.., j, ..] = sum_i Ai[j][i] old[.., i, ..]
    // down: new[.., j, ..] = sum_i A[i][j] old[.., i, ..]
    const up = T.variance[slot] === 'u';
    const out = new Float64Array(data.length);
    const st = strides[slot];
    for (let flat = 0; flat < data.length; flat++) {
      const j = Math.floor(flat / st) % n;
      const base = flat - j * st;
      let s = 0;
      for (let i = 0; i < n; i++) s += (up ? Ai[j][i] : A[i][j]) * data[base + i * st];
      out[flat] = s;
    }
    data = out;
  }
  return { shape: T.shape.slice(), variance: T.variance.slice(), data };
}

// ------------------------------------------------------------ metric
export function lowerIndex(g, v) { return matvec(g, v); }
export function raiseIndex(gi, w) { return matvec(gi, w); }
export function metricLength(g, v) { return Math.sqrt(Math.max(0, v.reduce((s, x, i) => s + x * matvec(g, v)[i], 0))); }

export function rotation2(t) { const c = Math.cos(t), s = Math.sin(t); return [[c, -s], [s, c]]; }
// T as a 2x2 array of a (2,0) or (0,2) tensor in an orthonormal frame: a
// rotation of the frame gives T' = R^T T R, and both variances agree.
export function rotateRank2(T, t) { const R = rotation2(t); return matmul(transpose(R), matmul(T, R)); }

// ------------------------------------------------------------ Einstein rule
// factors: [{ name, idx: [{ sym, up }] }]. One term (a product).
export function classifyTerm(factors) {
  const seen = new Map();
  for (const f of factors) for (const ix of f.idx) {
    if (!seen.has(ix.sym)) seen.set(ix.sym, []);
    seen.get(ix.sym).push(ix.up);
  }
  const free = [], dummy = [], errors = [];
  for (const [sym, ups] of seen) {
    if (ups.length === 1) free.push({ sym, up: ups[0] });
    else if (ups.length === 2 && ups[0] !== ups[1]) dummy.push(sym);
    else if (ups.length === 2) errors.push({ sym, why: ups[0] ? 'twice up' : 'twice down' });
    else errors.push({ sym, why: `${ups.length} times` });
  }
  return { free, dummy, errors };
}

// sides: [[factors], [factors], ...]: terms of a sum, or the two sides of
// an equation. Each term must have the same free indices, at the same
// height.
export function checkEquation(sides) {
  const per = sides.map(classifyTerm);
  const key = c => c.free.map(f => f.sym + (f.up ? '^' : '_')).sort().join(' ');
  const k0 = key(per[0]);
  const errors = per.flatMap(c => c.errors);
  const balanced = per.every(c => key(c) === k0);
  return { ok: balanced && !errors.length, balanced, free: per[0].free, terms: per, errors };
}

function fmtNum(x) { return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0$/, ''); }

// Every term of the sum, for one value of each free index.
// opts: { classOf(sym), base (0 or 1), assign: { sym: value } }.
// Returns { free, dummy, count, lines: [{ assign, tex, terms }] }.
export function expandEinstein(factors, n, opts = {}) {
  const { classOf = () => null, base = 1, assign: fixed = null, values = null } = opts;
  const c = classifyTerm(factors);
  if (c.errors.length) return { ...c, count: 0, lines: [] };
  const free = c.free.map(f => f.sym), dummy = c.dummy;
  const tuples = k => {
    const out = [[]];
    for (let d = 0; d < k; d++) { const next = []; for (const t of out) for (let v = 0; v < n; v++) next.push([...t, v]); out.splice(0, out.length, ...next); }
    return out;
  };
  const freeTuples = fixed ? [free.map(s => fixed[s] - base)] : tuples(free.length);
  const lines = [];
  const num = (sym, v) => { const cl = classOf(sym); const t = String(v + base); return cl ? `{\\class{${cl}}{${t}}}` : t; };
  const comp = (f, a) => {
    let up = '', down = '', tex = f.tex || f.name, parts = '';
    // keep slot order: runs of upper and lower indices
    let runUp = null, run = '';
    const flush = () => { if (run) parts += (runUp ? '^{' : '_{') + run + '}'; run = ''; };
    f.idx.forEach((ix, k) => {
      if (runUp !== null && ix.up !== runUp) { flush(); if (k) parts += '{}'; }
      runUp = ix.up; run += num(ix.sym, a[ix.sym]);
    });
    flush();
    return tex + parts;
  };
  for (const ft of freeTuples) {
    const a0 = Object.fromEntries(free.map((s, k) => [s, ft[k]]));
    const terms = [];
    let sum = 0, numeric = !!values;
    for (const dt of tuples(dummy.length)) {
      const a = { ...a0, ...Object.fromEntries(dummy.map((s, k) => [s, dt[k]])) };
      terms.push(factors.map(f => comp(f, a)).join('\\,'));
      if (numeric) {
        let p = 1;
        for (const f of factors) {
          const get = values[f.name];
          if (!get) { numeric = false; break; }
          p *= get(...f.idx.map(ix => a[ix.sym]));
        }
        sum += p;
      }
    }
    lines.push({ assign: Object.fromEntries(free.map((s, k) => [s, ft[k] + base])), terms, tex: terms.join(' + '), value: numeric ? sum : null });
  }
  return { free, dummy, count: lines.length * (lines[0] ? lines[0].terms.length : 0), termsPerLine: n ** dummy.length, lines, fmt: fmtNum };
}

// ------------------------------------------------------------ counting
function binom(n, k) { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); }

export const COUNT_KINDS = ['general', 'symmetric', 'antisymmetric', 'riemann'];

export function countComponents(n, r, kind) {
  switch (kind) {
    case 'general': return n ** r;
    case 'symmetric': return binom(n + r - 1, r);
    case 'antisymmetric': return binom(n, r);
    case 'riemann': return (n * n * (n * n - 1)) / 12;
    default: throw new Error('unknown kind ' + kind);
  }
}

// Rank of a list of sparse rows (Map col -> value), by elimination.
function rankOf(rows, ncols) {
  const M = rows.map(r => { const a = new Float64Array(ncols); for (const [c, v] of r) a[c] += v; return a; });
  let rank = 0;
  for (let c = 0; c < ncols && rank < M.length; c++) {
    let p = -1;
    for (let r = rank; r < M.length; r++) if (Math.abs(M[r][c]) > 1e-9) { p = r; break; }
    if (p < 0) continue;
    [M[rank], M[p]] = [M[p], M[rank]];
    for (let r = 0; r < M.length; r++) if (r !== rank && Math.abs(M[r][c]) > 1e-12) {
      const f = M[r][c] / M[rank][c];
      for (let k = c; k < ncols; k++) M[r][k] -= f * M[rank][k];
    }
    rank++;
  }
  return rank;
}

// Independent components = n^r minus the rank of the linear constraints.
// riemann: r is 4; R_abcd = -R_bacd, R_abcd = -R_abdc, R_abcd = R_cdab,
// R_abcd + R_acdb + R_adbc = 0.
export function bruteCount(n, r, kind) {
  if (kind === 'riemann') r = 4;
  const N = n ** r;
  const idx = t => t.reduce((s, x) => s * n + x, 0);
  const rows = [];
  for (let f = 0; f < N; f++) {
    const t = []; let q = f; for (let k = 0; k < r; k++) { t.unshift(q % n); q = Math.floor(q / n); }
    const add = (pairs) => { const m = new Map(); for (const [tt, v] of pairs) { const c = idx(tt); m.set(c, (m.get(c) || 0) + v); } if ([...m.values()].some(v => Math.abs(v) > 1e-12)) rows.push(m); };
    if (kind === 'symmetric' || kind === 'antisymmetric') {
      const sg = kind === 'symmetric' ? -1 : 1;
      for (let k = 0; k + 1 < r; k++) { const s = t.slice(); [s[k], s[k + 1]] = [s[k + 1], s[k]]; add([[t, 1], [s, sg]]); }
    } else if (kind === 'riemann') {
      const [a, b, c, d] = t;
      add([[[a, b, c, d], 1], [[b, a, c, d], 1]]);
      add([[[a, b, c, d], 1], [[a, b, d, c], 1]]);
      add([[[a, b, c, d], 1], [[c, d, a, b], -1]]);
      add([[[a, b, c, d], 1], [[a, c, d, b], 1], [[a, d, b, c], 1]]);
    }
  }
  return N - rankOf(rows, N);
}

// ------------------------------------------------------------ connection
// Polar coordinates (r, theta), g = diag(1, r^2).
export function polarChristoffel(r) {
  // G[l][m][n] = Gamma^l_{mn}
  return [[[0, 0], [0, -r]], [[0, 1 / r], [1 / r, 0]]];
}

// gFn(x) -> metric matrix at the point x (array). Central differences.
export function christoffelNumeric(gFn, x, h = 1e-5) {
  const n = x.length, g = gFn(x), gi = inv(g);
  const dg = [];                                   // dg[k][i][j] = d_k g_ij
  for (let k = 0; k < n; k++) {
    const xp = x.slice(), xm = x.slice(); xp[k] += h; xm[k] -= h;
    const a = gFn(xp), b = gFn(xm);
    dg.push(a.map((row, i) => row.map((v, j) => (v - b[i][j]) / (2 * h))));
  }
  const G = [];
  for (let l = 0; l < n; l++) {
    G.push([]);
    for (let m = 0; m < n; m++) {
      G[l].push([]);
      for (let q = 0; q < n; q++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += 0.5 * gi[l][k] * (dg[m][k][q] + dg[q][k][m] - dg[k][m][q]);
        G[l][m].push(s);
      }
    }
  }
  return G;
}

// ------------------------------------------------------------ holonomy
// Carry a vector once round the circle of colatitude theta on the unit
// sphere. It comes back turned by 2 pi (1 - cos theta), the enclosed area.
export function holonomyAngle(colat) { return 2 * Math.PI * (1 - Math.cos(colat)); }

// Numeric parallel transport along theta = const, phi from 0 to 2 pi, with
// RK4 on dV^a/dphi = -Gamma^a_{phi b} V^b. Returns the turn angle of the
// vector in the orthonormal frame (e_theta, e_phi / sin theta), in [0, 2 pi).
export function transportLatitude(colat, steps = 2000) {
  const s = Math.sin(colat), c = Math.cos(colat);
  // Gamma^theta_{phi phi} = -s c, Gamma^phi_{theta phi} = c / s
  const f = V => [s * c * V[1], -(c / s) * V[0]];
  let V = [1, 0];
  const h = 2 * Math.PI / steps;
  for (let k = 0; k < steps; k++) {
    const k1 = f(V), k2 = f([V[0] + h / 2 * k1[0], V[1] + h / 2 * k1[1]]);
    const k3 = f([V[0] + h / 2 * k2[0], V[1] + h / 2 * k2[1]]), k4 = f([V[0] + h * k3[0], V[1] + h * k3[1]]);
    V = [V[0] + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), V[1] + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])];
  }
  // Orthonormal components (V^theta, s V^phi) turn at the rate -cos theta,
  // so the total turn is -2 pi cos theta, the same angle as
  // 2 pi (1 - cos theta) modulo 2 pi.
  const ang = Math.atan2(s * V[1], V[0]);
  return ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

// ------------------------------------------------------------ mini parser
// A small index grammar for the widgets (MATH parseIndexTex is the full
// one): factors with scripts, terms joined by ' + ', sides by ' = '.
//   'A^i_j v^j'   'T^{\mu}{}_{\nu} w_\mu'   'g_{ij} v^i u^j = s'
// parseFactors(src) -> [{ name, tex, idx: [{ sym, up }] }]
// parseSides(src)   -> [[factors], ...]  one list per term on every side
export function parseFactors(src) {
  const out = [];
  let i = 0;
  const s = String(src).trim();
  const readSyms = (txt, up, idx) => {
    const re = /\\([A-Za-z]+)|([A-Za-z])/g;
    let m;
    while ((m = re.exec(txt))) idx.push({ sym: m[1] || m[2], up });
  };
  while (i < s.length) {
    while (s[i] === ' ' || s[i] === '\\' && s[i + 1] === ',') i += s[i] === ' ' ? 1 : 2;
    if (i >= s.length) break;
    let name = '';
    if (s[i] === '\\') { const m = /^\\[A-Za-z]+/.exec(s.slice(i)); name = m[0]; i += name.length; }
    else { name = s[i]; i++; }
    const f = { name: name.replace(/^\\/, ''), tex: name, idx: [] };
    for (;;) {
      if (s.startsWith('{}', i)) { i += 2; continue; }
      const c = s[i];
      if (c !== '^' && c !== '_') break;
      i++;
      let grp;
      if (s[i] === '{') { let d = 0, j = i; for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break; } grp = s.slice(i + 1, j); i = j + 1; }
      else if (s[i] === '\\') { const m = /^\\[A-Za-z]+/.exec(s.slice(i)); grp = m[0]; i += grp.length; }
      else { grp = s[i]; i++; }
      readSyms(grp, c === '^', f.idx);
    }
    out.push(f);
  }
  return out;
}

export function parseSides(src) {
  // A bare number (0, 2) is a scalar term with no index: '= 0' is legal.
  return String(src).split(/\s=\s|\s\+\s|\s-\s/).map(t => t.trim()).filter(t => t && !/^[-+]?\d+(\.\d+)?$/.test(t)).map(parseFactors);
}

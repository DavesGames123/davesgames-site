// ============================================================================
//  ALPHA QUDITS  ·  model/complex.js  ·  small dense complex matrices (MODEL)
// ----------------------------------------------------------------------------
//  A matrix is { n, re: Float64Array[], im: Float64Array[] }: n rows of
//  n entries each. A vector is { re: Float64Array, im: Float64Array }.
//  Everything here is DOM-free and allocation-light. The exact parts of
//  the model (records, counts, ranks) do not use floats; this file serves
//  the matrix checks (commutators, MUBs, transpose identity).
//
//  grep -n targets:  export function zeros | fromRows | mul | add | scale
//  | sub | commutator | anticommutator | trace | dagger | transpose | conj
//  | kron | apply | inner | hsInner | maxAbsDiff | isZero | expand
// ============================================================================

export function zeros(n) {
  const re = [], im = [];
  for (let i = 0; i < n; i++) { re.push(new Float64Array(n)); im.push(new Float64Array(n)); }
  return { n, re, im };
}

// rows: array of rows; each entry a number or [re, im].
export function fromRows(rows) {
  const n = rows.length, m = zeros(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = rows[i][j];
    if (Array.isArray(v)) { m.re[i][j] = v[0]; m.im[i][j] = v[1]; } else m.re[i][j] = v;
  }
  return m;
}

export function identity(n) { const m = zeros(n); for (let i = 0; i < n; i++) m.re[i][i] = 1; return m; }

export function mul(a, b) {
  const n = a.n, c = zeros(n);
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
    const ar = a.re[i][k], ai = a.im[i][k];
    if (ar === 0 && ai === 0) continue;
    for (let j = 0; j < n; j++) {
      const br = b.re[k][j], bi = b.im[k][j];
      c.re[i][j] += ar * br - ai * bi;
      c.im[i][j] += ar * bi + ai * br;
    }
  }
  return c;
}

export function add(a, b) {
  const n = a.n, c = zeros(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    c.re[i][j] = a.re[i][j] + b.re[i][j]; c.im[i][j] = a.im[i][j] + b.im[i][j];
  }
  return c;
}

// Multiply by the complex scalar (sr + i si).
export function scale(a, sr, si = 0) {
  const n = a.n, c = zeros(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const r = a.re[i][j], m = a.im[i][j];
    c.re[i][j] = r * sr - m * si; c.im[i][j] = r * si + m * sr;
  }
  return c;
}

export function sub(a, b) { return add(a, scale(b, -1)); }
export function commutator(a, b) { return sub(mul(a, b), mul(b, a)); }
export function anticommutator(a, b) { return add(mul(a, b), mul(b, a)); }

export function trace(a) {
  let r = 0, i = 0;
  for (let k = 0; k < a.n; k++) { r += a.re[k][k]; i += a.im[k][k]; }
  return { re: r, im: i };
}

export function dagger(a) {
  const n = a.n, c = zeros(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { c.re[i][j] = a.re[j][i]; c.im[i][j] = -a.im[j][i]; }
  return c;
}
export function transpose(a) {
  const n = a.n, c = zeros(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { c.re[i][j] = a.re[j][i]; c.im[i][j] = a.im[j][i]; }
  return c;
}
export function conj(a) {
  const n = a.n, c = zeros(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { c.re[i][j] = a.re[i][j]; c.im[i][j] = -a.im[i][j]; }
  return c;
}

// Kronecker product a (x) b; index (i, k) -> i * b.n + k.
export function kron(a, b) {
  const n = a.n * b.n, c = zeros(n);
  for (let i = 0; i < a.n; i++) for (let j = 0; j < a.n; j++) {
    const ar = a.re[i][j], ai = a.im[i][j];
    if (ar === 0 && ai === 0) continue;
    for (let k = 0; k < b.n; k++) for (let l = 0; l < b.n; l++) {
      const br = b.re[k][l], bi = b.im[k][l];
      c.re[i * b.n + k][j * b.n + l] = ar * br - ai * bi;
      c.im[i * b.n + k][j * b.n + l] = ar * bi + ai * br;
    }
  }
  return c;
}

export function vec(n) { return { re: new Float64Array(n), im: new Float64Array(n) }; }

export function apply(a, v) {
  const n = a.n, w = vec(n);
  for (let i = 0; i < n; i++) {
    let r = 0, m = 0;
    for (let j = 0; j < n; j++) {
      r += a.re[i][j] * v.re[j] - a.im[i][j] * v.im[j];
      m += a.re[i][j] * v.im[j] + a.im[i][j] * v.re[j];
    }
    w.re[i] = r; w.im[i] = m;
  }
  return w;
}

// <u|v> (conjugate-linear in u).
export function inner(u, v) {
  let r = 0, m = 0;
  for (let i = 0; i < u.re.length; i++) {
    r += u.re[i] * v.re[i] + u.im[i] * v.im[i];
    m += u.re[i] * v.im[i] - u.im[i] * v.re[i];
  }
  return { re: r, im: m };
}

// Hilbert-Schmidt pairing tr(a^dagger b).
export function hsInner(a, b) { return trace(mul(dagger(a), b)); }

export function maxAbsDiff(a, b) {
  let d = 0;
  for (let i = 0; i < a.n; i++) for (let j = 0; j < a.n; j++)
    d = Math.max(d, Math.abs(a.re[i][j] - b.re[i][j]), Math.abs(a.im[i][j] - b.im[i][j]));
  return d;
}
export function isZero(a, eps = 1e-12) { return maxAbsDiff(a, zeros(a.n)) < eps; }

// Coefficients of m on an orthogonal basis under tr(b^dagger m) / tr(b^dagger b).
export function expand(m, basis) {
  return basis.map(b => {
    const num = hsInner(b, m), den = hsInner(b, b).re;
    return { re: num.re / den, im: num.im / den };
  });
}

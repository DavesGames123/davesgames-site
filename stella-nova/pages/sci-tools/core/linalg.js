// ============================================================================
//  SCIENCE TOOLKIT  ·  core/linalg.js  ·  dense linear algebra
// ----------------------------------------------------------------------------
//  Small dense matrices as arrays of rows. Methods:
//    lu()        LU with partial pivoting: det, solve, inverse
//    lstsq()     Householder QR least squares, with (RᵀR)⁻¹ for the
//                covariance of fitted parameters
//    rank()      Gaussian elimination with full pivoting and a tolerance
//    eigSym()    cyclic Jacobi rotations: eigenvalues and eigenvectors of a
//                symmetric matrix
//    eig()       balance, reduce to Hessenberg form, shifted QR (Francis
//                double shift): eigenvalues of a general real matrix, real
//                or complex pairs (Numerical Recipes, 3rd ed., §11.6-11.7;
//                the EISPACK routines balanc, elmhes and hqr)
//
//  GREP MAP
//    grep -n "export function lu"
//    grep -n "export function det"     solve, inv
//    grep -n "export function lstsq"
//    grep -n "export function rank"
//    grep -n "export function eigSym"
//    grep -n "export function eig("
//    grep -n "export function parseMatrix"
// ============================================================================

export const zeros = (r, c) => Array.from({ length: r }, () => new Array(c).fill(0));
export const eye = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));
export const T = (A) => A[0].map((_, j) => A.map(r => r[j]));
export function mul(A, B) {
  if (A[0].length !== B.length) throw new Error(`Cannot multiply ${A.length}×${A[0].length} by ${B.length}×${B[0].length}.`);
  return A.map(r => B[0].map((_, j) => r.reduce((s, a, k) => s + a * B[k][j], 0)));
}
const square = (A) => { if (!A.length || A.some(r => r.length !== A.length)) throw new Error(`The matrix must be square (it is ${A.length}×${A[0] ? A[0].length : 0}).`); };

// Text to a matrix: rows on lines, cells split by spaces, commas or tabs.
// Also accepts [[1,2],[3,4]] and "1 2; 3 4".
export function parseMatrix(text) {
  let t = String(text).trim();
  if (!t) throw new Error('The matrix is empty.');
  if (t.startsWith('[')) t = t.replace(/\]\s*,\s*\[/g, '\n').replace(/[[\]]/g, '');
  const rows = t.split(/\r?\n|;/).map(l => l.trim()).filter(Boolean).map(l => l.split(/[\s,]+/).filter(Boolean).map(c => {
    const v = Number(c.replace('−', '-'));
    if (!Number.isFinite(v)) throw new Error(`"${c}" is not a number.`);
    return v;
  }));
  const c = rows[0].length;
  if (rows.some(r => r.length !== c)) throw new Error('Every row needs the same number of entries.');
  return rows;
}

export function lu(A) {
  square(A);
  const n = A.length, M = A.map(r => r.slice()), p = [...Array(n).keys()];
  let sign = 1, singular = false;
  for (let k = 0; k < n; k++) {
    let m = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[m][k])) m = i;
    if (M[m][k] === 0) { singular = true; continue; }
    if (m !== k) { [M[m], M[k]] = [M[k], M[m]]; [p[m], p[k]] = [p[k], p[m]]; sign = -sign; }
    for (let i = k + 1; i < n; i++) {
      const f = (M[i][k] /= M[k][k]);
      for (let j = k + 1; j < n; j++) M[i][j] -= f * M[k][j];
    }
  }
  return { M, p, sign, singular };
}

export function det(A) {
  const { M, sign } = lu(A);
  return M.reduce((d, r, i) => d * r[i], sign);
}

// Solve A X = B (B a matrix or a vector).
export function solve(A, B) {
  const { M, p, singular } = lu(A);
  const n = A.length, scale = Math.max(...A.flat().map(Math.abs));
  if (singular || M.some((r, i) => Math.abs(r[i]) <= 1e-14 * scale * n)) throw new Error('The matrix is singular (or nearly so): there is no unique solution.');
  const vec = !Array.isArray(B[0]);
  const Bm = vec ? B.map(x => [x]) : B;
  if (Bm.length !== n) throw new Error(`The right side needs ${n} rows.`);
  const X = Bm[0].map((_, c) => {
    const y = p.map(i => Bm[i][c]);
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) y[i] -= M[i][j] * y[j];
    for (let i = n - 1; i >= 0; i--) { for (let j = i + 1; j < n; j++) y[i] -= M[i][j] * y[j]; y[i] /= M[i][i]; }
    return y;
  });
  return vec ? X[0] : T(X);
}

export const inv = (A) => solve(A, eye(A.length));

// Least squares min |A x − b|. Returns x, residual sum of squares and
// (AᵀA)⁻¹ = R⁻¹ R⁻ᵀ.
export function lstsq(A, b) {
  const m = A.length, n = A[0].length;
  if (m < n) throw new Error(`Least squares needs at least ${n} rows.`);
  const R = A.map(r => r.slice()), y = b.slice();
  for (let k = 0; k < n; k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm += R[i][k] ** 2;
    norm = Math.sqrt(norm);
    if (norm === 0) throw new Error('The design matrix is rank deficient (a column is 0 or repeated).');
    const alpha = R[k][k] > 0 ? -norm : norm;
    const v = new Array(m).fill(0);
    v[k] = R[k][k] - alpha;
    for (let i = k + 1; i < m; i++) v[i] = R[i][k];
    const vv = v.reduce((s, x) => s + x * x, 0);
    if (vv === 0) continue;
    for (let j = k; j < n; j++) {
      let s = 0;
      for (let i = k; i < m; i++) s += v[i] * R[i][j];
      s = 2 * s / vv;
      for (let i = k; i < m; i++) R[i][j] -= s * v[i];
    }
    let s = 0;
    for (let i = k; i < m; i++) s += v[i] * y[i];
    s = 2 * s / vv;
    for (let i = k; i < m; i++) y[i] -= s * v[i];
  }
  const scale = Math.max(...R.slice(0, n).map((r, i) => Math.abs(r[i])));
  for (let i = 0; i < n; i++) if (Math.abs(R[i][i]) <= 1e-13 * scale) throw new Error('The design matrix is rank deficient: the parameters are not determined.');
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let j = i + 1; j < n; j++) s -= R[i][j] * x[j]; x[i] = s / R[i][i]; }
  let rss = 0;
  for (let i = n; i < m; i++) rss += y[i] * y[i];
  // R⁻¹ (upper triangular), then (AᵀA)⁻¹ = R⁻¹ R⁻ᵀ.
  const Ri = zeros(n, n);
  for (let i = n - 1; i >= 0; i--) {
    Ri[i][i] = 1 / R[i][i];
    for (let j = i + 1; j < n; j++) { let s = 0; for (let k = i + 1; k <= j; k++) s += R[i][k] * Ri[k][j]; Ri[i][j] = -s / R[i][i]; }
  }
  const cov = zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { let s = 0; for (let k = Math.max(i, j); k < n; k++) s += Ri[i][k] * Ri[j][k]; cov[i][j] = s; }
  return { x, rss, cov };
}

export function rank(A, tol) {
  const M = A.map(r => r.slice()), m = M.length, n = M[0].length;
  const t = tol ?? Math.max(m, n) * Number.EPSILON * Math.max(1, ...A.flat().map(Math.abs)) * 10;
  let r = 0;
  const cols = [...Array(n).keys()];
  for (let k = 0; k < Math.min(m, n); k++) {
    let bi = k, bj = k, best = 0;
    for (let i = k; i < m; i++) for (let j = k; j < n; j++) if (Math.abs(M[i][j]) > best) { best = Math.abs(M[i][j]); bi = i; bj = j; }
    if (best <= t) break;
    [M[bi], M[k]] = [M[k], M[bi]];
    for (const row of M) [row[bj], row[k]] = [row[k], row[bj]];
    [cols[bj], cols[k]] = [cols[k], cols[bj]];
    for (let i = k + 1; i < m; i++) { const f = M[i][k] / M[k][k]; for (let j = k; j < n; j++) M[i][j] -= f * M[k][j]; }
    r++;
  }
  return r;
}

export const isSym = (A, tol = 1e-12) => A.every((r, i) => r.every((x, j) => Math.abs(x - A[j][i]) <= tol * Math.max(1, Math.abs(x))));

// Cyclic Jacobi. Returns values (ascending) and unit vectors (columns).
export function eigSym(A) {
  square(A);
  const n = A.length, a = A.map(r => r.slice()), V = eye(n);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-30 * Math.max(1e-300, a.reduce((s, r, i) => s + r[i] ** 2, 0)) || off === 0) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (a[p][q] === 0) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [...Array(n).keys()].sort((i, j) => a[i][i] - a[j][j]);
  return { values: order.map(i => a[i][i]), vectors: order.map(i => V.map(r => r[i])) };
}

// General real matrix: eigenvalues as [re, im] pairs, sorted by real part.
export function eig(A) {
  square(A);
  const n = A.length, a = A.map(r => r.slice());
  // balance
  const RADIX = 2;
  let done = false;
  while (!done) {
    done = true;
    for (let i = 0; i < n; i++) {
      let r = 0, c = 0;
      for (let j = 0; j < n; j++) if (j !== i) { c += Math.abs(a[j][i]); r += Math.abs(a[i][j]); }
      if (c !== 0 && r !== 0) {
        let g = r / RADIX, f = 1;
        const s = c + r;
        while (c < g) { f *= RADIX; c *= RADIX * RADIX; }
        g = r * RADIX;
        while (c > g) { f /= RADIX; c /= RADIX * RADIX; }
        if ((c + r) / f < 0.95 * s) {
          done = false;
          g = 1 / f;
          for (let j = 0; j < n; j++) a[i][j] *= g;
          for (let j = 0; j < n; j++) a[j][i] *= f;
        }
      }
    }
  }
  // elmhes
  for (let m = 1; m < n - 1; m++) {
    let x = 0, i = m;
    for (let j = m; j < n; j++) if (Math.abs(a[j][m - 1]) > Math.abs(x)) { x = a[j][m - 1]; i = j; }
    if (i !== m) {
      for (let j = m - 1; j < n; j++) [a[i][j], a[m][j]] = [a[m][j], a[i][j]];
      for (let j = 0; j < n; j++) [a[j][i], a[j][m]] = [a[j][m], a[j][i]];
    }
    if (x !== 0) {
      for (i = m + 1; i < n; i++) {
        let y = a[i][m - 1];
        if (y !== 0) {
          y /= x; a[i][m - 1] = y;
          for (let j = m; j < n; j++) a[i][j] -= y * a[m][j];
          for (let j = 0; j < n; j++) a[j][m] += y * a[j][i];
        }
      }
    }
  }
  for (let i = 2; i < n; i++) for (let j = 0; j < i - 1; j++) a[i][j] = 0;
  // hqr
  const wr = new Array(n).fill(0), wi = new Array(n).fill(0);
  let anorm = 0;
  for (let i = 0; i < n; i++) for (let j = Math.max(i - 1, 0); j < n; j++) anorm += Math.abs(a[i][j]);
  let nn = n - 1, t = 0;
  let p = 0, q = 0, r = 0, s, w, x, y, z = 0;
  while (nn >= 0) {
    let its = 0, l;
    do {
      for (l = nn; l > 0; l--) {
        s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]);
        if (s === 0) s = anorm;
        if (Math.abs(a[l][l - 1]) + s === s) { a[l][l - 1] = 0; break; }
      }
      x = a[nn][nn];
      if (l === nn) { wr[nn] = x + t; wi[nn--] = 0; }
      else {
        y = a[nn - 1][nn - 1]; w = a[nn][nn - 1] * a[nn - 1][nn];
        if (l === nn - 1) {
          p = 0.5 * (y - x); q = p * p + w; z = Math.sqrt(Math.abs(q)); x += t;
          if (q >= 0) {
            z = p + (p >= 0 ? Math.abs(z) : -Math.abs(z));
            wr[nn - 1] = wr[nn] = x + z;
            if (z) wr[nn] = x - w / z;
            wi[nn - 1] = wi[nn] = 0;
          } else {
            wr[nn - 1] = wr[nn] = x + p;
            wi[nn - 1] = -(wi[nn] = z);
          }
          nn -= 2;
        } else {
          if (its === 60) throw new Error('The QR iteration did not converge.');
          if (its === 10 || its === 20) {
            t += x;
            for (let i = 0; i <= nn; i++) a[i][i] -= x;
            s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]);
            y = x = 0.75 * s; w = -0.4375 * s * s;
          }
          ++its;
          let m;
          for (m = nn - 2; m >= l; m--) {
            z = a[m][m]; r = x - z; s = y - z;
            p = (r * s - w) / a[m + 1][m] + a[m][m + 1]; q = a[m + 1][m + 1] - z - r - s; r = a[m + 2][m + 1];
            s = Math.abs(p) + Math.abs(q) + Math.abs(r);
            p /= s; q /= s; r /= s;
            if (m === l) break;
            const u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r));
            const v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
            if (u + v === v) break;
          }
          for (let i = m; i < nn - 1; i++) { a[i + 2][i] = 0; if (i !== m) a[i + 2][i - 1] = 0; }
          for (let k = m; k < nn; k++) {
            if (k !== m) {
              p = a[k][k - 1]; q = a[k + 1][k - 1]; r = 0;
              if (k + 1 !== nn) r = a[k + 2][k - 1];
              if ((x = Math.abs(p) + Math.abs(q) + Math.abs(r)) !== 0) { p /= x; q /= x; r /= x; }
            }
            const sg = Math.sqrt(p * p + q * q + r * r);
            if ((s = p >= 0 ? sg : -sg) !== 0) {
              if (k === m) { if (l !== m) a[k][k - 1] = -a[k][k - 1]; }
              else a[k][k - 1] = -s * x;
              p += s; x = p / s; y = q / s; z = r / s; q /= p; r /= p;
              for (let j = k; j <= nn; j++) {
                p = a[k][j] + q * a[k + 1][j];
                if (k + 1 !== nn) { p += r * a[k + 2][j]; a[k + 2][j] -= p * z; }
                a[k + 1][j] -= p * y; a[k][j] -= p * x;
              }
              const mmin = nn < k + 3 ? nn : k + 3;
              for (let i = l; i <= mmin; i++) {
                p = x * a[i][k] + y * a[i][k + 1];
                if (k + 1 !== nn) { p += z * a[i][k + 2]; a[i][k + 2] -= p * r; }
                a[i][k + 1] -= p * q; a[i][k] -= p;
              }
            }
          }
        }
      }
    } while (l < nn - 1);
  }
  return wr.map((re, i) => [re, wi[i]]).sort((u, v) => u[0] - v[0] || u[1] - v[1]);
}

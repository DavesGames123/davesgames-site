// ============================================================================
//  ALPHA QUDITS  ·  model/linalg.js  ·  exact rational linear algebra (MODEL)
// ----------------------------------------------------------------------------
//  Matrices of BigInt rationals for the exact ranks and null spaces of
//  Theorem S3. A rational is [num, den] with den > 0n, both BigInt.
//
//  grep -n targets:  export function rref | rank | nullSpace | toInts
// ============================================================================
const g = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { [a, b] = [b, a % b]; } return a; };
const norm = ([n, d]) => { if (d < 0n) { n = -n; d = -d; } const k = g(n, d) || 1n; return [n / k, d / k]; };
const R = x => [BigInt(x), 1n];
const sub = (a, b) => norm([a[0] * b[1] - b[0] * a[1], a[1] * b[1]]);
const mulq = (a, b) => norm([a[0] * b[0], a[1] * b[1]]);
const divq = (a, b) => norm([a[0] * b[1], a[1] * b[0]]);
const isZ = a => a[0] === 0n;

// Reduced row echelon form of integer (or rational) rows.
export function rref(rows) {
  const m = rows.map(r => r.map(x => Array.isArray(x) ? x : R(x)));
  const nr = m.length, nc = nr ? m[0].length : 0, pivots = [];
  let row = 0;
  for (let c = 0; c < nc && row < nr; c++) {
    let p = row; while (p < nr && isZ(m[p][c])) p++;
    if (p === nr) continue;
    [m[row], m[p]] = [m[p], m[row]];
    const pv = m[row][c];
    m[row] = m[row].map(x => divq(x, pv));
    for (let i = 0; i < nr; i++) if (i !== row && !isZ(m[i][c])) {
      const f = m[i][c];
      m[i] = m[i].map((x, j) => sub(x, mulq(f, m[row][j])));
    }
    pivots.push(c); row++;
  }
  return { m, pivots };
}
export function rank(rows) { return rref(rows).pivots.length; }

// Basis of { x : A x = 0 } as integer vectors (BigInt scaled to integers).
export function nullSpace(rows, ncols) {
  const nc = ncols ?? rows[0].length;
  const { m, pivots } = rref(rows);
  const free = [];
  for (let c = 0; c < nc; c++) if (!pivots.includes(c)) free.push(c);
  return free.map(fc => {
    const v = Array.from({ length: nc }, () => [0n, 1n]);
    v[fc] = [1n, 1n];
    pivots.forEach((pc, i) => { v[pc] = norm([-m[i][fc][0], m[i][fc][1]]); });
    return toInts(v);
  });
}

// Scale a rational vector to coprime integers (Numbers).
export function toInts(v) {
  let l = 1n; for (const [, d] of v) l = l / g(l, d) * d;
  let ints = v.map(([n, d]) => n * (l / d));
  const k = ints.reduce((a, b) => g(a, b), 0n) || 1n;
  ints = ints.map(x => x / k);
  return ints.map(Number);
}

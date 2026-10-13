// ============================================================================
//  BREADBOARD LAB  ·  sim/solver.js — sparse LU for the circuit matrix
// ----------------------------------------------------------------------------
//  The engine stamps a fixed set of matrix entries (the STRUCTURE) many times
//  per second with new values. This module factors that matrix as P·A·Q = L·U.
//
//  ORDER ONCE. A minimum degree order on the pattern of A + Aᵀ gives the
//  column order Q. It keeps the fill small. The engine makes a new solver only
//  when the circuit topology changes.
//
//  FACTOR WITH PIVOTS. factor() is a left-looking LU (one column at a time).
//  For column k it finds the reach of the column in the graph of L (a depth
//  first search), applies the earlier columns in topological order, and picks
//  a pivot. It prefers the diagonal entry when that entry is at least
//  DIAG_TOL of the column maximum. Else it takes the largest entry (partial
//  pivoting). MNA rows of voltage sources have a zero diagonal, so they need
//  this.
//
//  REFACTOR WITHOUT SEARCH. refactor() keeps the pivot rows and the patterns
//  of L and U from the last factor() and only does the arithmetic. If a pivot
//  falls below REFACTOR_TOL of its column, refactor() returns false and the
//  caller runs factor() again.
//
//  GREP MAP
//    minDegreeOrder ...... the fill-reducing column order
//    createLU ............ the solver object: factor, refactor, solve
//    _reach .............. the depth first search over the graph of L
//    DIAG_TOL / REFACTOR_TOL  the pivot thresholds
// ============================================================================

export const DIAG_TOL = 0.01;
export const REFACTOR_TOL = 1e-7;

// A minimum degree order of the symmetric pattern of A + Aᵀ. n is small (a
// few hundred), so a plain scan for the minimum is fast enough.
export function minDegreeOrder(n, rows, cols) {
  const adj = new Array(n);
  for (let i = 0; i < n; i++) adj[i] = new Set();
  for (let e = 0; e < rows.length; e++) {
    const r = rows[e], c = cols[e];
    if (r !== c && r >= 0 && c >= 0) { adj[r].add(c); adj[c].add(r); }
  }
  const done = new Uint8Array(n);
  const order = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    let best = -1, bestDeg = Infinity;
    for (let v = 0; v < n; v++) {
      if (done[v]) continue;
      const d = adj[v].size;
      if (d < bestDeg) { bestDeg = d; best = v; if (d === 0) break; }
    }
    order[k] = best; done[best] = 1;
    const nb = Array.from(adj[best]);
    for (const u of nb) adj[u].delete(best);
    for (let i = 0; i < nb.length; i++) {
      const a = adj[nb[i]];
      for (let j = 0; j < nb.length; j++) if (j !== i) a.add(nb[j]);
    }
    adj[best].clear();
  }
  return order;
}

class Grow {
  constructor(n, T) { this.T = T; this.a = new T(Math.max(16, n)); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) { const b = new this.T(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
}

// rows[e], cols[e]: the position of value e in the values array the engine
// fills. Entries must be unique.
export function createLU(n, rows, cols) {
  const nnz = rows.length;
  // Column-compressed copy of the structure. cscEnt[p] = entry index.
  const Ap = new Int32Array(n + 1);
  for (let e = 0; e < nnz; e++) Ap[cols[e] + 1]++;
  for (let j = 0; j < n; j++) Ap[j + 1] += Ap[j];
  const Ai = new Int32Array(nnz), cscEnt = new Int32Array(nnz);
  const fill = Ap.slice(0, n);
  for (let e = 0; e < nnz; e++) { const p = fill[cols[e]]++; Ai[p] = rows[e]; cscEnt[p] = e; }

  const q = minDegreeOrder(n, rows, cols);
  const pinv = new Int32Array(n).fill(-1);
  const pivRow = new Int32Array(n);
  const x = new Float64Array(n);
  const mark = new Int32Array(n);
  const ptr = new Int32Array(n);
  const stack = new Int32Array(n);
  const xi = new Int32Array(n);
  let stamp = 0;

  // L: column k holds rows below the pivot (original row ids). U: column k
  // holds earlier steps j and values; Ud[k] is the pivot.
  let Lp = new Int32Array(n + 1), Li = new Grow(nnz * 2, Int32Array), Lx = new Grow(nnz * 2, Float64Array);
  let Up = new Int32Array(n + 1), Uj = new Grow(nnz * 2, Int32Array), Ux = new Grow(nnz * 2, Float64Array);
  const Ud = new Float64Array(n);
  // Stored pattern (rows in topological order) per column, for refactor.
  let Pp = new Int32Array(n + 1), Pr = new Grow(nnz * 3, Int32Array);
  let factored = false;
  const stats = { factors: 0, refactors: 0, fallbacks: 0 };

  function reach(col) {
    stamp++;
    let top = n;
    for (let p = Ap[col]; p < Ap[col + 1]; p++) {
      const r0 = Ai[p];
      if (mark[r0] === stamp) continue;
      let sp = 0; stack[0] = r0;
      while (sp >= 0) {
        const r = stack[sp];
        const j = pinv[r];
        if (mark[r] !== stamp) { mark[r] = stamp; ptr[r] = j >= 0 ? Lp[j] : 0; }
        let pushed = false;
        if (j >= 0) {
          const end = Lp[j + 1];
          const li = Li.a;
          for (let pp = ptr[r]; pp < end; pp++) {
            const rr = li[pp];
            if (mark[rr] !== stamp) { ptr[r] = pp + 1; stack[++sp] = rr; pushed = true; break; }
          }
          if (!pushed) ptr[r] = end;
        }
        if (!pushed) { sp--; xi[--top] = r; }
      }
    }
    return top;
  }

  function factor(vals) {
    stats.factors++;
    pinv.fill(-1);
    Li.n = 0; Lx.n = 0; Uj.n = 0; Ux.n = 0; Pr.n = 0;
    for (let k = 0; k < n; k++) {
      const col = q[k];
      Lp[k] = Li.n; Up[k] = Uj.n; Pp[k] = Pr.n;
      const top = reach(col);
      for (let p = top; p < n; p++) x[xi[p]] = 0;
      for (let p = Ap[col]; p < Ap[col + 1]; p++) x[Ai[p]] = vals[cscEnt[p]];
      for (let p = top; p < n; p++) {
        const r = xi[p], j = pinv[r];
        if (j < 0) continue;
        const xr = x[r];
        if (xr === 0) continue;
        const li = Li.a, lx = Lx.a;
        for (let pp = Lp[j], e = Lp[j + 1]; pp < e; pp++) x[li[pp]] -= lx[pp] * xr;
      }
      // pivot
      let amax = -1, ipiv = -1;
      for (let p = top; p < n; p++) {
        const r = xi[p];
        if (pinv[r] >= 0) continue;
        const a = Math.abs(x[r]);
        if (a > amax) { amax = a; ipiv = r; }
      }
      if (ipiv < 0 || !(amax > 0) || !Number.isFinite(amax)) { factored = false; return false; }
      if (pinv[col] < 0 && mark[col] === stamp && Math.abs(x[col]) >= DIAG_TOL * amax) ipiv = col;
      const piv = x[ipiv];
      pinv[ipiv] = k; pivRow[k] = ipiv; Ud[k] = piv;
      for (let p = top; p < n; p++) {
        const r = xi[p];
        Pr.push(r);
        const j = pinv[r];
        if (j >= 0 && j < k) { Uj.push(j); Ux.push(x[r]); }
        else if (r !== ipiv) { Li.push(r); Lx.push(x[r] / piv); }
      }
    }
    Lp[n] = Li.n; Up[n] = Uj.n; Pp[n] = Pr.n;
    factored = true;
    return true;
  }

  function refactor(vals) {
    if (!factored) return factor(vals);
    stats.refactors++;
    const li = Li.a, lx = Lx.a, uj = Uj.a, ux = Ux.a;
    for (let k = 0; k < n; k++) {
      const col = q[k], prk = pivRow[k];
      const u0 = Up[k], u1 = Up[k + 1], l0 = Lp[k], l1 = Lp[k + 1];
      // zero the pattern of this column: U rows, L rows, the pivot row
      for (let u = u0; u < u1; u++) x[pivRow[uj[u]]] = 0;
      for (let l = l0; l < l1; l++) x[li[l]] = 0;
      x[prk] = 0;
      for (let p = Ap[col], e = Ap[col + 1]; p < e; p++) x[Ai[p]] = vals[cscEnt[p]];
      // earlier columns, in the stored topological order
      for (let u = u0; u < u1; u++) {
        const j = uj[u], xr = x[pivRow[j]];
        ux[u] = xr;
        if (xr !== 0) for (let pp = Lp[j], e = Lp[j + 1]; pp < e; pp++) x[li[pp]] -= lx[pp] * xr;
      }
      const piv = x[prk];
      let amax = 0;
      for (let l = l0; l < l1; l++) { const a = Math.abs(x[li[l]]); if (a > amax) amax = a; }
      if (!(Math.abs(piv) > REFACTOR_TOL * amax) || !(Math.abs(piv) < Infinity)) {
        stats.fallbacks++;
        return factor(vals);
      }
      Ud[k] = piv;
      const inv = 1 / piv;
      for (let l = l0; l < l1; l++) lx[l] = x[li[l]] * inv;
    }
    return true;
  }

  // b: right hand side in row order. out: solution in column order.
  function solve(b, out) {
    for (let i = 0; i < n; i++) x[i] = b[i];
    const li = Li.a, lx = Lx.a, uj = Uj.a, ux = Ux.a;
    for (let k = 0; k < n; k++) {
      const xk = x[pivRow[k]];
      if (xk === 0) continue;
      for (let p = Lp[k], e = Lp[k + 1]; p < e; p++) x[li[p]] -= lx[p] * xk;
    }
    // z[k] = x[pivRow[k]] ; reuse out as z in step order, then permute
    const z = zbuf;
    for (let k = 0; k < n; k++) z[k] = x[pivRow[k]];
    for (let k = n - 1; k >= 0; k--) {
      const zk = (z[k] /= Ud[k]);
      if (zk === 0) continue;
      for (let p = Up[k], e = Up[k + 1]; p < e; p++) z[uj[p]] -= ux[p] * zk;
    }
    for (let k = 0; k < n; k++) out[q[k]] = z[k];
    return out;
  }
  const zbuf = new Float64Array(n);

  return {
    n, nnz, stats,
    factor, refactor, solve,
    get factored() { return factored; },
    fillIn() { return Li.n + Uj.n + n; },
  };
}

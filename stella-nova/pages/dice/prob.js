// ============================================================================
//  DICE LAB  ·  prob.js — exact distributions and the fairness test
// ----------------------------------------------------------------------------
//  No DOM. tests.mjs checks each result against brute force.
//
//  A distribution is { lo, p }: p[i] is P(X = lo + i). The functions:
//    diePmf(sides, explode)  one die. A d10 counts 1..10, d% 1..100, Fate
//                            -1..1, a coin 0..1. Exploding: P(v) = 1/n
//                            for v < n, and P(n + y) = P(y) / n. The chain
//                            stops when the mass left is under 1e-12.
//    convolve(a, b)          the sum of two independent variables:
//                              P(S = s) = sum_k P(A = k) P(B = s - k)
//    keepPmf(pmf, n, k, hi)  the sum of the k highest (or lowest) of n iid
//                            dice, exact, by a pass over the face values
//                            from the top (or the bottom). The state is
//                            (dice placed, kept sum); c dice on value v
//                            have C(n - placed, c) orders, and min(c, k -
//                            kept) of them count.
//    specPmf(spec)           a whole notation: each group, signed, convolved,
//                            then shifted by the constants
//    chiSquare(obs, exp)     X^2 = sum (O - E)^2 / E with k - 1 degrees of
//                            freedom; p = Q(df/2, X^2/2), the upper
//                            regularised gamma function
//
//  GREP MAP
//    export function diePmf ..... one die
//    export function convolve ... the sum of two
//    export function keepPmf .... keep highest / lowest, exact
//    export function specPmf .... a notation to its exact distribution
//    export function moments .... mean, variance, sd
//    export function atLeast .... P(X >= x)
//    export function chiSquare .. the fairness test
//    export function gammaQ ..... upper regularised gamma
// ============================================================================

export function diePmf(sides, explode = false) {
  if (sides === 'F') return { lo: -1, p: [1 / 3, 1 / 3, 1 / 3] };
  if (sides === 'C') return { lo: 0, p: [0.5, 0.5] };
  const n = sides;
  if (!explode) return { lo: 1, p: new Array(n).fill(1 / n) };
  // exploding: values 1..n-1 at 1/n, then n + (next die), and so on
  const p = [];
  let w = 1, base = 0;
  while (w > 1e-12) {
    for (let v = 1; v < n; v++) p[base + v - 1] = (p[base + v - 1] || 0) + w / n;
    w /= n; base += n;
  }
  for (let i = 0; i < p.length; i++) p[i] = p[i] || 0;
  return { lo: 1, p };
}

export function convolve(a, b) {
  const p = new Array(a.p.length + b.p.length - 1).fill(0);
  for (let i = 0; i < a.p.length; i++) { const x = a.p[i]; if (!x) continue; for (let j = 0; j < b.p.length; j++) p[i + j] += x * b.p[j]; }
  return { lo: a.lo + b.lo, p };
}
export const negate = a => ({ lo: -(a.lo + a.p.length - 1), p: a.p.slice().reverse() });
export const shift = (a, c) => ({ lo: a.lo + c, p: a.p });

export function sumPmf(pmf, n) {
  let r = { lo: 0, p: [1] };
  for (let i = 0; i < n; i++) r = convolve(r, pmf);
  return r;
}

const binom = (() => { const C = [[1]]; return (n, k) => { for (let i = C.length; i <= n; i++) { C[i] = [1]; for (let j = 1; j <= i; j++) C[i][j] = (C[i - 1][j - 1] || 0) + (C[i - 1][j] || 0); } return C[n][k] || 0; }; })();

// sum of the k highest (hi) or lowest of n iid draws from pmf
export function keepPmf(pmf, n, k, hi = true) {
  const vals = pmf.p.map((q, i) => ({ v: pmf.lo + i, q })).filter(o => o.q > 0);
  if (hi) vals.reverse();
  // state: Map key placed -> Map(sum -> prob)
  let S = new Map([[0, new Map([[0, 1]])]]);
  for (const { v, q } of vals) {
    const N = new Map();
    for (const [placed, sums] of S) {
      const left = n - placed, kept = Math.min(placed, k);
      for (let c = 0; c <= left; c++) {
        const w = binom(left, c) * Math.pow(q, c);
        if (!w) continue;
        const add = Math.min(c, k - kept) * v, pl = placed + c;
        if (!N.has(pl)) N.set(pl, new Map());
        const M = N.get(pl);
        for (const [s, pr] of sums) M.set(s + add, (M.get(s + add) || 0) + pr * w);
      }
    }
    S = N;
  }
  const fin = S.get(n) || new Map();
  let lo = Infinity, hiS = -Infinity;
  for (const s of fin.keys()) { lo = Math.min(lo, s); hiS = Math.max(hiS, s); }
  const p = new Array(hiS - lo + 1).fill(0);
  for (const [s, pr] of fin) p[s - lo] += pr;
  return { lo, p };
}

export function termPmf(t) {
  const one = diePmf(t.sides, t.explode);
  const g = t.keep ? keepPmf(one, t.count, t.keep.n, t.keep.hi) : sumPmf(one, t.count);
  return t.sign < 0 ? negate(g) : g;
}
export function specPmf(spec) {
  let r = { lo: 0, p: [1] }, c = 0;
  for (const t of spec.terms) {
    if (t.kind === 'const') { c += t.sign * t.value; continue; }
    r = convolve(r, termPmf(t));
  }
  return trim(shift(r, c));
}
export function trim(a, eps = 1e-15) {
  let i0 = 0, i1 = a.p.length - 1;
  while (i0 < i1 && a.p[i0] < eps) i0++;
  while (i1 > i0 && a.p[i1] < eps) i1--;
  return { lo: a.lo + i0, p: a.p.slice(i0, i1 + 1) };
}

export function moments(a) {
  let m = 0, m2 = 0, s = 0;
  a.p.forEach((q, i) => { const x = a.lo + i; s += q; m += q * x; m2 += q * x * x; });
  m /= s; m2 /= s;
  const v = Math.max(0, m2 - m * m);
  return { mean: m, var: v, sd: Math.sqrt(v), mass: s };
}
export const prob = (a, x) => (x >= a.lo && x < a.lo + a.p.length) ? a.p[x - a.lo] : 0;
export function atLeast(a, x) { let s = 0; a.p.forEach((q, i) => { if (a.lo + i >= x) s += q; }); return Math.min(1, s); }
export function atMost(a, x) { let s = 0; a.p.forEach((q, i) => { if (a.lo + i <= x) s += q; }); return Math.min(1, s); }

// ── the fairness test ──────────────────────────────────────────────────────
// log gamma (Lanczos, g = 7)
const LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
export function lnGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1; let a = LG[0]; const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LG[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
// Q(a, x) = Gamma(a, x) / Gamma(a): series for x < a + 1, else Lentz's
// continued fraction
export function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; }
    return Math.max(0, 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a)));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.min(1, Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h);
}
// obs: counts; probs: expected shares (default uniform)
export function chiSquare(obs, probs) {
  const n = obs.reduce((s, x) => s + x, 0), k = obs.length;
  const P = probs || new Array(k).fill(1 / k);
  let x2 = 0;
  for (let i = 0; i < k; i++) { const e = n * P[i]; if (e > 0) x2 += (obs[i] - e) ** 2 / e; }
  const df = k - 1;
  return { x2, df, n, p: n ? gammaQ(df / 2, x2 / 2) : 1 };
}

// ============================================================================
//  RAMANUJAN PI  ·  tests.mjs — node tests of engine.js
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/ramanujan-pi/tests.mjs [--big]
//  The stored reference (pi10k.js) must agree with two computations of this
//  page that share no code: Chudnovsky by binary splitting, and Machin by
//  fixed-point arctangents. Every series must reach the reference, at the
//  digit rate in its table entry. --big also times 100000 digits.
// ============================================================================
import { SERIES, byId, seqIter, isqrt, log10Big, partials, correctDigits, lockMap,
  splitSum, piFromSum, piDigits, machinDigits, anatomy, pow10, termsFor } from './engine.js';
import { PI_10K } from './pi10k.js';

let fails = 0, passes = 0;
function ok(cond, msg) { if (cond) passes++; else { fails++; console.log('FAIL', msg); } }
const t0 = performance.now();

// 1. The reference: length, the Feynman point, and two computations.
ok(PI_10K.length === 10001 && /^[0-9]+$/.test(PI_10K), 'PI_10K is 3 and 10000 decimals');
ok(PI_10K.slice(762, 768) === '999999', 'six nines at decimals 762-767');
{
  let t = performance.now();
  const c = piDigits(10000);
  const tc = performance.now() - t; t = performance.now();
  const m = machinDigits(10000);
  const tm = performance.now() - t;
  ok(c === PI_10K, 'Chudnovsky 10000 digits = reference');
  ok(m === PI_10K, 'Machin 10000 digits = reference');
  console.log(`reference: Chudnovsky ${tc.toFixed(0)} ms, Machin ${tm.toFixed(0)} ms, both = PI_10K: ${c === PI_10K && m === PI_10K}`);
}

// 2. isqrt: floor(sqrt(n)) on small, square and random large numbers.
{
  let bad = 0, seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const cases = [0n, 1n, 2n, 3n, 4n, 15n, 16n, 17n, (2n ** 52n) - 1n, 2n ** 52n, (10n ** 40n), (10n ** 40n) - 1n, (3n ** 500n) ** 2n, (3n ** 500n) ** 2n - 1n];
  for (let i = 0; i < 200; i++) {
    let n = 0n; const len = 1 + rnd() % 120;
    for (let j = 0; j < len; j++) n = (n << 31n) + BigInt(rnd());
    cases.push(n);
  }
  for (const n of cases) { const x = isqrt(n); if (!(x * x <= n && (x + 1n) * (x + 1n) > n)) bad++; }
  ok(bad === 0, `isqrt: ${bad} wrong of ${cases.length}`);
  const r2 = isqrt(2n * 10n ** 2000n).toString();
  ok(r2.startsWith('14142135623730950488016887242096980785696718753769'), 'isqrt(2 * 10^2000) starts 1.41421356...');
}

// 3. Sequences: the first values in the article, and the closed forms.
const C = (n, k) => { if (k < 0 || k > n) return 0n; let r = 1n; for (let i = 0; i < k; i++) r = r * BigInt(n - i) / BigInt(i + 1); return r; };
const closed = {
  l1a: k => C(2 * k, k) * C(3 * k, k) * C(6 * k, 3 * k),
  l2a: k => C(2 * k, k) ** 2n * C(4 * k, 2 * k),
  l3a: k => C(2 * k, k) ** 2n * C(3 * k, k),
  l4a: k => C(2 * k, k) ** 3n,
  l5a: k => { let s = 0n; for (let j = 0; j <= k; j++) s += C(k, j) ** 2n * C(k + j, j); return C(2 * k, k) * s; },
  l6a: k => { let s = 0n; for (let j = 0; j <= k; j++) s += C(k, j) ** 3n; return C(2 * k, k) * s; },
  l7a: k => { let s = 0n; for (let j = 0; j <= k; j++) s += C(k, j) ** 2n * C(2 * j, k) * C(k + j, j); return s; },
  l10a: k => { let s = 0n; for (let j = 0; j <= k; j++) s += C(k, j) ** 4n; return s; },
};
const article = {
  l1a: [1n, 120n, 83160n, 81681600n], l2a: [1n, 24n, 2520n, 369600n, 63063000n], l3a: [1n, 12n, 540n, 33600n, 2425500n],
  l4a: [1n, 8n, 216n, 8000n, 343000n], l5a: [1n, 6n, 114n, 2940n, 87570n], l6a: [1n, 4n, 60n, 1120n, 24220n],
  l7a: [1n, 4n, 48n, 760n, 13840n], l10a: [1n, 2n, 18n, 164n, 1810n],
};
for (const S of SERIES.filter(s => s.kind === 'rs')) {
  const next = seqIter(S); let bad = -1;
  for (let k = 0; k < 60; k++) { const v = next(); if (v !== closed[S.id](k) && bad < 0) bad = k; if (k < article[S.id].length && v !== article[S.id][k] && bad < 0) bad = k; }
  ok(bad < 0, `${S.id}: s(k) = closed form and article values for k < 60 (first bad k ${bad})`);
}

// 4. Each series: term by term to 400 digits. Digits after n terms must
// follow the rate in the table, and the last value must match PI_10K.
{
  const D = 400, W = D + 12, ref = BigInt(PI_10K.slice(0, W + 1));
  for (const S of SERIES) {
    if (S.id === 'leibniz') continue;
    const N = Math.ceil((D + 6) / S.rate);
    const vals = partials(S, N, W);
    const dig = vals.map(x => correctDigits(x, ref, W, D));
    let mono = true; for (let i = 1; i < dig.length; i++) if (dig[i] + 2 < dig[i - 1]) mono = false;
    const n = Math.floor(N * 0.8), got = dig[n - 1], want = S.rate * n;
    ok(dig[dig.length - 1] === D, `${S.id}: ${D} digits after ${N} terms (got ${dig[dig.length - 1]})`);
    ok(Math.abs(got - want) <= 4 + 0.02 * want, `${S.id}: ${got} digits after ${n} terms, rate says ${want.toFixed(1)}`);
    ok(mono, `${S.id}: digits do not fall back`);
    if (S.id === 'l1a') ok(dig[0] === 13 && dig[1] === 27, `Chudnovsky: 1 term ${dig[0]} digits, 2 terms ${dig[1]} digits`);
    if (S.id === 'l2a') ok(dig[0] === 7 && dig[1] === 15, `Ramanujan: 1 term ${dig[0]} digits, 2 terms ${dig[1]} digits`);
    console.log(`  ${S.id.padEnd(7)} ${String(N).padStart(4)} terms for ${D} digits, ${(dig[n - 1] / n).toFixed(3)} digits per term at n = ${n} (table ${S.rate.toFixed(3)})`);
  }
  // Leibniz: 1000 terms give an error near 1/1000 (2 or 3 digits).
  const L = partials(byId('leibniz'), 1000, 30), Lref = BigInt(PI_10K.slice(0, 31));
  const ld = correctDigits(L[999], Lref, 30, 18);
  ok(ld >= 2 && ld <= 3, `Leibniz: ${ld} digits after 1000 terms`);
}

// 5. Binary splitting gives the same pi for each hypergeometric series.
for (const id of ['l2a', 'l3a', 'l4a']) {
  const S = byId(id), D = id === 'l4a' ? 600 : 3000;
  ok(piDigits(D, S) === PI_10K.slice(0, D + 1), `${id}: binary splitting to ${D} digits = reference`);
}
{
  const S = byId('l1a'), { T, Q } = splitSum(S, 3);
  const x = piFromSum(S, T, Q, pow10(50));
  ok(x.toString().slice(0, 40) === PI_10K.slice(0, 40), 'Chudnovsky: 3 terms by splitting give 40 good digits');
}

// 6. lockMap: locks only grow along the decimals, and Chudnovsky term 1 fixes 13.
{
  const D = 300, W = D + 12, vals = partials(byId('l1a'), termsFor(byId('l1a'), D), W);
  const { lock, match } = lockMap(vals, PI_10K, W, D);
  let mono = true; for (let i = 1; i < D; i++) if (lock[i] < lock[i - 1]) mono = false;
  ok(mono && lock[0] === 1 && lock[12] === 1 && lock[13] === 2, `Chudnovsky locks: first 13 decimals by term 1 (lock[12] ${lock[12]}, lock[13] ${lock[13]})`);
  ok(lock.every(v => v > 0), 'every decimal locked by the last term');
  ok(match[0] === 13, `Chudnovsky term 1 matches 13 decimals (${match[0]})`);
  const v2 = partials(byId('l4a'), 400, W), lm = lockMap(v2, PI_10K, W, D);
  let mono2 = true; for (let i = 1; i < D; i++) if (lm.lock[i] && lm.lock[i] < lm.lock[i - 1]) mono2 = false;
  ok(mono2, 'level 4A locks grow');
}

// 7. anatomy: finite numbers, and the term sizes fall at the table rate.
for (const S of SERIES.filter(s => s.kind === 'rs')) {
  const next = seqIter(S); let bad = 0, a0 = null, a100 = null;
  for (let k = 0; k <= 100; k++) {
    const a = anatomy(S, k, next());
    if (![a.ls, a.ll, a.lc, a.lp, a.lt].every(Number.isFinite)) bad++;
    if (k === 0) a0 = a; if (k === 100) a100 = a;
  }
  const slope = (a0.lt - a100.lt) / 100;
  ok(bad === 0, `${S.id}: anatomy has no NaN`);
  ok(Math.abs(slope - S.rate) < 0.06, `${S.id}: term size falls ${slope.toFixed(3)} decades per term (table ${S.rate})`);
}
ok(Math.abs(log10Big(10n ** 5000n) - 5000) < 1e-9 && Math.abs(log10Big(123456789n) - Math.log10(123456789)) < 1e-12, 'log10Big');

// 8. Determinism: two runs give the same digits.
ok(piDigits(2000) === piDigits(2000), 'same digits twice');

if (process.argv.includes('--big')) {
  const t = performance.now(), s = piDigits(100000);
  console.log(`100000 digits in ${(performance.now() - t).toFixed(0)} ms, first 10000 = reference: ${s.slice(0, 10001) === PI_10K}, last ten ${s.slice(-10)}`);
  ok(s.length === 100001 && s.slice(0, 10001) === PI_10K, '100000 digits start with the reference');
}

console.log(`${passes} passed, ${fails} failed, ${(performance.now() - t0).toFixed(0)} ms`);
process.exit(fails ? 1 : 0);

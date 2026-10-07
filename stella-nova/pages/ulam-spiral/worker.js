// ============================================================================
//  ULAM SPIRAL  ·  worker.js — the sieve, the arithmetic bytes, CPU tiles
// ----------------------------------------------------------------------------
//  A module worker (new Worker(url, { type: 'module' })). Messages in:
//    { type: 'sieve', limit }        sieve the odd numbers to limit; posts
//                                    { type: 'progress', done, total } and
//                                    then { type: 'primes', bits, limit }
//    { type: 'arith', mode }         the class bytes of one arithmetic mode
//                                    for n < 2^23 -> { type: 'arith', mode, bytes }
//    { type: 'tile', id, key, P, mode, quad, x0, y0, w, h }
//                                    the class byte and quadratic flag of
//                                    each lattice cell in the window (RG8)
//                                    -> { type: 'tile', id, data, ms }
//  A tile cell above the sieve limit gets Miller-Rabin (numtheory.js
//  isPrime). The arithmetic modes there factor by trial division to 10^4;
//  for n < 10^12 the rest is then 1, a prime, a square of a prime or a
//  product of two primes, so d(n) and the smallest factor stay exact. The
//  totient ratio of a two-prime rest uses (1 - 1/sqrt(rest))^2, which is
//  within 1e-4 of the true value: below one step of the colour byte.
//
//  GREP MAP
//    grep -n "case 'sieve'"   grep -n "case 'arith'"   grep -n 'function tile'
// ============================================================================
import * as T from './numtheory.js';
import { SHAPE, nAt, latticeNumber, isLattice } from './layouts.js';

let bits = null, limit = 0, spf = null;
const ARITH_N = 1 << 23;
const prime = n => (n <= limit ? T.bitPrime(bits, n) : T.isPrime(n));

// The arithmetic byte of a large n by trial division to 10^4.
function arithFar(mode, n) {
  const f = [];
  let r = n;
  for (let i = 0; i < 1229; i++) {
    const p = T.SMALL[i];
    if (p * p > r) break;
    if (r % p === 0) { let e = 0; while (r % p === 0) { r /= p; e++; } f.push([p, e]); }
  }
  if (r > 1) {
    if (r < 1e8 || prime(r)) f.push([r, 1]);
    else {
      const q = Math.round(Math.sqrt(r));
      if (q * q === r) f.push([q, 2]);
      else {
        // two primes above 10^4
        if (mode === T.MODE.divisors) return Math.min(254, T.divisorsOf(f) * 4);
        // (the rest r stands in for its two factors: only f[0] is read)
        if (mode === T.MODE.spf) return f.length ? T.arithByte(mode, n, [...f, [r, 1]]) : 253;
        const ph = T.totientOf(n / r, f) / (n / r) * (1 - 1 / Math.sqrt(r)) ** 2;
        return 1 + Math.round(ph * 250);
      }
    }
  }
  return T.arithByte(mode, n, f);
}
function arithByteOf(mode, n) {
  if (n < ARITH_N) {
    if (!spf) spf = T.spfTable(ARITH_N);
    if (n < 2) return T.arithByte(mode, n, []);
    // factor through the table
    const f = [];
    let m = n;
    while (m > 1) { const p = spf[m] || m; let e = 0; while (m % p === 0) { m /= p; e++; } f.push([p, e]); }
    return T.arithByte(mode, n, f);
  }
  return arithFar(mode, n);
}
// n = a k^2 + b k + c for an integer k >= 0 (k <= qmax)?
function quadMember(q, n) {
  if (!q || !q.on) return false;
  const { a, b, c } = q;
  let k0;
  if (a === 0) { if (b === 0) return n === c; k0 = (n - c) / b; }
  else { const D = b * b - 4 * a * (c - n); if (D < 0) return false; k0 = (-b + Math.sqrt(D)) / (2 * a); }
  const k = Math.round(k0);
  for (let kk = k - 1; kk <= k + 1; kk++) if (kk >= 0 && (q.max == null || kk <= q.max) && a * kk * kk + b * kk + c === n) return true;
  return false;
}
function tile(m) {
  const t0 = Date.now(), s = SHAPE[m.key], data = new Uint8Array(m.w * m.h * 2);
  const arithMode = m.mode >= T.MODE.divisors && m.mode <= T.MODE.totient;
  for (let j = 0; j < m.h; j++) {
    for (let i = 0; i < m.w; i++) {
      const x = m.x0 + i, y = m.y0 + j, o = 2 * (j * m.w + i);
      if (!isLattice(s)) { data[o] = T.UNKNOWN; continue; }
      const n = nAt(s, m.P, x, y);
      if (n < 0) { data[o] = 0; continue; }
      let v;
      if (s.lattice) { const [a, b] = latticeNumber(s, x, y); v = T.classify(m.mode, n, prime, a, b); }
      else if (arithMode) v = arithByteOf(m.mode, n);
      else v = T.classify(m.mode, n, prime);
      data[o] = v;
      data[o + 1] = quadMember(m.quad, n) ? 1 : 0;
    }
  }
  return { type: 'tile', id: m.id, data, x0: m.x0, y0: m.y0, w: m.w, h: m.h, ms: Date.now() - t0 };
}

self.onmessage = e => {
  const m = e.data;
  switch (m.type) {
    case 'sieve': {
      const t0 = Date.now();
      let last = 0;
      const b = T.sieveOdd(m.limit, (done, total) => {
        const now = Date.now();
        if (now - last > 120) { last = now; self.postMessage({ type: 'progress', done, total }); }
      });
      bits = b; limit = m.limit;
      const copy = b.slice();
      self.postMessage({ type: 'primes', bits: copy, limit, ms: Date.now() - t0 }, [copy.buffer]);
      break;
    }
    case 'arith': {
      if (!spf) spf = T.spfTable(ARITH_N);
      const bytes = T.arithBytes(m.mode, spf);
      self.postMessage({ type: 'arith', mode: m.mode, bytes }, [bytes.buffer]);
      break;
    }
    case 'tile': {
      const r = tile(m);
      self.postMessage(r, [r.data.buffer]);
      break;
    }
  }
};

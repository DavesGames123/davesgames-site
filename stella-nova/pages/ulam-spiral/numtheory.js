// ============================================================================
//  ULAM SPIRAL  ·  numtheory.js — primes, factors and prime counts (no DOM)
// ----------------------------------------------------------------------------
//  The page, the worker and tests.mjs all import this module. It has no DOM
//  and no GPU code.
//
//  PRIME BITSET. The sieve keeps the odd numbers only: bit i of the bitset
//  is 1 when 2i + 1 is prime. Word w holds bits 32w .. 32w + 31. The page
//  uploads the same words to the GPU (R32UI texture), so the shader and
//  this module read one format.
//
//  PRIMALITY OUTSIDE THE BITSET. isPrime() uses trial division by the
//  small primes, then Miller-Rabin. Below 2^32 the bases {2, 7, 61} are
//  deterministic and the arithmetic stays in doubles (mulmod32). Above
//  2^32 the test uses BigInt and the seven bases of Jim Sinclair, which
//  are deterministic for every n < 2^64.
//
//  GREP MAP
//    grep -n 'export function sieveOdd'        segmented sieve to a limit
//    grep -n 'export function bitPrime'        read one number from a bitset
//    grep -n 'export function prefixCounts'    pi(N) from the bitset
//    grep -n 'export function isPrime'         trial division + Miller-Rabin
//    grep -n 'export function factor'          trial division + Pollard rho
//    grep -n 'export function li'              the logarithmic integral
//    grep -n 'export function spfTable'        smallest factor, n < 2^23
//    grep -n 'export function arithBytes'      the class bytes per mode
//    grep -n 'export function classify'        one number, any mode
//    grep -n 'export function quadConstant'    Bateman-Horn constant C(f)
//    grep -n 'export function quadDensity'     observed / expected primes
// ============================================================================

// --- small primes ----------------------------------------------------------
// The primes below 2^16, from a plain sieve. Trial division and the
// segmented sieve both start from this list.
export const SMALL = (() => {
  const N = 65536, c = new Uint8Array(N), out = [];
  for (let i = 2; i < N; i++) {
    if (c[i]) continue;
    out.push(i);
    for (let j = i * i; j < N; j += i) c[j] = 1;
  }
  return Int32Array.from(out);
})();

// --- segmented sieve -------------------------------------------------------
// The odd-only bitset of the primes up to limit. Each segment covers SEG
// odd numbers and clears the bits of the odd multiples of each base prime.
// onSeg(done, total) runs after each segment (the worker posts progress).
export function sieveOdd(limit, onSeg) {
  limit = Math.max(2, Math.floor(limit));
  const odds = Math.floor((limit + 1) / 2);           // 1, 3, 5, ... <= limit
  const words = Math.ceil(odds / 32);
  const bits = new Uint32Array(words).fill(0xffffffff);
  bits[0] &= ~1;                                      // 1 is not prime
  const tail = odds & 31;
  if (tail) bits[words - 1] = (bits[words - 1] & ((2 ** tail) - 1)) >>> 0;
  const root = Math.floor(Math.sqrt(limit));
  const base = [];
  for (const p of SMALL) { if (p > root) break; if (p > 2) base.push(p); }
  // Primes above 2^16 are never needed as base primes: limit < 2^32.
  const SEG = 1 << 21;                                // odd numbers per segment
  const next = new Float64Array(base.length);
  for (let j = 0; j < base.length; j++) next[j] = (base[j] * base[j] - 1) / 2;  // bit of p^2
  const segs = Math.ceil(odds / SEG);
  for (let s = 0; s < segs; s++) {
    const lo = s * SEG, hi = Math.min(odds, lo + SEG);
    for (let j = 0; j < base.length; j++) {
      const p = base[j];
      let i = next[j];
      if (i >= hi) continue;
      for (; i < hi; i += p) bits[i >>> 5] &= ~(1 << (i & 31));
      next[j] = i;
    }
    if (onSeg) onSeg(s + 1, segs);
  }
  return bits;
}

// Is n prime, from the odd-only bitset? Undefined above the bitset.
export function bitPrime(bits, n) {
  if (n < 2) return false;
  if (n === 2) return true;
  if (!(n & 1)) return false;
  const i = (n - 1) / 2;
  return ((bits[i >>> 5] >>> (i & 31)) & 1) === 1;
}

// The largest number the bitset covers.
export function bitLimit(bits) { return bits.length * 64 - 1; }

function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

// Prefix counts for pi(N): blocks[b] = the number of odd primes in the
// words before word b * BLOCK. piFrom() then counts one partial block.
export const BLOCK = 1024;
export function prefixCounts(bits) {
  const nb = Math.ceil(bits.length / BLOCK) + 1, blocks = new Float64Array(nb);
  let acc = 0;
  for (let b = 0; b < nb; b++) {
    blocks[b] = acc;
    const e = Math.min(bits.length, (b + 1) * BLOCK);
    for (let w = b * BLOCK; w < e; w++) acc += popcount(bits[w]);
  }
  return blocks;
}

// pi(N): the number of primes <= N, for N inside the bitset.
export function piFrom(bits, blocks, N) {
  if (N < 2) return 0;
  N = Math.min(Math.floor(N), bitLimit(bits));
  const i = Math.floor((N - 1) / 2);                  // last odd bit index
  const w = i >>> 5, b = Math.floor(w / BLOCK);
  let acc = blocks[b];
  for (let k = b * BLOCK; k < w; k++) acc += popcount(bits[k]);
  const r = i & 31;
  acc += popcount(r === 31 ? bits[w] : bits[w] & ((2 ** (r + 1)) - 1));
  return acc + 1;                                     // + the prime 2
}

// --- Miller-Rabin ------------------------------------------------------------
// a * b mod m for a, b < m < 2^32, exact in doubles: split b in 16-bit
// halves so that each product stays below 2^49.
function mulmod32(a, b, m) {
  return ((a * (b >>> 16)) % m * 65536 + a * (b & 0xffff)) % m;
}
function powmod32(a, e, m) {
  let r = 1; a %= m;
  while (e > 0) {
    if (e & 1) r = mulmod32(r, a, m);
    e = Math.floor(e / 2);
    if (e) a = mulmod32(a, a, m);
  }
  return r;
}
function mr32(n, a) {
  let d = n - 1, s = 0;
  while (d % 2 === 0) { d /= 2; s++; }
  let x = powmod32(a % n, d, n);
  if (x === 1 || x === n - 1) return true;
  for (let i = 1; i < s; i++) {
    x = mulmod32(x, x, n);
    if (x === n - 1) return true;
    if (x === 1) return false;
  }
  return false;
}
function powmodBig(a, e, m) {
  let r = 1n; a %= m;
  while (e > 0n) {
    if (e & 1n) r = r * a % m;
    e >>= 1n;
    if (e) a = a * a % m;
  }
  return r;
}
// The seven bases of Jim Sinclair: deterministic for every n < 2^64.
const BASES64 = [2n, 325n, 9375n, 28178n, 450775n, 9780504n, 1795265022n];
function mrBig(n) {
  let d = n - 1n, s = 0;
  while ((d & 1n) === 0n) { d >>= 1n; s++; }
  outer: for (const b of BASES64) {
    const a = b % n;
    if (a === 0n) continue;
    let x = powmodBig(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    for (let i = 1; i < s; i++) {
      x = x * x % n;
      if (x === n - 1n) continue outer;
      if (x === 1n) return false;
    }
    return false;
  }
  return true;
}

// Is n prime? n is a safe integer (Number) or a BigInt below 2^64.
// Trial division by the primes below 200 first, then Miller-Rabin.
export function isPrime(n) {
  if (typeof n === 'bigint') {
    if (n <= BigInt(Number.MAX_SAFE_INTEGER)) return isPrime(Number(n));
    for (let i = 0; i < 46; i++) if (n % BigInt(SMALL[i]) === 0n) return false;
    return mrBig(n);
  }
  if (n < 2 || n !== Math.floor(n)) return false;
  for (let i = 0; i < 46; i++) {                     // the primes below 200
    const p = SMALL[i];
    if (n === p) return true;
    if (n % p === 0) return false;
  }
  if (n < 40000) return true;                         // 199^2 = 39601
  if (n < 4294967296) return mr32(n, 2) && mr32(n, 7) && mr32(n, 61);
  return mrBig(BigInt(n));
}

// Miller-Rabin with only the given base (for the pseudoprime tests).
export function strongProbable(n, base) {
  if (n < 4294967296) return mr32(n, base);
  const N = BigInt(n);
  let d = N - 1n, s = 0;
  while ((d & 1n) === 0n) { d >>= 1n; s++; }
  let x = powmodBig(BigInt(base) % N, d, N);
  if (x === 1n || x === N - 1n) return true;
  for (let i = 1; i < s; i++) { x = x * x % N; if (x === N - 1n) return true; }
  return false;
}

// --- factorisation -----------------------------------------------------------
function gcdBig(a, b) { while (b) { [a, b] = [b, a % b]; } return a; }
// Pollard rho with Brent's cycle method, for a composite n (BigInt).
function rho(n) {
  if (n % 2n === 0n) return 2n;
  for (let c = 1n; c < 64n; c++) {
    let y = 2n, x = 2n, g = 1n, q = 1n, ys = 2n, r = 1, m = 128;
    const f = v => (v * v + c) % n;
    do {
      x = y;
      for (let i = 0; i < r; i++) y = f(y);
      let k = 0;
      do {
        ys = y;
        for (let i = 0; i < Math.min(m, r - k); i++) { y = f(y); q = q * (x > y ? x - y : y - x) % n; }
        g = gcdBig(q, n); k += m;
      } while (k < r && g === 1n);
      r *= 2;
    } while (g === 1n && r < (1 << 22));
    if (g === n) {
      do { ys = f(ys); g = gcdBig(x > ys ? x - ys : ys - x, n); } while (g === 1n);
    }
    if (g !== n && g !== 1n) return g;
  }
  return n;
}
// The prime factors of n (safe integer >= 1) as [[p, e], ...], p rising.
export function factor(n) {
  const out = [];
  if (n < 2) return out;
  for (let i = 0; i < SMALL.length; i++) {
    const p = SMALL[i];
    if (p * p > n) break;
    if (n % p === 0) { let e = 0; while (n % p === 0) { n /= p; e++; } out.push([p, e]); }
  }
  if (n > 1) {
    if (n < 65536 * 65536 || isPrime(n)) out.push([n, 1]);
    else {
      // n has no factor below 2^16 and is composite: split with rho.
      const stack = [BigInt(n)], big = [];
      while (stack.length) {
        const m = stack.pop();
        if (isPrime(m)) { big.push(Number(m)); continue; }
        const d = rho(m);
        stack.push(d, m / d);
      }
      big.sort((a, b) => a - b);
      for (const p of big) { const l = out[out.length - 1]; if (l && l[0] === p) l[1]++; else out.push([p, 1]); }
    }
  }
  return out;
}
export const divisorsOf = f => f.reduce((a, [, e]) => a * (e + 1), 1);
export const totientOf = (n, f) => f.reduce((a, [p]) => a / p * (p - 1), n);
// "2^3 · 3 · 7" (with Unicode superscripts).
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export function factorText(n) {
  if (n < 2) return String(n);
  return factor(n).map(([p, e]) => p + (e > 1 ? String(e).split('').map(d => SUP[d]).join('') : '')).join(' · ');
}

// --- prime counting estimates -----------------------------------------------
// li(x) by the series of Ramanujan; |error| < 1e-9 relative for x > 2.
export function li(x) {
  if (x <= 1) return -Infinity;
  const L = Math.log(x), g = 0.5772156649015329;
  let sum = 0, term = 1, inner = 0;
  for (let n = 1; n < 200; n++) {
    term *= L / n;                                    // L^n / n!
    if (((n - 1) & 1) === 0) inner += 1 / (2 * Math.floor((n - 1) / 2) + 1);
    const t = (n & 1 ? 1 : -1) * term / 2 ** (n - 1) * inner;
    sum += t;
    if (Math.abs(t) < 1e-17 * Math.abs(sum)) break;
  }
  return g + Math.log(L) + Math.sqrt(x) * sum;
}
// Known pi(10^k) values, k = 1..12.
export const PI_POW10 = [4, 25, 168, 1229, 9592, 78498, 664579, 5761455, 50847534, 455052511, 4118054813, 37607912018];

// --- arithmetic tables (n < 2^23) ------------------------------------------
// spf[n]: the smallest prime factor of n, or 0 when n is prime (or < 2).
// Uint16 is enough: a composite n < 2^32 has a factor below 2^16.
export function spfTable(N) {
  const spf = new Uint16Array(N);
  for (let i = 2; i * i < N; i++) {
    if (spf[i]) continue;
    for (let j = i * i; j < N; j += i) if (!spf[j]) spf[j] = i;
  }
  return spf;
}
// The prime index of each small prime (2 -> 1, 3 -> 2, 5 -> 3, ...).
const PIDX = (() => { const m = new Uint16Array(65536); SMALL.forEach((p, i) => { m[p] = i + 1; }); return m; })();

// MODES: the meaning of a class byte per highlight mode. The shader in
// glsl.js reads the same numbers (grep "MODE_").
export const MODE = { primes: 0, twin: 1, cousin: 2, sexy: 3, sophie: 4, gauss: 5, eisen: 6, divisors: 7, spf: 8, totient: 9, figurate: 10 };
export const ARITH_MODES = [MODE.divisors, MODE.spf, MODE.totient];
export const UNKNOWN = 255;

// The byte of n for an arithmetic mode, from its factorisation.
export function arithByte(mode, n, f) {
  if (n < 2) return mode === MODE.totient ? 251 : 0;
  if (mode === MODE.divisors) return Math.min(254, divisorsOf(f));
  if (mode === MODE.spf) { if (f.length === 1 && f[0][1] === 1) return 254; return Math.min(253, f[0][0] < 65536 ? PIDX[f[0][0]] : 253); }
  return 1 + Math.round(totientOf(n, f) / n * 250);
}
// The class bytes of n = 0 .. N - 1 for one arithmetic mode, from spf.
export function arithBytes(mode, spf) {
  const N = spf.length, out = new Uint8Array(N);
  if (mode === MODE.divisors) {
    // d(n) = d(m) * (e + 1) / e when n = p * m and p | m with exponent e.
    const d = new Uint16Array(N), e = new Uint8Array(N);
    d[1] = 1;
    for (let n = 2; n < N; n++) {
      const p = spf[n] || n, m = n / p;
      if (m % p === 0) { e[n] = e[m] + 1; d[n] = d[m] / (e[m] + 1) * (e[n] + 1); }
      else { e[n] = 1; d[n] = d[m] * 2; }
      out[n] = Math.min(254, d[n]);
    }
    out[1] = 1;
  } else if (mode === MODE.spf) {
    for (let n = 2; n < N; n++) out[n] = spf[n] ? Math.min(253, PIDX[spf[n]]) : 254;
  } else {
    // phi(n)/n is the product of (1 - 1/p) over the distinct primes p | n.
    const r = new Float32Array(N);
    r[1] = 1; out[0] = 251; out[1] = 251;
    for (let n = 2; n < N; n++) {
      const p = spf[n] || n, m = n / p;
      r[n] = m % p === 0 ? r[m] : r[m] * (1 - 1 / p);
      out[n] = 1 + Math.round(r[n] * 250);
    }
  }
  return out;
}

// --- one number, any mode ----------------------------------------------------
// prime(n) is the primality oracle (bitset or Miller-Rabin). Lattice modes
// (gauss, eisen) take the lattice point (a, b), not n.
const isSq = v => { if (v < 0) return false; const s = Math.round(Math.sqrt(v)); return s * s === v; };
export const FIB = (() => { const f = [1, 2]; while (f[f.length - 1] < 2 ** 53) f.push(f[f.length - 1] + f[f.length - 2]); return new Set(f); })();
export function classify(mode, n, prime, a = 0, b = 0) {
  if (mode === MODE.gauss) return gaussPrime(a, b, prime) ? 1 : 0;
  if (mode === MODE.eisen) return eisensteinPrime(a, b, prime) ? 1 : 0;
  if (mode === MODE.figurate) {
    let v = 0;
    if (isSq(n)) v |= 1;
    if (isSq(8 * n + 1)) v |= 2;
    if (FIB.has(n)) v |= 4;
    if (prime(n)) v |= 8;
    return v;
  }
  if (mode >= MODE.divisors) return arithByte(mode, n, factor(n));
  if (n < 2) return n === 1 ? 2 : 0;
  if (!prime(n)) return 0;
  const gap = { 1: 2, 2: 4, 3: 6 }[mode];
  if (gap) return (prime(n - gap) || prime(n + gap)) ? 3 : 1;
  if (mode === MODE.sophie) {
    const sg = prime(2 * n + 1), safe = n > 2 && prime((n - 1) / 2);
    return sg && safe ? 5 : safe ? 4 : sg ? 3 : 1;
  }
  return 1;
}
// Gaussian prime a + bi: norm a^2 + b^2 is prime, or one part is zero and
// the other is +-p with p = 3 mod 4.
export function gaussPrime(a, b, prime) {
  a = Math.abs(a); b = Math.abs(b);
  if (a === 0) return b % 4 === 3 && prime(b);
  if (b === 0) return a % 4 === 3 && prime(a);
  return prime(a * a + b * b);
}
// Eisenstein prime a + b w (w = e^(2 pi i / 3)): norm a^2 - ab + b^2 is
// prime, or the norm is p^2 with p = 2 mod 3 (then the point is a unit
// times p: a = 0, b = 0 or a = b).
export function eisensteinPrime(a, b, prime) {
  const N = a * a - a * b + b * b;
  if (N < 2) return false;
  if (prime(N)) return true;
  if (a !== 0 && b !== 0 && a !== b) return false;
  const p = Math.round(Math.sqrt(N));
  return p * p === N && p % 3 === 2 && prime(p);
}

// --- prime-generating quadratics ---------------------------------------------
function legendre(D, p) {                             // D mod p, p odd prime
  const v = powmod32(D, (p - 1) / 2, p);
  return v === 0 ? 0 : v === 1 ? 1 : -1;
}
const mod = (x, m) => ((x % m) + m) % m;
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; }
let QP = null;                                        // primes to QP_MAX for the product
const QP_MAX = 2000000;
function quadPrimes() {
  if (QP) return QP;
  const bits = sieveOdd(QP_MAX), out = [2];
  for (let n = 3; n <= QP_MAX; n += 2) if (bitPrime(bits, n)) out.push(n);
  return (QP = Int32Array.from(out));
}
// The Bateman-Horn constant of f(n) = a n^2 + b n + c (integers, a >= 0):
//   C(f) = prod over primes p of (1 - w(p)/p) / (1 - 1/p),
// w(p) = the number of roots of f mod p. The product runs to P (2e6 at
// most), so C carries about 0.2% error. The expected number of primes
// among f(0..N-1) is then C * sum 1/ln f(n). For f = n^2 + n + 41,
// C = 6.6395 (twice the Hardy-Littlewood value 3.3198).
// Returns { C, reducible, fixed } — fixed: a prime p with w(p) = p (every
// value is divisible by p, so f gives finitely many primes).
export function quadConstant(a, b, c, P = QP_MAX) {
  const ps = quadPrimes(), D = b * b - 4 * a * c;
  const reducible = a !== 0 && isSq(D);
  if (gcd(gcd(a, b), c) > 1) return { C: 0, reducible, fixed: gcd(gcd(a, b), c) };
  let C = 1, fixed = 0;
  for (let i = 0; i < ps.length && ps[i] <= P; i++) {
    const p = ps[i];
    let w;
    if (p < 64 || a % p === 0) {
      w = 0;
      if (p < 64) { for (let x = 0; x < p; x++) if (mod(mod(a, p) * x * x + mod(b, p) * x + mod(c, p), p) === 0) w++; }
      else if (mod(b, p) !== 0) w = 1;
      else w = mod(c, p) === 0 ? p : 0;
    } else {
      const Dp = mod(mod(mulmod32(mod(b, p), mod(b, p), p) - mulmod32(mulmod32(4, mod(a, p), p), mod(c, p), p), p), p);
      w = Dp === 0 ? 1 : 1 + legendre(Dp, p);
    }
    if (w === p) { fixed = p; C = 0; break; }
    C *= (1 - w / p) / (1 - 1 / p);
  }
  return { C, reducible, fixed };
}
// Count the primes among f(n), n = 0 .. N-1, and the Bateman-Horn
// expectation. prime() is the oracle; values below 2 are skipped.
export function quadDensity(a, b, c, N, prime, Cinfo = quadConstant(a, b, c)) {
  let obs = 0, exp = 0, terms = 0;
  for (let n = 0; n < N; n++) {
    const v = a * n * n + b * n + c;
    if (v < 2) continue;
    if (!Number.isSafeInteger(v)) break;
    terms++;
    if (prime(v)) obs++;
    exp += 1 / Math.log(v);
  }
  return { observed: obs, expected: Cinfo.C * exp, C: Cinfo.C, terms, ratio: exp > 0 ? obs / (Cinfo.C * exp) : 0, reducible: Cinfo.reducible, fixed: Cinfo.fixed };
}
// A short text form "4n² − 2n + 41".
export function quadText(a, b, c, v = 'n') {
  const t = [];
  const term = (k, s) => { if (!k) return; const sg = k < 0 ? '−' : '+'; const m = Math.abs(k); t.push([sg, (m === 1 && s ? '' : m) + s]); };
  term(a, v + '²'); term(b, v); term(c, '');
  if (!t.length) return '0';
  return t.map(([s, x], i) => (i ? ` ${s} ` : s === '−' ? '−' : '') + x).join('');
}

// ============================================================================
//  ALPHA QUDITS  ·  model/exact.js  ·  exact numbers in Q(sqrt2, sqrt3) (MODEL)
// ----------------------------------------------------------------------------
//  A number of the field is (a + b sqrt2 + c sqrt3 + d sqrt6) / D with
//  integer a, b, c, d and D > 0. Digits come from BigInt integer square
//  roots with a lower and an upper bound. A digit string is returned only
//  when both bounds give the same digits, so every printed digit is exact
//  (truncated, not rounded).
//
//  grep -n targets:  export function isqrt | gcd | sqrtSplit | fieldFloat |
//  fieldDigits | inverseDigits | reduceFraction | fieldTex
// ============================================================================

export function isqrt(n) {
  n = BigInt(n);
  if (n < 0n) throw new Error('isqrt: negative');
  if (n < 2n) return n;
  // Newton from above: x0 = 2^ceil(bits/2) >= sqrt(n); x falls to floor.
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

export function gcd(a, b) {
  a = a < 0 ? -a : a; b = b < 0 ? -b : b;
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}
function bgcd(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { const t = a % b; a = b; b = t; } return a; }

export function reduceFraction(num, den) {
  const g = gcd(num, den) || 1;
  return { num: num / g, den: den / g, text: `${num / g}/${den / g}` };
}

// sqrt(k) = s * sqrt(f) with f square-free. Returns { s, f }.
export function sqrtSplit(k) {
  let s = 1, f = k;
  for (let p = 2; p * p <= f; p++) while (f % (p * p) === 0) { f /= p * p; s *= p; }
  return { s, f };
}

export function fieldFloat({ a, b, c, d }, D) {
  return (a + b * Math.SQRT2 + c * Math.sqrt(3) + d * Math.sqrt(6)) / D;
}

// Bounds on (a + b sqrt2 + c sqrt3 + d sqrt6) * S as BigInt [lo, hi].
function scaledBounds({ a, b, c, d }, S) {
  let lo = BigInt(a) * S, hi = lo;
  for (const [co, k] of [[b, 2n], [c, 3n], [d, 6n]]) {
    if (!co) continue;
    const r = isqrt(k * S * S), C = BigInt(co);
    if (C > 0n) { lo += C * r; hi += C * (r + 1n); } else { lo += C * (r + 1n); hi += C * r; }
  }
  return [lo, hi];
}

function fmt(q, n, neg) {
  const s = q.toString().padStart(n + 1, '0');
  const ip = s.slice(0, s.length - n), fp = s.slice(s.length - n);
  return (neg ? '-' : '') + ip + (n ? '.' + fp : '');
}

// Digits of x = (a + b sqrt2 + c sqrt3 + d sqrt6) / D, n after the point.
export function fieldDigits(num, D, n = 30) {
  for (let guard = 12; guard < 200; guard += 20) {
    const S = 10n ** BigInt(n + guard);
    const [lo, hi] = scaledBounds(num, S);
    const P = 10n ** BigInt(n), DD = BigInt(D) * S;
    const qlo = floorDiv(lo * P, DD), qhi = floorDiv(hi * P, DD);
    if (qlo === qhi) return qlo < 0n ? fmt(-qlo, n, true) : fmt(qlo, n, false);
  }
  throw new Error('fieldDigits: bounds did not meet');
}

// Digits of 1/x = D / (a + b sqrt2 + c sqrt3 + d sqrt6), n after the point.
export function inverseDigits(num, D, n = 30) {
  for (let guard = 12; guard < 200; guard += 20) {
    const S = 10n ** BigInt(n + guard);
    const [lo, hi] = scaledBounds(num, S);
    if (lo <= 0n) throw new Error('inverseDigits: needs a positive number');
    const P = 10n ** BigInt(n), top = BigInt(D) * S * P;
    const qlo = top / hi, qhi = top / lo;
    if (qlo === qhi) return fmt(qlo, n, false);
  }
  throw new Error('inverseDigits: bounds did not meet');
}
function floorDiv(a, b) { const q = a / b; return (a % b !== 0n && ((a < 0n) !== (b < 0n))) ? q - 1n : q; }

// Is (a + b sqrt2 + c sqrt3 + d sqrt6)/D inside [lo, hi] (decimal strings)?
// Exact: compares with BigInt bounds at 40 digits; 'edge' when undecided.
export function fieldInWindow(num, D, loStr, hiStr, digits = 40) {
  const S = 10n ** BigInt(digits);
  const [vlo, vhi] = scaledBounds(num, S);
  const toS = str => decToScaled(str, digits) * BigInt(D);
  const L = toS(loStr), H = toS(hiStr);
  if (vlo >= L && vhi <= H) return true;
  if (vhi < L || vlo > H) return false;
  return 'edge';
}
export function decToScaled(str, digits) {
  const neg = str.startsWith('-'); if (neg) str = str.slice(1);
  const [ip, fp = ''] = str.split('.');
  const v = BigInt(ip + fp.padEnd(digits, '0').slice(0, digits));
  return neg ? -v : v;
}

// TeX of (a + b sqrt2 + c sqrt3 + d sqrt6) / D.
export function fieldTex({ a, b, c, d }, D) {
  const parts = [];
  const push = (co, rad) => {
    if (!co) return;
    const mag = Math.abs(co), sign = co < 0 ? '-' : (parts.length ? '+' : '');
    const body = rad ? (mag === 1 ? '' : mag) + `\\sqrt{${rad}}` : String(mag);
    parts.push(sign + body);
  };
  push(a, 0); push(b, 2); push(c, 3); push(d, 6);
  return `\\frac{${parts.join(' ') || '0'}}{${D}}`;
}

export { bgcd };

// ============================================================================
//  RAMANUJAN PI  ·  engine.js — exact pi series in BigInt  (DOM-free)
// ----------------------------------------------------------------------------
//  Every number here is an integer. A value v with W decimals is the
//  BigInt v * 10^W ("fixed point at W"). Nothing uses floating point,
//  except the log10 estimates for the charts.
//
//  THE SERIES. A Ramanujan-Sato series has the form
//      1/pi = pref * sum_k  sign^k * s(k) * (A k + B) / C^k
//  with an integer sequence s(k). SERIES holds eight of them from the
//  Wikipedia article "Ramanujan-Sato series" (levels 1A to 10A), and two
//  older series to race against (Leibniz, Machin). The article writes
//  most of them with (-C)^(k+1/2) and a factor i. Here the square root is
//  taken, so each series has real terms and a real prefactor
//      pref = u / (v sqrt R)   (root 'den')
//      pref = u sqrt R / v     (root 'num')
//      pref = u / v            (root 'rat')
//
//  TWO WAYS TO SUM.
//    partials()   term by term at fixed point: the value of pi after each
//                 term, for the race, the digit stream and the anatomy.
//    splitSum()   binary splitting for the hypergeometric series (1A, 2A,
//                 3A, 4A): exact integers P, Q, T over a range of terms,
//                 so 100000 digits need one big division at the end.
//
//  EXPORTS   (jump with grep -n "<anchor>" engine.js)
//      SERIES ........... "export const SERIES"       the series table
//      seqIter .......... "export function seqIter"   s(0), s(1), ... exact
//      isqrt ............ "export function isqrt"     floor(sqrt(n))
//      log10Big ......... "export function log10Big"  log10 |n| as a float
//      piFromSum ........ "export function piFromSum" pi from a sum T/Q
//      partials ......... "export function partials"  pi after each term
//      correctDigits .... "export function correctDigits"  -log10 |error|
//      lockMap .......... "export function lockMap"   the term that fixed each digit
//      splitSum ......... "export function splitSum"  binary splitting
//      piDigits ......... "export function piDigits"  pi to D decimals
//      machinDigits ..... "export function machinDigits"  pi by Machin
//      anatomy .......... "export function anatomy"   log sizes of one term
//      termsFor ......... "export function termsFor"  terms for D digits
// ============================================================================

const big = BigInt;

// --- sequences ----------------------------------------------------------------
// A hypergeometric sequence: s(k) = s(k-1) * num(k) / den(k), exact.
function hyper(num, den) {
  return () => { let k = -1, s = 1n; return () => { k++; if (k > 0) s = s * num(big(k)) / den(big(k)); return s; }; };
}
// The central binomial coefficient C(2k, k) times a sequence a(k) with
// L(n) a(n) = P(n) a(n-1) + Q(n) a(n-2), a(0) = 1, a(1) = a1. With
// central = false, a(k) alone.
function rec2(a1, L, P, Q, central) {
  return () => {
    let k = -1, a0 = 0n, a = 1n, cb = 1n;
    return () => {
      k++;
      if (k === 1) { a0 = a; a = a1; }
      else if (k > 1) {
        const n = big(k), num = P(n) * a + Q(n) * a0;
        a0 = a; a = num / L(n);
        if (a * L(n) !== num) throw new Error('recurrence is not exact at k = ' + k);
      }
      if (k > 0 && central) cb = cb * big(2 * k) * big(2 * k - 1) / (big(k) * big(k));
      return central ? cb * a : a;
    };
  };
}
const n2 = n => n * n, n3 = n => n * n * n;

// --- the table ------------------------------------------------------------------
// Fields:
//   id, level, name, who      labels (who: from the article)
//   kind                      'rs' (Ramanujan-Sato) or 'base'
//   A, B, C, sign             the term sign^k s(k) (A k + B) / C^k
//   pref { u, v, R, root }    see the header
//   seq                       a factory: seq()() gives s(0), s(1), ...
//   split { p, q }            hypergeometric ratio for splitSum: the term
//                             ratio is p(k) / q(k) with sign and C inside
//   rate                      digits per term in the limit:
//                             log10(C / lim |s(k+1)/s(k)|)
//   tex, seqTex               TeX with the colour classes of the page
//   cite                      the line of the article it comes from
// Colour classes (lib/sci.css): m1 s(k), m2 A k + B, m3 C^k, m4 the sign,
// m5 the prefactor.
const SUM = '\\sum_{k=0}^{\\infty}';
const SGN = '\\class{m4}{(-1)^{k}}\\,';
export const SERIES = [
  {
    id: 'l1a', level: '1A', name: 'Chudnovsky', who: 'Chudnovsky brothers, proved 1989', kind: 'rs',
    A: 545140134n, B: 13591409n, C: 640320n ** 3n, sign: -1n,
    pref: { u: 12n, v: 640320n, R: 640320n, root: 'den' },
    seq: hyper(k => (6n * k - 5n) * (6n * k - 4n) * (6n * k - 3n) * (6n * k - 2n) * (6n * k - 1n) * (6n * k), k => (3n * k - 2n) * (3n * k - 1n) * (3n * k) * k * k * k),
    split: { p: k => -(6n * k - 5n) * (2n * k - 1n) * (6n * k - 1n), q: k => k * k * k * 10939058860032000n },
    rate: 14.181647462725477,
    tex: `\\frac{1}{\\pi}=\\class{m5}{\\frac{12}{640320^{3/2}}}${SUM}${SGN}\\class{m1}{\\frac{(6k)!}{(3k)!\\,(k!)^{3}}}\\,\\frac{\\class{m2}{545140134\\,k+13591409}}{\\class{m3}{640320^{3k}}}`,
    seqTex: 's_{1A}(k)=\\binom{2k}{k}\\binom{3k}{k}\\binom{6k}{3k}',
    note: '545140134 = 163 · 3344418 and j((1 + √−163)/2) = −640320³.',
  },
  {
    id: 'l2a', level: '2A', name: 'Ramanujan 1914', who: 'Ramanujan, 1914', kind: 'rs',
    A: 26390n, B: 1103n, C: 396n ** 4n, sign: 1n,
    pref: { u: 2n, v: 9801n, R: 2n, root: 'num' },
    seq: hyper(k => (4n * k - 3n) * (4n * k - 2n) * (4n * k - 1n) * (4n * k), k => k * k * k * k),
    split: { p: k => (4n * k - 3n) * (2n * k - 1n) * (4n * k - 1n), q: k => k * k * k * 3073907232n },
    rate: 7.982541746,
    tex: `\\frac{1}{\\pi}=\\class{m5}{\\frac{2\\sqrt{2}}{9801}}${SUM}\\class{m1}{\\frac{(4k)!}{(k!)^{4}}}\\,\\frac{\\class{m2}{26390\\,k+1103}}{\\class{m3}{396^{4k}}}`,
    seqTex: 's_{2A}(k)=\\binom{2k}{k}^{2}\\binom{4k}{2k}',
    note: '9801 = 99², 26390 = 58 · 455 and j₂A(√−58 / 2) = 396⁴.',
  },
  {
    id: 'l3a', level: '3A', name: 'Level 3A', who: 'Ramanujan’s family (levels 1–4A)', kind: 'rs',
    A: 14151n, B: 827n, C: 300n ** 3n, sign: -1n,
    pref: { u: 2n, v: 300n, R: 300n, root: 'den' },
    seq: hyper(k => (2n * k - 1n) * (2n * k) * (3n * k - 2n) * (3n * k - 1n) * (3n * k), k => k * k * k * k * k),
    split: { p: k => -(2n * k - 1n) * (3n * k - 2n) * (3n * k - 1n) * 6n, q: k => k * k * k * 27000000n },
    rate: 5.397940009,
    tex: `\\frac{1}{\\pi}=\\class{m5}{\\frac{2}{300^{3/2}}}${SUM}${SGN}\\class{m1}{\\binom{2k}{k}^{2}\\binom{3k}{k}}\\,\\frac{\\class{m2}{14151\\,k+827}}{\\class{m3}{300^{3k}}}`,
    seqTex: 's_{3A}(k)=\\binom{2k}{k}^{2}\\binom{3k}{k}',
    note: '14151 = 267 · 53 and j₃A((3 + √−267)/6) = −300³.',
  },
  {
    id: 'l4a', level: '4A', name: 'Level 4A', who: 'Ramanujan’s family (levels 1–4A)', kind: 'rs',
    A: 6n, B: 1n, C: 512n, sign: -1n,
    pref: { u: 1n, v: 2n, R: 2n, root: 'den' },
    seq: hyper(k => ((2n * k - 1n) * 2n * k) ** 3n, k => k ** 6n),
    split: { p: k => -((2n * k - 1n) ** 3n) * 8n, q: k => k * k * k * 512n },
    rate: 0.903089987,
    tex: `\\frac{1}{\\pi}=\\class{m5}{\\frac{1}{2\\sqrt{2}}}${SUM}${SGN}\\class{m1}{\\binom{2k}{k}^{3}}\\,\\frac{\\class{m2}{6k+1}}{\\class{m3}{512^{k}}}`,
    seqTex: 's_{4A}(k)=\\binom{2k}{k}^{3}',
    note: 'j₄A((1 + √−4)/2) = −2⁹ = −512.',
  },
  {
    id: 'l5a', level: '5A', name: 'Level 5A', who: 'H. H. Chan and S. Cooper, 2012', kind: 'rs',
    A: 682n, B: 71n, C: 15228n, sign: -1n,
    pref: { u: 5n, v: 162n, R: 47n, root: 'den' },
    // Apery-like numbers A005258: n^2 a(n) = (11n^2 - 11n + 3) a(n-1) + (n-1)^2 a(n-2)
    seq: rec2(3n, n2, n => 11n * n * n - 11n * n + 3n, n => (n - 1n) * (n - 1n), true),
    rate: 2.535546,
    tex: `\\frac{1}{\\pi}=\\class{m5}{\\frac{5}{162\\sqrt{47}}}${SUM}${SGN}\\class{m1}{s_{5A}(k)}\\,\\frac{\\class{m2}{682\\,k+71}}{\\class{m3}{15228^{k}}}`,
    seqTex: 's_{5A}(k)=\\binom{2k}{k}\\sum_{j=0}^{k}\\binom{k}{j}^{2}\\binom{k+j}{j}',
    note: '15228 = (18√47)² and j₅A((5 + √−235)/10) = −15228.',
  },
  {
    id: 'l6a', level: '6A', name: 'Level 6A', who: 'Chan, Tanigawa, Yang and Zudilin (level 6A)', kind: 'rs',
    A: 561n, B: 53n, C: 39200n, sign: 1n,
    pref: { u: 3n, v: 1225n, R: 6n, root: 'num' },
    // Franel numbers: n^2 f(n) = (7n^2 - 7n + 2) f(n-1) + 8 (n-1)^2 f(n-2)
    seq: rec2(2n, n2, n => 7n * n * n - 7n * n + 2n, n => 8n * (n - 1n) * (n - 1n), true),
    rate: 3.088136,
    tex: `\\frac{1}{\\pi}=\\class{m5}{\\frac{3\\sqrt{6}}{1225}}${SUM}\\class{m1}{\\alpha_{1}(k)}\\,\\frac{\\class{m2}{561\\,k+53}}{\\class{m3}{39200^{k}}}`,
    seqTex: '\\alpha_{1}(k)=\\binom{2k}{k}\\sum_{j=0}^{k}\\binom{k}{j}^{3}',
    note: '561 = 51 · 11 and j₆A(√(−17/6)) = 198² − 4 = 39200.',
  },
  {
    id: 'l7a', level: '7A', name: 'Level 7A', who: 'S. Cooper, 2012', kind: 'rs',
    A: 11895n, B: 1286n, C: 10648n, sign: -1n,
    // n^3 a(n) = (2n - 1)(13n^2 - 13n + 4) a(n-1) + 3(n-1)(3n-4)(3n-2) a(n-2)
    pref: { u: 1n, v: 10648n, R: 7n, root: 'num' },
    seq: rec2(4n, n3, n => (2n * n - 1n) * (13n * n * n - 13n * n + 4n), n => 3n * (n - 1n) * (3n * n - 4n) * (3n * n - 2n), false),
    rate: 2.595166,
    tex: `\\frac{1}{\\pi}=\\class{m5}{\\frac{\\sqrt{7}}{22^{3}}}${SUM}${SGN}\\class{m1}{s_{7A}(k)}\\,\\frac{\\class{m2}{11895\\,k+1286}}{\\class{m3}{(22^{3})^{k}}}`,
    seqTex: 's_{7A}(k)=\\sum_{j=0}^{k}\\binom{k}{j}^{2}\\binom{2j}{k}\\binom{k+j}{j}',
    note: '22³ = 10648 and j₇A((7 + √−427)/14) = −22³ + 1.',
  },
  {
    id: 'l10a', level: '10A', name: 'Level 10A', who: 'level 10 (Y. Yang; H. H. Chan and S. Cooper)', kind: 'rs',
    A: 408n, B: 47n, C: 5776n, sign: 1n,
    pref: { u: 5n, v: 76n, R: 95n, root: 'den' },
    // sum of fourth powers A005260:
    // n^3 b(n) = 2(2n - 1)(3n^2 - 3n + 1) b(n-1) + 4(n-1)(4n-5)(4n-3) b(n-2)
    seq: rec2(2n, n3, n => 2n * (2n * n - 1n) * (3n * n * n - 3n * n + 1n), n => 4n * (n - 1n) * (4n * n - 5n) * (4n * n - 3n), false),
    rate: 2.557507,
    tex: `\\frac{1}{\\pi}=\\class{m5}{\\frac{5}{76\\sqrt{95}}}${SUM}\\class{m1}{\\beta_{1}(k)}\\,\\frac{\\class{m2}{408\\,k+47}}{\\class{m3}{5776^{k}}}`,
    seqTex: '\\beta_{1}(k)=\\sum_{j=0}^{k}\\binom{k}{j}^{4}',
    note: '5776 = 76² and j₁₀A(√(−19/10)) = 76².',
  },
  {
    id: 'machin', level: '', name: 'Machin', who: 'John Machin, 1706', kind: 'base',
    rate: 1.397940009,
    tex: '\\frac{\\pi}{4}=4\\arctan\\frac{1}{5}-\\arctan\\frac{1}{239},\\quad \\arctan\\frac{1}{x}=\\sum_{k=0}^{\\infty}\\frac{\\class{m4}{(-1)^{k}}}{\\class{m2}{(2k+1)}\\,\\class{m3}{x^{2k+1}}}',
    seqTex: '',
    note: 'One term here is term k of both arctangent series.',
  },
  {
    id: 'leibniz', level: '', name: 'Leibniz', who: 'Madhava (c. 1400), Leibniz (1674)', kind: 'base',
    rate: 0,
    tex: `\\frac{\\pi}{4}=${SUM}\\frac{\\class{m4}{(-1)^{k}}}{\\class{m2}{2k+1}}`,
    seqTex: '',
    note: 'The error after n terms is about 1/n, so each new digit costs ten times the terms.',
  },
];
export const byId = id => SERIES.find(s => s.id === id);

// The sequence s(0), s(1), ... of a series, as a function that gives the
// next value at each call.
export function seqIter(S) { return S.seq(); }

// --- integer tools -------------------------------------------------------------
export function bitLength(n) {
  if (n < 0n) n = -n;
  if (n === 0n) return 0;
  const h = n.toString(16);
  return (h.length - 1) * 4 + (32 - Math.clz32(parseInt(h[0], 16)));
}
// floor(sqrt(n)) for n >= 0. Recursive start: sqrt of the top half of the
// bits, then Newton steps from above. Newton from above goes down to
// floor(sqrt(n)) and stops there.
export function isqrt(n) {
  if (n < 0n) throw new RangeError('isqrt of a negative number');
  if (n < 4503599627370496n) {
    let x = big(Math.floor(Math.sqrt(Number(n))));
    while (x * x > n) x--;
    while ((x + 1n) * (x + 1n) <= n) x++;
    return x;
  }
  const k = big(Math.floor(bitLength(n) / 4));
  let x = (isqrt(n >> (2n * k)) + 1n) << k;
  for (;;) { const y = (x + n / x) >> 1n; if (y >= x) return x; x = y; }
}
// log10 |n| as a float (n !== 0). Uses the top 53 bits only.
export function log10Big(n) {
  if (n < 0n) n = -n;
  const b = bitLength(n);
  if (b <= 1000) return Math.log10(Number(n));
  return Math.log10(Number(n >> big(b - 53))) + (b - 53) * Math.log10(2);
}
export const pow10 = n => 10n ** big(n);

// pi * ONE from the sum T / Q of a series (T / Q = sum, no prefactor).
export function piFromSum(S, T, Q, ONE) {
  const { u, v, R, root } = S.pref;
  if (root === 'den') return v * isqrt(R * ONE * ONE) * Q / (u * T);
  if (root === 'num') return v * Q * ONE * ONE / (u * isqrt(R * ONE * ONE) * T);
  return v * Q * ONE / (u * T);
}

// --- term by term ----------------------------------------------------------------
// pi after each term, at W decimals: out[k-1] = pi_k * 10^W after k terms.
// K terms at most; stop early when stop(k, value) is true. onTerm(k, x)
// is optional (progress). The rounding error is at most a few units of
// 10^-W per term, so callers keep about 12 guard digits.
export function partials(S, K, W, { stop = null, onTerm = null } = {}) {
  const ONE = pow10(W), out = [];
  if (S.id === 'leibniz') {
    let sum = 0n;
    for (let k = 0; k < K; k++) {
      const t = 4n * ONE / big(2 * k + 1);
      sum += k & 1 ? -t : t;
      out.push(sum);
      if (onTerm) onTerm(k + 1, sum);
      if (stop && stop(k + 1, sum)) break;
    }
    return out;
  }
  if (S.id === 'machin') {
    let sum = 0n, p5 = 5n, p239 = 239n;
    for (let k = 0; k < K; k++) {
      const d = big(2 * k + 1), t = 16n * ONE / (d * p5) - 4n * ONE / (d * p239);
      sum += k & 1 ? -t : t;
      p5 *= 25n; p239 *= 57121n;
      out.push(sum);
      if (onTerm) onTerm(k + 1, sum);
      if (stop && stop(k + 1, sum)) break;
    }
    return out;
  }
  const next = seqIter(S);
  let sum = 0n, cp = 1n, sg = 1n;
  const rootR = S.pref.root === 'rat' ? 1n : isqrt(S.pref.R * ONE * ONE);
  const { u, v, root } = S.pref;
  for (let k = 0; k < K; k++) {
    const s = next(), kk = big(k);
    sum += sg * s * (S.A * kk + S.B) * ONE / cp;
    cp *= S.C; sg *= S.sign;
    const x = root === 'den' ? v * rootR * ONE / (u * sum) : root === 'num' ? v * ONE * ONE * ONE / (u * rootR * sum) : v * ONE * ONE / (u * sum);
    out.push(x);
    if (onTerm) onTerm(k + 1, x);
    if (stop && stop(k + 1, x)) break;
  }
  return out;
}

// Correct digits of x against ref (both pi * 10^W): -log10 |x - ref|,
// rounded down, at most cap (cap = W - guard).
export function correctDigits(x, ref, W, cap) {
  let e = x - ref; if (e < 0n) e = -e;
  if (e === 0n) return cap;
  return Math.max(0, Math.min(cap, W - e.toString().length));
}

// The term that fixed each decimal. vals: pi_k * 10^W for k = 1..K.
// refStr: '3' and then at least D decimals. For each decimal p (0-based),
// lock[p] is the first k after which the decimals 1..p+1 of pi_k match
// pi for every later k up to K; 0 if no k. match[k-1] is the length of
// the matched decimal prefix of pi_k (its digits from the point on).
export function lockMap(vals, refStr, W, D) {
  const cut = pow10(W - D), K = vals.length, match = new Int32Array(K), strs = [];
  for (let k = 0; k < K; k++) {
    let x = vals[k] / cut; if (x < 0n) x = 0n;
    const s = x.toString(), n = Math.min(s.length, D + 1);
    let m = 0;
    if (s.length === D + 1) while (m < n && s.charCodeAt(m) === refStr.charCodeAt(m)) m++;
    match[k] = Math.max(0, m - 1);
    strs.push(s.length === D + 1 ? s : s.padStart(D + 1, '0'));
  }
  const lock = new Int32Array(D);
  let run = Infinity;   // min of match over k..K-1
  const minFrom = new Int32Array(K);
  for (let k = K - 1; k >= 0; k--) { run = Math.min(run, match[k]); minFrom[k] = run; }
  let k = 0;
  for (let p = 0; p < D; p++) {
    while (k < K && minFrom[k] <= p) k++;
    lock[p] = k < K ? k + 1 : 0;
  }
  return { lock, match, strs };
}

// --- binary splitting ----------------------------------------------------------------
// The sum over k in [0, n) of a(k) (A k + B), a(k) = prod_{j=1..k} p(j)/q(j),
// as exact integers { T, Q } with sum = T / Q. onProgress(f) gets the part
// of the leaves done, 0..1.
export function splitSum(S, n, onProgress = null) {
  const { p, q } = S.split, A = S.A, Bc = S.B;
  let done = 0, last = 0;
  function bs(a, b) {
    if (b - a === 1) {
      const k = big(a), P = a === 0 ? 1n : p(k), Q = a === 0 ? 1n : q(k);
      done++;
      if (onProgress && done - last > n / 200) { last = done; onProgress(done / n); }
      return [P, Q, P * (A * k + Bc)];
    }
    const m = (a + b) >> 1, [P1, Q1, T1] = bs(a, m), [P2, Q2, T2] = bs(m, b);
    return [P1 * P2, Q1 * Q2, T1 * Q2 + P1 * T2];
  }
  const [, Q, T] = bs(0, n);
  return { T, Q };
}
// Terms for D correct decimals, with two to spare.
export function termsFor(S, D) { return Math.ceil(D / S.rate) + 2; }

// pi to D decimals by binary splitting of series S (a hypergeometric one).
// Returns '3' and D decimals. onStage(name, f) reports progress.
export function piDigits(D, S = SERIES[0], onStage = null) {
  const W = D + 10, ONE = pow10(W);
  const n = termsFor(S, W);
  const { T, Q } = splitSum(S, n, f => onStage && onStage('series', f));
  if (onStage) onStage('root', 0);
  const x = piFromSum(S, T, Q, ONE);
  if (onStage) onStage('decimal', 0);
  return (x / pow10(W - D)).toString();
}

// pi to D decimals by Machin: pi = 16 atan(1/5) - 4 atan(1/239).
export function machinDigits(D) {
  const W = D + 10, ONE = pow10(W);
  const atanInv = x => {
    const x2 = x * x;
    let t = ONE / x, s = t, k = 1n, sg = -1n;
    while (t !== 0n) { t /= x2; const d = t / (2n * k + 1n); s += sg * d; sg = -sg; k++; }
    return s;
  };
  return ((16n * atanInv(5n) - 4n * atanInv(239n)) / pow10(W - D)).toString();
}

// --- anatomy of one term ----------------------------------------------------------------
// log10 of each factor of term k of a Ramanujan-Sato series: s(k), A k + B,
// C^k, the prefactor, and the product (the size of the term in 1/pi).
// s is the exact s(k) (pass it in when the caller iterates the sequence).
export function anatomy(S, k, s) {
  const { u, v, R, root } = S.pref;
  const lp = Math.log10(Number(u)) - Math.log10(Number(v)) + (root === 'den' ? -0.5 : root === 'num' ? 0.5 : 0) * Math.log10(Number(R));
  const ls = s === 0n ? -Infinity : log10Big(s), ll = log10Big(S.A * big(k) + S.B), lc = k * Math.log10(Number(S.C));
  return { s, ls, ll, lc, lp, lt: lp + ls + ll - lc, neg: (S.sign < 0n && k % 2 === 1) !== (s < 0n) };
}

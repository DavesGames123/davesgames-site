// ============================================================================
//  ALPHA QUDITS  ·  model/look-elsewhere.js  ·  how many closed forms land? (MODEL)
// ----------------------------------------------------------------------------
//  Counts the numbers x = (a + b sqrt2 + c sqrt3 + d sqrt6) / D, with
//  integers 0 <= a, b, c, d <= coeffMax and D in a set of denominators,
//  whose inverse lies within `window` CODATA 2022 standard deviations of
//  137.035999177. This is a look-elsewhere count: it asks how many
//  numbers of the same shape a search of that size would find in the
//  window, not whether the paper searched.
//
//  Method: for each tuple (a, b, c, d) only the denominator nearest to
//  s / alpha can put s / D in a window this narrow, so the loop is over
//  tuples, not over D. Each hit is then checked exactly with BigInt digits
//  (exact.js). A hit counts once per value: tuples with a common factor
//  with D repeat a smaller tuple and are counted in `tuples` only.
//  `expected` is the number of tuples that would land if the values were
//  spread at the same density with no structure: the sum over tuples of
//  s (1/alpha_lo - 1/alpha_hi) for the tuples whose nearest D is allowed.
//
//  lookElsewhereSteps(params) is a generator (one step per value of a)
//  for the worker (le-worker.js); lookElsewhere(params) runs it to the end.
//
//  grep -n targets:  export function lookElsewhere | lookElsewhereSteps |
//  smoothDenominators | normalizeParams | function windowBounds
// ============================================================================
import { MEASUREMENTS } from './data.js';
import { inverseDigits, decToScaled, gcd } from './exact.js';

const CODATA = MEASUREMENTS.find(m => m.id === 'codata2022');

// 3-smooth numbers 2^i 3^j <= max, sorted.
export function smoothDenominators(max) {
  const out = [];
  for (let p = 1; p <= max; p *= 2) for (let q = p; q <= max; q *= 3) out.push(q);
  return out.sort((a, b) => a - b);
}

const SC = 18; // decimal places for window bounds
function windowBounds(w) {
  if (w && typeof w === 'object' && w.lo && w.hi) return { lo: w.lo, hi: w.hi, sigmas: null };
  const k = typeof w === 'number' ? w : 1;
  const kk = BigInt(Math.round(k * 1000));
  const c = decToScaled(CODATA.value, SC), u = decToScaled(CODATA.unc, SC);
  const lo = c - (u * kk) / 1000n, hi = c + (u * kk) / 1000n;
  const str = v => { const s = v.toString().padStart(SC + 1, '0'); return s.slice(0, -SC) + '.' + s.slice(-SC); };
  return { lo: str(lo), hi: str(hi), sigmas: k };
}

export function normalizeParams(p = {}) {
  const coeffMax = Math.max(1, Math.min(160, Math.floor(p.coeffMax ?? 100)));
  let den = p.denominators ?? { kind: 'smooth', max: 40000 };
  let list;
  if (Array.isArray(den)) list = den.filter(x => Number.isInteger(x) && x > 0);
  else if (den.kind === 'all') list = Array.from({ length: Math.max(1, Math.floor(den.max)) }, (_, i) => i + 1);
  else list = smoothDenominators(Math.max(1, Math.floor(den.max ?? 40000)));
  const win = windowBounds(p.window ?? 1);
  return { coeffMax, denominators: den, list, window: win, maxExamples: p.maxExamples ?? 40, candidate: p.candidate ?? null };
}

export function* lookElsewhereSteps(params = {}) {
  const P = normalizeParams(params);
  const t0 = Date.now();
  const M = P.coeffMax;
  const Dmax = P.list.reduce((m, x) => Math.max(m, x), 0);
  const allowed = new Uint8Array(Dmax + 2);
  for (const D of P.list) allowed[D] = 1;
  const invLo = parseFloat(P.window.lo), invHi = parseFloat(P.window.hi);
  const aLo = 1 / invHi, aHi = 1 / invLo, aMid = 2 / (invLo + invHi);
  const slack = (aHi - aLo) * 1e-6; // float margin; exact check follows
  const span = invHi - invLo;
  const r2 = Math.SQRT2, r3 = Math.sqrt(3), r6 = Math.sqrt(6);
  const raw = [];
  let tuples = 0, expected = 0, scanned = 0;
  const total = (M + 1) ** 4;
  for (let a = 0; a <= M; a++) {
    for (let b = 0; b <= M; b++) {
      const sb = a + b * r2;
      for (let c = 0; c <= M; c++) {
        const sc = sb + c * r3;
        for (let d = 0; d <= M; d++) {
          const s = sc + d * r6;
          if (s === 0) continue;
          const D = Math.round(s / aMid);
          if (D < 1 || D > Dmax || !allowed[D]) continue;
          expected += s * span;
          const x = s / D;
          if (x < aLo - slack || x > aHi + slack) continue;
          raw.push([a, b, c, d, D]);
        }
      }
    }
    scanned += (M + 1) ** 3;
    yield { done: false, progress: scanned / total, scanned, total, rawHits: raw.length };
  }
  // Exact check and de-duplication.
  const loS = decToScaled(P.window.lo, 15), hiS = decToScaled(P.window.hi, 15);
  const hits = [];
  for (const [a, b, c, d, D] of raw) {
    const vt = decToScaled(inverseDigits({ a, b, c, d }, D, 15), 15);
    const inside = vt >= loS && vt + 1n <= hiS;
    const edge = !inside && !(vt + 1n < loS || vt > hiS);
    if (!inside && !edge) continue;
    tuples++;
    const g = [a, b, c, d, D].reduce((x, y) => gcd(x, y), 0);
    if (g !== 1) continue;
    const inv = inverseDigits({ a, b, c, d }, D, 12);
    const off = (parseFloat(inv) - parseFloat(CODATA.value)) / parseFloat(CODATA.unc);
    const cand = P.candidate;
    hits.push({ a, b, c, d, D, inverse: inv, sigma: off, smooth: isSmooth(D), edge,
      isCandidate: !!cand && cand.a === a && cand.b === b && cand.c === c && cand.d === d && cand.D === D });
  }
  hits.sort((p, q) => Math.abs(p.sigma) - Math.abs(q.sigma));
  yield {
    done: true, progress: 1,
    result: {
      params: { coeffMax: M, denominators: P.denominators, denominatorCount: P.list.length, Dmax, window: P.window },
      tuples, hits: hits.length, expected, candidateFound: hits.some(h => h.isCandidate),
      examples: hits.slice(0, P.maxExamples), ms: Date.now() - t0, scanned: total,
    },
  };
}
function isSmooth(n) { while (n % 2 === 0) n /= 2; while (n % 3 === 0) n /= 3; return n === 1; }

export function lookElsewhere(params = {}) {
  let last;
  for (const step of lookElsewhereSteps(params)) last = step;
  return last.result;
}

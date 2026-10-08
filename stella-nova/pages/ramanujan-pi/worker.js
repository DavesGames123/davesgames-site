// ============================================================================
//  RAMANUJAN PI  ·  worker.js — runs engine.js off the main thread
// ----------------------------------------------------------------------------
//  A module worker. One message is one job: { id, op, ... }. The reply is
//  { id, res } or { id, error }. A long job also sends { id, progress }.
//
//    race     { T, cap }        correct digits after each term, every series
//    stream   { sid, D, max }   pi after each term to D decimals, and the
//                               term that fixed each decimal (lockMap)
//    anatomy  { sid, K }        log sizes of terms 0..K and the exact s(k)
//    compute  { sid, D }        pi to D decimals by binary splitting
//
//  Correct digits count against PI_10K up to 10000 digits. Past that the
//  reference is a Chudnovsky run with 20 more digits.
//
//  grep -n targets: "function reference", "const OPS", "self.onmessage"
// ============================================================================
import { SERIES, byId, seqIter, partials, correctDigits, lockMap, anatomy, piDigits } from './engine.js';
import { PI_10K } from './pi10k.js';

const GUARD = 12;
// '3' and at least W decimals of pi.
function reference(W) {
  if (W <= 10000) return PI_10K;
  return piDigits(W + 20);
}

const OPS = {
  race({ T = 120, cap = 2000 }) {
    const ref = reference(cap + GUARD);
    return SERIES.map(S => {
      const D = S.id === 'leibniz' ? 18 : Math.min(cap, Math.ceil(S.rate * T) + 12), W = D + GUARD;
      const R = BigInt(ref.slice(0, W + 1)), dig = [];
      partials(S, T, W, { stop: (k, x) => { const d = correctDigits(x, R, W, D); dig.push(d); return d >= D; } });
      return { id: S.id, digits: dig, cap: D };
    });
  },
  stream({ sid, D = 300, max = 2500 }) {
    const S = byId(sid), W = D + GUARD, ref = reference(W), R = BigInt(ref.slice(0, W + 1));
    const t0 = performance.now();
    const vals = partials(S, max, W, { stop: (k, x) => correctDigits(x, R, W, D) >= D });
    const { lock, match, strs } = lockMap(vals, ref, W, D);
    return { sid, D, K: vals.length, lock, match, strs, ref: ref.slice(0, D + 1), ms: performance.now() - t0 };
  },
  anatomy({ sid, K = 60 }) {
    const S = byId(sid), next = seqIter(S), rows = [];
    for (let k = 0; k <= K; k++) {
      const a = anatomy(S, k, next()), str = (a.s < 0n ? -a.s : a.s).toString();
      rows.push({ k, ls: a.ls, ll: a.ll, lc: a.lc, lp: a.lp, lt: a.lt, neg: a.neg,
        sHead: str.length > 18 ? str.slice(0, 8) + '…' + str.slice(-6) : str, sLen: str.length, sNeg: a.s < 0n,
        lin: (S.A * BigInt(k) + S.B).toString(), cLen: k === 0 ? 1 : (S.C ** BigInt(k)).toString().length });
    }
    return { sid, rows };
  },
  compute({ sid = 'l1a', D = 10000 }, post) {
    const S = byId(sid), t0 = performance.now();
    let lastT = 0;
    const digits = piDigits(D, S, (stage, f) => {
      const t = performance.now();
      if (stage !== 'series' || t - lastT > 60) { lastT = t; post({ stage, f }); }
    });
    const ms = performance.now() - t0, counts = new Array(10).fill(0);
    for (let i = 1; i < digits.length; i++) counts[digits.charCodeAt(i) - 48]++;
    const n = Math.min(D, 10000);
    return { sid, D, digits, ms, counts, checked: n, matches: digits.slice(0, n + 1) === PI_10K.slice(0, n + 1) };
  },
};

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof document === 'undefined') {
  self.onmessage = e => {
    const { id, op } = e.data;
    try {
      const res = OPS[op](e.data, progress => self.postMessage({ id, progress }));
      self.postMessage({ id, res });
    } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
  };
}
export { OPS };

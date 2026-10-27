// ============================================================================
//  ULAM SPIRAL  ·  app/numbers.js — primality, and the messages of worker.js
// ----------------------------------------------------------------------------
//  isPrimeN reads the sieve bitset up to S.limit and Miller-Rabin (with a
//  cache) above it. onWorkerMessage takes the sieve progress, the bitset,
//  the arithmetic bytes and the CPU tiles from worker.js and hands them to
//  the renderer (rt.R). main.js sets it as rt.worker.onmessage.
//
//  GREP MAP
//    grep -n 'export function isPrimeN'         n prime? (sieve or Miller-Rabin)
//    grep -n 'export function onWorkerMessage'  progress, primes, arith, tile
//    grep -n 'export function startSieve'       ask the worker for a new sieve
// ============================================================================
import * as T from '../numtheory.js';
import { S, rt } from './state.js';
import { $ } from './dom.js';
import { fmt, fmtS } from './format.js';
import { sendTile } from './tiles.js';
import { computeRays } from './overlay.js';
import { updateQuad } from './readout.js';

const primeCache = new Map();
export function isPrimeN(n) {
  if (S.bits && n <= S.limit) return T.bitPrime(S.bits, n);
  if (n < 2) return false;
  let v = primeCache.get(n);
  if (v === undefined) { v = T.isPrime(n); if (primeCache.size > 50000) primeCache.clear(); primeCache.set(n, v); }
  return v;
}

export function onWorkerMessage(e) {
  const m = e.data, R = rt.R;
  if (m.type === 'progress') { $('sieveBar').style.width = (100 * m.done / m.total).toFixed(1) + '%'; return; }
  if (m.type === 'primes') {
    S.bits = m.bits; S.limit = m.limit; S.blocks = T.prefixCounts(m.bits);
    primeCache.clear();
    if (R) R.setPrimes(m.bits, m.limit);
    $('sieveBar').style.width = '100%';
    $('sieveNote').textContent = `${fmt(T.piFrom(S.bits, S.blocks, S.limit))} primes below ${fmtS(S.limit)}, sieved in ${m.ms} ms. Past ${fmtS(S.limit)}: Miller–Rabin tiles.`;
    S.tile.have = null;
    computeRays(); updateQuad(); rt.thumbsDirty = true; S.dirty = true;
    return;
  }
  if (m.type === 'arith') { if (R) R.setArith(m.bytes, m.mode); S.tile.have = null; S.dirty = true; rt.thumbsDirty = true; return; }
  if (m.type === 'tile') {
    const want = S.tile.pend;
    S.tile.pending = 0; S.tile.pend = null;
    if (want && R) { R.setTile(m.data, [m.x0, m.y0], [m.w, m.h]); S.tile.have = { ...want }; S.tile.ms = m.ms; }
    if (S.tile.want) sendTile(S.tile.want);
    S.dirty = true;
  }
}
export function startSieve(limit) {
  S.wantLimit = limit;
  $('sieveBar').style.width = '0%';
  $('sieveNote').textContent = `Sieving to ${fmtS(limit)} …`;
  rt.worker.postMessage({ type: 'sieve', limit });
}

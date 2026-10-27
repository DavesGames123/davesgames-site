// ============================================================================
//  MUSHROOM DRAW  ·  engine/share.js — the share link
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). No DOM. encodeShare(state) writes the
//  hash of a share link; decodeShare(hash) reads it back. Unknown param
//  keys and values that are not numbers drop out.
//
//  GREP MAP
//    grep -n 'export function encodeShare'   state to hash
//    grep -n 'export function decodeShare'   hash to state
// ============================================================================
import { PARAM_BY_KEY } from './params.js';

// ── share link ──────────────────────────────────────────────────────────────
// #f=fly&s=12345&p=capR:80,age:0.3&m=single&t=cream
// f: the form key; s: the seed; p: the fields that differ from the form.
export function encodeShare(state) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) {
    if (v == null || v === '') continue;
    if (k === 'p') {
      const s = Object.entries(v).filter(([key]) => PARAM_BY_KEY[key]).map(([key, x]) => key + ':' + x).join(',');
      if (s) q.set('p', s);
    } else q.set(k, String(v));
  }
  return q.toString();
}
export function decodeShare(hash) {
  const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const out = {};
  for (const [k, v] of q) {
    if (k === 'p') {
      const p = {};
      for (const pair of v.split(',')) {
        const [key, x] = pair.split(':');
        if (PARAM_BY_KEY[key] && x !== undefined && x !== '' && Number.isFinite(+x)) p[key] = +x;
      }
      out.p = p;
    } else out[k] = v;
  }
  return out;
}

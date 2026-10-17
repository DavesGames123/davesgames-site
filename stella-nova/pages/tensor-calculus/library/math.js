// ============================================================================
//  library/math.js  ·  the one MATH entry point of the LIBRARY package
// ----------------------------------------------------------------------------
//  Every library file imports the engine from here, not from tensor/ or
//  stub-math.js. This file gives the MATH package API (tensor/index.js)
//  and adds small helpers that the entries use on Components.
//  library/stub-math.js is the stand-in that the LIBRARY package used before
//  MATH committed; the tests compare the two engines on the same inputs.
//
//  MATH_SOURCE ....... 'tensor' (the MATH package is live)
//  T(x, variance) .... Tensor from a number, nested array or Components
//  sub, scale, maxAbs, toNested, transposeM, get  helpers on Components
// ============================================================================
import * as MATH from '../tensor/index.js';
export * from '../tensor/index.js';
export const MATH_SOURCE = 'tensor';

export function T(x, variance) {
  if (typeof x === 'number') return MATH.Tensor.scalar(x);
  if (x && x.shape && x.data) return new MATH.Tensor(x.shape, variance ?? x.variance, x.data);
  if (typeof variance === 'string') variance = variance.split('');
  return MATH.Tensor.fromNested(x, variance);
}
export const get = (t, ...i) => T(t).get(...i);
export const toNested = t => T(t).toNested();
export const maxAbs = t => { let m = 0; for (const v of t.data) m = Math.max(m, Math.abs(v)); return m; };
export const sub = (a, b) => { const o = T(a).clone(); for (let i = 0; i < o.data.length; i++) o.data[i] -= b.data[i]; return o; };
export const scale = (a, k) => { const o = T(a).clone(); for (let i = 0; i < o.data.length; i++) o.data[i] *= k; return o; };
export const transposeM = A => A[0].map((_, j) => A.map(r => r[j]));

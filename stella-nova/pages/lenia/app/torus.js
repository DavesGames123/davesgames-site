// ============================================================================
//  LENIA  ·  app/torus.js — index and distance on the wrapped world
// ----------------------------------------------------------------------------
//  The world wraps on both axes. wrap() takes an index into 0..n-1, and
//  wrapDelta() gives the short signed distance between two points.
//
//  GREP MAP
//    const wrap         index into 0..n-1
//    const wrapDelta    signed distance in -n/2..n/2
// ============================================================================
export const wrap = (a, n) => ((a % n) + n) % n;
export const wrapDelta = (d, n) => wrap(d + n / 2, n) - n / 2;

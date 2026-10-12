// ============================================================================
//  GRAVITY LAB  ·  budget.js — particle counts and the work of one frame
// ----------------------------------------------------------------------------
//  No DOM and no GPU, so tests.mjs can check the arithmetic (the pattern of
//  roche-limit/budget.js).
//
//  QUALITY   particle budgets: n for restricted experiments (test
//            particles against at most 32 bodies), nSelf for the
//            self-gravity disk (every pair: the cost grows as n^2).
//            Auto takes medium, or low on a touch screen.
//  frameWork(spec, speed)   pair interactions of one frame at a speed
//            (1 = Normal): restricted N S nb, self-gravity N^2 S.
//  LIMIT     what tests.mjs holds each profile to at Normal speed.
//  particleBytes(cap, S)    GPU bytes of one Lab (engine.js buffers).
//
//  EXPORTS  QUALITY, LIMIT, budgetFor, frameWork, particleBytes
// ============================================================================
import { MAXB, TRAJ_STRIDE } from './nbody.js';
import { MAX_S } from './lab.js';

export const QUALITY = {
  high:   { n: 32768, nSelf: 12288 },
  medium: { n: 16384, nSelf: 8192 },
  low:    { n: 4096,  nSelf: 2048 },
};
// pair interactions per frame at Normal speed
export const LIMIT = { desktop: 4e8, touch: 4e7 };

export function budgetFor(quality, touch) {
  const q = QUALITY[quality] || (touch ? QUALITY.low : QUALITY.medium);
  return q;
}
export function frameWork(spec, speed = 1) {
  const S = Math.min(MAX_S, Math.ceil(spec.rate * speed / 60 / spec.dt));
  if (spec.self) return spec.self.n * spec.self.n * S;
  const P = spec.particles || { n: 0 };
  const nb = Math.max(1, (spec.bodies || []).length);
  return (P.n + (spec.pool || 0)) * S * nb;
}
export function particleBytes(cap, self = false) {
  const rows = self ? Math.ceil(cap / 256) * 256 : cap;
  let b = rows * 48 * 2 + rows * 16 * 2;               // body, diag and their staging copies
  if (self) b += rows * 16 * 2 + 16 + 3 * 16;            // acc (+ staging), uniforms
  else b += 32 + (MAX_S + 1) * MAXB * TRAJ_STRIDE * 4 + MAXB * 4 * 2;   // params, traj, hits
  return b;
}

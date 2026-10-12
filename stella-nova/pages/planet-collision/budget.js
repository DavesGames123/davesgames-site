// ============================================================================
//  PLANET COLLISION  ·  budget.js — particle counts and GPU cost per profile
// ----------------------------------------------------------------------------
//  No DOM and no GPU, so tests.mjs can check it (the roche-limit pattern).
//
//  COST MODEL (Apple M4 Pro, Deno WebGPU, measured by tests.mjs --gpu --time;
//  a laptop or a phone GPU is slower, so the page's governor measures the
//  frame and sets the steps per frame):
//    neighbour passes (density + forces + grid)  about 0.07 us per particle
//    gravity (direct sum)                        about 1.1e-5 us per pair,
//                                                every KG steps
//  The direct sum is O(N^2): it is the cost that limits N. At 32k it is
//  about 13 ms per sum, so KG = 4 spreads it to about 3 ms per step.
//  Measured per step (KG 4, two runs): 2.5-3.2 ms at 16k, 5.3-7.9 ms at
//  32k, 9.3-14.8 ms at 49k. The spread is other load on the machine.
//
//  PROFILES. N is the particle count of the scene (both bodies). Phones
//  get 8k-12k (budget rule of the site: lower counts on phones).
//
//  EXPORTS  PROFILES, pickProfile, stepMs, stepsPerFrame, gpuBytes, LIMIT
// ============================================================================
import { sphBytes } from './engine.js';

export const PROFILES = {
  ultra:  { N: 61440, KG: 6, label: 'Ultra (60k)' },
  high:   { N: 49152, KG: 5, label: 'High (49k)' },
  medium: { N: 32768, KG: 4, label: 'Medium (32k)' },
  low:    { N: 20480, KG: 4, label: 'Low (20k)' },
  phone:  { N: 12288, KG: 4, label: 'Phone (12k)' },
  phoneLow: { N: 8192, KG: 3, label: 'Phone low (8k)' },
};
// GPU bytes each profile may use for the solver
export const LIMIT = { desktop: 64e6, touch: 16e6 };

// o: { touch, phone, quality: 'auto' | profile key }
export function pickProfile(o = {}) {
  if (o.quality && PROFILES[o.quality]) return Object.assign({ key: o.quality }, PROFILES[o.quality]);
  const key = o.phone || o.touch ? 'phone' : 'medium';
  return Object.assign({ key }, PROFILES[key]);
}
// Model of the GPU time of one step in ms (M4 Pro numbers above).
export function stepMs(N, KG, scale = 1) {
  return scale * (7e-5 * N + 1.1e-8 * N * N / KG);
}
// Steps per frame that fit a frame budget (ms) given a measured ms/step.
export function stepsPerFrame(msPerStep, frameMs = 12, max = 8) {
  if (!(msPerStep > 0)) return 1;
  return Math.max(1, Math.min(max, Math.floor(frameMs / msPerStep)));
}
export function gpuBytes(N) { return sphBytes(N); }

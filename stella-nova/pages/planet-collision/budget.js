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
//  RENDER. The renderer (render.js) costs fill rate: 5.8 ms per frame at
//  1600 x 900 (tests.mjs --time). renderBudget caps the drawing buffer at
//  PIXELS[desktop | touch] and sets the debris droplets per particle, the
//  filter iterations and the volume size (GRID: cells per side of the
//  density volume; memory volBytes). The governor in main.js steps the
//  volume down GRID_TIERS when the frame stays slow at one step a frame.
//
//  EXPORTS  PROFILES, pickProfile, stepMs, stepsPerFrame, gpuBytes, LIMIT,
//           PIXELS, renderBudget, GRID, GRID_TIERS, volBytes, lowerGrid
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

// drawing-buffer pixels the renderer may use
export const PIXELS = { desktop: 2.2e6, touch: 1.0e6 };
// density volume cells per side (render.js "_volume"), and the steps down
export const GRID = { desktop: 144, touch: 96 };
export const GRID_TIERS = [144, 128, 112, 96, 80, 64];
// GPU bytes of a G^3 volume: u32 sums, rgba16float field, brick marks
export function volBytes(G) { return G * G * G * (4 + 8) + Math.pow(G / 8, 3) * 4; }
// the next tier under G (G when it is the last)
export function lowerGrid(G) { const t = GRID_TIERS.find(x => x < G); return t || G; }
// o: { cssW, cssH, dpr, touch, phone } -> { ratio, w, h, frags, smooth }
export function renderBudget(o) {
  const touch = !!(o.touch || o.phone), cap = touch ? PIXELS.touch : PIXELS.desktop;
  const css = Math.max(1, o.cssW * o.cssH);
  const ratio = Math.max(0.5, Math.min(o.dpr || 1, 2, Math.sqrt(cap / css)));
  return { ratio, w: Math.round(o.cssW * ratio), h: Math.round(o.cssH * ratio), frags: touch ? 4 : 10, smooth: 2, grid: touch ? GRID.touch : GRID.desktop };
}

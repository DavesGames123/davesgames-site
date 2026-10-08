// ============================================================================
//  ROCHE LIMIT  ·  app/env.js — constants, device queries, settings
// ----------------------------------------------------------------------------
//  The fixed values of the page, the media queries it reads, the
//  quality presets with the Auto governor state (Q), and the user
//  settings (UI). The modules change Q and UI in place.
//
//  grep -n targets
//    device queries ..... "const PHONE_Q", "const RM_Q"
//    speed stops ........ "const SPEED_STOPS"
//    reference sweep .... "const REF_SWEEP"
//    quality presets .... "const QUALITY", "const Q"
//    settings ........... "const UI"
// ============================================================================
import * as P from '../physics.js';

export const $ = id => document.getElementById(id);
export const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
export const COARSE = window.matchMedia('(pointer:coarse)').matches;
export const N_OPTS = [4096, 8192, 16384, 24576, 32768];
export const G_SI = 6.674e-11;
export const RUNS_KEY = 'roche-limit-runs-v1';
export const SPEED_STOPS = [{ name: 'Slow', v: 0.18 }, { name: 'Normal', v: 0.78 }, { name: 'Fast', v: 1.38 }];   // log10 orbits/min
export const SPEED_MIN = -1.3, SPEED_MAX = 2, CALM_SPEED = 0.78;
export const SNAP_CAP = 60;
export const KM_SATURN = 60268;

// Bound mass after 3 orbits, measured with this code: N = 16384, q = 1,
// circular orbits, 2026-10-06, shaders/sim.wgsl run from Deno (a scratch
// sweep script; readbacks every 1/6 orbit). x = d / (R_p q^(1/3)).
// Disruption (bound < 50%): fluid 0.92-0.95 d_fluid, rigid-ish 0.70-0.75,
// cohesive 0.65-0.70; d_rigid is 0.52 d_fluid.
export const REF_SWEEP = [
  ...[[0.80, 0.011], [0.85, 0.010], [0.88, 0.049], [0.90, 0.154], [0.92, 0.008], [0.95, 1.0], [1.00, 1.0], [1.05, 1.0]].map(([f, y]) => ({ x: f * P.K_FLUID, y, mat: 'fluid' })),
  ...[[0.65, 0.007], [0.70, 0.006], [0.75, 1.0], [0.80, 1.0]].map(([f, y]) => ({ x: f * P.K_FLUID, y, mat: 'rigid' })),
  ...[[0.55, 0.135], [0.60, 0.261], [0.65, 0.360], [0.70, 1.0], [0.75, 1.0]].map(([f, y]) => ({ x: f * P.K_FLUID, y, mat: 'cohesive' })),
];

// Quality presets. Auto starts at Medium (Low on a phone) and the governor
// (function governQuality) lowers the render scale, then the bloom, then
// the steps per frame when frames run long, and raises them back when
// there is room. The grain count changes only between runs.
// The table lives in budget.js (tests.mjs checks its memory).
export { QUALITY } from '../budget.js';
import { QUALITY } from '../budget.js';
export const Q = { preset: (PHONE_Q.matches || COARSE) ? 'low' : 'medium', scale: 1, bloom: true, win: { n: 0, t0: 0, slow: 0, good: 0 }, cool: 0, note: '' };
Q.bloom = QUALITY[Q.preset].bloom;

export const UI = {
  scen: 'saturn', body: 'phobos',
  d: 2.24, peri: 1.6, e: 1, qLog: 0, J2: 0,
  material: 'fluid', mu: 0, coh: 0,
  N: (PHONE_Q.matches || COARSE) ? 4096 : 8192,
  quality: 'auto', showFps: false,
  speedLog: 0.78, paused: false,
  cam: 'planet', color: 4, field: 0,
  rings: true, real: true, hill: false, pred: true, track: true, ringOn: true, blur: false, ringGain: 2,
  calm: window.matchMedia('(prefers-reduced-motion: reduce)').matches,   // Reduce motion
};
export const RM_Q = window.matchMedia('(prefers-reduced-motion: reduce)');

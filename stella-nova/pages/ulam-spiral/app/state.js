// ============================================================================
//  ULAM SPIRAL  ·  app/state.js — the page state S and the runtime slots rt
// ----------------------------------------------------------------------------
//  No DOM. Every module of app/ and saver.js (through app.S) read and write
//  the same S. rt holds the values that main.js kept in module-level
//  variables before the split: the renderer, the worker, the pixel ratio,
//  the last view and the "redo" flags of the thumbnails, the minimap and
//  the prime count.
//
//  GREP MAP
//    grep -n 'export const S = '   the page state (shape, mode, camera, sieve)
//    grep -n 'export const rt = '  renderer, worker, dpr, view, dirty flags
// ============================================================================
import * as T from '../numtheory.js';
import * as L from '../layouts.js';

const M = T.MODE;
export const S = {
  shape: L.SHAPE.square, P: { ...L.DEFAULT_P }, mode: M.primes,
  quad: { on: false, a: 1, b: 1, c: 41, max: null },
  style: 2, dotR: 0.36, compA: 0.06, bloom: 0.9, pal: 'aurora', bg: 'night',
  labels: true, path: false, diag: false, mini: true, morphOn: true,
  cam: { x: 0, y: 0, z: 4 }, cam3: null,
  limit: 0, wantLimit: 1e8, bits: null, blocks: null,
  tile: { have: null, pending: 0, want: null, id: 0 }, tileOn: false,
  morph: null, walk: null, fly: null, sweep: null, palB: null, walkRate: 1,
  hover: null, sel: null, rays: [], marks: [], dirty: true, saver: false,
  overlayHook: null, frameHook: null,
};

// R: the renderer (render.js) or null; worker: worker.js. dpr and boxMax
// come from fieldPlan (view.js resize). VW: the last view(). thumbsDirty,
// miniAt and piAt make the thumbnails, the minimap and the prime count
// redo their work. frames and lastState: the frame loop (main.js).
export const rt = {
  R: null, worker: null, dpr: 1, boxMax: 6, VW: null,
  thumbsDirty: true, miniAt: 0, piAt: -1, frames: 0, lastState: null,
};

// ============================================================================
//  ROCHE LIMIT  ·  app/state.js — the shared state of the page
// ----------------------------------------------------------------------------
//  S holds every value that more than one module reads and some module
//  changes: the GPU handles, the current run, the frame timing, the step
//  budget and the screensaver. The modules change S in place and never
//  replace it. pileCache keeps the settled piles by N and material.
//  bootReady settles when boot() has the GPU and the frame loop.
//
//  grep -n targets
//    shared state ........... "export const S"
//    settled piles .......... "export const pileCache"
//    boot promise ........... "export const bootReady"
// ============================================================================
export const S = {
  dev: null, ctx: null, ren: null, simCode: null, worker: null,
  run: null,            // the current run
  runSerial: 0,
  gpuMs: 0, stepsMax: 128, warpCarry: 0,
  fps: 60,
  cpuMs: 0,             // main-thread time of one frame (ms, smoothed)
  saverOn: false,
  profiling: false,
  saver: null,
};
export const pileCache = new Map();
export let bootDone; export const bootReady = new Promise(r => { bootDone = r; });

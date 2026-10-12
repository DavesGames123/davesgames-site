// ============================================================================
//  GRAVITY LAB  ·  app/state.js — shared state, settings, device queries
// ----------------------------------------------------------------------------
//  S   the mutable state of the page: GPU device, renderer, the running
//      Lab and its spec, the trails, the selection, the saver
//  UI  the user settings (Display panel, speed, tray)
//  The other app modules change S and UI in place.
//
//  grep -n targets: "export const S", "export const UI", "export const SPEEDS",
//  "export function bus"
// ============================================================================
export const $ = id => document.getElementById(id);
export const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
export const COARSE = window.matchMedia('(pointer:coarse)').matches;
export const RM_Q = window.matchMedia('(prefers-reduced-motion: reduce)');
// speed multipliers of the spec's rate (1 = Normal)
export const SPEEDS = [0.125, 0.25, 0.5, 1, 2, 4, 8];

export const S = {
  dev: null, ctx: null, ren: null, code: null,
  lab: null, spec: null, key: null,        // the running experiment
  t0: 0,                                    // performance.now() at the start
  rows: null,                               // CPU copy of the packed row colours
  trails: [],                               // per body: { pts: Float32Array ring, n, head }
  frame: null,                              // frame.js frameOf result this frame
  sel: -1, follow: -1,                      // selected body, followed body
  events: [],                               // recent events (for the HUD and the saver)
  slow: 1,                                  // CPU guard: <1 when the bodies cost too much
  saverOn: false, saver: null,
  fps: 60, cpuMs: 0,
  thrown: 0,
  aim: null,                                // the throw in progress (pointer.js)
};
export const UI = {
  speedI: 3, paused: false,
  trails: true, labels: true, predict: true, colorMode: 0, quality: 'auto',
  item: null,                               // the armed tray item key
  calm: RM_Q.matches,
};
// A tiny event bus: run.js emits sim events, the HUD and the saver listen.
const subs = new Map();
export function bus(type, fn) { if (!subs.has(type)) subs.set(type, []); subs.get(type).push(fn); }
export function emit(type, data) { for (const f of subs.get(type) || []) { try { f(data); } catch (e) { console.error(e); } } }

// bootReady resolves when the page has a GPU device and a renderer, and
// rejects when boot fails (no WebGPU): snSaver.enter then throws, and the
// screensaver shell uses its generic mode instead of a wait with no end.
let readyFn, failFn;
export const bootReady = new Promise((res, rej) => { readyFn = res; failFn = rej; });
bootReady.catch(() => {});
export function bootDone() { readyFn(); }
export function bootFailed(e) { failFn(e); }

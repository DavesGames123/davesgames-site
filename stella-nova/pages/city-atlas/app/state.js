// ============================================================================
//  STATE  ·  city-atlas/app/state.js — the shared state of the page
// ----------------------------------------------------------------------------
//  One mutable object S holds the values that more than one module of app/
//  reads and writes (the city on screen, the renderer, the clock, the input
//  time). ov holds the overlay settings, cam the orbit camera. Values that
//  only one module uses stay in that module. No DOM.
//
//  grep -n targets
//    timing constants ..... "export const DAYS_SECONDS"
//    shared values ........ "export const S"
//    overlay settings ..... "export const ov"
//    orbit camera ......... "export const cam"
//    city caches .......... "export const pending"
//    data window .......... "export const lastHour"
//    render on demand ..... "export function invalidate"
//    page files ........... "export const pageUrl"
// ============================================================================

import { hoursOf } from './text.js';

export const DAYS_SECONDS = 60;            // the 48 hours of current data in about 60 s
export const IDLE_MS = 2500;
export const ORBIT_IDLE_MS = 6000;         // auto-orbit after this much time without input
export const STORE_KEY = 'city-atlas.city';
export const DEFAULT_ID = 'new-york';

export const S = {
  cities: [],
  locIndex: 0,
  meta: null,              // meta of the city on screen
  renderer: null,
  worker: null,
  playing: true,           // main.js sets it from prefers-reduced-motion
  scrubbing: false,
  hour: 0,
  lastT: null,
  switchToken: 0,
  saver: false,
  ui: {},
  renderScale: 1,
  lastInput: -1e9,
  camGoal: null,           // eased toward on a city switch and a reset
  sunAz: 210,
  dirtyFrames: 0,
};

export const ov = {
  // terrain and wind are on at load (the user asked for both by default)
  terrain: { on: true, exag: 2, contour: true, amt: 0 },
  ocean: { on: false, amt: 0 },
  wind: { on: true, amt: 0, live: false, dirFrom: 270, speed: 5, slice: 12, seaBreeze: false, heat: true, liveInfo: null },
  // colour 2: the facade materials (buildings.wgsl matOf); 0 height, 1 use
  view: { light: 'golden', colour: 2, orbit: true },
};
export const cam = { target: [0, 0, 0], yaw: 3.6, pitch: 0.5, dist: 4500 };

export const pending = new Map();    // id -> Promise of the worker result
export const slots = new Map();      // id -> GPU slot (renderer.upload)

export const lastHour = () => hoursOf(S.meta);

// RENDER ON DEMAND. With no overlay on, no orbit, no input and no camera
// ease, the image does not change, so the loop skips the GPU work. Any UI
// change calls invalidate(n) for n more frames.
export function invalidate(n = 2) { S.dirtyFrames = Math.max(S.dirtyFrames, n); }

// A file of the page folder (one level above app/).
export const pageUrl = (path) => new URL(`../${path}`, import.meta.url);

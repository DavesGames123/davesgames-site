// ============================================================================
//  ROCHE LIMIT  ·  saver-plan.js — the screensaver reel (no DOM)
// ----------------------------------------------------------------------------
//  app/saver.js plays it; tests.mjs checks it.
//
//  A REEL is a seeded shuffle of RUNS (a moon, a planet, a density); the
//  same run never plays twice in a row. Each run is one take of the story
//  camera (app/director.js) and the story clock (pacing.js): the moon
//  reaches its breakup within about 2 s of the start (tests.mjs test 8).
//  The take is cut into SHOTS. A shot is an offset of the story camera:
//    wide     the story camera itself: the approach and the push in
//    close    the breakup in slow motion from a second angle, nearer
//    stream   low over the ring plane: the stream winds round the planet
//    ring     high above the plane: the ring forms and shears
//  dAz (rad) turns the view, el (rad) replaces the elevation when it is
//  set, zoom scales the distance, push is the slow push-in over the shot.
//  Each shot lasts a seeded time in [min, max], inside [5, 12] s; the wide
//  shot also waits for the breakup (event 'breakup' plus 1.5 s), and the
//  close shot ends early once the ring phase starts. The run fades out
//  after its last shot.
//
//  grep -n targets: "export const RUNS", "export const SHOTS",
//  "export function makeReel", "export function shotPlan",
//  "export function shotDone"
// ============================================================================
import { BODIES } from './physics.js';

const B = BODIES;
export const CUT_MIN = 5, CUT_MAX = 12;

// spec: overrides of the scenario's run spec (scenarios.js specFor).
// Each spiral starts 4% outside its fluid limit and drifts to 0.72 of it.
export const RUNS = [
  { key: 'saturn', scen: 'saturn', title: 'An icy moon becomes Saturn’s rings', spec: {} },
  { key: 'phobos', scen: 'close', title: 'Phobos, some 40 million years from now',
    spec: { q: B.mars.rho / B.phobos.rho, d: 3.25, d1: 2.25, orbits: 0.8, style: 3, planetName: 'Mars', Rkm: B.mars.R, rhoS: B.phobos.rho, J2: B.mars.J2, flattening: 0.006 } },
  { key: 'earth', scen: 'close', title: 'If the Moon came too close to Earth',
    spec: { q: B.earth.rho / B.moon.rho, d: 3.0, d1: 2.1, orbits: 0.8, style: 4, planetName: 'Earth', Rkm: B.earth.R, rhoS: B.moon.rho, J2: B.earth.J2, flattening: 0.0034 } },
  { key: 'ice', scen: 'close', title: 'A loose moon as dense as its ice giant', spec: {} },
  { key: 'comet', scen: 'flyby', title: 'A comet torn into a string of pearls', spec: {} },
  { key: 'compare', scen: 'compare', title: 'A loose moon and a rough moon on one orbit', spec: {} },
];

export const SHOTS = {
  wide:   { min: 5, max: 9,  dAz: 0,    el: null, zoom: 1.0,  push: 0.10, until: 'breakup' },
  close:  { min: 5, max: 9,  dAz: 0.7,  el: 0.16, zoom: 0.72, push: 0.12, end: 'ring' },
  stream: { min: 5, max: 9,  dAz: -0.9, el: 0.07, zoom: 0.80, push: 0.06 },
  ring:   { min: 6, max: 12, dAz: 0.4,  el: 0.95, zoom: 1.05, push: 0.08 },
};
const ORDER = ['wide', 'close', 'stream', 'ring'];

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
// A seeded order of all runs; `last` (a run key) never comes first.
export function makeReel(rnd, last = null) {
  const a = RUNS.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (last && a[0].key === last) a.push(a.shift());
  return a;
}
// The shots of one run: kind, a seeded length, the side of the turn.
export function shotPlan(rnd) {
  return ORDER.map(kind => {
    const S = SHOTS[kind], len = S.min + (S.max - S.min) * rnd();
    return Object.assign({ kind, len, side: rnd() < 0.5 ? -1 : 1 }, S);
  });
}
// Is the shot over? el: seconds in the shot; ev: { breakupAt (s in the
// shot or null), ring (bool) }.
export function shotDone(sh, el, ev) {
  if (el >= CUT_MAX) return true;
  if (el < CUT_MIN) return false;
  if (sh.until === 'breakup') return ev.breakupAt !== null && el >= Math.max(sh.min, ev.breakupAt + 1.5);
  if (sh.end === 'ring' && ev.ring) return true;
  return el >= sh.len;
}

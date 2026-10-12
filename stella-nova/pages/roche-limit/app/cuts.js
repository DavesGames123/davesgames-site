// ============================================================================
//  ROCHE LIMIT  ·  app/cuts.js — the cutting director (screensaver, Director)
// ----------------------------------------------------------------------------
//  Plays the shot plan of saver-plan.js over the story camera: it reads
//  the run's events, cuts on them, and turns each shot into a camera goal
//  with shot-geom.js. Two users:
//    the screensaver (app/saver.js): one take per run; 'end' fades out
//    the Director view (UI.cam 'cut', a View button): a looping take on
//      the run the user plays; it starts again on each new run
//  The story camera's springs run first (app/director.js); a cut replaces
//  their goal at once, so a cut is a cut (cam.cut tells camera.js not to
//  count it as motion).
//  THE EVENTS (function eventsNow): the phase from the pace and the story
//  (approach, crack, torn, ring) and the first impact. S.cuts.log keeps
//  the run's numbers at each event for the saver plate.
//  THE SPEED. A shot can cap the speed (opm, orbits per wall minute: a
//  deeper slow motion, a ride that does not swing the sky round) or
//  multiply it (warp: a time-lapse). cutSpeed() gives app/loop.js the
//  factor; the readouts print the time warp that results.
//  THE FRAGMENT of a ride: a shed grain of the last analysis (s.fragRaw,
//  app/history.js) next to the moon, moved on in the planet's field with a
//  copy of the reference orbit (physics.js RefOrbit, no drag). Each read
//  (app/history.js s.rideSync) puts it back on the grain's true state:
//  between reads the stream's own pull and the contacts move the grain a
//  few % of its path away from the orbit (tests.mjs test 15).
//
//  grep -n targets
//    events ........... "export function eventsNow"
//    shot clock ....... "export function cutsTick"
//    camera goal ...... "export function cutCamera"
//    speed ............ "export function cutSpeed"
//    fragment ......... "function pickFrag", "function fragNow" (test hook
//                       "export function rideProbe")
// ============================================================================
import * as P from '../physics.js';
import { newTake, takeStep, traitsOf, rng } from '../saver-plan.js';
import { shotGoal } from '../shot-geom.js';
import { cam } from './camera.js';
import { UI } from './env.js';
import { satCentre, satState } from './sat.js';
import { S } from './state.js';

// Is the cutting director on? The saver always (with Reduce motion its
// clock still ends the take; app/camera.js then keeps the planet view);
// the page in the Director view (not with Reduce motion).
export function cutsOn() { return (S.saverOn && !!S.saver) || (UI.cam === 'cut' && !UI.calm); }

// The story's phase now, and the first impact.
export function eventsNow() {
  const run = S.run, st = run.story || {};
  const phase = st.ring !== undefined ? 'ring' : st.torn !== undefined ? 'torn' : run.pace && run.pace.mode !== 'approach' ? 'crack' : 'approach';
  const impact = run.sats.some(s => s.an && s.an.accreted > 0);
  return { phase, impact };
}
// Keep the run's numbers at each event (for the plate).
function logEvents(c, ev) {
  const run = S.run, s = run.sats[0], L = run.limits, u = run.spec.bodyR || 1;
  const d = Math.hypot(...satState(s).r) / s.Rp;
  if (ev.phase !== 'approach' && !c.log.crack) c.log.crack = { d, dL: d / L.fluid };
  if ((ev.phase === 'torn' || ev.phase === 'ring') && !c.log.torn) c.log.torn = { d, dL: d / L.fluid, f: s.an ? s.an.f : 1 };
  if (ev.phase === 'ring' && !c.log.ring) c.log.ring = { t: run.t / run.T0 };
  if (ev.impact && !c.log.impact) c.log.impact = { n: run.sats.reduce((a, q) => a + (q.an ? q.an.accreted : 0), 0) };
  if (c.log.impact) c.log.hits = run.sats.reduce((a, q) => a + (q.an ? q.an.accreted : 0), 0);
  c.log.dNow = d / u;
}

// Each frame while the director is on: start a take on a new run, step
// the shot clock, cut. Returns the take's state word ('cut', 'end', null).
export function cutsTick(dtReal) {
  if (!cutsOn() || !S.run || S.run.phase !== 'orbit' || !S.run.pace) return null;
  let c = S.cuts;
  const loop = !S.saverOn;
  if (!c || c.serial !== S.run.serial || c.loop !== loop) {
    const seed = S.saverOn && S.saver ? Math.floor(S.saver.rnd() * 4294967295) : (S.run.serial * 7919 + 13);
    c = S.cuts = { serial: S.run.serial, loop, take: newTake(rng(seed), traitsOf(S.run.spec), loop), shotAt: performance.now(), log: {}, frag: null };
  }
  if (S.saverOn && S.saver && S.saver.state !== 'show') return null;
  const ev = eventsNow();
  logEvents(c, ev);
  const r = takeStep(c.take, UI.paused ? 0 : dtReal, ev);
  if (r === 'cut') {
    c.shotAt = performance.now(); c.frag = null; cam.cut = true;
    if (c.take.shot.kind === 'ride') c.frag = pickFrag();
  }
  return r;
}
export function curShot() { return S.cuts && S.cuts.take && S.cuts.take.shot; }

// The goal for this frame: the story camera's goal g (after its springs)
// with the shot applied.
export function cutCamera(g) {
  const sh = curShot(); if (!sh || !S.run) return g;
  const s = S.run.sats[0], run = S.run;
  const prog = Math.min(1, S.cuts.take.el / sh.len);
  const st = satState(s), v = st.v.map(q => q * s.k);
  const out = shotGoal(sh, {
    base: g, prog, side: sh.side, c: satCentre(s), v, frag: sh.kind === 'ride' ? fragNow() : null,
    bodyR: run.spec.bodyR || 1, ringR: run.shot ? Math.max(1.3, run.shot.dPb || 2) : 2,
    impact: impactPoint(), Rw: (s.Rs || s.C.Rs) * s.k, calm: S.saver ? S.saver.calm : 0.5,
  });
  return out;
}
// The speed factor of the shot, on top of the base speed and the pace.
export function cutSpeed(opm) {
  const sh = cutsOn() ? curShot() : null;
  if (!sh) return 1;
  // Reduce motion: a shot may slow the run, never speed it up
  let k = UI.calm ? Math.min(1, sh.warp || 1) : (sh.warp || 1);
  if (sh.opm && opm * k > sh.opm) k = sh.opm / opm;
  return k;
}
// The first impact: where the bound centre (or the debris centre) meets
// the surface, kept from the frame it was first seen.
function impactPoint() {
  const c = S.cuts; if (!c || !c.log.impact) return null;
  if (!c.impactP) { const s = S.run.sats[0], p = satCentre(s), l = Math.hypot(...p) || 1, R = S.run.spec.bodyR || 1; c.impactP = p.map(q => q / l * R); }
  return c.impactP;
}
// A shed grain of the last analysis next to the moon: the ride follows it.
function pickFrag(any = false) {
  const s = S.run.sats[0], fr = s.fragRaw;
  if (!fr || !fr.list.length || (!any && S.cuts.take.shot.phase === 'crack')) return null;
  const c = satState(s).r;
  let best = null, bd = Infinity;
  for (const q of fr.list) { const d = Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]); if (d < bd) { bd = d; best = q; } }
  if (!best) return null;
  const pl = Object.assign({}, s.pl, { drag: 0 });
  s.rideSync = null;
  return { ref: new P.RefOrbit(pl, best.slice(0, 3), best.slice(3, 6)), t: fr.t, idx: best[6] ?? -1, pl };
}
// tests.mjs: pick a fragment of the last analysis (keep: the one picked
// before) and step it to the sim time now; { p, v } in world units, or null.
export function rideProbe(keep = false) {
  if (!S.cuts) return null;
  if (!keep || !S.cuts.frag) S.cuts.frag = pickFrag(true);
  return S.cuts.frag ? fragNow() : null;
}
// The fragment now (world units): its orbit stepped to the sim time.
function fragNow() {
  const c = S.cuts, f = c && c.frag; if (!f) return null;
  const s = S.run.sats[0], tNow = s.gpu.t, dtMax = S.run.T0 / 400;
  // a newer read of the grain itself: start again from its true state
  const sy = s.rideSync;
  if (sy && sy.t > f.t - 1e-12 && sy.t <= tNow) { f.ref = new P.RefOrbit(f.pl, sy.X, sy.V); f.t = sy.t; s.rideSync = null; }
  if (tNow < f.t) return null;
  let n = 0;
  while (f.t < tNow - 1e-12 && n < 400) { const h = Math.min(dtMax, tNow - f.t); f.ref.step(h); f.t += h; n++; }
  if (Math.hypot(...f.ref.X) < s.pl.Rp) return null;   // it hit the planet
  return { p: f.ref.X.map(q => q * s.k), v: f.ref.V.map(q => q * s.k) };
}

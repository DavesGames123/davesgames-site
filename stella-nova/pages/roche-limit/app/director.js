// ============================================================================
//  ROCHE LIMIT  ·  app/director.js — the story camera
// ----------------------------------------------------------------------------
//  The default view ('story'). It moves on the story's own signals, so a
//  run plays as one take:
//    approach  a wide shot of the planet and the point where the moon will
//              break up (planShots predicts it with a copy of the reference
//              orbit, drag included). As the moon closes in, the shot
//              trucks and pushes in to about 16 moon radii.
//    breakup   the camera rides with the moon in slow motion (pacing.js):
//              the target is the bound centre, with the moon's velocity as
//              a feed-forward, so the spring has no lag. The distance grows
//              with the spread of the debris.
//    spread    over 4 s the camera pulls out to the planet and rises above
//              the ring plane, to show the stream wind into a ring. It
//              starts from the last breakup shot and does not follow the
//              debris (which laps the planet in seconds at fast forward).
//  THE START ANGLE. The physics does not change if the whole start orbit
//  turns about the planet's axis (the planet, J2 and the rings are round).
//  planShots turns it so that the predicted breakup point lies AZ_LEAD
//  behind the view's azimuth. So the camera never swings round to find the
//  breakup: the first shot looks the way the planet view already looks.
//  The view direction turns only by slow, planned drifts (at most 3 deg/s)
//  and the springs; it never chases the moon round the planet. Up is +z,
//  no roll. A drag or a pinch adds to the shot (cam.az, cam.el, cam.zoom
//  are offsets from their scenario values here).
//  smoothStory() runs critically damped springs on the target, the log of
//  the distance, the azimuth and the elevation.
//
//  grep -n targets
//    prediction ...... "export function planShots"
//    shot goal ....... "export function storyGoal"
//    springs ......... "export function smoothStory"
// ============================================================================
import * as P from '../physics.js';
import { SCENARIOS } from '../scenarios.js';
import { cam } from './camera.js';
import { UI } from './env.js';
import { orbitsPerMin } from './loop.js';
import { satCentre, satState } from './sat.js';
import { S } from './state.js';

const AZ_LEAD = 1.15;        // rad: the eye stands this far ahead of the breakup point
const CLOSE_RS = 16;         // close shot: distance in moon radii
const PULL_S = 4;            // s: the pull-out to the ring
const DRIFT = { approach: 1.5, breakup: 3, spread: 2 };   // deg/s of slow azimuth drift

// After placeSats: where will the moon break up? A spiral: where the
// reference orbit (with its drag) first reaches 0.76 of the fluid limit
// (tests.mjs measured the first shed grains at 0.73 d_fluid). A flyby: the
// pericentre. Otherwise: 0.1 orbit ahead of the start.
export function planShots(opts = {}) {
  const run = S.run, s = run.sats[0], spec = run.spec, L = run.limits;
  const pl = Object.assign({}, s.pl), ref = new P.RefOrbit(pl, s.o.X, s.o.V);
  const dt = run.T0 / 400, dStop = 0.76 * L.fluid * s.Rp;
  let t = 0, best = null;
  if (spec.kind === 'spiral') {
    while (t < 1.5 * run.T0) { ref.step(dt); t += dt; if (Math.hypot(...ref.X) < spec.d1 * s.Rp) pl.drag = 0; if (Math.hypot(...ref.X) <= dStop) break; }
    best = ref.X.slice();
  } else if (spec.kind === 'flyby' && run.tPeri !== undefined) {
    while (t < run.tPeri) { ref.step(Math.min(dt, run.tPeri - t)); t += dt; }
    best = ref.X.slice();
  } else {
    while (t < 0.1 * run.T0) { ref.step(dt); t += dt; }
    best = ref.X.slice();
  }
  // turn the start (every moon, the same angle) so that the breakup
  // point is AZ_LEAD behind the view azimuth az0
  const az0 = opts.az ?? cam.az;
  const psi = az0 - AZ_LEAD - Math.atan2(best[1], best[0]);
  for (const q of run.sats) { rotZ(q.o.X, psi); rotZ(q.o.V, psi); rotZ(q.ref.X, psi); rotZ(q.ref.V, psi); }
  rotZ(best, psi);
  const Pb = best.map(q => q * s.k), r = Math.hypot(Pb[0], Pb[1]);
  const d0 = Math.hypot(...s.o.X) / s.Rp, dPb = Math.hypot(...best) / s.Rp;
  const half = 0.5 * Math.max(r, 1) + 1.15;
  run.shot = { Pb, d0, dPb, psi, az: az0, wideT: [Pb[0] * 0.45, Pb[1] * 0.45, 0], wideD: half / Math.tan(0.31), spreadAt: null, drift: 0 };
  cam.story = null;
}
function rotZ(v, a) { const c = Math.cos(a), s = Math.sin(a), x = v[0], y = v[1]; v[0] = c * x - s * y; v[1] = s * x + c * y; return v; }

function ease(u) { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); }

// The goal of the story camera now: { target, dist, az, el, vel } (world
// units, vel in world units per wall second, for the feed-forward).
export function storyGoal(dtReal) {
  const run = S.run, s = run.sats[0], sh = run.shot;
  const sc = SCENARIOS.find(x => x.key === UI.scen) || {};
  const azU = cam.az - 0.9, elU = cam.el - (sc.el ?? 0.42);
  const mode = run.pace ? run.pace.mode : 'approach';
  if (mode !== 'spread') sh.spreadAt = null;   // a scrub back in time
  sh.drift += (DRIFT[mode] || 0) * Math.PI / 180 * dtReal * (UI.paused ? 0 : 1);
  const Rw = (s.Rs || s.C.Rs) * s.k, close = CLOSE_RS * Rw;
  const live = s.an && s.an.live;
  const c = live || !s.an || !s.an.comAll ? satCentre(s) : [0, 1, 2].map(i => (s.ref.X[i] + s.an.comAll[i] + s.an.vcmAll[i] * (s.gpu.t - s.an.t)) * s.k);
  const simRate = UI.paused ? 0 : orbitsPerMin() / 60 * run.T0;
  const st = satState(s), vel = st.v.map(q => q * s.k * simRate);
  const ringD = 2.35 * (run.viewD || 2.5);
  let target, dist, el, v = [0, 0, 0];
  if (mode === 'approach') {
    // progress: by the distance closed, or (a moon that starts where it
    // breaks, as in the compare run) by time, over 0.15 orbit
    const d = Math.hypot(...c), span = sh.d0 - sh.dPb;
    const u = ease(span > 0.05 ? (sh.d0 - d) / span : run.t / (0.15 * run.T0));
    target = [0, 1, 2].map(i => sh.wideT[i] + (c[i] - sh.wideT[i]) * 0.6 * u);
    dist = Math.exp(Math.log(sh.wideD) + (Math.log(close * 1.4) - Math.log(sh.wideD)) * u);
    el = 0.26;
  } else if (mode === 'breakup') {
    const spread = s.an && s.an.spread ? s.an.spread * s.k : Rw;
    target = c; v = vel;
    dist = Math.max(close, 2.4 * spread);
    el = 0.30;
  } else {
    // the pull-out starts from where the shot was when the breakup ended,
    // not from the debris: at fast forward it laps the planet in seconds,
    // and a camera that went with it would swing round
    if (sh.spreadAt === null) {
      const spread = s.an && s.an.spread ? s.an.spread * s.k : Rw;
      sh.spreadAt = 0; sh.from = c.slice(); sh.near = Math.max(close, 2.4 * spread);
    }
    sh.spreadAt += dtReal;   // seconds of the pull-out so far (frame time)
    const u = ease(sh.spreadAt / PULL_S);
    target = [0, 1, 2].map(i => sh.from[i] * (1 - u));
    dist = Math.exp(Math.log(sh.near) + (Math.log(ringD) - Math.log(sh.near)) * u);
    el = 0.30 + (0.55 - 0.30) * u;
  }
  return { target, dist: dist * cam.zoom, az: sh.az + sh.drift + azU, el: Math.max(-1.4, Math.min(1.4, el + elU)), vel: v };
}

// Critically damped springs toward the goal g. w: the stiffness (1/s);
// the target spring also takes the goal's velocity (no lag on a moving
// moon). A user drag or pinch gets a stiff spring (it follows the hand).
export function smoothStory(g, dtReal, user) {
  const dt = Math.max(1e-3, Math.min(0.05, dtReal));
  let c = cam.story;
  if (!c) {
    // start from the view on screen (a mode switch or a new run), so the
    // first shot moves in; with no view yet, start on the goal
    const p = cam.pose;
    if (p) {
      const o = [0, 1, 2].map(i => p.eye[i] - p.target[i]), l = Math.hypot(...o);
      c = { t: p.target.slice(), tv: [0, 0, 0], ld: Math.log(l), ldv: 0, az: Math.atan2(o[1], o[0]), azv: 0, el: Math.asin(Math.max(-1, Math.min(1, o[2] / l))), elv: 0 };
    } else c = { t: g.target.slice(), tv: g.vel.slice(), ld: Math.log(g.dist), ldv: 0, az: g.az, azv: 0, el: g.el, elv: 0 };
    cam.story = c;
  }
  const wT = user ? 20 : 1.9, wA = user ? 20 : 1.3;
  for (let i = 0; i < 3; i++) {
    const a = wT * wT * (g.target[i] - c.t[i]) + 2 * wT * (g.vel[i] - c.tv[i]);
    c.tv[i] += a * dt; c.t[i] += c.tv[i] * dt;
  }
  { const a = wT * wT * (Math.log(g.dist) - c.ld) - 2 * wT * c.ldv; c.ldv += a * dt; c.ld += c.ldv * dt; }
  let dAz = g.az - c.az; dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
  { const a = wA * wA * dAz - 2 * wA * c.azv; c.azv += a * dt; c.az += c.azv * dt; }
  { const a = wA * wA * (g.el - c.el) - 2 * wA * c.elv; c.elv += a * dt; c.el += c.elv * dt; }
  return { target: c.t.slice(), dist: Math.exp(c.ld), az: c.az, el: c.el };
}

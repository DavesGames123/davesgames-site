// ============================================================================
//  ROCHE LIMIT  ·  app/saver.js — the screensaver
// ----------------------------------------------------------------------------
//  window.snSaver implements the lib/screensaver.js protocol. It plays the
//  reel of saver-plan.js: a seeded shuffle of runs (Saturn and an icy
//  moon, Mars and Phobos, Earth and the Moon, an ice giant, a comet at
//  Jupiter, a loose and a rough moon). Each run is one take of the story
//  clock (pacing.js: the breakup within about 2 s, then slow motion) and
//  the story camera (app/director.js), cut into four shots of 5-12 s:
//  wide (the approach and push in), close (the breakup from a second
//  angle), stream (low over the ring plane), ring (high above it).
//  A cut is hard (the offsets jump); a new run fades through black.
//  The subject is framed in the clear band of the plate (plateBand, in
//  app/occlusion.js). The plate has the Roche limits and the tide as TeX
//  and no code. S.saver holds the state while it runs.
//
//  grep -n targets
//    shot offsets ........ "export function saverCamera"
//    plate label ......... "function saverLabel"
//    next run ............ "function saverScenario"
//    shot clock .......... "function saverTick"
//    fade ................ "export function saverFade"
//    protocol ............ "window.snSaver"
// ============================================================================
import { SAVER_SPEED, timeWarp } from '../pacing.js';
import { makeReel, shotPlan, shotDone, rng } from '../saver-plan.js';
import { cam, resetCamStats, camStats } from './camera.js';
import { applyScenario, openPanel } from './controls.js';
import { debugState } from './debug.js';
import { $, UI, RM_Q } from './env.js';
import { orbitsPerMin } from './loop.js';
import { resize } from './quality.js';
import { fmtTime } from './readout.js';
import { limitsFor, currentSpec, startRun } from './runs.js';
import { satState } from './sat.js';
import { S, bootReady } from './state.js';
import { storyText } from './story.js';

// The offsets of the current shot on the story camera's goal g (after its
// springs, so a cut is a cut). prog: 0..1 through the shot (slow push).
export function saverCamera(g) {
  const sv = S.saver; if (!sv || !sv.shot) return;
  const sh = sv.shot, prog = Math.min(1, (performance.now() - sv.shotAt) / 1000 / sh.len);
  g.az += sh.side * sh.dAz;
  if (sh.el !== null) g.el = sh.el;
  g.dist *= sh.zoom * (1 - sh.push * prog * (1 - 0.5 * sv.calm));
}
function saverLabel() {
  if (!S.saver || !S.saver.opts.label || !S.run || S.run.phase !== 'orbit' || !S.run.sats[0].ref) return;
  const s = S.run.sats[0], L = S.run.limits || limitsFor(S.run.spec);
  const st = satState(s), dNow = Math.hypot(...st.r) / s.Rp;
  const bnd = S.run.sats.map(x => x.an ? (100 * x.an.f).toFixed(0) + '%' : '100%').join(' / ');
  const w = S.run.tUnitSec ? timeWarp(orbitsPerMin(), S.run.T0, S.run.tUnitSec) : 0;
  const slow = S.run.pace && S.run.pace.mode === 'breakup' && S.run.pace.factor < 0.7;
  S.saver.opts.label({
    title: 'Roche limit', sub: S.saver.run ? S.saver.run.title : '',
    params: [
      { sym: 'd/R_M', name: 'distance', value: dNow.toFixed(2), cls: 'm5' },
      { sym: 'd_\\mathrm{fluid}', name: 'Roche limit', value: L.fluid.toFixed(2) + ' R_M', cls: 'm1' },
      { sym: 'f_b', name: 'in one piece', value: bnd, cls: 'm3' },
    ],
    tex: [
      'd_\\mathrm{rigid} = R_M\\left(\\frac{2\\rho_M}{\\rho_m}\\right)^{1/3}',
      'd_\\mathrm{fluid} \\approx 2.44\\,R_M\\left(\\frac{\\rho_M}{\\rho_m}\\right)^{1/3}',
      'a_\\mathrm{tide} \\approx \\frac{2\\,G M\\,r}{d^{3}}',
    ],
    rules: [['d_\\mathrm{fluid}', 'm1'], ['R_M', 'm5']],
    eq: ['d_rigid = R_M (2 ρ_M/ρ_m)^(1/3)', 'd_fluid ≈ 2.44 R_M (ρ_M/ρ_m)^(1/3)', 'a_tide ≈ 2GMr/d³'],
    lines: [storyText(S.run.storyKey), `${s.N.toLocaleString()} grains · self-gravity and contacts on the GPU${w ? ` · 1 s = ${fmtTime(w)}${slow ? ' (slow motion)' : ''}` : ''}`],
    anchor: () => {
      const cs = $('gpu');
      const q = S.ren.project([0, 0, 0], cs.clientWidth, cs.clientHeight);
      if (!q) return null;
      return { x: q.x, y: q.y, r: Math.max(8, S.ren.focal / q.w / (S.ren.H / cs.clientHeight)) };
    },
  });
}
// The next run of the reel, with a fresh shot plan.
function saverScenario() {
  const sv = S.saver;
  if (!sv.queue.length) sv.queue = makeReel(sv.rnd, sv.run && sv.run.key);
  const run = sv.queue.shift();
  sv.run = run; sv.shots = shotPlan(sv.rnd); sv.si = 0; sv.shot = null; sv.breakupAt = null;
  // the view azimuth of this run: the sun stays where it is, so the
  // breakup is lit from the side by a seeded amount
  sv.cur = { key: run.key, az: 0.35 + 1.1 * sv.rnd() };
  UI.ringGain = 2; UI.rings = true; UI.real = true; UI.pred = false; UI.hill = false; UI.track = false; UI.blur = false; UI.ringOn = true;
  applyScenario(run.scen);
  // cam.az stays at its scenario value (0.9): the story camera reads it
  // as the user's offset; runs.js hands sv.cur.az to planShots instead
  UI.cam = 'story'; UI.color = 4; UI.field = 0;
  const spec = currentSpec();
  Object.assign(spec, run.spec);
  sv.speed = SAVER_SPEED * (sv.calm > 0.85 ? 0.8 : 1);
  sv.state = 'warm'; sv.warmAt = performance.now();
  sv.fadeTarget = 0;
  startRun(spec);
}
function cutTo(i) {
  const sv = S.saver;
  sv.si = i; sv.shot = sv.shots[i]; sv.shotAt = performance.now(); sv.breakupAt = null;
  if (S.run && S.run.pace && S.run.pace.mode !== 'approach') sv.breakupAt = 0;
  cam.cut = true;
}
// Twice a second: the warm-up, the shot clock and the plate.
function saverTick() {
  if (!S.saverOn) return;
  const sv = S.saver;
  if (sv.state === 'fadeout') { if (sv.fade <= 0.001) saverScenario(); return; }
  if (!S.run || S.run.phase !== 'orbit') return;
  if (sv.state === 'warm') {
    // the run starts at once (no fast-forward in the dark): the fade-in
    // shows the approach
    sv.state = 'show'; sv.fadeTarget = 1; cutTo(0);
    cam.pose = null; cam.story = null;
  }
  const el = (performance.now() - sv.shotAt) / 1000;
  if (sv.breakupAt === null && S.run.pace && S.run.pace.mode !== 'approach') sv.breakupAt = el;
  if (shotDone(sv.shot, el, { breakupAt: sv.breakupAt, ring: S.run.story.ring !== undefined })) {
    if (sv.si + 1 < sv.shots.length) cutTo(sv.si + 1);
    else { sv.state = 'fadeout'; sv.fadeTarget = 0; return; }
  }
  saverLabel();
}
// Called each frame by drawFrame: the fade, as an exposure factor.
export function saverFade(dt) {
  const sv = S.saver; if (!sv) return 1;
  const rate = sv.fadeTarget > sv.fade ? 0.7 : 0.9;   // 1.4 s in, 1.1 s out
  sv.fade += Math.sign(sv.fadeTarget - sv.fade) * Math.min(Math.abs(sv.fadeTarget - sv.fade), rate * dt);
  return sv.fade;
}
window.snSaver = {
  async enter(opts) {
    S.saverOn = true;
    await bootReady;
    document.documentElement.classList.add('sn-saver');
    openPanel(null);
    const calm = Math.max(Math.min(1, Math.max(0, opts.calm ?? 0.7)), RM_Q.matches ? 1 : 0);
    S.saver = { opts, rnd: rng(opts.seed), calm, queue: [], run: null, cur: null, shots: [], si: 0, shot: null, shotAt: performance.now(), fade: 0, fadeTarget: 0, state: 'warm', speed: SAVER_SPEED };
    // Reduce motion: the story camera gives way to the planet view
    if (RM_Q.matches) UI.calm = true;
    UI.paused = false;
    resetCamStats();
    UI.N = Math.min(UI.N, 8192);
    resize();
    saverScenario();
    S.saver.tick = setInterval(saverTick, 250);
    return { canvas: $('gpu'), warmupMs: 1500 };
  },
  exit() {
    S.saverOn = false;
    if (S.saver) clearInterval(S.saver.tick);
    S.saver = null;
    document.documentElement.classList.remove('sn-saver');
    resize();
  },
  // force the next shot (probes)
  cut() { const sv = S.saver; if (!sv || sv.state !== 'show') return false; if (sv.si + 1 < sv.shots.length) cutTo(sv.si + 1); else { sv.state = 'fadeout'; sv.fadeTarget = 0; } return true; },
  debug() { return S.saver ? { run: S.saver.run && S.saver.run.key, shot: S.saver.shot && S.saver.shot.kind, len: S.saver.shot && S.saver.shot.len, si: S.saver.si, state: S.saver.state, fade: S.saver.fade, pace: S.run && S.run.pace, camStats: Object.assign({}, camStats, { prev: undefined }), state2: debugState() } : null; },
};

// ============================================================================
//  ROCHE LIMIT  ·  app/saver.js — the screensaver
// ----------------------------------------------------------------------------
//  window.snSaver implements the lib/screensaver.js protocol. It plays the
//  reel of saver-plan.js: a seeded bag of takes (the six first stories,
//  the 15 presets of roll.js and 15 fresh random rolls, each with a seed
//  from the saver seed). No take plays twice in a row, and two takes in
//  a row do not share a planet when the bag can avoid it. Each take is
//  one run of the story clock (pacing.js) under the cutting director
//  (app/cuts.js): shots of 5-12 s that cut on the run's events (the first
//  crack, the breakup, the first lap of the ring, the first impact), from
//  a wide shot, from above, low over the ring plane, from the planet's
//  surface, a slow-motion push-in, a ride with a fragment, a time-lapse
//  of the ring. The take fades out when the director ends it.
//  Each take has a seeded grain colour: ice and heat, or origin, age or
//  tide strain (shaders/particles.wgsl), named on the plate.
//  The subject is framed in the clear band of the plate (plateBand, in
//  app/occlusion.js). The plate names the planet and the body, has the
//  Roche limits and the tide as TeX, the live distance, the bound share
//  and the numbers of the last event. No code.
//
//  grep -n targets
//    plate label ......... "function saverLabel"
//    next take ........... "function saverScenario"
//    take clock .......... "function saverTick"
//    fade ................ "export function saverFade"
//    protocol ............ "window.snSaver"
// ============================================================================
import { SAVER_SPEED, timeWarp } from '../pacing.js';
import { nextTake, rng, CUT_MAX } from '../saver-plan.js';
import { cam, resetCamStats, camStats } from './camera.js';
import { applyScenario, applyRoll, openPanel } from './controls.js';
import { presetSpec } from '../roll.js';
import { curShot } from './cuts.js';
import { debugState } from './debug.js';
import { $, UI, RM_Q } from './env.js';
import { orbitsPerMin } from './loop.js';
import { resize } from './quality.js';
import { fmtTime } from './readout.js';
import { limitsFor, currentSpec, startRun } from './runs.js';
import { satState } from './sat.js';
import { S, bootReady } from './state.js';
import { storyText } from './story.js';

// The grain colour of a take (seeded): mostly ice and heat.
const COLORS = [4, 4, 4, 6, 5, 2];
const COLOR_LINE = {
  6: 'Colour: where each grain started. Cyan faced the planet, amber faced away',
  5: 'Colour: orbits since each grain was torn off. White is new, violet is three orbits old',
  2: 'Colour: tide over self-gravity on each grain. Blue holds, amber is torn',
};
const SHOT_NAME = { push: 'slow motion', ride: 'riding with a fragment', surface: 'from the planet’s surface', lapse: 'time-lapse', impact: 'impact', skim: 'in the ring plane', top: 'from above' };

function fmtD(x) { return x >= 100 ? x.toFixed(0) : x.toFixed(2); }
// The planet and the body, with their densities.
function namesLine(spec) {
  if (spec.caption) return spec.caption;
  const Pn = spec.planetName || 'The planet', rs = spec.rhoS || 1, rp = (spec.q || 1) * rs;
  return `${Pn.charAt(0).toUpperCase() + Pn.slice(1)}: ρ ${rp.toFixed(2)} g/cm³ · moon: ρ ${rs.toFixed(2)} g/cm³, ${spec.material || 'fluid'}`;
}
// The numbers of the last event of the take, as one plate parameter.
function eventParam() {
  const lg = S.cuts && S.cuts.serial === S.run.serial ? S.cuts.log : {};
  if (lg.hits) return { sym: 'N_\\mathrm{hit}', name: 'grains hit the planet', value: lg.hits.toLocaleString(), cls: 'm3' };
  if (lg.ring) return { sym: 't_\\mathrm{ring}', name: 'first lap of the ring', value: lg.ring.t.toFixed(2) + ' orbits', cls: 'm3' };
  if (lg.torn) return { sym: 'd_\\mathrm{torn}', name: 'torn apart at', value: lg.torn.dL.toFixed(2) + ' d_fluid', cls: 'm1' };
  if (lg.crack) return { sym: 'd_\\mathrm{crack}', name: 'first crack at', value: lg.crack.dL.toFixed(2) + ' d_fluid', cls: 'm1' };
  return null;
}
function saverLabel() {
  if (!S.saver || !S.saver.opts.label || !S.run || S.run.phase !== 'orbit' || !S.run.sats[0].ref) return;
  const s = S.run.sats[0], spec = S.run.spec, L = S.run.limits || limitsFor(spec);
  const u = spec.bodyR || 1, st = satState(s), dNow = Math.hypot(...st.r) / s.Rp / u;
  const bnd = S.run.sats.map(x => x.an ? (100 * x.an.f).toFixed(0) + '%' : '100%').join(' / ');
  const w = S.run.tUnitSec ? timeWarp(orbitsPerMin(), S.run.T0, S.run.tUnitSec) : 0;
  const sh = curShot(), mode = sh && SHOT_NAME[sh.kind];
  const slow = S.run.pace && S.run.pace.mode === 'breakup' && S.run.pace.factor < 0.7;
  const how = mode || (slow ? 'slow motion' : '');
  const params = [
    { sym: 'd/R_M', name: 'distance', value: fmtD(dNow), cls: 'm5' },
    { sym: 'd_\\mathrm{fluid}', name: 'Roche limit', value: fmtD(L.fluid / u) + ' R_M', cls: 'm1' },
    { sym: 'f_b', name: 'in one piece', value: bnd, cls: 'm3' },
  ];
  const ep = eventParam(); if (ep) params.push(ep);
  const lines = [namesLine(spec), storyText(S.run.storyKey),
    `${S.run.sats.reduce((a, q) => a + q.N, 0).toLocaleString()} grains · self-gravity and contacts on the GPU${w ? ` · 1 s = ${fmtTime(w)}${how ? ` (${how})` : ''}` : ''}`];
  if (COLOR_LINE[UI.color]) lines.push(COLOR_LINE[UI.color]);
  S.saver.opts.label({
    title: 'Roche limit', sub: S.saver.entry ? S.saver.entry.title : '',
    params,
    tex: [
      'd_\\mathrm{rigid} = R_M\\left(\\frac{2\\rho_M}{\\rho_m}\\right)^{1/3}',
      'd_\\mathrm{fluid} \\approx 2.44\\,R_M\\left(\\frac{\\rho_M}{\\rho_m}\\right)^{1/3}',
      'a_\\mathrm{tide} \\approx \\frac{2\\,G M\\,r}{d^{3}}',
    ],
    rules: [['d_\\mathrm{fluid}', 'm1'], ['R_M', 'm5']],
    eq: ['d_rigid = R_M (2 ρ_M/ρ_m)^(1/3)', 'd_fluid ≈ 2.44 R_M (ρ_M/ρ_m)^(1/3)', 'a_tide ≈ 2GMr/d³'],
    lines,
    // the leader line points at the shot's subject: the camera target
    anchor: () => {
      const cs = $('gpu'), t = cam.pose ? cam.pose.target : [0, 0, 0];
      const q = S.ren.project(t, cs.clientWidth, cs.clientHeight);
      if (!q) return null;
      return { x: q.x, y: q.y, r: Math.max(8, S.ren.focal * (S.run.spec.bodyR || 1) * 0.1 / q.w / (S.ren.H / cs.clientHeight)) };
    },
  });
}
// The next take of the reel.
function saverScenario() {
  const sv = S.saver;
  const e = nextTake(sv.reel);
  UI.ringGain = 2; UI.rings = true; UI.real = true; UI.pred = false; UI.hill = false; UI.track = false; UI.blur = false; UI.ringOn = true;
  // the view azimuth of this take: the sun stays where it is, so the
  // breakup is lit from the side by a seeded amount
  sv.cur = { key: e.key, az: 0.35 + 1.1 * sv.rnd() };
  let title = e.title;
  if (e.kind === 'story') {
    applyScenario(e.scen);
  } else {
    const r = e.kind === 'preset' ? presetSpec(e.preset) : e.spec;
    applyRoll(r);
    title = r.title;
  }
  sv.entry = Object.assign({}, e, { title });
  // cam.az stays at its scenario value (0.9): the story camera reads it
  // as the user's offset; runs.js hands sv.cur.az to planShots instead
  UI.cam = 'story'; UI.field = 0;
  UI.color = COLORS[Math.floor(sv.rnd() * COLORS.length)];
  const spec = currentSpec();
  if (e.kind === 'story') Object.assign(spec, e.spec);
  sv.speed = SAVER_SPEED * (sv.calm > 0.85 ? 0.8 : 1);
  sv.state = 'warm'; sv.warmAt = performance.now();
  sv.fadeTarget = 0;
  S.cuts = null;
  startRun(spec);
}
// Four times a second: the warm-up, the end of the take and the plate.
// The shot clock itself runs each frame (app/cuts.js cutsTick).
function saverTick() {
  if (!S.saverOn) return;
  const sv = S.saver;
  if (sv.state === 'fadeout') { if (sv.fade <= 0.001) saverScenario(); return; }
  if (!S.run || S.run.phase !== 'orbit') return;
  if (sv.state === 'warm') {
    // the run starts at once (no fast-forward in the dark): the fade-in
    // shows the approach
    sv.state = 'show'; sv.fadeTarget = 1;
    cam.pose = null; cam.story = null;
  }
  if (S.cuts && S.cuts.serial === S.run.serial && S.cuts.take.done) { sv.state = 'fadeout'; sv.fadeTarget = 0; return; }
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
    const rnd = rng(opts.seed);
    S.saver = { opts, rnd, calm, reel: { rnd, bag: null, last: null }, entry: null, cur: null, fade: 0, fadeTarget: 0, state: 'warm', speed: SAVER_SPEED };
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
    S.saver = null; S.cuts = null;
    document.documentElement.classList.remove('sn-saver');
    resize();
  },
  // force the next shot (probes)
  cut() { const tk = S.cuts && S.cuts.take; if (!S.saver || S.saver.state !== 'show' || !tk || !tk.shot) return false; tk.el = CUT_MAX; return true; },
  debug() {
    const tk = S.cuts && S.cuts.take, sh = tk && tk.shot;
    return S.saver ? { take: S.saver.entry && S.saver.entry.key, title: S.saver.entry && S.saver.entry.title, shot: sh && sh.kind, phase: sh && sh.phase, len: sh && sh.len, el: tk && tk.el, shots: tk ? tk.shots.map(x => x.kind) : [], log: S.cuts && S.cuts.log, state: S.saver.state, fade: S.saver.fade, pace: S.run && S.run.pace, color: UI.color, camStats: Object.assign({}, camStats, { prev: undefined }), state2: debugState() } : null;
  },
};

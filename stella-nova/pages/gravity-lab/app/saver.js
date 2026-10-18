// ============================================================================
//  GRAVITY LAB  ·  app/saver.js — the screensaver (lib/screensaver.js protocol)
// ----------------------------------------------------------------------------
//  window.snSaver = { enter(opts), exit, cut, debug }. enter hides the GUI,
//  draws the reel (saver-plan.js makeReel: a seeded shuffle bag of library
//  variants and random rolls) and plays each run as RUN_SHOTS shots of
//  5-12 s. The shot gives the angle; director.js gives the aim:
//    action    when the director has a pair in focus (a close pass, a
//              capture, a merge, a breakup), every shot frames that pair
//              and its recent trails. A push goes from the whole system
//              to the pair.
//    calm      establish and top frame the bound system (centre of mass);
//              push, follow and low frame the subject and its recent
//              trail. The subject is the body with the largest
//              acceleration (pickSubject), never a body that has left.
//    events    a merge, a breakup, a hit, a capture, an ejection or a close
//              periapsis cuts to a close shot of it in slow motion (a
//              merge or a breakup after 3 s of the shot, the rest after
//              5 s: saver-plan.js eventWait). A stale event is dropped and
//              the same event of the same pair cuts once in 45 s.
//    framing   saver-plan.js shotFrame picks the framing of each shot kind
//              from the director (the calm view of the action camera,
//              focus.js, as on the page); stepCam (director.js) fits it in the clear band of
//              the plate (plateBand, lib/saver-clear.js) at the real
//              aspect (16:9, or the 9:16 column), with a lens shift to
//              the band centre.
//  The plate has the run's title, a law in TeX (Newton, vis-viva or the
//  Jacobi integral, saver-plan.js lawFor) with the run's own equation,
//  live numbers in real units, and the last event. No code.
//  A new run fades through black; a cut inside a run is hard.
//
//  grep -n targets: "function nextRun", "function cutTo", "function closeFrame", "export function saverFrame",
//  "function tick", "function plate", "function onEvent", "window.snSaver"
// ============================================================================
import { makeReel, shotPlan, shotDone, eventWorth, eventWait, eventKey, pickSubject, shotGoal, shotFrame, tooFast, lawFor, mk, rng, CUT_MAX, EVENT_STALE, EVENT_REPEAT } from '../saver-plan.js';
import { plateBand } from '../../../lib/saver-clear.js';
import { S, UI, $, RM_Q, bus, bootReady } from './state.js';
import { cam } from './camera.js';
import { frameSet, ringTail, DIR } from '../director.js';
import { startRun, fmtTime, fmtSpeed, fmtLen } from './run.js';
import { toFrame } from '../frame.js';
import { dominant } from '../items.js';
import { v3 } from '../nbody.js';
import { closePanels, resizeNow, refreshRun } from './ui.js';

const SAVER_SPEED = 1.3;

function nextRun() {
  const sv = S.saver;
  if (!sv.queue.length) sv.queue = makeReel(sv.rnd() * 4294967296 >>> 0, sv.lastKey);
  let choice = sv.queue.shift();
  let spec = null;
  for (let tries = 0; tries < 4 && !spec; tries++) {
    try { spec = startRun(choice.type === 'roll' ? choice : { type: 'library', key: choice.key, variant: choice.variant, seed: (sv.rnd() * 1e9) >>> 0 }); }
    catch (e) { console.warn('saver run', choice, e); choice = { type: 'roll', seed: (sv.rnd() * 1e9) >>> 0 }; }
  }
  sv.lastKey = choice.key || 'roll' + choice.seed;
  sv.shots = shotPlan(sv.rnd, !!spec.self);
  sv.si = -1; sv.runAt = performance.now(); sv.lastEvent = null; sv.eventCut = null; sv.pendingEvent = null; sv.cutKeys = new Map();
  UI.trails = true; UI.colorMode = 0; S.follow = -1; S.sel = -1;
  sv.fadeTarget = 1;
  cutTo(0);
}
function cutTo(i, shot) {
  const sv = S.saver;
  sv.si = i; sv.shot = shot || sv.shots[i]; sv.shotAt = performance.now();
  sv.subject = -1;
  const sys = S.lab && S.lab.sys;
  if (sys && sys.n) {
    const d = S.dirNow;
    if (sv.shot.event && sv.eventCut) {
      // the event's body that is still in the system (the director has
      // the pair in focus through its boost)
      const e = sv.eventCut.e, live = k => k !== undefined && sys.alive[k] && !(d && d.gone && d.gone[k]);
      sv.subject = d && d.mode !== 'calm' ? d.i : live(e.j) && e.type !== 'merge' ? e.j : live(e.i) ? e.i : -1;
      sv.eventText = sv.eventCut.text;
    } else if (sv.shot.subject || sv.shot.track) sv.subject = d && d.mode !== 'calm' ? d.i : pickSubject(bodyStats(sys, d), sv.rnd);
    sv.eventPos = null;
  } else {
    // a run without bodies: a random point in the disk
    const a = sv.rnd() * 2 * Math.PI, r = (0.3 + 0.4 * sv.rnd()) * S.spec.view.extent; sv.eventPos = [r * Math.cos(a), r * Math.sin(a), 0];
  }
  cam.cut = true;
}
function bodyStats(sys, d) {
  const dom = dominant(sys), out = [], rate = S.spec.rate * (S.saverSpeed || 1);
  for (let i = 0; i < sys.n; i++) out.push({ i, alive: !!sys.alive[i] && !(d && d.gone && d.gone[i]), m: sys.m[i], a: Math.hypot(sys.a[3 * i], sys.a[3 * i + 1], sys.a[3 * i + 2]), dom: dom && dom.i === i, fast: !!dom && dom.i !== i && tooFast(omegaAbout(sys, i, dom.i), rate) });
  return out;
}
// the angular rate of body i about body j (rad per sim time)
function omegaAbout(sys, i, j) {
  const r = v3.sub(sys.pos(i), sys.pos(j)), v = v3.sub(sys.vel(i), sys.vel(j));
  return v3.len(v3.cross(r, v)) / Math.max(1e-300, v3.dot(r, r));
}
// The close framing of a shot: the director's pair when there is action,
// else the subject and its recent trail, else the calm view.
function closeFrame(d) {
  const sv = S.saver, sys = S.lab.sys;
  if (d.mode !== 'calm') return d;
  const i = sv.subject;
  if (sys && i >= 0 && sys.alive[i] && !(d.gone && d.gone[i])) {
    const rNow = S.meta.map(m => m.rNow ?? m.rDraw);
    const f = frameSet(sys, S.frame, [i], S.spec.view.extent, rNow, k => ringTail(S.trails[k], DIR.TRAIL_K));
    // at least an eighth of the calm view: the subject with room to move
    const r = Math.min(d.calm.radius, Math.max(f.radius, 0.12 * S.spec.view.extent));
    return { mode: 'one', i, j: -1, target: f.target, radius: r };
  }
  return d;
}
// Each frame (main loop, after the director): the camera goal, the slow
// motion, the fade.
export function saverFrame(dt) {
  const sv = S.saver; if (!sv || !S.spec) return;
  const W = $('gpu').clientWidth, H = $('gpu').clientHeight;
  const sh = sv.shot, el = (performance.now() - sv.shotAt) / 1000, u = Math.min(1, el / sh.len);
  const g0 = shotGoal(sh, u);
  const ext = S.spec.view.extent;
  const d = S.dirNow || { mode: 'calm', i: -1, j: -1, target: [0, 0, 0], radius: ext, calm: { target: [0, 0, 0], radius: ext } };
  // the action takes every shot: the subject is the pair's first body
  if (d.mode !== 'calm' && sv.subject !== d.i && sv.subject !== d.j) sv.subject = d.i;
  let frame, zoomK = 1, az = g0.az, el0 = g0.el;
  if (sv.eventPos) { frame = { mode: 'point', i: -1, j: -1, target: sv.eventPos, radius: 0.6 * ext }; zoomK = g0.distK; }
  else {
    // the same framing as the page (director.js and focus.js), by shot
    // kind: saver-plan.js shotFrame
    const f = shotFrame(sh, u, d, sh.kind === 'establish' || sh.kind === 'top' ? d : closeFrame(d), sv.calm);
    frame = f.frame; zoomK = f.zoomK; az = f.az; el0 = f.el;
  }
  // the clear band of the plate: plateBand measures the plate text in the
  // parent document (a layout read): 4 times a second is enough, as in
  // roche-limit/app/occlusion.js. stepCam sizes from it and the real W / H.
  const now = performance.now();
  if (!(now - (sv.bandAt || 0) < 250) || sv.bandH !== H) { sv.bandAt = now; sv.bandH = H; sv.band = plateBand(H); }
  sv.goal = { az, el: el0, frame, band: sv.band, zoomK: sv.eventPos && sh.kind !== 'establish' && sh.kind !== 'top' ? zoomK * (1 + 0.15 * sv.calm) : zoomK };
  // slow motion in an event shot: in over 0.6 s, out over the last 1.5 s
  const slowGoal = sh.slow < 1 ? (el < sh.len - 1.5 ? sh.slow : 1) : 1;
  sv.speed += (slowGoal - sv.speed) * Math.min(1, dt * 2.5);
  S.saverSpeed = SAVER_SPEED * sv.speed * (1 - 0.35 * sv.calm);
  // fade
  const rate = sv.fadeTarget > sv.fade ? 0.8 : 1.0;
  sv.fade += Math.sign(sv.fadeTarget - sv.fade) * Math.min(Math.abs(sv.fadeTarget - sv.fade), rate * dt);
  S.ren.exposure = sv.fade;
}
// Four times a second: the shot clock, the run clock, the plate.
function tick() {
  const sv = S.saver; if (!sv || !S.saverOn) return;
  if (sv.state === 'fadeout') { if (sv.fade <= 0.002) { sv.state = 'show'; nextRun(); } return; }
  const now = performance.now(), el = (now - sv.shotAt) / 1000, pe = sv.pendingEvent;
  if (pe && now - pe.at > EVENT_STALE * 1000) sv.pendingEvent = null;
  if (sv.pendingEvent && !sv.shot.event && el >= eventWait(eventWorth(pe.e, S.spec.view.extent))) {
    sv.eventCut = pe; sv.pendingEvent = null;
    sv.cutKeys.set(eventKey(pe.e), now);
    cutTo(sv.si, mk('close', sv.rnd));
  } else if (shotDone(sv.shot, el) || (sv.shot.event && el >= CUT_MAX)) {
    sv.eventCut = null;
    if (sv.si + 1 < sv.shots.length) cutTo(sv.si + 1);
    else { sv.state = 'fadeout'; sv.fadeTarget = 0; }
  }
  plate();
}
function onEvent(d) {
  const sv = S.saver; if (!sv || !S.saverOn || sv.state !== 'show') return;
  const w = eventWorth(d.e, S.spec.view.extent);
  if (!w) return;
  sv.lastEvent = d;
  const seen = sv.cutKeys && sv.cutKeys.get(eventKey(d.e));
  if (seen !== undefined && d.at - seen < EVENT_REPEAT * 1000) return;
  if (!sv.pendingEvent || w >= eventWorth(sv.pendingEvent.e, S.spec.view.extent)) sv.pendingEvent = d;
}
function plate() {
  const sv = S.saver; if (!sv.opts.label || !S.spec) return;
  const spec = S.spec, sys = S.lab.sys, U = spec.scale || { L: 1, V: 1, T: 1 };
  const law = lawFor(spec);
  const params = [{ sym: 't', name: 'time', value: fmtTime(S.lab.t * U.T), cls: 'm5' }];
  if (sys) {
    const nb = Array.from(sys.alive).filter(Boolean).length;
    params.push({ sym: 'N_\\mathrm{bodies}', name: 'bodies', value: String(nb), cls: 'm3' });
    const i = sv.subject, dom = dominant(sys);
    if (i >= 0 && sys.alive[i] && dom && dom.i !== i) {
      const dv = v3.len(v3.sub(sys.vel(i), dom.v)), dr = v3.len(v3.sub(sys.pos(i), dom.x));
      params.push({ sym: 'v', name: S.meta[i].name + ' speed', value: fmtSpeed(dv * U.V), cls: 'm1' });
      params.push({ sym: 'r', name: 'from ' + S.meta[dom.i].name, value: fmtLen(dr * U.L), cls: 'm2' });
    }
  }
  const np = (spec.self || spec.particles || { n: 0 }).n;
  const lines = [];
  if (sv.lastEvent && performance.now() - sv.lastEvent.at < 12000) lines.push(sv.lastEvent.text);
  lines.push(`${np.toLocaleString('en-US')} particles on the GPU · ${spec.notes && spec.notes[0] ? spec.notes[0] : 'real Newtonian gravity'}`);
  const tex = [law.tex];
  if (spec.tex && spec.tex[0] && spec.tex[0] !== law.tex) tex.push(spec.tex[0]);
  sv.opts.label({
    title: spec.title, sub: firstSentence(spec.blurb) || `Gravity lab · ${law.name}`,
    params, tex, rules: [['G', 'm4'], ['v', 'm1'], ['r', 'm2']], eq: [], lines,
    anchor: () => {
      if (!S.saver || !S.ren) return null;
      const cv = $('gpu'), k = S.ren.W / cv.clientWidth;
      let p = sv.eventPos;
      if (sys && sv.subject >= 0 && sys.alive[sv.subject]) p = toFrame(S.frame, sys.pos(sv.subject));
      if (!p) return null;
      const q = S.ren.project(p); if (!q) return null;
      return { x: q.x / k, y: q.y / k, r: 18 };
    },
  });
}
// the blurb's first sentence when it is short enough for the plate
function firstSentence(t) {
  if (!t) return '';
  const m = /^(.+?[.!?])(\s|$)/.exec(t), s = m ? m[1] : t;
  return s.length <= 140 ? s : '';
}
bus('event', onEvent);

window.snSaver = {
  async enter(opts = {}) {
    S.saverOn = true;
    try { await bootReady; } catch (e) { S.saverOn = false; throw e; }
    document.documentElement.classList.add('sn-saver');
    closePanels();
    UI.item = null; S.aim = null;
    const calm = Math.max(Math.min(1, Math.max(0, opts.calm ?? 0.7)), RM_Q.matches ? 1 : 0);
    S.saver = { opts, rnd: rng((opts.seed >>> 0) || ((Math.random() * 4294967296) >>> 0)), calm, queue: [], shots: [], si: 0, shot: null, shotAt: performance.now(), fade: 0, fadeTarget: 0, state: 'show', speed: 1, goal: null, lastKey: null };
    UI.paused = false;
    resizeNow();
    nextRun();
    S.saver.tick = setInterval(tick, 250);
    return { canvas: $('gpu'), warmupMs: 1200 };
  },
  exit() {
    S.saverOn = false;
    if (S.saver) clearInterval(S.saver.tick);
    S.saver = null; S.saverSpeed = 1;
    if (S.ren) S.ren.exposure = 1;
    document.documentElement.classList.remove('sn-saver');
    resizeNow();
    refreshRun();
  },
  cut() { const sv = S.saver; if (!sv) return false; if (sv.si + 1 < sv.shots.length) cutTo(sv.si + 1); else { sv.state = 'fadeout'; sv.fadeTarget = 0; } return true; },
  debug() { const sv = S.saver; return sv ? { title: S.spec && S.spec.title, shot: sv.shot && sv.shot.kind, si: sv.si, n: sv.shots.length, subject: sv.subject, fade: sv.fade, speed: S.saverSpeed, state: sv.state, queue: sv.queue.length } : null; },
};

// ============================================================================
//  GRAVITY LAB  ·  app/saver.js — the screensaver (lib/screensaver.js protocol)
// ----------------------------------------------------------------------------
//  window.snSaver = { enter(opts), exit, cut, debug }. enter hides the GUI,
//  draws the reel (saver-plan.js makeReel: a seeded shuffle bag of library
//  variants and random rolls) and plays each run as RUN_SHOTS shots of
//  5-12 s. The director is data-driven:
//    subject   the body with the largest acceleration now (pickSubject),
//              picked again at each cut
//    events    a merge, a breakup, a hit, a capture, an ejection or a close
//              periapsis cuts to a close shot of it in slow motion (a
//              merge or a breakup after 3 s of the shot, the rest after
//              5 s: saver-plan.js eventWait). A stale event is dropped and
//              the same event of the same pair cuts once in 45 s.
//    framing   the subject sits in the clear band of the plate (plateBand,
//              lib/saver-clear.js): a lens shift moves it there and the
//              distance grows with the band. A follow or a close shot
//              locks the camera target on the subject (goal.lock), so a
//              fast body stays in a tight frame. A push goes from the
//              whole scene to the subject. A close shot also keeps the
//              event's reach in frame (sv.eventReach: the other body of
//              the pair, or the debris of a breakup).
//  The plate has the run's title, a law in TeX (Newton, vis-viva or the
//  Jacobi integral, saver-plan.js lawFor) with the run's own equation,
//  live numbers in real units, and the last event. No code.
//  A new run fades through black; a cut inside a run is hard.
//
//  grep -n targets: "function nextRun", "function cutTo", "export function saverFrame",
//  "function tick", "function plate", "function onEvent", "window.snSaver"
// ============================================================================
import { makeReel, shotPlan, shotDone, eventWorth, eventWait, eventKey, pickSubject, shotGoal, lawFor, mk, rng, CUT_MAX, EVENT_STALE, EVENT_REPEAT } from '../saver-plan.js';
import { plateBand } from '../../../lib/saver-clear.js';
import { S, UI, $, RM_Q, bus, bootReady } from './state.js';
import { cam, fitDist } from './camera.js';
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
  if (sys && (sv.shot.subject || sv.shot.track)) sv.subject = pickSubject(bodyStats(sys), sv.rnd);
  if (sv.shot.event && sv.eventCut) {
    const e = sv.eventCut;
    sv.subject = e.e.j !== undefined && sys && sys.alive[e.e.j] && e.e.type !== 'merge' ? e.e.j : (e.e.i !== undefined && sys && sys.alive[e.e.i] ? e.e.i : -1);
    sv.eventPos = e.pos ? toFrame(S.frame, e.pos) : null;
    sv.eventText = e.text;
    sv.eventReach = sys ? eventReach(sys, e.e, sv.subject, e.pos) : 0;
  } else { sv.eventPos = null; sv.eventReach = 0; }
  // a random point in the disk for a run without bodies
  if (!sys || !sys.n) { const a = sv.rnd() * 2 * Math.PI, r = (0.3 + 0.4 * sv.rnd()) * S.spec.view.extent; sv.eventPos = [r * Math.cos(a), r * Math.sin(a), 0]; }
  cam.cut = true;
}
// The size a close shot must show: the gap to the other body of a pair
// event, or the distance from the subject to a breakup point (the debris
// orbits there). 0: the subject's own scale is enough.
function eventReach(sys, e, subj, pos) {
  if (subj < 0 || !sys.alive[subj]) return 0;
  const x = sys.pos(subj);
  if (/^(capture|release|periapsis)$/.test(e.type)) {
    const o = e.i === subj ? e.j : e.i;
    return o !== undefined && sys.alive[o] ? 1.25 * v3.len(v3.sub(sys.pos(o), x)) : 0;
  }
  if (e.type === 'breakup' && pos) return 1.4 * v3.len(v3.sub(pos, x));
  return 0;
}
function bodyStats(sys) {
  const dom = dominant(sys), out = [];
  for (let i = 0; i < sys.n; i++) out.push({ i, alive: !!sys.alive[i], m: sys.m[i], a: Math.hypot(sys.a[3 * i], sys.a[3 * i + 1], sys.a[3 * i + 2]), dom: dom && dom.i === i });
  return out;
}
// The size of the subject: a few times its radius, or the gap to its
// nearest neighbour, never under 4% of the view.
function subjectScale(i) {
  const sys = S.lab.sys, ext = S.spec.view.extent, x = sys.pos(i);
  let near = Infinity;
  for (let j = 0; j < sys.n; j++) if (j !== i && sys.alive[j] && sys.m[j] > sys.m[i]) near = Math.min(near, v3.len(v3.sub(sys.pos(j), x)));
  const r = S.meta[i] ? S.meta[i].rDraw : 0;
  return Math.max(0.04 * ext, Math.min(ext, Math.max(10 * r, 0.6 * (isFinite(near) ? near : ext))));
}
// Each frame (main loop): the camera goal, the slow motion, the fade.
export function saverFrame(dt) {
  const sv = S.saver; if (!sv || !S.spec) return;
  const W = $('gpu').clientWidth, H = $('gpu').clientHeight;
  const sh = sv.shot, el = (performance.now() - sv.shotAt) / 1000, u = Math.min(1, el / sh.len);
  const g0 = shotGoal(sh, u);
  const ext = S.spec.view.extent, sys = S.lab.sys;
  let target = [0, 0, 0], scale = ext, distK = g0.distK, lock = false, reach = 0;
  if (sv.eventPos) { target = sv.eventPos.slice(); scale = ext * 0.6; }
  if (sys && sv.subject >= 0 && sys.alive[sv.subject] && (sh.subject || sh.track || sh.event)) {
    const p = toFrame(S.frame, sys.pos(sv.subject)), sc = subjectScale(sv.subject) * 2.2;
    if (sh.track || sh.event) {
      // the target is the subject now (not the old event point), locked
      target = p; scale = sc; lock = true;
      if (sh.event) reach = sv.eventReach || 0;
    } else if (sh.kind === 'push') {
      // from the whole scene to the subject: the target moves onto it and
      // the framing shrinks from the extent to about 12 radii of the
      // subject (between 4% and 30% of the extent)
      const pe = Math.min(0.3 * ext, Math.max(0.04 * ext, 12 * S.meta[sv.subject].rDraw));
      const e = u * u * (3 - 2 * u), k = Math.log(Math.min(1, pe / (ext * sh.zoom)));
      target = v3.mul(p, 0.55 + 0.45 * e);
      scale = ext; distK = sh.zoom * Math.exp(k * e);
    } else target = v3.mul(p, 0.55);   // low: between the centre and the subject
  }
  // the clear band of the plate: lens shift and a longer distance
  const band = plateBand(H);
  let shiftY = 0, kBand = 1;
  if (band) {
    const yc = (band.t + (H - band.b)) / 2, fr = Math.max(0.3, (H - band.t - band.b) / H);
    shiftY = -(yc - H / 2) / (H / 2);
    kBand = 1 / Math.min(1, fr * 1.25);
  }
  const calmK = 1 + 0.3 * sv.calm;
  let dist = fitDist(scale, W, H) * distK * kBand * (sh.kind === 'establish' || sh.kind === 'top' ? 1 : calmK);
  if (reach > 0) dist = Math.max(dist, fitDist(reach, W, H) * kBand);
  sv.goal = { az: g0.az, el: g0.el, dist, target, shiftY, lock };
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

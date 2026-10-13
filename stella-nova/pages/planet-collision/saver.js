// ============================================================================
//  PLANET COLLISION  ·  saver.js — the screensaver director
// ----------------------------------------------------------------------------
//  installSaver(api) sets window.snSaver (the lib/screensaver.js protocol:
//  enter(opts) -> { canvas, warmupMs }, exit()). It plays the reel of
//  saver-plan.js: a seeded shuffle of all presets and five random draws.
//  Each run is one take cut into shots of 5-12 s (approach, slow-motion
//  impact, splash, ejecta fly-through, a late cutaway, disk). The cuts
//  follow the solver's events: first contact ends the approach and drops the speed to
//  x1/4 at once; escaping mass brings the ejecta shot forward.
//
//  The director is S.dir (main.js reads it in fn frame and fn frameOf):
//    tick(now, dt)  the fade, the run state, the shot clock, the plate
//    view(v, now)   the shot's offsets on the auto-framed view (yaw from
//                   the contact-facing side, pitch, zoom with the push-in,
//                   the follow point; saver-plan.js fn shotView; a hard
//                   cut: no spring between shots)
//    band()         the plate's clear band (lib/saver-clear.js plateBand);
//                   main.js fn bandView frames the subject in it
//    event(kind)    'contact' from main.js fn onStats; a contact in a
//                   later shot cuts back to the impact (fn contactCut)
//    mode, cut, sun, exposure   the display state of the shot
//  A new run starts while the frame is black (exposure 0) and fades in
//  when the relax ends.
//
//  grep -n targets
//    next run ........ "function nextRun"
//    cut ............. "function cutTo"
//    clock ........... "function tick"
//    camera .......... "function view"
//    plate ........... "function label"
//    protocol ........ "window.snSaver"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { makeReel, runScenario, shotPlan, shotDone, pickNext, contactCut, shotView, plateInfo, rng } from './saver-plan.js';
import { norm } from './render.js';

const LABEL_MS = 500, BAND_MS = 500;

export function installSaver(api) {
  const { S, startRun, setSpeed } = api;
  const $ = id => document.getElementById(id);
  let sv = null;

  function nextRun() {
    if (!sv.queue.length) sv.queue = makeReel(sv.rnd, sv.run && sv.run.key);
    sv.run = sv.queue.shift();
    const { sc, seed } = runScenario(sv.run, sv.rnd);
    sv.shots = shotPlan(sv.rnd); sv.si = -1; sv.shot = null;
    sv.ev = { contactAt: null }; sv.contactWall = null; sv.runs++;
    // the sun of this run (seeded): the impact is lit from the side by a
    // different amount each run; main.js startRun takes the camera side
    // from it (view.js sideFor), and the yaw follows the contact
    const a = 0.3 + 1.0 * sv.rnd();
    sv.sun = norm([Math.cos(a), 0.6 * Math.sin(a), 0.2 + 0.3 * sv.rnd()]);
    sv.state = 'warm'; sv.fadeTarget = 0; sv.warp = 0; sv.warpAt = null;
    S.paused = false; setSpeed(2);
    dir.mode = 0; dir.cut = false; dir.sun = sv.sun;
    startRun(sc, seed, { link: false });
  }
  function cutTo(i, now) {
    sv.si = i; sv.shot = sv.shots[i]; sv.shotAt = now;
    sv.ev.contactAt = S.contact ? 0 : null;
    const k = sv.shot.kind;
    setSpeed(k === 'impact' && !S.contact ? 2 : k === 'approach' && S.contact ? 0.25 : sv.shot.speed);
    dir.mode = sv.shot.cut ? sv.shot.mode : 0; dir.cut = !!sv.shot.cut;
    sv.labelAt = 0;
  }
  function tick(now, dt) {
    if (!sv) return;
    const rate = sv.fadeTarget > sv.fade ? 0.8 : 1.0;
    sv.fade += Math.sign(sv.fadeTarget - sv.fade) * Math.min(Math.abs(sv.fadeTarget - sv.fade), rate * dt);
    dir.exposure = sv.fade;
    if (now - sv.bandAt > BAND_MS) { sv.bandAt = now; sv.band = plateBand(innerHeight) || { t: 0, b: 0 }; }
    if (sv.state === 'fadeout') { if (sv.fade <= 0.001) nextRun(); return; }
    if (sv.state === 'warm') {
      if (S.phase !== 'run') return;
      sv.state = 'show'; sv.fadeTarget = 1; cutTo(0, now);
    }
    // the time warp: sim seconds per wall second
    if (S.stats) {
      if (!sv.warpAt) sv.warpAt = { now, t: S.stats.tSec };
      else if (now - sv.warpAt.now > 1000) {
        const w = (S.stats.tSec - sv.warpAt.t) / ((now - sv.warpAt.now) / 1000);
        sv.warp = sv.warp ? sv.warp + 0.5 * (w - sv.warp) : w; sv.warpAt = { now, t: S.stats.tSec };
      }
    }
    const el = (now - sv.shotAt) / 1000;
    if (shotDone(sv.shot, el, sv.ev)) {
      const esc = S.out ? S.out.Me / S.out.Mtot : 0;
      const j = pickNext(sv.shots, sv.si, esc, sv.contactWall == null ? null : (now - sv.contactWall) / 1000);
      if (j < 0) { sv.state = 'fadeout'; sv.fadeTarget = 0; return; }
      cutTo(j, now);
    }
    if (now - sv.labelAt > LABEL_MS) { sv.labelAt = now; label(); }
  }
  function event(kind, now) {
    if (!sv || kind !== 'contact' || !sv.shot) return;
    sv.contactWall = now;
    // a contact in a later shot (a very slow GPU) goes back to the impact
    const j = contactCut(sv.shots, sv.si);
    if (j !== sv.si) cutTo(j, now);
    sv.ev.contactAt = (now - sv.shotAt) / 1000;
    if (sv.shot.kind === 'approach' || sv.shot.kind === 'impact') setSpeed(0.25);
  }
  // The shot's offsets on the auto view v (view.js): a new object. The
  // contact shot follows the live contact point (S.cam.p).
  function view(v, now) {
    const sh = sv && sv.shot;
    if (!sh) return Object.assign({}, v);
    const prog = Math.min(1, (now - sv.shotAt) / 1000 / sh.len);
    const p = S.cam && S.cam.p ? S.cam.p : S.contact ? S.contact.p : S.arc ? S.arc.hit : null;
    return shotView(sh, prog, sv.calm, v, p);
  }
  function label() {
    if (!sv.opts.label || !S.setup || !S.sim) return;
    const info = plateInfo({ sc: S.sc, setup: S.setup, stats: S.stats, out: S.out, peak: S.peak, n: S.sim.n, shot: sv.shot, warp: sv.warp, slow: S.speed < 1 });
    info.anchor = () => {
      if (!S.ren || !S.setup) return null;
      const cs = $('gpu'), W = cs.clientWidth || innerWidth, H = cs.clientHeight || innerHeight;
      const close = sv.shot && sv.shot.follow === 'contact' && S.contact;
      const p = close ? (S.cam && S.cam.p ? S.cam.p : S.contact.p) : S.out ? S.out.X : S.f.target;
      const R = close ? 0.3 * (S.setup.bodies[1] || S.setup.bodies[0]).R : S.out ? S.out.Rp : S.setup.bodies[0].R;
      const q = S.ren.project(p, W, H); if (!q) return null;
      return { x: q.x, y: q.y, r: Math.max(8, R * S.ren.focal / q.w / (S.ren.H / H)), lead: !!close };
    };
    sv.opts.label(info);
  }
  const dir = { tick, view, event, band: () => (sv && sv.band) || { t: 0, b: 0 }, mode: 0, cut: false, sun: null, exposure: 0 };

  window.snSaver = {
    async enter(opts = {}) {
      for (let k = 0; k < 400 && !(S.sim && S.ren); k++) await new Promise(r => setTimeout(r, 25));
      document.documentElement.classList.add('sn-saver');
      for (const id of ['aim', 'info']) { const e = $(id); if (e) e.hidden = true; }
      S.aimOpen = false;
      const rm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const calm = Math.max(Math.min(1, Math.max(0, opts.calm ?? 0.7)), rm ? 1 : 0);
      sv = { opts, rnd: rng((opts.seed ?? Date.now()) >>> 0), calm, queue: [], run: null, runs: 0, shots: [], si: -1, shot: null,
        shotAt: 0, fade: 0, fadeTarget: 0, state: 'warm', band: { t: 0, b: 0 }, bandAt: -1e9, labelAt: 0, warp: 0, ev: { contactAt: null } };
      S.dir = dir;
      nextRun();
      return { canvas: $('gpu'), warmupMs: 1500 };
    },
    exit() {
      S.dir = null; sv = null;
      document.documentElement.classList.remove('sn-saver');
      setSpeed(2);
    },
    // force the next shot (tests and probes)
    cut() {
      if (!sv || sv.state !== 'show') return false;
      const j = pickNext(sv.shots, sv.si, 0);
      if (j < 0) { sv.state = 'fadeout'; sv.fadeTarget = 0; } else cutTo(j, S.now);
      return true;
    },
    debug() {
      return sv ? { run: sv.run && sv.run.key, runs: sv.runs, title: S.sc && S.sc.title, shot: sv.shot && sv.shot.kind, shots: sv.shots.map(s => s.kind), si: sv.si,
        state: sv.state, fade: sv.fade, speed: S.speed, contact: !!S.contact, warp: sv.warp, band: sv.band } : null;
    },
  };
}

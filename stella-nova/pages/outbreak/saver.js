// ============================================================================
//  OUTBREAK  ·  saver.js — window.snSaver and the on-page Auto mode
// ----------------------------------------------------------------------------
//  The shell screensaver (lib/screensaver.js) and the on-page Auto button
//  run the same director (director.js). The Auto runner selects a run,
//  restarts the simulation through main.js, and plays the shots. A cut
//  that changes the style, a far camera jump or a restart goes through a
//  fade to black (globe.setFade). A near camera move is a flight
//  (main.js setShot with fly = true).
//
//  installSaver(app) -> Ctl
//    Installs window.snSaver = { enter(opts), exit(), debug(), cut(kind) }.
//    Ctl = { frame(nowSec), auto(on, opts), get mode, get running, debug() }
//    main.js calls ctl.frame(now) once per frame (now in seconds) and
//    ctl.auto(true | false) from the Auto button.
//  createAuto(app, { seed, calm, label, band }) -> Auto (the runner)
//
//  The app object, given by main.js (package N):
//    canvas          the globe canvas, in the document
//    globe           render/globe.js Globe (setStyle, setFade,
//                    setViewOffset, styles)
//    D               the parsed nodes
//    view()          -> the director view (see director.js)
//    disease()       -> the current Disease
//    startRun(run)   restart the simulation with director.newRun()
//                    output ({ diseaseId, seedNode, policies,
//                    startDayOfYear, style }) and the seed
//    setSpeed(dps), play(bool)
//    setShot(shot, { fly })   point the camera at shot.cam, follow
//                    shot.follow; fly = true: an eased flight
//    texFor, rules   optional, from equations.js (plate TeX)
//    setViewRect(r)  optional: r = { l, r, t, b } (clear rect in CSS px,
//                    edges from the top-left) or null. Without it the
//                    runner calls globe.setViewOffset(l, r, t, b).
//    saveState(), restoreState(s)   optional: the screensaver keeps the
//                    viewer's settings and puts them back on exit
//    setHud({ on, band })  optional: the on-canvas HUD (render/hud.js) in
//                    the clear band. The screensaver turns it on (the shell
//                    hides the DOM HUD and records only the canvas); the
//                    Auto button does not (the page HUD is there).
//
//  In the shell, the subject sits in the clear band of the label plate
//  (plateBand from lib/saver-clear.js). The band holds for a shot and
//  only grows, so the view does not move while the plate text changes.
//  The camera altitude is scaled by the band height, so the globe fills
//  the band and not the full frame. A shot's camEnd (push in, pull back)
//  gets the same scale. The plate has no code; its sub line names what
//  the shot shows with live numbers (director.js plate), refreshed every
//  PLATE_EVERY s, and the HUD on the canvas ticks the counters.
//
//  grep -n targets: "export function createAuto", "export function installSaver",
//    "const FADE_S", "const NEAR_DEG", "function apply", "function bandRect",
//    "function sendPlate"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { createDirector } from './director.js';

const FADE_S = 0.9;       // fade out, and again fade in, in seconds
const NEAR_DEG = 50;      // a camera move nearer than this is a flight
const PLATE_EVERY = 1;    // seconds between plate refreshes (same title)
const BAND_EVERY = 0.25;  // seconds between plateBand reads

const RAD = Math.PI / 180;
function arcDeg(a, b) {
  const c = Math.sin(a.lat * RAD) * Math.sin(b.lat * RAD) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((a.lon - b.lon) * RAD);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
}

export function createAuto(app, { seed, calm = 0.7, label = null, band = false } = {}) {
  seed = (seed >>> 0) || 1;
  const styles = app.styles || (app.globe && app.globe.styles) || null;
  const dir = createDirector({ seed, calm, styles, D: app.D, texFor: app.texFor, rules: app.rules });
  let running = false, shot = null, style = null, fade = null, rect = null, rectShot = -1;
  let plateAt = -1e9, bandAt = -1e9, shots = 0, runs = 0, lastNow = 0;

  const setFade = a => { if (app.globe && app.globe.setFade) app.globe.setFade(Math.max(0, Math.min(1, a))); };

  function bandRect(now) {
    if (!band || typeof window === 'undefined') return null;
    if (now - bandAt < BAND_EVERY && rectShot === shots) return rect;
    bandAt = now;
    const W = window.innerWidth, H = window.innerHeight, pb = plateBand(H);
    if (!pb) return rect;
    const grow = rect && rectShot === shots;
    const t = grow ? Math.max(rect.t, pb.t) : pb.t, bb = grow ? Math.max(H - rect.b, pb.b) : pb.b;
    const w = Math.min(W, grow ? Math.min(rect.r - rect.l, pb.w) : pb.w), l = (W - w) / 2;
    rect = { l, r: l + w, t, b: Math.max(t + 0.3 * H, H - bb) };
    rectShot = shots;
    if (app.setViewRect) app.setViewRect(rect);
    else if (app.globe && app.globe.setViewOffset) app.globe.setViewOffset(rect.l, rect.r, rect.t, rect.b);
    return rect;
  }

  function sendPlate(now, force) {
    if (!label || (!force && now - plateAt < PLATE_EVERY)) return;
    plateAt = now;
    try { label(dir.plate(app.view(), app.disease ? app.disease() : null)); } catch (e) { /* the plate is optional */ }
  }

  // Put a shot on screen. In the band, scale the altitude by the band
  // height so the subject fills the band and not the full frame.
  function apply(s, fly, now) {
    shot = s; shots++;
    if (s.style !== style) { style = s.style; if (app.globe && app.globe.setStyle) app.globe.setStyle(style); }
    const r = bandRect(now);
    const cam = { ...s.cam };
    const camEnd = s.camEnd ? { ...s.camEnd } : null;
    if (r && typeof window !== 'undefined') {
      const fill = Math.max(0.3, (r.b - r.t) / window.innerHeight);
      const sc = a => (s.style === 'flat' ? a / fill : (1 + a) / fill - 1);
      cam.alt = sc(cam.alt);
      if (camEnd && Number.isFinite(camEnd.alt)) camEnd.alt = sc(camEnd.alt);
    }
    app.setSpeed(s.simSpeed);
    app.play(s.simSpeed > 0);
    app.setShot({ ...s, cam, camEnd }, { fly });
    if (band && app.setHud) app.setHud({ on: true, band: r });
    sendPlate(now, true);
  }

  function restart() {
    const run = dir.newRun();
    runs++;
    app.startRun({ ...run, seed: (seed + runs * 0x9e3779b1) >>> 0 });
  }

  function frame(now) {
    if (!running) return;
    lastNow = now;
    bandRect(now);
    if (fade) {
      const k = (now - fade.t0) / FADE_S;
      if (fade.phase === 1) {
        setFade(1 - k);
        if (k >= 1) {
          if (fade.restart) {
            restart();
            const r = dir.tick(now, app.view());
            if (r.shot) apply(r.shot, false, now);
          } else apply(fade.shot, false, now);
          dir.restartClock(now);
          fade = { phase: 2, t0: now };
        }
      } else {
        setFade(k);
        if (k >= 1) { fade = null; setFade(1); }
      }
      sendPlate(now, false);
      return;
    }
    const r = dir.tick(now, app.view());
    if (r.restart) fade = { phase: 1, t0: now, restart: true };
    else if (r.changed) {
      const far = !shot || r.shot.style !== style || arcDeg(shot.cam, r.shot.cam) > NEAR_DEG;
      if (far) fade = { phase: 1, t0: now, shot: r.shot };
      else apply(r.shot, true, now);
    }
    sendPlate(now, false);
  }

  return {
    start(now = 0) {
      running = true; shot = null; style = null; rect = null; rectShot = -1;
      setFade(0);
      restart();
      const r = dir.tick(now, app.view());
      if (r.shot) apply(r.shot, false, now);
      fade = { phase: 2, t0: now };
    },
    stop() { running = false; fade = null; setFade(1); if (label) label(null); if (band && app.setHud) app.setHud({ on: false }); },
    frame,
    cut(kind) { return dir.force(kind); },
    get running() { return running; },
    debug: () => ({
      running, style, fade: fade ? { phase: fade.phase, k: +((lastNow - fade.t0) / FADE_S).toFixed(2) } : null,
      shot: shot && { kind: shot.kind, title: shot.title, dur: +shot.dur.toFixed(1), style: shot.style, simSpeed: +shot.simSpeed.toFixed(2), cam: shot.cam },
      band: rect, runs, shots, director: dir.state(),
    }),
  };
}

export function installSaver(app) {
  let auto = null, mode = null, saved = null, label = null;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  const html = () => (typeof document !== 'undefined' ? document.documentElement : null);

  function stop() {
    if (!auto) return;
    auto.stop();
    if (mode === 'saver') {
      const h = html(); if (h) h.classList.remove('sn-saver');
      if (app.setViewRect) app.setViewRect(null);
      if (app.restoreState) app.restoreState(saved);
    }
    auto = null; mode = null; saved = null; label = null;
  }

  const ctl = {
    frame(t) { if (auto) auto.frame(t); },
    auto(on, opts = {}) {
      if (!on) { if (mode === 'button') stop(); return false; }
      if (mode === 'saver') return false;
      stop();
      const seed = (opts.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0) || 1;
      auto = createAuto(app, { seed, calm: opts.calm ?? 0.5, label: null, band: false });
      mode = 'button';
      auto.start(now());
      return true;
    },
    get mode() { return mode; },
    get running() { return !!(auto && auto.running); },
    debug: () => (auto ? { mode, ...auto.debug() } : { mode: null }),
  };

  if (typeof window !== 'undefined') {
    window.snSaver = {
      enter(opts = {}) {
        stop();
        saved = app.saveState ? app.saveState() : null;
        const h = html(); if (h) h.classList.add('sn-saver');
        label = typeof opts.label === 'function' ? opts.label : null;
        const calm = Math.max(0, Math.min(1, opts.calm ?? 0.7));
        const seed = (opts.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0) || 1;
        auto = createAuto(app, { seed, calm, label, band: true });
        mode = 'saver';
        auto.start(now());
        return { canvas: app.canvas, warmupMs: 1500 };
      },
      exit() { if (mode === 'saver') stop(); },
      debug: () => ctl.debug(),
      cut: kind => !!(auto && auto.cut(kind)),
    };
  }
  return ctl;
}

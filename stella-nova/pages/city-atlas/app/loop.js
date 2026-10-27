// ============================================================================
//  LOOP  ·  city-atlas/app/loop.js — the frame loop
// ----------------------------------------------------------------------------
//  One requestAnimationFrame loop. It runs the clock of the current data,
//  fades the overlays in and out, eases the camera (or lets the saver move
//  it), hands one frame to renderer.js, places the labels and runs the
//  quality governor. RENDER ON DEMAND: when nothing moves (animating), the
//  loop skips the GPU work. stats counts frames for the debug handle.
//
//  grep -n targets
//    frame counters ....... "export const stats"
//    render on demand ..... "function animating"
//    the frame ............ "export function frame"
//    renderer input ....... "S.renderer.frame({"
//    no WebGPU ............ "export function showFallback"
// ============================================================================

import { lightFor } from '../renderer.js';
import { tilt } from '../../../lib/tilt.js';
import { S, ov, cam, lastHour, invalidate, DAYS_SECONDS, ORBIT_IDLE_MS } from './state.js';
import { canvas, fallbackEl } from './dom.js';
import { contourStep, ease } from './view.js';
import { windTop } from './forms.js';
import { QUALITY } from './quality.js';
import { loadLog } from './loader.js';
import { updateClockUI, placeLabels } from './foot.js';
import { tickScale, governor, quality } from './layout.js';
import { sv, saverTick, platePulse } from './saver.js';

// drawn and idle frames; CPU ms per drawn frame and rAF gaps (last 120 each)
export const stats = { drawn: 0, idle: 0, cpu: [], gaps: [] };

// lib/tilt.js: the phone tilt parallax moves the view, so draw while it moves.
if (tilt) tilt.subscribe(() => invalidate(2));
function animating(t) {
  if (S.saver || S.camGoal || S.dirtyFrames > 0) return true;
  if (S.renderer?.info.shadowPending) return true;
  if (t - S.lastInput < 500) return true;
  if (S.playing && ov.view.orbit && t - S.lastInput > ORBIT_IDLE_MS) return true;
  for (const k of ['terrain', 'ocean', 'wind']) {
    if (Math.abs(ov[k].amt - (ov[k].on ? 1 : 0)) > 1e-3) return true;
  }
  return (ov.ocean.on && !!S.meta?.current) || ov.wind.on;
}

export function frame(t) {
  requestAnimationFrame(frame);
  const tf0 = performance.now();
  const rawMs = S.lastT == null ? 0 : t - S.lastT;
  stats.gaps.push(rawMs); if (stats.gaps.length > 120) stats.gaps.shift();
  const dt = Math.min(0.1, Math.max(0, rawMs / 1000));
  S.lastT = t;
  const meta = S.meta, renderer = S.renderer;
  if (!meta || !renderer || !renderer.current) return;
  if (!S.saver) tickScale(t);
  // the clock runs on a skipped frame too (it is only text without the currents)
  if (S.playing && !S.scrubbing) {
    const L = lastHour();
    S.hour += dt * (L / DAYS_SECONDS) * (S.saver ? sv.rate : 1);
    if (S.hour >= L) S.hour -= L;
  }
  updateClockUI();
  if (!animating(t)) { stats.idle++; return; }
  if (S.dirtyFrames > 0) S.dirtyFrames--;
  for (const k of ['terrain', 'ocean', 'wind']) {
    const goal = ov[k].on ? 1 : 0;
    ov[k].amt = Math.abs(ov[k].amt - goal) < 2e-3 ? goal : ease(ov[k].amt, goal, dt, 0.35);   // snap: the shadow map waits for a still E
  }
  const E = ov.terrain.exag * ov.terrain.amt;
  if (S.saver) saverTick(dt, t);
  else {
    const goal = S.camGoal;
    if (goal) {
      for (const k of ['yaw', 'pitch', 'dist']) cam[k] = ease(cam[k], goal[k], dt, 0.4);
      for (let a = 0; a < 3; a++) cam.target[a] = ease(cam.target[a], goal.target[a], dt, 0.4);
      if (Math.abs(cam.dist - goal.dist) < 2 && Math.abs(cam.yaw - goal.yaw) < 1e-3) S.camGoal = null;
    }
    if (S.playing && ov.view.orbit && t - S.lastInput > ORBIT_IDLE_MS) cam.yaw += dt * 0.035;
  }
  const groundZ = (meta.groundRef || 0) * E;
  const camState = { target: [cam.target[0], cam.target[1], groundZ], yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist };
  const q = QUALITY[quality.level];
  try {
    renderer.frame({
      cam: camState, dt, time: t / 1000, dpr: canvas.width / Math.max(1, window.innerWidth),
      light: lightFor(ov.view.light, S.sunAz), exag: E, terrain: ov.terrain.amt,
      contour: ov.terrain.contour ? contourStep(meta) : 0, colourMode: ov.view.colour,
      ocean: { on: ov.ocean.amt * (meta.current ? 1 : 0), hour: S.hour },
      wind: { on: ov.wind.amt, heat: ov.wind.heat ? 1 : 0, slice: ov.wind.slice, speed: ov.wind.speed, colourTop: windTop(ov) },
      offsetY: S.saver ? sv.offsetY : 0, fovY: 0.75,
      // streak speed on screen follows the zoom: the reference current and
      // the free-stream wind move about 6 % of the view distance per second
      oceanVis: cam.dist * 0.07, windVis: cam.dist * 0.07,
      windAlpha: S.saver ? 0.45 : 0.7,
      windMult: q.wind, particleShare: q.share,
      fog: Math.max(22000, cam.dist * 6),
    });
  } catch (err) {
    console.error('city-atlas: render failed', err);
    S.renderer = null;
    showFallback();
    return;
  }
  stats.drawn++;
  const lc = loadLog.cur;
  if (lc && lc.firstFrame == null) { lc.firstFrame = performance.now() - lc.t0; loadLog.list.push(lc); }
  stats.cpu.push(performance.now() - tf0); if (stats.cpu.length > 120) stats.cpu.shift();
  placeLabels(t);
  platePulse(t);
  governor(t);
}

export function showFallback() {
  document.body.classList.add('no-gpu');
  fallbackEl.hidden = false;
  fallbackEl.innerHTML = '<p>This browser does not offer WebGPU, so the city cannot draw here. Try a recent Chrome, Edge or Safari.</p>';
}

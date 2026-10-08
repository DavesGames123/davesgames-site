// ============================================================================
//  ROCHE LIMIT  ·  app/loop.js — the frame loop and the speed
// ----------------------------------------------------------------------------
//  frameBody() runs the sim steps that the speed asks for, under the
//  GPU budget (S.stepsMax), starts the readbacks and draws the frame.
//
//  grep -n targets
//    frame loop ...... "function frameBody"
//    speed ........... "function orbitsPerMin"
//    steps wanted .... "function stepsWanted"
// ============================================================================
import { drawFrame } from './draw.js';
import { UI, CALM_SPEED, $, Q } from './env.js';
import { restoreSnap, readAll } from './history.js';
import { governQuality } from './quality.js';
import { refreshReadout } from './readout.js';
import { settleStep, placeSats } from './runs.js';
import { S } from './state.js';

let gpuPending = false;
let lastT = performance.now();

export function frame(now) {
  requestAnimationFrame(frame);
  const tCpu = performance.now();
  try { frameBody(now); } finally { S.cpuMs = 0.9 * S.cpuMs + 0.1 * (performance.now() - tCpu); }
}
// The speed in orbits per minute of wall time. Reduce motion caps it at
// Normal; the screensaver sets its own.
export function orbitsPerMin() {
  if (S.saverOn && S.saver) return S.saver.speed;
  return Math.pow(10, UI.calm ? Math.min(UI.speedLog, CALM_SPEED) : UI.speedLog);
}
export function allFree() { return S.run.sats.every(s => !s.gpu.busy && !s.waiting); }
function frameBody(now) {
  const dtReal = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  S.fps = 0.95 * S.fps + 0.05 / Math.max(dtReal, 1e-3);
  if (!S.run || !S.ren || S.run.phase === 'init' || S.run.phase === 'placing' || S.profiling) return;
  const cssW = $('gpu').clientWidth, cssH = $('gpu').clientHeight;
  if (cssW < 2 || cssH < 2) return;
  let steps = 0;
  if (S.run.phase === 'settle') {
    if (settleStep(Math.max(2, Math.min(S.saverOn ? 24 : 12, Math.floor(S.stepsMax / 32))))) { S.run.phase = 'placing'; placeSats(S.run.serial); }
  } else if (S.run.phase === 'orbit') {
    if (S.run.pendingRestore !== undefined && S.run.pendingRestore !== null && allFree()) { const i = S.run.pendingRestore; S.run.pendingRestore = null; restoreSnap(i); }
    const s0 = S.run.sats[0];
    // the spiral ends at d1: the drag stops there
    if (S.run.spec.kind === 'spiral') for (const s of S.run.sats) if (s.pl.drag > 0 && Math.hypot(...s.ref.X) < S.run.spec.d1 * s.Rp) { s.pl.drag = 0; s.gpu.setParams(s.C, s.pl, 0); }
    const playing = !UI.paused && !S.run.scrubbing;
    if (playing) {
      // steps this frame: the speed in steps, carried over frames, capped
      // by the GPU budget; part blocks are fine (engine.js encodeSteps)
      const want = orbitsPerMin() / 60 * S.run.T0 / s0.C.dt * dtReal;
      S.warpCarry += want;
      steps = Math.min(Math.floor(S.warpCarry), S.stepsMax);
      S.warpCarry = Math.min(S.warpCarry - steps, 1);
      S.run.rate = 0.9 * S.run.rate + 0.1 * (steps / Math.max(dtReal, 1e-3));
    } else if (S.run.stepLeft > 0) {
      steps = Math.min(S.run.stepLeft, S.stepsMax);
      S.run.stepLeft -= steps;
      if (S.run.stepLeft <= 0) S.run.forceRead = true;
    }
    // a readback once a second while it plays; the O(N^2) potential
    // (energy) every second one
    const due = allFree() && (playing ? now - (S.run.lastRead || 0) > 1000 : (S.run.forceRead || now - (S.run.lastRead || 0) > 2000));
    if (steps > 0) {
      const enc = S.dev.createCommandEncoder();
      for (const s of S.run.sats) s.gpu.encodeSteps(enc, steps, due);
      S.dev.queue.submit([enc.finish()]);
      S.run.t = s0.gpu.t;
    }
    if (due && !S.run.scrubbing) { S.run.lastRead = now; S.run.forceRead = false; S.run.reads = (S.run.reads || 0) + 1; readAll(!playing || S.run.reads % 2 === 1); }
  }
  // GPU time of the whole frame (sim + draw)
  const tSub = performance.now();
  drawFrame(now, cssW, cssH, steps);
  if (!gpuPending) {
    gpuPending = true;
    S.dev.queue.onSubmittedWorkDone().then(() => {
      const ms = performance.now() - tSub;
      S.gpuMs = 0.8 * S.gpuMs + 0.2 * ms; gpuPending = false;
      const target = Math.max(8, Math.ceil(stepsWanted() * 1.25));
      if (S.gpuMs > 14 && S.stepsMax > 8) S.stepsMax = Math.max(8, Math.floor(S.stepsMax * 0.8));
      else if (S.gpuMs < 9 && S.stepsMax < target) S.stepsMax += 8;
      else if (S.stepsMax > target) S.stepsMax = target;
    });
  }
  governQuality(now);
  S.run.frames++;
  if (S.run.frames % 10 === 0) refreshReadout(false);
  if (UI.showFps && S.run.frames % 20 === 0) $('fpsChip').textContent = `${S.fps.toFixed(0)} fps · GPU ${S.gpuMs.toFixed(1)} ms · CPU ${S.cpuMs.toFixed(1)} ms · ${(S.ren.W * S.ren.H / 1e6).toFixed(1)} MP · ${Q.preset}${Q.bloom ? '' : ', no bloom'} · ${S.stepsMax} steps max`;
}
// steps per frame the speed asks for, at 60 fps
export function stepsWanted() {
  if (!S.run || !S.run.sats.length || !S.run.T0) return 64;
  return orbitsPerMin() / 60 * S.run.T0 / S.run.sats[0].C.dt / 60;
}

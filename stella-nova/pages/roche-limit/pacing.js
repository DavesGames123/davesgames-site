// ============================================================================
//  ROCHE LIMIT  ·  pacing.js — the story clock: fast in, slow at the breakup
// ----------------------------------------------------------------------------
//  No DOM and no GPU: app/loop.js, app/saver.js and tests.mjs import it.
//
//  THE PROBLEM. The first version ran at one speed (6 orbits a minute) from
//  2.7 Saturn radii, so the moon took about 2.2 orbits and some 25 s of
//  wall time to start to break up. The breakup itself (bound mass from 97%
//  to 25%) takes less than 0.2 orbit, so at that speed it went by in 2 s.
//
//  THE DIRECTOR. A run has three modes. Each mode multiplies the speed
//  that the user sets (orbits per minute of wall time):
//    approach  PACE.approach (x4): the moon drifts in and stretches
//    breakup   down to PACE.slow (x0.3): slow motion while it sheds
//    spread    PACE.spread (x3): the stream winds into a ring
//  The analysis (worker.js) gives the signals: the bound fraction f and the
//  elongation el of the bound pile (sqrt of the largest over the smallest
//  eigenvalue of its second moment; 1 for a sphere). The slow motion ramps
//  in between el = PACE.elOn and PACE.elFull, before any mass is lost:
//  the Deno probe of 2026-10-08 (N = 8192, the Saturn story) gave el 1.20
//  at 0.14 orbit and el 1.36 at 0.06 orbit before the first 3% was shed.
//  The breakup mode latches. It ends when f < PACE.fDone or after
//  PACE.slowOrbits of sim time in slow motion.
//  stepFactor() eases the factor in log space at PACE.rampPerS (e-folds a
//  second), so a change of speed takes about a second, never a jump.
//
//  THE PHYSICS DOES NOT CHANGE. The director changes only how much sim time
//  each frame runs. The tide, the contacts and the self-gravity are the
//  same at every speed. The page prints the time warp (sim seconds per
//  wall second) and says when it runs in slow motion.
//
//  BUDGETS. SETTLE_TIME is the settle of a new pile in sim time units (the
//  free-fall time of the cloud is about 0.8). READ_MS is the readback
//  interval in ms while the story runs and after the ring forms.
//  DESKTOP and PHONE are the step budgets (steps per frame at 60 fps) of
//  the wall-time model in tests.mjs: an Apple M4 Pro ran 13,500 steps/s at
//  N = 8192 in Deno (2026-10-08); the page keeps the GPU frame under 14 ms,
//  so about 128 steps a frame are left after the drawing. The phone value
//  is a guess, not a measurement.
//
//  grep -n targets
//    constants ........ "export const PACE"
//    budgets .......... "export const DESKTOP", "export const PHONE", "SAVER_SPEED"
//    target factor .... "export function paceTarget"
//    mode update ...... "export function updatePace"
//    easing ........... "export function stepFactor"
//    time warp ........ "export function timeWarp"
// ============================================================================

export const SETTLE_TIME = 4;
export const READ_MS = { story: 200, slow: 1000 };
export const PACE = {
  approach: 4, slow: 0.3, spread: 3,
  elOn: 1.16, elFull: 1.34, fShed: 0.985, fDone: 0.35, slowOrbits: 0.35,
  rampPerS: 3,
};
export const DESKTOP = { N: 8192, stepsPerFrame: 128, settleBlocks: 8, fps: 60 };
export const PHONE = { N: 4096, stepsPerFrame: 48, settleBlocks: 3, fps: 60 };
// The screensaver's base speed (orbits per minute before the pace factor).
export const SAVER_SPEED = 7;

// The kinds of run that the director paces. A circular orbit of a real
// moon ('real') keeps the user's speed: there is no breakup to wait for.
export function directed(kind) { return kind === 'spiral' || kind === 'flyby' || kind === 'compare'; }

export function newPace() { return { mode: 'approach', factor: PACE.approach, target: PACE.approach, tSlow: null }; }

// The factor that the mode and the latest signals ask for.
// sig: { f, el } of the first moon.
export function paceTarget(pc, sig) {
  if (pc.mode === 'spread') return PACE.spread;
  if (pc.mode === 'breakup') return PACE.slow;
  const u = Math.max(0, Math.min(1, (sig.el - PACE.elOn) / (PACE.elFull - PACE.elOn)));
  return Math.exp(Math.log(PACE.approach) + u * (Math.log(PACE.slow) - Math.log(PACE.approach)));
}
// After each analysis: move the mode on. t: sim time; T0: one orbit.
export function updatePace(pc, sig, t, T0) {
  if (pc.mode === 'approach' && (sig.el >= PACE.elFull || sig.f < PACE.fShed)) { pc.mode = 'breakup'; pc.tSlow = t; }
  if (pc.mode === 'breakup' && (sig.f < PACE.fDone || t - pc.tSlow > PACE.slowOrbits * T0)) pc.mode = 'spread';
  pc.target = paceTarget(pc, sig);
  return pc;
}
// Ease the factor toward the target, at most PACE.rampPerS e-folds a
// second, and a little faster on the way down (into slow motion).
export function stepFactor(pc, dtReal) {
  const a = Math.log(pc.factor), b = Math.log(pc.target), lim = PACE.rampPerS * (b < a ? 1.5 : 1) * dtReal;
  pc.factor = Math.exp(a + Math.max(-lim, Math.min(lim, b - a)));
  return pc.factor;
}
// Sim seconds (physical) per wall second at a speed in orbits/min.
export function timeWarp(orbitsPerMin, T0, tUnitSec) { return orbitsPerMin / 60 * T0 * tUnitSec; }

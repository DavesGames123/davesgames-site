// fade-in.js: the display weight of the at-rest running mean (artifact v23). The Unity port copies FADE.
// Plan: star-map-docs/notes/unity-plan.md "## Fade-in v23".
//
// Exports (grep -n "^export"):
//   FADE                              the fade constants (seconds and frames)
//   smooth01(x)                       smoothstep from 0 to 1, x clamped to [0, 1]
//   fadeWeight(tSec, n) -> [0, 1]     the weight of the mean against the seed
//   fadeDone(tSec, n) -> bool         true when the weight is 1
//
// The curve: after the motion stops, the seed image (the motion image, sharpened) holds for holdSec.
// Then the mean fades in with a smoothstep over fadeSec. A second smoothstep on the frame count gates
// the weight, so a slow GPU does not show a noisy mean of a few frames. The weight is the product of
// the two gates. Both gates start with a zero slope, so the fade has no step.
// tSec: seconds since the history reset (the first rest frame). n: frames in the mean (0 = the seed).

// Change these values in one place only. Copy them to the Unity port.
// holdSec: the seed holds for this time after the stop.
// fadeSec: the time gate goes from 0 to 1 in this time, after holdSec.
// minFrames: the frame gate is 0 at this frame count and below.
// fullFrames: the frame gate is 1 at this frame count and above. The mean is converged here.
export const FADE = Object.freeze({ holdSec: 0.15, fadeSec: 1.1, minFrames: 2, fullFrames: 24 });

export function smooth01(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export function fadeWeight(tSec, n, F = FADE) {
  const timeGate = smooth01((tSec - F.holdSec) / F.fadeSec);
  const frameGate = smooth01((n - F.minFrames) / (F.fullFrames - F.minFrames));
  return timeGate * frameGate;
}

export function fadeDone(tSec, n, F = FADE) {
  return tSec >= F.holdSec + F.fadeSec && n >= F.fullFrames;
}

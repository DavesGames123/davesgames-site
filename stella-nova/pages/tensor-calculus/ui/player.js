// ============================================================================
//  TENSOR CALCULUS  ·  ui/player.js  ·  the step player clock  (CORE)
// ----------------------------------------------------------------------------
//  DOM-free. The player owns one time line for an OpTrace. Each step has a
//  motion part (step.ms, or DEFAULT_MS) and a hold part (HOLD_MS) at t = 1,
//  so the reader can see the result before the next step starts. The time
//  line is the sum of these parts.
//
//  Each frame, main.js calls tick(dtMs). The player moves the clock by
//  dtMs * speed and calls onFrame(index, t, step) once. main.js then calls
//  play(step, t) on the TeX view, the 3D view and the diagram with the same
//  index and t, so the three views stay in lock step. onStep(index, step)
//  runs when the index changes (the TeX view typesets then, not each frame).
//
//  t is eased: the views get ease(raw) with a smooth in-out curve, and the
//  scrub bar shows the raw clock. At the end of the trace the player stops
//  (loop false) or starts again (loop true).
//
//  API
//    createPlayer({ onFrame, onStep, onEnd, onStepEnd, loop, holdMs }) -> player
//    player.load(trace)          new trace; the clock goes to 0, paused
//    player.play() / pause() / toggle()
//    player.seek(index, t = 0)   go to step index at raw t in 0..1
//    player.seekFrac(f)          f in 0..1 of the whole time line (scrub)
//    player.next() / prev()      the start of the next or the last step
//    player.setSpeed(s)          0.25 .. 4
//    player.setStepPause(on)     stop at the end of each step's motion, so
//                                the reader can study the result; play or
//                                next then runs the next step (onStepEnd)
//    player.tick(dtMs)           move the clock; returns true when it moved
//    player.position()           { index, t, raw, frac, playing, speed }
//    player.timeline()           [{ index, start, motion, hold, label }]
//    player.totalMs()
//
//  EXPORTS   (grep -n "export" ui/player.js)
//      DEFAULT_MS, MOTION_SCALE, HOLD_MS, SPEEDS, ease, createPlayer
// ============================================================================

// Slow enough to read: the user found 1.2 to 2.6 s steps with a 0.9 s
// hold too fast to follow. MOTION_SCALE stretches each step's own ms.
export const DEFAULT_MS = 4000;
export const MOTION_SCALE = 1.8;
export const HOLD_MS = 3500;
export const SPEEDS = Object.freeze([0.25, 0.5, 1, 1.5, 2, 4]);

export function ease(x) {
  const t = Math.min(1, Math.max(0, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function createPlayer({ onFrame = () => {}, onStep = () => {}, onEnd = () => {}, onStepEnd = () => {}, loop = false, holdMs = HOLD_MS } = {}) {
  let steps = [], spans = [], total = 0;
  let clock = 0, playing = false, speed = 1, lastIndex = -1, stepPause = false, atStepEnd = -1;

  function build(trace) {
    steps = (trace && trace.steps) || [];
    spans = []; total = 0;
    steps.forEach((s, i) => {
      const motion = Math.max(400, (+s.ms || DEFAULT_MS) * MOTION_SCALE);
      spans.push({ index: i, start: total, motion, hold: holdMs, label: s.label || s.kind || `Step ${i + 1}` });
      total += motion + holdMs;
    });
  }

  function locate(c) {
    if (!spans.length) return { index: -1, raw: 0 };
    const cc = Math.min(Math.max(0, c), total);
    let lo = 0, hi = spans.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (spans[mid].start <= cc) lo = mid; else hi = mid - 1; }
    const sp = spans[lo];
    return { index: lo, raw: Math.min(1, (cc - sp.start) / sp.motion) };
  }

  function emit() {
    const { index, raw } = locate(clock);
    if (index < 0) return;
    if (index !== lastIndex) { lastIndex = index; onStep(index, steps[index]); }
    onFrame(index, ease(raw), steps[index], raw);
  }

  const api = {
    load(trace) { build(trace); clock = 0; playing = false; lastIndex = -1; emit(); return api; },
    play() {
      if (!spans.length) return;
      if (clock >= total) clock = 0;
      // stopped on a step result: skip its hold and run the next step
      else if (atStepEnd >= 0 && atStepEnd < spans.length - 1) clock = spans[atStepEnd + 1].start;
      atStepEnd = -1; playing = true;
    },
    pause() { playing = false; },
    toggle() { if (playing) api.pause(); else api.play(); return playing; },
    seek(index, t = 0) {
      if (!spans.length) return;
      const i = Math.min(Math.max(0, index | 0), spans.length - 1);
      clock = spans[i].start + Math.min(1, Math.max(0, t)) * spans[i].motion;
      atStepEnd = -1;
      emit();
    },
    seekFrac(f) { clock = Math.min(1, Math.max(0, f)) * total; atStepEnd = -1; emit(); },
    next() {
      const { index } = locate(clock);
      if (index < spans.length - 1) { api.seek(index + 1, 0); if (stepPause) playing = true; } // step mode: animate the next step
      else api.seek(index, 1);
    },
    prev() {
      const { index, raw } = locate(clock);
      api.seek(raw > 0.15 || index === 0 ? index : index - 1, 0);
    },
    setSpeed(s) { speed = Math.min(4, Math.max(0.25, +s || 1)); },
    tick(dtMs) {
      if (!playing || !spans.length) return false;
      const before = clock;
      clock += Math.max(0, Math.min(dtMs, 250)) * speed;   // a long frame gap is not a jump
      if (stepPause) {
        const { index } = locate(before), end = spans[index].start + spans[index].motion;
        if (before < end && clock >= end) { clock = end; playing = false; atStepEnd = index; emit(); onStepEnd(index); return true; }
      }
      if (clock >= total) {
        if (loop) clock = clock % total;
        else { clock = total; playing = false; emit(); onEnd(); return true; }
      }
      emit();
      return true;
    },
    position() {
      const { index, raw } = locate(clock);
      return { index, t: ease(raw), raw, frac: total ? clock / total : 0, playing, speed, clock };
    },
    timeline() { return spans.map(s => ({ ...s })); },
    totalMs() { return total; },
    steps() { return steps; },
    setLoop(v) { loop = !!v; },
    setStepPause(v) { stepPause = !!v; if (!stepPause) atStepEnd = -1; },
    stepPause() { return stepPause; },
  };
  return api;
}

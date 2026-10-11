// ============================================================================
//  FLY DUEL  ·  motion timings and the hero beat  (pure ES module)
// ----------------------------------------------------------------------------
//  DESIGN.md 1.4 and 2.3. All times are in ms. One easing, EASE: a fast
//  start and a hard stop, no bounce. A thing moves only because the game,
//  the brain trace or the trainer changed (no idle motion).
//
//  One beat is one decision of the hero match. beatPlan() gives the timed
//  steps of that beat, in order:
//    t (share of beat)  key     what changes
//    0.00               focus   the acting fly gets the focus
//    0.00 - 0.15        pn      PN points take their rates
//    0.15 - 0.30        kc      active KCs light
//    0.30 - 0.45        mbon    MBON bars go to their new heights
//    0.45               decide  the decision strip shows the candidates
//    0.55 - 1.00        table   the table plays the action
//    0.55               burst   DAN burst, only if |delta| > BURST_MIN
//  With reduced motion every tween is 0 ms (a cut) and the beat is at
//  least 1800 ms.
//
//  GREP MAP
//      grep -n 'export const EASE'         the one easing
//      grep -n 'export const MOTION'       the timings at speed 1
//      grep -n 'export function beatMs'    speed -> beat length
//      grep -n 'export function motionFor' timings for reduced motion
//      grep -n 'export function burstMs'   DAN burst length from delta
//      grep -n 'export function beatPlan'  the timed steps of one beat
// ============================================================================

export const EASE = 'cubic-bezier(0.2,0,0,1)';

// Beat by speed: slow 1800, normal 900, fast 300.
export const BEATS = { 0.5: 1800, 1: 900, 3: 300 };

export const MOTION = {
  beat: 900,
  think: 495,          // 0.55 x beat
  draw: 220,
  cast: 200,
  tap: 120,
  arrow: 160,
  dmgRise: 500,
  dmgHold: 300,
  lifeFlash: 240,
  deathMark: 120,
  deathCollapse: 160,
  burst: 300,          // plus burstPer x min(1, |delta|)
  burstPer: 300,
  zoom: 120,
  sheet: 240,
  endHold: 2500,       // the last board of a game, with the result banner
};

// |delta| below this gives no DAN burst.
export const BURST_MIN = 0.02;

// Beat length for a hero speed (0.5 slow, 1 normal, 3 fast). Other
// values scale 900 ms.
export function beatMs(speed = 1) {
  return BEATS[speed] ?? Math.round(900 / Math.max(0.1, speed));
}

// The timings for one speed. reduced = prefers-reduced-motion: every
// key except the beat goes to 0 (each change is a cut), the beat is at
// least 1800 ms, the damage number stays still for 900 ms, a burst ring
// shows at full size for 600 ms, and the end hold is 4 s.
export function motionFor(reduced = false, speed = 1) {
  const beat = beatMs(speed);
  const m = { ...MOTION, beat, think: Math.round(0.55 * beat) };
  if (!reduced) return m;
  const out = {};
  for (const k of Object.keys(m)) out[k] = 0;
  out.beat = Math.max(1800, beat);
  out.think = Math.round(0.55 * out.beat);
  out.dmgHold = 900;
  out.burst = 600;
  out.endHold = 4000;
  out.reduced = true;
  return out;
}

// DAN burst length for a TD error delta.
export function burstMs(delta, m = MOTION) {
  if (m.reduced) return m.burst;
  return Math.round(m.burst + m.burstPer * Math.min(1, Math.abs(delta || 0)));
}

// The delta of a decision record: the record's own, else the trace's.
export function deltaOf(rec) {
  const d = rec?.delta ?? rec?.trace?.delta;
  return Number.isFinite(d) ? d : null;
}

// The timed steps of one beat for a decision record of ui/match.js
// next(). Returns { who, beat, steps: [{ key, at, dur }] }, sorted by
// at. Every step ends inside the beat. With reduced, dur is 0.
export function beatPlan(rec, speed = 1, reduced = false) {
  const m = motionFor(reduced, speed);
  const B = m.beat;
  const t = (f) => Math.round(f * B);
  const tw = (f) => reduced ? 0 : t(f);
  const steps = [
    { key: 'focus', at: 0, dur: 0 },
    { key: 'pn', at: 0, dur: tw(0.15) },
    { key: 'kc', at: t(0.15), dur: tw(0.15) },
    { key: 'mbon', at: t(0.30), dur: tw(0.15) },
    { key: 'decide', at: t(0.45), dur: 0 },
    { key: 'table', at: t(0.55), dur: tw(0.45) },
  ];
  const d = deltaOf(rec);
  if (d != null && Math.abs(d) > BURST_MIN) steps.push({ key: 'burst', at: t(0.55), dur: reduced ? 0 : Math.min(burstMs(d, m), B - t(0.55)), delta: d });
  steps.sort((a, b) => a.at - b.at);
  return { who: rec?.who ?? 0, beat: B, steps };
}

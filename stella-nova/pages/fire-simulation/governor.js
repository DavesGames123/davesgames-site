// ============================================================================
//  FIRE SIMULATION  ·  pages/fire-simulation/governor.js — the frame governor
// ----------------------------------------------------------------------------
//  Our code (davesgames.io). No DOM. tick(now) once per frame with the rAF
//  time. It returns null, or the new level when the sim must change size.
//
//  Level k scales the cell count by CELLS[k] and the pixel ratio by DPR[k].
//  The governor compares the median frame time of each 1 s window with a
//  refresh estimate: the lowest window median seen, but at most 20 ms at
//  first (rAF cannot tell a 50 fps overload from a 50 Hz screen).
//    2 slow windows in a row (median > 1.3 x refresh)  -> one level down
//    HOLD s of good windows (median < 1.12 x refresh)   -> one level up
//  A drop must help: if 2 windows after a drop the median is no better
//  (a 30 Hz cap, Low Power Mode), that median becomes the refresh estimate
//  and the level goes back up. So a capped screen keeps full size.
//  A climb that fails within RETRY_MS doubles HOLD (max HOLD_MAX s). After
//  STABLE_MS at one level HOLD halves again (min HOLD0). So HOLD never
//  blocks a climb: the dla-terrain governor once stopped at its floor
//  for good; this one always tries again within HOLD_MAX s.
//  The refresh estimate drifts up 2 % per window toward the median, so a
//  change of screen rate does not leave the governor stuck at the floor.
//  A gap over STALL_MS (hidden tab, a long rebuild) starts a new window.
//
//  grep -n targets: "export const CELLS", "export function createGovernor"
// ============================================================================
export const CELLS = [1, 0.75, 0.56, 0.42, 0.32];
export const DPR = [1, 1, 0.9, 0.8, 0.7];
const WIN_MS = 1000, STALL_MS = 250, SLOW = 1.3, GOOD = 1.12, HOLD0 = 4, HOLD_MAX = 32, RETRY_MS = 4000, STABLE_MS = 30000, REF0_MAX = 20, NO_GAIN = 0.95;

export function createGovernor(o = {}) {
  const max = (o.levels || CELLS.length) - 1;
  const buf = new Float64Array(512);
  const G = { level: o.level || 0, ref: 0, n: 0, t0: 0, last: 0, bad: 0, goodMs: 0, hold: HOLD0, lastUp: -1e12, levelSince: 0, probe: null, history: [] };
  function median() {
    const a = buf.subarray(0, G.n); a.sort();
    return a[G.n >> 1];
  }
  G.reset = () => { G.n = 0; G.t0 = 0; G.last = 0; G.bad = 0; G.goodMs = 0; };
  G.scale = () => CELLS[G.level];
  G.dpr = () => DPR[G.level];
  G.tick = now => {
    const dt = G.last ? now - G.last : 0;
    G.last = now;
    if (!(dt > 0) || dt > STALL_MS) { G.n = 0; G.t0 = now; return null; }
    if (G.n < buf.length) buf[G.n++] = dt;
    if (now - G.t0 < WIN_MS) return null;
    const m = median();
    G.n = 0; G.t0 = now;
    G.ref = G.ref ? Math.min(m, G.ref + (m - G.ref) * 0.02) : Math.min(m, REF0_MAX);
    let change = null;
    if (G.probe && ++G.probe.windows >= 2) {
      // the last drop did not help: the screen is capped, not the sim slow
      if (m >= NO_GAIN * G.probe.m) { G.ref = Math.max(G.ref, m); G.level = G.probe.from; G.levelSince = now; change = G.level; }
      G.probe = null; G.bad = 0; G.goodMs = 0;
    } else if (m > SLOW * G.ref) {
      G.goodMs = 0;
      if (++G.bad >= 2 && G.level < max) {
        if (now - G.lastUp < RETRY_MS) G.hold = Math.min(HOLD_MAX, G.hold * 2);
        G.probe = { m, from: G.level, windows: 0 };
        G.level++; G.bad = 0; G.levelSince = now; change = G.level;
      }
    } else {
      G.bad = 0;
      if (m < GOOD * G.ref) G.goodMs += WIN_MS;
      if (now - G.levelSince > STABLE_MS) G.hold = Math.max(HOLD0, G.hold / 2);
      if (G.level > 0 && G.goodMs >= G.hold * 1000) { G.level--; G.goodMs = 0; G.lastUp = now; G.levelSince = now; change = G.level; }
    }
    if (change != null) { G.history.push({ t: now, level: change, median: m, ref: G.ref }); if (G.history.length > 32) G.history.shift(); }
    return change;
  };
  return G;
}

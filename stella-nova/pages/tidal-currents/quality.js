// quality.js — the frame-rate governor of the Tidal Currents page.
//
// The page must run at the display refresh rate. A 4K canvas over a view that
// is almost all water (for example the Straits of Mackinac) can ask for more
// particles and pixels than the GPU can draw in one refresh. The governor
// then lowers the quality level until the frames keep up again.
//
// Two signals come in once per frame:
//   dtMs   the rAF interval. It grows when the browser throttles rAF.
//   gpuMs  the submit-to-done time of a frame (engine.info.gpuMs). It grows
//          when the GPU falls behind, also in a browser that does not
//          throttle rAF.
// The governor takes the median of each over a window of WINDOW frames.
// The period is the smallest median rAF interval seen: the display refresh.
// A scene that is slow from its first frame never shows the refresh, so
// idle(dtMs) also takes the intervals of frames that draw nothing (the boot
// and the dataset loads).
//
// Rules, at the end of each window:
//   slow   median dt > 1.25 period, or median gpu > 1.1 period, for two
//          windows: go down one level (two when the median is above 2 periods).
//   fast   median gpu < 0.6 period and dt near the period, for RAISE_AFTER
//          windows: go up one level.
//   A raise that is slow again within RAISE_TEST_MS marks that level as
//   failed. The governor does not try a failed level for RETRY_MS.
//
// LEVELS lowers the particle share first, because it has no visible reset.
// The render scale comes after it: a new backing size clears the trails.
//
// grep: const LEVELS  function createGovernor  sample(  idle(  hold(  stats

export const LEVELS = [
  { share: 1, res: 1 },
  { share: 0.75, res: 1 },
  { share: 0.56, res: 1 },
  { share: 0.42, res: 1 },
  { share: 0.42, res: 0.85 },
  { share: 0.32, res: 0.75 },
  { share: 0.25, res: 0.66 },
  { share: 0.2, res: 0.5 },
];

const WINDOW = 20;            // frames per decision
const RAISE_AFTER = 12;       // fast windows before a raise
const RAISE_TEST_MS = 4000;   // a raise that is slow within this time failed
const RETRY_MS = 30000;       // wait before a failed level is tried again
const MIN_PERIOD = 1000 / 240;

const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s[s.length >> 1];
};

// apply(level, prev) sets the engine and the canvas for LEVELS[level].
export function createGovernor(apply) {
  let level = 0;
  let period = 1000 / 60;
  const dts = [], gpus = [], idles = [];
  let settle = 2, slowRun = 0, fastRun = 0, floorRun = 0;
  let raisedAt = -Infinity;
  const failedAt = LEVELS.map(() => -Infinity);
  const stats = { period, dt: 0, gpu: 0 };   // last window, for the console

  function set(next, now) {
    next = Math.min(LEVELS.length - 1, Math.max(0, next));
    if (next === level) return;
    const prev = level;
    level = next;
    if (next < prev) raisedAt = now;
    slowRun = 0; fastRun = 0;
    settle = 2;
    apply(level, prev);
  }

  function decide(now) {
    const dt = median(dts), gpu = median(gpus);
    dts.length = 0; gpus.length = 0;
    stats.dt = dt; stats.gpu = gpu;
    if (settle > 0) { settle--; return; }
    period = Math.max(MIN_PERIOD, Math.min(period, dt));
    stats.period = period;

    const slow = dt > 1.25 * period || gpu > 1.1 * period;
    const fast = gpu < 0.6 * period && dt < 1.1 * period;
    if (slow) {
      fastRun = 0;
      if (++slowRun < 2) return;
      if (level === LEVELS.length - 1) {
        // At the floor and still slow: the period is stale (for example the
        // window moved to a slower display). Take the current interval.
        if (++floorRun >= 10) { period = dt; floorRun = 0; }
        return;
      }
      if (now - raisedAt < RAISE_TEST_MS) failedAt[level] = now;
      set(level + (Math.max(dt, gpu) > 2 * period ? 2 : 1), now);
    } else if (fast) {
      slowRun = 0; floorRun = 0;
      if (level === 0 || ++fastRun < RAISE_AFTER) return;
      if (now - failedAt[level - 1] < RETRY_MS) return;
      set(level - 1, now);
    } else {
      slowRun = 0; fastRun = 0; floorRun = 0;
    }
  }

  return {
    get level() { return level; },
    stats,
    // One call per drawn frame. A long gap (a hidden tab) is not a sample.
    sample(dtMs, gpuMs, now = performance.now()) {
      if (!(dtMs > 0) || dtMs > 250) return;
      dts.push(dtMs);
      gpus.push(gpuMs > 0 ? gpuMs : 0);
      if (dts.length >= WINDOW) decide(now);
    },
    // One call per frame that draws nothing: a clean sample of the refresh.
    idle(dtMs) {
      if (!(dtMs > 0) || dtMs > 250) return;
      idles.push(dtMs);
      if (idles.length >= WINDOW) {
        period = Math.max(MIN_PERIOD, Math.min(period, median(idles)));
        stats.period = period;
        idles.length = 0;
      }
    },
    // Skip the next windows: a location switch or a resize is not a steady state.
    hold() { dts.length = 0; gpus.length = 0; settle = 2; slowRun = 0; fastRun = 0; },
  };
}

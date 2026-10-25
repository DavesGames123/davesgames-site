// ============================================================================
//  VIEW INPUT  ·  pure gesture helpers (no DOM): wheel, fling, taps, two fingers
// ----------------------------------------------------------------------------
//  The viewer wires pointer, wheel and key events to these helpers.
//    wheelPixels(e, pageH)    deltaY in px for any deltaMode
//    wheelZoomFactor(px, pinch)  zoom factor for one wheel event
//    classifyTwo(s, n)        two-finger gesture: 'pinch', 'slice' or null
//    Fling                    pointer velocity over the last 100 ms, then a
//                             glide that decays with tau 325 ms (the iOS feel)
//    TapCounter               double tap: two taps in 300 ms and 24 px
//
//  GREP MAP
//    grep -n 'export function classifyTwo'
//    grep -n 'export class Fling'
//    grep -n 'export class TapCounter'
// ============================================================================

export function wheelPixels(e, pageH = 800) {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageH : 1;
  return { x: (e.deltaX || 0) * k, y: (e.deltaY || 0) * k };
}

// One wheel event -> zoom factor (>1 is zoom in). A trackpad pinch comes as
// ctrl+wheel with small deltas, so it gets a stronger gain. The factor is
// clamped so one big mouse-wheel step does not jump.
export function wheelZoomFactor(px, pinch = false) {
  const g = pinch ? 0.012 : 0.0024;
  const f = Math.exp(-px * g);
  return Math.min(2.2, Math.max(1 / 2.2, f));
}

// s: { d, cx, cy } at the gesture start (finger distance, centroid);
// n: the same now. A gesture becomes 'pinch' when the distance changes by
// more than 6%, or 'slice' when both fingers move up or down together by
// more than 22 px with the distance near constant. null: not decided yet.
export function classifyTwo(s, n, opt = {}) {
  const dRatio = Math.abs(n.d / Math.max(1, s.d) - 1);
  const dy = n.cy - s.cy, dx = n.cx - s.cx;
  if (dRatio > (opt.pinch ?? 0.06)) return 'pinch';
  if (Math.abs(dy) > (opt.slice ?? 22) && Math.abs(dy) > 1.6 * Math.abs(dx) && dRatio < 0.04) return 'slice';
  if (Math.hypot(dx, dy) > (opt.pan ?? 30)) return 'pinch';   // two-finger pan acts as pinch-pan
  return null;
}

export class Fling {
  constructor() { this.samples = []; }
  reset() { this.samples.length = 0; }
  add(x, y, t) {
    this.samples.push({ x, y, t });
    while (this.samples.length > 2 && t - this.samples[0].t > 100) this.samples.shift();
  }
  // px per ms over the window; zero if the pointer stopped before release
  velocity(tNow) {
    const s = this.samples;
    if (s.length < 2) return { vx: 0, vy: 0 };
    const a = s[0], b = s[s.length - 1];
    if (tNow - b.t > 60) return { vx: 0, vy: 0 };
    const dt = Math.max(8, b.t - a.t);
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }
  // displacement after dt ms of glide from velocity v (px/ms), tau ms
  static glide(v, dt, tau = 325) { return v * tau * (1 - Math.exp(-dt / tau)); }
}

export class TapCounter {
  constructor(ms = 300, px = 24) { this.ms = ms; this.px = px; this.last = null; }
  // returns 2 on a double tap, else 1
  tap(x, y, t) {
    const l = this.last;
    if (l && t - l.t < this.ms && Math.hypot(x - l.x, y - l.y) < this.px) { this.last = null; return 2; }
    this.last = { x, y, t };
    return 1;
  }
}

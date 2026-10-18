// ============================================================================
//  ANIMATED PATTERN DESIGNER  ·  governor.js — the frame-rate governor (no DOM)
// ----------------------------------------------------------------------------
//  The page gives sample(interval, cost, now) once per frame: interval is
//  the time between two animation frames, cost the time the page spent on
//  the frame (motion plus draw calls), both in ms. The governor keeps an
//  average of each (EMA) and moves one level on the LEVELS ladder:
//
//    down  the frames are slow (interval over SLOW) and the page is the
//          cause (cost over a share of the interval), for DOWN_N frames
//          after the last change. One very slow frame cost (PANIC) twice
//          in a row also steps down.
//    up    the frames are fast (interval under FAST) and the cost is low,
//          for upN frames. upN doubles each time a step up is followed by
//          a step down within BOUNCE ms, so the level does not swing.
//
//  A level has px (a factor on the canvas pixel ratio) and pts (a factor
//  on the point budget of the geometry). A change of px is free. A change
//  of pts makes the page build the geometry again at a lower density.
//  An interval over GAP ms (a hidden tab, a debugger) is not a sample.
//
//  grep -n targets: "export const LEVELS", "export class Governor"
// ============================================================================
export const LEVELS = [
  { px: 1, pts: 1 },
  { px: 0.85, pts: 1 },
  { px: 0.75, pts: 0.72 },
  { px: 0.66, pts: 0.52 },
  { px: 0.58, pts: 0.36 },
  { px: 0.5, pts: 0.25 },
];
export const GOV = { SLOW: 1000 / 48, FAST: 1000 / 56, SHARE: 0.35, COST_HI: 9, COST_LO: 7, DOWN_N: 24, UP_N: 150, BOUNCE: 4000, PANIC: 70, GAP: 250, A: 0.12 };

export class Governor {
  constructor(o = {}) {
    this.levels = o.levels || LEVELS;
    this.level = Math.max(0, Math.min(this.levels.length - 1, o.level || 0));
    this.minLevel = o.minLevel || 0;
    this.reset();
    this.upN = GOV.UP_N; this.lastUp = -1e9;
  }
  reset() { this.ei = 0; this.ec = 0; this.n = 0; this.panic = 0; }
  get value() { return this.levels[this.level]; }
  // Returns the new level when it changes, else null.
  sample(interval, cost, now) {
    if (!(interval > 0) || interval > GOV.GAP) return null;
    const a = this.n ? GOV.A : 1;
    this.ei += (interval - this.ei) * a; this.ec += (cost - this.ec) * a; this.n++;
    this.panic = cost > GOV.PANIC ? this.panic + 1 : 0;
    const slow = this.ei > GOV.SLOW && (this.ec > this.ei * GOV.SHARE || this.ec > GOV.COST_HI);
    if (this.level < this.levels.length - 1 && ((this.n >= GOV.DOWN_N && slow) || this.panic >= 2)) {
      if (now - this.lastUp < GOV.BOUNCE) this.upN = Math.min(this.upN * 2, 2400);
      return this.set(this.level + 1);
    }
    const fast = this.ei < GOV.FAST && this.ec < GOV.COST_LO;
    if (this.level > this.minLevel && this.n >= this.upN && fast) { this.lastUp = now; return this.set(this.level - 1); }
    return null;
  }
  set(l) { this.level = l; this.reset(); return l; }
}

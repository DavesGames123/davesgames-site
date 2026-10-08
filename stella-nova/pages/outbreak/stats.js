// ============================================================================
//  OUTBREAK  ·  stats.js — live numbers for the HUD and the director (no DOM)
// ----------------------------------------------------------------------------
//  tickCounter(shown, target, dt) moves a shown HUD number toward its
//  target, so the counters tick up and never jump: an exponential approach
//  at COUNT_RATE per second, with a floor step so the last digits finish.
//  A target below the shown value (a new run) snaps at once.
//
//  grep -n targets: "export const COUNT_RATE", "export function tickCounter"
// ============================================================================

export const COUNT_RATE = 5;        // 1/s, the approach of a shown counter

export function tickCounter(shown, target, dt, rate = COUNT_RATE) {
  if (!Number.isFinite(target)) return shown;
  if (!Number.isFinite(shown) || target <= shown) return target;
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  const step = Math.max((target - shown) * k, Math.min(target - shown, Math.max(1, target * 1e-4) * rate * dt));
  const v = shown + step;
  return target - v < 0.5 ? target : v;
}

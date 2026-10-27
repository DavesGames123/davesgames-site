// ============================================================================
//  FLY DUEL 3D  ·  easing curves and seeded random  (pure ES module, no three)
// ----------------------------------------------------------------------------
//  Split out of ui/fly3d/scene.js. Cubic ease-out, cubic ease-in-out and a
//  small seeded random number source (the toss of a hand is the same for
//  the same record).
//
//  GREP MAP   (grep -n targets)
//      grep -n 'export const easeOut'  cubic ease-out, clamped
//      grep -n 'export function rngf'  seeded random numbers
//      grep -n 'export const easeIO'   cubic ease-in-out, clamped
// ============================================================================

export const easeOut = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
// A small seeded random number source (the toss of a hand is the same
// for the same record).
export function rngf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const easeIO = t => { t = Math.min(1, Math.max(0, t)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

// ============================================================================
//  HUMAN SKULL  ·  saver-lift.js — the saver lift of a part, no DOM, no THREE
// ────────────────────────────────────────────────────────────────────────────
//  In a saver push-in (main.js window.snSaver) the part lifts out of the
//  skull and back: out from SKULL_MID through its home, by 35% of its
//  largest mesh side, 12 to 40 mm. saver-lift.test.mjs runs these on
//  data/skull.json.
//
//  The camera fit takes the box round both ends of the lift (liftBox), so
//  the part stays in the clear band of the plate when the lift runs across
//  the screen. A portrait phone has a narrow band, so it needs this most.
//  Before, the fit took the home box only, at 0.6 of the short side, and a
//  lift across the screen took the part out of the band.
//
//  GREP MAP
//    export const SKULL_MID ...... the middle of the skull, mm
//    export function liftVec ..... the lift of a part (home, ext), mm
//    export function liftBox ..... centre and size of the box round both ends
// ============================================================================

export const SKULL_MID = [0, -10, 15];

// home: the part centre [x, y, z]; ext: its mesh size [x, y, z], mm
export function liftVec(home, ext) {
  let v = [home[0] - SKULL_MID[0], home[1] - SKULL_MID[1], home[2] - SKULL_MID[2]];
  let l = Math.hypot(v[0], v[1], v[2]);
  if (l * l < 1) { v = [0, 1, 0]; l = 1; }
  const a = Math.min(40, Math.max(12, 0.35 * Math.max(...ext)));
  return v.map(x => x / l * a);
}

// The axis-aligned box round the part at home and at the full lift.
export function liftBox(home, ext, L = liftVec(home, ext)) {
  return { c: home.map((x, k) => x + L[k] / 2), size: ext.map((x, k) => x + Math.abs(L[k])) };
}

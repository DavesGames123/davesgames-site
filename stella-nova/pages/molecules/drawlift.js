// ============================================================================
//  MOLECULES  ·  drawlift.js — the draw-then-lift animation timing (no DOM)
// ----------------------------------------------------------------------------
//  The skeletal formula draws itself bond by bond as thin ink, holds a
//  moment, then lifts into the 3D structure while the ink thickens into
//  the chosen style (view3d.js radius() blends the atom size by ink).
//  The page plays it each time a molecule loads, and every saver shot
//  opens with it. drawLiftAt(t, nb, D) gives the view state at t seconds:
//    reveal  bonds drawn so far (view3d setReveal), or null when all show
//    ink     1 = thin white drawing, 0 = the full style (setInk)
//    morph   0 = the flat drawing, 1 = the 3D structure (setMorph)
//    done    true once the lift is over
//  D = { draw, hold, lift } in seconds. timingFor(dur, quick) picks D for a
//  shot of dur seconds (the page default when dur is null; quick for one
//  molecule of a family montage).
//
//  GREP MAP
//    export function timingFor ..... the phase lengths
//    export function drawLiftAt .... the view state at time t
// ============================================================================

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// The page: 2.2 s of drawing, 0.35 s held, 1.9 s of lift. A saver shot:
// about 30 % drawing and 20 % lift, within limits, so the 3D part keeps
// most of a long shot and a short shot still shows the whole lift.
// A molecule of a family montage (short: about 3-5 s each) gets a quick
// version, so most of its time is still the 3D view.
export function timingFor(dur = null, quick = false) {
  if (dur == null) return { draw: 2.2, hold: 0.35, lift: 1.9 };
  if (quick) return { draw: clamp(0.3 * dur, 0.9, 1.6), hold: 0.12, lift: clamp(0.22 * dur, 0.8, 1.3) };
  return { draw: clamp(0.3 * dur, 1.8, 3.6), hold: 0.3, lift: clamp(0.2 * dur, 1.4, 2.4) };
}

export function drawLiftAt(t, nb, D) {
  const tl = D.draw + D.hold;
  if (t < D.draw) {
    // a little before bond 0 so the first stroke starts from nothing; a
    // little past the last so it closes fully
    return { reveal: (clamp(t / D.draw, 0, 1) * (nb + 0.5)) - 0.2, ink: 1, morph: 0, done: false };
  }
  if (t < tl) return { reveal: null, ink: 1, morph: 0, done: false };
  if (t < tl + D.lift) {
    const u = (t - tl) / D.lift;
    // the ink thins out over the first 60 % of the lift while the atoms
    // rise, so the style grows in as the molecule takes its shape
    // morph is linear: view3d.js updatePositions eases it
    return { reveal: null, ink: Math.max(0, 1 - u / 0.6), morph: u, done: false };
  }
  return { reveal: null, ink: 0, morph: 1, done: true };
}

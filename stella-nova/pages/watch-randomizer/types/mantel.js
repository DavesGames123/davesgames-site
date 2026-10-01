// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  types/mantel.js — mantel clock
// ────────────────────────────────────────────────────────────────────────────
//  The spec side of one case type (no DOM, no THREE; tests.mjs runs it):
//    id, name, weight, clock, calibres, caseSpec, describe, palette, dims
//    (see types/wall.js), and layout(spec, own, pend) for the builder.
//  cases/mantel.js builds it. Three French forms: a drum (tambour) on a
//  marble or wooden plinth, a Napoleon hat case, and a portico with four
//  columns. A pendulum that would reach below the drum lifts the drum onto
//  columns, so the pendulum swings between them.
// ============================================================================
export const PLINTHS = { 'black marble': ['paint', '#1d1d22'], 'white marble': ['paint', '#e6e3dc'], 'green marble': ['paint', '#2d4a3d'], 'rouge marble': ['paint', '#6b2b27'], walnut: ['wood', '#6b4428'], mahogany: ['wood', '#7a3324'] };
export const MOUNTS = { 'gilt bronze': '#e0b768', brass: '#d6a85c', patinated: '#7c6a4a' };
// nominal pendulum sizes of calibres not loaded yet (for the camera fit only)
// calibres that bring their own dial: the case frames it and paints none
export const OWN_FACE = { brocot: true, deadbeat: true };
const PEND = { brocot: { L: 110, bobR: 16, pivot: [0, 33, 24] }, anchor: { L: 110, bobR: 13, pivot: [0, 57, 24] } };

// sizes in mm from the calibre's own dial radius; pend = cal.pendulum or null
export function layout(spec, own, pend) {
  const c = spec.case, dialR = OWN_FACE[spec.movement.calibre] ? own + 0.5 : own * 1.25 + 4, drumR = dialR + 9;
  const pb = pend ? pend.pivot[1] - pend.L - pend.bobR * 1.15 : null;
  const columns = c.style === 'portico' || (c.style === 'drum' && pb !== null && pb < -drumR - 2);
  let yP = c.style === 'portico' ? -drumR * 1.9 : -drumR - 2;              // plinth top
  if (pb !== null) yP = Math.min(yP, pb - 8);
  const hatBase = c.style === 'napoleon' ? Math.min(-drumR * 1.05, pb !== null ? pb - 8 : 0) : null;
  const ph = drumR * 0.34, pw = drumR * (columns ? 2.9 : 2.5);
  const top = c.style === 'napoleon' ? drumR + 6 : columns ? drumR + 14 : drumR;
  const bottom = (c.style === 'napoleon' ? hatBase : yP) - ph - 6;
  return { dialR, drumR, pb, columns, yP, hatBase, ph, pw, top, bottom, W: c.style === 'napoleon' ? drumR * 3.9 : pw };
}

export default {
  id: 'mantel', name: 'Mantel clock', weight: 1.2, clock: true,
  calibres: [['brocot', 6], ['anchor', 2], ['lever', 2]],
  layout,
  caseSpec: (R) => ({
    style: R.weighted([['drum', 4], ['napoleon', 3], ['portico', 2]]),
    plinth: R.pick(Object.keys(PLINTHS)),
    mounts: R.weighted([['gilt bronze', 5], ['brass', 3], ['patinated', 1]]),
  }),
  describe: (spec) => { const c = spec.case; return [['Case', `${c.style === 'drum' ? 'drum (tambour)' : c.style === 'napoleon' ? 'Napoleon hat' : 'portico'} case, ${c.plinth}, ${c.mounts} mounts`]]; },
  palette: (spec) => {
    const [mat, col] = PLINTHS[spec.case.plinth];
    return { polished: { color: MOUNTS[spec.case.mounts], roughness: 0.2 }, [mat]: { color: col, roughness: mat === 'paint' ? 0.12 : 0.5 } };
  },
  dims: (spec, own) => {
    const L = layout(spec, own, PEND[spec.movement.calibre] || null);
    return { dialR: L.dialR, R: Math.max(L.top - L.bottom, L.W) * 0.56 };
  },
};

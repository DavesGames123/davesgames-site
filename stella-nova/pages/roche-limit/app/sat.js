// ============================================================================
//  ROCHE LIMIT  ·  app/sat.js — where a moon is now
// ----------------------------------------------------------------------------
//  The bound centre of a moon, extrapolated from its last analysis:
//  in world units (satCentre) or in sim units with the velocity
//  (satState). The camera, the overlays and the readouts use them.
//
//  grep -n targets
//    world centre ............. "function satCentre"
//    position and velocity .... "function satState"
// ============================================================================

// The bound centre now, in world units (planet radii), extrapolated from
// the last analysis with its velocity.
export function satCentre(s) {
  const X = s.ref.X;
  if (!s.an) return [X[0] * s.k, X[1] * s.k, X[2] * s.k];
  const dt = s.gpu.t - s.an.t;
  return [0, 1, 2].map(i => (X[i] + s.an.com[i] + s.an.vcm[i] * dt) * s.k);
}
export function satState(s) {
  const X = s.ref.X, V = s.ref.V;
  if (!s.an) return { r: X.slice(), v: V.slice() };
  const dt = s.gpu.t - s.an.t;
  return { r: [0, 1, 2].map(i => X[i] + s.an.com[i] + s.an.vcm[i] * dt), v: [0, 1, 2].map(i => V[i] + s.an.vcm[i]) };
}

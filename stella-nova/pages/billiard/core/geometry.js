// ============================================================================
//  POOL PHYSICS  ·  core/geometry.js — ghost ball, cut angle, clear lines
// ----------------------------------------------------------------------------
//  The aiming geometry that the AI, the shot planner and the maths overlay
//  share. All of it is plain 2D vector maths on the table plane.
//
//    pocket aim P ....... a point a little inside the pocket mouth
//    p^ = (P - O) / |P - O|          object ball O to the pocket
//    G  = O - 2R p^                  the ghost ball: where the cue ball
//                                    centre must be at the contact
//    d^ = (G - C) / |G - C|          the aim line of the cue ball C
//    cos(theta) = d^ . p^            theta: the cut angle
//    f = 1 - sin(theta)              the ball fraction (0.5 = a half-ball hit)
//    stun cue ball after the contact:  v_O = v cos(theta) along p^ (the line
//    of centres), v_C = v sin(theta) along the tangent line
//
//  grep -n targets: "export function pocketAim", "export function ghost",
//  "export function pathClear", "export function shotGeometry",
//  "export function potChance"
// ============================================================================

export const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// The point a ball aims at for pocket p: the mouth centre, a little inside.
export function pocketAim(p) {
  const k = p.kind === 'corner' ? 0.025 : 0.012;
  return { x: p.mx + p.ox * k, y: p.my + p.oy * k };
}

export function ghost(ox, oy, px, py, R) {
  const dx = px - ox, dy = py - oy, d = Math.hypot(dx, dy);
  return { x: ox - 2 * R * dx / d, y: oy - 2 * R * dy / d, px: dx / d, py: dy / d, d };
}

// Is the segment A-B clear of every ball centre by at least `clear` (not
// counting the balls in skip)? S: the physics state.
export function pathClear(S, ax, ay, bx, by, clear, skip) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-12;
  for (let k = 0; k < 16; k++) {
    if (!S.on[k] || skip.includes(k)) continue;
    let t = ((S.x[k] - ax) * dx + (S.y[k] - ay) * dy) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx - S.x[k], qy = ay + t * dy - S.y[k];
    if (qx * qx + qy * qy < clear * clear) return false;
  }
  return true;
}

// The full geometry of a pot of ball n in pocket p from the cue ball at
// (cx, cy). null when the shot cannot be made (blocked, too thin, the
// ghost ball off the cloth, a bad angle into the pocket).
export function shotGeometry(S, T, n, p, cx = S.x[0], cy = S.y[0]) {
  const R = T.R, ox = S.x[n], oy = S.y[n], aim = pocketAim(p);
  const g = ghost(ox, oy, aim.x, aim.y, R);
  if (Math.abs(g.x) > T.hx - R + 1e-4 || Math.abs(g.y) > T.hy - R + 1e-4) return null;
  const ax = g.x - cx, ay = g.y - cy, d1 = Math.hypot(ax, ay);
  if (d1 < 1e-4) return null;
  const dx = ax / d1, dy = ay / d1;
  const cos = dx * g.px + dy * g.py;
  if (cos < 0.17) return null;                       // thinner than ~80 deg
  const theta = Math.acos(Math.min(1, cos));
  // the approach angle into the pocket against its mouth direction
  const app = Math.acos(Math.max(-1, Math.min(1, g.px * p.ox + g.py * p.oy)));
  if (app > (p.kind === 'corner' ? 52 : 48) * Math.PI / 180) return null;
  if (!pathClear(S, cx, cy, g.x, g.y, 2 * R - 2e-4, [0, n])) return null;
  if (!pathClear(S, ox, oy, aim.x, aim.y, 2 * R - 2e-4, [0, n])) return null;
  // the side of the cut: + when the object ball goes left of the aim line
  const side = Math.sign(dx * g.py - dy * g.px) || 1;
  return { n, pocket: p.id, ox, oy, gx: g.x, gy: g.y, aimX: aim.x, aimY: aim.y, px: g.px, py: g.py, dx, dy,
    d1, d2: g.d, theta, cos, app, side, phi: Math.atan2(dy, dx), psi: Math.atan2(g.py, g.px), frac: 1 - Math.sin(theta) };
}

// The chance to pot with aim noise sigma (radians, on the cue ball line):
// the object ball direction error is sigma * d1 / (2R cos theta); the pocket
// takes an error up to atan(w / d2), w the usable half width of the mouth.
export function potChance(geo, T, sigma) {
  const p = T.pockets[geo.pocket], R = T.R;
  const w = Math.max(0.004, (p.mouth / 2 - 0.62 * R) * (p.kind === 'corner' ? 1 : 0.85) * Math.max(0.35, Math.cos(geo.app)));
  const eps = Math.atan(w / Math.max(0.02, geo.d2));
  const s = Math.max(1e-5, sigma) * geo.d1 / (2 * R * Math.max(0.12, geo.cos)) + 0.002;
  return erf(eps / (Math.SQRT2 * s));
}

export function erf(x) {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

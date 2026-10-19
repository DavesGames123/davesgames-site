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
//  Banks, kicks and combinations: the ball centre meets a cushion R inside
//  the nose line; a mirror in that line makes the one-rail path straight.
//  A combination chains two ghost balls (the second ball's, then the
//  first ball's). Each returns the shot shape with kind 'bank', 'kick' or
//  'combo' and its extra data (bank: rail, bounce, mirror; combo: the
//  second ghost and the second cut).
//
//  grep -n targets: "export function pocketAim", "export function ghost",
//  "export function pathClear", "export function shotGeometry",
//  "export function potChance", "export function bankGeometry",
//  "export function kickGeometry", "export function comboGeometry",
//  "export function fancyChance"
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

// ── bank, kick and combination shots ────────────────────────────────────────
// The ball centre meets a cushion on a line R inside the nose line. A mirror
// in that line turns a one-rail path into a straight line (the "mirror
// method" of bank and kick systems). The real rebound is a little wider
// (tan b_out ~ tan b_in / e_c, and the spin moves it); the AI corrects the
// mirror aim with short simulations (core/ai.js bankTrim).
export const RAILS = ['top', 'bottom', 'left', 'right'];
function railLine(T, rail) {
  const R = T.R;
  if (rail === 'top') return { axis: 'y', v: T.hy - R };
  if (rail === 'bottom') return { axis: 'y', v: -(T.hy - R) };
  if (rail === 'right') return { axis: 'x', v: T.hx - R };
  return { axis: 'x', v: -(T.hx - R) };
}
export function mirror(T, rail, x, y) {
  const L = railLine(T, rail);
  return L.axis === 'y' ? { x, y: 2 * L.v - y } : { x: 2 * L.v - x, y };
}
// where the segment A -> M (M mirrored) crosses the rail line; null if it does not
function hitRail(T, rail, ax, ay, mx, my) {
  const L = railLine(T, rail);
  const a = L.axis === 'y' ? ay : ax, m = L.axis === 'y' ? my : mx;
  if ((a - L.v) * (m - L.v) >= 0) return null;
  const t = (L.v - a) / (m - a);
  return { x: ax + (mx - ax) * t, y: ay + (my - ay) * t, t };
}
// is the bounce point on solid cushion (not in or near a pocket mouth)?
function onCushion(T, rail, p) {
  const R = T.R, a = T.spec.cornerMouth / Math.SQRT2, b = T.spec.sideMouth / 2;
  if (rail === 'top' || rail === 'bottom') { const x = Math.abs(p.x); return x > b + 2.2 * R && x < T.hx - a - 2.2 * R; }
  return Math.abs(p.y) < T.hy - a - 2.2 * R;
}
const pocketOnRail = (p, rail) => (rail === 'top' ? p.my > 0 && (p.kind === 'side' || p.sy > 0) : rail === 'bottom' ? p.my < 0 && (p.kind === 'side' || p.sy < 0) : rail === 'right' ? p.kind === 'corner' && p.sx > 0 : p.kind === 'corner' && p.sx < 0);

// The common tail: the cue ball line to the ghost ball, the cut angle, the
// clear lines, the shape that the AI and the maths use.
function aimTo(S, T, n, gx, gy, px, py, cx, cy, skip, minCos) {
  const R = T.R;
  if (Math.abs(gx) > T.hx - R + 1e-4 || Math.abs(gy) > T.hy - R + 1e-4) return null;
  const ax = gx - cx, ay = gy - cy, d1 = Math.hypot(ax, ay);
  if (d1 < 1e-4) return null;
  const dx = ax / d1, dy = ay / d1, cos = dx * px + dy * py;
  if (cos < minCos) return null;
  if (!pathClear(S, cx, cy, gx, gy, 2 * R - 2e-4, skip)) return null;
  return { dx, dy, d1, cos, theta: Math.acos(Math.min(1, cos)), side: Math.sign(dx * py - dy * px) || 1, phi: Math.atan2(dy, dx) };
}

// A one-rail bank: ball n off `rail` into pocket p.
export function bankGeometry(S, T, n, p, rail, cx = S.x[0], cy = S.y[0]) {
  if (pocketOnRail(p, rail)) return null;
  const R = T.R, ox = S.x[n], oy = S.y[n], aim = pocketAim(p), M = mirror(T, rail, aim.x, aim.y);
  const B = hitRail(T, rail, ox, oy, M.x, M.y);
  if (!B || !onCushion(T, rail, B)) return null;
  const L1 = Math.hypot(B.x - ox, B.y - oy), L2 = Math.hypot(aim.x - B.x, aim.y - B.y);
  if (L1 < 3 * R || L2 < 0.25) return null;
  const px = (B.x - ox) / L1, py = (B.y - oy) / L1;
  const gx = ox - 2 * R * px, gy = oy - 2 * R * py;
  const c = aimTo(S, T, n, gx, gy, px, py, cx, cy, [0, n], 0.42);
  if (!c) return null;
  if (!pathClear(S, ox, oy, B.x, B.y, 2 * R - 2e-4, [0, n])) return null;
  if (!pathClear(S, B.x, B.y, aim.x, aim.y, 2 * R - 2e-4, [0, n])) return null;
  const fx = (aim.x - B.x) / L2, fy = (aim.y - B.y) / L2;
  const app = Math.acos(Math.max(-1, Math.min(1, fx * p.ox + fy * p.oy)));
  if (app > (p.kind === 'corner' ? 45 : 38) * Math.PI / 180) return null;
  // the rebound angle off the normal (a steep bank is less sure)
  const inA = Math.acos(Math.min(1, Math.abs(rail === 'top' || rail === 'bottom' ? py : px)));
  if (inA > 62 * Math.PI / 180) return null;
  return { kind: 'bank', n, hit: n, pocket: p.id, ox, oy, gx, gy, aimX: aim.x, aimY: aim.y, px, py, dx: c.dx, dy: c.dy,
    d1: c.d1, d2: L1 + L2, theta: c.theta, cos: c.cos, app, side: c.side, phi: c.phi, psi: Math.atan2(py, px), frac: 1 - Math.sin(c.theta),
    bank: { rail, bx: B.x, by: B.y, mx: M.x, my: M.y, inA } };
}

// A kick: the cue ball off `rail` into ball n, which goes to pocket p.
export function kickGeometry(S, T, n, p, rail, cx = S.x[0], cy = S.y[0]) {
  const R = T.R, ox = S.x[n], oy = S.y[n], aim = pocketAim(p), g = ghost(ox, oy, aim.x, aim.y, R);
  if (Math.abs(g.x) > T.hx - R + 1e-4 || Math.abs(g.y) > T.hy - R + 1e-4) return null;
  if (!pathClear(S, ox, oy, aim.x, aim.y, 2 * R - 2e-4, [0, n])) return null;
  const M = mirror(T, rail, g.x, g.y), B = hitRail(T, rail, cx, cy, M.x, M.y);
  if (!B || !onCushion(T, rail, B)) return null;
  const L1 = Math.hypot(B.x - cx, B.y - cy), L2 = Math.hypot(g.x - B.x, g.y - B.y);
  if (L1 < 0.08 || L2 < 0.15) return null;
  const fx = (g.x - B.x) / L2, fy = (g.y - B.y) / L2, cos = fx * g.px + fy * g.py;
  if (cos < 0.5) return null;
  if (!pathClear(S, cx, cy, B.x, B.y, 2 * R - 2e-4, [0])) return null;
  if (!pathClear(S, B.x, B.y, g.x, g.y, 2 * R - 2e-4, [0, n])) return null;
  const app = Math.acos(Math.max(-1, Math.min(1, g.px * p.ox + g.py * p.oy)));
  if (app > (p.kind === 'corner' ? 48 : 40) * Math.PI / 180) return null;
  const dx = (B.x - cx) / L1, dy = (B.y - cy) / L1, theta = Math.acos(Math.min(1, cos));
  return { kind: 'kick', n, hit: n, pocket: p.id, ox, oy, gx: g.x, gy: g.y, aimX: aim.x, aimY: aim.y, px: g.px, py: g.py, dx, dy,
    d1: L1 + L2, d2: g.d, theta, cos, app, side: Math.sign(fx * g.py - fy * g.px) || 1, phi: Math.atan2(dy, dx), psi: Math.atan2(g.py, g.px), frac: 1 - Math.sin(theta),
    bank: { rail, bx: B.x, by: B.y, mx: M.x, my: M.y, cue: true } };
}

// A combination: the cue ball sends ball a into ball b, b goes to pocket p.
export function comboGeometry(S, T, a, b, p, cx = S.x[0], cy = S.y[0]) {
  const R = T.R, aim = pocketAim(p), bx = S.x[b], by = S.y[b], ax = S.x[a], ay = S.y[a];
  const gB = ghost(bx, by, aim.x, aim.y, R);
  if (!pathClear(S, bx, by, aim.x, aim.y, 2 * R - 2e-4, [0, a, b])) return null;
  const Lab = Math.hypot(gB.x - ax, gB.y - ay);
  if (Lab < 1e-3 || Lab > 0.9) return null;
  const qx = (gB.x - ax) / Lab, qy = (gB.y - ay) / Lab, cosB = qx * gB.px + qy * gB.py;
  if (cosB < 0.82) return null;                       // the second cut stays thin enough to trust
  if (!pathClear(S, ax, ay, gB.x, gB.y, 2 * R - 2e-4, [0, a, b])) return null;
  const gx = ax - 2 * R * qx, gy = ay - 2 * R * qy;
  const c = aimTo(S, T, a, gx, gy, qx, qy, cx, cy, [0, a], 0.5);
  if (!c) return null;
  const app = Math.acos(Math.max(-1, Math.min(1, gB.px * p.ox + gB.py * p.oy)));
  if (app > (p.kind === 'corner' ? 48 : 40) * Math.PI / 180) return null;
  return { kind: 'combo', n: b, hit: a, pocket: p.id, ox: ax, oy: ay, gx, gy, aimX: aim.x, aimY: aim.y, px: qx, py: qy, dx: c.dx, dy: c.dy,
    d1: c.d1, d2: gB.d, theta: c.theta, cos: c.cos, app, side: c.side, phi: c.phi, psi: Math.atan2(qy, qx), frac: 1 - Math.sin(c.theta),
    combo: { a, b, bx, by, gBx: gB.x, gBy: gB.y, pBx: gB.px, pBy: gB.py, Lab, cosB, thetaB: Math.acos(Math.min(1, cosB)) } };
}

// The pot chance of a bank, kick or combination with aim noise sigma: the
// error grows on each leg (a longer path, an extra cut, the cushion).
export function fancyChance(geo, T, sigma) {
  const p = T.pockets[geo.pocket], R = T.R;
  const w = Math.max(0.004, (p.mouth / 2 - 0.62 * R) * (p.kind === 'corner' ? 1 : 0.85) * Math.max(0.35, Math.cos(geo.app)));
  let s;
  if (geo.kind === 'combo') {
    const c = geo.combo, k1 = geo.d1 / (2 * R * Math.max(0.12, geo.cos)), k2 = c.Lab / (2 * R * Math.max(0.3, c.cosB));
    s = Math.max(1e-5, sigma) * k1 * (1 + k2) + 0.004;
    return erf(Math.atan(w / Math.max(0.02, geo.d2)) / (Math.SQRT2 * s));
  }
  // bank and kick: the cushion adds a spread that grows with the angle in
  s = Math.max(1e-5, sigma) * geo.d1 / (2 * R * Math.max(0.12, geo.cos)) * (geo.kind === 'kick' ? 2.2 : 1) + 0.006 + 0.012 * Math.sin(geo.bank.inA || 0.3);
  return erf(Math.atan(w / Math.max(0.02, geo.d2)) / (Math.SQRT2 * s));
}

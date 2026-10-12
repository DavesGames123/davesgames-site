// ============================================================================
//  GRAVITY LAB  ·  frame.js — the frame the camera films in (no DOM)
// ----------------------------------------------------------------------------
//  A FRAME is a centre c (world) and an angle theta about +z. Frame
//  coordinates: p' = Rz(-theta) (p - c). The renderer draws in frame
//  coordinates (render.js), so a view that follows a body or turns with a
//  pair (the Lagrange points, the horseshoe orbits) is only a different
//  frame, and the trails are kept in it.
//    centre   the spec's view.center: 'com' (the barycentre) or a body
//             index; a followed body (the user's choice) wins
//    turn     view.rotating [i, j]: theta is the angle of j about i, so the
//             pair stays on the x axis; omega its rate
//  frameOf(sys, view, follow) -> { c, v (velocity of c), th, om }
//
//  grep -n targets: "export function frameOf", "export function toFrame",
//  "export function toWorld", "export function toWorldVel"
// ============================================================================

export function frameOf(sys, view = {}, follow = -1) {
  let c = [0, 0, 0], v = [0, 0, 0];
  const ok = i => Number.isInteger(i) && i >= 0 && i < sys.n && sys.alive[i];
  const ctr = follow >= 0 && ok(follow) ? follow : view.center;
  if (ok(ctr)) { c = sys.pos(ctr); v = sys.vel(ctr); }
  else {
    let M = 0;
    for (let i = 0; i < sys.n; i++) {
      if (!sys.alive[i] || !(sys.m[i] > 0)) continue;
      M += sys.m[i];
      for (let k = 0; k < 3; k++) { c[k] += sys.m[i] * sys.x[3 * i + k]; v[k] += sys.m[i] * sys.v[3 * i + k]; }
    }
    if (M > 0) for (let k = 0; k < 3; k++) { c[k] /= M; v[k] /= M; }
  }
  let th = 0, om = 0;
  const rp = view.rotating;
  if (rp && !(follow >= 0) && ok(rp[0]) && ok(rp[1])) {
    const dx = sys.x[3 * rp[1]] - sys.x[3 * rp[0]], dy = sys.x[3 * rp[1] + 1] - sys.x[3 * rp[0] + 1];
    const ux = sys.v[3 * rp[1]] - sys.v[3 * rp[0]], uy = sys.v[3 * rp[1] + 1] - sys.v[3 * rp[0] + 1];
    th = Math.atan2(dy, dx);
    om = (dx * uy - dy * ux) / Math.max(dx * dx + dy * dy, 1e-300);
  }
  return { c, v, th, om };
}
export function toFrame(f, p) {
  const dx = p[0] - f.c[0], dy = p[1] - f.c[1], cs = Math.cos(f.th), sn = Math.sin(f.th);
  return [cs * dx + sn * dy, -sn * dx + cs * dy, p[2] - f.c[2]];
}
export function toWorld(f, q) {
  const cs = Math.cos(f.th), sn = Math.sin(f.th);
  return [f.c[0] + cs * q[0] - sn * q[1], f.c[1] + sn * q[0] + cs * q[1], f.c[2] + q[2]];
}
// a direction (no shift)
export function dirToWorld(f, d) {
  const cs = Math.cos(f.th), sn = Math.sin(f.th);
  return [cs * d[0] - sn * d[1], sn * d[0] + cs * d[1], d[2]];
}
export function dirToFrame(f, d) {
  const cs = Math.cos(f.th), sn = Math.sin(f.th);
  return [cs * d[0] + sn * d[1], -sn * d[0] + cs * d[1], d[2]];
}
// The inertial velocity of a point at world position p that moves with
// velocity u in the frame: v_c + R u + omega z x (p - c).
export function toWorldVel(f, p, u) {
  const w = dirToWorld(f, u), dx = p[0] - f.c[0], dy = p[1] - f.c[1];
  return [f.v[0] + w[0] - f.om * dy, f.v[1] + w[1] + f.om * dx, f.v[2] + w[2]];
}

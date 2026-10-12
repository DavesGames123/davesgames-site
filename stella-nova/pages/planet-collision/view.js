// ============================================================================
//  PLANET COLLISION  ·  view.js — the camera: auto framing plus the user's
//  orbit (no DOM, no GPU)
// ----------------------------------------------------------------------------
//  The world frame is the centre of mass of the collision (it stays at 0).
//  The orbits of the two bodies are in the x-y plane, and spins are about z.
//
//  AUTO FRAME (fn frameTarget). Before contact: the point and distance that
//  hold both bodies (their centres from stats().com, their radii). After
//  contact: the target body's remnant, with a margin that grows with the
//  sim time since contact, so the debris arc comes into view. Both move to
//  their goals with a time constant (fn stepView), so a cut has no jump.
//
//  USER ORBIT. yaw and pitch (radians) turn the eye about the target, zoom
//  scales the auto distance. A drag sets them; the page resets them.
//
//  grep -n targets: "export function makeView", "export function frameTarget",
//  "export function stepView", "export function eyeOf"
// ============================================================================

export function makeView() {
  return { yaw: -1.25, pitch: 0.42, zoom: 1, target: [0, 0, 0], dist: 8, goal: null, user: false };
}

// bodies: [{ c: [x,y,z] or null, R }] (index 0 the target); contactT: sim
// hours since the first contact (null before); fov: vertical, radians;
// aspect: width / height. Returns { target, dist }.
export function frameTarget(bodies, contactT, fov, aspect) {
  const live = bodies.filter(b => b && b.c);
  if (!live.length) return { target: [0, 0, 0], dist: 6 };
  const half = Math.min(fov, fov * aspect) / 2;
  if (contactT == null) {
    // the box round both spheres
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const b of live) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], b.c[k] - b.R); hi[k] = Math.max(hi[k], b.c[k] + b.R); }
    const target = lo.map((v, k) => 0.5 * (v + hi[k]));
    const rad = 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    return { target, dist: 1.08 * rad / Math.sin(half) };
  }
  const B = live[0];
  const grow = 1.6 + Math.min(2.4, 0.9 * contactT);
  return { target: B.c.slice(), dist: grow * B.R / Math.sin(half) };
}

// Move the view toward goal { target, dist } over dt seconds (tau: the time
// constant, s).
export function stepView(v, goal, dt, tau = 0.8) {
  const k = 1 - Math.exp(-dt / tau);
  for (let i = 0; i < 3; i++) v.target[i] += (goal.target[i] - v.target[i]) * k;
  v.dist += (goal.dist - v.dist) * k;
}

// The eye position for the view (z up).
export function eyeOf(v) {
  const d = v.dist * v.zoom, cp = Math.cos(v.pitch);
  return [v.target[0] + d * cp * Math.cos(v.yaw), v.target[1] + d * cp * Math.sin(v.yaw), v.target[2] + d * Math.sin(v.pitch)];
}

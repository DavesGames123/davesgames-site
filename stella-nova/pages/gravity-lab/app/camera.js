// ============================================================================
//  GRAVITY LAB  ·  app/camera.js — the orbit camera in frame coordinates
// ----------------------------------------------------------------------------
//  The camera turns about a target in frame coordinates (frame.js): the
//  centre of the frame is the barycentre, the spec's body, or the followed
//  body, so following is a change of frame and the target stays near 0.
//  When the frame changes, the target starts at the old centre and eases
//  to the new one (no jump).
//    az, el    azimuth and elevation (rad), el in [-85, 85] deg
//    dist      the distance to the target; fitDist() frames the view
//              extent in the narrow side of the screen
//  The user turns it (pointer.js: drag, wheel, pinch); the saver drives
//  it with shot goals (app/saver.js: S.saver.goal) on critically damped
//  springs, so a cut can also be hard (cam.cut). A goal with lock set
//  moves the target with the goal at once (a follow or a close shot).
//  camFrame(W, H) returns the renderer camera (render.js writeCam).
//
//  grep -n targets: "export const cam", "export function resetCam",
//  "export function fitDist", "export function camFrame", "export function eyeOf"
// ============================================================================
import { S, UI } from './state.js';

export const FOV = 40 * Math.PI / 180;
export const cam = {
  az: -0.6, el: 0.5, dist: 10, target: [0, 0, 0], tgtOff: [0, 0, 0],
  // spring state (the saver)
  v: { az: 0, el: 0, dist: 0 }, cut: false, shiftY: 0,
  userAt: 0,
};
export function fitDist(ext, W, H) {
  const asp = W / Math.max(1, H), t = Math.tan(FOV / 2);
  return ext * 1.12 / (t * Math.min(1, asp));
}
export function resetCam(spec, W, H) {
  const v = spec.view || {};
  cam.el = (v.tilt ?? 35) * Math.PI / 180;
  cam.az = -0.6 + (v.rotating ? -Math.PI / 2 + 0.6 : 0);
  cam.dist = fitDist(v.extent || 1, W, H);
  cam.target = [0, 0, 0]; cam.tgtOff = [0, 0, 0];
  cam.cut = true;
}
export function eyeOf(az, el, dist, tgt) {
  const ce = Math.cos(el);
  return [tgt[0] + dist * ce * Math.cos(az), tgt[1] + dist * ce * Math.sin(az), tgt[2] + dist * Math.sin(el)];
}
function spring(x, goal, vel, k, dt) {
  // critically damped: x'' = -k^2 (x - g) - 2k x'
  const a = -k * k * (x - goal) - 2 * k * vel;
  vel += a * dt; x += vel * dt;
  return [x, vel];
}
// Advance the camera by dt (s) and return the renderer camera.
export function camFrame(W, H, dt) {
  const g = S.saverOn && S.saver && S.saver.goal;
  if (g) {
    if (cam.cut) { cam.az = g.az; cam.el = g.el; cam.dist = g.dist; cam.target = g.target.slice(); cam.v = { az: 0, el: 0, dist: 0 }; cam.cut = false; }
    else {
      const k = 1.6;
      // the shortest way round in azimuth
      let da = g.az - cam.az; da -= 2 * Math.PI * Math.round(da / (2 * Math.PI));
      [cam.az, cam.v.az] = spring(cam.az, cam.az + da, cam.v.az, k, dt);
      [cam.el, cam.v.el] = spring(cam.el, g.el, cam.v.el, k, dt);
      const ld = Math.log(cam.dist);
      let vd; [cam.dist, vd] = spring(ld, Math.log(g.dist), cam.v.dist, k, dt); cam.v.dist = vd; cam.dist = Math.exp(cam.dist);
      // a locked goal (follow, close) holds the subject; else ease to it
      const e = g.lock ? 1 : 1 - Math.exp(-dt * 2.2);
      for (let c = 0; c < 3; c++) cam.target[c] += (g.target[c] - cam.target[c]) * e;
    }
    cam.shiftY += ((g.shiftY || 0) - cam.shiftY) * Math.min(1, dt * 3);
  } else {
    cam.cut = false;
    const e = 1 - Math.exp(-dt * 2.5);
    for (let c = 0; c < 3; c++) { cam.tgtOff[c] *= 1 - e; cam.target[c] += (cam.tgtOff[c] - cam.target[c]) * e; }
    cam.shiftY *= 1 - Math.min(1, dt * 3);
  }
  cam.el = Math.max(-1.48, Math.min(1.48, cam.el));
  const eye = eyeOf(cam.az, cam.el, cam.dist, cam.target);
  return { eye, target: cam.target.slice(), up: [0, 0, 1], fovy: FOV, near: Math.max(1e-9, cam.dist * 2e-4), shiftY: cam.shiftY };
}

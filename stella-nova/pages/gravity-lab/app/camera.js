// ============================================================================
//  GRAVITY LAB  ·  app/camera.js — the orbit camera in frame coordinates
// ----------------------------------------------------------------------------
//  The camera turns about a target in frame coordinates (frame.js): the
//  centre of the frame is the barycentre, the spec's body, or the followed
//  body, so following is a change of frame and the target stays near 0.
//    az, el    azimuth and elevation (rad), el in [-85, 85] deg
//    dist      the distance to the target
//  THE DIRECTOR (director.js) aims the camera at the action. Each frame
//  directFrame() scores the pairs of bodies and gives a focus: the bound
//  centre of mass and a radius that holds the system (calm), or a pair in
//  a close pass, a capture, a merge (the pair and its recent trails).
//  The sim events (the bus) boost their pair. stepCam (director.js)
//  eases the target and the distance to that focus.
//    page    the director moves the target and the distance; the user
//            turns the camera (az, el). A zoom (wheel, pinch) gives the
//            distance to the user for USER_HOLD ms; a followed body or a
//            throw in progress stops the director.
//    saver   app/saver.js sets S.saver.goal { az, el, frame, zoomK }: the
//            shot angle on critically damped springs, the framing through
//            stepCam inside the plate band (lib/saver-clear.js plateBand).
//            A cut (cam.cut) jumps.
//  camFrame(W, H) returns the renderer camera (render.js writeCam).
//
//  grep -n targets: "export const cam", "export function resetCam",
//  "export function fitDist", "export function directFrame",
//  "export function camFrame", "export function eyeOf", "USER_HOLD"
// ============================================================================
import { S, UI, bus } from './state.js';
import { makeDirector, noteEvent, direct, stepCam, ringTail, DIR } from '../director.js';

export const FOV = DIR.FOV;
const USER_HOLD = 10000;
export const cam = {
  az: -0.6, el: 0.5, dist: 10, target: [0, 0, 0], tgtOff: [0, 0, 0],
  // spring state (the saver)
  v: { az: 0, el: 0, dist: 0 }, cut: false, shiftY: 0,
  userAt: 0, zoomAt: -Infinity,
  dir: makeDirector(), fc: { cut: true }, auto: false,
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
  cam.zoomAt = -Infinity;
  cam.dir = makeDirector(); cam.fc = { cut: false }; cam.auto = false;
}
// The director's focus of this frame (after the sim step): S.dirNow.
export function directFrame(dt) {
  const sys = S.lab && S.lab.sys, sp = S.spec;
  if (!sp) return null;
  const rNow = S.meta ? S.meta.map(m => m.rNow ?? m.rDraw) : null;
  S.dirNow = direct(cam.dir, sys, S.frame, dt, {
    view: sp.view, ext: sp.view.extent, rNow, parts: !!(sp.particles || sp.self),
    trail: i => ringTail(S.trails[i], DIR.TRAIL_K),
  });
  return S.dirNow;
}
// a new run: a new director, and no focus of the run before
bus('run', () => { cam.dir = makeDirector(); S.dirNow = null; });
bus('event', d => { if (S.spec) noteEvent(cam.dir, d.e, S.spec.view.extent); });

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
// The framing of the camera through stepCam: the camera's own target and
// distance are the state, so a change of mode does not jump.
function frameTo(d, W, H, band, dt, zoomK, cut, fresh) {
  const fc = cam.fc;
  fc.target = cam.target; fc.dist = cam.dist; fc.shiftY = cam.shiftY; fc.cut = cut;
  if (fresh) fc.prev = null;
  stepCam(fc, d, W, H, band, dt, zoomK);
  cam.target = fc.target; cam.dist = fc.dist; cam.shiftY = fc.shiftY;
}
// Advance the camera by dt (s) and return the renderer camera.
export function camFrame(W, H, dt) {
  const g = S.saverOn && S.saver && S.saver.goal;
  if (g) {
    const cut = cam.cut;
    if (cut) { cam.az = g.az; cam.el = g.el; cam.v = { az: 0, el: 0, dist: 0 }; }
    else {
      const k = 1.6;
      // the shortest way round in azimuth
      let da = g.az - cam.az; da -= 2 * Math.PI * Math.round(da / (2 * Math.PI));
      [cam.az, cam.v.az] = spring(cam.az, cam.az + da, cam.v.az, k, dt);
      [cam.el, cam.v.el] = spring(cam.el, g.el, cam.v.el, k, dt);
    }
    if (g.frame) frameTo(g.frame, W, H, g.band, dt, g.zoomK || 1, cut, !cam.auto);
    cam.auto = true; cam.cut = false;
  } else {
    cam.cut = false;
    const now = performance.now();
    const auto = !!S.dirNow && S.follow < 0 && !S.aim && !(now - cam.zoomAt < USER_HOLD);
    if (auto) frameTo(S.dirNow, W, H, null, dt, 1, false, !cam.auto);
    else if (S.follow >= 0) {
      // following: the frame centre is the body; ease the target there
      const e = 1 - Math.exp(-dt * 2.5);
      for (let c = 0; c < 3; c++) { cam.tgtOff[c] *= 1 - e; cam.target[c] += (cam.tgtOff[c] - cam.target[c]) * e; }
    }
    cam.auto = auto;
    cam.shiftY *= 1 - Math.min(1, dt * 3);
  }
  cam.el = Math.max(-1.48, Math.min(1.48, cam.el));
  const eye = eyeOf(cam.az, cam.el, cam.dist, cam.target);
  return { eye, target: cam.target.slice(), up: [0, 0, 1], fovy: FOV, near: Math.max(1e-9, cam.dist * 2e-4), shiftY: cam.shiftY };
}

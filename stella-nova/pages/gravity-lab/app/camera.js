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
//            distance to the user for USER_HOLD ms, then the camera eases
//            back (stepCam rate caps); a followed body, a throw in
//            progress or the Follow action toggle off (UI.action) stops
//            the director.
//  PARTICLES. readParts() reads the particle rows back every READ_S s
//  (focus.js sampleRows, in the frame of the readback): the director's
//  action camera weighs them (galaxy tails, debris, dust at the points).
//  LOOK. lookFrame() gives the particle gain and point size against the
//  crowding (focus.js densityGain: the brightness hint and the densest
//  screen cell) and the bloom fade for a star that fills the view
//  (bloomFactor); main.js writes them in the camera uniform.
//    saver   app/saver.js sets S.saver.goal { az, el, frame, zoomK }: the
//            shot angle on critically damped springs, the framing through
//            stepCam inside the plate band (lib/saver-clear.js plateBand).
//            A cut (cam.cut) jumps.
//  camFrame(W, H) returns the renderer camera (render.js writeCam).
//
//  grep -n targets: "export const cam", "export function resetCam",
//  "export function fitDist", "export function directFrame",
//  "export function camFrame", "export function eyeOf", "USER_HOLD",
//  "function readParts", "export function lookFrame"
// ============================================================================
import { S, UI, bus } from './state.js';
import { toFrame } from '../frame.js';
import { makeDirector, noteEvent, direct, stepCam, ringTail, project, DIR } from '../director.js';
import { sampleRows, partsInFrame, peakDensity, densityGain, bloomFactor, FOCUS } from '../focus.js';
import { EXPERIMENTS } from '../experiments/index.js';

export const FOV = DIR.FOV;
const USER_HOLD = 8000;
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
// The particle sample of the run (focus.js sampleRows): a readback of the
// particle rows every FOCUS.READ_S s (one at a time; a readback of the run
// before is dropped). S.partSample { pos, vel, row, n, live, t, frame }:
// in the frame of the readback (a new frame, a followed body, starts a
// new sample).
let readAt = -Infinity, runId = 0;
function readParts() {
  const lab = S.lab, now = performance.now(), id = runId;
  if (!lab || !lab.be || !lab.be.readback || now - readAt < FOCUS.READ_S * 1000) return;
  readAt = now;
  const t = lab.t, cap = lab.cap, f0 = S.frame;
  let r;
  try { r = lab.be.readback(); } catch (e) { return; }
  Promise.resolve(r).then(rb => { if (rb && rb.body && id === runId && S.lab === lab) S.partSample = sampleRows(rb.body, cap, t, f0); }).catch(() => {});
}
// The director's focus of this frame (after the sim step): S.dirNow.
export function directFrame(dt) {
  const sys = S.lab && S.lab.sys, sp = S.spec;
  if (!sp) return null;
  const P = sp.self || sp.particles, parts = !!(P && P.n) || !!(S.lab && S.lab.pool);
  if (parts) readParts();
  const rNow = S.meta ? S.meta.map(m => m.rNow ?? m.rDraw) : null;
  S.sampleNow = S.partSample && S.frame && sys ? partsInFrame(S.partSample, S.frame, S.lab.t, P && P.group, sp.view.extent) : null;
  const X = EXPERIMENTS[sp.key];
  S.dirNow = direct(cam.dir, sys, S.frame, dt, {
    view: sp.view, ext: sp.view.extent, rNow, parts,
    trail: i => ringTail(S.trails[i], DIR.TRAIL_K),
    spec: sp, focus: X && X.focus, sample: S.sampleNow, pending: !!(P && P.n) && !S.partSample, t: S.lab ? S.lab.t : 0,
  });
  return S.dirNow;
}
// a new run: a new director, no focus and no particle sample of the run
// before
bus('frame', () => { S.partSample = null; readAt = -Infinity; });
bus('run', () => { cam.dir = makeDirector(); S.dirNow = null; S.partSample = null; S.sampleNow = null; runId++; readAt = -Infinity; });

// The look of this frame against the crowding: { gainK, ptK, bloomK },
// eased (no flicker). c: the camFrame result; W, H: CSS px; gain: the base
// particle gain.
const look = { gainK: 1, bloomK: 1 };
export function lookFrame(c, W, H, gain, dt) {
  const sys = S.lab && S.lab.sys, d = S.dirNow, ps = S.sampleNow;
  let gk = 1, bk = 1;
  if (ps && ps.n) {
    const proj = p => project(c, p, W, H);
    gk = densityGain({ fr: d && d.calm && d.calm.fa, nLive: ps.live, viewPx: W * H, peak: peakDensity(ps.pos, ps.n, ps.live, proj, W, H), ptPx: 1.05, gain });
  }
  if (sys && S.meta) {
    // the largest star on screen: its drawn radius in px
    const t = Math.tan(FOV / 2), f = [c.target[0] - c.eye[0], c.target[1] - c.eye[1], c.target[2] - c.eye[2]], fl = Math.hypot(...f) || 1;
    let px = 0;
    for (let i = 0; i < sys.n; i++) {
      const m = S.meta[i]; if (!m || !sys.alive[i] || !(m.id === 0 || m.id === 7)) continue;
      const p = toFrame(S.frame, sys.pos(i)), z = ((p[0] - c.eye[0]) * f[0] + (p[1] - c.eye[1]) * f[1] + (p[2] - c.eye[2]) * f[2]) / fl;
      if (z > 0) px = Math.max(px, (m.rNow ?? m.rDraw) * 0.5 * H / (t * z));
    }
    bk = bloomFactor(px);
  }
  const e = c.cut ? 1 : 1 - Math.exp(-dt * 2);
  look.gainK += (gk - look.gainK) * e; look.bloomK += (bk - look.bloomK) * e;
  return { gainK: look.gainK, ptK: 0.8 + 0.2 * look.gainK, bloomK: look.bloomK };
}
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
    const auto = UI.action && !!S.dirNow && S.follow < 0 && !S.aim && !(now - cam.zoomAt < USER_HOLD);
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

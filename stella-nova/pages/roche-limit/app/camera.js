// ============================================================================
//  ROCHE LIMIT  ·  app/camera.js — the calm camera
// ----------------------------------------------------------------------------
//  cameraFrame() moves the eye and the target toward the goal of the
//  view mode, under the speed limits below, and returns the frame for
//  the renderer. camStats keeps the largest motions for the checks.
//
//  grep -n targets
//    view state ........ "const cam ="
//    speed limits ...... "const ROT_MAX"
//    goal of a mode .... "function camGoal"
//    framing ........... "function poseOf"
//    governor .......... "function cameraFrame"
//    motion stats ...... "function finishPose"
// ============================================================================
import { cross, norm, sub } from '../render.js';
import { saverCamera } from './saver.js';
import { orbitsPerMin } from './loop.js';
import { UI } from './env.js';
import { occlusion } from './occlusion.js';
import { satState, satCentre } from './sat.js';
import { S } from './state.js';

// The user found the first version nauseating and asked for the planet to
// stay still while the moon goes round. Now:
//   - the default is the planet view: the planet at the centre, a fixed
//     direction and a fixed distance for the run (run.viewD); the camera
//     never follows the moon unless the user picks Follow
//   - every view is inertial (az and el fixed in space) with +z up: no roll
//   - a governor moves the camera: an ease toward the goal with a speed
//     limit and an acceleration limit, for the turn of the view, for the
//     target (as a fraction of the distance) and for the zoom. A drag or a
//     pinch moves it at once; a button choice gets at most 6 deg/s; all
//     else stays under ROT_MAX
//   - camStats keeps the largest view rotation (deg/s, deg/frame) and the
//     largest shift of the planet centre on screen (deg/frame), user moves
//     not counted
const FOLLOW_MAX_DEG = 8;        // deg/s of the moon about the planet, real time
const ROT_MAX = { calm: 2.5, normal: 4 };        // deg/s, view turn
const ROT_BOOST = 6;                              // deg/s, after a button choice
const LIN_MAX = { calm: 0.025, normal: 0.035 };  // target speed / distance, 1/s
const ZOOM_MAX = { calm: 0.08, normal: 0.12 };   // d(ln dist)/dt, 1/s
export const cam = { az: 0.9, el: 0.22, zoom: 1, pose: null, user: false, dragging: false, boostUntil: 0, vr: 0, vl: 0, vz: 0, fastFollow: false };
export const camStats = { rotDegS: 0, rotDegFrame: 0, planetDegFrame: 0, planetDegS: 0, frames: 0, userFrames: 0, prev: null };
export function resetCamStats() { Object.assign(camStats, { rotDegS: 0, rotDegFrame: 0, planetDegFrame: 0, planetDegS: 0, frames: 0, userFrames: 0, prev: null }); }
// sim time per real second at the current speed
function simRate() { return UI.paused ? 0 : orbitsPerMin() / 60 * S.run.T0; }
function camGoal(cssW, cssH) {
  const s = S.run.sats[0];
  const Rw = (s.Rs || s.C.Rs) * s.k;
  let target, dist, el = cam.el;
  let mode = UI.cam;
  cam.fastFollow = false;
  if (mode === 'follow' && S.run.phase === 'orbit') {
    // how fast does the moon go round the planet, in real time?
    const st = satState(s), r = Math.hypot(...st.r), h = Math.hypot(...cross(st.r, st.v));
    const degS = h / (r * r) * simRate() * 180 / Math.PI;
    if (degS > FOLLOW_MAX_DEG) { cam.fastFollow = true; mode = 'planet'; }
  }
  const vd = S.run.viewD || 2.5;
  if (mode === 'follow') {
    target = satCentre(s);
    dist = 9 * Rw;
    if (S.run.spec.kind === 'flyby' && s.an && s.an.comAll) {
      const dt = s.gpu.t - s.an.t;
      if (!s.an.live) target = [0, 1, 2].map(i => (s.ref.X[i] + s.an.comAll[i] + s.an.vcmAll[i] * dt) * s.k);
      dist = Math.min(Math.max(dist, 1.2 * s.an.spread * s.k), 30 * Rw);
    }
  } else if (mode === 'planet') {
    target = [0, 0, 0]; dist = 2.35 * vd;
  } else {
    target = [0, 0, 0]; dist = 2.6 * vd; el = 1.42;
  }
  if (mode !== 'follow') dist *= Math.max(1, 0.8 * cssH / cssW);
  return { target, dist: dist * cam.zoom, az: cam.az, el };
}
// The eye and target for a goal, framed in the clear part of the canvas.
function poseOf(g, cssW, cssH) {
  const o = occlusion(cssW, cssH);
  const clearW = Math.max(80, cssW - o.l - o.r), clearH = Math.max(80, cssH - o.t - o.b);
  const fit = Math.min(1.9, Math.max(cssW / clearW * 0.85, cssH / clearH, 1));
  const dist = g.dist * fit;
  const ce = Math.cos(g.el), dir = [ce * Math.cos(g.az), ce * Math.sin(g.az), Math.sin(g.el)];
  const eye = [0, 1, 2].map(i => g.target[i] + dist * dir[i]), target = g.target.slice();
  const f = norm(sub(target, eye)), r = norm(cross(f, [0, 0, 1])), u = cross(r, f);
  const focal = 0.5 * cssH / Math.tan(FOV / 2);
  const ox = (o.l - o.r) / 2, oy = (o.b - o.t) / 2;
  const sx = -ox * dist / focal, sy = -oy * dist / focal;
  for (let i = 0; i < 3; i++) { const d = sx * r[i] + sy * u[i]; eye[i] += d; target[i] += d; }
  const re = Math.hypot(...eye);
  if (re < 1.3) for (let i = 0; i < 3; i++) eye[i] *= 1.3 / re;
  return { eye, target };
}
const FOV = 0.62;
// rotate unit vector a toward unit vector b by at most ang (radians)
function turnToward(a, b, ang) {
  const c = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])), full = Math.acos(c);
  if (full < 1e-9) return b.slice();
  if (ang >= full) return b.slice();
  let ax = cross(a, b); const l = Math.hypot(...ax);
  ax = l < 1e-9 ? [0, 0, 1] : ax.map(q => q / l);
  const cs = Math.cos(ang), sn = Math.sin(ang), d = ax[0] * a[0] + ax[1] * a[1] + ax[2] * a[2], x = cross(ax, a);
  return [0, 1, 2].map(i => a[i] * cs + x[i] * sn + ax[i] * d * (1 - cs));
}
export function cameraFrame(dtReal, cssW, cssH) {
  const g = camGoal(cssW, cssH);
  if (S.saverOn && S.saver) saverCamera(g, dtReal);
  const want = poseOf(g, cssW, cssH);
  const P0 = cam.pose;
  if (!P0 || ![...P0.eye, ...P0.target].every(Number.isFinite)) { cam.pose = { eye: want.eye.slice(), target: want.target.slice() }; return finishPose(dtReal, true); }
  const dt = Math.max(1e-3, Math.min(0.1, dtReal));
  const user = cam.dragging || performance.now() < (cam.userUntil || 0), boost = performance.now() < cam.boostUntil;
  const calm = UI.calm ? 'calm' : 'normal';
  const rotMax = (user ? 720 : boost && !UI.calm ? ROT_BOOST : ROT_MAX[calm]) * Math.PI / 180;
  const linMax = user ? 50 : boost ? 0.2 : LIN_MAX[calm];
  const zoomMax = user ? 50 : boost ? 0.3 : ZOOM_MAX[calm];
  const acc = user ? 1e9 : 2.0;            // speed limits are reached in about 0.5 s
  const ease = 1 - Math.exp(-dt * (user ? 40 : 1.4));
  // the offset of the eye from the target: direction and length
  const oC = sub(P0.eye, P0.target), oW = sub(want.eye, want.target);
  const lC = Math.hypot(...oC), lW = Math.hypot(...oW);
  const dC = oC.map(q => q / lC), dW2 = oW.map(q => q / lW);
  const ang = Math.acos(Math.max(-1, Math.min(1, dC[0] * dW2[0] + dC[1] * dW2[1] + dC[2] * dW2[2])));
  cam.vr = Math.min(Math.min(rotMax, ang * ease / dt), cam.vr + acc * rotMax * dt);
  const dir = turnToward(dC, dW2, cam.vr * dt);
  const lz = Math.log(lW / lC);
  cam.vz = Math.min(Math.min(zoomMax, Math.abs(lz) * ease / dt), cam.vz + acc * zoomMax * dt);
  const len = lC * Math.exp(Math.sign(lz) * Math.min(Math.abs(lz), cam.vz * dt));
  const dT = sub(want.target, P0.target), lT = Math.hypot(...dT);
  const vmax = linMax * len;
  cam.vl = Math.min(Math.min(vmax, lT * ease / dt), cam.vl + acc * vmax * dt);
  const stepT = lT > 1e-12 ? Math.min(lT, cam.vl * dt) / lT : 0;
  const target = [0, 1, 2].map(i => P0.target[i] + dT[i] * stepT);
  let eye = [0, 1, 2].map(i => target[i] + dir[i] * len);
  const re = Math.hypot(...eye);
  if (re < 1.3) eye = eye.map(q => q * 1.3 / re);
  cam.pose = { eye, target };
  return finishPose(dtReal, false, user);
}
// The frame for the renderer, and the motion statistics. Only user moves
// (drag, pinch, wheel) are exempt from camStats; the 6 deg/s button boost
// is counted.
function finishPose(dtReal, snapped, exempt = false) {
  const { eye, target } = cam.pose;
  const dist = Math.hypot(...sub(eye, target));
  const f = norm(sub(target, eye)), r = norm(cross(f, [0, 0, 1])), u = cross(r, f);
  const pc = norm(sub([0, 0, 0], eye));
  const pcCam = [dot3(pc, r), dot3(pc, u), dot3(pc, f)];
  const pv = camStats.prev;
  if (pv && !snapped && dtReal > 0 && dtReal < 0.1) {
    // the turn between the two camera bases: angle of B_prev^T B_now
    const tr = dot3(pv.r, r) + dot3(pv.u, u) + dot3(pv.f, f);
    const rot = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI;
    const pl = Math.acos(Math.max(-1, Math.min(1, dot3(pv.pc, pcCam)))) * 180 / Math.PI;
    if (exempt || (S.saverOn && S.saver && S.saver.fade < 0.05)) camStats.userFrames++;
    else {
      camStats.frames++;
      camStats.rotDegFrame = Math.max(camStats.rotDegFrame, rot); camStats.rotDegS = Math.max(camStats.rotDegS, rot / dtReal);
      camStats.planetDegFrame = Math.max(camStats.planetDegFrame, pl); camStats.planetDegS = Math.max(camStats.planetDegS, pl / dtReal);
    }
  }
  camStats.prev = { r, u, f, pc: pcCam };
  return { eye, target, fov: FOV, near: Math.max(1e-4, dist * 0.02), subject: target };
}
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

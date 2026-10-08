// ============================================================================
//  OUTBREAK  ·  camera.js — camera state, poses and eased flights (no DOM)
// ----------------------------------------------------------------------------
//  cam = { lat, lon, alt, tilt, heading }
//    lat, lon  degrees. The point the camera looks at (on the surface).
//    alt       distance from that point to the camera: globe radii (globe)
//              or map units (flat). With tilt 0 on the globe, the camera
//              is at 1 + alt from the globe centre.
//    tilt      degrees from straight down (0 = look at the globe centre).
//    heading   degrees clockwise from north: the direction the top of the
//              screen points along the surface.
//
//  pose(cam, mode) -> { pos, target, up }. mode is 'globe', 'flat'
//  ('equirect'), or 'equalearth'. The camera sits at
//    target + alt * (cos(tilt) n - sin(tilt) f),  f = cos(h) north + sin(h) east
//  so a tilt moves the camera back from the heading, and up is the unit
//  vector sin(tilt) n + cos(tilt) f, at right angles to the view.
//
//  flight(from, to, opts) -> { dur, at(t) }. t is seconds since the start.
//  The globe path follows the great circle; a flat path is a straight line
//  in lat and lon (no antimeridian wrap). The position eases by
//  smootherstep, whose peak rate is 1.875 x the mean rate, so
//    dur = max(minDur, 1.875 * angle / maxDegPerSec)
//  keeps the angular speed under the cap. The altitude rises by
//  hop * angle (radians) at mid flight, so a long jump pulls back.
//
//  spring(cur, target, vel, dt, k) -> { x, v }: the exact critically damped
//  step (rate k per second). It never overshoots from rest and never snaps.
//
//  GREP MAP
//    grep -n 'export function pose'     cam -> pos, target, up
//    grep -n 'export function flight'   eased flight between two cams
//    grep -n 'export function ease'     smootherstep
//    grep -n 'export function spring'   critically damped step
//    grep -n 'export function lerpAngle' shortest-way angle blend
// ============================================================================

import { project, frame, gcDist, slerpLL, wrapLon } from './geo.js';

const R = Math.PI / 180;

export function ease(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Blend two angles in degrees the short way round. Result in [-180, 180).
export function lerpAngle(a, b, t) {
  const d = wrapLon(b - a);
  return wrapLon(a + d * t);
}

export function spring(cur, target, vel, dt, k) {
  const c1 = cur - target, c2 = vel + k * c1, e = Math.exp(-k * dt);
  return { x: target + (c1 + c2 * dt) * e, v: (c2 - k * (c1 + c2 * dt)) * e };
}

export function pose(cam, mode = 'globe') {
  const m = mode === 'flat' ? 'equirect' : mode;
  const target = project(cam.lat, cam.lon, 0, m);
  const { n, north, east } = frame(cam.lat, cam.lon, m);
  const tl = (cam.tilt || 0) * R, hd = (cam.heading || 0) * R, alt = cam.alt;
  const ch = Math.cos(hd), sh = Math.sin(hd), ct = Math.cos(tl), st = Math.sin(tl);
  const f = [ch * north[0] + sh * east[0], ch * north[1] + sh * east[1], ch * north[2] + sh * east[2]];
  const pos = [0, 1, 2].map(i => target[i] + alt * (ct * n[i] - st * f[i]));
  const up = [0, 1, 2].map(i => st * n[i] + ct * f[i]);
  return { pos, target, up };
}

// Angle in degrees between two cams along the path a flight takes.
export function pathDeg(a, b, mode = 'globe') {
  if (mode === 'globe') return gcDist(a.lat, a.lon, b.lat, b.lon) / R;
  return Math.hypot(b.lat - a.lat, b.lon - a.lon);
}

export function flight(from, to, opts = {}) {
  const { maxDegPerSec = 45, minDur = 1.2, hop = 0.35, mode = 'globe' } = opts;
  const globe = mode === 'globe';
  const deg = pathDeg(from, to, mode);
  const dur = Math.max(minDur, 1.875 * deg / maxDegPerSec);
  const a = { lat: from.lat, lon: from.lon }, b = { lat: to.lat, lon: to.lon };
  const lift = hop * deg * R;
  const tiltA = from.tilt || 0, tiltB = to.tilt || 0, hA = from.heading || 0, hB = to.heading || 0;
  function at(t) {
    const u = dur > 0 ? t / dur : 1, e = ease(u);
    let lat, lon;
    if (u >= 1) { lat = to.lat; lon = to.lon; }
    else if (globe) [lat, lon] = slerpLL(a, b, e);
    else { lat = from.lat + (to.lat - from.lat) * e; lon = from.lon + (to.lon - from.lon) * e; }
    return {
      lat, lon,
      alt: from.alt + (to.alt - from.alt) * e + lift * Math.sin(Math.PI * e),
      tilt: tiltA + (tiltB - tiltA) * e,
      heading: lerpAngle(hA, hB, e),
    };
  }
  return { dur, deg, at };
}

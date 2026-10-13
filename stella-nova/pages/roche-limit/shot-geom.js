// ============================================================================
//  ROCHE LIMIT  ·  shot-geom.js — where each kind of shot puts the camera
// ----------------------------------------------------------------------------
//  No DOM: app/cuts.js calls it each frame, tests.mjs checks it.
//  shotGoal(sh, ctx) turns a shot of saver-plan.js and the scene now into
//  a camera goal { target, dist, az, el } (world units; az, el: the
//  direction from the target to the eye), plus minR, the nearest the eye
//  may come to the planet's centre (app/camera.js poseOf), and abs: true
//  for a pose of its own (no framing fit).
//    'off' shots   an offset of the story camera's goal ctx.base: turn,
//                  elevation, zoom and a push over the shot
//    surface       the eye stands just above the cloud tops (1.08 planet
//                  radii, over the atmosphere shell). It looks at the moon
//                  (or, in the ring phase, at a point of the ring) 12 deg
//                  above the horizon, so the limb fills the lower part of
//                  the view. The stand point is fixed for the shot.
//    ride          the eye rides with a fragment (or the bound moon, if
//                  none): behind it along its velocity, a little above its
//                  orbit plane, looking ahead past it. The fragment stays
//                  near the centre; the stream and the planet go by.
//    impact        a low view along the surface at the point where the
//                  first debris hit, from 25 deg round the planet.
//  ctx: { base, prog (0..1 through the shot), c (moon centre, world),
//  v (its velocity), frag ({ p, v } world, or null), bodyR (the planet's
//  drawn radius), ringR (the ring's mean radius), impact (a point on the
//  surface, or null), Rw (the moon's radius, world), calm (0..1) }.
//  sh.anchor holds the fixed stand point of a shot after its first frame.
//  poseIn(g, W, H, o) is the fit of app/camera.js: a goal and the
//  occlusion margins (CSS px) give the eye and the target, with the
//  target moved to the centre of the clear band and the eye kept outside
//  minR. project() maps a world point to CSS px for the same pose.
//
//  grep -n targets: "export function shotGoal", "export function standPoint",
//  "export function goalOfPose", "export function poseIn",
//  "export function project", "export const FOV"
// ============================================================================

export const FOV = 0.62;            // rad, the full vertical view angle
const SURF = 1.08;          // the stand point, in planet radii
const ELEV = 12 * Math.PI / 180;

const len = a => Math.hypot(a[0], a[1], a[2]);
const nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function rotZ(v, a) { const c = Math.cos(a), s = Math.sin(a); return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]]; }

// A goal from an eye and a target.
export function goalOfPose(eye, target, minR) {
  const o = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]], d = len(o);
  return { target: target.slice(), dist: d, az: Math.atan2(o[1], o[0]), el: Math.asin(Math.max(-1, Math.min(1, o[2] / d))), minR, abs: true };
}

// The stand point on the surface (radius r0) from which a point at
// distance d, in the direction u (in the plane), shows ELEV above the
// horizon: the stand point is turned back by gamma (side: which way).
// The elevation atan2(d cos g - r0, d sin g) falls from 90 deg (g = 0) to
// 0 (cos g = r0 / d): bisection.
export function standPoint(u, d, r0, side) {
  if (d <= r0 * 1.02) return u.map(q => q * r0);
  let lo = 0, hi = Math.acos(r0 / d);
  for (let i = 0; i < 40; i++) { const g = 0.5 * (lo + hi); if (Math.atan2(d * Math.cos(g) - r0, d * Math.sin(g)) > ELEV) lo = g; else hi = g; }
  const g = 0.5 * (lo + hi), w = rotZ(nrm([u[0], u[1], 0]), -side * g);
  return [w[0] * r0, w[1] * r0, 0.04 * r0];
}

export function shotGoal(sh, ctx) {
  const b = ctx.base, prog = Math.max(0, Math.min(1, ctx.prog || 0)), calm = ctx.calm || 0;
  if (sh.type !== 'abs') {
    const g = { target: b.target.slice(), dist: b.dist, az: b.az + sh.side * (sh.dAz || 0), el: sh.el === null || sh.el === undefined ? b.el : sh.el, minR: 1.3 };
    g.dist *= (sh.zoom || 1) * (1 - (sh.push || 0) * prog * (1 - 0.5 * calm));
    return g;
  }
  const R = ctx.bodyR || 1;
  if (sh.kind === 'surface') {
    // the subject: the moon, or a point of the ring in the ring phase
    let subj = ctx.c;
    if (sh.phase === 'ring') {
      if (!sh.ringDir) sh.ringDir = nrm([ctx.c[0], ctx.c[1], 0]);
      subj = sh.ringDir.map(q => q * (ctx.ringR || 2));
      subj[2] = 0;
    }
    if (!sh.anchor) sh.anchor = standPoint(nrm([subj[0], subj[1], 0]), Math.hypot(subj[0], subj[1]), SURF * R, sh.side);
    // a moon that moves round: its point is followed, from a fixed stand
    return goalOfPose(sh.anchor, subj, 1.02 * R);
  }
  if (sh.kind === 'impact') {
    const p = ctx.impact || nrm(ctx.c).map(q => q * R);
    if (!sh.anchor) { const u = rotZ(nrm(p), sh.side * 25 * Math.PI / 180); sh.anchor = [u[0] * 1.14 * R, u[1] * 1.14 * R, nrm(p)[2] * R + 0.06 * R]; }
    return goalOfPose(sh.anchor, p, 1.04 * R);
  }
  // ride: behind the fragment along its velocity, above its orbit plane
  const F = ctx.frag ? ctx.frag.p : ctx.c, V = ctx.frag ? ctx.frag.v : ctx.v;
  const f = nrm(V), n = nrm(crs(F, V)), D = Math.max(6 * (ctx.Rw || 0.05), 0.12 * R) * (1 - 0.25 * prog);
  const eye = [0, 1, 2].map(i => F[i] - f[i] * D + n[i] * 0.32 * D);
  const tgt = [0, 1, 2].map(i => F[i] + f[i] * 0.45 * D);
  return goalOfPose(eye, tgt, 1.04 * R);
}

// The camera axes for an eye direction (az, el): dir points from the
// target to the eye; r is screen right, u screen up (+z up, no roll).
function axes(az, el) {
  const ce = Math.cos(el), dir = [ce * Math.cos(az), ce * Math.sin(az), Math.sin(el)];
  const f = dir.map(q => -q), r = nrm(crs(f, [0, 0, 1])), u = crs(r, f);
  return { dir, r, u };
}
// The eye and the target for a goal, framed in the clear band (o: the
// occlusion margins, CSS px). A goal with abs: true keeps its distance;
// any other goal is fitted to the band (the planet view of app/camera.js).
export function poseIn(g, W, H, o) {
  o = o || { l: 0, r: 0, t: 0, b: 0 };
  const clearW = Math.max(80, W - o.l - o.r), clearH = Math.max(80, H - o.t - o.b);
  const fit = g.abs ? 1 : Math.min(1.9, Math.max(W / clearW * 0.85, H / clearH, 1));
  const dist = g.dist * fit, { dir, r, u } = axes(g.az, g.el);
  const eye = [0, 1, 2].map(i => g.target[i] + dist * dir[i]), target = g.target.slice();
  const focal = 0.5 * H / Math.tan(FOV / 2);
  const ox = (o.l - o.r) / 2, oy = (o.b - o.t) / 2;
  const sx = -ox * dist / focal, sy = -oy * dist / focal;
  for (let i = 0; i < 3; i++) { const d = sx * r[i] + sy * u[i]; eye[i] += d; target[i] += d; }
  const re = len(eye), minR = g.minR ?? 1.3;
  if (re < minR) for (let i = 0; i < 3; i++) eye[i] *= minR / re;
  return { eye, target };
}
// A world point in CSS px for a pose: { x, y, z } (z: depth along the
// view, negative behind the eye).
export function project(p, pose, W, H) {
  const f = nrm(pose.target.map((q, i) => q - pose.eye[i])), r = nrm(crs(f, [0, 0, 1])), u = crs(r, f);
  const q = p.map((x, i) => x - pose.eye[i]), z = dot(q, f), focal = 0.5 * H / Math.tan(FOV / 2);
  return { x: W / 2 + focal * dot(q, r) / z, y: H / 2 - focal * dot(q, u) / z, z };
}

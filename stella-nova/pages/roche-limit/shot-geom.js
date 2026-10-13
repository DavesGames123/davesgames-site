// ============================================================================
//  ROCHE LIMIT  ·  shot-geom.js — where each kind of shot puts the camera
// ----------------------------------------------------------------------------
//  No DOM: app/cuts.js and app/camera.js call it each frame, tests.mjs
//  checks it.
//
//  THE COMPLAINT (2026-10-13). The user: "camera angles for the roche
//  limit screensavers are super cinematic, too close up, aggressive, look
//  like they're designed for not the vertical but horizontal aspect" and
//  "much of the time the camera focuses on nothing". The old shots were
//  offsets of the story camera (a turn, a zoom, a push-in of up to 55%),
//  a view from the planet's surface and a ride with one grain. Their
//  distance came from the story camera, not from the subject or the
//  frame, and after the breakup the story camera aims at the point where
//  the moon was. Now every shot frames a SUBJECT.
//
//  THE SUBJECT (function subjectOf). A shot has a scope. The scope gives
//  the aim point (the camera target), the act point (where the action is
//  now) and a set of world points that must be in the frame:
//    orbit    the planet and the moon's orbit circle now; aim: the
//             planet centre (the moon laps it at 28 orbits a minute in the
//             approach, so a camera on the moon would whip round)
//    moon     the moon (or what is left of it), stretched 1.4 times along
//             the tide axis; aim and act: the moon's centre of mass
//    tide     the moon and the near limb of the planet; aim: a point 35%
//             of the way from the moon to the limb; act: the moon
//    cluster  the densest clump of debris (ctx.guide: the remnant while it
//             holds, else a grain of the densest clump) and the debris
//             within 30 deg of it; aim and act: the guide
//    stream   all the debris, the remnant and the planet; aim: the planet
//             centre; act: the stream's mid-point (circular mean angle)
//    ring     the debris ring and the planet; aim: the planet centre;
//             act: the stream's mid-point
//    impact   a patch of 0.45 planet radii round the first impact point;
//             aim and act: the impact point
//
//  THE FRAMING (function distFor). The distance comes from the subject's
//  points and the clear band of the frame (the plate covers the top and
//  the bottom in the screensaver): the points fill sh.fill of the band in
//  its tight direction, so max(box w / band w, box h / band h) = fill.
//  The band, not the canvas, sets the size, so a 9:16 column (a narrow
//  band) gives a farther camera than a 16:9 frame. shotGoal then corrects
//  the distance twice from the projected box (fillOf), for the band shift
//  of poseIn.
//
//  THE ASPECT (function viewDir). A band under BAND_TALL wide per unit of
//  height is "tall" (the 9:16 column with its plate: about 9 by 8). A
//  subject with a long axis (the tide axis of the moon, the tangent of a
//  clump) is put along the band's long side: in a tall band the eye looks
//  along the axis from above (sh.elT, 0.8 to 1.2 rad), so the axis runs
//  top to bottom; in a wide band the eye looks across it (sh.elW). A
//  subject with no axis (the orbit, the ring) takes the reel's seeded
//  view azimuth (ctx.baseAz) and the elevation of the band type.
//
//  THE MOTION. The view direction is fixed at the first frame of a shot.
//  Then it drifts by sh.drift deg/s, and a shot that tracks a moving aim
//  (moon, tide, cluster) turns with half the aim's angle round the planet,
//  so the composition turns by only half of it (CO_TURN). sh.dolly
//  changes the fill over the shot (at most 10%: a slow push, not a
//  push-in). followGoal() eases the distance with a critically damped
//  spring (FOLLOW_W, faster out than in, so a growing subject is not
//  cut), so a new debris sample does not jump the frame.
//
//  THE POSE (function poseIn) is the fit of app/camera.js: a goal and the
//  occlusion margins give the eye and the target, with the target moved
//  to the centre of the clear band and the eye kept outside minR.
//  project() maps a world point to CSS px for the same pose (tests.mjs).
//
//  ctx of shotGoal: { view: { W, H, o: { l, r, t, b } } (CSS px), t (s in
//  the shot), prog (0..1), c (moon centre, world), live (the moon still
//  holds), Rw (the moon's radius, world), debris ([world points], may be
//  empty), guide (world point or null), bodyR, ringR, impact (a point on
//  the surface, or null), baseAz (rad), spin (+1 or -1: the sense of the
//  moon's orbit about +z) }.
//
//  grep -n targets: "export function shotGoal", "export function subjectOf",
//  "export function distFor", "function viewDir", "export function followGoal",
//  "export function poseIn", "export function project", "export function fillOf",
//  "export function streamOf", "export function clusterOf",
//  "export function advance", "export const BAND_TALL"
// ============================================================================

export const FOV = 0.62;            // rad, the full vertical view angle
export const BAND_TALL = 1.4;       // band w / h under this: a tall band
const CO_TURN = 0.5;                // share of the aim's turn the view follows
const FOLLOW_W = [1.4, 3.5];        // 1/s, the distance spring: in, out

const len = a => Math.hypot(a[0], a[1], a[2]);
const nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// The clear band of a view in CSS px, and the focal length.
export function bandOf(view) {
  const { W, H } = view, o = view.o || { l: 0, r: 0, t: 0, b: 0 };
  const w = Math.max(80, W - o.l - o.r), h = Math.max(80, H - o.t - o.b);
  return { x0: o.l, y0: o.t, w, h, focal: 0.5 * H / Math.tan(FOV / 2) };
}
// The camera axes for an eye direction (az, el): dir points from the
// target to the eye; r is screen right, u screen up (+z up, no roll).
function axes(az, el) {
  const ce = Math.cos(el), dir = [ce * Math.cos(az), ce * Math.sin(az), Math.sin(el)];
  const f = dir.map(q => -q), r = nrm(crs(f, [0, 0, 1])), u = crs(r, f);
  return { dir, r, u };
}

// The distance at which the points pts, about the aim, fill `fill` of
// the band in its tight direction (perspective: a point nearer the eye
// by z needs more room).
export function distFor(pts, aim, az, el, view, fill) {
  const B = bandOf(view), { dir, r, u } = axes(az, el);
  const hx = 0.5 * fill * B.w, hy = 0.5 * fill * B.h;
  let D = 1e-3;
  for (const p of pts) {
    const q = [p[0] - aim[0], p[1] - aim[1], p[2] - aim[2]];
    const x = Math.abs(dot(q, r)), y = Math.abs(dot(q, u)), z = dot(q, dir);
    D = Math.max(D, z + B.focal * x / hx, z + B.focal * y / hy, z + 1e-3);
  }
  return D;
}

// Points of a sphere (the 6 axis ends and the 8 cube corners).
function ball(c, R) {
  const k = R / Math.sqrt(3), out = [];
  for (const s of [-1, 1]) { out.push([c[0] + s * R, c[1], c[2]], [c[0], c[1] + s * R, c[2]], [c[0], c[1], c[2] + s * R]); }
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const d of [-1, 1]) out.push([c[0] + a * k, c[1] + b * k, c[2] + d * k]);
  return out;
}
const angOf = p => Math.atan2(p[1], p[0]);

// The stream: the circular mean angle of the debris (the mid-point, at
// the mean radius), the half span (the angle that holds 80% of the
// grains), and the mean radius. null with fewer than 3 grains.
export function streamOf(debris) {
  if (!debris || debris.length < 3) return null;
  let sx = 0, sy = 0, rr = 0, z = 0;
  for (const p of debris) { const a = angOf(p); sx += Math.cos(a); sy += Math.sin(a); rr += Math.hypot(p[0], p[1]); z += p[2]; }
  const n = debris.length, mid = Math.atan2(sy, sx), rM = rr / n;
  const dev = debris.map(p => Math.abs(wrap(angOf(p) - mid))).sort((a, b) => a - b);
  const span = dev[Math.min(n - 1, Math.floor(0.8 * n))];
  return { mid: [rM * Math.cos(mid), rM * Math.sin(mid), z / n], ang: mid, span, rM, R: Math.hypot(sx, sy) / n };
}
// The densest clump: the grain with the most grains within 20 deg of it
// (ties: the nearer to their mean). Returns the grain's index, or -1.
export function clusterOf(debris) {
  if (!debris || !debris.length) return -1;
  const a = debris.map(angOf), w = 20 * Math.PI / 180;
  let best = -1, bn = -1;
  for (let i = 0; i < a.length; i++) {
    let n = 0; for (let j = 0; j < a.length; j++) if (Math.abs(wrap(a[j] - a[i])) < w) n++;
    if (n > bn) { bn = n; best = i; }
  }
  return best;
}
// A shed grain moved on by dt (sim time) on a circle about its own
// orbit normal at its mean motion: a cheap stand-in for its conic, good
// for framing over the 0.2 to 1 s between two reads.
export function advance(p, v, dt, GM) {
  const r = len(p), v2 = dot(v, v), inv = 2 / r - v2 / GM;
  const a = inv > 1e-9 ? 1 / inv : r, n = Math.sqrt(GM / (a * a * a)), h = nrm(crs(p, v));
  const th = n * dt, c = Math.cos(th), s = Math.sin(th), hx = crs(h, p), hd = dot(h, p);
  return [0, 1, 2].map(i => p[i] * c + hx[i] * s + h[i] * hd * (1 - c));
}

// The subject of a shot now: { aim, act, pts, axis (unit, or null),
// track (the aim moves round the planet) }.
export function subjectOf(sh, ctx) {
  const R = ctx.bodyR || 1, c = ctx.c, deb = ctx.debris || [];
  const mR = Math.max(ctx.Rw || 0.05, 1e-3) * 1.15;
  const radial = nrm([c[0], c[1], 0]), tang = crs([0, 0, 1], radial);
  const st = streamOf(deb);
  const near = (q, w, rad) => deb.filter(p => Math.abs(wrap(angOf(p) - angOf(q))) < w && Math.abs(Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1])) < rad);
  switch (sh.scope) {
    case 'orbit': {
      const rho = Math.hypot(c[0], c[1]), pts = ball([0, 0, 0], R).concat(ball(c, mR));
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; pts.push([rho * Math.cos(a), rho * Math.sin(a), c[2]]); }
      return { aim: [0, 0, 0], act: c.slice(), pts, axis: null, track: false };
    }
    case 'moon': {
      // the moon stretches along the tide axis (to 1.34 times, pacing.js)
      const pts = ball(c, mR).concat([1, -1].map(k => c.map((q, i) => q + k * 1.4 * mR * radial[i])));
      return { aim: c.slice(), act: c.slice(), pts, axis: radial, track: true };
    }
    case 'tide': {
      const L = nrm(c).map(q => q * R), aim = [0, 1, 2].map(i => c[i] + 0.35 * (L[i] - c[i]));
      return { aim, act: c.slice(), pts: ball(c, mR).concat([L]), axis: radial, track: true };
    }
    case 'cluster': {
      const g = ctx.guide || c, gr = nrm([g[0], g[1], 0]);
      const pts = ball(g, ctx.guide ? 2 * mR : mR).concat(near(g, 0.52, 0.6 * R));
      return { aim: g.slice(), act: g.slice(), pts, axis: crs([0, 0, 1], gr), track: true };
    }
    case 'stream': case 'ring': {
      let pts = ball([0, 0, 0], R).concat(deb);
      if (ctx.live !== false) pts = pts.concat(ball(c, mR));
      if (sh.scope === 'ring' && deb.length < 8) {
        const rr = ctx.ringR || 2;
        for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; pts.push([rr * Math.cos(a), rr * Math.sin(a), 0]); }
      }
      return { aim: [0, 0, 0], act: st ? st.mid : c.slice(), pts, axis: null, track: false };
    }
    case 'impact': {
      const p = ctx.impact || nrm(c).map(q => q * R), n = nrm(p);
      let t1 = crs([0, 0, 1], n); t1 = len(t1) < 1e-6 ? [1, 0, 0] : nrm(t1);
      const t2 = crs(n, t1), k = 0.45 * R, pts = [p.map((q, i) => q + 0.35 * R * n[i])];
      for (const s of [-1, 1]) { pts.push(p.map((q, i) => q + s * k * t1[i]), p.map((q, i) => q + s * k * t2[i])); }
      return { aim: p.slice(), act: p.slice(), pts, axis: null, track: false, n, t1 };
    }
  }
  return { aim: c.slice(), act: c.slice(), pts: ball(c, mR), axis: tang, track: true };
}

// The eye direction at the first frame of a shot (see THE ASPECT).
function viewDir(sh, sb, ctx, tall) {
  const el = tall ? sh.elT : sh.elW;
  if (sh.scope === 'impact') {
    // from 55 deg off the surface normal, turned along the surface
    const a = 55 * Math.PI / 180, d = nrm(sb.n.map((q, i) => q * Math.cos(a) + sh.side * sb.t1[i] * Math.sin(a)));
    return { az: Math.atan2(d[1], d[0]), el: Math.asin(Math.max(-1, Math.min(1, d[2]))) };
  }
  if (!sb.axis) return { az: (ctx.baseAz || 0) + sh.side * (sh.dAz || 0), el };
  const aAx = Math.atan2(sb.axis[1], sb.axis[0]), out = Math.atan2(sb.aim[1], sb.aim[0]);
  // tall: look along the axis, from the end away from the planet; wide:
  // across the axis, from the side away from the planet. So the planet
  // never stands between the eye and the subject. Of two sides that are
  // the same for that, the one ahead of the subject's motion (ctx.spin:
  // the sign of its orbit about +z): the view turns with only CO_TURN of
  // the subject's turn, so it falls back toward the outer side.
  const fwd = out + (ctx.spin < 0 ? -1 : 1) * Math.PI / 2;
  const score = a => Math.cos(a - out) + 0.5 * Math.cos(a - fwd);
  const pick = (a, b) => score(a) >= score(b) ? a : b;
  return { az: tall ? pick(aAx, aAx + Math.PI) : pick(aAx + Math.PI / 2, aAx - Math.PI / 2), el };
}

export function shotGoal(sh, ctx) {
  const view = ctx.view || { W: 1280, H: 720 }, B = bandOf(view), tall = B.w / B.h < BAND_TALL;
  const sb = subjectOf(sh, ctx), R = ctx.bodyR || 1;
  if (!sh.dir0) {
    const v = viewDir(sh, sb, ctx, tall);
    sh.dir0 = { az: v.az, el: v.el, phi: angOf(sb.aim), turn: 0, tall };
  }
  const d0 = sh.dir0;
  if (sb.track && Math.hypot(sb.aim[0], sb.aim[1]) > 1e-6) {
    const phi = angOf(sb.aim); d0.turn += wrap(phi - d0.phi); d0.phi = phi;
  }
  const az = d0.az + (sb.track ? CO_TURN * d0.turn : 0) + sh.side * (sh.drift || 0) * Math.PI / 180 * (ctx.t || 0);
  const el = Math.max(-1.35, Math.min(1.35, d0.el));
  const fill = Math.max(0.15, Math.min(0.85, (sh.fill || 0.6) * (1 + (sh.dolly || 0) * Math.max(0, Math.min(1, ctx.prog || 0)))));
  let dist = distFor(sb.pts, sb.aim, az, el, view, fill);
  // the band shift of poseIn moves the eye off the aim's line, so a near
  // point grows a little: two corrections from the projected reach
  const g = { target: sb.aim, dist, az, el, minR: 1.06 * R, abs: true, subj: sb };
  for (let k = 0; k < 2; k++) {
    const f = fillOf(sb.pts, poseIn(g, view.W, view.H, view.o), view, true);
    if (!(f > 0)) break;
    g.dist *= Math.max(0.8, Math.min(1.25, f / fill));
  }
  return g;
}
// The part of the band that the points fill in its tight direction, for
// a pose (Infinity if a point is behind the eye). sym: twice the reach
// from the band's centre (where the aim is), not the box.
export function fillOf(pts, pose, view, sym = false) {
  const B = bandOf(view), cx = B.x0 + B.w / 2, cy = B.y0 + B.h / 2;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    const q = project(p, pose, view.W, view.H);
    if (!(q.z > 0)) return Infinity;
    x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
  }
  if (sym) return 2 * Math.max(Math.max(cx - x0, x1 - cx) / B.w, Math.max(cy - y0, y1 - cy) / B.h);
  return Math.max((x1 - x0) / B.w, (y1 - y0) / B.h);
}

// Eases the distance of the goal over a shot (critically damped, in log
// space). dt = 0 or a new shot: no ease.
export function followGoal(sh, g, dt) {
  const ld = Math.log(g.dist);
  if (!sh.sm || !(dt > 0)) { sh.sm = { ld, v: 0 }; return g; }
  // out (the subject grows) is faster than in, so the subject is not cut
  const s = sh.sm, h = Math.min(0.05, dt), w = ld > s.ld ? FOLLOW_W[1] : FOLLOW_W[0];
  s.v += (w * w * (ld - s.ld) - 2 * w * s.v) * h; s.ld += s.v * h;
  return Object.assign({}, g, { dist: Math.exp(s.ld) });
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

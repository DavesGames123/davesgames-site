// ============================================================================
//  DLA TERRAIN  ·  camera.js — orbit, fly and drone cameras (no DOM)
// ----------------------------------------------------------------------------
//  createCamera(opts) -> cam    one camera with three modes. input.js turns
//  the pointer, wheel, touch and keys into the calls below.
//
//    orbit   cam.orbit = { target [x,y,z], yaw, pitch, dist }. The eye is
//            target - forwardOf(yaw + PI, pitch) * dist.
//            orbitBegin(nx, ny, world) picks the ground under the pointer:
//              that point is the pivot of the turn and the grip of the pan.
//            orbitRotate(dx px, dy px)  a turn round the pivot (yaw round
//              the vertical, pitch round the view right axis). The turn is
//              an impulse that the update uses up with exponential damping.
//            orbitDrag(nx, ny, world)  the grip point stays under the
//              pointer (grab and drag); a fling glides on after the release.
//            orbitZoomAt(nx, ny, steps, world)  a dolly along the ray to the
//              ground under the pointer: each frame scales the eye and the
//              target about that point, so the point stays under the pointer
//              and the speed is in proportion to the distance (log scale).
//            orbitGestureBegin / orbitGesture(nx, ny, scale, twist, world)
//              two fingers: pinch zoom and twist round the ground under the
//              midpoint, and the midpoint drags that ground point.
//            orbitEnd()  the release: the pan fling, then the target moves
//              back onto the ground along the view axis (no change to view).
//            Limits: PITCH_MIN..PITCH_MAX, MIN_DIST to the zoom point,
//            MAX_K x world size, the eye CLEAR + 3 m over the ground.
//    fly     cam.fly = { pos, yaw, pitch, roll }: update(dt, { move [x, y, z]
//            -1..1, look [dx, dy] px, boost }). Speed in proportion to the
//            height over the ground x cam.flySpeedK (flySpeedStep, the
//            wheel) x 4 with boost. A velocity with exponential speed-up and
//            brake, a soft floor ahead of the camera that pushes it up
//            smoothly, the hard floor CLEAR, and a bank roll (cam.bank).
//            When world.trunkAt(x, z) -> { x, z, r } is given, the eye stays
//            0.4 m outside that trunk.
//    drone   cam.drone = dronePath(...), cam.droneS (m), cam.droneSpeed
//            (m/s). The speed eases in over DRONE_RAMP s and brakes before
//            the end. A user input calls setMode('fly'): the drone is held
//            and the fly velocity starts at the drone velocity.
//            resumeDrone(world) flies on from the path point nearest the eye.
//
//  TRANSITIONS  a mode change (setMode, or cam.mode set from outside) keeps
//  the last pose as an offset that a critically damped spring takes to 0,
//  so the view glides. flyTo uses springs on the orbit target and the log
//  of the distance (it rises a little on a long hop). matrices() puts a
//  spring on the FOV. update(dt >= 0.5) snaps: no glide (saver cuts).
//
//  cam.matrices(w, h, opts) -> { view, proj, viewProj, invViewProj, pos,
//            forward, right, up, fovY, aspect, near }   opts = { jitter [px],
//            (near: NEAR_LOW 0.1 m under NEAR_H 80 m over the ground, then a
//            blend to cam.near 0.5 m at 160 m)
//            shift [ndcX, ndcY] (move the image centre) }. It also keeps the
//            aspect and the shift for the screen rays of the calls above.
//  cam.pick(nx, ny, world) -> [x, y, z] | null   the ground under a point
//  dronePath(poly, world, opts) -> { pts, len, loop, at(s) -> { pos, look,
//            kappa, tangent }, nearest(p) -> s }  a centripetal Catmull-Rom
//            plan sampled every STEP m of plan length, a height profile
//            (max filter of the ground, then three box filters, + clearance)
//            that is over the ground at every sample, 3D arc length for an
//            even speed, a look point that is a mean of points ahead.
//  spring(x, v, goal, omega, dt) -> [x, v]   the exact critically damped step
//  rayGround(o, d, world, max), pickGround(invViewProj, nx, ny, world, max)
//  bandShift(band, H) -> NDC y shift that centres the subject in the band
//
//  grep -n targets: "export function createCamera", "export function dronePath",
//  "export function spring", "export function rayGround", "function updOrbit",
//  "function updFly", "function updDrone", "cam.orbitZoomAt", "cam.orbitDrag",
//  "cam.orbitGesture", "cam.resumeDrone", "function compose", "CLEAR"
// ============================================================================
import { lookAt, perspectiveRZ, mul, invert, project } from './gpu/mat.js';

export const CLEAR = 2.2;                       // m, the eye over the ground
export const PITCH_MIN = -1.53, PITCH_MAX = -0.03;
export const MIN_DIST = 12;                     // m, the closest zoom
export const MAX_K = 1.8;                       // max orbit dist / world size
export const ZOOM_STEP = 0.8;                   // dist factor per wheel step
export const DRONE_RAMP = 2.5;                  // s, the drone speed ease-in
export const NEAR_LOW = 0.1, NEAR_H = 80;       // m, the near plane low down
const ORBIT_K = 16, ZOOM_K = 11, GOAL_W = 3.2, BLEND_W = 3.4, FOV_W = 7;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const wrap = a => a - TAU * Math.floor((a + Math.PI) / TAU);
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = a => Math.hypot(a[0], a[1], a[2]);
const yawOf = f => Math.atan2(f[0], -f[2]);
const pitchOf = f => Math.asin(clamp(f[1] / (len3(f) || 1), -1, 1));

export function forwardOf(yaw, pitch) {
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

// the exact solution of x'' = -2 w x' - w^2 (x - goal) over dt: stable for
// any dt, no overshoot from rest
export function spring(x, v, goal, w, dt) {
  const e = Math.exp(-w * dt), d = x - goal, q = v + w * d;
  return [goal + (d + q * dt) * e, (v - w * q * dt) * e];
}

// right and up of a view with roll (the axes of gpu/mat.js lookAt)
export function basis(yaw, pitch, roll = 0) {
  const f = forwardOf(yaw, pitch);
  const r0 = [Math.cos(yaw), 0, Math.sin(yaw)];
  const u0 = [r0[1] * f[2] - r0[2] * f[1], r0[2] * f[0] - r0[0] * f[2], r0[0] * f[1] - r0[1] * f[0]];
  const c = Math.cos(roll), s = Math.sin(roll);
  return { f, r: r0.map((v, i) => v * c - u0[i] * s), u: u0.map((v, i) => v * c + r0[i] * s) };
}

// the world ray through NDC (nx, ny) of a pose; shift as in matrices()
export function screenRay(pose, nx, ny, fovY, aspect, shift = [0, 0]) {
  const { f, r, u } = basis(pose.yaw, pose.pitch, pose.roll || 0);
  const t = Math.tan(fovY / 2), a = (nx - shift[0]) * t * aspect, b = (ny - shift[1]) * t;
  const d = [f[0] + r[0] * a + u[0] * b, f[1] + r[1] * a + u[1] * b, f[2] + r[2] * a + u[2] * b];
  const l = len3(d);
  return { o: pose.pos.slice(), d: d.map(v => v / l) };
}

export function bandShift(band, H) {
  if (!band || !(H > 0)) return 0;
  const yc = band.t + (H - band.t - band.b) / 2;   // px from the top
  return 1 - 2 * yc / H;                            // NDC y of the band centre
}

function groundAt(world, x, z) {
  const h = world && world.heightAt ? world.heightAt(x, z) : 0;
  return Math.max(h, world && world.seaLevel !== undefined ? world.seaLevel : -Infinity);
}

// the first ground (or sea) point on a ray: a march with a step that grows
// with the distance, then a bisection
export function rayGround(o, d, world = {}, maxDist = 1e5) {
  const below = t => o[1] + d[1] * t <= groundAt(world, o[0] + d[0] * t, o[2] + d[2] * t);
  if (below(0)) return o.slice(0, 3);
  let t0 = 0, t = 1;
  while (t < maxDist) {
    if (below(t)) {
      for (let i = 0; i < 24; i++) { const m = (t0 + t) / 2; if (below(m)) t = m; else t0 = m; }
      return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    }
    t0 = t; t += Math.max(2, t * 0.02);
  }
  return null;
}

export function pickGround(inv, nx, ny, world = {}, maxDist = 1e5) {
  // reverse-Z: depth 1 is the near plane, 0.5 is at twice the near distance
  const a = project(inv, [nx, ny, 1, 1]), b = project(inv, [nx, ny, 0.5, 1]);
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = len3(d);
  if (!(l > 0) || !a.slice(0, 3).every(Number.isFinite)) return null;
  return rayGround(a, d.map(v => v / l), world, maxDist);
}

export function createCamera(opts = {}) {
  const cam = {
    mode: 'orbit', fovY: opts.fovY || 50 * Math.PI / 180, near: opts.near || 0.5,
    orbit: { target: [0, 0, 0], yaw: 0.6, pitch: -0.45, dist: 9000 },
    orbitGoal: null,
    fly: { pos: [0, 500, 0], yaw: 0, pitch: -0.15, roll: 0 },
    flySpeedK: 1, bank: true,
    drone: null, droneS: 0, droneSpeed: 60, droneKind: null,
    pos: [0, 500, 3000], forward: [0, 0, -1], up: [0, 1, 0], roll: 0,
  };
  // private state
  let mode0 = null, drone0 = null, pose = null, world0 = {};
  let clock = 0, ramp = 1, dtFov = 0, snapFov = true, fovS = cam.fovY, fovV = 0;
  const off = { p: [0, 0, 0], pv: [0, 0, 0], a: [0, 0, 0], av: [0, 0, 0], w: BLEND_W, d0: 0, L: 0 };
  let shownVel = [0, 0, 0];
  const imp = { yaw: 0, pitch: 0, zoom: 0 };
  let pivot = null, zoomAnchor = null, grip = null, active = false, rebase = false;
  let dragAcc = [0, 0], dragVel = [0, 0], dragAt = -1, fling = [0, 0];
  const vel = [0, 0, 0];
  let yawRate = 0, droneVel = [0, 0, 0], held = null, droneYP = null;
  const view = { aspect: 16 / 9, shift: [0, 0] };

  const orbitPose = o => {
    const f = forwardOf(o.yaw + Math.PI, o.pitch);
    return { pos: [o.target[0] - f[0] * o.dist, o.target[1] - f[1] * o.dist, o.target[2] - f[2] * o.dist], yaw: o.yaw + Math.PI, pitch: o.pitch, roll: 0 };
  };
  const shown = () => (pose && pose.f === cam.forward
    ? { pos: cam.pos.slice(), yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll }
    : { pos: cam.pos.slice(), yaw: yawOf(cam.forward), pitch: pitchOf(cam.forward), roll: cam.roll || 0 });
  const maxDist = w => Math.max(3000, (w.size || 8000) * MAX_K);
  // the orbit from an eye and a forward (the target on the ground ahead)
  function orbitFrom(eye, f, w, d0) {
    const o = cam.orbit;
    o.yaw = yawOf(f) - Math.PI;
    o.pitch = clamp(pitchOf(f), PITCH_MIN, PITCH_MAX);
    const g = forwardOf(o.yaw + Math.PI, o.pitch);
    const hit = rayGround(eye, g, w, maxDist(w) * 1.5);
    const d = hit ? Math.max(MIN_DIST, len3(sub(hit, eye))) : clamp(d0 || o.dist, 200, 1e5);
    o.dist = d;
    o.target = [eye[0] + g[0] * d, eye[1] + g[1] * d, eye[2] + g[2] * d];
  }
  // a gesture starts from the pose on screen: drop the glide and the flight
  function bake(w) {
    const moving = len3(off.p) > 0.01 || Math.abs(off.a[0]) + Math.abs(off.a[1]) > 1e-4;
    if (moving && pose) orbitFrom(cam.pos, cam.forward, w, cam.orbit.dist);
    off.p = [0, 0, 0]; off.pv = [0, 0, 0]; off.a = [0, 0, 0]; off.av = [0, 0, 0];
    cam.orbitGoal = null;
  }

  // ── orbit operations (each keeps the view a rigid move of the camera)
  function yawAbout(o, P, d) {
    const c = Math.cos(d), s = Math.sin(d);
    const x = o.target[0] - P[0], z = o.target[2] - P[2];
    o.target[0] = P[0] + x * c - z * s; o.target[2] = P[2] + x * s + z * c;
    o.yaw += d;
  }
  function pitchAbout(o, P, d) {
    const p1 = clamp(o.pitch + d, PITCH_MIN, PITCH_MAX);
    d = p1 - o.pitch;
    if (!d) return;
    // Rodrigues round the view right axis through P
    const Y = o.yaw + Math.PI, k = [Math.cos(Y), 0, Math.sin(Y)];
    const v = sub(o.target, P), c = Math.cos(d), s = Math.sin(d);
    const kv = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
    const kd = k[0] * v[0] + k[2] * v[2];
    o.target = [0, 1, 2].map(i => P[i] + v[i] * c + kv[i] * s + k[i] * kd * (1 - c));
    o.pitch = p1;
  }
  function zoomAbout(o, A, s, w) {
    const e = orbitPose(o).pos, ea = len3(sub(e, A));
    if (ea > 0) s = Math.max(s, Math.min(1, MIN_DIST / ea));
    s = Math.min(s, Math.max(1, maxDist(w) / o.dist));
    for (let i = 0; i < 3; i++) o.target[i] = A[i] + (o.target[i] - A[i]) * s;
    o.dist *= s;
  }
  // move the camera so the world point A lies under NDC (nx, ny)
  function grabTo(o, A, nx, ny, w) {
    const ray = screenRay(orbitPose(o), nx, ny, fovS, view.aspect, view.shift);
    if (ray.d[1] > -0.015) return [0, 0];          // over the horizon
    const t = Math.min((A[1] - ray.o[1]) / ray.d[1], maxDist(w) * 2);
    if (!(t > 0)) return [0, 0];
    const dx = A[0] - (ray.o[0] + ray.d[0] * t), dz = A[2] - (ray.o[2] + ray.d[2] * t);
    o.target[0] += dx; o.target[2] += dz;
    return [dx, dz];
  }

  cam.pick = (nx, ny, w = world0) => {
    const p = mode0 === 'orbit' && cam.mode === 'orbit' && !(len3(off.p) > 0.01) ? orbitPose(cam.orbit) : shown();
    const ray = screenRay(p, nx, ny, fovS, view.aspect, view.shift);
    return rayGround(ray.o, ray.d, w, maxDist(w) * 2);
  };
  cam.orbitBegin = (nx, ny, w = world0) => {
    if (cam.mode !== 'orbit') return null;
    bake(w);
    fling = [0, 0]; dragVel = [0, 0]; dragAcc = [0, 0];
    active = true;
    const p = cam.pick(nx, ny, w);
    pivot = p || cam.orbit.target.slice();
    grip = pivot.slice();
    return p;
  };
  cam.orbitRotate = (dx, dy) => {
    if (cam.mode !== 'orbit') return;
    imp.yaw -= dx * 0.005; imp.pitch -= dy * 0.004;
  };
  cam.orbitDrag = (nx, ny, w = world0) => {
    if (cam.mode !== 'orbit' || !grip) return;
    const d = grabTo(cam.orbit, grip, nx, ny, w);
    dragAcc[0] += d[0]; dragAcc[1] += d[1]; dragAt = clock;
  };
  cam.orbitGestureBegin = (nx, ny, w = world0) => {
    if (cam.mode !== 'orbit') return null;
    bake(w);
    active = true; fling = [0, 0]; dragVel = [0, 0]; dragAcc = [0, 0];
    imp.yaw = imp.pitch = imp.zoom = 0;
    const p = cam.pick(nx, ny, w);
    if (p) grip = p;
    else {
      const ray = screenRay(orbitPose(cam.orbit), nx, ny, fovS, view.aspect, view.shift);
      grip = ray.o.map((v, i) => v + ray.d[i] * cam.orbit.dist);
    }
    return p;
  };
  // scale = old finger distance / new finger distance (the eye distance to
  // the grip point is multiplied by it: a spread is < 1, a zoom in);
  // twist = the change of the finger angle on screen, counterclockwise + (y up)
  cam.orbitGesture = (nx, ny, scale, twist, w = world0) => {
    if (cam.mode !== 'orbit' || !grip) return;
    const o = cam.orbit;
    if (Number.isFinite(scale) && scale > 0 && scale !== 1) zoomAbout(o, grip, scale, w);
    if (twist) yawAbout(o, grip, twist);
    const d = grabTo(o, grip, nx, ny, w);
    dragAcc[0] += d[0]; dragAcc[1] += d[1]; dragAt = clock;
  };
  cam.orbitEnd = () => {
    if (active && clock - dragAt < 0.09) fling = dragVel.slice();
    active = false; rebase = true; grip = null;
  };
  cam.orbitZoomAt = (nx, ny, steps, w = world0) => {
    if (cam.mode !== 'orbit' || !steps) return;
    if (!active) bake(w);
    let p = cam.pick(nx, ny, w);
    if (!p) {
      const ray = screenRay(orbitPose(cam.orbit), nx, ny, fovS, view.aspect, view.shift);
      p = ray.o.map((v, i) => v + ray.d[i] * cam.orbit.dist);
    }
    zoomAnchor = p;
    imp.zoom += steps * Math.log(ZOOM_STEP);
    fling = [0, 0];
  };
  cam.flySpeedStep = steps => {
    cam.flySpeedK = clamp(cam.flySpeedK * Math.pow(1.2, steps), 0.05, 20);
    return cam.flySpeedK;
  };

  cam.setMode = (m, world) => {
    world = world || world0;
    if (m === cam.mode) return;
    if (cam.mode === 'drone' && cam.drone) held = { drone: cam.drone, s: cam.droneS, kind: cam.droneKind, speed: cam.droneSpeed, sig: sig(world) };
    if (m === 'fly') {
      cam.fly = { pos: cam.pos.slice(), yaw: yawOf(cam.forward), pitch: clamp(pitchOf(cam.forward), -1.5, 1.5), roll: cam.roll || 0 };
      const v = cam.mode === 'drone' ? droneVel : [0, 0, 0];
      for (let i = 0; i < 3; i++) vel[i] = v[i];
    } else if (m === 'orbit') {
      orbitFrom(cam.pos, cam.forward, world, cam.orbit.dist);
      imp.yaw = imp.pitch = imp.zoom = 0;
    }
    cam.mode = m;
  };
  // a fingerprint of the terrain: a held drone is for this terrain only
  const sig = w => [[0.1, 0.2], [-0.3, 0.1], [0.25, -0.35], [-0.15, -0.2]].map(([a, b]) => groundAt(w, a * (w.size || 8000), b * (w.size || 8000)));
  cam.canResume = (world = world0) => !!held && held.sig.every((v, i) => Math.abs(v - sig(world)[i]) < 1);
  cam.resumeDrone = (world = world0) => {
    if (!cam.canResume(world)) { held = null; return false; }
    cam.drone = held.drone; cam.droneKind = held.kind; cam.droneSpeed = held.speed;
    cam.droneS = held.drone.nearest ? held.drone.nearest(cam.pos) : held.s;
    held = null; cam.mode = 'drone';
    return true;
  };

  cam.frameWorld = (world, k = 1) => {
    const s = world.size || 8000;
    cam.orbit.target = [0, (world.midH ?? 0), 0];
    cam.orbit.dist = s * 0.95 * k;
    cam.orbit.pitch = -0.52;
    cam.orbitGoal = null;
  };
  cam.flyTo = (x, z, world, dist) => {
    world = world || world0;
    const y = groundAt(world, x, z);
    if (cam.mode !== 'orbit') cam.setMode('orbit', world);
    bake(world);
    imp.yaw = imp.pitch = imp.zoom = 0; fling = [0, 0];
    cam.orbitGoal = { target: [x, y, z], dist: dist ?? clamp(cam.orbit.dist * 0.6, 400, (world.size || 8000) * 0.4), v: [0, 0, 0], dv: 0 };
  };

  // ── per mode: the pose this frame
  function updOrbit(dt, input, w, snap) {
    const o = cam.orbit, size = w.size || 8000;
    const look = input.look || [0, 0], move = input.move || [0, 0, 0];
    if (look[0] || look[1]) { imp.yaw -= look[0] * 0.005; imp.pitch -= look[1] * 0.004; }
    if (input.zoom) { zoomAnchor = null; imp.zoom += input.zoom * Math.log(ZOOM_STEP); }
    const P = orbitPose(o), Y = P.yaw;
    const fx = Math.sin(Y), fz = -Math.cos(Y), rx = -fz, rz = fx;
    if (input.pan && (input.pan[0] || input.pan[1])) {
      const k = o.dist * 0.0012;
      o.target[0] += (-input.pan[0] * rx + input.pan[1] * fx) * k;
      o.target[2] += (-input.pan[0] * rz + input.pan[1] * fz) * k;
      cam.orbitGoal = null;
    }
    if (move[0] || move[2]) {
      const k = o.dist * 0.8 * dt;
      o.target[0] += (move[2] * fx + move[0] * rx) * k;
      o.target[2] += (move[2] * fz + move[0] * rz) * k;
      cam.orbitGoal = null; rebase = true;
    }
    if (move[1]) { zoomAbout(o, o.target, Math.exp(-move[1] * dt), w); rebase = true; }
    // the impulses: a part of each per frame (exponential damping)
    const kr = snap ? 1 : 1 - Math.exp(-ORBIT_K * dt), kz = snap ? 1 : 1 - Math.exp(-ZOOM_K * dt);
    const pv = pivot || o.target.slice();
    if (imp.yaw) { const d = Math.abs(imp.yaw) < 1e-5 ? imp.yaw : imp.yaw * kr; imp.yaw -= d; yawAbout(o, pv, d); }
    if (imp.pitch) { const d = Math.abs(imp.pitch) < 1e-5 ? imp.pitch : imp.pitch * kr; imp.pitch -= d; pitchAbout(o, pv, d); }
    if (imp.zoom) {
      const d = Math.abs(imp.zoom) < 1e-4 ? imp.zoom : imp.zoom * kz; imp.zoom -= d;
      zoomAbout(o, zoomAnchor || o.target.slice(), Math.exp(d), w);
      if (!imp.zoom) rebase = true;
    }
    // the drag speed (for the fling), the fling
    if (dt > 0) {
      dragVel = [damp(dragVel[0], dragAcc[0] / dt, 25, dt), damp(dragVel[1], dragAcc[1] / dt, 25, dt)];
      dragAcc = [0, 0];
    }
    if (!active && (fling[0] || fling[1])) {
      const vmax = size * 0.6;
      const l = Math.hypot(fling[0], fling[1]);
      if (l > vmax) fling = fling.map(v => v * vmax / l);
      o.target[0] += fling[0] * dt; o.target[2] += fling[1] * dt;
      const k = Math.exp(-3.5 * dt);
      fling = fling.map(v => v * k);
      if (Math.hypot(fling[0], fling[1]) < 0.5) { fling = [0, 0]; rebase = true; }
    }
    // flyTo: springs on the target and on log(dist); a long hop rises
    const g = cam.orbitGoal;
    if (g) {
      if (!g.v) { g.v = [0, 0, 0]; g.dv = 0; }
      if (snap) { o.target = g.target.slice(); o.dist = g.dist; cam.orbitGoal = null; }
      else {
        for (let i = 0; i < 3; i++) [o.target[i], g.v[i]] = spring(o.target[i], g.v[i], g.target[i], GOAL_W, dt);
        const hop = Math.hypot(o.target[0] - g.target[0], o.target[2] - g.target[2]);
        let ld = Math.log(Math.max(1, o.dist));
        [ld, g.dv] = spring(ld, g.dv, Math.log(Math.max(g.dist, hop * 0.5)), GOAL_W, dt);
        o.dist = Math.exp(ld);
        if (hop < 0.5 && Math.abs(o.dist - g.dist) < 0.5 && Math.hypot(...g.v) < 1) cam.orbitGoal = null;
      }
    }
    const lim = size * 0.75;
    o.target[0] = clamp(o.target[0], -lim, lim); o.target[2] = clamp(o.target[2], -lim, lim);
    const idle = !active && !imp.yaw && !imp.pitch && !imp.zoom && !fling[0] && !fling[1];
    // the target onto the ground along the view axis: the view stays
    if (rebase && idle && !cam.orbitGoal) { rebase = false; pivot = null; zoomAnchor = null; const e = orbitPose(o).pos; orbitFrom(e, forwardOf(o.yaw + Math.PI, o.pitch), w, o.dist); }
    // a terrain that changes under a still target (the forming view)
    if (idle && !cam.orbitGoal) { const gy = groundAt(w, o.target[0], o.target[2]); if (Number.isFinite(gy)) o.target[1] = snap ? gy : damp(o.target[1], gy, 2, dt); }
    // the eye over the ground: lift it and aim again at the target
    let p = orbitPose(o);
    const minY = groundAt(w, p.pos[0], p.pos[2]) + CLEAR + 3;
    if (p.pos[1] < minY) {
      const e = [p.pos[0], minY, p.pos[2]], v = sub(o.target, e), d = len3(v) || 1;
      let pitch = Math.asin(clamp(v[1] / d, -1, 1));
      o.yaw = Math.atan2(v[0], -v[2]) - Math.PI;
      if (pitch > PITCH_MAX || pitch < PITCH_MIN) {
        pitch = clamp(pitch, PITCH_MIN, PITCH_MAX);
        const f = forwardOf(o.yaw + Math.PI, pitch);
        o.target = e.map((x, i) => x + f[i] * d);
      }
      o.pitch = pitch; o.dist = d;
      p = orbitPose(o);
    }
    return p;
  }

  function updFly(dt, input, w, snap) {
    const F = cam.fly, size = w.size || 8000;
    const look = input.look || [0, 0], move = input.move || [0, 0, 0];
    const y0 = F.yaw;
    F.yaw += look[0] * 0.0028;
    F.pitch = clamp(F.pitch - look[1] * 0.0028, -1.5, 1.5);
    if (snap) vel.fill(0);
    const agl = Math.max(1, F.pos[1] - groundAt(w, F.pos[0], F.pos[2]));
    const speed = clamp(agl * 1.1, 6, 2500) * cam.flySpeedK * (input.boost ? 4 : 1);
    const f = forwardOf(F.yaw, F.pitch), r = [Math.cos(F.yaw), 0, Math.sin(F.yaw)];
    const want = [0, 1, 2].map(i => f[i] * move[2] + r[i] * move[0] + (i === 1 ? move[1] : 0));
    const wl = len3(want);
    if (wl > 1) for (let i = 0; i < 3; i++) want[i] /= wl;
    const speeding = wl > 0.01 && len3(vel) < speed * Math.min(1, wl);
    const k = speeding ? 3.2 : 2.2;
    for (let i = 0; i < 3; i++) vel[i] = damp(vel[i], want[i] * speed, k, dt);
    const step = snap ? 0 : dt;
    for (let i = 0; i < 3; i++) F.pos[i] += vel[i] * step;
    const lim = size * 0.8;
    F.pos[0] = clamp(F.pos[0], -lim, lim); F.pos[2] = clamp(F.pos[2], -lim, lim);
    F.pos[1] = Math.min(F.pos[1], size * 2);
    // a soft floor (the ground here and 0.8 s ahead) pushes up smoothly
    const hs = Math.hypot(vel[0], vel[2]);
    const ga = Math.max(groundAt(w, F.pos[0], F.pos[2]), groundAt(w, F.pos[0] + vel[0] * 0.8, F.pos[2] + vel[2] * 0.8));
    const soft = CLEAR + clamp(hs * 0.06, 1.5, 40);
    if (F.pos[1] < ga + soft) {
      F.pos[1] = damp(F.pos[1], ga + soft, 7, dt);
      if (vel[1] < 0) vel[1] *= Math.exp(-10 * dt);
    }
    // a trunk (world.trunkAt(x, z) -> { x, z, r } | null, VEG): stay 0.4 m out
    const tr = w.trunkAt ? w.trunkAt(F.pos[0], F.pos[2]) : null;
    if (tr && Number.isFinite(tr.r)) {
      const dx = F.pos[0] - tr.x, dz = F.pos[2] - tr.z, d = Math.hypot(dx, dz), m = tr.r + 0.4;
      if (d < m) {
        const ux = d > 1e-6 ? dx / d : 1, uz = d > 1e-6 ? dz / d : 0;
        F.pos[0] = tr.x + ux * m; F.pos[2] = tr.z + uz * m;
        const vn = vel[0] * ux + vel[2] * uz;
        if (vn < 0) { vel[0] -= vn * ux; vel[2] -= vn * uz; }
      }
    }
    const gh = groundAt(w, F.pos[0], F.pos[2]);
    if (F.pos[1] < gh + CLEAR) { F.pos[1] = gh + CLEAR; if (vel[1] < 0) vel[1] = 0; }
    // bank: into the turn and the side slip
    yawRate = damp(yawRate, dt > 0 ? wrap(F.yaw - y0) / dt : 0, 6, dt);
    const lat = (vel[0] * r[0] + vel[2] * r[2]) / Math.max(speed, 1);
    const rollWant = cam.bank ? clamp(yawRate * 0.08 + lat * 0.12, -0.25, 0.25) : 0;
    F.roll = snap ? rollWant : damp(F.roll || 0, rollWant, 4, dt);
    return { pos: F.pos.slice(), yaw: F.yaw, pitch: F.pitch, roll: F.roll };
  }

  function updDrone(dt, input, w, snap) {
    const D = cam.drone;
    if (!D) return shown();
    const len = D.len;
    ramp = snap ? 1 : Math.min(1, ramp + dt / DRONE_RAMP);
    const s0 = cam.droneS;
    let s1 = s0 + cam.droneSpeed * smooth(ramp) * dt;
    if (D.loop) s1 = ((s1 % len) + len) % len;
    else {
      // the brake: v = speed sqrt(rem / B), a constant deceleration, as the
      // exact step of rem, so the drone stops at the end with no jerk
      const B = Math.max(120, cam.droneSpeed * 3), c = cam.droneSpeed / Math.sqrt(B);
      const q = Math.max(0, Math.sqrt(Math.max(0, len - s0)) - c * dt / 2);
      s1 = Math.min(s1, len - q * q, len);
    }
    cam.droneS = s1;
    const v = D.loop ? cam.droneSpeed * smooth(ramp) : (dt > 0 ? (s1 - s0) / dt : 0);
    const a = D.at(cam.droneS);
    const pos = a.pos.slice();
    const gmin = groundAt(w, pos[0], pos[2]) + CLEAR + 8;
    if (pos[1] < gmin) pos[1] = gmin;
    const d = sub(a.look, pos);
    const wy = yawOf(d), wp = pitchOf(d);
    if (snap || !droneYP) droneYP = [wy, wp, 0];
    else {
      droneYP[0] += wrap(wy - droneYP[0]) * (1 - Math.exp(-4 * dt));
      droneYP[1] = damp(droneYP[1], wp, 4, dt);
    }
    const bank = clamp(Math.atan(v * v * (a.kappa || 0) / 9.81) * 0.35, -0.2, 0.2);
    droneYP[2] = snap ? bank : damp(droneYP[2], bank, 3, dt);
    const t = a.tangent || [0, 0, 0];
    droneVel = t.map(x => x * v);
    return { pos, yaw: droneYP[0], pitch: droneYP[1], roll: droneYP[2] };
  }

  // the pose on screen: the mode pose plus the glide offset
  function compose(p, dt, snap, w) {
    if (snap) { off.p = [0, 0, 0]; off.pv = [0, 0, 0]; off.a = [0, 0, 0]; off.av = [0, 0, 0]; }
    else {
      for (let i = 0; i < 3; i++) {
        [off.p[i], off.pv[i]] = spring(off.p[i], off.pv[i], 0, off.w, dt);
        [off.a[i], off.av[i]] = spring(off.a[i], off.av[i], 0, off.w, dt);
      }
    }
    // the arc: a lift of L x 4 r (1 - r), r = the part of the glide to go
    const r = off.d0 > 1 ? Math.min(1, Math.hypot(off.p[0], off.p[2]) / off.d0) : 0;
    const lift = off.L * 4 * r * (1 - r);
    const pos = [p.pos[0] + off.p[0], p.pos[1] + off.p[1] + lift, p.pos[2] + off.p[2]];
    const g = groundAt(w, pos[0], pos[2]) + CLEAR;
    if (pos[1] < g) pos[1] = g;
    const yaw = p.yaw + off.a[0], pitch = clamp(p.pitch + off.a[1], -1.55, 1.55), roll = p.roll + off.a[2];
    cam.pos = pos; cam.forward = forwardOf(yaw, pitch); cam.roll = roll;
    pose = { pos, yaw, pitch, roll, f: cam.forward };
  }

  cam.update = (dt, input = {}, world = {}) => {
    dt = Math.max(0, +dt || 0);
    const snap = dt >= 0.5;
    world0 = world; clock += dt; dtFov += dt; if (snap) snapFov = true;
    const before = pose;
    const changed = mode0 !== null && (cam.mode !== mode0 || (cam.mode === 'drone' && cam.drone !== drone0));
    if (cam.mode === 'drone' && (cam.drone !== drone0 || mode0 !== 'drone')) { ramp = snap ? 1 : 0; droneYP = null; }
    if (cam.mode !== 'orbit') { active = false; grip = null; imp.yaw = imp.pitch = imp.zoom = 0; fling = [0, 0]; }
    let p;
    if (cam.mode === 'fly') p = updFly(dt, input, world, snap);
    else if (cam.mode === 'drone') p = updDrone(dt, input, world, snap);
    else p = updOrbit(dt, input, world, snap);
    if (changed && before && !snap) {
      // keep the old pose (moved on at its own speed) as an offset that
      // glides to zero; the offset speed keeps the eye speed continuous
      const mv = cam.mode === 'fly' ? vel : cam.mode === 'drone' ? droneVel : [0, 0, 0];
      off.p = [0, 1, 2].map(i => before.pos[i] + shownVel[i] * dt - p.pos[i]);
      off.pv = [0, 1, 2].map(i => shownVel[i] - mv[i]);
      off.a = [wrap(before.yaw - p.yaw), before.pitch - p.pitch, wrap(before.roll - p.roll)]; off.av = [0, 0, 0];
      // a long glide is slower (about 1.5 s for 300 m, 3.5 s for 10 km)
      off.w = BLEND_W / (1 + Math.log10(1 + len3(off.p) / 500));
      // the arc over the ground between the two poses (compose: lift)
      off.d0 = Math.hypot(off.p[0], off.p[2]); off.L = 0;
      if (off.d0 > 1) {
        let L = 0.1 * off.d0;
        for (let k = 1; k < 16; k++) {
          const u = k / 16, x = before.pos[0] + (p.pos[0] - before.pos[0]) * u, z = before.pos[2] + (p.pos[2] - before.pos[2]) * u;
          const y = before.pos[1] + (p.pos[1] - before.pos[1]) * u;
          L = Math.max(L, (groundAt(world, x, z) + 60 - y) / Math.max(0.25, 4 * u * (1 - u)));
        }
        off.L = Math.min(L, 0.6 * off.d0 + 500);
      }
    }
    mode0 = cam.mode; drone0 = cam.drone;
    compose(p, dt, snap, world);
    if (before && dt > 1e-4 && !snap) shownVel = [0, 1, 2].map(i => (cam.pos[i] - before.pos[i]) / dt);
    else if (snap) shownVel = [0, 0, 0];
    return cam;
  };

  cam.matrices = (w, h, o = {}) => {
    const aspect = w / Math.max(1, h);
    if (snapFov || !Number.isFinite(fovS)) { fovS = cam.fovY; fovV = 0; snapFov = false; }
    else if (dtFov > 0) [fovS, fovV] = spring(fovS, fovV, cam.fovY, FOV_W, dtFov);
    dtFov = 0;
    const j = o.jitter || [0, 0], sh = o.shift || [0, 0];
    view.aspect = aspect; view.shift = [sh[0], sh[1]];
    // the near plane: NEAR_LOW m when the eye is under NEAR_H m over the
    // ground (a leaf at the eye is not cut), blended to cam.near up to
    // 2 x NEAR_H. Reverse-Z depth32float keeps the precision.
    const agl = cam.pos[1] - groundAt(world0, cam.pos[0], cam.pos[2]);
    const near = NEAR_LOW + (Math.max(NEAR_LOW, cam.near) - NEAR_LOW) * smooth(Number.isFinite(agl) ? (agl - NEAR_H) / NEAR_H : 1);
    const proj = perspectiveRZ(fovS, aspect, near);
    // m[8], m[9]: x and y of clip get + c * z_view, w = -z_view -> ndc - c
    proj[8] = -(2 * j[0] / w + sh[0]);
    proj[9] = -(2 * j[1] / h + sh[1]);
    // the up axis from the pose yaw (well defined when the view looks
    // straight down); screenRay uses the same basis
    const same = pose && pose.f === cam.forward;
    const yaw = same ? pose.yaw : yawOf(cam.forward), pitch = same ? pose.pitch : pitchOf(cam.forward);
    const target = [cam.pos[0] + cam.forward[0], cam.pos[1] + cam.forward[1], cam.pos[2] + cam.forward[2]];
    const up = basis(yaw, pitch, cam.roll || 0).u;
    const v = lookAt(cam.pos, target, up);
    const viewProj = mul(proj, v);
    const projNJ = perspectiveRZ(fovS, aspect, near);
    projNJ[8] = -sh[0]; projNJ[9] = -sh[1];
    const right = [v[0], v[4], v[8]], upv = [v[1], v[5], v[9]];
    cam.up = upv;
    return {
      view: v, proj, viewProj, invViewProj: invert(viewProj), viewProjNoJitter: mul(projNJ, v),
      pos: cam.pos.slice(), forward: cam.forward.slice(), right, up: upv, fovY: fovS, aspect, near,
    };
  };
  return cam;
}

// ── drone paths ─────────────────────────────────────────────────────────
// poly: Float32Array xz pairs. opts = { spacing m (the control points),
// clearance m, window m (the height filter), lookAhead m, lookDown m,
// reverse, loop, side m / sideK (the ground across the path counts too),
// pitchMin, pitchMax }
export const STEP = 4;   // m of plan length between the path samples
export function dronePath(poly, world, opts = {}) {
  const spacing = opts.spacing || 80, clear = opts.clearance ?? 90, win = opts.window || 260;
  const ahead = opts.lookAhead || 420, down = opts.lookDown ?? 60, loop = !!opts.loop;
  let xy = [];
  for (let i = 0; i + 1 < poly.length; i += 2) xy.push([poly[i], poly[i + 1]]);
  if (opts.reverse) xy.reverse();
  xy = xy.filter((p, i) => i === 0 || Math.hypot(p[0] - xy[i - 1][0], p[1] - xy[i - 1][1]) > 1e-3);
  if (xy.length < 2) xy = [[0, 0], [100, 0]];
  // the control points: a fixed spacing, then a light 1-2-1 smoothing
  const C = [xy[0]];
  let acc = 0;
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1], b = xy[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = spacing - acc;
    while (s <= d) { const t = s / d; C.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); s += spacing; }
    acc = (acc + d) % spacing;
  }
  const last = xy[xy.length - 1], cl = C[C.length - 1];
  if (Math.hypot(last[0] - cl[0], last[1] - cl[1]) > spacing * 0.3) C.push(last.slice());
  if (C.length < 2) C.push(last.slice());
  for (let p = 0; p < 3; p++) for (let i = 1; i < C.length - 1; i++) {
    C[i] = [(C[i - 1][0] + 2 * C[i][0] + C[i + 1][0]) / 4, (C[i - 1][1] + 2 * C[i][1] + C[i + 1][1]) / 4];
  }
  // centripetal Catmull-Rom (Barry-Goldman, alpha 0.5) through C, dense
  const n = C.length;
  const ctrl = i => {
    if (loop) return C[((i % n) + n) % n];
    if (i < 0) return [2 * C[0][0] - C[1][0], 2 * C[0][1] - C[1][1]];
    if (i >= n) return [2 * C[n - 1][0] - C[n - 2][0], 2 * C[n - 1][1] - C[n - 2][1]];
    return C[i];
  };
  const lerp2 = (a, b, ta, tb, t) => { const k = tb - ta > 1e-9 ? (t - ta) / (tb - ta) : 0; return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; };
  const crSeg = (p0, p1, p2, p3, u) => {
    const dt = (a, b) => Math.max(1e-3, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t0 = 0, t1 = dt(p0, p1), t2 = t1 + dt(p1, p2), t3 = t2 + dt(p2, p3);
    const t = t1 + (t2 - t1) * u;
    const A1 = lerp2(p0, p1, t0, t1, t), A2 = lerp2(p1, p2, t1, t2, t), A3 = lerp2(p2, p3, t2, t3, t);
    const B1 = lerp2(A1, A2, t0, t2, t), B2 = lerp2(A2, A3, t1, t3, t);
    return lerp2(B1, B2, t1, t2, t);
  };
  const dense = [C[0]];
  const segs = loop ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = ctrl(i - 1), p1 = ctrl(i), p2 = ctrl(i + 1), p3 = ctrl(i + 2);
    const m = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 1.5));
    for (let q = 1; q <= m; q++) dense.push(crSeg(p0, p1, p2, p3, q / m));
  }
  // even plan spacing STEP
  const X = [dense[0][0]], Z = [dense[0][1]];
  {
    let need = STEP, prev = dense[0];
    for (let i = 1; i < dense.length; i++) {
      const b = dense[i];
      let d = Math.hypot(b[0] - prev[0], b[1] - prev[1]);
      while (d >= need) {
        const t = need / d;
        prev = [prev[0] + (b[0] - prev[0]) * t, prev[1] + (b[1] - prev[1]) * t];
        X.push(prev[0]); Z.push(prev[1]);
        d -= need; need = STEP;
      }
      need -= d; prev = b;
    }
    const e = dense[dense.length - 1];
    if (Math.hypot(e[0] - X[X.length - 1], e[1] - Z[Z.length - 1]) > STEP * 0.25) { X.push(e[0]); Z.push(e[1]); }
    if (X.length < 2) { X.push(X[0] + STEP); Z.push(Z[0]); }
  }
  const N = X.length;
  const hAt = (x, z) => groundAt(world, x, z);
  const side = opts.side || 0, sideK = opts.sideK ?? 0.7;
  const G = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const c = hAt(X[i], Z[i]);
    if (!side) { G[i] = c; continue; }
    const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
    let tx = X[b] - X[a], tz = Z[b] - Z[a];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    let m = -Infinity;
    for (const s of [-1, -0.5, 0.5, 1]) m = Math.max(m, hAt(X[i] - tz * side * s, Z[i] + tx * side * s));
    G[i] = Math.max(c, c + (m - c) * sideK);
  }
  // the height: a max filter of radius R, then three box filters of radius
  // R/3. Each output sample is a mean of max-filter samples whose windows
  // hold that sample, so it is >= the ground there: no dip at any sample.
  const R = Math.max(1, Math.round(win / STEP)), r = Math.max(1, Math.floor(R / 3));
  const at = (arr, i) => (loop ? arr[((i % N) + N) % N] : arr[clamp(i, 0, N - 1)]);
  let H = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let m = -Infinity;
    const lo = loop ? i - R : Math.max(0, i - R), hi = loop ? i + R : Math.min(N - 1, i + R);
    for (let j = lo; j <= hi; j++) { const v = at(G, j); if (v > m) m = v; }
    H[i] = m;
  }
  const box = (src, rad) => {
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0, c = 0;
      const lo = loop ? i - rad : Math.max(0, i - rad), hi = loop ? i + rad : Math.min(N - 1, i + rad);
      for (let j = lo; j <= hi; j++) { s += at(src, j); c++; }
      out[i] = s / c;
    }
    return out;
  };
  for (let p = 0; p < 3; p++) H = box(H, r);
  const Y = Array.from(H, v => v + clear);
  // 3D arc length: an even speed in metres per second
  const S = new Float64Array(N);
  for (let i = 1; i < N; i++) S[i] = S[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1], Z[i] - Z[i - 1]);
  const len = Math.max(1e-3, S[N - 1] + (loop ? Math.hypot(X[0] - X[N - 1], Y[0] - Y[N - 1], Z[0] - Z[N - 1]) : 0));
  // the plan heading rate (1/m), smoothed: the bank
  const yawS = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
    yawS[i] = Math.atan2(X[b] - X[a], -(Z[b] - Z[a]));
  }
  let K = new Float64Array(N);
  for (let i = 1; i < N - 1; i++) K[i] = wrap(yawS[i + 1] - yawS[i - 1]) / (2 * STEP);
  const kr = Math.max(1, Math.round(60 / STEP));
  K = box(box(K, kr), kr);
  const find = s => {
    let lo = 0, hi = N - 1;
    if (s >= S[N - 1]) return [N - 1, 0];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    const u = S[hi] > S[lo] ? (s - S[lo]) / (S[hi] - S[lo]) : 0;
    return [lo, u];
  };
  const posAt = s => {
    if (loop) {
      s = ((s % len) + len) % len;
      if (s > S[N - 1]) { const u = (s - S[N - 1]) / (len - S[N - 1]); return [X[N - 1] + (X[0] - X[N - 1]) * u, Y[N - 1] + (Y[0] - Y[N - 1]) * u, Z[N - 1] + (Z[0] - Z[N - 1]) * u]; }
    } else s = clamp(s, 0, len);
    const [i, u] = find(s), j = Math.min(N - 1, i + 1);
    return [X[i] + (X[j] - X[i]) * u, Y[i] + (Y[j] - Y[i]) * u, Z[i] + (Z[j] - Z[i]) * u];
  };
  const kappaAt = s => { const [i, u] = find(loop ? ((s % len) + len) % len : clamp(s, 0, len)); return K[i] + (K[Math.min(N - 1, i + 1)] - K[i]) * u; };
  // the end tangent (flat): the look ahead past the end goes on along it
  const endT = (() => { const a = posAt(len - 30), b = posAt(len); const l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1; return [(b[0] - a[0]) / l, 0, (b[2] - a[2]) / l]; })();
  const ext = s => {
    if (loop || s <= len) return posAt(s);
    const e = posAt(len);
    return [e[0] + endT[0] * (s - len), e[1], e[2] + endT[2] * (s - len)];
  };
  const tangentAt = s => {
    const a = ext(s - 6), b = ext(s + 6), l = len3(sub(b, a)) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
  };
  // composition: the drone always looks a little down (land in the lower
  // two thirds, the horizon high), never up at an empty sky
  const pMin = opts.pitchMin ?? -0.5, pMax = opts.pitchMax ?? -0.13;
  const P = [];
  for (let i = 0; i < N; i += Math.max(1, Math.round(spacing / STEP))) P.push([X[i], Y[i], Z[i]]);
  return {
    pts: P, len, loop,
    at(s) {
      const pos = posAt(s);
      // the look point: the mean of five points round s + ahead
      const L = [0, 0, 0];
      for (const k of [0.6, 0.8, 1, 1.2, 1.4]) { const q = ext(s + ahead * k); L[0] += q[0] / 5; L[1] += q[1] / 5; L[2] += q[2] / 5; }
      const t = tangentAt(s);
      let dx = L[0] - pos[0], dz = L[2] - pos[2];
      const hd = Math.hypot(dx, dz);
      // a tight bend brings the look point near: lean on the tangent then
      const w = smooth((hd - ahead * 0.15) / (ahead * 0.3));
      const th = Math.hypot(t[0], t[2]) || 1;
      dx = (hd > 1e-6 ? dx / hd : 0) * w + t[0] / th * (1 - w);
      dz = (hd > 1e-6 ? dz / hd : 0) * w + t[2] / th * (1 - w);
      const dl = Math.hypot(dx, dz) || 1, h = Math.max(hd, ahead * 0.5);
      const ly = L[1] - clear * 0.4 - down;
      const pitch = clamp(Math.atan2(ly - pos[1], h), pMin, pMax);
      return { pos, look: [pos[0] + dx / dl * h, pos[1] + Math.tan(pitch) * h, pos[2] + dz / dl * h], kappa: kappaAt(s), tangent: t };
    },
    nearest(p) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < N; i++) { const d = (X[i] - p[0]) ** 2 + (Y[i] - p[1]) ** 2 + (Z[i] - p[2]) ** 2; if (d < bd) { bd = d; best = i; } }
      return S[best];
    },
  };
}

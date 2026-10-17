// ============================================================================
//  DLA TERRAIN  ·  camera.js — orbit, fly and drone cameras (no DOM)
// ----------------------------------------------------------------------------
//  createCamera(opts) -> cam    one camera with three modes:
//    orbit   round cam.orbit = { target [x,y,z], yaw, pitch, dist }
//            (drag turns, wheel or pinch zooms, right drag or two fingers pan)
//    fly     cam.fly = { pos, yaw, pitch }: WASD moves in the view plane,
//            Q / E (or space / shift) down and up, the mouse looks; the speed
//            scales with the height above the ground; R boosts x 4
//    drone   a smooth spline flight (cam.drone = path from dronePath) at a
//            fixed ground speed, looking ahead and down along the path
//  cam.update(dt, input, world)   input = { move [x, y, z] -1..1, look [dx, dy]
//            px, zoom (wheel steps, + = in), pan [dx, dy] px, boost }
//            world = { heightAt(x, z), size, seaLevel }
//            Terrain collision: the eye stays CLEAR m over the ground and the
//            sea; the orbit target follows the ground under it.
//  cam.matrices(w, h, opts) -> { view, proj, viewProj, invViewProj, pos,
//            forward, right, up, fovY, aspect, near }   opts = { jitter [px],
//            shift [ndcX, ndcY] (move the image centre: saver band framing) }
//  cam.flyTo(x, z, world)       a smooth move of the orbit target (map click)
//  cam.frameWorld(world, k)     the orbit that shows the whole terrain
//  dronePath(polyline, world, opts) -> { pts, len, at(s) -> { pos, look } }
//            opts.side / sideK: sample the ground across the path too
//            centripetal Catmull-Rom through resampled points, the height a
//            windowed max of the ground + clearance, arc-length table
//  bandShift(band, H) -> NDC y shift that centres the subject in the band
//
//  grep -n targets: "export function createCamera", "export function dronePath",
//  "export function bandShift", "function collide", "CLEAR"
// ============================================================================
import { lookAt, perspectiveRZ, mul, invert } from './gpu/mat.js';

export const CLEAR = 2.2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export function forwardOf(yaw, pitch) {
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

export function bandShift(band, H) {
  if (!band || !(H > 0)) return 0;
  const yc = band.t + (H - band.t - band.b) / 2;   // px from the top
  return 1 - 2 * yc / H;                            // NDC y of the band centre
}

export function createCamera(opts = {}) {
  const cam = {
    mode: 'orbit', fovY: opts.fovY || 50 * Math.PI / 180, near: opts.near || 0.5,
    orbit: { target: [0, 0, 0], yaw: 0.6, pitch: -0.45, dist: 9000 },
    orbitGoal: null,
    fly: { pos: [0, 500, 0], yaw: 0, pitch: -0.15 },
    drone: null, droneS: 0, droneSpeed: 60,
    pos: [0, 500, 3000], forward: [0, 0, -1], up: [0, 1, 0],
    _look: [0, 0], _move: [0, 0, 0],
  };

  function groundAt(world, x, z) {
    const h = world && world.heightAt ? world.heightAt(x, z) : 0;
    return Math.max(h, world && world.seaLevel !== undefined ? world.seaLevel : -Infinity);
  }
  function collide(p, world, clear = CLEAR) {
    const g = groundAt(world, p[0], p[2]);
    if (p[1] < g + clear) p[1] = g + clear;
    return p;
  }

  cam.setMode = (m, world) => {
    if (m === cam.mode) return;
    if (m === 'fly') {
      cam.fly.pos = cam.pos.slice();
      const f = cam.forward;
      cam.fly.yaw = Math.atan2(f[0], -f[2]); cam.fly.pitch = Math.asin(clamp(f[1], -1, 1));
    } else if (m === 'orbit') {
      // put the orbit target on the ground ahead
      const f = cam.forward, d = clamp(cam.orbit.dist, 200, 1e5);
      const t = [cam.pos[0] + f[0] * d, 0, cam.pos[2] + f[2] * d];
      t[1] = groundAt(world, t[0], t[2]);
      cam.orbit.target = t;
      cam.orbit.yaw = Math.atan2(-f[0], f[2]);
      cam.orbit.pitch = clamp(Math.asin(clamp(f[1], -1, 1)), -1.45, -0.05);
      cam.orbit.dist = Math.hypot(cam.pos[0] - t[0], cam.pos[1] - t[1], cam.pos[2] - t[2]);
    }
    cam.mode = m;
  };

  cam.frameWorld = (world, k = 1) => {
    const s = world.size || 8000;
    cam.orbit.target = [0, (world.midH ?? 0), 0];
    cam.orbit.dist = s * 0.95 * k;
    cam.orbit.pitch = -0.52;
    cam.orbitGoal = null;
  };
  cam.flyTo = (x, z, world, dist) => {
    const y = groundAt(world, x, z);
    cam.orbitGoal = { target: [x, y, z], dist: dist ?? clamp(cam.orbit.dist * 0.6, 400, (world.size || 8000) * 0.4) };
    if (cam.mode !== 'orbit') cam.setMode('orbit', world);
  };

  cam.update = (dt, input = {}, world = {}) => {
    const look = input.look || [0, 0], move = input.move || [0, 0, 0];
    const size = world.size || 8000;
    if (cam.mode === 'orbit') {
      const o = cam.orbit;
      o.yaw -= look[0] * 0.005;
      o.pitch = clamp(o.pitch - look[1] * 0.004, -1.52, -0.02);
      if (input.zoom) o.dist = clamp(o.dist * Math.pow(0.88, input.zoom), 30, size * 3);
      // ground axes of the view: fwd and right (x east, z south)
      const fl = Math.hypot(cam.forward[0], cam.forward[2]) || 1;
      const fx = cam.forward[0] / fl, fz = cam.forward[2] / fl, rx = -fz, rz = fx;
      if (input.pan && (input.pan[0] || input.pan[1])) {
        // grab the ground: a drag right moves the view left
        const k = o.dist * 0.0012;
        o.target[0] += (-input.pan[0] * rx + input.pan[1] * fx) * k;
        o.target[2] += (-input.pan[0] * rz + input.pan[1] * fz) * k;
        cam.orbitGoal = null;
      }
      if (move[0] || move[2]) {
        const k = o.dist * 0.8 * dt;
        o.target[0] += (move[2] * fx + move[0] * rx) * k;
        o.target[2] += (move[2] * fz + move[0] * rz) * k;
        cam.orbitGoal = null;
      }
      if (move[1]) o.dist = clamp(o.dist * Math.exp(-move[1] * dt), 30, size * 3);
      if (cam.orbitGoal) {
        const g = cam.orbitGoal;
        for (let i = 0; i < 3; i++) o.target[i] = damp(o.target[i], g.target[i], 2.2, dt);
        o.dist = damp(o.dist, g.dist, 2.2, dt);
        if (Math.hypot(o.target[0] - g.target[0], o.target[2] - g.target[2]) < 1 && Math.abs(o.dist - g.dist) < 1) cam.orbitGoal = null;
      }
      const lim = size * 0.75;
      o.target[0] = clamp(o.target[0], -lim, lim); o.target[2] = clamp(o.target[2], -lim, lim);
      o.target[1] = damp(o.target[1], groundAt(world, o.target[0], o.target[2]), 3, dt);
      const f = forwardOf(o.yaw + Math.PI, o.pitch);
      // forwardOf(yaw) looks along yaw; the eye sits behind the target
      const eye = [o.target[0] - f[0] * o.dist, o.target[1] - f[1] * o.dist, o.target[2] - f[2] * o.dist];
      collide(eye, world, CLEAR + 3);
      cam.pos = eye;
      const d = [o.target[0] - eye[0], o.target[1] - eye[1], o.target[2] - eye[2]];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      cam.forward = [d[0] / l, d[1] / l, d[2] / l];
    } else if (cam.mode === 'fly') {
      const F = cam.fly;
      F.yaw += look[0] * 0.0028;
      F.pitch = clamp(F.pitch - look[1] * 0.0028, -1.5, 1.5);
      const agl = Math.max(1, F.pos[1] - groundAt(world, F.pos[0], F.pos[2]));
      const speed = clamp(agl * 1.1, 6, 2500) * (input.boost ? 4 : 1);
      const f = forwardOf(F.yaw, F.pitch), r = [Math.cos(F.yaw), 0, Math.sin(F.yaw)];
      for (let i = 0; i < 3; i++) cam._move[i] = damp(cam._move[i], (f[i] * move[2] + r[i] * move[0] + (i === 1 ? move[1] : 0)) * speed, 6, dt);
      for (let i = 0; i < 3; i++) F.pos[i] += cam._move[i] * dt;
      const lim = size * 0.8;
      F.pos[0] = clamp(F.pos[0], -lim, lim); F.pos[2] = clamp(F.pos[2], -lim, lim);
      F.pos[1] = Math.min(F.pos[1], size * 2);
      collide(F.pos, world);
      cam.pos = F.pos.slice();
      cam.forward = f;
    } else if (cam.mode === 'drone' && cam.drone) {
      cam.droneS += cam.droneSpeed * dt;
      if (cam.droneS > cam.drone.len) cam.droneS = cam.drone.loop ? cam.droneS % cam.drone.len : cam.drone.len;
      const a = cam.drone.at(cam.droneS);
      const p = collide(a.pos.slice(), world, CLEAR + 8);
      // smooth the eye a little so a ground bump does not jolt the frame
      for (let i = 0; i < 3; i++) cam.pos[i] = dt > 0.5 ? p[i] : damp(cam.pos[i], p[i], 8, dt);
      const d = [a.look[0] - cam.pos[0], a.look[1] - cam.pos[1], a.look[2] - cam.pos[2]];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      const want = [d[0] / l, d[1] / l, d[2] / l];
      for (let i = 0; i < 3; i++) cam.forward[i] = dt > 0.5 ? want[i] : damp(cam.forward[i], want[i], 3, dt);
      const fl = Math.hypot(...cam.forward) || 1;
      cam.forward = cam.forward.map(v => v / fl);
    }
    return cam;
  };

  cam.matrices = (w, h, o = {}) => {
    const aspect = w / Math.max(1, h);
    // near plane: closer when the eye is low, so grass at the feet is not cut
    const proj = perspectiveRZ(cam.fovY, aspect, cam.near);
    const j = o.jitter || [0, 0], sh = o.shift || [0, 0];
    // m[8], m[9]: x and y of clip get + c * z_view, w = -z_view -> ndc - c
    proj[8] = -(2 * j[0] / w + sh[0]);
    proj[9] = -(2 * j[1] / h + sh[1]);
    const target = [cam.pos[0] + cam.forward[0], cam.pos[1] + cam.forward[1], cam.pos[2] + cam.forward[2]];
    const up = Math.abs(cam.forward[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
    const view = lookAt(cam.pos, target, up);
    const viewProj = mul(proj, view);
    const projNJ = perspectiveRZ(cam.fovY, aspect, cam.near);
    projNJ[8] = -sh[0]; projNJ[9] = -sh[1];
    const right = [view[0], view[4], view[8]], upv = [view[1], view[5], view[9]];
    return {
      view, proj, viewProj, invViewProj: invert(viewProj), viewProjNoJitter: mul(projNJ, view),
      pos: cam.pos.slice(), forward: cam.forward.slice(), right, up: upv, fovY: cam.fovY, aspect, near: cam.near,
    };
  };
  return cam;
}

// ── drone paths ─────────────────────────────────────────────────────────
// polyline: Float32Array xz pairs. opts = { spacing m, clearance m, window
// m, lookAhead m, lookDown m, reverse }
export function dronePath(poly, world, opts = {}) {
  const spacing = opts.spacing || 80, clear = opts.clearance ?? 90, win = opts.window || 260;
  const ahead = opts.lookAhead || 420, down = opts.lookDown ?? 60;
  let xy = [];
  for (let i = 0; i + 1 < poly.length; i += 2) xy.push([poly[i], poly[i + 1]]);
  if (opts.reverse) xy.reverse();
  if (xy.length < 2) xy = [[0, 0], [100, 0]];
  // resample at a fixed spacing
  const pts = [xy[0]];
  let acc = 0;
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1], b = xy[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = spacing - acc;
    while (s <= d) { const t = s / d; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); s += spacing; }
    acc = (acc + d) % spacing;
  }
  // light smoothing of the plan (3 passes of a 1-2-1 filter)
  for (let p = 0; p < 3; p++) for (let i = 1; i < pts.length - 1; i++) {
    pts[i] = [(pts[i - 1][0] + 2 * pts[i][0] + pts[i + 1][0]) / 4, (pts[i - 1][1] + 2 * pts[i][1] + pts[i + 1][1]) / 4];
  }
  const hAt = (x, z) => Math.max(world.heightAt ? world.heightAt(x, z) : 0, world.seaLevel ?? -Infinity);
  const k = Math.max(1, Math.round(win / spacing));
  const ground = pts.map(p => hAt(p[0], p[1]));
  // side: also sample the ground across the path (a river runs at the
  // floor of its valley; the camera rises toward the banks by sideK)
  const side = opts.side || 0, sideK = opts.sideK ?? 0.7;
  const across = pts.map((p, i) => {
    if (!side) return -Infinity;
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    let m = -Infinity;
    for (const s of [-1, -0.5, 0.5, 1]) m = Math.max(m, hAt(p[0] - tz * side * s, p[1] + tx * side * s));
    return m;
  });
  const P = pts.map((p, i) => {
    let m = -Infinity, sm = -Infinity;
    for (let j = Math.max(0, i - k); j <= Math.min(pts.length - 1, i + k); j++) { m = Math.max(m, ground[j]); sm = Math.max(sm, across[j]); }
    const y = side ? Math.max(m, m + (sm - m) * sideK) : m;
    return [p[0], y + clear, p[1]];
  });
  // centripetal Catmull-Rom between P[i] and P[i+1]
  const seg = (i, t) => {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[Math.min(P.length - 1, i + 1)], p3 = P[Math.min(P.length - 1, i + 2)];
    const t2 = t * t, t3 = t2 * t;
    return [0, 1, 2].map(c => 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3));
  };
  // arc-length table, 8 samples per segment
  const table = [{ s: 0, i: 0, t: 0, p: P[0] }];
  let len = 0, last = P[0];
  for (let i = 0; i < P.length - 1; i++) for (let q = 1; q <= 8; q++) {
    const p = seg(i, q / 8);
    len += Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]);
    table.push({ s: len, i, t: q / 8, p }); last = p;
  }
  // composition: the drone always looks a little down (land in the lower
  // two thirds, the horizon high), never up at an empty sky
  const pMin = opts.pitchMin ?? -0.5, pMax = opts.pitchMax ?? -0.13;
  const framePitch = (pos, look) => {
    const dx = look[0] - pos[0], dz = look[2] - pos[2], h = Math.hypot(dx, dz) || 1;
    const pitch = clamp(Math.atan2(look[1] - pos[1], h), pMin, pMax);
    return [look[0], pos[1] + Math.tan(pitch) * h, look[2]];
  };
  const posAt = s => {
    s = clamp(s, 0, len);
    let lo = 0, hi = table.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (table[m].s < s) lo = m; else hi = m; }
    const a = table[lo], b = table[hi], u = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    return [a.p[0] + (b.p[0] - a.p[0]) * u, a.p[1] + (b.p[1] - a.p[1]) * u, a.p[2] + (b.p[2] - a.p[2]) * u];
  };
  return {
    pts: P, len, loop: !!opts.loop,
    at(s) {
      const pos = posAt(s);
      const la = posAt(Math.min(len, s + ahead));
      if (s + ahead > len) {
        // past the end: keep the last heading
        const pb = posAt(Math.max(0, len - ahead));
        const d = [pos[0] - pb[0], pos[2] - pb[2]], l = Math.hypot(d[0], d[1]) || 1;
        return { pos, look: framePitch(pos, [pos[0] + d[0] / l * ahead, hAt(pos[0], pos[2]) + clear - down, pos[2] + d[1] / l * ahead]) };
      }
      return { pos, look: framePitch(pos, [la[0], la[1] - clear * 0.4 - down, la[2]]) };
    },
  };
}

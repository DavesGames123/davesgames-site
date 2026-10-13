// ============================================================================
//  BREADBOARD LAB  ·  view/camera.js — the orbit rig (pure)
// ----------------------------------------------------------------------------
//  The camera orbits a target point on the bench. Its state is
//  { target, dist, yaw, pitch }: pos = target + dist · (cos p · sin y,
//  sin p, cos p · cos y). yaw 0 puts the camera on the +Z side, so at
//  pitch 90° the screen shows +X to the right and +Z down (the top view
//  of CONTRACT 3.1).
//
//  Moves: orbit (drag), pan (right drag, two fingers), zoom toward the
//  point under the pointer (wheel, pinch), and tweens (animateTo) for
//  focus, top view and fit. update(now) advances a tween and says whether
//  the camera still moves, so the scene can render on demand.
//
//  GREP MAP
//    PITCH_MIN / PITCH_TOP .. the pitch range
//    createCameraRig ........ state, pos, pose
//    orbit / pan / zoom ..... user moves
//    setPose / animateTo .... jumps and tweens (shortest yaw path)
//    fitPose / topPose ...... framing a box; the top view
//    apply .................. writes a THREE camera
// ============================================================================

export const PITCH_MIN = 0.06;
export const PITCH_TOP = 89.6 * Math.PI / 180;
export const DIST_MIN = 25, DIST_MAX = 2400;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = t => 1 - Math.pow(1 - t, 3);
const wrapPi = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };

export function createCameraRig(o = {}) {
  const s = {
    target: (o.target || [0, 0, 0]).slice(),
    dist: o.dist ?? 340,
    yaw: o.yaw ?? 0,
    pitch: o.pitch ?? 0.95,
    fov: o.fov ?? 38,
    aspect: o.aspect ?? 1.6,
  };
  let tween = null;

  const posOf = st => [
    st.target[0] + st.dist * Math.cos(st.pitch) * Math.sin(st.yaw),
    st.target[1] + st.dist * Math.sin(st.pitch),
    st.target[2] + st.dist * Math.cos(st.pitch) * Math.cos(st.yaw),
  ];

  function stateFromPose(pose) {
    const t = pose.target, p = pose.pos;
    const dx = p[0] - t[0], dy = p[1] - t[1], dz = p[2] - t[2];
    const dist = clamp(Math.hypot(dx, dy, dz), DIST_MIN, DIST_MAX);
    const pitch = clamp(Math.asin(clamp(dy / (Math.hypot(dx, dy, dz) || 1), -1, 1)), PITCH_MIN, PITCH_TOP);
    const yaw = Math.hypot(dx, dz) < 1e-6 ? s.yaw : Math.atan2(dx, dz);
    return { target: t.slice(), dist, yaw, pitch };
  }

  const rig = {
    state: s,
    get moving() { return !!tween; },
    pos() { return posOf(s); },
    pose() { return { pos: posOf(s), target: s.target.slice() }; },
    // Plain camera data for view/picking.js.
    cam() { return { pos: posOf(s), target: s.target.slice(), fov: s.fov, aspect: s.aspect, up: s.pitch > PITCH_TOP - 1e-3 ? [-Math.sin(s.yaw), 0, -Math.cos(s.yaw)] : [0, 1, 0] }; },
    isTop() { return s.pitch > PITCH_TOP - 0.02; },

    orbit(dYaw, dPitch) {
      tween = null;
      s.yaw = wrapPi(s.yaw + dYaw);
      s.pitch = clamp(s.pitch + dPitch, PITCH_MIN, PITCH_TOP);
    },

    // Pan by screen pixels: the bench point under the pointer stays under it
    // (exact for the target plane).
    pan(dxPx, dyPx, viewH) {
      tween = null;
      const k = 2 * s.dist * Math.tan(s.fov * Math.PI / 360) / Math.max(1, viewH);
      const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);          // screen right on the ground
      const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);         // screen up on the ground
      const ux = dxPx * k, uy = dyPx * k / Math.max(0.25, Math.sin(s.pitch));   // foreshortening
      s.target[0] += -ux * rx + uy * fx;
      s.target[2] += -ux * rz + uy * fz;
    },

    // factor < 1 moves in. anchor (world point) stays put on screen.
    zoom(factor, anchor) {
      tween = null;
      const nd = clamp(s.dist * factor, DIST_MIN, DIST_MAX);
      const f = nd / s.dist;
      if (anchor) for (let i = 0; i < 3; i++) s.target[i] = anchor[i] + (s.target[i] - anchor[i]) * f;
      s.target[1] = clamp(s.target[1], -5, 60);
      s.dist = nd;
    },

    setPose(pose) { tween = null; Object.assign(s, stateFromPose(pose)); },
    setState(st) { tween = null; Object.assign(s, { ...st, target: (st.target || s.target).slice() }); },
    setAspect(a) { s.aspect = a; },

    animateTo(pose, ms = 600, now = 0) {
      const to = pose.dist !== undefined ? { target: pose.target.slice(), dist: pose.dist, yaw: pose.yaw ?? s.yaw, pitch: pose.pitch ?? s.pitch } : stateFromPose(pose);
      if (ms <= 0) { tween = null; Object.assign(s, to); return; }
      tween = { from: { target: s.target.slice(), dist: s.dist, yaw: s.yaw, pitch: s.pitch }, to, t0: now, ms, started: false };
    },

    update(now) {
      if (!tween) return false;
      if (!tween.started) { tween.started = true; tween.t0 = now; }
      const u = clamp((now - tween.t0) / tween.ms, 0, 1), e = ease(u);
      const a = tween.from, b = tween.to;
      for (let i = 0; i < 3; i++) s.target[i] = a.target[i] + (b.target[i] - a.target[i]) * e;
      s.dist = Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * e);
      s.yaw = wrapPi(a.yaw + wrapPi(b.yaw - a.yaw) * e);
      s.pitch = a.pitch + (b.pitch - a.pitch) * e;
      if (u >= 1) tween = null;
      return true;
    },

    // State that frames an axis-aligned box { min:[3], max:[3] }.
    fitPose(box, o2 = {}) {
      const c = [0, 1, 2].map(i => (box.min[i] + box.max[i]) / 2);
      const ext = [0, 1, 2].map(i => Math.max(1, box.max[i] - box.min[i]));
      const radius = Math.hypot(ext[0], ext[1] * 0.5, ext[2]) / 2;
      const th = Math.tan(s.fov * Math.PI / 360);
      const fitV = radius / th, fitH = radius / (th * Math.max(0.3, s.aspect));
      const dist = clamp(Math.max(fitV, fitH) * (o2.margin ?? 1.12), DIST_MIN, DIST_MAX);
      return { target: c, dist, yaw: o2.yaw ?? s.yaw, pitch: o2.pitch ?? s.pitch };
    },
    topPose() { return { target: s.target.slice(), dist: s.dist, yaw: 0, pitch: PITCH_TOP }; },

    apply(camera) {
      const c = rig.cam();
      camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
      camera.up.set(c.up[0], c.up[1], c.up[2]);
      camera.lookAt(c.target[0], c.target[1], c.target[2]);
      if (camera.fov !== s.fov || camera.aspect !== s.aspect) { camera.fov = s.fov; camera.aspect = s.aspect; camera.updateProjectionMatrix(); }
      camera.updateMatrixWorld();
    },
  };
  return rig;
}

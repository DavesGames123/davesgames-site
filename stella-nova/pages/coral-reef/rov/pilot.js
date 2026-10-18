// ============================================================================
//  CORAL REEF  ·  ROV  ·  the autopilot (DOM-free, node and browser)
// ----------------------------------------------------------------------------
//  Path planning and motion for one ROV, from the rock SDF only. No three.js
//  here: points are [x, y, z] arrays, y up, metres. Every choice comes from
//  a seeded generator, so one seed gives one dive (the tests check it).
//
//  PLANNING. A survey leg is a list of control points: the pass line of a
//  rock feature (through a canyon, under an arch, past a pinnacle), or a
//  free point at 1.5 to 3 m over the surface. passLine() tries 16 headings
//  through the feature centre and keeps the one with the most free water.
//  buildPath() samples a Catmull-Rom curve through the points every 0.25 m,
//  pushes each sample out of the rock to the clearance (sdf >= clear),
//  smooths, pushes again, and splits any segment whose midpoint is too
//  near. The result is a polyline with its arc length.
//
//  MOTION. A carrot moves along the path. The vehicle follows it with a
//  damped spring (acceleration and speed limits, as a real ROV with slow
//  thrusters). Vehicles push apart under 4 m. A guard pushes the vehicle
//  out of the clearance shell if the spring cuts a corner. Yaw turns at a
//  limited rate to the travel direction (survey) or to the target
//  (inspect, focus).
//
//  MODES.
//    survey ... follow legs through the features, then pick a colony to
//               inspect (from targets()), or plan the next leg
//    inspect .. approach, then a slow orbit (0.06 to 0.1 rad/s) round one
//               colony for 25 to 45 s; the camera faces it
//    focus .... inspect with no end, for the saver: the orbit radius
//               follows the colony bounds each step, with slow push-ins
//               and a slow change of elevation; it climbs when rock hides
//               the colony
//  zoomFov() gives the camera field of view that keeps the target sphere
//  in the frame (the ROV camera has a zoom lens).
//
//  grep -n targets
//    "export function rng"           seeded generator (mulberry32)
//    "export function pushOut"       move a point to the clearance
//    "export function passLine"      the line through a feature
//    "export function buildPath"     control points -> safe polyline
//    "export function pathAt"        point and tangent at arc length s
//    "export function zoomFov"       field of view for a target sphere
//    "export function orbitPose"     the focus orbit point at time t
//    "export function createPilot"   one vehicle: plan, update, focus
// ============================================================================

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash(...v) {
  let h = 2166136261;
  for (const x of v) { h ^= Math.imul((x | 0) >>> 0, 2654435761) >>> 0; h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

function gradient(sdf, p) {
  const e = 0.03, [x, y, z] = p;
  const g = [sdf(x + e, y, z) - sdf(x - e, y, z), sdf(x, y + e, z) - sdf(x, y - e, z), sdf(x, y, z + e) - sdf(x, y, z - e)];
  const l = len(g);
  return l > 1e-9 ? [g[0] / l, g[1] / l, g[2] / l] : [0, 1, 0];
}

// Move p out along the SDF gradient until sdf(p) >= clear. In place.
export function pushOut(sdf, p, clear) {
  for (let i = 0; i < 32; i++) {
    const d = sdf(p[0], p[1], p[2]);
    if (d >= clear) return p;
    const n = gradient(sdf, p), s = clear - d + 0.04;
    p[0] += n[0] * s; p[1] += n[1] * s; p[2] += n[2] * s;
  }
  for (let i = 0; i < 600 && sdf(p[0], p[1], p[2]) < clear; i++) p[1] += 0.1;   // a pocket: climb out
  return p;
}

// The surface height under (x, z): sphere-trace down from top.
export function surfaceY(sdf, x, z, top, bottom = -60) {
  let y = top;
  for (let i = 0; i < 400 && y > bottom; i++) {
    const d = sdf(x, y, z);
    if (d < 0.005) return y;
    y -= Math.max(d, 0.02);
  }
  return y;
}

// The distance to rock along a unit ray, or max when it hits nothing.
export function trace(sdf, o, dir, max) {
  let t = 0;
  for (let i = 0; i < 160 && t < max; i++) {
    const d = sdf(o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t);
    if (d < 0.01) return t;
    t += Math.max(d, 0.03);
  }
  return max;
}

function minAlong(sdf, a, b, step = 0.3) {
  const n = Math.max(2, Math.ceil(len(sub(b, a)) / step));
  let m = Infinity;
  for (let i = 0; i <= n; i++) { const p = lerp3(a, b, i / n); m = Math.min(m, sdf(p[0], p[1], p[2])); }
  return m;
}

const sizeOf = (f) => (Array.isArray(f.size) ? Math.max(...f.size) : (f.size || 4));

// The best straight line through a feature: [enter, middle, exit] or null.
export function passLine(sdf, f, clear) {
  const c = pushOut(sdf, f.center.slice(), clear);
  const L = clamp(sizeOf(f) * 0.6, 3, 14);
  let best = null, bs = -Infinity;
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI;                 // a line: 0..pi covers both ways
    const d = [Math.cos(a), 0, Math.sin(a)];
    const p0 = [c[0] - d[0] * L, c[1], c[2] - d[2] * L], p1 = [c[0] + d[0] * L, c[1], c[2] + d[2] * L];
    // the score: the free water along it; a canyon or arch wants a tight
    // fit on the sides, so a line along the walls scores above one into them
    const s = Math.min(minAlong(sdf, p0, c), minAlong(sdf, c, p1));
    if (s > bs) { bs = s; best = [p0, c, p1]; }
  }
  if (!best) return null;
  pushOut(sdf, best[0], clear); pushOut(sdf, best[2], clear);
  return best;
}

// Catmull-Rom through ctrl -> a polyline that keeps sdf >= clear.
export function buildPath(sdf, ctrl, clear, o = {}) {
  const step = o.step || 0.25, lim = o.radius || Infinity, top = o.top ?? Infinity;
  const P = ctrl.map(p => p.slice());
  const keep = (p) => {
    const r = Math.hypot(p[0], p[2]);
    if (r > lim) { p[0] *= lim / r; p[2] *= lim / r; }
    if (p[1] > top) p[1] = top;
    return pushOut(sdf, p, clear);
  };
  let pts = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const n = Math.max(1, Math.ceil(len(sub(p2, p1)) / step));
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      const q = [0, 1, 2].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
      pts.push(keep(q));
    }
  }
  pts.push(keep(P[P.length - 1].slice()));
  // smooth the push-outs, then push again (the ends stay)
  for (let it = 0; it < 4; it++) {
    const q = pts.map(p => p.slice());
    for (let i = 1; i < pts.length - 1; i++) for (let k = 0; k < 3; k++) q[i][k] = (pts[i - 1][k] + 2 * pts[i][k] + pts[i + 1][k]) / 4;
    for (let i = 1; i < q.length - 1; i++) keep(q[i]);
    pts = q;
  }
  // split: no segment midpoint nearer the rock than the clearance
  for (let pass = 0; pass < 6; pass++) {
    let added = false;
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], m = lerp3(a, b, 0.5);
      if (sdf(m[0], m[1], m[2]) < clear * 0.97 || len(sub(b, a)) > step * 2.5) { out.push(keep(m)); added = true; }
      out.push(b);
    }
    pts = out;
    if (!added) break;
  }
  const s = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) s[i] = s[i - 1] + len(sub(pts[i], pts[i - 1]));
  return { pts, s, length: s[pts.length - 1] };
}

// Point and unit tangent at arc length s (clamped to the path).
export function pathAt(path, s) {
  const { pts, s: S } = path, n = pts.length;
  if (n === 1) return { p: pts[0].slice(), t: [0, 0, 1] };
  s = clamp(s, 0, path.length);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
  const seg = S[hi] - S[lo] || 1, u = (s - S[lo]) / seg;
  const d = sub(pts[hi], pts[lo]), l = len(d) || 1;
  return { p: lerp3(pts[lo], pts[hi], u), t: [d[0] / l, d[1] / l, d[2] / l] };
}

// The vertical field of view (degrees) that holds a sphere of radius r at
// distance d in a camera of the given aspect, with a margin. Clamped to
// the zoom range of the lens.
export function zoomFov(d, r, aspect, o = {}) {
  const margin = o.margin ?? 1.25, lo = o.min ?? 8, hi = o.max ?? 70;
  const s = clamp((r * margin) / Math.max(d, r * margin + 1e-3), 0, 0.999);
  const half = Math.asin(s);                  // the half angle the sphere fills
  // the narrow side of the frame must hold it: vertical if aspect >= 1
  const v = aspect >= 1 ? half : Math.atan(Math.tan(half) / aspect);
  return clamp(2 * v * 180 / Math.PI, lo, hi);
}

// The focus orbit: distance from the colony bounds, slow push-ins (a 50 s
// cycle) and an elevation that drifts between 12 and 38 degrees.
export function orbitPose(c, r, t, ph, o = {}) {
  const near = Math.max(r * 2.2 + 1.2, o.minDist ?? 2.2), far = near * 1.9 + 1.5;
  const push = 0.5 + 0.5 * Math.cos(TAU * t / (o.pushPeriod ?? 50) + ph);
  const d = near + (far - near) * push;
  const el = (12 + 26 * (0.5 + 0.5 * Math.sin(TAU * t / 83 + ph * 1.7)) + (o.climb || 0)) * Math.PI / 180;
  const a = ph * 3.1 + t * (o.rate ?? 0.07);
  return { p: [c[0] + Math.cos(a) * Math.cos(el) * d, c[1] + Math.sin(el) * d, c[2] + Math.sin(a) * Math.cos(el) * d], d, a, el };
}

// ---------------------------------------------------------------- the pilot
// o: sdf, bounds, features, radius (plot), seed, index, start ([x,y,z]),
//    clear (m, default 1.4), cruise (m/s), targets() -> [{ id, center, radius }]
export function createPilot(o) {
  const sdf = o.sdf, clear = o.clear ?? 1.4, R = o.radius ?? 30;
  const top = (o.bounds ? o.bounds.max[1] : 8) + 6;
  const rand = rng(hash(o.seed ?? 1, o.index ?? 0, 7919));
  const cruise = (o.cruise ?? 0.55) * (0.85 + 0.3 * rand());
  const feats = (o.features || []).slice();
  const st = {
    p: o.start ? pushOut(sdf, o.start.slice(), clear) : null, v: [0, 0, 0], a: [0, 0, 0],
    yaw: rand() * TAU, yawRate: 0, mode: 'survey', phase: 'path', path: null, s: 0,
    look: null, lookR: 1, timer: 0, target: null, focus: null, ph: rand() * TAU, climb: 0, t: 0,
    visits: new Map(), thrust: { fwd: 0, lat: 0, up: 0, yaw: 0 }, legs: 0,
  };
  if (!st.p) {
    const a = rand() * TAU, r = R * (0.3 + 0.4 * rand());
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    st.p = pushOut(sdf, [x, surfaceY(sdf, x, z, top) + 2.5, z], clear);
  }
  st.look = [st.p[0] + Math.cos(st.yaw) * 4, st.p[1] - 2, st.p[2] + Math.sin(st.yaw) * 4];

  function freePoint() {
    const a = rand() * TAU, r = R * Math.sqrt(0.05 + 0.75 * rand());
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    return pushOut(sdf, [x, surfaceY(sdf, x, z, top) + 1.5 + 1.5 * rand(), z], clear);
  }
  function pickFeature() {
    if (!feats.length) return null;
    let best = null, bs = -Infinity;
    for (const f of feats) {
      const seen = st.visits.get(f) || 0;
      const s = -len(sub(f.center, st.p)) * 0.05 - seen * 3 + rand() * 2.5;
      if (s > bs) { bs = s; best = f; }
    }
    st.visits.set(best, (st.visits.get(best) || 0) + 1);
    return best;
  }
  function planSurvey() {
    const ctrl = [st.p.slice()];
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const f = rand() < 0.65 ? pickFeature() : null;
      const line = f ? passLine(sdf, f, clear) : null;
      if (line) {
        // enter at the end nearer the last point
        const last = ctrl[ctrl.length - 1];
        if (len(sub(line[0], last)) > len(sub(line[2], last))) line.reverse();
        ctrl.push(...line);
      } else ctrl.push(freePoint());
    }
    st.path = buildPath(sdf, ctrl, clear, { radius: R * 0.95, top });
    st.s = 0; st.mode = 'survey'; st.phase = 'path'; st.legs++;
  }
  function planApproach(c, r) {
    const pose = orbitPose(c, r, 0, st.ph, { climb: 0 });
    const goal = pushOut(sdf, pose.p, clear);
    const mid = pushOut(sdf, lerp3(st.p, goal, 0.5), clear);
    mid[1] = Math.max(mid[1], Math.min(st.p[1], goal[1]) + 1);
    st.path = buildPath(sdf, [st.p.slice(), pushOut(sdf, mid, clear), goal], clear, { radius: R * 1.05, top });
    st.s = 0; st.phase = 'approach'; st.orbitT = 0;
  }
  function startInspect() {
    const list = o.targets ? o.targets() : [];
    if (!list || !list.length) return false;
    // the nearest few, then a seeded choice
    const by = list.map(t => ({ t, d: len(sub(t.center, st.p)) })).sort((a, b) => a.d - b.d).slice(0, 5);
    const t = by[Math.floor(rand() * by.length)].t;
    st.target = { id: t.id, get: () => t };
    st.mode = 'inspect'; st.timer = 25 + 20 * rand();
    planApproach(t.center, t.radius);
    return true;
  }

  // The goal point and the look point of this step.
  function goal(dt) {
    if (st.mode === 'survey') {
      if (!st.path || st.s >= st.path.length - 0.05) {
        if (st.legs > 0 && rand() < 0.45 && startInspect()) return goal(dt);
        planSurvey();
      }
      const lag = len(sub(pathAt(st.path, st.s).p, st.p));
      st.s += cruise * dt * clamp(1.6 - lag / 1.5, 0.15, 1);
      const g = pathAt(st.path, st.s);
      // look ahead and down: what the camera sees on a survey
      const fw = [Math.cos(st.yaw), -0.5, Math.sin(st.yaw)], fl = len(fw);
      const dir = [fw[0] / fl, fw[1] / fl, fw[2] / fl], hit = trace(sdf, st.p, dir, 10);
      return { g: g.p, look: [st.p[0] + dir[0] * hit, st.p[1] + dir[1] * hit, st.p[2] + dir[2] * hit], lookR: 1.5, face: g.t };
    }
    // inspect or focus
    const T = st.mode === 'focus' ? st.focus : st.target;
    const info = T.get();
    const c = info.center, r = Math.max(0.05, info.radius);
    if (st.phase === 'approach') {
      st.s += cruise * 1.2 * dt * clamp(1.6 - len(sub(pathAt(st.path, st.s).p, st.p)) / 1.5, 0.15, 1);
      if (st.s >= st.path.length - 0.05) { st.phase = 'orbit'; st.orbitT = 0; }
      return { g: pathAt(st.path, st.s).p, look: c, lookR: r, face: null };
    }
    st.orbitT += dt;
    // climb while rock hides the colony from the orbit point
    const pose = orbitPose(c, r, st.orbitT, st.ph, { climb: st.climb, rate: st.mode === 'focus' ? 0.05 : 0.08, pushPeriod: st.focusMode === 'orbit' && st.mode === 'focus' ? 1e9 : 50 });
    const to = sub(c, pose.p), tl = len(to);
    const hit = trace(sdf, pose.p, [to[0] / tl, to[1] / tl, to[2] / tl], tl);
    const hidden = hit < tl - r * 1.1 - 0.2;
    st.climb = clamp(st.climb + (hidden ? 14 : -4) * dt, 0, 45);
    if (st.mode === 'inspect') { st.timer -= dt; if (st.timer <= 0) { st.mode = 'survey'; st.path = null; st.target = null; } }
    return { g: pushOut(sdf, pose.p, clear), look: c, lookR: r, face: null };
  }

  // One step. others: positions of the other vehicles.
  function step(dt, others = []) {
    st.t += dt;
    const G = goal(dt);
    const k = 0.55, c = 2 * Math.sqrt(k) * 1.05;
    const a = [0, 1, 2].map(i => k * (G.g[i] - st.p[i]) - c * st.v[i]);
    for (const q of others) {
      const d = sub(st.p, q), l = len(d);
      if (l > 1e-6 && l < 4) { const f = 0.6 * (4 - l) / 4 / l; a[0] += d[0] * f; a[1] += d[1] * f * 0.4; a[2] += d[2] * f; }
    }
    const al = len(a), amax = 0.4;
    if (al > amax) for (let i = 0; i < 3; i++) a[i] *= amax / al;
    for (let i = 0; i < 3; i++) st.v[i] += a[i] * dt;
    const vl = len(st.v), vmax = 0.9;
    if (vl > vmax) for (let i = 0; i < 3; i++) st.v[i] *= vmax / vl;
    for (let i = 0; i < 3; i++) st.p[i] += st.v[i] * dt;
    // guard: keep the clearance shell; drop the speed into the rock
    const d = sdf(st.p[0], st.p[1], st.p[2]);
    if (d < clear * 0.85) {
      const n = gradient(sdf, st.p);
      pushOut(sdf, st.p, clear * 0.85);
      const vn = st.v[0] * n[0] + st.v[1] * n[1] + st.v[2] * n[2];
      if (vn < 0) for (let i = 0; i < 3; i++) st.v[i] -= vn * n[i];
    }
    st.a = a;
    // look point: eased, so the camera pans smoothly
    const e = 1 - Math.exp(-dt * (st.mode === 'survey' ? 1.2 : 2.5));
    for (let i = 0; i < 3; i++) st.look[i] += (G.look[i] - st.look[i]) * e;
    st.lookR += (G.lookR - st.lookR) * e;
    // yaw: to the travel direction on a survey, to the target otherwise
    let want = st.yaw;
    if (G.face && Math.hypot(st.v[0], st.v[2]) > 0.08) want = Math.atan2(st.v[2], st.v[0]);
    else if (!G.face) want = Math.atan2(st.look[2] - st.p[2], st.look[0] - st.p[0]);
    const yr = clamp(angDiff(st.yaw, want) * 0.9, -0.35, 0.35);
    st.yawRate += (yr - st.yawRate) * (1 - Math.exp(-dt * 3));
    st.yaw += st.yawRate * dt;
    // thrust in the body frame (x forward, z right), for the props and wash
    const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
    st.thrust.fwd = (a[0] * cy + a[2] * sy) / amax;
    st.thrust.lat = (-a[0] * sy + a[2] * cy) / amax;
    st.thrust.up = a[1] / amax;
    st.thrust.yaw = st.yawRate / 0.35;
    return st;
  }

  // focus(target | null, mode): target.get() -> { center, radius }.
  function focus(T, mode = 'inspect') {
    if (!T || mode === 'survey') { st.focus = null; st.mode = 'survey'; st.path = null; return; }
    st.focus = T; st.mode = 'focus'; st.climb = 0; st.focusMode = mode;
    const info = T.get();
    const far = len(sub(info.center, st.p)) > info.radius * 4 + 8;
    if (far) planApproach(info.center, info.radius);
    else { st.phase = 'orbit'; st.orbitT = 0; }
  }

  return { state: st, step, focus, planSurvey, clear };
}

// ============================================================================
//  CORAL REEF  ·  rov/squad.js  ·  the ROV squad that explores for ever
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "an infinite procedurally generated
//  seafloor/seamount terrain that is explored constantly by the ROV
//  squad". This is the planner and the motion of 2 to 4 vehicles on the
//  infinite world, DOM-free (node tests, the page). Points are [x, y, z]
//  in world metres. The vehicle states have the fields of rov/pilot.js
//  (p, v, a, yaw, yawRate, look, lookR, mode, phase, thrust), so
//  rov/index.js poses the models, lamps and feed camera from them.
//
//  THE LEADER (vehicle 0) flies legs. At the end of a leg it picks the next
//  task by a score:
//    inspect ... a big colony near (size >= 3 m) not seen up close: an
//                approach, then a slow orbit of 20 to 35 s (the camera
//                and the lamps on it). The others take orbit slots too,
//                so all the lamps light the colony.
//    arch ...... an arch near that the squad has not passed: the line
//                through its gap, along its axis
//    canyon .... a canyon near: its floor path, 1.8 m up, the way that
//                keeps the heading
//    frontier .. else 32 candidate points round the leader (16 headings x
//                2 distances) at 2.5 to 4 m over the ground. Score: the
//                cells of 12 m not seen yet (novelty), the heading kept,
//                the habitat (coral), ridges and drop-offs (interest), a
//                slow exploration heading (so the squad does not circle),
//                a small seeded jitter. The label says what the point is:
//                a ridge, a drop-off, unexplored ground.
//  A leg is planned by rov/pilot.js marchPath on field.sdf (rock, sand and
//  the coral term), so every vertex has the clearance.
//
//  THE OTHERS keep a loose formation: a slot behind and beside the leader
//  (turned with its heading), when the line to it is free. Where the water
//  is narrow (a canyon, an arch) they fall back to the leader's trail (its
//  past positions, free water by construction) at 4.5 m x their rank.
//
//  MOTION (all): a damped spring to the goal, speed and thrust limits,
//  separation under 4 m, and a guard that keeps the clearance shell (the
//  push-out of rov/pilot.js). Yaw turns to the travel or to the target.
//
//  TETHERS. None: the vehicles are hybrid ROVs (as WHOI Nereus) with a
//  fibre-optic micro-tether that a camera does not see (CONTRACT-V4.md).
//
//    const S = createSquad({ field, seed, count, clear, start });
//      field: { sdf(x, y, z) (field units: rock, sand, coral), ground(x, z),
//               featuresAt(x, z, r) (or features(x, z, r)), colonies() -> [{ key, center, radius,
//               size, id }], habitat?(x, z), sdfScale }
//    S.vehicles[i] = { id, state }; S.step(dt); S.leader
//    S.task = { kind, label, target?, t }; S.stats = { distance, cells,
//      chunks, colonies, depth, legs, t }
//    S.setCount(n), S.reset(start)
//
//  grep -n targets: "export function createSquad", "function nextTask", "export function frontierScore",
//  "function frontier", "function followerGoal", "function move("
// ============================================================================
import { marchPath, pathAt, pushOut, trace, orbitPose, rng, hash } from './pilot.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const CELL = 12, CHUNK = 32;
export const TASK_LABEL = {
  frontier: 'surveying unexplored ground', ridge: 'following a ridge', dropoff: 'dropping down a cliff', climb: 'climbing a seamount flank',
  canyon: 'following a canyon', arch: 'passing under an arch', inspect: 'inspecting a colony', regroup: 'regrouping',
};

function gradient(sdf, p) {
  const e = 0.05, [x, y, z] = p;
  const g = [sdf(x + e, y, z) - sdf(x - e, y, z), sdf(x, y + e, z) - sdf(x, y - e, z), sdf(x, y, z + e) - sdf(x, y, z - e)];
  const l = len(g);
  return l > 1e-9 ? [g[0] / l, g[1] / l, g[2] / l] : [0, 1, 0];
}

// The score of a frontier point (the saver plate shows this code): the
// unseen cells first, then the heading kept, the slow exploration heading,
// the coral habitat, ridges, drop-offs and climbs; the deep plain is dull.
export function frontierScore(c) {
  let s = c.novelty * 3 + Math.cos(c.turn) * 0.9 + Math.cos(c.toward) * 1.2;
  s += c.habitat * 1.4 + c.ridge * 0.8 + c.drop * 0.5 + c.climb * 0.3;
  if (c.deep) s -= 2;
  return s + c.jitter * 0.6;
}

export function createSquad(o = {}) {
  const F = o.field, sdf = F.sdf;
  const clear = o.clear ?? 0.62;
  const seed = o.seed ?? 1;
  const rand = rng(hash(seed, 77, 1013));
  const cruise = o.cruise ?? 0.55;
  const S = { vehicles: [], task: { kind: 'frontier', label: TASK_LABEL.frontier, t: 0 }, stats: { distance: 0, cells: 0, chunks: 0, colonies: 0, depth: 0, legs: 0, t: 0 } };
  const visited = new Map(), chunksSeen = new Set(), inspected = new Set(), passed = new Set(), seenCols = new Set();
  const trail = [];                        // leader positions every 0.5 m (newest last)
  let exploreYaw = rand() * TAU, leg = null, s = 0, lastS = 0, stuckT = 0, markT = 0, orbit = null;

  function makeState(p, yaw) {
    return { p: p.slice(), v: [0, 0, 0], a: [0, 0, 0], yaw, yawRate: 0, look: [p[0] + Math.cos(yaw) * 4, p[1] - 2, p[2] + Math.sin(yaw) * 4], lookR: 1.5,
      mode: 'survey', phase: 'path', thrust: { fwd: 0, lat: 0, up: 0, yaw: 0 }, t: 0, s: 0, path: null, goal: null };
  }
  function ground(x, z) { return F.ground(x, z); }
  const featsAt = (x, z, r) => (typeof F.featuresAt === 'function' ? F.featuresAt(x, z, r) : typeof F.features === 'function' ? F.features(x, z, r) : []);
  function freeLine(a, b, lim = clear * 0.85) {
    const n = Math.max(2, Math.ceil(len(sub(b, a)) / 0.4));
    for (let k = 1; k <= n; k++) { const u = k / n; if (sdf(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u) < lim) return false; }
    return true;
  }
  function place(start, n) {
    const p0 = pushOut(sdf, start.slice(), clear * 1.1);
    S.vehicles.length = 0;
    const yaw = rand() * TAU;
    for (let i = 0; i < n; i++) {
      const off = i === 0 ? [0, 0, 0] : [-Math.cos(yaw) * 4 * i, 0.5 * i, -Math.sin(yaw) * 4 * i];
      const p = pushOut(sdf, [p0[0] + off[0], p0[1] + off[1], p0[2] + off[2]], clear * 1.1);
      S.vehicles.push({ id: i + 1, state: makeState(p, yaw) });
    }
    trail.length = 0; trail.push(p0.slice());
    leg = null;
  }
  place(o.start || [0, ground(0, 0) + 3, 0], clamp(o.count ?? 3, 1, 4));

  // ── bookkeeping: cells, chunks, colonies seen ────────────────────────────
  const ck = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  function mark() {
    for (const v of S.vehicles) {
      const p = v.state.p;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = p[0] + dx * 6, z = p[2] + dz * 6, k = ck(x, z);
        if (!visited.has(k)) S.stats.cells++;
        visited.set(k, (visited.get(k) || 0) + 1);
      }
      const c = `${Math.floor(p[0] / CHUNK)},${Math.floor(p[2] / CHUNK)}`;
      if (!chunksSeen.has(c)) { chunksSeen.add(c); S.stats.chunks++; }
    }
    if (F.colonies) for (const c of F.colonies()) {
      if (seenCols.has(c.key)) continue;
      for (const v of S.vehicles) if (len(sub(c.center, v.state.p)) < 9 + c.radius) { seenCols.add(c.key); S.stats.colonies++; break; }
    }
  }
  const novelty = (x, z) => { let n = 0; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!visited.has(ck(x + dx * CELL, z + dz * CELL))) n++; return n / 9; };

  // ── tasks ─────────────────────────────────────────────────────────────────
  function setTask(kind, extra = {}) { S.task = Object.assign({ kind, label: TASK_LABEL[kind] || kind, t: 0 }, extra); }
  function planLeg(ctrl, kind, extra) {
    const p = S.vehicles[0].state.p;
    const path = marchPath(sdf, [p.slice(), ...ctrl], clear, { budget: 16000, step: 0.3 });
    if (!path || path.length < 1.5) return false;
    leg = path; s = 0; lastS = 0; stuckT = 0; S.stats.legs++;
    setTask(kind, extra);
    return true;
  }
  function frontier() {
    const L = S.vehicles[0].state, p = L.p;
    const g0 = ground(p[0], p[2]);
    let best = null;
    exploreYaw += (rand() - 0.5) * 0.35;
    for (let i = 0; i < 16; i++) {
      const a = L.yaw + (i / 16) * TAU;
      for (const dist of [22, 34]) {
        const x = p[0] + Math.cos(a) * dist, z = p[2] + Math.sin(a) * dist, g = ground(x, z);
        const turn = Math.abs(angDiff(L.yaw, a)), toward = angDiff(exploreYaw, a), nov = novelty(x, z), jitter = rand();
        const hab = F.habitat ? F.habitat(x, z) : 0.5;
        // interest: a ridge (higher than the ring round it), a drop-off
        const ring = (ground(x + 8, z) + ground(x - 8, z) + ground(x, z + 8) + ground(x, z - 8)) / 4;
        const ridge = clamp((g - ring) / 3, 0, 1), drop = clamp((g0 - g) / 12, 0, 1), climb = clamp((g - g0) / 12, 0, 1);
        const sc = frontierScore({ novelty: nov, turn, toward, habitat: hab, ridge, drop, climb, deep: g < -58, jitter });
        if (!best || sc > best.sc) best = { sc, x, z, g, kind: ridge > 0.5 ? 'ridge' : drop > 0.6 ? 'dropoff' : climb > 0.6 ? 'climb' : 'frontier', a };
      }
    }
    const alt = 2.6 + rand() * 1.4;
    const goal = pushOut(sdf, [best.x, best.g + alt, best.z], clear);
    const mid = pushOut(sdf, [(p[0] + goal[0]) / 2, Math.max(goal[1], ground((p[0] + goal[0]) / 2, (p[2] + goal[2]) / 2) + alt), (p[2] + goal[2]) / 2], clear);
    exploreYaw += angDiff(exploreYaw, best.a) * 0.15;
    return planLeg([mid, goal], best.kind);
  }
  function tryInspect() {
    if (!F.colonies) return false;
    const p = S.vehicles[0].state.p;
    let best = null;
    for (const c of F.colonies()) {
      if (inspected.has(c.key) || c.size < 3) continue;
      const d = len(sub(c.center, p));
      if (d > 28) continue;
      const sc = c.size * 0.6 - d * 0.1 + rand() * 0.5;
      if (!best || sc > best.sc) best = { sc, c };
    }
    if (!best || rand() < 0.25) return false;
    const c = best.c;
    inspected.add(c.key);
    const ph = rand() * TAU, pose = orbitPose(c.center, c.radius, 0, ph, {});
    if (!planLeg([pushOut(sdf, pose.p, clear)], 'inspect', { target: c, ph })) return false;
    orbit = { c, ph, t: 0, dur: 20 + rand() * 15, climb: 0 };
    S.task.label = `inspecting a ${c.id === 'boulder' ? 'brain coral' : c.id === 'fan' ? 'sea fan' : c.id === 'table' ? 'table coral' : c.id === 'finger' ? 'finger coral' : 'staghorn'} colony`;
    return true;
  }
  function tryArch() {
    const p = S.vehicles[0].state.p;
    const fs = featsAt(p[0], p[2], 34);
    for (const f of fs) {
      if (f.kind !== 'arch' || passed.has(f.id) || !f.axis || !f.gap) continue;
      passed.add(f.id);
      const y = f.gap[0] + Math.min(2.2, Math.max(1.0, (f.gap[1] - f.gap[0]) * 0.5)), c = [f.center[0], y, f.center[2]], L = (f.size || 6) * 0.5 + 4;
      let a = f.axis;
      if ((p[0] - c[0]) * a[0] + (p[2] - c[2]) * a[2] > 0) a = [-a[0], 0, -a[2]];       // enter from the near side
      const p0 = [c[0] + a[0] * L, y + 0.5, c[2] + a[2] * L], p1 = [c[0] - a[0] * L, y + 0.5, c[2] - a[2] * L];
      // a gap narrower than the clearance: the squad goes over it instead
      if (sdf(c[0], c[1], c[2]) < clear * 0.9) continue;
      return planLeg([pushOut(sdf, p0, clear), c, pushOut(sdf, p1, clear)], 'arch', { target: f });
    }
    return false;
  }
  function tryCanyon() {
    const L = S.vehicles[0].state, p = L.p;
    const fs = featsAt(p[0], p[2], 30);
    const cn = fs.find(f => f.kind === 'canyon' && f.path && f.path.length > 4 && !passed.has(f.id));
    if (!cn) return false;
    passed.add(cn.id);
    let pts = cn.path.map(q => [q[0], q[1] + 1.8, q[2]]);
    const dir = sub(pts[pts.length - 1], pts[0]);
    if (dir[0] * Math.cos(L.yaw) + dir[2] * Math.sin(L.yaw) < 0) pts = pts.reverse();
    // start at the path point nearest the leader
    let k0 = 0, bd = Infinity;
    pts.forEach((q, i) => { const d = len(sub(q, p)); if (d < bd) { bd = d; k0 = i; } });
    const ctrl = pts.slice(k0).filter((_, i) => i % 3 === 0).map(q => pushOut(sdf, q, clear));
    if (ctrl.length < 3) return false;
    return planLeg(ctrl, 'canyon', { target: cn });
  }
  function nextTask() {
    if (tryInspect() || tryArch() || (rand() < 0.7 && tryCanyon()) || frontier()) return;
    // nothing plans (a pocket): climb, then try again
    const p = S.vehicles[0].state.p;
    planLeg([pushOut(sdf, [p[0], p[1] + 4, p[2]], clear)], 'regroup');
  }

  // ── goals ─────────────────────────────────────────────────────────────────
  function leaderGoal(dt) {
    const L = S.vehicles[0].state;
    if (S.task.kind === 'inspect' && orbit && (!leg || s >= leg.length - 0.1)) {
      orbit.t += dt;
      const c = orbit.c;
      const pose = orbitPose(c.center, c.radius, orbit.t, orbit.ph, { climb: orbit.climb, rate: 0.06 });
      const to = sub(c.center, pose.p), tl = len(to);
      const hidden = trace(sdf, pose.p, [to[0] / tl, to[1] / tl, to[2] / tl], tl) < tl - c.radius * 1.1 - 0.2;
      orbit.climb = clamp(orbit.climb + (hidden ? 14 : -4) * dt, 0, 45);
      L.mode = 'inspect'; L.phase = 'orbit';
      if (orbit.t > orbit.dur) { orbit = null; leg = null; L.mode = 'survey'; nextTask(); return leaderGoal(0); }
      const g = pushOut(sdf, pose.p, clear);
      // the orbit point jumps behind rock: plan a leg round it
      if (len(sub(g, L.p)) > 5 && !freeLine(L.p, g)) { leg = null; planLeg([g], 'inspect', { target: c }); orbit.t = Math.max(0, orbit.t - 3); }
      return { g, look: c.center, lookR: c.radius, face: null };
    }
    if (!leg || s >= leg.length - 0.05) { L.mode = 'survey'; L.phase = 'path'; nextTask(); }
    const lag = len(sub(pathAt(leg, s).p, L.p));
    s += cruise * dt * clamp(1.6 - lag / 1.5, 0.1, 1);
    s = Math.min(s, leg.length);
    const g = pathAt(leg, s);
    // stuck: no progress on the path for 8 s, plan again
    if (s - lastS > 0.25) { lastS = s; stuckT = 0; } else if ((stuckT += dt) > 8) { stuckT = 0; leg = null; }
    const insp = S.task.kind === 'inspect' && S.task.target;
    if (insp) { L.mode = 'inspect'; L.phase = 'approach'; return { g: g.p, look: S.task.target.center, lookR: S.task.target.radius, face: null }; }
    // the camera looks ahead and down: what a survey camera sees
    const fw = [Math.cos(L.yaw), -0.45, Math.sin(L.yaw)], fl = len(fw), dir = [fw[0] / fl, fw[1] / fl, fw[2] / fl];
    const hit = trace(sdf, L.p, dir, 12);
    return { g: g.p, look: [L.p[0] + dir[0] * hit, L.p[1] + dir[1] * hit, L.p[2] + dir[2] * hit], lookR: 1.6, face: g.t };
  }
  // the trail point d metres behind the leader (along its past positions)
  function trailAt(d) {
    let acc = 0;
    for (let i = trail.length - 1; i > 0; i--) {
      const seg = len(sub(trail[i], trail[i - 1]));
      if (acc + seg >= d) { const u = (d - acc) / seg; return [trail[i][0] + (trail[i - 1][0] - trail[i][0]) * u, trail[i][1] + (trail[i - 1][1] - trail[i][1]) * u, trail[i][2] + (trail[i - 1][2] - trail[i][2]) * u]; }
      acc += seg;
    }
    return trail[0].slice();
  }
  function followerGoal(v, rank, dt) {
    const L = S.vehicles[0].state, st = v.state;
    // inspecting: an orbit slot of its own, the lamps on the colony
    if (S.task.kind === 'inspect' && orbit && L.phase === 'orbit') {
      const c = orbit.c, ph = orbit.ph + rank * (TAU / (S.vehicles.length)) ;
      const pose = orbitPose(c.center, c.radius, orbit.t, ph, { climb: orbit.climb + 8 * rank, rate: 0.06 });
      const g = pushOut(sdf, pose.p, clear);
      if (freeLine(st.p, g)) return { g, look: c.center, lookR: c.radius, face: null, mode: 'inspect' };
    }
    const cy = Math.cos(L.yaw), sy = Math.sin(L.yaw);
    const side = rank % 2 ? 1 : -1, back = 4.5 * Math.ceil(rank / 2) + (rank > 2 ? 2 : 0);
    const slot = [L.p[0] - cy * back - sy * side * 3.5, L.p[1] + 0.6 * rank, L.p[2] - sy * back + cy * side * 3.5];
    let g = null;
    if (sdf(slot[0], slot[1], slot[2]) > clear && freeLine(L.p, slot) && freeLine(st.p, slot)) g = slot;
    if (!g) {
      // narrow water: the leader's trail, rank x 4.5 m back; the nearest
      // trail point with a free line from here if that one is not
      g = trailAt(4.5 * rank);
      if (!freeLine(st.p, g)) {
        let found = null;
        for (let d = 4.5 * rank + 1; d < 60 && !found; d += 1.5) { const q = trailAt(d); if (freeLine(st.p, q)) found = q; }
        g = found || st.p.slice();
      }
    }
    const insp = S.task.kind === 'inspect' && S.task.target;
    const look = insp ? S.task.target.center : [g[0] + cy * 6, ground(g[0] + cy * 6, g[2] + sy * 6), g[2] + sy * 6];
    return { g, look, lookR: insp ? S.task.target.radius : 1.6, face: insp ? null : [cy, 0, sy], mode: insp ? 'inspect' : 'survey' };
  }

  // ── motion (rov/pilot.js createPilot step, for a goal) ─────────────────────
  function move(st, G, dt, others) {
    st.t += dt;
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
    const prev = st.p.slice();
    for (let i = 0; i < 3; i++) st.p[i] += st.v[i] * dt;
    // the move may not cross rock: a trace from the last point
    const mv = sub(st.p, prev), ml = len(mv);
    if (ml > 1e-6) {
      const t = trace(sdf, prev, [mv[0] / ml, mv[1] / ml, mv[2] / ml], ml);
      if (t < ml) { st.p = prev; for (let i = 0; i < 3; i++) st.v[i] *= 0.3; }
    }
    // guard: keep the clearance shell; no speed into the rock
    const d = sdf(st.p[0], st.p[1], st.p[2]);
    if (d < clear * 0.85) {
      const n = gradient(sdf, st.p);
      pushOut(sdf, st.p, clear * 0.85);
      const vn = st.v[0] * n[0] + st.v[1] * n[1] + st.v[2] * n[2];
      if (vn < 0) for (let i = 0; i < 3; i++) st.v[i] -= vn * n[i];
    }
    st.a = a;
    const e = 1 - Math.exp(-dt * (st.mode === 'survey' ? 1.2 : 2.5));
    for (let i = 0; i < 3; i++) st.look[i] += (G.look[i] - st.look[i]) * e;
    st.lookR += (G.lookR - st.lookR) * e;
    let want = st.yaw;
    if (G.face && Math.hypot(st.v[0], st.v[2]) > 0.08) want = Math.atan2(st.v[2], st.v[0]);
    else if (!G.face) want = Math.atan2(st.look[2] - st.p[2], st.look[0] - st.p[0]);
    const yr = clamp(angDiff(st.yaw, want) * 0.9, -0.35, 0.35);
    st.yawRate += (yr - st.yawRate) * (1 - Math.exp(-dt * 3));
    st.yaw += st.yawRate * dt;
    const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
    st.thrust.fwd = (a[0] * cy + a[2] * sy) / amax; st.thrust.lat = (-a[0] * sy + a[2] * cy) / amax; st.thrust.up = a[1] / amax; st.thrust.yaw = st.yawRate / 0.35;
    return st;
  }

  function step(dt) {
    dt = clamp(dt || 0, 0, 0.1);
    const n = Math.max(1, Math.ceil(dt / (1 / 30))), h = dt / n;
    for (let q = 0; q < n; q++) {
      S.stats.t += h; S.task.t += h;
      const L = S.vehicles[0].state, before = L.p.slice();
      const G0 = leaderGoal(h);
      const pos = S.vehicles.map(v => v.state.p);
      move(L, G0, h, pos.slice(1));
      S.stats.distance += len(sub(L.p, before));
      if (len(sub(L.p, trail[trail.length - 1])) > 0.5) { trail.push(L.p.slice()); if (trail.length > 240) trail.shift(); }
      for (let i = 1; i < S.vehicles.length; i++) {
        // the goal of a follower changes slowly: 5 times a second
        const v = S.vehicles[i];
        v.goalT = (v.goalT || 0) - h;
        if (!v.goal || v.goalT <= 0) { v.goal = followerGoal(v, i, h); v.goalT = 0.2; }
        const G = v.goal;
        v.state.mode = G.mode; v.state.phase = G.mode === 'inspect' ? 'orbit' : 'path';
        move(v.state, G, h, pos.filter((_, j) => j !== i));
      }
    }
    if ((markT += dt) > 0.5) { markT = 0; mark(); }
    S.stats.depth = S.vehicles[0].state.p[1];
    return S;
  }
  function setCount(n) {
    n = clamp(n, 1, 4);
    const L = S.vehicles[0].state;
    while (S.vehicles.length > n) S.vehicles.pop();
    while (S.vehicles.length < n) {
      const i = S.vehicles.length, q = pushOut(sdf, trailAt(4.5 * i), clear * 1.1);
      S.vehicles.push({ id: i + 1, state: makeState(q, L.yaw) });
    }
  }
  S.step = step; S.setCount = setCount;
  S.reset = (start, n = S.vehicles.length) => { place(start, n); setTask('frontier'); orbit = null; };
  S.trail = trail; S.visited = visited; S.chunksSeen = chunksSeen;
  Object.defineProperty(S, 'leader', { get: () => S.vehicles[0] });
  Object.defineProperty(S, 'leg', { get: () => leg });
  S.clear = clear;
  return S;
}

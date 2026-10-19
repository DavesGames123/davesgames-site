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
//  THE OTHERS (spread, the default; the user, 2026-10-18: "the ROV's
//  neeed to run to explore different areas", "each of them need to be
//  looking at a different thing as they explore"). Each ROV flies legs of
//  its own on the shared cell map (visited): a colony near that no ROV
//  has claimed (the claims map: one subject, one ROV), else the frontier
//  point of its own sector (exploreYaw + i 2 pi / n, a bearing from the
//  centroid). spreadScore pushes a point away from the other ROVs and
//  their aims (minSep, 18 m) and holds it in the leash (180 m from the
//  centroid: the support ship of rov/cables.js follows the centroid).
//  Every regroupEvery s (480) they regroup near the leader for 10 s.
//  S.tasks() gives the task, the aim and the subject of each ROV;
//  S.overlap() the share of the cells that two or more ROVs saw.
//  spread: false gives the old loose formation: a slot behind and beside
//  the leader, or the leader's trail where the water is narrow.

//  MOTION (all): a damped spring to the goal, speed and thrust limits,
//  separation under 4 m, and a guard that keeps the clearance shell (the
//  push-out of rov/pilot.js). Yaw turns to the travel or to the target.
//
//  TETHERS. None: the vehicles are hybrid ROVs (as WHOI Nereus) with a
//  fibre-optic micro-tether that a camera does not see (CONTRACT-V4.md).
//
//    const S = createSquad({ field, seed, count, clear, start, target });
//      target: () => [x, y, z] | null, a far point the squad drifts to
//      (the page: the next depth region)
//      field: { sdf(x, y, z) (field units: rock, sand, coral), ground(x, z),
//               featuresAt(x, z, r) (or features(x, z, r)), colonies() -> [{ key, center, radius,
//               size, id }], habitat?(x, z), sdfScale }
//    S.vehicles[i] = { id, state }; S.step(dt); S.leader
//    S.task = { kind, label, target?, t }; S.stats = { distance, cells,
//      chunks, colonies, depth, legs, t }
//    S.setCount(n), S.reset(start), S.goTo(id, [x, z]) (one ROV to a point)
//    S.tasks() -> [{ id, kind, label, aim, subject }], S.overlap(), S.claims
//    options: spread (true), leash (180 m), minSep (18 m), regroupEvery (480 s)
//    S.setManual(id, on), S.drive(id, { fwd, lat, up, yaw, boost }),
//      S.isManual(id), S.manualOf(id) -> { cmd, leash, warn } | null: the
//      user drives one ROV (main.js manual.js). The planner skips it, the
//      others plan round it; off, the planner plans from where it is.
//
//  grep -n targets: "export function createSquad", "function nextTask", "export function frontierScore",
//  "function frontier", "function frontierPick", "function spreadScore",
//  "function planOwn", "function regroup", "function tasks", "function followerGoal", "function move(",
//  "function guard(", "function manualMove", "function setManual", "function drive("
// ============================================================================
import { marchPath, pathAt, pushOut, trace, orbitPose, rng, hash } from './pilot.js';
import { SPECIES } from '../reef.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const CELL = 12, CHUNK = 32;
export const TASK_LABEL = {
  frontier: 'surveying unexplored ground', ridge: 'following a ridge', dropoff: 'dropping down a cliff', climb: 'climbing a seamount flank',
  canyon: 'following a canyon', arch: 'passing under an arch', inspect: 'inspecting a colony', regroup: 'regrouping', goto: 'going to the marked point',
  manual: 'manual control',
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
  // SPREAD (2026-10-18, the user: "the ROV's neeed to run to explore
  // different areas"): every ROV plans its own legs on the shared cell map.
  const spread = o.spread ?? true, leash = o.leash ?? 180, minSep = o.minSep ?? 18;
  const regroupEvery = o.regroupEvery ?? 480;
  const S = { vehicles: [], task: { kind: 'frontier', label: TASK_LABEL.frontier, t: 0 }, stats: { distance: 0, cells: 0, chunks: 0, colonies: 0, depth: 0, legs: 0, t: 0 } };
  const claims = new Map();                // subject key (a colony) -> the slot index of the ROV that looks at it
  const claim = (vi, key) => { for (const [k, w] of claims) if (w === vi) claims.delete(k); if (key != null) claims.set(key, vi); };
  const owners = new Map();                // cell key -> bit mask of the ROVs (slot index) that saw it
  const visited = new Map(), chunksSeen = new Set(), inspected = new Set(), passed = new Set(), seenCols = new Set();
  const trail = [];                        // leader positions every 0.5 m (newest last)
  const visitedReset = () => { orbit = null; };
  let regroupT = regroupEvery, exploreYaw = rand() * TAU, leg = null, s = 0, lastS = 0, stuckT = 0, markT = 0, orbit = null;

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
  // The vehicles of a new start. Existing state objects are filled in
  // place (rov/index.js holds them), so a move to a region keeps the models.
  function place(start, n) {
    const p0 = pushOut(sdf, start.slice(), clear * 1.1);
    const old = S.vehicles.slice();
    S.vehicles.length = 0;
    const yaw = rand() * TAU;
    for (let i = 0; i < n; i++) {
      const off = i === 0 ? [0, 0, 0] : [-Math.cos(yaw) * 4 * i, 0.5 * i, -Math.sin(yaw) * 4 * i];
      const p = pushOut(sdf, [p0[0] + off[0], p0[1] + off[1], p0[2] + off[2]], clear * 1.1);
      const st = makeState(p, yaw);
      if (old[i]) { for (const k of Object.keys(old[i].state)) delete old[i].state[k]; Object.assign(old[i].state, st); old[i].goal = null; old[i].leg = null; old[i].aim = null; S.vehicles.push(old[i]); }
      else S.vehicles.push({ id: i + 1, state: st });
    }
    visitedReset();
    if (typeof claims !== 'undefined') claims.clear();
    trail.length = 0; trail.push(p0.slice());
    leg = null;
  }
  place(o.start || [0, ground(0, 0) + 3, 0], clamp(o.count ?? 3, 1, 4));

  // ── bookkeeping: cells, chunks, colonies seen ────────────────────────────
  const ck = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  function mark() {
    S.vehicles.forEach((v, vi) => {
      const p = v.state.p;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = p[0] + dx * 6, z = p[2] + dz * 6, k = ck(x, z);
        if (!visited.has(k)) S.stats.cells++;
        visited.set(k, (visited.get(k) || 0) + 1);
        owners.set(k, (owners.get(k) || 0) | (1 << vi));
      }
      const c = `${Math.floor(p[0] / CHUNK)},${Math.floor(p[2] / CHUNK)}`;
      if (!chunksSeen.has(c)) { chunksSeen.add(c); S.stats.chunks++; }
    });
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
    S.vehicles[0].aim = ctrl[ctrl.length - 1].slice();
    return true;
  }
  // ── spread: the compass, the centroid, the score of a far point ─────────
  const COMPASS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  // north is -z, east is +x (as rov/index.js headingOf)
  const compass = (dx, dz) => COMPASS[((Math.round(Math.atan2(dz, dx) / (TAU / 8)) % 8) + 8) % 8];
  function centroid() {
    const c = [0, 0, 0];
    for (const v of S.vehicles) for (let i = 0; i < 3; i++) c[i] += v.state.p[i] / S.vehicles.length;
    return c;
  }
  const KIND_TEXT = { frontier: d => `surveying ${d} ground`, ridge: d => `surveying the ${d} ridge`, dropoff: d => `dropping down the ${d} cliff`, climb: d => `climbing the ${d} flank` };
  // the other ROVs and their aims push a point away; the leash (from the
  // centroid, under the support ship) holds it in
  function spreadScore(vi, x, z, c) {
    let sc = 0;
    S.vehicles.forEach((u, j) => {
      if (j === vi) return;
      for (const q of [u.state.p, u.aim]) {
        if (!q) continue;
        const d = Math.hypot(x - q[0], z - q[2]);
        if (d < minSep * 2) sc -= 2.5 * (1 - d / (minSep * 2));
      }
    });
    const dc = Math.hypot(x - c[0], z - c[2]);
    if (dc > leash) sc -= 6 + (dc - leash) * 0.2;
    return sc;
  }
  // The best frontier point of vehicle vi: 32 candidates round it. The
  // leader keeps the slow exploration heading; ROV vi > 0 has its own
  // sector (exploreYaw + vi 2 pi / n, a bearing from the centroid).
  function frontierPick(vi) {
    const V = S.vehicles[vi], L = V.state, p = L.p;
    const g0 = ground(p[0], p[2]);
    const n = S.vehicles.length, c = centroid(), sect = exploreYaw + vi * TAU / n;
    let best = null;
    const tgt = vi === 0 && typeof o.target === 'function' ? o.target() : null;
    for (let i = 0; i < 16; i++) {
      const a = L.yaw + (i / 16) * TAU;
      for (const dist of [22, 34]) {
        const x = p[0] + Math.cos(a) * dist, z = p[2] + Math.sin(a) * dist, g = ground(x, z);
        const turn = Math.abs(angDiff(L.yaw, a)), nov = novelty(x, z), jitter = rand();
        const toward = vi === 0 || !spread ? angDiff(exploreYaw, a) : angDiff(sect, Math.atan2(z - c[2], x - c[0]));
        const hab = F.habitat ? F.habitat(x, z) : 0.5;
        // interest: a ridge (higher than the ring round it), a drop-off
        const ring = (ground(x + 8, z) + ground(x - 8, z) + ground(x, z + 8) + ground(x, z - 8)) / 4;
        const ridge = clamp((g - ring) / 3, 0, 1), drop = clamp((g0 - g) / 12, 0, 1), climb = clamp((g - g0) / 12, 0, 1);
        let sc = frontierScore({ novelty: nov, turn, toward, habitat: hab, ridge, drop, climb, deep: false, jitter });
        // a target region far away (the page changes it every 20 to 40 min):
        // the squad drifts there while it explores
        if (tgt) sc += 1.6 * Math.cos(angDiff(Math.atan2(tgt[2] - p[2], tgt[0] - p[0]), a));
        if (spread && n > 1) sc += spreadScore(vi, x, z, c);
        if (!best || sc > best.sc) best = { sc, x, z, g, kind: ridge > 0.5 ? 'ridge' : drop > 0.6 ? 'dropoff' : climb > 0.6 ? 'climb' : 'frontier', a };
      }
    }
    const alt = 2.6 + rand() * 1.4;
    const goal = pushOut(sdf, [best.x, best.g + alt, best.z], clear);
    const mid = pushOut(sdf, [(p[0] + goal[0]) / 2, Math.max(goal[1], ground((p[0] + goal[0]) / 2, (p[2] + goal[2]) / 2) + alt), (p[2] + goal[2]) / 2], clear);
    const label = KIND_TEXT[best.kind](compass(goal[0] - c[0], goal[2] - c[2]));
    return { ctrl: [mid, goal], kind: best.kind, a: best.a, goal, label };
  }
  function frontier() {
    exploreYaw += (rand() - 0.5) * 0.35;
    const f = frontierPick(0);
    exploreYaw += angDiff(exploreYaw, f.a) * 0.15;
    return planLeg(f.ctrl, f.kind, { label: f.label });
  }
  function tryInspect() {
    if (!F.colonies) return false;
    const p = S.vehicles[0].state.p;
    let best = null;
    for (const c of F.colonies()) {
      if (inspected.has(c.key) || claims.has(c.key) || c.size < 3) continue;
      const d = len(sub(c.center, p));
      if (d > 28) continue;
      const sc = c.size * 0.6 - d * 0.1 + rand() * 0.5;
      if (!best || sc > best.sc) best = { sc, c };
    }
    if (!best || rand() < 0.25) return false;
    const c = best.c;
    inspected.add(c.key); claim(0, c.key);
    const ph = rand() * TAU, pose = orbitPose(c.center, c.radius, 0, ph, {});
    if (!planLeg([pushOut(sdf, pose.p, clear)], 'inspect', { target: c, ph })) return false;
    orbit = { c, ph, t: 0, dur: 20 + rand() * 15, climb: 0 };
    const lab = SPECIES[c.id] && SPECIES[c.id].label ? SPECIES[c.id].label.toLowerCase() : 'coral';
    S.task.label = `inspecting a ${lab} colony`;
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
      if (orbit.t > orbit.dur) { orbit = null; leg = null; L.mode = 'survey'; claim(0, null); nextTask(); return leaderGoal(0); }
      const g = pushOut(sdf, pose.p, clear);
      // the orbit point jumps behind rock: plan a leg round it
      if (len(sub(g, L.p)) > 5 && !freeLine(L.p, g)) { leg = null; planLeg([g], 'inspect', { target: c }); orbit.t = Math.max(0, orbit.t - 3); }
      return { g, look: c.center, lookR: c.radius, face: null };
    }
    if (!leg || s >= leg.length - 0.05) { L.mode = 'survey'; L.phase = 'path'; if (!(S.task.kind === 'inspect' && orbit)) claim(0, null); nextTask(); }
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

  // ── spread: the own legs of ROV vi > 0 ───────────────────────────────────
  // A colony near that no ROV has claimed or inspected: a leg to an orbit
  // point and a hold of 12 to 20 s with the camera on it. Else the frontier
  // point of its own sector. A leg that does not plan: try again in 1 s.
  function planOwn(v, vi) {
    const p = v.state.p;
    if (F.colonies && rand() < 0.75) {
      let best = null;
      for (const c of F.colonies()) {
        if (inspected.has(c.key) || claims.has(c.key) || c.size < 3) continue;
        const d = len(sub(c.center, p));
        if (d > 28) continue;
        const sc = c.size * 0.6 - d * 0.1 + rand() * 0.5;
        if (!best || sc > best.sc) best = { sc, c };
      }
      if (best) {
        const c = best.c, pose = orbitPose(c.center, c.radius, 0, rand() * TAU, {});
        const goal = pushOut(sdf, pose.p, clear);
        const path = marchPath(sdf, [p.slice(), goal], clear, { budget: 16000, step: 0.3 });
        if (path && path.length >= 0.5) {
          inspected.add(c.key); claim(vi, c.key);
          const lab = SPECIES[c.id] && SPECIES[c.id].label ? SPECIES[c.id].label.toLowerCase() : 'coral';
          v.leg = { path, s: 0, lastS: 0, stuckT: 0, hold: 12 + rand() * 8, kind: 'inspect', label: `inspecting a ${lab} colony`, look: c.center, lookR: c.radius, subject: c.key };
          v.aim = goal; return true;
        }
      }
    }
    const f = frontierPick(vi);
    const path = marchPath(sdf, [p.slice(), ...f.ctrl], clear, { budget: 16000, step: 0.3 });
    if (!path || path.length < 1.5) return false;
    claim(vi, null);
    v.leg = { path, s: 0, lastS: 0, stuckT: 0, hold: 0, kind: f.kind, label: f.label };
    v.aim = f.goal;
    return true;
  }
  // every regroupEvery s the others fly to a slot near the leader and hold
  // 10 s, so the operation (and its ship) can move on to a new region
  function regroup() {
    const L = S.vehicles[0].state;
    for (let i = 1; i < S.vehicles.length; i++) {
      if (S.vehicles[i].manual) continue;
      const v = S.vehicles[i], a = L.yaw + Math.PI + (i - (S.vehicles.length) / 2) * 0.9;
      const q = pushOut(sdf, [L.p[0] + Math.cos(a) * 6, L.p[1] + 0.6 * i, L.p[2] + Math.sin(a) * 6], clear);
      const path = marchPath(sdf, [v.state.p.slice(), q], clear, { budget: 30000, step: 0.3 });
      if (!path || path.length < 0.5) continue;
      claim(i, null);
      v.leg = { path, s: 0, lastS: 0, stuckT: 0, hold: 10, kind: 'regroup', label: `regrouping with ROV ${S.vehicles[0].id}` };
      v.aim = q;
    }
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
    guard(st, prev);
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
  // the move from prev may not cross rock, and the clearance shell holds
  // (the planner moves and the manual moves)
  function guard(st, prev) {
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
  }
  // ── manual control (the user drives one ROV with the keys or the stick) ───
  // cmd = { fwd, lat, up, yaw } in -1..1 and boost. The thrust is in the body
  // frame, a linear drag gives the top speed (0.75 m/s, 1.5 m/s with boost),
  // the yaw rate eases to the command. The guard and the separation of
  // move() hold, so the ROV slides along rock and the others. The leash:
  // past 85 % of it (from the centroid of the others) the outward thrust
  // fades, past it a spring pulls the ROV back.
  function manualMove(v, h, others) {
    const st = v.state, c = v.manual.cmd, boost = c.boost ? 2 : 1;
    st.t += h;
    const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw), A = 0.45 * boost, drag = 0.6;
    const a = [(c.fwd * cy - c.lat * sy) * A - st.v[0] * drag, c.up * A * 0.8 - st.v[1] * drag, (c.fwd * sy + c.lat * cy) * A - st.v[2] * drag];
    for (const q of others) {
      const d = sub(st.p, q), l = len(d);
      if (l > 1e-6 && l < 4) { const f = 0.8 * (4 - l) / 4 / l; a[0] += d[0] * f; a[1] += d[1] * f * 0.4; a[2] += d[2] * f; }
    }
    v.manual.leash = 0; v.manual.warn = false;
    if (S.vehicles.length > 1) {
      const m = [0, 0, 0]; let n = 0;
      for (const u of S.vehicles) if (u !== v) { for (let i = 0; i < 3; i++) m[i] += u.state.p[i]; n++; }
      const r = Math.hypot(st.p[0] - m[0] / n, st.p[2] - m[2] / n), ux = (st.p[0] - m[0] / n) / (r || 1), uz = (st.p[2] - m[2] / n) / (r || 1);
      v.manual.leash = r / leash; v.manual.warn = r > leash * 0.85;
      if (v.manual.warn) {
        const out = a[0] * ux + a[2] * uz, fade = clamp((r - leash * 0.85) / (leash * 0.15), 0, 1);
        if (out > 0) { a[0] -= out * fade * ux; a[2] -= out * fade * uz; }
        if (r > leash) { const k = 0.3 * (r - leash) + 0.2; a[0] -= ux * k; a[2] -= uz * k; }
      }
    }
    for (let i = 0; i < 3; i++) st.v[i] += a[i] * h;
    const vl = len(st.v), vmax = 0.9 * boost;
    if (vl > vmax) for (let i = 0; i < 3; i++) st.v[i] *= vmax / vl;
    const prev = st.p.slice();
    for (let i = 0; i < 3; i++) st.p[i] += st.v[i] * h;
    guard(st, prev);
    st.a = a;
    st.yawRate += (c.yaw * 0.6 - st.yawRate) * (1 - Math.exp(-h * 3));
    st.yaw += st.yawRate * h;
    // the camera looks ahead and down
    const fw = [Math.cos(st.yaw), -0.45, Math.sin(st.yaw)], fl = len(fw), dir = [fw[0] / fl, fw[1] / fl, fw[2] / fl];
    const hit = trace(sdf, st.p, dir, 12), e = 1 - Math.exp(-h * 2.5);
    for (let i = 0; i < 3; i++) st.look[i] += (st.p[i] + dir[i] * hit - st.look[i]) * e;
    st.lookR += (1.6 - st.lookR) * e;
    st.mode = 'survey'; st.phase = 'manual';
    const ax = a[0] * Math.cos(st.yaw) + a[2] * Math.sin(st.yaw), az = -a[0] * Math.sin(st.yaw) + a[2] * Math.cos(st.yaw);
    st.thrust.fwd = clamp(ax / 0.9, -1, 1); st.thrust.lat = clamp(az / 0.9, -1, 1); st.thrust.up = clamp(a[1] / 0.9, -1, 1); st.thrust.yaw = clamp(st.yawRate / 0.6, -1, 1);
  }
  // setManual(id, on): take the ROV from the planner (on) or give it back
  // (off: the planner plans from where it is). drive(id, cmd) sets the
  // command; isManual(id); manualOf(id) -> { cmd, leash, warn } | null
  function setManual(id, on) {
    const vi = S.vehicles.findIndex(q => q.id === id), v = S.vehicles[vi]; if (!v) return false;
    if (on) {
      if (!v.manual) v.manual = { cmd: { fwd: 0, lat: 0, up: 0, yaw: 0, boost: false }, leash: 0, warn: false };
      claim(vi, null);
      if (vi === 0) { orbit = null; leg = null; } else { v.leg = null; v.goal = null; }
      v.aim = null;
      return true;
    }
    if (!v.manual) return false;
    v.manual = null;
    if (vi === 0) { orbit = null; leg = null; S.vehicles[0].state.mode = 'survey'; nextTask(); } else { v.leg = null; v.planT = 0; v.goal = null; }
    return true;
  }
  function drive(id, cmd) {
    const v = S.vehicles.find(q => q.id === id); if (!v || !v.manual) return false;
    const c = v.manual.cmd;
    for (const k of ['fwd', 'lat', 'up', 'yaw']) c[k] = clamp(+cmd[k] || 0, -1, 1);
    c.boost = !!cmd.boost;
    return true;
  }

  function step(dt) {
    dt = clamp(dt || 0, 0, 0.1);
    const n = Math.max(1, Math.ceil(dt / (1 / 30))), h = dt / n;
    for (let q = 0; q < n; q++) {
      S.stats.t += h; S.task.t += h;
      if (spread && S.vehicles.length > 1 && (regroupT -= h) <= 0) { regroupT = regroupEvery; regroup(); }
      const L = S.vehicles[0].state, before = L.p.slice();
      const pos = S.vehicles.map(v => v.state.p);
      if (S.vehicles[0].manual) manualMove(S.vehicles[0], h, pos.slice(1));
      else move(L, leaderGoal(h), h, pos.slice(1));
      S.stats.distance += len(sub(L.p, before));
      if (len(sub(L.p, trail[trail.length - 1])) > 0.5) { trail.push(L.p.slice()); if (trail.length > 240) trail.shift(); }
      for (let i = 1; i < S.vehicles.length; i++) {
        // the goal of a follower changes slowly: 5 times a second
        const v = S.vehicles[i];
        if (v.manual) { manualMove(v, h, pos.filter((_, j) => j !== i)); continue; }
        v.goalT = (v.goalT || 0) - h;
        if (spread && !v.leg && (v.planT = (v.planT || 0) - h) <= 0) { if (!planOwn(v, i)) v.planT = 1; }
        if (v.leg) { v.goal = ownLegGoal(v, h); v.goalT = 0; }
        else if (spread) { const st = v.state; v.goal = { g: st.p.slice(), look: st.look.slice(), lookR: st.lookR, face: null, mode: 'survey' }; }
        else if (!v.goal || v.goalT <= 0) { v.goal = followerGoal(v, i, h); v.goalT = 0.2; }
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
  // goTo(id, [x, z]): send one ROV to a point (the HUD minimap). The lead
  // (id 1) flies a leg there and the squad follows; another ROV leaves the
  // formation, flies there on its own path, looks round for 20 s and comes
  // back. false when no path plans.
  function goTo(id, xz) {
    const v = S.vehicles.find(q => q.id === id); if (!v || v.manual) return false;
    const y = ground(xz[0], xz[1]) + 3;
    const goal = pushOut(sdf, [xz[0], y, xz[1]], clear);
    if (v === S.vehicles[0]) { orbit = null; return planLeg([goal], 'goto', { label: 'going to the marked point' }) && (S.task.label = 'going to the marked point', true); }
    const path = marchPath(sdf, [v.state.p.slice(), goal], clear, { budget: 30000, step: 0.3 });
    if (!path || path.length < 0.5) return false;
    claim(S.vehicles.indexOf(v), null);
    v.leg = { path, s: 0, hold: 20, kind: 'goto', label: TASK_LABEL.goto };
    v.aim = goal;
    return true;
  }
  function ownLegGoal(v, dt) {
    const L = v.leg, st = v.state;
    const lag = len(sub(pathAt(L.path, L.s).p, st.p));
    L.s = Math.min(L.path.length, L.s + cruise * dt * clamp(1.6 - lag / 1.5, 0.1, 1));
    const g = pathAt(L.path, L.s);
    const end = L.s >= L.path.length - 0.05;
    if (end) { L.hold -= dt; if (L.hold <= 0) { v.leg = null; if (L.subject) claim(S.vehicles.indexOf(v), null); } }
    // stuck: no progress on the path for 8 s, plan again
    else if (L.s - (L.lastS || 0) > 0.25) { L.lastS = L.s; L.stuckT = 0; } else if ((L.stuckT = (L.stuckT || 0) + dt) > 8) v.leg = null;
    if (L.look) return { g: g.p, look: L.look, lookR: L.lookR, face: null, mode: 'inspect' };
    const fw = [Math.cos(st.yaw), -0.45, Math.sin(st.yaw)], fl = len(fw), dir = [fw[0] / fl, fw[1] / fl, fw[2] / fl];
    const hit = trace(sdf, st.p, dir, 12);
    return { g: g.p, look: [st.p[0] + dir[0] * hit, st.p[1] + dir[1] * hit, st.p[2] + dir[2] * hit], lookR: 1.6, face: g.t, mode: 'survey' };
  }
  // The task of each ROV for the HUD and the maps: { id, kind, label,
  // aim [x, y, z] | null (the leg end), subject (a colony key) | null }
  function tasks() {
    return S.vehicles.map((v, i) => {
      if (v.manual) return { id: v.id, kind: 'manual', label: TASK_LABEL.manual, aim: null, subject: null };
      if (i === 0) return { id: v.id, kind: S.task.kind, label: S.task.label, aim: v.aim || null, subject: S.task.kind === 'inspect' && S.task.target ? S.task.target.key ?? null : null };
      if (v.leg) return { id: v.id, kind: v.leg.kind || 'goto', label: v.leg.label || TASK_LABEL.goto, aim: v.aim || null, subject: v.leg.subject ?? null };
      if (!spread) return { id: v.id, kind: 'follow', label: v.state.mode === 'inspect' ? 'lighting the colony' : `following ROV ${S.vehicles[0].id}`, aim: null, subject: null };
      return { id: v.id, kind: 'plan', label: 'planning the next leg', aim: null, subject: null };
    });
  }
  // the share of the explored cells that two or more ROVs saw
  function overlap() {
    let multi = 0;
    for (const m of owners.values()) if (m & (m - 1)) multi++;
    return owners.size ? multi / owners.size : 0;
  }
  S.goTo = goTo;
  S.setManual = setManual; S.drive = drive;
  S.isManual = id => { const v = S.vehicles.find(q => q.id === id); return !!(v && v.manual); };
  S.manualOf = id => { const v = S.vehicles.find(q => q.id === id); return v && v.manual ? v.manual : null; };
  S.step = step; S.setCount = setCount;
  S.reset = (start, n = S.vehicles.length) => { place(start, n); setTask('frontier'); orbit = null; };
  S.tasks = tasks; S.overlap = overlap; S.owners = owners; S.claims = claims;
  Object.defineProperty(S, 'spread', { get: () => spread });
  S.trail = trail; S.visited = visited; S.chunksSeen = chunksSeen;
  Object.defineProperty(S, 'leader', { get: () => S.vehicles[0] });
  Object.defineProperty(S, 'leg', { get: () => leg });
  S.clear = clear;
  return S;
}

// ============================================================================
//  CORAL REEF  ·  tests/squad.test.mjs  ·  the ROV squad (node, no browser)
//    node tests/squad.test.mjs [--quick]
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "an infinite procedurally generated
//  seafloor/seamount terrain that is explored constantly by the ROV squad".
//  rov/squad.js on the real world field (world/field.js) and the real
//  corals (world/stream.js, phone-min budget, jobs on this thread):
//    clear ...... over a long run (3 vehicles, 30 steps per s) no vehicle is
//                 ever in the rock or the sand (rock metres > 0.3 m at every
//                 step) or nearer than 0.6 m to a coral particle
//    explore .... the squad keeps finding new ground: the 32 m chunks it
//                 has visited grow by 5 or more in every 10 minute window, and the
//                 leader travels on (no loop on one spot)
//    tasks ...... the leader does more than one kind of task (frontier,
//                 canyon, arch, inspect, ridge, ...)
//    follow ..... camera.js follow mode on the leader over the run: the eye
//                 never comes under CLEAR_HARD of the solid, and it is never
//                 stuck on rock (more than 3 m from its boom goal for 3 s)
//    determinism  one seed gives the same squad path
// ============================================================================
import { createWorld } from '../world/field.js';
import { createStreamer, WORLD_BUDGET, fineFor } from '../world/stream.js';
import { createPool } from '../world/pool.js';
import { worldPhysics } from '../world/physics.js';
import { createSquad } from '../rov/squad.js';
import { createExploreCamera, CLEAR_HARD } from '../camera.js';

const QUICK = process.argv.includes('--quick');
let pass = 0, fail = 0;
function ok(c, name, info = '') { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } }
async function drain(pool) { for (let i = 0; i < 1e6; i++) { const s = pool.stats; if (!s.queued && !s.running) return; await new Promise(r => setImmediate(r)); } }

const W = createWorld({ seed: 1, fine: fineFor(WORLD_BUDGET['phone-min'].c0) });
const SC = W.sdfScale;

// ── a run with the real corals ──────────────────────────────────────────────
async function run({ minutes, corals, camera, seed = 1, count = 3 }) {
  const pool = createPool({ makeWorker: null, delay: () => new Promise(r => setImmediate(r)) });
  let clock = 0, eye = [400, 0, 140];
  const st = corals ? createStreamer({ seed: 1, budget: WORLD_BUDGET['phone-min'], pool, view: {}, now: () => clock }) : null;
  const P = worldPhysics(W, st, { clear: 0.62, eye: () => eye });
  const start = [400, W.ground(400, 140) + 3, 140];
  const S = createSquad({ field: P, seed, count, clear: 0.62, start });
  let cam = null;
  if (camera) {
    cam = createExploreCamera({ rock: P, R: Infinity, maxDist: 120, eye: [start[0] - 4, start[1] + 2, start[2]], look: start });
    cam.follow(1, { snap: true });
  }
  const ctx = { getVehicle: id => { const v = S.vehicles.find(q => q.id === id); return v ? { pos: v.state.p, yaw: v.state.yaw } : null; } };
  const dt = 1 / 30, N = Math.round(minutes * 60 / dt);
  const out = { minRock: Infinity, minCoral: Infinity, camMin: Infinity, stuck: 0, stuckT: 0, windows: [], tasks: new Set(), path: [] };
  for (let i = 0; i < N; i++) {
    clock += dt * 1000;
    S.step(dt);
    for (const v of S.vehicles) {
      const p = v.state.p;
      const r = Math.min(W.sdfAll(p[0], p[1], p[2])) / SC;
      if (r < out.minRock) out.minRock = r;
      if (st) { const c = st.coralDist(p[0], p[1], p[2]); if (c < out.minCoral) out.minCoral = c; }
    }
    out.tasks.add(S.task.kind);
    if (cam) {
      cam.update(dt, ctx);
      const m = Math.min(W.sdfAll(...cam.eye) / SC, st ? (st.coralDist(...cam.eye) - 0.2) * 1.41 : Infinity);
      if (m < out.camMin) out.camMin = m;
      const far = Math.hypot(cam.eye[0] - cam.goal.eye[0], cam.eye[1] - cam.goal.eye[1], cam.eye[2] - cam.goal.eye[2]) > 3;
      out.stuckT = far ? out.stuckT + dt : 0;
      if (out.stuckT > 3) { out.stuck++; out.stuckT = 0; }
    }
    // the streamer follows the squad (the page: the eye), once a second
    if (st && i % 30 === 0) {
      eye = S.vehicles[0].state.p.slice();
      st.update(eye, [eye]);
      await drain(pool);
    }
    if (i % 300 === 0) out.path.push(S.vehicles[0].state.p.map(v => Math.round(v * 100) / 100));
    if ((i + 1) % Math.round(600 / dt) === 0) out.windows.push(S.stats.chunks);
  }
  out.stats = Object.assign({}, S.stats);
  out.coralShown = st ? st.stats.coralShown : 0;
  out.colonies = S.stats.colonies;
  if (st) { st.dispose(); await drain(pool); }
  return out;
}

const t0 = Date.now();
const A = await run({ minutes: QUICK ? 3 : 6, corals: true, camera: true });
console.log(`     run with corals: ${(Date.now() - t0) / 1000 | 0} s wall, ${A.stats.distance.toFixed(0)} m, ${A.stats.chunks} chunks, ${A.coralShown} coral chunks shown, ${A.colonies} colonies seen, tasks ${[...A.tasks].join(' ')}`);
ok(A.minRock > 0.3, 'clear: no vehicle comes into the rock or the sand (3 vehicles, every step)', `nearest ${A.minRock.toFixed(2)} m (field / sdfScale)`);
ok(A.minCoral > 0.6, 'clear: no vehicle comes nearer than 0.6 m to a coral particle', `nearest ${A.minCoral.toFixed(2)} m, ${A.coralShown} coral chunks on the way`);
ok(A.camMin >= CLEAR_HARD - 0.02, 'follow: the chase camera eye stays in open water', `nearest ${A.camMin.toFixed(2)} m (CLEAR_HARD ${CLEAR_HARD})`);
ok(A.stuck === 0, 'follow: the chase camera is never stuck on rock (3 m from its goal for 3 s)', `${A.stuck} stuck spells`);

const t1 = Date.now();
const Bm = QUICK ? 20 : 40;
const B = await run({ minutes: Bm, corals: false, camera: false });
console.log(`     run on rock: ${(Date.now() - t1) / 1000 | 0} s wall, ${Bm} min, ${B.stats.distance.toFixed(0)} m, ${B.stats.legs} legs, chunks per 10 min ${B.windows.join(' -> ')}, tasks ${[...B.tasks].join(' ')}`);
ok(B.minRock > 0.3, 'clear: no vehicle comes into the rock over the long run', `nearest ${B.minRock.toFixed(2)} m`);
// at 0.55 m/s with stops to inspect, a window of 10 min is about 250 m:
// at least 5 new chunks of 32 m in each window
const grows = B.windows.every((w, i) => w - (i ? B.windows[i - 1] : 0) >= 5);
ok(B.windows.length >= 2 && grows, 'explore: the visited chunks grow by 5 or more in every 10 minute window', B.windows.join(' -> '));
const first = B.path[0], lastP = B.path[B.path.length - 1];
ok(Math.hypot(lastP[0] - first[0], lastP[2] - first[2]) > 150, 'explore: the leader travels on (no loop on one spot)', `${Math.hypot(lastP[0] - first[0], lastP[2] - first[2]).toFixed(0)} m from the start`);
ok(new Set([...A.tasks, ...B.tasks]).size >= 3, 'tasks: the leader does several kinds of task', [...new Set([...A.tasks, ...B.tasks])].join(', '));

// ── determinism ─────────────────────────────────────────────────────────────
{
  const a = await run({ minutes: 1, corals: false }), b = await run({ minutes: 1, corals: false }), c = await run({ minutes: 1, corals: false, seed: 2 });
  ok(JSON.stringify(a.path) === JSON.stringify(b.path), 'determinism: one seed gives the same squad path');
  ok(JSON.stringify(a.path) !== JSON.stringify(c.path), 'determinism: a new seed gives a new path');
}

console.log(`squad: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

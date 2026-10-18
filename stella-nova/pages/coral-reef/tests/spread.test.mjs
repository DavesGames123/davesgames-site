// ============================================================================
//  CORAL REEF  ·  tests/spread.test.mjs  ·  the squad spreads out (node)
//    node tests/spread.test.mjs [--quick]
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "the ROV's neeed to run to explore different
//  areas", "the rov's really need to be spreading out into different
//  areas", "each of them need to be looking at a different thing as they
//  explore". rov/squad.js on the real world field (rock only), 3 ROVs, the
//  same seed and start, spread: false (the old formation) against spread
//  (the default), with a set of test colonies on a 26 m lattice:
//    overlap .... the share of the explored cells that two or more ROVs
//                 saw is far lower than with the formation
//    area ....... the explored cells grow faster than with the formation
//    subject .... two ROVs look at the same colony in almost no step
//    leash ...... no ROV goes farther than the leash (+ 20 m) from the
//                 centroid, and pairs come under 2 m in almost no step
//    clear ...... no ROV comes into the rock (field / sdfScale > 0.3 m)
//    tasks ...... the ROVs have tasks with their own labels and aims
// ============================================================================
import { createWorld } from '../world/field.js';
import { worldPhysics } from '../world/physics.js';
import { createSquad } from '../rov/squad.js';
import { SPECIES } from '../reef.js';

const QUICK = process.argv.includes('--quick');
let pass = 0, fail = 0;
function ok(c, name, info = '') { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } }

const W = createWorld({ seed: 1 });
const SC = W.sdfScale;
let R0 = null;
for (let j = -30; j <= 30; j++) for (let i = -30; i <= 30; i++) {
  const x = i * 500, z = j * 500;
  if (W.regionAt(x, z).id !== 'reef') continue;
  const s = W.habitat(x, z) - Math.hypot(i, j) * 0.002;
  if (!R0 || s > R0.s) R0 = { s, x, z };
}
const SP = Object.keys(SPECIES)[0];
// test colonies: one in 2 of the 26 m lattice cells near a point
function withColonies(P) {
  const cache = new Map();
  let at = [R0.x, R0.z];
  const cols = () => {
    const out = [], ci = Math.floor(at[0] / 26), cj = Math.floor(at[1] / 26);
    for (let j = cj - 2; j <= cj + 2; j++) for (let i = ci - 2; i <= ci + 2; i++) {
      const k = `${i},${j}`;
      if (!cache.has(k)) {
        const h = Math.abs(Math.sin(i * 127.1 + j * 311.7) * 43758.5) % 1;
        const x = i * 26 + 13, z = j * 26 + 13;
        cache.set(k, h < 0.5 ? { key: 'c' + k, center: [x, W.ground(x, z) + 1.2, z], radius: 1.4, size: 3.5, id: SP } : null);
      }
      if (cache.get(k)) out.push(cache.get(k));
    }
    return out;
  };
  return { F: Object.assign(Object.create(P), { colonies: cols }), setAt: (x, z) => { at = [x, z]; } };
}

function run({ minutes, spread }) {
  const P = worldPhysics(W, null, { clear: 0.62 });
  const C = withColonies(P);
  const start = [R0.x, W.ground(R0.x, R0.z) + 3, R0.z];
  const S = createSquad({ field: C.F, seed: 1, count: 3, clear: 0.62, start, spread });
  const dt = 1 / 30, N = Math.round(minutes * 60 / dt);
  const out = { minRock: Infinity, steps: 0, same: 0, near: 0, leashMax: 0, labels: new Set(), aims: 0, cells10: [] };
  for (let i = 0; i < N; i++) {
    S.step(dt);
    const c = [0, 0];
    for (const v of S.vehicles) { c[0] += v.state.p[0] / 3; c[1] += v.state.p[2] / 3; }
    if (i % 15 === 0) C.setAt(c[0], c[1]);
    if (i % 3) continue;
    out.steps++;
    const T = S.tasks();
    const subj = T.map(t => t.subject).filter(x => x != null);
    if (new Set(subj).size < subj.length) out.same++;
    for (const t of T) { out.labels.add(t.label); if (t.aim) out.aims++; }
    for (let a = 0; a < 3; a++) {
      const p = S.vehicles[a].state.p;
      out.minRock = Math.min(out.minRock, W.sdfAll(p[0], p[1], p[2]) / SC);
      out.leashMax = Math.max(out.leashMax, Math.hypot(p[0] - c[0], p[2] - c[1]));
      for (let b = a + 1; b < 3; b++) { const q = S.vehicles[b].state.p; if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 2) out.near++; }
    }
    if ((i + 3) % Math.round(300 / dt) < 3) out.cells10.push(S.stats.cells);
  }
  out.overlap = S.overlap(); out.cells = S.stats.cells; out.colonies = S.stats.colonies;
  return out;
}

const minutes = QUICK ? 10 : 20;
const t0 = Date.now();
const A = run({ minutes, spread: false });
const B = run({ minutes, spread: true });
console.log(`     ${minutes} min, 3 ROVs, ${(Date.now() - t0) / 1000 | 0} s wall`);
console.log(`     formation: overlap ${(A.overlap * 100).toFixed(1)} %, cells ${A.cells}, per 5 min ${A.cells10.join(' ')}`);
console.log(`     spread:    overlap ${(B.overlap * 100).toFixed(1)} %, cells ${B.cells}, per 5 min ${B.cells10.join(' ')}`);
ok(B.overlap < A.overlap * 0.5, 'overlap: two or more ROVs saw a much smaller share of the cells', `${(A.overlap * 100).toFixed(1)} % -> ${(B.overlap * 100).toFixed(1)} %`);
ok(B.cells > A.cells * 1.5, 'area: the squad explores more cells in the same time', `${A.cells} -> ${B.cells} cells of 12 m`);
ok(B.same / B.steps < 0.01, 'subject: two ROVs look at the same colony in under 1 % of the steps', `${B.same} of ${B.steps} steps (formation: subjects are not split)`);
ok(B.leashMax < 180 + 20, 'leash: no ROV is farther than the leash (+ 20 m) from the centroid', `max ${B.leashMax.toFixed(0)} m`);
ok(B.near / (B.steps * 3) < 0.02, 'separation: ROV pairs come under 2 m in under 2 % of the samples', `${B.near} of ${B.steps * 3}`);
ok(B.minRock > 0.3, 'clear: no ROV comes into the rock', `nearest ${B.minRock.toFixed(2)} m`);
const own = [...B.labels].filter(l => /surveying (the )?[NSEW]{1,2}|inspecting a|climbing the|dropping down the/.test(l));
ok(own.length >= 3 && B.aims > B.steps, 'tasks: the ROVs have their own labels and aims', own.slice(0, 5).join(' | '));
console.log(`spread: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

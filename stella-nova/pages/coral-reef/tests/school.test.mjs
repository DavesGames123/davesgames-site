// ============================================================================
//  CORAL REEF  ·  tests/school.test.mjs  ·  the schools and squid pods move
//  as animals, not as an array (fauna/sim.js)
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "pods of squid and fish need to swim more
//  naturally not all of them in an array". From seed 7, real spawn groups run
//  for T s in the sim. Each school of 10 or more is then checked:
//    - no lattice: the nearest-neighbour distance CV is high, and no two
//      nearest-neighbour offsets are the same to 1 cm
//    - the members change places (the offsets from the centre change)
//    - the headings and the speeds spread; the tail phases spread
//    - the school holds together (the RMS radius has a bound)
//    - the crawlers (the user: "isopods are freaking out on the seaflooor")
//      turn at most 0.5 rad/s, never turn in place, have no vertical
//      jitter and stay on the ground
//    - no swimmer is in the rock; the step cost of the desktop load is in
//      budget
//  node stella-nova/pages/coral-reef/tests/school.test.mjs
// ============================================================================
import { spawnChunk, gridFrom } from '../fauna/spawn.js';
import { createSim } from '../fauna/sim.js';
import { ANIM } from '../fauna/species.js';
import { FAUNA_BUDGET } from '../fauna/budget.js';
import { createWorld } from '../world/field.js';

let pass = 0, fail = 0;
function ok(c, name, info = '') { if (c) { pass++; console.log(`ok   ${name}  ${info}`); } else { fail++; console.log(`FAIL ${name}  ${info}`); } }

const W = createWorld({ seed: 7 }), B = FAUNA_BUDGET.desktop;
const sim = createSim({ sdf: W.sdfAll, sdfScale: W.sdfScale, maxAgents: B.maxAgents, simEvery: B.simEvery, seed: 7 });
// chunks at many depths: shallow reef schools, twilight lanternfish, squid
const isCeph = G => G.sp.anim === ANIM.CEPH || G.sp.anim === 'CEPH';
let loaded = 0, pods = 0, fishC = 0, isoC = 0;
for (let k = 0; k < 1200 && sim.freeSlots > 200 && (pods < 3 || fishC < 12 || isoC < 2); k++) {
  const i = ((k * 37) % 300) - 150, j = ((k * 53) % 300) - 150;
  const c = spawnChunk({ W, seed: 7, i, j, budget: B });
  const big = c.groups.filter(g => g.sp.habit === 'school' && g.members.length >= 10);
  const pod = big.some(isCeph), iso = c.groups.some(g => g.sp.family === 'isopod' && g.sp.habit === 'crawl');
  if (iso && isoC < 2) isoC++;
  else if (!big.length || (pod ? pods >= 3 : fishC >= 12)) continue;
  else if (pod) pods++; else fishC++;
  const grid = gridFrom(c.grid);
  for (const g of c.groups) sim.addGroup(g, c.key, grid);
  loaded++;
}
const schools = [...sim.groups.values()].filter(G => G.habit === 'school' && G.members.length >= 10);
console.log(`# ${loaded} chunks, ${sim.count} agents, ${schools.length} schools (${schools.filter(isCeph).length} squid pods)`);

const crawl = [...sim.groups.values()].filter(G => G.habit === 'crawl').flatMap(G => Array.from(G.members, i => [i, G]));
const cY = Float64Array.from(crawl, ([i]) => sim.py[i]), cY1 = cY.slice(), cA = Float64Array.from(crawl, ([i]) => sim.yaw[i]);
const isoN = crawl.filter(([, G]) => G.sp.family === 'isopod').length;
console.log(`# ${loaded} chunks, ${crawl.length} crawlers (${isoN} giant isopods)`);
let turnMax = 0, jerkMax = 0, offMax = 0, spinIdle = 0, walked = 0;
const T = 60, dt = 1 / 30, rel0 = new Map();
let inside = 0, ms = 0, steps = 0;
for (let s = 0; s < T / dt; s++) {
  const t0 = performance.now();
  sim.step(dt, { t: s * dt, rovs: [], current: [0.1, 0.05] });
  if (s > 30) { ms += performance.now() - t0; steps++; }
  crawl.forEach(([i, G], q) => {
    let da = sim.yaw[i] - cA[q]; da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
    const v = Math.hypot(sim.vx[i], sim.vz[i]);
    if (s > 90) { turnMax = Math.max(turnMax, Math.abs(da) / dt); jerkMax = Math.max(jerkMax, Math.abs(sim.py[i] - 2 * cY[q] + cY1[q])); if (v === 0 && Math.abs(da) > 1e-6) spinIdle++; }
    if (s > 90) offMax = Math.max(offMax, Math.abs(sim.py[i] - G.grid.ground(sim.px[i], sim.pz[i])));
    walked += v * dt;
    cY1[q] = cY[q]; cY[q] = sim.py[i]; cA[q] = sim.yaw[i];
  });
  if (s === Math.round(40 / dt)) for (const G of schools) rel0.set(G.id, Array.from(G.members, i => [sim.px[i] - G.centre[0], sim.py[i] - G.centre[1], sim.pz[i] - G.centre[2]]));
  if (s % 15 === 0) for (const G of sim.groups.values()) {
    if (G.benthic || G.onCoral) continue;
    for (const i of G.members) if (W.sdfAll(sim.px[i], sim.py[i], sim.pz[i]) / W.sdfScale < 0) inside++;
  }
}

const stat = a => { const m = a.reduce((s, v) => s + v, 0) / a.length; return [m, Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)]; };
const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
const rows = [];
for (const G of schools) {
  const M = [...G.members], n = M.length;
  const nn = [], offs = new Set(), pairs = new Set();
  let rep = 0;
  for (const i of M) {
    let bd = Infinity, bj = -1;
    for (const j of M) { if (j === i) continue; const d = Math.hypot(sim.px[i] - sim.px[j], sim.py[i] - sim.py[j], sim.pz[i] - sim.pz[j]); if (d < bd) { bd = d; bj = j; } }
    nn.push(bd);
    if (pairs.has(Math.min(i, bj) * 65536 + Math.max(i, bj))) continue;      // a mutual pair counts once
    pairs.add(Math.min(i, bj) * 65536 + Math.max(i, bj));
    const s = Math.sign(sim.px[bj] - sim.px[i]) || 1;
    const key = [sim.px[bj] - sim.px[i], sim.py[bj] - sim.py[i], sim.pz[bj] - sim.pz[i]].map(v => Math.round(v * s * 100)).join(',');
    if (offs.has(key)) { rep++; if (process.env.DBG) console.log("# rep", G.sp.id, key, i, bj, sim.py[i]); } offs.add(key);
  }
  const [nm, ns] = stat(nn);
  let hx = 0, hz = 0; const sp = [];
  for (const i of M) { hx += Math.sin(sim.yaw[i]); hz += Math.cos(sim.yaw[i]); sp.push(Math.hypot(sim.vx[i], sim.vy[i], sim.vz[i])); }
  const Rh = Math.hypot(hx, hz) / n, [sm, ss] = stat(sp), [, ps] = stat(M.map(i => sim.phase[i]));
  const r2 = M.map(i => (sim.px[i] - G.centre[0]) ** 2 + (sim.py[i] - G.centre[1]) ** 2 + (sim.pz[i] - G.centre[2]) ** 2);
  const rms = Math.sqrt(r2.reduce((s, v) => s + v, 0) / n);
  const r0 = rel0.get(G.id), moved = med(M.map((i, q) => Math.hypot(sim.px[i] - G.centre[0] - r0[q][0], sim.py[i] - G.centre[1] - r0[q][1], sim.pz[i] - G.centre[2] - r0[q][2])));
  rows.push({ sm, id: G.sp.id, n, ceph: isCeph(G), cv: ns / nm, rep, Rh, scv: ss / Math.max(1e-6, sm), ps, rms, moved, nnm: nm });
}
if (process.env.DBG) for (const r of rows) console.log("#", r.id, r.n, r.cv.toFixed(2), r.rep, r.Rh.toFixed(2), r.scv.toFixed(2), r.rms.toFixed(1), r.moved.toFixed(2), r.nnm.toFixed(2), r.sm.toFixed(3), schools.find(G => G.sp.id === r.id).sp.speed);
const G0 = id => { for (const G of sim.groups.values()) if (G.sp.id === id) return G.sp.speed; };
const fishR = rows.filter(r => !r.ceph), cephR = rows.filter(r => r.ceph);
const f = (a, k) => a.map(r => r[k]);
const show = a => `min ${Math.min(...a).toFixed(2)} med ${med(a).toFixed(2)} max ${Math.max(...a).toFixed(2)}`;
ok(rows.length >= 6 && cephR.length >= 1, 'schools and squid pods to test', `${fishR.length} fish schools, ${cephR.length} squid pods`);
ok(Math.min(...f(rows, 'cv')) > 0.12 && med(f(rows, 'cv')) > 0.4, 'no lattice: the nearest-neighbour distance CV > 0.12 (median > 0.4)', show(f(rows, 'cv')));
ok(Math.max(...rows.map(r => r.rep / r.n)) <= 0.03, 'no repeated nearest-neighbour offsets (1 cm, at most 3 % of a school)', `max ${Math.max(...rows.map(r => r.rep))} in a school`);
ok(Math.min(...rows.map(r => r.moved / r.nnm)) > 0.3, 'the members change places in 20 s (median offset change / NN distance > 0.3)', show(rows.map(r => r.moved / r.nnm)));
ok(med(f(fishR, 'Rh')) < 0.97 && med(f(fishR, 'scv')) > 0.08, 'fish: the headings and speeds spread (median heading R < 0.97, speed CV > 0.08)', `R ${show(f(fishR, 'Rh'))}; speed CV ${show(f(fishR, 'scv'))}`);
ok(Math.max(...f(cephR, 'Rh')) < 0.9 && med(f(cephR, 'scv')) > 0.15, 'squid: loose headings and burst speeds (R < 0.9, median speed CV > 0.15)', `R ${show(f(cephR, 'Rh'))}; speed CV ${show(f(cephR, 'scv'))}`);
ok(Math.min(...f(rows, 'ps')) > 0.15, 'the tail phases spread (std > 0.15 of a cycle)', show(f(rows, 'ps')));
ok(Math.max(...rows.map(r => r.rms / (3 + Math.sqrt(r.n) * 0.6))) < 2.5, 'the schools hold together (RMS radius < 2.5 x the spawn spread)', show(rows.map(r => r.rms / (3 + Math.sqrt(r.n) * 0.6))));
ok(isoN > 0 && crawl.length > 20 && walked > 0, 'crawlers to test, giant isopods with them', `${crawl.length} crawlers, ${isoN} isopods, ${walked.toFixed(1)} m walked in all`);
ok(turnMax <= 0.51 && spinIdle === 0, 'crawlers turn slowly (<= 0.5 rad/s) and never spin in place', `max ${turnMax.toFixed(3)} rad/s, ${spinIdle} idle turns`);
ok(jerkMax < 2e-3 && offMax < 0.05, 'crawlers: no vertical jitter, never off the ground', `max height 2nd difference ${(jerkMax * 1000).toFixed(3)} mm/frame, max ground gap ${(offMax * 100).toFixed(2)} cm`);
ok(inside === 0, 'no swimmer inside the rock', `${inside} hits, ${sim.stats.rockHits} turned back`);
ok(ms / steps < 4, `the step of ${sim.count} agents is in budget (< 4 ms)`, `${(ms / steps).toFixed(2)} ms/step`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// ============================================================================
//  CORAL REEF  ·  tests/cables.test.mjs  ·  the ship, cage and tethers (node)
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "what happened to the cables attached to
//  ROV/s ?". rov/cables.js on the real world field (world/field.js, rock
//  and sand) with the real squad (rov/squad.js, 4 ROVs): a long run with
//  floating-origin shifts. Checks: the ropes are continuous (no jump of a
//  point from one step to the next, the tubes in render space plus the
//  origin are the world ropes), the clearance from the rock, no cable in
//  an ROV body, the cage over the squad, the ship over the cage, and the
//  cost per device profile. The coral term of the page solid (P.coralDist)
//  is not in this run (no streamer).
// ============================================================================
import * as THREE from '../../../vendor/three@0.160.0/build/three.module.js';
import { createWorld } from '../world/field.js';
import { WORLD_BUDGET, fineFor } from '../world/stream.js';
import { worldPhysics } from '../world/physics.js';
import { createSquad } from '../rov/squad.js';
import { createCables, cableCost, CABLE_Q, BODY_R, CAGE_SURF } from '../rov/cables.js';

let pass = 0, fail = 0;
function ok(c, name, info = '') { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } }
const f3 = v => (+v).toFixed(3);

const W = createWorld({ seed: 1, fine: fineFor(WORLD_BUDGET['phone-min'].c0) });
const SC = W.sdfScale;
const metric = (x, y, z) => W.sdfAll(x, y, z) / SC;
// a reef start (the squad test does the same)
let R0 = null;
for (let j = -30; j <= 30; j++) for (let i = -30; i <= 30; i++) { const x = i * 500, z = j * 500; if (W.regionAt(x, z).id !== 'reef') continue; const sc = W.habitat(x, z) - Math.hypot(i, j) * 0.002; if (!R0 || sc > R0.s) R0 = { s: sc, x, z }; }
const P = worldPhysics(W, null, { clear: 0.62, eye: () => [R0.x, 0, R0.z] });
const start = [R0.x, W.ground(R0.x, R0.z) + 3, R0.z];
const S = createSquad({ field: P, seed: 3, count: 4, clear: 0.62, start });

let origin = [Math.round(R0.x / 1024) * 1024, Math.round(R0.z / 1024) * 1024];
const scene = new THREE.Scene();
const K = createCables(THREE, { scene, sdf: metric, profile: 'desktop', surfaceY: 55, origin: () => origin });
const rovsOf = () => S.vehicles.map(v => ({ id: v.id, p: v.state.p.slice(), term: [v.state.p[0], v.state.p[1] + 0.62, v.state.p[2]] }));

const dt = 1 / 30, N = Math.round((process.argv.includes('--quick') ? 1 : 4) * 60 / dt);
let maxMove = 0, minRock = Infinity, minCurve = Infinity, minBody = Infinity, shifts = 0, renderErr = 0, cageOver = Infinity, shipOff = 0, ms = 0;
let prev = null;
for (let s = 0; s < N; s++) {
  S.step(dt);
  // the floating origin: a 1024 m step every 40 s (the page: every 4 km)
  if (s > 0 && s % 1200 === 0) { origin = [origin[0] + 1024, origin[1] - 1024]; shifts++; }
  const R = rovsOf();
  const t0 = performance.now();
  K.update(dt, R);
  ms += performance.now() - t0;
  const ropes = K.sim.ropes;
  if (s < 30) { prev = ropes.map(r => Float64Array.from(r.rope.points)); continue; }   // settling
  ropes.forEach((r, ri) => {
    const Pt = r.rope.points, n = r.rope.count;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      maxMove = Math.max(maxMove, Math.hypot(Pt[o] - prev[ri][o], Pt[o + 1] - prev[ri][o + 1], Pt[o + 2] - prev[ri][o + 2]));
      if (i > 0 && i < n - 1 && (s & 7) === 0) {
        minRock = Math.min(minRock, metric(Pt[o], Pt[o + 1], Pt[o + 2]));
        for (const v of R) { if (r.id === v.id && i < 2) continue; minBody = Math.min(minBody, Math.hypot(Pt[o] - v.p[0], Pt[o + 1] - v.p[1], Pt[o + 2] - v.p[2])); }
      }
    }
    prev[ri].set(Pt);
    if ((s & 63) === 0) {
      // the tube curve (render space) plus the origin is the world rope
      const T = K.tubes[ri].tube, C = T.curve, L = T.rings;
      renderErr = Math.max(renderErr, Math.hypot(C[0] + origin[0] - Pt[0], C[1] - Pt[1], C[2] + origin[1] - Pt[2]), Math.hypot(C[(L - 1) * 3] + origin[0] - Pt[(n - 1) * 3], C[(L - 1) * 3 + 2] + origin[1] - Pt[(n - 1) * 3 + 2]));
      for (let k = 3; k < L - 3; k += 2) {
        const x = C[k * 3] + origin[0], y = C[k * 3 + 1], z = C[k * 3 + 2] + origin[1];
        minCurve = Math.min(minCurve, metric(x, y, z));
        if (r.kind === 'excursion') for (const v of R) { if (v.id === r.id && Math.hypot(x - v.p[0], y - v.p[1], z - v.p[2]) < 1.5 && k < 12) continue; minBody = Math.min(minBody, Math.hypot(x - v.p[0], y - v.p[1], z - v.p[2]) + 0.03); }
      }
    }
  });
  const top = Math.max(...R.map(v => v.p[1]));
  cageOver = Math.min(cageOver, Math.min(K.sim.cage[1] - top, 55 - CAGE_SURF - top));
  shipOff = Math.max(shipOff, Math.hypot(K.sim.ship[0] - K.sim.cage[0], K.sim.ship[2] - K.sim.cage[2]));
}
const travel = Math.hypot(S.vehicles[0].state.p[0] - start[0], S.vehicles[0].state.p[2] - start[2]);
console.log(`cables: ${N} steps (${(N * dt / 60).toFixed(1)} min), ${shifts} origin shifts, lead travel ${travel.toFixed(0)} m, ${K.sim.ropes.length} ropes, ${f3(ms / N)} ms a step (desktop), ${K.sim.jumps} resets`);
ok(K.sim.ropes.length === 5 && K.sim.ropes.filter(r => r.kind === 'excursion').length === 4, 'cables: one umbilical and 4 excursion tethers for 4 ROVs');
ok(shifts >= 2 && maxMove < 1.5 && K.sim.jumps === 0, 'cables: continuous over the run and across the origin shifts (no point jumps)', `largest point move in one step ${f3(maxMove)} m`);
ok(renderErr < 0.01, 'cables: the tubes in render space plus the origin are the world ropes', `${renderErr.toExponential(1)} m`);
ok(minRock > -0.05 && minCurve > -0.06, 'cables: the ropes and the tube curve stay out of the rock', `min sdf rope ${f3(minRock)} m, curve ${f3(minCurve)} m`);
ok(minBody > BODY_R - 0.1, 'cables: no cable through an ROV body', `nearest rope point or curve to a body centre ${f3(minBody)} m (body ${BODY_R} m)`);
ok(cageOver > -0.5, 'cables: the cage hangs over the squad (or under the surface in the shallows)', `${f3(cageOver)} m`);
ok(shipOff < 60, 'cables: the ship follows the cage', `largest offset ${shipOff.toFixed(1)} m`);
ok(ms / N < 4, 'cables: the step of the desktop cables in the frame budget', `${f3(ms / N)} ms`);

// a region jump (behind the fade): ropes reset, then continuous again
{
  const R = rovsOf().map(v => ({ ...v, p: [v.p[0] + 3000, v.p[1], v.p[2]], term: [v.term[0] + 3000, v.term[1], v.term[2]] }));
  K.update(dt, R);
  const c = K.sim.cage;
  ok(K.sim.jumps === 1 && Math.abs(c[0] - R.reduce((a, v) => a + v.p[0], 0) / R.length) < 1, 'cables: a region jump resets the ship, the cage and the ropes', `cage x ${c[0].toFixed(1)}`);
}

// cost per profile: phones get the low tube and fewer points
{
  const ids = ['desktop', 'laptop-low', 'phone', 'phone-min'], C = ids.map(cableCost);
  console.log('cables cost: ' + ids.map((id, i) => `${id} ${C[i].points} pts ${C[i].tris} tris`).join(', '));
  ok(C.every((c, i) => !i || (c.tris < C[i - 1].tris && c.points < C[i - 1].points)), 'cables cost: fewer points and triangles on each smaller profile');
  ok(CABLE_Q.desktop.n === 56 && CABLE_Q.desktop.rings === 240 && CABLE_Q.phone.n === 30 && CABLE_Q.phone.rings === 96 && C[2].tris <= 8000, 'cables cost: 56 points / 240 rings on desktop, 30 / 96 on phones, under 8k triangles on a phone');
  const Kp = createCables(THREE, { scene: new THREE.Scene(), sdf: metric, profile: 'phone-min', origin: () => origin });
  const R = rovsOf();
  Kp.update(dt, R);
  const tris = Kp.tubes.reduce((a, t) => a + t.mesh.geometry.index.count / 3, 0);
  ok(Kp.tubes.length === 5 && tris === cableCost('phone-min').tris, 'cables cost: the phone-min meshes have the budget triangles', `${tris}`);
  Kp.setEnabled(false);
  ok(!Kp.group.visible, 'cables: off hides the cables');
  Kp.dispose();
}
K.dispose();
console.log(`cables: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

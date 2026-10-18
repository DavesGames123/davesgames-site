// ============================================================================
//  CORAL REEF  ·  larger reef structures (node, no browser)
//                 node tests/size.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "we should be able to simulate much large
//  growing coral reef structures these are pathetically small for the size
//  of seamount we're workign iwht".
//    reef ...... the phone reef on the real rock (the reef worker, grown
//                to its end): colony heights and extents, against the old
//                page (248ce90b: height p90 2.19 m, extent max 2.27 m on
//                the same profile), the triangle budget and the worker
//                memory
//    field ..... rov/coral-field.js: the coral term of the ROV field is
//                `clear` at clearM from a particle and large far away
//    rov ....... an ROV that inspects a 6 m colony and one on a survey
//                keep about 1 m from every coral particle (rov/index.js
//                adds the coral term to the rock field)
// ============================================================================
import * as THREE from '../../../vendor/three@0.160.0/build/three.module.js';
import { createRock } from '../rock/index.js';
import { createReefRunner } from '../mesh-worker.js';
import { createReefMirror, SPECIES } from '../reef.js';
import { profileFor, reefBudget } from '../budget.js';
import { createCoralField } from '../rov/coral-field.js';
import { createROVs } from '../rov/index.js';
import { createStubRock } from '../rov/stub-rock.js';
import { rng } from '../rov/pilot.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name} ${info}`); } };
const f2 = v => (+v).toFixed(2);
const pc = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };

// ── the phone reef on the real rock ─────────────────────────────────────────
{
  const P = profileFor('phone'), B = reefBudget(P, P.reef);
  const rock = createRock({ seed: 1, radius: 30, quality: 'low' });
  const q = [];
  let idle = false;
  const run = createReefRunner({ post(m) { if (m.type === 'idle') idle = true; }, makeRock: () => rock, timers: { set: f => { q.push(f); return 1; }, clear() {} } });
  const t0 = performance.now();
  await run.onMessage({ type: 'init', seed: 1, quality: P.reef, radius: 30, sites: rock.sampleSurface(B.colonies * 24), budget: B, rate: Infinity, rockQuality: 'low' });
  await run.onMessage({ type: 'view', points: [[0, 6, 18]] });
  for (let i = 0; i < 2e6 && !(idle && run.reef.done()); i++) { const f = q.shift(); if (!f) break; f(); }
  const s = (performance.now() - t0) / 1000;
  const R = run.reef, st = run.mesher.stats(), mu = process.memoryUsage();
  const H = [], E = [];
  for (const c of R.colonies) {
    let top = -Infinity, bot = c.base[1], x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const g of c.ids) { top = Math.max(top, R.py[g]); bot = Math.min(bot, R.py[g]); x0 = Math.min(x0, R.px[g]); x1 = Math.max(x1, R.px[g]); z0 = Math.min(z0, R.pz[g]); z1 = Math.max(z1, R.pz[g]); }
    H.push(top - bot); E.push(Math.max(x1 - x0, z1 - z0));
  }
  console.log(`     phone reef: ${R.colonies.length} colonies, ${R.count} particles, height p50 ${f2(pc(H, 0.5))} p90 ${f2(pc(H, 0.9))} max ${f2(Math.max(...H))} m, extent p50 ${f2(pc(E, 0.5))} p90 ${f2(pc(E, 0.9))} max ${f2(Math.max(...E))} m, ${st.tris} tris (${st.trisFine} fine), ${st.polyps} polyps, ${f2(s)} s, ${Math.round(mu.arrayBuffers / 1048576)} MB array buffers`);
  ok(R.done() && pc(H, 0.9) > 1.5 * 2.19, 'reef: the colony height p90 is over 1.5 x the old page (2.19 m)', `${f2(pc(H, 0.9))} m`);
  ok(Math.max(...E) > 2 * 2.27, 'reef: the widest colony is over 2 x the old page (2.27 m)', `${f2(Math.max(...E))} m`);
  ok(st.tris < B.tris * 1.15, 'reef: the coral triangles stay in the phone budget (+15 %)', `${st.tris} of ${B.tris}`);
  ok(R.count <= B.particles && mu.arrayBuffers < 160 * 1048576, 'reef: phone particles in budget, array buffers under 160 MB', `${R.count} of ${B.particles}, ${Math.round(mu.arrayBuffers / 1048576)} MB`);
  ok(s < 90, 'reef: the phone reef grows and meshes in under 90 s in node (rate Infinity)', `${f2(s)} s`);
  ok(Object.values(SPECIES).every(sp => sp.size[1] >= 4.5), 'reef: every species can grow to 4.5 m or more', Object.entries(SPECIES).map(([k, v]) => `${k} ${v.size[1]}`).join(', '));
}

// ── the coral term of the ROV field ─────────────────────────────────────────
// a mirror with one colony: a ball of particles of radius 3 m
function ballReef(c, r, n, seed = 1) {
  const M = createReefMirror(), rand = rng(seed), data = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    let x, y, z; do { x = rand() * 2 - 1; y = rand(); z = rand() * 2 - 1; } while (x * x + y * y + z * z > 1);
    data.set([c[0] + x * r, c[1] + y * r, c[2] + z * r, 0, i ? 0 : -1, 0, c[1], i], i * 8);
  }
  M.setColonies([{ k: 0, id: 'staghorn', base: c.slice(), normal: [0, 1, 0], plane: [1, 0], size: r * 2, cap: n, stalk: 3, count: n }]);
  M.addParticles(0, data);
  M.colonies[0].top = c[1] + r; M.colonies[0].ext = r;
  return M;
}
{
  const C = createCoralField({ radius: 30, ymin: -6, ymax: 18, clear: 0.92, clearM: 1.3 });
  ok(C.dist(0, 0, 0) > 1.5, 'field: no coral, a large value');
  const M = ballReef([2, 0, 3], 0.2, 40);
  C.sync(M);
  const at = C.dist(2, 0.1, 3), near = C.dist(2, 1.4, 3), far = C.dist(8, 1, 3);
  ok(at < 0 && Math.abs(near - 0.92) < 0.3 && far > 1.5, 'field: negative at the coral, about clear at 1.3 m, large far away', `${f2(at)}, ${f2(near)}, ${f2(far)}`);
  M.reset(); C.sync(M);
  ok(C.occupied === 0 && C.dist(2, 0.1, 3) > 1.5, 'field: a new reef (fewer particles) clears the field');
}

// ── the ROVs keep clear of a large colony ───────────────────────────────────
{
  const rock = createStubRock({ seed: 1 });
  const site = rock.sampleSurface(1, rng(7), s => s.exposure > 0.85 && Math.hypot(s.p[0], s.p[2]) < 14)[0];
  const reef = ballReef(site.p, 3, 3000, 3);
  const R = createROVs(THREE, { rock, reef, seed: 1, count: 2, feed: { worker: false, document: null, source: () => ({ w: 2, h: 2, data: new Uint8Array(16) }) } });
  const v = R.focusOn(0, 'inspect');
  let dmin = Infinity, dSurvey = Infinity, dOld = Infinity, t = 0;
  const near = (p) => { let d = Infinity; for (let g = 0; g < reef.count; g++) d = Math.min(d, Math.hypot(reef.px[g] - p.x, reef.py[g] - p.y, reef.pz[g] - p.z)); return d; };
  for (let i = 0; i < 120 * 30; i++, t += 1 / 30) {
    R.update(1 / 30, t);
    if (i % 10 || t < 3) continue;
    dmin = Math.min(dmin, near(v.group.position));
    dSurvey = Math.min(dSurvey, near(R.vehicles[1].group.position));
  }
  // the same dive with the rock field only (the old ROVs)
  const Ro = createROVs(THREE, { rock, reef: null, seed: 1, count: 1, feed: { worker: false, document: null, source: () => ({ w: 2, h: 2, data: new Uint8Array(16) }) } });
  Ro.focusOn([site.p[0], site.p[1] + 1.5, site.p[2]], 'inspect', { radius: 0.4 });
  for (let i = 0, t2 = 0; i < 60 * 30; i++, t2 += 1 / 30) { Ro.update(1 / 30, t2); if (i % 10 === 0 && t2 > 3) dOld = Math.min(dOld, near(Ro.vehicles[0].group.position)); }
  ok(R.coral && R.coral.occupied > 50 && dmin > 0.9, 'rov: the vehicle that inspects a 6 m colony keeps over 0.9 m from its coral', `nearest ${f2(dmin)} m (${R.coral.occupied} coral cells)`);
  ok(dSurvey > 0.9, 'rov: the vehicle on a survey keeps over 0.9 m from the coral', `nearest ${f2(dSurvey)} m`);
  ok(dOld < 0.9, 'rov: with the rock field only, a vehicle goes into the colony (the old fault)', `nearest ${f2(dOld)} m`);
}

console.log(`\nsize: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

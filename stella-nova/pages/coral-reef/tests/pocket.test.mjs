// ============================================================================
//  CORAL REEF  ·  the squad in a rock pocket (node, no browser)
//    node tests/pocket.test.mjs        (tests.mjs runs it with the others)
// ----------------------------------------------------------------------------
//  The user said (2026-10-26): "if ROV's explore for too long a time they
//  will start freezing up the application". After about 115 min of seed 1
//  the leader came to a place where every plan failed, the regroup climb
//  too. leaderGoal then read a null leg (pilot.js pathAt) and threw; main.js
//  caught it and set squad = null, so the squad stopped for good.
//    pocket ..... a closed cavity: no leg can be planned. step() does not
//                 throw, the vehicles stay out of the rock, and the planner
//                 does not run every frame (a back-off)
//    escape ..... a cavity with an open shaft above: the squad gets out
// ============================================================================
import { createSquad } from '../rov/squad.js';

let pass = 0, fail = 0;
function ok(c, name, info = '') { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } }

// a closed sphere of water (radius R) in rock: sdf > 0 in the water
function pocket(R, shaft = 0) {
  let calls = 0;
  const sdf = (x, y, z) => {
    calls++;
    const d = R - Math.hypot(x, y, z);
    // an open vertical shaft of radius shaft above the cavity
    const s = shaft ? shaft - Math.hypot(x, z) : -Infinity;
    return Math.max(d, y > 0 ? s : -Infinity);
  };
  return { field: { sdf, ground: () => -R, colonies: () => [], features: () => [], habitat: () => 0.5, sdfScale: 1 }, calls: () => calls };
}

{
  const P = pocket(1.6);
  const S = createSquad({ field: P.field, seed: 1, count: 3, clear: 0.62, start: [0, 0, 0] });
  let threw = null, minSdf = Infinity;
  const c0 = P.calls();
  try {
    for (let i = 0; i < 30 * 120; i++) {
      S.step(1 / 30);
      for (const v of S.vehicles) minSdf = Math.min(minSdf, P.field.sdf(...v.state.p));
    }
  } catch (e) { threw = e; }
  ok(!threw, 'pocket: 120 s of steps in a closed cavity do not throw', threw ? threw.message : '');
  ok(minSdf > 0, 'pocket: the vehicles stay in the water', `min sdf ${minSdf.toFixed(3)}`);
  const perS = (P.calls() - c0) / 120;
  ok(perS < 40000, 'pocket: the planner backs off (sdf calls per second)', `${Math.round(perS)}`);
}

{
  const P = pocket(1.6, 1.4);
  const S = createSquad({ field: P.field, seed: 2, count: 1, clear: 0.62, start: [0, -0.3, 0] });
  let threw = null, top = -Infinity;
  try { for (let i = 0; i < 30 * 120; i++) { S.step(1 / 30); top = Math.max(top, S.vehicles[0].state.p[1]); } } catch (e) { threw = e; }
  ok(!threw, 'escape: steps in a cavity with a shaft do not throw', threw ? threw.message : '');
  ok(top > 3, 'escape: the leader climbs out up the shaft', `top y ${top.toFixed(2)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

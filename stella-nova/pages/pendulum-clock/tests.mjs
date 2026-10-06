// ============================================================================
//  PENDULUM CLOCK  ·  tests.mjs — node stella-nova/pages/pendulum-clock/tests.mjs
// ----------------------------------------------------------------------------
//  Checks mech.js:
//    period ....... T0 = 2 pi sqrt(L/g) is 2 s for L = 994 mm; the free
//                   pendulum in the simulator keeps the exact (AGM) period
//                   at 1, 5 and 20 deg; the series agrees at small swings
//    virtual work . on every face the frictionless pallet torque is
//                   T dphi/dtheta (dphi/dtheta by finite differences)
//    train ........ 720 escape turns per barrel turn; the escape wheel
//                   turns once a minute, the centre arbor once an hour
//    escapement ... each unit settles to a swing that frees the teeth; the
//                   wheel moves one tooth per period; the tooth always
//                   pushes the pallet (N > 0); anchor and deadbeat teeth
//                   never meet the other pallet before they drop
//    recoil ....... anchor and grasshopper turn back by more than 0.5 deg,
//                   the deadbeat by less than 1e-6 rad
//    grasshopper .. no drops; Harrison's recoil holds the rate within
//                   1 s/day from 3 to 4 kg (the circular error alone
//                   changes it by 7 s/day)
//    energy ....... in a settled run the escapement work equals the air
//                   loss within 1%; the grasshopper passes on more than 97%
//                   of the weight's work, anchor and deadbeat less than 80%
//    drive ........ the anchor rate moves with the weight more than three
//                   times as much as the deadbeat rate
// ============================================================================
import { UNITS, unit, CLOCK, RATIO, P_TOOTH, DEG, TAU, GRAV, design, contact, pickTooth, torque, makeSim, trace, settle, periodSmall, periodExact, periodSeries, wheelTorque } from './mech.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fail++; };

// ── period ──────────────────────────────────────────────────────────────────
const T0 = periodSmall();
ok(Math.abs(T0 - 2) < 1e-3, `T0 = 2 pi sqrt(L/g) = ${T0.toFixed(5)} s for L = ${CLOCK.L} m`);
for (const a of [1, 5, 20]) {
  const S = makeSim(unit('anchor'), { free: true, Q: Infinity, th0: a * DEG, w0: 0 }), dt = 1e-4;
  let prev = S.th, t1 = null, t2 = null;
  while (t2 === null && S.t < 10) {
    S.step(dt);
    if (prev > 0 && S.th <= 0) { const tc = S.t - dt * S.th / (S.th - prev); if (t1 === null) t1 = tc; else t2 = tc; }
    prev = S.th;
  }
  const Te = periodExact(a * DEG), Ts = t2 - t1, err = Math.abs(Ts - Te) / Te;
  ok(err < 2e-6, `free swing ${a} deg: period ${Ts.toFixed(6)} s, exact ${Te.toFixed(6)} s (rel. error ${err.toExponential(1)})`);
}
ok(Math.abs(periodSeries(5 * DEG) - periodExact(5 * DEG)) < 1e-8, `series = exact at 5 deg (${periodSeries(5 * DEG).toFixed(9)} s)`);
ok(Math.abs(periodSeries(20 * DEG) - periodExact(20 * DEG)) / T0 < 5e-6, 'series within 5e-6 of exact at 20 deg');

// ── virtual work ────────────────────────────────────────────────────────────
for (const u of UNITS) {
  const D = design(u);
  let worst = 0, cnt = 0;
  for (let j = 0; j < 2; j++) for (let a = -6; a <= 6; a += 0.25) {
    const th = a * DEG, h = 1e-6, c = contact(D, j, th), c1 = contact(D, j, th - h), c2 = contact(D, j, th + h);
    if (!c || !c1 || !c2 || c1.face !== c2.face) continue;
    const g = (pickTooth(c2.raw, c.raw, P_TOOTH) - pickTooth(c1.raw, c.raw, P_TOOTH)) / (2 * h);
    worst = Math.max(worst, Math.abs(torque(D, c, 1).tau - g)); cnt++;
  }
  ok(cnt > 40 && worst < 1e-5, `${u.id}: pallet torque = T dphi/dtheta on ${cnt} poses (worst ${worst.toExponential(1)})`);
}

// ── train ───────────────────────────────────────────────────────────────────
ok(RATIO === 720, `escape turns per barrel turn = ${RATIO}`);
const escRpm = 60 / (CLOCK.N * T0);   // one tooth per period
ok(Math.abs(escRpm - 1) < 1e-3, `escape wheel ${escRpm.toFixed(4)} rpm: it carries the seconds hand`);
const centre = CLOCK.train[0][1] / CLOCK.train[0][0] * CLOCK.train[1][1] / CLOCK.train[1][0];
ok(centre === 60, `centre arbor: one turn per ${centre} escape turns (one hour)`);

// ── escapement, recoil, energy ──────────────────────────────────────────────
const R = {};
for (const u of UNITS) {
  const r = trace(u, { record: 20 }), S = r.sim;
  R[u.id] = r;
  ok(!S.banked && isFinite(r.amp) && r.amp > 1.5 * DEG && r.amp < 6.5 * DEG, `${u.id}: settles at ${(r.amp / DEG).toFixed(2)} deg with ${u.M} kg`);
  const adv = (r.phi[r.phi.length - 1] - r.phi[0]) / (r.t[r.t.length - 1] - r.t[0]) * r.period;
  ok(Math.abs(adv - P_TOOTH) < 0.02 * P_TOOTH, `${u.id}: one tooth per period (${(adv / DEG).toFixed(2)} deg in ${r.period.toFixed(5)} s)`);
  ok(S.Nmin > 0, `${u.id}: the tooth always pushes the pallet (least contact force ${S.Nmin.toFixed(3)} N, wheel torque ${wheelTorque(u.M).toExponential(2)} N m)`);
  if (u.id !== 'grasshopper') ok(S.swaps === 0 && S.drops > 0, `${u.id}: ${S.drops} drops and no tooth meets the other pallet early`);
  if (u.id === 'deadbeat') ok(r.recoil < 1e-6, `deadbeat: no recoil (${r.recoil.toExponential(1)} rad)`);
  else ok(r.recoil > 0.5 * DEG, `${u.id}: recoil ${(r.recoil / DEG).toFixed(2)} deg`);
  if (u.id === 'grasshopper') ok(S.drops === 0 && S.swaps > 0, `grasshopper: ${S.swaps} changeovers and no drop`);
  // energy over the run: escapement work in, air loss out
  const S2 = makeSim(u, { amp: settle(u) });
  S2.run(4 * T0);
  const bal = Math.abs(S2.wEsc - S2.wDamp) / S2.wDamp;
  ok(bal < 0.01, `${u.id}: escapement work ${S2.wEsc.toExponential(3)} J = air loss ${S2.wDamp.toExponential(3)} J (${(bal * 100).toFixed(2)}%)`);
  const eff = S2.wEsc / (wheelTorque(u.M) * P_TOOTH * 4);
  if (u.id === 'grasshopper') ok(eff > 0.97, `grasshopper: passes on ${(eff * 100).toFixed(1)}% of the weight's work`);
  else ok(eff < 0.8, `${u.id}: passes on ${(eff * 100).toFixed(1)}% of the weight's work (drop and friction take the rest)`);
}

// ── drive sensitivity ───────────────────────────────────────────────────────
const rate = (id, M) => trace(unit(id), { M, record: 10 }).rate;
const dA = rate('anchor', 6) - rate('anchor', 3), dD = rate('deadbeat', 6) - rate('deadbeat', 3);
ok(Math.abs(dA) > 3 * Math.abs(dD), `3 -> 6 kg: anchor rate moves ${dA.toFixed(1)} s/day, deadbeat ${dD.toFixed(1)} s/day`);
const g3 = trace(unit('grasshopper'), { M: 3, record: 10 }), g4 = trace(unit('grasshopper'), { M: 4, record: 10 });
const circ = (g4.amp * g4.amp - g3.amp * g3.amp) / 16 * 86400;
ok(Math.abs(g4.rate - g3.rate) < 1 && circ > 5, `grasshopper 3 -> 4 kg: rate ${g3.rate.toFixed(1)} -> ${g4.rate.toFixed(1)} s/day; circular error alone ${(-circ).toFixed(1)} s/day`);

console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);

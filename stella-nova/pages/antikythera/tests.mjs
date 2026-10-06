// ============================================================================
//  ANTIKYTHERA MECHANISM  ·  tests.mjs — node stella-nova/pages/antikythera/tests.mjs
// ----------------------------------------------------------------------------
//  Checks mech.js:
//    ratios ....... the tooth counts give 254/19 (sidereal), 235/19
//                   (synodic), 5/19 (Metonic), 477/4237 (turntable),
//                   940/4237 (Saros), Saros/12 (Exeligmos), 1/4 (Games)
//    periods ...... with a 365.25-day year: sidereal, synodic and
//                   anomalistic months within 0.001 d of the modern values
//    cycles ....... 235 synodic months = 5 Metonic turns; 223 synodic
//                   months = 4 Saros turns = 239 anomalistic months
//    pin and slot . anomaly = delta(M) at every day; peak asin(e) at the
//                   right M; mean 0 over a period; one anomalistic month per
//                   cycle of M; Moon fastest at M = 0 by 1/(1 - e)
//    mesh ......... each pair: centre distance m (N1 + N2)/2, modules
//                   0.4..1.0 mm; a tooth sits in a gap (tooth phase)
//    layout ....... no clash of wheels, arbors, k wheels or the contrate
//    dials ........ Metonic and Saros month cells agree with the count of
//                   synodic months; the spiral radius grows by one pitch
// ============================================================================
import * as M from './mech.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const { TEETH: T, RATE, PERIOD, TAU, YEAR } = M;

// ratios from the counts (exact fractions in floating point)
ok(near(RATE.b3, 254 / 19, 1e-12), `sidereal ratio ${RATE.b3} = 254/19`);
ok(near(RATE.b3 - RATE.b, 235 / 19, 1e-12), 'synodic months per year = 235/19');
ok(near(-RATE.n, 5 / 19, 1e-12), 'Metonic pointer 5 turns in 19 years');
ok(near(-RATE.e34, 477 / 4237, 1e-12), `turntable e3 ${-RATE.e34} = 477/4237`);
ok(near(-RATE.g, 940 / 4237, 1e-12), 'Saros pointer 940/4237 turns per year');
ok(near(RATE.i * 12, RATE.g, 1e-12), 'Exeligmos = Saros / 12');
ok(near(RATE.o, 1 / 4, 1e-12), 'Games dial: one turn in four years');
ok(Math.sign(RATE.e34) === Math.sign(RATE.e25), 'turntable turns with e5, so k1 sees the difference');
ok(near(T.b2 / T.c1 * T.c2 / T.d1 * T.d2 / T.e2, 254 / 19, 1e-12), 'b2/c1 c2/d1 d2/e2 = 254/19');

// periods against modern mean values (days)
ok(near(PERIOD.sidereal, 27.32166, 0.001), `sidereal month ${PERIOD.sidereal.toFixed(5)} d`);
ok(near(PERIOD.synodic, 29.53059, 0.001), `synodic month ${PERIOD.synodic.toFixed(5)} d`);
ok(near(PERIOD.anomalistic, 27.55455, 0.001), `anomalistic month ${PERIOD.anomalistic.toFixed(5)} d`);
ok(near(PERIOD.apsides / YEAR, 8.85, 0.05), `apsides turn in ${(PERIOD.apsides / YEAR).toFixed(3)} yr`);
ok(near(PERIOD.metonic, 235 * PERIOD.synodic, 1e-6) && near(PERIOD.metonic, 19 * YEAR, 1e-6), 'Metonic cycle 19 yr = 235 synodic months');
ok(near(PERIOD.saros, 223 * PERIOD.synodic, 1e-6), 'Saros = 223 synodic months');
ok(near(PERIOD.saros, 239 * PERIOD.anomalistic, 1e-6), 'Saros = 239 anomalistic months');
ok(near(PERIOD.crank, YEAR * T.a1 / T.b1, 1e-9), `crank turn ${PERIOD.crank.toFixed(2)} d`);

// pin and slot
{
  const e = M.ECC, N = 2000, Pa = PERIOD.anomalistic;
  let worst = 0, sum = 0, peak = 0, Mpeak = 0;
  const t0 = 1234.5, p0 = M.pose(t0);
  for (let i = 0; i < N; i++) {
    const p = M.pose(t0 + Pa * i / N);
    worst = Math.max(worst, Math.abs(p.anomaly - M.slot(p.M)));
    sum += p.anomaly;
    if (p.anomaly > peak) { peak = p.anomaly; Mpeak = p.M; }
  }
  ok(worst < 1e-9, `anomaly = delta(M) (worst ${worst.toExponential(1)} rad)`);
  ok(Math.abs(sum / N) < 1e-4, `mean anomaly ~0 (${(sum / N * M.DEG).toFixed(5)} deg)`);
  ok(near(peak, Math.asin(e), 1e-4), `peak ${(peak * M.DEG).toFixed(3)} deg = asin(e) ${(Math.asin(e) * M.DEG).toFixed(3)}`);
  ok(near(Math.cos(Mpeak), e, 0.01), 'peak where cos M = e');
  const p1 = M.pose(t0 + Pa);
  let dM = p1.M - p0.M; while (dM > Math.PI) dM -= TAU; while (dM < -Math.PI) dM += TAU;
  ok(Math.abs(dM) < 1e-9, 'M returns after one anomalistic month');
  ok(near(p1.anomaly, p0.anomaly, 1e-9), 'anomaly returns after one anomalistic month');
  // speed at perigee (M = 0) and apogee
  const s = M.slot, h = 1e-6, sp = m => 1 + (s(m + h) - s(m - h)) / (2 * h);
  ok(near(sp(0), 1 / (1 - e), 1e-6) && near(sp(Math.PI), 1 / (1 + e), 1e-6), 'slot speed 1/(1-e) at M = 0, 1/(1+e) at M = pi');
  ok(near(Math.asin(e) * M.DEG, 6.3, 0.1), `amplitude near 2e of the Moon (6.29 deg): ${(Math.asin(e) * M.DEG).toFixed(2)}`);
  // the k axes are 1.1 mm apart and both on the e5/e6 pitch circle
  const kR = M.cd(M.PAIRS.find(p => p.a === 'e5'));
  ok(near(Math.hypot(...M.K_AT.k1), kR, 1e-9) && near(Math.hypot(...M.K_AT.k2), kR, 1e-9), 'k1 and k2 both mesh at the e5/e6 centre distance');
  ok(near(Math.hypot(M.K_AT.k1[0] - M.K_AT.k2[0], M.K_AT.k1[1] - M.K_AT.k2[1]), M.SLOT.d, 1e-9), 'k axes 1.1 mm apart');
}

// mesh distances, modules and tooth phase
for (const p of M.PAIRS) {
  if (p.turn) continue;
  const A = M.centreOf(M.ARBOR[p.a]), B = M.centreOf(M.ARBOR[p.b]);
  ok(near(Math.hypot(A[0] - B[0], A[1] - B[1]), M.cd(p), 1e-9), `${p.a}/${p.b} centre distance ${M.cd(p).toFixed(2)} mm`);
  ok(p.m >= 0.4 && p.m <= 1.0, `${p.a}/${p.b} module ${p.m}`);
}
{
  // tooth phase: at several days, the driver tooth nearest the line of
  // centres and the driven gap there agree (the driven wheel shows a gap)
  let worst = 0;
  for (const t of [0, 3.7, 400, 5000]) {
    const P = M.pose(t).A;
    for (const p of M.PAIRS) {
      if (p.turn) continue;
      const a = M.ARBOR[p.a], b = M.ARBOR[p.b], A = M.centreOf(a), B = M.centreOf(b);
      const phi = Math.atan2(B[1] - A[1], B[0] - A[0]), Na = T[p.a], Nb = T[p.b];
      // driven local angle of the contact direction, in units of its pitch
      const u = ((phi + Math.PI - P[b]) / (TAU / Nb)) % 1, v = ((u % 1) + 1) % 1;
      // driver tooth offset from the line at the same moment
      const w = ((((phi - P[a]) / (TAU / Na)) % 1) + 1) % 1;
      // rolling: a driver tooth w pitches past the line puts the driven gap
      // centre (v = 0.5) w pitches back, so v + w = 0.5 (mod 1)
      const err = Math.min(Math.abs(((v + w) % 1) - 0.5), 1);
      worst = Math.max(worst, err);
    }
  }
  ok(worst < 1e-6, `tooth phase holds (worst ${worst.toExponential(1)} pitch)`);
}

// layout
{
  const c = M.clashes(0.5);
  ok(c.length === 0, 'no clash: ' + (c.join('; ') || 'clean'));
  for (const k in M.AT) ok(Math.abs(M.AT[k][0]) < 70, `arbor ${k} inside the case width`);
  const dIn = (a, b, D, r) => Math.hypot(M.AT[a][0] - M.AT[b][0], M.AT[a][1] - M.AT[b][1]) + r < D.rIn - 0.5;
  ok(dIn('o', 'n', M.DIALS.metonic, M.DIALS.games.r), 'Games dial inside the Metonic spiral');
  ok(dIn('i', 'g', M.DIALS.saros, M.DIALS.exeligmos.r), 'Exeligmos dial inside the Saros spiral');
}

// dials: month cells follow the synodic count
{
  let bad = 0;
  for (let i = 0; i < 400; i++) {
    const t = 7 + i * 61.3, p = M.pose(t), lun = t / PERIOD.synodic;
    const met = Math.floor(lun % 235) + 1, sar = Math.floor(lun % 223) + 1;
    if (p.metonic.month !== met || p.saros.month !== sar) bad++;
  }
  ok(bad === 0, `Metonic and Saros cells match the month count (${bad} of 400 differ)`);
  const D = M.DIALS.metonic;
  ok(near(M.spiralR(D, 1) - M.spiralR(D, 0), (D.rOut - D.rIn) / D.turns, 1e-12), 'spiral pitch is constant');
  const p = M.pose(19 * YEAR);
  ok(near(p.metonic.turn % 5, 0, 1e-6) || near(p.metonic.turn, 5, 1e-6), 'after 19 years the Metonic pointer is back at the start');
  const g = M.pose(4 * YEAR);
  ok(g.games.year === 1 && near(((g.games.angle / TAU) % 1 + 1) % 1, 0, 1e-9) || near(((g.games.angle / TAU) % 1 + 1) % 1, 1, 1e-9), 'Games pointer back after 4 years');
}
console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);

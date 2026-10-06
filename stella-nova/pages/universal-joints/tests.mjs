// ============================================================================
//  UNIVERSAL & CV JOINTS  ·  tests.mjs — node stella-nova/pages/universal-joints/tests.mjs
// ----------------------------------------------------------------------------
//  Checks mech.js at shaft angles 0, 10, 25 and 40 deg, 720 input angles:
//    cross ........ the two cross arms stay at 90 deg, and each fork pin
//                   stays normal to its own shaft
//    cardan ....... the vector solution agrees with tan psi = tan th / cos b
//                   and with w2/w1 = cos b / (1 - sin^2 b cos^2 th); the
//                   ratio runs from cos b to 1 / cos b; one input turn is
//                   one output turn; the ripple has two cycles per turn
//    double ....... Z and W in phase: output = input within 1e-9 rad, and
//                   the ratio is 1; the intermediate shaft still ripples.
//                   Out of phase (90 deg): the error is about twice the
//                   single-joint error
//    rzeppa ....... output = input within 1e-9 rad at every angle; every
//                   ball is on the bisecting plane, at radius rp, in its
//                   output groove plane, and at equal distance from the
//                   two axes; the ball shift in the cage window is small
//    continuity ... no frame vector jumps between close input angles
// ============================================================================
import { UNITS, solve, ratio, midRatio, cardanPsi, cardanRatio, shaftFrame, V, SIZE, TAU, DEG } from './mech.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } else if (process.argv.includes('-v')) console.log('ok  ', msg); };
const N = 720, BETAS = [0, 10, 25, 40].map(b => b * DEG);
const distAxis = (p, s) => V.len(V.sub(p, V.mul(s, V.dot(p, s))));

// ── cardan ──────────────────────────────────────────────────────────────────
for (const beta of BETAS) {
  let ePsi = 0, eRat = 0, eOrth = 0, rMin = 9, rMax = 0, jump = 0, lastF = null;
  const rs = [];
  for (let i = 0; i <= N; i++) {
    const th = TAU * i / N, Q = solve('cardan', th, beta), F = Q.frames;
    ePsi = Math.max(ePsi, Math.abs(Q.out - cardanPsi(th, beta)));
    const r = ratio('cardan', th, beta);
    eRat = Math.max(eRat, Math.abs(r - cardanRatio(th, beta)));
    rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
    eOrth = Math.max(eOrth, Math.abs(V.dot(F.cross1.X, F.cross1.Z)), Math.abs(V.dot(F.outYoke.X, F.outYoke.Y)), Math.abs(V.dot(F.inYoke.X, F.inYoke.Y)));
    if (i < N) rs.push(r);
    if (lastF) jump = Math.max(jump, V.len(V.sub(F.outYoke.X, lastF)));
    lastF = F.outYoke.X;
  }
  // local peaks of the periodic ratio series
  const peaks = rs.filter((r, i) => r > rs[(i + N - 1) % N] + 1e-12 && r >= rs[(i + 1) % N]).length;
  const b = (beta / DEG).toFixed(0);
  ok(ePsi < 1e-9, `cardan ${b}: vector output angle = closed form (worst ${ePsi.toExponential(2)} rad)`);
  ok(eRat < 1e-6, `cardan ${b}: numeric ratio = cos b / (1 - sin^2 b cos^2 th) (worst ${eRat.toExponential(2)})`);
  ok(eOrth < 1e-12, `cardan ${b}: cross arms at 90 deg, pins normal to shafts`);
  ok(Math.abs(rMin - Math.cos(beta)) < 1e-6 && Math.abs(rMax - 1 / Math.cos(beta)) < 1e-6, `cardan ${b}: ratio ${rMin.toFixed(4)} .. ${rMax.toFixed(4)} = cos b .. 1/cos b`);
  ok(Math.abs(solve('cardan', TAU, beta).out - TAU) < 1e-9, `cardan ${b}: one input turn = one output turn`);
  if (beta > 0) ok(peaks === 2, `cardan ${b}: ${peaks} speed peaks per turn (want 2)`);
  ok(jump < 0.05, `cardan ${b}: no jumps (largest step ${jump.toFixed(4)})`);
}
// the peak error: tan psi = tan th / cos b has its largest gap at
// tan th = sqrt(cos b): err = atan(1/sqrt(cos b)) - atan(sqrt(cos b))
{
  const beta = 30 * DEG, c = Math.cos(beta), want = Math.atan(1 / Math.sqrt(c)) - Math.atan(Math.sqrt(c));
  let peak = 0;
  for (let i = 0; i <= 3600; i++) peak = Math.max(peak, Math.abs(solve('cardan', TAU * i / 3600, beta).err));
  ok(Math.abs(peak - want) < 1e-5, `cardan 30: peak error ${(peak / DEG).toFixed(3)} deg = ${(want / DEG).toFixed(3)} deg`);
}

// ── double cardan ───────────────────────────────────────────────────────────
for (const id of ['doubleZ', 'doubleW']) for (const beta of BETAS) {
  let eOut = 0, eRat = 0, midDev = 0, eOrth = 0, single = 0, outPh = 0;
  for (let i = 0; i <= N; i++) {
    const th = TAU * i / N, Q = solve(id, th, beta), F = Q.frames;
    eOut = Math.max(eOut, Math.abs(Q.err));
    eRat = Math.max(eRat, Math.abs(ratio(id, th, beta) - 1));
    midDev = Math.max(midDev, Math.abs(midRatio(id, th, beta) - 1));
    eOrth = Math.max(eOrth, Math.abs(V.dot(F.cross2.X, F.cross2.Z)), Math.abs(V.dot(F.cross1.X, F.cross1.Z)), Math.abs(V.dot(F.outYoke.X, F.outYoke.Y)), Math.abs(V.dot(F.midYoke2.X, F.midYoke2.Y)));
    single = Math.max(single, Math.abs(solve('cardan', th, beta).err));
    outPh = Math.max(outPh, Math.abs(solve(id, th, beta, 1).err));
  }
  const b = (beta / DEG).toFixed(0);
  ok(eOut < 1e-9, `${id} ${b}: in phase, output = input (worst ${eOut.toExponential(2)} rad)`);
  ok(eRat < 1e-6, `${id} ${b}: in phase, speed ratio 1 (worst ${eRat.toExponential(2)})`);
  ok(eOrth < 1e-12, `${id} ${b}: both crosses square, pins normal to shafts`);
  if (beta > 0) {
    ok(Math.abs(midDev - (1 / Math.cos(beta) - 1)) < 1e-5, `${id} ${b}: intermediate shaft ripples to ${(1 + midDev).toFixed(4)} = 1/cos b`);
    ok(outPh > 1.8 * single && outPh < 2.2 * single, `${id} ${b}: yokes 90 deg out of phase: error ${(outPh / DEG).toFixed(2)} deg, about 2 x ${(single / DEG).toFixed(2)} deg`);
  }
}
{
  // Z: output parallel to input; W: output at 2 beta
  const z = solve('doubleZ', 0.3, 25 * DEG).A, w = solve('doubleW', 0.3, 25 * DEG).A;
  ok(V.len(V.sub(z.sOut, z.s1)) < 1e-12, 'doubleZ: output axis parallel to the input axis');
  ok(Math.abs(Math.acos(V.dot(w.sOut, w.s1)) - 50 * DEG) < 1e-12, 'doubleW: output axis at 2 beta to the input axis');
}

// ── rzeppa ──────────────────────────────────────────────────────────────────
let worstShift = 0;
for (const beta of BETAS) {
  let eOut = 0, ePlane = 0, eRad = 0, eGroove = 0, eEq = 0, eRat = 0;
  for (let i = 0; i <= N; i++) {
    const th = TAU * i / N, Q = solve('rzeppa', th, beta), Fo = shaftFrame(Q.A.sOut);
    eOut = Math.max(eOut, Math.abs(Q.err));
    if (i % 8 === 0) eRat = Math.max(eRat, Math.abs(ratio('rzeppa', th, beta) - 1));
    Q.balls.forEach((p, k) => {
      ePlane = Math.max(ePlane, Math.abs(V.dot(p, Q.n)));
      eRad = Math.max(eRad, Math.abs(V.len(p) - SIZE.rp));
      // the output groove k lies in the plane of sOut and the direction at out + k 60 deg
      const g2 = V.add(V.mul(Fo.e, Math.cos(Q.out + k * TAU / 6)), V.mul(Fo.f, Math.sin(Q.out + k * TAU / 6)));
      eGroove = Math.max(eGroove, Math.abs(V.dot(p, V.norm(V.cross(Q.A.sOut, g2)))));
      eEq = Math.max(eEq, Math.abs(distAxis(p, Q.A.s1) - distAxis(p, Q.A.sOut)));
    });
    worstShift = Math.max(worstShift, ...Q.shift.map(Math.abs));
  }
  const b = (beta / DEG).toFixed(0);
  ok(eOut < 1e-9, `rzeppa ${b}: output = input (worst ${eOut.toExponential(2)} rad)`);
  ok(eRat < 1e-6, `rzeppa ${b}: speed ratio 1 (worst ${eRat.toExponential(2)})`);
  ok(ePlane < 1e-9 && eRad < 1e-9, `rzeppa ${b}: balls on the bisecting plane at rp ${SIZE.rp} mm`);
  ok(eGroove < 1e-9, `rzeppa ${b}: each ball is in its output groove plane (worst ${eGroove.toExponential(2)} mm)`);
  ok(eEq < 1e-9, `rzeppa ${b}: each ball at equal distance from both axes`);
}
// the cage windows in scene.js allow 3 deg of shift each way
ok(worstShift < 3 * DEG, `rzeppa: largest ball shift in its cage window ${(worstShift / DEG).toFixed(2)} deg (< 3 deg) at beta up to 40 deg`);

// every unit solves at the largest shaft angle without NaN
for (const u of UNITS) {
  const Q = solve(u.id, 1.234, SIZE.betaMax);
  ok(Number.isFinite(Q.out) && Object.values(Q.frames).every(f => [f.X, f.Y || f.Z].every(v => v.every(Number.isFinite))), `${u.id}: finite pose at beta ${(SIZE.betaMax / DEG).toFixed(0)} deg`);
}

console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);

// ============================================================================
//  SWASHPLATE PISTON PUMP  ·  tests.mjs — node stella-nova/pages/swashplate-pump/tests.mjs
// ----------------------------------------------------------------------------
//  Checks mech.js:
//    plate ....... every ball centre lies on the plane n . p = hs; the
//                  stroke is 2 Rp tan b; s = Rp tan b (1 - cos phi)
//    zero tilt ... at b = 0 the stroke, the flow and the displacement are 0
//    flow ........ q(th) equals the rate at which the delivering chambers
//                  lose volume (a finite step); the mean of q over a turn
//                  is V / 2 pi; the ripple equals the closed form; odd N
//                  has 2N pulses a turn, even N has N; odd N ripples less
//                  than the even count between them
//    ports ....... no barrel port opens to both kidneys at any angle; a
//                  port is closed on each bridge (phi = 0, pi) and opens to
//                  delivery while the piston goes in, suction while it
//                  comes out
//    retainer .... each slipper neck stays inside its retainer hole at any
//                  angle and tilt, with 0.3 mm to spare, and the hole is
//                  smaller than the slipper flange
//    layout ...... the piston never reaches the bore end, keeps at least
//                  25 mm in its bore, and the slipper cup clears the barrel
//                  face; the slippers do not touch and stay on the plate
// ============================================================================
import { UNITS, LAYOUT as L, TAU, D, area, xBall, stroke, displacement, pumpPose, flowCurve, ripple, portState, slipperAt, retainerHole } from './mech.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } };
const near = (a, b, e) => Math.abs(a - b) <= e;
const BETAS = [0, 3 * D, 9 * D, 15 * D, 18 * D];

for (const u of UNITS) {
  // plate geometry
  let worstPlane = 0, worstS = 0;
  for (const b of BETAS) for (let j = 0; j < 360; j++) {
    const phi = j * D, x = xBall(u, phi, b), y = u.Rp * Math.cos(phi);
    worstPlane = Math.max(worstPlane, Math.abs(x * Math.cos(b) + y * Math.sin(b) - u.hs));
    worstS = Math.max(worstS, Math.abs(x - xBall(u, 0, b) - u.Rp * Math.tan(b) * (1 - Math.cos(phi))));
  }
  ok(worstPlane < 1e-12, `${u.id}: ball centres on the plane (worst ${worstPlane.toExponential(1)} mm)`);
  ok(worstS < 1e-12, `${u.id}: s = Rp tan b (1 - cos phi)`);
  const xs = Array.from({ length: 361 }, (_, j) => xBall(u, j * D, u.b0));
  ok(near(Math.max(...xs) - Math.min(...xs), stroke(u, u.b0), 1e-9), `${u.id}: stroke ${stroke(u, u.b0).toFixed(2)} mm = 2 Rp tan b`);

  // zero tilt
  const P0 = pumpPose(u, 0.7, 0);
  ok(stroke(u, 0) === 0 && displacement(u, 0) === 0 && P0.q === 0 && P0.pistons.every(p => p.s === 0), `${u.id}: zero stroke and zero flow at b = 0`);

  // flow from the chamber volumes: q = - d(volume of the delivering chambers)/dth
  let worstQ = 0;
  for (let j = 0; j < 200; j++) {
    const th = j * TAU / 200 + 0.0123, h = 1e-6, a = pumpPose(u, th), c = pumpPose(u, th + h);
    let dv = 0;
    for (let i = 0; i < u.N; i++) if (Math.sin(a.pistons[i].phi) > 0) dv += area(u) * (c.pistons[i].s - a.pistons[i].s) / h;
    worstQ = Math.max(worstQ, Math.abs(dv - a.q) / a.qMean);
  }
  ok(worstQ < 1e-5, `${u.id}: q = rate of chamber volume loss (worst ${worstQ.toExponential(1)} of the mean)`);
  const q = flowCurve(u, u.b0, 3600), mean = q.slice(0, -1).reduce((s, v) => s + v, 0) / 3600;
  ok(near(mean, displacement(u, u.b0) / TAU, 1e-6 * mean), `${u.id}: mean flow ${mean.toFixed(1)} mm^3/rad = V / 2 pi`);
  const R = ripple(u);
  ok(near(R.measured, R.theory, 1e-6), `${u.id}: ripple ${(R.measured * 100).toFixed(3)}% = closed form ${(R.theory * 100).toFixed(3)}%`);
  let peaks = 0;
  for (let j = 0; j < 3600; j++) { const a = q[(j + 3599) % 3600], b = q[j], c = q[(j + 1) % 3600]; if (b > a && b >= c) peaks++; }
  ok(peaks === (u.N % 2 ? 2 * u.N : u.N), `${u.id}: ${peaks} flow pulses a turn (want ${u.N % 2 ? 2 * u.N : u.N})`);

  // ports
  let both = 0, wrong = 0;
  for (let j = 0; j < 3600; j++) {
    const phi = j * TAU / 3600, st = portState(u, phi), s = Math.sin(phi);
    if (st === 'both') both++;
    if ((st === 'delivery' && s <= 0) || (st === 'suction' && s >= 0)) wrong++;
  }
  ok(both === 0, `${u.id}: no port opens to both kidneys`);
  ok(wrong === 0, `${u.id}: delivery only while the piston goes in, suction only while it comes out`);
  ok(portState(u, 0) === 'bridge' && portState(u, Math.PI) === 'bridge', `${u.id}: ports closed on both bridges`);
  ok(portState(u, Math.PI / 2) === 'delivery' && portState(u, 1.5 * Math.PI) === 'suction', `${u.id}: delivery at 90 deg, suction at 270 deg`);

  // retainer
  let worstGap = 0;
  for (let k = 0; k <= 36; k++) for (let j = 0; j < 360; j++) {
    const b = u.bMax * k / 36, phi = j * D, s = slipperAt(u, phi, b), h = retainerHole(u, phi, b);
    worstGap = Math.max(worstGap, Math.hypot(s[0] - h[0], s[1] - h[1]));
  }
  ok(worstGap + u.neck <= u.hole - 0.3, `${u.id}: neck in its hole (offset ${worstGap.toFixed(2)} + neck ${u.neck} <= hole ${u.hole} - 0.3)`);
  ok(u.hole < u.flange - 2, `${u.id}: retainer hole ${u.hole} mm holds the flange ${u.flange} mm`);

  // layout
  let deepest = -Infinity, shallowest = Infinity, cup = -Infinity;
  for (const b of [0, u.bMax]) for (let j = 0; j < 360; j++) {
    const x = xBall(u, j * D, b);
    deepest = Math.max(deepest, x + L.pist1); shallowest = Math.min(shallowest, x + L.pist1 - L.barrel0);
    cup = Math.max(cup, x + L.cupTop);
  }
  ok(deepest < L.boreEnd - 1, `${u.id}: piston tip at most ${deepest.toFixed(1)} mm (bore end ${L.boreEnd})`);
  ok(shallowest >= 25, `${u.id}: at least ${shallowest.toFixed(1)} mm of piston in its bore`);
  ok(cup < L.barrel0 - 2, `${u.id}: slipper cup reaches x ${cup.toFixed(1)} mm, barrel face ${L.barrel0}`);
  const chord = 2 * u.Rp * Math.sin(Math.PI / u.N);
  ok(chord > 2 * u.flange + 1, `${u.id}: slippers ${chord.toFixed(1)} mm apart (flange ${2 * u.flange} mm)`);
  ok(chord > 2 * L.boreR + 6, `${u.id}: bore wall ${(chord - 2 * L.boreR).toFixed(1)} mm between bores`);
  const reach = u.hs * Math.tan(u.bMax) + u.Rp / Math.cos(u.bMax) + u.flange;
  console.log(`${u.id}: stroke ${stroke(u, u.b0).toFixed(2)} mm, V ${(displacement(u, u.b0) / 1000).toFixed(2)} cm3, ripple ${(R.measured * 100).toFixed(3)}% (closed form ${(R.theory * 100).toFixed(3)}%), ${peaks} pulses, neck offset ${worstGap.toFixed(2)} mm, piston tip ${deepest.toFixed(1)} mm`);
  ok(reach < L.plateR - 3, `${u.id}: slippers reach ${reach.toFixed(1)} mm on a ${L.plateR} mm plate`);
}
// odd against even
const r7 = ripple(UNITS.find(u => u.N === 7)).measured, r8 = ripple(UNITS.find(u => u.N === 8)).measured, r9 = ripple(UNITS.find(u => u.N === 9)).measured;
ok(r9 < r7 && r7 < r8, `ripple 9: ${(r9 * 100).toFixed(2)}% < 7: ${(r7 * 100).toFixed(2)}% < 8: ${(r8 * 100).toFixed(2)}%`);
console.log(`ripple 7 ${(r7 * 100).toFixed(2)}%  8 ${(r8 * 100).toFixed(2)}%  9 ${(r9 * 100).toFixed(2)}%`);
console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);

// ============================================================================
//  CVT  ·  tests.mjs — node stella-nova/pages/cvt/tests.mjs
// ----------------------------------------------------------------------------
//  Checks model.js:
//    belt length ... L(r1, r2) stays L0 within 1e-9 mm at 2001 control values;
//                    r2 runs from R_MAX to R_MIN and stays in range
//    ratio ......... i = r2 / r1 falls as x rises; i(0) i(1) = 1
//    wedge ......... on both pulleys the sheave gap at the belt radius is BW
//    pitch loop .... beltPoint closes on itself, has no jumps, its sampled
//                    length is L, and arc points are r from the centre
//    elements ...... N elements fit the loop; on the smallest arc, at every
//                    depth, the pitch at that depth is more than the element
//                    thickness; the head clears the sheave rim; the rims
//                    clear each other
//    misalignment .. equals tan BETA (2 r_m - r1 - r2), is 0 at i = 1, and
//                    stays under the side clearance on each side x 2
//    toroidal ...... contacts are R0 from the core point, on the two discs;
//                    the roller axis is normal to P1 P2; i(0) = 1;
//                    i(g) i(-g) = 1; i rises as g rises; no roller rim
//                    point is farther than RHO from the core circle (it
//                    stays inside the cavity); contacts lie on the cavity arc
// ============================================================================
import { UNITS, unit, beltLength, L0, rMid, sheaveS, gapAt, beltState, beltPoint, elemT, toroState, arcEnd, TAU } from './model.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } else if (process.argv.includes('-v')) console.log('ok  ', msg); };
const near = (a, b, e) => Math.abs(a - b) <= e;

// ── push belt ───────────────────────────────────────────────────────────────
{
  const u = unit('belt'), L = L0(u), N = 2000, tb = Math.tan(u.BETA);
  let worstL = 0, worstGap = 0, worstMis = 0, monotone = true, inRange = true, maxMis = 0, prevI = Infinity;
  for (let k = 0; k <= N; k++) {
    const st = beltState(u, k / N);
    worstL = Math.max(worstL, Math.abs(beltLength(u.C, st.r1, st.r2) - L));
    worstGap = Math.max(worstGap, Math.abs(gapAt(u, st.s1, st.r1) - u.BW), Math.abs(gapAt(u, st.s2, st.r2) - u.BW));
    worstMis = Math.max(worstMis, Math.abs(st.mis - tb * (2 * rMid(u) - st.r1 - st.r2)));
    maxMis = Math.max(maxMis, Math.abs(st.mis));
    if (st.i >= prevI) monotone = false; prevI = st.i;
    if (st.r2 < u.R_MIN - 1e-9 || st.r2 > u.R_MAX + 1e-9) inRange = false;
  }
  ok(worstL < 1e-9, `belt: length L0 = ${L.toFixed(3)} mm holds (worst ${worstL.toExponential(2)} mm)`);
  ok(inRange, 'belt: r2 stays within R_MIN .. R_MAX');
  const lo = beltState(u, 0), hi = beltState(u, 1);
  ok(near(lo.r2, u.R_MAX, 1e-9) && near(hi.r2, u.R_MIN, 1e-9), `belt: r2 runs ${lo.r2.toFixed(3)} -> ${hi.r2.toFixed(3)} mm`);
  ok(monotone, 'belt: the ratio falls as the control rises');
  ok(near(lo.i * hi.i, 1, 1e-12), `belt: i(0) i(1) = 1 (i ${lo.i.toFixed(3)} .. ${hi.i.toFixed(3)}, spread ${(lo.i / hi.i).toFixed(2)})`);
  ok(worstGap < 1e-12, `belt: the sheave gap at the belt radius is BW = ${u.BW} mm on both pulleys`);
  ok(worstMis < 1e-12, 'belt: misalignment = tan BETA (2 r_m - r1 - r2)');
  const mid = beltState(u, (rMid(u) - u.R_MIN) / (u.R_MAX - u.R_MIN));
  ok(near(mid.i, 1, 1e-9) && Math.abs(mid.mis) < 1e-9, `belt: at i = 1 (r = ${rMid(u).toFixed(3)} mm) the belt runs straight`);
  ok(maxMis < 2 * u.CLEAR, `belt: largest misalignment ${maxMis.toFixed(3)} mm < 2 x side clearance ${u.CLEAR} mm`);
  ok(sheaveS(u, u.R_MAX) > 0, `belt: the sheaves do not touch at the top radius (s = ${sheaveS(u, u.R_MAX).toFixed(2)} mm)`);

  // pitch loop
  for (const x of [0, 0.37, 1]) {
    const st = beltState(u, x), M = 20000;
    let len = 0, jump = 0, arcErr = 0, prev = beltPoint(u, st, 0).p;
    for (let k = 1; k <= M; k++) {
      const q = beltPoint(u, st, st.L * k / M), d = Math.hypot(q.p[0] - prev[0], q.p[1] - prev[1]);
      len += d; jump = Math.max(jump, d); prev = q.p;
      if (q.on) { const c = q.on === 1 ? -u.C / 2 : u.C / 2, r = q.on === 1 ? st.r1 : st.r2; arcErr = Math.max(arcErr, Math.abs(Math.hypot(q.p[0] - c, q.p[1]) - r)); }
      const tn = Math.hypot(...q.t); arcErr = Math.max(arcErr, Math.abs(tn - 1), Math.abs(q.t[0] * q.n[0] + q.t[1] * q.n[1]));
    }
    const end = beltPoint(u, st, st.L), start = beltPoint(u, st, 0);
    ok(Math.hypot(end.p[0] - start.p[0], end.p[1] - start.p[1]) < 1e-9, `belt x=${x}: the pitch loop closes`);
    ok(near(len, st.L, 1e-4), `belt x=${x}: sampled loop length ${len.toFixed(4)} = L ${st.L.toFixed(4)}`);
    ok(jump < 2 * st.L / M, `belt x=${x}: no jumps (largest step ${jump.toFixed(4)} mm)`);
    ok(arcErr < 1e-9, `belt x=${x}: arcs at r, unit tangents normal to the out direction`);
  }

  // elements
  const p = L / u.N, rs = Math.min(u.R_MIN, beltState(u, 1).r2);
  let tight = Infinity;
  for (let h = 0; h <= u.DEPTH; h += 0.25) tight = Math.min(tight, p * (rs - h) / rs - elemT(u, h));
  ok(tight > 0.1, `belt: ${u.N} elements, pitch ${p.toFixed(3)} mm; on the ${rs} mm arc the least gap between elements is ${tight.toFixed(3)} mm`);
  ok(u.R_MAX + u.HEAD + 1 < u.R_OUT, `belt: element head (${u.R_MAX + u.HEAD} mm) inside the sheave rim (${u.R_OUT} mm)`);
  ok(2 * u.R_OUT < u.C, `belt: sheave rims clear (2 x ${u.R_OUT} < ${u.C})`);
  ok(u.R_MIN - u.DEPTH > u.SHAFT + 2, `belt: element foot (${u.R_MIN - u.DEPTH} mm) clears the shaft (${u.SHAFT} mm)`);
}

// ── toroidal ────────────────────────────────────────────────────────────────
{
  const u = unit('toroidal'), N = 400;
  let worstR = 0, worstN = 0, monotone = true, prev = -Infinity, worstSym = 0, worstIn = -Infinity, arcOK = true;
  const amin = arcEnd(u);
  for (let k = 0; k <= N; k++) {
    const T = toroState(u, k / N), S = toroState(u, 1 - k / N);
    worstR = Math.max(worstR, Math.abs(Math.hypot(T.P1[0] - u.E, T.P1[1]) - u.R0), Math.abs(Math.hypot(T.P2[0] - u.E, T.P2[1]) - u.R0));
    worstN = Math.max(worstN, Math.abs(T.n[0] * (T.P2[0] - T.P1[0]) + T.n[1] * (T.P2[1] - T.P1[1])));
    worstSym = Math.max(worstSym, Math.abs(T.i * S.i - 1));
    if (T.i >= prev && k) monotone = false; prev = T.i;
    if (!(T.P1[1] < -u.GAP / 2 && T.P2[1] > u.GAP / 2)) arcOK = false;
    // contact angle from the a = 0 plane must be past the arc end
    if (Math.asin(Math.abs(T.P1[1]) / u.R0) < amin) arcOK = false;
    // the rim of the tilted roller: core + rho (cos f t + sin f m), m = (sin g, cos g)
    for (let j = 0; j < 360; j++) {
      const f = TAU * j / 360, y = T.rho * Math.cos(f), xr = u.E + T.rho * Math.sin(f) * Math.sin(T.g), z = T.rho * Math.sin(f) * Math.cos(T.g);
      const d = Math.hypot(Math.hypot(xr, y) - u.E, z);
      worstIn = Math.max(worstIn, d - T.rho);
    }
  }
  // i rises as g falls (control rises), so monotone here means falling i
  ok(worstR < 1e-12, 'toroidal: both contacts are R0 from the core point');
  ok(worstN < 1e-12, 'toroidal: the roller axis is normal to P1 P2');
  ok(near(toroState(u, 0.5).i, 1, 1e-15), 'toroidal: i = 1 at zero tilt');
  ok(worstSym < 1e-12, 'toroidal: i(g) i(-g) = 1');
  ok(monotone, 'toroidal: the ratio falls as the control rises');
  const lo = toroState(u, 0), hi = toroState(u, 1);
  ok(lo.i > 2 && hi.i < 0.5, `toroidal: i ${lo.i.toFixed(3)} .. ${hi.i.toFixed(3)}, spread ${(lo.i / hi.i).toFixed(2)} at tilt +-${(u.G_MAX * 180 / Math.PI).toFixed(1)} deg`);
  ok(worstIn < 1e-9, `toroidal: the roller rim stays inside the cavity (worst ${worstIn.toExponential(2)} mm past RHO)`);
  ok(arcOK, 'toroidal: both contacts lie on the cavity arcs of the discs');
  ok(near(lo.kRoll * lo.rho, lo.rIn, 1e-12) && near(-lo.kOut * lo.rOut, lo.rIn, 1e-12), 'toroidal: no slip, w_in r_in = w_roll RHO = |w_out| r_out');
  ok(u.E - u.R0 * Math.sin(u.G_MAX) > u.SHAFT + 10, `toroidal: the input contact (r ${(u.E - u.R0 * Math.sin(u.G_MAX)).toFixed(1)}) stays off the shaft`);
}

console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);

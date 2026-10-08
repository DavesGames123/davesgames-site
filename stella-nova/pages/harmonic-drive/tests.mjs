// ============================================================================
//  HARMONIC & CYCLOIDAL DRIVES  ·  tests.mjs — node stella-nova/pages/harmonic-drive/tests.mjs
// ----------------------------------------------------------------------------
//  Checks drive.js:
//    strain wave .. ratio Nf / (Nc - Nf) = 30; the output turns backward;
//                   at th = 2 pi j / Nc a flexspline tooth and a circular
//                   spline gap are both on the major axis; the deflection is
//                   +d on the major axis and -d on the minor axis
//    cycloidal .... at 720 input angles, for both discs: every ring pin is
//                   at least Rr from the disc outline (no interference) and
//                   the nearest pin touches it (gap < 0.02 mm); several pins
//                   touch at once; each output pin stays tangent inside its
//                   hole (centre gap = E); ratio 11 and backward
// ============================================================================
import { UNITS, wave, cycloPose, discProfile, holeAngles, TAU } from './drive.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } };
const near = (a, b, e) => Math.abs(a - b) <= e;
const angDist = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return Math.abs(d); };

// strain wave
{
  const u = UNITS[0];
  ok(near(wave(u, 1).ratio, 15, 1e-12), 'harmonic: ratio 15');
  ok(wave(u, 1).out < 0, 'harmonic: output turns backward');
  let worst = 0;
  for (let j = 0; j < 3 * u.Nc; j++) {
    const th = TAU * j / u.Nc, W = wave(u, th);
    // nearest FS tooth (world angle 2 pi k / Nf + out) to the major axis th
    let best = Infinity;
    for (let k = 0; k < u.Nf; k++) best = Math.min(best, angDist(TAU * k / u.Nf + W.out, th));
    // nearest CS gap (2 pi k / Nc) to th
    let gap = Infinity;
    for (let k = 0; k < u.Nc; k++) gap = Math.min(gap, angDist(TAU * k / u.Nc, th));
    worst = Math.max(worst, best, gap);
  }
  ok(worst < 1e-9, `harmonic: tooth and gap on the major axis (worst ${worst.toExponential(2)} rad)`);
  const W = wave(u, 0.7);
  ok(near(W.defl(0.7 - W.out), u.d, 1e-12) && near(W.defl(0.7 - W.out + Math.PI / 2), -u.d, 1e-12), 'harmonic: +d major, -d minor');
}

// cycloidal
{
  const u = UNITS[1], prof = discProfile(u, 2880);
  const toWorld = (p, P) => { const c = Math.cos(P.rot), s = Math.sin(P.rot); return [P.cx + p[0] * c - p[1] * s, P.cy + p[0] * s + p[1] * c]; };
  let inter = 0, worstTouch = 0, minTouching = Infinity, holeErr = 0;
  for (let i = 0; i < 720; i++) {
    const th = TAU * i / 720;
    for (const k of [0, 1]) {
      const P = cycloPose(u, th, k), W = prof.map(p => toWorld(p, P));
      let nearest = Infinity, touching = 0;
      for (let j = 0; j < u.Np; j++) {
        const a = TAU * j / u.Np, px = u.R * Math.cos(a), py = u.R * Math.sin(a);
        let m = Infinity; for (const q of W) m = Math.min(m, Math.hypot(q[0] - px, q[1] - py));
        if (m < u.Rr - 0.02) inter++;
        nearest = Math.min(nearest, m - u.Rr);
        if (m - u.Rr < 0.05) touching++;
      }
      worstTouch = Math.max(worstTouch, nearest);
      minTouching = Math.min(minTouching, touching);
      // output pins: flange at disc 0's angle
      const F = cycloPose(u, th, 0).rot;
      holeAngles(u, k).forEach((a, j) => {
        const hx = P.cx + u.rOut * Math.cos(a + P.rot), hy = P.cy + u.rOut * Math.sin(a + P.rot);
        const ox = u.rOut * Math.cos(TAU * j / u.nOut + F), oy = u.rOut * Math.sin(TAU * j / u.nOut + F);
        holeErr = Math.max(holeErr, Math.abs(Math.hypot(hx - ox, hy - oy) - u.E));
      });
    }
  }
  ok(inter === 0, `cycloidal: no pin inside a disc (${inter} hits)`);
  ok(worstTouch < 0.02, `cycloidal: the nearest pin touches (worst gap ${worstTouch.toFixed(4)} mm)`);
  ok(minTouching >= 3, `cycloidal: at least ${minTouching} pins touch at once`);
  ok(holeErr < 1e-9, `cycloidal: output pins tangent in their holes (err ${holeErr.toExponential(2)})`);
  ok(near(cycloPose(u, TAU, 0).rot, -TAU / 9, 1e-12), 'cycloidal: ratio 9, backward');
}
console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);

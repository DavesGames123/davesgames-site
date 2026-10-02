// ============================================================================
//  SPIROGRAPH  ·  tests.mjs — node tests of spiro.js (no DOM)
// ----------------------------------------------------------------------------
//  Run from the repo root:  node stella-nova/pages/spirograph/tests.mjs
//  1. closure: g, petals and laps for known tooth counts.
//  2. penAt equals center + d e^{i phi} (the curve is the rolling wheel).
//  3. no slip: the contact point moves at the same speed on both gears.
//  4. tooth mesh: at the contact point a fixed tooth meets a wheel gap.
//  5. the curve closes after L laps and not before.
//  6. each pen hole angle is a whole number of tooth pitches.
// ============================================================================
import { TAU, gcd, closure, wheelAngle, wheelCenter, penAt, holes } from './spiro.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const frac = v => v - Math.floor(v);

ok(gcd(144, 60) === 12, 'gcd(144, 60)');
for (const [R, r, g, p, L] of [[144, 60, 12, 12, 5], [150, 52, 2, 75, 26], [105, 45, 15, 7, 3], [96, 80, 16, 6, 5]]) {
  const c = closure(R, r);
  ok(c.g === g && c.petals === p && c.laps === L, `closure(${R}, ${r}) = ${JSON.stringify(c)}`);
}

const cases = [[144, 60, false, 40], [105, 45, false, 30], [52, 40, true, 30], [72, 56, true, 50], [96, 30, false, 20]];
for (const [R, r, out, d] of cases) {
  for (let i = 0; i < 200; i++) {
    const t = i * 0.137;
    const [cx, cy] = wheelCenter(R, r, out, t), phi = wheelAngle(R, r, out, t);
    const [px, py] = penAt(R, r, out, d, t);
    ok(near(px, cx + d * Math.cos(phi)) && near(py, cy + d * Math.sin(phi)), `pen on wheel R=${R} r=${r} out=${out} t=${t}`);
    // no slip: the wheel point at the contact has zero speed.
    const h = 1e-5, ca = out ? t : t;   // contact direction from the fixed center
    const s = out ? -1 : 1;            // contact direction from the wheel center
    const vx = (wheelCenter(R, r, out, t + h)[0] - wheelCenter(R, r, out, t - h)[0]) / (2 * h);
    const vy = (wheelCenter(R, r, out, t + h)[1] - wheelCenter(R, r, out, t - h)[1]) / (2 * h);
    const w = (wheelAngle(R, r, out, t + h) - wheelAngle(R, r, out, t - h)) / (2 * h);
    const ox = s * r * Math.cos(ca), oy = s * r * Math.sin(ca);
    ok(near(vx - w * oy, 0, 1e-4) && near(vy + w * ox, 0, 1e-4), `no slip R=${R} r=${r} out=${out} t=${t}`);
    // tooth mesh: in tooth pitches, the offset of the nearest fixed gap
    // from the contact point equals the offset of the nearest wheel tooth.
    // Outside, the two gears run in opposite senses at the contact, so the
    // wheel offset changes sign.
    const gapOff = frac(R * ca / TAU - 0.5);                           // fixed gaps at (k + 1/2) 2 pi / R
    const wa = (out ? ca + Math.PI : ca) - phi;                        // contact in the wheel frame
    const tooth = r * wa / TAU - 0.5;                                  // wheel teeth at (j + 1/2) 2 pi / r
    const diff = frac(gapOff - frac(out ? -tooth : tooth));
    ok(Math.min(diff, 1 - diff) < 1e-6,
      `tooth mesh R=${R} r=${r} out=${out} t=${t}`);
  }
  const { laps } = closure(R, r), p0 = penAt(R, r, out, d, 0);
  const pT = penAt(R, r, out, d, TAU * laps);
  ok(near(p0[0], pT[0], 1e-6) && near(p0[1], pT[1], 1e-6), `closes after ${laps} laps R=${R} r=${r}`);
  for (let k = 1; k < laps; k++) {
    const q = penAt(R, r, out, d, TAU * k);
    ok(Math.hypot(q[0] - p0[0], q[1] - p0[1]) > 1e-3, `open after ${k} laps R=${R} r=${r}`);
  }
}
for (const r of [12, 30, 45, 60, 98]) for (const h of holes(r)) ok(near(frac(h.a * r / TAU + 1e-9), 0, 1e-6), `hole phase r=${r}`);

console.log(fail ? `${fail} of ${n} checks failed` : `all ${n} checks passed`);
process.exit(fail ? 1 : 0);

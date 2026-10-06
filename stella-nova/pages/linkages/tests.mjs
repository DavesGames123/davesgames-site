// ============================================================================
//  LINKAGES  ·  tests.mjs — node stella-nova/pages/linkages/tests.mjs
// ----------------------------------------------------------------------------
//  Checks mech.js:
//    lengths ...... every link keeps its length at 720 input angles
//    four-bar ..... Grashof (s + l <= p + q) with the crank shortest; the
//                   crank turns fully (a solution at every angle)
//    peaucellier .. P stays on x = (L^2 - s^2)/(2r) within 1e-9 mm, and
//                   OC * OP = L^2 - s^2
//    jansen ....... the foot has a flat stance: over the lowest part of the
//                   path (y within 2% of the stride of the lowest point) the
//                   crank turns at least 120 degrees, and the stride is long
//    continuity ... no joint jumps between two close input angles
// ============================================================================
import { UNITS, makeLinkage, TAU } from './mech.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } };
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

for (const u of UNITS) {
  const L = makeLinkage(u), N = 720;
  let worst = 0, jump = 0, prev = null, missing = 0;
  const path = [];
  for (let i = 0; i <= N; i++) {
    const Q = L.pose(TAU * i / N);
    for (const l of L.links) { const a = Q.J[l.from], b = Q.J[l.to]; if (!a || !b) { missing++; continue; } worst = Math.max(worst, Math.abs(dist(a, b) - l.len)); }
    if (prev) for (const k in Q.J) jump = Math.max(jump, dist(Q.J[k], prev[k]));
    prev = Q.J; path.push(Q);
  }
  ok(missing === 0, `${u.id}: every joint solved (${missing} missing)`);
  ok(worst < 1e-9, `${u.id}: link lengths hold (worst ${worst.toExponential(2)} mm)`);
  ok(jump < 6, `${u.id}: no jumps (largest step ${jump.toFixed(2)} mm per 0.5 deg)`);
  if (u.id === 'fourbar') {
    const s = [u.a, u.b, u.c, u.d].sort((x, y) => x - y);
    ok(s[0] + s[3] <= s[1] + s[2] && s[0] === u.a, 'four-bar: Grashof crank-rocker');
  }
  if (u.id === 'peaucellier') {
    const x = (u.L * u.L - u.s * u.s) / (2 * u.r);
    ok(path.every(Q => Math.abs(Q.J.P[0] - x) < 1e-9), `peaucellier: P on x = ${x}`);
    ok(path.every(Q => Math.abs(Math.hypot(...Q.J.C) * Math.hypot(...Q.J.P) - (u.L * u.L - u.s * u.s)) < 1e-6), 'peaucellier: OC * OP = L^2 - s^2');
  }
  if (u.id === 'jansen') {
    const ys = path.map(Q => Q.J.G[1]), xs = path.map(Q => Q.J.G[0]);
    const stride = Math.max(...xs) - Math.min(...xs), ymin = Math.min(...ys);
    const flat = ys.filter(y => y < ymin + 0.02 * stride).length / ys.length * 360;
    ok(flat >= 120, `jansen: flat stance over ${flat.toFixed(0)} deg of crank, stride ${stride.toFixed(0)} mm`);
    ok(stride > 3 * u.J.m * u.k, `jansen: stride ${stride.toFixed(0)} mm > 3 crank radii`);
  }
}
console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);

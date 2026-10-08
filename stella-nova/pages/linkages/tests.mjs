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
//  Checks layers.js:
//    clash ........ no two solids (links, pins, washers, bosses, hub,
//                   frame, rail, backboard) come within 0.5 mm in z and in
//                   the plane at any of 720 input angles
//    pins ......... each pin is one solid and spans every layer it joins
//    control ...... the old stack (a layer per link, full-depth pins and
//                   bosses) fails the same clash check
// ============================================================================
import { UNITS, makeLinkage, TAU } from './mech.js';
import { makeStack, clashes, pinReach, CLR, WIDTH, BEVEL, HUB } from './layers.js';

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
// The stack before the layer table (commit 024ff66): link i in layer
// 4 + 8 i, every pin r 3.5 from the backboard to the front with a cap,
// a boss r 12 at each ground pivot through all layers, and the Jansen
// frame (r 9.6) at z 1 .. 7 from Z to O. A control: it must fail.
function oldStack(id, L) {
  const nL = L.links.length, depth = 4 + nL * 8, r = WIDTH[id] / 2 + BEVEL, Q = L.pose(0); L.reset();
  const links = L.links.map((l, i) => ({ id: l.id, from: l.from, to: l.to, r, z0: 4 + i * 8, z1: 10 + i * 8 }));
  const joints = [...new Set(L.links.flatMap(l => [l.from, l.to]))];
  const pins = joints.map(j => ({ joint: j, fixed: L.ground.includes(j), links: L.links.filter(l => l.from === j || l.to === j).map(l => l.id),
    segs: [{ r: 3.5, z0: 0, z1: depth }, { r: 5.5, z0: depth, z1: depth + 3 }] }));
  const fixed = L.ground.map(g => ({ name: 'boss ' + g, a: Q.J[g], b: Q.J[g], r: 12, z0: 0, z1: depth }));
  if (id === 'jansen') fixed.push({ name: 'frame', a: Q.J.Z, b: Q.J.O, r: 9.6, z0: 1, z1: 7 });
  const input = { fourbar: 'O2', peaucellier: 'O1', jansen: 'O' }[id];
  return { id, links, pins, fixed, hub: { joint: input, ...HUB }, depth };
}
const fmt = c => c.map(x => `${x.pair} (${x.gap.toFixed(1)} mm)`).join(', ');
for (const u of UNITS) {
  const L = makeLinkage(u), st = makeStack(u.id, L), now = clashes(st, L, 720, CLR), old = clashes(oldStack(u.id, L), L, 720, CLR);
  ok(now.length === 0, `${u.id}: no clash at 720 angles with ${CLR} mm clearance (${now.length}: ${fmt(now)})`);
  const miss = pinReach(st);
  ok(miss.length === 0, `${u.id}: every pin spans the layers it joins (${miss.map(m => m.joint + '/' + m.link).join(', ')})`);
  ok(old.length > 0, `${u.id}: control, the old stack clashes (${old.length} pairs)`);
  if (process.argv.includes('-v')) console.log(`${u.id} old stack clashes: ${fmt(old)}`);
}
console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);

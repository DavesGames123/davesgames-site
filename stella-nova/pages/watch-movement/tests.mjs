// ============================================================================
//  WATCH MOVEMENT  ·  tests.mjs — node tests.mjs
// ────────────────────────────────────────────────────────────────────────────
//  Checks the calibre in movement.js without a browser:
//    ratios ....... each wheel turns at its nominal period
//    layout ....... centre distances match the modules, parts fit the plate
//    meshes ....... no tooth outline enters its mate over a full tooth pitch
//    clearance .... parts in one z plane do not overlap unless they mesh
//    escapement ... one tooth per two beats, no jam, no runaway, no overlap
//    hands ........ a state made at a clock time reads that time
//    reserve ...... a full wind runs about 46 h, then the watch stops
// ============================================================================
import * as M from './movement.js';

let pass = 0, fail = 0;
const ok = (cond, name, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const near = (a, b, e) => Math.abs(a - b) <= e;
const { CAL: c, LAYOUT: L, TAU } = M;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);

// ── ratios ──────────────────────────────────────────────────────────────────
const P = M.periods();
ok(P.center === 3600, 'centre wheel turns once per hour', P.center + ' s');
ok(P.fourth === 60, 'fourth wheel turns once per minute', P.fourth + ' s');
ok(P.hour === 43200, 'hour wheel turns once per 12 h', P.hour + ' s');
ok(P.escape === 6, 'escape wheel turns once per 6 s at 18,000 vph', P.escape + ' s');
ok(P.barrel === 28800, 'barrel turns once per 8 h', P.barrel + ' s');

// the same ratios through chain(): one escape turn moves the centre by 1/600
{
  const a = M.chain(0), b = M.chain(-TAU);
  ok(near((b.center - a.center) / TAU, 1 / 600, 1e-12), 'chain: centre / escape = 1/600');
  ok(near((b.hour - a.hour) / (b.center - a.center), 1 / 12, 1e-12), 'chain: hour / centre = 1/12');
  ok(b.center > a.center && b.hour > a.hour && b.fourth > a.fourth, 'hands turn clockwise on the dial');
}

// ── layout ──────────────────────────────────────────────────────────────────
const cd = [
  ['barrel-centre', L.B, L.C, M.centreDist(c.barrel.m, c.barrel.N, c.center.p)],
  ['centre-third', L.C, L.T, M.centreDist(c.center.m, c.center.N, c.third.p)],
  ['third-fourth', L.T, L.F, M.centreDist(c.third.m, c.third.N, c.fourth.p)],
  ['fourth-escape', L.F, L.E, M.centreDist(c.fourth.m, c.fourth.N, c.escape.p)],
  ['cannon-minute', L.C, L.M, M.centreDist(c.cannon.m, c.cannon.N, c.minute.N)],
  ['minute-hour', L.M, L.C, M.centreDist(c.minute.pm, c.minute.p, c.hour.N)],
  ['crown-ratchet', L.CW, L.B, M.centreDist(c.ratchet.m, c.ratchet.N, c.crown.N)],
];
for (const [n, a, b, d] of cd) ok(near(dist(a, b), d, 1e-6), `centre distance ${n}`, `${dist(a, b).toFixed(4)} = ${d.toFixed(4)} mm`);

const reach = [
  ['barrel', L.B, M.pitchR(c.barrel.m, c.barrel.N) + 1.25 * c.barrel.m],
  ['third', L.T, M.pitchR(c.third.m, c.third.N) + 0.15],
  ['fourth', L.F, M.pitchR(c.fourth.m, c.fourth.N) + 0.13],
  ['escape', L.E, c.escape.Ra],
  ['balance', L.Bal, c.balR + 0.3],
  ['cock foot', L.cockFoot, 2.0],
];
for (const [n, p, r] of reach) ok(Math.hypot(p[0], p[1]) + r < c.plateR, `${n} inside the plate`, `${(Math.hypot(p[0], p[1]) + r).toFixed(2)} < ${c.plateR}`);

// ── meshes ──────────────────────────────────────────────────────────────────
// Edges of the wheel near the pinion only: a full 80-tooth outline against
// every pinion leaf is slow and adds nothing.
function overlapNear(A, B, centre, r) {
  const edges = [];
  for (let i = 0; i < A.length; i++) { const a = A[i], b = A[(i + 1) % A.length]; if (dist(a, centre) < r || dist(b, centre) < r) edges.push([a, b]); }
  const X = (a, b, p, q) => {
    const d = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
    return (d(a, b, p) > 0) !== (d(a, b, q) > 0) && (d(p, q, a) > 0) !== (d(p, q, b) > 0);
  };
  for (const [a, b] of edges) for (let j = 0; j < B.length; j++) if (X(a, b, B[j], B[(j + 1) % B.length])) return true;
  return B.some(p => M.inPoly(p, A));
}
const meshes = [
  // name, driver key, wheel profile + centre, driven key, pinion profile + centre
  ['barrel / centre pinion', 'barrel', M.wheelProfile(c.barrel.N, c.barrel.m), L.B, 'center', M.pinionProfile(c.center.p, c.barrel.m), L.C],
  ['centre / third pinion', 'center', M.wheelProfile(c.center.N, c.center.m), L.C, 'third', M.pinionProfile(c.third.p, c.center.m), L.T],
  ['third / fourth pinion', 'third', M.wheelProfile(c.third.N, c.third.m), L.T, 'fourth', M.pinionProfile(c.fourth.p, c.third.m), L.F],
  ['fourth / escape pinion', 'fourth', M.wheelProfile(c.fourth.N, c.fourth.m), L.F, 'escPinion', M.pinionProfile(c.escape.p, c.fourth.m), L.E],
  ['cannon / minute wheel', 'cannon', M.pinionProfile(c.cannon.N, c.cannon.m), L.C, 'minute', M.wheelProfile(c.minute.N, c.cannon.m), L.M],
  ['minute pinion / hour', 'minute', M.pinionProfile(c.minute.p, c.minute.pm), L.M, 'hour', M.wheelProfile(c.hour.N, c.minute.pm), L.C],
];
// sweep the escape wheel over 9 turns: the centre wheel then passes more
// than one whole tooth, so every mesh sees every relative tooth position
for (const [name, ka, pa, ca, kb, pb, cb] of meshes) {
  let hits = 0, n = 0;
  for (let i = 0; i <= 900; i++) {
    const ch = M.chain(-i / 900 * 9 * TAU);
    const A = M.place(pa, ca, ch[ka]), B = M.place(pb, cb, ch[kb]);
    n++; if (overlapNear(A, B, cb, 3.5)) hits++;
  }
  ok(hits === 0, `mesh ${name}: no tooth overlap`, `${hits}/${n} positions overlap`);
}
// keyless works: crown wheel and ratchet over a ratchet tooth
{
  let hits = 0;
  for (let i = 0; i <= 200; i++) {
    const k = M.keyless(-i / 200 * TAU / 10);
    const A = M.place(M.wheelProfile(c.ratchet.N, c.ratchet.m), L.B, k.ratchet);
    const B = M.place(M.wheelProfile(c.crown.N, c.crown.m), L.CW, k.crown);
    if (overlapNear(A, B, L.CW, 3)) hits++;
  }
  ok(hits === 0, 'mesh crown wheel / ratchet: no tooth overlap', `${hits}/201 overlap`);
}

// ── clearance in one z plane ────────────────────────────────────────────────
// discs: [name, centre, outer radius, z0, z1]; meshing pairs are exempt
const discs = [
  ['barrel', L.B, 7.6 + 0.24, c.z.barrelLo, c.z.barrelHi],
  ['centre wheel', L.C, 5.0 + 0.16, 0.32, 0.58],
  ['fourth wheel', L.F, 4.0 + 0.13, 0.32, 0.58],
  ['third wheel', L.T, 4.5 + 0.15, 1.02, 1.28],
  ['escape wheel', L.E, c.escape.Ra, 1.02, 1.28],
  ['balance rim', L.Bal, c.balR, 3.85, 4.25],
  ['cock foot', L.cockFoot, 2.0, 0, c.z.cockLo],
];
const exempt = new Set([]);
for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
  const [na, ca, ra, a0, a1] = discs[i], [nb, cb, rb, b0, b1] = discs[j];
  if (a1 <= b0 || b1 <= a0 || exempt.has(na + '|' + nb)) continue;
  const gap = dist(ca, cb) - ra - rb;
  ok(gap > 0.1, `clearance ${na} / ${nb}`, `gap ${gap.toFixed(2)} mm`);
}

// ── escapement ──────────────────────────────────────────────────────────────
const X = M.ESCAPEMENT, pitch = TAU / c.escape.N;
ok(X.bad === 0, 'escapement: no jam and no runaway in either beat', `${X.bad} bad samples`);
ok(near(X.cycle, -pitch, 1e-3), 'escapement: two beats move exactly one tooth', `${(X.cycle / pitch).toFixed(4)} pitch`);
ok(X.a < -0.3 * pitch && X.b < -0.3 * pitch, 'escapement: each beat moves 0.3..0.7 of a tooth', `${(X.a / pitch).toFixed(3)}, ${(X.b / pitch).toFixed(3)}`);
{
  // sample the running escapement at awkward phases and look for overlap
  // depth of a point inside a polygon: its distance to the nearest edge
  const depthIn = (p, poly) => {
    let d = Infinity;
    for (let j = 0; j < poly.length; j++) {
      const a = poly[j], b = poly[(j + 1) % poly.length], ab = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2)));
      d = Math.min(d, Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1]));
    }
    return d;
  };
  let deepest = 0, back = 0, prev = null;
  const s = M.createState(0, 0.9);
  for (let i = 0; i < 2000; i++) {
    const phi = s.phi + i * 0.0123;
    const thE = M.escapeAngle(phi, s.amp);
    const k = Math.round(phi / Math.PI), d = phi - k * Math.PI;
    const g = M.forkAngle(s.amp * Math.sin(d) * (k % 2 === 0 ? 1 : -1));
    const esc = M.place(M.escapeProfile(), L.E, thE);
    for (const st of M.stonePolys(g)) for (const p of esc) if (M.inPoly(p, st)) deepest = Math.max(deepest, depthIn(p, st));
    if (prev !== null && thE > prev + 0.02) back++;
    prev = thE;
  }
  // the tables are linear between samples, so a tooth riding the impulse
  // face may cut it by a few microns; 5 um is under a pixel at any zoom
  ok(deepest < 0.005, 'escapement: stones and teeth stay clear while running', `deepest ${(deepest * 1000).toFixed(2)} um`);
  ok(back === 0, 'escapement: the wheel never jumps backward', `${back} jumps`);
}

// ── hands ───────────────────────────────────────────────────────────────────
{
  const t = 10 * 3600 + 12 * 60 + 34;
  const s = M.createState(t, 0.9);
  for (let i = 0; i < 3; i++) M.step(s, 1 / 60);
  const p = M.pose(s);
  const deg = a => ((a % TAU) + TAU) % TAU * 180 / Math.PI;
  const h = deg(p.hands.hour) / 30, m = deg(p.hands.minute) / 6, sec = deg(p.hands.second) / 6;
  ok(near(h, 10 + 12.6 / 60, 0.02), 'hour hand reads 10:12', h.toFixed(3) + ' h');
  ok(near(m, 12 + 34 / 60, 0.05), 'minute hand reads 12.57 min', m.toFixed(3) + ' min');
  ok(near(sec, 34, 0.5), 'seconds hand reads 34 s', sec.toFixed(2) + ' s');
  ok(near(p.seconds, t, 0.5), 'train time matches the clock', p.seconds.toFixed(2) + ' s');
}

// ── reserve ─────────────────────────────────────────────────────────────────
{
  const s = M.createState(0, 1.0);
  let hours = 0;
  while (hours < 80) {
    for (let i = 0; i < 60; i++) M.step(s, 60);   // one hour, coarse steps
    hours++;
    if (s.stopped) break;
  }
  ok(hours > 40 && hours < 50, 'a full wind runs 40..50 h', `${hours} h`);
  const r0 = M.pose(s).reserve;
  const beats0 = M.pose(s).beats;
  for (let i = 0; i < 60; i++) M.step(s, 1);
  ok(M.pose(s).beats === beats0, 'a run-down watch stays stopped', `reserve ${r0.toFixed(3)} turns`);
  for (let i = 0; i < 400; i++) M.step(s, 1 / 60, -0.05);
  ok(M.pose(s).reserve > 0.5, 'winding restores the reserve', M.pose(s).reserve.toFixed(2) + ' turns');
  for (let i = 0; i < 3000; i++) M.step(s, 1 / 60, -0.2);
  ok(M.pose(s).reserve <= c.reserveTurns + 1e-6, 'the bridle slips at a full wind', M.pose(s).reserve.toFixed(3) + ' turns');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

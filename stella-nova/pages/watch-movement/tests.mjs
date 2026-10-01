// ============================================================================
//  WATCH MOVEMENT  ·  tests.mjs — node tests.mjs
// ────────────────────────────────────────────────────────────────────────────
//  Runs the same checks on every calibre in calibres/index.js:
//    rates ........ hour, minute and seconds hands turn at 12 h, 1 h, 1 min
//    meshes ....... no tooth outline enters its mate over many teeth
//    escapement ... no jam or runaway, a whole number of teeth per cycle,
//                   no deep overlap while running
//    hands ........ a state made at a clock time reads that time
//    reserve ...... the watch runs its stated reserve, then stops
//  Then the checks that belong to one calibre (cal.checks).
//  A calibre may skip a generic check that does not apply to its
//  mechanism with cal.skip = { name: reason } (for example a detent
//  escapement moves the wheel on one beat in two).
// ============================================================================
import * as G from './geom.js';
import { CALIBRES as META, loadAll } from './calibres/index.js';

// node tests.mjs                     every registered calibre
// node tests.mjs calibres/<id>.js    one calibre file (registered or not)
const only = process.argv[2];
const CALIBRES = only ? [(await import(new URL(only, import.meta.url))).default] : await loadAll();
// the lazy registry's picker entries must match the modules they name
if (!only) for (const [i, m] of META.entries()) {
  const c = CALIBRES[i], same = c.id === m.id && c.name === m.name && c.kind === m.kind && c.era === m.era;
  console.log(`${same ? 'PASS' : 'FAIL'}  registry entry ${m.id} matches its module`);
  if (!same) process.exitCode = 1;
}

let pass = 0, fail = 0, skipped = 0;
let SKIP = {};
const ok0 = (cond, name, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const near = (a, b, e) => Math.abs(a - b) <= e;
const { TAU } = G;

// edges of A near the centre of B only: a full 80-tooth outline against
// every pinion leaf is slow and adds nothing
export function overlapNear(A, B, centre, r) {
  const edges = [];
  for (let i = 0; i < A.length; i++) { const a = A[i], b = A[(i + 1) % A.length]; if (G.dist(a, centre) < r || G.dist(b, centre) < r) edges.push([a, b]); }
  for (const [a, b] of edges) for (let j = 0; j < B.length; j++) if (G.segX(a, b, B[j], B[(j + 1) % B.length])) return true;
  return B.some(p => G.inPoly(p, A));
}

function ok(cond, name, info = '') {
  for (const k in SKIP) if (name.startsWith(k)) { skipped++; console.log(`SKIP  ${name}  (${SKIP[k]})`); return; }
  ok0(cond, name, info);
}
for (const cal of CALIBRES) {
  SKIP = cal.skip || {};
  console.log(`\n── ${cal.name} (${cal.id}) ──`);
  const X = cal.ESC.tables;
  const thAt = sec => X.start + X.cycle * sec / (2 * cal.beatSeconds);

  // rates through chain(): seconds of train time -> hand angles
  {
    const a = cal.chain(thAt(0)), b = cal.chain(thAt(3600));
    ok(near((b.cannon - a.cannon) / TAU, 1, 1e-9), 'minute hand: 1 turn per hour', ((b.cannon - a.cannon) / TAU).toFixed(9));
    ok(near((b.hour - a.hour) / TAU, 1 / 12, 1e-9), 'hour hand: 1 turn in 12 h', ((b.hour - a.hour) / TAU * 12).toFixed(9) + ' / 12');
    if (a.second !== undefined) ok(near((b.second - a.second) / TAU, 60, 1e-6), 'seconds: 60 turns per hour', ((b.second - a.second) / TAU).toFixed(6));
    ok(b.cannon > a.cannon && b.hour > a.hour, 'hands turn clockwise on the dial');
  }

  // meshes over 20 minutes of train time (the slowest tooth passes)
  for (const [name, ka, pa, ca, kb, pb, cb] of cal.meshes) {
    let hits = 0, n = 0;
    for (let i = 0; i <= 900; i++) {
      const ch = cal.chain(thAt(i / 900 * 1200));
      n++; if (overlapNear(G.place(pa, ca, ch[ka]), G.place(pb, cb, ch[kb]), cb, 4)) hits++;
    }
    ok(hits === 0, `mesh ${name}: no tooth overlap`, `${hits}/${n} positions overlap`);
  }

  // escapement
  ok(X.bad === 0, 'escapement: no jam and no runaway', `${X.bad} bad samples`);
  ok(near(Math.abs(X.raw), cal.ESC.pitch, 1e-3), 'escapement: two beats move one tooth', `${(X.raw / cal.ESC.pitch).toFixed(4)} pitch (solved)`);
  ok(Math.abs(X.a) > 0.25 * cal.ESC.pitch && Math.abs(X.b) > 0.25 * cal.ESC.pitch, 'escapement: each beat moves a fair share', `${(X.a / cal.ESC.pitch).toFixed(3)}, ${(X.b / cal.ESC.pitch).toFixed(3)}`);
  {
    const s = cal.createState(0, 0.9);
    let deepest = 0;
    for (let i = 0; i < 1500; i++) {
      const phi = s.phi + i * 0.0123;
      deepest = Math.max(deepest, cal.ESC.depthAt(phi, s.amp));
    }
    // the tables are linear between samples: a few microns is under a pixel
    // a calibre may state a looser bound with its reason (cal.depthTol)
    const tol = cal.depthTol ? cal.depthTol[0] : 0.006;
    ok(deepest < tol, 'escapement: parts stay clear while running', `deepest ${(deepest * 1000).toFixed(2)} um < ${(tol * 1000).toFixed(0)} um${cal.depthTol ? ' (' + cal.depthTol[1] + ')' : ''}`);
  }

  // hands
  {
    const t = 10 * 3600 + 12 * 60 + 34;
    const s = cal.createState(t, 0.9);
    for (let i = 0; i < 3; i++) cal.step(s, 1 / 60);
    const p = cal.pose(s);
    const deg = a => ((a % TAU) + TAU) % TAU * 180 / Math.PI;
    ok(near(deg(p.hands.hour) / 30, 10 + 12.6 / 60, 0.02), 'hour hand reads 10:12', (deg(p.hands.hour) / 30).toFixed(3) + ' h');
    ok(near(deg(p.hands.minute) / 6, 12 + 34 / 60, 0.05), 'minute hand reads 12.57 min', (deg(p.hands.minute) / 6).toFixed(3) + ' min');
    if (p.hands.second) ok(near(deg(p.hands.second) / 6, 34, 0.5), 'seconds hand reads 34 s', (deg(p.hands.second) / 6).toFixed(2) + ' s');
    ok(near(p.seconds, t, 0.6), 'train time matches the clock', p.seconds.toFixed(2) + ' s');
  }

  // reserve
  {
    const s = cal.createState(0, 1.0);
    s.still = true;                       // a self-winder lies at rest
    let hours = 0;
    while (hours < 120) { for (let i = 0; i < 60; i++) cal.step(s, 60); hours++; if (s.stopped) break; }
    const [lo, hi] = cal.reserveHours;
    ok(hours >= lo && hours <= hi, `a full wind runs ${lo}..${hi} h`, `${hours} h`);
    const b0 = cal.pose(s).beats;
    for (let i = 0; i < 60; i++) cal.step(s, 1);
    ok(cal.pose(s).beats === b0, 'a run-down watch stays stopped');
    for (let i = 0; i < 400; i++) cal.step(s, 1 / 60, 0.02);
    ok(cal.pose(s).reserve > 0.5, 'winding restores the reserve', cal.pose(s).reserve.toFixed(2) + ' turns');
    for (let i = 0; i < 4000; i++) cal.step(s, 1 / 60, 0.05);
    // 1e-4 turns: a recoil escapement turns the train back a hair each swing
    ok(cal.pose(s).reserve <= cal.CAL.reserveTurns + 1e-4, 'the bridle slips at a full wind', cal.pose(s).reserve.toFixed(5) + ' turns');
  }

  if (cal.checks) for (const [name, fn] of cal.checks) { const [good, info] = fn({ overlapNear }); ok(good, name, info); }
}

console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(fail ? 1 : 0);

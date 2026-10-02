// ============================================================================
//  STIRLING ENGINE  ·  tests.mjs — node tests.mjs
// ────────────────────────────────────────────────────────────────────────────
//  Checks engine.js for each layout, over the full phase range:
//    rods ........ every connecting rod keeps its length at every angle
//    clearance ... no piston or displacer hits a head, a floor or another part
//    phase ....... the displacer reaches the top of its stroke alpha before
//                  the power piston does
//    cycle ....... positive work at 90°, less work at the ends of the range,
//                  efficiency = Carnot (exact in the Schmidt model)
//    processes ... the crank meets the four processes in the Stirling order
// ============================================================================
import { makeEngine, sliderCrank, D, TC, PHASE_MIN, PHASE_MAX } from './engine.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

for (const id of ['gamma', 'beta']) {
  const E = makeEngine(id), g = E.g, d = g.disp, p = g.pow;
  console.log(`\n── ${g.name} ──`);
  // rods
  let err = 0;
  for (let t = 0; t < 360; t++) for (const [r, l] of [[d.r, d.l], [p.r, p.l]]) {
    const k = sliderCrank(r, l, t * D);
    err = Math.max(err, Math.abs(Math.hypot(k.y - k.py, k.pz) - l));
  }
  ok(err < 1e-9, 'rods keep their length', `max error ${err.toExponential(1)} mm`);
  // clearances
  let top = 1e9, bot = 1e9, pw = 1e9, lug = 1e9;
  for (let al = PHASE_MIN; al <= PHASE_MAX; al += 2) for (let t = 0; t < 360; t += 1) {
    const k = E.kin(t * D, al * D);
    top = Math.min(top, d.head - k.dispTop);
    if (E.beta) {
      bot = Math.min(bot, k.dispBottom - k.crown);
      lug = Math.min(lug, (k.pin + p.pinToBottom) - (k.clevis + 5));     // clevis under the piston skirt
    } else {
      bot = Math.min(bot, k.dispBottom - d.floor);
      pw = Math.min(pw, p.head - k.crown);
    }
  }
  ok(top >= 3, 'displacer clears the hot head', `${top.toFixed(2)} mm`);
  ok(bot >= 3, E.beta ? 'displacer clears the piston crown' : 'displacer clears the cold plate', `${bot.toFixed(2)} mm`);
  if (E.beta) ok(lug >= 0.5, 'rod clevis clears the piston skirt', `${lug.toFixed(2)} mm`);
  else ok(pw >= 2, 'power piston clears its head', `${pw.toFixed(2)} mm`);
  // phase: crank angle of the top of each stroke
  for (const al of [60, 90, 120]) {
    let td = 0, tp = 0, yd = -1e9, yp = -1e9;
    for (let t = 0; t < 3600; t++) { const k = E.kin(t / 10 * D, al * D); if (k.clevis > yd) { yd = k.clevis; td = t / 10; } if (k.pin > yp) { yp = k.pin; tp = t / 10; } }
    const lead = ((tp - td) % 360 + 360) % 360;
    ok(Math.abs(lead - al) < 0.15, `displacer leads by ${al}°`, `${lead.toFixed(1)}°`);
  }
  // cycle
  const c90 = E.cycle(90 * D, 650), c30 = E.cycle(30 * D, 650), c150 = E.cycle(150 * D, 650);
  ok(c90.W > 0, 'positive work at 90°', `${c90.W.toFixed(3)} J per turn`);
  ok(c30.W < c90.W && c150.W < c90.W, 'less work at 30° and 150°', `${c30.W.toFixed(3)} / ${c150.W.toFixed(3)} J`);
  for (const Th of [400, 650, 900]) {
    const c = E.cycle(90 * D, Th);
    ok(Math.abs(c.eta - (1 - TC / Th)) < 2e-3, `efficiency = Carnot at ${Th} K`, `${c.eta.toFixed(4)} vs ${(1 - TC / Th).toFixed(4)}`);
  }
  const w0 = E.cycle(90 * D, TC + 1e-3).W;
  ok(Math.abs(w0) < 1e-4 * c90.W, 'no work with no temperature difference', `${w0.toExponential(1)} J`);
  // processes in order
  const seq = [];
  for (const q of c90.pts) if (seq[seq.length - 1] !== q.proc) seq.push(q.proc);
  while (seq.length > 1 && seq[0] === seq[seq.length - 1]) seq.pop();
  const s = seq.join(' '), want = 'heat expand cool compress';
  ok((s + ' ' + s).includes(want) && seq.length === 4, 'four processes in Stirling order', s);
  // mass fractions sum to one
  const gs = E.gas(E.kin(1, 90 * D), 650), m = gs.S.reduce((a, q) => a + q.m, 0);
  ok(Math.abs(m - 1) < 1e-12, 'gas masses sum to one', m.toFixed(12));
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;

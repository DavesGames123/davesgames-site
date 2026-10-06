// ============================================================================
//  PASCALINE & CURTA  ·  tests.mjs — node stella-nova/pages/calculators/tests.mjs
// ----------------------------------------------------------------------------
//  Checks mech.js:
//    pascaline sum ..... 400 seeded a + b: the wheels show (a + b) mod 10^6
//    pascaline carries . in a dial on wheel k, wheel j >= k falls once for
//                        each multiple of 10^(j+1) that the running total
//                        passes; a dial of one digit place gives the hand count
//    ripple ............ 999 999 + 1: six falls, one after the other in time,
//                        and the overflow is counted
//    pascaline product . 200 seeded a × b: (a × b) mod 10^6
//    pascaline motion .. wheel positions are continuous (mod 10) and every
//                        sautoir lift stays in [0, 1]
//    curta product ..... 300 seeded a × b (a < 10^8, b < 10^6, a b < 10^11):
//                        the result shows a b and the turn counter shows b
//    curta sum ......... a + b in two turns
//    curta carries ..... every turn: the carries are the hand carries of
//                        R + s 10^c, in rising wheel order inside the turn
//    curta ripple ...... 99 999 999 999 + 1: ten carries in one turn
//    curta motion ...... wheels continuous; integer digits between turns
// ============================================================================
import { UNITS, pascalJob, pascalPlan, pascalAt, curtaJob, curtaPlan, curtaAt, curtaTurn, digitsOf, valueOf, schoolCarries, CARRY_DUR } from './mech.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } };
let seed = 12345;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const rint = m => Math.floor(rnd() * m);
const N = UNITS[0].N, M6 = 10 ** N;

// expected falls of one dial of d tenths on wheel k from total v: wheel
// j >= k falls once for each multiple of 10^(j+1) that the total passes
const dialFalls = (v, k, d) => { let n = 0; for (let j = k; j < N; j++) { const p = 10 ** (j + 1); n += Math.floor((v + d * 10 ** k) / p) - Math.floor(v / p); } return n; };
const falls = dials => { let v = 0, n = 0; for (const { wheel, d } of dials) { n += dialFalls(v, wheel, d); v += d * 10 ** wheel; } return n; };

// ── pascaline ───────────────────────────────────────────────────────────────
{
  let bad = 0, badC = 0, badH = 0;
  for (let r = 0; r < 400; r++) {
    const a = rint(M6), b = rint(M6), P = pascalPlan(pascalJob('+', a, b, N), N);
    if (valueOf(P.digits) !== (a + b) % M6) bad++;
    if (P.carries !== falls(P.dials)) badC++;
    // b with one non-zero digit: a single dial, so the falls are the hand carries
    const k = rint(N), d = 1 + rint(9), b1 = d * 10 ** k, P1 = pascalPlan(pascalPlan(pascalJob('+', 0, a, N), N).dials.concat(pascalJob('+', 0, b1, N)), N);
    if (P1.carries !== schoolCarries(a, b1, N)) badH++;
  }
  ok(bad === 0, `pascaline: 400 sums correct (${bad} wrong)`);
  ok(badC === 0, `pascaline: sautoir falls = multiples passed (${badC} wrong)`);
  ok(badH === 0, `pascaline: one-place dial falls = hand carries (${badH} wrong)`);
}
{
  const P = pascalPlan(pascalJob('+', 999999, 1, N), N), C = P.events.filter(e => e.kind === 'carry');
  ok(valueOf(P.digits) === 0 && P.overflow === 1, `ripple: 999 999 + 1 shows ${valueOf(P.digits)}, overflow ${P.overflow}`);
  ok(C.length === 6 && C.every((e, i) => e.src === i), `ripple: 6 falls, wheel 0 .. 5 in order (${C.map(e => e.src).join(',')})`);
  ok(C.every((e, i) => !i || e.t0 >= C[i - 1].t0 + CARRY_DUR - 1e-9), 'ripple: each fall starts after the one before');
  const mid = pascalAt(P, C[2].t0 + 0.5 * CARRY_DUR);
  ok(mid.digits[0] === 0 && mid.digits[1] === 0 && mid.digits[3] === 9, `ripple: half way, low wheels at 0 and high wheels still at 9 (${mid.digits.join('')})`);
}
{
  let bad = 0;
  for (let r = 0; r < 200; r++) {
    const a = rint(1000), b = rint(100), P = pascalPlan(pascalJob('×', a, b, N), N);
    if (valueOf(P.digits) !== (a * b) % M6) bad++;
  }
  ok(bad === 0, `pascaline: 200 products correct (${bad} wrong)`);
}
{
  const P = pascalPlan(pascalJob('×', 987, 46, N), N);
  let jump = 0, liftBad = 0, prev = null;
  for (let t = 0; t <= P.T + 0.5; t += 0.01) {
    const Q = pascalAt(P, t);
    if (Q.lift.some(l => l < 0 || l > 1)) liftBad++;
    if (prev) for (let j = 0; j < N; j++) { const d = Math.abs(Q.pos[j] - prev.pos[j]); jump = Math.max(jump, Math.min(d, 10 - d)); }
    prev = Q;
  }
  ok(jump < 0.06, `pascaline: wheels move smoothly (largest step ${jump.toFixed(3)} tenths per 0.01 beat)`);
  ok(liftBad === 0, 'pascaline: sautoir lift in [0, 1]');
  ok(pascalAt(P, P.T + 1).value === (987 * 46) % M6, 'pascaline: the state after the plan is the product');
}

// ── curta ───────────────────────────────────────────────────────────────────
const U = UNITS[1];
{
  let bad = 0, badC = 0;
  for (let r = 0; r < 300; r++) {
    const b = rint(10 ** (1 + rint(6))), a = rint(Math.min(10 ** 8, Math.floor(1e11 / Math.max(1, b))));
    const P = curtaPlan(curtaJob('×', a, b, U), U);
    if (valueOf(P.res) !== a * b) bad++;
    if (valueOf(P.cnt) !== b) badC++;
  }
  ok(bad === 0, `curta: 300 products correct (${bad} wrong)`);
  ok(badC === 0, `curta: the turn counter shows the multiplier (${badC} wrong)`);
}
{
  let bad = 0;
  for (let r = 0; r < 200; r++) { const a = rint(1e8), b = rint(1e8), P = curtaPlan(curtaJob('+', a, b, U), U); if (valueOf(P.res) !== a + b || P.turns.length !== 2) bad++; }
  ok(bad === 0, `curta: 200 sums in two turns (${bad} wrong)`);
}
{
  let bad = 0, order = 0;
  for (let r = 0; r < 500; r++) {
    const R = digitsOf(rint(1e10), U.NR), S = digitsOf(rint(1e8), U.NS), c = rint(4);
    const T = curtaTurn(R, S, c), want = schoolCarries(valueOf(R), valueOf(S) * 10 ** c, U.NR);
    if (T.carries.length + (T.overflow ? 1 : 0) !== want || valueOf(T.after) !== (valueOf(R) + valueOf(S) * 10 ** c) % 1e11) bad++;
    if (T.carries.some((q, i) => i && q.f <= T.carries[i - 1].f)) order++;
  }
  ok(bad === 0, `curta: carries per turn = hand carries (${bad} wrong)`);
  ok(order === 0, `curta: carries come in rising wheel order inside a turn (${order} wrong)`);
}
{
  const P = curtaPlan([{ set: 99999999, shift: 0, n: 1 }], U);
  // 99 999 999 999 on the result wheels, then add 1 in one turn
  const R = digitsOf(99999999999, U.NR), T = curtaTurn(R, digitsOf(1, U.NS), 0);
  ok(T.carries.length === 10 && T.overflow && valueOf(T.after) === 0, `curta ripple: 10 carries and the overflow in one turn (${T.carries.length})`);
  ok(T.carries.every(q => q.f < 1), 'curta ripple: every carry inside the turn');
  ok(valueOf(P.res) === 99999999, 'curta: one turn shows the setting');
}
{
  const P = curtaPlan(curtaJob('×', 4711, 9876, U), U);
  let jump = 0, prev = null, notInt = 0;
  for (let t = 0; t <= P.T + 0.3; t += 0.004) {
    const Q = curtaAt(P, t);
    if (prev) for (let j = 0; j < U.NR; j++) { const d = Math.abs(Q.res[j] - prev.res[j]); jump = Math.max(jump, Math.min(d, 10 - d)); }
    prev = Q;
  }
  for (const e of P.turns) { const Q = curtaAt(P, e.t0 + 1.05); if (Q.res.some(v => Math.abs(v - Math.round(v)) > 1e-9)) notInt++; }
  ok(jump < 0.2, `curta: wheels move smoothly (largest step ${jump.toFixed(3)} tenths per 0.004 turn)`);
  ok(notInt === 0, 'curta: whole digits between turns');
  const Q = curtaAt(P, P.T + 1);
  ok(Q.value === 4711 * 9876 && Q.count === 9876, `curta: state after the plan ${Q.value} / ${Q.count}`);
}
console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);

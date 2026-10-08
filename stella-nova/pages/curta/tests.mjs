// ============================================================================
//  CURTA  ·  tests.mjs — node stella-nova/pages/curta/tests.mjs
// ----------------------------------------------------------------------------
//  Checks mech.js for Type I and Type II, against JS arithmetic (BigInt for
//  the wide products) with the real register widths:
//    add / sub ......... 400 seeded a + b and a - b: the result modulo 10^NR
//                        (a negative result shows its tens complement)
//    mul ............... 300 seeded a × b, plain and short cut: the result
//                        is a b modulo 10^NR, the counter shows b
//    div ............... 300 seeded restoring divisions with 0 .. k decimal
//                        places: counter = quotient, result = remainder
//    sqrt .............. 200 seeded odd-number roots: counter = floor root
//    carries ........... runs of nines: every carry in one turn, in rising
//                        wheel order, the overflow lost at the top
//    counter sign ...... 500 seeded turn sequences with the crank up or down
//                        and the reversing lever on or off, against a JS
//                        counter modulo 10^NC
//    sweep ............. the interference check, sampled through the turns:
//                        tooth geometry gives the model's tooth count, one
//                        tooth at a time per gear, idle carry gears clear of
//                        the carry tooth, the gears on two shafts clear,
//                        the carriage turns only when lifted off its dogs,
//                        the crank lifts only at home, sliders still while
//                        the crank turns, wheels continuous
// ============================================================================
import { UNITS, geo, plan, at, turnPlan, initState, teethMet, toothSegments, makeJob, shortcut, parseJob, digitsOf, valueOf, isqrt, TOOTH0, TOOTH_P, WIN, RES_CARRY, CNT_CARRY, CNT_DRIVE } from './mech.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } };
let seed = 20261007;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const rint = m => Math.floor(rnd() * m);
const rdig = nd => rint(10 ** (1 + rint(nd)));
const B = BigInt;
const mod = (x, m) => ((x % m) + m) % m;
const run = (U, job) => plan(U, job.actions, null, job.steps);

for (const U of UNITS) {
  const tag = `Type ${U.id}`, MR = 10n ** B(U.NR), MC = 10n ** B(U.NC);
  // ── add and subtract ──────────────────────────────────────────────────────
  {
    let bad = 0, badC = 0, badS = 0, badSC = 0;
    for (let r = 0; r < 400; r++) {
      const a = rdig(U.NS), b = rdig(U.NS);
      const P = run(U, makeJob(U, '+', a, b));
      if (B(valueOf(P.end.R)) !== mod(B(a) + B(b), MR)) bad++;
      if (valueOf(P.end.C) !== 2) badC++;
      const Q = run(U, makeJob(U, '−', a, b));
      if (B(valueOf(Q.end.R)) !== mod(B(a) - B(b), MR)) badS++;
      if (valueOf(Q.end.C) !== 0) badSC++;
    }
    ok(bad === 0, `${tag}: 400 sums modulo 10^${U.NR} (${bad} wrong)`);
    ok(badC === 0, `${tag}: counter shows 2 after a sum (${badC} wrong)`);
    ok(badS === 0, `${tag}: 400 differences, tens complement when negative (${badS} wrong)`);
    ok(badSC === 0, `${tag}: counter shows 0 after one add and one subtract turn (${badSC} wrong)`);
    const Z = run(U, makeJob(U, '−', 0, 1));
    ok(valueOf(Z.end.R) === 10 ** U.NR - 1, `${tag}: 0 - 1 shows ${U.NR} nines (${valueOf(Z.end.R)})`);
    ok(valueOf(Z.end.C) === 0, `${tag}: 0 - 1 counter 0`);
  }
  // ── multiply ──────────────────────────────────────────────────────────────
  {
    let bad = 0, badC = 0, badS = 0, badSC = 0, fewer = 0, used = 0;
    for (let r = 0; r < 300; r++) {
      const a = rdig(U.NS), b = rdig(U.NC);
      const P = run(U, makeJob(U, '×', a, b));
      if (B(valueOf(P.end.R)) !== mod(B(a) * B(b), MR)) bad++;
      if (valueOf(P.end.C) !== b) badC++;
      const job = makeJob(U, '×', a, b, { short: true }), Q = run(U, job);
      if (job.short) used++;
      if (B(valueOf(Q.end.R)) !== mod(B(a) * B(b), MR)) badS++;
      if (valueOf(Q.end.C) !== b) badSC++;
      if (Q.turns <= P.turns) fewer++;
    }
    ok(bad === 0, `${tag}: 300 products modulo 10^${U.NR}, plain (${bad} wrong)`);
    ok(badC === 0, `${tag}: counter shows the multiplier, plain (${badC} wrong)`);
    ok(badS === 0, `${tag}: 300 products, short cut (${badS} wrong)`);
    ok(badSC === 0, `${tag}: counter shows the multiplier with subtraction turns (${badSC} wrong)`);
    ok(fewer === 300 && used > 200, `${tag}: short cut never needs more turns (${fewer}/300, used ${used})`);
    const sc = shortcut(9, U.NC);
    ok(sc && sc.join(',') === '-1,1', `${tag}: 9 = 10 - 1 (${sc})`);
    const P9 = run(U, makeJob(U, '×', 4711, 9, { short: true }));
    ok(P9.turns === 2 && valueOf(P9.end.R) === 42399 && valueOf(P9.end.C) === 9, `${tag}: 4711 × 9 in two turns (${P9.turns}, ${valueOf(P9.end.R)})`);
  }
  // ── divide ────────────────────────────────────────────────────────────────
  {
    let bad = 0, badR = 0, errs = 0, tried = 0;
    for (let r = 0; r < 300; r++) {
      const k = rint(3), b = 1 + rdig(Math.min(5, U.NS)), a = rint(Math.min(10 ** U.NS, b * 10 ** (U.NC - k)));
      const job = makeJob(U, '÷', a, b, { k });
      if (job.err) { errs++; continue; }
      tried++;
      const P = run(U, job), M = a * 10 ** k;
      if (valueOf(P.end.C) !== Math.floor(M / b)) bad++;
      if (valueOf(P.end.R) !== M % b) badR++;
    }
    ok(bad === 0 && tried > 250, `${tag}: ${tried} divisions, counter = quotient (${bad} wrong, ${errs} refused)`);
    ok(badR === 0, `${tag}: result = remainder (${badR} wrong)`);
    const P = run(U, makeJob(U, '÷', 1000, 7, { k: 0 }));
    ok(valueOf(P.end.C) === 142 && valueOf(P.end.R) === 6, `${tag}: 1000 / 7 = 142 r 6 (${valueOf(P.end.C)} r ${valueOf(P.end.R)})`);
    // restoring: each quotient digit d costs d + 1 subtractions and 1 addition
    const q = 142, want = String(q).split('').reduce((s, d) => s + +d + 2, 0) + 2;
    ok(P.turns === want, `${tag}: 1000 / 7 takes ${want} turns with restoring (${P.turns})`);
    ok(makeJob(U, '÷', 10 ** (U.NS - 1), 1).err, `${tag}: a quotient wider than the counter is refused`);
  }
  // ── square root ───────────────────────────────────────────────────────────
  {
    let bad = 0, badR = 0, tried = 0;
    for (let r = 0; r < 200; r++) {
      const k = rint(Math.floor((U.NC - 1) / 2) + 1), N = rdig(U.NS);
      const job = makeJob(U, '√', N, 0, { k });
      if (job.err) continue;
      tried++;
      const P = run(U, job), M = N * 10 ** (2 * k), rt = isqrt(M);
      if (valueOf(P.end.C) !== rt) bad++;
      if (valueOf(P.end.R) !== M - rt * rt) badR++;
    }
    ok(bad === 0 && tried > 150, `${tag}: ${tried} square roots, counter = floor root (${bad} wrong)`);
    ok(badR === 0, `${tag}: result = N - root^2 (${badR} wrong)`);
    const P = run(U, makeJob(U, '√', 2, 0, { k: 2 }));
    ok(valueOf(P.end.C) === 141, `${tag}: sqrt 2 to 2 places is 1.41 (${valueOf(P.end.C)})`);
  }
  // ── carries over runs of nines ────────────────────────────────────────────
  {
    const s = initState(U); s.R = digitsOf(10 ** U.NR - 1, U.NR); s.S = digitsOf(1, U.NS);
    const T = turnPlan(s, U), car = T.wins.filter(w => w.kind === 'carry' && w.reg === 'R');
    ok(car.length === U.NR - 1 && T.overflowR === 1 && valueOf(T.R1) === 0, `${tag}: ${U.NR} nines + 1: ${U.NR - 1} carries and the overflow in one turn (${car.length})`);
    ok(car.every((w, i) => w.w === i + 1 && (!i || w.t0 > car[i - 1].t1)), `${tag}: the carries run up the wheels, each after the one below`);
    ok(car.every(w => w.t1 < 360), `${tag}: every carry inside the turn (last at ${car.at(-1).t1.toFixed(1)} deg)`);
    let bad = 0;
    for (let r = 0; r < 400; r++) {
      const c = rint(U.NC), len = 1 + rint(U.NR - 2), lo = rint(U.NR - len);
      // a run of nines from wheel lo, then add 1 at wheel lo
      const s2 = initState(U); s2.c = c;
      for (let j = 0; j < U.NR; j++) s2.R[j] = j >= lo && j < lo + len ? 9 : rint(9);
      if (lo < c) continue;
      s2.S = new Array(U.NS).fill(0); if (lo - c < U.NS) s2.S[lo - c] = 1; else continue;
      const T2 = turnPlan(s2, U), want = mod(B(valueOf(s2.R)) + 10n ** B(lo), MR);
      const nCar = T2.wins.filter(w => w.kind === 'carry' && w.reg === 'R').length + T2.overflowR;
      if (B(valueOf(T2.R1)) !== want || nCar !== Math.min(len, U.NR - lo)) bad++;
    }
    ok(bad === 0, `${tag}: 400 seeded runs of nines at random shifts ripple in one turn (${bad} wrong)`);
  }
  // ── counter sign logic ────────────────────────────────────────────────────
  {
    let bad = 0;
    for (let r = 0; r < 500; r++) {
      const acts = [], m = 3 + rint(12);
      let cnt = 0n, res = 0n, set = rdig(U.NS), c = 0, up = false, rev = false;
      acts.push({ a: 'set', v: set });
      for (let i = 0; i < m; i++) {
        const x = rnd();
        if (x < 0.2) { up = !up; acts.push({ a: 'lift', up }); }
        else if (x < 0.35) { rev = !rev; acts.push({ a: 'rev', on: rev }); }
        else if (x < 0.5) { c = rint(U.NC); acts.push({ a: 'shift', to: c }); }
        else {
          acts.push({ a: 'turn' });
          const dir = up !== rev ? -1n : 1n;
          cnt = mod(cnt + dir * 10n ** B(c), MC);
          res = mod(res + (up ? -1n : 1n) * B(set) * 10n ** B(c), MR);
        }
      }
      const P = plan(U, acts);
      if (B(valueOf(P.end.C)) !== cnt || B(valueOf(P.end.R)) !== res) bad++;
    }
    ok(bad === 0, `${tag}: 500 seeded sequences: counter +1 (add), -1 (crank up), inverted by the lever, mod 10^${U.NC} (${bad} wrong)`);
    const P = plan(U, [{ a: 'lift', up: true }, { a: 'turn' }]);
    ok(valueOf(P.end.C) === 10 ** U.NC - 1, `${tag}: one subtraction turn from 0: counter shows ${U.NC} nines (${valueOf(P.end.C)})`);
    const P2 = plan(U, [{ a: 'rev', on: true }, { a: 'lift', up: true }, { a: 'turn' }]);
    ok(valueOf(P2.end.C) === 1, `${tag}: reversing lever on: a subtraction turn counts +1`);
  }
  // ── interference sweep ────────────────────────────────────────────────────
  {
    const G = geo(U), segs = toothSegments(G), D = Math.PI / 180;
    // (1) tooth geometry: rows that overlap a gear at level s, sleeve down or up
    let badGeo = 0;
    for (let sl = 0; sl <= 9; sl++) for (const up of [false, true]) {
      const gy = G.levelY(sl), lift = up ? G.sleeve.lift : 0;
      const rows = new Set(segs.filter(q => q.y0 + lift < gy + G.gear.w / 2 && q.y1 + lift > gy - G.gear.w / 2).map(q => q.k));
      const want = teethMet(sl, up);
      if (rows.size !== want.length || want.some(k => !rows.has(k))) badGeo++;
    }
    ok(badGeo === 0, `${tag}: the tooth segments a gear overlaps are the rows the model counts (${badGeo} of 20 levels wrong)`);
    // the nearest segment above and below a gear clears it
    let minGap = Infinity;
    for (let sl = 0; sl <= 9; sl++) for (const up of [false, true]) {
      const gy = G.levelY(sl), lift = up ? G.sleeve.lift : 0;
      for (const q of segs) { const y0 = q.y0 + lift, y1 = q.y1 + lift; if (y0 >= gy + G.gear.w / 2 - 1e-9) minGap = Math.min(minGap, y0 - (gy + G.gear.w / 2)); if (y1 <= gy - G.gear.w / 2 + 1e-9) minGap = Math.min(minGap, gy - G.gear.w / 2 - y1); }
    }
    ok(minGap >= 0.2, `${tag}: a gear clears the segments above and below it by ${minGap.toFixed(2)} mm`);
    // (2) radial: teeth reach the gears, the drum core clears the gear tips
    ok(G.toothR > G.RS - G.gear.tip + 0.3 && G.toothR < G.RS - G.gear.root - 0.1, `${tag}: tooth tip ${G.toothR.toFixed(2)} between gear tip and root radii`);
    ok(G.drumR < G.RS - G.gear.tip - 0.2, `${tag}: drum core clears the gear tips`);
    // (3) two setting gears on neighbouring shafts at one level do not touch
    const sp = 2 * G.RS * Math.sin(G.pitch / 2 * D);
    ok(sp - 2 * G.gear.tip >= 0.4, `${tag}: neighbouring setting gears clear by ${(sp - 2 * G.gear.tip).toFixed(2)} mm`);
    // (4) wheels in the carriage: neighbours clear, counter clear of the result pinions
    const rwSp = 2 * (G.RW - G.hlw) * Math.sin(G.pitch / 2 * D), rcSp = 2 * (G.RCw - G.hlc) * Math.sin(G.pitch / 2 * D);
    ok(rwSp - 2 * (G.rw + 0.4) > 0.2, `${tag}: result wheels clear by ${(rwSp - 2 * (G.rw + 0.4)).toFixed(2)} mm`);
    ok(rcSp - 2 * (G.rc + 0.2) > 0.1, `${tag}: counter wheels clear by ${(rcSp - 2 * (G.rc + 0.2)).toFixed(2)} mm`);
    ok(G.RCw + G.hlc + 0.3 < G.RS - 1.6, `${tag}: counter wheels clear of the result pinions`);
    // (5) carry planes: the idle carry gear is above the carry tooth; the
    // counter drive tooth plane is clear of the counter carry gears
    ok(G.carry.idle - G.carry.t1 >= 0.4, `${tag}: idle carry gear ${(G.carry.idle - G.carry.t1).toFixed(2)} mm above the carry tooth`);
    ok(G.hub.ccarry[0] - G.hub.drive[1] >= 0.4 && G.hub.cidle - G.hub.ccarry[1] >= 0.4, `${tag}: counter drive, carry and idle planes are apart`);
    ok(G.hub.cidle + G.cpin.w < G.deck.y0, `${tag}: idle counter carry gears under the deck`);
    ok(G.sleeve.y1 + G.sleeve.lift < G.core.disc0, `${tag}: the lifted sleeve clears the carry disc`);
    // (6) in every turn: at most one tooth window at a time on a station
    let overlap = 0, beyond = 0, slideBad = 0, sliderMove = 0, jumps = 0, carNoLift = 0, liftAway = 0;
    for (let r = 0; r < 120; r++) {
      const acts = [{ a: 'set', v: rdig(U.NS) }];
      for (let i = 0; i < 8; i++) { const x = rnd(); if (x < 0.15) acts.push({ a: 'lift', up: rnd() < 0.5 }); else if (x < 0.3) acts.push({ a: 'shift', to: rint(U.NC) }); else if (x < 0.4) acts.push({ a: 'set', v: rdig(U.NS) }); else if (x < 0.45) acts.push({ a: 'clear' }); else acts.push({ a: 'turn' }); }
      const P = plan(U, acts);
      for (const e of P.events) if (e.a === 'turn') {
        for (const list of [...e.T.byS, ...e.T.byQ]) for (let i = 1; i < list.length; i++) if (list[i].t0 < list[i - 1].t1) overlap++;
        for (const w of e.T.wins) if (w.t0 <= 0 || w.t1 >= 360) beyond++;
        // a carry gear is down when its carry window runs
        for (const w of e.T.wins) if (w.kind === 'carry' && w.reg === 'R') { const Q = at(P, e.t0 + (w.t0 + w.t1) / 2 / 360 * e.dur); if (Q.slide[w.p] < 0.999) slideBad++; }
      }
      let prev = null;
      for (let t = 0; t <= P.T + 0.05; t += 0.005) {
        const Q = at(P, t);
        if (prev) {
          if (Q.phase === 'turn' && prev.phase === 'turn' && Q.set.some((v, g) => v !== prev.set[g])) sliderMove++;
          for (let j = 0; j < U.NR; j++) { const d = Math.abs(Q.R[j] - prev.R[j]); if (Math.min(d, 10 - d) > 0.6) jumps++; }
          if (Math.abs(Q.car - prev.car) > 1e-9 && Q.carLift < 0.999) carNoLift++;
          if (Math.abs(Q.lift - prev.lift) > 1e-9 && Q.drum % 360 > 1e-6) liftAway++;
        }
        prev = Q;
      }
    }
    ok(overlap === 0, `${tag}: one tooth at a time on every gear (${overlap} overlaps)`);
    ok(beyond === 0, `${tag}: every tooth and carry window inside the turn (${beyond})`);
    ok(slideBad === 0, `${tag}: the carry gear is down whenever the carry tooth passes it (${slideBad})`);
    ok(sliderMove === 0, `${tag}: sliders still while the crank turns (${sliderMove})`);
    ok(jumps === 0, `${tag}: result wheels move smoothly (${jumps} jumps)`);
    ok(carNoLift === 0, `${tag}: the carriage turns only when lifted off its dogs (${carNoLift})`);
    ok(liftAway === 0, `${tag}: the crank lifts only at home (${liftAway})`);
    // windows in degrees, for the record
    ok(TOOTH0 - WIN / 2 > 0 && RES_CARRY - WIN / 2 > TOOTH0 + 8 * TOOTH_P + WIN / 2 && CNT_CARRY > CNT_DRIVE, `${tag}: add, then counter carry, then result carry`);
  }
}
// ── parser ──────────────────────────────────────────────────────────────────
{
  const a = parseJob('4711 × 23'), b = parseJob('1000/7'), c = parseJob('sqrt 2'), d = parseJob('12-5');
  ok(a && a.op === '×' && a.a === 4711 && a.b === 23, 'parse 4711 × 23');
  ok(b && b.op === '÷' && b.b === 7, 'parse 1000/7');
  ok(c && c.op === '√' && c.a === 2, 'parse sqrt 2');
  ok(d && d.op === '−' && d.b === 5, 'parse 12-5');
}
console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);

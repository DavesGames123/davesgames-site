// ============================================================================
//  WATCH MOVEMENT  ·  calibres/pinlever.js — Roskopf pin-lever pocket watch
// ────────────────────────────────────────────────────────────────────────────
//  G.-F. Roskopf's "proletarian watch" (1867): a cheap, robust pocket watch
//  for everyone. An original calibre on the Roskopf system. No DOM, no THREE.
//
//  THE ROSKOPF IDEA
//    There is no centre wheel and no fourth wheel. An oversized barrel sits
//    off centre, reaching past the middle of the plate, and turns once in
//    3 hours: it takes the place of the minute wheel. On the dial side the
//    barrel carries a wheel (36) that drives the cannon pinion (12) and a
//    pinion (10) that drives the hour wheel (40). The big barrel holds a
//    long, strong mainspring, so a cheap train still runs 30 hours.
//
//  POWER PATH  (driver / driven, module)
//    barrel 80 / second pinion 8  (0.225)   barrel 1 turn in 3 h
//    second 72 / third pinion 5   (0.14)    third 48 turns an hour
//    third  60 / escape pinion 6  (0.10)    escape 8 turns a minute
//    escape wheel 18 teeth (pin-pallet), 36 beats a turn: 17,280 vph,
//    balance at 2.4 Hz. Hands: barrel 36 / cannon 12 (x3), barrel pinion
//    10 / hour 40 (/4, so 12 h).
//
//  PIN PALLETS
//    The lever carries two round steel pins in place of jewelled stones.
//    The impulse planes are on the escape teeth instead: each tooth's top
//    rises from a low locking corner to its trailing tip, so a pin that
//    lifts clear of the locking corner rides up the plane and is pushed
//    out. The escape wheel turns toward +angle here (three meshes from the
//    barrel, which must turn clockwise on the dial side to drive the hands
//    the right way), so the solver drives it with dir +1.
//
//  GREP MAP
//    const CAL / const L ...... counts, sizes, z planes, layout
//    function pinTeeth ........ the pin-pallet escape teeth
//    function pinEscapement ... pins, tables, angles (solveBeats, dir +1)
//    function chain ........... every angle from the escape angle
//    const PARTS .............. the part cards
// ============================================================================
import * as G from '../geom.js';
import { solveBeats, look } from '../escapement.js';
import { makeRunner } from './common.js';
const { TAU, D, pol, add, sub, rot, ang, clamp, centreDist, drive, driveInv, gearSpec, fmtPeriod } = G;

export const CAL = {
  plateR: 19.5, plateT: 1.6, bph: 17280, fBal: 2.4,
  barrel: { N: 80, m: 0.225, mw: 36, mwm: 0.2, mp: 10, mpm: 0.192 },
  second: { N: 72, m: 0.14, p: 8 },
  third: { N: 60, m: 0.10, p: 5 },
  escape: { N: 18, Ra: 2.5, Rf: 1.86, p: 6 },
  cannon: { N: 12, m: 0.2 }, hour: { N: 40, m: 0.192 },
  ratchet: { N: 50, m: 0.16 }, crown: { N: 24, m: 0.16 }, winding: { N: 16, m: 0.16 },
  balR: 5.6, jewelR: 1.1, forkLen: 3.2, forkBank: 12 * D, palletSpan: 25 * D,
  z: {
    second: 0.4, third: 1.15, escape: 0.45, fork: 0.45, barrelTeeth: 1.0,
    barrelLo: 0.85, barrelHi: 3.0, bridgeLo: 3.15, bridgeHi: 4.1, palletCockLo: 1.4, palletCockHi: 2.0,
    balance: 4.55, hairspring: 5.2, cockLo: 5.55, cockHi: 6.4, ratchet: 4.27,
    cannon: -1.85, minute: -1.85, hour: -2.3, dialLo: -3.1, dialHi: -2.8,
  },
  reserveTurns: 10,
};
const c = CAL;

// ── layout: the barrel reaches past the centre of the plate ────────────────
const C = [0, 0];
const B = pol(centreDist(c.barrel.mwm, c.barrel.mw, c.cannon.N), 90 * D);          // 4.8 mm above the centre
const S = add(B, pol(centreDist(c.barrel.m, c.barrel.N, c.second.p), -40 * D));
const T = add(S, pol(centreDist(c.second.m, c.second.N, c.third.p), -105 * D));
const E = add(T, pol(centreDist(c.third.m, c.third.N, c.escape.p), -150 * D));
const cdRC = centreDist(c.ratchet.m, c.ratchet.N, c.crown.N);
const CW = [0, B[1] + cdRC];

// ── pin-pallet escapement ──────────────────────────────────────────────────
// Teeth for a wheel turning toward -angle (as geom.escapeProfile): a short
// locking face to a low corner, then the impulse plane rising back to the
// tip. pinEscapement mirrors them so the wheel turns toward +angle.
export function pinTeeth(N, Ra, Rf, w = TEETH_W) {
  const p = TAU / N, h = Ra - Rf, low = Ra - 0.36 * h, out = [];
  const f = -w[0] * p, tip = w[1] * p, back = w[2] * p;   // locking face, tip, trailing root
  for (let k = 0; k < N; k++) {
    const c0 = k * p;
    const r0 = c0 + back - p;                              // the trailing root of the previous tooth
    for (let j = 0; j <= 3; j++) out.push(pol(Rf, r0 + (c0 + f - 0.04 * p - r0) * j / 3));
    out.push(pol(low, c0 + f));                            // locking corner
    for (let j = 1; j <= 3; j++) out.push(pol(low + (Ra - low) * j / 3, c0 + f + (tip - f) * j / 3));
    out.push(pol(Ra - 0.05 * h, c0 + tip + 0.03 * p));
    out.push(pol(Rf + 0.3 * h, c0 + back - 0.04 * p));
  }
  return out;
}
// tooth shape as shares of the pitch: locking face before the tooth centre,
// the tip and the trailing root after it
export let TEETH_W = [0.2, 0.14, 0.26];
// The escapement is solved in the orientation of the jewelled lever (wheel
// toward -angle, as escapement.js), then reflected across its own line of
// centres (E, P and the balance, direction psi) into the world, where the
// wheel turns toward +angle. A reflection keeps E, P and Bal in place,
// swaps the two pins and turns every angle the other way.
function pinEscapement(o) {
  const { E, psi, N, Ra, Rf, span, forkLen, jewelR, bank } = o;
  const k = (Ra / N) / (2.3 / 15), rp = 0.15 * k;
  const P = add(E, pol(Ra / Math.cos(span), psi));
  const Bal = add(P, pol(forkLen + jewelR, psi));
  const teeth = pinTeeth(N, Ra, Rf);
  const pitch = TAU / N;
  // pin centre at fork 0: a sweep of the solver found clean beats (no jam,
  // no recoil, one tooth per two beats) for offsets +0.055..+0.14 mm from
  // the base below; +0.095 is the middle of that band
  const rc0 = o.rc0 ?? Ra - 0.36 * (Ra - Rf) * 0.5 + rp * 0.55 + 0.095;
  const pinPoly = cen => G.circlePoly(rp, 14, cen);
  // canonical (solver) frame
  const pinAt = sgn => add(E, pol(rc0, psi + sgn * span));
  const pinsC = g => [1, -1].map(sgn => pinPoly(add(P, rot(sub(pinAt(sgn), P), g))));
  const hits = (th, g) => { const poly = G.place(teeth, E, th); return pinsC(g).some(q => G.polysOverlap(q, poly)); };
  const Tb = solveBeats({ hits, g0: bank, g1: -bank, pitch, dir: -1 });
  const forkC = b => clamp(-b * jewelR / forkLen, -bank, bank);
  const lift = bank * forkLen / jewelR;
  function escC(phi, amp) {
    const kk = Math.round(phi / Math.PI), d = phi - kk * Math.PI;
    const u = (bank - forkC(amp * Math.sin(d))) / (2 * bank);
    const cyc = Math.floor(kk / 2), odd = kk - 2 * cyc;
    return Tb.start + cyc * Tb.cycle + (odd ? Tb.a + look(Tb.B, u) : look(Tb.A, u));
  }
  // reflection across the line through E at angle psi
  const refl = q => { const v = rot(sub(q, E), -psi); return add(E, rot([v[0], -v[1]], psi)); };
  const reflLocal = q => { const v = rot(q, -psi); return rot([v[0], -v[1]], psi); };
  const wheel = teeth.map(reflLocal).reverse();          // world profile, turned by the world angle
  const forkAngle = b => -forkC(b);
  const escapeAngle = (phi, amp) => -escC(phi, amp);
  const stonePolys = gw => pinsC(-gw).map(poly => poly.map(refl).reverse());
  const pinWorld = sgn => refl(pinAt(sgn));
  function depthAt(phi, amp) {
    const esc = G.place(teeth, E, escC(phi, amp)), st = pinsC(forkC(amp * Math.sin(phi)));
    let dd = 0;
    for (const s of st) for (const q of esc) if (G.inPoly(q, s)) dd = Math.max(dd, G.depthIn(q, s));
    return dd;
  }
  // tables in world terms: the train sees the wheel turn toward +angle
  const tables = { ...Tb, start: -Tb.start, cycle: -Tb.cycle, a: -Tb.a, b: -Tb.b, raw: -Tb.raw };
  return { E, P, Bal, psi, N, Ra, Rf, wheel, pitch, rp, pinAt: pinWorld, stonePolys, forkAngle, lift, escapeAngle, depthAt, tables, canonical: Tb, bank, jewelR, forkLen, span };
}
export const ESC = pinEscapement({
  E, psi: -150 * D, N: c.escape.N, Ra: c.escape.Ra, Rf: c.escape.Rf, span: c.palletSpan,
  forkLen: c.forkLen, jewelR: c.jewelR, bank: c.forkBank,
});
export const L = {
  C, B, S, T, E, P: ESC.P, Bal: ESC.Bal, CW, psi: ESC.psi,
  cockFoot: add(ESC.Bal, pol(7.9, 150 * D)),
  palletFoot: add(ESC.P, pol(1.9, ESC.psi + 90 * D)),
  click: add(B, pol(5.35, 200 * D)),
  feet: [[-11.2, 1.0], [12.6, 5.5], [-3.0, -6.6]],
};

// ── kinematics ─────────────────────────────────────────────────────────────
export function chain(thE) {
  const third = driveInv(thE, c.third.N, c.escape.p, ang(T, E));
  const secondWheel = driveInv(third, c.second.N, c.third.p, ang(S, T));
  const barrel = driveInv(secondWheel, c.barrel.N, c.second.p, ang(B, S));
  const cannon = drive(barrel, c.barrel.mw, c.cannon.N, ang(B, C));
  const hour = drive(barrel, c.barrel.mp, c.hour.N, ang(B, C));
  return { escape: thE, escPinion: thE, third, secondWheel, barrel, cannon, hour, center: cannon };
}
export function keyless(thR) {
  const crown = driveInv(thR, c.crown.N, c.ratchet.N, ang(CW, B));
  return { ratchet: thR, crown, stem: -crown * c.crown.N / c.winding.N };
}
const run = makeRunner({
  escAngle: ESC.escapeAngle, lift: ESC.lift, fBal: c.fBal, beat: 1 / 4.8, amp0: 260 * D,
  startE: ESC.tables.start, cycleE: ESC.tables.cycle, chain, reserveTurns: c.reserveTurns,
  spent: (ch, C0) => -(ch.barrel - C0.barrel) / TAU,
  extra: (s, ch, p) => ({ fork: ESC.forkAngle(p.balance), ...keyless(-s.wound * TAU) }),
});

export function periods() {
  const escape = c.escape.N * 2 / (c.bph / 3600);
  const third = escape * c.third.N / c.escape.p, secondWheel = third * c.second.N / c.third.p, barrel = secondWheel * c.barrel.N / c.second.p;
  const cannon = barrel * c.cannon.N / c.barrel.mw, hour = barrel * c.hour.N / c.barrel.mp;
  return { escape, third, secondWheel, barrel, cannon, center: cannon, hour, balance: 1 / c.fBal };
}
const PER = periods();

const NICKEL = 'brass, nickel plated';
export const PARTS = {
  plate: { name: 'Pillar plate', group: 'Frame', role: 'A plain nickel-plated plate. Roskopf made every part as simple as it could be made, to sell a good watch for the price of a day\'s wage.', specs: [['Diameter', `${(c.plateR * 2).toFixed(0)} mm (about 19 lignes)`], ['Finish', 'nickel, plain']] },
  jewel: { name: 'Jewel bearing', group: 'Frame', role: 'Only the balance runs in jewels here; the rest of the train turns in plain holes in the brass.', specs: [['Jewels', '2 (balance)']] },
  barrel: { name: 'Barrel', group: 'Power', role: 'The heart of the Roskopf system. It is so large it reaches past the centre of the plate, and it turns once in 3 hours, in the place of the minute wheel. On the dial side it drives the hands directly.', specs: gearSpec(80, 0.225, [['Turns', '1 in 3 h'], ['Dial side', 'wheel 36 and pinion 10']]), rate: 'barrel' },
  mainspring: { name: 'Mainspring', group: 'Power', role: 'The big barrel holds a long, strong spring, so the watch runs a day and more with a simple train.', specs: [['Power reserve', `${(c.reserveTurns * PER.barrel / 3600).toFixed(0)} h`], ['Material', 'carbon steel']], live: 'reserve' },
  secondWheel: { name: 'Second wheel', group: 'Going train', role: 'There is no centre wheel: the barrel drives this large wheel, which drives the third pinion.', specs: gearSpec(72, 0.14, [['Pinion', '8 leaves'], ['Turns', `${(3600 / PER.secondWheel).toFixed(2)} times an hour`]]), rate: 'secondWheel' },
  third: { name: 'Third wheel', group: 'Going train', role: 'The last wheel of a three-wheel train: it drives the escape pinion directly. There is no fourth wheel, and so no seconds hand.', specs: gearSpec(60, 0.10, [['Pinion', '5 leaves'], ['Turns', '48 times an hour']]), rate: 'third' },
  escape: { name: 'Pin-pallet escape wheel', group: 'Escapement', role: 'Its teeth carry the impulse planes: each tooth top rises from a low locking corner to its tip, and lifts a pin as it passes. In a jewelled lever the slope is on the pallet stones instead.', specs: [['Teeth', '18'], ['Tip Ø', `${(c.escape.Ra * 2).toFixed(1)} mm`], ['Pinion', '6 leaves'], ['Turns', '8 a minute']], rate: 'escape' },
  pallet: { name: 'Pin lever', group: 'Escapement', role: 'A flat steel lever with two hardened steel pins in place of ruby stones. Cheap to make and hard to damage, it gave the dollar watch its long life.', specs: [['Pallets', 'two steel pins'], ['Swing', `±${(c.forkBank / D).toFixed(0)}° on the banking`], ['Lift angle', `${(ESC.lift / D).toFixed(0)}° of balance`]], live: 'fork' },
  balance: { name: 'Balance', group: 'Regulator', role: 'A plain nickel balance with no screws. The lever acts through a steel pin on the roller.', specs: [['Diameter', `${(c.balR * 2).toFixed(1)} mm`], ['Frequency', '2.4 Hz · 17,280 vph']], live: 'balance' },
  hairspring: { name: 'Hairspring', group: 'Regulator', role: 'A flat steel spiral; its outer end is pinned in a stud on the cock.', specs: [['Coils', '11']], live: 'balance' },
  bridge: { name: 'Train bridge', group: 'Frame', role: 'One large plain bridge holds the barrel and the whole train: fewer parts to make and to fit.', specs: [['Material', NICKEL]] },
  palletCock: { name: 'Pallet cock', group: 'Frame', role: 'A small low bridge for the upper pivot of the pin lever.', specs: [] },
  cock: { name: 'Balance cock', group: 'Frame', role: 'The bridge of the balance, with a simple regulator index.', specs: [['Jewels', '1']] },
  ratchet: { name: 'Ratchet wheel', group: 'Keyless works', role: 'Square on the barrel arbor; the crown winds the spring through it.', specs: gearSpec(50, 0.16), live: 'ratchet' },
  crownWheel: { name: 'Crown wheel', group: 'Keyless works', role: 'It passes the turn of the winding pinion to the ratchet.', specs: gearSpec(24, 0.16) },
  click: { name: 'Click', group: 'Keyless works', role: 'A pawl that lets the ratchet turn one way only.', specs: [] },
  stem: { name: 'Stem and crown', group: 'Keyless works', role: 'The crown winds the mainspring; pulled out, it sets the hands.', specs: [['Winding pinion', '16 leaves']] },
  screws: { name: 'Screws', group: 'Frame', role: 'Plain polished steel screws.', specs: [] },
  barrelWheel: { name: 'Barrel minute wheel', group: 'Motion works', role: 'Fixed to the barrel on the dial side. The barrel turns once in 3 hours, so this wheel (36) turns the cannon pinion (12) once an hour.', specs: gearSpec(36, 0.2, [['Pinion', '10 leaves, drives the hour wheel']]), rate: 'barrel' },
  cannon: { name: 'Cannon pinion', group: 'Motion works', role: 'On a fixed post at the centre: there is no centre arbor in a Roskopf. It carries the minute hand.', specs: [['Leaves', '12'], ['Module', '0.200 mm']], rate: 'cannon' },
  hourWheel: { name: 'Hour wheel', group: 'Motion works', role: 'Driven by the barrel\'s pinion: 40/10 x 3 h = 12 h.', specs: gearSpec(40, 0.192), rate: 'hour' },
  dial: { name: 'Dial', group: 'Display', role: 'A plain enamel dial, no seconds: the three-wheel train has no fourth wheel to carry them.', specs: [['Material', 'enamel on copper']] },
  hourHand: { name: 'Hour hand', group: 'Display', role: 'One turn in 12 hours.', specs: [['Style', 'spade']], rate: 'hour' },
  minuteHand: { name: 'Minute hand', group: 'Display', role: 'One turn per hour.', specs: [['Style', 'spade']], rate: 'cannon' },
};

export default {
  id: 'pinlever', mech: 'pinlever', name: 'Pin-Lever Roskopf', kind: 'Pocket watch', era: 'Roskopf, 1867',
  blurb: 'The people\'s watch: a giant barrel in place of the centre wheel, a three-wheel train, and a lever with steel pins instead of jewels.',
  CAL, L, ESC, chain, ...run, periods, PARTS, plateR: c.plateR,
  zRange: [-3.6, 6.7], focus: [(E[0] + ESC.P[0]) / 2, (E[1] + ESC.P[1]) / 2, 0.6],
  train: [['barrel', 'Barrel', 80, '—'], ['secondWheel', 'Second', 72, 8], ['third', 'Third', 60, 5], ['escape', 'Escape', 18, 6]],
  freq: '2.4 Hz · 17,280 vph', beatSeconds: 1 / 4.8, reserveHours: [26, 34], hoursPerTurn: PER.barrel / 3600,
  trainNote: 'Three wheels, not four: barrel 80/8 x second 72/5 x third 60/6 = 1,440 escape turns per barrel turn. The barrel itself turns once in 3 hours and drives the hands.',
  about: [
    ['The idea', 'In 1867 Georges-Frédéric Roskopf set out to make a reliable watch a worker could buy with a few days\' pay. He cut the parts to the fewest that would work, and made each one plain and sturdy.'],
    ['The barrel', 'He dropped the centre wheel and made the barrel huge, reaching past the middle of the plate. It turns once in 3 hours, like a minute wheel, and on the dial side it drives the cannon pinion and the hour wheel directly. The minute hand sits on a fixed post.'],
    ['Pin pallets', 'The lever has two round steel pins instead of ruby stones. The slopes that give the impulse are cut on the escape teeth instead: each tooth top climbs from a low locking corner to its tip and lifts the pin as it passes.'],
    ['Legacy', 'Pin-lever watches and clocks were made by the hundred million into the 1970s: the dollar watches, the alarm clocks and the cheap wristwatches of the 20th century all used this escapement.'],
    ['Source', 'An original calibre on the Roskopf system: barrel 80, second 72/8, third 60/5, escape 18/6, 17,280 beats an hour (escape 8 turns a minute). The pin escapement is collision-solved like the others.'],
  ],
  meshes: [
    ['barrel / second pinion', 'barrel', G.wheelProfile(80, 0.225), B, 'secondWheel', G.pinionProfile(8, 0.225), S],
    ['second / third pinion', 'secondWheel', G.wheelProfile(72, 0.14), S, 'third', G.pinionProfile(5, 0.14), T],
    ['third / escape pinion', 'third', G.wheelProfile(60, 0.10), T, 'escPinion', G.pinionProfile(6, 0.10), E],
    ['barrel wheel / cannon pinion', 'barrel', G.wheelProfile(36, 0.2), B, 'cannon', G.pinionProfile(12, 0.2), C],
    ['barrel pinion / hour wheel', 'barrel', G.pinionProfile(10, 0.192), B, 'hour', G.wheelProfile(40, 0.192), C],
  ],
  fmtPeriod,
  // the third wheel sits over the escape wheel: look in through the gap
  // beyond the escape wheel, from just outside the movement side
  views: { escapement: { az: -68, el: -28, distK: 0.87 } },
  checks: [
    ['keyless: crown wheel and ratchet do not overlap', ({ overlapNear }) => {
      let hits = 0;
      for (let i = 0; i <= 200; i++) {
        const kk = keyless(-i / 200 * TAU / 10);
        if (overlapNear(G.place(G.wheelProfile(50, 0.16), B, kk.ratchet), G.place(G.wheelProfile(24, 0.16), CW, kk.crown), CW, 3)) hits++;
      }
      return [hits === 0, `${hits}/201 overlap`];
    }],
    ['layout: the barrel reaches past the centre of the plate', () => {
      const reach = G.pitchR(c.barrel.m, c.barrel.N) - G.dist(B, C);
      return [reach > 3, `the barrel teeth pass the centre by ${reach.toFixed(2)} mm`];
    }],
    ['layout: wheels in one z plane keep clear', () => {
      const discs = [['barrel', B, 9.3, 0.85, 3.0], ['second', S, 5.2, 0.27, 0.53], ['third', T, 3.15, 1.02, 1.28], ['escape', E, c.escape.Ra, 0.34, 0.56],
        ['balance', ESC.Bal, c.balR, 4.35, 4.75], ['cock foot', L.cockFoot, 1.9, 0, 5.55], ...L.feet.map((f, i) => ['foot ' + i, f, 1.0, 0, 3.15])];
      let worst = Infinity, which = '';
      for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i], b = discs[j];
        if (a[4] <= b[3] || b[4] <= a[3]) continue;
        const gg = G.dist(a[1], b[1]) - a[2] - b[2];
        if (gg < worst) { worst = gg; which = `${a[0]} / ${b[0]}`; }
      }
      return [worst > 0.1, `smallest gap ${worst.toFixed(2)} mm (${which})`];
    }],
    ['layout: parts inside the plate', () => {
      const r = Math.max(G.len(B) + 9.3, G.len(ESC.Bal) + c.balR + 0.3, G.len(L.cockFoot) + 2, G.len(S) + 5.2, ...L.feet.map(f => G.len(f) + 1));
      return [r < c.plateR, `${r.toFixed(2)} < ${c.plateR}`];
    }],
  ],
};

// ============================================================================
//  WATCH MOVEMENT  ·  calibres/lever.js — Swiss lever pocket watch
// ────────────────────────────────────────────────────────────────────────────
//  An original 18,000 vph pocket-watch calibre in millimetres. The tooth
//  counts and modules follow the Unitas / ETA 6497 class: a 36.6 mm plate,
//  barrel module 0.19, centre wheel 1 turn per hour, small seconds at 6.
//  No DOM and no THREE (tests.mjs runs it in Node).
//
//  FRAME
//    x right, y to 12 o'clock (the crown), z out of the caseback. The dial
//    faces -z. The plate top is z = 0. A positive angle turns
//    counterclockwise as seen from the caseback, which is clockwise on the
//    dial, so the hands read the right way.
//
//  POWER PATH  (driver wheel / driven pinion, module)
//    barrel 80 / centre pinion 10 (0.19)    barrel 1 turn in 8 h
//    centre 80 / third pinion 10   (0.125)  centre 1 turn in 1 h
//    third  75 / fourth pinion 10  (0.12)   third  1 turn in 7.5 min
//    fourth 80 / escape pinion 8   (0.10)   fourth 1 turn in 1 min
//    escape wheel 15 teeth, Swiss lever, balance at 2.5 Hz = 18,000 vph
//    motion works: cannon pinion 12 / minute wheel 36, pinion 10 / hour 40
//    keyless works: crown wheel 24 / ratchet 50, winding pinion 16
//
//  GREP MAP
//    export const CAL ...... tooth counts, modules, z planes
//    export const L ........ arbor positions (solved, not typed)
//    function chain ........ every train angle from the escape angle
//    const PARTS ........... names, roles and specs for the part cards
// ============================================================================
import * as G from '../geom.js';
import { leverEscapement } from '../escapement.js';
import { makeRunner } from './common.js';
const { TAU, D, pol, add, ang, centreDist, drive, driveInv, gearSpec, fmtPeriod } = G;

export const CAL = {
  plateR: 18.3, plateT: 1.6, bph: 18000, fBal: 2.5,
  barrel: { N: 80, m: 0.19 },
  center: { N: 80, m: 0.125, p: 10 },
  third: { N: 75, m: 0.12, p: 10 },
  fourth: { N: 80, m: 0.10, p: 10 },
  escape: { N: 15, Ra: 2.3, Rf: 1.72, p: 8 },
  cannon: { N: 12, m: 0.15 },
  minute: { N: 36, m: 0.15, p: 10, pm: 0.144 },
  hour: { N: 40, m: 0.144 },
  ratchet: { N: 50, m: 0.16 },
  crown: { N: 24, m: 0.16 },
  winding: { N: 16, m: 0.16 },
  balR: 5.0, jewelR: 1.2, forkLen: 3.4, forkBank: 12 * D, palletSpan: 30 * D,
  z: {
    center: 0.45, fourth: 0.45, third: 1.15, escape: 1.15, fork: 1.15, barrelTeeth: 1.0,
    barrelLo: 0.85, barrelHi: 2.45, bridgeLo: 2.6, bridgeHi: 3.8, palletCockHi: 3.25,
    balance: 4.05, hairspring: 4.7, cockLo: 5.05, cockHi: 6.0, ratchet: 4.0,
    cannon: -1.85, minute: -1.85, hour: -2.25, dialLo: -3.0, dialHi: -2.7,
  },
  reserveTurns: 5.8,
};
const c = CAL;

// ── layout: every arbor position follows from the centre distances ─────────
const C = [0, 0];
const B = pol(centreDist(c.barrel.m, c.barrel.N, c.center.p), 120 * D);
const F = [0, -10.25];
const T = G.circleX(C, centreDist(c.center.m, c.center.N, c.third.p), F, centreDist(c.third.m, c.third.N, c.fourth.p), 1);
const E = add(F, pol(centreDist(c.fourth.m, c.fourth.N, c.escape.p), -30 * D));
export const ESC = leverEscapement({
  E, psi: 40 * D, N: c.escape.N, Ra: c.escape.Ra, Rf: c.escape.Rf, span: c.palletSpan,
  forkLen: c.forkLen, jewelR: c.jewelR, bank: c.forkBank,
});
const M = pol(centreDist(c.cannon.m, c.cannon.N, c.minute.N), 200 * D);
const cdRC = centreDist(c.ratchet.m, c.ratchet.N, c.crown.N);
const CW = [0, B[1] + Math.sqrt(cdRC * cdRC - B[0] * B[0])];
export const L = {
  C, B, T, F, E, P: ESC.P, Bal: ESC.Bal, M, CW, psi: ESC.psi,
  cockFoot: add(ESC.Bal, pol(7.6, 60 * D)),
  palletFoot: add(ESC.P, pol(1.9, ESC.psi - 90 * D)),
  click: add(B, pol(5.35, 222 * D)),
};

// ── kinematics ─────────────────────────────────────────────────────────────
export function chain(thE) {
  const fourth = driveInv(thE, c.fourth.N, c.escape.p, ang(F, E));
  const third = driveInv(fourth, c.third.N, c.fourth.p, ang(T, F));
  const center = driveInv(third, c.center.N, c.third.p, ang(C, T));
  const barrel = driveInv(center, c.barrel.N, c.center.p, ang(B, C));
  const minute = drive(center, c.cannon.N, c.minute.N, ang(C, M));
  const hour = drive(minute, c.minute.p, c.hour.N, ang(M, C));
  return { escape: thE, escPinion: thE, fourth, third, center, barrel, minute, hour, cannon: center, second: fourth };
}
export function keyless(thR) {
  const crown = driveInv(thR, c.crown.N, c.ratchet.N, ang(CW, B));
  return { ratchet: thR, crown, stem: -crown * c.crown.N / c.winding.N };
}
const run = makeRunner({
  escAngle: ESC.escapeAngle, lift: ESC.lift, fBal: c.fBal, beat: 0.2, amp0: 300 * D,
  startE: ESC.tables.start, cycleE: ESC.tables.cycle, chain, reserveTurns: c.reserveTurns,
  spent: (ch, C0) => -(ch.barrel - C0.barrel) / TAU,
  extra: (s, ch, p) => ({ fork: ESC.forkAngle(p.balance), ...keyless(-s.wound * TAU) }),
});

export function periods() {
  const esc = c.escape.N * 2 / (c.bph / 3600);
  const fourth = esc * c.fourth.N / c.escape.p, third = fourth * c.third.N / c.fourth.p;
  const center = third * c.center.N / c.third.p, barrel = center * c.barrel.N / c.center.p;
  const minute = center * c.minute.N / c.cannon.N, hour = minute * c.hour.N / c.minute.p;
  return { escape: esc, fourth, third, center, barrel, minute, hour, cannon: center, balance: 1 / c.fBal };
}
const PER = periods();

// ── part cards ─────────────────────────────────────────────────────────────
const GILT = 'brass, gilt', STEEL = 'hardened steel, polished';
export const PARTS = {
  plate: { name: 'Main plate', group: 'Frame', role: 'The base of the movement. Every arbor turns between a jewel in the plate and a jewel in a bridge above it.', specs: [['Diameter', '36.6 mm (16½ lignes)'], ['Thickness', '1.6 mm'], ['Material', 'brass, rhodium plated'], ['Finish', 'perlage']] },
  jewel: { name: 'Jewel bearing', group: 'Frame', role: 'A pivot turns in a hole in a synthetic ruby. Ruby is hard and smooth, so the steel pivots wear slowly and need very little oil.', specs: [['Material', 'synthetic corundum'], ['Hardness', 'Mohs 9'], ['Jewels', '15']] },
  barrel: { name: 'Barrel', group: 'Power', role: 'A drum that holds the mainspring. The spring turns the drum, and the teeth on its rim drive the centre pinion. It is the slowest wheel of the train.', specs: gearSpec(80, 0.19, [['Drives', 'centre pinion (10)'], ['Material', GILT]]), rate: 'barrel' },
  mainspring: { name: 'Mainspring', group: 'Power', role: 'A long ribbon of spring steel coiled round the barrel arbor. Wound, its coils wrap the arbor; as it runs down they open out against the barrel wall.', specs: [['Power reserve', `${(c.reserveTurns * PER.barrel / 3600).toFixed(0)} h`], ['Turns', `${c.reserveTurns} of the barrel`], ['Material', 'Nivaflex-type alloy']], live: 'reserve' },
  center: { name: 'Centre wheel', group: 'Going train', role: 'It sits at the centre of the movement. Its arbor comes through the dial and carries the cannon pinion and the minute hand.', specs: gearSpec(80, 0.125, [['Pinion', '10 leaves'], ['Driven by', 'barrel'], ['Drives', 'third pinion'], ['Material', GILT]]), rate: 'center' },
  third: { name: 'Third wheel', group: 'Going train', role: 'The middle stage of the train. Its pinion takes power from the centre wheel and its wheel drives the fourth pinion.', specs: gearSpec(75, 0.12, [['Pinion', '10 leaves'], ['Driven by', 'centre wheel'], ['Drives', 'fourth pinion']]), rate: 'third' },
  fourth: { name: 'Fourth wheel', group: 'Going train', role: 'Its arbor carries the small seconds hand at 6. 80/10 × 75/10 = 60, so it turns 60 times for each turn of the centre wheel.', specs: gearSpec(80, 0.10, [['Pinion', '10 leaves'], ['Drives', 'escape pinion (8)']]), rate: 'fourth' },
  escape: { name: 'Escape wheel', group: 'Escapement', role: 'The last wheel of the train. The pallet stones let it go half a tooth per beat: 30 beats per turn, 5 beats per second.', specs: [['Teeth', '15, Swiss club'], ['Tip Ø', `${(c.escape.Ra * 2).toFixed(1)} mm`], ['Pinion', '8 leaves'], ['Material', STEEL]], rate: 'escape' },
  pallet: { name: 'Pallet lever', group: 'Escapement', role: 'The Swiss lever. Its two ruby stones lock and release the escape wheel, and its fork takes the impulse to the balance through the roller jewel.', specs: [['Swing', `±${(c.forkBank / D).toFixed(0)}° on the banking`], ['Lift angle', `${(ESC.lift / D).toFixed(0)}° of balance`], ['Pallets', 'two ruby stones']], live: 'fork' },
  balance: { name: 'Balance wheel', group: 'Regulator', role: 'The regulator of the watch. With the hairspring it swings at a fixed rate; the screws on its rim set its inertia, and so its rate.', specs: [['Diameter', `${(c.balR * 2).toFixed(0)} mm`], ['Frequency', '2.5 Hz · 18,000 vph'], ['Material', 'Glucydur (Be–Cu)'], ['Screws', '14 timing screws']], live: 'balance' },
  hairspring: { name: 'Hairspring', group: 'Regulator', role: 'A fine flat spiral. The inner end turns with the balance, the outer end is held in the stud on the cock. It is the spring of the oscillator.', specs: [['Coils', '13'], ['Material', 'Nivarox-type alloy']], live: 'balance' },
  barrelBridge: { name: 'Barrel bridge', group: 'Frame', role: 'It holds the upper pivots of the barrel arbor and the centre wheel. The ratchet and the crown wheel sit on top of it.', specs: [['Finish', 'Geneva stripes'], ['Material', 'brass, rhodium plated']] },
  trainBridge: { name: 'Train bridge', group: 'Frame', role: 'It holds the upper pivots of the third, fourth and escape wheels in jewels set in gold chatons.', specs: [['Finish', 'Geneva stripes'], ['Jewels', '3 in chatons']] },
  palletCock: { name: 'Pallet cock', group: 'Frame', role: 'A small bridge for the upper pivot of the pallet lever.', specs: [['Jewels', '1']] },
  cock: { name: 'Balance cock', group: 'Frame', role: 'A bridge with one foot, so the balance can be seen and adjusted. The index moves the regulator to make the watch run faster or slower.', specs: [['Feet', '1'], ['Regulator', 'index with curb pins']] },
  ratchet: { name: 'Ratchet wheel', group: 'Keyless works', role: 'Square on the barrel arbor. When the crown winds, the ratchet turns the arbor and winds the spring.', specs: gearSpec(50, 0.16, [['Finish', 'sunray']]), live: 'ratchet' },
  crownWheel: { name: 'Crown wheel', group: 'Keyless works', role: 'It takes the turn of the winding pinion on the stem and gives it to the ratchet.', specs: gearSpec(24, 0.16) },
  click: { name: 'Click', group: 'Keyless works', role: 'A pawl on a spring. It lets the ratchet turn one way only, so the mainspring cannot unwind back through the crown.', specs: [['Material', STEEL]] },
  stem: { name: 'Stem and crown', group: 'Keyless works', role: 'Turn the crown and the stem turns the winding pinion, the crown wheel, the ratchet and the barrel arbor.', specs: [['Winding pinion', '16 leaves'], ['Crown Ø', '4.7 mm']] },
  screws: { name: 'Screws', group: 'Frame', role: 'Heat-blued steel screws hold the bridges to the plate. The blue is a thin oxide film grown at about 290 °C.', specs: [['Material', 'steel, heat blued']] },
  cannon: { name: 'Cannon pinion', group: 'Motion works', role: 'A friction fit on the centre arbor carries the minute hand, so the hands can be set without stopping the train. It drives the minute wheel.', specs: [['Leaves', '12'], ['Module', '0.150 mm']], rate: 'cannon' },
  minuteWheel: { name: 'Minute wheel', group: 'Motion works', role: 'It turns once in 3 hours. Its pinion drives the hour wheel.', specs: gearSpec(36, 0.15, [['Pinion', '10 leaves']]), rate: 'minute' },
  hourWheel: { name: 'Hour wheel', group: 'Motion works', role: 'A tube round the cannon pinion that carries the hour hand: 36/12 × 40/10 = 12.', specs: gearSpec(40, 0.144), rate: 'hour' },
  dial: { name: 'Dial', group: 'Display', role: 'Small seconds at 6, Roman numerals and a railway minute track.', specs: [['Material', 'enamel on brass']] },
  hourHand: { name: 'Hour hand', group: 'Display', role: 'On the hour wheel. One turn in 12 hours.', specs: [['Style', 'Breguet'], ['Material', 'steel, heat blued']], rate: 'hour' },
  minuteHand: { name: 'Minute hand', group: 'Display', role: 'On the cannon pinion. One turn per hour.', specs: [['Style', 'Breguet']], rate: 'cannon' },
  secondHand: { name: 'Seconds hand', group: 'Display', role: 'On the fourth wheel arbor. It moves in five small steps each second, one per beat.', specs: [['Steps', '5 per second']], rate: 'fourth' },
};

export default {
  id: 'lever', name: 'Swiss Lever', kind: 'Pocket watch', era: 'c. 1900 – today',
  blurb: 'The classic: a detached lever escapement, small seconds at 6, keyless winding through the crown.',
  CAL, L, ESC, chain, ...run, periods, PARTS, plateR: c.plateR,
  zRange: [-3.6, 6.3], focus: [(E[0] + ESC.P[0]) / 2, (E[1] + ESC.P[1]) / 2, 1.3],
  train: [['barrel', 'Barrel', 80, '—'], ['center', 'Centre', 80, 10], ['third', 'Third', 75, 10], ['fourth', 'Fourth', 80, 10], ['escape', 'Escape', 15, 8]],
  freq: '2.5 Hz · 18,000 vph',
  about: [
    ['Power', 'A coiled steel mainspring sits in the barrel. The crown winds it through the crown wheel and the ratchet; the click stops it from unwinding back. The spring then turns the barrel, slowly: once in 8 hours.'],
    ['The going train', 'The barrel drives the centre wheel, which carries the minute hand and turns once an hour. Each stage steps up the speed: the third wheel, then the fourth wheel, which carries the small seconds hand and turns once a minute.'],
    ['The escapement', 'The escape wheel is held by two ruby pallet stones on the lever. Each swing of the balance kicks the lever across: one stone lets a tooth go, the tooth slides over the stone and pushes the lever (the impulse), and the other stone catches the next tooth. That is the tick.'],
    ['The balance', 'The balance and its hairspring swing at 2.5 Hz: 5 beats a second, 18,000 an hour. The balance is free for most of its swing, and touches the lever only near the centre. That freedom (a detached escapement) is why the lever won.'],
    ['Source', 'An original calibre. Tooth counts and modules follow the Unitas/ETA 6497 class (36.6 mm, 18,000 vph). A test checks every mesh for overlap; the escape wheel turns only as far as the pallet stone outlines allow.'],
  ],
  meshes: [
    ['barrel / centre pinion', 'barrel', G.wheelProfile(80, 0.19), B, 'center', G.pinionProfile(10, 0.19), C],
    ['centre / third pinion', 'center', G.wheelProfile(80, 0.125), C, 'third', G.pinionProfile(10, 0.125), T],
    ['third / fourth pinion', 'third', G.wheelProfile(75, 0.12), T, 'fourth', G.pinionProfile(10, 0.12), F],
    ['fourth / escape pinion', 'fourth', G.wheelProfile(80, 0.10), F, 'escPinion', G.pinionProfile(8, 0.10), E],
    ['cannon / minute wheel', 'cannon', G.pinionProfile(12, 0.15), C, 'minute', G.wheelProfile(36, 0.15), M],
    ['minute pinion / hour', 'minute', G.pinionProfile(10, 0.144), M, 'hour', G.wheelProfile(40, 0.144), C],
  ],
  fmtPeriod, beatSeconds: 0.2, reserveHours: [40, 50], hoursPerTurn: PER.barrel / 3600,
  trainNote: 'From the centre wheel to the fourth wheel: 80/10 × 75/10 = 60. One turn per hour becomes one turn per minute.',
  checks: [
    ['keyless: crown wheel and ratchet do not overlap', ({ overlapNear }) => {
      let hits = 0;
      for (let i = 0; i <= 200; i++) {
        const k = keyless(-i / 200 * TAU / 10);
        if (overlapNear(G.place(G.wheelProfile(50, 0.16), B, k.ratchet), G.place(G.wheelProfile(24, 0.16), CW, k.crown), CW, 3)) hits++;
      }
      return [hits === 0, `${hits}/201 overlap`];
    }],
    ['layout: wheels in one z plane keep clear', () => {
      const discs = [['barrel', B, 7.84, 0.85, 2.45], ['centre', C, 5.16, 0.32, 0.58], ['fourth', F, 4.13, 0.32, 0.58],
        ['third', T, 4.65, 1.02, 1.28], ['escape', E, c.escape.Ra, 1.02, 1.28], ['balance', ESC.Bal, c.balR, 3.85, 4.25], ['cock foot', L.cockFoot, 2.0, 0, 5.05]];
      let worst = Infinity;
      for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i], b = discs[j];
        if (a[4] <= b[3] || b[4] <= a[3]) continue;
        worst = Math.min(worst, G.dist(a[1], b[1]) - a[2] - b[2]);
      }
      return [worst > 0.1, `smallest gap ${worst.toFixed(2)} mm`];
    }],
    ['layout: parts inside the plate', () => {
      const r = Math.max(G.len(B) + 7.84, G.len(ESC.Bal) + c.balR + 0.3, G.len(L.cockFoot) + 2);
      return [r < c.plateR, `${r.toFixed(2)} < ${c.plateR}`];
    }],
  ],
};

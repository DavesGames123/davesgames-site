// ============================================================================
//  WATCH MOVEMENT  ·  calibres/tourbillon.js — one-minute tourbillon
// ────────────────────────────────────────────────────────────────────────────
//  Breguet's tourbillon (patent 1801): the whole escapement rides in a cage
//  that turns once a minute, so the errors of the balance in each vertical
//  position average out. An original 18,000 vph pocket calibre on the
//  lever-calibre train, with the fourth wheel replaced by the cage.
//  No DOM and no THREE.
//
//  THE CAGE
//    The third wheel drives the cage pinion; the cage turns at angle c.
//    The fourth wheel stays still (the fixed wheel, 80 teeth). The escape
//    pinion (8) rides on the cage and rolls round the fixed wheel, so the
//    escape wheel turns, relative to the cage, by c * 80/8 = 10 c.
//    The balance sits on the cage axis. The fixed wheel hangs from the
//    tourbillon bridge above the cage, and the escape pinion reaches up
//    through the cage top to meet it; under the cage, the third wheel
//    reaches in to the cage pinion. Nothing else crosses the cage axis.
//
//  MIRROR
//    The escapement tables (escapement.js) turn the escape wheel toward
//    -angle. Seen from the caseback the cage must turn toward +angle
//    (clockwise on the dial), so the cage holds the escapement mirrored in
//    x. The canonical escape angle eL is the table value; the escape wheel
//    turns by -eL relative to the cage. The scene mirrors the group.
//
//  GREP MAP
//    const CAL ........ tooth counts, modules, z planes
//    const L .......... arbor positions; the cage frame is local to O
//    function chain ... every angle from the canonical escape angle
//    const PARTS ...... the part cards
// ============================================================================
import * as G from '../geom.js';
import { leverEscapement } from '../escapement.js';
import { makeRunner } from './common.js';
const { TAU, D, pol, add, ang, centreDist, drive, driveInv, gearSpec, fmtPeriod } = G;

export const CAL = {
  plateR: 18.3, plateT: 1.6, bph: 18000, fBal: 2.5,
  barrel: { N: 80, m: 0.19 }, center: { N: 80, m: 0.125, p: 10 }, third: { N: 75, m: 0.12, p: 10 },
  cagePinion: { N: 10, m: 0.12 }, fixed: { N: 80 }, escape: { N: 15, Ra: 1.55, Rf: 1.16, p: 8 },
  cannon: { N: 12, m: 0.15 }, minute: { N: 36, m: 0.15, p: 10, pm: 0.144 }, hour: { N: 40, m: 0.144 },
  ratchet: { N: 50, m: 0.16 }, crown: { N: 24, m: 0.16 }, winding: { N: 16, m: 0.16 },
  balR: 3.3, jewelR: 0.8, forkLen: 2.3, forkBank: 12 * D, palletSpan: 30 * D, cageR: 6.75,
  z: {
    center: 0.45, third: 1.15, barrelTeeth: 1.0, barrelLo: 0.85, barrelHi: 2.45,
    fixed: 5.72, cageLo: 2.15, escape: 2.75, fork: 2.75, balance: 3.95, hairspring: 4.6, cageHi: 5.2,
    bridgeLo: 2.6, bridgeHi: 3.8, ratchet: 4.0, tbLo: 6.0, tbHi: 6.7, lowLo: -2.15, lowHi: -1.75,
    cannon: -1.85, minute: -1.85, hour: -2.25, dialLo: -3.0, dialHi: -2.7,
  },
  reserveTurns: 5.8,
};
const c = CAL;

const C = [0, 0];
const B = pol(centreDist(c.barrel.m, c.barrel.N, c.center.p), 120 * D);
const O = [0, -9.6];
const T = G.circleX(C, centreDist(c.center.m, c.center.N, c.third.p), O, centreDist(c.third.m, c.third.N, c.cagePinion.N), 1);
// the escapement in the cage frame, balance on the cage axis
const dEP = c.escape.Ra / Math.cos(c.palletSpan), rE = dEP + c.forkLen + c.jewelR;
export const ESC = leverEscapement({
  E: [0, -rE], psi: 90 * D, N: c.escape.N, Ra: c.escape.Ra, Rf: c.escape.Rf, span: c.palletSpan,
  forkLen: c.forkLen, jewelR: c.jewelR, bank: c.forkBank,
});
const mFixed = 2 * rE / (c.fixed.N + c.escape.p);
const M = pol(centreDist(c.cannon.m, c.cannon.N, c.minute.N), 200 * D);
const cdRC = centreDist(c.ratchet.m, c.ratchet.N, c.crown.N);
const CW = [0, B[1] + Math.sqrt(cdRC * cdRC - B[0] * B[0])];
export const L = {
  C, B, T, O, M, CW, E: ESC.E, P: ESC.P, Bal: ESC.Bal, rE, mFixed,
  click: add(B, pol(5.35, 222 * D)),
  tbFeet: [add(O, pol(8.4, 195 * D)), add(O, pol(8.4, -15 * D))],
};

// ── kinematics ─────────────────────────────────────────────────────────────
// the escape pinion's line of centres from O is at c - PI/2 (E is below
// the cage axis in the cage frame); its absolute angle is c + eRel, and
// meshing with the fixed wheel at angle 0 gives eRel = 10 c + k
const K0 = -11 * Math.PI / 2 + Math.PI - Math.PI / c.escape.p;
export function chain(eL) {
  const eRel = -eL;
  const cage = (eRel - K0) / (c.fixed.N / c.escape.p);
  const third = driveInv(cage, c.third.N, c.cagePinion.N, ang(T, O));
  const center = driveInv(third, c.center.N, c.third.p, ang(C, T));
  const barrel = driveInv(center, c.barrel.N, c.center.p, ang(B, C));
  const minute = drive(center, c.cannon.N, c.minute.N, ang(C, M));
  const hour = drive(minute, c.minute.p, c.hour.N, ang(M, C));
  return { escape: eL, eRel, cage, third, center, barrel, minute, hour, cannon: center, second: cage, escPinionAbs: cage + eRel };
}
export function keyless(thR) {
  const crown = driveInv(thR, c.crown.N, c.ratchet.N, ang(CW, B));
  return { ratchet: thR, crown, stem: -crown * c.crown.N / c.winding.N };
}
const run = makeRunner({
  escAngle: ESC.escapeAngle, lift: ESC.lift, fBal: c.fBal, beat: 0.2, amp0: 290 * D,
  startE: ESC.tables.start, cycleE: ESC.tables.cycle, chain, reserveTurns: c.reserveTurns,
  spent: (ch, C0) => -(ch.barrel - C0.barrel) / TAU,
  extra: (s, ch, p) => ({ fork: ESC.forkAngle(p.balance), ...keyless(-s.wound * TAU) }),
});

export function periods() {
  const cage = 60, escape = cage / (c.fixed.N / c.escape.p);
  const third = cage * c.third.N / c.cagePinion.N, center = third * c.center.N / c.third.p, barrel = center * c.barrel.N / c.center.p;
  const minute = center * c.minute.N / c.cannon.N, hour = minute * c.hour.N / c.minute.p;
  return { escape, escapeRel: 6, cage, third, center, barrel, minute, hour, cannon: center, balance: 0.4 };
}
const PER = periods();

const GILT = 'brass, gilt';
export const PARTS = {
  plate: { name: 'Main plate', group: 'Frame', role: 'The base of the movement, cut through at 6 o\'clock so the tourbillon can be seen from the dial side.', specs: [['Diameter', '36.6 mm'], ['Aperture', `Ø ${(c.cageR * 2 + 0.6).toFixed(1)} mm`], ['Finish', 'perlage']] },
  jewel: { name: 'Jewel bearing', group: 'Frame', role: 'A pivot turns in a hole in a synthetic ruby, so the steel pivots wear slowly and need little oil.', specs: [['Material', 'synthetic corundum']] },
  barrel: { name: 'Barrel', group: 'Power', role: 'The drum that holds the mainspring. Its teeth drive the centre pinion.', specs: gearSpec(80, 0.19, [['Material', GILT]]), rate: 'barrel' },
  mainspring: { name: 'Mainspring', group: 'Power', role: 'The coiled steel ribbon that powers the watch. A tourbillon needs more torque than a plain lever, since the train also turns the cage.', specs: [['Power reserve', `${(c.reserveTurns * PER.barrel / 3600).toFixed(0)} h`]], live: 'reserve' },
  center: { name: 'Centre wheel', group: 'Going train', role: 'Turns once an hour and carries the minute hand through the cannon pinion.', specs: gearSpec(80, 0.125, [['Pinion', '10 leaves']]), rate: 'center' },
  third: { name: 'Third wheel', group: 'Going train', role: 'It drives the pinion under the tourbillon cage. In a plain watch it would drive the fourth wheel.', specs: gearSpec(75, 0.12, [['Pinion', '10 leaves'], ['Drives', 'cage pinion (10)']]), rate: 'third' },
  cage: { name: 'Tourbillon cage', group: 'Tourbillon', role: 'A light steel carriage that holds the escape wheel, the lever and the balance, and turns once a minute. Each position error of the balance is spread over the whole turn, so it averages out.', specs: [['Turns', '1 per minute'], ['Diameter', `${(c.cageR * 2).toFixed(1)} mm`], ['Material', 'steel, polished and black-polished'], ['Pinion', '10 leaves']], rate: 'cage' },
  fixedWheel: { name: 'Fixed fourth wheel', group: 'Tourbillon', role: 'It does not turn: a tube holds it to the tourbillon bridge, above the cage. The escape pinion on the cage rolls round it, and that rolling turns the escape wheel: ten turns relative to the cage for each turn of the cage.', specs: gearSpec(80, mFixed, [['Turns', 'never: fixed to the bridge']]) },
  escape: { name: 'Escape wheel', group: 'Escapement', role: 'Carried by the cage. Its pinion rolls round the fixed wheel; its teeth are held and released by the pallet stones.', specs: [['Teeth', '15, Swiss club'], ['Tip Ø', `${(c.escape.Ra * 2).toFixed(1)} mm`], ['Pinion', '8 leaves'], ['Turns', '1 per 6 s, relative to the cage']], angleKey: 'eRel' },
  pallet: { name: 'Pallet lever', group: 'Escapement', role: 'The Swiss lever, scaled down to fit the cage. It locks and releases the escape wheel and gives the impulse to the balance.', specs: [['Swing', `±${(c.forkBank / D).toFixed(0)}°`], ['Lift angle', `${(ESC.lift / D).toFixed(0)}° of balance`]], live: 'fork' },
  balance: { name: 'Balance wheel', group: 'Regulator', role: 'It sits on the axis of the cage. As the cage turns, gravity pulls on the balance from every direction in turn.', specs: [['Diameter', `${(c.balR * 2).toFixed(1)} mm`], ['Frequency', '2.5 Hz · 18,000 vph'], ['Material', 'Glucydur (Be–Cu)']], live: 'balance' },
  hairspring: { name: 'Hairspring', group: 'Regulator', role: 'The spring of the oscillator. Its stud is fixed to the cage, so it turns with it.', specs: [['Coils', '12']], live: 'balance' },
  tbridge: { name: 'Tourbillon bridge', group: 'Frame', role: 'An arched bridge that carries the upper pivot of the cage and, on a tube, the fixed wheel.', specs: [['Finish', 'black polish, bevelled edges']] },
  lowerBridge: { name: 'Lower tourbillon bridge', group: 'Frame', role: 'On the dial side, across the aperture. It carries the lower pivot of the cage.', specs: [['Material', 'steel']] },
  barrelBridge: { name: 'Barrel bridge', group: 'Frame', role: 'It holds the upper pivots of the barrel and the centre wheel; the ratchet and crown wheel sit on it.', specs: [['Finish', 'Geneva stripes']] },
  thirdBridge: { name: 'Third wheel bridge', group: 'Frame', role: 'A small bridge for the upper pivot of the third wheel.', specs: [['Finish', 'Geneva stripes']] },
  ratchet: { name: 'Ratchet wheel', group: 'Keyless works', role: 'Square on the barrel arbor. Winding turns it and winds the spring.', specs: gearSpec(50, 0.16), live: 'ratchet' },
  crownWheel: { name: 'Crown wheel', group: 'Keyless works', role: 'It passes the turn of the winding pinion to the ratchet.', specs: gearSpec(24, 0.16) },
  click: { name: 'Click', group: 'Keyless works', role: 'A pawl that lets the ratchet turn one way only.', specs: [] },
  stem: { name: 'Stem and crown', group: 'Keyless works', role: 'Turn the crown and the stem winds the mainspring through the crown wheel and the ratchet.', specs: [['Winding pinion', '16 leaves']] },
  screws: { name: 'Screws', group: 'Frame', role: 'Heat-blued steel screws hold the bridges to the plate.', specs: [['Material', 'steel, heat blued']] },
  cannon: { name: 'Cannon pinion', group: 'Motion works', role: 'A friction fit on the centre arbor that carries the minute hand.', specs: [['Leaves', '12']], rate: 'cannon' },
  minuteWheel: { name: 'Minute wheel', group: 'Motion works', role: 'It turns once in 3 hours and drives the hour wheel.', specs: gearSpec(36, 0.15, [['Pinion', '10 leaves']]), rate: 'minute' },
  hourWheel: { name: 'Hour wheel', group: 'Motion works', role: 'It carries the hour hand: 36/12 × 40/10 = 12.', specs: gearSpec(40, 0.144), rate: 'hour' },
  dial: { name: 'Dial', group: 'Display', role: 'Enamel with an aperture at 6 o\'clock, so the turning cage is the seconds display.', specs: [['Aperture', `Ø ${(c.cageR * 2).toFixed(1)} mm`]] },
  hourHand: { name: 'Hour hand', group: 'Display', role: 'One turn in 12 hours.', specs: [['Style', 'Breguet']], rate: 'hour' },
  minuteHand: { name: 'Minute hand', group: 'Display', role: 'One turn per hour.', specs: [['Style', 'Breguet']], rate: 'cannon' },
  secondHand: { name: 'Seconds hand', group: 'Display', role: 'Fixed to the cage arbor: the cage itself is the seconds hand.', specs: [['Turns', '1 per minute']], rate: 'cage' },
};

export default {
  id: 'tourbillon', name: 'Tourbillon', kind: 'Pocket watch', era: 'Breguet, 1801',
  blurb: 'The escapement rides in a cage that turns once a minute, so the balance sees gravity from every side and its errors average out.',
  CAL, L, ESC, chain, ...run, periods, PARTS, plateR: c.plateR,
  zRange: [-3.6, 6.6], focus: [0, -9.6, 1.5],
  train: [['barrel', 'Barrel', 80, '—'], ['center', 'Centre', 80, 10], ['third', 'Third', 75, 10], ['cage', 'Cage', '—', 10], ['escape', 'Escape', 15, 8]],
  freq: '2.5 Hz · 18,000 vph', beatSeconds: 0.2, reserveHours: [40, 50], hoursPerTurn: PER.barrel / 3600,
  trainNote: 'The cage turns once a minute; the escape pinion rolls round the fixed 80-tooth wheel, so the escape wheel turns 80/8 = 10 times per turn of the cage.',
  about: [
    ['Why', 'A balance runs at slightly different rates when the watch hangs crown up, crown down, and so on, because gravity pulls its centre of mass and its hairspring a little off true. Breguet put the whole escapement in a turning carriage, so these errors take turns and cancel over each minute.'],
    ['The cage', 'The third wheel drives a pinion under the cage. The cage carries the escape wheel, the lever and the balance, with the balance on its axis, and it turns once a minute.'],
    ['The fixed wheel', 'The fourth wheel no longer turns: it is fixed to the frame. The escape pinion, carried round by the cage, rolls on it like a planet on a sun. That rolling, held back by the lever, is what lets the cage turn in steps of a beat.'],
    ['The display', 'The cage shows through an aperture in the dial at 6 o\'clock, and a hand on its arbor marks the seconds.'],
    ['Source', 'An original calibre on the lever train: barrel 80, centre 80/10, third 75/10, cage pinion 10, fixed wheel 80, escape pinion 8. The escapement is the collision-solved Swiss lever, scaled to fit the cage.'],
  ],
  meshes: [
    ['barrel / centre pinion', 'barrel', G.wheelProfile(80, 0.19), B, 'center', G.pinionProfile(10, 0.19), C],
    ['centre / third pinion', 'center', G.wheelProfile(80, 0.125), C, 'third', G.pinionProfile(10, 0.125), T],
    ['third / cage pinion', 'third', G.wheelProfile(75, 0.12), T, 'cage', G.pinionProfile(10, 0.12), O],
    ['cannon / minute wheel', 'cannon', G.pinionProfile(12, 0.15), C, 'minute', G.wheelProfile(36, 0.15), M],
    ['minute pinion / hour', 'minute', G.pinionProfile(10, 0.144), M, 'hour', G.wheelProfile(40, 0.144), C],
  ],
  fmtPeriod,
  // the escapement is best seen through the dial aperture
  views: { escapement: { az: 180, el: 12, explode: 0, dial: true, bridges: true, distK: 1.9 } },
  checks: [
    ['planet: escape pinion rolls on the fixed wheel without overlap', ({ overlapNear }) => {
      const X = ESC.tables;
      let hits = 0;
      for (let i = 0; i <= 600; i++) {
        const ch = chain(X.start + X.cycle * (i / 600 * 150) / 0.4);   // 150 s: 2.5 cage turns
        const Ew = add(O, G.rot([0, -rE], ch.cage));
        const fixedPoly = G.place(G.wheelProfile(80, mFixed), O, 0);
        const pin = G.place(G.pinionProfile(8, mFixed), Ew, ch.escPinionAbs);
        if (overlapNear(fixedPoly, pin, Ew, 2)) hits++;
      }
      return [hits === 0, `${hits}/601 positions overlap (module ${mFixed.toFixed(4)})`];
    }],
    ['planet: the cage turns once a minute', () => {
      const X = ESC.tables, a = chain(X.start), b = chain(X.start + X.cycle * 60 / 0.4);
      const turns = (b.cage - a.cage) / TAU, rel = (b.eRel - a.eRel) / TAU;
      return [Math.abs(turns - 1) < 1e-9 && Math.abs(rel - 10) < 1e-6, `cage ${turns.toFixed(9)} turn, escape ${rel.toFixed(6)} turns relative`];
    }],
    ['layout: cage clear of the barrel and the third wheel plane', () => {
      const gB = G.dist(B, O) - 7.84 - c.cageR, gT = G.dist(T, O) - 4.65;
      return [gB > 0.3 && gT > 0, `barrel gap ${gB.toFixed(2)} mm; third wheel tips ${gT.toFixed(2)} mm from the cage axis (at z ${c.z.third}, under the cage at ${c.z.cageLo})`];
    }],
    ['layout: cage and bridge feet inside the plate', () => {
      const r = Math.max(G.len(O) + c.cageR, ...L.tbFeet.map(f => G.len(f) + 1.2));
      return [r < c.plateR, `${r.toFixed(2)} < ${c.plateR}`];
    }],
  ],
};

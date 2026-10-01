// ============================================================================
//  WATCH MOVEMENT  ·  calibres/automatic.js — self-winding wristwatch
// ────────────────────────────────────────────────────────────────────────────
//  An original 28,800 vph (4 Hz) wristwatch calibre, 25.6 mm (11½ lignes),
//  in the class of the ETA 2824: centre seconds and a winding rotor.
//  No DOM and no THREE.
//
//  POWER PATH  (driver / driven, module)
//    barrel 80 / centre pinion 10 (0.13)     barrel 1 turn in 8 h
//    centre 80 / third pinion 10  (0.09)     centre 1 turn in 1 h
//    third 75 / fourth pinion 10  (0.0953)   fourth 1 turn per minute
//    third 75 / seconds pinion 10 (0.0953)   centre seconds, 1 per minute
//    fourth 84 / escape pinion 7  (0.075)    escape 1 turn in 5 s
//    escape wheel 20 teeth, Swiss lever, balance at 4 Hz = 28,800 vph
//  The third wheel drives two pinions at the same distance: the fourth
//  pinion and, on the centre axis, the seconds pinion (indirect centre
//  seconds). So the third wheel sits 4.05 mm from the centre, and both of
//  its meshes use one module.
//
//  SELF-WINDING
//    The rotor (a half disc with a heavy rim) swings under gravity as the
//    wrist moves. Its pinion (12) turns two reversing wheels (30). Each has
//    a one-way clutch to its pinion (10), so whichever way the rotor turns,
//    one pinion drives the reduction wheel (54) the same way. The reduction
//    pinion (10) turns the ratchet (46) on the barrel arbor: 1/62 of a turn
//    per rotor turn. The wrist motion is a sum of slow sines; the rotor is
//    a damped pendulum (rotorStep).
//
//  GREP MAP
//    const CAL ......... tooth counts, modules, z planes
//    const L ........... arbor positions (solved)
//    function chain .... every train angle from the escape angle
//    function rotorStep  the rotor pendulum and the winding it gives
//    const PARTS ....... the part cards
// ============================================================================
import * as G from '../geom.js';
import { leverEscapement } from '../escapement.js';
import { makeRunner } from './common.js';
const { TAU, D, pol, add, ang, centreDist, drive, driveInv, gearSpec, fmtPeriod } = G;

export const CAL = {
  plateR: 12.8, plateT: 1.3, bph: 28800, fBal: 4,
  barrel: { N: 80, m: 0.13 }, center: { N: 80, m: 0.09, p: 10 }, third: { N: 75, m: 2 * 4.05 / 85, p: 10 },
  fourth: { N: 84, m: 0.075, p: 10 }, secp: { N: 10 }, escape: { N: 20, Ra: 1.75, Rf: 1.33, p: 7 },
  cannon: { N: 12, m: 0.1 }, minute: { N: 36, m: 0.1, p: 10, pm: 0.096 }, hour: { N: 40, m: 0.096 },
  rotorPin: { N: 12, m: 0.12 }, rev: { N: 30, m: 0.12, p: 10, pm: 0.14 }, red: { N: 54, m: 0.14, p: 10, pm: 0.13 }, ratchet: { N: 46, m: 0.13 },
  balR: 4.6, jewelR: 0.9, forkLen: 2.4, forkBank: 12 * D, palletSpan: 31.5 * D,
  z: {
    center: 0.4, third: 1.1, fourth: 1.8, escape: 1.1, fork: 1.1, barrelTeeth: 0.9, barrelLo: 0.75, barrelHi: 2.15,
    bridgeLo: 2.3, bridgeHi: 3.15, trainLo: 2.3, trainHi: 3.0, balance: 3.4, hairspring: 3.85, cockLo: 4.05, cockHi: 4.6,
    ratchet: 3.42, autoLo: 4.0, autoHi: 4.5, red: 4.82, revP: 4.82, rev: 5.27, rotorPin: 5.27, rotorLo: 5.7, rotorHi: 6.0, rimLo: 5.55, rimHi: 6.65,
    cannon: -1.55, minute: -1.55, hour: -1.95, dialLo: -2.6, dialHi: -2.3,
  },
  reserveTurns: 5.0,
};
const c = CAL;

const C = [0, 0];
const B = pol(centreDist(c.barrel.m, c.barrel.N, c.center.p), 110 * D);
const T = pol(4.05, -30 * D);
const F = add(T, pol(4.05, -110 * D));
const E = add(F, pol(centreDist(c.fourth.m, c.fourth.N, c.escape.p), -160 * D));
export const ESC = leverEscapement({
  E, psi: 150 * D, N: c.escape.N, Ra: c.escape.Ra, Rf: c.escape.Rf, span: c.palletSpan,
  forkLen: c.forkLen, jewelR: c.jewelR, bank: c.forkBank,
});
const M = pol(centreDist(c.cannon.m, c.cannon.N, c.minute.N), 200 * D);
// self-winding train: reduction wheel by the ratchet, reversers on the
// rotor-pinion circle where they also reach the reduction wheel
const RED = add(B, pol(centreDist(c.ratchet.m, c.ratchet.N, c.red.p), -30 * D));
const cdRev = centreDist(c.rotorPin.m, c.rotorPin.N, c.rev.N), cdRR = centreDist(c.red.m, c.red.N, c.rev.p);
const RV1 = G.circleX(C, cdRev, RED, cdRR, 1), RV2 = G.circleX(C, cdRev, RED, cdRR, -1);
export const L = {
  C, B, T, F, E, P: ESC.P, Bal: ESC.Bal, M, RED, RV1, RV2, psi: ESC.psi,
  cockFoot: add(ESC.Bal, pol(6.4, 120 * D)),
};

// ── kinematics ─────────────────────────────────────────────────────────────
export function chain(thE) {
  const fourth = driveInv(thE, c.fourth.N, c.escape.p, ang(F, E));
  const third = driveInv(fourth, c.third.N, c.fourth.p, ang(T, F));
  const center = driveInv(third, c.center.N, c.third.p, ang(C, T));
  const barrel = driveInv(center, c.barrel.N, c.center.p, ang(B, C));
  const secp = drive(third, c.third.N, c.secp.N, ang(T, C));
  const minute = drive(center, c.cannon.N, c.minute.N, ang(C, M));
  const hour = drive(minute, c.minute.p, c.hour.N, ang(M, C));
  return { escape: thE, escPinion: thE, fourth, third, center, barrel, secp, minute, hour, cannon: center, second: secp };
}
// the winding train from the ratchet angle and the rotor angle
export function winding(thR, rotor) {
  const red = driveInv(thR, c.red.p, c.ratchet.N, ang(RED, B));
  return {
    ratchet: thR, red, rotor,
    rev1: drive(rotor, c.rotorPin.N, c.rev.N, ang(C, RV1)), rev2: drive(rotor, c.rotorPin.N, c.rev.N, ang(C, RV2)),
    revP1: drive(red, c.red.N, c.rev.p, ang(RED, RV1)), revP2: drive(red, c.red.N, c.rev.p, ang(RED, RV2)),
  };
}
export const RATIO = (c.rev.N / c.rotorPin.N) * (c.red.N / c.rev.p) * (c.ratchet.N / c.red.p);
// the rotor: a damped pendulum toward the wrist's "down"; returns the
// winding it gives, in mainspring turns. Its time is capped so a fast
// time rate does not blur it.
export function rotorStep(s, dt) {
  if (s.rt === undefined) { s.rt = 0; s.rotor = -Math.PI / 2; s.rotorV = 0; }
  const span = Math.min(dt, 0.12), n = Math.max(1, Math.ceil(span / 0.01)), h = span / n;
  let turned = 0;
  for (let i = 0; i < n; i++) {
    s.rt += h;
    // s.still: the watch lies at rest, so "down" stops moving and the
    // rotor settles; otherwise the wrist turns it about
    const down = s.still ? -Math.PI / 2 : -Math.PI / 2 + 1.25 * Math.sin(0.43 * s.rt) + 0.7 * Math.sin(1.27 * s.rt + 1) + 0.4 * Math.sin(2.9 * s.rt + 2);
    s.rotorV += (-30 * Math.sin(s.rotor - down) - 1.1 * s.rotorV) * h;
    s.rotor += s.rotorV * h;
    turned += Math.abs(s.rotorV * h);
  }
  return turned / TAU / RATIO;
}
const run = makeRunner({
  escAngle: ESC.escapeAngle, lift: ESC.lift, fBal: c.fBal, beat: 0.125, amp0: 285 * D,
  startE: ESC.tables.start, cycleE: ESC.tables.cycle, chain, reserveTurns: c.reserveTurns,
  spent: (ch, C0) => -(ch.barrel - C0.barrel) / TAU,
  preStep: (s, dt) => rotorStep(s, dt),
  extra: (s, ch, p) => ({ fork: ESC.forkAngle(p.balance), ...winding(-s.wound * TAU, s.rotor ?? -Math.PI / 2) }),
});

export function periods() {
  const esc = c.escape.N * 2 / (c.bph / 3600);
  const fourth = esc * c.fourth.N / c.escape.p, third = fourth * c.third.N / c.fourth.p;
  const center = third * c.center.N / c.third.p, barrel = center * c.barrel.N / c.center.p;
  const minute = center * c.minute.N / c.cannon.N, hour = minute * c.hour.N / c.minute.p;
  return { escape: esc, fourth, third, center, barrel, secp: fourth, minute, hour, cannon: center, balance: 0.25 };
}
const PER = periods();

const GILT = 'brass, gilt';
export const PARTS = {
  plate: { name: 'Main plate', group: 'Frame', role: 'The base of a 25.6 mm wristwatch movement (11½ lignes).', specs: [['Diameter', '25.6 mm'], ['Finish', 'perlage']] },
  jewel: { name: 'Jewel bearing', group: 'Frame', role: 'A pivot turns in a synthetic ruby, so it wears slowly and needs little oil.', specs: [['Jewels', '25']] },
  barrel: { name: 'Barrel', group: 'Power', role: 'The drum that holds the mainspring. Its teeth drive the centre pinion.', specs: gearSpec(80, 0.13, [['Material', GILT]]), rate: 'barrel' },
  mainspring: { name: 'Mainspring', group: 'Power', role: 'In a self-winding watch the spring ends in a slipping bridle, so the rotor cannot overwind it: at full wind the bridle slips in the barrel.', specs: [['Power reserve', `${(c.reserveTurns * PER.barrel / 3600).toFixed(0)} h`]], live: 'reserve' },
  center: { name: 'Centre wheel', group: 'Going train', role: 'Turns once an hour. Its hollow arbor carries the cannon pinion; the seconds arbor runs through it.', specs: gearSpec(80, 0.09, [['Pinion', '10 leaves']]), rate: 'center' },
  third: { name: 'Third wheel', group: 'Going train', role: 'It drives two pinions: the fourth pinion, and the seconds pinion on the centre axis (indirect centre seconds).', specs: gearSpec(75, c.third.m, [['Pinion', '10 leaves'], ['Drives', 'fourth pinion and seconds pinion']]), rate: 'third' },
  fourth: { name: 'Fourth wheel', group: 'Going train', role: 'Turns once a minute and drives the escape pinion.', specs: gearSpec(84, 0.075, [['Pinion', '10 leaves']]), rate: 'fourth' },
  secp: { name: 'Seconds pinion', group: 'Going train', role: 'On a fine arbor through the hollow centre arbor. Driven by the third wheel, it carries the sweep seconds hand.', specs: [['Leaves', '10'], ['Turns', '1 per minute']], rate: 'secp' },
  escape: { name: 'Escape wheel', group: 'Escapement', role: 'Twenty club teeth. At 4 Hz it lets go 8 half-teeth a second.', specs: [['Teeth', '20, Swiss club'], ['Tip Ø', `${(c.escape.Ra * 2).toFixed(1)} mm`], ['Pinion', '7 leaves']], rate: 'escape' },
  pallet: { name: 'Pallet lever', group: 'Escapement', role: 'The Swiss lever: it locks and releases the escape wheel and gives the balance its impulse.', specs: [['Swing', `±${(c.forkBank / D).toFixed(0)}°`], ['Pallet span', '3½ teeth']], live: 'fork' },
  balance: { name: 'Balance wheel', group: 'Regulator', role: 'A smooth (screwless) balance at 4 Hz. The higher rate makes the watch less sensitive to knocks than an 18,000 vph pocket watch.', specs: [['Diameter', `${(c.balR * 2).toFixed(1)} mm`], ['Frequency', '4 Hz · 28,800 vph'], ['Material', 'Glucydur (Be–Cu)']], live: 'balance' },
  hairspring: { name: 'Hairspring', group: 'Regulator', role: 'The spring of the oscillator.', specs: [['Coils', '13']], live: 'balance' },
  barrelBridge: { name: 'Barrel bridge', group: 'Frame', role: 'It holds the barrel and the centre wheel; the ratchet sits on it.', specs: [['Finish', 'Geneva stripes']] },
  trainBridge: { name: 'Train bridge', group: 'Frame', role: 'It holds the third, fourth and escape wheels.', specs: [['Finish', 'Geneva stripes']] },
  cock: { name: 'Balance cock', group: 'Frame', role: 'The bridge of the balance, with the regulator.', specs: [] },
  autoBridge: { name: 'Automatic bridge', group: 'Self-winding', role: 'It carries the winding train: the reversing wheels and the reduction wheel, and the rotor bearing.', specs: [['Finish', 'Geneva stripes']] },
  rotor: { name: 'Rotor', group: 'Self-winding', role: 'A half disc with a heavy rim on a ball bearing. Each movement of the wrist lets gravity swing it, and every swing winds the mainspring a little.', specs: [['Bearing', 'ball, 5 balls'], ['Ratio to ratchet', `1 : ${RATIO.toFixed(1)}`], ['Rim', 'heavy metal (tungsten alloy)']], live: 'rotor', angleKey: 'rotor' },
  reverser: { name: 'Reversing wheel', group: 'Self-winding', role: 'Two of them. Each has a one-way clutch, so one drives the reduction wheel when the rotor turns left and the other when it turns right. The winding goes on in both directions.', specs: [['Wheel', '30 teeth'], ['Pinion', '10 leaves'], ['Clutch', 'one-way']], angleKey: 'rev1' },
  reduction: { name: 'Reduction wheel', group: 'Self-winding', role: 'It turns one way only, whichever way the rotor swings, and its pinion turns the ratchet.', specs: gearSpec(54, 0.14, [['Pinion', '10 leaves']]), angleKey: 'red' },
  ratchet: { name: 'Ratchet wheel', group: 'Self-winding', role: 'On the barrel arbor. Both the rotor and the crown wind the spring through it.', specs: gearSpec(46, 0.13), live: 'ratchet' },
  stem: { name: 'Stem and crown', group: 'Keyless works', role: 'At 3 o\'clock, as on most wristwatches. It sets the hands and can also wind the spring by hand.', specs: [] },
  screws: { name: 'Screws', group: 'Frame', role: 'Blued steel screws hold the bridges to the plate.', specs: [] },
  cannon: { name: 'Cannon pinion', group: 'Motion works', role: 'A friction fit on the centre arbor carries the minute hand.', specs: [['Leaves', '12']], rate: 'cannon' },
  minuteWheel: { name: 'Minute wheel', group: 'Motion works', role: 'It turns once in 3 hours and drives the hour wheel.', specs: gearSpec(36, 0.1, [['Pinion', '10 leaves']]), rate: 'minute' },
  hourWheel: { name: 'Hour wheel', group: 'Motion works', role: 'It carries the hour hand: 36/12 × 40/10 = 12.', specs: gearSpec(40, 0.096), rate: 'hour' },
  dial: { name: 'Dial', group: 'Display', role: 'Sunray-brushed blue-grey with applied baton indices.', specs: [] },
  hourHand: { name: 'Hour hand', group: 'Display', role: 'One turn in 12 hours.', specs: [['Style', 'dauphine']], rate: 'hour' },
  minuteHand: { name: 'Minute hand', group: 'Display', role: 'One turn per hour.', specs: [['Style', 'dauphine']], rate: 'cannon' },
  secondHand: { name: 'Seconds hand', group: 'Display', role: 'The sweep seconds hand. At 4 Hz it moves in 8 small steps each second, so it looks smooth.', specs: [['Steps', '8 per second']], rate: 'secp' },
};

export default {
  id: 'automatic', name: 'Automatic', kind: 'Wristwatch', era: 'c. 1950 – today',
  blurb: 'A rotor swings with every move of the wrist and winds the mainspring in both directions. Centre seconds, 4 Hz.',
  CAL, L, ESC, chain, ...run, periods, PARTS, plateR: c.plateR,
  zRange: [-3.0, 6.8], focus: [(E[0] + ESC.P[0]) / 2, (E[1] + ESC.P[1]) / 2, 1.1],
  train: [['barrel', 'Barrel', 80, '—'], ['center', 'Centre', 80, 10], ['third', 'Third', 75, 10], ['fourth', 'Fourth', 84, 10], ['escape', 'Escape', 20, 7]],
  freq: '4 Hz · 28,800 vph', beatSeconds: 0.125, reserveHours: [36, 44], hoursPerTurn: PER.barrel / 3600,
  trainNote: `The rotor winds through 30/12 × 54/10 × 46/10 = ${RATIO.toFixed(1)}: sixty-odd rotor turns for one turn of the mainspring.`,
  about: [
    ['Self-winding', 'Abraham-Louis Perrelet made the first self-winding watches around 1777, and John Harwood brought them to the wrist in the 1920s. The central rotor with winding in both directions became the standard in the 1950s.'],
    ['The rotor', 'A half disc with a heavy rim turns on a ball bearing at the centre. When the wrist moves, gravity swings it. Its pinion turns two reversing wheels with one-way clutches, so the winding goes on whichever way it swings.'],
    ['Slipping bridle', 'The rotor never stops, so the mainspring must not be overwound. Its outer end is a bridle that slips round the barrel wall when the spring is fully wound.'],
    ['Centre seconds', 'The third wheel drives the fourth pinion and also a seconds pinion on the centre axis, whose fine arbor runs through the hollow centre arbor to the sweep seconds hand.'],
    ['Source', 'An original calibre in the class of the ETA 2824 (25.6 mm, 28,800 vph). Every mesh is tested for overlap; the 20-tooth escapement is collision-solved like the others.'],
  ],
  meshes: [
    ['barrel / centre pinion', 'barrel', G.wheelProfile(80, 0.13), B, 'center', G.pinionProfile(10, 0.13), C],
    ['centre / third pinion', 'center', G.wheelProfile(80, 0.09), C, 'third', G.pinionProfile(10, 0.09), T],
    ['third / fourth pinion', 'third', G.wheelProfile(75, c.third.m), T, 'fourth', G.pinionProfile(10, c.third.m), F],
    ['third / seconds pinion', 'third', G.wheelProfile(75, c.third.m), T, 'secp', G.pinionProfile(10, c.third.m), C],
    ['fourth / escape pinion', 'fourth', G.wheelProfile(84, 0.075), F, 'escPinion', G.pinionProfile(7, 0.075), E],
    ['cannon / minute wheel', 'cannon', G.pinionProfile(12, 0.1), C, 'minute', G.wheelProfile(36, 0.1), M],
    ['minute pinion / hour', 'minute', G.pinionProfile(10, 0.096), M, 'hour', G.wheelProfile(40, 0.096), C],
  ],
  fmtPeriod, wristToggle: true,
  checks: [
    ['winding train: every mesh clear over rotor swings and winding', ({ overlapNear }) => {
      let hits = 0, n = 0;
      for (let i = 0; i <= 300; i++) {
        const w = winding(-i / 300 * TAU * 0.3, i / 300 * TAU * 2.3);
        const pairs = [
          [G.pinionProfile(12, 0.12), C, w.rotor, G.wheelProfile(30, 0.12), RV1, w.rev1],
          [G.pinionProfile(12, 0.12), C, w.rotor, G.wheelProfile(30, 0.12), RV2, w.rev2],
          [G.wheelProfile(54, 0.14), RED, w.red, G.pinionProfile(10, 0.14), RV1, w.revP1],
          [G.wheelProfile(54, 0.14), RED, w.red, G.pinionProfile(10, 0.14), RV2, w.revP2],
          [G.pinionProfile(10, 0.13), RED, w.red, G.wheelProfile(46, 0.13), B, w.ratchet],
        ];
        for (const [pa, ca, aa, pb, cb, ab] of pairs) { n++; if (overlapNear(G.place(pa, ca, aa), G.place(pb, cb, ab), cb, 3)) hits++; }
      }
      return [hits === 0, `${hits}/${n} positions overlap`];
    }],
    ['rotor: a minute of wrist motion winds the spring', () => {
      const s = run.createState(0, 0.3), r0 = run.pose(s).reserve;
      for (let i = 0; i < 3600; i++) run.step(s, 1 / 60);
      const r1 = run.pose(s).reserve;
      return [r1 > r0, `reserve ${r0.toFixed(4)} -> ${r1.toFixed(4)} turns (+${((r1 - r0) * PER.barrel / 3600 * 60).toFixed(1)} min of running)`];
    }],
    ['layout: parts inside the plate', () => {
      const r = Math.max(G.len(B) + 5.45, G.len(ESC.Bal) + c.balR + 0.2, G.len(L.cockFoot) + 1.5, G.len(E) + c.escape.Ra);
      return [r < c.plateR, `${r.toFixed(2)} < ${c.plateR}`];
    }],
    ['layout: wheels in one z plane keep clear', () => {
      const discs = [['barrel', B, 5.45, 0.75, 2.15], ['centre', C, 3.72, 0.27, 0.53], ['third', T, 3.69, 0.97, 1.23], ['fourth', F, 3.25, 1.67, 1.93], ['escape', E, c.escape.Ra, 0.99, 1.21], ['balance', ESC.Bal, c.balR, 3.2, 3.6], ['cock foot', L.cockFoot, 1.5, 0, 4.05]];
      let worst = Infinity, which = '';
      for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i], b = discs[j];
        if (a[4] <= b[3] || b[4] <= a[3]) continue;
        const g = G.dist(a[1], b[1]) - a[2] - b[2];
        if (g < worst) { worst = g; which = `${a[0]} / ${b[0]}`; }
      }
      return [worst > 0.1, `smallest gap ${worst.toFixed(2)} mm (${which})`];
    }],
  ],
};

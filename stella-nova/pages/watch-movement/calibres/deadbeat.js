// ============================================================================
//  WATCH MOVEMENT  ·  calibres/deadbeat.js — Graham deadbeat regulator
// ────────────────────────────────────────────────────────────────────────────
//  A precision regulator clock in the manner of George Graham (c. 1715) and
//  the later Vienna and observatory regulators: a seconds pendulum, a
//  30-tooth escape wheel that turns once a minute and carries the seconds
//  hand, and deadbeat pallets. An original 8-day weight-driven calibre.
//  No DOM and no THREE (tests.mjs runs it in Node).
//
//  FRAME  as the other calibres: mm, x right, y to 12, z out of the back,
//  the dial faces -z. The front plate is z -4..0, the back plate z 40..44.
//
//  TRAIN  (driver wheel / driven pinion, module)
//    great wheel 144 / centre pinion 12 (0.7)   great wheel 1 turn in 12 h
//    centre 96 / third pinion 8          (0.9)  centre 1 turn per hour
//    third 80 / escape pinion 16         (0.75) third 1 turn in 5 min
//    escape wheel 30 teeth: 1 turn per minute, 1 beat per second
//    hours on a subdial at 6: cannon 12 / wheel 36, pinion 10 / hour 40
//    8 days: 16 turns of the cord barrel at 12 h a turn
//
//  THE DEADBEAT
//    The pallet arbor P sits above the escape wheel where the lines to the
//    pallets are tangent to the tooth circle; the pallets span 7½ teeth
//    (45° each side of the vertical). The locking face of each pallet is
//    an arc about P, so while a pallet rests on a tooth the pendulum can
//    swing on without moving the wheel: no recoil. The entry pallet locks
//    on its inner face, the exit pallet on its outer face. Each pallet ends
//    in a slanted impulse face. The crutch couples the pendulum to the
//    pallets; the pallet angle is CRUTCH_K times the pendulum angle.
//    solveBeats() turns the wheel as far as the real outlines allow.
//
//  GREP MAP
//    const CAL / const L ...... counts, sizes, z planes, layout
//    function escapeTooth ..... one Graham tooth (pointed, leaning forward)
//    function palletPolys ..... the two pallets at a pallet angle
//    const ESC ................ the solved tables and escapeAngle
//    function chain ........... every train angle from the escape angle
//    const PARTS .............. the part cards
// ============================================================================
import * as G from '../geom.js';
import { solveBeats, look } from '../escapement.js';
import { makeRunner } from './common.js';
const { TAU, D, pol, add, sub, rot, ang, centreDist, drive, driveInv, gearSpec, fmtPeriod, clamp } = G;

export const CAL = {
  plateR: 115, plateT: 4, fBal: 0.5,
  great: { N: 144, m: 0.7 }, center: { N: 96, m: 0.9, p: 12 }, third: { N: 80, m: 0.75, p: 8 },
  escape: { N: 30, Ra: 26, Rf: 22.5, p: 16 },
  cannon: { N: 12, m: 1.0 }, minute: { N: 36, m: 1.0, p: 10, pm: 2.0 }, hour: { N: 40, m: 2.0 },
  span: 45 * D,                 // each pallet 45° from the vertical: 7½ teeth
  palletW: 1.8, lock: 0.2, impulse: 0.55,
  amp: 2.2 * D,                 // pendulum semi-arc
  pendL: 993.6,                 // seconds pendulum: g T^2 / (4 pi^2), T = 2 s
  bobR: 52,
  z: {
    great: 8, barrelLo: 10, barrelHi: 18, center: 22, third: 30, escape: 34, pallet: 34,
    frontLo: -4, frontHi: 0, backLo: 40, backHi: 44, crutch: 47, pend: 52,
    cannon: -7, minute: -7, hour: -10.5, dialLo: -14, dialHi: -13,
  },
  reserveTurns: 16,
};
const c = CAL;

// ── layout ─────────────────────────────────────────────────────────────────
const C = [0, 0];
const E = [0, 72];                                   // seconds subdial at 12
const P = add(E, [0, c.escape.Ra / Math.cos(c.span)]);
const T = G.circleX(C, centreDist(c.center.m, c.center.N, c.third.p), E, centreDist(c.third.m, c.third.N, c.escape.p), 1);
const Gw = pol(centreDist(c.great.m, c.great.N, c.center.p), 240 * D);
const H = [0, -72];                                  // hours subdial at 6
const M = G.circleX(C, centreDist(c.cannon.m, c.cannon.N, c.minute.N), H, centreDist(c.minute.pm, c.minute.p, c.hour.N), 1);
const pivot = [0, 128, c.z.pend];                   // suspension point
const forkY = 50;                                    // where the crutch fork meets the rod
// pallet angle per pendulum angle: the fork moves with the rod
const CRUTCH_K = (pivot[1] - forkY) / (P[1] - forkY);
export const L = { C, E, P, T, G: Gw, H, M, pivot, forkY, CRUTCH_K };

// ── the escapement in 2D ───────────────────────────────────────────────────
const Ra = c.escape.Ra, Rf = c.escape.Rf, pitch = TAU / c.escape.N, rP = Ra * Math.tan(c.span);
// one tooth at angle 0 (tip at +x), closed through the wheel body; the tip
// leans forward (+angle, the way the wheel turns)
export function escapeTooth() {
  const p = pitch, h = Ra - Rf;
  return [pol(Rf - 1.2, -0.30 * p), pol(Rf, -0.55 * p), pol(Rf + 0.35 * h, -0.42 * p), pol(Rf + 0.75 * h, -0.20 * p), pol(Ra, 0),
    pol(Ra - 0.25 * h, -0.035 * p), pol(Rf + 0.2 * h, -0.07 * p), pol(Rf, -0.09 * p)];
}
export function wheelOutline() {
  const out = [], t = escapeTooth().slice(1);
  for (let k = 0; k < c.escape.N; k++) for (const q of t) out.push(rot(q, k * pitch));
  return out;
}
const TOOTH = escapeTooth();
// a band about P between radii r0 < r1, from angle aBack to its tip. The
// edge at radius lockR (the locking face) ends at aTip; the other edge ends
// at aTip + slant, so the tip is cut by the slanted impulse face.
function band(r0, r1, aBack, aTip, lockR, slant, n = 32) {
  const aIn = lockR === r0 ? aTip : aTip + slant, aOut = lockR === r1 ? aTip : aTip + slant, out = [];
  for (let i = 0; i <= n; i++) out.push(add(P, pol(r0, aBack + (aIn - aBack) * i / n)));
  for (let i = n; i >= 0; i--) out.push(add(P, pol(r1, aBack + (aOut - aBack) * i / n)));
  return out;
}
// the two pallets at pallet angle g (radians, + turns the anchor CCW)
export function palletPolys(g) {
  const w = c.palletW, im = c.impulse / rP, lk = c.lock / rP;
  const ae = -135 * D, ax = -45 * D;               // contact directions from P
  // At g = 0 (pendulum at the centre) each pallet straddles the tooth
  // circle mid-impulse. A pallet lets its tooth drop when the anchor has
  // turned it out by half an impulse; at that moment the other pallet's
  // locking corner must already be in by the lock, so the tooth lands on
  // the locking arc, not on the slanted face (which would push it back).
  // entry: band [rP, rP + w], into the wheel with +angle; locks on its inner arc
  const entry = band(rP, rP + w, ae - 0.32, ae + lk - im / 2, rP, im);
  // exit: band [rP - w, rP], into the wheel with -angle; locks on its outer arc
  const exit = band(rP - w, rP, ax + 0.32, ax - lk + im / 2, rP, -im);
  return [entry, exit].map(poly => poly.map(q => add(P, rot(sub(q, P), g))));
}
// teeth near either pallet, placed for wheel angle th
export function teethNear(th) {
  const out = [];
  for (let k = 0; k < c.escape.N; k++) {
    const a = ((th + k * pitch) % TAU + TAU) % TAU;
    if (Math.abs(a - 135 * D) < 0.5 || Math.abs(a - 45 * D) < 0.5) out.push(G.place(TOOTH, E, th + k * pitch));
  }
  return out;
}
const hits = (th, g) => {
  const pals = palletPolys(g), teeth = teethNear(th);
  return teeth.some(t => pals.some(pl => G.polysOverlap(t, pl)));
};
const GMAX = c.amp * CRUTCH_K;
const VT = solveBeats({ hits, g0: -GMAX, g1: GMAX, pitch, dir: 1, n: 200, step: 0.0008 });
// swing j runs from phi = j PI - PI/2 to j PI + PI/2: even j swings toward +
function escapeAngle(phi) {
  const j = Math.floor((phi + Math.PI / 2) / Math.PI), th = c.amp * Math.sin(phi);
  const cyc = Math.floor(j / 2), odd = j - 2 * cyc;
  const u = odd ? (c.amp - th) / (2 * c.amp) : (th + c.amp) / (2 * c.amp);
  return VT.start + cyc * VT.cycle + (odd ? VT.a + look(VT.B, u) : look(VT.A, u));
}
function depthAt(phi) {
  const thE = escapeAngle(phi), pals = palletPolys(CRUTCH_K * c.amp * Math.sin(phi));
  let d = 0;
  for (const t of teethNear(thE)) for (const pl of pals) for (const q of t) if (G.inPoly(q, pl)) d = Math.max(d, G.depthIn(q, pl));
  return d;
}
export const ESC = { tables: VT, pitch, depthAt, escapeAngle, palletPolys, E, P, Ra, Rf, lift: 0.3 * D };

// ── kinematics ─────────────────────────────────────────────────────────────
export function chain(thE) {
  const third = driveInv(thE, c.third.N, c.escape.p, ang(T, E));
  const center = driveInv(third, c.center.N, c.third.p, ang(C, T));
  const great = driveInv(center, c.great.N, c.center.p, ang(Gw, C));
  const minute = drive(center, c.cannon.N, c.minute.N, ang(C, M));
  const hour = drive(minute, c.minute.p, c.hour.N, ang(M, H));
  return { escape: thE, escPinion: thE, third, center, great, barrel: great, minute, hour, cannon: center, second: thE };
}
const run = makeRunner({
  escAngle: phi => escapeAngle(phi), lift: 0.3 * D, fBal: c.fBal, beat: 1,
  ampFor: r => (r > 0 ? c.amp : 0), amp0: c.amp,
  startE: VT.start, cycleE: VT.cycle, chain, reserveTurns: c.reserveTurns,
  spent: (ch, C0) => -(ch.great - C0.great) / TAU,
  extra: (s, ch, p) => ({ pendulum: p.balance, pallet: CRUTCH_K * p.balance, drum: ch.great - s.wound * TAU }),
});

export function periods() {
  const escape = 60, third = escape * c.third.N / c.escape.p, center = third * c.center.N / c.third.p;
  const great = center * c.great.N / c.center.p, minute = center * c.minute.N / c.cannon.N, hour = minute * c.hour.N / c.minute.p;
  return { escape, third, center, great, barrel: great, minute, hour, cannon: center, balance: 2, pendulum: 2 };
}
const PER = periods();

const BR = 'brass, polished and lacquered';
export const PARTS = {
  plate: { name: 'Front plate', group: 'Frame', role: 'One of two heavy brass plates. Regulators use thick plates and four pillars so nothing flexes, because a regulator is the clock other clocks are set by.', specs: [['Size', '164 × 232 mm'], ['Thickness', '4 mm'], ['Material', BR]] },
  backPlate: { name: 'Back plate', group: 'Frame', role: 'It carries the rear pivots and, on its top edge, the suspension cock that the pendulum hangs from.', specs: [['Thickness', '4 mm'], ['Material', BR]] },
  pillars: { name: 'Pillars', group: 'Frame', role: 'Four turned pillars hold the plates 40 mm apart.', specs: [['Count', '4']] },
  barrel: { name: 'Great wheel and barrel', group: 'Power', role: 'A falling weight pulls a gut line off the grooved barrel. A weight gives the same force at every hour, which is why regulators are weight driven. A crank on the square at the front winds it once a week.', specs: gearSpec(144, 0.7, [['Run', '8 days'], ['Turns', `${c.reserveTurns} of the barrel`]]), rate: 'great', live: 'reserve' },
  center: { name: 'Centre wheel', group: 'Going train', role: 'Turns once an hour and carries the long minute hand at the centre of the dial.', specs: gearSpec(96, 0.9, [['Pinion', '12 leaves']]), rate: 'center' },
  third: { name: 'Third wheel', group: 'Going train', role: 'Steps the hour up to the minute: 96/8 × 80/16 = 60.', specs: gearSpec(80, 0.75, [['Pinion', '8 leaves']]), rate: 'third' },
  escape: { name: 'Escape wheel', group: 'Escapement', role: 'Thirty fine pointed teeth. It turns once a minute, one tooth every two seconds, and its arbor carries the seconds hand at 12.', specs: [['Teeth', '30, Graham'], ['Diameter', `${(Ra * 2).toFixed(0)} mm`], ['Pinion', '16 leaves']], rate: 'escape' },
  pallet: { name: 'Deadbeat pallets', group: 'Escapement', role: 'Graham\'s anchor. The locking faces are arcs about the pallet arbor, so a tooth resting on them is not pushed back as the pendulum swings on: the seconds hand stands dead still between beats. The slanted ends give the impulse.', specs: [['Span', '7½ teeth'], ['Width', `${c.palletW} mm`], ['Lock', `${c.lock} mm`], ['Impulse', `${c.impulse} mm`], ['Pallets', 'jewelled']], live: 'pallet' },
  crutch: { name: 'Crutch', group: 'Escapement', role: 'An arm from the pallet arbor down to a fork round the pendulum rod. It passes the impulse to the pendulum and lets the pendulum move the pallets.', specs: [['Ratio', `pallets turn ${CRUTCH_K.toFixed(2)} × the pendulum`]], live: 'pallet' },
  suspension: { name: 'Suspension', group: 'Regulator', role: 'A thin steel spring in a cock on the back plate. The pendulum hangs from it and flexes it as it swings; there is no pivot to wear.', specs: [['Spring', 'steel, 0.1 mm']] },
  pendulum: { name: 'Seconds pendulum', group: 'Regulator', role: 'About 994 mm from the suspension to the centre of oscillation, so each swing takes one second. A heavy bob and a small arc make it slow to disturb. The nut under the bob sets the rate.', specs: [['Length', `${c.pendL.toFixed(1)} mm`], ['Beat', '1 s'], ['Arc', `±${(c.amp / D).toFixed(1)}°`], ['Rod', 'invar']], live: 'balance' },
  weight: { name: 'Driving weight', group: 'Power', role: 'A brass-cased lead weight on a gut line round the barrel. It falls about 60 cm in 8 days; the crank winds it back up.', specs: [['Mass', 'about 5 kg'], ['Fall', '8 days']], live: 'reserve' },
  cannon: { name: 'Cannon pinion', group: 'Motion works', role: 'On the centre arbor, under the minute hand. It drives the hour train to the subdial at 6.', specs: [['Leaves', '12']], rate: 'cannon' },
  minuteWheel: { name: 'Hour train wheel', group: 'Motion works', role: 'It turns once in 3 hours and carries the pinion that drives the hour wheel at 6.', specs: gearSpec(36, 1.0, [['Pinion', '10 leaves']]), rate: 'minute' },
  hourWheel: { name: 'Hour wheel', group: 'Motion works', role: 'Under the hour subdial at 6. A regulator keeps the hour hand off the centre so the minute and seconds hands are never hidden.', specs: gearSpec(40, 2.0), rate: 'hour' },
  dial: { name: 'Regulator dial', group: 'Display', role: 'Minutes round the edge from the centre, seconds in a subdial at 12 and hours in a subdial at 6: three separate hands, so each reads without parallax or confusion.', specs: [['Diameter', '290 mm']] },
  hourHand: { name: 'Hour hand', group: 'Display', role: 'On the hour subdial at 6.', specs: [], rate: 'hour' },
  minuteHand: { name: 'Minute hand', group: 'Display', role: 'The long hand at the centre: one turn an hour.', specs: [], rate: 'cannon' },
  secondHand: { name: 'Seconds hand', group: 'Display', role: 'On the escape arbor: one turn a minute. It moves one second per beat and stands still between beats.', specs: [['Steps', '1 per second']], rate: 'escape' },
};

export default {
  id: 'deadbeat', name: 'Deadbeat Regulator', kind: 'Regulator clock', era: 'Graham, c. 1715', mech: 'deadbeat',
  blurb: 'A seconds pendulum and Graham\'s deadbeat: the seconds hand stops dead between beats. The clock other clocks were set by.',
  CAL, L, ESC, chain, ...run, periods, PARTS, plateR: c.plateR, escapeTooth,
  pendulum: { L: c.pendL, bobR: c.bobR, pivot },
  zRange: [-18, 60], focus: [0, 90, c.z.escape],
  train: [['great', 'Great wheel', 144, '—'], ['center', 'Centre', 96, 12], ['third', 'Third', 80, 8], ['escape', 'Escape', 30, 16]],
  freq: '0.5 Hz · 3,600 beats/h', beatSeconds: 1, reserveHours: [180, 200], hoursPerTurn: PER.great / 3600,
  trainNote: 'From the centre wheel to the escape wheel: 96/8 × 80/16 = 60. The escape wheel turns once a minute; with 30 teeth and 2 beats a tooth, that is one beat a second.',
  about: [
    ['The deadbeat', 'George Graham\'s improvement (about 1715) on the anchor escapement. The locking faces of the pallets are arcs centred on the pallet arbor, so a tooth resting on one is not pushed back while the pendulum finishes its swing. The seconds hand of an anchor clock recoils at every beat; a deadbeat\'s stands dead still.'],
    ['The pendulum', 'A seconds pendulum is about 994 mm long from its suspension to its centre of oscillation: each swing takes one second. It hangs from a thin spring, not a pivot, and swings through only a few degrees, where its period hardly depends on the arc.'],
    ['Weight drive', 'A weight on a gut line gives the same force all week, so the impulse at the pallets stays the same. The barrel turns once in 12 hours; 16 turns of line give 8 days.'],
    ['The dial', 'A regulator dial gives each hand its own place: minutes at the centre, seconds in a ring at 12, hours in a ring at 6. Nothing crosses, so the time is read to the second at a glance.'],
    ['Source', 'An original 8-day calibre: great wheel 144/12, centre 96/8, third 80/16, escape 30. The pallets span 7½ teeth and are collision-solved with the real outlines; a test checks that the escape wheel never turns back.'],
  ],
  meshes: [
    ['great wheel / centre pinion', 'great', G.wheelProfile(144, 0.7), Gw, 'center', G.pinionProfile(12, 0.7), C],
    ['centre / third pinion', 'center', G.wheelProfile(96, 0.9), C, 'third', G.pinionProfile(8, 0.9), T],
    ['third / escape pinion', 'third', G.wheelProfile(80, 0.75), T, 'escPinion', G.pinionProfile(16, 0.75), E],
    ['cannon / hour-train wheel', 'cannon', G.pinionProfile(12, 1.0), C, 'minute', G.wheelProfile(36, 1.0), M],
    ['hour-train pinion / hour wheel', 'minute', G.pinionProfile(10, 2.0), M, 'hour', G.wheelProfile(40, 2.0), H],
  ],
  fmtPeriod,
  views: {
    escapement: { az: 18, el: 8, explode: 0, bridges: false, dial: false, distK: 0.8, rate: 0.25 },
  },
  skip: {
    'a full wind runs': 'an 8-day clock runs 192 h; the generic loop stops at 120 h (see the calibre check)',
    'a run-down watch stays stopped': 'the generic loop stops before an 8-day clock runs down (see the calibre check)',
  },
  checks: [
    ['deadbeat: the escape wheel never turns back', () => {
      // the locking faces are arcs drawn as fine chords: their sag lets the
      // solve wobble by a fraction of a micron; true recoil is tens of microns
      let worst = 0;
      for (const tab of [VT.A, VT.B]) for (let i = 1; i < tab.length; i++) worst = Math.min(worst, tab[i] - tab[i - 1]);
      const um = -worst * Ra * 1000;
      return [um < 0.5, `largest backward step ${um.toFixed(3)} um at the tooth tips (limit 0.5 um)`];
    }],
    ['deadbeat: each beat moves half a tooth', () => {
      const a = VT.a / pitch, b = VT.b / pitch;
      return [Math.abs(a - 0.5) < 0.12 && Math.abs(b - 0.5) < 0.12, `${a.toFixed(3)}, ${b.toFixed(3)} of a tooth`];
    }],
    ['pendulum: length gives a 2 s period', () => {
      const Tp = TAU * Math.sqrt(c.pendL / 1000 / 9.80665);
      return [Math.abs(Tp - 2) < 0.002 && Math.abs(1 / c.fBal - Tp) < 0.002, `T = ${Tp.toFixed(4)} s at ${c.pendL} mm`];
    }],
    ['reserve: a full wind runs 8 days, then the clock stops', () => {
      const s = run.createState(0, 1.0);
      let hours = 0;
      while (hours < 240) { for (let i = 0; i < 60; i++) run.step(s, 60); hours++; if (s.stopped) break; }
      const b0 = run.pose(s).beats;
      for (let i = 0; i < 60; i++) run.step(s, 1);
      return [hours >= 185 && hours <= 200 && run.pose(s).beats === b0, `${hours} h, then ${run.pose(s).beats - b0} beats`];
    }],
    ['layout: wheels inside the plates', () => {
      const r = [[Gw, G.tipR(144, 0.7)], [C, G.tipR(96, 0.9)], [T, G.tipR(80, 0.75)], [E, Ra]];
      const bad = r.filter(([q, R]) => Math.abs(q[0]) + R > 82 || q[1] - R < -104 || q[1] + R > 128);
      return [bad.length === 0, `${bad.length} wheels outside x ±82, y -104..128`];
    }],
    ['layout: wheels in one z plane keep clear', () => {
      const discs = [['barrel', Gw, 26, c.z.barrelLo, c.z.barrelHi], ['great', Gw, G.tipR(144, 0.7), 7, 9], ['centre', C, G.tipR(96, 0.9), 21, 23],
        ['third', T, G.tipR(80, 0.75), 29, 31], ['escape', E, Ra, 33.4, 34.6]];
      let worst = Infinity, which = '';
      for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i], b = discs[j];
        if (a[4] <= b[3] || b[4] <= a[3]) continue;
        const g = G.dist(a[1], b[1]) - a[2] - b[2];
        if (g < worst) { worst = g; which = `${a[0]} / ${b[0]}`; }
      }
      return [worst > 0.5, `smallest gap ${worst === Infinity ? '—' : worst.toFixed(2) + ' mm'} ${which}`];
    }],
  ],
};

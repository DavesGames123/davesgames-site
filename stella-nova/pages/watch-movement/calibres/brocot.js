// ============================================================================
//  WATCH MOVEMENT  ·  calibres/brocot.js — French mantel clock, Brocot visible
// ────────────────────────────────────────────────────────────────────────────
//  An eight-day French "Paris" movement of the late 19th century with a
//  Brocot visible escapement: the escape wheel and a short anchor with two
//  half-round pallet pins sit on the dial, in front of everything, and a
//  short pendulum hangs at the back. An original calibre. No DOM, no THREE.
//
//  FRAME   as every calibre: mm, x right, y to 12, z out of the back; the
//  dial faces -z. Here the front plate is z -2.4..0, the back plate
//  z 18..20.4, and the escape wheel and anchor are in front of the dial.
//
//  POWER PATH  (driver / driven, module)
//    barrel 96 / intermediate pinion 12 (0.32)   barrel 1 turn in 72 h
//    intermediate 72 / centre pinion 8   (0.26)  centre 1 turn per hour
//    centre 84 / third pinion 7          (0.22)  third 12 turns an hour
//    third 90 / escape pinion 6          (0.18)  escape 180 turns an hour
//    escape wheel 30 teeth: 60 beats a turn, 10,800 beats an hour,
//    3 beats a second, pendulum at 1.5 Hz, 110 mm long
//    motion works: cannon 12 / minute 36, pinion 10 / hour 40
//
//  BROCOT ESCAPEMENT
//    Two pins of half round section (the round face locks and gives the
//    impulse, the flat face lets the tooth drop) on an anchor that spans
//    10½ teeth. The anchor pivot sits where the pin paths are tangent to
//    the wheel, so the pins move almost along the radial locking faces of
//    the teeth: near deadbeat. solveBeats() finds the wheel angle against
//    the anchor angle by collision of the real outlines. The pendulum
//    drives the anchor through the crutch, one to one.
//
//  MIRROR
//    The tables turn the escape wheel toward -angle; the train needs it to
//    turn toward +angle (two meshes to the centre wheel). As in the
//    tourbillon, the escapement is solved in a canonical frame and shown
//    mirrored in x (it is symmetric about x = 0): the world escape angle is
//    minus the table angle, and the world anchor angle minus the swing.
//
//  GREP MAP
//    const CAL / const L ....... counts, sizes, z planes, layout
//    function brocotWheel ...... teeth with radial locking faces
//    function halfPin .......... a half-round pallet pin
//    const VERGE-like tables ... VT (solveBeats over the swing)
//    function chain ............ every angle from the table angle
//    const PARTS ............... part cards
// ============================================================================
import * as G from '../geom.js';
import { solveBeats, look } from '../escapement.js';
import { makeRunner } from './common.js';
const { TAU, D, pol, add, sub, rot, ang, centreDist, drive, driveInv, gearSpec, fmtPeriod } = G;

export const CAL = {
  plateR: 38, plateT: 2.4, backLo: 18, backT: 2.4, bph: 10800, fBal: 1.5,
  barrel: { N: 96, m: 0.32 }, inter: { N: 72, m: 0.26, p: 12 }, center: { N: 84, m: 0.22, p: 8 },
  third: { N: 90, m: 0.18, p: 7 }, escape: { N: 30, R: 6.0, Rf: 5.04, p: 6 },
  cannon: { N: 12, m: 0.3 }, minute: { N: 36, m: 0.3, p: 10, pm: 0.288 }, hour: { N: 40, m: 0.288 },
  // the escapement, in wheel radii from the search (wheel R 10 -> 6 mm)
  pinR: 0.54, pinRad: 6.39, pivotD: 13.8, span: 63 * D, amp: 2.1 * D,
  pendL: 110.4, bobR: 16,
  z: {
    center: 2.0, inter: 4.0, third: 5.5, barrelLo: 7.0, barrelHi: 16.0, barrelTeeth: 7.4,
    cannon: -3.6, minute: -3.6, hour: -4.4, dialLo: -8.6, dialHi: -8.0,
    escape: -10.4, anchor: -10.4, frontCock: -12.2, pend: 24.0, crutch: 22.4,
  },
  reserveTurns: 2.8, dialR: 45,
};
const c = CAL, Z = c.z;

// ── layout ─────────────────────────────────────────────────────────────────
const C = [0, 0];
const E = [0, 12];
const P = [0, E[1] + c.pivotD];
const T = G.circleX(C, centreDist(c.center.m, c.center.N, c.third.p), E, centreDist(c.third.m, c.third.N, c.escape.p), -1);
const S2 = pol(centreDist(c.inter.m, c.inter.N, c.center.p), 225 * D);
const B = add(S2, pol(centreDist(c.barrel.m, c.barrel.N, c.inter.p), -45 * D));
const M = pol(centreDist(c.cannon.m, c.cannon.N, c.minute.N), 200 * D);
export const L = {
  C, E, P, T, S2, B, M,
  pillars: [45, 135, 225, 315].map(a => pol(34, a * D)),
  suspension: [0, 33], regulator: [0, 42.6],
  aperture: { c: [0, (E[1] + P[1]) / 2 - 1.2], r: 12.6 },
};

// ── the escapement (canonical frame: the wheel at the origin) ──────────────
// teeth: the locking face radial on the leading (-angle) side, the back
// sloping away to the trailing root
export function brocotWheel(N = c.escape.N, R = c.escape.R, Rf = c.escape.Rf) {
  const p = TAU / N, out = [];
  for (let k = 0; k < N; k++) {
    const a = k * p;
    out.push(pol(Rf, a), pol(R, a), pol(R - 0.072, a + 0.07 * p), pol(Rf + 0.25 * (R - Rf), a + 0.62 * p), pol(Rf, a + 0.75 * p));
  }
  return out;
}
// a half-round pin at c: the round half faces +t (upstream), the flat lies
// along the radius a
export function halfPin(cn, a, rp = c.pinR, n = 14) {
  const r = [Math.cos(a), Math.sin(a)], t = [-r[1], r[0]], out = [];
  for (let i = 0; i <= n; i++) { const f = Math.PI * i / n; out.push(add(cn, [rp * (Math.cos(f) * r[0] + Math.sin(f) * t[0]), rp * (Math.cos(f) * r[1] + Math.sin(f) * t[1])])); }
  return out;
}
const WHEEL = brocotWheel();
const Pc = [0, c.pivotD];                                  // the anchor pivot, canonical
const PINS0 = [1, -1].map(sg => { const a = Math.PI / 2 + sg * c.span; return { c: pol(c.pinRad, a), a }; });
export const pinsAt = g => PINS0.map(q => halfPin(add(Pc, rot(sub(q.c, Pc), g)), q.a + g));
const hits = (th, g) => { const poly = G.place(WHEEL, [0, 0], th); return pinsAt(g).some(pp => G.polysOverlap(pp, poly)); };
const VT = solveBeats({ hits, g0: -c.amp, g1: c.amp, pitch: TAU / c.escape.N, n: 240, step: 0.001 });
// swing j runs from phi = j PI - PI/2 to j PI + PI/2; even j swings toward
// +g (table A), odd j back (table B)
function escapeAngle(phi) {
  const j = Math.floor((phi + Math.PI / 2) / Math.PI), g = c.amp * Math.sin(phi);
  const cyc = Math.floor(j / 2), odd = j - 2 * cyc;
  const u = odd ? (c.amp - g) / (2 * c.amp) : (g + c.amp) / (2 * c.amp);
  return VT.start + cyc * VT.cycle + (odd ? VT.a + look(VT.B, u) : look(VT.A, u));
}
function depthAt(phi) {
  const th = escapeAngle(phi), g = c.amp * Math.sin(phi), poly = G.place(WHEEL, [0, 0], th);
  let d = 0;
  for (const pp of pinsAt(g)) for (const q of poly) if (G.inPoly(q, pp)) d = Math.max(d, G.depthIn(q, pp));
  return d;
}
export const ESC = { tables: VT, pitch: TAU / c.escape.N, depthAt: phi => depthAt(phi), escapeAngle, wheel: WHEEL, pinsAt, Pc, lift: 0.4 * D };

// ── kinematics (world: the mirror turns the table angle round) ─────────────
export function chain(eL) {
  const escape = -eL;
  const third = driveInv(escape, c.third.N, c.escape.p, ang(T, E));
  const center = driveInv(third, c.center.N, c.third.p, ang(C, T));
  const inter = driveInv(center, c.inter.N, c.center.p, ang(S2, C));
  const barrel = driveInv(inter, c.barrel.N, c.inter.p, ang(B, S2));
  const minute = drive(center, c.cannon.N, c.minute.N, ang(C, M));
  const hour = drive(minute, c.minute.p, c.hour.N, ang(M, C));
  return { escapeL: eL, escape, escPinion: escape, third, center, inter, barrel, minute, hour, cannon: center };
}
const run = makeRunner({
  escAngle: phi => escapeAngle(phi), lift: 0.4 * D, fBal: c.fBal, beat: 1 / 3,
  ampFor: r => (r > 0 ? c.amp : 0), amp0: c.amp,
  startE: VT.start, cycleE: VT.cycle, chain, reserveTurns: c.reserveTurns,
  // four meshes from the escape wheel: the barrel turns toward +angle
  spent: (ch, C0) => (ch.barrel - C0.barrel) / TAU,
  extra: (s, ch, p) => ({ anchor: p.balance, pendulum: -p.balance, ratchet: -s.wound * TAU }),
});

export function periods() {
  const escape = 20, third = escape * c.third.N / c.escape.p, center = third * c.center.N / c.third.p;
  const inter = center * c.inter.N / c.center.p, barrel = inter * c.barrel.N / c.inter.p;
  const minute = center * c.minute.N / c.cannon.N, hour = minute * c.hour.N / c.minute.p;
  return { escape, escPinion: escape, third, center, inter, barrel, minute, hour, cannon: center, balance: 1 / c.fBal, pendulum: 1 / c.fBal };
}
const PER = periods();

const BRASS = 'brass, gilt';
export const PARTS = {
  plate: { name: 'Front plate', group: 'Frame', role: 'One of two round brass plates. The train runs between them on four pillars; the escapement sits outside, on the dial.', specs: [['Diameter', `${c.plateR * 2} mm`], ['Material', BRASS]] },
  backPlate: { name: 'Back plate', group: 'Frame', role: 'The rear plate. It carries the pendulum suspension and the crutch, and is stamped with the maker\'s medallion on real Paris movements.', specs: [['Diameter', `${c.plateR * 2} mm`]] },
  pillars: { name: 'Pillars', group: 'Frame', role: 'Four turned brass pillars hold the plates 18 mm apart.', specs: [['Count', '4']] },
  barrel: { name: 'Going barrel', group: 'Power', role: 'A large toothed drum with an eight-day mainspring. It is wound with a key through a hole in the dial.', specs: gearSpec(96, 0.32, [['Run', `${Math.round(c.reserveTurns * PER.barrel / 3600 / 24)} days`]]), rate: 'barrel', live: 'reserve' },
  inter: { name: 'Intermediate wheel', group: 'Going train', role: 'An eight-day clock needs one more wheel than a watch, so that the barrel turns slowly enough for a week on one winding.', specs: gearSpec(72, 0.26, [['Pinion', '12 leaves']]), rate: 'inter' },
  center: { name: 'Centre wheel', group: 'Going train', role: 'Turns once an hour and carries the minute hand through the cannon pinion.', specs: gearSpec(84, 0.22, [['Pinion', '8 leaves']]), rate: 'center' },
  third: { name: 'Third wheel', group: 'Going train', role: 'It drives the escape pinion; the escape arbor runs out through the front plate and the dial.', specs: gearSpec(90, 0.18, [['Pinion', '7 leaves']]), rate: 'third' },
  escape: { name: 'Escape wheel', group: 'Escapement', role: 'Thirty teeth with radial locking faces, on the dial for all to see. Two beats move it one tooth.', specs: [['Teeth', '30'], ['Diameter', `${(c.escape.R * 2).toFixed(0)} mm`], ['Pinion', '6 leaves']], rate: 'escape' },
  anchor: { name: 'Brocot anchor', group: 'Escapement', role: 'A short anchor with two half-round pallet pins, often red cornelian or jewel. The round face locks a tooth and then takes the impulse; the flat face lets the tooth drop clear. Its pivot is placed so the pins move along the tooth faces: almost deadbeat.', specs: [['Span', '10½ teeth'], ['Pins', `${(c.pinR * 2).toFixed(2)} mm, half round`], ['Swing', `±${(c.amp / D).toFixed(1)}°`]], live: 'anchor' },
  pendulum: { name: 'Pendulum', group: 'Regulator', role: 'A short brass rod and a round bob at the back. 110 mm long, it swings 1.5 times a second, three beats a second.', specs: [['Length', `${c.pendL.toFixed(0)} mm`], ['Bob', `${c.bobR * 2} mm`], ['Frequency', '1.5 Hz · 10,800 beats/h']], live: 'pendulum', angleKey: 'pendulum' },
  crutch: { name: 'Crutch', group: 'Regulator', role: 'It joins the anchor arbor to the pendulum rod, so the pendulum swings the anchor and receives its impulse.', specs: [] },
  suspension: { name: 'Brocot suspension', group: 'Regulator', role: 'The pendulum hangs from a thin spring between two chops. A square above XII turns a screw that slides the chops along the spring: shorter is faster. Brocot\'s invention, set from the front with a key.', specs: [['Adjust', 'from the dial, above XII']] },
  frontCock: { name: 'Escapement cock', group: 'Frame', role: 'A small bridge on the dial that holds the front pivots of the escape wheel and the anchor.', specs: [] },
  cannon: { name: 'Cannon pinion', group: 'Motion works', role: 'A friction fit on the centre arbor that carries the minute hand.', specs: [['Leaves', '12']], rate: 'cannon' },
  minuteWheel: { name: 'Minute wheel', group: 'Motion works', role: 'It turns once in 3 hours and drives the hour wheel.', specs: gearSpec(36, 0.3, [['Pinion', '10 leaves']]), rate: 'minute' },
  hourWheel: { name: 'Hour wheel', group: 'Motion works', role: 'It carries the hour hand: 36/12 × 40/10 = 12.', specs: gearSpec(40, 0.288), rate: 'hour' },
  dial: { name: 'Dial', group: 'Display', role: 'White enamel, cut away above the centre to show the escapement.', specs: [['Diameter', `${c.dialR * 2} mm`]] },
  hourHand: { name: 'Hour hand', group: 'Display', role: 'One turn in 12 hours.', specs: [['Style', 'Breguet']], rate: 'hour' },
  minuteHand: { name: 'Minute hand', group: 'Display', role: 'One turn per hour.', specs: [['Style', 'Breguet']], rate: 'cannon' },
  winding: { name: 'Winding square', group: 'Power', role: 'The barrel arbor, squared at the dial: a key winds the mainspring. A click on the back plate holds it.', specs: [] },
};

export default {
  id: 'brocot', name: 'Brocot Visible', kind: 'Mantel clock', era: 'Paris, c. 1880', mech: 'brocot',
  blurb: 'An eight-day French clock movement whose escapement sits on the dial: a short anchor with two half-round pins rocking over a 30-tooth wheel.',
  // plateR here is the camera fit radius: the 90 mm dial and the top of
  // the pendulum, not the 76 mm plates (CAL.plateR)
  CAL, L, ESC, chain, ...run, periods, PARTS, plateR: 50,
  pendulum: { L: c.pendL, bobR: c.bobR, pivot: [L.suspension[0], L.suspension[1], Z.pend] },
  zRange: [-13, 25], focus: [0, (E[1] + P[1]) / 2 - 2, Z.escape],
  train: [['barrel', 'Barrel', 96, '—'], ['inter', 'Intermediate', 72, 12], ['center', 'Centre', 84, 8], ['third', 'Third', 90, 7], ['escape', 'Escape', 30, 6]],
  freq: '1.5 Hz · 10,800 beats/h', beatSeconds: 1 / 3, reserveHours: [190, 210], hoursPerTurn: PER.barrel / 3600,
  trainNote: 'From the centre wheel to the escape wheel: 84/7 × 90/6 = 180 turns an hour; 30 teeth give 60 beats a turn, 10,800 an hour.',
  about: [
    ['Visible escapement', 'Achille Brocot (1817–1878) put the escapement on the face of the clock, where it became an ornament. French makers used it on mantel and drum clocks from the 1840s into the 20th century.'],
    ['Half-round pallets', 'Each pallet is a pin ground away to half its section. A tooth lands on the round face and is locked there; as the anchor swings on, the tooth slides down the quarter circle of the face and pushes the pallet, which is the impulse; then it drops past the flat face onto the other pin.'],
    ['Near deadbeat', 'The anchor pivot sits where the paths of the pins run along the tooth faces, so once a tooth is locked the swing of the pendulum hardly pushes the wheel back. A recoil would show as a flick of the wheel; here it is barely there.'],
    ['Eight days', 'An intermediate wheel between the barrel and the centre wheel slows the barrel, so one winding runs a week and a day. The key goes into a hole in the dial.'],
    ['Source', 'An original movement in the pattern of the French Paris movement (two round plates, four pillars, a short pendulum on a Brocot suspension). The train meshes are tested for overlap and the escapement is collision-solved.'],
  ],
  meshes: [
    ['barrel / intermediate pinion', 'barrel', G.wheelProfile(96, 0.32), B, 'inter', G.pinionProfile(12, 0.32), S2],
    ['intermediate / centre pinion', 'inter', G.wheelProfile(72, 0.26), S2, 'center', G.pinionProfile(8, 0.26), C],
    ['centre / third pinion', 'center', G.wheelProfile(84, 0.22), C, 'third', G.pinionProfile(7, 0.22), T],
    ['third / escape pinion', 'third', G.wheelProfile(90, 0.18), T, 'escPinion', G.pinionProfile(6, 0.18), E],
    ['cannon / minute wheel', 'cannon', G.pinionProfile(12, 0.3), C, 'minute', G.wheelProfile(36, 0.3), M],
    ['minute pinion / hour', 'minute', G.pinionProfile(10, 0.288), M, 'hour', G.wheelProfile(40, 0.288), C],
  ],
  fmtPeriod,
  views: { escapement: { az: 180, el: 6, explode: 0, dial: true, bridges: true, distK: 0.9 } },
  skip: {
    'a full wind runs': 'an eight-day clock outruns the 120 h loop of the generic test; see the eight-day check below',
    'a run-down watch stays stopped': 'covered by the eight-day check below',
  },
  checks: [
    ['eight days: a full wind runs 190..210 h, then the clock stops and stays stopped', () => {
      const s = run.createState(0, 1.0);
      let hours = 0;
      while (hours < 260) { for (let i = 0; i < 60; i++) run.step(s, 60); hours++; if (s.stopped) break; }
      const b0 = run.pose(s).beats;
      for (let i = 0; i < 60; i++) run.step(s, 1);
      return [hours >= 190 && hours <= 210 && s.stopped && run.pose(s).beats === b0, `${hours} h, stopped ${s.stopped}`];
    }],
    ['escapement: near deadbeat (recoil under 10% of a tooth)', () => {
      let back = 0;
      for (const t of [VT.A, VT.B]) { let mn = 0; for (const v of t) { mn = Math.min(mn, v); back = Math.max(back, v - mn); } }
      return [back < 0.1 * ESC.pitch, `${(back / ESC.pitch * 100).toFixed(1)}% of a tooth`];
    }],
    ['pendulum: 110 mm swings at 1.5 Hz', () => {
      const f = Math.sqrt(9810 / c.pendL) / TAU;
      return [Math.abs(f - c.fBal) < 0.01, `${f.toFixed(3)} Hz`];
    }],
    ['layout: train inside the plates, clear of the pillars', () => {
      const r = Math.max(G.len(B) + 15.8, G.len(T) + 8.4, G.len(S2) + 9.7, G.len(P) + 1.5);
      const gp = Math.min(...L.pillars.map(q => Math.min(G.dist(q, B) - 15.8, G.dist(q, S2) - 9.7, G.dist(q, T) - 8.4, G.dist(q, C) - 9.5) - 1.6));
      return [r < c.plateR - 0.5 && gp > 0.3, `reach ${r.toFixed(1)} < ${c.plateR}, pillar gap ${gp.toFixed(1)} mm`];
    }],
    ['layout: wheels in one z plane keep clear', () => {
      const discs = [['barrel', B, 15.8, Z.barrelLo, Z.barrelHi], ['centre', C, 9.5, Z.center - 0.25, Z.center + 0.25], ['intermediate', S2, 9.7, Z.inter - 0.25, Z.inter + 0.25], ['third', T, 8.4, Z.third - 0.2, Z.third + 0.2]];
      let worst = Infinity, which = '';
      for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i], b = discs[j];
        if (a[4] <= b[3] || b[4] <= a[3]) continue;
        const g = G.dist(a[1], b[1]) - a[2] - b[2]; if (g < worst) { worst = g; which = `${a[0]} / ${b[0]}`; }
      }
      return [worst > 0.1, worst === Infinity ? 'no two share a plane' : `smallest gap ${worst.toFixed(2)} mm (${which})`];
    }],
  ],
};

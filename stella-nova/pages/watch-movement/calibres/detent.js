// ============================================================================
//  WATCH MOVEMENT  ·  calibres/detent.js — Earnshaw spring-detent chronometer
// ────────────────────────────────────────────────────────────────────────────
//  An original pocket marine chronometer, 14,400 vph (2 Hz), with Thomas
//  Earnshaw's spring detent escapement (c. 1780). The escape wheel is held
//  by a ruby locking stone on a flat spring (the detent). Once per full
//  oscillation, on the active swing, the discharging pallet on the balance
//  staff lifts the detent through the gold passing spring; one tooth falls
//  onto the impulse pallet and pushes the balance directly; the next tooth
//  locks. On the return (passive) swing the discharging pallet bends the
//  gold spring aside and the detent does not move. So the wheel moves one
//  whole tooth per oscillation: the chronometer ticks in half seconds.
//  No DOM and no THREE.
//
//  POWER PATH  (driver wheel / driven pinion, module)
//    barrel 80 / centre pinion 10 (0.19)    barrel 1 turn in 8 h, 7 turns
//    centre 80 / third pinion 10   (0.125)  centre 1 turn in 1 h
//    third  75 / fourth pinion 10  (0.12)   fourth 1 turn per minute
//    fourth 80 / escape pinion 10  (0.10)   escape 8 turns a minute
//    escape wheel 15 teeth: 120 teeth a minute, one per 0.5 s oscillation
//
//  ESCAPEMENT SOLVE
//    solveDetent() runs one full oscillation by collision of the real
//    outlines: the active swing (balance angle -W..+W, detent lifted by the
//    discharging pallet near the start) then the passive swing (+W..-W,
//    detent at rest). The wheel turns as far as the locking stone and the
//    impulse pallet allow. One table covers both swings.
//
//  GREP MAP
//    const CAL ............ counts, sizes, z planes
//    const L .............. layout (solved from centre distances)
//    function detentPoly / palletPoly / dischargeLift  blockers
//    function solveDetent . the one-oscillation table
//    function chain ....... every train angle from the escape angle
//    const PARTS .......... the part cards
// ============================================================================
import * as G from '../geom.js';
import { look } from '../escapement.js';
import { makeRunner } from './common.js';
const { TAU, D, pol, add, sub, rot, ang, clamp, centreDist, drive, driveInv, gearSpec, fmtPeriod } = G;

export const CAL = {
  plateR: 21, plateT: 1.8, bph: 14400, fBal: 2,
  barrel: { N: 80, m: 0.19 },
  center: { N: 80, m: 0.125, p: 10 },
  third: { N: 75, m: 0.12, p: 10 },
  fourth: { N: 80, m: 0.10, p: 10 },
  escape: { N: 15, Ra: 2.6, Rf: 1.85, p: 10 },
  cannon: { N: 12, m: 0.15 },
  minute: { N: 36, m: 0.15, p: 10, pm: 0.144 },
  hour: { N: 40, m: 0.144 },
  balR: 8.0, rImp: 1.5, palletPen: 0.3, rDis: 0.95, W: 46 * D, liftMax: 0.6, unlock: [-12 * D, 2 * D],
  z: {
    center: 0.45, fourth: 0.45, third: 1.15, escape: 1.3, detent: 1.3, barrelTeeth: 1.0,
    barrelLo: 0.85, barrelHi: 2.6, bridgeLo: 2.8, bridgeHi: 4.0, roller: 1.3, discharge: 2.05,
    balance: 4.6, hairspring: 5.6, cockLo: 6.4, cockHi: 7.4,
    cannon: -2.05, minute: -2.05, hour: -2.45, dialLo: -3.2, dialHi: -2.9,
  },
  reserveTurns: 7,
};
const c = CAL;

// ── layout ─────────────────────────────────────────────────────────────────
const C = [0, 0];
const B = pol(centreDist(c.barrel.m, c.barrel.N, c.center.p), 120 * D);
const F = [0, -11];
const T = G.circleX(C, centreDist(c.center.m, c.center.N, c.third.p), F, centreDist(c.third.m, c.third.N, c.fourth.p), 1);
const E = add(F, pol(centreDist(c.fourth.m, c.fourth.N, c.escape.p), 20 * D));
const psi = 70 * D;                                       // escape -> balance
const u = pol(1, psi), n = [-u[1], u[0]];
const Bal = add(E, pol(c.escape.Ra + c.rImp + 0.42 - c.palletPen, psi));
const M = pol(centreDist(c.cannon.m, c.cannon.N, c.minute.N), 200 * D);
// locking stone downstream of the line of centres; the detent foot lies
// along the tangent there, so the stone lifts straight out from the wheel
const aL = psi - 56 * D;
const stoneAt = add(E, pol(c.escape.Ra + 0.25, aL));
const tL = [-Math.sin(aL), Math.cos(aL)];
const Ld = 7.0;
const foot = add(stoneAt, [-tL[0] * Ld, -tL[1] * Ld]);
export const L = {
  C, B, T, F, E, Bal, M, psi, aL, foot, stoneAt,
  cockFoot: add(Bal, pol(10.7, Math.atan2(Bal[1], Bal[0]) + 22 * D)),
  upAt: [0, 9.2],
  hornTip: add(Bal, pol(c.rDis + 0.35, psi + Math.PI - 34 * D)),
};

// ── escapement outlines (world frame) ──────────────────────────────────────
// Earnshaw teeth: a pointed tooth leaning toward the turn (-angle), with a
// near-radial locking face and a long curved back
export function detentWheel(N = c.escape.N, Ra = c.escape.Ra, Rf = c.escape.Rf) {
  const p = TAU / N, h = Ra - Rf, out = [];
  for (let k = 0; k < N; k++) {
    const cc = k * p;
    for (let j = 0; j <= 3; j++) out.push(pol(Rf, cc - 0.45 * p + 0.37 * p * j / 3));
    out.push(pol(Ra, cc - 0.2 * p));
    out.push(pol(Ra - 0.5 * h, cc - 0.1 * p));
    out.push(pol(Rf + 0.22 * h, cc + 0.12 * p));
    out.push(pol(Rf + 0.05 * h, cc + 0.4 * p));
  }
  return out;
}
const WHEEL = detentWheel();
// the detent's locking stone: a radial bar; its locking face faces +angle.
// A lift of s turns the detent about its foot by s / Ld, so the stone moves
// out along the radius
const STONE_W = 0.34, DEPTH = 0.28;
export function stonePoly(s) {
  const r = pol(1, aL), t = [-r[1], r[0]];
  const at = (rr, side) => add(E, [r[0] * rr + t[0] * side, r[1] * rr + t[1] * side]);
  const poly = [at(c.escape.Ra - DEPTH, -STONE_W / 2), at(c.escape.Ra + 1.2, -STONE_W / 2), at(c.escape.Ra + 1.2, STONE_W / 2), at(c.escape.Ra - DEPTH, STONE_W / 2)];
  return poly.map(q => add(foot, rot(sub(q, foot), -s / Ld)));
}
// the impulse pallet on the impulse roller: at balance angle b it points
// along psi + PI + b from the balance axis
export function palletPoly(b) {
  const a = psi + Math.PI + b, r = pol(1, a), t = [-r[1], r[0]], w = 0.2;
  const at = (rr, side) => add(Bal, [r[0] * rr + t[0] * side, r[1] * rr + t[1] * side]);
  return [at(c.rImp - 0.2, -w / 2), at(c.rImp + 0.42, -w / 2), at(c.rImp + 0.42, w / 2), at(c.rImp - 0.2, w / 2)];
}
// the discharging pallet lifts the detent on the active swing only
const bump = x => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x));
export function dischargeLift(b, active) {
  if (!active) return 0;
  const [b0, b1] = c.unlock;
  return c.liftMax * bump((b - b0) / (b1 - b0));
}

// ── the one-oscillation collision solve ────────────────────────────────────
// g in [0, 1]: active swing, b = -W + 2 W g; g in [1, 2]: passive swing,
// b = W - 2 W (g - 1)
const gb = g => (g <= 1 ? { b: -c.W + 2 * c.W * g, active: true } : { b: c.W - 2 * c.W * (g - 1), active: false });
function hits(th, g) {
  const { b, active } = gb(g);
  const wheel = G.place(WHEEL, E, th);
  return G.polysOverlap(stonePoly(dischargeLift(b, active)), wheel) || G.polysOverlap(palletPoly(b), wheel);
}
function solveDetent(n = 400, step = 0.0012) {
  const pitch = TAU / c.escape.N;
  let bad = 0; const log = [];
  function advance(th0, g, maxTurn) {
    let th = th0;
    if (hits(th, g)) {
      let found = null;
      for (let k = 1; k * step < maxTurn / 2 && found === null; k++) {
        if (!hits(th0 + k * step, g)) found = th0 + k * step;
        else if (!hits(th0 - k * step, g)) found = th0 - k * step;
      }
      if (found === null) return { th, jammed: true };
      th0 = th = found;
    }
    for (;;) {
      if (Math.abs(th - th0) > maxTurn) return { th, runaway: true };
      if (hits(th - step, g)) {
        let lo = th, hi = th - step;
        for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (hits(mid, g)) hi = mid; else lo = mid; }
        return { th: lo };
      }
      th -= step;
    }
  }
  // find a phase where the wheel is locked by the stone (not the pallet)
  let th = 0;
  th = advance(th, 2, 2 * pitch).th;
  th = advance(th, 2, 2 * pitch).th;
  const start = th, tab = [];
  for (let i = 0; i <= n; i++) {
    const g = 2 * i / n, r = advance(th, g, 1.5 * pitch);
    if (r.runaway || r.jammed) { bad++; log.push([+g.toFixed(3), r.runaway ? 'run' : 'jam']); }
    th = r.th; tab.push(th - start);
  }
  const raw = th - start, teeth = Math.round(raw / pitch);
  return { start, tab, n, raw, cycle: teeth ? teeth * pitch : raw, bad, pitch, log };
}
const VT = solveDetent();
// the active swing is the zero crossing at phi = 2 PI k (b rising); the
// passive one at phi = PI + 2 PI k
function escapeAngle(phi, amp) {
  const k = Math.round(phi / Math.PI), d = phi - k * Math.PI;
  const bl = amp * Math.sin(d);                     // the balance angle, signed along this swing
  const cyc = Math.floor(k / 2), odd = k - 2 * cyc;
  const u = clamp((bl + c.W) / (2 * c.W), 0, 1);
  const g = odd ? 1 + u : u;
  return VT.start + cyc * VT.cycle + look(VT.tab, g / 2);
}
function depthAt(phi, amp) {
  const k = Math.round(phi / Math.PI), d = phi - k * Math.PI, odd = k % 2 !== 0;
  const bl = amp * Math.sin(d), b = odd ? -bl : bl;
  const wheel = G.place(WHEEL, E, escapeAngle(phi, amp));
  let dep = 0;
  for (const poly of [stonePoly(dischargeLift(b, !odd)), palletPoly(b)]) for (const q of wheel) if (G.inPoly(q, poly)) dep = Math.max(dep, G.depthIn(q, poly));
  return dep;
}
const blockersAt = (phi, amp) => {
  const k = Math.round(phi / Math.PI), d = phi - k * Math.PI, odd = k % 2 !== 0;
  const bl = amp * Math.sin(d), b = odd ? -bl : bl;
  return { b, lift: dischargeLift(b, !odd) };
};
export const ESC = { E, P: Bal, Bal, psi, wheel: WHEEL, pitch: TAU / c.escape.N, tables: { ...VT, a: VT.cycle, b: 0 }, escapeAngle, depthAt, blockersAt, stonePoly, palletPoly, lift: c.W * 0.9 };

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
const run = makeRunner({
  escAngle: escapeAngle, lift: c.W * 0.9, fBal: c.fBal, beat: 0.25, amp0: 230 * D,
  startE: VT.start, cycleE: VT.cycle, chain, reserveTurns: c.reserveTurns,
  spent: (ch, C0) => -(ch.barrel - C0.barrel) / TAU,
  extra: (s, ch, p) => {
    const bk = blockersAt(s.phi, s.amp);
    return { detentLift: bk.lift, ratchet: -s.wound * TAU };
  },
});

export function periods() {
  const esc = 60 / (c.fourth.N / c.escape.p);
  const fourth = 60, third = fourth * c.third.N / c.fourth.p;
  const center = third * c.center.N / c.third.p, barrel = center * c.barrel.N / c.center.p;
  const minute = center * c.minute.N / c.cannon.N, hour = minute * c.hour.N / c.minute.p;
  return { escape: esc, fourth, third, center, barrel, minute, hour, cannon: center, balance: 1 / c.fBal };
}
const PER = periods();

const GILT = 'brass, fire-gilt';
export const PARTS = {
  plate: { name: 'Pillar plate', group: 'Frame', role: 'The base of the chronometer. Marine chronometers were built heavy and plain: thick plates, few decorations, every part made to be adjusted.', specs: [['Diameter', '42 mm'], ['Material', GILT]] },
  jewel: { name: 'Jewel bearing', group: 'Frame', role: 'A pivot in a ruby, with a flat endstone, so the rate does not change as the oil ages.', specs: [['Material', 'synthetic ruby']] },
  barrel: { name: 'Barrel', group: 'Power', role: 'The drum that holds the mainspring. Here it drives the centre pinion directly; many marine chronometers add a fusee to even out the force.', specs: gearSpec(80, 0.19), rate: 'barrel' },
  mainspring: { name: 'Mainspring', group: 'Power', role: 'Wound once a day, with two days in reserve. The up-and-down dial at 12 shows how much is left.', specs: [['Reserve', `${(c.reserveTurns * PER.barrel / 3600).toFixed(0)} h`]], live: 'reserve' },
  center: { name: 'Centre wheel', group: 'Going train', role: 'Turns once an hour and carries the minute hand.', specs: gearSpec(80, 0.125, [['Pinion', '10 leaves']]), rate: 'center' },
  third: { name: 'Third wheel', group: 'Going train', role: 'The middle stage of the train.', specs: gearSpec(75, 0.12, [['Pinion', '10 leaves']]), rate: 'third' },
  fourth: { name: 'Fourth wheel', group: 'Going train', role: 'Turns once a minute and carries the seconds hand, which jumps in half seconds: one tooth of the escape wheel per oscillation.', specs: gearSpec(80, 0.10, [['Pinion', '10 leaves']]), rate: 'fourth' },
  escape: { name: 'Escape wheel', group: 'Escapement', role: 'Fifteen pointed teeth with undercut locking faces. It moves one whole tooth per oscillation of the balance, in one quick jump.', specs: [['Teeth', '15'], ['Tip Ø', `${(c.escape.Ra * 2).toFixed(1)} mm`], ['Pinion', '10 leaves']], rate: 'escape' },
  detent: { name: 'Spring detent', group: 'Escapement', role: 'A thin steel blade fixed at its foot. Its ruby locking stone holds a tooth of the escape wheel; when the discharging pallet lifts it, the wheel is free for one tooth.', specs: [['Blade length', `${Ld.toFixed(1)} mm`], ['Lift', `${c.liftMax.toFixed(1)} mm at the stone`], ['Locking', 'ruby, ~1.5° draw']], live: 'detentLift', angleKey: 'detentLift' },
  passing: { name: 'Gold passing spring', group: 'Escapement', role: 'A gold hair spring on the detent. On the active swing the discharging pallet presses it and lifts the detent; on the passive swing the pallet bends it aside and the detent stays still.', specs: [['Material', 'gold']] },
  impulse: { name: 'Impulse roller', group: 'Escapement', role: 'A large roller on the balance staff with a ruby impulse pallet. The released tooth falls on the pallet and pushes the balance directly, with almost no friction and no oil.', specs: [['Radius', `${c.rImp} mm`], ['Impulse', 'once per oscillation']], angleKey: 'balance' },
  balance: { name: 'Compensation balance', group: 'Regulator', role: 'A bimetallic split rim (brass outside, steel inside) with screws. As the temperature rises the rim curls inward and keeps the rate when the hairspring softens.', specs: [['Diameter', `${(c.balR * 2).toFixed(0)} mm`], ['Frequency', '2 Hz · 14,400 vph'], ['Rim', 'brass and steel, cut']], live: 'balance' },
  hairspring: { name: 'Helical hairspring', group: 'Regulator', role: 'A cylindrical (helical) spring, used in marine chronometers because it breathes evenly about the axis.', specs: [['Form', 'helical, 10 turns']], live: 'balance' },
  bridges: { name: 'Bridges', group: 'Frame', role: 'Plain gilt bridges holding the upper pivots of the train.', specs: [['Finish', 'frosted gilt']] },
  cock: { name: 'Balance cock', group: 'Frame', role: 'A broad cock with a diamond endstone over the balance staff.', specs: [] },
  screws: { name: 'Screws', group: 'Frame', role: 'Blued steel screws.', specs: [] },
  cannon: { name: 'Cannon pinion', group: 'Motion works', role: 'A friction fit on the centre arbor carries the minute hand.', specs: [['Leaves', '12']], rate: 'cannon' },
  minuteWheel: { name: 'Minute wheel', group: 'Motion works', role: 'It turns once in 3 hours and drives the hour wheel.', specs: gearSpec(36, 0.15), rate: 'minute' },
  hourWheel: { name: 'Hour wheel', group: 'Motion works', role: 'It carries the hour hand: 36/12 × 40/10 = 12.', specs: gearSpec(40, 0.144), rate: 'hour' },
  dial: { name: 'Chronometer dial', group: 'Display', role: 'Silvered, with large seconds at 6 and an up-and-down (power reserve) indicator at 12.', specs: [] },
  reserveHand: { name: 'Up-and-down hand', group: 'Display', role: 'It shows how many hours the mainspring has left.', specs: [['Range', '0–56 h']], live: 'reserve' },
  hourHand: { name: 'Hour hand', group: 'Display', role: 'One turn in 12 hours.', specs: [], rate: 'hour' },
  minuteHand: { name: 'Minute hand', group: 'Display', role: 'One turn per hour.', specs: [], rate: 'cannon' },
  secondHand: { name: 'Seconds hand', group: 'Display', role: 'Jumps every half second: a dead-beat chronometer second.', specs: [['Steps', '2 per second']], rate: 'fourth' },
};

export default {
  id: 'detent', name: 'Detent Chronometer', kind: 'Marine chronometer', era: 'Earnshaw, c. 1780', mech: 'detent',
  blurb: 'A spring detent holds the escape wheel; once per oscillation the balance lifts it and takes a direct impulse. The chronometer ticks in half seconds.',
  CAL, L, ESC, chain, ...run, periods, PARTS, plateR: c.plateR,
  zRange: [-3.8, 7.6], focus: [(E[0] + Bal[0]) / 2, (E[1] + Bal[1]) / 2, 1.4],
  train: [['barrel', 'Barrel', 80, '—'], ['center', 'Centre', 80, 10], ['third', 'Third', 75, 10], ['fourth', 'Fourth', 80, 10], ['escape', 'Escape', 15, 10]],
  freq: '2 Hz · 14,400 vph', beatSeconds: 0.25, reserveHours: [52, 60], hoursPerTurn: PER.barrel / 3600,
  trainNote: 'The fourth wheel turns once a minute and the escape wheel 80/10 = 8 times: 120 teeth a minute, one per half-second oscillation.',
  about: [
    ['The detent', 'A flat steel spring (the detent) carries a ruby locking stone that holds a tooth of the escape wheel. Nothing else touches the wheel while the balance swings freely.'],
    ['The active swing', 'Near the middle of one swing, the discharging pallet on the balance staff presses the gold passing spring and lifts the detent. A tooth escapes and falls on the impulse pallet, which is just passing, and pushes the balance directly. The detent springs back and the next tooth locks.'],
    ['The passive swing', 'On the return swing the discharging pallet bends the gold spring aside and passes; the detent does not move. So the wheel gives one impulse per full oscillation, and the seconds hand jumps in half seconds.'],
    ['Why ships used it', 'The balance is detached for almost all of its arc and the impulse needs no oil, so the rate holds for months. A chronometer that keeps time at sea gives the ship its longitude.'],
    ['Source', 'An original movement on a classic chronometer train (escape wheel 15, 14,400 vph). The escapement is solved by collision of the wheel against the locking stone and the impulse pallet over a whole oscillation.'],
  ],
  meshes: [
    ['barrel / centre pinion', 'barrel', G.wheelProfile(80, 0.19), B, 'center', G.pinionProfile(10, 0.19), C],
    ['centre / third pinion', 'center', G.wheelProfile(80, 0.125), C, 'third', G.pinionProfile(10, 0.125), T],
    ['third / fourth pinion', 'third', G.wheelProfile(75, 0.12), T, 'fourth', G.pinionProfile(10, 0.12), F],
    ['fourth / escape pinion', 'fourth', G.wheelProfile(80, 0.10), F, 'escPinion', G.pinionProfile(10, 0.10), E],
    ['cannon / minute wheel', 'cannon', G.pinionProfile(12, 0.15), C, 'minute', G.wheelProfile(36, 0.15), M],
    ['minute pinion / hour', 'minute', G.pinionProfile(10, 0.144), M, 'hour', G.wheelProfile(40, 0.144), C],
  ],
  fmtPeriod,
  views: { escapement: { az: -30, el: 40, explode: 0.5, bridges: false, distK: 1.15 } },
  // the generic tables check two half-tooth beats; a detent moves one whole
  // tooth on the active swing and none on the passive one
  skip: {
    'escapement: each beat moves a fair share': 'a detent moves the wheel on the active swing only',
  },
  checks: [
    ['detent: one whole tooth per oscillation, all on the active swing', () => {
      const half = Math.round(VT.n / 2), act = VT.tab[half], pas = VT.tab[VT.n] - VT.tab[half];
      const ok = Math.abs(Math.abs(act) / VT.pitch - 1) < 0.02 && Math.abs(pas) / VT.pitch < 0.02;
      return [ok, `active ${(act / VT.pitch).toFixed(3)} tooth, passive ${(pas / VT.pitch).toFixed(3)} tooth`];
    }],
    ['detent: the locking stone clears the wheel at full lift', () => {
      // at full lift no tooth tip reaches the stone
      const s = stonePoly(c.liftMax), rIn = Math.min(...s.map(q => G.dist(q, E)));
      return [rIn > c.escape.Ra + 0.02, `stone inner edge ${rIn.toFixed(3)} mm from the axis, tips at ${c.escape.Ra}`];
    }],
    ['detent: the stone holds a tooth at rest', () => {
      const s = stonePoly(0), rIn = Math.min(...s.map(q => G.dist(q, E)));
      return [rIn < c.escape.Ra - 0.15, `stone reaches ${(c.escape.Ra - rIn).toFixed(2)} mm inside the tip circle`];
    }],
    ['layout: parts inside the plate', () => {
      const r = Math.max(G.len(B) + 7.84, G.len(Bal) + c.balR + 0.6, G.len(L.cockFoot) + 2.2, G.len(foot) + 1.2);
      return [r < c.plateR, `${r.toFixed(2)} < ${c.plateR}`];
    }],
  ],
};

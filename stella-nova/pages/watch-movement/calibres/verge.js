// ============================================================================
//  WATCH MOVEMENT  ·  calibres/verge.js — English verge fusee, c. 1780
// ────────────────────────────────────────────────────────────────────────────
//  A full-plate English pocket watch: two plates on four pillars, a fusee
//  and chain, a contrate wheel, a crown escape wheel standing on edge and a
//  verge with two flag pallets. An original calibre on the classic train.
//  No DOM and no THREE.
//
//  POWER PATH
//    fusee great wheel 48 / centre pinion 12   fusee 1 turn in 4 h
//    centre 54 / third pinion 6                centre 1 turn per hour
//    third 48 / contrate pinion 6
//    contrate 48 (teeth stand up) / crown pinion 6 (arbor lies flat)
//    crown wheel 15 teeth, verge: 9 x 8 x 8 = 576 turns per hour,
//    17,280 beats per hour, balance at 2.4 Hz
//    motion works: cannon 12 / minute 36, pinion 10 / hour 40
//
//  FUSEE
//    The mainspring pulls the chain off a cone. Wound, the chain leaves the
//    narrow top (strong spring, short lever); run down, it leaves the wide
//    base (weak spring, long lever), so the torque on the train stays near
//    even. 7.5 fusee turns, 30 hours.
//
//  VERGE
//    The crown wheel turns about a flat arbor (direction psi). The verge is
//    the balance staff itself, upright, just past the tooth tips. Its upper
//    pallet works the teeth at the top of the wheel, its lower pallet those
//    at the bottom; they move in opposite directions, half a tooth apart
//    (15 is odd). Each is solved in its own unrolled frame: X along the
//    arbor (tooth height), Y along the tooth path. solveBeats() turns the
//    wheel as far as both pallets allow; a pallet swinging into a tooth
//    pushes the wheel back. That recoil is the verge's signature.
//
//  GREP MAP
//    const CAL / const L .... counts, sizes, z planes, layout
//    function palletPoly .... a flag pallet in its unrolled frame
//    const VERGE ............ the solved tables and escapeAngle
//    function chain ......... every angle from the crown wheel angle
//    function chainPath ..... the fusee chain as a 3D curve
//    const PARTS ............ the part cards
// ============================================================================
import * as G from '../geom.js';
import { solveBeats, look } from '../escapement.js';
import { makeRunner } from './common.js';
const { TAU, D, pol, add, ang, centreDist, drive, driveInv, gearSpec, fmtPeriod, clamp } = G;

export const CAL = {
  plateR: 19, plateT: 1.4, bph: 17280, fBal: 2.4,
  great: { N: 48, m: 0.24 }, center: { N: 54, m: 0.22, p: 12, pm: 0.24 }, third: { N: 48, m: 0.2, p: 6, pm: 0.22 },
  contrate: { N: 48, m: 0.2, p: 6, pm: 0.2 }, crown: { N: 15, R: 2.2, h: 0.75, p: 6, pm: 0.2 },
  cannon: { N: 12, m: 0.15 }, minute: { N: 36, m: 0.15, p: 10, pm: 0.144 }, hour: { N: 40, m: 0.144 },
  fusee: { r0: 4.0, r1: 2.0, zLo: 0.85, zHi: 4.85, turns: 7.5 }, barrelR: 5.0,
  balR: 6.2, amp: 42 * D, palletLen: 0.5, palletW: 0.16, palletGap: 0.12, palletOpen: 100 * D,
  z: {
    great: 0.5, center: 5.3, third: 3.0, contrate: 1.5, contrateTop: 2.15, crown: 2.65,
    barrelLo: 0.6, barrelHi: 4.9, topLo: 6.0, topHi: 7.0, balance: 7.75, hairspring: 8.25, cockLo: 8.65, cockHi: 9.0,
    cannon: -1.65, minute: -1.65, hour: -2.05, dialLo: -2.8, dialHi: -2.5,
  },
  reserveTurns: 7.5,
};
const c = CAL;

// ── layout ─────────────────────────────────────────────────────────────────
const C = [0, 0];
const F = pol(centreDist(c.great.m, c.great.N, c.center.p), 135 * D);
const Bb = add(F, pol(10.4, 20 * D));
const T = pol(centreDist(c.center.m, c.center.N, c.third.p), -60 * D);
const Ct = add(T, pol(centreDist(c.third.m, c.third.N, c.contrate.p), -150 * D));
const psi = 150 * D;                                             // the crown arbor
const rQ = G.pitchR(c.contrate.m, c.contrate.N);                  // contact on the contrate rim
const rW = rQ + 2.5;                                             // crown wheel face from Ct
const Xw = add(Ct, pol(rW, psi));
const V = add(Ct, pol(rW + c.crown.h + c.palletGap, psi));        // the verge axis
const M = pol(centreDist(c.cannon.m, c.cannon.N, c.minute.N), 200 * D);
export const L = {
  C, F, Bb, T, Ct, Xw, V, psi, M, Q: add(Ct, pol(rQ, psi)),
  pillars: [45, 135, 225, 315].map(a => pol(16.9, (a + 12) * D)),
  cockFoot: add(V, pol(7.2, 18 * D)),
};

// ── the verge escapement (unrolled frames) ─────────────────────────────────
const R = c.crown.R, p = TAU * R / c.crown.N, h = c.crown.h, Xv = h + c.palletGap;
// a flag pallet from the verge axis at angle a in the frame; the frame's
// (X, Y) direction of the flag is (cos a, s * sin a)
export function palletPoly(a, s) {
  const d = [Math.cos(a), s * Math.sin(a)], n = [-d[1], d[0]], r0 = 0.12, r1 = c.palletLen, w = c.palletW / 2;
  return [[Xv + d[0] * r0 + n[0] * w, d[1] * r0 + n[1] * w], [Xv + d[0] * r1 + n[0] * w, d[1] * r1 + n[1] * w],
    [Xv + d[0] * r1 - n[0] * w, d[1] * r1 - n[1] * w], [Xv + d[0] * r0 - n[0] * w, d[1] * r0 - n[1] * w]];
}
// the pallets at verge angle th: upper flag at th + aU, lower at th + aL
const aU = Math.PI - c.palletOpen / 2, aL = Math.PI + c.palletOpen / 2;
export const pallets = th => [palletPoly(th + aU, -1), palletPoly(th + aL, 1)];
// teeth near Y = 0 in the top frame (offset -R PI/2) and the bottom frame
// (offset -3 R PI/2) at crown angle b; both rows move +Y as b grows
function rows(b) {
  const out = [];
  for (const off of [-R * Math.PI / 2, -3 * R * Math.PI / 2]) {
    const shift = off + R * b, k0 = Math.floor((-2 - shift) / p), k1 = Math.ceil((2 - shift) / p);
    out.push(G.crownTeeth(k0, k1, p, h).map(poly => poly.map(([x, y]) => [x, y + shift])));
  }
  return out;
}
const hits = (b, th) => {
  const [pu, pl] = pallets(th), [ru, rl] = rows(b);
  return ru.some(t => G.polysOverlap(t, pu)) || rl.some(t => G.polysOverlap(t, pl));
};
const VT = solveBeats({ hits, g0: -c.amp, g1: c.amp, pitch: TAU / c.crown.N, dir: 1, n: 480, step: 0.001 });
// the swing j runs from phi = j PI - PI/2 to j PI + PI/2; even j swings
// toward +th (table A), odd j back (table B)
function escapeAngle(phi) {
  const j = Math.floor((phi + Math.PI / 2) / Math.PI), th = c.amp * Math.sin(phi);
  const cyc = Math.floor(j / 2), odd = j - 2 * cyc;
  const u = odd ? (c.amp - th) / (2 * c.amp) : (th + c.amp) / (2 * c.amp);
  return VT.start + cyc * VT.cycle + (odd ? VT.a + look(VT.B, u) : look(VT.A, u));
}
function depthAt(phi) {
  const b = escapeAngle(phi), th = c.amp * Math.sin(phi), [pu, pl] = pallets(th), [ru, rl] = rows(b);
  let d = 0;
  for (const [rowP, pal] of [[ru, pu], [rl, pl]]) for (const t of rowP) for (const q of t) if (G.inPoly(q, pal)) d = Math.max(d, G.depthIn(q, pal));
  return d;
}
export const ESC = { tables: VT, pitch: TAU / c.crown.N, depthAt: phi => depthAt(phi), escapeAngle, rows, pallets, lift: 8 * D };

// ── kinematics ─────────────────────────────────────────────────────────────
// contrate angle from the crown angle: a contrate gap faces the pinion at
// psi when a pinion leaf points down (crown angle 0 mod one leaf)
const KS = 1;
export function chain(b) {
  const contrate = psi - Math.PI / c.contrate.N + KS * b * c.crown.p / c.contrate.N;
  const third = driveInv(contrate, c.third.N, c.contrate.p, ang(T, Ct));
  const center = driveInv(third, c.center.N, c.third.p, ang(C, T));
  const great = driveInv(center, c.great.N, c.center.p, ang(F, C));
  const minute = drive(center, c.cannon.N, c.minute.N, ang(C, M));
  const hour = drive(minute, c.minute.p, c.hour.N, ang(M, C));
  return { escape: b, crown: b, contrate, third, center, great, fusee: great, minute, hour, cannon: center };
}
const run = makeRunner({
  escAngle: phi => escapeAngle(phi), lift: 8 * D, fBal: c.fBal, beat: 1 / 4.8,
  ampFor: r => (r > 0 ? c.amp : 0), amp0: c.amp,
  startE: VT.start, cycleE: VT.cycle, chain, reserveTurns: c.reserveTurns,
  spent: (ch, C0) => -(ch.great - C0.great) / TAU,
  extra: (s, ch, pz) => ({ verge: pz.balance, fuseeTurn: ch.great + s.wound * TAU }),
});

// ── the fusee chain ────────────────────────────────────────────────────────
const pitchZ = (c.fusee.zHi - c.fusee.zLo) / c.fusee.turns;
export const fuseeR = z => c.fusee.r0 + (c.fusee.r1 - c.fusee.r0) * clamp((z - c.fusee.zLo) / (c.fusee.zHi - c.fusee.zLo), 0, 1);
// chain length on the fusee from the base up to turn n
const fuseeLen = n => { let L = 0; const k = 64; for (let i = 0; i < k; i++) L += TAU * fuseeR(c.fusee.zLo + (i + 0.5) / k * n * pitchZ) * n / k; return L; };
const FULL = fuseeLen(c.fusee.turns);
// open-belt tangent between the fusee (radius rf) and the barrel
function tangent(rf) {
  const d = G.dist(F, Bb), a0 = ang(F, Bb), t = Math.acos(clamp((rf - c.barrelR) / d, -1, 1));
  return { aF: a0 + t, aB: a0 + t, d };
}
// the chain as points [x, y, z] along its length, for a reserve fraction w
export function chainPath(w, n = 900) {
  const nf = c.fusee.turns * clamp(w, 0, 1), zf = c.fusee.zLo + nf * pitchZ, rf = fuseeR(zf);
  const tg = tangent(rf), onBarrel = (FULL - fuseeLen(nf)) / (TAU * c.barrelR);
  const pF = add(F, pol(rf, tg.aF)), pB = add(Bb, pol(c.barrelR, tg.aB));
  const zb = c.z.barrelHi - 0.5 - Math.min(onBarrel, 6.5) * 0.52;
  const nF = Math.max(2, Math.round(n * 0.55)), nS = Math.round(n * 0.05), nB = n - nF - nS;
  const pts = [];
  // on the fusee: from the base up to the leaving point, winding backward
  for (let i = 0; i < nF; i++) {
    const t = i / (nF - 1), turn = t * nf, z = c.fusee.zLo + turn * pitchZ;
    pts.push([...add(F, pol(fuseeR(z) + 0.06, tg.aF - (nf - turn) * TAU)), z]);
  }
  for (let i = 1; i <= nS; i++) { const t = i / (nS + 1); pts.push([pF[0] + (pB[0] - pF[0]) * t, pF[1] + (pB[1] - pF[1]) * t, zf + (zb - zf) * t]); }
  // on the barrel: from the meeting point round and down
  for (let i = 0; i < nB; i++) {
    const t = i / Math.max(1, nB - 1), turn = t * onBarrel;
    pts.push([...add(Bb, pol(c.barrelR + 0.06, tg.aB + turn * TAU)), zb + turn * 0.52]);
  }
  return { pts, travel: FULL - fuseeLen(nf), onBarrel, zf, rf };
}

export function periods() {
  const center = 3600, great = center * c.great.N / c.center.p, third = center * c.third.p / c.center.N;
  const contrate = third * c.contrate.p / c.third.N, crown = contrate * c.crown.p / c.contrate.N;
  const minute = center * c.minute.N / c.cannon.N, hour = minute * c.hour.N / c.minute.p;
  return { great, fusee: great, center, third, contrate, crown, escape: crown, minute, hour, cannon: center, balance: 1 / c.fBal, barrel: great };
}
const PER = periods();

const GILT = 'brass, fire-gilt';
export const PARTS = {
  plate: { name: 'Pillar plate', group: 'Frame', role: 'The lower plate, under the dial. Four pillars rise from it to hold the top plate: a "full plate" movement.', specs: [['Diameter', '38 mm'], ['Material', GILT]] },
  topPlate: { name: 'Top plate', group: 'Frame', role: 'The upper plate. The whole train runs between the two plates; only the balance sits outside, under its cock.', specs: [['Material', GILT], ['Finish', 'frosted gilt']] },
  pillars: { name: 'Pillars', group: 'Frame', role: 'Four turned pillars, riveted to the pillar plate and pinned to the top plate. Their shapes date a watch: these are tulip pillars.', specs: [['Count', '4'], ['Height', '6.0 mm']] },
  fusee: { name: 'Fusee', group: 'Fusee', role: 'A cone with a spiral groove for the chain. The full spring pulls on the narrow end and the weak spring on the wide end, so the torque reaching the train stays near even.', specs: [['Turns', `${c.fusee.turns}`], ['Radius', `${c.fusee.r1}–${c.fusee.r0} mm`], ['Great wheel', '48 teeth'], ['Run', `${(c.reserveTurns * PER.great / 3600).toFixed(0)} h`]], rate: 'great', angleKey: 'fuseeTurn' },
  chain: { name: 'Fusee chain', group: 'Fusee', role: 'A tiny steel chain of riveted links, less than half a millimetre wide, joining the barrel to the fusee. It winds off the fusee onto the barrel as the watch runs.', specs: [['Links', 'about 600'], ['Material', 'steel']], live: 'reserve' },
  barrel: { name: 'Going barrel', group: 'Power', role: 'It holds the mainspring, but has no teeth: it only pulls on the chain.', specs: [['Diameter', `${(c.barrelR * 2).toFixed(0)} mm`]] },
  center: { name: 'Centre wheel', group: 'Going train', role: 'Turns once an hour and carries the minute hand.', specs: gearSpec(54, 0.22, [['Pinion', '12 leaves']]), rate: 'center' },
  third: { name: 'Third wheel', group: 'Going train', role: 'It drives the pinion of the contrate wheel.', specs: gearSpec(48, 0.2, [['Pinion', '6 leaves']]), rate: 'third' },
  contrate: { name: 'Contrate wheel', group: 'Going train', role: 'Its teeth stand up from the rim like a crown, so it can drive a pinion whose arbor lies flat: the drive turns through 90° to reach the crown wheel.', specs: [['Teeth', '48, axial'], ['Pinion', '6 leaves'], ['Drives', 'crown wheel pinion']], rate: 'contrate' },
  escape: { name: 'Crown wheel', group: 'Escapement', role: 'The verge escape wheel. It stands on edge, and its saw teeth point along its arbor toward the verge. Teeth at the top work the upper pallet, teeth at the bottom the lower one.', specs: [['Teeth', '15'], ['Diameter', `${(R * 2).toFixed(1)} mm`], ['Pinion', '6 leaves']], rate: 'crown' },
  verge: { name: 'Verge', group: 'Escapement', role: 'The balance staff, with two flag pallets at about 100°. A tooth pushes one pallet aside and the balance swings; then the other pallet meets a tooth on the far side and pushes the wheel back (recoil) before the next tooth escapes.', specs: [['Pallets', `2 at ${(c.palletOpen / D).toFixed(0)}°`], ['Swing', `±${(c.amp / D).toFixed(0)}°`]], live: 'verge' },
  potence: { name: 'Potence', group: 'Frame', role: 'A bracket under the top plate that carries the lower pivot of the verge and the outer pivot of the crown wheel.', specs: [['Material', 'brass']] },
  balance: { name: 'Balance', group: 'Regulator', role: 'A plain three-armed balance. With no lever between it and the train, the verge is never free: that is why these watches kept time to minutes a day, not seconds.', specs: [['Diameter', `${(c.balR * 2).toFixed(1)} mm`], ['Frequency', '2.4 Hz · 17,280 vph']], live: 'balance' },
  hairspring: { name: 'Hairspring', group: 'Regulator', role: 'A short spiral of a few coils, the 1675 invention of Huygens and Hooke that made pocket watches worth carrying.', specs: [['Coils', '4']], live: 'balance' },
  cock: { name: 'Balance cock', group: 'Frame', role: 'The pride of an English verge: a wide table, pierced and engraved by hand, over the balance. A diamond endstone sits at its centre.', specs: [['Finish', 'pierced and gilt']] },
  jewel: { name: 'Diamond endstone', group: 'Frame', role: 'A diamond set in the cock, for the upper pivot of the verge to rest on.', specs: [['Material', 'diamond']] },
  cannon: { name: 'Cannon pinion', group: 'Motion works', role: 'A friction fit on the centre arbor carries the minute hand.', specs: [['Leaves', '12']], rate: 'cannon' },
  minuteWheel: { name: 'Minute wheel', group: 'Motion works', role: 'It turns once in 3 hours and drives the hour wheel.', specs: gearSpec(36, 0.15, [['Pinion', '10 leaves']]), rate: 'minute' },
  hourWheel: { name: 'Hour wheel', group: 'Motion works', role: 'It carries the hour hand: 36/12 × 40/10 = 12.', specs: gearSpec(40, 0.144), rate: 'hour' },
  dial: { name: 'Dial', group: 'Display', role: 'White enamel, with Roman hours and Arabic minutes, as English dials had in the 1780s. No seconds hand.', specs: [['Material', 'enamel on copper']] },
  hourHand: { name: 'Hour hand', group: 'Display', role: 'The English "beetle": a pierced body near the tip.', specs: [['Style', 'beetle']], rate: 'hour' },
  minuteHand: { name: 'Minute hand', group: 'Display', role: 'The "poker", a plain tapered pointer, paired with the beetle.', specs: [['Style', 'poker']], rate: 'cannon' },
};

export default {
  id: 'verge', name: 'Verge Fusee', kind: 'Pocket watch', era: 'London, c. 1780',
  blurb: 'A full-plate English watch: a fusee and chain even out the spring, and a verge rocks a crown wheel with a recoil on every swing.',
  CAL, L, ESC, chain, ...run, periods, PARTS, plateR: c.plateR, chainPath,
  zRange: [-3.4, 9.2], focus: [L.V[0] * 0.75 + Xw[0] * 0.25, L.V[1] * 0.75 + Xw[1] * 0.25, c.z.crown],
  train: [['great', 'Fusee', 48, '—'], ['center', 'Centre', 54, 12], ['third', 'Third', 48, 6], ['contrate', 'Contrate', 48, 6], ['crown', 'Crown', 15, 6]],
  freq: '2.4 Hz · 17,280 vph', beatSeconds: 1 / 4.8, reserveHours: [27, 33], hoursPerTurn: PER.great / 3600,
  trainNote: 'From the centre wheel to the crown wheel: 54/6 × 48/6 × 48/6 = 576 turns an hour; 15 teeth give 30 beats a turn, 17,280 an hour.',
  about: [
    ['The verge', 'The oldest mechanical escapement, from the 14th century. The balance staff (the verge) carries two flags at about 100°. The crown wheel pushes one flag aside, swinging the balance; then the other flag meets a tooth on the far side and drives the wheel back a little before it escapes. The balance is never free of the train, so the rate follows the force of the spring.'],
    ['The fusee', 'Because the verge is so sensitive to force, the spring must pull evenly. The chain runs from the barrel to a cone: when the spring is strong it pulls at the narrow top, when it is weak at the wide base. Watch the chain move down the cone as the watch runs down (try 3600×).'],
    ['The contrate wheel', 'The crown wheel stands on edge, so its pinion lies flat. The contrate wheel, with teeth that stand up from its rim, turns the drive through 90° to reach it.'],
    ['Full plate', 'Everything runs between two plates held apart by four pillars; only the balance sits outside, under the pierced and engraved cock that was the signature of the London trade.'],
    ['Source', 'An original movement on the classic English verge train (fusee 48, centre 54/12, third 48/6, contrate 48/6, crown 15/6, 17,280 beats per hour). The spur meshes are tested for overlap; the verge is collision-solved in two unrolled frames.'],
  ],
  meshes: [
    ['great wheel / centre pinion', 'great', G.wheelProfile(48, 0.24), F, 'center', G.pinionProfile(12, 0.24), C],
    ['centre / third pinion', 'center', G.wheelProfile(54, 0.22), C, 'third', G.pinionProfile(6, 0.22), T],
    ['third / contrate pinion', 'third', G.wheelProfile(48, 0.2), T, 'contrate', G.pinionProfile(6, 0.2), Ct],
    ['cannon / minute wheel', 'cannon', G.pinionProfile(12, 0.15), C, 'minute', G.wheelProfile(36, 0.15), M],
    ['minute pinion / hour', 'minute', G.pinionProfile(10, 0.144), M, 'hour', G.wheelProfile(40, 0.144), C],
  ],
  fmtPeriod, focusK: 1.7,
  depthTol: [0.025, 'recoil is a turning contact; the tables are linear between 480 samples, under a pixel at normal zoom'],
  views: { escapement: { az: -90, el: 30, explode: 0, bridges: false, dial: false, distK: 1.15 } },
  checks: [
    ['verge: the wheel recoils on each swing', () => {
      let back = 0;
      for (const tab of [VT.A, VT.B]) for (let i = 1; i < tab.length; i++) if (tab[i] < tab[i - 1] - 1e-4) back++;
      return [back > 0, `${back} samples move the wheel backward`];
    }],
    ['fusee: the chain leaves the narrow top when wound, the base when run down', () => {
      const a = chainPath(1), b = chainPath(0);
      return [a.rf < b.rf && a.zf > b.zf, `wound r ${a.rf.toFixed(2)} at z ${a.zf.toFixed(2)}; run down r ${b.rf.toFixed(2)} at z ${b.zf.toFixed(2)}`];
    }],
    ['layout: train clear of the fusee and barrel between the plates', () => {
      const g = [G.dist(T, F) - 4.9 - c.fusee.r0, G.dist(T, Bb) - 4.9 - c.barrelR, G.dist(Ct, F) - 5.0 - 5.9, G.dist(Ct, Bb) - 5.0 - c.barrelR];
      return [Math.min(...g) > 0.2, `smallest gap ${Math.min(...g).toFixed(2)} mm`];
    }],
    ['layout: balance and pillars inside the plate', () => {
      const r = Math.max(G.len(V) + c.balR, G.len(Bb) + c.barrelR, ...L.pillars.map(q => G.len(q) + 1.0));
      return [r < c.plateR, `${r.toFixed(2)} < ${c.plateR}`];
    }],
  ],
};

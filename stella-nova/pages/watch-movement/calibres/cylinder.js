// ============================================================================
//  WATCH MOVEMENT  ·  calibres/cylinder.js — cylinder escapement, Lépine calibre
// ────────────────────────────────────────────────────────────────────────────
//  A French/Swiss "Lépine" pocket watch of about 1850: separate bar bridges
//  instead of a full top plate, and Graham's cylinder escapement (1726, made
//  practical by Breguet and the Swiss trade). An original calibre on the
//  classic cylinder train, 18,000 vph. No DOM and no THREE.
//
//  POWER PATH  (driver / driven, module)
//    barrel 72 / centre pinion 12  (0.2)    barrel 1 turn in 6 h
//    centre 60 / third pinion 8    (0.15)   centre 1 turn per hour
//    third 64 / fourth pinion 8    (0.13)   third 1 turn in 7.5 min
//    fourth 60 / escape pinion 6   (0.11)   fourth 1 turn per minute
//    escape wheel 15 wedge teeth on stalks, cylinder on the balance staff,
//    balance at 2.5 Hz; motion works as the lever calibre
//
//  THE CYLINDER  (a frictional rest escapement; no lever)
//    The balance axis sits on the circle the tooth points travel. The
//    cylinder is a steel tube cut away to a little less than half at the
//    tooth plane. A tooth rests on its outside while the balance swings;
//    when the cut comes round, the tooth's wedge slides over the entry lip
//    (impulse) and drops inside, onto the inner wall. On the return swing
//    it slides out over the exit lip (impulse) and the next tooth drops on
//    the outside. One tooth per two beats; the wheel never leaves the
//    cylinder, so the balance is never free (friction on every swing).
//    The escapement is solved by collision in the tooth plane, as the lever
//    and the verge are: solveBeats() turns the wheel as far as the wall of
//    the cylinder (a C-shaped ring turning with the balance) allows.
//
//  GREP MAP
//    const CAL ............ tooth counts, modules, cylinder sizes, z planes
//    const L .............. layout (solved from the centre distances)
//    function wallPoly .... the cylinder's C section at a balance angle
//    function teethNear ... the wedge teeth near the cylinder
//    const ESC ............ the solved tables and escapeAngle
//    const PARTS .......... the part cards
// ============================================================================
import * as G from '../geom.js';
import { solveBeats, look } from '../escapement.js';
import { makeRunner } from './common.js';
const { TAU, D, pol, add, sub, rot, ang, centreDist, drive, driveInv, gearSpec, fmtPeriod, clamp } = G;

export const CAL = {
  plateR: 19, plateT: 1.5, bph: 18000, fBal: 2.5,
  barrel: { N: 72, m: 0.2 },
  center: { N: 60, m: 0.15, p: 12 },
  third: { N: 64, m: 0.13, p: 8 },
  fourth: { N: 60, m: 0.11, p: 8 },
  escape: { N: 15, Rt: 2.6, rim: 2.15, p: 6 },
  cannon: { N: 12, m: 0.15 }, minute: { N: 36, m: 0.15, p: 10, pm: 0.144 }, hour: { N: 40, m: 0.144 },
  // the cylinder (mm): bore and outside radius, the wall kept at the tooth
  // plane (degrees of arc), and the wedge teeth (length along the path,
  // height across it)
  cyl: { ri: 0.24, ro: 0.3, wall: 166 * D, toothL: 0.43, toothH: 0.13 },
  balR: 5.2, amp: 125 * D, span: 50 * D,
  z: {
    center: 0.45, fourth: 0.45, third: 1.15, barrelTeeth: 1.0, barrelLo: 0.85, barrelHi: 2.6,
    escRim: 0.95, teeth: 1.55, bridgeLo: 2.75, bridgeHi: 3.75, balance: 3.95, hairspring: 4.55, cockLo: 4.95, cockHi: 5.85,
    cannon: -1.8, minute: -1.8, hour: -2.2, dialLo: -2.95, dialHi: -2.65,
  },
  reserveTurns: 5.2,
};
const c = CAL;

// ── layout ─────────────────────────────────────────────────────────────────
const C = [0, 0];
const B = pol(centreDist(c.barrel.m, c.barrel.N, c.center.p), 128 * D);
const F = [0, -9.6];
const T = G.circleX(C, centreDist(c.center.m, c.center.N, c.third.p), F, centreDist(c.third.m, c.third.N, c.fourth.p), -1);
const E = add(F, pol(centreDist(c.fourth.m, c.fourth.N, c.escape.p), -24 * D));
const psi = 52 * D;                                   // escape centre to the cylinder axis
const Bal = add(E, pol(c.escape.Rt, psi));            // the balance axis on the tooth circle
const M = pol(centreDist(c.cannon.m, c.cannon.N, c.minute.N), 200 * D);
export const L = {
  C, B, T, F, E, Bal, M, psi,
  cockFoot: add(Bal, pol(8.0, 68 * D)),
};

// ── the escapement ─────────────────────────────────────────────────────────
const pitch = TAU / c.escape.N, Rt = c.escape.Rt, { ri, ro, wall, toothL, toothH } = c.cyl;
// the C section of the cylinder at balance angle g (world frame). In the
// cylinder frame x points away from the escape wheel and y up the tooth
// path (where the teeth come from); the wall is centred on +x.
export function wallPoly(g, n = 28) {
  const a0 = psi + g - wall / 2, a1 = psi + g + wall / 2, out = [];
  for (let i = 0; i <= n; i++) out.push(add(Bal, pol(ro, a0 + (a1 - a0) * i / n)));
  for (let i = n; i >= 0; i--) out.push(add(Bal, pol(ri, a0 + (a1 - a0) * i / n)));
  return out;
}
// one wedge tooth in the wheel frame: the point (toe) leads round the
// circle Rt, the heel trails by toothL; the slope faces outward
const TOOTH = [pol(Rt - toothH * 0.35, 0), pol(Rt + toothH * 0.65, toothL / Rt), pol(Rt - toothH * 0.35, toothL / Rt)];
export const toothPoly = k => TOOTH.map(p => rot(p, k * pitch));
// the teeth within reach of the cylinder at wheel angle th, in the world
export function teethNear(th, reach = 1.4) {
  const out = [];
  const k0 = Math.floor((psi - th - 0.6) / pitch), k1 = Math.ceil((psi - th + 0.6) / pitch);
  for (let k = k0; k <= k1; k++) {
    const poly = toothPoly(k).map(p => add(E, rot(p, th)));
    if (G.dist(poly[0], Bal) < reach || G.dist(poly[1], Bal) < reach) out.push(poly);
  }
  return out;
}
const hits = (th, g) => { const w = wallPoly(g); return teethNear(th).some(t => G.polysOverlap(t, w)); };
const VT = solveBeats({ hits, g0: -c.span, g1: c.span, pitch, n: 260, dir: -1, step: 0.0006 });
// beat k is the zero crossing at phi = k PI; even k swings toward +g
function escapeAngle(phi, amp) {
  const k = Math.round(phi / Math.PI), d = phi - k * Math.PI;
  const u = (amp * Math.sin(d) + c.span) / (2 * c.span);
  const cyc = Math.floor(k / 2), odd = k - 2 * cyc;
  return VT.start + cyc * VT.cycle + (odd ? VT.a + look(VT.B, u) : look(VT.A, u));
}
function depthAt(phi, amp) {
  const w = wallPoly(amp * Math.sin(phi)), teeth = teethNear(escapeAngle(phi, amp));
  let d = 0;
  for (const t of teeth) {
    for (const p of t) if (G.inPoly(p, w)) d = Math.max(d, G.depthIn(p, w));
    for (const p of w) if (G.inPoly(p, t)) d = Math.max(d, G.depthIn(p, t));
  }
  return d;
}
export const ESC = { tables: VT, pitch, escapeAngle, depthAt, wallPoly, teethNear, lift: 30 * D, E, Bal };

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
  escAngle: escapeAngle, lift: 30 * D, fBal: c.fBal, beat: 0.2, amp0: c.amp,
  ampFor: r => (r <= 0 ? 0 : c.amp * (0.78 + 0.22 * Math.min(1, r / 2))),
  startE: VT.start, cycleE: VT.cycle, chain, reserveTurns: c.reserveTurns,
  spent: (ch, C0) => -(ch.barrel - C0.barrel) / TAU,
  extra: (s, ch, p) => ({ cylinder: p.balance, ratchet: -s.wound * TAU }),
});

export function periods() {
  const escape = c.escape.N * 2 / (c.bph / 3600);
  const fourth = escape * c.fourth.N / c.escape.p, third = fourth * c.third.N / c.fourth.p;
  const center = third * c.center.N / c.third.p, barrel = center * c.barrel.N / c.center.p;
  const minute = center * c.minute.N / c.cannon.N, hour = minute * c.hour.N / c.minute.p;
  return { escape, fourth, third, center, barrel, minute, hour, cannon: center, balance: 1 / c.fBal };
}
const PER = periods();

const GILT = 'brass, fire-gilt';
export const PARTS = {
  plate: { name: 'Pillar plate', group: 'Frame', role: 'The one full plate of a Lépine calibre. Every bridge above it is a separate bar, so the movement is thinner than a full-plate watch.', specs: [['Diameter', '38 mm (17 lignes)'], ['Material', GILT]] },
  jewel: { name: 'Jewel bearing', group: 'Frame', role: 'A ruby bearing. Cylinder watches were often jewelled only at the balance and the escape wheel; the rest ran in brass holes.', specs: [['Material', 'synthetic ruby']] },
  barrel: { name: 'Barrel', group: 'Power', role: 'The going barrel. Its toothed rim drives the centre pinion directly.', specs: gearSpec(72, 0.2, [['Material', GILT]]), rate: 'barrel' },
  mainspring: { name: 'Mainspring', group: 'Power', role: 'The coiled spring in the barrel. A cylinder escapement is sensitive to its force, as the balance is never free of the train.', specs: [['Power reserve', `${(c.reserveTurns * PER.barrel / 3600).toFixed(0)} h`]], live: 'reserve' },
  center: { name: 'Centre wheel', group: 'Going train', role: 'Turns once an hour; its arbor carries the cannon pinion and the minute hand.', specs: gearSpec(60, 0.15, [['Pinion', '12 leaves']]), rate: 'center' },
  third: { name: 'Third wheel', group: 'Going train', role: 'The middle stage: 60/8 × 64/8 = 60 between the centre and the fourth wheel.', specs: gearSpec(64, 0.13, [['Pinion', '8 leaves']]), rate: 'third' },
  fourth: { name: 'Fourth wheel', group: 'Going train', role: 'Turns once a minute and carries the small seconds hand.', specs: gearSpec(60, 0.11, [['Pinion', '8 leaves'], ['Drives', 'escape pinion (6)']]), rate: 'fourth' },
  escape: { name: 'Cylinder escape wheel', group: 'Escapement', role: 'Fifteen wedge-shaped teeth stand on little stalks above the rim, so the rim can pass under the cylinder. Each tooth gives two impulses: in over the entry lip, out over the exit lip.', specs: [['Teeth', '15, on stalks'], ['Tooth circle', `Ø ${(Rt * 2).toFixed(1)} mm`], ['Tooth length', `${toothL.toFixed(2)} mm`], ['Pinion', '6 leaves']], rate: 'escape' },
  cylinder: { name: 'Cylinder', group: 'Escapement', role: 'A hardened steel tube on the balance staff, cut away to a little less than half at the tooth plane. The teeth rest on its outside and its inside in turn; its two lips take the impulse.', specs: [['Outside Ø', `${(ro * 2).toFixed(2)} mm`], ['Bore', `${(ri * 2).toFixed(2)} mm`], ['Wall kept', `${(wall / D).toFixed(0)}°`], ['Material', 'hardened steel']], live: 'balance' },
  balance: { name: 'Balance', group: 'Regulator', role: 'A plain gilt balance. Its rest on the cylinder is never free, so the cylinder watch keeps time to a minute or two a day, not seconds.', specs: [['Diameter', `${(c.balR * 2).toFixed(1)} mm`], ['Frequency', '2.5 Hz · 18,000 vph'], ['Swing', `about ±${(c.amp / D).toFixed(0)}°`]], live: 'balance' },
  hairspring: { name: 'Hairspring', group: 'Regulator', role: 'A flat steel spiral of a few coils.', specs: [['Coils', '7']], live: 'balance' },
  barrelBridge: { name: 'Barrel bar', group: 'Frame', role: 'A bar that carries the upper pivot of the barrel arbor: the Lépine idea of separate bridges.', specs: [['Material', GILT]] },
  trainBridge: { name: 'Train bars', group: 'Frame', role: 'Finger bridges, one per arbor, each held by its own screw.', specs: [['Material', GILT]] },
  escCock: { name: 'Escape cock', group: 'Frame', role: 'A small cock for the upper pivot of the escape wheel.', specs: [] },
  cock: { name: 'Balance cock', group: 'Frame', role: 'Carries the upper pivot of the balance staff and the regulator index.', specs: [['Regulator', 'index']] },
  screws: { name: 'Screws', group: 'Frame', role: 'Blued steel screws hold each bar to the pillar plate.', specs: [['Material', 'steel, heat blued']] },
  cannon: { name: 'Cannon pinion', group: 'Motion works', role: 'A friction fit on the centre arbor; it carries the minute hand.', specs: [['Leaves', '12']], rate: 'cannon' },
  minuteWheel: { name: 'Minute wheel', group: 'Motion works', role: 'It turns once in 3 hours and drives the hour wheel.', specs: gearSpec(36, 0.15, [['Pinion', '10 leaves']]), rate: 'minute' },
  hourWheel: { name: 'Hour wheel', group: 'Motion works', role: 'It carries the hour hand: 36/12 × 40/10 = 12.', specs: gearSpec(40, 0.144), rate: 'hour' },
  dial: { name: 'Dial', group: 'Display', role: 'White enamel with small seconds at 6.', specs: [['Material', 'enamel on copper']] },
  hourHand: { name: 'Hour hand', group: 'Display', role: 'One turn in 12 hours.', specs: [['Style', 'Breguet']], rate: 'hour' },
  minuteHand: { name: 'Minute hand', group: 'Display', role: 'One turn per hour.', specs: [['Style', 'Breguet']], rate: 'cannon' },
  secondHand: { name: 'Seconds hand', group: 'Display', role: 'On the fourth wheel arbor. Five small steps a second.', specs: [], rate: 'fourth' },
};

export default {
  id: 'cylinder', mech: 'cylinder', name: 'Cylinder', kind: 'Pocket watch', era: 'Lépine, c. 1850',
  blurb: 'A Lépine bar calibre with the cylinder escapement: the teeth ride in and out of a cut steel tube on the balance staff.',
  CAL, L, ESC, chain, ...run, periods, PARTS, plateR: c.plateR,
  zRange: [-3.5, 6.1], focus: [Bal[0] * 0.6 + E[0] * 0.4, Bal[1] * 0.6 + E[1] * 0.4, c.z.teeth],
  train: [['barrel', 'Barrel', 72, '—'], ['center', 'Centre', 60, 12], ['third', 'Third', 64, 8], ['fourth', 'Fourth', 60, 8], ['escape', 'Escape', 15, 6]],
  freq: '2.5 Hz · 18,000 vph', beatSeconds: 0.2, reserveHours: [28, 34], hoursPerTurn: PER.barrel / 3600,
  trainNote: 'From the centre wheel to the fourth wheel: 60/8 × 64/8 = 60. The escape wheel turns 60/6 = 10 times a minute: one tooth every two beats.',
  about: [
    ['The cylinder', 'George Graham invented it about 1726; Breguet and the Swiss trade made it the everyday escapement of the 19th century. A steel tube on the balance staff, cut away to a little less than half, replaces the pallets of the verge.'],
    ['How it ticks', 'A tooth rests on the outside of the tube while the balance swings. When the cut comes round, the wedge of the tooth slides over the entry lip and pushes the balance on (impulse), then drops inside onto the inner wall. On the way back it slides out over the exit lip (a second impulse), and the next tooth drops on the outside.'],
    ['Frictional rest', 'The tooth never leaves the cylinder: it rubs on the outside or the inside for the whole swing. The balance is never free, so oil and the force of the spring change the rate. The lever escapement, which leaves the balance free, replaced it.'],
    ['Lépine', 'Jean-Antoine Lépine did away with the top plate and the fusee: separate bars hold the arbors, so the watch could be made thin. Most cylinder watches were built this way.'],
    ['Source', 'An original calibre on a classic cylinder train (barrel 72, centre 60/12, third 64/8, fourth 60/8, escape 15/6). Every spur mesh is tested for overlap; the cylinder is collision-solved in the tooth plane.'],
  ],
  meshes: [
    ['barrel / centre pinion', 'barrel', G.wheelProfile(72, 0.2), B, 'center', G.pinionProfile(12, 0.2), C],
    ['centre / third pinion', 'center', G.wheelProfile(60, 0.15), C, 'third', G.pinionProfile(8, 0.15), T],
    ['third / fourth pinion', 'third', G.wheelProfile(64, 0.13), T, 'fourth', G.pinionProfile(8, 0.13), F],
    ['fourth / escape pinion', 'fourth', G.wheelProfile(60, 0.11), F, 'escPinion', G.pinionProfile(6, 0.11), E],
    ['cannon / minute wheel', 'cannon', G.pinionProfile(12, 0.15), C, 'minute', G.wheelProfile(36, 0.15), M],
    ['minute pinion / hour', 'minute', G.pinionProfile(10, 0.144), M, 'hour', G.wheelProfile(40, 0.144), C],
  ],
  fmtPeriod,
  // the balance sits right over the cylinder: look in from outside the
  // movement, low, between the plate and the balance
  views: { escapement: { az: 86, el: -10, explode: 0, bridges: false, dial: false, distK: 0.62 } },
  checks: [
    ['cylinder: the tooth fits the bore and the pitch clears the tube', () => {
      const pt = TAU * Rt / c.escape.N;
      return [toothL < 2 * ri && pt > 2 * ro + toothL * 0.5, `tooth ${toothL} < bore ${(2 * ri).toFixed(2)}; pitch ${pt.toFixed(3)} mm, outside Ø ${(2 * ro).toFixed(2)}`];
    }],
    ['cylinder: the wheel rests still at both ends of each swing', () => {
      const ends = [VT.A[0], VT.A[VT.A.length - 1] - VT.A[VT.A.length - 8], VT.B[VT.B.length - 1] - VT.B[VT.B.length - 8]];
      // 0.02°: the wall is a 28-sided polygon, so a tooth at rest on it
      // follows the facets by under a micron as the balance turns
      return [Math.abs(ends[1]) < 0.02 * D && Math.abs(ends[2]) < 0.02 * D, `last 8 samples move ${(ends[1] / D).toFixed(5)}°, ${(ends[2] / D).toFixed(5)}°`];
    }],
    ['layout: wheels in one z plane keep clear', () => {
      const discs = [['barrel', B, 7.45, 0.85, 2.6], ['centre', C, 4.7, 0.32, 0.58], ['fourth', F, 3.45, 0.32, 0.58],
        ['third', T, 4.3, 1.02, 1.28], ['escape', E, Rt + 0.1, 0.85, 1.65], ['balance', Bal, c.balR, 3.8, 4.15], ['cock foot', L.cockFoot, 1.9, 0, 4.95]];
      let worst = Infinity, which = '';
      for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i], b = discs[j];
        if (a[4] <= b[3] || b[4] <= a[3]) continue;
        const g = G.dist(a[1], b[1]) - a[2] - b[2];
        if (g < worst) { worst = g; which = `${a[0]} / ${b[0]}`; }
      }
      return [worst > 0.1, `smallest gap ${worst.toFixed(2)} mm (${which})`];
    }],
    ['layout: the cylinder clears the third and fourth wheels', () => {
      const g = Math.min(G.dist(Bal, T) - 4.3 - ro, G.dist(Bal, F) - 3.45 - ro);
      return [g > 0.2, `smallest gap ${g.toFixed(2)} mm`];
    }],
    ['layout: parts inside the plate', () => {
      const r = Math.max(G.len(B) + 7.45, G.len(Bal) + c.balR + 0.3, G.len(L.cockFoot) + 1.9, G.len(E) + Rt);
      return [r < c.plateR, `${r.toFixed(2)} < ${c.plateR}`];
    }],
  ],
};

// ============================================================================
//  WATCH MOVEMENT  ·  scenes/cylinder.js — the Lépine cylinder watch in 3D
// ────────────────────────────────────────────────────────────────────────────
//  build(B, cal, opts) adds the parts of calibres/cylinder.js and returns
//  pose(). opts: noDial, dialPaint, hands, hide (as the other scenes).
//
//  THE ESCAPEMENT
//    The escape wheel is a spoked rim at z escRim; each wedge tooth stands
//    on a stalk above the rim, in the tooth plane (z teeth) where the
//    collision solve runs. The cylinder turns with the balance: below the
//    top of the tooth plane it is the solved C section; above it a whole
//    tube; the balance staff runs through it.
//
//  LAYERS  (explode offset = spread * unit * k)
//    hands -3.2 · dial -2.3 · motion -1.3 · plate 0 · train 1
//    balance and cylinder 1.9 · bars 2.8 · cock 3.7
// ============================================================================
import * as G from '../geom.js';
import { circ, hole } from '../kit.js';
import { wheelArbor, barrelParts, balanceParts, motionWorks, handParts, paintRoman } from './shared.js';
const { TAU, D, pol, add, rot } = G;

export function build(B, cal, opts = {}) {
  const { CAL: c, L } = cal, Z = c.z, cy = c.cyl, Rt = c.escape.Rt;
  for (const [k, v] of Object.entries({ hands: -3.2, dial: -2.3, motion: -1.3, plate: 0, train: 1, balance: 1.9, bridges: 2.8, cock: 3.7 })) B.layer(k, v);

  // PILLAR PLATE
  const plate = B.part('plate', 'plate', [0, 0], { label: 'Pillar plate', labelAt: [-14, -8] });
  B.add(plate, B.slab(circ(c.plateR, 180), [], -c.plateT, 0, 'giltPlate', 0.06), B.ring(c.plateR - 0.5, c.plateR, -0.02, 0.05, 'gilt'));
  const jw = B.part('jewelsPlate', 'plate', [0, 0], { info: 'jewel' });
  for (const j of [L.E, L.Bal]) B.add(jw, B.jewel(j, 0.04, 0.55));

  // GOING TRAIN
  const barrel = barrelParts(B, { at: L.B, N: 72, m: 0.2, zLo: Z.barrelLo, zHi: Z.barrelHi, rDrum: 6.7, arborHi: Z.bridgeHi + 0.05 });
  wheelArbor(B, { id: 'center', at: L.C, label: 'Centre wheel', wheel: { N: 60, m: 0.15, z: Z.center, spokes: { rIn: 1.0, rim: 0.42, n: 4, w: 0.5 } }, pinion: { N: 12, m: 0.2, z: Z.barrelTeeth }, arbor: [-c.plateT, Z.bridgeHi + 0.05, 0.32] });
  wheelArbor(B, { id: 'third', at: L.T, label: 'Third wheel', wheel: { N: 64, m: 0.13, z: Z.third, spokes: { rIn: 0.85, rim: 0.38, n: 4, w: 0.42 } }, pinion: { N: 8, m: 0.15, z: Z.center }, arbor: [0, Z.bridgeHi + 0.05] });
  wheelArbor(B, { id: 'fourth', at: L.F, label: 'Fourth wheel', wheel: { N: 60, m: 0.11, z: Z.fourth, spokes: { rIn: 0.75, rim: 0.34, n: 4, w: 0.38 } }, pinion: { N: 8, m: 0.13, z: Z.third }, arbor: [Z.dialLo - 0.45, Z.bridgeHi + 0.05] });

  // ESCAPE WHEEL: spoked rim, stalks, wedge teeth in the tooth plane
  const esc = B.part('escape', 'train', L.E, { label: 'Escape wheel', labelZ: Z.teeth + 0.5 });
  const rimR = c.escape.rim;
  B.add(esc,
    B.slab(circ(rimR, 72), G.spokeWindows(0.42, rimR - 0.3, 3, 0.32).map(h => h.reverse()), Z.escRim - 0.08, Z.escRim + 0.08, 'gilt', 0.015),
    B.cyl(0.36, Z.escRim - 0.14, Z.escRim + 0.14, 'steel', 18),
    B.slab(G.pinionProfile(c.escape.p, c.fourth.m), [], Z.fourth - 0.17, Z.fourth + 0.17, 'steel', 0.01),
    B.cyl(0.18, 0, Z.bridgeHi + 0.05, 'steel', 14));
  for (let k = 0; k < c.escape.N; k++) {
    const poly = [pol(Rt - cy.toothH * 0.35, 0), pol(Rt + cy.toothH * 0.65, cy.toothL / Rt), pol(Rt - cy.toothH * 0.35, cy.toothL / Rt)].map(p => rot(p, k * TAU / c.escape.N));
    B.add(esc, B.slab(poly, [], Z.teeth - 0.1, Z.teeth + 0.1, 'gilt', 0.008));
    // the stalk: from the rim edge up and out to the heel of the tooth
    const aH = k * TAU / c.escape.N + cy.toothL / Rt * 0.82;
    B.add(esc, B.slab(G.capsule(pol(rimR - 0.18, aH), pol(Rt - 0.02, aH), 0.11), [], Z.escRim + 0.05, Z.teeth - 0.06, 'gilt', 0.01));
  }

  // CYLINDER (turns with the balance): a C below the top of the tooth
  // plane, a whole tube above, the balance staff through it
  const cyl = B.part('cylinder', 'balance', L.Bal, { label: 'Cylinder', labelZ: Z.teeth + 1.0, labelAt: add(L.Bal, [0.6, -0.6]) });
  const n = 36, a0 = L.psi - cy.wall / 2, a1 = L.psi + cy.wall / 2, cSec = [];
  for (let i = 0; i <= n; i++) cSec.push(pol(cy.ro, a0 + (a1 - a0) * i / n));
  for (let i = n; i >= 0; i--) cSec.push(pol(cy.ri, a0 + (a1 - a0) * i / n));
  B.add(cyl, B.slab(cSec, [], Z.escRim + 0.3, Z.teeth + 0.12, 'polished', 0.006),
    B.slab(circ(cy.ro, 40), [hole(cy.ri, 32)], Z.teeth + 0.12, Z.teeth + 0.75, 'polished', 0.006),
    B.cyl(cy.ro + 0.12, Z.teeth + 0.75, Z.teeth + 0.95, 'steel', 24),
    B.cyl(0.12, Z.escRim + 0.1, Z.escRim + 0.3, 'steel', 12));

  // BALANCE: a plain gilt balance and a short spiral
  const bal = balanceParts(B, { at: L.Bal, R: c.balR, z: Z.balance, hsZ: Z.hairspring, hsR: 3.4, coils: 7, screws: 0, mat: 'gilt', staff: [Z.teeth + 0.9, Z.cockLo + 0.15], studAngle: 70 * D });

  // BARS: the Lépine idea, one bar per arbor, each with its own foot
  const bars = B.part('trainBridge', 'bridges', [0, 0], { label: 'Train bars', labelZ: Z.bridgeHi, labelAt: [-8, -9] });
  const screws = B.part('screws', 'bridges', [0, 0], { lift: 0.45 });
  const fingers = [[L.C, [-7.5, -2.0], 2.3], [L.T, [-8.0, -9.0], 2.0], [L.F, [-3.0, -15.0], 2.0]];
  for (const [at, foot, w] of fingers) {
    B.add(bars, B.slab(G.capsule(foot, at, w), [], Z.bridgeLo, Z.bridgeHi, 'giltBridge', 0.06), B.slab(circ(w * 0.42, 28, foot), [], 0, Z.bridgeLo, 'gilt', 0));
    B.screw(screws, foot, Z.bridgeHi, 0.62);
  }
  const bb = B.part('barrelBridge', 'bridges', [0, 0], { label: 'Barrel bar', labelZ: Z.bridgeHi, labelAt: add(L.B, pol(8.4, 20 * D)) });
  const bf = [add(L.B, pol(8.4, 200 * D)), add(L.B, pol(8.4, 20 * D))];
  B.add(bb, B.slab(G.capsule(bf[0], bf[1], 3.6), [hole(0.62, 24, L.B)], Z.bridgeLo, Z.bridgeHi, 'giltBridge', 0.06));
  for (const f of bf) { B.add(bb, B.slab(circ(1.3, 28, f), [], 0, Z.bridgeLo, 'gilt', 0)); B.screw(screws, f, Z.bridgeHi, 0.75); }
  const ec = B.part('escCock', 'bridges', [0, 0], { label: 'Escape cock', labelZ: Z.bridgeHi, labelAt: [6.5, -15.2] });
  B.add(ec, B.slab(G.capsule([6.5, -15.2], L.E, 1.7), [], Z.bridgeLo, Z.bridgeHi, 'giltBridge', 0.05), B.slab(circ(0.8, 24, [6.5, -15.2]), [], 0, Z.bridgeLo, 'gilt', 0));
  B.screw(screws, [6.5, -15.2], Z.bridgeHi, 0.55);
  const bJ = B.part('jewelsBridges', 'bridges', [0, 0], { info: 'jewel' });
  B.add(bJ, B.jewel(L.E, Z.bridgeHi + 0.05, 0.45));
  // the barrel arbor square (a key-wound watch)
  const sq = B.part('barrelArbor', 'bridges', L.B, { info: 'barrel' });
  B.add(sq, B.slab([[-0.65, -0.65], [0.65, -0.65], [0.65, 0.65], [-0.65, 0.65]], [], Z.bridgeHi, Z.bridgeHi + 0.55, 'steel', 0.04));

  // BALANCE COCK
  const cock = B.part('cock', 'cock', [0, 0], { label: 'Balance cock', labelZ: Z.cockHi, labelAt: L.cockFoot });
  B.add(cock, B.slab(G.hullOfCircles([[L.Bal, 1.4], [L.cockFoot, 2.2]]), [hole(0.45, 20, L.Bal)], Z.cockLo, Z.cockHi, 'giltBridge', 0.08),
    B.slab(circ(1.9, 40, L.cockFoot), [], 0, Z.cockLo, 'gilt', 0),
    B.slab(circ(1.1, 40, L.Bal), [hole(0.62, 30, L.Bal)], Z.cockHi - 0.02, Z.cockHi + 0.14, 'gilt', 0.03));
  const regTip = add(L.Bal, pol(6.0, 50 * D));
  B.add(cock, B.slab(G.capsule(L.Bal, regTip, 0.32), [hole(0.75, 24, L.Bal)], Z.cockHi + 0.14, Z.cockHi + 0.24, 'steel', 0.02));
  const studAt = add(L.Bal, pol(3.4, 70 * D));
  B.add(cock, B.slab(circ(0.26, 16, studAt), [], Z.hairspring - 0.1, Z.cockLo, 'steel', 0));
  const ckJ = B.part('jewelsCock', 'cock', [0, 0], { info: 'jewel' });
  B.add(ckJ, B.jewel(L.Bal, Z.cockHi + 0.03, 0.5));
  const cockScrew = B.part('cockScrew', 'cock', [0, 0], { lift: 0.45, info: 'screws' });
  B.screw(cockScrew, L.cockFoot, Z.cockHi, 0.85);

  // MOTION WORKS, DIAL, HANDS
  motionWorks(B, { C: L.C, M: L.M, cannon: c.cannon, minute: c.minute, hour: c.hour, z: Z, dialLo: Z.dialLo, plateLo: -c.plateT, s: 1 });
  if (!opts.noDial) {
    const dial = B.part('dial', 'dial', [0, 0], { label: 'Dial', labelZ: Z.dialLo });
    const dialHoles = [hole(1.0, 24), hole(0.45, 16, L.F)];
    B.add(dial, B.slab(circ(18.85, 180), dialHoles, Z.dialLo + 0.01, Z.dialHi - 0.05, 'brass', 0.05), B.ring(18.55, 18.9, Z.dialLo - 0.02, Z.dialHi, 'gilt'),
      B.dialFace(18.9, Z.dialLo, dialHoles, opts.dialPaint || paintRoman({ sub: [-L.F[1], 3.6], line: 'ÉCHAPPEMENT À CYLINDRE', brand: 'STELLA  NOVA' })));
  }
  const hands = handParts(B, { ...{ C: L.C, dialLo: Z.dialLo, hour: ['breguet', 9.8, 0.42], minute: ['breguet', 14.8, 0.32], second: { at: L.F, len: 3.4, z: Z.dialLo - 0.3 } }, ...(opts.hands || {}) });

  const ROT = { barrel: 'barrel', barrelCover: 'barrel', barrelArbor: 'ratchet', center: 'center', third: 'third', fourth: 'fourth', escape: 'escape', balance: 'balance', cylinder: 'cylinder', cannon: 'center', minuteWheel: 'minute', hourWheel: 'hour' };
  for (const id of opts.hide || []) B.hidePart(id);

  return {
    unit: 9,
    toggles: { bridges: ['trainBridge', 'barrelBridge', 'escCock', 'screws', 'jewelsBridges', 'barrelArbor', 'cock', 'cockScrew', 'jewelsCock'], dial: ['dial', 'hourHand', 'minuteHand', 'secondHand'] },
    pose(p) {
      for (const id in ROT) if (B.parts[id]) B.parts[id].root.rotation.z = p[ROT[id]];
      hands.hour.root.rotation.z = p.hands.hour; hands.minute.root.rotation.z = p.hands.minute;
      if (hands.second) hands.second.root.rotation.z = p.hands.second;
      barrel.update(Math.max(0, Math.min(1, p.reserve / c.reserveTurns)), p.ratchet, p.barrel);
      bal.update(p.balance);
    },
  };
}

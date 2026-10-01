// ============================================================================
//  WATCH MOVEMENT  ·  scenes/tourbillon.js — the one-minute tourbillon in 3D
// ────────────────────────────────────────────────────────────────────────────
//  build(B, cal, opts) adds the parts of calibres/tourbillon.js and returns pose().
//  The cage is one part at O that turns by p.cage. Inside it, a group with
//  scale.x = -1 holds the escape wheel, the lever and the balance in the
//  canonical frame of the escapement tables (see the MIRROR note in the
//  calibre), so they take the table angles as they are.
//
//  LAYERS  (explode offset = spread * unit * k)
//    hands -3.2 · dial -2.3 · motion -1.3 · lower bridge -0.7 · plate 0
//    train 1 · cage 2.0 (with the fixed wheel) · bridges 2.9
//    tourbillon bridge 3.9
// ============================================================================
import * as THREE from 'three';
import * as G from '../geom.js';
import { circ, hole } from '../kit.js';
import { wheelArbor, barrelParts, leverParts, escapeWheel, balanceParts, motionWorks, handParts, paintRoman } from './shared.js';
const { TAU, D, pol, add } = G;
const local = (p, o) => [p[0] - o[0], p[1] - o[1]];

export function build(B, cal, opts = {}) {
  const { CAL: c, L, ESC } = cal, Z = c.z, O = L.O;
  for (const [k, v] of Object.entries({ hands: -3.2, dial: -2.3, motion: -1.3, lower: -0.7, plate: 0, train: 1, cage: 2.0, bridges: 2.9, tbridge: 3.9 })) B.layer(k, v);

  // PLATE, cut through at 6 o'clock
  const plate = B.part('plate', 'plate', [0, 0], { label: 'Main plate', labelAt: [-13.5, 4] });
  B.add(plate, B.slab(circ(c.plateR, 160), [hole(c.cageR + 0.3, 96, O)], -c.plateT, 0, 'plate', 0.06), B.ring(c.plateR - 0.6, c.plateR, -0.02, 0.04, 'satin'),
    B.ring(c.cageR + 0.3, c.cageR + 0.75, -0.02, 0.05, 'satin', O));
  const jw = B.part('jewelsPlate', 'plate', [0, 0], { info: 'jewel' });
  for (const j of [L.C, L.T]) B.add(jw, B.jewel(j, 0.04, 0.62));

  // GOING TRAIN
  const barrel = barrelParts(B, { at: L.B, N: 80, m: 0.19, zLo: Z.barrelLo, zHi: Z.barrelHi, rDrum: 7.25, arborHi: Z.bridgeHi + 0.05 });
  wheelArbor(B, { id: 'center', at: L.C, label: 'Centre wheel', wheel: { N: 80, m: 0.125, z: Z.center, spokes: { rIn: 1.05, rim: 0.45, n: 4, w: 0.5 } }, pinion: { N: 10, m: 0.19, z: Z.barrelTeeth }, arbor: [-c.plateT, Z.bridgeHi + 0.05, 0.32] });
  // the third arbor stops under the cage: its upper pivot is in a low bridge
  wheelArbor(B, { id: 'third', at: L.T, label: 'Third wheel', wheel: { N: 75, m: 0.12, z: Z.third, spokes: { rIn: 0.9, rim: 0.4, n: 4, w: 0.42 } }, pinion: { N: 10, m: 0.125, z: Z.center }, arbor: [0, 1.95] });

  // THE CAGE (turns at p.cage) and, inside it, the mirrored escapement
  const cage = B.part('cage', 'cage', O, { label: 'Tourbillon cage', labelZ: Z.cageHi + 0.4 });
  const mir = new THREE.Group(); mir.scale.x = -1; cage.root.add(mir);
  const inCage = { root: mir };
  const eA = [0, -L.rE];
  const armAngles = [90 * D, 210 * D, 330 * D];
  // lower frame: a rim, three arms, and a bar out to the escape arbor
  B.add(cage, B.ring(c.cageR - 0.45, c.cageR, Z.cageLo, Z.cageLo + 0.15, 'steel'));
  for (const a of armAngles) B.add(cage, B.slab(G.capsule([0, 0], pol(c.cageR - 0.2, a), 0.55), [], Z.cageLo, Z.cageLo + 0.15, 'steel', 0.02));
  B.add(cage, B.slab(G.capsule([0, 0], pol(c.cageR - 0.2, -90 * D), 0.9), [], Z.cageLo, Z.cageLo + 0.15, 'steel', 0.02));
  // upper frame: a hub, three arms to the pillars, and a bar over the escape
  for (const a of armAngles) {
    B.add(cage, B.slab(G.capsule([0, 0], pol(c.cageR - 0.35, a), 0.5), [], Z.cageHi, Z.cageHi + 0.15, 'steel', 0.02));
    B.add(cage, B.cyl(0.3, Z.cageLo + 0.15, Z.cageHi, 'steel', 16), B.cyl(0.42, Z.cageHi - 0.1, Z.cageHi + 0.22, 'blued', 16));
    const pil = cage.root.children[cage.root.children.length - 2], cap = cage.root.children[cage.root.children.length - 1];
    pil.position.set(...pol(c.cageR - 0.35, a), 0); cap.position.set(...pol(c.cageR - 0.35, a), 0);
  }
  B.add(cage, B.slab(G.capsule([0, 0], eA, 0.85), [], Z.cageHi, Z.cageHi + 0.15, 'steel', 0.02), B.slab(circ(1.05, 32), [hole(0.4, 16)], Z.cageHi, Z.cageHi + 0.18, 'steel', 0.03));
  // cage pinion under the cage and the lower cage arbor
  B.add(cage, B.slab(G.pinionProfile(10, 0.12), [], Z.third - 0.17, Z.third + 0.17, 'steel', 0.01), B.cyl(0.32, Z.lowHi, Z.cageLo, 'steel', 20), B.cyl(0.32, Z.cageHi, Z.tbLo, 'steel', 20));
  const cJ = B.part('jewelsCage', 'cage', O, { info: 'jewel', parent: cage });
  B.add(cJ, B.jewel([0, 0], Z.cageHi + 0.2, 0.42), B.jewel(eA, Z.cageHi + 0.2, 0.42));
  escapeWheel(B, ESC, { z: Z.escape, pinion: { N: c.escape.p, m: L.mFixed, z: Z.fixed }, arbor: [Z.cageLo, Z.fixed + 0.2], parent: inCage, label: 'Escape wheel' });
  leverParts(B, ESC, { z: Z.fork, arbor: [Z.cageLo, Z.cageHi], parent: inCage });
  const bal = balanceParts(B, { at: [0, 0], R: c.balR, z: Z.balance, zFork: Z.fork, jewelR: c.jewelR, psi: ESC.psi, hsZ: Z.hairspring, hsR: 2.5, coils: 12, staff: [Z.cageLo, Z.cageHi], studAngle: 30 * D, screws: 10, parent: inCage });

  // the fixed wheel (does not turn), hung from the tourbillon bridge
  const fw = B.part('fixedWheel', 'cage', O, { label: 'Fixed wheel', labelZ: Z.fixed + 0.5, labelAt: [O[0] - 4.6, O[1]] });
  B.add(fw, B.slab(G.wheelProfile(c.fixed.N, L.mFixed), G.spokeWindows(1.2, G.rootR(c.fixed.N, L.mFixed) - 0.35, 5, 0.42).map(h => h.reverse()), Z.fixed - 0.13, Z.fixed + 0.13, 'gilt', 0.012),
    B.ring(0.45, 1.15, Z.fixed - 0.13, Z.tbLo, 'steel'));

  // BRIDGES
  const feetBB = [pol(8.5, 200 * D), pol(8.45, 95 * D)].map(p => [L.B[0] + p[0], L.B[1] + p[1]]);
  const bb = B.part('barrelBridge', 'bridges', [0, 0], { label: 'Barrel bridge', labelZ: Z.bridgeHi });
  B.add(bb, B.slab(G.hullOfCircles([[L.B, 8.1], [L.C, 1.7], ...feetBB.map(f => [f, 1.15])]), [hole(0.62, 24, L.B)], Z.bridgeLo, Z.bridgeHi, 'rhodium', 0.06));
  for (const f of feetBB) B.add(bb, B.slab(circ(1.0, 32, f), [], 0, Z.bridgeLo, 'rhodium', 0));
  const thirdFoot = add(L.T, pol(4.0, 10 * D));
  const tb3 = B.part('thirdBridge', 'train', [0, 0], { lift: 0.45 });
  B.add(tb3, B.slab(G.hullOfCircles([[L.T, 0.9], [thirdFoot, 1.1]]), [], 1.5, 1.95, 'rhodium', 0.04), B.slab(circ(0.95, 24, thirdFoot), [], 0, 1.5, 'rhodium', 0));
  const bJ = B.part('jewelsBB', 'bridges', [0, 0], { info: 'jewel' });
  B.add(bJ, B.jewel(L.C, Z.bridgeHi));

  // tourbillon bridge: two arms from the feet to the cage pivot
  const tbr = B.part('tbridge', 'tbridge', [0, 0], { label: 'Tourbillon bridge', labelZ: Z.tbHi, labelAt: L.tbFeet[1] });
  for (const f of L.tbFeet) B.add(tbr, B.slab(G.capsule(f, O, 1.5), [], Z.tbLo, Z.tbHi, 'steel', 0.08), B.slab(circ(1.05, 32, f), [], 0, Z.tbLo, 'steel', 0));
  B.add(tbr, B.slab(circ(1.75, 40, O), [hole(0.5, 20, O)], Z.tbLo, Z.tbHi + 0.05, 'steel', 0.08), B.ring(1.2, 1.75, Z.tbHi + 0.04, Z.tbHi + 0.16, 'gilt', O));
  const tJ = B.part('jewelsTB', 'tbridge', [0, 0], { info: 'jewel' });
  B.add(tJ, B.jewel(O, Z.tbHi + 0.12, 0.6));

  // lower bridge across the aperture on the dial side
  const lb = B.part('lowerBridge', 'lower', [0, 0], { label: 'Lower bridge', labelZ: Z.lowLo, labelAt: add(O, pol(5, 30 * D)) });
  const lbEnds = [add(O, pol(c.cageR + 1.0, 30 * D)), add(O, pol(c.cageR + 1.0, 210 * D))];
  B.add(lb, B.slab(G.capsule(lbEnds[0], lbEnds[1], 1.3), [], Z.lowLo, Z.lowHi, 'steel', 0.05), B.slab(circ(1.2, 32, O), [], Z.lowLo - 0.05, Z.lowHi, 'steel', 0.05));
  B.add(lb, B.jewel(O, Z.lowLo - 0.08, 0.6));

  // keyless works, as in the lever calibre
  const rat = B.part('ratchet', 'bridges', L.B, { label: 'Ratchet', labelZ: Z.ratchet + 0.4 });
  B.add(rat, B.slab(G.wheelProfile(50, 0.16), [], Z.ratchet - 0.17, Z.ratchet + 0.17, 'satin', 0.02));
  const crw = B.part('crownWheel', 'bridges', L.CW, { label: 'Crown wheel', labelZ: Z.ratchet + 0.4 });
  B.add(crw, B.slab(G.wheelProfile(24, 0.16), [], Z.ratchet - 0.17, Z.ratchet + 0.17, 'satin', 0.02));
  const clk = B.part('click', 'bridges', L.click, {});
  const tip = local([L.B[0] + Math.cos(246 * D) * 4.02, L.B[1] + Math.sin(246 * D) * 4.02], L.click);
  B.add(clk, B.slab(G.capsule([0, 0], tip, 0.55), [], Z.ratchet - 0.15, Z.ratchet + 0.1, 'steel', 0.02), B.slab(circ(0.55, 20), [], Z.ratchet + 0.1, Z.ratchet + 0.32, 'blued', 0.03));
  const zStem = Z.ratchet + 0.17 + G.pitchR(0.16, 16) - 0.12, yPin = L.CW[1] + G.pitchR(0.16, 24);
  const stem = B.part('stem', 'bridges', [0, 0], { slide: [0, 7], label: 'Crown', labelZ: zStem + 2.6, labelAt: [0, 21] });
  const spin = new THREE.Group(); spin.position.set(0, 0, zStem); stem.root.add(spin);
  const along = (m, y0) => { m.geometry.rotateX(-Math.PI / 2); m.geometry.translate(0, y0, 0); return m; };
  const rod = B.cyl(0.42, 0, 19.8 - (yPin + 0.25), 'steel', 20);
  rod.geometry.rotateX(-Math.PI / 2); rod.geometry.translate(0, yPin + 0.25, 0);
  for (const m of [along(B.slab(G.pinionProfile(16, 0.16), [], 0, 0.5, 'steel', 0.01), yPin - 0.25), rod,
    along(B.slab(G.gearProfile(36, 0.13, { t: 0.5, ha: 0.6, hf: 0.6, seg: 3 }), [], 0, 2.5, 'brass', 0.04), 19.8)]) { B.add(stem, m); spin.add(m); }

  // SCREWS
  const screws = B.part('screws', 'bridges', [0, 0], { lift: 0.45 });
  for (const f of feetBB) B.screw(screws, f, Z.bridgeHi);
  B.screw(screws, L.B, Z.ratchet + 0.17, 1.1);
  B.screw(screws, L.CW, Z.ratchet + 0.17, 0.75);
  const tScrews = B.part('tScrews', 'tbridge', [0, 0], { lift: 0.45, info: 'screws' });
  for (const f of L.tbFeet) B.screw(tScrews, f, Z.tbHi, 0.75);
  const s3 = B.part('screw3', 'train', [0, 0], { lift: 0.9, info: 'screws' });
  B.screw(s3, thirdFoot, 1.95, 0.6);

  // MOTION WORKS, DIAL WITH APERTURE, HANDS
  motionWorks(B, { C: L.C, M: L.M, cannon: c.cannon, minute: c.minute, hour: c.hour, z: Z, dialLo: Z.dialLo, plateLo: -c.plateT, s: 1 });
  if (!opts.noDial) {
    const dial = B.part('dial', 'dial', [0, 0], { label: 'Dial', labelZ: Z.dialLo });
    const dialHoles = [hole(1.0, 24), hole(c.cageR + 0.15, 96, O)];
    B.add(dial, B.slab(circ(18.6, 180), dialHoles, Z.dialLo + 0.01, Z.dialHi, 'brass', 0.05), B.ring(18.25, 18.6, Z.dialLo - 0.02, Z.dialHi, 'gilt'),
      B.ring(c.cageR + 0.15, c.cageR + 0.55, Z.dialLo - 0.08, Z.dialHi, 'gilt', O),
      B.dialFace(18.6, Z.dialLo, dialHoles, opts.dialPaint || paintRoman({ aperture: [-O[1], c.cageR + 0.15], line: 'TOURBILLON  ·  18 000 A/h' })));
  }
  const hands = handParts(B, { ...{ C: L.C, dialLo: Z.dialLo, hour: ['breguet', 9.6, 0.42], minute: ['breguet', 14.6, 0.32], second: { at: O, len: 5.6, z: Z.dialLo - 0.3, w: 0.22 } }, ...(opts.hands || {}) });

  const ROT = { barrel: 'barrel', barrelCover: 'barrel', barrelArbor: 'ratchet', center: 'center', third: 'third', cage: 'cage', escape: 'escape', pallet: 'fork', balance: 'balance', ratchet: 'ratchet', crownWheel: 'crown', cannon: 'center', minuteWheel: 'minute', hourWheel: 'hour' };
  for (const id of opts.hide || []) B.hidePart(id);

  return {
    unit: 9, focusK: 2.0,
    toggles: { bridges: ['barrelBridge', 'screws', 'ratchet', 'crownWheel', 'click', 'jewelsBB', 'tbridge', 'tScrews', 'jewelsTB'], dial: ['dial', 'hourHand', 'minuteHand', 'secondHand'] },
    pose(p) {
      for (const id in ROT) B.parts[id].root.rotation.z = p[ROT[id]];
      hands.hour.root.rotation.z = p.hands.hour; hands.minute.root.rotation.z = p.hands.minute; if (hands.second) hands.second.root.rotation.z = p.hands.second;
      spin.rotation.y = p.stem;
      barrel.update(Math.max(0, Math.min(1, p.reserve / c.reserveTurns)), p.ratchet, p.barrel);
      bal.update(p.balance);
    },
  };
}

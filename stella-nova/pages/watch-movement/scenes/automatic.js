// ============================================================================
//  WATCH MOVEMENT  ·  scenes/automatic.js — the self-winding wristwatch in 3D
// ────────────────────────────────────────────────────────────────────────────
//  build(B, cal) adds the parts of calibres/automatic.js and returns pose().
//  The rotor's heavy side points along its local +x; its part turns by
//  p.rotor, which the calibre swings like a pendulum toward the wrist's
//  "down" (-y in this upright view, so it hangs the way gravity would).
//
//  LAYERS  (explode offset = spread * unit * k)
//    hands -3.0 · dial -2.2 · motion -1.2 · plate 0 · train 1 · balance 1.8
//    bridges 2.6 · automatic bridge and winding train 3.6 · rotor 4.7
// ============================================================================
import * as THREE from 'three';
import * as G from '../geom.js';
import { circ, hole } from '../kit.js';
import { wheelArbor, barrelParts, leverParts, escapeWheel, balanceParts, motionWorks, handParts, paintBaton } from './shared.js';
const { TAU, D, pol, add } = G;

export function build(B, cal) {
  const { CAL: c, L, ESC } = cal, Z = c.z;
  for (const [k, v] of Object.entries({ hands: -3.0, dial: -2.2, motion: -1.2, plate: 0, train: 1, balance: 1.8, bridges: 2.6, auto: 3.6, rotor: 4.7 })) B.layer(k, v);

  // PLATE
  const plate = B.part('plate', 'plate', [0, 0], { label: 'Main plate', labelAt: [8.5, -8] });
  B.add(plate, B.slab(circ(c.plateR, 140), [], -c.plateT, 0, 'plate', 0.05), B.ring(c.plateR - 0.45, c.plateR, -0.02, 0.04, 'satin'));
  const jw = B.part('jewelsPlate', 'plate', [0, 0], { info: 'jewel' });
  for (const j of [L.C, L.T, L.F, L.E, L.P, L.Bal]) B.add(jw, B.jewel(j, 0.04, 0.45));

  // GOING TRAIN
  const barrel = barrelParts(B, { at: L.B, N: 80, m: 0.13, zLo: Z.barrelLo, zHi: Z.barrelHi, rDrum: 4.85, arborHi: Z.ratchet + 0.2 });
  wheelArbor(B, { id: 'center', at: L.C, label: 'Centre wheel', wheel: { N: 80, m: 0.09, z: Z.center, t: 0.22, spokes: { rIn: 0.75, rim: 0.3, n: 4, w: 0.35 } }, pinion: { N: 10, m: 0.13, z: Z.barrelTeeth, t: 0.28 }, arbor: [-c.plateT, Z.trainHi, 0.26] });
  wheelArbor(B, { id: 'third', at: L.T, label: 'Third wheel', wheel: { N: 75, m: c.third.m, z: Z.third, t: 0.22, spokes: { rIn: 0.7, rim: 0.28, n: 4, w: 0.32 } }, pinion: { N: 10, m: 0.09, z: Z.center, t: 0.26 }, arbor: [0, Z.trainHi, 0.16] });
  wheelArbor(B, { id: 'fourth', at: L.F, label: 'Fourth wheel', wheel: { N: 84, m: 0.075, z: Z.fourth, t: 0.2, spokes: { rIn: 0.6, rim: 0.25, n: 4, w: 0.28 } }, pinion: { N: 10, m: c.third.m, z: Z.third, t: 0.26 }, arbor: [0, Z.trainHi, 0.15] });
  const sp = B.part('secp', 'train', L.C, { label: 'Seconds pinion', labelZ: Z.third + 0.6, labelAt: [0.8, -0.6] });
  B.add(sp, B.slab(G.pinionProfile(10, c.third.m), [], Z.third - 0.13, Z.third + 0.13, 'steel', 0.01), B.cyl(0.11, Z.dialLo - 0.9, Z.third + 0.3, 'steel', 12));
  escapeWheel(B, ESC, { z: Z.escape, pinion: { N: c.escape.p, m: 0.075, z: Z.fourth }, arbor: [0, Z.trainHi] });
  leverParts(B, ESC, { z: Z.fork, arbor: [0, Z.trainHi - 0.1] });

  // BALANCE: smooth rim, no screws
  const bal = balanceParts(B, { at: L.Bal, R: c.balR, z: Z.balance, zFork: Z.fork, jewelR: c.jewelR, psi: L.psi, hsZ: Z.hairspring, hsR: 3.3, coils: 13, staff: [0.3, Z.cockLo + 0.1], screws: 0, studAngle: 120 * D });

  // BRIDGES
  const feetBB = [add(L.B, pol(5.9, 160 * D)), add(L.B, pol(5.9, 40 * D))];
  const bb = B.part('barrelBridge', 'bridges', [0, 0], { label: 'Barrel bridge', labelZ: Z.bridgeHi, labelAt: feetBB[0] });
  B.add(bb, B.slab(G.hullOfCircles([[L.B, 5.5], [L.C, 1.3], ...feetBB.map(f => [f, 0.95])]), [hole(0.45, 20, L.B)], Z.bridgeLo, Z.bridgeHi, 'rhodium', 0.05));
  for (const f of feetBB) B.add(bb, B.slab(circ(0.8, 24, f), [], 0, Z.bridgeLo, 'rhodium', 0));
  const feetTB = [[7.5, -6.2], [-1.5, -10.5]];
  const tb = B.part('trainBridge', 'bridges', [0, 0], { label: 'Train bridge', labelZ: Z.trainHi, labelAt: feetTB[0] });
  B.add(tb, B.slab(G.hullOfCircles([[L.T, 1.1], [L.F, 1.1], [L.E, 0.9], ...feetTB.map(f => [f, 1.0])]), [], Z.trainLo, Z.trainHi, 'rhodium', 0.05));
  for (const f of feetTB) B.add(tb, B.slab(circ(0.8, 24, f), [], 0, Z.trainLo, 'rhodium', 0));
  const bJ = B.part('jewelsBridges', 'bridges', [0, 0], { info: 'jewel' });
  for (const j of [L.T, L.F, L.E]) B.add(bJ, B.jewel(j, Z.trainHi + 0.04, 0.42));
  B.add(bJ, B.jewel(L.C, Z.bridgeHi + 0.04, 0.45));
  const rat = B.part('ratchet', 'bridges', L.B, { label: 'Ratchet', labelZ: Z.ratchet + 0.3 });
  B.add(rat, B.slab(G.wheelProfile(46, 0.13), [hole(0.4, 16)], Z.ratchet - 0.12, Z.ratchet + 0.12, 'satin', 0.015));
  const cock = B.part('cock', 'bridges', [0, 0], { label: 'Balance cock', labelZ: Z.cockHi, labelAt: L.cockFoot });
  B.add(cock, B.slab(G.hullOfCircles([[L.Bal, 1.0], [L.cockFoot, 1.5]]), [hole(0.35, 16, L.Bal)], Z.cockLo, Z.cockHi, 'rhodium', 0.06),
    B.slab(circ(1.3, 32, L.cockFoot), [], 0, Z.cockLo, 'rhodium', 0));
  B.add(bJ, B.jewel(L.Bal, Z.cockHi + 0.04, 0.42));

  // AUTOMATIC BRIDGE and the winding train
  const ab = B.part('autoBridge', 'auto', [0, 0], { label: 'Automatic bridge', labelZ: Z.autoHi, labelAt: add(L.RED, pol(3.4, 30 * D)) });
  B.add(ab, B.slab(G.hullOfCircles([[L.C, 3.0], [L.RED, 4.3], [L.RV1, 2.1], [L.RV2, 2.1]]), [hole(0.35, 16, L.RED), hole(0.3, 16, L.RV1), hole(0.3, 16, L.RV2), hole(0.6, 20)], Z.autoLo, Z.autoHi, 'rhodium', 0.05));
  const posts = [add(L.RED, pol(3.6, 90 * D)), add(L.C, pol(2.6, -90 * D))];
  for (const f of posts) B.add(ab, B.cyl(0.55, Z.bridgeHi, Z.autoLo, 'rhodium', 18).translateX(f[0]).translateY(f[1]));
  const red = B.part('reduction', 'auto', L.RED, { label: 'Reduction wheel', labelZ: c.z.red + 0.4 });
  B.add(red, B.slab(G.wheelProfile(54, 0.14), G.spokeWindows(0.8, G.rootR(54, 0.14) - 0.3, 5, 0.38).map(h => h.reverse()), Z.red - 0.11, Z.red + 0.11, 'gilt', 0.015),
    B.slab(G.pinionProfile(10, 0.13), [], Z.ratchet - 0.12, Z.ratchet + 0.12, 'steel', 0.01), B.cyl(0.16, Z.ratchet - 0.15, Z.red + 0.2, 'steel', 12));
  const revW = [], revP = [];
  for (const [i, at] of [[1, L.RV1], [2, L.RV2]]) {
    const w = B.part(`rev${i}Wheel`, 'auto', at, { label: i === 1 ? 'Reversing wheels' : null, labelZ: Z.rev + 0.4, info: 'reverser' });
    B.add(w, B.slab(G.wheelProfile(30, 0.12), [hole(0.5, 16)], Z.rev - 0.11, Z.rev + 0.11, 'gilt', 0.015), B.ring(0.2, 0.5, Z.rev - 0.2, Z.rev + 0.12, 'blued'));
    const p = B.part(`rev${i}Pin`, 'auto', at, { info: 'reverser' });
    B.add(p, B.slab(G.pinionProfile(10, 0.14), [], Z.revP - 0.11, Z.revP + 0.11, 'steel', 0.01), B.cyl(0.18, Z.autoHi, Z.rev + 0.15, 'steel', 12));
    revW.push(w); revP.push(p);
  }

  // ROTOR on its ball bearing
  const hub = B.part('rotorHub', 'rotor', L.C, { info: 'rotor' });
  B.add(hub, B.slab(G.pinionProfile(12, 0.12), [], Z.rotorPin - 0.12, Z.rotorPin + 0.12, 'steel', 0.01),
    B.ring(1.25, 2.05, Z.rotorPin + 0.12, Z.rotorLo, 'steel'), B.ring(0.35, 1.05, Z.rotorPin + 0.12, Z.rotorLo, 'steel'));
  const ball = new THREE.SphereGeometry(0.27, 14, 10);
  for (let k = 0; k < 5; k++) { const m = B.mesh(ball, 'steel'); m.position.set(...pol(1.15, k / 5 * TAU), Z.rotorLo - 0.2); m.scale.setScalar(1); B.add(hub, m); }
  const rotor = B.part('rotor', 'rotor', L.C, { label: 'Rotor', labelZ: Z.rimHi, labelAt: [0, -11] });
  const sector = (r0, r1, a0, a1, n = 60) => {
    const out = [];
    for (let i = 0; i <= n; i++) out.push(pol(r1, a0 + (a1 - a0) * i / n));
    for (let i = n; i >= 0; i--) out.push(pol(r0, a0 + (a1 - a0) * i / n));
    return out;
  };
  B.add(rotor, B.slab(sector(2.0, c.plateR - 1.6, -96 * D, 96 * D), [], Z.rotorLo, Z.rotorHi, 'rhodium', 0.04),
    B.slab(sector(c.plateR - 1.75, c.plateR - 0.35, -98 * D, 98 * D, 80), [], Z.rimLo, Z.rimHi, 'gold', 0.08),
    B.ring(0.4, 2.15, Z.rotorLo, Z.rotorHi + 0.1, 'gold'));
  for (const a of [-40 * D, 40 * D]) B.add(rotor, B.slab(circ(1.3, 32, pol(6.8, a)), [hole(0.85, 32, pol(6.8, a))], Z.rotorHi, Z.rotorHi + 0.05, 'gold', 0));

  // STEM AND CROWN at 3 o'clock on the dial. The dial is seen from -z, so
  // its 3 o'clock is at -x here. The stem slides out with the explode.
  const stem = B.part('stem', 'plate', [0, 0], { slide: [-6, 0], label: 'Crown', labelZ: 1.2, labelAt: [-16, 0] });
  const rod = B.cyl(0.32, 0, 4.4, 'steel', 16); rod.geometry.rotateY(Math.PI / 2); rod.geometry.translate(-(c.plateR + 1.4), 0, -0.65);
  const crownM = B.slab(G.gearProfile(30, 0.16, { t: 0.5, ha: 0.6, hf: 0.6, seg: 3 }), [], 0, 1.6, 'gold', 0.04);
  crownM.geometry.rotateY(Math.PI / 2); crownM.geometry.translate(-(c.plateR + 2.9), 0, -0.65);
  B.add(stem, rod, crownM);

  // SCREWS
  const screws = B.part('screws', 'bridges', [0, 0], { lift: 0.45 });
  for (const f of feetBB) B.screw(screws, f, Z.bridgeHi, 0.48);
  for (const f of feetTB) B.screw(screws, f, Z.trainHi, 0.48);
  B.screw(screws, L.cockFoot, Z.cockHi, 0.65);
  B.screw(screws, L.B, Z.ratchet + 0.12, 0.8);
  const aScrews = B.part('aScrews', 'auto', [0, 0], { lift: 0.45, info: 'screws' });
  for (const f of posts) B.screw(aScrews, f, Z.autoHi, 0.48);

  // MOTION WORKS, DIAL, HANDS
  motionWorks(B, { C: L.C, M: L.M, cannon: c.cannon, minute: c.minute, hour: c.hour, z: Z, dialLo: Z.dialLo, plateLo: -c.plateT, s: 0.7 });
  const dial = B.part('dial', 'dial', [0, 0], { label: 'Dial', labelZ: Z.dialLo });
  const dialHoles = [hole(0.7, 24)];
  B.add(dial, B.slab(circ(12.9, 160), dialHoles, Z.dialLo + 0.01, Z.dialHi, 'brass', 0.04),
    B.dialFace(12.9, Z.dialLo, dialHoles, paintBaton({ line: 'AUTOMATIC', line2: '28 800 A/h  ·  25 JEWELS' })));
  const hands = handParts(B, { C: L.C, dialLo: Z.dialLo, hour: ['dauphine', 6.4, 0.55], minute: ['dauphine', 10.2, 0.45], mat: 'steel', hubR: 0.6,
    second: { at: L.C, len: 11.2, z: Z.dialLo - 0.85, w: 0.16, hub: 0.32, mat: 'gold' } });

  const ROT = { barrel: 'barrel', barrelCover: 'barrel', barrelArbor: 'ratchet', center: 'center', third: 'third', fourth: 'fourth', secp: 'secp', escape: 'escape', pallet: 'fork', balance: 'balance', ratchet: 'ratchet', reduction: 'red', rev1Wheel: 'rev1', rev2Wheel: 'rev2', rev1Pin: 'revP1', rev2Pin: 'revP2', rotor: 'rotor', rotorHub: 'rotor', cannon: 'center', minuteWheel: 'minute', hourWheel: 'hour' };
  return {
    unit: 6.5,
    toggles: { bridges: ['barrelBridge', 'trainBridge', 'cock', 'ratchet', 'jewelsBridges', 'screws', 'autoBridge', 'reduction', 'rev1Wheel', 'rev2Wheel', 'rev1Pin', 'rev2Pin', 'rotorHub', 'rotor', 'aScrews'], dial: ['dial', 'hourHand', 'minuteHand', 'secondHand'] },
    pose(p) {
      for (const id in ROT) B.parts[id].root.rotation.z = p[ROT[id]];
      hands.hour.root.rotation.z = p.hands.hour; hands.minute.root.rotation.z = p.hands.minute; hands.second.root.rotation.z = p.hands.second;
      barrel.update(Math.max(0, Math.min(1, p.reserve / c.reserveTurns)), p.ratchet, p.barrel);
      bal.update(p.balance);
    },
  };
}

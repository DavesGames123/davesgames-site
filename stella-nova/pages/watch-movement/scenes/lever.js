// ============================================================================
//  WATCH MOVEMENT  ·  scenes/lever.js — the Swiss lever pocket watch in 3D
// ────────────────────────────────────────────────────────────────────────────
//  build(B, cal, opts) adds every part of calibres/lever.js to the builder and
//  returns pose(p), which sets each part from the pose of the running watch.
//
//  LAYERS  (explode offset = spread * unit * k)
//    hands -3.2 · dial -2.3 · motion works -1.3 · plate 0 · train 1
//    balance 1.9 · bridges 2.8 · balance cock 3.7
//  The pallet lever stays in the train layer, so it still works the escape
//  wheel when the movement is apart.
// ============================================================================
import * as THREE from 'three';
import * as G from '../geom.js';
import { circ, hole, bevelFor } from '../kit.js';
import { wheelArbor, barrelParts, leverParts, escapeWheel, balanceParts, motionWorks, handParts, paintRoman } from './shared.js';
const { TAU, D, pol } = G;
const local = (p, o) => [p[0] - o[0], p[1] - o[1]];

export function build(B, cal, opts = {}) {
  const { CAL: c, L, ESC } = cal, Z = c.z;
  for (const [k, v] of Object.entries({ hands: -3.2, dial: -2.3, motion: -1.3, plate: 0, train: 1, balance: 1.9, bridges: 2.8, cock: 3.7 })) B.layer(k, v);

  // PLATE
  const plate = B.part('plate', 'plate', [0, 0], { label: 'Main plate', labelAt: [-13.5, -10] });
  B.add(plate, B.slab(circ(c.plateR, 160), [], -c.plateT, 0, 'plate', 0.06), B.ring(c.plateR - 0.6, c.plateR, -0.02, 0.04, 'satin'));
  const jw = B.part('jewelsPlate', 'plate', [0, 0], { info: 'jewel' });
  for (const j of [L.C, L.T, L.F, L.E, L.P, L.Bal]) B.add(jw, B.jewel(j, 0.04, 0.62));

  // GOING TRAIN
  const barrel = barrelParts(B, { at: L.B, N: c.barrel.N, m: c.barrel.m, zLo: Z.barrelLo, zHi: Z.barrelHi, rDrum: 7.25, arborHi: Z.bridgeHi + 0.05 });
  wheelArbor(B, { id: 'center', at: L.C, label: 'Centre wheel', wheel: { N: 80, m: 0.125, z: Z.center, spokes: { rIn: 1.05, rim: 0.45, n: 4, w: 0.5 } }, pinion: { N: 10, m: 0.19, z: Z.barrelTeeth }, arbor: [-c.plateT, Z.bridgeHi + 0.05, 0.32] });
  wheelArbor(B, { id: 'third', at: L.T, label: 'Third wheel', wheel: { N: 75, m: 0.12, z: Z.third, spokes: { rIn: 0.9, rim: 0.4, n: 4, w: 0.42 } }, pinion: { N: 10, m: 0.125, z: Z.center }, arbor: [0, Z.bridgeHi + 0.05] });
  wheelArbor(B, { id: 'fourth', at: L.F, label: 'Fourth wheel', wheel: { N: 80, m: 0.10, z: Z.fourth, spokes: { rIn: 0.8, rim: 0.38, n: 4, w: 0.4 } }, pinion: { N: 10, m: 0.12, z: Z.third }, arbor: [Z.dialLo - 0.45, Z.bridgeHi + 0.05] });
  escapeWheel(B, ESC, { z: Z.escape, pinion: { N: 8, m: 0.10, z: Z.fourth }, arbor: [0, Z.bridgeHi + 0.05] });
  leverParts(B, ESC, { z: Z.fork, arbor: [0, Z.palletCockHi + 0.05] });

  // BALANCE
  const bal = balanceParts(B, { at: L.Bal, R: c.balR, z: Z.balance, zFork: Z.fork, jewelR: c.jewelR, psi: L.psi, hsZ: Z.hairspring, staff: [0.35, Z.cockLo + 0.15] });

  // BRIDGES
  const feetBB = [pol(8.5, 200 * D), pol(8.45, 95 * D)].map(p => [L.B[0] + p[0], L.B[1] + p[1]]);
  const bb = B.part('barrelBridge', 'bridges', [0, 0], { label: 'Barrel bridge', labelZ: Z.bridgeHi });
  B.add(bb, B.slab(G.hullOfCircles([[L.B, 8.1], [L.C, 1.7], ...feetBB.map(f => [f, 1.15])]), [hole(0.62, 24, L.B)], Z.bridgeLo, Z.bridgeHi, 'rhodium', 0.06));
  for (const f of feetBB) B.add(bb, B.slab(circ(1.0, 32, f), [], 0, Z.bridgeLo, 'rhodium', 0));
  const bbJ = B.part('jewelsBB', 'bridges', [0, 0], { info: 'jewel' });
  B.add(bbJ, B.jewel(L.C, Z.bridgeHi));

  const feetTB = [[-6.0, -10.4], [1.0, -15.8]];
  const tb = B.part('trainBridge', 'bridges', [0, 0], { label: 'Train bridge', labelZ: Z.bridgeHi });
  B.add(tb, B.slab(G.hullOfCircles([[L.T, 1.7], [L.F, 1.8], [L.E, 1.3], ...feetTB.map(f => [f, 1.35])]), [], Z.bridgeLo, Z.bridgeHi, 'rhodium', 0.06));
  for (const f of feetTB) B.add(tb, B.slab(circ(1.05, 32, f), [], 0, Z.bridgeLo, 'rhodium', 0));
  const tbJ = B.part('jewelsTB', 'bridges', [0, 0], { info: 'jewel' });
  for (const j of [L.T, L.F, L.E]) { B.add(tb, B.slab(circ(0.95, 32, j), [], Z.bridgeHi - 0.02, Z.bridgeHi + 0.06, 'gilt', 0.02)); B.add(tbJ, B.jewel(j, Z.bridgeHi + 0.08)); }

  const pc = B.part('palletCock', 'bridges', [0, 0], {});
  B.add(pc, B.slab(G.hullOfCircles([[L.P, 0.95], [L.palletFoot, 0.95]]), [], Z.bridgeLo, Z.palletCockHi, 'rhodium', 0.05), B.slab(circ(0.8, 24, L.palletFoot), [], 0, Z.bridgeLo, 'rhodium', 0));
  B.add(tbJ, B.jewel(L.P, Z.palletCockHi + 0.02, 0.5));

  // keyless works on the barrel bridge
  const rat = B.part('ratchet', 'bridges', L.B, { label: 'Ratchet', labelZ: Z.ratchet + 0.4 });
  B.add(rat, B.slab(G.wheelProfile(50, 0.16), [], Z.ratchet - 0.17, Z.ratchet + 0.17, 'satin', 0.02));
  const crw = B.part('crownWheel', 'bridges', L.CW, { label: 'Crown wheel', labelZ: Z.ratchet + 0.4 });
  B.add(crw, B.slab(G.wheelProfile(24, 0.16), [], Z.ratchet - 0.17, Z.ratchet + 0.17, 'satin', 0.02));
  const clk = B.part('click', 'bridges', L.click, {});
  const tip = local([L.B[0] + Math.cos(246 * D) * 4.02, L.B[1] + Math.sin(246 * D) * 4.02], L.click);
  B.add(clk, B.slab(G.capsule([0, 0], tip, 0.55), [], Z.ratchet - 0.15, Z.ratchet + 0.1, 'steel', 0.02), B.slab(circ(0.55, 20), [], Z.ratchet + 0.1, Z.ratchet + 0.32, 'blued', 0.03));
  const cs = B.part('clickSpring', 'bridges', L.click, { info: 'click' });
  const arc = []; for (let i = 0; i <= 24; i++) { const a = (150 + i * 3.6) * D; arc.push([Math.cos(a) * 2.1 + 1.0, Math.sin(a) * 2.1 + 1.6]); }
  const arcIn = arc.map(([x, y]) => { const dx = x - 1.0, dy = y - 1.6, l = Math.hypot(dx, dy); return [1.0 + dx * (l - 0.14) / l, 1.6 + dy * (l - 0.14) / l]; }).reverse();
  B.add(cs, B.slab(arc.concat(arcIn), [], Z.ratchet - 0.12, Z.ratchet + 0.04, 'steel', 0));

  // stem, winding pinion and crown; the stem slides out of the pendant
  const zStem = Z.ratchet + 0.17 + G.pitchR(c.winding.m, c.winding.N) - 0.12;
  const yPin = L.CW[1] + G.pitchR(c.crown.m, c.crown.N);
  const stem = B.part('stem', 'bridges', [0, 0], { slide: [0, 7], label: 'Crown', labelZ: zStem + 2.6, labelAt: [0, 21] });
  const spin = new THREE.Group(); spin.position.set(0, 0, zStem); stem.root.add(spin);
  const along = (m, y0) => { m.geometry.rotateX(-Math.PI / 2); m.geometry.translate(0, y0, 0); return m; };
  const rod = B.cyl(0.42, 0, 19.8 - (yPin + 0.25), 'steel', 20);
  rod.geometry.rotateX(-Math.PI / 2); rod.geometry.translate(0, yPin + 0.25, 0);
  for (const m of [along(B.slab(G.pinionProfile(16, 0.16), [], 0, 0.5, 'steel', 0.01), yPin - 0.25), rod,
    along(B.slab(G.gearProfile(36, 0.13, { t: 0.5, ha: 0.6, hf: 0.6, seg: 3 }), [], 0, 2.5, 'brass', 0.04), 19.8)]) {
    B.add(stem, m); spin.add(m);                  // B.add sets the material, then the mesh moves into spin
  }

  // BALANCE COCK
  const cock = B.part('cock', 'cock', [0, 0], { label: 'Balance cock', labelZ: Z.cockHi });
  B.add(cock, B.slab(G.hullOfCircles([[L.Bal, 1.35], [L.cockFoot, 2.25]]), [hole(0.5, 20, L.Bal)], Z.cockLo, Z.cockHi, 'rhodium', 0.08),
    B.slab(circ(1.95, 40, L.cockFoot), [], 0, Z.cockLo, 'rhodium', 0),
    B.slab(circ(1.05, 40, L.Bal), [hole(0.62, 30, L.Bal)], Z.cockHi - 0.02, Z.cockHi + 0.14, 'gilt', 0.03));
  const regTip = [L.Bal[0] + Math.cos(52 * D) * 6.3, L.Bal[1] + Math.sin(52 * D) * 6.3];
  B.add(cock, B.slab(G.capsule(L.Bal, regTip, 0.32), [hole(0.75, 24, L.Bal)], Z.cockHi + 0.14, Z.cockHi + 0.24, 'steel', 0.02));
  const studAt = [L.Bal[0] + Math.cos(60 * D) * 3.75, L.Bal[1] + Math.sin(60 * D) * 3.75];
  B.add(cock, B.slab(circ(0.28, 16, studAt), [], Z.hairspring - 0.12, Z.cockLo, 'steel', 0));
  const ckJ = B.part('jewelsCock', 'cock', [0, 0], { info: 'jewel' });
  B.add(ckJ, B.jewel(L.Bal, Z.cockHi + 0.03));

  // SCREWS, lifted above their bridges in the explode
  const screws = B.part('screws', 'bridges', [0, 0], { lift: 0.45 });
  for (const f of feetBB) B.screw(screws, f, Z.bridgeHi);
  B.screw(screws, [L.B[0] + Math.cos(300 * D) * 6.0, L.B[1] + Math.sin(300 * D) * 6.0], Z.bridgeHi);
  for (const f of feetTB) B.screw(screws, f, Z.bridgeHi);
  B.screw(screws, L.palletFoot, Z.palletCockHi, 0.5);
  B.screw(screws, L.B, Z.ratchet + 0.17, 1.1);
  B.screw(screws, L.CW, Z.ratchet + 0.17, 0.75);
  const cockScrew = B.part('cockScrew', 'cock', [0, 0], { lift: 0.45, info: 'screws' });
  B.screw(cockScrew, L.cockFoot, Z.cockHi, 0.9);

  // MOTION WORKS, DIAL, HANDS
  motionWorks(B, { C: L.C, M: L.M, cannon: c.cannon, minute: c.minute, hour: c.hour, z: Z, dialLo: Z.dialLo, plateLo: -c.plateT, s: 1 });
  if (!opts.noDial) {
    const dial = B.part('dial', 'dial', [0, 0], { label: 'Dial', labelZ: Z.dialLo });
    const dialHoles = [hole(1.0, 24), hole(0.45, 16, L.F)];
    B.add(dial, B.slab(circ(18.6, 180), dialHoles, Z.dialLo + 0.01, Z.dialHi, 'brass', 0.05), B.ring(18.25, 18.6, Z.dialLo - 0.02, Z.dialHi, 'gilt'),
      B.dialFace(18.6, Z.dialLo, dialHoles, opts.dialPaint || paintRoman({ sub: [10.25, 3.95], line: 'LEVER  ·  18 000 A/h' })));
  }
  const hands = handParts(B, { ...{ C: L.C, dialLo: Z.dialLo, hour: ['breguet', 9.6, 0.42], minute: ['breguet', 14.6, 0.32], second: { at: L.F, len: 3.7, z: Z.dialLo - 0.3 } }, ...(opts.hands || {}) });

  const ROT = { barrel: 'barrel', barrelCover: 'barrel', barrelArbor: 'ratchet', center: 'center', third: 'third', fourth: 'fourth', escape: 'escape', pallet: 'fork', balance: 'balance', ratchet: 'ratchet', crownWheel: 'crown', cannon: 'center', minuteWheel: 'minute', hourWheel: 'hour' };
  let lastR = null, rock = 0;
  for (const id of opts.hide || []) B.hidePart(id);

  return {
    unit: 9, toggles: { bridges: ['barrelBridge', 'trainBridge', 'palletCock', 'screws', 'ratchet', 'crownWheel', 'click', 'clickSpring', 'jewelsBB', 'jewelsTB', 'cock', 'cockScrew', 'jewelsCock'], dial: ['dial', 'hourHand', 'minuteHand', 'secondHand'] },
    pose(p) {
      for (const id in ROT) B.parts[id].root.rotation.z = p[ROT[id]];
      hands.hour.root.rotation.z = p.hands.hour; hands.minute.root.rotation.z = p.hands.minute; if (hands.second) hands.second.root.rotation.z = p.hands.second;
      spin.rotation.y = p.stem;
      if (lastR !== null && p.ratchet !== lastR) rock = 1;
      lastR = p.ratchet;
      const tooth = ((-p.ratchet / (TAU / 50)) % 1 + 1) % 1;
      clk.root.rotation.z = rock * 0.09 * (1 - tooth); rock *= 0.9;
      barrel.update(Math.max(0, Math.min(1, p.reserve / c.reserveTurns)), p.ratchet, p.barrel);
      bal.update(p.balance);
    },
  };
}

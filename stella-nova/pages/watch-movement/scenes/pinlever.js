// ============================================================================
//  WATCH MOVEMENT  ·  scenes/pinlever.js — the Roskopf pin-lever watch in 3D
// ────────────────────────────────────────────────────────────────────────────
//  build(B, cal, opts) adds every part of calibres/pinlever.js to the
//  builder and returns pose(p). opts: noDial, dialPaint, hands, hide (as
//  scenes/lever.js).
//
//  THE LOOK
//    A cheap, sturdy watch: plain nickel plate and one large plain bridge
//    over the barrel and the whole train, a brass barrel so big it passes
//    the centre, a flat steel lever with two round steel pins, a plain
//    balance, and jewels only for the balance.
//
//  LAYERS  (explode offset = spread * unit * k)
//    hands -3.2 · dial -2.3 · motion works -1.3 · plate 0 · train 1
//    balance 1.9 · bridges 2.8 · balance cock 3.7
//  The pin lever stays in the train layer, so it still works the escape
//  wheel when the movement is apart.
// ============================================================================
import * as THREE from 'three';
import * as G from '../geom.js';
import { circ, hole } from '../kit.js';
import { wheelArbor, barrelParts, escapeWheel, balanceParts, handParts, paintRoman } from './shared.js';
const { TAU, D, pol } = G;
const local = (p, o) => [p[0] - o[0], p[1] - o[1]];

export function build(B, cal, opts = {}) {
  const { CAL: c, L, ESC } = cal, Z = c.z;
  for (const [k, v] of Object.entries({ hands: -3.2, dial: -2.3, motion: -1.3, plate: 0, train: 1, balance: 1.9, bridges: 2.8, cock: 3.7 })) B.layer(k, v);

  // PLATE: plain nickel
  const plate = B.part('plate', 'plate', [0, 0], { label: 'Pillar plate', labelAt: [-13.5, -10] });
  B.add(plate, B.slab(circ(c.plateR, 160), [], -c.plateT, 0, 'satin', 0.06), B.ring(c.plateR - 0.6, c.plateR, -0.02, 0.04, 'steel'));
  // the fixed post the cannon pinion turns on (there is no centre arbor)
  B.add(plate, B.cyl(0.42, Z.dialLo - 0.7, -c.plateT, 'steel', 18));
  const jw = B.part('jewelsPlate', 'plate', [0, 0], { info: 'jewel' });
  B.add(jw, B.jewel(L.Bal, 0.0, 0.62));

  // GOING TRAIN: the big barrel, second, third, escape
  const barrel = barrelParts(B, { at: L.B, N: c.barrel.N, m: c.barrel.m, zLo: Z.barrelLo, zHi: Z.barrelHi, rDrum: 8.45, arborHi: Z.bridgeHi + 0.05, drumMat: 'brass' });
  wheelArbor(B, { id: 'secondWheel', at: L.S, label: 'Second wheel', wheel: { N: c.second.N, m: c.second.m, z: Z.second, mat: 'brass', spokes: { rIn: 1.1, rim: 0.45, n: 4, w: 0.55 } }, pinion: { N: c.second.p, m: c.barrel.m, z: Z.barrelTeeth }, arbor: [0, Z.bridgeHi + 0.05, 0.28] });
  wheelArbor(B, { id: 'third', at: L.T, label: 'Third wheel', wheel: { N: c.third.N, m: c.third.m, z: Z.third, mat: 'brass', spokes: { rIn: 0.8, rim: 0.35, n: 4, w: 0.42 } }, pinion: { N: c.third.p, m: c.second.m, z: Z.second }, arbor: [0, Z.bridgeHi + 0.05, 0.22] });
  escapeWheel(B, ESC, { z: Z.escape, pinion: { N: c.escape.p, m: c.third.m, z: Z.third }, arbor: [0, Z.bridgeHi + 0.05], label: 'Pin-pallet escape wheel' });

  // PIN LEVER: a flat steel lever with two round steel pins, built at fork 0
  const lev = B.part('pallet', 'train', L.P, { label: 'Pin lever', labelZ: Z.fork + 0.9 });
  const z = Z.fork, u = pol(1, L.psi), nrm = [-u[1], u[0]], s = ESC.Ra / 2.3;
  const pins = [1, -1].map(sg => local(ESC.pinAt(sg), L.P));
  for (const pn of pins) {
    // an arm out to each pin, and the pin standing through it
    const arm = [pn[0] * 0.92, pn[1] * 0.92];
    B.add(lev, B.slab(G.capsule([0, 0], arm, 0.55 * s), [], z + 0.18, z + 0.36, 'satin', 0.03));
    const pin = B.cyl(ESC.rp, z - 0.2, z + 0.4, 'polished', 16); pin.position.set(pn[0], pn[1], 0);
    B.add(lev, pin);
  }
  const fe = [u[0] * c.forkLen, u[1] * c.forkLen];
  B.add(lev, B.slab(G.capsule([0, 0], [fe[0] - u[0] * 0.5, fe[1] - u[1] * 0.5], 0.5 * s), [], z + 0.18, z + 0.36, 'satin', 0.03));
  for (const sg of [1, -1]) {
    const a = [fe[0] - u[0] * 0.55 + nrm[0] * sg * 0.32, fe[1] - u[1] * 0.55 + nrm[1] * sg * 0.32];
    const b = [fe[0] + u[0] * 0.38 + nrm[0] * sg * 0.44, fe[1] + u[1] * 0.38 + nrm[1] * sg * 0.44];
    B.add(lev, B.slab(G.capsule(a, b, 0.3), [], z - 0.05, z + 0.12, 'satin', 0.02));
  }
  B.add(lev, B.slab(circ(0.7 * s, 24), [], z + 0.1, z + 0.4, 'satin', 0.03), B.cyl(0.18, 0, Z.palletCockHi + 0.05, 'steel'));

  // BALANCE: plain nickel, three arms, no screws, a steel roller pin
  const bal = balanceParts(B, { at: L.Bal, R: c.balR, z: Z.balance, zFork: Z.fork, jewelR: c.jewelR, psi: L.psi, hsZ: Z.hairspring, hsR: 4.1, coils: 11, staff: [0.3, Z.cockLo + 0.15], screws: 0, mat: 'satin', studAngle: 150 * D });

  // ONE LARGE BRIDGE over the barrel and the train, on three feet
  const br = B.part('bridge', 'bridges', [0, 0], { label: 'Train bridge', labelZ: Z.bridgeHi, labelAt: L.feet[1] });
  B.add(br, B.slab(G.hullOfCircles([[L.B, 9.0], [L.S, 1.6], [L.T, 1.4], [L.E, 1.2], ...L.feet.map(f => [f, 1.15])], 48), [hole(0.62, 24, L.B)], Z.bridgeLo, Z.bridgeHi, 'satin', 0.08));
  for (const f of L.feet) B.add(br, B.slab(circ(1.0, 32, f), [], 0, Z.bridgeLo, 'satin', 0));

  const pc = B.part('palletCock', 'bridges', [0, 0], {});
  B.add(pc, B.slab(G.hullOfCircles([[L.P, 0.9], [L.palletFoot, 0.95]]), [], Z.palletCockLo, Z.palletCockHi, 'satin', 0.05),
    B.slab(circ(0.8, 24, L.palletFoot), [], 0, Z.palletCockLo, 'satin', 0));

  // keyless works on the bridge
  const rat = B.part('ratchet', 'bridges', L.B, { label: 'Ratchet', labelZ: Z.ratchet + 0.4 });
  B.add(rat, B.slab(G.wheelProfile(c.ratchet.N, c.ratchet.m), [], Z.ratchet - 0.17, Z.ratchet + 0.17, 'satin', 0.02));
  const crw = B.part('crownWheel', 'bridges', L.CW, { label: 'Crown wheel', labelZ: Z.ratchet + 0.4 });
  B.add(crw, B.slab(G.wheelProfile(c.crown.N, c.crown.m), [], Z.ratchet - 0.17, Z.ratchet + 0.17, 'satin', 0.02));
  const clk = B.part('click', 'bridges', L.click, {});
  const tip = local([L.B[0] + Math.cos(222 * D) * 4.02, L.B[1] + Math.sin(222 * D) * 4.02], L.click);
  B.add(clk, B.slab(G.capsule([0, 0], tip, 0.55), [], Z.ratchet - 0.15, Z.ratchet + 0.1, 'steel', 0.02), B.slab(circ(0.55, 20), [], Z.ratchet + 0.1, Z.ratchet + 0.32, 'steel', 0.03));
  const zStem = Z.ratchet + 0.17 + G.pitchR(c.winding.m, c.winding.N) - 0.12, yPin = L.CW[1] + G.pitchR(c.crown.m, c.crown.N), yEnd = c.plateR + 1.4;
  const stem = B.part('stem', 'bridges', [0, 0], { slide: [0, 7], label: 'Crown', labelZ: zStem + 2.6, labelAt: [0, yEnd + 2] });
  const spin = new THREE.Group(); spin.position.set(0, 0, zStem); stem.root.add(spin);
  const along = (m, y0) => { m.geometry.rotateX(-Math.PI / 2); m.geometry.translate(0, y0, 0); return m; };
  const rod = B.cyl(0.42, 0, yEnd - (yPin + 0.25), 'steel', 20);
  rod.geometry.rotateX(-Math.PI / 2); rod.geometry.translate(0, yPin + 0.25, 0);
  for (const m of [along(B.slab(G.pinionProfile(c.winding.N, c.winding.m), [], 0, 0.5, 'steel', 0.01), yPin - 0.25), rod,
    along(B.slab(G.gearProfile(36, 0.13, { t: 0.5, ha: 0.6, hf: 0.6, seg: 3 }), [], 0, 2.5, 'satin', 0.04), yEnd)]) { B.add(stem, m); spin.add(m); }

  // BALANCE COCK with a plain regulator index
  const cock = B.part('cock', 'cock', [0, 0], { label: 'Balance cock', labelZ: Z.cockHi, labelAt: L.cockFoot });
  B.add(cock, B.slab(G.hullOfCircles([[L.Bal, 1.35], [L.cockFoot, 2.1]]), [hole(0.5, 20, L.Bal)], Z.cockLo, Z.cockHi, 'satin', 0.08),
    B.slab(circ(1.85, 40, L.cockFoot), [], 0, Z.cockLo, 'satin', 0));
  const regTip = [L.Bal[0] + Math.cos(140 * D) * 6.0, L.Bal[1] + Math.sin(140 * D) * 6.0];
  B.add(cock, B.slab(G.capsule(L.Bal, regTip, 0.32), [hole(0.75, 24, L.Bal)], Z.cockHi, Z.cockHi + 0.1, 'steel', 0.02));
  const studAt = [L.Bal[0] + Math.cos(150 * D) * 4.1, L.Bal[1] + Math.sin(150 * D) * 4.1];
  B.add(cock, B.slab(circ(0.28, 16, studAt), [], Z.hairspring - 0.12, Z.cockLo, 'steel', 0));
  const ckJ = B.part('jewelsCock', 'cock', [0, 0], { info: 'jewel' });
  B.add(ckJ, B.jewel(L.Bal, Z.cockHi + 0.03));

  // SCREWS, lifted above their bridges in the explode
  const screws = B.part('screws', 'bridges', [0, 0], { lift: 0.45 });
  for (const f of L.feet) B.screw(screws, f, Z.bridgeHi, 0.62);
  B.screw(screws, L.palletFoot, Z.palletCockHi, 0.5);
  B.screw(screws, L.B, Z.ratchet + 0.17, 1.1);
  B.screw(screws, L.CW, Z.ratchet + 0.17, 0.75);
  const cockScrew = B.part('cockScrew', 'cock', [0, 0], { lift: 0.45, info: 'screws' });
  B.screw(cockScrew, L.cockFoot, Z.cockHi, 0.9);

  // MOTION WORKS: the barrel's own wheel and pinion drive the hands
  const bw = B.part('barrelWheel', 'motion', L.B, { label: 'Barrel minute wheel', labelZ: Z.minute - 0.6 });
  B.add(bw, B.slab(G.wheelProfile(c.barrel.mw, c.barrel.mwm), G.spokeWindows(1.5, G.rootR(c.barrel.mw, c.barrel.mwm) - 0.4, 4, 0.45).map(h => h.reverse()), Z.minute - 0.13, Z.minute + 0.13, 'brass', 0.015),
    B.slab(G.pinionProfile(c.barrel.mp, c.barrel.mpm), [], Z.hour - 0.17, Z.minute - 0.13, 'steel', 0.01),
    B.ring(0.6, 1.4, Z.hour - 0.2, -c.plateT, 'brass'));
  const cp = B.part('cannon', 'motion', L.C, { label: 'Cannon pinion', labelZ: Z.cannon - 0.6 });
  B.add(cp, B.slab(G.pinionProfile(c.cannon.N, c.cannon.m), [hole(0.45, 16)], Z.cannon - 0.15, Z.cannon + 0.15, 'steel', 0.01),
    B.ring(0.44, 0.62, Z.dialLo - 0.62, Z.cannon, 'steel'));
  const hw = B.part('hourWheel', 'motion', L.C, { label: 'Hour wheel', labelZ: Z.hour - 0.8 });
  B.add(hw, B.slab(G.wheelProfile(c.hour.N, c.hour.m), G.spokeWindows(1.25, G.rootR(c.hour.N, c.hour.m) - 0.35, 4, 0.45).map(h => h.reverse()), Z.hour - 0.12, Z.hour + 0.12, 'brass', 0.015),
    B.ring(0.66, 0.95, Z.dialLo - 0.35, Z.hour, 'brass'));

  // DIAL and HANDS: plain enamel, spade hands, no seconds
  if (!opts.noDial) {
    const dial = B.part('dial', 'dial', [0, 0], { label: 'Dial', labelZ: Z.dialLo });
    const dialHoles = [hole(1.05, 24)];
    B.add(dial, B.slab(circ(c.plateR + 0.25, 180), dialHoles, Z.dialLo + 0.01, Z.dialHi - 0.05, 'brass', 0.05), B.ring(c.plateR - 0.05, c.plateR + 0.3, Z.dialLo - 0.02, Z.dialHi, 'steel'),
      B.dialFace(c.plateR + 0.3, Z.dialLo, dialHoles, opts.dialPaint || paintRoman({ line: 'PIN LEVER  ·  17 280 A/h' })));
  }
  const hands = handParts(B, { ...{ C: L.C, dialLo: Z.dialLo, hour: ['spade', 10.6, 0.42], minute: ['spade', 15.6, 0.34], mat: 'blued', hubR: 1.05 }, ...(opts.hands || {}) });

  const ROT = { barrel: 'barrel', barrelCover: 'barrel', barrelArbor: 'ratchet', barrelWheel: 'barrel', secondWheel: 'secondWheel', third: 'third', escape: 'escape', pallet: 'fork', balance: 'balance', ratchet: 'ratchet', crownWheel: 'crown', cannon: 'cannon', hourWheel: 'hour' };
  let lastR = null, rock = 0;
  for (const id of opts.hide || []) B.hidePart(id);

  return {
    unit: 9,
    toggles: { bridges: ['bridge', 'palletCock', 'screws', 'ratchet', 'crownWheel', 'click', 'cock', 'cockScrew', 'jewelsCock'], dial: ['dial', 'hourHand', 'minuteHand', 'secondHand'] },
    pose(p) {
      for (const id in ROT) B.parts[id].root.rotation.z = p[ROT[id]];
      hands.hour.root.rotation.z = p.hands.hour; hands.minute.root.rotation.z = p.hands.minute;
      if (hands.second) hands.second.root.rotation.z = p.hands.second;
      spin.rotation.y = p.stem;
      if (lastR !== null && p.ratchet !== lastR) rock = 1;
      lastR = p.ratchet;
      const tooth = ((-p.ratchet / (TAU / c.ratchet.N)) % 1 + 1) % 1;
      clk.root.rotation.z = rock * 0.09 * (1 - tooth); rock *= 0.9;
      barrel.update(Math.max(0, Math.min(1, p.reserve / c.reserveTurns)), p.ratchet, p.barrel);
      bal.update(p.balance);
    },
  };
}

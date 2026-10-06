// ============================================================================
//  WATCH MOVEMENT  ·  scenes/detent.js — the detent chronometer in 3D
// ────────────────────────────────────────────────────────────────────────────
//  build(B, cal, opts) adds the parts of calibres/detent.js and returns
//  pose(). The detent turns about its foot by lift / blade length (as in the
//  collision solve), so the locking stone drawn here is the one solved.
//  The balance carries the impulse roller and its ruby pallet (solved), the
//  discharging roller and its pallet (drawn where it meets the gold passing
//  spring on the active swing), a cut bimetallic rim, and a helical
//  hairspring that breathes with the balance.
//
//  LAYERS  (explode offset = spread * unit * k)
//    hands -3.2 · dial -2.3 · motion -1.3 · plate 0 · train 1
//    bridges 2.8 · balance cock 3.7
//  The detent and the balance stay in the train layer with the escape
//  wheel: the rollers on the balance staff work the wheel directly.
// ============================================================================
import * as G from '../geom.js';
import { circ, hole } from '../kit.js';
import { wheelArbor, barrelParts, motionWorks, handParts } from './shared.js';
const { TAU, D, pol, add, sub } = G;
const local = (p, o) => [p[0] - o[0], p[1] - o[1]];

// the chronometer dial: silvered, Roman hours, big seconds at 6, and the
// up-and-down (power reserve) scale at 12
function paintChrono(cal) {
  const F = cal.L.F, up = cal.L.upAt;
  return (g, R) => {
    const bg = g.createRadialGradient(-R * 0.2, -R * 0.3, 1, 0, 0, R);
    bg.addColorStop(0, '#f2f3f4'); bg.addColorStop(1, '#cfd2d6');
    g.fillStyle = bg; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
    const ink = '#17181c';
    g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 0.09;
    for (const r of [R * 0.885, R * 0.94]) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); }
    for (let i = 0; i < 60; i++) {
      const a = i / 60 * TAU, ca = Math.sin(a), sa = -Math.cos(a);
      g.lineWidth = i % 5 ? 0.07 : 0.16; g.beginPath(); g.moveTo(ca * R * 0.885, sa * R * 0.885); g.lineTo(ca * R * 0.94, sa * R * 0.94); g.stroke();
    }
    const RN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    g.font = `500 ${R * 0.12}px "STIX Two Text","Times New Roman",Georgia,serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 12; i++) {
      if (i === 0 || i === 6) continue;
      g.save(); g.rotate(i / 12 * TAU); g.translate(0, -R * 0.77); g.scale(0.92, 1.18); g.fillText(RN[i], 0, 0); g.restore();
    }
    // big seconds at 6 (canvas y is down)
    const sy = -F[1], sr = 4.6;
    g.lineWidth = 0.07; for (const r of [sr * 0.8, sr]) { g.beginPath(); g.arc(0, sy, r, 0, TAU); g.stroke(); }
    for (let i = 0; i < 120; i++) {
      const a = i / 120 * TAU, ca = Math.sin(a), sa = -Math.cos(a), r0 = i % 10 ? sr * 0.88 : sr * 0.8;
      g.lineWidth = i % 10 ? 0.04 : 0.09; g.beginPath(); g.moveTo(ca * r0, sy + sa * r0); g.lineTo(ca * sr, sy + sa * sr); g.stroke();
    }
    g.font = `${sr * 0.22}px "STIX Two Text",serif`;
    for (let i = 1; i <= 6; i++) { const a = i / 6 * TAU; g.fillText(String(i * 10), Math.sin(a) * sr * 0.6, sy - Math.cos(a) * sr * 0.6); }
    // up and down at 12: an arc from -120 to +120 degrees, 0..56 hours
    const uy = -up[1], ur = 3.4;
    g.lineWidth = 0.08; g.beginPath(); g.arc(0, uy, ur, -Math.PI / 2 - 2.1, -Math.PI / 2 + 2.1); g.stroke();
    for (let h = 0; h <= 56; h += 4) {
      const a = -2.1 + 4.2 * h / 56, ca = Math.sin(a), sa = -Math.cos(a);
      g.lineWidth = h % 8 ? 0.05 : 0.1; g.beginPath(); g.moveTo(ca * ur * 0.82, uy + sa * ur * 0.82); g.lineTo(ca * ur, uy + sa * ur); g.stroke();
    }
    g.font = `600 ${ur * 0.2}px Inter,Helvetica,sans-serif`;
    g.fillText('UP', Math.sin(2.1) * ur * 0.55, uy - Math.cos(2.1) * ur * 0.55 - 0.3);
    g.fillText('DOWN', Math.sin(-2.1) * ur * 0.55, uy - Math.cos(-2.1) * ur * 0.55 - 0.3);
    g.font = `600 ${R * 0.05}px Inter,Helvetica,sans-serif`; g.fillText('STELLA  NOVA', 0, -R * 0.12);
    g.font = `${R * 0.034}px Inter,Helvetica,sans-serif`; g.fillStyle = '#4a4d55'; g.fillText('SPRING DETENT  ·  CHRONOMETER', 0, -R * 0.06);
  };
}

export function build(B, cal, opts = {}) {
  const { CAL: c, L, ESC } = cal, Z = c.z;
  for (const [k, v] of Object.entries({ hands: -3.2, dial: -2.3, motion: -1.3, plate: 0, train: 1, balance: 1.9, bridges: 2.8, cock: 3.7 })) B.layer(k, v);

  // PLATE
  const plate = B.part('plate', 'plate', [0, 0], { label: 'Pillar plate', labelAt: [-15, -9] });
  B.add(plate, B.slab(circ(c.plateR, 180), [], -c.plateT, 0, 'giltPlate', 0.06), B.ring(c.plateR - 0.6, c.plateR, -0.02, 0.04, 'gilt'));
  const jw = B.part('jewelsPlate', 'plate', [0, 0], { info: 'jewel' });
  for (const j of [L.C, L.T, L.F, L.E, L.Bal]) B.add(jw, B.jewel(j, 0.04, 0.62));

  // GOING TRAIN
  const barrel = barrelParts(B, { at: L.B, N: 80, m: 0.19, zLo: Z.barrelLo, zHi: Z.barrelHi, rDrum: 7.25, arborHi: Z.bridgeHi + 0.05 });
  wheelArbor(B, { id: 'center', at: L.C, label: 'Centre wheel', wheel: { N: 80, m: 0.125, z: Z.center, spokes: { rIn: 1.05, rim: 0.45, n: 4, w: 0.5 } }, pinion: { N: 10, m: 0.19, z: Z.barrelTeeth }, arbor: [-c.plateT, Z.bridgeHi + 0.05, 0.32] });
  wheelArbor(B, { id: 'third', at: L.T, label: 'Third wheel', wheel: { N: 75, m: 0.12, z: Z.third, spokes: { rIn: 0.9, rim: 0.4, n: 4, w: 0.42 } }, pinion: { N: 10, m: 0.125, z: Z.center }, arbor: [0, Z.bridgeHi + 0.05] });
  wheelArbor(B, { id: 'fourth', at: L.F, label: 'Fourth wheel', wheel: { N: 80, m: 0.10, z: Z.fourth, spokes: { rIn: 0.8, rim: 0.38, n: 4, w: 0.4 } }, pinion: { N: 10, m: 0.12, z: Z.third }, arbor: [Z.dialLo - 0.45, Z.bridgeHi + 0.05] });
  const esc = B.part('escape', 'train', L.E, { label: 'Escape wheel', labelZ: Z.escape + 0.4 });
  B.add(esc,
    B.slab(ESC.wheel, G.spokeWindows(0.6, c.escape.Rf - 0.35, 5, 0.32).map(h => h.reverse()), Z.escape - 0.1, Z.escape + 0.1, 'steel', 0.012),
    B.slab(G.pinionProfile(c.escape.p, c.fourth.m), [], Z.fourth - 0.17, Z.fourth + 0.17, 'steel', 0.01),
    B.cyl(0.45, Z.escape - 0.15, Z.escape + 0.15, 'steel'), B.cyl(0.2, 0, Z.bridgeHi + 0.05, 'steel'));

  // THE DETENT: foot block, blade, locking stone, horn and gold spring.
  // The part sits at the foot and turns by -lift / blade length.
  const Ld = G.dist(L.foot, L.stoneAt);
  const det = B.part('detent', 'train', L.foot, { label: 'Spring detent', labelZ: Z.detent + 0.5, labelAt: L.stoneAt });
  const sLoc = local(L.stoneAt, L.foot), hLoc = local(L.hornTip, L.foot), zd = Z.detent;
  B.add(det, B.slab(G.capsule([0, 0], sLoc, 0.22), [], zd - 0.08, zd + 0.08, 'steel', 0.01),
    B.slab(G.capsule(sLoc, hLoc, 0.3), [], zd - 0.17, zd + 0.17, 'steel', 0.015),
    B.slab(G.capsule(G.pol(0.3, Math.atan2(sLoc[1], sLoc[0])), G.pol(1.8, Math.atan2(sLoc[1], sLoc[0])), 0.7), [], zd - 0.25, zd + 0.25, 'steel', 0.03),
    B.slab(circ(0.55, 20, sLoc), [], zd - 0.3, zd + 0.3, 'steel', 0.03),
    B.slab(cal.ESC.stonePoly(0).map(q => local(q, L.foot)), [], Z.escape - 0.14, Z.escape + 0.14, 'ruby', 0.01));
  const gold = B.part('passing', 'train', L.foot, { info: 'passing' });
  const gDir = G.ang(sLoc, hLoc), gEnd = add(hLoc, pol(0.45, gDir));
  B.add(gold, B.slab(G.capsule(add(sLoc, pol(1.2, gDir)), gEnd, 0.1), [], Z.discharge - 0.05, Z.discharge + 0.05, 'gold', 0));
  // the foot: a block screwed to the plate, and the banking screw
  const footB = B.part('detentFoot', 'train', L.foot, { info: 'detent' });
  const fd = G.ang(L.stoneAt, L.foot);
  B.add(footB, B.slab(G.capsule(pol(-0.4, fd), pol(1.3, fd), 1.5), [], 0, zd + 0.35, 'giltBridge', 0.05), B.cyl(0.55, zd + 0.35, zd + 0.7, 'blued', 20));
  const bank = add(local(L.stoneAt, L.foot), pol(1.4, G.ang(L.E, L.stoneAt)));
  B.add(footB, B.slab(circ(0.35, 16, bank), [], 0, zd + 0.3, 'blued', 0.02));

  // BALANCE: impulse and discharging rollers, cut bimetallic rim, weights
  const bal = B.part('balance', 'train', L.Bal, { label: 'Compensation balance', labelZ: Z.balance + 0.7 });
  const R = c.balR;
  const rimArc = (r0, r1, a0, a1, n = 60) => {
    const out = [];
    for (let i = 0; i <= n; i++) out.push(pol(r1, a0 + (a1 - a0) * i / n));
    for (let i = n; i >= 0; i--) out.push(pol(r0, a0 + (a1 - a0) * i / n));
    return out;
  };
  for (const s0 of [0, Math.PI]) {
    // each half of the rim is fixed to the arm at one end and cut free at the other
    B.add(bal, B.slab(rimArc(R - 0.55, R - 0.25, s0 + 4 * D, s0 + 172 * D), [], Z.balance - 0.25, Z.balance + 0.25, 'brass', 0.04),
      B.slab(rimArc(R - 0.85, R - 0.55, s0 + 4 * D, s0 + 172 * D), [], Z.balance - 0.25, Z.balance + 0.25, 'steel', 0.04));
    for (let k = 0; k < 6; k++) {
      const a = s0 + (30 + k * 22) * D, m = B.cyl(0.24, -0.25, 0.25, 'gold', 12);
      m.geometry.rotateY(Math.PI / 2); m.position.set(...pol(R - 0.05, a), Z.balance); m.rotation.z = a; B.add(bal, m);
    }
    const wgt = B.cyl(0.7, -0.6, 0.6, 'gold', 20); wgt.geometry.rotateY(Math.PI / 2);
    wgt.position.set(...pol(R - 0.15, s0 + 110 * D), Z.balance); wgt.rotation.z = s0 + 110 * D; B.add(bal, wgt);
  }
  B.add(bal, B.slab(G.capsule(pol(R - 0.6, 0), pol(R - 0.6, Math.PI), 0.8), [], Z.balance - 0.12, Z.balance + 0.12, 'steel', 0.03),
    B.cyl(0.18, 0.3, Z.cockLo + 0.15, 'steel'));
  // impulse roller with its ruby pallet (the solved outline), discharging roller
  B.add(bal, B.slab(circ(c.rImp, 48), [hole(0.2, 12)], Z.roller - 0.12, Z.roller + 0.12, 'steel', 0.02),
    B.slab(cal.ESC.palletPoly(0).map(q => local(q, L.Bal)), [], Z.roller - 0.2, Z.roller + 0.2, 'ruby', 0.01),
    B.slab(circ(c.rDis, 32), [hole(0.2, 12)], Z.discharge - 0.08, Z.discharge + 0.08, 'steel', 0.015));
  const disA = G.ang(L.Bal, L.hornTip) + 5 * D;
  const disPin = B.slab(G.capsule(pol(c.rDis - 0.1, disA), pol(c.rDis + 0.28, disA), 0.16), [], Z.discharge - 0.12, Z.discharge + 0.12, 'ruby', 0);
  B.add(bal, disPin);
  // helical hairspring: a wire wound round the staff above the balance
  const hs = B.part('hairspring', 'train', L.Bal, { label: 'Helical hairspring', labelZ: Z.hairspring + 0.8 });
  const helix = B.path(10 * 64, 0.09, 'hair', 1);
  B.add(hs, helix, B.cyl(0.55, Z.balance + 0.35, Z.balance + 0.55, 'steel'), B.cyl(0.5, Z.cockLo - 0.25, Z.cockLo, 'steel'));

  // BRIDGES
  const feetBB = [pol(8.5, 200 * D), pol(8.45, 95 * D)].map(p => add(L.B, p));
  const bb = B.part('barrelBridge', 'bridges', [0, 0], { label: 'Bridges', labelZ: Z.bridgeHi, info: 'bridges' });
  B.add(bb, B.slab(G.hullOfCircles([[L.B, 8.1], [L.C, 1.7], ...feetBB.map(f => [f, 1.15])]), [hole(0.62, 24, L.B)], Z.bridgeLo, Z.bridgeHi, 'giltBridge', 0.06));
  for (const f of feetBB) B.add(bb, B.slab(circ(1.0, 32, f), [], 0, Z.bridgeLo, 'giltBridge', 0));
  const feetTB = [[-6.4, -11.2], [1.5, -16.8]];
  const tb = B.part('trainBridge', 'bridges', [0, 0], { info: 'bridges' });
  B.add(tb, B.slab(G.hullOfCircles([[L.T, 1.7], [L.F, 1.8], [L.E, 1.3], ...feetTB.map(f => [f, 1.35])]), [], Z.bridgeLo, Z.bridgeHi, 'giltBridge', 0.06));
  for (const f of feetTB) B.add(tb, B.slab(circ(1.05, 32, f), [], 0, Z.bridgeLo, 'giltBridge', 0));
  const bJ = B.part('jewelsBridges', 'bridges', [0, 0], { info: 'jewel' });
  for (const j of [L.C, L.T, L.F, L.E]) B.add(bJ, B.jewel(j, Z.bridgeHi + 0.04, 0.55));

  // BALANCE COCK
  const cock = B.part('cock', 'cock', [0, 0], { label: 'Balance cock', labelZ: Z.cockHi });
  B.add(cock, B.slab(G.hullOfCircles([[L.Bal, 2.0], [L.cockFoot, 2.4]]), [hole(0.5, 20, L.Bal)], Z.cockLo, Z.cockHi, 'giltBridge', 0.08),
    B.slab(circ(2.1, 40, L.cockFoot), [], 0, Z.cockLo, 'giltBridge', 0),
    B.slab(circ(1.1, 32, L.Bal), [hole(0.6, 24, L.Bal)], Z.cockHi - 0.02, Z.cockHi + 0.16, 'gold', 0.03));
  const cJ = B.part('jewelCock', 'cock', [0, 0], { info: 'jewel' });
  B.add(cJ, B.slab(circ(0.45, 20, L.Bal), [], Z.cockHi + 0.1, Z.cockHi + 0.22, 'steel', 0.03));
  const screws = B.part('screws', 'bridges', [0, 0], { lift: 0.45 });
  for (const f of [...feetBB, ...feetTB]) B.screw(screws, f, Z.bridgeHi);
  B.screw(screws, L.B, Z.bridgeHi + 0.1, 1.1);
  const cs = B.part('cockScrew', 'cock', [0, 0], { lift: 0.45, info: 'screws' });
  B.screw(cs, L.cockFoot, Z.cockHi, 0.95);

  // MOTION WORKS, DIAL, HANDS
  motionWorks(B, { C: L.C, M: L.M, cannon: c.cannon, minute: c.minute, hour: c.hour, z: Z, dialLo: Z.dialLo, plateLo: -c.plateT, s: 1 });
  if (!opts.noDial) {
    const dial = B.part('dial', 'dial', [0, 0], { label: 'Dial', labelZ: Z.dialLo });
    const dialHoles = [hole(1.0, 24), hole(0.45, 16, L.F), hole(0.4, 16, L.upAt)];
    B.add(dial, B.slab(circ(20.25, 180), dialHoles, Z.dialLo + 0.01, Z.dialHi - 0.05, 'brass', 0.05), B.ring(19.95, 20.3, Z.dialLo - 0.02, Z.dialHi, 'gilt'),
      B.dialFace(20.3, Z.dialLo, dialHoles, opts.dialPaint || paintChrono(cal)));
  }
  const hands = handParts(B, { ...{ C: L.C, dialLo: Z.dialLo, hour: ['spade', 10.5, 0.42], minute: ['spade', 15.5, 0.32], mat: 'blued', second: { at: L.F, len: 4.4, z: Z.dialLo - 0.3 } }, ...(opts.hands || {}) });
  const rh = B.part('reserveHand', 'hands', L.upAt, {});
  B.add(rh, B.slab([[-0.08, -0.5], [0.08, -0.5], [0.05, 3.0], [-0.05, 3.0]], [], Z.dialLo - 0.25, Z.dialLo - 0.17, 'blued', 0), B.cyl(0.3, Z.dialLo - 0.3, Z.dialLo - 0.1, 'blued', 16));

  const ROT = { barrel: 'barrel', barrelCover: 'barrel', barrelArbor: 'ratchet', center: 'center', third: 'third', fourth: 'fourth', escape: 'escape', balance: 'balance', cannon: 'center', minuteWheel: 'minute', hourWheel: 'hour' };
  for (const id of opts.hide || []) B.hidePart(id);
  const helixR = 2.4, zH0 = Z.balance + 0.55, zH1 = Z.cockLo - 0.3, turns = 10, th0 = 20 * D;
  return {
    unit: 9,
    toggles: { bridges: ['barrelBridge', 'trainBridge', 'jewelsBridges', 'screws', 'cock', 'jewelCock', 'cockScrew'], dial: ['dial', 'hourHand', 'minuteHand', 'secondHand', 'reserveHand'] },
    pose(p) {
      for (const id in ROT) B.parts[id].root.rotation.z = p[ROT[id]];
      hands.hour.root.rotation.z = p.hands.hour; hands.minute.root.rotation.z = p.hands.minute;
      if (hands.second) hands.second.root.rotation.z = p.hands.second;
      const lift = p.detentLift || 0;
      det.root.rotation.z = -lift / Ld; gold.root.rotation.z = -lift / Ld;
      const w = Math.max(0, Math.min(1, p.reserve / c.reserveTurns));
      rh.root.rotation.z = -(-2.1 + 4.2 * w);
      barrel.update(w, p.ratchet || 0, p.barrel);
      // the helix: the lower end turns with the balance, the upper end is
      // pinned in the stud; the turns between share the twist
      helix.userData.update(s => {
        const a = th0 + turns * TAU * s + p.balance * (1 - s);
        return [helixR * Math.cos(a), helixR * Math.sin(a), zH0 + (zH1 - zH0) * s];
      });
    },
  };
}

// ============================================================================
//  WATCH MOVEMENT  ·  scenes/brocot.js — the Brocot mantel movement in 3D
// ────────────────────────────────────────────────────────────────────────────
//  build(B, cal, opts) adds the parts of calibres/brocot.js and returns
//  pose(p). Two round brass plates on four turned pillars hold the train;
//  the escape wheel and the anchor with its two red half-round pins sit in
//  front of the enamel dial, in a cut-out above the centre, under a small
//  cock. The pendulum hangs from a Brocot suspension behind the back plate
//  and the crutch joins it to the anchor arbor.
//
//  MIRROR  the escape wheel and the anchor are built in the canonical frame
//  of the escapement tables, inside groups with scale.x = -1, and take the
//  table angles as they are (see MIRROR in the calibre).
//
//  LAYERS  (explode offset = spread * unit * k)
//    hands -3.2 · cock -2.6 · escapement -2.0 · dial -1.4 · motion -0.8
//    front plate and pillars 0 · train 0.8 · back plate 1.6 · pendulum 2.4
// ============================================================================
import * as THREE from 'three';
import * as G from '../geom.js';
import { circ, hole } from '../kit.js';
import { wheelArbor, motionWorks, handParts } from './shared.js';
const { TAU, D, pol, add, sub } = G;

// the default dial: white enamel, Roman hours, a minute track, an aperture
// round the escapement and a ring for the winding hole
function paintBrocotDial(L, c) {
  return (g, R) => {
    const bg = g.createRadialGradient(-R * 0.16, -R * 0.27, 1, 0, 0, R);
    bg.addColorStop(0, '#fdfaf2'); bg.addColorStop(1, '#ede6d6');
    g.fillStyle = bg; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
    const ink = '#1c1a20';
    g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = R * 0.003;
    for (const r of [R * 0.86, R * 0.92]) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); }
    for (let i = 0; i < 60; i++) {
      const a = i / 60 * TAU, ca = Math.sin(a), sa = -Math.cos(a);
      g.lineWidth = R * (i % 5 ? 0.0028 : 0.0065);
      g.beginPath(); g.moveTo(ca * R * 0.86, sa * R * 0.86); g.lineTo(ca * R * 0.92, sa * R * 0.92); g.stroke();
    }
    const RN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    g.font = `500 ${R * 0.13}px "STIX Two Text","Times New Roman",Georgia,serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 12; i++) { g.save(); g.rotate(i / 12 * TAU); g.translate(0, -R * 0.75); g.scale(0.94, 1.18); g.fillText(RN[i], 0, 0); g.restore(); }
    // the aperture rim and the winding hole ring (canvas y is down)
    g.strokeStyle = '#a8823c'; g.lineWidth = R * 0.012;
    g.beginPath(); g.arc(L.aperture.c[0], -L.aperture.c[1], L.aperture.r + R * 0.008, 0, TAU); g.stroke();
    g.lineWidth = R * 0.006; g.beginPath(); g.arc(-L.B[0], -L.B[1], 2.4, 0, TAU); g.stroke();
    g.font = `italic ${R * 0.055}px "STIX Two Text","Times New Roman",Georgia,serif`; g.fillStyle = '#4a4550';
    g.fillText('Stella Nova', 0, R * 0.22); g.font = `${R * 0.038}px "STIX Two Text",Georgia,serif`; g.fillText('À PARIS', 0, R * 0.29);
  };
}

export function build(B, cal, opts = {}) {
  const { CAL: c, L, ESC } = cal, Z = c.z;
  const handBase = Z.frontCock - 1.2;               // the hands pass in front of the escapement
  for (const [k, v] of Object.entries({ hands: -3.2, cock: -2.6, esc: -2.0, dial: -1.4, motion: -0.8, plate: 0, train: 0.8, back: 1.6, pend: 2.4 })) B.layer(k, v);
  const arbors = [L.C, L.T, L.S2, L.E, L.P, L.B];

  // FRONT PLATE AND PILLARS
  const plate = B.part('plate', 'plate', [0, 0], { label: 'Front plate', labelAt: [-26, -18] });
  B.add(plate, B.slab(circ(c.plateR, 180), arbors.map(a => hole(0.5, 16, a)), -c.plateT, 0, 'brass', 0.1));
  const pil = B.part('pillars', 'plate', [0, 0], { label: 'Pillars', labelAt: L.pillars[0], labelZ: 9 });
  const prof = [[0.01, 0], [1.9, 0], [2.2, 0.8], [1.5, 2.2], [1.35, 7], [2.0, 9], [1.35, 11], [1.5, 15.8], [2.2, 17.2], [1.9, 18], [0.01, 18]].map(([r, z]) => new THREE.Vector2(r, z));
  for (const at of L.pillars) { const g = new THREE.LatheGeometry(prof, 32); g.rotateX(Math.PI / 2); g.translate(at[0], at[1], 0); B.add(pil, B.mesh(g, 'brass')); }

  // BACK PLATE (with a stamped medallion) and the click and ratchet
  const back = B.part('backPlate', 'back', [0, 0], { label: 'Back plate', labelAt: [22, 22], labelZ: c.backLo + c.backT });
  B.add(back, B.slab(circ(c.plateR, 180), arbors.map(a => hole(0.5, 16, a)), c.backLo, c.backLo + c.backT, 'brass', 0.1),
    B.ring(5.2, 6.2, c.backLo + c.backT, c.backLo + c.backT + 0.12, 'gilt', [-14, 8]), B.slab(circ(5.2, 48, [-14, 8]), [], c.backLo + c.backT, c.backLo + c.backT + 0.06, 'giltPlate', 0));
  const rat = B.part('ratchet', 'back', L.B, { info: 'winding' });
  B.add(rat, B.slab(G.wheelProfile(40, 0.4), [], c.backLo + c.backT, c.backLo + c.backT + 0.8, 'steel', 0.03));
  const clk = B.part('click', 'back', add(L.B, pol(10.6, 20 * D)), { info: 'winding' });
  B.add(clk, B.slab(G.capsule([0, 0], pol(3.6, 200 * D), 1.0), [], c.backLo + c.backT, c.backLo + c.backT + 0.7, 'steel', 0.05),
    B.cyl(0.7, c.backLo + c.backT, c.backLo + c.backT + 1.1, 'blued', 16));

  // GOING TRAIN between the plates
  const bar = B.part('barrel', 'train', L.B, { label: 'Barrel', labelZ: Z.barrelHi });
  B.add(bar, B.slab(G.wheelProfile(96, 0.32), [hole(14.0, 120)], Z.barrelLo, Z.barrelLo + 0.8, 'brass', 0.04),
    B.slab(circ(14.2, 140), [hole(13.7, 140)], Z.barrelLo + 0.6, Z.barrelHi, 'brass', 0.06),
    B.slab(circ(14.2, 140), [hole(1.6, 24)], Z.barrelHi - 0.5, Z.barrelHi, 'brass', 0.05),
    B.slab(circ(13.8, 140), [hole(1.6, 24)], Z.barrelLo, Z.barrelLo + 0.4, 'brass', 0.04));
  const wind = B.part('winding', 'train', L.B, { label: 'Winding square' });
  B.add(wind, B.cyl(1.5, Z.barrelLo - 6.6, c.backLo + c.backT + 0.9, 'steel', 24),
    B.slab([[-1.0, -1.0], [1.0, -1.0], [1.0, 1.0], [-1.0, 1.0]], [], Z.dialLo - 1.0, Z.barrelLo - 6.6, 'steel', 0.08));
  wheelArbor(B, { id: 'inter', at: L.S2, label: 'Intermediate wheel', wheel: { N: 72, m: 0.26, z: Z.inter, t: 0.45, spokes: { rIn: 1.8, rim: 0.9, n: 5, w: 1.0 }, mat: 'brass' }, pinion: { N: 12, m: 0.32, z: Z.barrelTeeth, t: 1.1 }, arbor: [0, c.backLo, 0.5] });
  wheelArbor(B, { id: 'center', at: L.C, label: 'Centre wheel', wheel: { N: 84, m: 0.22, z: Z.center, t: 0.45, spokes: { rIn: 1.8, rim: 0.9, n: 5, w: 1.0 }, mat: 'brass' }, pinion: { N: 8, m: 0.26, z: Z.inter, t: 0.7 }, arbor: [Z.cannon - 0.5, c.backLo, 0.6] });
  wheelArbor(B, { id: 'third', at: L.T, label: 'Third wheel', wheel: { N: 90, m: 0.18, z: Z.third, t: 0.4, spokes: { rIn: 1.5, rim: 0.7, n: 5, w: 0.8 }, mat: 'brass' }, pinion: { N: 7, m: 0.22, z: Z.center, t: 0.7 }, arbor: [0, c.backLo, 0.45] });

  // ESCAPE WHEEL (mirrored, on the dial), its pinion inside the plates
  const esc = B.part('escape', 'esc', L.E, { label: 'Escape wheel', labelZ: Z.escape - 0.6, labelAt: add(L.E, [-7.5, -3]) });
  const escMir = new THREE.Group(); escMir.scale.x = -1; esc.root.add(escMir);
  const wheelMeshes = [
    B.slab(ESC.wheel, G.spokeWindows(1.1, c.escape.Rf - 0.55, 5, 0.42).map(h => h.reverse()), Z.escape - 0.22, Z.escape + 0.22, 'brass', 0.02),
    B.cyl(0.9, Z.escape - 0.3, Z.escape + 0.3, 'brass', 24),
    B.slab(G.pinionProfile(6, 0.18), [], Z.third - 0.35, Z.third + 0.35, 'steel', 0.01),
    B.cyl(0.32, Z.frontCock + 0.3, c.backLo, 'steel', 14),
  ];
  for (const m of wheelMeshes) { B.add(esc, m); escMir.add(m); }

  // ANCHOR (mirrored): two arms, a boss, two red half-round pins
  const anc = B.part('anchor', 'esc', L.P, { label: 'Brocot anchor', labelZ: Z.anchor - 0.6, labelAt: add(L.P, [6, 2]) });
  const ancMir = new THREE.Group(); ancMir.scale.x = -1; anc.root.add(ancMir);
  const Pc = ESC.Pc, pins = ESC.pinsAt(0).map(pp => pp.map(q => sub(q, Pc)));
  const cent = pins.map(pp => [pp.reduce((s, q) => s + q[0], 0) / pp.length, pp.reduce((s, q) => s + q[1], 0) / pp.length]);
  const zA = Z.anchor, ancMeshes = [];
  for (const [i, ctr] of cent.entries()) {
    const dir = G.ang([0, 0], ctr), back = sub(ctr, pol(0.9, dir));
    // the arm runs in front of the wheel; the pin reaches back through its plane
    ancMeshes.push(B.slab(G.capsule([0, 0], back, 1.15), [], zA - 0.75, zA - 0.35, 'steel', 0.05));
    ancMeshes.push(B.slab(pins[i], [], zA - 0.75, zA + 1.15, 'ruby', 0.02));
  }
  ancMeshes.push(B.slab(circ(1.6, 32), [hole(0.35, 12)], zA - 0.8, zA - 0.3, 'steel', 0.06),
    B.slab(G.capsule([0, 0], [0, 3.2], 1.1), [], zA - 0.72, zA - 0.38, 'steel', 0.04),
    B.cyl(0.38, Z.frontCock + 0.3, Z.crutch + 0.4, 'steel', 14));
  for (const m of ancMeshes) { B.add(anc, m); ancMir.add(m); }

  // ESCAPEMENT COCK: a slim bridge over the front pivots
  const cock = B.part('frontCock', 'cock', [0, 0], { label: 'Escapement cock', labelAt: add(L.P, [0, 5]), labelZ: Z.frontCock });
  const top = add(L.P, [0, 6.0]);                   // the foot lands on the dial, past the aperture
  B.add(cock, B.slab(G.hullOfCircles([[L.E, 1.25], [top, 1.6]]), [hole(0.35, 12, L.E), hole(0.4, 12, L.P)], Z.frontCock - 0.3, Z.frontCock + 0.3, 'giltBridge', 0.08),
    B.slab(circ(1.4, 24, top), [], Z.frontCock + 0.3, Z.dialLo, 'brass', 0.05), B.jewel(L.E, Z.frontCock - 0.35, 0.6), B.jewel(L.P, Z.frontCock - 0.35, 0.65));
  const cs = B.part('cockScrew', 'cock', [0, 0], { lift: 0.3, info: 'frontCock' });
  B.screw(cs, top, Z.frontCock - 0.66, 0.9);

  // MOTION WORKS, DIAL, HANDS (the hands pass in front of the escapement)
  motionWorks(B, { C: L.C, M: L.M, cannon: c.cannon, minute: c.minute, hour: c.hour, z: Z, dialLo: handBase, plateLo: -c.plateT, s: 2.2 });
  if (!opts.noDial) {
    const dial = B.part('dial', 'dial', [0, 0], { label: 'Dial', labelAt: [-24, -30], labelZ: Z.dialLo });
    const dialHoles = [hole(2.1, 24), hole(L.aperture.r, 96, L.aperture.c), hole(2.0, 24, L.B), hole(0.9, 16, L.regulator)];
    B.add(dial, B.slab(circ(c.dialR - 0.15, 200), dialHoles, Z.dialLo + 0.01, Z.dialHi - 0.15, 'brass', 0.1),
      B.ring(L.aperture.r - 0.15, L.aperture.r + 0.9, Z.dialLo - 0.25, Z.dialHi, 'gilt', L.aperture.c),
      B.ring(c.dialR - 0.8, c.dialR, Z.dialLo - 0.25, Z.dialHi, 'gilt'),
      B.dialFace(c.dialR, Z.dialLo, dialHoles, opts.dialPaint || paintBrocotDial(L, c)));
  }
  const hands = handParts(B, { ...{ C: L.C, dialLo: handBase, hour: ['spade', 23, 0.95], minute: ['spade', 36, 0.75], mat: 'blued', hubR: 2.0 }, ...(opts.hands || {}) });

  // PENDULUM, CRUTCH AND BROCOT SUSPENSION (behind the back plate)
  const pz = Z.pend, pv = L.suspension;
  const pend = B.part('pendulum', 'pend', pv, { label: 'Pendulum', labelAt: [pv[0] + 14, pv[1] - c.pendL], labelZ: pz });
  const rodTop = -6, bobY = -c.pendL;
  B.add(pend, B.slab([[-0.2, 0], [0.2, 0], [0.2, rodTop], [-0.2, rodTop]], [], pz - 0.05, pz + 0.05, 'steel', 0),
    B.slab([[-1.4, rodTop + 0.4], [1.4, rodTop + 0.4], [1.4, rodTop - 2.2], [-1.4, rodTop - 2.2]], [], pz - 0.6, pz + 0.6, 'brass', 0.1),
    B.slab([[-1.0, rodTop - 2.0], [1.0, rodTop - 2.0], [1.0, bobY + c.bobR - 1], [-1.0, bobY + c.bobR - 1]], [], pz - 0.5, pz + 0.5, 'brass', 0.2));
  const bobProf = [[0.01, -2.4], [c.bobR * 0.7, -2.2], [c.bobR, -0.8], [c.bobR, 0.8], [c.bobR * 0.7, 2.2], [0.01, 2.4]].map(([r, z]) => new THREE.Vector2(r, z));
  const bob = new THREE.LatheGeometry(bobProf, 72); bob.rotateX(Math.PI / 2); bob.translate(0, bobY, pz);
  B.add(pend, B.mesh(bob, 'gilt'), B.slab(circ(1.4, 24, [0, bobY - c.bobR - 2]), [], pz - 0.4, pz + 0.4, 'brass', 0.1));
  const crutch = B.part('crutch', 'pend', L.P, { label: 'Crutch', labelAt: [L.P[0] - 6, L.P[1] - 10], labelZ: Z.crutch });
  const yTo = pv[1] - 18 - L.P[1];
  B.add(crutch, B.slab(G.capsule([0, 0], [0, yTo], 1.0), [], Z.crutch - 0.25, Z.crutch + 0.25, 'brass', 0.05),
    B.slab([[-1.6, yTo - 0.4], [-0.6, yTo - 0.4], [-0.6, yTo + 0.6], [-1.6, yTo + 0.6]], [], Z.crutch - 0.2, pz + 0.9, 'steel', 0.05),
    B.slab([[0.6, yTo - 0.4], [1.6, yTo - 0.4], [1.6, yTo + 0.6], [0.6, yTo + 0.6]], [], Z.crutch - 0.2, pz + 0.9, 'steel', 0.05),
    B.slab(circ(1.4, 24), [], Z.crutch - 0.3, Z.crutch + 0.3, 'brass', 0.05));
  const sus = B.part('suspension', 'back', [0, 0], { label: 'Brocot suspension', labelAt: [pv[0] + 9, pv[1] + 2], labelZ: pz });
  B.add(sus, B.slab([[pv[0] - 3.5, pv[1] - 1.2], [pv[0] + 3.5, pv[1] - 1.2], [pv[0] + 3.5, pv[1] + 3.4], [pv[0] - 3.5, pv[1] + 3.4]], [], c.backLo + c.backT, pz - 0.8, 'brass', 0.15),
    B.slab([[pv[0] - 1.2, pv[1] + 0.2], [pv[0] + 1.2, pv[1] + 0.2], [pv[0] + 1.2, pv[1] + 2.8], [pv[0] - 1.2, pv[1] + 2.8]], [], pz - 0.8, pz + 1.4, 'brass', 0.1),
    B.slab([[pv[0] - 0.5, pv[1] - 0.2], [pv[0] + 0.5, pv[1] - 0.2], [pv[0] + 0.5, pv[1] + 0.6], [pv[0] - 0.5, pv[1] + 0.6]], [], pz - 0.06, pz + 0.06, 'steel', 0),
    // the regulator arbor runs to the dial, square above XII
    B.cyl(0.55, Z.dialLo - 0.9, pz - 0.8, 'steel', 12).translateX(L.regulator[0]).translateY(L.regulator[1] - 0.0),
    B.slab([[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]].map(q => add(q, L.regulator)), [], Z.dialLo - 1.6, Z.dialLo - 0.6, 'steel', 0.05));

  const ROT = { barrel: 'barrel', inter: 'inter', center: 'center', third: 'third', cannon: 'center', minuteWheel: 'minute', hourWheel: 'hour', winding: 'ratchet', ratchet: 'ratchet' };
  for (const id of opts.hide || []) B.hidePart(id);
  return {
    unit: 10, focusK: -2.0,
    toggles: { bridges: ['backPlate', 'pillars', 'frontCock', 'cockScrew', 'suspension', 'ratchet', 'click'], dial: ['dial', 'hourHand', 'minuteHand'] },
    pose(p) {
      for (const id in ROT) B.parts[id].root.rotation.z = p[ROT[id]];
      hands.hour.root.rotation.z = p.hands.hour; hands.minute.root.rotation.z = p.hands.minute;
      if (hands.second) hands.second.root.rotation.z = p.hands.second;
      escMir.rotation.z = p.escapeL;              // canonical angles inside the mirror
      ancMir.rotation.z = p.anchor;
      pend.root.rotation.z = p.pendulum;
      crutch.root.rotation.z = p.pendulum;
      const tooth = ((-p.ratchet / (TAU / 40)) % 1 + 1) % 1;
      clk.root.rotation.z = 0.06 * (1 - tooth) * (p.ratchet ? 1 : 0);
    },
  };
}

// ============================================================================
//  WATCH MOVEMENT  ·  scenes/verge.js — the English verge fusee in 3D
// ────────────────────────────────────────────────────────────────────────────
//  build(B, cal, opts) adds the parts of calibres/verge.js and returns pose().
//
//  THE WHEEL FRAME
//    The crown wheel and the verge are built in a frame whose x axis is the
//    crown arbor (direction psi in the plane of the plates) and whose z
//    axis is the watch axis. Rotating that frame by psi about z puts it in
//    place. Tooth k sits at angle k * TAU / 15 round the arbor, measured
//    from y toward z; turning the wheel by b about x matches the unrolled
//    rows of the solver. The verge flags are at aU and aL plus the balance
//    angle, in the same frame.
//
//  LAYERS  (explode offset = spread * unit * k)
//    hands -2.4 · dial -1.8 · motion -1.0 · pillar plate and pillars 0
//    train 0.9 (with the crown wheel, verge and potence: they run between
//    the plates, so they must stay under the top plate as it lifts)
//    top plate 2.6 · balance 3.3 · cock 4.0
//  The top plate lifts far, so the whole train stands in the open gap.
// ============================================================================
import * as THREE from 'three';
import * as G from '../geom.js';
import { circ, hole } from '../kit.js';
import { wheelArbor, balanceParts, motionWorks, handParts, paintEnglish } from './shared.js';
const { TAU, D, pol, add } = G;

export function build(B, cal, opts = {}) {
  const { CAL: c, L } = cal, Z = c.z;
  for (const [k, v] of Object.entries({ hands: -2.4, dial: -1.8, motion: -1.0, plate: 0, train: 0.9, top: 2.6, esc: 3.3, cock: 4.0 })) B.layer(k, v);

  // PILLAR PLATE and four tulip pillars
  const plate = B.part('plate', 'plate', [0, 0], { label: 'Pillar plate', labelAt: [13, -8] });
  B.add(plate, B.slab(circ(c.plateR, 180), [], -c.plateT, 0, 'giltPlate', 0.06), B.ring(c.plateR - 0.5, c.plateR, -0.02, 0.05, 'gilt'));
  const pil = B.part('pillars', 'plate', [0, 0], { label: 'Pillars', labelZ: 3.4, labelAt: L.pillars[0] });
  const prof = [[0.01, 0], [0.8, 0], [0.95, 0.35], [0.66, 0.9], [0.55, 2.2], [0.82, 2.9], [1.02, 3.4], [0.62, 4.3], [0.62, 5.1], [0.92, 5.6], [0.8, 6.0], [0.01, 6.0]].map(([r, z]) => new THREE.Vector2(r, z));
  for (const at of L.pillars) {
    const g = new THREE.LatheGeometry(prof, 28); g.rotateX(Math.PI / 2); g.translate(at[0], at[1], 0);
    B.add(pil, B.mesh(g, 'gilt'));
  }

  // FUSEE: great wheel (turns with the train) and the grooved cone
  const gw = B.part('greatWheel', 'train', L.F, { info: 'fusee', label: 'Fusee', labelZ: Z.great + 0.4, labelAt: add(L.F, [-6.5, 0]) });
  B.add(gw, B.slab(G.wheelProfile(48, 0.24), G.spokeWindows(1.3, G.rootR(48, 0.24) - 0.5, 4, 0.6).map(h => h.reverse()), Z.great - 0.15, Z.great + 0.15, 'gilt', 0.03));
  const fu = B.part('fuseeCone', 'train', L.F, { info: 'fusee' });
  const fz = [], f = c.fusee, steps = 150;
  for (let i = 0; i <= steps; i++) {
    const z = f.zLo + (f.zHi - f.zLo) * i / steps, groove = 0.11 * (0.5 + 0.5 * Math.cos(TAU * (z - f.zLo) / ((f.zHi - f.zLo) / f.turns)));
    fz.push(new THREE.Vector2(f.r0 + (f.r1 - f.r0) * (i / steps) - groove, z));
  }
  fz.unshift(new THREE.Vector2(0.5, f.zLo)); fz.push(new THREE.Vector2(0.5, f.zHi));
  const cone = new THREE.LatheGeometry(fz, 64); cone.rotateX(Math.PI / 2);
  B.add(fu, B.mesh(cone, 'gilt'), B.cyl(0.5, -c.plateT - 0.05, Z.topHi + 0.05, 'steel', 18), B.slab(circ(f.r0 + 0.25, 64), [hole(0.5)], f.zLo - 0.2, f.zLo, 'gilt', 0.03));
  // the chain (world coordinates, rebuilt from the reserve each frame)
  const ch = B.part('chain', 'train', [0, 0], { label: 'Fusee chain', labelZ: 3.0, labelAt: add(L.F, pol(5, 10 * D)) });
  const chainMesh = B.path(900, 0.42, 'chain', 0.5);
  B.add(ch, chainMesh);
  // going barrel (no teeth)
  const bar = B.part('barrel', 'train', L.Bb, { label: 'Barrel', labelZ: Z.barrelHi });
  B.add(bar, B.slab(circ(c.barrelR, 96), [hole(c.barrelR - 0.3, 96)], Z.barrelLo, Z.barrelHi, 'gilt', 0.04),
    B.slab(circ(c.barrelR + 0.25, 96), [hole(0.6)], Z.barrelLo, Z.barrelLo + 0.2, 'gilt', 0.04), B.slab(circ(c.barrelR + 0.25, 96), [hole(0.6)], Z.barrelHi - 0.2, Z.barrelHi, 'gilt', 0.04),
    B.cyl(0.6, -c.plateT - 0.05, Z.topHi + 0.4, 'steel', 18));
  const sq = B.part('barrelArbor', 'top', L.Bb, { info: 'barrel' });       // the set-up square above the top plate
  B.add(sq, B.slab([[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]], [], Z.topHi, Z.topHi + 0.5, 'steel', 0.03));

  // GOING TRAIN between the plates
  wheelArbor(B, { id: 'center', at: L.C, label: 'Centre wheel', wheel: { N: 54, m: 0.22, z: Z.center, spokes: { rIn: 1.2, rim: 0.5, n: 4, w: 0.6 } }, pinion: { N: 12, m: 0.24, z: Z.great }, arbor: [-c.plateT, Z.topHi + 0.1, 0.35] });
  wheelArbor(B, { id: 'third', at: L.T, label: 'Third wheel', wheel: { N: 48, m: 0.2, z: Z.third, spokes: { rIn: 1.0, rim: 0.45, n: 4, w: 0.5 } }, pinion: { N: 6, m: 0.22, z: Z.center }, arbor: [0, Z.topLo, 0.25] });
  // contrate wheel: a spoked disc with teeth standing up from its rim
  const ct = B.part('contrate', 'train', L.Ct, { label: 'Contrate wheel', labelZ: Z.contrateTop + 0.3 });
  const Rc = G.pitchR(0.2, 48);
  B.add(ct, B.slab(circ(Rc + 0.15, 96), G.spokeWindows(0.9, Rc - 0.55, 4, 0.55).map(h => h.reverse()), Z.contrate - 0.1, Z.contrate + 0.1, 'gilt', 0.02));
  for (let k = 0; k < 48; k++) {
    const a0 = k * TAU / 48, w = 0.42 * TAU / 48, out = [];
    for (let i = 0; i <= 3; i++) out.push(pol(Rc + 0.15, a0 - w / 2 + w * i / 3));
    for (let i = 3; i >= 0; i--) out.push(pol(Rc - 0.3, a0 - w / 2 + w * i / 3));
    B.add(ct, B.slab(out, [], Z.contrate + 0.1, Z.contrateTop, 'gilt', 0.03));
  }
  B.add(ct, B.slab(G.pinionProfile(6, 0.2), [], Z.third - 0.17, Z.third + 0.17, 'steel', 0.01), B.cyl(0.25, 0, Z.topLo, 'steel', 16));

  // CROWN WHEEL in its wheel frame (x along the arbor)
  const R = c.crown.R, h = c.crown.h;
  const cw = B.part('escape', 'train', L.Xw, { label: 'Crown wheel', labelZ: Z.crown + R + 0.5 });
  cw.root.position.z = Z.crown; cw.root.rotation.z = L.psi;
  const spin = new THREE.Group(); cw.root.add(spin);
  const toFrame = m => { m.geometry.rotateY(Math.PI / 2); return m; };        // xy disc -> yz disc, extrusion -> +x
  const meshes = [
    toFrame(B.slab(circ(R - 0.18, 64), G.spokeWindows(0.45, R - 0.5, 4, 0.32).map(q => q.reverse()), -0.12, 0.02, 'gilt', 0.015)),
    toFrame(B.ring(R - 0.28, R, 0, 0.12, 'gilt')),
    toFrame(B.slab(G.pinionProfile(6, 0.2).map(([x, y]) => [x, y]), [], -2.5 - 0.17, -2.5 + 0.17, 'steel', 0.01)),
  ];
  const arb = B.cyl(0.17, -4.1, 0.15, 'steel', 14); arb.geometry.rotateY(Math.PI / 2);
  meshes.push(arb);
  const toothPoly = G.crownTeeth(0, 0, TAU * R / 15, h)[0];
  for (let k = 0; k < 15; k++) {
    const phi = k * TAU / 15, r = new THREE.Vector3(0, Math.cos(phi), Math.sin(phi)), t = new THREE.Vector3(0, -Math.sin(phi), Math.cos(phi));
    const m = B.slab(toothPoly, [], R - 0.26, R, 'gilt', 0.01);
    m.geometry.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), t, r));
    m.geometry.translate(0.1, 0, 0);
    meshes.push(m);
  }
  for (const m of meshes) { B.add(cw, m); spin.add(m); }

  // VERGE: the upright staff with two flags, in the same frame turned by psi
  const vg = B.part('verge', 'train', L.V, { label: 'Verge', labelZ: Z.crown + R + 0.8 });
  const aU = Math.PI - c.palletOpen / 2, aL = Math.PI + c.palletOpen / 2;
  const flag = (a, z0, z1) => {
    const d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]], w = c.palletW / 2, r0 = 0.1, r1 = c.palletLen;
    return B.slab([[d[0] * r0 + n[0] * w, d[1] * r0 + n[1] * w], [d[0] * r1 + n[0] * w, d[1] * r1 + n[1] * w], [d[0] * r1 - n[0] * w, d[1] * r1 - n[1] * w], [d[0] * r0 - n[0] * w, d[1] * r0 - n[1] * w]], [], z0, z1, 'steel', 0.01);
  };
  B.add(vg, B.cyl(0.17, Z.crown - R - 0.6, Z.cockLo - 0.05, 'steel', 14),
    flag(aU, Z.crown + R - 0.4, Z.crown + R + 0.12), flag(aL, Z.crown - R - 0.12, Z.crown - R + 0.4));

  // POTENCE: a bracket from the top plate down to the lower verge pivot
  const pot = B.part('potence', 'train', L.V, {});
  // the post stands beside the crown wheel, clear of the view along its arbor
  const side = pol(R + 0.9, L.psi - Math.PI / 2);
  B.add(pot, B.slab(circ(0.4, 20, side), [], Z.crown - R - 0.95, Z.topLo, 'brass', 0.03),
    B.slab(G.capsule(side, [0, 0], 0.9), [hole(0.18, 12)], Z.crown - R - 0.95, Z.crown - R - 0.65, 'brass', 0.03),
    B.slab(G.capsule(side, pol(-0.9, L.psi), 0.8), [], Z.crown - 0.3, Z.crown + 0.3, 'brass', 0.03));

  // BALANCE on the verge, above the top plate
  const bal = balanceParts(B, { layer: 'esc', at: L.V, R: c.balR, z: Z.balance, staff: [Z.topHi, Z.cockLo], hsZ: Z.hairspring, hsR: 2.6, coils: 4, screws: 0, mat: 'gilt', studAngle: 30 * D });

  // TOP PLATE
  const top = B.part('topPlate', 'top', [0, 0], { label: 'Top plate', labelZ: Z.topHi, labelAt: [12, 8] });
  B.add(top, B.slab(circ(c.plateR - 0.4, 180), [hole(0.45, 16, L.V), hole(0.7, 16, L.Bb)], Z.topLo, Z.topHi, 'giltPlate', 0.08), B.ring(c.plateR - 0.9, c.plateR - 0.4, Z.topHi - 0.02, Z.topHi + 0.05, 'gilt'));

  // BALANCE COCK: a wide pierced table on a foot
  const ck = B.part('cock', 'cock', [0, 0], { label: 'Balance cock', labelZ: Z.cockHi, labelAt: L.cockFoot });
  const holes = [hole(0.45, 16, L.V)];
  for (const [rr, n, hr, off] of [[2.6, 8, 0.55, 0], [4.4, 12, 0.48, 0.5], [6.0, 18, 0.3, 0]]) for (let k = 0; k < n; k++) holes.push(hole(hr, 18, add(L.V, pol(rr, (k + off) / n * TAU))));
  B.add(ck, B.slab(circ(7.2, 120, L.V), holes, Z.cockLo, Z.cockHi, 'giltBridge', 0.05), B.ring(6.85, 7.2, Z.cockHi - 0.02, Z.cockHi + 0.06, 'gilt', L.V),
    B.slab(G.hullOfCircles([[L.cockFoot, 2.6], [add(L.cockFoot, pol(-2.2, 18 * D)), 1.6]]), [], Z.topHi, Z.topHi + 0.45, 'giltBridge', 0.05),
    B.slab(circ(1.5, 32, add(L.cockFoot, pol(-1.6, 18 * D))), [], Z.topHi + 0.4, Z.cockLo, 'gilt', 0.03));
  const dia = B.part('jewelCock', 'cock', [0, 0], { info: 'jewel' });
  B.add(dia, B.slab(circ(0.8, 32, L.V), [], Z.cockHi, Z.cockHi + 0.12, 'gilt', 0.03), B.slab(circ(0.32, 16, L.V), [], Z.cockHi + 0.1, Z.cockHi + 0.22, 'steel', 0.03));
  const screws = B.part('screws', 'cock', [0, 0], { lift: 0.4, info: 'cock' });
  B.screw(screws, L.cockFoot, Z.topHi + 0.45, 0.75);

  // MOTION WORKS, DIAL, HANDS (beetle and poker, no seconds)
  motionWorks(B, { C: L.C, M: L.M, cannon: c.cannon, minute: c.minute, hour: c.hour, z: Z, dialLo: Z.dialLo, plateLo: -c.plateT, s: 1 });
  if (!opts.noDial) {
    const dial = B.part('dial', 'dial', [0, 0], { label: 'Dial', labelZ: Z.dialLo });
    const dialHoles = [hole(1.0, 24)];
    B.add(dial, B.slab(circ(18.85, 180), dialHoles, Z.dialLo + 0.01, Z.dialHi - 0.05, 'brass', 0.05), B.ring(18.55, 18.9, Z.dialLo - 0.02, Z.dialHi, 'gilt'),
      B.dialFace(18.9, Z.dialLo, dialHoles, opts.dialPaint || paintEnglish({ brand: 'Stella Nova', line: 'London' })));
  }
  const hands = handParts(B, { ...{ C: L.C, dialLo: Z.dialLo, hour: ['beetle', 10.0, 0.4], minute: ['poker', 15.0, 0.3], mat: 'blued', hubR: 1.0 }, ...(opts.hands || {}) });

  const ROT = { greatWheel: 'great', fuseeCone: 'fuseeTurn', center: 'center', third: 'third', contrate: 'contrate', cannon: 'center', minuteWheel: 'minute', hourWheel: 'hour', balance: 'balance' };
  let lastW = -1;
  for (const id of opts.hide || []) B.hidePart(id);

  return {
    unit: 9, focusK: 0.9,
    toggles: { bridges: ['topPlate', 'cock', 'jewelCock', 'screws', 'barrelArbor'], dial: ['dial', 'hourHand', 'minuteHand'] },
    pose(p) {
      for (const id in ROT) B.parts[id].root.rotation.z = p[ROT[id]];
      hands.hour.root.rotation.z = p.hands.hour; hands.minute.root.rotation.z = p.hands.minute;
      spin.rotation.x = p.crown;
      vg.root.rotation.z = L.psi + p.verge;
      bal.update(p.balance);
      const w = Math.max(0, Math.min(1, p.reserve / c.reserveTurns));
      if (Math.abs(w - lastW) > 1e-6) {
        lastW = w;
        const path = cal.chainPath(w);
        chainMesh.userData.update(s => path.pts[Math.min(path.pts.length - 1, Math.round(s * (path.pts.length - 1)))], -path.travel);
        bar.root.rotation.z = -path.travel / c.barrelR;
      }
    },
  };
}

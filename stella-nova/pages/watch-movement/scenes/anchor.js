// ============================================================================
//  WATCH MOVEMENT  ·  scenes/anchor.js — the anchor wall clock in 3D
// ────────────────────────────────────────────────────────────────────────────
//  build(B, cal, opts) adds the parts of calibres/anchor.js and returns
//  pose(). Two brass plates on four turned pillars hold the train; the
//  anchor and its crutch turn by p.anchor; the pendulum hangs behind the
//  back plate from a spring suspension at L.PIV and turns by p.pendulum.
//  opts: noDial, dialPaint, hands, hide (as scenes/lever.js).
//
//  LAYERS  (explode offset = spread * unit * k)
//    hands -2.4 · dial -1.8 · motion -1.0 · front plate and pillars 0
//    train 0.9 (with the anchor, so it still works the wheel) · back plate
//    2.2 · pendulum, crutch and back cock 3.0
// ============================================================================
import * as THREE from 'three';
import * as G from '../geom.js';
import { circ, hole } from '../kit.js';
import { wheelArbor, motionWorks, handParts, paintRoman } from './shared.js';
const { TAU, D, pol, add, sub } = G;
const local = (p, o) => [p[0] - o[0], p[1] - o[1]];

export function build(B, cal, opts = {}) {
  const { CAL: c, L, ESC } = cal, Z = c.z;
  for (const [k, v] of Object.entries({ hands: -2.4, dial: -1.8, motion: -1.0, plate: 0, train: 0.9, back: 2.2, pend: 3.0 })) B.layer(k, v);
  const plateOut = G.hullOfCircles([[-28, 54], [28, 54], [-28, -44], [28, -44]].map(q => [q, 4]), 24);

  // FRONT PLATE and four turned pillars
  const fp = B.part('plate', 'plate', [0, 0], { label: 'Plates', labelAt: [-30, -30] });
  B.add(fp, B.slab(plateOut, [hole(1.6, 20, L.C)], Z.frontLo, Z.frontHi, 'brass', 0.3));
  const pil = B.part('pillars', 'plate', [0, 0], { label: 'Pillars', labelAt: L.pillars[1], labelZ: 8 });
  const prof = [[0.01, 0], [2.4, 0], [2.6, 0.8], [1.7, 2.2], [1.6, 6.5], [2.4, 8], [1.6, 9.5], [1.6, 13.8], [2.6, 15.2], [2.4, 16], [0.01, 16]].map(([r, z]) => new THREE.Vector2(r, z));
  for (const at of L.pillars) {
    const g = new THREE.LatheGeometry(prof, 32); g.rotateX(Math.PI / 2); g.translate(at[0], at[1], 0);
    B.add(pil, B.mesh(g, 'brass'));
  }

  // BARREL: teeth on the drum, a lift-off cover, the arbor, the spring
  const Rdrum = 19.8, zb0 = Z.barrelLo, zb1 = Z.barrelHi;
  const bar = B.part('barrel', 'train', L.B, { label: 'Barrel', labelZ: zb1 });
  B.add(bar, B.slab(G.wheelProfile(72, 0.6), [hole(Rdrum - 0.6, 96)], Z.barrelTeeth - 0.7, Z.barrelTeeth + 0.7, 'gilt', 0.08),
    B.slab(circ(Rdrum, 120), [hole(Rdrum - 0.8, 120)], zb0, zb1 - 0.5, 'gilt', 0.1),
    B.slab(circ(Rdrum - 0.7, 96), [hole(3, 32)], zb0, zb0 + 0.5, 'gilt', 0.1));
  const cover = B.part('barrelCover', 'train', L.B, { lift: 0.5, info: 'barrel' });
  B.add(cover, B.slab(circ(Rdrum, 120), [hole(3, 32)], zb1 - 0.5, zb1, 'gilt', 0.1));
  const arb = B.part('barrelArbor', 'train', L.B, { info: 'mainspring' });
  B.add(arb, B.cyl(2.8, zb0 + 0.3, zb1, 'steel', 32), B.cyl(1.4, Z.frontLo - 0.5, Z.backHi + 3.2, 'steel', 20));
  const sq = B.slab([[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]], [], Z.frontLo - 3.2, Z.frontLo - 0.5, 'steel', 0.15);
  B.add(arb, sq);                                          // the winding square through the dial
  const sp = B.part('mainspring', 'train', L.B, { label: 'Mainspring', labelZ: zb1 });
  const rib = B.ribbon(1400, zb0 + 0.8, zb1 - 0.9, 'spring');
  B.add(sp, rib);

  // GOING TRAIN
  wheelArbor(B, { id: 'center', at: L.C, label: 'Centre wheel', wheel: { N: 72, m: 0.5, z: Z.center, t: 1.2, spokes: { rIn: 3.2, rim: 1.6, n: 4, w: 2.4 } }, pinion: { N: 8, m: 0.6, z: Z.barrelTeeth, t: 1.8 }, arbor: [Z.cannon - 0.6, Z.backHi + 0.6, 1.0] });
  wheelArbor(B, { id: 'third', at: L.T, label: 'Third wheel', wheel: { N: 90, m: 0.32, z: Z.third, t: 1.0, spokes: { rIn: 2.4, rim: 1.2, n: 4, w: 1.7 } }, pinion: { N: 6, m: 0.5, z: Z.center, t: 1.6 }, arbor: [Z.frontLo - 0.4, Z.backHi + 0.4, 0.7] });

  // ESCAPE WHEEL (recoil teeth) with its pinion
  const esc = B.part('escape', 'train', L.E, { label: 'Escape wheel', labelZ: Z.escape + 1 });
  B.add(esc,
    B.slab(ESC.wheel, G.spokeWindows(3.2, c.escape.Rf - 1.6, 4, 1.7).map(h => h.reverse()), Z.escape - 0.6, Z.escape + 0.6, 'brass', 0.05),
    B.slab(G.pinionProfile(6, 0.32), [], Z.third - 0.75, Z.third + 0.75, 'steel', 0.03),
    B.cyl(2.4, Z.escape - 0.7, Z.escape + 0.7, 'brass', 24),
    B.cyl(0.6, Z.frontLo - 0.4, Z.backHi + 0.4, 'steel', 16));

  // ANCHOR: two steel pallets on a bow over the wheel
  const anc = B.part('anchor', 'train', L.P, { label: 'Anchor', labelZ: Z.anchor + 1.2 });
  const pallets = ESC.palletPolys(0).map(s => s.map(q => local(q, L.P)));
  for (const s of pallets) {
    const base = [(s[1][0] + s[2][0]) / 2, (s[1][1] + s[2][1]) / 2];
    B.add(anc, B.slab(s, [], Z.anchor - 0.8, Z.anchor + 0.8, 'polished', 0.06));
    B.add(anc, B.slab(G.capsule([0, 0], base, 2.4), [], Z.anchor - 0.55, Z.anchor + 0.55, 'steel', 0.12));
  }
  B.add(anc, B.cyl(2.6, Z.anchor - 0.9, Z.anchor + 0.9, 'steel', 28), B.cyl(0.75, Z.frontLo - 0.4, Z.pend - 1.2, 'steel', 16));

  // BACK PLATE, back cock with the suspension
  const bp = B.part('backPlate', 'back', [0, 0], { label: 'Back plate', labelAt: [30, -30], labelZ: Z.backHi, info: 'plate' });
  B.add(bp, B.slab(plateOut, [hole(1.2, 20, L.P), hole(1.0, 20, L.C), hole(1.6, 20, L.B)], Z.backLo, Z.backHi, 'brass', 0.3));
  const ck = B.part('backCock', 'pend', [0, 0], { label: 'Suspension', labelAt: [10, L.PIV[1] + 6], labelZ: Z.pend, info: 'suspension' });
  const ckOut = G.hullOfCircles([[[L.PIV[0] - 7, L.PIV[1] + 3], 3], [[L.PIV[0] + 7, L.PIV[1] + 3], 3], [[L.PIV[0], L.PIV[1] - 2], 3.2]], 24);
  B.add(ck, B.slab(ckOut, [hole(1.0, 16, L.P)], Z.backHi, Z.backHi + 1.6, 'brass', 0.15),
    B.slab([[L.PIV[0] - 3.2, L.PIV[1] - 1.2], [L.PIV[0] + 3.2, L.PIV[1] - 1.2], [L.PIV[0] + 3.2, L.PIV[1] + 4.5], [L.PIV[0] - 3.2, L.PIV[1] + 4.5]], [], Z.backHi + 1.6, Z.pend + 1.2, 'brass', 0.15));
  const screws = B.part('screws', 'back', [0, 0], { lift: 0.4 });
  for (const at of L.pillars) B.screw(screws, at, Z.backHi, 1.6);
  B.screw(screws, [L.PIV[0] - 7, L.PIV[1] + 3], Z.backHi + 1.6, 1.3);
  B.screw(screws, [L.PIV[0] + 7, L.PIV[1] + 3], Z.backHi + 1.6, 1.3);

  // CRUTCH: an arm on the anchor arbor with a fork round the pendulum rod
  const forkY = -26;
  const cr = B.part('crutch', 'pend', L.P, { label: 'Crutch', labelAt: [L.P[0] + 6, L.P[1] + forkY], labelZ: Z.pend });
  B.add(cr, B.slab(G.capsule([0, 0], [0, forkY], 1.6), [], Z.pend - 3.2, Z.pend - 2.4, 'steel', 0.1),
    B.cyl(1.6, Z.pend - 3.4, Z.pend - 2.2, 'steel', 20));
  for (const sx of [-1, 1]) { const pin = B.cyl(0.45, Z.pend - 2.4, Z.pend + 1.4, 'steel', 12); pin.position.set(sx * 1.55, forkY, 0); B.add(cr, pin); }

  // PENDULUM: spring suspension, rod, lenticular bob, rating nut
  const pend = B.part('pendulum', 'pend', L.PIV, { label: 'Pendulum', labelAt: [L.PIV[0] + 16, L.PIV[1] - c.pend.L], labelZ: Z.pend });
  const Lp = c.pend.L, R = c.pend.bobR, susp = 7;
  B.add(pend, B.slab([[-1.4, -susp], [1.4, -susp], [1.4, 0], [-1.4, 0]], [], Z.pend - 0.08, Z.pend + 0.08, 'spring', 0));
  B.add(pend, B.slab([[-1.9, -susp - 2.5], [1.9, -susp - 2.5], [1.9, -susp + 0.2], [-1.9, -susp + 0.2]], [], Z.pend - 0.7, Z.pend + 0.7, 'brass', 0.15));
  // rod: along z, then turned to run down -y from under the suspension to the bob
  const rod = B.cyl(0.85, 0, Lp - susp - 2, 'steel', 16); rod.geometry.rotateX(Math.PI / 2); rod.geometry.translate(0, -(susp + 2), Z.pend);
  B.add(pend, rod);
  const lens = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24, r = R * Math.sin(Math.PI * t / 2); lens.push(new THREE.Vector2(Math.max(0.01, r), c.pend.bobT / 2 * Math.cos(Math.PI * t / 2))); }
  for (let i = 23; i >= 0; i--) { const t = i / 24, r = R * Math.sin(Math.PI * t / 2); lens.push(new THREE.Vector2(Math.max(0.01, r), -c.pend.bobT / 2 * Math.cos(Math.PI * t / 2))); }
  const bob = new THREE.LatheGeometry(lens, 64); bob.rotateX(Math.PI / 2); bob.translate(0, -Lp, Z.pend);
  B.add(pend, B.mesh(bob, 'gilt'));
  const nut = B.slab(G.gearProfile(18, 0.25, { t: 0.5, ha: 0.5, hf: 0.5, seg: 3 }), [], 0, 2.4, 'brass', 0.1);
  nut.geometry.rotateX(-Math.PI / 2); nut.geometry.translate(0, -Lp - R - 3.4, Z.pend);
  const thread = B.cyl(0.6, 0, R + 4, 'steel', 12); thread.geometry.rotateX(-Math.PI / 2); thread.geometry.translate(0, -Lp - R - 4, Z.pend);
  B.add(pend, nut, thread);

  // MOTION WORKS, DIAL, HANDS
  motionWorks(B, { C: L.C, M: L.M, cannon: c.cannon, minute: c.minute, hour: c.hour, z: Z, dialLo: Z.dialLo, plateLo: Z.frontLo, s: 2.6 });
  if (!opts.noDial) {
    const dial = B.part('dial', 'dial', [0, 0], { label: 'Dial', labelZ: Z.dialLo, labelAt: [-20, -30] });
    const dialHoles = [hole(1.6, 24), hole(1.8, 20, [0, -24])];
    B.add(dial, B.slab(circ(43, 180), dialHoles, Z.dialLo + 0.02, Z.dialHi, 'brass', 0.2),
      B.dialFace(43, Z.dialLo, dialHoles, opts.dialPaint || paintRoman({ line: 'ANCHOR  ·  10 800 A/h' })));
    for (const at of [[-20, 22], [20, 22], [-20, -16], [20, -16]]) { const f = B.cyl(1.0, Z.dialHi, Z.frontLo, 'brass', 12); f.position.set(at[0], at[1], 0); B.add(dial, f); }
  }
  const hands = handParts(B, { ...{ C: L.C, dialLo: Z.dialLo, hour: ['spade', 24, 1.0], minute: ['spade', 36, 0.75], mat: 'blued', hubR: 2.4 }, ...(opts.hands || {}) });

  const ROT = { barrel: 'barrel', barrelCover: 'barrel', barrelArbor: 'ratchet', center: 'center', third: 'third', escape: 'escape', anchor: 'anchor', crutch: 'anchor', pendulum: 'pendulum', cannon: 'center', minuteWheel: 'minute', hourWheel: 'hour' };
  const rw = Rdrum - 1.0;
  for (const id of opts.hide || []) B.hidePart(id);
  return {
    unit: 10, focusK: 0.9,
    toggles: { bridges: ['backPlate', 'backCock', 'screws'], dial: ['dial', 'hourHand', 'minuteHand'] },
    pose(p) {
      for (const id in ROT) B.parts[id].root.rotation.z = p[ROT[id]];
      hands.hour.root.rotation.z = p.hands.hour; hands.minute.root.rotation.z = p.hands.minute;
      if (hands.second) hands.second.root.rotation.z = p.hands.second;
      // mainspring: wound, the coils hug the arbor; run down, the wall
      const w = Math.max(0, Math.min(1, p.reserve / c.reserveTurns));
      const ra = 3.0 + (rw * 0.55 - 3.0) * (1 - w), rb = rw * (0.55 + 0.45 * (1 - w)), turns = 8 + 6 * w;
      rib.userData.update(s => {
        const r = s < 0.03 ? 2.9 + (ra - 2.9) * s / 0.03 : s > 0.97 ? rb + (rw - rb) * (s - 0.97) / 0.03 : ra + (rb - ra) * (s - 0.03) / 0.94;
        const a = p.ratchet * (1 - s) + p.barrel * s + turns * TAU * s;
        return [r * Math.cos(a), r * Math.sin(a)];
      });
    },
  };
}

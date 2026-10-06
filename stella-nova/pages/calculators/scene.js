// ============================================================================
//  PASCALINE & CURTA  ·  scene.js — the parts of each calculator and their pose
// ----------------------------------------------------------------------------
//  build(B, id) makes one machine with kit.js and returns sc: { setPlan(P),
//  pose(t), box, keys }. pose(t) reads the plan of mech.js at time t (beats),
//  so the wheels that main.js turns are the ones the tests check.
//
//  PASCALINE (mm; y up, front +z). Six stages, wheel j at x_j = (2.5 - j) SP,
//  the units wheel at the right. Open front, so the carry works in view.
//    base ........ wood plate y -10 .. 0, back wall, end walls, axle posts
//    cover ....... brass plate y 60 .. 64, a drum window and a dial ring
//                  (decal at y 64.4, polygonOffset) for each stage, z -66 .. 70
//    dial j ...... spoked input wheel y 66 .. 72 at z DZ on a vertical shaft;
//                  a crown of 10 pins at y 40 .. 50 under the cover
//    axle j ...... horizontal axle along z at y AY: lantern pinion
//                  (z 17 .. 26.5), carry wheel (z -4 .. 0) with 10 drive pins
//                  and one lift pin, 1:1 with the dial. The lift pin turns
//                  clockwise seen from the front and rises on the left,
//                  under the sautoir tip, over digits 7 .. 9 (LIFT0)
//    drum j ...... digit drum r 22, z -44 .. -30, 4 mm under the window
//    sautoir j ... lever on axle j + 1, in the plane z 4.5 .. 8.5 (j even) or
//                  10 .. 14 (j odd), so two levers never share a plane; its
//                  tip rides on the lift pin of wheel j, a lead weight on top
//
//  CURTA (mm; y up, about 2.3 x a Type I). Angles phi from +x toward -z.
//    base ........ black case, a shell r 58 .. 62 with 8 slider slots and a
//                  window (phi 5 .. 135 deg) onto the drum
//    drum ........ stepped drum r 24, nine ribs of 1 .. 9 steps (rib k spans
//                  y 110 - 10k .. 115), a helix of carry teeth above
//    shaft g ..... setting shaft at RS 38, phi_g = -20 - 20 g deg. Shafts are
//                  13.3 mm apart; a gear tip circle is 11.6 mm, so two gears
//                  at one level do not touch
//    gear g ...... the gear on shaft g, at y 15 + 10 s_g (meets s_g ribs)
//    slider g .... knob outside the case, an arm to a shoe above gear g
//    carriage .... y 131 .. 153, turns 20 deg per shift; 11 result wheels
//                  at r 50 and 6 counter wheels at r 36 under its windows
//    crank ....... on the drum shaft, one turn per drum turn
//
//  GREP MAP
//    function pascaline ....... base, cover, dials, axles, drums, sautoirs
//    function curta ........... case, drum, shafts, sliders, carriage, crank
//    function digitDrum ....... an open textured cylinder with two flanges
// ============================================================================
import * as THREE from 'three';
import { slab, rod, tube, lathe, shell, circle, merge, DIAL_STOP } from './kit.js';
import { unit, pascalPlan, pascalJob, pascalAt, curtaPlan, curtaJob, curtaAt, TAU } from './mech.js';

const D = Math.PI / 180;
const boxGeo = (x0, x1, y0, y1, z0, z1) => { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g; };
const rectShape = (x0, y0, x1, y1) => new THREE.Shape([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(p => new THREE.Vector2(...p)));
const rectPath = (x0, y0, x1, y1) => new THREE.Path([[x0, y0], [x0, y1], [x1, y1], [x1, y0]].map(p => new THREE.Vector2(...p)));
// a flat outline in (x, y) extruded along +z from z0
function plateZ(shape, z0, h, bevel = 0.4) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: h - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 24 });
  g.translate(0, 0, z0 + bevel);
  return g;
}
// a rod along local y at (x, z)
const pinAt = (r, x, z, y0, y1, seg = 12) => { const g = rod(r, y0, y1, seg); g.translate(x, 0, z); return g; };
// a digit drum about local y: open textured side y0 .. y1, a flange at each end
function digitDrum(B, p, r, y0, y1, fl = 1.4) {
  const side = new THREE.CylinderGeometry(r, r, y1 - y0, 48, 1, true); side.translate(0, (y0 + y1) / 2, 0);
  B.mesh(p, side, 'digits');
  B.mesh(p, merge([rod(r + fl, y0 - 1.2, y0, 48), rod(r + fl, y1, y1 + 1.2, 48)]), 'brass');
}
// a spur gear about local y: n teeth, root r0, tip r1
function spur(n, r0, r1, y0, h) {
  const s = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, w = TAU / n;
    const pts = [[r0, a], [r1, a + 0.18 * w], [r1, a + 0.45 * w], [r0, a + 0.62 * w]];
    pts.forEach(([r, b], k) => (i || k ? s.lineTo(r * Math.cos(b), r * Math.sin(b)) : s.moveTo(r * Math.cos(b), r * Math.sin(b))));
  }
  s.closePath();
  s.holes.push(circle(2.6));
  return slab(s, y0, h, 0.3);
}

// ── PASCALINE ───────────────────────────────────────────────────────────────
const SP = 56, AY = 34, DZ = 32, LIFT_AT0 = 160;
function pascaline(B, u) {
  const N = u.N, X = j => (2.5 - j) * SP, W = 180;
  // base: plate, walls, front posts under the axles
  const base = B.part('base', { info: 'base', label: 'Case', labelAt: [W - 20, 0, 58], explode: [0, -40, 0], st: 0, en: 0.5 });
  B.mesh(base, slab(rectShape(-W - 6, -76, W + 6, 72), -10, 10, 1), 'wood');
  const walls = [boxGeo(-W + 0.5, W - 0.5, -1, 60, -68, -58), boxGeo(-W, -W + 8, -1, 60, -58, 52), boxGeo(W - 8, W, -1, 60, -58, 52)];
  for (let j = 0; j < N; j++) walls.push(boxGeo(X(j) - 4, X(j) + 4, -1, AY - 2.6, 28, 34));
  B.mesh(base, merge(walls), 'wood');
  // cover: brass, one shaft hole and one drum window per stage
  const cover = B.part('cover', { info: 'cover', label: 'Cover', labelAt: [-W + 20, 66, -50], explode: [0, 90, 0], st: 0.05, en: 0.55 });
  const cs = rectShape(-W - 2, -66, W + 2, 70);
  // slab shape (x, s) -> world z = -s
  for (let j = 0; j < N; j++) { cs.holes.push(circle(5, X(j), -DZ)); cs.holes.push(rectPath(X(j) - 9, 31.5, X(j) + 9, 42.5)); }
  B.mesh(cover, slab(cs, 60, 4, 0.6), 'brass');
  for (let j = 0; j < N; j++) {
    const ring = new THREE.RingGeometry(21, 30, 64, 1); ring.rotateX(-Math.PI / 2); ring.translate(X(j), 64.4, DZ);
    B.mesh(cover, ring, 'dial', { shadow: false });
    // the stop finger, at the stop angle on the ring
    const a = DIAL_STOP * D, sx = X(j) + 26 * Math.cos(a), sz = DZ - 26 * Math.sin(a);
    B.mesh(cover, merge([pinAt(1.3, sx, sz, 63, 70.5), boxGeo(sx - 1.9, sx + 1.9, 69.6, 71.6, sz - 1.9, sz + 1.9)]), 'steel');
  }
  // per stage: dial, axle, drum; sautoir between stages
  const dials = [], axles = [], drums = [], sauts = [];
  for (let j = 0; j < N; j++) {
    const lab = j === 0, x = X(j);
    const dial = B.part('dial_' + j, { info: 'dial', label: lab ? 'Input dial' : null, labelAt: [0, 74, 0], at: [x, 0, DZ], explode: [0, 130, 0], st: 0, en: 0.5 });
    const g = [lathe([[[5, 65], [5, 72.5], [0, 72.5], [0, 65]]], 24), tube(17, 20.5, 66, 69, 64), rod(3, 40, 66, 16), lathe([[[13, 50], [13, 53], [0, 53], [0, 50]]], 40)];
    for (let k = 0; k < 10; k++) {
      const a = (DIAL_STOP + k * 36) * D, sp = boxGeo(4, 18, 66.6, 68.4, -1, 1);
      sp.rotateY(a); g.push(sp);
      const b = (k + 0.5) * 36 * D; g.push(pinAt(1.2, 10.5 * Math.cos(b), -10.5 * Math.sin(b), 40, 50.5, 10));
    }
    B.mesh(dial, merge(g.slice(0, 2).concat(g.slice(4).filter((_, i) => i % 2 === 0))), 'brass');
    B.mesh(dial, merge([g[2], g[3]].concat(g.slice(4).filter((_, i) => i % 2 === 1))), 'steel');
    dials.push(dial);

    const ax = B.part('axle_' + j, { info: 'wheel', label: lab ? 'Carry wheel' : null, labelAt: [0, -3, AY + 20], at: [x, AY, 0], u: [0, 0, 1], e0: [1, 0, 0], explode: [0, 0, 0], st: 0, en: 1 });
    B.mesh(ax, rod(2.5, -64, 34, 16), 'shaft');
    // lantern pinion: two disks and 10 rungs, local y = world z
    const lan = [rod(9, 17, 18.5, 32), rod(9, 25, 26.5, 32)];
    for (let k = 0; k < 10; k++) { const b = k * 36 * D; lan.push(pinAt(1, 7.2 * Math.cos(b), 7.2 * Math.sin(b), 18, 25.5, 8)); }
    B.mesh(ax, merge(lan), 'bronze');
    // carry wheel: disk, 10 drive pins on its front, one long lift pin
    B.mesh(ax, tube(2.5, 17, -4, 0, 48), 'brass');
    const pins = [];
    for (let k = 0; k < 10; k++) { const b = k * 36 * D; pins.push(pinAt(1.2, 14 * Math.cos(b), 14 * Math.sin(b), -1, 4, 10)); }
    B.mesh(ax, merge(pins), 'steel');
    B.mesh(ax, pinAt(1.6, 10, 0, -1, 15.5, 12), 'red');
    axles.push(ax);

    const dr = B.part('drum_' + j, { info: 'drum', label: lab ? 'Digit drum' : null, labelAt: [0, 44, 30], at: [x, AY, 0], u: [0, 0, -1], e0: [1, 0, 0], explode: [0, 0, -40], st: 0.3, en: 0.8 });
    digitDrum(B, dr, 22, 30.8, 43.2);
    drums.push(dr);

    if (j < N - 1) {
      // pivot on axle j + 1, arm toward axle j (+x)
      const z0 = j % 2 ? 10 : 4.5, h = 4;
      const sa = B.part('sautoir_' + j, { info: 'sautoir', label: j === 1 ? 'Sautoir (falling weight)' : null, labelAt: [24, 16, z0 + 4], at: [X(j + 1), AY, 0], explode: [0, 0, 50], st: 0.2, en: 0.7 });
      const s = new THREE.Shape();
      s.moveTo(0, -7); s.lineTo(44, -3.5); s.lineTo(47, -6); s.lineTo(49, -3.5); s.lineTo(49, 3); s.lineTo(0, 7);
      s.absarc(0, 0, 7, Math.PI / 2, 3 * Math.PI / 2, false);
      s.holes.push(circle(3.1));
      // the pawl: a hook on the hub toward the drive pins of wheel j + 1
      const pw = new THREE.Shape(); pw.moveTo(-3, -5); pw.lineTo(-11, -12); pw.lineTo(-14, -11); pw.lineTo(-13, -8); pw.lineTo(-6, -2); pw.lineTo(-3, -2);
      // the pawl plate is thinner than the hub it grows from: no shared face
      B.mesh(sa, merge([plateZ(s, z0, h), plateZ(pw, z0 + 0.6, h - 1.2, 0.2)]), 'steel');
      // pawl tooth reaches back to the plane of the drive pins
      const tooth = boxGeo(-13.4, -11.4, -11.6, -9.6, 1.2, z0 + 0.5);
      B.mesh(sa, tooth, 'steel');
      B.mesh(sa, boxGeo(20, 32, 2, 12, z0 - 1.5, z0 + h + 1.5), 'bolt');
      sauts.push(sa);
    }
  }
  const Zv = new THREE.Vector3(0, 0, 1);
  let P = pascalPlan(pascalJob('+', 999999, 1, N), N);
  return {
    setPlan(p) { P = p; },
    get plan() { return P; },
    pose(t) {
      const Q = pascalAt(P, t);
      for (let j = 0; j < N; j++) {
        const p = Q.pos[j];
        dials[j].spin(-p * 36 * D);
        axles[j].spin((LIFT_AT0 - p * 36) * D);
        drums[j].spin(-(p + 0.5) * 36 * D);
        if (j < N - 1) sauts[j].root.quaternion.setFromAxisAngle(Zv, -0.14 + 0.2 * Q.lift[j]);
      }
      return Q;
    },
    box: { c: [0, 32, 2], R: 0.6 * Math.hypot(2 * W + 12, 134, 80) },
    keys: { carry: [X(1) + 20, AY + 6, 8], dial: [X(0), 68, DZ], drum: [X(2), AY + 10, -37] },
  };
}

// ── CURTA ───────────────────────────────────────────────────────────────────
const RS = 38, DPHI = 20, PHI0 = -20;
const phiOf = g => (PHI0 - g * DPHI) * D;
const radial = (phi, r, y) => [r * Math.cos(phi), y, -r * Math.sin(phi)];
const levelY = s => 15 + 10 * s;
function curta(B, u) {
  const base = B.part('base', { info: 'base', label: 'Case', labelAt: [0, 60, 63], explode: [0, -50, 0], st: 0, en: 0.5 });
  B.mesh(base, lathe([[[60, 0], [60, 5], [0, 5], [0, 0]]], 72), 'black');
  // the shell rows break at the slot and window ends; shell() tests the
  // middle of each band, so the slots and the window are exact
  const slots = [];
  for (let g = 0; g < u.NS; g++) slots.push(phiOf(g) / D);
  const rows = [5, 14, 16, 117, 122, 128].map(y => ({ y, ro: 62, ri: 58 }));
  const near = (deg, a) => Math.abs((((deg - a) % 360) + 540) % 360 - 180) < 2.4;
  const inSlot = (y, f) => y > 14 && y < 117 && slots.some(a => near(f / D, a));
  const inWin = (y, f) => y > 16 && y < 122 && f / D > 5 && f / D < 135;
  // the shell casts no shadow, so the key light reaches the drum inside
  B.mesh(base, shell(rows, 180, (y, f) => inSlot(y, f) || inWin(y, f)), 'black', { shadow: false });
  // the top lip sits on the shell (its lower face meets the shell top face to face)
  B.mesh(base, tube(57.5, 63.5, 128, 130, 96), 'alu');

  // the stepped drum, one turn per crank turn
  const drum = B.part('drum', { info: 'drum', label: 'Stepped drum', labelAt: [0, 112, 0], explode: [0, 0, 0], st: 0, en: 1 });
  B.mesh(drum, merge([rod(24, 10, 121, 64), rod(4, 121, 166, 16)]), 'steel');
  const ribs = [];
  for (let k = 1; k <= 9; k++) { const r = boxGeo(23, 33, 110 - 10 * k, 115, -1.5, 1.5); r.rotateY((k - 1) * 16 * D); ribs.push(r); }
  B.mesh(drum, merge(ribs), 'brass');
  const carry = [];
  for (let j = 0; j < u.NR; j++) { const r = boxGeo(23, 27.5, 116.5 + 0.35 * j, 118.5 + 0.35 * j, -1.2, 1.2); r.rotateY((200 + 13 * j) * D); carry.push(r); }
  B.mesh(drum, merge(carry), 'red');

  // setting shafts, gears and sliders
  const shafts = [], gears = [], sliders = [];
  for (let g = 0; g < u.NS; g++) {
    const f = phiOf(g), at = radial(f, RS, 0), e0 = [Math.cos(f), 0, -Math.sin(f)], lab = g === 0;
    const sh = B.part('shaft_' + g, { info: 'shaft', label: null, at, explode: [...radial(f, 30, 0)], st: 0.4, en: 0.9 });
    B.mesh(sh, boxGeo(-1.6, 1.6, 10, 126, -1.6, 1.6), 'shaft');
    B.mesh(sh, spur(10, 3.2, 4.4, 126, 2.6), 'bronze');
    shafts.push(sh);
    const ge = B.part('gear_' + g, { info: 'setgear', label: lab ? 'Setting gear' : null, labelAt: [0, 3, 0], at, explode: [...radial(f, 30, 0)], st: 0.4, en: 0.9 });
    B.mesh(ge, spur(10, 4.4, 5.8, -2.5, 5), 'brass');
    gears.push(ge);
    const sl = B.part('slider_' + g, { info: 'slider', label: lab ? 'Setting slider' : null, labelAt: [66, 10, 0], at: [0, 0, 0], e0, explode: [...radial(f, 60, 0)], st: 0.3, en: 0.8 });
    // a shoe on the gear rim, an arm through the slot, a knob outside
    // (local +x points out)
    B.mesh(sl, merge([boxGeo(RS + 2.5, RS + 6.5, 2.9, 5.6, -2.4, 2.4), boxGeo(RS + 6, 63, 3.4, 5.2, -1.3, 1.3)]), 'steel');
    B.mesh(sl, merge([boxGeo(63, 68, -2, 9, -3, 3), boxGeo(67.4, 70, 0, 7, -2.2, 2.2)]), 'red');
    sliders.push(sl);
  }

  // the carriage with its result and counter wheels
  const car = B.part('carriage', { info: 'carriage', label: 'Carriage', labelAt: [0, 155, 58], explode: [0, 70, 0], st: 0.1, en: 0.6 });
  B.mesh(car, merge([tube(24, 63, 131, 134, 96), tube(60.5, 64, 133.5, 150, 96), tube(24.5, 27, 133.5, 150, 64)]), 'black');
  const top = new THREE.Shape(); top.absarc(0, 0, 64.6, 0, TAU, false); top.holes.push(circle(24.5));
  const win = (f, r0, r1, w) => { const c = Math.cos(f), s = Math.sin(f), t = [-s, c], n = [c, s]; return new THREE.Path([[r0, -w], [r1, -w], [r1, w], [r0, w]].reverse().map(([r, q]) => new THREE.Vector2(n[0] * r + t[0] * q, n[1] * r + t[1] * q))); };
  // slab shape (x, s) -> world z = -s: the angle phi of the shape is phi in the world
  for (let j = 0; j < u.NR; j++) top.holes.push(win(phiOf(j), 45.5, 54.5, 3.4));
  for (let j = 0; j < u.NC; j++) top.holes.push(win(phiOf(j), 32, 40, 2.6));
  B.mesh(car, slab(top, 150, 3, 0.5), 'alu');
  const res = [], cnt = [];
  // wheel axis radial and inward; local +Z is up, so the top digit reads
  // from outside the ring (rw radius, hl half length, fl flange)
  const wheel = (id, info, j, r, y, rw, hl, fl, lab) => {
    const f = phiOf(j), n = [Math.cos(f), 0, -Math.sin(f)], tg = [-Math.sin(f), 0, -Math.cos(f)];
    const p = B.part(id, { info, label: lab, labelAt: [0, 0, 9], parent: car.root, at: radial(f, r, y), u: n.map(v => -v), e0: tg, explode: [0, 26, 0], st: 0.5, en: 1 });
    digitDrum(B, p, rw, -hl, hl, fl);
    B.mesh(p, rod(1.2, -hl - 2.5, hl + 2.5, 10), 'shaft');
    return p;
  };
  for (let j = 0; j < u.NR; j++) res.push(wheel('res_' + j, 'result', j, 50, 143, 6, 3.5, 1.4, j === 0 ? 'Result wheels' : null));
  for (let j = 0; j < u.NC; j++) cnt.push(wheel('cnt_' + j, 'counter', j, 36, 145, 4.2, 2.5, 0.8, j === 0 ? 'Turn counter' : null));

  // crank on the drum shaft
  const crank = B.part('crank', { info: 'crank', label: 'Crank', labelAt: [50, 196, 0], explode: [0, 75, 0], st: 0.2, en: 0.7 });
  B.mesh(crank, merge([lathe([[[9, 156], [9, 164], [0, 164], [0, 156]]], 32), boxGeo(-6, 54, 163, 169, -5, 5)]), 'black');
  B.mesh(crank, merge([pinAt(3, 50, 0, 169, 178), lathe([[[5.5, 178], [6.5, 186], [5.5, 196], [0, 196], [0, 178]]], 24).translate(50, 0, 0)]), 'black');

  let P = curtaPlan(curtaJob('×', 4711, 23, u), u);
  return {
    setPlan(p) { P = p; },
    get plan() { return P; },
    pose(t) {
      const Q = curtaAt(P, t), a = -TAU * Q.drum;
      drum.spin(a); crank.spin(a);
      for (let g = 0; g < u.NS; g++) {
        const sp = Q.shaft[g] * 36 * D, y = levelY(Q.set[g]);
        shafts[g].spin(sp);
        gears[g].spin(sp); gears[g].root.position.y = y;
        sliders[g].root.position.y = y;
      }
      car.spin(Q.shift * DPHI * D);
      for (let j = 0; j < u.NR; j++) res[j].spin(-(Q.res[j] + 0.5) * 36 * D);
      for (let j = 0; j < u.NC; j++) cnt[j].spin(-(Q.cnt[j] + 0.5) * 36 * D);
      return Q;
    },
    box: { c: [0, 98, 0], R: 0.6 * Math.hypot(140, 200) },
    keys: { carry: [9, 112, -24], dial: [0, 138, 6], drum: [9, 70, -25] },
  };
}

export function build(B, id) {
  const u = unit(id);
  return id === 'curta' ? curta(B, u) : pascaline(B, u);
}

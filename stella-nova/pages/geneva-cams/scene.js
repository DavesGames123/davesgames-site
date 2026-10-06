// ============================================================================
//  GENEVA DRIVE & CAMS  ·  scene.js — the parts of each unit and their pose
// ----------------------------------------------------------------------------
//  build(B, id) makes one unit with kit.js and returns sc: { pose(theta),
//  box, keys }. Every outline comes from mech.js, so the slots, the pin,
//  the cam and the roller that main.js turns are the ones the tests check.
//
//  LAYOUT (mm; y up, the mechanisms lie flat on a base plate at y = 0)
//    Geneva .. star wheel centre at x = -a/2, driver centre at x = +a/2.
//      crank disc ......... y 14 .. 22, radius r + 14, carries the pin
//      pin ................ y 22 .. 40 at radius r on the driver
//      locking disc ....... y 24 .. 38 (the star's plane), with its relief
//      star wheel ......... y 24 .. 38, n slots and n concave arcs
//      turntable .......... y 62 .. 68 on the star shaft, n work stations
//      drive pulley ....... y 46 .. 56 on the driver shaft
//    Cam ..... cam centre at x = -60. The follower slides on +x.
//      cam disc ........... y 20 .. 34, keyed to its shaft
//      roller ............. y 21 .. 33 on a pin in the clevis
//      stem ............... along x at y = 27, through a guide bushing
//      spring ............. between the stem collar and the bushing:
//                           72 mm free, 34 mm at full lift, 6 turns of
//                           4 mm wire (solid at 24 mm)
//
//  GREP MAP
//    function shapeOf ......... a mech.js outline as a THREE.Shape
//    function genevaUnit ...... star, driver, plate, turntable
//    function camUnit ......... cam, follower, guide, spring
//    sc.pose .................. every part from one driver angle
// ============================================================================
import * as THREE from 'three';
import { slab, rod, tube, lathe, circle, hex, merge } from './kit.js';
import { unit, geneva, genevaPose, camProfile, camPose, TAU } from './mech.js';

function shapeOf(pts, holes = []) {
  const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  for (const h of holes) s.holes.push(h);
  return s;
}
const rect = (x0, y0, x1, y1) => shapeOf([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const boxGeo = (x0, x1, y0, y1, z0, z1) => { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g; };

// the base plate with its two bosses, shared by both kinds
function basePlate(B, w, d, cx, bosses) {
  const p = B.part('base', { info: 'base', label: 'Base plate', labelAt: [cx + w / 2 - 30, 0, d / 2 - 20], explode: [0, -60, 0], st: 0, en: 0.5 });
  const plate = slab(shapeOf([[cx - w / 2, -d / 2], [cx + w / 2, -d / 2], [cx + w / 2, d / 2], [cx - w / 2, d / 2]], bosses.map(([x, r]) => circle(r, x, 0))), -12, 12, 1.2);
  B.mesh(p, plate, 'paint');
  for (const [x, r] of bosses) {
    const g = tube(r, r + 9, 0, 10, 48); g.translate(x, 0, 0); B.mesh(p, g, 'cast');
  }
  return p;
}

function genevaUnit(B, u) {
  const G = geneva(u), a = G.a, xs = -a / 2, xd = a / 2;
  basePlate(B, a + 2 * G.R2 + 60, 2 * Math.max(G.R2, G.r + 14) + 50, 0, [[xs, 11], [xd, 11]]);

  // star wheel and its shaft
  const star = B.part('star', { info: 'star', label: `Star wheel, ${G.n} slots`, labelAt: [0, 40, 0], at: [xs, 0, 0], explode: [0, 70, 0], st: 0.2, en: 0.8 });
  B.mesh(star, slab(shapeOf(G.star, [circle(10)]), 24, 14, 0.8), 'steel');
  B.mesh(star, lathe([[[10, 38], [20, 38], [20, 46], [10, 46]]], 48), 'steel');
  const sshaft = B.part('starShaft', { info: 'shaft', at: [xs, 0, 0], explode: [0, 70, 0], st: 0.2, en: 0.8 });
  B.mesh(sshaft, rod(10, -12, 62, 32), 'shaft');
  const table = B.part('table', { info: 'table', label: 'Index table', labelAt: [0, 70, 0], at: [xs, 0, 0], explode: [0, 150, 0], st: 0.4, en: 1 });
  B.mesh(table, lathe([[[70, 62], [70, 68], [12, 68], [12, 62]]], 96), 'alu');
  for (let j = 0; j < G.n; j++) {
    const g = boxGeo(-9, 9, 68, 84, -9, 9), t = TAU * j / G.n + Math.PI / G.n;
    g.translate(54 * Math.cos(t), 0, -54 * Math.sin(t));
    B.mesh(table, g, j === 0 ? 'red' : 'brass');
  }

  // driver: crank disc, pin, locking disc, hub, shaft, pulley
  const drv = B.part('driver', { info: 'crank', label: 'Driver crank', labelAt: [G.r * 0.5, 22, 0], at: [xd, 0, 0], explode: [0, 30, 0], st: 0, en: 0.6 });
  B.mesh(drv, slab(shapeOf(Array.from({ length: 96 }, (_, i) => [(G.r + 14) * Math.cos(TAU * i / 96), (G.r + 14) * Math.sin(TAU * i / 96)]), [circle(10)]), 14, 8, 0.8), 'gear');
  const pin = B.part('pin', { info: 'pin', label: 'Drive pin', labelAt: [G.r, 44, 0], parent: drv.root, explode: [0, 18, 0], st: 0.3, en: 0.9 });
  const pg = rod(u.pinR, 22, 40, 32); pg.translate(G.r, 0, 0); B.mesh(pin, pg, 'steel');
  const pr = tube(u.pinR, u.pinR + 3, 20, 22.5, 32); pr.translate(G.r, 0, 0); B.mesh(pin, pr, 'steel');
  const lock = B.part('lock', { info: 'lock', label: 'Locking disc', labelAt: [-G.Rl * 0.6, 40, 0], parent: drv.root, explode: [0, 36, 0], st: 0.3, en: 0.9 });
  B.mesh(lock, slab(shapeOf(G.lock, [circle(10)]), 24, 14, 0.8), 'brass');
  B.mesh(lock, lathe([[[10, 22], [22, 22], [22, 24], [10, 24]]], 48), 'brass');
  const dshaft = B.part('driverShaft', { info: 'shaft', at: [xd, 0, 0], explode: [0, 30, 0], st: 0, en: 0.6 });
  B.mesh(dshaft, rod(10, -12, 58, 32), 'shaft');
  const pul = B.part('pulley', { info: 'pulley', label: 'Drive pulley', labelAt: [30, 56, 0], at: [xd, 0, 0], explode: [0, 110, 0], st: 0.3, en: 1 });
  B.mesh(pul, lathe([[[34, 46], [30, 49], [30, 53], [34, 56], [12, 56], [12, 46]]], 64), 'bronze');
  B.mesh(pul, hex(7, 56, 4), 'bolt');

  const keys = { star: [xs, 31, 0], driver: [xd, 18, 0] };
  return {
    pose(theta) {
      const Q = genevaPose(G, theta);
      drv.spin(theta); dshaft.spin(theta); pul.spin(theta);
      star.spin(Q.psi); sshaft.spin(Q.psi); table.spin(Q.psi);
      return Q;
    },
    box: { c: [0, 30, 0], R: 0.62 * (a + 2 * G.R2 + 60) },
    keys, G,
  };
}

function camUnit(B, u) {
  const xc = -60, prof = camProfile(u, 720), xf0 = xc + u.Rb + u.Rr;
  basePlate(B, 380, 200, 40, [[xc, 11]]);
  // cam, hub, shaft, pulley
  const cam = B.part('cam', { info: 'cam', label: 'Disc cam', labelAt: [-30, 40, 0], at: [xc, 0, 0], explode: [0, 60, 0], st: 0.2, en: 0.8 });
  B.mesh(cam, slab(shapeOf(prof, [circle(10)]), 20, 14, 0.8), 'steel');
  B.mesh(cam, lathe([[[10, 34], [20, 34], [20, 42], [10, 42]]], 48), 'steel');
  const key = boxGeo(8, 14, 20.5, 34, -3, 3); B.mesh(cam, key, 'bolt');
  const cshaft = B.part('camShaft', { info: 'shaft', at: [xc, 0, 0], explode: [0, 60, 0], st: 0.2, en: 0.8 });
  B.mesh(cshaft, rod(10, -12, 60, 32), 'shaft');
  const pul = B.part('pulley', { info: 'pulley', label: 'Drive pulley', labelAt: [30, 58, 0], at: [xc, 0, 0], explode: [0, 120, 0], st: 0.3, en: 1 });
  B.mesh(pul, lathe([[[34, 48], [30, 51], [30, 55], [34, 58], [12, 58], [12, 48]]], 64), 'bronze');
  B.mesh(pul, hex(7, 58, 4), 'bolt');

  // follower: roller, clevis, stem, collar (they slide on +x together)
  const fol = B.part('follower', { info: 'stem', label: 'Follower', labelAt: [120, 36, 0], at: [xf0, 0, 0], explode: [70, 0, 0], st: 0.1, en: 0.7 });
  const roller = B.part('roller', { info: 'roller', label: 'Roller', labelAt: [0, 40, 0], parent: fol.root, explode: [-30, 30, 0], st: 0.3, en: 0.9 });
  B.mesh(roller, lathe([[[u.Rr, 21], [u.Rr, 33], [4, 33], [4, 21]]], 48), 'steel');
  B.mesh(fol, rod(4, 15.5, 38.5, 16), 'bolt');
  B.mesh(fol, merge([boxGeo(-u.Rr - 4, 34, 16, 20, -11, 11), boxGeo(-u.Rr - 4, 34, 34, 38, -11, 11), boxGeo(u.Rr + 6, 34, 20, 34, -11, 11)]), 'gear');
  const stem = rod(8, 0, 150, 24); stem.rotateZ(-Math.PI / 2); stem.translate(34, 27, 0); B.mesh(fol, stem, 'shaft');
  const collar = tube(8, 16, 0, 8, 32); collar.rotateZ(-Math.PI / 2); collar.translate(40, 27, 0); B.mesh(fol, collar, 'bolt');
  // guide: bushing on a bracket, fixed to the base plate
  const xg = xf0 + 120;
  const guide = B.part('guide', { info: 'guide', label: 'Guide bushing', labelAt: [xg + 25, 50, 0], explode: [0, 40, 0], st: 0, en: 0.5 });
  const bush = tube(8.5, 15, 0, 50, 40); bush.rotateZ(-Math.PI / 2); bush.translate(xg, 27, 0); B.mesh(guide, bush, 'bronze');
  B.mesh(guide, merge([boxGeo(xg + 4, xg + 46, 0, 14, -20, 20), boxGeo(xg + 4, xg + 46, 14, 20, -9, 9)]), 'cast');
  // spring: a helix of wire about local y, scaled along its axis each frame
  const springP = B.part('spring', { info: 'spring', label: 'Return spring', labelAt: [0, 30, 0], at: [xf0 + 48, 27, 0], u: [1, 0, 0], e0: [0, 1, 0], explode: [0, 50, 0], st: 0.2, en: 0.8 });
  const L0 = 72, turns = 6, pts = [];
  for (let i = 0; i <= turns * 32; i++) { const t = i / 32 * TAU; pts.push(new THREE.Vector3(13 * Math.cos(t), L0 * i / (turns * 32), -13 * Math.sin(t))); }
  const helix = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 48, 2, 8, false);
  const sm = B.mesh(springP, helix, 'spring');

  return {
    pose(theta) {
      const P = camPose(u, theta);
      cam.spin(theta); cshaft.spin(theta); pul.spin(theta);
      fol.root.position.x = xf0 + P.s;
      roller.spin(-theta * (u.Rb + 0.5 * u.h) / u.Rr);
      // the spring runs from the collar face to the bushing face
      springP.root.position.x = xf0 + P.s + 48;
      sm.scale.y = (xg - (xf0 + P.s + 48)) / L0;
      return P;
    },
    box: { c: [40, 30, 0], R: 240 },
    keys: { cam: [xc, 27, 0], roller: [xf0, 27, 0] },
  };
}

export function build(B, id) {
  const u = unit(id);
  return u.n ? genevaUnit(B, u) : camUnit(B, u);
}

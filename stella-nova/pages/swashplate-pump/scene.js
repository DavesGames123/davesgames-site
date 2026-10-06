// ============================================================================
//  SWASHPLATE PISTON PUMP  ·  scene.js — the parts of one pump and their pose
// ----------------------------------------------------------------------------
//  build(B, id) makes one pump with kit.js and returns sc: { pose(th, b),
//  box, keys }. The piston places, the slipper ellipse, the retainer holes,
//  the barrel ports and the valve plate kidneys come from mech.js, so the
//  parts that main.js moves are the ones that tests.mjs checks.
//
//  LAYOUT (mm; the shaft on world +x, y up, the base below)
//    coupling ........... x -112 .. -88, on the shaft end
//    front bearing ...... x -72 .. -48, a boss on a pedestal
//    swashplate ......... face through the origin, turns about z by b;
//                         body 14 mm behind the face, trunnions on z at
//                         |z| 70 .. 100 in two cradle blocks (|z| 78 .. 96)
//    slippers, retainer . on the face (plate frame), flange 0.3 .. 4.3 mm,
//                         retainer ring 5.4 .. 8.4 mm above the face
//    pistons ............ ball centre at x_ball, body to x_ball + 70
//    cylinder barrel .... bores x 36 .. 99.6, port section 99.6 .. 110
//    valve plate ........ x 110.4 .. 118, two kidneys; it explodes up and
//                         back, so the kidneys show clear of the barrel
//    port block ......... x 118.4 .. 152, suction pipe on -z, delivery on +z
//    base plate ......... y -92 .. -80; pedestals start 1 mm into it
//  BEVELS. kit.js slab() pushes the side walls out by the bevel: an outline
//  grows and a hole shrinks by it. Each slab here draws its outline the
//  bevel smaller and its holes the bevel larger, so the walls are at the
//  mech.js sizes (the bore 8.3 mm round an 8 mm piston, the retainer hole
//  6.5 mm). The caps then show a chamfer at each hole.
//  No two faces of different parts lie in one plane and face the same way:
//  each stack has a 0.3 mm or larger step, or one solid goes into the
//  other. node tools/zfight-check.mjs swashplate-pump checks it.
//
//  GREP MAP
//    function shapeOf ......... a mech.js outline as a THREE.Shape
//    function alongX .......... turn a local-Y geometry onto world x
//    export function build .... base, shaft, swash, slippers, pistons,
//                               barrel, valve plate, port block, pose
// ============================================================================
import * as THREE from 'three';
import { slab, rod, tube, lathe, poly, circle, hex, merge } from './kit.js';
import { unit, LAYOUT as L, TAU, xBall, slipperAt, kidney, retainerR, pumpPose } from './mech.js';

function shapeOf(pts, holes = []) {
  const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  for (const h of holes) s.holes.push(h);
  return s;
}
const pathOf = pts => new THREE.Path(pts.map(p => new THREE.Vector2(p[0], p[1])));
const disc = (r, n = 96) => Array.from({ length: n }, (_, i) => [r * Math.cos(TAU * i / n), r * Math.sin(TAU * i / n)]);
const boxGeo = (x0, x1, y0, y1, z0, z1) => { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g; };
// a geometry made about local Y, turned so that local Y runs on world +x
const alongX = g => { g.rotateZ(-Math.PI / 2); return g; };
// a geometry made about local Y, turned so that local Y runs on world +z
const alongZ = g => { g.rotateX(Math.PI / 2); return g; };
const X = { u: [1, 0, 0], e0: [0, 1, 0] };

export function build(B, id) {
  const u = unit(id), N = u.N, Rp = u.Rp;

  // ── base: plate, front bearing pedestal, two cradle blocks ───────────────
  const base = B.part('base', { info: 'base', label: 'Base and cradle', labelAt: [140, -80, 90], explode: [0, -70, 0], st: 0, en: 0.5 });
  B.mesh(base, slab(shapeOf([[-125, 105], [165, 105], [165, -105], [-125, -105]]), -92, 12, 1.2), 'paint');
  B.mesh(base, merge([boxGeo(-68, -52, -81, -14, -28, 28), alongX(tube(13, 26, -72, -48, 48))]), 'cast');
  const cradle = new THREE.Shape();
  cradle.moveTo(-22, -81); cradle.lineTo(22, -81); cradle.lineTo(22, 0); cradle.absarc(0, 0, 22, 0, Math.PI, false); cradle.lineTo(-22, -81);
  cradle.holes.push(circle(10.4 + 0.8));
  for (const z0 of [78, -96]) B.mesh(base, alongZ(slab(cradle, z0, 18, 0.8)), 'cast');

  // ── shaft and coupling ────────────────────────────────────────────────────
  const shaft = B.part('shaft', { info: 'shaft', ...X, explode: [-120, 0, 0], st: 0.1, en: 0.7 });
  B.mesh(shaft, rod(12, -104, 116, 40), 'shaft');
  const coup = B.part('coupling', { info: 'coupling', label: 'Drive coupling', labelAt: [0, -112, 34], ...X, explode: [-150, 0, 0], st: 0.1, en: 0.7 });
  B.mesh(coup, lathe([[[32, -112], [32, -100]], [[20, -100], [20, -88]], [[12.4, -88]], [[12.4, -112]]], 64), 'bronze');
  for (let k = 0; k < 4; k++) { const a = TAU * k / 4 + Math.PI / 4, g = hex(4.5, -116, 4.3); g.translate(24 * Math.cos(a), 0, -24 * Math.sin(a)); B.mesh(coup, g, 'bolt'); }

  // ── swashplate (plate frame: local Y = face normal, local X = e1) ─────────
  const swash = B.part('swash', { info: 'swash', label: 'Swashplate', labelAt: [-62, 0, 0], ...X, explode: [-50, 0, 0], st: 0.15, en: 0.75 });
  B.mesh(swash, tube(22, L.plateR, -14, -4, 96), 'cast');
  B.mesh(swash, tube(23, L.plateR - 2, -4.3, 0, 96), 'plate');
  // ears and trunnions on local z (= world -z): the tilt axis is the z axis
  const ear = (z0, z1, t0, t1) => merge([boxGeo(-16, 16, -16.5, 11, z0, z1), alongZ(rod(10, t0, t1, 32))]);
  B.mesh(swash, ear(60, 74, 70, 100), 'cast'); B.mesh(swash, ear(-74, -60, -100, -70), 'cast');

  // retainer: a rigid ring that turns with the barrel, on the plate
  const Rr = retainerR(u);
  const ret = B.part('retainer', { info: 'retainer', label: 'Retainer plate', labelAt: [0, 9, -Rr - 14], parent: swash.root, explode: [0, 26, 0], st: 0.35, en: 0.95 });
  B.mesh(ret, slab(shapeOf(disc(Rr + 14 - 0.5), [circle(Rr - 14 + 0.5), ...Array.from({ length: N }, (_, i) => circle(u.hole + 0.5, Rr * Math.cos(TAU * i / N), Rr * Math.sin(TAU * i / N)))]), 5.4, 3, 0.5), 'alu');
  // slippers: a bronze flange, a neck through the retainer, a cup on the ball
  const slipGeo = () => poly([[u.flange - 0.8, 0.3], [u.flange, 1.1], [u.flange, 3.5], [u.flange - 0.8, 4.3], [u.neck, 4.3], [u.neck, 9.6], [7.5, 9.6], [7.5, u.hs + L.cupTop - 1], [6.5, u.hs + L.cupTop], [0, u.hs + L.cupTop], [0, 0.3]], 40);
  const slippers = [];
  for (let i = 0; i < N; i++) {
    const p = B.part('slipper' + i, { info: 'slipper', label: i === 0 ? 'Slipper' : null, labelAt: [0, 12, 0], parent: swash.root, explode: [0, 26, 0], st: 0.35, en: 0.95 });
    B.mesh(p, slipGeo(), 'bronze');
    slippers.push(p);
  }

  // ── pistons (world, along +x from the ball centre) ───────────────────────
  const pistons = [];
  for (let i = 0; i < N; i++) {
    const p = B.part('piston' + i, { info: 'piston', label: i === 0 ? 'Piston' : null, labelAt: [0, 40, 0], ...X, explode: [30, 0, 0], st: 0.25, en: 0.85 });
    const ball = new THREE.SphereGeometry(6, 24, 16);
    B.mesh(p, merge([ball, rod(3.5, 0, L.pist0 + 1, 20), poly([[6.5, L.pist0], [8, L.pist0 + 1.5], [8, L.pist1 - 1.5], [7, L.pist1], [0, L.pist1], [0, L.pist0]], 40)]), 'steel');
    pistons.push(p);
  }

  // ── cylinder barrel (cut: the top half can be clipped to show the bores) ─
  const barrel = B.part('barrel', { info: 'barrel', label: 'Cylinder barrel', labelAt: [0, 74, L.barrelR + 6], ...X, cut: true, explode: [90, 0, 0], st: 0.2, en: 0.8 });
  const bores = Array.from({ length: N }, (_, i) => circle(L.boreR + 1.2, Rp * Math.cos(TAU * i / N), Rp * Math.sin(TAU * i / N)));
  B.mesh(barrel, slab(shapeOf(disc(L.barrelR - 1.2), [circle(12.4 + 1.2), ...bores]), L.barrel0, 100 - L.barrel0, 1.2), 'gear');
  const ports = Array.from({ length: N }, (_, i) => { const a = TAU * i / N; return pathOf(kidney(Rp, a - u.pa, a + u.pa, u.pw + 0.6, 8)); });
  B.mesh(barrel, slab(shapeOf(disc(L.barrelR - 3.6), [circle(14 + 0.6), ...ports]), L.boreEnd, L.barrel1 - L.boreEnd, 0.6), 'bronze');

  // ── valve plate and port block (fixed) ────────────────────────────────────
  const valve = B.part('valve', { info: 'valve', label: 'Valve plate', labelAt: [0, L.valve1, -L.barrelR], ...X, explode: [110, 100, 0], st: 0.3, en: 0.9 });
  const kD = pathOf(kidney(Rp, u.bh, Math.PI - u.bh, u.kw + 0.5, 40)), kS = pathOf(kidney(Rp, Math.PI + u.bh, TAU - u.bh, u.kw + 0.5, 40));
  B.mesh(valve, slab(shapeOf(disc(L.barrelR - 2.5), [circle(12.4 + 0.5), kD, kS]), L.valve0, L.valve1 - L.valve0, 0.5), 'brass');
  const block = B.part('block', { info: 'block', label: 'Port block', labelAt: [152, 62, 0], explode: [170, 0, 0], st: 0.4, en: 1 });
  B.mesh(block, merge([boxGeo(118.4, 152, -62, 62, -62, 62), boxGeo(122, 150, -81, -60, -50, 50)]), 'cast');
  for (const [y, z] of [[-48, -48], [-48, 48], [48, -48], [48, 48]]) { const g = alongX(hex(5.5, 151.7, 5)); g.translate(0, y, z); B.mesh(block, g, 'bolt'); }
  // pipes: z0 is inside the block; a dark cap fills each bore 10 mm in
  const pipe = (s, ri, ro, info, label, mat) => {
    const p = B.part(info, { info, label, labelAt: [135, 30, s * 100], explode: [170, 0, s * 40], st: 0.4, en: 1 });
    const zs = s > 0 ? [58, 92] : [-92, -58], zf = s > 0 ? [89, 95] : [-95, -89], zc = s > 0 ? [66, 68] : [-68, -66];
    const g = merge([alongZ(tube(ri, ro, zs[0], zs[1], 40)), alongZ(tube(ro - 0.5, ro + 8, zf[0], zf[1], 40))]); g.translate(135, 0, 0); B.mesh(p, g, mat);
    const c = alongZ(rod(ri - 0.4, zc[0], zc[1], 32)); c.translate(135, 0, 0); B.mesh(p, c, 'rubber');
  };
  pipe(-1, 15, 20, 'inlet', 'Suction port', 'spring');
  pipe(1, 9, 14, 'outlet', 'Delivery port', 'red');

  const qz = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1);
  return {
    pose(th, b = u.b0) {
      const P = pumpPose(u, th, b);
      qz.setFromAxisAngle(Z, b); swash.root.quaternion.copy(qz).multiply(swash.q0);
      ret.root.position.set(-u.hs * Math.tan(b), 0, 0); ret.spin(th);
      for (let i = 0; i < N; i++) {
        const q = P.pistons[i], s = slipperAt(u, q.phi, b);
        slippers[i].root.position.set(s[0], 0, -s[1]); slippers[i].spin(q.phi);
        pistons[i].root.position.set(q.x, Rp * Math.cos(q.phi), Rp * Math.sin(q.phi)); pistons[i].spin(q.phi);
      }
      barrel.spin(th); shaft.spin(th); coup.spin(th);
      return P;
    },
    box: { c: [18, -12, 0], R: 195 },
    keys: { pistons: [18, 10, 0], ports: [114, 0, 0], swash: [0, 0, 0] },
  };
}

// ============================================================================
//  MANUAL GEARBOX  ·  scene.js — the parts of the gearbox and their pose
// ----------------------------------------------------------------------------
//  build(B) makes the gearbox with kit.js and teeth.js and returns sc:
//  { pose(st), box, keys }. Every size and place comes from box.js, so the
//  teeth that main.js turns with box.angles() are the teeth the tests check.
//
//  LAYOUT (mm; the main shaft on x, y up, the layshaft at y = -90)
//    input shaft ...... x -130 .. 30, the input gear at x 0 .. 18
//    main shaft ....... x 20 .. 270, free gears 3, 2, 1, 5 and three hubs
//    layshaft ......... x -10 .. 176, the cluster of five gears
//    dog rings ........ 4 mm rings on each free gear face toward its hub,
//                       with a 3 mm synchro cone beside them (clear of
//                       the hubs, which start 1 mm further on)
//    sleeves .......... on the hubs; each has a groove for its fork
//    forks, rails ..... above the main shaft; a rail slides with its fork
//    lever ............ on top, its ball at (110, 120, 0)
//    case ............. cut at y = 0 (kit section hatch), bearing bosses
//  Gear parts: u = +x. Main-shaft gears have e0 = -y (tooth 0 toward the
//  layshaft), layshaft gears e0 = +y, as box.js assumes.
//
//  GREP MAP
//    function gearGeo ........ an involute spur gear, bore, face width
//    function dogRing ........ dog teeth and a synchro cone on one face
//    function build .......... shafts, gears, hubs, sleeves, forks, case
//    sc.pose ................. every part from one state
// ============================================================================
import * as THREE from 'three';
import { slab, rod, tube, lathe, poly, circle, merge } from './kit.js';
import { outline } from './teeth.js';
import { SPEC, M, CD, angles } from './box.js';

const shapeOf = (pts, holes = []) => { const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))); for (const h of holes) s.holes.push(h); return s; };
function gearGeo(N, w, bore) {
  const pts = outline(N, N, M, { ha: 1, hf: 1.25 }).map(([r, p]) => [r * Math.cos(p), r * Math.sin(p)]);
  return slab(shapeOf(pts, [circle(bore)]), 0, w, 0.3);
}
// dogs on the face at local y = at (toward +y if dir > 0), a cone beyond
function dogRing(at, dir, bore) {
  const pts = outline(16, 16, 2.6, { ha: 0.7, hf: 0.7, t: 0.4 }).map(([r, p]) => [r * Math.cos(p), r * Math.sin(p)]);
  const y0 = dir > 0 ? at : at - 4;
  const dogs = slab(shapeOf(pts, [circle(bore)]), y0, 4, 0.3);
  return dogs;
}
const along = g => { g.rotateZ(-Math.PI / 2); return g; };   // local y -> world x
const boxGeo = (x0, x1, y0, y1, z0, z1) => { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g; };

export function build(B) {
  const MAIN = { u: [1, 0, 0], e0: [0, -1, 0] }, LAY = { u: [1, 0, 0], e0: [0, 1, 0] };
  const P = {};

  // case, cut at y = 0
  const cs = B.part('case', { info: 'case', label: 'Gearbox case', labelAt: [100, -150, 100], explode: [0, -120, 0], st: 0, en: 0.5, cut: true });
  B.mesh(cs, merge([boxGeo(-34, 236, -158, -150, -100, 100), boxGeo(-34, 236, -150, 60, 92, 100), boxGeo(-34, 236, -150, 60, -100, -92), boxGeo(-34, -26, -150, 60, -92, 92), boxGeo(228, 236, -150, 60, -92, 92)]), 'cast');
  for (const [x, y] of [[-30, 0], [232, 0], [-30, -CD], [232, -CD]]) { const g = along(tube(16, 30, -16, 16, 40)); g.translate(x, y, 0); B.mesh(cs, g, 'cast'); }

  // shafts
  P.inShaft = B.part('inShaft', { info: 'inShaft', label: 'Input shaft', labelAt: [0, -110, 0], at: [SPEC.inShaft[0], 0, 0], ...MAIN, explode: [-80, 0, 0], st: 0.2, en: 0.8 });
  B.mesh(P.inShaft, rod(14, 0, SPEC.inShaft[1] - SPEC.inShaft[0], 32), 'shaft');
  B.mesh(P.inShaft, gearGeo(SPEC.input.N, 18, 13.9).translate(0, 130, 0), 'gear');
  B.mesh(P.inShaft, dogRing(130 + 18, 1, 13.9), 'steel');
  P.mainShaft = B.part('mainShaft', { info: 'mainShaft', label: 'Main shaft', labelAt: [0, 230, 0], at: [SPEC.main[0], 0, 0], ...MAIN, explode: [0, 0, 0] });
  // the nose (x 20 .. 30) runs inside the input shaft: a thinner pilot, so
  // the two r 14 rods do not share a surface where they overlap
  const nose = SPEC.inShaft[1] - SPEC.main[0];
  B.mesh(P.mainShaft, poly([[10, 0], [10, nose], [14, nose], [14, SPEC.main[1] - SPEC.main[0]], [0, SPEC.main[1] - SPEC.main[0]], [0, 0]], 32), 'shaft');
  B.mesh(P.mainShaft, lathe([[[40, 236], [40, 250], [14, 250], [14, 236]]], 48), 'steel');
  P.lay = B.part('lay', { info: 'lay', label: 'Layshaft cluster', labelAt: [0, 120, 0], at: [SPEC.lay[0], -CD, 0], ...LAY, explode: [0, -70, 0], st: 0.1, en: 0.7 });
  B.mesh(P.lay, rod(13, 0, SPEC.lay[1] - SPEC.lay[0], 32), 'shaft');
  // lay gears are 0.6 mm wider than their mates (0.3 mm each side), so the
  // end faces of a meshed pair are not in one plane
  const layGear = (N, x) => B.mesh(P.lay, gearGeo(N, 18.6, 12.9).translate(0, x[0] - SPEC.lay[0] - 0.3, 0), 'gear');
  layGear(SPEC.layIn.N, SPEC.input.x);
  for (const g in SPEC.pairs) layGear(SPEC.pairs[g].lay, SPEC.pairs[g].x);

  // free gears on the main shaft, each with dogs toward its hub
  const hubOf = { 1: -1, 2: 1, 3: -1, 5: 1 };   // the dog face: -1 = -x side
  for (const g in SPEC.pairs) {
    const p = SPEC.pairs[g], d = hubOf[g];
    P['g' + g] = B.part('g' + g, { info: 'gear' + g, label: `${g}${['', 'st', 'nd', 'rd', 'th', 'th'][g]} gear`, labelAt: [0, 9, p.main * M / 2 + 8], at: [p.x[0], 0, 0], ...MAIN, explode: [0, 90 + 12 * +g, 0], st: 0.3, en: 0.9 });
    B.mesh(P['g' + g], gearGeo(p.main, 18, 15), g === '1' ? 'ring' : 'gear');
    B.mesh(P['g' + g], dogRing(d > 0 ? 18 : 0, d, 15), 'steel');
    // synchro cone beyond the dogs
    const c0 = d > 0 ? 22 : -7, c1 = d > 0 ? 25 : -4;
    B.mesh(P['g' + g], lathe([[[21, c0], [d > 0 ? 18 : 21, c1], [15, c1], [15, c0]]], 40), 'brass');
  }
  // hubs, sleeves, forks, rails
  const railZ = { h12: -26, h34: 0, h5: 26 };
  for (const [h, H] of Object.entries(SPEC.hubs)) {
    P[h] = B.part(h, { info: 'hub', at: [H.x - H.w / 2, 0, 0], ...MAIN, explode: [0, 60, 0], st: 0.3, en: 0.9 });
    B.mesh(P[h], tube(14, 26, 0, H.w, 48), 'steel');
    P['s' + h] = B.part('s' + h, { info: 'sleeve', label: { h12: '1–2 sleeve', h34: '3–4 sleeve', h5: '5th sleeve' }[h], labelAt: [0, H.w / 2, 40], at: [H.x - H.w / 2, 0, 0], ...MAIN, explode: [0, 150, 0], st: 0.3, en: 0.9 });
    B.mesh(P['s' + h], lathe([[[36, 0], [36, 5], [31, 5], [31, 11], [36, 11], [36, H.w], [26.3, H.w], [26.3, 0]]], 64), 'plate');
    // fork: a half ring in the groove and an arm up to its rail
    P['f' + h] = B.part('f' + h, { info: 'fork', label: null, at: [H.x, 0, 0], explode: [0, 210, 0], st: 0.4, en: 1 });
    const half = new THREE.TorusGeometry(33.5, 3, 8, 32, Math.PI); half.rotateY(Math.PI / 2); B.mesh(P['f' + h], half, 'bronze');
    B.mesh(P['f' + h], boxGeo(-2.7, 2.7, 33, 70, railZ[h] - 4, railZ[h] + 4), 'bronze');   // 0.3 mm in from the bar faces
    B.mesh(P['f' + h], merge([boxGeo(-3, 3, 30, 40, -36, 36)]), 'bronze');
    P['r' + h] = B.part('r' + h, { info: 'rail', at: [H.x, 70, railZ[h]], explode: [0, 210, 0], st: 0.4, en: 1 });
    const rr = along(rod(5, -150, 120, 16)); B.mesh(P['r' + h], rr, 'shaft');
    // the finger is 0.5 mm clear of each side of the r 6 lever rod
    const finger = boxGeo(-6.5, 6.5, 4, 20, -5, 5); finger.translate(110 - H.x, 0, 0); B.mesh(P['r' + h], finger, 'steel');
  }
  // lever: a ball, a rod and a knob; it pivots at (110, 120, 0)
  P.lever = B.part('lever', { info: 'lever', label: 'Gear lever', labelAt: [0, 210, 0], at: [110, 120, 0], explode: [0, 260, 0], st: 0.5, en: 1 });
  B.mesh(P.lever, new THREE.SphereGeometry(14, 24, 16), 'steel');
  B.mesh(P.lever, rod(6, -40, 180, 20), 'bolt');
  const knob = new THREE.SphereGeometry(20, 28, 18); knob.scale(1, 0.85, 1); knob.translate(0, 190, 0); B.mesh(P.lever, knob, 'rubber');

  const hubX = Object.fromEntries(Object.entries(SPEC.hubs).map(([h, H]) => [h, H.x]));
  return {
    // st = { thIn, thOut, sx: { h12, h34, h5 }, lever: [ax, az] radians }
    pose(st) {
      const A = angles(st.thIn);
      P.inShaft.spin(A.input); P.lay.spin(A.lay);
      for (const g in SPEC.pairs) P['g' + g].spin(A.main[g]);
      P.mainShaft.spin(st.thOut);
      for (const h in SPEC.hubs) {
        P[h].spin(st.thOut);
        P['s' + h].spin(st.thOut);
        const x = st.sx[h] || 0;
        P['s' + h].root.position.x = hubX[h] - SPEC.hubs[h].w / 2 + x;
        P['f' + h].root.position.x = hubX[h] + x;
        P['r' + h].root.position.x = hubX[h] + x;
      }
      P.lever.root.rotation.set(st.lever[1], 0, st.lever[0]);
      return A;
    },
    box: { c: [100, -20, 0], R: 230 },
    keys: { input: [9, 0, 0], lay: [80, -CD, 0], lever: [110, 300, 0] },
    P,
  };
}

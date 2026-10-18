// ============================================================================
//  CORAL REEF  ·  ROV model tests (node, no browser):  node tests/rov-model.test.mjs
// ----------------------------------------------------------------------------
//  The user (2026-10-18): "i would love to see a little more lighting on the
//  ROV itself. it's rendered very low res and very dark". rov/build.js:
//    triangles ... per quality (high: desktop, low: phones) and LOD (near:
//                  every part, far: no detail group): high near under 40 k
//    LOD ......... the detail group shows near and hides far (three LOD)
//    normals ..... unit and finite; the foam and the ducts face out; the
//                  foam rounds are smooth (one normal per position)
//    detail ...... bolts, gussets, cables, handles, labels on high; fewer
//                  on low; the plate texture has the number
//    draw calls .. the static parts are merged per material
// ============================================================================
import * as THREE from '../../../vendor/three@0.160.0/build/three.module.js';
import { buildVehicle, rovTris } from '../rov/build.js';

let pass = 0, fail = 0;
function ok(cond, name, info = '') { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); } }

const hi = buildVehicle(THREE, { id: 1, seed: 3, quality: 'high', scale: 0.6 });
const lo = buildVehicle(THREE, { id: 2, seed: 4, quality: 'low', scale: 0.6 });
const th = rovTris(hi), tl = rovTris(lo);
ok(th.near < 40000 && th.near > 25000, 'triangles: desktop (high) near between 25 k and 40 k', th.near);
ok(th.far < th.near * 0.9, 'triangles: desktop far (no detail) is under 90 % of near', `${th.far} of ${th.near}`);
ok(tl.near < 20000 && tl.far < tl.near, 'triangles: phone (low) near under 20 k, far less', `${tl.near} / ${tl.far}`);
console.log(`triangles per vehicle: high near ${th.near}, far ${th.far}; low near ${tl.near}, far ${tl.far}`);

// LOD
{
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  const g = hi.group; g.position.set(0, 0, 0); g.updateMatrixWorld(true);
  cam.position.set(3, 1, 3); cam.updateMatrixWorld(true);
  hi.detail.update(cam);
  const nearOn = hi.detail.levels[0].object.visible;
  cam.position.set(30, 4, 30); cam.updateMatrixWorld(true);
  hi.detail.update(cam);
  const farOff = !hi.detail.levels[0].object.visible;
  ok(hi.detail.isLOD && nearOn && farOff, 'LOD: the detail shows at 4 m and hides at 42 m', `${nearOn} ${farOff}`);
  ok(hi.detailFar === 14 && lo.detailFar === 9, 'LOD: the detail distance is 14 m (high), 9 m (low)');
}

// normals
{
  let bad = 0, n = 0; const badM = new Set();
  hi.group.traverse(m => {
    if (!m.isMesh) return;
    const a = m.geometry.attributes.normal;
    for (let i = 0; i < a.count; i++) { const l = Math.hypot(a.getX(i), a.getY(i), a.getZ(i)); n++; if (!(Math.abs(l - 1) < 1e-3)) { bad++; badM.add(m.name + ':' + l.toFixed(3)); } }
  });
  ok(bad === 0, 'normals: every normal is unit and finite', `${bad} of ${n}: ${[...badM].join(', ')}`);
  const foam = hi.body.children.find(m => m.isMesh && m.material === hi.materials.foam);
  ok(!!foam, 'foam: one merged foam mesh');
  if (foam) {
    const p = foam.geometry.attributes.position, nr = foam.geometry.attributes.normal;
    let out = 0, side = 0;
    const keys = new Map(); let same = 0, pairs = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      if (Math.abs(x) > 1.075 && Math.abs(p.getZ(i)) < 0.55) { side++; if (Math.sign(nr.getX(i)) === Math.sign(x)) out++; }
      const k = `${Math.round(x * 1e3)},${Math.round(y * 1e3)},${Math.round(p.getZ(i) * 1e3)}`;
      if (keys.has(k)) { pairs++; const j = keys.get(k); if (nr.getX(i) * nr.getX(j) + nr.getY(i) * nr.getY(j) + nr.getZ(i) * nr.getZ(j) > 0.999) same++; } else keys.set(k, i);
    }
    ok(side > 20 && out / side > 0.98, 'foam: the end walls face out', `${out} of ${side}`);
    ok(pairs > 100 && same / pairs > 0.85, 'foam: smooth normals (a shared position has one normal over the bevels)', `${same} of ${pairs}`);
  }
  // the vertical duct at (0.42, 0.52, 0): the outer wall faces out, the inner wall in
  const black = hi.body.children.filter(m => m.isMesh && m.material === hi.materials.black);
  let outer = 0, outerOk = 0, inner = 0, innerOk = 0;
  for (const m of black) {
    const p = m.geometry.attributes.position, nr = m.geometry.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i) - 0.42, dz = p.getZ(i), dy = p.getY(i) - 0.52, r = Math.hypot(dx, dz);
      if (Math.abs(dy) > 0.1) continue;
      const rad = (nr.getX(i) * dx + nr.getZ(i) * dz) / (r || 1);
      if (r > 0.178 && r < 0.195 && Math.abs(dy) < 0.07) { outer++; if (rad > 0.5) outerOk++; }
      if (r > 0.148 && r < 0.153) { inner++; if (rad < -0.5) innerOk++; }
    }
  }
  ok(outer > 20 && outerOk / outer > 0.95 && inner > 20 && innerOk / inner > 0.95, 'ducts: the outer wall faces out and the inner wall faces the axis', `out ${outerOk}/${outer} in ${innerOk}/${inner}`);
}

// detail, textures, draw calls
{
  const D = hi.detail.levels[0].object, DL = lo.detail.levels[0].object;
  const merged = (grp) => grp.children.reduce((s, m) => s + (m.userData.merged || 0), 0);
  ok(merged(D) > 100 && merged(DL) < merged(D), 'detail: over 100 small parts on high (bolts, gussets, cables, handles, labels), fewer on low', `${merged(D)} / ${merged(DL)}`);
  const steelD = D.children.find(m => m.material === hi.materials.steel);
  ok(steelD && steelD.userData.merged > 80, 'detail: the bolt heads and straps (steel) are in the detail group', steelD && steelD.userData.merged);
  const pl = hi.textures.plate.image, dark = Array.from({ length: pl.width * pl.height }, (_, i) => pl.data[i * 4]).filter(v => v < 40).length;
  ok(dark > 80, 'labels: the number plate texture has the dark number', dark);
  ok(hi.materials.foam.map && hi.materials.foam.bumpMap && hi.materials.hazard.map, 'foam grain map and bump map, hazard stripes');
  let meshes = 0; hi.group.traverse(m => { if (m.isMesh) meshes++; });
  ok(meshes < 80, 'draw calls: under 80 meshes per vehicle (static parts merged per material)', meshes);
  ok(hi.props.length === 6 && hi.props.every(p => p.spin.children.length === 5), 'props: 6 thrusters, a spinner and 4 blades each');
  ok(hi.lamps.length === 4 && hi.leds.length === 5 && hi.camera.isPerspectiveCamera && hi.arm.wrist && hi.tetherPoint && hi.sonar, 'API: lamps, LEDs, camera, arm, tether point, sonar');
  let frameCol = 0, fc = 0;
  hi.body.children.filter(m => m.isMesh && m.material === hi.materials.frame).forEach(m => { const c = m.geometry.attributes.color; for (let i = 0; i < c.count; i++) { frameCol += c.getX(i); fc++; } });
  ok(fc > 0 && frameCol / fc < 0.3, 'frame: dark anodise (mean vertex colour under 0.3) with lighter worn spots', (frameCol / fc).toFixed(3));
  console.log(`detail: ${merged(D)} small parts (low ${merged(DL)}); ${meshes} meshes; frame anodise ${(frameCol / fc).toFixed(3)}`);
}
hi.dispose(); lo.dispose();
ok(true, 'dispose runs');

console.log(`rov-model: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

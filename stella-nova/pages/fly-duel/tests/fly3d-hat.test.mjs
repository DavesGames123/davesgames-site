// ============================================================================
//  FLY DUEL  ·  node tests for the fedora  (node tests/fly3d-hat.test.mjs)
// ----------------------------------------------------------------------------
//  The user asked: "put the competitor fly in a fedora". This test builds
//  a fly with buildFly({ hat: 'fedora' }) and with addFedora/setHat, and
//  checks: the hat hangs on the head joint, it sits on top of the head
//  capsule (crown base near the head top, brim wider than the head), it
//  follows the head through every clip with no NaN, setHat hides and shows
//  it, and dispose frees it. Exit code 1 on any failure.
// ============================================================================
import { registerHooks } from 'node:module';

const vendor = new URL('../../../vendor/three@0.160.0/', import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'three') return { url: new URL('build/three.module.js', vendor).href, shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: new URL('examples/jsm/' + spec.slice(13), vendor).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

const THREE = await import('three');
const { buildFly, animate, addFedora, setHat, FEDORA, CLIPS, countTriangles } = await import('../ui/fly3d/fly.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const box = new THREE.Box3();

for (const lod of ['desktop', 'phone']) {
  const { root, rig, dispose } = buildFly({ colour: '#f26ad6', seed: 2, lod, hat: 'fedora' });
  ok(rig.hat && rig.hat.group.parent === rig.joints.head, `${lod}: the fedora hangs on the head joint`);
  root.updateMatrixWorld(true);
  const headMesh = rig.joints.head.children.find(c => c.isMesh);
  const hb = box.setFromObject(headMesh).clone();
  const crown = rig.hat.group.getObjectByName('fedora-crown'), brim = rig.hat.group.getObjectByName('fedora-brim');
  const cb = box.setFromObject(crown).clone(), bb = box.setFromObject(brim).clone();
  const headW = hb.max.x - hb.min.x, brimW = bb.max.x - bb.min.x;
  ok(brimW > headW * 1.2, `${lod}: brim wider than the head (${brimW.toFixed(3)} vs ${headW.toFixed(3)})`);
  ok(cb.min.y > hb.max.y - 0.08 && cb.min.y < hb.max.y + 0.02, `${lod}: crown base sits on the head top (crown ${cb.min.y.toFixed(3)}, head top ${hb.max.y.toFixed(3)})`);
  ok(cb.max.y > hb.max.y + 0.08, `${lod}: crown rises above the head (${(cb.max.y - hb.max.y).toFixed(3)})`);
  const tris = countTriangles(rig.hat.group);
  ok(tris > 200 && tris < 12000, `${lod}: hat triangles in budget (${tris})`);
  // the hat follows the head through every clip
  for (const clip of Object.keys(CLIPS)) {
    let bad = false;
    for (let f = 0; f <= 90; f++) {
      animate(rig, clip, f / 30, { time: f / 30 });
      root.updateMatrixWorld(true);
      const e = rig.hat.group.matrixWorld.elements;
      if (e.some(v => !Number.isFinite(v))) bad = true;
    }
    ok(!bad, `${lod}: ${clip} keeps the hat matrix finite`);
  }
  ok(setHat(rig, false) === false && rig.hat.group.visible === false, `${lod}: setHat(false) hides it`);
  ok(setHat(rig, true) === true && rig.hat.group.visible === true, `${lod}: setHat(true) shows it`);
  ok(addFedora(rig) === rig.hat, `${lod}: addFedora twice gives the same hat`);
  dispose();
  ok(rig.hat === null, `${lod}: dispose frees the hat`);
}
// a fly built without a hat has none until asked
{
  const { rig, dispose } = buildFly({ seed: 3 });
  ok(!rig.hat, 'no hat by default');
  ok(setHat(rig, true) && rig.hat.group.parent === rig.joints.head, 'setHat(true) adds one on demand');
  dispose();
}
ok(FEDORA.brimR > FEDORA.crownR, 'FEDORA brim larger than crown');

console.log(`fly3d-hat: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

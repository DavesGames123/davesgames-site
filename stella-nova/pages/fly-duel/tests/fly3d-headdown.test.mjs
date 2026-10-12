// ============================================================================
//  FLY DUEL  ·  node tests for the sore loser clip  (node tests/fly3d-headdown.test.mjs)
// ----------------------------------------------------------------------------
//  The user asked: "we should have the loser throw their cards and put
//  their head down on the table if they lose". ui/fly3d/fly.js clip
//  headDown does the fly part: the front legs fling the fan at
//  CLIPS.headDown.release, then the fly puts its head down on the table
//  and holds it there, with a sigh now and then. A fedora falls off onto
//  the table. This test builds the fly in node (three r160 from vendor/,
//  no DOM) with the table numbers of the scene and checks:
//    - every frame of the clip is finite (both LODs, full and zero life)
//    - the fling: the front tarsi go up and forward at the release
//    - the head ends at table height, over the table, and no part of the
//      fly goes into the table top
//    - the front tarsi lie on the table, the wings droop, the abdomen sighs
//    - the fedora (procedural and the model) ends with its brim on the
//      table, clear of the head, and is back on the head in other clips
//  Exit code 1 on any failure.
// ============================================================================
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

const vendor = new URL('../../../vendor/three@0.160.0/', import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'three') return { url: new URL('build/three.module.js', vendor).href, shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: new URL('examples/jsm/' + spec.slice(13), vendor).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

const THREE = await import('three');
const { buildFly, animate, CLIPS, HEAD_DOWN } = await import('../ui/fly3d/fly.js');
const hatMod = await import('../ui/fly3d/hat.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

// The scene numbers (ui/fly3d/scene.js TABLE, flyScale 2): table top and
// near edge in fly root units.
const TY = (2.0 - 1.16) / 2, TZ = (4.2 - 3.45) / 2;
const v = new THREE.Vector3(), m4 = new THREE.Matrix4();

// Lowest world y of a mesh list over the table (z past the near edge).
function lowOver(meshes) {
  let y = Infinity;
  for (const o of meshes) {
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v.z > TZ && v.y < y) y = v.y; }
  }
  return y;
}
// Vertices of the fly that are inside the table top slab (z past the
// edge, y under the top by more than tol). Instanced bristles included.
function inTable(root, tol, skip = new Set()) {
  let n = 0, worst = 0;
  root.traverse(o => {
    if (!o.isMesh || skip.has(o)) return;
    const p = o.geometry.attributes.position;
    const k = o.isInstancedMesh ? o.count : 1;
    for (let j = 0; j < k; j++) {
      if (o.isInstancedMesh) { o.getMatrixAt(j, m4); m4.premultiply(o.matrixWorld); } else m4.copy(o.matrixWorld);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m4);
        if (v.z > TZ + 0.002 && v.y < TY - tol && v.y > TY - 0.3) { n++; worst = Math.max(worst, TY - v.y); }
      }
    }
  });
  return { n, worst };
}
const finite = root => { let good = true; root.traverse(o => { for (const x of o.matrixWorld.elements) if (!Number.isFinite(x)) good = false; }); return good; };

// --- clip table ---------------------------------------------------------------
const D = CLIPS.headDown;
ok(D && D.hold === true, 'CLIPS.headDown is a hold clip');
ok(D && D.release > 0.2 && D.release < 0.8 && D.release < D.duration, `release time in the toss phase (${D?.release})`);
ok(HEAD_DOWN && HEAD_DOWN.sighEvery > 2, 'HEAD_DOWN has a sigh period');

for (const lod of ['desktop', 'phone']) {
  for (const droop of [0, 1]) {
    const tag = `${lod}, droop ${droop}`;
    const { root, rig, dispose } = buildFly({ seed: 2, lod, tableY: TY, tableZ: TZ });
    // --- finite over the whole clip and the hold ---------------------------------
    let bad = 0;
    for (let f = 0; f <= 12 * 30; f++) {
      animate(rig, 'headDown', f / 30, { time: f / 30, droop, shake: true });
      root.updateMatrixWorld(true);
      if (!finite(root)) bad++;
    }
    ok(bad === 0, `${tag}: headDown is finite for 12 s (${bad} bad frames)`);

    // --- the fling -----------------------------------------------------------------
    const hand = n => rig.hands[n].getWorldPosition(new THREE.Vector3());
    animate(rig, 'idle', 0, { time: 0, droop });
    const h0 = hand('R1');
    animate(rig, 'headDown', D.release, { time: D.release, droop });
    const h1 = hand('R1');
    ok(h1.y > h0.y + 0.1 && h1.z > h0.z + 0.1, `${tag}: the fan hand flings up and forward at release (dy ${(h1.y - h0.y).toFixed(3)}, dz ${(h1.z - h0.z).toFixed(3)})`);

    // --- head on the table ------------------------------------------------------------
    const head = rig.joints.head;
    const capsule = head.children.filter(c => c.isMesh);
    let lo = Infinity, hi = -Infinity, worst = 0, pen = 0, overZ = Infinity;
    const abd = [];
    for (let t = 2.1; t <= 14; t += 0.25) {
      animate(rig, 'headDown', t, { time: t, droop, shake: true });
      root.updateMatrixWorld(true);
      const y = lowOver(capsule);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
      const r = inTable(root, 0.006);
      pen += r.n; worst = Math.max(worst, r.worst);
      overZ = Math.min(overZ, head.getWorldPosition(v).z);
      abd.push(rig.joints.abdomen.scale.z);
    }
    ok(lo >= TY - 0.005 && hi <= TY + 0.03, `${tag}: the head rests at table height (lowest point ${(lo - TY).toFixed(4)} .. ${(hi - TY).toFixed(4)} above the top)`);
    ok(overZ > TZ, `${tag}: the head is over the table (head z ${overZ.toFixed(3)} > edge ${TZ})`);
    ok(pen === 0, `${tag}: no part of the fly goes into the table (${pen} vertices, worst ${worst.toFixed(4)})`);
    const range = Math.max(...abd) - Math.min(...abd);
    ok(range > 0.01, `${tag}: the abdomen breathes and sighs (scale range ${range.toFixed(4)})`);

    // --- legs and wings ------------------------------------------------------------------
    animate(rig, 'headDown', 4, { time: 4, droop });
    for (const n of ['L1', 'R1']) {
      const p = hand(n);
      ok(Math.abs(p.y - TY) < 0.03 && p.z > TZ, `${tag}: ${n} tarsus lies on the table (y ${(p.y - TY).toFixed(3)}, z ${p.z.toFixed(3)})`);
    }
    const wq = rig.joints['wing.L'].quaternion.clone();
    animate(rig, 'idle', 0, { time: 0 });
    ok(wq.angleTo(rig.joints['wing.L'].quaternion) > 0.2, `${tag}: the wings droop (${wq.angleTo(rig.joints['wing.L'].quaternion).toFixed(3)} rad from idle)`);
    dispose();
  }
}

// --- the fedora falls onto the table --------------------------------------------------
function hatCheck(tag) {
  const { root, rig, dispose } = buildFly({ seed: 2, tableY: TY, tableZ: TZ, hat: 'fedora' });
  const g = rig.hat.group;
  animate(rig, 'headDown', 0, { time: 0 });
  ok(g.position.distanceTo(rig.hat.home.p) < 1e-9, `${tag}: the hat starts on the head`);
  const meshes = []; g.traverse(o => { if (o.isMesh) meshes.push(o); });
  const headBox = new THREE.Box3();
  for (const t of [3, 6, 10]) {
    animate(rig, 'headDown', t, { time: t });
    root.updateMatrixWorld(true);
    const y = lowOver(meshes);
    ok(y >= TY - 0.004 && y <= TY + 0.012, `${tag} t ${t}: the brim rests on the table (lowest ${(y - TY).toFixed(4)} above)`);
    const hb = new THREE.Box3().setFromObject(g, true);
    ok(hb.min.z > TZ, `${tag} t ${t}: the hat is past the table edge (z ${hb.min.z.toFixed(3)})`);
    headBox.makeEmpty(); for (const c of rig.joints.head.children) if (c.isMesh) headBox.expandByObject(c, true);
    ok(!hb.intersectsBox(headBox), `${tag} t ${t}: the hat lies clear of the head`);
  }
  // a frame mid-fall is finite and above the table
  let bad = 0, under = 0;
  for (let f = 0; f <= 75; f++) {
    const t = 0.9 + f / 75;
    animate(rig, 'headDown', t, { time: t }); root.updateMatrixWorld(true);
    if (!finite(g)) bad++;
    if (lowOver(meshes) < TY - 0.004) under++;
  }
  ok(bad === 0, `${tag}: the fall is finite`);
  ok(under === 0, `${tag}: the hat does not go through the table while it falls (${under} frames)`);
  // other clips: back on the head
  animate(rig, 'raiseArms', 1, { time: 1 });
  ok(g.position.distanceTo(rig.hat.home.p) < 1e-9 && g.quaternion.angleTo(rig.hat.home.q) < 1e-9, `${tag}: another clip puts the hat back on the head`);
  dispose();
}
hatCheck('procedural fedora');
const buf = readFileSync(new URL('../models/fedora.glb', import.meta.url));
hatMod.setFedoraModel(hatMod.parseFedoraGlb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
hatCheck('model fedora');
hatMod.setFedoraModel(null);

console.log(`fly3d-headdown: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

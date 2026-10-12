// ============================================================================
//  FLY DUEL  ·  node tests for the fedora model  (node tests/fly3d-hat-model.test.mjs)
// ----------------------------------------------------------------------------
//  The user asked: "please find an actual model fedora". models/fedora.glb
//  is "Fedora" by Poly by Google (CC BY 3.0, Poly Pizza). This test checks:
//  the GLB parses in node with hat.js parseFedoraGlb, its size and bounds
//  (brim about 1.6-1.8 times the head width, crown on the head top), the
//  swap in fly.js addFedora puts the model meshes on the head joint, the
//  async load path swaps a procedural hat, opts.model = false keeps the
//  procedural hat, dispose keeps the shared model geometry, and the
//  credits name the source and the licence. Exit code 1 on any failure.
// ============================================================================
import { registerHooks } from 'node:module';
import { readFileSync, statSync } from 'node:fs';

const vendor = new URL('../../../vendor/three@0.160.0/', import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'three') return { url: new URL('build/three.module.js', vendor).href, shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: new URL('examples/jsm/' + spec.slice(13), vendor).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

const THREE = await import('three');
const { buildFly, animate, setHat, CLIPS, countTriangles } = await import('../ui/fly3d/fly.js');
const hat = await import('../ui/fly3d/hat.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const box = new THREE.Box3();

const glbUrl = new URL('../models/fedora.glb', import.meta.url);
const buf = readFileSync(glbUrl);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
ok(statSync(glbUrl).size < 150 * 1024, `fedora.glb under 150 KB (${statSync(glbUrl).size} bytes)`);
ok(hat.FEDORA_URL.href === glbUrl.href, 'hat.js FEDORA_URL points at models/fedora.glb');

// 1. the GLB parses, has the three named parts and sane bounds
const model = hat.parseFedoraGlb(ab);
const names = model.parts.map(p => p.name).sort().join(',');
ok(names === 'fedora-band,fedora-brim,fedora-crown', `three named parts (${names})`);
const all = new THREE.Box3();
for (const p of model.parts) {
  const pos = p.geometry.attributes.position.array;
  ok(pos.every(Number.isFinite), `${p.name}: finite positions`);
  ok(p.geometry.attributes.normal?.count === p.geometry.attributes.position.count, `${p.name}: has normals`);
  all.union(p.geometry.boundingBox);
}
const W = all.max.x - all.min.x, D = all.max.z - all.min.z, Hh = all.max.y - all.min.y;
ok(Math.abs(W - 0.51) < 0.01, `brim width 0.51 in head-local units (${W.toFixed(3)})`);
ok(D > 0.4 && D < W, `brim depth (${D.toFixed(3)})`);
ok(Hh > 0.15 && Hh < 0.22, `hat height (${Hh.toFixed(3)})`);
ok(Math.abs((all.max.x + all.min.x) / 2) < 0.01, 'centred in x');
ok(all.min.y > -0.01 && all.min.y < 0.01, `origin on the brim plane (min y ${all.min.y.toFixed(4)})`);
const tris = model.parts.reduce((n, p) => n + p.geometry.index.count / 3, 0);
ok(tris > 300 && tris < 2000, `model triangles (${tris})`);
ok(/Poly by Google/.test(model.copyright) && /CC BY 3\.0/.test(model.copyright) && /8TpZrCG3aRf/.test(model.copyright), 'GLB asset.copyright names the source');

// 2. procedural first, then the async load swaps in the model
{
  ok(hat.fedoraState() === 'idle', 'cache idle at start');
  const fakeFetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => ab.slice(0) });
  const { rig, dispose } = buildFly({ seed: 4, lod: 'phone' });
  // prime loadFedora with the fake fetch before addFedora asks for it
  const p = hat.loadFedora({ fetch: fakeFetch });
  ok(hat.fedoraState() === 'loading', 'state loading');
  setHat(rig, true);
  ok(rig.hat.source === 'procedural', 'procedural hat shows at once');
  await rig.hat.ready; await p;
  ok(hat.fedoraState() === 'ready', 'state ready after load');
  ok(rig.hat.source === 'model', 'the load swaps the model in');
  ok(!!rig.hat.group.getObjectByName('fedora-model'), 'model group present');
  dispose();
  ok(rig.hat === null, 'dispose frees the hat');
}

// 3. with the model cached, the hat is the model at once; check the fit
let disposedShared = 0;
for (const p of hat.fedoraModel().parts) p.geometry.addEventListener('dispose', () => disposedShared++);
for (const lod of ['desktop', 'phone']) {
  const { root, rig, dispose } = buildFly({ colour: '#f26ad6', seed: 2, lod, hat: 'fedora' });
  ok(rig.hat.source === 'model', `${lod}: cached model used at once`);
  let o = rig.hat.group.getObjectByName('fedora-crown'), onHead = false;
  for (; o; o = o.parent) if (o === rig.joints.head) onHead = true;
  ok(onHead, `${lod}: model crown hangs under the head joint`);
  ok(rig.hat.group.parent === rig.joints.head, `${lod}: hat group on the head joint`);
  root.updateMatrixWorld(true);
  const headMesh = rig.joints.head.children.find(c => c.isMesh);
  const hb = box.setFromObject(headMesh).clone();
  const crown = rig.hat.group.getObjectByName('fedora-crown'), band = rig.hat.group.getObjectByName('fedora-band'), brim = rig.hat.group.getObjectByName('fedora-brim');
  const cb = box.setFromObject(crown).clone().union(new THREE.Box3().setFromObject(band)), bb = box.setFromObject(brim).clone();
  const headW = hb.max.x - hb.min.x, brimW = bb.max.x - bb.min.x, r = brimW / headW;
  ok(r > 1.55 && r < 1.85, `${lod}: brim ${r.toFixed(2)} x head width`);
  ok(cb.min.y > hb.max.y - 0.08 && cb.min.y < hb.max.y + 0.02, `${lod}: crown base on the head top (crown ${cb.min.y.toFixed(3)}, head top ${hb.max.y.toFixed(3)})`);
  ok(cb.max.y > hb.max.y + 0.08, `${lod}: crown rises above the head (${(cb.max.y - hb.max.y).toFixed(3)})`);
  const t = countTriangles(rig.hat.group);
  ok(t === tris, `${lod}: hat triangles = model triangles (${t})`);
  for (const clip of Object.keys(CLIPS)) {
    let bad = false;
    for (let f = 0; f <= 60; f += 3) {
      animate(rig, clip, f / 30, { time: f / 30 });
      root.updateMatrixWorld(true);
      if (crown.matrixWorld.elements.some(v => !Number.isFinite(v))) bad = true;
    }
    ok(!bad, `${lod}: ${clip} keeps the model matrix finite`);
  }
  ok(setHat(rig, false) === false && !rig.hat.group.visible, `${lod}: setHat(false) hides the model`);
  ok(setHat(rig, true) === true && rig.hat.group.visible, `${lod}: setHat(true) shows it`);
  dispose();
}
ok(disposedShared === 0, 'dispose keeps the shared model geometry');

// 4. tint clones the material; model:false keeps the procedural hat
{
  const { rig, dispose } = buildFly({ seed: 5 });
  const { addFedora } = await import('../ui/fly3d/fly.js');
  addFedora(rig, { felt: '#224466' });
  const crown = rig.hat.group.getObjectByName('fedora-crown');
  ok(crown.material !== hat.fedoraModel().parts.find(p => p.name === 'fedora-crown').material, 'tint clones the felt material');
  dispose();
  hat.setFedoraModel(null);
  const b = buildFly({ seed: 6 });
  addFedora(b.rig, { model: false });
  ok(b.rig.hat.source === 'procedural' && b.rig.hat.ready === null, 'model:false keeps the procedural hat');
  b.dispose();
}

// 5. a failed fetch leaves the procedural hat and no unhandled rejection
{
  hat.setFedoraModel(null);
  const r = await hat.loadFedora({ fetch: async () => ({ ok: false, status: 404 }) });
  ok(r === null && hat.fedoraState() === 'failed', 'failed fetch -> null, state failed');
}

// 6. credits name the source
const pageDir = new URL('../', import.meta.url);
const hc = readFileSync(new URL('ui/fly3d/HAT-CREDITS.md', pageDir), 'utf8');
const cr = readFileSync(new URL('CREDITS.md', pageDir), 'utf8');
for (const [nm, txt] of [['HAT-CREDITS.md', hc], ['CREDITS.md', cr]]) {
  ok(/Poly by Google/.test(txt), `${nm} names the author`);
  ok(/poly\.pizza\/m\/8TpZrCG3aRf/.test(txt), `${nm} links the source page`);
  ok(/CC BY 3\.0/.test(txt) && /creativecommons\.org\/licenses\/by\/3\.0/.test(txt), `${nm} names and links the licence`);
}

console.log(`fly3d-hat-model: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

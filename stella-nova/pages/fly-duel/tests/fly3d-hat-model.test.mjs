// ============================================================================
//  FLY DUEL  ·  node tests for the fedora model  (node tests/fly3d-hat-model.test.mjs)
// ----------------------------------------------------------------------------
//  The user asked: "please find an actual model fedora", then: "the
//  fedora shape is incorrect. i need a real fedora model from online".
//  models/fedora.glb is "Fedora" by Mac BanCheese (CC BY 4.0, Printables
//  804464), with a centre crease that we pressed into the crown top. This
//  test checks: the GLB parses in node with hat.js parseFedoraGlb, its
//  size and bounds, the fedora shape (centre crease, front pinch, band,
//  brim down at the front and up at the back), the fit on the head (no
//  head, eye, ocellus or bristle point in the felt at FEDORA_SEAT_Y, eye
//  points in the felt 0.007 lower, head top under the crown, brim about
//  1.65 times the head width), the swap in fly.js addFedora, the async
//  load path, opts.model = false, dispose, and the credits. Exit code 1
//  on any failure.
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
ok(statSync(glbUrl).size < 200 * 1024, `fedora.glb under 200 KB (${statSync(glbUrl).size} bytes)`);
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
ok(Math.abs(W - 0.495) < 0.01, `brim width 0.495 in head-local units (${W.toFixed(3)})`);
ok(D > W && D < W * 1.2, `brim a little longer front to back than wide (${D.toFixed(3)})`);
ok(Hh > 0.2 && Hh < 0.26, `hat height (${Hh.toFixed(3)})`);
ok(Math.abs((all.max.x + all.min.x) / 2) < 0.01, 'centred in x');
ok(all.min.y > -0.02 && all.min.y < 0, `origin at the crown opening, front brim tip just below it (min y ${all.min.y.toFixed(4)})`);
const tris = model.parts.reduce((n, p) => n + p.geometry.index.count / 3, 0);
ok(tris > 2000 && tris < 8000, `model triangles (${tris})`);
ok(/Mac BanCheese/.test(model.copyright) && /CC BY 4\.0/.test(model.copyright) && /printables\.com\/model\/804464/.test(model.copyright), 'GLB asset.copyright names the source');

// 1b. the fedora shape
{
  const pts = (name) => { const a = model.parts.find(p => p.name === name).geometry.attributes.position.array, out = []; for (let i = 0; i < a.length; i += 3) out.push([a[i], a[i + 1], a[i + 2]]); return out; };
  const crown = pts('fedora-crown'), brim = pts('fedora-brim'), band = pts('fedora-band');
  const maxY = (ps) => ps.reduce((m, p) => Math.max(m, p[1]), -Infinity);
  const mean = (ps, f) => ps.reduce((s, p) => s + f(p), 0) / ps.length;
  const mid = crown.filter(p => Math.abs(p[2]) < 0.04);
  const centre = maxY(mid.filter(p => Math.abs(p[0]) < 0.012)), side = maxY(mid.filter(p => Math.abs(p[0]) > 0.04 && Math.abs(p[0]) < 0.09));
  ok(side - centre > 0.012, `centre crease: crown top centre ${centre.toFixed(3)} below the side lobes ${side.toFixed(3)}`);
  const top = crown.filter(p => p[1] > 0.15);
  const half = (z0) => top.filter(p => Math.abs(p[2] - z0) < 0.02).reduce((m, p) => Math.max(m, Math.abs(p[0])), 0);
  ok(half(0.1) < 0.65 * half(-0.05), `front pinch: crown half-width ${half(0.1).toFixed(3)} at the front, ${half(-0.05).toFixed(3)} behind the middle`);
  const front = mean(brim.filter(p => p[2] > 0.24), p => p[1]), back = mean(brim.filter(p => p[2] < -0.25), p => p[1]), sides = mean(brim.filter(p => Math.abs(p[0]) > 0.23), p => p[1]);
  ok(front < back - 0.015 && front < sides - 0.03, `brim down at the front (${front.toFixed(3)}), up at the back (${back.toFixed(3)}) and the sides (${sides.toFixed(3)})`);
  const by = band.map(p => p[1]), bandW = Math.max(...band.map(p => p[0])) - Math.min(...band.map(p => p[0])), crownW = Math.max(...crown.map(p => p[0])) - Math.min(...crown.map(p => p[0]));
  ok(Math.min(...by) > -0.005 && Math.max(...by) < 0.08 && bandW > crownW, `band round the crown base (y ${Math.min(...by).toFixed(3)}..${Math.max(...by).toFixed(3)}, ${bandW.toFixed(3)} wide)`);
}

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
  ok(r > 1.55 && r < 1.8, `${lod}: brim ${r.toFixed(2)} x head width`);
  ok(cb.min.y > hb.max.y - 0.08 && cb.min.y < hb.max.y + 0.02, `${lod}: crown base on the head top (crown ${cb.min.y.toFixed(3)}, head top ${hb.max.y.toFixed(3)})`);
  ok(cb.max.y > hb.max.y + 0.15, `${lod}: crown rises above the head (${(cb.max.y - hb.max.y).toFixed(3)})`);
  const fit = (seatY) => {
    // count head-joint points (capsule, eyes, ocelli, bristles, antennae) in the felt: odd hit count on three rays
    const inner = rig.hat.group.getObjectByName('fedora-model'); inner.position.y = seatY; root.updateMatrixWorld(true);
    const shell = ['fedora-crown', 'fedora-brim'].map(n => { const m = inner.getObjectByName(n).clone(); m.material = m.material.clone(); m.material.side = THREE.DoubleSide; m.matrixWorld.copy(inner.getObjectByName(n).matrixWorld); return m; });
    const toHat = inner.matrixWorld.clone().invert(), v = new THREE.Vector3(), w = new THREE.Vector3(), rc = new THREE.Raycaster();
    const dirs = [[0, 1, 0], [0.3, 1, 0.2], [-0.3, 1, -0.2]].map(d => new THREE.Vector3(...d).normalize().transformDirection(inner.matrixWorld));
    let inFelt = 0, above = 0;
    rig.joints.head.traverse(o => {
      if (!o.isMesh || o.name.startsWith('fedora')) return;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        w.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); v.copy(w).applyMatrix4(toHat);
        if (v.y < -0.02) continue;
        above++;
        if (dirs.every(d => { rc.set(w, d); return rc.intersectObjects(shell, false).length % 2 === 1; })) inFelt++;
      }
    });
    return { inFelt, above };
  };
  const seat = fit(hat.FEDORA_SEAT_Y), low = fit(hat.FEDORA_SEAT_Y - 0.007);
  ok(seat.inFelt === 0 && seat.above > 500, `${lod}: no head point in the felt at the seat (${seat.inFelt} of ${seat.above})`);
  ok(low.inFelt > 0, `${lod}: 0.007 lower, the eyes go into the felt, so the hat rests on the head (${low.inFelt})`);
  fit(hat.FEDORA_SEAT_Y);
  // the head top is under the crown: a ray up from the head top hits the inside of the crown
  {
    const p = headMesh.geometry.attributes.position, top = new THREE.Vector3(), t = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { t.fromBufferAttribute(p, i).applyMatrix4(headMesh.matrixWorld); if (t.y > top.y || i === 0) top.copy(t); }
    const rc = new THREE.Raycaster(top, new THREE.Vector3(0, 1, 0)), cm = crown.clone(); cm.material = cm.material.clone(); cm.material.side = THREE.DoubleSide; cm.matrixWorld.copy(crown.matrixWorld);
    const hit = rc.intersectObject(cm, false)[0];
    ok(hit && hit.distance > 0.01 && hit.distance < 0.25, `${lod}: head top under the crown ceiling (${hit ? hit.distance.toFixed(3) : 'no hit'})`);
  }
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
  ok(/Mac BanCheese/.test(txt), `${nm} names the author`);
  ok(/printables\.com\/model\/804464-fedora/.test(txt), `${nm} links the source page`);
  ok(/CC BY 4\.0/.test(txt) && /creativecommons\.org\/licenses\/by\/4\.0/.test(txt), `${nm} names and links the licence`);
  ok(/crease/.test(txt), `${nm} says that we changed the crown`);
}

console.log(`fly3d-hat-model: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

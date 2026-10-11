// ============================================================================
//  FLY DUEL  ·  3D fly character checks  (node tests/fly3d-fly.test.mjs)
// ----------------------------------------------------------------------------
//  The fly3d character agent owns this file. It builds ui/fly3d/fly.js in
//  node with the vendored three r160 (no renderer, no DOM) and checks the
//  triangle budget of both LODs, the joint names, every clip for 3 s at
//  60 Hz without NaN, the IK contact accuracy, the seat contact, the
//  cross-fade, and dispose. A loader hook maps the bare 'three' specifiers
//  to the vendor folder, as the page import map does.
//
//  GREP MAP   (grep -n "^// ---" tests/fly3d-fly.test.mjs)
//  Exit code 1 on any failure.
// ============================================================================
import { register } from 'node:module';

const VENDOR = new URL('../../../vendor/three@0.160.0/', import.meta.url).href;
const hook = `
const V = ${JSON.stringify(VENDOR)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return next(V + 'build/three.module.js', ctx);
  if (spec.startsWith('three/addons/')) return next(V + 'examples/jsm/' + spec.slice(13), ctx);
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const THREE = await import('three');
const F = await import('../ui/fly3d/fly.js');
const { buildFly, animate, countTriangles, CLIPS, JOINT_NAMES, LEG_NAMES, LEG_SEGMENTS } = F;

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const v = new THREE.Vector3();
const finiteTree = root => {
  let good = true;
  root.traverse(o => { for (const x of o.matrixWorld.elements) if (!Number.isFinite(x)) good = false; });
  return good;
};

// --- no DOM ------------------------------------------------------------------
ok(typeof globalThis.document === 'undefined', 'test runs without a DOM');

// --- build both LODs and the triangle budget ---------------------------------
const tris = {};
for (const lod of ['desktop', 'phone']) {
  const { root, rig, dispose } = buildFly({ lod, seed: 7, colour: '#39d0f0' });
  tris[lod] = countTriangles(root);
  ok(rig.lod === lod, `${lod}: rig.lod`);
  ok(finiteTree(root), `${lod}: finite matrices after build`);
  dispose();
}
console.log(`triangles per fly: desktop ${tris.desktop}, phone ${tris.phone}`);
// Scene budget (FLY3D.md): < 400k desktop, < 150k phone for everything.
// One fly may use at most 15 % of it, so two flies leave room for the rest.
ok(tris.desktop > 15000 && tris.desktop <= 60000, `desktop fly triangles ${tris.desktop} in (15k, 60k]`);
ok(tris.phone > 4000 && tris.phone <= 22500, `phone fly triangles ${tris.phone} in (4k, 22.5k]`);
ok(tris.phone < tris.desktop * 0.6, 'phone LOD is lighter than desktop');

// --- joints ------------------------------------------------------------------
const fly = buildFly({ seed: 3, colour: '#f26ad6' });
const { root, rig } = fly;
for (const n of JOINT_NAMES) ok(rig.joints[n] && rig.joints[n].isObject3D, `joint ${n}`);
ok(rig.legs.length === 6, 'six legs');
for (const l of LEG_NAMES) for (const s of LEG_SEGMENTS) ok(rig.joints[`${l}.${s}`] === rig.legs.find(x => x.name === l)[s], `leg joint ${l}.${s}`);
ok(rig.hands.L1 === rig.joints['L1.hand'] && rig.hands.R1 === rig.joints['R1.hand'], 'hand anchors on the front tarsi');
ok(rig.carry === rig.hands.L1, 'carry hand is L1');
ok(rig.fan.parent === root, 'fan anchor is a root child');
ok(rig.colour.getHexString() === new THREE.Color('#f26ad6').getHexString(), 'fly colour on the rig');
const collarMesh = rig.joints.collar.children.find(o => o.isMesh);
ok(collarMesh && collarMesh.material.color.equals(new THREE.Color('#f26ad6')), 'collar uses the fly colour');
let eyeMaps = 0;
root.traverse(o => { if (o.isMesh && o.material.name === 'fly.eye' && o.material.map?.isDataTexture && o.material.normalMap?.isDataTexture) eyeMaps++; });
ok(eyeMaps === 2, 'two eyes with facet colour and normal DataTextures');
let micro = null;
root.traverse(o => { if (o.isInstancedMesh) micro = o; });
ok(micro && micro.count >= 30, 'instanced microchaetae');

// --- seat contact and size ---------------------------------------------------
animate(rig, 'idle', 0);
const abdBox = new THREE.Box3().setFromObject(rig.joints.abdomen);
ok(Math.abs(abdBox.min.y) < 0.03, `abdomen rests on the seat (min y ${abdBox.min.y.toFixed(3)})`);
const all = new THREE.Box3().setFromObject(root);
ok(all.max.y > 1.0 && all.max.y < 1.3, `seated height ${all.max.y.toFixed(2)} near 1.1`);
ok(all.min.y > -0.02, `nothing below the seat (min y ${all.min.y.toFixed(3)})`);

// --- rest pose: planted legs -------------------------------------------------
for (const n of ['L2', 'R2', 'L3', 'R3']) {
  rig.hands[n].getWorldPosition(v);
  ok(v.distanceTo(rig.rest.legs[n].goal) < 1e-4, `${n} planted at rest (miss ${v.distanceTo(rig.rest.legs[n].goal).toExponential(1)})`);
}

// --- every clip, 3 s at 60 Hz, no NaN ----------------------------------------
const target = new THREE.Vector3(0.15, 0.43, 0.6);
const specs = {
  idle: 'idle', think: 'think', groom: 'groom', raiseArms: 'raiseArms', slump: 'slump',
  reach: { name: 'reach' },
  place: { name: 'place', target },
  tap: { name: 'tap', target: new THREE.Vector3(-0.3, 0.43, 0.62) },
  push: { name: 'push', target: new THREE.Vector3(0.1, 0.43, 0.5) },
};
ok(Object.keys(specs).every(k => CLIPS[k]) && Object.keys(CLIPS).every(k => specs[k]), 'test covers every clip');
for (const life of [1, 0.2]) {
  rig.setLife(life);
  for (const [name, spec] of Object.entries(specs)) {
    let bad = 0, contact = false, done = false;
    for (let i = 0; i <= 180; i++) {
      const r = animate(rig, spec, i / 60, { time: 10 + i / 60 });
      contact ||= r.contact; done ||= r.done;
      if (!finiteTree(root)) bad++;
    }
    ok(bad === 0, `${name} (life ${life}): finite for 3 s at 60 Hz`);
    if (CLIPS[name].contact != null) ok(contact, `${name}: reports contact`);
    if (!CLIPS[name].loop && !CLIPS[name].hold) ok(done, `${name}: reports done`);
  }
}
rig.setLife(1);

// --- one-shot clips start and end at the hold pose ---------------------------
const handsAt = () => LEG_NAMES.map(n => rig.hands[n].getWorldPosition(new THREE.Vector3()));
animate(rig, 'idle', 0, { time: 5 });
const hold = handsAt();
for (const name of ['reach', 'place', 'tap', 'push', 'groom']) {
  for (const t of [0, CLIPS[name].duration]) {
    animate(rig, { ...specs[name] }, t, { time: 5 });
    // idle adds a tiny front-leg bob, so compare against idle at clip time 0
    const d = Math.max(...handsAt().map((p, i) => p.distanceTo(hold[i])));
    ok(d < 0.015, `${name} at t=${t} is at the hold pose (max hand offset ${d.toFixed(4)})`);
  }
}

// --- IK accuracy at contact ---------------------------------------------------
// Reachable targets on the table in front of the fly (root-local).
const table = rig.rest.tableY;
const reachables = [[0.15, table, 0.6], [0.0, table, 0.55], [0.25, table, 0.45], [-0.1, table, 0.5], [0.05, 0.75, 0.45]];
let worst = 0;
for (const p of reachables) {
  const tv = new THREE.Vector3(...p);
  for (const name of ['reach', 'place', 'push']) {
    const r = animate(rig, { name, target: tv }, CLIPS[name].contact);
    rig.carry.getWorldPosition(v);
    const miss = v.distanceTo(tv);
    worst = Math.max(worst, miss);
    ok(r.contact && miss < 2e-3, `${name} to [${p}] lands within 2 mm-units (miss ${miss.toFixed(5)})`);
  }
}
for (const p of [[0.32, table, 0.62], [-0.3, table, 0.55], [0.2, table, 0.4]]) {
  const tv = new THREE.Vector3(...p);
  animate(rig, { name: 'tap', target: tv }, CLIPS.tap.contact);
  const leg = p[0] >= 0 ? 'L2' : 'R2';
  rig.hands[leg].getWorldPosition(v);
  ok(v.distanceTo(tv) < 2e-3, `tap [${p}] with ${leg} (miss ${v.distanceTo(tv).toFixed(5)})`);
}
console.log(`worst front-leg contact miss: ${worst.toExponential(2)}`);

// --- IK in a moved, turned and scaled parent (world targets) ----------------
const scene = new THREE.Group();
scene.position.set(3, 1.2, -2); scene.rotation.y = 2.5; scene.scale.setScalar(0.4);
scene.add(root);
scene.updateMatrixWorld(true);
const local = new THREE.Vector3(0.12, table, 0.58);
const world = root.localToWorld(local.clone());
animate(rig, { name: 'place', target: world }, CLIPS.place.contact);
rig.carry.getWorldPosition(v);
ok(v.distanceTo(world) < 2e-3 * 0.4, `place hits a world target under a scaled parent (miss ${v.distanceTo(world).toExponential(2)})`);
animate(rig, { name: 'place', target: local, space: 'local' }, CLIPS.place.contact);
rig.carry.getWorldPosition(v);
ok(v.distanceTo(world) < 2e-3 * 0.4, 'space: local gives the same contact');
animate(rig, { name: 'place', target: [world.x, world.y, world.z] }, CLIPS.place.contact);
rig.carry.getWorldPosition(v);
ok(v.distanceTo(world) < 2e-3 * 0.4, 'array targets work');
scene.remove(root);

// --- unreachable target stays finite ------------------------------------------
animate(rig, { name: 'reach', target: new THREE.Vector3(0, 0.4, 5), space: 'local' }, CLIPS.reach.contact);
ok(finiteTree(root), 'unreachable target: finite pose');
animate(rig, { name: 'tap', target: new THREE.Vector3(NaN, 0, 0), space: 'local' }, 0.3);
ok(true, 'NaN target does not throw');

// --- cross-fade -----------------------------------------------------------------
animate(rig, 'slump', 3);
const slumpHead = rig.joints.head.getWorldPosition(new THREE.Vector3());
animate(rig, 'idle', 0);
const idleHead = rig.joints.head.getWorldPosition(new THREE.Vector3());
animate(rig, 'idle', 0, { prev: { clip: 'slump', t: 3 }, mix: 0 });
ok(rig.joints.head.getWorldPosition(v).distanceTo(slumpHead) < 1e-6, 'mix 0 = previous clip');
animate(rig, 'idle', 0, { prev: { clip: 'slump', t: 3 }, mix: 0.5 });
const mid = rig.joints.head.getWorldPosition(new THREE.Vector3());
ok(mid.distanceTo(slumpHead) > 1e-3 && mid.distanceTo(idleHead) > 1e-3, 'mix 0.5 is between the clips');
ok(slumpHead.y < idleHead.y - 0.05, 'slump lowers the head');
animate(rig, 'raiseArms', 2);
ok(rig.hands.L1.getWorldPosition(v).y > 1.0 && rig.hands.R1.getWorldPosition(new THREE.Vector3()).y > 1.0, 'raiseArms lifts both front hands over the head');

// --- life: droop and tremor ---------------------------------------------------
const wingTip = () => rig.joints['wing.L'].localToWorld(new THREE.Vector3(0.6, 0, 0));
rig.setLife(1); animate(rig, 'idle', 0, { time: 1 }); const tipHi = wingTip();
rig.setLife(0.1); animate(rig, 'idle', 0, { time: 1 }); const tipLo = wingTip();
ok(tipHi.distanceTo(tipLo) > 0.05, 'wings droop as life falls');
const rolls = [];
for (let i = 0; i < 20; i++) { animate(rig, 'idle', 0, { time: i * 0.05 }); rolls.push(rig.joints.body.rotation.z); }
ok(Math.max(...rolls) - Math.min(...rolls) > 0.005, 'a fly at low life shakes a little');
const calm = [];
for (let i = 0; i < 20; i++) { animate(rig, 'idle', 0, { time: i * 0.05, shake: false }); calm.push(rig.joints.body.rotation.z); }
ok(Math.max(...calm) - Math.min(...calm) < 1e-9, 'shake: false (reduced motion) stops the tremor at low life');
rig.setLife(1);
const still = [];
for (let i = 0; i < 20; i++) { animate(rig, 'idle', 0, { time: i * 0.05 }); still.push(rig.joints.body.rotation.z); }
ok(Math.max(...still) - Math.min(...still) < 1e-9, 'a healthy fly does not shake');

// --- scene call form: bare clip name with opts ---------------------------------
{
  const low = buildFly({ detail: 'low' }), low2 = buildFly({ lowDetail: true });
  ok(low.rig.lod === 'phone' && low2.rig.lod === 'phone', "detail: 'low' and lowDetail pick the phone LOD");
  low.dispose(); low2.dispose();
  const tv = new THREE.Vector3(0.1, table, 0.58);
  const dur = 2.6, tc = CLIPS.place.contact * dur / CLIPS.place.duration;
  const r = animate(rig, 'place', tc, { target: tv, dur, time: 3 });
  rig.carry.getWorldPosition(v);
  ok(r.contact && v.distanceTo(tv) < 2e-3, `opts.target + opts.dur: contact at the stretched time (miss ${v.distanceTo(tv).toFixed(5)})`);
  animate(rig, 'idle', 0, { droop: 0.9, time: 1 });
  ok(Math.abs(rig.life - 0.1) < 1e-9, 'opts.droop sets the life');
  animate(rig, 'idle', 0, { life: 20, time: 1 });
  ok(rig.life === 1, 'opts.life (0..20) sets the life');
}

// --- determinism and seeds --------------------------------------------------
const a = buildFly({ seed: 11 }), b = buildFly({ seed: 11 }), c = buildFly({ seed: 12 });
const microOf = f => { let m; f.root.traverse(o => { if (o.isInstancedMesh) m = o; }); return Array.from(m.instanceMatrix.array); };
ok(JSON.stringify(microOf(a)) === JSON.stringify(microOf(b)), 'same seed, same bristles');
ok(JSON.stringify(microOf(a)) !== JSON.stringify(microOf(c)), 'other seed, other bristles');

// --- dispose ---------------------------------------------------------------------
let geos = 0, disposed = 0;
const geoSet = new Set();
a.root.traverse(o => { if (o.isMesh) geoSet.add(o.geometry); });
geos = geoSet.size;
for (const g of geoSet) g.addEventListener('dispose', () => disposed++);
const parent = new THREE.Group(); parent.add(a.root);
a.dispose();
ok(disposed === geos, `dispose frees every geometry (${disposed}/${geos})`);
ok(!a.root.parent, 'dispose detaches the root');
for (const f of [b, c, fly]) f.dispose();

console.log(`fly3d-fly: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

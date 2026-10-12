// ============================================================================
//  FLY DUEL  ·  node tests for the count plates of the land stacks
//  (node tests/fly3d-plates.test.mjs)
// ----------------------------------------------------------------------------
//  The 1600x900 capture of 2026-10-12 showed the "x2" plate of a land
//  stack on the target ring of a creature. ui/fly3d/scene.js puts each
//  plate in the gap between the creature row and the land row (PLATE).
//
//    gap   both seats, three stacks and a row of creatures with target
//          rings: on the table plane, no plate touches a creature or its
//          ring, and no plate touches a land card
//  Exit code 1 on any failure.
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
const rules = await import('../game/rules.js');
const { CARD, CARDS } = await import('../game/cards.js');
const { createDuelScene } = await import('../ui/fly3d/scene.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

const all = CARDS || Object.values(CARD);
const lands = all.filter(c => c.type === 'land').map(c => c.id).slice(0, 3);
const creatures = all.filter(c => c.type === 'creature').map(c => c.id).slice(0, 4);
let s = rules.newGame({ seed: 5, first: 0 });
for (const p of [0, 1]) {
  for (const id of lands) for (let k = 0; k < 2; k++) s = rules.withPermanent(s, p, id);
  for (const id of creatures) s = rules.withPermanent(s, p, id);
}
const sc = createDuelScene(null, { headless: true });
await sc.ready;
sc.setState(s);
const uids = p => s.players[p].battlefield.filter(x => CARD[x.id].type === 'creature').map(x => x.uid);
sc.highlight({ seat: 0, mode: 'target', eligible: [], attackers: [], blocks: [], targets: [...uids(0), ...uids(1)], pending: [] });
for (let k = 0; k < 60; k++) sc.render(1 / 30);
sc.scene.updateMatrixWorld(true);

// the box of an object on the table plane (x, z)
// (its own mesh and its visible child meshes: a hidden ring does not count)
function flat(o) {
  const b = new THREE.Box3();
  o.traverseVisible(m => {
    if (!m.isMesh) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    b.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld));
  });
  return { x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z };
}
const meet = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const plates = [];
sc.scene.traverse(o => { if (o.name?.startsWith('stack-plate:') && o.visible) plates.push(o); });
ok(plates.length === 2 * lands.length, `a plate per land stack (${plates.length})`);
const Z = sc.world.Z;
const cards = [...Z.perms.entries()].map(([uid, o]) => {
  const x = [...s.players[0].battlefield, ...s.players[1].battlefield].find(y => y.uid === uid);
  return { land: CARD[x.id].type === 'land', ring: o.ring.visible, box: flat(o.mesh), name: x.id };
});
ok(cards.filter(c => !c.land).every(c => c.ring), 'every creature has its target ring');
let onCreature = 0, onLand = 0;
for (const pl of plates) {
  const b = flat(pl);
  for (const c of cards) if (meet(b, c.box)) { if (c.land) onLand++; else onCreature++; }
}
ok(onCreature === 0, `no plate touches a creature or its ring (${onCreature})`);
ok(onLand === 0, `no plate touches a land card (${onLand})`);

sc.dispose();
console.log(`fly3d-plates: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

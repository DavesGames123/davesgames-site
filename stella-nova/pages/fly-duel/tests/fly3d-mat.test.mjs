// ============================================================================
//  FLY DUEL  ·  node tests: cards rest on top of the playmat, and the
//  brain maps hide in first person  (node tests/fly3d-mat.test.mjs)
// ----------------------------------------------------------------------------
//  The user saw every card under the playmat, and a brain map over the
//  hand in play mode. This test plays greedy games on a headless scene and
//  checks: the top of each mat is below the bottom of every card mesh at
//  rest (lands, creatures, the library, the graveyard), and setFirstPerson
//  hides both brain holders and gives them back when it ends.
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
const { greedyBot } = await import('../game/bots.js');
const { Match, agentFromBot } = await import('../ui/match.js');
const { createDuelScene, TABLE } = await import('../ui/fly3d/scene.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

async function playSome(sc, M, n) {
  let r, k = 0;
  while (k++ < n && (r = M.next())) {
    let done = false;
    sc.play(r).then(() => { done = true; });
    for (let i = 0; i < 6000 && !done; i++) { sc.render(1 / 30); await null; }
  }
  for (let i = 0; i < 120; i++) { sc.render(1 / 30); await null; }
}

const box = new THREE.Box3();
const topOf = o => { o.updateWorldMatrix(true, false); return box.setFromObject(o).max.y; };
const bottomOf = o => { o.updateWorldMatrix(true, false); return box.setFromObject(o).min.y; };

for (const seed of [8, 21]) {
  const canvas = { clientWidth: 960, clientHeight: 540, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }) };
  const sc = createDuelScene(canvas, { headless: true });
  await sc.ready;
  const M = new Match(rules, [agentFromBot(greedyBot(), 'a'), agentFromBot(greedyBot(), 'b')], { seed });
  sc.setState(M.state); sc.setSpeed(4);
  await playSome(sc, M, 40);

  const mats = [];
  sc.scene.traverse(o => { if (o.isMesh && o.name === 'playmat') mats.push(o); });
  ok(mats.length === 2, `seed ${seed}: two playmats (${mats.length})`);
  const matTop = Math.max(...mats.map(topOf));
  ok(matTop > TABLE.y && matTop < TABLE.y + 0.004, `seed ${seed}: mat top just above the table (${(matTop - TABLE.y).toFixed(4)})`);

  // every card-sized mesh near the table surface at rest
  const cards = [];
  sc.scene.traverse(o => {
    if (!o.isMesh || !o.visible || o.name === 'playmat') return;
    const g = o.geometry; if (!g) return;
    if (!g.boundingBox) g.computeBoundingBox();
    const s = g.boundingBox.getSize(new THREE.Vector3());
    const cardLike = Math.abs(s.x - TABLE.cardW) < 0.02 && Math.abs(Math.max(s.y, s.z) - TABLE.cardH) < 0.03;
    if (!cardLike) return;
    const b = bottomOf(o);
    if (b < TABLE.y + 0.1) cards.push(b);
  });
  ok(cards.length >= 10, `seed ${seed}: cards on the table found (${cards.length})`);
  const under = cards.filter(b => b < matTop - 1e-4).length;
  ok(under === 0, `seed ${seed}: no card bottom below the mat top (${under} of ${cards.length} under, mat top ${(matTop - TABLE.y).toFixed(4)}, lowest card ${(Math.min(...cards) - TABLE.y).toFixed(4)})`);

  // brain holders: hidden in first person, back after
  const holders = () => { const h = []; sc.scene.traverse(o => { if (o.isGroup && o.children.some(c => c.isMesh && c.geometry?.type === 'TorusGeometry')) h.push(o); }); return h; };
  sc.setBrains(true);
  sc.setFirstPerson(0);
  const fp = holders();
  ok(fp.every(h => !h.visible), `seed ${seed}: brain maps hidden in first person (${fp.filter(h => h.visible).length} visible)`);
  sc.setBrains(true);
  ok(holders().every(h => !h.visible), `seed ${seed}: setBrains(true) in first person keeps them hidden`);
  sc.setFirstPerson(null);
  ok(holders().every(h => h.visible), `seed ${seed}: brain maps back after first person`);
  sc.setBrains(false);
  ok(holders().every(h => !h.visible), `seed ${seed}: setBrains(false) still hides them`);
  sc.setBrains(true);
  sc.dispose();
}

console.log(`fly3d-mat: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

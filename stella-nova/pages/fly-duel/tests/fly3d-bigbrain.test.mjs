// ============================================================================
//  FLY DUEL  ·  node tests for the big brain map of play mode
//  (node tests/fly3d-bigbrain.test.mjs)
// ----------------------------------------------------------------------------
//  In play mode (setFirstPerson(seat)) the map of the other fly is large,
//  in the hall behind its chair (ui/fly3d/scene.js 'big brain').
//
//    frame      at many frame shapes (desktop to a phone) and both seats,
//               the map disc is in the frame, its bottom is above the far
//               edge of your mat, and it does not touch your hand cards
//    face       the map turns to face the camera, also after an orbit
//    far side   an orbit to the far side of the table hides the map
//    seat map   the map of your own seat hides; watch mode puts both maps
//               back at their small size
//    fire       each decision of the pretrained fly (a real brain/fly.js
//               trace) fires the big map with that trace
//  Exit code 1 on any failure.
// ============================================================================
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const vendor = new URL('../../../vendor/three@0.160.0/', import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'three') return { url: new URL('build/three.module.js', vendor).href, shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: new URL('examples/jsm/' + spec.slice(13), vendor).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const THREE = await import('three');
const rules = await import('../game/rules.js');
const { greedyBot } = await import('../game/bots.js');
const { Match, agentFromBot, agentFromFly } = await import('../ui/match.js');
const { createDuelScene, TABLE } = await import('../ui/fly3d/scene.js');
const { MAT } = await import('../ui/fly3d/hall.js');
const { Fly } = await import('../brain/fly.js');
const pre = JSON.parse(readFileSync(join(ROOT, 'data/pretrained.json'), 'utf8'));
const C = JSON.parse(readFileSync(join(ROOT, 'data/connectome.json'), 'utf8'));

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const seatPos = (p, u, y, v) => (p === 0 ? new THREE.Vector3(u, TABLE.y + y, v) : new THREE.Vector3(-u, TABLE.y + y, -v));

for (const [w, h] of [[1600, 900], [1280, 800], [1024, 768], [800, 800], [700, 800], [600, 800], [390, 760], [360, 780]]) {
  const tag = `${w}x${h}`;
  const sc = createDuelScene({ clientWidth: w, clientHeight: h, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) }, { headless: true, connectomes: [C, C] });
  await sc.ready;
  const M = new Match(rules, [agentFromBot(greedyBot(), 'a'), agentFromBot(greedyBot(), 'b')], { seed: 3 });
  sc.setState(M.state);
  for (const human of [0, 1]) {
    const opp = 1 - human;
    sc.setFirstPerson(human);
    for (let k = 0; k < 90; k++) sc.render(1 / 30);
    sc.scene.updateMatrixWorld(true);
    const cam = sc.camera, holder = sc.world.brains[opp].group.parent, mine = sc.world.brains[human].group.parent;
    ok(sc.stats().bigBrain === opp && holder.visible && !mine.visible, `${tag} seat ${human}: the big map is the other fly's, yours hides`);
    ok(holder.scale.x > 1.5, `${tag} seat ${human}: the map is large (scale ${holder.scale.x})`);
    // the map disc on the screen: centre +- r along the camera axes
    const c = holder.getWorldPosition(new THREE.Vector3()), r = 0.62 * holder.scale.x;
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), ay = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const px = v => { const p = v.clone().project(cam); return [(p.x * 0.5 + 0.5) * w, (1 - (p.y * 0.5 + 0.5)) * h]; };
    const L = px(c.clone().addScaledVector(ax, -r))[0], R = px(c.clone().addScaledVector(ax, r))[0];
    const T = px(c.clone().addScaledVector(ay, r))[1], B = px(c.clone().addScaledVector(ay, -r))[1];
    ok(L >= 0 && R <= w && T >= 0 && B <= h, `${tag} seat ${human}: the map is in the frame (x ${L | 0}..${R | 0}, y ${T | 0}..${B | 0})`);
    ok(B - T > 0.15 * h, `${tag} seat ${human}: the map is big on the screen (${(100 * (B - T) / h) | 0} % of the height)`);
    const matTop = Math.min(px(seatPos(human, -MAT.u, 0, MAT.v0))[1], px(seatPos(human, MAT.u, 0, MAT.v0))[1], px(seatPos(human, 0, 0, MAT.v0))[1]);
    ok(B < matTop, `${tag} seat ${human}: the map is above your mat (map bottom ${B | 0}, mat top ${matTop | 0})`);
    let hit = 0;
    for (const o of sc.world.Z.hand[human]) {
      o.mesh.updateMatrixWorld();
      for (const [u, v] of [[-0.28, -0.39], [0.28, -0.39], [-0.28, 0.39], [0.28, 0.39], [0, 0]]) {
        const [x, y] = px(o.mesh.localToWorld(new THREE.Vector3(u, v, 0)));
        if (x > L && x < R && y > T && y < B) hit++;
      }
    }
    ok(sc.world.Z.hand[human].length > 0 && hit === 0, `${tag} seat ${human}: the map does not touch your hand (${hit} card points in the map box)`);
    const face = new THREE.Vector3(0, 0, 1).applyQuaternion(holder.getWorldQuaternion(new THREE.Quaternion()));
    const to = cam.position.clone().sub(c).setY(0).normalize();
    ok(face.setY(0).normalize().dot(to) > 0.999, `${tag} seat ${human}: the map faces the camera`);
  }
  // orbit: the map turns with the camera, and hides on the far side
  sc.setFirstPerson(0);
  for (let k = 0; k < 60; k++) sc.render(1 / 30);
  sc.orbitBy(-90, 0);
  for (let k = 0; k < 60; k++) sc.render(1 / 30);
  const holder = sc.world.brains[1].group.parent;
  const c = holder.getWorldPosition(new THREE.Vector3());
  const face = new THREE.Vector3(0, 0, 1).applyQuaternion(holder.quaternion).setY(0).normalize();
  ok(holder.visible && face.dot(sc.camera.position.clone().sub(c).setY(0).normalize()) > 0.999, `${tag}: after an orbit the map still faces the camera`);
  sc.orbitBy(-600, 0);          // about 3.9 rad: to the far side
  for (let k = 0; k < 90; k++) sc.render(1 / 30);
  ok(sc.camera.position.z < 0 && !holder.visible, `${tag}: on the far side the map hides (camera z ${sc.camera.position.z.toFixed(1)})`);
  sc.seatView();
  for (let k = 0; k < 90; k++) sc.render(1 / 30);
  ok(holder.visible, `${tag}: back at the seat the map shows again`);
  sc.setFirstPerson(null); sc.render(1 / 30);
  ok(sc.stats().bigBrain === -1 && sc.world.brains.every(b => b.group.parent.scale.x === 1 && b.group.parent.visible), `${tag}: watch mode: both maps small and shown`);
  sc.dispose();
}

// fire: the decisions of the pretrained fly fire the big map with their trace
{
  const CB = JSON.parse(readFileSync(join(ROOT, pre.wiring?.B?.file || 'data/connectome.json'), 'utf8'));
  const fly = Fly.fromJSON(CB, pre.B);
  const sc = createDuelScene(null, { headless: true, connectomes: [C, CB] });
  await sc.ready;
  const M = new Match(rules, [agentFromBot(greedyBot(), 'you'), agentFromFly(fly, 'Fly B', { explore: 0 })], { seed: 21 });
  sc.setState(M.state); sc.setFirstPerson(0);
  const bm = sc.world.brains[1], got = [];
  const real = bm.fire.bind(bm);
  bm.fire = (trace, ...rest) => { got.push(trace); return real(trace, ...rest); };
  let flyRecs = 0, n = 0;
  const traces = [];
  for (let k = 0; k < 40; k++) {
    const r = M.next(); if (!r) break;
    if (r.who === 1 && r.trace) { flyRecs++; traces.push(r.trace); }
    let done = false;
    sc.play(r).then(() => { done = true; });
    for (let i = 0; i < 6000 && !done; i++) { sc.render(1 / 30); await null; }
    n++;
  }
  ok(flyRecs > 3 && got.length === flyRecs, `fire: ${flyRecs} fly decisions, ${got.length} fires of the big map`);
  ok(got.every((t, i) => t === traces[i]), 'fire: each fire gets the real trace of its decision');
  ok(bm.group.parent.visible && sc.stats().bigBrain === 1, 'fire: the big map shows in play mode');
  sc.dispose();
}

console.log(`fly3d-bigbrain: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

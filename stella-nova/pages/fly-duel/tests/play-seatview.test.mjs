// ============================================================================
//  FLY DUEL  ·  node tests for the clear seat view of play mode
//  (node tests/play-seatview.test.mjs)
// ----------------------------------------------------------------------------
//  User (2026-10-12, verbatim): "it's very hard to see my hand/cards if
//  i'm in the drivers seat because the fly model is constantly blocking
//  my board".
//
//    occlusion  in first person (960x540 and 390x760) a ray from the
//               camera through each of your creatures and lands hits that
//               card first, not your fly or the fan it holds
//    grid       no ray of a 24 x 16 grid over the frame hits your fly or
//               its fan first: they cover no part of the view
//    other fly  the fly you play against stays visible and in the frame
//    picks      a tap on the place of your hidden fly picks no player
//    watch      setFirstPerson(null) shows both flies and both fans again
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
const { createDuelScene } = await import('../ui/fly3d/scene.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

// a mesh shows when it and every parent are visible
const shows = o => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
const under = (o, root) => { for (let x = o; x; x = x.parent) if (x === root) return true; return false; };

for (const [w, h] of [[960, 540], [390, 760]]) {
  const tag = `${w}x${h}`;
  const canvas = { clientWidth: w, clientHeight: h, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) };
  const sc = createDuelScene(canvas, { headless: true });
  await sc.ready;
  const M = new Match(rules, [agentFromBot(greedyBot(), 'a'), agentFromBot(greedyBot(), 'b')], { seed: 8 });
  sc.setState(M.state); sc.setSpeed(3);
  sc.setFirstPerson(0);
  let r, k = 0;
  while (k++ < 14 && (r = M.next())) {
    let done = false;
    sc.play(r).then(() => { done = true; });
    for (let i = 0; i < 6000 && !done; i++) { sc.render(1 / 30); await null; }
  }
  for (let i = 0; i < 60; i++) sc.render(1 / 30);
  const { Z, flies, mirror } = sc.world;
  const cam = sc.camera;
  cam.updateMatrixWorld();
  sc.scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const meshes = [];
  sc.scene.traverse(o => { if ((o.isMesh || o.isSprite) && shows(o)) meshes.push(o); });
  const firstAt = (nx, ny) => {
    ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
    return ray.intersectObjects(meshes, false)[0]?.object || null;
  };
  const seatFly = o => under(o, flies[0].holder);
  const seatFan = o => Z.hand[0].some(c => under(o, c.mesh));

  // occlusion of your creatures and lands
  let tried = 0, clear = 0;
  const blocked = [];
  for (const x of mirror.players[0].battlefield) {
    const c = Z.perms.get(x.uid);
    if (!c) continue;
    c.mesh.updateMatrixWorld();
    const at = c.mesh.localToWorld(new THREE.Vector3(0, 0.3, 0)).project(cam);
    if (Math.abs(at.x) > 0.98 || Math.abs(at.y) > 0.98) continue;
    tried++;
    const hit = firstAt(at.x, at.y);
    if (hit && !seatFly(hit) && !seatFan(hit)) clear++; else blocked.push(x.id);
  }
  ok(tried >= 3 && clear === tried, `${tag}: your creatures and lands are not covered by your fly or its fan (${clear} of ${tried} clear${blocked.length ? `, covered: ${blocked.join(' ')}` : ''})`);

  // the whole frame
  let cover = 0;
  for (let i = 0; i < 24; i++) for (let j = 0; j < 16; j++) {
    const hit = firstAt(-1 + (i + 0.5) / 12, -1 + (j + 0.5) / 8);
    if (hit && (seatFly(hit) || seatFan(hit))) cover++;
  }
  ok(cover === 0, `${tag}: your fly and its fan cover no grid point of the frame (${cover} of 384)`);

  // the fly you play against
  const head = new THREE.Box3().setFromObject(flies[1].holder).getCenter(new THREE.Vector3()).project(cam);
  ok(shows(flies[1].holder) && Math.abs(head.x) < 1 && Math.abs(head.y) < 1, `${tag}: the other fly shows and is in the frame`);
  ok(!shows(flies[0].holder) && Z.hand[0].every(c => !c.mesh.visible) && Z.hand[1].every(c => c.mesh.visible), `${tag}: only your fly and your fan hide`);

  // a tap where your fly was picks nothing of it
  const fp = new THREE.Box3().setFromObject(flies[0].holder).getCenter(new THREE.Vector3()).project(cam);
  if (Math.abs(fp.x) < 1 && Math.abs(fp.y) < 1) {
    const hit = sc.pickPermanent((fp.x * 0.5 + 0.5) * w, (1 - (fp.y * 0.5 + 0.5)) * h);
    ok(!hit || hit.uid != null || hit.player !== 0, `${tag}: your hidden fly is not a tap target`);
  }

  sc.setFirstPerson(null);
  ok(flies.every(f => f.holder.visible) && Z.hand.every(H => H.every(c => c.mesh.visible)), `${tag}: watch mode shows both flies and both fans`);
  sc.dispose();
}

console.log(`play-seatview: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

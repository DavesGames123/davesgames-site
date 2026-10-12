// ============================================================================
//  FLY DUEL  ·  node tests for the hidden cards of play mode
//  (node tests/fly3d-hidden.test.mjs)
// ----------------------------------------------------------------------------
//  In play mode (setFirstPerson(seat)) the hand and the library of the
//  other fly show the question-mark back on every side, and nothing gives
//  their card ids. Your own hand stays face up. Watch mode is unchanged.
//
//    sphere     cameras on a sphere around the table: a ray to each hand
//               card of the other fly hits a question-mark cap, never a
//               face texture; the library top is the question mark
//    ids        mesh.userData.card is null, pickCard gives id null, the
//               mystery texture is not a face texture of any card
//    own hand   the human's hand keeps its face textures and its ids
//    watch      setFirstPerson(null): every hand shows its faces again
//    top 3      ui/play/controller.js publicTop hides the cards that the
//               fly did not play, keeps the move that it made
//
//  A small OffscreenCanvas stub gives the scene real CanvasTextures in
//  node, so the test can tell a face texture from the mystery texture.
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

// A 2D context that accepts every call. Numbers read from it are 10.
function stubCtx() {
  const store = {};
  const fn = () => proxy;
  const proxy = new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 10;
      if (k === 'then') return undefined;
      if (k in store) return store[k];
      if (k === 'width' || k === 'actualBoundingBoxAscent' || k === 'actualBoundingBoxDescent') return 10;
      return fn;
    },
    set(t, k, v) { store[k] = v; return true; },
    apply() { return proxy; },
  });
  return proxy;
}
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; this._g = stubCtx(); } getContext() { return this._g; } };

const THREE = await import('three');
const rules = await import('../game/rules.js');
const { greedyBot } = await import('../game/bots.js');
const { Match, agentFromBot } = await import('../ui/match.js');
const { createDuelScene, TABLE } = await import('../ui/fly3d/scene.js');
const { publicTop, HIDDEN_MOVE } = await import('../ui/play/controller.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

async function playSome(sc, M, n) {
  let r, k = 0;
  while (k++ < n && (r = M.next())) {
    let done = false;
    sc.play(r).then(() => { done = true; });
    for (let i = 0; i < 6000 && !done; i++) { sc.render(1 / 30); await null; }
  }
}

const w = 960, h = 540;
const canvas = { clientWidth: w, clientHeight: h, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) };
const sc = createDuelScene(canvas, { headless: true });
await sc.ready;
const { W, Z } = sc.world;
ok(W.mysteryMat?.map?.userData?.mystery === true, 'the mystery material has the question-mark texture (canvas stub works)');
const M = new Match(rules, [agentFromBot(greedyBot(), 'a'), agentFromBot(greedyBot(), 'b')], { seed: 11 });
sc.setState(M.state); sc.setSpeed(3);
sc.render(1 / 30);

// watch mode: faces everywhere
const faceMats = o => o.mesh.material.slice(0, 2);
const isFace = m => !!m?.map && !m.map.userData?.mystery && m !== W.backMat;
ok(Z.hand[1].length > 0 && Z.hand[1].every(o => isFace(o.mesh.material[0]) && o.mesh.userData.card === o.id), 'watch mode: the hand of Fly B shows faces');
ok(sc.stats().hidden === -1, 'watch mode: no hidden seat');

for (const human of [0, 1]) {
  const opp = 1 - human;
  sc.setFirstPerson(human);
  await playSome(sc, M, 6);
  for (let k = 0; k < 10; k++) sc.render(1 / 30);
  const H = Z.hand[opp];
  ok(H.length > 0, `seat ${human}: the other fly has cards in hand (${H.length})`);
  ok(sc.stats().hidden === opp, `seat ${human}: stats().hidden is the other seat`);
  ok(H.every(o => faceMats(o).every(m => m === W.mysteryMat)), `seat ${human}: both caps of every opposing hand card are the question mark`);
  ok(H.every(o => o.mesh.userData.card === null), `seat ${human}: no card id on an opposing hand mesh`);
  const faceTexes = new Set(); for (const o of [...Z.hand[human], ...Z.perms.values()]) if (o.front.map) faceTexes.add(o.front.map);
  ok(!faceTexes.has(W.mysteryMat.map), `seat ${human}: the question-mark texture is not a face texture`);
  ok(sc.world.piles[opp].lib.material[2] === W.mysteryMat && sc.world.piles[human].lib.material[2] === W.backMat, `seat ${human}: the opposing library shows the question mark, yours the back`);
  ok(Z.hand[human].every(o => isFace(o.mesh.material[0]) && o.mesh.userData.card === o.id), `seat ${human}: your own hand stays face up`);

  // cameras on a sphere around the table: what the camera sees of each
  // opposing hand card is a question-mark cap
  const ray = new THREE.Raycaster();
  let views = 0, hits = 0, bad = 0, pickBad = 0, picks = 0;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 12; j++) {
    const el = -0.35 + 1.5 * (i / 5), az = (j / 12) * Math.PI * 2, r = 9;
    sc.camera.position.set(Math.sin(az) * Math.cos(el) * r, TABLE.y + Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
    sc.camera.lookAt(0, TABLE.y, 0); sc.camera.updateMatrixWorld();
    views++;
    for (const o of H) {
      o.mesh.updateMatrixWorld();
      const at = o.mesh.localToWorld(new THREE.Vector3(0, 0.1, 0));
      ray.set(sc.camera.position, at.clone().sub(sc.camera.position).normalize());
      const hit = ray.intersectObject(o.mesh, false)[0];
      if (!hit) continue;
      hits++;
      const m = o.mesh.material[hit.face.materialIndex];
      if (hit.face.materialIndex < 2 && m !== W.mysteryMat) bad++;
      if (isFace(m)) bad++;
      // pickCard at the projected point
      const v = at.clone().project(sc.camera);
      if (Math.abs(v.x) < 1 && Math.abs(v.y) < 1) {
        const c = sc.pickCard((v.x * 0.5 + 0.5) * w, (1 - (v.y * 0.5 + 0.5)) * h);
        if (c && c.seat === opp) { picks++; if (c.id !== null) pickBad++; }
      }
    }
  }
  ok(hits > views && bad === 0, `seat ${human}: ${views} camera places, ${hits} rays on opposing hand cards, ${bad} saw a face`);
  ok(picks > 0 && pickBad === 0, `seat ${human}: pickCard on the opposing hand gives no id (${picks} picks, ${pickBad} with an id)`);
}

sc.setFirstPerson(null);
sc.render(1 / 30);
ok(Z.hand[0].concat(Z.hand[1]).every(o => isFace(o.mesh.material[0]) && o.mesh.material[1] === W.backMat && o.mesh.userData.card === o.id), 'watch mode again: every hand shows faces and ids');
ok(sc.world.piles[0].lib.material[2] === W.backMat && sc.world.piles[1].lib.material[2] === W.backMat, 'watch mode again: both libraries show the back');
sc.dispose();

// publicTop: the moves that the fly did not make hide their cards
const legal = [{ type: 'land', card: 'amber-ridge' }, { type: 'cast', card: 'heat-pulse', target: 'p0' }, { type: 'pass' }, { type: 'cast', card: 'ember-gnat' }];
const top = [{ i: 1, text: 'Fly B casts Heat Pulse at You.', value: 0.4, chosen: false }, { i: 0, text: 'Fly B plays Amber Ridge.', value: 0.3, chosen: true }, { i: 2, text: 'pass', value: 0.1, chosen: false }, { i: 3, text: 'Fly B casts Ember Gnat.', value: 0.0, chosen: false }];
const pt = publicTop(top, legal);
ok(pt[0].text === HIDDEN_MOVE && pt[0].value === 0.4 && pt[3].text === HIDDEN_MOVE, 'publicTop: an unplayed card is hidden, its value stays');
ok(pt[1].text === top[1].text && pt[2].text === 'pass', 'publicTop: the made move and a pass keep their text');
ok(!JSON.stringify(pt.filter(t => t.hidden)).match(/Heat|Ember/), 'publicTop: no hidden card name in the rows');

console.log(`fly3d-hidden: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

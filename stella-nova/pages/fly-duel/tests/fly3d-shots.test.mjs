// ============================================================================
//  FLY DUEL  ·  node tests: the director shots keep the board in view
//  (node tests/fly3d-shots.test.mjs)
// ----------------------------------------------------------------------------
//  The 1600x900 watch capture of 2026-10-12 (camera "director", turn 3)
//  showed the close shot: a fly from near, the deck box in a corner and
//  no board. ui/fly3d/scene.js shotPose now keeps the centre of the board
//  in each shot that looks at the table (all but the crowd shot, which
//  looks at the crowd on purpose).
//
//    forced   each shot kind, both seats, cut to and held: the centre of
//             the board is in the frame and no near object (a fly, a
//             chair, a deck box) covers more than 20 % of it
//    game     a whole watch game with the director at speed 1: the same
//             two checks on each shot once it has run 0.9 s
//  Sizes: the watch view (the bar off, the brain squares of style.css
//  WATCH SQUARES, brainpanels.js fillFrame) at 1600x900, 1920x1080 and
//  390x760.
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
const { SHOTS } = await import('../ui/fly3d/director.js');
const { fillFrame } = await import('../ui/fly3d/brainpanels.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const OFF_TABLE = new Set(['crowd']);
const MAX_COVER = 0.2;

// The watch view of main.js syncClear at W x H.
function watchView(W, H) {
  const BAR = W >= 760 ? 62 : 96, h = H - BAR, wide = W / H >= 1.1 && W >= 700;
  const bpw = Math.min(640, Math.max(220, 0.31 * W)), bph = Math.min(250, Math.max(118, 0.22 * H));
  const sq = wide ? Math.min(0.6 * h, 0.92 * bpw) : bph;
  const squares = wide ? [{ left: 0, top: 0, right: bpw, bottom: sq }, { left: W - bpw, top: 0, right: W, bottom: sq }]
    : [{ left: 0, top: 52, right: sq, bottom: 52 + sq }, { left: W - sq, top: h - sq, right: W, bottom: h }];
  return { w: W, h, clear: fillFrame({ left: 0, top: 0, right: W, bottom: h }, squares, wide) };
}

const ray = new THREE.Raycaster();
const NX = 24, NY = 14;
// the near objects and the part of the frame that each one covers (a grid of rays)
function covers(sc) {
  sc.scene.updateMatrixWorld(true); sc.camera.updateMatrixWorld();
  const objs = sc.world.flies.map((f, i) => [`fly ${i}`, f.holder]);
  sc.scene.traverse(o => { if ((o.name === 'deck-box' || o.name === 'folding-chair') && o.visible) objs.push([o.name, o]); });
  let max = 0, who = '';
  const v = new THREE.Vector2();
  for (const [n, o] of objs) {
    let k = 0;
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
      ray.setFromCamera(v.set((i + 0.5) / NX * 2 - 1, (j + 0.5) / NY * 2 - 1), sc.camera);
      if (ray.intersectObject(o, true).length) k++;
    }
    if (k / (NX * NY) > max) { max = k / (NX * NY); who = n; }
  }
  return { max, who };
}
const centreIn = sc => { const c = new THREE.Vector3(0, TABLE.y, 0).project(sc.camera); return Math.abs(c.x) < 0.97 && Math.abs(c.y) < 0.97 && c.z < 1 ? null : `${c.x.toFixed(2)},${c.y.toFixed(2)}`; };

for (const [W, H] of [[1600, 900], [1920, 1080], [390, 760]]) {
  const V = watchView(W, H), tag = `${W}x${H}`;
  // --- forced shots
  {
    const sc = createDuelScene({ clientWidth: V.w, clientHeight: V.h }, { headless: true });
    await sc.ready;
    sc.setState(rules.newGame({ seed: 3, decks: ['amber-pollen', 'moss-rot'] }));
    sc.setClear(V.clear);
    const out = [], near = [];
    for (const shot of Object.keys(SHOTS).filter(s => s !== 'seat' && !OFF_TABLE.has(s))) for (const p of [0, 1]) {
      sc.shoot(shot, p, { cut: true });
      for (let k = 0; k < 40; k++) sc.render(1 / 30);
      const c = centreIn(sc);
      if (c) out.push(`${shot} ${p} at ${c}`);
      const cv = covers(sc);
      if (cv.max > MAX_COVER) near.push(`${shot} ${p}: ${cv.who} ${(100 * cv.max).toFixed(0)} %`);
    }
    ok(out.length === 0, `${tag} forced: each shot keeps the centre of the board in the frame (${out.join('; ')})`);
    ok(near.length === 0, `${tag} forced: no near object covers more than ${100 * MAX_COVER} % of a shot (${near.join('; ')})`);
    sc.dispose();
  }
  // --- a director game
  {
    const sc = createDuelScene({ clientWidth: V.w, clientHeight: V.h }, { headless: true });
    await sc.ready;
    const M = new Match(rules, [agentFromBot(greedyBot(), 'a'), agentFromBot(greedyBot(), 'b')], { seed: 5, decks: ['amber-pollen', 'moss-rot'] });
    sc.setState(M.state); sc.setSpeed(1);
    sc.setClear(V.clear);
    const D = sc.world.dir, seen = {}, out = [], near = [];
    let r, recs = 0;
    while ((r = M.next()) && recs++ < 400) {
      let done = false, last = -1;
      sc.play(r).then(() => { done = true; });
      for (let k = 0; k < 20000 && !done; k++) {
        sc.render(1 / 30); await null;
        const st = D.state;
        if (sc.world.sceneT - st.since < 0.9 || st.n === last) continue;
        last = st.n;
        seen[st.shot] = (seen[st.shot] || 0) + 1;
        if (OFF_TABLE.has(st.shot)) continue;
        const c = centreIn(sc);
        if (c) out.push(`${st.shot} ${st.p} at ${c}`);
        const cv = covers(sc);
        if (cv.max > MAX_COVER) near.push(`${st.shot} ${st.p}: ${cv.who} ${(100 * cv.max).toFixed(0)} %`);
      }
    }
    ok(Object.keys(seen).length >= 6, `${tag} game: shots checked: ${JSON.stringify(seen)}`);
    ok(out.length === 0, `${tag} game: each shot keeps the centre of the board in the frame (${out.length} out: ${out.slice(0, 4).join('; ')})`);
    ok(near.length === 0, `${tag} game: no near object covers more than ${100 * MAX_COVER} % of a shot (${near.slice(0, 4).join('; ')})`);
    sc.dispose();
  }
}

console.log(`fly3d-shots: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

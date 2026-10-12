// ============================================================================
//  FLY DUEL  ·  node tests for the side-table games
//  (node tests/fly3d-sidegames.test.mjs)
// ----------------------------------------------------------------------------
//  Checks ui/fly3d/sidegames.js inside buildHall (ui/fly3d/hall.js), with
//  no browser. The hall runs 400 s of frames (desktop) and 300 s (phone).
//    real      each side table finishes games; a replay of each finished
//              game from its seed and decks takes only legal actions
//              (legalActions + actionKey) and ends with the same result
//    decks     between two games both players change deck (never the
//              same pair twice in a row), decks come from all 13; the deck
//              box on the table is the deck of the game, and its print
//              uses the deck colours; the feature table setDeckBox
//    cards     at sampled frames the card instances of each table equal
//              the rules state (hand, lands, creatures, graveyard top) and
//              each instance shows the atlas cell of its card
//    atlas     the atlas has a cell for every card of every deck, every
//              token, the back, life 0..40 and every deck box
//    shader    the uvRect patch lands once in the r160 standard shader
//    budget    two draw calls for the side tables, triangles and instance
//              caps on desktop and phone, the update time per frame
//    pause     no step for a table out of the camera view, none when the
//              hall is not drawn, none while the document is hidden
//    gestures  a land or a cast lifts the right front leg of that fly
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
const { buildHall, HALL } = await import('../ui/fly3d/hall.js');
const { SIDE, sideAtlas, drawDeckBoxFace, deckHexes } = await import('../ui/fly3d/sidegames.js');
const { TABLE: T } = await import('../ui/fly3d/scene.js');
const rules = await import('../game/rules.js');
const { DECKS, DECK_ORDER, CARDS, TOKENS, CARD } = await import('../game/cards.js');
const { colourInfo } = await import('../ui/cardface.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL', m); } };
const seatPos = (p, u, y, v, out = new THREE.Vector3()) => (p === 0 ? out.set(u, T.y + y, v) : out.set(-u, T.y + y, -v));
const LAYOUT = { y: T.y, halfLen: T.halfLen, halfDepth: T.halfDepth, seatV: T.seatV, seatTop: T.seatTop, seatPos };
const sorted = a => a.slice().sort().join();

// --- atlas -------------------------------------------------------------------------
{
  const A = sideAtlas({ coarse: false });
  const need = new Set(['back', 'edge']);
  for (const d of DECK_ORDER) { for (const [id] of DECKS[d].list) need.add(id); need.add('box:' + d); }
  for (const c of TOKENS) need.add(c.id);
  for (let n = 0; n <= SIDE.lifeMax; n++) need.add('life:' + n);
  const miss = [...need].filter(k => !A.cells.has(k));
  ok(miss.length === 0, `atlas: a cell for every card, token, back, life and deck box (${miss.slice(0, 5)} missing)`);
  ok(A.cells.size === CARDS.length + TOKENS.length + 2 + SIDE.lifeMax + 1 + DECK_ORDER.length, `atlas: ${A.cells.size} cells`);
  const r = A.rect(CARDS[5].id);
  ok(r.every(v => v >= 0 && v <= 1) && Math.abs(r[2] - (A.cw - 1) / A.W) < 1e-9, 'atlas: a uv rect inside the atlas');
  ok(A.W * A.H <= 1280 * 1280 && sideAtlas({ coarse: true }).W * sideAtlas({ coarse: true }).H < A.W * A.H, `atlas: ${A.W} x ${A.H} px (phone smaller)`);
}

// --- deck box print: the deck colours ---------------------------------------------
{
  for (const d of DECK_ORDER) {
    const fills = new Set();
    const stub = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { if (k === 'fillStyle') fills.add(String(v).toLowerCase()); o[k] = v; return true; } });
    drawDeckBoxFace(stub, 64, 90, d);
    const want = DECKS[d].colours.map(k => colourInfo(k).hex.toLowerCase());
    ok(want.length > 0 && want.every(h => fills.has(h)) && sorted(deckHexes(d).map(h => h.toLowerCase())) === sorted(want), `deck box ${d}: prints ${want.join(' ')}`);
  }
}

// --- run the hall ------------------------------------------------------------------
function run(coarse, seconds) {
  const hall = buildHall({ coarse, seed: 7, layout: LAYOUT });
  const SG = hall.extras.games;
  const ms = [];
  let cardBad = 0, cardChecks = 0, uvBad = 0, perFrameBad = 0, gestureHit = 0, gestureMiss = 0, boxBad = 0;
  const pending = [];
  const rect = [0, 0, 0, 0];
  const uv = SG.cardMesh.geometry.getAttribute('uvRect');
  for (let f = 0; f < seconds * 30; f++) {
    const before = SG.games.map(G => G.actions);
    const t0 = performance.now();
    hall.update(1 / 30);
    ms.push(performance.now() - t0);
    SG.games.forEach((G, t) => {
      const n = G.actions - before[t];
      if (n > 1) perFrameBad++;
      // a land or a cast is an action of the active player (step does not
      // change the active player in main)
      if (n === 1 && G.last && (G.last.type === 'land' || G.last.type === 'cast') && !G.state.result) pending.push({ G, p: G.state.active, until: f + 15 });
    });
    // gestures: the fly of the player that played a land or a cast
    for (let k = pending.length - 1; k >= 0; k--) {
      const q = pending[k];
      const P = hall.extras.herd.pose[q.G.flies[q.p]];
      if (P.legR > 0.4) { gestureHit++; pending.splice(k, 1); }
      else if (f > q.until) { gestureMiss++; pending.splice(k, 1); }
    }
    // cards = rules state, every 2 s
    if (f % 60 === 59) {
      SG.games.forEach((G, t) => {
        if (G.phase !== 'play') return;
        const { cards, boxes } = SG.cardsOn(t);
        for (let p = 0; p < 2; p++) {
          const P = G.state.players[p], mine = cards.filter(c => c.p === p);
          const hand = mine.filter(c => c.zone === 'hand').map(c => c.id);
          const field = mine.filter(c => c.zone === 'land' || c.zone === 'creature').map(c => c.id);
          const grave = mine.filter(c => c.zone === 'grave').map(c => c.id);
          cardChecks++;
          if (sorted(hand) !== sorted(P.hand) || sorted(field) !== sorted(P.battlefield.map(x => x.id)) || sorted(grave) !== sorted(P.graveyard.slice(-1))) cardBad++;
          const box = boxes.find(b => b.p === p && b.deck);
          if (!box || box.deck !== G.state.decks[p] || box.cell !== 'box:' + G.state.decks[p]) boxBad++;
        }
        for (const c of cards) {
          if (c.inst == null) continue;
          SG.atlas.rect(c.id, rect);
          if (Math.abs(uv.getX(c.inst) - rect[0]) > 1e-6 || Math.abs(uv.getY(c.inst) - rect[1]) > 1e-6) uvBad++;
        }
      });
    }
  }
  return { hall, SG, ms, cardBad, cardChecks, uvBad, perFrameBad, gestureHit, gestureMiss, boxBad };
}

for (const coarse of [false, true]) {
  const tag = coarse ? 'phone' : 'desktop';
  const R = run(coarse, coarse ? 300 : 400);
  const { hall, SG } = R;
  ok(SG.games.length === HALL.extraTables[coarse ? 1 : 0], `${tag}: ${SG.games.length} side tables play`);
  // real games, replayed
  let replayBad = 0, games = 0, illegal = 0;
  const used = new Set();
  for (const G of SG.games) {
    ok(G.history.length >= 2, `${tag} table ${G.t}: ${G.history.length} games finished (${G.kinds.join(' vs ')})`);
    for (const h of G.history) {
      games++;
      h.decks.forEach(d => used.add(d));
      let s = rules.newGame({ seed: h.seed, decks: h.decks, first: h.first, log: false });
      for (const key of h.actions) {
        const a = rules.legalActions(s).find(x => rules.actionKey(x) === key);
        if (!a) { illegal++; break; }
        s = rules.step(s, a);
      }
      if (!rules.isOver(s) || s.result.winner !== h.result.winner || s.result.reason !== h.result.reason) replayBad++;
    }
    // decks change between games
    let same = 0;
    for (let k = 1; k < G.history.length; k++) {
      const a = G.history[k - 1].decks, b = G.history[k].decks;
      if (a[0] === b[0] || a[1] === b[1] || a.join() === b.join()) same++;
    }
    ok(same === 0, `${tag} table ${G.t}: both decks change between games (${G.history.map(h => h.decks.join('+')).join(' -> ')})`);
    ok(G.history.every(h => h.decks.every(d => DECK_ORDER.includes(d))), `${tag} table ${G.t}: decks from the 13`);
  }
  ok(illegal === 0 && replayBad === 0, `${tag}: ${games} games replay with legal actions only and the same result (${illegal} illegal, ${replayBad} differ)`);
  ok(used.size >= (coarse ? 4 : 8), `${tag}: ${used.size} different decks in use`);
  ok(R.cardChecks > 20 && R.cardBad === 0, `${tag}: the cards on the side tables equal the rules state (${R.cardBad} of ${R.cardChecks} differ)`);
  ok(R.uvBad === 0, `${tag}: each card instance shows its atlas cell (${R.uvBad} wrong)`);
  ok(R.boxBad === 0, `${tag}: the deck box is the deck of the game (${R.boxBad} wrong)`);
  ok(R.perFrameBad === 0, `${tag}: at most one action per table per frame`);
  ok(R.gestureHit > 20 && R.gestureMiss <= R.gestureHit * 0.05, `${tag}: a land or a cast lifts the leg of its fly (${R.gestureHit} hit, ${R.gestureMiss} miss)`);
  // the uvRect patch lands in the standard vertex shader of three r160
  {
    const sh = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: '' };
    SG.cardMesh.material.onBeforeCompile(sh);
    ok(/^attribute vec4 uvRect;/.test(sh.vertexShader) && sh.vertexShader.split('vMapUv = vMapUv * uvRect.zw + uvRect.xy;').length === 2 && SG.cardMesh.geometry.getAttribute('uvRect')?.itemSize === 4, `${tag}: the atlas shader patch lands once`);
  }
  // budget
  const st = hall.stats().side;
  const sideMeshes = [];
  hall.group.traverse(o => { if (o.isMesh && /^side-/.test(o.name)) sideMeshes.push(o); });
  ok(sideMeshes.length === 2 && st.drawCalls === 2, `${tag}: ${sideMeshes.length} draw calls for the side tables`);
  ok(st.cards <= SG.games.length * SIDE.perTable && st.tris < (coarse ? 3000 : 8000), `${tag}: ${st.cards} card and ${st.boxes} box instances, ${st.tris} triangles`);
  const flyTris = hall.stats().flyTris;
  ok(flyTris + st.tris < (coarse ? 40000 : 120000), `${tag}: hall flies + side tables ${flyTris + st.tris} triangles`);
  const ms = R.ms.slice().sort((a, b) => a - b), mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  const p95 = ms[Math.floor(ms.length * 0.95)], p99 = ms[Math.floor(ms.length * 0.99)], max = ms[ms.length - 1];
  console.log(`${tag}: hall.update ms mean ${mean.toFixed(3)} p95 ${p95.toFixed(3)} p99 ${p99.toFixed(3)} max ${max.toFixed(2)} over ${ms.length} frames`);
  ok(mean < 0.5 && p95 < 1, `${tag}: update time mean ${mean.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`);
  // pause: a camera that looks away from every side table
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  cam.position.set(0, 30, 0); cam.lookAt(0, 60, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  let a0 = SG.stats().actions;
  for (let f = 0; f < 300; f++) { SG.setCamera(cam); hall.update(1 / 30); }
  ok(SG.stats().actions === a0 && SG.games.every(G => !G.visible), `${tag}: no step for tables out of view`);
  // a camera on the hall: they play again
  cam.position.set(0, 12, 0); cam.lookAt(0, 0, 0.001); cam.fov = 170; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  for (let f = 0; f < 300; f++) { SG.setCamera(cam); hall.update(1 / 30); }
  ok(SG.stats().actions > a0, `${tag}: tables in view step again`);
  // the hall is not drawn (no camera for > 0.5 s: 15 frames of grace)
  for (let f = 0; f < 20; f++) hall.update(1 / 30);
  a0 = SG.stats().actions;
  for (let f = 0; f < 300; f++) hall.update(1 / 30);
  ok(SG.stats().actions === a0, `${tag}: no step while the hall is not drawn`);
  // document hidden
  globalThis.document = { hidden: true };
  a0 = SG.stats().actions;
  for (let f = 0; f < 300; f++) { SG.setCamera(cam); hall.update(1 / 30); }
  ok(SG.stats().actions === a0, `${tag}: no step while the document is hidden`);
  delete globalThis.document;
  // the feature table deck boxes
  hall.setDeckBox(0, 'moss-rot'); hall.setDeckBox(1, 'amber');
  ok(hall.deckOf(0) === 'moss-rot' && hall.deckOf(1) === 'amber', `${tag}: setDeckBox sets the feature table decks`);
  hall.dispose();
}

console.log(`fly3d-sidegames: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

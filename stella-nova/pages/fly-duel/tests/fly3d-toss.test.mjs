// ============================================================================
//  FLY DUEL  ·  node tests for the sore loser  (node tests/fly3d-toss.test.mjs)
// ----------------------------------------------------------------------------
//  The user asked: "we should have the loser throw their cards and put
//  their head down on the table if they lose". This file checks the
//  table side of it (the fly clip has tests/fly3d-headdown.test.mjs):
//    choreo    a game that ends with a winner gives a toss step for the
//              loser at the time of the win step, with its hand size; a
//              draw gives none; reduced motion makes it a cut; the
//              mirror does not change
//    scene     whole bot games through the headless scene with the real
//              fly: the loser plays headDown and its head ends at table
//              height, every thrown card flies clear of the table slab
//              and comes to rest on the table (or the cards on it) or on
//              the floor, the winner keeps raiseArms, the director goes
//              toss -> win; reduced motion puts the cards at rest at once;
//              play mode: when the fly loses it throws, when you lose your
//              seat does not throw and the fly celebrates; the fedora is
//              on the fly you play against only; a new game clears it all
//              (after the change of game, ui/fly3d/regame.js)
//    (the director checks of the toss shot are in
//    tests/fly3d-director.test.mjs)
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

const rules = await import('../game/rules.js');
const CARDS_MOD = await import('../game/cards.js');
const DECK_IDS = CARDS_MOD.DECK_ORDER || Object.keys(CARDS_MOD.DECKS || { amber: 1, moss: 1 });
const { greedyBot, randomBot } = await import('../game/bots.js');
const { Match, agentFromBot } = await import('../ui/match.js');
const THREE = await import('three');
const { choreograph, mirrorOf, mirrorDiff, MOVE_OPS, TIMING } = await import('../ui/fly3d/choreo.js');
const { createDuelScene, TABLE } = await import('../ui/fly3d/scene.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
function rngf(s) { let a = s >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// The last record of a bot game (the one that ends it).
function botMatch(seed) {
  const n = DECK_IDS.length, decks = [DECK_IDS[seed % n], DECK_IDS[(seed * 5 + 1) % n]];
  const mk = i => ((seed + i) % 3 === 0 ? agentFromBot(randomBot(rngf(seed * 7 + i)), 'random') : agentFromBot(greedyBot(), 'greedy'));
  return new Match(rules, [mk(0), mk(1)], { seed, decks });
}
function allRecords(seed) {
  const M = botMatch(seed), start = structuredClone(M.state), recs = [];
  let r;
  while ((r = M.next())) recs.push(r);
  return { start, recs };
}
function finalRecord(seed) { const { recs } = allRecords(seed); return recs[recs.length - 1] || null; }

// --- choreo -------------------------------------------------------------------------
{
  ok(MOVE_OPS.has('toss'), 'toss is a move op (reduced motion cuts it)');
  ok(TIMING.toss > 0, 'TIMING.toss is set');
  let wins = 0, losers = [0, 0];
  for (let g = 1; g <= 16; g++) {
    const rec = finalRecord(g);
    const res = rec?.after?.result;
    if (!res) continue;
    const c = choreograph(rec);
    const win = c.steps.find(s => s.op === 'win'), toss = c.steps.filter(s => s.op === 'toss');
    ok(!!win, `game ${g}: the last record has a win step`);
    if (res.winner === 0 || res.winner === 1) {
      wins++;
      const L = 1 - res.winner;
      losers[L]++;
      ok(toss.length === 1, `game ${g}: one toss step on a loss (${toss.length})`);
      const t = toss[0];
      if (!t) continue;
      ok(t.p === L && t.winner === res.winner, `game ${g}: the toss is by the loser ${L}`);
      ok(t.n === rec.after.players[L].hand.length, `game ${g}: the toss throws the whole hand (${t.n} of ${rec.after.players[L].hand.length})`);
      ok(Math.abs(t.at - win.at) < 1e-9 && c.steps.indexOf(t) > c.steps.indexOf(win), `game ${g}: the toss starts with the win step`);
      ok(t.at + t.dur <= c.total + 1e-9, `game ${g}: the toss ends inside the record`);
      ok(mirrorDiff(c.mirror, mirrorOf(rec.after)).length === 0, `game ${g}: the mirror after the toss equals record.after`);
      const red = choreograph(rec, { reduced: true }).steps.find(s => s.op === 'toss');
      ok(red && red.dur === 0, `game ${g}: reduced motion cuts the toss`);
      // a draw: same record with no winner
      const draw = { ...rec, after: { ...rec.after, result: { winner: -1, reason: 'turn cap' } } };
      const cd = choreograph(draw);
      ok(!cd.steps.some(s => s.op === 'toss') && cd.steps.some(s => s.op === 'win'), `game ${g}: a draw has a win step and no toss`);
    }
  }
  ok(wins >= 8, `bot games end with a winner (${wins} of 16)`);
  ok(losers[0] > 0 && losers[1] > 0, `both seats lose some games (${losers})`);
}


// --- scene ----------------------------------------------------------------------------
const warns = [];
const realWarn = console.warn;
console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
const inTable = (x, z) => Math.abs(x) <= TABLE.halfLen && Math.abs(z) <= TABLE.halfDepth;
// A game whose loser ends with some cards in hand.
let game = null;
for (let g = 1; g <= 40 && !game; g++) {
  const G = allRecords(g), last = G.recs[G.recs.length - 1], res = last?.after?.result;
  if (res && (res.winner === 0 || res.winner === 1) && last.after.players[1 - res.winner].hand.length >= 3) game = { g, ...G, winner: res.winner };
}
ok(!!game, 'a bot game ends with a winner and a loser with 3 or more cards in hand');

// Play the game: every record but the last fast, the last at 30 fps with
// a check of each thrown card in each frame.
async function playOut(sc, G, { seat = null, frames = 330 } = {}) {
  sc.setState(G.start);
  if (seat != null) sc.setFirstPerson(seat);
  sc.setSpeed(8);
  for (const r of G.recs.slice(0, -1)) {
    let done = false;
    sc.play(r).then(() => { done = true; });
    for (let k = 0; k < 5000 && !done; k++) { sc.render(0.1); await null; }
  }
  sc.setSpeed(1);
  const Z = sc.world.Z;
  let slab = 0, shots = [];
  sc.play(G.recs[G.recs.length - 1]);
  for (let k = 0; k < frames; k++) {
    sc.render(1 / 30); await null;
    for (const o of Z.tossed) {
      const p = o.mesh.position;
      if (!Number.isFinite(p.x + p.y + p.z)) slab++;
      else if (inTable(p.x, p.z) && p.y < TABLE.y - 0.001 && p.y > TABLE.y - TABLE.thick - 0.2) slab++;
    }
    const sh = sc.world.dir.state.shot;
    if (shots[shots.length - 1] !== sh) shots.push(sh);
  }
  return { slab, shots };
}
function restCheck(sc, tag) {
  const Z = sc.world.Z;
  let bad = 0, moving = 0;
  const pts = [];
  for (const o of Z.tossed) {
    const p = o.mesh.position, st = o.toss;
    if (!st.rested || st.landT < 1) { moving++; continue; }
    const onTable = inTable(p.x, p.z);
    const floorOk = !onTable && st.surface === 'floor' && p.y >= 0.003 && p.y < 0.1;
    const tableOk = onTable && st.surface === 'table' && p.y >= TABLE.y + 0.003 && p.y < TABLE.y + 0.12;
    if (!floorOk && !tableOk) { bad++; if (bad < 4) console.error(tag, 'card rest', st.surface, p.toArray().map(x => x.toFixed(3))); }
    // flat: the face normal is vertical
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(o.mesh.quaternion);
    if (Math.abs(n.y) < 0.999) bad++;
    pts.push(p.clone());
  }
  ok(moving === 0, `${tag}: every thrown card has come to rest (${moving} still move)`);
  ok(bad === 0, `${tag}: every thrown card lies flat on the table, a card or the floor (${bad} bad)`);
  let spread = 0;
  for (const a of pts) for (const b of pts) spread = Math.max(spread, Math.hypot(a.x - b.x, a.z - b.z));
  ok(pts.length < 2 || spread > 0.5, `${tag}: the cards scatter (spread ${spread.toFixed(2)})`);
  return pts;
}
// lowest point of the head capsule and eyes of fly p, over the table
function headLow(sc, p) {
  const rig = sc.world.flies[p].built.rig, v = new THREE.Vector3();
  let y = Infinity;
  for (const o of rig.joints.head.children) {
    if (!o.isMesh) continue;
    o.updateWorldMatrix(true, false);
    const a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); if (inTable(v.x, v.z)) y = Math.min(y, v.y); }
  }
  return y;
}
const hatOn = (sc, p) => { const h = sc.world.flies[p].built?.rig?.hat; return !!(h && h.group.visible); };

if (game) {
  const L = 1 - game.winner, W = game.winner, nHand = game.recs[game.recs.length - 1].after.players[L].hand.length;
  // --- watch mode
  {
    const sc = createDuelScene(null, { headless: true });
    const r = await sc.ready;
    ok(r.fly === 'fly.js', 'scene uses the real fly.js');
    ok(!hatOn(sc, 0) && !hatOn(sc, 1), 'watch mode: no fly wears the fedora');
    const { slab, shots } = await playOut(sc, game);
    const st = sc.stats(), F = sc.world.flies;
    ok(slab === 0, `watch: no thrown card goes into the table slab in flight (${slab} frames)`);
    ok(st.tossed === nHand && sc.world.Z.hand[L].length === 0, `watch: the loser threw its whole hand (${st.tossed} of ${nHand})`);
    ok(st.hand[L] === sc.world.mirror.players[L].hand.length, 'watch: stats().hand still counts the thrown cards (the mirror keeps them)');
    ok(F[L].spec.name === 'headDown' && F[L].end === 'headDown', `watch: the loser plays headDown (${F[L].spec.name})`);
    ok(F[W].spec.name === 'raiseArms', `watch: the winner keeps its victory pose (${F[W].spec.name})`);
    restCheck(sc, 'watch');
    const surf = {}; for (const o of sc.world.Z.tossed) surf[o.toss.surface] = (surf[o.toss.surface] || 0) + 1;
    console.log(`fly3d-toss: game ${game.g}, ${game.recs.length} records, loser ${L} threw ${st.tossed} cards (${JSON.stringify(surf)}), shots ${shots.join(' > ')}`);
    const y = headLow(sc, L);
    ok(y >= TABLE.y - 0.012 && y <= TABLE.y + 0.06, `watch: the loser's head rests at table height (${(y - TABLE.y).toFixed(4)} above the top)`);
    ok(shots.includes('toss') && shots.indexOf('win') > shots.indexOf('toss'), `watch: the camera goes to the toss shot, then the win shot (${shots.join(' > ')})`);
    // it stays there until the next game
    for (let k = 0; k < 300; k++) sc.render(1 / 30);
    ok(F[L].spec.name === 'headDown' && sc.stats().tossed === nHand, 'watch: the loser stays head down 10 s later');
    restCheck(sc, 'watch +10 s');
    // a new game clears the toss and the pose: the change of game
    // (ui/fly3d/regame.js, tests/fly3d-regame.test.mjs) gathers the
    // thrown cards and lifts the head
    const G2 = allRecords(game.g + 100);
    sc.setState(G2.start);
    for (let k = 0; k < 600 && sc.between(); k++) sc.render(1 / 30);
    ok(!sc.between() && sc.stats().tossed === 0 && F[L].spec.name !== 'headDown' && F[L].end == null, `watch: a new game clears the thrown cards and lifts the head (${sc.stats().tossed}, ${F[L].spec.name})`);
    sc.dispose();
  }
  // --- reduced motion: the cards are at rest at once
  {
    const sc = createDuelScene(null, { headless: true, reduced: true });
    await sc.ready;
    const { slab } = await playOut(sc, game, { frames: 120 });
    ok(slab === 0, 'reduced: no card in the table slab');
    const F = sc.world.flies;
    ok(F[L].spec.name === 'headDown' && F[L].tNow >= 2.0, `reduced: the loser cuts to the head-down pose (clip t ${F[L].tNow.toFixed(2)})`);
    restCheck(sc, 'reduced');
    const y = headLow(sc, L);
    ok(y >= TABLE.y - 0.012 && y <= TABLE.y + 0.06, `reduced: the head rests at table height (${(y - TABLE.y).toFixed(4)})`);
    sc.dispose();
  }
  // --- play mode: you win, the fly (your opponent) throws
  {
    const sc = createDuelScene(null, { headless: true });
    await sc.ready;
    const { slab } = await playOut(sc, game, { seat: W });
    const F = sc.world.flies;
    ok(hatOn(sc, L) && !hatOn(sc, W), 'play: the fly you play against wears the fedora, your seat does not');
    ok(slab === 0, 'play, you win: no card in the table slab');
    ok(F[L].spec.name === 'headDown' && sc.stats().tossed === nHand, 'play, you win: the fly throws its hand and puts its head down');
    restCheck(sc, 'play, you win');
    // the fedora fell onto the table
    const g = F[L].built.rig.hat.group, b = new THREE.Box3().setFromObject(g, true);
    ok(b.min.y >= TABLE.y - 0.01 && b.min.y < TABLE.y + 0.04 && inTable((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2), `play, you win: the fedora lies on the table (brim ${(b.min.y - TABLE.y).toFixed(4)} above)`);
    sc.setFirstPerson(null);
    ok(!hatOn(sc, 0) && !hatOn(sc, 1), 'back to watch mode: the fedora is off');
    sc.dispose();
  }
  // --- play mode: you lose, your seat does not throw, the fly celebrates
  {
    const sc = createDuelScene(null, { headless: true });
    await sc.ready;
    await playOut(sc, game, { seat: L });
    const F = sc.world.flies;
    ok(sc.stats().tossed === 0 && sc.world.Z.hand[L].length === nHand, 'play, you lose: your hand stays in your hand');
    ok(F[L].spec.name === 'slump', `play, you lose: your seat keeps the slump (${F[L].spec.name})`);
    ok(F[W].spec.name === 'raiseArms', `play, you lose: the fly celebrates (${F[W].spec.name})`);
    ok(hatOn(sc, W), 'play, you lose: the winning fly still wears the fedora');
    sc.dispose();
  }
}
console.warn = realWarn;
const ours = warns.filter(w => /toss|setHat|animate failed|step failed/.test(w));
ok(ours.length === 0, `no warnings from the toss or the hat (${ours.slice(0, 3).join(' | ')})`);

console.log(`fly3d-toss: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

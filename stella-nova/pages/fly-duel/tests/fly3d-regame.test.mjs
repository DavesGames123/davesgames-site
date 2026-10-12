// ============================================================================
//  FLY DUEL  ·  node tests for the change of game  (node tests/fly3d-regame.test.mjs)
// ----------------------------------------------------------------------------
//  The user asked: "switching decks/end of game needs better animations".
//  ui/fly3d/regame.js plays a sequence between two games. This file checks:
//    plan      the phases in order, the swap only on a deck change, the
//              deal card by card in turn, the length at speed 1
//    watch     a whole bot game ends (the loser throws its hand), then a
//              new game with another deck for seat 0: the win beat comes
//              first; every card (thrown, battlefield, graveyard, hand)
//              flies to the library pile of its owner and the pile grows
//              card by card (no card vanishes on the table); the box of
//              seat 0 slides off the table and the new box slides in, the
//              box of seat 1 stays; the mat of seat 0 crossfades; the
//              hands come card by card; the end board equals the new
//              state; the first record of the new game waits for the end,
//              then plays with no snap
//    same      the same decks: no swap, no crossfade, still the shuffle,
//              the cut and the deal
//    speed     the sequence at speed 4 takes a quarter of the time
//    skip      skipBetween() puts the new state on the table at once
//    play      setFirstPerson after the end starts the clean-up, which
//              waits in the box; the new state then ends it with no cut
//              and no deal (ui/play/opening.js deals in play mode)
//    saver     a new game with empty hands, then the hands: a deal-only
//              sequence
//    reduced   no sequence: setState is a cut
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
const { greedyBot, randomBot } = await import('../game/bots.js');
const { Match, agentFromBot } = await import('../ui/match.js');
const THREE = await import('three');
const { mirrorOf, mirrorDiff } = await import('../ui/fly3d/choreo.js');
const { createDuelScene, TABLE } = await import('../ui/fly3d/scene.js');
const RG = await import('../ui/fly3d/regame.js').catch(() => ({}));
const { BOX } = await import('../ui/fly3d/hall.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
function rngf(s) { let a = s >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const FPS = 30, DT = 1 / FPS;

// --- plan (pure) ------------------------------------------------------------------
{
  ok(typeof RG.regamePlan === 'function' && !!RG.REGAME, 'regame.js gives regamePlan and REGAME');
  if (RG.regamePlan) {
    const names = o => RG.regamePlan(o).phases.map(x => x.name).join(' ');
    ok(names({ swap: true }) === 'win gather shuffle boxIn swap boxOut cut deal', `swap plan: ${names({ swap: true })}`);
    ok(names({ swap: false }) === 'win gather shuffle boxIn boxOut cut deal', `same-deck plan: ${names({ swap: false })}`);
    ok(names({ win: false, gather: false }) === 'cut deal', `deal-only plan: ${names({ win: false, gather: false })}`);
    ok(names({ deal: false, swap: true }) === 'win gather shuffle boxIn swap boxOut', `play-mode plan (no deal): ${names({ deal: false, swap: true })}`);
    const P = RG.regamePlan({ swap: true, hands: [7, 6], first: 1 });
    ok(P.deals.length === 13 && P.deals[0].p === 1 && P.deals[1].p === 0 && P.deals.every((d, i) => i === 0 || d.at > P.deals[i - 1].at), 'the deal: 13 cards, one at a time, seat 1 first, in turn');
    let at = 0;
    ok(P.phases.every(x => { const g = Math.abs(x.at - at) < 1e-9; at = x.at + x.dur; return g; }) && Math.abs(P.total - at) < 1e-9, 'the phases follow each other with no gap');
    const T1 = RG.regamePlan({ swap: true }).total, T0 = RG.regamePlan({ swap: false }).total;
    ok(T1 >= 5 && T1 <= 7.5 && T0 >= 4 && T0 <= 6.5 && T1 > T0, `length at speed 1: swap ${T1.toFixed(2)} s, same deck ${T0.toFixed(2)} s`);
  }
}

// --- games ---------------------------------------------------------------------------
function botMatch(seed, decks) {
  const mk = i => ((seed + i) % 3 === 0 ? agentFromBot(randomBot(rngf(seed * 7 + i)), 'random') : agentFromBot(greedyBot(), 'greedy'));
  return new Match(rules, [mk(0), mk(1)], { seed, decks });
}
function allRecords(seed, decks) {
  const M = botMatch(seed, decks), start = structuredClone(M.state), recs = [];
  let r;
  while ((r = M.next())) recs.push(r);
  return { start, recs, decks };
}
// a game with a winner whose loser throws 3 or more cards
let game = null;
for (let g = 1; g <= 40 && !game; g++) {
  const G = allRecords(g, ['amber', 'moss']), last = G.recs[G.recs.length - 1], res = last?.after?.result;
  if (res && res.winner >= 0 && last.after.players[1 - res.winner].hand.length >= 3) game = { g, ...G };
}
ok(!!game, 'a bot game ends with a winner and a thrown hand');

async function playOut(sc, G, seat = null) {
  sc.setState(G.start);
  if (seat != null) sc.setFirstPerson(seat);
  sc.setSpeed(8);
  for (const r of G.recs) {
    let done = false;
    sc.play(r).then(() => { done = true; });
    for (let k = 0; k < 5000 && !done; k++) { sc.render(0.1); await null; }
  }
  sc.setSpeed(1);
  for (let k = 0; k < 90; k++) sc.render(DT);     // the toss comes to rest
}
const warns = [];
const realWarn = console.warn;
console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
const nextGame = (seed, decks) => { const M = botMatch(seed, decks); return { M, state: M.state }; };
const libSpot = (p) => (p === 0 ? new THREE.Vector3(TABLE.deckU, 0, TABLE.deckV) : new THREE.Vector3(-TABLE.deckU, 0, -TABLE.deckV));

// Run the sequence frame by frame and record what happens.
async function watchBetween(sc, { maxFrames = 900, onFrame = null } = {}) {
  const rec = { phases: [], frames: 0, libs: [[], []], hands: [[], []], fading: [[], []], boxU: [[], []], flights: new Map(), maxMoving: 0 };
  const hall = sc.world.hall;
  for (let k = 0; k < maxFrames && sc.between(); k++) {
    sc.render(DT); rec.frames++;
    const s = sc.stats().regame;
    if (s.on && rec.phases[rec.phases.length - 1] !== s.phase) rec.phases.push(s.phase);
    rec.maxMoving = Math.max(rec.maxMoving, s.moving || 0);
    const m = sc.world.mirror;
    for (let p = 0; p < 2; p++) {
      rec.libs[p].push(m.players[p].library);
      rec.hands[p].push(sc.world.Z.hand[p].length);
      rec.fading[p].push(hall.matTextures().fading?.[p] ?? null);
      // the u of every visible deck box of seat p (seat space)
      const us = [];
      hall.table.traverse(o => { if (o.name === 'deck-box' && o.visible && o.userData.seat === p) us.push(p === 0 ? o.position.x : -o.position.x); });
      rec.boxU[p].push(us);
    }
    for (const f of sc.world.regame.flying()) {
      const d = new THREE.Vector3(f.mesh.position.x, 0, f.mesh.position.z).distanceTo(libSpot(f.p));
      const e = rec.flights.get(f.mesh) || { p: f.p, token: f.token, first: d, last: d, frames: 0 };
      e.last = d; e.frames++; rec.flights.set(f.mesh, e);
    }
    onFrame?.(s, k);
    await null;
  }
  return rec;
}
const monoUp = a => a.every((x, i) => i === 0 || x >= a[i - 1]);

if (game) {
  const W = game.recs[game.recs.length - 1].after.result.winner, L = 1 - W;
  // --- watch: another deck for seat 0
  {
    const sc = createDuelScene(null, { headless: true });
    await sc.ready;
    ok(typeof sc.between === 'function' && typeof sc.skipBetween === 'function', 'the scene gives between() and skipBetween()');
    await playOut(sc, game);
    const hall = sc.world.hall;
    const before = sc.stats();
    const tossed = before.tossed;
    ok(tossed >= 3, `the loser threw its hand (${tossed})`);
    const keyMat1 = hall.matOf(1).key, keyMat0 = hall.matOf(0).key;
    const swaps0 = hall.boxSwaps?.() ?? 0;
    const N = nextGame(game.g + 200, ['dew', 'moss']);
    sc.setState(N.state);
    ok(sc.between?.() === true, 'watch: setState after the end starts the change of game');
    ok(sc.stats().tossed === tossed && sc.world.flies[L].spec.name === 'headDown', 'watch: the win beat first: the thrown cards and the head-down pose stay');
    // the first record of the new game waits for the deal
    const r0 = N.M.next();
    let played = false, playedAt = -1;
    sc.play(r0).then(() => { played = true; });
    const R = await watchBetween(sc, { onFrame: (s, k) => { if (played && playedAt < 0) playedAt = k; } });
    const T = R.frames * DT;
    console.log(`fly3d-regame: watch, other deck: ${R.phases.join(' > ')}, ${T.toFixed(2)} s at speed 1, ${R.flights.size} cards gathered`);
    ok(R.phases.join(' ') === 'win gather shuffle boxIn swap boxOut cut deal', `watch: the phases (${R.phases.join(' ')})`);
    ok(T >= 5 && T <= 7.5, `watch: the change of game takes ${T.toFixed(2)} s at speed 1`);
    // the cards travel to the pile of their owner
    const fl = [...R.flights.values()], cards = fl.filter(f => !f.token);
    ok(fl.length === before.cards, `watch: every card on the table flies (${fl.length} of ${before.cards})`);
    ok(cards.every(f => f.last < 0.25 && f.frames >= 3), `watch: every card arrives at its library pile after a flight of 3 or more frames (${cards.filter(f => !(f.last < 0.25 && f.frames >= 3)).length} bad)`);
    ok(cards.filter(f => f.first > 1).length >= tossed, `watch: the cards come from across the table and the floor (${cards.filter(f => f.first > 1).length} from over 1 unit away)`);
    // the pile grows card by card during the gather
    for (let p = 0; p < 2; p++) {
      const g = R.libs[p].slice(0, R.libs[p].findIndex((x, i) => i > 0 && x === 0 && R.libs[p][i - 1] > 0));
      const steps = new Set(g).size;
      ok(monoUp(g) && steps >= 6, `watch: the library pile of seat ${p} grows in ${steps} steps before it goes into the box`);
    }
    // the box swap: only seat 0
    ok((hall.boxSwaps?.() ?? 0) - swaps0 === 1, `watch: one box swap (${(hall.boxSwaps?.() ?? 0) - swaps0})`);
    const offEdge = R.boxU[0].some(us => us.some(u => u > TABLE.halfLen));
    const twoBoxes = R.boxU[0].some(us => us.length === 2);
    ok(offEdge && twoBoxes, `watch: the old box of seat 0 goes off the end of the table while the new one comes in (off ${offEdge}, both ${twoBoxes})`);
    ok(R.boxU[1].every(us => us.length === 1 && Math.abs(us[0] - BOX.u) < 1e-6), 'watch: the box of seat 1 (same deck) stays in place');
    ok(hall.deckOf(0) === 'dew' && hall.deckOf(1) === 'moss', `watch: the boxes print the new decks (${hall.deckOf(0)}, ${hall.deckOf(1)})`);
    // the mat crossfade
    const fd = R.fading[0].filter(x => x != null);
    ok(fd.length >= 10 && fd[0] > 0.9 && Math.min(...fd) < 0.1 && fd.every((x, i) => i === 0 || x <= fd[i - 1] + 1e-9), `watch: the old mat print of seat 0 fades out (${fd.length} frames, ${fd[0]} -> ${Math.min(...fd)})`);
    ok(R.fading[1].every(x => x == null), 'watch: no crossfade on the mat of seat 1');
    ok(hall.matOf(0).key !== keyMat0 && hall.matOf(1).key === keyMat1 && hall.matTextures().fading.every(x => x == null), 'watch: the mat of seat 0 has the new print, the layer is gone at the end');
    // the deal
    for (let p = 0; p < 2; p++) {
      const all = R.hands[p], n = N.state.players[p].hand.length;
      const h = all.slice(all.lastIndexOf(0));            // from the gather on (the win beat keeps the old hand)
      ok(monoUp(h) && new Set(h).size === n + 1 && h[h.length - 1] === n, `watch: seat ${p} gets its ${n} cards one at a time`);
    }
    ok(mirrorDiff(sc.world.mirror, mirrorOf(N.state)).length === 0, 'watch: the end board is the new state');
    ok(playedAt < 0, 'watch: the first record of the new game does not play during the change');
    for (let k = 0; k < 400 && !played; k++) { sc.render(DT); await null; }
    ok(played, 'watch: then the first record of the new game plays');
    ok(!warns.some(w => /mirror drift/.test(w)), 'watch: no mirror drift (no snap)');
    ok(sc.stats().tossed === 0 && sc.world.flies[L].spec.name !== 'headDown', 'watch: the head is up, no thrown cards are left');
    sc.dispose();
  }
  // --- same decks, speed 4, skip
  {
    const sc = createDuelScene(null, { headless: true });
    await sc.ready;
    await playOut(sc, game);
    const hall = sc.world.hall, swaps0 = hall.boxSwaps?.() ?? 0;
    sc.setState(nextGame(game.g + 300, ['amber', 'moss']).state);
    const R = await watchBetween(sc);
    const T1 = R.frames * DT;
    ok(R.phases.join(' ') === 'win gather shuffle boxIn boxOut cut deal', `same deck: no swap phase (${R.phases.join(' ')})`);
    ok((hall.boxSwaps?.() ?? 0) === swaps0 && R.fading.every(f => f.every(x => x == null)), 'same deck: no box swap, no crossfade');
    ok(T1 >= 4 && T1 <= 6.5, `same deck: ${T1.toFixed(2)} s at speed 1`);
    // speed 4
    await playOut(sc, game);
    sc.setSpeed(4);
    sc.setState(nextGame(game.g + 301, ['amber', 'moss']).state);
    const R4 = await watchBetween(sc);
    const T4 = R4.frames * DT;
    ok(Math.abs(T4 * 4 - T1) < 0.35, `speed 4: ${T4.toFixed(2)} s (a quarter of ${T1.toFixed(2)} s)`);
    // skip
    await playOut(sc, game);
    const S = nextGame(game.g + 302, ['rot', 'dew']).state;
    sc.setState(S);
    for (let k = 0; k < 40; k++) sc.render(DT);
    ok(sc.between(), 'skip: the change runs');
    sc.skipBetween();
    ok(!sc.between() && mirrorDiff(sc.world.mirror, mirrorOf(S)).length === 0 && hall.deckOf(0) === 'rot' && hall.deckOf(1) === 'dew', 'skip: the new state is on the table at once');
    ok(hall.matTextures().fading.every(x => x == null) && hall.deckBoxes.every(b => b.visible), 'skip: no crossfade layer left, the boxes in use show');
    sc.dispose();
  }
  // --- play mode: the fly loses, the rematch
  {
    const sc = createDuelScene(null, { headless: true });
    await sc.ready;
    await playOut(sc, game, W);
    sc.setFirstPerson(W);                       // play.js newGame: the rematch
    ok(sc.between(), 'play: the rematch starts the clean-up');
    const R = await watchBetween(sc, { maxFrames: 200 });
    ok(sc.between() && sc.stats().regame.waiting && sc.stats().regame.phase === 'wait', `play: the clean-up waits in the box for the new state (${R.phases.join(' ')})`);
    const S = nextGame(game.g + 400, ['dew', 'moss']).state;
    sc.setState(S);                             // play.js coin: the new state
    const R2 = await watchBetween(sc);
    ok(!R2.phases.includes('deal') && !R2.phases.includes('cut') && R2.phases.includes('swap') && R2.phases.includes('boxOut'), `play: the box swap and the deck out, no cut and no deal (${R2.phases.join(' ')})`);
    ok(!sc.between() && mirrorDiff(sc.world.mirror, mirrorOf(S)).length === 0, 'play: then the new state is on the table');
    sc.dispose();
  }
  // --- saver: empty hands first, then the hands
  {
    const sc = createDuelScene(null, { headless: true });
    await sc.ready;
    sc.setCamera('script');
    await playOut(sc, game);
    const S = nextGame(game.g + 500, ['rot', 'moss']).state;
    const empty = { ...S, players: S.players.map(p => ({ ...p, hand: [], library: [...p.hand, ...p.library] })) };
    sc.setState(empty);
    const R = await watchBetween(sc);
    ok(!R.phases.includes('deal') && R.phases.includes('swap'), `saver: no deal for empty hands (${R.phases.join(' ')})`);
    sc.setState(S);
    ok(sc.between(), 'saver: the hands come with a deal');
    const R2 = await watchBetween(sc);
    ok(R2.phases.join(' ') === 'cut deal', `saver: a deal-only change (${R2.phases.join(' ')})`);
    ok(mirrorDiff(sc.world.mirror, mirrorOf(S)).length === 0, 'saver: the end board is the new state');
    sc.dispose();
  }
  // --- reduced motion: a cut
  {
    const sc = createDuelScene(null, { headless: true, reduced: true });
    await sc.ready;
    await playOut(sc, game);
    const S = nextGame(game.g + 600, ['dew', 'moss']).state;
    sc.setState(S);
    ok(!sc.between() && mirrorDiff(sc.world.mirror, mirrorOf(S)).length === 0, 'reduced: setState is a cut');
    sc.dispose();
  }
}
console.warn = realWarn;
const ours = warns.filter(w => /step failed|animate failed|regame/.test(w));
ok(ours.length === 0, `no warnings (${ours.slice(0, 3).join(' | ')})`);

console.log(`fly3d-regame: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

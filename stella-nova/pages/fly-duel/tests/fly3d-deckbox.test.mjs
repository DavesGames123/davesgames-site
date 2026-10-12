// ============================================================================
//  FLY DUEL  ·  the deck boxes of the feature table  (node tests/fly3d-deckbox.test.mjs)
// ----------------------------------------------------------------------------
//  The deck box of each fly (ui/fly3d/hall.js setDeckBox) prints the deck
//  of the game on the table. The test builds a headless scene of
//  ui/fly3d/scene.js and checks hall.deckOf(seat):
//    setState   a new game state with decks [dew, rot] prints dew and rot
//    play       the first record of a game with other decks puts the
//               table in its before state, and the boxes follow the decks
//    custom     a custom deck list (an array) prints no deck (null)
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
const { DECKS } = await import('../game/cards.js');
const { greedyBot } = await import('../game/bots.js');
const { Match, agentFromBot } = await import('../ui/match.js');
const { createDuelScene } = await import('../ui/fly3d/scene.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

const sc = createDuelScene(null, { headless: true });
const hall = sc.world.hall;
ok(typeof hall.deckOf === 'function', 'the hall gives deckOf(seat)');

// setState: a new game
sc.setState(rules.newGame({ seed: 3, decks: ['dew', 'rot'] }));
ok(hall.deckOf(0) === 'dew' && hall.deckOf(1) === 'rot', `setState: the boxes show dew and rot (${hall.deckOf(0)}, ${hall.deckOf(1)})`);

// play: the first record of a game with other decks
const bots = [agentFromBot(greedyBot(), 'a'), agentFromBot(greedyBot(), 'b')];
const M = new Match(rules, bots, { seed: 9, decks: ['amber-pollen', 'moss'] });
const rec = M.next();
ok(!!rec && rec.before.decks.join() === 'amber-pollen,moss', `the record holds the deck ids of its game (${rec?.before?.decks})`);
let done = false;
sc.play(rec).then(() => { done = true; });
for (let i = 0; i < 2000 && !done; i++) { sc.render(0.05); await new Promise(r => setImmediate(r)); }
ok(done, 'the scene plays the record');
ok(hall.deckOf(0) === 'amber-pollen' && hall.deckOf(1) === 'moss', `play: the boxes follow the decks of the new game (${hall.deckOf(0)}, ${hall.deckOf(1)})`);
ok(!!DECKS[hall.deckOf(0)] && !!DECKS[hall.deckOf(1)], 'play: both are deck ids of game/cards.js');

// custom: a deck list, not an id
const list = DECKS.dew.list.map(r => r.slice());
sc.setState(rules.newGame({ seed: 4, decks: [list, 'pollen'] }));
ok(hall.deckOf(0) === null && hall.deckOf(1) === 'pollen', `custom: a deck list prints no deck, the other box prints pollen (${hall.deckOf(0)}, ${hall.deckOf(1)})`);

sc.dispose();
console.log(`fly3d-deckbox: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

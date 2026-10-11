// ============================================================================
//  FLY DUEL  ·  node tests for the rules engine  (node tests/game.test.mjs)
// ----------------------------------------------------------------------------
//  Checks data/rng.js and game/: the seeded generator, the card pool and the
//  two decks (with the IP word check), setup, draw rules, mana and auto-tap,
//  one land per turn, combat (blocks, wings, sting, sap, thick, swift,
//  entry sickness), spells and tokens, hand size, decking, the turn cap,
//  determinism by seed, no mutation of the input state (deep freeze), the
//  option caps, features, describe and the log bound, 2000 random games
//  with their speed, and a greedy-against-random win-rate check.
//  Exit code 1 on any failure.
//
//  GREP MAP   (grep -n "^// ---" tests/game.test.mjs)
// ============================================================================
import { mulberry32, rngNext, hashSeed, shuffle } from '../data/rng.js';
import { CARDS, TOKENS, CARD, DECKS, buildDeck, deckList, manaValue, KEYWORDS } from '../game/cards.js';
import {
  newGame, legalActions, step, isOver, clone, describe, actionKey, withPermanent,
  manaPool, power, toughness, LIFE, HAND_MAX, TURN_CAP, LOG_MAX, MAX_OPTIONS,
} from '../game/rules.js';
import { features, FEATURE_NAMES, FEATURE_SPEC, F } from '../game/features.js';
import { randomBot, greedyBot, boardScore } from '../game/bots.js';

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const throws = (fn, msg) => { try { fn(); ok(false, msg); } catch { ok(true, msg); } };
const J = x => JSON.stringify(x);

// --------------------------------------------------------------- rng
{
  const a = mulberry32(42), b = mulberry32(42);
  const xs = Array.from({ length: 1000 }, () => a());
  ok(xs.every(x => x >= 0 && x < 1), 'mulberry32 in [0,1)');
  ok(xs.every(x => x === b()), 'mulberry32 same seed same stream');
  let st = 42; const c = mulberry32(42);
  for (let i = 0; i < 50; i++) { const [v, n] = rngNext(st); st = n; ok(v === c(), 'rngNext matches the closure ' + i); }
  ok(hashSeed('fly') === hashSeed('fly') && hashSeed('fly') !== hashSeed('flz'), 'hashSeed stable and spreads');
  ok(Number.isInteger(hashSeed('x')) && hashSeed('x') >= 0 && hashSeed('x') < 2 ** 32, 'hashSeed is uint32');
  const arr = [1, 2, 3, 4, 5, 6, 7, 8];
  const sh = shuffle(arr, mulberry32(3));
  ok(J(arr) === '[1,2,3,4,5,6,7,8]', 'shuffle leaves input alone');
  ok(J(sh.slice().sort()) === J(arr) && J(sh) !== J(arr), 'shuffle is a permutation');
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  ok(Math.abs(mean - 0.5) < 0.05, 'mulberry32 mean near 0.5');
}

// --------------------------------------------------------------- cards and decks
{
  ok(CARDS.length >= 28 && CARDS.length <= 36, `about 30 cards (${CARDS.length})`);
  const ids = [...CARDS, ...TOKENS].map(c => c.id);
  ok(new Set(ids).size === ids.length, 'card ids unique');
  ok(new Set(CARDS.map(c => c.name)).size === CARDS.length, 'card names unique');
  for (const c of [...CARDS, ...TOKENS]) {
    ok(['land', 'creature', 'spell'].includes(c.type), `type ${c.id}`);
    ok(['amber', 'moss', 'none'].includes(c.colour), `colour ${c.id}`);
    ok(['generic', 'amber', 'moss'].every(k => Number.isInteger(c.cost[k]) && c.cost[k] >= 0), `cost ${c.id}`);
    if (c.type === 'creature') {
      ok(Number.isInteger(c.power) && Number.isInteger(c.toughness) && c.toughness > 0, `stats ${c.id}`);
      ok(c.keywords.every(k => KEYWORDS[k]), `keywords known ${c.id}`);
    }
    if (c.type === 'spell') ok(!!c.effect, `spell has effect ${c.id}`);
    if (c.effect) {
      ok(['damage', 'draw', 'pump', 'heal', 'destroy', 'token'].includes(c.effect.kind), `effect kind ${c.id}`);
      if (c.effect.kind === 'token') ok(CARD[c.effect.token] && CARD[c.effect.token].token, `token exists ${c.id}`);
    }
    ok(typeof c.text === 'string' && typeof c.flavour === 'string', `text ${c.id}`);
  }
  ok(CARDS.some(c => c.colour === 'amber') && CARDS.some(c => c.colour === 'moss') && CARDS.some(c => c.colour === 'none'), 'two colours + colourless');
  for (const k of ['damage', 'draw', 'pump', 'heal', 'destroy', 'token']) ok(CARDS.some(c => c.effect && c.effect.kind === k), `pool has effect ${k}`);
  for (const k of Object.keys(KEYWORDS)) ok(CARDS.some(c => (c.keywords || []).includes(k)), `pool has keyword ${k}`);
  // IP: no WotC card names, land names or keyword words in our cards
  const bannedName = /\b(magic|gathering|wizards|island|swamp|mountain|plains|forest|planeswalker|llanowar|serra|shivan|lightning bolt|giant growth|counterspell)\b/i;
  const bannedText = /\b(flying|haste|deathtouch|vigilance|lifelink|defender|trample|planeswalker|tap:\s*add \{|wizards of the coast)\b/i;
  for (const c of [...CARDS, ...TOKENS]) {
    ok(!bannedName.test(c.name), `IP: own name ${c.name}`);
    ok(!bannedText.test(c.text + ' ' + c.flavour), `IP: own text ${c.id}`);
  }
  for (const name of Object.keys(DECKS)) {
    const d = buildDeck(name);
    ok(d.length === 40, `${name} has 40 cards`);
    ok(d.filter(id => CARD[id].type === 'land').length === 17, `${name} has 17 lands`);
    ok(d.every(id => CARD[id] && !CARD[id].token), `${name} ids resolve, no tokens`);
    ok(deckList(name).reduce((s, r) => s + r.count, 0) === 40, `${name} deckList sums to 40`);
    const sh = buildDeck(name, mulberry32(9));
    ok(J(sh.slice().sort()) === J(d.slice().sort()), `${name} shuffle keeps the list`);
    ok(J(buildDeck(name, mulberry32(9))) === J(sh), `${name} shuffle is seeded`);
  }
  ok(DECKS.amber.list.every(([id]) => ['amber', 'none'].includes(CARD[id].colour)), 'amber deck is amber + colourless');
  ok(DECKS.moss.list.every(([id]) => ['moss', 'none'].includes(CARD[id].colour)), 'moss deck is moss + colourless');
  ok(manaValue('kiln-burst') === 3 && manaValue(CARD['amber-ridge']) === 0, 'manaValue');
}

// helper: an empty board in a known phase. Tests may edit their own copy.
function board({ phase = 'main', active = 0 } = {}) {
  const s = clone(newGame({ seed: 1, log: true }));
  for (const p of s.players) { p.hand = []; p.battlefield = []; }
  s.phase = phase; s.active = active; s.toAct = active;
  return s;
}
const put = (s, p, id, o) => withPermanent(s, p, id, o);
const uidOf = (s, p, id) => s.players[p].battlefield.find(x => x.id === id).uid;
const attackPhase = s => { const t = clone(s); t.phase = 'attack'; return t; };

// --------------------------------------------------------------- setup and draws
{
  const s = newGame({ seed: 5, first: 1 });
  ok(s.players.every(p => p.hand.length === 7 && p.library.length === 33 && p.life === LIFE), 'setup: 7 in hand, 33 in library, 20 life');
  ok(s.turn === 1 && s.active === 1 && s.toAct === 1 && s.phase === 'main', 'setup: first player acts on turn 1');
  ok(isOver(s) === null, 'setup: not over');
  ok(J(structuredClone(s)) === J(s) && J(JSON.parse(J(s))) === J(s), 'state is plain JSON');
  // first player passes turn 1 with no draw; second draws on turn 2
  let t = s;
  while (t.turn === 1) t = step(t, legalActions(t).find(a => a.type === 'pass' || (a.type === 'attack' && !a.attackers.length)));
  ok(t.players[1].hand.length === 7, 'first player did not draw on turn 1');
  ok(t.turn === 2 && t.active === 0 && t.players[0].hand.length === 8 && t.players[0].library.length === 32, 'second player draws on turn 2');
}

// --------------------------------------------------------------- mana and lands
{
  let s = board();
  s.players[0].hand = ['amber-ridge', 'amber-ridge', 'kiln-burst', 'flare-spit', 'cinder-ant'];
  s = put(s, 0, 'amber-ridge'); s = put(s, 0, 'amber-ridge');
  let L = legalActions(s);
  ok(L.filter(a => a.type === 'land').length === 1, 'one land option per distinct land card');
  ok(!L.some(a => a.card === 'kiln-burst'), 'kiln burst (3) not castable with 2 lands');
  ok(L.some(a => a.card === 'flare-spit' && a.target === 'p1'), 'flare spit can hit the opposing player');
  throws(() => step(s, { type: 'cast', card: 'kiln-burst', target: 'p1' }), 'step refuses a cast that cannot be paid');
  s = step(s, { type: 'land', card: 'amber-ridge' });
  ok(s.players[0].landPlayed && s.players[0].battlefield.length === 3, 'land enters');
  ok(!legalActions(s).some(a => a.type === 'land'), 'only one land per turn');
  throws(() => step(s, { type: 'land', card: 'amber-ridge' }), 'step refuses a second land');
  ok(manaPool(s.players[0]).amber === 3, 'three untapped amber');
  const s2 = step(s, { type: 'cast', card: 'kiln-burst', target: 'p1' });
  ok(s2.players[1].life === 16, 'kiln burst deals 4');
  ok(s2.players[0].battlefield.filter(x => x.tapped).length === 3 && manaPool(s2.players[0]).amber === 0, 'auto-tap taps 3 lands for cost 3');
  ok(s2.players[0].graveyard.includes('kiln-burst') && !s2.players[0].hand.includes('kiln-burst'), 'spell goes to graveyard');
  ok(!legalActions(s2).some(a => a.type === 'cast'), 'no mana left, no casts');
  // colour check: moss card with only amber lands
  let m = board();
  m.players[0].hand = ['bark-toad'];
  m = put(m, 0, 'amber-ridge'); m = put(m, 0, 'amber-ridge'); m = put(m, 0, 'amber-ridge');
  ok(!legalActions(m).some(a => a.type === 'cast'), 'colour requirement: moss card needs moss');
  m = put(m, 0, 'moss-hollow');
  const mm = step(m, { type: 'cast', card: 'bark-toad' });
  ok(mm.players[0].battlefield.filter(x => x.tapped).length === 3, 'generic paid from other colour');
  ok(mm.players[0].battlefield.find(x => x.id === 'moss-hollow').tapped, 'coloured cost tapped the moss land');
  // colourless card paid by any land
  let g = board();
  g.players[0].hand = ['drift-seed'];
  g = put(g, 0, 'moss-hollow');
  ok(legalActions(g).some(a => a.card === 'drift-seed'), 'colourless card castable from any land');
}

// --------------------------------------------------------------- creatures, sickness, swift, thick
{
  let s = board();
  s.players[0].hand = ['cinder-ant', 'ember-gnat'];
  s = put(s, 0, 'amber-ridge'); s = put(s, 0, 'amber-ridge');
  s = step(s, { type: 'cast', card: 'cinder-ant' });
  s = step(s, { type: 'cast', card: 'ember-gnat' });
  ok(s.players[0].battlefield.find(x => x.id === 'cinder-ant').sick, 'new creature is sick');
  s = step(s, { type: 'pass' });
  ok(s.phase === 'attack', 'pass goes to attack when a swift creature can attack');
  const L = legalActions(s);
  ok(L.length === 2 && L.every(a => a.attackers.every(u => u === uidOf(s, 0, 'ember-gnat'))), 'only the swift gnat can attack');
  throws(() => step(s, { type: 'attack', attackers: [uidOf(s, 0, 'cinder-ant')] }), 'step refuses a sick attacker');
  let t = board();
  t = put(t, 0, 'root-sentinel'); t = put(t, 0, 'briar-wall');
  t = step(t, { type: 'pass' });
  ok(t.turn === 2 && t.phase === 'main', 'thick creatures cannot attack: attack step skipped');
}

// --------------------------------------------------------------- combat
{
  // unblocked
  let s = board(); s = put(s, 0, 'magma-beetle'); s = attackPhase(s);
  const u = uidOf(s, 0, 'magma-beetle');
  let r = step(s, { type: 'attack', attackers: [u] });
  ok(r.players[1].life === 15 && r.turn === 2, 'no blockers: damage at once, turn ends');
  ok(r.players[0].battlefield[0].tapped, 'attacker stays tapped on the opposing turn');
  // trade
  s = board(); s = put(s, 0, 'hive-soldier'); s = put(s, 1, 'hive-soldier'); s = attackPhase(s);
  const a = s.players[0].battlefield[0].uid, b = s.players[1].battlefield[0].uid;
  r = step(s, { type: 'attack', attackers: [a] });
  ok(r.phase === 'block' && r.toAct === 1, 'defender gets the block decision');
  const BL = legalActions(r);
  ok(BL.some(x => x.blocks.length === 0) && BL.some(x => x.blocks.length === 1), 'block options include none and one');
  r = step(r, { type: 'block', blocks: [[a, b]] });
  ok(r.players[0].battlefield.length === 0 && r.players[1].battlefield.length === 0, '2/2 trades with 2/2');
  ok(r.players[0].graveyard.includes('hive-soldier') && r.players[1].graveyard.includes('hive-soldier'), 'dead creatures go to graveyard');
  ok(r.players[1].life === 20, 'blocked attacker does not hit the player');
  // wings: ground creature cannot block
  s = board(); s = put(s, 0, 'dune-wasp'); s = put(s, 1, 'bark-toad'); s = attackPhase(s);
  r = step(s, { type: 'attack', attackers: [uidOf(s, 0, 'dune-wasp')] });
  ok(r.players[1].life === 18 && r.turn === 2, 'wings: ground blocker cannot block, damage at once');
  s = board(); s = put(s, 0, 'dune-wasp'); s = put(s, 1, 'dew-moth'); s = put(s, 1, 'bark-toad'); s = attackPhase(s);
  r = step(s, { type: 'attack', attackers: [uidOf(s, 0, 'dune-wasp')] });
  ok(r.phase === 'block' && legalActions(r).every(x => x.blocks.every(([, bb]) => bb === uidOf(r, 1, 'dew-moth'))), 'wings: only wings can block');
  throws(() => step(r, { type: 'block', blocks: [[uidOf(r, 0, 'dune-wasp'), uidOf(r, 1, 'bark-toad')]] }), 'step refuses a ground block on wings');
  // sting kills a big blocker
  s = board(); s = put(s, 0, 'sting-hopper'); s = put(s, 1, 'grove-stag'); s = attackPhase(s);
  r = step(s, { type: 'attack', attackers: [uidOf(s, 0, 'sting-hopper')] });
  r = step(r, { type: 'block', blocks: [[uidOf(r, 0, 'sting-hopper'), uidOf(r, 1, 'grove-stag')]] });
  ok(r.players[1].battlefield.length === 0 && r.players[0].battlefield.length === 0, 'sting: 1/1 kills 5/5 and dies');
  // sap gains life; thick wall blocks
  s = board(); s = put(s, 0, 'fern-beast'); s = attackPhase(s);
  s.players[0].life = 10;
  r = step(s, { type: 'attack', attackers: [uidOf(s, 0, 'fern-beast')] });
  ok(r.players[1].life === 14 && r.players[0].life === 16, 'sap: 6 damage gains 6 life');
  s = board(); s = put(s, 0, 'magma-beetle'); s = put(s, 1, 'briar-wall'); s = attackPhase(s);
  r = step(s, { type: 'attack', attackers: [uidOf(s, 0, 'magma-beetle')] });
  r = step(r, { type: 'block', blocks: [[uidOf(r, 0, 'magma-beetle'), uidOf(r, 1, 'briar-wall')]] });
  ok(r.players[1].battlefield.length === 1 && r.players[0].battlefield.length === 1, '5 damage does not kill a 1/6 wall; wall 1 does not kill 5/4');
  ok(r.players[1].life === 21, 'blocker sap gains life too');
  ok(r.players[1].battlefield[0].dmg === 0, 'damage wears off at end of turn');
  // lethal
  s = board(); s = put(s, 0, 'magma-beetle'); s = attackPhase(s); s.players[1].life = 5;
  r = step(s, { type: 'attack', attackers: [uidOf(s, 0, 'magma-beetle')] });
  ok(isOver(r) && r.result.winner === 0 && r.result.reason === 'life' && r.phase === 'over', 'lethal attack wins');
  ok(legalActions(r).length === 0, 'no actions after the end');
  throws(() => step(r, { type: 'pass' }), 'step refuses after the end');
}

// --------------------------------------------------------------- spells and tokens
{
  let s = board();
  s.players[0].hand = ['war-chirp', 'flare-spit', 'strangle-root', 'swarm-call', 'sap-bloom', 'deep-roots'];
  for (let i = 0; i < 6; i++) { s = put(s, 0, 'amber-ridge'); s = put(s, 0, 'moss-hollow'); }
  s = put(s, 0, 'hive-soldier'); s = put(s, 1, 'grove-stag'); s = put(s, 1, 'thorn-vine');
  const L = legalActions(s);
  ok(L.filter(a => a.card === 'war-chirp').length === 1, 'pump targets only own creatures');
  ok(L.filter(a => a.card === 'flare-spit').length === 3, 'damage: player + 2 opposing creatures');
  ok(L.filter(a => a.card === 'strangle-root').length === 1 && L.find(a => a.card === 'strangle-root').target === uidOf(s, 1, 'thorn-vine'),
    'destroy: only power <= 3');
  let r = step(s, { type: 'cast', card: 'war-chirp', target: uidOf(s, 0, 'hive-soldier') });
  const hs = r.players[0].battlefield.find(x => x.id === 'hive-soldier');
  ok(power(hs) === 4 && toughness(hs) === 4, 'pump +2/+2');
  r = step(r, { type: 'cast', card: 'flare-spit', target: uidOf(r, 1, 'thorn-vine') });
  ok(!r.players[1].battlefield.some(x => x.id === 'thorn-vine') && r.players[1].graveyard.includes('thorn-vine'), 'damage spell kills');
  r = step(r, { type: 'cast', card: 'swarm-call' });
  const larva = r.players[0].battlefield.filter(x => x.id === 'ember-larva');
  ok(larva.length === 2 && larva.every(x => !x.sick), 'token spell makes two swift larva');
  r = step(r, { type: 'cast', card: 'sap-bloom' });
  ok(r.players[0].life === 24, 'heal 4');
  const hand0 = r.players[0].hand.length;
  r = step(r, { type: 'cast', card: 'deep-roots' });
  ok(r.players[0].hand.length === hand0 - 1 + 2, 'draw 2');
  // pump wears off
  r = step(r, { type: 'pass' });
  r = step(r, { type: 'attack', attackers: [] });
  ok(power(r.players[0].battlefield.find(x => x.id === 'hive-soldier')) === 2, 'pump wears off at end of turn');
  // tokens vanish on death
  let k = board(); k = put(k, 0, 'ember-larva'); k = put(k, 1, 'hive-soldier'); k = attackPhase(k);
  const lu = uidOf(k, 0, 'ember-larva');
  k = step(k, { type: 'attack', attackers: [lu] });
  k = step(k, { type: 'block', blocks: [[lu, uidOf(k, 1, 'hive-soldier')]] });
  ok(k.players[0].battlefield.length === 0 && k.players[0].graveyard.length === 0, 'token dies and leaves no card');
  // creature enter effects
  let e = board(); e.players[0].hand = ['spore-mother', 'dew-moth'];
  for (let i = 0; i < 8; i++) e = put(e, 0, 'moss-hollow');
  e = step(e, { type: 'cast', card: 'spore-mother' });
  ok(e.players[0].battlefield.filter(x => x.id === 'spore').length === 2, 'spore mother makes two spores');
  const h = e.players[0].hand.length;
  e = step(e, { type: 'cast', card: 'dew-moth' });
  ok(e.players[0].hand.length === h, 'dew moth replaces itself (cast -1, draw +1)');
  throws(() => step(s, { type: 'cast', card: 'flare-spit', target: 'p0' }), 'step refuses a self-target burn');
  throws(() => step(s, { type: 'cast', card: 'strangle-root', target: uidOf(s, 1, 'grove-stag') }), 'step refuses destroy over the power limit');
  throws(() => step(s, { type: 'cast', card: 'kiln-burst', target: 'p1' }), 'step refuses a card not in hand');
  throws(() => step(s, { type: 'attack', attackers: [] }), 'step refuses an attack in main');
}

// --------------------------------------------------------------- hand size, decking, turn cap
{
  let s = board();
  s.players[0].hand = ['grove-stag', 'amber-ridge', 'flare-spit', 'magma-beetle', 'hive-soldier', 'kiln-burst', 'sun-locust', 'deep-roots', 'moss-hollow'];
  s = step(s, { type: 'pass' });
  ok(s.players[0].hand.length === HAND_MAX, 'end of turn: discard to 7');
  ok(J(s.players[0].graveyard.sort()) === J(['amber-ridge', 'moss-hollow']), 'discard the lowest-cost cards (lands first)');
  let d = board(); d.players[1].library = [];
  d = step(d, { type: 'pass' });
  ok(isOver(d) && d.result.winner === 0 && d.result.reason === 'decked', 'draw from an empty library loses');
  // passive game: nobody plays anything, the cap ends it
  let g = newGame({ seed: 77, log: false });
  while (!isOver(g)) g = step(g, legalActions(g).find(a => a.type === 'pass' || (a.type === 'attack' && !a.attackers.length) || (a.type === 'block' && !a.blocks.length)));
  ok(g.result.winner === -1 && g.result.reason === 'turn cap' && g.turn === TURN_CAP, `turn cap ${TURN_CAP} gives a draw`);
}

// --------------------------------------------------------------- option caps
{
  let s = board();
  for (const id of ['hive-soldier', 'cinder-ant', 'magma-beetle', 'dune-wasp', 'ember-mantis', 'spark-hornet', 'sting-hopper']) s = put(s, 0, id);
  for (const id of ['bark-toad', 'dew-moth', 'thorn-vine', 'moss-snail', 'root-sentinel', 'spore', 'spore']) s = put(s, 1, id);
  s = attackPhase(s);
  const A = legalActions(s);
  ok(A.length === MAX_OPTIONS, `7 attackers: options capped at ${MAX_OPTIONS} (${A.length})`);
  ok(A[0].attackers.length === 0 && A[1].attackers.length === 7, 'attack: none first, all second');
  ok(new Set(A.map(actionKey)).size === A.length, 'attack options unique');
  const r = step(s, A[1]);
  const B = legalActions(r);
  ok(B.length === MAX_OPTIONS && B[0].blocks.length === 0, 'block options capped, none first');
  ok(new Set(B.map(actionKey)).size === B.length, 'block options unique');
  for (const b of B) {
    const blockers = b.blocks.map(q => q[1]);
    ok(new Set(blockers).size === blockers.length, 'one attacker per blocker');
    let fine = true; try { step(r, b); } catch { fine = false; }
    ok(fine, 'every block option is legal');
  }
  let f = board(); for (let i = 0; i < 3; i++) f = put(f, 0, 'cinder-ant'); f = attackPhase(f);
  ok(legalActions(f).length === 8, '3 attackers: all 8 subsets');
}

// --------------------------------------------------------------- determinism and no mutation
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}
function playOut(seed, botSeed, { log = true, freeze = false, decks } = {}) {
  const rng = mulberry32(botSeed);
  let s = newGame({ seed, log, first: seed & 1, decks });
  let n = 0;
  while (!isOver(s)) {
    const L = legalActions(s);
    if (L.length === 0) return { s, n, empty: true };
    if (freeze) deepFreeze(s);
    s = step(s, L[Math.floor(rng() * L.length)]);
    n++;
  }
  return { s, n, empty: false };
}
{
  ok(J(playOut(11, 3).s) === J(playOut(11, 3).s), 'same seeds: same game, same log');
  ok(J(playOut(11, 3).s) !== J(playOut(12, 3).s), 'other seed: other game');
  let mutated = 0;
  for (let g = 0; g < 60; g++) {
    try { playOut(500 + g, g, { freeze: true }); } catch (e) { mutated++; if (mutated === 1) console.error(e); }
  }
  ok(mutated === 0, 'step never mutates its input (60 deep-frozen games)');
  const s0 = newGame({ seed: 3 }), before = J(s0);
  for (const a of legalActions(s0)) step(s0, a);
  ok(J(s0) === before, 'state unchanged after stepping every legal action');
  const c = clone(s0); c.players[0].hand.push('x'); c.players[0].library.pop(); c.log.push('y');
  ok(J(s0) === before, 'clone is independent');
}

// --------------------------------------------------------------- features
{
  ok(FEATURE_NAMES.length === 48 && new Set(FEATURE_NAMES).size === 48 && FEATURE_SPEC.every(r => r[2]), '48 named features');
  ok(F.life_me === 0 && F.sick_me === 47, 'feature index map');
  let checked = 0;
  for (let g = 0; g < 40; g++) {
    const rng = mulberry32(g);
    let s = newGame({ seed: 900 + g, log: false });
    while (!isOver(s)) {
      for (const me of [0, 1]) {
        const f = features(s, me);
        if (!(f instanceof Float32Array) || f.length !== 48 || !f.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) {
          ok(false, 'features finite in [0,1]'); g = 99; break;
        }
        checked++;
      }
      const L = legalActions(s);
      s = step(s, L[Math.floor(rng() * L.length)]);
    }
  }
  ok(checked > 1000, `features finite in [0,1] on ${checked} boards`);
  let s = board(); s = put(s, 0, 'magma-beetle'); s.players[1].life = 7;
  const f0 = features(s, 0), f1 = features(s, 1);
  ok(Math.abs(f0[F.life_opp] - 7 / 30) < 1e-6 && Math.abs(f1[F.life_me] - 7 / 30) < 1e-6, 'life features mirror');
  ok(Math.abs(f0[F.power_me] - f1[F.power_opp]) < 1e-6 && f0[F.power_me] > 0, 'power features mirror');
  const t = clone(s); t.players[1].hand = ['grove-stag', 'grove-stag'];
  const u = clone(s); u.players[1].hand = ['spore-burst', 'swell'];
  ok(J(Array.from(features(t, 0))) === J(Array.from(features(u, 0))), 'features do not read the opposing hand');
  ok(features(s, 0)[F.my_turn] === 1 && features(s, 1)[F.my_turn] === 0, 'my_turn flag');
  s.players[1].life = 5;
  ok(features(s, 0)[F.lethal_me] === 1, 'lethal flag when ready power reaches opposing life');
}

// --------------------------------------------------------------- describe and log
{
  const s = newGame({ seed: 4, names: ['Fly A', 'Fly B'] });
  for (const a of legalActions(s)) {
    const d = describe(a, s);
    ok(typeof d === 'string' && d.startsWith('Fly A') && d.length > 8, 'describe: ' + d);
  }
  const { s: end } = playOut(21, 5);
  ok(end.log.length > 0 && end.log.length <= LOG_MAX, `log bounded (${end.log.length})`);
  ok(end.log.every(x => typeof x === 'string'), 'log lines are strings');
  const quiet = playOut(21, 5, { log: false }).s;
  ok(quiet.log.length === 0 && J({ ...quiet, log: 0, logOn: 0 }) === J({ ...end, log: 0, logOn: 0 }), 'log off: same game, no text');
}

// --------------------------------------------------------------- 2000 random games, speed
{
  const N = 2000;
  const t0 = performance.now();
  let empty = 0, steps = 0, over = 0, maxL = 0, illegal = 0;
  const wins = { amber: 0, moss: 0, draw: 0 };
  const rng = mulberry32(2026);
  for (let g = 0; g < N; g++) {
    const decks = g & 2 ? ['amber', 'moss'] : ['moss', 'amber'];
    let s = newGame({ seed: g, first: g & 1, log: false, decks });
    while (!s.result) {
      const L = legalActions(s);
      if (!L.length) { empty++; break; }
      if (L.length > maxL) maxL = L.length;
      if (s.phase !== 'main' && L.length > MAX_OPTIONS) illegal++;
      s = step(s, L[Math.floor(rng() * L.length)]);
      steps++;
    }
    if (s.result) { over++; if (s.result.winner < 0) wins.draw++; else wins[decks[s.result.winner]]++; }
  }
  const dt = (performance.now() - t0) / 1000;
  const gps = N / dt;
  ok(empty === 0, 'legalActions never empty while the game is on');
  ok(over === N, `${N} random games finish`);
  ok(illegal === 0, 'attack and block lists stay within the cap');
  ok(gps > 800, `speed: ${gps.toFixed(0)} random games/s (target > 2000)`);
  console.log(`random play: ${N} games in ${dt.toFixed(2)} s = ${gps.toFixed(0)} games/s, ${(steps / N).toFixed(1)} steps/game, ` +
    `max ${maxL} options, amber ${wins.amber} moss ${wins.moss} draw ${wins.draw}`);
}

// --------------------------------------------------------------- bots
{
  const N = 100;
  let gw = 0, d = 0;
  for (let g = 0; g < N; g++) {
    const gs = g & 1, decks = g & 2 ? ['amber', 'moss'] : ['moss', 'amber'];
    const bots = []; bots[gs] = greedyBot(); bots[1 - gs] = randomBot(mulberry32(g + 77));
    let s = newGame({ seed: 3000 + g, decks, first: (g >> 2) & 1, log: false });
    while (!s.result) {
      const L = legalActions(s);
      const a = bots[s.toAct](s, L);
      if (!L.includes(a)) { ok(false, 'bot returns one of the legal actions'); break; }
      s = step(s, a);
    }
    if (s.result.winner === gs) gw++; else if (s.result.winner < 0) d++;
  }
  ok(gw / N >= 0.85, `greedy beats random clearly: ${gw}/${N} wins, ${d} draws`);
  console.log(`greedy vs random: ${gw}/${N} wins, ${d} draws (seats and decks alternate)`);
  const s = newGame({ seed: 8 });
  ok(boardScore(s, 0) === -boardScore(s, 1) || Number.isFinite(boardScore(s, 0)), 'boardScore finite');
  const r1 = randomBot(mulberry32(1)), r2 = randomBot(mulberry32(1));
  const L = legalActions(s);
  ok(r1(s, L) === r2(s, L), 'randomBot is seeded');
}

console.log(`game tests: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

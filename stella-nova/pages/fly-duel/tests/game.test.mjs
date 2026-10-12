// ============================================================================
//  FLY DUEL  ·  node tests for the rules engine  (node tests/game.test.mjs)
// ----------------------------------------------------------------------------
//  Checks data/rng.js and game/: the seeded generator, the card pool of five
//  colours and the decks (with the IP word check and validateDeck), setup,
//  draw rules, mana and auto-tap (dual lands, payPlan), one land per turn,
//  combat (blocks, wings, web, sting, sap, thick, swift, lunge, crush,
//  alert, entry sickness), spells, tokens and every effect kind, enter,
//  death and start-of-turn triggers, shell, hand size, decking, the turn
//  cap, determinism by seed, no mutation of the input state (deep freeze),
//  the option caps, features (colour-generic), describe, the log bound and
//  the events list, 5000 random games over every deck pair with their
//  speed, and greedy against random for every deck.
//  Exit code 1 on any failure.
//
//  GREP MAP   (grep -n "^// ---" tests/game.test.mjs)
// ============================================================================
import { mulberry32, rngNext, hashSeed, shuffle } from '../data/rng.js';
import { CARDS, TOKENS, CARD, DECKS, DECK_ORDER, COLOUR_IDS, COLOURS, buildDeck, deckList, manaValue, KEYWORDS, rulesText, validateDeck, deckColours } from '../game/cards.js';
import {
  newGame, legalActions, step, isOver, clone, describe, actionKey, withPermanent,
  manaPool, canPay, payPlan, power, toughness, LIFE, HAND_MAX, TURN_CAP, LOG_MAX, MAX_OPTIONS,
} from '../game/rules.js';
import { features, FEATURE_NAMES, FEATURE_SPEC, F, FEATURE_VERSION } from '../game/features.js';
import { randomBot, greedyBot, boardScore } from '../game/bots.js';

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const throws = (fn, msg) => { try { fn(); ok(false, msg); } catch { ok(true, msg); } };
const J = x => JSON.stringify(x);
const EFFECTS = ['damage', 'draw', 'pump', 'heal', 'destroy', 'token', 'grow', 'rally', 'drain', 'tap', 'bounce', 'ramp', 'discard', 'weaken', 'feast', 'raise'];

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
  ok(CARDS.length >= 110 && CARDS.length <= 140, `110 to 140 cards (${CARDS.length})`);
  const ids = [...CARDS, ...TOKENS].map(c => c.id);
  ok(new Set(ids).size === ids.length, 'card ids unique');
  ok(new Set(CARDS.map(c => c.name)).size === CARDS.length, 'card names unique');
  for (const c of [...CARDS, ...TOKENS]) {
    ok(['land', 'creature', 'spell'].includes(c.type), `type ${c.id}`);
    ok([...COLOUR_IDS, 'multi', 'none'].includes(c.colour), `colour ${c.id}`);
    ok(Array.isArray(c.colours) && c.colours.every(x => COLOUR_IDS.includes(x)), `colours ${c.id}`);
    ok(['generic', ...COLOUR_IDS].every(k => Number.isInteger(c.cost[k]) && c.cost[k] >= 0) && Object.keys(c.cost).length === 6, `cost ${c.id}`);
    ok(typeof c.subtype === 'string' && c.subtype.length > 1, `subtype ${c.id}`);
    ok(c.text === rulesText(c), `text is rulesText ${c.id}`);
    if (c.type === 'land') ok(c.mana.length >= 1 && c.mana.length <= 2 && c.produces === c.mana[0] && !!c.entersTapped === (c.mana.length === 2), `land mana ${c.id}`);
    else if (!c.token) ok(J(c.colours) === J(COLOUR_IDS.filter(x => c.cost[x] > 0)), `colours match cost ${c.id}`);
    if (c.type === 'creature') {
      ok(Number.isInteger(c.power) && Number.isInteger(c.toughness) && c.toughness > 0, `stats ${c.id}`);
      ok(c.keywords.every(k => KEYWORDS[k]), `keywords known ${c.id}`);
    }
    if (c.type === 'spell') ok(!!c.effect, `spell has effect ${c.id}`);
    if (c.effect) {
      ok(EFFECTS.includes(c.effect.kind), `effect kind ${c.id}`);
      if (c.effect.kind === 'token') ok(CARD[c.effect.token] && CARD[c.effect.token].token, `token exists ${c.id}`);
    }
    for (const t of [c.onDeath, c.onUpkeep, c.effect?.then]) if (t) ok(['draw', 'heal', 'drain', 'token', 'grow', 'damage'].includes(t.kind) && !['any', 'opp', 'own'].includes(t.target), `trigger has no choice ${c.id}`);
    ok(typeof c.text === 'string' && typeof c.flavour === 'string', `text ${c.id}`);
  }
  ok(COLOUR_IDS.length === 5 && COLOUR_IDS.every(x => COLOURS[x] && COLOURS[x].name && COLOURS[x].theme), 'five named colours');
  ok(!COLOUR_IDS.some(x => /^(white|blue|black|red|green)$/i.test(COLOURS[x].name)), 'IP: own colour names');
  ok(CARDS.some(c => c.colour === 'none') && CARDS.filter(c => c.colour === 'multi' && c.type !== 'land').length >= 10, 'colourless and ten or more gold cards');
  for (const col of COLOUR_IDS) {
    const mine = CARDS.filter(c => c.colour === col && c.type !== 'land');
    const cre = mine.filter(c => c.type === 'creature'), spl = mine.filter(c => c.type === 'spell');
    ok(mine.length >= 15, `${col}: 15 or more cards (${mine.length})`);
    ok(cre.length >= 9 && spl.length >= 4, `${col}: creatures and spells (${cre.length}/${spl.length})`);
    for (const mv of [1, 2, 3, 4]) ok(cre.some(c => manaValue(c) === mv), `${col}: a creature at cost ${mv}`);
    ok(cre.some(c => manaValue(c) >= 5), `${col}: a creature at cost 5+`);
    ok(CARDS.some(c => c.type === 'land' && c.basic && c.produces === col), `${col}: basic land`);
  }
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
    const a = COLOUR_IDS[i], b = COLOUR_IDS[j];
    ok(CARDS.some(c => c.type === 'land' && J(c.mana) === J([a, b])), `dual land ${a}+${b}`);
    ok(CARDS.some(c => c.type === 'creature' && J(c.colours) === J([a, b])), `gold card ${a}+${b}`);
  }
  for (const k of EFFECTS) ok(CARDS.some(c => [c.effect, c.effect?.then, c.onDeath, c.onUpkeep].some(e => e && e.kind === k)), `pool has effect ${k}`);
  ok(CARDS.some(c => c.onDeath) && CARDS.some(c => c.onUpkeep) && CARDS.some(c => c.type === 'creature' && c.effect && ['opp', 'own'].includes(c.effect.target)), 'pool has death, start-of-turn and targeted enter triggers');
  for (const k of Object.keys(KEYWORDS)) ok(CARDS.some(c => (c.keywords || []).includes(k)), `pool has keyword ${k}`);
  // IP: no WotC card names, land names or keyword words in our cards
  const bannedName = /\b(magic|gathering|wizards|island|swamp|mountain|plains|forest|planeswalker|llanowar|serra|shivan|lightning bolt|giant growth|counterspell)\b/i;
  const bannedText = /\b(flying|haste|deathtouch|vigilance|lifelink|defender|trample|first strike|reach|hexproof|ward|menace|counter|planeswalker|tap:\s*add \{|wizards of the coast)\b/i;
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
  ok(J(DECK_ORDER) === J(Object.keys(DECKS)), 'DECK_ORDER lists every deck');
  for (const col of COLOUR_IDS) ok(DECKS[col] && J(DECKS[col].colours) === J([col]) && J(deckColours(col)) === J([col]), `mono deck ${col}`);
  const mixed = DECK_ORDER.filter(n => DECKS[n].colours.length > 1);
  ok(mixed.length >= 6, `six or more mixed decks (${mixed.length})`);
  ok(mixed.some(n => DECKS[n].colours.length >= 3), 'a three-colour deck');
  for (const n of DECK_ORDER) {
    const d = DECKS[n], v = validateDeck(n);
    ok(v.ok, `validateDeck ${n}: ${v.errors.join('; ')}`);
    ok(J(v.colours) === J(d.colours) && J(deckColours(n)) === J(d.colours), `${n}: colours field matches the cards`);
    ok(typeof d.name === 'string' && d.name.length > 3 && typeof d.desc === 'string' && d.desc.length > 20, `${n}: name and description`);
    ok(d.colour === (d.colours.length === 1 ? d.colours[0] : 'multi'), `${n}: colour field`);
    if (d.colours.length > 1) ok(d.list.some(([id]) => CARD[id].type === 'land' && !CARD[id].basic), `${n}: runs dual lands`);
  }
  ok(new Set(DECK_ORDER.map(n => DECKS[n].name)).size === DECK_ORDER.length, 'deck names unique');
  // validateDeck refuses bad lists
  ok(!validateDeck([['amber-ridge', 17], ['cinder-ant', 23]]).ok, 'validateDeck: more than 4 copies');
  ok(!validateDeck([['amber-ridge', 17], ['ember-gnat', 4]]).ok, 'validateDeck: 21 cards');
  ok(!validateDeck([['amber-ridge', 17], ['spore', 4], ...[['cinder-ant', 4], ['dune-wasp', 4], ['hive-soldier', 4], ['flare-spit', 4], ['heat-pulse', 3]]]).ok, 'validateDeck: token');
  ok(!validateDeck('no-such-deck').ok, 'validateDeck: unknown name');
  { const l = DECKS['amber-dew'].list.map(r => r.slice()); l[1] = ['dew-pond', 1]; l[0] = ['amber-ridge', 12]; ok(!validateDeck(l).ok && validateDeck(l).errors.some(e => /make dew/.test(e)), 'validateDeck: too few dew sources'); }
  ok(buildDeck(DECKS.rot.list).length === 40, 'buildDeck takes a list');
  { const g = newGame({ seed: 2, decks: [DECKS.pollen.list, 'dew'] }); ok(g.players[0].hand.concat(g.players[0].library).every(id => DECKS.pollen.list.some(r => r[0] === id)), 'newGame takes a custom list'); }
  ok(manaValue('kiln-burst') === 3 && manaValue(CARD['amber-ridge']) === 0, 'manaValue');
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
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

// --------------------------------------------------------------- five colours: mana, dual lands, auto-tap
{
  // dual land enters tapped and makes either colour
  let s = board();
  s.players[0].hand = ['geyser-basin', 'pond-skater', 'ember-gnat'];
  s = step(s, { type: 'land', card: 'geyser-basin' });
  const gb = s.players[0].battlefield.find(x => x.id === 'geyser-basin');
  ok(gb.tapped, 'dual land enters tapped');
  ok(!legalActions(s).some(a => a.type === 'cast'), 'tapped dual land pays nothing this turn');
  s = clone(s); s.players[0].battlefield[0].tapped = false;
  let L = legalActions(s);
  ok(L.some(a => a.card === 'pond-skater') && L.some(a => a.card === 'ember-gnat'), 'dual land can pay either colour');
  const pool = manaPool(s.players[0]);
  ok(pool.amber === 1 && pool.dew === 1 && pool.total === 1, 'manaPool counts a dual land in both colours, total once');
  // matching: Steam Darner 2AD with basic amber, dual amber/dew, dual moss/dew, basic moss
  let m = board();
  m.players[0].hand = ['steam-darner'];
  for (const id of ['amber-ridge', 'geyser-basin', 'fern-spring', 'moss-hollow']) m = put(m, 0, id);
  const plan = payPlan(m.players[0], CARD['steam-darner'].cost);
  ok(plan && plan.length === 4, 'payPlan pays 2AD from four lands');
  const pays = Object.fromEntries(plan.map(q => [m.players[0].battlefield.find(x => x.uid === q.uid).id, q.pays]));
  ok(pays['amber-ridge'] === 'amber' && pays['geyser-basin'] === 'dew' || pays['fern-spring'] === 'dew', 'payPlan: basic pays its colour, a dual land pays dew');
  ok(plan.filter(q => q.pays === 'generic').length === 2 && plan.filter(q => q.pays === 'amber').length === 1 && plan.filter(q => q.pays === 'dew').length === 1, 'payPlan: one amber, one dew, two generic');
  // a case that needs the search: Ash Wasp 1AR with dual amber/rot + dual amber/dew + basic moss
  let w = board();
  w.players[0].hand = ['ash-wasp'];
  for (const id of ['geyser-basin', 'cinder-fen', 'moss-hollow']) w = put(w, 0, id);
  const wp = payPlan(w.players[0], CARD['ash-wasp'].cost);
  ok(wp && wp.find(q => q.uid === uidOf(w, 0, 'cinder-fen')).pays === 'rot' && wp.find(q => q.uid === uidOf(w, 0, 'geyser-basin')).pays === 'amber', 'payPlan: matching puts rot on the only rot source');
  ok(canPay(w.players[0], CARD['ash-wasp'].cost) && legalActions(w).some(a => a.card === 'ash-wasp'), 'canPay(player) agrees');
  const w2 = step(w, { type: 'cast', card: 'ash-wasp' });
  ok(w2.players[0].battlefield.filter(x => CARD[x.id].type === 'land').every(x => x.tapped), 'auto-tap taps the planned lands');
  ok(w2.events.filter(e => e.t === 'tap').length === 3 && w2.events.some(e => e.t === 'enter' && e.id === 'ash-wasp'), 'events: three taps then the creature enters');
  // generic keeps dual lands open: Hollow Husk (3) with 3 basic + 1 dual
  let h = board(); h.players[0].hand = ['hollow-husk'];
  for (const id of ['amber-ridge', 'amber-ridge', 'dew-pond', 'geyser-basin']) h = put(h, 0, id);
  const hp = payPlan(h.players[0], CARD['hollow-husk'].cost);
  ok(hp.length === 3 && !hp.some(q => q.uid === uidOf(h, 0, 'geyser-basin')), 'generic cost keeps the dual land untapped');
  // not payable: two rot from one rot source
  let r = board(); r.players[0].hand = ['heart-rot'];
  for (const id of ['rot-log', 'amber-ridge', 'cinder-fen', 'amber-ridge']) r = put(r, 0, id);
  ok(payPlan(r.players[0], CARD['heart-rot'].cost) !== null, '2RR payable with basic rot + dual amber/rot');
  r = clone(r); r.players[0].battlefield = r.players[0].battlefield.filter(x => x.id !== 'cinder-fen');
  r = put(r, 0, 'geyser-basin');
  ok(payPlan(r.players[0], CARD['heart-rot'].cost) === null && !canPay(r.players[0], CARD['heart-rot'].cost), '2RR not payable with one rot source');
  ok(canPay(manaPool(r.players[0]), CARD['heart-rot'].cost) === false, 'canPay(pool) refuses too');
  throws(() => step(r, { type: 'cast', card: 'heart-rot' }), 'step refuses a cast that colours cannot pay');
}

// --------------------------------------------------------------- new keywords
{
  // web blocks wings
  let s = board(); s = put(s, 0, 'dune-wasp'); s = put(s, 1, 'orb-weaver'); s = attackPhase(s);
  let r = step(s, { type: 'attack', attackers: [uidOf(s, 0, 'dune-wasp')] });
  ok(r.phase === 'block' && legalActions(r).some(b => b.blocks.length === 1), 'web: can block wings');
  r = step(r, { type: 'block', blocks: [[uidOf(r, 0, 'dune-wasp'), uidOf(r, 1, 'orb-weaver')]] });
  ok(r.players[0].battlefield.length === 0 && r.players[1].battlefield.length === 1, 'web: 2/3 kills a 2/1 wasp and lives');
  // lunge: 2/1 lunge kills a 2/2 blocker first and takes no damage
  s = board(); s = put(s, 0, 'ladybird-knight'); s = put(s, 1, 'hive-soldier'); s = attackPhase(s);
  r = step(s, { type: 'attack', attackers: [uidOf(s, 0, 'ladybird-knight')] });
  r = step(r, { type: 'block', blocks: [[uidOf(r, 0, 'ladybird-knight'), uidOf(r, 1, 'hive-soldier')]] });
  ok(r.players[0].battlefield.length === 1 && r.players[1].battlefield.length === 0, 'lunge: kills first, takes nothing back');
  // lunge on both sides: simultaneous in the first pass
  s = board(); s = put(s, 0, 'ladybird-knight'); s = put(s, 1, 'ash-cricket'); s = attackPhase(s);
  r = step(s, { type: 'attack', attackers: [uidOf(s, 0, 'ladybird-knight')] });
  r = step(r, { type: 'block', blocks: [[uidOf(r, 0, 'ladybird-knight'), uidOf(r, 1, 'ash-cricket')]] });
  ok(r.players[0].battlefield.length === 0 && r.players[1].battlefield.length === 0, 'lunge vs lunge: both deal damage at once');
  // lunge blocker against a non-lunge attacker that it does not kill: both hit
  s = board(); s = put(s, 0, 'bark-toad'); s = put(s, 1, 'ash-cricket'); s = attackPhase(s);
  r = step(s, { type: 'attack', attackers: [uidOf(s, 0, 'bark-toad')] });
  r = step(r, { type: 'block', blocks: [[uidOf(r, 0, 'bark-toad'), uidOf(r, 1, 'ash-cricket')]] });
  ok(r.players[1].battlefield.length === 0 && r.players[0].battlefield.length === 1, 'lunge blocker that does not kill still dies');
  // crush: 3/2 crush into a 1/1: 1 to the blocker, 2 to the player
  s = board(); s = put(s, 0, 'ram-weevil'); s = put(s, 1, 'hoverfly'); s = attackPhase(s);
  s.players[1].battlefield[0] = { ...s.players[1].battlefield[0] };
  r = step(s, { type: 'attack', attackers: [uidOf(s, 0, 'ram-weevil')] });
  ok(r.phase === 'block', 'crush: ground blocker may block');
  r = step(r, { type: 'block', blocks: [[uidOf(r, 0, 'ram-weevil'), uidOf(r, 1, 'hoverfly')]] });
  ok(r.players[1].life === 18 && r.players[1].battlefield.length === 0, 'crush: excess damage hits the player');
  // crush with sting needs only 1 on the blocker; crush with lunge vs a dead blocker
  s = board(); s = put(s, 0, 'colony-titan'); s = put(s, 1, 'root-sentinel'); s = attackPhase(s);
  r = step(s, { type: 'attack', attackers: [uidOf(s, 0, 'colony-titan')] });
  r = step(r, { type: 'block', blocks: [[uidOf(r, 0, 'colony-titan'), uidOf(r, 1, 'root-sentinel')]] });
  ok(r.players[1].life === 19 && r.players[1].battlefield.length === 0, 'crush: 5 into a 0/4 wall gives 1 to the player');
  // alert: attacking does not tap
  s = board(); s = put(s, 0, 'mason-bee'); s = attackPhase(s);
  r = step(s, { type: 'attack', attackers: [uidOf(s, 0, 'mason-bee')] });
  ok(r.players[1].life === 18 && !r.players[0].battlefield[0].tapped, 'alert: attacker stays untapped');
  // shell: opposing spells cannot target it; own spells can
  s = board(); s.players[0].hand = ['flare-spit', 'war-chirp']; s = put(s, 0, 'amber-ridge'); s = put(s, 0, 'amber-ridge');
  s = put(s, 0, 'water-boatman'); s = put(s, 1, 'shield-bug'); s = put(s, 1, 'hive-soldier');
  const L = legalActions(s);
  ok(!L.some(a => a.target === uidOf(s, 1, 'shield-bug')) && L.some(a => a.target === uidOf(s, 1, 'hive-soldier')), 'shell: opposing spell cannot target it');
  ok(L.some(a => a.card === 'war-chirp' && a.target === uidOf(s, 0, 'water-boatman')), 'shell: own spell can target it');
  throws(() => step(s, { type: 'cast', card: 'flare-spit', target: uidOf(s, 1, 'shield-bug') }), 'step refuses a target with shell');
}

// --------------------------------------------------------------- new effects and triggers
{
  const lands = (s, id, n) => { for (let i = 0; i < n; i++) s = put(s, 0, id); return s; };
  // each: Scald Beetle enters and deals 1 to each opposing creature
  let s = board(); s.players[0].hand = ['scald-beetle']; s = lands(s, 'amber-ridge', 4);
  s = put(s, 1, 'hoverfly'); s = put(s, 1, 'shield-bug'); s = put(s, 1, 'hive-soldier');
  let r = step(s, { type: 'cast', card: 'scald-beetle' });
  ok(r.players[1].battlefield.length === 2 && !r.players[1].battlefield.some(x => x.id === 'hoverfly'), 'damage each: 1/1 dies, shell does not stop a no-target effect');
  ok(r.players[1].battlefield.every(x => x.dmg === 1), 'damage each marks the others');
  // brush fire
  s = board(); s.players[0].hand = ['brush-fire']; s = lands(s, 'amber-ridge', 4); s = put(s, 1, 'hive-soldier'); s = put(s, 1, 'bark-toad');
  r = step(s, { type: 'cast', card: 'brush-fire' });
  ok(r.players[1].battlefield.length === 1 && r.players[1].battlefield[0].id === 'bark-toad', 'brush fire: 2 to each');
  // grow: lasting, survives end of turn, counted by power/toughness and features
  s = board(); s.players[0].hand = ['ring-growth']; s = lands(s, 'moss-hollow', 2); s = put(s, 0, 'hive-soldier');
  r = step(s, { type: 'cast', card: 'ring-growth', target: uidOf(s, 0, 'hive-soldier') });
  let hs = r.players[0].battlefield.find(x => x.id === 'hive-soldier');
  ok(hs.pc === 2 && power(hs) === 4 && toughness(hs) === 4, 'grow: +2/+2 as pc');
  r = step(step(r, { type: 'pass' }), { type: 'attack', attackers: [] });
  hs = r.players[0].battlefield.find(x => x.id === 'hive-soldier');
  ok(r.turn === 2 && power(hs) === 4, 'grow lasts past the end of turn');
  // grow all (Queen of the Comb) and 'this'
  s = board(); s.players[0].hand = ['comb-queen']; s = lands(s, 'pollen-meadow', 7); s = put(s, 0, 'hoverfly');
  r = step(s, { type: 'cast', card: 'comb-queen' });
  ok(r.players[0].battlefield.filter(x => CARD[x.id].type === 'creature').every(x => x.pc === 1), 'grow all: queen and hoverfly get +1/+1');
  // rally
  s = board(); s.players[0].hand = ['bloom-hymn']; s = lands(s, 'pollen-meadow', 2); s = put(s, 0, 'hoverfly'); s = put(s, 0, 'mason-bee');
  r = step(s, { type: 'cast', card: 'bloom-hymn' });
  ok(r.players[0].battlefield.filter(x => x.pp === 1 && x.pt === 1).length === 2, 'rally: +1/+1 this turn to each of mine');
  // drain
  s = board(); s.players[0].hand = ['bog-breath']; s = lands(s, 'rot-log', 2);
  r = step(s, { type: 'cast', card: 'bog-breath' });
  ok(r.players[0].life === 22 && r.players[1].life === 18, 'drain 2');
  // tap + then draw (Ripple)
  s = board(); s.players[0].hand = ['ripple']; s.players[0].library = ['dew-pond', 'dew-pond']; s = lands(s, 'dew-pond', 1);
  s = put(s, 1, 'hive-soldier'); s = put(s, 1, 'bark-toad', { tapped: true });
  let RL = legalActions(s).filter(a => a.card === 'ripple');
  ok(RL.length === 1 && RL[0].target === uidOf(s, 1, 'hive-soldier'), 'tap: only untapped opposing creatures');
  r = step(s, RL[0]);
  ok(r.players[1].battlefield.find(x => x.id === 'hive-soldier').tapped && r.players[0].hand.length === 1, 'tap, then draw a card');
  // bounce: card back to hand, token gone
  s = board(); s.players[0].hand = ['carried-off', 'carried-off']; s = lands(s, 'dew-pond', 4); s = put(s, 1, 'grove-stag'); s = put(s, 1, 'spore');
  r = step(s, { type: 'cast', card: 'carried-off', target: uidOf(s, 1, 'grove-stag') });
  ok(r.players[1].hand.includes('grove-stag') && !r.players[1].battlefield.some(x => x.id === 'grove-stag'), 'bounce: back to its owner\'s hand');
  r = step(r, { type: 'cast', card: 'carried-off', target: uidOf(r, 1, 'spore') });
  ok(r.players[1].battlefield.length === 0 && !r.players[1].hand.includes('spore'), 'bounce: a token is gone');
  // ramp: first land of the library enters tapped; library is replaced, not edited
  s = board(); s.players[0].hand = ['wild-bloom']; s.players[0].library = ['swell', 'moss-hollow', 'grove-stag']; s = lands(s, 'moss-hollow', 2);
  deepFreeze(s);
  r = step(s, { type: 'cast', card: 'wild-bloom' });
  ok(J(r.players[0].library) === J(['swell', 'grove-stag']) && r.players[0].battlefield.filter(x => x.id === 'moss-hollow').length === 3, 'ramp: first land from the library');
  ok(r.players[0].battlefield[2].tapped && r.players[0].life === 22, 'ramp: enters tapped, then gain 2');
  // discard: most costly first
  s = board(); s.players[0].hand = ['gnaw']; s = lands(s, 'rot-log', 3); s.players[1].hand = ['flare-spit', 'magma-beetle', 'amber-ridge', 'heat-pulse'];
  r = step(s, { type: 'cast', card: 'gnaw' });
  ok(J(r.players[1].hand) === J(['flare-spit', 'amber-ridge']) && r.players[1].graveyard.includes('magma-beetle'), 'discard 2: the two most costly');
  // weaken: -2/-2 kills a x/2 with no damage; each
  s = board(); s.players[0].hand = ['wither', 'leaf-blight']; s = lands(s, 'rot-log', 6); s = put(s, 1, 'hive-soldier'); s = put(s, 1, 'bark-toad'); s = put(s, 1, 'hoverfly');
  r = step(s, { type: 'cast', card: 'wither', target: uidOf(s, 1, 'hive-soldier') });
  ok(!r.players[1].battlefield.some(x => x.id === 'hive-soldier'), 'weaken: toughness 0 dies');
  r = step(r, { type: 'cast', card: 'leaf-blight' });
  ok(r.players[1].battlefield.length === 1 && power(r.players[1].battlefield[0]) === 0, 'weaken each: 1/1 dies, 2/4 becomes 0/2');
  // feast: own creature dies (its death trigger too), then draw
  s = board(); s.players[0].hand = ['last-feast']; s.players[0].library = ['rot-log', 'rot-log', 'rot-log']; s = lands(s, 'rot-log', 1); s = put(s, 0, 'burying-beetle');
  r = step(s, { type: 'cast', card: 'last-feast', target: uidOf(s, 0, 'burying-beetle') });
  ok(r.players[0].graveyard.includes('burying-beetle') && r.players[0].hand.length === 2 && r.players[0].life === 21 && r.players[1].life === 19, 'feast: dies, death drain, draw 2');
  ok(legalActions(board()).every(a => a.card !== 'last-feast'), 'feast needs a creature');
  // raise: most costly creature card back to hand
  s = board(); s.players[0].hand = ['sexton-beetle']; s = lands(s, 'rot-log', 5); s.players[0].graveyard = ['flare-spit', 'cinder-ant', 'grove-stag', 'hive-soldier'];
  r = step(s, { type: 'cast', card: 'sexton-beetle' });
  ok(r.players[0].hand.includes('grove-stag') && !r.players[0].graveyard.includes('grove-stag'), 'raise: most costly creature card');
  // destroy with min: Solar Verdict hits power 4+
  s = board(); s.players[0].hand = ['solar-verdict']; s = lands(s, 'pollen-meadow', 3); s = put(s, 1, 'grove-stag'); s = put(s, 1, 'hive-soldier');
  const SV = legalActions(s).filter(a => a.card === 'solar-verdict');
  ok(SV.length === 1 && SV[0].target === uidOf(s, 1, 'grove-stag'), 'destroy min 4: only the big one');
  // Heart Rot: any power
  s = board(); s.players[0].hand = ['heart-rot']; s = lands(s, 'rot-log', 4); s = put(s, 1, 'fern-beast');
  ok(legalActions(s).some(a => a.card === 'heart-rot' && a.target === uidOf(s, 1, 'fern-beast')), 'destroy 99: any power');
  // pump with other toughness
  s = board(); s.players[0].hand = ['surface-tension']; s = lands(s, 'dew-pond', 1); s = put(s, 0, 'water-boatman');
  r = step(s, { type: 'cast', card: 'surface-tension', target: uidOf(s, 0, 'water-boatman') });
  hs = r.players[0].battlefield.find(x => x.id === 'water-boatman');
  ok(power(hs) === 3 && toughness(hs) === 4, 'pump +1/+3');
  // targeted enter trigger: Mist Moth must aim its bounce; with no target it is cast plainly
  s = board(); s.players[0].hand = ['mist-moth']; s = lands(s, 'dew-pond', 5);
  ok(J(legalActions(s).filter(a => a.card === 'mist-moth')) === J([{ type: 'cast', card: 'mist-moth' }]), 'enter trigger with no target: plain cast');
  s = put(s, 1, 'grove-stag'); s = put(s, 1, 'shield-bug');
  const MM = legalActions(s).filter(a => a.card === 'mist-moth');
  ok(MM.length === 1 && MM[0].target === uidOf(s, 1, 'grove-stag'), 'enter trigger: targets, shell left out');
  throws(() => step(s, { type: 'cast', card: 'mist-moth' }), 'step refuses a targeted creature cast with no target');
  r = step(s, MM[0]);
  ok(r.players[1].hand.includes('grove-stag') && r.players[0].battlefield.some(x => x.id === 'mist-moth'), 'mist moth enters and bounces');
  // Diving Beetle taps on enter
  s = board(); s.players[0].hand = ['diving-beetle']; s = lands(s, 'dew-pond', 3); s = put(s, 1, 'bark-toad');
  r = step(s, legalActions(s).find(a => a.card === 'diving-beetle'));
  ok(r.players[1].battlefield[0].tapped, 'diving beetle taps a blocker');
  // discard on enter (Mould Crawler)
  s = board(); s.players[0].hand = ['mould-crawler']; s = lands(s, 'rot-log', 3); s.players[1].hand = ['grove-stag', 'flare-spit'];
  r = step(s, { type: 'cast', card: 'mould-crawler' });
  ok(J(r.players[1].hand) === J(['flare-spit']), 'enter: opposing discard');
  // death triggers in combat: Maggot Mass makes two maggots; Bloated Tick drains 2
  s = board(); s = put(s, 0, 'hive-soldier'); s = put(s, 1, 'maggot-mass'); s = attackPhase(s);
  r = step(s, { type: 'attack', attackers: [uidOf(s, 0, 'hive-soldier')] });
  r = step(r, { type: 'block', blocks: [[uidOf(r, 0, 'hive-soldier'), uidOf(r, 1, 'maggot-mass')]] });
  ok(r.players[1].battlefield.filter(x => x.id === 'maggot').length === 2 && r.players[1].graveyard.includes('maggot-mass'), 'death trigger: two maggots');
  { const t = r.events.map(e => e.t + (e.when ? ':' + e.when : '') + (e.id ? ':' + e.id : ''));
    const iD = t.indexOf('dies:maggot-mass'), iT = t.indexOf('trigger:death:maggot-mass');
    ok(iD >= 0 && iT > iD && t.filter(x => x === 'enter:maggot').length === 2 && t.lastIndexOf('enter:maggot') > iT, 'events: dies, then the death trigger, then two maggots enter'); }
  s = board(); s = put(s, 0, 'grove-stag'); s = put(s, 1, 'bloated-tick'); s = attackPhase(s);
  r = step(s, { type: 'attack', attackers: [uidOf(s, 0, 'grove-stag')] });
  r = step(r, { type: 'block', blocks: [[uidOf(r, 0, 'grove-stag'), uidOf(r, 1, 'bloated-tick')]] });
  ok(r.players[1].life === 20 + 2 + 2 && r.players[0].life === 18, 'tick: sap 2 in the fight, then drain 2 on death');
  // death trigger from a destroy spell, and a lethal death drain ends the game
  s = board(); s.players[0].hand = ['strangle-root']; s = lands(s, 'moss-hollow', 2); s = put(s, 1, 'burying-beetle'); s.players[0].life = 1;
  r = step(s, legalActions(s).find(a => a.card === 'strangle-root'));
  ok(isOver(r) && r.result.winner === 1 && r.result.reason === 'life', 'death drain can win the game');
  // start-of-turn trigger: Lantern Firefly heals 1 on its controller's turn only
  s = board(); s = put(s, 1, 'lantern-firefly'); s = put(s, 1, 'lily-ward');
  r = step(s, { type: 'pass' });
  ok(r.turn === 2 && r.players[1].life === 22 && r.players[0].life === 20, 'start of turn: two heal triggers');
  ok(r.events.filter(e => e.t === 'trigger' && e.when === 'upkeep').length === 2, 'events: upkeep triggers');
  // describe a targeted creature cast
  s = board(); s.players[0].hand = ['diving-beetle']; s = lands(s, 'dew-pond', 3); s = put(s, 1, 'bark-toad');
  ok(/casts Diving Beetle on Bark Toad/.test(describe(legalActions(s).find(a => a.card === 'diving-beetle'), s)), 'describe: creature with a target');
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
  ok(quiet.log.length === 0 && quiet.events.length === 0 && J({ ...quiet, log: 0, logOn: 0, events: 0 }) === J({ ...end, log: 0, logOn: 0, events: 0 }), 'log off: same game, no text, no events');
}

// --------------------------------------------------------------- 5000 random games over every deck pair, speed
{
  const N = 5000;
  const pairs = [];
  for (const a of DECK_ORDER) for (const b of DECK_ORDER) pairs.push([a, b]);
  const t0 = performance.now();
  let empty = 0, steps = 0, over = 0, maxL = 0, illegal = 0, threw = 0, badF = 0, draws = 0;
  const seenPair = new Set();
  const wins = Object.fromEntries(DECK_ORDER.map(d => [d, 0]));
  const rng = mulberry32(2026);
  for (let g = 0; g < N; g++) {
    const decks = pairs[g % pairs.length];
    seenPair.add(decks.join('|'));
    let s = newGame({ seed: g, first: g & 1, log: g % 50 === 0, decks });
    try {
      while (!s.result) {
        const L = legalActions(s);
        if (!L.length) { empty++; break; }
        if (L.length > maxL) maxL = L.length;
        if (s.phase !== 'main' && L.length > MAX_OPTIONS) illegal++;
        if (g % 25 === 0) { const f = features(s, s.toAct); if (!f.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) badF++; }
        s = step(s, L[Math.floor(rng() * L.length)]);
        steps++;
      }
    } catch (e) { threw++; if (threw < 3) console.error(decks, e); }
    if (s.result) { over++; if (s.result.winner < 0) draws++; else wins[decks[s.result.winner]]++; }
  }
  const dt = (performance.now() - t0) / 1000;
  const gps = N / dt;
  ok(seenPair.size === DECK_ORDER.length ** 2, `every ordered deck pair played (${seenPair.size})`);
  ok(threw === 0, `no rules error in ${N} games (${threw})`);
  ok(empty === 0, 'legalActions never empty while the game is on');
  ok(over === N, `${N} random games finish (${over})`);
  ok(illegal === 0, 'attack and block lists stay within the cap');
  ok(badF === 0, 'features finite in [0,1] for every deck');
  ok(gps > 800, `speed: ${gps.toFixed(0)} random games/s (target > 800)`);
  console.log(`random play: ${N} games over ${seenPair.size} deck pairs in ${dt.toFixed(2)} s = ${gps.toFixed(0)} games/s, ` +
    `${(steps / N).toFixed(1)} steps/game, max ${maxL} options, ${draws} draws`);
  console.log('random wins by deck: ' + DECK_ORDER.map(d => `${d} ${wins[d]}`).join(', '));
}

// --------------------------------------------------------------- no mutation, every deck
{
  let mutated = 0;
  for (let g = 0; g < DECK_ORDER.length * 4; g++) {
    const decks = [DECK_ORDER[g % DECK_ORDER.length], DECK_ORDER[(g * 5 + 3) % DECK_ORDER.length]];
    try { playOut(800 + g, g, { freeze: true, decks }); } catch (e) { mutated++; if (mutated === 1) console.error(e); }
  }
  ok(mutated === 0, `step never mutates its input (${DECK_ORDER.length * 4} deep-frozen games, every deck)`);
}

// --------------------------------------------------------------- features are colour-generic
{
  ok(FEATURE_VERSION === 2 && F.untapped_lands_me === 7 && F.untapped_useful_me === 8, 'feature version 2, rows 7 and 8');
  ok(!FEATURE_NAMES.some(n => COLOUR_IDS.some(c => n.includes(c))), 'no feature names a colour');
  // the same board in two colours gives the same features
  const mk = (land, cre, hand) => {
    let s = board(); s.players[0].hand = hand;
    for (let i = 0; i < 3; i++) s = put(s, 0, land);
    s = put(s, 0, cre); s = put(s, 1, 'hive-soldier');
    return s;
  };
  const fa = features(mk('amber-ridge', 'hive-soldier', ['flare-spit', 'cinder-ant']), 0);
  const fr = features(mk('rot-log', 'hive-soldier', ['wither', 'blow-fly']), 0);
  ok(J(Array.from(fa)) === J(Array.from(fr)), 'same board shape in amber and in rot: same features');
  const off = features(mk('amber-ridge', 'hive-soldier', ['wither', 'blow-fly']), 0);
  ok(off[F.untapped_useful_me] === 0 && off[F.untapped_lands_me] === 3 / 6 && off[F.castable_in_hand] === 0, 'off-colour hand: no useful land, nothing castable');
  const dual = features(mk('cinder-fen', 'hive-soldier', ['wither', 'flare-spit']), 0);
  ok(dual[F.untapped_useful_me] === 3 / 6 && Math.abs(dual[F.castable_in_hand] - 2 / 7) < 1e-6, 'dual land makes both colours castable and useful');
  ok(fa[F.untapped_useful_me] === fa[F.untapped_lands_me], 'one-colour deck: rows 7 and 8 agree');
  let w = board(); w = put(w, 0, 'dune-wasp'); w = put(w, 1, 'orb-weaver');
  ok(features(w, 0)[F.evasive_power_me] === 0, 'web stops evasive power');
  let g = board(); g = put(g, 0, 'hive-soldier', { pc: 2 });
  ok(Math.abs(features(g, 0)[F.power_me] - 4 / 15) < 1e-6, 'growth counts in power');
}

// --------------------------------------------------------------- bots, every deck
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
  console.log(`greedy vs random (amber/moss): ${gw}/${N} wins, ${d} draws (seats and decks alternate)`);
  // every deck: greedy with it against random with each deck in turn
  const per = [];
  for (const deck of DECK_ORDER) {
    let w = 0, n = 0;
    for (let g = 0; g < 26; g++) {
      const other = DECK_ORDER[g % DECK_ORDER.length], gs = g & 1;
      const decks = gs ? [other, deck] : [deck, other];
      const bots = []; bots[gs] = greedyBot(); bots[1 - gs] = randomBot(mulberry32(4400 + g));
      let s = newGame({ seed: 5100 + g * 7 + deck.length, decks, first: (g >> 1) & 1, log: false });
      while (!s.result) { const L = legalActions(s); s = step(s, bots[s.toAct](s, L)); }
      n++; if (s.result.winner === gs) w++;
    }
    per.push(`${deck} ${w}/${n}`);
    ok(w / n >= 0.8, `greedy with ${deck} beats random: ${w}/${n}`);
  }
  console.log('greedy vs random by deck: ' + per.join(', '));
  const s = newGame({ seed: 8 });
  ok(boardScore(s, 0) === -boardScore(s, 1) || Number.isFinite(boardScore(s, 0)), 'boardScore finite');
  const r1 = randomBot(mulberry32(1)), r2 = randomBot(mulberry32(1));
  const L = legalActions(s);
  ok(r1(s, L) === r2(s, L), 'randomBot is seeded');
}

console.log(`game tests: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

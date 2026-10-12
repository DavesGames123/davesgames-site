// ============================================================================
//  FLY DUEL  ·  card pool and decks  (ES module, no DOM)
// ----------------------------------------------------------------------------
//  The game is our own card duel. Magic: The Gathering is the inspiration
//  only. Every name, rules text, flavour line and mana symbol here is
//  original. There are no names, symbols or frames from Wizards of the
//  Coast.
//
//  Five colours plus colourless (COLOURS gives the names and the themes):
//      amber   fire and aggression: fast bodies, burn, pump
//      moss    growth: big bodies, walls, ramp, lasting growth
//      dew     water and tricks: wings, tap, return to hand, cards
//      rot     decay: death triggers, sting, drain, discard, sacrifice
//      pollen  light and order: healing, wings, lunge, swarms of bees
//  A card can have two colours (colour 'multi', colours [a, b]).
//
//  Cost: { generic, amber, moss, dew, rot, pollen }. Every key is present
//  on every card. manaValue() is the sum.
//
//  Lands. A basic land makes one mana of its colour. A dual land makes one
//  mana of either of its two colours and enters tapped. Every land has
//  `mana: [colour...]`. `produces` is the first colour (older callers read
//  it). Basic lands have `basic: true`.
//
//  Keywords (KEYWORDS gives the reminder text):
//      swift  can attack on the turn it enters (no entry sickness)
//      wings  can be blocked only by creatures with wings or web
//      web    can block creatures with wings
//      sting  any damage from it to a creature destroys that creature
//      thick  cannot attack (a wall)
//      sap    combat damage it deals also gives its controller that much life
//      lunge  deals combat damage before creatures without lunge
//      crush  when blocked, damage over what kills the blocker hits the player
//      shell  opposing spells and effects cannot target it
//      alert  attacking does not tap it
//
//  Effects. A card has at most one `effect` (with an optional untargeted
//  `then` effect after it), plus, on a creature, `onDeath` and `onUpkeep`.
//      kind      what it does                                     targets
//      damage    n damage                                         any, opp, each, face
//      draw      draw n cards                                     self
//      pump      +n/+n this turn (tough: other toughness bonus)   own
//      heal      gain n life                                      self
//      destroy   destroy a creature with power <= n (n 99: any);  opp
//                min: power >= min
//      token     make n tokens of id `token`                      self
//      grow      a lasting +n/+n (counters, field pc)             own, this, all
//      rally     each of your creatures gets +n/+n this turn      self
//      drain     opposing player loses n, you gain n              self
//      tap       tap one opposing creature                        opp
//      bounce    return one opposing creature to its owner's hand opp
//      ramp      first n land cards of your library enter tapped  self
//      discard   opposing player discards n most costly cards     self
//      weaken    -n/-n this turn                                  opp, each
//      feast     destroy one of your creatures, then draw n       own
//      raise     most costly creature card of your graveyard
//                returns to your hand                             self
//      counter   put n counters of kind `counter` on creatures    own, this, all
//      chance    roll one die; at `at` or more do `hit`, else     self
//                `miss` (optional)
//      tick      (start of turn) one counter of kind `counter`    this
//                on (+1) or off (-1); at `at` do `done`; reset
//                takes them off; dies kills the creature
//  Dice. The amount of damage, draw, heal, token, drain, counter, chance
//  and rally (with each) can be dice text in Dice Lab notation: '2d4',
//  'd20' (pages/dice/notation.js parses it; d4 to d20, no explode). The
//  rules engine rolls it. per: 'creature' rolls once per creature you
//  control. Counter kinds (COUNTER_KINDS): growth (+1/+1 each), charge,
//  age, time. enterCounters: { kind: n } on a creature that enters with
//  them. The 3D table shows each roll as a thrown die and each counter
//  kind as a die on the card (ui/fly3d/dice3d.js).
//  Target words: 'any' = the opposing player or one opposing creature,
//  'opp' = one opposing creature, 'own' = one of your creatures, 'self' =
//  no choice, 'this' = the creature itself, 'each' = every opposing
//  creature, 'all' = every one of your creatures, 'face' = the opposing
//  player. Harmful effects touch only the opposing side.
//
//  Text. rulesText(card) writes the rules text from the data, so the text
//  always says what the rules engine does. card.text is that text.
//
//  EXPORTS   (jump with grep -n "<anchor>" game/cards.js)
//      COLOURS ........ "export const COLOURS"     id -> {name, theme, ink}
//      COLOUR_IDS ..... "export const COLOUR_IDS"  the five colour ids
//      KEYWORDS ....... "export const KEYWORDS"    reminder text
//      KEYWORD_NAMES .. "export const KEYWORD_NAMES"  id -> display word
//      CARDS .......... "export const CARDS"       every card definition
//      TOKENS ......... "export const TOKENS"      token creatures
//      CARD ........... "export const CARD"        id -> definition
//      DECKS .......... "export const DECKS"       named 40-card lists
//      DECK_ORDER ..... "export const DECK_ORDER"  deck ids in menu order
//      rulesText ...... "export function rulesText"  text from card data
//      manaValue ...... "export function manaValue"  total cost
//      cardColours .... "export function cardColours"  colours a card needs
//      deckColours .... "export function deckColours"  colours of a deck
//      buildDeck ...... "export function buildDeck"  shuffled id array
//      deckList ....... "export function deckList"   [{card, count}] rows
//      validateDeck ... "export function validateDeck"  {ok, errors, ...}
//      diceSpec ....... "export function diceSpec"   dice text -> terms
//      diceMean ....... "export function diceMean"   exact mean
//      diceChance ..... "export function diceChance" P(roll >= at)
//      cardRolls ...... "export function cardRolls"  card can roll dice
//      cardCounters ... "export function cardCounters"  card uses counters
//      DICE_KINDS ..... "export const DICE_KINDS"    effects that take dice
//      COUNTER_KINDS .. "export const COUNTER_KINDS" growth charge age time
//  INTERNALS
//      k() ............ "const k ="                cost from a short string
//      cr/sp/land ..... "const cr ="               card builders
// ============================================================================
import { shuffle } from '../data/rng.js';
import { parse as parseDice } from '../../dice/notation.js';

export const COLOUR_IDS = Object.freeze(['amber', 'moss', 'dew', 'rot', 'pollen']);

// ink: a suggested hard colour for glyphs and rims (UI may use its own).
export const COLOURS = Object.freeze({
  amber: { name: 'Amber', letter: 'A', theme: 'fire and aggression', ink: '#ffb347' },
  moss: { name: 'Moss', letter: 'M', theme: 'growth and size', ink: '#a8d65a' },
  dew: { name: 'Dew', letter: 'D', theme: 'water, wings and tricks', ink: '#6cc4e8' },
  rot: { name: 'Rot', letter: 'R', theme: 'decay, death and sacrifice', ink: '#b58ad0' },
  pollen: { name: 'Pollen', letter: 'P', theme: 'light, order and healing', ink: '#f2e48a' },
});

export const KEYWORDS = {
  swift: 'Swift: can attack on the turn it enters.',
  wings: 'Wings: only creatures with wings or web can block it.',
  web: 'Web: can block creatures with wings.',
  sting: 'Sting: any damage it deals to a creature destroys that creature.',
  thick: 'Thick: cannot attack.',
  sap: 'Sap: combat damage it deals also gives you that much life.',
  lunge: 'Lunge: deals combat damage before creatures without lunge.',
  crush: 'Crush: when blocked, damage over what the blocker needs hits the player.',
  shell: 'Shell: opposing spells and effects cannot target it.',
  alert: 'Alert: attacking does not tap it.',
};
export const KEYWORD_NAMES = Object.freeze(Object.fromEntries(Object.keys(KEYWORDS).map(w => [w, w[0].toUpperCase() + w.slice(1)])));

// ------------------------------------------------------------ builders
// Cost from a short string: digits = generic, A M D R P = one coloured mana.
const LETTER = { A: 'amber', M: 'moss', D: 'dew', R: 'rot', P: 'pollen' };
const k = (str = '') => {
  const cost = { generic: 0, amber: 0, moss: 0, dew: 0, rot: 0, pollen: 0 };
  const m = /^(\d*)([AMDRP]*)$/.exec(str);
  if (!m) throw new Error(`bad cost ${str}`);
  cost.generic = m[1] ? +m[1] : 0;
  for (const ch of m[2]) cost[LETTER[ch]]++;
  return cost;
};
const colourOf = cost => {
  const cs = COLOUR_IDS.filter(c => cost[c] > 0);
  return { colour: cs.length === 0 ? 'none' : cs.length === 1 ? cs[0] : 'multi', colours: cs };
};
// creature: cr(id, name, cost, p, t, keywords, subtype, flavour, extra)
const cr = (id, name, cost, power, toughness, keywords, subtype, flavour, extra = {}) => ({
  id, name, ...colourOf(k(cost)), type: 'creature', cost: k(cost), power, toughness, keywords, subtype, flavour, ...extra,
});
// spell: sp(id, name, cost, effect, subtype, flavour)
const sp = (id, name, cost, effect, subtype, flavour) => ({
  id, name, ...colourOf(k(cost)), type: 'spell', cost: k(cost), keywords: [], effect, subtype, flavour,
});
// land: land(id, name, [colours], subtype, flavour)
const land = (id, name, mana, subtype, flavour) => ({
  id, name, colour: mana.length === 1 ? mana[0] : 'multi', colours: mana.slice(), type: 'land', cost: k(), keywords: [],
  mana: mana.slice(), produces: mana[0], basic: mana.length === 1, entersTapped: mana.length > 1, subtype, flavour,
});
const E = (kind, amount, target, more = {}) => ({ kind, amount, target, ...more });

// ------------------------------------------------------------------ dice
// Dice text in the notation of Dice Lab (pages/dice/notation.js): '2d4',
// 'd20', 'd6+1', '2d20kh1'. The game uses only real dice (d4, d6, d8,
// d10, d12, d20) and no exploding dice. diceSpec() parses once and keeps
// the result.
export const DIE_SIDES = Object.freeze([4, 6, 8, 10, 12, 20]);
const SPEC = new Map();
export function diceSpec(text) {
  let sp = SPEC.get(text);
  if (sp) return sp;
  const r = parseDice(text);
  if (r.error) throw new Error(`bad dice ${text}: ${r.error}`);
  for (const t of r.terms) {
    if (t.kind === 'dice' && (!DIE_SIDES.includes(t.sides) || t.explode)) throw new Error(`bad dice ${text}: d4 to d20 only, no explode`);
  }
  sp = { terms: r.terms, text };
  SPEC.set(text, sp);
  return sp;
}
export const isDice = a => typeof a === 'string';

// The mean of a dice text (exact). A number is its own mean. With keep,
// the mean comes from the full table of outcomes (small dice counts only).
export function diceMean(a) {
  if (typeof a === 'number') return a;
  let m = 0;
  for (const t of diceSpec(a).terms) {
    if (t.kind === 'const') { m += t.sign * t.value; continue; }
    if (!t.keep) { m += t.sign * t.count * (t.sides + 1) / 2; continue; }
    let sum = 0, n = 0;
    const vals = new Array(t.count).fill(1);
    for (;;) {
      const kept = vals.slice().sort((x, y) => (t.keep.hi ? y - x : x - y)).slice(0, t.keep.n);
      sum += kept.reduce((x, y) => x + y, 0); n++;
      let i = 0;
      while (i < t.count && vals[i] === t.sides) vals[i++] = 1;
      if (i === t.count) break;
      vals[i]++;
    }
    m += t.sign * sum / n;
  }
  return Math.max(0, m);
}

// Chance that a dice text rolls `at` or more (exact, one die: (sides-at+1)/sides).
export function diceChance(a, at) {
  const sp = diceSpec(a);
  const t = sp.terms;
  if (t.length === 1 && t[0].kind === 'dice' && t[0].count === 1 && !t[0].keep) {
    const s = t[0].sides;
    return Math.max(0, Math.min(1, (s - at + 1) / s));
  }
  // general case: the full table of sums (the game uses small dice counts)
  if (t.some(x => x.keep)) throw new Error(`diceChance: no keep in ${a}`);
  let dist = new Map([[0, 1]]);
  for (const term of t) {
    if (term.kind === 'const') { dist = new Map([...dist].map(([v, q]) => [v + term.sign * term.value, q])); continue; }
    for (let i = 0; i < term.count; i++) {
      const nd = new Map();
      for (const [v, q] of dist) for (let f = 1; f <= term.sides; f++) nd.set(v + term.sign * f, (nd.get(v + term.sign * f) || 0) + q / term.sides);
      dist = nd;
    }
  }
  let c = 0;
  for (const [v, q] of dist) if (v >= at) c += q;
  return c;
}

// --------------------------------------------------------------- the pool
const POOL = [
  // ---------------------------------------------------------- basic lands
  land('amber-ridge', 'Amber Ridge', ['amber'], 'Ridge', 'Old resin, warm in the sun, full of trapped wings.'),
  land('moss-hollow', 'Moss Hollow', ['moss'], 'Hollow', 'Wet ground under the roots. Everything starts here.'),
  land('dew-pond', 'Dew Pond', ['dew'], 'Pond', 'Every morning it fills again, one drop at a time.'),
  land('rot-log', 'Rot Log', ['rot'], 'Log', 'The tree fell years ago. It is busier now than when it stood.'),
  land('pollen-meadow', 'Pollen Meadow', ['pollen'], 'Meadow', 'The air is gold with it from June to the first frost.'),

  // ----------------------------------------------------------- dual lands
  land('burnt-clearing', 'Burnt Clearing', ['amber', 'moss'], 'Clearing', 'The fire went through in spring. By summer the ferns were back.'),
  land('geyser-basin', 'Geyser Basin', ['amber', 'dew'], 'Basin', 'Hot water from below, cold water from above.'),
  land('cinder-fen', 'Cinder Fen', ['amber', 'rot'], 'Fen', 'The peat smoulders under the water all year.'),
  land('sunlit-ridge', 'Sunlit Ridge', ['amber', 'pollen'], 'Ridge', 'The bees work the south slope from first light.'),
  land('fern-spring', 'Fern Spring', ['moss', 'dew'], 'Spring', 'Clear water under green shade.'),
  land('leaf-litter', 'Leaf Litter', ['moss', 'rot'], 'Floor', 'Last year\'s leaves feed this year\'s roots.'),
  land('clover-hill', 'Clover Hill', ['moss', 'pollen'], 'Hill', 'Short grass, white flowers, and a hum you feel in your feet.'),
  land('still-marsh', 'Still Marsh', ['dew', 'rot'], 'Marsh', 'Nothing moves on the surface. Everything moves under it.'),
  land('dawn-lake', 'Dawn Lake', ['dew', 'pollen'], 'Lake', 'At sunrise the water and the sky are the same colour.'),
  land('old-orchard', 'Old Orchard', ['rot', 'pollen'], 'Orchard', 'Blossom on the branches, windfalls in the grass.'),

  // ---------------------------------------------------------------- amber
  cr('ember-gnat', 'Ember Gnat', 'A', 1, 1, ['swift'], 'Gnat', 'Small, hot and already on your face.'),
  cr('cinder-ant', 'Cinder Ant', 'A', 2, 1, [], 'Ant', 'Carries ten times its weight, mostly anger.'),
  cr('ash-cricket', 'Ash Cricket', 'A', 1, 2, ['lunge'], 'Cricket', 'It sings in the embers and bites before you see it move.'),
  cr('dune-wasp', 'Dune Wasp', '1A', 2, 1, ['wings'], 'Wasp', 'It nests in the hot sand and hunts above it.'),
  cr('hive-soldier', 'Hive Soldier', '1A', 2, 2, [], 'Bee', 'One of ten thousand. It does not mind.'),
  cr('sting-hopper', 'Sting Hopper', '1A', 1, 1, ['sting'], 'Hopper', 'Small enough to step on. Nobody tries twice.'),
  cr('ram-weevil', 'Ram Weevil', '2A', 3, 2, ['crush'], 'Weevil', 'It goes through the grain, the sack and the wall behind it.'),
  cr('spark-hornet', 'Spark Hornet', '2A', 2, 2, ['wings', 'swift'], 'Hornet', 'You hear it after it has gone.'),
  cr('ember-mantis', 'Ember Mantis', '2A', 3, 2, ['swift'], 'Mantis', 'Patience is for prey.'),
  cr('scald-beetle', 'Scald Beetle', '3A', 3, 3, [], 'Beetle', 'It fires a boiling spray from its tail. Small things do not get up.',
    { effect: E('damage', 1, 'each') }),
  cr('brood-captain', 'Brood Captain', '3A', 3, 3, [], 'Ant', 'It never marches alone.',
    { effect: E('token', 1, 'self', { token: 'ember-larva' }) }),
  cr('magma-beetle', 'Magma Beetle', '3AA', 5, 4, [], 'Beetle', 'Its shell still glows from the vent where it hatched.'),
  cr('sun-locust', 'Sun Locust Swarm', '4AA', 4, 4, ['wings', 'swift'], 'Locust', 'The sky goes dark, then the fields do.'),
  cr('torch-queen', 'Torch Hornet Queen', '4AA', 4, 3, ['wings', 'lunge'], 'Hornet', 'The nest is paper. The queen is not.'),
  sp('flare-spit', 'Flare Spit', 'A', E('damage', 2, 'any'), 'Venom', 'Acid first, questions never.'),
  sp('war-chirp', 'War Chirp', 'A', E('pump', 2, 'own'), 'Song', 'A sound that makes small things brave.'),
  sp('heat-pulse', 'Heat Pulse', '1A', E('damage', 3, 'any'), 'Fever', 'The wing muscles burn hot enough to cook a moth.'),
  sp('hive-fever', 'Hive Fever', '1A', E('rally', 1, 'self'), 'Frenzy', 'One wasp is angry. Then they all are.'),
  sp('kiln-burst', 'Kiln Burst', '2A', E('damage', 4, 'any'), 'Eruption', 'The ridge cracks open and the light comes out.'),
  sp('swarm-call', 'Swarm Call', '2A', E('token', 2, 'self', { token: 'ember-larva' }), 'Signal', 'One signal, and the ground boils.'),
  sp('brush-fire', 'Brush Fire', '2AA', E('damage', 2, 'each'), 'Wildfire', 'Dry grass, a dry wind, and one spark.'),

  // ----------------------------------------------------------------- moss
  cr('root-sentinel', 'Root Sentinel', 'M', 0, 4, ['thick'], 'Oak', 'It has stood here for a hundred years. It will stand a hundred more.'),
  cr('moss-snail', 'Moss Snail', '1M', 1, 3, ['sap'], 'Snail', 'Slow, wet and very hard to stop.'),
  cr('thorn-vine', 'Thorn Vine', '1M', 1, 2, ['sting'], 'Bramble', 'One scratch, and the rot begins.'),
  cr('seed-carrier', 'Seed Carrier Ant', '1M', 1, 1, [], 'Ant', 'It plants the seeds it forgets to eat.',
    { effect: E('ramp', 1, 'self') }),
  cr('bark-toad', 'Bark Toad', '2M', 2, 4, [], 'Toad', 'It eats gnats by the hundred and does not hurry.'),
  cr('dew-moth', 'Dew Moth', '2M', 2, 2, ['wings'], 'Moth', 'It follows the scent of rain to new places.',
    { effect: E('draw', 1, 'self') }),
  cr('briar-wall', 'Briar Wall', '2M', 1, 6, ['thick', 'sap'], 'Rose', 'It drinks from whatever it scratches.'),
  cr('orb-weaver', 'Orb Weaver', '2M', 2, 3, ['web'], 'Spider', 'Every night a new wheel between the stems.'),
  cr('spore-mother', 'Spore Mother', '3M', 2, 3, [], 'Fungus', 'A puff of dust, and the clearing fills.',
    { effect: E('token', 2, 'self', { token: 'spore' }) }),
  cr('grove-stag', 'Old Grove Stag', '3MM', 5, 5, [], 'Beetle', 'Moss grows on its antlers. It does not care.'),
  cr('moss-tortoise', 'Moss Tortoise', '4M', 4, 5, ['alert'], 'Tortoise', 'It carries a small garden on its back and never stops to water it.'),
  cr('fern-beast', 'Fern Colossus', '4MM', 6, 6, ['sap'], 'Fern', 'When it walks, the forest walks with it.'),
  cr('elder-mycelium', 'Elder Mycelium', '4MM', 5, 5, ['crush'], 'Fungus', 'Under the whole wood it is one thing, and it is awake.'),
  sp('sap-bloom', 'Sap Bloom', 'M', E('heal', 4, 'self'), 'Nectar', 'Sweet and slow, like the spring.'),
  sp('swell', 'Swell', 'M', E('pump', 3, 'own'), 'Growth', 'Rain in the night, and by morning it is twice the size.'),
  sp('deep-roots', 'Deep Roots', '1M', E('draw', 2, 'self'), 'Growth', 'Under every forest is a second forest.'),
  sp('strangle-root', 'Strangle Root', '1M', E('destroy', 3, 'opp'), 'Snare', 'The ground opens and closes again.'),
  sp('wild-bloom', 'Wild Bloom', '1M', E('ramp', 1, 'self', { then: E('heal', 2, 'self') }), 'Growth', 'Seeds in every crack of the rock.'),
  sp('ring-growth', 'Ring Growth', '1M', E('grow', 2, 'own'), 'Growth', 'Ring by ring, year by year, all at once.'),
  sp('spore-burst', 'Puffball Split', '2M', E('token', 3, 'self', { token: 'spore' }), 'Spores', 'The fruiting body splits with a sigh.'),

  // ------------------------------------------------------------------ dew
  cr('pond-skater', 'Pond Skater', 'D', 1, 2, ['wings'], 'Strider', 'It walks on the skin of the water and never gets wet.'),
  cr('caddis-case', 'Caddis Case', '1D', 0, 4, ['thick', 'shell'], 'Larva', 'A house of sand grains, glued with silk.'),
  cr('water-boatman', 'Water Boatman', '1D', 2, 1, ['shell'], 'Bug', 'It rows on its back and carries its own air.'),
  cr('mayfly-drift', 'Mayfly Drift', '1D', 1, 1, ['wings'], 'Mayfly', 'Two years under the water for one day in the air.',
    { effect: E('draw', 1, 'self') }),
  cr('diving-beetle', 'Diving Beetle', '2D', 2, 3, [], 'Beetle', 'It takes a bubble down and comes up with dinner.',
    { effect: E('tap', 1, 'opp') }),
  cr('darner', 'Darner Dragonfly', '2D', 2, 2, ['wings', 'lunge'], 'Dragonfly', 'It turns faster than its prey can think.'),
  cr('bell-spider', 'Bell Spider', '2D', 1, 4, ['web'], 'Spider', 'It lives under the water in a bell of silk and air.'),
  cr('newt-sage', 'Newt Sage', '3D', 2, 3, [], 'Newt', 'It has seen many springs come and go, and remembers each one.',
    { effect: E('draw', 1, 'self') }),
  cr('blue-damselfly', 'Blue Damselfly', '3D', 3, 2, ['wings'], 'Damselfly', 'A thin blue line, there and then not.'),
  cr('mist-moth', 'Mist Moth', '4D', 3, 4, ['wings'], 'Moth', 'When it passes, the far bank is gone.',
    { effect: E('bounce', 1, 'opp') }),
  cr('storm-darner', 'Storm Darner', '4DD', 4, 4, ['wings', 'alert'], 'Dragonfly', 'It hunts in the rain, in the gaps between the drops.'),
  sp('ripple', 'Ripple', 'D', E('tap', 1, 'opp', { then: E('draw', 1, 'self') }), 'Trick', 'A small wave in the right place.'),
  sp('surface-tension', 'Surface Tension', 'D', E('pump', 1, 'own', { tough: 3 }), 'Trick', 'The water holds, just long enough.'),
  sp('carried-off', 'Carried Off', '1D', E('bounce', 1, 'opp'), 'Tide', 'The stream does not argue. It just keeps going.'),
  sp('clear-water', 'Clear Water', '2D', E('draw', 2, 'self'), 'Insight', 'Wait for the mud to settle, and you can see to the bottom.'),
  sp('spring-spate', 'Spring Spate', '3D', E('bounce', 1, 'opp', { then: E('draw', 1, 'self') }), 'Tide', 'Dry bed at noon. A river by one.'),

  // ------------------------------------------------------------------ rot
  cr('blow-fly', 'Blow Fly', 'R', 1, 1, ['wings'], 'Fly', 'It finds the dead within the hour.'),
  cr('burying-beetle', 'Burying Beetle', '1R', 2, 1, [], 'Beetle', 'It buries the dead and raises its young on them.',
    { onDeath: E('drain', 1, 'self') }),
  cr('maggot-mass', 'Maggot Mass', '1R', 1, 1, [], 'Larva', 'Kill one and you have only made room.',
    { onDeath: E('token', 2, 'self', { token: 'maggot' }) }),
  cr('marsh-leech', 'Marsh Leech', '1R', 1, 2, ['sap'], 'Leech', 'It takes a little, and you do not feel it until later.'),
  cr('assassin-bug', 'Assassin Bug', '2R', 2, 1, ['sting'], 'Bug', 'It waits on the flower that its prey wants most.'),
  cr('death-cap', 'Death Cap', '2R', 1, 3, ['thick', 'sting'], 'Fungus', 'Pale, quiet and not to be touched.'),
  cr('mould-crawler', 'Mould Crawler', '2R', 2, 2, [], 'Slime', 'It eats paper, bread, plans and promises.',
    { effect: E('discard', 1, 'self') }),
  cr('bone-centipede', 'Bone Centipede', '3R', 3, 3, ['lunge'], 'Centipede', 'A hundred legs, and every one of them is in a hurry.'),
  cr('bloated-tick', 'Bloated Tick', '3R', 2, 4, ['sap'], 'Tick', 'Full, and still not finished.',
    { onDeath: E('drain', 2, 'self') }),
  cr('sexton-beetle', 'Sexton Beetle', '4R', 3, 3, [], 'Beetle', 'What it buries, it can dig up again.',
    { effect: E('raise', 1, 'self') }),
  cr('plague-swarm', 'Plague Swarm', '4RR', 4, 4, ['wings'], 'Fly', 'Where it lands, the grass goes brown.',
    { effect: E('weaken', 1, 'each') }),
  sp('wither', 'Wither', 'R', E('weaken', 2, 'opp'), 'Decay', 'Green at breakfast, grey by noon.'),
  sp('last-feast', 'Last Feast', 'R', E('feast', 2, 'own'), 'Feast', 'Nothing in the log goes to waste.'),
  sp('bog-breath', 'Bog Breath', '1R', E('drain', 2, 'self'), 'Miasma', 'A blue flame over the bog at night, and a bad smell by day.'),
  sp('gnaw', 'Gnaw', '2R', E('discard', 2, 'self'), 'Decay', 'Mice in the larder, worms in the books.'),
  sp('heart-rot', 'Heart Rot', '2RR', E('destroy', 99, 'opp'), 'Decay', 'The bark looks fine. The tree is already dead.'),
  sp('leaf-blight', 'Leaf Blight', '3RR', E('weaken', 2, 'each'), 'Decay', 'It spreads from leaf to leaf in one wet week.'),

  // --------------------------------------------------------------- pollen
  cr('hoverfly', 'Hoverfly', 'P', 1, 1, ['wings'], 'Fly', 'Dressed as a wasp. Not a wasp.'),
  cr('ladybird-knight', 'Ladybird Knight', '1P', 2, 1, ['lunge'], 'Beetle', 'Red shield, black spots, no fear of aphids.'),
  cr('shield-bug', 'Shield Bug', '1P', 1, 3, ['shell'], 'Bug', 'Its back is a shield and it knows it.'),
  cr('mason-bee', 'Mason Bee', '1P', 2, 2, ['alert'], 'Bee', 'It builds with mud, one cell at a time, and guards each one.'),
  cr('hive-warden', 'Hive Warden', '2P', 2, 3, ['alert'], 'Bee', 'It stands at the door and fans the heat out of the hive.',
    { effect: E('heal', 2, 'self') }),
  cr('lantern-firefly', 'Lantern Firefly', '2P', 2, 2, ['wings'], 'Firefly', 'A small cold light, on and off, all night.',
    { onUpkeep: E('heal', 1, 'self') }),
  cr('lily-ward', 'Lily Ward', '2P', 0, 5, ['thick'], 'Lily', 'White petals, deep roots, and it does not move.',
    { onUpkeep: E('heal', 1, 'self') }),
  cr('golden-orb', 'Golden Orb Weaver', '3P', 2, 4, ['web'], 'Spider', 'Its silk shines like wire in the morning sun.'),
  cr('honeyguard', 'Honeyguard', '3P', 3, 3, ['lunge', 'alert'], 'Bee', 'First to the fight, last to leave the door.'),
  cr('sun-moth', 'Sun Moth', '3P', 2, 4, ['wings', 'sap'], 'Moth', 'It flies by day and drinks the light from flowers.'),
  cr('bumble-queen', 'Bumblebee Queen', '4P', 3, 3, [], 'Bee', 'She wakes first in spring and starts the colony alone.',
    { effect: E('token', 2, 'self', { token: 'worker-bee' }) }),
  cr('comb-queen', 'Queen of the Comb', '5PP', 5, 5, ['wings', 'alert'], 'Bee', 'Every cell in the hive is hers, and every bee.',
    { effect: E('grow', 1, 'all') }),
  sp('dawn-blessing', 'Dawn Blessing', 'P', E('grow', 1, 'own', { then: E('heal', 2, 'self') }), 'Blessing', 'The first light lands on the strong.'),
  sp('honey-balm', 'Honey Balm', '1P', E('heal', 3, 'self', { then: E('draw', 1, 'self') }), 'Nectar', 'It keeps for a thousand years and heals what it touches.'),
  sp('bloom-hymn', 'Bloom Hymn', '1P', E('rally', 1, 'self'), 'Song', 'The whole meadow hums one note.'),
  sp('pollinate', 'Pollinate', '2P', E('token', 2, 'self', { token: 'worker-bee' }), 'Swarm', 'Flower to flower, and the hive grows.'),
  sp('solar-verdict', 'Solar Verdict', '2P', E('destroy', 99, 'opp', { min: 4 }), 'Light', 'The bigger the shadow, the brighter the light that finds it.'),

  // ------------------------------------------------------- two colours
  cr('bonfire-stag', 'Bonfire Stag', '2AM', 4, 3, ['swift', 'crush'], 'Beetle', 'Its horns are black from the fire it walked through.'),
  cr('steam-darner', 'Steam Darner', '2AD', 3, 2, ['wings', 'swift'], 'Dragonfly', 'Born where the hot spring meets the cold lake.'),
  cr('ash-wasp', 'Ash Wasp', '1AR', 2, 2, ['sting', 'swift'], 'Wasp', 'Grey wings, black sting, no warning.'),
  cr('solar-hornet', 'Solar Hornet', '2AP', 3, 3, ['wings', 'lunge'], 'Hornet', 'It hunts with the sun at its back.'),
  cr('lily-toad', 'Lily Pad Toad', '2MD', 2, 4, [], 'Toad', 'It sits so still the lilies grow around it.',
    { effect: E('draw', 1, 'self') }),
  cr('mycelium-mound', 'Mycelium Mound', '2MR', 3, 3, [], 'Fungus', 'Cut it down and it comes up in ten places.',
    { onDeath: E('token', 2, 'self', { token: 'spore' }) }),
  cr('meadow-matriarch', 'Meadow Matriarch', '3MP', 4, 4, ['sap', 'alert'], 'Bee', 'She knows every flower in the meadow by its smell.'),
  cr('silt-lamprey', 'Silt Lamprey', '2DR', 2, 3, ['sap', 'shell'], 'Lamprey', 'It holds on in the dark water and drinks.'),
  cr('glasswing', 'Glasswing', '2DP', 2, 3, ['wings', 'shell'], 'Butterfly', 'You can see the flower through its wings.'),
  cr('twilight-moth', 'Twilight Moth', '2RP', 2, 2, ['wings'], 'Moth', 'It comes out between the day and the night, and takes a little of each.',
    { effect: E('drain', 2, 'self') }),

  // ---------------------------------------------------------- three colours
  cr('colony-titan', 'Colony Titan', '2AMR', 5, 5, ['crush'], 'Termite', 'A mound the size of a house, and all of it is hungry.'),

  // ------------------------------------------------- dice and counters
  // Rolls use the game RNG (game/rules.js). Counters: growth (+1/+1 each),
  // charge and age (count up to an effect), time (count down to one).
  cr('tinder-cricket', 'Tinder Cricket', '1A', 2, 1, [], 'Cricket', 'It sings until the grass catches, or until it does not.',
    { effect: E('chance', 'd20', 'self', { at: 11, hit: E('damage', 2, 'face') }) }),
  cr('bombardier', 'Bombardier Beetle', '2A', 2, 2, [], 'Beetle', 'Pop. Pop. Then a very loud pop.',
    { onUpkeep: E('tick', 1, 'this', { counter: 'charge', at: 3, reset: true, done: E('damage', 3, 'face') }) }),
  sp('spark-scatter', 'Spark Scatter', '2A', E('damage', '2d4', 'any'), 'Sparks', 'Where the sparks land is the fun part.'),
  sp('drum-frenzy', 'Drumming Frenzy', '1A', E('rally', 'd4', 'self', { each: true, tough: 0 }), 'Frenzy', 'Every leg on the hollow log, and every beat a little faster.'),
  sp('ember-hail', 'Ember Hail', '3AA', E('damage', 'd12', 'any'), 'Hail', 'Hot stones from a clear sky.'),
  cr('cicada-nymph', 'Cicada Nymph', '1M', 1, 2, [], 'Cicada', 'Years in the dark, counting. Then one warm night, wings.',
    { enterCounters: { time: 3 }, onUpkeep: E('tick', -1, 'this', { counter: 'time', at: 0, done: E('counter', 4, 'this', { counter: 'growth' }) }) }),
  cr('gall-larva', 'Oak Gall Larva', '1M', 1, 1, [], 'Wasp', 'The tree builds it a house and feeds it all summer.',
    { onUpkeep: E('counter', 1, 'this', { counter: 'growth' }) }),
  sp('spring-downpour', 'Spring Downpour', '2M', E('counter', 'd6', 'own', { counter: 'growth' }), 'Growth', 'Some years it rains a little. Some years it rains a lot.'),
  cr('whirligig', 'Whirligig Beetle', '2D', 2, 2, [], 'Beetle', 'It spins on the pond in circles that only it understands.',
    { effect: E('chance', 'd20', 'self', { at: 11, hit: E('draw', 1, 'self') }) }),
  cr('moon-snail', 'Moon Snail', '1D', 0, 3, ['thick'], 'Snail', 'It counts the tides on its shell.',
    { onUpkeep: E('tick', 1, 'this', { counter: 'charge', at: 2, reset: true, done: E('draw', 1, 'self') }) }),
  sp('rain-omen', 'Rain Omen', '1D', E('chance', 'd6', 'self', { at: 4, hit: E('draw', 2, 'self'), miss: E('draw', 1, 'self') }), 'Omen', 'Read the ripples. Some days they say more.'),
  cr('deathwatch', 'Deathwatch Beetle', '2R', 3, 3, [], 'Beetle', 'Tap, tap, tap in the beam at night, and one fewer each time.',
    { onUpkeep: E('tick', 1, 'this', { counter: 'age', at: 3, dies: true }), onDeath: E('drain', 2, 'self') }),
  cr('carrion-hive', 'Carrion Hive', '3R', 2, 3, [], 'Fly', 'Nobody knows how many are inside until it breaks.',
    { onDeath: E('token', 'd4', 'self', { token: 'maggot' }) }),
  sp('knucklebones', 'Knucklebones', '2R', E('drain', 'd8', 'self'), 'Lots', 'Old bones make honest dice.'),
  cr('scout-bee', 'Scout Bee', '2P', 1, 2, ['wings'], 'Bee', 'Most days it comes home with news. Some days it comes home with friends.',
    { onUpkeep: E('chance', 'd6', 'self', { at: 5, hit: E('token', 1, 'self', { token: 'worker-bee' }) }) }),
  cr('royal-cell', 'Royal Cell', '2P', 0, 3, ['thick'], 'Bee', 'Wax walls, royal jelly, and a slow count to spring.',
    { enterCounters: { time: 2 }, onUpkeep: E('tick', -1, 'this', { counter: 'time', at: 0, dies: true, done: E('token', 3, 'self', { token: 'worker-bee' }) }) }),
  sp('waggle-dance', 'Waggle Dance', '1P', E('heal', 'd4', 'self', { per: 'creature' }), 'Dance', 'Every bee in the hive dances the way to the flowers.'),
  sp('honey-harvest', 'Honey Harvest', '2P', E('heal', 'd10', 'self', { then: E('draw', 1, 'self') }), 'Nectar', 'A good year fills every frame. A poor year fills some.'),

  // ------------------------------------------------------------ colourless
  cr('pill-bug', 'Pill Bug', '2', 1, 2, [], 'Woodlouse', 'Roll it over and it rolls up. Roll it back and it may get bigger.',
    { effect: E('chance', 'd6', 'self', { at: 4, hit: E('counter', 2, 'this', { counter: 'growth' }) }) }),
  cr('drift-seed', 'Drift Seed', '1', 1, 1, ['wings'], 'Seed', 'Wherever the wind goes.'),
  cr('hollow-husk', 'Hollow Husk', '3', 2, 3, [], 'Crab', 'Something moved into the empty shell and kept walking.'),
];

// Tokens are creatures that only effects make. They never go to a library,
// a hand or a graveyard: when a token dies it is gone.
const TOKEN_POOL = [
  { ...cr('ember-larva', 'Ember Larva', '', 1, 1, ['swift'], 'Larva', ''), colour: 'amber', colours: ['amber'], token: true },
  { ...cr('spore', 'Spore', '', 1, 1, [], 'Fungus', ''), colour: 'moss', colours: ['moss'], token: true },
  { ...cr('maggot', 'Maggot', '', 1, 1, [], 'Larva', ''), colour: 'rot', colours: ['rot'], token: true },
  { ...cr('worker-bee', 'Worker Bee', '', 1, 1, ['wings'], 'Bee', ''), colour: 'pollen', colours: ['pollen'], token: true },
];

// ------------------------------------------------------------ rules text
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
const num = n => NUM[n] || String(n);
const cap = s => s[0].toUpperCase() + s.slice(1);
const TOKEN_BY_ID = Object.fromEntries(TOKEN_POOL.map(t => [t.id, t]));

// Dice text as words: 'd20' -> 'a d20', '2d4' -> '2d4'.
const diceWords = a => (/^d/.test(a) ? `a ${a}` : a);
const COUNTER_NOTE = { growth: [' (+1/+1)', ' (+1/+1 each)'] };
const counterWords = (n, kind) => (n === 1 ? `${kind === 'age' ? 'an' : 'a'} ${kind} counter` : `${num(n)} ${kind} counters`);

// The phrase of an effect. A dice amount rolls first: "roll 2d4: deal
// that much damage ...". per: 'creature' rolls once for each creature.
function phrase(e) {
  if (isDice(e.amount) && e.kind !== 'chance' && !e.each) {
    const roll = `roll ${diceWords(e.amount)}${e.per === 'creature' ? ' for each creature you control' : ''}`;
    return `${roll}: ${basePhrase(e, e.kind === 'token' || e.kind === 'counter' ? 'that many' : 'that much')}`;
  }
  return basePhrase(e, e.amount);
}

function basePhrase(e, n) {
  switch (e.kind) {
    case 'chance': {
      const hit = phrase(e.hit), miss = e.miss ? phrase(e.miss) : '';
      return `roll ${diceWords(e.amount)}: on ${e.at} or more, ${hit}${miss ? `; else ${miss}` : ''}`;
    }
    case 'counter': {
      const where = e.target === 'this' ? 'it' : e.target === 'all' ? 'each of your creatures' : 'one of your creatures';
      const what = typeof n === 'number' ? counterWords(n, e.counter) : `${n} ${e.counter} counters`;
      const note = COUNTER_NOTE[e.counter] ? COUNTER_NOTE[e.counter][n === 1 ? 0 : 1] : '';
      return `put ${what}${note} on ${where}`;
    }
    case 'tick': {
      const done = [e.done ? phrase(e.done) : '', e.dies ? 'it dies' : ''].filter(Boolean).join(', then ');
      if (e.amount < 0) return `remove a ${e.counter} counter from it; when the last one goes, ${done}`;
      return `put ${counterWords(1, e.counter)} on it; when it has ${num(e.at)}, ${e.reset ? 'remove them and ' : ''}${done}`;
    }
    case 'damage':
      if (e.target === 'any') return `deal ${n} damage to the opposing player or to one opposing creature`;
      if (e.target === 'opp') return `deal ${n} damage to one opposing creature`;
      if (e.target === 'each') return `deal ${n} damage to each opposing creature`;
      return `deal ${n} damage to the opposing player`;
    case 'draw': return n === 1 ? 'draw a card' : typeof n === 'number' ? `draw ${num(n)} cards` : `draw ${n} cards`;
    case 'pump': return `one of your creatures gets +${n}/+${e.tough ?? n} this turn`;
    case 'heal': return e.per ? 'you gain life equal to the total' : `you gain ${n} life`;
    case 'destroy':
      if (e.min) return `destroy one opposing creature with power ${e.min} or more`;
      return n >= 99 ? 'destroy one opposing creature' : `destroy one opposing creature with power ${n} or less`;
    case 'token': {
      const t = TOKEN_BY_ID[e.token];
      const kws = t.keywords.length ? ` with ${t.keywords.join(' and ')}` : '';
      return n === 1 ? `make one ${t.power}/${t.toughness} ${t.name}${kws}` : `make ${typeof n === 'number' ? num(n) : n} ${t.power}/${t.toughness} ${t.name} creatures${kws}`;
    }
    case 'grow':
      if (e.target === 'this') return `it gets a lasting +${n}/+${n}`;
      if (e.target === 'all') return `each of your creatures gets a lasting +${n}/+${n}`;
      return `one of your creatures gets a lasting +${n}/+${n}`;
    case 'rally':
      if (e.each) return `for each of your creatures, roll ${diceWords(e.amount)}: it gets that much ${e.tough === 0 ? 'more power' : '+X/+X'} this turn`;
      return `your creatures get +${n}/+${e.tough ?? n} this turn`;
    case 'drain': return `the opposing player loses ${n} life and you gain ${n} life`;
    case 'tap': return 'tap one opposing creature';
    case 'bounce': return 'return one opposing creature to its owner\'s hand';
    case 'ramp': return n === 1 ? 'put the first land card of your library onto the battlefield, tapped'
      : `put the first ${num(n)} land cards of your library onto the battlefield, tapped`;
    case 'discard': return n === 1 ? 'the opposing player discards its most costly card'
      : `the opposing player discards its ${num(n)} most costly cards`;
    case 'weaken':
      return e.target === 'each' ? `each opposing creature gets -${n}/-${n} this turn` : `one opposing creature gets -${n}/-${n} this turn`;
    case 'feast': return `destroy one of your creatures, then draw ${n === 1 ? 'a card' : num(n) + ' cards'}`;
    case 'raise': return 'return the most costly creature card from your graveyard to your hand';
    default: throw new Error(`no text for ${e.kind}`);
  }
}
const chain = e => cap(phrase(e)) + '.' + (e.then ? ' ' + cap(phrase(e.then)) + '.' : '');
const countersText = c => Object.entries(c).map(([k, n]) => counterWords(n, k)).join(' and ');
const lower = e => phrase(e) + (e.then ? ', then ' + phrase(e.then) : '');

// The rules text of a card, from its data.
export function rulesText(card) {
  if (card.type === 'land') {
    return card.mana.length === 1 ? `Tap: add one ${card.mana[0]} mana.`
      : `Enters tapped. Tap: add one ${card.mana[0]} or one ${card.mana[1]} mana.`;
  }
  const parts = (card.keywords || []).map(w => KEYWORD_NAMES[w] + '.');
  if (card.type === 'spell') parts.push(chain(card.effect));
  else {
    if (card.enterCounters) parts.push(`It enters with ${countersText(card.enterCounters)}.`);
    if (card.effect) parts.push(`When it enters, ${lower(card.effect)}.`);
    if (card.onDeath) parts.push(`When it dies, ${lower(card.onDeath)}.`);
    if (card.onUpkeep) parts.push(`At the start of your turn, ${lower(card.onUpkeep)}.`);
  }
  return parts.join(' ');
}

// Dice may stand in the amount of these effect kinds only (the rules
// engine rolls them). A chance effect needs one die and a hit effect.
export const DICE_KINDS = Object.freeze(['damage', 'draw', 'heal', 'token', 'drain', 'counter', 'chance', 'rally']);
export const COUNTER_KINDS = Object.freeze(['growth', 'charge', 'age', 'time']);
function checkEffect(id, e) {
  if (!e) return;
  if (isDice(e.amount)) {
    if (!DICE_KINDS.includes(e.kind)) throw new Error(`${id}: dice amount on ${e.kind}`);
    diceSpec(e.amount);
  }
  if (e.kind === 'chance') {
    const t = diceSpec(e.amount).terms;
    if (t.length !== 1 || t[0].count !== 1 || !e.hit || !Number.isInteger(e.at)) throw new Error(`${id}: chance needs one die, at and hit`);
  }
  if ((e.kind === 'counter' || e.kind === 'tick') && !COUNTER_KINDS.includes(e.counter)) throw new Error(`${id}: counter kind ${e.counter}`);
  if (e.kind === 'tick' && (Math.abs(e.amount) !== 1 || e.target !== 'this')) throw new Error(`${id}: tick is +1 or -1 on this`);
  for (const k of ['then', 'hit', 'miss', 'done']) checkEffect(id, e[k]);
}
for (const c of [...POOL, ...TOKEN_POOL]) {
  for (const k of ['effect', 'onDeath', 'onUpkeep']) checkEffect(c.id, c[k]);
  for (const k of Object.keys(c.enterCounters || {})) if (!COUNTER_KINDS.includes(k)) throw new Error(`${c.id}: counter kind ${k}`);
}
for (const c of [...POOL, ...TOKEN_POOL]) c.text = rulesText(c);

// True when a card can roll dice (its own effects, any depth).
const rollsIn = e => !!e && (isDice(e.amount) || ['then', 'hit', 'miss', 'done'].some(k => rollsIn(e[k])));
export function cardRolls(card) {
  const c = typeof card === 'string' ? CARD[card] : card;
  return !!c && ['effect', 'onDeath', 'onUpkeep'].some(k => rollsIn(c[k]));
}
// True when a card uses counters (enters with them or puts them on).
const countsIn = e => !!e && (e.kind === 'counter' || e.kind === 'tick' || ['then', 'hit', 'miss', 'done'].some(k => countsIn(e[k])));
export function cardCounters(card) {
  const c = typeof card === 'string' ? CARD[card] : card;
  return !!c && (!!c.enterCounters || ['effect', 'onDeath', 'onUpkeep'].some(k => countsIn(c[k])));
}

export const CARDS = POOL;
export const TOKENS = TOKEN_POOL;
export const CARD = Object.freeze(Object.fromEntries([...CARDS, ...TOKENS].map(d => [d.id, d])));

export function manaValue(card) {
  const c = typeof card === 'string' ? CARD[card] : card;
  const q = c.cost;
  return q.generic + q.amber + q.moss + q.dew + q.rot + q.pollen;
}

// Colours of mana that a card needs (lands: the colours it makes).
export function cardColours(card) {
  const c = typeof card === 'string' ? CARD[card] : card;
  return c.colours.slice();
}

// --------------------------------------------------------------- the decks
// Each deck: 17 lands + 23 other cards = 40. At most 4 copies of a card
// that is not a basic land. desc is one plain sentence for the deck menu.
export const DECKS = {
  amber: {
    name: 'Amber Swarm', colours: ['amber'],
    desc: 'Fast insects and burn. Hit early, hit often, finish with fire.',
    list: [
      ['amber-ridge', 17],
      ['ember-gnat', 1], ['cinder-ant', 1], ['ash-cricket', 1], ['dune-wasp', 1], ['hive-soldier', 1], ['sting-hopper', 1],
      ['ram-weevil', 1], ['spark-hornet', 2], ['ember-mantis', 1], ['scald-beetle', 1], ['brood-captain', 1], ['magma-beetle', 1],
      ['torch-queen', 1], ['flare-spit', 1], ['heat-pulse', 1], ['kiln-burst', 1], ['war-chirp', 1],
      ['tinder-cricket', 1], ['bombardier', 1], ['spark-scatter', 1], ['drum-frenzy', 1], ['ember-hail', 1],
    ],
  },
  moss: {
    name: 'Moss Grove', colours: ['moss'],
    desc: 'Walls early, more land, then the biggest bodies in the pool.',
    list: [
      ['moss-hollow', 17],
      ['root-sentinel', 1], ['moss-snail', 1], ['thorn-vine', 1], ['seed-carrier', 1], ['bark-toad', 1], ['dew-moth', 1],
      ['orb-weaver', 1], ['spore-mother', 1], ['grove-stag', 2], ['moss-tortoise', 1], ['fern-beast', 1], ['elder-mycelium', 1],
      ['strangle-root', 2], ['swell', 1], ['wild-bloom', 1], ['ring-growth', 1],
      ['gall-larva', 1], ['cicada-nymph', 2], ['spring-downpour', 1], ['pill-bug', 1],
    ],
  },
  dew: {
    name: 'Dew Mirror', colours: ['dew'],
    desc: 'Wings and tricks. Tap the blockers, send the big ones home, draw cards.',
    list: [
      ['dew-pond', 17],
      ['pond-skater', 2], ['water-boatman', 1], ['mayfly-drift', 1], ['caddis-case', 1], ['diving-beetle', 2], ['darner', 1],
      ['bell-spider', 1], ['newt-sage', 1], ['blue-damselfly', 1], ['mist-moth', 1], ['storm-darner', 1],
      ['ripple', 1], ['surface-tension', 1], ['carried-off', 2], ['clear-water', 1], ['spring-spate', 1],
      ['moon-snail', 1], ['rain-omen', 2], ['whirligig', 1],
    ],
  },
  rot: {
    name: 'Carrion Court', colours: ['rot'],
    desc: 'Things that are worth more dead. Drain, sting, discard and sacrifice.',
    list: [
      ['rot-log', 17],
      ['blow-fly', 1], ['burying-beetle', 2], ['maggot-mass', 2], ['marsh-leech', 1], ['assassin-bug', 1], ['death-cap', 1],
      ['mould-crawler', 1], ['bone-centipede', 2], ['bloated-tick', 1], ['sexton-beetle', 1], ['plague-swarm', 1],
      ['wither', 1], ['last-feast', 1], ['bog-breath', 1], ['heart-rot', 1], ['leaf-blight', 1],
      ['carrion-hive', 1], ['deathwatch', 2], ['knucklebones', 1],
    ],
  },
  pollen: {
    name: 'Pollen Hive', colours: ['pollen'],
    desc: 'Order and light. Bees that never tire, life every turn, a queen to end it.',
    list: [
      ['pollen-meadow', 17],
      ['hoverfly', 1], ['ladybird-knight', 1], ['shield-bug', 1], ['mason-bee', 1], ['hive-warden', 1], ['lantern-firefly', 2],
      ['lily-ward', 1], ['golden-orb', 1], ['honeyguard', 1], ['sun-moth', 1], ['bumble-queen', 1], ['comb-queen', 1],
      ['dawn-blessing', 1], ['bloom-hymn', 1], ['pollinate', 1], ['solar-verdict', 2],
      ['royal-cell', 1], ['scout-bee', 2], ['waggle-dance', 1], ['honey-harvest', 1],
    ],
  },
  'amber-dew': {
    name: 'Steam Front', colours: ['amber', 'dew'],
    desc: 'Amber and dew. Fast wings over the top, burn and tricks to clear the way.',
    list: [
      ['amber-ridge', 7], ['dew-pond', 6], ['geyser-basin', 4],
      ['ember-gnat', 1], ['dune-wasp', 2], ['pond-skater', 1], ['darner', 2], ['spark-hornet', 2], ['steam-darner', 2],
      ['blue-damselfly', 1], ['mist-moth', 1], ['sun-locust', 1],
      ['flare-spit', 2], ['heat-pulse', 1], ['ripple', 1], ['carried-off', 1], ['kiln-burst', 1],
      ['tinder-cricket', 1], ['rain-omen', 1], ['spark-scatter', 1], ['whirligig', 1],
    ],
  },
  'moss-rot': {
    name: 'Compost Heap', colours: ['moss', 'rot'],
    desc: 'Moss and rot. Bodies that come back as spores and maggots, and big ones to follow.',
    list: [
      ['moss-hollow', 7], ['rot-log', 6], ['leaf-litter', 4],
      ['maggot-mass', 1], ['thorn-vine', 1], ['burying-beetle', 1], ['seed-carrier', 2], ['spore-mother', 1], ['mycelium-mound', 3],
      ['bloated-tick', 1], ['sexton-beetle', 1], ['grove-stag', 1], ['elder-mycelium', 1],
      ['strangle-root', 1], ['last-feast', 1], ['wither', 1], ['heart-rot', 1], ['bog-breath', 1],
      ['gall-larva', 1], ['knucklebones', 1], ['spring-downpour', 1], ['carrion-hive', 1], ['deathwatch', 1],
    ],
  },
  'amber-pollen': {
    name: 'Sun Swarm', colours: ['amber', 'pollen'],
    desc: 'Amber and pollen. Go wide with bees and larvae, then pump the whole field.',
    list: [
      ['amber-ridge', 7], ['pollen-meadow', 6], ['sunlit-ridge', 4],
      ['ember-gnat', 2], ['hoverfly', 2], ['ladybird-knight', 2], ['hive-soldier', 1], ['mason-bee', 1], ['solar-hornet', 3],
      ['brood-captain', 1], ['bumble-queen', 1], ['honeyguard', 1],
      ['swarm-call', 1], ['pollinate', 1], ['hive-warden', 1], ['bloom-hymn', 1], ['heat-pulse', 1],
      ['bombardier', 1], ['drum-frenzy', 1], ['scout-bee', 1], ['waggle-dance', 1],
    ],
  },
  'dew-pollen': {
    name: 'Clear Sky', colours: ['dew', 'pollen'],
    desc: 'Dew and pollen. Shelled wings, life every turn, and answers for the big threats.',
    list: [
      ['dew-pond', 6], ['pollen-meadow', 7], ['dawn-lake', 4],
      ['pond-skater', 1], ['shield-bug', 1], ['mayfly-drift', 1], ['lantern-firefly', 2], ['glasswing', 3], ['sun-moth', 2],
      ['golden-orb', 1], ['storm-darner', 1], ['comb-queen', 1],
      ['carried-off', 1], ['solar-verdict', 2], ['honey-balm', 1], ['clear-water', 1], ['dawn-blessing', 1],
      ['moon-snail', 1], ['honey-harvest', 1], ['rain-omen', 1], ['royal-cell', 1],
    ],
  },
  'amber-rot': {
    name: 'Ember Rot', colours: ['amber', 'rot'],
    desc: 'Amber and rot. Swift stings and drain: every trade hurts the other side more.',
    list: [
      ['amber-ridge', 7], ['rot-log', 6], ['cinder-fen', 4],
      ['ember-gnat', 2], ['cinder-ant', 1], ['burying-beetle', 2], ['ash-wasp', 2], ['ember-mantis', 1], ['spark-hornet', 2],
      ['assassin-bug', 1], ['bone-centipede', 1], ['bloated-tick', 1], ['magma-beetle', 1], ['torch-queen', 1],
      ['flare-spit', 1], ['bog-breath', 1], ['wither', 1], ['heat-pulse', 1],
      ['tinder-cricket', 1], ['knucklebones', 1], ['spark-scatter', 1], ['deathwatch', 1],
    ],
  },
  'moss-pollen': {
    name: 'Meadow Bloom', colours: ['moss', 'pollen'],
    desc: 'Moss and pollen. Lasting growth and life gain on big, untiring bodies.',
    list: [
      ['moss-hollow', 7], ['pollen-meadow', 6], ['clover-hill', 4],
      ['moss-snail', 1], ['mason-bee', 1], ['hive-warden', 2], ['bark-toad', 2], ['meadow-matriarch', 3], ['honeyguard', 1],
      ['moss-tortoise', 1], ['fern-beast', 1], ['comb-queen', 1],
      ['ring-growth', 1], ['dawn-blessing', 1], ['solar-verdict', 1], ['strangle-root', 1], ['sap-bloom', 1], ['bloom-hymn', 1],
      ['cicada-nymph', 1], ['gall-larva', 1], ['waggle-dance', 1], ['spring-downpour', 1],
    ],
  },
  'moss-dew': {
    name: 'Fen Grove', colours: ['moss', 'dew'],
    desc: 'Moss and dew. Card flow and ramp into large bodies that the other side cannot touch.',
    list: [
      ['moss-hollow', 7], ['dew-pond', 6], ['fern-spring', 4],
      ['seed-carrier', 1], ['water-boatman', 1], ['bell-spider', 1], ['lily-toad', 2], ['dew-moth', 1], ['diving-beetle', 2],
      ['newt-sage', 1], ['grove-stag', 1], ['elder-mycelium', 1], ['fern-beast', 1],
      ['deep-roots', 1], ['wild-bloom', 1], ['carried-off', 1], ['swell', 1], ['spring-spate', 1], ['strangle-root', 1],
      ['moon-snail', 1], ['spring-downpour', 1], ['rain-omen', 1], ['whirligig', 1], ['pill-bug', 1],
    ],
  },
  'amber-moss-rot': {
    name: 'Wildfire Compost', colours: ['amber', 'moss', 'rot'],
    desc: 'Amber, moss and rot. Burn and decay clear the board for the Colony Titan.',
    list: [
      ['amber-ridge', 4], ['moss-hollow', 3], ['rot-log', 3], ['burnt-clearing', 3], ['cinder-fen', 2], ['leaf-litter', 2],
      ['cinder-ant', 1], ['thorn-vine', 1], ['seed-carrier', 1], ['ash-wasp', 2], ['mycelium-mound', 2], ['bonfire-stag', 2],
      ['bone-centipede', 1], ['colony-titan', 2], ['grove-stag', 1],
      ['flare-spit', 1], ['strangle-root', 1], ['wither', 1], ['heat-pulse', 1], ['heart-rot', 1], ['brush-fire', 1],
      ['bombardier', 1], ['cicada-nymph', 1], ['ember-hail', 1], ['knucklebones', 1],
    ],
  },
};
for (const d of Object.values(DECKS)) d.colour = d.colours.length === 1 ? d.colours[0] : 'multi';

// Deck ids in menu order: the five one-colour decks, then the mixed ones.
export const DECK_ORDER = Object.freeze(Object.keys(DECKS));

function listOf(deck) {
  if (Array.isArray(deck)) return deck;
  const d = DECKS[deck];
  if (!d) throw new Error(`unknown deck ${deck}`);
  return d.list;
}

// Colours of mana that the non-land cards of a deck need, in COLOUR_IDS order.
export function deckColours(deck) {
  const need = new Set();
  for (const [id] of listOf(deck)) if (CARD[id] && CARD[id].type !== 'land') for (const c of CARD[id].colours) need.add(c);
  return COLOUR_IDS.filter(c => need.has(c));
}

export function deckList(name) {
  return listOf(name).map(([id, count]) => ({ card: CARD[id], count }));
}

// Shuffled 40-card id array. deck: a DECKS id or a list [[id, count]...].
// With no rng, the list stays in deck order.
export function buildDeck(deck, rng) {
  const ids = [];
  for (const [id, n] of listOf(deck)) for (let i = 0; i < n; i++) ids.push(id);
  return rng ? shuffle(ids, rng) : ids;
}

// Checks a deck: a DECKS id or a list [[id, count]...]. Rules: 40 cards,
// 16 to 18 lands, at most 4 copies of a card that is not a basic land, no
// tokens, every id known, and at least 6 lands that make each colour that
// the other cards need. Returns { ok, errors, cards, lands, colours,
// sources } where sources[colour] counts the lands that make it.
export function validateDeck(deck) {
  const errors = [];
  let list;
  try { list = listOf(deck); } catch (e) { return { ok: false, errors: [e.message], cards: 0, lands: 0, colours: [], sources: {} }; }
  let cards = 0, lands = 0;
  const sources = Object.fromEntries(COLOUR_IDS.map(c => [c, 0]));
  const copies = new Map();
  for (const row of list) {
    const [id, n] = row;
    const c = CARD[id];
    if (!c) { errors.push(`unknown card ${id}`); continue; }
    if (c.token) { errors.push(`${id} is a token`); continue; }
    if (!Number.isInteger(n) || n < 1) { errors.push(`${id}: bad count ${n}`); continue; }
    copies.set(id, (copies.get(id) || 0) + n);
    cards += n;
    if (c.type === 'land') { lands += n; for (const m of c.mana) sources[m] += n; }
  }
  for (const [id, n] of copies) if (!CARD[id].basic && n > 4) errors.push(`${id}: ${n} copies, at most 4`);
  if (cards !== 40) errors.push(`${cards} cards, need 40`);
  if (lands < 16 || lands > 18) errors.push(`${lands} lands, need 16 to 18`);
  const colours = errors.length && !cards ? [] : deckColours(list.filter(([id]) => CARD[id]));
  for (const c of colours) if (sources[c] < 6) errors.push(`${sources[c]} lands make ${c}, need at least 6`);
  return { ok: errors.length === 0, errors, cards, lands, colours, sources };
}

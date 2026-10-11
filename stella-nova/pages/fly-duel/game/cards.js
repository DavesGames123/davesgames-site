// ============================================================================
//  FLY DUEL  ·  card pool and decks  (ES module, no DOM)
// ----------------------------------------------------------------------------
//  The game is our own card duel. Magic: The Gathering is the inspiration
//  only. Every name, rules text, flavour line and mana symbol here is
//  original. There are no names, symbols or frames from Wizards of the
//  Coast.
//
//  Two colours plus colourless:
//      Amber  aggressive insects. Fast bodies, burn, pump.
//      Moss   growth and control plants. Thick walls, life, removal, cards.
//  Mana comes from two land cards, Amber Ridge and Moss Hollow. The page
//  draws its own glyphs for the two mana kinds.
//
//  Keywords (KEYWORDS gives the reminder text):
//      swift  can attack on the turn it enters (no entry sickness)
//      wings  can be blocked only by creatures with wings
//      sting  any damage from it to a creature destroys that creature
//      thick  cannot attack (a wall)
//      sap    combat damage it deals also gives its controller that much life
//
//  Effect kinds: damage, draw, pump, heal, destroy, token. A creature card
//  can carry an effect: it happens when the creature enters (no target).
//  Effect targets (the rules engine reads them):
//      'any'    the opposing player or one opposing creature
//      'opp'    one opposing creature
//      'own'    one of your creatures
//      'self'   you (no choice)
//  Harmful effects target only the opposing side. This is a simplification
//  that keeps the action list short for the fly.
//
//  EXPORTS   (jump with grep -n "<anchor>" game/cards.js)
//      KEYWORDS ....... "export const KEYWORDS"    reminder text
//      CARDS .......... "export const CARDS"       every card definition
//      TOKENS ......... "export const TOKENS"      token creatures
//      CARD ........... "export const CARD"        id -> definition
//      DECKS .......... "export const DECKS"       two 40-card lists
//      buildDeck ...... "export function buildDeck"  shuffled id array
//      deckList ....... "export function deckList"   [{card, count}] rows
//      manaValue ...... "export function manaValue"  total cost
// ============================================================================
import { shuffle } from '../data/rng.js';

export const KEYWORDS = {
  swift: 'Swift: can attack on the turn it enters.',
  wings: 'Wings: only creatures with wings can block it.',
  sting: 'Sting: any damage it deals to a creature destroys that creature.',
  thick: 'Thick: cannot attack.',
  sap: 'Sap: combat damage it deals also gives you that much life.',
};

const c = (generic = 0, amber = 0, moss = 0) => ({ generic, amber, moss });

// --------------------------------------------------------------- the pool
export const CARDS = [
  // lands
  { id: 'amber-ridge', name: 'Amber Ridge', colour: 'amber', type: 'land', cost: c(), produces: 'amber',
    text: 'Tap: add one amber mana.', flavour: 'Old resin, warm in the sun, full of trapped wings.' },
  { id: 'moss-hollow', name: 'Moss Hollow', colour: 'moss', type: 'land', cost: c(), produces: 'moss',
    text: 'Tap: add one moss mana.', flavour: 'Wet ground under the roots. Everything starts here.' },

  // amber creatures
  { id: 'ember-gnat', name: 'Ember Gnat', colour: 'amber', type: 'creature', cost: c(0, 1), power: 1, toughness: 1,
    keywords: ['swift'], text: 'Swift.', flavour: 'Small, hot and already on your face.' },
  { id: 'cinder-ant', name: 'Cinder Ant', colour: 'amber', type: 'creature', cost: c(0, 1), power: 2, toughness: 1,
    keywords: [], text: '', flavour: 'Carries ten times its weight, mostly anger.' },
  { id: 'dune-wasp', name: 'Dune Wasp', colour: 'amber', type: 'creature', cost: c(1, 1), power: 2, toughness: 1,
    keywords: ['wings'], text: 'Wings.', flavour: 'It nests in the hot sand and hunts above it.' },
  { id: 'hive-soldier', name: 'Hive Soldier', colour: 'amber', type: 'creature', cost: c(1, 1), power: 2, toughness: 2,
    keywords: [], text: '', flavour: 'One of ten thousand. It does not mind.' },
  { id: 'spark-hornet', name: 'Spark Hornet', colour: 'amber', type: 'creature', cost: c(2, 1), power: 2, toughness: 2,
    keywords: ['wings', 'swift'], text: 'Wings. Swift.', flavour: 'You hear it after it has gone.' },
  { id: 'ember-mantis', name: 'Ember Mantis', colour: 'amber', type: 'creature', cost: c(2, 1), power: 3, toughness: 2,
    keywords: ['swift'], text: 'Swift.', flavour: 'Patience is for prey.' },
  { id: 'brood-captain', name: 'Brood Captain', colour: 'amber', type: 'creature', cost: c(3, 1), power: 3, toughness: 3,
    keywords: [], effect: { kind: 'token', amount: 1, token: 'ember-larva', target: 'self' },
    text: 'When it enters, make one 1/1 Ember Larva with swift.', flavour: 'It never marches alone.' },
  { id: 'magma-beetle', name: 'Magma Beetle', colour: 'amber', type: 'creature', cost: c(3, 2), power: 5, toughness: 4,
    keywords: [], text: '', flavour: 'Its shell still glows from the vent where it hatched.' },
  { id: 'sun-locust', name: 'Sun Locust Swarm', colour: 'amber', type: 'creature', cost: c(4, 2), power: 4, toughness: 4,
    keywords: ['wings', 'swift'], text: 'Wings. Swift.', flavour: 'The sky goes dark, then the fields do.' },
  { id: 'sting-hopper', name: 'Sting Hopper', colour: 'amber', type: 'creature', cost: c(1, 1), power: 1, toughness: 1,
    keywords: ['sting'], text: 'Sting.', flavour: 'Small enough to step on. Nobody tries twice.' },

  // amber spells
  { id: 'flare-spit', name: 'Flare Spit', colour: 'amber', type: 'spell', cost: c(0, 1),
    effect: { kind: 'damage', amount: 2, target: 'any' },
    text: 'Deal 2 damage to the opposing player or to one opposing creature.', flavour: 'Acid first, questions never.' },
  { id: 'heat-pulse', name: 'Heat Pulse', colour: 'amber', type: 'spell', cost: c(1, 1),
    effect: { kind: 'damage', amount: 3, target: 'any' },
    text: 'Deal 3 damage to the opposing player or to one opposing creature.', flavour: 'The wing muscles burn hot enough to cook a moth.' },
  { id: 'kiln-burst', name: 'Kiln Burst', colour: 'amber', type: 'spell', cost: c(2, 1),
    effect: { kind: 'damage', amount: 4, target: 'any' },
    text: 'Deal 4 damage to the opposing player or to one opposing creature.', flavour: 'The ridge cracks open and the light comes out.' },
  { id: 'war-chirp', name: 'War Chirp', colour: 'amber', type: 'spell', cost: c(0, 1),
    effect: { kind: 'pump', amount: 2, target: 'own' },
    text: 'One of your creatures gets +2/+2 this turn.', flavour: 'A sound that makes small things brave.' },
  { id: 'swarm-call', name: 'Swarm Call', colour: 'amber', type: 'spell', cost: c(2, 1),
    effect: { kind: 'token', amount: 2, token: 'ember-larva', target: 'self' },
    text: 'Make two 1/1 Ember Larva creatures with swift.', flavour: 'One signal, and the ground boils.' },

  // moss creatures
  { id: 'root-sentinel', name: 'Root Sentinel', colour: 'moss', type: 'creature', cost: c(0, 0, 1), power: 0, toughness: 4,
    keywords: ['thick'], text: 'Thick.', flavour: 'It has stood here for a hundred years. It will stand a hundred more.' },
  { id: 'moss-snail', name: 'Moss Snail', colour: 'moss', type: 'creature', cost: c(1, 0, 1), power: 1, toughness: 3,
    keywords: ['sap'], text: 'Sap.', flavour: 'Slow, wet and very hard to stop.' },
  { id: 'thorn-vine', name: 'Thorn Vine', colour: 'moss', type: 'creature', cost: c(1, 0, 1), power: 1, toughness: 2,
    keywords: ['sting'], text: 'Sting.', flavour: 'One scratch, and the rot begins.' },
  { id: 'bark-toad', name: 'Bark Toad', colour: 'moss', type: 'creature', cost: c(2, 0, 1), power: 2, toughness: 4,
    keywords: [], text: '', flavour: 'It eats gnats by the hundred and does not hurry.' },
  { id: 'dew-moth', name: 'Dew Moth', colour: 'moss', type: 'creature', cost: c(2, 0, 1), power: 2, toughness: 2,
    keywords: ['wings'], effect: { kind: 'draw', amount: 1, target: 'self' },
    text: 'Wings. When it enters, draw a card.', flavour: 'It follows the scent of rain to new places.' },
  { id: 'briar-wall', name: 'Briar Wall', colour: 'moss', type: 'creature', cost: c(2, 0, 1), power: 1, toughness: 6,
    keywords: ['thick', 'sap'], text: 'Thick. Sap.', flavour: 'It drinks from whatever it scratches.' },
  { id: 'spore-mother', name: 'Spore Mother', colour: 'moss', type: 'creature', cost: c(3, 0, 1), power: 2, toughness: 3,
    keywords: [], effect: { kind: 'token', amount: 2, token: 'spore', target: 'self' },
    text: 'When it enters, make two 1/1 Spore creatures.', flavour: 'A puff of dust, and the clearing fills.' },
  { id: 'grove-stag', name: 'Old Grove Stag', colour: 'moss', type: 'creature', cost: c(3, 0, 2), power: 5, toughness: 5,
    keywords: [], text: '', flavour: 'Moss grows on its antlers. It does not care.' },
  { id: 'fern-beast', name: 'Fern Colossus', colour: 'moss', type: 'creature', cost: c(4, 0, 2), power: 6, toughness: 6,
    keywords: ['sap'], text: 'Sap.', flavour: 'When it walks, the forest walks with it.' },

  // moss spells
  { id: 'deep-roots', name: 'Deep Roots', colour: 'moss', type: 'spell', cost: c(1, 0, 1),
    effect: { kind: 'draw', amount: 2, target: 'self' },
    text: 'Draw two cards.', flavour: 'Under every forest is a second forest.' },
  { id: 'sap-bloom', name: 'Sap Bloom', colour: 'moss', type: 'spell', cost: c(0, 0, 1),
    effect: { kind: 'heal', amount: 4, target: 'self' },
    text: 'You gain 4 life.', flavour: 'Sweet and slow, like the spring.' },
  { id: 'strangle-root', name: 'Strangle Root', colour: 'moss', type: 'spell', cost: c(1, 0, 1),
    effect: { kind: 'destroy', amount: 3, target: 'opp' },
    text: 'Destroy one opposing creature with power 3 or less.', flavour: 'The ground opens and closes again.' },
  { id: 'swell', name: 'Swell', colour: 'moss', type: 'spell', cost: c(0, 0, 1),
    effect: { kind: 'pump', amount: 3, target: 'own' },
    text: 'One of your creatures gets +3/+3 this turn.', flavour: 'Rain in the night, and by morning it is twice the size.' },
  { id: 'spore-burst', name: 'Spore Burst', colour: 'moss', type: 'spell', cost: c(2, 0, 1),
    effect: { kind: 'token', amount: 3, token: 'spore', target: 'self' },
    text: 'Make three 1/1 Spore creatures.', flavour: 'The fruiting body splits with a sigh.' },

  // colourless
  { id: 'drift-seed', name: 'Drift Seed', colour: 'none', type: 'creature', cost: c(1), power: 1, toughness: 1,
    keywords: ['wings'], text: 'Wings.', flavour: 'Wherever the wind goes.' },
  { id: 'hollow-husk', name: 'Hollow Husk', colour: 'none', type: 'creature', cost: c(3), power: 2, toughness: 3,
    keywords: [], text: '', flavour: 'Something moved into the empty shell and kept walking.' },
];

// Tokens are creatures that only effects make. They never go to a library,
// a hand or a graveyard: when a token dies it is gone.
export const TOKENS = [
  { id: 'ember-larva', name: 'Ember Larva', colour: 'amber', type: 'creature', cost: c(), power: 1, toughness: 1,
    keywords: ['swift'], token: true, text: 'Swift.', flavour: '' },
  { id: 'spore', name: 'Spore', colour: 'moss', type: 'creature', cost: c(), power: 1, toughness: 1,
    keywords: [], token: true, text: '', flavour: '' },
];

export const CARD = Object.freeze(Object.fromEntries([...CARDS, ...TOKENS].map(d => [d.id, d])));

export function manaValue(card) {
  const k = typeof card === 'string' ? CARD[card] : card;
  return k.cost.generic + k.cost.amber + k.cost.moss;
}

// --------------------------------------------------------------- the decks
// Each deck: 17 lands + 23 other cards = 40.
export const DECKS = {
  amber: {
    name: 'Amber Swarm', colour: 'amber',
    list: [
      ['amber-ridge', 17],
      ['ember-gnat', 2], ['cinder-ant', 2], ['sting-hopper', 1], ['dune-wasp', 2], ['hive-soldier', 2],
      ['spark-hornet', 2], ['ember-mantis', 2], ['brood-captain', 1], ['magma-beetle', 1], ['sun-locust', 1],
      ['flare-spit', 2], ['heat-pulse', 2], ['kiln-burst', 1], ['war-chirp', 1], ['swarm-call', 1],
    ],
  },
  moss: {
    name: 'Moss Grove', colour: 'moss',
    list: [
      ['moss-hollow', 17],
      ['root-sentinel', 2], ['moss-snail', 2], ['thorn-vine', 2], ['bark-toad', 2], ['dew-moth', 2],
      ['briar-wall', 1], ['spore-mother', 2], ['grove-stag', 1], ['fern-beast', 1], ['hollow-husk', 1],
      ['deep-roots', 1], ['sap-bloom', 1], ['strangle-root', 2], ['swell', 1], ['spore-burst', 1],
      ['drift-seed', 1],
    ],
  },
};

export function deckList(name) {
  const d = DECKS[name];
  if (!d) throw new Error(`unknown deck ${name}`);
  return d.list.map(([id, count]) => ({ card: CARD[id], count }));
}

// Shuffled 40-card id array. With no rng, the list stays in deck order.
export function buildDeck(name, rng) {
  const d = DECKS[name];
  if (!d) throw new Error(`unknown deck ${name}`);
  const ids = [];
  for (const [id, n] of d.list) for (let i = 0; i < n; i++) ids.push(id);
  return rng ? shuffle(ids, rng) : ids;
}

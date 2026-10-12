// ============================================================================
//  FLY DUEL  ·  board features, the fly's "smell" of a board  (ES module)
// ----------------------------------------------------------------------------
//  features(state, me) gives 48 numbers, each scaled to [0, 1]. The brain
//  model maps each number to a pattern on its projection neurons, as an
//  odour would. The fly scores an afterstate: it calls features() on the
//  state that an action makes, from its own side (me).
//
//  The features read only what a player can see: both boards, both life
//  totals, its own hand, the size of the opposing hand and of each library.
//  They never read the opposing hand or library order.
//
//  Scaling: count / cap, then clamp to [0, 1]. The cap is the second item
//  in each FEATURE_SPEC row. Flags are 0 or 1. life_diff is centred on 0.5.
//
//  Colours. The features do not name a colour, so one brain can play any
//  of the five colours and any mix. FEATURE_VERSION 2 (2026-10-11) changed
//  two rows: 7 untapped_amber_me -> untapped_lands_me (all colours), 8
//  untapped_moss_me -> untapped_useful_me (untapped lands that make a
//  colour that a card in my hand needs). For a one-colour deck both rows
//  give the untapped land count, so version-1 weights still play (measured
//  2026-10-11 with tests/train.test.mjs: fly A 80/100, fly B 89/100 against
//  random, against 94 and 96 with version 1). castable_in_hand now checks
//  colours (dual lands too), and the wings rows count web as a blocker of
//  wings. Retrain for the best play.
//
//  Dice cards (2026-10-11). The 48 rows did not change. Growth counters
//  add to pc, so the power and toughness rows include them. A dice damage
//  spell counts in removal_in_hand (kind 'damage'). A chance or counter
//  card counts as a castable card only. Note: an afterstate from step()
//  holds the real roll. An agent that scores one afterstate per action
//  sees that roll. game/bots.js expectedScore gives the mean over other
//  RNG states for that reason.
//
//  EXPORTS   (jump with grep -n "<anchor>" game/features.js)
//      FEATURE_SPEC ... "export const FEATURE_SPEC"   [name, cap, text]
//      FEATURE_NAMES .. "export const FEATURE_NAMES"  48 names, fixed order
//      FEATURE_VERSION  "export const FEATURE_VERSION"  2 since five colours
//      F .............. "export const F"              name -> index
//      features ....... "export function features"    -> Float32Array(48)
// ============================================================================
import { CARD, COLOUR_IDS } from './cards.js';
import { TURN_CAP, power, toughness } from './rules.js';

export const FEATURE_VERSION = 2;

export const FEATURE_SPEC = [
  ['life_me', 30, 'my life'],
  ['life_opp', 30, 'opposing life'],
  ['life_diff', 40, 'my life minus opposing life, centred on 0.5'],
  ['hand_me', 7, 'cards in my hand'],
  ['hand_opp', 7, 'cards in the opposing hand'],
  ['lands_me', 10, 'my lands'],
  ['lands_opp', 10, 'opposing lands'],
  ['untapped_lands_me', 6, 'my untapped lands'],
  ['untapped_useful_me', 6, 'my untapped lands that make a colour that a card in my hand needs'],
  ['untapped_lands_opp', 8, 'opposing untapped lands'],
  ['creatures_me', 6, 'my creatures'],
  ['creatures_opp', 6, 'opposing creatures'],
  ['power_me', 15, 'total power of my creatures'],
  ['power_opp', 15, 'total power of opposing creatures'],
  ['toughness_me', 15, 'total toughness of my creatures'],
  ['toughness_opp', 15, 'total toughness of opposing creatures'],
  ['biggest_me', 6, 'power of my biggest creature'],
  ['biggest_opp', 6, 'power of the biggest opposing creature'],
  ['wings_me', 4, 'my creatures with wings'],
  ['wings_opp', 4, 'opposing creatures with wings'],
  ['evasive_power_me', 10, 'power of my wings creatures when no opposing creature has wings or web'],
  ['evasive_power_opp', 10, 'power of opposing wings creatures when none of mine has wings or web'],
  ['ready_attackers_me', 6, 'my creatures that can attack now'],
  ['ready_power_me', 15, 'power of my creatures that can attack now'],
  ['untapped_blockers_opp', 6, 'opposing untapped creatures'],
  ['untapped_blockers_me', 6, 'my untapped creatures'],
  ['lethal_me', 1, 'flag: my attack power reaches the opposing life'],
  ['lethal_opp', 1, 'flag: opposing power reaches my life'],
  ['clock_me', 1, 'my power / opposing life'],
  ['clock_opp', 1, 'opposing power / my life'],
  ['sting_me', 3, 'my creatures with sting'],
  ['sting_opp', 3, 'opposing creatures with sting'],
  ['thick_me', 3, 'my creatures with thick'],
  ['thick_opp', 3, 'opposing creatures with thick'],
  ['sap_me', 3, 'my creatures with sap'],
  ['sap_opp', 3, 'opposing creatures with sap'],
  ['swift_in_hand', 3, 'swift creatures in my hand'],
  ['castable_in_hand', 7, 'cards in my hand that all my lands could pay for, colours checked'],
  ['removal_in_hand', 3, 'spells in my hand that remove or stop an opposing creature'],
  ['creatures_in_hand', 7, 'creature cards in my hand'],
  ['lands_in_hand', 7, 'land cards in my hand'],
  ['turn', TURN_CAP, 'turn number'],
  ['library_me', 40, 'cards left in my library'],
  ['library_opp', 40, 'cards left in the opposing library'],
  ['graveyard_me', 20, 'cards in my graveyard'],
  ['graveyard_opp', 20, 'cards in the opposing graveyard'],
  ['my_turn', 1, 'flag: it is my turn'],
  ['sick_me', 6, 'my creatures that entered this turn and cannot attack yet'],
];

export const FEATURE_NAMES = FEATURE_SPEC.map(r => r[0]);
export const F = Object.freeze(Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, i])));
const CAPS = FEATURE_SPEC.map(r => Number(r[1]));

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

// Lands that the player controls: basic counts by colour, dual pairs,
// and the set of colours they make.
function landsOf(pl) {
  const single = {}, duals = [], makes = new Set();
  let n = 0;
  for (const x of pl.battlefield) {
    const c = CARD[x.id];
    if (c.type !== 'land') continue;
    n++;
    for (const m of c.mana) makes.add(m);
    if (c.mana.length === 1) single[c.mana[0]] = (single[c.mana[0]] || 0) + 1; else duals.push(c.mana);
  }
  return { single, duals, makes, n };
}

// Could all these lands pay this cost? Basic lands first, then a small
// matching search over the dual lands.
function payable(L, cost) {
  let total = cost.generic;
  const needs = [];
  for (const c of COLOUR_IDS) {
    total += cost[c];
    for (let i = L.single[c] || 0; i < cost[c]; i++) needs.push(c);
  }
  if (total > L.n || needs.length > L.duals.length) return false;
  const owner = new Array(L.duals.length).fill(-1);
  const tryNeed = (i, seen) => {
    for (let j = 0; j < L.duals.length; j++) {
      if (seen[j] || !L.duals[j].includes(needs[i])) continue;
      seen[j] = true;
      if (owner[j] < 0 || tryNeed(owner[j], seen)) { owner[j] = i; return true; }
    }
    return false;
  };
  for (let i = 0; i < needs.length; i++) if (!tryNeed(i, new Array(L.duals.length).fill(false))) return false;
  return true;
}

const REMOVAL = new Set(['damage', 'destroy', 'weaken', 'bounce', 'tap']);

function side(pl) {
  const r = { lands: 0, untapped: 0, cre: 0, pow: 0, tou: 0, big: 0, wings: 0, wingsPow: 0, web: 0,
    ready: 0, readyPow: 0, untappedCre: 0, sting: 0, thick: 0, sap: 0, sick: 0 };
  for (const x of pl.battlefield) {
    const c = CARD[x.id];
    if (c.type === 'land') {
      r.lands++;
      if (!x.tapped) r.untapped++;
      continue;
    }
    const k = c.keywords;
    const p = Math.max(0, power(x)), t = Math.max(0, toughness(x) - x.dmg);
    r.cre++; r.pow += p; r.tou += t;
    if (p > r.big) r.big = p;
    const wings = k.includes('wings'), thick = k.includes('thick');
    if (wings) { r.wings++; r.wingsPow += p; }
    if (wings || k.includes('web')) r.web++;
    if (k.includes('sting')) r.sting++;
    if (thick) r.thick++;
    if (k.includes('sap')) r.sap++;
    if (x.sick && !k.includes('swift')) r.sick++;
    if (!x.tapped) r.untappedCre++;
    if (!x.tapped && !thick && (!x.sick || k.includes('swift'))) { r.ready++; r.readyPow += p; }
  }
  return r;
}

export function features(state, me) {
  const out = new Float32Array(48);
  const P = state.players[me], O = state.players[1 - me];
  const a = side(P), b = side(O);
  const v = new Array(48);
  v[0] = Math.max(0, P.life);
  v[1] = Math.max(0, O.life);
  v[2] = 0.5 + (P.life - O.life) / 40;
  v[3] = P.hand.length;
  v[4] = O.hand.length;
  v[5] = a.lands; v[6] = b.lands;
  v[7] = a.untapped; v[9] = b.untapped;
  v[10] = a.cre; v[11] = b.cre;
  v[12] = a.pow; v[13] = b.pow;
  v[14] = a.tou; v[15] = b.tou;
  v[16] = a.big; v[17] = b.big;
  v[18] = a.wings; v[19] = b.wings;
  v[20] = b.web ? 0 : a.wingsPow;
  v[21] = a.web ? 0 : b.wingsPow;
  v[22] = a.ready; v[23] = a.readyPow;
  v[24] = b.untappedCre; v[25] = a.untappedCre;
  v[26] = O.life > 0 && a.readyPow >= O.life ? 1 : 0;
  v[27] = P.life > 0 && b.pow >= P.life ? 1 : 0;
  v[28] = O.life > 0 ? a.pow / O.life : 1;
  v[29] = P.life > 0 ? b.pow / P.life : 1;
  v[30] = a.sting; v[31] = b.sting;
  v[32] = a.thick; v[33] = b.thick;
  v[34] = a.sap; v[35] = b.sap;
  let swift = 0, castable = 0, removal = 0, creH = 0, landH = 0;
  const need = new Set();
  const L = landsOf(P);
  for (const id of P.hand) {
    const c = CARD[id];
    if (c.type === 'land') { landH++; continue; }
    if (c.type === 'creature') { creH++; if (c.keywords.includes('swift')) swift++; }
    if (c.type === 'spell' && REMOVAL.has(c.effect.kind) && c.effect.target !== 'face') removal++;
    for (const m of c.colours) need.add(m);
    if (c.colours.every(m => L.makes.has(m)) && payable(L, c.cost)) castable++;
  }
  let useful = 0;
  if (need.size) {
    for (const x of P.battlefield) {
      const c = CARD[x.id];
      if (c.type === 'land' && !x.tapped && c.mana.some(m => need.has(m))) useful++;
    }
  }
  v[8] = useful;
  v[36] = swift; v[37] = castable; v[38] = removal; v[39] = creH; v[40] = landH;
  v[41] = state.turn;
  v[42] = P.library.length; v[43] = O.library.length;
  v[44] = P.graveyard.length; v[45] = O.graveyard.length;
  v[46] = state.active === me ? 1 : 0;
  v[47] = a.sick;
  for (let i = 0; i < 48; i++) out[i] = i === 2 ? clamp01(v[i]) : clamp01(v[i] / CAPS[i]);
  return out;
}

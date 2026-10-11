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
//  EXPORTS   (jump with grep -n "<anchor>" game/features.js)
//      FEATURE_SPEC ... "export const FEATURE_SPEC"   [name, cap, text]
//      FEATURE_NAMES .. "export const FEATURE_NAMES"  48 names, fixed order
//      F .............. "export const F"              name -> index
//      features ....... "export function features"    -> Float32Array(48)
// ============================================================================
import { CARD, manaValue } from './cards.js';
import { TURN_CAP } from './rules.js';

export const FEATURE_SPEC = [
  ['life_me', 30, 'my life'],
  ['life_opp', 30, 'opposing life'],
  ['life_diff', 40, 'my life minus opposing life, centred on 0.5'],
  ['hand_me', 7, 'cards in my hand'],
  ['hand_opp', 7, 'cards in the opposing hand'],
  ['lands_me', 10, 'my lands'],
  ['lands_opp', 10, 'opposing lands'],
  ['untapped_amber_me', 6, 'my untapped amber lands'],
  ['untapped_moss_me', 6, 'my untapped moss lands'],
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
  ['evasive_power_me', 10, 'power of my wings creatures that no opposing creature can block'],
  ['evasive_power_opp', 10, 'power of opposing wings creatures that none of mine can block'],
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
  ['castable_in_hand', 7, 'cards in my hand that my lands could pay for'],
  ['removal_in_hand', 3, 'damage and destroy spells in my hand'],
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

function side(pl) {
  const r = { lands: 0, uA: 0, uM: 0, cre: 0, pow: 0, tou: 0, big: 0, wings: 0, wingsPow: 0,
    ready: 0, readyPow: 0, untappedCre: 0, sting: 0, thick: 0, sap: 0, sick: 0 };
  for (const x of pl.battlefield) {
    const c = CARD[x.id];
    if (c.type === 'land') {
      r.lands++;
      if (!x.tapped) { if (c.produces === 'amber') r.uA++; else r.uM++; }
      continue;
    }
    const k = c.keywords;
    const p = c.power + x.pp, t = c.toughness + x.pt - x.dmg;
    r.cre++; r.pow += p; r.tou += t;
    if (p > r.big) r.big = p;
    const wings = k.includes('wings'), thick = k.includes('thick');
    if (wings) { r.wings++; r.wingsPow += p; }
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
  v[7] = a.uA; v[8] = a.uM; v[9] = b.uA + b.uM;
  v[10] = a.cre; v[11] = b.cre;
  v[12] = a.pow; v[13] = b.pow;
  v[14] = a.tou; v[15] = b.tou;
  v[16] = a.big; v[17] = b.big;
  v[18] = a.wings; v[19] = b.wings;
  v[20] = b.wings ? 0 : a.wingsPow;
  v[21] = a.wings ? 0 : b.wingsPow;
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
  const mana = a.lands;
  for (const id of P.hand) {
    const c = CARD[id];
    if (c.type === 'land') { landH++; continue; }
    if (c.type === 'creature') { creH++; if (c.keywords.includes('swift')) swift++; }
    if (c.effect && (c.effect.kind === 'damage' || c.effect.kind === 'destroy') && c.type === 'spell') removal++;
    if (manaValue(c) <= mana) castable++;
  }
  v[36] = swift; v[37] = castable; v[38] = removal; v[39] = creH; v[40] = landH;
  v[41] = state.turn;
  v[42] = P.library.length; v[43] = O.library.length;
  v[44] = P.graveyard.length; v[45] = O.graveyard.length;
  v[46] = state.active === me ? 1 : 0;
  v[47] = a.sick;
  for (let i = 0; i < 48; i++) out[i] = i === 2 ? clamp01(v[i]) : clamp01(v[i] / CAPS[i]);
  return out;
}

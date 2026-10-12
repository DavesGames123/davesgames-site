// ============================================================================
//  FLY DUEL  ·  rules engine  (ES module, no DOM, pure)
// ----------------------------------------------------------------------------
//  A cut-down two-player card duel. step() never changes its input: it
//  returns a new state. The same seed and the same actions give the same
//  game on every machine. State is plain JSON (structuredClone is safe).
//
//  Turn, simplified:
//      untap -> start-of-turn triggers -> draw (the first player does not
//            draw on turn 1)
//      main: play at most one land, cast cards (auto-tap pays the cost),
//            then 'pass' to go to combat
//      attack: one action names every attacker (or none)
//      block: the defender gives one action that maps attacker -> blocker
//      damage (lunge creatures first, then the others), then end: hand
//            above 7 discards the lowest-cost cards, damage and pumps wear
//            off, the other player starts a turn
//  Life 20. A draw from an empty library loses. After turn 60 the game is
//  a draw (winner -1). Spells are cast only in main. One blocker per
//  attacker. Harmful effects target only the opposing side.
//
//  Two shortcuts keep decisions meaningful. When no creature can attack,
//  the attack step is skipped. When no creature can block, the block step
//  is skipped and damage happens at once.
//
//  Mana. Five colours (game/cards.js COLOUR_IDS). A basic land makes one
//  mana of its colour, a dual land one of two colours. payPlan() is the
//  auto-tap: coloured costs take basic lands of that colour first, then
//  dual lands by a small matching search. Generic costs take basic lands
//  of the colour with the most untapped lands left, and dual lands last,
//  so the flexible lands stay open.
//
//  Triggers. A creature effect happens when it enters (it can have a
//  target: the cast action carries it). onDeath happens when it dies
//  (combat, damage, destroy, weaken, feast). onUpkeep happens at the start
//  of its controller's turn. Triggers never have a target choice.
//
//  Action shapes (legalActions gives them, step takes them). Unchanged
//  from the two-colour version; a creature cast can now carry a target.
//      { type: 'land', card }                       play a land from hand
//      { type: 'cast', card, target? }              target: uid or 'p0'/'p1'
//      { type: 'pass' }                             end main, go to combat
//      { type: 'attack', attackers: [uid...] }      [] = no attack
//      { type: 'block', blocks: [[atkUid, blkUid]...] }  [] = no blocks
//  Attack and block lists hold at most 16 options (MAX_OPTIONS). They are
//  built from greedy seeds first (good blocks, prefix attacks by power),
//  then filled in a fixed order. The empty option is always present.
//
//  Permanent: { uid, id, tapped, sick, dmg, pp, pt, pc }
//      pp/pt: pump this turn (can be below 0 after weaken)
//      pc:    lasting +pc/+pc (grow). power() and toughness() add both.
//  Player:    { life, library, hand, battlefield, graveyard, landPlayed }
//  State:     { seed, decks, first, names, turn, active, phase, toAct,
//               players, combat, nextUid, rngState, logOn, log, events,
//               result }
//  events: what the last step did, for animation. Filled only when the
//  log is on (else []). One object per thing, in order:
//      { t: 'tap', p, uid, pays }           a land paid (colour or 'generic')
//      { t: 'enter', p, uid, id }           a permanent entered
//      { t: 'trigger', p, uid?, id, when, kind }   when: enter|death|upkeep
//      { t: 'damage', p, uid?, n }          to a creature (uid) or a player
//      { t: 'life', p, n }                  life change (+ or -)
//      { t: 'dies', p, uid, id }            creature left by death
//      { t: 'bounce', p, uid, id }          creature went back to a hand
//      { t: 'tapped', p, uid }              tapped by an effect
//      { t: 'grow', p, uid, n }             lasting +n/+n
//      { t: 'pump', p, uid, pp, pt }        this-turn change
//      { t: 'draw', p, n }  { t: 'discard', p, id }  { t: 'raise', p, id }
//  Speed: newGame({ log: false }) skips the log text and the events.
//
//  EXPORTS   (jump with grep -n "<anchor>" game/rules.js)
//      constants ...... "export const LIFE"         LIFE, HAND_MAX, TURN_CAP...
//      newGame ........ "export function newGame"
//      legalActions ... "export function legalActions"
//      step ........... "export function step"
//      isOver ......... "export function isOver"
//      clone .......... "export function clone"
//      describe ....... "export function describe"
//      actionKey ...... "export function actionKey"   stable string per action
//      withPermanent .. "export function withPermanent"  test and sandbox setup
//      power/toughness  "export function power"      with pumps and growth
//      hasKw .......... "export function hasKw"
//      manaPool ....... "export function manaPool"    untapped mana by colour
//      canPay ......... "export function canPay"      player (exact) or pool
//      payPlan ........ "export function payPlan"     [{uid, pays}] or null
//      canAttack ...... "export function canAttack"
//      canBlock ....... "export function canBlock"
//      canTarget ...... "export function canTarget"   shell check
//  INTERNALS
//      fork ........... "function fork"             copy-on-step clone
//      landInfo ....... "function landInfo"         untapped land summary
//      targetsFor ..... "function targetsFor"
//      resolveEffect .. "function resolveEffect"
//      die ............ "function die"              death + onDeath trigger
//      sweep .......... "function sweep"            lethal damage check
//      resolveCombat .. "function resolveCombat"
//      endTurn ........ "function endTurn"
//      attackOptions .. "function attackOptions"
//      blockOptions ... "function blockOptions"
// ============================================================================
import { CARD, COLOUR_IDS, buildDeck, manaValue } from './cards.js';
import { mulberry32 } from '../data/rng.js';

export const LIFE = 20;
export const HAND_MAX = 7;
export const TURN_CAP = 60;
export const LOG_MAX = 200;
export const MAX_OPTIONS = 16;

// Keyword flags per card id, computed once.
const KW_LIST = ['swift', 'wings', 'web', 'sting', 'thick', 'sap', 'lunge', 'crush', 'shell', 'alert'];
const KW = {};
for (const id of Object.keys(CARD)) {
  const k = CARD[id].keywords || [];
  KW[id] = Object.fromEntries(KW_LIST.map(w => [w, k.includes(w)]));
}

export const hasKw = (perm, kw) => !!KW[perm.id][kw];
export const power = perm => (CARD[perm.id].power || 0) + perm.pp + (perm.pc || 0);
export const toughness = perm => (CARD[perm.id].toughness || 0) + perm.pt + (perm.pc || 0);
const isCreature = perm => CARD[perm.id].type === 'creature';
const isLand = perm => CARD[perm.id].type === 'land';
const pname = (s, p) => (s.names && s.names[p]) || `Player ${p + 1}`;
const mkPerm = (s, id, tapped, sick) => ({ uid: s.nextUid++, id, tapped, sick, dmg: 0, pp: 0, pt: 0, pc: 0 });
const ev = (s, o) => { if (s.logOn) s.events.push(o); };

export function canAttack(perm) {
  return isCreature(perm) && !perm.tapped && !KW[perm.id].thick && (!perm.sick || KW[perm.id].swift);
}
export function canBlock(blocker, attacker) {
  return isCreature(blocker) && !blocker.tapped && (!KW[attacker.id].wings || KW[blocker.id].wings || KW[blocker.id].web);
}
// Can player `by` aim an effect at this permanent? Shell stops the
// opposing side only.
export function canTarget(perm, owner, by) {
  return owner === by || !KW[perm.id].shell;
}

// ------------------------------------------------------------------ setup
export function newGame({ seed = 1, decks = ['amber', 'moss'], first = 0, names = null, log = true } = {}) {
  const rng = mulberry32(seed >>> 0);
  const players = decks.map(d => {
    const lib = buildDeck(d, rng);
    return { life: LIFE, library: lib.slice(HAND_MAX), hand: lib.slice(0, HAND_MAX),
      battlefield: [], graveyard: [], landPlayed: false };
  });
  const s = {
    seed: seed >>> 0, decks: decks.map(d => (Array.isArray(d) ? d.map(r => r.slice()) : d)), first,
    names: names ? names.slice() : null,
    turn: 1, active: first, phase: 'main', toAct: first, players, combat: null,
    nextUid: 1, rngState: Math.floor(rng() * 4294967296) >>> 0,
    logOn: !!log, log: [], events: [], result: null,
  };
  if (s.logOn) s.log = [`Turn 1: ${pname(s, first)} goes first.`];
  return s;
}

// Deep copy. Plain data only.
export function clone(state) {
  const s = fork(state);
  for (const p of s.players) p.library = p.library.slice();
  s.log = state.log.slice();
  s.events = (state.events || []).map(e => ({ ...e }));
  return s;
}

// The copy that step() works on. The library array is shared because step()
// replaces it (never edits it in place). The log is shared until a step
// appends to it. Everything step() edits in place is copied here.
function fork(state) {
  const players = state.players.map(p => ({
    life: p.life, library: p.library, hand: p.hand.slice(),
    battlefield: p.battlefield.map(x => ({ uid: x.uid, id: x.id, tapped: x.tapped, sick: x.sick, dmg: x.dmg, pp: x.pp, pt: x.pt, pc: x.pc || 0 })),
    graveyard: p.graveyard.slice(), landPlayed: p.landPlayed,
  }));
  return {
    seed: state.seed, decks: state.decks, first: state.first, names: state.names,
    turn: state.turn, active: state.active, phase: state.phase, toAct: state.toAct, players,
    combat: state.combat ? { attackers: state.combat.attackers.slice() } : null,
    nextUid: state.nextUid, rngState: state.rngState, logOn: state.logOn, log: state.log, events: [],
    result: state.result ? { winner: state.result.winner, reason: state.result.reason } : null,
  };
}

// Add a permanent for tests or a sandbox board. Pure: returns a new state.
export function withPermanent(state, p, id, { tapped = false, sick = false, dmg = 0, pc = 0 } = {}) {
  if (!CARD[id]) throw new Error(`unknown card ${id}`);
  const s = fork(state);
  const perm = mkPerm(s, id, tapped, sick);
  perm.dmg = dmg; perm.pc = pc;
  s.players[p].battlefield.push(perm);
  return s;
}

export function isOver(state) { return state.result; }

// ------------------------------------------------------------------- mana
// Untapped mana by colour: each count is the number of untapped lands that
// can make that colour (a dual land counts in both). total = untapped lands.
export function manaPool(player) {
  const pool = { amber: 0, moss: 0, dew: 0, rot: 0, pollen: 0, total: 0 };
  for (const x of player.battlefield) {
    if (x.tapped || !isLand(x)) continue;
    pool.total++;
    for (const c of CARD[x.id].mana) pool[c]++;
  }
  return pool;
}

// Untapped lands: basic counts by colour, dual lands as colour pairs.
function landInfo(player) {
  const single = { amber: 0, moss: 0, dew: 0, rot: 0, pollen: 0 };
  const duals = [];
  let total = 0;
  for (const x of player.battlefield) {
    if (x.tapped || !isLand(x)) continue;
    total++;
    const m = CARD[x.id].mana;
    if (m.length === 1) single[m[0]]++; else duals.push(m);
  }
  return { single, duals, total };
}

// Residual coloured needs (after basic lands) matched to dual lands.
// needs: colour list, one entry per mana. duals: colour pairs. Small sizes:
// a depth-first augmenting search.
function matchDuals(needs, duals) {
  if (needs.length === 0) return [];
  if (needs.length > duals.length) return null;
  const owner = new Array(duals.length).fill(-1);
  const tryNeed = (i, seen) => {
    for (let j = 0; j < duals.length; j++) {
      if (seen[j] || !duals[j].includes(needs[i])) continue;
      seen[j] = true;
      if (owner[j] < 0 || tryNeed(owner[j], seen)) { owner[j] = i; return true; }
    }
    return false;
  };
  for (let i = 0; i < needs.length; i++) if (!tryNeed(i, new Array(duals.length).fill(false))) return null;
  return owner;
}

function residualNeeds(single, cost) {
  const needs = [];
  for (const c of COLOUR_IDS) for (let i = single[c]; i < cost[c]; i++) needs.push(c);
  return needs;
}

function canPayInfo(info, cost) {
  if (info.total < manaValue({ cost })) return false;
  return matchDuals(residualNeeds(info.single, cost), info.duals) !== null;
}

// canPay(player, cost): exact, with dual lands. canPay(pool, cost) with a
// manaPool() object: exact when there are no dual lands, else a quick
// necessary check (each colour and the total).
export function canPay(x, cost) {
  if (x && x.battlefield) return canPayInfo(landInfo(x), cost);
  for (const c of COLOUR_IDS) if ((x[c] || 0) < (cost[c] || 0)) return false;
  const total = x.total ?? COLOUR_IDS.reduce((t, c) => t + (x[c] || 0), 0);
  return total >= manaValue({ cost: { generic: 0, amber: 0, moss: 0, dew: 0, rot: 0, pollen: 0, ...cost } });
}

// Auto-tap plan: which untapped land pays what. Returns [{ uid, pays }]
// in battlefield order (pays: a colour or 'generic'), or null when the
// lands cannot pay. Pure: reads the player only.
export function payPlan(player, cost) {
  const lands = player.battlefield.filter(x => !x.tapped && isLand(x));
  const used = new Map();   // uid -> pays
  const need = {};
  for (const c of COLOUR_IDS) need[c] = cost[c] || 0;
  // 1. basic lands for their own colour
  for (const x of lands) {
    const m = CARD[x.id].mana;
    if (m.length === 1 && need[m[0]] > 0) { used.set(x.uid, m[0]); need[m[0]]--; }
  }
  // 2. dual lands for what is left
  const duals = lands.filter(x => CARD[x.id].mana.length > 1);
  const needs = [];
  for (const c of COLOUR_IDS) for (let i = 0; i < need[c]; i++) needs.push(c);
  const owner = matchDuals(needs, duals.map(x => CARD[x.id].mana));
  if (owner === null) return null;
  owner.forEach((ni, j) => { if (ni >= 0) used.set(duals[j].uid, needs[ni]); });
  // 3. generic: basic lands of the colour with the most left, dual lands last
  let gen = cost.generic || 0;
  while (gen > 0) {
    const left = lands.filter(x => !used.has(x.uid));
    if (!left.length) return null;
    const count = {};
    for (const x of left) for (const c of CARD[x.id].mana) count[c] = (count[c] || 0) + 1;
    let pick = null, best = -1;
    for (const x of left) {
      const m = CARD[x.id].mana;
      const score = m.length === 1 ? 100 + count[m[0]] : 0;
      if (score > best) { best = score; pick = x; }
    }
    used.set(pick.uid, 'generic');
    gen--;
  }
  return lands.filter(x => used.has(x.uid)).map(x => ({ uid: x.uid, pays: used.get(x.uid) }));
}

function pay(s, p, cost) {
  const pl = s.players[p];
  const plan = payPlan(pl, cost);
  if (!plan) throw new Error('illegal cast: cannot pay');
  for (const { uid, pays } of plan) {
    pl.battlefield.find(x => x.uid === uid).tapped = true;
    ev(s, { t: 'tap', p, uid, pays });
  }
}

// --------------------------------------------------------------- targets
// Legal targets for a card's main effect, cast by player p. null = no
// choice. A spell with [] cannot be cast now. A creature whose enter
// effect has no legal target is cast with no target (the effect does
// nothing).
const CHOICE = new Set(['any', 'opp', 'own']);
function targetsFor(s, p, card) {
  const e = card.effect;
  if (!e || !CHOICE.has(e.target)) return null;
  const opp = s.players[1 - p], me = s.players[p];
  const out = [];
  if (e.target === 'any') out.push('p' + (1 - p));
  if (e.target === 'any' || e.target === 'opp') {
    for (const x of opp.battlefield) {
      if (!isCreature(x) || !canTarget(x, 1 - p, p)) continue;
      if (e.kind === 'destroy' && (power(x) > e.amount || (e.min && power(x) < e.min))) continue;
      if (e.kind === 'tap' && x.tapped) continue;
      out.push(x.uid);
    }
  } else {
    for (const x of me.battlefield) if (isCreature(x)) out.push(x.uid);
  }
  if (card.type === 'creature' && out.length === 0) return null;
  return out;
}

// ----------------------------------------------------------- legal actions
export function legalActions(state) {
  if (state.result) return [];
  if (state.phase === 'main') return mainOptions(state);
  if (state.phase === 'attack') return attackOptions(state);
  if (state.phase === 'block') return blockOptions(state);
  return [];
}

function mainOptions(s) {
  const p = s.toAct, me = s.players[p];
  const out = [];
  const seen = new Set();
  if (!me.landPlayed) {
    for (const id of me.hand) {
      if (CARD[id].type !== 'land' || seen.has(id)) continue;
      seen.add(id);
      out.push({ type: 'land', card: id });
    }
  }
  const info = landInfo(me);
  for (const id of me.hand) {
    const card = CARD[id];
    if (card.type === 'land' || seen.has(id)) continue;
    seen.add(id);
    if (!canPayInfo(info, card.cost)) continue;
    const t = targetsFor(s, p, card);
    if (t === null) out.push({ type: 'cast', card: id });
    else for (const target of t) out.push({ type: 'cast', card: id, target });
  }
  out.push({ type: 'pass' });
  return out;
}

function eligibleAttackers(s) {
  return s.players[s.active].battlefield.filter(canAttack);
}

function attackOptions(s) {
  const el = eligibleAttackers(s);
  const n = el.length;
  const uids = el.map(x => x.uid);
  const out = [];
  if (n <= 4) {
    for (let m = 0; m < (1 << n); m++) {
      const a = [];
      for (let i = 0; i < n; i++) if (m & (1 << i)) a.push(uids[i]);
      out.push({ type: 'attack', attackers: a });
    }
    return out;
  }
  const keys = new Set();
  const add = list => {
    if (out.length >= MAX_OPTIONS) return;
    const a = list.slice().sort((x, y) => x - y);
    const k = a.join(',');
    if (keys.has(k)) return;
    keys.add(k);
    out.push({ type: 'attack', attackers: a });
  };
  add([]);
  add(uids);
  const byPow = el.slice().sort((a, b) => power(b) - power(a) || a.uid - b.uid);
  add(el.filter(x => KW[x.id].wings).map(x => x.uid));
  add(el.filter(x => KW[x.id].alert).map(x => x.uid));
  for (let k = 1; k < n; k++) add(byPow.slice(0, k).map(x => x.uid));
  for (const x of byPow) add([x.uid]);
  for (let k = 1; k < n; k++) add(byPow.slice(k).map(x => x.uid));
  return out;
}

// Blocks: greedy seeds first, then a fixed-order search fills the list.
function blockOptions(s) {
  const att = s.players[s.active].battlefield;
  const atk = s.combat.attackers.map(u => att.find(x => x.uid === u)).filter(Boolean);
  const blk = s.players[1 - s.active].battlefield.filter(x => isCreature(x) && !x.tapped);
  const life = s.players[1 - s.active].life;
  const out = [];
  const keys = new Set();
  const add = pairs => {
    if (out.length >= MAX_OPTIONS) return;
    const b = pairs.slice().sort((x, y) => x[0] - y[0]);
    const k = b.map(q => q[0] + ':' + q[1]).join(',');
    if (keys.has(k)) return;
    keys.add(k);
    out.push({ type: 'block', blocks: b });
  };
  add([]);
  const value = x => power(x) + toughness(x);
  // A blocker with lunge that kills first takes no damage back.
  const survives = (b, a) => (KW[b.id].lunge && !KW[a.id].lunge && kills(b, a))
    || (toughness(b) - b.dmg > power(a) && !(KW[a.id].sting && power(a) > 0));
  const kills = (b, a) => power(b) > 0 && (power(b) >= toughness(a) - a.dmg || KW[b.id].sting);
  const atkByPow = atk.slice().sort((a, b) => power(b) - power(a) || a.uid - b.uid);
  const blkByVal = blk.slice().sort((a, b) => value(a) - value(b) || a.uid - b.uid);

  // seed 1: good blocks (survive and kill > survive > even trade)
  const good = (allowTrade) => {
    const used = new Set(), pairs = [];
    for (const a of atkByPow) {
      let best = null, bestScore = -1;
      for (const b of blkByVal) {
        if (used.has(b.uid) || !canBlock(b, a)) continue;
        const sv = survives(b, a), kl = kills(b, a);
        let sc = -1;
        if (sv && kl) sc = 3; else if (sv) sc = 2; else if (kl && allowTrade && value(b) <= value(a)) sc = 1;
        if (sc > bestScore) { best = b; bestScore = sc; }
      }
      if (best && bestScore > 0) { used.add(best.uid); pairs.push([a.uid, best.uid]); }
    }
    return pairs;
  };
  const g1 = good(true), g0 = good(false);
  add(g1);
  add(g0);
  // seed 2: chump to live. On top of the good blocks, block the biggest
  // unblocked attackers with the cheapest blockers until the hit is not lethal.
  const chump = base => {
    const pairs = base.slice();
    const usedB = new Set(pairs.map(q => q[1])), usedA = new Set(pairs.map(q => q[0]));
    let incoming = 0;
    for (const a of atk) if (!usedA.has(a.uid)) incoming += Math.max(0, power(a));
    for (const a of atkByPow) {
      if (incoming < life) break;
      if (usedA.has(a.uid) || KW[a.id].crush) continue;
      const b = blkByVal.find(x => !usedB.has(x.uid) && canBlock(x, a));
      if (!b) continue;
      usedB.add(b.uid); usedA.add(a.uid); pairs.push([a.uid, b.uid]);
      incoming -= Math.max(0, power(a));
    }
    return pairs;
  };
  add(chump(g1));
  // seed 3: block everything possible, biggest blocker on biggest attacker
  {
    const used = new Set(), pairs = [];
    const blkByPow = blk.slice().sort((a, b) => power(b) - power(a) || a.uid - b.uid);
    for (const a of atkByPow) {
      const b = blkByPow.find(x => !used.has(x.uid) && canBlock(x, a));
      if (b) { used.add(b.uid); pairs.push([a.uid, b.uid]); }
    }
    add(pairs);
  }
  // single blocks
  for (const a of atkByPow) for (const b of blkByVal) if (canBlock(b, a)) add([[a.uid, b.uid]]);
  // fill: depth-first over attackers in uid order, 'no block' first
  if (out.length < MAX_OPTIONS) {
    const used = new Set(), pairs = [];
    const dfs = i => {
      if (out.length >= MAX_OPTIONS) return;
      if (i === atk.length) { add(pairs); return; }
      dfs(i + 1);
      for (const b of blk) {
        if (out.length >= MAX_OPTIONS) return;
        if (used.has(b.uid) || !canBlock(b, atk[i])) continue;
        used.add(b.uid); pairs.push([atk[i].uid, b.uid]);
        dfs(i + 1);
        used.delete(b.uid); pairs.pop();
      }
    };
    dfs(0);
  }
  return out;
}

export function actionKey(a) {
  switch (a.type) {
    case 'land': return 'land:' + a.card;
    case 'cast': return 'cast:' + a.card + (a.target !== undefined ? '@' + a.target : '');
    case 'pass': return 'pass';
    case 'attack': return 'attack:' + a.attackers.join(',');
    case 'block': return 'block:' + a.blocks.map(q => q[0] + '>' + q[1]).join(',');
    default: return 'unknown';
  }
}

// ------------------------------------------------------------------- step
export function step(state, action) {
  if (state.result) throw new Error('game is over');
  if (!action || typeof action.type !== 'string') throw new Error('bad action');
  const s = fork(state);
  const lines = s.logOn ? [describe(action, state)] : null;
  const p = s.toAct, me = s.players[p];

  if (s.phase === 'main') {
    if (action.type === 'land') {
      const i = me.hand.indexOf(action.card);
      const card = CARD[action.card];
      if (me.landPlayed || i < 0 || !card || card.type !== 'land') throw new Error('illegal land play');
      me.hand.splice(i, 1);
      const perm = mkPerm(s, action.card, !!card.entersTapped, false);
      me.battlefield.push(perm);
      ev(s, { t: 'enter', p, uid: perm.uid, id: perm.id });
      me.landPlayed = true;
    } else if (action.type === 'cast') {
      const i = me.hand.indexOf(action.card);
      const card = CARD[action.card];
      if (i < 0 || !card || card.type === 'land') throw new Error('illegal cast: not in hand');
      if (!canPay(me, card.cost)) throw new Error('illegal cast: cannot pay');
      const t = targetsFor(s, p, card);
      if (t !== null ? !t.includes(action.target) : action.target !== undefined) throw new Error('illegal cast: bad target');
      me.hand.splice(i, 1);
      pay(s, p, card.cost);
      if (card.type === 'creature') {
        const perm = mkPerm(s, card.id, false, true);
        me.battlefield.push(perm);
        ev(s, { t: 'enter', p, uid: perm.uid, id: perm.id });
        if (card.effect) {
          ev(s, { t: 'trigger', p, uid: perm.uid, id: card.id, when: 'enter', kind: card.effect.kind });
          resolveEffect(s, p, card.effect, action.target, lines, perm.uid);
        }
      } else {
        resolveEffect(s, p, card.effect, action.target, lines, undefined);
        me.graveyard.push(card.id);
      }
      sweep(s, lines);
      checkLife(s, lines);
    } else if (action.type === 'pass') {
      enterAttack(s, lines);
    } else throw new Error(`illegal action ${action.type} in main`);
  } else if (s.phase === 'attack') {
    if (action.type !== 'attack' || !Array.isArray(action.attackers)) throw new Error('illegal action in attack');
    const seen = new Set();
    for (const u of action.attackers) {
      const x = me.battlefield.find(y => y.uid === u);
      if (!x || !canAttack(x) || seen.has(u)) throw new Error('illegal attacker');
      seen.add(u);
    }
    if (action.attackers.length === 0) endTurn(s, lines);
    else {
      for (const x of me.battlefield) if (seen.has(x.uid) && !KW[x.id].alert) x.tapped = true;
      s.combat = { attackers: action.attackers.slice() };
      s.phase = 'block';
      s.toAct = 1 - s.active;
      const def = s.players[s.toAct].battlefield;
      const att = me.battlefield.filter(x => seen.has(x.uid));
      const any = def.some(b => att.some(a => canBlock(b, a)));
      if (!any) {
        resolveCombat(s, [], lines);
        if (!s.result) endTurn(s, lines);
      }
    }
  } else if (s.phase === 'block') {
    if (action.type !== 'block' || !Array.isArray(action.blocks)) throw new Error('illegal action in block');
    const att = s.players[s.active].battlefield;
    const usedA = new Set(), usedB = new Set();
    for (const [a, b] of action.blocks) {
      const ap = att.find(x => x.uid === a), bp = me.battlefield.find(x => x.uid === b);
      if (!ap || !bp || !s.combat.attackers.includes(a) || usedA.has(a) || usedB.has(b) || !canBlock(bp, ap)) {
        throw new Error('illegal block');
      }
      usedA.add(a); usedB.add(b);
    }
    resolveCombat(s, action.blocks, lines);
    if (!s.result) endTurn(s, lines);
  } else throw new Error(`bad phase ${s.phase}`);

  if (lines) {
    const keep = Math.max(0, s.log.length + lines.length - LOG_MAX);
    s.log = s.log.slice(keep).concat(lines);
    if (s.log.length > LOG_MAX) s.log = s.log.slice(-LOG_MAX);
  }
  return s;
}

function enterAttack(s, lines) {
  s.phase = 'attack';
  s.toAct = s.active;
  if (eligibleAttackers(s).length === 0) endTurn(s, lines);
}

// ---------------------------------------------------------------- effects
function loseLife(s, p, n) { s.players[p].life -= n; ev(s, { t: 'life', p, n: -n }); }
function gainLife(s, p, n) { s.players[p].life += n; ev(s, { t: 'life', p, n }); }

// A creature dies: off the battlefield, to the graveyard (tokens vanish),
// then its onDeath trigger. The trigger has no target choice.
function die(s, owner, x, lines) {
  const pl = s.players[owner];
  const i = pl.battlefield.indexOf(x);
  if (i < 0) return;
  pl.battlefield.splice(i, 1);
  if (!CARD[x.id].token) pl.graveyard.push(x.id);
  ev(s, { t: 'dies', p: owner, uid: x.uid, id: x.id });
  if (lines) lines.push(`  ${CARD[x.id].name} dies.`);
  const d = CARD[x.id].onDeath;
  if (d && !s.result) {
    ev(s, { t: 'trigger', p: owner, uid: x.uid, id: x.id, when: 'death', kind: d.kind });
    resolveEffect(s, owner, d, undefined, lines, undefined);
  }
}

function findPerm(s, uid) {
  for (let q = 0; q < 2; q++) {
    const x = s.players[q].battlefield.find(y => y.uid === uid);
    if (x) return [x, q];
  }
  return [null, -1];
}

function resolveEffect(s, p, e, target, lines, srcUid) {
  const me = s.players[p], opp = s.players[1 - p], o = 1 - p;
  const oppCreatures = () => opp.battlefield.filter(isCreature);
  const myCreatures = () => me.battlefield.filter(isCreature);
  const tgtOpp = () => (typeof target === 'number' ? opp.battlefield.find(y => y.uid === target) : null);
  const tgtOwn = () => (typeof target === 'number' ? me.battlefield.find(y => y.uid === target) : null);
  switch (e.kind) {
    case 'damage':
      if (e.target === 'each') {
        for (const x of oppCreatures()) { x.dmg += e.amount; ev(s, { t: 'damage', p: o, uid: x.uid, n: e.amount }); }
      } else if (e.target === 'face' || typeof target === 'string') {
        const q = e.target === 'face' ? o : +target.slice(1);
        ev(s, { t: 'damage', p: q, n: e.amount });
        loseLife(s, q, e.amount);
      } else {
        const x = tgtOpp();
        if (x) { x.dmg += e.amount; ev(s, { t: 'damage', p: o, uid: x.uid, n: e.amount }); }
      }
      break;
    case 'draw':
      for (let i = 0; i < e.amount && !s.result; i++) drawCard(s, p, lines);
      break;
    case 'pump': {
      const x = tgtOwn();
      if (x) { x.pp += e.amount; x.pt += e.tough ?? e.amount; ev(s, { t: 'pump', p, uid: x.uid, pp: e.amount, pt: e.tough ?? e.amount }); }
      break;
    }
    case 'heal':
      gainLife(s, p, e.amount);
      break;
    case 'destroy': {
      const x = tgtOpp();
      if (x) die(s, o, x, lines);
      break;
    }
    case 'token':
      for (let i = 0; i < e.amount; i++) {
        const perm = mkPerm(s, e.token, false, !KW[e.token].swift);
        me.battlefield.push(perm);
        ev(s, { t: 'enter', p, uid: perm.uid, id: perm.id });
      }
      break;
    case 'grow': {
      const list = e.target === 'all' ? myCreatures()
        : e.target === 'this' ? me.battlefield.filter(y => y.uid === srcUid) : [tgtOwn()].filter(Boolean);
      for (const x of list) { x.pc += e.amount; ev(s, { t: 'grow', p, uid: x.uid, n: e.amount }); }
      break;
    }
    case 'rally':
      for (const x of myCreatures()) { x.pp += e.amount; x.pt += e.amount; ev(s, { t: 'pump', p, uid: x.uid, pp: e.amount, pt: e.amount }); }
      break;
    case 'drain':
      loseLife(s, o, e.amount);
      gainLife(s, p, e.amount);
      break;
    case 'tap': {
      const x = tgtOpp();
      if (x) { x.tapped = true; ev(s, { t: 'tapped', p: o, uid: x.uid }); }
      break;
    }
    case 'bounce': {
      const x = tgtOpp();
      if (x) {
        opp.battlefield.splice(opp.battlefield.indexOf(x), 1);
        if (!CARD[x.id].token) opp.hand.push(x.id);
        ev(s, { t: 'bounce', p: o, uid: x.uid, id: x.id });
        if (lines) lines.push(`  ${CARD[x.id].name} goes back to ${pname(s, o)}'s hand.`);
      }
      break;
    }
    case 'ramp':
      for (let n = 0; n < e.amount; n++) {
        const i = me.library.findIndex(id => CARD[id].type === 'land');
        if (i < 0) break;
        const lib = me.library.slice();
        const [id] = lib.splice(i, 1);
        me.library = lib;
        const perm = mkPerm(s, id, true, false);
        me.battlefield.push(perm);
        ev(s, { t: 'enter', p, uid: perm.uid, id });
        if (lines) lines.push(`  ${pname(s, p)} puts ${CARD[id].name} onto the battlefield.`);
      }
      break;
    case 'discard':
      for (let n = 0; n < e.amount && opp.hand.length; n++) {
        let bi = 0;
        for (let i = 1; i < opp.hand.length; i++) if (manaValue(opp.hand[i]) > manaValue(opp.hand[bi])) bi = i;
        const [gone] = opp.hand.splice(bi, 1);
        opp.graveyard.push(gone);
        ev(s, { t: 'discard', p: o, id: gone });
        if (lines) lines.push(`  ${pname(s, o)} discards ${CARD[gone].name}.`);
      }
      break;
    case 'weaken': {
      const list = e.target === 'each' ? oppCreatures() : [tgtOpp()].filter(Boolean);
      for (const x of list) { x.pp -= e.amount; x.pt -= e.amount; ev(s, { t: 'pump', p: o, uid: x.uid, pp: -e.amount, pt: -e.amount }); }
      break;
    }
    case 'feast': {
      const x = tgtOwn();
      if (x) die(s, p, x, lines);
      for (let i = 0; i < e.amount && !s.result; i++) drawCard(s, p, lines);
      break;
    }
    case 'raise': {
      let bi = -1;
      for (let i = 0; i < me.graveyard.length; i++) {
        const c = CARD[me.graveyard[i]];
        if (c.type === 'creature' && (bi < 0 || manaValue(c) > manaValue(me.graveyard[bi]))) bi = i;
      }
      if (bi >= 0) {
        const [id] = me.graveyard.splice(bi, 1);
        me.hand.push(id);
        ev(s, { t: 'raise', p, id });
        if (lines) lines.push(`  ${CARD[id].name} returns to ${pname(s, p)}'s hand.`);
      }
      break;
    }
    default: throw new Error(`unknown effect ${e.kind}`);
  }
  if (e.then && !s.result) resolveEffect(s, p, e.then, undefined, lines, srcUid);
}

function drawCard(s, p, lines) {
  const pl = s.players[p];
  if (pl.library.length === 0) {
    s.result = { winner: 1 - p, reason: 'decked' };
    s.phase = 'over';
    if (lines) lines.push(`${pname(s, p)} must draw from an empty library and loses.`);
    return;
  }
  pl.hand.push(pl.library[0]);
  pl.library = pl.library.slice(1);
  ev(s, { t: 'draw', p, n: 1 });
}

// Creatures with lethal damage, toughness 0 or less, or marked by sting
// die. Death triggers can not kill creatures, so one pass is enough; the
// loop is a guard.
function sweep(s, lines, stung) {
  for (let guard = 0; guard < 8; guard++) {
    const dead = [];
    for (const q of [s.active, 1 - s.active]) {
      for (const x of s.players[q].battlefield) {
        if (isCreature(x) && (x.dmg >= toughness(x) || (stung && stung.has(x.uid)))) dead.push([q, x]);
      }
    }
    if (!dead.length) return;
    for (const [q, x] of dead) die(s, q, x, lines);
    stung = null;
  }
}

function checkLife(s, lines) {
  if (s.result) return;
  const d0 = s.players[0].life <= 0, d1 = s.players[1].life <= 0;
  if (!d0 && !d1) return;
  s.result = d0 && d1 ? { winner: -1, reason: 'both at 0 life' } : { winner: d0 ? 1 : 0, reason: 'life' };
  s.phase = 'over';
  if (lines) lines.push(s.result.winner < 0 ? 'Both players fall. Draw.' : `${pname(s, s.result.winner)} wins.`);
}

// ----------------------------------------------------------------- combat
// Two damage passes when a lunge creature is in the fight: lunge creatures
// first, then the others that are still alive. Crush: a blocked attacker
// gives its blocker only the damage that kills it (1 with sting) and the
// rest to the player; a crush attacker whose blocker is gone hits the
// player with all of it. Sap: the controller gains what it dealt.
function resolveCombat(s, blocks, lines) {
  const A = s.active, D = 1 - A, att = s.players[A], def = s.players[D];
  const blockOf = new Map(blocks.map(q => [q[0], q[1]]));
  const alive = (pl, uid) => pl.battlefield.find(x => x.uid === uid);
  const fights = s.combat.attackers.map(u => ({ a: u, b: blockOf.get(u) }));
  const anyLunge = fights.some(f => {
    const a = alive(att, f.a), b = f.b !== undefined ? alive(def, f.b) : null;
    return (a && KW[a.id].lunge) || (b && KW[b.id].lunge);
  });
  let toPlayer = 0;
  for (const first of anyLunge ? [true, false] : [false]) {
    const stung = new Set();
    for (const f of fights) {
      const a = alive(att, f.a);
      const b = f.b !== undefined ? alive(def, f.b) : null;
      const aHits = a && (anyLunge ? KW[a.id].lunge === first : true);
      if (aHits) {
        const pa = power(a);
        if (pa > 0) {
          let toB = 0, toP = 0;
          if (f.b === undefined) toP = pa;
          else if (b) {
            if (KW[a.id].crush) {
              const need = KW[a.id].sting ? 1 : Math.max(0, toughness(b) - b.dmg);
              toB = Math.min(pa, need); toP = pa - toB;
            } else toB = pa;
          } else if (KW[a.id].crush) toP = pa;
          if (toB > 0) {
            b.dmg += toB;
            ev(s, { t: 'damage', p: D, uid: b.uid, n: toB });
            if (KW[a.id].sting) stung.add(b.uid);
          }
          if (toP > 0) { def.life -= toP; toPlayer += toP; ev(s, { t: 'damage', p: D, n: toP }); ev(s, { t: 'life', p: D, n: -toP }); }
          if (KW[a.id].sap && toB + toP > 0) gainLife(s, A, toB + toP);
        }
      }
      const bHits = b && a && (anyLunge ? KW[b.id].lunge === first : true);
      if (bHits) {
        const pb = power(b);
        if (pb > 0) {
          a.dmg += pb;
          ev(s, { t: 'damage', p: A, uid: a.uid, n: pb });
          if (KW[b.id].sting) stung.add(a.uid);
          if (KW[b.id].sap) gainLife(s, D, pb);
        }
      }
    }
    sweep(s, lines, stung);
    checkLife(s, lines);
    if (s.result) break;
  }
  if (lines && toPlayer > 0) lines.push(`  ${pname(s, D)} takes ${toPlayer} damage (${def.life} life left).`);
  s.combat = null;
}

// ---------------------------------------------------------------- end turn
function endTurn(s, lines) {
  const A = s.active, act = s.players[A];
  // discard down to the hand limit: lowest cost first, first copy first
  while (act.hand.length > HAND_MAX) {
    let bi = 0;
    for (let i = 1; i < act.hand.length; i++) if (manaValue(act.hand[i]) < manaValue(act.hand[bi])) bi = i;
    const [gone] = act.hand.splice(bi, 1);
    act.graveyard.push(gone);
    ev(s, { t: 'discard', p: A, id: gone });
    if (lines) lines.push(`  ${pname(s, A)} discards ${CARD[gone].name}.`);
  }
  for (const pl of s.players) for (const x of pl.battlefield) { x.dmg = 0; x.pp = 0; x.pt = 0; }
  s.combat = null;
  if (s.turn >= TURN_CAP) {
    s.result = { winner: -1, reason: 'turn cap' };
    s.phase = 'over';
    if (lines) lines.push(`Turn cap ${TURN_CAP} reached. Draw.`);
    return;
  }
  s.turn++;
  s.active = 1 - A;
  s.toAct = s.active;
  s.phase = 'main';
  const nx = s.players[s.active];
  nx.landPlayed = false;
  for (const x of nx.battlefield) { x.tapped = false; x.sick = false; }
  if (lines) lines.push(`Turn ${s.turn}: ${pname(s, s.active)}.`);
  // start-of-turn triggers, in battlefield order
  for (const x of nx.battlefield.slice()) {
    const u = CARD[x.id].onUpkeep;
    if (!u || !nx.battlefield.includes(x)) continue;
    ev(s, { t: 'trigger', p: s.active, uid: x.uid, id: x.id, when: 'upkeep', kind: u.kind });
    resolveEffect(s, s.active, u, undefined, lines, x.uid);
    checkLife(s, lines);
    if (s.result) return;
  }
  drawCard(s, s.active, lines);
}

// ---------------------------------------------------------------- describe
// One log line for an action, read against the state before the action.
export function describe(action, state) {
  const p = state.toAct, who = pname(state, p);
  const nameOf = uid => {
    for (const pl of state.players) {
      const x = pl.battlefield.find(y => y.uid === uid);
      if (x) return CARD[x.id].name;
    }
    return `#${uid}`;
  };
  switch (action.type) {
    case 'land': return `${who} plays ${CARD[action.card].name}.`;
    case 'cast': {
      const card = CARD[action.card];
      let t = '';
      if (typeof action.target === 'string') t = ` at ${pname(state, +action.target.slice(1))}`;
      else if (action.target !== undefined) t = ` on ${nameOf(action.target)}`;
      return `${who} casts ${card.name}${t}.`;
    }
    case 'pass': return `${who} moves to combat.`;
    case 'attack':
      return action.attackers.length
        ? `${who} attacks with ${action.attackers.map(nameOf).join(', ')}.`
        : `${who} does not attack.`;
    case 'block':
      return action.blocks.length
        ? `${who} blocks: ${action.blocks.map(([a, b]) => `${nameOf(b)} blocks ${nameOf(a)}`).join('; ')}.`
        : `${who} does not block.`;
    default: return `${who} does something unknown.`;
  }
}

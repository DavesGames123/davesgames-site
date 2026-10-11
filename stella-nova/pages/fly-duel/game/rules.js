// ============================================================================
//  FLY DUEL  ·  rules engine  (ES module, no DOM, pure)
// ----------------------------------------------------------------------------
//  A cut-down two-player card duel. step() never changes its input: it
//  returns a new state. The same seed and the same actions give the same
//  game on every machine. State is plain JSON (structuredClone is safe).
//
//  Turn, simplified:
//      untap -> draw (the first player does not draw on turn 1)
//      main: play at most one land, cast cards (auto-tap pays the cost),
//            then 'pass' to go to combat
//      attack: one action names every attacker (or none)
//      block: the defender gives one action that maps attacker -> blocker
//      damage, then end: hand above 7 discards the lowest-cost cards,
//            damage and pumps wear off, the other player starts a turn
//  Life 20. A draw from an empty library loses. After turn 60 the game is
//  a draw (winner -1). Spells are cast only in main. One blocker per
//  attacker. Harmful effects target only the opposing side.
//
//  Two shortcuts keep decisions meaningful. When no creature can attack,
//  the attack step is skipped. When no creature can block, the block step
//  is skipped and damage happens at once.
//
//  Action shapes (legalActions gives them, step takes them):
//      { type: 'land', card }                       play a land from hand
//      { type: 'cast', card, target? }              target: uid or 'p0'/'p1'
//      { type: 'pass' }                             end main, go to combat
//      { type: 'attack', attackers: [uid...] }      [] = no attack
//      { type: 'block', blocks: [[atkUid, blkUid]...] }  [] = no blocks
//  Attack and block lists hold at most 16 options (MAX_OPTIONS). They are
//  built from greedy seeds first (good blocks, prefix attacks by power),
//  then filled in a fixed order. The empty option is always present.
//
//  Permanent: { uid, id, tapped, sick, dmg, pp, pt }   pp/pt: pump this turn
//  Player:    { life, library, hand, battlefield, graveyard, landPlayed }
//  State:     { seed, decks, first, names, turn, active, phase, toAct,
//               players, combat, nextUid, rngState, logOn, log, result }
//  Speed: newGame({ log: false }) skips the log text. The trainer uses it.
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
//      power/toughness  "export function power"      with pumps
//      hasKw .......... "export function hasKw"
//      manaPool ....... "export function manaPool"    untapped mana by colour
//      canPay ......... "export function canPay"
//      canAttack ...... "export function canAttack"
//      canBlock ....... "export function canBlock"
//  INTERNALS
//      fork ........... "function fork"             copy-on-step clone
//      pay ............ "function pay"              auto-tap
//      resolveEffect .. "function resolveEffect"
//      resolveCombat .. "function resolveCombat"
//      endTurn ........ "function endTurn"
//      attackOptions .. "function attackOptions"
//      blockOptions ... "function blockOptions"
// ============================================================================
import { CARD, buildDeck, manaValue } from './cards.js';
import { mulberry32 } from '../data/rng.js';

export const LIFE = 20;
export const HAND_MAX = 7;
export const TURN_CAP = 60;
export const LOG_MAX = 200;
export const MAX_OPTIONS = 16;

// Keyword flags per card id, computed once.
const KW = {};
for (const id of Object.keys(CARD)) {
  const k = CARD[id].keywords || [];
  KW[id] = { swift: k.includes('swift'), wings: k.includes('wings'), sting: k.includes('sting'),
    thick: k.includes('thick'), sap: k.includes('sap') };
}

export const hasKw = (perm, kw) => KW[perm.id][kw];
export const power = perm => (CARD[perm.id].power || 0) + perm.pp;
export const toughness = perm => (CARD[perm.id].toughness || 0) + perm.pt;
const isCreature = perm => CARD[perm.id].type === 'creature';
const isLand = perm => CARD[perm.id].type === 'land';
const pname = (s, p) => (s.names && s.names[p]) || `Player ${p + 1}`;

export function canAttack(perm) {
  return isCreature(perm) && !perm.tapped && !KW[perm.id].thick && (!perm.sick || KW[perm.id].swift);
}
export function canBlock(blocker, attacker) {
  return isCreature(blocker) && !blocker.tapped && (!KW[attacker.id].wings || KW[blocker.id].wings);
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
    seed: seed >>> 0, decks: decks.slice(), first, names: names ? names.slice() : null,
    turn: 1, active: first, phase: 'main', toAct: first, players, combat: null,
    nextUid: 1, rngState: Math.floor(rng() * 4294967296) >>> 0,
    logOn: !!log, log: [], result: null,
  };
  if (s.logOn) s.log = [`Turn 1: ${pname(s, first)} goes first.`];
  return s;
}

// Deep copy. Plain data only.
export function clone(state) {
  const s = fork(state);
  for (const p of s.players) p.library = p.library.slice();
  s.log = state.log.slice();
  return s;
}

// The copy that step() works on. The library array is shared because step()
// replaces it (never edits it in place). The log is shared until a step
// appends to it. Everything step() edits in place is copied here.
function fork(state) {
  const players = state.players.map(p => ({
    life: p.life, library: p.library, hand: p.hand.slice(),
    battlefield: p.battlefield.map(x => ({ uid: x.uid, id: x.id, tapped: x.tapped, sick: x.sick, dmg: x.dmg, pp: x.pp, pt: x.pt })),
    graveyard: p.graveyard.slice(), landPlayed: p.landPlayed,
  }));
  return {
    seed: state.seed, decks: state.decks, first: state.first, names: state.names,
    turn: state.turn, active: state.active, phase: state.phase, toAct: state.toAct, players,
    combat: state.combat ? { attackers: state.combat.attackers.slice() } : null,
    nextUid: state.nextUid, rngState: state.rngState, logOn: state.logOn, log: state.log,
    result: state.result ? { winner: state.result.winner, reason: state.result.reason } : null,
  };
}

// Add a permanent for tests or a sandbox board. Pure: returns a new state.
export function withPermanent(state, p, id, { tapped = false, sick = false, dmg = 0 } = {}) {
  if (!CARD[id]) throw new Error(`unknown card ${id}`);
  const s = fork(state);
  const perm = { uid: s.nextUid++, id, tapped, sick, dmg, pp: 0, pt: 0 };
  s.players[p].battlefield.push(perm);
  return s;
}

export function isOver(state) { return state.result; }

// ------------------------------------------------------------------- mana
export function manaPool(player) {
  let amber = 0, moss = 0;
  for (const x of player.battlefield) {
    if (x.tapped || !isLand(x)) continue;
    if (CARD[x.id].produces === 'amber') amber++; else moss++;
  }
  return { amber, moss };
}

export function canPay(pool, cost) {
  return pool.amber >= cost.amber && pool.moss >= cost.moss &&
    pool.amber - cost.amber + pool.moss - cost.moss >= cost.generic;
}

// Auto-tap. Coloured costs first, then generic from the colour with more
// untapped lands left (amber on a tie). Lands tap in battlefield order.
function pay(player, cost) {
  let needA = cost.amber, needM = cost.moss, gen = cost.generic;
  const pool = manaPool(player);
  let leftA = pool.amber - needA, leftM = pool.moss - needM;
  while (gen > 0) {
    if (leftA >= leftM) { needA++; leftA--; } else { needM++; leftM--; }
    gen--;
  }
  for (const x of player.battlefield) {
    if (x.tapped || !isLand(x)) continue;
    if (CARD[x.id].produces === 'amber') { if (needA > 0) { x.tapped = true; needA--; } }
    else if (needM > 0) { x.tapped = true; needM--; }
  }
}

// --------------------------------------------------------------- targets
// Legal targets for a card's effect, cast by player p. null = no target
// needed. [] = the card cannot be cast now.
function targetsFor(s, p, card) {
  const e = card.effect;
  if (!e || card.type === 'creature' || e.target === 'self') return null;
  const opp = s.players[1 - p], me = s.players[p];
  const out = [];
  if (e.target === 'any') out.push('p' + (1 - p));
  if (e.target === 'any' || e.target === 'opp') {
    for (const x of opp.battlefield) {
      if (!isCreature(x)) continue;
      if (e.kind === 'destroy' && power(x) > e.amount) continue;
      out.push(x.uid);
    }
  } else if (e.target === 'own') {
    for (const x of me.battlefield) if (isCreature(x)) out.push(x.uid);
  }
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
  const pool = manaPool(me);
  for (const id of me.hand) {
    const card = CARD[id];
    if (card.type === 'land' || seen.has(id)) continue;
    seen.add(id);
    if (!canPay(pool, card.cost)) continue;
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
  const survives = (b, a) => toughness(b) - b.dmg > power(a) && !(KW[a.id].sting && power(a) > 0);
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
    for (const a of atk) if (!usedA.has(a.uid)) incoming += power(a);
    for (const a of atkByPow) {
      if (incoming < life) break;
      if (usedA.has(a.uid)) continue;
      const b = blkByVal.find(x => !usedB.has(x.uid) && canBlock(x, a));
      if (!b) continue;
      usedB.add(b.uid); usedA.add(a.uid); pairs.push([a.uid, b.uid]);
      incoming -= power(a);
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
      if (me.landPlayed || i < 0 || CARD[action.card].type !== 'land') throw new Error('illegal land play');
      me.hand.splice(i, 1);
      me.battlefield.push({ uid: s.nextUid++, id: action.card, tapped: false, sick: false, dmg: 0, pp: 0, pt: 0 });
      me.landPlayed = true;
    } else if (action.type === 'cast') {
      const i = me.hand.indexOf(action.card);
      const card = CARD[action.card];
      if (i < 0 || !card || card.type === 'land') throw new Error('illegal cast: not in hand');
      if (!canPay(manaPool(me), card.cost)) throw new Error('illegal cast: cannot pay');
      const t = targetsFor(s, p, card);
      if (t !== null && !t.includes(action.target)) throw new Error('illegal cast: bad target');
      me.hand.splice(i, 1);
      pay(me, card.cost);
      if (card.type === 'creature') {
        me.battlefield.push({ uid: s.nextUid++, id: card.id, tapped: false, sick: true, dmg: 0, pp: 0, pt: 0 });
        if (card.effect) resolveEffect(s, p, card.effect, undefined, lines);
      } else {
        resolveEffect(s, p, card.effect, action.target, lines);
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
      for (const x of me.battlefield) if (seen.has(x.uid)) x.tapped = true;
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
function resolveEffect(s, p, e, target, lines) {
  const me = s.players[p], opp = s.players[1 - p];
  switch (e.kind) {
    case 'damage':
      if (typeof target === 'string') s.players[+target.slice(1)].life -= e.amount;
      else { const x = opp.battlefield.find(y => y.uid === target); if (x) x.dmg += e.amount; }
      break;
    case 'draw':
      for (let i = 0; i < e.amount && !s.result; i++) drawCard(s, p, lines);
      break;
    case 'pump': {
      const x = me.battlefield.find(y => y.uid === target);
      if (x) { x.pp += e.amount; x.pt += e.amount; }
      break;
    }
    case 'heal':
      me.life += e.amount;
      break;
    case 'destroy': {
      const i = opp.battlefield.findIndex(y => y.uid === target);
      if (i >= 0) {
        const [x] = opp.battlefield.splice(i, 1);
        if (!CARD[x.id].token) opp.graveyard.push(x.id);
        if (lines) lines.push(`  ${CARD[x.id].name} is destroyed.`);
      }
      break;
    }
    case 'token':
      for (let i = 0; i < e.amount; i++) {
        me.battlefield.push({ uid: s.nextUid++, id: e.token, tapped: false, sick: !KW[e.token].swift, dmg: 0, pp: 0, pt: 0 });
      }
      break;
    default: throw new Error(`unknown effect ${e.kind}`);
  }
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
}

// Creatures with lethal damage (or marked by sting) leave the battlefield.
function sweep(s, lines, stung) {
  for (const pl of s.players) {
    let dead = false;
    for (const x of pl.battlefield) {
      if (isCreature(x) && (x.dmg >= toughness(x) || (stung && stung.has(x.uid)))) { dead = true; break; }
    }
    if (!dead) continue;
    const keep = [];
    for (const x of pl.battlefield) {
      if (isCreature(x) && (x.dmg >= toughness(x) || (stung && stung.has(x.uid)))) {
        if (!CARD[x.id].token) pl.graveyard.push(x.id);
        if (lines) lines.push(`  ${CARD[x.id].name} dies.`);
      } else keep.push(x);
    }
    pl.battlefield = keep;
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
function resolveCombat(s, blocks, lines) {
  const A = s.active, att = s.players[A], def = s.players[1 - A];
  const blockOf = new Map(blocks.map(q => [q[0], q[1]]));
  const stung = new Set();
  let toPlayer = 0;
  for (const u of s.combat.attackers) {
    const a = att.battlefield.find(x => x.uid === u);
    if (!a) continue;
    const pa = power(a);
    const bu = blockOf.get(u);
    if (bu === undefined) {
      if (pa > 0) {
        def.life -= pa; toPlayer += pa;
        if (KW[a.id].sap) att.life += pa;
      }
      continue;
    }
    const b = def.battlefield.find(x => x.uid === bu);
    const pb = power(b);
    if (pa > 0) {
      b.dmg += pa;
      if (KW[a.id].sting) stung.add(b.uid);
      if (KW[a.id].sap) att.life += pa;
    }
    if (pb > 0) {
      a.dmg += pb;
      if (KW[b.id].sting) stung.add(a.uid);
      if (KW[b.id].sap) def.life += pb;
    }
  }
  if (lines && toPlayer > 0) lines.push(`  ${pname(s, 1 - A)} takes ${toPlayer} damage (${def.life} life left).`);
  s.combat = null;
  sweep(s, lines, stung);
  checkLife(s, lines);
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

// ============================================================================
//  FLY DUEL  ·  play mode, human against fly  (ES module, no DOM, pure)
// ----------------------------------------------------------------------------
//  One game between the human seat (train/human.js) and a fly (or a bot)
//  on the Match of ui/match.js. The controller has no timers: the DOM
//  layer (ui/play/play.js) asks need(), waits as long as it wants (the
//  fly's think pause, the pause between turns), and calls flyStep() or
//  submit(). Node tests call the same functions with no wait.
//
//  FLOW
//      setup     createPlayController(...)  decks, seats, seed
//      coin      coin(call?) -> { first, won }   seeded, the winner goes first
//      mulligan  mulligan() shuffles the hand back and deals one card less
//                (7, then 6, then 5, floor 4). keep() starts the game.
//                The fly keeps by a fixed rule (flyKeeps: 2 to 5 lands in 7
//                cards), not by its brain. The page says so.
//      play      need() -> 'human' | 'fly' | 'over'
//                submit(action) for the human, flyStep() for the fly.
//      over      result { winner, reason }
//
//  Every decision makes one Match record (before, after, action, values,
//  trace, text). top3(rec) gives the fly's three best moves with values.
//  listeners: on(fn) gets { type: 'record' | 'start' | 'mulligan' | 'over',
//  ... }.
//
//  GREP MAP
//      grep -n 'export function createPlayController'
//      grep -n 'export function flyKeeps'      fixed keep rule
//      grep -n 'export function top3'          the fly's best moves
//      grep -n 'export function publicTop'     hide the hand in the top 3
//      grep -n 'export function deckColours'   colours of a deck
//      grep -n 'function redeal'               the mulligan deal
// ============================================================================
import { createHuman } from '../../train/human.js';
import { Match } from '../match.js';

// A small seeded generator (the same as ui/match.js), so the coin and the
// mulligan shuffle are the same on every machine.
function rng32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Colours of a deck, from its lands and its coloured costs, in the order
// they appear. deck: a DECKS entry { list: [[id, n]...] }.
export function deckColours(CARD, deck) {
  const out = [];
  const add = k => { if (k && k !== 'none' && k !== 'generic' && !out.includes(k)) out.push(k); };
  for (const [id] of deck?.list || []) {
    const c = CARD[id];
    if (!c) continue;
    if (c.type === 'land') for (const k of (Array.isArray(c.mana) ? c.mana : [c.produces || c.colour])) add(k);
  }
  for (const [id] of deck?.list || []) {
    const c = CARD[id];
    if (!c || c.type === 'land') continue;
    for (const k of Object.keys(c.cost || {})) if (k !== 'generic' && c.cost[k] > 0) add(k);
  }
  return out;
}

// The fly's keep rule: keep a hand with 2 to 5 lands. A hand of 5 or fewer
// cards is always kept.
export function flyKeeps(CARD, hand) {
  if (hand.length <= 5) return true;
  const lands = hand.filter(id => CARD[id]?.type === 'land').length;
  return lands >= 2 && lands <= 5;
}

// The three best moves of a fly decision record: [{ i, text, value, chosen }].
// Uses rec.scores (what the policy ranked) or rec.values.
export function top3(rules, rec, n = 3) {
  const sc = rec?.scores || rec?.values;
  if (!sc || !rec.legal) return [];
  const idx = sc.map((v, i) => i).filter(i => Number.isFinite(sc[i])).sort((a, b) => sc[b] - sc[a] || a - b).slice(0, n);
  if (rec.idx >= 0 && !idx.includes(rec.idx) && idx.length) idx[idx.length - 1] = rec.idx;
  return idx.map(i => {
    let text = rec.legal[i].type;
    try { text = rules.describe(rec.legal[i], rec.before); } catch { /* keep the type */ }
    return { i, text, value: sc[i], chosen: i === rec.idx };
  });
}

// The top-3 rows that you may see in play mode. A move that the fly did
// not make and that plays a card (a land or a spell) names a card in its
// hand, which is hidden information. That row shows HIDDEN_MOVE and keeps
// its value. The move that the fly made is public, so it keeps its text.
export const HIDDEN_MOVE = 'A card from its hand';
export function publicTop(top, legal) {
  return (top || []).map(t => {
    const a = legal?.[t.i];
    if (t.chosen || !a || (a.type !== 'land' && a.type !== 'cast')) return t;
    return { ...t, text: HIDDEN_MOVE, hidden: true };
  });
}

// opts:
//   rules        game/rules.js namespace
//   CARD         game/cards.js CARD
//   opponent     a ui/match.js agent (agentFromFly / agentFromBot)
//   humanSeat    0 | 1 (default 0)
//   humanName    'You'
//   decks        [deck of seat 0, deck of seat 1] (DECKS keys)
//   seed         uint
export function createPlayController(opts) {
  const { rules, CARD, opponent, humanSeat = 0, humanName = 'You', seed = 1 } = opts;
  const decks = opts.decks || ['amber', 'moss'];
  const human = createHuman({ name: humanName, rules });
  const agents = humanSeat === 0 ? [human, opponent] : [opponent, human];
  const names = agents.map(a => a.name);
  const flySeat = 1 - humanSeat;
  const listeners = new Set();
  const emit = e => { for (const f of listeners) { try { f(e); } catch (err) { console.warn('fly-duel play listener', err); } } };

  const match = new Match(rules, agents, { seed, decks, names });
  const rng = rng32((seed ^ 0x51ed270b) >>> 0);
  let phase = 'coin';                 // coin | mulligan | play | over
  let first = null;
  const mulls = [0, 0];
  let flyMulled = 0;

  function fresh(firstSeat) {
    match.reset(seed);
    match.state = rules.newGame({ seed, decks, first: firstSeat, names });
  }
  fresh(0);

  // The coin. call: 'heads' | 'tails' | undefined. The human wins on a
  // match. The winner goes first (no choice, as in a quick game).
  function coin(call) {
    if (phase !== 'coin') return { first, won: first === humanSeat };
    const side = rng() < 0.5 ? 'heads' : 'tails';
    const won = call ? call === side : rng() < 0.5;
    first = won ? humanSeat : flySeat;
    fresh(first);
    phase = 'mulligan';
    // the fly decides on its opening hand at once
    flyMulligans();
    emit({ type: 'coin', side, won, first });
    return { side, won, first };
  }

  // Shuffle the hand of a seat into the library and deal 7 - n cards.
  function redeal(seat) {
    const s = rules.clone(match.state);
    const p = s.players[seat];
    const all = shuffled(p.hand.concat(p.library), rng);
    const n = Math.max(4, 7 - mulls[seat]);
    p.hand = all.slice(0, n);
    p.library = all.slice(n);
    match.state = s;
  }

  function flyMulligans() {
    while (mulls[flySeat] < 3 && !flyKeeps(CARD, match.state.players[flySeat].hand)) {
      mulls[flySeat]++;
      redeal(flySeat);
      flyMulled++;
    }
  }

  function mulligan() {
    if (phase !== 'mulligan') return false;
    if (mulls[humanSeat] >= 3) return false;
    mulls[humanSeat]++;
    redeal(humanSeat);
    emit({ type: 'mulligan', seat: humanSeat, size: match.state.players[humanSeat].hand.length });
    return true;
  }

  function keep() {
    if (phase !== 'mulligan') return false;
    phase = 'play';
    // the log line of each mulligan, so the log tells the true story
    const s = rules.clone(match.state);
    for (const p of [0, 1]) if (mulls[p]) s.log.push(`${names[p]} ${names[p] === 'You' ? 'take' : 'takes'} ${mulls[p]} mulligan${mulls[p] > 1 ? 's' : ''} (${s.players[p].hand.length} cards).`);
    match.state = s;
    emit({ type: 'start', first: match.state.active });
    return true;
  }

  function need() {
    if (phase === 'coin' || phase === 'mulligan') return phase;
    if (match.over()) return 'over';
    return match.state.toAct === humanSeat ? 'human' : 'fly';
  }

  function after(rec) {
    if (!rec) return null;
    emit({ type: 'record', rec });
    if (match.over()) { phase = 'over'; emit({ type: 'over', result: match.result || rules.isOver(match.state) }); }
    return rec;
  }

  // The human acts. Returns { ok, rec?, error? }.
  function submit(action) {
    if (need() !== 'human') return { ok: false, error: 'not your decision' };
    const r = human.submit(action, match.state);
    if (!r.ok) return r;
    const rec = match.next();
    return { ok: true, rec: after(rec) };
  }

  // The fly acts. Returns the record (with top3 for the thinking panel).
  function flyStep() {
    if (need() !== 'fly') return null;
    const rec = match.next();
    if (rec) rec.top = publicTop(top3(rules, rec), rec.legal);
    return after(rec);
  }

  return {
    coin, mulligan, keep, need, submit, flyStep,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get state() { return match.state; },
    get history() { return match.history; },
    get result() { return match.result || rules.isOver(match.state); },
    get phase() { return phase; },
    get first() { return first; },
    get mulligans() { return mulls.slice(); },
    get flyMulligans() { return flyMulled; },
    humanSeat, flySeat, names, decks, match, human, opponent,
  };
}

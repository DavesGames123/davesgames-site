// ============================================================================
//  FLY DUEL  ·  baseline opponents  (ES module, no DOM, pure)
// ----------------------------------------------------------------------------
//  Two fixed players that the flies train against and that measure them.
//  Both have the shape (state, legal) -> action, where legal is
//  legalActions(state). Neither one learns.
//
//  randomBot(rng)  picks a legal action uniformly with the given rng.
//  greedyBot()     a short hand-written heuristic:
//      main    play a land first, then cast the card that most raises
//              boardScore one step ahead, then pass
//      attack  for each attack option, let the defender block with the
//              same greedy block rule, and keep the best boardScore
//      block   keep the block option with the best boardScore after damage
//  boardScore counts life, creatures (power and toughness with growth, a
//  small bonus per keyword and per trigger), cards in hand and lands (more
//  for the first five), and takes off points when the opposing creatures
//  could kill on the next attack (the crack-back risk). On its own main
//  phase it also counts opposing untapped creatures as a cost, so a tap
//  effect has value. Every effect of the five colours goes through step(),
//  so the bots need no rule of their own for a card.
//
//  Dice. step() rolls with the RNG in the state, so one step() call shows
//  the real roll. The greedy bot does not use it. When an action rolls
//  (the state RNG moves), the bot scores the mean of SAMPLES steps from
//  other RNG states that the real one does not give (expectedScore). That
//  is a sampled expected value, the same on every machine. Counters:
//  growth is in the stats (pc). A creature with a counter clock (tick)
//  gets a little value for each counter towards its effect, and loses
//  value for each counter towards its death.
//
//  EXPORTS   (jump with grep -n "<anchor>" game/bots.js)
//      boardScore ..... "export function boardScore"  heuristic, side me
//      randomBot ...... "export function randomBot"
//      greedyBot ...... "export function greedyBot"
//      expectedScore .. "export function expectedScore"  mean over rolls
// ============================================================================
import { CARD } from './cards.js';
import { step, legalActions, power, countersOf } from './rules.js';

const WIN = 1000;
export const SAMPLES = 8;

const KW_VALUE = { swift: 0.5, wings: 1.2, web: 0.5, sting: 1.2, thick: -0.5, sap: 0.6, lunge: 0.8, crush: 0.6, shell: 0.6, alert: 0.5 };

// Lasting value of a creature: base stats plus growth (pc), keywords and
// triggers. Pumps this turn are not counted.
function creatureValue(x) {
  const c = CARD[x.id];
  let v = Math.max(0, c.power + (x.pc || 0)) + c.toughness + (x.pc || 0);
  for (const k of c.keywords) v += KW_VALUE[k] ?? 0.5;
  if (c.onDeath) v += 1;
  if (c.onUpkeep) v += 1;
  const u = c.onUpkeep;
  if (u && u.kind === 'tick') {
    const n = countersOf(x, u.counter);
    if (u.amount > 0) v += (u.dies && !u.done ? -1 : 0.5) * n;
    else if (n > 0) v += 0.5 * (3 - Math.min(3, n));
  }
  return v;
}
const landValue = n => 0.8 * Math.min(n, 5) + 0.25 * Math.min(Math.max(n - 5, 0), 3);

export function boardScore(state, me) {
  if (state.result) return state.result.winner === me ? WIN : state.result.winner < 0 ? 0 : -WIN;
  const P = state.players[me], O = state.players[1 - me];
  let v = P.life - O.life;
  let lands = 0, oLands = 0;
  for (const x of P.battlefield) { if (CARD[x.id].type === 'land') lands++; else v += 1.5 * creatureValue(x); }
  for (const x of O.battlefield) { if (CARD[x.id].type === 'land') oLands++; else v -= 1.5 * creatureValue(x); }
  v += 0.5 * (P.hand.length - O.hand.length) + landValue(lands) - landValue(oLands);
  if (state.active === me && state.phase === 'main') {
    v -= 0.4 * O.battlefield.filter(x => CARD[x.id].type === 'creature' && !x.tapped).length;
  }
  // crack-back: opposing attackers that my untapped creatures cannot all stop
  if (state.active !== me || state.phase === 'block') {
    const oPow = O.battlefield.filter(x => CARD[x.id].type === 'creature' && !CARD[x.id].keywords.includes('thick'))
      .map(x => Math.max(0, power(x))).sort((a, b) => b - a);
    const blockers = P.battlefield.filter(x => CARD[x.id].type === 'creature' && !x.tapped).length;
    let through = 0;
    for (let i = blockers; i < oPow.length; i++) through += oPow[i];
    if (through >= P.life) v -= 200;
    else v -= 0.3 * through;
  }
  return v;
}

export function randomBot(rng) {
  return (state, legal) => legal[Math.floor(rng() * legal.length)];
}

function bestBy(legal, score) {
  let best = legal[0], bs = -Infinity;
  for (const a of legal) {
    const v = score(a);
    if (v > bs) { bs = v; best = a; }
  }
  return best;
}

// boardScore of fn(state) for player me. When fn rolls dice (the state
// RNG moves), the score is the mean over SAMPLES runs from other RNG
// states, so the real roll does not leak into the choice.
export function expectedScore(state, fn, me) {
  const s1 = fn(state);
  if (s1.rngState === state.rngState) return boardScore(s1, me);
  let t = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const alt = (Math.imul(i + 1, 0x9E3779B9) ^ state.rngState ^ 0x5bd1e995) >>> 0;
    t += boardScore(fn({ ...state, rngState: alt }), me);
  }
  return t / SAMPLES;
}

function greedyBlock(state, legal) {
  const me = state.toAct;
  return bestBy(legal, a => boardScore(step(state, a), me));
}

export function greedyBot() {
  return function greedy(state, legal) {
    const me = state.toAct;
    if (state.phase === 'main') {
      const land = legal.find(a => a.type === 'land');
      if (land) return land;
      const base = boardScore(state, me);
      let best = legal.find(a => a.type === 'pass') || legal[0], bs = 0.25;
      for (const a of legal) {
        if (a.type !== 'cast') continue;
        const d = expectedScore(state, s => step(s, a), me) - base;
        if (d > bs) { bs = d; best = a; }
      }
      return best;
    }
    if (state.phase === 'attack') {
      return bestBy(legal, a => expectedScore(state, s0 => {
        let s = step(s0, a);
        if (!s.result && s.phase === 'block') s = step(s, greedyBlock(s, legalActions(s)));
        return s;
      }, me));
    }
    if (state.phase === 'block') return bestBy(legal, a => expectedScore(state, s => step(s, a), me));
    return legal[0];
  };
}


// ============================================================================
//  FLY DUEL  ·  self-play and evaluation  (pure ES module, no DOM)
// ----------------------------------------------------------------------------
//  This module plays whole games between two players and counts results.
//  A player is a Fly (brain/fly.js: choose and observe), or a bot with
//  the shape (state, legal) -> action (game/bots.js), or one of the
//  strings 'random' and 'greedy'. tools/train.mjs, train/worker.js and
//  tests/train.test.mjs use this module. Everything is deterministic in
//  the seed.
//
//  SEATS AND DECKS.  playGame(p0, p1) puts p0 in seat 0 and p1 in seat 1.
//  Seat 0 gets decks[0]. The first player is opts.first. evaluate() and
//  matchup() rotate the seat, the deck and the first player over each
//  block of 8 games, so no fly gets an easy seat or deck.
//
//  LEARNING (way A of brain/agent.js).  When opts.learn is on, a learning
//  fly calls choose(.., { learn: true }) at each decision: that does one
//  TD step from its last afterstate to the new afterstate. At the end of
//  the game, observe(null, final, reward, true) gives the last TD step
//  to the final reward: +1 win, -1 loss, 0 draw (turn cap). opts.learn
//  can be true (all flies learn), false, or [bool, bool] per seat.
//
//  EXPLORATION.  opts.explore is the softmax temperature of the fly
//  policy (0 = the best value, ties to the first). opts.epsilon is the
//  chance of a uniform random move. Both can be one number or [n, n].
//
//  RESULT.  playGame returns { winner (seat, or -1 for a draw), reason,
//  turns, steps, decisions [seat0, seat1], log, frames? }. The log is the
//  game log text only when opts.log is on.
//
//  EXPORTS   (jump with grep -n "<anchor>" train/selfplay.js)
//      asPlayer ....... "export function asPlayer"   fly | bot | name -> player
//      FLY_OPTS ....... "export const FLY_OPTS"      options of new flies
//      TRAIN_MIX ...... "export const TRAIN_MIX"     opponent shares in training
//      trainGame ...... "export function trainGame"  one training game number g
//      playGame ....... "export function playGame"   one game
//      evaluate ....... "export function evaluate"   fly vs opponent, n games
//      matchup ........ "export function matchup"    fly A vs fly B, n games
//      gameSetup ...... "export function gameSetup"  seat, deck, first of game i
//      binomialP ...... "export function binomialP"  one-sided p of k wins in n
//      wilson ......... "export function wilson"     95 % interval of a rate
// ============================================================================
import { newGame, legalActions, step, isOver } from '../game/rules.js';
import { randomBot, greedyBot } from '../game/bots.js';
import { mulberry32, hashSeed } from '../data/rng.js';

const DECKS = ['amber', 'moss'];
const STEP_CAP = 20000;   // safety only: the rules end a game at TURN_CAP

const isFly = p => !!p && typeof p.choose === 'function';
const perSeat = (v, seat) => (Array.isArray(v) ? v[seat] : v);

// A fly, a bot function, 'random' or 'greedy' -> { kind, name, act, fly }.
// 'random' takes its rng from the seed, so a game is deterministic.
export function asPlayer(p, seed = 1) {
  if (isFly(p)) return { kind: 'fly', name: p.name || 'fly', fly: p };
  if (typeof p === 'function') return { kind: 'bot', name: p.name || 'bot', act: p };
  if (p === 'random') return { kind: 'bot', name: 'random', act: randomBot(mulberry32(hashSeed(`random-bot:${seed}`))) };
  if (p === 'greedy') return { kind: 'bot', name: 'greedy', act: greedyBot() };
  throw new Error(`selfplay: unknown player ${String(p)}`);
}

// Training defaults, shared by train/worker.js and tools/train.mjs.
// FLY_OPTS: options for new flies. imagine scores an attack by the
// worst opposing block (model step, see brain/agent.js).
export const FLY_OPTS = Object.freeze({ imagine: true });
// TRAIN_MIX: share of training games vs the random bot, vs the greedy
// bot, and fly A vs fly B.
/** @type {{ random: number, greedy: number, self: number }} */
export const TRAIN_MIX = Object.freeze({ random: 0.1, greedy: 0.3, self: 0.6 });
export const TRAIN_EXPLORE = 0.05;

// One training game number g. A fly vs fly game trains both flies. A bot
// game plays fly A and fly B against the bot, one game each. rng picks
// the opponent kind. Returns { kind, results: [{ fly: 'A'|'B', won }] }.
export function trainGame(A, B, g, rng, { mix = TRAIN_MIX, explore = TRAIN_EXPLORE, seed = 1 } = {}) {
  const x = rng(), r = mix.random || 0, gr = mix.greedy || 0;
  const kind = x < r ? 'random' : x < r + gr ? 'greedy' : 'self';
  const { seat, decks, first } = gameSetup(g);
  const gs = hashSeed(`train:${seed}:${g}`);
  const results = [];
  if (kind === 'self') {
    const pair = seat ? [B, A] : [A, B];
    const res = playGame(pair[0], pair[1], { seed: gs, decks, first, learn: true, explore });
    results.push({ fly: 'A', won: res.winner === seat ? 1 : res.winner === -1 ? 0.5 : 0, winner: res.winner === -1 ? -1 : res.winner === seat ? 'A' : 'B' });
  } else {
    for (const [name, F] of [['A', A], ['B', B]]) {
      const pair = seat ? [kind, F] : [F, kind];
      const res = playGame(pair[0], pair[1], { seed: hashSeed(`${name}:${gs}`), decks, first, learn: seat ? [false, true] : [true, false], explore });
      results.push({ fly: name, won: res.winner === seat ? 1 : res.winner === -1 ? 0.5 : 0 });
    }
  }
  return { kind, results };
}

// Seat of the subject fly, the decks and the first player for game i.
// The 8 combinations of (seat, deck, first) repeat every 8 games.
export function gameSetup(i) {
  const seat = i & 1, swap = (i >> 1) & 1, first = (i >> 2) & 1;
  const decks = swap ? [DECKS[1], DECKS[0]] : DECKS.slice();
  return { seat, decks, first };
}

// One game. p0 sits in seat 0, p1 in seat 1. opts: { seed, decks, first,
// learn, explore, epsilon, log, frames, onDecision }.
export function playGame(p0, p1, opts = {}) {
  const { seed = 1, decks = DECKS, first = 0, learn = false, explore = 0, epsilon = 0, log = false, frames = false, onDecision = null } = opts;
  const players = [asPlayer(p0, hashSeed(`p0:${seed}`)), asPlayer(p1, hashSeed(`p1:${seed}`))];
  if (players[0].kind === 'fly' && players[0].fly === players[1].fly) throw new Error('selfplay: one fly cannot sit in both seats');
  const rng = mulberry32(hashSeed(`explore:${seed}`));
  for (const p of players) if (p.kind === 'fly') p.fly.reset();
  let s = newGame({ seed: hashSeed(`game:${seed}`), decks, first, log });
  const decisions = [0, 0], out = frames ? [] : null;
  let steps = 0;
  while (!isOver(s) && steps < STEP_CAP) {
    const seat = s.toAct, p = players[seat];
    const legal = legalActions(s);
    if (!legal.length) throw new Error(`selfplay: no legal action at turn ${s.turn}, phase ${s.phase}`);
    let action, rec = null;
    if (p.kind === 'fly') {
      rec = p.fly.choose(s, legal, { explore: perSeat(explore, seat), epsilon: perSeat(epsilon, seat), learn: !!perSeat(learn, seat), rng, trace: !!frames });
      action = rec.action;
    } else action = p.act(s, legal);
    decisions[seat]++;
    if (out) out.push({ seat, turn: s.turn, phase: s.phase, action, values: rec ? rec.values : null, trace: rec ? rec.trace : null });
    if (onDecision) onDecision(s, action, seat, rec);
    s = step(s, action);
    steps++;
  }
  const over = isOver(s) || { winner: -1, reason: 'step cap' };
  for (let seat = 0; seat < 2; seat++) {
    const p = players[seat];
    if (p.kind !== 'fly') continue;
    const reward = over.winner === seat ? 1 : over.winner === -1 ? 0 : -1;
    // the end call learns only in way A with learn on; else it only resets
    if (perSeat(learn, seat)) p.fly.observe(null, s, reward, true);
    else p.fly.reset();
  }
  return { winner: over.winner, reason: over.reason, turns: s.turn, steps, decisions, log: log ? s.log.slice() : null, frames: out, final: s };
}

// fly vs opponent over n games, seats/decks/first rotated by gameSetup.
// opts: { explore = 0, epsilon = 0, learn = false }. Returns { n, wins,
// losses, draws, rate (wins / n), score ((wins + draws / 2) / n) }.
export function evaluate(fly, opponent, n = 200, seed = 1, opts = {}) {
  const { explore = 0, epsilon = 0, learn = false } = opts;
  let wins = 0, losses = 0, draws = 0, turns = 0;
  for (let i = 0; i < n; i++) {
    const { seat, decks, first } = gameSetup(i);
    const gs = hashSeed(`eval:${seed}:${i}`);
    const opp = typeof opponent === 'string' ? asPlayer(opponent, gs).act : opponent;
    const pair = seat === 0 ? [fly, opp] : [opp, fly];
    const ex = seat === 0 ? [explore, 0] : [0, explore];
    const ep = seat === 0 ? [epsilon, 0] : [0, epsilon];
    const ln = seat === 0 ? [learn, false] : [false, learn];
    const r = playGame(pair[0], pair[1], { seed: gs, decks, first, explore: ex, epsilon: ep, learn: ln });
    turns += r.turns;
    if (r.winner === seat) wins++; else if (r.winner === -1) draws++; else losses++;
  }
  return { n, wins, losses, draws, rate: wins / n, score: (wins + draws / 2) / n, meanTurns: turns / n };
}

// Fly A vs fly B over n games. Fly A changes seat each game. Neither
// learns unless opts.learn. Returns counts from fly A's side.
export function matchup(flyA, flyB, n = 200, seed = 1, opts = {}) {
  return evaluate(flyA, flyB, n, seed, opts);
}

// One-sided binomial test: P(X >= k) for X ~ Bin(n, p0). Log space, so
// it is exact for n up to many thousands.
export function binomialP(k, n, p0 = 0.5) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  const lp = Math.log(p0), lq = Math.log(1 - p0);
  let lgN = 0;
  const lf = [0];
  for (let i = 1; i <= n; i++) { lgN += Math.log(i); lf[i] = lgN; }
  let sum = 0;
  for (let i = k; i <= n; i++) sum += Math.exp(lf[n] - lf[i] - lf[n - i] + i * lp + (n - i) * lq);
  return Math.min(1, sum);
}

// Wilson score interval (95 %) for k successes in n.
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

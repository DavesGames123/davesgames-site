// ============================================================================
//  POOL PHYSICS  ·  core/netstate.js — the game state of an online game
// ----------------------------------------------------------------------------
//  An online game (online.js, worker/worker.js) sends the game state as a
//  snapshot: plain JSON with the rule state and the ball positions. JSON
//  keeps each float exactly, so the two pages hold the same numbers.
//
//    snapshot(G) ............ G -> JSON (balls at rest)
//    applySnapshot(G, s) .... write a snapshot into G in place (the 3D
//                             orientations of the balls stay)
//    gameOf(room, opts) ..... a game from a room state: a fresh rack from
//                             the seed when room.snap is null
//    freshSnap(room, T) ..... the snapshot of that fresh rack
//    computeShot(G, input) .. the shooter's outcome: a copy of G plays the
//                             shot (the same ticks as the live roll), the
//                             rules judge it -> { end, verdict }
//  The other page plays the shot again from the input with the same sim,
//  then sets G to `end`, so float differences between two browsers cannot
//  build up from shot to shot.
//
//  grep -n targets: "export function snapshot", "export function
//  applySnapshot", "export function gameOf", "export function computeShot"
// ============================================================================
import { newGame, judge, apply } from './rules.js';
import { rng } from './table.js';
import { beginShot, strike, tick, anyMoving, settle } from './physics.js';

export function snapshot(G) {
  const S = G.S;
  return {
    type: G.type, seed: G.seed, turn: G.turn, breaker: G.breaker, open: G.open, phase: G.phase,
    inHand: G.inHand, kitchen: G.kitchen, winner: G.winner, reason: G.reason || '', shots: G.shots,
    players: G.players.map(p => ({ group: p.group, potted: p.potted })),
    x: Array.from(S.x), y: Array.from(S.y), on: Array.from(S.on), pot: Array.from(S.pot),
    rack: (G.rack || []).map(b => [b.n, b.row]),
  };
}

export function applySnapshot(G, s) {
  const S = G.S;
  G.type = s.type; G.seed = s.seed; G.turn = s.turn; G.breaker = s.breaker; G.open = s.open; G.phase = s.phase;
  G.inHand = s.inHand; G.kitchen = s.kitchen; G.winner = s.winner; G.reason = s.reason; G.shots = s.shots;
  s.players.forEach((p, k) => { G.players[k].group = p.group; G.players[k].potted = p.potted; });
  for (let i = 0; i < 16; i++) {
    S.x[i] = s.x[i]; S.y[i] = s.y[i]; S.on[i] = s.on[i]; S.pot[i] = s.pot[i];
    S.vx[i] = S.vy[i] = S.wx[i] = S.wy[i] = S.wz[i] = 0;
  }
  S.potted = []; S.t = 0;
  G.rack = s.rack.map(([n, row]) => ({ n, row }));
  // the rng only racks again after an illegal break: seed it from the state
  G.r = rng(((s.seed * 7919) + (s.shots + 1) * 104729) >>> 0);
  return G;
}

export function gameOf(room, { T, names = ['Player 1', 'Player 2'], kinds = ['human', 'human'] } = {}) {
  const G = newGame({ type: room.type, seed: room.seed, T, names, kinds });
  if (room.snap) applySnapshot(G, room.snap);
  else { G.turn = G.breaker = room.breaker || 0; }
  return G;
}
export const freshSnap = (room, T) => snapshot(gameOf({ type: room.type, seed: room.seed, breaker: room.breaker, snap: null }, { T }));

// A short verdict for the message on both pages (core/rules.js judge).
export function verdictOf(v) {
  return { foul: !!v.foul, why: v.why || '', keep: !!v.keep, win: !!v.win, lose: !!v.lose, scratch: !!v.scratch, potted: (v.potted || []).slice() };
}

// Play a shot on G.S with the live loop of main.js stepRoll: beginShot with
// the log, strike, tick until no ball moves, settle.
export function rollOut(G, input, maxT = 120) {
  const S = G.S;
  if (input.place) { S.x[0] = input.place.x; S.y[0] = input.place.y; S.on[0] = 1; }
  beginShot(S, { log: true });
  strike(S, 0, input);
  const maxN = Math.ceil(maxT / S.P.h);
  for (let n = 0; n < maxN; n++) { tick(S); if (!anyMoving(S)) break; }
  settle(S);
  return G;
}

export function computeShot(G, input) {
  const H = newGame({ type: G.type, seed: G.seed, T: G.T, names: G.players.map(p => p.name), kinds: G.players.map(p => p.kind) });
  applySnapshot(H, snapshot(G));
  rollOut(H, input);
  const v = judge(H, { ball: input.n, pocket: input.pocket });
  apply(H, v);
  return { end: snapshot(H), verdict: verdictOf(v) };
}

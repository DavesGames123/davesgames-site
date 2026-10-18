// ============================================================================
//  POOL PHYSICS  ·  tests/ai.test.mjs — the computer plays whole games
// ----------------------------------------------------------------------------
//  Seeded games with no display: plan, shoot, judge, apply (core/ai.js
//  autoTurn). It reports the pot rate of called pots, fouls, shots per
//  game and the winners, for 8-ball and 9-ball at "Near perfect", and a
//  check that the "Club" level misses more.
// ============================================================================
import { ok, done } from './util.mjs';
import { newGame } from '../core/rules.js';
import { autoTurn } from '../core/ai.js';

function play(type, seeds, skill) {
  const t = { games: 0, over: 0, shots: 0, pots: 0, tries: 0, fouls: 0, wins: [0, 0], kinds: {}, maxShots: 0, ms: 0 };
  for (const seed of seeds) {
    const G = newGame({ type, seed });
    const t0 = Date.now();
    let n = 0;
    while (G.phase !== 'over' && n < 120) {
      const r = autoTurn(G, { skill });
      n++;
      t.kinds[r.plan.kind] = (t.kinds[r.plan.kind] || 0) + 1;
      if (r.plan.kind === 'pot') { t.tries++; if (r.potted.includes(r.plan.n)) t.pots++; }
      if (r.verdict.foul) t.fouls++;
    }
    t.ms += Date.now() - t0;
    t.games++; t.shots += n; t.maxShots = Math.max(t.maxShots, n);
    if (G.phase === 'over') { t.over++; t.wins[G.winner]++; }
  }
  t.rate = t.pots / Math.max(1, t.tries);
  return t;
}
const line = t => `${t.games} games, ${t.over} finished, ${t.shots} shots (max ${t.maxShots} in a game), called pots ${t.pots}/${t.tries} = ${(100 * t.rate).toFixed(1)} %, fouls ${t.fouls}, wins ${t.wins.join(':')}, shot kinds ${JSON.stringify(t.kinds)}, ${(t.ms / t.shots).toFixed(0)} ms per shot`;

const e8 = play('8', [11, 22, 33, 44, 55, 66, 77, 88], 'perfect');
ok(e8.over === e8.games && e8.rate >= 0.9 && e8.fouls <= 0.1 * e8.shots, '8-ball, near perfect: every game ends, 90 % or more of the called pots fall, few fouls', line(e8));
const e9 = play('9', [12, 23, 34, 45], 'perfect');
ok(e9.over === e9.games && e9.rate >= 0.9, '9-ball, near perfect: every game ends, 90 % or more of the called pots fall', line(e9));
const c8 = play('8', [11, 22, 33], 'club');
ok(c8.rate < e8.rate, 'skill: the club player misses more than the near perfect one', line(c8));
done();

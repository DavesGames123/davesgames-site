// ============================================================================
//  POOL PHYSICS  ·  tests/ai.test.mjs — the computer plays whole games
// ----------------------------------------------------------------------------
//  Seeded games with no display: plan, shoot, judge, apply (core/ai.js
//  autoTurn). It reports the pot rate of called pots, fouls, shots per
//  game and the winners, for 8-ball and 9-ball at "Near perfect", and a
//  check that the "Club" level misses more.
//  Flair (the user: "occasionally takes bank shots that would look very
//  cool"): at the saver's flair 0.9, banks, kick pots and combinations are
//  10 % to 60 % of the shots after the break, and most of them fall.
//  Stroke error: every plan carries the aimed stroke (plan.ideal) and the
//  error (plan.err); the struck aim is the aimed one plus delta phi, the
//  spread matches the skill, and the maths step "stroke" reports it.
// ============================================================================
import { ok, done } from './util.mjs';
import { newGame } from '../core/rules.js';
import { autoTurn, SKILLS } from '../core/ai.js';
import { predict, mathsOf } from '../core/shot.js';

function play(type, seeds, skill, flair = 0, each = null) {
  const t = { games: 0, over: 0, shots: 0, pots: 0, tries: 0, fouls: 0, wins: [0, 0], kinds: {}, maxShots: 0, ms: 0 };
  for (const seed of seeds) {
    const G = newGame({ type, seed });
    const t0 = Date.now();
    let n = 0;
    while (G.phase !== 'over' && n < 120) {
      if (each) each(G, 'before');
      const r = autoTurn(G, { skill, flair });
      if (each) each(G, r);
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

// flair: banks, kick pots and combinations at the saver's flair
{
  const fancy = new Set(['bank', 'kickpot', 'combo']);
  let shots = 0, fx = 0, fxIn = 0;
  const f = (G, r) => { if (r === 'before' || r.plan.kind === 'break') return; shots++; if (fancy.has(r.plan.kind)) { fx++; if (r.potted.includes(r.plan.n)) fxIn++; } };
  const t8 = play('8', [11, 22, 33, 44], 'perfect', 0.9, f), t9 = play('9', [11, 22, 33, 44], 'perfect', 0.9, f);
  const share = fx / Math.max(1, shots);
  ok(share >= 0.1 && share <= 0.6 && fxIn >= 0.5 * fx, 'flair 0.9: 10 % to 60 % of the shots after the break are banks, kick pots or combinations, and half or more of them fall',
    `${fx} of ${shots} shots = ${(100 * share).toFixed(1)} %, ${fxIn} fell; kinds 8-ball ${JSON.stringify(t8.kinds)}, 9-ball ${JSON.stringify(t9.kinds)}`);
}

// the stroke error: aimed vs observed
{
  const errs = [], bad = [];
  let stepOk = 0, stepN = 0, differ = 0;
  const f = (G, r) => {
    if (r !== 'before') return;
    // plan once more on a copy of the turn to read the plan before autoTurn shoots it
  };
  for (const seed of [5, 6, 7]) {
    const G = newGame({ type: '8', seed });
    for (let k = 0; k < 8 && G.phase !== 'over'; k++) {
      const Gs = { S: G.S };
      const r = autoTurn(Object.assign(G, {}), { skill: 'pro' });
      const p = r.plan;
      if (!p.err || !p.ideal) { bad.push('no err'); continue; }
      const d = Math.abs(p.phi - p.ideal.phi - p.err.dphi);
      if (d > 1e-12) bad.push(`phi ${d}`);
      if (Math.abs(p.v - p.ideal.v - p.err.dv) > 1e-12) bad.push('v');
      errs.push(p.err.dphi);
    }
  }
  const sd = Math.sqrt(errs.reduce((a, x) => a + x * x, 0) / errs.length), want = SKILLS.pro.aim;
  ok(!bad.length && errs.length >= 15 && sd > 0.4 * want && sd < 2 * want, 'stroke error: every plan has the aimed stroke and delta phi; struck = aimed + delta phi; the spread fits the skill',
    `${errs.length} plans, rms delta phi ${(sd * 180 / Math.PI).toFixed(3)} deg (Pro sigma ${(want * 180 / Math.PI).toFixed(2)} deg)${bad.length ? ', ' + bad.slice(0, 3).join(' ') : ''}`);
  // the maths reports it, and the physics plays the observed stroke
  for (const seed of [8, 9]) {
    const G = newGame({ type: '9', seed });
    for (let k = 0; k < 6 && G.phase !== 'over'; k++) {
      const { plan } = await import('../core/ai.js');
      const p = plan(G, { skill: 'club' });
      const pred = predict(G.S, p), predAim = predict(G.S, Object.assign({}, p, p.ideal));
      const st = mathsOf(G.T, G.S, p, pred, p.chosen || null).find(x => x.id === 'stroke');
      stepN++;
      if (st && Math.abs(st.val.dphi - p.err.dphi * 180 / Math.PI) < 1e-9 && st.at === 0 && /Δφ/.test(st.draw[0].label)) stepOk++;
      if (pred.paths[0].join() !== predAim.paths[0].join()) differ++;
      autoTurn(G, { skill: 'club' });
    }
  }
  ok(stepN >= 8 && stepOk === stepN && differ === stepN, 'stroke error: the maths step "stroke" shows delta phi at the strike, and the observed path differs from the aimed one',
    `${stepOk} of ${stepN} steps, ${differ} paths differ`);
}
done();

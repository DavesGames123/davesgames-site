// ============================================================================
//  FLY DUEL  ·  node tests for training  (node tests/train.test.mjs)
// ----------------------------------------------------------------------------
//  Checks train/selfplay.js, train/worker.js, tools/train.mjs and the two
//  files that the pretraining run wrote. All games use the real rules
//  (game/) and the real wiring (data/connectome.json). Checks:
//    1. playGame ends, is deterministic in the seed, does not share one
//       fly between seats, and gameSetup rotates seat, deck and first.
//    2. binomialP and wilson give known values.
//    3. A short training run is deterministic (same weights twice).
//    4. Learning helps: over 3 seeds, a fly that trained 200 games vs
//       the random bot wins more often vs the random bot than its naive
//       self (mean over the seeds, same eval games).
//    5. data/pretrained.json loads and beats the random bot over 100 new
//       games at p < 0.05 (one-sided binomial test against a coin flip).
//    6. data/training-curve.json has the shape the page reads, and its
//       rates agree with its own counts.
//    7. The worker protocol through createTrainer and a fake post, and
//       the worker glue in a fake worker scope.
//    8. tools/train.mjs run() twice with a tiny budget writes the same
//       weights.
//  Exit code 1 on any failure.
// ============================================================================
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mulberry32, hashSeed } from '../data/rng.js';
import { makePair, Fly } from '../brain/fly.js';
import { playGame, evaluate, gameSetup, binomialP, wilson, trainGame, asPlayer, FLY_OPTS } from '../train/selfplay.js';
import { createTrainer } from '../train/worker.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const C = JSON.parse(readFileSync(join(ROOT, 'data/connectome.json'), 'utf8'));
const t0 = performance.now();

// ---------------------------------------------------------------- 1 games
{
  const a = playGame('greedy', 'random', { seed: 11, log: true });
  const b = playGame('greedy', 'random', { seed: 11, log: true });
  ok(a.winner === b.winner && a.steps === b.steps && a.log.join('\n') === b.log.join('\n'), 'playGame: same seed, same game');
  ok([0, 1, -1].includes(a.winner) && a.steps > 0 && a.turns >= 1, `playGame: ends with a winner (${a.winner}, ${a.steps} steps)`);
  const c = playGame('random', 'random', { seed: 12 });
  ok(c.log === null && c.frames === null, 'playGame: no log or frames unless asked');
  const [A, B] = makePair(C, FLY_OPTS);
  let threw = false;
  try { playGame(A, A, { seed: 1 }); } catch { threw = true; }
  ok(threw, 'playGame: one fly cannot sit in both seats');
  const f = playGame(A, B, { seed: 3, frames: true });
  ok(f.frames.length === f.steps && f.frames.every(x => x.trace && Array.isArray(x.values)), 'playGame: frames carry the brain trace and values of each fly decision');
  const wA = Float32Array.from(A.mb.w), g1 = playGame(A, 'random', { seed: 4, learn: false });
  ok(A.mb.w.every((x, i) => x === wA[i]), 'playGame: learn off leaves the weights as they were');
  playGame(A, 'random', { seed: 4, learn: [true, false], explore: 0.05 });
  ok(A.mb.w.some((x, i) => x !== wA[i]), 'playGame: learn on changes the weights');
  ok(g1.decisions[0] > 0 && g1.decisions[1] > 0, 'playGame: both seats decide');
  const combos = new Set(Array.from({ length: 8 }, (_, i) => { const s = gameSetup(i); return `${s.seat}${s.decks[0]}${s.first}`; }));
  ok(combos.size === 8, 'gameSetup: 8 games cover every seat, deck and first player');
  const e = evaluate('greedy', 'random', 16, 5);
  ok(e.wins + e.losses + e.draws === 16 && near(e.rate, e.wins / 16, 1e-12), `evaluate: counts add up (${e.wins}/${e.losses}/${e.draws})`);
  ok(e.rate >= 0.8, `evaluate: greedy bot beats random bot (${e.rate})`);
  let bad = false;
  try { asPlayer('nobody'); } catch { bad = true; }
  ok(bad, 'asPlayer: an unknown name throws');
}

// ---------------------------------------------------------------- 1b fly options
// FLY_OPTS: graded KC code, sparsity inside the published 5-10 % band.
{
  const [A] = makePair(C, { ...FLY_OPTS, seed: 4 });
  ok(FLY_OPTS.kcCode === 'graded' && A.mb.graded, 'FLY_OPTS: new flies use the graded KC code');
  ok(FLY_OPTS.sparsity >= 0.05 && FLY_OPTS.sparsity <= 0.1 && A.mb.k === Math.round(FLY_OPTS.sparsity * A.mb.nLive), `FLY_OPTS: sparsity ${FLY_OPTS.sparsity} in the 5-10 % band, k = ${A.mb.k}`);
  const j = JSON.parse(JSON.stringify(A)), A2 = Fly.fromJSON(C, j);
  ok(A2.mb.graded && A2.mb.k === A.mb.k, 'FLY_OPTS: a saved fly keeps its code and sparsity');
}

// ---------------------------------------------------------------- 2 stats
{
  ok(near(binomialP(60, 100), 0.0284, 0.0005), `binomialP(60, 100) = 0.0284 (${binomialP(60, 100).toFixed(4)})`);
  ok(near(binomialP(50, 100), 0.5398, 0.0005), `binomialP(50, 100) = 0.5398 (${binomialP(50, 100).toFixed(4)})`);
  ok(binomialP(0, 10) === 1 && binomialP(11, 10) === 0, 'binomialP: edge cases');
  const w = wilson(50, 100);
  ok(near(w[0], 0.4038, 0.001) && near(w[1], 0.5962, 0.001), `wilson(50, 100) = [0.404, 0.596] (${w.map(x => x.toFixed(3))})`);
}

// ---------------------------------------------------------------- 3 determinism
{
  const runOnce = () => {
    const [A, B] = makePair(C, { ...FLY_OPTS, seed: 3 });
    const rng = mulberry32(hashSeed('det'));
    const kinds = [];
    for (let g = 0; g < 12; g++) kinds.push(trainGame(A, B, g, rng, { mix: { random: 0.3, greedy: 0.3, self: 0.4 }, seed: 9 }).kind);
    return { a: A.toJSON().mb.w, b: B.toJSON().mb.w, kinds: kinds.join(',') };
  };
  const r1 = runOnce(), r2 = runOnce();
  ok(r1.a === r2.a && r1.b === r2.b && r1.kinds === r2.kinds, `trainGame: 12 mixed games twice give the same weights (${r1.kinds})`);
  ok(new Set(r1.kinds.split(',')).size === 3, 'trainGame: the mix picks all three opponent kinds');
}

// ---------------------------------------------------------------- 4 learning helps
{
  const N_EVAL = 100, N_TRAIN = 200;
  const before = [], after = [];
  for (const seed of [1, 2, 3]) {
    const [A] = makePair(C, { ...FLY_OPTS, seed });
    const evSeed = hashSeed(`learn-eval:${seed}`);
    before.push(evaluate(A, 'random', N_EVAL, evSeed).rate);
    for (let g = 0; g < N_TRAIN; g++) {
      const { seat, decks, first } = gameSetup(g);
      const pair = seat ? ['random', A] : [A, 'random'];
      playGame(pair[0], pair[1], { seed: hashSeed(`learn:${seed}:${g}`), decks, first, learn: seat ? [false, true] : [true, false], explore: 0.05 });
    }
    after.push(evaluate(A, 'random', N_EVAL, evSeed).rate);
  }
  const mb = before.reduce((a, b) => a + b) / 3, ma = after.reduce((a, b) => a + b) / 3;
  console.log(`  learning: vs random before ${before.join(' ')} (mean ${mb.toFixed(3)}), after ${N_TRAIN} games ${after.join(' ')} (mean ${ma.toFixed(3)})`);
  ok(ma > mb + 0.1, `learning: mean win rate vs random rises by more than 0.1 after ${N_TRAIN} games (${mb.toFixed(3)} -> ${ma.toFixed(3)})`);
}

// ---------------------------------------------------------------- 5 pretrained
const PRE = join(ROOT, 'data/pretrained.json'), CUR = join(ROOT, 'data/training-curve.json');
ok(existsSync(PRE), 'data/pretrained.json exists');
if (existsSync(PRE)) {
  const pre = JSON.parse(readFileSync(PRE, 'utf8'));
  const size = readFileSync(PRE).length;
  ok(size < 2 * 1024 * 1024, `pretrained.json is under 2 MB (${(size / 1024).toFixed(0)} KB)`);
  let A = null, B = null;
  try { A = Fly.fromJSON(C, pre.A); B = Fly.fromJSON(C, pre.B); } catch (e) { ok(false, `pretrained.json loads (${e.message})`); }
  ok(A && B && A.mb.hemisphere === 'A' && B.mb.hemisphere === 'B', 'pretrained.json: fly A and fly B load on the real wiring');
  if (A && B) {
    const seed = hashSeed('pretrained-test');
    for (const [name, F] of [['A', A], ['B', B]]) {
      const e = evaluate(F, 'random', 100, seed);
      const p = binomialP(e.wins, 100, 0.5);
      console.log(`  pretrained fly ${name} vs random: ${e.wins}/100 wins, ${e.draws} draws, p = ${p.toExponential(2)}`);
      ok(p < 0.05, `pretrained fly ${name} beats the random bot at p < 0.05 (${e.wins}/100, p = ${p.toExponential(2)})`);
    }
    const n = new Fly(C, { ...FLY_OPTS, name: 'naive', hemisphere: 'A', seed: 1 });
    ok(n.mb.w.some((x, i) => x !== A.mb.w[i]), 'pretrained fly A has learned weights (not the naive ones)');
  }
}

// ---------------------------------------------------------------- 6 curve
ok(existsSync(CUR), 'data/training-curve.json exists');
if (existsSync(CUR)) {
  const cur = JSON.parse(readFileSync(CUR, 'utf8'));
  const rows = cur.checkpoints || [];
  ok(rows.length >= 3, `curve: ${rows.length} checkpoints`);
  ok(rows.every((r, i) => i === 0 || r.games > rows[i - 1].games) && rows[0].games === 0, 'curve: games rise from 0');
  const rates = r => [r.vsRandom.A, r.vsRandom.B, r.vsGreedy.A, r.vsGreedy.B, r.AvsB];
  ok(rows.every(r => rates(r).every(x => x >= 0 && x <= 1)), 'curve: every rate in [0, 1]');
  let agree = true;
  for (const r of rows) {
    const c = r.counts, nn = c.rA[0] + c.rA[1] + c.rA[2];
    const pairs = [[c.rA, r.vsRandom.A], [c.rB, r.vsRandom.B], [c.gA, r.vsGreedy.A], [c.gB, r.vsGreedy.B], [c.ab, r.AvsB]];
    for (const [w, x] of pairs) if (w[0] + w[1] + w[2] !== nn || !near(w[0] / nn, x, 0.0006)) agree = false;
  }
  ok(agree, 'curve: each rate equals wins / games of its counts');
  const m = cur.meta || {};
  ok(/^node tools\/train\.mjs/.test(m.command || '') && Number.isFinite(m.seed) && m.wallSeconds > 0, `curve meta: command, seed and wall time (${m.command}, ${m.wallSeconds} s)`);
  const f = m.final;
  ok(f && f.vsRandom.A.n > 0 && f.vsGreedy.B.n > 0 && Array.isArray(f.AvsB.ci95), 'curve meta: held-out final evaluation with intervals');
  if (f && existsSync(PRE)) {
    const pre = JSON.parse(readFileSync(PRE, 'utf8'));
    ok(pre.meta && pre.meta.games === f.games, `pretrained.json is the kept checkpoint of the curve (games ${pre.meta && pre.meta.games})`);
  }
}

// ---------------------------------------------------------------- 7 worker
{
  const out = [], queue = [];
  const T = createTrainer(m => out.push(m), fn => queue.push(fn));
  const drain = () => { let n = 0; while (queue.length && n++ < 10000) queue.shift()(); };
  T.handle({ cmd: 'train', games: 3 });
  ok(out.at(-1)?.type === 'error', 'worker: train before init posts an error');
  T.handle({ cmd: 'init', connectome: C });
  ok(out.at(-1)?.type === 'ready' && out.at(-1).trained === false, 'worker: init posts ready (naive)');
  T.handle({ cmd: 'train', games: 12 });
  drain();
  const prog = out.filter(m => m.type === 'progress'), wts = out.filter(m => m.type === 'weights');
  ok(prog.length === 1 && prog[0].game === 10, `worker: one progress message per 10 games (${prog.map(p => p.game)})`);
  ok(prog[0] && 'winRateA' in prog[0] && 'A' in prog[0].vsRandom && 'B' in prog[0].vsGreedy, 'worker: progress has winRateA, vsRandom and vsGreedy');
  ok(wts.length === 1 && wts[0].game === 12 && wts[0].A.format === 'fly-duel-fly/1' && wts[0].B.format === 'fly-duel-fly/1', 'worker: weights after the batch, as Fly JSON');
  // pause in the middle of a batch
  T.handle({ cmd: 'train', games: 50 });
  queue.shift()();                       // one slice
  T.handle({ cmd: 'pause' });
  drain();
  const paused = out.filter(m => m.type === 'paused');
  ok(paused.length === 1 && paused[0].game < 62 && paused[0].game > 12, `worker: pause stops the batch (at game ${paused[0] && paused[0].game})`);
  ok(out.filter(m => m.type === 'weights').length === 1, 'worker: a paused batch posts no weights');
  T.handle({ cmd: 'eval', n: 4 });
  const ev = out.at(-1);
  ok(ev.type === 'eval' && ev.n === 4 && [ev.vsRandom.A, ev.vsRandom.B, ev.vsGreedy.A, ev.vsGreedy.B, ev.AvsB].every(x => x >= 0 && x <= 1), 'worker: eval posts rates in [0, 1]');
  ok(ev.counts && ev.counts.rA.reduce((a, b) => a + b) === 4, 'worker: eval counts add up');
  // reload from saved weights
  const w = wts[0];
  T.handle({ cmd: 'init', connectome: C, weights: { A: w.A, B: w.B } });
  ok(out.at(-1).type === 'ready' && out.at(-1).trained === true, 'worker: init with weights loads them');
  ok(T.state.A.toJSON().mb.w === w.A.mb.w, 'worker: loaded weights are the posted weights');
  // same messages, same weights
  const run = () => { const o = [], q = []; const t = createTrainer(m => o.push(m), fn => q.push(fn)); t.handle({ cmd: 'init', connectome: C }); t.handle({ cmd: 'train', games: 6 }); while (q.length) q.shift()(); return o.at(-1).A.mb.w; };
  ok(run() === run(), 'worker: deterministic for the same messages');
  // the glue, in a fake worker scope
  const posted = [];
  globalThis.self = { postMessage: m => posted.push(m) };
  await import(pathToFileURL(join(ROOT, 'train/worker.js')).href + '?glue');
  ok(typeof globalThis.self.onmessage === 'function', 'worker glue: sets self.onmessage');
  globalThis.self.onmessage({ data: { cmd: 'pause' } });
  ok(posted.at(-1)?.type === 'paused', 'worker glue: a message gets an answer through self.postMessage');
  delete globalThis.self;
}

// ---------------------------------------------------------------- 8 train.mjs
{
  const { run } = await import(pathToFileURL(join(ROOT, 'tools/train.mjs')).href);
  const d1 = mkdtempSync(join(tmpdir(), 'fly-duel-train-')), d2 = mkdtempSync(join(tmpdir(), 'fly-duel-train-'));
  try {
    const o = { games: 20, every: 10, eval: 4, final: 4, curriculum: 10, seed: 5, quiet: true };
    run({ ...o, out: d1 }); run({ ...o, out: d2 });
    const p1 = JSON.parse(readFileSync(join(d1, 'pretrained.json'), 'utf8')), p2 = JSON.parse(readFileSync(join(d2, 'pretrained.json'), 'utf8'));
    ok(p1.A.mb.w === p2.A.mb.w && p1.B.mb.w === p2.B.mb.w, 'train.mjs: two tiny runs with one seed write the same weights');
    const c1 = JSON.parse(readFileSync(join(d1, 'training-curve.json'), 'utf8'));
    ok(c1.checkpoints.length === 3 && c1.meta.command.includes('--seed 5'), `train.mjs: 3 checkpoints and the command in meta (${c1.meta.command})`);
  } finally { rmSync(d1, { recursive: true, force: true }); rmSync(d2, { recursive: true, force: true }); }
}

console.log(`train: ${pass} pass, ${fail} fail (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);

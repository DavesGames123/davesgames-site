#!/usr/bin/env node
// ============================================================================
//  FLY DUEL  ·  offline pretraining  (node script)
// ----------------------------------------------------------------------------
//  This script trains fly A and fly B from naive weights on the real
//  connectomes, measures them at checkpoints, and writes two files:
//      data/pretrained.json      both flies (Fly JSON, brain/agent.js)
//      data/training-curve.json  one row per checkpoint, plus meta
//  The page (main.js) loads both files. Every rate in the files is a
//  count of games that this script played. Nothing is estimated.
//
//  RUN (from the page folder)
//      node tools/train.mjs                      the full run (about 20 min)
//      node tools/train.mjs --games 400 --every 200 --eval 40 --final 100 \
//           --out /tmp/x                         a short run (tests use this)
//      --wiring two   fly A on the hemibrain MB, fly B on the FlyWire MB
//                     (WIRING of train/selfplay.js; the default when
//                     data/connectome-flywire.json is there)
//      --wiring one   both flies on data/connectome.json (the old setup)
//
//  WIRING.  Each fly has its own connectome file. The files go into
//  pretrained.json ("wiring": file, release, counts of each fly) and
//  into the curve meta. A reader must load fly B on the file of fly B,
//  because MushroomBody.fromJSON refuses a different wiring.
//
//  TRAINING.  trainGame() of train/selfplay.js, game numbers 0..games-1.
//  Each game number picks one opponent kind from the mix of its stage:
//  a bot game trains fly A and fly B, one game each, against the bot. A
//  fly vs fly game trains both flies. Exploration: softmax at 0.05.
//      stage 1, games [0, curriculum):  CURRICULUM_MIX (easy opponents)
//      stage 2, the rest:               TRAIN_MIX (mostly fly vs fly)
//
//  CHECKPOINTS.  Every --every games (and at 0): each fly vs the random
//  bot and vs the greedy bot, and fly A vs fly B, --eval games each,
//  greedy play (explore 0), no learning, seats, decks and first player
//  rotated (gameSetup). The eval seed is the same at each checkpoint.
//
//  SHIPPED WEIGHTS.  The script keeps the checkpoint with the best sum of
//  the two greedy-bot rates (a selection on the checkpoint games). Then
//  it measures the kept flies again on --final new games per opponent,
//  with a different seed (held out). meta.final holds those held-out
//  numbers, with 95 % Wilson intervals and a one-sided binomial p
//  against a coin flip. Use the held-out numbers on the page, because
//  the selection makes the checkpoint numbers a little optimistic.
//
//  GREP MAP   (grep -n "<anchor>" tools/train.mjs)
//      args ........... "function args"
//      wiring ......... "function loadWiring"
//      CURRICULUM_MIX . "const CURRICULUM_MIX"
//      checkpoint ..... "function checkpoint"
//      main loop ...... "for (let g = 0"
//      held-out eval .. "held-out"
//      write files .... "writeFileSync"
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fly } from '../brain/fly.js';
import { evaluate, trainGame, wilson, binomialP, TRAIN_MIX, FLY_OPTS, TRAIN_EXPLORE, WIRING } from '../train/selfplay.js';
import { mulberry32, hashSeed } from '../data/rng.js';
import { greedyBot } from '../game/bots.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CURRICULUM_MIX = Object.freeze({ random: 0.5, greedy: 0, self: 0.5 });

function args(argv) {
  const o = { games: 20000, every: 1000, eval: 200, final: 1000, curriculum: 1000, seed: 2026, out: join(ROOT, 'data'), quiet: false, wiring: '' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'quiet') { o.quiet = true; continue; }
    const v = argv[++i];
    if (!(k in o)) throw new Error(`train.mjs: unknown option --${k}`);
    o[k] = k === 'out' ? resolve(v) : k === 'wiring' ? v : Number(v);
  }
  return o;
}

// 'two': each fly on its WIRING file. 'one': both on data/connectome.json.
// The default is 'two' when the FlyWire file is there. Returns the two
// connectomes and the record that goes into the output files.
function loadWiring(mode) {
  const m = mode || (existsSync(join(ROOT, WIRING.B.file)) ? 'two' : 'one');
  if (m !== 'one' && m !== 'two') throw new Error(`train.mjs: --wiring is 'one' or 'two', not ${m}`);
  const files = m === 'two' ? { A: WIRING.A.file, B: WIRING.B.file } : { A: WIRING.A.file, B: WIRING.A.file };
  const C = { A: JSON.parse(readFileSync(join(ROOT, files.A), 'utf8')) };
  C.B = files.B === files.A ? C.A : JSON.parse(readFileSync(join(ROOT, files.B), 'utf8'));
  const rec = side => ({ id: m === 'two' ? WIRING[side].id : WIRING.A.id, file: files[side], release: C[side].meta?.release || '', licence: C[side].meta?.licence || '',
                         pn: C[side].pn.n, kc: C[side].kc.n, mbon: C[side].mbon.n, dan: C[side].dan.n });
  return { mode: m, C, record: { mode: m, A: rec('A'), B: rec('B') } };
}

const rate3 = r => Math.round(r * 1000) / 1000;

// Each fly vs both bots, and A vs B, n games each, same seed every time.
function checkpoint(A, B, n, seed) {
  const r = { rA: evaluate(A, 'random', n, seed), rB: evaluate(B, 'random', n, seed),
              gA: evaluate(A, 'greedy', n, seed), gB: evaluate(B, 'greedy', n, seed),
              ab: evaluate(A, B, n, seed) };
  return {
    vsRandom: { A: rate3(r.rA.rate), B: rate3(r.rB.rate) },
    vsGreedy: { A: rate3(r.gA.rate), B: rate3(r.gB.rate) },
    AvsB: rate3(r.ab.rate),
    counts: Object.fromEntries(Object.entries(r).map(([k, e]) => [k, [e.wins, e.losses, e.draws]])),
  };
}

export function run(opt) {
  const t0 = Date.now();
  const log = (...a) => { if (!opt.quiet) console.log(...a); };
  const W = loadWiring(opt.wiring), C = W.C;
  const flyOpts = { ...FLY_OPTS, seed: 1 };
  // the same options as makePair(), but each fly on its own wiring
  const A = new Fly(C.A, { ...flyOpts, name: 'Fly A', hemisphere: 'A' });
  const B = new Fly(C.B, { ...flyOpts, name: 'Fly B', hemisphere: 'B' });
  log(`wiring ${W.mode}: A ${W.record.A.file} (${W.record.A.kc} KCs), B ${W.record.B.file} (${W.record.B.kc} KCs)`);
  const rng = mulberry32(hashSeed(`train-mix:${opt.seed}`));
  const evalSeed = hashSeed(`checkpoint:${opt.seed}`);
  const rows = [];
  let best = null;
  const record = g => {
    const row = { games: g, ...checkpoint(A, B, opt.eval, evalSeed), seconds: Math.round((Date.now() - t0) / 1000) };
    rows.push(row);
    const score = row.vsGreedy.A + row.vsGreedy.B;
    if (g > 0 && (!best || score > best.score)) best = { score, games: g, A: A.toJSON(), B: B.toJSON() };
    log(`games ${g}  vsRandom A ${row.vsRandom.A} B ${row.vsRandom.B}  vsGreedy A ${row.vsGreedy.A} B ${row.vsGreedy.B}  A vs B ${row.AvsB}  ${row.seconds} s`);
  };
  record(0);
  const kinds = { random: 0, greedy: 0, self: 0 };
  for (let g = 0; g < opt.games; g++) {
    const mix = g < opt.curriculum ? CURRICULUM_MIX : TRAIN_MIX;
    const { kind } = trainGame(A, B, g, rng, { mix, seed: opt.seed });
    kinds[kind]++;
    if ((g + 1) % opt.every === 0 || g + 1 === opt.games) record(g + 1);
  }
  if (!best) best = { score: 0, games: opt.games, A: A.toJSON(), B: B.toJSON() };
  // held-out evaluation of the kept flies, on new seeds
  const KA = Fly.fromJSON(C.A, best.A), KB = Fly.fromJSON(C.B, best.B);
  const fs = hashSeed(`held-out:${opt.seed}`);
  const one = e => { const ci = wilson(e.wins, e.n); return { wins: e.wins, losses: e.losses, draws: e.draws, n: e.n, rate: rate3(e.rate), ci95: ci.map(rate3), pVsCoin: Number(binomialP(e.wins, e.n, 0.5).toPrecision(3)) }; };
  const final = {
    games: best.games,
    vsRandom: { A: one(evaluate(KA, 'random', opt.final, fs)), B: one(evaluate(KB, 'random', opt.final, fs)) },
    vsGreedy: { A: one(evaluate(KA, 'greedy', opt.final, fs)), B: one(evaluate(KB, 'greedy', opt.final, fs)) },
    AvsB: one(evaluate(KA, KB, opt.final, fs)),
  };
  // the bots against each other on the same held-out games, for scale
  final.greedyVsRandom = one(evaluate(greedyBot(), 'random', opt.final, fs));
  const wall = Math.round((Date.now() - t0) / 1000);
  log(`kept games ${best.games}; held-out over ${opt.final} games: vsRandom A ${final.vsRandom.A.rate} B ${final.vsRandom.B.rate}, vsGreedy A ${final.vsGreedy.A.rate} B ${final.vsGreedy.B.rate}, A vs B ${final.AvsB.rate}, greedy vs random ${final.greedyVsRandom.rate}; wall ${wall} s`);

  const cmd = `node tools/train.mjs --games ${opt.games} --every ${opt.every} --eval ${opt.eval} --final ${opt.final} --curriculum ${opt.curriculum} --seed ${opt.seed} --wiring ${W.mode}`;
  const meta = {
    command: cmd, seed: opt.seed, wallSeconds: wall, date: new Date().toISOString().slice(0, 10), node: process.version,
    flyOptions: JSON.stringify(flyOpts), explore: TRAIN_EXPLORE, wiring: W.record,
    curriculum: `games 0-${opt.curriculum - 1}: ${JSON.stringify(CURRICULUM_MIX)}; then ${JSON.stringify(TRAIN_MIX)}`,
    trainingGamesByKind: kinds,
    checkpointEval: `${opt.eval} games per opponent per checkpoint, explore 0, no learning, one fixed seed`,
    selection: `kept the checkpoint with the best vsGreedy A + B: games ${best.games}`,
    final,
    note: 'Measured by train/selfplay.js evaluate(). A rate is wins / games; a draw (turn cap) is not a win. A model, not a real fly.',
  };
  mkdirSync(opt.out, { recursive: true });
  // format 2 adds "wiring": the connectome file of each fly
  const pre = { format: 'fly-duel-pretrained/2', wiring: W.record, meta: { command: cmd, seed: opt.seed, games: best.games, date: meta.date, final }, A: best.A, B: best.B };
  writeFileSync(join(opt.out, 'pretrained.json'), JSON.stringify(pre));
  writeFileSync(join(opt.out, 'training-curve.json'), JSON.stringify({ format: 'fly-duel-curve/1', meta, checkpoints: rows }, null, 1));
  log(`wrote ${join(opt.out, 'pretrained.json')} and training-curve.json`);
  return { rows, best, final, meta };
}


if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(args(process.argv.slice(2)));

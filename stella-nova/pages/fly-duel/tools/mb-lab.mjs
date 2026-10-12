#!/usr/bin/env node
// ============================================================================
//  FLY DUEL  ·  mushroom body lab: compare model options  (node dev tool)
// ----------------------------------------------------------------------------
//  This tool trains one fly pair with one set of fly options, the same
//  way as tools/train.mjs (curriculum, TRAIN_MIX, explore 0.05), and
//  measures the kept flies against the greedy bot on held-out games. Use
//  it to test a brain change before a full retrain. It writes no file in
//  the page; the result is one JSON line on stdout.
//
//  RUN (from the page folder)
//      node tools/mb-lab.mjs --cfg '{"kcCode":"graded"}' --games 8000
//      options: --games 8000 --every 1000 --eval 100 --final 500
//               --curriculum 1000 --seed 2026 --cfg '{...}' --tag name
//               --mix '{"random":0.1,"greedy":0.3,"self":0.6}'
//               --curmix '{"random":0.5,"greedy":0,"self":0.5}'
//      mix is the opponent mix after the curriculum (default TRAIN_MIX),
//      curmix the mix of the curriculum (default CURRICULUM_MIX of
//      tools/train.mjs). The games use all decks (DECK_POOL).
//
//  METHOD.  At each checkpoint, fly A and fly B play --eval games each
//  against the greedy bot (checkpoint seed). The tool keeps the
//  checkpoint with the best sum. Then the kept flies play --final new
//  games each against the greedy bot and the random bot (held-out seed,
//  the same as tools/train.mjs uses). The tool reports A and B, the
//  pooled rate and its 95 % Wilson interval.
//
//  GREP MAP   (grep -n "<anchor>" tools/mb-lab.mjs)
//      args ........ "function args"
//      main loop ... "for (let g = 0"
//      held-out .... "held-out"
// ============================================================================
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePair, Fly } from '../brain/fly.js';
import { evaluate, trainGame, wilson, TRAIN_MIX, FLY_OPTS } from '../train/selfplay.js';
import { mulberry32, hashSeed } from '../data/rng.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CURRICULUM_MIX = Object.freeze({ random: 0.5, greedy: 0, self: 0.5 });

function args(argv) {
  const o = { games: 8000, every: 1000, eval: 100, final: 500, curriculum: 1000, seed: 2026, cfg: '{}', tag: '', mix: '', curmix: '' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, ''), v = argv[++i];
    if (!(k in o)) throw new Error(`mb-lab.mjs: unknown option --${k}`);
    o[k] = typeof o[k] === 'number' ? Number(v) : v;
  }
  o.cfg = JSON.parse(o.cfg);
  o.mix = o.mix ? JSON.parse(o.mix) : TRAIN_MIX;
  o.curmix = o.curmix ? JSON.parse(o.curmix) : CURRICULUM_MIX;
  return o;
}

export function lab(opt) {
  const t0 = Date.now();
  const C = JSON.parse(readFileSync(join(ROOT, 'data/connectome.json'), 'utf8'));
  const [A, B] = makePair(C, { ...FLY_OPTS, seed: 1, ...opt.cfg });
  const rng = mulberry32(hashSeed(`train-mix:${opt.seed}`));
  const evalSeed = hashSeed(`checkpoint:${opt.seed}`);
  const curve = [];
  let best = null;
  for (let g = 0; g < opt.games; g++) {
    trainGame(A, B, g, rng, { mix: g < opt.curriculum ? (opt.curmix || CURRICULUM_MIX) : (opt.mix || TRAIN_MIX), seed: opt.seed });
    if ((g + 1) % opt.every === 0) {
      const a = evaluate(A, 'greedy', opt.eval, evalSeed).rate, b = evaluate(B, 'greedy', opt.eval, evalSeed).rate;
      curve.push([g + 1, a, b]);
      if (!best || a + b > best.score) best = { score: a + b, games: g + 1, A: A.toJSON(), B: B.toJSON() };
    }
  }
  // held-out: new seeds, the kept flies, no learning, greedy play
  const fs = hashSeed(`held-out:${opt.seed}`);
  const KA = Fly.fromJSON(C, best.A), KB = Fly.fromJSON(C, best.B);
  const gA = evaluate(KA, 'greedy', opt.final, fs), gB = evaluate(KB, 'greedy', opt.final, fs);
  const rA = evaluate(KA, 'random', opt.final, fs), rB = evaluate(KB, 'random', opt.final, fs);
  const wins = gA.wins + gB.wins, n = gA.n + gB.n;
  const r3 = x => Math.round(x * 1000) / 1000;
  return {
    tag: opt.tag, cfg: opt.cfg, mix: opt.mix, curmix: opt.curmix, games: opt.games, kept: best.games,
    greedy: { A: r3(gA.rate), B: r3(gB.rate), pooled: r3(wins / n), ci95: wilson(wins, n).map(r3), wins, n },
    random: { A: r3(rA.rate), B: r3(rB.rate) },
    curve, seconds: Math.round((Date.now() - t0) / 1000),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(lab(args(process.argv.slice(2)))));

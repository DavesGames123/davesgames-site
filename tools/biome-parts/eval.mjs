// ============================================================================
//  tools/biome-parts/eval.mjs — the repo's eval suites, run in JavaScript
// ----------------------------------------------------------------------------
//  Runs Taiga-S1 (model.js) on the goal streams in test-data/eval.json
//  (make_ref.py: evaluate.py SUITES and seeds) in the JS session (fcsim.js)
//  and prints the success rate per suite next to the repo's release/hf
//  eval_results.json numbers. --perturb 0.2 injects random actions like the
//  repo's eval_results_perturbed.json run. --n limits episodes per suite.
//
//    node tools/biome-parts/eval.mjs [--n 100] [--perturb 0.2] [--only a,b] [--out file]
// ============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
const P = new URL('../../stella-nova/pages/biome-parts/', import.meta.url);
const { loadModel } = await import(new URL('js/model.js', P));
const { runEpisode } = await import(new URL('js/agent.js', P));
const { rng } = await import(new URL('js/goals.js', P));
const { iou } = await import(new URL('js/part.js', P));
const { analyze } = await import(new URL('js/fcsim.js', P));
// IoU on a voxel grid over both boxes, for a tape that differs from the target
const iouFn = (a, b) => {
  const A = analyze(a), B = analyze(b);
  const lo = [0, 1, 2].map(i => Math.min(A.bbox[0][i], B.bbox[0][i]) - 1), hi = [0, 1, 2].map(i => Math.max(A.bbox[1][i], B.bbox[1][i]) + 1);
  return iou(a, b, { lo, hi }, 64);
};
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg('--n', 100), perturb = +arg('--perturb', 0), out = arg('--out', null), only = arg('--only', '');
const buf = readFileSync(new URL('taiga-s1/model.safetensors', P));
const M = loadModel(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), JSON.parse(readFileSync(new URL('taiga-s1/config.json', P))));
const suites = JSON.parse(readFileSync(new URL('test-data/eval.json', P)));
const res = {};
for (const [name, eps] of Object.entries(suites)) {
  if (only && !only.split(',').includes(name)) continue;
  const noise = rng(1234 + name.length * 7);
  let ok = 0, n = 0, agree = 0; const outcomes = {}; const fails = [];
  for (const e of eps.slice(0, N)) {
    const r = runEpisode(M, e.goal, e.start, { perturb, rng: noise.random, keepLog: true, iouFn });
    ok += r.success; n++; agree += r.agreement; outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1;
    if (!r.success && fails.length < 3) fails.push({ seed: e.seed, kinds: e.goal.features.map(f => f.kind), outcome: r.outcome, iou: r.iou, tail: r.log.slice(-16).map(l => (l.kind === 'noise' ? '*' : '') + l.action) });
  }
  res[name] = { n, success: ok / n, agreement: agree / n, outcomes, fails };
  console.log(name.padEnd(9), `${ok}/${n}`, 'agree', (agree / n).toFixed(4), JSON.stringify(outcomes));
}
if (out) writeFileSync(out, JSON.stringify(res, null, 1));

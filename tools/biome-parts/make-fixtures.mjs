// ============================================================================
//  tools/biome-parts/make-fixtures.mjs — states for the PyTorch parity check
// ----------------------------------------------------------------------------
//  Runs seeded Taiga-S1 episodes in the JS session (fcsim.js), some with
//  injected random actions, and writes every 3rd state with its goal and
//  valid actions to stella-nova/pages/biome-parts/test-data/states.json.
//  make_ref.py then encodes the same states with the Python featurizer and
//  runs the PyTorch model on them (ref.json); tests.mjs compares the two.
//
//    node tools/biome-parts/make-fixtures.mjs
// ============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
const P = new URL('../../stella-nova/pages/biome-parts/', import.meta.url);
const { loadModel } = await import(new URL('js/model.js', P));
const { runEpisode } = await import(new URL('js/agent.js', P));
const { sampleLiveGoal, rng } = await import(new URL('js/goals.js', P));
const buf = readFileSync(new URL('taiga-s1/model.safetensors', P));
const M = loadModel(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), JSON.parse(readFileSync(new URL('taiga-s1/config.json', P))));
const g = rng(2026), noise = rng(99);
const out = [];
const starts = [{ doc_open: false, workbench: 'StartWorkbench', body: false }, { doc_open: true, workbench: 'PartWorkbench', body: false },
  { doc_open: true, workbench: 'PartDesignWorkbench', body: true }, { doc_open: true, workbench: 'PartDesignWorkbench', body: false }];
for (let e = 0; e < 12; e++) {
  const goal = sampleLiveGoal(1 + (e % 5), g);
  let k = 0;
  runEpisode(M, goal, starts[e % 4], { perturb: e % 3 === 2 ? 0.25 : 0, rng: noise.random, onStep: (ep, d) => {
    if (k++ % 3 === 0 && out.length < 60) out.push({ episode: e, state: d.state, goal: JSON.parse(JSON.stringify(goal)), actions: d.actions });
  } });
}
writeFileSync(new URL('test-data/states.json', P), JSON.stringify(out));
console.log('states', out.length);

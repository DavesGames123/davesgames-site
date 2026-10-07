// ============================================================================
//  TESTS  ·  market-forecast/tests.mjs — node tests for the page modules
// ----------------------------------------------------------------------------
//  Run from anywhere:   node stella-nova/pages/market-forecast/tests.mjs
//  Part 1 (this file): model-io.js against values exported from Python
//  (tools/fixtures.json, written by tools/fixtures.py). Each fixture holds
//  the inputs of every ONNX core call the reference made and the fp32 core
//  outputs. A fake run() checks that the JS inputs agree with the recorded
//  inputs, then returns the recorded output. The final JS forecast must
//  agree with the PyTorch chronos pipeline output. So the test covers the
//  scaling, the patching, the time encoding, the Bolt unroll and the
//  inverse scaling, with no ONNX runtime in node.
//  Part 2: tests-data.mjs (providers, synthetic market, portfolio and
//  backtest maths) in a child process.
//  Exit code 1 if any check fails.
//
//  grep -n targets: "function checkFeeds", "async function runCase"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { forecastBolt, forecastC2, scaleRow, quantileLinear, MODELS } from './model-io.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(fs.readFileSync(path.join(HERE, 'tools/fixtures.json'), 'utf8'));
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
const num = v => (v === null ? NaN : v);

function maxDiff(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = num(a[i]), y = num(b[i]);
    if (Number.isNaN(x) && Number.isNaN(y)) continue;
    d = Math.max(d, Math.abs(x - y));
  }
  return d;
}

function checkFeeds(feeds, call, tag) {
  let worst = 0;
  for (const [k, v] of Object.entries(feeds)) {
    const ref = call[k], dims = call.dims[k];
    if (JSON.stringify(v.dims) !== JSON.stringify(dims)) { ok(false, `${tag} ${k} dims ${JSON.stringify(v.dims)} != ${JSON.stringify(dims)}`); return Infinity; }
    const got = v.type === 'int64' ? Array.from(v.data, Number) : v.data;
    worst = Math.max(worst, maxDiff(got, ref));
  }
  return worst;
}

async function runCase(name) {
  const fx = FX[name];
  const rows = fx.rows.map(r => Float64Array.from(r, num));
  let k = 0, feedWorst = 0;
  const run = async feeds => {
    const call = fx.calls[k++];
    feedWorst = Math.max(feedWorst, checkFeeds(feeds, call, `${name} call ${k}`));
    return Float32Array.from(call.out);
  };
  const q = name.startsWith('bolt')
    ? await forecastBolt(run, rows, fx.H)
    : await forecastC2(run, rows, fx.H, fx.groups);
  ok(k === fx.calls.length, `${name}: ${k} core calls (Python made ${fx.calls.length})`);
  ok(feedWorst < 2e-6, `${name}: JS core inputs vs Python, max abs ${feedWorst.toExponential(2)} (< 2e-6)`);
  // ref dims: (rows, levels, H)
  const [B, Q, H] = fx.refDims;
  let worst = 0, span = 0;
  for (let b = 0; b < B; b++) for (let j = 0; j < Q; j++) for (let h = 0; h < H; h++) {
    const r = fx.ref[(b * Q + j) * H + h];
    worst = Math.max(worst, Math.abs(q[b][j][h] - r));
  }
  for (const r of rows) { const v = r.filter(x => x === x); span = Math.max(span, Math.max(...v) - Math.min(...v)); }
  const rel = worst / span;
  ok(rel < 1e-5, `${name}: JS forecast vs PyTorch pipeline, max abs ${worst.toExponential(2)}, ${rel.toExponential(2)} of the series range (< 1e-5); numpy twin was ${fx.twinVsRef.toExponential(2)}`);
}

// scaleRow edge cases (the pipeline rules)
{
  const s = scaleRow([NaN, NaN]); ok(s.loc === 0 && s.scale === 1, 'scaleRow: all NaN gives loc 0, scale 1');
  const f = scaleRow([3, 3, 3]); ok(f.loc === 3 && f.scale === 1e-5, 'scaleRow: a flat row gives scale 1e-5');
  const a = scaleRow([1, 2, 3], true); ok(Math.abs(a.z[2] - Math.asinh(Math.sqrt(1.5))) < 1e-6, 'scaleRow: arcsinh of the scaled value');
  ok(quantileLinear([1, 2, 3, 4, 5], 0.1) === 1.4, 'quantileLinear: numpy linear rule (0.1 of 1..5 = 1.4)');
  ok(MODELS['bolt-tiny'].weights === null && MODELS['c2-small'].weights.sha256.length === 64, 'MODELS: bundled tiny, pinned HF weights for the others');
}
for (const name of Object.keys(FX)) await runCase(name);

// Part 2: data, providers, portfolio and backtest tests.
const data = path.join(HERE, 'tests-data.mjs');
if (fs.existsSync(data)) {
  const r = spawnSync(process.execPath, [data], { encoding: 'utf8' });
  process.stdout.write(r.stdout); process.stderr.write(r.stderr);
  ok(r.status === 0, 'tests-data.mjs exit code ' + r.status);
} else console.log('SKIP tests-data.mjs is not in this tree yet');

// Part 3: the IEX snapshot path (reader, bars, merge, provider parse).
{
  const r = spawnSync(process.execPath, [path.join(HERE, 'tests-iex.mjs')], { encoding: 'utf8' });
  process.stdout.write(r.stdout); process.stderr.write(r.stderr);
  ok(r.status === 0, 'tests-iex.mjs exit code ' + r.status);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);

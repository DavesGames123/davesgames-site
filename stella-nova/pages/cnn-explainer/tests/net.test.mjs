// CNN Explainer · tests/net.test.mjs
// The forward pass against the TensorFlow.js reference (tests/reference.json)
// on every example photo, and conv / ReLU / pool / dense / softmax against
// values computed by hand. Run: node stella-nova/pages/cnn-explainer/tests/net.test.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as N from '../net.js';
import { EXAMPLES, exampleRGB } from '../data.js';
import { coverResample, rgbToRGBA } from '../image.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) pass++; else { fail++; console.log('FAIL  ' + m + (d ? '  ' + d : '')); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const arrNear = (a, b, e = 1e-9) => a.length === b.length && Array.from(a).every((v, i) => near(v, b[i], e));

// ── the reference: every example photo ──────────────────────────────────────
const W = N.parseWeights(fs.readFileSync(path.join(HERE, '../model/weights.bin')));
const bin = fs.readFileSync(path.join(HERE, '../examples/examples.bin'));
const REF = JSON.parse(fs.readFileSync(path.join(HERE, 'reference.json')));
ok(REF.examples.length === EXAMPLES.length, 'reference has one row per example', `${REF.examples.length} vs ${EXAMPLES.length}`);
let worst = 0;
EXAMPLES.forEach((ex, i) => {
  const r = N.forward(W, exampleRGB(bin, i)), ref = REF.examples[i];
  const d = Math.max(...r.probs.map((p, j) => Math.abs(p - ref.probs[j])));
  worst = Math.max(worst, d);
  ok(r.label === ref.top, `example ${i} (${ex.cls}) top-1 = reference`, `${r.label} vs ${ref.top}`);
  ok(r.label === ex.cls, `example ${i} (${ex.cls}) top-1 = its class`, r.label);
  ok(d < 1e-5, `example ${i} probabilities within 1e-5 of reference`, d.toExponential(2));
  ok(near(r.probs.reduce((a, b) => a + b, 0), 1, 1e-9), `example ${i} probabilities sum to 1`);
});
console.log(`reference: ${EXAMPLES.length} examples, largest probability difference ${worst.toExponential(2)}`);

// ── shapes of the whole pass ───────────────────────────────────────────────
{
  const r = N.forward(W, exampleRGB(bin, 0));
  const shapes = r.layers.map(l => `${l.H}x${l.W}x${l.C}`).join(' ');
  ok(shapes === '64x64x3 62x62x10 62x62x10 60x60x10 60x60x10 30x30x10 28x28x10 28x28x10 26x26x10 26x26x10 13x13x10 1x1x10', 'layer shapes', shapes);
  ok(r.layers.length === N.ARCH.length, 'one activation per ARCH row');
  ok(r.layers[2].data.every(v => v >= 0), 'ReLU output is never negative');
  // convTerms rebuilds a conv unit from its products
  for (const [li, y, x, c] of [[1, 0, 0, 0], [1, 30, 17, 4], [3, 59, 59, 9], [6, 12, 3, 2], [8, 25, 0, 7]]) {
    const t = N.convTerms(W, r.layers, li, y, x, c), L = r.layers[li];
    ok(near(t.out, L.data[(y * L.W + x) * L.C + c], 1e-5), `convTerms layer ${li} (${y},${x},${c}) = activation`, `${t.out} vs ${L.data[(y * L.W + x) * L.C + c]}`);
    ok(t.chans.length === r.layers[li - 1].C && t.chans[0].prod.length === 9, `convTerms layer ${li} has one 3x3 block per input channel`);
  }
  for (const [li, y, x, c] of [[5, 0, 0, 0], [5, 29, 29, 9], [10, 6, 7, 3]]) {
    const pw = N.poolWindow(r.layers, li, y, x, c), L = r.layers[li];
    ok(pw.max === L.data[(y * L.W + x) * L.C + c] && pw.vals.length === 4, `poolWindow layer ${li} (${y},${x},${c}) max = activation`);
  }
}

// ── hand-computed unit tests ───────────────────────────────────────────────
{
  // 3x3 one-channel input, 2x2 kernel [[1,2],[3,4]], kernel layout [k,k,cin,cout]
  const inp = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const ker = Float32Array.from([1, 2, 3, 4]);
  const a = N.conv2d(inp, 3, 3, 1, ker, null, 1, { k: 2 });
  ok(a.H === 2 && a.W === 2 && arrNear(a.data, [37, 47, 67, 77]), 'conv2d valid 3x3 * 2x2', Array.from(a.data).join(','));
  const b = N.conv2d(inp, 3, 3, 1, ker, Float32Array.from([1]), 1, { k: 2 });
  ok(arrNear(b.data, [38, 48, 68, 78]), 'conv2d adds the bias');
  const c = N.conv2d(inp, 3, 3, 1, ker, null, 1, { k: 2, stride: 2, pad: 1 });
  ok(c.H === 2 && arrNear(c.data, [4, 18, 36, 77]), 'conv2d padding 1 stride 2', Array.from(c.data).join(','));
  // two input channels, two filters. Channels last: [ch0, ch1] per pixel.
  // 2x2 input, 1x1 kernel: out0 = 1*ch0 + 10*ch1, out1 = -ch0 + 0*ch1
  const inp2 = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const ker2 = Float32Array.from([1, -1, 10, 0]);
  const d = N.conv2d(inp2, 2, 2, 2, ker2, Float32Array.from([0.5, 0]), 2, { k: 1 });
  ok(arrNear(d.data, [21.5, -1, 43.5, -3, 65.5, -5, 87.5, -7]), 'conv2d two channels in, two out', Array.from(d.data).join(','));
  ok(arrNear(N.relu(Float32Array.from([-2, -0.5, 0, 0.5, 3])), [0, 0, 0, 0.5, 3]), 'relu');
  const p = N.maxPool(Float32Array.from([1, 5, 2, 0, 3, 4, -1, 8, 0, 0, 9, 9, -3, 7, 9, 1]), 4, 4, 1);
  ok(p.H === 2 && arrNear(p.data, [5, 8, 7, 9]), 'maxPool 4x4 -> 2x2', Array.from(p.data).join(','));
  const sm = N.softmax([1, 2, 3]);
  ok(arrNear(sm, [0.09003057317038046, 0.24472847105479764, 0.6652409557748219], 1e-12), 'softmax [1,2,3]', sm.join(','));
  ok(arrNear(N.softmax([1001, 1002, 1003]), sm, 1e-12), 'softmax is stable for large logits');
  const dn = N.dense([1, 2, 0], Float32Array.from([1, 2, 3, 4, 5, 6]), [0.5, -0.5], 2);
  ok(arrNear(dn, [7.5, 9.5]), 'dense [1,2,0] . W + b', Array.from(dn).join(','));
  ok(N.outSize(64, 3) === 62 && N.outSize(60, 2, 2) === 30 && N.outSize(26, 2, 2) === 13 && N.outSize(5, 3, 2, 1) === 3, 'outSize');
}

// ── receptive fields and source windows ────────────────────────────────────
{
  ok(JSON.stringify(N.sourceWindow(1, 4, 5)) === JSON.stringify({ y0: 4, x0: 5, size: 3 }), 'source window of a conv unit');
  ok(JSON.stringify(N.sourceWindow(5, 4, 5)) === JSON.stringify({ y0: 8, x0: 10, size: 2 }), 'source window of a pool unit');
  ok(N.sourceWindow(11, 0, 0) === null, 'a dense unit sees the whole layer');
  const rf = N.receptiveField(10, 1, 2);
  const inp = rf[rf.length - 1];
  ok(inp.li === 0 && inp.y0 === 4 && inp.x0 === 8 && inp.size === 16, 'receptive field of pool 2 unit (1,2) in the input', JSON.stringify(inp));
  ok(rf.length === 10, 'receptive field lists every earlier layer');
  const rf1 = N.receptiveField(1, 7, 9);
  ok(rf1.length === 1 && rf1[0].size === 3 && rf1[0].y0 === 7, 'receptive field of conv 1·1 is 3x3');
}

// ── the image resample ─────────────────────────────────────────────────────
{
  // a 4x2 RGBA picture: left half red, right half blue; the centre square is
  // columns 1..2, so a 2x2 resample gives red then blue in each row.
  const w = 4, h = 2, rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; rgba.set(x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], i); }
  const out = coverResample(rgba, w, h, 2);
  ok(Array.from(out).join(',') === '255,0,0,0,0,255,255,0,0,0,0,255', 'coverResample crops the centre square', Array.from(out).join(','));
  const big = new Uint8Array(128 * 128 * 4).fill(100);
  ok(coverResample(big, 128, 128, 64).every(v => v === 100), 'coverResample of a flat picture is flat');
  ok(Array.from(rgbToRGBA(Uint8Array.from([1, 2, 3]))).join(',') === '1,2,3,255', 'rgbToRGBA');
}

console.log(`net: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

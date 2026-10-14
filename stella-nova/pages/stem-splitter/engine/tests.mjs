// ============================================================================
//  ENGINE TESTS  ·  stem-splitter/engine/tests.mjs — DSP + runtime (node)
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/stem-splitter/engine/tests.mjs [--quick]
//  One line per check (PASS / FAIL / SKIP) with what it measured; exit 1 on
//  any FAIL. CONTRACT 8.2 gives the thresholds. No browser.
//  --quick skips the real-graph section (onnxruntime-web in node).
//
//  Inputs it reads (each is optional; a missing input gives SKIP lines):
//    ../models.js            model list (MODEL). Absent: the CONTRACT 5.1
//                            stub below, and the line says so.
//    ../test/vectors.json    PyTorch reference values (MODEL, CONTRACT 5.6).
//                            STEM_VECTORS=<file> overrides the path.
//    ../models/<id>.onnx and ../models/<weights.name>   the graph and the
//                            official .th. STEM_MODELS_DIR=<dir> overrides.
//
//  SECTIONS (grep "SECTION:")
//    syntax ....... node --check and ESM import of every engine module
//    fft .......... against a naive DFT
//    synth ........ synthV1 head vs vectors.synth
//    stft ......... specCac / ispecCac vs vectors, the generic pair, round trip
//    plan ......... transitionWeight, segmentPlan, paddedChunk, weightSum
//    separate ..... the glue with fake cores: identity, shifts, progress, cancel
//    weights ...... getModelBytes / cachedModels / evictModel with fakes
//    protocol ..... runtime.js with a fake ORT; client.js with a fake Worker
//    real ......... the ONNX graph in vendored onnxruntime-web (wasm EP)
//
//  GREP MAP
//    reporting ........ "function check", "function skip"
//    vector decode .... "function dec"
//    fake ORT ......... "function fakeOrt"
//    fake Worker ...... "class FakeWorker"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.dirname(HERE);
const VENDOR = path.resolve(PAGE, '../../vendor/onnxruntime-web@1.30.0/dist/');
const QUICK = process.argv.includes('--quick');

let fails = 0, passes = 0, skips = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); cond ? passes++ : fails++; return cond; }
function skip(msg) { console.log('SKIP ' + msg); skips++; }
const section = name => console.log('\n-- SECTION: ' + name);
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const sci = x => (Number.isFinite(x) ? x.toExponential(2) : String(x));

function dec(s) {
  const b = Buffer.from(s.slice(4), 'base64');
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return s.startsWith('f32:') ? new Float32Array(ab) : new Uint32Array(ab);
}
function sdr(ref, est) {
  let a = 0, b = 0;
  for (let i = 0; i < ref.length; i++) { a += ref[i] * ref[i]; const d = ref[i] - est[i]; b += d * d; }
  return b === 0 ? Infinity : 10 * Math.log10(a / b);
}
const at = (arr, idx) => Float64Array.from(idx, i => arr[i]);

// ---------------------------------------------------------------- inputs
const STUB_MODELS = {
  htdemucs: {
    id: 'htdemucs', label: '4 stems', note: 'Demucs v4 (htdemucs), the default model',
    stems: ['drums', 'bass', 'other', 'vocals'],
    graph: { file: 'models/htdemucs.onnx', bytes: 0, sha256: '' },
    weights: { file: 'models/955717e8-8726e21a.th', name: '955717e8-8726e21a.th', bytes: 84141911,
      sha256: '8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4' },
    inputs: { mag: [1, 4, 2048, 336], mix: [1, 2, 343980] },
    outputs: { spec_out: [1, 4, 4, 2048, 336], wave_out: [1, 4, 2, 343980] },
  },
  htdemucs_6s: {
    id: 'htdemucs_6s', label: '6 stems (adds guitar, piano)', note: 'Demucs v4 (htdemucs_6s)',
    stems: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'],
    graph: { file: 'models/htdemucs_6s.onnx', bytes: 0, sha256: '' },
    weights: { file: 'models/5c90dfd2-34c22ccb.th', name: '5c90dfd2-34c22ccb.th', bytes: 54996327,
      sha256: '34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd' },
    inputs: { mag: [1, 4, 2048, 336], mix: [1, 2, 343980] },
    outputs: { spec_out: [1, 6, 4, 2048, 336], wave_out: [1, 6, 2, 343980] },
  },
};
let MODELS = STUB_MODELS, modelsSrc = 'CONTRACT 5.1 stub (models.js absent)';
if (fs.existsSync(path.join(PAGE, 'models.js'))) {
  try { MODELS = (await import(pathToFileURL(path.join(PAGE, 'models.js')).href)).MODELS; modelsSrc = 'models.js'; }
  catch (e) { modelsSrc = 'CONTRACT 5.1 stub (models.js failed to import: ' + e.message + ')'; }
}
const vecPath = process.env.STEM_VECTORS || path.join(PAGE, 'test/vectors.json');
const V = fs.existsSync(vecPath) ? JSON.parse(fs.readFileSync(vecPath, 'utf8')) : null;
const MODEL_DIR = process.env.STEM_MODELS_DIR || path.join(PAGE, 'models');
console.log('models: ' + modelsSrc);
console.log('vectors: ' + (V ? vecPath + ' (made by ' + V.made_by + ')' : 'absent (' + vecPath + ')'));
console.log('model files: ' + MODEL_DIR);

// ================================================================ syntax
section('syntax');
const FILES = ['fft.js', 'dsp.js', 'segment.js', 'synth.js', 'weights.js', 'runtime.js', 'worker.js', 'client.js'];
const EXPORTS = {
  'fft.js': ['makeFFT'], 'dsp.js': ['hann', 'specCac', 'ispecCac', 'stft', 'istft', 'trackStats'],
  'segment.js': ['segmentPlan', 'transitionWeight', 'paddedChunk', 'separate'], 'synth.js': ['mulberry32', 'synthV1'],
  'weights.js': ['getModelBytes', 'cachedModels', 'evictModel'], 'runtime.js': ['createRuntime'], 'client.js': ['createEngine'],
};
for (const f of FILES) {
  const r = spawnSync(process.execPath, ['--check', path.join(HERE, f)], { encoding: 'utf8' });
  check(r.status === 0, `node --check engine/${f}` + (r.status ? ': ' + r.stderr.split('\n').slice(0, 3).join(' ') : ''));
}
for (const f of FILES) {
  if (f === 'worker.js') {
    if (!fs.existsSync(path.join(PAGE, 'models.js'))) { skip('import engine/worker.js (needs ../models.js, MODEL role)'); continue; }
    const posted = [];
    globalThis.self = { postMessage: m => posted.push(m) };
    try { await import(pathToFileURL(path.join(HERE, f)).href); check(typeof globalThis.self.onmessage === 'function', 'import engine/worker.js sets self.onmessage'); }
    catch (e) { check(false, 'import engine/worker.js: ' + e.message); }
    delete globalThis.self;
    continue;
  }
  try {
    const mod = await import(pathToFileURL(path.join(HERE, f)).href);
    const miss = (EXPORTS[f] || []).filter(k => typeof mod[k] !== 'function');
    check(miss.length === 0, `import engine/${f}` + (miss.length ? ' missing ' + miss.join(', ') : ', exports ' + EXPORTS[f].join(', ')));
  } catch (e) { check(false, `import engine/${f}: ${e.message}`); }
}

const { makeFFT } = await import('./fft.js');
const { hann, specCac, ispecCac, stft, istft, trackStats } = await import('./dsp.js');
const seg = await import('./segment.js');
const { segmentPlan, transitionWeight, paddedChunk, separate, weightSum, shiftOffsetsFor } = seg;
const { mulberry32, synthV1 } = await import('./synth.js');
const W = await import('./weights.js');
const { createRuntime } = await import('./runtime.js');
const { createEngine } = await import('./client.js');

// ================================================================ fft
section('fft');
function naiveBin(re, im, k, sign) {
  const n = re.length; let sr = 0, si = 0;
  for (let j = 0; j < n; j++) {
    const a = sign * 2 * Math.PI * ((j * k) % n) / n, c = Math.cos(a), s = Math.sin(a);
    sr += re[j] * c - im[j] * s; si += re[j] * s + im[j] * c;
  }
  return [sr, si];
}
for (const [n, bins] of [[64, null], [4096, [0, 1, 2, 7, 100, 1023, 2047, 2048, 2049, 3000, 4095]]]) {
  const rng = mulberry32(n), re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) { re[i] = rng() - 0.5; im[i] = rng() - 0.5; }
  const fr = re.slice(), fi = im.slice();
  makeFFT(n).forward(fr, fi);
  let err = 0;
  for (const k of bins || [...Array(n).keys()]) { const [a, b] = naiveBin(re, im, k, -1); err = Math.max(err, Math.abs(a - fr[k]), Math.abs(b - fi[k])); }
  const br = fr.slice(), bi = fi.slice();
  makeFFT(n).inverse(br, bi);
  let rt = 0; for (let i = 0; i < n; i++) rt = Math.max(rt, Math.abs(br[i] - re[i]), Math.abs(bi[i] - im[i]));
  check(err <= 1e-9, `FFT ${n} vs naive DFT (${bins ? bins.length + ' spot bins' : 'all bins'}): max abs error ${sci(err)} <= 1e-9`);
  check(rt <= 1e-12, `FFT ${n} inverse(forward(x)) = x: max abs error ${sci(rt)}`);
}
{
  let threw = false; try { makeFFT(100); } catch (e) { threw = true; }
  check(threw, 'makeFFT(100) throws (not a power of 2)');
  const w = hann(4096);
  check(w[0] === 0 && Math.abs(w[2048] - 1) < 1e-15 && Math.abs(w[1024] - 0.5) < 1e-15, 'hann(4096) is periodic: w[0] = 0, w[2048] = 1, w[1024] = 0.5');
}

// ================================================================ synth
section('synth');
{
  const r = mulberry32(1); const a = [r(), r(), r()];
  check(a.every(x => x >= 0 && x < 1), `mulberry32(1) first values ${a.map(x => x.toFixed(6)).join(', ')} in [0, 1)`);
  const [L, R] = synthV1(1);
  check(L.length === 44100 && R.length === 44100, 'synthV1(1) gives 2 x 44100 samples');
  if (V && V.synth) {
    const h = dec(V.synth.head); let e = 0;
    for (let i = 0; i < 256; i++) e = Math.max(e, Math.abs(h[i] - L[i]), Math.abs(h[256 + i] - R[i]));
    check(e <= 1e-7, `synthV1 head (2 x 256) vs vectors.synth.head: max abs ${sci(e)} <= 1e-7`);
  } else skip('synthV1 head vs vectors (vectors absent)');
}

// ================================================================ stft
section('stft');
{
  const [L, R] = synthV1(1);
  const mag = specCac(L, R);
  check(mag.length === 4 * 2048 * 44, `specCac(1 s) size ${mag.length} = 4 x 2048 x 44`);
  // Independent path: the generic stft of the _spec-padded signal, one
  // channel at a time (no two-channel packing), frames 2 .. 45.
  const le = 44, pad = 1536, frames = le;
  const padSig = x => { const n = x.length, r = pad + le * 1024 - n, o = new Float32Array(n + pad + r); for (let i = 0; i < o.length; i++) { let k = i - pad; if (k < 0) k = -k; if (k >= n) k = 2 * (n - 1) - k; o[i] = x[k]; } return o; };
  let worst = Infinity;
  [L, R].forEach((x, c) => {
    const g = stft(padSig(x), { nfft: 4096, hop: 1024, normalized: true });
    check(g.frames === le + 4 && g.bins === 2049, `generic stft frames ${g.frames} = le + 4, bins ${g.bins}`);
    const ref = new Float64Array(2 * 2048 * frames), est = new Float64Array(ref.length);
    let i = 0;
    for (let f = 0; f < 2048; f++) for (let t = 0; t < frames; t++) {
      ref[i] = g.re[f * g.frames + t + 2]; est[i++] = mag[(2 * c) * 2048 * le + f * le + t];
      ref[i] = g.im[f * g.frames + t + 2]; est[i++] = mag[(2 * c + 1) * 2048 * le + f * le + t];
    }
    worst = Math.min(worst, sdr(ref, est));
  });
  check(worst >= 120, `specCac (packed L+R FFT) vs generic stft per channel: SDR ${fmt(worst)} dB >= 120`);

  if (V && V.stft) {
    const idx = dec(V.stft.idx), val = dec(V.stft.val);
    const s = sdr(val, at(mag, idx));
    check(s >= 100, `specCac(synth 1 s) vs vectors.stft (${idx.length} samples): SDR ${fmt(s)} dB >= 100`);
    const plane = 2048 * 44;
    const l2 = [0, 1, 2, 3].map(c => { let a = 0; for (let i = 0; i < plane; i++) a += mag[c * plane + i] ** 2; return Math.sqrt(a); });
    const rel = Math.max(...l2.map((x, c) => Math.abs(x - V.stft.l2[c]) / V.stft.l2[c]));
    check(rel <= 1e-5, `specCac l2 per channel vs vectors.stft.l2: max relative ${sci(rel)} <= 1e-5`);
  } else skip('specCac vs vectors.stft (vectors absent)');

  // istft vector: gain g[f] = 1 / (1 + f / 100) on the 1 s spec, then _ispec.
  const gained = new Float32Array(mag.length), plane = 2048 * 44;
  for (let c = 0; c < 4; c++) for (let f = 0; f < 2048; f++) {
    const g = 1 / (1 + f / 100);
    for (let t = 0; t < 44; t++) { const k = c * plane + f * 44 + t; gained[k] = mag[k] * g; }
  }
  const [yl, yr] = ispecCac(gained, 0, 44100);
  if (V && V.istft) {
    const idx = dec(V.istft.idx), val = dec(V.istft.val);
    const flat = new Float32Array(2 * 44100); flat.set(yl, 0); flat.set(yr, 44100);
    const s = sdr(val, at(flat, idx));
    check(s >= 100, `ispecCac(gain x spec, 44100) vs vectors.istft (${idx.length} samples): SDR ${fmt(s)} dB >= 100`);
    const l2 = [yl, yr].map(y => Math.sqrt(y.reduce((a, v) => a + v * v, 0)));
    const rel = Math.max(...l2.map((x, c) => Math.abs(x - V.istft.l2[c]) / V.istft.l2[c]));
    check(rel <= 1e-5, `ispecCac l2 per channel vs vectors.istft.l2: max relative ${sci(rel)} <= 1e-5`);
  } else skip('ispecCac vs vectors.istft (vectors absent)');

  // Generic istft(stft(x)) at another size and length.
  const x = synthV1(0.25)[0].subarray(0, 10001);
  const g = stft(x, { nfft: 512, hop: 128 });
  const y = istft(g.re, g.im, { nfft: 512, hop: 128, length: x.length });
  check(sdr(x, y) >= 120, `generic istft(stft(x)), nfft 512, hop 128, length 10001: SDR ${fmt(sdr(x, y))} dB >= 120`);

  // Round trip on a full segment: 7.8 s of synth-v1. _ispec(_spec(x)) is
  // not the identity in Demucs: _spec drops the Nyquist bin and the frames
  // 0, 1, le+2, le+3, and _ispec puts zeros there. PyTorch on this signal
  // (scratchpad dsp/roundtrip.py, torch 2.7.1): 30.02 dB over the whole
  // segment, 83.01 dB without 4096 samples at each end. So the check is
  // "the same as PyTorch", not >= 120 dB (CONTRACT 8.2 asks for 120 dB).
  const [L8, R8] = synthV1(7.8);
  check(L8.length === 343980, `synthV1(7.8) length ${L8.length} = 343980`);
  const t0 = performance.now();
  const m8 = specCac(L8, R8);
  const t1 = performance.now();
  const [a, b] = ispecCac(m8, 0);
  const t2 = performance.now();
  const cut = (x, k) => x.subarray(k, x.length - k);
  const join = (x, y) => { const o = new Float32Array(x.length + y.length); o.set(x); o.set(y, x.length); return o; };
  const sAll = sdr(join(L8, R8), join(a, b)), sIn = sdr(join(cut(L8, 4096), cut(R8, 4096)), join(cut(a, 4096), cut(b, 4096)));
  check(Math.abs(sAll - 30.02) < 0.05 && sIn >= 82.5,
    `ispecCac(specCac(x)) on synth 7.8 s: SDR ${fmt(sAll)} dB whole segment (PyTorch 30.02), ${fmt(sIn)} dB without 4096 edge samples (PyTorch 83.01) (specCac ${fmt(t1 - t0, 0)} ms, ispecCac ${fmt(t2 - t1, 0)} ms per source)`);
  if (V && V.roundtrip) {
    const idx = dec(V.roundtrip.idx), val = dec(V.roundtrip.val), flat = join(a, b);
    const s = sdr(val, at(flat, idx));
    check(s >= 100, `ispecCac(specCac(x)) vs vectors.roundtrip (PyTorch _ispec(_spec(x))): SDR ${fmt(s)} dB >= 100`);
  }

  const st = trackStats(new Float32Array([1, 2, 3, 4]), new Float32Array([3, 4, 5, 6]));
  check(st.mean === 3.5 && Math.abs(st.std - Math.sqrt(5 / 3)) < 1e-15, `trackStats: mean ${st.mean}, unbiased std ${st.std.toFixed(6)} = sqrt(5/3)`);
}

// ================================================================ plan
section('plan');
{
  const w = transitionWeight();
  let exact = w.length === 343980;
  for (let j = 0; j < 171990 && exact; j++) if (w[j] !== Math.fround((j + 1) / 171990)) exact = false;
  for (let k = 0; k < 171990 && exact; k++) if (w[171990 + k] !== Math.fround((171990 - k) / 171990)) exact = false;
  check(exact, 'transitionWeight: w[j] = (j+1)/171990, w[171990+k] = (171990-k)/171990 for every sample (float32 equal)');
  let sum = 0; for (const v of w) sum += v;
  check(Math.abs(sum - 171991) / 171991 <= 1e-6, `transitionWeight sum ${sum.toFixed(4)} vs 171991 (= h + 1): relative ${sci(Math.abs(sum - 171991) / 171991)}`);
  const odd = transitionWeight(7);
  check([...odd].map(v => Math.round(v * 4)).join(',') === '1,2,3,4,3,2,1', `transitionWeight(7) = [1,2,3,4,3,2,1]/4 (odd length)`);

  const N = 441000;
  const p = segmentPlan(N);
  if (V && V.plan) {
    check(p.stride === V.plan.stride && JSON.stringify(p.offsets) === JSON.stringify(V.plan.offsets),
      `segmentPlan(${N}): stride ${p.stride}, offsets [${p.offsets}] = vectors.plan`);
    const zeros = new Float32Array(N);
    let okc = true;
    for (const c of V.plan.chunks) {
      const pc = paddedChunk(zeros, zeros, c.offset);
      const start = c.offset - pc.trimLeft;
      if (pc.chunkLen !== c.chunkLen || pc.trimLeft !== c.trimLeft || start !== c.start) okc = false;
    }
    check(okc, `paddedChunk chunkLen / start / trimLeft = vectors.plan.chunks (${V.plan.chunks.length} chunk(s))`);
    const sumW = weightSum(N), si = dec(V.plan.sumIdx), sv = dec(V.plan.sumVal);
    let rel = 0; for (let i = 0; i < si.length; i++) rel = Math.max(rel, Math.abs(sumW[si[i]] - sv[i]) / sv[i]);
    check(rel <= 1e-6, `weightSum(${N}) at ${si.length} vector indices: max relative ${sci(rel)} <= 1e-6`);
  } else {
    check(p.stride === 257985 && JSON.stringify(p.offsets) === '[0,257985]', `segmentPlan(${N}) = stride 257985, offsets [0, 257985] (CONTRACT 5.6)`);
    skip('paddedChunk / weightSum vs vectors.plan (vectors absent)');
  }
  // CONTRACT 3.2 example and the real-sample rule of paddedChunk.
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) { L[i] = i + 1; R[i] = -(i + 1); }
  const pc = paddedChunk(L, R, 257985);
  const start = 257985 - pc.trimLeft;
  check(pc.chunkLen === 183015 && pc.trimLeft === 80482 && start === 177503, `paddedChunk(441000, offset 257985): chunkLen ${pc.chunkLen}, start ${start}, trimLeft ${pc.trimLeft} (CONTRACT 5.6: 183015, 177503, 80482)`);
  const firstReal = pc.mix[0] === start + 1, lastReal = pc.mix[N - 1 - start] === N, afterZero = pc.mix[N - start] === 0 && pc.mix[343979] === 0;
  check(firstReal && lastReal && afterZero && pc.mix[343980] === -(start + 1), 'paddedChunk takes real samples before the offset, zeros after the track end, R after L');
  const p4 = segmentPlan(10584000);
  check(p4.offsets.length === 42, `segmentPlan(4 min = 10584000) has ${p4.offsets.length} segments (CONTRACT 2.4: 42)`);
  const so = shiftOffsetsFor(2);
  check(so.length === 2 && so.every(v => Number.isInteger(v) && v >= 0 && v <= 22050), `shiftOffsetsFor(2, 0x5eed) = [${so}] in 0..22050`);
}

// ================================================================ separate
section('separate');
{
  // Fake cores. The glue must give each stem = input. A core that returns
  // spec_out = mag alone cannot: _ispec(_spec(x)) is not the identity at
  // the segment edges (see the stft section), so CONTRACT 8.2's
  // "spec_out = mag, wave_out = 0" core gives about 31 dB, as PyTorch does.
  // The spec core here returns spec_out = (s+1) mag and wave_out =
  // (s+1) (mix - ispec(mag)): the two branches then add up to (s+1) mix
  // only when the spec and wave data of each source are read at the same
  // samples and the same source index. Stem s must be (s+1)(x - mean) + mean.
  const specCore = S => async (mag, mix) => {
    const so = new Float32Array(S * mag.length), wo = new Float32Array(S * mix.length);
    const [il, ir] = ispecCac(mag, 0, mix.length / 2);
    for (let s = 0; s < S; s++) {
      for (let i = 0; i < mag.length; i++) so[s * mag.length + i] = (s + 1) * mag[i];
      const o = s * mix.length, h = mix.length / 2;
      for (let i = 0; i < h; i++) { wo[o + i] = (s + 1) * (mix[i] - il[i]); wo[o + h + i] = (s + 1) * (mix[h + i] - ir[i]); }
    }
    return { spec_out: so, wave_out: wo };
  };
  const waveCore = S => async (mag, mix) => {
    const wo = new Float32Array(S * mix.length);
    for (let s = 0; s < S; s++) for (let i = 0; i < mix.length; i++) wo[s * mix.length + i] = (s + 1) * mix[i];
    return { spec_out: new Float32Array(S * mag.length), wave_out: wo };
  };
  const both = (x, y) => { const o = new Float32Array(x.length * 2); o.set(x); o.set(y, x.length); return o; };
  const cases = [
    ['spec path, 10 s, standard', 10, specCore(2), {}],
    ['wave path, 3 s (shorter than a segment), standard', 3, waveCore(2), {}],
    ['spec path, 10 s, shifts 2 at [1234, 20000]', 10, specCore(2), { shifts: 2, shiftOffsets: [1234, 20000] }],
    ['wave path, 20 s, shifts 2 from the seed', 20, waveCore(2), { shifts: 2 }],
  ];
  for (const [name, secs, core, extra] of cases) {
    const [L, R] = synthV1(secs);
    for (let i = 0; i < L.length; i++) { L[i] = L[i] * 0.7 + 0.01; R[i] = R[i] * 0.7 + 0.01; }   // offset mean, other std
    const prog = [];
    const t0 = performance.now();
    const out = await separate(L, R, { runCore: core, sources: 2, onProgress: p => prog.push(p), ...extra });
    const ms = performance.now() - t0;
    const { mean } = trackStats(L, R);
    const wantStem = k => both(L.map(v => k * (v - mean) + mean), R.map(v => k * (v - mean) + mean));
    const s0 = sdr(wantStem(1), both(out[0][0], out[0][1])), s1 = sdr(wantStem(2), both(out[1][0], out[1][1]));
    check(Math.min(s0, s1) >= 100, `separate, fake core, ${name}: stem s = (s+1)(x - mean) + mean, SDR ${fmt(s0)} / ${fmt(s1)} dB >= 100 (${prog.length} segments, ${fmt(ms / 1000, 1)} s)`);
    // progress: done 1..total once each; total = the real segment count.
    const shifts = extra.shifts || 0;
    let expect;
    if (shifts) {
      const offs = extra.shiftOffsets || shiftOffsetsFor(shifts);
      expect = offs.reduce((a, o) => a + segmentPlan(L.length + 22050 - o).offsets.length, 0);
    } else expect = segmentPlan(L.length).offsets.length;
    const seq = prog.map(p => p.done).join(',');
    const want = Array.from({ length: expect }, (_, i) => i + 1).join(',');
    check(seq === want && prog.every(p => p.total === expect) && prog.every(p => p.etaMs >= 0 && p.elapsedMs >= 0),
      `progress: done = 1..${expect} once each, total ${prog[0] && prog[0].total} = ${shifts ? 'sum of the segments of each shifted run' : 'segments'}` +
      (shifts ? ` (offsets.length x shifts would be ${segmentPlan(L.length).offsets.length * shifts})` : ''));
    check(prog.length ? prog[prog.length - 1].etaMs === 0 : false, `progress: etaMs 0 after the last segment`);
  }
  // Real samples before the offset reach the core (TensorChunk.padded).
  {
    const [L, R] = synthV1(10);
    const seen = [];
    await separate(L, R, { sources: 1, runCore: async (mag, mix) => { seen.push(mix.slice(0, 4)); return { spec_out: new Float32Array(mag.length), wave_out: new Float32Array(mix.length) }; } });
    const { mean, std } = trackStats(L, R);
    const want = Math.fround((L[177503] - mean) / (std + 1e-8));
    check(seen.length === 2 && Math.abs(seen[1][0] - want) < 1e-6, `segment 2 of 10 s starts at track sample 177503 (normalised ${want.toFixed(6)}, got ${seen[1] && seen[1][0].toFixed(6)})`);
  }
  // Cancel: isCancelled turns true during call 2.
  {
    const [L, R] = synthV1(20);
    let calls = 0, flag = false, after = 0, err = null;
    try {
      await separate(L, R, { sources: 1, isCancelled: () => flag, runCore: async (mag, mix) => {
        calls++; if (flag) after++; if (calls === 2) flag = true;
        return { spec_out: new Float32Array(mag.length), wave_out: new Float32Array(mix.length) };
      } });
    } catch (e) { err = e; }
    check(err && err.message === 'cancelled' && err.code === 'cancelled' && after <= 1 && calls === 2,
      `cancel: rejects with 'cancelled' (code ${err && err.code}); runCore calls ${calls} of ${segmentPlan(L.length).offsets.length}, ${after} after the flag (<= 1)`);
  }
  // Bad core output size is an error, not silent garbage.
  {
    const [L, R] = synthV1(1);
    let err = null;
    try { await separate(L, R, { sources: 4, runCore: async (mag, mix) => ({ spec_out: new Float32Array(mag.length), wave_out: new Float32Array(mix.length) }) }); } catch (e) { err = e; }
    check(err && /spec_out/.test(err.message), `separate rejects a core output of the wrong size: "${err && err.message}"`);
  }
}

// ================================================================ weights
section('weights');
{
  const { createHash } = await import('node:crypto');
  const sha = b => createHash('sha256').update(b).digest('hex');
  const body = new Uint8Array(300000); for (let i = 0; i < body.length; i++) body[i] = (i * 31) & 255;
  const good = sha(body);
  let fetches = 0;
  // A fetch that sends 3 chunks and a wrong content-length (as a gzip CDN can).
  const fakeFetch = (data, status = 200) => async () => {
    fetches++;
    if (status === 0) throw new TypeError('Failed to fetch');
    let i = 0; const parts = [data.subarray(0, 1000), data.subarray(1000, 200000), data.subarray(200000)];
    return { ok: status === 200, status, headers: new Map([['content-length', '12']]), body: { getReader: () => ({ read: async () => (i < parts.length ? { done: false, value: parts[i++] } : { done: true }) }) } };
  };
  class FakeCache {
    constructor() { this.m = new Map(); }
    async match(k) { const v = this.m.get(k); return v ? new Response(v) : undefined; }
    async put(k, res) { this.m.set(k, new Uint8Array(await res.arrayBuffer())); }
    async delete(k) { return this.m.delete(k); }
  }
  const cache = new FakeCache();
  const store = { open: async name => { check(name === 'stem-models-v1', `cache name "${name}"`); return cache; } };
  const url = 'https://example.test/stella-nova/pages/stem-splitter/models/x.th';
  const prog = [];
  const r1 = await W.getModelBytes(url, { bytes: body.length, sha256: good }, p => prog.push(p), { fetchImpl: fakeFetch(body), cacheStorage: store, persist: false });
  check(r1.fromCache === false && r1.data.length === body.length && sha(r1.data) === good, `getModelBytes: joins 3 chunks at their real size (${r1.data.length} B; content-length said 12), sha256 ok, fromCache false`);
  check(cache.m.has(url + '?sha=' + good), 'getModelBytes: stores under key URL + "?sha=" + sha256');
  check(prog.some(p => p.phase === 'verify'), `getModelBytes: progress phases ${[...new Set(prog.map(p => p.phase))].join(', ')}`);
  const before = fetches;
  const r2 = await W.getModelBytes(url, { bytes: body.length, sha256: good }, null, { fetchImpl: fakeFetch(body, 0), cacheStorage: store });
  check(r2.fromCache === true && fetches === before + 0 && sha(r2.data) === good, 'getModelBytes: cache hit with no network (fetch would throw), fromCache true');
  cache.m.set(url + '?sha=' + good, new Uint8Array(10));
  const r3 = await W.getModelBytes(url, { bytes: body.length, sha256: good }, null, { fetchImpl: fakeFetch(body), cacheStorage: store });
  check(r3.fromCache === false && sha(r3.data) === good, 'getModelBytes: a corrupt cache entry is dropped and fetched again');
  const bad = body.slice(); bad[5] ^= 1;
  let e1 = null; try { await W.getModelBytes(url + '2', { bytes: body.length, sha256: good }, null, { fetchImpl: fakeFetch(bad), cacheStorage: store }); } catch (e) { e1 = e; }
  check(e1 && e1.code === 'hash' && !cache.m.has(url + '2?sha=' + good), `getModelBytes: wrong bytes -> code '${e1 && e1.code}', not stored`);
  let e2 = null; try { await W.getModelBytes(url + '3', { bytes: 1, sha256: good }, null, { fetchImpl: fakeFetch(body, 0), cacheStorage: null }); } catch (e) { e2 = e; }
  let e3 = null; try { await W.getModelBytes(url + '3', { bytes: 1, sha256: good }, null, { fetchImpl: fakeFetch(body, 404), cacheStorage: null }); } catch (e) { e3 = e; }
  check(e2 && e2.code === 'net' && e3 && e3.code === 'net' && /404/.test(e3.message), `getModelBytes: offline -> '${e2 && e2.code}', HTTP 404 -> '${e3 && e3.code}'`);
  const base = 'https://example.test/stella-nova/pages/stem-splitter/';
  const M = { a: { graph: { file: 'models/a.onnx', sha256: 'g' }, weights: { file: 'models/a.th', sha256: 'w' } }, b: { graph: { file: 'models/b.onnx', sha256: 'g' }, weights: { file: 'models/b.th', sha256: 'w' } } };
  cache.m.set(base + 'models/a.onnx?sha=g', new Uint8Array(1)); cache.m.set(base + 'models/a.th?sha=w', new Uint8Array(1)); cache.m.set(base + 'models/b.onnx?sha=g', new Uint8Array(1));
  const c1 = await W.cachedModels(M, { cacheStorage: store, base });
  await W.evictModel(M.a, { cacheStorage: store, base });
  const c2 = await W.cachedModels(M, { cacheStorage: store, base });
  check(c1.a === true && c1.b === false && c2.a === false, `cachedModels: graph + weights both needed (a ${c1.a}, b ${c1.b}); after evictModel(a): ${c2.a}`);
  const none = await W.cachedModels(M, { cacheStorage: null });
  check(none.a === false && none.b === false, 'cachedModels with no Cache Storage (node): all false');
  check(W.modelUrl('models/x.onnx').endsWith('/stella-nova/pages/stem-splitter/models/x.onnx'), `modelUrl resolves against the page folder: ${W.modelUrl('models/x.onnx').split('/').slice(-4).join('/')}`);
}

// ================================================================ protocol
section('protocol');
// A fake ORT: every source gets spec_out = mag and wave_out = mix -
// ispec(mag), so a separation gives stems equal to the input.
function fakeOrt({ failGpuCreate = false, failGpuRun = false, oomRun = false } = {}) {
  const log = [];
  class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } async getData() { return this.data; } dispose() { this.disposed = true; } }
  const ort = {
    env: { wasm: {}, logLevel: 'warning' }, Tensor, log,
    InferenceSession: { async create(graph, opts) {
      const ep = opts.executionProviders[0];
      log.push({ create: ep, ext: opts.externalData && opts.externalData[0].path, graphBytes: graph.length, gol: opts.graphOptimizationLevel });
      if (ep === 'webgpu' && failGpuCreate) throw new Error('webgpu: no kernel for Mod');
      const S = graph[0];
      return {
        async run(feeds) {
          log.push({ run: ep, magDims: feeds.mag.dims, mixDims: feeds.mix.dims });
          if (ep === 'webgpu' && failGpuRun) throw new Error('GPU device lost');
          if (oomRun) throw new RangeError('Array buffer allocation failed');
          const mag = feeds.mag.data, mix = feeds.mix.data, h = mix.length / 2;
          const [il, ir] = ispecCac(mag, 0, h);
          const so = new Float32Array(S * mag.length), wo = new Float32Array(S * mix.length);
          for (let s = 0; s < S; s++) {
            so.set(mag, s * mag.length);
            for (let i = 0; i < h; i++) { wo[s * mix.length + i] = mix[i] - il[i]; wo[s * mix.length + h + i] = mix[h + i] - ir[i]; }
          }
          return { spec_out: new Tensor('float32', so, [1, S, 4, 2048, 336]), wave_out: new Tensor('float32', wo, [1, S, 2, 343980]) };
        },
        async release() { log.push({ release: ep }); },
      };
    } },
  };
  return ort;
}
const FAKE_MODELS = {
  two: { id: 'two', label: '2', note: '', stems: ['drums', 'vocals'], graph: { file: 'models/two.onnx', bytes: 10, sha256: 'g2' }, weights: { file: 'models/two.th', name: 'two.th', bytes: 20, sha256: 'w2' },
    inputs: { mag: [1, 4, 2048, 336], mix: [1, 2, 343980] } },
  three: { id: 'three', label: '3', note: '', stems: ['a', 'b', 'c'], graph: { file: 'models/three.onnx', bytes: 10, sha256: 'g3' }, weights: { file: 'models/three.th', name: 'three.th', bytes: 20, sha256: 'w3' },
    inputs: { mag: [1, 4, 2048, 336], mix: [1, 2, 343980] } },
};
function makeRt(ortOpts = {}, { gpu = true, isolated = false, failNet = false } = {}) {
  const ort = fakeOrt(ortOpts), posts = [], evicted = [];
  const rt = createRuntime({
    loadOrt: async () => ort, ortDir: 'https://example.test/vendor/', models: FAKE_MODELS,
    post: (m, transfer) => posts.push({ m, transfer: transfer || [] }),
    getBytes: async (url, meta, onp) => {
      if (failNet) throw Object.assign(new Error('download failed: HTTP 404'), { code: 'net' });
      onp({ phase: 'download', loaded: meta.bytes, total: meta.bytes }); onp({ phase: 'verify' });
      // first byte of the fake graph = number of sources
      const d = new Uint8Array(meta.bytes); d[0] = url.includes('three') ? 3 : 2; return { data: d, fromCache: false };
    },
    cached: async () => ({ two: true, three: false }), evict: async m => evicted.push(m.id),
    gpuAdapter: async () => gpu, env: { isolated, cores: 8 },
  });
  return { rt, ort, posts, evicted, reply: id => posts.find(p => p.m.id === id) };
}
{
  const { rt, ort, posts, reply, evicted } = makeRt();
  await rt.handle({ id: 1, op: 'init', ep: 'auto' });
  const r1 = reply(1).m;
  check(r1.ok && r1.result.ep === 'webgpu' && r1.result.gpu === true && r1.result.threads === 1 && r1.result.isolated === false && ort.env.wasm.wasmPaths === 'https://example.test/vendor/',
    `init: ${JSON.stringify(r1.result)}, wasmPaths set`);
  await rt.handle({ id: 2, op: 'load', model: 'two' });
  const r2 = reply(2).m;
  check(r2.ok && r2.result.model === 'two' && r2.result.ep === 'webgpu' && r2.result.fallback === null && r2.result.fromCache === false && 'downloadMs' in r2.result && 'createMs' in r2.result,
    `load: ${JSON.stringify(r2.result)}`);
  const c0 = ort.log.find(l => l.create);
  check(c0.ext === 'two.th' && c0.gol === 'all', `load: session externalData path "${c0.ext}" = weights.name, graphOptimizationLevel ${c0.gol}`);
  const ev = posts.filter(p => p.m.op === 'progress').map(p => p.m.phase);
  check(ev.includes('download') && ev.includes('verify') && ev.includes('session') && posts.filter(p => p.m.op === 'progress').every(p => p.m.model === 'two' && !('id' in p.m)),
    `load events (no id): ${[...new Set(ev)].join(', ')}`);
  const dl = posts.filter(p => p.m.phase === 'download').map(p => p.m);
  check(dl[dl.length - 1].loaded === 30 && dl[dl.length - 1].total === 30, `download events count graph + weights: last ${dl[dl.length - 1].loaded} of ${dl[dl.length - 1].total}`);

  const [L, R] = synthV1(9);
  const p0 = posts.length;
  await rt.handle({ id: 3, op: 'separate', model: 'two', left: L, right: R, quality: 'standard' });
  const r3 = reply(3);
  const st = r3.m.result && r3.m.result.stems;
  const okShape = st && Object.keys(st).join(',') === 'drums,vocals' && st.drums[0].length === L.length;
  const tr = r3.transfer;
  check(r3.m.ok && okShape && tr.length === 4 && tr.includes(st.drums[0].buffer) && tr.includes(st.vocals[1].buffer),
    `separate: stems ${st && Object.keys(st).join(', ')}, ${tr.length} buffers in the transfer list, segments ${r3.m.result && r3.m.result.segments}, ep ${r3.m.result && r3.m.result.ep}`);
  const both = (x, y) => { const o = new Float32Array(x.length * 2); o.set(x); o.set(y, x.length); return o; };
  check(sdr(both(L, R), both(st.vocals[0], st.vocals[1])) >= 100, `separate through the runtime: stem = input, SDR ${fmt(sdr(both(L, R), both(st.vocals[0], st.vocals[1])))} dB`);
  const sp = posts.slice(p0).filter(p => p.m.op === 'progress').map(p => p.m);
  check(sp.length === 2 && sp.every(p => p.phase === 'separate' && p.model === 'two' && 'etaMs' in p && 'elapsedMs' in p) && sp[1].done === 2 && sp[1].total === 2,
    `separate events: ${sp.map(p => p.done + '/' + p.total).join(' ')}`);
  const runs = ort.log.filter(l => l.run);
  check(JSON.stringify(runs[0].magDims) === '[1,4,2048,336]' && JSON.stringify(runs[0].mixDims) === '[1,2,343980]', `core feeds: mag ${JSON.stringify(runs[0].magDims)}, mix ${JSON.stringify(runs[0].mixDims)}`);

  // best quality: shifts 2 with given offsets
  await rt.handle({ id: 4, op: 'separate', model: 'two', left: L.slice(), right: R.slice(), quality: 'best', shiftOffsets: [0, 22050] });
  const r4 = reply(4).m;
  check(r4.ok && r4.result.segments === 4, `separate quality best: shifts 2, segments ${r4.result && r4.result.segments}`);

  // cancel during a separate: the reply is 'cancelled'
  const big = synthV1(25);
  const pr = rt.handle({ id: 5, op: 'separate', model: 'two', left: big[0], right: big[1], quality: 'standard' });
  await new Promise(r => setTimeout(r, 0));
  await rt.handle({ id: 6, op: 'cancel' });
  await pr;
  const r5 = reply(5).m, r6 = reply(6).m;
  check(r6.ok && r6.result.cancelled === true && !r5.ok && r5.code === 'cancelled', `cancel: reply ${JSON.stringify(r6.result)}; separate -> ok ${r5.ok}, code '${r5.code}'`);

  await rt.handle({ id: 7, op: 'cached' });
  check(JSON.stringify(reply(7).m.result) === '{"two":true,"three":false}', `cached: ${JSON.stringify(reply(7).m.result)}`);
  await rt.handle({ id: 8, op: 'load', model: 'three' });
  check(reply(8).m.ok && ort.log.some(l => l.release === 'webgpu'), 'load of another model releases the old session first');
  await rt.handle({ id: 9, op: 'evict', model: 'three' });
  check(reply(9).m.ok && reply(9).m.result.model === 'three' && evicted[0] === 'three' && rt.state.model === null, `evict: ${JSON.stringify(reply(9).m.result)}, session of that model released`);
  await rt.handle({ id: 10, op: 'load', model: 'two' });
  await rt.handle({ id: 11, op: 'dispose' });
  check(reply(11).m.ok && JSON.stringify(reply(11).m.result) === '{}' && rt.state.model === null, 'dispose: {} and no session left');
  await rt.handle({ id: 12, op: 'bogus' });
  check(!reply(12).m.ok && typeof reply(12).m.error === 'string' && reply(12).m.code, `unknown op: ok false, error "${reply(12).m.error}", code '${reply(12).m.code}'`);
}
{
  const a = makeRt({ failGpuCreate: true });
  await a.rt.handle({ id: 1, op: 'init', ep: 'auto' });
  await a.rt.handle({ id: 2, op: 'load', model: 'two' });
  const r = a.reply(2).m.result;
  check(r.ep === 'wasm' && /no kernel for Mod/.test(r.fallback), `WebGPU session fails to build -> wasm, fallback "${r.fallback}"`);
  const b = makeRt({ failGpuRun: true });
  await b.rt.handle({ id: 1, op: 'init', ep: 'auto' });
  const [L, R] = synthV1(2);
  await b.rt.handle({ id: 2, op: 'separate', model: 'two', left: L, right: R, quality: 'standard' });
  const rb = b.reply(2).m;
  check(rb.ok && rb.result.ep === 'wasm' && /device lost/.test(rb.result.fallback) && b.ort.log.filter(l => l.create === 'wasm').length === 1,
    `first WebGPU run throws -> wasm session, segment repeated: ok ${rb.ok}, ep ${rb.result && rb.result.ep}, fallback "${rb.result && rb.result.fallback}"`);
  const c = makeRt({ oomRun: true }, { gpu: false });
  await c.rt.handle({ id: 1, op: 'init', ep: 'auto' });
  check(c.reply(1).m.result.ep === 'wasm', 'init with no adapter -> ep wasm');
  await c.rt.handle({ id: 2, op: 'separate', model: 'two', left: L.slice(), right: R.slice(), quality: 'standard' });
  check(c.reply(2).m.code === 'oom', `RangeError "Array buffer allocation failed" in a run -> code '${c.reply(2).m.code}'`);
  const d = makeRt({}, { failNet: true });
  await d.rt.handle({ id: 1, op: 'init', ep: 'wasm' });
  await d.rt.handle({ id: 2, op: 'load', model: 'two' });
  check(d.reply(2).m.code === 'net', `model download fails -> code '${d.reply(2).m.code}'`);
  const e = makeRt({}, { isolated: true });
  await e.rt.handle({ id: 1, op: 'init', ep: 'wasm' });
  const re = e.reply(1).m.result;
  check(re.threads === 4 && re.isolated === true && re.gpu === false && re.ep === 'wasm' && e.ort.env.wasm.numThreads === 4, `init ep 'wasm', cross-origin isolated, 8 cores: ${JSON.stringify(re)}`);
}
// client.js with a fake Worker that runs a runtime in this process.
class FakeWorker {
  static count = 0;
  constructor(url, opts) {
    FakeWorker.count++; this.opts = opts; this.dead = false;
    this.rt = createRuntime({
      loadOrt: async () => fakeOrt(), models: FAKE_MODELS, gpuAdapter: async () => false, env: { isolated: false, cores: 4 },
      getBytes: async (u, meta) => { const d = new Uint8Array(meta.bytes); d[0] = 2; return { data: d, fromCache: true }; },
      cached: async () => ({ two: true, three: false }), evict: async () => {},
      post: (m, transfer) => { if (!this.dead) { this.lastTransfer = transfer; setTimeout(() => this.onmessage && this.onmessage({ data: m }), 0); } },
    });
  }
  postMessage(m, transfer) { this.sent = (this.sent || 0) + 1; this.transferIn = transfer; setTimeout(() => this.rt.handle(m), 0); }
  terminate() { this.dead = true; }
}
{
  const savedWin = globalThis.window;
  globalThis.window = { __snRelease: () => { globalThis.window.prevCalled = true; } };
  const eng = createEngine({ WorkerImpl: FakeWorker, workerUrl: 'x', modelsLoader: async () => FAKE_MODELS });
  const info = await eng.init({ ep: 'auto' });
  check(info.ep === 'wasm' && info.threads === 1 && FakeWorker.count === 1, `client init: ${JSON.stringify(info)}`);
  const list = await eng.models();
  check(list.length === 2 && list[0].bytes === 30 && list[0].cached === true && list[1].cached === false && list[0].stems.join() === 'drums,vocals',
    `client models(): ${list.map(m => m.id + ' ' + m.bytes + ' B cached ' + m.cached).join('; ')}`);
  const lp = [];
  const lr = await eng.load('two', p => lp.push(p.phase));
  check(lr.ep === 'wasm' && lr.fromCache === true && lp.includes('session'), `client load: ep ${lr.ep}, fromCache ${lr.fromCache}, events ${[...new Set(lp)].join(', ')}`);
  const [L, R] = synthV1(3);
  const sp = [];
  const res = await eng.separate({ modelId: 'two', left: L, right: R, quality: 'standard', onProgress: p => sp.push(p) });
  check(res.stems.drums[0].length === L.length && L.length === 132300 && sp.length === 1 && sp[0].phase === 'separate',
    `client separate: stems ${Object.keys(res.stems).join(', ')}, caller arrays kept (length ${L.length}), ${sp.length} progress event(s)`);
  // terminate during a separate: the call rejects, the next call starts a new worker
  const big = synthV1(25);
  const pending = eng.separate({ modelId: 'two', left: big[0], right: big[1], quality: 'standard' });
  window.__snRelease();
  let err = null; try { await pending; } catch (e) { err = e; }
  check(err && err.code === 'cancelled' && window.prevCalled === true, `window.__snRelease -> terminate: pending call rejects '${err && err.message}' (code ${err && err.code}), previous __snRelease still called`);
  const again = await eng.models();
  check(FakeWorker.count === 2 && again.length === 2, `next call after terminate starts a new worker (${FakeWorker.count} started) and repeats init`);
  // cancel through the client
  const p2 = eng.separate({ modelId: 'two', left: big[0], right: big[1], quality: 'standard' });
  setTimeout(() => eng.cancel(), 5);
  let e2 = null; try { await p2; } catch (e) { e2 = e; }
  check(e2 && e2.code === 'cancelled', `client cancel(): separate rejects with code '${e2 && e2.code}'`);
  eng.terminate();
  if (savedWin === undefined) delete globalThis.window; else globalThis.window = savedWin;
}

// A failed init must not block the engine: after the network comes back,
// the next call repeats init on the same worker (review: init stuck).
{
  let offline = true, inits = 0;
  class FlakyWorker extends FakeWorker {
    constructor(url, opts) {
      super(url, opts);
      const self_ = this;
      this.rt = createRuntime({
        loadOrt: async () => { inits++; if (offline) throw new TypeError('Failed to fetch dynamically imported module'); return fakeOrt(); },
        models: FAKE_MODELS, gpuAdapter: async () => false, env: { isolated: false, cores: 4 },
        getBytes: async (u, meta) => { const d = new Uint8Array(meta.bytes); d[0] = 2; return { data: d, fromCache: true }; },
        cached: async () => ({ two: true, three: false }), evict: async () => {},
        post: (m) => { if (!self_.dead) setTimeout(() => self_.onmessage && self_.onmessage({ data: m }), 0); },
      });
    }
  }
  const eng = createEngine({ WorkerImpl: FlakyWorker, workerUrl: 'x', modelsLoader: async () => FAKE_MODELS });
  let e1 = null; try { await eng.init({ ep: 'auto' }); } catch (e) { e1 = e; }
  offline = false;
  let lr = null, e2 = null; try { lr = await eng.load('two'); } catch (e) { e2 = e; }
  check(e1 && !e2 && lr && lr.model === 'two' && inits === 2,
    `client: init fails offline ("${e1 && e1.message}"), then load after the network is back -> ${e2 ? 'rejects "' + e2.message + '"' : 'ok'}, loadOrt calls ${inits} (want 2)`);
  eng.terminate();
}

// ================================================================ real
section('real');
if (QUICK) skip('real graph tests (--quick)');
else {
  const ORT_FILE = path.join(VENDOR, 'ort.min.mjs');
  const filesFor = id => { const m = MODELS[id]; return m ? { graph: path.join(MODEL_DIR, path.basename(m.graph.file)), weights: path.join(MODEL_DIR, m.weights.name) } : null; };
  const have = id => { const f = filesFor(id); return f && fs.existsSync(f.graph) && fs.existsSync(f.weights); };
  const absentMsg = id => {
    const f = filesFor(id);
    if (!f) return 'model ' + id + ' not in models.js';
    if (!fs.existsSync(f.weights)) return 'weights absent: node tools/stem-splitter/fetch.mjs';
    return 'graph absent: ' + path.relative(process.cwd(), f.graph);
  };
  let ort = null;
  if (!fs.existsSync(ORT_FILE)) skip('real graph: vendored ort.min.mjs absent');
  else {
    ort = await import(pathToFileURL(ORT_FILE).href);
    ort.env.wasm.wasmPaths = VENDOR + '/';   // a plain path: node's fetch cannot read file: URLs
    ort.env.wasm.numThreads = 4;
    ort.env.logLevel = 'error';
  }
  const rssMB = () => Math.round(process.memoryUsage().rss / 1048576);
  // A runtime with the real ORT that reads local model files.
  const realRt = (posts) => createRuntime({
    loadOrt: async () => ort, ortDir: null, models: MODELS, gpuAdapter: async () => false, env: { isolated: true, cores: 4 },
    getBytes: async (url, meta) => {
      const name = url.split('/').pop();
      const id = Object.keys(MODELS).find(k => MODELS[k].weights.name === name || path.basename(MODELS[k].graph.file) === name);
      const f = filesFor(id);
      const p = name.endsWith('.th') ? f.weights : f.graph;
      return { data: new Uint8Array(fs.readFileSync(p)), fromCache: true };
    },
    post: (m, transfer) => posts.push({ m, transfer }),
  });

  try {
  for (const id of ['htdemucs', 'htdemucs_6s']) {
    if (!ort) break;
    if (!have(id)) { skip(`real ${id} core vs vectors.core (${absentMsg(id)})`); continue; }
    if (!V || !V.core || !V.core[id]) { skip(`real ${id} core (vectors.core.${id} absent)`); continue; }
    const m = MODELS[id], C = V.core[id], f = filesFor(id);
    const t0 = performance.now();
    const sess = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(f.graph)), {
      executionProviders: ['wasm'], graphOptimizationLevel: 'all', externalData: [{ path: m.weights.name, data: new Uint8Array(fs.readFileSync(f.weights)) }] });
    const createMs = performance.now() - t0;
    // segment 0 of synth-v1 10 s, track-normalised, cut and STFT'd by our code
    const [L, R] = synthV1(10);
    const { mean, std } = trackStats(L, R);
    const nl = L.map(v => (v - mean) / (std + 1e-8)), nr = R.map(v => (v - mean) / (std + 1e-8));
    const { mix } = paddedChunk(nl, nr, 0);
    const mag = specCac(mix.subarray(0, 343980), mix.subarray(343980));
    const sm = sdr(dec(C.magVal), at(mag, dec(C.magIdx)));
    check(sm >= 100, `${id}: our mag of segment 0 vs vectors.core.${id}.magVal: SDR ${fmt(sm)} dB >= 100`);
    const t1 = performance.now();
    const out = await sess.run({ mag: new ort.Tensor('float32', mag, m.inputs.mag), mix: new ort.Tensor('float32', mix, m.inputs.mix) });
    const runMs = performance.now() - t1;
    const ss = sdr(dec(C.specVal), at(out.spec_out.data, dec(C.specIdx)));
    const sw = sdr(dec(C.waveVal), at(out.wave_out.data, dec(C.waveIdx)));
    check(ss >= 60 && sw >= 60, `${id}: ONNX core (ORT-web wasm, 4 threads, node) vs PyTorch Core: spec SDR ${fmt(ss)} dB, wave SDR ${fmt(sw)} dB >= 60 (create ${fmt(createMs / 1000, 2)} s, run ${fmt(runMs / 1000, 2)} s, rss ${rssMB()} MB)`);
    await sess.release();
  }

  if (ort && have('htdemucs') && V && V.pipeline && V.pipeline.htdemucs) {
    const posts = [];
    const rt = realRt(posts);
    const reply = id => posts.find(p => p.m.id === id);
    await rt.handle({ id: 1, op: 'init', ep: 'wasm' });
    await rt.handle({ id: 2, op: 'load', model: 'htdemucs' });
    check(reply(2).m.ok, `real runtime load htdemucs: ${JSON.stringify(reply(2).m.result || reply(2).m.error)}`);
    for (const [key, quality] of [['htdemucs', 'standard'], ['htdemucs_shift', 'best']]) {
      const P = V.pipeline[key];
      if (!P) { skip(`real pipeline ${key} (vectors.pipeline.${key} absent)`); continue; }
      const [L, R] = synthV1(P.seconds);
      const msg = { id: 10 + quality.length, op: 'separate', model: 'htdemucs', left: L, right: R, quality };
      if (key === 'htdemucs_shift') msg.shiftOffsets = P.shiftOffsets;
      const t0 = performance.now();
      await rt.handle(msg);
      const r = reply(msg.id).m;
      if (!check(r.ok, `real pipeline ${key}: ok (${r.ok ? r.result.segments + ' segments, ' + fmt((performance.now() - t0) / 1000, 1) + ' s' : r.error})`)) continue;
      const parts = [];
      let worst = Infinity;
      for (const [stem, ref] of Object.entries(P.stems)) {
        const idx = dec(ref.idx), got = r.result.stems[stem];
        const refv = new Float32Array(idx.length * 2); refv.set(dec(ref.L)); refv.set(dec(ref.R), idx.length);
        const est = new Float32Array(idx.length * 2); est.set(at(got[0], idx)); est.set(at(got[1], idx), idx.length);
        const s = sdr(refv, est);
        worst = Math.min(worst, s); parts.push(stem + ' ' + fmt(s, 1));
        let e = 0; for (let c = 0; c < 2; c++) for (const v of got[c]) e += v * v;
        if (Math.abs(e - ref.energy) / ref.energy > 1e-3) parts.push(stem + ' energy rel diff ' + sci(Math.abs(e - ref.energy) / ref.energy));
      }
      check(worst >= 50, `real pipeline ${key} (synth-v1 ${P.seconds} s, ${quality}${P.shiftOffsets && P.shiftOffsets.length ? ', offsets ' + P.shiftOffsets.join('/') : ''}) vs PyTorch apply_model: SDR per stem ${parts.join(', ')} dB (>= 50)`);
    }
    await rt.handle({ id: 30, op: 'dispose' });
    console.log(`     node rss after the real runs: ${rssMB()} MB`);
  } else if (ort) skip(`real pipeline htdemucs (${have('htdemucs') ? 'vectors.pipeline absent' : absentMsg('htdemucs')})`);
  } catch (e) { check(false, 'real graph tests threw: ' + String(e && e.message || e).slice(0, 300)); }
}

console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
process.exit(fails ? 1 : 0);

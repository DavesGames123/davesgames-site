// ============================================================================
//  SEGMENT  ·  stem-splitter/engine/segment.js — split, run, overlap-add
// ----------------------------------------------------------------------------
//  separate() is the whole Demucs forward pass around the ONNX core
//  (CONTRACT 3.1 - 3.4): track normalisation, the shifts, the segment plan
//  with its triangle weights, STFT -> core -> iSTFT per segment, the
//  overlap-add and the de-normalisation. The core is a callback
//  (runCore), so node tests can pass a fake one and the worker passes the
//  onnxruntime-web session.
//
//  Port of Demucs (MIT, Copyright (c) Meta Platforms, Inc. and affiliates):
//    demucs/apply.py   apply_model (shifts branch, split branch, the
//                      single-chunk branch), TensorChunk.padded
//    demucs/utils.py   center_trim
//    demucs/api.py     Separator.separate_tensor (mean / std of the mix)
//
//  Memory: one output array per stem and channel (length N). The weight
//  sum of each run is known before the run, so every segment adds
//  weight / sum / shifts straight into the output; no second accumulator.
//  The input is normalised on the fly when a chunk is cut, so no
//  normalised copy of the track is made. Before each segment separate()
//  waits one macrotask, so a worker can read a cancel message.
//
//  GREP MAP
//    constants ............. "export const SEGMENT"
//    plan .................. "export function segmentPlan"
//    triangle weight ....... "export function transitionWeight"
//    weight sum ............ "export function weightSum"
//    padded chunk .......... "export function paddedChunk"  ("function cutChunk")
//    shift offsets ......... "export function shiftOffsetsFor"
//    full pass ............. "export async function separate"
// ============================================================================
import { specCac, ispecCac, trackStats } from './dsp.js';
import { mulberry32 } from './synth.js';

export const SEGMENT = 343980, OVERLAP = 0.25, MAX_SHIFT = 22050, SAMPLE_RATE = 44100;

// apply.py split branch: stride = int((1 - overlap) * segment);
// offsets = range(0, n, stride).
export function segmentPlan(n, { segment = SEGMENT, overlap = OVERLAP } = {}) {
  const stride = Math.trunc((1 - overlap) * segment);
  const offsets = [];
  for (let o = 0; o < n; o += stride) offsets.push(o);
  return { stride, offsets };
}

// cat(arange(1, seg//2 + 1), arange(seg - seg//2, 0, -1)) / max, power 1.
export function transitionWeight(segment = SEGMENT) {
  const h = Math.floor(segment / 2), w = new Float32Array(segment);
  let max = 0;
  for (let j = 0; j < h; j++) w[j] = j + 1;
  for (let k = 0; k < segment - h; k++) w[h + k] = segment - h - k;
  for (let j = 0; j < segment; j++) if (w[j] > max) max = w[j];
  for (let j = 0; j < segment; j++) w[j] = w[j] / max;
  return w;
}

// sum_weight of the split branch for a track of n samples (float64).
export function weightSum(n, { segment = SEGMENT, overlap = OVERLAP, weight = transitionWeight(segment) } = {}) {
  const { offsets } = segmentPlan(n, { segment, overlap });
  const sum = new Float64Array(n);
  for (const o of offsets) {
    const len = Math.min(n - o, segment);
    for (let j = 0; j < len; j++) sum[o + j] += weight[j];
  }
  return sum;
}

// TensorChunk(track, offset, segment).padded(segment), with the track
// given by a sample function src(i) that is 0 outside the track. Writes
// [L..., R...] into mix (Float32Array 2*segment).
function cutChunk(srcL, srcR, n, offset, segment, mix) {
  const chunkLen = Math.min(n - offset, segment);
  const delta = segment - chunkLen, start = offset - Math.floor(delta / 2);
  for (let j = 0; j < segment; j++) {
    const i = start + j;
    mix[j] = srcL(i); mix[segment + j] = srcR(i);
  }
  return { chunkLen, start, trimLeft: Math.floor(delta / 2) };
}

export function paddedChunk(left, right, offset, segment = SEGMENT) {
  const n = left.length, mix = new Float32Array(2 * segment);
  const L = i => (i >= 0 && i < n ? left[i] : 0), R = i => (i >= 0 && i < n ? right[i] : 0);
  const { chunkLen, trimLeft } = cutChunk(L, R, n, offset, segment, mix);
  return { mix, chunkLen, trimLeft };
}

// The shift offsets: upstream draws random.randint(0, max_shift); we draw
// floor(rng() * (MAX_SHIFT + 1)) from mulberry32(seed) (CONTRACT 3.3).
export function shiftOffsetsFor(shifts, seed = 0x5eed, maxShift = MAX_SHIFT) {
  const rng = mulberry32(seed), out = [];
  for (let k = 0; k < shifts; k++) out.push(Math.floor(rng() * (maxShift + 1)));
  return out;
}

const cancelled = () => Object.assign(new Error('cancelled'), { code: 'cancelled' });
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// The full pass. Returns Float32Array[S][2], each of length N.
export async function separate(left, right, opts = {}) {
  const {
    runCore, sources, overlap = OVERLAP, shifts = 0, shiftOffsets, seed = 0x5eed,
    onProgress, isCancelled, segment = SEGMENT, maxShift = MAX_SHIFT, yieldEvents = true,
  } = opts;
  if (typeof runCore !== 'function') throw new Error('separate: runCore is required');
  if (!(sources > 0)) throw new Error('separate: sources must be > 0');
  const n = left.length;
  if (right.length !== n) throw new Error('separate: channel lengths differ');
  if (n === 0) throw new Error('separate: empty track');

  // 3.1 track normalisation (applied when a chunk is cut).
  const { mean, std } = trackStats(left, right);
  const div = std + 1e-8, inv = 1 / div;

  // 3.3 the runs: one with no shift, or K shifted runs.
  const runs = [];
  if (shifts > 0) {
    const offs = shiftOffsets ? shiftOffsets.slice(0, shifts) : shiftOffsetsFor(shifts, seed, maxShift);
    if (offs.length !== shifts) throw new Error('separate: need ' + shifts + ' shift offsets');
    for (const off of offs) {
      if (!(off >= 0 && off <= maxShift)) throw new Error('separate: shift offset out of range: ' + off);
      // The shifted track is the zero-padded track from `off`; shifted
      // index i is track index i + off - maxShift. Its output is kept from
      // maxShift - off, so output index j of the shifted run is track
      // index j - (maxShift - off), the same mapping.
      runs.push({ len: n + maxShift - off, lag: off - maxShift });
    }
  } else {
    runs.push({ len: n, lag: 0 });
  }
  const weight = transitionWeight(segment);
  const plans = runs.map(r => segmentPlan(r.len, { segment, overlap }));
  const total = plans.reduce((a, p) => a + p.offsets.length, 0);

  const out = [];
  for (let s = 0; s < sources; s++) out.push([new Float32Array(n), new Float32Array(n)]);
  const mix = new Float32Array(2 * segment);
  const segTimes = [];
  const t0 = now();
  let done = 0;

  for (let r = 0; r < runs.length; r++) {
    const { len, lag } = runs[r];
    const sum = weightSum(len, { segment, overlap, weight });
    const runScale = 1 / runs.length;
    // Shifted-track sample i -> track sample i + lag, normalised; 0 outside
    // the shifted track and outside the track.
    const srcL = i => { if (i < 0 || i >= len) return 0; const k = i + lag; return k >= 0 && k < n ? (left[k] - mean) * inv : 0; };
    const srcR = i => { if (i < 0 || i >= len) return 0; const k = i + lag; return k >= 0 && k < n ? (right[k] - mean) * inv : 0; };
    for (const offset of plans[r].offsets) {
      // A wasm run can finish with no macrotask in between, so a cancel
      // message would wait for the whole song. Let queued events run first.
      if (yieldEvents && typeof setTimeout === 'function') await new Promise(res => setTimeout(res, 0));
      if (isCancelled && isCancelled()) throw cancelled();
      const ts = now();
      const { chunkLen, trimLeft } = cutChunk(srcL, srcR, len, offset, segment, mix);
      const mag = specCac(mix.subarray(0, segment), mix.subarray(segment));
      const res = await runCore(mag, mix);
      const specOut = res.spec_out, waveOut = res.wave_out;
      if (!specOut || specOut.length !== sources * mag.length) throw new Error('separate: spec_out has ' + (specOut && specOut.length) + ' values, want ' + sources * mag.length);
      if (!waveOut || waveOut.length !== sources * 2 * segment) throw new Error('separate: wave_out has ' + (waveOut && waveOut.length) + ' values, want ' + sources * 2 * segment);
      for (let s = 0; s < sources; s++) {
        const spec = ispecCac(specOut, s, segment);
        for (let c = 0; c < 2; c++) {
          const y = spec[c], wv = waveOut.subarray((s * 2 + c) * segment, (s * 2 + c + 1) * segment);
          const dst = out[s][c];
          // center_trim: drop trimLeft samples at the left, keep chunkLen.
          for (let j = 0; j < chunkLen; j++) {
            const k = offset + j + lag;                      // track index
            if (k < 0 || k >= n) continue;                   // outside the kept part
            const src = trimLeft + j;
            dst[k] += (wv[src] + y[src]) * weight[j] / sum[offset + j] * runScale;
          }
        }
      }
      done++;
      segTimes.push(now() - ts);
      if (onProgress) {
        const elapsedMs = now() - t0;
        const pool = segTimes.length > 1 ? segTimes.slice(1) : segTimes;
        const meanMs = pool.reduce((a, b) => a + b, 0) / pool.length;
        onProgress({ done, total, elapsedMs, etaMs: meanMs * (total - done) });
      }
    }
  }
  // 3.1 de-normalisation of every stem.
  for (let s = 0; s < sources; s++) for (let c = 0; c < 2; c++) {
    const d = out[s][c];
    for (let i = 0; i < n; i++) d[i] = d[i] * div + mean;
  }
  return out;
}

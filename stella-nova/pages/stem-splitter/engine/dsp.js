// ============================================================================
//  DSP  ·  stem-splitter/engine/dsp.js — STFT, iSTFT and the CaC layout
// ----------------------------------------------------------------------------
//  The spectrogram side of HTDemucs, ported to JS. The ONNX graph holds the
//  network core only (CONTRACT 2.3); this module makes its "mag" input and
//  turns its "spec_out" output back into audio (CONTRACT 3.1 and 3.4).
//
//  Port of Demucs (MIT, Copyright (c) Meta Platforms, Inc. and affiliates):
//    demucs/spec.py      spectro, ispectro   -> stft, istft
//    demucs/htdemucs.py  HTDemucs._spec      -> specCac
//                        HTDemucs._ispec     -> ispecCac
//                        HTDemucs._magnitude, _mask (cac=True): the layout
//                        [L.re, L.im, R.re, R.im] of mag and spec_out
//    demucs/api.py       Separator.separate_tensor normalisation -> trackStats
//  stft and istft follow torch.stft / torch.istft with window = periodic
//  hann(nfft), win_length = nfft, center = True, pad_mode = 'reflect'.
//  All maths in float64; the outputs are Float32Array.
//
//  Spectrogram layout: [bins][frames], row major (index f * frames + t),
//  the same as a torch [freqs, frames] tensor. specCac and ispecCac pack two
//  real signals into one complex FFT (L in re, R in im), so each frame
//  costs one 4096 FFT for both channels.
//
//  GREP MAP
//    window .................. "export function hann"
//    reflect padding ......... "function reflectIndex"
//    generic STFT ............ "export function stft"
//    generic iSTFT ........... "export function istft"
//    _spec + CaC ............. "export function specCac"
//    _ispec for one source ... "export function ispecCac"
//    track mean / std ........ "export function trackStats"
// ============================================================================
import { makeFFT } from './fft.js';

export const NFFT = 4096, HOP = 1024, SEG = 343980;

const HANN = new Map();
export function hann(n) {
  if (HANN.has(n)) return HANN.get(n);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);   // periodic
  HANN.set(n, w);
  return w;
}

// torch 'reflect' padding: mirror without repeating the edge sample.
// Valid while the pad is shorter than the signal (always true here).
function reflectIndex(i, n) {
  if (i < 0) return -i;
  if (i >= n) return 2 * (n - 1) - i;
  return i;
}

// x (length n) with `left` and `right` reflect padding, as Float64Array.
function reflectPad(x, left, right) {
  const n = x.length;
  if (left >= n || right >= n) throw new Error('reflect pad longer than the signal');
  const out = new Float64Array(n + left + right);
  for (let i = 0; i < out.length; i++) out[i] = x[reflectIndex(i - left, n)];
  return out;
}

// ---------------------------------------------------------------- generic
// torch.stft(x, nfft, hop, window=hann(nfft), center=True, reflect,
// normalized, onesided). Returns { re, im, bins, frames } (Float64Array).
export function stft(x, { nfft = NFFT, hop = nfft >> 2, normalized = true } = {}) {
  const fft = makeFFT(nfft), w = hann(nfft), half = nfft >> 1;
  const xp = reflectPad(x, half, half);
  const frames = 1 + Math.floor((xp.length - nfft) / hop), bins = half + 1;
  const re = new Float64Array(bins * frames), im = new Float64Array(bins * frames);
  const fr = new Float64Array(nfft), fi = new Float64Array(nfft);
  const scale = normalized ? 1 / Math.sqrt(nfft) : 1;
  for (let t = 0; t < frames; t++) {
    const o = t * hop;
    for (let j = 0; j < nfft; j++) { fr[j] = xp[o + j] * w[j]; fi[j] = 0; }
    fft.forward(fr, fi);
    for (let f = 0; f < bins; f++) { re[f * frames + t] = fr[f] * scale; im[f * frames + t] = fi[f] * scale; }
  }
  return { re, im, bins, frames };
}

// torch.istft(z, nfft, hop, window=hann(nfft), center=True, normalized,
// length). re/im: [nfft/2 + 1][frames]. The imaginary part of the DC and
// Nyquist bins is ignored, as irfft does.
export function istft(re, im, { nfft = NFFT, hop = nfft >> 2, normalized = true, length } = {}) {
  const fft = makeFFT(nfft), w = hann(nfft), half = nfft >> 1, bins = half + 1;
  const frames = re.length / bins;
  if (!Number.isInteger(frames)) throw new Error('istft: data length is not bins x frames');
  const total = nfft + hop * (frames - 1);
  const y = new Float64Array(total), env = new Float64Array(total);
  const fr = new Float64Array(nfft), fi = new Float64Array(nfft);
  const scale = (normalized ? Math.sqrt(nfft) : 1);
  for (let t = 0; t < frames; t++) {
    for (let f = 0; f < bins; f++) { fr[f] = re[f * frames + t]; fi[f] = im[f * frames + t]; }
    fi[0] = 0; fi[half] = 0;
    for (let f = half + 1; f < nfft; f++) { fr[f] = fr[nfft - f]; fi[f] = -fi[nfft - f]; }
    fft.inverse(fr, fi);
    const o = t * hop;
    for (let j = 0; j < nfft; j++) { y[o + j] += fr[j] * scale * w[j]; env[o + j] += w[j] * w[j]; }
  }
  const start = half;
  const len = length === undefined ? total - 2 * half : length;
  const out = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const k = start + i;
    if (k >= total) break;                    // torch pads with zeros past the end
    out[i] = env[k] > 1e-11 ? y[k] / env[k] : y[k];
  }
  return out;
}

// ---------------------------------------------------------------- HTDemucs
// HTDemucs._spec for both channels, then _magnitude (cac): Float32Array
// [4][2048][le], channels [L.re, L.im, R.re, R.im]. le = ceil(len / HOP)
// (336 for a 343980 segment).
export function specCac(left, right, out) {
  const n = left.length;
  if (right.length !== n) throw new Error('specCac: channel lengths differ');
  const le = Math.ceil(n / HOP), pad = (HOP >> 1) * 3, bins = NFFT >> 1, half = NFFT >> 1;
  const fft = makeFFT(NFFT), w = hann(NFFT);
  // _spec pad (pad, pad + le*HOP - n), then stft center pad nfft/2: one
  // Float64Array per channel with both reflections done.
  const lp = reflectPad(reflectPad(left, pad, pad + le * HOP - n), half, half);
  const rp = reflectPad(reflectPad(right, pad, pad + le * HOP - n), half, half);
  const plane = bins * le;
  const mag = out || new Float32Array(4 * plane);
  if (mag.length !== 4 * plane) throw new Error('specCac: out has the wrong size');
  const fr = new Float64Array(NFFT), fi = new Float64Array(NFFT);
  const s = 0.5 / Math.sqrt(NFFT);           // the split's 1/2 and the normalized 1/sqrt(n)
  for (let t = 0; t < le; t++) {
    const o = (t + 2) * HOP;                 // keep frames 2 .. 2 + le - 1
    for (let j = 0; j < NFFT; j++) { fr[j] = lp[o + j] * w[j]; fi[j] = rp[o + j] * w[j]; }
    fft.forward(fr, fi);
    for (let f = 0; f < bins; f++) {         // bin 2048 (Nyquist) dropped
      const g = f === 0 ? 0 : NFFT - f;
      const ar = fr[f], ai = fi[f], br = fr[g], bi = fi[g];
      const k = f * le + t;
      mag[k] = (ar + br) * s;                // L.re
      mag[plane + k] = (ai - bi) * s;        // L.im
      mag[2 * plane + k] = (ai + bi) * s;    // R.re
      mag[3 * plane + k] = (br - ar) * s;    // R.im
    }
  }
  return mag;
}

// HTDemucs._ispec of source s of the flat spec_out ([S][4][2048][le]),
// cut to `length` samples. Returns [Float32Array L, Float32Array R].
export function ispecCac(specOut, s, length = SEG) {
  const le = Math.ceil(length / HOP), pad = (HOP >> 1) * 3, bins = NFFT >> 1, half = NFFT >> 1;
  const plane = bins * le, base = s * 4 * plane;
  if (specOut.length < base + 4 * plane) throw new Error('ispecCac: spec_out too short for source ' + s);
  const fft = makeFFT(NFFT), w = hann(NFFT);
  const frames = le + 4;                     // 2 zero frames at each side
  const total = NFFT + HOP * (frames - 1);
  // Output sample i sits at OLA index half + pad + i (center trim, then the
  // _ispec trim). Only frames 2 .. le+1 hold data; the zero frames count in
  // the window envelope only.
  const first = half + pad;
  const yl = new Float64Array(total), yr = new Float64Array(total);
  const fr = new Float64Array(NFFT), fi = new Float64Array(NFFT);
  const scale = Math.sqrt(NFFT);
  for (let t = 0; t < le; t++) {
    for (let f = 0; f < bins; f++) {
      const k = base + f * le + t;
      const aL = specOut[k], bL = f === 0 ? 0 : specOut[plane + k];
      const aR = specOut[2 * plane + k], bR = f === 0 ? 0 : specOut[3 * plane + k];
      fr[f] = aL - bR; fi[f] = bL + aR;
      if (f > 0) { const g = NFFT - f; fr[g] = aL + bR; fi[g] = aR - bL; }
    }
    fr[half] = 0; fi[half] = 0;              // the zero Nyquist bin
    fft.inverse(fr, fi);
    const o = (t + 2) * HOP;
    for (let j = 0; j < NFFT; j++) { yl[o + j] += fr[j] * w[j]; yr[o + j] += fi[j] * w[j]; }
  }
  const env = new Float64Array(total);
  for (let t = 0; t < frames; t++) { const o = t * HOP; for (let j = 0; j < NFFT; j++) env[o + j] += w[j] * w[j]; }
  const L = new Float32Array(length), R = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const k = first + i, e = env[k] > 1e-11 ? scale / env[k] : scale;
    L[i] = yl[k] * e; R[i] = yr[k] * e;
  }
  return [L, R];
}

// CONTRACT 3.1: ref = (L + R) / 2; mean and unbiased std of ref, in float64.
export function trackStats(left, right) {
  const n = left.length;
  let s = 0;
  for (let i = 0; i < n; i++) s += (left[i] + right[i]) * 0.5;
  const mean = s / n;
  let v = 0;
  for (let i = 0; i < n; i++) { const d = (left[i] + right[i]) * 0.5 - mean; v += d * d; }
  return { mean, std: n > 1 ? Math.sqrt(v / (n - 1)) : 0 };
}

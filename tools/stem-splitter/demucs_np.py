"""Numpy port of the Demucs pre/post-processing (CONTRACT.md section 3).

This is the reference that engine/dsp.js and engine/segment.js mirror. It
uses numpy.fft, not torch.stft, so parity.py checks the section 3 text
against the real torch code, not torch against itself.

Port (Demucs, MIT, Copyright (c) Meta Platforms, Inc. and affiliates):
  stft / istft ........ demucs/spec.py spectro, ispectro (torch.stft/istft,
                        normalized, center, reflect)
  spec_cac / ispec_cac  demucs/htdemucs.py HTDemucs._spec, _magnitude,
                        _mask (cac), _ispec
  track_stats ......... demucs/api.py Separator.separate_tensor
  separate ............ demucs/apply.py apply_model (shifts and split
                        branches), TensorChunk.padded, utils.center_trim

GREP MAP
  constants ............. "SEG ="
  stft pair ............. "def stft" / "def istft"
  CaC spec pair ......... "def spec_cac" / "def ispec_cac"
  segment plan .......... "def segment_plan"
  weight ................ "def transition_weight"
  padded chunk .......... "def padded_chunk"
  pipeline .............. "def separate"
"""
import math

import numpy as np

SR, NFFT, HOP, SEG = 44100, 4096, 1024, 343980
BINS, FRAMES = 2048, 336
MAX_SHIFT = SR // 2


def hann(n):
    i = np.arange(n, dtype=np.float64)
    return 0.5 - 0.5 * np.cos(2 * np.pi * i / n)


def stft(x, nfft=NFFT, hop=HOP):
    """torch.stft(center=True, pad_mode='reflect', normalized=True,
    window=hann periodic). x: 1-D. Returns complex [nfft//2+1, frames]."""
    x = np.asarray(x, dtype=np.float64)
    xp = np.pad(x, (nfft // 2, nfft // 2), mode='reflect')
    nfr = 1 + (len(xp) - nfft) // hop
    idx = np.arange(nfft)[None, :] + hop * np.arange(nfr)[:, None]
    fr = xp[idx] * hann(nfft)[None, :]
    return (np.fft.rfft(fr, axis=1) / math.sqrt(nfft)).T


def istft(z, nfft=NFFT, hop=HOP, length=None):
    """torch.istft(center=True, normalized=True, window=hann periodic)."""
    nfr = z.shape[1]
    w = hann(nfft)
    fr = np.fft.irfft(z.T, n=nfft, axis=1) * math.sqrt(nfft) * w[None, :]
    total = nfft + hop * (nfr - 1)
    y = np.zeros(total)
    env = np.zeros(total)
    for f in range(nfr):
        y[f * hop:f * hop + nfft] += fr[f]
        env[f * hop:f * hop + nfft] += w * w
    start = nfft // 2
    end = start + length if length is not None else total - nfft // 2
    y, env = y[start:end], env[start:end]
    if len(y) < (end - start):
        y = np.pad(y, (0, end - start - len(y)))
        env = np.pad(env, (0, end - start - len(env)), constant_values=1)
    return y / np.where(env > 1e-11, env, 1.0)


def _spec1(x):
    le = math.ceil(len(x) / HOP)
    pad = HOP // 2 * 3
    xp = np.pad(np.asarray(x, np.float64), (pad, pad + le * HOP - len(x)), mode='reflect')
    z = stft(xp)[:-1, :]
    return z[:, 2:2 + le]


def spec_cac(left, right):
    """[4, 2048, 336] float32: L.re, L.im, R.re, R.im (HTDemucs _spec + _magnitude)."""
    out = []
    for ch in (left, right):
        z = _spec1(ch)
        out += [z.real, z.imag]
    return np.stack(out).astype(np.float32)


def ispec_cac(spec_s, length=SEG):
    """spec_s: [4, 2048, 336] of one source -> [2, length] (HTDemucs _mask cac + _ispec)."""
    pad = HOP // 2 * 3
    le = HOP * math.ceil(length / HOP) + 2 * pad
    out = []
    for c in range(2):
        z = spec_s[2 * c].astype(np.float64) + 1j * spec_s[2 * c + 1].astype(np.float64)
        z = np.pad(z, ((0, 1), (2, 2)))
        x = istft(z, length=le)
        out.append(x[pad:pad + length])
    return np.stack(out)


def track_stats(left, right):
    ref = (left.astype(np.float64) + right.astype(np.float64)) / 2
    return float(ref.mean()), float(ref.std(ddof=1))


def segment_plan(n, segment=SEG, overlap=0.25):
    stride = int((1 - overlap) * segment)
    return stride, list(range(0, n, stride))


def transition_weight(segment=SEG):
    w = np.concatenate([np.arange(1, segment // 2 + 1), np.arange(segment - segment // 2, 0, -1)]).astype(np.float64)
    return w / w.max()


def padded_chunk(wav, offset, segment=SEG):
    """wav [2, n]. Returns (mix [2, segment], chunk_len, start, trim_left)."""
    n = wav.shape[1]
    chunk_len = min(n - offset, segment)
    delta = segment - chunk_len
    start = offset - delta // 2
    out = np.zeros((2, segment), dtype=wav.dtype)
    a, b = max(0, start), min(n, start + segment)
    out[:, a - start:b - start] = wav[:, a:b]
    return out, chunk_len, start, delta // 2


def _split(wav, run_core, sources, overlap):
    n = wav.shape[1]
    stride, offsets = segment_plan(n, SEG, overlap)
    w = transition_weight(SEG)
    out = np.zeros((sources, 2, n))
    wsum = np.zeros(n)
    for off in offsets:
        mix, clen, _, trim = padded_chunk(wav, off)
        mag = spec_cac(mix[0], mix[1])
        spec_out, wave_out = run_core(mag, mix.astype(np.float32))
        for s in range(sources):
            y = wave_out[s].astype(np.float64) + ispec_cac(spec_out[s])
            out[s, :, off:off + clen] += w[:clen] * y[:, trim:trim + clen]
        wsum[off:off + clen] += w[:clen]
    return out / wsum


def separate(left, right, run_core, sources, overlap=0.25, shifts=0, shift_offsets=None):
    """Full pipeline: track normalisation, shifts, split, overlap-add.
    run_core(mag [4,2048,336] f32, mix [2,SEG] f32) -> (spec_out [S,4,2048,336], wave_out [S,2,SEG]).
    Returns [S, 2, n] float64."""
    mean, std = track_stats(left, right)
    wav = (np.stack([left, right]).astype(np.float64) - mean) / (std + 1e-8)
    wav = wav.astype(np.float32)
    n = wav.shape[1]
    if shifts:
        padded = np.pad(wav, ((0, 0), (MAX_SHIFT, MAX_SHIFT)))
        acc = 0.0
        for k in range(shifts):
            off = shift_offsets[k]
            shifted = padded[:, off:off + n + MAX_SHIFT - off]
            y = _split(shifted, run_core, sources, overlap)
            acc = acc + y[..., MAX_SHIFT - off:MAX_SHIFT - off + n]
        out = acc / shifts
    else:
        out = _split(wav, run_core, sources, overlap)
    return out * (std + 1e-8) + mean

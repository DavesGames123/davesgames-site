#!/usr/bin/env python3
"""Write stella-nova/pages/stem-splitter/test/vectors.json (CONTRACT.md 5.6).

Reference values for the JS engine tests, all from the official PyTorch
Demucs (commit e976d93e) on synth-v1 (synth.py). Sampled, so the file
stays under 1 MB.

Encoding: "f32:<base64>" = little-endian float32, "u32:<base64>" =
little-endian uint32. An index array has `count` unique indices into the
flat row-major array of the stated shape: a new mulberry32(7) per array,
draw floor(rng() * size), keep the first copy of each value until `count`
values are kept, then sort. "energy" = sum of squares (float64) over the
whole array, not only the samples. "l2" = sqrt(sum of squares) per channel
over the whole array.

Sections:
  synth     first 256 samples of synth-v1, L then R ([2][256])
  stft      HTDemucs._spec + _magnitude on raw synth-v1 1 s (44100 samples):
            shape [4, 2048, 44] (L.re, L.im, R.re, R.im)
  istft     the complex spec of "stft" times g[f] = 1 / (1 + f / 100), then
            HTDemucs._ispec(z, 44100): shape [2, 44100]
  plan      segment plan + summed transition weight for N = 441000
  core      torch Core on segment 0 of synth-v1 10 s, track-normalised;
            mag [4,2048,336], spec_out [S,4,2048,336], wave_out [S,2,343980]
  pipeline  api.py normalisation + apply_model(split, overlap 0.25) on
            synth-v1 10 s: shifts 0, and shifts 2 with offsets 1234, 20000

Usage:
  python tools/stem-splitter/make_vectors.py [out.json]

GREP MAP
  encoders ............... "def f32"
  index draw ............. "def pick"
  sections ............... "def main"
"""
import base64
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core  # noqa: E402
import demucs_np  # noqa: E402
import parity  # noqa: E402
from synth import mulberry32_scalar, synth_v1  # noqa: E402

LIMIT = 1 << 20


def f32(a):
    return 'f32:' + base64.b64encode(np.ascontiguousarray(a, dtype='<f4').tobytes()).decode()


def u32(a):
    return 'u32:' + base64.b64encode(np.ascontiguousarray(a, dtype='<u4').tobytes()).decode()


def pick(size, count):
    r = mulberry32_scalar(7)
    seen, out = set(), []
    while len(out) < count:
        v = int(r() * size)
        if v not in seen:
            seen.add(v)
            out.append(v)
    return np.array(sorted(out), dtype=np.int64)


def sampled(arr, count, prefix):
    flat = np.asarray(arr).reshape(-1)
    idx = pick(flat.size, count)
    return {prefix + 'Idx': u32(idx), prefix + 'Val': f32(flat[idx])}


def energy(a):
    return float((np.asarray(a, dtype=np.float64) ** 2).sum())


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(core.PAGE, 'test', 'vectors.json')
    import onnxruntime
    import torch
    torch.set_num_threads(max(1, os.cpu_count() // 2))
    v = {
        'format': 'stem-splitter-vectors/1',
        'made_by': 'tools/stem-splitter/make_vectors.py',
        'torch': torch.__version__.split('+')[0],
        'demucs_commit': core.DEMUCS_COMMIT,
        'onnxruntime': onnxruntime.__version__,
        'encoding': 'f32 = base64 little-endian float32; u32 = base64 little-endian uint32; '
                    'idx = unique indices into the flat row-major array, mulberry32(7) per array, sorted; '
                    'energy = sum of squares of the whole array; l2 = sqrt(sum of squares) per channel',
    }
    L, R = synth_v1(10)
    v['synth'] = {'name': 'synth-v1', 'shape': [2, 256], 'head': f32(np.stack([L[:256], R[:256]]))}

    m4 = core.load_model('htdemucs')
    # stft / istft on raw synth-v1 1 s
    L1, R1 = synth_v1(1)
    x1 = torch.from_numpy(np.stack([L1, R1]))[None]
    with torch.no_grad():
        z = m4._spec(x1)                       # [1, 2, 2048, 44] complex
        mag1 = m4._magnitude(z)[0].numpy()     # [4, 2048, 44]
        g = 1.0 / (1.0 + torch.arange(2048, dtype=torch.float32) / 100.0)
        y1 = m4._ispec(z * g[None, None, :, None], 44100)[0].numpy()   # [2, 44100]
    idx = pick(mag1.size, 4096)
    v['stft'] = {'seconds': 1, 'length': 44100, 'shape': list(mag1.shape), 'idx': u32(idx),
                 'val': f32(mag1.reshape(-1)[idx]),
                 'l2': [float(np.sqrt((mag1[c].astype(np.float64) ** 2).sum())) for c in range(4)]}
    idx = pick(y1.size, 4096)
    v['istft'] = {'length': 44100, 'shape': list(y1.shape),
                  'gain': 'g[f] = 1 / (1 + f / 100) on spec of synth 1 s',
                  'idx': u32(idx), 'val': f32(y1.reshape(-1)[idx]),
                  'l2': [float(np.sqrt((y1[c].astype(np.float64) ** 2).sum())) for c in range(2)]}
    # plan for N = 441000
    n = 441000
    stride, offsets = demucs_np.segment_plan(n)
    w = demucs_np.transition_weight()
    chunks, wsum = [], np.zeros(n)
    dummy = np.zeros((2, n), np.float32)
    for off in offsets:
        _, clen, start, trim = demucs_np.padded_chunk(dummy, off)
        chunks.append({'offset': off, 'chunkLen': clen, 'start': start, 'trimLeft': trim})
        wsum[off:off + clen] += w[:clen]
    idx = pick(n, 1024)
    v['plan'] = {'length': n, 'segment': core.SEG, 'stride': stride, 'offsets': offsets, 'chunks': chunks,
                 'weightSum': float(w.sum()), 'sumIdx': u32(idx), 'sumVal': f32(wsum[idx])}
    # core and pipeline
    wav = parity.normalised(L, R)
    v['core'], v['pipeline'] = {}, {}
    for mid in core.MODEL_IDS:
        m = m4 if mid == 'htdemucs' else core.load_model(mid)
        stems = list(m.sources)
        seg = torch.from_numpy(wav[:, :core.SEG].copy())[None]
        mag, mix = core.segment_inputs(m, seg)
        with torch.no_grad():
            ts, tw = core.make_core(m)(mag, mix)
        ts, tw = ts[0].numpy(), tw[0].numpy()
        e = {'input': 'synth-v1 10 s, track-normalised, segment 0', 'stems': stems,
             'magShape': list(mag.shape[1:]), 'specShape': list(ts.shape), 'waveShape': list(tw.shape)}
        e.update(sampled(mag[0].numpy(), 1024, 'mag'))
        e.update(sampled(ts, 8192, 'spec'))
        e.update(sampled(tw, 8192, 'wave'))
        e['energy'] = {'spec': [energy(ts[s]) for s in range(len(stems))],
                       'wave': [energy(tw[s]) for s in range(len(stems))]}
        v['core'][mid] = e
        if mid == 'htdemucs':
            for key, shifts, offs in (('htdemucs', 0, None), ('htdemucs_shift', 2, parity.SHIFT_OFFSETS)):
                ref = parity.torch_pipeline(m, L, R, shifts=shifts, offsets=offs)
                idx = pick(ref.shape[-1], 4096)
                p = {'model': 'htdemucs', 'seconds': 10, 'length': int(ref.shape[-1]),
                     'quality': 'standard' if not shifts else 'best', 'shifts': shifts}
                if offs:
                    p['shiftOffsets'] = list(offs)
                p['stems'] = {name: {'idx': u32(idx), 'L': f32(ref[s, 0, idx]), 'R': f32(ref[s, 1, idx]),
                                     'energy': energy(ref[s])} for s, name in enumerate(stems)}
                v['pipeline'][key] = p
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    text = json.dumps(v, separators=(',', ':'))
    with open(out_path, 'w') as fh:
        fh.write(text + '\n')
    size = len(text) + 1
    print(f'wrote {os.path.relpath(out_path, core.ROOT)} {size} B (limit {LIMIT})')
    if size > LIMIT:
        sys.exit('vectors.json is over 1 MB')


if __name__ == '__main__':
    main()

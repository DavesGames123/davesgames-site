#!/usr/bin/env python3
"""Write stella-nova/pages/stem-splitter/test/vectors-clip.json.

A second, small reference file for the JS engine tests: the official
PyTorch Demucs (commit e976d93e, htdemucs, shifts 0, split, overlap 0.25)
on clipped loud input. vectors.json is near its 1 MB limit, so this case
has its own file.

Input "clip-v1": synth-v1 6 s (synth.py), each channel times 10 in
float32, then clipped to [-1, 1]. engine/tests.mjs makes the same input
from engine/synth.js.

Why: the parity review measured drums 48.5 dB and bass 38.4 dB SDR on
this input (ORT-web wasm against torch), below the 50 dB bar of
CONTRACT 8.2. The loss comes from the ONNX core in onnxruntime-web, not
from the JS steps. The JS test reports the stem SDR and checks the error
against the mix energy (CONTRACT 8.2, clipped row).

Fields: seconds, gain, length, model, shifts, and per stem the sampled
values (same encoding and index draw as make_vectors.py, 2048 indices)
plus the energy of the whole stem.

Usage:
  python tools/stem-splitter/make_clip_vectors.py [out.json]

GREP MAP
  input ................. "def clip_input"
  main .................. "def main"
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core  # noqa: E402
import parity  # noqa: E402
from make_vectors import energy, f32, pick, u32  # noqa: E402
from synth import synth_v1  # noqa: E402

SECONDS, GAIN, COUNT = 6, 10, 2048


def clip_input():
    L, R = synth_v1(SECONDS)
    g = np.float32(GAIN)
    return (np.clip(L.astype(np.float32) * g, -1, 1).astype(np.float32),
            np.clip(R.astype(np.float32) * g, -1, 1).astype(np.float32))


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(core.PAGE, 'test', 'vectors-clip.json')
    import torch
    torch.set_num_threads(max(1, os.cpu_count() // 2))
    L, R = clip_input()
    m = core.load_model('htdemucs')
    ref = parity.torch_pipeline(m, L, R, shifts=0)
    idx = pick(ref.shape[-1], COUNT)
    v = {'input': f'clip-v1: synth-v1 {SECONDS} s x {GAIN} in float32, clipped to [-1, 1]',
         'seconds': SECONDS, 'gain': GAIN, 'length': int(ref.shape[-1]), 'model': 'htdemucs', 'shifts': 0,
         'mixEnergy': energy(np.stack([L, R])),
         'stems': {name: {'idx': u32(idx), 'L': f32(ref[s, 0, idx]), 'R': f32(ref[s, 1, idx]),
                          'energy': energy(ref[s])} for s, name in enumerate(m.sources)}}
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    text = json.dumps(v, separators=(',', ':'))
    with open(out_path, 'w') as fh:
        fh.write(text + '\n')
    print(f'wrote {os.path.relpath(out_path, core.ROOT)} {len(text) + 1} B')


if __name__ == '__main__':
    main()

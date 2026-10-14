#!/usr/bin/env python3
"""Parity of the Stem Splitter export against the official PyTorch Demucs.

  (a) core:     torch Core vs the ONNX graph (onnxruntime CPU) on segment 0
                of synth-v1 10 s, track-normalised. Threshold 70 dB.
  (b) pipeline: torch apply_model (shifts 0, split, overlap 0.25) with the
                api.py normalisation vs demucs_np.separate (the numpy port of
                CONTRACT.md 3, numpy FFT) + the ONNX graph, synth-v1 10 s and
                30 s. Threshold 60 dB per stem.
  (c) shifts:   as (b) with shifts 2, offsets 1234 and 20000 (torch:
                random.randint patched), 10 s, htdemucs. Threshold 60 dB.

The ONNX graph is models/<id>.onnx; its weights are models/<file>.th (run
node tools/stem-splitter/fetch.mjs first). Exit 1 when a check fails.

Usage:
  python tools/stem-splitter/parity.py [model ...] [--skip-30] [--skip-shifts] [--dump DIR]
  --dump DIR writes <id>.{mag,mix,spec,wave}.f32 (check (a) input and torch
  output, raw little-endian float32) for opcheck.mjs --run --input DIR.

GREP MAP
  onnx session ........... "def onnx_core"
  torch pipeline ......... "def torch_pipeline"
  checks ................. "def main"
"""
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core  # noqa: E402
import demucs_np  # noqa: E402
from synth import synth_v1  # noqa: E402

SHIFT_OFFSETS = [1234, 20000]
FAILS = []


def check(label, value, threshold):
    ok = value >= threshold
    if not ok:
        FAILS.append(label)
    print(f'  {label}: {value:.1f} dB (>= {threshold}) {"ok" if ok else "FAIL"}')


def onnx_core(model_id, threads=0):
    import onnxruntime as ort
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    if threads:
        so.intra_op_num_threads = threads
    core.th_path(model_id)  # raises with the fetch hint when absent
    path = os.path.join(core.PAGE, 'models', model_id + '.onnx')
    sess = ort.InferenceSession(path, so, providers=['CPUExecutionProvider'])

    def run(mag, mix):
        o = sess.run(None, {'mag': mag[None].astype(np.float32), 'mix': mix[None].astype(np.float32)})
        return o[0][0], o[1][0]
    return run


def normalised(L, R):
    mean, std = demucs_np.track_stats(L, R)
    wav = (np.stack([L, R]).astype(np.float64) - mean) / (std + 1e-8)
    return wav.astype(np.float32)


def torch_pipeline(model, L, R, shifts=0, offsets=None):
    """api.py separate_tensor + apply_model, as upstream (float32 torch)."""
    import torch
    import demucs.apply as A
    wav = torch.from_numpy(np.stack([L, R]))
    ref = wav.mean(0)
    wav = wav - ref.mean()
    wav = wav / (ref.std() + 1e-8)
    saved = A.random.randint
    if offsets is not None:
        it = iter(offsets)
        A.random.randint = lambda a, b: next(it)
    try:
        with torch.no_grad():
            out = A.apply_model(model, wav[None], shifts=shifts, split=True, overlap=0.25, progress=False)[0]
    finally:
        A.random.randint = saved
    out = out * (ref.std() + 1e-8) + ref.mean()
    return out.numpy()


def main():
    argv = sys.argv[1:]
    dump = argv[argv.index('--dump') + 1] if '--dump' in argv else None
    args = [a for a in argv if not a.startswith('--') and a != dump]
    ids = args or core.MODEL_IDS
    import torch
    torch.set_num_threads(max(1, os.cpu_count() // 2))
    for mid in ids:
        print(f'== {mid}')
        model = core.load_model(mid)
        stems = list(model.sources)
        run = onnx_core(mid)
        # (a) core, segment 0 of synth-v1 10 s
        L, R = synth_v1(10)
        wav = normalised(L, R)
        seg = torch.from_numpy(wav[:, :core.SEG].copy())[None]
        mag, mix = core.segment_inputs(model, seg)
        c = core.make_core(model)
        with torch.no_grad():
            ts, tw = c(mag, mix)
        t0 = time.time()
        os_, ow = run(mag[0].numpy(), mix[0].numpy())
        print(f'  (a) onnxruntime CPU core run {time.time() - t0:.2f} s')
        check('(a) core spec_out', core.sdr(ts[0].numpy(), os_), 70)
        check('(a) core wave_out', core.sdr(tw[0].numpy(), ow), 70)
        if dump:
            os.makedirs(dump, exist_ok=True)
            for k, a in (('mag', mag), ('mix', mix), ('spec', ts), ('wave', tw)):
                a.numpy().astype('<f4').tofile(os.path.join(dump, f'{mid}.{k}.f32'))
            print(f'  dumped the core input and torch output to {dump}')
        # numpy _spec vs torch _spec on the same segment (section 3.4)
        npmag = demucs_np.spec_cac(wav[0, :core.SEG], wav[1, :core.SEG])
        check('(a) numpy spec_cac vs torch _spec', core.sdr(mag[0].numpy(), npmag), 100)
        # (b) pipeline 10 s and 30 s
        for secs in ([10] if '--skip-30' in sys.argv else [10, 30]):
            L, R = synth_v1(secs)
            t0 = time.time()
            ref = torch_pipeline(model, L, R)
            t1 = time.time()
            est = demucs_np.separate(L, R, run, len(stems))
            t2 = time.time()
            print(f'  (b) {secs} s: torch {t1 - t0:.1f} s, numpy+onnx {t2 - t1:.1f} s')
            for s, name in enumerate(stems):
                check(f'(b) {secs} s {name}', core.sdr(ref[s], est[s]), 60)
        # (c) shifts 2, 10 s
        if mid == 'htdemucs' and '--skip-shifts' not in sys.argv:
            L, R = synth_v1(10)
            ref = torch_pipeline(model, L, R, shifts=2, offsets=SHIFT_OFFSETS)
            est = demucs_np.separate(L, R, run, len(stems), shifts=2, shift_offsets=SHIFT_OFFSETS)
            for s, name in enumerate(stems):
                check(f'(c) shifts {SHIFT_OFFSETS} {name}', core.sdr(ref[s], est[s]), 60)
    print('FAIL: ' + ', '.join(FAILS) if FAILS else 'parity: all checks pass')
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()

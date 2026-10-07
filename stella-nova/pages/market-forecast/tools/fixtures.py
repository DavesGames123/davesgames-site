# Fixtures for market-forecast/tests.mjs. For each case: the input series,
# every core call the numpy twin makes (inputs and fp32 ONNX outputs), and
# the PyTorch pipeline output. usage: fixtures.py <onnx dir> <out.json>
import sys, json, math
import numpy as np
import torch
import onnxruntime as ort
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import parity as pr

D, OUT = sys.argv[1], sys.argv[2]
from chronos import BaseChronosPipeline


def r6(a):
    return [None if not np.isfinite(v) else float(np.float32(v)) for v in np.asarray(a, np.float64).reshape(-1)]


def rec_session(sess):
    calls = []
    real = sess.run

    def run(_o, feeds):
        out = real(None, feeds)
        calls.append({k: r6(v) if v.dtype != np.int64 else [int(t) for t in v.reshape(-1)] for k, v in feeds.items()} |
                     {'dims': {k: list(v.shape) for k, v in feeds.items()}, 'out': r6(out[0]), 'outDims': list(out[0].shape)})
        return out
    return run, calls


class S:
    pass


fx = {}
x1 = pr.series(150, 'gbm', 5); x1[20:25] = np.nan
x2 = pr.series(97, 'season', 9)
# Bolt: one row H=24 (single call) and two rows (left pad) H=100 (unroll)
sess = ort.InferenceSession(f'{D}/bolt-tiny.fp32.onnx', providers=['CPUExecutionProvider'])
pipe = BaseChronosPipeline.from_pretrained('amazon/chronos-bolt-tiny', device_map='cpu', torch_dtype=torch.float32)
for name, rows, H in [('bolt1', [x1], 24), ('bolt2unroll', [x1, x2], 100)]:
    run, calls = rec_session(sess)
    s = S(); s.run = run
    L = max(len(r) for r in rows)
    ctx = np.stack([np.concatenate([np.full(L - len(r), np.nan), r]) for r in rows])
    twin = pr.bolt_onnx(s, ctx, H)
    ref = pipe.predict([torch.tensor(r, dtype=torch.float32) for r in rows], prediction_length=H).numpy()
    fx[name] = dict(rows=[r6(r) for r in rows], H=H, calls=calls, ref=r6(ref), refDims=list(ref.shape),
                    twinVsRef=float(np.abs(twin - ref).max()))
    print(name, 'calls', len(calls), 'numpy twin vs torch', fx[name]['twinVsRef'])

sess = ort.InferenceSession(f'{D}/c2-small.fp32.onnx', providers=['CPUExecutionProvider'])
pipe = BaseChronosPipeline.from_pretrained('autogluon/chronos-2-small', device_map='cpu', torch_dtype=torch.float32)
mv = np.stack([pr.series(130, 'gbm', 11), pr.series(130, 'gbm', 12), pr.series(130, 'season', 13)])
mv[1, 40:44] = np.nan
for name, rows, H, groups in [('c2one', x1[None], 24, [0]), ('c2joint', mv, 40, [0, 0, 0])]:
    run, calls = rec_session(sess)
    s = S(); s.run = run
    twin, _ = pr.c2_onnx(s, rows, H, groups)
    ref = pipe.predict([rows.astype(np.float32)], prediction_length=H)[0].numpy()
    fx[name] = dict(rows=[r6(r) for r in rows], H=H, groups=groups, calls=calls, ref=r6(ref), refDims=list(ref.shape),
                    twinVsRef=float(np.abs(twin - ref).max()))
    print(name, 'calls', len(calls), 'numpy twin vs torch', fx[name]['twinVsRef'])
json.dump(fx, open(OUT, 'w'))
print('wrote', OUT, __import__('os').path.getsize(OUT) / 1e3, 'kB')

# Parity: numpy pre/post (the same steps as the page's model-io.js) + the ONNX
# core, against the PyTorch chronos pipelines. Also writes JSON fixtures for
# the page tests.  usage: parity.py <onnx dir> <suffix> [models...]
import sys, json, math
import numpy as np
import torch
import onnxruntime as ort

D, SUF = sys.argv[1], sys.argv[2]
which = sys.argv[3:] or ['bolt-tiny', 'bolt-mini', 'c2-small']
P = 16
rng = np.random.default_rng(7)


def series(n, kind, seed):
    r = np.random.default_rng(seed)
    t = np.arange(n)
    if kind == 'gbm':
        v = 0.012 * np.sqrt(np.convolve(r.standard_normal(n) ** 2, np.ones(20) / 20, 'same') + 0.2)
        return 100 * np.exp(np.cumsum(0.0002 + v * r.standard_normal(n)))
    if kind == 'season':
        return 50 + 10 * np.sin(2 * np.pi * t / 24) + 0.05 * t + r.standard_normal(n)
    if kind == 'flat':
        return np.full(n, 3.25)
    if kind == 'big':
        return 1e6 * (1 + 0.1 * np.sin(t / 7)) + 5e3 * r.standard_normal(n)
    raise ValueError(kind)


def scale_np(x, arcsinh):
    loc = np.nanmean(x, axis=-1, keepdims=True) if np.isfinite(x).any() else np.zeros((x.shape[0], 1))
    loc = np.nan_to_num(loc, nan=0.0)
    sc = np.sqrt(np.nanmean((x - loc) ** 2, axis=-1, keepdims=True))
    sc = np.nan_to_num(sc, nan=1.0)
    sc = np.where(sc == 0, 1e-5, sc)
    z = (x - loc) / sc
    if arcsinh:
        z = np.arcsinh(z)
    return z.astype(np.float32), loc, sc


def patch_np(z):
    B, L = z.shape
    pad = (-L) % P
    z = np.concatenate([np.full((B, pad), np.nan, np.float32), z], -1)
    m = (~np.isnan(z)).astype(np.float32)
    N = z.shape[1] // P
    zv = np.where(m > 0, z, 0).reshape(B, N, P).astype(np.float32)
    mv = m.reshape(B, N, P)
    return zv, mv, (mv.sum(-1) > 0).astype(np.float32)


def bolt_onnx(sess, ctx, H):
    """ctx (B,L) float64 with NaN; Chronos-Bolt predict incl. the unroll."""
    Hm = 64
    ctx = ctx[:, -2048:]
    outs = []

    def step(c):
        z, loc, sc = scale_np(c, False)
        zv, mv, attn = patch_np(z)
        q = sess.run(None, {'patched': np.concatenate([zv, mv], -1), 'attn': attn})[0]
        return q * sc[:, :, None] + loc[:, :, None]  # (B,9,64)

    pred = step(ctx)
    outs.append(pred)
    rem = H - Hm
    qs = np.linspace(0.1, 0.9, 9)
    if rem > 0:
        c = np.repeat(ctx[:, None, :], 9, 1)
    while rem > 0:
        c = np.concatenate([c, pred], -1)[..., -2048:]
        B = c.shape[0]
        p = step(c.reshape(B * 9, -1)).reshape(B, 81, -1)
        pred = np.quantile(p, qs, axis=1).transpose(1, 0, 2)
        outs.append(pred)
        rem -= Hm
    return np.concatenate(outs, -1)[..., :H]


def c2_onnx(sess, ctx, H, groups, ctxlen=8192):
    ctx = ctx[:, -ctxlen:]
    z, loc, sc = scale_np(ctx, True)
    zv, mv, attn = patch_np(z)
    B, Nc = attn.shape
    te = (np.arange(-Nc * P, 0, dtype=np.float32) / 8192).reshape(Nc, P)
    cin = np.concatenate([np.broadcast_to(te, (B, Nc, P)), zv, mv], -1).astype(np.float32)
    Nf = min(math.ceil(H / P), 64)
    fe = (np.arange(0, Nf * P, dtype=np.float32) / 8192).reshape(Nf, P)
    fin = np.concatenate([np.broadcast_to(fe, (B, Nf, P)), np.zeros((B, Nf, 2 * P), np.float32)], -1).astype(np.float32)
    q = sess.run(None, {'ctx': cin, 'ctx_mask': attn, 'fut': fin, 'group_ids': np.asarray(groups, np.int64)})[0]
    out = np.sinh(q.astype(np.float64)) * sc[:, :, None] + loc[:, :, None]
    return out[..., :H], dict(cin=cin, attn=attn, fin=fin, q=q, loc=loc, sc=sc)


def main():
    from chronos import BaseChronosPipeline
    repos = {'bolt-tiny': 'amazon/chronos-bolt-tiny', 'bolt-mini': 'amazon/chronos-bolt-mini',
             'c2-small': 'autogluon/chronos-2-small'}
    report = {}
    fixtures = {}
    for key in which:
        sess = ort.InferenceSession(f'{D}/{key}.{SUF}.onnx', providers=['CPUExecutionProvider'])
        pipe = BaseChronosPipeline.from_pretrained(repos[key], device_map='cpu', torch_dtype=torch.float32)
        worst = 0.0
        worst_rel = 0.0
        rows = []
        cases = [('gbm', 390, 78), ('season', 200, 24), ('gbm', 517, 64), ('big', 100, 10), ('flat', 64, 16),
                 ('gbm', 2500, 130), ('season', 33, 200)]
        for kind, n, H in cases:
            x = series(n, kind, n)
            if kind == 'gbm' and n == 517:
                x = x.copy(); x[100:140] = np.nan
            if key.startswith('bolt'):
                ref = pipe.predict(torch.tensor(x[None], dtype=torch.float32), prediction_length=H).numpy()
                got = bolt_onnx(sess, x[None], H)
            else:
                ref = pipe.predict([x[None].astype(np.float32)], prediction_length=H)[0].numpy()
                got, _ = c2_onnx(sess, x[None], H, [0])
            d = np.abs(ref - got).max()
            rel = d / (np.nanstd(x) + 1e-9)
            worst = max(worst, d); worst_rel = max(worst_rel, rel)
            rows.append((kind, n, H, float(d), float(rel)))
        # batch of different lengths (left padded) for bolt; multivariate group for c2
        xs = [series(300, 'gbm', 1), series(260, 'gbm', 2), series(300, 'season', 3)]
        if key.startswith('bolt'):
            ref = pipe.predict([torch.tensor(v, dtype=torch.float32) for v in xs], prediction_length=40).numpy()
            L = max(len(v) for v in xs)
            ctx = np.stack([np.concatenate([np.full(L - len(v), np.nan), v]) for v in xs])
            got = bolt_onnx(sess, ctx, 40)
            d = np.abs(ref - got).max()
            rows.append(('batch3-leftpad', L, 40, float(d), float(d / np.std(xs[0]))))
            worst = max(worst, d)
        else:
            L = 300
            mv = np.stack([series(L, 'gbm', 11), series(L, 'gbm', 12) * 0.5 + series(L, 'gbm', 11) * 0.5, series(L, 'season', 13)])
            ref = pipe.predict([mv.astype(np.float32)], prediction_length=78)[0].numpy()  # one multivariate task
            got, _ = c2_onnx(sess, mv, 78, [0, 0, 0])
            d = np.abs(ref - got).max()
            rows.append(('multivariate3', L, 78, float(d), float(d / np.std(mv))))
            worst = max(worst, d)
            # independent (each its own group) differs from joint: show the group mask matters
            ind, _ = c2_onnx(sess, mv, 78, [0, 1, 2])
            rows.append(('joint-vs-indep (not parity)', L, 78, float(np.abs(ind - got).max()), 0.0))
        report[key] = dict(worst_abs=float(worst), worst_rel_to_std=float(worst_rel), cases=rows)
        print(key, SUF, 'worst abs', worst, 'worst rel', worst_rel)
        for r in rows:
            print('   ', r)
        # fixtures for the JS tests (fp32 core reference only)
        if SUF == 'fp32':
            x = series(150, 'gbm', 5); x[20:25] = np.nan
            if key.startswith('bolt'):
                z, loc, sc = scale_np(x[None, -2048:], False)
                zv, mv_, attn = patch_np(z)
                q = sess.run(None, {'patched': np.concatenate([zv, mv_], -1), 'attn': attn})[0]
                ref = pipe.predict(torch.tensor(x[None], dtype=torch.float32), prediction_length=64).numpy()
                fixtures[key] = dict(x=[None if np.isnan(v) else float(v) for v in x], H=64,
                                     loc=float(loc[0, 0]), scale=float(sc[0, 0]),
                                     patched=np.concatenate([zv, mv_], -1).reshape(-1).tolist(),
                                     attn=attn.reshape(-1).tolist(), N=int(attn.shape[1]),
                                     core=q.reshape(-1).tolist(), ref=ref.reshape(-1).tolist())
            else:
                got, t = c2_onnx(sess, x[None], 24, [0])
                ref = pipe.predict([x[None].astype(np.float32)], prediction_length=24)[0].numpy()
                fixtures[key] = dict(x=[None if np.isnan(v) else float(v) for v in x], H=24,
                                     loc=float(t['loc'][0, 0]), scale=float(t['sc'][0, 0]),
                                     ctx=t['cin'].reshape(-1).tolist(), attn=t['attn'].reshape(-1).tolist(),
                                     fut=t['fin'].reshape(-1).tolist(), Nc=int(t['attn'].shape[1]), Nf=int(t['fin'].shape[1]),
                                     core=t['q'].reshape(-1).tolist(), ref=ref.reshape(-1).tolist())
    json.dump(report, open(f'{D}/parity.{SUF}.json', 'w'), indent=1)
    if fixtures:
        json.dump(fixtures, open(f'{D}/fixtures.json', 'w'))


if __name__ == '__main__':
    main()

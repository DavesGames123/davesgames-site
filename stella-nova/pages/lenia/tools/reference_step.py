#!/usr/bin/env python3
"""One Lenia step with FFT convolution, as in Chan's LeniaND.py.

Reads JSON cases on stdin: [{W, H, R, T, m, s, b, kn, gn, A0, A1}], where A0
is the world before the step and A1 is the engine result. Prints the largest
error of each case. engine_test.js calls this script.

The kernel_core and growth_func lambdas and the kernel_shell/calc_kernel/
calc_once code follow LeniaND.py (Chakazul/Lenia @ adfc542, MIT).
"""
import json
import sys

import numpy as np

kernel_core = {
    0: lambda r: (4 * r * (1 - r)) ** 4,
    1: lambda r: np.exp(4 - 1 / (r * (1 - r))),
    2: lambda r, q=1 / 4: (r >= q) * (r <= 1 - q),
    3: lambda r, q=1 / 4: (r >= q) * (r <= 1 - q) + (r < q) * 0.5,
}
growth_func = {
    0: lambda n, m, s: np.maximum(0, 1 - (n - m) ** 2 / (9 * s ** 2)) ** 4 * 2 - 1,
    1: lambda n, m, s: np.exp(-(n - m) ** 2 / (2 * s ** 2)) * 2 - 1,
    2: lambda n, m, s: (np.abs(n - m) <= s) * 2 - 1,
}


def step(c):
    W, H, R = c['W'], c['H'], c['R']
    A = np.asarray(c['A0'], dtype=np.float64).reshape(H, W)
    I, J = np.mgrid[0:H, 0:W]
    X, Y = (J - W // 2) / R, (I - H // 2) / R
    D = np.sqrt(X ** 2 + Y ** 2)
    bs = np.asarray(c['b'], dtype=np.float64)
    B = len(bs)
    Br = B * D
    with np.errstate(divide='ignore', invalid='ignore'):
        core = kernel_core[c['kn'] - 1](np.minimum(Br % 1, 1))
    core = np.nan_to_num(core)
    K = (D < 1) * core * bs[np.minimum(np.floor(Br).astype(int), B - 1)]
    K = K / K.sum()
    U = np.fft.fftshift(np.real(np.fft.ifft2(np.fft.fft2(K) * np.fft.fft2(A))))
    G = growth_func[c['gn'] - 1](U, c['m'], c['s'])
    return np.clip(A + G / c['T'], 0, 1), U


def main():
    cases = json.load(sys.stdin)
    out = []
    for c in cases:
        ref, U = step(c)
        got = np.asarray(c['A1']).reshape(ref.shape)
        err = np.abs(ref - got)
        # A step growth function flips where U is within float error of m +- s.
        # Those cells are listed apart and do not count as errors.
        edge = np.zeros_like(err, dtype=bool)
        if c['gn'] == 3:
            edge = np.abs(np.abs(U - c['m']) - c['s']) < 1e-5
        out.append({'max_err': float(err[~edge].max()), 'edge_cells': int(edge.sum())})
    json.dump(out, sys.stdout)


if __name__ == '__main__':
    main()

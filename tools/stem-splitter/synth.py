#!/usr/bin/env python3
"""synth-v1: the test signal of the Stem Splitter (CONTRACT.md 3.5).

A kick, a bass sine, a vibrato "voice" and a noise hat. It is ours, so the
tests use no music with copyright. engine/synth.js computes the same values
in JS. mulberry32 here uses 32-bit unsigned arithmetic (masks), vectorised:
the state of draw j is seed + (j + 1) * 0x6D2B79F5 mod 2^32, so each draw
does not depend on the last output.

Usage:
  python3 tools/stem-splitter/synth.py [seconds]   print the first samples

GREP MAP
  PRNG ................... "def mulberry32"
  signal ................. "def synth_v1"
"""
import sys

import numpy as np

M32 = np.uint64(0xFFFFFFFF)


def mulberry32(seed, count):
    """The first `count` outputs of mulberry32(seed), float64 in [0, 1)."""
    j = np.arange(1, count + 1, dtype=np.uint64)
    a = (np.uint64(seed & 0xFFFFFFFF) + j * np.uint64(0x6D2B79F5)) & M32
    t = ((a ^ (a >> np.uint64(15))) * (a | np.uint64(1))) & M32
    t = ((t + (((t ^ (t >> np.uint64(7))) * (t | np.uint64(61))) & M32)) & M32) ^ t
    return ((t ^ (t >> np.uint64(14))) & M32).astype(np.float64) / 4294967296.0


def mulberry32_scalar(seed):
    """Reference scalar form (same as the JS), used to check the vector form."""
    a = seed & 0xFFFFFFFF

    def r():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = ((a ^ (a >> 15)) * (1 | a)) & 0xFFFFFFFF
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return r


def synth_v1(seconds, sr=44100):
    """[L, R] float32 arrays of length round(seconds * sr); computed in float64."""
    n = int(round(seconds * sr))
    t = np.arange(n, dtype=np.float64) / sr
    rnd = mulberry32(20261014, 2 * n)
    nL = rnd[0::2] - 0.5
    nR = rnd[1::2] - 0.5
    pi2 = 2 * np.pi
    pm = np.fmod(t, 0.5)
    kick = np.exp(-30 * pm) * np.sin(pi2 * 55 * pm)
    bass = 0.25 * np.sin(pi2 * 82.41 * t)
    voice = 0.2 * np.sin(pi2 * 440 * t + 2 * np.sin(pi2 * 5 * t)) * (0.6 + 0.4 * np.sin(pi2 * 0.5 * t))
    env = np.exp(-60 * np.fmod(t + 0.25, 0.5))
    hatL = 0.05 * nL * env
    hatR = 0.05 * nR * env
    L = 0.5 * kick + bass + 0.8 * voice + hatL
    R = 0.5 * kick + 0.8 * bass + voice + hatR
    return L.astype(np.float32), R.astype(np.float32)


if __name__ == '__main__':
    secs = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0
    r = mulberry32_scalar(20261014)
    vec = mulberry32(20261014, 1000)
    sc = np.array([r() for _ in range(1000)])
    print('mulberry32 vector vs scalar, 1000 draws, max abs diff', float(np.abs(vec - sc).max()))
    L, R = synth_v1(secs)
    print('n', len(L), 'L[:4]', L[:4].tolist(), 'R[:4]', R[:4].tolist())
    print('peak', float(max(np.abs(L).max(), np.abs(R).max())))

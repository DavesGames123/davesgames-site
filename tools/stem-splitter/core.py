"""Shared parts of the Stem Splitter model tools: paths, model load, Core.

Core is the HTDemucs network with no STFT. It takes the CaC spectrogram
(`mag`) and the waveform (`mix`) of one 7.8 s segment and gives the per
source spectrogram (`spec_out`) and time-branch waveform (`wave_out`).
The JS page does the STFT, the iSTFT and the overlap-add (CONTRACT.md 3).

Port: Core.forward is HTDemucs.forward of demucs/htdemucs.py from
"x = mag" to "xt = xt * stdt + meant" (Demucs, MIT, Copyright (c) Meta
Platforms, Inc. and affiliates). The trial version is the architect's
trials/trial_export.py.

Environment:
  DEMUCS_SRC   the demucs clone (commit e976d93e), default the scratchpad clone
  STEM_CKPT    a folder with the .th files, searched after the page models/

GREP MAP
  paths + lock ........... "def th_path"
  model load ............. "def load_model"
  network core ........... "class Core"
  SDR .................... "def sdr"
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PAGE = os.path.join(ROOT, 'stella-nova', 'pages', 'stem-splitter')
SCRATCH = ('/private/tmp/claude-501/-Users-davidkubala-Downloads-davesgames-site/'
           'fdeeb59e-3272-4258-9f90-6c80e9776ec9/scratchpad/demucs')
DEMUCS_SRC = os.environ.get('DEMUCS_SRC', os.path.join(SCRATCH, 'demucs'))
DEMUCS_COMMIT = 'e976d93ecc3865e5757426930257e200846a520a'
LOCK = json.load(open(os.path.join(HERE, 'fetch.lock.json')))
MODEL_IDS = list(LOCK['files'])

SEG = 343980
SR = 44100


def th_path(model_id):
    """Path of the official .th file: the page models/ folder, then STEM_CKPT,
    then the scratchpad ckpt/."""
    name = LOCK['files'][model_id]['file']
    dirs = [os.path.join(ROOT, LOCK['dir']), os.environ.get('STEM_CKPT', ''), os.path.join(SCRATCH, 'ckpt')]
    for d in dirs:
        p = os.path.join(d, name)
        if d and os.path.exists(p):
            return p
    raise FileNotFoundError(f'{name}: not found. Run: node tools/stem-splitter/fetch.mjs')


def _demucs():
    if DEMUCS_SRC not in sys.path:
        sys.path.insert(0, DEMUCS_SRC)


def load_model(model_id):
    """The official HTDemucs model in eval mode, float32 parameters."""
    import torch
    _demucs()
    from demucs.states import load_model as _load
    pkg = torch.load(th_path(model_id), 'cpu', weights_only=False)
    return _load(pkg).eval()


def make_core(model):
    import torch
    _demucs()
    from einops import rearrange

    class Core(torch.nn.Module):
        def __init__(s, m):
            super().__init__()
            s.m = m

        def forward(s, mag, mix):
            self = s.m
            x = mag
            B, C, Fq, T = x.shape
            mean = x.mean(dim=(1, 2, 3), keepdim=True)
            std = x.std(dim=(1, 2, 3), keepdim=True)
            x = (x - mean) / (1e-5 + std)
            xt = mix
            meant = xt.mean(dim=(1, 2), keepdim=True)
            stdt = xt.std(dim=(1, 2), keepdim=True)
            xt = (xt - meant) / (1e-5 + stdt)
            saved, saved_t, lengths, lengths_t = [], [], [], []
            for idx, encode in enumerate(self.encoder):
                lengths.append(x.shape[-1])
                inject = None
                if idx < len(self.tencoder):
                    lengths_t.append(xt.shape[-1])
                    tenc = self.tencoder[idx]
                    xt = tenc(xt)
                    if not tenc.empty:
                        saved_t.append(xt)
                    else:
                        inject = xt
                x = encode(x, inject)
                if idx == 0 and self.freq_emb is not None:
                    frs = torch.arange(x.shape[-2], device=x.device)
                    emb = self.freq_emb(frs).t()[None, :, :, None].expand_as(x)
                    x = x + self.freq_emb_scale * emb
                saved.append(x)
            if self.bottom_channels:
                b, c, f, t = x.shape
                x = rearrange(x, 'b c f t-> b c (f t)')
                x = self.channel_upsampler(x)
                x = rearrange(x, 'b c (f t)-> b c f t', f=f)
                xt = self.channel_upsampler_t(xt)
            x, xt = self.crosstransformer(x, xt)
            if self.bottom_channels:
                x = rearrange(x, 'b c f t-> b c (f t)')
                x = self.channel_downsampler(x)
                x = rearrange(x, 'b c (f t)-> b c f t', f=f)
                xt = self.channel_downsampler_t(xt)
            for idx, decode in enumerate(self.decoder):
                skip = saved.pop(-1)
                x, pre = decode(x, skip, lengths.pop(-1))
                offset = self.depth - len(self.tdecoder)
                if idx >= offset:
                    tdec = self.tdecoder[idx - offset]
                    length_t = lengths_t.pop(-1)
                    if tdec.empty:
                        pre = pre[:, :, 0]
                        xt, _ = tdec(pre, None, length_t)
                    else:
                        skip = saved_t.pop(-1)
                        xt, _ = tdec(xt, skip, length_t)
            S = len(self.sources)
            x = x.view(B, S, -1, Fq, T) * std[:, None] + mean[:, None]
            xt = xt.view(B, S, -1, mix.shape[-1]) * stdt[:, None] + meant[:, None]
            return x, xt

    return Core(model).eval()


def segment_inputs(model, seg):
    """Core inputs for one segment (torch tensor [1, 2, SEG]): mag via the
    model's own _spec/_magnitude, and mix."""
    z = model._spec(seg)
    return model._magnitude(z), seg


def sdr(ref, est):
    import numpy as np
    ref = np.asarray(ref, dtype=np.float64)
    est = np.asarray(est, dtype=np.float64)
    num = float((ref ** 2).sum())
    den = float(((ref - est) ** 2).sum())
    if den == 0.0:
        return math.inf
    return 10.0 * math.log10(num / den)

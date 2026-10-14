# Stem Splitter model tools

These tools make and check the model files of the Stem Splitter page
(`stella-nova/pages/stem-splitter/`). The spec is that page's `CONTRACT.md`.

| file | what it is |
|---|---|
| `fetch.mjs` + `fetch.lock.json` | download the official Demucs `.th` checkpoints unchanged, sha256 checked (the deploy runs it) |
| `thzip.py` | byte offset of each state tensor inside a `.th` file (no torch) |
| `core.py` | paths, model load, the `Core` wrapper (HTDemucs network, no STFT), SDR |
| `export.py` | `Core` to ONNX, float16 external weights in the `.th`, static shape fold, checker |
| `synth.py` | synth-v1, the test signal (CONTRACT.md 3.5) |
| `demucs_np.py` | numpy port of the Demucs pre/post-processing (CONTRACT.md 3) |
| `parity.py` | torch vs ONNX core; torch `apply_model` vs numpy port + ONNX |
| `make_vectors.py` | writes `test/vectors.json` for the JS engine tests |
| `make_clip_vectors.py` | writes `test/vectors-clip.json`: torch `apply_model` on clipped loud input |
| `opcheck.mjs` | graph ops vs the vendored WebGPU kernels; `--run` in node (wasm EP) |

## Setup

1. Make a venv with onnx and onnxruntime over a Python that has torch 2.7.1
   (the anaconda Python here). Use a folder outside the repo.

   ```sh
   uv venv --system-site-packages --python /opt/homebrew/anaconda3/bin/python3 <scratch>/venv
   uv pip install --python <scratch>/venv/bin/python onnx==1.23.2 onnxruntime==1.23.2
   ```

   The base Python must also have `einops` and `julius` (Demucs imports them).
   The first build used a venv made with `uv venv --system-site-packages`;
   the exact commands of steps 1 and 2 were not run again for this file.

2. Get the Demucs source at the pinned commit. Set `DEMUCS_SRC` to it (the
   default is the scratchpad clone of the first build).

   ```sh
   git clone --depth 1 https://github.com/facebookresearch/demucs <scratch>/demucs
   git -C <scratch>/demucs fetch --depth 1 origin e976d93ecc3865e5757426930257e200846a520a
   git -C <scratch>/demucs checkout e976d93ecc3865e5757426930257e200846a520a
   export DEMUCS_SRC=<scratch>/demucs
   ```

3. Get the weights into `stella-nova/pages/stem-splitter/models/` (git
   ignores them).

   ```sh
   node tools/stem-splitter/fetch.mjs
   node tools/stem-splitter/fetch.mjs --check
   ```

## Run

From the repo root, with `PY=<scratch>/venv/bin/python`:

```sh
$PY tools/stem-splitter/export.py htdemucs        # writes models/htdemucs.onnx
$PY tools/stem-splitter/export.py htdemucs_6s     # writes models/htdemucs_6s.onnx
$PY tools/stem-splitter/parity.py                 # about 1-3 min
$PY tools/stem-splitter/make_vectors.py           # writes test/vectors.json
$PY tools/stem-splitter/make_clip_vectors.py      # writes test/vectors-clip.json (about 5 s)
node tools/stem-splitter/opcheck.mjs
$PY tools/stem-splitter/parity.py --skip-30 --skip-shifts --dump <scratch>/dump
node tools/stem-splitter/opcheck.mjs htdemucs --run --threads 4 --input <scratch>/dump
```

After a new export, write the new graph `bytes` and `sha256` into
`stella-nova/pages/stem-splitter/models.js` and `NOTICE`. The export is
deterministic: a second run gives the same sha256. The `--dump` files
are about 160 MB. Delete them after the run.

`export.py` copies the `.th` into a temporary folder for
`onnx.checker` (it refuses a symlink and a hard link) and deletes the
folder at the end. The torch export goes to memory, so no 170 MB float32
graph is written.

## Numbers (2026-10-14, Apple M4 Pro)

Export:

| | htdemucs | htdemucs_6s |
|---|---|---|
| external float16 parameters | 533/533 | 525/525 |
| nodes after the fold | 2312 (2703 folded) | 2296 (2658 folded) |
| ops removed by the fold | ConstantOfShape Equal Mod Pow Range ReduceProd Shape Where | same |
| ops with no WebGPU kernel (opcheck) | none | none |
| graph file | 6 469 436 B | 5 000 199 B |
| graph sha256 | `e9bdea7e…8c31` | `792568d1…f7d9` |
| fold parity vs the unfolded graph (spec / wave) | 117.8 / 135.2 dB | 128.5 / 120.8 dB |

`parity.py` (onnxruntime 1.23.2 CPU vs torch 2.7.1), SDR in dB:

| check | htdemucs | htdemucs_6s |
|---|---|---|
| (a) core spec_out / wave_out (>= 70) | 95.6 / 87.9 | 113.1 / 104.1 |
| (a) numpy `spec_cac` vs torch `_spec` | 136.6 | 136.6 |
| (b) 10 s per stem (>= 60) | 88.5 89.3 89.5 89.1 | 103.0 104.0 117.1 105.0 102.8 87.8 |
| (b) 30 s per stem (>= 60) | 88.4 88.9 89.1 89.1 | 104.0 104.3 116.5 104.6 102.9 94.9 |
| (c) shifts 2, offsets 1234 and 20000 (>= 60) | 87.2 89.3 90.0 90.2 | not run |

Stem order: drums, bass, other, vocals (, guitar, piano).

`opcheck.mjs --run` (vendored onnxruntime-web 1.30.0, wasm EP, in node 24):

| | htdemucs | htdemucs_6s |
|---|---|---|
| session create | 0.68 s | 0.63 s |
| one segment, 4 threads | 2.57 s | 2.57 s |
| one segment, 1 thread | 8.29 s | not run |
| node RSS after the run | 3.2 GB | 3.1 GB |
| spec_out / wave_out vs torch Core | 80.6 / 64.6 dB | 95.0 / 76.6 dB |

The onnxruntime-web wasm EP is less close to torch than native
onnxruntime (wave_out 64.6 dB vs 87.9 dB). The graph optimisation level
does not change it. Per stem, htdemucs wave_out is 68.0, 65.0, 57.7 and
54.5 dB: the low-energy stems of synth-v1 lose most. The full pipeline in
node (engine/tests.mjs) still gives 64-70 dB per stem.

`make_vectors.py`: `test/vectors.json` is 999 727 B (limit 1 MB).

`make_clip_vectors.py`: `test/vectors-clip.json` is 131 555 B. On this
clipped input the JS pipeline in node gives a stem SDR of drums 48.5,
bass 38.6, other 64.8, vocals 62.8 dB. Against the mix energy the error
is 69.8, 69.9, 65.1 and 104.4 dB. The loss is in the ORT-web wasm core,
not in the JS steps (the parity review: JS specCac against torch _spec
is 136 dB). The op that loses it is not found yet.

Not measured here: any browser, the WebGPU EP, phones.

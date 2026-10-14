# Stem Splitter — build contract

Page key `stem-splitter`, title **Stem Splitter**, region **Sound & Vibration**
(`id: "sound"` in `stella-nova/lib/nav-data.js`), group **Music**.

The user drops a song. The page separates it into stems with Demucs v4
(Hybrid Transformer Demucs, Meta, MIT). All work runs in the browser. The
audio never leaves the device. After the first separation with a model, the
page works with no network.

This file is the spec. Each role touches only the files that the
ownership table gives it. A role that needs a change in a file of another
role writes it under "Requests" in its report.

Upstream: `https://github.com/facebookresearch/demucs`, commit
`e976d93ecc3865e5757426930257e200846a520a` (2023-11-16). A shallow clone
and the architect trial scripts are in the scratchpad:
`/private/tmp/claude-501/-Users-davidkubala-Downloads-davesgames-site/fdeeb59e-3272-4258-9f90-6c80e9776ec9/scratchpad/demucs/`
(`demucs/` = clone, `ckpt/` = the two checkpoints, `trials/` = the export
trials, `venv/` = Python with torch 2.7.1 + onnx 1.23.2 + onnxruntime 1.23.2,
made with `uv venv --system-site-packages` over the anaconda Python).

---

## 1. Facts from the upstream repo (primary sources)

### 1.1 Pretrained models

`demucs/remote/files.txt` and `demucs/remote/*.yaml`. Root URL
`https://dl.fbaipublicfiles.com/demucs/`. Sizes are the HTTP
content-length (HEAD, 2026-10-14).

| Name | Kind | Files | Size | Stems |
|---|---|---|---|---|
| `htdemucs` | 1 HTDemucs | `hybrid_transformer/955717e8-8726e21a.th` | 84 141 911 B | drums, bass, other, vocals |
| `htdemucs_ft` | bag of 4 HTDemucs, one per stem (weights = identity) | `f7e0c4bc-ba3fe64a`, `d12395a8-e57c48e6`, `92cfc3b6-ef3bcb9c`, `04573f0d-f3cf25b2` | 4 x ~84 MB = ~336 MB | 4 |
| `htdemucs_6s` | 1 HTDemucs | `hybrid_transformer/5c90dfd2-34c22ccb.th` | 54 996 327 B | drums, bass, other, vocals, guitar, piano |
| `hdemucs_mmi` | 1 HDemucs (v3) | `hybrid_transformer/75fc33f5-1941ce65.th` | 167 407 275 B | 4 |
| `mdx`, `mdx_extra`, `mdx_q`, `mdx_extra_q` | bags of 4 (v3 / v2) | `mdx_final/*` | 4 files each | 4 |

sha256 of the two files we ship (computed here; the 8 hex digits after the
dash in each file name are the first 8 digits of its sha256):

```
8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4  955717e8-8726e21a.th
34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd  5c90dfd2-34c22ccb.th
```

Hyperparameters (read from the checkpoint `kwargs`, the same for both):
`samplerate 44100`, `audio_channels 2`, `segment Fraction(39, 5)` = 7.8 s,
`nfft 4096`, hop `nfft // 4` = 1024, `cac True`, `wiener_iters 0`,
`depth 4`, `t_layers 5`. `htdemucs` has `bottom_channels 512`; `htdemucs_6s`
has `bottom_channels 0`. Parameters: `htdemucs` 41 984 456, `htdemucs_6s`
27 414 996. **The checkpoint state is stored as float16.** Size = 2 bytes x
parameter count + the pickle.

The `.th` file is a torch zip. Every entry is ZIP_STORED (compress type 0).
Every state tensor is contiguous, has storage offset 0, and owns its whole
storage (checked for all 533 / 525 tensors). So each weight is a plain
float16 byte range inside the `.th` file.

### 1.2 Licence of the weights

- Code: MIT, `LICENSE` in the repo root, "Copyright (c) Meta Platforms, Inc.
  and affiliates."
- Weights: there is no separate licence and no model card. The only licence
  statement is project wide: README.md, section "License" (line 300-302):
  "Demucs is released under the MIT license as found in the LICENSE file."
  `setup.py` also says `license='MIT License'`. The MIT code itself names the
  weight URLs (`demucs/remote/files.txt`, `pretrained.py ROOT_URL`).
- Decision: we host the official files unchanged, under that MIT statement,
  with the MIT text and the source URL next to the page. NOTICE says that
  the weights carry no licence other than the README statement, and that
  the training data (MUSDB18-HQ + 800 songs, README line 222) has its own
  terms that we do not redistribute.
- Open point for the owner (not a blocker): this is the README's
  project-wide line, not a weights-specific licence.

### 1.3 Forward pass (what JS must reproduce)

`demucs/api.py separate_tensor`, `demucs/apply.py apply_model`,
`demucs/htdemucs.py forward/_spec/_ispec/_magnitude/_mask`,
`demucs/spec.py`. Section 3 gives the exact JS steps.

---

## 2. Decisions

### 2.1 Models shipped

| id | label in UI | stems | why |
|---|---|---|---|
| `htdemucs` (default) | "4 stems" | drums, bass, other, vocals | the README default; 84.1 MB |
| `htdemucs_6s` | "6 stems (adds guitar, piano)" | + guitar, piano | the user asked for it; 55.0 MB; the README says piano "is not working great" — the UI says so |

Not shipped: `htdemucs_ft` (4 x 84 MB = 336 MB download and 4x the time,
for a small SDR gain: README table, 9.0 for ft); `hdemucs_mmi` (167 MB, v3,
older); `mdx*` (v3/v2 bags). The site Pages artifact is already about
690 MB (331 MB tracked + 274 MB craft + 86 MB retro); GitHub Pages has a
1 GB site limit. Our two models add 139 MB, so about 830 MB. Do not add
`htdemucs_ft`.

### 2.2 Precision

- Storage: **float16, the official bytes, unchanged.** The checkpoint is
  already float16, so this is lossless against the PyTorch model (PyTorch
  loads the same float16 values into float32 parameters).
- Compute: **float32.** The graph has one `Cast(to=FLOAT)` after each
  float16 initializer. ORT folds these at session creation, so the session
  holds float32 weights: 168 MB (`htdemucs`), 110 MB (`htdemucs_6s`).
- No float16 compute: the attention and GroupNorm paths can overflow in
  fp16, and parity would fall. Not in this build.
- Download per model: graph + weights = about 6.6 + 84.1 = 90.7 MB
  (`htdemucs`), about 5.2 + 55.0 = 60.2 MB (`htdemucs_6s`). Plus the ORT
  runtime: 28.3 MB wasm + 0.4 MB mjs (vendored, shared with market-forecast).

### 2.3 Export: ONNX core, STFT in JS

The ONNX graph holds the network only. JS does STFT, iSTFT, the complex
"mask", track normalisation, segmenting, overlap-add and shifts. This was
tried here (scratchpad `trials/trial_export.py`, `trials/extprobe.py`) and
works:

- Export: `torch.onnx.export(..., opset_version=17, dynamo=False,
  do_constant_folding=False)`. Call
  `torch.backends.mha.set_fastpath_enabled(False)` first, else the exporter
  fails on `aten::_native_multi_head_attention`.
- Load the checkpoint with `torch.load(path, 'cpu', weights_only=False)`
  then `demucs.states.load_model(package)` (torch 2.7 refuses the pickle
  with the default `weights_only=True`).
- The wrapper `Core(mag, mix)` is `HTDemucs.forward` from "x = mag" to
  "xt = xt * stdt + meant", with the input normalisation and the output
  de-normalisation **inside** the graph (they are plain Reduce/Sub/Div ops).

**Boundary tensors** (float32, batch 1, fixed shapes, no dynamic axes):

| name | dir | shape | meaning |
|---|---|---|---|
| `mag` | in | `[1, 4, 2048, 336]` | CaC spectrogram of the segment: channels `[L.re, L.im, R.re, R.im]`, 2048 bins (Nyquist bin dropped), 336 frames. Not normalised. |
| `mix` | in | `[1, 2, 343980]` | the segment waveform (after track normalisation, see 3.2). Not normalised per segment. |
| `spec_out` | out | `[1, S, 4, 2048, 336]` | per source CaC spectrogram, same channel order as `mag`. Already de-normalised. |
| `wave_out` | out | `[1, S, 2, 343980]` | per source time-branch waveform. Already de-normalised. |

S = 4 (`htdemucs`) or 6 (`htdemucs_6s`). Source order = `models.js` `stems`.

Per segment result: `stem[s][c] = wave_out[s][c] + ispec(spec_out[s])[c]`.

**External data into the official file.** The graph keeps no weights. Each
parameter initializer `m.<state key>` becomes a float16 initializer
`m.<state key>__f16` with `data_location = EXTERNAL`,
`location = "<the .th file name>"`, `offset = <byte offset in the .th>`,
`length = 2 x numel`, and a `Cast` node gives the old float32 name. Byte
offset = zip local header offset + 30 + name length + extra length (read
from the local header), for entry `archive/data/<storage key>`. The storage
key comes from `persistent_load` of `archive/data.pkl` (see
`trials/extprobe.py`). Trial result: 533/533 (`htdemucs`) and 525/525
(`htdemucs_6s`) parameters mapped, each byte-checked equal to the state
dict, no unmapped initializer.

Trial parity, torch core vs ONNX (onnxruntime 1.23.2 CPU, Python), one
random segment:

| model | spec_out SDR | wave_out SDR | graph file |
|---|---|---|---|
| htdemucs | 75.3 dB | 97.1 dB | 6 624 641 B |
| htdemucs_6s | 82.2 dB | 75.5 dB | 5 193 185 B |

Full model `m(mix)` vs `Core` + `_mask` + `_ispec` in torch: max abs
difference 0.0 (the split is exact).

Graph size: 5.5 MB of the 6.6 MB is one Constant, the crosstransformer
2D sine position embedding (`[2688, 512]` float32). Keep it as float32.

Op check: the vendored JSEP bundle names WebGPU kernels for all ops in the
trial graph except `Mod` and `ConstantOfShape` (shape arithmetic). MODEL
folds the static shape subgraphs (shapes are fixed) so that the final graph
uses only ops that `ort.min.mjs` lists, or at most CPU-side shape ops.

### 2.4 Runtime

- onnxruntime-web 1.30.0, vendored at `stella-nova/vendor/onnxruntime-web@1.30.0/dist/`
  (JSEP: one wasm for the `webgpu` and `wasm` EPs). Load it in a **module
  Worker** with `ort.env.wasm.wasmPaths` = that folder, as
  `pages/market-forecast/worker.js` does. No CDN.
- EP: `webgpu` when `navigator.gpu` gives an adapter in the worker, else
  `wasm`. If the WebGPU session fails to build or the first run throws,
  build a `wasm` session and report `fallback` with the error text (first
  200 characters).
- Session options: `graphOptimizationLevel: 'all'`,
  `externalData: [{ path: '<file>.th', data: Uint8Array }]`.
- Threads: `ort.env.wasm.numThreads = self.crossOriginIsolated ?
  min(4, hardwareConcurrency) : 1`. The shell shows pages in one iframe and
  the site has no COOP/COEP headers, so in practice the wasm EP runs on
  **one thread**. Cross-origin isolation is rejected for this build: the
  shell would need COOP/COEP for every page, which breaks cross-origin
  iframes and images elsewhere.
- Segment: 343 980 samples (7.8 s, fixed: HTDemucs pads every input to its
  training length). Overlap 0.25, so stride 257 985 samples (5.85 s).
  Segments for a song of N samples: `ceil(N / 257985)`. A 4 minute song
  (10 584 000 samples) has 42 segments.
- Measured here (Apple M4 Pro, node 24.12.0, vendored ORT-web wasm EP,
  `htdemucs`, one segment): session create 0.76 s; run 7.9 s at 1 thread,
  2.4 s at 4 threads. Node RSS after one run: 3.0-3.2 GB (this includes node
  itself and the 84 MB weights buffer). onnxruntime native CPU: 0.97 s.
- Time budget, 4 minute song, Standard quality (42 segments). Measured
  rows are marked M; estimates are marked E and are not verified (no
  browser runs on this machine):

  | device | EP | per segment | song |
  |---|---|---|---|
  | laptop (M4 Pro class) | wasm, 1 thread | 7.9 s (M) | ~5.5 min (M x 42) |
  | laptop | webgpu | 0.4-1.5 s (E) | 0.3-1 min + 5-20 s first shader compile (E) |
  | phone (recent) | webgpu | 2-6 s (E) | 1.5-4 min (E) |
  | phone | wasm | 20-40 s (E) | may fail: memory (E) |

  "Best" quality (2 shifts) doubles every row.
- Memory, 4 minute song, worker JS heap: input 2 x 10.58 M x 4 B = 85 MB;
  output accumulator S x 85 MB (339 MB for 4 stems, 508 MB for 6); weight
  sum 2.8 MB (one segment of float64, `segmentWeightSum`; it was an N-length
  float64 array of 85 MB before the review fix); per segment `mag` 11 MB, `spec_out` 44 MB (66 MB for 6),
  `wave_out` 11 MB (17 MB). Plus the ORT heap (wasm: about 2.5-3 GB peak,
  from the node RSS above; webgpu: GPU memory, not measured). Limit: the UI
  refuses songs over 20 min, and over 8 min on a phone (coarse pointer and
  width under 700 px), with a message.
- Progress: one event per finished segment run, with `done`, `total`,
  `elapsedMs`, `etaMs`. ETA = mean time of the finished segments, without
  the first segment once a second one is done (the first one has shader
  compile), times the segments left.
- Cancel: a soft cancel stops at the next segment boundary (a `run()` call
  cannot be stopped; at most one segment, 8 s on wasm). The client also
  has `terminate()`: it ends the worker at once. pagehide and
  `window.__snRelease` call `terminate()` (as `market-forecast/engine.js`
  does), which frees the worker's WebGPU device.
- Memory release: after `separate` the worker transfers the stem arrays to
  the main thread (no copy) and keeps no reference. `dispose` releases the
  sessions. Switching model releases the old session first.

### 2.5 Hosting and offline

**Weights are not in git.** The two `.th` files are fetched at deploy time
from `dl.fbaipublicfiles.com` (unchanged, sha256 checked), like
`tools/craft-fetch.mjs` does for the Craft builds. Reasons: git is 263 MB
now and would grow by 139 MB for ever; GitHub warns over 50 MB per file and
refuses over 100 MB; the Meta CDN sends **no CORS header** (HEAD with an
Origin header: no `access-control-*`; OPTIONS: 403), so the browser cannot
fetch the files from Meta itself.

- `tools/stem-splitter/fetch.mjs` downloads each pinned file to
  `stella-nova/pages/stem-splitter/models/<file>.th`, checks the sha256,
  and skips a file that is present with the right hash. `--check` changes
  nothing and exits 1 when a file is absent or wrong.
- `.gitignore` gets `stella-nova/pages/stem-splitter/models/*.th`.
- `.github/workflows/pages.yml` gets, before "Write offline manifest":
  an `actions/cache@v4` step (path `stella-nova/pages/stem-splitter/models/*.th`,
  key `stem-weights-8726e21a-34c22ccb`) and a step
  `node tools/stem-splitter/fetch.mjs && node tools/stem-splitter/fetch.mjs --check`
  with `continue-on-error: true` (the page then says the model is not
  available). The cache stops a 139 MB download from Meta on each of the
  12 scheduled deploys per day.
- The graphs (`models/htdemucs.onnx`, `models/htdemucs_6s.onnx`, about
  12 MB together) are committed.

**Offline.** The service worker manifest has two lists. `core` is
downloaded at install. `lazy` is downloaded **in the background for every
visitor** (`sw.js warm()`, sent by `lib/offline.js warmLater`). So
`LAZY_DIRS` is the wrong place for the model: it would push 150 MB to every
visitor. The plan:

1. Page code (`index.html`, `main.js`, `models.js`, `engine/*.js`,
   `ui/*.js`, `style.css`) stays in the manifest. It is code, so it is
   `core`: offline after one visit.
2. The ORT runtime is already lazy (`LAZY_DIRS` has
   `/^stella-nova\/vendor\/onnxruntime-web@[^/]+\//`). The worker also
   keeps it when the page first asks for it.
3. The model directory and the test vectors are **not in the manifest**.
   INTEGRATE adds these two lines to `EXCLUDE` in
   `tools/offline-manifest.mjs`:
   ```js
     /^stella-nova\/pages\/stem-splitter\/models\//,  // graphs + weights: engine cache, on demand
     /^stella-nova\/pages\/stem-splitter\/test\//,    // node test vectors
   ```
4. The service worker must not copy the model into `sn-runtime` (it would
   store a second 84 MB copy and download it again on each load, stale
   while revalidate). INTEGRATE adds to `sw.js`, next to `LIVE_PATH`:
   ```js
   // Model files: the page keeps them in its own cache (stem-splitter engine).
   const PASS_PATH = /^stella-nova\/pages\/stem-splitter\/models\//;
   ```
   and in `route()`, after `if (path === null) return null;`:
   ```js
       if (PASS_PATH.test(path)) return null;
   ```
   Then run `node tools/offline-manifest.mjs` (it stamps the new sw.js).
5. The engine keeps the graph and the weights in Cache Storage, cache name
   `stem-models-v1`, key = the absolute file URL + `?sha=` + sha256. It
   checks the sha256 (`crypto.subtle.digest`) after download and before it
   stores. It reads the cache first, so with no network a cached model
   works. It calls `navigator.storage.persist()` after the first stored
   model. OPFS was considered: Cache Storage is simpler, has the same quota
   and is what market-forecast uses. Safari can delete site storage after
   7 days with no visit; the UI then shows the model as "not downloaded".
6. Never size a buffer from `content-length` (Pages can gzip). Join the
   chunks at their real size; use `models.js` `bytes` for progress only.

### 2.6 Audio I/O

- Input: `<input type=file accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.opus">`
  and drag-and-drop. Decode with
  `new OfflineAudioContext(2, 1, 44100).decodeAudioData(arrayBuffer)`: the
  browser resamples to 44 100 Hz, so no JS resampler.
- Channels (as `demucs/audio.py convert_audio_channels`): 1 channel -> copy
  to L and R; 2 -> as is; more than 2 -> the first two.
- Output: one `AudioBuffer` per stem for playback. WAV export: 16-bit PCM,
  44 100 Hz, stereo, with the Demucs default clip rule
  `wav / max(1.01 * max|wav|, 1)` per file (`audio.py prevent_clip`,
  "rescale"). File names `<song>_<stem>.wav`; karaoke file
  `<song>_no_vocals.wav` (sum of all stems except vocals, the Demucs
  `--two-stems` name).
- Zip of all stems: vendored `stella-nova/vendor/jszip@3.10.1/dist/jszip.min.js`
  (classic script, `window.JSZip`), STORE (no compression: WAV does not
  compress), file `<song>_stems.zip`.

---

## 3. JS processing steps (DSP+RUNTIME implements; MODEL mirrors in numpy)

Constants: `SR = 44100`, `NFFT = 4096`, `HOP = 1024`, `SEG = 343980`,
`BINS = 2048`, `FRAMES = 336`, `OVERLAP = 0.25`, `STRIDE = 257985`,
`MAX_SHIFT = 22050`.

### 3.1 Track normalisation (api.py)

`ref[i] = (L[i] + R[i]) / 2`; `mean = mean(ref)`; `std` = unbiased
standard deviation of `ref` (divide by N - 1). Both channels:
`x = (x - mean) / (std + 1e-8)`. After separation every stem:
`y = y * (std + 1e-8) + mean`. Compute the sums in float64.

### 3.2 Segment plan and weights (apply.py, split branch)

- `offsets = [0, STRIDE, 2*STRIDE, ...]` while `offset < N`.
- `weight[j] = (j + 1) / 171990` for `j < 171990`, then
  `weight[171990 + k] = (171990 - k) / 171990` for `k = 0 .. 171989`
  (`th.cat([arange(1, seg//2 + 1), arange(seg - seg//2, 0, -1)]) / max`,
  `transition_power = 1`).
- Chunk: `chunkLen = min(N - offset, SEG)`. Padded input of length SEG
  (`TensorChunk.padded`): `delta = SEG - chunkLen`,
  `start = offset - floor(delta / 2)`, take samples `start .. start+SEG-1`
  of the track; samples outside `0 .. N-1` are 0. **Samples before
  `offset` are real track samples when they exist, not zeros.**
- Model output of length SEG -> `center_trim` to chunkLen: drop
  `floor(delta / 2)` samples at the left (the extra sample goes to the
  right).
- Accumulate `out[s][c][offset + j] += weight[j] * y[s][c][j]` and
  `sum[offset + j] += weight[j]` for `j < chunkLen`. At the end
  `out /= sum`.

### 3.3 Shifts (apply.py, shifts branch)

`shifts = 0` (Standard): no shift. `shifts = K > 0` (Best uses K = 2):
pad the whole track with MAX_SHIFT zeros on each side. For each shift k
take `off_k` in `0 .. MAX_SHIFT`; the shifted input is the padded track
from `off_k`, length `N + MAX_SHIFT - off_k`; run 3.2 on it; keep its
output from `MAX_SHIFT - off_k`, length N; average the K outputs. Upstream
draws `off_k` with `random.randint`. We draw them with `mulberry32(seed)`
(seed default 0x5eed): `off_k = floor(rng() * (MAX_SHIFT + 1))`. Tests may
pass the offsets.

### 3.4 One segment: STFT -> core -> iSTFT

`_spec` (htdemucs.py) for one channel x of length SEG:

1. `le = ceil(SEG / HOP)` = 336. `pad = HOP / 2 * 3` = 1536.
2. Reflect-pad x by `pad` left and `pad + le*HOP - SEG` right (reflect
   = mirror without repeating the edge, `torch` mode "reflect").
3. `torch.stft(n_fft=4096, hop=1024, window=hann(4096, periodic),
   win_length=4096, normalized=True, center=True, pad_mode='reflect')`:
   reflect-pad 2048 each side again, frames at hop 1024, rFFT of
   `window * frame`, times `1 / sqrt(4096)` (normalized). 340 frames,
   2049 bins.
4. Drop the last bin (keep 2048), keep frames `2 .. 337` (336 frames).
5. CaC: `mag[c*2 + 0][f][t] = re`, `mag[c*2 + 1][f][t] = im`, c = 0 (L),
   1 (R). Layout `[4][2048][336]`, row major.

`_ispec` for one source s and channel c of `spec_out`:

1. Complex `Z[f][t] = spec_out[s][c*2][f][t] + i spec_out[s][c*2+1][f][t]`.
2. Add a zero bin 2048 (2049 bins) and 2 zero frames at each side (340
   frames).
3. `torch.istft(n_fft=4096, hop=1024, window=hann(4096, periodic),
   normalized=True, center=True, length=le*HOP + 2*pad)`: irFFT each frame,
   times `sqrt(4096)` (normalized), times window, overlap-add, divide by
   the overlap-added `window^2`, drop 2048 samples of center padding.
4. Keep samples `pad .. pad + SEG - 1`.

Segment result: `y[s][c] = wave_out[s][c] + ispec(spec_out[s])[c]`.

FFT: radix-2, size 4096, float64, own code (no library). Precompute the
window and twiddles once.

### 3.5 Synthetic test signal `synth-v1` (shared by Python and JS)

All audio in tests is this signal. It is ours (no copyright). Compute in
float64, store as float32. `t = i / 44100`. `rng = mulberry32(20261014)`;
for each sample draw `nL = rng() - 0.5` then `nR = rng() - 0.5`, in that
order.

```
mulberry32(a): a = (a + 0x6D2B79F5) | 0;
               t = imul(a ^ (a >>> 15), 1 | a);
               t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
               return ((t ^ (t >>> 14)) >>> 0) / 4294967296
pm    = t mod 0.5
kick  = exp(-30 * pm) * sin(2*pi*55 * pm)
bass  = 0.25 * sin(2*pi*82.41 * t)
voice = 0.2 * sin(2*pi*440 * t + 2 * sin(2*pi*5 * t)) * (0.6 + 0.4 * sin(2*pi*0.5 * t))
hatX  = 0.05 * nX * exp(-60 * ((t + 0.25) mod 0.5))
L = 0.5*kick + bass       + 0.8*voice + hatL
R = 0.5*kick + 0.8*bass   + voice     + hatR
```

The Python port must use 32-bit unsigned arithmetic with masks
(`& 0xffffffff`) and give the same values as the JS (checked by the first
256 samples in the vectors file).

---

## 4. File ownership

| Role | Owns (create / edit only these) |
|---|---|
| **MODEL** | `tools/stem-splitter/` (all: `README.md`, `export.py`, `thzip.py`, `synth.py`, `parity.py`, `make_vectors.py`, `opcheck.mjs`, `fetch.mjs`, `fetch.lock.json`); `stella-nova/pages/stem-splitter/models/htdemucs.onnx`, `models/htdemucs_6s.onnx`; `stella-nova/pages/stem-splitter/models.js`; `stella-nova/pages/stem-splitter/test/vectors.json`; `stella-nova/pages/stem-splitter/NOTICE`; `stella-nova/pages/stem-splitter/LICENSE-demucs.txt`; the one `.gitignore` line; the `pages.yml` cache + fetch steps |
| **DSP+RUNTIME** | `stella-nova/pages/stem-splitter/engine/` (all: `fft.js`, `dsp.js`, `segment.js`, `synth.js`, `weights.js`, `worker.js`, `client.js`, `tests.mjs`) |
| **UI** | `stella-nova/pages/stem-splitter/ui/` (all: `app.js`, `dropzone.js`, `audio-io.js`, `wav.js`, `player.js`, `mixer.js`, `waveform.js`, `sheet.js`, `fakedom.mjs`, `tests.mjs`); `stella-nova/pages/stem-splitter/style.css` |
| **INTEGRATE** (after the three) | `stella-nova/pages/stem-splitter/index.html`, `main.js`, `tests.mjs`; the row in `stella-nova/lib/nav-data.js`; the blurb in `stella-nova/pages/home/sectors.js`; the files that `tools/nav-sync.js` writes; `pages/home/thumbs/stem-splitter.jpg`, `thumbs/sm/stem-splitter.jpg`, `thumbs/list.js`; the two `EXCLUDE` lines in `tools/offline-manifest.mjs`; the `PASS_PATH` lines in `sw.js`; the regenerated `sw.js` stamp and `sw-manifest.js` |
| **ARCHITECT** | this file |

File names inside a role's directory are a proposal; a role may split or
merge its own files, but the exported names in section 5 are fixed.

---

## 5. Interfaces

### 5.1 `models.js` (MODEL writes it from the export; ES module, no DOM)

```js
export const MODEL_FORMAT = 1;
export const AUDIO = { sampleRate: 44100, channels: 2, segment: 343980, nfft: 4096, hop: 1024, bins: 2048, frames: 336, overlap: 0.25 };
export const MODELS = {
  htdemucs: {
    id: 'htdemucs', label: '4 stems', note: 'Demucs v4 (htdemucs), the default model',
    stems: ['drums', 'bass', 'other', 'vocals'],
    graph:   { file: 'models/htdemucs.onnx', bytes: <int>, sha256: '<hex>' },
    weights: { file: 'models/955717e8-8726e21a.th', name: '955717e8-8726e21a.th', bytes: 84141911,
               sha256: '8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4',
               source: 'https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th' },
    inputs:  { mag: [1, 4, 2048, 336], mix: [1, 2, 343980] },
    outputs: { spec_out: [1, 4, 4, 2048, 336], wave_out: [1, 4, 2, 343980] },
  },
  htdemucs_6s: { /* same keys; stems + guitar, piano; 5c90dfd2-34c22ccb.th, 54996327 B,
                    sha256 34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd;
                    outputs S = 6 */ },
};
export const DEFAULT_MODEL = 'htdemucs';
```

Paths are relative to the page folder. `weights.name` is the
`externalData` path that the graph names.

### 5.2 Engine pure functions (DSP+RUNTIME; no DOM, importable in node)

`engine/fft.js`
- `export function makeFFT(n)` -> `{ forward(re, im), inverse(re, im) }`
  in place on Float64Array, n a power of 2.

`engine/dsp.js`
- `export function hann(n)` -> Float64Array, periodic.
- `export function specCac(left, right)` -> Float32Array `4*2048*336`
  (3.4 `_spec` + CaC). Inputs Float32Array of length 343980.
- `export function ispecCac(specOut, s, length = 343980)` ->
  `[Float32Array, Float32Array]` (3.4 `_ispec` for source s; specOut is
  the flat `spec_out` data).
- `export function stft(x, opts)` / `export function istft(re, im, opts)`:
  the generic torch-equivalent pair, used by `specCac`/`ispecCac`, and by
  tests with other lengths. opts `{ nfft, hop, normalized, length }`.
- `export function trackStats(left, right)` -> `{ mean, std }` (3.1).

`engine/segment.js`
- `export function segmentPlan(n, { segment = 343980, overlap = 0.25 } = {})`
  -> `{ stride, offsets: number[] }`.
- `export function transitionWeight(segment = 343980)` -> Float32Array.
- `export function paddedChunk(left, right, offset, segment = 343980)` ->
  `{ mix: Float32Array(2*segment), chunkLen, trimLeft }`.
- `export async function separate(left, right, opts)` -> 
  `Float32Array[S][2]` (each length N). opts:
  `{ runCore, sources: S, overlap = 0.25, shifts = 0, shiftOffsets?, seed = 0x5eed,
     onProgress?, isCancelled? }`.
  `runCore(mag: Float32Array, mix: Float32Array)` ->
  `Promise<{ spec_out: Float32Array, wave_out: Float32Array }>`.
  It does 3.1 to 3.4. It throws `new Error('cancelled')` at the first
  segment boundary after `isCancelled()` is true. `onProgress({ done,
  total, elapsedMs, etaMs })` after each segment; `total =
  offsets.length * max(1, shifts)`.

`engine/synth.js`
- `export function mulberry32(seed)`; `export function synthV1(seconds)`
  -> `[Float32Array L, Float32Array R]` (3.5).

`engine/weights.js` (browser and node; uses `fetch`, `caches` when present)
- `export async function getModelBytes(url, { bytes, sha256 }, onProgress)`
  -> `{ data: Uint8Array, fromCache: boolean }`. Cache `stem-models-v1`.
- `export async function cachedModels(MODELS)` -> `{ [id]: boolean }`.
- `export async function evictModel(model)`.

### 5.3 Worker protocol (`engine/worker.js`, module worker)

Requests `{ id, op, ... }`; replies `{ id, ok: true, result }` or
`{ id, ok: false, error, code }` (`code`: `'cancelled' | 'oom' | 'net' |
'hash' | 'session' | 'run'`). One request runs at a time, except `cancel`.

| op | request fields | result |
|---|---|---|
| `init` | `ep: 'auto' \| 'webgpu' \| 'wasm'` | `{ ep, gpu, threads, isolated }` |
| `load` | `model` | `{ model, ep, fallback, fromCache, downloadMs, createMs }` |
| `separate` | `model, left, right` (Float32Array, 44.1 kHz, transferred), `quality: 'standard' \| 'best'`, `shiftOffsets?` | `{ model, stems: { [name]: [Float32Array, Float32Array] }, ms, ep, segments }`, arrays transferred |
| `cancel` | — | `{ cancelled: true }`; the running `separate` then fails with `code: 'cancelled'` |
| `cached` | — | `{ [modelId]: boolean }` |
| `evict` | `model` | `{ model }` |
| `dispose` | — | `{}` (sessions released) |

Events (no id): `{ op: 'progress', phase: 'download', model, loaded, total }`,
`{ op: 'progress', phase: 'verify' | 'session', model }`,
`{ op: 'progress', phase: 'separate', model, done, total, elapsedMs, etaMs }`.

`quality`: `standard` = `{ shifts: 0, overlap: 0.25 }`, `best` =
`{ shifts: 2, overlap: 0.25 }`.

### 5.4 Client (`engine/client.js`, main thread) — what the UI calls

```js
export function createEngine({ workerUrl } = {}) -> Engine
Engine = {
  init({ ep = 'auto' } = {}): Promise<{ ep, gpu, threads, isolated }>,
  models(): Promise<Array<{ id, label, note, stems, bytes, cached }>>,   // bytes = graph + weights
  load(modelId, onProgress): Promise<{ ep, fallback, fromCache }>,
  separate({ modelId, left, right, quality, onProgress }): Promise<{ stems, ms, ep, segments }>,
  cancel(): void,
  evict(modelId): Promise<void>,
  terminate(): void,          // ends the worker now; the next call starts a new one
}
```

`createEngine` wraps `window.__snRelease` and adds a `pagehide` listener
that call `terminate()`. The UI tests use a fake object with the same
shape.

### 5.5 UI entry (`ui/app.js`)

```js
export function mountApp(root, { engine, models, defaultModel, jszip }) -> { destroy() }
```
`main.js` (INTEGRATE) is only:
```js
import { createEngine } from './engine/client.js';
import { MODELS, DEFAULT_MODEL } from './models.js';
import { mountApp } from './ui/app.js';
mountApp(document.getElementById('app'), { engine: createEngine(), models: MODELS, defaultModel: DEFAULT_MODEL, jszip: window.JSZip });
```
plus `window.snSaver` is **not** set (no saver, see 6.4).

### 5.6 Reference vectors (`test/vectors.json`, MODEL writes, DSP reads)

One JSON file, at most 1 MB. Float arrays are base64 of little-endian
Float32 (`"f32:<base64>"`); index arrays are base64 Uint32 (`"u32:<base64>"`).
Indices are chosen by `mulberry32(7)`, sorted, unique.

```json
{
  "format": "stem-splitter-vectors/1",
  "made_by": "tools/stem-splitter/make_vectors.py",
  "torch": "2.7.1", "demucs_commit": "e976d93e…", "onnxruntime": "1.23.2",
  "synth": { "name": "synth-v1", "head": "f32:… [2][256]" },
  "stft":  { "seconds": 1, "length": 44100, "shape": [4, 2048, 44],
             "idx": "u32:… (4096)", "val": "f32:…", "l2": [4 numbers] },
  "istft": { "length": 44100, "gain": "g[f] = 1 / (1 + f / 100) on spec of synth 1 s",
             "idx": "u32:… (4096)", "val": "f32:…", "l2": [2 numbers] },
  "plan":  { "length": 441000, "stride": 257985, "offsets": [0, 257985],
             "chunks": [ { "offset": 257985, "chunkLen": 183015, "start": 177503, "trimLeft": 80482 } ],
             "sumIdx": "u32:…", "sumVal": "f32:…" },
  "core": { "htdemucs": { "input": "synth-v1 10 s, track-normalised, segment 0",
             "magIdx": "u32:…", "magVal": "f32:…",
             "specIdx": "u32:… (8192)", "specVal": "f32:…",
             "waveIdx": "u32:… (8192)", "waveVal": "f32:…",
             "energy": { "spec": [S numbers], "wave": [S numbers] } },
            "htdemucs_6s": { … } },
  "pipeline": { "htdemucs": { "seconds": 10, "quality": "standard",
                  "stems": { "drums": { "idx": "u32:… (4096)", "L": "f32:…", "R": "f32:…", "energy": n }, … } },
                "htdemucs_shift": { "seconds": 10, "shifts": 2, "shiftOffsets": [1234, 20000], "stems": { … } } }
}
```

`core.*` is the PyTorch `Core` on the segment input; `pipeline.*` is
PyTorch `apply_model(model, wav[None], shifts=0, split=True,
overlap=0.25)` with the api.py normalisation (3.1), on synth-v1 10 s.
`htdemucs_shift` patches `random.randint` to give the listed offsets.
The plan values above are computed from 3.2 (N = 441000).

---

## 6. Product (UI)

### 6.1 Flow

1. **Drop zone**: a large target, "Drop a song or choose a file". A line
   under it: "Your audio stays on this device. Nothing is uploaded."
   Shows name, duration, sample rate after decode.
2. **Model picker**: "4 stems" (default) or "6 stems (adds guitar,
   piano)", each with its download size and "downloaded" / "not
   downloaded" state, and "Remove download". Quality: Standard / Best
   (2x time). A line shows the EP: "GPU (WebGPU)" or "CPU (slower)".
3. **Separate**: one button. Progress: phase text (Downloading model
   x of y MB / Checking / Preparing / Separating segment n of m), a bar,
   elapsed and time left. Cancel button.
4. **Mixer** after separation: one row per stem (name, colour, waveform,
   mute, solo, volume slider), plus an "Original" row (muted by default).
   Transport: play/pause, seek bar with time, sample-accurate sync of all
   stems. Buttons: "Karaoke" (mutes vocals, clears solo), "Vocals only"
   (solo vocals), "All". Download: each stem (WAV), "No vocals" (WAV),
   "All stems" (zip).
5. Errors: no WebAssembly; model download failed (offline and not
   cached); hash mismatch; out of memory (suggest the 4-stem model, a
   shorter song, or a computer with WebGPU); decode failed (format not
   supported by this browser).

### 6.2 Player rules

- One `AudioContext`. Per stem: `AudioBufferSourceNode` -> `GainNode`
  -> master `GainNode` -> destination.
- Play: create new sources for all stems, `start(when, offset)` with the
  same `when = ctx.currentTime + 0.05` and the same `offset`. Pause /
  seek: stop all sources, keep the position, restart on play.
- Position = `offset + (ctx.currentTime - when)` while playing.
- Gain of a stem = `volume * (anySolo ? (solo ? 1 : 0) : (mute ? 0 : 1))`,
  changed with `setTargetAtTime(v, now, 0.01)`.
- Space = play/pause when focus is not in a text field.

### 6.3 Layout

- Desktop: two columns (left: file, model, separate; right: mixer).
- Phone (width under 700 px or coarse pointer): one column; transport in
  a bottom dock; model and quality settings in a sheet (the
  `pages/wave-membrane` dock/sheet pattern). 16 px side gutters, no
  horizontal scroll, touch targets at least 44 px, sliders with
  `touch-action: none` on the thumb track only.
- `style.css` has `[hidden] { display: none !important; }`.
- Fonts: the system UI stack (`system-ui, -apple-system, "Segoe UI",
  Roboto, sans-serif`), numbers with `font-variant-numeric: tabular-nums`.
  Never Playfair, Cormorant or JetBrains Mono.
- Stem colours: drums `#ff8a5c`, bass `#7a9cff`, other `#b48cff`,
  vocals `#ff8ac2`, guitar `#ffd166`, piano `#5fd3a8`, original `#9aa3b2`.
- Waveform: min/max peaks per pixel column, computed once per stem
  (`ui/waveform.js computePeaks(data, columns)`), drawn on a canvas with
  `devicePixelRatio`; a play head line.

### 6.4 Screensaver

No saver. The page has nothing to show until a user gives it a song, and
we must not ship copyrighted audio. INTEGRATE does not add a catalog line
unless `lib/screensaver-catalog.js` requires one per page; if it does,
add the entry with no hook (`hook: false`, not `default`).

---

## 7. Role tasks

### 7.1 MODEL

1. `tools/stem-splitter/export.py <model> <out.onnx>`: the `Core` export
   of 2.3, then the float16 external-data rewrite, then static shape
   folding (no `Mod`, no `ConstantOfShape` left, if the fold keeps parity),
   then `onnx.checker`. Write `models/<id>.onnx`.
2. `thzip.py`: storage key and byte offset of each state tensor of a `.th`
   (no torch needed for the offsets: zip + pickle with a stub unpickler).
3. `synth.py`: synth-v1 (3.5).
4. `parity.py`: (a) torch `Core` vs ONNX on segment 0 of synth-v1 10 s;
   (b) torch full pipeline (`apply_model` + api normalisation) vs a numpy
   port of section 3 (numpy FFT, not `torch.stft`) + the ONNX core in
   onnxruntime CPU, on synth-v1 10 s and 30 s, both models; (c) the same
   with shifts 2 and fixed offsets. Prints the SDR per output and stem.
5. `make_vectors.py`: writes `test/vectors.json` (5.6).
6. `opcheck.mjs`: lists the op types of each graph and checks each one
   against the op names in the vendored `ort.min.mjs`. Prints the ops that
   have no WebGPU kernel.
7. `fetch.mjs` + `fetch.lock.json` (file, url, bytes, sha256), the
   `.gitignore` line, the `pages.yml` steps (2.5).
8. `models.js` (5.1) with the real graph bytes and sha256.
9. `NOTICE`: for each hosted file (both graphs, both `.th`): what it is,
   source URL, sha256, bytes, licence and where its text is
   (`LICENSE-demucs.txt` = the MIT text of the upstream `LICENSE`), the
   weights note of 1.2, and the credit for the JS port of the Demucs
   pre/post-processing (`engine/dsp.js`, `engine/segment.js`, MIT,
   Meta Platforms).
10. `README.md`: how to rerun all of it (venv command, export, parity,
    vectors, opcheck, fetch), and the numbers it gave.

### 7.2 DSP+RUNTIME

Section 3 and 5.2-5.4. Module headers with a GREP MAP and the Demucs MIT
credit (file and function that each port follows). `engine/tests.mjs`
runs in node with no browser (see 8.2). Node test of the real graph:
load `../../vendor/onnxruntime-web@1.30.0/dist/ort.min.mjs` in node, wasm
EP, `numThreads` 4, `externalData` from the local `models/*.th`. When the
`.th` is absent, print `SKIP (weights absent: node tools/stem-splitter/fetch.mjs)`
and count it as skipped, not passed.

### 7.3 UI

Section 6 and 5.5. Tests with a fake DOM (`ui/fakedom.mjs`, like
`pages/breadboard-lab/tests.mjs` and `pages/gravity-lab/tests.mjs`), a
fake engine and a fake `AudioContext`. `wav.js` and `waveform.js` peaks
are pure functions.

### 7.4 INTEGRATE

1. `index.html`: head starts with `../../lib/gpu-guard.js`,
   `../../lib/wishlist.js`, `../../lib/stats-beacon.js` in that order (copy
   from another page), then the viewport meta
   (`width=device-width, initial-scale=1.0, viewport-fit=cover`), a
   description meta, `style.css`, the classic
   `../../vendor/jszip@3.10.1/dist/jszip.min.js`, `<div id="app">`, and
   `<script type="module" src="main.js">`.
2. `main.js` (5.5). `tests.mjs`: runs `engine/tests.mjs` and
   `ui/tests.mjs`, then the page checks of 8.4.
3. Nav row in the Sound & Vibration region, group "Music", after
   `harmonywheel`: `["stem-splitter", "Stem Splitter", "NEW"]`. Then
   `node tools/nav-sync.js` and `node tools/nav-sync.js --check`.
4. Blurb in `pages/home/sectors.js` `BLURBS`, for example:
   `"stem-splitter": "Split a song into drums, bass, vocals and more with Demucs, on your device."`
5. Offline wiring of 2.5 steps 3 and 4, then `node tools/offline-manifest.mjs`.
6. Thumbnail with no browser: a node script that draws six stem waveforms
   of synth-v1 in the stem colours to a PNG (pure-JS encoder, or PPM then
   `magick`), 640 x 400, JPEG quality 82-85, then
   `node tools/thumbs-list.mjs` and `node tools/thumbs-small.mjs`.
7. Saver: 6.4.

---

## 8. Test plan and thresholds

SDR(ref, est) = `10 * log10(sum(ref^2) / sum((ref - est)^2))` over all
values given (both channels, or the sampled indices). All tests are node,
Python or Deno. **No browser, no headless Chrome, no Playwright, no CDP,
no screenshots, no `tools/saver-check.mjs`.**

### 8.1 MODEL

| check | threshold |
|---|---|
| every graph parameter is external float16, byte-equal to the state dict | 533/533 (`htdemucs`), 525/525 (`htdemucs_6s`); 0 unmapped |
| torch `Core` vs ONNX (onnxruntime CPU), segment 0 | SDR >= 70 dB for `spec_out` and `wave_out`, each model (trial: 75.3/97.1, 82.2/75.5) |
| torch `apply_model` vs numpy section-3 port + ONNX, 10 s and 30 s | SDR >= 60 dB per stem, each model |
| same, shifts 2 with fixed offsets, 10 s | SDR >= 60 dB per stem (`htdemucs`) |
| `onnx.checker.check_model` | passes |
| graph file size | <= 8 MB each |
| `opcheck.mjs` | lists every op; ops with no WebGPU kernel reported; target none except shape ops |
| `fetch.mjs --check` | exit 0; sha256 equal to 1.1 |
| `vectors.json` size | <= 1 MB |
| synth-v1 Python vs JS (`node -e` on `engine/synth.js` when it exists, else the JS in this file) | first 256 samples equal within 1e-7 |

### 8.2 DSP+RUNTIME (`node stella-nova/pages/stem-splitter/engine/tests.mjs`)

| check | threshold |
|---|---|
| FFT 4096 vs naive DFT (n = 64 and 4096 spot bins) | max abs error <= 1e-9 |
| `synthV1` head vs `vectors.synth.head` | max abs <= 1e-7 |
| `stft` / `specCac` (1 s) vs `vectors.stft` samples | SDR >= 100 dB; each `l2` within 1e-5 relative |
| `istft` vs `vectors.istft` samples | SDR >= 100 dB |
| `ispecCac(specCac(x))` round trip on synth 7.8 s | SDR >= 120 dB |
| `transitionWeight` | exact formula; sum within 1e-6 relative of the reference |
| `segmentPlan`, `paddedChunk` vs `vectors.plan` | offsets, start, trimLeft exactly equal; sum samples within 1e-6 |
| `separate` with a fake `runCore` that returns `spec_out = mag` per source and `wave_out = 0` | output = input per stem, SDR >= 100 dB (tests 3.1-3.4 glue with no model) |
| progress | `done` goes 1..total exactly once each; total = segments x max(1, shifts) |
| cancel (fake core) | after `isCancelled` turns true, at most one more `runCore` call; rejects with `cancelled` |
| real graph in node, wasm EP: `core` vs `vectors.core.htdemucs` | SDR >= 60 dB for spec and wave samples |
| real pipeline in node, synth-v1 10 s, `htdemucs` standard, vs `vectors.pipeline.htdemucs` | SDR >= 50 dB per stem |
| real pipeline, shifts 2 with the vector offsets | SDR >= 50 dB per stem |
| `htdemucs_6s` core | SDR >= 60 dB (skip if absent, reported as skip) |
| worker protocol with a fake ORT (inject via a test hook) | `init/load/separate/cancel/dispose` replies match 5.3; arrays transferred |
| `node --check` on each `engine/*.js`; ESM import of each in node | no SyntaxError, no missing export |

Run time of the real-model tests: under 60 s on this machine (2 segments x
2.4 s at 4 threads for standard; 6 more for shifts).

### 8.3 UI (`node stella-nova/pages/stem-splitter/ui/tests.mjs`)

| check | threshold |
|---|---|
| WAV header (44 bytes RIFF/WAVE/fmt/data, PCM 16, 44100, 2 ch, sizes) | byte exact |
| WAV 16-bit round trip of a sine | max abs error <= 1/32767 + 1e-9 |
| clip rescale: peak 1.5 input | output peak = 1.5 / (1.01 * 1.5) within 1e-6; peak 0.5 input unchanged |
| "No vocals" sum | equals the sum of the non-vocal stems before rescale within 1e-6 |
| zip with JSZip in node (loaded from the vendor file) | entries named `<song>_<stem>.wav`, each byte-equal to the WAV |
| gain rule truth table (mute x solo x anySolo x volume) | exact for all 16 cases + volume |
| player with a fake AudioContext | all sources started with the same `when` and `offset`; seek stops all and restarts all; position math exact |
| peaks of a known ramp | exact min/max per column |
| app with fake engine: idle -> file -> separating -> mixer; cancel; engine error; decode error; `oom` code shows the memory message | DOM states as in 6.1 |
| progress text and ETA formatting (`0:42`, `12:05`) | exact strings |
| style.css: `[hidden]` rule present; no `Playfair`, `Cormorant`, `JetBrains`; no `100vw` widths | grep |
| `node --check` and ESM import of each `ui/*.js` | no SyntaxError; ReferenceError on a browser global only at call time |

### 8.4 INTEGRATE (`node stella-nova/pages/stem-splitter/tests.mjs` plus site tools)

| check | threshold |
|---|---|
| engine and UI tests | all pass (skips listed by name) |
| `index.html` head order: gpu-guard, wishlist, stats-beacon first | exact; `node tools/wishlist-check.mjs` exit 0 |
| ESM import of `main.js` in node | only a ReferenceError on a browser global |
| `node tools/nav-sync.js --check` | exit 0, no missing blurb or thumbnail warning for this page |
| `node tools/offline-manifest.mjs --check` | exit 0; `sw-manifest.js` has no path under `stem-splitter/models/` or `stem-splitter/test/`; it has `stem-splitter/index.html` in core |
| `node tools/thumbs-list.mjs --check` | exit 0 |
| `node stella-nova/pages/home/tests.mjs` | pass |
| hidden-attribute grep (elements with `hidden` and a CSS display rule) | none without the `[hidden]` rule |

Not verifiable here (say so in each commit): any browser run, WebGPU
numerics and speed, phone memory, Safari decode formats, Cache Storage
eviction.

---

## 9. Rules for every role

- Work on main. No branch, no push, no amend, no rebase. Commit only your
  own paths: `git commit -F - -- <paths>` in one command (stage with
  `git add <paths>` in the same command). If git reports `index.lock`,
  wait a few seconds and retry; never delete the lock.
- Subject `stem-splitter: <imperative phrase>`, under 72 characters. Body
  in simple technical English: what and why, new files one per line, the
  real validation commands and their output lines, what is not verified.
  Last line: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Scratch work only in the scratchpad `demucs/` folder named above. Disk
  is about 97% full: delete big temporary files (exported float32 graphs
  are 170 MB each) and report what you leave.
- Never pkill by pattern. Never put the user's email in a request; use the
  User-Agent `davesgames.io build`.
- Test audio is synth-v1 only. No copyrighted music.
- Each module starts with a header comment and a GREP MAP, as in the
  other pages (`pages/market-forecast/worker.js`).

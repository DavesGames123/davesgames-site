# Manim live

Manim live is a browser IDE for ManimCE. You write manim code in the left
pane, and the real ManimCE 0.22.0 renders it in the right pane. The page
has 57 examples, a Learn track of twelve lessons, a live reference that
reads manim's own docstrings and source, and an "Under the hood" panel.

Page key: `manim-live`. Nav: Studio > Crafting Apps > Video & Motion.

## What runs where

| Part | Where it runs | Files |
|---|---|---|
| Editor, player, panels | Main thread | `index.html`, `main.js`, `style.css`, `ui/*.js`, `vendor-editor/` |
| Engine API | Main thread | `engine.js` (`createEngine({onStatus})`) |
| Python and manim | Web Worker | `worker.js`, `engine-core.js`, `engine-canvas.js` |
| CPython 3.14 | Worker, WebAssembly | Pyodide 314.0.7 from `cdn.jsdelivr.net/pyodide/v314.0.7/full/` |
| manim 0.22.0 | Worker | `py/wheels/manim-0.22.0-py3-none-any.whl`, unchanged PyPI wheel |
| Pure-Python dependencies | Worker | `py/wheels/*.whl`, digests in `py/wheels/LOCK.json` |
| Native stand-ins | Worker | `py/cairo`, `py/manimpango`, `py/pathops`, `py/mapbox_earcut`, `py/av`, `py/moderngl` |
| Page runtime code | Worker | `py/manimlive/` (hooks, TeX route, introspection) |
| TeX to SVG | Worker | `mathjax/` (DOM-free MathJax 3.2.2 npm components) |
| Fonts | Worker | `fonts/` (DejaVu, with its licence) |

The boot sequence is as follows:

1. The worker loads Pyodide and its numpy, scipy, Pillow, shapely and
   fontTools packages from the CDN.
2. The worker reads `py/wheels/LOCK.json`, fetches each wheel, checks the
   sha256 and unpacks the wheel into `site-packages`.
3. The worker copies the files of `py/manifest.json` into the Python path.
4. `from manim import *` runs. Your scene runs on manim's own `Scene`,
   `Camera` and `SceneFileWriter`.
5. Each frame goes to the page as an `ImageBitmap` while the scene renders.

`CONTRACT.md` has the worker protocol and the list of hooks.
`UNDER-THE-HOOD.md` has the measured difference from desktop manim. The
hood panel shows that file.

## The five replaced native modules

Manim imports libraries that are C or C++ code. WebAssembly Python cannot
load them. Each library has a small Python module with the same API in
`py/`. Manim's own code calls the module and does not know the difference.

| Module | Real library | Why it is replaced | What the stand-in does |
|---|---|---|---|
| `cairo` | pycairo (Cairo) | Pyodide has no build of pycairo. | Records the draw calls of manim's Camera. Draws them on an OffscreenCanvas in one JavaScript call per frame. Writes the pixels back into `Camera.pixel_array`. |
| `manimpango` | ManimPango (Pango, HarfBuzz) | Pango is native C code. | Lays out text with fontTools and the DejaVu fonts. Writes the SVG that manim's `Text`, `MarkupText` and `Code` parse. |
| `pathops` | skia-pathops (Skia) | Skia is native C++ code. | Does `Union`, `Intersection`, `Difference` and `Exclusion` with shapely. |
| `mapbox_earcut` | mapbox-earcut (C++) | It is a native extension. | The earcut triangulation in Python. Only the OpenGL renderer calls it. |
| `av` | PyAV (FFmpeg) | FFmpeg is native C code. | Writes nothing. The page gets frames from `SceneFileWriter` and records video with MediaRecorder. |

Two more items are not in the five:

- `moderngl` is an import-only stand-in. `from manim import *` imports it,
  and the page uses the Cairo renderer, not OpenGL.
- TeX: manim calls one function, `tex_to_svg_file`, to make SVG from TeX.
  `py/manimlive/tex.py` sends that TeX to MathJax instead of `latex` and
  `dvisvgm`. `SVGMobject`, `MathTex` and `Tex` are manim's own code.

ManimGL (3b1b) is not on this page. ManimGL needs OpenGL.

## Tests and the Node harness

The Node harness runs the same `engine-core.js` and `py/` files as the
browser. Pyodide and the canvas come from npm packages in a cache folder
outside the repository.

To make the cache folder, run these commands once:

```sh
export MANIM_LIVE_CACHE=/path/to/manim-cache
mkdir -p "$MANIM_LIVE_CACHE" && cd "$MANIM_LIVE_CACHE"
npm init -y && npm install pyodide@314.0.7 @napi-rs/canvas
```

To run all the tests, run this command in the page folder:

```sh
MANIM_LIVE_CACHE=/path/to/manim-cache node --test tests/*.test.mjs
```

The tests are:

- `tests/engine.test.mjs`: wheel digests, the RECORD of the installed
  manim, the stand-ins, seed renders, a pixel compare with native manim,
  TeX parts, speed, the 640x360 phone quality and the worker protocol.
  Without `MANIM_LIVE_CACHE`, 9 of the 13 tests are skipped.
- `tests/lessons.test.mjs`: the shape of `lessons/index.js`, and a Python
  `ast` parse of each step.
- `tests/ui.test.mjs`: timeline, share links, catalog filter, Markdown,
  docstrings, source parse, step checks, highlight and the hood table.
- `tests/device.test.mjs`: the quality default, the frame cache size and
  the download advice per device, and one quality table in Python,
  `main.js`, `engine.js` and `index.html`.
- `tests/mobile.test.mjs`: the phone view after a run, the key row
  edits, the soft keyboard inset, the share-sheet choice, and the phone
  rules in `style.css` and `index.html` (one view at a time, 16 px
  fields, 44 px targets, 100dvh, safe-area insets).

To render one file and write PNG frames, run:

```sh
node tools/render.mjs examples/calculus-riemann-sums.py --quality low --frames 0,last --out /tmp/out
```

Other tools in `tools/`:

| Tool | What it does |
|---|---|
| `build-catalog.mjs` | Writes `examples/catalog.js` from the example headers. `--check` validates only. |
| `py-manifest.mjs` | Writes `py/manifest.json` from the files under `py/`. |
| `lock-wheels.py` | Checks `py/wheels/*.whl` against the PyPI digests and writes `LOCK.json`. |
| `reference-native.py`, `reference-compare.mjs` | Render the reference scenes with desktop manim and compare the frames. |

## Examples and lessons

Each example is `examples/<domain>-<slug>.py` with a header of `title`,
`topic`, `level`, `scene`, `summary` and `concepts`. The topics are in
`examples/TOPICS.md`. After you add or change an example, run
`node tools/build-catalog.mjs` and commit `examples/catalog.js`.

The Learn track is `lessons/index.js`. Each step has Markdown, a complete
program, the scene name, a task, a hint and a check.

## Known gaps

- No browser run was done. Headless Chrome is not permitted on this
  machine. The worker, the CDN import, OffscreenCanvas bitmaps, the
  layout, the phone dock and video export are checked only in Node
  (jsdom, worker_threads and @napi-rs/canvas).
- No phone run was done. The key row focus, the iOS keyboard inset, the
  full screen fallback and the share sheet are not checked on a device.
- Phones and devices with 4 GB or less get the 640x360 quality and a
  frame cache of 256 MB (128 MB at 2 GB). The memory of Pyodide in the
  worker is not measured on a phone. WebAssembly memory does not shrink
  after a large render.
- The site sends no COOP and COEP headers, so `crossOriginIsolated` is
  false. Stop then terminates the worker, and Python boots again, which
  takes some seconds.
- The first load downloads about 30 MB of Pyodide packages and 3.3 MB of
  wheels. Load time in a browser is not measured.
- TeX supports only what MathJax supports: no `\usepackage` effects and
  no TikZ. The glyphs are MathJax fonts, not Computer Modern. A `MathTex`
  part that splits a `\frac` or a `\sqrt` across strings renders empty.
  Use `substrings_to_isolate` on one string instead.
- Text uses only the bundled DejaVu fonts. The stand-in has no complex
  scripts, no mark positioning and no font fallback.
- Boolean results from `pathops` are polylines, not curves, and use the
  even-odd fill rule.
- No audio. `add_sound` with a file that is not WAV raises an error.
  `config.renderer = "opengl"` and `embed()` are not supported.
- Pixel compares with native manim were done with Skia in Node. Safari
  and other browser canvases can differ more at anti-aliased edges.
- The `animation` event arrives when each `play()` ends. Completion and
  hover wait behind a render, then use the cached name list.
- The page has no screensaver hook (`saver.js`).

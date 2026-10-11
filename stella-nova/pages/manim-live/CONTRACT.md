# manim-live engine contract

This file is the contract between the engine (engine.js, worker.js,
engine-core.js, engine-canvas.js, py/) and the IDE (main.js, ui/). It also
records which parts of ManimCE 0.22.0 need native code, and what replaces
each part.

## 1. What runs

* **ManimCE 0.22.0**, the wheel `manim-0.22.0-py3-none-any.whl` from PyPI,
  sha256 `bce56dbe420ce002cb77076c0b4e041637a0bd41ce5749e837e96375937e935f`
  (the digest that `https://pypi.org/pypi/manim/0.22.0/json` publishes). The
  engine checks the digest, then unpacks the wheel into Pyodide's
  site-packages. No file of the wheel is changed.
* **Pyodide 314.0.7** (Python 3.14.2, wasm32) from
  `https://cdn.jsdelivr.net/pyodide/v314.0.7/full/` in a module Web Worker.
* Packages from the Pyodide distribution: numpy, scipy, pillow, shapely,
  fonttools, pygments, rich, tqdm, decorator, typing-extensions,
  beautifulsoup4, audioop-lts, jedi (list: `grep -n PYODIDE_PACKAGES engine-core.js`).
* Pure-Python wheels from PyPI in `py/wheels/` (pinned in `py/wheels/LOCK.json`,
  regenerate with `python3 tools/lock-wheels.py`): click 8.5.0, cloup 4.0.0,
  networkx 3.7, svgelements 1.9.6, isosurfaces 0.1.2, screeninfo 0.8.1,
  watchdog 6.0.0, pydub 0.25.1, and srt 3.5.3 (built from the PyPI sdist,
  PyPI has no wheel). click and networkx are not the Pyodide builds: cloup 4
  needs click >= 8.5 (Pyodide has 8.3.1), and the Pyodide networkx build
  pulls in matplotlib.

## 2. Native imports of `from manim import *` (manim 0.22.0)

Found by reading the unpacked wheel (`grep -rnE "^\s*(import|from) (cairo|manimpango|pathops|mapbox_earcut|av|moderngl)" manim/`).
With the replacements below, `from manim import *` imports in Pyodide.

| Import (file in manim/) | Native code | Used by the Cairo path? | Replacement |
|---|---|---|---|
| `import cairo` (camera/camera.py, camera/moving_camera.py) | pycairo (C) | yes: every VMobject frame | `py/cairo/` canvas backend |
| `import manimpango`, `from manimpango import MarkupUtils, PangoUtils, TextSetting` (mobject/text/text_mobject.py) | Pango, cairo, fontconfig (Cython) | yes: Text, MarkupText, Paragraph, Code | `py/manimpango/` fontTools layout |
| `from pathops import Path, PathVerb, difference, intersection, union, xor` (mobject/geometry/boolean_ops.py) | Skia (Cython) | yes: Union, Intersection, Difference, Exclusion | `py/pathops/` shapely (GEOS) |
| `from mapbox_earcut import triangulate_float32` (utils/space_ops.py) | earcut.hpp (pybind11) | no (OpenGL renderer only) | `py/mapbox_earcut/` pure-Python earcut |
| `import av` (scene/scene_file_writer.py, scene/video_segment_encoder.py, _config/video_encoder.py, utils/commands.py) | FFmpeg (Cython) | no with `format="none"` | `py/av/` import stand-in |
| `import moderngl`, `from moderngl import Framebuffer` (mobject/opengl/*.py, renderer/opengl_renderer.py, renderer/shader*.py) | OpenGL (C) | no (constants as default arguments only) | `py/moderngl/` import stand-in |
| latex + dvisvgm via `subprocess` (utils/tex_file_writing.py) | TeX distribution | yes: MathTex, Tex, numbers on axes | `py/manimlive/tex.py` with MathJax 3.2.2 |

Lazy or guarded imports that never run here: `moderngl_window`, `pyglet`
(renderer/opengl_renderer_window.py, only for the OpenGL window),
`dearpygui` (try/except in scene/scene.py), `IPython` (try/except),
`typst` (only for Typst mobjects).

## 3. pycairo calls of the Cairo renderer path

From manim/camera/camera.py (the only manim file that draws with cairo):

* `cairo.ImageSurface.create_for_data(pixel_array.data, cairo.FORMAT_ARGB32, pw, ph)`
* `cairo.Context(surface)`, `ctx.scale(pw, ph)`, `ctx.set_matrix(cairo.Matrix(xx, yx, xy, yy, x0, y0))`
* `ctx.new_path()`, `ctx.new_sub_path()`, `ctx.move_to(x, y)`, `ctx.curve_to(x1, y1, x2, y2, x3, y3)`, `ctx.close_path()`
* `ctx.set_source_rgba(b, g, r, a)` (manim passes the channels reversed)
* `cairo.LinearGradient(x0, y0, x1, y1)`, `pat.add_color_stop_rgba(offset, b, g, r, a)`, `ctx.set_source(pat)`
* `ctx.fill_preserve()`, `ctx.stroke_preserve()`
* `ctx.set_line_width(w)`, `ctx.set_line_join(cairo.LineJoin.*)`, `ctx.set_line_cap(cairo.LineCap.*)`

`py/cairo/` implements these and more of the pycairo API (the list is in
its docstring). It records the calls as numbers and runs them in ONE
JavaScript call (`engine-canvas.js`, `cairoFlush`) when
`Camera.display_multiple_non_background_colored_vmobjects` returns.

## 4. ManimPango calls

* `manimpango.text2svg(settings, size, line_spacing, disable_liga, file_name, START_X, START_Y, width, height, text)` (Text)
* `manimpango.MarkupUtils.text2svg(text, font, slant, weight, size, _, disable_liga, file_name, START_X, START_Y, width, height, justify=, pango_width=)` (MarkupText)
* `manimpango.MarkupUtils.validate(markup)`, `manimpango.PangoUtils.remove_last_M(file)`
* `manimpango.list_fonts()`, `manimpango.register_font(path)`, `manimpango.unregister_font(path)`
* `manimpango.TextSetting(start, end, font, slant, weight, line_num, color)`

## 5. Observers on real manim (manimlive/runtime.py, `install_hooks`)

Each observer calls the original function with the same arguments and
returns its result. None of them changes what manim computes.

| Function | Observer does |
|---|---|
| `Scene.play` | reads the user-code line from the stack, counts frames, emits `animation` after the call (nested calls, such as `wait` -> `play`, emit once) |
| `Camera.display_multiple_non_background_colored_vmobjects` | `cairo.sync_all()` after the call |
| `SceneFileWriter.write_frame` | emits the frame (`frame` event), then calls the original |
| `manim.utils.tex_file_writing.tex_to_svg_file` and the same name in `manim.mobject.text.tex_mobject` | REPLACED by `manimlive.tex.tex_to_svg_file` (MathJax instead of latex + dvisvgm) |

Config of each run (`manim.tempconfig`): `format="none"`, `disable_caching=True`,
`progress_bar="none"`, `renderer="cairo"`, `media_dir="/tmp/manim-media"`,
quality and fps from the run options.

## 6. Worker protocol (engine.js)

```js
import { createEngine } from './engine.js';
const engine = createEngine({ onStatus });   // onStatus({stage, detail})
const info = await engine.ready;             // facts, see below
const h = engine.run(code, { scene, quality: 'low'|'medium'|'high', fps, transparent });
h.on('scenes', (names) => {});               // Scene subclasses in the code
h.on('animation', (a) => {});                // {index, name, line, runTime, startFrame, endFrame}
h.on('frame', (f) => {});                    // {index, t, bitmap: ImageBitmap, repeat, width, height}
h.on('log', (l) => {});                      // {stream: 'stdout'|'stderr', text}
h.on('error', (e) => {});                    // {type, message, traceback, line}
h.on('done', (d) => {});                     // {frames, duration, width, height, fps}
h.done;                                      // Promise -> summary
engine.cancel();                             // stop the current run
await engine.introspect('Circle');           // {kind, name, module, signature, doc, members, bases, file, line}
await engine.source('Circle.__init__');      // {file, line, text}
await engine.complete(code, line, col);      // [{name, kind, signature}]  line 1-based, col 0-based
```

* quality: low = 854x480 at 15 fps, medium = 1280x720 at 30 fps,
  high = 1920x1080 at 60 fps. `fps` overrides the frame rate.
* `frame` events come while the scene renders (streaming). A held frame
  (for example `self.wait(1)`) is ONE bitmap that manim writes with
  `repeat = n`. The engine emits n `frame` events with consecutive
  `index` values and the same `bitmap` object; `repeat` is set on each.
* `animation.line` is the line of the `self.play(...)` / `self.wait(...)`
  call in the user code (the innermost frame of the user file on the
  stack). `startFrame` is inclusive, `endFrame` exclusive.
* With no `scene` option the LAST Scene subclass in the code runs.
* A scene without `play`/`wait` gives one frame (the final image).
* `error.line` is the user-code line (from the traceback, or the line of
  a SyntaxError). `error.type` is `KeyboardInterrupt` after `cancel()`.
* `done` comes only after a run without error. `h.done` resolves in both
  cases, with `{ok, ...}`.
* `introspect`, `source` and `complete` wait while a run is in progress
  (the worker runs one request at a time).
* cancel(): when `crossOriginIsolated` is true, the engine writes SIGINT to
  the Pyodide interrupt buffer and Python stops at the next bytecode
  boundary (the interpreter stays warm). When it is false, the engine
  terminates the worker and starts a new one (the next run boots again).
* Names for introspect/source: `Circle`, `manim.Circle`, `Mobject.shift`,
  `manim.mobject.geometry.arc`, and the shim modules `cairo`,
  `manimpango`, `pathops`, `mapbox_earcut`, `av`, `moderngl`, `manimlive.tex`.
  `file` is relative to site-packages for manim (`manim/mobject/geometry/arc.py`)
  and `py/<module>/...` for the shims.

`engine.ready` resolves to:

```js
{ manimVersion, manimFile, distVersion, python, pyodide, sitePackages,
  importSeconds, bootSeconds, shims: {cairo: path, ...}, tex,
  wheels: [{name, version, file, sha256, pypiSha256}], pyFiles }
```

## 7. Files

| File | Is |
|---|---|
| engine.js | main-thread API above; owns the worker |
| worker.js | module worker: Pyodide host for the browser |
| engine-core.js | boot + Python bridge, shared by worker.js and tools/node-env.mjs |
| engine-canvas.js | JS half of the cairo shim (`cairoFlush`) |
| py/cairo, py/manimpango, py/pathops, py/mapbox_earcut, py/av, py/moderngl | the replacements in section 2 |
| py/manimlive | runtime (run, hooks), tex (MathJax bridge), introspect |
| py/manifest.json | files copied into Pyodide (`node tools/py-manifest.mjs`) |
| py/wheels | pinned wheels + LOCK.json (`python3 tools/lock-wheels.py`) |
| mathjax/ | MathJax 3.2.2 components that run without a DOM (startup, core, liteDOM, tex-full, svg, svg font), unmodified from the npm package `mathjax@3.2.2` |
| fonts/ | DejaVu Sans, Serif, Sans Mono (TTF) + LICENSE-DejaVu.txt |
| tools/node-env.mjs, tools/render.mjs | the same engine in Node, for tests and PNG checks |
| tools/build-catalog.mjs | examples/*.py headers -> examples/catalog.js |
| tests/engine.test.mjs | engine checks (node) |

## 8. Example files

`examples/<domain>-<slug>.py`, plain manim code with a header:

```
# title: Riemann sums
# topic: Calculus            (one of examples/TOPICS.md)
# level: 1|2|3
# scene: RiemannSums
# summary: one plain sentence
# concepts: Axes, get_riemann_rectangles, ValueTracker, always_redraw
```

`node tools/build-catalog.mjs` writes `examples/catalog.js`
(`export const CATALOG = [...]`) and fails on a header error.

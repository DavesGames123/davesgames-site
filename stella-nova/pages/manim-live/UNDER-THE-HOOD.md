# Under the hood

## What runs when you press Run

1. Your browser starts **Pyodide 314.0.7**: CPython 3.14 compiled to WebAssembly, in a Web Worker so the page stays responsive.
2. The worker downloads **manim 0.22.0** as the wheel `manim-0.22.0-py3-none-any.whl` from PyPI, checks its SHA-256 (`bce56dbe…937e935f`, the digest PyPI publishes) and unpacks it into Python's `site-packages`. No file of manim is edited.
3. numpy, scipy, Pillow, shapely and fontTools come from the Pyodide distribution. The pure-Python dependencies of manim (cloup, click, networkx, svgelements, isosurfaces, watchdog, srt, pydub, screeninfo) come from PyPI wheels with pinned digests.
4. Your code runs with `from manim import *` exactly as on a desktop. Manim's own `Scene`, `Camera`, `Mobject`, animations, rate functions, updaters and `SceneFileWriter` produce every frame.
5. Each frame goes to the page while the scene still renders, so playback starts before the scene ends.

Open **Reference** and ask for any class or function: the page shows its real docstring and its real source, read with `inspect.getsource` from the installed package.

## The parts that cannot run in a browser

Manim calls a few libraries written in C or C++. WebAssembly Python cannot load them. Each one is replaced by a small Python module with the same API, so manim's own code calls it without knowing. Press **Source** next to a module to read it.

| Module | Real library | Replacement |
|---|---|---|
| `cairo` | pycairo (the Cairo C library) | Records manim's drawing calls (paths, colours, gradients, line widths) as a list of numbers and draws the whole list in one call per frame on a 2D canvas. The pixels go back into manim's own `Camera.pixel_array`. |
| `manimpango` | ManimPango (Pango, HarfBuzz, fontconfig) | Lays out the text with fontTools (character map, ligatures, kerning) from the bundled DejaVu fonts and writes the same SVG file that Pango writes. Manim's real `Text`, `MarkupText` and `Code` read that file. |
| `pathops` | skia-pathops (Skia) | `Union`, `Intersection`, `Difference` and `Exclusion` go through shapely (GEOS). |
| `mapbox_earcut` | mapbox-earcut (C++) | The earcut triangulation in Python. Only manim's OpenGL renderer uses it. |
| `av` | PyAV (FFmpeg) | Nothing to encode: manim renders with `format="none"`, and the page receives the frames from manim's `SceneFileWriter`. The page records video in the browser. |

`moderngl` (OpenGL) is not replaced: a stand-in module gives only the few constants that manim reads when it imports. The page uses manim's Cairo renderer, as `manim render` does by default.

## TeX without LaTeX

A browser has no TeX installation. Manim turns TeX into SVG with ONE function, `tex_to_svg_file`. On this page that one function sends your TeX to **MathJax 3.2.2** instead of `latex` + `dvisvgm`. The SVG gets the units of `dvisvgm` (10 pt per em), and manim's group markers become SVG groups, so `MathTex` parts, `tex_to_color_map`, `get_part_by_tex`, `TransformMatchingTex` and `font_size` work as usual. Everything after that function (`SVGMobject`, `MathTex`, `Tex`) is manim's own code.

Limits: only the TeX that MathJax knows (amsmath and most common packages, no TikZ, no `\usepackage` effects); the glyphs are MathJax's TeX fonts, which are Computer Modern shapes like LaTeX's but not the same outline files.

## How close is it to desktop manim?

The same scenes were rendered by native manim 0.22.0 on macOS (real pycairo 1.29 on cairo 1.18, real Pango 1.57, same DejaVu fonts) and by this engine in Node with a Skia canvas. Mean absolute difference per channel, on a 0–255 scale:

| Frame | Red | Green | Blue | Pixels off by more than 32 |
|---|---|---|---|---|
| Circle being drawn | 0.006 | 0.013 | 0.015 | 0.01 % |
| Circle → square | 0.017 | 0.017 | 0.019 | 0.00 % |
| Square, end | 0.020 | 0.008 | 0.007 | 0.00 % |
| Text being written | 0.037 | 0.037 | 0.037 | 0.02 % |
| Text + MarkupText | 0.046 | 0.045 | 0.042 | 0.03 % |
| NumberPlane, bent | 0.257 | 0.720 | 0.831 | 0.42 % |
| 3D surface | 0.358 | 0.227 | 0.197 | 0.02 % |
| Union / Difference / Intersection | 0.020 | 0.067 | 0.013 | 0.00 % |
| Gradient, dashes, arrow, dots | 0.059 | 0.052 | 0.031 | 0.08 % |

The differences are anti-aliasing at the edges of thin lines (Cairo and the browser's canvas smooth edges a little differently). The test `tests/engine.test.mjs` repeats this comparison and fails if any frame goes above 1.5 per channel or 1 % of pixels. Your browser's canvas is not the Skia build used in that test, so expect the same order of difference, not the same numbers.

## Known differences

- Text shaping covers Latin, Greek and Cyrillic well. There is no complex-script shaping (Arabic, Indic), no combining-mark positioning and no font fallback: a character that the DejaVu fonts lack shows as an empty box.
- Pango markup: `b`, `i`, `u`, `s`, `tt`, `big`, `small`, `sub`, `sup` and `span` with font, size, weight, style, colour, alpha, underline, strikethrough, rise and letter spacing. Background colours and the rarer Pango attributes are ignored.
- Boolean operations return straight-line outlines (curves flattened finely), where Skia keeps curves.
- No sound and no video files inside Python: the page does not play or save sound, and `add_sound` with a file that is not WAV stops with an error (it needs FFmpeg).
- `config.renderer = "opengl"` and interactive `embed()` do not work.

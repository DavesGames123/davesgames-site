# Stereogram pages contract

Binding spec for two pages and the agents that build them. Read all of
it first, then `stella-nova/PAGES.md` "How to add a page".

## What the user asked for (verbatim, 2026-10-24)

> i want another two pages, one to create stereograms, and one to
> explain the work of dr. tyler and how the stereogram came to be. i
> want plenty of examples with real 3d objects

> plenty of patterns as well, you can probably steal from the pattern
> designer on davesgames

## Pages

| Key / folder | Label | Owner |
|---|---|---|
| `stereogram-maker` | Stereogram Maker | ENGINE (engine/, models/), MAKER (the rest) |
| `stereogram-history` | How the Stereogram Came to Be | HISTORY |

The coordinator registers nav, saver catalog, home blurb and thumbnails.
Nobody else edits `lib/nav-data.js`, `lib/screensaver-catalog.js`,
`pages/home/**`, `PAGES.md`, or other pages' files. Import read-only
from `../pattern-designer/` (its pattern engine is ours to reuse) and
from `lib/` (`glb-lite.js`, `sci.css`, `sci-math.js`, `saver-clear.js`).

## Shared engine (ENGINE owns `stereogram-maker/engine/**`)

DOM-free where possible, used by both pages. `engine/index.js` header
documents:

- `depthFromMesh(mesh, { w, h, yaw, pitch, roll, fov, near, far, fit })`
  → Float32Array depth (0 far .. 1 near) rendered on the CPU (z-buffer
  rasteriser), plus an optional WebGL2 fast path. Works in a worker.
- `depthFromText`, `depthFromImage` (an uploaded grey map), and
  `depthFromSDF` for a few analytic shapes (sphere, torus, steps).
- `sirds(depth, opts)` and `autostereogram(depth, tile, opts)`: the
  constraint algorithm with hidden-surface removal after Thimbleby,
  Inglis and Witten (1994), our own code. Options: eye separation, DPI,
  depth range (mu), wall-eyed or cross-eyed, oversampling, guide dots,
  a random-dot, coloured-dot or texture (tile) source.
- `tilesFromPatterns(ids, size, seed)`: draws seamless tiles from the
  pattern-designer engine (look at `../pattern-designer/engine.js`,
  `patterns/`, `palettes.js`, `export.js drawItems`). Check that a tile
  wraps without a seam; if a pattern does not wrap, crop it to a
  repeat or mirror it and say so. At least 40 pattern tiles over many
  families, plus random dots and noise.
- `wheatstonePair(depth, texture)`, `anaglyph(...)` and
  `randomDotStereogram(depth)` (the Julesz two-image form) for HISTORY.
- `animate(frames)`: an animated stereogram (a turning model) with a
  stable tile so the eye can hold the fusion.
- Tests: `engine/tests.mjs` (depth raster against closed forms, the
  constraint algorithm gives equal colours for linked pixels, tiles
  wrap, worker message shape).

## Real 3D objects (ENGINE owns `stereogram-maker/models/**`)

"Real 3D objects" means scans and models of real things, not
procedural blobs. Sources, in order: Smithsonian Open Access 3D (CC0),
Poly Haven models (CC0), the Khronos glTF sample models (each model's
own licence), the site's own assets (`stella-nova/assets/nature`, the
coral fauna, human-skull BodyParts3D CC BY-SA 4.0). The Stanford 3D
Scanning Repository models (bunny, dragon, Buddha) are allowed only if
its terms permit redistribution on this site; check and quote them in
CREDITS.md, else leave them out. No ossicles (NC licence).

- At least 24 objects across kinds: statues and busts, skulls and
  fossils, animals, tools and machines, food, plants, historical
  artefacts, a famous test model or two.
- Decimate to depth-map needs (20k-60k triangles), position + index
  only, as GLB with no textures (a depth map needs no texture). Keep
  the whole models folder under 25 MB. A build script in
  `models/build/` (not shipped to pages) records each source URL,
  licence and the decimation.
- `models/index.js`: `MODELS = [{ id, name, kind, file, credit,
  licence, url, view: { yaw, pitch } }]` and `loadModel(id)`.
- `stereogram-maker/CREDITS.md` lists every model and licence.
- Downloads go to the session scratchpad; delete raw downloads after
  the build. The disk filled once today: check `df -h /` before large
  downloads and keep scratch under 2 GB.

## MAKER (`stereogram-maker/` except engine/ and models/)

A creation tool, phone first (wave-membrane dock + sheet pattern):
- Source: a 3D model (library picker with thumbnails of the depth
  maps, drag to turn, depth range), text, an uploaded depth map, an
  uploaded photo through a simple luminance-to-depth, or a shape.
- Pattern: the pattern-tile gallery (pattern-designer families,
  palettes, density), random dots, coloured dots, your own image.
- Settings: wall-eyed / cross-eyed, eye separation, depth, size and
  aspect, guide dots, animate (turntable).
- "How to see it" help with a practice image; a reveal toggle that
  shows the depth map; download PNG; share link (lib/share-url.js if
  it fits).
- A gallery of ready examples (model + pattern pairs) at load.
- Heavy work in a module worker; the UI never blocks.
- `window.snSaver`: turntable stereograms of the models, cut every
  5-12 s, plateBand framing at 16:9 and 9:16.
- Tests: `tests.mjs` runs engine tests and its own, links main.js in
  node, checks ids, head order, `[hidden]` guard.

## HISTORY (`stereogram-history/**`)

An explainer of how the stereogram came to be and of Christopher W.
Tyler's work, in the house style of the site's paper explainers
(pages/dark-matter-halo, pages/circular-rydberg): long scroll, a live
figure per chapter, MathJax SVG via lib/sci-math.js, STIX Two Text and
Inter from lib/sci.css. Research every fact from primary or reliable
sources, with a sources list; mark unsure dates. Suggested arc
(verify each point; drop what you cannot source):
1. Binocular disparity and depth: why two eyes see depth (live
   figure: two eyes, a point, the disparity angle).
2. Wheatstone's mirror stereoscope (1838) and Brewster's lens
   stereoscope; Brewster's note on the "wallpaper effect".
3. Julesz's random-dot stereogram at Bell Labs (1959-60): depth with
   no monocular cue; cyclopean perception (live two-image RDS of a
   real model, free-fuse or anaglyph).
4. Tyler and Clarke's single-image random-dot stereogram, "The
   autostereogram" (1979): the idea that one image can hold both
   views (live figure: how the repeat period encodes depth).
5. Tyler's wider vision-science work (Smith-Kettlewell; stereo
   sensitivity, cyclopean vision) as far as sources state it.
6. From research to popular culture: the 1990s posters and books,
   named only as fact (Magic Eye is a trademark of its owner; no
   logo, no imitation, no copied images).
7. How the algorithm works today (Thimbleby, Inglis and Witten 1994),
   with live examples on real 3D objects, linking to the maker.
Plenty of live examples with real 3D objects throughout (import the
engine and models from `../stereogram-maker/`). Images of people or
historical apparatus only if public domain or CC (credited, per the
real-human-artwork rule); otherwise no portrait. Name organisations
and the public record of a researcher's published work; no private
details. `window.snSaver` over the figures. `tests.mjs` as above.

## Look and validation

Sentence-case labels, no uppercase letter-spaced HUD text, no
Playfair, Cormorant or JetBrains Mono, never KaTeX. Head load order
gpu-guard, wishlist, stats-beacon. `[hidden]{display:none!important}`.
No headless Chrome, Playwright, CDP or screenshots. Validate with node
tests, `node --check`, node ESM import of main.js (only a browser
ReferenceError is fine), jsdom boot with `jsdom@24.1.3` installed in
the scratchpad on NODE_PATH. To look at a stereogram or a depth map,
write a small PNG to the scratchpad from node, Read it, then delete it.

## Commits

Branch main. Stage and commit by pathspec in one Bash command; before
it, check `git diff --cached --name-only` holds only your paths. No
`add -A`, amend, rebase, stash or push. Subject `stereogram-maker: ...`
or `stereogram-history: ...` under 72 characters, ASD-STE100 body with
real validation output and "No browser ran.", ending with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit the
engine API header early. Requests between agents go in
`stereogram-maker/NOTES.md` as dated lines.

# Stella Nova page layout

The shell `stella-nova/index.html` is an index plus an iframe. Each nav item
loads one page into the iframe. Every page lives in its own folder here under
`pages/<name>/`. The shell `PAGES` map holds the route: a tab id maps to
`pages/<name>/index.html`.

## The pad — one folder per page

Every page folder holds the same kinds of file. A page uses only the ones it
needs.

    pages/<name>/
      index.html    the page shell: head, body markup, external references
      style.css     the single stylesheet, one file
      main.js       the main script
      <role>.js     one file per extra script, in load order
      shaders/      GPU shader source, one file per program (only if the page uses GPU)

## What goes where

- `index.html` holds the `<head>` and the body markup. It links `style.css`
  and references each script with `<script src>`. It keeps inline only three
  things: an importmap, a CDN `<script src="https://...">`, and a micro-guard
  that must run before the body renders.
- `style.css` holds the page stylesheet, byte-for-byte from the original.
- Script files hold the page logic. The main script is `main.js`. An extra
  script keeps a role name, for example `equations.js` for a KaTeX helper. The
  load order in `index.html` matches the original, so classic scripts keep
  their shared global scope.
- `shaders/` holds one file per shader program. GLSL uses `.vert.glsl` and
  `.frag.glsl`. WebGPU uses `.wgsl`.

## How shaders load

A page keeps its shader source in `shaders/` and fetches it at run time. The
shared loader is `../../lib/shaders.js`.

- A module page imports the loader and awaits it before it builds a material:

      import { loadShaders } from '../../lib/shaders.js';
      const SH = await loadShaders(import.meta.url, ['shaders/a.frag.glsl', ...]);
      const frag = SH['shaders/a.frag.glsl'];

- A classic page fetches inside an existing async scope, and keeps every
  function that an inline `onclick` calls on `window`:

      X = await (await fetch(new URL('shaders/a.wgsl', document.baseURI))).text();

## The one exception

`material-lab` keeps its two GLSL programs inside DOM
`<script type="x-shader">` blocks, not in `shaders/` files. The page reads them
with `getElementById().textContent` during a synchronous WebGL init. Moving
them to fetched files forces that init to run async, and a render queued before
init then runs with no linked program and throws. The `<script>` block is still
a separated, named location, so the page stays a 1:1 copy.

The shell route `matlab` ("PBR Material Studio") now loads `material-studio`.
`material-lab` stays on disk with no nav route. Its Python server API is the
optional "Image to PBR (server)" import of the studio.

## Page notes: material-studio

`material-studio` is a WebGPU node graph for PBR materials. The graph bakes
texture maps, a 3D viewport shows them under HDRI light, and the export
packs them for Unity, Unreal, Godot, glTF and PNG. It is an ES module page
with no build step, and it has two named deviations from the pad.

- **Stylesheet partials.** `style.css` holds the page tokens and the layout,
  then `@import`s one partial per module from `styles/` (`editor.css`,
  `viewport.css`, `panels.css`, `io.css`, `mobile.css`). One owner edits each
  partial. A partial that overrides `style.css` starts its selectors with
  `html ` so that it wins at equal specificity.
- **Many module files.** `main.js` boots the page. It imports each module
  below with its own try/catch and calls `init(ctx)` in order. A module that
  fails shows a toast, and the page continues.

Module map (`grep -n` the name in `main.js` MODULES for the init order):

    contract.js      port types, Graph JSON, MaterialMaps, events, export targets
    store.js         the app state, the event bus, undo and redo
    gpu.js           the shared GPUDevice, canvas setup, pagehide teardown
    main.js          boot, page chrome, window.__studio and __studio.selfTest()
    nodes/core.js    175 core NodeDefs (noise, patterns, filters, math, output)
    nodes/bench.js   the Composition Bench cells as pass nodes, bench graph import
    graph.js         the pure graph model and the undoable graph actions
    editor.js        the canvas node editor in #graph-wrap
    compile.js       graph -> fused WGSL passes
    bake.js          runs the passes, caches them, makes the maps and thumbnails
    env.js           HDRI presets, .hdr load, IBL precompute, analytic lights
    viewport.js      the PBR viewport; mesh.js meshes, camera.js orbit camera
    export.js        engine packages; zip.js, glb.js writers; import.js map import
    panels.js        inspector, library, map strip, topbar; presets.js materials
    mobile.js        phone sheet, landscape drawer, tablet layout
    shaders/         bake-*, viewport-*, env-*, pbr.wgsl, panels-thumb.wgsl

The shared bench catalog is `../../lib/bench-wgsl.js`. Composition Bench
uses the same file, so a change there must pass the bench self-test for each
library. For a headless check, load `material-studio/index.html` and call
`await __studio.selfTest()`. The result has `ok` and one summary row for each
module.

## To add a page

1. Make `pages/<name>/` with `index.html`, `style.css`, and `main.js`.
2. Put any shader source in `pages/<name>/shaders/`.
3. Add a nav item and a `PAGES`/`LABELS` entry to `stella-nova/index.html`,
   with the route `pages/<name>/index.html`.

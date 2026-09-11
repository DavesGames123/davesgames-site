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

## To add a page

1. Make `pages/<name>/` with `index.html`, `style.css`, and `main.js`.
2. Put any shader source in `pages/<name>/shaders/`.
3. Add a nav item and a `PAGES`/`LABELS` entry to `stella-nova/index.html`,
   with the route `pages/<name>/index.html`.

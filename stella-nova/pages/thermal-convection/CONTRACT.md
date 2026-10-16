# Thermal Convection — build contract

Page key `thermal-convection`, dir `stella-nova/pages/thermal-convection/`,
label "Thermal Convection", badge SIM, nav group Fluids > Flow. A live 3D
Boussinesq Navier–Stokes simulation of a fluid layer heated from below.
The page shows two linked views of ONE 3D field: the top surface seen from
above (the cellular, Voronoi-like pattern of convection cells, the same
look as solar granulation), and a 2D vertical cross-section of the fluid
under a slice line drawn on that surface. A screensaver goes with it.
This file fixes the module map, the interfaces and the work packages, so
separate agents can build packages at the same time without editing the
same files.

User request, verbatim (2026-10-16): "create a page about thermal
convection. i saw an instagram reel demonstrating how thermal convection
works in a bowl of soup and shows the navier stokes equation forit. it
looks an awful lot like the bubbling voronoi surface of a hot plasma like
the sun. i love to see both a cross section of the top of the surface, and
the underlying section of the fluid dynamics in 2d underneath the slice. i
would love to dispatch a swarm and make a sweet screensaver page to go
with it. it does not have to be soup specific, just represnt the
temperature gradients"

## Rules for every package

- Read the project memory index first:
  `~/.claude/projects/-Users-davidkubala-Downloads-davesgames-site/memory/MEMORY.md`
  (relevant: no-headless-chrome, static-site-build-gate, mobile-first-pages,
  hidden-attr-display, wgsl-tint-vs-naga, wgsl-shader-tables,
  saver-camera-framing, screensaver-mode, page-fonts-and-math,
  concurrent-sessions-nav, wishlist-utm, legible-over-real-proportions,
  heat-pages-point-source, one-task-per-agent).
- No browser. No headless Chrome, Playwright, CDP, screenshots or
  recordings, and no Deno WebGPU runs. Validate with `node --check`, node
  ESM import of DOM-free modules, `node tests.mjs`, `~/.cargo/bin/naga
  file.wgsl` for every WGSL file (bare `naga` on PATH is a game), and
  TypeScript checkJs or `deno lint` for names. Say in each commit body
  that browser checks did not run.
- WGSL must also pass Chrome's Tint: parenthesize every mixed `*`/`^`,
  mixed bitwise/arithmetic and mixed `&&`/`||` expression. No
  `read_write` storage in vertex shaders. Respect the default WebGPU limits
  (8 storage buffers per stage, 16 KB workgroup storage, 256 invocations
  per workgroup, 128 MB per storage buffer binding).
- Edit only the files your package owns (table below). Need a change in
  another package's file? Write the request in your final report.
- Do NOT touch any other page or anything in `stella-nova/lib/`. Other
  sessions have uncommitted work in `pages/forge/` and elsewhere. The
  coordinator does the nav, catalog and home edits.
- Tests: add `tests/<package>.test.mjs` (default export `function (ok)`,
  `ok(name, cond, info)`). `tests.mjs` runs every `tests/*.test.mjs`.
  Only package UI writes `tests.mjs` (copy pages/weather-map/tests.mjs).
- Commit by pathspec in one command: `git add <your files> && git commit
  -F - -- <your paths>`. Run `git diff --cached --name-only` first and do
  not commit other paths. No `git add -A`, no amend, no rebase, no push,
  no branches. Subject `thermal-convection: <imperative>`. Body in
  Simplified Technical English with the real validation output. End with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Every stylesheet has `[hidden]{display:none!important}`.
- Fonts and math: `../../lib/sci.css` (STIX Two Text + Inter, math colours
  .m1-.m6) and `../../lib/sci-math.js` (runtime MathJax SVG, `typeset`,
  `typesetAll`, `colorize`). Never KaTeX, never Playfair, Cormorant or
  JetBrains Mono. Plain sentence-case UI text, no uppercase letter-spaced
  labels, no "SYS //" HUD gimmicks. Reference page: pages/reaction-diffusion.
- Look: crisp, not soft or "vibecoded". No bloom haze, no random glow, no
  scanlines. Sharp cell edges, legible flow. Linear filtering of the
  field textures is fine; never upscale a cached low-res raster of lines.

## Physics (binding)

Boussinesq equations in free-fall units (length = layer depth d, velocity
= sqrt(g alpha dT d), temperature = (T - T_top) / dT):

    du/dt + (u . grad) u = - grad p + sqrt(Pr / Ra) lap u + T z_hat
    div u = 0
    dT/dt + u . grad T   = 1 / sqrt(Ra Pr) lap T + Q(x, y, z)

- Ra = g alpha dT d^3 / (nu kappa), Pr = nu / kappa. Range Ra 1e3..1e7
  (log slider, default 1e5), Pr 0.1..10 (default 1). Critical Ra for
  rigid top and bottom = 1707.76 (Chandrasekhar 1961); for a free top
  surface = 1100.65.
- Domain: x in [0, Lx), y in [0, Ly), z in [0, 1]. Periodic in x and y.
  Default Lx = Ly = 4 (aspect 4 gives several cells across).
- Uniform grid, dx = dy = dz. Index `i + nx * (j + ny * k)`, k = 0 at the
  bottom. Quality grids: phone 64 x 64 x 16, tablet 96 x 96 x 24, desktop
  128 x 128 x 32 (SIM may raise desktop if the frame budget holds).
- Bottom wall z = 0: no-slip. Top z = 1: `top: 'rigid' | 'free'`
  (free = stress-free, the open surface of a pot of soup; default 'free').
- Heating `mode`:
  - `'plate'` Rayleigh–Bénard: T = 1 at the bottom, T = 0 at the top.
  - `'burner'` a pot on a stove: bottom temperature is a Gaussian hot
    patch (centre, radius, power) over a cooler base, top cooled. A real
    point source with falloff (memory heat-pages-point-source): one big
    central plume and a ring roll, not full-field noise.
  - `'sun'` heated from below, top cooled by a radiative-like flux
    (dT/dz = -cool * T^4 style, clamped); gives narrow cold downflow lanes
    between broad warm upflow cells, as in solar granulation.
  - `'pan'` Bénard–Marangoni: a thin layer with a free top whose surface
    tension varies with temperature. Top boundary shear stress
    du/dz = -Ma_eff dT/dx, dv/dz = -Ma_eff dT/dy (Ma slider 0..200, see
    Pearson 1958). This is what makes the hexagons in a thin pan of oil or
    soup.
- Q is zero except where a mode needs it.
- Numerics (SIM chooses details, but must state them in sim/ref.js):
  semi-Lagrangian or MacCormack/BFECC advection (keep T crisp), explicit
  or implicit diffusion with substeps that respect the stability limit, a
  pressure projection with a divergence residual target (max |div u| dx
  < 1e-3 after projection in the CPU reference at 16 x 16 x 8). x-y
  periodicity allows an FFT-in-xy + tridiagonal-in-z exact Poisson solve;
  Jacobi / red-black SOR with warm start is fine if it meets the target.
- Start state: the linear conduction profile plus small seeded noise
  (seeded RNG, never Math.random in the sim).

## Units and conventions

| Quantity | Convention |
|---|---|
| Box coordinates | x, y, z in layer depths; z up; z = 0 bottom wall. |
| Temperature | nondimensional, 0 = top, 1 = hot bottom (may exceed 1 locally with burner power). |
| Time | free-fall time units `sim.time`; the UI shows "t = 12.3 tff". |
| Slice | `{ angle, offset }`: a vertical plane through the box. `angle` in radians about z (0 = along x), `offset` the signed distance of the plane from the box centre in box units, wrapped periodically. Default angle 0, offset 0. |
| Surface depth | `surfaceZ` in [0.5, 1]: the height of the horizontal slice the surface view shows (default 0.94, just under the top where the pattern is sharp). |
| Colour | palettes map T in [0, 1] (after contrast `gain`, `bias`) to sRGB. |

## Module map and owners

| Package | Owns |
|---|---|
| SIM | `sim/ref.js`, `sim/gpu.js`, `sim/params.js`, `shaders/sim-*.wgsl`, `tests/sim.test.mjs` |
| VIEW | `render/views.js`, `render/layout.js`, `render/palettes.js`, `render/orbit.js`, `shaders/view-*.wgsl`, `tests/view.test.mjs` |
| UI | `index.html`, `style.css`, `main.js`, `ui.js`, `explainer.js`, `tests.mjs`, `tests/ui.test.mjs`, `CREDITS.txt` |
| SAVER | `saver.js`, `saver.css`, `director.js`, `tests/saver.test.mjs` |
| INTEGRATE | phase 2: any file in this page dir, to wire packages and fix seams |
| REVIEW | phase 3: any file in this page dir, to find and fix bugs |

## Interfaces

### sim/params.js (SIM, no DOM)
- `DEFAULTS` `{ Ra: 1e5, Pr: 1, Ma: 80, mode: 'plate', top: 'free',
  burner: { x: 0.5, y: 0.5, r: 0.12, power: 1.5 }  // x, y as fractions of Lx, Ly
  , cool: 1, noise: 1e-3, speed: 1, Lx: 4, Ly: 4 }`.
- `PRESETS`: named looks, each a partial params object plus a suggested
  palette and view: `granulation` (sun, Ra 1e6, palette 'solar'),
  `soup` (burner, free top, palette 'broth'), `benard` (plate, Ra 5e4),
  `hexagons` (pan, Ma 120, thin), `onset` (plate, Ra 3000, from rest),
  `turbulent` (plate, Ra 5e6). At least these six.
- `clampParams(p) -> p` and `GRIDS = { 0: [64,64,16], 1: [96,96,24], 2: [128,128,32] }`.

### sim/ref.js (SIM, no DOM, node-testable)
The CPU reference of the same scheme the WGSL runs. It is the spec of the
numerics. `createRefSim({ nx, ny, nz, Lx, Ly, seed }, params) -> ref`:
`ref.T` Float32Array(n), `ref.vel` Float32Array(4n) (u, v, w, 0 per cell,
cell-centred), `ref.step(dt)`, `ref.set(p)`, `ref.reset(seed)`,
`ref.stats() -> { simTime, Nu, vmax, Tmean, ke, divMax }`, `ref.time`.
Nu = (mean heat flux through the bottom wall) / (conduction flux).

### sim/gpu.js (SIM)
`createSim(device, { quality, nx?, ny?, nz?, seed, loadText }) -> Promise<sim>`
(`loadText(url)` fetches WGSL; default uses fetch relative to the module):
- `sim.dims` `{ nx, ny, nz, Lx, Ly, dx }`.
- `sim.buffers` `{ T, vel, tracers }`: GPUBuffers with STORAGE usage
  readable by the views. `T` f32 x n; `vel` vec4<f32> x n (cell-centred
  u, v, w, 0), refreshed every step; `tracers` vec4<f32> x `sim.tracerCount`
  (x, y, z, age) advected by the 3D velocity, respawned when age passes a
  life or they leave the box. Layout matches sim/ref.js.
- `sim.set(partialParams)`, `sim.params`, `sim.reset(seed)`,
  `sim.setTracers(count)` (0 = off, default 20000 desktop / 6000 phone).
- `sim.step(encoder, frameDt)`: encodes the substeps for one display
  frame of `frameDt` s wall time times `params.speed` (adaptive CFL dt,
  cap on substeps per frame so a slow GPU degrades speed, not stability).
- `sim.stats()` -> the latest async readback (at most 4 Hz, mapAsync, never
  stalls a frame): `{ simTime, Nu, vmax, Tmean, ke, hot: [x, y], cold: [x, y],
  plume: [x, y] }` where hot/cold are the top-layer T max/min positions
  and plume the strongest upflow at mid-height (box units). The saver
  aims shots with these.
- `sim.time`, `sim.destroy()`.

### render/palettes.js (VIEW, no DOM)
`PALETTES`: `solar` (blackbody: deep red lanes to white-yellow cell
tops), `broth` (amber soup: dark umber to bright gold, fat-sheen
highlight), `inferno`, `icefire` (diverging cold blue to hot orange about
the mean). Each `{ id, name, stops: [[t, '#rrggbb'], ...] }`.
`ramp(id, t) -> [r, g, b]` 0..1 sRGB, `lut(id, n = 256) -> Uint8Array(4n)`.

### render/layout.js (VIEW, no DOM)
`layoutRects(w, h, view, clear = { t: 0, b: 0, l: 0, r: 0 }) -> { surface?, slice?, block? }`
with each rect `{ x, y, w, h }` in CSS px. `view`:
- `'split'` (default): surface on top, its cross-section directly
  under it, same width, so the slice line on the surface and the section
  read as one cut. In landscape with room to spare the pair sits side by
  side only if `opts.side` is set (the saver may use it for 16:9).
- `'block'`: one rect, the 3D cutaway block.
- `'surface'`, `'slice'`: one full rect.
The surface rect keeps the box aspect Lx : Ly; the slice rect keeps the
section aspect (cut length : 1, with an optional vertical exaggeration
`zScale` 1..2.5 so a thin layer stays legible; label the exaggeration).

### render/orbit.js (VIEW, no DOM)
Block camera: `orbitCam({ yaw, pitch, dist, target }) -> { view, proj, viewProj, eye }`
(Float32Array(16), column-major, WebGPU depth 0..1), `fitBlock(dims, aspect)`
-> a camera that frames the whole box in the rect.

### render/views.js (VIEW)
`createViews(device, format, sim, { loadText }) -> Promise<views>`:
- `views.set({ palette, gain, bias, slice: { angle, offset }, surfaceZ,
  zScale, tracers: bool, arrows: bool, isotherms: bool, relief: 0..1,
  cam })`.
- `views.render(encoder, targetView, { w, h, dpr }, rects)`: draws every
  rect present, in one render pass, from the sim buffers directly (no CPU
  readback). Background is transparent-black clear; the page CSS gives
  the frame colour.
  - surface: the horizontal section at `surfaceZ`, sampled trilinearly
    from `T` (and vertical velocity w for optional relief shading, so
    upflow cells read bright and domed, downflow lanes dark and sunk).
    Draws the slice line on it (crisp, with end ticks) and tracers that
    are near the surface (the "pepper flakes" that gather in the cold
    lanes).
  - slice: the vertical section along the slice plane, T colour map,
    optional isotherms (thin contour lines, crisp, from fwidth), optional
    velocity arrows on a coarse grid, and tracers within a thin slab of
    the plane drawn as short streaks along their velocity. Bottom wall
    drawn as a hot plate bar, top as the surface line.
  - block: the box as a cutaway 3D block from `cam`: top face = surface
    section, front face = the slice plane (the part in front of the plane
    is removed), side faces = the boundary sections, thin edge lines.
- `views.pickSurface(px, py, rects) -> { x, y } | null` (box units) and
  `views.sliceFromDrag(p0, p1) -> { angle, offset }` for drawing the cut.
- `views.destroy()`.

### UI (index.html, style.css, main.js, ui.js, explainer.js)
- `<head>` order: `../../lib/gpu-guard.js`, `../../lib/wishlist.js`,
  `../../lib/stats-beacon.js`, then meta, title "Thermal Convection",
  `../../lib/sci.css`, `style.css`. A `#nogpu` message if WebGPU is
  missing (the explainer and equations still show).
- `main.js` owns `app` (also `window.TC`): `{ sim, views, params, view:
  'split', palette, slice, surfaceZ, zScale, toggles, playing, quality,
  rects }`, boot order (adapter, device, sim, views), the frame loop,
  resize with a backing store capped at 2560 x 1440 and dpr 2, quality
  from screen size and `navigator.hardwareConcurrency`, `?q=0|1|2`
  override, `?preset=` and `?seed=` URL params, device-lost recovery.
  Exposes `app.applyPreset(id)`, `app.setView(v)`, `app.setSlice(s)`,
  `app.reset(seed)` for the saver.
- Layout: the stage (split view by default) takes the screen. A
  compact control panel: preset chips, Ra (log) and Pr sliders, heating
  mode, top boundary, burner power/size (burner mode), Ma (pan mode),
  speed, play/pause, reset, palette, view switch (split / block /
  surface / slice), toggles (tracers, arrows, isotherms, relief),
  vertical exaggeration. Drag on the surface to draw a new slice line;
  drag on the block to orbit. Live readouts: Ra, Pr, Nu, max |u|, t.
- Mobile: base dock with the one-tap controls (preset, play, view,
  palette) and the full panel as a bottom sheet in portrait, a right
  drawer in landscape; `(pointer:coarse)` block with 44 px targets; the
  stage framed in the clear area above the dock (wave-membrane pattern).
- `explainer.js` (DOM-free data + a render function): the equations as
  TeX (colour-coded with `colorize`: advection, pressure, viscosity,
  buoyancy, diffusion), the definitions of Ra, Pr, Nu, Ma, and short
  accurate sections: what drives convection (buoyancy vs viscosity and
  diffusion, the Rayleigh number and onset at 1708), why the top looks
  like a Voronoi pattern (upflow at cell centres, cold sinking lanes at
  the edges, hexagons near onset), soup and thin pans (Bénard–Marangoni:
  in a thin layer surface tension, not buoyancy, sets the hexagons;
  Bénard 1900, Pearson 1958), the Sun (granules about 1000-1500 km
  across, lifetimes about 5-10 min, hot plasma rising and cooling at the
  photosphere; Nordlund, Stein and Asplund 2009, Living Rev. Solar Phys.
  6, 2), and what this model simplifies (Boussinesq, no compressibility,
  no radiation transfer, no magnetic field). Facts only, cited; mark
  illustrative values. CREDITS.txt lists the sources.

### SAVER (saver.js, saver.css, director.js)
`window.snSaver = { enter(opts), exit() }`, opts `{ calm, seconds,
caption, seed, label }`, enter returns `{ canvas, warmupMs }` (the page's
own in-document canvas). Also an in-page mode: a Screensaver button and
the `S` key; Esc, S, a click or a tap stops it.
- `director.js` (DOM-free): `rng(seed)`, `shuffle`, `buildShots(seed,
  { calm, aspect }) -> [shot]`, `createDirector(app, opts) -> { tick(dt),
  cut(key), debug(), stop() }`. Shot kinds at least: `granulation` (surface
  only, sun preset, slow drift of the slice line hidden), `onset` (reset
  from rest, cells form; hexagons preset or onset preset), `cut` (split
  view: the slice line sweeps slowly across the surface and the section
  under it changes), `plume` (slice through `stats().plume`, close on the
  rising plume, isotherms on), `block` (cutaway block, slow calm orbit,
  slice plane drifting), `soup` (burner with tracers, broth palette).
  Each shot sets a preset and palette and runs warm (a shot that needs a
  developed flow starts from a pre-run, or from the running field when
  the preset matches). Seeded shuffle per run, no shot twice in a row,
  cuts every ~8-14 s, calm and wide.
- Framing: inside `plateBand(h)` from `../../lib/saver-clear.js` (null
  outside the shell; then use a lower-third plate of saver.css). For 9:16
  the split view stacks surface over section; for 16:9 it may sit side by
  side. A node test samples every shot kind for 16:9 and 9:16 with
  `layoutRects` and checks that every rect is inside the clear band and
  not tiny (min rect side >= 22% of the frame's short side).
- Plate label (opts.label for the shell): title "Thermal Convection",
  sub = the shot ("Solar granulation", "Bénard–Marangoni hexagons", ...),
  eqs = the momentum and heat equations, params = live Ra, Pr, Nu, t,
  code = a short real extract of the buoyancy/advection WGSL kernel
  (`{ lang: 'wgsl', name, text }`).

## Phases

1. SIM, VIEW, UI, SAVER in parallel. Each builds against this contract;
   UI and SAVER may stub the missing modules in their own tests.
2. INTEGRATE: wire everything, run every check, fix seams, commit.
3. REVIEW: read every file for real bugs (WGSL Tint traps, bind group and
   buffer usage mismatches, [hidden] CSS, touch, resize, device loss,
   saver framing), fix what it finds, commit.

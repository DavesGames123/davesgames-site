# Collapse City — contract

Page key `wfc-city`, label "Collapse City", badge `RUST`. Nav slot: Generative
Art > Rules & Grammars (the coordinator registers it; lanes do not edit
lib/nav-data.js, lib/screensaver-catalog.js or pages/home/).

An infinite, walkable city that a 3D wave function collapse solver builds
around the player, as in the idea of marian42/wavefunctioncollapse (MIT,
Unity). We copy NO code, models, module set, names or look from that repo.
The module set, the geometry, the palette and the solver are ours. Credit it
as the inspiration, and Maxim Gumin's WaveFunctionCollapse (MIT) as the
algorithm, in CREDITS.md and the page credits.

## Split

- Rust (lane A, `crate/`): the solver, the module set, the module geometry,
  the chunk mesher, the player collision. Built to `pkg/` with wasm-bindgen.
- JS (lane B, the page): WebGPU renderer and WGSL, controls, UI, saver hook,
  node tests. Lane B develops against `mock-world.js` (same API, written by
  lane B) until `pkg/` lands, then the page uses `pkg/` only.

## Build (lane A)

- `crate/Cargo.toml`: crate `wfc-city`, `crate-type = ["cdylib","rlib"]`.
  Only dependency: `wasm-bindgen = "=0.2.103"` under
  `[target.'cfg(target_arch = "wasm32")'.dependencies]` (the CLI on this
  machine is 0.2.103). No other crates: no wgpu, no rand, no glam.
  Native `cargo test` has zero dependencies.
- `crate/build.sh`, as in pages/line-art/crate/build.sh: cargo test
  --release, cargo build --lib --release --target wasm32-unknown-unknown,
  then `wasm-bindgen --target web --no-typescript --out-dir ../pkg
  --out-name wfc_city`. Set `CARGO_TARGET_DIR` to a folder OUTSIDE the repo
  (the session scratchpad). Never commit a target/ folder.
- Release profile: opt-level 3, lto, codegen-units 1, panic abort.
  Target `pkg/wfc_city_bg.wasm` under 400 KB.

## World units

- Cell = 2.0 m on x, y and z. Cell (i, j, k) covers
  x in [2i, 2i+2), y in [2j, 2j+2), z in [2k, 2k+2). y is up.
- World height H cells (constructor argument, default 12). Layer j = 0 sits
  on the ground plane y = 0. Layer 0 faces down onto "ground"; layer H-1
  faces up onto "sky" (air). Horizontal extent is unbounded (i32 cells).
- Chunk = 8 x 8 cells in x/z, full height. Chunk (cx, cz) holds cells
  i in [8cx, 8cx+8), k in [8cz, 8cz+8).

## Module set (lane A designs it)

- Prototypes authored in Rust; each has 6 face connectors and a weight. Lane
  A expands rotations (0..3 about y) into modules. Horizontal connectors
  carry symmetry or a flip flag; vertical connectors carry a rotation rule.
  Adjacency is derived from connectors, never a hand table.
- Aim: 35-60 prototypes, 120-220 modules after rotation. A city that reads
  as a city: ground (paving, grass, water channel), building walls with
  windows and doors, corners, roofs and roof gardens, stairs and ramps that
  the player can climb, bridges and walkways between towers, arches,
  balconies, railings, pillars, pipes, and empty air. Make it walkable:
  stairs connect levels often enough that a walker can climb high.
- Palette: our own (not pastel copy). Colour = a palette index 0..15 per
  face; the palette table is exported (see `palette()`), and the page may
  override it.

## Solver

- Domain per slot: a bitset of modules. Constraint propagation (AC-3 or
  support counts) over the 6 neighbours. Pick the next slot: lowest
  Shannon entropy among slots inside the generation radius, ties broken by
  the seeded RNG (own xorshift/PCG, seed from the constructor), with a bias
  to slots nearer the focus point.
- Infinite map: slots exist lazily in a HashMap. A slot outside every
  generated area starts with the full domain (minus layer rules). Propagation
  may run into ungenerated slots; keep it bounded so it cannot run away.
- Backtracking: on a contradiction, undo to an earlier state (history stack
  of removals) and ban the choice that led there. After K failed tries in an
  area, undo further back. Never leave a contradiction in collapsed slots.
  Never leave a forever-failing area: as a last resort, clear and regenerate
  a small uncollapsed area. Count backtracks in stats.
- Determinism: same seed + same sequence of `update` calls = same world.

## wasm API (`pkg/wfc_city.js`, wasm-bindgen --target web)

```
import init, { World } from './pkg/wfc_city.js';
await init();                        // node tests pass { module_or_path: bytes }
const w = new World(seed /*u32*/, height /*u32, 12*/);
w.update(px, py, pz, radius_cells /*u32*/, budget /*u32*/) -> u32
    // collapse up to `budget` slots, nearest-first around the focus point
    // (world metres). Returns slots collapsed this call (0 = area done).
w.dirty_chunks() -> Int32Array       // [cx, cz, cx, cz, ...] meshes changed
                                     // since the last call; clears the list
w.chunk_mesh(cx, cz) -> Float32Array // interleaved vertices, triangle list
w.forget_far(px, pz, keep_radius_cells) -> Int32Array
                                     // drop chunks out of range (memory cap);
                                     // returns [cx, cz, ...] dropped
w.move_body(state /*Float32Array(8)*/, dt, radius, height, fly /*bool*/)
    // in place: [x, y, z, vx, vy, vz, grounded 0|1, unused]; feet at y.
    // Gravity 18 m/s^2 unless fly. AABB/capsule vs module collision boxes,
    // step-up 0.55 m (stairs), no tunnelling at 30 m/s with dt <= 1/30.
w.ground_height(x, z) -> f32         // top of solid under (x, z), for spawn
w.counter() -> u32                   // total collapses so far (birth clock)
w.stats() -> Float32Array            // [collapsed, backtracks, contradictions,
                                     //  live_slots, live_chunks, modules,
                                     //  prototypes, last_update_ms (0 ok)]
w.palette() -> Float32Array          // 16 x rgb, linear 0..1
w.module_count() -> u32
w.prototype_name(i) -> String
w.slot_info(i, j, k) -> Int32Array   // [state 0 none|1 open|2 collapsed,
                                     //  options_left, module, prototype]
w.free()
version() -> String
```

Vertex layout (chunk_mesh): 8 floats = 32 bytes per vertex.
`[px, py, pz, nx, ny, nz, colour_index, birth]`. Positions in world metres.
`birth` = the `counter()` value when the vertex's slot collapsed; the
renderer animates slots whose birth is near its display clock (drop-in) and
hides slots born after it. Flat-shaded, low-poly geometry with bevels where
cheap. Per chunk keep it under 96k vertices (measured 2026-11-06: mean 35k, max 64k).

Performance targets (wasm, M-series laptop): `update(.., budget=300)` under
4 ms; `chunk_mesh` under 2 ms; `move_body` under 0.05 ms.

## Page (lane B)

Files: `index.html`, `main.js` (DOM, loop, controls), `gpu.js` (WebGPU
device, pipelines, chunk buffers), `shaders/*.wgsl`, `style.css`,
`saver.js`, `mock-world.js`, `tests.mjs`, `CREDITS.md`.

- Page head as in pages/articraft/index.html: gpu-guard.js, wishlist.js,
  stats-beacon.js first; `lib/sci.css`; the page banner comment that lists
  files and element ids. `[hidden]{display:none!important}`.
- Raw WebGPU, no three.js. Sky gradient, sun with one shadow map that
  follows the camera, hemisphere ambient, distance fog that hides the
  generation edge, light screen-space edge or AO only if cheap. Frames in
  flight capped at 2. Validate WGSL with `~/.cargo/bin/naga file.wgsl`
  (bare `naga` on PATH is a different program). naga passes some WGSL that
  Chrome rejects: no mixed `*` `^` without brackets, no mixed `&&` `||`.
- Modes: Walk (pointer lock, WASD, mouse look, Space jump, Shift run, F
  fly), Fly-over (drone orbit/glide, the default on load), Watch (fresh seed,
  camera above, the display clock runs slowly so the user sees each slot
  fall in, with the open-slot entropy shown as faint wire cells optional).
  Touch: left stick + drag look + jump button; dock + bottom sheet pattern
  from pages/wave-membrane (44 px targets in `(pointer:coarse)`).
- Panel: seed (and New city), view distance (radius), generation speed,
  collapse animation speed, time of day, stats line (collapsed, backtracks,
  slots, chunks, ms), credits.
- Per frame: `update(focus, radius, budget)` within a time budget, upload
  dirty chunks, `forget_far`, then draw. Generate ahead of the camera.
- Saver: `window.snSaver = { enter(opts) -> { canvas, warmupMs }, exit }`,
  opts { calm, seconds, caption, seed }; see pages/articraft/saver.js.
  Seeded shot list, cut every 6-12 s: street-level glide, rooftop walk,
  high flyover, watch a new block collapse from above, bridge crossing.
  Must vary per run. Keep the subject in the plate band
  (lib/saver-clear.js plateBand). The canvas must be in the document.
  Expose `snSaver.debug()` and `snSaver.cut(key)`.
- No browser checks: headless Chrome, Playwright, CDP and screenshots are
  banned on this machine. Validate with node only.

## Tests (node only)

- Lane A: `cargo test --release` in crate/: every collapsed pair of
  neighbours is compatible (sweep a 64 x 12 x 64 area at 5 seeds), the
  determinism rule, rotation expansion, chunk mesh vertex count and layout,
  move_body (fall to ground, no tunnelling, step-up on stairs), backtracks
  finite. Plus `tools/check-pkg.mjs`: load pkg/ in node, run a walk, print
  stats and the bytes of the wasm.
- Lane B: `tests.mjs` (node, mock world AND pkg when present): main.js and
  gpu.js link (`node --input-type=module` import with stubs), WGSL passes
  naga, saver shot list varies by seed, vertex stride 32, the HTML ids that
  main.js binds exist.

## Rules for all lanes

- Write comments and commit bodies in ASD-STE100 style. No emoji.
- Do not commit. The coordinator commits by pathspec.
- Do not touch files outside pages/wfc-city/.
- No network fetches are needed. Never send the user's email anywhere.
- Never run pkill or killall; stop only your own pids.

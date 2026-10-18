# Coral reef v4 contract: the infinite seafloor and the ROV squad

Binding spec for the v4 work (package WORLD). It replaces the circular
plot of CONTRACT-V3.md. The rules of `stella-nova/lib/GROWTH-PAGES.md`
and the validation and commit rules of CONTRACT-V3.md still apply.

## What the user asked for (verbatim, 2026-10-18)

> i want to reimagine the coral reef exploration region with the ROV's as
> an infinite procedurally generated seafloor/seamount terrain that is
> explored constantly by the ROV squad. we shouldn't grow corals, they
> should just grow once adn be there

Earlier wishes that still hold: very dark deep water lit by the ROVs;
"we should be able to see their camera feed through sstv at the bottom
right simulated"; craggy rocks with "archways and natural canyons";
corals "much larger"; "make sure that corals and lights from rov's cast
shadows"; "focus on rov's by default"; corals stay "totally locked in";
"marine snow is too intense"; the saver and the free camera both
matter; phones must not crash.

## Coordinator decisions (binding)

1. The infinite seafloor replaces the plot. One seed gives one world.
2. Corals are already grown when they show. A worker grows the colonies
   of a chunk to the end (reef.js), meshes them (coral-sdf.js), and the
   page shows the corals of the chunk only when all of them are there.
   Every shown particle has a birth far in the past, so the shaders do
   no grow-in. No growth animation, no regrow, no plant mode. The colour
   modes and the gradient picker stay.
3. A squad of 2 to 4 ROVs explores the world on its own. The camera
   follows the squad by default. Orbit, swim, follow one ROV and tours
   stay, and the world streams round the camera.
4. The saver is the squad that explores, in calm shots framed with
   plateBand (16:9 and 9:16), with live stats on the plate.

## Ownership

| Package | Files |
|---|---|
| WORLD (this contract) | new `world/*.js`, new `rov/squad.js`, `main.js`, `scene.js` (the world parts), `camera.js`, `saver.js`, `budget.js`, `shell.js`, `index.html`, `style.css`, `rov/index.js`, `mobile-check.mjs`, the new tests, `lib/screensaver-catalog.js` (coral-reef entry) |
| GROWTH (another agent) | `reef.js`, `coral-sdf.js`, `colour.js`, the coral and polyp parts of `shaders.js`, their tests |

WORLD uses the GROWTH exports only (createReef, R.addColony, R.growAll,
R.step, pickSpecies, colonyInfo, packParticles, createReefMirror,
createCoralMesher, M.addColony, M.add, M.bridge, M.meshAll, SHAPES,
SPECIES, holdFocus, the colour.js functions). An API request goes in
NOTES.md as a dated line "from WORLD, to GROWTH".

## Coordinates

- World: metres, y up, the old plot datum (SURFACE_Y 55 m over y = 0).
  The world is infinite in x and z. y stays in about -70 .. +30 m.
- Floating origin. The page keeps an origin O = (Ox, 0, Oz) (multiples
  of 1024 m). Every three.js object is in render space: world minus O.
  `scene.js` has one `worldRoot` group at (-Ox, 0, -Oz); each chunk
  group sits at its true chunk origin under it, so three computes the
  model matrix in double precision and the GPU gets small numbers. The
  ROV groups are under a `rovRoot` with the same offset. The page moves
  O when the eye is more than 4096 m from it (float32 then still has
  0.5 mm steps). The shaders use render-space positions, so a move of O
  shifts the noise of the caustics and the rock tint once: rare (every
  hour of squad travel).
- Chunk meshes and coral particles are in chunk-local metres: x and z
  relative to the chunk centre, y absolute.

## The world field (world/field.js)

`createWorld({ seed, quality })` -> W, DOM-free, the same in node, a
worker and the page:

- `W.height(x, z)` the large-scale bathymetry: plains, seamounts and
  guyots (flat tops), ridges, plateaus with terraces, drop-offs (cliff
  lines), canyons cut into the slopes.
- `W.sandAt(x, z)` the sand floor (sediment in the low ground, ripples).
- `W.sdf(x, y, z)` the rock: a signed distance bound, negative inside,
  `clamp(raw * W.sdfScale, sdfClamp)`, with `|sdf(a) - sdf(b)| <=
  W.lipschitz |a - b|` (measured in the tests). It has the crag detail
  (domain-warped ridges, Worley joints, strata ledges) in a band near
  the surface, undercut canyon walls, and 3D features placed per 48 m
  cell by a hash: natural arches, pinnacles and hoodoos, overhang caps,
  boulders and scree.
- `W.sdfAll` min of rock and sand (the solid for walkers, ROVs, camera).
- `W.normal`, `W.features(x, z, r)` the features near a point (kind
  'arch' with axis and gap, 'pinnacle', 'overhang', 'canyon' with a
  local path), `W.habitat(x, z)` 0..1 coral density, `W.channel(x, z)`
  the canyon value, `W.columnRange(x0, z0, size)` the y range of the
  solid surface in a square.
- The rock adapter of a chunk (`W.localRock(cx, cz)`) gives reef.js the
  field in chunk-local metres.

## The chunk grid and the LOD

- Chunk: a column of CH = 32 m by 32 m, key `i,j` (x in [32 i, 32 i +
  32)). The y range comes from W.columnRange.
- Rock LOD by the distance d from the eye (xz) to the chunk square:
  L0 cell c0, L1 2 c0, L2 4 c0 (cells divide 32 m). The lattice is
  global (point index = world / cell), so two chunks of one LOD meet
  with the same vertices (no skirt, no overlap). An edge belongs to the
  chunk of its lower point (rock/mesh.js rule). Between two LODs there
  can be a small crack; it is at 30 m or more and in the fog.
- Sand: a height grid per chunk on the same global lattice (cell 2 c0
  at L0), with the same rule.
- Corals only in chunks with d < coralR. A coral chunk has the coarse
  coral mesh (coral-sdf.js lod: true, no focus). The nearest colonies
  (reef.js holdFocus over all the colonies of the loaded chunks, the
  main and lead ROV cameras as view points) also get a fine mesh of
  their own with polyps, in a fine triangle budget.

## Budgets per device profile (budget.js `world`)

| profile | c0 | L0, L1, L2 (m) | coralR | colonies / chunk | particles / chunk | fine tris | workers |
|---|---|---|---|---|---|---|---|
| desktop | 0.25 | 36, 80, 150 | 44 | 8 | 12000 | 1.2 M | 4 |
| laptop-low | 0.32 | 30, 66, 120 | 36 | 6 | 8000 | 0.6 M | 3 |
| phone | 0.4 | 24, 56, - | 28 | 4 | 4500 | 0.25 M | 2 |
| phone-min | 0.5 | 16, 44, - | 20 | 3 | 3000 | 0.12 M | 1 |

Memory caps (the streamer drops the farthest chunk when a cap is full):
rock chunks, coral chunks (= the particle slabs of the data texture),
fine colonies. Phones keep one shadow map (the lead lamp).

## The chunk lifecycle (world/stream.js)

```
want(L) -> rock job -> rock shown (rock + sand meshes of LOD L)
        -> (d < coralR) coral job: sites -> grown colonies -> coarse
           coral meshes (merged per species in the worker) -> shown in
           ONE frame with all its colonies
        -> fine jobs for the focus colonies -> shown when complete, then
           the coarse part of that colony hides (negative radius)
unload: rock when d > Lmax + 32 m, coral when d > coralR + 24 m, a LOD
        change when d leaves its band by 16 m (hysteresis). The old mesh
        stays until the new one is complete. An unload frees the GPU
        geometry, the slab and the arrays; the byte counters return.
```

- A job carries the chunk key and a token. A result for a chunk that is
  gone, or for an old token, is dropped (and its arrays freed).
- Priority: the chunk under the eye first, then by distance; rock before
  coral at the same distance. Coral jobs take at most workers - 1
  workers (one worker is kept for rock), at least 1.
- Bytes: the streamer counts the bytes of every array it holds (CPU) and
  gives to the GPU (geometry), per chunk and in total.

## The worker pool (world/pool.js, world/worker.js)

`createPool({ size, makeWorker, runLocal })`: module workers of
world/worker.js; `pool.submit(job, priority) -> { promise, cancel }`.
Jobs: `{ type: 'rock', key, i, j, lod }`, `{ type: 'coral', key, i, j,
budget }`, `{ type: 'fine', key, colony, particles, bridges }`. With no
Worker (jsdom, a failed worker), the same job code runs on the main
thread in small time slices (`runLocal`), with the phone-min budgets.

## The ROV squad (rov/squad.js)

`createSquad({ field, seed, count, clear, start, colonies })` -> S:
- `S.vehicles[i].state` has the fields of rov/pilot.js (p, v, a, yaw,
  look, lookR, mode, phase, thrust), so rov/index.js poses the models.
- `S.step(dt)`: the leader plans legs from a frontier and curiosity
  score (cells of 12 m not seen yet, the heading, canyons to follow,
  ridges, arches to pass under, big colonies to inspect); the others keep
  a loose formation and fall back to the leader's trail where the water
  is narrow. Paths: rov/pilot.js marchPath on `field.sdf` (rock, sand
  and the coral term). A guard keeps every vehicle in its clearance.
- `S.task` { kind: 'transit' | 'canyon' | 'ridge' | 'arch' | 'inspect' |
  'drop-off', label }, `S.stats` { distance, cells, chunks, colonies,
  depth }.
- Tethers: dropped. A surface tether 30 to 80 m up to a ship that must
  follow the squad for ever is not believable, and the cable would cross
  the camera. The vehicles are hybrid ROVs (as WHOI Nereus): battery
  power and a hair-thin fibre-optic micro-tether that a camera does not
  see, with an acoustic link for status. The low data rate of that link
  is also why the feed comes as slow-scan pictures.

## How the old modules are used

- reef.js, coral-sdf.js, colour.js: through their exports (above).
- rock/noise.js (makeNoise, mulberry32) and the ideas of rock/geology.js
  (strata profile, crag band, smin and smax) for the world field;
  rock/mesh.js narrow-band surface nets, adapted for chunk-local output.
- rov/index.js: the vehicle models, lamps, wash and the SSTV feed, with
  new options `pilots` (the squad states), `tether: false` and `root`
  (the render-space group).
- camera.js: R = Infinity (no plot bound), a `maxDist` for the orbit,
  tours on the features near the eye with a grid-free route.
- saver.js: frameFit, safeCamera, cardRect stay; the dive plan becomes a
  squad shot plan.
- mesh-worker.js, fine-view.js, coral-link.js stay for coral-species.
- lib/tilt.js: the render eye turns with the phone tilt (tiltEye); the
  camera state of camera.js does not change.

## Tests (node)

world determinism per seed; seamless chunk borders (SDF and vertices);
streaming memory bounded over a 2 km scripted flight (bytes before and
after, nothing grows after an unload); corals show only when complete;
no growth animation (every shown birth older than the grow-in time);
the squad never enters rock or coral over a long run; the frontier
coverage grows; the follow camera is never stuck on rock; saver framing;
phone budgets. Old tests about the plot and growth are retired with a
note in the commit that retires them.

## Addendum 2026-10-18: depth regions

The user said (verbatim): "you should be allowed to explore different
regions with the ROV. reefs, shallows, twilight zone, absolute ocean
depths". Binding additions (the other decisions stay: corals grown once,
no growth animation, the ROV squad, follow by default):

- Regions by depth, with no hard border (the depth field is continuous):
  | region | depth | look and life |
  |---|---|---|
  | Shallows | 0 to about 30 m | sunlit, strong caustics, turquoise water, sand flats, seagrass |
  | Reef | about 5 to 40 m | the dense reef framework, many grown colonies |
  | Twilight | about 40 to 1000 m | fading blue; plate corals, then sparse deep corals, sponges, sea pens |
  | Abyss / Trench | 1000 m to trenches of several km | black: only the ROV lamps and some bioluminescence, marine snow, sediment plains; sparse deep corals (Lophelia, bamboo coral) and glass sponges |
- The large-scale field: a regional depth (a slow warped noise over
  kilometres, mapped through a profile with shelves) under the local
  relief of world/field.js. The shelf ends in a reef wall or drop-off to
  the twilight slope, which runs down to abyssal plains with trenches.
  Slopes stay within the bound of the field (no wall over about 60
  degrees from the height term; vertical walls only from the 3D parts).
  The local relief scales with the region (taller seamounts deep, low
  relief on the shelf). Heights stay under the sea surface.
- world y keeps the datum of the page: depth = 55 - y (shaders.js
  SURF_Y). The HUD shows the depth and the region name.
- Region picker (Shallows, Reef, Twilight, Abyss / Trench): the page
  finds the nearest point of that region (a seeded search on the regional
  field), fades out, moves the squad and the camera there, and fades in
  when the chunk under the eye has rock. The squad also wanders between
  regions on its own (a slow bias of its exploration heading to a target
  region that changes every 20 to 40 minutes), and the saver visits all
  regions (a region step every few minutes of saver time).
- Light from depth: the fog colour and density, the downwelling light,
  the caustic strength, the marine snow density and the exposure follow
  the camera depth (per frame, uniforms only): bright turquoise in the
  shallows, deep blue in the twilight, black in the abyss.
- Life from depth: the colony density (W.habitat) and the species mix
  (reef.js pickSpecies weights) follow the region: dense reef colonies at
  5 to 40 m; tables and fans in the twilight; few, small colonies in the
  abyss. Species colours belong to GROWTH (reef.js SPECIES): a request in
  NOTES.md if deep-water colours are needed.
- Phones: the same regions with the existing budgets.

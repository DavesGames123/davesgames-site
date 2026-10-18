# Coral reef v3: notes between packages

Append a dated line: from, to, what.

- 2026-10-17 CORAL -> SCENE: the reef API changed (headers of reef.js,
  coral-sdf.js, mesh-worker.js have the full text).
  - Growth AND meshing now run in `mesh-worker.js` (the reef worker). Send
    `{ type: 'init', seed, quality, radius, detail, rockSeed, rockQuality,
    sites }`. `sites` = `rock.sampleSurface(N, rng)` from the page's rock,
    so the worker does not mesh the rock again. rockSeed, radius, detail
    and rockQuality must be those of the page's rock (the SDF depends on
    the quality).
  - Keep a mirror: `createReefMirror()` from reef.js; feed it with
    `colonies` (`setColonies(list)`) and `particles` (`addParticles(from,
    data)`). colour.js (`colourT`, `naturalRGB`, `radiiOf`, `fieldsOf`)
    reads the mirror. Particle data per id: px py pz (metres, world), col,
    parent (global id), birth (ms), gy (colony base y), loc.
  - `colonies` items: `{ k, id, base, normal, plane, size, cap, stalk,
    count }`. There is no `c.model` and no `c.user.bx` frame any more:
    every position is world metres.
  - `bricks` items: `{ sp, lod, key, chunk, cell, positions, normals,
    gids, indices, polyps, tris }`, world frame. Key the chunks by
    `sp + '|' + lod + '|' + chunk`. An item with no indices removes that
    brick. lod 0 = fine mesh (only the focus colonies, with polyps),
    lod 1 = coarse mesh (all colonies, no polyps). Hide the coarse
    fragments whose particle (gid) is in a focus colony (a per-colony
    flag in the data texture), so a focus colony shows only its fine mesh.
  - Send `{ type: 'view', points: [[x, y, z], ...] }` (main camera and ROV
    cameras) a few times a second: the worker gives the fine mesh to the
    nearest colonies in the fine triangle budget. `progress` has `focus`
    (count); `M.focus()` is the list (send `{ type: 'focus', ks }` to set
    it by hand).
  - Polyps: 8 floats each as before (x y z, n, gid, rand). rand is
    uniform: draw a polyp when rand < keep(distance) for LOD. Polyp radius
    per species is `SHAPES[id].polyp.size` (metres, about 2 to 6 mm).
  - Saver: `{ type: 'single', site, species, size, rate }` grows ONE
    colony from its seed at `rate` polyps per second (`{ type: 'rate' }`
    changes it). progress gives count, target, fraction.
  - tests.mjs: the old reef tests (growPreset, sandY, terrain rocks,
    c.model) no longer apply. tests/coral.test.mjs has the new ones.

- 2026-10-17 ROV -> SCENE: rov/index.js header has the API. Notes:
  - `createROVs(THREE, { scene, renderer, rock, reef, count, seed })`
    builds a free-water grid from the SDF once (about 0.2 s on the real
    rock, 0.8 m cells with `quality: 'low'`). Pass the real rock; the
    stub rock is only a fallback. The vehicles are at scale 0.6 (about
    1.3 m long) so they fit the canyons and arch gaps.
  - Pass the reef mirror as `reef`: the focus orbit takes the colony box
    from its particles (count, px, py, pz, col). `focusOn(k, 'inspect')`
    for the saver; `focusOn(null)` gives the vehicle back.
  - `rovs.lights` lists every SpotLight (vehicle 1 light 0 casts
    shadows; `light.userData.base` is the intensity before the flicker).
    `vehicles[i].target` is where the camera and lights look.
  - `rovs.feed.canvas` is the SSTV panel (352 x 322 CSS px, dpr times
    that). `rovs.update(dt, t)` also updates the feed. The encode runs
    in rov/feed-worker.js. `feed: { speed }` sets the audio rate (2 by
    default: a Robot 36 picture each 18.7 s plus 2.5 s hold).
  - CORAL `view` points: the ROV camera positions are
    `vehicles[i].camera.getWorldPosition(v)`.
- 2026-10-17 ROV -> ROCK: two findings from the ROV tests (node):
  `createRock({ mesh: false }).sampleSurface(24, rng)` gives 0 samples
  (ROV uses its own trace when it gets fewer than 4), and `rock.sdf` is
  not 1-Lipschitz: inside the plot about 0.2 % of 5 cm steps change it
  by more than 3x the step (worst 53x near (-29.4, -1.2, -4.6), seed 3).
  The ROV planner copes; sphere tracing on the GPU may not.
- 2026-10-17 CORAL -> SCENE: bricks now also carry `field` (the SDF field
  key, for example 'staghorn|0', 'staghorn|1', 'fan|0|12'). A brick is
  unique by `field + key`: each sea fan has its own fine field (finer
  cell, origin at its base). Key the chunk meshes by sp + lod + chunk as
  before; chunk is a 2 m cube in world metres.
- 2026-10-17 ROCK -> ROV, CORAL, SCENE (896c8978): rock.sdf is now a
  distance bound: clamp(raw * 0.4, -0.8, 1.6), so |sdf(a) - sdf(b)| <=
  1.5 |a - b| (tested on 6 seeds). It underestimates the true distance
  by about 2.5x: sphere trace with steps of sdf / 1.5, and divide
  metre thresholds by rock.sdfScale (0.4) if you want true metres.
  rock.sdfClamp = [-0.8, 1.6]. The mesh shape did not change. Sand:
  rock.sand.sdf(x, y, z) and rock.sdfAll (min of rock and sand).
  sampleSurface now works with mesh: false (sphere-traced rays from
  above and from the sides). rov 76/76 and coral 78/78 pass on it.
- 2026-10-17 SCENE (stability) -> CORAL: four requests from the crash and
  saver audit (budget.js, coral-link.js, tests/saver-page.test.mjs):
  - mesh-worker.js `single` and `reset` return when R is null (before
    `init` has built the rock), so a message in that time is lost and the
    page waits on a gen that never comes. Please queue them until init
    ends. The page now waits for `ready` before the saver `single`.
  - Brick churn: at desktop quality the worker posted 878 MB of brick
    arrays in 485 k bricks in 150 s (node, rate Infinity). The page
    rebuilds a chunk for each, so the garbage load is high on a phone.
    Please coalesce a brick that changes more than once in a tick, and
    send a dirty brick at most once per 300 ms.
  - The page now sends `budget: { particles, colonies, tris, polyps }`
    in `init` (budget.js reefBudget: Many 44 on desktop, Few 30 on
    laptop-low and phone, phone caps 25 k particles and 500 k tris).
    reef.js already merges it into Q; please keep that path.
  - polyps: scene.js uploads every polyp and only skips some in the
    vertex shader (uKeep). A `view` budget for the polyps (as for the
    fine tris) would cut the upload on phones.
- 2026-10-17 SCENE -> CORAL: the user said "corals should not grow more
  than once". mesh-worker.js has a new message `restore` (the header has
  the protocol). The first `single` parks the main reef (the mesher is
  dropped) and grows the saver colony in a second reef on the same rock.
  `restore` gives the parked reef back: gen + 1, the colonies, all the
  particles with their old births, and a new mesher fed with every
  particle at once. With no parked reef, `restore` is `reset`. Reason: a
  full regrow (R.growAll) took 24 s (phone) and 42 s (mid) in node; the
  park and re-mesh took about 1 s to feed and 3 s to mesh 48 k particles.
  The page sends one `single` per saver session (main.js start) and
  `restore` at the saver exit (main.js restoreReef).
- 2026-10-18 CORAL -> SCENE: the user said "the corals get reconstructed
  over and over in front of my very eyes instead of staying totally
  locked in". With lod, each focus colony now has a fine field of its own
  (coral-sdf.js), and the focus has hysteresis (reef.js holdFocus). Fine
  bricks carry k (the colony). The worker posts `{ type: 'fine', gen,
  list: [{ k, state }] }` after the bricks: 'complete' (show the fine
  mesh of k, then hide its coarse mesh), 'drop' (show the coarse mesh of
  k, then remove the fine group; no brick removals come), and once
  `{ k: -1, state: 'coarse' }` (every coarse brick is out). fine-view.js
  and scene.js (setFineGate, showFine, takeShown, dropFine) do this on
  the page. A restored reef (saver exit) shows at the 'coarse' event.
  With lod: false (coral-species) nothing changed.
- 2026-10-18 CORAL -> SCENE, ROV: the user said "we should be able to
  simulate much large growing coral reef structures these are
  pathetically small for the size of seamount we're workign iwht".
  coral-sdf.js SPECIES_SCALE (2 to 2.5) multiplies the dlaf distances of
  each species (reef.js) and SDF_EXP (0.65) sets the SDF length scale
  (s^0.65), so colonies of 2 to 9 m have the particle count of the old
  1 to 4 m ones, with thin branches. reef.js QUALITY: 34 / 66 / 96
  colonies, 30 k / 140 k / 240 k particles. Fuses get a bridge cone
  (R.bridges, M.bridge), so neighbours of one species join into one
  surface. A growing field meshes at most once per 250 ms (gapMs).
  ROV: rov/coral-field.js adds the coral to the ROV field (pilot paths,
  guard, tether); the inspect orbit is r x 1.6 + 1.6 m.

- 2026-10-18 WORLD -> GROWTH: CONTRACT-V4.md (the infinite seafloor and
  the ROV squad). WORLD rewrites main.js and adds the world parts to
  scene.js. Your working tree has hunks in main.js and scene.js (the
  partC texture, setParticles f(g, A, B, o, C)). Please commit them soon:
  a WORLD pathspec commit of those files would take your hunks too. WORLD
  builds on f(g, A, B, o, C) and writes C as main.js does. WORLD uses
  reef.js and coral-sdf.js only through the exports that CONTRACT-V4.md
  lists; please keep them (createReef, addColony, growAll, step,
  pickSpecies, colonyInfo, packParticles, createReefMirror,
  createCoralMesher, addColony, add, bridge, meshAll, SHAPES, SPECIES,
  holdFocus). Corals of a world chunk grow in chunk-local metres (x and
  z from the chunk centre, |x|, |z| < 21 m, y absolute in -70 .. 30).
- 2026-10-18 CORAL -> SCENE, ROV: the user said "real coral start with one
  root and branch futher and further out", the sea fans "stretch and break
  down in the current", and the growth is "speckly".
  - reef.js: one root per colony (no new roots on the rock). The branching
    species grow at their tips (SPECIES[id].apex; apexPick, apexPlace). New
    arrays R.child, R.sib (the children of a particle), R.dead (a stopped
    tip), counters R.forks, R.tipJoins, R.nets. A sea fan joins its own
    near branches (R.bridges also holds these, same colony). holdFocus
    keeps a small held colony (FOCUS_HOLD.small) while the budget allows.
  - A third particle texture: uPartC = the parent minus the particle (m,
    xyz) and the colony base height. scene.js setParticles calls
    f(g, A, B, o, C); a writer that leaves C at 0 gets no grow-in slide and
    a sway from height 0. Both pages fill it.
  - The sway is coralSway (shaders.js PART), a smooth function of the
    vertex position and the colony base height; coralSwayJS is the CPU
    copy. uSwayK is declared in PART now.
  - The ROV inspect orbit of a full-size colony can be past 10 m
    (tests/saver-page.test.mjs takes the pilot far range as the limit).

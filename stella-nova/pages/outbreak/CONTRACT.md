# Outbreak — build contract

The Outbreak page (key `outbreak`, dir `stella-nova/pages/outbreak/`) is a
real-time 3D global epidemic simulator. It is a toy metapopulation model,
not a forecast. This file fixes the module map, the interfaces between
modules, and the work packages, so that separate agents can build the
packages at the same time without editing the same files.

User request, verbatim: "i also want another "infection" page much like
plauge inc. i want to simulate different types of diseases spreading across
the globe in a simulated fashion that i can observe happening in 3d. i
wantt o see transmission vectors such as planes and such as glowing arcs
wich create a n awesome spreading network of infection all over the globe.
we shoudl be able to simulate a vast array of infections adn also simulate
different social policies like social distancing and. it should really have
a kidckass auto mode where screensaver mode takes over and it plays itself
out automatically insimulation. we should have a . few different options
for how to represnet the simulated globe"

## Rules for every package

- Read the project memory first:
  `~/.claude/projects/-Users-davidkubala-Downloads-davesgames-site/memory/MEMORY.md`.
- No browser. No headless Chrome, Playwright, CDP, screenshots or
  recordings. Validate with `node --check`, node ESM import of DOM-free
  modules, `node tests.mjs`, and `deno lint` or TypeScript checkJs for
  names (see the static-site-build-gate memory). Say in each commit body
  that browser checks did not run.
- Tone of the page: an epidemiology simulation of natural diseases and
  public-health policy. The viewer observes and sets diseases and
  policies. No bioweapon framing, no "kill humanity" goal, no score for
  deaths, no gore.
- Edit only the files your package owns (table below). If you need a
  change in a file that another package owns, write the request in your
  report. Do not edit the file.
- Tests: add `tests/<package>.test.mjs` (default export `function (ok)`).
  `tests.mjs` runs every `tests/*.test.mjs`. Do not edit `tests.mjs`.
- Sources: put citations in your module header and in an exported
  `SOURCES` array (`{ ref, url, note }`). Only package P (fact-check and
  credits) edits `CREDITS.txt`.
- Commit by pathspec in one command: `git add <your new files>` then
  `git commit -F - -- <paths>`. No `git add -A`, no amend, no rebase, no
  push, no branches. Subject `outbreak: <imperative>`. Body in Simplified
  Technical English with the real validation output. End with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Other sessions commit to main at the same time. Do not touch other pages.

## Units and conventions

| Quantity | Unit / convention |
|---|---|
| Simulation time | days (float). `sim.day` starts at 0. |
| Model substep | `DT = 0.25` day, fixed. `sim.step(days)` runs whole substeps and keeps the remainder, so a run does not depend on frame rate. |
| Wall time | seconds (director, camera, render). |
| Rates | per day. Periods (latent, infectious, waning) in days. |
| Populations | people, Float64 (fractions of a person are allowed in the mean-field phase). |
| Latitude, longitude | degrees, north and east positive, lon in [-180, 180]. |
| Globe space (three.js) | unit sphere, y up. `x = cos(lat) cos(lon)`, `y = sin(lat)`, `z = -cos(lat) sin(lon)`. This matches `THREE.SphereGeometry` with an equirectangular texture (u = (lon + 180) / 360). |
| Flat-map space | plane z = 0 facing +z, width 4 (x in [-2, 2]), equirectangular height 2 (y = lat / 90). Equal Earth is scaled to the same width. Height above the map goes on +z. |
| Altitude | camera `alt` in globe radii above the surface (globe) or in map units above the plane (flat). |
| Seeds | uint32. `rng.js makeRng(seed)` (mulberry32). Separate streams: the model takes `seed`, the director takes `seed ^ 0x9e3779b9`, the visuals take any stream. A visual draw must never touch the model stream. |
| Determinism | same data + network + disease + policies + seed + seed node gives the same `sim.history` and `sim.events`, bit for bit. |
| Threads | main thread. About 400 nodes x 4 substeps a day is cheap. No Web Worker. |

## Data files

| File | Format | Built by |
|---|---|---|
| `data/nodes.json` | `{ src, regions: [7 names], cols: ['name','iso3','country','region','income','lat','lon','pop','cityPop','hub'], nodes: [[...], ...] }`. 395 nodes, 7.66 bn people. `region` indexes `regions` (World Bank regions: 0 East Asia & Pacific, 1 Europe & Central Asia, 2 Latin America & Caribbean, 3 Middle East & North Africa, 4 North America, 5 South Asia, 6 Sub-Saharan Africa). `income` 1 high .. 5 low. `pop` is the catchment (country population split over its largest cities by `cityPop ** 0.8`). `hub` = capital, worldcity or megacity (320 nodes, so a network must rank by `cityPop`, not by `hub` alone). | `tools/build-nodes.py` (Natural Earth 1:50m, public domain) |
| `../storm-globe/data/coast-50m.bin` | Natural Earth coast rings, decode with `../storm-globe/coast.js decodeCoast`. Reuse by relative path. Do not copy. | storm-globe |
| `../map-projections/data/world.json` | Natural Earth land rings in 1/100 degree (`land`, `land110`, `countries`). Use for the land mask raster. | map-projections |
| `../ancient-earth/data/present/color-2k.jpg` | NASA Blue Marble 2048x1024, public domain. | ancient-earth |
| `../ancient-earth/data/present/lights-2k.jpg` | NASA city lights 2048x1024 grey, public domain. | ancient-earth |

Read data with `response.json()` or `arrayBuffer()`. Never size a buffer
from content-length (the live site gzips data files).

## Module map

One line per file: what it owns. "DONE" files exist now.

| File | Owns | Package |
|---|---|---|
| `data.js` | DONE. `parseNodes`, `loadNodes`, `checkNodes`. | done |
| `rng.js` | DONE. `makeRng(seed)`. | done |
| `tests.mjs` | DONE. Runner for `tests/*.test.mjs`. | done |
| `tools/build-nodes.py`, `data/nodes.json` | DONE. Node data. | done |
| `diseases.js` | Disease presets, parameter schema, ranges, sources. | A |
| `policies.js` | Policy definitions, multipliers, triggers. | B |
| `network.js` | Air and land edges from the nodes. | C |
| `model.js` | The simulation engine. | D |
| `geo.js` | Sphere and flat-map projections, great-circle arcs. | E |
| `camera.js` | Camera state, poses, eased flights (no DOM). | E |
| `budget.js` | GPU memory budget (pixel ratio cap). | F |
| `render/globe.js` | three.js renderer core, style switch, layers, picking, pagehide release. | F |
| `render/field.js` | Land mask and the prevalence field texture. | F |
| `render/style-night.js` | Style 1: dark globe, city lights, glowing coasts (default). | G1 |
| `render/style-marble.js` | Style 2: Blue Marble with sun lighting. | G2 |
| `render/style-dots.js` | Style 3: dot-matrix globe coloured by local prevalence. | G3 |
| `render/style-flat.js` | Style 4: flat map (equirectangular and Equal Earth). | G4 |
| `render/style-holo.js` | Style 5: wireframe or holographic globe. | G5 |
| `render/arcs.js` | Air-route arcs, comets and planes, the lit network. | H |
| `render/nodes.js` | City glows, first-infection ring bursts. | H |
| `index.html`, `style.css`, `ui.js` | Page markup, panel, phone dock and sheet, HUD, region table. | J |
| `charts.js` | The S/E/I/R/D/V curves canvas and the R_eff strip. | K |
| `equations.js` | TeX strings and colour rules for the page and the plate. | L |
| `director.js` | Saver and Auto shot director (no DOM). | M |
| `saver.js` | `window.snSaver` hook and the Auto button glue. | M |
| `main.js` | Boot, frame loop, wiring of all modules. | N |
| `CREDITS.txt` | All credits. | P |
| `lib/nav-data.js`, `lib/screensaver-catalog.js`, `pages/home/thumbs/*` | Registration and thumbnail. | O |

## Public APIs

### diseases.js (package A)

```js
export const PRESETS;            // Disease[] in display order
export const SOURCES;            // [{ ref, url, note }]
export const SCHEMA;             // slider specs for the custom editor:
                                 // [{ key, label, min, max, step, unit }]
export function getDisease(id);  // a copy of the preset, or null
export function customDisease(base, patch); // a copy with clamped values
```

`Disease`:

```js
{
  id: 'flu-seasonal', name: 'Seasonal influenza', short: 'Flu',
  route: 'resp' | 'contact' | 'vector' | 'water' | 'flea',
  R0: 1.3,            // basic reproduction number (for vector, water and
                      // flea routes: at climate and sanitation factor 1)
  latent: 2,          // days in E; 0 = SIR (no E)
  infectious: 3,      // days in I
  ifr: 0.0005,        // fraction of infections that end in D
  careSensitive: false, // true: ifr x INCOME_IFR[income] (1, 1.2, 1.5, 2, 2.5)
  waning: 0,          // days of immunity, 0 = lifelong (SEIRS when > 0)
  seasonality: 0.3,   // 0..1 amplitude, peak in each hemisphere's winter
                      // (vector routes: peak in the warm season)
  climate: 'none' | 'tropical' | 'warm',  // suitability by latitude
  detect: 0.4,        // 0..1, how much of the transmission testing and
                      // isolation can reach (high when people are sick
                      // before they are infectious: SARS, Ebola)
  travel: 0.8,        // 0..1, infectious people who still travel
  immune0: 0,         // fraction immune at day 0
  vaccine: { exists: true, lagDays: 0, efficacy: 0.5 } | null,
  blurb: 'one or two sentences',
  ranges: { R0: [1.2, 1.4], latent: [1, 3], ... },  // from the sources
  refs: [indices into SOURCES],
  illustrative: true, // every value is approximate
}
```

Required presets (ids fixed, the director and tests use them):
`flu-seasonal`, `flu-1918`, `measles`, `covid-ancestral`, `covid-variant`,
`sars`, `ebola`, `cholera`, `dengue`, `malaria`, `plague`. Plus `custom`
(a copy of a preset, edited by sliders). IFR slider max 0.6. Planned values
and starting sources (package A checks and may change them, package P
fact-checks):

| id | route | R0 | latent d | infectious d | IFR | waning d | start source |
|---|---|---|---|---|---|---|---|
| flu-seasonal | resp | 1.3 | 2 | 3 | 0.0005 | 730 | Biggerstaff et al. 2014, BMC Infect Dis 14:480; Carrat et al. 2008, Am J Epidemiol |
| flu-1918 | resp | 2.0 | 2 | 4 | 0.02 | 0 | Mills, Robins, Lipsitch 2004, Nature 432:904; Taubenberger and Morens 2006, Emerg Infect Dis |
| measles | resp | 15 | 10 | 8 | 0.002, careSensitive | 0 | Guerra et al. 2017, Lancet Infect Dis; WHO measles fact sheet |
| covid-ancestral | resp | 2.8 | 3 | 6 | 0.006 | 0 | Liu et al. 2020, J Travel Med 27(2); Brazeau et al. 2020, Imperial Report 34 |
| covid-variant | resp | 6 | 2.5 | 5 | 0.003 | 240 | Liu and Rocklov 2021, J Travel Med 28(7) |
| sars | resp | 2.5 | 5 | 10, detect 0.9 | 0.10 | 0 | Riley et al. 2003, Science 300:1961; Lipsitch et al. 2003, Science 300:1966; WHO 2003 |
| ebola | contact | 1.8 | 10 | 8, detect 0.9 | 0.5, careSensitive | 0 | WHO Ebola Response Team 2014, NEJM 371:1481 |
| cholera | water | 2.5 | 1.5 | 5 | 0.01, careSensitive | 1095 | Mukandavire et al. 2011, PNAS 108:8767; Codeco 2001, BMC Infect Dis 1:1 |
| dengue | vector, tropical | 3 | 5 | 5 | 0.0005, careSensitive | 0 | Favier et al. 2006, Trop Med Int Health 11:332; WHO dengue fact sheet |
| malaria | vector, tropical | 3 | 12 | 60 | 0.003, careSensitive | 365 | Smith et al. 2007, PLoS Biol 5:e42; WHO World Malaria Report |
| plague | flea, warm | 1.8 | 4 | 10 | 0.4 | 0 | Dean et al. 2018, PNAS 115:1304; WHO plague fact sheet |

### policies.js (package B)

```js
export const POLICY_DEFS;  // [{ id, name, blurb, kind: 'contact'|'air'|'land'|'arrival'|'vaccine'|'vector'|'water',
                           //    defaultStrength, routes: [...] }]
export const SOURCES;
export function defaultPolicies();   // Policies, all off
export function triggerActive(p, detectedCases, day); // bool
export function transmissionMultiplier(disease, policies, active, node);
      // product over active contact policies, in (0, 1]; node gives income
export function airMultiplier(edge, policies, active);   // (0, 1]
export function landMultiplier(edge, policies, active);  // (0, 1]
export function arrivalCatch(disease, policies, active); // 0..1, fraction of
      // infected air travellers that quarantine stops
export function vaccinationRate(disease, policies, active, day, dayActive);
      // fraction of the remaining S vaccinated per day (0 before the
      // vaccine exists: dayActive + disease.vaccine.lagDays)
```

`Policies` = `{ [id]: { on: bool, strength: 0..1, trigger: number } }`,
`trigger` = detected cumulative cases worldwide (0 = from day 0).
`active` = `{ [id]: dayItStarted }` (absent = not active), kept by model.js.
Policy ids (fixed): `distancing`, `masks`, `closures`, `isolation`,
`travel`, `borders`, `quarantine`, `vaccination`, `vectorControl`,
`cleanWater`. Planned effects (package B documents and tunes them):

| id | effect at strength s |
|---|---|
| distancing | direct transmission x (1 - 0.45 s) |
| masks | resp route only: x (1 - 0.3 s) |
| closures | direct transmission x (1 - 0.35 s) |
| isolation | x (1 - 0.6 s detect) on resp and contact; (1 - 0.3 s detect) on others |
| travel | international air edges x (1 - 0.9 s) |
| borders | cross-border land edges x (1 - 0.9 s) |
| quarantine | arrivalCatch = 0.8 s (x 0.5 when latent > 14 d) |
| vaccination | S -> V at 0.002 + 0.01 s per day, efficacy from the disease |
| vectorControl | vector and flea routes x (1 - 0.6 s) |
| cleanWater | water route x (1 - 0.7 s) |

"Direct" = resp and contact routes, plus the person-to-person part of the
others.

### network.js (package C)

```js
export function buildNetwork(D, opts = {}) -> Net
export const SOURCES;   // gravity model refs; no OpenFlights
Net = {
  air:  { a: Int32Array, b: Int32Array, flow: Float64Array, // people/day, each way
          dist: Float64Array, // km, great circle
          intl: Uint8Array,   // 1 when a and b are in different countries
          n },
  land: { a: Int32Array, b: Int32Array, c: Float64Array,    // coupling, 1/day
          cross: Uint8Array,  // 1 across a border
          n },
  hubs: Int32Array,           // node indices ranked by cityPop
  airOut: Float64Array,       // per node, total air flow out per day
}
```

Air: a gravity model, flow ~ G P_a^0.8 P_b^0.8 / d^0.5 among about 60
hubs ranked by `cityPop`, top 8 partners per hub, plus each other node to
its nearest one or two hubs (domestic first). Scale the total to about
12 million passengers a day (about 4.5 bn a year before 2020; cite ICAO or
IATA). Expect 1000-2500 air edges. Land: the 5 nearest nodes within
1500 km, coupling c = 0.01 * exp(-d / 400 km), symmetric. Deterministic (no
RNG). Do not use OpenFlights or any non-public-domain route data.

### model.js (package D)

```js
export const DT = 0.25;
export function createSim({ D, net, disease, policies, seed, seedNode,
                            seedCount = 5, startDayOfYear = 0, maxDays = 1500 }) -> Sim
export function finalSizeR(R0);  // root of 1 - r = exp(-R0 r), for tests
```

`Sim`:

```js
{
  N, day,                     // node count, days since the start
  S, E, I, R, D, V,           // Float64Array(N), people
  W,                          // Float64Array(N), water reservoir (water route), else zeros
  Iv,                         // Float64Array(N), infected vector fraction (vector, flea), else zeros
  cum,                        // Float64Array(N), cumulative infections
  firstDay,                   // Float64Array(N), day of the first local infection, -1 = none
  source,                     // Int32Array(N), node that seeded it, -1 = none or index case
  events,                     // Event[], append-only for the run
  history: { day: [], S: [], E: [], I: [], R: [], D: [], V: [],
             inc: [],         // new infections that day
             detected: [],    // cumulative detected cases
             reff: [],        // global R_eff that day
             regionI: [] },   // per day: Float64Array(7), I by region
  active,                     // { policyId: dayStarted }
  burnedOut,                  // bool
  step(days),                 // advance; appends history once per whole day
  setPolicies(policies),      // live change; triggers re-evaluate next substep
  reffNode(i), reffGlobal(),  // R_eff = R0 x policy x season x climate x S/N
                              // (global: weighted by I)
  totals(),                   // { S, E, I, R, D, V, cases, deaths, detected, pop }
  eventsSince(cursor),        // -> { list: Event[], cursor }
}
Event = { day, from, to, kind: 'air' | 'land', edge, first, blocked }
  // first: the first infection of node `to`; blocked: quarantine stopped it
```

Mechanics (package D implements; tests must hold):
- Per substep, per node, transitions with probability `1 - exp(-rate DT)`.
  Draw with `rng.binom` when the expected count is under 50, else take the
  mean. So the first cases and importations are discrete events and large
  epidemics are smooth.
- Force of infection: `lambda_i = beta_i * (I_i + sum_j C_ij I_j / N_j * N_i) / N_i`
  over land neighbours (C from `net.land.c` x `landMultiplier`),
  `beta = R0 / infectious` x `transmissionMultiplier` x season x climate.
- Vector and flea: Ross-Macdonald host-vector loop with `Iv`; water: the
  reservoir `W`. `R0` is defined at climate and sanitation factor 1.
- Air: per edge per substep, infected travellers ~ Poisson(flow x DT x
  travel x (E + I) / N x airMultiplier). Each traveller swaps with a
  susceptible traveller the other way, so node populations stay fixed. A
  caught traveller (`arrivalCatch`) does not travel; log it with
  `blocked: true`.
- Deaths: `ifr` (x income factor when careSensitive) of I -> removal goes to D.
- Conservation: S+E+I+R+D+V per node is constant (D counted) to 1e-6
  relative.
- `burnedOut`: `day > 30` and the sum of E+I < 0.5 (and the vector or water
  term below its threshold), or `day >= maxDays`.

### geo.js and camera.js (package E)

```js
// geo.js
export function sphere(lat, lon, h = 0) -> [x, y, z]   // radius 1 + h
export function flat(lat, lon, h = 0, proj = 'equirect' | 'equalearth') -> [x, y, z]
export function gcDist(lat1, lon1, lat2, lon2) -> radians
export function arcPoints(a, b, n, lift, mode) -> Float32Array(3n)
  // a, b = { lat, lon }; lift = peak height as a fraction of the angle;
  // mode 'globe' (great circle, height sin(pi t) lift) or a flat projection
  // (projected chord with the same arch on +z; no antimeridian wrap)
export function arcAt(a, b, t, lift, mode) -> [x, y, z]
// camera.js
cam = { lat, lon, alt, tilt, heading }      // degrees, alt as above
export function pose(cam, mode) -> { pos: [x,y,z], target: [x,y,z], up: [x,y,z] }
export function flight(from, to, opts) -> { dur, at(t) -> cam }  // eased great-circle path, capped angular speed
export function ease(t);  // smootherstep
export function spring(cur, target, vel, dt, k) // critically damped, no snaps
```

### Renderer (packages F, G1-G5, H)

```js
// render/globe.js (F)
export function createGlobe(canvas, { D, net, THREE }) -> Globe
Globe = {
  setStyle(id),               // 'night' | 'marble' | 'dots' | 'flat' | 'holo'
  styles,                     // [{ id, label }]
  setCamera(cam),             // camera.js state; the style decides globe or flat pose
  setViewOffset(l, r, t, b),  // the clear area in CSS px (dock, panel, saver plate)
  update(frame),              // per frame, see below
  pick(x, y) -> node index | -1,
  project(i) -> { x, y, visible },  // node to CSS px, for labels
  resize(), dispose(),        // dispose releases every GPU object
  setFade(a),                 // 0..1, for saver cuts
}
frame = { t, dt, sim, prev: Float32Array(N) /* I/N per node */, events: Event[] /* new since last frame */, mode: 'globe' | 'flat' }
```

`createGlobe` owns the `WebGLRenderer` (`antialias: true`), the camera,
the scene, and the shared context it hands to each style and layer:

```js
ctx = { THREE, scene, renderer, camera, D, net, geo, field, mode, root /* THREE.Group the style adds to */ }
// every style module (G1-G5):
export default { id, label, mode: 'globe' | 'flat',
                 create(ctx) -> { group, update(frame), dispose() } }
// render/field.js (F):
export function createField(D, THREE, worldJson) -> {
  texture,        // DataTexture 512x256, R = prevalence glow 0..1 (land only), G = deaths share
  landMask,       // DataTexture 1024x512, 1 on land
  update(prev),   // per node I/N -> texels, about 4 times a second
  dispose() }
// render/arcs.js and render/nodes.js (H):
export function createArcs(ctx) -> { setMode(mode), update(frame), dispose() }
export function createNodes(ctx) -> { setMode(mode), update(frame), dispose() }
```

GPU rules: no EffectComposer and no HalfFloat multisample targets (glow
comes from additive sprites and shaders). `budget.js` caps the drawing
buffer at 2560 x 1440 device px and the pixel ratio at 2 (as
hopf-fibration/budget.js). On `pagehide`, `dispose()` everything and call
`renderer.forceContextLoss()`. Comet and plane pool fixed (512 comets, 12
trail points each). Infected flights come from `frame.events`; ambient
flights are drawn from `net.air.flow` with a visual RNG. A `first` event
gets a brighter comet and a ring burst at the destination. Arcs keep a
per-edge heat that rises with each infected flight and decays, so the
network lights up.

### UI (packages J, K, L)

`ui.js`: `export function createUI(api)`; `api` is the object main.js
passes: `{ getState, setDisease(id | Disease), setPolicies(p), setStyle(id),
play(bool), setSpeed(daysPerSec), restart(seed?), seedAt(nodeIndex),
auto(bool) }`. `ui.update(sim)` refreshes the HUD four times a second.
Layout: the wave-membrane and storm-globe pattern. Desktop: panel at the
left, HUD (day, cases, deaths, R_eff) top right, chart at the base. Phone:
`#dock` (Play, Disease, Policies, View, Auto), the panel as a bottom sheet
(portrait) or a right drawer (landscape), 44 px targets under
`(pointer:coarse)`. Head scripts: gpu-guard, wishlist, stats-beacon, in
that order; importmap `three` -> `../../vendor/three@0.160.0/build/three.module.js`.

`charts.js`: `export function createChart(canvas) -> { draw(history, active, disease), dispose() }`
(2D canvas, log or linear toggle, policy start marks).

`equations.js`: `export const TEX = { seir, reff, coupling, vector, water }`
(TeX strings), `export const RULES` (colour rules for `lib/sci-math.js`),
`export function texFor(disease) -> [tex]` (the variant the disease uses).
Typeset only through `lib/sci-math.js` (MathJax SVG; KaTeX breaks in the
user's Safari).

### director.js and saver.js (package M)

```js
// director.js, no DOM
export const SHOT_KINDS = ['origin', 'export', 'erupt', 'network', 'region', 'flat', 'policy', 'aftermath'];
export function createDirector({ seed, calm = 0.7, styles }) -> Director
Director = {
  newRun() -> { diseaseId, seedNode, policies, startDayOfYear },  // seeded choice, never the same disease twice in a row
  tick(now, view) -> { shot, changed, restart },
  plate(view, disease) -> label info ({ title, sub, params, lines, tex }; no code)
}
view = { day, burnedOut, totals, reff, hottest /* node index */, newestFirst /* Event | null */,
         topRegion, active, D }
shot = { kind, dur /* seconds, 5..12 */, style, cam /* camera.js state */,
         follow: { kind: 'event' | 'node', id } | null, simSpeed /* days per second */, title }
```

`saver.js` installs `window.snSaver = { enter(opts), exit(), debug(), cut(kind) }`
(protocol in `lib/screensaver.js`; `enter` returns `{ canvas, warmupMs }`
with the canvas in the document). It frames the subject in
`plateBand()` from `lib/saver-clear.js`. The on-page Auto button runs the
same director without the shell plate. No code on the plate.

## Done

| Commit | What | Tests |
|---|---|---|
| d8487a5 | `tools/build-nodes.py`, `data/nodes.json` (395 nodes, 7.66 bn), `data.js`, `CREDITS.txt` | data: nodes load; valid coordinates, pop, region, income; world population 7-8.5 billion; every region has nodes; hubs exist |
| (this commit) | `rng.js`, `tests.mjs` runner, `tests/data.test.mjs`, `tests/rng.test.mjs`, this contract | rng: same seed, same stream; poisson mean; binom mean |

## Left: work packages

Each package lists its files (it may create or edit only these), what it
depends on (the interface above is enough to start), and the tests it must
add. Packages in the same wave can run at the same time.

Wave 1 (no dependencies beyond this contract):

- **A. Disease library and sources.** Files: `diseases.js`,
  `tests/diseases.test.mjs`. Tests: every preset id exists; every value is
  in its `ranges`; every `refs` index resolves in `SOURCES`; the schema
  clamps the custom editor (IFR <= 0.6).
- **B. Policy engine.** Files: `policies.js`, `tests/policies.test.mjs`.
  Tests: each contact policy alone lowers `transmissionMultiplier` below 1
  for a disease on a route it applies to, and leaves it at 1 on a route it
  does not; strength 0 gives 1; travel and borders lower only
  international or cross-border edges; triggers start at the threshold.
- **C. Air and land network.** Files: `network.js`,
  `tests/network.test.mjs`. Tests: edges in range, symmetric, no self
  edges; every node reaches every other through air or land; total air
  flow about 12 million a day; deterministic.
- **E. Geometry and camera.** Files: `geo.js`, `camera.js`,
  `tests/geo.test.mjs`. Tests: `sphere` matches the axis convention at
  (0,0), (0,90), (90,0); arcs end at their endpoints and peak at t = 0.5;
  Equal Earth forward values match Savric et al. 2018 (or
  `../map-projections/proj.js`); flights hold their angular speed cap.
- **L. Equations.** Files: `equations.js`, `tests/equations.test.mjs`.
  Tests: braces balance in every TeX string; `texFor` gives the vector
  form for vector diseases.
- **O1. Nav and catalog.** Files: `lib/nav-data.js` (one row: Science >
  Life Sciences, new group "Epidemiology": `["outbreak", "Outbreak", "SIM"]`),
  `lib/screensaver-catalog.js` (`'outbreak': { tier: 3, default: true, hook: true, note }`),
  then `node tools/nav-sync.js` and commit the files it writes. Must not
  add a nav-sync error. Land this after `index.html` exists (wave 3), or
  the page link is dead.

Wave 2 (needs A, B, C):

- **D. Model.** Files: `model.js`, `tests/model.test.mjs`. Tests:
  compartments conserve population per node; one node, no travel,
  R0 = 2 and 3: final size within 0.02 of `finalSizeR`; R_eff falls when
  each contact policy is on; a travel ban lowers the importations into
  new countries over 5 seeds; same seed gives the same history and
  events; SEIRS with waning stays endemic; a cholera run in a high-income
  node grows less than in a low-income node.

Wave 2 (needs E):

- **F. Renderer core.** Files: `budget.js`, `render/globe.js`,
  `render/field.js`, `tests/render.test.mjs` (budget arithmetic and the
  field's node-to-texel weights, no GPU).
- **G1-G5. Globe styles.** One agent per style; each owns one
  `render/style-*.js` and may add `tests/style-<id>.test.mjs` for any
  DOM-free helper. Night (dark globe, city lights tinted, glowing coasts,
  atmosphere rim) is the default and the most striking. Marble: Blue
  Marble with a sun. Dots: about 20k Fibonacci points on land, coloured
  from `field.texture`. Flat: equirectangular and Equal Earth (a
  subdivided plane with forward projection per vertex). Holo: graticule,
  coasts and arcs in cyan lines with scanlines.
- **H. Arcs, planes and city glows.** Files: `render/arcs.js`,
  `render/nodes.js`, `tests/arcs.test.mjs` (pool and heat decay logic,
  no GPU).

Wave 2 (needs only the API shapes):

- **K. Charts.** Files: `charts.js`, `tests/charts.test.mjs` (scale and
  tick helpers).
- **M. Director and saver.** Files: `director.js`, `saver.js`,
  `tests/director.test.mjs`. Tests: every shot lasts 5-12 s; a burned-out
  view yields `restart` after the aftermath shot; two runs never pick the
  same disease in a row; the plate has `tex` and no `code`; the same seed
  gives the same shot list. Test with a stub `view` sequence; a real
  `model.js` run is optional once D lands.

Wave 3 (needs everything above):

- **J. Page shell and UI.** Files: `index.html`, `style.css`, `ui.js`.
  The disease chips, the custom sliders (from `SCHEMA`), the policy
  rows (toggle, strength, trigger), the style chips, the HUD, the region
  table, the about text (honest: a toy metapopulation model, not a
  forecast; values approximate and illustrative), the phone dock and
  sheet.
- **N. Integration.** Files: `main.js`. Boot, frame loop, `occlusion()`
  and `setViewOffset`, the Auto button, pagehide release. Gate:
  `node --check` on every file, node ESM import of every DOM-free module,
  `node tests.mjs`, `deno lint --rules-include=no-undef` filtered for
  browser globals.
- **O2. Thumbnail.** Files: `pages/home/thumbs/outbreak.jpg` (640x400,
  original SVG drawn in the scratchpad, rasterized with `magick`, viewed
  with the Read tool), `pages/home/thumbs/list.js` (add the key in
  sorted order). Commit `home: add the Outbreak thumbnail`.
- **P. Fact-check and credits.** Files: `CREDITS.txt`; may report value
  changes for `diseases.js` and `policies.js` to their owners. Checks each
  citation (authors, year, journal, the value it supports) and the licence
  of every data file.

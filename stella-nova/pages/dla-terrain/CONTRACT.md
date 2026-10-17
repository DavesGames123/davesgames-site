# DLA Terrain page contract

Binding spec for the terrain swarm. Read all of it before you write code.
Also read `stella-nova/lib/GROWTH-PAGES.md` (page rules, commits,
validation) and `stella-nova/PAGES.md` "How to add a page".

## What the user asked for (verbatim, 2026-10-17)

> I'd also like another page on simulating terrain using dlaf, and build
> this into our city generator for terrain. there should be plenty of
> terrain randomization options, combining both DLAF for terrain
> generation and branched flow for river and erosion effects, generating
> vast procedural terrains on this page. this page should be pretty
> fucking awesome.

> dispatch a swarm to make the terrain generator as beautiful as humanly
> possible. add procedurally generated grass, water, rivers, forests, and
> use some of our other shaders from sky to simulate weather conditions ,
> daynight cycle, that terrain generator should relaly pull out all the
> stops

> pull a ton of real human made models from online to get a beautiful
> looking terrain scattered with natural objects

> pull from all the other information that we have on the davesgames site
> to make this as beautiful an experience as possible.

The user judged earlier work on these pages as low effort ("hella
vibecoded", "a oneproompter"). The bar is a AAA landscape: dense,
layered, lit with care, and alive over time (the terrain forms stage by
stage, the sun moves, weather rolls in, grass and trees move in wind).

## Reuse the site

Survey before you write. Take WGSL, maths and ideas from our own pages
(credit them in the file header with the source path). Starting points:
- Sky, stars, sun: `pages/forge/shaders/sky.wgsl`, `atmo-common.wgsl`,
  `clouds.wgsl`, `planet.wgsl`; `pages/city-atlas/shaders/sky.wgsl`,
  `terrain.wgsl`.
- Clouds and weather: `pages/weather-map/shaders/clouds.wgsl` and its
  render/ modules; `pages/volume-noise` (tileable Worley/Perlin, has a
  LICENSE file: obey it); `pages/sdf-clouds` (a port by Alex Foulon:
  read its credits and licence before you reuse a line; ideas only if
  unclear); `pages/storm-globe`.
- Noise, lighting, post: the shader tables `pages/noise-table`,
  `lighting-table`, `postfx-table`, `color-table`, `sampling-table`,
  `frost-table`, `smoke-table`, `fire-table` (cells and pack.wgsl), and
  `pages/sdf-solids-table/shaders/pack.wgsl`.
- Water and flow: `pages/height-field-water`, `pages/tidal-currents`,
  `pages/fluidlab`, `pages/cube_branched_flow/flow.js` (branched flow).
- Plants: `pages/plant-growth` (being reworked now, do not edit it).
- Terrain colour and biomes: `pages/forge` (Planet Forge: maps.js,
  rocky.js, coast.js may hold another session's uncommitted edits, read
  only), `pages/ancient-earth`.
Never copy from a port whose licence is unclear. Never copy from
originkit.dev or bookofshapes.com (see memory rules in PAGES.md).

## Packages

| Package | Owns |
|---|---|
| LIB | `lib/dla-terrain.js`, `lib/dla-terrain-worker.js`, `lib/dla-terrain-detail.wgsl`, `tools/dla-terrain-check.mjs` |
| ASSETS | `stella-nova/assets/nature/**`, `lib/glb-lite.js`, `tools/nature-assets/**` |
| CORE | `pages/dla-terrain/index.html`, `style.css`, `main.js`, `ui.js`, `camera.js`, `saver.js`, `gpu/**`, `shaders/common.wgsl`, `shaders/post.wgsl`, `render/post.js`, `tests.mjs` (shared: others add their own `tests/<pkg>.test.mjs`, CORE's tests.mjs runs every file in tests/) |
| GROUND | `render/ground.js`, `shaders/ground.wgsl` |
| SKY | `render/sky.js`, `sky-state.js`, `shaders/sky.wgsl`, `shaders/clouds.wgsl`, `shaders/weather.wgsl`, `render/weather.js` |
| WATER | `render/water.js`, `shaders/water.wgsl` |
| VEG | `render/vegetation.js`, `scatter.js`, `shaders/grass.wgsl`, `shaders/props.wgsl` |

A package edits only its own files. When you need a change in another
package's file, write the request in `pages/dla-terrain/NOTES.md`
(append a dated line: from, to, what) and work against a local stub.

## Platform

- WebGPU, raw (no three.js). WGSL. gpu-guard.js handles no-WebGPU.
- World units metres, y up. Terrain spans x, z in
  [origin, origin + worldSize]; origin = -worldSize / 2.
- Reverse-Z: `depth32float`, clear 0, compare `greater` (or
  `greater-equal`), infinite far. The sky draws at depth 0.
- HDR scene target `rgba16float`. CORE does bloom, exposure, tonemap
  (AgX or ACES), colour grade, and the swap chain.
- WGSL rules: Chrome (Tint) rejects what naga accepts in mixed `*` / `^`
  and mixed `&&` / `||` without parentheses. Always use parentheses.

## Shared GPU state (CORE writes `shaders/common.wgsl` with exactly this)

```wgsl
struct Globals {
  viewProj: mat4x4f, invViewProj: mat4x4f, view: mat4x4f, proj: mat4x4f,
  prevViewProj: mat4x4f,
  camPos: vec4f,        // xyz camera, w time s
  sunDir: vec4f,        // xyz unit toward the sun, w sun illuminance scale
  sunColor: vec4f,      // rgb sun radiance at ground (after atmosphere), w time of day 0..1 (0.5 noon)
  moonDir: vec4f,       // xyz, w moon illuminance scale
  ambient: vec4f,       // rgb sky irradiance (hemisphere), w exposure
  fog: vec4f,           // rgb in-scatter colour, w density per m
  wind: vec4f,          // xy wind direction * speed m/s, z gust 0..1, w wind phase s
  weather: vec4f,       // x cloud cover, y rain, z snow, w lightning flash 0..1
  weather2: vec4f,      // x ground wetness, y snow cover, z storminess, w season 0..1 (0 spring)
  terrain: vec4f,       // x world size m, y height scale m, z sea level m, w texel size m
  terrainOrigin: vec4f, // xy world xz origin, z min height m, w max height m
  screen: vec4f,        // xy size px, zw 1 / size
  frame: vec4f,         // x frame index, y dt s, z quality 0..1, w is coarse pointer
};
@group(0) @binding(0) var<uniform> G: Globals;
@group(0) @binding(1) var tHeight: texture_2d<f32>;   // r32float, metres, textureLoad only
@group(0) @binding(2) var tNormal: texture_2d<f32>;   // rgba16float: xyz normal, w ambient occlusion
@group(0) @binding(3) var tAux: texture_2d<f32>;      // rgba16float: r log flow, g river 0..1, b moisture, a water depth m
@group(0) @binding(4) var tBiome: texture_2d<u32>;    // r8uint biome id (lib BIOMES)
@group(0) @binding(5) var sLinear: sampler;           // linear, clamp
```
plus helpers `terrainHeight(xz)` (manual bilinear of tHeight +
`detailHeight` from `lib/dla-terrain-detail.wgsl`), `terrainNormal(xz)`,
`terrainAux(xz)`, `biomeAt(xz)`, `worldToUV(xz)`. CORE concatenates
`common.wgsl` + `lib/dla-terrain-detail.wgsl` in front of every
package shader (`gpu.loadWGSL(url)` returns the joined text).

## Module interface (GROUND, SKY, WATER, VEG, post)

```js
export async function createX(gpu) // -> module
gpu = { device, queue, hdrFormat: 'rgba16float', depthFormat: 'depth32float',
        globalsLayout /* group 0 layout */, globalsBindGroup, loadWGSL(url),
        assets /* ASSETS manifest + loader, may be null */, quality /* 0..1 */ }
module = {
  setTerrain(t),                 // t = TerrainGPU, after each generation stage
  update(frame),                 // CPU per frame
  compute?(encoder, frame),      // before the passes
  drawShadow?(pass, frame),      // sun shadow map pass (CORE owns the map)
  drawOpaque?(pass, frame),      // HDR colour + depth, CORE begins the pass
  drawSky?(pass, frame),         // after opaque, depth test at depth 0
  drawWater?(pass, frame, ctx),  // ctx.sceneColorView (copy of opaque+sky), ctx.depthView
  drawVolumetric?(pass, frame, ctx), // clouds, fog, rain, snow; reads ctx.depthView
  resize(w, h, ctx), dispose(),
}
frame = { globals (Float32Array as above), camera {pos, view, proj, ...}, time, dt,
          tod, weather {...skyState fields}, quality, coarse }
TerrainGPU = { n, worldSize, heightScale, seaLevel, heightTex, normalTex, auxTex,
               biomeTex, cpu /* the LIB Terrain object */, stage }
```
CORE owns the shadow map (cascaded, 2 to 4 cascades) and binds it at
group 2 for drawOpaque: `@group(2) @binding(0) tShadow:
texture_depth_2d_array`, `@binding(1) sShadow: sampler_comparison`,
`@binding(2) cascades: CascadeInfo uniform` (CORE writes the struct in
common.wgsl). Packages use group 1 for their own bindings.

## LIB API (lib/dla-terrain.js header must match)

```js
export const BIOMES   // [{ id, key, name, color }]: ocean, beach, desert, savanna, grassland,
                      // temperate forest, rainforest, boreal forest, tundra, bare rock,
                      // snow, wetland, river, lake, scree, alpine meadow
export const OPTIONS  // [{ key, label, group, type: 'range'|'select'|'bool', min, max, step, def, choices }]
                      // groups: World, DLA ridges, Shape, Branched flow, Erosion, Climate, Detail
export const PRESETS  // { id: { label, opts } }: alpine, archipelago, canyonlands, river delta,
                      // fjords, volcanic isles, highlands, mesa desert, rift valley, (more welcome)
export function defaults()
export function randomOptions(seed, base)        // the dice button
export async function generateTerrain(opts, onProgress) // -> Terrain
  // onProgress({ stage, label, frac, snapshot: { n, height, ...optional fields } })
  // stages in order: dla, upscale, shape, flow, rivers, erosion, climate, biomes
  // snapshots let the page show the terrain forming stage by stage
export function detailHeight(x, z, t)           // JS twin of lib/dla-terrain-detail.wgsl
Terrain = { n, worldSize, heightScale, seaLevel, height: Float32Array (m), flow, river,
            water, moisture, temperature, sediment, biome: Uint8Array,
            rivers: [{ pts: Float32Array xz, width: Float32Array, flow: Float32Array }],
            lakes: [{ level, x, z, area }], ridges: [{ pts }], dla: { pos, parent, count },
            stats, stages: [{ id, label, ms }] }
```
Worker protocol (`lib/dla-terrain-worker.js`, module worker):
`{ type: 'generate', id, opts }` -> `{ type: 'progress', id, stage, label, frac, snapshot }`
(typed arrays transferred) ... `{ type: 'done', id, terrain }` or
`{ type: 'error', id, message }`. Vast terrain: `n` up to 2048 over
worldSize up to 64 km; detailHeight adds fractal relief below the texel
size so close views stay rich with no seams.

## ASSETS (real models, all CC0)

Sources: Poly Haven (api.polyhaven.com, CC0 models and textures: trees,
plants, rocks, ground cover, nature), Quaternius and Kenney nature packs
(CC0), ambientCG (CC0 PBR textures). Only CC0 or CC-BY (with credit).
Record every asset in `assets/nature/manifest.json`: id, kind (tree,
bush, rock, boulder, grass, flower, fern, log, stump, mushroom, reed,
cactus, ground texture), biome tags, real height m, footprint m, LOD
files, triangle counts, licence, author, source URL. Write
`assets/nature/CREDITS.txt`.
Process with gltf-transform (npm, in the scratchpad): weld, dedup,
simplify to 3 LODs, textures to webp at 1024 / 512 / 256, no Draco (we
parse GLB ourselves). Bake an octahedral or 8-view impostor atlas per
tree for far LOD (Deno WebGPU bake is allowed). `lib/glb-lite.js`:
DOM-free GLB parser -> { meshes: [{ positions, normals, uvs, tangents?,
indices, material: { baseColor image bytes + mime, normal, orm, alphaMode,
alphaCutoff, doubleSided } }] }. Budget: the whole pack under 120 MB,
under 40 MB for what the default view loads. Ground textures: rock,
cliff, grass, forest floor, sand, snow, mud, gravel (albedo, normal,
roughness/AO), 1024 webp, as a texture array.

## Look targets

- Ground (GROUND): splat by slope, height, moisture, biome and flow;
  triplanar on cliffs; height-blended layers; wet darkening near water
  and in rain; snow by height, slope and the snow-cover uniform; river
  beds and sediment fans tinted from the aux texture; distance blend to
  a macro colour; CDLOD or clipmap mesh with morphing, no cracks;
  shadows from CORE plus terrain self-occlusion (tNormal w).
- Sky (SKY): physically based single-scatter atmosphere (Rayleigh, Mie,
  ozone) for the sky, the sun and moon discs, stars and Milky Way after
  forge sky.wgsl; volumetric clouds (raymarched, weather-map and
  volume-noise ideas) with cover from the weather state; fog with
  height falloff and sun in-scatter; rain streaks, splashes, snowfall,
  lightning flashes with bolt and cloud glow; rainbows when sun and rain
  allow; day-night cycle; `sky-state.js` (DOM-free): `skyState(tod,
  weatherId, season, latitude, t)` -> every Globals field it owns, plus
  WEATHER presets: clear, fair, cloudy, overcast, fog, drizzle, rain,
  thunderstorm, snow, blizzard, golden hour haze; smooth transitions.
- Water (WATER): ocean at sea level with waves (Gerstner or FFT),
  shoreline foam from depth, refraction of the scene colour, screen-space
  plus sky reflection, absorption by depth; rivers as flowing ribbons
  from Terrain.rivers with flow maps, rapids foam on steep sections,
  waterfalls where a river drops; lakes as flat water at their level;
  rain ripples when it rains.
- Vegetation (VEG): GPU grass (blades or clump cards) out to about 80
  m with wind, density from biome, moisture and slope, colour from
  season; forests from ASSETS trees with LOD and impostors to the
  horizon; rocks, boulders, logs, bushes, ferns, flowers, reeds by water,
  cacti in deserts; placement by Poisson disc per biome with clustering
  (forest edges, glades), no trees on steep slopes or in water; shadows
  (drawShadow); wind sway from G.wind; season tint.
- CORE: the frame graph, cascaded shadows, post (bloom, auto exposure,
  tonemap, grade, vignette, light film grain, TAA or FXAA), fly and
  orbit camera with terrain collision and a cinematic drone mode, the
  UI with every LIB option grouped and a dice button per group plus a
  global "Randomise", presets, time of day and weather controls,
  progress of generation shown as the terrain forming stage by stage in
  3D, a 2D map inset (height, biomes, rivers), quality presets, phone
  dock and sheet, and window.snSaver (seeded shots: drone flights over
  ridges and along rivers, time-lapse sunrise, storm rolling in, a
  terrain forming from DLA). Credit dlaf (MIT) and the asset authors.

## Validation

No headless Chrome, Playwright, CDP or browser screenshots. Allowed:
node tests, `~/.cargo/bin/naga` on every WGSL file (after the common
prefix is joined), and Deno WebGPU renders of your shaders to small PNGs
in the scratchpad (`deno run -A`, navigator.gpu) so you can look at your
output. Delete the PNGs when done. Say in each commit body what ran.

## Commits

As in GROWTH-PAGES.md: main, pathspec commits in one command, no add -A,
no amend, rebase or stash, ASD-STE100 bodies, small commits, prefix
`dla-terrain:` (LIB uses `lib:`, ASSETS uses `assets:`). Do not push.

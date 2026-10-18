# Coral reef v3 contract: the ROV dive

Binding spec for the coral v3 swarm. Read all of it before you write
code. The page rules, validation rules and commit rules of
`stella-nova/lib/GROWTH-PAGES.md` still apply (prefix `coral-reef:`).

## What the user asked for (verbatim, 2026-10-17)

> I think you've done a really good job to get the right idea behind the
> coral page however, there's a series of things that I'd like to change.
> The first thing is the photo caustics that are impacting. The bottom of
> the surface are much too regular and need to be more scattered.
> Additionally, I'd like to contain the entire reef within a circular
> area that fades out as we go further it should kind of be like an ROV
> underwater diving scene where we have very dark water lit up by come
> exploratory veseesels exploring it. we should be able to see their
> camera feed through sstv at the bottom right simulated. we should have
> the corals themselves grow much larger and self-interfere, we shouold
> have their strcutrures be mmuch finer and hier polyps much more rdensee.
> the structure that thye're goiwing onw should be randomly geenearated
> rock with texture real stone structures for this little garden to grow
> off of. their whole screensaver mode should feature an ROV analyzing
> one coral growing underwater over time. caustitcs are really extremely
> regula and broken up considerably. the strucutre of the corals is good i
> just want more of hem, finer, and spread out more. the geography
> they/re growing on should be deeply interesting to look a, craggy rocks
> forming archways and natural canyons and such not just generic looks r

Keep what the user liked: the SDF coral structure, the species, the
heatmap gradients and colour modes, the dlaf engine and credit.

## Packages and ownership (stella-nova/pages/coral-reef/)

| Package | Owns |
|---|---|
| ROCK | `terrain.js` (replace), new `rock/*.js`, new rock textures under `assets/tex/rock/`, `tests/rock.test.mjs` |
| CORAL | `reef.js`, `coral-sdf.js`, `mesh-worker.js`, `colour.js`, `tests/coral.test.mjs` |
| ROV | new `rov/*.js` (vehicles, paths, camera feed, SSTV panel), `tests/rov.test.mjs` |
| SCENE | `main.js`, `scene.js`, `shaders.js`, `saver.js`, `shell.js`, `layout.js`, `index.html`, `style.css`, `tests.mjs` (runs every tests/*.test.mjs), `CREDITS.txt` |

Edit only your own files. Requests go in `NOTES.md` (append a dated
line: from, to, what). Commit an early version of your public API with
a documented header in your first hour; others build against it with
stubs until then. SCENE integrates everything at the end.

## The world

- One circular reef plot, radius R (default 30 m, option 20 to 45 m),
  centred at the origin, y up, metres. Past R the rock and sand fade
  into black water over about 0.3 R (geometry thins out and fog takes
  it). There is no visible edge, slab or skirt.
- Very dark deep water. Faint blue downwelling light from above with
  irregular, broken caustics (see SCENE). The main light comes from 2
  or 3 ROVs with spotlights.

## ROCK API (rock/index.js)

```js
createRock({ seed, radius, detail, quality }) -> {
  sdf(x, y, z) -> d,           // signed distance, negative inside rock
  normal(x, y, z) -> [nx, ny, nz],
  meshes: [{ positions, normals, uv?, indices, material }], // chunked
  sand: { heightAt(x, z), mesh },  // sand floor in the hollows
  bounds: { min: [..], max: [..] },
  sampleSurface(n, rng, filter?) -> [{ p, n, exposure, overhang }], // for coral seeds
  features: [{ kind: 'arch'|'canyon'|'pinnacle'|'overhang'|'cave'|'ledge', center, size }],
  textures: { albedo, normal, orm }  // paths to the CC0 stone sets
}
```
Craggy, deeply interesting geology: natural arches, canyons with
undercut walls, pinnacles, overhangs, ledges, boulders, scree and
sand pockets, all from a seeded SDF (layered noise with strata,
domain-warped ridges, carved tunnels and arch tori, Worley crags),
meshed with surface nets or marching cubes (lib/dla-sdf.js `meshField`
or your own) in a worker if it is slow. Textured with real CC0 stone
(Poly Haven or ambientCG rock, cliff and limestone sets; reuse
stella-nova/assets/nature ground sets where they fit) with triplanar
mapping and a strata tint. Test: arches exist (a ray passes under rock
with rock above), canyons exist, the SDF and mesh agree, the mesh is
closed in the plot, and the build time is within budget.

## CORAL changes (reef.js and friends)

Walkers stick to `rock.sdf` and to coral. Many more colonies (30 to
80, by quality), spread over the plot on exposed surfaces from
`rock.sampleSurface`, and much larger (colonies of 1 to 4 m). Finer
structure: smaller particle spacing and tip radius, so thin branches.
Self-interference: all colonies share one nutrient field and one
spatial index, so neighbours compete, overgrow and fuse where they
meet. Polyps much denser on the SDF surfaces. Keep the heatmap modes
and growth over time. Budgets: desktop up to about 120k particles and
2.5M coral triangles, phones much less; grow and mesh in workers.

## ROV API (rov/index.js)

```js
createROVs(THREE, { scene, renderer, rock, reef, count, seed }) -> {
  update(dt, t), vehicles: [{ id, group, lights: [THREE.SpotLight], camera, target }],
  focusOn(point | coloniesId, mode),   // 'survey' | 'inspect' | 'orbit'
  feed: { canvas, setVehicle(id), update(dt) }, // the SSTV panel canvas
  dispose()
}
```
Vehicles: original work-class ROV models (frame, buoyancy block,
thrusters, lights, camera pod, manipulator, tether), procedural or
from CC0 models. Autonomous behaviour: survey paths through canyons and
under arches, hover and inspect corals, avoid rock with the SDF. Each
carries 1 or 2 spotlights (warm white, shadows on the main one) and
lights the marine snow in its beam.

Camera feed: render the lead ROV's camera to a small target (for
example 320x256), then run it through a simulated SSTV link using the
site's own SSTV code in `stella-nova/pages/sstv` (`codec.js`,
`modes.js`, `session.js`: encode to audio samples, add noise, decode
progressively): the picture arrives line by line in a real SSTV mode
(Robot 36 or Martin M1), with noise, slant and the mode and VIS shown.
A HUD around it shows ROV id, depth, heading, time and mode. SCENE
places it bottom right (a smaller tap-to-expand card on phones).

## SCENE

- Dark water look: deep blue-black fog, a circular fade at R, faint
  downwelling, ROV spotlights with volumetric cones (raymarched or
  layered cone sprites with noise), marine snow lit in the beams,
  backscatter, soft shadows from the main spotlight.
- Caustics: irregular and broken up. Compute them from an animated,
  multi-scale random wave surface (refraction of a heightfield, as in
  pages/photon-caustics), add domain warp and large-scale patchiness so
  no grid or regular cell pattern shows; fade them with depth and in
  shadow. Faint, under the ROV lights.
- Wire ROCK, CORAL and ROV; the UI (dock and sheet already exist; keep
  them mobile first); the SSTV feed card bottom right.
- Screensaver: one ROV analyses ONE coral colony growing over time: a
  slow inspection orbit and push-ins as the colony grows from a seed to
  full size, the SSTV feed showing its camera, the plate with live
  colony stats (particles, height, polyps, age). Calm camera moves,
  plateBand framing for 16:9 and 9:16.

## Validation

No headless Chrome, Playwright, CDP or browser screenshots. Node tests
(each package adds tests/<pkg>.test.mjs; SCENE's tests.mjs runs all),
jsdom checks, naga or glslangValidator for shaders, Deno WebGPU or node
rasteriser PNGs in the scratchpad that you look at and delete.

## Commits

Main, small, pathspec commits in one command, no add -A, amend, rebase
or stash, ASD-STE100 bodies with real validation output and a line that
no browser ran, subject `coral-reef: ...` under 72 characters, end with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

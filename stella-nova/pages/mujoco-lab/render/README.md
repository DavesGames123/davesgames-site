# MuJoCo Lab renderer

The renderer draws a MuJoCo Lab sim (`core/engine.js`, `createSim` or
`loadModel`) with three.js. It builds a scene from `mjModel` once, and it
reads `mjData` each frame. It does not step the physics. The page steps
the sim, then calls `R.render()`.

The module does not import three.js. The page gives its THREE: the global
of `vendor/three@0.139.2/build/three.min.js` (the sim kit stage uses it)
or the r160 module. The node tests use r160. The PNG check uses r139.

## Files

    render/renderer.js   createMjRenderer: scene, update, look, cameras, pointer
    render/geoms.js      geometry and material builders from mjModel
    render/overlays.js   instanced pools and the simulate-style overlays
    render/camera.js     free, track and model cameras (MuJoCo z-up terms)
    render/tests.mjs     node checks, no WebGL: node stella-nova/pages/mujoco-lab/render/tests.mjs

## API

```js
import { createMjRenderer } from './render/renderer.js';
const R = createMjRenderer(canvas, S, { THREE, theme: 'night' });
function frame(t) { S.advance(dt); R.render(); requestAnimationFrame(frame); }
```

`createMjRenderer(canvas, sim, opts)`

| opts | default | meaning |
|---|---|---|
| `THREE` | `globalThis.THREE` | the three.js namespace |
| `renderer` | made from `canvas` | an existing `WebGLRenderer`; `null` = no WebGL (tests) |
| `context` | none | a WebGL context for the new renderer (headless-gl) |
| `phone` | `false` | lower pixel ratio, 1024 shadow map, no antialias |
| `shadows` | `true` | key light shadows |
| `theme`, `light`, `fog` | `'night'`, `'studio'`, `true` | the look; ids of the sim kit `THEMES` and stage3d `LIGHTS` |
| `floor` | `'theme'` | `'theme'`: world planes take the theme floor and a grid; `'model'`: the model material and texture |
| `groups` | `[1,1,1,0,0,0]` | geom groups to draw, as in simulate |
| `flags` | see below | overlay flags |
| `interact` | `true` | pointer handlers on the canvas (orbit, pan, zoom, pick, perturb) |
| `onSelect(sel)` | none | called with `{ body, name, point }` or `null` |

The returned `R`:

| Member | Meaning |
|---|---|
| `R.render()` | `update()` then draw |
| `R.update()` | copies poses, skins, flex vertices and overlays from `mjData` into the scene; no allocation when contact overlays are off |
| `R.setSim(S)` | removes the old model scene and builds the new one (the old sim is not disposed) |
| `R.resize(w, h)` | CSS pixels; with no arguments it reads the canvas client size |
| `R.flags`, `R.setFlags(partial)` | overlay flags, below |
| `R.setLook({ theme, light, fog, floor })` | change the look |
| `R.setGroups(arr)` | geom group visibility |
| `R.camera`, `R.cameraNames` | the three camera; names of the model cameras |
| `R.setCamera({ mode, body, index, azimuth, elevation, distance, lookat })` | `mode`: `'free'`, `'track'` (follows `body`), `'model'` (model camera `index`) |
| `R.getCamera()` | `{ mode, body, index, azimuth, elevation, distance, lookat }` |
| `R.resetCamera()` | the model entry camera (`S.entry.camera`) or the model statistic |
| `R.pick(x, y)` | canvas CSS px to `{ body, geom, name, point }` (MuJoCo world) or `null`; world body 0 is not picked |
| `R.select(body)` | highlight a body (or -1) |
| `R.beginPerturb(hit, rotate)`, `R.dragPerturb(x, y, dx, dy)`, `R.endPerturb()` | the mouse spring; the pointer handlers call these |
| `R.perturbing` | `null`, `'translate'` or `'rotate'` |
| `R.stats()` | `{ geoms, meshes, skins, flexes, instances, triangles }` |
| `R.toThree(v, out)`, `R.toMj(v, out)` | MuJoCo z-up to three y-up, and back |
| `R.dispose()` | frees geometry, materials, textures; the renderer too when it made it |

### Flags (`R.flags`)

| Flag | Default | Draws |
|---|---|---|
| `contactPoints` | false | a disc at each contact, normal along `frame[0..2]` |
| `contactForces` | false | an arrow per contact, `mj_contactForce` in world axes, length `|f| * vis.map.force / stat.meanmass`, at most 1.5 `stat.extent` |
| `jointAxes` | false | hinge and slide axes at `xanchor` along `xaxis`, a ball for ball joints |
| `com` | false | body centres of mass (`xipos`), larger for the subtree COM of each root body |
| `inertia` | false | the equivalent inertia box of each body (`xipos`, `ximat`) |
| `actuators` | false | joint and site actuator force arrows, coloured by sign, scaled by the peak force seen |
| `tendons` | true | tendon paths from `wrap_xpos` with `tendon_width` and `tendon_rgba` |
| `constraints` | false | violations in red: penetrating contacts, joints past their limits, connect gaps |
| `frames` | false | body frames (red x, green y, blue z) |
| `transparent` | false | all geoms at 35 % opacity |
| `wireframe` | false | all geoms as wireframe |
| `perturb` | true | the spring line and the target while dragging |

## Pointer

| Gesture | Action |
|---|---|
| drag on a body | mouse spring to the pointer (translate), as simulate Ctrl + right drag |
| Ctrl (or Cmd) + drag on a body | rotate the body toward a target orientation |
| drag on empty space | orbit |
| right drag, or Shift + drag | pan |
| wheel, pinch | zoom |
| double click on a body | select it (and `track` it when the camera mode is `track`) |
| double click on empty space | clear the selection |
| two-finger drag | pan |

The translate spring is `S.perturb` of the core (applied before each
step). The rotate spring is a torque `K I e - 2 sqrt(K) I w` that the
renderer writes into `xfrc_applied` in `update()`, so it changes once
for each frame, not for each step.

## Mapping

A root group turns MuJoCo z-up into three y-up: MuJoCo `(x, y, z)` is
three `(x, z, -y)`. Geom meshes sit in the root group, and their
matrices are `geom_xmat` and `geom_xpos`, written into `matrix.elements`
with `matrixAutoUpdate = false`. Static world geoms are written once.

Geom types: plane (infinite planes get a size from `stat.extent`),
hfield (grid from `hfield_data`), sphere, capsule, ellipsoid, cylinder,
box, mesh (`mesh_vert`, `mesh_face`, `mesh_normal`, `mesh_texcoord`). SDF
geoms are not drawn. The colour is `mat_rgba` when the geom has a
material and the default geom colour, else `geom_rgba`. 2D textures go on
planes and meshes with `mat_texrepeat` and `mat_texuniform`; cube
textures give their mean colour; skyboxes are not drawn (the theme is
the background). Model lights are not used; the theme lights are.

Skins follow `mjv_updateSkin` on the CPU. Flexes draw from
`d.flexvert_xpos`: dim 1 as segments, dim 2 as a two-sided surface, dim 3
as its shell.

## Checks

`node stella-nova/pages/mujoco-lab/render/tests.mjs` builds every model
of the library with r160 and no WebGL, checks the scene against `mjData`,
picking, the perturbation, the overlay counts and the flag toggles.

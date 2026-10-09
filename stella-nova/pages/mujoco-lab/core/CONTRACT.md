# MuJoCo Lab core: contract

The core is the part of the MuJoCo Lab page that has no DOM. The page
(renderer, panel, explainer) and the tests use only the exports below.
Other agents can depend on this file. Changes to an export name or a data
shape get a line in the change log at the end.

## Files

    core/engine.js     MuJoCo WASM load and the sim wrapper
    core/models.js     model library: names, text, cameras, licences, loaders
    core/models/       MJCF files of the library (MuJoCo examples and our own)
    core/procedural.js seeded MJCF scene generator (stacks, ragdolls, chains)
    core/explain.js    explainer data: equations, integrators, citations
    core/tests.mjs     node checks: `node stella-nova/pages/mujoco-lab/core/tests.mjs`
    core/CREDITS.md    sources, commits and licences of every model file

## Engine (`core/engine.js`)

The engine uses the vendored build `stella-nova/vendor/mujoco@3.15.0`
(Apache-2.0, Google DeepMind). The same module runs in node and in the
browser. There is one WASM instance for each realm.

    loadMuJoCo() -> Promise<mj>          cached; call it as many times as you like
    heapBytes() -> number                size of the WASM linear memory
    createSim(mj, { xml, files?, name? }) -> S
        files: { 'path/in/vfs': string | Uint8Array }  (meshes, included XML)
    INTEGRATORS, SOLVERS, CONES          the names that setOptions accepts

The sim object `S`:

| Member | Meaning |
|---|---|
| `S.m`, `S.d`, `S.mj` | raw MjModel, MjData, module (read them, do not delete them) |
| `nq nv nu nbody ngeom time` | sizes and sim time |
| `bodyNames geomNames jointNames actuatorNames sensorNames keyNames` | name arrays, index = MuJoCo id |
| `substeps` | steps for each `step()` call with no argument (default 1) |
| `step(n)` | n steps of `m.opt.timestep`; the perturbation is applied before each step |
| `advance(seconds, speed=1)` | real time to whole steps; the remainder carries to the next call; at most `maxStepsPerFrame` (400) steps |
| `lastStepMs`, `stepCount` | wall time of one step in the last call, total steps |
| `forward()` | `mj_forward` |
| `reset()`, `keyframe(i or name)` | `mj_resetData`, `mj_resetDataKeyframe`, then `mj_forward` |
| `getState()`, `setState(s)` | copies of time, qpos, qvel, act, ctrl |
| `qpos qvel xpos xquat` | live views into WASM memory: copy them if you keep them across a step |
| `geomPoses(out?)` | Float32Array(12 * ngeom): pos(3) + row-major rotation(9) per geom |
| `bodyPoses(out?)` | Float32Array(7 * nbody): pos(3) + quat(w x y z) per body |
| `contacts()` | `[{ pos, normal, frame, dist, geom1, geom2, dim, local, force }]`; `local` is `mj_contactForce` (contact frame, normal first), `force` is the same force in world axes, on geom2 from geom1 (the normal points from geom1 to geom2) |
| `sensors()` | `[{ name, type, value[] }]` |
| `ctrlRange(i)`, `setCtrl(i or name, v)` | the control is clamped to ctrlrange |
| `applyForce(body, f, t)` | writes `xfrc_applied` (world frame, at the body COM) |
| `perturb(body, localPoint, target, k=1)` | a spring from a body point to a world target, as in the simulate app: F = 100 k m_subtree (target - point) - 2 sqrt(100 k) m_subtree v_point; the torque comes from the lever arm to the body COM |
| `setPerturbTarget(target)`, `clearPerturb()`, `perturbBody` | move or release the spring |
| `pointWorld(body, local)`, `worldToLocal(body, world)` | frame changes for picking |
| `options()` | `{ timestep, integrator, solver, iterations, tolerance, gravity, wind, density, viscosity, cone, noslip, impratio }` |
| `setOptions(partial)` | same keys, plus `substeps`; integrator is `Euler RK4 implicit implicitfast`, solver `PGS CG Newton`, cone `pyramidal elliptic`, noslip is the iteration count |
| `energy()` | `[potential, kinetic]` (the energy flag is set at load) |
| `totalMass()` | `mj_getTotalmass` |
| `dispose()` | deletes the contact-force buffer, MjData and MjModel; safe to call twice |

## Models (`core/models.js`)

    MODELS                 array of entries, in menu order (24 entries)
    GROUPS                 group names in menu order
    modelByKey(key)        entry or undefined
    modelFiles(entry, { get?, seed? }) -> Promise<{ xml, files }>
    loadModel(mj, entryOrKey, { get?, seed? }) -> Promise<S>
        S.entry is the entry; S.restart() = reset + the start keyframe
    defaultGet(url, 'text' | 'buf')   fetch in the browser, fs in node

An entry:

    { key, group, name, blurb,
      camera: { azimuth, elevation, distance, lookat: [x, y, z] },   degrees, metres, MuJoCo world (z up)
      source: { name, url, commit, licence, copyright, note?, licenceFile? },
      thumb: 'thumbs/<key>.jpg',           relative to the page folder
      start?: { key: 'keyframe name' },    applied by loadModel and restart
      heavy?: true,                        can run slower than real time on a phone
      seeded?: true,                       build(seed) gives a new scene for each seed
      load: { dir, main } | build(seed) | unitree: {...} }

Mesh files are fetched only when a model loads (no eager download).
`files` keys are VFS paths (for example `assets/link1.stl`). The renderer
reads mesh vertices and faces from the compiled model (`m.mesh_vert`,
`m.mesh_face`, `m.mesh_vertadr`, `m.geom_dataid`), not from the files.

## Procedural scenes (`core/procedural.js`)

    KINDS                        { stacks, ragdolls, chains, mixed } with .name
    generate(kind, seed, opts?)  -> { xml, name, camera, kind, seed }
    chainXML(id, opts)           one hanging chain as nested bodies
    rng(seed)                    mulberry32

The same kind and seed give the same XML, byte for byte (tested).

## Explainer (`core/explain.js`)

    STEPS          [{ id, title, text, tex: [TeX], cite: [id] }]   ten steps of mj_step
    INTEGRATORS    [{ key, name, text, tex, cite }]   keys = engine INTEGRATORS
    SOLVERS, CONES [{ key, name, text }]
    SYMBOLS        [[TeX, meaning]]
    CITATIONS      [{ id, authors, year, title, venue, doi?, url }]
    citation(id)   one formatted line

Typeset the TeX with MathJax (`lib/sci-math.js`). Do not use KaTeX.

## Tests

`node stella-nova/pages/mujoco-lab/core/tests.mjs` (add `--write` to
refresh the table below). It needs no browser and no network.

## Step times

`node core/tests.mjs` writes the table below (see "Step times" in the test
output). Times are wall time of one `mj_step` in node on the build machine.

<!-- STEPTIMES -->
| Model | bodies | dofs | timestep (s) | ms per step | x real time |
|---|---:|---:|---:|---:|---:|
| double-pendulum | 3 | 2 | 0.001 | 0.017 | 57.2 |
| cartpole | 3 | 2 | 0.002 | 0.007 | 272.6 |
| newtons-cradle | 8 | 42 | 0.0001 | 0.026 | 3.9 |
| slider-crank | 4 | 3 | 0.002 | 0.014 | 147.3 |
| gears | 6 | 5 | 0.002 | 0.005 | 372.9 |
| tippe-top | 2 | 6 | 0.001 | 0.023 | 42.9 |
| balls-in-box | 65 | 384 | 0.002 | 0.275 | 7.3 |
| bounce | 4 | 18 | 0.0005 | 0.018 | 27.3 |
| dominoes | 97 | 576 | 0.002 | 0.207 | 9.6 |
| card-house (heavy) | 27 | 156 | 0.002 | 1.607 | 1.2 |
| stonehenge (heavy) | 77 | 456 | 0.002 | 0.845 | 2.4 |
| roman-arch (heavy) | 26 | 150 | 0.006 | 1.647 | 3.6 |
| rope | 31 | 90 | 0.002 | 0.256 | 7.8 |
| cloth (heavy) | 82 | 243 | 0.002 | 0.695 | 2.9 |
| tendon-arm | 3 | 2 | 0.005 | 0.008 | 665.5 |
| balloons | 6 | 30 | 0.002 | 0.142 | 14.1 |
| humanoid | 17 | 27 | 0.005 | 0.080 | 62.5 |
| quadruped | 10 | 14 | 0.005 | 0.031 | 160.0 |
| car | 4 | 8 | 0.002 | 0.012 | 169.3 |
| ragdolls | 46 | 150 | 0.002 | 0.246 | 8.1 |
| panda | 12 | 9 | 0.002 | 0.033 | 61.2 |
| shadow-hand | 27 | 30 | 0.002 | 0.101 | 19.8 |
| go2 | 18 | 18 | 0.002 | 0.158 | 12.7 |
| h1 | 12 | 16 | 0.002 | 0.104 | 19.3 |

Measured 2026-10-09, node v24.12.0, darwin arm64, single thread. Other jobs ran on the machine, and two runs can differ by up to 5 times; use the column to rank models, not as a budget.
<!-- /STEPTIMES -->

## Change log

- 2026-10-09: first version (engine, models, procedural, explain, tests).

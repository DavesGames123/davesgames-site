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

## Step times

`node core/tests.mjs` writes the table below (see "Step times" in the test
output). Times are wall time of one `mj_step` in node on the build machine.

# Planet Collision — engine contract

This file is the API of the physics layer for the render and UI code of
`pages/planet-collision`. The physics layer is step 1 of 3. Steps 2 and 3
(render, UI, screensaver) build on it and do not change it without a test.

All modules are static ES modules with no DOM. Only `engine.js` needs WebGPU.

| File | What it is |
|---|---|
| `data.js` | Code units (`UNIT`, `code`, `si`), Tillotson materials (`MATERIALS`), real bodies (`BODIES`), the source list (`SOURCES`). |
| `eos.js` | The Tillotson EOS in f64: `tillotson`, `soundSpeed`, `uCold`, `temperature`, `vapourWeight`, `matCode`. |
| `build.js` | Hydrostatic body profiles, particle placement, the impact geometry, `buildScenario`. |
| `sph.js` | `makeParams`, the CPU reference solver `CpuSPH`, `boundMass`. |
| `engine.js` | `SphGPU`, the WebGPU solver. `shaders/sph.wgsl` is its code. |
| `scenarios.js` | `PRESETS` (12), `randomScenario(seed)`, `presetByKey`. |
| `budget.js` | `PROFILES`, `pickProfile`, `stepMs`, `stepsPerFrame`, `gpuBytes`. |
| `tests.mjs` | `node tests.mjs` runs the CPU tests, then the GPU tests in Deno. |

## Units

Code units have G = 1. Length is the Earth radius (6371 km). Mass is the
Earth mass (5.9722e24 kg). Then:

| Quantity | One code unit |
|---|---|
| time `UNIT.T` | 805.5 s |
| speed `UNIT.V` | 7.910 km/s |
| density `UNIT.RHO` | 23 095 kg/m^3 |
| specific energy `UNIT.E` | 6.257e7 J/kg |
| pressure `UNIT.P` | 1.445e12 Pa |

Use `si.time(t) / 3600` for hours, `si.vel(v) / 1000` for km/s, and so on.
Temperatures are in K already.

## Life of a run

```js
import { SphGPU } from './engine.js';
import { buildScenario } from './build.js';
import { makeParams } from './sph.js';
import { presetByKey } from './scenarios.js';
import { pickProfile } from './budget.js';

const prof = pickProfile({ phone, touch });             // N, KG
const sim = await SphGPU.create(device, prof.N);       // allocate once, at the cap
const setup = buildScenario(presetByKey('theia'), prof.N, seed);
const prm = makeParams(setup, { KG: prof.KG });
sim.upload(setup, prm);
// relax: about 150-250 steps, over several frames (show "settling")
for (let k = 0; k < 10; k++) sim.relaxSteps(20);      // one call per frame
sim.launch();                                          // velocities + spins, prime
// every frame
sim.encodeSteps(encoder, nSteps);   // or sim.step(nSteps), which submits
// every few frames (async, one read at a time; returns null while busy)
const s = await sim.stats();
// pagehide
sim.destroy(); device.destroy();
```

`upload` takes any setup with `N <= cap`, so a new scenario needs no new
buffers. Call `upload` again, then relax and launch.

Params writes take effect at the next submit. `relaxSteps` and `launch`
submit their own command buffers for that reason. If the page encodes
compute and render into one encoder, call `launch()` first and then encode.

## Setup (`buildScenario(sc, N, seed)`)

| Field | Meaning |
|---|---|
| `N` | particle count |
| `pos`, `vel` | Float64Array 3N, code units (vel is 0 until `launch`) |
| `mass`, `u`, `h` | Float64Array N: particle mass, specific internal energy, smoothing length |
| `mat`, `body` | Uint8Array N: material id (0 iron, 1 granite, 2 basalt, 3 ice), body index (0 target, 1 impactor, up to 3) |
| `bodies[b]` | `{ key, name, M, R (model), Rreal, n, mp, X, V, W, profile }` |
| `impact` | `{ X, V, d0, vesc, vImp, b, theta (deg), tContact, Ekin, QR }`, code units |
| `seed` | the seed of the particle placement |

`impact.tContact` is the time of first contact on the point-mass orbit (code
units). The real first touch comes a little earlier (the bodies have a
smoothing length). Use `stats().touching > 0` for the event.

## GPU buffers (for the render code)

`sim.buf.<name>` are `GPUBuffer`s with `STORAGE | COPY_SRC | COPY_DST`.
A vertex shader can bind them as `var<storage, read>`. One row per
particle; rows `0 .. sim.n - 1` are live; the buffers hold `sim.np` rows.

| Name | Layout per row | Meaning |
|---|---|---|
| `pos` | vec4f | x, y, z (code units), h (smoothing length; the particle "size" is about h) |
| `vel` | vec4f | vx, vy, vz, m |
| `th` | vec4f | rho, P, c (sound speed), Balsara factor |
| `aux` | vec4f | T (K), hNext, nOther (neighbours from another body: the mixing front), xv (vapour weight 0..1) |
| `acc` | vec4f | ax, ay, az (total), du/dt |
| `uu` | f32 | u, specific internal energy (code units) |
| `tag` | u32 | material in bits 0-3, body in bits 4-7 |
| `grav` | 2 x vec4f | g, phi (row 2i); the sum before (row 2i + 1) |

Melt test in a shader: `T > Tmelt` of the material (data.js `MATERIALS`:
iron 1811 K, granite 1500 K, basalt 1400 K, ice 273 K). Vapour: `xv > 0.5`.

The solver writes these buffers in compute passes. A render pass in a later
submit (or later in the same encoder) sees the new values.

## stats() fields

`{ t, dt, steps, tSec, dtSec, maxT, maxPGPa, maxVkms, touching, melt,
vapour, unbound[4], count[4], com[4], unboundMass }`

- `touching`: particles with a neighbour from another body. 0 before contact.
- `melt`, `vapour`: particle counts (T above the melt point; xv > 0.5).
- `unbound[b]`: particles of body b with 1/2 v^2 + phi > 0 (escaping on
  the last gravity sum). `unboundMass` sums them in code mass.
- `com[b]`: the centre of body b's particles (code units, fixed point
  1/256, positions clamped to |x| <= 64), or null for an empty body.
- `maxT` is the single hottest particle. SPH heats the contact surface too
  much (the known "wall heating"), so a plate should show a percentile
  from `readback` or the melt count, not `maxT` alone.

Events for the screensaver cuts (data-driven): contact = `touching` goes
above 0; ejection = `unboundMass` rises; vapour plume = `vapour` rises;
merge = `touching` near the smaller body's count and `com` of the bodies
close. `boundMass(x, v, m, phi, N)` in sph.js finds the remnant from a
`readback(['pos', 'vel', 'grav'])`.

## readback(names)

`await sim.readback(['pos', 'vel', 'th', 'aux', 'uu', 'grav'])` copies
the named buffers out and returns `{ pos: Float32Array, ..., ctl }` (or null
while another read is in flight). About 1 MB per buffer at 60k: use it
for analysis every few seconds, not every frame.

## Physics, in short

- SPH with a Wendland C2 kernel (support 2h, about 82 neighbours),
  density by summation, h from the density of the step before, clamped to
  [hmax / 30, hmax].
- Momentum and energy equations in the symmetric form (Monaghan 1992),
  with the mean kernel gradient of h_i and h_j. Artificial viscosity
  alpha 1.5, beta 3, with the Balsara (1995) shear switch.
- Tillotson EOS (Tillotson 1962; Melosh 1989; Benz & Asphaug 1999) for
  iron, granite, basalt and water ice. No strength, no tension (P >= 0).
- Self-gravity: a direct O(N^2) sum with Plummer softening eps (half the
  smallest surface h), every KG steps, linear extrapolation in time
  between sums. With KG = 1 the energy check is exact to the time step.
- Kick-drift-kick leapfrog, one global time step from the CFL condition
  (0.3 h / v_sig) and the acceleration (0.25 sqrt(h / |a|)), on the GPU.
- Bodies: layered (iron core, rock mantle, ice shell), solved in
  hydrostatic balance on each material's cold compression curve, placed
  in shells of equal-mass particles, then relaxed with damping on the
  GPU.

## Simplifications (label these on the page)

- Particle counts: 8k-60k. Research codes use 1e5-1e8 particles.
- Tillotson is a simple analytic EOS. Research codes use ANEOS or tables.
  Its iron is too soft at core pressures: the model Earth is 6 % small
  (5986 km) with a 551 GPa centre (PREM: 364 GPa).
- Temperature is an estimate, T = 300 K + (u - u_cold) / c_v, with a
  fixed c_v. The bodies start cold (300 K), so all heat shown is impact
  heat. Tillotson has no temperature of its own.
- "Vapour" is the Tillotson blend weight, not a phase calculation.
- No material strength: the bodies are fluids. Right for planets, not for
  bodies below about 1000 km (Vesta, Ceres): label those.
- Gravity is softened (eps about half a particle spacing) and summed every
  KG steps.
- One global time step: the hottest particle sets the step for all. The
  sim time per frame shrinks at the impact (this is not a slow-motion
  effect).
- A small impactor gets at least 12 % of the particles, so its particles
  are lighter than the target's (mass ratio up to about 15).
- No atmosphere, no oceans, no radiative cooling.

## Cost (Apple M4 Pro, Deno WebGPU, `deno run -A tests.mjs --gpu --time`)

About 2.5-3.2 ms per step at 16k, 5.3-7.9 ms at 32k, 9.3-14.8 ms at 49k
(KG 4, two runs; the spread is other load on the machine). The
direct-sum gravity is O(N^2) and limits N; a tree or a particle-mesh
gravity would allow more. Phones: 8k-12k particles. The page should
measure its frame time and use `stepsPerFrame(msPerStep)`.

## Checks

```
node stella-nova/pages/planet-collision/tests.mjs
~/.cargo/bin/naga stella-nova/pages/planet-collision/shaders/sph.wgsl
```

The GPU tests run in Deno (`navigator.gpu`). Do not use headless Chrome.

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
| `scenarios.js` | `PRESETS` (17), `randomScenario(seed)` (dense: masses, compositions, angle, speed, spins), `presetByKey`, `composition`, `titleOf`. |
| `analysis.js` | `outcome(readback, n, bodies)`: the largest body, the disk and the escaping mass (Canup 2004 orbits), T99. |
| `arc.js` | `previewArc(setup)`: the point-mass path of the approach, for the aim panel. |
| `budget.js` | `PROFILES`, `pickProfile`, `stepMs`, `stepsPerFrame`, `gpuBytes`. |
| `render.js` | `Renderer`: the density volume and its iso surface, debris, the smoke volume, sky and post (step 2). `shaders/common.wgsl` + `vol`, `march`, `fluid`, `smooth`, `smoke`; `common` + `scene` + `shade`, `debris`; `centres`, `post`. |
| `optics.js` | The light and matter rules of the renderer on the CPU: the black body (Planck x CIE 1931), Henyey-Greenstein phase, the gas and dust share of a particle (`smokeWeights`), the temperature -> material map (`matterState`, `skinCap`, `crustShare`, `geotherm`). tests.mjs 13 checks them. |
| `view.js` | The camera: the eye looks at the contact point from the side (perpendicular to the approach axis), frames both bodies and the ejecta, the user's orbit as an offset (no DOM). tests.mjs 11 checks it. |
| `main.js`, `index.html`, `style.css` | The page: boot, one run, the frame loop, the bar, the aim panel, the phone dock and sheets, the caption and the outcome numbers. `window.__pc = { S, startRun, frameOf, setSpeed, SPEEDS }`; `S.dir` is the hook for a camera director. |
| `saver-plan.js`, `saver.js` | The screensaver: the seeded reel (presets and five random draws), the shots (approach, slow-motion impact held 8 s past contact, splash, ejecta, then a late cutaway no sooner than 18 s after contact, disk; cut on contact and on escaping mass), the plate text; `window.snSaver` and the director `S.dir`. |
| `tests.mjs` | `node tests.mjs` runs the CPU tests, then the GPU, render and page tests in Deno. |

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

## Render (render.js, step 2)

```js
import { Renderer, loadRenderCode, loadMaps, defaultFrame, classify } from './render.js';
const ren = new Renderer(device, ctx, format, await loadRenderCode());
loadMaps().then(b => ren.setMaps(b));   // tex/*.jpg; grey until then
ren.attach(sim, setup);                 // after every sim.upload
ren.resize(w, h);                       // drawing-buffer px
const f = defaultFrame();               // every field, with defaults
f.eye = [...]; f.target = [...]; f.time = seconds;
ren.render(f);                          // one submit
```

Frame fields (`defaultFrame`): `eye target up fov near time`, `grid` (density volume cells per side; 0 = particle spheres), `vol {c, r}` (the sphere the volume must hold; main.js passes view.js frameTarget's target and rad), `sun sunI`,
`mode` (0 real, 1 temperature, 2 origin body, 3 speed, 4 material),
`cut {on, n, d}` (dot(n, x) > d is cut away; the cut face is flat),
`streakT` (code time of one frame: motion streaks; 0 = off), `smoke {grid, steps, light, detail}` (the smoke volume: cells per side, 0 off; budget.js SMOKE_TIERS), `smokeLive` (false: no smoke passes; main.js before contact), `simT` (sim time, code: the smoke detail flows with it), `frags`
(droplets drawn per debris particle, 1-16; desktop 10, phones 4), `smooth` (filter
iterations), `debrisQ`, `vapK`, `vapGlow`, `xvLo`, `xvHi`, `glowGain`,
`ambient`, `coolH` (sim hours since contact, < 0 before), `bodies[b] {atm, shadow}` (0..1: fade the drawn atmosphere and
the sphere shadow of body b; set both to 0 after the bodies merge),
`flashes [{p, r, I, T}]` (up to 4 impact flashes), `exposure bloom
bloomThreshold vignette`.

Particle classes (common.wgsl `fn klass`, CPU copy `classify(rb, n, hmax)`;
`rb` from `readback(['aux', 'tag', 'th'])`):

| Class | Test | Drawn as |
|---|---|---|
| vapour | `xv > xvHi` (0.5) | the smoke volume only (below) |
| debris | `rho < rho0 / debrisQ^3` (the summed density, `th.x`; 0.24 rho0) | small molten droplets (sphere impostors, radius 0.07-0.19 spacing), `frags` per particle, and streaks; a clump also joins the iso surface |
| fluid | all others | the iso surface of the density volume (vol.wgsl, march.wgsl; debris adds to it too); outside the volume, spheres |

A free particle has a low summed density: that is the debris test. (A test
on h took the whole surface layer of Earth for debris, because those
particles sit at the `hmax` clamp.) The renderer binds `th` for it. Debris droplets are drawn,
not simulated (label this on the page).

What the surface shows (mode 0): the body's surface map at each particle's
start position (the map moves with the material), rock, iron and ice
inside, darkening from 0.7 T_melt, then the glow of a black body at the
skin temperature (common.wgsl `fn glow`, `fn skinT`, `fn lavaSkin`):

- The skin temperature is the particle T, capped at
  1700 K + 2300 K exp(-coolH / 0.6 h) (4000 K at contact, 2100 K at 1 h,
  1700 K late). Free debris uses 0.25 h. The parcel of one particle is
  about 100 km wide, its free surface radiates sigma T^4, and SPH wall
  heating puts 5000-20000 K on the surface: the visible skin is far
  cooler. The solver has no radiative cooling: this is drawn.
- Crust (`fn lavaSkin`): a flowing, domain-warped fbm (two phases of a
  slow drift field, faded across, wall time) in the frame of the target
  body. Where it is under the cover, crust: the cover is
  1.1 (1 - exp(-(coolH + 0.15) / 1.1)) (up to 0.85), less where the melt
  is hot. Ridges of a second warped field crack it with seams, wider
  where hot. Thick crust is at 0.42 of the skin temperature (not under
  700 K), thin crust near a plate edge is hotter, open melt and seams
  stay at the skin temperature. Debris drops carry a crust with the same
  chance. No Voronoi cells.
- Radiance: T^4 from the Draper point (750 K) times `glowGain`, with a
  soft limit at 3 (scene units): orange stays orange after the tone map.

`coolH` (frame field) is the sim hours since the first contact; main.js
sets it, and a negative value (the default) means before contact: no
crust, the 4000 K cap. Bloom: only light over `bloomThreshold` (2.0),
strength 0.035: the hottest melt only.

Tone map and exposure (post.wgsl, optics.js `toneMap`, `adaptExposure`):
the ACES fit on the brightest channel with the channel ratios kept, so
hot melt keeps its hue as it brightens, blended toward the per-channel
fit near white; then sRGB. `cs_expose` meters the lit pixels (sum l^2 /
sum l: the bright parts set it, the sky does not count) and moves the
exposure toward 0.5 / that mean, held to 0.5-1.25, with a 0.8 s time
constant (wall time from `f.time`). `f.exposure` multiplies it;
`f.adapt` false holds it at 1.

Smoke (smoke.wgsl, optics.js `smokeWeights`): each particle has a gas
share (the vapour weight xv from `xvLo` 0.05 to `xvHi` 0.5, or hot,
expanded rock: T 2600-4200 K and rho under 0.6 rho0) and a dust share
(free debris sheds 0.35 of its mass as fine dust; gas under 2400-1800 K
condenses to dust). The drawn gas temperature is the particle T capped
by 2200 K + 3000 K exp(-coolH / 1 h) (2200 K: about the photosphere of a
silicate vapour cloud). The shares go into a 80^3 volume (phones 48^3)
with the temperature, the velocity and the iron share. The march: single
scattering of the sun with the optical depth of a light pass (and the
shadow of the bodies), two Henyey-Greenstein lobes (g 0.62 and -0.22,
weights 0.82 and 0.18), three multiple-scattering octaves, the glow of the
hot remnant as a second light, black-body emission at the gas and dust
temperatures, a brown, grey or white albedo by composition (rock dust,
condensate, hot gas; iron darkens it), and detail: two octaves of a
Perlin-Worley noise, warped by curl noise and carried along the SPH
velocity, that erodes the edges into billows. `vapK` scales the
extinction, `vapGlow` the emission. Drawn, not simulated: the solver has
no radiation, no condensation and no dust.

GPU cost (Apple M4 Pro, Deno, `deno run -A tests.mjs --gpu --time`, the
camera 4 radii from the impact): 5.8 ms per frame at 32k particles and
1600 x 900; 8.3 ms at 12k and 780 x 1688 (a phone screen at pixel ratio
2). The fill rate is the cost: cap the drawing buffer near 2 M px on
desktop and 1 M px on phones.

## Checks

```
node stella-nova/pages/planet-collision/tests.mjs
~/.cargo/bin/naga stella-nova/pages/planet-collision/shaders/sph.wgsl
```

The GPU and render tests run in Deno (`navigator.gpu`, an offscreen
texture). Do not use headless Chrome.

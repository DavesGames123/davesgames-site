# Stella Nova pages

This file is the index of every page of the Stella Nova shell
(`/stella-nova/`). The first part tells you how to add a page. The second
part is the page table. `tools/nav-sync.js` writes the page table from the
registry, so do not edit the text between the `PAGES` markers.

## Where things are

| What | File |
|---|---|
| Page registry (the only one) | `stella-nova/lib/nav-data.js` (`SN_NAV`, `SN_XR`, `SN_CRAFT`, `SN_HIDDEN`) |
| Home text, blurbs, credits, ports | `stella-nova/pages/home/sectors.js` (`SECTOR_TEXT`, `BLURBS`, `CREDITS`, `EXCLUDED`, `DIRECTORY_ONLY`, `FEATURED`) |
| Home search | `stella-nova/pages/home/main.js` (`FIND_ITEMS`, `findResults`, `initFind`) |
| Home thumbnails | `stella-nova/pages/home/thumbs/<key>.jpg`, `thumbs/sm/<key>.jpg` and `thumbs/list.js` |
| Screensaver tiers | `stella-nova/lib/screensaver-catalog.js` |
| Sync and checks | `tools/nav-sync.js` (writes the home blocks and this table) |
| Home tests | `node stella-nova/pages/home/tests.mjs` |

## How to add a page

1. Make the folder `stella-nova/pages/<dir>/` with `index.html`. Put the
   page code in `main.js` and its styles in `style.css`.

2. In the `<head>` of `index.html`, load the site scripts first, in this
   order:

   ```html
   <script src="../../lib/gpu-guard.js"></script>
   <script src="../../lib/wishlist.js"></script>
   <script src="../../lib/stats-beacon.js"></script>
   ```

   Then add `<meta name="viewport" content="width=device-width,
   initial-scale=1.0, viewport-fit=cover">` and a `<meta
   name="description">`. `node tools/wishlist-check.mjs` fails when
   `wishlist.js` is not directly after `gpu-guard.js`.

3. In `style.css`, add `[hidden] { display: none !important; }`. Without
   this rule, a CSS display value can show an element that has the hidden
   attribute, for example a "no WebGPU" message over a working page.

4. Make the page work on a phone: a viewport meta, touch or pointer
   handlers for each drag, and the dock and sheet pattern of
   `pages/wave-membrane` for large control panels. Shader tables import
   `lib/table-mobile.js` and `lib/table-mobile.css`.

5. Register the page. Add one row `[key, label, badge, dir]` to a group in
   `lib/nav-data.js`. `dir` is the folder name. Leave it out when it is the
   same as `key`. Put the page in the constellation and group of its topic.
   Add a new group only when no group fits. A paper explainer goes in
   Science > Research. A page that starts a WebXR session also goes in
   `SN_XR`.

6. Add one short sentence for the page to `BLURBS` in
   `pages/home/sectors.js`. Cards and search results show it.

7. Run `node tools/nav-sync.js`. The tool writes the home colours, chips
   and directory and this table. Then run `node tools/nav-sync.js --check`.
   The check must exit 0. Warnings for a missing blurb or thumbnail do not
   change the exit code, but fix them before you report the page done.

8. Add a home thumbnail: `pages/home/thumbs/<key>.jpg`, 640 x 400, JPEG
   quality 82 to 85, cropped to the subject. After you add the JPEG, build
   `thumbs/list.js` with `node tools/thumbs-list.mjs`. Then make the
   320 x 200 copy `thumbs/sm/<key>.jpg` with `node tools/thumbs-small.mjs`
   (it needs `magick`). Small slots and phones show that copy. Then run
   `node tools/nav-sync.js`. `node tools/thumbs-list.mjs --check` must exit 0.
   Headless Chrome, Playwright, CDP and browser screenshots are not
   permitted on this machine (since 2026-10-07, because they filled the
   disk). Make the image with a render that has no browser, for example a
   Deno script with `navigator.gpu` for a page whose GPU code is in a module
   with no DOM, or a node canvas render. Ask the owner before you start a
   browser.

9. Add a screensaver hook. The page sets `window.snSaver = { enter(opts),
   exit() }`. `enter` gets `{ calm, seconds, caption, seed }` and returns
   `{ canvas, warmupMs }`. The canvas must be in the document. Frame the
   subject in the clear band of the plate with `plateBand(h)` from
   `lib/saver-clear.js`. Cut a seeded shuffle of shots every 5 to 12 s.
   Then add one line to `lib/screensaver-catalog.js`: `tier` 1 to 5, and
   `hook: true` and `default: true` when the hook is done. Ten Minute
   Physics ports use `TMP.saver` from `widgets/ten-minute-physics/kit.js`.

10. Test with node. No browser runs here.
    - `node --check` on each JS file.
    - Load each ES module: `node --input-type=module -e
      "await import('file:///…/pages/<dir>/main.js')"`. A ReferenceError on
      a browser global (`document`, `matchMedia`, `THREE`) is correct. A
      SyntaxError or a missing export is a bug that stops the whole page.
    - Run the `tests.mjs` of the page when it has one, and
      `node stella-nova/pages/home/tests.mjs`.
    - Before you commit, search for elements that have the hidden
      attribute and a CSS display rule.

11. Commit by pathspec in one command: `git add <your paths> && git commit
    -F msg.txt -- <your paths>`. Other sessions commit to main at the same
    time. Do not use `git add -A`, `--amend` or a rebase.

### Ports and licences

A port is a page that runs or translates code that we did not write.

- Read the licence of each upstream file before you copy it. Copy only
  code that has a licence that permits it (MIT, Apache-2.0, BSD, GPL and
  so on). Keep its notice in the copied files, and keep the licence text
  next to the page (`LICENSE`, `COPYING` or `CREDITS.txt`).
- A repository with no licence file, or a file with no licence text, is
  all rights reserved. Do not publish that code. Hold the folder back,
  list it in `UNLISTED` in `tools/nav-sync.js` with the reason, and do not
  commit it. Some sites forbid a port of their ideas or code, for example
  originkit.dev and bookofshapes.com: write our own code from the idea, or
  link to the site only.
- Show the credit on the page: the author, the upstream project, the
  licence and a link. Add the credit line to `CREDITS` in
  `pages/home/sectors.js`. Search then shows the credit and finds the
  page by "port" and by the upstream name.
- A port that the home must not show (no card, rail, star or directory
  entry) also goes in `EXCLUDED`. Search still lists it. A page whose
  origin is not yet confirmed goes in `DIRECTORY_ONLY`: the plain
  directory lists it, and search does not.
- Ten Minute Physics ports (Matthias Müller,
  github.com/matthias-research/pages): the repository has no licence file,
  so each upstream file must carry its own MIT notice. Load
  `widgets/ten-minute-physics/kit.js` and call `TMP.page(info)` for the
  credit bar.

## Page table

<!-- PAGES:BEGIN (written by tools/nav-sync.js; do not edit by hand) -->
213 registered pages in 5 regions and 19 constellations.
Columns: Home = how the home page uses the page (shown; search only for the EXCLUDED ports; directory only).
Saver = lib/screensaver-catalog.js (hook or generic, tier, default list). Thumb = thumbs/list.js names the key.

### Stella Nova

| Key | Title | Constellation > group | Badge | Blurb | Credit | Home | Saver | Thumb |
|---|---|---|---|---|---|---|---|---|
| `home` | Overview | The Game |  | This page: the overview and the chart. |  | shown | no | no |
| `wiki` | Wiki | Game Wiki > Reference | NEW | Every item, module and tech, linked. |  | shown | generic, tier 5 | yes |
| `research` | Research | Game Wiki > Reference | NEW | The tech tree, prerequisite by prerequisite. |  | shown | generic, tier 5 | yes |
| `guide` | Station Guide | Game Wiki > Station Design |  | Every module, room and rule of a station. |  | shown | hook, tier 3 | yes |
| `planner` | Station Planner | Game Wiki > Station Design |  | Lay out a station on the real game grid. |  | shown | hook, tier 3, default | yes |
| `crafting` | Crafting | Game Wiki > Station Design |  | The full tree from ore to reactor core. |  | shown | generic, tier 5 | yes |
| `shipdesigner` (pages/ship-designer) | Ship Designer | Game Wiki > Ship & Identity | NEW | Hull, engines, livery. Build your ship. |  | shown | hook, tier 2, default | yes |
| `flagdesigner` (pages/flag-designer) | Flag Designer | Game Wiki > Ship & Identity | NEW | Design the banner your colony flies. |  | shown | generic, tier 5 | yes |
| `selection` | Selection | Game Wiki > Gameplay |  | How picking and grouping works in game. |  | shown | hook, tier 3, default | yes |
| `behaviors` | Behaviors | Game Wiki > Gameplay |  | The work states behind every citizen. |  | shown | generic, tier 5 | yes |
| `controls` | Controls | Game Wiki > Gameplay |  | Every key and mouse binding. |  | shown | generic, tier 5 | yes |
| `social-dynamics` | Social Dynamics | Game Wiki > Crew & Society | NEW | The named ideas behind crew social life. |  | shown | generic, tier 5 | yes |
| `fortom` (pages/for-tom) | For Tom | Community & Tools > From the Community |  | A tribute page. |  | shown | generic, tier 5 | yes |
| `starward-belt` | Starward Belt | Community & Tools > From the Community | MAP | A player-made map of the belt. |  | shown | hook, tier 3, default | yes |
| `translate` | Translation Tool | Community & Tools > Help Translate | i18n | Help put Stella Nova in your language. |  | shown | generic, tier 5 | no |
| `solar` | Solar Transit Study | Community & Tools > Studio Tools | TOOL | Sun paths for any place and date. |  | shown | generic, tier 5 | yes |
| `matlab` (pages/material-studio) | PBR Material Studio | Community & Tools > Studio Tools | TOOL | Author PBR materials with a live sphere. |  | shown | hook, tier 3, default | yes |
| `pascal-editor` | Pascal Editor | Community & Tools > Studio Tools | TOOL | Pascal, the open-source 3D building editor. |  | shown | no | no |
| `sci-tools` | Science Toolkit | Community & Tools > Studio Tools | TOOL | Units, constants, statistics, fits and chemistry in one offline page. |  | shown | no | yes |
| `flight-board` | Flight Board | Community & Tools > Live Data | LIVE | A split-flap board for any airport, from live ADS-B. |  | shown | no | no |

### Science

| Key | Title | Constellation > group | Badge | Blurb | Credit | Home | Saver | Thumb |
|---|---|---|---|---|---|---|---|---|
| `hohmann` | Hohmann Transfer | Space & Gravity > Planets & Orbits | SIM | Plan the cheapest burn between two orbits. |  | shown | hook, tier 3, default | yes |
| `leo` (pages/leo-catalog) | LEO Catalog | Space & Gravity > Planets & Orbits | NEW | Thousands of real satellites in low orbit. |  | shown | hook, tier 3, default | yes |
| `gravity` | Gravity Sim | Space & Gravity > Planets & Orbits | SIM | A Barnes-Hut n-body sandbox. Fling planets. |  | shown | hook, tier 2, default | yes |
| `forge` | Planet Forge | Space & Gravity > Planets & Orbits | GPU | Sculpt and paint a planet from noise. |  | shown | hook, tier 3, default | yes |
| `roche-limit` | Roche Limit | Space & Gravity > Planets & Orbits | SIM | An icy moon crosses the Roche limit and becomes a ring. |  | shown | hook, tier 4, default | yes |
| `galaxy` | Galaxy | Space & Gravity > Deep Space | SIM | A spiral galaxy that holds its own arms. |  | shown | hook, tier 1, default | yes |
| `blackhole` | Black Hole | Space & Gravity > Deep Space | GPU | Gravitational lensing around a Schwarzschild hole. |  | shown | hook, tier 1, default | yes |
| `wormhole` (pages/ellis-wormhole) | Wormhole | Space & Gravity > Deep Space | GPU | Fly through an Ellis wormhole. |  | shown | hook, tier 2, default | yes |
| `chandrasekhar-limit` | Chandrasekhar Limit | Space & Gravity > Deep Space | NEW | Why no white dwarf weighs more than 1.4 Suns. |  | shown | hook, tier 4, default | yes |
| `orbital` (pages/atomic-orbital-vr) | Atomic Orbital | Quantum > Atoms | VR | Hydrogen orbitals in 3D, VR ready. |  | shown | hook, tier 2, default | yes |
| `hydrogen-table` | Hydrogen Wave Function | Quantum > Atoms | NEW | Every hydrogen wave function, side by side. |  | shown | hook, tier 3, default | yes |
| `exotic-atoms` | Exotic Atoms | Quantum > Atoms | NEW | Rydberg giants to n = 300, positronium, trilobite molecules and the field of the electron cloud. |  | shown | hook, tier 4, default | no |
| `qave` (pages/quantum-algorithm-visualizer) | Quantum Algorithm Visualizer | Quantum > Quantum Computing | 3D | Quantum algorithms step by step in 3D. |  | directory only | hook, tier 2, default | no |
| `qft-flow` | Quantum Encoding | Quantum > Quantum Computing | MATH | Four qubit phase knobs and the spectrum a QFT reads out. |  | shown | no | yes |
| `qft-store` | Quantum Decoding | Quantum > Quantum Computing | DATA | Write bytes into qubit rotation angles and read them back. |  | shown | generic, tier 5 | yes |
| `frqi` (pages/frqi-quantum-image-lab) | Quantum Image Encoding | Quantum > Quantum Computing | IMG | Store an image in qubits with FRQI, layer by layer. |  | shown | hook, tier 3, default | yes |
| `particle-collider` | Particle Collider | Quantum > Particle Physics | SIM | Collide two particles and trace the products. |  | shown | hook, tier 4, default | yes |
| `periodic-table` | Periodic Table | Chemistry > The Elements | NEW | Eleven shapes of the table, and the live atom of every element. |  | shown | hook, tier 4, default | yes |
| `molecular-bond` | Molecular Bond | Chemistry > Molecules & Reactions | SIM | Watch two atoms share an electron. |  | shown | hook, tier 3, default | yes |
| `molecules` | Molecule Explorer | Chemistry > Molecules & Reactions | 2D/3D | Over a thousand molecules, skeletal formula beside 3D. |  | shown | hook, tier 3, default | yes |
| `reactions` | Reaction Explorer | Chemistry > Molecules & Reactions | NEW | Watch molecules change in 3D through famous syntheses. |  | shown | hook, tier 3, default | yes |
| `protein-viewer` | Protein Structure | Life Sciences > Proteins | 3D | Real protein structures in 3D, 37 presets. |  | shown | hook, tier 3, default | yes |
| `protein-folding` | Protein Folding | Life Sciences > Proteins | SIM | Watch a chain fold into its native shape. |  | shown | hook, tier 2, default | yes |
| `virus-atlas` | Virus Atlas | Life Sciences > Viruses & Prions | 3D | Real virus capsids from the PDB: assemble, peel, explode. |  | shown | hook, tier 4, default | yes |
| `human-skull` | Human Skull | Life Sciences > Anatomy | 3D | A human skull in 51 parts, pulled apart. |  | shown | hook, tier 3, default | yes |
| `human-skeleton` | Human Skeleton | Life Sciences > Anatomy | 3D | Explode a skeleton and inspect all 200 bones. |  | shown | hook, tier 3, default | yes |
| `ct-explained` | How CT Works | Life Sciences > Medical Imaging | NEW | How CT works, from X-ray shadows to slices. |  | shown | hook, tier 3, default | yes |
| `ct-lab` | CT Lab | Life Sciences > Medical Imaging | LAB | Scan phantoms, fill the sinogram, break the image. |  | shown | hook, tier 4, default | yes |
| `ct-lab-3d` | CT Lab 3D | Life Sciences > Medical Imaging | NEW | CT scan a real walnut, a rabbit, a skull or a mosquito in amber, then slice it. |  | shown | hook, tier 4, default | yes |
| `neuron-lab` | Neuron Lab | Life Sciences > Neuroscience | SIM | A 3D neuron: watch a spike run along its branches. |  | shown | hook, tier 3, default | yes |
| `neuron-network` | Neural Network | Life Sciences > Neuroscience | SIM | A cortical column of spiking cells in a gamma rhythm. |  | shown | hook, tier 3, default | yes |
| `ancient-earth` | Ancient Earth | Life Sciences > Deep Time | 3D | The Earth from 540 million years ago to today. |  | shown | hook, tier 3, default | yes |
| `outbreak` | Outbreak | Life Sciences > Epidemiology | SIM | Diseases spread between cities on a 3D globe (a toy model). |  | shown | hook, tier 3, default | yes |
| `fluidlab` | Stable Fluids | Fluids > Flow | GPU | Jos Stam stable fluids on the GPU. |  | shown | hook, tier 2, default | yes |
| `wind-tunnel` | Wind Tunnel | Fluids > Flow | CFD | Lattice Boltzmann flow around a cow, a car or a wing. |  | shown | hook, tier 3, default | yes |
| `euler-fluid` | Euler Fluid | Fluids > Flow | SIM | A grid fluid in 200 lines: wind tunnel, tank and paint. | Ten Minute Physics #17 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `flip-fluid` | FLIP Water | Fluids > Flow | SIM | FLIP water: particles carry it, a grid solves the pressure. | Ten Minute Physics #18 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `pbf-boundary` | PBF Boundaries | Fluids > Flow | SIM | Position based particles with moving walls and friction. | Ten Minute Physics contribution by Sergii Biloshytskyi, for Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `fire-simulation` | Fire Simulation | Fluids > Flow | SIM | Fire from a grid fluid: heat and smoke rise and swirl. | Ten Minute Physics #21 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `tidal-currents` | Tidal Currents | Fluids > Earth & Ocean | DATA | Real tidal current data, animated. |  | shown | hook, tier 2, default | yes |
| `city-atlas` | City Atlas | Fluids > Earth & Ocean | 3D | Twenty-one 3D cities with real terrain, currents and wind. |  | shown | hook, tier 3, default | yes |
| `map-generator` | City Generator | Fluids > Earth & Ocean | 3D | Grow a procedural city from a seed (after MapGenerator). |  | shown | hook, tier 3, default | yes |
| `storm-globe` | Storm Globe | Fluids > Earth & Ocean | DATA | Today’s storms on a globe of real GFS winds. |  | shown | hook, tier 3, default | yes |
| `map-projections` | Map Projections | Fluids > Earth & Ocean | MATH | 26 map projections, Tissot circles and a true-size tool. |  | shown | hook, tier 3, default | yes |
| `ns-equations` | Navier–Stokes 1D | Fluids > Navier–Stokes | MATH | The Navier-Stokes terms one at a time in 1D. |  | shown | generic, tier 5 | yes |
| `ns-burgers` | Burgers Equation | Fluids > Navier–Stokes | SIM | Shocks form in the Burgers equation. |  | shown | hook, tier 3, default | yes |
| `ns-flow2d` | Navier–Stokes 2D | Fluids > Navier–Stokes | SIM | Navier-Stokes on a 2D grid. |  | shown | hook, tier 3, default | yes |
| `ns-flow3d` | Navier–Stokes 3D | Fluids > Navier–Stokes | SIM | Navier-Stokes in a 3D box. |  | shown | hook, tier 3, default | yes |
| `ns-wave` | Blowup: Wave | Fluids > Blowup | MATH | The blowup question through a wave model. |  | shown | hook, tier 3, default | yes |
| `ns-geometry` | Blowup: Geometry | Fluids > Blowup | SIM | The blowup question through the geometry of the flow. |  | shown | hook, tier 3, default | yes |
| `ns-vortex` | Blowup: Vortex | Fluids > Blowup | 3D | A vortex that may blow up. |  | shown | hook, tier 2, default | yes |
| `magnetlab` | MagnetLab | Light & Fields > Electromagnetism | NEW | Drag magnets and see the field lines. |  | shown | hook, tier 2, default | yes |
| `biot-savart` | Biot–Savart Law | Light & Fields > Electromagnetism | NEW | The field around a current. |  | shown | hook, tier 2, default | yes |
| `maxwell` (pages/maxwells-equations) | Maxwell's Equations | Light & Fields > Electromagnetism | NEW | The four equations, animated. |  | shown | hook, tier 3, default | yes |
| `twenty-to-four` | Twenty to Four | Light & Fields > Electromagnetism | NEW | A field study in four panels. |  | shown | hook, tier 2, default | yes |
| `smith-chart` | Smith Chart | Light & Fields > Electromagnetism | NEW | Impedance on the Smith chart. |  | shown | hook, tier 3, default | yes |
| `antenna-fields` | Antenna Fields | Light & Fields > Electromagnetism | NEW | Radio waves leave a dipole, a loop and an array. |  | shown | hook, tier 4, default | yes |
| `sstv` | Slow-Scan Television | Light & Fields > Electromagnetism | NEW | Slow-scan television: a picture sent as sound, decoded live. |  | shown | hook, tier 3, default | yes |
| `diffraction` (pages/diffraction-lab) | Aperture Diffraction | Light & Fields > Optics | NEW | Light through an aperture. |  | shown | hook, tier 3, default | yes |
| `double-slit` | Double-Slit Diffraction | Light & Fields > Optics | NEW | Interference, one photon at a time. |  | shown | hook, tier 2, default | yes |
| `polarization` (pages/circular-polarization) | Circular Polarization | Light & Fields > Optics | NEW | Watch a wave twist as it travels. |  | shown | hook, tier 2, default | yes |
| `photon-caustics` | Photon Caustics 2D | Light & Fields > Optics | GPU | Trace photons through mirrors, lenses and water and watch caustics form, in 2D and in a 3D pool. |  | shown | hook, tier 3, default | yes |
| `photon-caustics-3d` | Photon Caustics 3D | Light & Fields > Optics | GPU | Sunlight through waves draws caustics on a pool floor. |  | shown | hook, tier 3, default | yes |
| `attractorlab` | Strange Attractors | Patterns & Chaos > Chaos | 3D | Lorenz, Rossler, Thomas and friends. |  | shown | hook, tier 2, default | yes |
| `flowlab` | Vector Fields | Patterns & Chaos > Chaos | SIM | Flow lines through vector fields. |  | shown | hook, tier 2, default | yes |
| `julia-fractals` | Julia Fractals | Patterns & Chaos > Chaos | SIM | Julia and Mandelbrot sets, zoom and explore. | Ten Minute Physics #19 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `reaction-diffusion` | Reaction–Diffusion | Patterns & Chaos > Emergence | GPU | Gray-Scott patterns that grow and split. |  | shown | hook, tier 3, default | yes |
| `lenia` | Lenia | Patterns & Chaos > Emergence | GPU | Continuous cellular life. |  | shown | hook, tier 3, default | yes |
| `game-of-life` | Game of Life | Patterns & Chaos > Emergence | SIM | Conway’s Life on the GPU, with a pattern library. |  | shown | hook, tier 2, default | yes |
| `ulam-spiral` | Ulam Spiral | Patterns & Chaos > Number Theory | GPU | Primes form lines in the Ulam spiral and 21 more layouts. |  | shown | hook, tier 3, default | yes |
| `ramanujan-pi` | Ramanujan–Sato Series | Patterns & Chaos > Number Theory | MATH | Race Ramanujan-Sato series for pi, digit by digit. |  | shown | hook, tier 3, default | yes |
| `hopf-fibration` | Hopf Fibration | Patterns & Chaos > Geometry & Topology | GPU | The 3-sphere as linked circles, in 3D. |  | shown | hook, tier 4, default | yes |
| `dice` | Dice Lab | Patterns & Chaos > Probability | 3D | Physics dice from d4 to d20, tested for fairness. |  | shown | hook, tier 3, default | yes |
| `chordlab` | ChordLab | Sound & Vibration > Music | MIC | Sing or play: it names the chord live. |  | shown | generic, tier 5 | yes |
| `string-lab` | String Lab | Sound & Vibration > Music | 3D | Pluck, strum and bow a guitar and a violin in slow motion and see the harmonic ratios. |  | shown | hook, tier 3, default | yes |
| `chordchart` (pages/chord-chart) | Chord Chart | Sound & Vibration > Music | NEW | Every chord shape on one chart. |  | shown | generic, tier 5 | yes |
| `harmonywheel` (pages/harmony-wheel) | Harmony Wheel | Sound & Vibration > Music | NEW | The circle of fifths you can spin. |  | shown | hook, tier 3 | yes |
| `resonance-figure` | Resonance Figure | Sound & Vibration > Resonance | NEW | Lissajous figures from two tones. |  | shown | hook, tier 1, default | yes |
| `resonance-table` | Resonance Table | Sound & Vibration > Resonance | NEW | Resonance figures for every mode. |  | shown | generic, tier 5 | yes |
| `resonance-3d` | Resonance 3D | Sound & Vibration > Resonance | 3D | Resonance figures in 3D. |  | shown | hook, tier 2, default | yes |
| `wave-membrane` | Standing Wave Membrane | Sound & Vibration > Resonance | SIM | Chladni modes of a vibrating drum. |  | shown | hook, tier 2, default | yes |
| `chladni-plate` | Chladni Plate | Sound & Vibration > Resonance | NEW | Sand finds the nodal lines of guitar and violin tops. |  | shown | hook, tier 3, default | yes |
| `stirling-engine` | Stirling Engine | Machines > Engines | 3D | A Stirling engine cut open, with a live P-V loop. |  | shown | hook, tier 3, default | yes |
| `four-stroke-engine` | Four-Stroke Engine | Machines > Engines | 3D | An inline four, exploded: crank, valves, Otto cycle. |  | shown | hook, tier 3, default | yes |
| `wankel-engine` | Wankel Rotary Engine | Machines > Engines | 3D | A Wankel rotor in its epitrochoid, three chambers live. |  | shown | hook, tier 3, default | yes |
| `radial-engine` | Radial Engine | Machines > Engines | 3D | A radial aero engine cut away: master and link rods. |  | shown | hook, tier 3, default | yes |
| `differential` | Differential | Machines > Gears & Transmissions | 3D | A rear axle opened up: open, clutch and Torsen units. |  | shown | hook, tier 3, default | yes |
| `planetary-gearbox` | Planetary Gearbox | Machines > Gears & Transmissions | 3D | Hold the sun, carrier or ring; then a Simpson set. |  | shown | hook, tier 3, default | yes |
| `manual-gearbox` | Manual Gearbox | Machines > Gears & Transmissions | 3D | A five-speed gearbox cut open: shift and watch the synchros lock each gear. |  | shown | hook, tier 3, default | yes |
| `harmonic-drive` | Harmonic & Cycloidal Drives | Machines > Gears & Transmissions | 3D | The reducers inside robot joints: a flexing strain wave gear and a cycloidal drive. |  | shown | hook, tier 3, default | yes |
| `gear-types` | Gear Types | Machines > Gears & Transmissions | 3D | Spur, helical, bevel, worm and rack gears in 3D. |  | shown | hook, tier 3, default | yes |
| `cvt` | CVT | Machines > Gears & Transmissions | 3D | A push-belt CVT and a toroidal drive change ratio. |  | shown | hook, tier 3, default | yes |
| `universal-joints` | Universal & CV Joints | Machines > Gears & Transmissions | 3D | Cardan joints, their ripple, and a Rzeppa CV joint. |  | shown | hook, tier 3, default | yes |
| `ball-screw` | Ball Screw & Lead Screw | Machines > Gears & Transmissions | 3D | Lead screw against ball screw: travel, balls, efficiency. |  | shown | hook, tier 3, default | yes |
| `geneva-cams` | Geneva Drive & Cams | Machines > Linkages & Cams | 3D | Turn steady rotation into steps: a Geneva drive and a disc cam in 3D. |  | shown | hook, tier 3, default | yes |
| `linkages` | Linkages | Machines > Linkages & Cams | 3D | Bars and pins that draw curves, a true straight line, and a walking step. |  | shown | hook, tier 3, default | yes |
| `spirograph` | Spirograph | Machines > Linkages & Cams | NEW | Toothed gears draw hypotrochoids and epitrochoids. |  | shown | hook, tier 2, default | yes |
| `ratchets` | Ratchets & Freewheels | Machines > Linkages & Cams | 3D | Ratchet, sprag clutch and freehub: drive one way, slip the other. |  | shown | hook, tier 3, default | yes |
| `sewing-machine` | Lockstitch Sewing Machine | Machines > Linkages & Cams | 3D | A lockstitch machine: needle, hook, bobbin and feed dog. |  | shown | hook, tier 3, default | yes |
| `watch-movement` | Watch Movement | Machines > Timekeeping | 3D | A pocket watch that runs, then comes apart. |  | shown | hook, tier 3, default | yes |
| `watch-randomizer` | Timepiece Randomizer | Machines > Timekeeping | 3D | Roll a pocket watch, wristwatch, wall clock or alarm clock. |  | shown | hook, tier 3, default | yes |
| `pendulum-clock` | Pendulum Clock | Machines > Timekeeping | 3D | Three escapements on a pendulum clock, simulated. |  | shown | hook, tier 3, default | yes |
| `antikythera` | Antikythera Mechanism | Machines > Timekeeping | 3D | The Antikythera gear train, cranked day by day. |  | shown | hook, tier 3, default | yes |
| `pumps` | Positive-Displacement Pumps | Machines > Pumps | 3D | Gear, vane and Roots pumps move fluid pockets. |  | shown | hook, tier 3, default | yes |
| `swashplate-pump` | Swashplate Piston Pump | Machines > Pumps | 3D | An axial piston pump on a tilted swashplate. |  | shown | hook, tier 3, default | yes |
| `calculators` | Pascaline & Curta | Machines > Calculating & Cipher | 3D | The Pascaline and the Curta carry digit by digit. |  | shown | hook, tier 3, default | yes |
| `curta` | Curta Calculator | Machines > Calculating & Cipher | 3D | The Curta calculator in 3D, part by part. |  | shown | hook, tier 3, default | yes |
| `enigma-rotors` | Enigma Rotors | Machines > Calculating & Cipher | 3D | The Enigma rotor stack, from key to lamp. |  | shown | hook, tier 3, default | yes |
| `pin-tumbler-lock` | Pin Tumbler Lock | Machines > Calculating & Cipher | 3D | Key in: each pin stack splits on the shear line. |  | shown | hook, tier 3, default | yes |
| `cannonball-2d` | Cannonball 2D | Machines > Motion & Collisions | SIM | A ball under gravity in a box: physics in a few lines. | Ten Minute Physics #1 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `cannonball-3d` | Cannonball 3D | Machines > Motion & Collisions | 3D | The cannonball in 3D: balls bouncing in a box. | Ten Minute Physics #2 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `cannonball-vr` | Cannonball VR | Machines > Motion & Collisions | VR | The 3D cannonball box in a VR headset. Needs WebXR. | Ten Minute Physics #2 by Matthias Müller (MIT) | shown | hook, tier 3 | yes |
| `billiard` | Billiard | Machines > Motion & Collisions | SIM | Many balls collide; set the restitution from elastic to dead. | Ten Minute Physics #3 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `pinball` | Pinball | Machines > Motion & Collisions | SIM | A playable pinball table: flippers, bumpers and borders. | Ten Minute Physics #4 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `spatial-hashing` | Spatial Hashing | Machines > Motion & Collisions | 3D | Thousands of balls collide, found fast by a spatial hash. | Ten Minute Physics #11 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `pendulum-short` | Pendulum in 100 Lines | Machines > Pendulums & Constraints | SIM | A chaotic pendulum, complete in about a hundred lines. | Ten Minute Physics #6 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `triple-pendulum` | Triple Pendulum | Machines > Pendulums & Constraints | SIM | A chaotic multi-link pendulum with position based dynamics. | Ten Minute Physics #6 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `bead-on-wire` | Bead on a Wire | Machines > Pendulums & Constraints | SIM | A bead held on a circular wire, against the exact solution. | Ten Minute Physics #5 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `many-beads` | Many Beads | Machines > Pendulums & Constraints | SIM | Many beads collide on one circular wire. | Ten Minute Physics #5 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `joints` | Joint Simulation | Machines > Pendulums & Constraints | 3D | Hinges, ball joints and a steering linkage with XPBD. | Ten Minute Physics #25 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `rigid-bodies` | Rigid Bodies | Machines > Pendulums & Constraints | 3D | Stacks, chains and collisions of rigid bodies in 3D. | Ten Minute Physics #22 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `soft-bodies` | Soft Bodies | Machines > Soft Bodies & Cloth | 3D | Squash and throw tetrahedral soft bunnies (XPBD). | Ten Minute Physics #10 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `soft-body-interaction` | Grab Interaction | Machines > Soft Bodies & Cloth | 3D | Pick up and throw a simulated body with the mouse. | Ten Minute Physics #8 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `soft-body-skinning` | Soft Body Skinning | Machines > Soft Bodies & Cloth | 3D | A detailed dragon skinned to a coarse soft body. | Ten Minute Physics #12 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `cloth` | Cloth | Machines > Soft Bodies & Cloth | 3D | Fast, stable XPBD cloth with bending. | Ten Minute Physics #14 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `cloth-self-collision` | Cloth Self-Collision | Machines > Soft Bodies & Cloth | 3D | Cloth that folds onto itself and does not pass through. | Ten Minute Physics #15 by Matthias Müller (MIT) | shown | hook, tier 3, default | yes |
| `origami` | Origami Simulator | Machines > Folding | SIM | Draw a crease pattern and watch it fold. |  | directory only | hook, tier 3, default | no |
| `mujoco-lab` | MuJoCo Lab | Machines > Physics Engines | NEW | The MuJoCo physics engine live: robots, ragdolls, dominoes and cloth. |  | shown | hook, tier 4, default | yes |
| `lose-the-modifier` | Lose the Modifier | Language > Writing | WORDS | Turn “very tired” into one strong word. |  | shown | hook, tier 4, default | yes |
| `gravitational-imaging` | Gravitational Imaging | Research > Astrophysics | NEW | A million Suns of dark mass, found by the dent it makes in a lensed arc. |  | shown | no | no |
| `circular-rydberg` | Circular Rydberg Atoms | Research > Atomic Physics | NEW | Giant circular electron orbits that lived 11 ms at room temperature. |  | shown | hook, tier 3, default | yes |
| `alphafold` (pages/alphafold-explained) | How AlphaFold Works | Research > Machine Learning | ML | How AlphaFold turns a sequence into a structure. |  | shown | hook, tier 3, default | yes |
| `4d-codebench` | 4DCodeBench | Research > Machine Learning | NEW | Can coding agents rebuild a moving scene from video? Play the benchmark in your browser. |  | shown | no | yes |
| `enzyme-design` | De Novo Enzyme Design | Research > Machine Learning | NEW | Design an enzyme from scratch: hold the chemistry still and grow a protein around it. |  | shown | no | yes |
| `legged-rl` | Legged Robot Gym | Research > Machine Learning | NEW | Walking robot policies in MuJoCo, in your browser. |  | shown | hook, tier 4, default | yes |
| `mrna-vaccine` | The mRNA Vaccine | Research > Medicine | NEW | The decades of science behind the 2020 mRNA vaccines. |  | shown | hook, tier 3, default | yes |

### Graphics

| Key | Title | Constellation > group | Badge | Blurb | Credit | Home | Saver | Thumb |
|---|---|---|---|---|---|---|---|---|
| `noise` (pages/noise-table) | Noise Table | Shader Tables > Patterns | WGSL | Perlin, simplex, Worley and more, live. |  | shown | hook, tier 2 | yes |
| `volume-noise` | Volume Noise | Shader Tables > Patterns | WGSL | Tileable 3D Perlin-Worley noise for clouds, in WGSL. | TileableVolumeNoise by Sébastien Hillaire (MIT) | search only | hook, tier 3, default | yes |
| `fields` (pages/field-table) | Field Table | Shader Tables > Patterns | COMPUTE | Compute-shader fields and flows. |  | shown | hook, tier 2, default | yes |
| `sims` (pages/simulation-table) | Simulation Table | Shader Tables > Patterns | COMPUTE | GPU simulations side by side. |  | shown | hook, tier 3, default | yes |
| `dot-field` (pages/dot-field-table) | Dot Field Table | Shader Tables > Patterns | WGSL | Halftone and dot-matrix fields. |  | shown | hook, tier 2 | yes |
| `polar` (pages/polar-table) | Polar & Lattice Table | Shader Tables > Patterns | WGSL | Spirals, rosettes and lattices in WGSL. |  | shown | hook, tier 2 | yes |
| `sdf2d` (pages/sdf2d-table) | SDF 2D Table | Shader Tables > Patterns | WGSL | Every 2D signed-distance shape. |  | shown | hook, tier 4, default | yes |
| `color` (pages/color-table) | Color Table | Shader Tables > Image | WGSL | Tone curves and palettes in WGSL. |  | shown | no | yes |
| `postfx` (pages/postfx-table) | Post-Process | Shader Tables > Image | WGSL | Bloom, grain and grading passes. |  | shown | no | yes |
| `sampling` (pages/sampling-table) | Sampling Table | Shader Tables > Image | WGSL | Sampling patterns, side by side. |  | shown | hook, tier 2 | yes |
| `halftone` | Halftone | Shader Tables > Image | WGSL | Photos as halftone dots and rosettes, in WGSL. | glsl-halftone (MIT) | search only | hook, tier 3, default | yes |
| `thread-art` | Thread Art | Shader Tables > Image | WGSL | A portrait drawn by one thread from peg to peg. |  | shown | hook, tier 4, default | yes |
| `lighting` (pages/lighting-table) | Lighting Table | Shader Tables > Surfaces | WGSL | BRDFs and light models compared. |  | shown | hook, tier 2 | yes |
| `sdf-solids` (pages/sdf-solids-table) | SDF Solids Table | Shader Tables > Surfaces | WGSL | 78 signed-distance solids, glass to gold. |  | shown | hook, tier 4, default | yes |
| `liquid-metal` (pages/liquid-metal-table) | Liquid Metal Table | Shader Tables > Surfaces | WGSL | Chrome blobs that melt and merge. |  | shown | hook, tier 2, default | yes |
| `refraction-table` | Refraction Table | Shader Tables > Surfaces | WGSL | Glass panels that bend, split and frost the light. | optics after quick-liquid (MIT) | search only | no | yes |
| `fractal-flames` | Fractal Flames | Shader Tables > Fractals | WGSL | flam3 fractal flames on the GPU: mutate and morph. | flam3 by Scott Draves (GPL-3.0) | search only | hook, tier 3, default | yes |
| `bench` (pages/composition-bench) | Composition Bench | Shader Tables > Composition | NODES | Wire nodes from every table together. |  | shown | generic, tier 4 | yes |
| `explosion` | Explosion | Game Effects > Weapons & Engines |  | The game’s explosion effects. |  | shown | hook, tier 2, default | yes |
| `flare` | Engine Propulsion Effects | Game Effects > Weapons & Engines |  | Engine plumes and thruster flares. |  | shown | hook, tier 2, default | yes |
| `beam` (pages/beam-table) | Beam & Decal Table | Game Effects > Weapons & Engines | WGSL | Lasers, beams and decals. |  | shown | hook, tier 3, default | yes |
| `fire` (pages/fire-table) | Fire Table | Game Effects > Fire & Smoke | WGSL | Procedural fire, many variants. |  | shown | hook, tier 3, default | yes |
| `fire-ev1` (pages/fire-table-evolved-1) | Fire Table (Evolved 1) | Game Effects > Fire & Smoke | WGSL | An evolved set of fire shaders. |  | shown | hook, tier 3, default | yes |
| `smoke` (pages/smoke-table) | Smoke Table | Game Effects > Fire & Smoke | WGSL | Plumes, puffs and drifting smoke. |  | shown | hook, tier 3, default | yes |
| `heat-diffraction` | Heat Diffraction | Game Effects > Heat & Frost | IMG | Heat haze that bends the image. |  | shown | hook, tier 3 | yes |
| `heat-metal` | Heat Metal | Game Effects > Heat & Frost | WGSL | Metal that glows from a hot spot. |  | shown | hook, tier 3, default | yes |
| `frost` (pages/frost-table) | Frost Table | Game Effects > Heat & Frost | WGSL | Frost that creeps across glass. |  | shown | hook, tier 3, default | yes |
| `supernova` (pages/fractal-orb) | Fractal Orb | Rendering > Ray Marching | SHADER | A raymarched fractal orb. |  | shown | hook, tier 2, default | yes |
| `sdf-lab` | SDF Modeller | Rendering > Ray Marching | TOOL | Model with distance fields, Forge style. |  | shown | generic, tier 4 | yes |
| `biome-parts` | Biome Parts | Rendering > Ray Marching | AI | A 1.2M-parameter model builds CAD parts live, command by command. |  | shown | hook, tier 4, default | yes |
| `sphere-tracing` | Sphere Tracing Lab | Rendering > Ray Marching | LAB | Watch one ray march through a distance field. |  | shown | hook, tier 3, default | yes |
| `mandelbulber` | Mandelbulber | Rendering > Ray Marching | WGSL | The Mandelbulber2 fractal engine in WGSL. | Mandelbulber2 by Krzysztof Marczak and team (GPL-3.0) | search only | no | yes |
| `sdf-clouds` | SDF Clouds | Rendering > Ray Marching | GPU | Raymarched clouds from signed-distance shapes. | SDF Clouds by Alex Foulon | search only | no | yes |
| `cornell` | Rendering Engine | Rendering > Light Transport | PATH | A path tracer in the browser. |  | shown | hook, tier 3, default | yes |
| `glass-cube` | Refraction | Rendering > Light Transport | GPU | Light bending through glass. |  | shown | hook, tier 3, default | yes |
| `platonic` (pages/platonic-mirrors) | Platonic Mirrors | Rendering > Light Transport | SHADER | Platonic solids in mirrored shells. |  | shown | hook, tier 1, default | yes |
| `branched-flow` (pages/cube_branched_flow) | Branched Flow | Rendering > Light Transport | GPU | Light that splits into branching paths. |  | shown | hook, tier 3, default | yes |
| `orbs` (pages/presence-orbs) | Presence Orbs | Rendering > Volumes | WGSL | Soft volumetric presence orbs. |  | shown | hook, tier 3, default | yes |
| `thinking-orbs` | Thinking Orbs | Rendering > Volumes | WGSL | Dot orbs that spin, wave and morph. | thinking-orbs by RareFormLabs (MIT) | search only | no | yes |
| `voxel` (pages/voxel-flythrough) | Voxel Flythrough | Rendering > Volumes | GPU | Fly through an endless voxel world. |  | shown | hook, tier 2, default | yes |
| `markov-junior` | MarkovJunior | Rendering > Generative | RULES | Rewrite rules grow mazes, caves and towns. | MarkovJunior by Maxim Gumin | search only | no | yes |
| `shan-shui` | Shan Shui | Rendering > Generative | SVG | An endless ink landscape scroll, drawn from a seed. | shan-shui-inf by Lingdong Huang (MIT) | search only | no | yes |
| `fishdraw` | Fishdraw | Rendering > Generative | SVG | Pen-line fish, one specimen or a full plate. | fishdraw by Lingdong Huang (MIT) | search only | hook, tier 3, default | yes |
| `mushrooms` | Mushroom Draw | Rendering > Generative | SVG | Procedural mushrooms as pen-plotter lines. |  | shown | hook, tier 3, default | yes |
| `nonflowers` | Nonflowers | Rendering > Generative | CANVAS | Gongbi paintings of flowers that do not exist. |  | shown | hook, tier 3, default | yes |
| `context-free` | Context Free | Rendering > Generative | WASM | The Context Free engine: grow designs from grammar. | Context Free by Mark Lentczner and John Horigan (GPL-2+) | search only | hook, tier 3, default | yes |
| `holocloth` | Holocloth | Rendering > Generative | CLOTH | A holographic foil cloth in zero gravity. | Holocloth by Dmitry Kurash (MIT) | search only | no | yes |
| `line-art` | Line Art | Rendering > Generative | RUST | The ln 3D line-art engine, as a pen plotter. | ln by Michael Fogleman (MIT) | search only | hook, tier 3, default | yes |

### Finance

| Key | Title | Constellation > group | Badge | Blurb | Credit | Home | Saver | Thumb |
|---|---|---|---|---|---|---|---|---|
| `market-forecast` | Market Forecast | Finance > Forecasting | AI | Probabilistic price forecasts from Chronos, on your GPU. |  | shown | hook, tier 3, default | yes |

### Studio

| Key | Title | Constellation > group | Badge | Blurb | Credit | Home | Saver | Thumb |
|---|---|---|---|---|---|---|---|---|
| `photocraft` | PhotoCraft | Crafting Apps > Image | RUST | The PhotoCraft image editor, in Rust. |  | shown | no | no |
| `lightcraft` | LightCraft | Crafting Apps > Image | RUST | The LightCraft photo library and raw developer. |  | shown | no | no |
| `vectorcraft` | VectorCraft | Crafting Apps > Vector & Layout | RUST | The VectorCraft vector illustration app. |  | shown | no | no |
| `designcraft` | DesignCraft | Crafting Apps > Vector & Layout | RUST | The DesignCraft page layout app. |  | shown | no | no |
| `pattern-designer` | Pattern Designer | Crafting Apps > Vector & Layout | SVG | Generative vector patterns for posters. |  | shown | hook, tier 3, default | yes |
| `filmcraft` | FilmCraft | Crafting Apps > Video & Motion | RUST | The FilmCraft video editor: timeline, colour, sound. |  | shown | no | no |
| `effectcraft` | EffectCraft | Crafting Apps > Video & Motion | RUST | The EffectCraft motion graphics compositor. |  | shown | no | no |
| `printcraft` | PrintCraft | Crafting Apps > Documents | RUST | The PrintCraft PDF workbench. |  | shown | no | no |

### Hidden pages

Open at `/stella-nova/#<key>`. Not in the nav, home, search or saver (SN_HIDDEN in lib/nav-data.js).

- `stats` Site Statistics (pages/stats)

### Folders not in the nav

UNLISTED in tools/nav-sync.js. A folder here is not a page of the site.

- `pages/material-lab`: the old Material Lab; the matlab key routes to material-studio
- `pages/energy-dashboard`: Ten Minute Physics port held back: the upstream file has no licence text, so the author keeps all rights (checked 2026-10-09); not committed
- `pages/height-field-water`: Ten Minute Physics port held back: the upstream file has no licence text, so the author keeps all rights (checked 2026-10-09); not committed
- `pages/morton-bvh`: Ten Minute Physics port held back: the upstream file has no licence text, so the author keeps all rights (checked 2026-10-09); not committed
- `pages/pendulum-3d`: Ten Minute Physics port held back: the upstream file has no licence text, so the author keeps all rights (checked 2026-10-09); not committed
- `pages/pendulum-trail`: Ten Minute Physics port held back: the upstream file has no licence text, so the author keeps all rights (checked 2026-10-09); not committed
- `pages/sweep-and-prune`: Ten Minute Physics port held back: the upstream file has no licence text, so the author keeps all rights (checked 2026-10-09); not committed
<!-- PAGES:END -->

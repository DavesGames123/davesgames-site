# Physics page UI survey (2026-10-09)

This survey lists the physics simulation pages and how their controls look.
It is the work list for the sim kit (`widgets/sim-kit/`). A "dev GUI" is the
raw control row of the original demo: browser checkboxes, sliders and grey
buttons with no designed panel, no randomizer and no phone layout.

Columns: **UI** is dev GUI, partly designed, or designed. **Rand** says if
the user can ask for a random scene. **Saver** is the snSaver hook: none,
1-pick (one seeded scene per run), or shots (a shot director).

## Ten Minute Physics ports (widgets/ten-minute-physics/kit.js)

All 22 pages keep the upstream markup. The TMP kit adds the credit bar and a
shot director (5-12 s cuts, one fixed preset per shot). None has a randomizer
or a phone layout. Most start paused.

| Page | UI | Rand | Saver | Verdict |
|---|---|---|---|---|
| euler-fluid | dev GUI: 4 grey scene buttons, 5 raw checkboxes | no | shots (4) | starts paused; needs a panel, colour maps for pressure and smoke |
| flip-fluid | dev GUI: 4 raw checkboxes, 1 slider | no | shots (5) | another agent converts it now; match its look |
| pbf-boundary | dev GUI: Restart/Run/Step, number boxes, 3 bare sliders | no | shots (6) | starts paused; converted first with the sim kit |
| fire-simulation | dev GUI: 3 checkboxes, 1 slider | no | shots (5) | starts paused; needs fuel, wind and palette randomizer |
| julia-fractals | dev GUI: 2 toggle buttons, 1 slider | no | shots (2) | weak saver; needs c-path randomizer and colour maps |
| cannonball-2d | no controls | no | shots (4) | bare canvas; needs launch randomizer and transport |
| cannonball-3d | dev GUI: Run/Restart | no | shots (6) | starts paused; needs ball count, restitution, theme |
| cannonball-vr | no controls (VR button) | no | shots (5) | keep VR entry; add panel for desktop |
| billiard | dev GUI: 1 button, 1 slider | no | shots (5) | starts paused; needs ball count, restitution, sizes |
| pinball | dev GUI: 1 button | no | shots (5) | starts paused; needs table and ball randomizer |
| spatial-hashing | dev GUI: Run/Restart, 1 checkbox | no | none listed | starts paused; saver has no shot list |
| pendulum-short | no controls | no | shots (4) | bare canvas; needs arm count, lengths, trails |
| triple-pendulum | dev GUI: Restart/Run/Step, 1 slider | no | shots (5) | starts paused; needs masses, lengths, trails |
| bead-on-wire | dev GUI: Restart/Run/Step | no | shots (4) | starts paused; needs wire shape and step count |
| many-beads | dev GUI: 1 button | no | shots (4) | needs bead count, sizes, wire radius |
| joints | dev GUI: 3 buttons, 1 select, touch pad | no | shots (5) | three JSON scenes; needs scene picker and theme |
| rigid-bodies | dev GUI: 2 buttons, 2 selects | no | shots (4) | needs body count and shape randomizer |
| soft-bodies | dev GUI: 4 buttons, 1 slider | no | shots (4) | starts paused; needs body count, compliance |
| soft-body-interaction | dev GUI: Run/Restart | no | shots (4) | starts paused |
| soft-body-skinning | dev GUI: 3 buttons, 1 checkbox, 1 slider | no | shots (5) | starts paused |
| cloth | dev GUI: Run/Restart, 1 checkbox, 1 slider | no | shots (4) | starts paused; needs pins, wind, size, palette |
| cloth-self-collision | dev GUI: Run/Restart, 2 checkboxes, 1 slider | no | shots (4) | starts paused |

Six more TMP ports are in the tree but not committed (another session owns
them): height-field-water, sweep-and-prune, morton-bvh, pendulum-3d,
pendulum-trail, energy-dashboard. They have the same dev GUI.

## Other physics pages (Fluids, Science and Machines regions)

No page uses lil-gui, dat.gui or tweakpane. Every page has its own CSS, so
"dev GUI" below means thin, plain rows only.

| Page | UI | Rand | Saver | Verdict |
|---|---|---|---|---|
| fluidlab | partly: 21 plain sliders, 26 buttons | no | 1-pick | strong candidate |
| ns-burgers, ns-flow2d, ns-flow3d, ns-vortex | partly: one shared plain sidebar (widgets/ns) | no | state cycle | fix widgets/ns once for four pages |
| flowlab | designed, thin | no | 1-pick | candidate |
| attractorlab | designed, thin | yes | 1-pick | weak saver |
| double-slit | designed, dense (22 sliders) | no | 1-pick | weak saver |
| neuron-network | partly: borrows neuron-lab styles | yes | shots | own panel needed (neuron-lab is out of bounds now) |
| biot-savart | designed | no | preset | thin saver, no randomizer |
| resonance-figure, resonance-3d | partly | no | shots | light panels |
| wind-tunnel | designed (dock, gear) | no | shots | add randomizer only |
| gravity, magnetlab, wave-membrane, chladni-plate | designed | no | shots | add randomizer only |
| photon-caustics, photon-caustics-3d | designed | no | shots | add randomizer only |
| hohmann, galaxy, game-of-life, reaction-diffusion, lenia, protein-folding, outbreak, legged-rl, roche-limit, particle-collider, dice, origami, molecular-bond, ns-geometry | designed | most yes | shots | fine as they are |
| Machines 3D mechanisms (stirling, four-stroke, geneva-cams, linkages, differential, planetary-gearbox, pendulum-clock, and so on) | designed, shared template | no | shots | consistent; a randomizer is optional |
| spirograph | designed | no | shots | could add "random curve" |

diffraction-lab has no entry in lib/screensaver-catalog.js.

## Order of work

1. The 22 TMP ports (dev GUI, start paused, no randomizer). pbf-boundary is
   first. flip-fluid belongs to another agent.
2. widgets/ns (four Navier-Stokes pages), fluidlab, flowlab, double-slit.
3. A randomizer on the designed pages that do not have one.

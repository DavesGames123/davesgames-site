// ============================================================================
//  SECTORS  ·  the constellations of the home star chart
// ----------------------------------------------------------------------------
//  lib/nav-data.js (SN_NAV) is the page registry: 3 regions, each with its
//  constellations. Each constellation is one sector here. This file adds
//  what the chart needs: a blurb, a lead page, a centre in chart units
//  (1000 x 620), featured keys, and the anchors that it calculates from the
//  centre (LAYOUT).
//
//  Classic script, no ES modules, so the page also runs on file://.
//  Load order: thumbs/list.js, ../../lib/nav-data.js, sectors.js, main.js
//  (all defer). It reads window.SN_NAV and O.THUMB_KEYS and adds its
//  exports to O (O = window.Observatory). tools/nav-sync.js also loads this
//  file, to read EXCLUDED, DIRECTORY_ONLY, BLURBS and CREDITS for the home
//  directory, its blurb warnings and the page table of stella-nova/PAGES.md.
//
//  grep -n targets
//    sector text .......... "const SECTOR_TEXT"
//    region bands ......... "const REGION_BANDS"
//    sector table ......... "const SECTORS"
//    anchor layout ........ "function layoutFor"
//    page blurbs .......... "const BLURBS"
//    thumbnail keys ....... "const THUMBS"
//    featured rail ........ "const FEATURED"
//    flat page list ....... "function allPages"
//    excluded pages ....... "const EXCLUDED"
//    directory-only ....... "const DIRECTORY_ONLY"
//    port credits ......... "const CREDITS"
//    search page list ..... "function searchPages"
// ============================================================================
(function (O) {
'use strict';
const NAV = window.SN_NAV;
const THUMB_KEYS = O.THUMB_KEYS || [];

// Ports of code we did not write, kept off the home showcase: no featured
// spot, card, thumbnail rail, star or directory entry (tools/nav-sync.js
// leaves them out of the directory block). They stay in the shell sidebar.
// Search lists them (since 2026-10-09, at the user's request), tagged
// "port" with the upstream credit from CREDITS: see searchPages().
const EXCLUDED = new Set([
  'mandelbulber',      // port of Mandelbulber2
  'shan-shui',         // port of shan-shui-inf
  'markov-junior',     // port of MarkovJunior
  'holocloth',         // port of Holocloth
  'sdf-clouds',        // port of SDF Clouds
  'refraction-table',  // port of quick-liquid optics
  'thinking-orbs',     // port of RareFormLabs thinking-orbs
  'fractal-flames',    // port of flam3 (GPL-3.0)
  'line-art',          // Rust port of fogleman/ln
  'volume-noise',      // port of TileableVolumeNoise
  'fishdraw',          // port of LingDong-/fishdraw
  'halftone',          // port of glslify/glsl-halftone
  'context-free',      // GPL-2+ build of Context Free (Lentczner, Horigan)
  'randoma11y',        // removed from the site
]);
// Pages listed only in the plain directory: no featured spot, quick link,
// thumbnail rail, star or search result. Their origin is being confirmed.
const DIRECTORY_ONLY = new Set(['qave', 'origami']);

// Upstream credit of each port, one short line. Search shows it on the
// result row and searches its words, and every key here also gets the
// search tag "port". Two kinds of port are here: the EXCLUDED ones above,
// and the Ten Minute Physics ports, which the home shows like our own
// pages, because each one carries the credit bar of
// widgets/ten-minute-physics/kit.js.
const TMP = n => 'Ten Minute Physics #' + n + ' by Matthias Müller (MIT)';
const CREDITS = {
  'mandelbulber': 'Mandelbulber2 by Krzysztof Marczak and team (GPL-3.0)',
  'shan-shui': 'shan-shui-inf by Lingdong Huang (MIT)',
  'markov-junior': 'MarkovJunior by Maxim Gumin',
  'holocloth': 'Holocloth by Dmitry Kurash (MIT)',
  'sdf-clouds': 'SDF Clouds by Alex Foulon',
  'refraction-table': 'optics after quick-liquid (MIT)',
  'thinking-orbs': 'thinking-orbs by RareFormLabs (MIT)',
  'fractal-flames': 'flam3 by Scott Draves (GPL-3.0)',
  'line-art': 'ln by Michael Fogleman (MIT)',
  'volume-noise': 'TileableVolumeNoise by Sébastien Hillaire (MIT)',
  'fishdraw': 'fishdraw by Lingdong Huang (MIT)',
  'halftone': 'glsl-halftone (MIT)',
  'context-free': 'Context Free by Mark Lentczner and John Horigan (GPL-2+)',
  'cannonball-2d': TMP(1), 'cannonball-3d': TMP(2), 'cannonball-vr': TMP(2),
  'billiard': TMP(3), 'pinball': TMP(4), 'bead-on-wire': TMP(5),
  'many-beads': TMP(5), 'pendulum-short': TMP(6), 'triple-pendulum': TMP(6),
  'soft-body-interaction': TMP(8), 'soft-bodies': TMP(10),
  'spatial-hashing': TMP(11), 'soft-body-skinning': TMP(12), 'cloth': TMP(14),
  'cloth-self-collision': TMP(15), 'euler-fluid': TMP(17),
  'flip-fluid': TMP(18), 'julia-fractals': TMP(19), 'fire-simulation': TMP(21),
  'rigid-bodies': TMP(22), 'joints': TMP(25),
  'pbf-boundary': 'Ten Minute Physics contribution by Sergii Biloshytskyi, for Matthias Müller (MIT)',
};
const PORTS = new Set(Object.keys(CREDITS));

// Keys that have a thumbnail in thumbs/<key>.jpg. Others get generated art.
const THUMBS = new Set(THUMB_KEYS);

// Chart text per constellation id. at is the centre [x, y] in chart units.
// The centres are not on rows or columns, so the chart does not read as a
// grid. tilt (degrees) turns the ring of groups, so no two sectors align.
// lead is the page the inspector opens first. The game sector's lead is an
// in-page anchor (#features).
const SECTOR_TEXT = {
  game: { at: [100, 110], tilt: 20, lead: 'features',
    blurb: 'Stella Nova is a space-colony sim. Mine ore, smelt alloys, grow a grid station and govern a crew across a solar system that runs on real n-body physics.' },
  wiki: { at: [150, 300], tilt: -35, lead: 'wiki',
    blurb: 'The player handbook, live. Look up every item, module and tech, plan a station on the real grid, trace every crafting chain, design ships and flags, and meet your crew.' },
  community: { at: [120, 525], tilt: 50, lead: 'starward-belt',
    blurb: 'Pages made with and for the people around the game: a tribute, a player-made map of the belt, the translation tool, and two studio tools for sunlight and materials.' },
  space: { at: [345, 140], tilt: -15, lead: 'hohmann',
    blurb: 'Orbits you can plan and planets you can fling: transfer burns, real satellites, an n-body sandbox, a galaxy, a black hole and a wormhole.' },
  quantum: { at: [565, 82], tilt: 30, lead: 'orbital',
    blurb: 'Atoms and qubits: hydrogen orbitals in 3D, quantum circuits that encode and decode data and images, and a particle collider.' },
  chemistry: { at: [540, 330], tilt: 15, lead: 'periodic-table',
    blurb: 'The elements and what they make: a periodic table in eleven shapes with the live atom of every element, two atoms that share an electron, over a thousand molecules in 3D, and famous syntheses step by step.' },
  life: { at: [730, 165], tilt: -40, lead: 'protein-viewer',
    blurb: 'Real protein structures, a chain that folds, a human skull and skeleton you can pull apart, and the Earth itself through 540 million years of drifting continents.' },
  fluids: { at: [890, 95], tilt: 10, lead: 'fluidlab',
    blurb: 'Stable fluids, a wind tunnel, grid, FLIP and particle fluids and fire, real tidal currents, and the Navier-Stokes equations from 1D to the open blowup question.' },
  fields: { at: [375, 290], tilt: 40, lead: 'magnetlab',
    blurb: 'Magnets, currents and Maxwell’s equations, then light itself: aperture diffraction, the double slit and circular polarization.' },
  patterns: { at: [505, 222], tilt: -25, lead: 'attractorlab',
    blurb: 'Simple rules, rich results: strange attractors, vector fields, reaction-diffusion, Lenia and the Game of Life.' },
  sound: { at: [660, 325], tilt: 60, lead: 'chordlab',
    blurb: 'Hear the maths. A live chord detector, harmony wheels, and resonance figures and drums that turn vibration into shapes you can see.' },
  machines: { at: [895, 262], tilt: -20, lead: 'watch-movement',
    blurb: 'Mechanisms that move, in 27 working 3D models: engines, gear trains and transmissions, linkages and cams, pumps, clocks and the Antikythera mechanism, and the machines that calculate and encipher. Then the physics under them, from Ten Minute Physics by Matthias Müller: cannonballs, pendulums, joints, rigid and soft bodies and cloth.' },
  language: { at: [770, 300], tilt: 35, lead: 'lose-the-modifier',
    blurb: 'Words, weighed: tools that cut padding and find the exact word. Lose the Modifier turns “very tired” into “exhausted” and “walked slowly” into “trudged” across more than 1,100 original pairs, and marks the padding in any paragraph you paste.' },
  papers: { at: [626, 222], tilt: 0, lead: 'gravitational-imaging',
    blurb: 'Recent papers, explained with live figures: a million-solar-mass clump found by gravitational lensing, how AlphaFold predicts a protein structure, and a benchmark of coding agents that rebuild moving scenes.' },
  shaders: { at: [420, 500], tilt: -30, lead: 'sdf-solids',
    blurb: 'Live WebGPU shader tables in WGSL: noises, fields, colour, lighting, sampling and signed-distance solids, each with its source one click away.' },
  effects: { at: [620, 548], tilt: 25, lead: 'fire',
    blurb: 'The visual effects of the game: explosions, engine plumes, beams, fire, smoke, heat haze and frost.' },
  rendering: { at: [850, 452], tilt: -50, lead: 'supernova',
    blurb: 'Rendering techniques you can steer: ray marching, sphere tracing, a path tracer, glass and mirrors, volumes and a voxel world.' },
  finance: { at: [745, 585], tilt: -15, lead: 'market-forecast',
    blurb: 'Pretrained forecasters, run in your browser, honest about their odds. Market Forecast reads like a stock page, but the fan beyond the price is a probabilistic forecast from Amazon’s Chronos models on your GPU, with a portfolio analysis and a backtest of how often the 80% band held. Demo data is synthetic; your own free API key brings live tickers.' },
  craft: { at: [930, 560], tilt: 15, lead: 'photocraft',
    blurb: 'The open-source Crafting Apps by the ArtCraft Team, in pure Rust, running in your browser: image editing, raw photos, vector art, page layout, video, motion graphics and PDFs. The official web builds, unchanged, with full credits.' },
};

// Region bands on the chart: a faint name and the edge of the band.
const REGION_BANDS = [
  { id: 'stella', name: 'Stella Nova', at: [22, 606], edge: 'M250 30 L250 600' },
  { id: 'science', name: 'Science', at: [272, 352], edge: 'M265 368 Q 620 348 985 368' },
  { id: 'graphics', name: 'Graphics', at: [272, 394], edge: null },
  { id: 'finance', name: 'Finance', at: [700, 606], edge: null },
  { id: 'studio', name: 'Studio', at: [880, 606], edge: null },
];

// One sector per constellation, in nav order.
const SECTORS = [];
NAV.forEach(r => r.constellations.forEach(c => {
  const t = SECTOR_TEXT[c.id] || { at: [500, 310], lead: c.groups[0].p[0][0], blurb: '' };
  SECTORS.push({ id: c.id, name: c.label, short: c.short, glyph: c.icon, color: c.color,
    region: r.id, regionName: r.label, blurb: t.blurb, lead: t.lead, at: t.at, tilt: t.tilt || 0, label: t.at });
}));

// The game constellation also points into this page and to the stores.
const GAME_STARS = [
  { href: '#features', label: 'Features', sub: 'What you command' },
  { href: '#media', label: 'Gameplay', sub: 'Video and screenshots' },
  { href: '#download', label: 'Download the demo', sub: 'Windows and macOS' },
  { href: '#report', label: 'Report a bug', sub: 'Straight to the dev' },
  { href: 'https://store.steampowered.com/app/4474070/Stella_Nova/?utm_source=davesgames.io&utm_medium=home&utm_campaign=site&utm_content=sectors', label: 'Steam', sub: 'Wishlist and demo', ext: true },
  { href: 'https://discord.gg/SkJDmnRmdJ', label: 'Discord', sub: 'Talk to Dave', ext: true },
];

// Short lines for the pages that appear on cards. Others show their group.
const BLURBS = {
  'watch-movement': 'A pocket watch that runs, then comes apart.',
  'watch-randomizer': 'Roll a pocket watch, wristwatch, wall clock or alarm clock.',
  'stirling-engine': 'A Stirling engine cut open, with a live P-V loop.',
  'four-stroke-engine': 'An inline four, exploded: crank, valves, Otto cycle.',
  'wankel-engine': 'A Wankel rotor in its epitrochoid, three chambers live.',
  'differential': 'A rear axle opened up: open, clutch and Torsen units.',
  'planetary-gearbox': 'Hold the sun, carrier or ring; then a Simpson set.',
  'pin-tumbler-lock': 'Key in: each pin stack splits on the shear line.',
  home: 'This page: the overview and the chart.',
  translate: 'Help put Stella Nova in your language.',
  wiki: 'Every item, module and tech, linked.',
  research: 'The tech tree, prerequisite by prerequisite.',
  'social-dynamics': 'The named ideas behind crew social life.',
  guide: 'Every module, room and rule of a station.',
  planner: 'Lay out a station on the real game grid.',
  crafting: 'The full tree from ore to reactor core.',
  shipdesigner: 'Hull, engines, livery. Build your ship.',
  flagdesigner: 'Design the banner your colony flies.',
  selection: 'How picking and grouping works in game.',
  behaviors: 'The work states behind every citizen.',
  controls: 'Every key and mouse binding.',
  hohmann: 'Plan the cheapest burn between two orbits.',
  leo: 'Thousands of real satellites in low orbit.',
  gravity: 'A Barnes-Hut n-body sandbox. Fling planets.',
  galaxy: 'A spiral galaxy that holds its own arms.',
  forge: 'Sculpt and paint a planet from noise.',
  blackhole: 'Gravitational lensing around a Schwarzschild hole.',
  wormhole: 'Fly through an Ellis wormhole.',
  'gravitational-imaging': 'A million Suns of dark mass, found by the dent it makes in a lensed arc.',
  orbital: 'Hydrogen orbitals in 3D, VR ready.',
  'molecular-bond': 'Watch two atoms share an electron.',
  'hydrogen-table': 'Every hydrogen wave function, side by side.',
  'protein-viewer': 'Real protein structures in 3D, 37 presets.',
  'protein-folding': 'Watch a chain fold into its native shape.',
  alphafold: 'How AlphaFold turns a sequence into a structure.',
  'enzyme-design': 'Design an enzyme from scratch: hold the chemistry still and grow a protein around it.',
  '4d-codebench': 'Can coding agents rebuild a moving scene from video? Play the benchmark in your browser.',
  'human-skull': 'A human skull in 51 parts, pulled apart.',
  'human-skeleton': 'Explode a skeleton and inspect all 200 bones.',
  fluidlab: 'Jos Stam stable fluids on the GPU.',
  'ns-flow3d': 'Navier-Stokes in a 3D box.',
  magnetlab: 'Drag magnets and see the field lines.',
  maxwell: 'The four equations, animated.',
  cornell: 'A path tracer in the browser.',
  'double-slit': 'Interference, one photon at a time.',
  'geneva-cams': 'Turn steady rotation into steps: a Geneva drive and a disc cam in 3D.',
  linkages: 'Bars and pins that draw curves, a true straight line, and a walking step.',
  'manual-gearbox': 'A five-speed gearbox cut open: shift and watch the synchros lock each gear.',
  'harmonic-drive': 'The reducers inside robot joints: a flexing strain wave gear and a cycloidal drive.',
  'photon-caustics': 'Trace photons through mirrors, lenses and water and watch caustics form, in 2D and in a 3D pool.',
  attractorlab: 'Lorenz, Rossler, Thomas and friends.',
  'wave-membrane': 'Chladni modes of a vibrating drum.',
  'chladni-plate': 'Sand finds the nodal lines of guitar and violin tops.',
  'reaction-diffusion': 'Gray-Scott patterns that grow and split.',
  lenia: 'Continuous cellular life.',
  chordlab: 'Sing or play: it names the chord live.',
  harmonywheel: 'The circle of fifths you can spin.',
  'resonance-table': 'Resonance figures for every mode.',
  noise: 'Perlin, simplex, Worley and more, live.',
  fields: 'Compute-shader fields and flows.',
  sims: 'GPU simulations side by side.',
  'dot-field': 'Halftone and dot-matrix fields.',
  color: 'Tone curves and palettes in WGSL.',
  lighting: 'BRDFs and light models compared.',
  bench: 'Wire nodes from every table together.',
  supernova: 'A raymarched fractal orb.',
  orbs: 'Soft volumetric presence orbs.',
  voxel: 'Fly through an endless voxel world.',
  'sdf-solids': '78 signed-distance solids, glass to gold.',
  'liquid-metal': 'Chrome blobs that melt and merge.',
  'sdf-lab': 'Model with distance fields, Forge style.',
  explosion: 'The game’s explosion effects.',
  flare: 'Engine plumes and thruster flares.',
  'tidal-currents': 'Real tidal current data, animated.',
  solar: 'Sun paths for any place and date.',
  matlab: 'Author PBR materials with a live sphere.',
  'pascal-editor': 'Pascal, the open-source 3D building editor.',
  fortom: 'A tribute page.',
  'starward-belt': 'A player-made map of the belt.',
  fire: 'Procedural fire, many variants.',
  frost: 'Frost that creeps across glass.',
  'fire-ev1': 'An evolved set of fire shaders.',
  smoke: 'Plumes, puffs and drifting smoke.',
  'heat-diffraction': 'Heat haze that bends the image.',
  'heat-metal': 'Metal that glows from a hot spot.',
  polar: 'Spirals, rosettes and lattices in WGSL.',
  sdf2d: 'Every 2D signed-distance shape.',
  beam: 'Lasers, beams and decals.',
  'glass-cube': 'Light bending through glass.',
  platonic: 'Platonic solids in mirrored shells.',
  'branched-flow': 'Light that splits into branching paths.',
  postfx: 'Bloom, grain and grading passes.',
  sampling: 'Sampling patterns, side by side.',
  diffraction: 'Light through an aperture.',
  polarization: 'Watch a wave twist as it travels.',
  'biot-savart': 'The field around a current.',
  'twenty-to-four': 'A field study in four panels.',
  'smith-chart': 'Impedance on the Smith chart.',
  flowlab: 'Flow lines through vector fields.',
  'ns-flow2d': 'Navier-Stokes on a 2D grid.',
  'ns-burgers': 'Shocks form in the Burgers equation.',
  'ns-vortex': 'A vortex that may blow up.',
  'resonance-figure': 'Lissajous figures from two tones.',
  'resonance-3d': 'Resonance figures in 3D.',
  chordchart: 'Every chord shape on one chart.',
  // Pages that had no line before 2026-10-09 (tools/nav-sync.js now
  // warns when a registered page has none).
  'flight-board': 'A split-flap board for any airport, from live ADS-B.',
  'roche-limit': 'An icy moon crosses the Roche limit and becomes a ring.',
  'chandrasekhar-limit': 'Why no white dwarf weighs more than 1.4 Suns.',
  molecules: 'Over a thousand molecules, skeletal formula beside 3D.',
  reactions: 'Watch molecules change in 3D through famous syntheses.',
  'periodic-table': 'Eleven shapes of the table, and the live atom of every element.',
  qave: 'Quantum algorithms step by step in 3D.',
  'qft-flow': 'Four qubit phase knobs and the spectrum a QFT reads out.',
  'qft-store': 'Write bytes into qubit rotation angles and read them back.',
  frqi: 'Store an image in qubits with FRQI, layer by layer.',
  'particle-collider': 'Collide two particles and trace the products.',
  'virus-atlas': 'Real virus capsids from the PDB: assemble, peel, explode.',
  'ct-explained': 'How CT works, from X-ray shadows to slices.',
  'ct-lab': 'Scan phantoms, fill the sinogram, break the image.',
  'neuron-lab': 'A 3D neuron: watch a spike run along its branches.',
  'neuron-network': 'A cortical column of spiking cells in a gamma rhythm.',
  'ancient-earth': 'The Earth from 540 million years ago to today.',
  outbreak: 'Diseases spread between cities on a 3D globe (a toy model).',
  'wind-tunnel': 'Lattice Boltzmann flow around a cow, a car or a wing.',
  'city-atlas': 'Twenty-one 3D cities with real terrain, currents and wind.',
  'map-generator': 'Grow a procedural city from a seed (after MapGenerator).',
  'storm-globe': 'Today’s storms on a globe of real GFS winds.',
  'map-projections': '26 map projections, Tissot circles and a true-size tool.',
  'ns-equations': 'The Navier-Stokes terms one at a time in 1D.',
  'ns-wave': 'The blowup question through a wave model.',
  'ns-geometry': 'The blowup question through the geometry of the flow.',
  'antenna-fields': 'Radio waves leave a dipole, a loop and an array.',
  sstv: 'Slow-scan television: a picture sent as sound, decoded live.',
  'photon-caustics-3d': 'Sunlight through waves draws caustics on a pool floor.',
  'game-of-life': 'Conway’s Life on the GPU, with a pattern library.',
  'ulam-spiral': 'Primes form lines in the Ulam spiral and 21 more layouts.',
  'ramanujan-pi': 'Race Ramanujan-Sato series for pi, digit by digit.',
  'hopf-fibration': 'The 3-sphere as linked circles, in 3D.',
  dice: 'Physics dice from d4 to d20, tested for fairness.',
  'radial-engine': 'A radial aero engine cut away: master and link rods.',
  'gear-types': 'Spur, helical, bevel, worm and rack gears in 3D.',
  cvt: 'A push-belt CVT and a toroidal drive change ratio.',
  'universal-joints': 'Cardan joints, their ripple, and a Rzeppa CV joint.',
  'ball-screw': 'Lead screw against ball screw: travel, balls, efficiency.',
  spirograph: 'Toothed gears draw hypotrochoids and epitrochoids.',
  ratchets: 'Ratchet, sprag clutch and freehub: drive one way, slip the other.',
  'sewing-machine': 'A lockstitch machine: needle, hook, bobbin and feed dog.',
  'pendulum-clock': 'Three escapements on a pendulum clock, simulated.',
  antikythera: 'The Antikythera gear train, cranked day by day.',
  pumps: 'Gear, vane and Roots pumps move fluid pockets.',
  'swashplate-pump': 'An axial piston pump on a tilted swashplate.',
  calculators: 'The Pascaline and the Curta carry digit by digit.',
  curta: 'The Curta calculator in 3D, part by part.',
  'enigma-rotors': 'The Enigma rotor stack, from key to lamp.',
  origami: 'Draw a crease pattern and watch it fold.',
  'lose-the-modifier': 'Turn “very tired” into one strong word.',
  'legged-rl': 'Walking robot policies in MuJoCo, in your browser.',
  'mrna-vaccine': 'The decades of science behind the 2020 mRNA vaccines.',
  'volume-noise': 'Tileable 3D Perlin-Worley noise for clouds, in WGSL.',
  halftone: 'Photos as halftone dots and rosettes, in WGSL.',
  'thread-art': 'A portrait drawn by one thread from peg to peg.',
  'refraction-table': 'Glass panels that bend, split and frost the light.',
  'fractal-flames': 'flam3 fractal flames on the GPU: mutate and morph.',
  'biome-parts': 'A 1.2M-parameter model builds CAD parts live, command by command.',
  'sphere-tracing': 'Watch one ray march through a distance field.',
  mandelbulber: 'The Mandelbulber2 fractal engine in WGSL.',
  'sdf-clouds': 'Raymarched clouds from signed-distance shapes.',
  'thinking-orbs': 'Dot orbs that spin, wave and morph.',
  'markov-junior': 'Rewrite rules grow mazes, caves and towns.',
  'shan-shui': 'An endless ink landscape scroll, drawn from a seed.',
  fishdraw: 'Pen-line fish, one specimen or a full plate.',
  mushrooms: 'Procedural mushrooms as pen-plotter lines.',
  nonflowers: 'Gongbi paintings of flowers that do not exist.',
  'context-free': 'The Context Free engine: grow designs from grammar.',
  holocloth: 'A holographic foil cloth in zero gravity.',
  'line-art': 'The ln 3D line-art engine, as a pen plotter.',
  'market-forecast': 'Probabilistic price forecasts from Chronos, on your GPU.',
  photocraft: 'The PhotoCraft image editor, in Rust.',
  lightcraft: 'The LightCraft photo library and raw developer.',
  vectorcraft: 'The VectorCraft vector illustration app.',
  designcraft: 'The DesignCraft page layout app.',
  'pattern-designer': 'Generative vector patterns for posters.',
  filmcraft: 'The FilmCraft video editor: timeline, colour, sound.',
  effectcraft: 'The EffectCraft motion graphics compositor.',
  printcraft: 'The PrintCraft PDF workbench.',
  // Ten Minute Physics ports (Matthias Müller and contributors, MIT).
  'cannonball-2d': 'A ball under gravity in a box: physics in a few lines.',
  'cannonball-3d': 'The cannonball in 3D: balls bouncing in a box.',
  'cannonball-vr': 'The 3D cannonball box in a VR headset. Needs WebXR.',
  billiard: 'Many balls collide; set the restitution from elastic to dead.',
  pinball: 'A playable pinball table: flippers, bumpers and borders.',
  'spatial-hashing': 'Thousands of balls collide, found fast by a spatial hash.',
  'pendulum-short': 'A chaotic pendulum, complete in about a hundred lines.',
  'triple-pendulum': 'A chaotic multi-link pendulum with position based dynamics.',
  'bead-on-wire': 'A bead held on a circular wire, against the exact solution.',
  'many-beads': 'Many beads collide on one circular wire.',
  joints: 'Hinges, ball joints and a steering linkage with XPBD.',
  'rigid-bodies': 'Stacks, chains and collisions of rigid bodies in 3D.',
  'soft-bodies': 'Squash and throw tetrahedral soft bunnies (XPBD).',
  'soft-body-interaction': 'Pick up and throw a simulated body with the mouse.',
  'soft-body-skinning': 'A detailed dragon skinned to a coarse soft body.',
  cloth: 'Fast, stable XPBD cloth with bending.',
  'cloth-self-collision': 'Cloth that folds onto itself and does not pass through.',
  'euler-fluid': 'A grid fluid in 200 lines: wind tunnel, tank and paint.',
  'flip-fluid': 'FLIP water: particles carry it, a grid solves the pressure.',
  'pbf-boundary': 'Position based particles with moving walls and friction.',
  'fire-simulation': 'Fire from a grid fluid: heat and smoke rise and swirl.',
  'julia-fractals': 'Julia and Mandelbrot sets, zoom and explore.',
};

// The "brightest stars" rail: the best single pages across the site.
// Each one is our own code and has a strong, fresh screenshot.
// The Atomic Orbital page leads.
const FEATURED = ['orbital', 'hydrogen-table', 'blackhole', 'galaxy', 'sdf-solids', 'molecular-bond',
  'liquid-metal', 'wave-membrane', 'polar', 'frost', 'magnetlab', 'tidal-currents', 'sdf-lab', 'leo',
  'attractorlab', 'reaction-diffusion'];

// Flatten SN_NAV into page records with their sector, group and badge.
// The showcase (cards, rails, chart) uses allPages(): no EXCLUDED and no
// DIRECTORY_ONLY page. allPages({ ports: true }) adds the EXCLUDED pages,
// for search. A record of a port has port: true and its credit line.
function allPages(opts) {
  const ports = !!(opts && opts.ports);
  const bySector = Object.fromEntries(SECTORS.map(s => [s.id, s]));
  const out = [];
  window.snPages().forEach(p => {
    if (DIRECTORY_ONLY.has(p.key) || (EXCLUDED.has(p.key) && !ports)) return;
    out.push({ key: p.key, label: p.label, badge: p.badge, group: p.group.h || p.con.label, cluster: p.con.label, sector: bySector[p.con.id],
      port: PORTS.has(p.key), credit: CREDITS[p.key] || null, excluded: EXCLUDED.has(p.key) });
  });
  return out;
}
// Every page that search lists: all registered pages except DIRECTORY_ONLY.
function searchPages() { return allPages({ ports: true }); }

// Anchors [x, y, radius] for the groups the chart shows. A sector with one
// group sits on its centre. More groups sit on a ring around the centre.
// The radius grows with the star count, so a big group gets more room.
// The label goes above the top of the constellation, pulled toward the
// highest group, so the labels do not stack in columns.
function layoutFor(sec, counts) {
  const [cx, cy] = sec.at;
  const rad = n => n <= 1 ? 0 : 12 + 10 * Math.sqrt(n);
  if (counts.length === 1) {
    sec.label = [cx, cy - rad(counts[0]) * 0.78 - 22];
    return [[cx, cy, rad(counts[0])]];
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const ring = 18 + 8 * Math.sqrt(total);
  const out = counts.map((n, i) => {
    // Two groups go on a diagonal, so a sector does not read as one long row.
    const a0 = counts.length === 2 ? -Math.PI / 4 : -Math.PI / 2 + Math.PI / counts.length;
    const a = a0 + sec.tilt * Math.PI / 180 + i * 2 * Math.PI / counts.length;
    return [cx + Math.cos(a) * ring * 1.25, cy + Math.sin(a) * ring * 0.8, rad(n)];
  });
  const hi = out.reduce((h, q) => q[1] - q[2] < h[1] - h[2] ? q : h);
  const top = Math.min(...out.map(([, y, r]) => y - r * 0.78));
  sec.label = [(cx + hi[0]) / 2, top - 22];
  return out;
}

// LAYOUT: anchors per sector, from the groups that have a shown page.
// The game sector also carries the in-page stars (GAME_STARS) in group 0.
const LAYOUT = {};
{
  const pages = allPages();
  SECTORS.forEach(sec => {
    const counts = [];
    const seen = new Map();
    pages.filter(p => p.sector === sec).forEach(p => {
      const k = p.cluster + '\u0000' + p.group;
      if (!seen.has(k)) { seen.set(k, counts.length); counts.push(0); }
      counts[seen.get(k)]++;
    });
    if (sec.id === 'game' && counts.length) counts[0] += GAME_STARS.length;
    LAYOUT[sec.id] = counts.length ? layoutFor(sec, counts) : [[sec.at[0], sec.at[1], 0]];
  });
}

Object.assign(O, { EXCLUDED, DIRECTORY_ONLY, CREDITS, PORTS, searchPages, THUMBS, SECTORS, REGION_BANDS, LAYOUT, GAME_STARS, BLURBS, FEATURED, allPages });
})(window.Observatory = window.Observatory || {});

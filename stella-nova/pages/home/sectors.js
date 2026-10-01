// ============================================================================
//  SECTORS  ·  the seven constellations of the home star chart
// ----------------------------------------------------------------------------
//  NAV (nav-data.js) is the shell sidebar. This file maps its clusters to
//  seven sectors and adds what the chart needs: a color, a glyph, a blurb,
//  featured keys, and a layout box in chart units (1000 x 620).
//
//  Classic script, no ES modules, so the page also runs on file://.
//  Load order: thumbs/list.js, nav-data.js, sectors.js, main.js (all defer).
//  It reads O.NAV and O.THUMB_KEYS and adds its exports to O
//  (O = window.Observatory).
//
//  grep -n targets
//    sector table ......... "const SECTORS"
//    page blurbs .......... "const BLURBS"
//    thumbnail keys ....... "const THUMBS"
//    featured rail ........ "const FEATURED"
//    flat page list ....... "function allPages"
//    excluded pages ....... "const EXCLUDED"
//    directory-only ....... "const DIRECTORY_ONLY"
// ============================================================================
(function (O) {
'use strict';
const NAV = O.NAV;
const THUMB_KEYS = O.THUMB_KEYS || [];

// Pages the home never points at. They stay in the shell sidebar, so they
// are still reachable there. Reason: each one is a port of code we did not
// write.
const EXCLUDED = new Set([
  'mandelbulber',      // port of Mandelbulber2
  'shan-shui',         // port of shan-shui-inf
  'markov-junior',     // port of MarkovJunior
  'holocloth',         // port of Holocloth
  'sdf-clouds',        // port of SDF Clouds
  'refraction-table',  // port of quick-liquid optics
  'thinking-orbs',     // port of RareFormLabs thinking-orbs
  'randoma11y',        // removed from the site
]);
// Pages listed only in the plain directory: no featured spot, quick link,
// thumbnail rail, star or search result. Their origin is being confirmed.
const DIRECTORY_ONLY = new Set(['qave', 'origami']);

// Keys that have a thumbnail in thumbs/<key>.jpg. Others get generated art.
const THUMBS = new Set(THUMB_KEYS);

// One sector per constellation. clusters lists the NAV cluster ids it owns.
// box is the layout area in chart units; sub gives one anchor per NAV group.
const SECTORS = [
  { id: 'game', name: 'The Game', short: 'Game', glyph: '⌂', color: '#ffc832',
    clusters: ['cl-home'],
    blurb: 'Stella Nova is a space-colony sim. Mine ore, smelt alloys, grow a grid station and govern a crew across a solar system that runs on real n-body physics.',
    lead: 'features',
    label: [200, 52] },
  { id: 'wiki', name: 'Interactive Wiki', short: 'Wiki', glyph: '★', color: '#6db8e0',
    clusters: ['cl-crew'],
    blurb: 'The player handbook, live. Plan a station on the real grid, trace every crafting chain, design ships and flags, and see how your crew thinks.',
    lead: 'guide',
    label: [120, 318] },
  { id: 'physics', name: 'Learn About Physics', short: 'Physics', glyph: 'λ', color: '#7cd4ea',
    clusters: ['cl-learn'],
    blurb: 'Interactive simulations you can grab: orbital transfers, black holes, quantum orbitals and circuits, fluids, electromagnetism, optics and chaos.',
    lead: 'hohmann',
    label: [690, 34] },
  { id: 'shader', name: 'Shader Library', short: 'Shaders', glyph: '✦', color: '#e58bd0',
    clusters: ['cl-shader'],
    blurb: 'Live WebGPU and WGSL shader tables: fields, noises, SDF solids, volumetrics, fire, smoke and frost, each with its source one click away.',
    lead: 'sdf-solids',
    label: [560, 392] },
  { id: 'music', name: 'Music Lab', short: 'Music', glyph: '♪', color: '#ff8ac2',
    clusters: ['cl-music'],
    blurb: 'Hear the maths. A live chord detector, harmony wheels and resonance figures that turn vibrating plates into sound you can see.',
    lead: 'chordlab',
    label: [250, 470] },
  { id: 'labs', name: 'Light & Material Labs', short: 'Labs', glyph: '☀', color: '#b896ff',
    clusters: ['cl-solar', 'cl-matlab'],
    blurb: 'Two studio tools: track the sun across any site and season, and author physically based materials with a live preview.',
    lead: 'solar',
    label: [440, 40] },
  { id: 'community', name: 'Community', short: 'Community', glyph: '☉', color: '#64dcc8',
    clusters: ['cl-community'],
    blurb: 'Pages made with and for the people around the game: a tribute, a player-made map of the belt, and the translation terminal.',
    lead: 'starward-belt',
    label: [880, 600] },
];

// Layout: one anchor [x, y, radius] per NAV group, in sector order.
// The game sector also carries the in-page stars (see GAME_STARS).
const LAYOUT = {
  game: [[200, 140, 62], [300, 220, 26]],
  wiki: [[95, 380, 44], [190, 330, 30], [150, 470, 44]],
  physics: [[560, 150, 62], [690, 100, 34], [815, 95, 40], [920, 205, 60],
            [790, 225, 48], [660, 245, 40], [855, 330, 50], [560, 270, 12]],
  // Procedural, Image, Shading, Composition, Volumetric, Surfaces,
  // Elements, Data Visualization (Cloth has no shown page).
  shader: [[420, 470, 50], [500, 560, 26], [590, 420, 28], [640, 555, 12],
           [690, 470, 40], [785, 540, 58], [895, 440, 44], [530, 505, 12]],
  music: [[255, 535, 58]],
  labs: [[420, 95, 26], [490, 120, 14]],
  community: [[950, 575, 26]],
};

// The game constellation also points into this page and to the stores.
const GAME_STARS = [
  { href: '#features', label: 'Features', sub: 'What you command' },
  { href: '#media', label: 'Gameplay', sub: 'Video and screenshots' },
  { href: '#download', label: 'Download the demo', sub: 'Windows and macOS' },
  { href: '#report', label: 'Report a bug', sub: 'Straight to the dev' },
  { href: 'https://store.steampowered.com/app/4474070/Stella_Nova/', label: 'Steam', sub: 'Wishlist and demo', ext: true },
  { href: 'https://discord.gg/SkJDmnRmdJ', label: 'Discord', sub: 'Talk to Dave', ext: true },
];

// Short lines for the pages that appear on cards. Others show their group.
const BLURBS = {
  home: 'This page: the overview and the chart.',
  translate: 'Help put Stella Nova in your language.',
  guide: 'Every module, room and rule of a station.',
  planner: 'Lay out a station on the real game grid.',
  crafting: 'The full 4-tier tree from ore to reactor core.',
  shipdesigner: 'Hull, engines, livery. Build your ship.',
  flagdesigner: 'Design the banner your colony flies.',
  selection: 'How picking and grouping works in game.',
  behaviors: 'The 12 work states behind every citizen.',
  controls: 'Every key and mouse binding.',
  hohmann: 'Plan the cheapest burn between two orbits.',
  leo: 'Thousands of real satellites in low orbit.',
  gravity: 'A Barnes-Hut n-body sandbox. Fling planets.',
  galaxy: 'A spiral galaxy that holds its own arms.',
  forge: 'Sculpt and paint a planet from noise.',
  blackhole: 'Gravitational lensing around a Schwarzschild hole.',
  wormhole: 'Fly through an Ellis wormhole.',
  orbital: 'Hydrogen orbitals in 3D, VR ready.',
  'molecular-bond': 'Watch two atoms share an electron.',
  'hydrogen-table': 'Every hydrogen wave function, side by side.',
  fluidlab: 'Jos Stam stable fluids on the GPU.',
  'ns-flow3d': 'Navier-Stokes in a 3D box.',
  magnetlab: 'Drag magnets and see the field lines.',
  maxwell: 'The four equations, animated.',
  cornell: 'A path tracer in the browser.',
  'double-slit': 'Interference, one photon at a time.',
  attractorlab: 'Lorenz, Rossler, Thomas and friends.',
  'wave-membrane': 'Chladni modes of a vibrating drum.',
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
};

// The "brightest stars" rail: the best single pages across the site.
// Each one is our own code and has a strong, fresh screenshot.
// The Atomic Orbital page leads.
const FEATURED = ['orbital', 'hydrogen-table', 'blackhole', 'galaxy', 'sdf-solids', 'molecular-bond',
  'liquid-metal', 'wave-membrane', 'polar', 'frost', 'magnetlab', 'tidal-currents', 'sdf-lab', 'leo',
  'attractorlab', 'reaction-diffusion'];

// Flatten NAV into page records with their sector, group and badge.
function allPages() {
  const bySector = {};
  SECTORS.forEach(s => s.clusters.forEach(c => { bySector[c] = s; }));
  const out = [];
  NAV.forEach(cl => cl.groups.forEach(g => g.p.forEach(([key, label, badge]) => {
    if (EXCLUDED.has(key) || DIRECTORY_ONLY.has(key)) return;
    out.push({ key, label, badge, group: g.h || cl.label, cluster: cl.label, sector: bySector[cl.id] });
  })));
  return out;
}

Object.assign(O, { EXCLUDED, DIRECTORY_ONLY, THUMBS, SECTORS, LAYOUT, GAME_STARS, BLURBS, FEATURED, allPages });
})(window.Observatory = window.Observatory || {});

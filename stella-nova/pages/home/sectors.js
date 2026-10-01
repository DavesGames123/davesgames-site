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
//  file, to read EXCLUDED.
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
// ============================================================================
(function (O) {
'use strict';
const NAV = window.SN_NAV;
const THUMB_KEYS = O.THUMB_KEYS || [];

// Pages the home never points at. They stay in the shell sidebar, so they
// are still reachable there. Reason: each one is a port of code we did not
// write. tools/nav-sync.js also keeps them out of the home directory.
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

// Chart text per constellation id. at is the centre [x, y] in chart units.
// lead is the page the inspector opens first. The game sector's lead is an
// in-page anchor (#features).
const SECTOR_TEXT = {
  game: { at: [125, 120], lead: 'features',
    blurb: 'Stella Nova is a space-colony sim. Mine ore, smelt alloys, grow a grid station and govern a crew across a solar system that runs on real n-body physics.' },
  wiki: { at: [125, 335], lead: 'wiki',
    blurb: 'The player handbook, live. Look up every item, module and tech, plan a station on the real grid, trace every crafting chain, design ships and flags, and meet your crew.' },
  community: { at: [125, 530], lead: 'starward-belt',
    blurb: 'Pages made with and for the people around the game: a tribute, a player-made map of the belt, the translation tool, and two studio tools for sunlight and materials.' },
  space: { at: [345, 105], lead: 'hohmann',
    blurb: 'Orbits you can plan and planets you can fling: transfer burns, real satellites, an n-body sandbox, a galaxy, a black hole and a wormhole.' },
  quantum: { at: [530, 95], lead: 'orbital',
    blurb: 'Atoms and qubits: hydrogen orbitals in 3D, two atoms that share an electron, and quantum circuits that encode and decode data and images.' },
  life: { at: [705, 100], lead: 'protein-viewer',
    blurb: 'Real protein structures, a chain that folds, how AlphaFold predicts a structure, and a human skull and skeleton you can pull apart.' },
  fluids: { at: [885, 120], lead: 'fluidlab',
    blurb: 'Stable fluids, a wind tunnel, real tidal currents, and the Navier-Stokes equations from 1D to the open blowup question.' },
  fields: { at: [370, 265], lead: 'magnetlab',
    blurb: 'Magnets, currents and Maxwell’s equations, then light itself: aperture diffraction, the double slit and circular polarization.' },
  patterns: { at: [555, 255], lead: 'attractorlab',
    blurb: 'Simple rules, rich results: strange attractors, vector fields, reaction-diffusion, Lenia and the Game of Life.' },
  sound: { at: [735, 270], lead: 'chordlab',
    blurb: 'Hear the maths. A live chord detector, harmony wheels, and resonance figures and drums that turn vibration into shapes you can see.' },
  machines: { at: [905, 290], lead: 'watch-movement',
    blurb: 'Mechanisms that move: a pocket-watch movement that comes apart, and a timepiece generator.' },
  shaders: { at: [395, 495], lead: 'sdf-solids',
    blurb: 'Live WebGPU shader tables in WGSL: noises, fields, colour, lighting, sampling and signed-distance solids, each with its source one click away.' },
  effects: { at: [625, 490], lead: 'fire',
    blurb: 'The visual effects of the game: explosions, engine plumes, beams, fire, smoke, heat haze and frost.' },
  rendering: { at: [855, 495], lead: 'supernova',
    blurb: 'Rendering techniques you can steer: ray marching, sphere tracing, a path tracer, glass and mirrors, volumes and a voxel world.' },
};

// Region bands on the chart: a faint name and the edge of the band.
const REGION_BANDS = [
  { id: 'stella', name: 'Stella Nova', at: [22, 606], edge: 'M250 30 L250 600' },
  { id: 'science', name: 'Science', at: [272, 352], edge: 'M265 368 Q 620 348 985 368' },
  { id: 'graphics', name: 'Graphics', at: [272, 394], edge: null },
];

// One sector per constellation, in nav order.
const SECTORS = [];
NAV.forEach(r => r.constellations.forEach(c => {
  const t = SECTOR_TEXT[c.id] || { at: [500, 310], lead: c.groups[0].p[0][0], blurb: '' };
  SECTORS.push({ id: c.id, name: c.label, short: c.short, glyph: c.icon, color: c.color,
    region: r.id, regionName: r.label, blurb: t.blurb, lead: t.lead, at: t.at, label: t.at });
}));

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
  'watch-movement': 'A pocket watch that runs, then comes apart.',
  'watch-randomizer': 'Roll a pocket watch, wristwatch, wall clock or alarm clock.',
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
  orbital: 'Hydrogen orbitals in 3D, VR ready.',
  'molecular-bond': 'Watch two atoms share an electron.',
  'hydrogen-table': 'Every hydrogen wave function, side by side.',
  'protein-viewer': 'Real protein structures in 3D, 37 presets.',
  'protein-folding': 'Watch a chain fold into its native shape.',
  alphafold: 'How AlphaFold turns a sequence into a structure.',
  'human-skull': 'A human skull in 51 parts, pulled apart.',
  'human-skeleton': 'Explode a skeleton and inspect all 200 bones.',
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

// Flatten SN_NAV into page records with their sector, group and badge.
function allPages() {
  const bySector = Object.fromEntries(SECTORS.map(s => [s.id, s]));
  const out = [];
  window.snPages().forEach(p => {
    if (EXCLUDED.has(p.key) || DIRECTORY_ONLY.has(p.key)) return;
    out.push({ key: p.key, label: p.label, badge: p.badge, group: p.group.h || p.con.label, cluster: p.con.label, sector: bySector[p.con.id] });
  });
  return out;
}

// Anchors [x, y, radius] for the groups the chart shows. A sector with one
// group sits on its centre. More groups sit on a ring around the centre.
// The radius grows with the star count, so a big group gets more room.
// The label goes above the top of the constellation.
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
    const a = a0 + i * 2 * Math.PI / counts.length;
    return [cx + Math.cos(a) * ring * 1.25, cy + Math.sin(a) * ring * 0.8, rad(n)];
  });
  const top = Math.min(...out.map(([, y, r]) => y - r * 0.78));
  sec.label = [cx, top - 22];
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

Object.assign(O, { EXCLUDED, DIRECTORY_ONLY, THUMBS, SECTORS, REGION_BANDS, LAYOUT, GAME_STARS, BLURBS, FEATURED, allPages });
})(window.Observatory = window.Observatory || {});

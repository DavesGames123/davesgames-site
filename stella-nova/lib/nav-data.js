// ============================================================================
//  NAV DATA  ·  the one page registry of the Stella Nova shell
// ----------------------------------------------------------------------------
//  Every page of the shell is in this file, and only here. Three readers use
//  it:
//    index.html (shell)   builds the sidebar, PAGES (key -> path) and LABELS
//    pages/home/          builds the star chart, sector cards, search, chips
//    tools/nav-sync.js    writes the home directory and the sector colours,
//                         and checks that every page directory is registered
//
//  Shape: region -> constellation -> group -> page.
//    region         a heading in the sidebar, a band of sky on the home chart
//    constellation  a collapsible sidebar section, one star group on the chart
//    group          a sub-heading (h may be null), one asterism on the chart
//    page           [key, label, badge, dir]. dir is the folder under pages/.
//                   When dir is absent, it is the same as key.
//
//  Classic script, no ES modules, so the home page also runs on file://.
//  It sets window.SN_NAV, window.SN_XR, window.SN_CRAFT, window.SN_HIDDEN
//  and window.snPages.
//
//  To add a page: add one row to a group, then run
//    node tools/nav-sync.js
//
//  grep -n targets
//    region table ......... "window.SN_NAV ="
//    one region ........... "{ id: \"science\""
//    flat page list ....... "function snPages"
//    XR pages ............. "w.SN_XR ="
//    Craft pages .......... "w.SN_CRAFT ="
//    hidden pages ......... "w.SN_HIDDEN ="
// ============================================================================
(function (w) {
'use strict';
w.SN_NAV = [
{ id: "stella", label: "Stella Nova", constellations: [
  { id: "game", label: "The Game", short: "Game", icon: "⌂", color: "#ffc832", color2: "#ff8a3d", groups: [
    { h: null, p: [
      ["home", "Overview", null]
    ] }
  ] },
  { id: "wiki", label: "Game Wiki", short: "Wiki", icon: "★", color: "#6db8e0", color2: "#50c8b8", groups: [
    { h: "Reference", p: [
      ["wiki", "Wiki", "NEW"],
      ["research", "Research", "NEW"]
    ] },
    { h: "Station Design", p: [
      ["guide", "Station Guide", null],
      ["planner", "Station Planner", null],
      ["crafting", "Crafting", null]
    ] },
    { h: "Ship & Identity", p: [
      ["shipdesigner", "Ship Designer", "NEW", "ship-designer"],
      ["flagdesigner", "Flag Designer", "NEW", "flag-designer"]
    ] },
    { h: "Gameplay", p: [
      ["selection", "Selection", null],
      ["behaviors", "Behaviors", null],
      ["controls", "Controls", null]
    ] },
    { h: "Crew & Society", p: [
      ["social-dynamics", "Social Dynamics", "NEW"]
    ] }
  ] },
  { id: "community", label: "Community & Tools", short: "Community", icon: "☉", color: "#64dcc8", color2: "#64c8f0", groups: [
    { h: "From the Community", p: [
      ["fortom", "For Tom", null, "for-tom"],
      ["starward-belt", "Starward Belt", "MAP"]
    ] },
    { h: "Help Translate", id: "translate-cycle", p: [
      ["translate", "Translation Tool", "i18n"]
    ] },
    { h: "Studio Tools", p: [
      ["solar", "Solar Transit Study", "TOOL"],
      ["matlab", "PBR Material Studio", "TOOL", "material-studio"]
    ] },
    { h: "Live Data", p: [
      ["flight-board", "Flight Board", "LIVE"]
    ] }
  ] }
] },
{ id: "science", label: "Science", constellations: [
  { id: "space", label: "Space & Gravity", short: "Space", icon: "☾", color: "#60b0f0", color2: "#ffc864", groups: [
    { h: "Planets & Orbits", p: [
      ["hohmann", "Hohmann Transfer", "SIM"],
      ["leo", "LEO Catalog", "NEW", "leo-catalog"],
      ["gravity", "Gravity Sim", "SIM"],
      ["forge", "Planet Forge", "GPU"],
      ["roche-limit", "Roche Limit", "SIM"]
    ] },
    { h: "Deep Space", p: [
      ["galaxy", "Galaxy", "SIM"],
      ["blackhole", "Black Hole", "GPU"],
      ["wormhole", "Wormhole", "GPU", "ellis-wormhole"],
      ["chandrasekhar-limit", "Chandrasekhar Limit", "NEW"]
    ] }
  ] },
  { id: "quantum", label: "Quantum", short: "Quantum", icon: "ψ", color: "#9088e0", color2: "#64b4ff", groups: [
    { h: "Atoms & Molecules", p: [
      ["orbital", "Atomic Orbital", "VR", "atomic-orbital-vr"],
      ["molecular-bond", "Molecular Bond", "SIM"],
      ["hydrogen-table", "Hydrogen Wave Function", "NEW"],
      ["molecules", "Molecule Explorer", "2D/3D"],
      ["reactions", "Reaction Explorer", "NEW"]
    ] },
    { h: "Quantum Computing", p: [
      ["qave", "Quantum Algorithm Visualizer", "3D", "quantum-algorithm-visualizer"],
      ["qft-flow", "Quantum Encoding", "MATH"],
      ["qft-store", "Quantum Decoding", "DATA"],
      ["frqi", "Quantum Image Encoding", "IMG", "frqi-quantum-image-lab"]
    ] },
    { h: "Particle Physics", p: [
      ["particle-collider", "Particle Collider", "SIM"]
    ] }
  ] },
  { id: "life", label: "Life Sciences", short: "Life", icon: "✿", color: "#6cd6a8", color2: "#e8d2a8", groups: [
    { h: "Proteins", p: [
      ["protein-viewer", "Protein Structure", "3D"],
      ["protein-folding", "Protein Folding", "SIM"]
    ] },
    { h: "Viruses & Prions", p: [
      ["virus-atlas", "Virus Atlas", "3D"]
    ] },
    { h: "Anatomy", p: [
      ["human-skull", "Human Skull", "3D"],
      ["human-skeleton", "Human Skeleton", "3D"]
    ] },
    { h: "Deep Time", p: [
      ["ancient-earth", "Ancient Earth", "3D"]
    ] },
    { h: "Epidemiology", p: [
      ["outbreak", "Outbreak", "SIM"]
    ] }
  ] },
  { id: "fluids", label: "Fluids", short: "Fluids", icon: "≈", color: "#50c0ff", color2: "#64dcc8", groups: [
    { h: "Flow", p: [
      ["fluidlab", "Stable Fluids", "GPU"],
      ["wind-tunnel", "Wind Tunnel", "CFD"]
    ] },
    { h: "Earth & Ocean", p: [
      ["tidal-currents", "Tidal Currents", "DATA"],
      ["city-atlas", "City Atlas", "3D"],
      ["map-generator", "City Generator", "3D"],
      ["storm-globe", "Storm Globe", "DATA"],
      ["map-projections", "Map Projections", "MATH"]
    ] },
    { h: "Navier–Stokes", p: [
      ["ns-equations", "Navier–Stokes 1D", "MATH"],
      ["ns-burgers", "Burgers Equation", "SIM"],
      ["ns-flow2d", "Navier–Stokes 2D", "SIM"],
      ["ns-flow3d", "Navier–Stokes 3D", "SIM"]
    ] },
    { h: "Blowup", p: [
      ["ns-wave", "Blowup: Wave", "MATH"],
      ["ns-geometry", "Blowup: Geometry", "SIM"],
      ["ns-vortex", "Blowup: Vortex", "3D"]
    ] }
  ] },
  { id: "fields", label: "Light & Fields", short: "Fields", icon: "∇", color: "#60e0ee", color2: "#ffb478", groups: [
    { h: "Electromagnetism", p: [
      ["magnetlab", "MagnetLab", "NEW"],
      ["biot-savart", "Biot–Savart Law", "NEW"],
      ["maxwell", "Maxwell's Equations", "NEW", "maxwells-equations"],
      ["twenty-to-four", "Twenty to Four", "NEW"],
      ["smith-chart", "Smith Chart", "NEW"],
      ["antenna-fields", "Antenna Fields", "NEW"]
    ] },
    { h: "Optics", p: [
      ["diffraction", "Aperture Diffraction", "NEW", "diffraction-lab"],
      ["double-slit", "Double-Slit Diffraction", "NEW"],
      ["polarization", "Circular Polarization", "NEW", "circular-polarization"],
      ["photon-caustics", "Photon Caustics 2D", "GPU"],
      ["photon-caustics-3d", "Photon Caustics 3D", "GPU"]
    ] }
  ] },
  { id: "patterns", label: "Patterns & Chaos", short: "Patterns", icon: "∞", color: "#9db4ff", color2: "#c490ff", groups: [
    { h: "Chaos", p: [
      ["attractorlab", "Strange Attractors", "3D"],
      ["flowlab", "Vector Fields", "SIM"]
    ] },
    { h: "Emergence", p: [
      ["reaction-diffusion", "Reaction–Diffusion", "GPU"],
      ["lenia", "Lenia", "GPU"],
      ["game-of-life", "Game of Life", "SIM"]
    ] },
    { h: "Number Theory", p: [
      ["ulam-spiral", "Ulam Spiral", "GPU"],
      ["ramanujan-pi", "Ramanujan–Sato Series", "MATH"]
    ]},
    { h: "Geometry & Topology", p: [
      ["hopf-fibration", "Hopf Fibration", "GPU"]
    ] },
    { h: "Probability", p: [
      ["dice", "Dice Lab", "3D"]
    ] }
  ] },
  { id: "sound", label: "Sound & Vibration", short: "Sound", icon: "♪", color: "#ff8ac2", color2: "#ffb478", groups: [
    { h: "Music", p: [
      ["chordlab", "ChordLab", "MIC"],
      ["chordchart", "Chord Chart", "NEW", "chord-chart"],
      ["harmonywheel", "Harmony Wheel", "NEW", "harmony-wheel"]
    ] },
    { h: "Resonance", p: [
      ["resonance-figure", "Resonance Figure", "NEW"],
      ["resonance-table", "Resonance Table", "NEW"],
      ["resonance-3d", "Resonance 3D", "3D"],
      ["wave-membrane", "Standing Wave Membrane", "SIM"],
      ["chladni-plate", "Chladni Plate", "NEW"]
    ] }
  ] },
  { id: "machines", label: "Machines", short: "Machines", icon: "◷", color: "#e6c27a", color2: "#f0b27a", groups: [
    { h: "Engines", p: [
      ["stirling-engine", "Stirling Engine", "3D"],
      ["four-stroke-engine", "Four-Stroke Engine", "3D"],
      ["wankel-engine", "Wankel Rotary Engine", "3D"],
      ["radial-engine", "Radial Engine", "3D"]
    ] },
    { h: "Gears & Transmissions", p: [
      ["differential", "Differential", "3D"],
      ["planetary-gearbox", "Planetary Gearbox", "3D"],
      ["manual-gearbox", "Manual Gearbox", "3D"],
      ["harmonic-drive", "Harmonic & Cycloidal Drives", "3D"],
      ["gear-types", "Gear Types", "3D"],
      ["cvt", "CVT", "3D"],
      ["universal-joints", "Universal & CV Joints", "3D"],
      ["ball-screw", "Ball Screw & Lead Screw", "3D"]
    ] },
    { h: "Linkages & Cams", p: [
      ["geneva-cams", "Geneva Drive & Cams", "3D"],
      ["linkages", "Linkages", "3D"],
      ["spirograph", "Spirograph", "NEW"],
      ["ratchets", "Ratchets & Freewheels", "3D"],
      ["sewing-machine", "Lockstitch Sewing Machine", "3D"]
    ] },
    { h: "Timekeeping", p: [
      ["watch-movement", "Watch Movement", "3D"],
      ["watch-randomizer", "Timepiece Randomizer", "3D"],
      ["pendulum-clock", "Pendulum Clock", "3D"],
      ["antikythera", "Antikythera Mechanism", "3D"]
    ] },
    { h: "Pumps", p: [
      ["pumps", "Positive-Displacement Pumps", "3D"],
      ["swashplate-pump", "Swashplate Piston Pump", "3D"]
    ] },
    { h: "Calculating & Cipher", p: [
      ["calculators", "Pascaline & Curta", "3D"],
      ["curta", "Curta Calculator", "3D"],
      ["enigma-rotors", "Enigma Rotors", "3D"],
      ["pin-tumbler-lock", "Pin Tumbler Lock", "3D"]
    ] },
    { h: "Folding", p: [
      ["origami", "Origami Simulator", "SIM"]
    ] }
  ] },
  { id: "language", label: "Language", short: "Language", icon: "❝", color: "#f2d16b", color2: "#7ee0c3", groups: [
    { h: "Writing", p: [
      ["lose-the-modifier", "Lose the Modifier", "WORDS"]
    ] }
  ] },
  { id: "papers", label: "Research", short: "Research", icon: "¶", color: "#ffa06e", color2: "#c9a7ff", groups: [
    { h: "Astrophysics", p: [
      ["gravitational-imaging", "Gravitational Imaging", "NEW"]
    ] },
    { h: "Machine Learning", p: [
      ["alphafold", "How AlphaFold Works", "ML", "alphafold-explained"],
      ["4d-codebench", "4DCodeBench", "NEW"],
      ["enzyme-design", "De Novo Enzyme Design", "NEW"],
      ["legged-rl", "Legged Robot Gym", "NEW"]
    ] },
    { h: "Medicine", p: [
      ["mrna-vaccine", "The mRNA Vaccine", "NEW"]
    ] }
  ] }
] },
{ id: "graphics", label: "Graphics", constellations: [
  { id: "shaders", label: "Shader Tables", short: "Shaders", icon: "✦", color: "#e58bd0", color2: "#b896ff", groups: [
    { h: "Patterns", p: [
      ["noise", "Noise Table", "WGSL", "noise-table"],
      ["volume-noise", "Volume Noise", "WGSL"],
      ["fields", "Field Table", "COMPUTE", "field-table"],
      ["sims", "Simulation Table", "COMPUTE", "simulation-table"],
      ["dot-field", "Dot Field Table", "WGSL", "dot-field-table"],
      ["polar", "Polar & Lattice Table", "WGSL", "polar-table"],
      ["sdf2d", "SDF 2D Table", "WGSL", "sdf2d-table"]
    ] },
    { h: "Image", p: [
      ["color", "Color Table", "WGSL", "color-table"],
      ["postfx", "Post-Process", "WGSL", "postfx-table"],
      ["sampling", "Sampling Table", "WGSL", "sampling-table"],
      ["halftone", "Halftone", "WGSL"]
    ] },
    { h: "Surfaces", p: [
      ["lighting", "Lighting Table", "WGSL", "lighting-table"],
      ["sdf-solids", "SDF Solids Table", "WGSL", "sdf-solids-table"],
      ["liquid-metal", "Liquid Metal Table", "WGSL", "liquid-metal-table"],
      ["refraction-table", "Refraction Table", "WGSL"]
    ] },
    { h: "Fractals", p: [
      ["fractal-flames", "Fractal Flames", "WGSL"]
    ] },
    { h: "Composition", p: [
      ["bench", "Composition Bench", "NODES", "composition-bench"]
    ] }
  ] },
  { id: "effects", label: "Game Effects", short: "Effects", icon: "✺", color: "#ff9a5c", color2: "#ff5a4a", groups: [
    { h: "Weapons & Engines", p: [
      ["explosion", "Explosion", null],
      ["flare", "Engine Propulsion Effects", null],
      ["beam", "Beam & Decal Table", "WGSL", "beam-table"]
    ] },
    { h: "Fire & Smoke", p: [
      ["fire", "Fire Table", "WGSL", "fire-table"],
      ["fire-ev1", "Fire Table (Evolved 1)", "WGSL", "fire-table-evolved-1"],
      ["smoke", "Smoke Table", "WGSL", "smoke-table"]
    ] },
    { h: "Heat & Frost", p: [
      ["heat-diffraction", "Heat Diffraction", "IMG"],
      ["heat-metal", "Heat Metal", "WGSL"],
      ["frost", "Frost Table", "WGSL", "frost-table"]
    ] }
  ] },
  { id: "rendering", label: "Rendering", short: "Render", icon: "◈", color: "#96c8ff", color2: "#ffb478", groups: [
    { h: "Ray Marching", p: [
      ["supernova", "Fractal Orb", "SHADER", "fractal-orb"],
      ["sdf-lab", "SDF Modeller", "TOOL"],
      ["sphere-tracing", "Sphere Tracing Lab", "LAB"],
      ["mandelbulber", "Mandelbulber", "WGSL"],
      ["sdf-clouds", "SDF Clouds", "GPU"]
    ] },
    { h: "Light Transport", p: [
      ["cornell", "Rendering Engine", "PATH"],
      ["glass-cube", "Refraction", "GPU"],
      ["platonic", "Platonic Mirrors", "SHADER", "platonic-mirrors"],
      ["branched-flow", "Branched Flow", "GPU", "cube_branched_flow"]
    ] },
    { h: "Volumes", p: [
      ["orbs", "Presence Orbs", "WGSL", "presence-orbs"],
      ["thinking-orbs", "Thinking Orbs", "WGSL"],
      ["voxel", "Voxel Flythrough", "GPU", "voxel-flythrough"]
    ] },
    { h: "Generative", p: [
      ["markov-junior", "MarkovJunior", "RULES"],
      ["shan-shui", "Shan Shui", "SVG"],
      ["fishdraw", "Fishdraw", "SVG"],
      ["mushrooms", "Mushroom Draw", "SVG"],
      ["nonflowers", "Nonflowers", "CANVAS"],
      ["context-free", "Context Free", "WASM"],
      ["holocloth", "Holocloth", "CLOTH"],
      ["line-art", "Line Art", "RUST"]
    ] }
  ] }
] },
{ id: "finance", label: "Finance", constellations: [
  { id: "finance", label: "Finance", short: "Finance", icon: "$", color: "#2bd685", color2: "#79acff", groups: [
    { h: "Forecasting", p: [
      ["market-forecast", "Market Forecast", "AI"]
    ] }
  ] }
] },
{ id: "studio", label: "Studio", constellations: [
  { id: "craft", label: "Crafting Apps", short: "Craft", icon: "✎", color: "#7cc4ff", color2: "#ffb86c", groups: [
    { h: "Image", p: [
      ["photocraft", "PhotoCraft", "RUST"],
      ["lightcraft", "LightCraft", "RUST"]
    ] },
    { h: "Vector & Layout", p: [
      ["vectorcraft", "VectorCraft", "RUST"],
      ["designcraft", "DesignCraft", "RUST"],
      ["pattern-designer", "Pattern Designer", "SVG"]
    ] },
    { h: "Video & Motion", p: [
      ["filmcraft", "FilmCraft", "RUST"],
      ["effectcraft", "EffectCraft", "RUST"]
    ] },
    { h: "Documents", p: [
      ["printcraft", "PrintCraft", "RUST"]
    ] }
  ] }
] }
];

// Pages that may start a WebXR session (VR or AR). The shell gives their
// iframe allow="xr-spatial-tracking". Without it, a page in the shell cannot
// ask for a session. tools/nav-sync.js checks that each key is registered.
w.SN_XR = ['orbital', 'human-skeleton', 'human-skull', 'protein-viewer', 'protein-folding', 'leo', 'watch-movement', 'watch-randomizer', 'polarization', 'ns-vortex', 'ns-flow3d', 'attractorlab', 'resonance-3d'];

// Craft Suite pages (lib/craft-host.js). Each one holds an upstream app in a
// child iframe. The shell gives their iframe allow="fullscreen;
// clipboard-read; clipboard-write", so the child can ask for these too.
// tools/nav-sync.js checks that each key is registered.
w.SN_CRAFT = ['photocraft', 'lightcraft', 'vectorcraft', 'designcraft', 'filmcraft', 'effectcraft', 'printcraft'];

// Hidden pages: [key, label, dir]. The shell opens them at #<key>, and
// nothing links to them: they are not in SN_NAV, so snPages(), the sidebar,
// the home chart, search, the saver and the crawler directory never list
// them. tools/nav-sync.js checks that each one has a file.
//   stats   site statistics; the page asks for the key of the sn-stats Worker
w.SN_HIDDEN = [['stats', 'Site Statistics']];

// Flatten SN_NAV into one record per page, in nav order.
function snPages() {
  const out = [];
  w.SN_NAV.forEach(r => r.constellations.forEach(c => c.groups.forEach(g => g.p.forEach(([key, label, badge, dir]) => {
    out.push({ key, label, badge, path: 'pages/' + (dir || key) + '/index.html', region: r, con: c, group: g });
  }))));
  return out;
}
w.snPages = snPages;
})(window);

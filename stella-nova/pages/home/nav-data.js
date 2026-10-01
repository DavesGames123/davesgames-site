// Generated from the shell sidebar in stella-nova/index.html (2026-09-30):
// the nav, cluster by cluster. Each page is [key, label, badge].
// Keep it in step with the shell sidebar. sectors.js decides which keys the
// home page shows (see EXCLUDED and DIRECTORY_ONLY there).
// Classic script: it sets window.Observatory.NAV, so the page also runs on file://.
(window.Observatory = window.Observatory || {}).NAV = [
{ id: "cl-home", label: "Home", groups: [
  { h: null, p: [
    ["home", "Overview", null]] },
  { h: "Help Translate", p: [
    ["translate", "Translation Tool", "i18n"]] }] },
{ id: "cl-crew", label: "Interactive Wiki", groups: [
  { h: "Station Design", p: [
    ["guide", "Station Guide", null],
    ["planner", "Station Planner", null],
    ["crafting", "Crafting", null]] },
  { h: "Ship & Identity", p: [
    ["shipdesigner", "Ship Designer", "NEW"],
    ["flagdesigner", "Flag Designer", "NEW"]] },
  { h: "Gameplay", p: [
    ["selection", "Selection", null],
    ["behaviors", "Behaviors", null],
    ["controls", "Controls", null]] }] },
{ id: "cl-learn", label: "Learn About Physics", groups: [
  { h: "Orbital Mechanics", p: [
    ["hohmann", "Hohmann Transfer", "SIM"],
    ["leo", "LEO Catalog", "NEW"],
    ["gravity", "Gravity Sim", "SIM"],
    ["galaxy", "Galaxy", "SIM"],
    ["forge", "Planet Forge", null],
    ["blackhole", "Black Hole", "GPU"],
    ["wormhole", "Wormhole", "GPU"]] },
  { h: "Quantum & Atomic", p: [
    ["orbital", "Atomic Orbital", "VR"],
    ["molecular-bond", "Molecular Bond", "SIM"],
    ["hydrogen-table", "Hydrogen Wave Function", "NEW"]] },
  { h: "Quantum Computing", p: [
    ["qave", "Quantum Algorithm Visualizer", "3D"],
    ["qft-flow", "Quantum Encoding", "MATH"],
    ["qft-store", "Quantum Decoding", "DATA"],
    ["frqi", "Quantum Image Encoding", "IMG"]] },
  { h: "Fluid Dynamics", p: [
    ["fluidlab", "Stable Fluids", "GPU"],
    ["ns-equations", "Navier–Stokes 1D", "MATH"],
    ["ns-burgers", "Burgers Equation", "SIM"],
    ["ns-flow2d", "Navier–Stokes 2D", "SIM"],
    ["ns-flow3d", "Navier–Stokes 3D", "SIM"],
    ["ns-wave", "Blowup: Wave", "MATH"],
    ["ns-geometry", "Blowup: Geometry", "SIM"],
    ["ns-vortex", "Blowup: Vortex", "3D"]] },
  { h: "Electromagnetism", p: [
    ["magnetlab", "MagnetLab", "NEW"],
    ["biot-savart", "Biot–Savart Law", "NEW"],
    ["maxwell", "Maxwell's Equations", "NEW"],
    ["twenty-to-four", "Twenty to Four", "NEW"],
    ["smith-chart", "Smith Chart", "NEW"]] },
  { h: "Optical Physics", p: [
    ["cornell", "Rendering Engine", "PATH"],
    ["diffraction", "Aperture Diffraction", "NEW"],
    ["double-slit", "Double-Slit Diffraction", "NEW"],
    ["polarization", "Circular Polarization", "NEW"]] },
  { h: "Differential Equations", p: [
    ["attractorlab", "Strange Attractors", "3D"],
    ["flowlab", "Vector Fields", "SIM"],
    ["wave-membrane", "Standing Wave Membrane", "SIM"],
    ["reaction-diffusion", "Reaction–Diffusion", "GPU"],
    ["lenia", "Lenia", "GPU"]] },
  { h: "Folding & Structures", p: [
    ["origami", "Origami Simulator", "SIM"]] },
  { h: "Mechanisms", p: [
    ["watch-movement", "Watch Movement", "3D"]] }] },
{ id: "cl-music", label: "Music Lab", groups: [
  { h: null, p: [
    ["chordlab", "ChordLab", "MIC"],
    ["chordchart", "Chord Chart", "NEW"],
    ["harmonywheel", "Harmony Wheel", "NEW"],
    ["resonance-figure", "Resonance Figure", "NEW"],
    ["resonance-table", "Resonance Table", "NEW"],
    ["resonance-3d", "Resonance 3D", "3D"]] }] },
{ id: "cl-shader", label: "Shader Library", groups: [
  { h: "Procedural Fields", p: [
    ["noise", "Noise Table", "WGSL"],
    ["fields", "Field Table", "COMPUTE"],
    ["sims", "Simulation Table", "COMPUTE"],
    ["dot-field", "Dot Field Table", "WGSL"],
    ["polar", "Polar & Lattice Table", "WGSL"],
    ["shan-shui", "Shan Shui", "SVG"]] },
  { h: "Image & Color", p: [
    ["color", "Color Table", "WGSL"],
    ["postfx", "Post-Process", "WGSL"]] },
  { h: "Shading & Sampling", p: [
    ["lighting", "Lighting Table", "WGSL"],
    ["sampling", "Sampling Table", "WGSL"]] },
  { h: "Composition", p: [
    ["bench", "Composition Bench", "NODES"]] },
  { h: "Volumetric", p: [
    ["supernova", "Fractal Orb", "SHADER"],
    ["orbs", "Presence Orbs", "WGSL"],
    ["thinking-orbs", "Thinking Orbs", "WGSL"],
    ["voxel", "Voxel Flythrough", "GPU"],
    ["branched-flow", "Branched Flow", "GPU"]] },
  { h: "Surfaces & Effects", p: [
    ["platonic", "Platonic Mirrors", "SHADER"],
    ["glass-cube", "Refraction", "GPU"],
    ["refraction-table", "Refraction Table", "WGSL"],
    ["sdf-solids", "SDF Solids Table", "WGSL"],
    ["sdf2d", "SDF 2D Table", "WGSL"],
    ["sdf-lab", "SDF Modeller", "TOOL"],
    ["liquid-metal", "Liquid Metal Table", "WGSL"],
    ["sdf-clouds", "SDF Clouds", "GPU"],
    ["markov-junior", "MarkovJunior", "RULES"],
    ["mandelbulber", "Mandelbulber", "WGSL"],
    ["explosion", "Explosion", null],
    ["flare", "Engine Propulsion Effects", null],
    ["beam", "Beam & Decal Table", "WGSL"]] },
  { h: "Elements", p: [
    ["fire", "Fire Table", "WGSL"],
    ["fire-ev1", "Fire Table (Evolved 1)", "WGSL"],
    ["smoke", "Smoke Table", "WGSL"],
    ["heat-diffraction", "Heat Diffraction", "IMG"],
    ["heat-metal", "Heat Metal", "WGSL"],
    ["frost", "Frost Table", "WGSL"]] },
  { h: "Cloth Simulation", p: [
    ["holocloth", "Holocloth", "CLOTH"]] },
  { h: "Data Visualization", p: [
    ["tidal-currents", "Tidal Currents", "DATA"]] }] },
{ id: "cl-solar", label: "Light Study", groups: [
  { h: null, p: [
    ["solar", "Solar Transit Study", "TOOL"]] }] },
{ id: "cl-matlab", label: "Material Lab", groups: [
  { h: null, p: [
    ["matlab", "PBR Material Studio", "TOOL"]] }] },
{ id: "cl-community", label: "Community", groups: [
  { h: null, p: [
    ["fortom", "For Tom", null],
    ["starward-belt", "Starward Belt", "MAP"],
    ["translate", "Translation Terminal", "i18n"]] }] }
];

// ============================================================================
//  MAGNETLAB  ·  shared state  (classic script, part 1 of 20)
// ----------------------------------------------------------------------------
//  The canvas, its 2D context, the CW/CH unit system, the SIM state bag,
//  the magnet list, the id counter and the pan/zoom camera. Each later part
//  reads these globals. main.js loads this part first.
//
//  grep -n targets: "const canvas", "const SIM", "let magnets", "const CAM",
//                   "function screenToWorld"
// ============================================================================

/* ════════════════════════════════════════════════════════════
   MAGNETLAB — 2D MAGNETIC FIELD SIMULATOR
   CW / CH = logical CSS-pixel dimensions of the canvas.
   All physics, spawning, hit-testing, and rendering use CW/CH.
   ════════════════════════════════════════════════════════════ */

// The canvas and its 2D context. CW/CH track the wrapper's CSS size and are the
// unit system for all physics, spawning, hit-testing, and rendering.
const canvas = document.getElementById('sim-canvas');
const ctx = canvas.getContext('2d');
let CW = 100, CH = 100;

// The one mutable state bag: display toggles, tracer tuning, the physics
// timestep, velocity damping factors, and which magnet is selected.
const SIM = {
  playing:true, showTracers:true, showArrows:true, showHeatmap:false,
  tracerCount:2500, tracerSpeed:1.5, tracerTrail:40,
  // Screensaver-only layers: trMode is the tracer colour mode (see TR_FS),
  // showFilings draws the iron-filings layer (renderFilings).
  trMode:0, showFilings:false,
  dt:1/60, damping:0.97, angDamping:0.85, selectedId:-1,
};

// The scene: all magnets, all tracer particles, and a monotonic id counter.
let magnets=[], tracers=[], nextId=0;

/* ═══ CAMERA / VIEWPORT ═══ */
const CAM = { x:0, y:0, zoom:1 }; // x,y = world offset from center, zoom = scale factor

// Invert the camera transform: map a screen pixel back to a world coordinate.
// Used by input handling and by the spawn/visibility tests below.
function screenToWorld(sx, sy){
  return [(sx - CW/2) / CAM.zoom + CW/2 - CAM.x,
          (sy - CH/2) / CAM.zoom + CH/2 - CAM.y];
}

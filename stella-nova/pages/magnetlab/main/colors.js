// ============================================================================
//  MAGNETLAB  ·  field colour ramp  (part 6 of 20)
// ----------------------------------------------------------------------------
//  The six-stop |B| ramp. The 2D layers, the 2D tracer buckets and the
//  GLSL ramp of tracer-shaders.js all read FIELD_RAMP_STOPS.
//
//  grep -n targets: "const FIELD_RAMP_STOPS", "function rampStopRGB", "function fieldColorRGB",
//                   "function fieldColorCSS"
// ============================================================================

/* ═══ COLORS — ported from orbital viewer's B-field tracer system ═══ */
// Returns [r,g,b] in 0-1 range, matching the orbital viewer exactly
// Ramp: dark-purple → blue → cyan → green → orange → white
// Map a field magnitude to an [r,g,b] ramp. A log curve compresses the huge
// dynamic range of a 1/r³ field, gamma reshapes it, and the result indexes a
// six-stop colour ramp from dark purple through to white.
// Map a normalized level 0..1 to the six-stop ramp. Both the tracer color
// buckets and fieldColorRGB read this one stop table, so the ramp has a single
// source. lc is the already-shaped level (log + gamma done by the caller).
const FIELD_RAMP_STOPS = [[0.05,0,0.3],[0,0.2,1],[0,1,0.8],[0.2,1,0],[1,0.5,0],[1,1,1]];
function rampStopRGB(lc){
  const sv = lc * 5, si = Math.min(Math.floor(sv), 4), sf = sv - si;
  return [
    FIELD_RAMP_STOPS[si][0] + sf * (FIELD_RAMP_STOPS[si+1][0] - FIELD_RAMP_STOPS[si][0]),
    FIELD_RAMP_STOPS[si][1] + sf * (FIELD_RAMP_STOPS[si+1][1] - FIELD_RAMP_STOPS[si][1]),
    FIELD_RAMP_STOPS[si][2] + sf * (FIELD_RAMP_STOPS[si+1][2] - FIELD_RAMP_STOPS[si][2])
  ];
}
function fieldColorRGB(mag, gamma){
  gamma = gamma || 1.0;
  const lv = Math.log10(1 + mag * 8) / 2.2;
  const lc = Math.pow(Math.max(0, Math.min(1, lv)), 1 / Math.max(0.1, gamma));
  return rampStopRGB(lc);
}
// Same ramp as fieldColorRGB, formatted as an rgba() string at the given alpha.
function fieldColorCSS(mag, alpha, gamma){
  const [r,g,b] = fieldColorRGB(mag, gamma);
  return `rgba(${(r*255)|0},${(g*255)|0},${(b*255)|0},${alpha})`;
}

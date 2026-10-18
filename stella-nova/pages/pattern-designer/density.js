// ============================================================================
//  PATTERN DESIGNER  ·  density.js — the Density and Detail controls (no DOM)
// ----------------------------------------------------------------------------
//  DENSITY D is a linear frequency factor on top of the pattern sliders.
//  D 2 gives twice the cells per side, twice the lines per unit and twice
//  the rings, so a 2D lattice gets about four times the motifs. D 1 is the
//  pattern as its sliders say. run() (engine.js) applies densify() after
//  clampParams(), so the sliders keep their own values and ranges.
//
//  SPEC. DENSE[id] maps a param key to a rule:
//    e            v * D^e. e 1: a count per side or per unit. e 2: a
//                 count over the area. e -1: a spacing or a size.
//    [e, lim]     the same, with a hard limit (a ceiling for e > 0, a
//                 floor for e < 0) that keeps the run inside the time
//                 budget. With no lim, the ceiling is 2 x the slider
//                 maximum and the floor is 0.5 x the slider minimum.
//    '+a'         v + round(a * log2 D), for recursion depth and curve
//                 order, clamped to the slider range plus one level.
//  $thin false    the pattern uses the line weight as a geometric width
//                 (arc thickness, a maze path), so the weight factor of
//                 thinFactor() does not apply.
//
//  DETAIL (0..1) sets the echo pass in engine.js: inner outlines inside
//  closed convex motifs, so solid tiles and discs get a layered inner
//  pattern. Detail 0 turns the pass off.
//
//  CAPS. densityCap(coarse) gives the highest D for a device class. A
//  phone (coarse pointer) gets a lower cap and a lower element cap
//  (runCap), so memory stays bounded.
//
//  grep -n targets
//    limits ............... "export const DENSITY"
//    per-pattern rules .... "export const DENSE"
//    apply ................ "export function densify"
//    line weight factor ... "export function thinFactor"
//    device caps .......... "export function densityCap"  "export function runCap"
// ============================================================================
export const DENSITY = { min: 0.5, max: 4, step: 0.05, def: 2.2, phoneMax: 2.4, phoneDef: 1.8, saver: 2, thumb: 1.8 };
export const DETAIL = { min: 0, max: 1, step: 0.05, def: 0.5 };

export const DENSE = {
  // grid
  'arc-lattice': { cells: 1 },
  'split-squares': { cells: 1 },
  'running-bond': { rows: 1 },
  'dot-interference': { cells: [1, 160] },
  'basket-weave': { strips: 1 },
  'module-grid': { cells: 1, depth: '+0.5' },
  'plus-field': { cells: [1, 110] },
  'type-rhythm': { rows: 1, cols: 0.5 },
  'greeked-columns': { lead: -1, cols: 0.5 },
  // flow
  'curl-streams': { sep: [-1, 5] },
  'flow-ribbons': { count: [2, 2400], width: -1, length: -0.5 },
  'contour-bands': { levels: [1, 40] },
  'vortex-lines': { sep: [-1, 5] },
  'field-hairs': { cells: [1, 220] },
  'drift-strata': { rows: [1, 220] },
  'topo-lines': { interval: [1, 100] },
  // radial
  'phase-rings': { rings: [1, 220] },
  'rose-stack': { layers: [1, 24] },
  'epicycle-loops': { copies: [1, 24] },
  'ray-burst': { rays: [1, 240] },
  'seed-head': { seeds: [2, 14000] },
  'arc-rings': { rings: [1, 110], parts: [0.5, 24], $thin: false },
  'moire-rings': { gap: [-1, 2] },
  // texture
  'grain-stipple': { grain: [-1, 2.5] },
  'screen-dots': { cells: [1, 150] },
  'line-screen': { lines: [1, 220] },
  'drift-stack': { lines: [1, 260] },
  'tone-hatch': { spacing: [-1, 2.5] },
  'signal-bars': { rows: [1, 24], unit: [-1, 1] },
  // iso
  'cube-stacks': { cells: [1, 56] },
  'terraces': { cells: [1, 80] },
  'iso-relief': { cells: [1, 140] },
  'tumbling-blocks': { cells: [1, 56] },
  'iso-towers': { cells: [1, 72] },
  // distort
  'lens-grid': { lines: [1, 160] },
  'twirl-checker': { cells: [1, 80] },
  'sine-stripes': { stripes: [1, 220] },
  'pulled-dots': { cells: [1, 150] },
  'slice-shift': { slices: [1, 220] },
  // organic
  'growth-rings': { nodes: [1, 4400], detail: [-0.5, 0.006] },
  'morphogen': { res: [0.5, 200] },
  'soft-cells': { size: [-1, 0.032] },
  'coral-reach': { food: [-0.7, 0.01], step: [-0.5, 0.004] },
  'frost-bloom': { count: [1, 3200] },
  'lava-blobs': { blobs: [2, 70], size: [-0.8, 0.03], levels: [0.5, 10] },
  // physics
  'circle-pack': { max: [-0.7, 0.03], min: [-0.5, 0.0025] },
  'tension-mesh': { cells: [1, 130] },
  'orbit-trails': { count: [2, 260] },
  'cyclotron': { tracks: [1, 70], vertices: 0.5 },
  'harmonic-trace': { length: [1, 640], traces: 0.5 },
  'charge-field': { lines: [1, 110], equip: [1, 44] },
  // tiling
  'rhomb-inflation': { depth: '+1' },
  'nested-truchet': { cells: [1, 16], depth: '+0.5' },
  'mirror-truchet': { cells: [1, 80] },
  'diagonal-paths': { cells: [1, 120] },
  'hex-arcs': { size: [1, 50] },
  'triangle-wang': { size: [1, 64] },
  'star-rosettes': { size: [1, 22] },
  'cairo-tiles': { size: [1, 36] },
  'herringbone': { rows: [1, 64] },
  // textile
  'sett-plaid': { scale: [-1, 0.15], pitch: [-1, 1.5] },
  'bled-bands': { bands: [1, 18], thread: [-1, 1.5] },
  'bound-rings': { grid: [1, 14], rings: [0.5, 20] },
  'twill-check': { size: [1, 28] },
  'flame-chevron': { bands: [1, 100], peaks: [1, 40] },
  'diamond-overcheck': { across: [1, 18] },
  // geometric
  'guilloche': { lines: [1, 110] },
  'gear-lace': { layers: [1, 10] },
  'lissajous-table': { size: [1, 18] },
  'superformula': { across: [1, 14], layers: [1, 14] },
  'pursuit-polygons': { size: [1, 16], steps: [0.5, 80] },
  'apollonian': { minR: [-1, 0.4] },
  // op art
  'moire-lines': { spacing: [-1, 2] },
  'drift-tunnel': { rings: [1, 160] },
  'wave-bands': { bands: [1, 150] },
  'turning-squares': { cells: [1, 40], nests: [0.5, 12] },
  // botanical
  'leaf-spiral': { count: [2, 3000] },
  'bracket-plants': { plants: [1, 16], steps: '+0.5' },
  'leaf-venation': { sources: [1.5, 1500], step: [-0.5, 0.009], reach: [-0.5, 0.06] },
  'fern-fronds': { fronds: [1, 10], pairs: [1, 50] },
  // paths
  'maze-walls': { cells: [1, 150], $thin: false },
  'ring-labyrinth': { rings: [1, 70], first: 0.5 },
  'hilbert-path': { order: '+1' },
  'flowsnake': { order: '+1' },
  'peano-weave': { order: '+1', $thin: false },
  // mesh
  'delaunay-mesh': { points: [2, 3600] },
  'lead-glass': { cells: [2, 1800] },
  'rect-split': { depth: '+1.5', min: [-1, 0.012] },
  'crackle': { cracks: [2, 1400] },
};

export const clampD = (D, cap = DENSITY.max) => {
  const v = Number.isFinite(+D) ? +D : 1;
  return Math.max(DENSITY.min, Math.min(cap, v));
};
export const clampDetail = v => Math.max(DETAIL.min, Math.min(DETAIL.max, Number.isFinite(+v) ? +v : 0));

// The params a pattern gets at density D. P must be clamped already.
export function densify(pat, P, D) {
  D = clampD(D);
  const spec = DENSE[pat.id];
  if (!spec || D === 1) return P;
  const Q = Object.assign({}, P), L2 = Math.log2(D);
  for (const k in spec) {
    if (k[0] === '$' || !pat.params[k]) continue;
    const [a, b, st] = pat.params[k], r = spec[k];
    let v = P[k];
    if (typeof r === 'string') {
      v = Math.max(a, Math.min(b + 1, v + Math.round(parseFloat(r.slice(1)) * L2)));
    } else {
      const [e, lim] = Array.isArray(r) ? r : [r, null];
      v *= Math.pow(D, e);
      if (e > 0) v = Math.min(v, lim ?? b * 2);
      else v = Math.max(v, lim ?? a * 0.5);
      // A pattern at a slider value past its limit keeps that value.
      if (e > 0 && P[k] > v) v = P[k];
      if (e < 0 && P[k] < v) v = P[k];
    }
    if (st >= 1) v = Math.round(v);
    Q[k] = v;
  }
  return Q;
}
// The line weight factor at density D: finer lines as the motifs get
// smaller. 1 for a pattern with $thin false.
export function thinFactor(pat, D) {
  const s = DENSE[pat.id];
  if (s && s.$thin === false) return 1;
  return Math.pow(clampD(D), -0.5);
}
export const densityCap = coarse => coarse ? DENSITY.phoneMax : DENSITY.max;
export const densityDefault = coarse => coarse ? DENSITY.phoneDef : DENSITY.def;
// The element cap of one run: lower on a phone.
export function runCap(coarse) {
  return coarse ? { nodes: 70000, points: 900000 } : { nodes: 160000, points: 2400000 };
}

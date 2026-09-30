// data.js — the Starward Belt chart as data. No DOM, no GPU.
//
// World units are the pixels of a 1351 x 1999 chart, origin top-left,
// y down. The field shader, the SVG overlay and the camera all read these
// numbers, so a change here moves every layer at once.
//
// grep: WORLD  RAIL  TIERS  NODES  ROUTES  HATCH  CLOUDS

export const WORLD = { w: 1351, h: 1999 };

// The belt runs from the lower left to the upper right. The rails are
// parallel lines along the belt axis. The camera slides along the axis.
export const RAIL = {
  a: { x: 330, y: 1860 },          // lower end of the belt axis
  b: { x: 1000, y: 180 },          // upper end of the belt axis
  spacing: 118,                     // gap between rails, world units, across the axis
  lateral: 260,                     // max camera drift across the axis
};

// Route tiers. A route draws in the color of the tier that it needs.
export const TIERS = [
  { id: 'none',   label: 'No upgrades required', color: '#f2f2f2' },
  { id: 'haznav', label: 'Haznav suite',         color: '#f5c518' },
  { id: 'engine', label: '+Engine upgrade',      color: '#34d8b0' },
  { id: 'spoof',  label: '+Spoof transponder',   color: '#e8365d' },
];

// size: 'm' marks the normal station, 'l' the large hub (Darkside).
// ring: radius of the dashed approach ring, world units.
// label: centre of the name, CSS px from the node at the fit zoom. The
// overlay scales it with the station, so it stays in the same gap between
// the routes at every zoom.
export const NODES = [
  { id: 'wellspring',  name: 'Wellspring',   x: 905,  y: 393,  size: 'm', ring: 78, label: { dx:   10, dy:  -28 } },
  { id: 'holms-rock',  name: "Holm's Rock",  x: 1010, y: 684,  size: 'm', ring: 78, label: { dx:   44, dy:  -42 } },
  { id: 'flotsam',     name: 'Flotsam',      x: 664,  y: 692,  size: 'm', ring: 78, label: { dx:  -58, dy:   18 } },
  { id: 'far-spindle', name: 'Far Spindle',  x: 777,  y: 849,  size: 'm', ring: 78, label: { dx:  -80, dy:  -12 } },
  { id: 'helion-gate', name: 'Helion Gate',  x: 953,  y: 970,  size: 'm', ring: 78, label: { dx:   40, dy:   40 } },
  { id: 'scatteryards',name: 'Scatteryards', x: 435,  y: 1051, size: 'm', ring: 78, label: { dx:  -36, dy:  -50 } },
  { id: 'darkside',    name: 'Darkside',     x: 674,  y: 1121, size: 'l', ring: 78, label: { dx:  -36, dy:  -42 } },
  { id: 'greenbelt',   name: 'Greenbelt',    x: 806,  y: 1282, size: 'm', ring: 78, label: { dx:   -4, dy:   28 } },
  { id: 'the-hollow',  name: 'The Hollow',   x: 432,  y: 1361, size: 'm', ring: 78, label: { dx:   52, dy:   28 } },
  { id: 'olivera',     name: 'Olivera',      x: 405,  y: 1605, size: 'm', ring: 78, label: { dx:  -23, dy:   27 } },
];

// cost: the fuel cost of the jump, shown in the tag as a negative number.
// at: where the tag sits along the route, 0 = from, 1 = to.
// bend: optional sideways bow of the route, world units (0 = straight).
// A positive bend bows to the right of the from -> to direction, as seen on
// the chart (y down). Scatteryards -> Olivera bows west of The Hollow.
export const ROUTES = [
  { from: 'wellspring',   to: 'flotsam',     tier: 'haznav', cost: 8,  at: 0.52 },
  { from: 'wellspring',   to: 'far-spindle', tier: 'haznav', cost: 9,  at: 0.49 },
  { from: 'wellspring',   to: 'holms-rock',  tier: 'none',   cost: 6,  at: 0.52 },
  { from: 'wellspring',   to: 'helion-gate', tier: 'engine', cost: 11, at: 0.55 },
  { from: 'flotsam',      to: 'holms-rock',  tier: 'none',   cost: 7,  at: 0.52 },
  { from: 'flotsam',      to: 'far-spindle', tier: 'none',   cost: 4,  at: 0.49 },
  { from: 'flotsam',      to: 'helion-gate', tier: 'none',   cost: 8,  at: 0.58 },
  { from: 'far-spindle',  to: 'helion-gate', tier: 'none',   cost: 4,  at: 0.50 },
  { from: 'far-spindle',  to: 'holms-rock',  tier: 'haznav', cost: 6,  at: 0.52 },
  { from: 'holms-rock',   to: 'helion-gate', tier: 'none',   cost: 6,  at: 0.50 },
  { from: 'holms-rock',   to: 'greenbelt',   tier: 'engine', cost: 12, at: 0.63 },
  { from: 'helion-gate',  to: 'greenbelt',   tier: 'none',   cost: 7,  at: 0.50 },
  { from: 'flotsam',      to: 'scatteryards',tier: 'haznav', cost: 8,  at: 0.50 },
  { from: 'flotsam',      to: 'the-hollow',  tier: 'engine', cost: 14, at: 0.42 },
  { from: 'scatteryards', to: 'darkside',    tier: 'spoof',  cost: 5,  at: 0.50 },
  { from: 'scatteryards', to: 'greenbelt',   tier: 'spoof',  cost: 9,  at: 0.39 },
  { from: 'scatteryards', to: 'the-hollow',  tier: 'none',   cost: 6,  at: 0.52 },
  { from: 'scatteryards', to: 'olivera',     tier: 'engine', cost: 11, at: 0.61, bend: 44 },
  { from: 'darkside',     to: 'helion-gate', tier: 'spoof',  cost: 6,  at: 0.50 },
  { from: 'the-hollow',   to: 'helion-gate', tier: 'spoof',  cost: 13, at: 0.66 },
  { from: 'darkside',     to: 'the-hollow',  tier: 'spoof',  cost: 7,  at: 0.50 },
  { from: 'the-hollow',   to: 'greenbelt',   tier: 'haznav', cost: 8,  at: 0.51 },
  { from: 'the-hollow',   to: 'olivera',     tier: 'haznav', cost: 5,  at: 0.47 },
];

// Hatched hazard regions. Each region is a smooth union of discs (x, y, r),
// blended with the smooth-min radius k. The shader fills the union with
// diagonal hatch lines and strokes the outline.
export const HATCH = [
  { id: 'crescent', k: 46, discs: [
    [650, 925, 46], [700, 960, 44], [745, 990, 36], [785, 985, 22], [620, 900, 30],
  ] },
  { id: 'teardrop', k: 60, discs: [
    [510, 1490, 38], [545, 1545, 62], [560, 1610, 58], [520, 1650, 34],
  ] },
];

// Dust clouds: anisotropic gaussians along the belt. The shader sums them
// with fbm noise to get asteroid density. rx is along the belt axis and
// ry across it, both world units. w scales the peak.
export const CLOUDS = [
  { x: 880,  y: 420,  rx: 210, ry: 120, w: 1.0 },
  { x: 1010, y: 520,  rx: 120, ry: 70,  w: 0.8 },
  { x: 760,  y: 680,  rx: 170, ry: 90,  w: 0.9 },
  { x: 620,  y: 900,  rx: 190, ry: 110, w: 1.0 },
  { x: 900,  y: 900,  rx: 120, ry: 70,  w: 0.6 },
  { x: 560,  y: 1180, rx: 160, ry: 90,  w: 0.7 },
  { x: 480,  y: 1440, rx: 220, ry: 140, w: 1.0 },
  { x: 380,  y: 1560, rx: 180, ry: 120, w: 1.1 },
  { x: 430,  y: 1760, rx: 200, ry: 110, w: 0.9 },
];

// Lookup helpers shared by the overlay and the route solver.
export const NODE_BY_ID = Object.fromEntries(NODES.map(n => [n.id, n]));
export const TIER_BY_ID = Object.fromEntries(TIERS.map(t => [t.id, t]));

// ============================================================================
//  MANUAL GEARBOX  ·  box.js — gear sizes, ratios, mesh phases, shifts (no DOM)
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm and
//  rad. The main shaft lies on the x axis; the layshaft is CD = 90 mm below
//  it (y = -CD). All gears are spur gears of module M = 3, and every pair
//  has N_main + N_lay = 60 teeth, so every pair has the same centre
//  distance M (N_main + N_lay) / 2 = 90 mm.
//
//  POWER FLOW (constant mesh)
//    The input gear (24 t) drives the layshaft gear (36 t) all the time.
//    The layshaft drives a free gear on the main shaft for each of 1st,
//    2nd, 3rd and 5th: they all turn, all the time, at their own speed.
//    A synchro sleeve, splined to a hub on the main shaft, slides onto the
//    dog teeth of one free gear and locks it to the main shaft. 4th locks
//    the main shaft to the input gear itself (direct drive, 1 : 1).
//      ratio(g) = (36 / 24) * (N_main / N_lay)
//
//  MESH PHASE. Main-shaft gears have tooth 0 on -y at angle 0 (toward the
//  layshaft); layshaft gears have tooth 0 on +y. Both spin about +x. For a
//  driver at angle a with N_a teeth and a driven gear with N_b teeth:
//      b = pi / N_b - (N_a / N_b) a
//  At a = 0 a tooth of the driver and a gap of the driven gear are both on
//  the contact line, and the two pitch circles roll without slip.
//
//  GREP MAP
//    export const SPEC ......... module, teeth, x places of gears and hubs
//    export const GEARS ........ the forward gears: pair, hub, side
//    export function ratio ..... overall ratio of a gear
//    export function meshAngle . the mesh phase rule
//    export function angles .... every gear angle from the input angle
//    export function sleeveX ... sleeve offsets for an engaged gear
// ============================================================================

export const TAU = Math.PI * 2;
export const M = 3, CD = 90;

// x spans (mm) of each gear face; dogs sit on the face toward the hub
export const SPEC = {
  input: { N: 24, x: [0, 18] }, layIn: { N: 36, x: [0, 18] },
  pairs: {
    1: { main: 40, lay: 20, x: [124, 142] },
    2: { main: 35, lay: 25, x: [74, 92] },
    3: { main: 30, lay: 30, x: [50, 68] },
    5: { main: 22, lay: 38, x: [150, 168] },
  },
  // synchro hubs: centre x, the gear on each side (-x side, +x side)
  hubs: {
    h34: { x: 34, w: 16, neg: 4, pos: 3 },
    h12: { x: 108, w: 16, neg: 2, pos: 1 },
    h5: { x: 184, w: 16, neg: 5, pos: null },
  },
  travel: 9,                   // sleeve slide to full dog engagement
  lay: [-10, 176], main: [20, 270], inShaft: [-130, 30],
};
// the forward gears in the order of the shift pattern
export const GEARS = [
  { g: 1, hub: 'h12', side: +1 }, { g: 2, hub: 'h12', side: -1 },
  { g: 3, hub: 'h34', side: +1 }, { g: 4, hub: 'h34', side: -1 },
  { g: 5, hub: 'h5', side: -1 },
];

export function ratio(g) {
  if (g === 4) return 1;
  if (!g) return 0;
  const p = SPEC.pairs[g];
  return (SPEC.layIn.N / SPEC.input.N) * (p.main / p.lay);
}

export const meshAngle = (a, Na, Nb) => Math.PI / Nb - (Na / Nb) * a;

// every gear angle from the input angle (rad). The layshaft cluster turns
// as one; each lay gear has tooth 0 on +y at its own angle 0.
export function angles(thIn) {
  const lay = meshAngle(thIn, SPEC.input.N, SPEC.layIn.N);
  const out = { input: thIn, lay, main: {} };
  for (const g in SPEC.pairs) { const p = SPEC.pairs[g]; out.main[g] = meshAngle(lay, p.lay, p.main); }
  return out;
}
// speed of each main-shaft gear as a multiple of the input speed
export function gearSpeed(g) { return g === 4 ? 1 : 1 / ratio(g); }

// sleeve offsets (mm, along +x) for one engaged gear (0 = neutral), and a
// shift progress k in [0, 1] for the moving sleeve
export function sleeveX(g, k = 1) {
  const out = { h34: 0, h12: 0, h5: 0 };
  const G = GEARS.find(q => q.g === g);
  if (G) out[G.hub] = G.side * SPEC.travel * k;
  return out;
}

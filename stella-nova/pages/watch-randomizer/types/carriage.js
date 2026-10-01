// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  types/carriage.js — carriage clock
// ────────────────────────────────────────────────────────────────────────────
//  The spec side of one case type (no DOM, no THREE; tests.mjs runs it):
//    id, name, weight, clock ..... identity, roll weight, clock or watch
//    calibres ................... [[calibre id, weight]] that fit this case
//    caseSpec(R, calibre) ....... the random case choices
//    describe(spec) ............. rows for the Spec panel
//    palette(spec) .............. kit material overrides for the case
//    dims(spec, dialR) .......... { dialR, R }: the dial size and the radius
//                                 the camera fits (dialR in: the calibre's)
//    layout(spec, own) .......... every case size, shared with the builder
//  cases/carriage.js builds it. A French carriage clock (pendule de voyage,
//  1850-1920): a cast brass frame with glass on all five sides, a mask
//  round the dial, and a folding handle on top.
// ============================================================================
export const CARRIAGE_METALS = { 'gilt brass': '#e2bd72', brass: '#d6a85c', nickel: '#c9ccd2', silver: '#dfe2e8' };

// sizes in mm from the calibre's own dial radius (own)
export function layout(spec, own) {
  const dialR = own * 1.12 + 2, W = 2 * dialR + 26, H = W * 1.42;
  return { dialR, W, H, D: W * 0.8, yBot: -H * 0.6, yTop: H * 0.4, handleH: W * 0.42 };
}

export default {
  id: 'carriage', name: 'Carriage clock', weight: 1.2, clock: true,
  calibres: [['lever', 6], ['cylinder', 2], ['pinlever', 1]],
  layout,
  caseSpec: (R) => ({
    style: R.weighted([['corniche', 5], ['gorge', 3], ['obis', 2]]),
    metal: R.weighted([['gilt brass', 5], ['brass', 3], ['nickel', 1], ['silver', 1]]),
    feet: R.weighted([['bun', 3], ['plinth', 2]]),
  }),
  describe: (spec) => { const c = spec.case; return [['Case', `${c.style} carriage case, ${c.metal}, glass on five sides, ${c.feet === 'bun' ? 'bun feet' : 'stepped plinth'}`]]; },
  palette: (spec) => ({ polished: { color: CARRIAGE_METALS[spec.case.metal], roughness: 0.2 }, satin: { color: CARRIAGE_METALS[spec.case.metal], roughness: 0.34 } }),
  dims: (spec, own) => { const L = layout(spec, own); return { dialR: L.dialR, R: Math.max(L.H + L.handleH + 12, L.W + 10) * 0.56 }; },
};

// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  types/wrist.js — wristwatch
// ────────────────────────────────────────────────────────────────────────────
//  The spec side of one case type (no DOM, no THREE; tests.mjs runs it):
//    id, name, weight, clock ..... identity, roll weight, clock or watch
//    calibres ................... [[calibre id, weight]] that fit this case
//    caseSpec(R, calibre) ....... the random case choices
//    describe(spec) ............. rows for the Spec panel
//    palette(spec) .............. kit material overrides for the case
//    dims(spec, dialR) .......... { dialR, R }: the dial size and the radius
//                                 the camera fits (dialR in: the calibre's)
//  cases/wrist.js builds it.
// ============================================================================
import { METALS, PAINTS, WOODS, LEATHERS } from '../palettes.js';

export default {
  id: 'wrist', name: 'Wristwatch', weight: 3.5, clock: false,
  calibres: [['automatic', 7], ['lever', 1.5], ['tourbillon', 1.5]],
  caseSpec: (R, calibre) => ({
    metal: R.weighted([['steel', 5], ['yellow gold', 2], ['rose gold', 1.5], ['gunmetal', 1.2], ['silver', 1]]),
    shape: calibre === 'automatic' ? R.weighted([['round', 6], ['cushion', 2], ['tonneau', 1.2], ['square', 1.2]]) : R.weighted([['round', 3], ['cushion', 1]]),
    bezel: R.weighted([['smooth', 4], ['coin', 2], ['fluted', 1.5], ['diver', 2]]),
    strap: R.weighted([['leather', 6], ['bracelet', 3], ['mesh', 1.5]]),
    leather: R.pick(Object.keys(LEATHERS)),
    crown: R.pick(['onion', 'fluted']),
  }),
  describe: (spec) => { const c = spec.case; return [['Case', `${c.metal} ${c.shape}, ${c.bezel} bezel, ${c.crown} crown`], ['Strap', c.strap === 'leather' ? `${c.leather} leather` : c.strap === 'bracelet' ? `${c.metal} bracelet` : `${c.metal} mesh`]]; },
  palette: (spec) => { const m = METALS[spec.case.metal]; return { polished: { color: m.color, roughness: m.roughness }, satin: { color: m.color, roughness: 0.32 }, mesh: { color: m.color }, leather: { color: LEATHERS[spec.case.leather] }, thread: { color: spec.case.leather === 'tan' || spec.case.leather === 'brown' ? '#efe2c4' : '#d8d2c4' } }; },
  dims: (spec, dialR) => ({ dialR, R: dialR + 18 }),
};

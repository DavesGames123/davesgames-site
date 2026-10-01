// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  types/pocket.js — pocket watch
// ────────────────────────────────────────────────────────────────────────────
//  The spec side of one case type (no DOM, no THREE; tests.mjs runs it):
//    id, name, weight, clock ..... identity, roll weight, clock or watch
//    calibres ................... [[calibre id, weight]] that fit this case
//    caseSpec(R, calibre) ....... the random case choices
//    describe(spec) ............. rows for the Spec panel
//    palette(spec) .............. kit material overrides for the case
//    dims(spec, dialR) .......... { dialR, R }: the dial size and the radius
//                                 the camera fits (dialR in: the calibre's)
//  cases/pocket.js builds it.
// ============================================================================
import { METALS, PAINTS, WOODS, LEATHERS } from '../palettes.js';

export default {
  id: 'pocket', name: 'Pocket watch', weight: 3, clock: false,
  calibres: [['lever', 5], ['tourbillon', 2], ['verge', 3]],
  caseSpec: (R, calibre) => ({
    metal: R.weighted([['yellow gold', 4], ['silver', 3], ['rose gold', 1.5], ['gunmetal', 1], ['nickel', 1]]),
    style: calibre === 'verge' ? R.weighted([['open face', 7], ['hunter', 3]]) : R.weighted([['open face', 6], ['hunter', 4]]),
    bezel: R.pick(['smooth', 'coin', 'fluted']), crystal: R.weighted([['domed', 3], ['flat', 1]]),
    back: R.weighted([['display', 6], ['hinged', 4]]), bow: R.pick(['round', 'oval']),
  }),
  describe: (spec) => { const c = spec.case; return [['Case', `${c.metal} ${c.style}, ${c.bezel} bezel, ${c.crystal} crystal, ${c.back} back`]]; },
  palette: (spec) => { const m = METALS[spec.case.metal]; return { polished: { color: m.color, roughness: m.roughness }, satin: { color: m.color, roughness: 0.32 } }; },
  dims: (spec, dialR) => ({ dialR, R: dialR + 10 }),
};

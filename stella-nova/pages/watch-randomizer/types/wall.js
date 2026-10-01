// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  types/wall.js — wall clock
// ────────────────────────────────────────────────────────────────────────────
//  The spec side of one case type (no DOM, no THREE; tests.mjs runs it):
//    id, name, weight, clock ..... identity, roll weight, clock or watch
//    calibres ................... [[calibre id, weight]] that fit this case
//    caseSpec(R, calibre) ....... the random case choices
//    describe(spec) ............. rows for the Spec panel
//    palette(spec) .............. kit material overrides for the case
//    dims(spec, dialR) .......... { dialR, R }: the dial size and the radius
//                                 the camera fits (dialR in: the calibre's)
//  cases/wall.js builds it.
// ============================================================================
import { METALS, PAINTS, WOODS, LEATHERS } from '../palettes.js';

const RIM = { schoolhouse: 22, station: 12, kitchen: 11, porthole: 20 };
export default {
  id: 'wall', name: 'Wall clock', weight: 1.5, clock: true,
  calibres: [['automatic', 6], ['lever', 4]],
  caseSpec: (R, calibre) => ({
    style: R.weighted([['schoolhouse', 4], ['station', 3], ['kitchen', 2], ['porthole', 2]]),
    wood: R.pick(Object.keys(WOODS)), paint: R.pick(Object.keys(PAINTS)),
    metal: R.pick(['brass', 'nickel', 'steel']),
    diameter: Math.round(R.range(230, 320) / 10) * 10,
  }),
  describe: (spec) => { const c = spec.case; return [['Case', `${c.style}, ${c.diameter} mm, ${c.style === 'schoolhouse' ? c.wood : c.style === 'kitchen' ? c.paint + ' paint' : c.metal}`]]; },
  palette: (spec) => ({ polished: { color: METALS[spec.case.metal].color, roughness: 0.16 }, wood: { color: WOODS[spec.case.wood] }, paint: { color: PAINTS[spec.case.paint] } }),
  dims: (spec) => ({ dialR: spec.case.diameter / 2 - RIM[spec.case.style], R: spec.case.diameter / 2 }),
};

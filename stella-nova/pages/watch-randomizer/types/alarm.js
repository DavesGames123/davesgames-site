// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  types/alarm.js — twin-bell alarm clock
// ────────────────────────────────────────────────────────────────────────────
//  The spec side of one case type (no DOM, no THREE; tests.mjs runs it):
//    id, name, weight, clock ..... identity, roll weight, clock or watch
//    calibres ................... [[calibre id, weight]] that fit this case
//    caseSpec(R, calibre) ....... the random case choices
//    describe(spec) ............. rows for the Spec panel
//    palette(spec) .............. kit material overrides for the case
//    dims(spec, dialR) .......... { dialR, R }: the dial size and the radius
//                                 the camera fits (dialR in: the calibre's)
//  cases/alarm.js builds it.
// ============================================================================
import { METALS, PAINTS, WOODS, LEATHERS } from '../palettes.js';

export default {
  id: 'alarm', name: 'Alarm clock', weight: 2, clock: true,
  calibres: [['lever', 6], ['automatic', 4]],
  caseSpec: (R, calibre) => ({
    body: R.weighted([['painted', 5], ['chrome', 2], ['brass', 2]]),
    paint: R.pick(Object.keys(PAINTS)),
    bells: R.pick(['chrome', 'brass']),
    feet: R.pick(['ball', 'splayed']),
    diameter: Math.round(R.range(95, 125) / 5) * 5,
    alarmAt: Math.floor(R.range(0, 12 * 60 / 5)) * 5,
  }),
  describe: (spec) => {
    const c = spec.case, h = Math.floor(c.alarmAt / 60) || 12, mm = String(c.alarmAt % 60).padStart(2, '0');
    return [['Case', `${c.body === 'painted' ? c.paint + ' painted' : c.body} drum, ${c.diameter} mm, ${c.bells} bells, ${c.feet} feet`], ['Alarm', `set for ${h}:${mm}`]];
  },
  palette: (spec) => ({ paint: { color: PAINTS[spec.case.paint] }, polished: { color: spec.case.body === 'brass' ? METALS.brass.color : '#e9ebf0', roughness: 0.1 } }),
  dims: (spec) => ({ dialR: spec.case.diameter / 2 - 7, R: spec.case.diameter / 2 + 26 }),
};

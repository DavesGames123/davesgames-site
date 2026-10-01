// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  dims.js — what a spec asks of the movement scene
// ────────────────────────────────────────────────────────────────────────────
//  caseDims(spec, cal) returns { clock, dialR, R, hands, hide, noDial, paint }:
//  the hand styles, lengths and materials, the parts to hide (the stem when
//  the case brings its own crown, the rotor in a clock), the dial art and
//  the radius the camera fits. The type module (types/<id>.js) gives dialR
//  and R; the calibre gives its own dial radius and small seconds place.
// ============================================================================
import { TYPES, CALIBRE_INFO } from './generator.js';
import { dialRadius } from './cases/common.js';
import { HAND_W, forClock, minuteFor, HAND_MAT, SEC_MAT, handStyle } from './hands.js';
import { dialPainter } from './dials.js';

const ROTOR_PARTS = ['rotor', 'rotorHub', 'autoBridge', 'reduction', 'rev1Wheel', 'rev2Wheel', 'rev1Pin', 'rev2Pin', 'aScrews'];
const HAND_L = { lever: [9.6, 14.6], tourbillon: [9.6, 14.6], verge: [10, 15], automatic: [6.4, 10.2], cylinder: [9.8, 14.8], pinlever: [10, 15.2], detent: [11, 16.5] };

export function caseDims(spec, cal) {
  const f = spec.face, calId = spec.movement.calibre, T = TYPES[spec.type], clock = !!T.clock;
  const own = dialRadius(cal);
  const { dialR, R } = T.dims(spec, own, cal);
  // a calibre with its own face (a regulator layout, a visible escapement)
  // keeps its dial and hands; the case frames them and paints nothing
  if ((CALIBRE_INFO[calId] || {}).ownFace) return { clock, dialR: own, R, hands: undefined, hide: [], noDial: false, ownFace: true, paint: null };
  const hide = cal.stemPart === false || calId === 'verge' ? [] : ['stem'];
  if (clock && calId === 'automatic') hide.push(...ROTOR_PARTS);
  const hs = clock ? forClock(f.handStyle) : f.handStyle, ms = minuteFor(hs);
  const [h0, m0] = HAND_L[calId] || [own * 0.52, own * 0.79];
  const hourL = clock ? dialR * 0.55 : h0, minL = clock ? dialR * 0.84 : m0;
  const mat = HAND_MAT[f.handColor] || 'blued', smat = f.secondColor === 'match' ? mat : SEC_MAT[f.secondColor];
  const hands = {
    hour: [handStyle(hs), hourL, hourL * (HAND_W[hs] || 0.04) * (clock ? 1.4 : 1)],
    minute: [handStyle(ms), minL, minL * (HAND_W[ms] || 0.03) * (clock ? 1.3 : 1)],
    mat, hubR: clock ? dialR * 0.035 : own * 0.05,
  };
  if (f.seconds === 'none') hands.second = false;
  if (f.seconds === 'centre') {
    const L = clock ? dialR * 0.9 : own * 0.87;
    hands.second = { at: [0, 0], len: L, z: cal.CAL.z.dialLo - 0.85, w: clock ? dialR * 0.012 : 0.16, hub: clock ? dialR * 0.022 : 0.32, mat: smat, lollipop: f.lollipop };
  } else if (f.seconds !== 'none') hands.secondStyle = { mat: smat, lollipop: f.lollipop };
  const info = CALIBRE_INFO[calId] || {};
  const paint = dialPainter(f, {
    serifBrand: calId === 'verge' || f.numerals === 'roman',
    sub: f.seconds === 'small' && !clock && info.sub ? info.sub(cal) : null,
    aperture: f.seconds === 'aperture' && info.aperture ? info.aperture(cal) : null,
    line: clock ? f.city.toUpperCase() : (info.line || f.city.toUpperCase()),
  });
  return { clock, dialR, R, hands, hide, noDial: clock, paint };
}

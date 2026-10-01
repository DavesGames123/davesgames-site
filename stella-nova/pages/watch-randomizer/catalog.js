// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  catalog.js — the face catalogue and its weights
// ────────────────────────────────────────────────────────────────────────────
//  What a dial and its hands can be, and how likely each choice is in each
//  era. No DOM; generator.js calls these with its seeded R. dials.js must be
//  able to paint every base, numeral style and track listed here, and
//  hands.js must be able to draw every hand style.
//
//  ERA: 'old' (verge, 18th century), 'classic' (lever pocket watches and
//  clocks, 1850-1950), 'modern' (wristwatch automatics, 1950-today).
//
//  GREP MAP
//    const DIAL_BASES / NUMERALS / TRACKS / HAND_STYLES   the full lists
//    function pickBase / pickNumerals / pickTrack / pickHands / pickColours
// ============================================================================
export const DIAL_BASES = ['enamel', 'cream', 'black', 'slate', 'sunray-blue', 'sunray-green', 'salmon', 'silver-guilloche'];
export const LIGHT = new Set(['enamel', 'cream', 'salmon', 'silver-guilloche']);
export const NUMERALS = ['roman', 'arabic', 'breguet', 'baton', 'dots'];
export const TRACKS = ['railway', 'minutes', 'dots', 'none'];
export const HAND_STYLES = ['breguet', 'dauphine', 'leaf', 'sword', 'spade', 'cathedral', 'baton'];

export const eraOf = (type, calibre) => calibre === 'verge' ? 'old' : type === 'wrist' && calibre === 'automatic' ? 'modern' : 'classic';

export function pickBase(R, era) {
  if (era === 'old') return R.weighted([['enamel', 7], ['cream', 3]]);
  if (era === 'modern') return R.weighted([['black', 2], ['slate', 1.5], ['sunray-blue', 2], ['sunray-green', 1.2], ['silver-guilloche', 1.2], ['salmon', 1], ['cream', 1], ['enamel', 0.8]]);
  return R.weighted(DIAL_BASES.map(b => [b, LIGHT.has(b) ? 2 : 1]));
}
export function pickNumerals(R, era, clock) {
  if (era === 'old') return 'roman';
  if (clock) return R.weighted([['arabic', 4], ['roman', 2], ['baton', 1.5], ['breguet', 1]]);
  return R.weighted([['roman', 2], ['arabic', 2], ['breguet', 1.5], ['baton', era === 'modern' ? 3 : 1], ['dots', 1]]);
}
export const pickTrack = (R, era) => R.weighted([['railway', 3], ['minutes', 3], ['dots', 1.5], ['none', era === 'modern' ? 1 : 0.3]]);
export function pickHands(R, era) {
  if (era === 'old') return R.weighted([['beetle', 7], ['breguet', 3]]);
  return R.weighted(HAND_STYLES.map(s => [s, s === 'dauphine' && era === 'modern' ? 3 : s === 'breguet' && era === 'classic' ? 3 : 1]));
}
export function pickColours(R, base) {
  const light = LIGHT.has(base);
  return {
    handColor: light ? R.weighted([['blued', 5], ['black', 2], ['gold', 2], ['steel', 1]]) : R.weighted([['steel', 4], ['gold', 3], ['lume', 1.5]]),
    secondColor: R.weighted([['match', 3], ['red', 2.5], ['gold', 1], ['blue', 1]]),
    lollipop: R.chance(0.25),
    accent: R.pick(['#b0402e', '#2a4f8f', '#b08a3e', '#3c6b4f']),
  };
}

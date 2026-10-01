// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  catalog.js — the face catalogue and its weights
// ────────────────────────────────────────────────────────────────────────────
//  What a dial and its hands can be, and how likely each choice is in each
//  era. No DOM; generator.js calls these with its seeded R. dials.js paints
//  every base, numeral style and track listed here, and hands.js draws
//  every hand style (tests-face.mjs checks both).
//
//  ERA: 'old' (verge, 18th century), 'classic' (lever pocket watches and
//  clocks, 1850-1950), 'modern' (wristwatch automatics, 1950-today).
//
//  BASES (the dial plate and its finish)
//    enamel, cream, black, slate, sunray-blue, sunray-green, salmon,
//    silver-guilloche ............................ the first set
//    opaline, sector, pie-pan, two-tone, tropical, lacquer, cartouche,
//    cloisonne, linen, brushed, clous, tapisserie, breguet-guilloche
//  NUMERALS
//    roman, arabic, breguet, baton, dots, california, turkish, railroad,
//    applied, arrow, triangle, twentyfour
//  TRACKS
//    railway, minutes, dots, none, chemin, fivemin, tachymeter, pulsometer
//  HANDS (hour styles; hands.js pairs a minute style with each)
//    breguet, dauphine, leaf, sword, spade, cathedral, baton, beetle,
//    syringe, pencil, alpha, mercedes, lance, feuille, pomme, fleurdelis,
//    spadewhip, skeleton, arrow, plongeur, louisxv, serpentine
//
//  GREP MAP
//    const DIAL_BASES / NUMERALS / TRACKS / HAND_STYLES   the full lists
//    function pickBase / pickNumerals / pickTrack / pickHands / pickColours
// ============================================================================
export const DIAL_BASES = ['enamel', 'cream', 'black', 'slate', 'sunray-blue', 'sunray-green', 'salmon', 'silver-guilloche',
  'opaline', 'sector', 'pie-pan', 'two-tone', 'tropical', 'lacquer', 'cartouche', 'cloisonne', 'linen', 'brushed', 'clous', 'tapisserie', 'breguet-guilloche'];
// light bases take dark hands (blued, black, gold)
export const LIGHT = new Set(['enamel', 'cream', 'salmon', 'silver-guilloche', 'opaline', 'sector', 'pie-pan', 'two-tone', 'cartouche', 'linen', 'brushed', 'breguet-guilloche']);
export const NUMERALS = ['roman', 'arabic', 'breguet', 'baton', 'dots', 'california', 'turkish', 'railroad', 'applied', 'arrow', 'triangle', 'twentyfour'];
export const TRACKS = ['railway', 'minutes', 'dots', 'none', 'chemin', 'fivemin', 'tachymeter', 'pulsometer'];
export const HAND_STYLES = ['breguet', 'dauphine', 'leaf', 'sword', 'spade', 'cathedral', 'baton', 'beetle',
  'syringe', 'pencil', 'alpha', 'mercedes', 'lance', 'feuille', 'pomme', 'fleurdelis', 'spadewhip', 'skeleton', 'arrow', 'plongeur', 'louisxv', 'serpentine'];

export const eraOf = (type, calibre) => calibre === 'verge' ? 'old' : type === 'wrist' && calibre === 'automatic' ? 'modern' : 'classic';

export function pickBase(R, era) {
  if (era === 'old') return R.weighted([['enamel', 7], ['cream', 3], ['cartouche', 2.5], ['cloisonne', 1.2], ['breguet-guilloche', 1]]);
  if (era === 'modern') return R.weighted([['black', 2], ['slate', 1.5], ['sunray-blue', 2], ['sunray-green', 1.2], ['silver-guilloche', 1.2], ['salmon', 1], ['cream', 1], ['enamel', 0.8],
    ['opaline', 1.2], ['sector', 1.4], ['pie-pan', 1.2], ['two-tone', 1], ['tropical', 0.8], ['lacquer', 1], ['linen', 1], ['brushed', 1], ['clous', 1.1], ['tapisserie', 1.1], ['breguet-guilloche', 0.8]]);
  return R.weighted([['enamel', 2.5], ['cream', 2], ['black', 1], ['slate', 0.7], ['sunray-blue', 0.6], ['sunray-green', 0.5], ['salmon', 1.2], ['silver-guilloche', 1.5],
    ['opaline', 1.6], ['sector', 1.2], ['pie-pan', 0.6], ['two-tone', 1], ['tropical', 0.6], ['lacquer', 1], ['cartouche', 1], ['cloisonne', 0.4], ['linen', 0.6], ['brushed', 0.5], ['clous', 0.4], ['tapisserie', 0.3], ['breguet-guilloche', 1.4]]);
}
// the base sets some numerals: a cartouche dial has Roman plaques
export function pickNumerals(R, era, clock, base) {
  if (base === 'cartouche') return 'roman';
  if (era === 'old') return R.weighted([['roman', 8], ['turkish', 1.5], ['arabic', 1]]);
  if (clock) return R.weighted([['arabic', 4], ['roman', 2], ['baton', 1.5], ['breguet', 1], ['railroad', 1.5], ['twentyfour', 0.6], ['applied', 1], ['triangle', 0.5]]);
  if (era === 'modern') return R.weighted([['roman', 1], ['arabic', 2], ['breguet', 1], ['baton', 3], ['dots', 1], ['california', 1.2], ['applied', 2.5], ['arrow', 1.2], ['triangle', 1], ['twentyfour', 0.5]]);
  return R.weighted([['roman', 2.5], ['arabic', 2], ['breguet', 1.5], ['baton', 1], ['dots', 0.6], ['california', 0.8], ['turkish', 0.4], ['railroad', 1.4], ['applied', 0.8], ['twentyfour', 0.4]]);
}
export const pickTrack = (R, era) => era === 'old' ? R.weighted([['railway', 4], ['minutes', 2], ['chemin', 1.5], ['fivemin', 1]])
  : era === 'modern' ? R.weighted([['railway', 2], ['minutes', 3], ['dots', 1.5], ['none', 1], ['chemin', 1], ['fivemin', 1], ['tachymeter', 1.2], ['pulsometer', 0.4]])
  : R.weighted([['railway', 3], ['minutes', 3], ['dots', 1.5], ['none', 0.3], ['chemin', 1.5], ['fivemin', 1.2], ['pulsometer', 0.5], ['tachymeter', 0.3]]);
export function pickHands(R, era) {
  if (era === 'old') return R.weighted([['beetle', 6], ['breguet', 3], ['fleurdelis', 2], ['spadewhip', 1.5], ['louisxv', 1.5], ['pomme', 1], ['serpentine', 0.8]]);
  if (era === 'modern') return R.weighted([['dauphine', 3], ['baton', 2], ['sword', 1.5], ['alpha', 1.5], ['leaf', 1], ['mercedes', 1.2], ['arrow', 1], ['plongeur', 0.8], ['skeleton', 1], ['syringe', 0.8], ['pencil', 1.2], ['lance', 1], ['feuille', 1], ['breguet', 0.6], ['cathedral', 0.5]]);
  return R.weighted([['breguet', 3], ['spade', 1.5], ['cathedral', 1.2], ['dauphine', 1], ['leaf', 1], ['sword', 0.8], ['baton', 0.8], ['syringe', 1], ['pencil', 0.8], ['alpha', 1], ['lance', 1], ['feuille', 1.2], ['pomme', 1.5], ['spadewhip', 1.4], ['louisxv', 1], ['fleurdelis', 0.6], ['serpentine', 0.4], ['skeleton', 0.4]]);
}
const DARK_ACCENT = { tropical: '#e8c99a', lacquer: '#d8b46a' };
export function pickColours(R, base) {
  const light = LIGHT.has(base);
  return {
    handColor: base === 'lacquer' ? R.weighted([['gold', 5], ['steel', 1]]) : light ? R.weighted([['blued', 5], ['black', 2], ['gold', 2], ['steel', 1]]) : R.weighted([['steel', 4], ['gold', 3], ['lume', 1.5]]),
    secondColor: R.weighted([['match', 3], ['red', 2.5], ['gold', 1], ['blue', 1]]),
    lollipop: R.chance(0.25),
    accent: DARK_ACCENT[base] || R.pick(['#b0402e', '#2a4f8f', '#b08a3e', '#3c6b4f']),
  };
}
// display names for the Spec panel
export const BASE_NAMES = { 'sunray-blue': 'blue sunray', 'sunray-green': 'green sunray', 'silver-guilloche': 'silver guilloché', 'pie-pan': 'pie-pan', 'two-tone': 'two-tone',
  tropical: 'tropical brown', lacquer: 'black lacquer, gilt print', cartouche: 'grand-feu enamel with cartouches', cloisonne: 'cloisonné enamel', linen: 'linen',
  brushed: 'vertical brushed', clous: 'clous de Paris', tapisserie: 'tapisserie', 'breguet-guilloche': 'Breguet guilloché with chapter ring', opaline: 'opaline silver', sector: 'sector' };
export const NUMERAL_NAMES = { california: 'California', turkish: 'Ottoman (Turkish)', railroad: 'railroad', applied: 'applied faceted', arrow: 'arrow index', triangle: 'triangle index', twentyfour: '12/24-hour' };
export const TRACK_NAMES = { chemin: 'chemin de fer', fivemin: 'five-minute numerals', tachymeter: 'tachymeter', pulsometer: 'pulsometer' };

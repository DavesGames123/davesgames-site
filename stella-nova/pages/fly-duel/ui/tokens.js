// ============================================================================
//  FLY DUEL  ·  colour tokens  (pure ES module)
// ----------------------------------------------------------------------------
//  One source for every colour that a canvas, an SVG string or the saver
//  draws. style.css holds the same values on :root (DESIGN.md 1.1), and
//  tests/gui.test.mjs compares the two lists.
//
//  One colour has one meaning:
//    flyA flyB        the seat of a fly (never a card colour or a valence)
//    amber moss none  card colour and mana only
//    pn kc-off kc-on  projection neuron rate, silent and active Kenyon cell
//    app avoid        approach / avoid MBON, PAM / PPL1 burst, sign of δ
//    dmg heal         life loss and life gain on the table
//    m2 m4 m5         KC subtypes, only in the section 02 legend toggle
//                     (the values of --m2 --m4 --m5 in ../../lib/sci.css)
//
//  GREP MAP
//      grep -n 'export const TOKENS'  the token list
//      grep -n 'export function rgb'  '#rrggbb' -> [r, g, b]
//      grep -n 'export const FLY'     seat colours by seat index
// ============================================================================

export const TOKENS = {
  bg: '#05070c',
  panel: '#0b0e15',
  panel2: '#111623',
  fig: '#03050a',
  ink: '#eef0f5',
  ink2: '#c2c7d4',
  dim: '#8a91a5',
  faint: '#394155',
  hair: 'rgba(255,255,255,0.10)',
  hair2: 'rgba(255,255,255,0.22)',
  flyA: '#39d0f0',
  flyB: '#f26ad6',
  'flyA-ink': '#04161c',
  'flyB-ink': '#1c0618',
  amber: '#ffb347',
  moss: '#a8d65a',
  none: '#a9b4c8',
  pn: '#9d8cff',
  'kc-off': '#2b3142',
  'kc-on': '#fffbe6',
  app: '#3ee89a',
  avoid: '#ff4d4d',
  dmg: '#ff4d4d',
  heal: '#3ee89a',
  acc: '#eef0f5',
};

// KC subtype colours: the --m2 --m4 --m5 values of ../../lib/sci.css.
export const KC_TYPE = { ab: '#ff9a62', apbp: '#e889dc', g: '#ffd666' };
// Board 1 / board 2 colours of section 04: --m2 and --m1 of sci.css.
export const PAIR = ['#ff9a62', '#62c4ff'];

// '#rrggbb' -> [r, g, b] (0..255).
export function rgb(hex) {
  const h = String(hex).replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

// Seat colours: index 0 is Fly A, index 1 is Fly B.
export const FLY = [TOKENS.flyA, TOKENS.flyB];
export const FLY_INK = [TOKENS['flyA-ink'], TOKENS['flyB-ink']];

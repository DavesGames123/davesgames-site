// ============================================================================
//  SPIROGRAPH  ·  presets.js — inks and the preset drawings (no DOM)
// ----------------------------------------------------------------------------
//  INKS. Ten pens. Each pen has one color for cream paper (it multiplies
//  into the paper) and one for night paper (it screens onto the paper). A
//  trace keeps the pen index, so a change of paper redraws it in the other
//  color of the same pen.
//
//  PRESETS. A preset is a paper, a sheet size and a list of traces. Each
//  trace: R and r (teeth), out (true = outside the fixed wheel), hole (0..1,
//  the inner to the outer pen hole), pen (ink index), w (0 fine, 1 medium,
//  2 bold), rot (turn of the whole rig, radians), loops (laps to draw, 0 =
//  until the curve closes). units is the half width of the sheet in gear
//  units; 0 fits the largest rig.
//
//  EXPORTS   (jump with grep -n "<anchor>" presets.js)
//      INKS ........ "export const INKS"
//      WIDTHS ...... "export const WIDTHS"
//      PRESETS ..... "export const PRESETS"
// ============================================================================
export const INKS = [
  { name: 'Indigo', cream: '#27398f', night: '#8fb0ff' },
  { name: 'Crimson', cream: '#c12c43', night: '#ff8ea2' },
  { name: 'Teal', cream: '#0b7d78', night: '#78e2d6' },
  { name: 'Green', cream: '#3b8a3a', night: '#a9e98f' },
  { name: 'Violet', cream: '#6a3ca3', night: '#cbb0ff' },
  { name: 'Orange', cream: '#e06523', night: '#ffb27a' },
  { name: 'Magenta', cream: '#b8327d', night: '#ff9cd6' },
  { name: 'Gold', cream: '#c4911a', night: '#ffdf8a' },
  { name: 'Sky', cream: '#2a83cc', night: '#8fd4ff' },
  { name: 'Graphite', cream: '#2a2c33', night: '#eceef3' },
];
export const WIDTHS = [{ name: 'Fine', px: 1.2 }, { name: 'Medium', px: 1.8 }, { name: 'Bold', px: 2.7 }];

const T = (R, r, hole, pen, o = {}) => ({ R, r, out: false, hole, pen, w: 0, rot: 0, loops: 0, ...o });
const ring = (n, k) => k * Math.PI * 2 / n;

export const PRESETS = [
  { name: 'Twelve', paper: 'cream', units: 0, traces: [
    T(144, 60, 1, 0), T(144, 60, 0.6, 8), T(144, 60, 0.25, 7, { w: 1 }),
  ] },
  { name: 'Lace', paper: 'cream', units: 0, traces: [
    T(150, 52, 1, 1), T(150, 52, 0.55, 6),
  ] },
  { name: 'Seven', paper: 'cream', units: 0, traces: [
    T(105, 45, 1, 4), T(105, 45, 1, 6, { rot: ring(21, 1) }), T(105, 45, 1, 1, { rot: ring(21, 2) }),
  ] },
  { name: 'Garland', paper: 'cream', units: 0, traces: [
    T(52, 40, 1, 2, { out: true }),
  ] },
  { name: 'Nested', paper: 'cream', units: 0, traces: [
    T(120, 75, 1, 6), T(120, 50, 0.9, 0), T(120, 32, 0.8, 7),
  ] },
  { name: 'Rosette', paper: 'cream', units: 0, traces: [
    T(96, 36, 1, 2, { w: 1 }), T(96, 30, 0.85, 0), T(96, 84, 0.9, 7),
  ] },
  { name: 'Star chart', paper: 'night', units: 0, traces: [
    T(150, 98, 1, 8), T(150, 45, 0.6, 7),
  ] },
  { name: 'Snowflake', paper: 'night', units: 0, traces: [
    T(96, 80, 1, 6), T(96, 80, 0.6, 8), T(96, 80, 0.3, 7),
  ] },
  { name: 'Orbits', paper: 'night', units: 0, traces: [
    T(72, 56, 1, 2, { out: true }), T(72, 40, 1, 1, { out: true }),
  ] },
];

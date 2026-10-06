// ============================================================================
//  PATTERN DESIGNER  ·  palettes.js — poster palettes and board presets
// ----------------------------------------------------------------------------
//  A palette is a paper colour (bg) and two to five inks. Elements name an
//  ink slot k, and the page maps slot k to ink[k % ink.length] (inkOf).
//  The palettes are original picks for print: each one keeps a clear
//  contrast between the paper and the first ink.
//
//  BOARDS. A sizes carry mm, so the SVG export can write real units. The
//  screen formats carry px.
//
//  grep -n targets: "export const PALETTES", "export const BOARDS", "function inkOf"
// ============================================================================
export const PALETTES = [
  { id: 'bone', name: 'Bone and ink', bg: '#efe9dc', ink: ['#1b1b1d', '#c8402e', '#2e5a88', '#d9a43a'] },
  { id: 'night', name: 'Night press', bg: '#101217', ink: ['#f1ece1', '#ff6a3d', '#5cc4b4', '#f2c14e', '#8b8fd8'] },
  { id: 'riso', name: 'Riso pair', bg: '#f4efe6', ink: ['#ff4f7b', '#2d6bd8', '#1d1d24'] },
  { id: 'signal', name: 'Signal', bg: '#f7f3ea', ink: ['#111111', '#e63c2f'] },
  { id: 'tide', name: 'Tide pool', bg: '#0e2a33', ink: ['#e8f1ea', '#4fb3a9', '#f0a35e', '#9fd3c7'] },
  { id: 'clay', name: 'Clay', bg: '#e8d8c3', ink: ['#5b2c1d', '#b8572e', '#e09f5a', '#2f4b3c'] },
  { id: 'cobalt', name: 'Cobalt', bg: '#f2f0ea', ink: ['#1f3fbf', '#0f1b4d', '#7d97ef'] },
  { id: 'mint', name: 'Mint and plum', bg: '#e3f1e8', ink: ['#4a1d3f', '#2c8c6c', '#e05a73', '#f3b94d'] },
  { id: 'ember', name: 'Ember', bg: '#17110f', ink: ['#ff8a3d', '#ffd166', '#e2483d', '#f6efe0'] },
  { id: 'chalk', name: 'Chalkboard', bg: '#20262b', ink: ['#eef0ea', '#a7c4bc', '#f0b6a8'] },
  { id: 'sun', name: 'Sun print', bg: '#f5e6c8', ink: ['#1e3d6b', '#e1593b', '#f2b134', '#3c8d7a', '#1a1a1a'] },
  { id: 'moss', name: 'Moss', bg: '#ecebe2', ink: ['#2f3b2a', '#6f8f4e', '#c9b458', '#9b4d33'] },
  { id: 'neon', name: 'Neon on black', bg: '#070708', ink: ['#39f3bb', '#ff3fa4', '#f9f871', '#6e8bff'] },
  { id: 'paper', name: 'Pencil', bg: '#fbfaf6', ink: ['#2a2a2e', '#7a7a80', '#b3b3b8'] },
  { id: 'berry', name: 'Berry', bg: '#2b0f24', ink: ['#ffb3c6', '#ff5d8f', '#ffd6a5', '#9b5de5'] },
  { id: 'dune', name: 'Dune', bg: '#d9c3a0', ink: ['#3a2618', '#8a4b2a', '#f2e3c6', '#c27c3a'] },
  { id: 'arctic', name: 'Arctic', bg: '#e9f0f5', ink: ['#0b2545', '#13315c', '#5f8db3', '#e0525a'] },
  { id: 'mono', name: 'Mono white', bg: '#0a0a0a', ink: ['#f5f5f2'] },
];
export const paletteById = id => PALETTES.find(p => p.id === id) || PALETTES[0];
export const inkOf = (pal, k) => k < 0 ? 'none' : pal.ink[k % pal.ink.length];

// aspect = w / h. mm: the paper size, for the SVG width and height. px:
// the pixel size at 1x. The A sizes are portrait; the page can turn them.
export const BOARDS = [
  { id: 'a5', name: 'A5', mm: [148, 210] },
  { id: 'a4', name: 'A4', mm: [210, 297] },
  { id: 'a3', name: 'A3', mm: [297, 420] },
  { id: 'a2', name: 'A2', mm: [420, 594] },
  { id: 'a1', name: 'A1', mm: [594, 841] },
  { id: '4x5', name: '4:5 post', px: [1080, 1350] },
  { id: '9x16', name: '9:16 story', px: [1080, 1920] },
  { id: 'sq', name: 'Square', px: [2048, 2048] },
  { id: 'desk', name: 'Desktop 16:9', px: [2560, 1440] },
];
export const boardById = id => BOARDS.find(b => b.id === id) || BOARDS[1];
// The physical or pixel size of a board, turned when landscape is true.
export function boardDims(b, landscape) {
  const d = (b.mm || b.px).slice();
  if (landscape && d[0] < d[1]) d.reverse();
  return { w: d[0], h: d[1], unit: b.mm ? 'mm' : 'px', aspect: d[0] / d[1] };
}

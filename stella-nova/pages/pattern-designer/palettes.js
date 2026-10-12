// ============================================================================
//  PATTERN DESIGNER  ·  palettes.js — poster palettes and board presets
// ----------------------------------------------------------------------------
//  A palette is a paper colour (bg) and two to five inks. Elements name an
//  ink slot k, and the page maps slot k to ink[k % ink.length] (inkOf).
//  The palettes are original picks for print. Each one keeps a WCAG
//  contrast of 3 or more between the paper and the first ink, and no two
//  palettes are near copies (tests.mjs checks both with color.js).
//
//  GROUPS. Each palette has a group id. PALETTE_GROUPS gives the order and
//  the names that the chooser shows. A period group name tells the style
//  in general words only; no palette copies a real brand or a real work.
//  The colour-blind safe group uses colour sets made for data plots.
//
//  BOARDS. A sizes carry mm, so the SVG export can write real units. The
//  screen formats carry px.
//
//  grep -n targets: "export const PALETTE_GROUPS", "export const PALETTES",
//                   "export const BOARDS", "function inkOf"
// ============================================================================
export const PALETTE_GROUPS = [
  { id: 'print', name: 'Print and riso' },
  { id: 'earth', name: 'Earth and mineral' },
  { id: 'botanical', name: 'Botanical' },
  { id: 'ocean', name: 'Ocean and ice' },
  { id: 'night', name: 'Night and neon' },
  { id: 'pastel', name: 'Pastel' },
  { id: 'mono', name: 'Mono and duotone' },
  { id: 'poster', name: 'Poster contrast' },
  { id: 'period', name: 'Period styles' },
  { id: 'safe', name: 'Colour-blind safe' },
];
const G = (group, list) => list.map(([id, name, bg, ink]) => ({ id, name, group, bg, ink }));
export const PALETTES = [
  ...G('print', [
    ['bone', 'Bone and ink', '#efe9dc', ['#1b1b1d', '#c8402e', '#2e5a88', '#d9a43a']],
    ['riso', 'Riso pair', '#f4efe6', ['#e8386a', '#2d6bd8', '#1d1d24']],
    ['riso-fluor', 'Riso fluor', '#f6f1e7', ['#2a3a8c', '#ff48b0', '#ffd23f', '#00a5a0']],
    ['riso-teal', 'Teal and orange riso', '#f2ede3', ['#0f6e74', '#ff6c2f', '#1c1c1c']],
    ['letterpress', 'Letterpress', '#f3eee2', ['#2b2b2b', '#b5302a', '#8c8577']],
    ['newsprint', 'Newsprint', '#e9e4d6', ['#222222', '#5c5c5c', '#c23b22']],
    ['process', 'Process inks', '#fafaf7', ['#1a1a1a', '#00a0dc', '#e5007e', '#ffe100']],
    ['blueprint', 'Blueprint', '#123a6b', ['#e8f0f8', '#8fb5dd', '#f4d35e']],
    ['carbon', 'Carbon copy', '#eef0f5', ['#2c3e8f', '#5a6cb8', '#9aa6d6']],
  ]),
  ...G('earth', [
    ['clay', 'Clay', '#e8d8c3', ['#5b2c1d', '#b8572e', '#e09f5a', '#2f4b3c']],
    ['dune', 'Dune', '#d9c3a0', ['#3a2618', '#8a4b2a', '#f2e3c6', '#c27c3a']],
    ['terracotta', 'Terracotta', '#f4e2d4', ['#7a2e1c', '#c4553a', '#e99b74', '#f2cfb3']],
    ['ochre', 'Ochre and umber', '#f0e2bd', ['#3d2a1c', '#d39b2a', '#9a4f1f', '#5f6d3e']],
    ['slate', 'Slate', '#dfe2e1', ['#2e3a40', '#5f7480', '#a3542f']],
    ['malachite', 'Malachite', '#0f2a22', ['#cfe8d8', '#2fa37a', '#7fd1a8', '#e2b75c']],
    ['lapis', 'Lapis', '#16224d', ['#f2e6c4', '#3b5fc4', '#d4a73c', '#8ea0e0']],
    ['rust', 'Rust and iron', '#2a1d18', ['#e9d8c4', '#c4552b', '#8a3a1e', '#e39b55']],
    ['sandstone', 'Sandstone', '#ecd9bf', ['#5e3423', '#b9623b', '#d79f6f', '#7c8a6e']],
    ['basalt', 'Basalt', '#1b1c1e', ['#d8d3c8', '#8a8c88', '#b56a46']],
  ]),
  ...G('botanical', [
    ['moss', 'Moss', '#ecebe2', ['#2f3b2a', '#6f8f4e', '#c9b458', '#9b4d33']],
    ['mint', 'Mint and plum', '#e3f1e8', ['#4a1d3f', '#2c8c6c', '#e05a73', '#f3b94d']],
    ['fern', 'Fern', '#eef1e4', ['#1f3d2b', '#4f7d3a', '#9cbf5b', '#d8a33a']],
    ['meadow', 'Meadow', '#f4f0de', ['#2d4a2b', '#e2574c', '#f2b632', '#7a9ed6', '#8cc06a']],
    ['olive', 'Olive grove', '#e7e3cc', ['#3b3d1f', '#7c7f3a', '#b4a35a', '#5d3c2c']],
    ['lichen', 'Lichen', '#c9cfb3', ['#2e3527', '#6b7a49', '#e3e0c8', '#a85c34']],
    ['orchid', 'Orchid', '#f6eef3', ['#4b1f4a', '#b24a8f', '#e48fc0', '#5d8a4e']],
    ['forest-floor', 'Forest floor', '#1c2318', ['#e3dcc2', '#7c9a52', '#c27b3e', '#5a7a6e']],
    ['citrus', 'Citrus', '#fbf5e3', ['#2c4a1e', '#f29a1e', '#f4d23c', '#6ab04c']],
    ['eucalyptus', 'Eucalyptus', '#e4ebe6', ['#24453f', '#6c9a8b', '#b8cfc4', '#c48b6b']],
  ]),
  ...G('ocean', [
    ['tide', 'Tide pool', '#0e2a33', ['#e8f1ea', '#4fb3a9', '#f0a35e', '#9fd3c7']],
    ['arctic', 'Arctic', '#e9f0f5', ['#0b2545', '#13315c', '#5f8db3', '#e0525a']],
    ['deep-sea', 'Deep sea', '#06182b', ['#cfeaf2', '#2fa4c7', '#f27059', '#5865c4']],
    ['coral-reef', 'Coral reef', '#f3efe6', ['#0d4c5c', '#ff7a5c', '#ffbf69', '#2ec4b6']],
    ['lagoon', 'Lagoon', '#d9efec', ['#08474f', '#1a9aa0', '#f6c65b', '#e06d50']],
    ['glacier', 'Glacier', '#f2f7fa', ['#173a5e', '#5a9bc9', '#a9d3ea', '#8a8f99']],
    ['harbour', 'Harbour', '#1e2a35', ['#f0e9dc', '#e35d3f', '#5f9fb6', '#d9b35a']],
    ['kelp', 'Kelp', '#0b2a33', ['#d6e6c3', '#4fa08f', '#c9a14a', '#2e6f8a']],
    ['storm', 'Storm sea', '#c8d0d6', ['#1e2b37', '#45617a', '#f1f1ee', '#2f4d4a']],
  ]),
  ...G('night', [
    ['night', 'Night press', '#101217', ['#f1ece1', '#ff6a3d', '#5cc4b4', '#f2c14e', '#8b8fd8']],
    ['ember', 'Ember', '#17110f', ['#ff8a3d', '#ffd166', '#e2483d', '#f6efe0']],
    ['chalk', 'Chalkboard', '#20262b', ['#eef0ea', '#a7c4bc', '#f0b6a8']],
    ['neon', 'Neon on black', '#070708', ['#39f3bb', '#ff3fa4', '#f9f871', '#6e8bff']],
    ['berry', 'Berry', '#2b0f24', ['#ffb3c6', '#ff5d8f', '#ffd6a5', '#9b5de5']],
    ['synth', 'Synth dusk', '#140b2b', ['#ff5fa2', '#40e0ff', '#ffd23f', '#a26bff']],
    ['acid', 'Acid', '#0b0b0b', ['#c6ff3d', '#ff3dd1', '#3dfff2']],
    ['arcade', 'Arcade', '#0a0f1f', ['#fffb7d', '#ff4d6d', '#4dd2ff', '#7dff9b', '#c77dff']],
    ['aurora', 'Aurora', '#071419', ['#7fffc4', '#3fb6ff', '#c58bff', '#f2f7d0']],
    ['sodium', 'Sodium lamp', '#140f0a', ['#ffb347', '#ff7a1a', '#f9e2b0', '#7a4a2a']],
  ]),
  ...G('pastel', [
    ['sorbet', 'Sorbet', '#fff6ef', ['#c43a50', '#f7a6a6', '#f9d58b', '#9fd8cb', '#a8b8f0']],
    ['powder', 'Powder', '#f3f4fb', ['#4b5a9e', '#a7b4e8', '#f2c4d6', '#c7e3d4']],
    ['macaron', 'Macaron', '#fbeef2', ['#6a2c5c', '#ef8fa6', '#7fcdb8', '#f4d77a', '#a18be0']],
    ['lilac', 'Lilac haze', '#efeaf6', ['#4e3d73', '#a08bd1', '#f1b5a8', '#bfd8e8']],
    ['pistachio', 'Pistachio', '#f1f5e6', ['#3d5a3c', '#b6d39a', '#f6c8a6', '#e8e1b0']],
    ['peach', 'Peach fuzz', '#fdeee3', ['#8a3b26', '#f0956a', '#f7cf8e', '#7fb3ad']],
    ['nursery', 'Nursery', '#e8f3f9', ['#1f4e6e', '#7cbbe0', '#f3a9b6']],
  ]),
  ...G('mono', [
    ['cobalt', 'Cobalt', '#f2f0ea', ['#1f3fbf', '#0f1b4d', '#7d97ef']],
    ['paper', 'Pencil', '#fbfaf6', ['#2a2a2e', '#7a7a80', '#b3b3b8']],
    ['mono', 'Mono white', '#0a0a0a', ['#f5f5f2']],
    ['graphite', 'Graphite', '#e6e6e3', ['#151515', '#4a4a4a', '#8a8a8a']],
    ['sepia', 'Sepia', '#f2e8d5', ['#3e2a1c', '#7a5a3e', '#b89a74']],
    ['indigo-duo', 'Indigo duotone', '#e9ecf5', ['#1d2a6e', '#7d8cc4']],
    ['red-duo', 'Red duotone', '#f7ebe6', ['#a3201b', '#e4877a']],
    ['green-duo', 'Green on black', '#050a07', ['#3dff8a', '#1d7a44']],
    ['gold-black', 'Gold on black', '#0d0c0a', ['#d9b45a', '#8a6f33']],
  ]),
  ...G('poster', [
    ['signal', 'Signal', '#f7f3ea', ['#111111', '#e63c2f']],
    ['safety', 'Safety yellow', '#ffd400', ['#111111', '#e5312b']],
    ['hot-red', 'Hot red', '#d7261e', ['#fff4e0', '#111111', '#ffcc00']],
    ['electric', 'Electric blue', '#1438e0', ['#ffffff', '#ff4fa0', '#ffe14d']],
    ['jet', 'Jet and cream', '#111111', ['#f4ecd8', '#00a6a6', '#e2412f']],
    ['tangerine', 'Tangerine', '#ff7a1a', ['#16110d', '#fff3e0', '#2347c9']],
    ['magenta', 'Magenta field', '#e6007e', ['#fff1f7', '#14002b', '#ffd400']],
    ['lime', 'Lime and black', '#c8f25b', ['#111111', '#2b59ff', '#ff4b2b']],
  ]),
  ...G('period', [
    ['sun', 'Sun print', '#f5e6c8', ['#1e3d6b', '#e1593b', '#f2b134', '#3c8d7a', '#1a1a1a']],
    ['primaries', 'Bauhaus-like primaries', '#fbfbf7', ['#1b1b1b', '#e1251b', '#0e4fb5', '#ffcd00']],
    ['midcentury', 'Mid-century', '#f1e6cf', ['#2c3a3a', '#d9762b', '#e8b33c', '#3f7f6f', '#9b3f2f']],
    ['deco', 'Deco gold', '#14211f', ['#e2c27a', '#f3ead6', '#3d6b62', '#a88442']],
    ['seventies', 'Seventies', '#f3e3c3', ['#5a2e14', '#d4692a', '#e9a53a', '#8a8b2e', '#b23a26']],
    ['nouveau', 'Art nouveau-like', '#efe5d0', ['#3a2b3a', '#7b5a8c', '#c9a24a', '#5e7d5a']],
    ['swiss', 'Swiss-style', '#e6e4de', ['#e3001b', '#111111', '#0061a8']],
    ['eighties', 'Eighties pop', '#fdf7ec', ['#1a1a1a', '#ff5c8a', '#2ec4e6', '#ffd23f', '#7ad151']],
    ['victorian', 'Victorian-like', '#2a1a1f', ['#e9d9b8', '#a3333d', '#3e6b5a', '#c49b4a']],
    ['woodblock', 'Woodblock', '#e8dcc0', ['#23345c', '#b8463a', '#6f8f8a', '#e7c27d']],
  ]),
  ...G('safe', [
    ['okabe', 'Okabe-Ito on white', '#ffffff', ['#000000', '#e69f00', '#56b4e9', '#009e73', '#d55e00']],
    ['okabe-dark', 'Okabe-Ito on black', '#111111', ['#f0e442', '#56b4e9', '#e69f00', '#cc79a7', '#009e73']],
    ['safe-bright', 'Bright safe', '#fbfbf8', ['#4477aa', '#ee6677', '#228833', '#ccbb44', '#aa3377']],
    ['safe-muted', 'Muted safe', '#f7f5f0', ['#332288', '#cc6677', '#117733', '#ddcc77', '#88ccee']],
    ['safe-vibrant', 'Vibrant safe', '#1a1a1a', ['#ee7733', '#33bbee', '#ee3377', '#009988', '#bbbbbb']],
    ['blue-orange', 'Blue and orange safe', '#f6f4ef', ['#1f4e8c', '#e8833a', '#9cc3e6', '#f5c99b']],
    ['viridis', 'Viridis-like ramp', '#fcfcf6', ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725']],
    ['magma', 'Magma-like ramp', '#000004', ['#fcfdbf', '#fc8961', '#b73779', '#51127c']],
  ]),
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

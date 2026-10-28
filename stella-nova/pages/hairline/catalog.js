// ============================================================================
//  HAIRLINE  ·  catalog.js — the 33 figures, their groups and the palettes
// ----------------------------------------------------------------------------
//  No DOM. The "what" and "more" text of each figure is the README table of
//  github.com/lucasmarkes/hairline (MIT, Lucas Marques, vendor/
//  LICENSE-hairline.txt). The groups and the palettes are our own.
//
//  The vendored bundle is vendor/hairline.js, a byte copy of dist/index.js of
//  @lucasmarkes/hairline 0.5.1 from npm. tests.mjs checks its SHA-256.
//
//  GREP MAP
//    grep -n 'export const FIGURES'   fn, name, group, what, more
//    grep -n 'export const GROUPS'    the gallery filters
//    grep -n 'export const PALETTES'  the --hairline-* custom properties
//    grep -n 'export const REPO'      version, links, the credit line
// ============================================================================

export const REPO = {
  name: 'hairline',
  pkg: '@lucasmarkes/hairline',
  version: '0.5.1',
  sha256: '16fdfec136dc99cf3f65730989364797f0bbb228b7bca60c4d422e0e12ce3b7d',
  author: 'Lucas Marques',
  licence: 'MIT',
  url: 'https://github.com/lucasmarkes/hairline',
  site: 'https://hairline.lucasmarkes.com',
  npm: 'https://www.npmjs.com/package/@lucasmarkes/hairline',
  essay: 'https://lucasmarkes.com/lab/hairline',
  inspo: 'https://hairline.lucasmarkes.com/inspo',
  skills: 'https://hairline.lucasmarkes.com/skills',
  stars: '3.1k',
  starsOn: '28 Oct 2026',
};
export const CREDIT = 'hairline by Lucas Marques · github.com/lucasmarkes/hairline · MIT';

export const GROUPS = [
  { id: 'all', label: 'All' },
  { id: 'ui', label: 'Screens & code' },
  { id: 'hw', label: 'Hardware' },
  { id: 'mech', label: 'Mechanisms' },
  { id: 'graph', label: 'Graphs' },
];

// [fn, name, group, what, more]
const ROWS = [
  ['riffle', 'Riffle', 'ui', 'A tray of eight cards. The card under the pointer stands up; the arrow keys walk the cards.', 'The ripple spreads further from the pulled card.'],
  ['terrain', 'Terrain', 'mech', 'Eighty-one pillars on a plinth that rise around the pointer.', 'A wider area rises.'],
  ['exploded', 'Exploded', 'ui', 'An app window in four layers. Moving across opens the gap; moving down picks a layer.', 'The layers open further.'],
  ['phosphor', 'Phosphor', 'ui', 'A dot matrix that plays a loop, and fades like phosphor where the pointer paints it.', 'The trail lingers longer.'],
  ['slow', 'Slow', 'mech', 'Crates riding a belt through a gate. Hovering slows the clock without stopping it.', 'Time slows down more.'],
  ['turntable', 'Turntable', 'mech', 'Blocks on a turntable. A flick spins it; it settles on the nearest quarter turn.', 'The spin coasts longer.'],
  ['keyboard', 'Keyboard', 'hw', 'A sixty-key board. The key under the pointer sinks, and its neighbours follow it down.', 'A wider patch of keys sinks.'],
  ['elevator', 'Elevator', 'mech', 'Four floors beside an open shaft. The pointer’s height picks a floor; the car travels there.', 'The car travels faster between floors.'],
  ['phone', 'Phone', 'hw', 'A phone in layers: glass, board, battery, shell. Moving across opens the gap; moving down picks a layer.', 'The layers open further.'],
  ['laptop', 'Laptop', 'hw', 'A thin laptop, open on its hinge. The pointer’s height sets the lid; it follows on a spring.', 'The lid opens wider.'],
  ['terminal', 'Terminal', 'ui', 'A terminal window with its history in rows. The pointer’s height scrolls back; the line under it lifts and its neighbours follow.', 'The lift spreads further.'],
  ['cabinet', 'Cabinet', 'hw', 'A rack of twelve blades, a few half out. The pointer’s height pulls the nearest ones out, the farther the less.', 'More blades come out.'],
  ['branches', 'Branches', 'ui', 'A commit graph with a branch forking off main and merging back. The commit under the pointer rises, and its history rises after it.', 'More of the history rises.'],
  ['vault', 'Vault', 'mech', 'A vault door with a dial and three bolts. The pointer turns the dial; detents catch every ten, and on the combination the bolts draw back.', 'The dial coasts longer.'],
  ['lockers', 'Lockers', 'mech', 'A bank of twelve lockers, one ajar at rest. The locker under the pointer opens; the one at rest closes.', 'The door opens wider.'],
  ['padlock', 'Padlock', 'mech', 'A padlock with its shackle in. As the pointer comes near the shackle lifts out and swings open.', 'The shackle swings further.'],
  ['patch', 'Patch', 'hw', 'A patch panel of twenty-four ports with cables. The cable under the pointer lifts and its neighbours lean away.', 'The lean spreads further.'],
  ['dish', 'Dish', 'hw', 'A parabolic dish on a two-axis gimbal. The pointer aims the dish; it follows on a spring.', 'The dish swings further.'],
  ['router', 'Router', 'hw', 'A router with its antennas up. Each antenna leans toward the pointer, the nearest most.', 'The lean spreads further.'],
  ['loupe', 'Loupe', 'mech', 'A stand loupe on a blank ruled sheet. The pointer drags it across; the rules pass enlarged under the glass, with nothing between them.', 'The glass magnifies more.'],
  ['sieve', 'Sieve', 'mech', 'Three test sieves stacked over a pan. The pointer’s height picks one; it rises clear of the stack, and every mesh is bare.', 'The gap opens further.'],
  ['rail', 'Rail', 'mech', 'A garment rail with seven bare hangers. The pointer brushes them; each rocks away, the nearest most, and settles.', 'The brush reaches more hangers.'],
  ['plug', 'Plug', 'hw', 'A wall socket, and a plug lying on the floor at the end of its cord. The pointer draws the plug up toward the socket; it stops short, and falls back.', 'The plug comes closer to the socket.'],
  ['query', 'Query', 'mech', 'A question mark built as a bent bar over a loose ball. The hook turns toward the pointer, and the ball rolls after it.', 'The hook turns further.'],
  ['drawer', 'Drawer', 'mech', 'A cabinet of three drawers. The pointer’s height picks one; it slides out and shows two dividers with nothing between them.', 'The drawer opens further.'],
  ['basket', 'Basket', 'mech', 'A wire basket under a bail handle. It tilts toward the pointer and shows its bare floor; the handle swings after it.', 'The basket tilts further.'],
  ['plot', 'Plot', 'ui', 'A bar chart with seven flat tabs where the bars would stand. The pointer brushes them; each lifts a little and drops back to zero.', 'The tabs lift higher.'],
  ['hub', 'Hub', 'graph', 'A hub with eight tiles around it on dashed links. The tile under the pointer rises and its link turns solid.', 'The tiles rise higher.'],
  ['relay', 'Relay', 'graph', 'A hub with four branches of tiles. The path to the leaf under the pointer lights hop by hop.', 'Each hop waits longer.'],
  ['settle', 'Settle', 'graph', 'Twelve tiles lie crooked round a hub. As the pointer nears it, they slide into a tree and the links draw in.', 'The tree forms from further away.'],
  ['format', 'Format', 'ui', 'A file of ten crooked lines. The pointer runs the formatter down it, and every line above snaps square.', 'The lines start more crooked.'],
  ['rebuild', 'Rebuild', 'graph', 'A tree of packages. The one under the pointer rises, and every package that depends on it rises after it.', 'The packages rise higher.'],
  ['stack', 'Stack', 'ui', 'A call stack of five frames. The pointer’s height picks one, and the frames above lift away to open it.', 'The frames above lift further.'],
];
export const FIGURES = ROWS.map(([fn, name, group, what, more]) => ({ fn, name, group, what, more }));

// Each palette sets the six --hairline-* custom properties. "ink" and
// "paper" are the library's own dark and light defaults (core/styles.ts).
// The other four are ours. theme: the library theme option to pass.
export const PALETTES = [
  { id: 'ink', label: 'Ink', theme: 'dark', vars: { plate: '#08090a', hi: '#d0d6e0', edge: '#5b5d64', mid: '#3e3e44', lo: '#29292d' } },
  { id: 'paper', label: 'Paper', theme: 'light', vars: { plate: '#ffffff', hi: '#232327', edge: '#a4a4ac', mid: '#c3c3c9', lo: '#e0e0e4' } },
  { id: 'blueprint', label: 'Blueprint', theme: 'dark', vars: { plate: '#0b2340', hi: '#e8f2ff', edge: '#7fa6d6', mid: '#3f6796', lo: '#1d3c63' } },
  { id: 'amber', label: 'Amber', theme: 'dark', vars: { plate: '#0d0a05', hi: '#ffc86b', edge: '#a8742c', mid: '#5e4219', lo: '#33240e' } },
  { id: 'mint', label: 'Mint', theme: 'dark', vars: { plate: '#06110e', hi: '#9ff0cf', edge: '#4fa486', mid: '#2b5f4e', lo: '#16322a' } },
  { id: 'kraft', label: 'Kraft', theme: 'light', vars: { plate: '#efe4cf', hi: '#3a2a16', edge: '#8c7556', mid: '#b49f7f', lo: '#d6c6a8' } },
];
export const PALETTE_KEYS = ['plate', 'hi', 'edge', 'mid', 'lo'];

export function figureOf(fn) { return FIGURES.find(f => f.fn === fn) || null; }
export function paletteOf(id) { return PALETTES.find(p => p.id === id) || PALETTES[0]; }

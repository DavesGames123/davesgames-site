// patterns.js -- preset crease patterns: generated bases and real classic models.
//
// Port of origami src/patterns.rs, grown into a library. The first twenty
// presets are the native app's, with the same ids. Five come from a rule
// (blank, single fold, waterbomb, blintz, and the Miura-ori). The rest of the
// twenty load from FOLD files taken from two MIT sources:
//   origamicp by Nihat Garibli: pleat, miura_large, vertex4, vertex6, vertex8.
//   flat-folder by Jason S. Ku, traditional models from the ORIPA data set:
//     birdbase, birdbase2, boat, crane, house, kabuto, pig, pinwheel,
//     sailboat, yakko.
// library.js appends every other preset: more files from those two sources
// and from Ghassaei's Origami Simulator, and the classics in generators.js.
// See CREDITS.txt. A loaded file is normalized into a 0.9-wide box on the
// origin, so every preset fills the sheet the same way.
//
// The Rust build embeds the files with include_str. Here the page fetches a
// file when a person first picks its preset (prepare), and tests.mjs reads
// every file from disk (preloadFolds). After that, build is synchronous, as in
// the native app.
//
// grep map:
//   Preset            -- the native twenty: menu ids, with a label each
//   ALL / GROUPS      -- every preset, and the library sections in order
//   setReader / prepare / preloadFolds -- read FOLD files into the cache
//   build             -- a preset to a crease pattern
//   fromFoldText      -- parse a FOLD text and normalize it
//   miuraOri / waterbomb / singleFold / blintz -- the native generated ones

import { Assignment, CreasePattern } from './model.js';
import { fromJson } from './foldio.js';
import { GENERATORS } from './generators.js';
import { LIBRARY, GROUPS as SECTIONS, SOURCES } from './library.js';

const f32 = Math.fround;

// Every preset, in menu order. The label is the text on the library chip.
// The native twenty, in menu order. The label is the text on the library tile.
// `group` is the library section, `src` a key of SOURCES, `path` the upstream
// file at the commit SOURCES names, and `author` the designer as it is stated.
const OCP = 'origamicp', FF = 'flatfolder', GEN = 'gen';
const TRAD = 'traditional', NONE = 'no designer stated', ORIPA = 'Traditional (ORIPA Data Set)';
export const Preset = Object.freeze({
  BlankSquare: { id: 'blank', label: 'BLANK', group: 'bases', src: GEN, author: NONE },
  SingleFold: { id: 'single', label: 'SINGLE FOLD', group: 'bases', src: GEN, author: TRAD },
  Waterbomb: { id: 'waterbomb', label: 'WATERBOMB', group: 'bases', src: GEN, author: TRAD },
  Blintz: { id: 'blintz', label: 'BLINTZ', group: 'bases', src: GEN, author: TRAD },
  Vertex4: { id: 'vertex4', label: '4-STAR', file: 'vertex4.fold', group: 'bases', src: OCP, path: 'data/designs/d02_vertex4.fold', author: NONE },
  Vertex6: { id: 'vertex6', label: '6-STAR', file: 'vertex6.fold', group: 'bases', src: OCP, path: 'data/designs/d03_vertex6.fold', author: NONE },
  Vertex8: { id: 'vertex8', label: '8-STAR', file: 'vertex8.fold', group: 'bases', src: OCP, path: 'data/designs/d04_vertex8.fold', author: NONE },
  BirdBase: { id: 'birdbase', label: 'BIRD BASE', file: 'birdbase.fold', group: 'bases', src: FF, path: 'examples/instagram/082_traditionaloripa_4_Birdbase.fold', author: ORIPA,
    note: 'also in Origami Simulator as assets/Bases/birdBase.svg' },
  Pleat: { id: 'pleat', label: 'PLEAT', file: 'pleat.fold', group: 'folds', src: OCP, path: 'data/designs/d01_pleat.fold', author: NONE },
  MiuraOri: { id: 'miura', label: 'MIURA-ORI', group: 'tess', src: GEN, author: 'after Koryo Miura (Miura-ori)' },
  MiuraLarge: { id: 'miura-xl', label: 'MIURA XL', file: 'miura_large.fold', group: 'tess', src: OCP, path: 'data/designs/d06_miura_large.fold', author: NONE,
    note: 'the Miura-ori fold is due to Koryo Miura' },
  Pinwheel: { id: 'pinwheel', label: 'PINWHEEL', file: 'pinwheel.fold', group: 'models', src: FF, path: 'examples/instagram/102_traditionaloripa_Pinwheel.fold', author: ORIPA,
    note: 'also in flat-folder as original/pinwheel.opx, and in Origami Simulator as assets/Bases/pinwheelBase.svg' },
  Sailboat: { id: 'sailboat', label: 'SAILBOAT', file: 'sailboat.fold', group: 'models', src: FF, path: 'examples/instagram/001_traditional_Sailboat.fold', author: 'Traditional' },
  Boat: { id: 'boat', label: 'BOAT', file: 'boat.fold', group: 'models', src: FF, path: 'examples/instagram/067_traditionaloripa_damashi_bune.fold', author: ORIPA },
  Kabuto: { id: 'kabuto', label: 'KABUTO', file: 'kabuto.fold', group: 'models', src: FF, path: 'examples/instagram/002_traditional_Kabuto.fold', author: 'Traditional' },
  House: { id: 'house', label: 'HOUSE', file: 'house.fold', group: 'models', src: FF, path: 'examples/instagram/052_traditionaloripa_House.fold', author: ORIPA },
  Yakko: { id: 'yakko', label: 'YAKKO', file: 'yakko.fold', group: 'models', src: FF, path: 'examples/instagram/038_traditionaloripa_Yakko.fold', author: ORIPA },
  Pig: { id: 'pig', label: 'PIG', file: 'pig.fold', group: 'models', src: FF, path: 'examples/instagram/045_traditionaloripa_Pig.fold', author: ORIPA },
  Crane: { id: 'crane', label: 'CRANE', file: 'crane.fold', group: 'models', src: FF, path: 'examples/instagram/004_traditional_Crane.fold', author: 'Traditional',
    note: 'also in Origami Simulator as traditionalCrane.svg and flat_crane.svg' },
  BirdBase9: { id: 'birdbase9', label: '9-BIRD BASE', file: 'birdbase2.fold', group: 'models', src: FF, path: 'examples/instagram/089_traditionaloripa_9_Birdbase.fold', author: ORIPA },
});

export const NATIVE = Object.values(Preset);
export const ALL = [...NATIVE, ...LIBRARY];
export { SOURCES };

// The library sections in order, each with its presets in menu order.
export const GROUPS = SECTIONS.map((g) => ({ ...g, list: ALL.filter((p) => p.group === g.id) }));

export function byId(id) { return ALL.find((p) => p.id === id) || null; }

// FOLD text per file name, filled by prepare or preloadFolds.
const foldText = new Map();
let reader = null;

// Set how prepare reads a file: `readText(name)` returns a promise of its text.
export function setReader(readText) { reader = readText; }

// Read the FOLD file a preset needs, once. Generated presets need none.
export async function prepare(p) {
  if (!p || !p.file || foldText.has(p.file)) return;
  if (!reader) throw new Error('patterns.setReader was not called');
  foldText.set(p.file, await reader(p.file));
}

// Read the FOLD files of `list` (every preset by default). The native app also
// reads miura.fold for its generated MIURA-ORI; here MIURA 4x4 uses it.
export async function preloadFolds(readText, list = ALL) {
  setReader(readText);
  await Promise.all(list.map(prepare));
}

// Build the crease pattern for a preset.
export function build(p) {
  switch (p) {
    case Preset.BlankSquare: return blankSquare();
    case Preset.SingleFold: return singleFold();
    case Preset.Waterbomb: return waterbomb();
    case Preset.Blintz: return blintz();
    case Preset.MiuraOri: return miuraOri(6, 4);
    default: {
      if (p.gen) return GENERATORS[p.gen[0]](...p.gen[1]);
      const text = foldText.get(p.file);
      if (text === undefined) throw new Error(`the FOLD file ${p.file} was not preloaded`);
      return fromFoldText(text);
    }
  }
}

// Parse a FOLD text and fit its bounding box into a 0.9-wide box on the origin.
export function fromFoldText(json) {
  let cp;
  try { cp = fromJson(json); } catch { cp = new CreasePattern(); }
  if (cp.vertices.length === 0) return CreasePattern.newSquare(0.5);
  let lx = Infinity, ly = Infinity, hx = -Infinity, hy = -Infinity;
  for (const v of cp.vertices) {
    lx = Math.min(lx, v[0]); ly = Math.min(ly, v[1]);
    hx = Math.max(hx, v[0]); hy = Math.max(hy, v[1]);
  }
  const cx = f32(f32(lx + hx) * 0.5), cy = f32(f32(ly + hy) * 0.5);
  const extent = Math.max(f32(hx - lx), f32(hy - ly), f32(1e-6));
  const scale = f32(f32(0.9) / extent);
  cp.vertices = cp.vertices.map((v) => [f32(f32(v[0] - cx) * scale), f32(f32(v[1] - cy) * scale)]);
  return cp;
}

// An empty sheet: the paper boundary and nothing else.
export function blankSquare() { return CreasePattern.newSquare(0.5); }

// One valley crease down the vertical centre line.
export function singleFold() {
  const cp = CreasePattern.newSquare(0.5);
  cp.addCrease([0, -0.5], [0, 0.5], Assignment.Valley);
  return cp;
}

// The eight points a degree-eight base radiates to.
const RAYS = [[0.5, 0], [0.5, 0.5], [0, 0.5], [-0.5, 0.5], [-0.5, 0], [-0.5, -0.5], [0, -0.5], [0.5, -0.5]];

// The blintz base: the four edge midpoints joined into a diamond, as valleys.
export function blintz() {
  const cp = CreasePattern.newSquare(0.5);
  const m = [[0.5, 0], [0, 0.5], [-0.5, 0], [0, -0.5]];
  for (let i = 0; i < 4; i++) cp.addCrease(m[i], m[(i + 1) % 4], Assignment.Valley);
  return cp;
}

// The waterbomb base: eight half-creases from the centre, five mountains and
// three valleys.
export function waterbomb() {
  const M = Assignment.Mountain, V = Assignment.Valley;
  const kinds = [V, M, V, M, V, M, M, M];
  const cp = CreasePattern.newSquare(0.5);
  RAYS.forEach((p, i) => cp.addCrease([0, 0], p, kinds[i]));
  return cp;
}

// An n by m Miura-ori. Horizontal creases are mountains. Each vertical crease
// swaps mountain and valley row by row.
export function miuraOri(n, m) {
  const cp = CreasePattern.newSquare(0.5);
  n = Math.max(n, 2); m = Math.max(m, 2);
  const cellW = f32(1 / n), cellH = f32(1 / m);
  const shear = f32(cellW * f32(0.28));
  const xAt = (i, row) => f32(f32(-0.5 + f32(f32(i) * cellW)) + (row % 2 === 0 ? shear : -shear));
  const yAt = (row) => f32(-0.5 + f32(f32(row) * cellH));
  for (let row = 1; row < m; row++) {
    for (let i = 0; i < n; i++) cp.addCrease([xAt(i, row), yAt(row)], [xAt(i + 1, row), yAt(row)], Assignment.Mountain);
  }
  for (let i = 1; i < n; i++) {
    for (let row = 0; row < m; row++) {
      const kind = row % 2 === 0 ? Assignment.Mountain : Assignment.Valley;
      cp.addCrease([xAt(i, row), yAt(row)], [xAt(i, row + 1), yAt(row + 1)], kind);
    }
  }
  return cp;
}

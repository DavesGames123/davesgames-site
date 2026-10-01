// patterns.js -- preset crease patterns: generated bases and real classic models.
//
// Port of origami src/patterns.rs. Four presets come from a rule (blank,
// single fold, waterbomb, blintz, and the Miura-ori). The rest load from the FOLD
// files in patterns/, taken from permissively licensed sources:
//   origamicp by Nihat Garibli (MIT): pleat, miura, miura_large, vertex4,
//     vertex6, vertex8.
//   flat-folder by Jason S. Ku (MIT), traditional models from the ORIPA data
//     set: birdbase, birdbase2, boat, crane, house, kabuto, pig, pinwheel,
//     sailboat, yakko.
// See CREDITS.txt. A loaded file is normalized into a 0.9-wide box on the
// origin, so every preset fills the sheet the same way.
//
// The Rust build embeds the files with include_str. Here preloadFolds fetches
// them once at boot (or reads them from disk in tests.mjs). After that, build
// is synchronous, as in the native app.
//
// grep map:
//   Preset            -- the menu ids, with a label each
//   bases / tessellations / models -- the library groups
//   preloadFolds      -- read every FOLD file into the cache
//   build             -- a preset to a crease pattern
//   fromFoldText      -- parse a FOLD text and normalize it
//   miuraOri / waterbomb / singleFold / blintz -- the generated ones

import { Assignment, CreasePattern } from './model.js';
import { fromJson } from './foldio.js';

const f32 = Math.fround;

// Every preset, in menu order. The label is the text on the library chip.
export const Preset = Object.freeze({
  BlankSquare: { id: 'blank', label: 'BLANK' },
  SingleFold: { id: 'single', label: 'SINGLE FOLD' },
  Waterbomb: { id: 'waterbomb', label: 'WATERBOMB' },
  Blintz: { id: 'blintz', label: 'BLINTZ' },
  Vertex4: { id: 'vertex4', label: '4-STAR', file: 'vertex4.fold' },
  Vertex6: { id: 'vertex6', label: '6-STAR', file: 'vertex6.fold' },
  Vertex8: { id: 'vertex8', label: '8-STAR', file: 'vertex8.fold' },
  BirdBase: { id: 'birdbase', label: 'BIRD BASE', file: 'birdbase.fold' },
  Pleat: { id: 'pleat', label: 'PLEAT', file: 'pleat.fold' },
  MiuraOri: { id: 'miura', label: 'MIURA-ORI' },
  MiuraLarge: { id: 'miura-xl', label: 'MIURA XL', file: 'miura_large.fold' },
  Pinwheel: { id: 'pinwheel', label: 'PINWHEEL', file: 'pinwheel.fold' },
  Sailboat: { id: 'sailboat', label: 'SAILBOAT', file: 'sailboat.fold' },
  Boat: { id: 'boat', label: 'BOAT', file: 'boat.fold' },
  Kabuto: { id: 'kabuto', label: 'KABUTO', file: 'kabuto.fold' },
  House: { id: 'house', label: 'HOUSE', file: 'house.fold' },
  Yakko: { id: 'yakko', label: 'YAKKO', file: 'yakko.fold' },
  Pig: { id: 'pig', label: 'PIG', file: 'pig.fold' },
  Crane: { id: 'crane', label: 'CRANE', file: 'crane.fold' },
  BirdBase9: { id: 'birdbase9', label: '9-BIRD BASE', file: 'birdbase2.fold' },
});

export const ALL = Object.values(Preset);

export const bases = [Preset.BlankSquare, Preset.SingleFold, Preset.Waterbomb, Preset.Blintz,
  Preset.Vertex4, Preset.Vertex6, Preset.Vertex8, Preset.BirdBase];
export const tessellations = [Preset.Pleat, Preset.MiuraOri, Preset.MiuraLarge, Preset.Pinwheel];
export const models = [Preset.Sailboat, Preset.Boat, Preset.Kabuto, Preset.House,
  Preset.Yakko, Preset.Pig, Preset.Crane, Preset.BirdBase9];

export function byId(id) { return ALL.find((p) => p.id === id) || null; }

// FOLD text per file name, filled by preloadFolds.
const foldText = new Map();

// Read every FOLD file the presets use. `readText(name)` returns a promise of
// the file text. The file miura.fold is read too, though the MIURA-ORI preset is
// generated, as in the Rust source.
export async function preloadFolds(readText) {
  const names = new Set(ALL.filter((p) => p.file).map((p) => p.file));
  names.add('miura.fold');
  await Promise.all([...names].map(async (n) => { foldText.set(n, await readText(n)); }));
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

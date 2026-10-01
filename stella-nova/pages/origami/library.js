// library.js -- the preset catalogue: every pattern past the first twenty, with
// its source, upstream path, and credit.
//
// patterns.js keeps the twenty presets of the native app (ids and Preset keys
// unchanged) and appends this list. Each entry is one of two kinds:
//   file -- a FOLD file in patterns/. `path` is its upstream path at the commit
//           in SOURCES. An .svg or .opx upstream file was converted once with
//           tools/svg2fold.mjs. A .fold upstream file is an unchanged copy.
//   gen  -- [name, args] into GENERATORS (generators.js, original code).
// `author` is the designer as the source states it. tools/build-library.mjs
// reads this file to copy and convert the files, bake thumbs.json, and write
// CREDITS.txt, so the three can not drift apart.
//
// grep map:
//   SOURCES   -- repo, commit, licence holder per source
//   GROUPS    -- the library sections, in order
//   LIBRARY   -- the entries
//   EXCLUDED  -- upstream patterns left out, with the reason

export const SOURCES = {
  origamicp: {
    name: 'origamicp', chip: 'ORIGAMICP', by: 'Nihat Garibli',
    repo: 'https://github.com/nihatgaribli/origamicp',
    commit: '58076815964d12b4df46a1c77a893ec51e308aa8', licence: 'MIT', copyright: 'Copyright (c) 2026 Nihat Garibli',
  },
  flatfolder: {
    name: 'flat-folder', chip: 'FLAT-FOLDER', by: 'Jason S. Ku',
    repo: 'https://github.com/origamimagiro/flat-folder',
    commit: 'd50004815fb738d009e5b87b2307fbaefa717ef0', licence: 'MIT', copyright: 'Copyright (c) 2022 Jason S. Ku (origamimagiro)',
  },
  origamisim: {
    name: 'Origami Simulator', chip: 'GHASSAEI', by: 'Amanda Ghassaei',
    repo: 'https://github.com/amandaghassaei/OrigamiSimulator',
    commit: '7855983a613c879c171b2b1557f8cd102d2640cf', licence: 'MIT', copyright: 'Copyright (c) 2018 Amanda Ghassaei',
  },
  gen: { name: 'generated', chip: 'GENERATED', by: 'this page', licence: 'same as the page' },
};

export const GROUPS = [
  { id: 'bases', name: 'BASES' },
  { id: 'folds', name: 'FOLDS AND PLEATS' },
  { id: 'tess', name: 'TESSELLATIONS' },
  { id: 'twists', name: 'TWISTS AND SADDLES' },
  { id: 'models', name: 'TRADITIONAL MODELS' },
  { id: 'ku', name: 'MODELS BY JASON KU' },
];

const TRAD = 'traditional';
const NONE = 'no designer stated';
const KU = 'Jason KU';
const os = (id, label, group, path, author, note) => ({ id, label, group, src: 'origamisim', file: `os_${id.replace(/^os-/, '').replace(/-/g, '_')}.fold`, path: `assets/${path}`, author, note });
const ff = (id, label, group, path, author, note) => ({ id, label, group, src: 'flatfolder', file: `ff_${id.replace(/^(ku|ff)-/, '').replace(/-/g, '_')}.fold`, path: `examples/${path}`, author, note });
const gen = (id, label, group, fn, args, author, note) => ({ id, label, group, src: 'gen', gen: [fn, args], author, note });

export const LIBRARY = [
  // ── bases ──
  os('os-square-base', 'SQUARE BASE', 'bases', 'Bases/squareBase.svg', TRAD),
  os('os-frog-base', 'FROG BASE', 'bases', 'Bases/frogBase.svg', TRAD),
  os('os-boat-base', 'BOAT BASE', 'bases', 'Bases/boatBase.svg', TRAD),
  os('os-open-sink', 'OPEN SINK BASE', 'bases', 'Bases/openSinkBase.svg', TRAD),
  os('os-simple-vertex', 'SIMPLE VERTEX', 'bases', 'SimpleFolds/simpleVertex.svg', NONE),

  // ── folds and pleats ──
  os('os-map-fold', 'MAP FOLD', 'folds', 'SimpleFolds/mapfold.svg', TRAD),
  os('os-brochure', 'BROCHURE FOLD', 'folds', 'SimpleFolds/brochurefold.svg', TRAD),
  os('os-russian-tri', 'RUSSIAN TRIANGLE', 'folds', 'SimpleFolds/russianTriangle.svg', TRAD),
  gen('accordion', 'ACCORDION 16', 'folds', 'accordion', [16], TRAD),
  gen('diag-pleats', 'DIAGONAL PLEATS', 'folds', 'diagonalPleats', [12], TRAD),
  gen('graded-pleats', 'GRADED PLEATS', 'folds', 'gradedPleats', [14, 0.84], TRAD),
  gen('fan-pleat', 'FAN PLEAT', 'folds', 'fanPleat', [14], TRAD),
  os('os-curved-pleat', 'CURVED PLEAT', 'folds', 'Bistable/curvedPleatSimple.svg', NONE,
    'a bistable pleat; the curve is a chain of flat facets'),

  // ── tessellations ──
  { id: 'miura-s', label: 'MIURA 4x4', group: 'tess', src: 'origamicp', file: 'miura.fold', path: 'data/designs/d05_miura_small.fold', author: NONE,
    note: 'the Miura-ori fold is due to Koryo Miura' },
  gen('miura-sharp', 'MIURA SHARP', 'tess', 'miuraSheared', [8, 6, 0.6], 'after Koryo Miura (Miura-ori)'),
  gen('yoshimura', 'YOSHIMURA', 'tess', 'yoshimura', [6, 4], 'after Yoshimura Yoshimaru (diamond pattern)'),
  gen('kresling', 'KRESLING', 'tess', 'kresling', [6, 4, 0.5], 'after Biruta Kresling'),
  gen('resch', 'RESCH TRIANGLES', 'tess', 'resch', [4], 'after Ron Resch (triangle pattern)'),
  gen('waterbomb-tess', 'WATERBOMB 8', 'tess', 'waterbombTess', [8], TRAD),
  os('os-waterbomb-tess', 'WATERBOMB TESS', 'tess', 'Tessellations/waterbomb.svg', NONE),
  ff('ff-grid-4x4', '4x4 GRID', 'tess', 'original/grid_assigned.opx', NONE),
  ff('ku-checker-4x4', '4x4 CHECKERBOARD', 'tess', 'instagram/084_ku_4x4_Checkerboard.fold', KU),
  ff('ku-pixel-8x8', '8x8 PIXEL GRID', 'tess', 'instagram/027_ku_8x8_Flippable_Pixel_Grid.fold', KU,
    'also in flat-folder as original/flip34.svg'),
  ff('ku-stripes-1', '4 STRIPES 1', 'tess', 'instagram/091_ku_4_Stripes_1.fold', KU),
  ff('ku-stripes-2', '4 STRIPES 2', 'tess', 'instagram/092_ku_4_Stripes_2.fold', KU),
  ff('ku-stripes-3', '4 STRIPES 3', 'tess', 'instagram/093_ku_4_Stripes_3.fold', KU),
  ff('ku-stripes-4', '4 STRIPES 4', 'tess', 'instagram/094_ku_4_Stripes_4.fold', KU),
  ff('ku-stripes-13', '13 STRIPES', 'tess', 'instagram/358_ku_13_Stripes.fold', KU),
  ff('ku-pleats-exp', 'EXPONENTIAL PLEATS', 'tess', 'instagram/164_ku_Pleats_Exponential.fold', KU),
  ff('ku-monotile-1', 'MONOTILE 1', 'tess', 'instagram/294_ku_Aperiodic_Monotile_1.fold', KU),
  ff('ku-monotile-2', 'MONOTILE 2', 'tess', 'instagram/296_ku_Aperiodic_Monotile_2.fold', KU),
  os('os-polygami-cross', 'POLYGAMI CROSS', 'tess', 'Polygami/polygamiCross.svg', NONE,
    'generated by the Polygami app (Shahul Alam, Lauren Huang, Mahi Shafiullah)'),

  // ── twists and saddles ──
  gen('square-twist', 'SQUARE TWIST', 'twists', 'squareTwist', [0.3, 26.565], TRAD),
  os('os-twist-angles', 'TWIST ANGLES', 'twists', 'Origami/squaretwistManyAngles.svg', NONE,
    'square twists at several angles, after the bistability paper the source cites'),
  ff('ku-bad-twist', 'BAD TWIST', 'twists', 'unsatisfiable/001_ku_Bad_Twist.fold', KU,
    'a square twist with no valid layer order'),
  os('os-hypar', 'HYPAR', 'twists', 'Origami/hypar.svg', TRAD,
    'triangulation after "(Non)existence of Pleated Folds" (Demaine et al.)'),
  os('os-hypar-6', 'HYPAR 6-POINT', 'twists', 'Origami/6ptHypar-anti.svg', TRAD),
  gen('hex-hypar', 'HEX HYPAR', 'twists', 'polygonHypar', [6, 8], TRAD),
  gen('circular-pleat', 'CIRCULAR PLEAT', 'twists', 'circularPleat', [8, 24], TRAD,
    'a polygon form of the circular pleat; the round original is too large to run here'),
  gen('spiral-flasher', 'SPIRAL FLASHER', 'twists', 'spiralFlasher', [4, 5, 0.55, 14], NONE,
    'a simple flasher: rings that grow and turn round a hub'),
  ff('ku-thirds-pinwheel', 'THIRDS PINWHEEL', 'twists', 'instagram/006_ku_Thirds_Pinwheel.fold', KU),
  ff('ku-pinwheel-pockets', 'PINWHEEL POCKETS', 'twists', 'instagram/007_ku_Pinwheel_Pockets.fold', KU),
  ff('ku-colour-pinwheel', 'COLOUR PINWHEEL', 'twists', 'instagram/058_ku_Color-change_Pinwheel_1.fold', KU,
    'also in flat-folder as original/pinwheel_colorchange1.svg and _2.svg'),
  ff('ku-quad-overlap', 'QUAD OVERLAP', 'twists', 'instagram/043_ku_Quad_Overlap.fold', KU),
  ff('ku-iso-half', 'ISO-AREA HALF', 'twists', 'instagram/015_ku_Iso-Area_Half_Square.fold', KU),
  ff('ku-star-1', 'ISO-AREA STAR 1', 'twists', 'instagram/151_ku_Iso-Area_Throwing_Star_1.fold', KU),
  ff('ku-star-2', 'ISO-AREA STAR 2', 'twists', 'instagram/152_ku_Iso-Area_Throwing_Star_2.fold', KU),
  ff('ku-star-3', 'ISO-AREA STAR 3', 'twists', 'instagram/153_ku_Iso-Area_Throwing_Star_3.fold', KU),

  // ── traditional models ──
  os('os-flapping-bird', 'FLAPPING BIRD', 'models', 'Origami/flappingBird.svg', TRAD,
    'also in flat-folder as original/flappingbird.svg'),
  os('os-airplane', 'PAPER AIRPLANE', 'models', 'Origami/airplane.svg', TRAD,
    'the source says: conventional paper airplane, pattern entered by Scott Pakin'),
  ff('ff-tiger-1', 'TIGER PIECE 1', 'models', 'original/tiger_piece1.opx', NONE),
  ff('ff-tiger-2', 'TIGER PIECE 2', 'models', 'original/tiger_piece2.opx', NONE),

  // ── models by Jason Ku ──
  ff('ku-triangle-bird', 'TRIANGLE BIRD', 'ku', 'instagram/003_ku_Triangle_Bird.fold', KU, 'also original/triangle_bird.svg'),
  ff('ku-kitten', 'KITTEN', 'ku', 'instagram/005_ku_Kitten.fold', KU),
  ff('ku-robot', 'ROBOT', 'ku', 'instagram/008_ku_Robot.fold', KU, 'also original/robot.svg'),
  ff('ku-bull', 'BULL', 'ku', 'instagram/011_ku_Bull.fold', KU),
  ff('ku-hj-girl', 'HJ GIRL', 'ku', 'instagram/014_ku_HJ_Girl.fold', KU),
  ff('ku-atarbus', 'STAR ATARBUS', 'ku', 'instagram/060_ku_1-Piece_Star_Atarbus.fold', KU),
  ff('ku-jerboa', 'PYGMY JERBOA', 'ku', 'instagram/070_ku_Pygmy_Jerboa.fold', KU, 'also original/jerboa.svg'),
  ff('ku-turkey', 'TURKEY 2.1', 'ku', 'instagram/101_ku_Turkey_2-1.fold', KU, 'an earlier form is original/turkey2015.opx'),
  ff('ku-xmas-tree', 'CHRISTMAS TREE', 'ku', 'instagram/131_ku_Christmas_Tree.fold', KU),
  ff('ku-butterfly', 'BUTTERFLY', 'ku', 'instagram/142_ku_Butterfly.fold', KU),
  ff('ku-angel', 'ANGEL', 'ku', 'instagram/263_ku_Angel.fold', KU, 'also original/angel.svg'),
  ff('ku-hj-rex', 'HJ REX', 'ku', 'instagram/270_ku_HJ_Rex.fold', KU),
  ff('ku-crab-base', 'CRAB BASE', 'ku', 'instagram/278_ku_Crab_(base).fold', KU),
  ff('ku-clover', 'FOUR LEAF CLOVER', 'ku', 'instagram/287_ku_Four_Leaf_Clover.fold', KU),
  ff('ku-hj-dragon', 'HJ DRAGON', 'ku', 'instagram/311_ku_HJ_Dragon.fold', KU),
  ff('ku-f16', 'F16', 'ku', 'instagram/330_ku_F16.fold', KU),
  ff('ku-rabbit', 'RABBIT', 'ku', 'instagram/337_ku_Rabbit.fold', KU),
  ff('ku-lizard', 'LIZARD', 'ku', 'instagram/344_ku_Lizard.fold', KU),
  ff('ku-three-dragon', 'THREE HEADED DRAGON', 'ku', 'instagram/351_ku_Three_Headed_Dragon.fold', KU),
  ff('ku-nazgul', 'NAZGUL', 'ku', 'instagram/365_ku_Nazgul_v8.1.fold', KU),
];

// Upstream patterns that are not in the library, and why. CREDITS.txt and the
// report list these. A group line stands for every file it names.
export const EXCLUDED = [
  // licence: a named designer, and no licence or permission in the repo
  ['flatfolder', 'examples/grids/*.fold (375 files)', 'Daniel BROWN', 'licence: named designer, no licence or permission stated'],
  ['flatfolder', 'examples/instagram/* (288 files) by 48 named designers other than Jason Ku (Kota IMAI, Kei MORISUE, Satoshi KAMIYA, Hideo KOMATSU, Xiao CHEN, Alessandro BEBER, Robert LANG, Brian CHAN, and others; see instagram_data.csv)', 'named designers', 'licence: no licence or permission stated'],
  ['flatfolder', 'examples/instagram/* "(ORIPA Data Set)" (16 files) by Masashi TANAKA, Yohsuke FURUTA, Hideo KOMATSU, Tomohiro TACHI, Jun MITANI, Koryo MIURA', 'named designers', 'licence: no licence or permission stated'],
  ['flatfolder', 'examples/instagram/301-319 (8 files)', 'Akitaya et al., Box Pleating is Hard', 'licence: named authors, no licence or permission stated'],
  ['flatfolder', 'examples/unsatisfiable/002, 004-012', 'named designers', 'licence: no licence or permission stated'],
  ['origamisim', 'assets/Origami/randlettflappingbird.svg', 'Samuel Randlett', 'licence'],
  ['origamisim', 'assets/Origami/langCardinal.svg, langOrchid.svg, langKnlDragon.svg', 'Robert Lang', 'licence'],
  ['origamisim', 'assets/Origami/MoosersTrainRigid-Gardner.svg', 'Emmanuel Mooser, William Gardner', 'licence'],
  ['origamisim', 'assets/Tessellations/miura-ori.svg, miura_sharpangle.svg', 'Koryo Miura', 'licence; the Miura-ori is also generated and in origamicp'],
  ['origamisim', 'assets/Tessellations/whirlpool.svg', 'Tomoko Fuse, Sara Adams', 'licence'],
  ['origamisim', 'assets/Tessellations/FTpoly7.svg', 'Chris K. Palmer, William Gardner', 'licence'],
  ['origamisim', 'assets/Tessellations/HexTriFlatFoldableTess.svg', 'Kendrick Feller', 'licence'],
  ['origamisim', 'assets/Tessellations/huffman*.svg (5 files), assets/Curved/huffmanTower.svg', 'David Huffman', 'licence'],
  ['origamisim', 'assets/Tessellations/lang*.svg (5 files)', 'Robert Lang', 'licence'],
  ['origamisim', 'assets/Tessellations/reschTriTessellation.svg, reschBarbell.svg', 'Ron Resch', 'licence; the Resch triangle pattern is generated instead'],
  ['origamisim', 'assets/Curved/* by Jun Mitani (8), Ekaterina Lukasheva (3), Kendrick Feller (1), Sam Calisch (1)', 'named designers', 'licence'],
  ['origamisim', 'assets/Kirigami/miyamotoTower.svg, auxetic_triangle.svg, triPerfTess.svg', 'Yoshinobu Miyamoto, Garrett Milliron, Johann Kreuter', 'licence'],
  ['origamisim', 'assets/Popup/geometricPopup.svg, castlePopup.svg, housePopup.svg', 'Ullagami, Elod Beregszaszi', 'licence'],
  ['origamisim', 'assets/Pleating/*.fold (6 files)', 'Goran Konjevod', 'licence'],
  // cuts: the page has no cut kind
  ['origamisim', 'assets/Kirigami/honeycombKiri.svg, assets/Popup/popupSimple.svg', 'no designer stated', 'cut lines: the page has no cut kind'],
  // size: too large to run at an interactive rate on a phone
  ['origamisim', 'assets/Curved/CircularPleat-antiFacet.svg', 'no designer stated', 'size: 1600 nodes, and the sim goes non-finite part folded'],
  ['origamisim', 'assets/Squaremaze/cross.svg, helloworld.svg, origamisimulator.svg', 'Maze Folder output (E. Demaine, M. Demaine, J. Ku)', 'size: 484 to 5000+ nodes'],
  ['flatfolder', 'examples/instagram/036_ku_Checkerboard_26x26.fold, unsatisfiable/003_ku_Chessboard_26x26_(old).fold', 'Jason KU', 'size: 839 nodes'],
  ['flatfolder', 'examples/instagram/077_ku_Lobster_1-8b.fold', 'Jason KU', 'size: 720 nodes'],
  ['flatfolder', 'examples/instagram/050_ku_Ryu_Zin_Jr.fold (also original/ryuzin_jr.fold)', 'Jason KU', 'size: 523 nodes'],
  ['flatfolder', 'examples/instagram/279_ku_Crab_(shaped).fold', 'Jason KU', 'size: 1396 nodes'],
  // nothing to fold
  ['flatfolder', 'examples/instagram/009_ku_Unassigned_Triangle_Pleat.fold, 012_ku_4x4_Grid_Unassigned.fold, original/grid_unassigned.svg, original/triangle_pleats_*.svg', 'Jason KU', 'unassigned: no mountain or valley, so nothing folds'],
  // duplicates: the same model is in the library from another file
  ['flatfolder', 'original/crane.svg, kabuto.fold, sailboat.svg, pinwheel.opx', 'traditional', 'duplicate of the instagram/ copies already shipped'],
  ['flatfolder', 'original/flappingbird.svg', 'traditional', 'duplicate of Origami Simulator flappingBird.svg'],
  ['flatfolder', 'original/angel.svg, chess4x4.svg, chess26.svg, flip34.svg, iso_area_half.svg, jerboa.svg, pinwheel_colorchange1.svg, pinwheel_colorchange2.svg (its mirror), quad_overlap.svg, robot.svg, stripes4.svg, triangle_bird.svg, turkey2015.opx', 'Jason KU (by the instagram/ copy)', 'duplicate of the instagram/ copy'],
  ['origamisim', 'assets/Origami/traditionalCrane.svg, flat_crane.svg', 'traditional', 'duplicate of the flat-folder crane'],
  ['origamisim', 'assets/Bases/birdBase.svg, pinwheelBase.svg, waterbombBase.svg', 'traditional', 'duplicate of BIRD BASE, PINWHEEL, WATERBOMB'],
  ['origamisim', 'assets/Origami/singlesquaretwist.svg', 'no designer stated', 'duplicate of the generated SQUARE TWIST'],
  ['origamicp', 'code/origamicp/generate/random_cp.py', 'Nihat Garibli', 'random patterns, not examples'],
  // not in the example menu of the source
  ['origamisim', 'assets/Tessellations/test.svg, Curved/curvedcrease2.svg, Curved/shell6.svg, Polygami/polygami.svg, needsCollisions/*, PolygonUnfolding/*, doc/*', 'various', 'not in the source example menu'],
];

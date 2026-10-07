// ============================================================================
//  CONTEXT FREE  ·  designs.js — the gallery list (no DOM)
// ----------------------------------------------------------------------------
//  Each entry names one file in designs/. Three sources:
//    example  the example designs of the Context Free distribution
//             (input/*.cfdg at the upstream commit in engine/UPSTREAM),
//             GPL-2.0-or-later with the program. Copied byte for byte.
//    test     designs from the upstream test suite (input/tests), for the
//             tiled, frieze and animated features. Byte copies, renamed
//             with a "test-" prefix.
//    ours     designs written for this page, GPL-2.0-or-later.
//  Not shipped: aliastest and rendering-tests (engine checks, not art),
//  the *_v2 files (the same designs in the old CFDG 2 syntax), and every
//  design of the contextfreeart.org gallery (each has its own licence).
//
//  Fields: id, file, title, src, note; optional tiled, anim (frames for
//  the time animation), max (max shapes for a thumbnail), var (the
//  variation code of the first render; default random).
// ============================================================================
export const DESIGNS = [
  { id: 'welcome', file: 'welcome.cfdg', title: 'Welcome', src: 'example', note: 'Letters built from LINE shapes, with vines that branch by random rule choice.' },
  { id: 'demo1', file: 'demo1.cfdg', title: 'Demo 1', src: 'example', note: 'A forest of three seeds. Each branch picks a rule by weight, so every variation grows new trees.' },
  { id: 'demo2', file: 'demo2.cfdg', title: 'Demo 2', src: 'example', note: 'The CFDG letters from the dot-matrix alphabet, placed in a ring.' },
  { id: 'snowflake', file: 'snowflake.cfdg', title: 'Snowflake', src: 'example', note: 'Six-fold symmetry from one branching rule.' },
  { id: 'sierpinski', file: 'sierpinski.cfdg', title: 'Sierpinski', src: 'example', note: 'Triangles inside triangles, with circles in the holes.' },
  { id: 'octopi', file: 'octopi.cfdg', title: 'Octopi', src: 'example', note: 'A family of curling octopuses, each one a smaller copy.' },
  { id: 'thingy', file: 'thingy.cfdg', title: 'Thingy', src: 'example', note: 'Twelve lines of grammar: a circle and four half-size copies of itself.' },
  { id: 'cilia', file: 'cilia.cfdg', title: 'Cilia', src: 'example', note: 'Curling strands that bend a little each step.' },
  { id: 'ciliasun', file: 'ciliasun.cfdg', title: 'Cilia Sun', src: 'example', note: 'The cilia strands in a ring, with colour.' },
  { id: 'rose', file: 'rose.cfdg', title: 'Rose', src: 'example', note: 'A flower in colour: petals as layered circles.' },
  { id: 'funky_flower', file: 'funky_flower.cfdg', title: 'Funky Flower', src: 'example', note: 'Curves from the i_curves library, set as a flower.' },
  { id: 'tangle', file: 'tangle.cfdg', title: 'Tangle', src: 'example', note: 'Lines that loop and cross by random rule choice.' },
  { id: 'thorns', file: 'thorns.cfdg', title: 'Thorns', src: 'example', note: 'Four arms of circles that split three ways at each half-size step.' },
  { id: 'tree_number_5', file: 'tree_number_5.cfdg', title: 'Tree No. 5', src: 'example', note: 'A tree: each branch is a smaller, turned copy of the trunk.' },
  { id: 'mtree', file: 'mtree.cfdg', title: 'M Tree', src: 'example', note: 'Two plants of circles that bend left or right by random rule choice.' },
  { id: 'point', file: 'point.cfdg', title: 'Point', src: 'example', note: 'One rule that turns and shrinks, with weighted choices.' },
  { id: 'weighting_demo', file: 'weighting_demo.cfdg', title: 'Weighting Demo', src: 'example', note: 'Rule weights: a rare rule flips the direction of growth.' },
  { id: 'triples', file: 'triples.cfdg', title: 'Triples', src: 'example', note: 'Three-fold patterns of triangles.' },
  { id: 'ziggy', file: 'ziggy.cfdg', title: 'Ziggy', src: 'example', note: 'A trident of zigzags.' },
  { id: 'quadcity', file: 'quadcity.cfdg', title: 'Quad City', src: 'example', note: 'Squares split into four, again and again, by random choice.' },
  { id: 'underground', file: 'underground.cfdg', title: 'Underground', src: 'example', note: 'A transit map: routes that turn at right angles.' },
  { id: 'xmas', file: 'xmas.cfdg', title: 'Xmas', src: 'example', note: 'A fir tree with a star.' },
  { id: 'chanukah', file: 'chanukah.cfdg', title: 'Chanukah', src: 'example', note: 'A menorah with its candles and flames.' },
  { id: 'alphabet', file: 'alphabet.cfdg', title: 'Alphabet', src: 'example', note: 'Text along a spiral, with the i_pix dot-matrix letters.' },
  { id: 'lesson', file: 'lesson.cfdg', title: 'Lesson', src: 'example', note: 'The upstream tutorial: shapes, adjustments and rules, labelled.' },
  { id: 'lesson2', file: 'lesson2.cfdg', title: 'Lesson 2', src: 'example', note: 'The second tutorial: colour, transforms and paths, labelled.' },
  { id: 'i_polygons', file: 'i_polygons.cfdg', title: 'Polygons', src: 'example', note: 'The polygon library of the examples, drawn as a sheet.' },
  { id: 'i_curves', file: 'i_curves.cfdg', title: 'Curves', src: 'example', note: 'The curve library of the examples, drawn as a sheet.' },
  { id: 'i_pix', file: 'i_pix.cfdg', title: 'Pix Alphabet', src: 'example', note: 'The dot-matrix alphabet library on a 5 by 5 grid.' },
  { id: 'truchet', file: 'ours-truchet.cfdg', title: 'Truchet Weave', src: 'ours', tiled: true, note: 'Quarter-arc tiles; CF::Tile repeats the block with no seam.' },
  { id: 'garden', file: 'test-pathparamtest1.cfdg', title: 'Flower Garden', src: 'test', tiled: true, max: 4000, note: 'Paths with parameters on a skewed tile (upstream test pathparamtest1).' },
  { id: 'maze', file: 'test-basic.cfdg', title: 'Diagonal Maze', src: 'test', tiled: true, note: 'One of two diagonals per cell, on a tile (upstream test basic).' },
  { id: 'p4g', file: 'test-wallpapertest1.cfdg', title: 'Wallpaper p4g', src: 'test', tiled: true, note: 'CF::Symmetry with the p4g wallpaper group (upstream test wallpapertest1).' },
  { id: 'spikes', file: 'test-friezetest1.cfdg', title: 'Spike Frieze', src: 'test', tiled: true, note: 'A frieze: the design repeats along one axis (upstream test friezetest1).' },
  { id: 'rosette', file: 'ours-rosette.cfdg', title: 'Rosette in Time', src: 'ours', anim: 48, note: 'Animated with ftime(): each frame runs the grammar again.' },
  { id: 'spiral', file: 'test-timeanimtest2.cfdg', title: 'Spiral in Time', src: 'test', anim: 48, note: 'Shapes with time ranges, drawn frame by frame (upstream test timeanimtest2).' },
];

export const SRC_LABEL = { example: 'Context Free example', test: 'Context Free test suite', ours: 'Written for this page' };

export const byId = id => DESIGNS.find(d => d.id === id) || null;

// The design source text, fetched once.
const cache = new Map();
export function loadSource(d, base = import.meta.url) {
  if (!cache.has(d.file)) {
    cache.set(d.file, fetch(new URL('./designs/' + d.file, base)).then(r => {
      if (!r.ok) throw new Error(d.file + ': HTTP ' + r.status);
      return r.text();
    }));
  }
  return cache.get(d.file);
}

// patterns.js - the pattern library, grouped by class.
//
// Each pattern is RLE text that we typed from the classic public patterns.
// tests.mjs runs every one on the CPU and checks the "test" record, so a
// wrong cell fails the test. Fields:
//   id      key for the UI and the tests
//   cls     class id (see CLASSES)
//   name    display name
//   by      discoverer, when known with confidence ('' when not)
//   year    year of discovery, when known with confidence (0 when not)
//   desc    one line for the library
//   rle     the cells (b dead, o live, $ new row, ! end)
//   test    what tests.mjs checks:
//             {kind:'still'}
//             {kind:'osc', p}                 returns to itself at p, not before
//             {kind:'ship', p, dx, dy}        same shape after p, moved |dx|, |dy|
//             {kind:'gun', p}                 one more glider each period p
//             {kind:'puffer', p, dx}          the head repeats after p, moved dx
//             {kind:'meth', gen, pop}         stable from gen on with pop cells
//             {kind:'dies', gen}              last cell dies at gen
//             {kind:'growth', gen, min}       grows at each quarter of gen, more
//                                             than min cells at gen
//
// GREP MAP
//   grep -n "cls: '" patterns.js     every pattern and its class

export const CLASSES = [
  { id: 'still', name: 'Still lifes', blurb: 'Every live cell has two or three neighbours and no dead cell has three. Nothing changes.' },
  { id: 'osc', name: 'Oscillators', blurb: 'They return to the same shape after a fixed number of generations, the period.' },
  { id: 'ship', name: 'Spaceships', blurb: 'They return to the same shape in a new place. Speed is in c, one cell per generation.' },
  { id: 'gun', name: 'Guns and puffers', blurb: 'A gun stays in place and fires spaceships. A puffer moves and leaves debris behind it.' },
  { id: 'meth', name: 'Methuselahs', blurb: 'Small seeds with long, chaotic histories before they settle.' },
  { id: 'growth', name: 'Infinite growth', blurb: 'Small patterns whose population grows without limit.' },
];

export const PATTERNS = [
  // ---------------------------------------------------------- still lifes
  { id: 'block', cls: 'still', name: 'Block', by: '', year: 0, rle: '2o$2o!',
    desc: 'The smallest still life, and the most common one in random soup.', test: { kind: 'still' } },
  { id: 'beehive', cls: 'still', name: 'Beehive', by: '', year: 0, rle: 'b2o$o2bo$b2o!',
    desc: 'Six cells. The second most common still life.', test: { kind: 'still' } },
  { id: 'loaf', cls: 'still', name: 'Loaf', by: '', year: 0, rle: 'b2o$o2bo$bobo$2bo!',
    desc: 'Seven cells, a beehive with one corner pushed in.', test: { kind: 'still' } },
  { id: 'boat', cls: 'still', name: 'Boat', by: '', year: 0, rle: '2o$obo$bo!',
    desc: 'Five cells. A glider that hits a block can leave one.', test: { kind: 'still' } },
  { id: 'tub', cls: 'still', name: 'Tub', by: '', year: 0, rle: 'bo$obo$bo!',
    desc: 'Four cells around an empty center.', test: { kind: 'still' } },
  { id: 'eater', cls: 'still', name: 'Eater 1', by: '', year: 0, rle: '2o$obo$2bo$2b2o!',
    desc: 'Also called the fishhook. It destroys a glider that hits it and then repairs itself.', test: { kind: 'still' } },

  // ---------------------------------------------------------- oscillators
  { id: 'blinker', cls: 'osc', name: 'Blinker', by: '', year: 0, rle: '3o!',
    desc: 'Period 2. A row of three turns into a column of three and back.', test: { kind: 'osc', p: 2 } },
  { id: 'toad', cls: 'osc', name: 'Toad', by: 'Simon Norton', year: 1970, rle: 'b3o$3o!',
    desc: 'Period 2. Two offset rows of three.', test: { kind: 'osc', p: 2 } },
  { id: 'beacon', cls: 'osc', name: 'Beacon', by: '', year: 0, rle: '2o$2o$2b2o$2b2o!',
    desc: 'Period 2. Two blocks that touch at one corner, where two cells blink.', test: { kind: 'osc', p: 2 } },
  { id: 'pulsar', cls: 'osc', name: 'Pulsar', by: 'John Conway', year: 1970,
    rle: '2b3o3b3o2b2$o4bobo4bo$o4bobo4bo$o4bobo4bo$2b3o3b3o2b2$2b3o3b3o2b$o4bobo4bo$o4bobo4bo$o4bobo4bo2$2b3o3b3o!',
    desc: 'Period 3. Forty-eight cells with four-fold symmetry.', test: { kind: 'osc', p: 3 } },
  { id: 'pentadecathlon', cls: 'osc', name: 'Pentadecathlon', by: 'John Conway', year: 1970, rle: '2bo4bo2b$2ob4ob2o$2bo4bo!',
    desc: 'Period 15. It grows from a row of ten cells.', test: { kind: 'osc', p: 15 } },
  { id: 'figure8', cls: 'osc', name: 'Figure eight', by: 'Simon Norton', year: 1970, rle: '3o3b$3o3b$3o3b$3b3o$3b3o$3b3o!',
    desc: 'Period 8. Two squares of nine cells that touch at one corner.', test: { kind: 'osc', p: 8 } },
  { id: 'koks', cls: 'osc', name: "Kok's galaxy", by: 'Jan Kok', year: 1971, rle: '6ob2o$6ob2o$7b2o$2o5b2o$2o5b2o$2o5b2o$2o7b$2ob6o$2ob6o!',
    desc: 'Period 8. Four arms that turn like a pinwheel.', test: { kind: 'osc', p: 8 } },

  // ----------------------------------------------------------- spaceships
  { id: 'glider', cls: 'ship', name: 'Glider', by: 'Richard Guy', year: 1970, rle: 'bo$2bo$3o!',
    desc: 'c/4 diagonal. The smallest spaceship. It moves one cell diagonally every 4 generations.', test: { kind: 'ship', p: 4, dx: 1, dy: 1 } },
  { id: 'lwss', cls: 'ship', name: 'Lightweight spaceship', by: 'John Conway', year: 1970, rle: 'bo2bo$o4b$o3bo$4o!',
    desc: 'c/2 orthogonal. LWSS: nine cells, two cells every 4 generations.', test: { kind: 'ship', p: 4, dx: 2, dy: 0 } },
  { id: 'mwss', cls: 'ship', name: 'Middleweight spaceship', by: 'John Conway', year: 1970, rle: '3bo2b$bo3bo$o5b$o4bo$5o!',
    desc: 'c/2 orthogonal. MWSS: eleven cells, one row longer than the LWSS.', test: { kind: 'ship', p: 4, dx: 2, dy: 0 } },
  { id: 'hwss', cls: 'ship', name: 'Heavyweight spaceship', by: 'John Conway', year: 1970, rle: '3b2o2b$bo4bo$o6b$o5bo$6o!',
    desc: 'c/2 orthogonal. HWSS: thirteen cells, the longest of the three.', test: { kind: 'ship', p: 4, dx: 2, dy: 0 } },
  { id: 'copperhead', cls: 'ship', name: 'Copperhead', by: 'zdr', year: 2016, rle: 'b2o2b2o$3b2o$3b2o$obo2bobo$o6bo2$o6bo$b2o2b2o$2b4o2$3b2o$3b2o!',
    desc: 'c/10 orthogonal. The first c/10 spaceship, found 46 years after Life began.', test: { kind: 'ship', p: 10, dx: 0, dy: 1 } },

  // ------------------------------------------------------ guns and puffers
  { id: 'gosper', cls: 'gun', name: 'Gosper glider gun', by: 'Bill Gosper', year: 1970,
    rle: '24bo11b$22bobo11b$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o14b$2o8bo3bob2o4bobo11b$10bo5bo7bo11b$11bo3bo20b$12b2o!',
    desc: 'Period 30. The first gun: two shuttles that fire one glider every 30 generations.', test: { kind: 'gun', p: 30 } },
  { id: 'simkin', cls: 'gun', name: 'Simkin glider gun', by: 'Michael Simkin', year: 2015,
    rle: '2o5b2o$2o5b2o2$4b2o$4b2o5$22b2ob2o$21bo5bo$21bo6bo2b2o$21b3o3bo3b2o$26bo4$20b2o$20bo$21b3o$23bo!',
    desc: 'Period 120. It fires one glider every 120 generations. Two blocks hold its engine in place.', test: { kind: 'gun', p: 120 } },
  { id: 'puffer', cls: 'gun', name: 'Puffer train', by: '', year: 0, rle: '3bo$4bo$o3bo$b4o4$o$b2o$2bo$2bo$bo3$3bo$4bo$o3bo$b4o!',
    desc: 'c/2. Two escorts pull an engine that leaves a trail of smoke and debris. The head repeats every 140 generations.', test: { kind: 'puffer', p: 140, dx: 70 } },

  // ---------------------------------------------------------- methuselahs
  { id: 'rpent', cls: 'meth', name: 'R-pentomino', by: 'John Conway', year: 1970, rle: 'b2o$2o$bo!',
    desc: 'Five cells. It settles at generation 1103 with 116 cells, six of them in gliders.', test: { kind: 'meth', gen: 1103, pop: 116 } },
  { id: 'diehard', cls: 'meth', name: 'Diehard', by: '', year: 0, rle: '6bob$2o6b$bo3b3o!',
    desc: 'Seven cells that disappear completely after 130 generations.', test: { kind: 'dies', gen: 130 } },
  { id: 'acorn', cls: 'meth', name: 'Acorn', by: 'Charles Corderman', year: 0, rle: 'bo5b$3bo3b$2o2b3o!',
    desc: 'Seven cells. It settles at generation 5206 with 633 cells, thirteen gliders among them.', test: { kind: 'meth', gen: 5206, pop: 633 } },

  // ------------------------------------------------------ infinite growth
  { id: 'grow10', cls: 'growth', name: '10-cell infinite growth', by: 'Paul Callahan', year: 1997, rle: '6bob$4bob2o$4bobo$4bo$2bo$obo!',
    desc: 'The smallest known pattern that grows forever. It becomes a block-laying switch engine.', test: { kind: 'growth', gen: 4000, min: 400 } },
  { id: 'grow5x5', cls: 'growth', name: '5 x 5 infinite growth', by: 'Paul Callahan', year: 1997, rle: '3obo$o4b$3b2o$b2obo$obobo!',
    desc: 'Twelve cells that fit in a 5 x 5 box, and grow forever.', test: { kind: 'growth', gen: 4000, min: 450 } },
  { id: 'growline', cls: 'growth', name: 'One-cell-thick growth', by: '', year: 0, rle: '8ob5o3b3o6b7ob5o!',
    desc: 'One row, 39 cells wide, with 28 live cells. It grows forever.', test: { kind: 'growth', gen: 4000, min: 1000 } },
];

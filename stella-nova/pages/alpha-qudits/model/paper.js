// ============================================================================
//  ALPHA QUDITS  ·  model/paper.js  ·  printed values, for comparison only (MODEL)
// ----------------------------------------------------------------------------
//  The numbers that Wissner-Gross (2026) prints in Tables S2 and S5, typed
//  from the preprint. The engine (records.js, configs.js, value.js) does
//  not read these to build anything. tests.mjs and the UI compare the
//  recomputed values with them. value.js reads TABLE_S5 for one row only,
//  readEnds, which the model cannot recompute (fromPaper: true there).
//
//  grep -n targets:  TABLE_S5 | TABLE_S2 | PAPER
// ============================================================================

export const PAPER = Object.freeze({
  title: 'A Parameter-Free Candidate for the Fine-Structure Constant from Entangled Qudits',
  author: 'A. D. Wissner-Gross',
  date: '2026-10-23',
  note: 'Letter plus Supplemental Material, 24 pages. A preprint; its Lean file and scripts were not available to us.',
});

// Table S5: key, printed numerator {a, b, c, d} and denominator, printed
// inverse (3 decimals). 'computed' is the first row.
export const TABLE_S5 = [
  { key: 'computed', numerator: { a: 79, b: 48, c: 42, d: 3 }, denominator: 31104, inverse: '137.036' },
  { key: 'endsSwapped', numerator: { a: 79, b: 42, c: 48, d: 3 }, denominator: 31104, inverse: '135.894' },
  { key: 'bothAtQubit', numerator: { a: 85, b: 90, c: 0, d: 0 }, denominator: 31104, inverse: '146.524' },
  { key: 'bothAtQutrit', numerator: { a: 88, b: 0, c: 90, d: 0 }, denominator: 31104, inverse: '127.536' },
  { key: 'xWhereLettersSit', numerator: { a: 85, b: 54, c: 36, d: 0 }, denominator: 31104, inverse: '139.030' },
  { key: 'qqMovedByY', numerator: { a: 79, b: 48, c: 36, d: 9 }, denominator: 31104, inverse: '134.485' },
  { key: 'copiesSeparate', numerator: { a: 79, b: 0, c: 42, d: 51 }, denominator: 31104, inverse: '112.423' },
  { key: 'noOwnSign', numerator: { a: 82, b: 48, c: 42, d: 0 }, denominator: 31104, inverse: '139.713' },
  { key: 'commutatorsXOnly', numerator: { a: 79, b: 48, c: 45, d: 0 }, denominator: 31104, inverse: '138.348' },
  { key: 'sumsAndDiffs', numerator: { a: 79, b: 48, c: 42, d: 6 }, denominator: 31104, inverse: '132.739' },
  { key: 'noCommutators', numerator: { a: 79, b: 48, c: 42, d: 0 }, denominator: 31104, inverse: '141.621' },
  { key: 'born', numerator: { a: 319, b: 0, c: 0, d: 0 }, denominator: 31104, inverse: '97.505' },
  { key: 'readEnds', numerator: { a: 158, b: 96, c: 82, d: 3 }, denominator: 31104, inverse: '70.190' },
  { key: 'perRecord', numerator: { a: 79, b: 48, c: 42, d: 3 }, denominator: 172, inverse: '0.758' },
  { key: 'noWeights', numerator: { a: 172, b: 0, c: 0, d: 0 }, denominator: 31104, inverse: '180.837' },
  { key: 'smallest', numerator: { a: 30, b: 30, c: 0, d: 0 }, denominator: 256, inverse: '3.535' },
];

// Table S2: the 23 readable configurations as printed. arms 'eR'/'eU';
// N as [power of 2, power of 3]; records per pair of read arms as printed
// (first pair type only where the paper lists one number).
export const TABLE_S2 = [
  { center: 2, arms: '2R 2R', N: [8, 0], records: 57 },
  { center: 2, arms: '2R 3R', N: [6, 2], records: 102 },
  { center: 2, arms: '3R 3R', N: [4, 4], records: 174 },
  { center: 3, arms: '2R 2R', N: [4, 4], records: 172 },
  { center: 2, arms: '2R 2R 2U', N: [8, 2], records: 57 },
  { center: 2, arms: '2R 2R 2R', N: [12, 0], records: 57 },
  { center: 2, arms: '2R 3R 2U', N: [6, 4], records: 102 },
  { center: 2, arms: '2R 2R 3U', N: [11, 1], records: 57 },
  { center: 2, arms: '2R 2R 3R', N: [10, 2], records: 57 },
  { center: 2, arms: '3R 3R 2U', N: [4, 6], records: 174 },
  { center: 2, arms: '2R 3R 3U', N: [9, 3], records: 102 },
  { center: 2, arms: '2R 3R 3R', N: [8, 4], records: 102 },
  { center: 2, arms: '3R 3R 3U', N: [7, 5], records: 174 },
  { center: 3, arms: '2R 2R 2U', N: [7, 5], records: 172, object: true },
  { center: 2, arms: '3R 3R 3R', N: [6, 6], records: 174 },
  { center: 3, arms: '2R 2R 2R', N: [6, 6], records: 172 },
  { center: 3, arms: '2R 2R 3U', N: [10, 4], records: 172 },
  { center: 3, arms: '2R 2R 2U 2U', N: [10, 6], records: 172 },
  { center: 3, arms: '2R 2R 2R 2U', N: [9, 7], records: 172 },
  { center: 3, arms: '2R 2R 2R 2R', N: [8, 8], records: 172 },
  { center: 3, arms: '2R 2R 2U 3U', N: [13, 5], records: 172 },
  { center: 3, arms: '2R 2R 2R 3U', N: [12, 6], records: 172 },
  { center: 3, arms: '2R 2R 3U 3U', N: [16, 4], records: 172 },
];

// ============================================================================
//  FACET HEAD MODEL  ·  data.js — numbers from the paper
// ----------------------------------------------------------------------------
//  Lamarre, Akhoundi, Goyallon, Anderson, Danvoye. "FACET: A Data-Efficient
//  Regional Parametric Head Model". arXiv:2611.26773v1 (Electronic Arts),
//  SIGGRAPH Asia 2026 Technical Communications. Licence: CC BY-NC-ND 4.0.
//  The licence forbids derivatives, so the page copies no figure and no
//  text. Only the numbers (facts) are here, from the PDF text (v1):
//  Table 1, and the values that Sec. 4 states in its text. The B column of
//  E2 and all of E3 are from the text, not from Table 1.
//  Keep every paper number in this file; the page builds its tables here.
//
//  grep -n: "export const PAPER"  "export const SETUP"  "export const E1"
//           "export const E2"  "export const E3"
// ============================================================================

export const PAPER = {
  title: 'FACET: A Data-Efficient Regional Parametric Head Model',
  authors: 'Mathieu Lamarre, Elly Akhoundi, Thibault Goyallon, Patrick Anderson, Étienne Danvoye',
  orgs: 'Electronic Arts',
  venue: 'SIGGRAPH Asia 2026 Technical Communications (Kuala Lumpur, 1 to 4 December 2026)',
  arxiv: '2611.26773', url: 'https://arxiv.org/abs/2611.26773', doi: 'https://doi.org/10.1145/3829339.3847830',
  date: '19 November 2026 (v1)', licence: 'CC BY-NC-ND 4.0', licenceUrl: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
};

// Sec. 3 and the shared protocol of Sec. 4.
export const SETUP = {
  vertices: 8447, regions: 16, trainIds: 347, testIds: 59, testExpr: 19,
  lambda: 0.58, mlpHidden: 16, comboK: 4, rigs: 8, mapPrior: '5×10⁻⁵',
  globalRank: 346, regionalRank: 11072,          // N - 1 and 16 * 2 * (N - 1)
};

// E1, identity (neutral fit), held-out V2V mm, full capacity (Table 1).
export const E1 = {
  cols: ['Global PCA', 'Regional FACET'],
  rows: [['Overall', [1.95, 0.23]], ['Nose', [1.23, 0.12]], ['Eye orbit', [1.52, 0.13]], ['Lips', [1.46, 0.15]], ['Ear', [1.99, 0.27]]],
  median: 0.17, p95: 0.60, atK: 5120, crossK: 320, ratio: 8.3,
};

// E2, expression fit at K = 1000, held-out V2V mm. Sweep K = 50 to 1000.
// A = global PCA (MAP prior), B = generic AU, C = personalised AU.
export const E2 = {
  cols: ['A: global PCA', 'B: generic AU', 'C: personalised AU'],
  rows: [['Fit error', [1.67, 1.56, 1.47]], ['Eyelid', [1.31, 1.22, 1.09]]],
  kMin: 50, kMax: 1000,
};

// E3, pose leakage when unposing, mean V2V mm over the 347 identities.
export const E3 = {
  cols: ['Global-PCA ablation', 'FACET'],
  rows: [['Upper face (should not move)', [0.50, 0.16]], ['Whole head', [1.54, 1.58]]],
  ratio: 3.1,
};

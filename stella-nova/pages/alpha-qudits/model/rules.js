// ============================================================================
//  ALPHA QUDITS  ·  model/rules.js  ·  the clauses that decide the weights (MODEL)
// ----------------------------------------------------------------------------
//  A rule set is a plain object. DEFAULT_RULES is the paper's reading.
//  Each Table S5 toggle (TOGGLES) changes one clause. buildRecords() and
//  value() recompute every record under the changed rule. The toggles are
//  not a lookup of printed numbers: model/paper.js holds the printed
//  values only so that tests and the UI can compare.
//
//  Rule fields:
//    center, far      dimensions of the shared end and of the two far ends
//                     of the two read links (object: 3 and [2, 2])
//    unread           far dimension of the unread link, or null (object: 2)
//    xAt              where the exchange of reads X acts, so its factor:
//                     'read' (the end where reads are taken, the centre),
//                     'far', or 'letters' (the end where the letters sit)
//    yAt              where the exchange of links Y acts: 'moved' (every end
//                     whose letters Y carries to another qudit), 'center',
//                     or 'far'
//    copiesOneQudit   the copies of the shared qudit are one qudit
//    yMovesSameQudits Y also counts far-far records as moved
//    ownSign          a commutator record carries the order sign
//    commutators      'diff' (paper), 'none', or 'both' (sums and diffs)
//    yMovesCommutators Y acts on the commutator records
//    weightPower      0.5 (sqrt k, paper), 1 (Born square k), 0 (no weight)
//    normalize        'N' (readout dimension, paper) or 'records'
//    count            'units' (paper) or 'readEnds'
//
//  grep -n targets:  DEFAULT_RULES | TOGGLES | rulesFor | OBJECT_CONFIG
// ============================================================================

export const OBJECT_CONFIG = Object.freeze({ center: 3, far: [2, 2], unread: 2 });

export const DEFAULT_RULES = Object.freeze({
  center: 3, far: [2, 2], unread: 2,
  xAt: 'read', yAt: 'moved',
  copiesOneQudit: true, yMovesSameQudits: false,
  ownSign: true, commutators: 'diff', yMovesCommutators: true,
  weightPower: 0.5, normalize: 'N', count: 'units',
});

// The Table S5 alternatives, in the paper's row order. label and why are
// our own paraphrase. change is the rule edit. ref is the paper's section.
export const TOGGLES = [
  { key: 'endsSwapped', label: 'Swap the two ends', change: { xAt: 'far', yAt: 'center' },
    why: 'The end rule: a read acts at the end where it is taken.', ref: 'Theorem S7(ii)' },
  { key: 'bothAtQubit', label: 'Both exchanges act at the qubit', change: { xAt: 'far', yAt: 'far' },
    why: 'The end rule.', ref: 'Theorem S7(ii)' },
  { key: 'bothAtQutrit', label: 'Both exchanges act at the qutrit', change: { xAt: 'read', yAt: 'center' },
    why: 'The copies of the shared qutrit are one qudit, so Y moves only the qubits.', ref: 'Theorem S7(ii)' },
  { key: 'xWhereLettersSit', label: 'X acts where the letters sit', change: { xAt: 'letters' },
    why: 'A read is an act at the end where it is taken.', ref: 'Theorem S7(ii)' },
  { key: 'qqMovedByY', label: 'Y moves the qubit-qubit records', change: { yMovesSameQudits: true },
    why: 'After Y those records sit on the same two qubits.', ref: 'Theorem S7(ii)' },
  { key: 'copiesSeparate', label: 'The qutrit copies are separate qudits', change: { copiesOneQudit: false },
    why: 'A shared qudit is one qudit.', ref: 'Theorem S7(ii)' },
  { key: 'noOwnSign', label: 'Survival without the own sign', change: { ownSign: false },
    why: 'The definition of the known gives commutator records the order sign.', ref: 'Theorem S6' },
  { key: 'commutatorsXOnly', label: 'Commutator records survive X only', change: { yMovesCommutators: false },
    why: 'Y moves them from one read qubit to the other.', ref: 'Theorem S6' },
  { key: 'sumsAndDiffs', label: 'Keep the sums and the differences', change: { commutators: 'both' },
    why: 'The sums read +1, not the order sign.', ref: 'Theorem S6' },
  { key: 'noCommutators', label: 'No commutator records', change: { commutators: 'none' },
    why: 'The definition of the known.', ref: 'Corollary S4' },
  { key: 'born', label: 'Born weights k, not the square root', change: { weightPower: 1 },
    why: 'k is four letters, a four-point quantity, not the two-point function.', ref: 'Theorem S7(i)' },
  { key: 'readEnds', label: 'Count read ends, not units of charge', change: { count: 'readEnds' },
    why: 'Not a coupling per unit of the conserved count.', ref: 'Theorem S4' },
  { key: 'perRecord', label: 'Divide by the number of records, not N', change: { normalize: 'records' },
    why: 'A coupling per record, not per unit of the conserved count.', ref: 'Lemma S9' },
  { key: 'noWeights', label: 'No weights', change: { weightPower: 0 },
    why: 'A record that survives an exchange gains the factor sqrt d.', ref: 'Theorem S7(i)' },
  { key: 'smallest', label: 'Smallest readable configuration', change: { center: 2, far: [2, 2], unread: null },
    why: '(2, 2) carries no acting charge and there is no unread link.', ref: 'Lemma S6, Sec. S5(b)' },
];

const TOGGLE_BY_KEY = Object.fromEntries(TOGGLES.map(t => [t.key, t]));

// opts: { [toggleKey]: true, ...rule overrides }. Returns a full rule set.
export function rulesFor(opts = {}) {
  const r = { ...DEFAULT_RULES, far: DEFAULT_RULES.far.slice() };
  for (const [k, v] of Object.entries(opts)) {
    if (TOGGLE_BY_KEY[k]) { if (v) Object.assign(r, TOGGLE_BY_KEY[k].change); }
    else if (k in DEFAULT_RULES) r[k] = v;
  }
  return r;
}

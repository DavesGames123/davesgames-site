// ============================================================================
//  ALPHA QUDITS  ·  model/value.js  ·  the readout and its Table S5 dials (MODEL)
// ----------------------------------------------------------------------------
//  value(opts) builds the records under the rule set of opts (rules.js),
//  sums the weights record by record into a + b sqrt2 + c sqrt3 + d sqrt6,
//  and divides by the readout dimension N (configs.js) or, under the
//  perRecord dial, by the number of records. No count is typed in.
//
//  The one dial that the model cannot recompute is readEnds: the paper
//  gives the read-end count of each record only in summary (two at 168
//  records, one at the commutators, none at one record) and names no rule
//  for the one record. value({ readEnds: true }) returns the printed row
//  from paper.js with fromPaper: true, and also our partial count.
//
//  grep -n targets:  export function value | function weighNumerator |
//  export function valueTable | export function compareWithPaper
// ============================================================================
import { buildRecords } from './records.js';
import { rulesFor, TOGGLES } from './rules.js';
import { readoutDimension } from './configs.js';
import { sqrtSplit, reduceFraction, fieldFloat, fieldDigits, inverseDigits, fieldTex } from './exact.js';
import { TABLE_S5 } from './paper.js';

function weighNumerator(records, rules) {
  const num = { a: 0, b: 0, c: 0, d: 0 };
  const slot = { 1: 'a', 2: 'b', 3: 'c', 6: 'd' };
  for (const r of records) {
    const mult = rules.count === 'readEnds' ? readEnds(r) : 1;
    if (rules.weightPower === 0) { num.a += mult; continue; }
    if (rules.weightPower === 1) { num.a += mult * r.k; continue; }
    const { s, f } = sqrtSplit(r.k);
    if (!slot[f]) throw new Error('weight sqrt(' + r.k + ') is outside Q(sqrt2, sqrt3)');
    num[slot[f]] += mult * s;
  }
  return num;
}

// Our partial read-end count: two letters placed by reads at a product,
// one letter per qubit slot at a commutator record. The paper also puts
// one record at zero and does not say which, so this is not its row.
function readEnds(r) { return r.kind === 'commutator' ? 1 : 2; }

function pack(num, D, extra = {}) {
  const coords = ['a', 'b', 'c', 'd'].map(k => reduceFraction(num[k], D));
  const float = fieldFloat(num, D);
  return {
    numerator: { ...num }, denominator: D, coords, float, inverse: 1 / float,
    tex: fieldTex(num, D),
    digits: (n = 30) => fieldDigits(num, D, n),
    inverseDigits: (n = 30) => inverseDigits(num, D, n),
    fromPaper: false,
    ...extra,
  };
}

// opts: toggles of Table S5 (rules.js TOGGLES keys) and/or rule fields.
export function value(opts = {}) {
  const rules = rulesFor(opts);
  const records = buildRecords(rules);
  const N = readoutDimension({ center: rules.center, far: rules.far, unread: rules.unread });
  const D = rules.normalize === 'records' ? records.length : N;
  const num = weighNumerator(records, rules);
  const extra = { records: records.length, N, rules };
  if (rules.count === 'readEnds') {
    const p = TABLE_S5.find(r => r.key === 'readEnds');
    const ours = pack(num, D);
    return pack(p.numerator, p.denominator, {
      ...extra, fromPaper: true,
      note: 'The paper gives the read-end count only in summary; one record at zero is not named. ' +
        'Shown: the printed row. Our partial count (2 per product, 1 per commutator) is in `ours`.',
      ours: { numerator: ours.numerator, denominator: D, float: ours.float, inverse: ours.inverse },
    });
  }
  return pack(num, D, extra);
}

// Every Table S5 row: our recomputation next to the printed value.
export function valueTable() {
  return [{ key: 'computed', label: 'Computed (the paper’s reading)', ref: 'Theorem 2' }, ...TOGGLES].map(t => {
    const v = t.key === 'computed' ? value() : value({ [t.key]: true });
    const p = TABLE_S5.find(r => r.key === t.key) || null;
    return { ...t, value: v, paper: p, agrees: p ? compareWithPaper(v, p) : null };
  });
}

// Same element of the field (after reduction) and same printed inverse.
export function compareWithPaper(v, p) {
  const q = (n, D) => ['a', 'b', 'c', 'd'].map(k => reduceFraction(n[k], D).text).join(',');
  const same = q(v.numerator, v.denominator) === q(p.numerator, p.denominator);
  const inv = (1 / fieldFloat(p.numerator, p.denominator)).toFixed(3);
  return same && inv === p.inverse;
}

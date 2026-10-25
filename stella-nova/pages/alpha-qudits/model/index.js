// ============================================================================
//  ALPHA QUDITS  ·  model/index.js  ·  the exact engine of the page (MODEL)
// ----------------------------------------------------------------------------
//  DOM-free. Every count of the paper is rebuilt here from its stated
//  construction (Wissner-Gross 2026, Secs. S1-S10), in JavaScript, with no
//  published count as an input. The paper's Lean file and scripts were not
//  available, so nothing here claims that they ran. Printed values sit in
//  paper.js for comparison only; tests.mjs checks each one.
//
//  Import:  import * as M from '../model/index.js'  (from a package folder)
//
//  MATRICES AND READS                                   letters.js, complex.js
//    pauli(), gellMann()        complex matrices { n, re: Float64Array[] rows,
//                               im: Float64Array[] rows }
//    letters(d), letterInfo(d, i)   letters of an end; drawing data
//                               { name, tex, kind: 'sym'|'anti'|'diag', at|diag }
//    clockShift(d), weylPhase(d), anticommutingReads(d)
//    mubs(d)                    d + 1 mutually unbiased bases (d = 2, 3)
//    mubTracelessRank(d)        traceless parts of the read projectors, rank d^2 - 1
//    commutatorLetter(d, mu, nu)
//
//  RECORDS                                              records.js, rules.js
//    slots(opts)                [{ id: 'Q1', role, read, d: 3, letters: 8 }, ...]
//    buildRecords(opts)         records { id, kind: 'product'|'commutator',
//                               slots: [a, b], letters: [i, j], combo:
//                               'self'|'even'|'odd'|'diff' ('sum' under a dial,
//                               'single' at unequal far ends), partner (id),
//                               image, X: +-1, Y: +-1, k, weight, sector:
//                               '++'|'+-'|'-+'|'--', edge, sameEnd, role,
//                               terms: [{ slots, letters, coef: {re, im} }],
//                               result (commutator letter), fx, fy, inX, inY }
//    sectors(records)           { '++': n, '+-': n, '-+': n, '--': n }
//    sectorTable(records), exchangeTraces(records), edgeTable(records)
//    DEFAULT_RULES, TOGGLES, rulesFor(opts), OBJECT_CONFIG
//
//  VALUE                                                value.js, exact.js
//    value(opts)                { coords: [{num, den, text}] on (1, r2, r3, r6),
//                               numerator: {a, b, c, d}, denominator, float,
//                               inverse, tex, digits(n), inverseDigits(n),
//                               fromPaper, records, N, rules }
//                               opts: Table S5 toggle keys (TOGGLES), e.g.
//                               { born: true }; digits are exact (BigInt
//                               integer square roots, both bounds agree).
//    valueTable()               every Table S5 row: ours, printed, agrees
//    fieldDigits, inverseDigits, fieldTex, isqrt
//
//  CONFIGURATIONS, READ CAP, CHARGE                     configs.js
//    readoutDimension(config), enumerateConfigs({ linksAtBound })
//                               configs { center, arms: [{far, read}], label,
//                               links, reads, unread, N, Nfactors, admitted,
//                               readable, records: [{far, pairs, records}],
//                               filters: { endRule, twoPoint, charge },
//                               isObject, rankByN }
//    readCap(d1, d2), readableTypes(maxD), centralCharge(d1, d2) -> {re, im},
//    chargeQ(d1, d2)
//
//  ALGEBRA                                              algebra.js, linalg.js
//    identificationBasis()      e1 .. e12 (Sec. S10), 5 x 5 Gaussian integers
//    actionMatrix(), stabilizer()  { rank, nullity, basis, paperInNull,
//                               paperSpans, centre: [{coeffs, diagIm}] }
//    unbrokenU(), hypercharge(), matchingGroup(d), pairKetStabilizerCount(),
//    orbitOfPairKet(), commutantDimension(d)
//
//  STATES                                               states.js
//    pairKet(d1, d2), transposeIdentity(A, d), swapping(d), readFarStates(),
//    jointState(), strandAmplitude(dims)
//
//  DATA                                                 data.js, paper.js
//    MEASUREMENTS, sigma(x[, id]), HISTORY, wylerInverse(), PAPER,
//    TABLE_S2, TABLE_S5
//
//  LOOK-ELSEWHERE                     look-elsewhere.js, le-worker.js, le-client.js
//    lookElsewhere({ coeffMax, denominators, window }) (sync, for tests)
//    lookElsewhereSteps(params)  generator, one step per value of a
//    startLookElsewhere(params, { onProgress }) -> { id, promise, cancel }
//                               runs in the module worker le-worker.js
//    smoothDenominators(max)
//
//  Disagreements with the paper are listed in ../NOTES.md (MODEL lines).
//  Tests: node stella-nova/pages/alpha-qudits/model/tests.mjs
//
//  grep -n targets: export * from
// ============================================================================
export * from './letters.js';
export * from './records.js';
export * from './rules.js';
export * from './value.js';
export { isqrt, fieldDigits, inverseDigits, fieldTex, fieldFloat, sqrtSplit } from './exact.js';
export * from './configs.js';
export * from './algebra.js';
export * from './states.js';
export * from './data.js';
export * from './paper.js';
export { lookElsewhere, lookElsewhereSteps, smoothDenominators } from './look-elsewhere.js';
export { startLookElsewhere } from './le-client.js';

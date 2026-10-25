// ============================================================================
//  ALPHA FROM ENTANGLED QUDITS  ·  story/weigh.js  (CORE, DOM-free)
// ----------------------------------------------------------------------------
//  Chapter 9 (the comparison and the conjecture) and chapter 10 (how to
//  weigh a closed form). Shape: story/index.js. Sources: Letter pp. 5-7,
//  Fig. 3; Supplement S8, S9, S11, Tables S4, S5, S6; the history refs
//  [5-8] of the paper and Eddington (see story/sources.js).
//  Sigma offsets are (candidate - measured) / u, in 1/alpha, as in Fig. 3.
// ============================================================================

import { WEBS_POINTER } from '../webs/story.js';

// The four determinations of 1/alpha(0) that the paper compares with
// (its Fig. 3), as decimal strings so that no digit is lost. u is the
// one-sigma uncertainty in the last digits shown in brackets. main.js
// computes the offsets; tests.mjs checks them against CONTRACT.md and,
// when model/ is present, against MODEL.MEASUREMENTS.
export const MEASURED = [
  { id: 'codata22', label: 'CODATA 2022', what: 'adjustment of all inputs', inv: '137.035999177', u: '0.000000021', src: 'codata22' },
  { id: 'fan23', label: 'Electron g − 2 (2023)', what: 'electron magnetic moment with the Standard Model prediction', inv: '137.035999166', u: '0.000000015', src: 'fan23' },
  { id: 'morel20', label: 'Rb recoil (2020)', what: 'atom interferometry, rubidium', inv: '137.035999206', u: '0.000000011', src: 'morel20' },
  { id: 'parker18', label: 'Cs recoil (2018)', what: 'atom interferometry, cesium', inv: '137.035999046', u: '0.000000027', src: 'parker18' },
];

export const WEIGH = [
  {
    id: 'c9', num: 9, short: 'Comparison', title: 'The comparison and the conjecture',
    blocks: [
      { p: `Read off the model, the two-point function factorizes the way it does in field theory. The bare coupling is 1: a read's projection onto a pair succeeds with certainty, which the paper writes as ½ + ½ at the two matched directions of the qubit pair. Conservation of the charge gives <i>Z</i><sub>2</sub>/<i>Z</i><sub>1</sub> = 1. What is left is <i>Z</i><sub>3</sub>, the normalized readout of chapter 8.` },
      { eq: 'factorize' },
      { p: `The supplement sets out the correspondence row by row (Table S4). The photon two-point function, two field insertions on the vacuum, corresponds to two reads of the link on a third, unread link that carries the state. Dressed over bare at the pole corresponds to the dressed insertion over the identity of <i>R</i>. The Ward identity corresponds to the conservation of <i>Q</i>. And zero momentum transfer with its massless pole has no counterpart inside the model: it enters only with the conjecture.` },
      { fig: 'f9' },
      { analogy: {
        name: 'A correspondence of roles',
        right: `Each piece of the on-shell recipe has a piece of the model that plays the same part in the ratio: insertions, state, bare unit, dressing, conservation. Lighting them up in pairs shows what the model is meant to compute and why it is a ratio of a dressed count to a bare one.`,
        breaks: `In the paper's own words, no record is a Feynman diagram. The model has no charged loop, no vertex factor, no loop momentum and no expansion in a coupling, and it builds no propagator. The correspondence names what Theorem 2 computes; it is used in no proof.`,
      } },
      { quote: `The qutrit–qubit link of Theorem 1 is the elementary link of the photon, and its dressed-over-bare readout α<sub>cand</sub>, Eq. (6), is the electromagnetic coupling at zero momentum transfer, α(0).`, cite: 'Conjecture 1 (Photon) of the paper' },
      { p: `Under Conjecture 1 the number can be compared with experiment, and the paper does so (its Fig. 3; our drawing above). Taking each measurement with its one-standard-deviation uncertainty:` },
      { table: 'measurements' },
      { eq: 'sigma', note: 'A positive offset means the candidate’s 1/α is larger than the measured one.' },
      { p: `The candidate lies between the two most precise determinations, the electron's magnetic moment and rubidium recoil, and 0.6σ from the CODATA 2022 adjustment that combines such inputs. It is 5.3σ from cesium recoil, but cesium and rubidium disagree with each other by more than 5σ, a tension that experiment has not resolved.` },
      { eq: 'digits' },
      { p: `The closed form has no uncertainty of its own, so every new digit that measurements reach is a sharper test. If the rubidium–cesium tension is settled, or the electron moment and its Standard Model theory improve by a factor of a few, the candidate will either keep agreeing or it will not. That is the kind of prediction the paper offers.` },
      { aside: `The comparison is the test of Conjecture 1, not its proof. The paper's charge is the hypercharge direction (chapter 5); how it becomes electric charge, and where spacetime and the photon's helicity come from, lie outside the paper.` },
    ],
    figures: {
      f9: { pkg: 'compare', title: 'Measurements and roles', tag: 'paper', scenes: [
        { id: 'ruler', label: 'Ruler', cap: 'Our drawing of the comparison: 1/α<sub>cand</sub> (line) against the four determinations with one-sigma bars. Zoom to see where the bars and the line part.' },
        { id: 'roles', label: 'Correspondence', cap: 'On-shell QED beside the model, role by role. Tap a role to light up its partner. No record is a Feynman diagram.' },
      ] },
    },
  },
  {
    id: 'c10', num: 10, short: 'Weighing it', title: 'How to weigh a closed form',
    blocks: [
      { p: `Numbers close to 1/137 have a long and mostly unhappy history, and a fair reader will ask how this one differs. Here is that history, what the paper does about it, and two tools to test it for yourself.` },
      { list: [
        `<b>Eddington.</b> In 1929 Arthur Eddington argued from a counting argument that 1/<i>α</i> should be exactly 136; when measurements came out nearer 137 he revised the argument to give 137. Measurements then moved on to 137.036, and the argument did not.`,
        `<b>Wyler.</b> In 1969 and 1971 Armand Wyler obtained <i>α</i> from ratios of volumes of symmetric domains, a formula that agreed with the measurements of the day within their uncertainty. Robertson (1971) and Gilmore (1972) objected that nothing in the construction fixed the normalization of those volumes: change the domain or its scale, and the number changes with it. The paper cites both objections and frames its own aim against them: a derivation must exhibit its one input and leave nothing to fix.`,
      ] },
      { eq: 'wyler', note: 'Wyler\'s formula. Its inverse, 137.036 08, differs from CODATA 2022 by about 8 × 10<sup>−5</sup>, close to 4000 times its uncertainty.' },
      { p: `<b>What the paper does in its favour.</b> It lists every input beyond the axiom and where it enters (Table S1). It lists every alternative clause it knows that would change the number, with the value each gives and the definition that excludes it, without appeal to the measured <i>α</i> (Table S5). And it publishes a single Lean 4 file that, it reports, builds the 172 records from the slots and checks the value as a theorem, with the read cap as a named hypothesis and the conjecture absent. We have not seen or run that file or its scripts; our own model recomputes the counts independently in JavaScript.` },
      { p: `<b>What a careful reader will still ask.</b> Several clauses decide the weights: that a read is an act at the end where it is taken, that the copies of a shared qudit are one qudit, that the known holds under every exchange, that weights enter as √<i>k</i> and that the denominator is the whole of <i>R</i>. The paper argues each from its definitions. The dials below flip them one at a time. Every flip moves 1/<i>α</i> by far more than the measurement error: some by a few percent (139.03, 146.52), some by much more (97.5, 112.4, 180.8). Two land within one percent (135.894 with the ends swapped, 138.348 with the commutator records surviving X only). Whether each clause is forced or chosen is the question to weigh, and this page cannot settle it.` },
      { fig: 'f10a' },
      { analogy: {
        name: 'Dials',
        right: `Each clause of the definitions is a switch, and the number is the reading on the dial. Flipping one switch shows how far each clause moves the result, which is the honest way to see which clauses are load-bearing.`,
        breaks: `A dial suggests the switches are free settings. In the paper each one is fixed by a definition, and the excluded settings are excluded by an argument, not by tuning. The dial shows sensitivity; it does not show whether the argument for each setting is sound.`,
      } },
      { p: `<b>The look-elsewhere question.</b> The candidate has the shape (<i>a</i> + <i>b</i>√2 + <i>c</i>√3 + <i>d</i>√6)/<i>D</i> with small whole numbers. How many numbers of that shape land within the measured window by chance? The lab below counts them in a background worker, for the ranges you choose, and compares the count with the number expected from their density alone. With coefficients up to 100 and a window of one CODATA standard deviation, our model finds this: among denominators of the form 2<sup><i>i</i></sup>3<sup><i>j</i></sup> up to 40 000 (the shape the paper\'s <i>N</i> has), one number lands, the candidate itself, where density alone predicts 0.18. Among all denominators up to 40 000, 299 distinct values land, against about 353 from density alone.` },
      { eq: 'family' },
      { p: `Read these counts with care. They differ by a factor of hundreds because restricting the denominators is itself a choice. A large count says that a formula of this shape could hit the window by luck, if its integers were free. They are not free in the paper: the derivation fixes 79, 48, 42, 3 and 31104 by its rules, and the dials above show what happens when a rule moves. The fair question is how many rules there were to choose, and how many of the choices the paper's definitions really force. Both the look-elsewhere count and the list of clauses belong in that judgement.` },
      { fig: 'f10b' },
      { aside: WEBS_POINTER },
    ],
    figures: {
      f10a: { pkg: 'compare', title: 'Flip a clause', tag: 'paper', scenes: [
        { id: 'dials', label: 'Dials', cap: 'Every alternative of Table S5 as a switch. Our model recomputes the value from the records under the changed rule; a row it cannot recompute is marked as taken from the paper.' },
        { id: 'history', label: 'History', cap: 'Eddington, Wyler and the rejoinders, with citations, against the measured value over time.' },
      ] },
      f10b: { pkg: 'compare', title: 'Look-elsewhere lab', tag: 'model', scenes: [
        { id: 'lookElsewhere', label: 'Count near-misses', cap: 'How many numbers (a + b√2 + c√3 + d√6)/D with small a..d land inside the window around CODATA 2022, against the count expected from density. Runs in a worker in time slices; you can stop it.' },
      ] },
    },
  },
];

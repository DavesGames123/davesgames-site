// ============================================================================
//  ALPHA FROM ENTANGLED QUDITS  ·  story/count.js  (CORE, DOM-free)
// ----------------------------------------------------------------------------
//  Chapters 6 to 8: the object (Theorem 1), the count of records, survival
//  and weights (Theorem 2). Shape: story/index.js. Sources in the paper:
//  Letter pp. 3-5 and Table I; Supplement S5-S7, Tables S2 and S3.
//  The numbers in this text restate the paper. Our model/ recomputes them
//  from the slot construction, and main.js shows its counts next to them.
// ============================================================================

export const COUNT = [
  {
    id: 'c6', num: 6, short: 'The object', title: 'The object: a shared qutrit, three links, two read',
    blocks: [
      { p: `Chapter 1 asked for a two-point function: two insertions on one state. The paper translates this into its own terms. The two insertions are two reads of a link. The state is the link itself, present as a third link of the same type at the same shared qudit, and left unread, because reading it would make a third insertion.` },
      { p: `The <b>end rule</b> says where a qutrit–qubit link is read. A read at the qutrit end fixes the qubit's state at every basis vector. A read at the qubit end reaches the qutrit only on the two shared levels and misses the third, the level the unbroken generator <i>U</i> leaves at zero. A read must reach its far end whole, so a (2, 3) link is read at its qutrit end.` },
      { quote: `Among the configurations at a shared qudit whose read links are readable, exactly one is a two-point function, is read at the qutrit end, and carries an acting central charge on every link.`, cite: 'Theorem 1 (Uniqueness), Wissner-Gross 2026' },
      { p: `That one is a shared qutrit with three links to qubits, two of them read. The paper calls it <b>the object</b>. To show it is unique, the supplement lists every configuration a shared qudit can have under its bounds: 76 of them, 42 admitted by the read cap, 23 readable. Then three filters cut the 23 down to one.` },
      { table: 'configs' },
      { p: `Smallness does not pick the object. The configuration with the least readout dimension, 256, is a shared qubit with two (2, 2) reads, and it gives (30 + 30√2)/256, an inverse of about 3.5. It fails only because (2, 2) carries no acting charge. The object stands thirteenth of 23 by readout dimension, tied with a shared qubit that reads two (2, 3) links, which the end rule excludes.` },
      { p: `In the object the shared qutrit is carried as three copies: <i>Q</i><sub>1</sub> and <i>Q</i><sub>2</sub> at the two read links and <i>Q</i><sub>3</sub> at the unread link to a qubit <i>f</i>. The two reads compose at the qutrit as a join, the qutrit pair |<i>ω</i><sub>3</sub>⟩ between the read copies.` },
      { eq: 'jointState' },
      { eq: 'path', note: 'A path from <i>q</i><sub>1</sub> to <i>q</i><sub>2</sub> crosses one thread of each read link and one of the join. The factor √6 normalizes the projected state; in a laboratory the join would succeed with probability 1/6. The result has 3 · 2 · 2 = 12 terms of amplitude 1/(2√3).' },
      { fig: 'f6' },
    ],
    figures: {
      f6: { pkg: 'strands', title: 'The object in threads', tag: 'paper', scenes: [
        { id: 'object', label: 'The object', cap: 'Our drawing of the object: the shared qutrit as three copies, two read links (two threads each), the join of the read copies (three threads), and the unread link to <i>f</i> that carries the state. Twelve terms, each of amplitude 1/(2√3).' },
      ] },
    },
  },
  {
    id: 'c7', num: 7, short: 'Counting', title: 'Counting: 31104 directions and 172 records',
    blocks: [
      { p: `Theorem 2 of the paper is a count in three steps: how big the space of readouts is, which directions in it the reads fix, and what weight each fixed direction carries. This chapter does the first two.` },
      { p: `<b>The readout dimension.</b> The readout is a normalized trace over the operators the reads can reach, the readout algebra <i>R</i>. At each read link the reads reach every operator of the link, a 6 × 6 matrix space of dimension 36. At the unread link no read sees the scalar part of either end, which leaves the traceless parts, 8 × 3 = 24. The product is <i>N</i>.` },
      { eq: 'readoutDim' },
      { p: `<b>Letters and slots.</b> Each read can place a traceless observable, a letter, at either end of its link: at its own end directly, at the far end through the transpose identity. Each end of a read link is therefore a <b>slot</b>. The two read links give four slots, the qutrit copies <i>Q</i><sub>1</sub>, <i>Q</i><sub>2</sub> with 8 letters each and the read qubits <i>q</i><sub>1</sub>, <i>q</i><sub>2</sub> with 3 each.` },
      { p: `<b>Records.</b> A measurement record carries the two insertions as two letters. Two letters at the same slot would multiply into a single observable (a single insertion), so the letters sit at two different slots. The six pairs of slots give the product records:` },
      { eq: 'products' },
      { p: `Then the rule of chapter 3 adds three more. At each read qubit, two reads in different bases anticommute, so their commutator is fixed with the order as its sign. There is one commutator for each of the three pairs of Pauli letters. The exchange of the two reads carries the commutator at <i>q</i><sub>1</sub> to the same one at <i>q</i><sub>2</sub>, and only their difference carries the order sign −1. At the qutrit nothing anticommutes, so nothing is added there.` },
      { eq: 'records' },
      { eq: 'readout', note: 'Eq. (2) of the paper. The bare insertion is the identity on <i>R</i>, so its readout is 1, and ⟨<i>M</i>⟩ is itself the dressed-over-bare ratio.' },
      { fig: 'f7' },
    ],
    figures: {
      f7: { pkg: 'records', title: 'The square of slots', tag: 'paper', scenes: [
        { id: 'square', label: 'Square', cap: 'The four slots as the corners of a square. An edge is a pair of slots, not a link: it carries one product for each letter at one end times each at the other. The arc joins the qubits and carries the three commutator records.' },
        { id: 'grid', label: 'All records', cap: 'Every record as a small glyph of our own, built by our model from the slots and sorted by sector. Tap one to see its two letters, its slots and its weight.' },
      ] },
    },
  },
  {
    id: 'c8', num: 8, short: 'Weights', title: 'Survival and weights: from 172 records to one number',
    blocks: [
      { p: `Two exchanges sort the records. Each is a swap that, done twice, is no swap, so every record is either symmetric (+) or antisymmetric (−) under it.` },
      { list: [
        `<b>X, the exchange of reads,</b> acts on records whose two letters are of one kind: both at the qutrit copies or both at the read qubits. These are the 73 same-end products and the 3 commutator records.`,
        `<b>Y, the exchange of links,</b> swaps the two read links. The shared qutrit stays where it is, because its copies are one qudit, and the two read qubits trade places. It acts on the 96 mixed products, with one letter at a copy and one at a qubit, and on the 3 commutator records.`,
      ] },
      { p: `A record <b>survives</b> an exchange when the exchange returns it times its own sign: +1 for a product, −1 for a commutator record. That is the definition of the known at work. A symmetric product survives; an antisymmetric one does not; a commutator record survives both. The exchange fixes 11 products outright (the same letter at the two copies, or at the two qubits) and pairs the other 158 into 79 symmetric and 79 antisymmetric combinations.` },
      { eq: 'exchanges', note: 'Eq. (S3). <i>p<sub>r</sub></i> = ±1 is the parity of a product under the exchange of the two reads. A record that survives reads −1.' },
      { analogy: {
        name: 'Mirrors and drum modes',
        right: `A drum or a Chladni plate with a mirror symmetry has modes of two kinds, even and odd under the mirror. Any pattern and its mirror image combine into one of each. The records do exactly that: a record and its mirror image under an exchange give one even and one odd combination, and the sector sizes are counts of even and odd modes.`,
        breaks: `A drum's modes have frequencies; records have none. On a drum both parities ring; here which parity "survives" is a definition (the known), and the weights √2 and √3 come from the paper's rule about <em>where</em> an exchange acts, which no drum supplies.`,
      } },
      { p: `<b>The weight law.</b> A record that survives an exchange is carried over every matched direction of the pair at the end where that exchange acts. That is <i>d</i> threads of amplitude 1/√<i>d</i>, which sum to √<i>d</i>. The exchange of reads acts where reads are taken, at the qutrit (the end rule), even for records whose letters sit at the qubits: it runs over the join's three threads and gives √3. The exchange of links moves only the read qubits and runs over a read link's two threads: √2. A record that survives both carries √6.` },
      { eq: 'strandSum' },
      { eq: 'weight', note: 'Eq. (5). The squared weight <i>k<sub>r</sub></i>; the record enters with √<i>k<sub>r</sub></i>.' },
      { p: `Why √<i>k</i> and not <i>k</i>? A record carries the two insertions as two letters, an amplitude. Its square would be the record composed with its adjoint, four letters, a four-point quantity rather than a two-point one. The paper lists this choice among its steps (Table S1), and chapter 10 lets you flip it.` },
      { eq: 'sectors', note: 'The four sectors of Table I (Lemma S10), with <i>a</i> = 8 qutrit letters and <i>b</i> = 3 qubit letters.' },
      { list: [
        `(+, +), weight 1: the 79 antisymmetric combinations.`,
        `(+, −), weight √2: the 48 symmetric mixed combinations, one letter at each end.`,
        `(−, +), weight √3: the 42 symmetric same-end combinations.`,
        `(−, −), weight √6: the 3 commutator records.`,
      ] },
      { table: 'sectors' },
      { p: `Divide the weighted sum by the readout dimension and you have Theorem 2. The numerator 79 + 48√2 + 42√3 + 3√6 is the sum of the weights; the denominator is the bare insertion, every direction of <i>R</i> counted once. The sum is finite and exact: no expansion in a coupling, no integral to regulate.` },
      { eq: 'value' },
      { eq: 'coords' },
      { fig: 'f8' },
    ],
    figures: {
      f8: { pkg: 'records', title: 'Mirrors, modes and the abacus', tag: 'analogy', scenes: [
        { id: 'mirror', label: 'Mirrors', cap: 'X and Y as mirror flips of the square of slots. Pick a record: it and its image split into an even and an odd combination.' },
        { id: 'modes', label: 'Drum modes', cap: 'The same split on a drum: a pattern plus its mirror image is an even mode, the difference an odd one.' },
        { id: 'abacus', label: 'Abacus', cap: 'The count, record by record: each bead adds 1, √2, √3 or √6 to the sum, divided by <i>N</i>, and the digits of 1/α<sub>cand</sub> settle one by one.' },
      ] },
    },
  },
];

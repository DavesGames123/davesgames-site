// ============================================================================
//  ALPHA FROM ENTANGLED QUDITS  ·  story/model.js  (CORE, DOM-free)
// ----------------------------------------------------------------------------
//  Chapters 2 to 5: the axiom and its five definitions, reads and the
//  transpose identity, the read cap, the charge. Shape: story/index.js.
//  Sources in the paper: Letter pp. 1-3, Supplement S1-S4, S10.
// ============================================================================

export const MODEL = [
  {
    id: 'c2', num: 2, short: 'The axiom', title: 'The axiom and its five definitions',
    blocks: [
      { p: `The paper has one input, which it calls an axiom. In its own words:` },
      { quote: `Nothing exists but finitely many maximally entangled pairs of qudits, some qudits shared, known only by distilling them.`, cite: 'Wissner-Gross 2026, the axiom of the Letter' },
      { p: `Five words in that sentence carry the model, and the paper spells each one out. The rest of the derivation uses only these definitions and what follows from them.` },
      { list: [
        `<b>Qudit.</b> A quantum system with a finite number <i>d</i> ≥ 2 of levels. A qubit has <i>d</i> = 2, a qutrit <i>d</i> = 3. One level is not allowed, because a one-level system cannot be entangled with anything.`,
        `<b>Pair (or link) of type (<i>d</i><sub>1</sub>, <i>d</i><sub>2</sub>).</b> Two qudits in the maximally entangled state on the levels they have in common, <i>m</i> = min(<i>d</i><sub>1</sub>, <i>d</i><sub>2</sub>) of them. A qutrit paired with a qubit shares two levels; the qutrit's third level takes no part in the pair.`,
        `<b>Shared.</b> A qudit at the end of two or more pairs. Because a maximally entangled pair has no correlation with any third system, the model carries a shared qudit as one copy per pair (as in a projected entangled pair state), so monogamy of entanglement is never broken. The copies are still one qudit: swapping two of its pairs leaves it where it is and moves only what sits at the far ends.`,
        `<b>Distilling.</b> To distill two qudits is to project them onto the pair state, <i>P<sub>m</sub></i> = |<i>ω<sub>m</sub></i>⟩⟨<i>ω<sub>m</sub></i>|. It is the projection at the heart of entanglement swapping (below). In a laboratory it is one lucky outcome of a Bell measurement, with probability 1/<i>d</i><sup>2</sup>. In the model the other outcomes are not configurations of the axiom at all, so the projection always happens: a postselection promoted to a law.`,
        `<b>Read and known.</b> A read distills a pair in a basis of one end and hands that basis to the far end; what is known of a qudit is what its reads fix together. These two carry the most weight and get chapter 3.`,
      ] },
      { eq: 'pairKet', note: 'The pair state. Each of the <i>m</i> terms has amplitude 1/√<i>m</i>.' },
      { eq: 'distill', note: 'Distilling: the projection onto the pair state. Its output is the pair of the two qudits\' type.' },
      { fig: 'f2' },
      { eq: 'swap', note: 'Entanglement swapping (Eq. S1 of the paper). Project the middle two qudits of two pairs onto a pair, and the outer two end up paired. Each term of the result is a product of three amplitudes, <i>d</i><sup>−3/2</sup>, and <i>d</i> such terms give 1/<i>d</i>.' },
      { analogy: {
        name: 'Threads',
        right: `A pair of dimension <i>d</i> is <i>d</i> threads, one per term of the pair state, each with amplitude 1/√<i>d</i>. A qutrit and a qubit share two threads and the qutrit's third level meets none. Following a thread through several pairs multiplies amplitudes, and tying two pairs together in the middle is entanglement swapping. The paper itself draws its count this way (Fig. S1), and so do tensor-network diagrams.`,
        breaks: `Threads are drawn in one basis, but a real pair looks the same in every basis (chapter 3), and nothing in a bundle of string says so. A thread carries an amplitude, which can be negative or complex and can cancel, not a probability or a rope's tension. And the copies of a shared qudit drawn as separate knots are, in the model, one qudit.`,
      } },
      { aside: `Load-bearing step: the model keeps the projection of distillation and drops its failure branch. The paper lists this in its table of inputs (Table S1), notes that postselection has been proposed as a law before (for black-hole final states and for closed timelike curves) and that there are known objections, and says it does not settle whether such a law is consistent with the rest of physics.` },
    ],
    figures: {
      f2: { pkg: 'strands', title: 'Pairs as threads', tag: 'analogy', scenes: [
        { id: 'pair', label: 'A pair', cap: 'A pair of dimension <i>d</i> as <i>d</i> threads of amplitude 1/√<i>d</i>. With unequal ends, only the common levels are joined.' },
        { id: 'swap', label: 'Swapping', cap: 'Two pairs, 1–2 and 3–4. Projecting 2 and 3 onto a pair re-ties the threads: 1 and 4 end up paired, with amplitude 1/<i>d</i>. Entanglement moves; none is added.' },
        { id: 'shared', label: 'Shared qudit', cap: 'One qudit at the end of several pairs, drawn as one copy per pair. Each copy is maximally entangled with its own partner, so no pair is shared three ways.' },
      ] },
    },
  },
  {
    id: 'c3', num: 3, short: 'Reads', title: 'Reads and the transpose identity',
    blocks: [
      { p: `A maximally entangled pair has a curious symmetry. Apply an operator <i>A</i> to one end, and the state changes exactly as if you had applied its transpose <i>A</i><sup>T</sup> to the other end. Because of this, the pair has the same form in every basis of its levels, with the complex-conjugate basis at the far end. Distilling therefore picks out no basis.` },
      { eq: 'transpose' },
      { p: `A change of basis by a unitary <i>U</i> at one end, matched by its conjugate <i>Ū</i> at the other, leaves the pair untouched. The paper calls this a matching. Each pair has its own matching, so nothing lines up the bases of the different copies of a shared qudit.` },
      { eq: 'matching' },
      { fig: 'f3a' },
      { analogy: {
        name: 'Mirror gears',
        right: `Two meshed gears: turn one, and the far one turns in mirror. Here a turn <i>U</i> at one end is the same as the mirrored turn at the far end, and turning both ends in matched opposition (<i>U</i> ⊗ <i>Ū</i>) leaves the mesh, the pair, exactly as it was.`,
        breaks: `A gear has one angle; a unitary on a qutrit has eight real parameters and complex phases. The "mirror" is transpose and complex conjugation, not a reflection in space, and nothing physically rotates. The gears also suggest a preferred tooth to start from; the pair has no preferred basis at all.`,
      } },
      { p: `A <b>read</b> is an act at one end of a pair. It distills the pair in a basis of that end and passes the basis along. Each basis vector |<i>e</i>⟩ at the near end leaves the far end in a definite state, the conjugate of the part of |<i>e</i>⟩ that lies in the shared levels. Those far-end states span only the shared levels, so a read is taken at the larger end of a pair (or at either end of an equal one). A qutrit read hands a qubit three states, one of them the zero vector when the basis vector points along the qutrit's unshared level.` },
      { more: { title: 'How many reads an end has, and its letters', blocks: [
        { p: `At an end of prime dimension <i>d</i> there is one read for each of the <i>d</i> + 1 mutually unbiased bases of the clock and shift operators (Wootters and Fields): three at a qubit, four at a qutrit. The traceless parts of their projectors, <i>d</i> − 1 per basis, do not overlap, and together they span every traceless observable of that end. These observables are the paper's <b>letters</b>: the three Pauli matrices at a qubit, the eight Gell-Mann matrices at a qutrit.` },
        { eq: 'letters' },
      ] } },
      { p: `To <b>fix</b> something is to determine it with certainty on the single copy, not to estimate an average over many runs. What is <b>known</b> of a qudit is what its reads fix together, unchanged under every matching and every exchange of its reads or of its pairs. Two reads fix their product. Exchanging them returns the product times the phase by which they fail to commute. An exchange done twice is no exchange, so that phase has to be its own inverse: a sign.` },
      { eq: 'weyl', note: 'At a qubit, reads in different bases anticommute, so the phase is −1. At a qutrit the clock and shift operators commute only up to a cube root of unity.' },
      { eq: 'signOnly', note: 'Why the qutrit gets no sign: taking determinants of <i>AB</i> = <i>λBA</i> in dimension <i>d</i> gives <i>λ</i><sup><i>d</i></sup> = 1, and a sign needs <i>λ</i> = <i>λ</i><sup>−1</sup>. Together they give <i>λ</i><sup>gcd(<i>d</i>, 2)</sup> = 1: the sign <i>λ</i> = −1 is possible only at even <i>d</i>, and at a qutrit only <i>λ</i> = 1, no sign, is left (Corollary S4).' },
      { p: `So two anticommuting reads at a qubit fix one thing more than either alone: their product, with their order as its sign. This small rule later adds three extra records to the count, and with them the √6 term.` },
    ],
    figures: {
      f3a: { pkg: 'ends', title: 'The two ends of a pair', tag: 'analogy', scenes: [
        { id: 'gears', label: 'Mirror gears', cap: 'The transpose identity as two gears: a turn at one end equals the mirrored turn at the far end. Turn both in matched opposition and the pair does not change.' },
        { id: 'bloch', label: 'Qubit end', cap: 'A qubit end on the Bloch sphere with its three mutually unbiased read bases (x, y, z). Reads along different axes anticommute; their commutator is one more letter.' },
        { id: 'qutrit', label: 'Qutrit end', cap: 'A qutrit end: four mutually unbiased bases and the eight Gell-Mann letters. Its reads commute only up to a cube root of unity, so no sign is left over.' },
        { id: 'read', pkg: 'strands', label: 'A read', cap: 'A read passes its basis along the pair. Each basis vector at the near end leaves the far end in a definite state; a basis vector outside the shared levels leaves the zero vector.' },
      ] },
    },
  },
  {
    id: 'c4', num: 4, short: 'Read cap', title: 'Which links can be read: the read cap',
    blocks: [
      { p: `A read meets a pure, maximally entangled pair, so its projection succeeds with certainty on the one copy. No state in the model is "bound" (entangled but undistillable). What a read can still fail to fix is not a state but a <em>relation</em> between the two ends of a type of link.` },
      { p: `A consistent relation between two ends is a positive map: it carries every valid description (positive operator) of one end to a valid description of the other. Reads can only build maps of two kinds, completely positive maps (their projections and matchings) and completely positive maps after a transpose (the transpose identity). Sums of these are called <b>decomposable</b>.` },
      { eq: 'decomposable' },
      { p: `The paper calls a type <b>readable</b> when every positive map between its ends is decomposable, and <b>dark</b> otherwise. By its definition of "fix", a single read fixes the two ends of a pair exactly when the type is readable. Which types are readable is a question about positive maps that mathematicians answered decades ago:` },
      { list: [
        `(2, 2): every positive map is decomposable (Størmer, 1963).`,
        `(2, 3): every positive map is decomposable (Woronowicz, 1976).`,
        `(2, 4): a positive map that is not decomposable exists (Woronowicz, 1976).`,
        `(3, 3): the Choi map is positive and not decomposable (Choi, 1975).`,
        `Every type with <i>d</i><sub>1</sub><i>d</i><sub>2</sub> ≥ 8 contains one of these, and no two whole numbers ≥ 2 multiply to 7.`,
      ] },
      { eq: 'readCap', note: 'The read cap. Of the two readable types, only the qutrit–qubit link (2, 3) has unequal ends.' },
      { fig: 'f4' },
      { analogy: {
        name: 'Locks and keys',
        right: `Each type (<i>d</i><sub>1</sub>, <i>d</i><sub>2</sub>) is a lock; each positive map is a key; reads can cut only decomposable keys. The small locks (2, 2) and (2, 3) open for every key there is. The Choi map is a key no read can cut, and once it exists at (3, 3) or (2, 4) it fits every larger lock by embedding. That is why the boundary is a product, 6, and why 7 cannot sit between.`,
        breaks: `Nothing is locked: the pairs of a dark type are still maximally entangled and distillable. The "key" is a map between operator algebras, not a thing, and "opening" means being decomposable. The step from "some positive map is not decomposable" to "a read does not fix the ends" is the paper's definition of fix, not a theorem of the cited papers.`,
      } },
      { p: `The same cap is familiar from entanglement theory. Through the Choi–Jamiołkowski correspondence, positive maps are entanglement witnesses. The maps that reads cannot build detect entangled states with a positive partial transpose, which no distillation protocol can purify (the Horodeckis). Partial transposition decides entanglement for every state exactly when <i>d</i><sub>1</sub><i>d</i><sub>2</sub> ≤ 6, the same bound.` },
      { p: `The paper also gives a second route to the cap, under one more premise: that the far end of a read must hold the passed basis as its own. A matching has to undo the complex conjugation the transpose identity adds. At a qubit <i>σ<sub>y</sub></i> does that; at a qutrit no unitary can, because the defining representation of SU(3) is not equivalent to its conjugate. So the far end of a read is a qubit, which again leaves (2, 2) and (2, 3), the latter read at its qutrit end.` },
      { aside: `Load-bearing step: the definition of "fix" asks a read to fix every consistent relation between two ends, not only states. The paper says plainly that under a weaker definition, blind to these relations, the read cap would be a premise rather than a consequence.` },
    ],
    figures: {
      f4: { pkg: 'ends', title: 'The read cap as locks and keys', tag: 'analogy', scenes: [
        { id: 'locks', label: 'Locks', cap: 'Types (<i>d</i><sub>1</sub>, <i>d</i><sub>2</sub>) up to 5 × 5. Tap a lock. (2, 2) and (2, 3) open for every key; the Choi map at (3, 3) and Woronowicz\'s map at (2, 4) are keys no read cuts, and they carry over to every product ≥ 8.' },
      ] },
    },
  },
  {
    id: 'c5', num: 5, short: 'The charge', title: 'The charge: su(3) ⊕ su(2) ⊕ u(1)',
    blocks: [
      { p: `The basis changes at the two ends of a link form a Lie algebra, which the paper calls the identification algebra. For a link of type (<i>d</i><sub>1</sub>, <i>d</i><sub>2</sub>) it is su(<i>d</i><sub>1</sub>) ⊕ su(<i>d</i><sub>2</sub>) ⊕ u(1): block-diagonal, traceless, anti-Hermitian matrices on the two ends side by side, ℂ<sup><i>d</i><sub>1</sub></sup> ⊕ ℂ<sup><i>d</i><sub>2</sub></sup>. Its centre, the part that commutes with everything, is one line, spanned by a generator <i>Q</i>.` },
      { eq: 'charge' },
      { p: `On a link of equal ends, <i>Q</i> acts as zero. On the qutrit–qubit link it acts as <i>i</i>. Of the two readable types, only (2, 3) carries an acting central charge. Its algebra is su(3) ⊕ su(2) ⊕ u(1), which exponentiates to S(U(3) × U(2)), and that group is (SU(3) × SU(2) × U(1))/ℤ<sub>6</sub>: the gauge group of the Standard Model, in the global form that sits inside SU(5) (Baez and Huerta).` },
      { eq: 'algebra' },
      { p: `In that embedding <i>Q</i> is six times the hypercharge generator <i>Y</i>, up to the factor <i>i</i>. The six-dimensional space of the link, ℂ<sup>2</sup> ⊗ ℂ<sup>3</sup>, then carries the quantum numbers (<b>3</b>, <b>2</b>) with hypercharge 1/6: those of the left-handed quark doublet.` },
      { eq: 'hyper' },
      { eq: 'doublet' },
      { p: `How can a traceless <i>Q</i> act on the pair as a nonzero number? The trace counts all five directions of the two ends, 2 × 3 + 3 × (−2) = 0. The link pairs one direction of each end, so on the pair <i>Q</i> reads 3 + (−2) = 1, times <i>i</i>. The paper shows the charge is conserved: the only quantity of the open ends that every matching keeps and that ignores global phases is the count of <i>Q</i>, and reads and joins change the open ends only by matched pairs. Because the twirl over matchings leaves <i>Q</i> alone, its dressed and bare insertions agree, the model's version of <i>Z</i><sub>1</sub> = <i>Z</i><sub>2</sub>.` },
      { eq: 'conserved', note: 'An invariant weight is constant on each end, <i>x</i> on the qubit and <i>y</i> on the qutrit. Blindness to global phase gives 2<i>x</i> + 3<i>y</i> = 0, the scalars of <i>Q</i>.' },
      { p: `Inside the group, the transformations that leave the pair state fixed form a four-dimensional subalgebra: a diagonal su(2) that turns the qubit and the qutrit's two shared levels together, plus one more line. Its centre is the unbroken generator <i>U</i>, which leaves the qutrit's third level at zero, exactly the level a qubit-end read cannot reach (chapter 6).` },
      { eq: 'unbroken' },
      { fig: 'f5' },
      { aside: `What this is not: hypercharge is not electric charge. In the Standard Model the photon couples to <i>T</i><sub>3</sub> + <i>Y</i>, after electroweak symmetry breaking. The paper says the passage from its charge to electric charge, with spacetime and helicity, lies beyond the Letter, and that is why its last step is a conjecture.` },
    ],
    figures: {
      f5: { pkg: 'ends', title: 'The identification algebra', tag: 'paper', scenes: [
        { id: 'charge', label: 'Block matrix', cap: 'The 5 × 5 block matrix of the identification algebra at (2, 3): su(2) on the qubit block, su(3) on the qutrit block, and the diagonal charge <i>Q</i> = 6<i>iY</i>. The unbroken generator <i>U</i> leaves the third qutrit level at zero.' },
      ] },
    },
  },
];

// ============================================================================
//  STRANDS · text.js — scene titles, step captions and the analogy notes
// ----------------------------------------------------------------------------
//  Our own words. The paper (A. D. Wissner-Gross, 23 October 2026) is cited
//  by equation and section number; nothing here is copied from it. The
//  stance of CONTRACT.md holds: "the paper derives", "the paper proposes".
//
//  ANALOGY[scene] = { title, right, breaks, source }
//    right    what the thread picture gets right
//    breaks   where the thread picture stops being true
//    source   where in the paper the statement sits
//  STEPS[scene] = [{ id, label, caption }]  the timeline captions
//
//  EXPORTS   (jump with grep -n "<anchor>" text.js)
//    ANALOGY ..... "export const ANALOGY"
//    STEPS ....... "export const STEPS"
//    TEX ......... "export const TEX"      one TeX line per scene (saver plate)
// ============================================================================

export const ANALOGY = {
  pair: {
    title: 'A pair as threads',
    right: 'A maximally entangled pair of dimension d is d threads, one for each term of the pair state. Thread i ties direction i at one end to direction i at the other, and each thread carries amplitude 1/√d. When the ends differ, only the smaller number of directions get a thread: a qutrit and a qubit share two threads, and the qutrit’s third direction meets none.',
    breaks: 'Real threads sit in one place. These do not: the pair state has the same form in every basis of its support (a turn U at one end and its conjugate at the other leave it unchanged), so the same pair can be redrawn with any set of threads. The twist in the middle is decoration. Also, amplitudes add like threads but probabilities do not: d threads of 1/√d sum to √d, while their Born weights 1/d sum to 1.',
    source: 'Eq. (1) of the Letter; Fig. S1(a) and Theorem S1 of the Supplement.',
  },
  swap: {
    title: 'Swapping as re-tying',
    right: 'Distilling qudits 2 and 3 ties their threads together. A thread from 1 that reaches 2 in direction i can only go on through the tie to 3 in the same direction, and then to 4. Each surviving route crosses three pair amplitudes, so it carries d^(-3/2), and the d routes together are (1/d) times a pair between 1 and 4. Qudits 2 and 3 are left as a pair. Entanglement moves; none is added.',
    breaks: 'In a lab the tie is one outcome of a Bell measurement, which comes up with probability 1/d², and the protocol needs the other outcomes and a correction. The paper proposes that its model keeps only this projection, with no other outcome. That is a postselection used as a law, a step the paper lists as an input of its own (Table S1).',
    source: 'Eq. (S1) and "Distillation and postselection", Sec. S1 of the Supplement.',
  },
  read: {
    title: 'A read passes its basis along the threads',
    right: 'A read is taken at one end in a basis of that end. Each basis element travels down the threads, and the far end is left at the conjugate of that element’s part on the shared directions, with no freedom. Read a qutrit-qubit link at the qutrit and every qubit direction is reached. Read it at the qubit and the qutrit’s third direction is never touched.',
    breaks: 'The far-end states need not be an orthonormal basis of the far end. A qutrit element that lies off the shared directions arrives as the zero vector, and the others are shorter than one. A real thread would not turn a phase into its mirror image; here the far end gets the complex conjugate, which the picture shows as a mirrored clock hand.',
    source: 'Corollary S3 (iii) and (iv), and the end rule of Sec. S5(a).',
  },
  shared: {
    title: 'One qudit, one copy per link',
    right: 'A pure maximally entangled pair is uncorrelated with every third system, so a qudit at the end of several links is drawn as one copy per link, each copy maximally entangled with its own partner. No thread is shared between two links, so monogamy holds. An exchange of two links at the shared qudit leaves the qudit where it is and moves only what sits at the far ends.',
    breaks: 'The copies look like separate objects. They are not: in the paper they are one qudit, the one the axiom shares, and they are copies of a qudit, never copies of a link. Of each link there is only one.',
    source: 'Definitions in the Letter; "The shared qudit as copies", Sec. S1; Corollary S5.',
  },
  object: {
    title: 'The object as a knot of three links',
    right: 'The paper’s object is a shared qutrit with three links to qubits: two are read, and the third is left unread to carry the state. Drawn in threads, the qutrit becomes three copies. The two read copies are tied by a qutrit pair of three threads. A route from the first read qubit to the second crosses three threads, 1/√2 · 1/√3 · 1/√2 = 1/(2√3). After the factor √6 that the paper puts on the projection, the joint state has 3 · 2 · 2 = 12 terms of that size, and their squares sum to 1.',
    breaks: 'The paper says itself that the strand picture restates the count and derives nothing further. That the exchange of reads runs over the qutrit join, even for records with both letters at the qubits, is a clause of the definition of a read, not something the threads show. The threads are drawn in one basis; the amplitudes, counts and weights do not depend on that choice.',
    source: 'Theorem 1, Fig. 1(a) and Eq. (4) of the Letter; Eq. (S2), Fig. S1(b) and "The computation in strands", Sec. S7.',
  },
};

export const STEPS = {
  pair: [
    { id: 'rope', label: 'Threads', caption: 'Each thread is one term of the pair state. Tap or drag across the rope to pluck it.' },
  ],
  swap: [
    { id: 'two', label: 'Two pairs', caption: 'Two pairs: 1 with 2, and 3 with 4.' },
    { id: 'tie', label: 'Distill 2 and 3', caption: 'Distill 2 and 3: project them onto their pair state. Only threads of the same direction pass the tie.' },
    { id: 'route', label: 'Re-tie', caption: 'Each route 1 → 2 → 3 → 4 crosses three pair amplitudes: (1/√d)³.' },
    { id: 'done', label: 'Result', caption: 'Now 1 is paired with 4, at (1/d) times a pair, and 2 with 3. Entanglement moved; none was added.' },
  ],
  read: [
    { id: 'send', label: 'Read', caption: 'The read sends each basis element down the threads. The far end gets its conjugate on the shared directions.' },
  ],
  shared: [
    { id: 'one', label: 'One qudit', caption: 'One qudit at the end of several links.' },
    { id: 'copies', label: 'Copies', caption: 'Drawn as one copy per link, each paired with its own partner: no thread is shared.' },
    { id: 'exchange', label: 'Exchange', caption: 'Exchange two links: the shared qudit stays, only the far ends move.' },
  ],
  object: [
    { id: 'knot', label: 'The object', caption: 'A shared qutrit, three links to qubits. Two are read at the qutrit end; the third, unread, is the state.' },
    { id: 'strands', label: 'Strands', caption: 'The qutrit as three copies, one per link. The two read copies are joined by a qutrit pair: three threads.' },
    { id: 'paths', label: 'Routes', caption: 'A route from q₁ to q₂ crosses three threads: 1/√2 · 1/√3 · 1/√2 = 1/(2√3).' },
    { id: 'terms', label: '12 terms', caption: 'The joint state: 3 · 2 · 2 = 12 terms, each of amplitude 1/(2√3). The squares sum to 1.' },
    { id: 'weights', label: 'Mirrors', caption: 'Both exchanges act as the mirror of the drawing. Over the join’s 3 threads a record gains √3; over a read link’s 2 threads, √2.' },
  ],
};

export const TEX = {
  pair: '|\\omega_m\\rangle = \\tfrac{1}{\\sqrt{m}}\\textstyle\\sum_{i=1}^{m} |i\\rangle|i\\rangle,\\quad m=\\min(d_1,d_2)',
  swap: '\\langle\\omega_d|_{23}\\,|\\omega_d\\rangle_{12}|\\omega_d\\rangle_{34} = \\tfrac{1}{d}\\,|\\omega_d\\rangle_{14}',
  read: '(A\\otimes\\mathbb{1})|\\omega_m\\rangle = (\\mathbb{1}\\otimes A^{T})|\\omega_m\\rangle',
  shared: '|\\omega\\rangle_{Q_1 q_1}\\,|\\omega\\rangle_{Q_2 q_2}\\,|\\omega\\rangle_{Q_3 f}',
  object: '|\\Omega\\rangle = \\sqrt{6}\\,(P_3)_{Q_1Q_2}\\,|\\omega_2\\rangle_{Q_1q_1}|\\omega_2\\rangle_{Q_2q_2}|\\omega_2\\rangle_{Q_3f}',
};

// ============================================================================
//  ALPHA FROM ENTANGLED QUDITS  ·  story/sources.js  (CORE, DOM-free)
// ----------------------------------------------------------------------------
//  Chapter 11 (glossary and sources), the glossary terms in our own words
//  (after Table S7 of the paper), every source the page cites, the
//  sources per chapter, and the credits. A DOI is given only where we are
//  sure of it; the others carry the journal reference alone.
//
//  GREP MAP
//      grep -n 'export const SOURCES'        id -> citation
//      grep -n 'export const CHAPTER_REFS'   chapter id -> source ids
//      grep -n 'export const GLOSSARY'       term, meaning
//      grep -n 'export const CREDITS'        the credits paragraphs
// ============================================================================

export const SOURCES = {
  paper: { text: 'A. D. Wissner-Gross, “A Parameter-Free Candidate for the Fine-Structure Constant from Entangled Qudits”, preprint, Letter and Supplemental Material, dated 23 October 2026.', url: 'https://www.alexwg.org' },
  fan23: { text: 'X. Fan, T. G. Myers, B. A. D. Sukra, G. Gabrielse, Phys. Rev. Lett. 130, 071801 (2023). Electron magnetic moment.', doi: '10.1103/PhysRevLett.130.071801' },
  morel20: { text: 'L. Morel, Z. Yao, P. Cladé, S. Guellati-Khélifa, Nature 588, 61 (2020). Rubidium recoil.', doi: '10.1038/s41586-020-2964-7' },
  parker18: { text: 'R. H. Parker, C. Yu, W. Zhong, B. Estey, H. Müller, Science 360, 191 (2018). Cesium recoil.', doi: '10.1126/science.aap7706' },
  codata22: { text: 'P. J. Mohr, D. B. Newell, B. N. Taylor, E. Tiesinga, Rev. Mod. Phys. 97, 025002 (2025). CODATA 2022.', doi: '10.1103/RevModPhys.97.025002' },
  pdg22: { text: 'R. L. Workman et al. (Particle Data Group), Prog. Theor. Exp. Phys. 2022, 083C01, review “Electroweak model and constraints on new physics”: 1/α at the Z mass ≈ 127.95.', doi: '10.1093/ptep/ptac097' },
  sommerfeld16: { text: 'A. Sommerfeld, Ann. Phys. (Leipzig) 356, 1 (1916). Fine structure of spectral lines.' },
  eddington29: { text: 'A. S. Eddington, Proc. R. Soc. Lond. A 122, 358 (1929). “The charge of an electron”.' },
  wyler69: { text: 'A. Wyler, C. R. Acad. Sci. Paris A 269, 743 (1969).' },
  wyler71: { text: 'A. Wyler, C. R. Acad. Sci. Paris A 272, 186 (1971).' },
  robertson71: { text: 'B. Robertson, Phys. Rev. Lett. 27, 1545 (1971).', doi: '10.1103/PhysRevLett.27.1545' },
  gilmore72: { text: 'R. Gilmore, Phys. Rev. Lett. 28, 462 (1972).', doi: '10.1103/PhysRevLett.28.462' },
  weinberg64: { text: 'S. Weinberg, Phys. Rev. 135, B1049 (1964).', doi: '10.1103/PhysRev.135.B1049' },
  weinberg65: { text: 'S. Weinberg, Phys. Rev. 140, B516 (1965).', doi: '10.1103/PhysRev.140.B516' },
  peskin95: { text: 'M. E. Peskin, D. V. Schroeder, An Introduction to Quantum Field Theory (Addison-Wesley, 1995).' },
  appelquist75: { text: 'T. Appelquist, J. Carazzone, Phys. Rev. D 11, 2856 (1975). Decoupling.', doi: '10.1103/PhysRevD.11.2856' },
  zukowski93: { text: 'M. Żukowski, A. Zeilinger, M. A. Horne, A. K. Ekert, Phys. Rev. Lett. 71, 4287 (1993). Entanglement swapping.', doi: '10.1103/PhysRevLett.71.4287' },
  verstraete04: { text: 'F. Verstraete, J. I. Cirac, arXiv:cond-mat/0407066 (2004). Projected entangled pair states.', url: 'https://arxiv.org/abs/cond-mat/0407066' },
  horowitz04: { text: 'G. T. Horowitz, J. Maldacena, J. High Energy Phys. 02 (2004) 008. Black-hole final state.', doi: '10.1088/1126-6708/2004/02/008' },
  gottesman04: { text: 'D. Gottesman, J. Preskill, J. High Energy Phys. 03 (2004) 026. Comment on the final-state proposal.', doi: '10.1088/1126-6708/2004/03/026' },
  lloyd11: { text: 'S. Lloyd et al., Phys. Rev. Lett. 106, 040403 (2011). Closed timelike curves via postselection.', doi: '10.1103/PhysRevLett.106.040403' },
  aaronson05: { text: 'S. Aaronson, Proc. R. Soc. A 461, 3473 (2005). PostBQP = PP.', doi: '10.1098/rspa.2005.1546' },
  wootters89: { text: 'W. K. Wootters, B. D. Fields, Ann. Phys. (N.Y.) 191, 363 (1989). Mutually unbiased bases.', doi: '10.1016/0003-4916(89)90322-9' },
  zurek03: { text: 'W. H. Zurek, Phys. Rev. Lett. 90, 120404 (2003). Envariance.', doi: '10.1103/PhysRevLett.90.120404' },
  stormer63: { text: 'E. Størmer, Acta Math. 110, 233 (1963). Positive maps at (2, 2).' },
  woronowicz76: { text: 'S. L. Woronowicz, Rep. Math. Phys. 10, 165 (1976). Positive maps at (2, 3) and (2, 4).' },
  choi75a: { text: 'M.-D. Choi, Linear Algebra Appl. 10, 285 (1975). Completely positive maps.' },
  choi75b: { text: 'M.-D. Choi, Linear Algebra Appl. 12, 95 (1975). The Choi map at (3, 3).' },
  jamiolkowski72: { text: 'A. Jamiołkowski, Rep. Math. Phys. 3, 275 (1972).' },
  horodecki96: { text: 'M. Horodecki, P. Horodecki, R. Horodecki, Phys. Lett. A 223, 1 (1996). Separability and positive maps.', doi: '10.1016/S0375-9601(96)00706-2' },
  horodecki97: { text: 'P. Horodecki, Phys. Lett. A 232, 333 (1997). Entangled states with positive partial transpose.' },
  horodecki98: { text: 'M. Horodecki, P. Horodecki, R. Horodecki, Phys. Rev. Lett. 80, 5239 (1998). Bound entanglement.', doi: '10.1103/PhysRevLett.80.5239' },
  horodecki09: { text: 'R. Horodecki, P. Horodecki, M. Horodecki, K. Horodecki, Rev. Mod. Phys. 81, 865 (2009). Review of entanglement.', doi: '10.1103/RevModPhys.81.865' },
  baez10: { text: 'J. Baez, J. Huerta, Bull. Am. Math. Soc. 47, 483 (2010). The algebra of grand unified theories.', doi: '10.1090/S0273-0979-10-01294-2' },
};

export const CHAPTER_REFS = {
  c0: ['paper', 'codata22'],
  c1: ['sommerfeld16', 'peskin95', 'pdg22', 'weinberg64', 'weinberg65', 'appelquist75'],
  c2: ['paper', 'verstraete04', 'zukowski93', 'horowitz04', 'gottesman04', 'lloyd11', 'aaronson05'],
  c3: ['paper', 'wootters89', 'zurek03'],
  c4: ['stormer63', 'woronowicz76', 'choi75b', 'choi75a', 'jamiolkowski72', 'horodecki96', 'horodecki97', 'horodecki98', 'horodecki09'],
  c5: ['paper', 'baez10'],
  c6: ['paper'],
  c7: ['paper'],
  c8: ['paper'],
  c9: ['paper', 'fan23', 'morel20', 'parker18', 'codata22', 'peskin95'],
  c10: ['eddington29', 'wyler69', 'wyler71', 'robertson71', 'gilmore72', 'paper'],
};

export const GLOSSARY = [
  ['qudit', 'A quantum system with d ≥ 2 levels; a qubit has 2, a qutrit 3.'],
  ['pair, link, type (d₁, d₂)', 'Two qudits in the maximally entangled state on their m = min(d₁, d₂) common levels, |ω_m⟩.'],
  ['shared qudit', 'A qudit at the end of two or more links, carried as one copy per link. The copies are one qudit, so swapping two of its links moves only their far ends.'],
  ['distilling', 'Projection of two qudits onto their pair state, P_m. In the model it has no failure branch; in a laboratory it is a postselection.'],
  ['read', 'An act at one end of a pair: distillation in a basis of that end, with the basis passed to the far end. Taken at the larger end.'],
  ['fix', 'Determine with certainty on the single copy, with every consistent relation between the two ends of a kind reads can carry.'],
  ['known', 'What the reads of a qudit fix together, unchanged under every matching and every exchange of reads or pairs. Two anticommuting reads also fix their product, with the order as its sign.'],
  ['matching, twirl', 'A local change of basis U ⊗ Ū that leaves a pair unchanged; the twirl is the average over all of them.'],
  ['decomposable map', 'A completely positive map plus a completely positive map after the transpose.'],
  ['readable, dark', 'A type whose ends admit only decomposable positive maps, (2, 2) and (2, 3); otherwise dark, though its links stay maximally entangled.'],
  ['read cap', 'd₁d₂ ≤ 6, the condition for a readable type.'],
  ['identification algebra', 'The basis changes at the two ends of a link, su(d₁) ⊕ su(d₂) ⊕ u(1).'],
  ['acting central charge Q', 'The centre of that algebra, nonzero on the pair only at unequal ends; at (2, 3) the hypercharge direction, Q = 6iY.'],
  ['unbroken generator U', 'The centre of the subalgebra that leaves the pair state fixed, i diag(1, 1; −1, −1, 0).'],
  ['configuration, arm', 'A shared qudit with the links at it, each read or unread.'],
  ['end rule', 'A (2, 3) link is read at its qutrit end.'],
  ['two-point function', 'Two reads of a link on a third, unread link of the same type.'],
  ['the object', 'A shared qutrit with three links to qubits, two of them read (Theorem 1).'],
  ['join', 'The contraction of two links at a shared qudit; in the object, the qutrit pair |ω₃⟩ between the read copies.'],
  ['strand (thread)', 'One term |i⟩|i⟩ of a pair state in a chosen basis, of amplitude 1/√d.'],
  ['slot, letter', 'An end of a read link; a basis element of the traceless observables there (8 at a qutrit, 3 at a qubit).'],
  ['record', 'A product of letters at two different slots, or one of the three commutator records: 172 in all.'],
  ['exchange X, Y', 'X swaps a record\'s two reads; Y swaps the two read links and leaves the shared qutrit in place.'],
  ['survives, own sign', 'A record survives an exchange that returns it times its own sign (+1 for a product, −1 for a commutator record).'],
  ['weight √k', 'k is the product of the end dimensions (3 for X, 2 for Y) of the exchanges a record survives.'],
  ['readout dimension N', 'The dimension of the readout algebra R; 24 · 36 · 36 = 31104 at the object.'],
  ['readout ⟨M⟩', 'The normalized trace tr_R M / N of the dressed insertion; the bare insertion, the identity, reads 1.'],
  ['Photon Conjecture', 'Conjecture 1 of the paper: the link of the object is the elementary link of the photon and its readout is α(0).'],
];

export const CREDITS = [
  'Text: our own explanation of the paper by A. D. Wissner-Gross (preprint, 23 October 2026). We paraphrase it; the quoted axiom, theorem and conjecture are short attributed quotes. The page explains the paper and does not endorse it.',
  'Figures: every drawing on this page is our own. None is copied or traced from the paper. The threads, gears, locks, mirrors, drum and dials are analogies; each one says where it breaks.',
  'Numbers: our model (model/ in this folder) rebuilds the records from the slot construction and recomputes the counts, the value and its digits in JavaScript, with BigInt integer square roots. The paper\'s Lean file and scripts (ChainAlpha.lean, enumerate_records.py, mutations.py, records.csv) were not available to us, and nothing on this page claims they ran.',
  'Measurements: CODATA 2022, the electron magnetic moment with the Standard Model prediction (Fan et al. 2023), rubidium recoil (Morel et al. 2020) and cesium recoil (Parker et al. 2018), as quoted in the paper\'s Fig. 3.',
  'Theorems cited: Størmer (1963), Woronowicz (1976), Choi (1975), Jamiołkowski (1972), the Horodeckis (1996–2009), Wootters and Fields (1989), Weinberg (1964, 1965), Appelquist and Carazzone (1975), Baez and Huerta (2010).',
];

export const CLOSE = [
  {
    id: 'c11', num: 11, short: 'Glossary', title: 'Glossary and sources',
    blocks: [
      { p: `The paper uses ordinary words in exact senses. Here they are in one place, in our words.` },
      { p: `The sources below are those this page relies on, most of them cited by the paper itself. Where the page states a number, it comes from the paper or from our own recomputation in model/, and the chapter says which.` },
      { table: 'glossary' },
      { table: 'sources' },
      { table: 'credits' },
    ],
    figures: {},
  },
];

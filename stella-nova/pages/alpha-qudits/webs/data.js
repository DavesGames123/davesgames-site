// ============================================================================
//  ALPHA QUDITS  ·  webs/data.js  ·  the facts of the closing section (WEBS)
// ----------------------------------------------------------------------------
//  DOM-free. Every fact here comes from one source only: the author's talk
//  deck "Chain Theory: an introduction" (A. D. Wissner-Gross, 23 October
//  2026). We have not read the compendium it summarizes (release 0.1, a
//  working draft) or its Lean files. Box numbers are the compendium's, as
//  the deck quotes them.
//
//  GRADES (the deck's own terms; one colour each in every scene)
//    theorem ......... derived from the axiom and its definitions
//    conditional ..... derived under conditions named in its box
//    open ............ stated, carried to a named step that is still open
//    conjectured ..... a correspondence with physics, tested by measurement
//    notInRelease .... rests on results not in release 0.1
//
//  GREP MAP   (grep -n "export const" data.js)
//    GRADES, GRADE_COLORS, GENRES, PARTS, TOTALS, ELECTRON, LEPTONS, WZ,
//    RESULTS, WEB_TALLY, CAUTIONS, SOURCE
// ============================================================================

export const SOURCE = {
  title: 'Chain Theory: an introduction (talk deck)',
  author: 'A. D. Wissner-Gross',
  date: '2026-10-23',
  note: 'Numbers from the talk deck only. We have not read the compendium or its Lean files.',
};

export const GRADES = {
  theorem: 'theorem',
  conditional: 'conditional theorem',
  open: 'open result',
  conjectured: 'conjectured',
  notInRelease: 'not in this release',
};
// theorem green (m3), conditional blue (m1), open grey, conjectured amber
export const GRADE_COLORS = {
  theorem: '#86dc7c', conditional: '#62c4ff', open: '#93a2a8', conjectured: '#ffb454', notInRelease: '#5d6b70',
};

// The six genres of link: the pair of end dimensions, larger end first.
// readable: from the read cap d1 d2 <= 6 (derived in the Letter).
// sector: the deck's conjectured correspondence; byName marks the cells
// that the deck calls a correspondence "by name" only.
export const GENRES = [
  { d: [2, 2], part: 'VI', subject: 'metric, worldline, horizon', sector: 'spacetime', byName: false },
  { d: [3, 2], part: 'VII', subject: 'the photon', sector: 'electromagnetism', byName: false },
  { d: [4, 2], part: 'VIII', subject: 'carriers and breaking', sector: 'the weak interaction', byName: true },
  { d: [3, 3], part: 'IX', subject: 'the junction', sector: 'the strong interaction', byName: true },
  { d: [4, 3], part: 'X', subject: 'the Yukawa leg', sector: 'the Yukawa sector', byName: true },
  { d: [4, 4], part: 'XI', subject: 'the Higgs and its hub register', sector: 'the Higgs', byName: true },
].map(g => ({ ...g, product: g.d[0] * g.d[1], readable: g.d[0] * g.d[1] <= 6 }));

// The compendium's boxed statements by Part: [theorems, conditional, open].
// Parts II and XVI hold tables only. The deck gives the totals, and the
// subtotals 41 28 55 for Parts I-V and 25 10 29 for Parts XII-XV.
export const PARTS = [
  { part: 'I', what: 'the framework', n: [20, 9, 23] },
  { part: 'III', what: 'quantum mechanics', n: [1, 8, 4] },
  { part: 'IV', what: 'spacetime and symmetry', n: [6, 5, 4] },
  { part: 'V', what: 'the gauge structure', n: [14, 6, 24] },
  { part: 'VI', what: 'the (2,2) cell', n: [2, 17, 30] },
  { part: 'VII', what: 'the (3,2) cell', n: [5, 10, 9] },
  { part: 'VIII', what: 'the (4,2) cell', n: [1, 8, 17] },
  { part: 'IX', what: 'the (3,3) cell', n: [1, 12, 12] },
  { part: 'X', what: 'the (4,3) cell', n: [6, 18, 8] },
  { part: 'XI', what: 'the (4,4) cell', n: [2, 3, 2] },
  { part: 'XII', what: 'decays', n: [1, 9, 16] },
  { part: 'XIII', what: 'thermodynamics', n: [7, 0, 5] },
  { part: 'XIV', what: 'condensed matter', n: [6, 0, 3] },
  { part: 'XV', what: 'quantum information', n: [11, 1, 5] },
  { part: 'App.', what: 'appendices', n: [6, 2, 23] },
  { part: 'Instr.', what: '52 instrument chapters', n: [11, 1, 13] },
];
export const TOTALS = { theorem: 100, conditional: 109, open: 198, foundations: [41, 28, 55], applications: [25, 10, 29], cells: [17, 68, 78] };

// The electron's web as the deck lists it: one part per genre. stated:
// what the deck says. The deck does not give how many legs or docks there
// are, or where each ends; the scene draws those dashed, as unspecified.
export const ELECTRON = [
  { genre: [3, 3], part: 'core', text: 'the core triangle of three qutrits' },
  { genre: [4, 3], part: 'inLeg', text: 'the in-leg joining the hub to the core' },
  { genre: [4, 2], part: 'legs', text: 'the legs of the hub assembly' },
  { genre: [2, 2], part: 'qubitPair', text: 'the qubit pair of the hub assembly' },
  { genre: [3, 2], part: 'docks', text: 'the docks at the other two corners' },
];
export const LEPTONS = [
  { name: 'electron', hubs: 1 },
  { name: 'muon', hubs: 2, grade: 'conditional', box: '152.1', claim: 'the lepton ladder' },
  { name: 'tau', hubs: 3, grade: 'theorem', box: '154.1', claim: "the tau's third hub" },
];

// The W and the Z: one web, two reads. The deck does not draw the web's
// structure in a form we can use; only the read differs.
export const WZ = [
  { claim: 'the W word as the passage web of the cross read', grade: 'open', box: '159.2' },
  { claim: 'the Z as the two-line read', grade: 'open', box: '159.1' },
  { claim: 'the ratio of the two offices is exactly 1/2', grade: 'conditional', box: '164.5' },
  { claim: 'the ratio of the W and Z masses', grade: 'open', box: '160.1' },
];

// Results the deck singles out, each with its grade and box.
export const RESULTS = [
  { claim: 'The face group of the qutrit-qubit tether is S(U(2) × U(3)), isomorphic to (SU(2) × SU(3) × U(1))/ℤ₆', grade: 'theorem', box: '64.2' },
  { claim: 'The generation count is three at the three core sites of the closed triangle', grade: 'theorem', box: '83.1' },
  { claim: 'The Ward identity from conservation as one link', grade: 'conditional', box: '78.1' },
  { claim: 'At the qutrit-qubit link, the isometry algebra of the Hermitian split equals the Lorentz algebra', grade: 'conditional', box: '54.1' },
  { claim: 'The inner product of the span is the Born readout (the Born rule as an output)', grade: 'conditional', box: '35.1' },
  { claim: 'Confinement as the readability of the dark genre (3,3)', grade: 'conditional', box: '171.1' },
  { claim: 'The proton as a seeded sink', grade: 'open', box: '175.1' },
  { claim: 'The Higgs quartic is an exact element of ℚ(√2, √3) at every one of 10,123 Higgs-form sinks', grade: 'theorem', box: '202.1' },
  { claim: 'That ends have dimension two, three or four ("Conjecture 0")', grade: 'conditional', box: '1.7' },
];

// The 17 particles drawn on 16 webs, by the grade of what each rests on.
export const WEB_TALLY = { particles: 17, webs: 16, theorem: 1, conditional: 11, open: 2, notInRelease: 3 };

export const CAUTIONS = [
  'Many theorems are exhaustive checks over the webs the compendium records: a census of a finite catalogue, not a proof for every web. The deck gives the second law at the counting face as an example, checked at all 228 one-act reads of fourteen bodies.',
  'Names from the literature are correspondences by name. Each box is a statement about the networks, at the grade shown.',
  'That a web is the named particle is a conjecture.',
  'The compendium is release 0.1, a working draft.',
];

export const sum3 = rows => rows.reduce((a, r) => [a[0] + r.n[0], a[1] + r.n[1], a[2] + r.n[2]], [0, 0, 0]);

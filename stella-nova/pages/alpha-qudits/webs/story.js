// ============================================================================
//  ALPHA QUDITS  ·  webs/story.js  ·  the closing section text (WEBS)
// ----------------------------------------------------------------------------
//  "Beyond the Letter: Chain Theory's wider program". CORE's chapter shape
//  (story/index.js): { id, num, short, title, blocks, figures }, with
//  figures of pkg 'webs'. The section goes after the glossary and sources,
//  behind a divider; chapters 0-11 do not depend on it.
//
//  Source: the author's talk deck "Chain Theory: an introduction"
//  (A. D. Wissner-Gross, 23 October 2026), in our own words. Every claim
//  carries the deck's grade. We have not read the compendium or its Lean.
//
//  GREP MAP   export const WEBS · export const WEBS_POINTER (the one line
//             for the end of chapter 10)
// ============================================================================
import { RESULTS, GRADES, CAUTIONS, TOTALS, WEB_TALLY } from './data.js';

const g = k => `<i>${GRADES[k]}</i>`;
const res = r => `${r.claim} (${g(r.grade)}, box ${r.box}).`;

export const WEBS_POINTER = `The paper is one result of a larger program, Chain Theory. A separate section at the end of this page, after the sources, sketches that program and how its author grades each claim.`;

export const WEBS = {
  id: 'webs', num: 12, short: 'Beyond the Letter', title: "Beyond the Letter: Chain Theory's wider program",
  divider: true,
  blocks: [
    { aside: `This section is apart from the explanation above, and nothing there depends on it. Its source is the author's talk deck, "Chain Theory: an introduction" (23 October 2026). The numbers come from the talk deck only. We have not read the compendium it summarizes or its Lean files.` },
    { p: `The paper on α is the first published result of a wider program that its author calls Chain Theory. The talk sorts what it claims into three kinds. ${g('theorem')}: the exact number and its computation, checked in a Lean file. A compendium of preliminary findings, each boxed statement graded as a ${g('theorem')}, a ${g('conditional')} (derived under conditions named in its box) or an ${g('open')} (carried to a named step that is still open). And ${g('conjectured')}: that the number is α(0), that six genres of link correspond to sectors of physics, and that certain webs of links are the Standard Model particles.` },
    { p: `The name has three sources in the talk. Particles are taken to be finite chains, or chainmail, of discrete links, not continuous strings. The links join at shared qudits, and each join carries a freedom in how bases are matched across it. And every record is read from one end, outward to the far end. The talk draws this with a chain, and calls it an analogy for the joins, not a model of them.` },
    { fig: 'fw1' },
    { analogy: {
      name: 'Rigid links, free joints',
      right: `Inside a link nothing turns: a basis at one end of a pair fixes the basis at its far end. At a joint two links meet and turn freely, as the copies of a shared qudit carry no fixed match between their bases. What is known is what no turn of a joint changes.`,
      breaks: `A chain turns through angles in space. A pair has no space: a turn is a change of basis by any unitary, and the far end turns by its conjugate. The author marks the picture as an analogy for the joins only.`,
    } },
    { p: `A link's genre is the pair of its end dimensions, larger end first. With ends of dimension 2, 3 or 4 there are six genres. The top of each cell below is derived: the read cap of chapter 4 makes (2,2) and (3,2) readable and the other four dark. Under each cell the talk puts a conjectured sector of physics, one Part of the compendium per genre: (2,2) spacetime, (3,2) the photon and electromagnetism, and, by name only, (4,2) the weak interaction, (3,3) the strong interaction, (4,3) the Yukawa sector and (4,4) the Higgs. That ends have dimension two, three or four is itself box 1.7, "Conjecture 0", which the compendium grades a ${g('conditional')}.` },
    { fig: 'fw2' },
    { p: `The talk then draws webs for the Standard Model particles: each site a qudit, each line a maximally entangled pair. The electron's web has a core triangle of three qutrits joined by (3,3) links, a (4,3) in-leg to a hub assembly with (4,2) legs and a (2,2) qubit pair, and (3,2) docks at the other two corners. Each generation adds one hub assembly: two for the muon, the lepton ladder (${g('conditional')}, box 152.1), and three for the tau, whose third hub is a ${g('theorem')} (box 154.1). The W and the Z are one web, told apart by the read: the W read along one line, the Z along two. That any web is the named particle is ${g('conjectured')}. Of the ${WEB_TALLY.particles} particles drawn on ${WEB_TALLY.webs} webs, ${WEB_TALLY.theorem} rests on a theorem, ${WEB_TALLY.conditional} on conditional theorems, ${WEB_TALLY.open} on open results and ${WEB_TALLY.notInRelease} on results not in this release.` },
    { fig: 'fw3' },
    { more: { title: 'Results the talk singles out, with their grades', blocks: [
      { list: RESULTS.map(res) },
      { p: `In the talk's own wording, names from the literature are correspondences by name, and each box is a statement about the networks, at the grade shown.` },
    ] } },
    { p: `How to read the counts. The compendium is release 0.1, a working draft, with ${TOTALS.theorem} theorems, ${TOTALS.conditional} conditional theorems and ${TOTALS.open} open results. The author adds a caution of their own: many of the theorems are exhaustive checks over the webs the compendium records, a census of a finite catalogue and not a proof for every web. Read these as a map of where the program stands, by its author's grading, not as results checked here.` },
    { fig: 'fw4' },
    { list: CAUTIONS },
  ],
  figures: {
    fw1: { pkg: 'webs', title: 'Rigid links, free joints', tag: 'analogy', scenes: [
      { id: 'chain', label: 'Chain', cap: 'The talk\'s analogy for the joins, in our drawing: rigid links, free joints, and what no turn of a joint changes.' },
    ] },
    fw2: { pkg: 'webs', title: 'Six genres of link', tag: 'paper', scenes: [
      { id: 'genres', label: 'Genres', cap: 'Derived on top (the read cap), conjectured in the amber band. Counts per Part from the talk deck.' },
    ] },
    fw3: { pkg: 'webs', title: 'Conjectured webs', tag: 'paper', scenes: [
      { id: 'electron', label: 'Electron', cap: 'The electron\'s web, built in the order the talk lists its genres. Dashed: counts and far ends the talk text does not give.' },
      { id: 'wz', label: 'W and Z', cap: 'One web, two reads. The web\'s structure is not given in the talk text; only the reads are drawn firmly.' },
    ] },
    fw4: { pkg: 'webs', title: 'The compendium, graded', tag: 'paper', scenes: [
      { id: 'grades', label: 'Grades', cap: 'Boxed statements by Part (theorems, conditional theorems, open results), and the 17 particles by what they rest on. Counts from the talk deck.' },
    ] },
  },
};

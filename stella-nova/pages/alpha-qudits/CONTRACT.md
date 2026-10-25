# Alpha from Entangled Qudits page contract

Binding spec for the alpha-qudits swarm. Read all of it before you write
code. Also read `stella-nova/PAGES.md` "How to add a page". The commit
and validation rules at the end of this file apply to every package.

## What the user asked for (verbatim, 2026-10-24)

> I need a page to fully visualize and explain the fundamental concepts
> of this paper, there are SO MANY different visualization objects you
> can draw on from across the site to explain it i want a few different
> analogies put it in the research section please dispatch a swarm push
> when done

The paper: A. D. Wissner-Gross, "A Parameter-Free Candidate for the
Fine-Structure Constant from Entangled Qudits", dated 23 October 2026,
Letter plus Supplemental Material (24 pages). The PDF is at
`/private/tmp/claude-501/-Users-davidkubala-Downloads-davesgames-site/9564ef57-c48f-42f2-b748-b04e6c75e791/scratchpad/paper/ChainTheoryAlpha.pdf`
(read it with the Read tool, `pages: "1-8"`, then `"9-24"` as needed).
Do not commit the PDF.

## Page

Key and folder `alpha-qudits`, label "Alpha from Entangled Qudits",
nav Science > Research > Physics (the coordinator registers it).
Nobody but the coordinator edits `lib/nav-data.js`,
`lib/screensaver-catalog.js`, `pages/home/**`, `PAGES.md`, or files of
other pages. You MAY import read-only from other pages and from `lib/`
(for example `../tensor-calculus/diagram/index.js`,
`../particle-collider/feynman.js`, `../../lib/sci-math.js`,
`../../lib/saver-clear.js`). If a shared module needs a change, wrap or
copy it into this folder and say so in your report.

## Stance (load-bearing)

The paper is a one-day-old preprint that proposes a closed form and a
conjecture. The page explains it faithfully and does not endorse it.

- Write "the paper derives", "the paper proposes", "Conjecture 1 says".
  The identification with alpha(0) is a conjecture in the paper itself.
  Say so wherever the number is compared with experiment.
- One chapter, "How to weigh a closed form", is fair and concrete: the
  history (Eddington's 136 and 137, Wyler 1969/1971 and the objections
  by Robertson and Gilmore that the paper itself cites), the paper's
  Table S5 of alternative clauses and their values, and a live
  look-elsewhere count (see COMPARE). Also state what the paper does in
  its favour: it lists every input (Table S1), says what would change
  the number, and publishes a Lean check. No mockery, no hype.
- The paper's text is copyrighted. Paraphrase in our own words. Short
  quotes (the one-sentence axiom, theorem names) are fine with
  attribution. Do not copy or trace its figures: every drawing is ours.
- The Lean file and scripts (ChainAlpha.lean, enumerate records.py,
  mutations.py, records.csv) are not available to us. Never claim they
  ran. Our model/ recomputes the counts independently in JavaScript,
  and the page says that.
- Number facts to keep exact (all checked with mpmath by the
  coordinator): alpha_cand = (79 + 48√2 + 42√3 + 3√6)/31104,
  1/alpha_cand = 137.035 999 189 566 155 029 183 744 020 866 ...;
  sigma offsets: CODATA 2022 137.035999177(21) +0.60, electron g-2
  137.035999166(15) +1.57, Rb 2020 137.035999206(11) -1.49,
  Cs 2018 137.035999046(27) +5.32. Born weights 31104/319 = 97.505,
  no weights 31104/172 = 180.837.

## Analogies (the user asked for "a few different analogies")

Each analogy is a figure with its own short text that says what the
analogy gets right and where it breaks. Draw on the site's existing
visual language (named sources in brackets; reuse code by import or
reuse the look by imitation).

1. Threads (STRANDS). A maximally entangled pair of dimension d is d
   threads of amplitude 1/√d; a qutrit and a qubit share two threads and
   the qutrit's third direction meets none. Entanglement swapping as
   re-tying threads (Eq. S1). The object as a knot of three links with
   the shared qutrit drawn as three copies. [thread-art, string-lab,
   tensor-calculus network style]
2. Mirror gears (ENDS). The transpose identity: a turn U at one end is
   the same as Ū (transpose) at the far end, like two gears that mesh
   so the far one turns in mirror. A matching U ⊗ Ū leaves the pair
   unchanged (both gears turn and the mesh is the same). Qubit end as a
   Bloch sphere with its 3 mutually unbiased read bases, qutrit end with
   its 4 bases and 8 Gell-Mann letters. [gear-types, hopf-fibration S2,
   quantum-algorithm-visualizer]
3. Locks and keys (ENDS). The read cap: a grid of types (d1, d2), each a
   lock. Positive maps are keys; reads cut only decomposable keys.
   (2,2) and (2,3) open for every key (Størmer, Woronowicz); (2,4) and
   (3,3) have a key no read cuts (Woronowicz, Choi map); every product
   ≥ 8 inherits it; 7 is no product. Then the charge Q: only (2,3) has
   unequal ends, so only it carries an acting central charge, and its
   algebra is su(3) ⊕ su(2) ⊕ u(1). [pin-tumbler-lock look, periodic
   table grid look]
4. Mirrors and drum modes (RECORDS). The 172 records on the square of
   four slots (Q1, q1, Q2, q2 with 8, 3, 8, 3 letters). The two
   exchanges X (reads) and Y (links) are mirror flips; a pair of
   records combines into an even and an odd mode, as a drum or a
   Chladni plate has symmetric and antisymmetric modes. Sorting into
   the four sectors 79, 48, 42, 3 with weights 1, √2, √3, √6, then an
   abacus or balance that adds the weights over N = 31104 into the
   number, digit by digit. [platonic-mirrors, chladni-plate,
   wave-membrane, string-lab]
5. A correspondence of roles (COMPARE). On-shell QED: alpha(0) = Z3
   alpha_bare, vacuum polarization as a dressed photon line. The model:
   two reads on an unread link, dressed over bare = ⟨M⟩. A side-by-side
   in which the roles light up in pairs, with the paper's own warning
   that no record is a Feynman diagram. [particle-collider Feynman
   diagram style]
6. Dials (COMPARE). Every alternative of Table S5 as a switch; flip a
   clause and watch 1/alpha move off 137.036 on the measurement ruler.

## Chapters (CORE writes the text; order is fixed)

0. Hero: the number. 1/alpha_cand streams its digits against the
   measured values (COMPARE ruler), one sentence on what the paper
   claims, one on what it does not yet show.
1. What alpha is, and why one would want to derive it (on-shell
   coupling, Z3, Ward identity Z1 = Z2, decoupling). Plain language.
2. The axiom and its five definitions (qudit, shared, distilling, read,
   known). STRANDS figure.
3. Reads and the transpose identity. ENDS gears + Bloch figure.
4. Which links can be read: the read cap. ENDS locks figure.
5. The charge: su(3) ⊕ su(2) ⊕ u(1), Q = 6iY, hypercharge 1/6, the
   unbroken generator U. ENDS block-matrix figure.
6. The object (Theorem 1): shared qutrit, three links, two read. The 23
   readable configurations and the three filters (end rule, two-point
   function, acting charge). STRANDS object + MODEL table.
7. Counting: N = 24 · 36 · 36, the 4 slots, 169 products + 3
   commutators = 172 records. RECORDS square.
8. Survival and weights: X, Y, the four sectors, √k, Eq. (6). RECORDS
   mirrors + abacus.
9. The comparison and the conjecture. COMPARE ruler + correspondence.
10. How to weigh a closed form. COMPARE dials + look-elsewhere lab +
    history.
11. Glossary and sources.

Each chapter: a sentence-case heading, 2-5 short paragraphs, MathJax SVG
equations with the site colour classes, one live figure. Phone first:
figures fit 360 px wide, controls are 44 px targets.

## Shared data and APIs

### MODEL (model/*.js, DOM-free, exact)
`model/index.js` header documents and re-exports:

- `pauli()`, `gellMann()`: complex matrices as `{re, im}` Float64Array
  rows. `slots()` → `[{id:'Q1', d:3, letters:8}, ...]`.
- `buildRecords()` → 172 records `{ id, kind: 'product'|'commutator',
  slots: [a, b], letters: [i, j], combo: 'self'|'even'|'odd'|'diff',
  partner, X: ±1, Y: ±1, k: 1|2|3|6, sector: '++'|'+-'|'-+'|'--' }`
  built from the slot construction, not from the published counts.
  The digits 79, 48, 42, 172, 31104 may appear only in tests.
- `sectors(records)` → `{ '++': 79, '+-': 48, '-+': 42, '--': 3 }`.
- `readoutDimension(config)` (24·36·36 at the object) and
  `enumerateConfigs()` → 76 configurations, 42 under the read cap,
  23 readable (Table S2), each with `{center, arms, links, reads,
  unread, N, records, filters: {endRule, twoPoint, charge}}`.
- `readCap(d1, d2)`, `readableTypes()`, `centralCharge(d1, d2)`
  (i(d2 - d1)), `identificationBasis()` (the 12 generators of Sec. S10,
  5×5), `stabilizer()` (rank 8, null space 4, center ∝ U).
- `value(opts)` → `{ coords: [79/31104, 1/648, 7/5184, 1/10368],
  numerator: {a, b, c, d}, denominator, float, inverseDigits(n) }`
  with exact digits from BigInt integer square roots (n up to 60).
  `opts` toggles the clauses of Table S5 (endsSwapped, bothAtQubit,
  bothAtQutrit, xWhereLettersSit, qqMovedByY, copiesSeparate,
  noOwnSign, commutatorsXOnly, sumsAndDiffs, noCommutators, born,
  readEnds, perRecord, noWeights). Each toggle is recomputed from the
  records under the changed rule, and a test checks every row against
  the value printed in Table S5. If a row cannot be recomputed from the
  stated rule, mark it `fromPaper: true` and say so in the UI.
- `MEASUREMENTS` (the four values above with sources) and `sigma(x)`.
- `HISTORY`: Eddington, Wyler, and the rejoinders, with citations.
- `lookElsewhere({ coeffMax, denominators, window })` → count of
  numbers (a + b√2 + c√3 + d√6)/D with small non-negative integer
  a..d that land inside the window around CODATA, plus the expected
  count from density. Runs in a module worker (`model/le-worker.js`),
  in time slices, cancellable.
- Tests: `model/tests.mjs`.

### STRANDS (strands/**)
`createStrands(host, opts) -> { show(scene, params), play(t),
resize(), dispose(), scenes, saverShots }`. Scenes: `pair` (d slider
1..4, unequal ends), `swap` (Eq. S1), `read` (basis passed along the
pair, far-end states, the zero vector when a basis vector is outside
the support), `shared` (one qudit, copies per link), `object` (Fig. 1a
and S1b in our own drawing; the 12-term joint state, amplitudes
1/(2√3)). 2D canvas or SVG; three.js only if it clearly helps.

### ENDS (ends/**)
`createEnds(host, opts)` same shape. Scenes: `gears` (transpose
identity and matchings), `bloch` (qubit, 3 MUBs, anticommuting reads,
the commutator letter), `qutrit` (8 Gell-Mann letters, 4 MUBs, phase a
cube root of unity, so no sign), `locks` (the (d1, d2) grid up to 5×5
with the Choi map key at (3,3)), `charge` (5×5 block matrix of the
identification algebra; Q, Y, U highlighted; SM gauge group label;
hypercharge 1/6 of the (3,2) quark doublet).

### RECORDS (records/**)
`createRecords(host, opts)` same shape. Scenes: `square` (four slots,
edges with 64, 9, 24, 24, 24, 24 and the arc with 3), `mirror` (X and
Y as flips, a pair splitting into even and odd), `modes` (the drum
analogy), `grid` (all 172 records as our own small glyphs, sorted by
sector, hover or tap shows the record), `abacus` (adds 1, √2, √3, √6
per record over N into the digits of 1/alpha). Reads records from
MODEL; never hard-codes counts.

### COMPARE (compare/**)
`createCompare(host, opts)` same shape. Scenes: `ruler` (Fig. 3 in our
drawing: the four measurements with 1-sigma bars, the candidate line,
zoom from 137 down to 1e-9), `digits` (the 60-digit stream), `dials`
(Table S5 switches), `lookElsewhere` (the worker count with controls
and an honest explanation), `roles` (QED vs model side by side),
`history`.

### CORE
`index.html`, `style.css`, `main.js`, `story/*.js` (chapter text),
`equations.js`, `tests.mjs` (runs every package test and links
main.js in node). Long scroll explainer with a figure per chapter, a
chapter rail on desktop, a compact chapter menu on phones. Figures
mount only when scrolled near and pause when off screen. Fonts and math
from `lib/sci.css` and `lib/sci-math.js` (MathJax SVG; never KaTeX; no
Playfair, Cormorant or JetBrains Mono). Sentence-case labels, no
uppercase letter-spaced HUD text, no "SYS //" text. Head load order
gpu-guard, wishlist, stats-beacon; `[hidden]{display:none!important}`;
credits section with the paper and every cited theorem. CORE exposes
`window.alphaPage = { goto(chapter), figure(name) }` for SAVER.

### SAVER (phase 2, saver/**)
`window.snSaver = { enter(opts), exit }` per `lib/screensaver.js`.
Shots across every package's `saverShots`, seeded shuffle, cuts every
5-12 s, subject framed in `plateBand(h)` from `lib/saver-clear.js` at
16:9 and 9:16, plate carries live TeX and a short real code extract
from model/. Test the plan in node.

## Validation

No headless Chrome, Playwright, CDP or browser screenshots. Allowed:
node tests, `node --check`, node ESM import of each module, jsdom boot
(install `jsdom@24.1.3` in the scratchpad and use NODE_PATH; never the
old JSDOM_DIR), TypeScript checkJs for undefined names, MathJax in node
to check every TeX string typesets. Each package adds its tests to its
own `tests.mjs`; CORE's top-level `tests.mjs` runs them all.

## Commits

Branch main. Stage and commit by pathspec in one Bash command
(`git commit -m ... -- <your paths>`); before it, check
`git diff --cached --name-only` holds only your paths. No `add -A`,
amend, rebase, stash or push. Subject `alpha-qudits: <imperative>`
under 72 characters, ASD-STE100 body with the real validation commands
and output, and a line that no browser ran. End with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
Commit an early version of your public API with its header in your
first commit. Requests to another package go in `NOTES.md` as a dated
line (from, to, what); work against a local stub until the other side
lands.

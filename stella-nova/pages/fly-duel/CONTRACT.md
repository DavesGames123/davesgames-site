# Fly Duel: binding contract

## USER DIRECTION, 2026-10-11 (overrides the section plan below)

User words, verbatim: "you can break from form from the rest o fthe
research pages. the "how it's done" is uninteresting tbh, i mostly care
about the simulation and layout in fullscreen"

- The page is a fullscreen game first. On load, the viewport is the 3D
  table (watch or play mode) at 100vw x 100dvh, with the HUD (scorecards
  top-left Fly A / top-right Fly B, mode and deck controls, the play UI)
  laid over it. No hero-and-scroll research layout around it.
- The explainer sections (01-09) are no longer the page. Move them behind
  one small "How it works" button (a drawer or a separate overlay), short.
  Keep the honesty line ("a model wired from the connectome, not a real
  fly"), the not-affiliated line and the credits reachable from the HUD.
  Keep the facts and tests that guard them, but the text can shrink.
- Setting (user, verbatim): "it should definitely be done on a convention
  table not a proper card table foldling table with mana mats and other
  flies nearby engaged in fake other games". A convention hall: long
  folding table, a playmat per fly (our own design), dice and deck boxes,
  rows of other tables where other flies play their own fake games, a
  crowd watching. Saver and review must follow this setting.
- One voice for the game state (user, verbatim): "generally there are way
  too many nofifications of who'se turn it is. it looks as if we have the
  research page information coflicting with the simulation GUI and the
  game GUI". Rules: one turn indicator only (a slim, quiet element that
  changes in place; no stacked banners, no 3D banner plus DOM banner plus
  pause banner for the same event); big banners only for game start and
  game end. Three layers that never overlap: the 3D scene; the game HUD
  (scorecards, play controls); and the research content, which lives only
  behind "How it works" (no kicker, chips, stage tag or section text over
  the game). Messages that a player needs ("wait for your turn") show at
  the control that was used, not as page-wide notices.
- Brains (user, verbatim): "let's make sure we have a beautifully
  represented fly brain on both sides". Fly A and Fly B each get a large,
  beautiful, live brain view placed symmetrically (A on its side, B on
  its side) that never covers the cards or a hand: real neuron positions,
  the neuropil shell, KC sparse firing, spikes on real edges, DAN bursts
  per compartment, crisp (no soft glow). Play mode keeps the opponent's
  brain big and drops only the human seat's map.
  Then (verbatim): "that should be the main feature of the layout". So the
  two brains are the hero of the screen, not an inset: on wide screens
  the layout is brain A | the 3D table with the flies | brain B, each
  brain panel large (about a third of the width each, full height), live
  and turnable; the flies still fill the centre panel. On a portrait
  phone: the two brains stacked above and below the table (or one brain
  per half, switching with the acting fly), never hidden by default.
  Then (verbatim, 2026-10-11): "so much of the visual real estate of the
  fruit fly panel is just shrouded in black bars when instead the
  backgrouds of both brains shoul dbe transparent to show the maximum
  amount of board state". So the 3D table fills the whole game view
  again, and the two brains are transparent overlays on it (A on the
  left, B on the right; on a portrait phone A at the top, B at the base),
  same size, no ground, no border. Outside the projected bounds of a
  brain, input goes to the table.
  Then (verbatim, 2026-10-12): "i want the visual of the fly to take up as
  much visual real estate as possible". Framing the table only in the
  narrow clear strip between the brains shrank the flies (60 px at
  1920x1080). So in watch mode the camera frames the FULL view again: the
  outer board can lie under the transparent brains, each brain map is a
  square (wide: at the top of its side; tall: A at the left of the top
  band, B at the right of the base band), and the two flies and the
  board centre stay clear of the brain squares. At 1920x1080 each fly is
  at least 120 px high in the wide and combat shots
  (tests/brainpanels.test.mjs 'framing'). Also (verbatim): "make sure the
  whole thing is extremely compatible with mobile" and "hovering cards in
  the game section should pull the image up in their hovered version".
- Spend the effort on the simulation, the 3D table, the play UX and the
  fullscreen layout on phones and desktops.
- Playmats (user, verbatim, 2026-10-12): "colors of the playmats should
  change based on their current deck". Each seat's playmat takes the
  colours of that seat's deck (ui/fly3d/hall.js setMat, called from
  setDeckBox): one colour fills a dark mat with its symbol; two or three
  colours split it in bands with a soft blend. It changes on every new
  game in watch, play (custom decks too) and the saver
  (tests/fly3d-matcolour.test.mjs).
- Card focus (user, verbatim, 2026-10-12): "wehen i focus on a card it
  sholdnt be the only thing availabe in the iterface". A focused card is
  non-modal: the watch zoom (ui/cardzoom.js) and the play inspector
  (ui/play/inspector.js) are side panels with no veil, no full-screen box
  and no click-catcher. Only their close control takes pointer events.
  The board, the hand, the buttons, the menu, the brain panels, the keys
  and the camera stay usable. focusPlace puts the card on the side away
  from the pointer, clear of the scorecards and the hand; a phone gets a
  compact card docked at the top. Close: the close control, Escape, a
  right-click that does not focus a card, or another card focused. A
  left click on the board goes to the board. The earlier direction stays
  (verbatim): "if i hover and right click over any card during the
  simulation i should be able to see a magnified view of it superimposed
  on the screen until i right click somewhere elese"
  (tests/focus.test.mjs).


User request (2026-10-11, verbatim): "i want you to train a fruit fly brain
(two of them) to play magic the gathering against one another i need a page
for this under the research section please do not hold back dispatch the
swarm"

Page key and folder: `fly-duel` (stella-nova/pages/fly-duel). Nav: Research
(id "papers"), new group "Neuroscience", label "Fly Brain Card Duel". The
coordinator does the nav, the screensaver catalog and the thumbnail. Package
agents do not edit any file outside pages/fly-duel.

## What the page is

Two model fruit fly brains learn, by dopamine-gated plasticity in a
connectome-constrained mushroom body, to play a cut-down trading-card duel in
the style of Magic: The Gathering. They train by self-play, live in the
browser (Web Worker), and from shipped pretrained weights. The page explains
the science and shows the flies play, with their neurons firing.

Honesty rules (load-bearing):
- We do not train a real fly. We train a model whose wiring comes from the
  published connectome. Say so on the page in plain words.
- The mushroom body (MB) is the fly's associative learning centre. Real
  facts: projection neurons (PNs) -> ~2000 Kenyon cells (KCs) per hemisphere
  with sparse random-like claws (~6-7 PN inputs per KC), APL feedback
  inhibition (sparse coding, ~5-10% KCs active), KC->MBON synapses in ~15
  compartments, dopaminergic neurons (DANs: PAM = reward, PPL1 = punishment)
  that gate depression of KC->MBON synapses. Every number on the page comes
  from data/facts.js with a source id; a fact-check agent checks it.
- Anything modelled or illustrative is labelled "model" or "illustrative".
- Reported win rates are measured by our own code (train/eval), never
  invented. Store the measured numbers with the command that made them.

## IP rules (load-bearing)

- "Magic: The Gathering" is a Wizards of the Coast trademark. The game here
  is our own: own card names, own text, own procedural card art, own symbols
  for mana (no WotC mana symbols, no WotC card frame, no WotC card names, no
  set symbols). The page may name Magic: The Gathering only in plain text,
  to describe the inspiration, with the line "Not affiliated with or endorsed
  by Wizards of the Coast." The page title and nav label do not contain the
  trademark.
- Connectome data: prefer the hemibrain v1.2.1 (Janelia, CC BY 4.0) or the
  FlyWire public release only if its licence allows redistribution of the
  derived subset we ship. Record the licence text source, URL, date read and
  the exact release in CREDITS.md. If the licence is NC, we may still ship
  it (the site is free, non-commercial) but say so in CREDITS.md and on the
  page. No code copied from any repo with an incompatible licence.

## Environment rules

- Static ES-module site, no build step, no npm deps. Plain JS, 2D canvas or
  WebGL2 (no WebGPU needed). Workers are module workers.
- NO headless Chrome, Playwright, CDP, screenshots or recordings (user ban).
  Validate with: `node --check`, node ESM import, node tests, TypeScript
  checkJs if useful (/usr/local/lib/node_modules/openclaw/node_modules/typescript).
  `node --input-type=module -e "import('./main.js')"` in the page dir: a
  ReferenceError on a browser global is fine, a SyntaxError is a bug.
- Other sessions commit to main at the same time. Commit by pathspec in ONE
  bash command: `git add <your paths> && git commit -m ... -- <your paths>`.
  Run `git diff --cached --name-only` first; never commit a path that is not
  yours. Never amend, rebase, stash, reset or checkout other files.
- Never `pkill` broadly. Kill only your own pid. Delete large scratch files
  (connectome downloads) when done. Disk has ~39 GB free; stay under 3 GB.
- Never send the user's email in any request (User-Agent or payload).
- Comments and commit bodies follow the ASD-STE100 rules in CLAUDE.md.
  Commit subject scope: `fly-duel:`.

## Module map and APIs

All modules are pure ES modules unless marked DOM. Deterministic given a
seed. RNG: `data/rng.js` exports `mulberry32(seed) -> () => float in [0,1)`
and `hashSeed(str) -> uint32` (package A writes it; others import it).

### Package A: game/ (rules engine)  — owner: game agent

- `game/cards.js`: `CARDS` — array of card definitions, ~30 original cards,
  two colours ("Amber" = aggressive, "Moss" = growth/control) + colourless.
  Card: `{ id, name, colour, cost: {generic, amber, moss}, type:
  'land'|'creature'|'spell', power?, toughness?, keywords?: ['swift'
  (haste), 'wings' (flying), 'guard' (vigilance-like: can block after
  attacking? keep simple: 'wings','swift','sting' (deathtouch),'thick'
  (+toughness/defender)], effect?: {kind, amount, target}, text, flavour }`.
  Effects kinds kept small: 'damage' (any target), 'draw', 'pump' (+n/+n
  this turn), 'heal', 'destroy' (creature with power <= n), 'token'.
  `DECKS`: two 40-card decks `amber` and `moss` (17 lands each) plus
  `buildDeck(name, rng)`.
- `game/rules.js`:
  - `newGame({ seed, decks: ['amber','moss'], first: 0|1 }) -> State`
  - `legalActions(state) -> Action[]` for the player to act (`state.toAct`)
  - `step(state, action) -> State` (pure: returns a new state; never mutates)
  - `isOver(state) -> null | { winner: 0|1|-1, reason }`
  - `clone(state)`, `describe(action, state) -> string` (log line)
  - Turn structure, simplified: untap, draw (not on turn 1 for first
    player), main (play at most one land, cast spells/creatures by paying
    mana from untapped lands, auto-tap), declare attackers (one action that
    lists attacking creature ids), defender declares blocks (one action:
    map attacker -> blocker id or none), damage, second main omitted, end
    (hand size 7 discard lowest-cost). Life 20. Draw from empty library
    loses. Turn cap 60 -> draw (winner -1).
  - Decisions are split into small actions so the fly chooses among a
    short list: `{ type: 'land'|'cast'|'attack'|'block'|'pass', ... }`.
    Attack and block are chosen as whole assignments; to keep the list
    short, legalActions enumerates at most 16 attack subsets and at most 16
    block assignments (greedy-seeded, deterministic order) and always
    includes the empty one.
  - State is plain JSON (structuredClone safe), with `players[i] = { life,
    library: id[], hand: id[], battlefield: Permanent[], graveyard: id[],
    landPlayed }`, `turn`, `active`, `phase`, `toAct`, `log: string[]`
    (bounded to last 200 lines), `rngState`.
- `game/features.js`: `features(state, me) -> Float32Array(F)` with F = 48
  fixed named features (export `FEATURE_NAMES`), all scaled to ~[0,1]: life
  me/opp, cards in hand, lands, untapped mana by colour, creature count,
  total power/toughness on each side, biggest creature, flyers, evasive
  damage potential, turn, library size, threat counts and so on. This is the
  fly's "smell" of the board. Also `actionFeatures(state, action, me)` is
  NOT needed: the brain scores afterstates (features of step(state, a)).
- `game/bots.js`: `randomBot(rng)`, `greedyBot()` (simple heuristic: play
  land, cast biggest affordable, attack when profitable, block to survive).
  Both `(state, legal) -> action`.
- Tests: `tests/game.test.mjs` (rules: mana, combat, keywords, death,
  turn cap, determinism by seed, no mutation, 2000 random games finish,
  legalActions never empty while not over).

### Package B: data/ (connectome + facts)  — owner: data agent

- `tools/build-connectome.mjs` (or .py, run with `python3 -I`): downloads
  the real data, extracts the MB circuit of one hemisphere, writes
  `data/connectome.json`. Sources to try in order: hemibrain v1.2.1 public
  compact exports (neuprint-free downloads from Janelia / Google Cloud
  bucket listed on https://www.janelia.org/project-team/flyem/hemibrain),
  then FlyWire public Zenodo/Codex exports. Keep download scratch in the
  session scratchpad, delete it when done.
- `data/connectome.json` (target < 1.5 MB, gzip-friendly arrays):
  ```
  { meta: { source, release, licence, url, retrieved, notes },
    pn:  { n, types: [glomerulus], pos: [[x,y,z]...] },      // uniglomerular PNs
    kc:  { n, types: ['KCab'|'KCa'b''|'KCg'...], pos },
    mbon:{ n, types: [name], compartment: [name], valence: [+1|-1|0], pos },
    dan: { n, types: [name], cluster: ['PAM'|'PPL1'|...], compartment: [name], pos },
    apl: { n: 1 },
    edges: { pn_kc: [[pnIdx, kcIdx, weight]...],
             kc_mbon: [[kcIdx, mbonIdx, weight]...],
             dan_mbon_compartment: [[danIdx, mbonIdx]]  // which DAN gates which KC->MBON
           } }
  ```
  Positions in micrometres (hemibrain voxel 8 nm), centroid or soma. If the
  real download fails after honest effort, write the file from published
  cell-type counts with sampled wiring and set `meta.synthetic = true` and
  say so in notes; the page must then say "wiring sampled from published
  statistics" instead of "wiring from the connectome". Report which one.
- `data/facts.js`: `FACTS` (id -> { value, unit, text, src }) and
  `SOURCES` (id -> { cite, doi, url }). DOI-checked (resolve each via
  doi.org or Crossref). Include at least: Scheffer 2020 hemibrain, Li 2020
  MB connectome (eLife), Dorkenwald 2024 FlyWire, Schlegel 2024, Aso 2014
  MB compartments, Hige 2015 plasticity, Litwin-Kumar 2017 KC coding,
  Cohn 2015, Shiu 2024 whole-brain model, Lin 2014 APL sparse coding,
  Eschbach 2020 (larva RL in MB) if relevant. Also "Not affiliated with or
  endorsed by Wizards of the Coast" disclaimer text constant.
- `CREDITS.md` at page root: data licence, release, URL, date.
- `data/rng.js` is package A's, not B's.
- Tests: `tests/data.test.mjs` (shape, index bounds, counts within the
  published ranges, every FACT source resolves, positions finite).

### Package C: brain/ (the fly model)  — owner: brain agent

- `brain/mb.js`: `class MushroomBody { constructor(connectome, { seed,
  hemisphere: 'A'|'B', sparsity: 0.05 }) ; encode(features) -> pnRates
  (Float32Array pn.n); kcActivity(pnRates) -> Uint16Array activeKcIdx (APL
  as k-winners or adaptive threshold, ~5%); mbonOut(activeKc) ->
  Float32Array mbon.n ; value(features) -> number  (sum valence * MBON
  rate, the approach-minus-avoid drive); learn(activeKc, danSignal per
  compartment, lr) ; toJSON() / static fromJSON(connectome, json) }`.
  Feature -> PN mapping: each of the 48 features drives a fixed random set of
  glomeruli channels (population code with tuning curves, so values map to
  odour-like patterns). Doc this mapping clearly.
  Plasticity: three-factor rule. KC->MBON weight w_ij changes by
  -lr * DAN_c(j) * eligibility_i, where eligibility is a decaying KC trace,
  and the DAN signal is the TD error delta = r + gamma V(s') - V(s), sent as
  PAM (delta > 0) to approach-side compartments and PPL1 (delta < 0) to
  avoidance-side compartments, which by depression shifts MBON balance.
  Clamp weights [0, wmax]. Note the sign convention in comments and tests.
- `brain/fly.js`: `class Fly { constructor(connectome, opts); choose(state,
  legal, { explore, rng }) -> { action, values, trace } ` scoring each
  afterstate `step(state, a)` with mb.value(features(after, me)), softmax at
  temperature; `observe(prevState, state, reward, done)` does the TD update.
  `trace` holds the PN, KC and MBON activity of the chosen afterstate for
  the brain view.
- Each fly gets its own MB: Fly A and Fly B differ by wiring seed (KC claw
  resampling is NOT allowed if the real pn_kc edges exist: then A uses the
  real wiring, B uses the same real wiring but its own learned weights and
  feature->glomerulus map seed. Say which on the page.)
- Tests: `tests/brain.test.mjs` (sparsity within band, determinism, learn
  moves value toward target on a fixed input, weights stay in bounds, JSON
  round trip, a toy two-armed task learned in < 500 trials).

### Package D: train/ (self-play, eval, pretrained weights)  — owner: train agent

- `train/selfplay.js` (pure): `playGame(flyA, flyB, { seed, learn, explore
  }) -> { winner, turns, log, frames? }`; `evaluate(fly, opponent, n, seed)
  -> { wins, losses, draws }`.
- `train/worker.js` (module worker): messages `{cmd:'init', connectome,
  weights?}`, `{cmd:'train', games}`, `{cmd:'pause'}`, `{cmd:'eval', n}`,
  posts `{type:'progress', game, winRateA, vsRandom, vsGreedy, ...}` and
  `{type:'weights', A, B}`.
- `tools/train.mjs`: offline pretraining in node (fixed seed), writes
  `data/pretrained.json` (both flies' weights, < 2 MB) and
  `data/training-curve.json` (per checkpoint: games, win rate of each fly
  vs randomBot and vs greedyBot over 200 eval games, A vs B). Record the
  exact command, seed and wall time in the file meta. Run it for real; aim
  for flies that beat randomBot clearly. Report the true numbers whatever
  they are. Curriculum allowed (vs random, then vs greedy, then self-play).
- Tests: `tests/train.test.mjs` (a short run is deterministic, learning
  improves vs random over a small fixed budget on average across 3 seeds,
  pretrained.json loads and beats random over 100 games at p < 0.05 by a
  binomial test, worker message protocol via a fake postMessage).

### Package E: page (DOM)  — owner: page agent

- `index.html`, `style.css`, `main.js`, `ui/board.js` (card + table
  canvas or DOM render; procedural card art: each card gets its own
  generated insect/plant glyph art from its id; own mana glyphs),
  `ui/brain.js` (brain view: 3D-ish point cloud of PN/KC/MBON/DAN from
  connectome positions, projected on 2D canvas or WebGL2, active KCs light
  up per decision, DAN bursts flash compartments, MBON bars), `ui/charts.js`
  (training curves), `ui/explain.js` if needed.
- Head order as mrna-vaccine: gpu-guard, wishlist, stats-beacon, then CSS.
  `[hidden]{display:none!important}` in style.css. Header comment with
  layout map and GREP MAP like pages/mrna-vaccine/index.html.
- Sections: hero (live match on load, from pretrained weights, autoplay),
  01 the game (rules in short, the deck lists, cards), 02 the fly's
  learning centre (MB anatomy, real counts from facts), 03 smell of a board
  (features -> glomeruli encoding), 04 sparse code (KC, APL), 05 dopamine
  teaches (three-factor rule, TD error, interactive), 06 train them
  yourself (worker: start/pause, speed, curves live, reset to naive,
  load pretrained), 07 watch a match (step through, see both brains, each
  candidate action with its value), 08 how good are they (measured eval
  table from training-curve.json, honest about limits), 09 what this is
  not (not a real fly, not the whole brain, why the MB; whole-brain models
  exist (Shiu 2024) but are not trained), sources + credits + disclaimer.
- Mobile first: works at 390 px; controls 44 px on (pointer:coarse); board
  stacks vertically on phones. Follow the dock/sheet idea only if a
  section needs it. Dark page, match site style (read mrna-vaccine/style.css
  and ../../lib/sci.css).
- One rAF loop; only visible canvases draw. No work while hidden.
- Until packages A-D land, code against this contract; import their
  modules by the paths above.

### Package F: saver.js  — owner: saver agent (phase 2)

- Installs `window.snSaver = { enter(opts), exit }` per lib/screensaver.js
  (read it; opts { calm, seconds, caption, seed }; returns { canvas,
  warmupMs }). A data-driven director: plays real matches between the
  pretrained flies, shots cut every 5-12 s on events (lethal attack, big
  block, spell, brain burst), seeded shuffle that varies per run, subject
  framed with plateBand from ../../lib/saver-clear.js, plate with live
  numbers (life totals, turn, KC sparsity). No code extract on the plate.
  Canvas returned must be in the document. Page loop pauses while the
  saver runs.

### Package G: fact-check and review  — phase 3

- Check every number and claim on the page against SOURCES (open the DOI
  or abstract). Check IP rules. Check the [hidden] rule, the link check
  of main.js, all tests. Fix what is wrong, commit per fix.

## Tests runner

`tests.mjs` at page root runs every `tests/*.test.mjs` file (coordinator
writes it). Each package owns its own test file only.

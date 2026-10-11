# Fly Duel: GUI design spec (binding)

User request (2026-10-11, verbatim): "make sure we have an amazing GUI to go
with this". The first request was "i want you to train a fruit fly brain
(two of them) to play magic the gathering against one another i need a page
for this under the research section please do not hold back dispatch the
swarm".

This file is the visual and interaction spec. CONTRACT.md stays the spec
for the science, the honesty rules and the IP rules. If the two disagree,
CONTRACT.md wins on content and this file wins on look and behaviour.

The spec is written on top of the page that exists at commit 9dc0004f:
`index.html` (sections s0 to s9, refs), `style.css`, `main.js`, `ui/art.js`,
`ui/board.js`, `ui/brain.js`, `ui/charts.js`, `ui/explain.js`,
`ui/match.js`. Keep the element ids that main.js binds to. Where this file
says "change", the present code does something else.

Engine: plain ES modules, 2D canvas, SVG strings and DOM. No WebGL is
needed (the largest cloud is about 2400 points). No library, no new font.

## 0. Design rules (load-bearing)

1. **Crisp, not soft.** Hard edges and 1 px hairlines. No `shadowBlur`, no
   `filter: blur`, no glow `box-shadow`, no `text-shadow`, no radial
   gradient backgrounds, no scanlines, no grain. A ring is a 1 px or 2 px
   stroke, not a halo. `box-shadow` is allowed only as a hard ring
   (`0 0 0 Npx colour`, no blur radius).
2. **Motion comes from data.** A thing moves only because the game state,
   the brain trace or the trainer changed. No idle pulse, no breathing, no
   idle auto-rotation, no shimmer skeletons, no random jitter.
3. **Legible over real.** Make what matters large and in strong colour:
   the active Kenyon cells, the dopamine burst, the chosen move, the
   attacking creature, the life loss. Everything else steps back to
   `--dim` or `--faint`.
4. **One colour, one meaning.** A colour token has one meaning in one
   context (table below). The fly identity colours never mean a card
   colour or a valence.
5. **Mobile first.** Design at 390 px first. 44 px targets on
   `(pointer:coarse)`. The match and the brain stay visible while a
   control is in use (dock and bottom sheet, section 7.4).
6. **Our own look.** No part of the card frame, the mana symbols, the card
   back or the tap symbol may look like Magic: The Gathering. See 3.6.
7. `[hidden]{display:none!important}` stays the first rule after `:root`.

## 1. Tokens

### 1.1 Colour

Put these on `:root` in `style.css`. `ui/brain.js COL`, `ui/charts.js
SERIES_COL` and `ui/art.js PALETTE` must use the same values (one source:
export `TOKENS` from a new `ui/tokens.js`, and keep style.css in step; a
node test compares them, see 8).

| Token | Value | Meaning | Where it may appear |
|---|---|---|---|
| `--bg` | `#05070c` | page | page |
| `--panel` | `#0b0e15` | card / panel fill | panels |
| `--panel2` | `#111623` | inset fill, rows | panels |
| `--fig` | `#03050a` | canvas fill (flat) | every canvas |
| `--ink` | `#eef0f5` | main text, focus ring | all |
| `--ink2` | `#c2c7d4` | body text | all |
| `--dim` | `#8a91a5` | labels, idle | all |
| `--faint` | `#394155` | grid lines, silent things | all |
| `--hair` | `rgba(255,255,255,0.10)` | 1 px dividers | all |
| `--hair2` | `rgba(255,255,255,0.22)` | 1 px control borders | all |
| `--flyA` | `#39d0f0` | Fly A (seat 0) | seat badges, brain frame, log prefix, curves, chosen move of A, attack arrows of A |
| `--flyB` | `#f26ad6` | Fly B (seat 1) | same, for B |
| `--flyA-ink` | `#04161c` | text on a `--flyA` fill | chips |
| `--flyB-ink` | `#1c0618` | text on a `--flyB` fill | chips |
| `--amber` | `#ffb347` | Amber cards and amber mana | cards, glyphs, deck lists only |
| `--moss` | `#a8d65a` | Moss cards and moss mana (change from `#86dc7c`) | cards, glyphs, deck lists only |
| `--none` | `#a9b4c8` | colourless cards, generic mana | cards, glyphs only |
| `--pn` | `#9d8cff` | projection neuron rate (change from `#62c4ff`) | brain view, s3 |
| `--kc-off` | `#2b3142` | silent Kenyon cell | brain view, s4 |
| `--kc-on` | `#fffbe6` | active Kenyon cell | brain view, s4, s5 |
| `--app` | `#3ee89a` | approach MBON, PAM burst, positive TD error | brain view, s5, value bars only |
| `--avoid` | `#ff4d4d` | avoid MBON, PPL1 burst, negative TD error | brain view, s5, value bars only |
| `--dmg` | `#ff4d4d` | life loss, damage number, lethal mark | table only |
| `--heal` | `#3ee89a` | life gain | table only |
| `--acc` | `#eef0f5` | UI accent (chips, toggles on) | chrome |

Why these values. Fly A was the amber of its deck and Fly B the green of
its deck, and the approach colour was the same green as Moss. The eval
rotates decks across seats, so a seat colour that equals a deck colour
says a wrong thing. The values above were checked in node at design time:
every pair of `--flyA --flyB --amber --moss --pn --app --avoid --kc-on`
is at least ΔE76 = 39 apart (lowest: `--moss`/`--app` 39.4, which never
share a context; `--flyB`/`--pn` 40.3, which differ by shape too). On
`--panel`, contrast is `--ink` 16.9, `--ink2` 11.4, `--dim` 6.1, `--flyA`
10.5, `--flyB` 7.2, `--avoid` 5.9.

The UI accent changes from amber to `--ink` white. An "on" toggle is a
white fill with `--bg` text. This removes the last amber outside cards.

Seat is never shown by colour only: every seat mark also carries the
letter A or B, and Fly B always sits at the top of the table.

### 1.2 Type

From `../../lib/sci.css` only: `--sci-serif` (STIX Two Text) for h1, h2,
the lede and big numbers in stat tiles; `--sci-sans` (Inter) for all UI
and body; `--sci-mono` (system mono) for numbers that change (life, mana
counts, values, rates, seeds) and the move log. Never Playfair Display,
Cormorant or JetBrains Mono (grep check in 8).

| Role | Font | Size desktop / phone | Weight |
|---|---|---|---|
| h1 | serif | `clamp(1.7rem,4.2vw,2.7rem)` | 400 |
| h2 | serif | 1.65rem / 1.35rem | 400 |
| h3, panel title | sans | 0.98rem | 500 |
| body | sans | 14px / 14px | 400 |
| label, tag, legend | sans | 12px / 12px (min 11px anywhere) | 400-500 |
| life total | mono | 28px / 24px | 600 |
| damage number | mono | 20px / 18px | 700 |
| value readout | mono | 12px | 500 |
| card name (full / mini) | sans | 12px / 10px | 600 |

Use `font-variant-numeric: tabular-nums` on every changing number so it
does not shift its neighbours.

### 1.3 Space, shape, lines

- Grid unit 4 px. Gaps: 4, 8, 12, 16, 24. Section top padding 56 px
  desktop, 40 px phone.
- Radius: panels 10 px, controls 8 px, chips 999 px, cards see 3.1.
  Canvases 8 px.
- Lines: 1 px `--hair` for dividers, 1 px `--hair2` for control borders,
  2 px for state (acting seat, chosen move, focus).
- Change: `.fcard.hot` loses its `0 0 14px` glow. `.fig.brain` loses its
  radial gradient and uses `--fig`. `#chips` loses `backdrop-filter` and
  uses an opaque `--bg`.

### 1.4 Motion

Export `MOTION` from a new `ui/motion.js`. All values in ms. One easing:
`EASE = 'cubic-bezier(0.2,0,0,1)'` (fast start, hard stop). No bounce, no
overshoot, no fade on its own: opacity changes only together with a move,
or as a step.

| Key | ms | What |
|---|---|---|
| `beat` | 900 (speed 1), 1800 (slow), 300 (fast) | one decision in the hero |
| `think` | 0.55 × beat | the brain sequence before the table moves |
| `draw` | 220 | library to hand |
| `cast` | 200 | hand to battlefield |
| `tap` | 120 | tap or untap |
| `arrow` | 160 | an attack or block line draws from its source |
| `dmgRise` | 500 then hold 300 | damage number |
| `lifeFlash` | 240 | life badge fill to `--dmg` or `--heal`, then back |
| `death` | 120 mark + 160 collapse | creature dies |
| `burst` | 300 + 300 × min(1, abs(δ)) | DAN ring and dot size |
| `zoom` | 120 | card zoom in |
| `sheet` | 240 | bottom sheet open or close |

`prefers-reduced-motion: reduce` sets every key except `beat` to 0 and
`beat` to at least 1800. Then each state change is a cut. The damage
number stays still for 900 ms. Nothing moves along a path. (7.2)

## 2. Page structure

### 2.1 Order and rhythm

Keep the present order: hero `#s0`, then 01 to 09, then refs. Each
section has the same head: a mono number box, a serif h2, a short lede of
at most 3 sentences on a phone. The first panel of each section is its
figure (a canvas or the table), so a fast scroll sees a picture per
section. Text panels come after the figure. One hairline between
sections.

### 2.2 Section chips (`#chips`)

- Sticky under the topbar. Opaque `--bg`, 1 px `--hair` bottom border.
- A chip: mono number (`--dim`) and a label. Active chip: `--ink` fill,
  `--bg` text, number in `--bg` at 0.7 opacity. No transition other than
  the class swap.
- Active chip = the last section whose top is above 40% of the viewport
  height (IntersectionObserver, no scroll handler per frame). When the
  active chip changes, call `chip.scrollIntoView({ inline: 'nearest',
  block: 'nearest' })` on the chip bar only.
- Chip height 32 px, 44 px on coarse pointers. Phone: the bar scrolls
  sideways, labels shorten to the `data-short` attribute (for example
  "Train", "Watch").
- Two extra state dots on chips, both data-driven: chip 06 shows a 6 px
  `--ink` square while the trainer runs; chip 00 shows a 6 px square in
  the colour of the fly that acts in the hero.

### 2.3 Hero (`#s0`): the live match

The hero is the page. It shows one live match from the pretrained flies,
both brains, and one clear answer to "who is thinking now, and what did it
choose".

Parts:
- **Seat strips** (one per fly, part of the table, see 2.4).
- **Brain panels** `#heroBrainA` `#heroBrainB` (section 4).
- **Decision strip**, new element `#heroDecide`: the top 4 candidate moves
  of the last decision with value bars (4.6, compact form).
- **Status bar** `#heroStatus` plus controls `#heroPlay` `#heroSpeed`
  `#heroNew`.
- **Log** `#heroLog`, 4 lines.
- **Stat tiles** `#heroStats`, 5 tiles: KCs per fly, active share, games
  of pretraining, Fly A vs greedy (held-out, with the interval), turn of
  this game. Numbers come from the data files, never typed in.

Focus on the thinker. The acting fly (`state.toAct`) gets:
- its brain panel at full opacity with a 2 px top border in its fly
  colour and the caption "Fly A · choosing" in that colour;
- its seat strip on the table with a 3 px left bar in its fly colour;
- its row in the decision strip.
The other fly gets its brain panel at 0.5 opacity (KC points frozen at
its last decision, not cleared), the caption "Fly B · waiting" in
`--dim`, and no bar. The switch is a cut, not a cross-fade.

One beat (`MOTION.beat`), run by the hero ticker. Each step draws from
the decision record of `ui/match.js next()`:

| t (fraction of beat) | What changes | Data |
|---|---|---|
| 0.00 | focus moves to the actor | `rec.who` |
| 0.00-0.15 | PN points take their rates | `trace.pn` |
| 0.15-0.30 | active KCs light, APL count updates | `trace.kc`, `kActive`, `kcLive` |
| 0.30-0.45 | MBON compartment bars go to new heights | `trace.mbon`, `valence` |
| 0.45 | decision strip shows candidates; chosen row marks | `rec.scores`, `rec.idx`, `trace.probs` |
| 0.55-1.00 | table plays the action (draw, cast, arrows, damage, death) | `rec.before` → `rec.after` |
| 0.55 | DAN burst if abs(δ) > 0.02 | `rec.delta` or `trace.delta`, `trace.danCompartment` |

At a game end: hold the last board for 2.5 s with a result banner across
the midline ("Fly A wins · life 0" in the winner's colour, or "Draw ·
turn cap" in `--dim`), then reset. Under reduced motion the hold is 4 s.

Layouts (content width = viewport minus side padding):

| Width | Grid |
|---|---|
| ≥ 1100 px | `grid-template-columns: minmax(260px,1fr) minmax(520px,1.6fr) minmax(260px,1fr)`. Brain A left, Brain B right, as now. The decision strip sits under the table in the middle column. Brain panels are 100% of the column height, min 420 px. |
| 760-1099 px | table full width; decision strip under it; two brains side by side under that, 280 px tall. |
| < 760 px (design width 390) | status bar; table; decision strip as 4 compact rows; **one** brain panel 220 px tall with a two-button switch "A · B" in its top-right corner. The panel follows the actor by default. A tap on A or B pins that fly (the button gets a 2 px underline) until the next game or a second tap. Stat tiles 2 columns. Log hidden behind a "Log" toggle (aria-expanded). |

Phone hero controls go into the dock (7.4), not into the status bar.

### 2.4 Text

The honesty note stays under the hero, at full width, `--dim`, 12 px.
The trademark line stays in it. No text inside canvases except labels
and numbers.

## 3. The card

### 3.1 Frame (our own shape)

The frame is an **elytron**: a portrait plate with the two top corners
cut at 45° (chamfer = 10% of width) and the bottom corners rounded at
6 px. Build it with `clip-path: polygon(...)` on the card plus an inner
SVG stroke for the 1 px border (the clip cuts a CSS border). Aspect 5:7.

Zones, top to bottom (full card, 168 px wide):

| Zone | Height | Content |
|---|---|---|
| cost rail | left edge, 22 px wide, full art height | cost glyphs in a vertical column, top-down: generic, then amber, then moss |
| name band | 24 px | name, 12px/600 sans, left after the rail; colour bar 3 px at the top of the band in the card colour |
| art window | 10:7 of the width minus the rail | procedural art (3.4), 1 px `--hair2` inner frame |
| type line | 20 px | "Creature", "Spell" or "Land" in `--dim`; keyword icons right-aligned (3.3) |
| text box | rest | rules text 11px/1.35 `--ink2`; flavour in italic `--dim`, cut at 2 lines |
| stat plate | bottom left, 44 × 20 | power and toughness (3.2) |

The card fill is `--panel2`. The card colour shows only in the 3 px name
bar, the 1 px border and the art palette. No textured fill, no bevel.

Mini card (on the table): 64 × 88 px at 390 px width (56 × 78 below
360 px). Keep: art (64 × 40), name 10 px, one line, stat plate 30 × 16,
keyword icons 10 px in one row, the colour bar. Drop: rail (cost is not
needed on the battlefield), type line, text. Hand cards on the table use
the card back (3.6) for the opponent and the mini face for an open hand.

### 3.2 Power and toughness

The stat plate has two cells divided by a 1 px line: power left, with a
small mandible glyph (two inward hooks), toughness right, with a shell
arc glyph. Numbers mono 600. A changed value (pump this turn) shows in
`--ink` on a `--panel` fill with a 1 px `--ink` ring for the turn. Damage
marked on a creature shows as a red cell over the toughness cell
(`--dmg` fill, `--bg` text, "2/3" becomes toughness "3" with "−2" in the
red cell). No floating minus badge in the top-left corner (change from
`.fc-dmg`).

### 3.3 Keyword icons

16 px (10 px on minis), 1.5 px stroke, `currentColor`, square caps, no
fill except where stated. Each has `<title>` text and a long-press or
hover tooltip with the reminder text from `KEYWORD_TEXT`.

| Keyword | Icon |
|---|---|
| swift | two forward chevrons |
| wings | one wing outline with two vein lines |
| sting | a narrow triangle point with a filled drop at the tip |
| thick | three stacked horizontal plates |
| sap | a drop with a plus inside |

### 3.4 Procedural art (extend `ui/art.js`)

Line art only. Strokes 1.25 px at 1× (scale with the SVG, use
`vector-effect: non-scaling-stroke` on minis so lines stay 1 px). Fill
only flat shapes from `PALETTE[colour]`. One 2-stop linear sky is the
only gradient. Same id gives the same SVG string (hash of id).

The art must **encode the card**, so it reads at mini size:
- Creature: an insect seen from above. Body length grows with power
  (power 1 = 40% of the window, power 6+ = 80%). Carapace stroke weight
  and shell plates grow with toughness. `wings` adds 2 or 4 wing outlines
  with veins. `sting` adds a stinger at the tail end in `--kc-on`.
  `thick` adds a heavy shell outline (3 px). `swift` tilts the body 20°
  forward. `sap` adds a drop on the mandible. The seed picks leg angles,
  antenna curve, segment count (2-3) and pattern marks.
- Spell: a plant motif per effect kind. damage = thorn spray, draw = seed
  pod splitting, pump = bud opening, heal = broad leaf with veins,
  destroy = wilted stem, token = egg cluster. The amount sets the count
  of thorns, seeds, eggs and so on (capped at 6).
- Land: a horizon with a ridge (amber, with hexagon cells in the rock) or
  a hollow (moss, with leaf litter). The seed moves the horizon line.
- Data tag: the root `<svg>` carries `data-art="creature|spell|land"` and
  `data-k="wings sting ..."` so node tests can check that the art
  follows the card.

### 3.5 Mana glyphs (extend `ui/art.js manaGlyph`)

- amber: a flat-top hexagon (honeycomb cell) with a drop inside.
- moss: a leaf with a centre vein, point up.
- generic: a **rounded square** with the number in mono 600. Change from
  the grey disc: a grey disc with a number is the look of another game.
- No circle shape in any mana glyph (node test: no `<circle` in the
  glyph SVG of any kind).
- Untapped land = solid glyph. Tapped land = outline glyph at 0.45
  opacity, not rotated.

### 3.6 IP guard for the card

Do not use: a brown oval card back, a coloured gem or circle for mana, a
curved-arrow tap symbol, a set symbol on the type line, the "name top,
cost top-right, P/T box bottom-right" order, beveled frames.

Card back (library pile and hidden hand): `--panel2` fill, a 6 × 9
honeycomb grid of 1 px `--faint` hexagons, one fly wing outline in
`--dim` across the centre, the same chamfered shape. Count in mono on the
pile.

Tap state on the table: the card shifts down 6 px, its art goes to 0.45
opacity, and a 2 px diagonal hatch band crosses the art. No 90° turn (it
breaks the row grid on a phone) and no curved-arrow symbol.

### 3.7 Zoom

- Pointer with hover: after 150 ms over a card, show the full card at
  240 px wide in a fixed popover next to the pointer, kept inside the
  viewport with 8 px margin. It does not follow the pointer once shown.
  It closes on pointer leave.
- Touch: a tap on a card opens a bottom sheet with the full card at 280
  px wide (centred), the reminder text of each keyword in rows below
  (icon + word + text), and for a creature on the table its current
  state ("tapped", "summoning sick", "2 damage"). Tap outside or the
  close button (44 px) closes it. Esc closes it.
- Keyboard: cards on the table and in the gallery are focusable
  (`tabindex=0` on the gallery, roving tabindex on the table). Enter
  opens the zoom.
- The zoom never pauses the hero. The board under the sheet stays
  visible above it (sheet max height 62vh).

## 4. The table

### 4.1 Zones per seat

Fly B on top, Fly A at the bottom (as now). Each seat, from the outer
edge in:

1. **Seat strip** (48 px tall desktop, 44 px phone): seat badge (24 px
   square, fly colour fill, letter A or B in `--flyA-ink`/`--flyB-ink`,
   mono 700), name "Fly A" and deck name in `--dim`, **life** (mono 28 px,
   `--ink`, in a 1 px `--hair2` box, min width 56 px), **mana**: one glyph
   per land, solid if untapped, outline if tapped, plus a mono count
   "3/5", hand count with a small card-back icon, library count, graveyard
   count. On a phone, library and graveyard go into one mono line "lib 31
   · gy 4" in `--dim`.
2. **Hand row**: open minis (s7, both hands open) or card backs fanned
   with 12 px overlap (hero, hands hidden). Count in mono.
3. **Battlefield row**: creatures in uid order, wrapping. Lands are not
   cards on the table; they are only the mana glyphs in the strip.

Between the seats, the **midline** (28 px): turn number (mono), the six
phase steps as text chips "untap · draw · main · attack · block · end"
with the current one in `--ink` and the rest in `--faint`, and on the
right the last action text (`rec.text`) in the actor's fly colour. The
result banner (2.3) replaces the midline content at game end.

Life at 5 or less: the life box border goes 2 px `--dmg` and stays.

### 4.2 Attack and block

Draw on one SVG overlay over `.board` (`pointer-events:none`), new class
`.combat`. Positions come from the `data-uid` boxes after the render.

- Attack (on the `attack` action): from the top-centre of each attacker
  to the defender's life box. Line 2 px in the attacker's fly colour,
  solid, with an 8 px filled triangle head. The attacker card gets a 2 px
  ring in its fly colour and moves 8 px toward the midline.
- Block (on the `block` action): from the blocker to the attacker it
  blocks, 2 px dashed (6/4) in the defender's fly colour, ending in a
  flat 10 px bar. The attack line of a blocked attacker reroutes to stop
  at the blocker (cut, no tween).
- Unblocked hit: at damage, the attack line flashes to `--dmg` for
  `lifeFlash` ms, then all combat lines clear.
- The lines draw from source to target over `MOTION.arrow` with
  `stroke-dashoffset`. Under reduced motion they appear whole.
- At most 16 attackers are possible. Lines never cross a card name:
  anchor at the card top edge for the bottom seat and at the bottom edge
  for the top seat.

### 4.3 Damage, life, death

- Damage number: "−3" in mono 700 `--dmg`, centred on the target (card or
  life box), rises 12 px over `dmgRise`, holds 300 ms, then is removed
  (a cut). Life gain: "+2" in `--heal` the same way.
- Life box: the number swaps at once; the box fill flashes `--dmg` (loss)
  or `--heal` (gain) for `lifeFlash` ms with `--bg` text.
- Death: a 2 px `--dmg` X across the card for 120 ms, then the card
  collapses to zero height from its bottom edge over 160 ms, then the
  row closes the gap (FLIP, `cast` ms). The graveyard count increments in
  the same frame as the collapse ends.

### 4.4 Draw and cast

Use FLIP on `data-uid` (and on hand slot index for hidden hands): read the
old box of each card, render the new state with `renderBoard`, read the
new box, and animate `transform` from old to new over the given time.
- Draw: the new hand card starts at the library count chip. `draw` ms.
- Cast: the card moves from its hand slot to its battlefield slot. `cast`
  ms. The mana glyphs used switch to outline in the same frame the card
  starts to move.
- Spell: the spell card flies to the midline, holds 300 ms at 1.3× scale
  with a 2 px ring in the caster's colour, then its effect plays (damage
  number, draw, and so on) and the card collapses into the graveyard
  count.
- New creatures carry "sick" state: a 1 px dashed border until the next
  untap. No desaturate filter (change from `.fcard.sick`).

### 4.5 Read at a glance (acceptance)

At 390 px, a person who sees one frame must be able to say: whose move it
is (badge, bar, brain caption), both life totals, who attacks whom
(arrows), what was just done (midline text), and which move the fly
chose and how sure it was (decision strip). Check this by a node DOM
string test on `renderBoard` output (8).

### 4.6 Phone table (design width 390, content 362)

- Seat strip: one row: badge, life, mana glyphs (14 px), "3/5", hand
  count. Second line only if needed: lib and gy in 11 px mono.
- Battlefield: minis 64 px wide, gap 4 px, 5 per row
  (5 × 64 + 4 × 4 = 336 ≤ 350). Wrap, never scroll sideways.
- Hand: hidden hands are one card back with a count; open hands wrap at
  52 px wide minis.
- Midline: phase chips collapse to the current phase only, plus turn.
- Board min height 360 px so the table does not jump when creatures
  arrive.

## 5. The brain view (`ui/brain.js`)

### 5.1 Points

Positions: `cen` or `pos` from `data/connectome.json` as now, with the
present radial pull toward the KC cloud. Draw with `fillRect` only
(crisp squares), at whole device pixels. No arcs for the point cloud, no
alpha below 0.25 except for silent KCs.

| Kind | Count (file now) | Silent | Active |
|---|---|---|---|
| PN | 108 | 2 px diamond `--faint` | 3 px diamond `--pn`, alpha in 4 steps by rate (0.25, 0.5, 0.75, 1) |
| KC | 1927 | 1.5 px square `--kc-off` | 3 px square `--kc-on` with a 1 px ring in the fly colour |
| MBON | 48 | 4 px square, `--app` / `--avoid` / `--none` by valence, alpha 0.4 | alpha 1, size 4 + 4 × rate |
| DAN | 312 | 1.5 px square `--faint` | in a burst: 3 px, `--app` (PAM) or `--avoid` (PPL1) |

KC subtypes (αβ, α′β′, γ) are not coloured in the hero (one meaning per
colour). Section 02 has a legend toggle "colour by KC type" that uses
`--m2`, `--m4`, `--m5` from sci.css.

Depth: draw far to near. Points behind the centre plane get 0.6× alpha.
No fog, no blur.

### 5.2 Per-decision lighting

On each decision of this fly (`setTrace`):
- the active KC set swaps at once (a cut) and stays until the next
  decision of the same fly;
- KCs that were active last time and are active again get the full ring;
  newly active ones get the ring plus a 1-frame `--ink` fill, so a
  person can see the code change;
- the readout under the canvas updates: "96 of 1927 KCs active (5.0%)".

### 5.3 APL inhibition

APL is one neuron that feeds back on all KCs. Show it as data, not a
glow:
- a 1 px `--dim` outline around the KC cloud (convex hull of projected
  KC points, recomputed on orbit), labelled "APL" at its top-right;
- a **k-winners meter** under the canvas: a 120 × 10 px bar of all live
  KCs (`kcLive`), the active part (`kActive`) in `--kc-on`, the rest in
  `--kc-off`, with a tick at the target share from facts (`kcSparseness`).
- If the trace gains a `kcDrive` array (optional, package C), the meter
  becomes a 40-bin histogram of KC drive with the APL threshold as a
  vertical 1 px `--ink` line and the bins above it in `--kc-on`. Code for
  both; use the histogram when the field exists.

### 5.4 DAN burst

When abs(δ) > 0.02 for this fly's decision:
- For each compartment c with `danCompartment[c] != 0`: its DAN points
  draw active for `burst` ms; one 1 px ring grows from 0 to 24 px radius
  at the compartment centroid over `burst` ms, colour `--app` if δ > 0
  (PAM) or `--avoid` if δ < 0 (PPL1), then is removed. Ring stroke
  1 + 2 × min(1, abs(δ)) px.
- The δ readout in the panel corner shows "δ +0.31" in the same colour,
  mono, held until the next decision.
- A label "PAM" or "PPL1" sits by the largest burst compartment for the
  burst time.
In the show, learning is off. The caption says "dopamine signal the
model computes (learning off)". In s6 with learning on, the same burst
draws.

### 5.5 MBON valence bars

Under the cloud, a 64 px band (48 px on a phone): one column per
compartment (16 in the file now), labelled with the compartment name in
10 px under it on desktop, every second name on a phone. Each column is
split at a centre baseline: approach MBON rate summed goes up in `--app`,
avoid goes down in `--avoid`. Bars have hard tops. On a new trace the
bars move to the new heights over `think × 0.15` (one tween), or cut
under reduced motion. At the right end, the value V of the chosen board
as a mono number and a 1-column bar in the fly colour.

### 5.6 Orbit and frame

- Start view: a fixed oblique view (yaw 0.6 rad, pitch 0.25 rad) that
  shows the calyx, the peduncle and the lobes apart. No idle rotation.
- Drag (pointer) turns yaw and pitch; pitch clamped to ±1.0 rad. Release
  stops at once (no inertia). Double-click or double-tap resets to the
  start view. `touch-action: pan-y` stays, so a vertical swipe scrolls
  the page and a sideways drag turns the brain.
- Keyboard on a focused brain canvas: arrows turn by 0.1 rad, Home
  resets.
- Region labels "PN", "KC calyx", "lobes", "MBON", "DAN" in 11 px `--dim`
  at fixed screen offsets from the projected centroids of each group,
  with a 1 px leader line. Hidden below 260 px canvas width.
- Frame: 1 px `--hair2`; acting: 2 px top border in fly colour, caption
  "Fly A · choosing"; waiting: canvas at 0.5 opacity, caption in `--dim`.

### 5.7 The decision panel (`#wCands` in s7, `#heroDecide` in the hero)

One row per legal move, sorted by score, highest first.

| Column | Content |
|---|---|
| rank | mono, `--dim` |
| move | `rules.describe(action)`, sans 12 px, one line, ellipsis |
| value bar | diverging bar from a centre zero: right for a positive score, left for a negative one, in the actor's fly colour; scale = max abs score of this decision |
| number | score, mono 12 px, signed, 2 decimals |
| p | softmax probability from `trace.probs` if present, mono `--dim` |
| marks | "after block" icon (a flat bar) if the score is the imagined worst-block value; "explored" tag if the chosen move is not rank 1 |

Chosen row: 2 px border and a 4 px left bar in the fly colour, move text
in `--ink`, a "played" tag (fly colour fill, fly ink text). Other rows:
`--panel2`, 1 px `--hair`. The hero shows the top 4 rows plus "+n more"
(plain text, not a link).
s7 shows all rows, max height 430 px desktop, 300 px phone, scroll inside.
For a bot, the panel says "greedy bot: no values" in `--dim`.

## 6. Training dashboard (s6) and results (s8)

### 6.1 Controls

Primary: Start / Pause (one toggle `#trainStart`, label swaps; keep
`#trainPause` as an alias hidden on a phone), speed segment `#trainSpeed`
(10, 50, 200 games per batch), Reset to naive, Load pretrained, Evaluate.
Reset to naive asks for no confirm, but the button says "Reset to naive
(drops this run)". While the worker runs, Load and Reset are enabled and
stop the run first.

### 6.2 Tiles

A row of 6 tiles over the charts, mono numbers, update at most 4 times a
second: games played, games per second (EMA over 2 s), Fly A recent win
share, Fly B recent win share, last eval vs random (A / B), last eval vs
greedy (A / B). A tile with no data shows "—" and the reason on hover.
Desktop 6 columns, phone 2 columns × 3 rows.

### 6.3 Curves

Three small multiples, same x axis (games), each 150 px tall (120 px on a
phone), stacked, so each reads at 390 px:
1. vs random bot, 2. vs greedy bot, 3. Fly A vs Fly B.
In each, Fly A in `--flyA`, Fly B in `--flyB`, 2 px lines, square joins.
A dashed 1 px `--faint` line at 50%. Y axis 0-100% with ticks at 0, 50,
100 only. The last point gets a 4 px square and its value as a mono label
at the right edge. Eval points (from "Evaluate") draw as 5 px open
squares on the same axes, so a viewer can tell live training share from a
measured eval. New points append; the x axis rescales by whole steps
(nice numbers), not every frame.

### 6.4 Weights

A mirrored histogram of KC→MBON weights, 40 bins from 0 to `wmax`: Fly A
bars up in `--flyA`, Fly B bars down in `--flyB`, the naive start state
as a 1 px `--dim` outline on both sides. Under it, a heatmap per fly: 16
rows (compartments) × 48 columns (KCs sorted by type, then binned), cell
= mean weight, single-hue ramp from `--fig` to the fly colour in 6 steps
(stepped, not smooth). Request `{cmd:'weights'}` from the worker every 2 s
while running. On a phone, the heatmaps go into the bottom sheet (7.4)
and the histogram stays.

### 6.5 Results (s8)

The curve uses the same three small multiples from
`data/training-curve.json`. The held-out table keeps its columns. Rows
for Fly A and Fly B get the seat badge. A Wilson interval shows as a
1 px bar with end ticks inside each win-rate cell, on a 0-100% scale.

## 7. Explainers, interaction, states

### 7.1 Explainer canvases

All three share the brain view's tokens and rules (crisp, data-driven).

- **s3 encoding (`#glomCv`).** Left: 48 feature ticks as a column (name
  at 11 px, a value bar). Right: the 108 PN channels as a 12 × 9 grid of
  squares, fill `--pn` at 4 stepped alphas by rate. The selected feature
  draws 1 px `--pn` lines to its glomeruli. Inset (bottom-left, 120 × 60):
  the tuning curves of the selected feature's channels, with a 1 px
  `--ink` vertical line at the slider value. The slider and the inset
  line move together; nothing else moves.
- **s4 sparse code (`#sparseCv`).** KC grid of 1927 squares (44 columns).
  Board 1 only: `--m2`; board 2 only: `--m1`; both: `--kc-on`; silent:
  `--kc-off`. Right of the grid, two horizontal bars with numbers: PN
  cosine and KC Jaccard, so the drop from one to the other is the
  picture. The share slider moves the k-winners cut; the grid changes as
  a cut on input.
- **s5 three-factor rule (`#toyCv`).** 20 KCs in a row, 2 MBONs (approach,
  avoid), PAM and PPL1 dots. Synapse = a line whose width is the weight
  (1-6 px, stepped). Under each KC, its eligibility trace as a bar. A
  press of "Win" plays, in order, 200 ms each: the board's KCs fill
  `--kc-on`; their trace bars rise; PAM fires (ring, `--app`); the
  synapses of active KCs onto the avoid MBON step thinner; δ shows as a
  mono number. "Lose" does the same with PPL1 onto the approach MBON.
  The equation terms in the side panel use page classes that match the
  canvas: e_i `.t-kc` (`--kc-on`), DAN `.t-app` / `.t-avoid`, δ `.m5`
  from sci.css. The term and the canvas then share one colour.

### 7.2 Keyboard

Export `KEYS` from `ui/keys.js`. Keys work when focus is not in an
input, select or textarea, and no modifier is down (Cmd+Option+S belongs
to the site screensaver).

| Key | Action |
|---|---|
| Space | play or pause the match of the section in view (hero or s7) |
| ArrowRight / ArrowLeft | s7: next / back one decision (pauses auto) |
| N | new game (section in view) |
| 1 / 2 / 3 | speed slow / normal / fast |
| B | phone hero: switch the brain panel A / B |
| T | s6: start or pause training (only if s6 is in view) |
| Esc | close zoom, sheet or shortcut list |
| ? | show the shortcut list (a small dialog, `--panel`, 1 px border) |

"Section in view" = the active chip. Each key handler is idempotent and
announces the new state in a polite live region `#kbdLive`.

### 7.3 Focus, motion, contrast

- Focus: `:focus-visible { outline: 2px solid var(--ink); outline-offset:
  2px }` on buttons, chips, cards, canvases. Never remove an outline
  without this rule.
- Reduced motion: see 1.4. In addition: no FLIP moves (cut), no line
  draw-in, burst rings drawn at full size for the burst time, smooth
  scroll off (`scroll-behavior: auto`).
- `aria-pressed` on toggles, `aria-live="polite"` on `#heroStatus` only
  (not on the board, which changes too often), `role="img"` and a
  changing `aria-label` on canvases ("Fly A brain: 96 of 1927 KCs
  active, δ +0.31").

### 7.4 Phone dock and sheet (from pages/wave-membrane)

Below 760 px, one fixed dock at the bottom (`#dock`, height 64 px plus
`env(safe-area-inset-bottom)`, `--bg` fill, 1 px top `--hair`). The dock
shows the controls of the active section only:

| Active section | Dock (44-48 px buttons) | Sheet holds |
|---|---|---|
| s0 hero | Play/Pause, speed (3-seg), New game | log, stat tiles |
| s6 train | Start/Pause, speed, Eval, "More" | Reset, Load, heatmaps, worker info |
| s7 watch | Back, Next, Auto, "More" | match type, seed, New game |
| other | dock hidden | — |

The sheet opens above the dock to 46vh (grip tap: 80vh), with a grip
bar (`#sheetGrip` pattern), and closes on a drag down or Esc. The figure
of the section scrolls so it stays in view above the sheet (scroll by the
sheet height on open). `#doc` gets `padding-bottom: calc(var(--dock-h) +
16px)` while the dock shows. Hide the dock while the saver runs
(`html.sn-saver`). The dock buttons are the same elements' proxies: each
dock button calls `.click()` on the section's own control, so there is
one handler.

### 7.5 Loading and missing files

No spinner, no shimmer. Each panel keeps its final size while it loads
(fixed heights above) and shows one line of `--dim` text that names the
file and the reason:

| Missing | Panel shows |
|---|---|
| `game/rules.js` | board frame with seat strips at "—", text "The rules engine did not load: <error>." |
| `data/connectome.json` | brain frame, text "No wiring file (data/connectome.json)." Decision panel still works. |
| `data/pretrained.json` | seat badges get an outlined tag "untrained"; status says "Untrained flies: no pretrained weights." |
| `data/training-curve.json` | the three chart axes, empty, text "No measured curve shipped yet." |
| Worker not available | s6 controls disabled with `title` and a line "This browser cannot run a module worker." |
| `meta.synthetic` true | every wiring tag reads "wiring sampled from published statistics" in `--ink2`, with an outlined tag "synthetic". |

## 8. Implementation checklist, ordered by impact

Each item names its check. "node" = a test in `tests/page.test.mjs` (or a
new `tests/design.test.mjs`, owner the GUI agent). "grep" = a one-line
shell check. None needs a browser.

1. **Tokens and palette.** Add 1.1 tokens to style.css and
   `ui/tokens.js`; switch `COL`, `SERIES_COL`, `PALETTE` to them.
   node: parse `:root` in style.css, compare each token with
   `TOKENS`; compute WCAG contrast of `--ink2` and `--dim` on `--panel`
   (≥ 4.5) and of each fly colour on `--fig` (≥ 3); compute ΔE76 ≥ 35
   for every pair of `flyA flyB amber moss pn app avoid kc-on`.
2. **Crisp guard.** grep: `grep -nE 'shadowBlur|blur\(|text-shadow|radial-gradient' style.css ui/*.js main.js`
   gives no line; `grep -nE 'box-shadow:[^;]*[0-9]px [0-9]+px [1-9]'` gives
   no line (no blur radius).
3. **Fonts.** grep: `grep -rniE 'playfair|cormorant|jetbrains' .` gives no
   line; style.css uses only `var(--sci-*)` font stacks.
4. **Hero focus and beat.** `ui/motion.js` exports `MOTION`,
   `motionFor(reduced)`, and a pure `beatPlan(rec, speed)` that returns
   the timed steps of 2.3. node: steps are in order, inside the beat,
   reduced gives zero tweens; the actor is `rec.who`.
5. **Decision panel.** Pure `decisionRows(rec)` in a new
   `ui/decide.js`: sorted rows, chosen flag, explored flag, scale. node:
   rows sorted, exactly one chosen, explored true only when chosen rank
   > 1, bar widths in [0, 1].
6. **Table and combat.** `renderBoard` output carries `data-uid`,
   `data-seat`, life boxes with `data-life`, mana glyph counts. Pure
   `combatLines(state, action)` returns `[{ from, to, kind, seat }]`.
   node: attack gives one line per attacker to the defender's life,
   block reroutes, empty attack gives none; DOM string has both life
   totals and the acting seat class.
7. **Card frame and art.** node: `cardHTML` has the chamfer class, the
   rail only on full cards, the stat plate; `cardArt` is deterministic,
   `data-k` lists the card's keywords, wings cards contain wing paths,
   power changes the body size attribute; `manaGlyph` SVG for every kind
   has no `<circle`.
8. **Brain view.** Pure helpers in `ui/brain.js`: `pointStyle(kind,
   active, rate)` (sizes and colours of 5.1), `burstOf(trace)` (rings per
   compartment, colour by sign of δ, none below 0.02), `mbonBands(trace,
   connectome)` (16 columns, up = approach, down = avoid). node tests on
   each with a small fake trace.
9. **Phone layout.** grep: style.css has `@media (pointer:coarse)` with
   `min-height:44px`; has a `max-width:759px` block with the 5-per-row
   mini width (64px) and the single brain switch; `[hidden]{display:none!important}`
   present. node: compute 5 × 64 + 4 × 4 ≤ 362 − 2 × board padding.
10. **Dock and sheet.** index.html has `#dock`, `#sheet`, `#sheetGrip`;
    node: the dock map (exported `DOCK` in `ui/dock.js`) lists only ids
    that exist in index.html; each dock button proxies an existing
    control.
11. **Training dashboard.** `ui/charts.js` gets `smallMultiples(rows)`
    (3 panels, A and B series) and `weightHist(wA, wB, wmax, bins)`.
    node: bins sum to the weight count, 50% line present, eval points
    marked apart from live points.
12. **Keyboard.** `ui/keys.js` exports `KEYS`; node: no key needs a
    modifier, every action name maps to a function in main.js (grep the
    name), Esc and ? present.
13. **Explainers.** node: s3 `glomLinks(feature)` returns the glomeruli
    of that feature from the trace; s4 Jaccard < cosine on the shipped
    pair; s5 toy: Win lowers only the active KCs' weights onto the avoid
    MBON (the sign of the contract).
14. **Missing-file states.** node: run `main.js` helpers with each data
    file absent (fake fetch) and check the panel text names the file.
15. **Focus and ARIA.** grep: `:focus-visible` rule present;
    `aria-live` only on `#heroStatus` and `#kbdLive`.
16. **Final gate (static site build gate).** `node --check` on every
    .js; `node --input-type=module -e "import('./main.js')"` in the page
    dir gives no SyntaxError; `node tests.mjs` passes. No headless
    browser (user ban).

## 9. Out of scope

- No sound. No WebGL or WebGPU. No new fonts or libraries.
- No change to game rules, brain model, trainer or data files from the
  GUI work. If the GUI needs a new trace field (`kcDrive`, `probs`),
  ask the owner of package C; the GUI must work without it.
- No nav, saver catalog or thumbnail edits (coordinator).

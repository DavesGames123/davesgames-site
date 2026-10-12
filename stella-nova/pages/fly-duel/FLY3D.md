# Fly Duel 3D hero: binding spec

UPDATE 2026-10-11: the scene is now a convention hall, not a round table
(user: "it should definitely be done on a convention table not a proper
card table foldling table with mana mats and other flies nearby engaged
in fake other games"). ui/fly3d/hall.js builds a long folding table,
folding chairs, a playmat per fly, deck boxes, six other tables of flies
at their own games and a reacting crowd. Life shows on d20s (d20.js),
lands lie in one stack per colour, dice rolls are Dice Lab throws
(dice3d.js), and director.js has 11 shot kinds. Where this file still
says table, stools or five shots, the hall and director.js win.

UPDATE 2026-10-11 (layout pass): the live brain maps are now the two
big side panels of the page (ui/fly3d/brainpanels.js, one shared WebGL
renderer copied into two 2D canvases): brain A | table | brain B on a
wide screen, brain A over and brain B under the table on a portrait
phone. The small maps beside the flies and the big map of play mode in
the scene are off while the panels show (setBrains, setBigBrain); the
"in hall" brain control turns them back on. Where this file says the
maps float beside the flies, the panels win.

User words (2026-10-11, verbatim): "this visual design is horrible. I want to
see TWO THREE DIMENSIONAL FRUIT FLIES at a table HOLDING CARDS ANIMATEDLY
PLAYING THEM", then "showing me a live 3d map of their brain", then "they
don't play with mana?" (they do: 17 lands per deck, costs paid by tapping
lands; the old page hid it in two tiny glyphs).

The hero of the page (section 00) becomes one WebGL scene with three.js
r160 (import map exactly as other pages: "three":
"../../vendor/three@0.160.0/build/three.module.js", "three/addons/":
"../../vendor/three@0.160.0/examples/jsm/"). The scene shows two 3D fruit
flies at a table playing the real match (ui/match.js drives it; the scene
only animates the records). Next to or above each fly: a live 3D map of
that fly's brain.

## Look

- Crisp and well lit, not soft: no bloom, no blur, no fog haze, no
  decorative pulses. Light: key + rim + soft ambient (hemisphere), real
  shadows on the table (one shadow-casting light, PCF soft is fine).
  MeshStandardMaterial / MeshPhysicalMaterial. ACES tone mapping, sRGB.
- The flies are characters: Drosophila melanogaster anatomy, exaggerated
  for legibility (legible over real proportions): large brick-red compound
  eyes with a facet normal map or hex pattern, tan/ochre thorax with dark
  bristles (thin instanced cylinders), striped abdomen (dark bands), clear
  iridescent wings with veins (MeshPhysical, iridescence), segmented
  antennae with arista, proboscis, six legs with coxa/femur/tibia/tarsus
  segments. Fly A and fly B are told apart by a coloured collar/badge in
  the fly colours (--flyA cyan #39d0f0, --flyB magenta #f26ad6), not by
  recolouring the insect.
- The flies sit upright on stools at a small round wooden table, facing
  each other. The two front legs hold a fan of cards (their hand, real
  count). Middle legs rest on the table and tap lands. Hind legs on the
  stool.

## What moves (every motion comes from a match record)

- think: antennae twitch, head tilts toward the hand, the brain map fires.
- land: pick a card from the fan, lay it in the land row in front.
- mana: the fly touches each land it taps (the land turns a little and
  dims), a small crisp mana token in the land colour (Amber / Moss /
  generic grey square) travels to the card being cast. Untapped lands
  are bright. Mana must be easy to read at a glance.
- cast creature: the card leaves the fan, flips face up, lands in the
  creature row, the creature's art (ui/art.js card art, as a texture)
  is readable.
- cast spell: card held up, its effect plays (damage = a hard spark line
  to the target; heal; draw = a card flies from the deck to the fan).
- attack: the fly pushes the attacking creature cards forward toward the
  opponent; block: the defender slides a blocker in front; damage numbers
  pop as crisp sprites; dead creatures go to the graveyard pile.
- life: each fly has a life counter on the table (a dial or flip counter),
  wings droop as life falls, a fly at 5 or less shakes a little.
- win/lose: winner raises its front legs and buzzes its wings; loser slumps.
- idle: breathing (abdomen), grooming (front legs rub head) now and then.

## Live 3D brain map

- For each fly, its own mushroom body in 3D from its connectome file
  (data/connectome.json, later data/connectome-flywire.json for fly B):
  real positions (um), PN, KC, MBON, DAN, APL, plus the MB neuropil
  outline (calyx, lobes) as a crisp wireframe or edge mesh. If the
  hemibrain/FlyWire publish ROI meshes under the same licence, a builder
  may fetch, decimate and ship them (credit in CREDITS.md).
- Live: on each decision, the fly's trace lights the active PNs, then the
  active KCs, signals run along PN->KC and KC->MBON edges (thin lines that
  light in sequence), MBONs scale with their output, a DAN burst lights its
  compartment (green PAM reward / red PPL1 punishment). Orbit with the
  mouse/touch. A small inset or a full-screen toggle per fly.
- In the main scene, each fly's head shows its brain (small, inside a
  clear head capsule or as a floating map above the fly). Choose what reads
  best; say why.

## Modules (new files only, in ui/fly3d/)

- `fly.js`: `buildFly({ colour, seed }) -> { root: THREE.Group, rig, dispose }`.
  `rig` exposes named joints (head, antennae, wings, abdomen, legs[6] with
  segments) and poses. `animate(rig, clip, t)` and a small clip set:
  idle, think, groom, reach(target), place(target), tap(target), push,
  raiseArms, slump. Procedural geometry, our own; no downloaded model.
- `scene.js`: `createDuelScene(canvas, { connectomes, cards }) -> {
  play(record), setState(state), resize(), render(dt), dispose,
  setSpeed(s) }`. Table, stools, card meshes (card faces drawn by
  ui/art.js / board.js styles to CanvasTexture, our own frame), deck,
  graveyard, land rows, creature rows, hands. Camera director: wide shot,
  over-the-shoulder of the deciding fly, close-up on a cast card; calm
  orbit when idle; user can drag to orbit.
- `brain3d.js`: `createBrainMap(connectome, { colour }) -> { group,
  fire(trace, delta), update(dt), dispose }` for both the in-scene map and a
  standalone canvas view.
- `choreo.js` (pure, node-tested): maps a match record (ui/match.js) to a
  timed list of animation steps. tests/fly3d.test.mjs checks it.

## Rules

- Phones: the scene must run at 390 px wide (lower pixel ratio, fewer
  bristles, shadows off on coarse pointers). Pause when off screen.
  Respect prefers-reduced-motion (cut instead of move).
- No headless browser. Validate with node: node --check, the link check of
  main.js, a node three.js scene build (three runs in node without a
  renderer: build the scene graph, count meshes/triangles, check
  the choreography). You may write a tiny CPU rasterizer in the session
  scratchpad to render a mesh silhouette to PNG and look at it with the
  Read tool; keep images small and delete them after.
- Triangle budget: whole scene < 400k triangles desktop, < 150k phone.

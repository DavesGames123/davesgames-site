# Growth pages contract

Three pages share one DLA engine and one gradient picker. This file is the
binding spec for all three. Read it before you edit any of them.

User request (2026-10-17), verbatim:

> https://github.com/fogleman/dlaf make a page to credit and showcase this
> repo in animated formats and animatedly grow structures. I want two
> additional pages, one for growing simulated plants, and the other for
> growing simulated coral reefs.

> dispatch yourself a little swarm! would love heatmap gradient
> visualizations for when things are growing "choose a gradient" as it
> were much like our other color options

## Pages

| Key / folder | Label | Nav (coordinator registers) | Badge |
|---|---|---|---|
| `dlaf` | Diffusion-Limited Aggregation | Patterns & Chaos > Emergence | SIM |
| `plant-growth` | Plant Growth | Life Sciences > Growth (new group) | 3D |
| `coral-reef` | Coral Reef Growth | Life Sciences > Growth (new group) | 3D |

Each page agent owns only `stella-nova/pages/<folder>/`. The coordinator
owns `lib/nav-data.js`, `lib/screensaver-catalog.js`,
`pages/home/sectors.js`, the home thumbnails and `PAGES.md`. Do not edit
those files. Do not edit `lib/dla-engine.js` or `lib/growth-gradients.*`.
When the shared lib needs a change, put a copy or a wrapper in your page
folder and say so in your final report.

## Shared lib (committed in a74a23ed)

- `lib/dla-engine.js`: `createModel({ dim, seed, params, hooks, onAdd,
  maxSteps, user })`. The five dlaf parameters (`particleSpacing`,
  `attractionDistance`, `minMoveDistance`, `stubbornness`, `stickiness`)
  and the five dlaf hooks (`randomStartingPosition(m, out)`,
  `shouldReset(m, p)`, `shouldJoin(m, p, parent)`, `placeParticle(m, p,
  parent, out)`, `motionVector(m, p, out)`). `m.add(p, parent)`,
  `m.grow(n)`, `m.growFor(ms)`, `m.addParticle(trace)` (trace sees each
  walk step: kind 0 step, 1 push-back, 2 reset), `m.subtreeSizes()`,
  `m.toCSV()`, `m.pos`, `m.parent`, `m.depth`, `m.count`,
  `m.boundingRadius`, `m.random`. Speed on node 24: 2D 20k particles in
  about 1 s, 3D 20k in about 5 s. Grow in a time budget per frame
  (`growFor(6..10)`), or in a module worker of your own page.
- `lib/growth-gradients.js`: `GRADIENTS` (13 ids: inferno, magma,
  plasma, viridis, cividis, turbo, ember, ice, reef, forest, aurora,
  spectral, mono), `sample(id, t, rev)`, `lut(id, n, rev)` (RGBA bytes, a
  texture row), `cssGradient(id, rev)`, `mountGradientPicker(el, { value,
  reversed, ids, label, onChange(id, rev) })`.
  `lib/growth-gradients.css` styles it. Set `--gg-accent` and `--gg-dim`
  on the page.

## Heatmap gradients (all three pages)

- Each page has a "Choose a gradient" picker (mountGradientPicker) and a
  "Colour by" choice. Colour-by modes are per page, for example age
  (order of joining), depth (hops to the seed), distance from the seed,
  flow (subtree size), height, light.
- The heatmap must show growth while it happens. With colour by age,
  the newest particles are at the hot end, so the growth front glows and
  the colours move as the structure grows. A gradient change recolours
  the whole structure at once, with no regrow.
- Defaults: dlaf `inferno`, plant-growth `forest`, coral-reef `reef`.
  Plants and corals also keep a natural colour mode ("Natural"), next to
  the heatmap modes.

## Page rules (stella-nova/PAGES.md "How to add a page")

- Head order: `../../lib/gpu-guard.js`, `../../lib/wishlist.js`,
  `../../lib/stats-beacon.js`, then the viewport meta with
  `viewport-fit=cover`, a meta description, `style.css`,
  `../../lib/sci.css`, `../../lib/growth-gradients.css`.
- `<script>if(window!==window.top)document.documentElement.classList.add('in-frame')</script>`
  first in body. `html.in-frame` hides the page topbar.
- 3D: importmap for three r160 (`../../vendor/three@0.160.0/build/three.module.js`,
  addons at `../../vendor/three@0.160.0/examples/jsm/`).
- `style.css` has `[hidden]{display:none!important}`.
- Phones: the pattern of `pages/wave-membrane` (commit 71bfb1a): a dock
  with one-tap primary controls; the panel is a bottom sheet in portrait
  and a right drawer in landscape; a `(pointer:coarse)` block for 44px
  targets; frame the subject in the clear area (occlusion). Touch and
  pointer handlers for each drag, pinch zoom on 3D views.
- Screensaver hook: `window.snSaver = { enter(opts), exit() }`. `enter`
  gets `{ calm, seconds, caption, seed, label }` and returns
  `{ canvas, warmupMs }`. The canvas is in the document. Frame the
  subject with `plateBand(h)` from `lib/saver-clear.js`. Cut a seeded
  shuffle of shots every 5 to 12 s, each a new growth from a seed, so
  every run differs. Aim at the action (the growth front), calm and
  wide; test the framing math for 16:9 and 9:16. Call `opts.label(info)`
  with `{ title, sub, params, lines, tex, rules, code }` (see
  `lib/screensaver.js` near "The page names what is on screen"). The
  `code` field is a short real extract of the page's own source.
- Labels in sentence case. No emoji.

## Credit and licence

- dlaf is MIT, Copyright (C) 2019 Michael Fogleman,
  https://github.com/fogleman/dlaf. Every page that uses the engine shows
  a credit line with a link. The dlaf page has a full credit section and
  a `CREDITS.txt` with the MIT text. plant-growth and coral-reef add a
  `CREDITS.txt` that names the engine and any other source.
- Do not fetch from GitHub at run time. No network calls at all except
  same-origin files.
- Ideas from papers (Runions et al. 2007 space colonisation, Kaandorp
  accretive coral growth, and so on) are fine: cite them, write our own
  code.

## Validation (no browser on this machine)

Headless Chrome, Playwright, CDP and screenshots are banned. Validate
with node only:
- `node --check` on every JS file.
- `node --input-type=module -e "await import('file:///.../main.js')"`:
  a ReferenceError on a browser global is correct; a SyntaxError or a
  missing export is a bug.
- A `tests.mjs` in the page folder, run with `node tests.mjs`, that tests
  the DOM-free modules (growth, colour mapping, saver shot list and
  framing math). Keep sim and render code in DOM-free modules where you
  can, so the tests reach them.
- grep for elements with the `hidden` attribute that also have a CSS
  display rule.
- Say in commit bodies that browser checks did not run.

## Commits

- Work on `main`. Do not create branches.
- Other sessions commit to main at the same time. Stage and commit in one
  command by pathspec: `git add <your paths> && git commit -F msg.txt --
  <your paths>`. Never `git add -A`, `--amend`, rebase or stash. Before
  each commit, check `git diff --cached --name-only` and stop if a path
  is not yours.
- Several small commits, one per system (sim, render, ui, saver, tests).
  Subject `<folder>: imperative phrase`, under 72 characters. Body in
  ASD-STE100 Simplified Technical English: what the system does, why,
  new files one line each, and the real validation output. End with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not push.

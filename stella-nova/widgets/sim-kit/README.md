# Sim kit

The shared GUI, randomizer and screensaver director for the physics
simulation pages. It replaces the raw controls of the upstream demos
(Ten Minute Physics and others) with one polished, themed, mobile-first
interface. `SURVEY.md` lists the pages and their state.

Files:

| File | What it is |
|---|---|
| `core.js` | Pure logic, no DOM: seeded rng, schema, randomizer, URL hash, shot bag, themes, palettes |
| `ui.js` | `mount(opts)`: panel, phone dock and sheet, transport, keys, hash, theme tokens |
| `saver.js` | `director(spec)`: `window.snSaver` for a page that mounted the kit |
| `sim-kit.css` | The look. Every colour is a `--sk-*` token that a theme writes on `<html>` |
| `tests.mjs` | Node tests (no browser): `node stella-nova/widgets/sim-kit/tests.mjs` |
| `test/stubs.mjs` | A small DOM and a recording Canvas 2D context, for page tests too |

## Load order

```html
<script src="../../lib/gpu-guard.js"></script>
<script src="../../lib/wishlist.js"></script>
<script src="../../lib/stats-beacon.js"></script>
<!-- a Ten Minute Physics port also loads the credit bar: -->
<script src="../../widgets/ten-minute-physics/kit.js"></script>
<link rel="stylesheet" href="../../lib/sci.css">
<link rel="stylesheet" href="../../widgets/sim-kit/sim-kit.css">
<link rel="stylesheet" href="style.css">
...
<canvas id="view"></canvas>
<script type="module" src="main.js"></script>
```

## Schema

A page declares its controls once. Every control with state has a `key`.

```js
{ groups: [{ id, label, open?, random?: false, hint?, controls: [control] }] }
```

| type | fields | state |
|---|---|---|
| `range` | `min, max, step, unit?, digits?, fmt?(v)` | number, snapped to the step |
| `toggle` | | boolean |
| `choice` | `options: [{id, label}]` or strings, `seg?` (segmented when 4 or fewer) | option id |
| `swatch` | `options: [{id, label, colors}]`, `dice?` (random palette button) | id, or `rnd-<n>` |
| `color` | | `#rrggbb` |
| `cmap` | a colour map of `pages/ct-lab/colormaps/` (41 maps) | map id |
| `button` | `action` | none |
| `buttons` | `items: [{id, label}]`, `action` (gets the item id) | none |
| `note` | `text` | none |

Flags on a control: `rebuild: true` (the page builds a new scene for it;
a slider then reports on release only), `phone: v` (a lighter start value
on a phone), `cls` (an extra class).

Ready-made controls: `core.themeControl(value)` (the background theme,
key `theme`) and `core.paletteControl(value)` (object colours, key
`palette`; read the colours with `core.paletteColors(state.palette)`).

## Randomizer

Each control has a draw rule in `random`:

| rule | meaning |
|---|---|
| `random: false` | never drawn |
| `{ min, max }` | range bounds of the draw (default: the control range) |
| `{ dist: 'log' \| 'normal' \| 'int', mean?, sd? }` | distribution |
| `{ p }` | toggle: chance of true |
| `{ weights: { id: w } }` | choice or swatch: weighted pick |
| `{ pick: [ids] }` | choice, swatch or cmap: draw from this list |
| `{ rnd: 0.3 }` | swatch: chance of a generated palette |

A scene is a pure function of the seed: each key draws from its own
stream, so a lock on one group does not change the draws of another. A
group with `random: false` never draws (solver settings, for example).
The panel has a dice and a lock per group, a seed field, "New scene" and
a share link. `opts.guard(next, prev, rng)` can return a fixed state
(clamp) or `false` (veto: the kit draws again from seed + 1, up to 8
times).

## mount(opts)

```js
import { mount } from '../../widgets/sim-kit/ui.js';
const kit = mount({
  schema, title, sub, panelTitle, footer, guard,
  actions: { name(arg, kit) {} },  // button handlers
  autoplay: true,                   // default
  randomStart: false,               // true: the first visit draws a scene
});
kit.on('change', (out, state, why) => {});  // why: input, scene, group, hash, saver, load
kit.on('scene', (seed, state, out, group) => {});
kit.on('reset', () => {});
// each frame:
if (kit.playing) advance(dt * kit.speed); else if (kit.takeStep()) advance(1 / 60);
```

Other members: `kit.state`, `kit.seed`, `kit.set(key, v)`,
`kit.load(state)`, `kit.newScene(seed?)`, `kit.say(text)` (a toast),
`kit.setPanel(open)`, `kit.panelOpen`, `kit.phone`, `kit.fromHash`,
`kit.shareURL()`, `kit.destroy()`.

Keys: Space play or pause, `.` step, R reset, N new scene, S slow motion,
H panel.

## Screensaver

```js
import { director } from '../../widgets/sim-kit/saver.js';
director({
  kit, canvas: () => canvas,
  shots: [{ key, weight?, title, sub?, tex?, params?(state), lines?,
            scene?(rng, state) -> changes, camera?(rng, state) -> cam }],
  themes?: ['night', 'abyss', ...],     // default: every dark theme
  apply(state, shot, cam) {},           // load the scene (rebuild)
  frame(band, cam) {},                  // the clear band between the plate texts, CSS px
  tick?(dt, ctx), enter?(opts), exit?(),
});
```

Each cut: a shot from a seeded bag (never the same shot twice in a row,
every shot once a pass), a fresh random scene with the page guard, the
shot's own changes, a new theme (never the last one), a camera. Cuts last
6 to 12 s. The plate gets the title, the TeX line, live parameter values
and the credit lines of the TMP kit. No code. Exit restores the visitor's
scene, seed, speed and panel.

## A 30-line page

```js
import { mount, core as K } from '../../widgets/sim-kit/ui.js';
import { director } from '../../widgets/sim-kit/saver.js';

const schema = { groups: [
  { id: 'balls', label: 'Balls', controls: [
    { key: 'n', type: 'range', label: 'Count', min: 1, max: 200, step: 1, value: 40, rebuild: true },
    { key: 'g', type: 'range', label: 'Gravity', min: 0, max: 20, step: 0.1, value: 9.8, unit: 'm/s²' },
  ] },
  { id: 'look', label: 'Look', controls: [K.themeControl('night'), K.paletteControl('toybox')] },
] };
const canvas = document.getElementById('view'), ctx = canvas.getContext('2d');
let balls = [];
function rebuild() { const r = K.rng(kit.seed); balls = Array.from({ length: kit.state.n }, () => ({ x: r(), y: r(), vy: 0 })); }
const kit = mount({ schema, title: 'Bouncing balls' });
kit.on('change', (out, st, why) => { if ('n' in out || why === 'scene') rebuild(); });
kit.on('scene', rebuild); kit.on('reset', rebuild);
rebuild();
function frame() {
  requestAnimationFrame(frame);
  if (kit.playing || kit.takeStep()) for (const b of balls) { b.vy -= kit.state.g * 0.016 * kit.speed; b.y += b.vy * 0.016; if (b.y < 0) { b.y = 0; b.vy *= -0.8; } }
  const cols = K.paletteColors(kit.state.palette), t = K.themeById(kit.state.theme);
  canvas.width = innerWidth; canvas.height = innerHeight;
  ctx.fillStyle = t.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  balls.forEach((b, i) => { ctx.fillStyle = cols[i % cols.length]; ctx.beginPath(); ctx.arc(b.x * canvas.width, canvas.height * (1 - b.y), 8, 0, 7); ctx.fill(); });
}
requestAnimationFrame(frame);
director({ kit, canvas: () => canvas, shots: [{ key: 'calm', title: 'Calm', scene: () => ({ g: 3 }) }, { key: 'heavy', title: 'Heavy', scene: () => ({ g: 18 }) }], apply: rebuild });
```

The worked example is `pages/pbf-boundary/` (solver, renderer, schema,
guard, saver shots, tests).

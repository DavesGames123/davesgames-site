# ct-lab colour maps

A standalone colour map catalogue and picker for the CT pages. The module
has no imports outside this folder, and no page imports it yet. Sources
and licences are in `CREDITS.md`.

## Files

| File | What it is |
|---|---|
| `maps.js` | 41 maps as 256x3 LUTs, colouring, swatch strings, WebGPU helpers, WGSL |
| `picker.js` | `ColormapPicker`: grouped swatch grid, search, reverse, gamma, random |
| `picker.css` | Picker styles. Load it with `picker.js`. |
| `tests.mjs` | `node tests.mjs` runs the checks. `--sheet DIR` also writes a contact sheet PNG. |

## Maps

| Group | Ids |
|---|---|
| grey | grey, grey-inv, sepia |
| medical | bone, pink-tissue, hot-iron, pet-rainbow, ocean, copper, ice |
| perceptual | viridis, magma, inferno, plasma, cividis, mako, rocket, cubehelix, turbo |
| diverging | coolwarm, red-blue, purple-orange, pink-green, brown-teal, berlin, vanimo, managua |
| cyclic | twilight, twilight-shifted, phase-wheel |
| artistic | aurora, nebula, ember, glacier, synthwave, gold-leaf, xray-blue, cyanotype, forest, rose, orchid |

Each map object has `id`, `name`, `group`, `kind` (`sequential`,
`diverging` or `cyclic`), `use` (a one-line recommendation), `src` and
`lut` (a `Uint8Array` of 768 bytes, RGB per step). `wavy: true` marks the
two sequential maps whose lightness is not monotonic by design (turbo and
pet-rainbow).

## API (`maps.js`)

```js
import * as CM from './colormaps/maps.js';

CM.get('viridis')                 // map object; unknown id -> grey
CM.list() / CM.list('diverging')  // maps in catalogue order
CM.ids(), CM.has(id), CM.randomId({ group, not })
CM.GROUPS, CM.GROUP_NAMES

const opts = { reverse: false, gamma: 1, contrast: 1 };
CM.sample('magma', 0.3, opts)     // [r, g, b] bytes
CM.variant('magma', opts)         // 768-byte LUT after the options (cached)
CM.rgba('magma', opts)            // 1024-byte RGBA row for textures or ImageData

// Float data -> RGBA bytes. lo -> t = 0, hi -> t = 1. NaN -> opts.nan.
const img = new ImageData(w, h);
CM.apply('bone', slice, -1000, 1000, img.data, { gamma: 1.2, nan: [0, 0, 0, 0] });

el.style.background = CM.cssGradient('turbo', opts);           // swatch
ctx.fillStyle = CM.toCanvasGradient(ctx, 'ice', 0, 0, w, 0, opts);
```

Gamma above 1 spreads the high values. Gamma below 1 spreads the low
values. Contrast scales t about 0.5. Reverse flips the colours, not the
data, so gamma keeps its meaning on a reversed map. `apply()` and
`sample()` use the same 256 steps and give the same bytes.

## Picker (`picker.js`)

```js
import { createPicker } from './colormaps/picker.js';
// <link rel="stylesheet" href="./colormaps/picker.css">

const picker = createPicker(sheetEl, { value: 'grey', reverse: false, gamma: 1 });
picker.addEventListener('change', (e) => {
  const { id, reverse, gamma, map } = e.detail;
  redraw();
});
picker.value;                       // { id, reverse, gamma }
picker.set({ id: 'magma' }, { silent: true });
picker.random();
picker.destroy();
```

Options: `groups` (for example `['diverging']`), `compact: true` (smaller
swatches, no use note) and `label`. The host element also gets a bubbling
`cmapchange` event. Keys: Tab enters the grid, arrow keys move the
selection, Home and End go to the ends, and "/" goes to the search field.
On `(pointer: coarse)` every target is 44 px. The picker scrolls its own
grid, so a bottom sheet can give it a fixed height. Override `--cmp-*`
CSS variables on `.cmp` to match a page.

## Wiring

**CT lab.** Put the picker in the lab's panel (the bottom sheet on phones).
Keep one state `{ id, reverse, gamma }` for the slice view. On `change`,
call `CM.apply(id, slice, lo, hi, imageData.data, { reverse, gamma })`
with the current Hounsfield window as `lo` and `hi`, then `putImageData`.
Use `groups: ['diverging']` for a second picker on the error or
difference image, with a window that is symmetric about zero.

**CT explainer.** The explainer needs no full picker. Use
`CM.cssGradient()` for small legend bars, and give each figure a fixed
map id, for example `grey` for slices, `twilight` for projection angle
and `coolwarm` for back-projection error. For a reader control, a
`compact: true` picker with `groups: ['grey', 'medical']` is enough.

**3D view.** Make the LUT texture once with `CM.lutTexture(device, id)`.
On `change`, call `texture.writeMap(id, { reverse, gamma })`. No bind group
changes. Paste `CM.WGSL` into the shader source and call `cmap_load` or
`cmap_sample` on the windowed density. For a shader that switches map by a
uniform, use `CM.lutAtlasTexture(device)` and `cmap_load_row`. The
`rows` map gives the row of each id.

**Screensaver.** In `snSaver.enter()`, pick a map with
`CM.randomId({ group: 'artistic' })` or from medical and perceptual
groups, from a seeded choice so each run differs. Change the map at each
shot cut with `texture.writeMap` or a new `apply()`. Put the map name
(`CM.get(id).name`) in the plate params.

## WGSL

`CM.WGSL` is a string of four functions. They take the texture as a
parameter, so the page keeps its own bind group layout.

```wgsl
fn cmap_window(v: f32, lo: f32, hi: f32) -> f32               // t in 0..1
fn cmap_load(lut: texture_2d<f32>, t: f32) -> vec3<f32>        // exact step
fn cmap_sample(lut: texture_2d<f32>, samp: sampler, t: f32) -> vec3<f32>  // filtered
fn cmap_load_row(atlas: texture_2d<f32>, t: f32, row: i32) -> vec3<f32>
```

```js
const code = CM.WGSL + /* wgsl */ `
@group(0) @binding(3) var lut: texture_2d<f32>;
@fragment fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let hu = textureLoad(slice, vec2<i32>(uv * dims), 0).r;
  return vec4<f32>(cmap_load(lut, cmap_window(hu, params.lo, params.hi)), 1.0);
}`;
```

The texture is `rgba8unorm`, so the shader gets sRGB values as stored. On
an `-srgb` canvas format, the colours are encoded a second time. Use a
non-sRGB canvas format, or convert in the shader.

`tests.mjs` passes the snippet through `~/.cargo/bin/naga` in a small
module. naga accepts some WGSL that Chrome Tint refuses, so the snippet has
no mixed `&&`/`||` or bitwise operators. No browser has compiled it yet.

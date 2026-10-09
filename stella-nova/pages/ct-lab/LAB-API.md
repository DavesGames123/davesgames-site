# CT lab page API (`window.__ctlab`)

The CT lab page (`stella-nova/pages/ct-lab/index.html`, `main.js`) puts one
object on `window.__ctlab`. The screensaver agent and the explainer use it.
The page does NOT write `window.snSaver`. A separate `saver.js` adds the
saver hook and calls this API.

All methods are safe to call before boot ends. They wait for `ready`.

## Boot

```js
await window.__ctlab.ready;        // resolves after the first preset is loaded
window.__ctlab.version             // 1
window.__ctlab.backend             // 'gpu' | 'cpu' (forward projection and full FBP)
```

## Presets

```js
__ctlab.presets()                  // [{ id, label, group, blurb }] in gallery order
await __ctlab.load(id, { autoplay = true })   // load a preset, start its scan
```

`load` sets every parameter from the preset, rebuilds the phantom and starts
the scan animation when `autoplay` is true. With `autoplay: false`, the page
waits at view 0 for `play()` or `step()`. An unknown id loads `shepp-logan`.

The page also reads `#preset=<id>` from the URL on load and on `hashchange`.
The explainer links to presets this way, for example
`../ct-lab/index.html#preset=metal-mar`.

Preset ids (see `lab/presets.js`, `grep -n "id:"`):
`shepp-logan`, `sparse-18`, `sparse-36`, `sparse-90`, `limited-90`,
`limited-120`, `low-dose`, `high-dose`, `beam-hardening`, `metal-streaks`,
`metal-mar`, `rings`, `motion`, `fan-flat`, `fan-arc`, `filters`,
`algorithms`, `art-kaczmarz`, `tv-sparse`, `walnut`, `suitcase`,
`chest-lung`, `head-brain`, `head-bone`, `bars`, `contrast-detail`, `custom`.

## Parameters

```js
__ctlab.params()                   // a copy of the current parameters
await __ctlab.set(partial, { run = true })
```

`set` merges `partial` into the parameters. It then does the least work that
the change needs:

| Change | Work |
|---|---|
| `phantom`, `n`, `beam`, `views`, `arc`, `detectors`, `dose`, `poly`, `kVp`, `motion`, `deadPixels`, `gain`, `mar` | rescan (from view 0 when `run`) |
| `algo`, `filter`, `cutoff`, `iters`, `relax`, `tv` | reconstruct again from the stored sinogram |
| `window`, every colour map field (see Colour maps) | redraw only |

Parameter fields:

| Field | Values |
|---|---|
| `phantom` | a 2D phantom key from the engine, or `'custom'` |
| `n` | image size in pixels (64 to 512) |
| `beam` | `'parallel'`, `'fan-flat'`, `'fan-arc'` |
| `views` | number of views (4 to 720) |
| `arc` | scan arc in degrees (parallel full = 180, fan full = 360) |
| `detectors` | detector elements, 0 = fit to the image |
| `dose` | photons per element per view (I0), 0 = no noise |
| `poly`, `kVp` | polychromatic beam (beam hardening) and tube voltage |
| `motion` | object shift amplitude in world units (0 = still) |
| `deadPixels`, `gain` | dead detector elements (count) and gain spread (fraction) |
| `mar` | metal artefact reduction by sinogram inpainting |
| `algo` | `'fbp'`, `'art'`, `'sart'`, `'sirt'`, `'cgls'` |
| `filter`, `cutoff` | FBP filter name and cutoff (fraction of Nyquist) |
| `iters`, `relax`, `tv` | iterations, relaxation, TV weight (0 = off) |
| `window` | `{ level, width }` in HU (raw units for Shepp-Logan), or a window name |
| `cmap`, `cmapReverse`, `cmapGamma` | colour map of the image panels (object, reconstruction, compare tiles) |
| `sinoMap`, `sinoReverse`, `sinoGamma` | colour map of the sinogram (default magma, gamma 0.85) |
| `diffMap`, `diffReverse`, `diffGamma` | diverging colour map of the error panel (default coolwarm) |
| `map3d`, `map3dReverse`, `map3dGamma` | colour map of the 3D tab (default bone) |
| `compare` | `''`, `'filters'`, `'algorithms'` (the compare strip) |

## Running the scan

```js
__ctlab.play()          // run the animation from where it is
__ctlab.pause()         // freeze, keep state
__ctlab.run()           // restart the scan from view 0 and play
__ctlab.step(k = 1)     // pause, then advance k views (or k iterations after the scan)
__ctlab.stop()          // cancel the worker, stop the frame loop; play() resumes
__ctlab.setSpeed(vps)   // views per second during the scan (default: about 4 s per scan)
__ctlab.state()
```

`state()` returns:

```js
{
  preset, phase,        // phase: 'idle' | 'scan' | 'mar' | 'iterate' | 'done'
  view, views,          // views acquired so far, views in the scan
  angle,                // current gantry angle in radians
  iter, iters,          // iterations done, iterations planned (0 for FBP)
  residuals,            // array of ||b - Ax|| per iteration
  psnr, ssim,           // metrics of the current reconstruction against the phantom
  backend, n, playing,
}
```

## Panels and view

```js
__ctlab.panels()        // { phantom, sinogram, recon, diff }: the page canvases (in the document)
__ctlab.snapshot()      // a new canvas with the four panels and labels (for export, not in the document)
__ctlab.windows()       // [{ id, label, level, width }]
__ctlab.setWindow(idOrObj)
__ctlab.setColormap(panel, id, { reverse, gamma })   // see Colour maps
__ctlab.setColormap(id, { reverse, gamma })          // the image panels (old form)
__ctlab.colormaps()     // { image, sino, diff, v3d }: each { id, reverse, gamma }
__ctlab.focusPanel(name | null)   // one panel fills the panel grid; null restores the grid
__ctlab.setChrome(visible)        // false hides the controls, gallery and bars (html.ct-bare)
```

The panel canvases are drawn at the device pixel ratio. The phantom panel
shows the gantry: the source, the rays and the detector with the current
projection profile.

## Colour maps

The lab has four colour targets (`lab/colour.js`, `grep -n TARGETS`):

| Target | `panel` names | Map groups in its picker | Default |
|---|---|---|---|
| `image` | `'image'`, `'phantom'`, `'recon'`, `'compare'` | grey, medical, perceptual, artistic | grey |
| `sino` | `'sinogram'`, `'sino'` | grey, medical, perceptual, artistic, cyclic | magma, gamma 0.85 |
| `diff` | `'diff'`, `'error'` | diverging only | coolwarm |
| `v3d` | `'3d'`, `'v3d'`, `'volume'` | grey, medical, perceptual, artistic | bone |

The object and the reconstruction share one map, so they stay comparable.
`setColormap(panel, id, opts)` sets one target. A missing `reverse` or `gamma`
keeps the current value. An unknown id falls back to the target default. The
`diff` target takes only diverging maps. Gamma is clamped to 1/3..3. On the
error panel, gamma acts on |error| so zero stays at the centre of the map.

The display window applies first: level and width give `lo` and `hi`, and
`t = (v - lo) / (hi - lo)` goes through the 256-step LUT (`CM.apply`). The 2D
panels are Canvas 2D, so the 2D lab colours on the CPU. The 3D tab samples a
LUT texture on the GPU (`view3d/README.md`, Colour).

Each preset has its own maps (`lab/presets.js PRESET_MAPS`). For example, the
lung and brain windows stay grey, the dose presets use PET-like maps, and the
metal presets use a berlin error map. A preset load resets the maps.

PNG exports draw the panels with the chosen maps. The "All panels" sheet names
the maps in its subtitle.

### Share hash

The hash holds the preset, then each map that differs from the preset's maps:

```
#preset=walnut&cmap=magma~r~g1.25&sino=viridis&diff=berlin&v3d=ice
```

`~r` is reverse, `~g<n>` is gamma. The page reads the hash on load and on
`hashchange`, and writes it (with `history.replaceState`) after each map change.

## 3D tab

```js
__ctlab.setTab('3d' | '2d')   // returns __ctlab.tab()
__ctlab.tab()                 // { tab, active, phase, phantom, mode, map, live, made, error, view }
```

The 3D tab (`lab/tab3d.js`) scans a 3D phantom (head, chest or Shepp-Logan 3D)
with a cone beam, reconstructs it with FDK on the GPU, then shows it as MIP,
volume rendering, surfaces or slices (`view3d/`). The `v3d` colour map colours
the MIP, the slices and the volume rendering (`tf: true`). Phones get 64^3
voxels, 90 views and 128 ray steps. Desktops get 96^3, 180 views and 256 steps.

The tab is WebGPU only. Without WebGPU it shows a note and a Canvas 2D preview of
the phantom slices. The tab makes its own GPUDevice when it opens and destroys
it when it closes, on `pagehide`, and on `setChrome(false)` (the saver). `live`
counts the devices that the tab holds now. `#...&tab=3d` in the hash opens it.

## Events

```js
const off = __ctlab.on(name, fn)  // returns a function that removes the listener
```

| Event | Detail |
|---|---|
| `preset` | `{ id }` after a preset loads |
| `phase` | `{ phase }` when the phase changes |
| `view` | `{ view, views, angle }` after views arrive (once per frame) |
| `iter` | `{ iter, iters, residual }` after each iteration |
| `done` | `{ psnr, ssim }` when the reconstruction is final |

## Teardown

The page destroys its WebGPU devices (the 2D lab device and the 3D tab device)
and its worker on `pagehide`.
`lib/gpu-guard.js` also releases the device when the shell swaps pages.

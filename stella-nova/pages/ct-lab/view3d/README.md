# ct-lab view3d: 3D cone-beam scene and volume renderer

`view3d/` is a set of ES modules that draw a cone-beam CT scan in 3D with WebGPU.
The lab page uses it for its 3D tab. The screensaver hook uses it for its 3D shots.
It imports the CT engine (`../engine/index.js`) and the colour maps (`../colormaps/maps.js`).

The scene has these parts:

- a gantry ring, an X-ray source and a flat-panel detector that turn about the z axis,
- the cone of rays from the source to the detector corners, and a fan of glowing sample rays,
- the patient table and the object volume (a 3D phantom or a reconstruction),
- the live projection on the detector panel while the gantry turns.

The volume renderer has four modes:

| Mode | What it shows |
|---|---|
| `mip` | Maximum intensity projection along each ray, coloured by a colour map. |
| `dvr` | Direct volume rendering with a transfer function: soft tissue translucent, bone bright. |
| `iso` | Two shaded surfaces: a glassy skin layer and an opaque bone surface. |
| `slices` | Three orthogonal slice planes. You can drag each plane along its axis. |

## Files

```
index.js      re-exports the public names below
view3d.js     createView3D: GPU resources, scan and reconstruction state, input, render
scene.js      DOM-free maths: mat4, orbit camera, picking, half floats, meshes, transfer functions
wgsl.js       WGSL sources: background, mesh, glass, glow lines, volume ray-march
fallback.js   drawSlices2D: a Canvas 2D view (three slices and a MIP) when WebGPU is absent
tests.mjs     node tests (maths, meshes, WGSL through naga); runs render-deno.mjs when deno exists
render-deno.mjs  Deno WebGPU render check: writes PNGs of every mode and checks the FDK result
```

grep handles: `grep -n "^export" view3d/*.js` lists every public name.

## API

```js
import { createView3D, drawSlices2D, MODES } from './view3d/index.js';

const view = createView3D(canvas, device, {
  phantom: 'head',       // 'shepp-logan' | 'head' | 'chest' (engine PHANTOMS_3D keys)
  n: 96,                 // volume size n^3. Use 64 on phones, 96-128 on desktops.
  nAngles: 180,          // views in one full 360 degree turn
  mode: 'dvr',           // 'mip' | 'dvr' | 'iso' | 'slices'
  interactive: true,     // pointer orbit, wheel and pinch zoom, slice drag in 'slices' mode
  dpr: devicePixelRatio, // canvas pixel ratio (capped at 2 by default)
  steps: 256,            // ray-march samples across the volume diagonal (use 128 on phones)
});
```

`canvas` is an `HTMLCanvasElement` (the module configures a `webgpu` context on it).
`device` is a `GPUDevice`. The module does not create or destroy the device.
For an offscreen render (Deno tests), pass `canvas = null` and
`opts = { width, height, format }`, then call `view.render({ target: textureView })`.

### Methods

| Method | What it does |
|---|---|
| `setPhantom3D(name, { n, supersample })` | Builds the engine phantom, makes a fitted cone geometry, and clears the scan and the reconstruction. Returns `{ volume, geom }`. |
| `setVolume(volume, { window, as })` | Shows any engine `Volume`. `as: 'phantom'` (default) or `'recon'`. `window: [lo, hi]` in volume units. |
| `scanStep({ views = 1, budgetMs })` | Projects the next views on the CPU (Joseph cone projector), turns the gantry to the last view and shows that projection on the detector. Returns `{ done, total, angle }`. |
| `reconstructStep({ views = 8 })` | Async. FDK on the next scanned views: cosine weight and ramp filter (engine `fdkFilter`), then back-projection on the GPU (engine `createGpuCT().backProjectCone`) and accumulation. Returns `{ done, total, rmse }`. `rmse` is against the phantom, in volume units. |
| `setMode(mode)` | One of `MODES`. |
| `setCamera({ yaw, pitch, dist, fov, target, offset, autoRotate })` | Orbit camera. Angles in radians. `dist` in volume widths. `offset: [x, y]` shifts the image in NDC, for example to centre the subject in the saver's clear band. `autoRotate` in rad/s. |
| `getCamera()` | Returns a copy of the camera state. |
| `setSlices({ x, y, z })` | Slice positions as fractions 0..1 of the volume. |
| `setWindow(lo, hi)` | Display window in volume units. |
| `setIso(skin, bone)` | Iso levels as fractions 0..1 of the window. |
| `setShow({ gantry, rays, table, volume, detector })` | Turn parts on or off. `volume: 'auto' \| 'phantom' \| 'recon'`. `'auto'` shows the reconstruction once it has views. |
| `setGantryAngle(rad)` | Turns the gantry without a scan (for explainer shots). |
| `setColormap(id)` | Colour map id from `../colormaps/maps.js` for the `mip` and `slices` modes. |
| `render({ dt, target })` | Draws one frame. `dt` in seconds moves `autoRotate`. |
| `resize()` | Reads the canvas client size again. The module also calls it when the size changes. |
| `state` | Read-only: `{ phantom, n, mode, scanned, reconstructed, total, angle }`. |
| `destroy()` | Releases textures, buffers and listeners. Call it on `pagehide`. |

### Typical loop

```js
const view = createView3D(canvas, device, { phantom: 'head', n: 96 });
let phase = 'scan';
async function frame(t) {
  if (phase === 'scan' && view.scanStep({ views: 2 }).done === view.state.total) phase = 'recon';
  else if (phase === 'recon' && (await view.reconstructStep({ views: 12 })).done === view.state.total) phase = 'look';
  view.render({ dt: 1 / 60 });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('pagehide', () => view.destroy());
```

`scanStep` runs on the main thread. At n = 96 one view takes about 7 ms on the CPU.
Keep `views` small, or pass `budgetMs`.

## Without WebGPU

`createView3D` throws when `device` is missing. Show a note and draw
`drawSlices2D(canvas2d, volume, { slices, colormap })` instead. That function draws
an axial, a coronal and a sagittal slice and a MIP with Canvas 2D. There is no
WebGL2 path.

## Limits

- FDK is exact on the mid-plane only. Slices far from the mid-plane show cone-beam streaks.
  This is correct behaviour, not a bug.
- The engine's 3D Shepp-Logan drops the 10 degree tilt on two ellipsoids (see `../engine/phantoms.js`).
- Volume textures are `r16float`. Values keep about three significant digits.

## Credit

The algorithms are textbook (Feldkamp, Davis and Kress 1984 for FDK; Joseph 1982 for the
projector). We wrote all code here. We did not copy or port ASTRA Toolbox code (GPL-3.0).
ASTRA Toolbox is the real tool: https://github.com/astra-toolbox/astra-toolbox.
W. van Aarle et al., Ultramicroscopy 157 (2015) 35-47, doi:10.1016/j.ultramic.2015.05.002.
W. van Aarle et al., Optics Express 24(22) (2016) 25129-25147, doi:10.1364/OE.24.025129.

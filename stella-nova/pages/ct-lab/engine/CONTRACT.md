# CT engine contract

The CT engine is a set of DOM-free ES modules in `stella-nova/pages/ct-lab/engine/`.
The explainer page and the CT lab page import these modules. The modules do not touch
`document` or `window`. They run in a browser, a Web Worker, Node 24 and Deno.

The algorithms are textbook (Radon 1917, Shepp and Logan 1974, Kak and Slaney 1988,
Joseph 1982, Siddon 1985, Feldkamp, Davis and Kress 1984, Gordon, Bender and Herman 1970,
Andersen and Kak 1984, Hestenes and Stiefel 1952). We wrote all code here. We did not copy
or port ASTRA Toolbox code (GPL-3.0). Pages must credit ASTRA Toolbox as the real tool and
link it: https://github.com/astra-toolbox/astra-toolbox, and cite
W. van Aarle et al., Ultramicroscopy 157 (2015) 35-47, doi:10.1016/j.ultramic.2015.05.002, and
W. van Aarle et al., Optics Express 24(22) (2016) 25129-25147, doi:10.1364/OE.24.025129.

## Files

```
index.js      re-exports every public name below (import from here)
geometry.js   parallel, fan (flat, arc), cone geometries; ray construction
phantoms.js   Shepp-Logan 2D/3D, procedural phantoms, rasterizer, analytic projections
project.js    CPU Joseph forward / adjoint back-projection, FBP back-projector, generators
recon.js      FFT ramp filters, FBP (parallel, fan direct, fan rebin), FDK, ART, SART, SIRT, CGLS, TV
physics.js    Beer-Lambert, Poisson noise, spectra, beam hardening, artefacts, simulateScan
metrics.js    rmse, psnr, ssim
gpu.js        WebGPU runner (forward 2D, back-projection 2D, cone back-projection 3D)
wgsl.js       WGSL source strings for gpu.js (tests write them to files for naga)
tests.mjs     node tests (run: node stella-nova/pages/ct-lab/engine/tests.mjs)
gpu-tests.mjs Deno WebGPU checks and GPU timings (tests.mjs runs it when deno exists)
```

grep handles: `grep -n "^export" engine/*.js` lists every public name.

## Units and coordinates

- Length unit: one world unit. For the procedural phantoms one world unit is 1 cm.
  Shepp-Logan uses its published unit square, width 2.
- Attenuation `mu` is in 1/(world unit). Procedural phantoms give mu in 1/cm at 70 keV.
  A projection value (line integral) is dimensionless: `p = integral mu dl`.
- World axes: x to the right, y up, z up out of the axial plane.
- The image or volume centre is the world origin (the rotation axis).

### Image2D

```js
{ nx, ny, width, data: Float32Array(nx*ny) }
```
- `data[iy*nx + ix]`. Row `iy = 0` is the TOP of the image (largest y). This is canvas order.
- Pixel size `px = width / nx` (square pixels, so world height = ny*px).
- Pixel centre: `x = (ix + 0.5)*px - nx*px/2`, `y = ny*px/2 - (iy + 0.5)*px`.

### Volume

```js
{ nx, ny, nz, width, data: Float32Array(nx*ny*nz) }
```
- `data[(iz*ny + iy)*nx + ix]`. Each z slice is an Image2D in canvas order.
- Slice `iz = 0` is the LOWEST z. Voxel centre `z = (iz + 0.5)*px - nz*px/2`.

### Sinogram (2D geometries)

```js
{ nAngles, nDet, data: Float32Array(nAngles*nDet) }
```
- `data[a*nDet + i]`. One row per view angle, one column per detector element.

### Cone projections

```js
{ nAngles, nu, nv, data: Float32Array(nAngles*nv*nu) }
```
- `data[(a*nv + iv)*nu + iu]`. Row `iv = 0` is the LOWEST z on the detector.

## Geometry

Make geometries with the factories in `geometry.js`. A geometry is a plain object.

```js
parallelGeometry({ angles | nAngles, arc=Math.PI, nDet, du, offset=0 })
fanGeometry({ angles | nAngles, arc=2*Math.PI, nDet, du, sod, sdd, detector:'flat'|'arc', offset=0 })
coneGeometry({ angles | nAngles, arc=2*Math.PI, nu, nv, du, dv, sod, sdd })
fitGeometry(kind, image|volume, opts)   // picks nDet/du (and sod/sdd) so the detector covers the object
anglesFull(n, arc, start=0)             // n angles over [start, start+arc), endpoint excluded
sparseAngles(geom, keepEvery)           // new geometry with every k-th view
limitedAngle(geom, arc)                 // new geometry with only views in [0, arc)
```

Fields: `type` is `'parallel' | 'fan' | 'cone'`. `angles` is a Float32Array in radians.
`nAngles = angles.length`. Fan beam also has `detector: 'flat' | 'arc'`.

Ray conventions, angle `b`:
- central direction `d = (-sin b, cos b)`, detector axis `n = (cos b, sin b)`.
- detector coordinate `u_i = (i - (nDet-1)/2)*du + offset`.
- parallel: the ray passes through `u_i * n` with direction `d`. So `p(b, s)` is the Radon
  transform with normal `n` and signed distance `s = u_i`.
- fan: source `S = -sod*d`. Flat detector: the element sits at `S + sdd*d + u_i*n`.
  Arc (equiangular) detector: fan angle `g = u_i / sdd`, ray direction `cos g * d + sin g * n`.
  `du` is the arc length at distance `sdd` for an arc detector.
- cone: the same as flat fan in the xy plane. Detector row `v_j = (j - (nv-1)/2)*dv` points +z.
- The projectors integrate along the full line. Keep the source and the detector outside the
  object circle (`fitGeometry` does this).

## Phantoms (`phantoms.js`)

```js
phantom2D(name, n, opts) -> { image: Image2D (mu), basis: {water, bone, iron}: Image2D, meta }
phantom3D(name, n, opts) -> { volume: Volume (mu), shapes, meta }
PHANTOMS_2D  // [{ key, label, width, blurb }]
PHANTOMS_3D
SHEPP_LOGAN_2D, SHEPP_LOGAN_2D_MODIFIED, SHEPP_LOGAN_3D  // published ellipse tables
analyticSinogram(shapes, geom)        // exact line integrals of ellipse lists (parallel, fan)
analyticConeProjections(shapes, geom) // exact line integrals of ellipsoid lists (cone)
```

2D names: `shepp-logan`, `shepp-logan-modified`, `head`, `chest`, `suitcase`, `bars`,
`contrast-detail`, `walnut`, `metal-implant`. 3D names: `shepp-logan`, `head`, `chest`.

- `basis` holds density fractions for three basis materials (water, cortical bone, iron).
  `physics.js` uses them for polychromatic (beam hardening) scans. Shepp-Logan has no
  physical basis; its basis.water is the image itself and bone/iron are zero.
- `opts.supersample` (default 3) anti-aliases edges. `opts.seed` changes procedural noise.

## Projection (`project.js`)

```js
forwardProject(image, geom, { out, a0=0, a1=nAngles, motion }) -> Sinogram
backProject(sino, geom, image|{nx,ny,width}, { out, a0, a1 }) -> Image2D   // exact adjoint
forwardProjectCone(volume, geom, opts) -> ConeProjections
backProjectCone(proj, geom, volume|dims, opts) -> Volume                   // exact adjoint
fbpBackProject(filtered, geom, dims, { out, a0, a1, weights }) -> Image2D  // pixel driven, interpolating
forwardProjectSteps(image, geom, opts)  // generator, yields {done, total, sino}
drive(gen, { budgetMs=12, signal, onYield }) -> Promise<last value>          // runs a generator in slices
```

- Projector: Joseph (1982) with linear interpolation and zero outside the grid.
  `backProject` is the transpose of `forwardProject`, so `<Ax, y> = <x, A^T y>` holds to
  float rounding (test: relative error below 1e-5).
- `motion(a) -> {dx, dy}` moves the object by (dx, dy) world units during view `a`.
- `a0..a1` restricts the work to a range of views. Pages use it to project in chunks.

## Reconstruction (`recon.js`)

```js
FILTERS = ['ram-lak', 'shepp-logan', 'cosine', 'hamming', 'hann']
filterSinogram(sino, geom, { filter='ram-lak', cutoff=1 }) -> Sinogram (filtered)
fbp(sino, geom, dims, { filter, cutoff }) -> Image2D        // parallel, fan flat, fan arc
rebinFanToParallel(sino, fanGeom, { nAngles, nDet, du }) -> { sino, geom }
fdk(proj, geom, dims, { filter, cutoff }) -> Volume
fdkFilter(proj, geom, { filter, cutoff }) -> filtered projections (feed gpu.backProjectCone)
coneBackProjectFDK(q, geom, dims, { weights, a0, a1, out }) -> Volume (CPU, chunkable by view)
filterResponse(name, P, tau, cutoff, kind) -> Float64Array  // for plotting a filter
createSolver(method, sino, geom, dims, opts) -> solver      // 'art'|'sart'|'sirt'|'cgls'
runIterative(method, sino, geom, dims, { iterations, onIter, ...opts }) -> Image2D
tvDenoise(image, { weight, steps })                          // a few TV gradient steps, in place
```

`dims` is `{ nx, ny, width }` (2D) or `{ nx, ny, nz, width }` (3D).

Solver object: `solver.step()` does one full iteration and returns
`{ iter, residual, image }`. `residual = ||b - A x||_2`. CGLS reports it after the step.
SIRT reports it for the estimate at the start of the step (one step late, no extra projection).
ART and SART sum it over the sweep while x changes. All four decrease monotonically in the tests. `solver.image` is the current
estimate (Image2D, shared buffer, do not keep a reference across steps if you need a copy).
Options: `relax` (lambda), `nonneg` (default true, not for CGLS), `x0`,
`tv: { weight, steps }` (TV steps after each iteration), `seed` (ART/SART view order).

- FBP: ramp filter from the discrete Ram-Lak kernel (Kak and Slaney eq. 3.61), windowed in
  frequency. `cutoff` in (0, 1] is a fraction of the Nyquist frequency.
- Fan FBP needs a full 2*pi scan. For a short scan, rebin to parallel first.
- FDK: flat detector, circular orbit, full 2*pi scan. Exact on the mid-plane only.

## Physics (`physics.js`)

```js
MATERIALS                                  // basis mu tables (approximate NIST XCOM values)
muAt(material, keV)                        // 1/cm, log-log interpolation
spectrum(kVp, { filterMmAl=2.5, bins })    // simple Kramers spectrum with Al filter -> {keV[], w[]}
transmit(lineInt, { I0 })                  // counts = I0 * exp(-p)  (Beer-Lambert)
poissonNoise(counts, { seed })             // in place, Poisson sample per element
toLineIntegral(counts, { I0 })             // p = -ln(max(I, 0.5) / I0)
polychromaticSinogram(basisSinos, spec)    // effective p from water/bone/iron path sinograms
detectorDefects(sino, { gainSigma, dead: [i...], seed })
simulateScan(phantom, geom, { dose, kVp, poly, motion, gainSigma, dead, seed }) -> { sino, clean }
```

- `dose` is I0, the photon count per detector element per view without the object.
- In `simulateScan`, `poly: true` uses the spectrum and the basis images. That gives cupping,
  dark streaks between bone, and metal streaks. `poly: false` uses `image` (mu at 70 keV).

## Metrics (`metrics.js`)

```js
rmse(a, b), psnr(a, b, range?), ssim(a, b, { range, window=7 })  // a, b: Image2D or Float32Array
```
`psnr` uses `range = max(ref) - min(ref)` by default (ref is the first argument).

## GPU (`gpu.js`)

```js
const ct = createGpuCT(device)            // device: a GPUDevice
await ct.forward2D(image, geom)           -> Sinogram       (parallel, fan)
await ct.backProject2D(sino, geom, dims, { fbp: true })  -> Image2D (pixel driven)
await ct.backProjectCone(proj, geom, dims)               -> Volume  (FDK weighting)
ct.destroy()                              // releases buffers and pipelines (call on pagehide)
```
- The GPU forward projector is the same Joseph projector as the CPU one.
- The GPU back-projector is pixel driven with linear interpolation (the FBP back-projector).
  It is NOT the exact adjoint. Use the CPU pair for adjoint tests.
- WGSL: every mixed `&&`/`||` and every mixed bitwise/arithmetic expression has parentheses
  (Chrome Tint rejects them, naga does not).

## Lower-level exports

`index.js` also exports these helpers. The pages and tests use some of them.
They have no stability promise beyond their files.

```
geometry.js  rayFor, rayFor3D, detCoord, angleWeights, coverage
phantoms.js  rasterize2D, rasterize3D, buildHead, buildChest, buildSuitcase,
             buildBars, buildContrastDetail, buildWalnut, buildMetal
project.js   emptyImage, emptySino, emptyVolume, emptyCone, josephRay2D,
             josephRay3D, josephScatter2D, josephRowNorm2
recon.js     fft, filterWindow, makeART, makeSART, makeSIRT, makeCGLS
physics.js   BASIS, COMPOSITIONS, muOfComposition, mulberry32
```

## Performance

Measured 2026-10-08 on this Mac (Apple Silicon). CPU: Node 24, single thread. GPU: Deno WebGPU
(Metal), times include upload and read back. Parallel beam, 363 detectors for 256, 725 for 512.

| Task | 256^2, 360 views | 512^2, 360 views |
|---|---|---|
| CPU forward projection | 65 ms | 235 ms |
| CPU adjoint back-projection | 50 ms | 185 ms |
| CPU FBP (filter + back-projection) | 98 ms | 373 ms |
| CPU SIRT iteration | 110 ms | 435 ms |
| CPU CGLS iteration | 125 ms | 483 ms |
| CPU fan FBP, 720 views | 282 ms | 1084 ms |
| GPU forward projection | 16 ms | 21 ms |
| GPU FBP back-projection | 16 ms | 23 ms |

Cone beam: CPU 128^3 from 180 views (183 x 223 detector): forward 2.7 s, FDK 2.1 s.
GPU FDK back-projection 256^3 from 360 views of 384 x 384: 191 ms.

Advice for pages: on the CPU, run SIRT/CGLS on 256^2 or less, in a Worker or with one
`step()` per frame. Run 3D work on the GPU. Use `a0/a1` or the generators to stay under a
frame budget on the main thread.

## Measured quality (tests.mjs)

- Joseph vs exact line integrals (Shepp-Logan, 256): rmse/peak 0.0023.
- FBP, modified Shepp-Logan, 256, 360 views, exact data: PSNR 33.87 dB (Ram-Lak),
  33.28 (Shepp-Logan), 30.78 (cosine), 29.29 (Hamming), 28.83 (Hann). SSIM 0.90.
  The test threshold is 33.0 dB.
- Fan FBP vs parallel FBP: rmse 0.025 (flat and arc). Rebinned fan: 0.013.
- FDK central slice (64^3, 180 views) vs parallel FBP of the same slice: rmse 0.053.
- Noise: sd(I0 = 1e4) / sd(I0 = 1e6) = 9.98 (expected 10).
- GPU vs CPU: max relative error below 1.1e-5 for every kernel.

# Tensor Calculus page contract

Binding spec for the tensor swarm. Read all of it before you write code.
Also read `stella-nova/PAGES.md` "How to add a page" and the commit and
validation rules in `stella-nova/lib/GROWTH-PAGES.md` (they apply here
the same way, with the prefix `tensor-calculus:`).

## What the user asked for (verbatim, 2026-10-17)

> I would like a new page drafted for the website that deeply explains the
> concepts of tensor calculus on a very deep level, using two different
> views, one view of the latex math equation that we're actually doing one
> view of a 3-D visualization of the tensor is undergoing transformations
> with one anoth, and also the option to switch over to Feinman diagrams
> for the actual tensor calculus. It might not be a fine Man diagram that
> I'm thinking of but there's a specific type of diagram that's meant to
> diagram. Grammatically demonstrate how tensor calculus operations happen.
> It might not be fine Man. That's the scientist who's in charge of it but
> it might be something else I want you to dispatches warm in order to
> build me a page that does a deep overview of many different types of
> tensor operations gives a really good library of different famous tensor
> equations that we can analyze look at and play with and also give me a
> deep and visual understanding of what the upper and lower indices of
> tensors actually mean I'd like a lot of the elements of the page to be
> animated so please feel free to make sure that this is an incredibly
> deep and enriching user experience that really gives people the full
> grasp of what exactly is happening inside of tensor calculus equations
> this should be a great tool for learning how tenors transform with one
> another and how to represent tensor shapes appropriately using formal
> tensor notation. I think this page also describes an excellent
> screensaver. We should make sure to have awesome screensaver options for
> all of the tensor calculus visualizations that we're going through. It's
> really really cool.

The diagram the user means is **Penrose graphical notation** (tensor
diagram notation, 1971), with **birdtracks** (Cvitanović) and modern
**tensor-network diagrams** as relatives. Feynman diagrams are a
different tool (particle interactions).

Update 2026-10-17 (user, verbatim): "rename them and call them penrose
diagrams properly. put feynman diagrams over on the particle physics
collider page where approrpiate". So the view is "Penrose diagram"
everywhere a reader sees it, with the styles Penrose, Birdtrack and
Network. This page has no Feynman note; one credits line links to
../particle-collider/, where the Feynman diagrams live.

The user has called earlier pages low effort. The bar: a deep,
correct, beautiful teaching tool. Every operation is animated in all
three views at once, in step.

## Page

Key and folder `tensor-calculus`, label "Tensor Calculus". The
coordinator registers nav, catalog, home and thumbnail. Nobody else
edits lib/nav-data.js, lib/screensaver-catalog.js, pages/home/** or
PAGES.md.

Look: STIX Two Text (serif, math) and Inter (UI) from lib/sci.css. No
Playfair, Cormorant or JetBrains Mono. Sentence-case labels, no
uppercase letter-spaced HUD text. Math is MathJax SVG through
`lib/sci-math.js` (`typeset`, `colorize`); never KaTeX (it breaks in
the user's Safari).

## One index colour language (all views)

Each index letter gets one colour everywhere: in the TeX (via
`\class{iN}{...}`), on the diagram legs, and on the 3D axes and glyphs.
`palette.js` (CORE) exports `INDEX_COLORS` (8 colours, dark-theme safe,
colour-blind aware) and `indexColor(sym)`; style.css defines `.i0`
to `.i7`. Upper indices are drawn above, lower below, in every view:
TeX superscript and subscript; Penrose legs up and down; in 3D,
contravariant parts are arrows and covariant parts are stacks of planes
(level sets).

## Packages

| Package | Owns |
|---|---|
| MATH | `tensor/*.js` (DOM-free engine), `tests/math.test.mjs` |
| LIBRARY | `library/*.js` (equations, stories, examples), `tests/library.test.mjs` |
| VIZ | `viz/**` (three r160 scenes), `tests/viz.test.mjs` |
| DIAGRAM | `diagram/**` (SVG Penrose, birdtrack, network styles), `tests/diagram.test.mjs` |
| LEARN | `learn/**` (guided chapters), `tests/learn.test.mjs` |
| CORE | `index.html`, `style.css`, `main.js`, `palette.js`, `ui/**`, `tests.mjs` (runs every tests/*.test.mjs), `tests/core.test.mjs` |
| SAVER (phase 2) | `saver/**`, `tests/saver.test.mjs` |

Edit only your own files. Requests to another package go in
`NOTES.md` (append a dated line: from, to, what); work against a local
stub until the other side lands. Commit an early version of your public
API (with a header that documents it) in your first hour.

## Shared data shapes

### TensorExpr (MATH defines, everyone reads)
```js
Index   = { sym: 'mu', up: true }            // sym is a TeX name or letter
Factor  = { name: 'R', tex: 'R', indices: [Index], kind?: 'tensor'|'metric'|'inverseMetric'|'delta'|'epsilon'|'christoffel'|'partial'|'nabla'|'scalar',
            deriv?: [Index], sym?: { type: 'sym'|'antisym', slots: [i, j] }[] }
Term    = { coeff: number | string, factors: [Factor] }
TensorExpr = { terms: [Term], free: [Index], dummies: [string], tex: string }
```
`parseIndexTex(src)` reads a restricted TeX index grammar:
`R^{\rho}{}_{\sigma\mu\nu}`, `g_{\mu\nu}`, `\partial_\mu`, `\nabla_\mu`,
`\Gamma^\lambda_{\mu\nu}`, `\delta^a_b`, `\epsilon_{ijk}`, sums, products,
`=` and coefficients, `T_{(ab)}` and `T_{[ab]}`. `toTex(expr, { colors })`
writes colourised TeX. Free and dummy indices are checked (Einstein
rule: a repeated index appears once up and once down).

### OpTrace (MATH produces, every view plays)
```js
Step = { id, kind: 'product'|'contract'|'raise'|'lower'|'transform'|'symmetrize'|'antisymmetrize'
               |'partial'|'covariant'|'christoffel'|'trace'|'expandSum'|'substitute'|'relabel'|'evaluate',
         label,               // one plain sentence
         before: TensorExpr, after: TensorExpr,
         focus: [string],     // index syms this step touches
         sums: [{ sym, range: [0, n) }],
         numeric?: { inputs: { name: Components }, output: Components },
         viz?: { scene, params }, // hint for VIZ
         ms }                 // suggested duration
OpTrace = { steps: [Step], dim, metric?: string, coords?: string }
Components = { shape: [n...], variance: ['u'|'d', ...], data: Float64Array }
```
Every view exposes `play(step, t)` with t in 0..1 so CORE scrubs all
three in lock step.

### MATH API (tensor/index.js header must match)
`parseIndexTex`, `toTex`, `validate`, `Tensor` (components with
variance), `product`, `contract`, `raise`, `lower`, `transpose`,
`symmetrize`, `antisymmetrize`, `trace`, `einsum(spec, ...)`,
`transform(T, J)` (J and its inverse by variance), `METRICS` (Euclidean
2D/3D, polar, cylindrical, spherical, sphere surface, torus surface,
Minkowski, Schwarzschild, FLRW), `christoffel(metric, x)`,
`riemann(metric, x)`, `ricci`, `scalarCurvature`, `einsteinTensor`,
`leviCivita(n)`, `covariantDerivative`, `parallelTransport(metric,
curve)`, `geodesic(metric, x0, v0)`, and `trace...` builders that
return an OpTrace for each operation (`traceContract`, `traceRaise`,
`traceTransform`, `traceCovariant`, `traceRiemann`, ...). Numeric
results checked against closed forms in tests (sphere Ricci scalar
2/r^2, Schwarzschild vacuum Ricci = 0, and so on).

### LIBRARY entry (library/index.js)
```js
{ id, title, field: 'geometry'|'relativity'|'electromagnetism'|'continuum'|'mechanics'|'quantum'|'ml'|'algebra',
  tex, expr: () => TensorExpr, story: [paragraphs, plain text with $TeX$],
  vocab: [{ term, meaning }], trace: (params) => OpTrace, params: [{ key, label, min, max, step, def }],
  viz: { scene, params }, diagram: { layout hints }, refs: [{ text, url }] }
```
At least 30 entries: Kronecker delta, Levi-Civita and the cross product,
dot product with a metric, change of basis, the metric tensor of the
sphere, polar Christoffel symbols, geodesic equation, covariant
derivative of a vector, parallel transport and holonomy, Riemann
tensor, Ricci tensor and scalar, Bianchi identity, Einstein field
equations, Schwarzschild metric, FLRW, Lorentz transformation, Maxwell
F_{\mu\nu} and both Maxwell equations, electromagnetic stress-energy,
perfect fluid stress-energy, Cauchy stress and traction, strain tensor,
Hooke's law C_{ijkl}, inertia tensor, quadrupole moment, divergence
theorem, Killing equation, geodesic deviation, Weyl tensor, einsum and
tensor contraction in machine learning (attention as a contraction),
matrix trace and determinant via epsilon, and more if you like.

### VIZ API (viz/index.js)
`createViz(canvas, opts) -> { setScene(id, params), play(step, t),
setTime(s), resize(), pickIndex(sym) /* highlight */, scenes: [ids],
saverShots: [{ scene, params, camera, seconds, label }], dispose() }`.
Scenes include: vector vs covector under a basis stretch (arrows shrink,
plane stacks squeeze), basis and dual basis, curvilinear grids
(polar, spherical) with coordinate basis vectors, the metric as an
ellipse/ellipsoid field (Tissot), tensor product as an outer-product
component block, contraction as a block collapsing along matched axes,
rank-3 component cube with slices, transformation of a rank-2 tensor
(ellipsoid rotating and stretching, components updating), stress on a
cube with traction vectors, inertia ellipsoid, Lorentz boost of the
light cone and of F_{\mu\nu}, parallel transport on a sphere with the
holonomy angle, geodesics and geodesic deviation, curvature from a small
loop, Flamm paraboloid of Schwarzschild, Levi-Civita orientation cube,
Christoffel symbols as basis-vector change along a coordinate line.

### DIAGRAM API (diagram/index.js)
`createDiagram(svgHost, opts) -> { show(expr), play(step, t), setStyle('penrose'|'birdtrack'|'network'), pickIndex(sym), dispose() }`.
Penrose rules: a tensor is a node; each upper index a leg up, each lower
a leg down; a contraction joins legs; the metric is a cap or cup that
turns a leg over; the inverse metric the other one; the Kronecker delta
a plain line; epsilon a horizontal bar; symmetrisation a wavy bar,
antisymmetrisation a straight bar over the legs; a derivative a circle
or box round the node; sums of terms side by side with + signs.
Animated transitions between steps (legs swing and join, caps bend,
nodes merge), legs coloured by index.

### LEARN (learn/index.js)
Chapters, each a scroll or step story that drives the three views
through CORE's API: what a tensor is (a multilinear machine), upper and
lower indices (contravariant and covariant, with the basis-stretch
animation and the gradient as a covector), Einstein summation, the
metric and raising/lowering, tensor product and contraction,
transformation laws (Jacobians), symmetry, the covariant derivative and
Christoffel symbols, curvature, and notation (component, abstract index,
index-free, Penrose). Small inline widgets (sliders, drag the basis).

### CORE
The shell: three linked views (TeX, 3D, Diagram) in a split layout with
a focus mode for any one, the library browser (search, fields), the
step player (play, pause, scrub, speed, step list), a playground where
the user types an index expression and applies operations from a
palette (contract, raise, lower, transform, symmetrise, derivative),
the chapter menu for LEARN, an "Indices" lens that highlights one index
across all views, phone dock and sheet (wave-membrane pattern),
`[hidden]{display:none!important}`, credits. CORE exposes
`window.tensorPage = { openEntry(id), playTrace(trace), setView(...),
pickIndex(sym) }` for LEARN and SAVER.

### SAVER (phase 2)
`window.snSaver` with many shots across every VIZ scene, diagram
animations, library equations being derived step by step, the
upper/lower index demo, with calm camera moves; plateBand framing for
16:9 and 9:16; the plate carries the live TeX (tex, rules), params and a
real code extract. Several saver "channels" selectable (geometry,
relativity, notation, all).

## Validation

No headless Chrome, Playwright, CDP or browser screenshots. Allowed:
node tests (tests.mjs runs all), jsdom stub runs, node --check, naga for
WGSL, glslangValidator for GLSL, Deno WebGPU or node rasteriser renders
to small PNGs in the scratchpad that you look at and then delete.
MathJax can be run in node (vendor/mathjax@3.2.2 or the npm package in
the scratchpad) to check that every TeX string in the library typesets.

## Commits

Main, pathspec commits in one command, no add -A, amend, rebase or
stash, ASD-STE100 bodies with real validation output and a line that no
browser ran, small commits, subject `tensor-calculus: ...` under 72
characters, end with `Co-Authored-By: Claude Opus 5.5
<noreply@anthropic.com>`. Do not push.

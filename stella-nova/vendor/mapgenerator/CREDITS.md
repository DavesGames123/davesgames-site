# mapgenerator (vendored)

The City Generator page (`stella-nova/pages/map-generator/`) uses the
generation code of **MapGenerator** by **ProbableTrain** and contributors.

- Source: https://github.com/probabletrain/mapgenerator
- Upstream commit: `f487e4cee321d105d5b0e14258363fa8b4d004ef` (branch master, last push 2024-05-09)
- Licence: GNU Lesser General Public License v3.0 only (`LGPL-3.0-only`).
  The licence texts are `COPYING.LESSER` (LGPL-3.0) and `COPYING` (GPL-3.0),
  copied unchanged from the upstream repository.
- Upstream docs: https://maps.probabletrain.com

## What is in this folder

| File | What it is |
| --- | --- |
| `mapgen.js` | One ES module. Upstream `src/ts/vector.ts` and `src/ts/impl/*.ts` (tensor field, basis fields, RK4 integrator, streamlines, water generator, graph, polygon finder, polygon util, grid storage), transpiled and bundled with their npm dependencies. The logic is not changed. |
| `entry.mjs` | The bundle entry: it only re-exports the upstream classes by name. |
| `transpile.cjs` | The TypeScript-to-CommonJS step (`ts.transpileModule`, no type check). |
| `COPYING.LESSER`, `COPYING` | LGPL-3.0 and GPL-3.0, from upstream. |
| `THIRD-PARTY.txt` | The licences of the bundled npm packages. |

The upstream UI (`src/main.ts`, `src/ts/ui/*`, dat.gui, the SVG/canvas
styles, the 3D model export) is **not** used. The page has its own UI, and
`pages/map-generator/gen.js` does the work of the upstream UI glue
(parameters and call order of `main_gui.ts`, `road_gui.ts`, `water_gui.ts`,
`buildings.ts`, `tensor_field_gui.ts`).

## Bundled npm packages (versions from upstream package-lock.json)

| Package | Version | Licence |
| --- | --- | --- |
| loglevel | 1.6.7 | MIT |
| simplex-noise | 2.4.0 | MIT |
| polyk | 0.24.0 | MIT |
| jsts | 2.1.2 | EDL-1.0 or EPL-1.0 (used under EDL-1.0) |
| simplify-js | 1.2.4 | BSD-2-Clause |
| isect | 3.0.0 | MIT |
| splaytree | 2.0.3 | MIT (dependency of isect) |
| d3-quadtree | 1.0.7 | BSD-3-Clause |

## How mapgen.js was built (2026-10-08)

```sh
git clone https://github.com/probabletrain/mapgenerator.git mg
git -C mg checkout f487e4cee321d105d5b0e14258363fa8b4d004ef
mkdir build && cd build
npm i --ignore-scripts loglevel@1.6.7 isect@3.0.0 d3-quadtree@1.0.7 simplify-js@1.2.4 \
  polyk@0.24.0 jsts@2.1.2 simplex-noise@2.4.0 esbuild@0.24.0
mkdir -p src/impl && cp ../mg/src/ts/vector.ts src/ && cp ../mg/src/ts/impl/*.ts src/impl/
cp <this folder>/transpile.cjs <this folder>/entry.mjs .
node transpile.cjs          # TypeScript 6.0.3 transpileModule: src/**/*.ts -> cjs/**/*.js
npx esbuild entry.mjs --bundle --format=esm --platform=neutral --main-fields=module,main \
  --target=es2019 --legal-comments=inline --banner:js="<the comment at the top of mapgen.js>" \
  --outfile=mapgen.js
```

`transpile.cjs` loads TypeScript from a local install path. Change the path
in its first line to your own `typescript` package. The two-step build
keeps upstream's `import * as x from 'cjs-package'` calls working as they
did under upstream's browserify build.

sha256 of `mapgen.js`: `35d09ae3dcfe9ca58578fe4cce0db2e2cd18f63d7373ef14b762ddc19889f6c7`

## LGPL: how to replace this library

`mapgen.js` is a separate module. The page loads it by one import in
`pages/map-generator/gen.js` (`import * as MG from '../../vendor/mapgenerator/mapgen.js'`)
and uses only the exports named in `entry.mjs`. To use a changed or newer
MapGenerator, rebuild `mapgen.js` with the steps above from your own copy of
the upstream source and put it in this folder. No other file needs to change
while the class names and methods stay the same.

# Image Worlds: sources and licences

## Code from other projects

| What | Where here | Source | Licence |
|---|---|---|---|
| Spark 2.3.1, the Gaussian splat renderer | `stella-nova/vendor/spark@2.3.1/` | npm `@sparkjsdev/spark` 2.3.1, World Labs Technologies, Inc. (<https://github.com/sparkjsdev/spark>) | MIT (`vendor/spark@2.3.1/LICENSE`) |
| three.js r185 | `stella-nova/vendor/three@0.185.1/` (already in the repo) | <https://threejs.org/> | MIT |
| GLTFLoader, BufferGeometryUtils, SkeletonUtils r185 | `three-addons/` | npm `three` 0.185.1, `examples/jsm/`, unchanged | MIT (`three-addons/LICENSE`) |
| World folder rules: indexed names, world versions, objects, scene.json checks, the sun position, the default grid, the world transform | `worlds.js`, `objects.js`, `viewer.js` | image-blaster commit 4acb43b (`app/vite.config.ts`, `app/src/modules/`), Neilson Koerner-Safrata, <https://github.com/neilsonnn/image-blaster> | MIT (`LICENSE-image-blaster.txt`) |

The image-blaster rules are written again here in plain JavaScript (the
upstream viewer is React and TypeScript). The regular expressions of
`parseIndexedName` and the checks of `sanitizeScene` follow upstream
closely, so its licence text ships with them.

Spark 2 needs three >= 0.180, so this page maps `three` to the r185 copy,
not to the r160 copy that most pages use. GLTFLoader r185 is copied into
`three-addons/` so that the shared `vendor/three@0.185.1/` stays unchanged.

## Sample world (`worlds/sample-still-life/`)

`tools/make-sample.mjs` builds it in the image-blaster layout. It is not a
World Labs world and no paid API made any part of it.

| Part | Files | Source | Licence |
|---|---|---|---|
| Five Gaussian splats: Modern Arm Chair, Potted Plant, Fire Extinguisher, Multi Cleaner 5L, Wet Floor Sign | in `output/world/0-world-*.spz` | DX.GL Multi-View Datasets, <https://huggingface.co/datasets/dxgl/multiview-datasets> (files `https://dx.gl/splat/<name>.ply`), nerfstudio splatfacto trained on renders of Poly Haven models | CC0 1.0 ("All source 3D models are CC0 (public domain) from Polyhaven. The rendered datasets inherit this license") |
| Apple mesh | `output/apple/` | Poly Haven `food_apple_01` by Oliver Harries, 1k glTF packed to GLB | CC0 1.0 |
| Baseball mesh | `output/baseball/` | Poly Haven `baseball_01` by Rico Cilliers, 1k glTF packed to GLB | CC0 1.0 |
| Cardboard box mesh | `output/cardboard-box/` | Poly Haven `cardboard_box_01` by Rahul Chaudhary, 1k glTF packed to GLB | CC0 1.0 |
| Mesh thumbnails | `output/*/0-*-thumbnail.png` | Poly Haven asset thumbnails | CC0 1.0 |
| Studio sweep splats, collider mesh, ambient loop and impact sounds | `output/world/`, `output/sfx/`, `output/*/sfx/` | made by `tools/make-sample.mjs` for this page (sounds synthesised, encoded with LAME) | CC0 1.0 |
| Source image and thumbnail | `source/0-sample-still-life.jpg`, `output/world/0-world-thumbnail.jpg` | renders of this world on this page (`viewer.snapshot()`), Full quality | CC0 1.0 |

The splats are scaled to approximate real heights, turned to y-up, placed
and stored in OpenCV axes (flip_y true), as World Labs stores its SPZ
files. Their SH bands above degree 0 are dropped.

## Generated worlds: what the providers' terms say (read 2026-10-06)

Generated worlds are not on the page yet. Before one is published:

- **World Labs** (world splat, collider, panorama). Terms of Service,
  updated 2026-01-21, <https://worldlabs.ai/terms-of-service>. Free plan
  (3.3(a)): World Labs keeps all rights in the output and licenses it "solely
  for personal, Non-Commercial Use". Paid plan (3.3(b)): the user owns the
  output and may publish and display it for any purpose. API (3.3(d)):
  commercial use and distribution, subject to the order form. Account
  status at generation time decides (3.3(c)). On request, credit "Generated
  using World Labs" (3.7(b)); do not remove watermarks (3.7(d)). Acceptable
  Use Policy, <https://www.worldlabs.ai/aup>: say that content is AI-generated
  where people could take it for human-made.
- **FAL** (Hunyuan 3D meshes, ElevenLabs sounds). Terms of Service,
  updated 2026-09-08, <https://fal.ai/terms>: no claim on outputs and no
  warranty that they are original; third-party model terms can apply
  (14(b)). Hunyuan 3D 2.1 Community License,
  <https://huggingface.co/tencent/Hunyuan3D-2.1/blob/main/LICENSE>: "Tencent
  claims no rights in Outputs"; the licence territory excludes the EU, the
  UK and South Korea, and outputs must not train other AI models.
- **ElevenLabs** (sound effects). Terms of Use, updated 2026-03-31,
  <https://elevenlabs.io/terms-of-use>: the user keeps the rights in outputs
  (4(c)(ii)); free users are non-commercial only. Through FAL, use is paid,
  and FAL's terms apply; whether ElevenLabs' reseller clause (17) also
  applies is not stated in any document found.

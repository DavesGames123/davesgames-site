// ============================================================================
//  ARTICRAFT PLAYGROUND  ·  tools/credits.mjs — write CREDITS.md
// ----------------------------------------------------------------------------
//  This tool writes pages/articraft/CREDITS.md from data/manifest.json:
//  the sources, the licences, the changes that we made, and one credit row
//  per object. Run it after urdf2mjcf.mjs.
//
//  GREP MAP
//    DATA_COMMIT / HARNESS_COMMIT .. the source commits that we used
//    const head ..................... fixed text
//    const rows ..................... per-object table
//
//  Usage:  node tools/credits.mjs
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_COMMIT = '677ca9722427dce500873730255874c8c3f07eb2';
const HARNESS_COMMIT = '959f1455091fc8f86a489ee8cab38f686916099f';
const man = JSON.parse(fs.readFileSync(path.join(PAGE, 'data', 'manifest.json'), 'utf8'));
const gtitle = Object.fromEntries(man.groups.map(g => [g.id, g.title]));
const cell = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

const head = `# Articraft Playground: credits and licences

## Objects: Articraft dataset (CC BY 4.0)

Every object in \`data/objects/\` comes from a record of the Articraft dataset:

    Articraft Data, Matt Zhou et al., licensed under CC BY 4.0.
    https://github.com/mattzh72/articraft-data

- Licence: Creative Commons Attribution 4.0 International,
  https://creativecommons.org/licenses/by/4.0/. The licence text is the
  \`LICENSE\` file of the dataset repository.
- Source commit: \`${DATA_COMMIT}\` (branch main).
- Paper: Matt Zhou, Ruining Li, Xiaoyang Lyu, Zhaomou Song, Zhening Huang,
  Chuanxia Zheng, Christian Rupprecht, Andrea Vedaldi, Shangzhe Wu.
  "Articraft: An Agentic System for Scalable Articulated 3D Asset
  Generation", arXiv:2605.15187, 2026. Project page:
  https://articraft3d.github.io/
- Each record is a generated \`model.py\`. The table below gives the record,
  the revision, the author field of the record and a link to the record
  folder. \`data/manifest.json\` keeps the full prompt of each record,
  verbatim.

### Changes that we made (CC BY 4.0, section 3(a)(1)(B))

1. We ran each \`model.py\` with the Articraft harness (below), offline, to
   get a URDF file and OBJ meshes.
2. \`tools/urdf2mjcf.mjs\` (our code) changed the URDF into MuJoCo MJCF:
   fixed joints are merged, each moving joint has a position actuator, the
   object is moved so that it stands on z = 0, and a link with no inertial
   gets the mass of its mesh volume (convex hull for an open mesh) at
   350 kg/m^3, in the range 0.02 to 2000 kg.
3. \`tools/urdf2mjcf.mjs\` simplified the meshes with our own quadric edge
   collapse and wrote them as binary STL.
4. The titles are our own words. The dataset category is in the table.

We do not ship records from the Military & Defense group, or records whose
title or prompt names a brand or a real product (\`tools/select.py\`).

## Tools that we used and do not ship

| What | Source | Licence | Use |
|---|---|---|---|
| Articraft harness | https://github.com/mattzh72/articraft, commit \`${HARNESS_COMMIT}\` | Apache-2.0 | compiles \`model.py\` to URDF + OBJ, offline, in a sandbox (\`tools/compile.sh\`). No harness code is in this repository. |
| CadQuery 2.7.0 | https://github.com/CadQuery/cadquery | Apache-2.0 | used by the harness to make the meshes |

## Engine

MuJoCo 3.15.0 WASM, vendored at \`stella-nova/vendor/mujoco@3.15.0/\`
(Apache-2.0, copyright Google DeepMind). The page imports it through
\`pages/mujoco-lab/core/engine.js\`.

## Per-object credits

${man.objects.length} objects. Each link opens the record folder on GitHub.

| Title (ours) | Group | Dataset category | Record | Revision | Author | Licence |
|---|---|---|---|---|---|---|
`;
const rows = man.objects.map(o =>
  `| ${cell(o.title)} | ${cell(gtitle[o.group] || o.group)} | ${cell(o.category)} | [${cell(o.record)}](${o.url}) | ${cell(o.revision)} | ${cell(o.author)} | CC BY 4.0 |`).join('\n');
fs.writeFileSync(path.join(PAGE, 'CREDITS.md'), head + rows + '\n');
console.log(`CREDITS.md: ${man.objects.length} rows`);

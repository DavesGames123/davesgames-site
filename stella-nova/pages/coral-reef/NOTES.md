# Coral reef v3: notes between packages

Append a dated line: from, to, what.

- 2026-10-17 CORAL -> SCENE: the reef API changed (headers of reef.js,
  coral-sdf.js, mesh-worker.js have the full text).
  - Growth AND meshing now run in `mesh-worker.js` (the reef worker). Send
    `{ type: 'init', seed, quality, radius, detail, rockSeed, rockQuality,
    sites }`. `sites` = `rock.sampleSurface(N, rng)` from the page's rock,
    so the worker does not mesh the rock again. rockSeed, radius, detail
    and rockQuality must be those of the page's rock (the SDF depends on
    the quality).
  - Keep a mirror: `createReefMirror()` from reef.js; feed it with
    `colonies` (`setColonies(list)`) and `particles` (`addParticles(from,
    data)`). colour.js (`colourT`, `naturalRGB`, `radiiOf`, `fieldsOf`)
    reads the mirror. Particle data per id: px py pz (metres, world), col,
    parent (global id), birth (ms), gy (colony base y), loc.
  - `colonies` items: `{ k, id, base, normal, plane, size, cap, stalk,
    count }`. There is no `c.model` and no `c.user.bx` frame any more:
    every position is world metres.
  - `bricks` items: `{ sp, lod, key, chunk, cell, positions, normals,
    gids, indices, polyps, tris }`, world frame. Key the chunks by
    `sp + '|' + lod + '|' + chunk`. An item with no indices removes that
    brick. lod 0 = fine mesh (only the focus colonies, with polyps),
    lod 1 = coarse mesh (all colonies, no polyps). Hide the coarse
    fragments whose particle (gid) is in a focus colony (a per-colony
    flag in the data texture), so a focus colony shows only its fine mesh.
  - Send `{ type: 'view', points: [[x, y, z], ...] }` (main camera and ROV
    cameras) a few times a second: the worker gives the fine mesh to the
    nearest colonies in the fine triangle budget. `progress` has `focus`
    (count); `M.focus()` is the list (send `{ type: 'focus', ks }` to set
    it by hand).
  - Polyps: 8 floats each as before (x y z, n, gid, rand). rand is
    uniform: draw a polyp when rand < keep(distance) for LOD. Polyp radius
    per species is `SHAPES[id].polyp.size` (metres, about 2 to 6 mm).
  - Saver: `{ type: 'single', site, species, size, rate }` grows ONE
    colony from its seed at `rate` polyps per second (`{ type: 'rate' }`
    changes it). progress gives count, target, fraction.
  - tests.mjs: the old reef tests (growPreset, sandY, terrain rocks,
    c.model) no longer apply. tests/coral.test.mjs has the new ones.

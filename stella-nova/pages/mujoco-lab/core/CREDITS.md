# MuJoCo Lab: credits and licences

## Engine

| What | Source | Version | Licence |
|---|---|---|---|
| MuJoCo WASM build | https://github.com/google-deepmind/mujoco (npm `@mujoco/mujoco`) | 3.15.0, vendored once at `stella-nova/vendor/mujoco@3.15.0/` (see `vendor/unitree_rl_gym/CREDITS.md` for the tarball hash) | Apache-2.0, copyright Google DeepMind. The licence text is `vendor/mujoco@3.15.0/LICENSE`. The npm package has no NOTICE file. |

MuJoCo Lab does not vendor a second copy of MuJoCo.

## Models

Every model file is in `core/models/`. The table gives the source, the
exact commit, the licence and each change that we made.

### MuJoCo model folder (Apache-2.0, copyright DeepMind Technologies Limited)

Source: https://github.com/google-deepmind/mujoco/tree/3.15.0/model, tag
3.15.0, commit 9ea3cdfcae93bf2cc4dc0e1a1627c5a39a1e06e5. The Apache-2.0
text is `vendor/mujoco@3.15.0/LICENSE`. Files that have a licence header
keep it unchanged.

| File here | Upstream path | Change |
|---|---|---|
| `mujoco/humanoid/humanoid.xml` | `model/humanoid/humanoid.xml` | none (byte copy) |
| `mujoco/car/car.xml` | `model/car/car.xml` | none |
| `mujoco/cards/house_of_cards.xml` | `model/cards/house_of_cards.xml` | the 26 card-face `<texture type="2d" file="*.png">` lines are removed (about 7 MB of PNG), each card material is the plain colour `.96 .95 .92`, and a comment at the top says so |
| `mujoco/cards/assets/card.obj` | `model/cards/assets/card.obj` | none |
| `mujoco/cards/README.md` | `model/cards/README.md` | none |
| `mujoco/replicate/newton_cradle.xml`, `scene.xml`, `stonehenge.xml` | `model/replicate/` | none |
| `mujoco/slider_crank/slider_crank.xml` | `model/slider_crank/slider_crank.xml` | none |
| `mujoco/tendon_arm/arm26.xml` | `model/tendon_arm/arm26.xml` | none |
| `mujoco/sleep/dominos.xml` | `model/sleep/dominos.xml` | none |
| `mujoco/arch/roman.xml`, `README.md` | `model/arch/` | none |
| `mujoco/balloons/balloons.xml` | `model/balloons/balloons.xml` | none |

### MuJoCo Menagerie

Source: https://github.com/google-deepmind/mujoco_menagerie, commit
0059d4335f8156206f63a35662313385f7ad6d74. Each model folder has its own
LICENSE file, copied here unchanged. We checked these licences:

| Menagerie folder | Licence (from its LICENSE file) | Used |
|---|---|---|
| `franka_emika_panda` | Apache-2.0 | yes |
| `shadow_hand` | Apache-2.0 | yes |
| `google_barkour_vb`, `skydio_x2` | Apache-2.0 | no (not needed) |
| `leap_hand` | MIT | no (meshes 15 MB) |
| `universal_robots_ur5e`, `kinova_gen3`, `trossen_vx300s`, `ufactory_lite6`, `wonik_allegro`, `robotiq_2f85` | BSD-style | no |
| `unitree_go1` | BSD-3-Clause | no (the Go2 is already on the site) |

| File here | Change |
|---|---|
| `menagerie/franka_emika_panda/LICENSE`, `README.md`, `scene.xml` | none |
| `menagerie/franka_emika_panda/panda.xml` | each `<mesh file="X.obj"/>` is now `<mesh name="X" file="X.dec.stl"/>`; a comment at the top says so |
| `menagerie/franka_emika_panda/assets/*.stl` (no `.dec`) | none: these are the collision meshes |
| `menagerie/franka_emika_panda/assets/*.dec.stl` | the visual OBJ meshes, welded and decimated: 134 555 faces to 24 606 |
| `menagerie/shadow_hand/LICENSE`, `README.md`, `scene_right.xml` | none |
| `menagerie/shadow_hand/right_hand.xml` | the same mesh change as `panda.xml` |
| `menagerie/shadow_hand/assets/*.dec.stl` | the OBJ meshes, welded and decimated: 37 639 faces to 14 267; `forearm_collision` is not decimated (452 faces) |

Not copied: `*.png` images, `mjx_*` files, `hand.xml`, `panda_nohand.xml`,
the left hand and `keyframes.xml`.

The decimation script is `decimate.py` below (python 3.13, numpy 2.5,
trimesh 5.1, fast-simplification, in a venv). It welds the OBJ vertices
by position before it simplifies. The OBJ files split vertices along
their UV and normal seams, and the first version (2026-10-09) did not
weld them, so the simplifier opened holes along every seam: the Panda
kept 27 % of its surface area and the Shadow Hand 71 %. With the weld,
the surface area after decimation is 99.4 % (Panda) and 99.9 % (Shadow
Hand) of the source. The face budget is shared in proportion to the
face count of each mesh, with a floor of 40 faces. A mesh with
`collision` in its name is not decimated.

    git clone --filter=blob:none --no-checkout --sparse https://github.com/google-deepmind/mujoco_menagerie.git men
    git -C men sparse-checkout set franka_emika_panda shadow_hand && git -C men checkout 0059d433
    python -I decimate.py men/franka_emika_panda/assets out/panda 24000 40
    python -I decimate.py men/shadow_hand/assets out/shadow 14000 40
    sed 's/file="\([^"]*\)\.obj"/file="\1.dec.stl"/' panda.xml       # then name="X" added to each mesh
    sed 's/file="\([^"]*\)\.obj"/file="\1.dec.stl"/' right_hand.xml

decimate.py:

```python
import sys, os, numpy as np, trimesh, fast_simplification
src, out, budget = sys.argv[1], sys.argv[2], int(sys.argv[3])
floor = int(sys.argv[4]) if len(sys.argv) > 4 else 60
os.makedirs(out, exist_ok=True)
def load(p):
    m = trimesh.load(p, force='mesh', process=False)
    # weld by position only: OBJ seams (uv, normals) split vertices, and the
    # simplifier opens holes along every split edge
    m = trimesh.Trimesh(np.asarray(m.vertices, np.float64), np.asarray(m.faces, np.int64), process=False)
    m.merge_vertices(merge_tex=True, merge_norm=True)
    m.update_faces(m.nondegenerate_faces())
    return m
ms = {f: load(os.path.join(src, f)) for f in sorted(os.listdir(src)) if f.endswith('.obj')}
keep = min(1.0, budget / max(1, sum(len(m.faces) for m in ms.values())))
tot0 = tot1 = 0
for f, m in ms.items():
    v, t = np.asarray(m.vertices, np.float64), np.asarray(m.faces, np.int64)
    want = len(t) if 'collision' in f else max(floor, int(len(t) * keep))
    a0 = m.area
    if want < len(t):
        v, t = fast_simplification.simplify(v, t, target_reduction=1 - want / len(t))
    d = trimesh.Trimesh(v, t, process=True)
    d.export(os.path.join(out, f[:-4] + '.dec.stl'))
    tot0 += a0; tot1 += d.area
    print(f'{f:28s} faces {len(m.faces):6d} -> {len(d.faces):5d}  area ratio {d.area / a0:.3f}')
print(f'total area ratio {tot1 / tot0:.3f}')
```

The decimated meshes are visual geoms only (`contype 0`, `conaffinity 0`,
group 2), and every body of both models has an explicit `<inertial>`. Thus
the decimation does not change the masses, the inertias or the contacts.
The Panda collision meshes are the upstream STL files, and the only Shadow
Hand collision mesh (`forearm_collision`) keeps all its faces.

### Unitree robots (BSD-3-Clause, copyright Unitree Robotics)

The Go2 and H1 entries load the files that the Legged Robot Gym page
already vendors in `stella-nova/vendor/unitree_rl_gym/` (see its
`CREDITS.md` for the commits). The meshes are the convex hulls in
`derived/<robot>/collide.bin`. MuJoCo Lab copies no file of its own.

### MuJoCo Lab models (written for this site)

`lab/*.xml` and the scenes of `procedural.js` (rope, ragdolls, stacks,
chains) are ours, under the same Apache-2.0 terms as MuJoCo.
`lab/tippe_top.xml` follows the tippe top of the MuJoCo Python tutorial
(`python/tutorial.ipynb`, Apache-2.0, copyright DeepMind Technologies
Limited): same geometry and spin, our own file.

## Names

Model names (Franka Emika Panda, Shadow Hand, Unitree Go2, Unitree H1)
are factual names of the robots. They are not used as branding.

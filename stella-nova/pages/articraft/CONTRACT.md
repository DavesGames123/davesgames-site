# Articraft Playground: build contract

The user asked (2026-11-03): "articraft is a new repo i want a playable version of
for the davesgames-site. there should be some reorganizing about things related to
robotics specifically", then chose: MuJoCo physics toys, about 60 objects as a broad
mix, and a new Robotics constellation. Then: "dispatch parallel agents".

This file is the one spec. Each lane owns only the paths listed for it. A lane that
needs a change in another lane's paths writes the request in its final report.

## Sources and licences

- Records: https://github.com/mattzh72/articraft-data (CC BY 4.0). Each record is a
  generated `model.py`. Credit every object: title, record id, author, "Articraft
  dataset, CC BY 4.0", link to the record folder on GitHub.
- Harness: https://github.com/mattzh72/articraft (Apache-2.0). We run it offline to
  compile records. We do not ship its code.
- Paper: Zhou et al. 2026, "Articraft: An Agentic System for Scalable Articulated 3D
  Asset Generation", arXiv:2605.15187. Project page https://articraft3d.github.io/.
- MuJoCo 3.15.0 WASM is vendored at `stella-nova/vendor/mujoco@3.15.0/` (Apache-2.0).
- Not shipped: Military & Defense records, titles that name a brand or a real product.

Scratch (not in the repo):
  S=/private/tmp/claude-501/-Users-davidkubala-Downloads-davesgames-site/70c36212-1e83-4438-9ae1-29026f3d8fdd/scratchpad/articraft
  $S/harness        harness clone with .venv (Python 3.12, cadquery 2.7.0)
  $S/data           sparse clone of articraft-data (records_manifest.jsonl, supercategories.json)
Compile one record (writes $S/data/cache/record_materialization/<id>/model.urdf + assets/meshes/*.obj):
  cd $S/harness && sandbox-exec -p '(version 1)(allow default)(deny network*)' \
    .venv/bin/python -m cli.main compile $S/data/records/<id> --data-dir $S/data
Add a record to the sparse clone first:
  cd $S/data && git sparse-checkout add /records/<id>/record.json /records/<id>/revisions/<rev>/model.py /records/<id>/revisions/<rev>/prompt.txt

CAUTION: compile runs model.py as Python. Always use the sandbox-exec line. Before a
compile, grep model.py for imports other than cadquery/math/sdk/numpy/typing/dataclasses
and for open(, subprocess, os., socket, eval, exec, __import__. Skip a record that has any.

## Data layout (lane A writes, lanes B and C read)

    pages/articraft/data/manifest.json
    pages/articraft/data/objects/<slug>/model.xml      MJCF, meshes referenced as meshes/<name>.stl
    pages/articraft/data/objects/<slug>/meshes/*.stl   binary STL

manifest.json:

    {
      "version": 1,
      "generated": "2026-11-03",
      "groups": [ { "id": "robotic_arms_and_manipulators", "title": "Robotic Arms & Manipulators" }, ... ],
      "objects": [
        {
          "slug": "shoulder-elbow-wrist-arm",          // [a-z0-9-], unique, also the folder name
          "title": "Shoulder-elbow-wrist arm",          // short, our own words, at most 40 chars
          "group": "robotic_arms_and_manipulators",     // a groups[].id
          "category": "Shoulder Elbow Wrist Arm",       // category_title from the dataset
          "prompt": "…",                                // prompt.txt, verbatim (CC BY)
          "record": "rec_shoulderelbowwrist_arm_0001",
          "revision": "rev_000001",
          "author": "mattzh72",
          "url": "https://github.com/mattzh72/articraft-data/tree/main/records/<record>",
          "joints": [ { "name": "shoulder_hinge", "type": "hinge|slide|ball", "range": [lo, hi], "act": "a_shoulder_hinge" } ],
          "bytes": 123456,                              // model.xml + meshes, uncompressed
          "extent": 0.42                                // radius of the bounding sphere at qpos0, metres
        }
      ]
    }

model.xml rules (MJCF made from the compiled URDF by tools/urdf2mjcf.mjs):

- `<compiler angle="radian" meshdir="meshes" autolimits="true"/>`, `<option timestep="0.002" integrator="implicitfast"/>`.
- The URDF root link is one body named `root` under the worldbody. It has no joint.
  The page adds "Loose" mode itself by inserting `<freejoint name="root_free"/>` into
  `<body name="root"` before it loads the XML. The XML must keep that exact text
  `<body name="root"` once.
- URDF revolute -> hinge with range; continuous -> hinge with no range; prismatic -> slide;
  fixed -> merge into parent body; mimic -> `<equality><joint .../></equality>`.
- Inertials from URDF. A link with no inertial or mass <= 0 gets mass 0.05 at its mesh centroid.
- Every object geom: `contype="1" conaffinity="2"` (the parts of one object never collide
  with each other). Visual and collision are the same mesh geom. Colour from the URDF
  material rgba, else `0.7 0.7 0.72 1`.
- One `<position>` actuator per non-fixed joint, name `a_<joint>`, ctrlrange = the joint
  range (continuous: -3.1416..3.1416), kp scaled to the subtree mass so the joint reaches a
  target in under 1 s without oscillation; joint damping set to match.
- No floor, no light, no camera in model.xml. The page wraps it in a scene (floor contype=2
  conaffinity=1, lights, props). Units metres, z up, the object rests on z = 0 at qpos0
  (lane A shifts the root body so the lowest vertex is at z = 0).
- Size budget: each object <= 400 KB on disk, the whole data folder <= 15 MB. Lane A
  simplifies meshes (quadric decimation, keep >= 1 mm detail) to meet it.

## Page (lane B)

    pages/articraft/index.html  main.js  style.css
    pages/articraft/sim.js      scene wrap, load object, modes, props, joint drive (DOM-free, runs in node)
    pages/articraft/tests.mjs   node tests (no browser)

- Head scripts in this order: ../../lib/gpu-guard.js, ../../lib/wishlist.js, ../../lib/stats-beacon.js.
  viewport meta with viewport-fit=cover, meta description. style.css has `[hidden]{display:none!important}`.
- Reuse MuJoCo Lab: `../mujoco-lab/core/engine.js` (loadMuJoCo, createSim) and
  `../mujoco-lab/render/renderer.js` (createMjRenderer) with the three r160 module the
  mujoco-lab page uses. Do not copy those files; import them. Do not edit them.
- sim.js exports (lane C uses them):
    export function sceneXML(objectXML, { loose=false, props=[] })  -> string
    export async function loadObject(mj, entry, { get, loose, props }) -> S (createSim sim) with S.joints = entry.joints
    export function setTargets(S, values)       // values: { jointName: target }
    export function poseAt(entry, phase)         // smooth pose for auto-animate, phase in [0,1)
    export function randomPose(entry, rand)
- UI: gallery by group (thumb-less cards: title + joint count), joint sliders, keys
  (1-9 select joint, arrows move), Anchored/Loose toggle, Drop (Loose only), Animate,
  Random pose, Reset, Props (ball, 3 blocks), drag a part with the mouse spring (S.perturb).
  Credits panel per object (the manifest fields + paper link). Phone: the dock and sheet
  pattern of pages/wave-membrane (base dock with primary controls, bottom sheet in
  portrait, right drawer in landscape, 44 px targets under (pointer:coarse), camera
  view offset so the sheet never covers the object).
- URL: ?o=<slug> selects an object; the page loads only the selected object.
- Until lane A lands, use a hand-written fixture at pages/articraft/data/fixture/
  (2-joint arm made of box/cylinder STL you generate) with the same manifest shape at
  data/fixture/manifest.json. Lane A deletes nothing of it; the coordinator removes it.

## Saver and thumbnail (lane C)

    pages/articraft/saver.js            window.snSaver = { enter(opts), exit() }
    lib/screensaver-catalog.js          one line for articraft (coordinator applies it; write the line in the report)
    pages/articraft/tools/thumb.mjs     node software render (no browser) of one object -> PNG

- Saver: enter({calm, seconds, caption, seed}) returns { canvas, warmupMs }; canvas in the
  document; plateBand(h) from ../../lib/saver-clear.js frames the object in the clear band;
  a seeded shuffle of shots every 5-12 s; each shot = one object, Anchored, animating poseAt,
  slow orbit. Read lib/screensaver-catalog.js and an existing hook (pages/mujoco-lab/saver.js) first.
- Thumbnail: 640x400 JPEG q82-85 at pages/home/thumbs/articraft.jpg made from a node
  z-buffer raster of 4-6 objects (PNG from node, then `magick` to JPEG). No browser.
  The coordinator runs tools/thumbs-list.mjs and thumbs-small.mjs.

## Nav (lane D)

    lib/nav-data.js  pages/home/sectors.js  (+ the files that tools/nav-sync.js writes)

- New constellation id "robotics", label "Robotics", in the Machines region.
  Groups: "Simulation" [articraft, mujoco-lab, joints, legged-rl], "Actuators" [harmonic-drive, ball-screw].
  Page row for the new page: ["articraft", "Articraft Playground", "NEW"].
- Dynamics "Rigid Bodies & Joints" keeps only rigid-bodies: move rigid-bodies to the end of
  "Motion & Collisions" and delete the empty group. Research "Machine Learning" loses legged-rl.
  Engines & Drivetrains loses harmonic-drive and ball-screw.
- sectors.js: SECTOR_TEXT entry for robotics, BLURBS line for articraft.
- node tools/nav-sync.js, then --check exits 0; node pages/home/tests.mjs passes (the
  star chart tests at 760/900/1100 px). The chart is at capacity: re-tune with a scripted
  coordinate descent over SECTOR_TEXT at/tilt (see the nav-registry notes in git log
  2b4c39d3) that accepts only improvements.

## Rules for every lane

- No headless Chrome, Playwright, CDP or screenshots. Node checks only.
- Do not commit, push, stash, rebase or `git add -A`. Other sessions edit this repo.
  Edit only your own paths. The coordinator reviews and commits.
- Write comments and your report in ASD-STE100 Simplified Technical English.
- Final report <= 15 lines: what you wrote, the checks you ran with their real output,
  open problems.

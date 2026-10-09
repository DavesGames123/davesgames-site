# unitree_rl_gym files for pages/legged-rl

The Legged Robot Gym page (stella-nova/pages/legged-rl) runs the sim2sim
step of unitree_rl_gym in the browser. This folder holds the upstream files
it needs and the files that tools/legged-rl/convert.py made from them.

## Sources and licences

| Source | URL | Commit / version | Licence (from the file itself) |
|---|---|---|---|
| unitree_rl_gym | https://github.com/unitreerobotics/unitree_rl_gym | 276801e46c5d433564f24658bac64f254b7d2d4b (2025-07-25) | BSD-3-Clause, `LICENSE` here, copyright Unitree Robotics. The repo has no other licence file for `resources/robots/` or `deploy/pre_train/`, so the top-level BSD-3-Clause covers the MJCF, the meshes and the pretrained policies. `legged_gym/LICENSE` (BSD-3-Clause, ETH Zurich and NVIDIA) covers the training code, which is not shipped. |
| unitree_mujoco (Go2 only) | https://github.com/unitreerobotics/unitree_mujoco | 1eb6642e3f3fdfb7fb13a9794fd6a2dd93ea0e7d (2026-09-07) | BSD-3-Clause, `unitree_mujoco/LICENSE` here, copyright Unitree Robotics. No other licence file in `unitree_robots/go2/`. |
| MuJoCo WASM | https://www.npmjs.com/package/@mujoco/mujoco (source: https://github.com/google-deepmind/mujoco/tree/main/wasm) | 3.15.0, tarball sha256 e0a772ace69f51f4218ee1e09a7593c2f1daa1451ea13fd53a82b4ea62a27026 | Apache-2.0 (`license` field of package.json). The tarball has no LICENSE file, so `vendor/mujoco@3.15.0/LICENSE` is the Apache-2.0 text of the MuJoCo repository. No NOTICE file exists in the package. |

The BSD-3-Clause licences let us copy and change the files if the
copyright notice and the licence text go with them. Both LICENSE files are
in this folder. The page links to them.

## What is here

Unchanged upstream files (byte copies):

    LICENSE
    deploy/deploy_mujoco/configs/{g1,h1,h1_2}.yaml
    deploy/pre_train/{g1,h1,h1_2}/motion.pt        TorchScript policies (kept as the source of the JSON weights)
    resources/robots/g1_description/{scene.xml,g1_12dof.xml}
    resources/robots/h1/{scene.xml,h1.xml}
    resources/robots/h1_2/{scene.xml,h1_2_12dof.xml}
    unitree_mujoco/LICENSE
    unitree_mujoco/go2/{scene.xml,go2.xml}

Derived files (made by tools/legged-rl/convert.py):

    derived/<robot>/policy.json      LSTM + MLP weights of motion.pt as base64 float32, plus the deploy_mujoco config values
    derived/<robot>/reference.json   test data: torch outputs for 40 fixed inputs, and the deploy_mujoco loop run in Python MuJoCo
    derived/<robot>/collide.bin      one convex hull per upstream mesh (MuJoCo collides a mesh through its hull)
    derived/<robot>/visual.bin       render meshes, decimated with fast-simplification

The full upstream meshes (14 to 39 MB per robot) are not shipped. The
hull-only model gives the same contacts: convert.py runs the deploy loop on
both models for 10 s and prints the gap of the base path (G1 0.0000 m,
H1 0.0000 m, H1-2 0.0341 m).

Not shipped and linked only: the Isaac Gym training code (legged_gym/,
rsl_rl), the full meshes, the URDFs, and deploy_real. unitree_rl_gym has no
Go2 policy, so the page drives the Go2 with a scripted trot and says so.

## How to make the derived files again

    git clone https://github.com/unitreerobotics/unitree_rl_gym rlgym
    git -C rlgym checkout 276801e46c5d433564f24658bac64f254b7d2d4b
    git clone --filter=blob:none --sparse https://github.com/unitreerobotics/unitree_mujoco umj
    git -C umj sparse-checkout set unitree_robots/go2
    git -C umj checkout 1eb6642e3f3fdfb7fb13a9794fd6a2dd93ea0e7d
    python3 -m venv venv
    venv/bin/pip install torch==2.7.1 numpy==2.1.3 mujoco==3.15.0 trimesh==5.1.1 pyyaml==6.0.2 fast-simplification==0.2.0
    venv/bin/python -I tools/legged-rl/convert.py --rlgym rlgym --umj umj --out stella-nova/vendor/unitree_rl_gym

On 2026-10-08 a second run of these commands (torch 2.7.1, numpy 2.1.3,
mujoco 3.15.0, trimesh 5.1.1, pyyaml 6.0.2, fast-simplification 0.2.0) gave the same bytes for every file in
this folder.

MuJoCo WASM:

    npm pack @mujoco/mujoco@3.15.0
    tar -xzf mujoco-mujoco-3.15.0.tgz
    cp package/{mujoco.js,mujoco.wasm,package.json} stella-nova/vendor/mujoco@3.15.0/

Only the single-thread build is shipped (no `mt/`, no source map, no
.d.ts). The page does not need cross-origin isolation.

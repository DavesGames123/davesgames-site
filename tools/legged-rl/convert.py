#!/usr/bin/env python3
# ============================================================================
#  LEGGED RL  ·  convert.py — one-time conversion of unitree_rl_gym files
# ----------------------------------------------------------------------------
#  Reads a clone of unitreerobotics/unitree_rl_gym (BSD-3-Clause) and a
#  sparse clone of unitreerobotics/unitree_mujoco (BSD-3-Clause, Go2 only).
#  Writes stella-nova/vendor/unitree_rl_gym/:
#    upstream files, unchanged ......... LICENSE, deploy configs, motion.pt,
#                                        scene and robot MJCF
#    derived/<robot>/policy.json ....... LSTM + MLP weights (float32, base64)
#                                        and the deploy_mujoco config values
#    derived/<robot>/collide.bin ....... one convex hull per upstream mesh,
#                                        keyed by the upstream file name
#    derived/<robot>/visual.bin ........ decimated render meshes
#    derived/<robot>/reference.json .... test data: torch outputs on fixed
#                                        inputs and a deploy_mujoco rollout
#
#  Why convex hulls: MuJoCo collides a mesh through its convex hull, so a
#  hull-only file gives the same contacts as the full mesh. The full meshes
#  are 14-39 MB per robot. The script checks the claim: it runs the deploy
#  loop on the full and the hull model and stores both base paths.
#
#  Needs: python 3, torch, numpy, pyyaml, mujoco==3.15.0, trimesh,
#  fast-simplification.
#  Run:
#    python3 tools/legged-rl/convert.py --rlgym <clone> --umj <clone> \
#        --out stella-nova/vendor/unitree_rl_gym
#
#  GREP MAP
#    def export_policy ..... TorchScript -> JSON, reference outputs
#    def hull_pack ......... convex hulls in upstream file names
#    def visual_pack ....... decimated render meshes
#    def rollout ........... the deploy_mujoco loop, headless
# ============================================================================
import argparse, base64, io, json, os, re, shutil, struct, sys
import numpy as np
import torch, yaml, mujoco, trimesh, fast_simplification

ROBOTS = {
    'g1':   dict(dir='g1_description', xml='g1_12dof.xml', yaml='g1.yaml'),
    'h1':   dict(dir='h1', xml='h1.xml', yaml='h1.yaml'),
    'h1_2': dict(dir='h1_2', xml='h1_2_12dof.xml', yaml='h1_2.yaml'),
}
TRI_BUDGET = {'g1': 90000, 'h1': 70000, 'h1_2': 90000, 'go2': 60000}


def b64(a):
    return base64.b64encode(np.ascontiguousarray(a, dtype='<f4').tobytes()).decode()


def export_policy(pt, cfg, out):
    m = torch.jit.load(pt, map_location='cpu')
    sd = {k: v.detach().numpy() for k, v in m.state_dict().items()}
    acts = [getattr(m.actor, '1').original_name]
    assert acts == ['ELU'], acts
    pol = {
        'kind': 'lstm-mlp', 'hidden': int(sd['memory.weight_hh_l0'].shape[1]),
        'nobs': int(sd['memory.weight_ih_l0'].shape[1]), 'nact': int(sd['actor.2.weight'].shape[0]),
        'activation': 'elu', 'gates': 'i,f,g,o',
        'Wih': b64(sd['memory.weight_ih_l0']), 'Whh': b64(sd['memory.weight_hh_l0']),
        'bih': b64(sd['memory.bias_ih_l0']), 'bhh': b64(sd['memory.bias_hh_l0']),
        'W0': b64(sd['actor.0.weight']), 'b0': b64(sd['actor.0.bias']),
        'W1': b64(sd['actor.2.weight']), 'b1': b64(sd['actor.2.bias']),
        'h0': b64(sd['hidden_state'].reshape(-1)), 'c0': b64(sd['cell_state'].reshape(-1)),
        'shapes': {k: list(v.shape) for k, v in sd.items()},
    }
    keep = ['simulation_dt', 'control_decimation', 'kps', 'kds', 'default_angles', 'ang_vel_scale',
            'dof_pos_scale', 'dof_vel_scale', 'action_scale', 'cmd_scale', 'num_actions', 'num_obs', 'cmd_init']
    pol['cfg'] = {k: cfg[k] for k in keep}
    # reference: 40 fixed pseudo-random observations through a fresh copy
    m = torch.jit.load(pt, map_location='cpu')
    g = np.random.default_rng(7)
    xs = (g.standard_normal((40, pol['nobs'])) * 0.6).astype(np.float32)
    ys = [m(torch.from_numpy(x).unsqueeze(0)).detach().numpy().squeeze().tolist() for x in xs]
    return pol, {'inputs': xs.tolist(), 'outputs': ys}


def load_mesh(path):
    return trimesh.load(path, force='mesh', process=True)


def mesh_files(xml_text):
    return sorted(set(re.findall(r'file="([^"]+\.(?:STL|stl|obj))"', xml_text)))


def to_mesh_file(v, t, name):
    # the same bytes as meshFile() in pages/legged-rl/robot.js: OBJ text for
    # .obj names, else binary STL with zero normals (MuJoCo makes its own)
    if name.lower().endswith('.obj'):
        s = io.StringIO()
        for p in v: s.write('v %.9g %.9g %.9g\n' % tuple(float(x) for x in p))
        for f in t: s.write('f %d %d %d\n' % tuple(int(x) + 1 for x in f))
        return s.getvalue().encode()
    b = io.BytesIO()
    b.write(b'\0' * 80); b.write(struct.pack('<I', len(t)))
    for f in t:
        b.write(struct.pack('<12fH', 0, 0, 0, *v[f[0]], *v[f[1]], *v[f[2]], 0))
    return b.getvalue()


def vt_entry(name, v, t):
    v = np.asarray(v, '<f4'); t = np.asarray(t)
    assert len(v) < 65536, name
    return (name, v.tobytes() + t.astype('<u2').tobytes(), {'nv': int(len(v)), 'nt': int(len(t))})


def unpack(buf):
    n = struct.unpack('<I', buf[:4])[0]; H = json.loads(buf[4:4 + n]); base = 4 + n
    out = {}
    for e in H['files']:
        raw = buf[base + e['offset']: base + e['offset'] + e['length']]
        v = np.frombuffer(raw[:12 * e['nv']], '<f4').reshape(-1, 3)
        t = np.frombuffer(raw[12 * e['nv']:12 * e['nv'] + 6 * e['nt']], '<u2').reshape(-1, 3)
        out[e['name']] = (v, t)
    return out


def pack(entries):
    # [u32 header length][header JSON][payload]; header lists name, offset,
    # length, nv, nt. Payload per entry: float32 xyz * nv, uint16 abc * nt.
    head, blobs, off = [], [], 0
    for name, data, extra in entries:
        head.append(dict(name=name, offset=off, length=len(data), **extra)); blobs.append(data); off += len(data)
        pad = (-off) % 4; blobs.append(b'\0' * pad); off += pad
    hj = json.dumps({'files': head}).encode(); hj += b' ' * ((-len(hj)) % 4)
    return struct.pack('<I', len(hj)) + hj + b''.join(blobs)


def hull_pack(meshdir, files, prefix):
    ent = []
    for f in files:
        h = load_mesh(os.path.join(meshdir, f)).convex_hull
        ent.append(vt_entry(prefix + f, h.vertices, h.faces))
    return pack(ent)


def visual_pack(meshdir, files, budget):
    ms = {f: load_mesh(os.path.join(meshdir, f)) for f in files}
    total = sum(len(m.faces) for m in ms.values())
    keep = min(1.0, budget / max(1, total))
    ent = []
    for f, m in ms.items():
        v, t = np.asarray(m.vertices, np.float32), np.asarray(m.faces, np.int32)
        want = max(60, int(len(t) * keep))
        if len(t) > want:
            v, t = fast_simplification.simplify(v, t, target_reduction=1 - want / len(t))
        ent.append(vt_entry(f, v, t))
    return pack(ent), total, sum(e[2]['nt'] for e in ent)


def gravity_orientation(q):
    qw, qx, qy, qz = q
    return np.array([2 * (-qz * qx + qw * qy), -2 * (qz * qy + qw * qx), 1 - 2 * (qw * qw + qz * qz)])


def rollout(model, pt, cfg, seconds=10.0):
    # deploy/deploy_mujoco/deploy_mujoco.py without the viewer and the sleep
    m = model; d = mujoco.MjData(m); m.opt.timestep = cfg['simulation_dt']
    pol = torch.jit.load(pt, map_location='cpu')
    kps = np.array(cfg['kps'], np.float32); kds = np.array(cfg['kds'], np.float32)
    da = np.array(cfg['default_angles'], np.float32); na = cfg['num_actions']
    cmd = np.array(cfg['cmd_init'], np.float32); cs = np.array(cfg['cmd_scale'], np.float32)
    action = np.zeros(na, np.float32); target = da.copy(); obs = np.zeros(cfg['num_obs'], np.float32)
    counter, path, first = 0, [], []
    steps = int(round(seconds / cfg['simulation_dt']))
    for _ in range(steps):
        d.ctrl[:] = (target - d.qpos[7:]) * kps + (np.zeros_like(kds) - d.qvel[6:]) * kds
        mujoco.mj_step(m, d); counter += 1
        if counter % cfg['control_decimation'] == 0:
            qj = (d.qpos[7:] - da) * cfg['dof_pos_scale']; dqj = d.qvel[6:] * cfg['dof_vel_scale']
            ph = counter * cfg['simulation_dt'] % 0.8 / 0.8
            obs[:3] = d.qvel[3:6] * cfg['ang_vel_scale']; obs[3:6] = gravity_orientation(d.qpos[3:7])
            obs[6:9] = cmd * cs; obs[9:9 + na] = qj; obs[9 + na:9 + 2 * na] = dqj
            obs[9 + 2 * na:9 + 3 * na] = action; obs[9 + 3 * na:9 + 3 * na + 2] = [np.sin(2 * np.pi * ph), np.cos(2 * np.pi * ph)]
            action = pol(torch.from_numpy(obs).unsqueeze(0)).detach().numpy().squeeze()
            target = action * cfg['action_scale'] + da
            k = counter // cfg['control_decimation']
            if k <= 3: first.append({'obs': obs.tolist(), 'action': action.tolist()})
            if k % 25 == 0: path.append([round(float(counter * cfg['simulation_dt']), 4)] + [float(x) for x in d.qpos[:3]])
    return {'path': path, 'first': first}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rlgym', required=True); ap.add_argument('--umj', required=True); ap.add_argument('--out', required=True)
    a = ap.parse_args()
    out = a.out
    os.makedirs(out, exist_ok=True)
    shutil.copy(os.path.join(a.rlgym, 'LICENSE'), os.path.join(out, 'LICENSE'))
    for r, R in ROBOTS.items():
        print('==', r)
        cfg_rel = f'deploy/deploy_mujoco/configs/{R["yaml"]}'; pt_rel = f'deploy/pre_train/{r}/motion.pt'
        rdir = f'resources/robots/{R["dir"]}'
        for rel in [cfg_rel, pt_rel, f'{rdir}/scene.xml', f'{rdir}/{R["xml"]}']:
            os.makedirs(os.path.dirname(os.path.join(out, rel)), exist_ok=True)
            shutil.copy(os.path.join(a.rlgym, rel), os.path.join(out, rel))
        cfg = yaml.safe_load(open(os.path.join(a.rlgym, cfg_rel)))
        dd = os.path.join(out, 'derived', r); os.makedirs(dd, exist_ok=True)
        pol, ref = export_policy(os.path.join(a.rlgym, pt_rel), cfg, dd)
        robot_xml = open(os.path.join(a.rlgym, rdir, R['xml'])).read()
        files = mesh_files(robot_xml)
        meshdir = os.path.join(a.rlgym, rdir, 'meshes')
        hp = hull_pack(meshdir, files, 'meshes/')
        vp, t0, t1 = visual_pack(meshdir, files, TRI_BUDGET[r])
        open(os.path.join(dd, 'collide.bin'), 'wb').write(hp)
        open(os.path.join(dd, 'visual.bin'), 'wb').write(vp)
        print(f'  meshes {len(files)}  triangles {t0} -> {t1}  collide.bin {len(hp)}  visual.bin {len(vp)}')
        pol['robot'] = r; pol['scene'] = f'{rdir}/scene.xml'; pol['xml'] = f'{rdir}/{R["xml"]}'
        json.dump(pol, open(os.path.join(dd, 'policy.json'), 'w'), separators=(',', ':'))
        # rollouts: the full upstream meshes, then the hull meshes
        scene = open(os.path.join(a.rlgym, rdir, 'scene.xml')).read()
        full = {R['xml']: robot_xml.encode()}
        for f in files: full['meshes/' + f] = open(os.path.join(meshdir, f), 'rb').read()
        hull = {R['xml']: robot_xml.encode()}
        for name, (v, t) in unpack(hp).items(): hull[name] = to_mesh_file(v, t, name)
        pt = os.path.join(a.rlgym, pt_rel)
        rf = rollout(mujoco.MjModel.from_xml_string(scene, full), pt, cfg)
        rh = rollout(mujoco.MjModel.from_xml_string(scene, hull), pt, cfg)
        dmax = max(np.hypot(p[1] - q[1], p[2] - q[2]) for p, q in zip(rf['path'], rh['path']))
        print(f'  full-mesh end {rf["path"][-1]}  hull end {rh["path"][-1]}  max xy gap {dmax:.4f} m')
        ref.update({'rollout_full': rf, 'rollout_hull': rh, 'mujoco': mujoco.__version__})
        json.dump(ref, open(os.path.join(dd, 'reference.json'), 'w'), separators=(',', ':'))
    # Go2: unitree_mujoco MJCF, no policy in unitree_rl_gym
    print('== go2')
    g = os.path.join(a.umj, 'unitree_robots/go2'); gout = os.path.join(out, 'unitree_mujoco/go2')
    os.makedirs(gout, exist_ok=True)
    for f in ['go2.xml', 'scene.xml']: shutil.copy(os.path.join(g, f), os.path.join(gout, f))
    shutil.copy(os.path.join(a.umj, 'LICENSE'), os.path.join(out, 'unitree_mujoco/LICENSE'))
    gx = open(os.path.join(g, 'go2.xml')).read(); files = mesh_files(gx)
    hp = hull_pack(os.path.join(g, 'assets'), files, 'assets/')
    vp, t0, t1 = visual_pack(os.path.join(g, 'assets'), files, TRI_BUDGET['go2'])
    dd = os.path.join(out, 'derived', 'go2'); os.makedirs(dd, exist_ok=True)
    open(os.path.join(dd, 'collide.bin'), 'wb').write(hp); open(os.path.join(dd, 'visual.bin'), 'wb').write(vp)
    print(f'  meshes {len(files)}  triangles {t0} -> {t1}  collide.bin {len(hp)}  visual.bin {len(vp)}')


if __name__ == '__main__':
    main()

"""gltf_read.py - read triangle meshes from a .gltf file (with a .bin buffer).

CT Lab 3D data tool. It reads only geometry: positions, indices, the node
transforms and the mesh, node and material names. Textures are not read.
Draco and meshopt compression are not supported (the models we use have none).

    from gltf_read import read_gltf
    parts = read_gltf('Model.gltf')   # list of dicts:
        # { name, node, mesh, material, pos: float32 (n,3) world space, tri: int32 (m,3) }

Script use (print a summary with watertightness):
    python3 -I tools/ct-lab-3d/gltf_read.py Model.gltf

grep handles: def read_gltf, def node_matrices, def edge_report, COMP
"""
import json
import os
import sys

import numpy as np

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def _accessor(g, bufs, i):
    a = g['accessors'][i]
    if 'sparse' in a:
        raise ValueError('sparse accessors are not supported')
    bv = g['bufferViews'][a['bufferView']]
    buf = bufs[bv['buffer']]
    dt = np.dtype(COMP[a['componentType']])
    n = NCOMP[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0) or dt.itemsize * n
    cnt = a['count']
    if stride == dt.itemsize * n:
        arr = np.frombuffer(buf, dtype=dt, count=cnt * n, offset=off).reshape(cnt, n)
    else:
        rows = [np.frombuffer(buf, dtype=dt, count=n, offset=off + k * stride) for k in range(cnt)]
        arr = np.stack(rows)
    if a.get('normalized'):
        raise ValueError('normalized position accessors are not supported')
    return arr


def _quat_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0],
        [0, 0, 0, 1]])


def _local(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    T = np.eye(4)
    if 'translation' in n:
        T[:3, 3] = n['translation']
    R = _quat_mat(n['rotation']) if 'rotation' in n else np.eye(4)
    S = np.diag(list(n.get('scale', [1, 1, 1])) + [1])
    return T @ R @ S


def node_matrices(g):
    """World matrix of every node reached from the default scene."""
    out = {}
    scene = g['scenes'][g.get('scene', 0)]

    def walk(i, M):
        W = M @ _local(g['nodes'][i])
        out[i] = W
        for c in g['nodes'][i].get('children', []):
            walk(c, W)
    for r in scene['nodes']:
        walk(r, np.eye(4))
    return out


def read_gltf(path):
    g = json.load(open(path))
    base = os.path.dirname(path)
    bufs = []
    for b in g['buffers']:
        with open(os.path.join(base, b['uri']), 'rb') as f:
            bufs.append(f.read())
    mats = node_matrices(g)
    parts = []
    for ni, M in mats.items():
        node = g['nodes'][ni]
        if 'mesh' not in node:
            continue
        mesh = g['meshes'][node['mesh']]
        for pi, prim in enumerate(mesh['primitives']):
            if prim.get('mode', 4) != 4:
                continue
            if 'extensions' in prim and ('KHR_draco_mesh_compression' in prim['extensions']):
                raise ValueError('Draco is not supported: ' + path)
            pos = _accessor(g, bufs, prim['attributes']['POSITION']).astype(np.float64)
            if 'indices' in prim:
                idx = _accessor(g, bufs, prim['indices']).reshape(-1).astype(np.int64)
            else:
                idx = np.arange(len(pos), dtype=np.int64)
            tri = idx.reshape(-1, 3)
            P = np.c_[pos, np.ones(len(pos))] @ M.T
            P = P[:, :3]
            if np.linalg.det(M[:3, :3]) < 0:
                tri = tri[:, ::-1]
            mat = prim.get('material')
            parts.append({
                'name': node.get('name') or mesh.get('name') or f'node{ni}',
                'node': ni, 'mesh': mesh.get('name', ''), 'prim': pi,
                'material': g['materials'][mat].get('name', f'mat{mat}') if mat is not None else '',
                'pos': P.astype(np.float32), 'tri': tri.astype(np.int32),
            })
    return parts


def weld(pos, tri, eps):
    """Merge vertices closer than eps (grid snap). Returns (pos, tri)."""
    q = np.round(pos / eps).astype(np.int64)
    _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    return pos[first], inv[tri]


def edge_report(pos, tri, eps=None):
    """Counts of boundary edges (used once) and non-manifold edges (used 3+ times) after a weld."""
    if eps is None:
        ext = pos.max(0) - pos.min(0)
        eps = float(max(ext.max(), 1e-9)) * 1e-6
    p, t = weld(pos, tri, eps)
    t = t[(t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])]
    e = np.sort(np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]]), axis=1)
    _, cnt = np.unique(e, axis=0, return_counts=True)
    return {'tris': int(len(t)), 'verts': int(len(p)), 'boundary': int((cnt == 1).sum()), 'nonmanifold': int((cnt > 2).sum())}


def signed_volume(pos, tri):
    a, b, c = pos[tri[:, 0]].astype(np.float64), pos[tri[:, 1]].astype(np.float64), pos[tri[:, 2]].astype(np.float64)
    return float(np.einsum('ij,ij->i', a, np.cross(b, c)).sum() / 6.0)


if __name__ == '__main__':
    parts = read_gltf(sys.argv[1])
    allp = np.concatenate([p['pos'] for p in parts])
    lo, hi = allp.min(0), allp.max(0)
    print(f'{len(parts)} parts, bbox {lo.round(4)} .. {hi.round(4)}, size {(hi - lo).round(4)}')
    for p in parts:
        r = edge_report(p['pos'], p['tri'])
        ext = p['pos'].max(0) - p['pos'].min(0)
        print(f"  {p['name'][:34]:34s} mat={p['material'][:22]:22s} tris={r['tris']:7d} open={r['boundary']:6d} nm={r['nonmanifold']:5d} "
              f"vol={signed_volume(p['pos'], p['tri']):+.3e} ext={ext.round(3)}")

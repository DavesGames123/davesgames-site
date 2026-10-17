#!/usr/bin/env python3
# ============================================================================
#  PLANT GROWTH  ·  pack the ground props (offline tool, not loaded by the page)
# ----------------------------------------------------------------------------
#  In: Poly Haven glTF 1k models (CC0, polyhaven.com) in SRC/<id>/:
#    rock_moss_set_01, tree_stump_01 (opaque), fern_02, celandine_01,
#    grass_medium_01 (foliage, with the separate 1k alpha png).
#  Out (OUT/assets):
#    props.bin   all meshes: Uint16 positions (in the mesh box), Int8
#                normals (x127), Uint16 uvs (in the uv box), Uint16
#                indices, one block after the other, each 4-byte aligned
#    props.json  the table: per mesh its set, offsets and counts, and its
#                bounding box; per set its textures and whether it is
#                foliage (alpha tested, two sided, sways)
#    prop-<set>-color.jpg, prop-<set>-normal.jpg, prop-<set>-alpha.png
#  The node translations of a set (the layout in the source file) are left
#  out: each mesh sits at its own origin, its base moved to y = 0.
#  RUN   python3 -I tools/prep-props.py SRC OUT
# ============================================================================
import sys, os, json, struct
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
A = os.path.join(OUT, 'assets'); os.makedirs(A, exist_ok=True)
SETS = [
    ('rocks', 'rock_moss_set_01', False, 1024),
    ('stump', 'tree_stump_01', False, 1024),
    ('fern', 'fern_02', True, 512),
    ('celandine', 'celandine_01', True, 512),
    ('grass', 'grass_medium_01', True, 512),
]
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def accessor(g, bins, k):
    a = g['accessors'][k]; bv = g['bufferViews'][a['bufferView']]
    buf = bins[bv['buffer']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n, c, t = a['count'], NC[a['type']], CT[a['componentType']]
    stride = bv.get('byteStride', 0)
    item = np.dtype(t).itemsize * c
    if stride and stride != item:
        raw = np.frombuffer(buf, np.uint8, count=stride * (n - 1) + item, offset=off)
        rows = np.lib.stride_tricks.as_strided(raw, shape=(n, item), strides=(stride, 1))
        return np.frombuffer(rows.copy().tobytes(), t).reshape(n, c)
    return np.frombuffer(buf, t, count=n * c, offset=off).reshape(n, c) if c > 1 else np.frombuffer(buf, t, count=n, offset=off)

def quat_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]], np.float32)

blob = bytearray()
table = {'meshes': [], 'sets': {}}
def push(arr):
    global blob
    while len(blob) % 4: blob += b'\0'
    off = len(blob); blob += arr.tobytes(); return off

for name, sid, foliage, tsize in SETS:
    d = os.path.join(SRC, sid)
    g = json.load(open(os.path.join(d, 'model.gltf')))
    bins = [open(os.path.join(d, b['uri']), 'rb').read() for b in g['buffers']]
    for node in g['nodes']:
        if 'mesh' not in node: continue
        M = np.eye(3, dtype=np.float32)
        if 'rotation' in node: M = quat_mat(node['rotation'])
        if 'scale' in node: M = M * np.array(node['scale'], np.float32)[None, :]
        for p in g['meshes'][node['mesh']]['primitives']:
            pos = accessor(g, bins, p['attributes']['POSITION']).astype(np.float32) @ M.T
            nrm = accessor(g, bins, p['attributes']['NORMAL']).astype(np.float32) @ M.T
            nrm /= np.maximum(1e-6, np.linalg.norm(nrm, axis=1, keepdims=True))
            uv = accessor(g, bins, p['attributes']['TEXCOORD_0']).astype(np.float32)
            idx = accessor(g, bins, p['indices']).astype(np.uint32)
            pos[:, 1] -= pos[:, 1].min()          # the base on the ground
            ctr = (pos[:, [0, 2]].max(0) + pos[:, [0, 2]].min(0)) / 2
            pos[:, 0] -= ctr[0]; pos[:, 2] -= ctr[1]
            assert np.isfinite(pos).all() and np.isfinite(uv).all() and len(pos) < 65536
            lo, hi = pos.min(0), pos.max(0)
            ulo, uhi = uv.min(0), uv.max(0)
            q = lambda a, l, h: np.round((a - l) / np.maximum(h - l, 1e-9) * 65535).astype(np.uint16)
            m = {'set': name, 'name': node.get('name', ''), 'n': int(len(pos)), 'i': int(len(idx)),
                 'pos': push(q(pos, lo, hi)), 'nrm': push(np.clip(np.round(nrm * 127), -127, 127).astype(np.int8)),
                 'uv': push(q(uv, ulo, uhi)), 'idx': push(idx.astype(np.uint16)),
                 'box': [round(float(v), 5) for v in list(lo) + list(hi)],
                 'uvBox': [round(float(v), 6) for v in list(ulo) + list(uhi)]}
            table['meshes'].append(m)
    imgs = [im['uri'] for im in g['images']]
    pick = lambda key: os.path.join(d, [u for u in imgs if key in u][0])
    Image.open(pick('_diff_')).convert('RGB').resize((tsize, tsize), Image.LANCZOS).save(os.path.join(A, 'prop-%s-color.jpg' % name), quality=82, optimize=True)
    Image.open(pick('_nor_gl_')).convert('RGB').resize((tsize // 2, tsize // 2), Image.LANCZOS).save(os.path.join(A, 'prop-%s-normal.jpg' % name), quality=84, optimize=True)
    s = {'foliage': foliage, 'color': 'prop-%s-color.jpg' % name, 'normal': 'prop-%s-normal.jpg' % name}
    if foliage:
        al = os.path.join(d, 'textures', '%s_alpha_1k.png' % sid)
        Image.open(al).convert('L').resize((tsize, tsize), Image.LANCZOS).save(os.path.join(A, 'prop-%s-alpha.png' % name), optimize=True)
        s['alpha'] = 'prop-%s-alpha.png' % name
    table['sets'][name] = s

open(os.path.join(A, 'props.bin'), 'wb').write(bytes(blob))
table['bytes'] = len(blob)
json.dump(table, open(os.path.join(A, 'props.json'), 'w'), separators=(',', ':'))
print('props', len(table['meshes']), 'meshes,', len(blob), 'bytes;', {k: sum(1 for m in table['meshes'] if m['set'] == k) for k in table['sets']})

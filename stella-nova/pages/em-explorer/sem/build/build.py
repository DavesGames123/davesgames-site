#!/usr/bin/env python3
# ============================================================================
#  EM EXPLORER  ·  sem/build/build.py — makes the surface scan GLB files
# ----------------------------------------------------------------------------
#  Input:  sem/build/sources.json (URLs, checksums, licences, parameters).
#  Output: sem/models/<id>.glb and sem/models/manifest.json.
#
#  RUN
#    python3 -I sem/build/build.py --scratch <dir> --pylib <dir> [--only id,id]
#  --scratch  a folder for the downloads (about 300 MB at the peak).
#             The script downloads each file once, checks its md5 or sha1,
#             and does not delete it. Delete the folder when you are done.
#  --pylib    a folder with fast-simplification 0.1.9 (MIT), for example
#             python3 -m pip install --target <dir> fast-simplification==0.1.9
#             (then delete the numpy copy that pip puts in <dir>).
#  Also needs numpy and opencv-python (cv2, Apache 2.0) in the interpreter.
#
#  TWO KINDS OF SOURCE
#    mesh    a 3D mesh from SEM photogrammetry (STL, or OBJ with a texture).
#            Weld, decimate to targetFaces (quadric, fast-simplification),
#            put the long axis on x, and bake the texture grey into COLOR_0.
#    stereo  a red-cyan anaglyph of two SEM images at two tilts. The red
#            channel is the left view, green is the right view. OpenCV
#            StereoSGBM gives the parallax p (pixels); a left-right check
#            removes bad matches; holes are filled and smoothed. The height
#            is h = p * um_per_px / (2 sin(tilt / 2)), with tilt from the
#            record or tiltDegDefault. um_per_px comes from the scale bar
#            in the SEM data bar of the image. The left view is the texture.
#
#  GLB LAYOUT (glTF 2.0, KHR_mesh_quantization, all units um)
#    POSITION   SHORT normalized VEC3 (padded to 8 bytes); the node scale and
#               translation give um
#    NORMAL     BYTE normalized VEC3 (padded to 4 bytes)
#    COLOR_0    UNSIGNED_BYTE normalized VEC4, grey (mesh with a texture)
#    TEXCOORD_0 UNSIGNED_SHORT normalized VEC2 (stereo), plus the JPEG image
#    indices    UNSIGNED_SHORT if fewer than 65536 vertices, else UNSIGNED_INT
#    asset.copyright has the credit; asset.extras has id, unit, sizeUm.
#
#  grep -n targets
#    download ........ "def fetch"
#    STL / OBJ ....... "def read_stl" "def read_obj"
#    decimate ........ "def decimate"
#    scale bar ....... "def find_scale_bar"
#    stereo .......... "def stereo_height"
#    height mesh ..... "def height_mesh"
#    GLB writer ...... "def write_glb"
# ============================================================================
import argparse
import hashlib
import json
import math
import os
import struct
import sys
import time
import urllib.request

import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
SEM = os.path.dirname(HERE)
UA = 'davesgames-site/1.0 (https://davesgames.site; sem build)'


# ── download ────────────────────────────────────────────────────────────────
def fetch(f, scratch):
    path = os.path.join(scratch, f['name'])
    if not os.path.exists(path):
        req = urllib.request.Request(f['url'], headers={'User-Agent': UA})
        tmp = path + '.part'
        with urllib.request.urlopen(req, timeout=120) as r, open(tmp, 'wb') as out:
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                out.write(b)
        os.replace(tmp, path)
    algo = 'md5' if 'md5' in f else 'sha1'
    h = hashlib.new(algo)
    with open(path, 'rb') as fh:
        for b in iter(lambda: fh.read(1 << 20), b''):
            h.update(b)
    if h.hexdigest() != f[algo]:
        raise SystemExit(f'{f["name"]}: {algo} {h.hexdigest()} is not {f[algo]}')
    return path


# ── mesh readers ────────────────────────────────────────────────────────────
def read_stl(path):
    b = open(path, 'rb').read()
    n = struct.unpack_from('<I', b, 80)[0]
    if 84 + 50 * n != len(b):
        raise SystemExit(f'{path}: not a binary STL')
    dt = np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
    tri = np.frombuffer(b, dt, n, 84)['v'].reshape(-1, 3).astype(np.float64)
    return weld(tri, np.arange(len(tri)).reshape(-1, 3))


def weld(points, faces):
    span = np.ptp(points, 0).max()
    key = np.round(points / (span * 1e-6)).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    f = inv.reshape(-1)[faces]
    good = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])
    return points[first], f[good]


def read_obj(path, tex_path):
    """Positions, faces and a grey value per position from the texture."""
    with open(path, 'rb') as fh:
        lines = fh.read().split(b'\n')
    v, vt, fv, ft = [], [], [], []
    for ln in lines:
        if ln.startswith(b'v '):
            v.append(ln[2:])
        elif ln.startswith(b'vt '):
            vt.append(ln[3:])
        elif ln.startswith(b'f '):
            parts = ln[2:].split()
            if len(parts) < 3:
                continue
            ids = [p.split(b'/') for p in parts]
            for k in range(1, len(ids) - 1):       # fan the polygon
                tri = (ids[0], ids[k], ids[k + 1])
                fv.append([int(t[0]) for t in tri])
                ft.append([int(t[1]) if len(t) > 1 and t[1] else 0 for t in tri])
    del lines
    P = np.array([np.array(s.split()[:3], dtype=np.float64) for s in v])
    F = np.array(fv, dtype=np.int64)
    F = np.where(F > 0, F - 1, F + len(P))
    grey = None
    if vt and tex_path:
        T = np.array([np.array(s.split()[:2], dtype=np.float64) for s in vt])
        FT = np.array(ft, dtype=np.int64) - 1
        img = cv2.imread(tex_path, cv2.IMREAD_GRAYSCALE).astype(np.float32)
        h, w = img.shape
        uv = T[FT.reshape(-1)]
        x = np.clip((uv[:, 0] % 1.0) * (w - 1), 0, w - 1).astype(np.int64)
        y = np.clip((1 - (uv[:, 1] % 1.0)) * (h - 1), 0, h - 1).astype(np.int64)
        g = img[y, x]
        acc = np.bincount(F.reshape(-1), g, len(P))
        cnt = np.bincount(F.reshape(-1), None, len(P))
        grey = np.where(cnt > 0, acc / np.maximum(cnt, 1), 128.0)
    used = np.zeros(len(P), bool)
    used[F.reshape(-1)] = True
    remap = np.cumsum(used) - 1
    P2, F2 = P[used], remap[F]
    G2 = grey[used] if grey is not None else None
    # weld duplicate positions (keep the grey of the first)
    span = np.ptp(P2, 0).max()
    key = np.round(P2 / (span * 1e-6)).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    F3 = inv.reshape(-1)[F2]
    good = (F3[:, 0] != F3[:, 1]) & (F3[:, 1] != F3[:, 2]) & (F3[:, 0] != F3[:, 2])
    return P2[first], F3[good], (G2[first] if G2 is not None else None)


def decimate(points, faces, target):
    import fast_simplification as fs
    if len(faces) <= target:
        return points, faces
    red = 1.0 - target / len(faces)
    p, f = fs.simplify(points.astype(np.float32), faces.astype(np.int32), red, agg=7)
    return p.astype(np.float64), f.astype(np.int64)


def vertex_normals(p, f):
    n = np.zeros_like(p)
    fn = np.cross(p[f[:, 1]] - p[f[:, 0]], p[f[:, 2]] - p[f[:, 0]])
    for k in range(3):
        np.add.at(n, f[:, k], fn)
    l = np.linalg.norm(n, axis=1, keepdims=True)
    n = n / np.where(l > 0, l, 1)
    n[l[:, 0] == 0] = (0, 0, 1)            # a vertex with no face: any unit normal
    return n


def principal_frame(p):
    """Rotate so the long axis is x and the short axis is z (a right-handed frame)."""
    c = (p.min(0) + p.max(0)) / 2
    q = p - c
    w, vec = np.linalg.eigh(np.cov(q.T))
    R = vec[:, ::-1]
    if np.linalg.det(R) < 0:
        R[:, 2] *= -1
    q = q @ R
    return q - (q.min(0) + q.max(0)) / 2


def carry_grey(src_p, src_g, dst_p):
    """Grey of each decimated vertex: the mean over its 6 nearest source vertices."""
    from scipy.spatial import cKDTree
    _, idx = cKDTree(src_p).query(dst_p, k=6)
    return src_g[idx].mean(1)


# ── stereo ──────────────────────────────────────────────────────────────────
def find_data_bar(img):
    g = img.mean(2)
    dark = (g < 30).mean(1)
    h = img.shape[0]
    r, top = h - 1, h
    while r > h * 0.8:
        if dark[r] > 0.5:
            top = r
        elif top - r > 4:          # more than 4 rows that are not dark: the image
            break
        r -= 1
    if h - top < 10:
        raise SystemExit('no SEM data bar found')
    return top


def find_scale_bar(img, bar0):
    """Length in px of the scale bar: the longest bright row run in the data bar (gaps of 3 px or less)."""
    g = img[bar0:].max(2)
    best = 0
    for row in g:
        on = row > 90
        run, gap, x0 = 0, 0, -1
        for x, b in enumerate(on):
            if b:
                if x0 < 0:
                    x0 = x
                gap = 0
                run = x - x0 + 1
                best = max(best, run)
            elif x0 >= 0:
                gap += 1
                if gap > 3:
                    x0, gap = -1, 0
    return best


def sgbm(a, b, dmin, ndisp, bs=5):
    m = cv2.StereoSGBM_create(minDisparity=dmin, numDisparities=ndisp, blockSize=bs,
                              P1=8 * bs * bs, P2=32 * bs * bs, disp12MaxDiff=-1,
                              uniquenessRatio=8, speckleWindowSize=80, speckleRange=2,
                              mode=cv2.STEREO_SGBM_MODE_SGBM_3WAY)
    return m.compute(a, b).astype(np.float32) / 16.0


def affine_rectify(L, R, seed=1):
    """Epipolar rows for an SEM pair. An SEM image is close to a parallel
    projection, so the fundamental matrix is affine:
        a x2 + b y2 + c x1 + d y1 + e = 0      (SIFT matches, RANSAC)
    A1 turns the left view and A2 turns and scales the right view so that a
    matched point has the same row in both. A1 has no scale, so a parallax
    in the rectified frame is a parallax in left-view pixels."""
    sift = cv2.SIFT_create(6000)
    k1, d1 = sift.detectAndCompute(L, None)
    k2, d2 = sift.detectAndCompute(R, None)
    m = cv2.BFMatcher().knnMatch(d1, d2, k=2)
    good = [x[0] for x in m if len(x) == 2 and x[0].distance < 0.75 * x[1].distance]
    if len(good) < 30:
        raise SystemExit(f'only {len(good)} SIFT matches between the two views')
    p1 = np.float64([k1[g.queryIdx].pt for g in good])
    p2 = np.float64([k2[g.trainIdx].pt for g in good])
    M = np.c_[p2, p1, np.ones(len(p1))]

    def fit(ix):
        A = M[ix, :4]
        mu = A.mean(0)
        f = np.linalg.svd(A - mu)[2][-1]
        return np.r_[f, -mu @ f]

    rng = np.random.default_rng(seed)
    bestin = None
    np.seterr(all='ignore')                     # 4-point samples can be degenerate
    if True:
        for _ in range(2000):
            f = fit(rng.choice(len(M), 4, replace=False))
            inl = np.abs(M @ f) / max(np.hypot(f[2], f[3]), 1e-12) < 1.5
            if bestin is None or inl.sum() > bestin.sum():
                bestin = inl
    f = fit(np.where(bestin)[0])
    if f[3] < 0:                     # the left normal points down the rows: no flip
        f = -f
    a, b, c, d, e = f

    def rot_to_y(nx, ny):
        ang = np.arctan2(nx, ny)
        cs, sn = np.cos(ang), np.sin(ang)
        return np.array([[cs, -sn], [sn, cs]]), np.hypot(nx, ny)

    R1, n1 = rot_to_y(c, d)
    R2, n2 = rot_to_y(-a, -b)
    A1 = np.c_[R1, np.zeros(2)]
    A2 = np.c_[R2, np.zeros(2)]
    A2[1] = (n2 * A2[1] - np.array([0, 0, e])) / n1     # row of a right point = row of its left match
    q1 = p1[bestin] @ A1[:, :2].T + A1[:, 2]
    q2 = p2[bestin] @ A2[:, :2].T + A2[:, 2]
    H, W = L.shape
    corners = np.array([[0, 0], [W, 0], [0, H], [W, H]], float)
    allc = np.r_[corners @ A1[:, :2].T + A1[:, 2], corners @ A2[:, :2].T + A2[:, 2]]
    lo, hi = allc.min(0), allc.max(0)
    A1[:, 2] -= lo
    A2[:, 2] -= lo
    dx = q1[:, 0] - q2[:, 0]
    info = {'matches': len(good), 'inliers': int(bestin.sum()),
            'rowResidualPx': round(float(np.std(q1[:, 1] - q2[:, 1])), 3),
            'epipolarDeg': round(float(np.degrees(np.arctan2(c, d))), 2),
            'parallaxPctPx': [round(float(x), 1) for x in np.percentile(dx, [2, 50, 98])]}
    return A1, A2, (int(np.ceil(hi[0] - lo[0])), int(np.ceil(hi[1] - lo[1]))), dx, info


def stereo_height(img, bar0, work_w=1024, margin_px=None):
    """Parallax map in px of the work image, in the frame of the left view."""
    body = img[:bar0]
    L0, R0 = body[..., 2], body[..., 1]            # red = left view, green = right view
    A1, A2, size, dx, rinfo = affine_rectify(L0, R0)
    s = work_w / L0.shape[1]
    Lw = cv2.resize(L0, (work_w, int(round(L0.shape[0] * s))), interpolation=cv2.INTER_AREA)
    Rw = cv2.resize(R0, (work_w, int(round(R0.shape[0] * s))), interpolation=cv2.INTER_AREA)
    A1w, A2w = A1.copy(), A2.copy()
    A1w[:, 2] *= s
    A2w[:, 2] *= s
    sw = (int(np.ceil(size[0] * s)), int(np.ceil(size[1] * s)))
    clahe = cv2.createCLAHE(2.0, (8, 8))
    Lr = clahe.apply(cv2.warpAffine(Lw, A1w, sw, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT))
    Rr = clahe.apply(cv2.warpAffine(Rw, A2w, sw, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT))
    inside = cv2.warpAffine(np.ones_like(Lw), A1w, sw, flags=cv2.INTER_NEAREST) > 0
    lo, hi = np.percentile(dx, [3, 97]) * s     # matches on the wrong place of the same row pass the epipolar test
    span = hi - lo
    # SIFT finds the textured ground more than thin hairs and fibres, so the
    # search goes past the SIFT range by a margin (work px; per object)
    mg = margin_px if margin_px is not None else 0.2 * span + 8
    dmin = int(math.floor(lo - mg))
    ndisp = int(math.ceil((hi + mg - dmin) / 16.0)) * 16
    pad = ndisp + abs(dmin) + 8
    Lp = cv2.copyMakeBorder(Lr, 0, 0, pad, pad, cv2.BORDER_REFLECT)
    Rp = cv2.copyMakeBorder(Rr, 0, 0, pad, pad, cv2.BORDER_REFLECT)
    dl = sgbm(Lp, Rp, dmin, ndisp)[:, pad:-pad]
    # mirrored, R(x) matches L(x + dr): the same sign and range as dl
    dr = sgbm(np.ascontiguousarray(Rp[:, ::-1]), np.ascontiguousarray(Lp[:, ::-1]), dmin, ndisp)[:, ::-1][:, pad:-pad]
    H, W = dl.shape
    # trust only parallax inside the range of the SIFT matches (plus 15 %)
    valid = (dl > dmin - 0.5) & inside & (dl >= lo - mg) & (dl <= hi + mg)
    xr = np.clip(np.round(np.arange(W)[None, :] - dl).astype(int), 0, W - 1)
    valid &= np.abs(dl - dr[np.arange(H)[:, None], xr]) <= 1.5
    lr_ok = valid[inside].mean()
    filled, have = np.where(valid, dl, 0).astype(np.float32), valid.copy()
    for k in (5, 11, 23, 47, 95):
        m = have.astype(np.float32)
        num = cv2.GaussianBlur(filled * m, (0, 0), k / 3)
        den = cv2.GaussianBlur(m, (0, 0), k / 3)
        new = (~have) & (den > 0.15)
        filled[new] = (num / np.maximum(den, 1e-6))[new]
        have |= new
    if (~have).any():
        filled[~have] = float(np.median(filled[have])) if have.any() else 0.0
    # pits and spikes: a value far from the 15 px median is a bad match
    f0, f1 = float(filled.min()), float(filled.max())
    q = np.round((filled - f0) / max(f1 - f0, 1e-6) * 65535).astype(np.uint16)
    med = cv2.medianBlur(cv2.medianBlur(q, 5), 5).astype(np.float32)
    med = cv2.medianBlur(med.astype(np.uint16), 5).astype(np.float32) / 65535 * (f1 - f0) + f0
    big = cv2.resize(cv2.resize(med, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA), (filled.shape[1], filled.shape[0]))
    bad = np.abs(filled - big) > 0.12 * (np.percentile(filled, 99) - np.percentile(filled, 1))
    bad &= ~valid | (cv2.erode(valid.astype(np.uint8), np.ones((5, 5))) == 0)
    filled[bad] = big[bad]
    filled = cv2.medianBlur(filled, 5)
    filled = cv2.bilateralFilter(filled, 7, max(1.0, float(np.std(filled))) * 0.6, 5)
    # back to the frame of the left view
    back = cv2.warpAffine(filled, A1w, (Lw.shape[1], Lw.shape[0]), flags=cv2.WARP_INVERSE_MAP | cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_REPLICATE)
    stats = {**rinfo, 'validFraction': round(float(lr_ok), 3),
             'parallaxRangePx': [round(float(x / s), 1) for x in np.percentile(back, [1, 99])],
             'workScale': round(s, 5), 'marginPx': round(float(mg), 1)}
    return back, s, stats


def height_mesh(height_um, um_per_px_work, grid_w=300, max_slope_deg=80):
    H, W = height_um.shape
    gw = grid_w
    gh = int(round(gw * H / W))
    hm = cv2.resize(height_um, (gw, gh), interpolation=cv2.INTER_AREA)
    xs = np.linspace(0, W - 1, gw) * um_per_px_work
    ys = np.linspace(0, H - 1, gh) * um_per_px_work
    X, Y = np.meshgrid(xs, ys)
    # x right, y up (image rows run down), z toward the viewer
    P = np.stack([X.ravel(), (ys.max() - Y).ravel(), hm.ravel()], 1).astype(np.float64)
    idx = np.arange(gw * gh).reshape(gh, gw)
    a, b, c, d = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, :-1].ravel(), idx[1:, 1:].ravel()
    F = np.concatenate([np.stack([a, c, b], 1), np.stack([b, c, d], 1)])
    # A face that is almost on edge to the view is an occlusion step: one
    # view did not see that side. Cut it, so the step shows as a gap and not
    # as a made-up wall.
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    nz = np.abs(fn[:, 2]) / np.maximum(np.linalg.norm(fn, axis=1), 1e-12)
    F = F[nz > math.cos(math.radians(max_slope_deg))]
    return P, F, (xs.max(), ys.max())


# ── GLB writer ──────────────────────────────────────────────────────────────
def write_glb(path, P, F, N, meta, grey=None, uv=None, jpeg=None):
    lo, hi = P.min(0), P.max(0)
    centre = (lo + hi) / 2
    half = np.maximum((hi - lo) / 2, 1e-9)
    q = np.clip(np.round((P - centre) / half * 32767), -32767, 32767).astype(np.int16)
    pos = np.zeros((len(P), 4), np.int16)
    pos[:, :3] = q
    nrm = np.zeros((len(P), 4), np.int8)
    nrm[:, :3] = np.clip(np.round(N * 127), -127, 127).astype(np.int8)
    big = len(P) > 65535
    ind = F.astype(np.uint32 if big else np.uint16).ravel()
    blobs, views, accs = [], [], []
    off = 0

    def add(buf, target=None):
        nonlocal off
        b = buf.tobytes() if hasattr(buf, 'tobytes') else bytes(buf)
        pad = (-len(b)) % 4
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(b), **({'target': target} if target else {})})
        blobs.append(b + b'\0' * pad)
        off += len(b) + pad
        return len(views) - 1

    vp = add(pos, 34962); views[vp]['byteStride'] = 8
    accs.append({'bufferView': vp, 'componentType': 5122, 'normalized': True, 'count': len(P), 'type': 'VEC3',
                 'min': [int(x) for x in q.min(0)], 'max': [int(x) for x in q.max(0)]})
    vn = add(nrm, 34962); views[vn]['byteStride'] = 4
    accs.append({'bufferView': vn, 'componentType': 5120, 'normalized': True, 'count': len(P), 'type': 'VEC3'})
    attrs = {'POSITION': 0, 'NORMAL': 1}
    if grey is not None:
        g = np.clip(np.round(grey), 0, 255).astype(np.uint8)
        col = np.stack([g, g, g, np.full_like(g, 255)], 1)
        vc = add(col, 34962)
        accs.append({'bufferView': vc, 'componentType': 5121, 'normalized': True, 'count': len(P), 'type': 'VEC4'})
        attrs['COLOR_0'] = len(accs) - 1
    if uv is not None:
        t = np.clip(np.round(uv * 65535), 0, 65535).astype(np.uint16)
        vt = add(t, 34962)
        accs.append({'bufferView': vt, 'componentType': 5123, 'normalized': True, 'count': len(P), 'type': 'VEC2'})
        attrs['TEXCOORD_0'] = len(accs) - 1
    vi = add(ind, 34963)
    accs.append({'bufferView': vi, 'componentType': 5125 if big else 5123, 'count': len(ind), 'type': 'SCALAR'})
    prim = {'attributes': attrs, 'indices': len(accs) - 1, 'material': 0, 'mode': 4}
    mat = {'name': 'sem', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 1}}
    gltf = {
        'asset': {'version': '2.0', 'generator': 'em-explorer sem/build/build.py',
                  'copyright': meta['credit'], 'extras': meta['extras']},
        'extensionsUsed': ['KHR_mesh_quantization'], 'extensionsRequired': ['KHR_mesh_quantization'],
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'translation': [float(x) for x in centre], 'scale': [float(x) for x in half]}],
        'meshes': [{'name': meta['extras']['id'], 'primitives': [prim]}],
        'materials': [mat], 'accessors': accs, 'bufferViews': views,
    }
    if jpeg is not None:
        vimg = add(np.frombuffer(jpeg, np.uint8))
        gltf['images'] = [{'bufferView': vimg, 'mimeType': 'image/jpeg'}]
        gltf['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}]
        gltf['textures'] = [{'source': 0, 'sampler': 0}]
        mat['pbrMetallicRoughness']['baseColorTexture'] = {'index': 0}
    gltf['buffers'] = [{'byteLength': off}]
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    binb = b''.join(blobs)
    total = 12 + 8 + len(js) + 8 + len(binb)
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<III', 0x46546C67, 2, total))
        fh.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        fh.write(struct.pack('<II', len(binb), 0x004E4942) + binb)
    return total


# ── per object ──────────────────────────────────────────────────────────────
def build_mesh(o, paths):
    if o['format'] == 'stl':
        P, F = read_stl(paths[0])
        G = None
    else:
        P, F, G = read_obj(paths[0], paths[1] if len(paths) > 1 else None)
    P = P * o.get('unitUm', 1)
    src_faces = len(F)
    P0, G0 = P, G
    P, F = decimate(P, F, o['targetFaces'])
    if G0 is not None:
        G = carry_grey(P0, G0, P)
        lo, hi = np.percentile(G, [1, 99])
        G = np.clip((G - lo) / max(hi - lo, 1) * 235 + 10, 0, 255)
    P = principal_frame(P)
    N = vertex_normals(P, F)
    return P, F, N, G, None, None, {'sourceFaces': int(src_faces)}


def build_stereo(o, paths, tilt_deg):
    img = cv2.imread(paths[0], cv2.IMREAD_COLOR)
    bar0 = find_data_bar(img)
    bar_px = find_scale_bar(img, bar0)
    um_px = o['barUm'] / bar_px
    disp, s, st = stereo_height(img, bar0, 1024, o.get('marginPx'))
    um_px_work = um_px / s
    tilt = math.radians(o.get('tiltDeg', tilt_deg))
    h = disp * um_px_work / (2 * math.sin(tilt / 2)) * o.get('sign', 1)
    lo_h, hi_h = np.percentile(h, [0.5, 99.8])           # cut the last spikes and pits
    h = np.clip(h, lo_h, hi_h) - lo_h
    if PREVIEW:
        preview(os.path.join(PREVIEW, o['id'] + '.png'), h, um_px_work, img[:bar0, :, 2])
    P, F, (wum, hum) = height_mesh(h, um_px_work, o.get('grid', 300), o.get('maxSlopeDeg', 80))
    target = o.get('targetFaces', 100000)
    P1, F1 = decimate(P, F, target)
    while len(P1) > 65535:                 # keep 16-bit indices
        target = int(target * 0.9)
        P1, F1 = decimate(P, F, target)
    P, F = P1, F1
    uv = np.stack([P[:, 0] / wum, 1 - P[:, 1] / hum], 1)
    N = vertex_normals(P, F)
    left = img[:bar0, :, 2]
    tw = min(1280, left.shape[1])
    tex = cv2.resize(left, (tw, int(round(left.shape[0] * tw / left.shape[1]))), interpolation=cv2.INTER_AREA)
    ok, jpg = cv2.imencode('.jpg', tex, [cv2.IMWRITE_JPEG_QUALITY, 82, cv2.IMWRITE_JPEG_PROGRESSIVE, 0])
    P = P - (P.min(0) + P.max(0)) / 2
    info = {'barPx': int(bar_px), 'barUm': o['barUm'], 'umPerPx': round(um_px, 5), 'tiltDeg': o.get('tiltDeg', tilt_deg),
            'dataBarRow': int(bar0), **st}
    return P, F, N, None, uv, jpg.tobytes(), info


PREVIEW = ''


def preview(path, h, um_px, left):
    """A check image for the person who runs the build: left view, hill shade, height (dark = low)."""
    gy, gx = np.gradient(h, um_px)
    shade = np.clip(0.55 + 0.45 * (-gx * 0.7 + gy * 0.7) / np.sqrt(1 + gx * gx + gy * gy), 0, 1)
    hh = (h - h.min()) / max(float(np.ptp(h)), 1e-9)
    W = 640
    def fit(a):
        a = (np.clip(a, 0, 1) * 255).astype(np.uint8) if a.dtype != np.uint8 else a
        return cv2.resize(a, (W, int(round(h.shape[0] * W / h.shape[1]))), interpolation=cv2.INTER_AREA)
    cv2.imwrite(path, np.hstack([fit(left), fit(shade), fit(hh)]))


def main():
    global PREVIEW
    ap = argparse.ArgumentParser()
    ap.add_argument('--scratch', required=True)
    ap.add_argument('--pylib', default='')
    ap.add_argument('--only', default='')
    ap.add_argument('--out', default=os.path.join(SEM, 'models'))
    ap.add_argument('--preview', default='', help='a folder for check images of the stereo height maps')
    a = ap.parse_args()
    PREVIEW = a.preview
    if a.pylib:
        sys.path.insert(0, os.path.abspath(a.pylib))
    src = json.load(open(os.path.join(HERE, 'sources.json')))
    os.makedirs(a.scratch, exist_ok=True)
    os.makedirs(a.out, exist_ok=True)
    man_path = os.path.join(a.out, 'manifest.json')
    man = json.load(open(man_path)) if os.path.exists(man_path) else {}
    only = set(x for x in a.only.split(',') if x)
    for o in src['objects']:
        if only and o['id'] not in only:
            continue
        t0 = time.time()
        paths = [fetch(f, a.scratch) for f in o['files']]
        if o['kind'] == 'mesh':
            P, F, N, G, uv, jpg, info = build_mesh(o, paths)
        else:
            P, F, N, G, uv, jpg, info = build_stereo(o, paths, src['tiltDegDefault'])
        size = (P.max(0) - P.min(0))
        meta = {'credit': f'{o["record"]} ({o["licence"]})',
                'extras': {'id': o['id'], 'unit': 'um', 'kind': o['kind'], 'sizeUm': [round(float(x), 3) for x in size]}}
        out = os.path.join(a.out, o['id'] + '.glb')
        nbytes = write_glb(out, P, F, N, meta, G, uv, jpg)
        man[o['id']] = {'file': o['id'] + '.glb', 'bytes': nbytes, 'vertices': int(len(P)), 'faces': int(len(F)),
                        'sizeUm': meta['extras']['sizeUm'], 'kind': o['kind'], 'texture': jpg is not None,
                        'grey': G is not None, **info}
        print(f'{o["id"]:12s} {nbytes / 1e6:6.2f} MB  {len(P):6d} v {len(F):6d} f  size um {meta["extras"]["sizeUm"]}  {time.time() - t0:5.1f} s  {json.dumps(info)}')
    order = [o['id'] for o in src['objects']]
    man = {k: man[k] for k in sorted(man, key=lambda k: order.index(k) if k in order else 999)}
    with open(man_path, 'w') as fh:
        json.dump(man, fh, indent=1)
        fh.write('\n')
    tot = sum(v['bytes'] for v in man.values())
    print(f'total {tot / 1e6:.2f} MB in {len(man)} files')


if __name__ == '__main__':
    main()

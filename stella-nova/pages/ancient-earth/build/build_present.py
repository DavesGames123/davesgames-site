#!/usr/bin/env python3
# ============================================================================
#  ANCIENT EARTH  ·  build/build_present.py  ·  present-day imagery and the
#  biome colour table, from NASA Blue Marble and Black Marble
# ----------------------------------------------------------------------------
#  Runs offline, once. Inputs under --src (NASA Earth Observatory, public
#  domain, https://science.nasa.gov/earth/earth-observatory/ Visible Earth):
#    bm_aug.jpg       Blue Marble Next Generation, August 2004, 5400x2700
#                     .../eo/images/bmng/bmng-base/august/world.200408.3x5400x2700.jpg
#    elev.jpg         BMNG topography (GEBCO 08), 5400x2700, grey
#                     .../eo/images/bmng/topography/gebco_08_rev_elev_5400x2700.jpg
#    bath.jpg         BMNG bathymetry (GEBCO 08), 5400x2700, grey
#                     .../eo/images/bmng/bathymetry/gebco_08_rev_bath_5400x2700.jpg
#    blackmarble.jpg  Black Marble 2016 colour, 3600x1800
#                     .../eo/images/imagerecords/144000/144898/BlackMarble_2016_01deg.jpg
#  (base URL https://assets.science.nasa.gov/content/dam/science/esd)
#
#  The grey images have no stated scale. Fitted on known places (Paris 35 m,
#  Tibet ~5000 m, Everest 8848 m; North Sea -60 m, South Pacific -4200 m):
#    land  z = 6500 * (v / 255) ^ (1 / 0.85)      (decode "def elev_m")
#    sea   z = -7800 * (255 - v) / 255
#  These are approximate and used only for relief, shelves and the sea
#  level of the ice age.
#
#  Outputs (../data/present):
#    color-2k.jpg, color-4k.jpg  Blue Marble colour, 2048 and 4096 wide
#    relief-2k.png               height, the dem.bin square-root code
#    lights-2k.jpg               city lights only (Black Marble minus its
#                                moonlit land), grey
#  and ../data/biome-lut.json: the mean Blue Marble land colour (linear
#  RGB) per bin of yearly temperature T and moisture index W, both from the
#  same formulas as the shader (shaders.js "float wetIndex"), at the
#  present climate (Teq 27 C, dT 37.5 K). The paleo surface reads this
#  table with the T and W of its own age, so a climate that matches a
#  present one gets the colour that the real Earth shows there.
#
#  Run:  python3 -I build_present.py --src <dir>
# ============================================================================
import argparse, json, math, os
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'data')
PRES = os.path.join(OUT, 'present')
ap = argparse.ArgumentParser(); ap.add_argument('--src', required=True)
SRC = ap.parse_args().src
os.makedirs(PRES, exist_ok=True)


def load(n, mode='RGB'):
    return Image.open(os.path.join(SRC, n)).convert(mode)


def elev_m(e, b):
    land = 6500.0 * (e / 255.0) ** (1 / 0.85)
    sea = -7800.0 * (255.0 - b) / 255.0
    return np.where(b >= 254.5, land, sea)


def enc(z):
    z = np.clip(z, -9000, 6000)
    sea = 127 - np.round(127 * np.sqrt(np.clip(-z, 0, None) / 9000))
    land = 128 + np.round(127 * np.sqrt(np.clip(z, 0, None) / 6000))
    return np.where(z < 0, sea, land).astype(np.uint8)


bm = load('bm_aug.jpg')
for w, q in ((2048, 86), (4096, 84)):
    bm.resize((w, w // 2), Image.LANCZOS).save(os.path.join(PRES, f'color-{w // 1024}k.jpg'), quality=q, optimize=True, progressive=True)

E = np.asarray(load('elev.jpg', 'L').resize((2048, 1024), Image.BILINEAR), np.float32)
Bt = np.asarray(load('bath.jpg', 'L').resize((2048, 1024), Image.BILINEAR), np.float32)
Z = elev_m(E, Bt)
Image.fromarray(enc(Z)).save(os.path.join(PRES, 'relief-2k.png'), optimize=True)

bk = np.asarray(load('blackmarble.jpg').resize((2048, 1024), Image.LANCZOS), np.float32)
# lights are warm (R > B); the moonlit land and ice are blue-grey
light = np.clip((bk[..., 0] - 0.80 * bk[..., 2] - 12) * 2.2, 0, 255).astype(np.uint8)
Image.fromarray(light).save(os.path.join(PRES, 'lights-2k.jpg'), quality=88, optimize=True)

# ── biome table ─────────────────────────────────────────────────────────────
W, H = 720, 360
col = np.asarray(bm.resize((W, H), Image.BOX), np.float32) / 255.0
lin = np.where(col <= 0.04045, col / 12.92, ((col + 0.055) / 1.055) ** 2.4)
z = elev_m(np.asarray(load('elev.jpg', 'L').resize((W, H), Image.BILINEAR), np.float32),
           np.asarray(load('bath.jpg', 'L').resize((W, H), Image.BILINEAR), np.float32))
land = z > 0
# distance to the sea in km, chamfer passes on the 0.5 deg grid
d = np.where(land, 1e9, 0.0)
lat = 90 - (np.arange(H) + 0.5) * 0.5
for rep in range(3):
    for j in range(H):
        dx = max(1.0, 55.6 * math.cos(math.radians(lat[j])))
        row = d[j]
        for i in range(1, W * 2):
            k, kp = i % W, (i - 1) % W
            row[k] = min(row[k], row[kp] + dx)
        for i in range(W * 2 - 2, -1, -1):
            k, kn = i % W, (i + 1) % W
            row[k] = min(row[k], row[kn] + dx)
    for j in range(1, H):
        d[j] = np.minimum(d[j], d[j - 1] + 55.6)
    for j in range(H - 2, -1, -1):
        d[j] = np.minimum(d[j], d[j + 1] + 55.6)
TEQ, DT = 27.0, 37.5
LAT = np.repeat(lat[:, None], W, 1)
s = np.sin(np.radians(LAT))
T = TEQ - DT * s * s - 6.5 * np.clip(z, 0, None) / 1000.0
al = np.abs(LAT)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


wet = (0.85 * np.exp(-(al / 11) ** 2) + 0.55 * np.exp(-((al - 52) / 13) ** 2) + 0.34 - 0.45 * np.exp(-((al - 25) / 8) ** 2)
       - d / 6000 + 0.4 * smooth(0, 14, T) * smooth(55, 75, al))
wet = np.clip(wet, 0, 1)
T0, T1, NT, NW = -40.0, 34.0, 38, 16          # 2 K bins, 16 moisture bins
ti = np.clip(((T - T0) / (T1 - T0) * NT).astype(int), 0, NT - 1)
wi = np.clip((wet * NW).astype(int), 0, NW - 1)
acc = np.zeros((NT, NW, 3)); cnt = np.zeros((NT, NW))
wts = np.cos(np.radians(LAT))
for c in range(3):
    np.add.at(acc[..., c], (ti[land], wi[land]), lin[..., c][land] * wts[land])
np.add.at(cnt, (ti[land], wi[land]), wts[land])
lut = np.zeros((NT, NW, 3)); have = cnt > 0.5
lut[have] = acc[have] / cnt[have][:, None]
# fill empty bins from the nearest filled bin (in bin units)
fi = np.argwhere(have)
for a in range(NT):
    for b in range(NW):
        if not have[a, b]:
            k = np.argmin((fi[:, 0] - a) ** 2 + (fi[:, 1] - b) ** 2 * 0.5)
            lut[a, b] = lut[tuple(fi[k])]
out = {'T0': T0, 'T1': T1, 'nT': NT, 'nW': NW, 'filled': int(have.sum()), 'bins': NT * NW,
       'rgb': [round(float(v), 5) for v in lut.reshape(-1)],
       'source': 'NASA Blue Marble Next Generation, August 2004 (public domain); see build/build_present.py'}
with open(os.path.join(OUT, 'biome-lut.json'), 'w') as f:
    json.dump(out, f, separators=(',', ':'))
for n in sorted(os.listdir(PRES)):
    print('wrote data/present/' + n, os.path.getsize(os.path.join(PRES, n)))
print('wrote data/biome-lut.json', os.path.getsize(os.path.join(OUT, 'biome-lut.json')), 'filled bins', int(have.sum()), 'of', NT * NW)

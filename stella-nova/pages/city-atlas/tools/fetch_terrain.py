#!/usr/bin/env python3
"""Sample real elevation (land and sea floor) onto the INNER and OUTER grids.

Usage:
  python3 tools/fetch_terrain.py --cache <dir> [--only <id> ...]

Source: the Terrain Tiles on AWS Open Data (Mapzen terrarium encoding,
s3://elevation-tiles-prod). Each 256 px PNG tile packs metres as
R * 256 + G + B / 256 - 32768. The tiles merge SRTM, GMTED, ETOPO1, NED,
and other open DEMs and bathymetry. The INNER grid reads zoom 13, the OUTER
grid zoom 10. Bilinear sampling, in Web Mercator pixel space.

Output: <cache>/terrain/<id>.npz with inner (512, 512) and outer (256, 256)
float32 metres, row 0 south (see geo.py).

grep: def tile_xy  def fetch_tile  def sample
"""
import argparse, io, json, math, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import geo  # noqa: E402

URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
UA = {'User-Agent': 'davesgames-city-atlas-build/1.0'}


def merc_px(lon, lat, z):
    n = 256 * 2 ** z
    x = (np.asarray(lon) + 180.0) / 360.0 * n
    s = np.sin(np.radians(np.asarray(lat)))
    y = (0.5 - np.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def fetch_tile(cache, z, x, y):
    p = os.path.join(cache, 'tiles', str(z), str(x), f'{y}.png')
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        for k in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(URL.format(z=z, x=x, y=y), headers=UA), timeout=60) as r:
                    data = r.read()
                break
            except Exception as e:  # noqa: BLE001
                if k == 3:
                    raise
                time.sleep(2 + 3 * k)
        open(p + '.part', 'wb').write(data)
        os.replace(p + '.part', p)
    a = np.asarray(Image.open(p).convert('RGB')).astype(np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768


def sample(cache, city, g, z):
    lon, lat = geo.grid_lonlat(city, g)
    px, py = merc_px(lon, lat, z)
    px -= 0.5
    py -= 0.5
    tx0, tx1 = int(np.floor(px.min() / 256)) , int(np.floor(px.max() / 256)) + 1
    ty0, ty1 = int(np.floor(py.min() / 256)), int(np.floor(py.max() / 256)) + 1
    tiles = [(x, y) for y in range(ty0, ty1 + 1) for x in range(tx0, tx1 + 1)]
    with ThreadPoolExecutor(8) as ex:
        got = list(ex.map(lambda t: fetch_tile(cache, z, *t), tiles))
    W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    mos = np.zeros((H, W))
    for (x, y), a in zip(tiles, got):
        mos[(y - ty0) * 256:(y - ty0 + 1) * 256, (x - tx0) * 256:(x - tx0 + 1) * 256] = a
    fx, fy = px - tx0 * 256, py - ty0 * 256
    i0 = np.clip(np.floor(fx).astype(int), 0, W - 2)
    j0 = np.clip(np.floor(fy).astype(int), 0, H - 2)
    ax, ay = np.clip(fx - i0, 0, 1), np.clip(fy - j0, 0, 1)
    v = (mos[j0, i0] * (1 - ax) * (1 - ay) + mos[j0, i0 + 1] * ax * (1 - ay)
         + mos[j0 + 1, i0] * (1 - ax) * ay + mos[j0 + 1, i0 + 1] * ax * ay)
    return v.astype(np.float32), len(tiles)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True)
    ap.add_argument('--only', nargs='*')
    a = ap.parse_args()
    cities = json.load(open(os.path.join(HERE, 'cities.json')))
    od = os.path.join(a.cache, 'terrain')
    os.makedirs(od, exist_ok=True)
    for c in cities:
        if a.only and c['id'] not in a.only:
            continue
        t = time.time()
        inner, ni = sample(od, c, geo.INNER, 13)
        outer, no = sample(od, c, geo.OUTER, 10)
        np.savez_compressed(os.path.join(od, c['id'] + '.npz'), inner=inner, outer=outer)
        print(f"{c['id']:16s} tiles {ni}+{no}  inner {inner.min():7.1f}..{inner.max():7.1f} m  "
              f"outer {outer.min():7.1f}..{outer.max():7.1f} m  centre {inner[256, 256]:6.1f} m  {time.time() - t:.0f} s", flush=True)


if __name__ == '__main__':
    main()

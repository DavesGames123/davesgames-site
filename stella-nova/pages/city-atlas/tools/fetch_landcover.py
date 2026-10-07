#!/usr/bin/env python3
"""Sample ESA WorldCover 2021 land cover onto the INNER and OUTER grids.

Usage:
  python3 tools/fetch_landcover.py --cache <dir> [--only <id> ...]

Source: ESA WorldCover 10 m 2021 v200, Cloud Optimized GeoTIFFs on AWS
(s3://esa-worldcover, 3 x 3 degree tiles named by their SW corner).
Licence: CC BY 4.0, "(c) ESA WorldCover project 2021 / Contains modified
Copernicus Sentinel data (2021) processed by ESA WorldCover consortium".
rasterio reads only the window it needs over HTTP (GDAL /vsicurl). A tile
that does not exist is open sea (WorldCover has no tiles there).

Classes (WorldCover codes): 10 tree, 20 shrub, 30 grass, 40 crop, 50 built,
60 bare, 70 snow, 80 water, 90 wetland, 95 mangrove, 100 moss. 0 = no data.

Output: <cache>/landcover/<id>.npz: inner (1024, 1024) uint8 at 11.7 m
(nearest), outer (1024, 1024) uint8 at 62.5 m (mode), row 0 south.

grep: def tiles_for  def read_grid
"""
import argparse, json, math, os, sys, time
import urllib.request

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import geo  # noqa: E402

BASE = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{}_Map.tif'
INNER_N = 1024
OUTER_N = 1024
os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
os.environ.setdefault('CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.tif')


def tile_name(lat0, lon0):
    return f"{'N' if lat0 >= 0 else 'S'}{abs(lat0):02d}{'E' if lon0 >= 0 else 'W'}{abs(lon0):03d}"


def exists(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=60) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def read_grid(city, half, n, resampling):
    w, s, e, nn = geo.bbox_lonlat(city, half)
    out = np.full((n, n), 80, np.uint8)          # default: open sea
    dlon, dlat = (e - w) / n, (nn - s) / n
    for la in range(math.floor(s / 3) * 3, math.floor(nn / 3) * 3 + 1, 3):
        for lo in range(math.floor(w / 3) * 3, math.floor(e / 3) * 3 + 1, 3):
            url = BASE.format(tile_name(la, lo))
            if not exists(url):
                continue
            # the part of the grid inside this tile, in whole grid cells
            i0 = max(0, math.ceil((lo - w) / dlon - 1e-9)); i1 = min(n, math.floor((lo + 3 - w) / dlon + 1e-9))
            j0 = max(0, math.ceil((la - s) / dlat - 1e-9)); j1 = min(n, math.floor((la + 3 - s) / dlat + 1e-9))
            if i1 <= i0 or j1 <= j0:
                continue
            with rasterio.open('/vsicurl/' + url) as ds:
                win = from_bounds(w + i0 * dlon, s + j0 * dlat, w + i1 * dlon, s + j1 * dlat, ds.transform)
                a = ds.read(1, window=win, out_shape=(j1 - j0, i1 - i0), resampling=resampling, boundless=True, fill_value=0)
            out[j0:j1, i0:i1] = a[::-1]       # raster rows run north to south; grid row 0 is south
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True)
    ap.add_argument('--only', nargs='*')
    a = ap.parse_args()
    od = os.path.join(a.cache, 'landcover')
    os.makedirs(od, exist_ok=True)
    for c in json.load(open(os.path.join(HERE, 'cities.json'))):
        if a.only and c['id'] not in a.only:
            continue
        out = os.path.join(od, c['id'] + '.npz')
        if os.path.exists(out) and np.load(out)['outer'].shape[0] == OUTER_N:
            continue
        t = time.time()
        inner = read_grid(c, geo.INNER['half'], INNER_N, Resampling.nearest)
        outer = read_grid(c, geo.OUTER['half'], OUTER_N, Resampling.mode)
        np.savez_compressed(out, inner=inner, outer=outer)
        cls, cnt = np.unique(inner, return_counts=True)
        share = ' '.join(f'{k}:{v / inner.size:.2f}' for k, v in zip(cls, cnt) if v / inner.size > 0.01)
        print(f"{c['id']:16s} {time.time() - t:5.0f} s  inner {share}", flush=True)


if __name__ == '__main__':
    main()

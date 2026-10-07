#!/usr/bin/env python3
"""Build the City Atlas city files (data/<id>.bin) and data/index.json.

Usage:
  python3 tools/build_city.py --cache <dir> [--only <id> ...] [--tidal <tidal-currents data dir>]

Input (all in <cache>, made by the fetch_*.py scripts):
  overture/buildings_<id>.parquet (or buildings.parquet), water.parquet, places.parquet
  terrain/<id>.npz      inner 512^2 and outer 256^2 heights, m
  landcover/<id>.npz    inner 1024^2 and outer 256^2 WorldCover classes
  ocean/<id>.nc         HYCOM ESPC-D-V02 hourly ssu, ssv
  wind/<id>.json        the ERA5 wind rose of 2025
and the tidal-currents datasets (../tidal-currents/data/<id>/) for the
cities that name one in cities.json ("tidal").

Output: data/<id>.bin, one zlib stream (data.js parses it):
  'CTA1', u32 json length, json, zero pad to 8, sections (8-byte aligned).
Sections (row 0 is the south edge, tools/geo.py):
  t_in, s_in    int16 (512, 512) 0.1 m  ground / surface (water level on water), delta 'row'
  t_out, s_out  int16 (256, 256) 0.1 m  the same for the outer grid
  wf_in         uint8 (1024, 1024)      water fraction 0..255 (antialiased)
  wf_out        uint8 (1024, 1024)      (62.5 m)
  lc_in, lc_out uint8 (1024 / 512)      WorldCover class (80 = water after the merge)
  rough         uint8 (256, 256, 2)     wind drag 0..255 and land share smoothed 0..255
  cur_in        int8 (49, 96, 96, 2)    surface current u east, v north (meta.curScaleIn m/s per unit)
  cur_out       int8 (49, 64, 64, 2)    (meta.curScaleOut)
  b_h, b_hmin   uint16 0.1 m            building height, base of the walls above the ground
  b_base        int16 0.1 m             lowest ground under the footprint
  b_kind        uint8                   use class (1..7, 0 unknown), +128 if the height is estimated
  b_rings       uint8                   rings per building (outer first, then holes)
  b_ringlen     uint16                  vertices per ring
  b_xy          int16 (V, 2) 0.5 m      ring vertices, delta 'stream'
  b_ntri        uint16                  roof triangles per building
  b_tri         uint16                  roof triangle corners, local to the building

Steps for each city:
  1. Water: WorldCover water, plus the Overture water polygons (OSM). The
     inner water fraction is a 3x3 box filter of the 1024 mask.
  2. Terrain holes (cells far below their 5 x 5 median, an artefact of a
     few terrain tiles) take the median. Water level per connected water
     body: 0 m when its floor goes below -2 m or its shore is lower than
     3 m (the sea and the tidal rivers), else the 10th percentile of the
     ground on its shore (Lake Michigan near 176 m).
     Under water the ground is at least 0.5 m below that level.
  3. Buildings: Overture footprints with a centroid inside the city disc
     (cities.json r), simplified to 0.4 m, oriented, quantized to 0.5 m,
     triangulated with earcut, sorted along a Morton curve.
     Height: Overture height, else floors x 3.3 m + 1 m, else a default by
     use (estimated, flagged).
  4. Currents: 49 hours from WINDOW_START. The tidal-currents data (NOAA
     OFS or Marine Institute NEATL) where it covers the city, else HYCOM.
     HYCOM has no cells in most harbours: its field goes into the nearby
     water by nearest value and fades out over 3 km (fill_near). All
     currents slow to 0 over the last two cells before the coast.
  5. Drag and land share for the wind solver, labels, meta.

grep: def water_masks  def water_level  def load_buildings  def currents
      def tidal_series  def hycom_series  def rough_raster  def labels  def write_bin
"""
import argparse, datetime as dt, json, math, os, sys, time, zlib

import duckdb
import h5py
import mapbox_earcut as earcut
import numpy as np
import shapely
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely import wkb as swkb
from shapely.geometry import Polygon, MultiPolygon

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import geo  # noqa: E402
from fetch_ocean import WINDOW_START, HOURS  # noqa: E402

PAGE = os.path.dirname(HERE)
OUT = os.path.join(PAGE, 'data')
TIDAL = os.path.join(os.path.dirname(PAGE), 'tidal-currents', 'data')
WF_N = 1024            # inner water fraction and land cover resolution
CUR_IN, CUR_OUT = 96, 64
ROUGH_N = 256
KIND = {'residential': 1, 'commercial': 2, 'industrial': 3, 'civic': 4, 'education': 4, 'medical': 4,
        'military': 4, 'religious': 5, 'transportation': 6, 'entertainment': 7, 'agricultural': 3,
        'outbuilding': 1, 'service': 3}
USE_NAMES = ['unknown', 'residential', 'commercial and office', 'industrial', 'civic', 'religious', 'transport', 'entertainment']
DEFAULT_H = {1: 9.0, 2: 14.0, 3: 9.0, 4: 12.0, 5: 14.0, 6: 9.0, 7: 12.0, 0: 9.0}
# Not drawn as water: pools and drains (too small), and the named sea areas
# (bay, strait, sea, ocean), whose OSM polygons often cover islands too.
# WorldCover gives the open water.
SKIP_WATER = {'swimming_pool', 'reflecting_pool', 'wastewater', 'fountain', 'drain', 'ditch',
              'bay', 'strait', 'sea', 'ocean', 'cape', 'shoal', 'waterfall', 'spring'}
WATER_LABEL = {'river', 'bay', 'strait', 'lake', 'harbour', 'lagoon', 'water', 'ocean'}
ROUGH = {10: 0.6, 20: 0.25, 30: 0.15, 40: 0.15, 50: 0.55, 60: 0.08, 70: 0.05, 80: 0.0, 90: 0.1, 95: 0.6, 100: 0.1, 0: 0.0}


# ---------------------------------------------------------------- helpers
def raster_polys(city, polys, half, n):
    """Rasterize local-metre shapely polygons (with holes) to an n x n bool mask, row 0 south."""
    img = Image.new('1', (n, n), 0)
    d = ImageDraw.Draw(img)
    k = n / (2 * half)

    def ring(r):
        xy = np.asarray(r.coords)
        return [((x + half) * k, (half - y) * k) for x, y in xy]   # image row 0 is north
    for p in polys:
        for g in (p.geoms if isinstance(p, MultiPolygon) else [p]):
            if g.is_empty or not isinstance(g, Polygon):
                continue
            d.polygon(ring(g.exterior), fill=1)
            for h in g.interiors:
                d.polygon(ring(h), fill=0)
    return np.asarray(img, bool)[::-1]


def to_local(city, geom):
    lon0, lat0, kx, ky = geo.frame(city)
    return shapely.transform(geom, lambda c: np.column_stack([(c[:, 0] - lon0) * kx, (c[:, 1] - lat0) * ky]))


def bilinear(grid, half, x, y):
    n = grid.shape[0]
    gx = (np.asarray(x) + half) / (2 * half) * n - 0.5
    gy = (np.asarray(y) + half) / (2 * half) * n - 0.5
    i0 = np.clip(np.floor(gx).astype(int), 0, n - 2)
    j0 = np.clip(np.floor(gy).astype(int), 0, n - 2)
    ax, ay = np.clip(gx - i0, 0, 1), np.clip(gy - j0, 0, 1)
    return (grid[j0, i0] * (1 - ax) * (1 - ay) + grid[j0, i0 + 1] * ax * (1 - ay)
            + grid[j0 + 1, i0] * (1 - ax) * ay + grid[j0 + 1, i0 + 1] * ax * ay)


def resize_mean(a, n):
    """Area-mean resample of a square float raster to n x n."""
    return np.asarray(Image.fromarray(np.asarray(a, np.float32), 'F').resize((n, n), Image.BOX))


def down(a, k):
    n = a.shape[0] // k
    return a[:n * k, :n * k].reshape(n, k, n, k).mean(axis=(1, 3))


# ---------------------------------------------------------------- water
def water_masks(city, con, cache, lc_in, lc_out):
    """Water at 1024 (inner) and 256 (outer). Returns (wf_in u8, w_out bool, lc_in, lc_out, stats)."""
    half = geo.INNER['half']
    rows = con.execute("SELECT class, subtype, wkb FROM read_parquet(?) WHERE city = ?",
                       [os.path.join(cache, 'overture', 'water.parquet'), city['id']]).fetchall()
    polys = []
    for cls, sub, b in rows:
        if cls in SKIP_WATER:
            continue
        g = swkb.loads(bytes(b))
        if g.geom_type in ('Polygon', 'MultiPolygon'):
            polys.append(to_local(city, g))
    osm = raster_polys(city, polys, half, WF_N) if polys else np.zeros((WF_N, WF_N), bool)
    wc = lc_in == 80
    water = wc | osm
    # small specks of WorldCover water (pools, shadows) are dropped unless OSM agrees
    lab, nlab = ndimage.label(water)
    if nlab:
        size = ndimage.sum(np.ones_like(water), lab, index=np.arange(1, nlab + 1))
        osmhit = ndimage.maximum(osm, lab, index=np.arange(1, nlab + 1))
        keep = (size >= 40) | (osmhit > 0)
        water = keep[lab - 1] & (lab > 0)
    lc_in = lc_in.copy()
    lc_in[water] = 80
    lc_in[(~water) & (lc_in == 80)] = 50
    lc_in[lc_in == 0] = 80
    wf = ndimage.uniform_filter(water.astype(np.float32), 3)
    # outer: WorldCover at 62.5 m; no tile (open sea) is water
    wo = (lc_out == 80) | (lc_out == 0)
    lab, nlab = ndimage.label(wo)
    if nlab:
        size = ndimage.sum(np.ones_like(wo), lab, index=np.arange(1, nlab + 1))
        wo = (size >= 6)[lab - 1] & (lab > 0)
    wf_out = ndimage.uniform_filter(wo.astype(np.float32), 3)
    lc_out = lc_out.copy()
    lc_out[wo] = 80
    lc_out[(~wo) & (lc_out == 80)] = 30
    lc_out = lc_out[::2, ::2]                       # 125 m classes
    return (np.clip(wf * 255 + 0.5, 0, 255).astype(np.uint8), np.clip(wf_out * 255 + 0.5, 0, 255).astype(np.uint8),
            lc_in, lc_out, {'osmWaterPolys': len(polys), 'waterShareInner': round(float(water.mean()), 3)})


def despike(a, thr=150.0):
    """Fill the holes of the terrain tiles: cells more than thr m below their 5 x 5 median."""
    a = a.copy()
    n = 0
    for _ in range(3):
        med = ndimage.median_filter(a, 5)
        bad = a < med - thr
        if not bad.any():
            break
        n += int(bad.sum())
        a[bad] = med[bad]
    return a, n


def water_level(ground, water):
    """Level per connected water body, m: 0 for the sea, else its shore height."""
    level = np.full(ground.shape, np.nan, np.float32)
    lab, n = ndimage.label(water)
    if not n:
        return level
    shore = ndimage.binary_dilation(water, iterations=2) & ~water
    for k in range(1, n + 1):
        comp = lab == k
        ring = ndimage.binary_dilation(comp, iterations=2) & shore
        vals = ground[ring]
        lv = float(np.percentile(vals, 10)) if vals.size else 0.0
        inside = ground[comp]
        if inside.min() < -2.0 or lv < 3.0:
            lv = 0.0      # floor below sea level, or a low shore: the sea or a tidal river
        level[comp] = lv
    return level


def heights(ground, water):
    lv = water_level(ground, water)
    surf = np.where(water, lv, ground)
    g = np.where(water, np.minimum(ground, lv - 0.5), ground)
    return g, surf


# ---------------------------------------------------------------- buildings
def morton(x, y):
    def spread(v):
        v = v & 0xFFFF
        v = (v | (v << 8)) & 0x00FF00FF
        v = (v | (v << 4)) & 0x0F0F0F0F
        v = (v | (v << 2)) & 0x33333333
        v = (v | (v << 1)) & 0x55555555
        return v
    return spread(x) | (spread(y) << 1)


def load_buildings(city, con, cache, ground_in):
    R = city['r'] * 1000.0
    src = os.path.join(cache, 'overture', 'buildings.parquet')
    one = os.path.join(cache, 'overture', f"buildings_{city['id']}.parquet")
    if os.path.exists(one):
        src = one          # a single-city fetch (fetch_overture.py --only <id>)
    rows = con.execute("""SELECT height, num_floors, min_height, class, subtype, is_underground, wkb
                          FROM read_parquet(?) WHERE city = ?""", [src, city['id']]).fetchall()
    out = []
    tagged = 0
    for h, nf, mh, cls, sub, under, b in rows:
        if under:
            continue
        g = to_local(city, swkb.loads(bytes(b)))
        for p in (g.geoms if isinstance(g, MultiPolygon) else [g]):
            if not isinstance(p, Polygon) or p.area < 12:
                continue
            c = p.centroid
            if math.hypot(c.x, c.y) > R:
                continue
            # a footprint that reaches far out of the disc (a whole palace
            # compound as one polygon) is dropped
            if np.hypot(*np.asarray(p.exterior.coords).T).max() > R + 500:
                continue
            p = p.simplify(0.4, preserve_topology=True)
            if p.is_empty or not isinstance(p, Polygon):
                continue
            p = shapely.geometry.polygon.orient(p, 1.0)   # outer CCW, holes CW
            kind = KIND.get(sub or '', KIND.get(cls or '', 0))
            est = False
            if h is not None and h > 0:
                H = float(h)
            elif nf is not None and nf > 0:
                H = float(nf) * 3.3 + 1.0
            else:
                H = DEFAULT_H.get(kind, 9.0) * (0.85 + 0.3 * ((hash(p.wkb) & 255) / 255))
                est = True
            if not est:
                tagged += 1
            H = float(np.clip(H, 2.5, 900.0))
            hm = float(np.clip(mh or 0.0, 0.0, max(H - 1.0, 0.0)))
            rings = []
            for r in [p.exterior] + list(p.interiors):
                q = np.round(np.asarray(r.coords)[:-1] * 2).astype(np.int32)
                keep = np.ones(len(q), bool)
                keep[1:] = np.any(q[1:] != q[:-1], axis=1)
                if len(q) > 1 and np.all(q[-1] == q[0]):
                    keep[-1] = False
                q = q[keep]
                if len(q) >= 3:
                    rings.append(q)
                elif not rings:
                    break
            if not rings or len(rings[0]) < 3:
                continue
            allv = np.concatenate(rings).astype(np.float64)
            ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
            tri = earcut.triangulate_float64(allv, ends)
            if len(tri) < 3:
                continue
            base = float(np.min(bilinear(ground_in, geo.INNER['half'], allv[:, 0] * 0.5, allv[:, 1] * 0.5)))
            out.append({'h': H, 'hm': hm, 'base': base, 'kind': kind | (128 if est else 0), 'rings': rings,
                        'tri': np.asarray(tri, np.uint32), 'c': (c.x, c.y)})
    # Morton order: neighbours sit together in the file, so the deltas stay small
    for b in out:
        b['m'] = morton(int((b['c'][0] + 32768) / 4), int((b['c'][1] + 32768) / 4))
    out.sort(key=lambda b: b['m'])
    return out, tagged


def pack_buildings(bs):
    n = len(bs)
    h = np.array([round(b['h'] * 10) for b in bs], np.uint16)
    hm = np.array([round(b['hm'] * 10) for b in bs], np.uint16)
    base = np.array([round(np.clip(b['base'], -3000, 3000) * 10) for b in bs], np.int16)
    kind = np.array([b['kind'] for b in bs], np.uint8)
    rings = np.array([len(b['rings']) for b in bs], np.uint8)
    ringlen = np.array([len(r) for b in bs for r in b['rings']], np.uint16)
    xy = np.concatenate([np.concatenate(b['rings']) for b in bs]).astype(np.int32) if n else np.zeros((0, 2), np.int32)
    ntri = np.array([len(b['tri']) // 3 for b in bs], np.uint16)
    tri = np.concatenate([b['tri'] for b in bs]).astype(np.uint16) if n else np.zeros(0, np.uint16)
    return {'b_h': h, 'b_hmin': hm, 'b_base': base, 'b_kind': kind, 'b_rings': rings, 'b_ringlen': ringlen,
            'b_xy': xy, 'b_ntri': ntri, 'b_tri': tri}


# ---------------------------------------------------------------- currents
def window_utc():
    t0 = dt.datetime.strptime(WINDOW_START, '%Y-%m-%dT%H:%M:%SZ')
    return [t0 + dt.timedelta(hours=h) for h in range(HOURS)]


def tidal_series(city, lon, lat):
    """The tidal-currents dataset decoded at the window hours, sampled at lon/lat arrays.
    Returns (U, V, valid) with U, V of shape (HOURS,) + lon.shape, or None."""
    tid = city.get('tidal')
    if not tid:
        return None
    d = os.path.join(TIDAL, tid)
    meta = json.load(open(os.path.join(d, 'meta.json')))

    def rd(name):
        return np.asarray(Image.open(os.path.join(d, name)).convert('RGBA')).astype(np.float64)

    def s(c):
        return np.clip((c - 128.0) / 127.0, -1, 1)
    basep = rd('base.png')
    vel = [rd(f'vel{k}.png') for k in range(meta['velModes'] // 2)]
    meanU, meanV = s(basep[..., 2]) * meta['meanVelScale'], s(basep[..., 3]) * meta['meanVelScale']
    cov = basep[..., 0] / 255.0
    mu = [s(vel[k // 2][..., 0 if k % 2 == 0 else 2]) for k in range(meta['velModes'])]
    mv = [s(vel[k // 2][..., 1 if k % 2 == 0 else 3]) for k in range(meta['velModes'])]
    H, W = cov.shape
    b = meta['bbox']
    px = (lon - b['lon0']) / (b['lon1'] - b['lon0']) * W - 0.5
    py = (b['lat1'] - lat) / (b['lat1'] - b['lat0']) * H - 0.5
    inside = (px >= 0) & (px <= W - 1) & (py >= 0) & (py <= H - 1)
    i0 = np.clip(np.floor(px).astype(int), 0, W - 2)
    j0 = np.clip(np.floor(py).astype(int), 0, H - 2)
    ax, ay = np.clip(px - i0, 0, 1), np.clip(py - j0, 0, 1)

    def samp(a):
        return (a[j0, i0] * (1 - ax) * (1 - ay) + a[j0, i0 + 1] * ax * (1 - ay)
                + a[j0 + 1, i0] * (1 - ax) * ay + a[j0 + 1, i0 + 1] * ax * ay)
    valid = inside & (samp(cov) > 0.5)
    m = [int(x) for x in meta['startLocal'].replace('T', '-').replace(':', '-').split('-')[:5]]
    start = dt.datetime(*m) - dt.timedelta(hours=meta['utcOffsetHours'])
    U = np.zeros((HOURS,) + lon.shape)
    V = np.zeros_like(U)
    smu = [samp(a) for a in mu]
    smv = [samp(a) for a in mv]
    mU, mV = samp(meanU), samp(meanV)
    for k, t in enumerate(window_utc()):
        h = int(round((t - start).total_seconds() / 3600))
        if h < 0 or h >= len(meta['velCoef']):
            raise SystemExit(f"{city['id']}: window hour {t} outside the tidal data")
        c = meta['velCoef'][h]
        U[k] = mU + sum(c[q] * smu[q] for q in range(len(c)))
        V[k] = mV + sum(c[q] * smv[q] for q in range(len(c)))
    return U, V, valid, {'model': meta.get('model'), 'modelLong': meta.get('modelLong'), 'agency': meta.get('agency', 'NOAA'),
                         'tidalId': tid}


def hycom_series(cache, city, lon, lat):
    p = os.path.join(cache, 'ocean', city['id'] + '.nc')
    if not os.path.exists(p):
        return None
    f = h5py.File(p, 'r')
    la, lo = f['lat'][:], f['lon'][:]
    lo = np.where(lo > 180, lo - 360, lo)
    t = f['time'][:]
    units = f['time'].attrs['units'].decode() if isinstance(f['time'].attrs['units'], bytes) else f['time'].attrs['units']
    t0 = dt.datetime.strptime(units.split('since ')[1][:19], '%Y-%m-%d %H:%M:%S')
    times = [t0 + dt.timedelta(hours=float(x)) for x in t]
    want = window_utc()
    idx = []
    for w in want:
        k = int(np.argmin([abs((x - w).total_seconds()) for x in times]))
        if abs((times[k] - w).total_seconds()) > 1800:
            return None
        idx.append(k)
    out = []
    valid_any = None
    for var in ('ssu', 'ssv'):
        a = f[var][:].astype(np.float64)
        fill = f[var].attrs['_FillValue'][0]
        sc = f[var].attrs.get('scale_factor', [1.0])[0]
        off = f[var].attrs.get('add_offset', [0.0])[0]
        ok = a != fill
        a = a * sc + off
        a[~ok] = np.nan
        out.append(a[idx])
        valid_any = ok[idx].all(0) if valid_any is None else valid_any & ok[idx].all(0)
    if not valid_any.any():
        return None
    # bilinear interpolation in lon/lat with NaN-aware weights
    gx = (lon - lo[0]) / (lo[1] - lo[0])
    gy = (lat - la[0]) / (la[1] - la[0])
    i0 = np.clip(np.floor(gx).astype(int), 0, len(lo) - 2)
    j0 = np.clip(np.floor(gy).astype(int), 0, len(la) - 2)
    ax, ay = np.clip(gx - i0, 0, 1), np.clip(gy - j0, 0, 1)
    res = []
    for a in out:
        acc = np.zeros((HOURS,) + lon.shape)
        wsum = np.zeros(lon.shape)
        for dj, di, w in ((0, 0, (1 - ax) * (1 - ay)), (0, 1, ax * (1 - ay)), (1, 0, (1 - ax) * ay), (1, 1, ax * ay)):
            v = a[:, j0 + dj, i0 + di]
            ok = np.isfinite(v).all(0)
            acc += np.where(ok, v, 0) * (w * ok)
            wsum += w * ok
        res.append(np.where(wsum > 0.2, acc / np.maximum(wsum, 1e-9), np.nan))
    return res[0], res[1]


def fill_near(U, V, water, cell_m, reach_m=3000.0):
    """Extend a field with NaN holes into nearby water by nearest value, fading with distance."""
    ok = np.isfinite(U[0])
    if not ok.any():
        return np.zeros_like(U), np.zeros_like(V)
    d, (jj, ii) = ndimage.distance_transform_edt(~ok, return_indices=True)
    fade = np.exp(-(d * cell_m) / reach_m)
    U2 = U[:, jj, ii] * fade
    V2 = V[:, jj, ii] * fade
    return np.where(water, U2, 0.0), np.where(water, V2, 0.0)


def currents(city, cache, water_in_n, water_out_n):
    """Returns dict of arrays and meta for the current overlay, or (None, meta)."""
    src = []
    res = {}
    hy_out = None
    # outer first: the inner grid takes the filled outer HYCOM field where
    # HYCOM has no cell of its own (most harbours are land in its mask)
    for name, g, n, water in (('out', geo.OUTER, CUR_OUT, water_out_n), ('in', geo.INNER, CUR_IN, water_in_n)):
        lon, lat = geo.grid_lonlat(city, g, n)
        cell = 2 * g['half'] / n
        U = np.full((HOURS, n, n), np.nan)
        V = np.full_like(U, np.nan)
        hy = hycom_series(cache, city, lon, lat)
        if hy is not None:
            U, V = hy
            if 'HYCOM' not in src:
                src.append('HYCOM')
        if name == 'in' and hy_out is not None:
            xs = geo.centers(g, n)
            X, Y = np.meshgrid(xs, xs)
            miss = ~np.isfinite(U[0])
            for k in range(HOURS):
                U[k][miss] = bilinear(hy_out[0][k], geo.OUTER['half'], X[miss], Y[miss])
                V[k][miss] = bilinear(hy_out[1][k], geo.OUTER['half'], X[miss], Y[miss])
        U, V = fill_near(U, V, water, cell)
        if name == 'out':
            hy_out = (U, V)
        td = tidal_series(city, lon, lat)
        if td is not None:
            TU, TV, valid, info = td
            if valid.any():
                # feather 3 cells into the HYCOM field
                w = ndimage.distance_transform_edt(valid) / 3.0
                w = np.clip(w, 0, 1)
                TU2, TV2 = fill_near(np.where(valid, TU, np.nan), np.where(valid, TV, np.nan), water, cell, 400.0)
                U = U * (1 - w) + TU2 * w
                V = V * (1 - w) + TV2 * w
                if info['model'] not in src:
                    src.append(info['model'])
                res['tidal'] = info
        # slow toward the shore over 2 cells (no flow into the coast)
        dist = ndimage.distance_transform_edt(water)
        taper = np.clip((dist - 0.5) / 2.0, 0, 1) if name == 'in' else np.clip(dist / 1.0, 0, 1)
        U, V = U * taper, V * taper
        res[name] = (U, V)
    if not src:
        return None, {'current': None}
    spIn = np.hypot(*res['in'])
    spOut = np.hypot(*res['out'])
    # no model water near the city (for example Amsterdam, 25 km inland of
    # the HYCOM coast): no current overlay, rather than still water
    if spIn.max() < 0.03 and 'tidal' not in res:
        return None, {'current': None}
    arrays, meta = {}, {}
    for name in ('in', 'out'):
        U, V = res[name]
        sc = max(np.abs(U).max(), np.abs(V).max(), 1e-3)
        q = np.stack([U, V], -1) / sc * 127.0
        arrays['cur_' + name] = np.clip(np.round(q), -127, 127).astype(np.int8)
        meta['curScale' + name.capitalize()] = round(float(sc / 127.0), 6)
    wet = spIn[:, water_in_n] if water_in_n.any() else spOut[:, water_out_n]
    meta['curTop'] = round(float(max(np.percentile(wet, 97), 0.08)), 3)
    meta['curMax'] = round(float(wet.max()), 3)
    meta['current'] = {'sources': src, 'tidal': res.get('tidal'), 'hours': HOURS, 'startUTC': WINDOW_START}
    return arrays, meta


# ---------------------------------------------------------------- wind inputs
def rough_raster(lc_in, bheight_frac):
    """(256, 256, 2) uint8: drag 0..1 from land cover and building cover; land share smoothed."""
    k = lc_in.shape[0] // ROUGH_N
    r = np.zeros(lc_in.shape, np.float32)
    for c, v in ROUGH.items():
        r[lc_in == c] = v
    r = down(r, k)
    r = np.clip(r + 0.8 * bheight_frac, 0, 1)
    land = down((lc_in != 80).astype(np.float32), k)
    cell = 2 * geo.INNER['half'] / ROUGH_N
    land = ndimage.gaussian_filter(land, 1200.0 / cell, mode='nearest')
    return np.clip(np.stack([r, land], -1) * 255 + 0.5, 0, 255).astype(np.uint8)


def building_cover(bs, n):
    """Share of each ROUGH cell covered by buildings (inner grid)."""
    half = geo.INNER['half']
    img = Image.new('L', (n * 4, n * 4), 0)
    d = ImageDraw.Draw(img)
    k = n * 4 / (2 * half)
    for b in bs:
        r = b['rings'][0] * 0.5
        d.polygon([((x + half) * k, (half - y) * k) for x, y in r], fill=255)
    a = np.asarray(img, np.float32)[::-1] / 255.0
    return down(a, 4)


# ---------------------------------------------------------------- labels
def latin(s):
    return s and all(ord(ch) < 0x2000 for ch in s)


def latin_part(s):
    """'中文 English' -> 'English'; a name with no Latin letters -> None."""
    if not s:
        return None
    if latin(s):
        return s.strip()
    runs, cur = [], ''
    for ch in s:
        if ord(ch) < 0x2000:
            cur += ch
        else:
            runs.append(cur)
            cur = ''
    runs.append(cur)
    best = max((r.strip() for r in runs), key=len)
    return best if sum(c.isalpha() for c in best) >= 3 else None


def labels(city, con, cache, ground_in, surf_in):
    R = city['r'] * 1000.0
    rows = con.execute("""SELECT subtype, name, name_en, population, wkb FROM read_parquet(?) WHERE city = ?""",
                       [os.path.join(cache, 'overture', 'places.parquet'), city['id']]).fetchall()
    rank = {'macrohood': 0, 'neighborhood': 1, 'microhood': 2}
    cand = []
    for sub, name, name_en, pop, b in rows:
        if sub not in rank:
            continue
        nm = name_en if latin(name_en) else (name if latin(name) else None)
        if not nm or len(nm) > 26:
            continue
        g = to_local(city, swkb.loads(bytes(b)))
        p = g if g.geom_type == 'Point' else g.representative_point()
        dist = math.hypot(p.x, p.y)
        if dist > R * 1.5:
            continue
        cand.append((rank[sub], -(pop or 0), dist, nm, p.x, p.y))
    cand.sort()
    out = []
    for rk, _, dist, nm, x, y in cand:
        if any(math.hypot(x - o['x'], y - o['y']) < 900 for o in out):
            continue
        if any(o['name'].lower() == nm.lower() for o in out):
            continue
        z = float(bilinear(surf_in, geo.INNER['half'], x, y))
        out.append({'name': nm.upper(), 'x': round(x, 1), 'y': round(y, 1), 'z': round(z, 1),
                    'size': 'md' if rk == 0 else 'sm'})
        if len(out) >= 9:
            break
    # water names: rivers, bays and straits near the centre
    rows = con.execute("""SELECT class, name, wkb FROM read_parquet(?) WHERE city = ? AND name IS NOT NULL""",
                       [os.path.join(cache, 'overture', 'water.parquet'), city['id']]).fetchall()
    wc = {}
    box = shapely.box(-R * 1.2, -R * 1.2, R * 1.2, R * 1.2)
    for cls, nm, b in rows:
        nm = latin_part(nm)
        if cls not in WATER_LABEL or not nm or len(nm) > 26 or '/' in nm:
            continue
        g = to_local(city, swkb.loads(bytes(b)))
        if not g.intersects(box):
            continue
        g = g.intersection(box)
        if g.is_empty:
            continue
        p = g if g.geom_type == 'Point' else g.representative_point()
        size = g.area if g.area > 0 else 1.0
        key = nm.lower()
        if key not in wc or wc[key][0] < size:
            wc[key] = (size, nm, p.x, p.y)
    wl = sorted(wc.values(), key=lambda v: -v[0])
    nw = 0
    for size, nm, x, y in wl:
        if any(math.hypot(x - o['x'], y - o['y']) < 900 for o in out):
            continue
        z = float(bilinear(surf_in, geo.INNER['half'], x, y))
        out.append({'name': nm.upper(), 'x': round(x, 1), 'y': round(y, 1), 'z': round(z, 1), 'size': 'sm', 'water': 1})
        nw += 1
        if nw >= 3:
            break
    return out


# ---------------------------------------------------------------- file
def write_bin(path, meta, arrays, delta):
    secs, blobs, off = [], [], 0
    for name, a in arrays.items():
        a = np.ascontiguousarray(a)
        dtn = {np.int8: 'i8', np.uint8: 'u8', np.int16: 'i16', np.uint16: 'u16', np.int32: 'i32',
               np.uint32: 'u32', np.float32: 'f32'}[a.dtype.type]
        raw = a
        mode = delta.get(name)
        if mode == 'row':
            d = a.astype(np.int32)
            d[..., 1:] = d[..., 1:] - d[..., :-1]
            raw = d.astype(np.int16)
        elif mode == 'stream':
            flat = a.reshape(len(a), -1).astype(np.int32)
            d = flat.copy()
            d[1:] = flat[1:] - flat[:-1]
            raw = d.astype(np.int16)            # wraps like JS Int16Array arithmetic
        if mode:
            dtn = 'i16'
        b = raw.tobytes()
        secs.append({'name': name, 'dtype': dtn, 'shape': list(a.shape), 'offset': off, 'length': len(b),
                     **({'delta': mode} if mode else {})})
        pad = (-len(b)) % 8
        blobs.append(b + b'\0' * pad)
        off += len(b) + pad
    head = json.dumps({'version': 1, 'meta': meta, 'sections': secs}, separators=(',', ':')).encode()
    pre = b'CTA1' + len(head).to_bytes(4, 'little') + head
    pre += b'\0' * ((-len(pre)) % 8)
    z = zlib.compress(pre + b''.join(blobs), 9)
    open(path, 'wb').write(z)
    return len(z), {s['name']: s['length'] for s in secs}


def build(city, con, cache):
    t = time.time()
    T = np.load(os.path.join(cache, 'terrain', city['id'] + '.npz'))
    LC = np.load(os.path.join(cache, 'landcover', city['id'] + '.npz'))
    wf_in, wf_out, lc_in, lc_out, wstats = water_masks(city, con, cache, LC['inner'], LC['outer'])
    w_out = resize_mean(wf_out.astype(np.float32) / 255.0, geo.OUTER['n']) > 0.5
    n_in = T['inner'].shape[0]
    w_in_h = down(wf_in.astype(np.float32) / 255.0, WF_N // n_in) > 0.5
    raw_in, spk_in = despike(T['inner'].astype(np.float64))
    raw_out, spk_out = despike(T['outer'].astype(np.float64))
    g_in, s_in = heights(raw_in, w_in_h)
    g_out, s_out = heights(raw_out, w_out)
    bs, tagged = load_buildings(city, con, cache, g_in)
    arrays = {
        't_in': np.round(np.clip(g_in, -3270, 3270) * 10).astype(np.int16),
        's_in': np.round(np.clip(s_in, -3270, 3270) * 10).astype(np.int16),
        't_out': np.round(np.clip(g_out, -3270, 3270) * 10).astype(np.int16),
        's_out': np.round(np.clip(s_out, -3270, 3270) * 10).astype(np.int16),
        'wf_in': wf_in, 'wf_out': wf_out,
        'lc_in': lc_in.astype(np.uint8), 'lc_out': lc_out.astype(np.uint8),
    }
    arrays['rough'] = rough_raster(lc_in, building_cover(bs, ROUGH_N))
    cw_in = resize_mean(wf_in.astype(np.float32) / 255.0, CUR_IN) > 0.5
    cw_out = resize_mean(w_out.astype(np.float32), CUR_OUT) > 0.5
    cur, cmeta = currents(city, cache, cw_in, cw_out)
    if cur:
        arrays.update(cur)
    arrays.update(pack_buildings(bs))
    wind = json.load(open(os.path.join(cache, 'wind', city['id'] + '.json')))
    land_fine = (~w_in_h)
    xs = geo.centers(geo.INNER)
    X, Y = np.meshgrid(xs, xs)
    near = land_fine & (np.hypot(X, Y) < city['r'] * 1000)
    ground_ref = float(np.median(g_in[near])) if near.any() else 0.0
    hs = np.array([b['h'] for b in bs]) if bs else np.zeros(1)
    est = np.array([b['kind'] >= 128 for b in bs]) if bs else np.zeros(1, bool)
    meta = {
        'id': city['id'], 'title': city['title'], 'region': city['region'], 'country': city['country'],
        'lat': city['lat'], 'lon': city['lon'], 'r': city['r'], 'tz': city['tz'], 'blurb': city['blurb'],
        'grid': {'inner': {'half': geo.INNER['half'], 'n': n_in}, 'outer': {'half': geo.OUTER['half'], 'n': geo.OUTER['n']}},
        'bHalf': city['r'] * 1000 + 200, 'fHalf': city['r'] * 1000 + 300,
        'groundRef': round(ground_ref, 1),
        'buildings': {'count': len(bs), 'tagged': tagged, 'tallest': round(float(hs[~est].max()) if (~est).any() else float(hs.max()), 1),
                      'over100': int((hs >= 100).sum()), 'meanH': round(float(hs.mean()), 1)},
        'terrain': {'min': round(float(g_out.min()), 1), 'max': round(float(g_in.max()), 1),
                    'maxOut': round(float(g_out.max()), 1), 'deepest': round(float(g_out.min()), 1)},
        'wind': wind,
        'labels': labels(city, con, cache, g_in, s_in),
        'terrainSpikesFilled': spk_in + spk_out,
        **wstats, **cmeta,
    }
    path = os.path.join(OUT, city['id'] + '.bin')
    size, parts = write_bin(path, meta, arrays, {'t_in': 'row', 's_in': 'row', 't_out': 'row', 's_out': 'row', 'b_xy': 'stream'})
    big = sorted(parts.items(), key=lambda kv: -kv[1])[:4]
    print(f"{city['id']:16s} {size / 1e6:5.2f} MB  buildings {len(bs):6d} (tagged {tagged})  tallest {meta['buildings']['tallest']:6.1f} m  "
          f"ground {ground_ref:6.1f} m  current {cmeta.get('current') and cmeta['current']['sources']}  "
          f"labels {len(meta['labels'])}  {time.time() - t:4.0f} s  raw: " + ', '.join(f'{k} {v // 1024} KB' for k, v in big), flush=True)
    return {'id': city['id'], 'title': city['title'], 'region': city['region'], 'country': city['country'],
            'lat': city['lat'], 'lon': city['lon'], 'bytes': size, 'buildings': len(bs),
            'current': bool(cur), 'tallest': meta['buildings']['tallest']}


def main():
    global TIDAL
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True)
    ap.add_argument('--only', nargs='*')
    ap.add_argument('--tidal', default=TIDAL)
    a = ap.parse_args()
    TIDAL = a.tidal
    os.makedirs(OUT, exist_ok=True)
    cities = json.load(open(os.path.join(HERE, 'cities.json')))
    con = duckdb.connect()
    idx_path = os.path.join(OUT, 'index.json')
    index = {c['id']: c for c in (json.load(open(idx_path)) if os.path.exists(idx_path) else [])}
    for c in cities:
        if a.only and c['id'] not in a.only:
            continue
        index[c['id']] = build(c, con, a.cache)
    order = [c['id'] for c in cities]
    lst = [index[i] for i in order if i in index]
    json.dump(lst, open(idx_path, 'w'), indent=1)
    print(f'index: {len(lst)} cities, {sum(x["bytes"] for x in lst) / 1e6:.1f} MB')


if __name__ == '__main__':
    main()

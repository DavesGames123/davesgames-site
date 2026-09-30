#!/usr/bin/env python3
"""Build the tidal-currents datasets (format version 2) from cached NOAA OFS surface fields.

Usage:
  python3 tools/build_data.py --cache <cache dir> [--only <id> ...] [--quicklook <dir>]
      [--ne <Natural Earth dir>] [--out <data dir>] [--hours N]

Input: <cache>/<model>/YYYYMMDDHH.npz (UTC hour) and <cache>/<model>/grid.npz,
written by tools/fetch_ofs.py. Natural Earth 10m land and lakes (GeoJSON) are
read from --ne (default <cache>/naturalearth). The script downloads them when
they are missing.

Output for each location, in data/<id>/:
  mask.png        8-bit water coverage at 2x field resolution (the visible coast)
  base.png        R coverage, G mean temp, B/A mean u/v (signed)
  vel0..vel5.png  velocity EOF modes, two modes per image (signed)
  temp.png        temperature EOF modes 0..3 (signed)
  thumb.webp      small static preview for the location menu
  meta.json       see SPEC.md and SPEC2.md
and data/index.json, which lists every location with a meta.json on disk.

Steps for each location:
  1. Grow the core bbox to the extent. Pick the field resolution.
  2. Rasterize water coverage at mask resolution (antialiased). Drop specks.
  3. Fade the water near open model boundaries (Natural Earth sea that the
     model does not cover, and the manual openBoundaryFade boxes).
  4. Interpolate each hour of u, v, temp to the water pixels.
  5. Compress with EOFs: velocity mean + 12 modes, temperature mean + 4 modes.
  6. Quantize to PNGs. Extend fields 6 px into land. Other land is 128.
  7. Decode the PNGs again and print the error against the raw fields.

Signed decode: s(c) = clamp((c - 128) / 127, -1, 1) for a byte c.

grep: class FvcomMapper  class RomsMapper  def make_geo  def cell_size_m
      def reference_water  def open_boundary_fade  def eof  def write_thumb
      def build  def validate  def quicklook
"""
import argparse, datetime as dt, json, math, os, re, sys, time, urllib.request

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, sparse

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.dirname(HERE)
OUT = os.path.join(PAGE, 'data')   # set by --out
KIND = {'sfbofs': 'fvcom', 'sscofs': 'fvcom', 'lmhofs': 'fvcom', 'leofs': 'fvcom', 'ngofs2': 'fvcom',
        'ciofs': 'roms', 'cbofs': 'roms', 'dbofs': 'roms', 'tbofs': 'roms', 'gomofs': 'roms'}
VEL_MODES, TEMP_MODES = 12, 4
BAND_PX = 6          # field extension into land, field pixels
SS = 2               # coverage supersampling per axis, at mask resolution
MASK_SCALE = 2       # mask resolution / field resolution
MIN_SPECK = 25.0     # water components with less coverage (field pixels) are dropped
FADE_PX = 40.0       # open-boundary fade length, mask pixels (minimum)
FADE_FRAC = 0.08     # open-boundary fade length as a fraction of the mask long side
SEA_BUFFER_M = 1000  # reference sea closer than this to reference land is not a seed
SEED_MIN_KM2 = 25.0  # smaller seed patches (islands missing from the reference) are ignored
LONG_SIDE = 1280     # field resolution, long side, pixels
ASPECT_WIDE, ASPECT_TALL = 1.78, 0.5
M_PER_DEG = 6371000.0 * math.pi / 180.0
KNOTS = 1.0 / 0.514444
SPEED_REF_MIN = 0.45  # m/s, floor for speedRef
MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
          'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']
NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- raster grid

def pixel_centers(geo, ss=1):
    """Return lon, lat arrays (H*ss, W*ss) of sub-pixel centers. Row 0 is north."""
    b = geo['bbox']
    W, H = geo['width'] * ss, geo['height'] * ss
    lon = b['lon0'] + (np.arange(W) + 0.5) / W * (b['lon1'] - b['lon0'])
    lat = b['lat1'] - (np.arange(H) + 0.5) / H * (b['lat1'] - b['lat0'])
    return np.meshgrid(lon, lat)


def block_mean(a, ss):
    H, W = a.shape[0] // ss, a.shape[1] // ss
    return a.reshape(H, ss, W, ss).mean(axis=(1, 3))


def upsample(a, s):
    return np.repeat(np.repeat(a, s, 0), s, 1)


def make_geo(loc, cell_m):
    """Return the extent bbox and the field and mask sizes for a location.

    The extent is the core grown about its center, so that it holds the core
    at aspect 1.78 (wide) and at aspect 0.5 (tall). Pixels are square in metres.
    The field pixel is not finer than half the model cell size.
    """
    c = loc['core']
    latc = 0.5 * (c['lat0'] + c['lat1'])
    lonc = 0.5 * (c['lon0'] + c['lon1'])
    kx = M_PER_DEG * math.cos(math.radians(latc))
    cw = (c['lon1'] - c['lon0']) * kx
    ch = (c['lat1'] - c['lat0']) * M_PER_DEG
    if loc.get('extent'):
        e = loc['extent']
    else:
        ew = max(cw, ASPECT_WIDE * ch)
        eh = max(ch, cw / ASPECT_TALL)
        e = {'lon0': lonc - ew / kx / 2, 'lon1': lonc + ew / kx / 2,
             'lat0': latc - eh / M_PER_DEG / 2, 'lat1': latc + eh / M_PER_DEG / 2}
    e = {k: round(v, 5) for k, v in e.items()}
    ew = (e['lon1'] - e['lon0']) * kx
    eh = (e['lat1'] - e['lat0']) * M_PER_DEG
    px_m = max(ew, eh) / LONG_SIDE
    px_m = max(px_m, 0.5 * cell_m)
    W, H = int(round(ew / px_m)), int(round(eh / px_m))
    core = {'x0': (c['lon0'] - e['lon0']) / (e['lon1'] - e['lon0']),
            'x1': (c['lon1'] - e['lon0']) / (e['lon1'] - e['lon0']),
            'y0': (e['lat1'] - c['lat1']) / (e['lat1'] - e['lat0']),
            'y1': (e['lat1'] - c['lat0']) / (e['lat1'] - e['lat0'])}
    return {'bbox': e, 'width': W, 'height': H, 'core': {k: round(v, 5) for k, v in core.items()},
            'px_m': eh / H, 'mask': {'bbox': e, 'width': W * MASK_SCALE, 'height': H * MASK_SCALE}}


def cell_size_m(grid, kind, core):
    """Model cell size (m) inside the core bbox: the 20th percentile, so the
    fine parts of the mesh (rivers, passes) set the resolution."""
    if kind == 'fvcom':
        lon = np.where(grid['lon'] > 180, grid['lon'] - 360.0, grid['lon']).astype(np.float64)
        lat = grid['lat'].astype(np.float64)
        nv = grid['nv'].T.astype(np.int64) - 1
        cx, cy = lon[nv].mean(1), lat[nv].mean(1)
        s = (cx > core['lon0']) & (cx < core['lon1']) & (cy > core['lat0']) & (cy < core['lat1'])
        t = nv[s]
        kx = M_PER_DEG * np.cos(np.radians(cy[s]))
        ax, ay = (lon[t[:, 1]] - lon[t[:, 0]]) * kx, (lat[t[:, 1]] - lat[t[:, 0]]) * M_PER_DEG
        bx, by = (lon[t[:, 2]] - lon[t[:, 0]]) * kx, (lat[t[:, 2]] - lat[t[:, 0]]) * M_PER_DEG
        area = 0.5 * np.abs(ax * by - ay * bx)
        return float(np.percentile(np.sqrt(2 * area), 20)) if area.size else 1.0
    lon = np.where(grid['lon_rho'] > 180, grid['lon_rho'] - 360, grid['lon_rho'])
    lat = grid['lat_rho']
    m = grid['mask_rho'] > 0.5
    s = m & (lon > core['lon0']) & (lon < core['lon1']) & (lat > core['lat0']) & (lat < core['lat1'])
    kx = M_PER_DEG * np.cos(np.radians(lat))
    dx = np.hypot(np.diff(lon, axis=1) * kx[:, 1:], np.diff(lat, axis=1) * M_PER_DEG)
    dy = np.hypot(np.diff(lon, axis=0) * kx[1:], np.diff(lat, axis=0) * M_PER_DEG)
    d = np.sqrt(dx[1:, :] * dy[:, 1:])
    sel = s[1:, 1:]
    return float(np.percentile(d[sel], 20)) if sel.any() else 1.0


# ---------------------------------------------------------------- reference land

def load_ne(ne_dir):
    os.makedirs(ne_dir, exist_ok=True)
    out = {}
    for name in ('ne_10m_land', 'ne_10m_lakes'):
        p = os.path.join(ne_dir, name + '.geojson')
        if not os.path.exists(p):
            log(f'  download {name}')
            urllib.request.urlretrieve(NE_URL + name + '.geojson', p)
        with open(p) as f:
            out[name] = json.load(f)
    return out


def _rings(geom):
    if geom['type'] == 'Polygon':
        yield geom['coordinates']
    elif geom['type'] == 'MultiPolygon':
        for poly in geom['coordinates']:
            yield poly


def reference_water(ne, geo):
    """Rasterize Natural Earth water (sea and lakes) at the geo raster. True = water."""
    b = geo['bbox']
    W, H = geo['width'], geo['height']
    img = Image.new('L', (W, H), 0)          # 0 water, 255 land
    dr = ImageDraw.Draw(img)

    def draw(fc, fill_outer, fill_hole):
        for feat in fc['features']:
            for poly in _rings(feat['geometry']):
                outer = np.asarray(poly[0])
                if (outer[:, 0].max() < b['lon0'] or outer[:, 0].min() > b['lon1'] or
                        outer[:, 1].max() < b['lat0'] or outer[:, 1].min() > b['lat1']):
                    continue
                for k, ring in enumerate(poly):
                    r = np.asarray(ring)
                    x = (r[:, 0] - b['lon0']) / (b['lon1'] - b['lon0']) * W
                    y = (b['lat1'] - r[:, 1]) / (b['lat1'] - b['lat0']) * H
                    dr.polygon(list(zip(x.tolist(), y.tolist())), fill=fill_outer if k == 0 else fill_hole)
    draw(ne['ne_10m_land'], 255, 0)
    draw(ne['ne_10m_lakes'], 0, 255)
    return np.asarray(img) < 128


# ---------------------------------------------------------------- FVCOM mapper

class FvcomMapper:
    """Map FVCOM element (u, v) and node (temp) values to raster pixels.

    Element velocities go to nodes by a plain mean over the incident elements.
    Nodes go to pixels by barycentric weights in lon/lat space.
    Outputs: maskcov (mask res coverage), inside (mask res, inside the mesh),
    valid (field res, pixel center inside the mesh).
    """

    def __init__(self, grid, geo, paths=None):
        from matplotlib.tri import Triangulation
        b = geo['bbox']
        lon = np.where(grid['lon'] > 180, grid['lon'] - 360.0, grid['lon']).astype(np.float64)
        lat = grid['lat'].astype(np.float64)
        nv = grid['nv'].T.astype(np.int64) - 1
        padx, pady = 0.05 * (b['lon1'] - b['lon0']), 0.05 * (b['lat1'] - b['lat0'])
        cx, cy = lon[nv].mean(1), lat[nv].mean(1)
        esel = np.nonzero((cx > b['lon0'] - padx) & (cx < b['lon1'] + padx) &
                          (cy > b['lat0'] - pady) & (cy < b['lat1'] + pady))[0]
        nodes, inv = np.unique(nv[esel], return_inverse=True)
        tris = inv.reshape(-1, 3)
        self.esel, self.nodes = esel, nodes
        x, y = lon[nodes], lat[nodes]
        finder = Triangulation(x, y, tris).get_trifinder()
        self.domain = dict(lon=(float(lon.min()), float(lon.max())), lat=(float(lat.min()), float(lat.max())))

        t0 = time.time()
        sx, sy = pixel_centers(geo['mask'], SS)
        hit = np.zeros(sx.shape, bool)
        for r in range(0, sx.shape[0], 256):
            hit[r:r + 256] = finder(sx[r:r + 256], sy[r:r + 256]) >= 0
        del sx, sy
        self.maskcov = block_mean(hit.astype(np.float32), SS)
        self.inside = self.maskcov > 0
        px, py = pixel_centers(geo, 1)
        self.tpix = finder(px, py)
        self.valid = self.tpix >= 0
        self.peak_ok = np.ones(self.valid.shape, bool)
        log(f'  fvcom: {len(esel)} elements, {len(nodes)} nodes, raster {time.time() - t0:.1f}s')
        self.px, self.py = px, py
        self._tris, self._x, self._y = tris, x, y
        n_el = len(esel)
        rows = tris.ravel()
        cols = np.repeat(np.arange(n_el), 3)
        A = sparse.csr_matrix((np.ones(rows.size), (rows, cols)), shape=(len(nodes), n_el))
        cnt = np.asarray(A.sum(1)).ravel()
        self.A = sparse.diags(1.0 / np.maximum(cnt, 1)) @ A

    def finalize(self, valid):
        """Build the pixel weight matrices for the final valid mask."""
        idx = np.flatnonzero(valid)
        t = self.tpix.ravel()[idx]
        a, b_, c = self._tris[t, 0], self._tris[t, 1], self._tris[t, 2]
        x, y = self._x, self._y
        px, py = self.px.ravel()[idx], self.py.ravel()[idx]
        det = (y[b_] - y[c]) * (x[a] - x[c]) + (x[c] - x[b_]) * (y[a] - y[c])
        wa = ((y[b_] - y[c]) * (px - x[c]) + (x[c] - x[b_]) * (py - y[c])) / det
        wb = ((y[c] - y[a]) * (px - x[c]) + (x[a] - x[c]) * (py - y[c])) / det
        wc = 1.0 - wa - wb
        n = idx.size
        rows = np.repeat(np.arange(n), 3)
        cols = np.stack([a, b_, c], 1).ravel()
        w = np.stack([wa, wb, wc], 1).ravel()
        self.B = sparse.csr_matrix((w, (rows, cols)), shape=(n, len(self.nodes)))
        self.P = (self.B @ self.A).tocsr()

    def sample(self, d):
        u = self.P @ d['u'][self.esel].astype(np.float64)
        v = self.P @ d['v'][self.esel].astype(np.float64)
        T = self.B @ d['temp'][self.nodes].astype(np.float64)
        return u, v, T


# ---------------------------------------------------------------- ROMS mapper

def rasterize_tris(x, y, tris, geo):
    """Return the index of the triangle that holds each pixel center (-1: none).

    Later triangles in the list overwrite earlier ones where they overlap.
    """
    b = geo['bbox']
    W, H = geo['width'], geo['height']
    # Vertex positions in pixel units; pixel (r, c) has its center at (c, r).
    X = (x - b['lon0']) / (b['lon1'] - b['lon0']) * W - 0.5
    Y = (b['lat1'] - y) / (b['lat1'] - b['lat0']) * H - 0.5
    tx, ty = X[tris], Y[tris]
    c0 = np.clip(np.ceil(tx.min(1)), 0, W).astype(np.int64)
    c1 = np.clip(np.floor(tx.max(1)), -1, W - 1).astype(np.int64)
    r0 = np.clip(np.ceil(ty.min(1)), 0, H).astype(np.int64)
    r1 = np.clip(np.floor(ty.max(1)), -1, H - 1).astype(np.int64)
    nw, nh = np.maximum(c1 - c0 + 1, 0), np.maximum(r1 - r0 + 1, 0)
    cnt = nw * nh
    out = np.full(H * W, -1, np.int64)
    ids = np.nonzero(cnt)[0]
    tot = int(cnt[ids].sum())
    tid = np.repeat(ids, cnt[ids])
    k = np.arange(tot) - np.repeat(np.cumsum(cnt[ids]) - cnt[ids], cnt[ids])
    rr = r0[tid] + k // nw[tid]
    cc = c0[tid] + k % nw[tid]
    ax, ay = tx[tid, 0], ty[tid, 0]
    bx, by = tx[tid, 1], ty[tid, 1]
    qx, qy = tx[tid, 2], ty[tid, 2]
    d = (by - qy) * (ax - qx) + (qx - bx) * (ay - qy)
    with np.errstate(divide='ignore', invalid='ignore'):
        w0 = ((by - qy) * (cc - qx) + (qx - bx) * (rr - qy)) / d
        w1 = ((qy - ay) * (cc - qx) + (ax - qx) * (rr - qy)) / d
    e = -1e-9
    ok = (w0 >= e) & (w1 >= e) & (1 - w0 - w1 >= e) & (d != 0)
    # Assignment keeps the last write for repeated pixels (triangle order).
    out[(rr * W + cc)[ok]] = tid[ok]
    return out.reshape(H, W)


class RomsMapper:
    """Map ROMS rho-point fields to raster pixels by bilinear sampling in index space.

    Each grid cell with a water corner splits into two triangles. The pixels
    get their fractional (eta, xi) index from these triangles. (A Delaunay
    mesh of all rho points is wrong: a curvilinear grid can fold over land.)
    Land cells get zero weight, so samples near the coast use water cells only.
    """

    def __init__(self, grid, geo, paths):
        b = geo['bbox']
        lon = grid['lon_rho'].astype(np.float64)
        lon = np.where(lon > 180, lon - 360, lon)
        lat = grid['lat_rho'].astype(np.float64)
        self.domain = dict(lon=(float(lon.min()), float(lon.max())), lat=(float(lat.min()), float(lat.max())))
        pad = 0.08
        inb = ((lon > b['lon0'] - pad * 3) & (lon < b['lon1'] + pad * 3) &
               (lat > b['lat0'] - pad) & (lat < b['lat1'] + pad))
        ei, xi = np.nonzero(inb)
        e0, e1 = max(ei.min() - 2, 0), min(ei.max() + 3, lon.shape[0])
        x0, x1 = max(xi.min() - 2, 0), min(xi.max() + 3, lon.shape[1])
        self.sl = sl = (slice(e0, e1), slice(x0, x1))
        slon, slat = lon[sl], lat[sl]
        t0 = time.time()
        nx = x1 - x0
        mw = grid['mask_rho'][sl] > 0.5
        q = mw[:-1, :-1] | mw[1:, :-1] | mw[1:, 1:] | mw[:-1, 1:]
        qi, qj = np.nonzero(q)
        a = qi * nx + qj
        b_, c, d = a + nx, a + nx + 1, a + 1
        tris = np.concatenate([np.stack([a, b_, c], 1), np.stack([a, c, d], 1)])
        used, inv = np.unique(tris, return_inverse=True)
        tris = inv.reshape(-1, 3)
        x, y = slon.ravel()[used], slat.ravel()[used]
        # Cells with all corners in water go last, so they win where cells overlap.
        full = (mw[:-1, :-1] & mw[1:, :-1] & mw[1:, 1:] & mw[:-1, 1:])[qi, qj]
        tris = tris[np.argsort(np.concatenate([full, full]), kind='stable')]
        EE, XX = np.divmod(used, nx)
        self.ie, self.ix, inside = self._index_map(x, y, tris, EE, XX, geo)
        self.ie_m, self.ix_m, inside_m = self._index_map(x, y, tris, EE, XX, geo['mask'])
        log(f'  roms: subset {e1 - e0}x{x1 - x0}, index maps {time.time() - t0:.1f}s')
        self.angle = grid['angle'][sl].astype(np.float64)

        # ROMS wetting and drying: mask_rho also marks intertidal and upland
        # cells as water. A dry cell has near-zero velocity and a frozen
        # temperature. Keep a cell as water only when it is wet (speed above
        # 1 mm/s) for at least half of the hours.
        m = grid['mask_rho'][sl] > 0.5
        wet = np.zeros(m.shape)
        n = 0
        import warnings
        for p in paths:
            if p is None:
                continue
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', RuntimeWarning)
                ue, vn = self._rho_vel(np.load(p))
            wet += np.hypot(ue, vn) > 1e-3
            n += 1
        wetfrac = wet / max(n, 1)
        log(f'  roms: mask_rho water cells {int(m.sum())}, wet >= 50% of hours {int((m & (wetfrac >= 0.5)).sum())}')
        self.always = (m & (wetfrac >= 0.999)).astype(np.float64)
        self.m = (m & (wetfrac >= 0.5)).astype(np.float64)

        # Coverage at mask res: bilinear mask on a supersampled index map. The
        # model cells can be several pixels wide and make a stair-step coast,
        # so blur the mask by 2 field px and cut it at 0.5 with a smoothstep.
        ie_s = ndimage.zoom(self.ie_m, SS, order=1, mode='nearest', grid_mode=True)
        ix_s = ndimage.zoom(self.ix_m, SS, order=1, mode='nearest', grid_mode=True)
        mb = ndimage.map_coordinates(self.m, [ie_s, ix_s], order=1, mode='nearest')
        mb[~upsample(inside_m, SS)] = 0
        mb = ndimage.gaussian_filter(mb, 2.0 * MASK_SCALE * SS)
        mb = np.clip((mb - 0.4) / 0.2, 0, 1)
        mb = mb * mb * (3 - 2 * mb)
        self.maskcov = block_mean(mb.astype(np.float32), SS)
        self.inside = inside_m
        aw = ndimage.map_coordinates(self.always, [self.ie, self.ix], order=1, mode='nearest')
        self.peak_ok = inside & (aw > 0.999)
        m_c = ndimage.map_coordinates(self.m, [self.ie, self.ix], order=1, mode='nearest')
        self.valid = inside & (m_c > 0.05)

    @staticmethod
    def _index_map(x, y, tris, EE, XX, geo):
        t = rasterize_tris(x, y, tris, geo)
        px, py = pixel_centers(geo, 1)
        inside = t >= 0
        tt = t[inside]
        A, B, C = tris[tt, 0], tris[tt, 1], tris[tt, 2]
        qx, qy = px[inside], py[inside]
        det = (y[B] - y[C]) * (x[A] - x[C]) + (x[C] - x[B]) * (y[A] - y[C])
        wa = ((y[B] - y[C]) * (qx - x[C]) + (x[C] - x[B]) * (qy - y[C])) / det
        wb = ((y[C] - y[A]) * (qx - x[C]) + (x[A] - x[C]) * (qy - y[C])) / det
        wc = 1.0 - wa - wb
        ie = np.zeros(px.shape)
        ix = np.zeros(px.shape)
        ie[inside] = wa * EE[A] + wb * EE[B] + wc * EE[C]
        ix[inside] = wa * XX[A] + wb * XX[B] + wc * XX[C]
        return ie, ix, inside

    def finalize(self, valid):
        idx = np.flatnonzero(valid)
        self.coords = np.stack([self.ie.ravel()[idx], self.ix.ravel()[idx]])
        self.wsum = ndimage.map_coordinates(self.m, self.coords, order=1, mode='nearest')

    def _rho_vel(self, d):
        """Average u, v to rho points (NaN on land), then rotate to east/north."""
        u = d['u'].astype(np.float64)
        v = d['v'].astype(np.float64)
        u[np.abs(u) > 100] = np.nan
        v[np.abs(v) > 100] = np.nan
        H, W = d['temp'].shape
        up = np.full((H, W + 1), np.nan)
        up[:, 1:W] = u
        vp = np.full((H + 1, W), np.nan)
        vp[1:H, :] = v
        with np.errstate(invalid='ignore'):
            ur = np.nanmean(np.stack([up[:, :-1], up[:, 1:]]), axis=0)
            vr = np.nanmean(np.stack([vp[:-1, :], vp[1:, :]]), axis=0)
        ur, vr = np.nan_to_num(ur[self.sl]), np.nan_to_num(vr[self.sl])
        ca, sa = np.cos(self.angle), np.sin(self.angle)
        return ur * ca - vr * sa, ur * sa + vr * ca

    def _samp(self, f):
        f = np.where(self.m > 0.5, f, 0.0)
        s = ndimage.map_coordinates(f * self.m, self.coords, order=1, mode='nearest')
        return s / np.maximum(self.wsum, 1e-6)

    def sample(self, d):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', RuntimeWarning)
            ue, vn = self._rho_vel(d)
        T = d['temp'][self.sl].astype(np.float64)
        T = np.where(np.abs(T) > 100, 0.0, T)
        return self._samp(ue), self._samp(vn), self._samp(T)


# ---------------------------------------------------------------- helpers

def clean_mask(maskcov, min_area):
    """Drop small water specks at mask res. Return the cleaned coverage and the count."""
    lab, n = ndimage.label(maskcov > 0, structure=np.ones((3, 3)))
    if not n:
        return maskcov, 0
    area = ndimage.sum(maskcov, lab, index=np.arange(1, n + 1))
    keep_lab = np.zeros(n + 1, bool)
    keep_lab[1:] = area >= min_area
    return np.where(keep_lab[lab], maskcov, 0).astype(np.float32), int((~keep_lab[1:]).sum())


def smoothstep01(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def open_boundary_fade(maskcov, inside, refwater, loc, geo):
    """Fade the water out near an open model boundary (mask res).

    Seeds are pixels outside the model that the reference calls water, more
    than SEA_BUFFER_M from reference land. The manual openBoundaryFade boxes
    add all non-water pixels inside them as seeds. Coverage is multiplied by
    smoothstep(0, FADE_PX, distance to the nearest seed).
    """
    mg = geo['mask']
    px_m = geo['px_m'] / MASK_SCALE
    far = ndimage.distance_transform_edt(refwater) * px_m > SEA_BUFFER_M
    seeds = (~inside) & far & (maskcov <= 0)
    # Small seed patches are islands that the reference land lacks. Keep
    # only patches of at least SEED_MIN_KM2.
    lab, n = ndimage.label(seeds, structure=np.ones((3, 3)))
    if n:
        area = ndimage.sum(seeds, lab, index=np.arange(1, n + 1)) * (px_m / 1000.0) ** 2
        ok = np.zeros(n + 1, bool)
        ok[1:] = area >= SEED_MIN_KM2
        # An open boundary runs out to the raster edge. A patch closed in by
        # land is a bay or lake that the model leaves out, not open water.
        edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        touch = np.zeros(n + 1, bool)
        touch[edge] = True
        ok &= touch
        seeds = ok[lab]
    # Grow the seeds through non-water pixels that the reference calls water,
    # a little more than the buffer. This closes the gap between the seeds and
    # the model water where the open boundary meets a coast.
    if seeds.any():
        grow = int(math.ceil(SEA_BUFFER_M / px_m)) + 8
        seeds = ndimage.binary_dilation(seeds, iterations=grow, mask=(maskcov <= 0) & refwater)
    auto = int(seeds.sum())
    boxes = loc.get('openBoundaryFade') or []
    if boxes:
        lon, lat = pixel_centers(mg, 1)
        for q in boxes:
            seeds |= ((lon >= q['lon0']) & (lon <= q['lon1']) & (lat >= q['lat0']) & (lat <= q['lat1'])
                      & (maskcov <= 0))
    if not seeds.any():
        return maskcov, seeds, 0.0
    # The fade length grows with the raster, so it stays soft on a large screen.
    fade_px = max(FADE_PX, FADE_FRAC * max(maskcov.shape))
    fade = smoothstep01(ndimage.distance_transform_edt(~seeds) / fade_px)
    out = (maskcov * fade).astype(np.float32)
    lost = float((maskcov - out).sum()) / MASK_SCALE ** 2
    log(f'  open-boundary fade: {fade_px:.0f} px, {auto} auto seed px, {len(boxes)} box(es), coverage lost {lost:.0f} field px')
    return out, seeds, lost


def extension(valid):
    """Return (band mask, nearest valid position for each band pixel)."""
    dist, (ri, ci) = ndimage.distance_transform_edt(~valid, return_indices=True)
    band = (~valid) & (dist <= BAND_PX)
    pos = np.full(valid.shape, -1, np.int64)
    pos[valid] = np.arange(int(valid.sum()))
    near = pos[ri[band], ci[band]]
    return band, near


def to_full(vec, valid, band, near, fill=0.0):
    out = np.full(valid.shape, fill, np.float64)
    out[valid] = vec
    out[band] = vec[near]
    return out


def enc_signed(x):
    return np.clip(np.rint(128 + 127 * x), 1, 255).astype(np.uint8)


def dec_signed(c):
    return np.clip((c.astype(np.float64) - 128) / 127, -1, 1)


def eof(X, k):
    """X: (N, T) anomalies. Return modes (N, k), amps (T, k), variance fraction, eigenvalues."""
    T = X.shape[1]
    C = np.zeros((T, T))
    for r in range(0, X.shape[0], 200000):
        blk = X[r:r + 200000].astype(np.float64)
        C += blk.T @ blk
    w, V = np.linalg.eigh(C)
    order = np.argsort(w)[::-1]
    w, V = np.maximum(w[order], 0), V[:, order]
    s = np.sqrt(w[:k])
    modes = np.zeros((X.shape[0], k))
    for r in range(0, X.shape[0], 200000):
        modes[r:r + 200000] = (X[r:r + 200000].astype(np.float64) @ V[:, :k]) / np.maximum(s, 1e-12)
    amps = V[:, :k] * s
    return modes, amps, w[:k].sum() / max(w.sum(), 1e-30), w


def write_png(path, arr, mode='RGBA'):
    Image.fromarray(arr, mode).save(path, optimize=True)
    return os.path.getsize(path)


def ramp_stops():
    """Read STOPS from ../colormap.js, so the thumbnail uses the page ramp."""
    src = open(os.path.join(PAGE, 'colormap.js')).read()
    body = src[src.index('export const STOPS'):]
    body = body[:body.index('];')]
    stops = re.findall(r'\[\s*([\d.]+)\s*,\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\]\s*\]', body)
    return np.array([[float(v) for v in s] for s in stops])


def write_thumb(path, maskcov, meanT, meanSpd, legendF, speedRef, geo):
    """Static preview: dark land, water in the ramp by mean temp, lit by mean speed."""
    st = ramp_stops()
    tF = meanT * 9 / 5 + 32
    t = np.clip((tF - legendF[0]) / (legendF[1] - legendF[0]), 0, 1)
    rgb = np.stack([np.interp(t, st[:, 0], st[:, k]) for k in (1, 2, 3)], -1)
    lit = 0.28 + 0.9 * np.clip(meanSpd / max(speedRef, 1e-6), 0, 1) ** 0.6
    MH, MW = maskcov.shape
    img = rgb * lit[..., None]
    img = np.clip(img, 0, 1)
    img = ndimage.zoom(img, (MH / img.shape[0], MW / img.shape[1], 1), order=1)[:MH, :MW]
    land = np.array([0.035, 0.04, 0.05])
    cov = maskcov[..., None]
    out = land * (1 - cov) + img * cov
    im = Image.fromarray((out * 255).astype(np.uint8), 'RGB')
    s = 480 / max(MW, MH)
    im = im.resize((max(1, round(MW * s)), max(1, round(MH * s))), Image.LANCZOS)
    for q in (80, 70, 60, 50):
        im.save(path, 'WEBP', quality=q, method=6)
        if os.path.getsize(path) < 60000:
            break
    return os.path.getsize(path)


# ---------------------------------------------------------------- build

def load_hours(cache, model, start_utc, hours):
    out = []
    for h in range(hours):
        t = start_utc + dt.timedelta(hours=h)
        p = os.path.join(cache, model, f'{t:%Y%m%d%H}.npz')
        out.append(p if os.path.exists(p) else None)
    return out


def fill_plan(paths):
    """Return (runs, bad). Runs of < 3 missing hours get a linear fill in time."""
    miss = [i for i, p in enumerate(paths) if p is None]
    runs, i = [], 0
    while i < len(miss):
        j = i
        while j + 1 < len(miss) and miss[j + 1] == miss[j] + 1:
            j += 1
        runs.append((miss[i], miss[j]))
        i = j + 1
    bad = [r for r in runs if r[1] - r[0] + 1 >= 3 or r[0] == 0 or r[1] == len(paths) - 1]
    return runs, bad


def build(loc, cache, window, qdir, ne):
    lid, model = loc['id'], loc['model']
    log(f'== {lid} ({model})')
    start_local = dt.datetime.strptime(window['startLocal'], '%Y-%m-%dT%H:%M')
    hours = window['hours']
    start_utc = start_local - dt.timedelta(hours=loc['utcOffsetHours'])
    paths = load_hours(cache, model, start_utc, hours)
    runs, bad = fill_plan(paths)
    if bad:
        log(f'  ERROR: missing hours that cannot be filled: {bad} (of {len(runs)} gaps)')
        return None
    if runs:
        log(f'  filled gaps (linear in time): {runs}')

    grid = np.load(os.path.join(cache, model, 'grid.npz'))
    cell = cell_size_m(grid, KIND[model], loc['core'])
    geo = make_geo(loc, cell)
    W, H = geo['width'], geo['height']
    MW, MH = geo['mask']['width'], geo['mask']['height']
    b = geo['bbox']
    log(f'  model cell {cell:.0f} m; extent {b}; field {W}x{H} ({geo["px_m"]:.0f} m/px), mask {MW}x{MH}')
    mapper = (FvcomMapper if KIND[model] == 'fvcom' else RomsMapper)(grid, geo, paths)
    dom = mapper.domain
    log(f'  model domain lon {dom["lon"][0]:.3f}..{dom["lon"][1]:.3f} lat {dom["lat"][0]:.3f}..{dom["lat"][1]:.3f}')

    # Coverage: specks, fade, field-res coverage and valid pixels.
    maskcov, dropped = clean_mask(mapper.maskcov, MIN_SPECK * MASK_SCALE ** 2)
    refwater = reference_water(ne, geo['mask'])
    maskcov, seeds, lost = open_boundary_fade(maskcov, mapper.inside, refwater, loc, geo)
    cov = block_mean(maskcov, MASK_SCALE).astype(np.float32)
    keep = block_mean((maskcov > 0).astype(np.float32), MASK_SCALE) > 0
    valid = mapper.valid & keep
    band, near = extension(valid)
    fieldmask = valid | band
    cov[~fieldmask] = 0
    maskcov = np.where(upsample(fieldmask, MASK_SCALE), maskcov, 0).astype(np.float32)
    mapper.finalize(valid)
    N = int(valid.sum())
    log(f'  water pixels {N} ({N / (W * H):.1%}), band {int(band.sum())}, specks dropped {dropped}')

    # Sample every hour.
    t0 = time.time()
    U = np.zeros((N, hours), np.float32)
    V = np.zeros((N, hours), np.float32)
    TT = np.zeros((N, hours), np.float32)
    for h, p in enumerate(paths):
        if p is None:
            continue
        u, v, T = mapper.sample(np.load(p))
        U[:, h], V[:, h], TT[:, h] = u, v, T
    for a, z in runs:
        lo, hi = a - 1, z + 1
        for h in range(a, z + 1):
            f = (h - lo) / (hi - lo)
            for M in (U, V, TT):
                M[:, h] = (1 - f) * M[:, lo] + f * M[:, hi]
    log(f'  sampled {hours} h in {time.time() - t0:.1f}s')

    # EOF of velocity: stack [u; v].
    X = np.concatenate([U, V], 0)
    meanX = X.mean(1)
    X -= meanX[:, None]
    modes, amps, vfrac, _ = eof(X, VEL_MODES)
    del X
    mU, mV = meanX[:N], meanX[N:]
    Tmean = TT.mean(1)
    tmodes, tamps, tfrac, _ = eof(TT - Tmean[:, None], TEMP_MODES)
    log(f'  variance explained: vel {vfrac:.4f} ({VEL_MODES} modes), temp {tfrac:.4f} ({TEMP_MODES} modes)')
    if vfrac < 0.95:
        log(f'  NOTE: {VEL_MODES} velocity modes explain less than 95% of the variance')

    # Quantize the means.
    meanVelScale = float(max(np.abs(mU).max(), np.abs(mV).max(), 1e-6))
    qmU = dec_signed(enc_signed(mU / meanVelScale)) * meanVelScale
    qmV = dec_signed(enc_signed(mV / meanVelScale)) * meanVelScale
    tlo, thi = float(Tmean.min()), float(Tmean.max())
    tlo, thi = math.floor(tlo * 10) / 10, math.ceil(thi * 10) / 10
    if thi - tlo < 0.1:
        thi = tlo + 0.1
    gT = np.clip(np.rint((Tmean - tlo) / (thi - tlo) * 255), 0, 255).astype(np.uint8)
    qTmean = tlo + gT / 255.0 * (thi - tlo)

    # Quantize the modes; refit the coefficients against the quantized modes.
    scales = np.maximum(np.abs(modes).max(0), 1e-12)
    qmodes = dec_signed(enc_signed(modes / scales))
    Xq = np.concatenate([U, V], 0).astype(np.float64) - np.concatenate([qmU, qmV])[:, None]
    velCoef = np.linalg.solve(qmodes.T @ qmodes, qmodes.T @ Xq).T       # (hours, k)
    del Xq
    tscales = np.maximum(np.abs(tmodes).max(0), 1e-12)
    qt = dec_signed(enc_signed(tmodes / tscales))
    XTq = TT.astype(np.float64) - qTmean[:, None]
    tempCoef = np.linalg.solve(qt.T @ qt, qt.T @ XTq).T
    del XTq

    # Statistics from the raw fields over water pixels.
    wet = cov[valid] > 0.5
    spd = np.sqrt(U[wet].astype(np.float64) ** 2 + V[wet].astype(np.float64) ** 2)
    speedRef_p99 = float(np.percentile(spd, 99))
    # Low-energy sites (lakes) get a floor, so slow water does not look fast.
    speedRef = max(speedRef_p99, SPEED_REF_MIN)
    edge_max = float(spd.max())
    del spd
    # For ROMS the peak uses only cells that stay wet for every hour, 3 px or
    # more from the coast: wetting and drying fronts on the mud flats give
    # short spikes. FVCOM keeps all pixels, because narrow passes (for
    # example Deception Pass) are 1 px wide. The peak must be in the core.
    inner = cov > 0.5
    if KIND[model] == 'roms':
        inner = ndimage.binary_erosion(inner, iterations=3) & mapper.peak_ok
    cr = geo['core']
    incore = np.zeros((H, W), bool)
    incore[int(cr['y0'] * H):int(math.ceil(cr['y1'] * H)), int(cr['x0'] * W):int(math.ceil(cr['x1'] * W))] = True
    inner = (inner & incore)[valid]
    spd = np.sqrt(U[inner].astype(np.float64) ** 2 + V[inner].astype(np.float64) ** 2)
    pk = np.unravel_index(np.argmax(spd), spd.shape)
    ipk = int(np.flatnonzero(inner)[pk[0]])
    vidx = int(np.flatnonzero(valid)[ipk])
    peak_ms = float(np.hypot(U[ipk, pk[1]], V[ipk, pk[1]]))
    del spd
    pr, pc = divmod(vidx, W)
    plon = b['lon0'] + (pc + 0.5) / W * (b['lon1'] - b['lon0'])
    plat = b['lat1'] - (pr + 0.5) / H * (b['lat1'] - b['lat0'])
    # Temperature statistics over water in the core.
    wcore = (cov > 0.5) & incore
    tf = TT[wcore[valid]].astype(np.float64) * 9 / 5 + 32
    p2, p50, p98, p995 = np.percentile(tf, [2, 50, 98, 99.5])
    lmin = int(math.floor(p2))
    lf = (lmin, max(lmin + 10, int(math.ceil(p995))))
    log(f'  water temp deg F (core): p2 {p2:.1f}, p50 {p50:.1f}, p98 {p98:.1f}, p99.5 {p995:.1f}')
    del tf
    tstats = dict(p2=round(float(p2), 1), p50=round(float(p50), 1), p98=round(float(p98), 1),
                  p995=round(float(p995), 1))

    # Write images.
    odir = os.path.join(OUT, lid)
    os.makedirs(odir, exist_ok=True)
    sizes = {}
    sizes['mask.png'] = write_png(os.path.join(odir, 'mask.png'),
                                  np.clip(np.rint(maskcov * 255), 0, 255).astype(np.uint8), 'L')
    base = np.zeros((H, W, 4), np.uint8)
    base[..., 0] = np.clip(np.rint(cov * 255), 0, 255).astype(np.uint8)
    base[..., 1] = to_full(gT.astype(np.float64), valid, band, near).astype(np.uint8)
    base[..., 2] = np.where(fieldmask, enc_signed(to_full(mU / meanVelScale, valid, band, near)), 128)
    base[..., 3] = np.where(fieldmask, enc_signed(to_full(mV / meanVelScale, valid, band, near)), 128)
    sizes['base.png'] = write_png(os.path.join(odir, 'base.png'), base)
    for n in range(VEL_MODES // 2):
        img = np.full((H, W, 4), 128, np.uint8)
        for j, k in enumerate((2 * n, 2 * n + 1)):
            mk = modes[:, k] / scales[k]
            img[..., 2 * j] = np.where(fieldmask, enc_signed(to_full(mk[:N], valid, band, near)), 128)
            img[..., 2 * j + 1] = np.where(fieldmask, enc_signed(to_full(mk[N:], valid, band, near)), 128)
        sizes[f'vel{n}.png'] = write_png(os.path.join(odir, f'vel{n}.png'), img)
    img = np.full((H, W, 4), 128, np.uint8)
    for j in range(TEMP_MODES):
        img[..., j] = np.where(fieldmask, enc_signed(to_full(tmodes[:, j] / tscales[j], valid, band, near)), 128)
    sizes['temp.png'] = write_png(os.path.join(odir, 'temp.png'), img)
    meanSpd = to_full(np.sqrt((U.astype(np.float64) ** 2 + V.astype(np.float64) ** 2).mean(1)), valid, band, near)
    sizes['thumb.webp'] = write_thumb(os.path.join(odir, 'thumb.webp'), maskcov,
                                      to_full(Tmean.astype(np.float64), valid, band, near, fill=tlo),
                                      meanSpd, lf, speedRef, geo)
    for old in ('thumb.jpg',):
        if os.path.exists(os.path.join(odir, old)):
            os.remove(os.path.join(odir, old))

    def norm_xy(lon, lat):
        return ((lon - b['lon0']) / (b['lon1'] - b['lon0']), (b['lat1'] - lat) / (b['lat1'] - b['lat0']))

    labels = []
    for L in loc['labels']:
        x, y = norm_xy(L['lon'], L['lat'])
        labels.append(dict(L, x=round(x, 5), y=round(y, 5)))
        if not (0 <= x <= 1 and 0 <= y <= 1):
            log(f'  WARNING: label {L["name"]} is outside the extent (x={x:.3f}, y={y:.3f})')
    end_local = start_local + dt.timedelta(hours=hours - 1)
    if start_local.month == end_local.month:
        dates = f'{start_local.day}–{end_local.day} {MONTHS[start_local.month - 1]} {start_local.year}'
    else:
        dates = (f'{start_local.day} {MONTHS[start_local.month - 1]}–'
                 f'{end_local.day} {MONTHS[end_local.month - 1]} {end_local.year}')
    blurb = loc.get('blurb', '').replace('{peak}', f'{peak_ms * KNOTS:.1f}')
    meta = {
        'version': 2,
        'id': lid, 'title': loc['title'], 'titleLines': loc.get('titleLines', [loc['title']]),
        'subtitle': 'A Week of Currents', 'region': loc.get('region', ''), 'blurb': blurb,
        'model': loc['modelShort'], 'modelLong': loc['modelLong'],
        'tzLabel': loc['tzLabel'], 'utcOffsetHours': loc['utcOffsetHours'],
        'startLocal': window['startLocal'], 'hours': hours,
        'width': W, 'height': H, 'maskWidth': MW, 'maskHeight': MH,
        'bbox': b, 'core': geo['core'],
        'metersPerPixel': round(geo['px_m'], 3),
        'tempC': {'min': tlo, 'max': thi},
        'legendF': {'min': lf[0], 'max': lf[1]},
        'velModes': VEL_MODES, 'tempModes': TEMP_MODES,
        'meanVelScale': round(meanVelScale, 6),
        'velCoef': [[round(float(c), 6) for c in row] for row in velCoef],
        'tempCoef': [[round(float(c), 6) for c in row] for row in tempCoef],
        'speedRef': round(speedRef, 4),
        'peak': {'knots': round(peak_ms * KNOTS, 2), 'lon': round(plon, 5), 'lat': round(plat, 5),
                 'x': round(norm_xy(plon, plat)[0], 5), 'y': round(norm_xy(plon, plat)[1], 5),
                 'hour': int(pk[1])},
        'labels': labels, 'dates': dates,
        'variance': {'vel': round(float(vfrac), 5), 'temp': round(float(tfrac), 5)},
        'filledHours': [h for a, z in runs for h in range(a, z + 1)],
    }
    with open(os.path.join(odir, 'meta.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'), ensure_ascii=False)
    sizes['meta.json'] = os.path.getsize(os.path.join(odir, 'meta.json'))
    total = sum(sizes.values())
    log('  sizes: ' + ', '.join(f'{k} {v / 1024:.0f}K' for k, v in sizes.items()) + f' | total {total / 1e6:.2f} MB')
    log(f'  tempC {tlo}..{thi}, legendF {lf}, speedRef {speedRef:.3f} m/s (p99 {speedRef_p99:.3f}), '
        f'max speed incl. coast {edge_max * KNOTS:.2f} kn, peak {meta["peak"]["knots"]} kn '
        f'at ({plat:.4f}, {plon:.4f}) hour {pk[1]}')

    report = validate(odir, meta, U, V, TT, valid, cov)
    if qdir:
        quicklook(qdir, meta, U, V, valid, cov, maskcov, seeds)
    return dict(id=lid, sizes=sizes, total=total, vfrac=vfrac, tfrac=tfrac, tstats=tstats, meta=meta, **report)


# ---------------------------------------------------------------- validation

PROBES = {'sf-bay': (37.81, -122.48, 'Golden Gate'), 'puget-sound': (47.92, -122.62, 'Admiralty Inlet'),
          'san-juan-islands': (48.38, -122.98, 'Rosario Strait'),
          'cook-inlet': (60.98, -151.10, 'Forelands'), 'straits-of-mackinac': (45.815, -84.75, 'Mackinac Bridge'),
          'columbia-river-bar': (46.255, -124.03, 'Columbia bar'), 'fraser-river': (49.10, -123.25, 'Sand Heads'),
          'bay-of-fundy': (45.33, -64.43, 'Minas Passage'), 'mississippi-delta': (28.96, -89.40, 'Southwest Pass'),
          'chesapeake-mouth': (37.00, -76.05, 'Bay mouth'), 'delaware-bay': (38.84, -75.03, 'Bay mouth'),
          'tampa-bay': (27.60, -82.74, 'Egmont Channel'), 'western-lake-erie': (42.00, -83.15, 'Detroit River mouth')}


def decode_dataset(odir, meta):
    """Decode the PNGs with the contract formula. Return a function of hour index."""
    def rd(name):
        return np.asarray(Image.open(os.path.join(odir, name)).convert('RGBA'))
    base = rd('base.png')
    vel = [rd(f'vel{n}.png') for n in range(meta['velModes'] // 2)]
    tmp = rd('temp.png')
    s = dec_signed
    t = meta['tempC']
    meanU = s(base[..., 2]) * meta['meanVelScale']
    meanV = s(base[..., 3]) * meta['meanVelScale']
    meanT = t['min'] + base[..., 1] / 255.0 * (t['max'] - t['min'])
    mu = [s(vel[k // 2][..., 0 if k % 2 == 0 else 2]) for k in range(meta['velModes'])]
    mv = [s(vel[k // 2][..., 1 if k % 2 == 0 else 3]) for k in range(meta['velModes'])]
    mt = [s(tmp[..., j]) for j in range(meta['tempModes'])]

    def at(h):
        c = meta['velCoef'][h]
        u = meanU + sum(c[k] * mu[k] for k in range(len(c)))
        v = meanV + sum(c[k] * mv[k] for k in range(len(c)))
        ct = meta['tempCoef'][h]
        T = meanT + sum(ct[j] * mt[j] for j in range(len(ct)))
        return u, v, T
    return at, base[..., 0] / 255.0


def validate(odir, meta, U, V, TT, valid, cov):
    at, _ = decode_dataset(odir, meta)
    wet = cov[valid] > 0.5
    errs = []
    for h in [0, meta['hours'] // 2, meta['peak']['hour']]:
        u, v, T = at(h)
        du = u[valid][wet] - U[wet, h]
        dv = v[valid][wet] - V[wet, h]
        dT = T[valid][wet] - TT[wet, h]
        de = np.sqrt(du ** 2 + dv ** 2)
        sp_raw = np.sqrt(U[wet, h] ** 2 + V[wet, h] ** 2)
        sp_dec = np.sqrt(u[valid][wet] ** 2 + v[valid][wet] ** 2)
        e = dict(hour=h, vel_rms=float(np.sqrt((de ** 2).mean())), vel_max=float(de.max()),
                 temp_rms=float(np.sqrt((dT ** 2).mean())), temp_max=float(np.abs(dT).max()),
                 maxspd_raw=float(sp_raw.max()), maxspd_dec=float(sp_dec.max()),
                 rms_raw_speed=float(np.sqrt((sp_raw ** 2).mean())))
        errs.append(e)
        log(f'  decode h{h:3d}: vel rms {e["vel_rms"]:.4f} max {e["vel_max"]:.3f} m/s '
            f'(raw speed rms {e["rms_raw_speed"]:.3f}); max speed raw {e["maxspd_raw"]:.3f} '
            f'dec {e["maxspd_dec"]:.3f}; temp rms {e["temp_rms"]:.3f} max {e["temp_max"]:.3f} C')
    se, n = 0.0, 0
    for h in range(0, meta['hours'], 6):
        u, v, _ = at(h)
        se += float(((u[valid][wet] - U[wet, h]) ** 2 + (v[valid][wet] - V[wet, h]) ** 2).sum())
        n += int(wet.sum())
    week_rms = math.sqrt(se / n)
    log(f'  decode every 6 h: vel rms {week_rms:.4f} m/s')

    series = None
    pr = PROBES.get(meta['id']) or (tuple(meta['probe']) if meta.get('probe') else None)
    if pr:
        plat, plon, name = pr
        b = meta['bbox']
        W, H = meta['width'], meta['height']
        c = int((plon - b['lon0']) / (b['lon1'] - b['lon0']) * W)
        r = int((b['lat1'] - plat) / (b['lat1'] - b['lat0']) * H)
        pos = np.full(valid.shape, -1)
        pos[valid] = np.arange(int(valid.sum()))
        if not (0 <= r < H and 0 <= c < W) or pos[r, c] < 0:
            log(f'  probe {name} is not on a water pixel')
        else:
            i = pos[r, c]
            nh = min(30, meta['hours'])
            series = [(h, float(U[i, h]), float(V[i, h]), float(at(h)[0][r, c]), float(at(h)[1][r, c]))
                      for h in range(nh)]
            log(f'  probe {name} ({plat},{plon}) raw u: ' + ' '.join(f'{s[1]:+.2f}' for s in series))
            log(f'  probe {name} ({plat},{plon}) raw v: ' + ' '.join(f'{s[2]:+.2f}' for s in series))
            log('    decoded u: ' + ' '.join(f'{s[3]:+.2f}' for s in series))
    return dict(errs=errs, week_rms=week_rms, series=series)


def quicklook(qdir, meta, U, V, valid, cov, maskcov, seeds):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    os.makedirs(qdir, exist_ok=True)
    W, H = meta['width'], meta['height']
    h = meta['peak']['hour']
    sp = np.full((H, W), np.nan)
    uu = np.zeros((H, W))
    vv = np.zeros((H, W))
    sp[valid] = np.sqrt(U[:, h] ** 2 + V[:, h] ** 2)
    uu[valid], vv[valid] = U[:, h], V[:, h]
    sp[cov < 0.5] = np.nan
    scale = 900 / max(W, H)
    fig, ax = plt.subplots(figsize=(W * scale / 100 + 0.4, H * scale / 100 + 0.6), dpi=100)
    ax.set_facecolor('black')
    ax.imshow(sp, cmap='viridis', vmin=0, vmax=meta['speedRef'], extent=(0, W, H, 0), interpolation='nearest')
    ax.contour((np.arange(maskcov.shape[1]) + 0.5) / MASK_SCALE, (np.arange(maskcov.shape[0]) + 0.5) / MASK_SCALE,
               maskcov, levels=[0.5], colors='white', linewidths=0.4)
    if seeds is not None and seeds.any():
        sm = np.ma.masked_where(~seeds, np.ones(seeds.shape))
        ax.imshow(sm, cmap='autumn', alpha=0.35, extent=(0, W, H, 0), interpolation='nearest')
    st = max(W, H) // 55
    yy, xx = np.mgrid[st // 2:H:st, st // 2:W:st]
    m = valid[yy, xx] & (cov[yy, xx] > 0.5)
    ax.quiver(xx[m] + 0.5, yy[m] + 0.5, uu[yy, xx][m], vv[yy, xx][m], color='white', scale=meta['speedRef'] * 25,
              width=0.0015)
    c = meta['core']
    ax.plot([c['x0'] * W, c['x1'] * W, c['x1'] * W, c['x0'] * W, c['x0'] * W],
            [c['y0'] * H, c['y0'] * H, c['y1'] * H, c['y1'] * H, c['y0'] * H], '--', color='cyan', lw=0.8)
    for L in meta['labels']:
        ax.plot(L['x'] * W, L['y'] * H, 'o', color='red', ms=4)
        ax.text(L['x'] * W + 5, L['y'] * H, L['name'], color='red', fontsize=7, va='center')
    ax.plot(meta['peak']['x'] * W, meta['peak']['y'] * H, '*', color='orange', ms=11)
    ax.set_xlim(0, W)
    ax.set_ylim(H, 0)
    ax.set_title(f'{meta["id"]} h{h} speed (peak {meta["peak"]["knots"]} kn); dashed = core; orange = fade seeds',
                 fontsize=8)
    fig.tight_layout()
    p = os.path.join(qdir, f'{meta["id"]}.png')
    fig.savefig(p, dpi=100)
    plt.close(fig)
    log(f'  quicklook {p}')


def main():
    # numpy 2 with Apple Accelerate raises false floating-point flags in matmul.
    np.seterr(divide='ignore', over='ignore', invalid='ignore')
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--cache', required=True)
    ap.add_argument('--only', action='append')
    ap.add_argument('--quicklook', help='directory for quick-look PNGs')
    ap.add_argument('--ne', help='Natural Earth directory (default <cache>/naturalearth)')
    ap.add_argument('--out', help='output data directory (default: page data/)')
    ap.add_argument('--hours', type=int, help='test only: use fewer hours than the window')
    args = ap.parse_args()
    global OUT
    if args.out:
        OUT = args.out
    with open(os.path.join(HERE, 'locations.json')) as f:
        cfg = json.load(f)
    if args.hours:
        cfg['window']['hours'] = args.hours
    ne = load_ne(args.ne or os.path.join(args.cache, 'naturalearth'))
    results = []
    for loc in cfg['locations']:
        if args.only and loc['id'] not in args.only:
            continue
        r = build(loc, args.cache, cfg['window'], args.quicklook, ne)
        if r:
            results.append(r)
    index = []
    for loc in cfg['locations']:
        p = os.path.join(OUT, loc['id'], 'meta.json')
        if os.path.exists(p):
            with open(p) as f:
                m = json.load(f)
            if m.get('version') != 2:
                continue
            index.append({'id': loc['id'], 'title': loc['title'], 'region': loc.get('region', ''),
                          'aspect': round(m['width'] / m['height'], 4)})
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump(index, f, indent=1, ensure_ascii=False)
    log(f'index.json: {[e["id"] for e in index]}')
    return 0 if results else 1


if __name__ == '__main__':
    sys.exit(main())

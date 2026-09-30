#!/usr/bin/env python3
"""Build the tidal-currents datasets from cached NOAA OFS surface fields.

Usage:
  python3 tools/build_data.py --cache <cache dir> [--only <id>] [--quicklook <dir>]

Input: <cache>/<model>/YYYYMMDDHH.npz (UTC hour) and <cache>/<model>/grid.npz,
written by tools/fetch_ofs.py.
Output: data/<id>/{base.png, vel0..vel5.png, temp.png, meta.json} and data/index.json.
The encoding follows the page contract (see meta.json keys and decode notes below).

Steps for each location:
  1. Rasterize water coverage for the bbox (antialiased, supersampled).
  2. Interpolate each hour of u, v, temp to the water pixels.
  3. Compress with EOFs: velocity mean + 12 modes, temperature mean + 4 modes.
  4. Quantize to RGBA8 PNGs. Extend fields 6 px into land. Other land is 128.
  5. Decode the PNGs again and print the error against the raw fields.

Signed decode: s(c) = clamp((c - 128) / 127, -1, 1) for a byte c.
"""
import argparse, datetime as dt, json, math, os, sys, time

import numpy as np
from PIL import Image
from scipy import ndimage, sparse

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.dirname(HERE)
OUT = os.path.join(PAGE, 'data')   # set by --out
KIND = {'sfbofs': 'fvcom', 'sscofs': 'fvcom', 'lmhofs': 'fvcom', 'ciofs': 'roms'}
VEL_MODES, TEMP_MODES = 12, 4
BAND_PX = 6          # field extension into land, pixels
SUPERSAMPLE = 3      # coverage supersampling per axis
MIN_SPECK = 25.0     # water components with less coverage (pixels) are dropped
M_PER_DEG = 6371000.0 * math.pi / 180.0
KNOTS = 1.0 / 0.514444
MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
          'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- raster grid

def pixel_centers(loc, ss=1):
    """Return lon, lat arrays (H*ss, W*ss) of sub-pixel centers. Row 0 is north."""
    b = loc['bbox']
    W, H = loc['width'] * ss, loc['height'] * ss
    lon = b['lon0'] + (np.arange(W) + 0.5) / W * (b['lon1'] - b['lon0'])
    lat = b['lat1'] - (np.arange(H) + 0.5) / H * (b['lat1'] - b['lat0'])
    return np.meshgrid(lon, lat)


def block_mean(a, ss):
    H, W = a.shape[0] // ss, a.shape[1] // ss
    return a.reshape(H, ss, W, ss).mean(axis=(1, 3))


# ---------------------------------------------------------------- FVCOM mapper

class FvcomMapper:
    """Map FVCOM element (u, v) and node (temp) values to raster pixels.

    Element velocities go to nodes by a plain mean over the incident elements.
    Nodes go to pixels by barycentric weights in lon/lat space.
    """

    def __init__(self, grid, loc, paths=None):
        from matplotlib.tri import Triangulation
        b = loc['bbox']
        lon = np.where(grid['lon'] > 180, grid['lon'] - 360.0, grid['lon']).astype(np.float64)
        lat = grid['lat'].astype(np.float64)
        nv = grid['nv'].T.astype(np.int64) - 1
        padx, pady = 0.1 * (b['lon1'] - b['lon0']), 0.1 * (b['lat1'] - b['lat0'])
        cx, cy = lon[nv].mean(1), lat[nv].mean(1)
        esel = np.nonzero((cx > b['lon0'] - padx) & (cx < b['lon1'] + padx) &
                          (cy > b['lat0'] - pady) & (cy < b['lat1'] + pady))[0]
        nodes, inv = np.unique(nv[esel], return_inverse=True)
        tris = inv.reshape(-1, 3)
        self.esel, self.nodes = esel, nodes
        x, y = lon[nodes], lat[nodes]
        tri = Triangulation(x, y, tris)
        finder = tri.get_trifinder()
        self.domain = dict(lon=(float(lon.min()), float(lon.max())), lat=(float(lat.min()), float(lat.max())))

        # Coverage from supersampled hits.
        t0 = time.time()
        sx, sy = pixel_centers(loc, SUPERSAMPLE)
        hit = np.zeros(sx.shape, bool)
        step = 256
        for r in range(0, sx.shape[0], step):
            hit[r:r + step] = finder(sx[r:r + step], sy[r:r + step]) >= 0
        self.coverage = block_mean(hit.astype(np.float32), SUPERSAMPLE)
        del sx, sy, hit
        px, py = pixel_centers(loc, 1)
        tpix = finder(px, py)
        self.valid = tpix >= 0
        log(f'  fvcom: {len(esel)} elements, {len(nodes)} nodes, raster {time.time() - t0:.1f}s')

        # Barycentric weights at valid pixel centers.
        self.px, self.py = px, py
        self.tpix = tpix
        self._tris, self._x, self._y = tris, x, y
        # Element -> node mean.
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

def rasterize_tris(x, y, tris, loc):
    """Return the index of the triangle that holds each pixel center (-1: none).

    Later triangles in the list overwrite earlier ones where they overlap.
    """
    b = loc['bbox']
    W, H = loc['width'], loc['height']
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

    The mapper finds the fractional (eta, xi) index of each pixel with a linear
    interpolation over the curvilinear grid. Land cells get zero weight, so
    samples near the coast use water cells only.
    """

    def __init__(self, grid, loc, paths):
        b = loc['bbox']
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
        self.sl = (slice(e0, e1), slice(x0, x1))
        sl = self.sl
        slon, slat = lon[sl], lat[sl]
        EE, XX = np.meshgrid(np.arange(e1 - e0, dtype=np.float64), np.arange(x1 - x0, dtype=np.float64),
                             indexing='ij')
        t0 = time.time()
        # Split each grid cell with a water corner into two triangles. A
        # Delaunay mesh of all rho points is wrong here: the curvilinear grid
        # folds over land, so a pixel could get the index of a far cell.
        ne, nx = e1 - e0, x1 - x0
        mw = grid['mask_rho'][sl] > 0.5
        q = mw[:-1, :-1] | mw[1:, :-1] | mw[1:, 1:] | mw[:-1, 1:]
        qi, qj = np.nonzero(q)
        a = qi * nx + qj
        b_, c, d = a + nx, a + nx + 1, a + 1
        tris = np.concatenate([np.stack([a, b_, c], 1), np.stack([a, c, d], 1)])
        used, inv = np.unique(tris, return_inverse=True)
        tris = inv.reshape(-1, 3)
        x, y = slon.ravel()[used], slat.ravel()[used]
        # Orient every triangle counterclockwise.
        cr = (x[tris[:, 1]] - x[tris[:, 0]]) * (y[tris[:, 2]] - y[tris[:, 0]]) - \
             (x[tris[:, 2]] - x[tris[:, 0]]) * (y[tris[:, 1]] - y[tris[:, 0]])
        tris[cr < 0] = tris[cr < 0][:, [0, 2, 1]]
        # Cells with all corners in water go last, so they win where cells overlap.
        full = (mw[:-1, :-1] & mw[1:, :-1] & mw[1:, 1:] & mw[:-1, 1:])[qi, qj]
        wt = np.concatenate([full, full])
        order = np.argsort(wt, kind='stable')
        tris = tris[order]
        px, py = pixel_centers(loc, 1)
        t = rasterize_tris(x, y, tris, loc)
        inside = t >= 0
        tt = t[inside]
        A, B, C = tris[tt, 0], tris[tt, 1], tris[tt, 2]
        qx, qy = px[inside], py[inside]
        det = (y[B] - y[C]) * (x[A] - x[C]) + (x[C] - x[B]) * (y[A] - y[C])
        wa = ((y[B] - y[C]) * (qx - x[C]) + (x[C] - x[B]) * (qy - y[C])) / det
        wb = ((y[C] - y[A]) * (qx - x[C]) + (x[A] - x[C]) * (qy - y[C])) / det
        wc = 1.0 - wa - wb
        EE, XX = np.divmod(used, nx)
        self.ie = np.zeros(px.shape)
        self.ix = np.zeros(px.shape)
        self.ie[inside] = wa * EE[A] + wb * EE[B] + wc * EE[C]
        self.ix[inside] = wa * XX[A] + wb * XX[B] + wc * XX[C]
        log(f'  roms: subset {e1 - e0}x{x1 - x0}, index map {time.time() - t0:.1f}s')

        self.angle = grid['angle'][sl].astype(np.float64)
        self.x0, self.x1, self.e0, self.e1 = x0, x1, e0, e1

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
        self.wet_stats = (int(m.sum()), int((m & (wetfrac >= 0.5)).sum()))
        log(f'  roms: mask_rho water cells {self.wet_stats[0]}, wet >= 50% of hours {self.wet_stats[1]}')
        self.always = (m & (wetfrac >= 0.999)).astype(np.float64)
        m = (m & (wetfrac >= 0.5)).astype(np.float64)
        self.m = m

        # Coverage: bilinear mask on a supersampled index map, then smoothstep.
        ss = SUPERSAMPLE
        ie_s = ndimage.zoom(self.ie, ss, order=1, mode='nearest', grid_mode=True)
        ix_s = ndimage.zoom(self.ix, ss, order=1, mode='nearest', grid_mode=True)
        in_s = np.repeat(np.repeat(inside, ss, 0), ss, 1)
        mb = ndimage.map_coordinates(m, [ie_s, ix_s], order=1, mode='nearest')
        mb[~in_s] = 0
        # The model cells are up to 3 px wide and make a stair-step coast.
        # Blur the mask by 2 px, then cut it at 0.5 with a narrow smoothstep.
        mb = ndimage.gaussian_filter(mb, 2.0 * ss)
        mb = np.clip((mb - 0.4) / 0.2, 0, 1)
        mb = mb * mb * (3 - 2 * mb)
        self.coverage = block_mean(mb.astype(np.float32), ss)
        aw = ndimage.map_coordinates(self.always, [self.ie, self.ix], order=1, mode='nearest')
        self.peak_ok = inside & (aw > 0.999)
        m_c = ndimage.map_coordinates(m, [self.ie, self.ix], order=1, mode='nearest')
        self.mweight = m_c
        self.valid = inside & (m_c > 0.05)

    def finalize(self, valid):
        idx = np.flatnonzero(valid)
        self.coords = np.stack([self.ie.ravel()[idx], self.ix.ravel()[idx]])
        self.wsum = ndimage.map_coordinates(self.m, self.coords, order=1, mode='nearest')

    def _rho_vel(self, d):
        """Average u, v to rho points (NaN on land), then rotate to east/north."""
        sl = self.sl
        e0, e1, x0, x1 = self.e0, self.e1, self.x0, self.x1
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
        ur, vr = np.nan_to_num(ur[sl]), np.nan_to_num(vr[sl])
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

def clean_mask(coverage, valid):
    """Drop small water specks. Return cleaned coverage and valid mask."""
    water = coverage > 0
    lab, n = ndimage.label(water, structure=np.ones((3, 3)))
    if n:
        area = ndimage.sum(coverage, lab, index=np.arange(1, n + 1))
        keep_lab = np.zeros(n + 1, bool)
        keep_lab[1:] = area >= MIN_SPECK
        keep = keep_lab[lab]
        dropped = int((~keep_lab[1:]).sum())
    else:
        keep, dropped = water, 0
    cov = np.where(keep, coverage, 0).astype(np.float32)
    valid = valid & keep
    return cov, valid, dropped


FADE_PX = 40.0


def open_boundary_fade(cov, loc):
    """Fade the water out near an open model boundary.

    Each box in loc['openBoundaryFade'] marks open water outside the model
    domain. The non-water pixels inside the box are the seeds. Coverage is
    multiplied by smoothstep(0, FADE_PX, distance to the nearest seed), so
    the water fades out softly instead of a straight cut. Real coast outside
    the boxes is not changed.
    """
    boxes = loc.get('openBoundaryFade') or []
    if not boxes:
        return cov
    b = loc['bbox']
    lon, lat = pixel_centers(loc, 1)
    seeds = np.zeros(cov.shape, bool)
    for q in boxes:
        seeds |= ((lon >= q['lon0']) & (lon <= q['lon1']) & (lat >= q['lat0']) & (lat <= q['lat1']) & (cov <= 0))
    if not seeds.any():
        log('  openBoundaryFade: no seed pixels in the boxes')
        return cov
    d = ndimage.distance_transform_edt(~seeds)
    t = np.clip(d / FADE_PX, 0, 1)
    fade = t * t * (3 - 2 * t)
    out = (cov * fade).astype(np.float32)
    log(f'  openBoundaryFade: {len(boxes)} box(es), coverage lost {float((cov - out).sum()):.0f} px')
    return out


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
    """X: (N, T) anomalies. Return modes (N, k), amps (T, k), variance fractions."""
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


def write_png(path, arr):
    Image.fromarray(arr, 'RGBA').save(path, optimize=True)
    return os.path.getsize(path)


# ---------------------------------------------------------------- build

def load_hours(cache, model, start_utc, hours):
    """Return list of dicts (or None when missing) for each hour."""
    out = []
    for h in range(hours):
        t = start_utc + dt.timedelta(hours=h)
        p = os.path.join(cache, model, f'{t:%Y%m%d%H}.npz')
        out.append(p if os.path.exists(p) else None)
    return out


def fill_plan(paths):
    """Return (fills, error). Runs of < 3 missing hours get linear time fill."""
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


def build(loc, cache, window, qdir):
    lid, model = loc['id'], loc['model']
    W, H = loc['width'], loc['height']
    b = loc['bbox']
    log(f'== {lid} ({model}) {W}x{H}')
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
    mapper = (FvcomMapper if KIND[model] == 'fvcom' else RomsMapper)(grid, loc, paths)
    dom = mapper.domain
    log(f'  model domain lon {dom["lon"][0]:.3f}..{dom["lon"][1]:.3f} lat {dom["lat"][0]:.3f}..{dom["lat"][1]:.3f}')
    cov, valid, dropped = clean_mask(mapper.coverage, mapper.valid)
    band, near = extension(valid)
    cov[~(valid | band)] = 0
    cov = open_boundary_fade(cov, loc)
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
    mU, mV = meanX[:N], meanX[N:]
    Tmean = TT.mean(1)
    XT = TT - Tmean[:, None]
    tmodes, tamps, tfrac, _ = eof(XT, TEMP_MODES)
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
    G = qmodes.T @ qmodes
    velCoef = np.linalg.solve(G, qmodes.T @ Xq).T       # (hours, k)
    del Xq
    tscales = np.maximum(np.abs(tmodes).max(0), 1e-12)
    qt = dec_signed(enc_signed(tmodes / tscales))
    XTq = TT.astype(np.float64) - qTmean[:, None]
    tempCoef = np.linalg.solve(qt.T @ qt, qt.T @ XTq).T
    del XTq

    # Write images.
    odir = os.path.join(OUT, lid)
    os.makedirs(odir, exist_ok=True)
    fieldmask = valid | band
    sizes = {}
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

    # Statistics from the raw fields over water pixels.
    wet = cov[valid] > 0.5
    spd = np.sqrt(U[wet].astype(np.float64) ** 2 + V[wet].astype(np.float64) ** 2)
    speedRef = float(np.percentile(spd, 99))
    edge_max = float(spd.max())
    del spd
    # For ROMS the peak uses only cells that stay wet for every hour, 3 px or
    # more from the coast: wetting and drying fronts on the mud flats give
    # short spikes. FVCOM keeps all pixels, because narrow passes (for
    # example Deception Pass) are 1 px wide.
    inner = cov > 0.5
    if KIND[model] == 'roms':
        inner = ndimage.binary_erosion(inner, iterations=3) & mapper.peak_ok
    inner = inner[valid]
    spd = np.sqrt(U[inner].astype(np.float64) ** 2 + V[inner].astype(np.float64) ** 2)
    pk = np.unravel_index(np.argmax(spd), spd.shape)
    ipk = int(np.flatnonzero(inner)[pk[0]])        # position in the valid list
    vidx = int(np.flatnonzero(valid)[ipk])          # flat raster index
    peak_ms = float(np.hypot(U[ipk, pk[1]], V[ipk, pk[1]]))
    pr, pc = divmod(int(vidx), W)
    plon = b['lon0'] + (pc + 0.5) / W * (b['lon1'] - b['lon0'])
    plat = b['lat1'] - (pr + 0.5) / H * (b['lat1'] - b['lat0'])
    tf = TT[wet].astype(np.float64) * 9 / 5 + 32
    # Legend range: start at the 2nd percentile, span at least 10 deg F.
    p2, p50, p98 = np.percentile(tf, [2, 50, 98])
    lmin = int(math.floor(p2))
    lf = (lmin, lmin + max(10, int(math.ceil(p98 - p2))))
    log(f'  water temp deg F: p2 {p2:.1f}, p50 {p50:.1f}, p98 {p98:.1f}')
    del spd, tf
    tstats = dict(p2=round(float(p2), 1), p50=round(float(p50), 1), p98=round(float(p98), 1))

    def norm_xy(lon, lat):
        return ((lon - b['lon0']) / (b['lon1'] - b['lon0']), (b['lat1'] - lat) / (b['lat1'] - b['lat0']))

    labels = []
    for L in loc['labels']:
        x, y = norm_xy(L['lon'], L['lat'])
        labels.append(dict(L, x=round(x, 5), y=round(y, 5)))
        if not (0 <= x <= 1 and 0 <= y <= 1):
            log(f'  WARNING: label {L["name"]} is outside the bbox (x={x:.3f}, y={y:.3f})')
    end_local = start_local + dt.timedelta(hours=hours - 1)
    if start_local.month == end_local.month:
        dates = f'{start_local.day}–{end_local.day} {MONTHS[start_local.month - 1]} {start_local.year}'
    else:
        dates = (f'{start_local.day} {MONTHS[start_local.month - 1]}–'
                 f'{end_local.day} {MONTHS[end_local.month - 1]} {end_local.year}')
    meta = {
        'id': lid, 'title': loc['title'], 'subtitle': 'A Week of Currents',
        'model': loc['modelShort'], 'modelLong': loc['modelLong'],
        'tzLabel': loc['tzLabel'], 'utcOffsetHours': loc['utcOffsetHours'],
        'startLocal': window['startLocal'], 'hours': hours,
        'width': W, 'height': H, 'bbox': b,
        'metersPerPixel': round((b['lat1'] - b['lat0']) * M_PER_DEG / H, 3),
        'tempC': {'min': tlo, 'max': thi},
        'legendF': {'min': lf[0], 'max': lf[1]},
        'velModes': VEL_MODES, 'tempModes': TEMP_MODES,
        'meanVelScale': round(meanVelScale, 6),
        'velCoef': [[round(float(c), 6) for c in row] for row in velCoef],
        'tempCoef': [[round(float(c), 6) for c in row] for row in tempCoef],
        'speedRef': round(speedRef, 4),
        'peak': {'knots': round(peak_ms * KNOTS, 2),
                 'lon': round(plon, 5), 'lat': round(plat, 5),
                 'x': round(norm_xy(plon, plat)[0], 5), 'y': round(norm_xy(plon, plat)[1], 5),
                 'hour': int(pk[1])},
        'labels': labels, 'layout': loc['layout'], 'dates': dates,
        'variance': {'vel': round(float(vfrac), 5), 'temp': round(float(tfrac), 5)},
        'filledHours': [h for a, z in runs for h in range(a, z + 1)],
    }
    with open(os.path.join(odir, 'meta.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'), ensure_ascii=False)
    sizes['meta.json'] = os.path.getsize(os.path.join(odir, 'meta.json'))
    total = sum(sizes.values())
    log('  sizes: ' + ', '.join(f'{k} {v / 1024:.0f}K' for k, v in sizes.items()) + f' | total {total / 1e6:.2f} MB')
    log(f'  tempC {tlo}..{thi}, legendF {lf}, speedRef {speedRef:.3f} m/s, '
        f'max speed incl. coast {edge_max * KNOTS:.2f} kn, peak {meta["peak"]["knots"]} kn at ({plat:.4f}, {plon:.4f}) hour {pk[1]}')

    report = validate(odir, meta, U, V, TT, valid, cov, loc)
    if qdir:
        quicklook(qdir, meta, U, V, valid, cov, loc)
    return dict(id=lid, sizes=sizes, total=total, vfrac=vfrac, tfrac=tfrac, meta=meta, tstats=tstats, **report)


# ---------------------------------------------------------------- validation

def decode_dataset(odir, meta):
    """Decode the PNGs with the contract formula. Return functions of hour index."""
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


def validate(odir, meta, U, V, TT, valid, cov, loc):
    at, cov_dec = decode_dataset(odir, meta)
    wet = cov[valid] > 0.5
    hrs = [0, meta['hours'] // 2, meta['peak']['hour']]
    errs = []
    for h in hrs:
        u, v, T = at(h)
        du = u[valid][wet] - U[wet, h]
        dv = v[valid][wet] - V[wet, h]
        dT = T[valid][wet] - TT[wet, h]
        de = np.sqrt(du ** 2 + dv ** 2)
        sp_raw = np.sqrt(U[wet, h] ** 2 + V[wet, h] ** 2)
        sp_dec = np.sqrt(u[valid][wet] ** 2 + v[valid][wet] ** 2)
        errs.append(dict(hour=h, vel_rms=float(np.sqrt((de ** 2).mean())), vel_max=float(de.max()),
                         temp_rms=float(np.sqrt((dT ** 2).mean())), temp_max=float(np.abs(dT).max()),
                         maxspd_raw=float(sp_raw.max()), maxspd_dec=float(sp_dec.max()),
                         rms_raw_speed=float(np.sqrt((sp_raw ** 2).mean()))))
        e = errs[-1]
        log(f'  decode h{h:3d}: vel rms {e["vel_rms"]:.4f} max {e["vel_max"]:.3f} m/s '
            f'(raw speed rms {e["rms_raw_speed"]:.3f}); max speed raw {e["maxspd_raw"]:.3f} '
            f'dec {e["maxspd_dec"]:.3f}; temp rms {e["temp_rms"]:.3f} max {e["temp_max"]:.3f} C')
    # Whole-week velocity error of the reconstruction on water pixels.
    se, n = 0.0, 0
    for h in range(0, meta['hours'], 6):
        u, v, _ = at(h)
        se += float(((u[valid][wet] - U[wet, h]) ** 2 + (v[valid][wet] - V[wet, h]) ** 2).sum())
        n += int(wet.sum())
    week_rms = math.sqrt(se / n)
    log(f'  decode every 6 h: vel rms {week_rms:.4f} m/s')

    # Probe series.
    probes = {'sf-bay': (37.81, -122.48, 'Golden Gate'), 'puget-sound': (47.92, -122.62, 'Admiralty Inlet'),
              'san-juan-islands': (48.38, -122.98, 'Rosario Strait'),
              'cook-inlet': (60.98, -151.10, 'Forelands'), 'straits-of-mackinac': (45.815, -84.75, 'Mackinac Bridge')}
    series = None
    if meta['id'] in probes:
        plat, plon, name = probes[meta['id']]
        b = meta['bbox']
        W, H = meta['width'], meta['height']
        c = int((plon - b['lon0']) / (b['lon1'] - b['lon0']) * W)
        r = int((b['lat1'] - plat) / (b['lat1'] - b['lat0']) * H)
        pos = np.full(valid.shape, -1)
        pos[valid] = np.arange(int(valid.sum()))
        if pos[r, c] < 0:
            log(f'  probe {name} is not on a water pixel')
        else:
            i = pos[r, c]
            series = [(h, float(U[i, h]), float(V[i, h]), float(at(h)[0][r, c])) for h in range(min(30, meta["hours"]))]
            log(f'  probe {name} ({plat},{plon}) u east m/s, h0..29 raw: ' +
                ' '.join(f'{s[1]:+.2f}' for s in series))
            log('    decoded:                                    ' + ' '.join(f'{s[3]:+.2f}' for s in series))
    return dict(errs=errs, week_rms=week_rms, series=series)


def quicklook(qdir, meta, U, V, valid, cov, loc):
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
    fig, ax = plt.subplots(figsize=(W / 100, H / 100), dpi=100)
    ax.set_facecolor('black')
    ax.imshow(sp, cmap='viridis', vmin=0, vmax=meta['speedRef'], extent=(0, W, H, 0), interpolation='nearest')
    ax.contour(np.arange(W) + 0.5, np.arange(H) + 0.5, cov, levels=[0.5], colors='white', linewidths=0.5)
    st = max(W, H) // 60
    yy, xx = np.mgrid[st // 2:H:st, st // 2:W:st]
    m = valid[yy, xx] & (cov[yy, xx] > 0.5)
    ax.quiver(xx[m] + 0.5, yy[m] + 0.5, uu[yy, xx][m], vv[yy, xx][m], color='white', scale=meta['speedRef'] * 25,
              width=0.0015)
    for L in meta['labels']:
        ax.plot(L['x'] * W, L['y'] * H, 'o', color='red', ms=5)
        ax.text(L['x'] * W + 6, L['y'] * H, L['name'], color='red', fontsize=9, va='center')
    ax.plot(meta['peak']['x'] * W, meta['peak']['y'] * H, '*', color='orange', ms=12)
    ax.set_xlim(0, W)
    ax.set_ylim(H, 0)
    ax.set_title(f'{meta["id"]} hour {h} speed (max {meta["peak"]["knots"]} kn)', color='k')
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
    results = []
    for loc in cfg['locations']:
        if args.only and loc['id'] not in args.only:
            continue
        r = build(loc, args.cache, cfg['window'], args.quicklook)
        if r:
            results.append(r)
    # The index lists every location that has a dataset on disk, in config order.
    index = []
    for loc in cfg['locations']:
        if os.path.exists(os.path.join(OUT, loc['id'], 'meta.json')):
            index.append({'id': loc['id'], 'title': loc['title'],
                          'aspect': 'portrait' if loc['height'] > loc['width'] else 'landscape'})
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump(index, f, indent=1, ensure_ascii=False)
    log(f'index.json: {[e["id"] for e in index]}')
    return 0 if results else 1


if __name__ == '__main__':
    sys.exit(main())

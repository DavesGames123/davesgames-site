#!/usr/bin/env python3
"""Fetch surface u, v, temp for each hour from NOAA OFS nowcast files on S3.

Usage: python3 fetch_ofs.py <model> [threads] [--out CACHE_DIR]

The script reads only the surface layer. It uses HTTP range requests on the
netCDF4/HDF5 files (see httpfile.py), so it does not download full files.
Output: CACHE_DIR/<model>/YYYYMMDDHH.npz (UTC hour, keys u, v, temp, float32)
and CACHE_DIR/<model>/grid.npz.
"""
import argparse, concurrent.futures as cf, datetime as dt, os, sys

import h5py
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from httpfile import HttpFile  # noqa: E402

B = 'https://noaa-nos-ofs-pds.s3.amazonaws.com'
# Per model: cycle hour offset (cycles every 6 h), grid kind, file type, and
# surface variable access. "fields" files are 3D; "2ds" files hold surface
# fields only. The script checks the time in each file against the wanted hour.
MODELS = {
    'sfbofs': (3, 'fvcom', 'fields'), 'sscofs': (3, 'fvcom', 'fields'),
    'lmhofs': (0, 'fvcom', 'fields'), 'leofs': (0, 'fvcom', 'fields'),
    'ngofs2': (3, 'fvcom', '2ds'),
    'ciofs': (0, 'roms', 'fields'), 'cbofs': (0, 'roms', 'fields'),
    'dbofs': (0, 'roms', 'fields'), 'tbofs': (0, 'roms', 'fields'),
    'gomofs': (0, 'roms', '2ds'),
}
CYC = {m: v[0] for m, v in MODELS.items()}
KIND = {m: v[1] for m, v in MODELS.items()}


def surface(f, model):
    """Return surface u, v, temp from an open file."""
    kind, ftype = MODELS[model][1], MODELS[model][2]
    if ftype == '2ds':
        if kind == 'fvcom':
            return f['u_surface'][0], f['v_surface'][0], f['temp_surface'][0]
        return f['u_sur'][0], f['v_sur'][0], f['temp_sur'][0]
    if kind == 'fvcom':
        return f['u'][0, 0, :], f['v'][0, 0, :], f['temp'][0, 0, :]
    return f['u'][0, -1], f['v'][0, -1], f['temp'][0, -1]


ap = argparse.ArgumentParser()
ap.add_argument('model')
ap.add_argument('threads', nargs='?', type=int, default=8)
ap.add_argument('--out', default='cache')
ap.add_argument('--start', default='2026-09-21T04', help='first UTC hour')
ap.add_argument('--hours', type=int, default=175)
args = ap.parse_args()
model = args.model
out = os.path.join(args.out, model)
os.makedirs(out, exist_ok=True)
t0 = dt.datetime.strptime(args.start, '%Y-%m-%dT%H')
hours = [t0 + dt.timedelta(hours=i) for i in range(args.hours)]


def url_for(t):
    # Use the nowcast of the next cycle at or after t.
    off = CYC[model]
    c = t.replace(minute=0)
    while (c.hour - off) % 6:
        c += dt.timedelta(hours=1)
    k = 6 - int((c - t).total_seconds() // 3600)
    return f"{B}/{model}/netcdf/{c:%Y/%m/%d}/{model}.t{c:%H}z.{c:%Y%m%d}.{MODELS[model][2]}.n{k:03d}.nc"


def tval(f):
    k = 'time' if 'time' in f else 'ocean_time'
    u = f[k].attrs['units'].decode()
    base = dt.datetime.fromisoformat(u.split('since ')[1].strip()[:19])
    return base + dt.timedelta(seconds=float(f[k][0]))


def grab(t):
    p = f'{out}/{t:%Y%m%d%H}.npz'
    if os.path.exists(p):
        return t, 'cached'
    url = url_for(t)
    err = None
    for _ in range(3):
        try:
            f = h5py.File(HttpFile(url), 'r')
            assert tval(f) == t, (tval(f), t)
            u, v, T = surface(f, model)
            np.savez(p, u=u.astype(np.float32), v=v.astype(np.float32), temp=T.astype(np.float32))
            if not os.path.exists(f'{out}/grid.npz'):
                keys = (['lon', 'lat', 'lonc', 'latc', 'nv', 'h'] if KIND[model] == 'fvcom'
                        else ['lon_rho', 'lat_rho', 'mask_rho', 'mask_u', 'mask_v', 'angle', 'h'])
                np.savez(f'{out}/grid.npz', **{k: f[k][:] for k in keys})
            return t, 'ok'
        except Exception as e:  # retry on network errors
            err = e
    return t, f'FAIL {err!r} {url}'


with cf.ThreadPoolExecutor(args.threads) as ex:
    for t, s in ex.map(grab, hours):
        if s != 'cached':
            print(model, t, s, flush=True)
print(model, 'done', len(os.listdir(out)))

#!/usr/bin/env python3
"""Fetch surface u, v, temp for each hour from models that fetch_ofs.py cannot read.

Usage: python3 fetch_grid.py <model> [--out CACHE_DIR] [--start YYYY-MM-DDTHH] [--hours N]

Models:
  nyofs  NOAA New York Harbor OFS, coarse grid (POM, curvilinear). NetCDF3
         nowcast files on S3, six hours in each file (cycle hour - 5 .. cycle
         hour, cycles 05, 11, 17, 23). The files are small, so the script
         downloads them whole. NYOFS has no temperature. temp is the hourly
         water temperature of the NOAA CO-OPS gauge at The Battery (8518750),
         the same value over all the water.
  neatl  Irish Marine Institute Northeast Atlantic model. A regular
         0.0125 degree grid on ERDDAP (IMI_NEATL), hourly. ERDDAP keeps a
         rolling window of about 11 days, so fetch a past week soon.
         --bbox LON0,LAT0,LON1,LAT1 sets the subset.

Output: the cache layout that build_data.py reads for a ROMS model, with the
velocity already east/north at the rho points:
  CACHE_DIR/<model>/grid.npz          lon_rho, lat_rho, mask_rho, angle (zeros), h
  CACHE_DIR/<model>/YYYYMMDDHH.npz    u, v, temp (float32, rho shape, UTC hour)
build_data.py sees that u has the shape of temp and skips the staggered-grid step.

grep: def fetch_nyofs  def gauge_temp  def fetch_neatl  def read_nc3
"""
import argparse, datetime as dt, io, os, sys, urllib.request

import numpy as np
from scipy.io import netcdf_file

S3 = 'https://noaa-nos-ofs-pds.s3.amazonaws.com'
ERDDAP = 'https://erddap.marine.ie/erddap/griddap/IMI_NEATL.nc'
COOPS = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'
BATTERY = '8518750'


def get(url, tries=3):
    err = None
    for _ in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                return r.read()
        except Exception as e:  # retry on network errors
            err = e
    raise RuntimeError(f'{url}: {err!r}')


def read_nc3(blob):
    return netcdf_file(io.BytesIO(blob), 'r', mmap=False)


def fill(a, bad=1e3):
    a = np.asarray(a, dtype=np.float64).copy()
    a[~np.isfinite(a) | (np.abs(a) > bad)] = np.nan
    return a


def save_hour(out, t, u, v, temp):
    np.savez(os.path.join(out, f'{t:%Y%m%d%H}.npz'),
             u=np.nan_to_num(u).astype(np.float32), v=np.nan_to_num(v).astype(np.float32),
             temp=temp.astype(np.float32))


def gauge_temp(station, hours):
    """Hourly water temperature (deg C) of a CO-OPS station, by UTC hour. Short gaps get a linear fill."""
    t0, t1 = hours[0], hours[-1]
    import json
    d = json.loads(get(f'{COOPS}?product=water_temperature&station={station}&begin_date={t0:%Y%m%d}'
                       f'&end_date={t1 + dt.timedelta(days=1):%Y%m%d}&time_zone=gmt&units=metric&format=json'
                       f'&interval=h&application=davesgames'))
    got = {dt.datetime.strptime(r['t'], '%Y-%m-%d %H:%M'): float(r['v']) for r in d.get('data', []) if r['v']}
    x = np.array([(t - t0).total_seconds() for t in sorted(got)])
    y = np.array([got[t] for t in sorted(got)])
    return {t: float(np.interp((t - t0).total_seconds(), x, y)) for t in hours}


def fetch_nyofs(out, hours):
    want = {t for t in hours}
    temps = gauge_temp(BATTERY, hours)
    cycles = sorted({t + dt.timedelta(hours=(5 - t.hour) % 6) for t in hours})
    epoch = dt.datetime(2008, 1, 1)
    got = 0
    for c in cycles:
        url = f'{S3}/nyofs/netcdf/{c:%Y/%m/%d}/nyofs.t{c:%H}z.{c:%Y%m%d}.fields.nowcast.nc'
        f = read_nc3(get(url))
        V = f.variables
        if not os.path.exists(os.path.join(out, 'grid.npz')):
            lon, lat = V['lon'][:].astype(np.float64), V['lat'][:].astype(np.float64)
            np.savez(os.path.join(out, 'grid.npz'), lon_rho=lon, lat_rho=lat,
                     mask_rho=(V['mask'][:] > 0).astype(np.float64), angle=np.zeros(lon.shape),
                     h=V['depth'][:].astype(np.float64))
        for k, days in enumerate(V['time'][:]):
            t = epoch + dt.timedelta(seconds=round(float(days) * 86400 / 60) * 60)
            if t not in want:
                continue
            u, v = fill(V['u'][k, 0]), fill(V['v'][k, 0])    # sigma 0 is the surface
            save_hour(out, t, u, v, np.full(u.shape, temps[t]))
            got += 1
        print('nyofs', c, 'ok', flush=True)
    return got


def fetch_neatl(out, hours, bbox):
    lon0, lat0, lon1, lat1 = bbox
    t0, t1 = hours[0], hours[-1]
    q = f'[({t0:%Y-%m-%dT%H}:00:00Z):1:({t1:%Y-%m-%dT%H}:00:00Z)][({lat0}):1:({lat1})][({lon0}):1:({lon1})]'
    data = {}
    for name, key in (('u', 'sea_surface_x_velocity'), ('v', 'sea_surface_y_velocity'),
                      ('temp', 'sea_surface_temperature')):
        f = read_nc3(get(f'{ERDDAP}?{key}{q}'))
        data[name] = fill(f.variables[key][:])
        times = [dt.datetime(1970, 1, 1) + dt.timedelta(seconds=round(float(s))) for s in f.variables['time'][:]]
        lat, lon = f.variables['latitude'][:].astype(np.float64), f.variables['longitude'][:].astype(np.float64)
        print('neatl', key, data[name].shape, flush=True)
    LON, LAT = np.meshgrid(lon, lat)
    wet = np.isfinite(data['u']).all(0) & np.isfinite(data['temp']).all(0)
    np.savez(os.path.join(out, 'grid.npz'), lon_rho=LON, lat_rho=LAT, mask_rho=wet.astype(np.float64),
             angle=np.zeros(LON.shape), h=np.zeros(LON.shape))
    for k, t in enumerate(times):
        save_hour(out, t, data['u'][k], data['v'][k], np.nan_to_num(data['temp'][k]))
    return len(times)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('model', choices=['nyofs', 'neatl'])
    ap.add_argument('--out', default='cache')
    ap.add_argument('--start', default='2026-09-21T04', help='first UTC hour')
    ap.add_argument('--hours', type=int, default=175)
    ap.add_argument('--bbox', default='-6.45,52.95,-5.4,53.75', help='neatl: lon0,lat0,lon1,lat1')
    args = ap.parse_args()
    out = os.path.join(args.out, args.model)
    os.makedirs(out, exist_ok=True)
    t0 = dt.datetime.strptime(args.start, '%Y-%m-%dT%H')
    hours = [t0 + dt.timedelta(hours=i) for i in range(args.hours)]
    if args.model == 'nyofs':
        n = fetch_nyofs(out, hours)
    else:
        n = fetch_neatl(out, hours, [float(x) for x in args.bbox.split(',')])
    print(args.model, 'done', n, 'of', len(hours), 'hours')
    return 0 if n == len(hours) else 1


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""Fetch hourly surface currents around each city from the HYCOM ESPC-D-V02 analysis.

Usage:
  python3 tools/fetch_ocean.py --cache <dir> [--only <id> ...] [--jobs 3]

Source: Navy ESPC-D-V02 global 1/12 degree HYCOM analysis, "ice" collection
(hourly ssu, ssv: surface eastward and northward water velocity, m/s), from
the HYCOM.org THREDDS NetCDF Subset Service. HYCOM.org lists the data as
"freely available" (U.S. Navy / FNMOC, distributed by HYCOM.org). The
analysis includes tidal forcing, so the hourly fields show the tide.

Window: WINDOW_START (UTC) and HOURS hours, the same instants that
build_city.py takes from the tidal-currents NOAA / Marine Institute data.

Output: <cache>/ocean/<id>.nc (NetCDF4, raw NCSS response). Each request
takes about 4 min on the server side.

grep: WINDOW_START  HOURS  def fetch
"""
import argparse, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import geo  # noqa: E402

WINDOW_START = '2026-09-24T00:00:00Z'
WINDOW_END = '2026-09-26T00:00:00Z'      # inclusive: 49 hourly fields
HOURS = 49
NCSS = 'https://ncss.hycom.org/thredds/ncss/grid/ESPC-D-V02/ice/2026'
MARGIN_DEG = 0.12


def fetch(cache, c):
    out = os.path.join(cache, 'ocean', c['id'] + '.nc')
    if os.path.exists(out):
        return c['id'], 'cached'
    w, s, e, n = geo.bbox_lonlat(c, geo.OUTER['half'])
    q = (f'var=ssu&var=ssv&north={n + MARGIN_DEG:.3f}&south={s - MARGIN_DEG:.3f}'
         f'&west={w - MARGIN_DEG:.3f}&east={e + MARGIN_DEG:.3f}&horizStride=1'
         f'&time_start={WINDOW_START}&time_end={WINDOW_END}&timeStride=1&accept=netcdf4')
    t = time.time()
    for k in range(3):
        try:
            req = urllib.request.Request(f'{NCSS}?{q}', headers={'User-Agent': 'davesgames-city-atlas-build/1.0'})
            with urllib.request.urlopen(req, timeout=900) as r:
                data = r.read()
            break
        except Exception as ex:  # noqa: BLE001
            if k == 2:
                return c['id'], f'FAILED {ex}'
            time.sleep(20)
    open(out + '.part', 'wb').write(data)
    os.replace(out + '.part', out)
    return c['id'], f'{len(data)} bytes in {time.time() - t:.0f} s'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True)
    ap.add_argument('--only', nargs='*')
    ap.add_argument('--jobs', type=int, default=3)
    a = ap.parse_args()
    cities = [c for c in json.load(open(os.path.join(HERE, 'cities.json'))) if not a.only or c['id'] in a.only]
    os.makedirs(os.path.join(a.cache, 'ocean'), exist_ok=True)
    with ThreadPoolExecutor(a.jobs) as ex:
        for cid, msg in ex.map(lambda c: fetch(a.cache, c), cities):
            print(f'{cid:16s} {msg}', flush=True)


if __name__ == '__main__':
    main()

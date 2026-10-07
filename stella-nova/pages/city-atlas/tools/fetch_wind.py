#!/usr/bin/env python3
"""Fetch a year of hourly 10 m wind for each city and reduce it to a wind rose.

Usage:
  python3 tools/fetch_wind.py --cache <dir> [--only <id> ...]

Source: the Open-Meteo historical weather API (archive-api.open-meteo.com),
which serves ECMWF ERA5 / ERA5-Land reanalysis. Data licence: CC BY 4.0,
"Weather data by Open-Meteo.com". One request per city, 2025-01-01 to
2025-12-31, wind_speed_10m (m/s) and wind_direction_10m (degrees, FROM).

Output: <cache>/wind/<id>.json with
  rose     16 sectors (N, NNE, ...): share of hours the wind came FROM it
  prevail  {dir, speed}: the sector with the most hours, and its mean speed
  mean     mean speed over the year (m/s)
  p90      90th percentile speed (m/s)

grep: def rose  def main
"""
import argparse, json, os, time, urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
API = ('https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}'
       '&start_date=2025-01-01&end_date=2025-12-31&hourly=wind_speed_10m,wind_direction_10m'
       '&wind_speed_unit=ms&timezone=GMT')


def rose(speed, dirn):
    ok = np.isfinite(speed) & np.isfinite(dirn)
    s, d = speed[ok], dirn[ok]
    sec = np.round(d / 22.5).astype(int) % 16
    share = np.bincount(sec, minlength=16) / len(sec)
    k = int(np.argmax(share))
    return {
        'rose': [round(float(v), 4) for v in share],
        'prevail': {'dir': k * 22.5, 'speed': round(float(s[sec == k].mean()), 2)},
        'mean': round(float(s.mean()), 2),
        'p90': round(float(np.percentile(s, 90)), 2),
        'hours': int(len(s)),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True)
    ap.add_argument('--only', nargs='*')
    a = ap.parse_args()
    od = os.path.join(a.cache, 'wind')
    os.makedirs(od, exist_ok=True)
    for c in json.load(open(os.path.join(HERE, 'cities.json'))):
        if a.only and c['id'] not in a.only:
            continue
        out = os.path.join(od, c['id'] + '.json')
        if not os.path.exists(out):
            req = urllib.request.Request(API.format(lat=c['lat'], lon=c['lon']), headers={'User-Agent': 'davesgames-city-atlas-build/1.0'})
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = json.load(r)
            h = raw['hourly']
            sp = np.array([np.nan if v is None else v for v in h['wind_speed_10m']], float)
            dr = np.array([np.nan if v is None else v for v in h['wind_direction_10m']], float)
            json.dump(rose(sp, dr), open(out, 'w'))
            time.sleep(1.5)
        r = json.load(open(out))
        print(f"{c['id']:16s} prevail from {r['prevail']['dir']:5.1f} deg at {r['prevail']['speed']:4.1f} m/s, "
              f"mean {r['mean']:4.1f}, p90 {r['p90']:4.1f}, {r['hours']} h", flush=True)


if __name__ == '__main__':
    main()

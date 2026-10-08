#!/usr/bin/env python3
# ============================================================================
#  MAP PROJECTIONS  ·  tools/proj-ref.py — reference values from PROJ
# ----------------------------------------------------------------------------
#  Writes tests/proj-ref.json: for each case, the PROJ string, the parameters
#  that proj.js takes, and [lon, lat, x, y] rows computed by PROJ through
#  pyproj. tests.mjs compares proj.js with these rows. The JSON is committed,
#  so the tests do not need PROJ. Rerun this only to add cases:
#    python3 -m venv /tmp/v && /tmp/v/bin/pip install pyproj
#    /tmp/v/bin/python tools/proj-ref.py
# ============================================================================
import json, os
import pyproj
from pyproj import Transformer

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tests', 'proj-ref.json')
PTS = [(0, 0), (30, 45), (-100, -30), (150, 70), (10, -10), (75, 20), (-45, 60), (-170, -75), (120, -50), (179, 5)]
NEAR = [(-30, 40), (0, 50), (-60, 20), (10, 10), (-80, 70), (20, 65), (-30, -10), (-100, 35)]
CONIC = [(-96, 23), (-80, 40), (-120, 50), (-70, 25), (-100, 60), (-60, 10), (0, 45), (60, 30)]

SPH = '+proj=longlat +R=1 +no_defs'
WGS = '+proj=longlat +ellps=WGS84 +no_defs'
cases = [
    # key, proj string, params for proj.js, points, source datum
    ('mercator', '+proj=merc +R=1', {}, PTS[:7] + [(120, -50)], SPH),
    ('web-mercator', '+proj=webmerc +ellps=WGS84', {'a': 6378137}, PTS[:7], WGS),
    ('transverse-mercator', '+proj=tmerc +R=1 +lon_0=0', {}, [(0, 0), (30, 45), (10, -10), (-45, 60), (75, 20), (-60, -70), (5, 80)], SPH),
    ('equirectangular', '+proj=eqc +R=1', {}, PTS, SPH),
    ('lambert-cylindrical', '+proj=cea +R=1', {}, PTS, SPH),
    ('gall-peters', '+proj=cea +lat_ts=45 +R=1', {}, PTS, SPH),
    ('mollweide', '+proj=moll +R=1', {}, PTS, SPH),
    ('hammer', '+proj=hammer +R=1', {}, PTS, SPH),
    ('aitoff', '+proj=aitoff +R=1', {}, PTS, SPH),
    # PROJ 9.8 wintri with no +lat_1 uses lat_1 = 0 (checked: it equals
    # +lat_1=0), not Winkel's acos(2/pi); so the parallel is given here.
    ('winkel-tripel', '+proj=wintri +R=1 +lat_1=50.45977625218981', {}, PTS, SPH),
    ('robinson', '+proj=robin +R=1', {}, PTS + [(45, 42.5), (-90, 67.5), (20, 88), (100, -12.3), (180, 45), (-180, -70), (60, 5)], SPH),
    ('equal-earth', '+proj=eqearth +R=1', {}, PTS, SPH),
    ('natural-earth', '+proj=natearth +R=1', {}, PTS, SPH),
    ('eckert-iv', '+proj=eck4 +R=1', {}, PTS, SPH),
    ('sinusoidal', '+proj=sinu +R=1', {}, PTS, SPH),
    ('goode', '+proj=igh +R=1', {}, PTS + [(-120, 50), (-130, -60), (-60, -20), (100, -45), (35, 41)], SPH),
    ('orthographic', '+proj=ortho +R=1 +lat_0=40 +lon_0=-30', {'lon': -30, 'lat': 40}, NEAR, SPH),
    ('stereographic', '+proj=stere +R=1 +lat_0=40 +lon_0=-30', {'lon': -30, 'lat': 40}, NEAR, SPH),
    ('gnomonic', '+proj=gnom +R=1 +lat_0=40 +lon_0=-30', {'lon': -30, 'lat': 40}, NEAR[:6], SPH),
    ('azimuthal-equidistant', '+proj=aeqd +R=1 +lat_0=40 +lon_0=-30', {'lon': -30, 'lat': 40}, NEAR + [(150, -40)], SPH),
    ('lambert-azimuthal', '+proj=laea +R=1 +lat_0=40 +lon_0=-30', {'lon': -30, 'lat': 40}, NEAR + [(150, -40)], SPH),
    ('albers', '+proj=aea +R=1 +lat_1=29.5 +lat_2=45.5 +lat_0=37.5 +lon_0=-96', {'lon': -96, 'lat0': 37.5, 'lat1': 29.5, 'lat2': 45.5}, CONIC, SPH),
    ('lambert-conformal', '+proj=lcc +R=1 +lat_1=33 +lat_2=45 +lat_0=39 +lon_0=-96', {'lon': -96, 'lat0': 39, 'lat1': 33, 'lat2': 45}, CONIC, SPH),
    ('equidistant-conic', '+proj=eqdc +R=1 +lat_1=20 +lat_2=60 +lat_0=40 +lon_0=10', {'lon': 10, 'lat0': 40, 'lat1': 20, 'lat2': 60}, CONIC, SPH),
    ('bonne', '+proj=bonne +R=1 +lat_1=45 +lon_0=0', {'lon': 0, 'lat1': 45}, PTS[:7], SPH),
    ('polyconic', '+proj=poly +R=1 +lat_0=0 +lon_0=-96', {'lon': -96, 'lat0': 0}, CONIC, SPH),
]
ELL = [
    ('ell-mercator', '+proj=merc +ellps=WGS84', {}, PTS[:7], WGS),
    ('ell-utm33', '+proj=utm +zone=33 +ellps=WGS84', {'zone': 33}, [(15, 0), (12, 45), (17.5, 60), (9.1, -33.9), (20.9, 70.2), (14.2, 84)], WGS),
    ('ell-tm-wide', '+proj=tmerc +ellps=WGS84 +lon_0=0 +k=1', {}, [(3, 10), (25, 40), (-30, 60), (40, 75)], WGS),
    ('ell-lcc', '+proj=lcc +ellps=WGS84 +lat_1=33 +lat_2=45 +lat_0=39 +lon_0=-96', {'lon': -96, 'lat0': 39, 'lat1': 33, 'lat2': 45}, CONIC, WGS),
]
out = {'proj': pyproj.proj_version_str, 'pyproj': pyproj.__version__, 'cases': []}
for key, s, par, pts, src in cases + ELL:
    tr = Transformer.from_crs(src, s, always_xy=True)
    rows = []
    for lon, lat in pts:
        x, y = tr.transform(lon, lat)
        if abs(x) < 1e30 and abs(y) < 1e30:
            rows.append([lon, lat, x, y])
    out['cases'].append({'key': key, 'proj': s, 'par': par, 'rows': rows})
# Geodesic reference (WGS84 inverse, metres and degrees) for the measure tool.
g = pyproj.Geod(ellps='WGS84')
GP = [((-74.006, 40.7128), (139.6917, 35.6895)), ((-0.1276, 51.5072), (151.2093, -33.8688)), ((0, 0), (90, 0)), ((-58.38, -34.6), (18.42, -33.92))]
out['geod'] = []
for (a, b) in GP:
    az1, az2, d = g.inv(a[0], a[1], b[0], b[1])
    out['geod'].append([a[0], a[1], b[0], b[1], d, az1])
with open(OUT, 'w') as fh:
    json.dump(out, fh, indent=0)
print('cases', len(out['cases']), 'rows', sum(len(c['rows']) for c in out['cases']))

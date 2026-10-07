#!/usr/bin/env python3
# ============================================================================
#  ANCIENT EARTH  ·  build/build_data.py  ·  makes the shipped data files
# ----------------------------------------------------------------------------
#  This script runs offline, once. The page never runs it. It reads the open
#  source data, and writes compact files into ../data and ../tests.
#
#  Inputs (download them first, see "SOURCES" below), under --src:
#    sw/Rotations/Rotations/Scotese_Wright_PlateModel.rot
#    sw/StaticPolygons/StaticPolygons/Scotese_Wright_ContinentalPolygons.gpml
#    sw/Topologies/Topologies/Scotese_Wright_PlateBoundaries.gpml
#    dem/Scotese_Wright_2018_Maps_1-88_1degX1deg_PaleoDEMS_nc_v2/*.nc
#    ne/ne_50m_coastline.geojson, ne/ne_50m_admin_0_boundary_lines_land.geojson,
#    ne/ne_110m_admin_0_countries.geojson, ne/ne_10m_populated_places_simple.geojson
#    ms_14.json ms_13.json ms_3.json ms_2.json (Macrostrat ICS intervals)
#
#  SOURCES
#    PALEOMAP plate model + PaleoDEMs, Scotese & Wright 2018, CC BY 4.0,
#      https://doi.org/10.5281/zenodo.5460860 (1 deg netCDF zip) and
#      https://repo.gplates.org/webdav/pmm/scotese_and_wright2018/ (rotations,
#      polygons; the GPlates plate-model-manager mirror of the same model)
#    Natural Earth 50m/110m/10m vectors, public domain,
#      https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
#    Paleobiology Database occurrences, CC BY 4.0, https://paleobiodb.org
#      (fetched by this script through data1.2/occs/list.json)
#    Macrostrat interval definitions (ICS chart), CC BY 4.0,
#      https://macrostrat.org/api/v2/defs/intervals?timescale_id=N
#
#  Outputs
#    data/rotations.json  the rotation sequences (moving, fixed, poles)
#    data/polygons.json   simplified present-day continental polygons
#    data/plateidx.bin    1440x720 uint8: polygon index per 0.25 deg cell
#    data/dem.bin         109 frames of 360x181 uint8 paleo-elevation
#    data/meta.json       frame times, encodings, sizes
#    data/overlays.json   modern coastlines and borders, split per polygon
#    data/cities.json     Natural Earth places with their polygon index
#    data/fossils.json    a PBDB sample with present and PALEOMAP coords
#    data/boundaries.json resolved plate boundaries, 0..100 Ma every 5 Myr
#    tests/expected.json  pygplates reconstructions for tests.mjs
#    tests/ics.json       the Macrostrat ICS intervals for tests.mjs
#
#  Run:  python3 -I build_data.py --src <download dir> [--no-pbdb]
#  Needs: pygplates 1.0, numpy, netCDF4, shapely.
#
#  grep -n targets
#    rotation file parse ... "def build_rotations"
#    polygon raster ........ "def build_raster"
#    elevation encoding .... "def enc_elev"
#    overlays split ........ "def split_lines"
#    PBDB sample ........... "def build_fossils"
#    plate boundaries ...... "def build_boundaries"
#    test fixtures ......... "def build_expected"
# ============================================================================
import argparse, glob, json, math, os, re, sys, time, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.dirname(HERE)
DATA = os.path.join(PAGE, 'data')
TESTS = os.path.join(PAGE, 'tests')

ap = argparse.ArgumentParser()
ap.add_argument('--src', required=True)
ap.add_argument('--no-pbdb', action='store_true')
args = ap.parse_args()
SRC = args.src
ROT = os.path.join(SRC, 'sw/Rotations/Rotations/Scotese_Wright_PlateModel.rot')
POLY = os.path.join(SRC, 'sw/StaticPolygons/StaticPolygons/Scotese_Wright_ContinentalPolygons.gpml')

import pygplates
from shapely.geometry import LineString, Polygon, Point, shape
from shapely.prepared import prep


def dump(path, obj):
    with open(path, 'w') as f:
        json.dump(obj, f, separators=(',', ':'))
    print('wrote', os.path.relpath(path, PAGE), os.path.getsize(path), 'bytes')


# ---------------------------------------------------------------------------
# Rotations. A sequence is a run of lines with the same moving and fixed
# plate, in file order. Moving plate 999 lines are comments in PALEOMAP.
# ---------------------------------------------------------------------------
NOISE = re.compile(r'(\d+\s*M[AY]\s*Future|FUTURE|Future|CRS\s*[\d/]+|\d\d/\d\d/\d\d+|\(PC\)|Scotese.*|\bfixed to.*)', re.I)


def clean_name(c):
    c = NOISE.sub('', c).strip(' !-=?')
    c = re.sub(r'\s+', ' ', c)
    return c


def build_rotations():
    seqs, names = [], {}
    cur = None
    for line in open(ROT, encoding='latin-1'):
        parts = line.split('!', 1)
        f = parts[0].split()
        if len(f) < 6:
            continue
        mov, t, lat, lon, ang, fix = int(f[0]), float(f[1]), float(f[2]), float(f[3]), float(f[4]), int(f[5])
        if mov == 999:
            # A commented-out pole: pygplates skips the line and the
            # sequence goes on.
            continue
        com = parts[1].strip('! \n') if len(parts) > 1 else ''
        if mov not in names and com:
            names[mov] = clean_name(com)
        if cur is None or cur[0] != mov or cur[1] != fix:
            cur = [mov, fix, []]
            seqs.append(cur)
        cur[2].extend([t, lat, lon, ang])
    # Crossovers: at an age where two sequences of one moving plate meet,
    # pygplates picks one edge by a rule of its graph builder that this
    # port does not copy. Record its pick: [moving, age, sequence index].
    rot = pygplates.RotationModel(ROT)
    by = {}
    for i, (m, f, fl) in enumerate(seqs):
        by.setdefault(m, []).append((i, f, fl[0::4]))
    xover = []
    for m, lst in by.items():
        ages = sorted({t for _, _, ts in lst for t in (ts[0], ts[-1]) if 0 <= t <= 1100})
        for t in ages:
            hold = [(i, f) for i, f, ts in lst if len(ts) > 1 and ts[0] <= t <= ts[-1]]
            if len({f for _, f in hold}) < 2:
                continue
            e = rot.get_reconstruction_tree(t).get_edge(m)
            if e is None:
                continue
            pick = [i for i, f in hold if f == e.get_fixed_plate_id()]
            if pick:
                xover.append([m, t, pick[0]])
    dump(os.path.join(DATA, 'rotations.json'), {'anchor': 0, 'seq': seqs, 'xover': xover})
    return names


# ---------------------------------------------------------------------------
# Polygons: present-day continental polygons, simplified to about 0.08 deg.
# Each keeps its plate ID and its time of appearance (begin) and end.
# ---------------------------------------------------------------------------
def unwrap(lons):
    out = [lons[0]]
    for x in lons[1:]:
        d = x - out[-1]
        d -= 360 * round(d / 360)
        out.append(out[-1] + d)
    return out


def build_polygons(names):
    fc = pygplates.FeatureCollection(POLY)
    polys = []
    feats = []
    for f in fc:
        b, e = f.get_valid_time()
        b = 1e9 if b == float('inf') or b > 1e8 else float(b)
        e = float(e) if e != float('-inf') else -1e9
        for g in f.get_geometries():
            ll = g.to_lat_lon_list()
            lats = [p[0] for p in ll]; lons = unwrap([p[1] for p in ll])
            sp = Polygon(list(zip(lons, lats)))
            if not sp.is_valid:
                sp = sp.buffer(0)
            simp = sp.simplify(0.08, preserve_topology=True)
            rings = []
            geoms = [simp] if simp.geom_type == 'Polygon' else list(getattr(simp, 'geoms', []))
            for gg in geoms:
                if gg.geom_type != 'Polygon' or gg.is_empty:
                    continue
                cs = list(gg.exterior.coords)
                flat = []
                for x, y in cs[:-1]:
                    flat += [round(x * 100), round(y * 100)]
                rings.append(flat)
            if not rings:
                continue
            rp = sp.representative_point()
            polys.append({'p': f.get_reconstruction_plate_id(), 'b': b, 'e': e, 'r': rings,
                          'c': [round(((rp.x + 180) % 360 - 180) * 100), round(rp.y * 100)],
                          'a': round(abs(pygplates.PolygonOnSphere(ll).get_area()) * 6371.0 ** 2)})
            feats.append(f)
    return polys, feats


# ---------------------------------------------------------------------------
# Polygon index raster. Each 0.25 deg cell centre goes through the pygplates
# PlatePartitioner at 0 Ma. The value is the polygon index in polygons.json,
# or 255 where no continental polygon covers the cell (old sea floor).
# ---------------------------------------------------------------------------
RW, RH = 1440, 720


def build_raster(polys, feats):
    # Index features by object identity to the polygon list.
    rot = pygplates.RotationModel(ROT)
    idmap = {}
    for i, f in enumerate(feats):
        idmap.setdefault(f.get_feature_id().get_string(), []).append(i)
    uniq = list({f.get_feature_id().get_string(): f for f in feats}.values())
    part = pygplates.PlatePartitioner(uniq, rot)
    out = np.full((RH, RW), 255, np.uint8)
    t0 = time.time()
    for j in range(RH):
        lat = -90 + (j + 0.5) * 0.25
        for i in range(RW):
            lon = -180 + (i + 0.5) * 0.25
            r = part.partition_point((lat, lon))
            if r is None:
                continue
            fid = r.get_feature().get_feature_id().get_string()
            cand = idmap.get(fid, [])
            out[j, i] = cand[0] if cand else 255
        if j % 120 == 0:
            print('raster row', j, round(time.time() - t0, 1), 's')
    out.tofile(os.path.join(DATA, 'plateidx.bin'))
    print('wrote data/plateidx.bin', out.size)
    return out


def lookup(raster, lat, lon):
    j = min(RH - 1, max(0, int((lat + 90) / 0.25)))
    i = int(((lon + 180) % 360) / 0.25) % RW
    return int(raster[j, i])


# ---------------------------------------------------------------------------
# Paleo-elevation. 109 PaleoDEMs (0..540 Ma), 1 deg, lon -180..179, lat
# -90..90. Encoding: sea floor 0..127, land 128..255, both on a square-root
# scale, so the shelves and lowlands keep the finest steps.
# ---------------------------------------------------------------------------
ZMIN, ZMAX = -9000.0, 6000.0


def enc_elev(z):
    z = np.clip(z, ZMIN, ZMAX)
    sea = 127 - np.round(127 * np.sqrt(np.clip(-z, 0, None) / -ZMIN))
    land = 128 + np.round(127 * np.sqrt(np.clip(z, 0, None) / ZMAX))
    return np.where(z < 0, sea, land).astype(np.uint8)


def build_dem():
    import netCDF4
    files = glob.glob(os.path.join(SRC, 'dem/*_v2/*.nc'))
    def age(f):
        return float(re.search(r'_([\d.]+)Ma\.nc$', f).group(1))
    files.sort(key=age)
    frames, times = [], []
    for f in files:
        d = netCDF4.Dataset(f)
        z = np.array(d.variables['z'][:], dtype=np.float32)[:, :360]
        frames.append(enc_elev(z))
        times.append(age(f))
    arr = np.stack(frames)
    arr.tofile(os.path.join(DATA, 'dem.bin'))
    print('wrote data/dem.bin', arr.size, 'frames', len(times))
    return {'w': 360, 'h': 181, 'lon0': -180, 'lat0': -90, 'step': 1, 'times': times,
            'enc': 'sqrt', 'zmin': ZMIN, 'zmax': ZMAX}


# ---------------------------------------------------------------------------
# Overlays. Natural Earth lines, cut into runs that lie in one polygon.
# Each run: [polygonIndex, lon0*100, lat0*100, lon1*100, ...]. A vertex on
# old sea floor (255) ends the run: that crust has no history in the model.
# ---------------------------------------------------------------------------
def split_lines(geo, raster, tol):
    runs = []
    for ft in geo['features']:
        g = ft['geometry']
        lines = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        for ln in lines:
            if len(ln) < 2:
                continue
            ls = LineString(ln).simplify(tol)
            pts = list(ls.coords)
            cur, idx, prev = None, -1, None
            for lon, lat in pts:
                k = lookup(raster, lat, lon)
                if k != idx:
                    if cur and len(cur) >= 5:
                        runs.append(cur)
                    cur = [k] if k != 255 else None
                    idx = k
                    # repeat the vertex, so the runs meet
                    if cur is not None and prev is not None:
                        cur += [round(prev[0] * 100), round(prev[1] * 100)]
                if cur is not None:
                    cur += [round(lon * 100), round(lat * 100)]
                prev = (lon, lat)
            if cur and len(cur) >= 5:
                runs.append(cur)
    return runs


def build_overlays(raster):
    coast = json.load(open(os.path.join(SRC, 'ne/ne_50m_coastline.geojson')))
    bord = json.load(open(os.path.join(SRC, 'ne/ne_50m_admin_0_boundary_lines_land.geojson')))
    cty = json.load(open(os.path.join(SRC, 'ne/ne_110m_admin_0_countries.geojson')))
    labels = []
    for ft in cty['features']:
        p = ft['properties']
        lon, lat = p.get('LABEL_X'), p.get('LABEL_Y')
        if lon is None:
            continue
        labels.append([p.get('NAME') or p.get('ADMIN'), round(lon * 100), round(lat * 100), lookup(raster, lat, lon), int(p.get('LABELRANK') or 5)])
    out = {'coast': split_lines(coast, raster, 0.04), 'borders': split_lines(bord, raster, 0.04), 'countries': labels}
    dump(os.path.join(DATA, 'overlays.json'), out)
    return cty


def build_cities(raster):
    pp = json.load(open(os.path.join(SRC, 'ne/ne_10m_populated_places_simple.geojson')))
    rows = []
    for ft in pp['features']:
        p = ft['properties']
        lon, lat = ft['geometry']['coordinates']
        pop = p.get('pop_max') or 0
        rows.append([p.get('name'), p.get('adm0name') or '', round(lat, 3), round(lon, 3), int(pop), int(p.get('scalerank') or 10), lookup(raster, lat, lon)])
    rows.sort(key=lambda r: -r[4])
    dump(os.path.join(DATA, 'cities.json'), {'cols': ['name', 'country', 'lat', 'lon', 'pop', 'rank', 'poly'], 'rows': rows})
    return rows


# ---------------------------------------------------------------------------
# Modern continent of each polygon, for the "continent of origin" colours:
# the Natural Earth CONTINENT of the country under the polygon's inner point,
# else a guess from the PALEOMAP plate ID block (1xx N America, and so on).
# ---------------------------------------------------------------------------
BLOCK = {1: 'North America', 2: 'South America', 3: 'Europe', 4: 'Asia', 5: 'Asia', 6: 'Asia', 7: 'Africa', 8: 'Oceania', 9: 'Oceania'}


def continents(polys, cty):
    shp = [(prep(shape(f['geometry'])), f['properties'].get('CONTINENT')) for f in cty['features']]
    for p in polys:
        lon, lat = p['c'][0] / 100, p['c'][1] / 100
        pt = Point(lon, lat)
        k = None
        for g, c in shp:
            if g.contains(pt):
                k = c
                break
        if k in (None, 'Seven seas (open ocean)'):
            k = BLOCK.get(p['p'] // 100, 'Ocean')
            if 802 <= p['p'] <= 805 or p['p'] in (850, 851, 852):
                k = 'Antarctica'
        p['k'] = k


# ---------------------------------------------------------------------------
# PBDB sample. Genus-level occurrences of a few famous groups, one per genus
# and 2 deg cell, with the present place, the age range, the PALEOMAP plate
# and the PBDB PALEOMAP paleo-coordinates (a cross check for tests.mjs).
# ---------------------------------------------------------------------------
GROUPS = [('Dinosauria^Aves', 'dinosaur', 2600), ('Aves', 'bird', 250), ('Pterosauria', 'pterosaur', 250), ('Ichthyosauria,Plesiosauria,Mosasauridae', 'marine reptile', 450),
          ('Trilobita', 'trilobite', 900), ('Synapsida^Mammalia', 'early synapsid', 300), ('Mammalia', 'mammal', 900), ('Ammonoidea', 'ammonite', 600),
          ('Tetrapoda^Amniota', 'early tetrapod', 250), ('Placodermi', 'armoured fish', 200), ('Hominidae', 'hominid', 120)]


def build_fossils(raster):
    out = []
    for base, grp, cap in GROUPS:
        url = ('https://paleobiodb.org/data1.2/occs/list.json?base_name=' + urllib.parse.quote(base) +
               '&taxon_reso=genus&show=coords,paleoloc,class&pgm=scotese&limit=60000')
        print('PBDB', base)
        with urllib.request.urlopen(url, timeout=300) as r:
            recs = json.load(r)['records']
        seen, rows = set(), []
        for o in recs:
            try:
                lat, lng = float(o['lat']), float(o['lng'])
            except (KeyError, ValueError):
                continue
            gen = (o.get('tna') or '').split(' ')[0]
            if not gen or gen[0].islower():
                continue
            key = (gen, round(lat / 2), round(lng / 2))
            if key in seen:
                continue
            seen.add(key)
            rows.append([gen, grp, round(o.get('eag', 0), 2), round(o.get('lag', 0), 2), round(lat, 2), round(lng, 2),
                         lookup(raster, lat, lng), int(o['gpl']) if str(o.get('gpl', '')).isdigit() else 0,
                         o.get('pla') if isinstance(o.get('pla'), (int, float)) else None, o.get('pln') if isinstance(o.get('pln'), (int, float)) else None, o.get('cid', ''), o.get('oei', '')])
        # An even sample through time: sort by age and take every k-th.
        rows.sort(key=lambda r: (r[2] + r[3]))
        if len(rows) > cap:
            k = len(rows) / cap
            rows = [rows[int(i * k)] for i in range(cap)]
        out += rows
        time.sleep(1)
    dump(os.path.join(DATA, 'fossils.json'), {'cols': ['genus', 'group', 'max_ma', 'min_ma', 'lat', 'lng', 'poly', 'pbdb_plate', 'pbdb_plat', 'pbdb_plng', 'cid', 'interval'],
                                              'source': 'Paleobiology Database, data1.2 occs/list, pgm=scotese, fetched ' + time.strftime('%Y-%m-%d'), 'rows': out})


# ---------------------------------------------------------------------------
# Test fixtures: pygplates reconstructs a set of present-day points (on the
# polygons that hold them) at several ages. tests.mjs must match them.
# ---------------------------------------------------------------------------
TEST_POINTS = [('London', 51.507, -0.128), ('New York', 40.713, -74.006), ('Sydney', -33.868, 151.209), ('Delhi', 28.614, 77.209),
               ('Nairobi', -1.286, 36.817), ('Sao Paulo', -23.55, -46.633), ('Beijing', 39.904, 116.407), ('Moscow', 55.756, 37.617),
               ('Los Angeles', 34.052, -118.244), ('Cape Town', -33.925, 18.424), ('Tokyo', 35.676, 139.65), ('Reykjavik', 64.147, -21.94),
               ('Anchorage', 61.218, -149.9), ('Madrid', 40.417, -3.704), ('Antarctic plateau', -80.0, 30.0), ('Perth', -31.95, 115.86),
               ('Mexico City', 19.43, -99.13), ('Lima', -12.046, -77.043), ('Tehran', 35.69, 51.39), ('Singapore', 1.352, 103.82)]
AGES = [0, 10, 33, 66, 100, 150, 200, 250, 300, 350, 400, 450, 500, 540]


def build_expected(raster, polys, feats):
    rot = pygplates.RotationModel(ROT)
    uniq = list({f.get_feature_id().get_string(): f for f in feats}.values())
    part = pygplates.PlatePartitioner(uniq, rot)
    res = []
    for name, lat, lon in TEST_POINTS:
        r = part.partition_point((lat, lon))
        pid = r.get_feature().get_reconstruction_plate_id() if r else 0
        row = {'name': name, 'lat': lat, 'lon': lon, 'plate': pid, 'poly': lookup(raster, lat, lon), 'at': []}
        for t in AGES:
            R = rot.get_rotation(float(t), pid, 0.0)
            p = R * pygplates.PointOnSphere(lat, lon)
            la, lo = p.to_lat_lon()
            row['at'].append([t, round(la, 5), round(lo, 5)])
        res.append(row)
    # Every plate at many ages as a quaternion check (catches crossovers).
    plates = sorted({p['p'] for p in polys})
    quats = []
    for pid in plates:
        for t in range(0, 545, 5):
            q = rot.get_rotation(float(t), pid, 0.0).get_lat_lon_euler_pole_and_angle_degrees()
            quats.append([pid, t, round(q[0], 6), round(q[1], 6), round(q[2], 6)])
    dump(os.path.join(TESTS, 'expected.json'), {'points': res, 'poles': quats, 'pygplates': pygplates.__version__ if hasattr(pygplates, '__version__') else '?'})


# ---------------------------------------------------------------------------
# Plate boundaries. The model's topologies resolve only from 0 to 100 Ma.
# Each 5 Myr frame: a list of [type, lon0*100, lat0*100, ...] lines, in
# paleo-coordinates. Types: 0 subduction, 1 ridge, 2 transform, 3 rift,
# 4 other.
# ---------------------------------------------------------------------------
BTYPE = {'SubductionZone': 0, 'MidOceanRidge': 1, 'Transform': 2, 'FractureZone': 2, 'ContinentalRift': 3}


def build_boundaries():
    rot = pygplates.RotationModel(ROT)
    fs = [pygplates.FeatureCollection(f) for f in glob.glob(os.path.join(SRC, 'sw/Topologies/**/*.gpml*'), recursive=True)]
    times, frames = [], []
    for t in range(0, 105, 5):
        sec = []
        pygplates.resolve_topologies(fs, rot, [], float(t), sec)
        lines = []
        for sct in sec:
            ty = BTYPE.get(sct.get_feature().get_feature_type().get_name(), 4)
            for ss in sct.get_shared_sub_segments():
                flat = [ty]
                for la, lo in ss.get_resolved_geometry().to_lat_lon_list():
                    flat += [round(lo * 100), round(la * 100)]
                if len(flat) >= 5:
                    lines.append(flat)
        if not lines:
            break
        times.append(t); frames.append(lines)
    dump(os.path.join(DATA, 'boundaries.json'), {'times': times, 'types': ['subduction', 'ridge', 'transform', 'rift', 'other'], 'frames': frames})


def build_ics():
    out = {}
    for tid, key in ((14, 'eons'), (13, 'eras'), (3, 'periods'), (2, 'epochs')):
        d = json.load(open(os.path.join(SRC, 'ms_%d.json' % tid)))['success']['data']
        out[key] = [[x['name'], x['t_age'], x['b_age'], x['color']] for x in d if x['t_age'] < 545]
    out['source'] = 'Macrostrat API v2 defs/intervals (ICS chart), CC BY 4.0, fetched ' + time.strftime('%Y-%m-%d')
    dump(os.path.join(TESTS, 'ics.json'), out)


if __name__ == '__main__':
    import urllib.parse
    os.makedirs(DATA, exist_ok=True); os.makedirs(TESTS, exist_ok=True)
    names = build_rotations()
    polys, feats = build_polygons(names)
    assert len(polys) < 255, len(polys)
    raster = build_raster(polys, feats)
    meta = {'dem': build_dem(), 'raster': {'w': RW, 'h': RH, 'step': 0.25, 'none': 255}}
    cty = build_overlays(raster)
    continents(polys, cty)
    used = {p['p'] for p in polys}
    dump(os.path.join(DATA, 'polygons.json'), {'poly': polys, 'names': {str(k): v for k, v in names.items() if k in used}})
    build_cities(raster)
    if not args.no_pbdb:
        build_fossils(raster)
    build_boundaries()
    build_expected(raster, polys, feats)
    build_ics()
    meta['built'] = time.strftime('%Y-%m-%d')
    dump(os.path.join(DATA, 'meta.json'), meta)

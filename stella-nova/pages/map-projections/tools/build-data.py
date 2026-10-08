#!/usr/bin/env python3
# ============================================================================
#  MAP PROJECTIONS  ·  tools/build-data.py — write data/world.json
# ----------------------------------------------------------------------------
#  Reads Natural Earth GeoJSON (public domain) and writes one compact file:
#    land      ne_50m_land, Douglas-Peucker 0.04 deg  (main map fill + coast)
#    land110   ne_110m_land  (the same while a drag or an animation runs)
#    countries ne_110m_admin_0_countries               (thumbnails, true size,
#              picking, the globe lines)
#  Coordinates are integers in 1/100 degree, one flat [lon, lat, ...] list
#  per ring. Rings are oriented so that each outer ring is counter-clockwise
#  in the lon/lat plane (interior on the left) and each hole is clockwise.
#  The pole edge of Antarctica (the vertices at -90 and the spike along
#  +-180) is removed, so the ring is a true closed ring on the sphere that
#  goes once around the south pole. geo.js closes such a ring along the pole
#  of each map frame.
#
#    python3 tools/build-data.py <dir with the .geojson files>
#  Source files: https://github.com/nvkelso/natural-earth-vector (geojson/).
# ============================================================================
import json, os, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'world.json')


def dp(pts, tol):
    # Douglas-Peucker on an open list of (lon, lat); keeps both ends.
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = (dx * dx + dy * dy) ** 0.5
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / L if L > 0 else ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def area(r):
    s = 0.0
    for i in range(len(r)):
        x0, y0 = r[i]; x1, y1 = r[(i + 1) % len(r)]
        s += x0 * y1 - x1 * y0
    return s / 2


def clean(ring, tol):
    r = [tuple(p) for p in ring]
    if r[0] == r[-1]:
        r = r[:-1]
    # Antarctica: drop the pole row and the spike along the antimeridian.
    if min(p[1] for p in r) < -89.9:
        r = [p for p in r if p[1] > -89.9]
        # the spike along +-180: keep only the top point on each side
        for side in (180.0, -180.0):
            seam = [p for p in r if abs(p[0] - side) < 1e-6]
            if seam:
                top = max(q[1] for q in seam)
                r = [p for p in r if abs(p[0] - side) >= 1e-6 or p[1] == top]
        # rotate so the ring starts just east of -180 and drop duplicated seam points
        i0 = min(range(len(r)), key=lambda i: r[i][0])
        r = r[i0:] + r[:i0]
    if tol:
        # split into two halves so DP keeps a closed shape
        h = len(r) // 2
        r = dp(r[:h + 1], tol)[:-1] + dp(r[h:] + [r[0]], tol)[:-1]
    return r


def enc(r):
    out = []
    for x, y in r:
        out += [round(x * 100), round(y * 100)]
    return out


def polys_of(g):
    return g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]


def ring_list(g, tol, min_pts=3):
    out = []
    for poly in polys_of(g):
        for k, ring in enumerate(poly):
            r = clean(ring, tol)
            if len(r) < min_pts:
                continue
            a = area(r)
            if min(p[1] for p in r) < -60 and max(p[0] for p in r) - min(p[0] for p in r) > 359:
                pass  # the Antarctic ring: orientation fixed below by its walk
            elif (k == 0 and a < 0) or (k > 0 and a > 0):
                r = r[::-1]
            out.append(enc(r))
    return out


def fix_antarctic(rings):
    # A ring around the south pole must walk west (interior, the pole, on
    # the left). Its planar area after the spike removal does not say this,
    # so test the net longitude walk.
    for i, r in enumerate(rings):
        lon = r[0::2]
        if min(r[1::2]) > -6000 or max(lon) - min(lon) < 35900:
            continue
        walk = 0
        for j in range(len(lon)):
            d = lon[(j + 1) % len(lon)] - lon[j]
            if d > 18000: d -= 36000
            if d < -18000: d += 36000
            walk += d
        if walk > 0:
            pts = list(zip(r[0::2], r[1::2]))[::-1]
            rings[i] = [v for p in pts for v in p]
    return rings


land = json.load(open(os.path.join(SRC, 'ne_50m_land.geojson')))
LAND = []
for f in land['features']:
    LAND += ring_list(f['geometry'], 0.04, 4)
LAND = fix_antarctic(LAND)

l110 = json.load(open(os.path.join(SRC, 'ne_110m_land.geojson')))
LAND110 = []
for f in l110['features']:
    LAND110 += ring_list(f['geometry'], 0, 4)
LAND110 = fix_antarctic(LAND110)

cty = json.load(open(os.path.join(SRC, 'ne_110m_admin_0_countries.geojson')))
C = []
for f in cty['features']:
    p = f['properties']
    rings = fix_antarctic(ring_list(f['geometry'], 0))
    C.append({'n': p['NAME'], 'a3': p['ADM0_A3'], 'c': p['CONTINENT'], 'lx': round(p['LABEL_X'], 2), 'ly': round(p['LABEL_Y'], 2), 'r': rings})
C.sort(key=lambda c: c['n'])

doc = {'src': 'Natural Earth (public domain): ne_50m_land (Douglas-Peucker 0.04 deg), ne_110m_land, ne_110m_admin_0_countries. Built by tools/build-data.py.',
       'land': LAND, 'land110': LAND110, 'countries': C}
with open(OUT, 'w') as fh:
    json.dump(doc, fh, separators=(',', ':'))
print('land rings', len(LAND), 'pts', sum(len(r) // 2 for r in LAND))
print('land110 rings', len(LAND110), 'pts', sum(len(r) // 2 for r in LAND110))
print('countries', len(C), 'pts', sum(len(r) // 2 for c in C for r in c['r']))
print('bytes', os.path.getsize(OUT))

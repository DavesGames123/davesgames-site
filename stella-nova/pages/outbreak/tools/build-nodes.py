#!/usr/bin/env python3
# ============================================================================
#  OUTBREAK  ·  tools/build-nodes.py — write data/nodes.json
# ----------------------------------------------------------------------------
#  Reads two Natural Earth 1:50m GeoJSON files (public domain) and writes
#  the population nodes of the metapopulation model:
#    ne_50m_populated_places_simple.geojson   city names, positions, pop_max
#    ne_50m_admin_0_countries.geojson         POP_EST, REGION_WB, INCOME_GRP
#  Source: https://github.com/nvkelso/natural-earth-vector (geojson/).
#
#  Rules:
#    - A country with POP_EST >= MIN_POP gets k = clamp(round(sqrt(pop /
#      PER_NODE)), 1, MAX_K) nodes: its k largest cities by pop_max.
#    - The country population is split over its nodes in proportion to
#      pop_max ** SHARE_EXP. So the nodes add up to the world population,
#      and a node stands for a catchment, not only the city.
#    - hub = 1 for a capital, a Natural Earth "worldcity" or "megacity".
#    - region = index into REGIONS (World Bank region, from Natural Earth).
#    - income = 1 (high income, OECD) .. 5 (low income), from INCOME_GRP.
#  A country with no matching city is listed on stderr and left out.
#
#    python3 -I tools/build-nodes.py <dir with the two .geojson files>
# ============================================================================
import json, math, os, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'nodes.json')
MIN_POP, PER_NODE, MAX_K, SHARE_EXP = 150_000, 4_000_000, 10, 0.8
REGIONS = ['East Asia & Pacific', 'Europe & Central Asia', 'Latin America & Caribbean',
           'Middle East & North Africa', 'North America', 'South Asia', 'Sub-Saharan Africa']

cs = json.load(open(os.path.join(SRC, 'ne_50m_admin_0_countries.geojson')))['features']
ps = json.load(open(os.path.join(SRC, 'ne_50m_populated_places_simple.geojson')))['features']

by_c = {}
for f in ps:
    p = f['properties']
    by_c.setdefault(p['adm0_a3'], []).append(p)

nodes, missing = [], []
for f in sorted(cs, key=lambda f: f['properties']['ADM0_A3']):
    c = f['properties']
    pop, a3 = c['POP_EST'] or 0, c['ADM0_A3']
    if pop < MIN_POP or c['REGION_WB'] not in REGIONS:
        continue
    cities = sorted(by_c.get(a3, []), key=lambda p: -(p['pop_max'] or 0))
    if not cities:
        missing.append(c['NAME']); continue
    k = max(1, min(MAX_K, round(math.sqrt(pop / PER_NODE))))
    pick = cities[:k]
    w = [max(1, p['pop_max'] or 1) ** SHARE_EXP for p in pick]
    sw = sum(w)
    inc = int(str(c['INCOME_GRP'])[0]) if c['INCOME_GRP'] else 3
    for p, wi in zip(pick, w):
        hub = 1 if (p['adm0cap'] or p['worldcity'] or p['megacity']) else 0
        nodes.append([p['nameascii'] or p['name'], a3, c['NAME'], REGIONS.index(c['REGION_WB']), inc,
                      round(p['latitude'], 2), round(p['longitude'], 2),
                      int(round(pop * wi / sw)), int(p['pop_max'] or 0), hub])

if missing:
    print('no city for:', ', '.join(missing), file=sys.stderr)
out = {
    'src': 'Natural Earth 1:50m (public domain): ne_50m_populated_places_simple, ne_50m_admin_0_countries. Built by tools/build-nodes.py.',
    'regions': REGIONS,
    'cols': ['name', 'iso3', 'country', 'region', 'income', 'lat', 'lon', 'pop', 'cityPop', 'hub'],
    'nodes': nodes,
}
with open(OUT, 'w') as fh:
    json.dump(out, fh, separators=(',', ':'), ensure_ascii=True)
print(f'{len(nodes)} nodes, {sum(n[7] for n in nodes):,} people -> {OUT}')

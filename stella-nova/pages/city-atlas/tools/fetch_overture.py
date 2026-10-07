#!/usr/bin/env python3
"""Fetch Overture Maps buildings, base water and place names for the cities.

Usage:
  python3 tools/fetch_overture.py --cache <dir> [--release 2026-09-23.1] [--theme buildings|water|places|all]

Overture publishes GeoParquet on S3 (anonymous read, us-west-2). With one
city box, DuckDB reads only the row groups whose bbox statistics hit it:
about 4 to 7 min per city for buildings. With many boxes in one query the
OR filter stops that pruning, and the buildings query ran for more than
45 min without an end. So fetch buildings one city at a time:
  for id in new-york london ...; do
    python3 tools/fetch_overture.py --cache <dir> --theme buildings --only $id
  done
(4 in parallel is fine). That writes buildings_<id>.parquet, which
build_city.py reads. Water and places are small enough for one query.

Output, one file per theme in <cache>/overture/:
  buildings.parquet  id, city, height, num_floors, min_height, class, subtype, wkb
                     (buildings_<id>.parquet with --only <id>)
  water.parquet      id, city, class, subtype, name, wkb   (inner terrain box)
  places.parquet     id, city, subtype, name, name_en, population, wkb   (divisions:
                     neighbourhoods and boroughs, inner terrain box)

Licences: the buildings and base themes are ODbL 1.0 (OpenStreetMap and
other sources). Keep "(c) OpenStreetMap contributors, Overture Maps
Foundation" with any data that this script makes.

grep: def boxes  def main
"""
import argparse, json, math, os, time

import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
M_PER_DEG = 6371000.0 * math.pi / 180.0
INNER_HALF_M = 6000.0     # half side of the inner terrain box (build_city.py INNER_HALF_M)


def box(c, half_m):
    kx = M_PER_DEG * math.cos(math.radians(c['lat']))
    return (c['lon'] - half_m / kx, c['lat'] - half_m / M_PER_DEG, c['lon'] + half_m / kx, c['lat'] + half_m / M_PER_DEG)


def boxes(cities, half_of):
    return [(c['id'], box(c, half_of(c))) for c in cities]


def query(con, src, cols, bxs, out):
    case = ' '.join(f"WHEN bbox.xmax > {b[0]} AND bbox.xmin < {b[2]} AND bbox.ymax > {b[1]} AND bbox.ymin < {b[3]} THEN '{cid}'"
                    for cid, b in bxs)
    where = ' OR '.join(f"(bbox.xmax > {b[0]} AND bbox.xmin < {b[2]} AND bbox.ymax > {b[1]} AND bbox.ymin < {b[3]})"
                        for _, b in bxs)
    sql = f"""COPY (SELECT CASE {case} END AS city, {cols}, geometry AS wkb
               FROM read_parquet('{src}', hive_partitioning=1) WHERE {where})
              TO '{out}' (FORMAT parquet)"""
    t = time.time()
    con.execute(sql)
    n = con.execute(f"SELECT city, count(*) FROM read_parquet('{out}') GROUP BY city ORDER BY city").fetchall()
    print(f'{out}: {sum(k for _, k in n)} rows in {time.time() - t:.0f} s', flush=True)
    for cid, k in n:
        print(f'  {cid:16s} {k}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True)
    ap.add_argument('--release', default='2026-09-23.1')
    ap.add_argument('--theme', default='all')
    ap.add_argument('--only', nargs='*')
    a = ap.parse_args()
    cities = json.load(open(os.path.join(HERE, 'cities.json')))
    if a.only:
        cities = [c for c in cities if c['id'] in a.only]
    od = os.path.join(a.cache, 'overture')
    os.makedirs(od, exist_ok=True)
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; SET enable_progress_bar=false;")
    root = f's3://overturemaps-us-west-2/release/{a.release}'
    sfx = '' if not a.only else '_' + '_'.join(a.only)
    if a.theme in ('all', 'buildings'):
        query(con, f'{root}/theme=buildings/type=building/*',
              'id, height, num_floors, min_height, class, subtype, is_underground',
              boxes(cities, lambda c: c['r'] * 1000 + 400), os.path.join(od, f'buildings{sfx}.parquet'))
    if a.theme in ('all', 'water'):
        query(con, f'{root}/theme=base/type=water/*', "id, class, subtype, names.primary AS name, names.common['en'] AS name_en",
              boxes(cities, lambda c: INNER_HALF_M), os.path.join(od, f'water{sfx}.parquet'))
    if a.theme in ('all', 'places'):
        query(con, f'{root}/theme=divisions/type=division/*', "id, subtype, names.primary AS name, names.common['en'] AS name_en, population",
              boxes(cities, lambda c: INNER_HALF_M), os.path.join(od, f'places{sfx}.parquet'))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
# ============================================================================
#  BUILD AIRPORTS  ·  writes data/airports.json for the flight board
# ----------------------------------------------------------------------------
#  The board needs every airport that has scheduled airline service, with
#  its time zone, so that it can show local times. Two open datasets give
#  this:
#    OurAirports airports.csv   public domain. The list, codes, names, size
#                               and the scheduled_service flag.
#    mwgg/Airports airports.json  MIT. The IANA time zone of each ICAO code.
#  An airport that mwgg does not know takes the time zone of the nearest
#  airport that mwgg knows.
#
#  Output: one JSON array of rows
#    [iata, icao, name, city, country(ISO 3166), lat, lon, tz, size]
#  size: 3 large, 2 medium, 1 other. Search ranks by size.
#
#  Usage (from the repo root):
#    python3 stella-nova/pages/flight-board/tools/build-airports.py
#    python3 .../build-airports.py --csv airports.csv --tz airports.json
#  Without the flags, the tool downloads both files.
# ============================================================================
import argparse, csv, io, json, math, os, sys, urllib.request

CSV_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
TZ_URL = "https://raw.githubusercontent.com/mwgg/Airports/master/airports.json"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "airports.json")
SIZE = {"large_airport": 3, "medium_airport": 2}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "davesgames.io flight-board build"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode("utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv")
    ap.add_argument("--tz")
    a = ap.parse_args()
    rows = list(csv.DictReader(io.StringIO(open(a.csv).read() if a.csv else fetch(CSV_URL))))
    tzdb = json.loads(open(a.tz).read() if a.tz else fetch(TZ_URL))
    known = [(v["lat"], v["lon"], v["tz"]) for v in tzdb.values() if v.get("tz")]

    def nearest_tz(lat, lon):
        best, bd = None, 1e9
        cl = math.cos(math.radians(lat))
        for la, lo, tz in known:
            d = (la - lat) ** 2 + ((lo - lon) * cl) ** 2
            if d < bd:
                best, bd = tz, d
        return best

    out, guessed = [], 0
    for r in rows:
        iata = r["iata_code"].strip()
        if not iata or r["scheduled_service"] != "yes" or r["type"] == "closed":
            continue
        icao = (r["icao_code"] or r["gps_code"] or r["ident"]).strip()
        lat, lon = float(r["latitude_deg"]), float(r["longitude_deg"])
        hit = tzdb.get(icao) or tzdb.get(r["ident"])
        tz = hit.get("tz") if hit else None
        if not tz:
            tz = nearest_tz(lat, lon)
            guessed += 1
        out.append([iata, icao, r["name"], r["municipality"], r["iso_country"],
                    round(lat, 4), round(lon, 4), tz, SIZE.get(r["type"], 1)])
    out.sort(key=lambda x: (-x[8], x[0]))
    with open(OUT, "w") as f:
        f.write("[\n" + ",\n".join(json.dumps(x, ensure_ascii=False, separators=(",", ":")) for x in out) + "\n]\n")
    print(f"airports: {len(out)} rows, {guessed} time zones from the nearest known airport -> {os.path.relpath(OUT)}")


if __name__ == "__main__":
    sys.exit(main())

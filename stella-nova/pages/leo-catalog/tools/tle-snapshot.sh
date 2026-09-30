#!/usr/bin/env bash
# ============================================================================
#  tle-snapshot.sh  ·  write the TLE snapshot that leo-catalog loads first
# ----------------------------------------------------------------------------
#  The Pages workflow (.github/workflows/pages.yml) runs this script before
#  each deploy. The script writes these files into ../data/:
#      stations.txt  active.txt   CelesTrak GP groups, FORMAT=tle
#      meta.json                  {"fetchedAt": <unix seconds>}
#
#  CelesTrak updates the groups about every 2 h and blocks IP addresses that
#  download more often. Pushes to main can deploy many times in 2 h, so the
#  script uses these sources in order:
#      1. The live snapshot, if its meta.json is younger than MAX_AGE seconds.
#      2. A new download from CelesTrak.
#      3. The live snapshot of any age, if the CelesTrak download fails.
#  If no source works, the script deletes ../data/ and the page falls back to
#  CelesTrak in the browser. The script always exits 0, so the deploy goes on.
#
#  SECTION MAP   (grep -n)
#      "fetch_live"       copy the snapshot from the live site
#      "fetch_celestrak"  download and check each group from CelesTrak
# ============================================================================
set -u

DIR="$(cd "$(dirname "$0")/.." && pwd)/data"
LIVE="${LIVE:-https://davesgames.io/stella-nova/pages/leo-catalog/data}"
CELESTRAK="${CELESTRAK:-https://celestrak.org/NORAD/elements/gp.php}"
MAX_AGE="${MAX_AGE:-6600}"
TLE_GROUPS="stations active"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# A file is a TLE file when it has at least one line-1 record.
is_tle() { grep -q '^1 [0-9 ]\{5\}' "$1"; }

fetch_live() {
  curl -fsS --max-time 60 -o "$TMP/meta.json" "$LIVE/meta.json" || return 1
  for g in $TLE_GROUPS; do
    curl -fsS --max-time 60 -o "$TMP/$g.txt" "$LIVE/$g.txt" || return 1
    is_tle "$TMP/$g.txt" || return 1
  done
}

fetch_celestrak() {
  for g in $TLE_GROUPS; do
    curl -fsS --max-time 120 -A 'davesgames.io tle-snapshot' \
      -o "$TMP/$g.txt" "$CELESTRAK?GROUP=$g&FORMAT=tle" || return 1
    # CelesTrak can answer a rate-limited request with 200 and a text notice.
    is_tle "$TMP/$g.txt" || { echo "  $g: no TLE in response"; return 1; }
  done
  printf '{"fetchedAt": %s}\n' "$(date +%s)" > "$TMP/meta.json"
}

publish() {
  rm -rf "$DIR" && mkdir -p "$DIR"
  cp "$TMP"/meta.json "$DIR"/
  for g in $TLE_GROUPS; do cp "$TMP/$g.txt" "$DIR/"; done
  for g in $TLE_GROUPS; do
    echo "  $g.txt: $(grep -c '^1 ' "$DIR/$g.txt") objects, $(wc -c < "$DIR/$g.txt" | tr -d ' ') bytes"
  done
  echo "  meta.json: $(cat "$DIR/meta.json")"
}

now=$(date +%s)
live_at=$(curl -fsS --max-time 30 "$LIVE/meta.json" 2>/dev/null \
  | sed -n 's/.*"fetchedAt": *\([0-9][0-9]*\).*/\1/p')

if [ -n "$live_at" ] && [ $((now - live_at)) -lt "$MAX_AGE" ] && fetch_live; then
  echo "tle-snapshot: reuse live snapshot, age $((now - live_at)) s"
  publish; exit 0
fi
if fetch_celestrak; then
  echo "tle-snapshot: new download from CelesTrak"
  publish; exit 0
fi
if fetch_live; then
  echo "tle-snapshot: CelesTrak failed, reuse live snapshot of any age"
  publish; exit 0
fi
echo "tle-snapshot: no source worked, deploy without data/"
rm -rf "$DIR"
exit 0

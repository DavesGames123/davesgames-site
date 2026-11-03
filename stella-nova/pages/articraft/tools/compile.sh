#!/bin/bash
# ============================================================================
#  ARTICRAFT PLAYGROUND  ·  tools/compile.sh — compile the selected records
# ----------------------------------------------------------------------------
#  This script compiles records with the Articraft harness, offline, in a
#  sandbox. It writes tools/compiled.tsv (the records that compiled) and
#  tools/skipped.tsv (the records that it skipped, with the reason).
#
#  Modes:
#    compile.sh fetch    sparse-add the pool paths (one batch fetch)
#    compile.sh          per group, compile rows of tools/selection.tsv in
#                        order until the group has its primary count
#
#  A record in tools/blocklist.tsv is skipped. urdf2mjcf.mjs and
#  check-data.mjs failures go there by hand, then run this script again: the
#  next reserve row of the same group takes the free place.
#
#  CAUTION: compile runs model.py as Python. Each model.py must pass
#  safe_source before the sandboxed compile. Do not remove the sandbox-exec
#  line, or a bad record can read files or use the network.
#
#  GREP MAP
#    safe_source ....... the safety grep from CONTRACT.md
#    compile_one ....... sandboxed compile of one record
#    main loop ......... "while IFS" over selection.tsv
# ============================================================================
set -u
S=${S:-/private/tmp/claude-501/-Users-davidkubala-Downloads-davesgames-site/70c36212-1e83-4438-9ae1-29026f3d8fdd/scratchpad/articraft}
TOOLS=$(cd "$(dirname "$0")" && pwd)
LOGDIR=$S/laneA/logs
mkdir -p "$LOGDIR"

if [ "${1:-}" = "fetch" ]; then
  cd "$S/data" || exit 1
  # pool-paths.txt comes from select.py pool; add only paths not there yet
  git sparse-checkout list > "$LOGDIR/sparse-now.txt"
  grep -vxF -f "$LOGDIR/sparse-now.txt" "$S/pool-paths.txt" > "$LOGDIR/sparse-new.txt" || true
  n=$(wc -l < "$LOGDIR/sparse-new.txt" | tr -d ' ')
  echo "sparse-add $n paths"
  [ "$n" -gt 0 ] && git sparse-checkout add --stdin < "$LOGDIR/sparse-new.txt"
  exit $?
fi

# Returns 0 if model.py has only allowed imports and no unsafe calls.
safe_source() {
  local f=$1
  if grep -nE '^[[:space:]]*(import|from)[[:space:]]' "$f" \
     | grep -vE '^[0-9]+:[[:space:]]*(from[[:space:]]+(cadquery|math|sdk|numpy|typing|dataclasses|__future__)([.][A-Za-z_]+)*[[:space:]]+import|import[[:space:]]+(cadquery|math|numpy|typing|dataclasses)([[:space:]]+as[[:space:]]+[A-Za-z_]+)?[[:space:]]*$)' \
     > "$LOGDIR/grep.tmp"; then
    echo "import: $(head -1 "$LOGDIR/grep.tmp" | cut -c1-60)"; return 1
  fi
  if grep -nE 'open\(|subprocess|(^|[^A-Za-z0-9_])os\.|socket|eval\(|exec\(|__import__' "$f" > "$LOGDIR/grep.tmp"; then
    echo "call: $(head -1 "$LOGDIR/grep.tmp" | cut -c1-60)"; return 1
  fi
  return 0
}

compile_one() {
  local rec=$1 out=$S/data/cache/record_materialization/$1
  if [ -f "$out/model.urdf" ] && grep -q '"status": "success"' "$out/compile_report.json" 2>/dev/null; then return 0; fi
  ( cd "$S/harness" && sandbox-exec -p '(version 1)(allow default)(deny network*)' \
      perl -e 'alarm shift; exec @ARGV' 300 .venv/bin/python -m cli.main compile "$S/data/records/$rec" --data-dir "$S/data" ) \
      > "$LOGDIR/$rec.log" 2>&1
  [ -f "$out/model.urdf" ]
}

SEL=$TOOLS/selection.tsv
BLOCK=$TOOLS/blocklist.tsv
touch "$BLOCK"
: > "$TOOLS/compiled.tsv.new"
: > "$TOOLS/skipped.tsv.new"
quota_of() { awk -F'\t' -v g="$1" '$1==g && $6=="primary"' "$SEL" | wc -l | tr -d ' '; }
have_of() { awk -F'\t' -v g="$1" '$1==g' "$TOOLS/compiled.tsv.new" | wc -l | tr -d ' '; }

while IFS=$'\t' read -r group rec rev njoint cat role; do
  case "$group" in \#*|'') continue ;; esac
  [ "$(have_of "$group")" -ge "$(quota_of "$group")" ] && continue
  if grep -q "^$rec	" "$BLOCK"; then
    printf '%s\t%s\t%s\n' "$group" "$rec" "blocklist: $(grep "^$rec	" "$BLOCK" | cut -f2)" >> "$TOOLS/skipped.tsv.new"; continue
  fi
  src=$S/data/records/$rec/revisions/$rev/model.py
  if [ ! -f "$src" ]; then printf '%s\t%s\t%s\n' "$group" "$rec" "model.py not fetched" >> "$TOOLS/skipped.tsv.new"; continue; fi
  if ! why=$(safe_source "$src"); then printf '%s\t%s\t%s\n' "$group" "$rec" "grep $why" >> "$TOOLS/skipped.tsv.new"; continue; fi
  t0=$(date +%s)
  if compile_one "$rec"; then
    printf '%s\t%s\t%s\t%s\n' "$group" "$rec" "$rev" "$cat" >> "$TOOLS/compiled.tsv.new"
    echo "ok   $group $rec ($(( $(date +%s) - t0 )) s)"
  else
    printf '%s\t%s\t%s\n' "$group" "$rec" "compile failed: $(tail -1 "$LOGDIR/$rec.log" | cut -c1-80)" >> "$TOOLS/skipped.tsv.new"
    echo "FAIL $group $rec (see $LOGDIR/$rec.log)"
  fi
done < "$SEL"

mv "$TOOLS/compiled.tsv.new" "$TOOLS/compiled.tsv"
mv "$TOOLS/skipped.tsv.new" "$TOOLS/skipped.tsv"
echo "compiled $(wc -l < "$TOOLS/compiled.tsv" | tr -d ' '), skipped $(wc -l < "$TOOLS/skipped.tsv" | tr -d ' ')"

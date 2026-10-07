#!/usr/bin/env bash
# ============================================================================
#  tools/stats-deploy.sh — deploy the sn-stats Worker and turn counting on
# ----------------------------------------------------------------------------
#  Usage (from the repo root, after "npx wrangler login"):
#    bash tools/stats-deploy.sh             first deploy, or a redeploy
#    bash tools/stats-deploy.sh --new-key   also replace STATS_KEY
#    STATS_KEY=<key> bash tools/stats-deploy.sh   use this key
#
#  Stages (each one prints a diagnostic block and goes on if it can):
#    1 login     wrangler whoami
#    2 database  find or create the D1 "sn-stats"; write its id into
#                stella-nova/pages/stats/worker/wrangler.toml
#    3 schema    schema.sql on the remote D1 (IF NOT EXISTS: safe again)
#    4 key       STATS_KEY secret. Made with openssl when not given. Kept
#                when it is already set, unless --new-key.
#    5 deploy    wrangler deploy; reads the workers.dev URL
#    6 live      GET / and GET /stats with the key on the live Worker
#    7 endpoint  writes the URL into STATS_URL in stella-nova/lib/stats-beacon.js
#
#  The key is printed once, at the end, when this run made it. Keep it:
#  the #stats page asks for it, and Cloudflare does not show it again.
#  The script does not commit and does not push.
#
#  grep -n targets: "stage()", "find_db", "STATS_URL ="
# ============================================================================
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
W="$ROOT/stella-nova/pages/stats/worker"
BEACON="$ROOT/stella-nova/lib/stats-beacon.js"
WR="npx -y wrangler@4.148.0"
NEW_KEY=0; [ "${1:-}" = "--new-key" ] && NEW_KEY=1
KEY="${STATS_KEY:-}"; MADE_KEY=0; URL=""; DBID=""; FAILED=0
cd "$W" || { echo "no worker folder: $W"; exit 1; }

stage() { echo; echo "================================================================"; echo " STAGE $1"; echo "================================================================"; }
diag()  { echo "---- diagnostic: $1 ----"; }
verdict() { echo ">> $1"; }

# 1 ───────────────────────────────────────────────────────────────────────
stage "1/7 login"
WHO=$($WR whoami 2>&1)
diag "wrangler whoami"; echo "$WHO" | grep -E "logged in|not authenticated|Account Name|Account ID|│" | head -8
if echo "$WHO" | grep -q "not authenticated"; then
  verdict "Not logged in. Run: npx wrangler login. Nothing past this point can work, so it stops here."
  exit 1
fi
verdict "Logged in. Cloudflare recognises you, which is more than most dashboards do."

# 2 ───────────────────────────────────────────────────────────────────────
stage "2/7 database"
find_db() { $WR d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.slice(s.indexOf("[")));const d=j.find(x=>x.name==="sn-stats");console.log(d?d.uuid:"")}catch(e){console.log("")}})'; }
DBID=$(find_db)
if [ -z "$DBID" ]; then
  diag "wrangler d1 create sn-stats"; $WR d1 create sn-stats 2>&1 | tail -6
  DBID=$(find_db)
fi
if [ -n "$DBID" ]; then
  sed -i '' -E "s/^database_id = \".*\"/database_id = \"$DBID\"/" wrangler.toml
fi
diag "database id in wrangler.toml"; grep -n "database_id" wrangler.toml
if [ -n "$DBID" ] && grep -q "$DBID" wrangler.toml; then verdict "D1 sn-stats is $DBID. A database with no rows, as all great databases start."
else verdict "FAILED: no D1 id. The later stages will fail too."; FAILED=1; fi

# 3 ───────────────────────────────────────────────────────────────────────
stage "3/7 schema"
SCH=$($WR d1 execute sn-stats --remote --file schema.sql --yes 2>&1)
diag "d1 execute schema.sql --remote"; echo "$SCH" | grep -E "success|rror|executed|Executed" | head -5
TBL=$($WR d1 execute sn-stats --remote --json --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s.slice(s.indexOf("[")))[0].results.map(r=>r.name).join(" "))}catch(e){console.log("(could not read)")}})')
diag "tables on the remote D1"; echo "$TBL"
if echo "$TBL" | grep -q "agg" && echo "$TBL" | grep -q "seen"; then verdict "Four tables, zero opinions. Schema in."
else verdict "FAILED: the tables are not there."; FAILED=1; fi

# 4 ───────────────────────────────────────────────────────────────────────
stage "4/7 key"
HAS=$($WR secret list 2>/dev/null | grep -c '"STATS_KEY"')
if [ -z "$KEY" ] && { [ "$HAS" = "0" ] || [ $NEW_KEY = 1 ]; }; then
  KEY=$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=\n'); MADE_KEY=1
fi
if [ -n "$KEY" ]; then
  diag "wrangler secret put STATS_KEY"; printf '%s' "$KEY" | $WR secret put STATS_KEY 2>&1 | grep -E "Success|rror|Creating" | head -3
else
  diag "wrangler secret list"; echo "STATS_KEY already set; kept (use --new-key to replace it)"
fi
HAS=$($WR secret list 2>/dev/null | grep -c '"STATS_KEY"')
diag "secret present"; echo "STATS_KEY entries: $HAS"
if [ "$HAS" != "0" ]; then verdict "Secret set. Guard it better than most people guard their Wi-Fi password."
else verdict "FAILED: STATS_KEY is not set."; FAILED=1; fi

# 5 ───────────────────────────────────────────────────────────────────────
stage "5/7 deploy"
DEP=$($WR deploy 2>&1)
diag "wrangler deploy"; echo "$DEP" | grep -vE "^\s*$" | tail -12
URL=$(echo "$DEP" | grep -oE "https://sn-stats\.[a-z0-9-]+\.workers\.dev" | head -1)
if [ -n "$URL" ]; then verdict "Live at $URL. It counts nothing yet, which is also true of most startups."
else verdict "FAILED: no workers.dev URL in the output."; FAILED=1; fi

# 6 ───────────────────────────────────────────────────────────────────────
stage "6/7 live"
if [ -n "$URL" ]; then
  diag "GET $URL/"; curl -s -m 15 "$URL/"
  diag "GET /stats without key (expect 401)"; curl -s -m 15 -o /dev/null -w "%{http_code}\n" "$URL/stats"
  if [ -n "$KEY" ]; then
    diag "GET /stats with key (expect 200)"; curl -s -m 15 -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $KEY" "$URL/stats"
  else echo "(key not known to this run; skipped the 200 check)"; fi
  diag "POST /e from a bot user agent (expect X-Stats: bot)"; curl -s -m 15 -D - -o /dev/null -X POST -A "curl/8 stats-deploy" -H "Content-Type: text/plain" --data '{"v":1,"ev":[{"t":"pv","p":"home"}]}' "$URL/e" | grep -i "x-stats"
  verdict "The Worker answers. It even refuses strangers, which is the whole point."
else verdict "Skipped: no URL."; fi

# 7 ───────────────────────────────────────────────────────────────────────
stage "7/7 endpoint"
if [ -n "$URL" ]; then
  sed -i '' -E "s#^  var STATS_URL = '.*';#  var STATS_URL = '$URL';#" "$BEACON"
  diag "STATS_URL in lib/stats-beacon.js"; grep -n "var STATS_URL" "$BEACON"
  node --check "$BEACON" && echo "node --check: ok"
  verdict "The beacon knows where to go. Push, and the counting starts."
else verdict "Skipped: no URL, STATS_URL unchanged."; fi

echo
echo "================================================================"
if [ $FAILED = 0 ]; then echo " DONE. Not committed, not pushed."; else echo " FINISHED WITH FAILURES (see the stages above)."; fi
if [ $MADE_KEY = 1 ]; then
  echo
  echo " STATS_KEY (shown once; keep it; the #stats page asks for it):"
  echo "   $KEY"
  echo " Open: https://davesgames.io/stella-nova/#stats/key=$KEY"
fi
echo "================================================================"
exit $FAILED

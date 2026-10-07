-- ===========================================================================
--  SITE STATS  ·  D1 schema for worker.js
-- ---------------------------------------------------------------------------
--  agg   the only table that keeps data past one day. One row per
--        (UTC day, metric m, key a, key b) with a count n and a sum v.
--        Totals only: no row names a visitor.
--  seen  the daily visitor hashes, for unique counts and the event cap.
--        h = SHA-256(daily salt | IP | user agent), cut to 16 hex digits.
--        The cron in worker.js deletes every row older than today.
--  salt  one random salt per UTC day. Deleted with seen, so an old hash
--        cannot be made again and two days cannot be linked.
--  live  the last event time of each hash, for "on the site now".
--        Rows older than 15 minutes are deleted.
--  The IP address and the user agent are never written to any table.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS agg (
  day TEXT NOT NULL, m TEXT NOT NULL, a TEXT NOT NULL, b TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0, v REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, m, a, b)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS seen (
  day TEXT NOT NULL, h TEXT NOT NULL, p TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, h, p)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS salt (day TEXT PRIMARY KEY, s TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS live (h TEXT PRIMARY KEY, p TEXT NOT NULL, t INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS live_t ON live (t);

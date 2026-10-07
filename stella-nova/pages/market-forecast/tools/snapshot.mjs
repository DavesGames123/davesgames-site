#!/usr/bin/env node
// ============================================================================
//  MARKET FORECAST  ·  tools/snapshot.mjs  ·  write the IEX market snapshot
// ----------------------------------------------------------------------------
//  The pages workflow runs this at deploy time, every 2 h. It writes
//  iex.json into --out (default data/live/ next to the page; not in git).
//  The page loads data/live/iex.json first and data/sample/iex.json (a
//  dated, committed sample) when the live file is missing.
//
//    node stella-nova/pages/market-forecast/tools/snapshot.mjs
//        [--out dir] [--prev url|file] [--max-days 2] [--keep 20]
//        [--keep-daily 400] [--budget-min 30] [--streams 4] [--chunk-mb 32]
//        [--symbols SPY,QQQ,...]
//
//  Source: IEX Exchange HIST, the TOPS feed (trades and top of book on the
//  IEX exchange), one gzipped pcapng file per session, published T+1 for
//  free. Terms: https://www.iex.io/products/market-data-connectivity/
//  hist-terms ("If you distribute ... IEX historical data, you must cite
//  IEX as the source"). The page shows "Data provided for free by IEX."
//  on every chart. Other free sources were checked and not used (see the
//  page README in CREDITS.txt): their terms forbid republishing.
//
//  Cost: a TOPS file is 9-16 GB. The tool reads it with ranged GETs in
//  order (--streams in flight), gunzips and parses it as a stream (no
//  disk), and stops at the first trade after 16:01 ET, so it reads about
//  three quarters of the file. One session took about N min on a laptop
//  (see the commit). The previous snapshot (--prev, default the deployed
//  file on www.davesgames.io) carries the older sessions forward, so a run
//  only reads sessions it does not have, at most --max-days, newest first,
//  inside --budget-min. The listing is one request.
//
//  Exit 1 when no session could be read and there is no previous snapshot.
//  Nothing is written then, so the deploy keeps the committed sample.
//  The tests never run this tool (they use tools/fixtures/).
//
//  grep -n targets: "async function* ranged", "async function readSession",
//  "function merge", "const NAMES"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable, pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createTopsReader, tradesToBars } from './iex-tops.mjs';
import { etLocalToUtc } from '../synth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const OUT = path.resolve(opt('out', path.join(HERE, '..', 'data', 'live')));
const PREV = opt('prev', 'https://www.davesgames.io/stella-nova/pages/market-forecast/data/live/iex.json');
const SAMPLE = path.join(HERE, '..', 'data', 'sample', 'iex.json');
const MAX_DAYS = +opt('max-days', 2), KEEP = +opt('keep', 20), KEEP_D = +opt('keep-daily', 400);
const BUDGET = +opt('budget-min', 30) * 60e3, STREAMS = +opt('streams', 4), CHUNK = +opt('chunk-mb', 32) * 1048576;
const UA = 'davesgames.io market-forecast snapshot (GitHub Pages deploy; IEX HIST, cited)';
const LISTING = 'https://iextrading.com/api/1.0/hist';

export const NAMES = {
  SPY: 'SPDR S&P 500 ETF Trust', QQQ: 'Invesco QQQ Trust', DIA: 'SPDR Dow Jones Industrial Average ETF', IWM: 'iShares Russell 2000 ETF',
  AAPL: 'Apple Inc.', MSFT: 'Microsoft Corp.', NVDA: 'NVIDIA Corp.', AMZN: 'Amazon.com Inc.', GOOGL: 'Alphabet Inc. Class A',
  META: 'Meta Platforms Inc.', TSLA: 'Tesla Inc.', 'BRK.B': 'Berkshire Hathaway Inc. Class B', JPM: 'JPMorgan Chase & Co.',
};
const SYMBOLS = opt('symbols', Object.keys(NAMES).join(',')).split(',');
export const SOURCE = {
  id: 'iex', name: 'IEX Exchange HIST · TOPS', citation: 'Data provided for free by IEX.',
  terms: 'https://www.iex.io/products/market-data-connectivity/hist-terms',
  note: 'Trades on the IEX exchange only, regular session. Prices are real trades; volume is IEX volume, a small part of all US volume. Published the day after each session (T+1).',
};
const t0 = Date.now();
const log = m => console.error(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

async function get(url, init = {}, tries = 5) {
  for (let k = 1; ; k++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(120000), headers: { 'User-Agent': UA, ...(init.headers || {}) } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url.slice(0, 90)}`);
      return r;
    } catch (e) { if (k >= tries) throw e; await new Promise(res => setTimeout(res, 2000 * k)); }
  }
}

// Ordered ranged reads: STREAMS requests in flight, chunks yielded in order.
async function* ranged(url, size, stop) {
  let next = 0; const q = [];
  const start = off => get(url, { headers: { Range: `bytes=${off}-${Math.min(size, off + CHUNK) - 1}` } }).then(async r => Buffer.from(await r.arrayBuffer()));
  while (next < size && q.length < STREAMS) { q.push(start(next)); next += CHUNK; }
  while (q.length) {
    const b = await q.shift();
    if (stop()) { q.forEach(p => p.catch(() => {})); return; }
    if (next < size) { q.push(start(next)); next += CHUNK; }
    yield b;
  }
}

async function readSession(entry) {
  const ymd = entry.date, y = +ymd.slice(0, 4), m = +ymd.slice(4, 6), d = +ymd.slice(6, 8);
  const open = etLocalToUtc(y, m, d, 9, 30), close = etLocalToUtc(y, m, d, 16, 0);
  const size = +entry.size;
  let lastT = 0;
  const reader = createTopsReader({ symbols: SYMBOLS, onAnyTrade: t => { if (t > lastT) lastT = t; } });
  const stop = () => lastT > close + 60e3;
  // pipeline, not pipe: a failed range must end the loop with its error
  const gz = zlib.createGunzip({ chunkSize: 1 << 20 });
  pipeline(Readable.from(ranged(entry.link, size, stop)), gz, () => {});
  const ts = Date.now(); let lastLog = 0;
  try {
    for await (const c of gz) {
      reader.push(c);
      if (Date.now() - lastLog > 15000) { lastLog = Date.now(); log(`${ymd}: ${(reader.stats.bytes / 1e9).toFixed(1)} GB raw, trades to ${lastT ? new Date(lastT).toISOString().slice(11, 16) : '-'} UTC, kept ${reader.stats.kept}`); }
      if (stop()) break;
    }
  } finally { gz.destroy(); }
  if (!stop()) throw new Error(`${ymd}: the file ended before 16:01 ET (last trade ${new Date(lastT).toISOString()})`);
  const { trades, stats } = reader.end();
  const out = {};
  for (const [sym, tr] of trades) {
    const bars = tradesToBars(tr, open);
    if (bars.length) out[sym] = bars;
  }
  log(`${ymd}: done in ${((Date.now() - ts) / 1000).toFixed(0)} s, ${(stats.bytes / 1e9).toFixed(1)} GB raw read, ${stats.kept} trades kept, ${Object.keys(out).length} symbols`);
  return { date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`, open, bars: out, secs: (Date.now() - ts) / 1000 };
}

const r4 = v => Math.round(v * 1e4) / 1e4;
// Older snapshot + new sessions -> the kept window. Intraday rows per
// session; daily rows [t, o, h, l, c, v] from the session's 5-min bars.
export function merge(prev, sessions, { keep = KEEP, keepDaily = KEEP_D, symbols = SYMBOLS } = {}) {
  const S = { version: 1, source: SOURCE, generatedAt: Date.now(), sessions: [], symbols: {} };
  const byDate = new Map();
  if (prev && prev.symbols) for (const [sym, v] of Object.entries(prev.symbols)) for (const s of v.sessions || []) {
    if (!byDate.has(s.date)) byDate.set(s.date, { date: s.date, open: s.open, bars: {} });
    byDate.get(s.date).bars[sym] = s.bars;
  }
  for (const s of sessions) byDate.set(s.date, s);
  const dates = [...byDate.keys()].sort();
  const daily = {};
  if (prev && prev.symbols) for (const [sym, v] of Object.entries(prev.symbols)) daily[sym] = new Map((v.daily || []).map(r => [r[0], r]));
  for (const date of dates) {
    const s = byDate.get(date);
    for (const [sym, bars] of Object.entries(s.bars)) {
      if (!bars.length) continue;
      const day = [s.open, bars[0][1], Math.max(...bars.map(b => b[2])), Math.min(...bars.map(b => b[3])), bars[bars.length - 1][4], bars.reduce((a, b) => a + b[5], 0)];
      (daily[sym] = daily[sym] || new Map()).set(s.open, day.map((v, i) => (i === 0 || i === 5 ? v : r4(v))));
    }
  }
  const kept = dates.slice(-keep);
  S.sessions = kept;
  for (const sym of symbols) {
    const sess = kept.map(d => byDate.get(d)).filter(s => s.bars[sym]).map(s => ({ date: s.date, open: s.open, bars: s.bars[sym].map(b => [b[0], r4(b[1]), r4(b[2]), r4(b[3]), r4(b[4]), b[5]]) }));
    const dl = daily[sym] ? [...daily[sym].values()].sort((a, b) => a[0] - b[0]).slice(-keepDaily) : [];
    if (sess.length || dl.length) S.symbols[sym] = { name: NAMES[sym] || sym, sessions: sess, daily: dl };
  }
  return S;
}

async function loadPrev() {
  try {
    if (/^https?:/.test(PREV)) { const r = await get(PREV, {}, 1); const j = await r.json(); log(`previous snapshot: ${PREV} (${j.sessions.length} sessions, last ${j.sessions.at(-1)})`); return j; }
    const j = JSON.parse(fs.readFileSync(PREV, 'utf8')); log(`previous snapshot: ${PREV}`); return j;
  } catch (e) {
    log(`no previous snapshot at ${PREV} (${e.message}); using the committed sample`);
    try { return JSON.parse(fs.readFileSync(SAMPLE, 'utf8')); } catch (e2) { return null; }
  }
}

async function main() {
  const prev = await loadPrev();
  const have = new Set(prev ? prev.sessions : []);
  const listing = await (await get(LISTING)).json();
  const tops = Object.keys(listing).sort().map(k => (listing[k] || []).find(f => f.feed === 'TOPS')).filter(Boolean);
  const want = tops.slice(-KEEP).reverse().filter(e => !have.has(`${e.date.slice(0, 4)}-${e.date.slice(4, 6)}-${e.date.slice(6, 8)}`)).slice(0, MAX_DAYS);
  log(`listing: ${tops.length} TOPS sessions, newest ${tops.at(-1).date}; to read: ${want.map(e => `${e.date} (${(e.size / 1e9).toFixed(1)} GB)`).join(', ') || 'none'}`);
  const got = [], notes = [];
  for (const e of want) {
    if (Date.now() - t0 > BUDGET) { notes.push(`budget reached before ${e.date}`); break; }
    try { got.push(await readSession(e)); } catch (err) { notes.push(`${e.date}: ${err.message}`); log(`failed: ${err.message}`); }
  }
  if (!got.length && !prev) { console.error('market-forecast snapshot: nothing read and no previous snapshot'); process.exit(1); }
  const S = merge(prev, got);
  S.notes = notes;
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'iex.json'), text = JSON.stringify(S);
  fs.writeFileSync(file, text);
  console.log(`market-forecast snapshot: ${S.sessions.length} sessions (${S.sessions[0]} .. ${S.sessions.at(-1)}), ${Object.keys(S.symbols).length} symbols, read ${got.length} new (${got.map(g => g.date + ' ' + g.secs.toFixed(0) + ' s').join(', ')}), ${(text.length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${file}`);
  if (notes.length) console.log('notes: ' + notes.join(' | '));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('market-forecast snapshot failed: ' + (e && e.stack || e)); process.exit(1); });
}

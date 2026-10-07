// ============================================================================
//  DATA TESTS  ·  pages/market-forecast/tests-data.mjs — node test runner
// ----------------------------------------------------------------------------
//  Checks synth.js and providers.js with no network and no
//  npm packages:  node tests-data.mjs        (prints PASS/FAIL, exit 1 on fail)
//                 node tests-data.mjs --live (also 4 real requests with the
//                 providers' public "demo" keys: Twelve Data AAPL, Alpha
//                 Vantage IBM, 5min and 1day)
//  Provider tests use a fake fetch with canned JSON and a fake
//  localStorage. They check that a key goes only into the URL of the
//  provider's own host, and never into a Series, a storage key other than
//  'mf-key-<id>', or an error message.
//
//  grep -n targets: "section('", "function fakeFetch", "LIVE"
// ============================================================================
import { synthMarket, etParts, etOffsetMs, BAR_MS } from './synth.js';
import { PROVIDERS, keys, redact, providerHost } from './providers.js';

let fails = 0, passes = 0;
const ok = (cond, name, info = '') => { if (cond) { passes++; console.log('PASS', name, info); } else { fails++; console.log('FAIL', name, info); } };
const section = s => console.log('\n== ' + s);
const eqArr = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

// ── synth ───────────────────────────────────────────────────────────────────
section('synth');
const TODAY = Date.UTC(2026, 9, 6, 18); // Tue 2026-10-06, EDT
let t0 = performance.now();
const m1 = synthMarket({ seed: 7, today: TODAY });
const ms1 = performance.now() - t0;
t0 = performance.now();
const m1b = synthMarket({ seed: 7, today: TODAY });
const ms2 = performance.now() - t0;
const m2 = synthMarket({ seed: 8, today: TODAY });
ok(m1.universe.length === 8 && m1.universe.every(u => u.sym.endsWith('.SYN')), 'eight .SYN tickers', m1.universe.map(u => u.sym).join(' '));
ok(ms1 < 150 && ms2 < 150, 'speed < 150 ms', `cold ${ms1.toFixed(1)} ms, warm ${ms2.toFixed(1)} ms`);
let same = true, diff = false;
for (const u of m1.universe) for (const k of ['t', 'o', 'h', 'l', 'c', 'v']) {
  same &&= eqArr(m1.intraday[u.sym][k], m1b.intraday[u.sym][k]) && eqArr(m1.daily[u.sym][k], m1b.daily[u.sym][k]);
  if (k === 'c') diff ||= !eqArr(m1.intraday[u.sym].c.slice(0, -1), m2.intraday[u.sym].c.slice(0, -1));
}
ok(same, 'same seed gives identical arrays');
ok(diff, 'different seed gives different arrays');
{
  const s = m1.intraday['ORIN.SYN'], d = m1.daily['ORIN.SYN'];
  const perDay = new Map(); let grid = true, hours = true, weekend = false, ohlc = true;
  for (let i = 0; i < s.t.length; i++) {
    const t = s.t[i], p = etParts(t), off = etOffsetMs(t) / 3600e3;
    const key = `${p.y}-${p.m}-${p.d}`; perDay.set(key, (perDay.get(key) || 0) + 1);
    if (t % BAR_MS) grid = false;
    const uh = new Date(t).getUTCHours() + new Date(t).getUTCMinutes() / 60;
    const lo = off === -4 ? 13.5 : 14.5, hi = off === -4 ? 20 : 21;
    if (!(uh >= lo && uh < hi) || ![-4, -5].includes(off)) hours = false;
    if (p.dow === 0 || p.dow === 6) weekend = true;
    if (!(s.h[i] >= Math.max(s.o[i], s.c[i]) && s.l[i] <= Math.min(s.o[i], s.c[i]) && s.l[i] > 0)) ohlc = false;
  }
  const counts = [...perDay.values()];
  ok(counts.slice(0, -1).every(c => c === 78) && counts.at(-1) === 38, '78 bars per full session, 38 today', `${counts.length} sessions`);
  ok(grid, 'bar times on the 5-minute grid');
  ok(hours, 'bars inside 13:30-20:00 UTC (EDT) or 14:30-21:00 UTC (EST)');
  ok(!weekend, 'no weekend bars');
  ok(ohlc, 'high >= open, close >= low > 0');
  ok(s.session.complete === false && s.session.barsPerSession === 78 && s.session.barMs === BAR_MS && d.session.barsPerSession === 1 && d.session.complete === true, 'session fields: partial intraday, complete daily');
  const lp = etParts(s.t.at(-1));
  ok(lp.hh === 12 && lp.mm === 35 && lp.y === 2026 && lp.m === 10 && lp.d === 6, 'last bar 12:35 ET on 2026-10-06', `${lp.hh}:${lp.mm}`);
  const cl = etParts(s.session.lastClose);
  ok(cl.hh === 16 && cl.mm === 0 && cl.d === 6, 'lastClose is 16:00 ET today');
  ok(d.c.length === 504 && d.c.at(-1) === s.c.at(-1) && d.interval === '1day', 'daily: 504 sessions, last close = intraday last close');
  ok(s.source.synthetic === true && /Synthetic/.test(s.source.label) && s.source.asOf === s.t.at(-1), 'source says synthetic', s.source.label);
  // EST check: a date in winter.
  const w = synthMarket({ seed: 1, days: 3, dailyYears: 0.1, today: Date.UTC(2026, 0, 14, 18) }).intraday['VEGA.SYN'];
  const first = new Date(w.t[0]);
  ok(first.getUTCHours() === 14 && first.getUTCMinutes() === 30, 'winter session opens 14:30 UTC (EST)', first.toISOString());
}

// ── providers ───────────────────────────────────────────────────────────────
section('providers');
const KEY = 'SeCrEt-k3y_9z';
// A fake localStorage that records every write.
const store = new Map(), writes = [];
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { writes.push([k, String(v)]); store.set(k, String(v)); },
  removeItem: k => { writes.push([k, null]); store.delete(k); },
};
// fakeFetch(handler): records each call; handler(url) -> { status, json }.
function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init: JSON.stringify(init || {}) });
    const { status = 200, json } = handler(url);
    return { ok: status >= 200 && status < 300, status, statusText: 'x', json: async () => json };
  };
  f.calls = calls;
  return f;
}
const DAY = '2026-10-05'; // a Monday
const etBars = (n, start = 0) => Array.from({ length: n }, (_, i) => { const m = 570 + (start + i) * 5; return `${DAY} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`; });
const canned = {
  twelvedata: {
    '5min': { meta: { symbol: 'AAPL', exchange: 'NASDAQ', currency: 'USD' }, status: 'ok', values: etBars(78).map((d, i) => ({ datetime: d, open: String(100 + i * 0.1), high: String(100.5 + i * 0.1), low: String(99.5 + i * 0.1), close: String(100.05 + i * 0.1), volume: '1000' })).reverse() },
    '1day': { meta: { symbol: 'AAPL' }, status: 'ok', values: [{ datetime: '2026-10-02', open: '1', high: '2', low: '0.5', close: '1.5', volume: '9' }, { datetime: '2026-10-05', open: '1.5', high: '2', low: '1', close: '1.8', volume: '9' }] },
  },
  alphavantage: {
    '5min': { 'Meta Data': { '3. Last Refreshed': `${DAY} 19:55:00`, '6. Time Zone': 'US/Eastern' }, 'Time Series (5min)': Object.fromEntries([...etBars(78), `${DAY} 08:00:00`, `${DAY} 19:55:00`].map((d, i) => [d, { '1. open': '10', '2. high': '11', '3. low': '9', '4. close': String(10 + i / 100), '5. volume': '5' }])) },
    '1day': { 'Meta Data': {}, 'Time Series (Daily)': { '2026-10-05': { '1. open': '10', '2. high': '11', '3. low': '9', '4. close': '10.5', '5. volume': '5' }, '2026-10-02': { '1. open': '9', '2. high': '10', '3. low': '8', '4. close': '9.5', '5. volume': '5' } } },
  },
  polygon: {
    '5min': { status: 'OK', results: Array.from({ length: 80 }, (_, i) => ({ t: Date.UTC(2026, 9, 5, 13, 20) + i * BAR_MS, o: 5, h: 6, l: 4, c: 5.5, v: 7 })) },
    '1day': { status: 'DELAYED', results: [{ t: Date.UTC(2026, 9, 2, 4), o: 5, h: 6, l: 4, c: 5.5, v: 7 }, { t: Date.UTC(2026, 9, 5, 4), o: 5, h: 6, l: 4, c: 5.6, v: 7 }] },
  },
};
const validSeries = (s, interval) => s && s.interval === interval && s.t instanceof Float64Array && ['o', 'h', 'l', 'c', 'v'].every(k => s[k] instanceof Float64Array && s[k].length === s.t.length)
  && s.t.every((x, i) => i === 0 || x > s.t[i - 1]) && s.tz === 'America/New_York' && s.session && Number.isFinite(s.session.lastClose) && s.source && s.source.synthetic === false && Number.isFinite(s.source.asOf);
for (const id of ['twelvedata', 'alphavantage', 'polygon']) {
  const P = PROVIDERS[id];
  for (const interval of ['5min', '1day']) {
    const f = fakeFetch(() => ({ json: canned[id][interval] }));
    let s, err = null;
    try { s = await P.fetchSeries('AAPL', interval, { key: KEY, fetchImpl: f, now: Date.UTC(2026, 9, 5, 21) }); } catch (e) { err = e; }
    ok(!err && validSeries(s, interval), `${id} ${interval} parses to a valid Series`, err ? String(err) : `${s.t.length} bars, last ${new Date(s.t.at(-1)).toISOString()}`);
    if (s && interval === '5min') {
      const p0 = etParts(s.t[0]), pl = etParts(s.t.at(-1));
      ok(s.t.length === 78 && p0.hh === 9 && p0.mm === 30 && pl.hh === 15 && pl.mm === 55 && s.session.complete, `${id} 5min keeps 09:30-15:55 ET only`, `${s.t.length} bars`);
    }
    if (s && interval === '1day') {
      const pl = etParts(s.t.at(-1));
      ok(pl.hh === 9 && pl.mm === 30 && pl.d === 5, `${id} 1day bar time is 09:30 ET of its date`);
    }
    const c = f.calls[0];
    ok(f.calls.length === 1 && new URL(c.url).host === providerHost(id) && c.url.includes(encodeURIComponent(KEY)), `${id} ${interval}: key only in the URL of ${providerHost(id)}`);
    ok(!c.init.includes(KEY) && /"credentials":"omit"/.test(c.init) && /no-referrer/.test(c.init), `${id} ${interval}: no key in headers or body; credentials omit, no referrer`);
    ok(s && !JSON.stringify(s).includes(KEY), `${id} ${interval}: no key in the Series`);
  }
  // 401 whose body echoes the key, and a rate-limit answer.
  const echo = `Invalid API key ${KEY} (apikey=${encodeURIComponent(KEY)})`;
  const bad = {
    twelvedata: [{ status: 401, json: { code: 401, message: echo, status: 'error' } }, { status: 200, json: { code: 429, message: 'Too many requests for ' + KEY, status: 'error' } }],
    alphavantage: [{ status: 401, json: { 'Error Message': echo } }, { status: 200, json: { Note: 'Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day. key ' + KEY } }],
    polygon: [{ status: 401, json: { status: 'ERROR', error: echo } }, { status: 429, json: { status: 'ERROR', error: 'exceeded the maximum requests per minute ' + KEY } }],
  }[id];
  for (const [i, b] of bad.entries()) {
    let msg = '', kind = '';
    try { await P.fetchSeries('AAPL', '5min', { key: KEY, fetchImpl: fakeFetch(() => b) }); } catch (e) { msg = String(e.message); kind = e.kind; }
    ok(msg && !msg.includes(KEY) && !msg.includes(encodeURIComponent(KEY)) && msg.includes('•••'), `${id} ${i ? 'rate-limit' : '401'} error is redacted`, `[${kind}] ${msg.slice(0, 90)}`);
    ok(i ? kind === 'rate' : kind === 'auth', `${id} ${i ? 'rate-limit' : '401'} error kind`, kind);
  }
  // A network error whose message holds the URL (and so the key).
  let msg = '';
  try { await P.fetchSeries('AAPL', '1day', { key: KEY, fetchImpl: async u => { throw new TypeError('fetch failed for ' + u); } }); } catch (e) { msg = String(e.message); }
  ok(msg && !msg.includes(KEY) && !msg.includes(encodeURIComponent(KEY)), `${id} network error is redacted`, msg.slice(0, 80));
  // No key: no request at all.
  const f0 = fakeFetch(() => ({ json: {} }));
  let e0 = null; try { await P.fetchSeries('AAPL', '5min', { key: '', fetchImpl: f0 }); } catch (e) { e0 = e; }
  ok(e0 && f0.calls.length === 0, `${id}: no key, no request`);
}
{
  writes.length = 0;
  keys.set('twelvedata', KEY);
  const got = keys.get('twelvedata');
  keys.set('alphavantage', 'other');
  keys.clear('alphavantage');
  ok(got === KEY, 'keys.get returns the stored key');
  ok(writes.every(([k]) => /^mf-key-(twelvedata|alphavantage)$/.test(k)), 'keys write only mf-key-<id>', writes.map(w => w[0]).join(', '));
  ok(writes.filter(([, v]) => v && v.includes(KEY)).every(([k]) => k === 'mf-key-twelvedata'), 'the key is stored only under mf-key-twelvedata');
  ok(redact(`a ${KEY} b ${encodeURIComponent('x y')}`, KEY) === 'a ••• b x%20y' && redact('x', '') === 'x', 'redact() replaces the key');
  const thrower = { getItem() { throw new Error('private'); }, setItem() { throw new Error('private'); }, removeItem() { throw new Error('private'); } };
  const keep = globalThis.localStorage; globalThis.localStorage = thrower;
  ok(keys.get('polygon') === '' && keys.set('polygon', 'x') === false && keys.clear('polygon') === false, 'keys survive a throwing localStorage');
  globalThis.localStorage = keep;
  const s = await PROVIDERS.synthetic.fetchSeries('LYRA.SYN', '5min');
  ok(s.source.synthetic && s.sym === 'LYRA.SYN', 'synthetic provider serves the demo market');
}

// ── LIVE (optional, public demo keys only) ──────────────────────────────────
if (process.argv.includes('--live')) {
  section('live (public demo keys, 4 requests)');
  const fmtSeries = s => `${s.t.length} bars, first ${new Date(s.t[0]).toISOString()}, asOf ${new Date(s.source.asOf).toISOString()}, last close ${s.c.at(-1)}, label "${s.source.label}"`;
  for (const [id, sym] of [['twelvedata', 'AAPL'], ['alphavantage', 'IBM']]) for (const iv of ['5min', '1day']) {
    try { console.log('LIVE', id, sym, iv, fmtSeries(await PROVIDERS[id].fetchSeries(sym, iv, { key: 'demo' }))); }
    catch (e) { console.log('LIVE', id, sym, iv, 'ERROR', e.kind, e.message); }
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

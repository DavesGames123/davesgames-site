// ============================================================================
//  DATA PROVIDERS  ·  pages/market-forecast/providers.js — bars from an API
// ----------------------------------------------------------------------------
//  The page reads price bars from one provider at a time. Each provider is
//  one object with the same shape, so a new one is one more entry:
//    { id, label, needsKey, keyUrl, intervals, limits,
//      fetchSeries(sym, interval, { key, signal, fetchImpl, now }) }
//  fetchSeries returns a Series (see makeSeries in synth.js): bar times in
//  ms UTC, regular-session bars only (09:30-15:55 ET for 5min), oldest
//  first, no duplicates, with the source and the time it was read.
//
//  Browser access (CORS), measured 2026-10-06 in headless Chrome from an
//  http://127.0.0.1 origin:
//    twelvedata    readable; the public "demo" key returned AAPL bars
//    alphavantage  readable; the public "demo" key returned IBM bars for
//                  the documented sample URL. That key refused this
//                  module's URL while it had outputsize=compact (node,
//                  2026-10-06). The URL without it is not tested live.
//    polygon       readable 401 with a bad key; a real success with a
//                  valid key was NOT tested (no key), so it is unverified
//  Tiingo, Stooq, Yahoo, EODHD and FRED were blocked (no
//  Access-Control-Allow-Origin), so they are not here.
//
//  API keys (safety rules):
//    - keys.get/set/clear use localStorage key 'mf-key-<provider id>' only.
//      Every access is in try/catch (private mode can throw).
//    - The key goes ONLY into the query string of that provider's own URL
//      (providerHost(id)). No header, no body, no other host.
//    - The module never logs a key. Each error message goes through
//      redact(), which replaces the key text with '•••'.
//    - Requests use credentials 'omit' and referrerPolicy 'no-referrer'.
//
//  grep -n targets
//    key store ....... "export const keys"
//    redaction ....... "export function redact"
//    request ......... "async function getJSON"
//    Twelve Data ..... "const twelvedata"
//    Alpha Vantage ... "const alphavantage"
//    Polygon ......... "const polygon"
//    synthetic ....... "const synthetic"
// ============================================================================
import { makeSeries, etParts, etLocalToUtc, sessionOpenUtc, synthMarket, BAR_MS } from './synth.js';

const HOSTS = { twelvedata: 'api.twelvedata.com', alphavantage: 'www.alphavantage.co', polygon: 'api.polygon.io', synthetic: null, iex: null };
export function providerHost(id) { return HOSTS[id] ?? null; }

// ── key store ───────────────────────────────────────────────────────────────
const storeKey = id => 'mf-key-' + id;
export const keys = {
  get(id) { try { return globalThis.localStorage?.getItem(storeKey(id)) || ''; } catch (e) { return ''; } },
  set(id, value) {
    try {
      const v = String(value || '').trim();
      if (v) globalThis.localStorage?.setItem(storeKey(id), v); else globalThis.localStorage?.removeItem(storeKey(id));
      return true;
    } catch (e) { return false; }
  },
  clear(id) { try { globalThis.localStorage?.removeItem(storeKey(id)); return true; } catch (e) { return false; } },
};

// Replace each copy of the key (plain and URL-encoded) with '•••'.
export function redact(text, key) {
  let s = String(text ?? '');
  if (!key) return s;
  for (const k of new Set([String(key), encodeURIComponent(key)])) if (k) s = s.split(k).join('•••');
  return s;
}

class ProviderError extends Error {
  constructor(msg, kind) { super(msg); this.name = 'ProviderError'; this.kind = kind; }
}

// One GET to the provider's own host. The key is in the URL only.
async function getJSON(id, url, key, { signal, fetchImpl = globalThis.fetch } = {}) {
  if (new URL(url).host !== providerHost(id)) throw new ProviderError('Request host is not the provider host', 'internal');
  let res, body;
  try {
    res = await fetchImpl.call(globalThis, url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new ProviderError(redact(`Network or CORS error from ${providerHost(id)}: ${e && e.message || e}`, key), 'network');
  }
  try { body = await res.json(); } catch (e) { body = null; }
  if (!res.ok) {
    const msg = body && (body.message || body.error || body['Error Message'] || body.Note || body.Information) || res.statusText || '';
    const kind = res.status === 429 ? 'rate' : res.status === 401 || res.status === 403 ? 'auth' : 'http';
    throw new ProviderError(redact(`${providerHost(id)} answered ${res.status}${msg ? ': ' + msg : ''}`, key), kind);
  }
  if (!body || typeof body !== 'object') throw new ProviderError(`${providerHost(id)} sent no JSON`, 'parse');
  return body;
}

// ── helpers ─────────────────────────────────────────────────────────────────
// "YYYY-MM-DD" or "YYYY-MM-DD HH:MM[:SS]" in ET wall time -> ms UTC.
function etStringToUtc(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return NaN;
  return m[4] === undefined ? sessionOpenUtc(+m[1], +m[2], +m[3]) : etLocalToUtc(+m[1], +m[2], +m[3], +m[4], +m[5]);
}
// Keep the regular session only: bar opens from 09:30 to 15:55 ET.
function inSession(ms) {
  const p = etParts(ms), min = p.hh * 60 + p.mm;
  return p.dow >= 1 && p.dow <= 5 && min >= 570 && min <= 955 && min % 5 === 0;
}
// rows: [t, o, h, l, c, v]; sorts, drops duplicates and bad rows.
function toSeries(sym, interval, rows, source) {
  const ok = rows.filter(r => r.every(Number.isFinite) && r[4] > 0 && (interval !== '5min' || inSession(r[0])));
  ok.sort((a, b) => a[0] - b[0]);
  const u = ok.filter((r, i) => i === 0 || r[0] !== ok[i - 1][0]);
  if (!u.length) throw new ProviderError(`No ${interval} bars for ${sym}`, 'empty');
  const col = k => u.map(r => r[k]);
  return makeSeries({ sym, name: sym, interval, t: col(0), o: col(1), h: col(2), l: col(3), c: col(4), v: col(5), source });
}
function checkInterval(p, interval) {
  if (!p.intervals.includes(interval)) throw new ProviderError(`${p.label} has no ${interval} interval here`, 'arg');
}
const symOK = s => /^[A-Za-z0-9.\-^=:/]{1,20}$/.test(s);

// ── Twelve Data ─────────────────────────────────────────────────────────────
const twelvedata = {
  id: 'twelvedata', label: 'Twelve Data', needsKey: true, keyUrl: 'https://twelvedata.com/register',
  intervals: ['5min', '1day'],
  limits: 'Free plan: 8 requests a minute, 800 a day. US stocks; intraday data can be delayed.',
  async fetchSeries(sym, interval, { key, signal, fetchImpl, now = Date.now() } = {}) {
    checkInterval(this, interval);
    if (!key) throw new ProviderError('Twelve Data needs an API key', 'auth');
    if (!symOK(sym)) throw new ProviderError('Bad symbol', 'arg');
    const u = new URL('https://api.twelvedata.com/time_series');
    u.searchParams.set('symbol', sym); u.searchParams.set('interval', interval);
    u.searchParams.set('outputsize', interval === '5min' ? '5000' : '1000');
    u.searchParams.set('timezone', 'America/New_York'); u.searchParams.set('order', 'ASC');
    u.searchParams.set('apikey', key);
    const j = await getJSON(this.id, u.href, key, { signal, fetchImpl });
    if (j.status === 'error' || !Array.isArray(j.values)) {
      const kind = j.code === 429 ? 'rate' : j.code === 401 || j.code === 403 ? 'auth' : 'api';
      throw new ProviderError(redact(`Twelve Data: ${j.message || 'no values'}`, key), kind);
    }
    const rows = j.values.map(v => [etStringToUtc(v.datetime), +v.open, +v.high, +v.low, +v.close, v.volume === undefined ? 0 : +v.volume]);
    return toSeries(sym, interval, rows, {
      id: this.id, synthetic: false, fetchedAt: now,
      label: `Twelve Data · ${interval}${interval === '5min' ? ' · may be delayed' : ''}`,
      note: `${j.meta && j.meta.exchange || ''} ${j.meta && j.meta.currency || ''}`.trim(),
    });
  },
};

// ── Alpha Vantage ───────────────────────────────────────────────────────────
const alphavantage = {
  id: 'alphavantage', label: 'Alpha Vantage', needsKey: true, keyUrl: 'https://www.alphavantage.co/support/#api-key',
  intervals: ['5min', '1day'],
  limits: 'Free key: 25 requests a day. Intraday "compact" gives the last 100 bars.',
  async fetchSeries(sym, interval, { key, signal, fetchImpl, now = Date.now() } = {}) {
    checkInterval(this, interval);
    if (!key) throw new ProviderError('Alpha Vantage needs an API key', 'auth');
    if (!symOK(sym)) throw new ProviderError('Bad symbol', 'arg');
    const u = new URL('https://www.alphavantage.co/query');
    // The documented order: function, symbol, interval, apikey. The public
    // 'demo' key is accepted only for the documented URL (measured: the same
    // parameters as interval-before-symbol got the "demo purposes only"
    // answer). outputsize is left out: 'compact' (100 bars) is the default.
    u.searchParams.set('function', interval === '5min' ? 'TIME_SERIES_INTRADAY' : 'TIME_SERIES_DAILY');
    u.searchParams.set('symbol', sym);
    if (interval === '5min') u.searchParams.set('interval', '5min');
    u.searchParams.set('apikey', key);
    const j = await getJSON(this.id, u.href, key, { signal, fetchImpl });
    // Rate limit and plan messages come back as 200 with one text field.
    if (j.Note || j.Information) throw new ProviderError(redact(`Alpha Vantage limit: ${j.Note || j.Information}`, key), 'rate');
    if (j['Error Message']) throw new ProviderError(redact(`Alpha Vantage: ${j['Error Message']}`, key), 'api');
    const tsKey = Object.keys(j).find(k => k.startsWith('Time Series'));
    if (!tsKey) throw new ProviderError('Alpha Vantage: no time series in the answer', 'parse');
    const ts = j[tsKey];
    // Time stamps are US/Eastern wall time ("6. Time Zone" in Meta Data).
    const rows = Object.keys(ts).map(k => { const b = ts[k]; return [etStringToUtc(k), +b['1. open'], +b['2. high'], +b['3. low'], +b['4. close'], +b['5. volume']]; });
    return toSeries(sym, interval, rows, {
      id: this.id, synthetic: false, fetchedAt: now,
      label: `Alpha Vantage · ${interval}${interval === '5min' ? ' · may be delayed' : ''}`,
      note: (j['Meta Data'] && j['Meta Data']['3. Last Refreshed']) ? 'Last refreshed ' + j['Meta Data']['3. Last Refreshed'] + ' ET' : '',
    });
  },
};

// ── Polygon (Massive) ───────────────────────────────────────────────────────
// Unverified with a valid key: only the 401 answer was seen from a browser.
const ymdET = ms => { const p = etParts(ms); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
const polygon = {
  id: 'polygon', label: 'Polygon (Massive)', needsKey: true, keyUrl: 'https://polygon.io/dashboard/signup',
  intervals: ['5min', '1day'],
  limits: 'Free plan: 5 requests a minute, end-of-day data, two years of history.',
  async fetchSeries(sym, interval, { key, signal, fetchImpl, now = Date.now() } = {}) {
    checkInterval(this, interval);
    if (!key) throw new ProviderError('Polygon needs an API key', 'auth');
    if (!symOK(sym)) throw new ProviderError('Bad symbol', 'arg');
    const from = ymdET(now - (interval === '5min' ? 30 : 730) * 86400000), to = ymdET(now);
    const span = interval === '5min' ? '5/minute' : '1/day';
    const u = new URL(`https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(sym.toUpperCase())}/range/${span}/${from}/${to}`);
    u.searchParams.set('adjusted', 'true'); u.searchParams.set('sort', 'asc'); u.searchParams.set('limit', '50000');
    u.searchParams.set('apiKey', key);
    const j = await getJSON(this.id, u.href, key, { signal, fetchImpl });
    if (j.status === 'ERROR' || !Array.isArray(j.results)) throw new ProviderError(redact(`Polygon: ${j.error || j.message || 'no results'}`, key), 'api');
    // Daily bars: t is the start of the day; move it to 09:30 ET of that date.
    const rows = j.results.map(b => {
      let t = b.t;
      if (interval === '1day') { const p = etParts(t + 6 * 3600e3); t = sessionOpenUtc(p.y, p.m, p.d); }
      return [t, b.o, b.h, b.l, b.c, b.v ?? 0];
    });
    return toSeries(sym, interval, rows, {
      id: this.id, synthetic: false, fetchedAt: now,
      label: `Polygon · ${interval}${j.status === 'DELAYED' ? ' · delayed' : ''}`,
      note: j.status === 'DELAYED' ? 'The provider marks these bars as delayed.' : '',
    });
  },
};

// ── synthetic (no key, no network) ──────────────────────────────────────────
const synthCache = new Map();
// IEX Exchange HIST snapshot (tools/snapshot.mjs, deploy time, T+1).
// Same-origin files: data/live/iex.json, else the committed, dated
// data/sample/iex.json. No key, no third-party request from the browser.
let iexP = null;
async function loadIex(fetchImpl = globalThis.fetch) {
  if (!iexP) iexP = (async () => {
    for (const f of ['data/live/iex.json', 'data/sample/iex.json']) {
      try {
        const r = await fetchImpl.call(globalThis, new URL('./' + f, import.meta.url), { cache: 'no-cache' });
        if (r.ok) { const j = await r.json(); j.file = f; return j; }
      } catch (e) { /* next */ }
    }
    throw new ProviderError('The IEX market snapshot is not available', 'network');
  })().catch(e => { iexP = null; throw e; });
  return iexP;
}
export function iexSeries(snap, sym, interval, now = Date.now()) {
  const v = snap.symbols[sym];
  if (!v) throw new ProviderError(`${sym} is not in the IEX snapshot (use a key-based provider for other tickers)`, 'arg');
  const rows = interval === '5min' ? v.sessions.flatMap(s => s.bars) : v.daily;
  const last = snap.sessions[snap.sessions.length - 1];
  const s = toSeries(sym, interval, rows.map(r => r.slice()), {
    id: 'iex', synthetic: false, fetchedAt: snap.generatedAt || now,
    label: `IEX trades · ${interval === '5min' ? '5 min' : 'daily'} · T+1 (session ${last})${snap.file === 'data/sample/iex.json' ? ' · committed sample' : ''} · Data provided for free by IEX`,
    note: snap.source ? snap.source.note : '',
  });
  s.name = v.name || sym;
  return s;
}
const iex = {
  id: 'iex', label: 'Real market · IEX (no key)', needsKey: false, keyUrl: null,
  intervals: ['5min', '1day'],
  limits: 'Real trades on the IEX exchange, regular session, one day behind (T+1). Data provided for free by IEX. Fixed ticker list.',
  async universe({ fetchImpl } = {}) { const j = await loadIex(fetchImpl); return Object.entries(j.symbols).map(([sym, v]) => ({ sym, name: v.name })); },
  async fetchSeries(sym, interval, { fetchImpl, now } = {}) {
    checkInterval(this, interval);
    return iexSeries(await loadIex(fetchImpl), sym, interval, now);
  },
};

const synthetic = {
  id: 'synthetic', label: 'Offline synthetic (not market data)', needsKey: false, keyUrl: null,
  intervals: ['5min', '1day'],
  limits: 'No network. Values come from a stochastic model, not from a market.',
  market(seed = 1) {
    let m = synthCache.get(seed);
    if (!m) { m = synthMarket({ seed }); synthCache.set(seed, m); }
    return m;
  },
  async fetchSeries(sym, interval, { seed = 1 } = {}) {
    checkInterval(this, interval);
    const m = this.market(seed), s = (interval === '5min' ? m.intraday : m.daily)[sym];
    if (!s) throw new ProviderError(`${sym} is not in the synthetic market`, 'arg');
    return s;
  },
};

export const PROVIDERS = { iex, twelvedata, alphavantage, polygon, synthetic };
export { ProviderError, BAR_MS };

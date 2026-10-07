// ============================================================================
//  DATA TESTS  ·  pages/market-forecast/tests-data.mjs — node test runner
// ----------------------------------------------------------------------------
//  Checks synth.js, providers.js and analysis.js with no network and no
//  npm packages:  node tests-data.mjs        (prints PASS/FAIL, exit 1 on fail)
//                 node tests-data.mjs --live (also 4 real requests with the
//                 providers' public "demo" keys: Twelve Data AAPL, Alpha
//                 Vantage IBM, 5min and 1day)
//  Provider tests use a fake fetch with canned JSON and a fake
//  localStorage. They check that a key goes only into the URL of the
//  provider's own host, and never into a Series, a storage key other than
//  'mf-key-<id>', or an error message.
//
//  grep -n targets: "section('", "function fakeFetch", "LIVE", "perfect forecaster"
// ============================================================================
import { synthMarket, etParts, etOffsetMs, BAR_MS } from './synth.js';
import { PROVIDERS, keys, redact, providerHost } from './providers.js';
import { normInv, normCdf, quantileFn, interpLevels, logReturns, corrMatrix, cholesky, portfolio, pinball, wql, backtest, pickOrigins } from './analysis.js';
import { rng } from './synth.js';

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

// ── analysis ────────────────────────────────────────────────────────────────
section('analysis');
{
  let w = 0;
  for (let i = -60; i <= 60; i++) { const p = i < 0 ? 10 ** (i / 10) : i === 0 ? 0.5 : 1 - 10 ** (-i / 10); if (p > 0 && p < 1) w = Math.max(w, Math.abs(normCdf(normInv(p)) - p) / Math.min(p, 1 - p)); }
  for (let i = 1; i < 2000; i++) { const p = i / 2000; w = Math.max(w, Math.abs(normCdf(normInv(p)) - p)); }
  ok(w < 1e-9, 'normInv/normCdf round trip < 1e-9 (relative in the tails)', w.toExponential(2));
  ok(Math.abs(normInv(0.975) - 1.959963984540054) < 1e-12 && Math.abs(normCdf(-1.959963984540054) - 0.025) < 1e-14, 'normInv(0.975) = 1.959963984540054');
  const L = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], V = L.map(p => 50 + 4 * normInv(p));
  const f = quantileFn(L, V);
  ok(L.every((p, k) => Math.abs(f(p) - V[k]) < 1e-12), 'quantileFn reproduces the given levels');
  let mono = true, prev = -Infinity;
  for (let i = 1; i < 1000; i++) { const x = f(i / 1000); if (x < prev - 1e-12) mono = false; prev = x; }
  const g = quantileFn(L, [1, 2, 3, 2.5, 5, 6, 7, 8, 9]); prev = -Infinity;
  for (let i = 1; i < 1000; i++) { const x = g(i / 1000); if (x < prev - 1e-12) mono = false; prev = x; }
  ok(mono, 'quantileFn is monotone (also for crossing inputs)');
  ok(Math.abs(f(0.01) - (50 + 4 * normInv(0.01))) < 1e-9, 'tail extrapolation is exact for a normal (linear in z)', f(0.01).toFixed(6));
  const [q25, q75] = interpLevels(L, V, [0.25, 0.75]);
  ok(Math.abs(q25 - (50 + 4 * normInv(0.25))) < 1e-9 && Math.abs(q75 - (50 + 4 * normInv(0.75))) < 1e-9, 'interpLevels gives the 25/75 band', `${q25.toFixed(4)} ${q75.toFixed(4)}`);

  // correlation and Cholesky
  const R = rng(5), n = 4000, a = new Float64Array(n), b = new Float64Array(n), c = new Float64Array(n);
  for (let i = 0; i < n; i++) { const x = R.n(), y = R.n(), z = R.n(); a[i] = x; b[i] = 0.6 * x + 0.8 * y; c[i] = z; }
  const C = corrMatrix([a, b, c], 0);
  ok(Math.abs(C[0][1] - 0.6) < 0.04 && Math.abs(C[0][2]) < 0.04, 'corrMatrix finds 0.6 and 0', `${C[0][1].toFixed(3)} ${C[0][2].toFixed(3)}`);
  const Cs = corrMatrix([a, b, c], 0.1);
  ok(Math.abs(Cs[0][1] - 0.9 * C[0][1]) < 1e-12 && Cs[1][1] === 1, 'shrinkage to the identity');
  const Lc = cholesky(Cs); let err = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += Lc[i][k] * Lc[j][k]; err = Math.max(err, Math.abs(s - Cs[i][j])); }
  ok(err < 1e-12, 'cholesky: L L^T = A', err.toExponential(2));
  ok(cholesky([[1, 1], [1, 1]]).length === 2, 'cholesky of a singular matrix works with jitter');
  const lr = logReturns(Float64Array.from([100, 110, 99]));
  ok(Math.abs(lr[0] - Math.log(1.1)) < 1e-15 && lr.length === 2, 'logReturns');

  // portfolio
  const pos = (sym, shares, price, mu, sd) => ({ sym, shares, price, levels: L, endQ: L.map(p => mu + sd * normInv(p)) });
  const one = portfolio({ positions: [pos('A', 3, 100, 101, 2)], n: 20000, seed: 11 });
  const exp = p => 3 * (101 + 2 * normInv(p));
  ok(Math.abs(one.q.p10 - exp(0.1)) < 0.15 && Math.abs(one.q.p50 - exp(0.5)) < 0.12 && Math.abs(one.q.p90 - exp(0.9)) < 0.15, 'one position reproduces its quantiles (MC error)', `${one.q.p10.toFixed(2)}/${exp(0.1).toFixed(2)} ${one.q.p50.toFixed(2)}/${exp(0.5).toFixed(2)} ${one.q.p90.toFixed(2)}/${exp(0.9).toFixed(2)}`);
  ok(Math.abs(one.pUp - (1 - normCdf(-0.5))) < 0.01, 'one position P(up) = Phi(mu-p / sd)', one.pUp.toFixed(4));
  const two = [pos('A', 1, 100, 100, 2), pos('B', 1, 100, 100, 2)];
  const corr1 = portfolio({ positions: two, corr: [[1, 1], [1, 1]], n: 20000, seed: 3, compareIndependent: true });
  const ratio = corr1.sd / corr1.indep.sd;
  ok(ratio > 1.35 && ratio < 1.48, 'perfectly correlated pair is wider than independent (about sqrt 2)', ratio.toFixed(3));
  ok(Math.abs(corr1.pUp - 0.5) < 0.015 && Math.abs(corr1.indep.pUp - 0.5) < 0.015, 'symmetric case P(up) ~ 0.5', `${corr1.pUp.toFixed(3)} ${corr1.indep.pUp.toFixed(3)}`);
  const cs = corr1.perPos.reduce((s, p) => s + p.contrib, 0);
  ok(Math.abs(cs - 1) < 1e-9, 'variance contributions sum to 1', cs.toFixed(12));
  const loss = portfolio({ positions: [pos('A', 10, 100, 95, 1), pos('B', 5, 50, 48, 1)], corr: [[1, 0.3], [0.3, 1]], n: 20000, seed: 9 });
  ok(loss.var95 >= 0 && loss.es95 >= loss.var95 && loss.pUp < 0.01, 'loss case: VaR95 >= 0, ES95 >= VaR95', `VaR ${loss.var95.toFixed(2)} ES ${loss.es95.toFixed(2)} pUp ${loss.pUp}`);
  const again = portfolio({ positions: [pos('A', 10, 100, 95, 1), pos('B', 5, 50, 48, 1)], corr: [[1, 0.3], [0.3, 1]], n: 20000, seed: 9 });
  ok(eqArr(loss.samples, again.samples), 'portfolio is deterministic for a seed');
  const hst = loss.histogram(40);
  ok(hst.counts.length === 40 && hst.edges.length === 41 && hst.counts.reduce((x, y) => x + y, 0) > 19800, 'histogram helper');
  t0 = performance.now();
  portfolio({ positions: m1.universe.map((u, i) => pos(u.sym, 10, 100, 100, 1 + i / 4)), corr: corrMatrix(m1.universe.map(u => logReturns(m1.intraday[u.sym].c))), n: 20000, seed: 1 });
  ok(performance.now() - t0 < 400, '8 positions, 20000 samples with the synthetic correlation', `${(performance.now() - t0).toFixed(0)} ms`);

  // losses
  ok(pinball(10, 8, 0.9) === 0.9 * 2 && Math.abs(pinball(10, 12, 0.9) - 0.2) < 1e-15 && pinball(5, 5, 0.3) === 0, 'pinball hand values: 1.8, 0.2, 0');
  const wv = wql([{ y: 10, q: [8, 10, 12], levels: [0.1, 0.5, 0.9] }]);
  ok(Math.abs(wv - 0.08 / 3) < 1e-15, 'wql hand value: (0.04 + 0 + 0.04) / 3', wv.toFixed(6));

  // backtest: a perfect forecaster on a sine plus iid noise
  const N = 2000, sig = 0.5, per = 50, rr = rng(21);
  const mean = t => 100 + 10 * Math.sin(2 * Math.PI * t / per);
  const closes = Float64Array.from({ length: N }, (_, t) => mean(t) + sig * rr.n());
  const H = 20, origins = pickOrigins(N, H, 40);
  ok(origins.length === 40 && origins.at(-1) === N - 1 - H && origins[0] >= 32, 'pickOrigins: 40 origins, newest last', `${origins[0]}..${origins.at(-1)}`);
  ok(eqArr(pickOrigins(100, 10, 3, 5), [79, 84, 89]), 'pickOrigins with a stride');
  const fcs = origins.map(o => L.map(p => Float64Array.from({ length: H }, (_, h) => mean(o + h + 1) + sig * normInv(p))));
  const bt = backtest({ closes, origins, H, levels: L, forecasts: fcs, season: per });
  ok(Math.abs(bt.coverage80 - 0.8) < 0.04 && bt.steps === 800, 'perfect forecaster: 80 % band coverage ~ 0.8', `${bt.coverage80.toFixed(3)} over ${bt.steps} steps, end ${bt.coverage80End.toFixed(3)}`);
  ok(bt.reliability.every(r => Math.abs(r.observed - r.tau) < 0.05), 'reliability near the diagonal', bt.reliability.map(r => r.observed.toFixed(2)).join(' '));
  ok(bt.wqlModel < bt.wqlSeasonal && bt.wqlSeasonal < bt.wqlNaive && bt.skillNaive > 0, 'WQL: perfect < seasonal naive < naive', `${bt.wqlModel.toFixed(5)} < ${bt.wqlSeasonal.toFixed(5)} < ${bt.wqlNaive.toFixed(5)}, skill ${bt.skillNaive.toFixed(3)}`);
  ok(bt.maseMedian < 1 && bt.perOrigin.length === 40 && bt.perOrigin.every(p => p.end && Number.isFinite(p.wql)), 'median MAE ratio < 1 and per-origin rows', bt.maseMedian.toFixed(3));
  // A forecaster that knows nothing more than the last value scores about the naive baseline.
  const naiveF = origins.map(o => L.map(p => new Float64Array(H).fill(closes[o])));
  const bt2 = backtest({ closes, origins, H, levels: L, forecasts: naiveF, season: per });
  ok(bt2.coverage80 < 0.2 && bt2.wqlModel > bt.wqlModel, 'a point forecaster (no spread) has poor coverage', bt2.coverage80.toFixed(3));
  // No look-ahead: change every bar after one origin; its naive band must not move.
  const o = origins[20], c2 = closes.slice(); for (let t = o + 1; t < N; t++) c2[t] *= 3;
  const one1 = backtest({ closes, origins: [o], H, levels: L, forecasts: [fcs[20]], season: per }).perOrigin[0].end.naive;
  const one2 = backtest({ closes: c2, origins: [o], H, levels: L, forecasts: [fcs[20]], season: per }).perOrigin[0].end.naive;
  ok(one1.q10 === one2.q10 && one1.q50 === one2.q50 && one1.q90 === one2.q90, 'naive baseline reads no bar after the origin', `${one1.q10.toFixed(3)} ${one1.q90.toFixed(3)}`);
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

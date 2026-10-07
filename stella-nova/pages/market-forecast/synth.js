// ============================================================================
//  SYNTHETIC MARKET  ·  pages/market-forecast/synth.js — the demo data set
// ----------------------------------------------------------------------------
//  The page must show a full result with no API key. Stock data vendors do
//  not let a site give their data to other people, so the demo uses
//  synthetic series. This module makes them from a stochastic model. The
//  values are not market data, and every series says so in its source.
//
//  Model (log prices, one 5-minute bar is one step):
//    r_i = drift + beta_i * m + gamma_i * s_k + e_i + jump_i
//    m     market factor, GARCH(1,1) variance (volatility clustering)
//    s_k   sector factor, shared by the tickers of sector k
//    e_i   own noise of ticker i, its own GARCH(1,1) variance
//    jump  Poisson jumps, rare, both signs
//  A U-shaped profile scales the volatility and the volume through the
//  session (high at the open and at the close). Each new session starts
//  with an overnight gap. OHLC come from four sub-steps inside each bar.
//  The daily history before the intraday window uses the same model with
//  daily steps. At the end, each ticker is scaled so that its last price
//  is its nominal price level.
//
//  Calendar: weekdays only, 09:30-16:00 America/New_York. Market holidays
//  are not removed. The ET offset (EDT or EST) comes from Intl, so the bar
//  times are correct UTC instants. The last session is "today": the most
//  recent weekday on or before the real date, with nowBar bars (default
//  38, so the simulated clock is 12:40 ET).
//
//  Exports
//    synthMarket(opts)         the 8-ticker demo market (see the function)
//    etOffsetMs(ms)            ET wall time minus UTC, in ms (negative)
//    etParts(ms)               { y, m, d, hh, mm, dow } in ET
//    sessionOpenUtc(y, m, d)   09:30 ET of that date, as ms UTC
//    etLocalToUtc(y, m, d, hh, mm)
//    lastWeekday(ms)           { y, m, d } of the last weekday on or before
//    weekdaysBack(ymd, n)      n weekdays that end on ymd, oldest first
//    makeSeries(fields)        builds a Series object (the page contract)
//    rng(seed)                 seeded uniform and normal generator
//
//  grep -n targets
//    calendar ........ "function etOffsetMs"   "function weekdaysBack"
//    series builder .. "function makeSeries"
//    tickers ......... "const UNIVERSE"
//    intraday model .. "function simIntraday"
//    daily model ..... "function simDaily"
//    entry ........... "export function synthMarket"
// ============================================================================

export const BAR_MS = 5 * 60 * 1000;
export const BARS_PER_SESSION = 78;
const SESSION_MS = 390 * 60 * 1000;

// ── random numbers ──────────────────────────────────────────────────────────
// sfc32, seeded through splitmix32, and Box-Muller normals with a spare.
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  const sm = () => { s = (s + 0x9e3779b9) | 0; let z = s; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b); z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35); return (z ^ (z >>> 16)) >>> 0; };
  let a = sm(), b = sm(), c = sm(), d = sm();
  const u = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
    return ((t >>> 0) + 0.5) / 4294967296;
  };
  for (let i = 0; i < 12; i++) u();
  let spare = NaN;
  const n = () => {
    if (spare === spare) { const v = spare; spare = NaN; return v; }
    const r = Math.sqrt(-2 * Math.log(u())), th = 2 * Math.PI * u();
    spare = r * Math.sin(th); return r * Math.cos(th);
  };
  return { u, n };
}

// ── calendar ────────────────────────────────────────────────────────────────
let fmt = null;
function etFmt() {
  if (!fmt) fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' });
  return fmt;
}
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function etParts(ms) {
  const p = {};
  for (const x of etFmt().formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second, dow: DOW[p.weekday] };
}
// ET wall time minus UTC at the instant ms: -4 h in EDT, -5 h in EST.
export function etOffsetMs(ms) {
  const f = Math.floor(ms / 1000) * 1000, p = etParts(f);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - f;
}
// The offset of a date is read at 17:00 UTC (12:00 or 13:00 ET), far from
// the 02:00 change. One Intl call per date, cached.
const offCache = new Map();
function dateOffset(y, m, d) {
  const k = y * 10000 + m * 100 + d;
  let o = offCache.get(k);
  if (o === undefined) { o = etOffsetMs(Date.UTC(y, m - 1, d, 17)); offCache.set(k, o); }
  return o;
}
export function etLocalToUtc(y, m, d, hh, mm) { return Date.UTC(y, m - 1, d, hh, mm) - dateOffset(y, m, d); }
export function sessionOpenUtc(y, m, d) { return etLocalToUtc(y, m, d, 9, 30); }
export function lastWeekday(ms) {
  const p = etParts(ms);
  let t = Date.UTC(p.y, p.m - 1, p.d, 12);
  while ([0, 6].includes(new Date(t).getUTCDay())) t -= 86400000;
  const q = new Date(t);
  return { y: q.getUTCFullYear(), m: q.getUTCMonth() + 1, d: q.getUTCDate() };
}
export function weekdaysBack(ymd, n) {
  const out = [];
  let t = Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12);
  while (out.length < n) {
    const q = new Date(t), w = q.getUTCDay();
    if (w !== 0 && w !== 6) out.push({ y: q.getUTCFullYear(), m: q.getUTCMonth() + 1, d: q.getUTCDate() });
    t -= 86400000;
  }
  return out.reverse();
}

// ── Series builder (the page contract) ─────────────────────────────────────
// bars: { t, o, h, l, c, v } arrays (any array type), sorted, no duplicates.
export function makeSeries({ sym, name, interval, t, o, h, l, c, v, source }) {
  const n = t.length, F = a => (a instanceof Float64Array ? a : Float64Array.from(a));
  const T = F(t);
  let lastClose = NaN, complete = true;
  if (n) {
    const p = etParts(T[n - 1]);
    lastClose = sessionOpenUtc(p.y, p.m, p.d) + SESSION_MS;
    if (interval === '5min') complete = T[n - 1] + BAR_MS >= lastClose;
  }
  return {
    sym, name: name || sym, interval,
    t: T, o: F(o), h: F(h), l: F(l), c: F(c), v: F(v),
    tz: 'America/New_York',
    session: { barMs: interval === '5min' ? BAR_MS : 86400000, barsPerSession: interval === '5min' ? BARS_PER_SESSION : 1, lastClose, complete },
    source: { ...source, asOf: n ? T[n - 1] : NaN },
  };
}

// ── tickers ─────────────────────────────────────────────────────────────────
// Fictional companies. vol and idio are annual. base is the mean volume of
// one 5-minute bar.
const UNIVERSE = [
  { sym: 'ORIN.SYN', name: 'Orin Quantum Looms', sector: 'Technology', price: 412.4, beta: 1.30, idio: 0.28, base: 52000 },
  { sym: 'VEGA.SYN', name: 'Vega Tidewater Freight', sector: 'Industrials', price: 63.55, beta: 1.00, idio: 0.22, base: 88000 },
  { sym: 'LYRA.SYN', name: 'Lyra Kelp Biotech', sector: 'Health care', price: 18.72, beta: 0.80, idio: 0.45, base: 140000 },
  { sym: 'CYGN.SYN', name: 'Cygnus Lantern Utilities', sector: 'Utilities', price: 41.2, beta: 0.45, idio: 0.12, base: 61000 },
  { sym: 'ALTR.SYN', name: 'Altair Glassworks', sector: 'Materials', price: 128.9, beta: 1.10, idio: 0.25, base: 43000 },
  { sym: 'DENB.SYN', name: 'Deneb Orchard Foods', sector: 'Consumer staples', price: 77.3, beta: 0.60, idio: 0.15, base: 57000 },
  { sym: 'RIGL.SYN', name: 'Rigel Comet Mining', sector: 'Materials', price: 6.42, beta: 1.50, idio: 0.60, base: 310000 },
  { sym: 'POLX.SYN', name: 'Polaris Ledger Bank', sector: 'Financials', price: 865.1, beta: 1.20, idio: 0.20, base: 9000 },
];
const SECTORS = [...new Set(UNIVERSE.map(u => u.sector))];
const MKT_VOL = 0.16, SECTOR_VOL = 0.08, GAP_FRAC = 0.35;

// U-shaped intraday profiles. w: volatility scale, mean(w^2) = 1.
// vp: volume scale, mean 1.
const W = new Float64Array(78), VP = new Float64Array(78);
{
  let s2 = 0, sv = 0;
  for (let b = 0; b < 78; b++) {
    W[b] = 1 + 0.9 * Math.exp(-b / 6) + 0.6 * Math.exp(-(77 - b) / 8);
    VP[b] = 1 + 2.2 * Math.exp(-b / 5) + 1.6 * Math.exp(-(77 - b) / 6);
    s2 += W[b] * W[b]; sv += VP[b];
  }
  const k = Math.sqrt(78 / s2);
  for (let b = 0; b < 78; b++) { W[b] *= k; VP[b] *= 78 / sv; }
}

// GARCH(1,1) on a standardised shock: h' = (1 - a - b) + a h e^2 + b h.
// The mean of h is 1, so the variance unit stays the base volatility.
function garch(a, b) {
  let h = 1;
  return { get h() { return h; }, step(e) { h = (1 - a - b) + a * h * e * e + b * h; if (h > 25) h = 25; } };
}

// One step of every ticker. sd: per-step volatilities. Returns log returns.
function stepper(R, unit, garchAB, jumpRate, jumpScale) {
  const n = UNIVERSE.length;
  const gm = garch(...garchAB), gi = UNIVERSE.map(() => garch(...garchAB));
  const sdM = MKT_VOL * unit, sdS = SECTOR_VOL * unit;
  const sdI = UNIVERSE.map(u => u.idio * unit);
  const sec = UNIVERSE.map(u => SECTORS.indexOf(u.sector));
  const sF = new Float64Array(SECTORS.length), out = new Float64Array(n), z = new Float64Array(n);
  return (scale) => {
    const em = R.n(); const m = sdM * scale * Math.sqrt(gm.h) * em; gm.step(em);
    for (let k = 0; k < sF.length; k++) sF[k] = sdS * scale * R.n();
    for (let i = 0; i < n; i++) {
      const ei = R.n(), u = UNIVERSE[i];
      let r = u.beta * m + 0.8 * sF[sec[i]] + sdI[i] * scale * Math.sqrt(gi[i].h) * ei;
      gi[i].step(ei);
      if (R.u() < jumpRate) r += (R.u() < 0.5 ? -1 : 1) * jumpScale * sdI[i] * (1 + Math.abs(R.n()));
      out[i] = r + 0.04 * unit * unit; // drift: 4 % a year (unit^2 = 1 / steps a year)
      z[i] = Math.abs(r) / ((u.beta * sdM + sdI[i]) * scale + 1e-12);
    }
    return { r: out, z };
  };
}

// Brownian bridge sub-steps: OHLC of one bar from open o and log return r.
function ohlc(R, o, r, sd, k, bar) {
  let x = 0, hi = 0, lo = 0;
  const inc = new Float64Array(k); let s = 0;
  for (let j = 0; j < k; j++) { inc[j] = R.n() * sd / Math.sqrt(k); s += inc[j]; }
  const fix = (s - r) / k;
  for (let j = 0; j < k; j++) { x += inc[j] - fix; if (x > hi) hi = x; if (x < lo) lo = x; }
  bar.o = o; bar.c = o * Math.exp(r); bar.h = o * Math.exp(hi); bar.l = o * Math.exp(lo);
}

// ── daily model ─────────────────────────────────────────────────────────────
function simDaily(R, nDays, logStart) {
  const n = UNIVERSE.length, unit = 1 / Math.sqrt(252);
  const step = stepper(R, unit, [0.07, 0.91], 1 / 60, 3.5);
  const rows = UNIVERSE.map(() => ({ o: new Float64Array(nDays), h: new Float64Array(nDays), l: new Float64Array(nDays), c: new Float64Array(nDays), v: new Float64Array(nDays) }));
  const px = logStart.map(x => Math.exp(x)), bar = {};
  for (let d = 0; d < nDays; d++) {
    const { r, z } = step(1);
    for (let i = 0; i < n; i++) {
      const sd = (UNIVERSE[i].beta * MKT_VOL + UNIVERSE[i].idio) * unit;
      // The open moves from the last close by the overnight part of r.
      const gap = GAP_FRAC * r[i];
      ohlc(R, px[i] * Math.exp(gap), r[i] - gap, sd, 8, bar);
      const w = rows[i];
      w.o[d] = bar.o; w.h[d] = Math.max(bar.h, bar.o); w.l[d] = Math.min(bar.l, bar.o); w.c[d] = bar.c;
      w.v[d] = Math.round(UNIVERSE[i].base * 78 * Math.exp(0.25 * R.n()) * (1 + 0.5 * z[i]));
      px[i] = bar.c;
    }
  }
  return rows;
}

// ── intraday model ──────────────────────────────────────────────────────────
function simIntraday(R, nSessions, nowBar, startPx) {
  const n = UNIVERSE.length, unit = 1 / Math.sqrt(252 * 78);
  const step = stepper(R, unit, [0.04, 0.95], 1 / 1500, 5);
  const total = (nSessions - 1) * 78 + nowBar;
  const rows = UNIVERSE.map(() => ({ o: new Float64Array(total), h: new Float64Array(total), l: new Float64Array(total), c: new Float64Array(total), v: new Float64Array(total) }));
  const px = startPx.slice(), bar = {};
  let k = 0;
  for (let s = 0; s < nSessions; s++) {
    const bars = s === nSessions - 1 ? nowBar : 78;
    for (let b = 0; b < bars; b++, k++) {
      const { r, z } = step(W[b]);
      for (let i = 0; i < n; i++) {
        let open = px[i];
        if (b === 0 && s > 0) {
          // Overnight gap: market part plus own part, about 0.35 of a day's sd.
          const sdDay = (UNIVERSE[i].beta * MKT_VOL + UNIVERSE[i].idio) / Math.sqrt(252);
          open *= Math.exp(GAP_FRAC * sdDay * R.n());
        }
        const sd = (UNIVERSE[i].beta * MKT_VOL + UNIVERSE[i].idio) * unit * W[b];
        ohlc(R, open, r[i], sd, 4, bar);
        const w = rows[i];
        w.o[k] = bar.o; w.h[k] = Math.max(bar.h, bar.o, bar.c); w.l[k] = Math.min(bar.l, bar.o, bar.c); w.c[k] = bar.c;
        w.v[k] = Math.round(UNIVERSE[i].base * VP[b] * Math.exp(0.35 * R.n()) * (1 + 0.6 * z[i]));
        px[i] = bar.c;
      }
    }
  }
  return rows;
}

const round = (x, p) => Math.round(x * p) / p;

// ── entry ───────────────────────────────────────────────────────────────────
// synthMarket({ seed, days, dailyYears, nowBar, today })
//   days        intraday sessions, today's partial session included
//   dailyYears  daily history length, 252 sessions per year
//   nowBar      bars in today's session (1..78), 38 = 12:40 ET
//   today       ms; the real date that sets the calendar (default now)
// Returns { universe, intraday: {sym: Series}, daily: {sym: Series}, clock }.
// The values depend on seed only; today only moves the time stamps.
export function synthMarket({ seed = 1, days = 30, dailyYears = 2, nowBar = 38, today = Date.now() } = {}) {
  nowBar = Math.max(1, Math.min(78, nowBar | 0));
  days = Math.max(2, days | 0);
  const R = rng(seed);
  const nDaily = Math.max(days + 5, Math.round(dailyYears * 252));
  const last = lastWeekday(today);
  const dates = weekdaysBack(last, nDaily);
  const preDays = nDaily - days;
  const daily = simDaily(R, preDays, UNIVERSE.map(u => Math.log(u.price)));
  const intra = simIntraday(R, days, nowBar, daily.map(d => d.c[preDays - 1]));
  const lastIdx = intra[0].c.length - 1;
  const opens = dates.map(q => sessionOpenUtc(q.y, q.m, q.d));
  const tIntra = new Float64Array(lastIdx + 1);
  for (let s = 0, k = 0; s < days; s++) {
    const bars = s === days - 1 ? nowBar : 78, t0 = opens[preDays + s];
    for (let b = 0; b < bars; b++) tIntra[k++] = t0 + b * BAR_MS;
  }
  const fetchedAt = Date.now();
  const clockMin = 9 * 60 + 30 + nowBar * 5;
  const clockLabel = `${String(Math.floor(clockMin / 60)).padStart(2, '0')}:${String(clockMin % 60).padStart(2, '0')} ET (simulated clock)`;
  const out = { universe: UNIVERSE.map(({ sym, name, sector }) => ({ sym, name, sector })), intraday: {}, daily: {}, clock: { nowBar, label: clockLabel, ms: opens[nDaily - 1] + nowBar * BAR_MS } };
  UNIVERSE.forEach((u, i) => {
    // Scale so that the last price is the nominal price level.
    const f = u.price / intra[i].c[lastIdx], p = u.price < 10 ? 1000 : 100;
    const I = intra[i];
    const io = I.o.map(x => round(x * f, p)), ic = I.c.map(x => round(x * f, p));
    const ih = I.h.map((x, k) => Math.max(round(x * f, p), io[k], ic[k])), il = I.l.map((x, k) => Math.min(round(x * f, p), io[k], ic[k]));
    const src = (interval) => ({
      id: 'synthetic', synthetic: true, fetchedAt,
      label: 'Synthetic · GBM + jumps + GARCH, not market data',
      note: `Seed ${seed}. Generated in the browser by a factor model with GARCH volatility and jumps. ` +
        (interval === '5min' ? `Today's session stops at the ${clockLabel}.` : `The last daily bar is today's partial session to the ${clockLabel}.`) +
        ' Weekdays only; market holidays are not removed.',
    });
    out.intraday[u.sym] = makeSeries({ sym: u.sym, name: u.name, interval: '5min', t: tIntra, o: io, h: ih, l: il, c: ic, v: I.v, source: src('5min') });
    // Daily: simulated days, then the intraday sessions folded into days.
    const D = daily[i], n = nDaily;
    const dt = new Float64Array(n), d_o = new Float64Array(n), d_h = new Float64Array(n), d_l = new Float64Array(n), d_c = new Float64Array(n), d_v = new Float64Array(n);
    for (let k = 0; k < preDays; k++) {
      dt[k] = opens[k]; d_o[k] = round(D.o[k] * f, p); d_c[k] = round(D.c[k] * f, p);
      d_h[k] = Math.max(round(D.h[k] * f, p), d_o[k], d_c[k]); d_l[k] = Math.min(round(D.l[k] * f, p), d_o[k], d_c[k]); d_v[k] = D.v[k];
    }
    for (let s = 0, k = 0; s < days; s++) {
      const bars = s === days - 1 ? nowBar : 78, j = preDays + s;
      dt[j] = opens[j]; d_o[j] = io[k]; d_h[j] = -Infinity; d_l[j] = Infinity; d_v[j] = 0;
      for (let b = 0; b < bars; b++, k++) { d_h[j] = Math.max(d_h[j], ih[k]); d_l[j] = Math.min(d_l[j], il[k]); d_v[j] += I.v[k]; d_c[j] = ic[k]; }
    }
    out.daily[u.sym] = makeSeries({ sym: u.sym, name: u.name, interval: '1day', t: dt, o: d_o, h: d_h, l: d_l, c: d_c, v: d_v, source: src('1day') });
  });
  return out;
}

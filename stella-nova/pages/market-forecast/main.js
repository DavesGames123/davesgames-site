// ============================================================================
//  MARKET FORECAST  ·  main.js — state, data, forecast runs, UI
// ----------------------------------------------------------------------------
//  Flow: boot() makes the WebGPU device (gfx.js), the price chart, and the
//  inference engine (engine.js -> worker.js). It reads the saved state,
//  loads the watchlist series from the chosen provider (synthetic demo by
//  default), and forecasts the selected ticker to the end of the session.
//
//  Horizon. 5-min bars: from the last bar to the 16:00 ET close of that
//  session; if the session is complete, the whole next session (78 bars).
//  Daily bars: 5, 10 or 20 sessions.
//
//  Replay (the scrubber). One batch forecast from earlier origins of the
//  same session (every 2nd bar), each to the close. Scrubbing shows the
//  fan from that origin over the bars that came after it.
//
//  Analysis. One batch forecast of all positions (Chronos-2: one group, so
//  the series are read jointly). analysis.portfolio joins the end-of-
//  horizon quantiles with a Gaussian copula (correlation from recent
//  returns) and gives P(up), the 80 % range, VaR and ES. Backtest: at the
//  same time of day on up to 20 earlier sessions, forecast to that close
//  and score it (analysis.backtest).
//
//  Storage. 'mf-state-v1' in localStorage: provider, interval, model,
//  horizon, watchlist rows (symbol, shares, cost basis), view. API keys are
//  only in providers.js keys ('mf-key-<provider>'), never in this state.
//
//  window.__mf: { ready, failed, state, last, selfTest() } for checks.
//
//  grep -n targets
//    boot .................. "async function boot"
//    horizon ............... "function horizonFor"
//    forecast .............. "async function runForecast"
//    replay ................ "async function runReplay"
//    analysis .............. "async function runAnalysis"
//    backtest .............. "async function runBacktest"
//    watchlist ............. "function renderWatch"
//    data source dialog .... "function openSource"
//    frame loop ............ "function loop"
//    phone sheet ........... "function sheetOcclusion"
//    self test ............. "async function selfTest"
//    screensaver ........... saver.js (installSaver, called in boot)
// ============================================================================
import { initGpu } from './gfx.js';
import { createPriceChart, fmtPrice, fmtTime, levelRow } from './chart.js';
import { createDistChart, createCalibChart } from './analysis-charts.js';
import { createEngine } from './engine.js';
import { MODELS } from './model-io.js';
import { PROVIDERS, keys } from './providers.js';
import { portfolio, corrMatrix, logReturns, backtest, quantileFn, normCdf } from './analysis.js';
import { etParts, sessionOpenUtc } from './synth.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const STORE = 'mf-state-v1';
const DEMO_LIST = [
  { sym: 'ORIN.SYN', shares: 40, cost: 0 }, { sym: 'VEGA.SYN', shares: 120, cost: 0 }, { sym: 'LYRA.SYN', shares: 15, cost: 0 },
  { sym: 'CYGN.SYN', shares: 0, cost: 0 }, { sym: 'ALTR.SYN', shares: 60, cost: 0 }, { sym: 'DENB.SYN', shares: 0, cost: 0 },
  { sym: 'RIGL.SYN', shares: 0, cost: 0 }, { sym: 'POLX.SYN', shares: 200, cost: 0 },
];
const params = new URLSearchParams(location.search);

const st = loadState();
const series = new Map();          // `${provider}|${sym}|${iv}` -> Series
const fcCache = new Map();         // key -> forecast
const mf = window.__mf = { ready: false, failed: null, state: st, last: {}, timings: [] };
let gpu = null, chart = null, dist = null, calib = null, engine = null;
let replay = null, playing = 0, runId = 0, needAnalysis = true;

function loadState() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { s = null; }
  const d = { provider: 'synthetic', interval: '5min', model: 'bolt-tiny', hz: 5, style: 'candles', view: 'chart', lists: { synthetic: DEMO_LIST.map(r => ({ ...r })) }, sel: { synthetic: 'ORIN.SYN' } };
  s = s && typeof s === 'object' ? { ...d, ...s, lists: { ...d.lists, ...(s.lists || {}) }, sel: { ...d.sel, ...(s.sel || {}) } } : d;
  if (!PROVIDERS[s.provider]) s.provider = 'synthetic';
  if (!MODELS[s.model]) s.model = 'bolt-tiny';
  if (params.get('model') && MODELS[params.get('model')]) s.model = params.get('model');
  if (params.get('view')) s.view = params.get('view') === 'analysis' ? 'analysis' : 'chart';
  return s;
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ provider: st.provider, interval: st.interval, model: st.model, hz: st.hz, style: st.style, view: st.view, lists: st.lists, sel: st.sel })); } catch (e) { /* private mode */ }
}
const list = () => (st.lists[st.provider] = st.lists[st.provider] || []);
const selSym = () => st.sel[st.provider] || (list()[0] && list()[0].sym);
const prov = () => PROVIDERS[st.provider];

let toastT = 0;
function toast(msg, ms = 3800) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }

// ── data ────────────────────────────────────────────────────────────────────
async function getSeries(sym, iv = st.interval) {
  const k = `${st.provider}|${sym}|${iv}`;
  if (series.has(k)) return series.get(k);
  const p = prov();
  const s = await p.fetchSeries(sym, iv, st.provider === 'synthetic' ? { seed: 1 } : { key: keys.get(st.provider) });
  series.set(k, s);
  return s;
}

// ── horizon and future times ────────────────────────────────────────────────
function nextWeekday(ms) {
  let t = ms;
  for (let k = 0; k < 7; k++) { t += 86400e3; const p = etParts(t); if (p.dow >= 1 && p.dow <= 5) return p; }
  return etParts(ms + 86400e3);
}
function horizonFor(s, origin = s.c.length - 1, days = st.hz) {
  const bar = s.session.barMs;
  if (s.interval === '1day') {
    const H = days, times = new Float64Array(H); let t = s.t[origin];
    for (let h = 0; h < H; h++) { const p = nextWeekday(t); t = sessionOpenUtc(p.y, p.m, p.d); times[h] = t; }
    return { H, times, endLabel: `close in ${H} sessions`, what: `the close in ${H} sessions` };
  }
  const p = etParts(s.t[origin]), close = sessionOpenUtc(p.y, p.m, p.d) + 390 * 60e3;
  const left = Math.round((close - (s.t[origin] + bar)) / bar);
  if (left >= 1) {
    const times = Float64Array.from({ length: left }, (_, h) => s.t[origin] + (h + 1) * bar);
    return { H: left, times, endLabel: '16:00 close', what: 'today’s 16:00 ET close', sameDay: true };
  }
  const q = nextWeekday(s.t[origin]), open = sessionOpenUtc(q.y, q.m, q.d);
  return { H: 78, times: Float64Array.from({ length: 78 }, (_, h) => open + h * bar), endLabel: 'next close', what: 'the next session’s close' };
}
const ctxRow = (s, origin, n) => s.c.subarray(Math.max(0, origin + 1 - n), origin + 1);
const ctxLenFor = m => (MODELS[m].kind === 'c2' ? 2048 : 2048);

// P(value at the end > x) from end quantiles (Gaussian-like tails, analysis.js)
function probAbove(levels, vals, x) {
  const f = quantileFn(levels, vals);
  let lo = -8, hi = 8;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f.atZ(m) < x) lo = m; else hi = m; }
  return 1 - normCdf((lo + hi) / 2);
}

// ── model status ────────────────────────────────────────────────────────────
const loaded = new Set();
async function ensureModel(m) {
  if (loaded.has(m)) return;
  const info = MODELS[m];
  setRun(`Loading <b>${info.label}</b>…`);
  await engine.load(m, p => {
    const pct = Math.min(1, p.loaded / p.total);
    const what = p.phase === 'download' ? 'Downloading weights from Hugging Face' : p.phase === 'cache' ? 'Reading weights from the browser cache' : p.phase === 'verify' ? 'Checking sha256' : 'Building the session';
    setRun(`${what} · <b>${info.label}</b> <span class="prog"><i style="width:${(pct * 100).toFixed(1)}%"></i></span> ${(p.loaded / 1e6).toFixed(1)} / ${(p.total / 1e6).toFixed(1)} MB`);
  });
  loaded.add(m);
}
function setRun(html) { $('runLine').innerHTML = html; }
function runText(r) {
  const t = r.timings, ep = r.ep === 'webgpu' ? 'WebGPU' : 'WASM (CPU)';
  return `Ran <b>${MODELS[r.model].label}</b> on <b>${ep}</b> in this browser · ${t.runMs} ms for ${t.calls} call${t.calls > 1 ? 's' : ''}${t.firstRun ? ` (first run; session ${t.createMs} ms${t.weightsMs ? `, weights ${t.weightsMs} ms` : ''})` : ''}${r.fallback ? ' · WebGPU failed, used WASM' : ''}`;
}

// ── forecast for the selected ticker ────────────────────────────────────────
async function runForecast() {
  const id = ++runId, sym = selSym();
  if (!sym) return;
  let s;
  try { s = await getSeries(sym); } catch (e) { toast(String(e.message || e)); return; }
  if (id !== runId) return;
  chart.setSeries(s); chart.setForecast(null); chart.setTrails([]);
  chart.setWindow(innerWidth < 600 ? (s.interval === '1day' ? 36 : 84) : (s.interval === '1day' ? 64 : 160));
  renderHead(s, null);
  const hz = horizonFor(s), origin = s.c.length - 1;
  try {
    await ensureModel(st.model);
    if (id !== runId) return;
    setRun(`Forecasting ${sym} to ${hz.what}…`);
    const r = await engine.forecast(st.model, [ctxRow(s, origin, ctxLenFor(st.model))], hz.H, [0]);
    if (id !== runId) return;
    const fc = { origin, H: hz.H, levels: r.levels, q: r.q[0], times: hz.times, model: MODELS[st.model].label, ep: r.ep === 'webgpu' ? 'WebGPU' : 'WASM', label: `Forecast to ${hz.what}`, endLabel: hz.endLabel };
    chart.setForecast(fc, { animate: true });
    mf.last.forecast = { sym, H: hz.H, ep: r.ep, timings: r.timings, end: { q10: levelRow(fc, 0.1)[hz.H - 1], q50: levelRow(fc, 0.5)[hz.H - 1], q90: levelRow(fc, 0.9)[hz.H - 1] } };
    mf.timings.push({ kind: 'forecast', model: st.model, ep: r.ep, ...r.timings });
    renderHead(s, fc); renderStats(s, fc, hz); setRun(runText(r));
    runReplay(id, s, hz).catch(e => { $('scrubL').textContent = 'Replay failed: ' + e.message; });
  } catch (e) {
    setRun(`<span class="dn">Forecast failed: ${esc(e.message || e)}</span>`);
  }
}

async function runReplay(id, s, hz0) {
  const last = s.c.length - 1;
  let origins = [];
  if (s.interval === '1day') { for (let k = Math.max(64, last - 24); k <= last; k++) origins.push(k); }
  else {
    const p = etParts(s.t[last]), open = sessionOpenUtc(p.y, p.m, p.d);
    let i0 = last; while (i0 > 0 && s.t[i0 - 1] >= open) i0--;
    // the session that holds the last bar; if it has few bars, the one before
    if (last - i0 < 6) { let j = i0 - 1; while (j > 0 && s.t[j] - s.t[j - 1] < 3 * 3600e3) j--; i0 = j; }
    for (let k = i0 + 4; k < last; k += 2) origins.push(k);
    origins.push(last);
  }
  origins = origins.slice(-36);
  $('scrubL').textContent = `Forecast replay: computing ${origins.length} origins…`;
  const Hs = origins.map(o => horizonFor(s, o));
  const Hmax = Math.max(...Hs.map(h => h.H));
  const r = await engine.forecast(st.model, origins.map(o => ctxRow(s, o, 1024)), Hmax, origins.map(() => 0).map((_, i) => i));
  if (id !== runId) return;
  mf.timings.push({ kind: 'replay', model: st.model, ep: r.ep, rows: origins.length, ...r.timings });
  replay = {
    s, origins,
    fcs: origins.map((o, i) => ({ origin: o, H: Hs[i].H, levels: r.levels, q: r.q[i].map(a => a.subarray(0, Hs[i].H)), times: Hs[i].times, endLabel: Hs[i].endLabel,
      model: MODELS[st.model].label, ep: r.ep === 'webgpu' ? 'WebGPU' : 'WASM', label: `Forecast as of ${fmtTime(s.t[o], s.interval, s.interval === '1day')}` })),
  };
  const R = $('scrubR'); R.max = String(origins.length - 1); R.value = R.max;
  showReplay(origins.length - 1, false);
  mf.last.replay = { n: origins.length, ms: r.timings.runMs, calls: r.timings.calls };
}
function showReplay(i, animate = true, fast = false) {
  if (!replay) return;
  const fc = replay.fcs[i], s = replay.s;
  chart.setForecast(fc, { animate, revealSec: fast ? 0.4 : 1.1 });
  chart.setTrails(replay.fcs.slice(0, i).map((f, k) => ({ origin: f.origin, median: levelRow(f, 0.5), alpha: 0.05 + 0.2 * (k + 1) / (i + 1) })));
  const isLast = i === replay.fcs.length - 1;
  $('scrubL').textContent = isLast ? `Forecast as of the last bar · ${fmtTime(s.t[fc.origin], s.interval, true)}${s.interval === '1day' ? '' : ' ET'}` : `Forecast as of ${fmtTime(s.t[fc.origin], s.interval, true)}${s.interval === '1day' ? '' : ' ET'} · drag to replay`;
  const hz = { H: fc.H, what: fc.endLabel };
  renderStats(s, fc, hz);
}

// ── header and stat cards ───────────────────────────────────────────────────
function prevCloseOf(s) {
  const n = s.c.length - 1;
  if (s.interval === '1day') return s.c[n - 1];
  for (let i = n; i > 0; i--) if (s.t[i] - s.t[i - 1] > 3 * 3600e3) return s.c[i - 1];
  return s.o[0];
}
function renderHead(s, fc) {
  const n = s.c.length - 1, last = s.c[n], prev = prevCloseOf(s), ch = last - prev, pc = ch / prev * 100;
  $('hSym').textContent = s.sym; $('hName').textContent = s.name || '';
  $('hPrice').textContent = fmtPrice(last);
  const c = $('hChg'); c.className = 'chg ' + (ch >= 0 ? 'up' : 'dn');
  c.textContent = `${ch >= 0 ? '+' : ''}${Math.abs(ch) >= 1000 ? fmtPrice(ch) : ch.toFixed(2)}  (${pc >= 0 ? '+' : ''}${pc.toFixed(2)}%) ${s.interval === '1day' ? 'last session' : 'today'}`;
  const src = s.source || {};
  $('hMeta').innerHTML = `<b>${esc(src.label || '')}</b><br>Last bar ${fmtTime(s.t[n], s.interval, true)}${s.interval === '1day' ? '' : ' ET'} · fetched ${new Date(src.fetchedAt || Date.now()).toLocaleTimeString()}`;
}
function renderStats(s, fc, hz) {
  const e = fc.H - 1, base = s.c[fc.origin];
  const q10 = levelRow(fc, 0.1)[e], q50 = levelRow(fc, 0.5)[e], q90 = levelRow(fc, 0.9)[e];
  const pUp = probAbove(fc.levels, fc.levels.map((_, j) => fc.q[j][e]), base);
  const pct = v => `${v >= base ? '+' : ''}${((v / base - 1) * 100).toFixed(2)}%`;
  const span = Math.max(q90 - base, base - q10) * 1.25 || 1, at = v => 50 + (v - base) / span * 50;
  $('stats').innerHTML = `
    <div class="card"><div class="k">P(above now)</div><div class="v ${pUp >= 0.5 ? 'up' : 'dn'}">${(pUp * 100).toFixed(0)}%</div><div class="s">at ${esc(fc.endLabel || 'the end')} · model, not a signal</div></div>
    <div class="card"><div class="k">Median at ${esc(fc.endLabel || 'end')}</div><div class="v">${fmtPrice(q50)}</div><div class="s ${q50 >= base ? 'up' : 'dn'}">${pct(q50)} from ${fmtPrice(base)}</div></div>
    <div class="card"><div class="k">80% range</div><div class="v sm">${fmtPrice(q10)} – ${fmtPrice(q90)}</div><div class="bar80"><i style="left:${at(q10)}%;right:${100 - at(q90)}%"></i><b style="left:${at(base)}%"></b></div></div>
    <div class="card"><div class="k">Horizon</div><div class="v">${fc.H} ${s.interval === '1day' ? 'sessions' : 'bars'}</div><div class="s">${s.interval === '1day' ? 'daily closes' : '5-min bars to ' + esc(fc.endLabel || '')}</div></div>`;
}

// ── watchlist ───────────────────────────────────────────────────────────────
function esc(t) { return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
async function renderWatch() {
  const box = $('watch'), L = list(), sel = selSym();
  box.innerHTML = L.map(r => `<div class="row${r.sym === sel ? ' on' : ''}" data-sym="${esc(r.sym)}" role="listitem">
    <div class="s">${esc(r.sym)}</div><div class="p">—</div><div class="c">—</div><div class="n">${r.shares ? `${r.shares} sh` : 'watching'}</div><canvas class="spark"></canvas>
    <div class="pos"><label>Shares<input type="number" min="0" step="any" data-f="shares" value="${r.shares || ''}" placeholder="0"></label><label>Cost basis<input type="number" min="0" step="any" data-f="cost" value="${r.cost || ''}" placeholder="per share"></label><button class="rm" title="Remove">✕</button></div></div>`).join('');
  let total = 0, totalPrev = 0;
  for (const r of L) {
    const row = box.querySelector(`.row[data-sym="${CSS.escape(r.sym)}"]`);
    let s; try { s = await getSeries(r.sym); } catch (e) { row.querySelector('.n').textContent = 'no data: ' + (e.kind || 'error'); continue; }
    const n = s.c.length - 1, prev = prevCloseOf(s), ch = (s.c[n] / prev - 1) * 100;
    row.querySelector('.p').textContent = fmtPrice(s.c[n]);
    const c = row.querySelector('.c'); c.textContent = `${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%`; c.className = 'c ' + (ch >= 0 ? 'up' : 'dn');
    if (!r.shares) row.querySelector('.n').textContent = s.name || r.sym;
    else row.querySelector('.n').textContent = `${r.shares} sh · ${fmtPrice(r.shares * s.c[n])}`;
    spark(row.querySelector('canvas'), s, prev);
    total += (r.shares || 0) * s.c[n]; totalPrev += (r.shares || 0) * prev;
  }
  $('pfNow').textContent = total ? '$' + fmtPrice(total) : '—';
  const pc = totalPrev ? (total / totalPrev - 1) * 100 : 0;
  $('pfChg').textContent = total ? `${pc >= 0 ? '+' : ''}${pc.toFixed(2)}%` : '';
  $('pfChg').className = pc >= 0 ? 'up' : 'dn';
}
function spark(cv, s, prev) {
  const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.max(1, r.width * d); cv.height = Math.max(1, r.height * d);
  const g = cv.getContext('2d'), n = s.c.length, k0 = Math.max(0, n - (s.interval === '1day' ? 60 : 78));
  let lo = Infinity, hi = -Infinity; for (let i = k0; i < n; i++) { lo = Math.min(lo, s.c[i]); hi = Math.max(hi, s.c[i]); }
  lo = Math.min(lo, prev); hi = Math.max(hi, prev);
  const X = i => (i - k0) / Math.max(1, n - 1 - k0) * cv.width, Y = v => (1 - (v - lo) / (hi - lo || 1)) * (cv.height - 2 * d) + d;
  const up = s.c[n - 1] >= prev, col = up ? '43,214,133' : '255,97,112';
  g.setLineDash([2 * d, 3 * d]); g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = d; g.beginPath(); g.moveTo(0, Y(prev)); g.lineTo(cv.width, Y(prev)); g.stroke(); g.setLineDash([]);
  const grad = g.createLinearGradient(0, 0, 0, cv.height); grad.addColorStop(0, `rgba(${col},.28)`); grad.addColorStop(1, `rgba(${col},0)`);
  g.beginPath(); for (let i = k0; i < n; i++) g[i === k0 ? 'moveTo' : 'lineTo'](X(i), Y(s.c[i])); g.lineTo(X(n - 1), cv.height); g.lineTo(0, cv.height); g.closePath(); g.fillStyle = grad; g.fill();
  g.beginPath(); for (let i = k0; i < n; i++) g[i === k0 ? 'moveTo' : 'lineTo'](X(i), Y(s.c[i])); g.strokeStyle = `rgb(${col})`; g.lineWidth = 1.4 * d; g.stroke();
}
function bindWatch() {
  $('watch').addEventListener('click', e => {
    const row = e.target.closest('.row'); if (!row) return;
    if (e.target.closest('.pos')) {
      if (e.target.classList.contains('rm')) { st.lists[st.provider] = list().filter(r => r.sym !== row.dataset.sym); if (selSym() === row.dataset.sym) st.sel[st.provider] = list()[0]?.sym; save(); renderWatch(); runForecast(); needAnalysis = true; }
      return;
    }
    if (row.dataset.sym === selSym()) return;
    st.sel[st.provider] = row.dataset.sym; save();
    $('watch').querySelectorAll('.row').forEach(r => r.classList.toggle('on', r === row));
    runForecast(); needAnalysis = true;
    if (st.view === 'analysis') runAnalysis();
  });
  $('watch').addEventListener('change', e => {
    const inp = e.target.closest('input[data-f]'); if (!inp) return;
    const row = inp.closest('.row'), r = list().find(x => x.sym === row.dataset.sym); if (!r) return;
    r[inp.dataset.f] = Math.max(0, parseFloat(inp.value) || 0); save(); needAnalysis = true;
    renderWatch(); if (st.view === 'analysis') runAnalysis();
  });
  $('addForm').addEventListener('submit', async e => {
    e.preventDefault();
    const sym = $('addSym').value.trim().toUpperCase().replace(/[^A-Z0-9.\-^]/g, '');
    if (!sym || list().some(r => r.sym === sym)) return;
    try { await getSeries(sym); } catch (err) { toast(`${sym}: ${err.message || err}`); return; }
    list().push({ sym, shares: 0, cost: 0 }); st.sel[st.provider] = sym; save(); $('addSym').value = '';
    renderWatch(); runForecast(); needAnalysis = true;
  });
}

// ── analysis ────────────────────────────────────────────────────────────────
async function runAnalysis() {
  const id = runId;
  const pos = list().filter(r => r.shares > 0);
  const pfCards = $('pfCards');
  if (!pos.length) { pfCards.innerHTML = '<div class="card"><div class="k">No positions</div><div class="s">Open a watchlist row and type a share count.</div></div>'; return; }
  pfCards.innerHTML = '<div class="card"><div class="k">Running</div><div class="v">…</div></div>';
  let ss;
  try { ss = await Promise.all(pos.map(r => getSeries(r.sym))); } catch (e) { toast(String(e.message || e)); return; }
  await ensureModel(st.model);
  const s0 = ss[0], hz = horizonFor(s0);
  const joint = MODELS[st.model].kind === 'c2';
  const rows = ss.map(s => ctxRow(s, s.c.length - 1, ctxLenFor(st.model)));
  const r = await engine.forecast(st.model, rows, hz.H, joint ? rows.map(() => 0) : rows.map((_, i) => i));
  if (id !== runId && false) return;
  mf.timings.push({ kind: 'portfolio', model: st.model, ep: r.ep, rows: rows.length, ...r.timings });
  // correlation of recent log returns, aligned at the newest bar
  const look = s0.interval === '1day' ? 250 : 780;
  const rets = ss.map(s => logReturns(s.c.subarray(Math.max(0, s.c.length - look - 1))));
  const corr = pos.length > 1 ? corrMatrix(rets, 0.1) : null;
  const positions = pos.map((p, i) => ({ sym: p.sym, shares: p.shares, price: ss[i].c[ss[i].c.length - 1], costBasis: p.cost || null, levels: r.levels, endQ: r.levels.map((_, j) => r.q[i][j][hz.H - 1]) }));
  const res = portfolio({ positions, corr, n: 20000, seed: 7, compareIndependent: true });
  mf.last.portfolio = { now: res.now, pUp: res.pUp, var95: res.var95, es95: res.es95, q: res.q, indep: res.indep ? { pUp: res.indep.pUp, var95: res.indep.var95 } : null, joint, ep: r.ep, ms: r.timings.runMs };
  const money = v => '$' + fmtPrice(v), pct = v => `${v >= res.now ? '+' : ''}${((v / res.now - 1) * 100).toFixed(2)}%`;
  $('anHorizon').textContent = hz.what;
  $('anNote').innerHTML = `${pos.length} positions · ${esc(MODELS[st.model].label)} on ${r.ep === 'webgpu' ? 'WebGPU' : 'WASM'} · ${joint ? 'Chronos-2 reads the positions as one group (joint), then' : 'each ticker forecast on its own, then'} a Gaussian copula with the correlation of the last ${s0.interval === '1day' ? '250 daily' : '780 five-minute'} returns (shrunk 10% to independence) joins the end values. The copula is an assumption; it has no tail dependence. ${r.timings.runMs} ms.`;
  const ind = res.indep;
  pfCards.innerHTML = `
    <div class="card"><div class="k">Value now</div><div class="v">${money(res.now)}</div><div class="s">${pos.length} positions</div></div>
    <div class="card"><div class="k">Median at the close</div><div class="v">${money(res.q.p50)}</div><div class="s ${res.q.p50 >= res.now ? 'up' : 'dn'}">${pct(res.q.p50)}</div></div>
    <div class="card"><div class="k">P(portfolio up)</div><div class="v ${res.pUp >= 0.5 ? 'up' : 'dn'}">${(res.pUp * 100).toFixed(0)}%</div><div class="s">independent: ${ind ? (ind.pUp * 100).toFixed(0) + '%' : '—'}</div></div>
    <div class="card"><div class="k">80% range</div><div class="v sm">${pct(res.q.p10)} / ${pct(res.q.p90)}</div><div class="s">${money(res.q.p10)} – ${money(res.q.p90)}</div></div>
    <div class="card"><div class="k">VaR 95% to the close</div><div class="v dn">${money(Math.max(0, res.var95))}</div><div class="s">independent: ${ind ? money(Math.max(0, ind.var95)) : '—'}</div></div>
    <div class="card"><div class="k">Expected shortfall 95%</div><div class="v dn">${money(res.es95)}</div><div class="s">mean loss in the worst 5%</div></div>`;
  const hist = res.histogram(64), hi2 = ind ? ind.histogram(64, hist.lo, hist.hi) : null;
  dist.set({ edges: hist.edges, counts: hist.counts, indep: hi2, now: res.now, q: res.q, label: `Total value at ${hz.what} · 20,000 copula draws`, source: srcLine(s0) });
  $('distSub').textContent = `${hz.H} ${s0.interval === '1day' ? 'sessions' : 'bars'} ahead`;
  $('posTable').innerHTML = `<tr><th>Symbol</th><th>Value</th><th>P(up)</th><th>10–90% at end</th><th>Median</th>${pos.some(p => p.cost) ? '<th>vs cost</th>' : ''}<th>Risk share</th></tr>` +
    res.perPos.map((p, i) => {
      const sh = positions[i].shares, lo = p.q10 / sh, md = p.q50 / sh, hi = p.q90 / sh, px = positions[i].price;
      const span = Math.max(hi - px, px - lo) * 1.2 || 1, at = v => 50 + (v - px) / span * 50;
      const cost = positions[i].costBasis;
      return `<tr><td><b>${esc(p.sym)}</b></td><td>${money(p.now)}</td><td class="${p.pUp >= 0.5 ? 'up' : 'dn'}">${(p.pUp * 100).toFixed(0)}%</td>
        <td><span class="mini"><i style="left:${at(lo)}%;right:${100 - at(hi)}%"></i><b style="left:${at(px)}%"></b></span><small>${fmtPrice(lo)} – ${fmtPrice(hi)}</small></td><td>${fmtPrice(md)}</td>
        ${pos.some(q => q.cost) ? `<td class="${cost && md >= cost ? 'up' : 'dn'}">${cost ? ((md / cost - 1) * 100).toFixed(1) + '%' : '—'}</td>` : ''}<td>${(p.contrib * 100).toFixed(0)}%</td></tr>`;
    }).join('');
  needAnalysis = false;
  runBacktest().catch(e => { $('btCards').innerHTML = `<div class="card"><div class="k">Backtest failed</div><div class="s">${esc(e.message)}</div></div>`; });
}
function srcLine(s) { const src = s.source || {}, t = src.asOf || s.t[s.t.length - 1]; return `${src.label || ''} · as of ${s.interval === '1day' ? fmtTime(t, '1day') + ' (daily bar)' : fmtTime(t, s.interval, true) + ' ET'}`; }

async function runBacktest() {
  const sym = selSym(), s = await getSeries(sym), n = s.c.length - 1;
  let origins = [], H;
  if (s.interval === '1day') {
    H = st.hz;
    for (let k = n - H; k > 300 && origins.length < 20; k -= Math.max(1, Math.round(H / 2))) origins.unshift(k);
  } else {
    // same time of day as the last bar, on earlier sessions, to that close
    const hz = horizonFor(s); H = hz.sameDay ? hz.H : 40;
    const starts = []; for (let i = 1; i <= n; i++) if (s.t[i] - s.t[i - 1] > 3 * 3600e3) starts.push(i);
    const off = hz.sameDay ? 78 - H - 1 : 37;
    for (const st0 of starts) { const o = st0 + off; if (o + H <= n && o > 200) origins.push(o); }
    origins = origins.slice(-20);
  }
  if (!origins.length) { $('btCards').innerHTML = '<div class="card"><div class="k">Backtest</div><div class="s">Not enough history.</div></div>'; return; }
  $('btSub').textContent = `${sym} · ${origins.length} origins · ${H} ${s.interval === '1day' ? 'sessions' : 'bars'} ahead each`;
  const r = await engine.forecast(st.model, origins.map(o => ctxRow(s, o, 1024)), H, origins.map((_, i) => i));
  mf.timings.push({ kind: 'backtest', model: st.model, ep: r.ep, rows: origins.length, ...r.timings });
  const bt = backtest({ closes: s.c, origins, H, levels: r.levels, forecasts: r.q, season: s.interval === '1day' ? 5 : 78 });
  mf.last.backtest = { sym, n: bt.n, coverage80: bt.coverage80, coverage80End: bt.coverage80End, wqlModel: bt.wqlModel, wqlNaive: bt.wqlNaive, wqlSeasonal: bt.wqlSeasonal, skillNaive: bt.skillNaive };
  const cov = v => `${(v * 100).toFixed(0)}%`, good = v => (v >= 0.7 && v <= 0.9 ? 'up' : 'dn');
  const sk = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  $('btCards').innerHTML = `
    <div class="card"><div class="k">Inside the 80% band</div><div class="v ${good(bt.coverage80)}">${cov(bt.coverage80)}</div><div class="s">all ${bt.steps} steps · target 80%</div></div>
    <div class="card"><div class="k">Close inside the band</div><div class="v ${good(bt.coverage80End)}">${cov(bt.coverage80End)}</div><div class="s">last step of ${bt.n} origins</div></div>
    <div class="card"><div class="k">Quantile loss (WQL)</div><div class="v">${bt.wqlModel.toFixed(4)}</div><div class="s">naive ${bt.wqlNaive.toFixed(4)} · seasonal ${bt.wqlSeasonal.toFixed(4)}</div></div>
    <div class="card"><div class="k">Skill vs naive</div><div class="v ${bt.skillNaive >= 0 ? 'up' : 'dn'}">${sk(bt.skillNaive)}</div><div class="s">1 − WQL/naive · seasonal ${sk(bt.skillSeasonal)}</div></div>`;
  calib.set({ perOrigin: bt.perOrigin, base: s.c, label: `${sym} · forecast 10–90% at the horizon end vs the realised value`, source: srcLine(s), axis: s.interval === '1day' ? 'origins (sessions), oldest left' : 'earlier sessions at the same time of day, oldest left' });
  drawReliability(bt.reliability);
}
function drawReliability(rel) {
  const S = 160, p = 18, X = v => p + v * (S - 2 * p), Y = v => S - p - v * (S - 2 * p);
  const pts = rel.map(r => `${X(r.tau).toFixed(1)},${Y(r.observed).toFixed(1)}`).join(' ');
  $('relSvg').innerHTML = `<rect x="${p}" y="${p}" width="${S - 2 * p}" height="${S - 2 * p}" fill="none" stroke="rgba(255,255,255,.08)"/>
    <line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke="rgba(255,255,255,.25)" stroke-dasharray="3 3"/>
    <polyline points="${pts}" fill="none" stroke="#79acff" stroke-width="1.6"/>
    ${rel.map(r => `<circle cx="${X(r.tau)}" cy="${Y(r.observed)}" r="2.6" fill="#cfe2ff"/>`).join('')}
    <text x="${S / 2}" y="${S - 4}" fill="#7f8b9d" font-size="8" text-anchor="middle">forecast level</text>
    <text x="7" y="${S / 2}" fill="#7f8b9d" font-size="8" text-anchor="middle" transform="rotate(-90 7 ${S / 2})">observed share</text>`;
}

// ── data source dialog ──────────────────────────────────────────────────────
function openSource() {
  const dlg = $('srcDlg');
  $('provList').innerHTML = Object.values(PROVIDERS).map(p => `<label><input type="radio" name="prov" value="${p.id}" ${p.id === st.provider ? 'checked' : ''}><b>${esc(p.label)}</b><small>${esc(p.limits || '')}${p.keyUrl ? ` · <a href="${p.keyUrl}" target="_blank" rel="noopener">get a free key</a>` : ''}</small></label>`).join('');
  const sync = () => {
    const id = dlg.querySelector('input[name=prov]:checked').value, p = PROVIDERS[id];
    $('keyRow').hidden = !p.needsKey; $('keyFor').textContent = p.label;
    $('keyIn').value = keys.get(id) || ''; $('keyIn').type = 'password'; $('keyShow').textContent = 'Show';
    $('keyNote').textContent = p.needsKey ? `Requests go to ${p.id === 'twelvedata' ? 'api.twelvedata.com' : p.id === 'alphavantage' ? 'www.alphavantage.co' : 'api.polygon.io'} only. Free tiers are rate limited and may be delayed.` : '';
  };
  $('provList').insertAdjacentHTML('beforeend', `<div class="mdl"><b>Model</b><select id="modelSel2">${Object.values(MODELS).map(m => `<option value="${m.id}" ${m.id === st.model ? 'selected' : ''}>${esc(m.label)} · ${m.weights ? (m.weights.bytes / 1e6).toFixed(0) + ' MB from Hugging Face' : 'bundled'}</option>`).join('')}</select></div>`);
  $('provList').onchange = e => { if (e.target.id !== 'modelSel2') sync(); }; sync();
  $('keyShow').onclick = () => { const k = $('keyIn'); k.type = k.type === 'password' ? 'text' : 'password'; $('keyShow').textContent = k.type === 'password' ? 'Show' : 'Hide'; };
  $('keyClear').onclick = () => { const id = dlg.querySelector('input[name=prov]:checked').value; keys.clear(id); $('keyIn').value = ''; toast('Key removed from this browser.'); };
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const m2 = $('modelSel2') && $('modelSel2').value;
    if (m2 && m2 !== st.model) { st.model = m2; $('modelSel').value = m2; needAnalysis = true; if (dlg.querySelector('input[name=prov]:checked').value === st.provider) { save(); runForecast(); if (st.view === 'analysis') runAnalysis(); return; } }
    const id = dlg.querySelector('input[name=prov]:checked').value, p = PROVIDERS[id];
    if (p.needsKey) { const k = $('keyIn').value.trim(); if (!k) { toast('This provider needs your own free API key.'); return; } keys.set(id, k); }
    st.provider = id; st.lists[id] = st.lists[id] || (id === 'synthetic' ? DEMO_LIST.map(r => ({ ...r })) : [{ sym: 'AAPL', shares: 0, cost: 0 }]);
    save(); series.clear(); replay = null; needAnalysis = true; syncSourceChip();
    renderWatch(); runForecast(); if (st.view === 'analysis') runAnalysis();
  };
  dlg.showModal();
}
function syncSourceChip() {
  const p = prov(), b = $('srcBtn');
  b.classList.toggle('live', st.provider !== 'synthetic');
  b.querySelector('span').textContent = st.provider === 'synthetic' ? 'Demo · synthetic' : p.label;
}

// ── views, controls ─────────────────────────────────────────────────────────
function setView(v) {
  st.view = v; save();
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === v));
  $('chartView').hidden = v !== 'chart'; $('analysisView').hidden = v !== 'analysis';
  if (v === 'analysis') { dist.resize(); calib.resize(); if (needAnalysis) runAnalysis(); }
  else chart.resize();
}
function bindControls() {
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { setView(b.dataset.mode); closeSheet(); }));
  $('ivSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.interval = b.dataset.iv; save(); needAnalysis = true; syncSegs(); renderWatch(); runForecast(); if (st.view === 'analysis') runAnalysis();
  });
  $('hzSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st.hz = +b.dataset.hz; save(); needAnalysis = true; syncSegs(); runForecast(); if (st.view === 'analysis') runAnalysis(); });
  $('styleSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st.style = b.dataset.st; save(); chart.setMode(st.style); syncSegs(); });
  $('modelSel').value = st.model;
  $('modelSel').addEventListener('change', e => { st.model = e.target.value; save(); needAnalysis = true; runForecast(); if (st.view === 'analysis') runAnalysis(); });
  $('srcBtn').addEventListener('click', openSource); $('dockSrc').addEventListener('click', openSource);
  $('aboutBtn').addEventListener('click', () => $('aboutDlg').showModal());
  $('scrubR').addEventListener('input', e => { stopPlay(); showReplay(+e.target.value, true, true); });
  $('playBtn').addEventListener('click', () => (playing ? stopPlay() : startPlay()));
  $('dockList').addEventListener('click', () => { $('side').classList.toggle('open'); $('dockList').classList.toggle('on', $('side').classList.contains('open')); });
  $('sheetGrip').addEventListener('click', () => $('side').classList.toggle('full'));
  let y0 = null;
  $('sheetGrip').addEventListener('pointerdown', e => { y0 = e.clientY; });
  addEventListener('pointerup', e => { if (y0 !== null && e.clientY - y0 > 60) closeSheet(); y0 = null; });
}
function closeSheet() { $('side').classList.remove('open', 'full'); $('dockList').classList.remove('on'); }
function syncSegs() {
  document.querySelectorAll('#ivSeg button').forEach(b => b.classList.toggle('on', b.dataset.iv === st.interval));
  document.querySelectorAll('#hzSeg button').forEach(b => b.classList.toggle('on', +b.dataset.hz === st.hz));
  document.querySelectorAll('#styleSeg button').forEach(b => b.classList.toggle('on', b.dataset.st === st.style));
  $('hzSeg').hidden = st.interval !== '1day';
}
function startPlay() {
  if (!replay) return;
  const R = $('scrubR'); let i = 0;
  $('playBtn').classList.add('on');
  showReplay(0, true, true); R.value = '0';
  playing = setInterval(() => {
    i++;
    if (i >= replay.fcs.length) { stopPlay(); return; }
    R.value = String(i); showReplay(i, true, true);
  }, 650);
}
function stopPlay() { if (playing) clearInterval(playing); playing = 0; $('playBtn').classList.remove('on'); }

// The phone sheet covers the lower part of the chart: keep the plot clear.
function sheetOcclusion() {
  const side = $('side'), box = $('chartBox');
  if (getComputedStyle(side).position !== 'fixed') return 0;
  const a = side.getBoundingClientRect(), b = box.getBoundingClientRect();
  if (a.top >= innerHeight - 2) return 0;
  return Math.max(0, Math.min(b.bottom, a.bottom) - Math.max(b.top, a.top));
}

// ── frame loop ──────────────────────────────────────────────────────────────
let lastDraw = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (document.hidden || mf.saverOn) return;
  const t = now / 1000;
  if (st.view === 'chart') {
    const occ = sheetOcclusion();
    chart.setInsets({ top: 0, bottom: occ });
    if (chart.busy() || now - lastDraw > 90 || occ) { chart.frame(t); lastDraw = now; }
  } else {
    if (dist.busy() || now - lastDraw > 250) { dist.frame(t); calib.frame(t); lastDraw = now; }
  }
}

// ── self test (browser): bundled model vs the PyTorch reference ────────────
async function selfTest() {
  const fx = await (await fetch(new URL('./tools/fixtures.json', import.meta.url))).json();
  const out = {};
  for (const [m, key, refKey] of [['bolt-tiny', 'bolt2unroll', 'ref'], ['bolt-tiny', 'bolt1', 'ref']]) {
    const c = fx[key], rows = c.rows.map(r => Float64Array.from(r, v => (v === null ? NaN : v)));
    await ensureModel(m);
    const r = await engine.forecast(m, rows, c.H, c.groups);
    const [B, Q, H] = c.refDims; let d = 0, span = 0;
    for (let b = 0; b < B; b++) for (let j = 0; j < Q; j++) for (let h = 0; h < H; h++) d = Math.max(d, Math.abs(r.q[b][j][h] - c[refKey][(b * Q + j) * H + h]));
    for (const row of rows) { const v = [...row].filter(x => x === x); span = Math.max(span, Math.max(...v) - Math.min(...v)); }
    out[`${m}:${key}`] = { ep: r.ep, maxAbs: d, relRange: d / span, ms: r.timings.runMs };
  }
  return out;
}

// ── boot ────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    gpu = await initGpu();
    chart = createPriceChart($('chartBox'), gpu);
    dist = createDistChart($('distBox'), gpu);
    calib = createCalibChart($('calibBox'), gpu);
    chart.setMode(st.style);
    mf.gfx = chart.view.backend;
    engine = createEngine({ ep: params.get('ep') || 'auto' });
    mf.engine = engine;
    installSaver({ gpu, engine, ensureModel, horizonFor, mf, onExit: () => { chart.resize(); dist.resize(); calib.resize(); } });
    bindControls(); bindWatch(); syncSegs(); syncSourceChip();
    addEventListener('resize', () => { chart.resize(); dist.resize(); calib.resize(); });
    requestAnimationFrame(loop);
    const info = await engine.ready;
    mf.engineInfo = info;
    await renderWatch();
    setView(st.view);
    await runForecast();
    mf.ready = true;
  } catch (e) {
    mf.failed = String(e && e.stack || e);
    setRun(`<span class="dn">Start failed: ${esc(e.message || e)}</span>`);
    console.error(e);
  }
}
mf.selfTest = selfTest;
mf.api = { runForecast, runAnalysis, showReplay, setView, get chart() { return chart; }, get dist() { return dist; }, get calib() { return calib; }, get replay() { return replay; }, getSeries, horizonFor, list, selSym, st };
boot();

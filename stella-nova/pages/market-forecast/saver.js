// ============================================================================
//  SCREENSAVER HOOK  ·  market-forecast/saver.js — window.snSaver
// ----------------------------------------------------------------------------
//  The shell screensaver (lib/screensaver.js) calls snSaver.enter(opts),
//  opts = { calm 0..1, seconds, caption, seed, label }. The hook hides the
//  page, puts one stage canvas in the document, and plays a seeded shuffle
//  of shots. It uses the real IEX snapshot (data/live/iex.json, else the
//  dated committed sample; no key, same origin) and Chronos-Bolt Tiny
//  (bundled). The seed picks the order and the tickers.
//
//  Shots (each one forecast or computed live, in the worker):
//    fan        a ticker with its fan unfurling to the close (5-min) or N
//               sessions ahead (daily); the window pushes in slowly
//    replay     the same session replayed: origins every 2nd bar, each fan
//               to the close, leaving median trails (forecast history)
//    portfolio  4-6 tickers, the copula distribution of the total value
//               forming bar by bar
//    backtest   20 earlier sessions at the same time of day, the 10-90 %
//               band per origin and the realised close sweeping in
//  Each shot holds 5-8 s at calm 0 and 8-12 s at calm 1. A cut fades the
//  stage through black. All scenes draw into one view (one WebGPU canvas
//  plus its text overlay), framed in the plate's clear band (plateBand,
//  lib/saver-clear.js), read 4 times a second.
//  The plate gets the title, the series and its forecast numbers (all
//  with the source line), and a short code extract read at run time from the
//  page's own source files.
//  snSaver.debug() returns the director state for CDP probes.
//
//  grep -n targets: "export function installSaver", "async function makeShot",
//  "function fitStage", "function codeFrom"
// ============================================================================
import { createView } from './gfx.js';
import { createPriceChart, levelRow, fmtPrice, fmtTime } from './chart.js';
import { createDistChart, createCalibChart } from './analysis-charts.js';
import { PROVIDERS } from './providers.js';
import { portfolio, corrMatrix, logReturns, backtest } from './analysis.js';
import { MODELS } from './model-io.js';
import { plateBand } from '../../lib/saver-clear.js';

const SRC = new Map();
async function codeFrom(file, needle, n, lang, name) {
  try {
    if (!SRC.has(file)) SRC.set(file, await (await fetch(new URL('./' + file, import.meta.url))).text());
    const lines = SRC.get(file).split('\n'), i = lines.findIndex(l => l.includes(needle));
    if (i < 0) return null;
    const pick = lines.slice(i, i + n), ind = Math.min(...pick.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
    return { lang, name, text: pick.map(l => l.slice(ind)).join('\n') };
  } catch (e) { return null; }
}

export function installSaver(ctx) {
  const { gpu, engine, ensureModel, horizonFor, mf } = ctx;
  let D = null;   // director state while on

  // mulberry32: an LCG here gave the same ticker in 4 of 5 shots
  function lcg(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function fitStage() {
    const box = D.box, W = innerWidth, H = innerHeight;
    const now = performance.now();
    if (now - D.bandAt > 250) { D.bandAt = now; D.band = plateBand(H); }
    const b = D.band;
    const t = b ? b.t : H * 0.08, bot = b ? b.b : H * 0.08;
    const colW = b ? Math.min(W, b.w) : W, w = Math.min(colW * 0.92, 1500);
    const h = Math.max(160, H - t - bot);
    const key = `${t}|${h}|${w}`;
    if (key !== D.boxKey) {
      D.boxKey = key;
      Object.assign(box.style, { top: t + 'px', height: h + 'px', width: w + 'px', left: (W - w) / 2 + 'px' });
      D.view.resize();
    }
  }

  async function makeShot(type0) {
    let type = type0;
    const R = D.rnd, M = D.market, U = M.universe;
    let sym = U[Math.floor(R() * U.length)].sym;
    if (D.shot && sym === D.shot.sym) sym = U[(U.findIndex(u => u.sym === sym) + 1 + Math.floor(R() * (U.length - 1))) % U.length].sym;
    const calm = D.calm;
    const shot = { type, sym, t0: 0, dur: (5 + 3 * calm + (3 + calm) * R()) * 1000 };
    const model = 'bolt-tiny', label = MODELS[model].label;
    if (type === 'backtest' && !M.intraday[sym]) type = shot.type = 'fan';
    if (type === 'fan' || type === 'replay') {
      const iv = type === 'replay' || R() < 0.7 || !M.daily[sym] ? '5min' : '1day';
      const s = (iv === '5min' ? M.intraday : M.daily)[sym];
      const days = [5, 10, 20][Math.floor(R() * 3)];
      const origin = s.c.length - 1, hz = horizonFor(s, origin, days);
      shot.series = s; shot.style = R() < 0.6 ? 'candles' : 'line';
      shot.w0 = iv === '5min' ? 150 + Math.floor(R() * 90) : 45 + Math.floor(R() * 40); shot.w1 = Math.round(shot.w0 * (0.55 + 0.15 * R()));
      if (type === 'fan') {
        const r = await engine.forecast(model, [s.c.subarray(Math.max(0, origin - 2047), origin + 1)], hz.H, [0]);
        shot.fc = { origin, H: hz.H, levels: r.levels, q: r.q[0], times: hz.times, model: label, ep: r.ep === 'webgpu' ? 'WebGPU' : 'WASM', label: `Forecast to ${hz.what}`, endLabel: hz.endLabel };
        shot.ms = r.timings.runMs; shot.ep = r.ep; shot.hz = hz;
      } else {
        const last = origin; let i0 = last; while (i0 > 0 && s.t[i0] - s.t[i0 - 1] < 3 * 3600e3) i0--;
        if (last - i0 < 10) { let j = i0 - 1; while (j > 0 && s.t[j] - s.t[j - 1] < 3 * 3600e3) j--; i0 = j; }
        const origins = []; for (let k = i0 + 4; k <= last; k += 2) origins.push(k);
        if (!origins.length) origins.push(last);   // short history (one session): replay from the last bar
        const Hs = origins.map(o => horizonFor(s, o, days)), Hmax = Math.max(...Hs.map(h => h.H));
        const r = await engine.forecast(model, origins.map(o => s.c.subarray(Math.max(0, o - 1023), o + 1)), Hmax, origins.map((_, i) => i));
        shot.fcs = origins.map((o, i) => ({ origin: o, H: Hs[i].H, levels: r.levels, q: r.q[i].map(a => a.subarray(0, Hs[i].H)), times: Hs[i].times,
          model: label, ep: r.ep === 'webgpu' ? 'WebGPU' : 'WASM', label: `Forecast as of ${fmtTime(s.t[o], '5min')} ET`, endLabel: Hs[i].endLabel }));
        shot.ms = r.timings.runMs; shot.ep = r.ep; shot.step = (0.45 + 0.35 * calm) * 1000;
        shot.dur = Math.max(shot.dur, shot.fcs.length * shot.step + 2500);
        shot.w0 = shot.w1 = Math.min(200, Math.max(110, last - i0 + 90));
      }
    } else if (type === 'portfolio') {
      const pick = U.slice().sort(() => R() - 0.5).slice(0, 4 + Math.floor(R() * 3));
      const ss = pick.map(u => M.intraday[u.sym]);
      const hz = horizonFor(ss[0], ss[0].c.length - 1);
      const r = await engine.forecast(model, ss.map(s => s.c.subarray(Math.max(0, s.c.length - 2048))), hz.H, ss.map((_, i) => i));
      const positions = ss.map((s, i) => { const px = s.c[s.c.length - 1]; return { sym: s.sym, shares: Math.max(1, Math.round((8000 + 40000 * R()) / px)), price: px, levels: r.levels, endQ: r.levels.map((_, j) => r.q[i][j][hz.H - 1]) }; });
      const corr = corrMatrix(ss.map(s => logReturns(s.c.subarray(Math.max(0, s.c.length - 781)))), 0.1);
      const res = portfolio({ positions, corr, n: 20000, seed: Math.floor(R() * 1e6), compareIndependent: true });
      const hist = res.histogram(56);
      shot.dist = { edges: hist.edges, counts: hist.counts, indep: res.indep.histogram(56, hist.lo, hist.hi), now: res.now, q: res.q,
        label: `Example portfolio of ${positions.length} · total value at ${hz.what}`, source: 'IEX trades, T+1 · Data provided for free by IEX · Gaussian copula, 20,000 draws' };
      shot.res = res; shot.positions = positions; shot.hz = hz; shot.ms = r.timings.runMs; shot.ep = r.ep;
    } else {
      const s = M.intraday[sym], n = s.c.length - 1, hz = horizonFor(s, n), H = hz.H;
      const starts = []; for (let i = 1; i <= n; i++) if (s.t[i] - s.t[i - 1] > 3 * 3600e3) starts.push(i);
      const origins = []; for (const a of starts) { const o = a + 78 - H - 1; if (o + H <= n && o > 200) origins.push(o); }
      const os = origins.slice(-20);
      if (!os.length) return makeShot('fan');
      const r = await engine.forecast(model, os.map(o => s.c.subarray(Math.max(0, o - 1023), o + 1)), H, os.map((_, i) => i));
      shot.bt = backtest({ closes: s.c, origins: os, H, levels: r.levels, forecasts: r.q, season: 78 });
      shot.calib = { perOrigin: shot.bt.perOrigin, base: s.c, label: `${sym} · 10–90 % band at the close vs the realised close, ${os.length} sessions`, source: 'IEX trades, T+1 · Data provided for free by IEX · rolling-origin backtest', axis: 'earlier sessions at the same time of day, oldest left' };
      shot.ms = r.timings.runMs; shot.ep = r.ep; shot.H = H;
    }
    return shot;
  }

  async function plateFor(shot) {
    const label = D.label; if (!label) return;
    const ep = shot.ep === 'webgpu' ? 'WebGPU' : 'WASM';
    const pct = (v, b) => `${v >= b ? '+' : ''}${((v / b - 1) * 100).toFixed(2)} %`;
    let info;
    if (shot.type === 'fan' || shot.type === 'replay') {
      const s = shot.series, fc = shot.type === 'fan' ? shot.fc : (shot.fcs || [])[Math.min(shot.idx || 0, (shot.fcs || []).length - 1)];
      if (!fc) return;   // no forecast for this shot (short history or a failed run): keep the previous plate
      const e = fc.H - 1, base = s.c[fc.origin];
      const q10 = levelRow(fc, 0.1)[e], q50 = levelRow(fc, 0.5)[e], q90 = levelRow(fc, 0.9)[e];
      info = {
        title: shot.type === 'fan' ? `${s.sym} · forecast fan` : `${s.sym} · the forecast through the day`,
        sub: `${s.name} — IEX trades, T+1 · Chronos-Bolt Tiny`,
        params: [
          { sym: 'p_0', name: 'price at origin', value: fmtPrice(base), cls: 'm1' },
          { sym: 'q_{50}', name: `median at ${fc.endLabel}`, value: `${fmtPrice(q50)} (${pct(q50, base)})`, cls: 'm2' },
          { sym: 'q_{10}, q_{90}', name: '80 % band', value: `${fmtPrice(q10)} – ${fmtPrice(q90)}`, cls: 'm4' },
          { sym: 'H', name: 'steps ahead', value: String(fc.H), cls: 'm6' },
        ],
        lines: [shot.type === 'fan' ? `Ran in this browser on ${ep} in ${shot.ms} ms · Data provided for free by IEX · not advice` : `${shot.fcs.length} origins in one batch on ${ep}, ${shot.ms} ms · ${fc.label}`],
        code: shot.type === 'fan' ? await codeFrom('shaders/prim.wgsl', 'let front = mix(', 5, 'wgsl', 'shaders/prim.wgsl · the fan reveal')
          : await codeFrom('model-io.js', 'for (let j = 0; j < Q; j++) for (let k = 0; k < Q; k++) buf', 3, 'js', 'model-io.js · Bolt unroll past 64 steps'),
      };
    } else if (shot.type === 'portfolio') {
      const r = shot.res;
      info = {
        title: 'Portfolio at the close',
        sub: `${shot.positions.map(p => p.sym).join(' · ')} — example shares, IEX trades`,
        params: [
          { sym: 'V_0', name: 'value now', value: '$' + fmtPrice(r.now), cls: 'm1' },
          { sym: 'P(V > V_0)', name: 'probability up', value: `${(r.pUp * 100).toFixed(0)} %`, cls: 'm2' },
          { sym: '\\mathrm{VaR}_{95}', name: 'value at risk', value: '$' + fmtPrice(Math.max(0, r.var95)), cls: 'm5' },
          { sym: '\\mathrm{ES}_{95}', name: 'expected shortfall', value: '$' + fmtPrice(r.es95), cls: 'm5' },
        ],
        lines: [`Gaussian copula over ${shot.positions.length} Chronos-Bolt marginals · independent VaR $${fmtPrice(Math.max(0, r.indep.var95))}`],
        code: await codeFrom('analysis.js', 'if (L) for (let i = 0; i < P; i++)', 4, 'js', 'analysis.js · copula draw'),
      };
    } else {
      const b = shot.bt;
      info = {
        title: `${shot.sym} · backtest`,
        sub: 'Rolling origins at the same time of day — IEX trades, T+1',
        params: [
          { sym: 'c_{80}', name: 'inside 80 % band', value: `${(b.coverage80 * 100).toFixed(0)} %`, cls: 'm2' },
          { sym: '\\mathrm{WQL}', name: 'model', value: b.wqlModel.toFixed(4), cls: 'm4' },
          { sym: '\\mathrm{WQL}_0', name: 'naive', value: b.wqlNaive.toFixed(4), cls: 'm6' },
          { sym: 's', name: 'skill vs naive', value: `${b.skillNaive >= 0 ? '+' : ''}${(b.skillNaive * 100).toFixed(1)} %`, cls: 'm1' },
        ],
        lines: [`${b.n} origins, ${shot.H} steps each · ${ep}, ${shot.ms} ms`],
        code: await codeFrom('analysis.js', 'export function pinball(y', 4, 'js', 'analysis.js · pinball loss and WQL'),
      };
    }
    label(info);
  }

  function apply(shot) {
    D.shot = shot; shot.t0 = performance.now(); shot.idx = 0;
    if (shot.type === 'fan' || shot.type === 'replay') {
      D.pc.setSeries(shot.series); D.pc.setMode(shot.style); D.pc.setWindow(shot.w0); D.pc.setTrails([]); D.pc.clearHover();
      if (shot.type === 'fan') D.pc.setForecast(shot.fc, { animate: true, revealSec: 1.6 + 1.2 * D.calm });
      else D.pc.setForecast(shot.fcs[0], { animate: true, revealSec: 0.4 });
      D.scene = D.pc;
    } else if (shot.type === 'portfolio') { D.dc.set(shot.dist); D.scene = D.dc; }
    else { D.cc.set(shot.calib); D.scene = D.cc; }
    plateFor(shot);
  }

  function frame(now) {
    if (!D) return;
    D.raf = requestAnimationFrame(frame);
    fitStage();
    const sh = D.shot;
    if (sh) {
      const k = Math.min(1, (now - sh.t0) / sh.dur);
      if (sh.type === 'fan') D.pc.setWindow(Math.round(sh.w0 + (sh.w1 - sh.w0) * (k * k * (3 - 2 * k))));
      if (sh.type === 'replay') {
        const i = Math.min(sh.fcs.length - 1, Math.floor((now - sh.t0) / sh.step));
        if (i !== sh.idx) {
          sh.idx = i; D.pc.setForecast(sh.fcs[i], { animate: true, revealSec: 0.4 });
          D.pc.setTrails(sh.fcs.slice(0, i).map((f, j) => ({ origin: f.origin, median: levelRow(f, 0.5), alpha: 0.05 + 0.22 * (j + 1) / (i + 1) })));
          plateFor(sh);
        }
      }
      if (now - sh.t0 > sh.dur && !D.cutting) cut();
    }
    if (D.scene) D.scene.frame(now / 1000);
  }

  async function cut() {
    D.cutting = true;
    const type = D.order[D.k++ % D.order.length];
    if (D.k % D.order.length === 0) D.order = shuffle(D.order);
    D.box.style.opacity = '0';
    const [next] = await Promise.all([makeShot(type).catch(e => { console.warn('saver shot', e); return null; }), new Promise(r => setTimeout(r, 480))]);
    if (!D) return;
    if (next) apply(next); else if (D.shot) D.shot.t0 = performance.now();
    D.box.style.opacity = '1';
    D.cutting = false;
  }
  function shuffle(a) {
    const b = a.slice(), R = D.rnd;
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    for (let i = 1; i < b.length; i++) if (b[i] === b[i - 1]) { const j = (i + 1) % b.length; [b[i], b[j]] = [b[j], b[i]]; }
    return b;
  }

  window.snSaver = {
    async enter(opts = {}) {
      if (D) this.exit();
      mf.saverOn = true;
      document.documentElement.classList.add('mf-saver');
      const stage = document.createElement('div');
      Object.assign(stage.style, { position: 'fixed', inset: '0', zIndex: '100', background: 'radial-gradient(1200px 700px at 60% 40%, #0b1220, #04060a)' });
      const box = document.createElement('div');
      Object.assign(box.style, { position: 'absolute', transition: 'opacity .45s ease', opacity: '0' });
      const canvas = document.createElement('canvas'), overlay = document.createElement('canvas');
      for (const c of [canvas, overlay]) Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
      box.append(canvas, overlay); stage.append(box); document.body.append(stage);
      const view = createView(canvas, overlay, gpu);
      view.bg = [0.016, 0.024, 0.04, 1];
      const shared = { canvas, overlay, view };
      const seed = (opts.seed >>> 0) || 1;
      const rnd = lcg(seed);
      D = {
        stage, box, view, calm: Math.min(1, Math.max(0, opts.calm ?? 0.7)), rnd, label: typeof opts.label === 'function' ? opts.label : null,
        market: null, band: null, bandAt: -1e9, boxKey: '', k: 0, cutting: false, shot: null, scene: null,
        pc: createPriceChart(null, gpu, shared), dc: createDistChart(null, gpu, shared), cc: createCalibChart(null, gpu, shared),
      };
      D.pc.setCompactAxis(innerWidth < 700);
      D.order = shuffle(['fan', 'replay', 'portfolio', 'backtest', 'fan', 'replay', 'portfolio', 'backtest', 'fan']);
      fitStage();
      D.raf = requestAnimationFrame(frame);
      await engine.ready; await ensureModel('bolt-tiny');
      // the real snapshot: every ticker at 5 min, daily only with 30+ bars
      const P = PROVIDERS.iex, uni = await P.universe(), intraday = {}, daily = {};
      for (const u of uni) {
        try { intraday[u.sym] = await P.fetchSeries(u.sym, '5min'); } catch (e) { continue; }
        try { const dd = await P.fetchSeries(u.sym, '1day'); if (dd.c.length >= 30) daily[u.sym] = dd; } catch (e) { /* short history */ }
      }
      D.market = { universe: uni.filter(u => intraday[u.sym]), intraday, daily };
      await cut();
      return { canvas, warmupMs: 900 };
    },
    exit() {
      if (!D) return;
      cancelAnimationFrame(D.raf); D.stage.remove(); D = null;
      document.documentElement.classList.remove('mf-saver'); mf.saverOn = false;
      if (typeof ctx.onExit === 'function') ctx.onExit();
    },
    debug() {
      if (!D) return null;
      const s = D.shot;
      return { type: s && s.type, sym: s && s.sym, held: s ? +((performance.now() - s.t0) / 1000).toFixed(1) : 0, dur: s ? +(s.dur / 1000).toFixed(1) : 0,
        idx: s && s.idx, order: D.order, k: D.k, band: D.band, box: D.box.getBoundingClientRect().toJSON(), backend: D.view.backend, cutting: D.cutting };
    },
  };
}

// ============================================================================
//  PRICE CHART  ·  market-forecast/chart.js — history, volume, forecast fan
// ----------------------------------------------------------------------------
//  The main chart of the page, a scene for gfx.js. The x axis is the bar
//  index (closed hours take no space, as on a trading screen). The price
//  pane shows candles or a line with an area fill; the volume pane sits
//  under it. Right of the origin bar, the forecast fan: 10-90 and 25-75
//  bands (and 1-99 / 5-95 for Chronos-2, fainter), the median as a lit
//  line, and the close marker. Text, axes and the crosshair are on the 2D
//  overlay.
//
//  Motion
//    - setForecast(fc, { animate }) unfurls the fan from the origin over
//      1.1 s (the reveal mask in prim.wgsl). A new forecast for the same
//      origin morphs from the old values over 0.7 s instead.
//    - the y range eases to its target, so a new fan does not jump the axis
//    - scrub: setForecast with an earlier origin. The bars after the origin
//      show as the realised path (dim candles and a white line) under the
//      fan, so the eye can check the fan against what happened.
//    - trails: faint medians of earlier origins (the forecast history)
//
//  API (createPriceChart(host, gpu) -> chart)
//    chart.setSeries(series)        Series (see providers.js)
//    chart.setForecast(fc|null, o)  fc = { origin, H, levels, q[level][h],
//                                   times[h], model, ep, label }
//    chart.setTrails(list)          [{ origin, median: Float64Array }]
//    chart.setMode('candles'|'line'); chart.setWindow(nBars)
//    chart.setInsets({ top, bottom }) css px kept clear (sheet, plate)
//    chart.onHover(fn)              fn({ i, kind: 'bar'|'fc', ... } | null)
//    chart.view                     the gfx view (backend, sizes)
//    chart.frame(t)                 draw one frame (main.js runs the loop)
//    chart.busy()                   true while an animation runs
//
//  grep -n targets
//    layout ............. "function layout"
//    fan geometry ....... "function buildFan"
//    candles ............ "function buildBars"
//    overlay text ....... "function drawOverlay"
//    pointer ............ "function onPointer"
// ============================================================================
import { createView } from './gfx.js';

export const COL = {
  up: [0.16, 0.84, 0.52, 1], down: [1.0, 0.36, 0.42, 1],
  fan: [0.36, 0.62, 1.0, 1], fanHi: [0.62, 0.82, 1.0, 1], median: [0.74, 0.9, 1.0, 1],
  now: [1.0, 0.78, 0.36, 1], grid: [1, 1, 1, 0.055], real: [0.96, 0.97, 1.0, 1], trail: [0.6, 0.72, 1.0, 1],
};
const css = (c, a = c[3]) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const ease = k => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.pow(1 - k, 3));
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";

// text cut to maxW px with an ellipsis (narrow phones)
export function fitText(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 4 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
export function niceTicks(lo, hi, n = 6) {
  const span = hi - lo; if (!(span > 0)) return [lo];
  const raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
export function fmtPrice(v) {
  const a = Math.abs(v);
  return a >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a >= 100 ? v.toFixed(2) : a >= 1 ? v.toFixed(2) : v.toFixed(4);
}
export function fmtTime(ms, interval, withDate = false) {
  const o = { timeZone: 'America/New_York' };
  if (interval === '1day') return new Date(ms).toLocaleDateString('en-US', { ...o, month: 'short', day: 'numeric' });
  const t = new Date(ms).toLocaleTimeString('en-US', { ...o, hour: '2-digit', minute: '2-digit', hour12: false });
  return withDate ? new Date(ms).toLocaleDateString('en-US', { ...o, month: 'short', day: 'numeric' }) + ' ' + t : t;
}
// interpolated level value (linear in level) for a band edge not in the list
export function levelRow(fc, p) {
  const L = fc.levels; let j = L.findIndex(v => Math.abs(v - p) < 1e-9);
  if (j >= 0) return fc.q[j];
  j = L.findIndex(v => v > p); if (j <= 0) return fc.q[j < 0 ? L.length - 1 : 0];
  const w = (p - L[j - 1]) / (L[j] - L[j - 1]), a = fc.q[j - 1], b = fc.q[j];
  return a.map((v, h) => v + (b[h] - v) * w);
}

// shared: an existing { canvas, overlay, view } (the saver draws all its
// scenes into one canvas); else the chart makes its own in host.
export function createPriceChart(host, gpu, shared = null) {
  let canvas, overlay;
  if (shared) ({ canvas, overlay } = shared);
  else { canvas = document.createElement('canvas'); overlay = document.createElement('canvas'); canvas.className = 'mf-gl'; overlay.className = 'mf-ov'; host.append(canvas, overlay); }
  const view = shared ? shared.view : createView(canvas, overlay, gpu);
  const S = {
    series: null, fc: null, fcFrom: null, morphT0: -1, revealT0: -1, trails: [], mode: 'candles', nBars: 160,
    insets: { top: 0, bottom: 0 }, yLo: NaN, yHi: NaN, vMax: NaN, hover: null, hoverCb: null, lastT: 0, dirty: true, pan: 0,
  };
  let lay = null;

  function layout(W, H) {
    const d = view.dpr, top = (14 + S.insets.top) * d, bottom = H - (26 + S.insets.bottom) * d;
    const right = W - (S.compactAxis ? 54 : 66) * d, left = 8 * d;
    const volH = Math.max(28 * d, (bottom - top) * 0.17);
    const series = S.series, n = series ? series.c.length : 0;
    const fc = S.fc, origin = fc ? Math.min(fc.origin, n - 1) : n - 1;
    const last = n - 1 - S.pan;
    const futureEnd = fc ? Math.max(last, origin + fc.H) : last;
    const i0 = Math.max(0, last - S.nBars + 1);
    const slots = futureEnd - i0 + 1 + (fc ? 1 : 0);
    const slotW = (right - left) / Math.max(10, slots);
    return { W, H, d, top, bottom, right, left, volTop: bottom - volH, priceBottom: bottom - volH - 8 * d, i0, last, origin, futureEnd, slotW,
      x: i => left + (i - i0 + 0.5) * slotW };
  }

  function targetRange(L) {
    const s = S.series; let lo = Infinity, hi = -Infinity, vm = 0;
    for (let i = L.i0; i <= Math.min(L.last, s.c.length - 1); i++) {
      lo = Math.min(lo, S.mode === 'line' ? s.c[i] : s.l[i]); hi = Math.max(hi, S.mode === 'line' ? s.c[i] : s.h[i]); vm = Math.max(vm, s.v[i]);
    }
    const fc = S.fc;
    if (fc) {
      const a = levelRow(fc, 0.05), b = levelRow(fc, 0.95);
      for (let h = 0; h < fc.H; h++) { lo = Math.min(lo, a[h]); hi = Math.max(hi, b[h]); }
    }
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1;
    return [lo - pad, hi + pad, vm || 1];
  }

  // The values on screen: a morph from the old forecast to the new one.
  function shownFc(t) {
    const fc = S.fc; if (!fc) return null;
    if (!S.fcFrom || S.morphT0 < 0) return fc;
    const k = ease((t - S.morphT0) / 0.7);
    if (k >= 1) { S.fcFrom = null; return fc; }
    const a = S.fcFrom;
    return { ...fc, q: fc.q.map((row, j) => row.map((v, h) => { const r = levelRow(a, fc.levels[j]); const w = r[Math.min(h, r.length - 1)]; return w + (v - w) * k; })) };
  }

  function buildBars(P, L, y, vy) {
    const s = S.series, d = L.d, bw = Math.max(1, L.slotW * 0.62), real = S.fc && L.origin < s.c.length - 1;
    const lastI = Math.min(L.last, s.c.length - 1);
    const linePts = [];
    for (let i = L.i0; i <= lastI; i++) {
      const x = L.x(i), up = s.c[i] >= s.o[i], c = up ? COL.up : COL.down, after = real && i > L.origin;
      const dim = after ? 0.32 : 1;
      // volume
      P.rect(x - bw / 2, vy(s.v[i]), x + bw / 2, L.bottom, [c[0], c[1], c[2], 0.30 * dim], 0);
      if (S.mode === 'candles') {
        const y0 = y(Math.max(s.o[i], s.c[i])), y1 = Math.max(y0 + 1 * d, y(Math.min(s.o[i], s.c[i])));
        P.rect(x - Math.max(0.5, d * 0.5), y(s.h[i]), x + Math.max(0.5, d * 0.5), y(s.l[i]), [c[0], c[1], c[2], 0.85 * dim], 0);
        P.rect(x - bw / 2, y0, x + bw / 2, y1, [c[0], c[1], c[2], dim], 0);
      }
      if (S.mode === 'line' && !after) linePts.push([x, y(s.c[i])]);
    }
    if (S.mode === 'line' && linePts.length > 1) {
      const up = s.c[Math.min(L.origin, lastI)] >= s.c[L.i0], c = up ? COL.up : COL.down;
      // area under the line, fading down
      for (let k = 0; k < linePts.length - 1; k++) {
        const a = linePts[k], b = linePts[k + 1];
        P.quad(a, b, [b[0], L.priceBottom], [a[0], L.priceBottom], [[c[0], c[1], c[2], 0.20], [c[0], c[1], c[2], 0.20], [c[0], c[1], c[2], 0], [c[0], c[1], c[2], 0]], 0);
      }
      P.line(linePts, 2.2 * d, c, { layer: 2 });
      P.line(linePts, 9 * d, [c[0], c[1], c[2], 0.10], { layer: 1, soft: 1 });
    }
    if (real) {
      const pts = [];
      for (let i = L.origin; i <= lastI; i++) pts.push([L.x(i), y(s.c[i])]);
      P.line(pts, 1.6 * d, [...COL.real.slice(0, 3), 0.92], { layer: 2 });
    }
  }

  function buildFan(P, L, y, fc, t) {
    const s = S.series, d = L.d, H = fc.H;
    const ox = L.x(L.origin), oy = y(s.c[L.origin]);
    const xs = [ox], at = (row) => [oy, ...Array.from(row, v => y(v))];
    for (let h = 0; h < H; h++) xs.push(L.x(L.origin + 1 + h));
    const fade = i => 1 - 0.35 * (i / H);
    const bands = fc.levels.length > 9 ? [[0.01, 0.99, 0.07], [0.05, 0.95, 0.10], [0.1, 0.9, 0.16], [0.25, 0.75, 0.24]] : [[0.1, 0.9, 0.17], [0.25, 0.75, 0.27]];
    for (const [a, b, al] of bands) {
      const lo = at(levelRow(fc, a)), hi = at(levelRow(fc, b));
      P.band(xs, lo, hi, [...COL.fanHi.slice(0, 3), al], [...COL.fan.slice(0, 3), al * 0.85], { reveal: true, front: 0.9, alphaOf: fade, layer: 0 });
      // band edges: thin lines
      const e = al * 1.6;
      P.line(xs.map((x, i) => [x, hi[i]]), 1 * d, [...COL.fan.slice(0, 3), e], { reveal: true, layer: 0 });
      P.line(xs.map((x, i) => [x, lo[i]]), 1 * d, [...COL.fan.slice(0, 3), e], { reveal: true, layer: 0 });
    }
    const med = at(levelRow(fc, 0.5)), mp = xs.map((x, i) => [x, med[i]]);
    P.line(mp, 14 * d, [...COL.median.slice(0, 3), 0.16], { reveal: true, layer: 1, soft: 1, front: 1.5 });
    P.line(mp, 2.2 * d, COL.median, { reveal: true, layer: 2, front: 1 });
    // the origin dot, with a pulse
    const pr = (5 + 2 * Math.sin(t * 2.4)) * d;
    dot(P, ox, oy, pr * 2.6, [...COL.median.slice(0, 3), 0.10], 1);
    dot(P, ox, oy, 3.2 * d, COL.median, 2);
  }

  function dot(P, x, y, r, c, L) {
    const n = 18, pts = [];
    for (let k = 0; k <= n; k++) { const a = k / n * Math.PI * 2; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
    for (let k = 0; k < n; k++) P.tri(L, [[x, y], pts[k], pts[k + 1]], [c, [c[0], c[1], c[2], L === 1 ? 0 : c[3]], [c[0], c[1], c[2], L === 1 ? 0 : c[3]]]);
  }

  const scene = {
    build(P, W, H, t) {
      const L = lay = layout(W, H), s = S.series;
      if (!s) return;
      const [tlo, thi, tv] = targetRange(L);
      const k = Number.isFinite(S.yLo) ? Math.min(1, (t - S.lastT) * 7) : 1;
      S.yLo = Number.isFinite(S.yLo) ? S.yLo + (tlo - S.yLo) * k : tlo;
      S.yHi = Number.isFinite(S.yHi) ? S.yHi + (thi - S.yHi) * k : thi;
      S.vMax = Number.isFinite(S.vMax) ? S.vMax + (tv - S.vMax) * k : tv;
      S.moving = Math.abs(tlo - S.yLo) + Math.abs(thi - S.yHi) > (thi - tlo) * 1e-3;
      S.lastT = t;
      const y = v => L.top + (S.yHi - v) / (S.yHi - S.yLo) * (L.priceBottom - L.top);
      const vy = v => L.bottom - (v / S.vMax) * (L.bottom - L.volTop) * 0.92;
      L.y = y; L.inv = py => S.yHi - (py - L.top) / (L.priceBottom - L.top) * (S.yHi - S.yLo);
      // background wash and grid
      const bgTop = [0.05, 0.065, 0.10, 1], bgBot = [0.025, 0.03, 0.045, 1];
      P.quad([0, 0], [W, 0], [W, H], [0, H], [bgTop, bgTop, bgBot, bgBot], 0);
      L.ticks = niceTicks(S.yLo, S.yHi, Math.max(3, Math.round((L.priceBottom - L.top) / (64 * L.d))));
      for (const v of L.ticks) { const yy = Math.round(y(v)); P.rect(L.left, yy, L.right, yy + Math.max(1, L.d * 0.75), COL.grid, 0); }
      P.rect(L.left, L.volTop - 4 * L.d, L.right, L.volTop - 4 * L.d + L.d * 0.75, [1, 1, 1, 0.04], 0);
      // session boundaries (intraday) as faint verticals
      L.sessions = [];
      if (s.interval !== '1day') {
        for (let i = Math.max(1, L.i0); i <= Math.min(L.last, s.t.length - 1); i++) {
          if (s.t[i] - s.t[i - 1] > 3 * 3600e3) { const x = Math.round(L.x(i) - L.slotW / 2); P.rect(x, L.top, x + L.d, L.bottom, [1, 1, 1, 0.07], 0); L.sessions.push(i); }
        }
      }
      // trails of earlier origins
      for (const tr of S.trails) {
        if (tr.origin < L.i0) continue;
        const pts = [[L.x(tr.origin), y(s.c[tr.origin])]];
        for (let h = 0; h < tr.median.length; h++) pts.push([L.x(tr.origin + 1 + h), y(tr.median[h])]);
        P.line(pts, 1.1 * L.d, [...COL.trail.slice(0, 3), tr.alpha ?? 0.18], { layer: 0 });
      }
      buildBars(P, L, y, vy);
      const fc = shownFc(t);
      if (fc) {
        const rk = S.revealT0 < 0 ? 1 : ease((t - S.revealT0) / (S.revealDur || 1.1));
        view.reveal = [L.x(L.origin), L.x(L.origin + fc.H) + L.slotW]; view.prog = rk;
        S.revealing = rk < 1;
        buildFan(P, L, y, fc, t);
        // origin line (now) and the close marker
        const ox = Math.round(L.x(L.origin));
        for (let yy = L.top; yy < L.bottom; yy += 7 * L.d) P.rect(ox, yy, ox + L.d, Math.min(L.bottom, yy + 3.5 * L.d), [...COL.now.slice(0, 3), 0.55], 0);
        const ex = Math.round(L.x(L.origin + fc.H) + L.slotW / 2);
        P.rect(ex, L.top, ex + L.d, L.priceBottom, [1, 1, 1, 0.12], 0);
      } else S.revealing = false;
      if (S.hover && S.hover.slot != null) {
        const hx = Math.round(L.x(S.hover.slot));
        P.rect(hx, L.top, hx + L.d, L.bottom, [1, 1, 1, 0.22], 2);
        const hy = Math.round(S.hover.y * L.d);
        if (hy > L.top && hy < L.priceBottom) P.rect(L.left, hy, L.right, hy + L.d, [1, 1, 1, 0.14], 2);
      }
    },
    overlay(g, w, h, t) { drawOverlay(g, w, h, t); },
  };

  function pill(g, x, y, text, bg, fg = '#0b0e14', align = 'left') {
    g.font = `600 11px ${FONT}`;
    const tw = g.measureText(text).width, ph = 18, pw = tw + 12, x0 = align === 'right' ? x - pw : x;
    g.fillStyle = bg; g.beginPath(); g.roundRect(x0, y - ph / 2, pw, ph, 4); g.fill();
    g.fillStyle = fg; g.textBaseline = 'middle'; g.fillText(text, x0 + 6, y + 0.5);
  }

  function drawOverlay(g, w, h, t) {
    const L = lay, s = S.series; if (!L || !s) return;
    const d = L.d, X = i => L.x(i) / d, Y = v => L.y(v) / d, R = L.right / d;
    g.font = `500 11px ${FONT}`; g.fillStyle = 'rgba(205,214,228,.62)'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fontVariantNumeric = 'tabular-nums';
    // tag rows first, so the axis numbers can step around them
    const fcT = S.fc, li0 = fcT ? L.origin : Math.min(L.last, s.c.length - 1);
    const busy = [Y(s.c[li0])];
    if (fcT && !S.revealing) for (const p of [0.1, 0.5, 0.9]) busy.push(Y(levelRow(fcT, p)[fcT.H - 1]));
    if (S.hover && S.hover.slot != null) busy.push(S.hover.y);
    for (const v of L.ticks) { const yy = Y(v); if (yy > L.top / d + 6 && yy < L.priceBottom / d - 4 && busy.every(b => Math.abs(b - yy) > 14)) g.fillText(fmtPrice(v), R + 8, yy); }
    // time labels: session starts, or every Nth bar
    g.textAlign = 'center'; g.fillStyle = 'rgba(205,214,228,.5)';
    const by = L.bottom / d + 13, lab = [];
    const step = Math.max(1, Math.round(90 / (L.slotW / d)));
    if (s.interval === '1day') { for (let i = L.i0; i <= Math.min(L.last, s.t.length - 1); i += step) lab.push([X(i), fmtTime(s.t[i], '1day')]); }
    else {
      for (const i of L.sessions) lab.push([X(i), fmtTime(s.t[i], '1day')]);
      for (let i = L.i0; i <= Math.min(L.last, s.t.length - 1); i++) {
        const m = new Date(s.t[i]); if (m.getUTCMinutes() === 0 && (i - L.i0) % 1 === 0 && !lab.some(l => Math.abs(l[0] - X(i)) < 58)) lab.push([X(i), fmtTime(s.t[i], s.interval)]);
      }
    }
    for (const [x, txt] of lab) if (x > 20 && x < R - 20) g.fillText(txt, x, by);
    // source and timestamp, on every chart
    g.textAlign = 'left'; g.font = `500 10.5px ${FONT}`; g.fillStyle = 'rgba(205,214,228,.55)';
    const src = s.source || {};
    const asOf = src.asOf ? (s.interval === '1day' ? fmtTime(src.asOf, '1day') + ' (daily bar)' : fmtTime(src.asOf, s.interval, true) + ' ET') : '';
    const maxW = R - L.left / d - 70, full = `${src.label || 'unknown source'}${asOf ? ' · as of ' + asOf : ''}`;
    let ly = L.top / d + 2;
    if (g.measureText(full).width <= maxW) g.fillText(full, L.left / d + 4, ly);
    else { g.fillText(fitText(g, src.label || 'unknown source', maxW), L.left / d + 4, ly); if (asOf) { ly += 15; g.fillText('as of ' + asOf, L.left / d + 4, ly); } }
    const fc = S.fc;
    if (fc) {
      g.fillStyle = 'rgba(147,190,255,.75)';
      g.fillText(fitText(g, `${fc.label || 'forecast'} · ${fc.model}${fc.ep ? ' · ' + fc.ep : ''}`, maxW), L.left / d + 4, ly + 15);
    }
    // last price tag
    const li = fc ? L.origin : Math.min(L.last, s.c.length - 1), lastC = s.c[li], up = lastC >= s.o[li];
    const yy = Y(lastC);
    g.textAlign = 'left';
    pill(g, R + 2, yy, fmtPrice(lastC), css(up ? COL.up : COL.down));
    // forecast end tags
    if (fc && !S.revealing) {
      const q10 = levelRow(fc, 0.1), q50 = levelRow(fc, 0.5), q90 = levelRow(fc, 0.9), e = fc.H - 1;
      const tags = [[q90[e], 'rgba(120,170,255,.9)'], [q50[e], 'rgba(200,228,255,.96)'], [q10[e], 'rgba(120,170,255,.9)']];
      let prevY = -99;
      for (const [v, c] of tags) { let ty = Y(v); if (Math.abs(ty - yy) < 19) continue; if (Math.abs(ty - prevY) < 19) ty = prevY + 19; pill(g, R + 2, ty, fmtPrice(v), c); prevY = ty; }
      const ex = X(L.origin + fc.H) + L.slotW / d / 2;
      g.fillStyle = 'rgba(205,214,228,.6)'; g.textAlign = 'right'; g.font = `500 10.5px ${FONT}`;
      const endLabel = fc.endLabel || (fc.times ? fmtTime(fc.times[fc.H - 1] + (s.session?.barMs || 0), s.interval) : '');
      g.fillText(endLabel, ex - 4, L.priceBottom / d - 6);
    }
    // crosshair labels and tooltip
    const hv = S.hover;
    if (hv && hv.slot != null) {
      const hy = hv.y;
      if (hy * d > L.top && hy * d < L.priceBottom) pill(g, R + 2, hy, fmtPrice(L.inv(hy * d)), 'rgba(235,240,248,.92)');
      const info = describe(hv.slot);
      if (info) {
        const lines = info.lines;
        g.font = `500 11.5px ${FONT}`;
        const tw = Math.max(...lines.map(l => g.measureText(l[0] + '  ' + l[1]).width)) + 26, th = lines.length * 17 + 30;
        let bx = X(hv.slot) + 14; if (bx + tw > R - 6) bx = X(hv.slot) - 14 - tw;
        const byy = L.top / d + 34;
        g.fillStyle = 'rgba(10,13,20,.86)'; g.strokeStyle = 'rgba(255,255,255,.10)';
        g.beginPath(); g.roundRect(bx, byy, tw, th, 8); g.fill(); g.stroke();
        g.fillStyle = 'rgba(235,240,248,.95)'; g.font = `600 11.5px ${FONT}`; g.textAlign = 'left';
        g.fillText(info.title, bx + 12, byy + 15);
        g.font = `500 11.5px ${FONT}`;
        lines.forEach((l, k) => {
          g.fillStyle = 'rgba(160,172,190,.85)'; g.textAlign = 'left'; g.fillText(l[0], bx + 12, byy + 34 + k * 17);
          g.fillStyle = l[2] || 'rgba(235,240,248,.95)'; g.textAlign = 'right'; g.fillText(l[1], bx + tw - 12, byy + 34 + k * 17);
        });
      }
    }
  }

  function describe(slot) {
    const s = S.series, fc = S.fc;
    if (fc && slot > L_origin() && slot <= L_origin() + fc.H) {
      const h = slot - L_origin() - 1, row = p => levelRow(fc, p)[h];
      const tm = fc.times ? fmtTime(fc.times[h], s.interval, true) : '+' + (h + 1);
      const base = s.c[L_origin()], pct = v => ((v / base - 1) * 100).toFixed(2) + '%';
      const lines = [['P90', fmtPrice(row(0.9)) + '  ' + pct(row(0.9))], ['P75', fmtPrice(row(0.75))], ['Median', fmtPrice(row(0.5)) + '  ' + pct(row(0.5)), 'rgba(200,228,255,1)'], ['P25', fmtPrice(row(0.25))], ['P10', fmtPrice(row(0.1)) + '  ' + pct(row(0.1))]];
      if (slot < s.c.length) lines.push(['Realised', fmtPrice(s.c[slot]), 'rgba(255,255,255,1)']);
      return { title: `Forecast · ${tm} · step ${h + 1}/${fc.H}`, lines };
    }
    if (slot >= 0 && slot < s.c.length) {
      const up = s.c[slot] >= s.o[slot];
      return { title: fmtTime(s.t[slot], s.interval, true), lines: [['Open', fmtPrice(s.o[slot])], ['High', fmtPrice(s.h[slot])], ['Low', fmtPrice(s.l[slot])], ['Close', fmtPrice(s.c[slot]), up ? css(COL.up) : css(COL.down)], ['Volume', Math.round(s.v[slot]).toLocaleString('en-US')]] };
    }
    return null;
  }
  const L_origin = () => (lay ? lay.origin : 0);

  function onPointer(e) {
    if (!lay) return;
    const r = overlay.getBoundingClientRect(), x = (e.clientX - r.left) * lay.d, y = e.clientY - r.top;
    if (x < lay.left || x > lay.right) { S.hover = null; S.hoverCb && S.hoverCb(null); return; }
    const slot = Math.round((x - lay.left) / lay.slotW - 0.5) + lay.i0;
    S.hover = { slot: Math.min(slot, lay.futureEnd), y };
    S.hoverCb && S.hoverCb({ slot: S.hover.slot });
  }
  overlay.addEventListener('pointermove', onPointer);
  overlay.addEventListener('pointerdown', onPointer);
  overlay.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { S.hover = null; S.hoverCb && S.hoverCb(null); } });
  overlay.addEventListener('wheel', e => {
    e.preventDefault();
    S.nBars = Math.max(30, Math.min(S.series ? S.series.c.length : 600, Math.round(S.nBars * (e.deltaY > 0 ? 1.12 : 1 / 1.12))));
  }, { passive: false });
  // pinch zoom on touch
  const touches = new Map(); let pinch0 = 0, bars0 = 0;
  overlay.addEventListener('pointerdown', e => { touches.set(e.pointerId, e.clientX); if (touches.size === 2) { const v = [...touches.values()]; pinch0 = Math.abs(v[0] - v[1]); bars0 = S.nBars; } });
  overlay.addEventListener('pointermove', e => {
    if (!touches.has(e.pointerId)) return; touches.set(e.pointerId, e.clientX);
    if (touches.size === 2 && pinch0 > 20) { const v = [...touches.values()]; const k = pinch0 / Math.max(20, Math.abs(v[0] - v[1])); S.nBars = Math.max(30, Math.min(S.series ? S.series.c.length : 600, Math.round(bars0 * k))); }
  });
  const up = e => { touches.delete(e.pointerId); if (touches.size < 2) pinch0 = 0; };
  overlay.addEventListener('pointerup', up); overlay.addEventListener('pointercancel', up);

  const chart = {
    view,
    get state() { return S; },
    setSeries(s) { S.series = s; S.yLo = S.yHi = S.vMax = NaN; S.pan = 0; },
    setForecast(fc, o = {}) {
      const t = performance.now() / 1000;
      if (fc && S.fc && o.morph !== false && S.fc.origin === fc.origin && !o.animate) { S.fcFrom = S.fc; S.morphT0 = t; }
      else { S.fcFrom = null; S.morphT0 = -1; }
      S.fc = fc;
      S.revealT0 = fc && o.animate ? t : -1;
      S.revealDur = o.revealSec || 1.1;
    },
    setTrails(list) { S.trails = list || []; },
    setMode(m) { S.mode = m; },
    setWindow(n) { S.nBars = n; },
    setInsets(o) { S.insets = { top: o.top || 0, bottom: o.bottom || 0 }; },
    setCompactAxis(b) { S.compactAxis = !!b; },
    onHover(fn) { S.hoverCb = fn; },
    clearHover() { S.hover = null; },
    frame(t) { view.render(scene, t); },
    busy() { return S.revealing || S.moving || !!S.fcFrom; },
    resize() { view.resize(); },
    layout: () => lay,
  };
  return chart;
}

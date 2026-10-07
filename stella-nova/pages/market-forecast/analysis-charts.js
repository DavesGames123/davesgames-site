// ============================================================================
//  ANALYSIS CHARTS  ·  market-forecast/analysis-charts.js — two gfx scenes
// ----------------------------------------------------------------------------
//  createDistChart(host, gpu)
//    The distribution of the total portfolio value at the horizon end, as
//    the change from the value now (%). Bars are the Monte-Carlo histogram
//    (analysis.portfolio, Gaussian copula). Green bars are gains, red bars
//    losses. A thin outline shows the same distribution with independent
//    positions, so the effect of the correlation is visible. Marks: now
//    (0 %), the median, the 5 % and 95 % values (VaR line), the 80 % range.
//    The bars grow from the axis with a stagger when a result arrives.
//    dist.set({ edges, counts, indep?: {counts}, now, q: {p05,p50,p95,p10,p90},
//               label, source })
//  createCalibChart(host, gpu)
//    The rolling-origin backtest. One column per origin, oldest left: the
//    model 10-90 % band at the horizon end and the realised value, both as
//    % change from the origin close. A dot is green inside the band, red
//    outside. A grey tick marks the naive 10-90 % band. The columns sweep
//    in from the left when a result arrives.
//    calib.set({ perOrigin: [{ origin, end: { y, q10, q50, q90, naive } }],
//                base: closes, label })
//  Both: .frame(t), .busy(), .resize(), .view. A third argument shared =
//  { canvas, overlay, view } draws into an existing view (the saver).
//
//  grep -n targets: "function buildDist", "function buildCalib"
// ============================================================================
import { createView } from './gfx.js';
import { niceTicks, fitText } from './chart.js';

const ease = k => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.pow(1 - k, 3));
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
const UP = [0.16, 0.84, 0.52], DN = [1.0, 0.36, 0.42], AZ = [0.45, 0.7, 1.0];

function mount(host) {
  const canvas = document.createElement('canvas'), overlay = document.createElement('canvas');
  canvas.className = 'mf-gl'; overlay.className = 'mf-ov';
  host.append(canvas, overlay);
  return { canvas, overlay };
}
function bg(P, W, H) {
  const a = [0.045, 0.058, 0.09, 1], b = [0.028, 0.034, 0.05, 1];
  P.quad([0, 0], [W, 0], [W, H], [0, H], [a, a, b, b], 0);
}

export function createDistChart(host, gpu, shared = null) {
  const { canvas, overlay } = shared || mount(host);
  const view = shared ? shared.view : createView(canvas, overlay, gpu);
  let D = null, t0 = -1, lay = null;
  function buildDist(P, W, H, t) {
    bg(P, W, H);
    if (!D) return;
    const d = view.dpr, left = 14 * d, right = W - 14 * d, top = 58 * d, bottom = H - 30 * d;
    const toPct = v => (v / D.now - 1) * 100;
    const x0 = toPct(D.edges[0]), x1 = toPct(D.edges[D.edges.length - 1]);
    const X = p => left + (p - x0) / (x1 - x0) * (right - left);
    const cmax = Math.max(...D.counts, ...(D.indep ? D.indep.counts : [0]));
    const Y = c => bottom - c / cmax * (bottom - top);
    lay = { X, Y, d, top, bottom, left, right, x0, x1 };
    for (const v of niceTicks(x0, x1, 6)) { const x = Math.round(X(v)); P.rect(x, top, x + d, bottom, [1, 1, 1, v === 0 ? 0 : 0.05], 0); }
    P.rect(left, bottom, right, bottom + d, [1, 1, 1, 0.14], 0);
    const n = D.counts.length, k = t0 < 0 ? 1 : (t - t0);
    for (let i = 0; i < n; i++) {
      const a = toPct(D.edges[i]), b = toPct(D.edges[i + 1]), mid = (a + b) / 2;
      const grow = ease((k - 0.5 * i / n) / 0.7);
      if (grow <= 0) continue;
      const c = mid >= 0 ? UP : DN, h = D.counts[i] * grow;
      const xa = X(a) + 0.6 * d, xb = X(b) - 0.6 * d, yt = Y(h);
      P.quad([xa, yt], [xb, yt], [xb, bottom], [xa, bottom], [[...c, 0.95], [...c, 0.95], [...c, 0.28], [...c, 0.28]], 0);
      P.rect(xa, yt - 2 * d, xb, yt + 2 * d, [...c, 0.22], 1);
    }
    if (D.indep && k > 0.9) {
      const pts = [];
      for (let i = 0; i < n; i++) { const a = toPct(D.edges[i]), b = toPct(D.edges[i + 1]); pts.push([X(a), Y(D.indep.counts[i])], [X(b), Y(D.indep.counts[i])]); }
      P.line(pts, 1.2 * d, [0.85, 0.9, 1, 0.55 * ease((k - 0.9) / 0.5)], { layer: 2, soft: 0.5 });
    }
    const vline = (p, c, w = 1) => { const x = Math.round(X(p)); P.rect(x - (w * d) / 2, top - 6 * d, x + (w * d) / 2, bottom, c, 2); };
    vline(0, [1, 0.78, 0.36, 0.9], 1.5);
    if (D.q) {
      vline(toPct(D.q.p50), [...AZ, 0.95], 2);
      vline(toPct(D.q.p05), [...DN, 0.7], 1);
      vline(toPct(D.q.p95), [...UP, 0.7], 1);
      const ya = bottom + 6 * d, xa = X(toPct(D.q.p10)), xb = X(toPct(D.q.p90));
      P.rect(xa, ya, xb, ya + 3 * d, [...AZ, 0.6], 2);
    }
  }
  function overlayDist(g, w, h, t) {
    if (!D || !lay) return;
    const d = lay.d, X = p => lay.X(p) / d;
    g.font = `500 10.5px ${FONT}`; g.fillStyle = 'rgba(205,214,228,.55)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const v of niceTicks(lay.x0, lay.x1, 6)) g.fillText((v > 0 ? '+' : '') + v.toFixed(Math.abs(v) < 1 && v !== 0 ? 1 : 0) + '%', X(v), lay.bottom / d + 18);
    g.textAlign = 'left'; g.fillStyle = 'rgba(205,214,228,.6)';
    g.fillText(fitText(g, D.label || '', w - 28), 14, 13);
    g.fillStyle = 'rgba(205,214,228,.45)'; g.fillText(fitText(g, D.source || '', w - 28), 14, 27);
    const toPct = v => (v / D.now - 1) * 100;
    // labels over the marker lines; a label that would touch the one
    // before it moves up one row
    const tags = [[0, 'now', 'rgba(255,200,92,.95)']];
    if (D.q) tags.push([toPct(D.q.p05), 'P5', 'rgba(255,120,130,.9)'], [toPct(D.q.p50), 'median', 'rgba(150,200,255,1)'], [toPct(D.q.p95), 'P95', 'rgba(80,220,150,.9)']);
    tags.sort((a, b) => a[0] - b[0]);
    g.font = `600 10.5px ${FONT}`; g.textAlign = 'center';
    let px = -1e9, row = 0;
    for (const [p, txt, c] of tags) {
      const x = Math.max(30, Math.min(w - 30, X(p))), half = g.measureText(txt).width / 2 + 4;
      row = x - half < px ? row + 1 : 0; px = x + half;
      g.fillStyle = c; g.fillText(txt, x, lay.top / d - 8 - row * 13);
    }
  }
  return {
    view,
    set(o) { D = o; t0 = performance.now() / 1000; },
    frame(t) { view.render({ build: (P, W, H) => buildDist(P, W, H, t), overlay: (g, w, h) => overlayDist(g, w, h, t) }, t); },
    busy() { return t0 >= 0 && performance.now() / 1000 - t0 < 1.8; },
    resize() { view.resize(); },
  };
}

export function createCalibChart(host, gpu, shared = null) {
  const { canvas, overlay } = shared || mount(host);
  const view = shared ? shared.view : createView(canvas, overlay, gpu);
  let C = null, t0 = -1, lay = null;
  function rows() {
    return C.perOrigin.filter(r => r.end).map(r => {
      const b = C.base[r.origin], f = v => (v / b - 1) * 100;
      return { y: f(r.end.y), q10: f(r.end.q10), q50: f(r.end.q50), q90: f(r.end.q90), n10: f(r.end.naive.q10), n90: f(r.end.naive.q90) };
    });
  }
  function buildCalib(P, W, H, t) {
    bg(P, W, H);
    if (!C) return;
    const R = rows(); if (!R.length) return;
    const d = view.dpr, left = 44 * d, right = W - 12 * d, top = 34 * d, bottom = H - 22 * d;
    let lo = Infinity, hi = -Infinity;
    for (const r of R) { lo = Math.min(lo, r.y, r.q10, r.n10); hi = Math.max(hi, r.y, r.q90, r.n90); }
    const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
    const Y = v => top + (hi - v) / (hi - lo) * (bottom - top), cw = (right - left) / R.length;
    lay = { Y, d, lo, hi, top, bottom, left, right, cw, n: R.length };
    for (const v of niceTicks(lo, hi, 5)) { const y = Math.round(Y(v)); P.rect(left, y, right, y + d, [1, 1, 1, v === 0 ? 0.16 : 0.05], 0); }
    const k = t0 < 0 ? 1e9 : (t - t0);
    R.forEach((r, i) => {
      const grow = ease((k - 1.6 * i / R.length) / 0.45);
      if (grow <= 0) return;
      const x = left + (i + 0.5) * cw, bw = Math.max(2 * d, cw * 0.46), inside = r.y >= r.q10 && r.y <= r.q90;
      const m = r.q50, a = m + (r.q90 - m) * grow, b = m + (r.q10 - m) * grow;
      P.quad([x - bw / 2, Y(a)], [x + bw / 2, Y(a)], [x + bw / 2, Y(b)], [x - bw / 2, Y(b)], [[...AZ, 0.5], [...AZ, 0.5], [...AZ, 0.26], [...AZ, 0.26]], 0);
      P.rect(x - bw / 2, Y(m) - 0.75 * d, x + bw / 2, Y(m) + 0.75 * d, [...AZ, 0.95], 2);
      P.rect(x - bw * 0.7, Y(r.n10) - 0.5 * d, x - bw * 0.55, Y(r.n90) + 0.5 * d, [1, 1, 1, 0.22], 0);
      if (grow > 0.8) {
        const c = inside ? UP : DN, y = Y(r.y), rr = 3.4 * d * Math.min(1, (grow - 0.8) * 5);
        disc(P, x, y, rr * 3, [...c, 0.18], 1); disc(P, x, y, rr, [...c, 1], 2);
      }
    });
  }
  function disc(P, x, y, r, c, L) {
    const n = 16;
    for (let k = 0; k < n; k++) {
      const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2, e = [c[0], c[1], c[2], L === 1 ? 0 : c[3]];
      P.tri(L, [[x, y], [x + Math.cos(a0) * r, y + Math.sin(a0) * r], [x + Math.cos(a1) * r, y + Math.sin(a1) * r]], [c, e, e]);
    }
  }
  function overlayCalib(g, w, h) {
    if (!C || !lay) return;
    const d = lay.d;
    g.font = `500 10.5px ${FONT}`; g.fillStyle = 'rgba(205,214,228,.55)'; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const v of niceTicks(lay.lo, lay.hi, 5)) { const y = lay.Y(v) / d; if (y > lay.top / d + 4 && y < lay.bottom / d - 4) g.fillText((v > 0 ? '+' : '') + v.toFixed(1) + '%', lay.left / d - 6, y); }
    g.textAlign = 'left'; g.fillStyle = 'rgba(205,214,228,.6)'; g.fillText(fitText(g, C.label || '', w - 24), 12, 13);
    g.fillStyle = 'rgba(205,214,228,.45)'; g.fillText(fitText(g, C.source || '', w - 24), 12, 27);
    g.textAlign = 'center'; g.fillStyle = 'rgba(205,214,228,.45)';
    g.fillText(C.axis || 'origins, oldest left', w / 2, h - 9);
  }
  return {
    view,
    set(o) { C = o; t0 = performance.now() / 1000; },
    frame(t) { view.render({ build: (P, W, H) => buildCalib(P, W, H, t), overlay: (g, w, h) => overlayCalib(g, w, h) }, t); },
    busy() { return t0 >= 0 && performance.now() / 1000 - t0 < 2.4; },
    resize() { view.resize(); },
  };
}

// ============================================================================
//  FACET HEAD MODEL  ·  lab.js — drawing for the two figures
// ----------------------------------------------------------------------------
//  Canvas 2D only. Every draw sizes the canvas to its CSS box times the
//  device pixel ratio, so a resize just calls the draw again.
//    drawHeads   a row of profile panels; a panel can colour each vertex by
//                its error (0 to 3 mm), tint the regions, or mark cuts
//    drawChart   held-out error against coefficient count K (log x), with
//                the global rank wall at N - 1 and the current K
//    ERR_MAX     top of the error colour scale (mm)
//
//  grep -n: "export function drawHeads"  "export function drawChart"
//           "function errColor"  "export const REGION_COLORS"
// ============================================================================
import { N_V, regionOf, template } from './head.js';

export const ERR_MAX = 3;
export const REGION_COLORS = ['#7d8cff', '#a8a4ff', '#62c4ff', '#6fd3c8', '#ffd666', '#ff9a62', '#e889dc', '#86dc7c'];
const INK = '#d8dee6', DIM = '#8692a0', LINE = 'rgba(150,180,210,0.16)';
const STOPS = [[0, [58, 107, 214]], [0.5, [111, 211, 200]], [1.2, [255, 214, 102]], [2, [255, 122, 69]], [3, [255, 59, 107]]];

export function errColor(e) {
  const x = Math.max(0, Math.min(ERR_MAX, e));
  for (let i = 1; i < STOPS.length; i++) if (x <= STOPS[i][0]) {
    const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], f = (x - a) / (b - a);
    return `rgb(${ca.map((c, k) => Math.round(c + f * (cb[k] - c))).join(',')})`;
  }
  return 'rgb(255,59,107)';
}

function fit(cv) {
  const dpr = globalThis.devicePixelRatio || 1;
  const w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

// Profile panels. panels: [{ label, pts, ref?, err?, color?, regions?, cuts?, sub? }]
// ref: a thin reference outline drawn under the panel's own curve.
export function drawHeads(cv, panels) {
  const { g, w, h } = fit(cv);
  const n = panels.length, cols = w < 520 && n > 3 ? 2 : n, rows = Math.ceil(n / cols);
  const pw = w / cols, ph = h / rows;
  const X0 = -100, X1 = 120, Y0 = -146, Y1 = 98;                       // mm box of every head
  const s = Math.min((pw - 16) / (X1 - X0), (ph - 44) / (Y1 - Y0));
  panels.forEach((P, i) => {
    const cx = (i % cols) * pw, cy = Math.floor(i / cols) * ph;
    const ox = cx + (pw - s * (X1 - X0)) / 2, oy = cy + 26 + (ph - 44 - s * (Y1 - Y0)) / 2;
    const X = x => ox + (x - X0) * s, Y = y => oy + (Y1 - y) * s;
    g.fillStyle = INK; g.font = '600 12px Inter, system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(P.label, cx + pw / 2, cy + 15, pw - 6);
    if (P.sub) { g.fillStyle = DIM; g.font = '11px Inter, system-ui, sans-serif'; g.fillText(P.sub, cx + pw / 2, cy + ph - 6, pw - 6); }
    if (P.ref) {
      g.strokeStyle = 'rgba(216,222,230,0.28)'; g.lineWidth = 1; g.setLineDash([3, 3]);
      g.beginPath(); for (let v = 0; v < N_V; v++) g[v ? 'lineTo' : 'moveTo'](X(P.ref[2 * v]), Y(P.ref[2 * v + 1])); g.stroke(); g.setLineDash([]);
    }
    g.lineWidth = 2.6; g.lineCap = 'round';
    for (let v = 0; v < N_V - 1; v++) {
      g.strokeStyle = P.err ? errColor(0.5 * (P.err[v] + P.err[v + 1])) : P.regions ? REGION_COLORS[regionOf(v)] : (P.color || INK);
      g.beginPath(); g.moveTo(X(P.pts[2 * v]), Y(P.pts[2 * v + 1])); g.lineTo(X(P.pts[2 * v + 2]), Y(P.pts[2 * v + 3])); g.stroke();
    }
    if (P.cuts) for (const v of P.cuts) {
      g.strokeStyle = '#ff3b6b'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(X(P.pts[2 * v]), Y(P.pts[2 * v + 1]), 7, 0, 2 * Math.PI); g.stroke();
    }
  });
}

// Error chart. c = { global: [[K, mm]], regional: [[K, mm]] }, wall = N - 1,
// at = { kg, kr } the current K of each model.
export function drawChart(cv, c, wall, at) {
  const { g, w, h } = fit(cv);
  const L = 44, R = 12, T = 12, B = 34, xmax = Math.max(c.regional.at(-1)[0], wall + 1) * 1.15;
  const ymax = Math.max(0.5, Math.ceil(2 * Math.max(...c.global.map(p => p[1]), ...c.regional.map(p => p[1]))) / 2);
  const X = k => L + Math.log(k) / Math.log(xmax) * (w - L - R), Y = e => T + (1 - e / ymax) * (h - T - B);
  g.strokeStyle = LINE; g.lineWidth = 1; g.fillStyle = DIM; g.font = '10px ui-monospace, monospace'; g.textAlign = 'right';
  for (let e = 0; e <= ymax + 1e-9; e += ymax > 2 ? 1 : 0.5) { g.beginPath(); g.moveTo(L, Y(e)); g.lineTo(w - R, Y(e)); g.stroke(); g.fillText(e.toFixed(1), L - 6, Y(e) + 3); }
  g.textAlign = 'center';
  for (const k of [1, 10, 100, 1000]) if (k < xmax) { g.beginPath(); g.moveTo(X(k), T); g.lineTo(X(k), h - B); g.stroke(); g.fillText(String(k), X(k), h - B + 13); }
  g.fillText('coefficients K (log)', (L + w - R) / 2, h - 6);
  g.save(); g.translate(11, (T + h - B) / 2); g.rotate(-Math.PI / 2); g.fillText('held-out error (mm)', 0, 0); g.restore();
  // the wall
  g.fillStyle = 'rgba(255,154,98,0.07)'; g.fillRect(X(wall), T, w - R - X(wall), h - T - B);
  g.strokeStyle = '#ff9a62'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(wall), T); g.lineTo(X(wall), h - B); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#ff9a62'; g.textAlign = 'left'; g.font = '11px Inter, system-ui, sans-serif';
  g.fillText(`N − 1 = ${wall}`, X(wall) + 5, T + 12);
  g.fillStyle = DIM; g.fillText('no global modes here', X(wall) + 5, T + 26);
  const line = (pts, col) => {
    g.strokeStyle = col; g.lineWidth = 2.2; g.beginPath();
    pts.forEach(([k, e], i) => g[i ? 'lineTo' : 'moveTo'](X(k), Y(e))); g.stroke();
    g.fillStyle = col; for (const [k, e] of pts) { g.beginPath(); g.arc(X(k), Y(e), 2.2, 0, 2 * Math.PI); g.fill(); }
  };
  const gfl = c.global.at(-1)[1];
  g.strokeStyle = 'rgba(255,154,98,0.45)'; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(X(wall), Y(gfl)); g.lineTo(w - R, Y(gfl)); g.stroke(); g.setLineDash([]);
  line(c.global, '#ff9a62'); line(c.regional, '#62c4ff');
  if (at) {
    const near = (pts, k) => pts.reduce((b, p) => Math.abs(Math.log(p[0] / k)) < Math.abs(Math.log(b[0] / k)) ? p : b);
    for (const [pts, k, col] of [[c.global, at.kg, '#ff9a62'], [c.regional, at.kr, '#62c4ff']]) {
      const p = near(pts, k); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(X(p[0]), Y(p[1]), 5.5, 0, 2 * Math.PI); g.stroke();
      g.fillStyle = col; g.beginPath(); g.arc(X(p[0]), Y(p[1]), 3.5, 0, 2 * Math.PI); g.fill();
    }
  }
}

// The vertex index at each region cut (for seam marks).
export function cutVertices(regions) {
  const { span } = template(), out = [];
  for (const r of regions) { if (span[r][0] > 0) out.push(span[r][0]); if (span[r][1] < N_V) out.push(span[r][1] - 1); }
  return out;
}

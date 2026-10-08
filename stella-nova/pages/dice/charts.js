// ============================================================================
//  DICE LAB  ·  charts.js — the face histogram and the totals plot (2D canvas)
// ----------------------------------------------------------------------------
//  faceChart(canvas, o)   bars of the observed count per face. A line marks
//                         the expected count n p, and a band marks n p ±
//                         2 sqrt(n p (1 - p)), where about 95% of fair bars
//                         fall. o = { labels, counts, shares, colour }
//  totalsChart(canvas, o) bars of the observed share of each total, the
//                         exact distribution as dots joined by a line, and
//                         the normal curve with the same mean and variance
//                         (dashed). o = { pmf, hist, n, colour, mark }
//  Both size the backing store to the CSS size times devicePixelRatio.
// ============================================================================
import { moments } from './prob.js';

const INK = '#d9d2c6', DIM = '#8b8579', GRID = 'rgba(255,255,255,0.07)', EXP = '#ffd27a';

function prep(cv) {
  const r = cv.getBoundingClientRect(), dp = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
  if (cv.width !== w * dp || cv.height !== h * dp) { cv.width = w * dp; cv.height = h * dp; }
  const g = cv.getContext('2d'); g.setTransform(dp, 0, 0, dp, 0, 0); g.clearRect(0, 0, w, h);
  g.font = '12px Inter, system-ui, sans-serif'; g.textBaseline = 'middle';
  return { g, w, h };
}

export function faceChart(cv, { labels, counts, shares, colour = '#7fb2ff' }) {
  const { g, w, h } = prep(cv);
  const n = counts.reduce((a, b) => a + b, 0), k = labels.length;
  const L = 34, R = 6, T = 8, B = 20, pw = w - L - R, ph = h - T - B;
  const exp = shares.map(p => n * p), sd = shares.map(p => 2 * Math.sqrt(n * p * (1 - p)));
  const raw = Math.max(1, ...counts, ...exp.map((e, i) => e + sd[i])) * 1.08;
  // whole-number ticks: a step of 1, 2, 5 x 10^k
  const st = (() => { const r = raw / 3, p = Math.pow(10, Math.floor(Math.log10(r))); return [1, 2, 5, 10].map(m => m * p).find(x => x >= r) || r; })();
  const step = Math.max(1, Math.round(st)), top = Math.ceil(raw / step) * step;
  const Y = v => T + ph - v / top * ph;
  g.strokeStyle = GRID; g.fillStyle = DIM; g.lineWidth = 1; g.textAlign = 'right';
  for (let v = 0; v <= top + 1e-9; v += step) { const y = Y(v); g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke(); g.fillText(String(v), L - 5, y); }
  const bw = pw / k;
  for (let i = 0; i < k; i++) {
    const x = L + i * bw;
    // the 95% band of a fair die
    g.fillStyle = 'rgba(255,210,122,0.10)';
    g.fillRect(x + bw * 0.08, Y(exp[i] + sd[i]), bw * 0.84, Y(Math.max(0, exp[i] - sd[i])) - Y(exp[i] + sd[i]));
    g.fillStyle = colour; g.globalAlpha = 0.85;
    g.fillRect(x + bw * 0.18, Y(counts[i]), bw * 0.64, T + ph - Y(counts[i]));
    g.globalAlpha = 1;
    g.strokeStyle = EXP; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x + bw * 0.08, Y(exp[i])); g.lineTo(x + bw * 0.92, Y(exp[i])); g.stroke();
    if (bw > 12 || i % 2 === 0) { g.fillStyle = INK; g.textAlign = 'center'; g.fillText(labels[i] || '·', x + bw / 2, h - B / 2 + 2); }
  }
  if (!n) { g.fillStyle = DIM; g.textAlign = 'center'; g.fillText('no rolls yet', L + pw / 2, T + ph / 2); }
}

export function totalsChart(cv, { pmf, hist, n, colour = '#7fb2ff', mark = null }) {
  const { g, w, h } = prep(cv);
  const L = 34, R = 6, T = 8, B = 20, pw = w - L - R, ph = h - T - B;
  // the shown range: the exact support, trimmed to 1e-4 tails when wide
  let lo = pmf.lo, hi = pmf.lo + pmf.p.length - 1;
  if (hi - lo > 60) { let c = 0, i0 = 0; while (c + pmf.p[i0] < 1e-4) c += pmf.p[i0++]; let d = 0, i1 = pmf.p.length - 1; while (d + pmf.p[i1] < 1e-4) d += pmf.p[i1--]; lo = pmf.lo + i0; hi = pmf.lo + i1; }
  const k = hi - lo + 1, bw = pw / k;
  const obs = x => n ? (hist[x] || 0) / n : 0;
  const m = moments(pmf);
  const nrm = x => Math.exp(-((x - m.mean) ** 2) / (2 * m.var || 1)) / Math.sqrt(2 * Math.PI * (m.var || 1));
  let top = 0;
  for (let x = lo; x <= hi; x++) top = Math.max(top, pmf.p[x - pmf.lo] || 0, obs(x), m.var > 0 ? nrm(x) : 0);
  top *= 1.1;
  const Y = v => T + ph - v / top * ph, X = x => L + (x - lo + 0.5) * bw;
  g.strokeStyle = GRID; g.fillStyle = DIM; g.lineWidth = 1; g.textAlign = 'right';
  for (let i = 0; i <= 3; i++) { const v = top * i / 3, y = Y(v); g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke(); g.fillText((v * 100).toFixed(v * 100 < 10 ? 1 : 0) + '%', L - 5, y); }
  // observed bars
  for (let x = lo; x <= hi; x++) {
    const v = obs(x); if (!v) continue;
    g.fillStyle = x === mark ? '#ffb070' : colour; g.globalAlpha = 0.8;
    g.fillRect(X(x) - bw * 0.36, Y(v), bw * 0.72, T + ph - Y(v));
  }
  g.globalAlpha = 1;
  // normal curve
  if (m.var > 0) {
    g.setLineDash([4, 4]); g.strokeStyle = 'rgba(200,190,255,0.75)'; g.lineWidth = 1.2; g.beginPath();
    for (let i = 0; i <= 120; i++) { const x = lo - 0.5 + (k * i) / 120, y = Y(nrm(x)); i ? g.lineTo(L + (x - lo + 0.5) * bw, y) : g.moveTo(L + (x - lo + 0.5) * bw, y); }
    g.stroke(); g.setLineDash([]);
  }
  // exact distribution
  g.strokeStyle = EXP; g.fillStyle = EXP; g.lineWidth = 1.6; g.beginPath();
  for (let x = lo; x <= hi; x++) { const y = Y(pmf.p[x - pmf.lo] || 0); x > lo ? g.lineTo(X(x), y) : g.moveTo(X(x), y); }
  g.stroke();
  if (bw > 5) for (let x = lo; x <= hi; x++) { g.beginPath(); g.arc(X(x), Y(pmf.p[x - pmf.lo] || 0), 2, 0, Math.PI * 2); g.fill(); }
  // x labels
  g.fillStyle = INK; g.textAlign = 'center';
  const step = Math.max(1, Math.ceil(k / Math.max(2, Math.floor(pw / 26))));
  for (let x = lo; x <= hi; x++) if ((x - lo) % step === 0) g.fillText(String(x), X(x), h - B / 2 + 2);
}

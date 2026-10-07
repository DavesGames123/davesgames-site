// ============================================================================
//  ROCHE LIMIT  ·  plots.js — the four live plots (canvas 2D)
// ----------------------------------------------------------------------------
//  gauge    the ratio a_tide / g at the satellite surface, log scale. The
//           three marks are where each analytic limit puts the ratio:
//           1 (rigid, no spin), 2/3 (rigid, synchronous), 2/2.44^3 = 0.138
//           (fluid). The ratio is 2 q (R_p/d)^3, so a mark is a distance.
//  bound    bound mass fraction against time in orbits, one line per
//           satellite
//  energy   |d(E - W)| / |U_self| against time, log scale: the energy
//           ledger of the integrator (W: work of the contacts)
//  runs     bound mass after 3 orbits against d / (R_p q^(1/3)): the runs
//           of this session (filled) and the reference sweep measured with
//           this code (open), with the rigid, synchronous and fluid limits
//
//  grep -n targets: "drawGauge", "drawBound", "drawEnergy", "drawRuns"
// ============================================================================

export const MAT_COLOR = { fluid: '#62c4ff', rigid: '#ff9a62', cohesive: '#86dc7c' };
const INK = '#d8dfe8', DIM = '#7d8796', FAINT = 'rgba(160,180,210,0.14)';
const FONT = '500 11px Inter, system-ui, sans-serif', MONO = '11px ui-monospace, Menlo, monospace';

function fit(c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(10, c.clientWidth), h = Math.max(10, c.clientHeight || +c.getAttribute('height'));
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  return { g, w, h };
}

export function drawGauge(c, ratio) {
  const { g, w, h } = fit(c);
  const lo = Math.log10(0.03), hi = Math.log10(10);
  const X = r => 8 + (w - 16) * (Math.log10(r) - lo) / (hi - lo);
  const y0 = 18, bh = 10;
  const gr = g.createLinearGradient(X(0.03), 0, X(10), 0);
  gr.addColorStop(0, '#1b3a5a'); gr.addColorStop((Math.log10(0.138) - lo) / (hi - lo), '#2f7fa8');
  gr.addColorStop((Math.log10(0.667) - lo) / (hi - lo), '#c0883e'); gr.addColorStop((Math.log10(1) - lo) / (hi - lo), '#d0503a'); gr.addColorStop(1, '#6a1830');
  g.fillStyle = gr; g.beginPath(); g.roundRect(X(0.03), y0, X(10) - X(0.03), bh, 4); g.fill();
  const marks = [[0.138, 'fluid', MAT_COLOR.fluid], [0.667, 'sync', '#ffd666'], [1, 'rigid', MAT_COLOR.rigid]];
  g.font = FONT; g.textAlign = 'center';
  marks.forEach(([r, name, col], i) => {
    const x = X(r);
    g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y0 - 4); g.lineTo(x, y0 + bh + 4); g.stroke();
    // the sync and rigid marks are close: one name to each side
    g.fillStyle = col; g.textAlign = i === 1 ? 'right' : i === 2 ? 'left' : 'center';
    g.fillText(name, x + (i === 1 ? -3 : i === 2 ? 3 : 0), y0 + bh + 16);
  });
  g.fillStyle = DIM; g.textAlign = 'left'; g.font = MONO;
  g.fillText('0.03', 4, 11); g.textAlign = 'right'; g.fillText('10', w - 4, 11);
  if (Number.isFinite(ratio) && ratio > 0) {
    const x = Math.max(X(0.03), Math.min(X(10), X(ratio)));
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(x, y0 - 1); g.lineTo(x - 6, y0 - 10); g.lineTo(x + 6, y0 - 10); g.closePath(); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + bh); g.stroke();
  }
}

function axes(g, w, h, pad, xMax, yTicks, yLabel) {
  g.strokeStyle = FAINT; g.lineWidth = 1; g.font = MONO; g.fillStyle = DIM;
  for (const [v, y] of yTicks) { g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke(); g.textAlign = 'right'; g.fillText(v, pad.l - 4, y + 3); }
  g.textAlign = 'right'; g.fillText(xMax, w - pad.r, h - 3);
  g.textAlign = 'left'; g.fillText(yLabel, pad.l, h - 3);
}

// series: [{ pts: [[t, f], ...], color }]
export function drawBound(c, series, tMax, unit = 'orbits') {
  const { g, w, h } = fit(c);
  const pad = { l: 30, r: 6, t: 6, b: 14 };
  const X = t => pad.l + (w - pad.l - pad.r) * t / tMax, Y = f => pad.t + (h - pad.t - pad.b) * (1 - f);
  axes(g, w, h, pad, tMax.toFixed(tMax < 10 ? 1 : 0) + ' ' + unit, [['100%', Y(1)], ['50%', Y(0.5)], ['0', Y(0)]], 't');
  for (const s of series) {
    if (s.pts.length < 1) continue;
    g.strokeStyle = s.color; g.lineWidth = 2; g.beginPath();
    s.pts.forEach(([t, f], i) => { const x = X(Math.min(t, tMax)), y = Y(f); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    const [t, f] = s.pts[s.pts.length - 1];
    g.fillStyle = s.color; g.beginPath(); g.arc(X(Math.min(t, tMax)), Y(f), 3, 0, 7); g.fill();
  }
}

export function drawEnergy(c, series, tMax, unit = 'orbits') {
  const { g, w, h } = fit(c);
  const pad = { l: 34, r: 6, t: 6, b: 14 };
  const lo = -7, hi = 0;
  const X = t => pad.l + (w - pad.l - pad.r) * t / tMax, Y = v => pad.t + (h - pad.t - pad.b) * (1 - (Math.max(lo, Math.min(hi, Math.log10(Math.max(v, 1e-12)))) - lo) / (hi - lo));
  axes(g, w, h, pad, tMax.toFixed(tMax < 10 ? 1 : 0) + ' ' + unit, [['1', Y(1)], ['1e-3', Y(1e-3)], ['1e-6', Y(1e-6)]], 't');
  for (const s of series) {
    if (s.pts.length < 2) continue;
    g.strokeStyle = s.color; g.lineWidth = 1.6; g.beginPath();
    s.pts.forEach(([t, v], i) => { const x = X(Math.min(t, tMax)), y = Y(v); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  }
}

// pts, ref: [{ x, y, mat }]; x = d / (R_p q^(1/3)); cur: the current x
export function drawRuns(c, pts, ref, cur) {
  const { g, w, h } = fit(c);
  const pad = { l: 30, r: 8, t: 8, b: 16 };
  const x0 = 0.8, x1 = 3.4;
  const X = x => pad.l + (w - pad.l - pad.r) * (x - x0) / (x1 - x0), Y = f => pad.t + (h - pad.t - pad.b) * (1 - f);
  axes(g, w, h, pad, '', [['100%', Y(1)], ['50%', Y(0.5)], ['0', Y(0)]], '');
  g.font = MONO; g.fillStyle = DIM; g.textAlign = 'center';
  for (const t of [1, 1.5, 2, 2.5, 3]) g.fillText(t.toString(), X(t), h - 3);
  const lim = [[1.26, 'rigid', MAT_COLOR.rigid], [1.44, 'sync', '#ffd666'], [2.44, 'fluid', MAT_COLOR.fluid]];
  g.setLineDash([3, 3]);
  for (const [x, name, col] of lim) { g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(X(x), pad.t); g.lineTo(X(x), h - pad.b); g.stroke(); }
  g.setLineDash([]);
  g.font = FONT; g.textAlign = 'left';
  lim.forEach(([x, name, col], i) => { g.fillStyle = col; g.fillText(name, X(x) + 3, pad.t + 9 + 11 * (i % 2)); });
  // reference sweep: one line per material
  const byMat = {};
  for (const p of ref) (byMat[p.mat] = byMat[p.mat] || []).push(p);
  for (const [m, list] of Object.entries(byMat)) {
    list.sort((a, b) => a.x - b.x);
    g.strokeStyle = MAT_COLOR[m]; g.globalAlpha = 0.45; g.lineWidth = 1.2; g.beginPath();
    list.forEach((p, i) => i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))); g.stroke(); g.globalAlpha = 1;
    for (const p of list) { g.strokeStyle = MAT_COLOR[m]; g.lineWidth = 1.4; g.beginPath(); g.arc(X(p.x), Y(p.y), 3, 0, 7); g.stroke(); }
  }
  for (const p of pts) { g.fillStyle = MAT_COLOR[p.mat] || INK; g.beginPath(); g.arc(X(Math.min(x1, Math.max(x0, p.x))), Y(p.y), 4, 0, 7); g.fill(); }
  if (Number.isFinite(cur)) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(Math.min(x1, Math.max(x0, cur))), pad.t); g.lineTo(X(Math.min(x1, Math.max(x0, cur))), h - pad.b); g.stroke(); }
}

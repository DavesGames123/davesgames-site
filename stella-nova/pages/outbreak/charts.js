// ============================================================================
//  OUTBREAK  ·  charts.js — the compartment curves and the R_eff strip
// ----------------------------------------------------------------------------
//  createChart(canvas) draws sim.history on a 2D canvas: one line for each
//  compartment (S, E, I, R, D, V) against the day, a dashed mark at the
//  start day of each active policy, and a thin strip at the base with the
//  global R_eff and its line at 1. The y axis is log or linear.
//
//  The chart owns no simulation state. main.js calls draw() each frame (or
//  each HUD tick). draw() returns at once when the history length, the
//  active policies, the scale and the canvas size are the same as before.
//
//  API:
//    createChart(canvas, { log = true, dprCap = 2 }) -> Chart
//    Chart = { draw(history, active, disease), setLog(bool), log,
//              invalidate(), dispose() }
//    history  = sim.history (model.js): { day, S, E, I, R, D, V, reff }
//    active   = sim.active, { policyId: dayStarted }
//    disease  = the Disease; disease.latent 0 hides the E line
//
//  Pure helpers (exported for the node tests):
//    niceStep(span, n), linTicks(lo, hi, n), logTicks(lo, hi),
//    makeScale(lo, hi, a, b, log), fmtCount(v), yRange(history, keys, log),
//    stride(n, px), policyMarks(active, names)
//
//  grep -n targets: "export const SERIES", "export function niceStep",
//    "export function linTicks", "export function logTicks",
//    "export function makeScale", "export function fmtCount",
//    "export function yRange", "export function stride",
//    "export function policyMarks", "export function createChart"
// ============================================================================

export const SOURCES = [];

// Series colors follow style.css (--cool, --warm, --hot, --ok).
export const SERIES = [
  { key: 'S', label: 'Susceptible', color: '#7fd1ff', width: 1.2 },
  { key: 'E', label: 'Exposed', color: '#ffd166', width: 1.2 },
  { key: 'I', label: 'Infectious', color: '#ff4d5e', width: 2.0 },
  { key: 'R', label: 'Recovered', color: '#86dc7c', width: 1.2 },
  { key: 'D', label: 'Deaths', color: '#c9b8d8', width: 1.4 },
  { key: 'V', label: 'Vaccinated', color: '#5ce0c6', width: 1.2 },
];

// A 1, 2 or 5 x 10^k step so that `span` holds about `n` steps.
export function niceStep(span, n = 5) {
  if (!(span > 0) || !(n > 0)) return 1;
  const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

// Ticks at multiples of niceStep inside [lo, hi].
export function linTicks(lo, hi, n = 5) {
  if (!(hi > lo)) return [lo];
  const s = niceStep(hi - lo, n), out = [];
  for (let v = Math.ceil(lo / s - 1e-9) * s; v <= hi + s * 1e-9; v += s) out.push(+v.toPrecision(12));
  return out;
}

// Powers of ten inside [lo, hi] (lo > 0). If the range holds more than
// eight decades, keep every second decade.
export function logTicks(lo, hi) {
  if (!(lo > 0) || !(hi >= lo)) return [];
  const a = Math.ceil(Math.log10(lo) - 1e-9), b = Math.floor(Math.log10(hi) + 1e-9);
  const step = b - a > 8 ? 2 : 1, out = [];
  for (let k = a; k <= b; k += step) out.push(Math.pow(10, k));
  return out;
}

// Map [lo, hi] to pixels [a, b]. Log scale clamps v at lo first.
export function makeScale(lo, hi, a, b, log = false) {
  if (log) {
    const l0 = Math.log10(lo), l1 = Math.log10(hi), k = (b - a) / ((l1 - l0) || 1);
    return v => a + (Math.log10(Math.max(v, lo)) - l0) * k;
  }
  const k = (b - a) / ((hi - lo) || 1);
  return v => a + (v - lo) * k;
}

// 1234 -> '1.2k', 7.66e9 -> '7.7bn'.
export function fmtCount(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return +(v / 1e9).toPrecision(2) + 'bn';
  if (a >= 1e6) return +(v / 1e6).toPrecision(2) + 'M';
  if (a >= 1e3) return +(v / 1e3).toPrecision(2) + 'k';
  if (a >= 1 || a === 0) return String(Math.round(v));
  return +v.toPrecision(1) + '';
}

// The y range over the given series. Log: [1, top decade]. Linear:
// [0, max x 1.05]. Empty history gives a range that still draws.
export function yRange(history, keys, log) {
  let max = 0;
  for (const k of keys) {
    const a = history && history[k];
    if (!a) continue;
    for (let i = 0; i < a.length; i++) if (a[i] > max) max = a[i];
  }
  if (log) return [1, Math.pow(10, Math.max(1, Math.ceil(Math.log10(Math.max(max, 10)))))];
  return [0, max > 0 ? max * 1.05 : 1];
}

// Points to skip so that about one point lands on each pixel.
export function stride(n, px) {
  return Math.max(1, Math.floor(n / Math.max(1, px)));
}

// Policy marks sorted by start day: [{ id, day, label }].
export function policyMarks(active, names = {}) {
  const out = [];
  for (const id in active || {}) {
    const day = active[id];
    if (typeof day === 'number' && Number.isFinite(day)) out.push({ id, day, label: names[id] || id });
  }
  return out.sort((a, b) => a.day - b.day || (a.id < b.id ? -1 : 1));
}

const STRIP_H = 16, PAD = { l: 38, r: 8, t: 6, b: 14 };

export function createChart(canvas, { log = true, dprCap = 2, names = {} } = {}) {
  const ctx = canvas.getContext('2d');
  const chart = { log: !!log, draw, setLog, invalidate, dispose };
  let key = '', alive = true;

  function setLog(b) { if (chart.log !== !!b) { chart.log = !!b; key = ''; } }
  function invalidate() { key = ''; }
  function dispose() { alive = false; }

  function size() {
    const dpr = Math.min(dprCap, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const w = Math.max(1, Math.round((canvas.clientWidth || canvas.width) * dpr));
    const h = Math.max(1, Math.round((canvas.clientHeight || canvas.height) * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    return { w, h, dpr };
  }

  function draw(history, active, disease) {
    if (!alive || !ctx || !history || !history.day) return false;
    const { w, h, dpr } = size();
    const n = history.day.length;
    const marks = policyMarks(active, names);
    const k = `${n}|${chart.log}|${w}x${h}|${marks.map(m => m.id + m.day).join(',')}|${disease ? disease.id + disease.latent : ''}`;
    if (k === key) return false;
    key = k;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.scale(dpr, dpr);
    const W = w / dpr, H = h / dpr;
    const x0 = PAD.l, x1 = W - PAD.r, y0 = PAD.t, y1 = H - PAD.b - STRIP_H - 4;
    const s0 = H - PAD.b - STRIP_H, s1 = H - PAD.b;
    if (x1 - x0 < 20 || y1 - y0 < 10) return true;

    const keys = SERIES.filter(s => s.key !== 'E' || !disease || disease.latent > 0)
      .filter(s => history[s.key]).map(s => s.key);
    const lastDay = n ? history.day[n - 1] : 0;
    const dMax = Math.max(30, lastDay);
    const [lo, hi] = yRange(history, keys, chart.log);
    const sx = makeScale(0, dMax, x0, x1), sy = makeScale(lo, hi, y1, y0, chart.log);

    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.lineWidth = 1;
    // y grid and labels
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const yt = chart.log ? logTicks(lo, hi) : linTicks(lo, hi, 4);
    for (const v of yt) {
      const y = Math.round(sy(v)) + 0.5;
      ctx.strokeStyle = 'rgba(200,180,220,0.10)';
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.fillStyle = '#4a5262'; ctx.fillText(fmtCount(v), x0 - 4, y);
    }
    // x labels (days)
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const d of linTicks(0, dMax, Math.max(2, Math.floor((x1 - x0) / 70)))) {
      ctx.fillStyle = '#4a5262'; ctx.fillText(String(d), sx(d), s1 + 2);
    }
    // policy marks
    ctx.setLineDash([3, 3]); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    let lastLabelX = -1e9;
    for (const m of marks) {
      const x = Math.round(sx(m.day)) + 0.5;
      ctx.strokeStyle = 'rgba(255,138,92,0.45)';
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, s1); ctx.stroke();
      if (x - lastLabelX > 60) { ctx.fillStyle = '#ff8a5c'; ctx.fillText(m.label, x + 3, y0); lastLabelX = x; }
    }
    ctx.setLineDash([]);
    // curves
    const st = stride(n, x1 - x0);
    ctx.lineJoin = 'round';
    for (const s of SERIES) {
      if (!keys.includes(s.key)) continue;
      const a = history[s.key];
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.beginPath();
      for (let i = 0; i < n; i += st) {
        const x = sx(history.day[i]), y = sy(a[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      if (n > 1 && (n - 1) % st) ctx.lineTo(sx(history.day[n - 1]), sy(a[n - 1]));
      ctx.stroke();
    }
    // R_eff strip: 0 .. max(3, peak), line at 1
    const r = history.reff || [];
    ctx.fillStyle = 'rgba(20,24,34,0.6)'; ctx.fillRect(x0, s0, x1 - x0, STRIP_H);
    let rMax = 3;
    for (let i = 0; i < r.length; i++) if (r[i] > rMax) rMax = r[i];
    const sr = makeScale(0, rMax, s1, s0);
    const y1r = Math.round(sr(1)) + 0.5;
    ctx.strokeStyle = 'rgba(230,233,240,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y1r); ctx.lineTo(x1, y1r); ctx.stroke();
    ctx.lineWidth = 1.4;
    for (let i = st; i < r.length; i += st) {
      const j = i - st;
      ctx.strokeStyle = (r[i] + r[j]) / 2 > 1 ? '#ff4d5e' : '#86dc7c';
      ctx.beginPath(); ctx.moveTo(sx(history.day[j]), sr(r[j])); ctx.lineTo(sx(history.day[i]), sr(r[i])); ctx.stroke();
    }
    ctx.fillStyle = '#919aab'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText('R', x0 - 4, (s0 + s1) / 2);
    if (r.length) { ctx.textAlign = 'left'; ctx.fillText(r[r.length - 1].toFixed(2), x0 + 3, s0 + 6); }
    // legend
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    let lx = x0 + 4;
    for (const s of SERIES) {
      if (!keys.includes(s.key)) continue;
      ctx.fillStyle = s.color; ctx.fillText(s.key, lx, y0 + 12); lx += 14;
    }
    return true;
  }

  return chart;
}

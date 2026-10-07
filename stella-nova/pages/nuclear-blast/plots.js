// ============================================================================
//  NUCLEAR BLAST  ·  plots.js — the five live plots of the analysis panel
// ----------------------------------------------------------------------------
//  createPlot(canvas, spec) draws one 2D plot with one y axis (never two),
//  log or linear axes, thin 2 px series, dashed reference lines with direct
//  labels, a time or range cursor, and a hover crosshair with a tooltip
//  that lists every series at the pointer. The static layer is cached in
//  an offscreen canvas; only the cursor is drawn each frame.
//
//  The series colours were checked with the dataviz palette validator for
//  a dark surface (#0c0e16): amber #c47e22, blue #4f8ff0, rose #d45a78
//  pass the lightness band, chroma, CVD and contrast checks.
//
//  makeCurves(burst, pick) builds the data of all five plots from
//  effects.js: pressure against range, the waveform at the picked point,
//  the thermal pulse, the fireball and shock radii, and the cloud top.
//
//  GREP MAP
//    export const SERIES ...... the palette
//    function createPlot ...... axes, cache, cursor, hover
//    function makeCurves ...... the data of the five plots
// ============================================================================
import * as E from './effects.js';

export const SERIES = { amber: '#c47e22', blue: '#4f8ff0', rose: '#d45a78' };
const INK = { grid: 'rgba(200,205,220,0.08)', axis: 'rgba(200,205,220,0.35)', text: 'rgba(205,208,222,0.78)', mute: 'rgba(160,165,185,0.6)', ref: 'rgba(220,220,235,0.32)' };

export function fmtNum(v, unit = '') {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = a >= 1e5 ? v.toExponential(1) : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : a >= 0.01 ? v.toFixed(3) : v.toExponential(1);
  return s + unit;
}
export function fmtTime(t) {
  if (t < 1e-3) return (t * 1e6).toFixed(t < 1e-5 ? 1 : 0) + ' µs';
  if (t < 1) return (t * 1e3).toFixed(t < 0.01 ? 1 : 0) + ' ms';
  if (t < 60) return t.toFixed(t < 10 ? 2 : 1) + ' s';
  if (t < 3600) return Math.floor(t / 60) + ' min ' + String(Math.round(t % 60)).padStart(2, '0') + ' s';
  return (t / 3600).toFixed(1) + ' h';
}
export function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(m >= 1e5 ? 0 : m >= 1e4 ? 1 : 2) + ' km' : m.toFixed(0) + ' m'; }

// spec: { xlog, ylog, xfmt(v), yfmt(v), xlab, ylab, tip(x) -> html }
export function createPlot(canvas, spec) {
  const P = { data: null, cache: null, map: null, hover: null };
  const wrap = canvas.parentElement;
  let tip = wrap.querySelector('.ptip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'ptip'; wrap.appendChild(tip); }
  const tr = (v, lg) => lg ? Math.log10(Math.max(v, 1e-30)) : v;
  function layout(w, h, dpr) {
    const D = P.data, padL = 40 * dpr, padR = 10 * dpr, padT = 8 * dpr, padB = 22 * dpr;
    const xr = D.xr, yr = D.yr;
    const X0 = tr(xr[0], spec.xlog), X1 = tr(xr[1], spec.xlog), Y0 = tr(yr[0], spec.ylog), Y1 = tr(yr[1], spec.ylog);
    return {
      padL, padR, padT, padB, w, h, dpr,
      X: v => padL + (tr(v, spec.xlog) - X0) / (X1 - X0) * (w - padL - padR),
      Y: v => h - padB - (tr(v, spec.ylog) - Y0) / (Y1 - Y0) * (h - padT - padB),
      inv: px => { const u = (px - padL) / (w - padL - padR), v = X0 + u * (X1 - X0); return spec.xlog ? Math.pow(10, v) : v; },
    };
  }
  function ticks(a, b, lg) {
    const out = [];
    if (lg) { for (let e = Math.ceil(Math.log10(a) - 1e-9); e <= Math.floor(Math.log10(b) + 1e-9); e++) out.push(Math.pow(10, e)); }
    else { const span = b - a, st = Math.pow(10, Math.floor(Math.log10(span / 4))), step = span / st > 20 ? st * 5 : span / st > 8 ? st * 2 : st; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(v); }
    return out;
  }
  function build(w, h, dpr) {
    const off = document.createElement('canvas'); off.width = w; off.height = h;
    const g = off.getContext('2d'), L = layout(w, h, dpr), D = P.data;
    g.font = `${10 * dpr}px Inter, system-ui, sans-serif`;
    g.lineWidth = 1;
    // grid and ticks
    const xt = ticks(D.xr[0], D.xr[1], spec.xlog), yt = ticks(D.yr[0], D.yr[1], spec.ylog);
    g.strokeStyle = INK.grid; g.fillStyle = INK.mute;
    for (const v of xt) { const x = L.X(v); g.beginPath(); g.moveTo(x, L.padT); g.lineTo(x, h - L.padB); g.stroke(); g.textAlign = 'center'; g.fillText(spec.xfmt(v), x, h - 7 * dpr); }
    for (const v of yt) { const y = L.Y(v); g.beginPath(); g.moveTo(L.padL, y); g.lineTo(w - L.padR, y); g.stroke(); g.textAlign = 'right'; g.fillText(spec.yfmt(v), L.padL - 5 * dpr, y + 3 * dpr); }
    g.strokeStyle = INK.axis; g.beginPath(); g.moveTo(L.padL, L.padT); g.lineTo(L.padL, h - L.padB); g.lineTo(w - L.padR, h - L.padB); g.stroke();
    // reference lines, labelled at the right end
    g.setLineDash([4 * dpr, 4 * dpr]); g.strokeStyle = INK.ref; g.textAlign = 'right'; g.fillStyle = INK.mute;
    for (const r of D.refs || []) { if (r.y < D.yr[0] || r.y > D.yr[1]) continue; const y = L.Y(r.y); g.beginPath(); g.moveTo(L.padL, y); g.lineTo(w - L.padR, y); g.stroke(); g.fillText(r.label, w - L.padR - 2 * dpr, y - 3 * dpr); }
    for (const r of D.vrefs || []) { if (r.x < D.xr[0] || r.x > D.xr[1]) continue; const x = L.X(r.x); g.beginPath(); g.moveTo(x, L.padT); g.lineTo(x, h - L.padB); g.stroke(); g.textAlign = 'left'; g.fillText(r.label, x + 3 * dpr, L.padT + 9 * dpr); }
    g.setLineDash([]);
    // series
    g.save(); g.beginPath(); g.rect(L.padL, L.padT, w - L.padL - L.padR, h - L.padT - L.padB); g.clip();
    for (const s of D.series) {
      g.strokeStyle = s.color; g.lineWidth = 2 * dpr; g.setLineDash(s.dash ? [5 * dpr, 4 * dpr] : []);
      g.beginPath(); let on = false;
      for (const [x, y] of s.pts) { if (!(y > 0) && spec.ylog) { on = false; continue; } const px = L.X(x), py = L.Y(y); on ? g.lineTo(px, py) : g.moveTo(px, py); on = true; }
      g.stroke();
      for (const m of s.marks || []) { g.fillStyle = s.color; g.beginPath(); g.arc(L.X(m[0]), L.Y(m[1]), 4 * dpr, 0, 6.2832); g.fill(); g.strokeStyle = '#0c0e16'; g.lineWidth = 2 * dpr; g.stroke(); }
    }
    g.restore(); g.setLineDash([]);
    P.cache = off; P.map = L;
  }
  P.set = data => { P.data = data; P.cache = null; };
  P.draw = cursor => {
    if (!P.data) return;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; P.cache = null; }
    if (!P.cache) build(w, h, dpr);
    const g = canvas.getContext('2d'), L = P.map;
    g.clearRect(0, 0, w, h); g.drawImage(P.cache, 0, 0);
    const c = cursor ?? P.data.cursor;
    if (c != null && c >= P.data.xr[0] && c <= P.data.xr[1]) {
      const x = L.X(c);
      g.strokeStyle = 'rgba(255,236,200,0.85)'; g.lineWidth = 1.2 * dpr; g.beginPath(); g.moveTo(x, L.padT); g.lineTo(x, h - L.padB); g.stroke();
    }
    if (P.hover != null) {
      const x = P.hover * dpr;
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1 * dpr; g.beginPath(); g.moveTo(x, L.padT); g.lineTo(x, h - L.padB); g.stroke();
    }
  };
  // hover: crosshair + tooltip with every series at x
  const at = (s, x) => {
    const p = s.pts; if (!p.length) return NaN;
    let lo = 0, hi = p.length - 1;
    if (x <= p[0][0]) return p[0][1]; if (x >= p[hi][0]) return p[hi][1];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m][0] > x) hi = m; else lo = m; }
    const f = (x - p[lo][0]) / (p[hi][0] - p[lo][0]); return p[lo][1] + (p[hi][1] - p[lo][1]) * f;
  };
  const move = e => {
    if (!P.data || !P.map) return;
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, dpr = P.map.dpr;
    if (px * dpr < P.map.padL || px * dpr > P.map.w - P.map.padR) { leave(); return; }
    P.hover = px;
    const x = P.map.inv(px * dpr);
    tip.innerHTML = `<b>${spec.xfmt(x, true)}</b>` + P.data.series.map(s => `<span><i style="background:${s.color}"></i>${s.name}: ${spec.yfmt(at(s, x), true)}</span>`).join('');
    tip.style.left = Math.min(r.width - 150, Math.max(0, px + 10)) + 'px';
    tip.classList.add('on');
  };
  const leave = () => { P.hover = null; tip.classList.remove('on'); };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerdown', move);
  canvas.addEventListener('pointerleave', leave);
  return P;
}

// ── the data of the five plots ────────────────────────────────────────────
// b: { W, h }; pick: ground range (m) of the picked point.
export function makeCurves(b, pick) {
  const { W, h } = b, out = {};
  const s = Math.cbrt(W);
  // 1. peak overpressure and dynamic pressure (psi) against ground range
  {
    const r0 = Math.max(10, 20 * s), r1 = Math.max(E.rangeFor(0.3 * E.PSI, W, h) * 1.3, r0 * 20), op = [], dp = [];
    for (let i = 0; i <= 160; i++) { const r = r0 * Math.pow(r1 / r0, i / 160); op.push([r, E.psi(E.overpressure(r, W, h))]); dp.push([r, E.psi(E.dynamicPressure(r, W, h))]); }
    out.press = {
      xr: [r0, r1], yr: [0.1, Math.max(200, Math.min(2e4, op[0][1] * 1.2))],
      series: [{ name: 'peak overpressure', color: SERIES.amber, pts: op, marks: [[pick, E.psi(E.overpressure(pick, W, h))]] }, { name: 'peak dynamic pressure', color: SERIES.blue, pts: dp }],
      refs: [{ y: 20, label: '20 psi' }, { y: 5, label: '5 psi' }, { y: 1, label: '1 psi' }],
    };
  }
  // 2. the Friedlander waveform at the picked point (G&D Fig. 3.57)
  {
    const ta = E.arrivalTime(pick, W, h), dur = E.positiveDuration(pick, W, h), pk = E.psi(E.overpressure(pick, W, h)), qk = E.psi(E.dynamicPressure(pick, W, h));
    const t0 = Math.max(0, ta - 0.25 * dur), t1 = ta + 2.6 * dur, op = [], dq = [];
    for (let i = 0; i <= 200; i++) {
      const t = t0 + (t1 - t0) * i / 200;
      op.push([t, E.friedlander(t, ta, dur, pk)]);
      // dynamic pressure falls faster than the overpressure (G&D 3.57): (1-u)^2 e^(-2.4u) in the positive phase
      const u = (t - ta) / dur;
      dq.push([t, t < ta ? 0 : u < 1 ? qk * (1 - u) ** 2 * Math.exp(-2.4 * u) : 0]);
    }
    const lo = Math.min(...op.map(p => p[1]));
    out.wave = { xr: [t0, t1], yr: [lo * 1.25, Math.max(pk, qk) * 1.12], series: [{ name: 'overpressure', color: SERIES.amber, pts: op }, { name: 'dynamic pressure', color: SERIES.blue, pts: dq }], refs: [{ y: 0, label: 'ambient' }], vrefs: [{ x: ta, label: 'arrival' }], ta, dur, pk, qk };
  }
  // 3. thermal power (both pulses) and the energy delivered, as fractions
  {
    const tm = E.thermalPeakTime(W), t0 = E.tThermalMin(W) * 0.02, t1 = tm * 40, pw = [], en = [];
    let acc = 0, prevT = t0, prevP = E.thermalPowerTotal(t0, W);
    const total = 0.35 * W * (1 + 0.01), Pm = E.thermalPeakPower(W);
    for (let i = 0; i <= 240; i++) {
      const t = t0 * Math.pow(t1 / t0, i / 240), p = E.thermalPowerTotal(t, W);
      acc += 0.5 * (p + prevP) * (t - prevT); prevT = t; prevP = p;
      pw.push([t, p / Pm]); en.push([t, Math.min(1, acc / total)]);
    }
    out.thermal = { xr: [t0, t1], yr: [0, 1.05], series: [{ name: 'power P/Pmax', color: SERIES.rose, pts: pw }, { name: 'energy delivered', color: SERIES.amber, pts: en, dash: true }], vrefs: [{ x: E.tThermalMin(W), label: 'min' }, { x: tm, label: 't max' }] };
  }
  // 4. fireball and free-air shock radius against time
  {
    const t0 = 1e-6, t1 = Math.max(10, E.tFireballMax(W) * 10), fb = [], sh = [], surf = E.fireballSizes(W, h).surface;
    for (let i = 0; i <= 200; i++) { const t = t0 * Math.pow(t1 / t0, i / 200); fb.push([t, E.fireballRadius(t, W, h)]); sh.push([t, E.shockRadius(t, W, surf)]); }
    out.radius = { xr: [t0, t1], yr: [Math.max(0.1, fb[0][1] * 0.5), sh[200][1] * 1.3], series: [{ name: 'fireball', color: SERIES.rose, pts: fb }, { name: 'shock front', color: SERIES.blue, pts: sh }] };
  }
  // 5. cloud top (km above the ground) against time
  {
    const t1 = 900, top = [], F = h + E.cloudTop(1e7, W, h);
    for (let i = 0; i <= 180; i++) { const t = t1 * i / 180; top.push([t, (h + E.cloudTop(t, W, h)) / 1000]); }
    out.cloud = { xr: [0, t1], yr: [0, Math.max(top[180][1], F / 1000) * 1.15], series: [{ name: 'cloud top', color: SERIES.amber, pts: top }], refs: [{ y: F / 1000, label: 'stabilised ' + (F / 1000).toFixed(1) + ' km' }] };
  }
  return out;
}

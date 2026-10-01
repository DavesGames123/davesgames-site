// ============================================================================
//  PROTEIN FOLDING  ·  plots.js — live instrument cards (canvas 2D)
// ----------------------------------------------------------------------------
//  Each card is a title, a live value and one canvas. A card has one y axis
//  only. Replica traces use a fixed categorical order (slot k = replica k),
//  and the legend is the replica chips in the card head. A pointer on a
//  time-series card (mouse hover, or touch drag) shows a crosshair and the
//  value of each trace at that x.
//
//  The canvases size themselves to their CSS box times devicePixelRatio
//  (capped at 2) on each draw, so the cards stay sharp on phones.
//
//  grep: export const SERIES  export class Card  function axes
//        export function drawSeries  export function drawCurve
//        export function drawHeat  export function drawContactMap  export function drawPairMap
// ============================================================================

// Dark-surface categorical slots (validated: dataviz validate_palette, dark).
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const INK = { text: '#dcdde6', dim: '#8d90a6', faint: 'rgba(160,170,200,0.13)', axis: 'rgba(160,170,200,0.32)', ref: '#ffe0aa' };
const FONT = '500 10.5px Inter, system-ui, sans-serif';

export class Card {
  constructor(host, key, title, opt = {}) {
    this.el = document.createElement('section');
    this.el.className = 'card' + (opt.cls ? ' ' + opt.cls : '');
    this.el.dataset.k = key;
    this.el.innerHTML = `<div class="card-h"><span class="ct">${title}</span><span class="cv"></span></div><canvas></canvas><div class="card-f"></div>`;
    host.appendChild(this.el);
    this.cv = this.el.querySelector('canvas');
    this.val = this.el.querySelector('.cv');
    this.foot = this.el.querySelector('.card-f');
    this.ctx = this.cv.getContext('2d');
    this.ptr = null;     // crosshair x in CSS px, or null
    const set = e => { const r = this.cv.getBoundingClientRect(); this.ptr = e.clientX - r.left; this.dirty = true; };
    this.cv.addEventListener('pointermove', set);
    this.cv.addEventListener('pointerdown', set);
    this.cv.addEventListener('pointerleave', () => { this.ptr = null; this.dirty = true; });
    this.cv.addEventListener('pointercancel', () => { this.ptr = null; this.dirty = true; });
    this.dirty = true;
  }
  visible() {
    const r = this.el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }
  begin() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (!w || !h) return null;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = FONT; g.textBaseline = 'middle';
    return { g, w, h };
  }
}

const nice = (span, n) => {
  const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
};
export const fmtSteps = v => v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k' : String(Math.round(v));
const fmtNum = v => Math.abs(v) < 1e-9 ? '0' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2);

// Axes and grid; returns a mapping { X, Y, l, r, t, b }.
function axes(g, w, h, x0, x1, y0, y1, o = {}) {
  const l = o.left ?? 34, r = w - 8, t = 8, b = h - (o.xlabel === false ? 8 : 18);
  const X = v => l + (v - x0) / (x1 - x0 || 1) * (r - l);
  const Y = v => b - (v - y0) / (y1 - y0 || 1) * (b - t);
  g.lineWidth = 1;
  const ys = nice(y1 - y0, o.yticks ?? 3);
  g.textAlign = 'right';
  for (let v = Math.ceil(y0 / ys) * ys; v <= y1 + 1e-9; v += ys) {
    const y = Math.round(Y(v)) + 0.5;
    g.strokeStyle = INK.faint; g.beginPath(); g.moveTo(l, y); g.lineTo(r, y); g.stroke();
    g.fillStyle = INK.dim; g.fillText((o.yfmt || fmtNum)(v), l - 5, y);
  }
  if (o.xlabel !== false) {
    const xs = nice(x1 - x0, o.xticks ?? 4);
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let v = Math.ceil(x0 / xs) * xs; v <= x1 + 1e-9; v += xs) {
      const x = Math.round(X(v)) + 0.5;
      g.strokeStyle = INK.faint; g.beginPath(); g.moveTo(x, t); g.lineTo(x, b); g.stroke();
      g.fillStyle = INK.dim; g.fillText((o.xfmt || fmtSteps)(v), x, b + 4);
    }
    g.textBaseline = 'middle';
  }
  g.strokeStyle = INK.axis; g.beginPath(); g.moveTo(l + 0.5, t); g.lineTo(l + 0.5, b + 0.5); g.lineTo(r, b + 0.5); g.stroke();
  return { X, Y, l, r, t, b };
}

// Time series for several traces. traces: [{ xs, ys, n, color }] with
// typed arrays; refs: [{ y, label }] dashed reference lines.
export function drawSeries(card, traces, o = {}) {
  const c = card.begin(); if (!c) return;
  const { g, w, h } = c;
  let x0 = Infinity, x1 = -Infinity, y0 = o.y0 ?? Infinity, y1 = o.y1 ?? -Infinity;
  for (const tr of traces) {
    if (!tr.n) continue;
    x0 = Math.min(x0, tr.xs[0]); x1 = Math.max(x1, tr.xs[tr.n - 1]);
    if (o.y0 === undefined || o.y1 === undefined) for (let i = 0; i < tr.n; i++) {
      const v = tr.ys[i]; if (o.y0 === undefined && v < y0) y0 = v; if (o.y1 === undefined && v > y1) y1 = v;
    }
  }
  for (const rf of o.refs || []) { if (o.y0 === undefined) y0 = Math.min(y0, rf.y); if (o.y1 === undefined) y1 = Math.max(y1, rf.y); }
  if (!isFinite(x0)) { x0 = 0; x1 = 1; }
  if (x1 - x0 < 1) x1 = x0 + 1;
  if (!isFinite(y0)) { y0 = 0; y1 = 1; }
  if (y1 - y0 < 1e-6) { y0 -= 0.5; y1 += 0.5; }
  if (o.y0 === undefined || o.y1 === undefined) { const pad = (y1 - y0) * 0.08; if (o.y0 === undefined) y0 -= pad; if (o.y1 === undefined) y1 += pad; }
  const A = axes(g, w, h, x0, x1, y0, y1, o);
  g.save(); g.beginPath(); g.rect(A.l, A.t - 2, A.r - A.l, A.b - A.t + 4); g.clip();
  for (const rf of o.refs || []) {
    g.setLineDash([4, 3]); g.strokeStyle = rf.color || INK.ref; g.globalAlpha = 0.8; g.lineWidth = 1;
    const y = Math.round(A.Y(rf.y)) + 0.5; g.beginPath(); g.moveTo(A.l, y); g.lineTo(A.r, y); g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
    if (rf.label) { g.fillStyle = rf.color || INK.ref; g.textAlign = 'right'; g.fillText(rf.label, A.r - 2, y - 7); }
  }
  g.lineWidth = traces.length > 4 ? 1.3 : 1.6; g.lineJoin = 'round';
  // one point per pixel column at most: decimate by min/max per column
  for (const tr of traces) {
    if (!tr.n) continue;
    g.strokeStyle = tr.color; g.globalAlpha = tr.alpha ?? 0.95; g.beginPath();
    const step = Math.max(1, Math.floor(tr.n / ((A.r - A.l) * 1.5)));
    for (let i = 0; i < tr.n; i += step) {
      const x = A.X(tr.xs[i]), y = A.Y(tr.ys[i]);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    const x = A.X(tr.xs[tr.n - 1]), y = A.Y(tr.ys[tr.n - 1]); g.lineTo(x, y);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = tr.color; g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill();
  }
  g.restore();
  // crosshair
  if (card.ptr !== null && card.ptr >= A.l && card.ptr <= A.r && traces.some(t => t.n)) {
    const xv = x0 + (card.ptr - A.l) / (A.r - A.l) * (x1 - x0);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(Math.round(card.ptr) + 0.5, A.t); g.lineTo(Math.round(card.ptr) + 0.5, A.b); g.stroke();
    const parts = [];
    for (const tr of traces) {
      if (!tr.n) continue;
      let lo = 0, hi = tr.n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr.xs[m] < xv) lo = m; else hi = m; }
      const i = Math.abs(tr.xs[lo] - xv) < Math.abs(tr.xs[hi] - xv) ? lo : hi;
      g.fillStyle = tr.color; g.beginPath(); g.arc(A.X(tr.xs[i]), A.Y(tr.ys[i]), 3.2, 0, 7); g.fill();
      parts.push(`<i style="background:${tr.color}"></i>${(o.vfmt || fmtNum)(tr.ys[i])}`);
    }
    card.foot.innerHTML = `<b>${(o.xfmt || fmtSteps)(xv)}${o.xunit || ''}</b> ${parts.join(' ')}`;
    card.foot.classList.add('on');
  } else card.foot.classList.remove('on');
}

// A single curve with optional points and a marker x. pts: [{x, y}].
export function drawCurve(card, pts, o = {}) {
  const c = card.begin(); if (!c) return;
  const { g, w, h } = c;
  const A = axes(g, w, h, o.x0, o.x1, o.y0, o.y1, o);
  if (o.band) { g.fillStyle = 'rgba(255,224,170,0.06)'; g.fillRect(A.X(o.band[0]), A.t, A.X(o.band[1]) - A.X(o.band[0]), A.b - A.t); }
  if (!pts.length) { g.fillStyle = INK.dim; g.textAlign = 'center'; g.fillText(o.empty || 'collecting…', (A.l + A.r) / 2, (A.t + A.b) / 2); return; }
  if (o.fill) {
    g.fillStyle = o.fill; g.beginPath(); g.moveTo(A.X(pts[0].x), A.b);
    for (const p of pts) g.lineTo(A.X(p.x), A.Y(Math.min(o.y1, p.y)));
    g.lineTo(A.X(pts[pts.length - 1].x), A.b); g.closePath(); g.fill();
  }
  g.strokeStyle = o.color || INK.ref; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
  let pen = false;
  for (const p of pts) {
    if (p.y === null || !isFinite(p.y)) { pen = false; continue; }
    const x = A.X(p.x), y = A.Y(Math.min(o.y1, p.y));
    if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
  }
  g.stroke();
  if (o.dots) { g.fillStyle = o.color || INK.ref; for (const p of pts) if (p.y !== null && isFinite(p.y)) { g.beginPath(); g.arc(A.X(p.x), A.Y(p.y), 2.2, 0, 7); g.fill(); } }
  if (o.marker !== undefined && o.marker !== null) {
    const x = Math.round(A.X(o.marker)) + 0.5;
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, A.t); g.lineTo(x, A.b); g.stroke(); g.setLineDash([]);
  }
}

// Sequential single-hue ramp, dark to light (for a dark surface).
function ramp(t, hue) {
  t = Math.max(0, Math.min(1, t));
  const [a, b] = hue === 'gold' ? [[42, 34, 26], [255, 214, 140]] : [[16, 34, 66], [134, 182, 239]];
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * Math.pow(t, 0.8))).join(',')})`;
}

// 2D free energy surface: grid[i*ny + j] = -ln P, NaN = no samples.
export function drawHeat(card, grid, nx, ny, o) {
  const c = card.begin(); if (!c) return;
  const { g, w, h } = c;
  const A = axes(g, w, h, o.x0, o.x1, o.y0, o.y1, o);
  const cw = (A.r - A.l) / nx, ch = (A.b - A.t) / ny;
  let any = false;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const v = grid[i * ny + j]; if (!isFinite(v)) continue; any = true;
    g.fillStyle = ramp(1 - v / o.fmax, 'blue');
    g.fillRect(A.l + i * cw, A.b - (j + 1) * ch, Math.ceil(cw), Math.ceil(ch));
  }
  if (!any) { g.fillStyle = INK.dim; g.textAlign = 'center'; g.fillText('collecting…', (A.l + A.r) / 2, (A.t + A.b) / 2); }
  if (o.point) {
    g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(A.X(o.point[0]), A.Y(o.point[1]), 4, 0, 7); g.stroke();
  }
}

// Contact map, N x N. Upper triangle: native contacts, shaded by how often
// they are formed (avg[c], 0..1). Lower triangle: current C-alpha distance
// of one replica, bright when close (< 12 A).
export function drawContactMap(card, N, ci, cj, avg, x, o = {}) {
  const c = card.begin(); if (!c) return;
  const { g, w, h } = c;
  const s = Math.min(w - 16, h - 8), ox = Math.round((w - s) / 2), oy = 4, px = s / N;
  g.fillStyle = 'rgba(8,9,15,0.9)'; g.fillRect(ox, oy, s, s);
  if (x) {
    for (let i = 0; i < N; i++) for (let j = 0; j < i - 2; j++) {
      const d = Math.hypot(x[3 * i] - x[3 * j], x[3 * i + 1] - x[3 * j + 1], x[3 * i + 2] - x[3 * j + 2]);
      if (d > 12) continue;
      g.fillStyle = ramp((12 - d) / 8, 'blue');
      g.fillRect(ox + j * px, oy + i * px, Math.ceil(px), Math.ceil(px));
    }
  }
  const sz = Math.max(px, 1.6);
  for (let k = 0; k < ci.length; k++) {
    const i = ci[k], j = cj[k], a = avg ? avg[k] : 0;
    g.fillStyle = ramp(0.15 + 0.85 * a, 'gold');
    g.fillRect(ox + j * px + (px - sz) / 2, oy + i * px + (px - sz) / 2, sz, sz);
  }
  g.strokeStyle = INK.axis; g.lineWidth = 1;
  g.strokeRect(ox + 0.5, oy + 0.5, s - 1, s - 1);
  g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + s, oy + s); g.stroke();
  g.fillStyle = INK.dim; g.textAlign = 'left'; g.textBaseline = 'top';
  if (o.labels !== false && s > 120) {
    g.fillStyle = '#ffd68c'; g.fillText(o.upper || 'native, formed', ox + s * 0.42, oy + 5);
    g.fillStyle = '#86b6ef'; g.textBaseline = 'bottom'; g.fillText(o.lower || 'now, < 12 Å', ox + 5, oy + s - 4);
  }
}

// HP contact map. upper / lower: arrays of [i, j] pairs (i < j). The
// H positions run along the top and left edges as small marks.
export function drawPairMap(card, seq, upper, lower, o = {}) {
  const c = card.begin(); if (!c) return;
  const { g, w, h } = c;
  const N = seq.length, s = Math.min(w - 20, h - 12), ox = Math.round((w - s) / 2) + 3, oy = 7, px = s / N;
  g.fillStyle = 'rgba(8,9,15,0.9)'; g.fillRect(ox, oy, s, s);
  for (let i = 0; i < N; i++) if (seq[i] === 'H') {
    g.fillStyle = '#e9a23b'; g.fillRect(ox + i * px, oy - 4, Math.max(1, px - 0.5), 3); g.fillRect(ox - 4, oy + i * px, 3, Math.max(1, px - 0.5));
  }
  const sz = Math.max(px, 2);
  g.fillStyle = '#ffd68c';
  for (const [i, j] of upper) g.fillRect(ox + j * px + (px - sz) / 2, oy + i * px + (px - sz) / 2, sz, sz);
  g.fillStyle = '#86b6ef';
  for (const [i, j] of lower) g.fillRect(ox + i * px + (px - sz) / 2, oy + j * px + (px - sz) / 2, sz, sz);
  g.strokeStyle = INK.axis; g.lineWidth = 1; g.strokeRect(ox + 0.5, oy + 0.5, s - 1, s - 1);
  g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + s, oy + s); g.stroke();
  if (s > 120) {
    g.textBaseline = 'top'; g.textAlign = 'left';
    g.fillStyle = '#ffd68c'; g.fillText(o.upper || 'best found', ox + s * 0.5, oy + 5);
    g.fillStyle = '#86b6ef'; g.textBaseline = 'bottom'; g.fillText(o.lower || 'coldest now', ox + 5, oy + s - 4);
  }
}

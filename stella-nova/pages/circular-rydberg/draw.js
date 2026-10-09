// ============================================================================
//  CIRCULAR RYDBERG  ·  draw.js — the 2D figures (no DOM, CSS-px units)
// ----------------------------------------------------------------------------
//  Each function draws one figure into a 2D context g of w x h CSS px and
//  needs nothing else, so main.js, saver.js and the node tests share it.
//  Numbers come from physics.js (our hydrogen model) and data.js (the
//  paper and its dataset). Figures are redrawn from those numbers; no
//  figure of the paper is copied.
//
//  GREP MAP
//    export const PAL ............ colours
//    export function drawSpectrum   blackbody photons vs the ladder lines
//    export function drawLifetime   measured lifetimes vs models
//    export function drawCascade    populations of the ladder over time
//    export function drawPrep       the preparation sequence (energy ladder)
//    export function drawSizes      the orbit against everyday sizes
//    export function lifetimeCurves cached model curves for drawLifetime
// ============================================================================
import { lifetime, freqHz, nbar, meanR, AU } from './physics.js';
import { PAPER, MEASURED } from './data.js';

export const PAL = {
  bg: '#05070c', grid: 'rgba(255,255,255,0.07)', axis: 'rgba(255,255,255,0.28)', ink: '#e8eaf0', dim: '#8a91a5',
  acc: '#8fd3ff', ring: '#b49bff', warm: '#ffb86b', data: '#ff7a8a', free: '#6ee7a8', cap: '#8fd3ff', planck: '#ff9a62', cut: '#ffd666',
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const font = (px, w = 400) => `${w} ${px}px Inter, system-ui, -apple-system, sans-serif`;

function frame(g, w, h, pad, xt, yt, xl, yl) {
  g.strokeStyle = PAL.grid; g.lineWidth = 1; g.font = font(11); g.fillStyle = PAL.dim;
  for (const [v, x] of xt) { g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, h - pad.b); g.stroke(); g.textAlign = 'center'; g.fillText(v, x, h - pad.b + 15); }
  for (const [v, y] of yt) { g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke(); g.textAlign = 'right'; g.fillText(v, pad.l - 6, y + 4); }
  g.strokeStyle = PAL.axis; g.beginPath(); g.moveTo(pad.l, pad.t); g.lineTo(pad.l, h - pad.b); g.lineTo(w - pad.r, h - pad.b); g.stroke();
  g.fillStyle = PAL.ink; g.font = font(12, 500);
  g.textAlign = 'center'; g.fillText(xl, (pad.l + w - pad.r) / 2, h - 4);
  g.save(); g.translate(13, (pad.t + h - pad.b) / 2); g.rotate(-Math.PI / 2); g.fillText(yl, 0, 0); g.restore();
}

// Blackbody photons per mode against frequency, with the lines of |nC>.
// opts { n, T, d (m), cap (bool) }
export function drawSpectrum(g, w, h, { n = 90, T = 300, d = PAPER.plateGapMm * 1e-3, cap = true } = {}) {
  g.clearRect(0, 0, w, h);
  const pad = { l: 52, r: 14, t: 14, b: 34 };
  const f0 = 1, f1 = 200; // GHz, log axis
  const X = f => pad.l + (Math.log(f / f0) / Math.log(f1 / f0)) * (w - pad.l - pad.r);
  const yMin = 0.1, yMax = 2e4;
  const Y = v => h - pad.b - (Math.log(clamp(v, yMin, yMax) / yMin) / Math.log(yMax / yMin)) * (h - pad.t - pad.b);
  frame(g, w, h, pad, [1, 2, 5, 10, 20, 50, 100, 200].map(f => [String(f), X(f)]), [0.1, 1, 10, 100, 1000, 10000].map(v => [v >= 1000 ? v / 1000 + 'k' : String(v), Y(v)]), 'frequency (GHz)', 'photons per mode');
  const fc = AU.cSI / (2 * d) / 1e9;
  if (cap) {
    g.fillStyle = 'rgba(143,211,255,0.07)'; g.fillRect(pad.l, pad.t, X(fc) - pad.l, h - pad.t - pad.b);
    g.strokeStyle = PAL.cut; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(X(fc), pad.t); g.lineTo(X(fc), h - pad.b); g.stroke(); g.setLineDash([]);
    g.fillStyle = PAL.cut; g.font = font(11, 500); g.textAlign = 'left';
    g.fillText(`plates cut off σ light below c/2d = ${fc.toFixed(1)} GHz`, Math.min(X(fc) + 6, w - 230), pad.t + 14);
  }
  // Planck curve
  g.beginPath();
  for (let i = 0; i <= 200; i++) { const f = f0 * Math.pow(f1 / f0, i / 200); const y = Y(nbar(f * 1e9, T)); i ? g.lineTo(X(f), y) : g.moveTo(X(f), y); }
  g.strokeStyle = PAL.planck; g.lineWidth = 2; g.stroke();
  g.fillStyle = PAL.planck; g.font = font(11, 500); g.textAlign = 'right'; g.fillText(`${T} K`, w - pad.r - 4, Y(nbar(f1 * 0.8e9, T)) - 8);
  // lines of |nC>
  for (const n2 of [n - 1, n + 1, n + 2]) {
    const f = freqHz(n, n2) / 1e9; if (f < f0 || f > f1) continue;
    const lab = n2 === n - 1 ? `${n}→${n - 1}` : n2 === n + 1 ? `${n}→${n + 1}` : `${n}→${n + 2}`;
    const below = cap && f < fc;
    g.strokeStyle = below ? 'rgba(180,155,255,0.45)' : PAL.ring; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(X(f), h - pad.b); g.lineTo(X(f), Y(nbar(f * 1e9, T))); g.stroke();
    g.fillStyle = PAL.ink; g.font = font(11, 500); g.textAlign = 'center';
    // n -> n-1 and n -> n+1 sit close together: put one label left, one right
    g.textAlign = n2 === n - 1 ? 'right' : n2 === n + 1 ? 'left' : 'center';
    g.fillText(lab, X(f) + (n2 === n - 1 ? -4 : n2 === n + 1 ? 4 : 0), Y(nbar(f * 1e9, T)) - 6);
  }
}

// Model curves, cached by (T, d, R).
const curveCache = new Map();
export function lifetimeCurves({ T = 300, d = PAPER.plateGapMm * 1e-3, R = PAPER.reflectivity, n0 = 70, n1 = 105 } = {}) {
  const key = [T, d, R, n0, n1].join();
  if (curveCache.has(key)) return curveCache.get(key);
  const ns = [], free = [], cap = [];
  for (let n = n0; n <= n1; n++) {
    ns.push(n); free.push(lifetime(n, { T }) * 1e3); cap.push(lifetime(n, { T, cap: { d, R } }) * 1e3);
  }
  const out = { ns, free, cap };
  curveCache.set(key, out);
  return out;
}

// Measured lifetime against n, with the free-space and plate models.
// opts { T, d, R, reveal 0..1 (points pop in), hi (n to mark) }
export function drawLifetime(g, w, h, { T = 300, d = PAPER.plateGapMm * 1e-3, R = PAPER.reflectivity, reveal = 1, hi = null, showCap = true, showFree = true } = {}) {
  g.clearRect(0, 0, w, h);
  const pad = { l: 46, r: 14, t: 14, b: 34 }, n0 = 72, n1 = 105, yMax = 14;
  const X = n => pad.l + (n - n0) / (n1 - n0) * (w - pad.l - pad.r);
  const Y = v => h - pad.b - clamp(v / yMax, 0, 1.02) * (h - pad.t - pad.b);
  frame(g, w, h, pad, [75, 80, 85, 90, 95, 100, 105].map(n => [String(n), X(n)]), [0, 2, 4, 6, 8, 10, 12, 14].map(v => [String(v), Y(v)]), 'principal quantum number n', 'lifetime (ms)');
  const C = lifetimeCurves({ T, d, R, n0, n1 });
  const line = (arr, col, dash) => {
    g.beginPath(); C.ns.forEach((n, i) => { const x = X(n), y = Y(arr[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.strokeStyle = col; g.lineWidth = 2; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]);
  };
  if (showFree) line(C.free, PAL.free);
  if (showCap) line(C.cap, PAL.cap, [6, 4]);
  // the paper's points
  const k = clamp(reveal, 0, 1), shown = Math.round(k * MEASURED.length);
  MEASURED.slice(0, shown).forEach(([n, t, e]) => {
    const x = X(n);
    g.strokeStyle = PAL.data; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, Y(t - e)); g.lineTo(x, Y(t + e)); g.moveTo(x - 4, Y(t - e)); g.lineTo(x + 4, Y(t - e)); g.moveTo(x - 4, Y(t + e)); g.lineTo(x + 4, Y(t + e)); g.stroke();
    g.fillStyle = n === hi ? '#fff' : PAL.data; g.beginPath(); g.arc(x, Y(t), n === hi ? 5.5 : 4, 0, 2 * Math.PI); g.fill();
  });
  // the 2d/lambda = 1 onset (n where f(n -> n+1) = c/2d)
  const fc = AU.cSI / (2 * d);
  let nOn = n0; while (nOn < n1 && freqHz(nOn, nOn + 1) > fc) nOn++;
  g.strokeStyle = PAL.cut; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(X(nOn), pad.t); g.lineTo(X(nOn), h - pad.b); g.stroke(); g.setLineDash([]);
  g.fillStyle = PAL.cut; g.font = font(11, 500); g.textAlign = 'left'; g.fillText('λ > 2d', X(nOn) + 5, pad.t + 12);
}

// Populations of the circular ladder against time. res from physics.cascade;
// t (s) marks a cursor. Lines for n0-2 .. n0+2 and the 'other' bin.
export function drawCascade(g, w, h, { res, t = null, label = '' } = {}) {
  g.clearRect(0, 0, w, h);
  const pad = { l: 46, r: 78, t: 14, b: 34 }, tMax = res.times[res.times.length - 1];
  const X = s => pad.l + s / tMax * (w - pad.l - pad.r);
  const Y = v => h - pad.b - clamp(v, 0, 1) * (h - pad.t - pad.b);
  const ticks = []; const stepMs = tMax * 1e3 > 20 ? 5 : tMax * 1e3 > 8 ? 2 : 1;
  for (let ms = 0; ms <= tMax * 1e3 + 1e-9; ms += stepMs) ticks.push([String(ms), X(ms / 1e3)]);
  frame(g, w, h, pad, ticks, [0, 0.25, 0.5, 0.75, 1].map(v => [String(v), Y(v)]), 'hold time (ms)', 'population');
  const i0 = res.ns.indexOf(res.ns[(res.ns.length - 1) / 2]);
  const cols = ['#5b6cff', '#62c4ff', '#ffffff', '#ffb86b', '#ff6f91'];
  const upto = t == null ? res.times.length : res.times.findIndex(s => s > t) + 1 || res.times.length;
  const series = [];
  for (let k = -2; k <= 2; k++) series.push([res.ns[i0 + k], res.pops.map(p => p[i0 + k]), cols[k + 2]]);
  series.push(['other', res.other, '#8a91a5']);
  const labels = [];
  for (const [lab, arr, col] of series) {
    g.beginPath();
    for (let i = 0; i < upto; i++) { const x = X(res.times[i]), y = Y(arr[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = col; g.lineWidth = lab === res.ns[i0] ? 2.6 : 1.8; g.stroke();
    labels.push({ y: Y(arr[upto - 1]) + 4, t: typeof lab === 'number' ? `${lab}C` : 'elliptical', col });
  }
  // labels at the right, pushed apart so they do not overlap
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 13);
  const over = labels.length ? labels[labels.length - 1].y - (h - pad.b) : 0;
  if (over > 0) labels.forEach(l => { l.y -= over; });
  g.font = font(11, 500); g.textAlign = 'left';
  labels.forEach(l => { g.fillStyle = l.col; g.fillText(l.t, w - pad.r + 6, Math.max(pad.t + 8, l.y)); });
  if (t != null) { g.strokeStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(X(t), pad.t); g.lineTo(X(t), h - pad.b); g.stroke(); }
  if (label) { g.fillStyle = PAL.ink; g.font = font(12, 500); g.textAlign = 'right'; g.fillText(label, w - pad.r - 6, pad.t + 14); }
}

// The preparation: ground state -> laser -> low-l Rydberg -> RF -> |79C>
// -> two-photon Landau-Zener steps of +2 -> |103C>. k in 0..1 plays it.
// Returns the n reached (for the cloud beside it).
export const PREP_STEPS = [
  { at: 0.00, label: 'ground state 5s² of ⁸⁸Sr, held in an optical tweezer' },
  { at: 0.14, label: 'lasers lift one electron to a low-l Rydberg state' },
  { at: 0.28, label: 'a circularly polarized radio-frequency drive turns it into |79C⟩' },
  { at: 0.42, label: 'microwave Landau-Zener sweeps climb two n at a time' },
  { at: 0.90, label: '|103C⟩: an orbit 1.1 µm across' },
];
export function prepN(k) {
  if (k < 0.42) return k < 0.28 ? null : 79;
  const steps = (PAPER.nMax - PAPER.nStart) / 2;
  return PAPER.nStart + 2 * Math.min(steps, Math.floor((k - 0.42) / 0.48 * (steps + 0.999)));
}
export function drawPrep(g, w, h, { k = 1 } = {}) {
  g.clearRect(0, 0, w, h);
  const pad = { l: 16, r: 16, t: 18, b: 18 };
  const top = pad.t, bot = h - pad.b;
  // energy axis: ground far below, the Rydberg ladder near the top, stretched
  const yG = bot - 6, yRyd = n => top + 18 + (1 - (n - 76) / (105 - 76)) * (h * 0.5);
  const x0 = pad.l + 30, x1 = w - pad.r - 10;
  g.strokeStyle = PAL.axis; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x0 - 12, top); g.lineTo(x0 - 12, bot); g.stroke();
  g.fillStyle = PAL.dim; g.font = font(11); g.save(); g.translate(pad.l + 4, (top + bot) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText('energy (not to scale)', 0, 0); g.restore();
  // ground level
  g.strokeStyle = PAL.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, yG); g.lineTo(x0 + 70, yG); g.stroke();
  g.fillStyle = PAL.ink; g.font = font(11, 500); g.textAlign = 'left'; g.fillText('5s²', x0 + 76, yG + 4);
  // the circular ladder 79..103, columns by l: circular at the right
  const xc = x0 + (x1 - x0) * 0.72;
  for (let n = 77; n <= 104; n++) {
    const y = yRyd(n), circ = n >= 79 && n % 2 === 1;
    g.strokeStyle = circ ? 'rgba(180,155,255,0.5)' : 'rgba(255,255,255,0.12)'; g.lineWidth = circ ? 1.5 : 1;
    g.beginPath(); g.moveTo(x0 + 90, y); g.lineTo(xc + 40, y); g.stroke();
  }
  [79, 85, 91, 97, 103].forEach(n => { g.fillStyle = PAL.dim; g.font = font(10); g.textAlign = 'left'; g.fillText(`n = ${n}`, xc + 46, yRyd(n) + 3); });
  const lowY = yRyd(79) + 4, xl = x0 + 120;
  // 1) laser
  const s1 = clamp((k - 0.14) / 0.12, 0, 1);
  if (s1 > 0) {
    g.strokeStyle = PAL.warm; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x0 + 35, yG); g.lineTo(x0 + 35 + (xl - x0 - 35) * s1, yG + (lowY - yG) * s1); g.stroke();
    if (s1 >= 1) { g.fillStyle = PAL.warm; g.beginPath(); g.arc(xl, lowY, 5, 0, 2 * Math.PI); g.fill(); g.font = font(10); g.fillText('low l', xl - 14, lowY + 16); }
  }
  // 2) RF to the circular state
  const s2 = clamp((k - 0.28) / 0.12, 0, 1);
  if (s2 > 0) {
    g.strokeStyle = PAL.acc; g.lineWidth = 2; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(xl, lowY); g.quadraticCurveTo((xl + xc) / 2, lowY + 26, xl + (xc - xl) * s2, lowY - 4 * s2); g.stroke(); g.setLineDash([]);
  }
  // 3) the Landau-Zener ladder
  const nNow = prepN(k);
  if (nNow) {
    for (let n = 79; n < nNow; n += 2) {
      g.strokeStyle = PAL.ring; g.lineWidth = 2;
      g.beginPath(); g.moveTo(xc, yRyd(n)); g.lineTo(xc + 10, (yRyd(n) + yRyd(n + 2)) / 2); g.lineTo(xc, yRyd(n + 2)); g.stroke();
    }
    g.fillStyle = '#fff'; g.shadowColor = PAL.ring; g.shadowBlur = 14;
    g.beginPath(); g.arc(xc, yRyd(nNow), 6, 0, 2 * Math.PI); g.fill(); g.shadowBlur = 0;
    g.font = font(12, 600); g.textAlign = 'right'; g.fillText(`|${nNow}C⟩`, xc - 10, yRyd(nNow) + 4);
  }
  // caption of the current step
  const step = PREP_STEPS.filter(s => k >= s.at).pop();
  g.fillStyle = PAL.ink; g.font = font(12, 500); g.textAlign = 'left';
  g.fillText(step.label, x0 + 90, yG - 26);
  return nNow;
}

// The orbit diameter 2<r> against everyday sizes, on a log axis.
export const SIZES = [
  { s: 1.06e-10, t: 'hydrogen atom, ground state' },
  { s: 5e-10, t: 'a typical small atom' },
  { s: 1e-7, t: 'a small virus (about 100 nm)' },
  { s: 5.5e-7, t: 'a wavelength of green light' },
  { s: 1e-6, t: 'a bacterium, about 1 µm wide' },
];
export function drawSizes(g, w, h, { n = 103 } = {}) {
  g.clearRect(0, 0, w, h);
  const pad = { l: 16, r: 16, t: 26, b: 40 }, s0 = 3e-11, s1 = 3e-6;
  const X = s => pad.l + Math.log(s / s0) / Math.log(s1 / s0) * (w - pad.l - pad.r);
  const yA = h - pad.b;
  g.strokeStyle = PAL.axis; g.beginPath(); g.moveTo(pad.l, yA); g.lineTo(w - pad.r, yA); g.stroke();
  g.fillStyle = PAL.dim; g.font = font(10); g.textAlign = 'center';
  [[1e-10, '0.1 nm'], [1e-9, '1 nm'], [1e-8, '10 nm'], [1e-7, '100 nm'], [1e-6, '1 µm']].forEach(([s, t]) => { g.fillText(t, X(s), yA + 14); g.beginPath(); g.moveTo(X(s), yA - 3); g.lineTo(X(s), yA + 3); g.stroke(); });
  SIZES.forEach((o, i) => {
    const x = X(o.s), y = pad.t + 12 + (i % 3) * 18;
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x, yA); g.stroke();
    g.fillStyle = PAL.dim; g.font = font(10); g.textAlign = x > w * 0.7 ? 'right' : 'left'; g.fillText(o.t, x + (x > w * 0.7 ? -4 : 4), y);
  });
  const dm = 2 * meanR(n) * AU.a0, x = X(dm);
  g.fillStyle = PAL.ring; g.shadowColor = PAL.ring; g.shadowBlur = 12;
  g.beginPath(); g.arc(x, yA, 6, 0, 2 * Math.PI); g.fill(); g.shadowBlur = 0;
  g.font = font(12, 600); g.textAlign = x > w * 0.6 ? 'right' : 'left';
  g.fillText(`|${n}C⟩ orbit: ${dm >= 1e-6 ? (dm * 1e6).toFixed(2) + ' µm' : (dm * 1e9).toFixed(dm < 1e-8 ? 2 : 0) + ' nm'}`, x + (x > w * 0.6 ? -10 : 10), yA - 12);
}

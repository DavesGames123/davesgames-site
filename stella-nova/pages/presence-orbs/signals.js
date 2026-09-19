// ============================================================================
//  PRESENCE ORBS  ·  signals.js — the three signal generators
// ----------------------------------------------------------------------------
//  Three periodic functions drive the orbs. Each one draws as a graph with a
//  playhead in the left panel:
//      level     voice energy 0..1   -> the shaders' reaction plus a glow lift
//      activity  typing cadence 0..1 -> the shaders' reaction plus a tempo lift
//      tempo     a straight clock multiplier, 0.1x .. 3x
//
//  initSignals() builds the panel and binds the sliders. tickSignals() advances
//  the signal clock, writes G.level / G.activity / G.tempo, and repaints each
//  graph. gpu.js runs tickSignals() when WebGPU is absent, so the panel stays
//  alive on any browser; main.js runs it once per frame otherwise.
// ============================================================================
import { $, G } from './state.js';

const hash1 = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const FNS = {
  sine:     { f: x => 0.5 + 0.5 * Math.sin(2 * Math.PI * x),        path: 'M2 8 C7 -2 10 -2 14 8 S21 18 26 8' },
  triangle: { f: x => 1 - Math.abs(2 * (x - Math.floor(x)) - 1),       path: 'M2 14 L8 2 L14 14 L20 2 L26 14' },
  square:   { f: x => (x - Math.floor(x)) < 0.5 ? 1 : 0,               path: 'M2 14 L2 2 L10 2 L10 14 L18 14 L18 2 L26 2 L26 14' },
  saw:      { f: x => x - Math.floor(x),                               path: 'M2 14 L14 2 L14 14 L26 2' },
  pulse:    { f: x => { const u = (x - Math.floor(x)) - 0.5; return Math.exp(-u * u * 90); }, path: 'M2 14 L9 14 L13 2 L17 14 L26 14' },
  noise:    { f: x => { const i = Math.floor(x), u = x - i, k = u * u * (3 - 2 * u); return hash1(i) * (1 - k) + hash1(i + 1) * k; }, path: 'M2 9 L6 4 L9 12 L12 7 L15 13 L18 3 L21 10 L26 6' },
  speech:   { f: x => { const t = x * 6.5; const phrase = 0.5 + 0.5 * Math.sin(t * 0.9) > 0.35 ? 1 : 0; const syl = Math.max(0, Math.sin(t * 11) * 0.6 + Math.sin(t * 17.3) * 0.4); return phrase * Math.min(1, 0.25 + syl); }, path: 'M2 10 L5 4 L7 12 L9 5 L11 11 L13 6 L15 13 L18 14 L21 5 L23 12 L26 8' },
  flat:     { f: x => 0.5,                                              path: 'M2 8 L26 8' },
};
const GENS = [
  { id: 'level',    title: 'Level · intensity', fn: 'sine', period: 9, amp: 0.35, bias: 0.25, phase: 0, unit: v => v.toFixed(2) },
  { id: 'activity', title: 'Activity · cadence', fn: 'noise', period: 7, amp: 0.3, bias: 0.15, phase: 0, unit: v => v.toFixed(2) },
  { id: 'tempo',    title: 'Tempo · speed',      fn: 'flat', period: 8, amp: 0.0, bias: 1.0, phase: 0, unit: v => v.toFixed(2) + 'x', map: y => 0.1 + 2.9 * y, unmap: v => (v - 0.1) / 2.9 },
];

let sigT = 0, sigLast = performance.now();

// y(t) in 0..1: bias + amp * (f - 1/2), clamped; the flat function is bias alone
function genValue(g, t) {
  const f = FNS[g.fn].f(t / g.period + g.phase);
  return Math.min(1, Math.max(0, g.bias + g.amp * (g.fn === 'flat' ? 0 : f - 0.5)));
}
function drawGraph(g, now) {
  const c = g.canvas, cx = g.ctx2, W = c.width, H = c.height, pad = 8;
  const span = Math.max(g.period * 2.5, 1.5);          // two and a half periods on screen
  const t0 = now - span * 0.75;
  cx.clearRect(0, 0, W, H);
  cx.strokeStyle = 'rgba(150,200,255,0.10)'; cx.lineWidth = 1;
  cx.beginPath(); for (let k = 0; k <= 4; k++) { const y = pad + (H - 2 * pad) * k / 4; cx.moveTo(0, y); cx.lineTo(W, y); } cx.stroke();
  // period ticks
  cx.strokeStyle = 'rgba(150,200,255,0.16)'; cx.beginPath();
  for (let k = Math.ceil(t0 / g.period); k * g.period < t0 + span; k++) { const x = (k * g.period - t0) / span * W; cx.moveTo(x, 0); cx.lineTo(x, H); } cx.stroke();
  // curve
  cx.strokeStyle = '#96c8ff'; cx.lineWidth = 2; cx.beginPath();
  for (let i = 0; i <= W; i += 2) { const t = t0 + i / W * span; const y = pad + (1 - genValue(g, t)) * (H - 2 * pad); i ? cx.lineTo(i, y) : cx.moveTo(i, y); }
  cx.stroke();
  // playhead
  const xp = W * 0.75, yp = pad + (1 - genValue(g, now)) * (H - 2 * pad);
  cx.strokeStyle = 'rgba(255,200,50,0.5)'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(xp, 0); cx.lineTo(xp, H); cx.stroke();
  cx.fillStyle = '#ffc832'; cx.beginPath(); cx.arc(xp, yp, 4, 0, Math.PI * 2); cx.fill();
}

export function initSignals() {
  const gensEl = $('gens');
  for (const g of GENS) {
    if (g.map) g.bias = g.unmap(g.bias);            // tempo bias is stored in 0..1, shown mapped
    const sec = document.createElement('div'); sec.className = 'sec'; sec.id = 'gen-' + g.id;
    sec.innerHTML = `<div class="sec-lbl">${g.title}<span class="now" id="${g.id}-now"></span></div>
      <div class="fns" role="group" aria-label="${g.id} function">${Object.entries(FNS).map(([k, v]) => `<button type="button" data-fn="${k}" class="${k === g.fn ? 'active' : ''}" title="${k}" aria-label="${k}"><svg viewBox="0 0 28 16"><path d="${v.path}"/></svg></button>`).join('')}</div>
      <canvas class="graph" id="${g.id}-graph" width="560" height="192"></canvas>
      <div class="row"><span class="row-lbl">Period</span><input type="range" id="${g.id}-period" min="0.25" max="20" step="0.05" value="${g.period}"><span class="val" id="${g.id}-period-v">${g.period.toFixed(2)}s</span></div>
      <div class="row"><span class="row-lbl">Amplitude</span><input type="range" id="${g.id}-amp" min="0" max="1" step="0.01" value="${g.amp}"><span class="val" id="${g.id}-amp-v">${g.amp.toFixed(2)}</span></div>
      <div class="row"><span class="row-lbl">Bias</span><input type="range" id="${g.id}-bias" min="0" max="1" step="0.01" value="${g.bias}"><span class="val" id="${g.id}-bias-v"></span></div>
      <div class="row"><span class="row-lbl">Phase</span><input type="range" id="${g.id}-phase" min="0" max="1" step="0.01" value="${g.phase}"><span class="val" id="${g.id}-phase-v">${g.phase.toFixed(2)}</span></div>`;
    gensEl.appendChild(sec);
    sec.querySelectorAll('.fns button').forEach(b => b.addEventListener('click', () => { g.fn = b.dataset.fn; sec.querySelectorAll('.fns button').forEach(x => x.classList.toggle('active', x === b)); }));
    const bind = (key, fmtv) => { const inp = $(`${g.id}-${key}`), out = $(`${g.id}-${key}-v`); const upd = () => { g[key] = +inp.value; out.textContent = fmtv(g[key]); }; inp.addEventListener('input', upd); upd(); };
    bind('period', v => v.toFixed(2) + 's'); bind('amp', v => v.toFixed(2)); bind('bias', v => g.map ? g.unit(g.map(v)) : v.toFixed(2)); bind('phase', v => v.toFixed(2));
    g.canvas = $(g.id + '-graph'); g.ctx2 = g.canvas.getContext('2d');
  }
}

export function tickSignals() {
  const n = performance.now(); const dt = Math.min((n - sigLast) / 1000, 0.25); sigLast = n;
  if (!G.paused) sigT += dt;
  for (const g of GENS) { const y = genValue(g, sigT); G[g.id] = g.map ? g.map(y) : y; $(g.id + '-now').textContent = g.unit(G[g.id]); drawGraph(g, sigT); }
}

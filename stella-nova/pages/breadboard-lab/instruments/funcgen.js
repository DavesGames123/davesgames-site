// ============================================================================
//  BREADBOARD LAB  ·  instruments/funcgen.js — the function generator panel
// ----------------------------------------------------------------------------
//  The panel of one `funcgen` part: wave, frequency, peak amplitude, offset
//  and square duty are live part params (CONTRACT 3.5), so every change is a
//  store op that main.js passes to sim.setParam. The output is a 50 Ω source
//  (the part's vsource has rint 50), so a heavy load pulls the wave down,
//  as on a real generator.
//
//  The preview draws two periods of the set wave with its offset, so the
//  user sees what goes into the circuit before the scope does.
//
//  GREP MAP
//    WAVES .............. sine square tri dc
//    waveAt ............. the ideal output at phase 0..1 (also used by tests)
//    drawFuncgen ........ frequency digits and the wave preview
//    createFuncgenPanel . the squircle panel in #instrDock
// ============================================================================
import { drawSeg7, fitCanvas } from './display.js';

export const WAVES = [{ value: 'sine', label: '∿' }, { value: 'square', label: '⊓' }, { value: 'tri', label: '⋀' }, { value: 'dc', label: 'DC' }];

export function waveAt(p, { wave = 'sine', amp = 1, offset = 0, duty = 0.5 } = {}) {
  const ph = p - Math.floor(p);
  switch (wave) {
    case 'square': return offset + (ph < duty ? amp : -amp);
    case 'tri': return offset + amp * (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph);
    case 'dc': return offset;
    default: return offset + amp * Math.sin(2 * Math.PI * ph);
  }
}

export function drawFuncgen(ctx, w, h, P) {
  ctx.fillStyle = '#0b0c0e'; ctx.fillRect(0, 0, w, h);
  const f = P.freq;
  const [txt, unit] = f >= 1e6 ? [(f / 1e6).toFixed(3), 'MHz'] : f >= 1e3 ? [(f / 1e3).toFixed(3), 'kHz'] : [f.toFixed(f < 10 ? 3 : f < 100 ? 2 : 1), 'Hz'];
  const dh = Math.min(h * 0.32, w * 0.1);
  drawSeg7(ctx, P.wave === 'dc' ? ' dc' : txt, { x: w * 0.04, y: h * 0.1, h: dh, color: '#4fc3e8', ghost: 'rgba(79,195,232,0.07)', glow: 5 });
  ctx.font = `600 ${Math.round(h * 0.13)}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = '#9a9ca6'; ctx.textBaseline = 'top';
  ctx.fillText(P.wave === 'dc' ? 'V' : unit, w * 0.5, h * 0.18);
  // wave preview, two periods, ±(|offset| + amp) fits the box
  const x0 = w * 0.62, x1 = w - 6, y0 = 6, y1 = h - 6;
  const lim = Math.max(1e-3, Math.abs(P.offset) + Math.abs(P.amp)) * 1.15;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath(); ctx.moveTo(x0, (y0 + y1) / 2); ctx.lineTo(x1, (y0 + y1) / 2); ctx.stroke();
  ctx.strokeStyle = '#4fc3e8'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const p = (i / 120) * 2, v = waveAt(p, P);
    const x = x0 + (i / 120) * (x1 - x0), y = (y0 + y1) / 2 - (v / lim) * (y1 - y0) / 2;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#9a9ca6';
  ctx.fillText(`${P.amp.toFixed(2)} Vpk  ${P.offset >= 0 ? '+' : ''}${P.offset.toFixed(2)} V`, w * 0.04, h * 0.72);
}

// ctx: { h, seg, well, store }
export function createFuncgenPanel(part, ctx) {
  const { h, seg, well } = ctx;
  let cur = part;
  const P = () => ({ wave: 'sine', freq: 1000, amp: 1, offset: 0, duty: 0.5, ...(cur.params || {}) });
  const set = (key, value, meta) => ctx.store.apply({ op: 'set', id: cur.id, path: 'params.' + key, value }, meta && meta.merge ? { merge: meta.merge } : undefined);
  const canvas = h('canvas.face.fg-face', { width: 300, height: 90, 'aria-label': 'Function generator display' });
  const waveSeg = seg(WAVES, P().wave, v => set('wave', v));
  const fW = well({ value: P().freq, unit: 'Hz', min: 0.01, max: 1e6, scale: 'log', digits: 4, onChange: (v, m) => set('freq', v, m) });
  const aW = well({ value: P().amp, unit: 'V', min: 0, max: 10, step: 0.01, onChange: (v, m) => set('amp', v, m) });
  const oW = well({ value: P().offset, unit: 'V', min: -10, max: 10, step: 0.01, onChange: (v, m) => set('offset', v, m) });
  const dW = well({ value: P().duty, min: 0.01, max: 0.99, step: 0.01, format: v => (v * 100).toFixed(0) + ' %', onChange: (v, m) => set('duty', v, m) });
  const dutyRow = h('div.rowv', {}, h('label', {}, 'DUTY'), dW.el);
  const el = h('div.instr.funcgen', {}, canvas, waveSeg.el,
    h('div.rowv', {}, h('label', {}, 'FREQUENCY'), fW.el),
    h('div.rowv', {}, h('label', {}, 'AMPLITUDE'), aW.el),
    h('div.rowv', {}, h('label', {}, 'OFFSET'), oW.el),
    dutyRow);
  function setPart(p) {
    cur = p; const q = P();
    waveSeg.set(q.wave); fW.set(q.freq); aW.set(q.amp); oW.set(q.offset); dW.set(q.duty);
    dutyRow.hidden = q.wave !== 'square';
    paint();
  }
  function frame() {}
  function paint() {
    const w = canvas.clientWidth || 300, hh = canvas.clientHeight || 90;
    drawFuncgen(fitCanvas(canvas, w, hh), w, hh, P());
  }
  setPart(part);
  return { el, setPart, frame, paint };
}

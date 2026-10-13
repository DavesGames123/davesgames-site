// ============================================================================
//  BREADBOARD LAB  ·  instruments/supply.js — the bench supply front panel
// ----------------------------------------------------------------------------
//  The panel of one `supply-bench` part. The set points are part params
//  (v, ilim, on: live params, CONTRACT 3.5), so a change is a store op and
//  main.js forwards it to sim.setParam without a netlist rebuild. The
//  readout is the supply's measured output (Frame.parts[id].vis: v, a, cc,
//  on). The CC lamp lights when the load asks for more than the limit and
//  the supply holds the current instead of the voltage.
//
//  GREP MAP
//    PRESET_V ........... quick voltage buttons
//    drawSupply ......... the two 7-segment readouts and the CV / CC lamps
//    createSupplyPanel .. the squircle panel in #instrDock
// ============================================================================
import { drawSeg7, fitCanvas } from './display.js';

export const PRESET_V = [3.3, 5, 9, 12];

export function drawSupply(ctx, w, h, st) {
  ctx.fillStyle = '#0b0c0e'; ctx.fillRect(0, 0, w, h);
  const dh = Math.min(h * 0.46, w * 0.12);
  const on = st.on !== false;
  const vtxt = on ? (st.v ?? 0).toFixed(Math.abs(st.v ?? 0) >= 10 ? 1 : 2) : '---';
  const atxt = on ? ((st.a ?? 0) < 1 ? (st.a ?? 0).toFixed(3) : (st.a ?? 0).toFixed(2)) : '---';
  const red = '#ff5a2a', ghost = 'rgba(255,90,42,0.07)', green = '#57e389', ghostG = 'rgba(87,227,137,0.07)';
  drawSeg7(ctx, vtxt.padStart(5, ' '), { x: w * 0.04, y: (h - dh) / 2 - h * 0.05, h: dh, color: red, ghost, glow: on ? 6 : 0 });
  drawSeg7(ctx, atxt.padStart(5, ' '), { x: w * 0.52, y: (h - dh) / 2 - h * 0.05, h: dh, color: green, ghost: ghostG, glow: on ? 6 : 0 });
  ctx.font = `600 ${Math.round(h * 0.13)}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#9a9ca6'; ctx.fillText('V', w * 0.46, h * 0.72); ctx.fillText('A', w * 0.94, h * 0.72);
  const lamp = (x, label, lit, col) => {
    ctx.fillStyle = lit ? col : '#2a2c31';
    ctx.beginPath(); ctx.arc(x, h * 0.88, h * 0.045, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = lit ? '#e2e3e9' : '#5c5e68'; ctx.fillText(label, x + h * 0.08, h * 0.92);
  };
  lamp(w * 0.06, 'CV', on && !st.cc, '#57e389');
  lamp(w * 0.2, 'CC', on && !!st.cc, '#ff5a2a');
  lamp(w * 0.34, 'OUT', on, '#6b9fe2');
}

// ctx: { h, btn, well, toggle, store, registry }
export function createSupplyPanel(part, ctx) {
  const { h, btn, well, toggle } = ctx;
  let cur = part, vis = {};
  const P = () => ({ v: 5, ilim: 0.5, on: true, ...(cur.params || {}) });
  const set = (key, value, meta) => ctx.store.apply({ op: 'set', id: cur.id, path: 'params.' + key, value }, meta && meta.merge ? { merge: meta.merge } : undefined);
  const canvas = h('canvas.face.supply-face', { width: 300, height: 90, 'aria-label': 'Bench supply readout' });
  const vWell = well({ value: P().v, unit: 'V', min: 0, max: 30, step: 0.01, digits: 4, onChange: (v, m) => set('v', v, m) });
  const iWell = well({ value: P().ilim, unit: 'A', min: 0.001, max: 3, scale: 'log', digits: 3, onChange: (v, m) => set('ilim', v, m) });
  const outT = toggle('OUTPUT', P().on, v => set('on', v));
  const presets = h('div.chips', {}, ...PRESET_V.map(v => btn(`${v} V`, { cls: 'chip', onClick: () => set('v', v) })));
  const el = h('div.instr.supply', {}, canvas,
    h('div.rowv', {}, h('label', {}, 'SET VOLTS'), vWell.el),
    h('div.rowv', {}, h('label', {}, 'CURRENT LIMIT'), iWell.el),
    presets, outT.el);
  function setPart(p) { cur = p; vWell.set(P().v); iWell.set(P().ilim); outT.set(P().on); paint(); }
  function frame(pf) { vis = (pf && pf.vis) || {}; paint(); }
  function paint() {
    const w = canvas.clientWidth || 300, hh = canvas.clientHeight || 90;
    drawSupply(fitCanvas(canvas, w, hh), w, hh, { v: vis.v ?? (P().on ? P().v : 0), a: vis.a ?? 0, cc: vis.cc, on: vis.on ?? P().on });
  }
  setPart(part);
  return { el, setPart, frame, paint };
}

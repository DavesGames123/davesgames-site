// ============================================================================
//  BREADBOARD LAB  ·  instruments/meter.js — the digital multimeter
// ----------------------------------------------------------------------------
//  SIM measures (CONTRACT 3.8: Frame.probes[id] = { kind:'dmm', value, unit,
//  overload, fuse, beep }). This file decides what the meter SHOWS, as a
//  3½-digit handheld does: 2000 counts per range, the decimal point set by
//  the range, "OL" past full scale.
//
//  AUTORANGE goes up as soon as the value reaches full scale, and down only
//  when the value falls below 9 % of the current range, so a value near a
//  range edge does not make the display flicker between two ranges.
//
//  A mode is a probe setting (settings.mode 'V' | 'A' | 'R' | 'cont'); a
//  range is settings.range ('auto' or a full-scale number). Both are store
//  ops, so they undo.
//
//  GREP MAP
//    DMM_RANGES ......... the ranges of each mode: [full scale, prefix, scale, decimals]
//    dmmReading ......... value -> { text, unit, range, rangeIdx, overload }
//    drawDmm ............ the display (panel canvas and 3D screen)
//    createDmmPanel ..... the squircle panel in #instrDock
// ============================================================================
import { drawSeg7, seg7Width, fitCanvas, INSTR_COLORS } from './display.js';

export const DMM_RANGES = {
  V: { unit: 'V', ranges: [[0.2, 'm', 1e-3, 1], [2, '', 1, 3], [20, '', 1, 2], [200, '', 1, 1], [600, '', 1, 0]] },
  A: { unit: 'A', ranges: [[2e-4, 'µ', 1e-6, 1], [2e-3, 'm', 1e-3, 3], [0.02, 'm', 1e-3, 2], [0.2, 'm', 1e-3, 1], [10, '', 1, 2]] },
  R: { unit: 'Ω', ranges: [[200, '', 1, 1], [2e3, 'k', 1e3, 3], [2e4, 'k', 1e3, 2], [2e5, 'k', 1e3, 1], [2e6, 'M', 1e6, 3], [2e7, 'M', 1e6, 2]] }
};
export const DMM_MODES = [
  { value: 'V', label: 'V⎓', title: 'DC volts: red and black across the part' },
  { value: 'A', label: 'A⎓', title: 'DC amps: the meter goes IN SERIES, the current flows through it' },
  { value: 'R', label: 'Ω', title: 'Resistance: power off, the meter pushes its own small current' },
  { value: 'cont', label: '·))', title: 'Continuity: beeps below 50 Ω' }
];

// value -> what the display shows. prevIdx: the range shown last (autorange memory)
export function dmmReading(value, mode = 'V', range = 'auto', prevIdx = null) {
  const M = DMM_RANGES[mode === 'cont' ? 'R' : mode] || DMM_RANGES.V;
  const R = M.ranges;
  const a = Math.abs(value);
  let idx;
  if (mode === 'cont') idx = 0;
  else if (range !== 'auto' && Number.isFinite(+range)) {
    idx = 0; let bd = Infinity;
    R.forEach((r, i) => { const d = Math.abs(Math.log(r[0] / +range)); if (d < bd) { bd = d; idx = i; } });
  } else {
    idx = R.findIndex(r => a < r[0] * 0.9995);
    if (idx < 0) idx = R.length - 1;
    if (prevIdx !== null && prevIdx >= 0 && prevIdx < R.length && idx < prevIdx && a >= R[prevIdx][0] * 0.09 && Number.isFinite(a)) idx = prevIdx;
  }
  const [fs, prefix, scale, dec] = R[idx];
  const overload = !Number.isFinite(value) || a >= fs * 0.9995;
  let text;
  if (overload) text = value < 0 ? '-OL' : 'OL';
  else {
    text = (value / scale).toFixed(dec);
    if (/^-0\.?0*$/.test(text)) text = text.slice(1);
  }
  return { text, unit: prefix + M.unit, range: fs, rangeIdx: idx, overload };
}

// The display: digits right-aligned, the unit after them, the mode and the
// flags (AUTO, fuse) above. `st` = { reading, mode, auto, fuse, beep, hold }.
export function drawDmm(ctx, w, h, st) {
  const lcd = ctx.createLinearGradient(0, 0, 0, h);
  lcd.addColorStop(0, '#a9bfa4'); lcd.addColorStop(1, '#8ea889');
  ctx.fillStyle = lcd; ctx.fillRect(0, 0, w, h);
  const ink = INSTR_COLORS.lcdInk, ghost = INSTR_COLORS.lcdGhost;
  const r = st.reading || { text: '----', unit: '' };
  const dh = Math.min(h * 0.56, w * 0.2);
  const unitW = dh * 0.95;
  const shown = r.text.length > 7 ? r.text.slice(0, 7) : r.text;
  const dw = seg7Width(shown.replace(/^-/, ''), dh);
  const x0 = w - unitW - dw - dh * 0.25, y0 = (h - dh) * 0.62;
  if (/^-/.test(shown)) { ctx.fillStyle = ink; ctx.fillRect(x0 - dh * 0.5, y0 + dh * 0.46, dh * 0.34, dh * 0.09); }
  drawSeg7(ctx, shown.replace(/^-/, ''), { x: x0, y: y0, h: dh, color: ink, ghost, slant: 0.08 });
  ctx.fillStyle = ink;
  ctx.font = `600 ${Math.round(dh * 0.36)}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillText(r.unit || '', w - unitW + dh * 0.05, y0 + dh);
  ctx.font = `600 ${Math.max(8, Math.round(h * 0.11))}px system-ui, -apple-system, sans-serif`;
  const flags = [st.auto ? 'AUTO' : 'MAN', st.mode === 'cont' ? '·))' : (DMM_MODES.find(m => m.value === st.mode) || {}).label || '', st.hold ? 'HOLD' : '', st.fuse === 'blown' ? 'FUSE' : ''].filter(Boolean);
  ctx.fillText(flags.join('   '), h * 0.12, h * 0.2);
  if (st.beep) { ctx.beginPath(); ctx.arc(w - h * 0.16, h * 0.16, h * 0.06, 0, Math.PI * 2); ctx.fill(); }
}

// ── the panel ────────────────────────────────────────────────────────────────
// ctx: { h, btn, seg, store, sim, describeEnd(end) -> text, onSelectLead(probeId, lead) }
export function createDmmPanel(probe, ctx) {
  const { h, seg, btn } = ctx;
  let cur = probe, rangeIdx = null, last = null, hold = false, held = null;
  const canvas = h('canvas.face', { width: 300, height: 110, 'aria-label': 'Multimeter display' });
  const modeSeg = seg(DMM_MODES, probe.settings?.mode || 'V', v => ctx.store.apply({ op: 'set', id: cur.id, path: 'settings.mode', value: v }));
  const rangeSel = h('select.sq.sel', { 'aria-label': 'Range' });
  const leads = h('div.leads');
  const holdBtn = btn('HOLD', { cls: 'small', title: 'Freeze the reading', onClick: () => { hold = !hold; held = hold ? last : null; holdBtn.classList.toggle('on', hold); paint(); } });
  const fuseBtn = btn('REPLACE FUSE', { cls: 'small.warn', title: 'The 10 A fuse blew: put in a new one', onClick: () => { ctx.sim && ctx.sim.repair && ctx.sim.repair(cur.id); } });
  fuseBtn.hidden = true;
  const el = h('div.instr.dmm', {}, canvas, h('div.instr-ctl', {}, modeSeg.el, rangeSel, holdBtn, fuseBtn), leads);
  rangeSel.addEventListener('change', () => ctx.store.apply({ op: 'set', id: cur.id, path: 'settings.range', value: rangeSel.value === 'auto' ? 'auto' : Number(rangeSel.value) }));
  function fillRanges() {
    const mode = cur.settings?.mode || 'V';
    const R = DMM_RANGES[mode === 'cont' ? 'R' : mode].ranges;
    rangeSel.innerHTML = '';
    rangeSel.appendChild(h('option', { value: 'auto' }, 'AUTO'));
    for (const [fs, p, sc] of R) rangeSel.appendChild(h('option', { value: String(fs) }, `${fs / sc} ${p}${DMM_RANGES[mode === 'cont' ? 'R' : mode].unit}`));
    rangeSel.value = String(cur.settings?.range ?? 'auto');
    rangeSel.disabled = mode === 'cont';
  }
  function setProbe(p) {
    const modeChanged = !cur || (cur.settings?.mode !== p.settings?.mode);
    cur = p;
    modeSeg.set(p.settings?.mode || 'V');
    if (modeChanged) rangeIdx = null;
    fillRanges();
    leads.innerHTML = '';
    for (const [name, color] of [['red', '#d63b3b'], ['black', '#2b2b2b']]) {
      const end = p.leads ? p.leads[name] : null;
      const b = h('button.sq.lead', { type: 'button', title: `Click, then click a hole to plug the ${name} lead` }, h('i', { style: { background: color } }), h('span', {}, `${name.toUpperCase()} `), h('b', {}, end ? ctx.describeEnd(end) : 'not plugged'));
      b.addEventListener('click', () => ctx.onSelectLead && ctx.onSelectLead(p.id, name));
      leads.appendChild(b);
    }
  }
  function frame(fp) {
    if (!fp || fp.kind !== 'dmm') return;
    const mode = cur.settings?.mode || 'V';
    const r = dmmReading(fp.overload ? Infinity : fp.value, mode, cur.settings?.range ?? 'auto', rangeIdx);
    rangeIdx = r.rangeIdx;
    last = { reading: r, mode, auto: (cur.settings?.range ?? 'auto') === 'auto', fuse: fp.fuse, beep: !!fp.beep };
    fuseBtn.hidden = fp.fuse !== 'blown';
    paint();
  }
  function state() { return hold && held ? { ...held, hold: true } : (last || { reading: { text: '----', unit: '' }, mode: cur.settings?.mode || 'V', auto: true }); }
  function paint() {
    const w = canvas.clientWidth || 300, hh = canvas.clientHeight || 110;
    const g = fitCanvas(canvas, w, hh);
    drawDmm(g, w, hh, state());
  }
  // draw into the 3D screens of this instrument
  function draw3D(screens) {
    for (const g of Object.values(screens || {})) {
      if (!g || !g.canvas) continue;
      drawDmm(g, g.canvas.width, g.canvas.height, state());
    }
  }
  setProbe(probe);
  return { el, setProbe, frame, paint, draw3D, get reading() { return last; } };
}

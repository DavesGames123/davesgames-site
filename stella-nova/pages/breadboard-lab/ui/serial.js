// ============================================================================
//  BREADBOARD LAB  ·  ui/serial.js — the serial monitor and the plotter
// ----------------------------------------------------------------------------
//  Text from the sketch arrives as `sim:serial { mcu, text }` events. The
//  monitor keeps the last 64 kB per board. The input line sends text to the
//  sketch (sim.serialIn) with the chosen line ending, as the Arduino IDE
//  does.
//
//  THE PLOTTER reads every complete line. A line of numbers separated by
//  spaces, tabs or commas is one sample per number; "name:value" pairs give
//  the series names (the Arduino IDE 2 convention). The last 400 samples of
//  up to 8 series draw on a shared, auto-scaled axis.
//
//  GREP MAP
//    parsePlotLine ....... one text line -> [{ name, value }] (tested)
//    createSerial ........ monitor + plotter for one CODE panel
//    Plot ................ the series store and its canvas drawing
// ============================================================================
import { h, btn, seg } from './panels.js';
import { INSTR_COLORS } from '../instruments/display.js';

const COLORS = [...INSTR_COLORS.ch, '#ff7a1a', '#c792ea', '#e6e6a0', '#edede6'];
const MAX_TEXT = 65536, MAX_PTS = 400;

export function parsePlotLine(line) {
  const s = line.trim().replace(/:\s+/g, ':');
  if (!s) return [];
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const m = /^([^:]+):(.+)$/.exec(parts[i]);
    const v = Number(m ? m[2] : parts[i]);
    if (!Number.isFinite(v)) return [];
    out.push({ name: m ? m[1] : `value ${i + 1}`, value: v });
  }
  return out;
}

class Plot {
  constructor() { this.series = new Map(); this.n = 0; }
  clear() { this.series.clear(); this.n = 0; }
  add(points) {
    if (!points.length) return;
    this.n++;
    for (const { name, value } of points) {
      if (!this.series.has(name)) { if (this.series.size >= 8) continue; this.series.set(name, []); }
      const a = this.series.get(name);
      a.push([this.n, value]);
      if (a.length > MAX_PTS) a.shift();
    }
  }
  draw(cv, legend) {
    const W = cv.clientWidth || 400, H = cv.clientHeight || 130, dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0a0b0d'; g.fillRect(0, 0, W, H);
    let lo = Infinity, hi = -Infinity;
    for (const a of this.series.values()) for (const [, v] of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
    legend.innerHTML = '';
    if (!Number.isFinite(lo)) { g.fillStyle = '#5c5e68'; g.font = '12px system-ui, sans-serif'; g.fillText('Print numbers, one line per sample: Serial.println(value) or "a:1,b:2"', 10, H / 2); return; }
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const x0 = Math.max(0, this.n - MAX_PTS);
    const X = i => 34 + ((i - x0) / MAX_PTS) * (W - 40), Y = v => H - 8 - ((v - lo) / (hi - lo)) * (H - 16);
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.fillStyle = '#5c5e68'; g.font = '10px ui-monospace, Menlo, monospace';
    for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4, y = Y(v); g.beginPath(); g.moveTo(34, y); g.lineTo(W, y); g.stroke(); g.fillText(Number(v.toPrecision(3)).toString(), 2, y + 3); }
    let c = 0;
    for (const [name, a] of this.series) {
      const col = COLORS[c++ % COLORS.length];
      g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath();
      a.forEach(([i, v], j) => { if (j) g.lineTo(X(i), Y(v)); else g.moveTo(X(i), Y(v)); });
      g.stroke();
      legend.appendChild(h('span', {}, h('i', { style: { '--c': col } }), `${name} ${a.length ? Number(a[a.length - 1][1].toPrecision(5)) : ''}`));
    }
  }
}

// one monitor; C: the UI context; getMcu() -> the board part id shown now
export function createSerial(C, getMcu) {
  const texts = new Map(), partial = new Map(), plots = new Map();
  let view = 'monitor', auto = true, ending = '\n';
  const out = h('pre.sq.serial-out', { 'aria-live': 'polite', 'aria-label': 'Serial monitor' });
  const canvas = h('canvas.plot', { 'aria-label': 'Serial plotter' });
  const legend = h('div.plot-legend');
  const inp = h('input.txt.mono', { type: 'text', placeholder: 'Send to the board (Enter)', 'aria-label': 'Serial input' });
  const endSel = h('select.sq.sel', { 'aria-label': 'Line ending' }, h('option', { value: '\n' }, 'NL'), h('option', { value: '' }, 'none'), h('option', { value: '\r' }, 'CR'), h('option', { value: '\r\n' }, 'CR+NL'));
  endSel.addEventListener('change', () => { ending = endSel.value; });
  const send = () => {
    const id = getMcu(); if (!id) return;
    const t = inp.value + ending;
    if (C.sim && C.sim.serialIn) C.sim.serialIn(id, t);
    append(id, `> ${inp.value}\n`, true);
    inp.value = '';
  };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') send(); });
  const views = seg([{ value: 'monitor', label: 'MONITOR' }, { value: 'plot', label: 'PLOTTER' }], view, v => { view = v; layout(); });
  const clear = btn('Clear', { cls: 'small', onClick: () => { const id = getMcu(); texts.set(id, ''); if (plots.get(id)) plots.get(id).clear(); paint(); } });
  const autoBtn = btn('Auto-scroll', { cls: 'small.on', onClick: () => { auto = !auto; autoBtn.classList.toggle('on', auto); } });
  const row = h('div.serial-in', {}, inp, endSel, btn('Send', { cls: 'small', onClick: send }));
  const el = h('div.serial', {}, h('div.code-top', {}, views.el, clear, autoBtn), out, canvas, legend, row);
  function layout() { out.hidden = view !== 'monitor'; canvas.hidden = legend.hidden = view !== 'plot'; paint(); }
  function append(id, text, local = false) {
    const t = (texts.get(id) || '') + text.replace(/\r\n/g, '\n').replace(/\r/g, '');
    texts.set(id, t.length > MAX_TEXT ? t.slice(t.length - MAX_TEXT) : t);
    if (!local) {
      const p = (partial.get(id) || '') + text;
      const linesIn = p.split(/\r?\n/);
      partial.set(id, linesIn.pop());
      if (!plots.has(id)) plots.set(id, new Plot());
      for (const ln of linesIn) plots.get(id).add(parsePlotLine(ln));
    }
    if (id === getMcu()) schedule();
  }
  let pending = false;
  function schedule() { if (pending) return; pending = true; (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : f => setTimeout(f, 16))(() => { pending = false; paint(); }); }
  function paint() {
    const id = getMcu();
    if (view === 'monitor') {
      out.textContent = texts.get(id) || '';
      if (auto) out.scrollTop = out.scrollHeight;
    } else (plots.get(id) || new Plot()).draw(canvas, legend);
  }
  layout();
  return { el, append, paint, clear: id => { texts.delete(id); partial.delete(id); plots.delete(id); paint(); } };
}

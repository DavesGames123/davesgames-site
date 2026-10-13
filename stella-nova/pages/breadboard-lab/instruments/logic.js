// ============================================================================
//  BREADBOARD LAB  ·  instruments/logic.js — the 8-channel logic analyzer
// ----------------------------------------------------------------------------
//  SIM reports EDGES, not samples (CONTRACT 3.8: { kind:'logic', t0, edges:
//  [t, ch, level][], levels }), so the analyzer stores a list of edges per
//  channel and draws any window at full time resolution.
//
//  UART DECODE (optional, per channel). Idle is high. A falling edge starts a
//  frame; the decoder samples the line in the middle of each bit: the start
//  bit at 0.5 bit times (must still be low), data bits at 1.5 ... 8.5, LSB
//  first, the stop bit at 9.5 (must be high, else a framing error). The
//  next search starts after the stop bit sample.
//
//  GREP MAP
//    EdgeLog ........... per-channel edge lists (push, levelAt, window)
//    decodeUart ........ edges -> [{ t, byte, err }]
//    drawLogic ......... the timing view (rows, edges, decoded bytes)
//    createLogicPanel .. the squircle panel in #instrDock
// ============================================================================
import { fitCanvas, INSTR_COLORS } from './display.js';
import { fmtT } from './scope.js';

export class EdgeLog {
  constructor(nch = 8, cap = 20000) {
    this.nch = nch; this.cap = cap;
    this.ch = Array.from({ length: nch }, () => ({ t: [], l: [] }));
    this.init = new Array(nch).fill(0);
    this.latest = 0;
  }
  clear() { this.ch.forEach(c => { c.t.length = 0; c.l.length = 0; }); this.latest = 0; }
  push(t, ch, level) {
    const c = this.ch[ch]; if (!c) return;
    if (c.l.length && c.l[c.l.length - 1] === level) return;
    if (!c.l.length && this.init[ch] === level) { this.latest = Math.max(this.latest, t); return; }
    c.t.push(t); c.l.push(level);
    if (c.t.length > this.cap) { const k = c.t.length - this.cap; this.init[ch] = c.l[k - 1]; c.t.splice(0, k); c.l.splice(0, k); }
    this.latest = Math.max(this.latest, t);
  }
  levelAt(ch, t) {
    const c = this.ch[ch]; let lo = 0, hi = c.t.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c.t[m] <= t) lo = m + 1; else hi = m; }
    return lo ? c.l[lo - 1] : this.init[ch];
  }
  // [[t, level]] of channel ch from ta to tb, starting with the level at ta
  window(ch, ta, tb) {
    const c = this.ch[ch], out = [[ta, this.levelAt(ch, ta)]];
    let lo = 0, hi = c.t.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c.t[m] <= ta) lo = m + 1; else hi = m; }
    for (let i = lo; i < c.t.length && c.t[i] <= tb; i++) out.push([c.t[i], c.l[i]]);
    return out;
  }
}

// edges: [[t, level]] sorted, with the level before the first edge = idle (1)
export function decodeUart(edges, baud, { idle = 1, bits = 8 } = {}) {
  const bt = 1 / baud;
  const levelAt = t => {
    let lo = 0, hi = edges.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (edges[m][0] <= t) lo = m + 1; else hi = m; }
    return lo ? edges[lo - 1][1] : idle;
  };
  const out = [];
  let from = -Infinity;
  for (let i = 0; i < edges.length; i++) {
    const [t, l] = edges[i];
    if (t < from || l === idle) continue;        // a start bit is a falling edge from idle
    const prev = i ? edges[i - 1][1] : idle;
    if (prev !== idle) continue;
    if (levelAt(t + bt * 0.5) === idle) continue; // a glitch, not a start bit
    let byte = 0;
    for (let b = 0; b < bits; b++) if (levelAt(t + bt * (1.5 + b))) byte |= 1 << b;
    const stop = levelAt(t + bt * (1.5 + bits));
    out.push({ t, byte, err: stop !== idle ? 'framing' : null, ch: String.fromCharCode(byte) });
    from = t + bt * (1 + bits + 0.5);
  }
  return out;
}

// st: { ta, span, names[], uart: { ch, baud } | null, decoded: [] }
export function drawLogic(ctx, w, h, log, st, { compact = false } = {}) {
  ctx.fillStyle = '#05080a'; ctx.fillRect(0, 0, w, h);
  const lw = compact ? 0 : 34, top = compact ? 2 : 14, rows = log.nch, rh = (h - top - 2) / rows;
  const x = t => lw + ((t - st.ta) / st.span) * (w - lw - 2);
  ctx.font = '600 10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  ctx.textBaseline = 'middle';
  for (let c = 0; c < rows; c++) {
    const y0 = top + c * rh, hi = y0 + rh * 0.2, lo = y0 + rh * 0.8;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.moveTo(lw, y0 + rh); ctx.lineTo(w, y0 + rh); ctx.stroke();
    if (!compact) { ctx.fillStyle = INSTR_COLORS.dim; ctx.textAlign = 'left'; ctx.fillText((st.names && st.names[c]) || 'D' + c, 2, y0 + rh / 2); }
    const ed = log.window(c, st.ta, st.ta + st.span);
    ctx.strokeStyle = c === (st.uart && st.uart.ch) ? '#4fc3e8' : '#63c24c'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    let px = x(st.ta), py = ed[0][1] ? hi : lo;
    ctx.moveTo(px, py);
    for (let k = 1; k < ed.length; k++) { const nx = x(ed[k][0]), ny = ed[k][1] ? hi : lo; ctx.lineTo(nx, py); ctx.lineTo(nx, ny); px = nx; py = ny; }
    ctx.lineTo(w, py);
    ctx.stroke();
  }
  if (st.uart && st.decoded && !compact) {
    const c = st.uart.ch, y = top + c * rh + rh / 2, bt = 1 / st.uart.baud;
    ctx.textAlign = 'center';
    for (const d of st.decoded) {
      if (d.t < st.ta - bt * 10 || d.t > st.ta + st.span) continue;
      const xa = x(d.t), xb = x(d.t + bt * 10);
      if (xb - xa < 14) continue;
      ctx.fillStyle = d.err ? 'rgba(226,71,78,0.35)' : 'rgba(79,195,232,0.22)';
      ctx.fillRect(xa, top + c * rh + 2, xb - xa, rh - 4);
      ctx.fillStyle = '#e8f6ff';
      const label = d.byte >= 32 && d.byte < 127 ? `'${d.ch}'` : '0x' + d.byte.toString(16).padStart(2, '0').toUpperCase();
      ctx.fillText(label, (xa + xb) / 2, y);
    }
  }
  if (!compact) {
    ctx.fillStyle = INSTR_COLORS.text; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(`${fmtT(st.span / 10)}/div`, w - 4, 1);
  }
}

export function createLogicPanel(probe, ctx) {
  const { h, seg, btn } = ctx;
  let cur = probe;
  const log = new EdgeLog(8);
  const ui = { span: 0.01, live: true, ta: 0, uartOn: false, uartCh: 0, baud: 9600 };
  let decoded = [];
  const canvas = h('canvas.face.logic-face', { width: 420, height: 200, 'aria-label': 'Logic analyzer timing view' });
  const spanSeg = seg([1e-4, 1e-3, 1e-2, 0.1, 1, 5].map(v => ({ value: v, label: fmtT(v).replace('.000', '').replace(/\.00 /, ' ') })), ui.span, v => { ui.span = +v; paint(); });
  const uartBtn = btn('UART', { cls: 'small', title: 'Decode a serial line on one channel', onClick: () => { ui.uartOn = !ui.uartOn; uartBtn.classList.toggle('on', ui.uartOn); paint(); } });
  const uartCh = h('select.sq.sel', { 'aria-label': 'UART channel' }, ...Array.from({ length: 8 }, (_, i) => h('option', { value: String(i) }, 'D' + i)));
  const baudSel = h('select.sq.sel', { 'aria-label': 'Baud rate' }, ...[300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map(b => h('option', { value: String(b) }, String(b))));
  baudSel.value = '9600';
  uartCh.addEventListener('change', () => { ui.uartCh = +uartCh.value; paint(); });
  baudSel.addEventListener('change', () => { ui.baud = +baudSel.value; paint(); });
  const liveBtn = btn('LIVE', { cls: 'small.on', title: 'Follow the newest edges, or hold the view to pan', onClick: () => { ui.live = !ui.live; liveBtn.classList.toggle('on', ui.live); } });
  const thr = ctx.well ? ctx.well({ value: (probe.settings && probe.settings.threshold) || 1.5, unit: 'V', min: 0.1, max: 12, step: 0.05, onChange: (v, m) => ctx.store.apply({ op: 'set', id: cur.id, path: 'settings.threshold', value: v }, m && m.merge ? { merge: m.merge } : undefined) }) : null;
  const thrEl = thr ? h('span.knob', {}, h('span', {}, 'THRESHOLD'), thr.el) : h('span');
  const text = h('div.meas.mono');
  const leads = h('div.leads');
  const el = h('div.instr.logic', {}, canvas, h('div.instr-ctl', {}, spanSeg.el, liveBtn), h('div.instr-ctl', {}, uartBtn, uartCh, baudSel), h('div.instr-ctl', {}, thrEl), text, leads);
  // drag to pan when not live
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, ta: ui.ta }; ui.live = false; liveBtn.classList.remove('on'); try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } });
  canvas.addEventListener('pointermove', e => { if (!drag) return; const r = canvas.getBoundingClientRect(); ui.ta = drag.ta - (e.clientX - drag.x) / r.width * ui.span; paint(); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); ui.span = Math.max(1e-6, Math.min(10, ui.span * Math.pow(1.2, Math.sign(e.deltaY)))); paint(); }, { passive: false });

  function names() {
    return Array.from({ length: 8 }, (_, i) => { const e = cur.leads && cur.leads['d' + i]; return e ? 'D' + i : 'd' + i; });
  }
  function setProbe(p) {
    cur = p;
    if (thr && p.settings && p.settings.threshold !== undefined) thr.set(p.settings.threshold);
    leads.innerHTML = '';
    for (const name of Object.keys(p.leads || {})) {
      const end = p.leads[name];
      const b = h('button.sq.lead', { type: 'button', title: `Click, then click a hole to plug ${name.toUpperCase()}` }, h('span', {}, name.toUpperCase() + ' '), h('b', {}, end ? ctx.describeEnd(end) : '—'));
      b.addEventListener('click', () => ctx.onSelectLead && ctx.onSelectLead(p.id, name));
      leads.appendChild(b);
    }
    paint();
  }
  function frame(fp) {
    if (!fp || fp.kind !== 'logic') return;
    if (fp.t0 !== undefined && fp.t0 < log.latest - 1e-9 && fp.edges && fp.edges.length && fp.edges[0][0] < log.latest - 1e-9) log.clear();
    if (fp.levels !== undefined && !log.ch.some(c => c.t.length)) for (let c = 0; c < 8; c++) log.init[c] = (fp.levels >> c) & 1;
    for (const [t, c, l] of fp.edges || []) log.push(t, c, l);
    log.latest = Math.max(log.latest, fp.t0 || 0);
    if (ui.live) ui.ta = Math.max(0, log.latest - ui.span);
    paint();
  }
  function paint() {
    if (ui.uartOn) {
      const c = log.ch[ui.uartCh];
      const ed = c.t.map((t, i) => [t, c.l[i]]);
      decoded = decodeUart(ed, ui.baud);
      text.textContent = decoded.length ? 'UART: ' + decoded.slice(-60).map(d => (d.byte >= 32 && d.byte < 127 ? d.ch : d.byte === 10 ? '⏎' : '·')).join('') : 'UART: no frames yet';
    } else text.textContent = '';
    const w = canvas.clientWidth || 420, hh = canvas.clientHeight || 200;
    const g = fitCanvas(canvas, w, hh);
    drawLogic(g, w, hh, log, { ta: ui.ta, span: ui.span, names: names(), uart: ui.uartOn ? { ch: ui.uartCh, baud: ui.baud } : null, decoded });
  }
  function draw3D(screens) {
    for (const g of Object.values(screens || {})) {
      if (!g || !g.canvas) continue;
      drawLogic(g, g.canvas.width, g.canvas.height, log, { ta: ui.ta, span: ui.span, names: names(), uart: null }, { compact: g.canvas.height < 120 });
    }
  }
  setProbe(probe);
  return { el, setProbe, frame, paint, draw3D, log };
}

// ============================================================================
//  BREADBOARD LAB  ·  instruments/scope.js — the oscilloscope
// ----------------------------------------------------------------------------
//  SIM sends the new samples of each scope with every frame (CONTRACT 3.8:
//  { kind:'scope', t0, dt, ch: Float32Array[] }). A Capture keeps the last
//  N samples of every channel with their times, in a ring.
//
//  TRIGGER. An edge trigger: a rising crossing is s[i-1] < level <= s[i]
//  (falling the other way). The crossing time is interpolated between the
//  two samples, so a trace does not jitter by one sample from sweep to
//  sweep. The sweep shows `pos` of the screen before the trigger (10 % by
//  default) and the rest after it. The newest trigger whose sweep is
//  complete wins.
//    auto ..... no trigger in two screens: show the newest samples anyway
//    normal ... keep the last triggered sweep on screen
//    single ... take one sweep, then stop (re-arm with SINGLE again)
//
//  MEASUREMENTS on the shown sweep: min, max, Vpp, mean, RMS, and frequency
//  from the rising crossings of the middle level, with 10 % hysteresis.
//  CURSORS: two time cursors (dt, 1/dt) and two voltage cursors (dV).
//
//  GREP MAP
//    Capture ............ the ring of samples (push, latestT, sample access)
//    findTrigger ........ the crossing search on plain arrays (tested)
//    sweep .............. pick the samples of one screen (trigger modes)
//    measure ............ min / max / pp / mean / rms / freq
//    TDIV / VDIV ........ the 1-2-5 steps of the knobs
//    drawScope .......... grid, traces, trigger mark, cursors, readouts
//    createScopePanel ... the squircle panel in #instrDock
// ============================================================================
import { fitCanvas, INSTR_COLORS } from './display.js';

export const TDIV = [];
export const VDIV = [];
for (let d = -7; d <= 1; d++) for (const m of [1, 2, 5]) TDIV.push(Number((m * Math.pow(10, d)).toPrecision(2)));
for (let d = -3; d <= 1; d++) for (const m of [1, 2, 5]) VDIV.push(Number((m * Math.pow(10, d)).toPrecision(2)));

export class Capture {
  constructor(nch = 2, cap = 1 << 16) {
    this.nch = nch; this.cap = cap;
    this.t = new Float64Array(cap);
    this.v = Array.from({ length: nch }, () => new Float32Array(cap));
    this.n = 0; this.head = 0;           // head = index of the next write
  }
  clear() { this.n = 0; this.head = 0; }
  push(t0, dt, chs) {
    const len = chs && chs[0] ? chs[0].length : 0;
    for (let i = 0; i < len; i++) {
      this.t[this.head] = t0 + i * dt;
      for (let c = 0; c < this.nch; c++) this.v[c][this.head] = chs[c] ? chs[c][i] : 0;
      this.head = (this.head + 1) % this.cap;
      if (this.n < this.cap) this.n++;
    }
  }
  // k-th oldest sample index in the ring
  idx(k) { return (this.head - this.n + k + this.cap) % this.cap; }
  get latestT() { return this.n ? this.t[this.idx(this.n - 1)] : -Infinity; }
  get oldestT() { return this.n ? this.t[this.idx(0)] : Infinity; }
  // linear arrays of the samples with t in [ta, tb]
  slice(ta, tb) {
    let lo = 0, hi = this.n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.t[this.idx(m)] < ta) lo = m + 1; else hi = m; }
    const out = { t: [], v: Array.from({ length: this.nch }, () => []) };
    for (let k = Math.max(0, lo - 1); k < this.n; k++) {
      const i = this.idx(k), t = this.t[i];
      if (t > tb) { out.t.push(t); for (let c = 0; c < this.nch; c++) out.v[c].push(this.v[c][i]); break; }
      out.t.push(t); for (let c = 0; c < this.nch; c++) out.v[c].push(this.v[c][i]);
    }
    return out;
  }
}

// crossings of `level` in (t[], s[]) between ta and tb; edge 'rise'|'fall'|'any'.
// Returns the crossing times (interpolated), oldest first.
export function findTrigger(t, s, level, edge = 'rise', ta = -Infinity, tb = Infinity) {
  const out = [];
  for (let i = 1; i < s.length; i++) {
    if (t[i] < ta || t[i - 1] > tb) continue;
    const a = s[i - 1], b = s[i];
    const up = a < level && b >= level, dn = a > level && b <= level;
    if ((edge === 'rise' && up) || (edge === 'fall' && dn) || (edge === 'any' && (up || dn))) {
      const f = b === a ? 0 : (level - a) / (b - a);
      out.push(t[i - 1] + f * (t[i] - t[i - 1]));
    }
  }
  return out;
}

export function measure(t, s) {
  const n = s.length;
  if (!n) return null;
  let mn = Infinity, mx = -Infinity, sum = 0, sq = 0;
  for (let i = 0; i < n; i++) { const v = s[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  // time-weighted mean and RMS (samples need not be evenly spaced)
  let T = 0;
  for (let i = 1; i < n; i++) { const d = t[i] - t[i - 1], m = (s[i] + s[i - 1]) / 2; sum += m * d; sq += (s[i] * s[i] + s[i - 1] * s[i - 1]) / 2 * d; T += d; }
  const mean = T > 0 ? sum / T : s[0], rms = T > 0 ? Math.sqrt(sq / T) : Math.abs(s[0]);
  const pp = mx - mn;
  let freq = NaN, duty = NaN;
  if (pp > 1e-6) {
    const mid = (mx + mn) / 2, hy = pp * 0.1;
    let armed = s[0] < mid - hy, highT = 0, total = 0;
    const rises = [];
    for (let i = 1; i < n; i++) {
      if (s[i] < mid - hy) armed = true;
      if (armed && s[i - 1] < mid && s[i] >= mid) {
        const f = (mid - s[i - 1]) / (s[i] - s[i - 1]);
        rises.push(t[i - 1] + f * (t[i] - t[i - 1])); armed = false;
      }
    }
    if (rises.length >= 2) {
      freq = (rises.length - 1) / (rises[rises.length - 1] - rises[0]);
      for (let i = 1; i < n; i++) {
        if (t[i] < rises[0] || t[i - 1] > rises[rises.length - 1]) continue;
        const d = t[i] - t[i - 1]; total += d; if ((s[i] + s[i - 1]) / 2 >= mid) highT += d;
      }
      duty = total > 0 ? highT / total : NaN;
    }
  }
  return { min: mn, max: mx, pp, mean, rms, freq, duty };
}

// One screen of samples. st = { tdiv, trig:{ch, level, edge, mode, pos} }, mem = per-panel state
export function sweep(cap, st, mem) {
  const span = st.tdiv * 10, pos = st.trig?.pos ?? 0.1;
  const tl = cap.latestT;
  if (!Number.isFinite(tl)) return null;
  const tr = st.trig || { ch: 0, level: 0, edge: 'rise', mode: 'auto' };
  if (tr.mode === 'single' && mem.frozen) return mem.frozen;
  // search the last few screens for the newest trigger with a full sweep after it
  const look = cap.slice(tl - span * 3, tl);
  const ch = Math.min(cap.nch - 1, tr.ch | 0);
  const tt = findTrigger(look.t, look.v[ch], tr.level, tr.edge || 'rise');
  for (let k = tt.length - 1; k >= 0; k--) {
    const t0 = tt[k] - pos * span;
    if (tt[k] + (1 - pos) * span <= tl) {
      const s = cap.slice(t0, t0 + span);
      const r = { t0, span, trigT: tt[k], s, triggered: true };
      mem.last = r; mem.lastTrigWall = tl;
      if (tr.mode === 'single') mem.frozen = r;
      return r;
    }
  }
  if (tr.mode === 'normal' || tr.mode === 'single') return mem.last || null;
  // auto: free run when nothing triggered for two screens
  if (mem.last && tl - (mem.lastTrigWall ?? -Infinity) < span * 2) return mem.last;
  const t0 = tl - span;
  return { t0, span, trigT: null, s: cap.slice(t0, tl), triggered: false };
}

// st: { tdiv, vdiv:[], offset:[], trig, cursors:{t1,t2,v1,v2,on}, chOn:[] }
export function drawScope(ctx, w, h, sw, st, { running = false, breath = 0, compact = false } = {}) {
  ctx.fillStyle = '#05080a'; ctx.fillRect(0, 0, w, h);
  const top = compact ? 4 : 16, bot = compact ? 4 : 18;
  const gx = 0, gy = top, gw = w, gh = h - top - bot;
  // grid 10 x 8
  ctx.strokeStyle = INSTR_COLORS.grid; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) { const x = Math.round(gx + (i * gw) / 10) + 0.5; ctx.moveTo(x, gy); ctx.lineTo(x, gy + gh); }
  for (let j = 0; j <= 8; j++) { const y = Math.round(gy + (j * gh) / 8) + 0.5; ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); }
  ctx.stroke();
  ctx.strokeStyle = INSTR_COLORS.axis;
  ctx.beginPath(); ctx.moveTo(gx, gy + gh / 2 + 0.5); ctx.lineTo(gx + gw, gy + gh / 2 + 0.5); ctx.moveTo(gx + gw / 2 + 0.5, gy); ctx.lineTo(gx + gw / 2 + 0.5, gy + gh); ctx.stroke();
  if (running) { ctx.strokeStyle = `rgba(99,194,76,${(0.12 + 0.1 * Math.sin(breath * Math.PI * 2)).toFixed(3)})`; ctx.strokeRect(0.5, 0.5, w - 1, h - 1); }
  const yOf = (c, v) => gy + gh / 2 - ((v + (st.offset?.[c] || 0)) / (st.vdiv?.[c] || 1)) * (gh / 8);
  if (sw) {
    const xOf = t => gx + ((t - sw.t0) / sw.span) * gw;
    for (let c = 0; c < sw.s.v.length; c++) {
      if (st.chOn && st.chOn[c] === false) continue;
      const T = sw.s.t, V = sw.s.v[c];
      if (!T.length) continue;
      ctx.strokeStyle = INSTR_COLORS.ch[c]; ctx.lineWidth = compact ? 1.5 : 1.6;
      ctx.beginPath();
      // decimate: at most ~2 points per pixel column (min and max)
      const step = Math.max(1, Math.floor(T.length / (gw * 2)));
      for (let i = 0; i < T.length; i += step) {
        const x = xOf(T[i]), y = Math.max(gy - 2, Math.min(gy + gh + 2, yOf(c, V[i])));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // ground marker of the channel
      ctx.fillStyle = INSTR_COLORS.ch[c];
      const y0 = Math.max(gy, Math.min(gy + gh, yOf(c, 0)));
      ctx.beginPath(); ctx.moveTo(gx, y0 - 4); ctx.lineTo(gx + 6, y0); ctx.lineTo(gx, y0 + 4); ctx.fill();
    }
    if (sw.trigT !== null && st.trig) {
      const x = xOf(sw.trigT), c = st.trig.ch | 0, y = yOf(c, st.trig.level);
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath(); ctx.moveTo(x - 4, gy); ctx.lineTo(x + 4, gy); ctx.lineTo(x, gy + 6); ctx.fill();
      ctx.beginPath(); ctx.moveTo(gx + gw, y - 4); ctx.lineTo(gx + gw - 6, y); ctx.lineTo(gx + gw, y + 4); ctx.fill();
    }
  }
  const cu = st.cursors;
  if (cu && cu.on) {
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
    for (const f of [cu.t1, cu.t2]) { const x = Math.round(gx + f * gw) + 0.5; ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy + gh); ctx.stroke(); }
    for (const f of [cu.v1, cu.v2]) { const y = Math.round(gy + f * gh) + 0.5; ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  if (!compact) {
    ctx.font = '600 10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textBaseline = 'top'; ctx.fillStyle = INSTR_COLORS.text; ctx.textAlign = 'left';
    const lab = (v, u) => { const a = Math.abs(v); const [s, p] = a >= 1 ? [1, ''] : a >= 1e-3 ? [1e-3, 'm'] : a >= 1e-6 ? [1e-6, 'µ'] : [1e-9, 'n']; return `${Number((v / s).toPrecision(3))}${p}${u}`; };
    ctx.fillText(`${lab(st.tdiv, 's')}/div`, 4, 2);
    ctx.textAlign = 'right';
    const md = st.trig ? `${(st.trig.mode || 'auto').toUpperCase()} ${st.trig.edge === 'fall' ? '↓' : '↑'} CH${(st.trig.ch | 0) + 1} ${lab(st.trig.level, 'V')}` : '';
    ctx.fillStyle = sw && sw.triggered ? '#63c24c' : '#f2b33d';
    ctx.fillText((sw && sw.triggered ? "TRIG'D " : 'READY ') + md, w - 4, 2);
    ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
    let x = 4;
    (st.vdiv || []).forEach((vd, c) => {
      if (st.chOn && st.chOn[c] === false) return;
      ctx.fillStyle = INSTR_COLORS.ch[c];
      const s = `CH${c + 1} ${lab(vd, 'V')}`;
      ctx.fillText(s, x, h - 2); x += ctx.measureText(s).width + 12;
    });
  }
}

// ── the panel ────────────────────────────────────────────────────────────────
const fmtV = v => { if (!Number.isFinite(v)) return '—'; const a = Math.abs(v); return a >= 1 ? v.toFixed(3) + ' V' : a >= 1e-3 ? (v * 1e3).toFixed(1) + ' mV' : (v * 1e6).toFixed(0) + ' µV'; };
const fmtT = t => { const a = Math.abs(t); return a >= 1 ? t.toFixed(3) + ' s' : a >= 1e-3 ? (t * 1e3).toFixed(3) + ' ms' : (t * 1e6).toFixed(2) + ' µs'; };
const fmtF = f => (!Number.isFinite(f) ? '—' : f >= 1e6 ? (f / 1e6).toFixed(3) + ' MHz' : f >= 1e3 ? (f / 1e3).toFixed(3) + ' kHz' : f.toFixed(3) + ' Hz');
export { fmtV, fmtT, fmtF };

export function defaultScopeSettings(nch = 2) {
  return { tdiv: 1e-3, vdiv: Array(nch).fill(1), offset: Array(nch).fill(0), trig: { ch: 0, level: 1, edge: 'rise', mode: 'auto', pos: 0.1 } };
}

export function createScopePanel(probe, ctx) {
  const { h, seg, btn } = ctx;
  let cur = probe;
  const nch = Object.keys(probe.leads || {}).filter(k => /^ch\d$/.test(k)).length || 2;
  const cap = new Capture(nch, 1 << 17);
  const mem = {};
  const ui = { chOn: Array(nch).fill(true), cursors: { on: false, t1: 0.3, t2: 0.7, v1: 0.3, v2: 0.6 }, run: true };
  let sw = null, meas = [], breath = 0;
  const S = () => ({ ...defaultScopeSettings(nch), ...(cur.settings || {}), trig: { ...defaultScopeSettings(nch).trig, ...((cur.settings || {}).trig || {}) } });
  const set = (path, value, merge) => ctx.store.apply({ op: 'set', id: cur.id, path: 'settings.' + path, value }, merge ? { merge } : undefined);

  const canvas = h('canvas.face.scope-face', { width: 420, height: 240, 'aria-label': 'Oscilloscope screen' });
  const readout = h('div.meas');
  const stepIn = (arr, v, d) => { let i = arr.findIndex(x => x >= v * 0.999); if (i < 0) i = arr.length - 1; return arr[Math.max(0, Math.min(arr.length - 1, i + d))]; };
  const knob = (label, get, put, fmt) => {
    const val = h('b');
    const k = h('div.knob', {}, h('span', {}, label), btn('−', { cls: 'tiny', title: label + ' down', onClick: () => put(-1) }), val, btn('+', { cls: 'tiny', title: label + ' up', onClick: () => put(1) }));
    return { el: k, update: () => { val.textContent = fmt(get()); } };
  };
  const knobs = [];
  knobs.push(knob('TIME', () => S().tdiv, d => set('tdiv', stepIn(TDIV, S().tdiv, d)), v => fmtT(v) + '/div'));
  const chRows = [];
  for (let c = 0; c < nch; c++) {
    const on = h('button.sq.chbtn', { type: 'button', style: { '--c': INSTR_COLORS.ch[c] }, title: `Show or hide channel ${c + 1}` }, `CH${c + 1}`);
    on.addEventListener('click', () => { ui.chOn[c] = !ui.chOn[c]; on.classList.toggle('off', !ui.chOn[c]); paint(); });
    const kv = knob('V/DIV', () => S().vdiv[c] ?? 1, d => { const v = S().vdiv.slice(); v[c] = stepIn(VDIV, v[c] ?? 1, d); set('vdiv', v); }, v => fmtV(v).replace(/\.0+ /, ' ').replace(/(\.\d*?)0+ /, '$1 ').replace('. ', ' '));
    const ko = knob('POS', () => S().offset[c] ?? 0, d => { const o = S().offset.slice(); o[c] = Number(((o[c] || 0) + d * (S().vdiv[c] || 1) * 0.5).toFixed(6)); set('offset', o, 'scope-off-' + c); }, v => fmtV(v));
    knobs.push(kv, ko);
    chRows.push(h('div.chrow', {}, on, kv.el, ko.el));
  }
  const trigMode = seg([{ value: 'auto', label: 'AUTO' }, { value: 'normal', label: 'NORM' }, { value: 'single', label: 'SINGLE' }], S().trig.mode, v => { mem.frozen = null; mem.last = null; set('trig', { ...S().trig, mode: v }); });
  const trigEdge = seg([{ value: 'rise', label: '↑' }, { value: 'fall', label: '↓' }], S().trig.edge, v => set('trig', { ...S().trig, edge: v }));
  const trigCh = seg(Array.from({ length: nch }, (_, c) => ({ value: c, label: `CH${c + 1}` })), S().trig.ch, v => set('trig', { ...S().trig, ch: +v }));
  const lvl = knob('LEVEL', () => S().trig.level, d => set('trig', { ...S().trig, level: Number((S().trig.level + d * (S().vdiv[S().trig.ch] || 1) * 0.2).toFixed(6)) }, 'scope-lvl'), v => fmtV(v));
  knobs.push(lvl);
  const curBtn = btn('CURSORS', { cls: 'small', title: 'Show two time and two voltage cursors; drag them on the screen', onClick: () => { ui.cursors.on = !ui.cursors.on; curBtn.classList.toggle('on', ui.cursors.on); paint(); } });
  const runBtn = btn('RUN/STOP', { cls: 'small.on', title: 'Freeze or resume the screen', onClick: () => { ui.run = !ui.run; runBtn.classList.toggle('on', ui.run); } });
  const arm = btn('ARM', { cls: 'small', title: 'Take the next single sweep', onClick: () => { mem.frozen = null; mem.last = null; } });
  const leads = h('div.leads');
  const el = h('div.instr.scope', {}, canvas, readout,
    h('div.instr-ctl', {}, knobs[0].el, runBtn, curBtn),
    ...chRows,
    h('div.instr-ctl.trig', {}, h('span.lbl', {}, 'TRIGGER'), trigMode.el, trigEdge.el, trigCh.el, lvl.el, arm),
    leads);
  // drag cursors
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (!ui.cursors.on) return;
    const r = canvas.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const c = ui.cursors;
    const cand = [['t1', Math.abs(fx - c.t1)], ['t2', Math.abs(fx - c.t2)], ['v1', Math.abs(fy - c.v1)], ['v2', Math.abs(fy - c.v2)]].sort((a, b) => a[1] - b[1])[0];
    if (cand[1] < 0.06) { drag = cand[0]; try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } }
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    ui.cursors[drag] = Math.max(0, Math.min(1, drag[0] === 't' ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height));
    paint();
  });
  canvas.addEventListener('pointerup', () => { drag = null; });

  function setProbe(p) {
    cur = p;
    const s = S();
    trigMode.set(s.trig.mode); trigEdge.set(s.trig.edge); trigCh.set(s.trig.ch);
    for (const k of knobs) k.update();
    leads.innerHTML = '';
    for (const name of Object.keys(p.leads || {})) {
      const end = p.leads[name];
      const c = /^ch(\d)$/.exec(name);
      const b = h('button.sq.lead', { type: 'button', title: `Click, then click a hole to plug ${name.toUpperCase()}` }, h('i', { style: { background: c ? INSTR_COLORS.ch[+c[1] - 1] : '#2b2b2b' } }), h('span', {}, name.toUpperCase() + ' '), h('b', {}, end ? ctx.describeEnd(end) : '—'));
      b.addEventListener('click', () => ctx.onSelectLead && ctx.onSelectLead(p.id, name));
      leads.appendChild(b);
    }
    paint();
  }
  function frame(fp, running) {
    if (!fp || fp.kind !== 'scope') return;
    if (fp.ch && fp.ch.length && fp.ch[0] && fp.ch[0].length) {
      if (fp.t0 < cap.latestT - 1e-12) cap.clear();      // the sim restarted
      cap.push(fp.t0, fp.dt, fp.ch);
    }
    breath = (breath + 1 / 60) % 1;
    if (!ui.run) return;
    sw = sweep(cap, S(), mem);
    meas = sw ? sw.s.v.map(v => measure(sw.s.t, v)) : [];
    paint(running);
  }
  function paint(running = false) {
    const w = canvas.clientWidth || 420, hh = canvas.clientHeight || 240;
    const g = fitCanvas(canvas, w, hh);
    drawScope(g, w, hh, sw, { ...S(), chOn: ui.chOn, cursors: ui.cursors }, { running, breath });
    const rows = [];
    meas.forEach((m, c) => {
      if (!m || !ui.chOn[c]) return;
      rows.push(`<span style="color:${INSTR_COLORS.ch[c]}">CH${c + 1}</span> Vpp <b>${fmtV(m.pp)}</b> Vavg <b>${fmtV(m.mean)}</b> f <b>${fmtF(m.freq)}</b>${Number.isFinite(m.duty) ? ` duty <b>${(m.duty * 100).toFixed(1)} %</b>` : ''}`);
    });
    if (ui.cursors.on && sw) {
      const c = ui.cursors, s = S();
      const dt = Math.abs(c.t2 - c.t1) * sw.span, dv = Math.abs(c.v2 - c.v1) * 8 * (s.vdiv[0] || 1);
      rows.push(`Δt <b>${fmtT(dt)}</b> 1/Δt <b>${fmtF(dt > 0 ? 1 / dt : NaN)}</b> ΔV(CH1) <b>${fmtV(dv)}</b>`);
    }
    readout.innerHTML = rows.join('<br>');
  }
  function draw3D(screens) {
    for (const g of Object.values(screens || {})) {
      if (!g || !g.canvas) continue;
      drawScope(g, g.canvas.width, g.canvas.height, sw, { ...S(), chOn: ui.chOn, cursors: ui.cursors }, { compact: g.canvas.height < 140, breath });
    }
  }
  setProbe(probe);
  return { el, setProbe, frame, paint, draw3D, capture: cap, get sweep() { return sw; }, get measurements() { return meas; } };
}

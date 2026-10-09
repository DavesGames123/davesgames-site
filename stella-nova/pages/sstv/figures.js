// ============================================================================
//  SSTV  ·  live figures of the explainer  (ES module, 2D canvas)
// ----------------------------------------------------------------------------
//  Each figure is a scene: { height(w), step(dt), render(g, w, h),
//  set(key, value), pointer(e) }. main.js sizes the canvas, routes the
//  controls (data-set) and calls step and render while the figure is on
//  screen. Every scene runs the real codec: the traces are demodulated
//  from synthesized audio, not drawn from the tone table.
//
//  grep -n targets
//    "export class ToneScene"    sound as frequency: grey, scope, waterfall
//    "export class VisScene"     the VIS header decoded bit by bit
//    "export class LineScene"    one scan line: timing and a real trace
//    "export class DemodScene"   quadrature vs zero-crossing FM demod
//    "export class SlantScene"   clock error, syncs and the line fit
//    "export class NoiseScene"   noise, fading, mistuning and drift
//    "export class HeroScene"    the CRT receiving, fast, muted
// ============================================================================
import { FREQ, VIS_MS, byId, lineSegs } from './modes.js';
import { visTones, synth, Demod, Receiver, zeroCross, planes, lineTones, decodeAll, encode, channel, freqToLum, psnr } from './codec.js';
import { card, cardFor } from './images.js';
import { PAL, SEG_COL, Waterfall, drawScope, mkCanvas, roundRect } from './view.js';
import { CRT } from './crt.js';
import { Session } from './session.js';

const FS = 11025;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const font = (g, px, w = 400, fam = 'Inter, system-ui, sans-serif') => { g.font = `${w} ${px}px ${fam}`; };
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
function label(g, s, x, y, { px = 11, col = PAL.dim, align = 'left', w = 400, base = 'alphabetic', fam } = {}) {
  font(g, px, w, fam); g.fillStyle = col; g.textAlign = align; g.textBaseline = base; g.fillText(s, x, y);
}
function rgbaImg(img) {
  const c = mkCanvas(img.w, img.h), g = c.getContext('2d'), d = g.createImageData(img.w, img.h);
  d.data.set(img.data); g.putImageData(d, 0, 0); return c;
}
function frame(g, x, y, w, h, r = 8) { roundRect(g, x, y, w, h, r); g.fillStyle = '#04060a'; g.fill(); g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1; g.stroke(); }

// ---------------------------------------------------------------- tone
export class ToneScene {
  constructor() {
    this.f = 1900; this.sweep = false; this.ph = 0; this.T = 0;
    this.buf = new Float32Array(FS * 3); this.n = 0;
    this.wf = new Waterfall(FS, { N: 512, rows: 160, cols: 220, f0: 1000, f1: 2500 });
    this.hop = 0;
    const c = card('card', 160, 120); this.row = planes(c).Y.slice(60 * 160, 61 * 160);
  }
  height(w) { return w < 640 ? Math.round(w * 0.95) : Math.round(Math.min(360, w * 0.36)); }
  set(k, v) { if (k === 'tone') this.f = +v; if (k === 'sweep') this.sweep = !!v; }
  freqNow() {
    if (!this.sweep) return this.f;
    const u = (this.T / 2.4) % 1.15;
    if (u > 1) return FREQ.sync;
    return 1500 + 800 * this.row[Math.min(159, Math.floor(u * 160))] / 255;
  }
  step(dt) {
    dt = Math.min(dt, 0.1); this.T += dt;
    const n = Math.round(dt * FS);
    if (this.n + n > this.buf.length) { this.buf.copyWithin(0, this.n - FS); this.n = FS; }
    for (let i = 0; i < n; i++) {
      if (this.sweep && i % 16 === 0) this.cur = this.freqNow();
      const f = this.sweep ? this.cur : this.f;
      this.buf[this.n++] = 0.8 * Math.sin(this.ph); this.ph += 2 * Math.PI * f / FS; if (this.ph > 1e4) this.ph %= 2 * Math.PI;
    }
    this.hop += n;
    while (this.hop > FS * 0.012) { this.hop -= FS * 0.012; this.wf.add(this.buf, this.n - Math.round(this.hop)); }
    this.shown = this.sweep ? this.cur || this.f : this.f;
  }
  render(g, w, h) {
    g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
    const f = this.shown || this.f, Y = freqToLum(f), narrow = w < 640;
    const pad = 12;
    let sw, sc, wf;
    if (narrow) {
      const top = h * 0.46;
      sw = { x: pad, y: pad + 16, w: w * 0.34, h: top - 30 }; sc = { x: pad + w * 0.34 + 10, y: pad + 16, w: w - w * 0.34 - 2 * pad - 10, h: top - 30 };
      wf = { x: pad, y: top + 18, w: w - 2 * pad, h: h - top - 18 - 36 };
    } else {
      sw = { x: pad, y: pad + 16, w: w * 0.2, h: h - 2 * pad - 16 - 36 }; sc = { x: pad + w * 0.2 + 14, y: pad + 16, w: w * 0.36, h: h - 2 * pad - 16 - 36 };
      wf = { x: sc.x + sc.w + 14, y: pad + 16, w: w - (sc.x + sc.w + 14) - pad, h: h - 2 * pad - 16 - 36 };
    }
    // grey swatch
    const sync = f < 1450, v = Math.round(Y);
    label(g, 'what the receiver paints', sw.x, sw.y - 6);
    roundRect(g, sw.x, sw.y, sw.w, sw.h, 8); g.fillStyle = sync ? '#000' : `rgb(${v},${v},${v})`; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.15)'; g.stroke();
    const tc = Y > 140 ? '#111' : '#eee';
    label(g, `${Math.round(f)} Hz`, sw.x + sw.w / 2, sw.y + sw.h / 2 - 4, { px: Math.min(22, sw.w / 5), col: sync ? PAL.sync : tc, align: 'center', w: 500 });
    label(g, sync ? 'sync pulse' : `Y = ${v}`, sw.x + sw.w / 2, sw.y + sw.h / 2 + 18, { px: 12, col: sync ? PAL.sync : tc, align: 'center' });
    // scope: 6 ms of signal
    label(g, 'oscilloscope · last 6 ms', sc.x, sc.y - 6);
    drawScope(g, sc.x, sc.y, sc.w, sc.h, this.buf, this.n, Math.round(FS * 0.006));
    // waterfall
    label(g, 'waterfall · frequency →, time ↓', wf.x, wf.y - 6);
    this.wf.draw(g, wf.x, wf.y, wf.w, wf.h, { font: 10 });
  }
}

// ---------------------------------------------------------------- VIS
export class VisScene {
  constructor() { this.t = 0; this.set('mode', 'm1'); }
  height(w) { return w < 640 ? Math.round(w * 1.05) : Math.round(Math.min(380, w * 0.36)); }
  set(k, v) {
    if (k !== 'mode') return;
    this.m = byId(v) || byId('m1');
    const tones = visTones(this.m.vis);
    const x = synth([[FREQ.leader, 120], ...tones, [FREQ.sync, 40]], FS);
    const R = new Receiver({ fs: FS, mode: null });
    R.push(x); R.push(new Float32Array(2000));
    this.R = R; this.f = R.f.slice(0, R.n); this.vis = R.vis; this.t = 0;
    this.off = 120;
    // segments in ms from the first leader
    const S = [['leader', 300, PAL.leader], ['break', 10, PAL.sync], ['leader', 300, PAL.leader], ['start', 30, PAL.sync]];
    for (let b = 0; b < 7; b++) S.push([`b${b}`, 30, (this.m.vis >> b) & 1 ? PAL.bit1 : PAL.bit0]);
    S.push(['parity', 30, PAL.dim], ['stop', 30, PAL.sync]);
    this.segs = S;
  }
  step(dt) { this.t += dt; }
  render(g, w, h) {
    g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
    const narrow = w < 640, total = VIS_MS.total, slow = 4.2, hold = 2.6;
    const ph = this.t % (slow + hold), ms = clamp(ph / slow, 0, 1) * total;
    const pad = 14;
    const P = { x: pad + 34, y: 26, w: w - 2 * pad - 34, h: narrow ? h * 0.38 : h * 0.5 };
    frame(g, P.x, P.y, P.w, P.h);
    // time axis: the leaders are long, so they get less width
    const W = (t) => { // ms -> x, leaders squeezed
      const a = 610, la = 0.3;
      const u = t < a ? (t / a) * la : la + (t - a) / (total - a) * (1 - la);
      return P.x + u * P.w;
    };
    const fy = (f) => P.y + P.h - (f - 1000) / 1000 * P.h;
    for (const f of [1100, 1200, 1300, 1900]) {
      g.strokeStyle = 'rgba(255,255,255,0.06)'; g.beginPath(); g.moveTo(P.x, fy(f)); g.lineTo(P.x + P.w, fy(f)); g.stroke();
      label(g, `${f}`, P.x - 6, fy(f) + 4, { align: 'right', px: 10 });
    }
    label(g, 'Hz', P.x - 6, P.y + 10, { align: 'right', px: 10 });
    // segments
    let t0 = 0, bitIdx = 0;
    const bits = [];
    for (const [name, len, col] of this.segs) {
      const x0 = W(t0), x1 = W(t0 + len);
      g.fillStyle = col; g.globalAlpha = ms > t0 ? 0.12 : 0.04; g.fillRect(x0, P.y, x1 - x0, P.h); g.globalAlpha = 1;
      g.strokeStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.moveTo(x1, P.y); g.lineTo(x1, P.y + P.h); g.stroke();
      if (/^b\d$/.test(name) || name === 'parity') bits.push({ name, x0, x1, t0, len, i: bitIdx++ });
      if (len >= 300 && x1 - x0 > 96) label(g, `leader ${len} ms`, (x0 + x1) / 2, P.y + P.h * 0.62, { align: 'center', px: 10, col: PAL.leader });
      t0 += len;
    }
    // trace up to the cursor
    g.beginPath();
    const n0 = Math.round(this.off * FS / 1000), nEnd = Math.min(this.f.length, n0 + Math.round(ms * FS / 1000));
    for (let n = n0; n < nEnd; n++) { const x = W((n - n0) * 1000 / FS), y = fy(clamp(this.f[n], 1000, 2000)); if (n === n0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.strokeStyle = PAL.acc; g.lineWidth = 1.6; g.stroke(); g.lineWidth = 1;
    const cx = W(ms);
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.moveTo(cx, P.y); g.lineTo(cx, P.y + P.h); g.stroke();
    // bit boxes
    const by = P.y + P.h + 10, bh = 34;
    const V = this.vis || { bits: [], freqs: [] };
    for (const b of bits) {
      const done = ms > b.t0 + b.len * 0.8, x0 = b.x0 + 1, bw = b.x1 - b.x0 - 2;
      roundRect(g, x0, by, bw, bh, 4); g.fillStyle = done ? 'rgba(127,224,168,0.12)' : 'rgba(255,255,255,0.03)'; g.fill();
      g.strokeStyle = done ? 'rgba(127,224,168,0.5)' : 'rgba(255,255,255,0.08)'; g.stroke();
      label(g, b.name === 'parity' ? 'P' : b.name, x0 + bw / 2, by + 12, { align: 'center', px: 10 });
      if (done && V.bits[b.i] != null) label(g, `${V.bits[b.i]}`, x0 + bw / 2, by + 29, { align: 'center', px: 15, col: V.bits[b.i] ? PAL.bit1 : PAL.bit0, w: 600, fam: MONO });
    }
    // summary
    const sy = by + bh + 26;
    const nd = bits.filter(b => ms > b.t0 + b.len * 0.8).length;
    const b7 = V.bits.slice(0, 7), shown = b7.map((b, i) => (i < nd ? b : '·'));
    const bin = shown.slice().reverse().join('');
    const px = narrow ? 13 : 15;
    label(g, 'bits arrive LSB first:', pad, sy, { px: 12 });
    label(g, `b6..b0 = ${bin}`, pad, sy + 22, { px, col: PAL.ink, fam: MONO });
    if (nd >= 7) label(g, `= ${V.code}  →  ${this.m.name}`, pad + (narrow ? 0 : 200), sy + (narrow ? 44 : 22), { px, col: PAL.acc, fam: MONO, w: 600 });
    const yP = sy + (narrow ? 70 : 50);
    if (nd >= 8) {
      const ones = V.bits.slice(0, 8).reduce((s, b) => s + b, 0);
      label(g, `parity: ${ones} ones in 8 bits, ${V.parity ? 'even, so the header is good' : 'odd: header rejected'}`, pad, yP, { px: 12, col: V.parity ? PAL.acc : PAL.sync });
    }
    if (ms >= total && this.vis) label(g, `AFC: leader measured ${(1900 + this.vis.afc).toFixed(1)} Hz, tuning error ${this.vis.afc.toFixed(1)} Hz`, pad, yP + 20, { px: 12 });
  }
}

// ---------------------------------------------------------------- line
export class LineScene {
  constructor() { this.t = 0; this.img = {}; this.set('mode', 'm1'); }
  height(w) { return w < 640 ? Math.round(w * 0.95) : Math.round(Math.min(340, w * 0.32)); }
  set(k, v) {
    if (k !== 'mode') return;
    const m = this.m = byId(v) || byId('m1');
    const img = cardFor('planet', m), P = planes(img), k0 = Math.floor(m.lines * 0.48);
    this.k = k0;
    const tones = [[FREQ.black, 30]];
    lineTones(P, m, k0, tones); lineTones(P, m, k0 + 1, tones);
    const x = synth(tones, FS), D = new Demod(FS), f = D.run(x);
    const d = Math.round(D.delay);
    this.f = f.subarray(d); this.lead = 30;
    // decoded strips per scan segment
    this.strips = [];
    let t = this.lead;
    for (const g of lineSegs(m, k0)) {
      if (g.t === 'scan') {
        const c = mkCanvas(m.W, 1), cg = c.getContext('2d'), id = cg.createImageData(m.W, 1);
        for (let i = 0; i < m.W; i++) {
          const a = Math.round((t + i * g.ms / m.W) * FS / 1000), b = Math.max(a + 1, Math.round((t + (i + 1) * g.ms / m.W) * FS / 1000));
          let s = 0; for (let j = a; j < b; j++) s += this.f[j] || 0;
          const v = freqToLum(s / (b - a)), ch = g.ch.replace(/[01]/, '');
          const rgb = ch === 'R' ? [v, 0, 0] : ch === 'G' ? [0, v, 0] : ch === 'B' ? [0, 0, v] : ch === 'RY' ? [v, 128 - (v - 128) * 0.5, 128 - (v - 128) * 0.5] : ch === 'BY' ? [128 - (v - 128) * 0.5, 128 - (v - 128) * 0.2, v] : ch === 'C' ? [v, 128, 255 - v] : [v, v, v];
          id.data.set([...rgb, 255], i * 4);
        }
        cg.putImageData(id, 0, 0); this.strips.push({ t, ms: g.ms, c });
      }
      t += g.ms;
    }
    this.t = 0;
  }
  step(dt) { this.t += dt; }
  render(g, w, h) {
    g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
    const m = this.m, L = m.lineMs, segs = lineSegs(m, this.k), narrow = w < 640, pad = 12;
    const X0 = pad, XW = w - 2 * pad;
    const X = (ms) => X0 + ms / L * XW;
    // timing bar
    const by = 30, bh = narrow ? 44 : 40;
    label(g, `${m.name} · one line = ${L.toFixed(3)} ms${m.rows === 2 ? ' (two picture rows)' : ''}`, X0, 16, { px: 12, col: PAL.ink2 });
    let t = 0, alt = 0;
    for (const s of segs) {
      const x0 = X(t), x1 = X(t + s.ms);
      g.fillStyle = SEG_COL(s); g.globalAlpha = s.t === 'scan' ? 0.55 : 0.9; g.fillRect(x0, by, Math.max(1, x1 - x0 - 0.5), bh); g.globalAlpha = 1;
      const name = s.t === 'sync' ? 'sync' : s.t === 'porch' ? (s.f === 1900 ? 'porch 1900' : s.f === 2300 ? 'sep 2300' : 'porch') : { Y0: 'Y (row 1)', Y1: 'Y (row 2)', RY: 'R-Y', BY: 'B-Y', C: k2c(this.k) }[s.ch] || s.ch;
      const txt = `${name}`, msTxt = `${+s.ms.toFixed(3)} ms`;
      font(g, 11, 500);
      if (x1 - x0 > g.measureText(txt).width + 8 && x1 - x0 > g.measureText(msTxt).width + 8) {
        label(g, txt, (x0 + x1) / 2, by + bh / 2 - 3, { px: 11, col: '#0a0c10', align: 'center', w: 600 });
        label(g, msTxt, (x0 + x1) / 2, by + bh / 2 + 12, { px: 10, col: '#0a0c10', align: 'center' });
      } else if (s.ms > 0) {
        const ly = by + bh + 12 + (alt++ % 2) * 12;
        g.strokeStyle = SEG_COL(s); g.beginPath(); g.moveTo((x0 + x1) / 2, by + bh); g.lineTo((x0 + x1) / 2, ly - 9); g.stroke();
        const lx = clamp((x0 + x1) / 2, X0 + 34, X0 + XW - 34);
        label(g, `${name} ${+s.ms.toFixed(3)}`, lx, ly, { px: 10, col: SEG_COL(s), align: 'center' });
      }
      t += s.ms;
    }
    // decoded strips under the scan segments
    const sy = by + bh + 34, sh = narrow ? 18 : 16;
    g.imageSmoothingEnabled = false;
    for (const s of this.strips) g.drawImage(s.c, X(s.t - this.lead), sy, X(s.t - this.lead + s.ms) - X(s.t - this.lead), sh);
    g.imageSmoothingEnabled = true;
    label(g, 'decoded pixels of each segment', X0, sy + sh + 13, { px: 10 });
    // frequency trace
    const py = sy + sh + 24, ph = h - py - 22;
    frame(g, X0, py, XW, ph, 6);
    const fy = (f) => py + ph - (clamp(f, 1100, 2400) - 1100) / 1300 * ph;
    for (const [f, c] of [[1200, PAL.sync], [1500, PAL.black], [2300, PAL.white]]) { g.strokeStyle = c; g.globalAlpha = 0.3; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(X0, fy(f)); g.lineTo(X0 + XW, fy(f)); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; label(g, `${f}`, X0 + 4, fy(f) - 3, { px: 9, col: c }); }
    const cur = (this.t * 1000) % (L * 1.25);
    g.beginPath();
    const n0 = Math.round(this.lead * FS / 1000), n1 = n0 + Math.round(Math.min(cur, L) * FS / 1000);
    for (let n = n0; n < n1; n++) { const x = X((n - n0) * 1000 / FS), y = fy(this.f[n]); if (n === n0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.strokeStyle = PAL.acc; g.lineWidth = 1.2; g.stroke(); g.lineWidth = 1;
    if (cur < L) { g.strokeStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.moveTo(X(cur), py); g.lineTo(X(cur), py + ph); g.stroke(); }
    label(g, `demodulated frequency of line ${this.k + 1}, drawn in real time (${(L / 1000).toFixed(3)} s per line)`, X0, h - 6, { px: 10 });
  }
}
const k2c = (k) => (k % 2 ? 'B-Y' : 'R-Y');

// ---------------------------------------------------------------- demod
export class DemodScene {
  constructor() { this.t = 0; this.snr = 30; this.drag = null; this.build(); }
  height(w) { return w < 640 ? Math.round(w * 1.15) : Math.round(Math.min(400, w * 0.38)); }
  set(k, v) { if (k === 'snr') { this.snr = +v; this.build(); } }
  build() {
    const T = [[1900, 3], [1200, 4.862], [1500, 0.572]];
    for (let i = 0; i < 8; i++) T.push([1500 + 800 * i / 7, 1.4]);
    T.push([2300, 2], [1700, 2], [1500, 1.5]);
    this.tones = T;
    const x = synth(T, FS, { amp: 0.8 });
    channel(x, FS, { snr: this.snr, seed: 5 });
    this.x = x;
    const D = new Demod(FS), iq = new Float32Array(2 * x.length);
    this.f = D.run(x, undefined, iq); this.iq = iq; this.d = Math.round(D.delay);
    this.z = zeroCross(x, FS, Math.round(FS * 0.0015));
    this.truth = new Float32Array(x.length);
    let n = 0, te = 0; for (const [f, ms] of T) { te += ms; const e = Math.round(te * FS / 1000); for (; n < e && n < x.length; n++) this.truth[n] = f; }
    this.N = x.length;
  }
  pointer(e) {
    if (e.type === 'down' || (e.type === 'move' && e.buttons)) { this.drag = clamp((e.x - this.px0) / this.pw, 0, 1); return true; }
    if (e.type === 'up') { this.drag = null; }
    return false;
  }
  step(dt) { this.t += dt; }
  render(g, w, h) {
    g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
    const narrow = w < 640, pad = 12, N = this.N, d = this.d;
    const u = this.drag != null ? this.drag : ((this.t / 8) % 1);
    const n = Math.round(u * (N - d - 1)) + d;
    // panels
    let A, B, C;
    if (narrow) {
      const ch = (h - 40) / 3;
      A = { x: pad + 30, y: 18, w: w - 2 * pad - 30, h: ch * 0.8 };
      B = { x: pad, y: A.y + A.h + 26, w: w - 2 * pad, h: ch * 0.95 };
      C = { x: pad + 30, y: B.y + B.h + 24, w: w - 2 * pad - 30, h: h - (B.y + B.h + 24) - 18 };
    } else {
      const lw = w * 0.66;
      A = { x: pad + 34, y: 18, w: lw - pad - 34, h: h * 0.36 };
      C = { x: pad + 34, y: A.y + A.h + 30, w: lw - pad - 34, h: h - A.y - A.h - 30 - 22 };
      B = { x: lw + 16, y: 18, w: w - lw - 16 - pad, h: h - 40 };
    }
    this.px0 = A.x; this.pw = A.w;
    const tx = (P, i) => P.x + (i - d) / (N - d) * P.w;
    // A: waveform
    frame(g, A.x, A.y, A.w, A.h, 6);
    label(g, 'x[n], the audio samples', A.x, A.y - 5, { px: 11 });
    g.beginPath();
    for (let i = d; i < N; i++) { const X = tx(A, i), Y = A.y + A.h / 2 - this.x[i - d] * A.h * 0.45; if (i === d) g.moveTo(X, Y); else g.lineTo(X, Y); }
    g.strokeStyle = '#8a95aa'; g.stroke();
    // C: frequency estimates
    frame(g, C.x, C.y, C.w, C.h, 6);
    label(g, 'instantaneous frequency', C.x, C.y - 5, { px: 11 });
    const fy = (f) => C.y + C.h - (clamp(f, 1000, 2500) - 1000) / 1500 * C.h;
    for (const f of [1200, 1500, 1900, 2300]) { g.strokeStyle = 'rgba(255,255,255,0.06)'; g.beginPath(); g.moveTo(C.x, fy(f)); g.lineTo(C.x + C.w, fy(f)); g.stroke(); label(g, `${f}`, C.x - 4, fy(f) + 3, { px: 9, align: 'right' }); }
    const line = (arr, off, col, lw, dash) => {
      g.beginPath();
      for (let i = d; i < N; i++) { const X = tx(C, i), Y = fy(arr[i - off]); if (i === d) g.moveTo(X, Y); else g.lineTo(X, Y); }
      g.strokeStyle = col; g.lineWidth = lw; if (dash) g.setLineDash(dash); g.stroke(); g.setLineDash([]); g.lineWidth = 1;
    };
    line(this.truth, d, 'rgba(255,255,255,0.35)', 3);
    line(this.z, d - Math.round(FS * 0.00075), PAL.leader, 1.2, [4, 3]);
    line(this.f, 0, PAL.acc, 1.6);
    // legend
    const lgx = C.x + 8; let lgy = C.y + 14;
    for (const [s, c] of [['sent', 'rgba(255,255,255,0.6)'], ['quadrature', PAL.acc], ['zero-crossing, 1.5 ms window', PAL.leader]]) { g.fillStyle = c; g.fillRect(lgx, lgy - 6, 10, 3); label(g, s, lgx + 14, lgy, { px: 10, col: c }); lgy += 13; }
    // cursor
    for (const P of [A, C]) { const X = tx(P, n); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.moveTo(X, P.y); g.lineTo(X, P.y + P.h); g.stroke(); }
    // B: phasor
    frame(g, B.x, B.y, B.w, B.h, 6);
    label(g, 'z[n] = I + iQ after mixing down by 1900 Hz', B.x + 8, B.y + 14, { px: 11 });
    const cx = B.x + B.w / 2, cy = B.y + B.h / 2 + 6, R = Math.min(B.w, B.h) * 0.36;
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(cx - R - 8, cy); g.lineTo(cx + R + 8, cy); g.moveTo(cx, cy - R - 8); g.lineTo(cx, cy + R + 8); g.stroke();
    label(g, 'I', cx + R + 10, cy + 4, { px: 11 }); label(g, 'Q', cx + 4, cy - R - 10, { px: 11 });
    const k = 1 / 0.4 * 1.0;
    const pt = (i) => ({ x: cx + this.iq[2 * i] * k * R, y: cy - this.iq[2 * i + 1] * k * R });
    g.beginPath();
    for (let j = Math.max(d, n - 40); j <= n; j++) { const p = pt(j); if (j === Math.max(d, n - 40)) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y); }
    g.strokeStyle = 'rgba(127,224,168,0.45)'; g.stroke();
    const p1 = pt(n), p0 = pt(n - 1);
    g.strokeStyle = PAL.acc; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(p1.x, p1.y); g.stroke(); g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(p0.x, p0.y); g.stroke();
    g.fillStyle = PAL.acc; g.beginPath(); g.arc(p1.x, p1.y, 3, 0, Math.PI * 2); g.fill();
    const dphi = Math.atan2(this.iq[2 * n + 1] * this.iq[2 * n - 2] - this.iq[2 * n] * this.iq[2 * n - 1], this.iq[2 * n] * this.iq[2 * n - 2] + this.iq[2 * n + 1] * this.iq[2 * n - 1]);
    const fi = 1900 + dphi * FS / (2 * Math.PI);
    label(g, `Δφ = ${(dphi * 180 / Math.PI).toFixed(1)}° per sample`, B.x + 8, B.y + B.h - 26, { px: 11, col: PAL.ink2, fam: MONO });
    label(g, `f = 1900 + Δφ·fs/2π = ${fi.toFixed(0)} Hz`, B.x + 8, B.y + B.h - 10, { px: 11, col: PAL.acc, fam: MONO });
    label(g, 'drag the plots to move the cursor', narrow ? C.x : A.x, h - 4, { px: 10 });
  }
}

// ---------------------------------------------------------------- slant
export class SlantScene {
  constructor() { this.clock = 0.2; this.m = byId('r36'); this.img = card('card', this.m.W, this.m.H); this.dirty = true; this.wait = 0; }
  height(w) { return w < 640 ? Math.round(w * 1.25) : Math.round(Math.min(380, w * 0.34)); }
  set(k, v) { if (k === 'clock') { this.clock = +v; this.dirty = true; this.wait = 0.12; } }
  compute() {
    const m = this.m, x = encode(this.img, m, FS, { clock: this.clock / 100, lead: 0.3, tail: 0.4 });
    channel(x, FS, { snr: 22, seed: 9 });
    this.Rn = decodeAll(x, FS, { slant: false });
    this.Rs = decodeAll(x, FS, { slant: true });
    this.cn = this.Rn.img ? rgbaImg({ w: m.W, h: m.H, data: this.Rn.img }) : null;
    this.cs = this.Rs.img ? rgbaImg({ w: m.W, h: m.H, data: this.Rs.img }) : null;
    this.dirty = false;
  }
  step(dt) { if (this.dirty) { this.wait -= dt; if (this.wait <= 0) this.compute(); } }
  render(g, w, h) {
    g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
    if (!this.cs) { if (this.dirty) this.compute(); }
    const narrow = w < 640, pad = 12, m = this.m;
    let A, B, C;
    if (narrow) {
      const iw = (w - 2 * pad - 10) / 2, ih = iw * m.H / m.W;
      A = { x: pad, y: 22, w: iw, h: ih }; B = { x: pad + iw + 10, y: 22, w: iw, h: ih };
      C = { x: pad + 34, y: 22 + ih + 34, w: w - 2 * pad - 34, h: h - (22 + ih + 34) - 30 };
    } else {
      const iw = Math.min((h - 50) * m.W / m.H, (w - 2 * pad - 24) * 0.3), ih = iw * m.H / m.W;
      A = { x: pad, y: 22, w: iw, h: ih }; B = { x: pad + iw + 12, y: 22, w: iw, h: ih };
      C = { x: B.x + iw + 44, y: 22, w: w - (B.x + iw + 44) - pad, h: ih };
    }
    const pic = (c, P, t, col) => { label(g, t, P.x, P.y - 6, { px: 11, col }); if (c) { g.imageSmoothingEnabled = true; g.drawImage(c, P.x, P.y, P.w, P.h); } g.strokeStyle = 'rgba(255,255,255,0.12)'; g.strokeRect(P.x + 0.5, P.y + 0.5, P.w - 1, P.h - 1); };
    pic(this.cn, A, 'nominal timing', PAL.sync);
    pic(this.cs, B, 'locked to the sync fit', PAL.acc);
    // sync residuals
    const R = this.Rs;
    frame(g, C.x, C.y, C.w, C.h, 6);
    label(g, 'sync time − nominal (ms) vs line', C.x, C.y - 6, { px: 11 });
    if (R && R.syncs.length) {
      const L = R.L, fs = FS, a0 = R.t0 + R.so;
      const res = R.syncs.map(s => ({ k: s.k, r: (s.x - (a0 + s.k * L)) * 1000 / fs, ok: s.ok }));
      let lo = -2, hi = 2; for (const p of res) if (p.ok) { lo = Math.min(lo, p.r); hi = Math.max(hi, p.r); }
      const span = hi - lo, l2 = lo - span * 0.1, h2 = hi + span * 0.1;
      const X = (k) => C.x + k / m.lines * C.w, Y = (r) => C.y + C.h - (r - l2) / (h2 - l2) * C.h;
      g.strokeStyle = 'rgba(255,255,255,0.15)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(C.x, Y(0)); g.lineTo(C.x + C.w, Y(0)); g.stroke(); g.setLineDash([]);
      label(g, '0', C.x - 4, Y(0) + 3, { px: 9, align: 'right' });
      label(g, `${h2.toFixed(0)}`, C.x - 4, C.y + 10, { px: 9, align: 'right' }); label(g, `${l2.toFixed(0)}`, C.x - 4, C.y + C.h, { px: 9, align: 'right' });
      for (const p of res) { g.fillStyle = p.ok ? 'rgba(127,224,168,0.8)' : 'rgba(255,106,92,0.8)'; g.fillRect(X(p.k) - 1, Y(p.r) - 1, 2.5, 2.5); }
      const F = R.fit, fr = (k) => (F.a + k * F.P - (a0 + k * L)) * 1000 / fs;
      g.strokeStyle = PAL.leader; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(0), Y(fr(0))); g.lineTo(X(m.lines), Y(fr(m.lines))); g.stroke(); g.lineWidth = 1;
      const est = R.clockError() * 100;
      label(g, `sender clock ${this.clock >= 0 ? '+' : ''}${this.clock.toFixed(2)} %`, C.x + 8, C.y + C.h - 24, { px: 11, col: PAL.ink2, fam: MONO });
      label(g, `line fit   ${est >= 0 ? '+' : ''}${est.toFixed(3)} %`, C.x + 8, C.y + C.h - 9, { px: 11, col: PAL.leader, fam: MONO });
    }
  }
}

// ---------------------------------------------------------------- noise
export class NoiseScene {
  constructor() {
    this.p = { snr: 18, fade: 0, shift: 0, drift: 0, afc: true, slant: true, mode: 'r36' };
    this.dirty = true; this.wait = 0; this.imgs = {};
  }
  height(w) { return w < 640 ? Math.round(w * 1.2) : Math.round(Math.min(380, w * 0.34)); }
  set(k, v) { this.p[k] = (k === 'afc' || k === 'slant') ? !!v : k === 'mode' ? v : +v; this.dirty = true; this.wait = 0.15; }
  compute() {
    const p = this.p, m = this.m = byId(p.mode);
    const src = this.imgs[m.id] || (this.imgs[m.id] = cardFor('sunset', m));
    const x = encode(src, m, FS, { shift: p.shift, drift: p.drift, lead: 0.3, tail: 0.4 });
    channel(x, FS, { snr: p.snr, fade: p.fade, fadeHz: 0.25, seed: 3 });
    const R = decodeAll(x, FS, { afc: p.afc, slant: p.slant, mode: null });
    if (!R.img) { const R2 = decodeAll(x, FS, { afc: p.afc, slant: p.slant, mode: m, start: Math.round((0.3 + 0.91 + m.startMs / 1000) * FS) }); this.forced = true; this.R = R2; }
    else { this.forced = false; this.R = R; }
    this.c = rgbaImg({ w: m.W, h: m.H, data: this.R.img });
    this.src = rgbaImg(src);
    this.psnr = psnr(src.data, this.R.img);
    // spectrogram of the whole transmission, time down
    const wf = new Waterfall(FS, { N: 256, rows: 200, cols: 120, f0: 1000, f1: 2500 });
    const hop = Math.floor(x.length / 200);
    for (let r = 0; r < 200; r++) wf.add(x, (199 - r) * hop + 256);
    // add() scrolls down, so the first row added ends at the bottom: add
    // from the end of the file to the start, and the start is on top.
    this.wf = wf;
    this.dirty = false;
  }
  step(dt) { if (this.dirty) { this.wait -= dt; if (this.wait <= 0) this.compute(); } }
  render(g, w, h) {
    g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
    if (!this.c) this.compute();
    const narrow = w < 640, pad = 12, m = this.m;
    let A, S, W;
    if (narrow) {
      const iw = w - 2 * pad, ih = Math.min(iw / m.aspect, h * 0.6);
      A = { x: pad + (iw - ih * m.aspect) / 2, y: 22, w: ih * m.aspect, h: ih };
      W = { x: pad, y: A.y + ih + 24, w: iw * 0.62, h: h - (A.y + ih + 24) - 40 };
      S = { x: pad + iw * 0.66, y: W.y, w: iw * 0.34, h: iw * 0.34 / m.aspect };
    } else {
      const ih = h - 56, iw = ih * m.aspect;
      A = { x: pad, y: 22, w: iw, h: ih };
      W = { x: A.x + iw + 16, y: 22, w: Math.min(220, w - iw - 3 * pad - 180), h: ih - 24 };
      const sw = w - (W.x + W.w + 16) - pad;
      S = { x: W.x + W.w + 16, y: 22, w: sw, h: sw / m.aspect };
    }
    label(g, `received · ${m.name}${this.forced ? ' · VIS lost, mode forced' : ''}`, A.x, A.y - 6, { px: 11, col: PAL.acc });
    g.drawImage(this.c, A.x, A.y, A.w, A.h);
    label(g, 'the whole transmission, time ↓', W.x, W.y - 6, { px: 11 });
    this.wf.draw(g, W.x, W.y, W.w, W.h, { font: 9 });
    label(g, 'sent', S.x, S.y - 6, { px: 11 });
    g.drawImage(this.src, S.x, S.y, S.w, S.h);
    const R = this.R, ok = R.syncs.filter(s => s.ok).length;
    const lines = [`PSNR ${this.psnr.toFixed(1)} dB`, `syncs found ${ok}/${R.syncs.length}`, `AFC ${R.afc.toFixed(1)} Hz`, `line fit ${(R.clockError() * 100).toFixed(3)} %`];
    const ty = narrow ? h - 8 : Math.min(S.y + S.h + 20, h - 4 * 15 - 4);
    if (narrow) label(g, lines.join(' · '), pad, ty, { px: 10, col: PAL.ink2, fam: MONO });
    else lines.forEach((s, i) => label(g, s, S.x, ty + i * 15, { px: 11, col: PAL.ink2, fam: MONO }));
  }
}

// ---------------------------------------------------------------- hero
const HERO_PLAN = [['r36', 'planet', 'colour', 3], ['m2', 'sunset', 'p7', 5], ['s2', 'event', 'amber', 5], ['pd90', 'card', 'colour', 8], ['r8', 'zone', 'p31', 1]];
export class HeroScene {
  constructor() { this.crt = new CRT(); this.i = -1; this.T = 0; this.next(); }
  height(w) { return w < 640 ? Math.round(w * 1.25) : Math.round(Math.min(520, w * 0.46)); }
  next() {
    this.i = (this.i + 1) % HERO_PLAN.length;
    const [id, c, ph, sp] = HERO_PLAN[this.i], m = byId(id);
    this.crt.setPhosphor(ph);
    this.s = new Session({ mode: m, img: cardFor(c, m), crt: this.crt, snr: 28, seed: this.i + 1 });
    this.speed = sp; this.t = 0; this.hold = 0;
    this.wf = this.wf || new Waterfall(FS, { N: 512, rows: 220, cols: 160, f0: 1000, f1: 2500 });
    this.hop = 0;
  }
  step(dt) {
    dt = Math.min(dt, 0.1); this.T += dt;
    if (this.s.done) { this.hold += dt; if (this.hold > 2.5) this.next(); return; }
    this.t += dt * this.speed; this.s.advance(this.t, this.T);
    this.hop += dt * this.speed;
    let k = 0;
    while (this.hop > 0.03 && k++ < 6) { this.hop -= 0.03; this.wf.add(this.s.x, Math.round((this.t - this.hop) * FS)); }
  }
  render(g, w, h) {
    g.clearRect(0, 0, w, h);
    const narrow = w < 640, m = this.s.m, st = this.s.status();
    const box = narrow ? { x: 0, y: 0, w, h: h * 0.72 } : { x: 0, y: 0, w: w * 0.68, h };
    this.crt.render(g, { box, dpr: this.dpr || 1, t: this.T, beam: this.s.beam(), readout: [m.name, st.phase === 'vis' ? 'VIS…' : `line ${Math.min(st.line || 0, m.lines)}/${m.lines}`], led: !this.s.done, snow: st.phase === 'vis' || st.phase === 'idle' ? 0.6 : 0 });
    const W = narrow ? { x: 14, y: h * 0.72 + 18, w: w - 28, h: h * 0.28 - 54 } : { x: w * 0.7 + 12, y: 24, w: w * 0.3 - 24, h: h - 70 };
    label(g, `waterfall · ${this.speed}× speed, muted`, W.x, W.y - 8, { px: 11 });
    this.wf.draw(g, W.x, W.y, W.w, W.h, { font: 10 });
  }
}

// ============================================================================
//  SSTV  ·  encoder, channel, FM demodulator and receiver  (ES module, pure)
// ----------------------------------------------------------------------------
//  Our own code. It does what pysstv (github.com/dnet/pysstv, MIT) does on
//  the send side, and adds a receiver. Nothing here touches the DOM, so
//  tests.mjs runs the full round trip in node:
//
//    image --encode()--> audio samples --channel()--> noisy samples
//          --Receiver.push()--> instantaneous frequency --> VIS --> syncs
//          --> line fit (slant) --> pixels --> image
//
//  ENCODER. toneList() lists (Hz, ms) pairs: VIS header, then each line
//  of the mode from modes.js. encode() turns them into a sine with a
//  continuous phase. Segment edges fall on the exact sample of their end
//  time, so long modes do not drift. Options: clock error (the sender's
//  sound card runs fast or slow: every time stretches and every tone
//  shifts), mistuning (an SSB receiver off by some hertz) and drift.
//
//  DEMODULATOR (class Demod). Mix down by 1900 Hz with a complex
//  oscillator, low-pass I and Q with a Hamming FIR, then the instantaneous
//  frequency is f0 + fs/(2 pi) arg(z[n] conj z[n-1]). The track is shifted
//  back by the FIR delay, so track index i is the time i / fs.
//
//  RECEIVER (class Receiver). Streaming: push() any chunk size.
//    1. VIS: a 1900 Hz leader, then a 1200 Hz start bit, 8 bits of 30 ms
//       (1100 Hz = 1, 1300 Hz = 0, even parity), a stop bit. The leader
//       gives the tuning error (AFC).
//    2. Syncs: for each line, the best trailing edge of a 1200 Hz pulse
//       near the place the fit predicts.
//    3. Slant: a least-squares line through the sync times, t_k = a + kP.
//       P is the true line period, so a sender clock error goes away.
//       With slant off, P is the nominal period and the picture leans.
//    4. Pixels: the mean frequency over each pixel's time slot, from a
//       prefix sum, then Y = 255 (f - 1500) / 800.
//  finish() decodes every line again with the final fit, as slowrx does.
//
//  EXPORTS   (grep -n targets)
//    "export function planes"      RGBA -> R G B Y Cb Cr planes
//    "export function toneList"    (Hz, ms) pairs of a transmission
//    "export function lineTones"   (Hz, ms) pairs of one line
//    "export function encode"      samples
//    "export function channel"     noise and fading
//    "export class Demod"          FM demodulator
//    "export function zeroCross"   zero-crossing frequency (figure)
//    "export class Receiver"       VIS, syncs, slant, pixels
//    "export function decodeAll"   one call: samples -> picture
//    "export function wavBytes" / "export function parseWav"
//    "export function psnr"
// ============================================================================
import { FREQ, VIS_MS, MODES, byVis, lineSegs, syncOffset, totalMs } from './modes.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lumToFreq = (v) => FREQ.black + (FREQ.white - FREQ.black) * v / 255;
export const freqToLum = (f) => clamp((f - FREQ.black) * 255 / (FREQ.white - FREQ.black), 0, 255);

// ---------------------------------------------------------------- colour
// JPEG (full range BT.601) YCbCr, as PIL and so pysstv use it.
export function planes(img) {
  const n = img.w * img.h, d = img.data;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  const Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    R[i] = r; G[i] = g; B[i] = b;
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  return { w: img.w, h: img.h, R, G, B, Y, Cb, Cr };
}
export function ycc2rgb(y, cb, cr, out, o) {
  out[o] = clamp(Math.round(y + 1.402 * (cr - 128)), 0, 255);
  out[o + 1] = clamp(Math.round(y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128)), 0, 255);
  out[o + 2] = clamp(Math.round(y + 1.772 * (cb - 128)), 0, 255);
  out[o + 3] = 255;
}

// ---------------------------------------------------------------- encoder
export function visTones(code) {
  const T = [[FREQ.leader, VIS_MS.leader], [FREQ.sync, VIS_MS.brk], [FREQ.leader, VIS_MS.leader], [FREQ.sync, VIS_MS.bit]];
  let ones = 0;
  for (let b = 0; b < 7; b++) { const bit = (code >> b) & 1; ones += bit; T.push([bit ? FREQ.bit1 : FREQ.bit0, VIS_MS.bit]); }
  T.push([ones % 2 ? FREQ.bit1 : FREQ.bit0, VIS_MS.bit]);
  T.push([FREQ.sync, VIS_MS.bit]);
  return T;
}

// Pixel value (0..255) of channel ch at column x of transmitted line k.
function chanValue(P, m, ch, k, x) {
  const w = P.w;
  if (m.rows === 2) {
    const a = (2 * k) * w + x, b = (2 * k + 1) * w + x;
    if (ch === 'Y0') return P.Y[a];
    if (ch === 'Y1') return P.Y[b];
    if (ch === 'RY') return (P.Cr[a] + P.Cr[b]) / 2;
    return (P.Cb[a] + P.Cb[b]) / 2;
  }
  const i = k * w + x;
  switch (ch) {
    case 'R': return P.R[i];
    case 'G': return P.G[i];
    case 'B': return P.B[i];
    case 'Y': return P.Y[i];
    case 'RY': return P.Cr[i];
    case 'BY': return P.Cb[i];
    case 'C': return k % 2 ? P.Cb[i] : P.Cr[i];
  }
  return 0;
}

// Every (Hz, ms) pair of one transmission. img must be m.W x m.H.
export function toneList(img, m, { vis = true } = {}) {
  const P = planes(img), out = vis ? visTones(m.vis) : [];
  for (const g of m.start || []) out.push([FREQ.sync, g.ms]);
  for (let k = 0; k < m.lines; k++) lineTones(P, m, k, out);
  return out;
}
// The tones of transmitted line k (P from planes()).
export function lineTones(P, m, k, out = []) {
  for (const g of lineSegs(m, k)) {
    if (g.t === 'sync') out.push([FREQ.sync, g.ms]);
    else if (g.t === 'porch') out.push([g.f, g.ms]);
    else { const px = g.ms / m.W; for (let x = 0; x < m.W; x++) out.push([lumToFreq(chanValue(P, m, g.ch, k, x)), px]); }
  }
  return out;
}

// Tones -> samples. clock: the sender clock error (0.005 = 0.5 % fast: the
// file plays 0.5 % slower and every tone is 0.5 % lower). shift: a fixed
// tuning error in Hz. drift: extra Hz from the start to the end. lead and
// tail: silence in seconds.
export function encode(img, m, fs, o = {}) {
  return synth(toneList(img, m, o), fs, o);
}
export function synth(tones, fs, { clock = 0, shift = 0, drift = 0, lead = 0, tail = 0, amp = 0.8 } = {}) {
  const k = 1 + clock;
  let total = 0;
  for (const t of tones) total += t[1];
  const n0 = Math.round(lead * fs), N = n0 + Math.ceil(total * k * fs / 1000) + Math.round(tail * fs);
  const out = new Float32Array(N);
  let tEnd = 0, n = n0, ph = 0;
  const T = total * k;
  for (const [f, ms] of tones) {
    tEnd += ms * k;
    const end = Math.min(N, n0 + Math.round(tEnd * fs / 1000));
    const fd = f / k + shift + (drift ? drift * ((tEnd - ms * k / 2) / T - 0.5) : 0);
    const w = TAU * fd / fs;
    for (; n < end; n++) { out[n] = amp * Math.sin(ph); ph += w; }
    if (ph > 1e6) ph %= TAU;
  }
  return out;
}

// ---------------------------------------------------------------- channel
export function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export function gauss(R) { let u = 0; while (u === 0) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * R()); }

// snr: dB of signal power to noise power over the whole audio band (0 to
// fs/2). fade: depth 0..1 of slow fades, fadeHz their rate. In place.
export function channel(x, fs, { snr = Infinity, fade = 0, fadeHz = 0.2, seed = 1, amp = 0.8 } = {}) {
  const R = rng(seed);
  const sig = amp * amp / 2, sd = Number.isFinite(snr) ? Math.sqrt(sig / Math.pow(10, snr / 10)) : 0;
  const ph1 = R() * TAU, ph2 = R() * TAU;
  for (let n = 0; n < x.length; n++) {
    let a = 1;
    if (fade > 0) {
      const t = n / fs;
      const s = 0.5 + 0.5 * Math.sin(TAU * fadeHz * t + ph1) * Math.cos(TAU * fadeHz * 0.37 * t + ph2);
      a = 1 - fade * s * s;
    }
    x[n] = x[n] * a + (sd ? sd * gauss(R) : 0);
  }
  return x;
}

// ---------------------------------------------------------------- demodulator
export class Demod {
  constructor(fs, f0 = FREQ.leader) {
    this.fs = fs; this.f0 = f0;
    let N = Math.round(fs * 0.003); if (N % 2 === 0) N++;
    this.N = N; this.delay = (N - 1) / 2 + 0.5;
    const fc = 1500 / fs, h = new Float32Array(N); let s = 0;
    for (let i = 0; i < N; i++) {
      const x = i - (N - 1) / 2;
      const sinc = x === 0 ? 2 * fc : Math.sin(TAU * fc * x) / (Math.PI * x);
      h[i] = sinc * (0.54 - 0.46 * Math.cos(TAU * i / (N - 1))); s += h[i];
    }
    for (let i = 0; i < N; i++) h[i] /= s;
    this.h = h;
    this.bi = new Float32Array(2 * N); this.bq = new Float32Array(2 * N); this.pos = 0;
    this.c = 1; this.s = 0; this.dc = Math.cos(TAU * f0 / fs); this.ds = -Math.sin(TAU * f0 / fs);
    this.pi = 0; this.pq = 0; this.count = 0; this.k = fs / TAU;
  }
  // Instantaneous frequency of each input sample (FIR delay not removed).
  // I and Q of the filter output go to iq when given (for the figure).
  run(x, out = new Float32Array(x.length), iq = null) {
    const { h, N, bi, bq, k, f0 } = this;
    let { pos, c, s, pi, pq, count } = this;
    const dc = this.dc, ds = this.ds;
    for (let n = 0; n < x.length; n++) {
      const v = x[n];
      bi[pos] = bi[pos + N] = v * c; bq[pos] = bq[pos + N] = v * s;
      const c2 = c * dc - s * ds; s = c * ds + s * dc; c = c2;
      if ((++count & 1023) === 0) { const r = 1 / Math.hypot(c, s); c *= r; s *= r; }
      pos = pos + 1 === N ? 0 : pos + 1;
      let I = 0, Q = 0;
      for (let j = 0; j < N; j++) { I += h[j] * bi[pos + j]; Q += h[j] * bq[pos + j]; }
      const re = I * pi + Q * pq, im = Q * pi - I * pq;
      out[n] = clamp(f0 + k * Math.atan2(im, re), 800, 3000);
      if (iq) { iq[2 * n] = I; iq[2 * n + 1] = Q; }
      pi = I; pq = Q;
    }
    Object.assign(this, { pos, c, s, pi, pq, count });
    return out;
  }
}

// Zero-crossing frequency: count sign changes in a window of win samples.
export function zeroCross(x, fs, win) {
  const out = new Float32Array(x.length), z = new Uint8Array(x.length);
  for (let n = 1; n < x.length; n++) z[n] = (x[n - 1] < 0) !== (x[n] < 0) ? 1 : 0;
  let c = 0;
  for (let n = 0; n < x.length; n++) {
    c += z[n]; if (n >= win) c -= z[n - win];
    out[n] = c * fs / (2 * Math.min(win, n + 1));
  }
  return out;
}

// ---------------------------------------------------------------- receiver
function grow(a, n) { if (a.length >= n) return a; const b = new a.constructor(Math.max(n, a.length * 2)); b.set(a); return b; }
const ind = (f) => clamp((1450 - f) / 200, 0, 1);
export let GUARD = 8;
export function setGuard(g) { GUARD = g; }

export class Receiver {
  // o: fs, mode (forces a mode; null = take it from the VIS), slant (true),
  // afc (true), start (sample where line 0 begins: skips the VIS search),
  // onVis(info), onLine(k, rows), onDone()
  constructor(o) {
    this.o = Object.assign({ slant: true, afc: true, mode: null, start: null }, o);
    this.fs = o.fs; this.dm = new Demod(o.fs);
    this.D = Math.round(this.dm.delay);
    this.f = new Float32Array(1 << 16); this.cf = new Float64Array(1 << 16); this.cs = new Float64Array(1 << 16);
    this.cf[0] = 0; this.cs[0] = 0;
    this.n = 0; this.raw = 0; this.skip = this.D;
    this.state = 'vis'; this.scan = 0; this.vis = null; this.afc = 0;
    this.mode = this.o.mode; this.img = null; this.k = 0; this.syncs = []; this.fit = null; this.chroma = null;
    this.buf = new Float32Array(4096);
    if (this.o.start != null && this.mode) this.begin(this.o.start);
  }
  push(x) {
    if (this.buf.length < x.length) this.buf = new Float32Array(x.length);
    const y = this.dm.run(x, this.buf);
    let from = 0;
    if (this.skip > 0) { from = Math.min(this.skip, x.length); this.skip -= from; }
    const add = x.length - from;
    if (add > 0) {
      this.f = grow(this.f, this.n + add); this.cf = grow(this.cf, this.n + add + 1); this.cs = grow(this.cs, this.n + add + 1);
      const f = this.f, cf = this.cf, cs = this.cs;
      for (let i = from; i < x.length; i++) { const v = y[i]; f[this.n] = v; cf[this.n + 1] = cf[this.n] + v; cs[this.n + 1] = cs[this.n] + ind(v - this.afc); this.n++; }
    }
    this.raw += x.length;
    this.step();
  }
  // Mean frequency over [a, b) in samples (fractional ends, linear interp).
  mean(a, b) {
    if (b - a < 1e-6) b = a + 1e-6;
    const C = (t) => { t = clamp(t, 0, this.n); const i = Math.floor(t), r = t - i; return i >= this.n ? this.cf[this.n] : this.cf[i] + r * (this.cf[i + 1] - this.cf[i]); };
    return (C(b) - C(a)) / (b - a);
  }
  smean(a, b) {
    a = clamp(Math.round(a), 0, this.n); b = clamp(Math.round(b), 0, this.n);
    return b > a ? (this.cs[b] - this.cs[a]) / (b - a) : 0;
  }
  step() {
    if (this.state === 'vis') this.findVis();
    if (this.state === 'image') this.lines();
  }
  findVis() {
    const fs = this.fs, ms = fs / 1000, bit = 30 * ms;
    const need = Math.round(11 * bit);
    let s = Math.max(this.scan, Math.round(220 * ms));
    for (; s + need < this.n; s += 2) {
      const fb = this.mean(s, s + 25 * ms);
      if (fb < 1120 || fb > 1300) continue;
      const lead = this.mean(s - 200 * ms, s - 5 * ms);
      if (Math.abs(lead - FREQ.leader) > 150) continue;
      // edge: last sample above 1550 Hz before s
      let e = s;
      for (let j = 0; j < 8 * ms && e > 0 && this.f[e - 1] < 1550 + (lead - 1900); j++) e--;
      const afc = this.o.afc ? this.mean(e - 260 * ms, e - 20 * ms) - FREQ.leader : 0;
      const bits = [];
      for (let b = 0; b < 8; b++) bits.push(this.mean(e + (b + 1.2) * bit, e + (b + 1.8) * bit) - afc);
      const stop = this.mean(e + 9.2 * bit, e + 9.8 * bit) - afc;
      if (Math.abs(stop - FREQ.sync) > 80 || bits.some(v => Math.abs(v - 1200) < 25 || Math.abs(v - 1200) > 200)) continue;
      const b = bits.map(v => (v < 1200 ? 1 : 0));
      let code = 0, ones = 0;
      for (let i = 0; i < 7; i++) { code |= b[i] << i; ones += b[i]; }
      const parity = (ones + b[7]) % 2 === 0;
      const m = this.o.mode || byVis(code);
      this.vis = { at: e, code, bits: b, freqs: bits, parity, afc, mode: m ? m.id : null };
      if (!parity || !m) { if (this.o.onVis) this.o.onVis(this.vis); s += need; continue; }
      this.afc = afc;
      for (let i = 0; i < this.n; i++) this.cs[i + 1] = this.cs[i] + ind(this.f[i] - afc);
      this.mode = m;
      if (this.o.onVis) this.o.onVis(this.vis);
      this.begin(e + 10 * bit + m.startMs * ms);
      return;
    }
    this.scan = s;
  }
  begin(t0) {
    const m = this.mode, ms = this.fs / 1000;
    this.t0 = t0; this.L = m.lineMs * ms; this.so = syncOffset(m) * ms; this.sl = m.syncMs * ms;
    this.fit = { a: t0 + this.so, P: this.L };
    this.img = new Uint8ClampedArray(m.W * m.H * 4);
    for (let i = 3; i < this.img.length; i += 4) this.img[i] = 255;
    this.k = 0; this.syncs = []; this.chroma = null; this.state = 'image';
  }
  // Best sync trailing edge near sample p, within +-w samples.
  findSync(p, w) {
    const sl = this.sl, tail = Math.max(2, Math.round(sl * 0.5));
    let best = -1, bx = p;
    const a = Math.max(0, Math.round(p - w)), b = Math.min(this.n - sl - tail, Math.round(p + w));
    for (let x = a; x <= b; x++) {
      const sc = this.smean(x, x + sl) - this.smean(x + sl, x + sl + tail);
      if (sc > best) { best = sc; bx = x; }
    }
    return { x: bx, score: best };
  }
  refit() {
    const pts = this.syncs.filter(p => p.ok);
    if (!this.o.slant || pts.length < 4) return;
    let use = pts;
    for (let it = 0; it < 2; it++) {
      let sk = 0, sx = 0, skk = 0, skx = 0;
      for (const p of use) { sk += p.k; sx += p.x; skk += p.k * p.k; skx += p.k * p.x; }
      const n = use.length, den = n * skk - sk * sk;
      if (den <= 0) return;
      const P = clamp((n * skx - sk * sx) / den, this.L * 0.97, this.L * 1.03), a = (sx - P * sk) / n;
      this.fit = { a, P };
      const tol = Math.max(this.sl * 0.6, this.fs * 0.0015);
      use = pts.filter(p => Math.abs(p.x - (a + P * p.k)) < tol);
      if (use.length < 4) return;
    }
  }
  lines() {
    const m = this.mode;
    const w = Math.max(this.sl * 1.5, this.L * 0.03);
    while (this.k < m.lines) {
      const k = this.k, F = this.fit;
      const pred = F.a + k * F.P;
      if (pred + this.L + w + this.sl * 2 > this.n) return;
      const s = this.findSync(pred, w);
      this.syncs.push({ k, x: s.x, score: s.score, ok: s.score > 0.45 });
      this.refit();
      this.drawLine(k);
      this.k++;
    }
    this.finish();
  }
  // Pixel rows of line k under the current fit.
  drawLine(k, fit = this.fit) {
    const m = this.mode, ms = this.fs / 1000, W = m.W;
    const sc = this.o.slant ? fit.P / this.L : 1;
    const P = this.o.slant ? fit.P : this.L, a = this.o.slant ? fit.a : this.t0 + this.so;
    let t = a + k * P - this.so * sc;
    const ch = {};
    let sepHi = k % 2 === 1;
    for (let si = 0; si < m.seq.length; si++) {
      const g = m.seq[si], len = g.ms * ms * sc;
      if (g.t === 'scan') {
        // The FIR smears the tone of the next segment into the last
        // pixels: a sync pulls them dark and tints the colour. Keep each
        // pixel window inside the segment: 2.5 samples at a start and at
        // an end before a porch, GUARD samples at an end before a sync.
        const nx = m.seq[(si + 1) % m.seq.length], k = this.fs / 11025;
        const Ge = Math.min((nx.t === 'sync' ? GUARD : 2.5) * k, len * 0.02), Gs = Math.min(2.5 * k, len * 0.02);
        const v = new Float32Array(W), px = len / W, lo = t + Gs, hi = t + len - Ge;
        for (let x = 0; x < W; x++) { const a = clamp(t + x * px, lo, hi - 0.5), b = clamp(t + (x + 1) * px, a + 0.5, hi); v[x] = freqToLum(this.mean(a, b) - this.afc); }
        ch[g.ch] = v;
      } else if (g.f === 'parity') sepHi = this.mean(t + len * 0.2, t + len * 0.8) - this.afc > 1900;
      t += len;
    }
    const img = this.img, rows = [];
    const put = (row, fn) => { for (let x = 0; x < W; x++) fn(x, (row * W + x) * 4); rows.push(row); };
    if (m.colour === 'BW') put(k, (x, o) => { img[o] = img[o + 1] = img[o + 2] = ch.Y[x]; img[o + 3] = 255; });
    else if (m.colour === 'GBR' || m.colour === 'RGB') put(k, (x, o) => { img[o] = ch.R[x]; img[o + 1] = ch.G[x]; img[o + 2] = ch.B[x]; img[o + 3] = 255; });
    else if (m.rows === 2) {
      put(2 * k, (x, o) => ycc2rgb(ch.Y0[x], ch.BY[x], ch.RY[x], img, o));
      put(2 * k + 1, (x, o) => ycc2rgb(ch.Y1[x], ch.BY[x], ch.RY[x], img, o));
    } else if (ch.C) {
      // Robot 36: this line has one chroma. Pair it with the last line's.
      const prev = this.chroma && this.chroma.k === k - 1 ? this.chroma : null;
      const cr = sepHi ? (prev ? prev.c : null) : ch.C, cb = sepHi ? ch.C : (prev ? prev.c : null);
      const CR = cr || new Float32Array(W).fill(128), CB = cb || new Float32Array(W).fill(128);
      put(k, (x, o) => ycc2rgb(ch.Y[x], CB[x], CR[x], img, o));
      if (prev && k > 0) put(k - 1, (x, o) => ycc2rgb(prev.y[x], CB[x], CR[x], img, o));
      this.chroma = { k, c: ch.C, y: ch.Y };
    } else put(k, (x, o) => ycc2rgb(ch.Y[x], ch.BY[x], ch.RY[x], img, o));
    if (this.o.onLine) this.o.onLine(k, rows);
    return rows;
  }
  finish() {
    if (this.state === 'done') return;
    if (this.o.slant && this.mode) { this.chroma = null; const cb = this.o.onLine; this.o.onLine = null; for (let k = 0; k < this.mode.lines; k++) this.drawLine(k); this.o.onLine = cb; }
    this.state = 'done';
    if (this.o.onDone) this.o.onDone(this);
  }
  // Line-period estimate as a clock error (0.005 = 0.5 % slow lines).
  clockError() { return this.fit ? this.fit.P / this.L - 1 : 0; }
}

// Samples -> picture in one call. Chunked, like a live stream.
export function decodeAll(x, fs, o = {}) {
  const R = new Receiver(Object.assign({ fs }, o));
  const C = 8192;
  for (let i = 0; i < x.length; i += C) R.push(x.subarray(i, Math.min(x.length, i + C)));
  // tail: give the last line its window
  if (R.state !== 'done') R.push(new Float32Array(Math.round(fs * (0.3 + (R.mode ? R.mode.lineMs / 1000 : 0)))));
  if (R.state === 'image') R.finish();
  return R;
}

// ---------------------------------------------------------------- files
export function wavBytes(x, fs) {
  const n = x.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, fs, true); v.setUint32(28, fs * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, clamp(Math.round(x[i] * 32767), -32768, 32767), true);
  return new Uint8Array(b);
}
export function parseWav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o, n) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (str(0, 4) !== 'RIFF' || str(8, 4) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12, fmt = null;
  while (o + 8 <= bytes.length) {
    const id = str(o, 4), len = v.getUint32(o + 4, true), d = o + 8;
    if (id === 'fmt ') fmt = { tag: v.getUint16(d, true), ch: v.getUint16(d + 2, true), fs: v.getUint32(d + 4, true), bits: v.getUint16(d + 14, true) };
    else if (id === 'data' && fmt) {
      const bps = fmt.bits / 8, frames = Math.floor(Math.min(len, bytes.length - d) / (bps * fmt.ch)), out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < fmt.ch; c++) {
          const p = d + (i * fmt.ch + c) * bps;
          s += fmt.tag === 3 ? v.getFloat32(p, true) : bps === 1 ? (v.getUint8(p) - 128) / 128 : bps === 2 ? v.getInt16(p, true) / 32768
            : bps === 3 ? ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) / 8388608) : v.getInt32(p, true) / 2147483648;
        }
        out[i] = s / fmt.ch;
      }
      return { fs: fmt.fs, bits: fmt.bits, channels: fmt.ch, samples: out };
    }
    o = d + len + (len & 1);
  }
  throw new Error('WAV has no data chunk');
}

export function psnr(a, b) {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; s += d * d; n++; }
  return s === 0 ? 99 : 10 * Math.log10(255 * 255 / (s / n));
}

export { MODES, totalMs };

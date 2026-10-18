// ============================================================================
//  CORAL REEF  ·  ROV  ·  the simulated SSTV link (DOM-free, node and browser)
// ----------------------------------------------------------------------------
//  One camera frame goes over a slow-scan TV radio link, with the site's own
//  SSTV code from pages/sstv (imported, not copied):
//    frame (RGBA) --codec.encode--> audio samples (VIS header + lines of a
//    real mode) --noise--> samples --Session (Receiver)--> picture rows
//  The receiver finds the VIS code in the audio, so the mode on the HUD is
//  the mode that it decoded, not the mode that was sent. Without a VIS
//  (deep noise) no picture arrives; the link tells the HUD "no VIS".
//
//  NOISE. makeSamples() adds, per frame, from a seeded generator:
//    snr ..... white noise over the audio band (codec.channel), 21 to 30 dB
//    fades ... codec.channel slow fades, plus 0 to 2 deep fades: the
//              signal drops to 8 to 25 % for 0.6 to 2.5 s (a bad line
//              band in the picture)
//    slant ... the sender clock is off by up to 300 ppm (the receiver line
//              fit removes that), and the receiver slant calibration is
//              off by 50 to 200 ppm: SstvLink scales the line period of
//              each fit by (1 + lean), so the picture leans a little, as
//              on a receiver with a manual clock setting. This wraps
//              refit() on the Receiver instance; pages/sstv is not edited.
//  The envelope (signal level per 20 ms) goes to the HUD signal meter.
//
//  TIME. advance(dt) moves the play head by dt x speed seconds of audio
//  and feeds the receiver every sample up to it, so the picture builds
//  line by line at the true line rate of the mode (Robot 8 B&W: 67 ms a
//  line; Robot 36: 150 ms a line; Martin M1: 446.4 ms a line) times speed. After the last line the
//  picture holds for hold seconds, then the link asks for a new frame.
//  The display buffer keeps the last picture under the new rows, as the
//  screen of a real receiver does.
//
//  grep -n targets
//    "export function frameToMode"   render target pixels -> mode-size RGBA
//    "export function makeSamples"   encode + noise (also in feed-worker.js)
//    "export class SstvLink"         the state machine
//    "  advance("                    feed the receiver
//    "  status("                     phase, line, mode, VIS, signal
// ============================================================================
import { encode, channel, rng as crng } from '../../sstv/codec.js';
import { byId, totalMs, MODES } from '../../sstv/modes.js';
import { Session, LEAD, TAIL } from '../../sstv/session.js';

// Robot 8 B&W is the fastest true mode of pages/sstv/modes.js (160 x 120,
// 67 ms a line, about 9 s with the VIS); Robot 36 is the fastest colour one.
export const LINK_MODES = ['r8', 'r36', 'm1'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Linear (or byte) pixels from a render target -> RGBA at the mode size.
// src: Float32Array / Uint8Array RGBA rows bottom-up (GL order), w x h.
// o.gain: a fixed gain, or the auto gain (AGC) of o.agc { g } is used and
// updated. The camera curve: gain, a soft knee, then the sRGB curve.
// o.raw: the pixels are final bytes (the GPU did the curve): flip and
// crop only.
export function frameToMode(src, w, h, mode, o = {}) {
  const m = typeof mode === 'string' ? byId(mode) : mode;
  const W = m.W, H = m.H, out = new Uint8ClampedArray(W * H * 4);
  const lin = o.linear !== false, scale = src instanceof Uint8Array || src instanceof Uint8ClampedArray ? 1 / 255 : 1;
  // AGC from the 97th percentile of the luminance
  let gain = o.raw ? 1 : o.gain;
  if (gain == null) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < w * h; i += 3) {
      const Y = (0.2126 * src[i * 4] + 0.7152 * src[i * 4 + 1] + 0.0722 * src[i * 4 + 2]) * scale;
      hist[clamp(Math.floor(Math.sqrt(Math.max(Y, 0)) * 255), 0, 255)]++;
    }
    let n = 0, total = Math.ceil(w * h / 3), p = 255;
    for (let i = 255; i >= 0; i--) { n += hist[i]; if (n > total * 0.03) { p = i; break; } }
    const hi = Math.max(1e-4, (p / 255) ** 2);
    const want = clamp(0.55 / hi, 1, o.maxGain ?? 60);
    const agc = o.agc || { g: want };
    agc.g += (want - agc.g) * (o.agcRate ?? 0.6);
    gain = agc.g;
    if (o.agc) o.agc.g = agc.g;
  }
  const curve = new Uint8Array(4096);
  if (o.raw) for (let i = 0; i < 4096; i++) curve[i] = Math.min(255, Math.round(i / 4095 * 4 * 255));   // bytes as they are (gain 1)
  else for (let i = 0; i < 4096; i++) {
    let v = i / 4095 * 4;                           // 0..4 linear, after gain
    v = v / (1 + v * 0.35);                         // soft knee
    v = lin ? (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) : v;
    curve[i] = clamp(Math.round(v * 255), 0, 255);
  }
  // cover: scale to fill the mode picture, crop the centre
  const k = Math.min(w / W, h / H), cx = (w - W * k) / 2, cy = (h - H * k) / 2;
  for (let y = 0; y < H; y++) {
    const gy = clamp(Math.floor(cy + (y + 0.5) * k), 0, h - 1), row = h - 1 - gy;    // flip: GL rows are bottom-up
    for (let x = 0; x < W; x++) {
      const gx = clamp(Math.floor(cx + (x + 0.5) * k), 0, w - 1), i = (row * w + gx) * 4, j = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) out[j + c] = curve[clamp(Math.floor(src[i + c] * scale * gain * 1023.75), 0, 4095)];
      out[j + 3] = 255;
    }
  }
  return { w: W, h: H, data: out, gain };
}

// Encode + noise. p: { mode, fs, seed, snr, fade, clock, dips }.
// Returns { samples, env, envHz, params } (env: signal level 0..1).
export function makeSamples(img, p) {
  const m = typeof p.mode === 'string' ? byId(p.mode) : p.mode, fs = p.fs || 11025;
  const x = encode(img, m, fs, { lead: LEAD, tail: TAIL, clock: p.clock || 0 });
  const envHz = 50, env = new Float32Array(Math.ceil(x.length / fs * envHz) + 1).fill(1);
  for (const d of p.dips || []) {
    // a deep fade with soft edges: gain g at its floor
    const a = Math.round(d.at * fs), b = Math.min(x.length, Math.round((d.at + d.len) * fs)), ramp = Math.round(0.25 * fs);
    for (let n = Math.max(0, a - ramp); n < Math.min(x.length, b + ramp); n++) {
      const u = n < a ? (a - n) / ramp : n > b ? (n - b) / ramp : 0;
      const g = d.floor + (1 - d.floor) * (u * u * (3 - 2 * u));
      x[n] *= g;
      const e = Math.floor(n / fs * envHz); env[e] = Math.min(env[e], g);
    }
  }
  if (p.fade) {      // the slow fade of codec.channel, for the envelope too
    const R = crng(p.seed || 1), TAU = Math.PI * 2, ph1 = R() * TAU, ph2 = R() * TAU, fadeHz = 0.2;
    for (let e = 0; e < env.length; e++) {
      const t = e / envHz, s = 0.5 + 0.5 * Math.sin(TAU * fadeHz * t + ph1) * Math.cos(TAU * fadeHz * 0.37 * t + ph2);
      env[e] *= 1 - p.fade * s * s;
    }
  }
  channel(x, fs, { snr: p.snr ?? Infinity, fade: p.fade || 0, seed: p.seed || 1 });
  return { samples: x, env, envHz, params: p };
}

// The noise of one frame, from a seeded generator.
export function frameParams(R, o = {}) {
  const snr = o.snr != null ? o.snr : 21 + 9 * R();
  const clock = o.clock != null ? o.clock : (R() * 2 - 1) * 0.0003;
  const lean = o.lean != null ? o.lean : (R() < 0.5 ? -1 : 1) * (0.00005 + 0.00015 * R());
  const dips = [];
  if (o.dips !== false) {
    const n = R() < 0.4 ? 0 : R() < 0.75 ? 1 : 2;
    const m = byId(o.mode || 'r36'), dur = totalMs(m) / 1000;
    for (let i = 0; i < n; i++) dips.push({ at: LEAD + 1 + R() * (dur - 3), len: 0.6 + 1.9 * R(), floor: 0.08 + 0.17 * R() });
  }
  return { mode: o.mode || 'r36', fs: o.fs || 11025, snr, fade: o.fade != null ? o.fade : 0.15 + 0.2 * R(), clock, lean, dips, seed: Math.floor(R() * 2 ** 31) };
}

export class SstvLink {
  // o: mode ('r8' | 'r36' | 'm1'), fs, seed, speed (audio seconds per second,
  // default 1), hold (s), noise (overrides for frameParams: snr, fade,
  // clock, lean, dips; false for a clean link)
  constructor(o = {}) {
    this.o = o; this.mode = byId(o.mode || 'r36') || byId('r36');
    this.fs = o.fs || 11025; this.speed = o.speed ?? 1; this.hold = o.hold ?? 2.5;
    this.R = crng((o.seed ?? 1) * 7 + 3);
    this.picture = new Uint8ClampedArray(320 * 256 * 4);
    this.pw = this.mode.W; this.ph = this.mode.H; this.resetPicture();
    this.session = null; this.env = null; this.state = 'idle'; this.wait = 0; this.frames = 0;
    this.rows = 0;           // rows painted since the last take()
    this.lastRow = -1; this.visCode = null; this.visMode = null; this.noVis = false;
  }
  resetPicture() {
    this.picture = new Uint8ClampedArray(this.mode.W * this.mode.H * 4);
    for (let i = 0; i < this.picture.length; i += 4) { this.picture[i] = 8; this.picture[i + 1] = 10; this.picture[i + 2] = 12; this.picture[i + 3] = 255; }
    this.pw = this.mode.W; this.ph = this.mode.H;
  }
  setMode(id) { const m = byId(id); if (!m || m === this.mode) return; this.mode = m; this.resetPicture(); this.session = null; this.state = 'idle'; this.wait = 0; }
  // The noise for the next frame (call before begin, or let begin do it).
  nextParams() { return frameParams(this.R, Object.assign({ mode: this.mode.id, fs: this.fs }, this.o.noise === false ? { snr: Infinity, fade: 0, clock: 0, lean: 0, dips: false } : this.o.noise || {})); }
  // Start a transmission from mode-size RGBA (sync encode)...
  begin(img, params = this.nextParams()) { return this.beginSamples(makeSamples(img, params)); }
  // ...or from samples that a worker made.
  beginSamples(S) {
    this.env = S.env; this.envHz = S.envHz; this.params = S.params;
    this.visCode = null; this.visMode = null; this.noVis = false; this.lastRow = -1;
    this.session = new Session({
      samples: S.samples, mode: this.mode, fs: this.fs, slant: true,
      onVis: (v) => { this.visCode = v.code; this.visMode = v.mode; },
      onLine: (k, rows) => this.copyRows(rows),
      onDone: (R) => { if (R.img) this.copyAll(R.img); },
      onNoVis: () => { this.noVis = true; },
    });
    const rx = this.session.rx, lean = S.params.lean || 0;
    if (lean) {
      const fit0 = rx.refit.bind(rx);
      rx.refit = () => { fit0(); if (rx.fit && rx.syncs.length >= 4) rx.fit = { a: rx.fit.a, P: rx.fit.P * (1 + lean) }; };
    }
    this.state = 'rx'; this.play = 0; this.frames++;
    return this;
  }
  copyRows(rows) {
    const src = this.session.rx.img, W = this.mode.W;
    if (!src) return;
    for (const r of rows) { if (r < 0 || r >= this.mode.H) continue; this.picture.set(src.subarray(r * W * 4, (r + 1) * W * 4), r * W * 4); this.lastRow = Math.max(this.lastRow, r); }
    this.rows += rows.length;
  }
  copyAll(img) { if (img.length === this.picture.length) this.picture.set(img); this.rows += this.mode.H; }
  // The frame source is ready when state is 'need'. dt: wall seconds.
  advance(dt) {
    if (this.state === 'rx') {
      this.play += dt * this.speed;
      const S = this.session;
      S.advance(this.play);
      if (S.rx.state === 'vis' && this.play > LEAD + 1.4) this.noVis = true;     // the VIS window has passed
      if (S.done || this.play >= S.dur) { this.state = 'hold'; this.wait = this.hold; }
    } else if (this.state === 'hold') {
      this.wait -= dt;
      if (this.wait <= 0) this.state = 'need';
    } else if (this.state === 'idle') this.state = 'need';
    return this.state;
  }
  // Signal level now, 0..1, and as an SNR in dB.
  signal() {
    if (!this.session || this.state !== 'rx') return { level: 0, db: -Infinity };
    const e = this.env[clamp(Math.floor(this.play * this.envHz), 0, this.env.length - 1)];
    const snr = (this.params.snr ?? 30) + 20 * Math.log10(Math.max(e, 1e-3));
    return { level: clamp((snr + 6) / 36, 0, 1), db: snr };
  }
  status() {
    const s = this.session, m = this.mode;
    const vm = this.visMode ? byId(this.visMode) : null;
    const st = s ? s.status() : { phase: 'idle', line: 0 };
    return {
      phase: this.state === 'rx' ? (st.phase === 'vis' ? (this.noVis ? 'novis' : 'vis') : st.phase) : this.state,
      line: st.phase === 'image' || st.phase === 'done' ? Math.min(st.line, m.lines) : 0, lines: m.lines,
      row: this.lastRow, rowsPerLine: m.rows, mode: (vm || m).name, modeId: (vm || m).id, vis: this.visCode, sentVis: m.vis,
      signal: this.signal(), frames: this.frames, lineMs: m.lineMs,
    };
  }
  // Rows painted since the last call (for a cheap redraw test).
  take() { const r = this.rows; this.rows = 0; return r; }
}

export { MODES, byId, totalMs };

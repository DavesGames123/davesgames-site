// ============================================================================
//  SSTV  ·  one transmission, sent and received  (ES module)
// ----------------------------------------------------------------------------
//  A Session owns the whole round trip of one picture:
//    encode (codec.js) -> channel noise -> samples (what the speaker plays)
//    -> Receiver fed up to the play head -> rows painted into a CRT
//  The finale, the hero, the saver and the node thumbnail all use it.
//  The play head t is in seconds of transmission. Call advance(t) every
//  frame: it feeds the receiver every sample up to t, so the picture on
//  the CRT is always what the decoder has made of the audio so far.
//
//  beam() says where the electron beam is now: the line the play head is
//  in (from the receiver's line fit, or the nominal timing before the
//  VIS is decoded), the fraction across the current scan segment and the
//  colour of that channel. During sync and porches the beam is off.
//
//  grep -n targets
//    "export class Session"
//    "  advance("     feed the receiver
//    "  beam("        beam row, x and colour
//    "  status("      text for readouts
// ============================================================================
import { encode, channel, Receiver } from './codec.js';
import { totalMs, VIS_MS, syncOffset } from './modes.js';

export const LEAD = 0.4, TAIL = 0.5;
const CH_COL = { R: [255, 80, 70], G: [90, 255, 120], B: [90, 140, 255], Y: null, Y0: null, Y1: null, RY: [255, 120, 160], BY: [120, 190, 255], C: [200, 160, 255] };

export class Session {
  // o: mode, img (RGBA at mode size), fs, snr, fade, clock, shift, drift,
  // slant, afc, seed, crt (a CRT, optional), samples (decode these instead)
  constructor(o) {
    this.o = o; this.m0 = o.mode || null; this.fs = o.fs || 11025;
    if (o.samples) this.x = o.samples;
    else {
      this.x = encode(o.img, this.m, this.fs, { lead: LEAD, tail: TAIL, clock: o.clock || 0, shift: o.shift || 0, drift: o.drift || 0 });
      if ((o.snr != null && Number.isFinite(o.snr)) || o.fade) channel(this.x, this.fs, { snr: o.snr == null ? Infinity : o.snr, fade: o.fade || 0, seed: o.seed || 1 });
    }
    this.dur = this.x.length / this.fs;
    this.t = 0; this.fed = 0; this.done = false; this.visInfo = null;
    this.crt = o.crt || null;
    if (this.crt && this.m0) this.crt.setPicture(this.m0.W, this.m0.H, this.m0.aspect);
    this.rx = new Receiver({
      fs: this.fs, slant: o.slant !== false, afc: o.afc !== false, mode: o.forceMode ? this.m : null,
      onVis: (v) => {
        this.visInfo = v;
        // a file or a microphone: the picture size comes with the VIS
        if (this.crt && v.mode && this.rx.mode && (!this.m0 || this.m0 !== this.rx.mode)) { this.m0 = this.rx.mode; this.crt.setPicture(this.m0.W, this.m0.H, this.m0.aspect); }
        if (o.onVis) o.onVis(v);
      },
      onLine: (k, rows) => { if (this.crt) this.crt.paintRows(this.rx.img, rows, this.wall == null ? this.t : this.wall); if (o.onLine) o.onLine(k, rows); },
      onDone: (R) => { this.done = true; if (this.crt && R.img) this.crt.paintAll(R.img); if (o.onDone) o.onDone(R); },
    });
  }
  // t: play head (s of transmission). wall: the display clock (s) that
  // CRT.render gets as o.t, so the phosphor fades in real time.
  advance(t, wall = null) {
    this.wall = wall;
    this.t = Math.max(0, Math.min(this.dur, t));
    const want = Math.floor(this.t * this.fs);
    const C = 4096;
    while (this.fed < want) {
      const e = Math.min(want, this.fed + C);
      this.rx.push(this.x.subarray(this.fed, e));
      this.fed = e;
    }
    if (this.t >= this.dur && !this.done) {
      if (this.rx.state === 'image') { this.rx.push(new Float32Array(Math.round(this.fs * (this.m.lineMs / 1000 + 0.3)))); if (this.rx.state === 'image') this.rx.finish(); }
      if (this.o.samples && this.rx.state === 'vis' && this.o.onNoVis) this.o.onNoVis();
      if (this.rx.state !== 'done') this.done = true;
    }
  }
  // The nominal time of the VIS start and of line 0 (s), before any fit.
  visStart() { return LEAD; }
  imageStart() { return LEAD + (VIS_MS.total + this.m.startMs) / 1000; }
  get m() { return (this.rx && this.rx.mode) || this.m0; }
  beam() { return beamAt(this.m, this.rx, this.t * this.fs, this.m0 ? this.imageStart() * this.fs : null); }
  status() {
    const rx = this.rx;
    if (rx.state === 'vis') return { phase: this.t < LEAD && !this.o.samples ? 'idle' : 'vis', line: 0 };
    return { phase: rx.state === 'done' ? 'done' : 'image', line: rx.k, lines: this.m.lines, clock: rx.clockError(), syncs: rx.syncs };
  }
  totalSec() { return totalMs(this.m) / 1000; }
}

// Beam state at sample n of receiver rx. Before the VIS is decoded, the
// nominal line-0 sample i0 (or null: no beam) sets the timing.
export function beamAt(m, rx, n, i0) {
  if (!m) return null;
  const fs = rx.fs;
  let a, P, so;
  if (rx.fit && rx.state !== 'vis') { P = rx.o.slant ? rx.fit.P : rx.L; a = rx.o.slant ? rx.fit.a : rx.t0 + rx.so; so = rx.so * (P / rx.L); }
  else { if (i0 == null) return null; P = m.lineMs * fs / 1000; so = syncOffset(m) * fs / 1000; a = i0 + so; }
  {
    const start = a - so;
    if (n < start) return null;
    const k = Math.floor((n - start) / P);
    if (k >= m.lines) return null;
    const u = ((n - start) / P - k) * m.lineMs;
    let acc = 0;
    for (const g of m.seq) {
      if (u < acc + g.ms) {
        if (g.t !== 'scan') return { k, row: k * m.rows, x: null, off: true, seg: g };
        const row = k * m.rows + (g.ch === 'Y1' ? 1 : 0);
        return { k, row, x: (u - acc) / g.ms, col: CH_COL[g.ch] || null, seg: g };
      }
      acc += g.ms;
    }
    return null;
  }
}

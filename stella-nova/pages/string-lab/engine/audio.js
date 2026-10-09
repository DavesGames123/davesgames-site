// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · audio.js — string voices, body filters, strums, WebAudio graph
// ────────────────────────────────────────────────────────────────────────────
//  Three voices make a mono buffer of the BRIDGE FORCE of one string:
//    modal  sum of decaying modes (f_n with inharmonicity, sigma_n), the
//           default: cheap and exact for the linear model
//    sim    the finite-difference StringSim itself (slower, same physics as
//           the views; needed for bowing)
//    ks     Karplus-Strong delay line, the low-power fallback
//  The body is a bank of peaking biquads (resonances of the top plate and
//  the air cavity). The same RBJ formula runs offline in applyBody() and in
//  the WebAudio graph as BiquadFilterNode type 'peaking'.
//
//  AudioEngine makes no AudioContext until start(), which the page must call
//  from a user gesture. Volume is low by default. stopAll() fades every
//  voice; bindPagehide() calls it on pagehide.
//
//  SECTION MAP   (grep -n "<anchor>" audio.js)
//    modal voice .......... "export function renderModal"
//    simulated voice ...... "export function renderSim"
//    Karplus-Strong ....... "export function renderKS"
//    body resonances ...... "export const BODY_MODES"
//    offline body filter .. "export function applyBody"
//    strum timing ......... "export function strumOffsets"
//    engine class ......... "export class AudioEngine"
//    node stub ............ "export function createStubContext"
// ════════════════════════════════════════════════════════════════════════════

import { StringSim, modalFrequencies, modalDecay, pluckCoefficients } from './strings.js';
import { INSTRUMENTS, stringParams, midiToFreq } from './instruments.js';

function normalize(buf, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) { const g = peak / m; for (let i = 0; i < buf.length; i++) buf[i] *= g; }
  return buf;
}

function fadeTail(buf, fs, ms = 30) {
  const n = Math.min(buf.length, Math.round((ms / 1000) * fs));
  for (let i = 0; i < n; i++) buf[buf.length - 1 - i] *= i / n;
  return buf;
}

/**
 * Modal voice: bridge force F(t) = T sum_n b_n (n pi / L) e^{-sigma_n t} cos(w_n t).
 * Each mode is a complex phasor rotated once per sample (no cos per sample).
 */
export function renderModal(p, { pos = 0.2, amp = 0.002, seconds = 2.5, fs = 44100, nMax = 80, attackMs = 1.5 } = {}) {
  const n = Math.round(seconds * fs);
  const out = new Float32Array(n);
  const freqs = modalFrequencies(p, nMax), dec = modalDecay(p, nMax), b = pluckCoefficients(pos, amp, nMax);
  const acc = new Float64Array(n);
  for (let m = 0; m < nMax; m++) {
    const f = freqs[m];
    if (f >= 0.45 * fs) break;
    const A = p.T * b[m] * (((m + 1) * Math.PI) / p.L);
    if (Math.abs(A) < 1e-12) continue;
    const r = Math.exp(-dec[m] / fs), w = (2 * Math.PI * f) / fs;
    const cr = r * Math.cos(w), ci = r * Math.sin(w);
    let x = A, y = 0;
    for (let i = 0; i < n; i++) {
      acc[i] += x;
      const t = x * cr - y * ci;
      y = x * ci + y * cr;
      x = t;
      if ((i & 1023) === 0 && Math.abs(x) + Math.abs(y) < 1e-7 * Math.abs(A)) break;
    }
  }
  // short attack ramp: a real finger releases the string over about 1 ms
  const na = Math.round((attackMs / 1000) * fs);
  for (let i = 0; i < n; i++) out[i] = acc[i] * (i < na ? i / na : 1);
  return fadeTail(normalize(out), fs);
}

/** Simulated voice: the StringSim bridge force (pluck, or bow when bow is given). */
export function renderSim(p, { pos = 0.2, amp = 0.002, seconds = 2, fs = 44100, bow = null, bowSeconds = 0 } = {}) {
  const sim = new StringSim({ ...p, fs });
  if (bow) sim.bow(bow);
  else sim.pluck({ pos, amp, width: 0.01 });
  const n = Math.round(seconds * fs);
  const out = new Float32Array(n);
  const stopAt = bow ? Math.round((bowSeconds || seconds * 0.8) * fs) : -1;
  for (let i = 0; i < n; i++) {
    if (i === stopAt) sim.stopBow();
    sim.step(1);
    out[i] = sim.bridgeForce();
  }
  // remove DC (static bow displacement)
  let mean = 0;
  for (let i = 0; i < n; i++) mean += out[i];
  mean /= n;
  for (let i = 0; i < n; i++) out[i] -= mean;
  return fadeTail(normalize(out), fs);
}

/**
 * Karplus-Strong: noise burst in a delay line with a two-point average.
 * decay sets the loop gain, brightness mixes the average (0 dark, 1 bright).
 * Fractional delay by a first-order allpass for exact tuning.
 */
export function renderKS(f, { seconds = 2, fs = 44100, decay = 0.996, brightness = 0.5, seed = 1 } = {}) {
  const n = Math.round(seconds * fs);
  const out = new Float32Array(n);
  // loop delay: integer part + allpass fraction; averaging filter adds 0.5 sample
  const D = fs / f - 0.5 * (1 - brightness) - 0.0;
  let N = Math.floor(D - 0.5);
  if (N < 2) N = 2;
  const frac = D - N;
  const C = (1 - frac) / (1 + frac);
  const line = new Float32Array(N);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < N; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    line[i] = (s / 4294967296) * 2 - 1;
  }
  let idx = 0, prev = 0, apX = 0, apY = 0;
  for (let i = 0; i < n; i++) {
    const x = line[idx];
    const avg = brightness * x + (1 - brightness) * 0.5 * (x + prev);
    prev = x;
    // allpass fractional delay
    const y = C * (avg - apY) + apX;
    apX = avg;
    apY = y;
    line[idx] = y * decay;
    out[i] = x;
    idx = (idx + 1) % N;
  }
  return fadeTail(normalize(out), fs);
}

/**
 * Body resonances per instrument [2: Fletcher & Rossing ch. 9, 10]:
 * guitar air mode near 100 Hz, top plate (1,1) near 200 Hz, higher plate
 * modes; violin A0 air mode near 280 Hz, B1- and B1+ corpus modes near
 * 470 and 550 Hz, and the bridge hill near 2.5 kHz.
 */
export const BODY_MODES = {
  steel: [
    { f: 102, q: 6, gainDb: 8 }, { f: 205, q: 8, gainDb: 7 }, { f: 390, q: 6, gainDb: 4 },
    { f: 720, q: 5, gainDb: 2 }, { f: 2600, q: 1.2, gainDb: 3 },
  ],
  classical: [
    { f: 96, q: 6, gainDb: 8 }, { f: 190, q: 8, gainDb: 8 }, { f: 410, q: 6, gainDb: 3 },
    { f: 1800, q: 1.2, gainDb: 1 }, { f: 4000, q: 0.8, gainDb: -4 },
  ],
  violin: [
    { f: 280, q: 8, gainDb: 7 }, { f: 470, q: 10, gainDb: 6 }, { f: 550, q: 10, gainDb: 7 },
    { f: 1100, q: 3, gainDb: 2 }, { f: 2500, q: 1.5, gainDb: 6 },
  ],
};

/** RBJ peaking biquad coefficients (the WebAudio 'peaking' filter). */
export function peakingCoefs(f, q, gainDb, fs) {
  const A = 10 ** (gainDb / 40), w = (2 * Math.PI * f) / fs;
  const al = Math.sin(w) / (2 * q), cw = Math.cos(w);
  const a0 = 1 + al / A;
  return {
    b0: (1 + al * A) / a0, b1: (-2 * cw) / a0, b2: (1 - al * A) / a0,
    a1: (-2 * cw) / a0, a2: (1 - al / A) / a0,
  };
}

/** Offline body filter: the peaking bank in series. Returns a new buffer. */
export function applyBody(buf, fs, modes) {
  let x = Float64Array.from(buf);
  for (const m of modes) {
    const c = peakingCoefs(m.f, m.q, m.gainDb, fs);
    const y = new Float64Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
      y[i] = v;
    }
    x = y;
  }
  return normalize(Float32Array.from(x));
}

/**
 * Start offsets (s) of a strum over n strings (index 0 = lowest).
 * A down stroke hits the low string first; an up stroke the high string.
 */
export function strumOffsets(n, { direction = 'down', spreadMs = 30 } = {}) {
  const step = n > 1 ? spreadMs / 1000 / (n - 1) : 0;
  const out = [];
  for (let i = 0; i < n; i++) out.push((direction === 'up' ? n - 1 - i : i) * step);
  return out;
}

// ── engine ──────────────────────────────────────────────────────────────────

const defaultCreate = () => {
  const C = globalThis.AudioContext || globalThis.webkitAudioContext;
  return C ? new C() : null;
};

export class AudioEngine {
  constructor({ createContext = defaultCreate, volume = 0.12, method = 'modal', lowPower = false } = {}) {
    this._create = createContext;
    this.ctx = null;
    this.volume = volume;
    this.muted = false;
    this.method = lowPower ? 'ks' : method;
    this._chains = {};
    this._cache = new Map();
    this._voices = new Set();
    this._byString = new Map();
    this.onVoice = null; // optional callback({ instrument, string, fret, midi, when })
  }

  get started() {
    return !!this.ctx;
  }

  /** Make the context. Call from a user gesture (click, key, touch). */
  start() {
    if (!this.ctx) {
      this.ctx = this._create();
      if (!this.ctx) return false;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume();
    return true;
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this._applyGain();
  }
  setMuted(m) {
    this.muted = !!m;
    this._applyGain();
  }
  _applyGain() {
    if (!this.master) return;
    const g = this.muted ? 0 : this.volume, t = this.ctx.currentTime;
    if (this.master.gain.setTargetAtTime) this.master.gain.setTargetAtTime(g, t, 0.02);
    else this.master.gain.value = g;
  }

  /** Body filter chain per instrument: input gain -> peaking bank -> master. */
  chain(key) {
    if (this._chains[key]) return this._chains[key];
    const input = this.ctx.createGain();
    let node = input;
    for (const m of BODY_MODES[key] || []) {
      const bq = this.ctx.createBiquadFilter();
      bq.type = 'peaking';
      bq.frequency.value = m.f;
      bq.Q.value = m.q;
      bq.gain.value = m.gainDb;
      node.connect(bq);
      node = bq;
    }
    const out = this.ctx.createGain();
    out.gain.value = 0.5; // the peaks add about +8 dB
    node.connect(out);
    out.connect(this.master);
    this._chains[key] = { input, out };
    return this._chains[key];
  }

  /** Mono buffer for one string at one fret (cached). */
  buffer(instKey, string, fret, { method = this.method, pos } = {}) {
    const inst = INSTRUMENTS[instKey];
    const p = pos ?? inst.pluckPos;
    const id = `${instKey}|${string}|${fret}|${method}|${p.toFixed(3)}`;
    let b = this._cache.get(id);
    if (b) return b;
    const fs = this.ctx.sampleRate;
    const params = stringParams(inst, string, fret);
    let data;
    const seconds = inst.bowed ? 1.6 : 2.6;
    if (method === 'ks') {
      const f = midiToFreq(inst.tuning[string] + fret);
      data = renderKS(f, { seconds, fs, decay: inst.key === 'classical' ? 0.993 : 0.996, brightness: inst.key === 'steel' ? 0.6 : 0.35 });
    } else if (method === 'sim') {
      data = inst.bowed
        ? renderSim(params, { seconds, fs, bow: { pos: inst.bowPos, vel: 0.15, force: 0.5 }, bowSeconds: seconds * 0.75 })
        : renderSim(params, { seconds, fs, pos: p });
    } else {
      data = renderModal(params, { seconds, fs, pos: p });
    }
    b = this.ctx.createBuffer(1, data.length, fs);
    if (b.copyToChannel) b.copyToChannel(data, 0);
    else b.getChannelData(0).set(data);
    if (this._cache.size > 400) this._cache.clear();
    this._cache.set(id, b);
    return b;
  }

  /**
   * One note. A string rings one note at a time: a new note on the same
   * string fades the old one. duration (s) is optional (null = let it ring).
   */
  playNote({ instrument = 'steel', string = 0, fret = 0, velocity = 0.8, when = 0, duration = null, method, pos } = {}) {
    if (!this.ctx && !this.start()) return null;
    const ctx = this.ctx;
    const t = Math.max(ctx.currentTime, when || ctx.currentTime);
    const key = `${instrument}|${string}`;
    const old = this._byString.get(key);
    if (old) this._release(old, t, 0.03);
    const src = ctx.createBufferSource();
    src.buffer = this.buffer(instrument, string, fret, { method, pos });
    const g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, velocity));
    src.connect(g);
    g.connect(this.chain(instrument).input);
    src.start(t);
    const v = { src, g, key, end: t + src.buffer.duration };
    this._voices.add(v);
    this._byString.set(key, v);
    src.onended = () => {
      this._voices.delete(v);
      if (this._byString.get(key) === v) this._byString.delete(key);
      try { g.disconnect(); } catch (_) { /* already gone */ }
    };
    if (duration != null) this._release(v, t + duration, 0.06);
    const inst = INSTRUMENTS[instrument];
    if (this.onVoice) this.onVoice({ instrument, string, fret, midi: inst.tuning[string] + fret, when: t });
    return v;
  }

  /** A chord: frets per string (low to high, -1 = muted), strummed. */
  playChord({ instrument = 'steel', frets, direction = 'down', spreadMs = 35, velocity = 0.7, when = 0, duration = null, method } = {}) {
    if (!this.ctx && !this.start()) return [];
    const t0 = Math.max(this.ctx.currentTime, when || this.ctx.currentTime);
    const offs = strumOffsets(frets.length, { direction, spreadMs });
    const out = [];
    frets.forEach((f, i) => {
      if (f == null || f < 0) return;
      // the first-hit string is loudest; a strum loses a little energy
      const order = direction === 'up' ? frets.length - 1 - i : i;
      const vel = velocity * (1 - 0.04 * order);
      out.push(this.playNote({ instrument, string: i, fret: f, velocity: vel, when: t0 + offs[i], duration, method }));
    });
    return out;
  }

  _release(v, t, tau) {
    try {
      const g = v.g.gain;
      if (g.cancelScheduledValues) g.cancelScheduledValues(t);
      if (g.setTargetAtTime) g.setTargetAtTime(0, t, tau);
      v.src.stop(t + tau * 8);
    } catch (_) { /* source already stopped */ }
  }

  /** Mute the strings of one instrument (palm mute, stop button). */
  damp(instrument) {
    const t = this.now();
    for (const v of this._voices) if (v.key.startsWith(instrument + '|')) this._release(v, t, 0.02);
  }

  /** Stop all sound now. */
  stopAll() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this._voices) this._release(v, t, 0.01);
    this._voices.clear();
    this._byString.clear();
  }

  get activeVoices() {
    return this._voices.size;
  }

  /** Stop all sound and suspend the context when the page hides. */
  bindPagehide(win) {
    const h = () => {
      this.stopAll();
      if (this.ctx && this.ctx.suspend) this.ctx.suspend();
    };
    win.addEventListener('pagehide', h);
    return () => win.removeEventListener('pagehide', h);
  }
}

// ── node stub ───────────────────────────────────────────────────────────────

/** A minimal AudioContext stand-in for node tests. Records nodes and links. */
export function createStubContext({ sampleRate = 44100 } = {}) {
  const log = { nodes: [], connections: [], started: [], stopped: [] };
  const param = (v = 0) => ({
    value: v,
    events: [],
    setValueAtTime(x, t) { this.events.push(['set', x, t]); this.value = x; },
    setTargetAtTime(x, t, tau) { this.events.push(['target', x, t, tau]); this.value = x; },
    linearRampToValueAtTime(x, t) { this.events.push(['ramp', x, t]); this.value = x; },
    cancelScheduledValues(t) { this.events.push(['cancel', t]); },
  });
  const node = (kind, extra = {}) => {
    const n = {
      kind, ...extra,
      connect(d) { log.connections.push([n, d]); return d; },
      disconnect() { n.disconnected = true; },
    };
    log.nodes.push(n);
    return n;
  };
  const ctx = {
    sampleRate, currentTime: 0, state: 'running', log,
    destination: node('destination'),
    createGain: () => node('gain', { gain: param(1) }),
    createBiquadFilter: () => node('biquad', { frequency: param(350), Q: param(1), gain: param(0), type: 'lowpass' }),
    createBuffer: (ch, len, sr) => {
      const data = [...Array(ch)].map(() => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => data[i], copyToChannel: (a, i) => data[i].set(a) };
    },
    createBufferSource: () => {
      const n = node('source', {
        buffer: null,
        start(t) { log.started.push([n, t]); },
        stop(t) { log.stopped.push([n, t]); },
      });
      return n;
    },
    resume() { ctx.state = 'running'; return Promise.resolve(); },
    suspend() { ctx.state = 'suspended'; return Promise.resolve(); },
    close() { ctx.state = 'closed'; return Promise.resolve(); },
  };
  return ctx;
}

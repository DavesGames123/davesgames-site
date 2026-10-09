// ============================================================================
//  SLOW-SCAN TELEVISION  ·  page wiring  (ES module)
// ----------------------------------------------------------------------------
//  Binds each <figure data-scene> to a scene from figures.js, routes the
//  controls of its card, runs one requestAnimationFrame loop for the
//  figures in view, builds the mode table, and runs the receiver (#s8).
//
//  LIFE OF A FIGURE
//    1. An IntersectionObserver (300 px margin) sees the figure. main.js
//       makes the scene the first time.
//    2. While the figure is on screen, the loop calls step(dt), render().
//    3. Off screen, the scene keeps its state and gets no time.
//  The loop stops while the saver runs (window.__sstvSaver) or the tab is
//  hidden.
//
//  CONTROLS (markup in index.html), scoped to the card of the figure
//    <div class="seg" data-set="key"><button data-v="value">  one of many
//    <input type="range" data-set="key">                      a number
//    <button class="tgl" data-set="key">                      on or off
//    <output data-out="key">                                  a readout
//
//  RECEIVER (class Finale). A Session (session.js) per transmission: the
//  picture is encoded to audio, noise is added, and the decoder is fed
//  up to the play head each frame. WebAudio starts only from a click on
//  Play, at volume 0.15. Above 4x the audio is muted. A microphone or an
//  audio file feeds the same decoder (the mode comes from the VIS).
//  pagehide stops the audio, the microphone and the camera, closes the
//  AudioContext and stops the loop.
//
//  GREP MAP
//    grep -n 'const MAKERS'        scene for each data-scene name
//    grep -n 'function mount'      size, pointer and controls of a figure
//    grep -n 'function loop'       the one animation loop
//    grep -n 'function modeTable'  the table of every mode
//    grep -n 'class Finale'        the receiver
//    grep -n 'class Decim'         low-pass and decimate to about 11 kHz
//    grep -n 'class LiveRx'        microphone receiver
//    grep -n 'function cleanup'    pagehide
// ============================================================================
import { ToneScene, VisScene, LineScene, DemodScene, SlantScene, NoiseScene, HeroScene } from './figures.js';
import { MODES, byId, orderText, totalMs, fmtTime } from './modes.js';
import { Receiver, wavBytes } from './codec.js';
import { cardFor } from './images.js';
import { CRT } from './crt.js';
import { Session, beamAt } from './session.js';
import { Waterfall, drawScope, PAL } from './view.js';
import { typesetAll } from '../../lib/sci-math.js';
import './saver.js';

const MAKERS = {
  hero: () => new HeroScene(), tone: () => new ToneScene(), vis: () => new VisScene(), line: () => new LineScene(),
  demod: () => new DemodScene(), slant: () => new SlantScene(), noise: () => new NoiseScene(),
};
const FS = 11025;
const $ = (s) => document.querySelector(s);
const DPR = () => Math.min(2, window.devicePixelRatio || 1);
const figs = [];
let audio = null; // { ctx, gain }

function getAudio() {
  if (audio) return audio;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC(), gain = ctx.createGain();
  gain.gain.value = 0; gain.connect(ctx.destination);
  audio = { ctx, gain };
  return audio;
}

// ---------------------------------------------------------------- figures
const FMT = {
  tone: (v) => `${Math.round(v)} Hz`, snr: (v) => `${v} dB`, clock: (v) => `${v > 0 ? '+' : ''}${(+v).toFixed(2)} %`,
  fade: (v) => `${Math.round(v * 100)} %`, shift: (v) => `${v > 0 ? '+' : ''}${v} Hz`, drift: (v) => `${v} Hz`,
};
function mount(el) {
  const F = { el, name: el.dataset.scene, scene: null, cv: el.querySelector('canvas'), on: false, w: 0, h: 0 };
  F.g = F.cv.getContext('2d');
  figs.push(F);
  const pos = (e) => { const r = F.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const send = (type, e) => {
    if (!F.scene || !F.scene.pointer) return;
    const p = pos(e), used = F.scene.pointer({ type, x: p.x, y: p.y, buttons: type === 'down' ? 1 : e.buttons });
    if (used && type === 'down' && F.cv.setPointerCapture) { try { F.cv.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } }
  };
  F.cv.addEventListener('pointerdown', (e) => send('down', e));
  F.cv.addEventListener('pointermove', (e) => send('move', e));
  F.cv.addEventListener('pointerup', (e) => send('up', e));
  F.cv.addEventListener('pointercancel', (e) => send('up', e));
  // controls of the same card
  const box = el.closest('.card') || el.parentElement;
  F.box = box;
  const set = (k, v) => { if (F.scene) F.scene.set(k, v); F.pending = F.pending || {}; F.pending[k] = v; const o = box.querySelector(`output[data-out="${k}"]`); if (o && FMT[k]) o.textContent = FMT[k](v); };
  for (const s of box.querySelectorAll('.seg[data-set]')) {
    s.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      for (const x of s.querySelectorAll('button')) x.classList.toggle('on', x === b);
      set(s.dataset.set, b.dataset.v);
    });
  }
  for (const r of box.querySelectorAll('input[type=range][data-set]')) r.addEventListener('input', () => set(r.dataset.set, +r.value));
  for (const b of box.querySelectorAll('button.tgl[data-set]')) {
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', on); b.classList.toggle('on', on);
      set(b.dataset.set, on);
    });
  }
  return F;
}
function size(F) {
  const w = Math.round(F.cv.clientWidth || F.el.clientWidth);
  if (!w || !F.scene) return;
  const h = F.scene.height(w), dpr = DPR();
  if (w !== F.w || h !== F.h || F.cv.width !== Math.round(w * dpr)) {
    F.w = w; F.h = h; F.cv.style.height = `${h}px`;
    F.cv.width = Math.round(w * dpr); F.cv.height = Math.round(h * dpr);
  }
}
function make(F) {
  try {
    F.scene = MAKERS[F.name]();
    if (F.pending) for (const [k, v] of Object.entries(F.pending)) F.scene.set(k, v);
  } catch (e) { console.error('sstv figure', F.name, e); F.err = true; }
}
function draw(F) {
  if (!F.scene) return;
  size(F);
  const dpr = DPR();
  F.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  F.scene.dpr = dpr;
  try { F.scene.render(F.g, F.w, F.h); } catch (e) { if (!F.err) console.error('sstv render', F.name, e); F.err = true; }
}

// ---------------------------------------------------------------- loop
let last = 0, raf = 0;
function loop(now) {
  raf = requestAnimationFrame(loop);
  if (window.__sstvSaver || document.hidden) { last = now; return; }
  const dt = Math.min(0.1, last ? (now - last) / 1000 : 0.016); last = now;
  for (const F of figs) {
    if (!F.on) continue;
    if (!F.scene && !F.err) make(F);
    if (!F.scene) continue;
    try { F.scene.step(dt); } catch (e) { if (!F.err) console.error('sstv step', F.name, e); F.err = true; }
    draw(F);
  }
  if (toneOsc && toneFig && toneFig.scene) toneOsc.frequency.setTargetAtTime(toneFig.scene.shown || toneFig.scene.f, audio.ctx.currentTime, 0.01);
  if (fin) fin.frame(now);
}

// ---------------------------------------------------------------- tone audio
let toneOsc = null, toneFig = null;
function initTone() {
  const b = $('#toneAudio'); if (!b) return;
  toneFig = figs.find(F => F.name === 'tone');
  b.addEventListener('click', () => {
    const A = getAudio(); if (!A) return;
    if (toneOsc) { try { toneOsc.stop(); } catch (e) { /* ok */ } toneOsc.disconnect(); toneOsc = null; b.setAttribute('aria-pressed', 'false'); b.classList.remove('on'); return; }
    A.ctx.resume();
    if (fin) fin.pause();
    toneOsc = A.ctx.createOscillator(); toneOsc.type = 'sine';
    const g = A.ctx.createGain(); g.gain.value = 0.06; toneOsc.connect(g); g.connect(A.ctx.destination);
    toneOsc.frequency.value = toneFig && toneFig.scene ? toneFig.scene.f : 1900;
    toneOsc.start(); b.setAttribute('aria-pressed', 'true'); b.classList.add('on');
  });
}
function stopTone() { if (toneOsc) { try { toneOsc.stop(); } catch (e) { /* ok */ } toneOsc = null; const b = $('#toneAudio'); if (b) { b.setAttribute('aria-pressed', 'false'); b.classList.remove('on'); } } }

// ---------------------------------------------------------------- table
function modeTable() {
  const tb = $('#modeTable tbody'); if (!tb) return;
  let fam = '';
  const rows = [];
  for (const m of MODES) {
    if (m.family !== fam) { fam = m.family; rows.push(`<tr class="fam"><td colspan="6">${fam} · ${m.author}</td></tr>`); }
    rows.push(`<tr><td>${m.name}</td><td class="num">${m.vis}</td><td class="num">${m.W}×${m.H}</td><td class="num">${m.lineMs.toFixed(3)}${m.rows === 2 ? ' /2 rows' : ''}</td><td>${orderText(m)}</td><td class="num">${fmtTime(totalMs(m))}</td></tr>`);
  }
  tb.innerHTML = rows.join('');
}

// ---------------------------------------------------------------- chips
function initChips() {
  const links = [...document.querySelectorAll('#chips a')];
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) for (const a of links) a.classList.toggle('on', a.dataset.target === e.target.id);
  }, { rootMargin: '-40% 0px -55% 0px' });
  for (const a of links) { const s = document.getElementById(a.dataset.target); if (s) io.observe(s); }
}

// ---------------------------------------------------------------- decimation
// Low-pass (windowed sinc) and keep every D-th sample, so a 44.1 or 48 kHz
// source reaches the decoder at about 11 kHz.
class Decim {
  constructor(sr) {
    this.D = Math.max(1, Math.round(sr / FS)); this.fs = sr / this.D;
    const N = 31, fc = 0.42 / this.D; this.h = new Float32Array(N); let s = 0;
    for (let i = 0; i < N; i++) { const x = i - (N - 1) / 2; this.h[i] = (x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x)) * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (N - 1))); s += this.h[i]; }
    for (let i = 0; i < N; i++) this.h[i] /= s;
    this.buf = new Float32Array(2 * N); this.pos = 0; this.ph = 0; this.N = N;
  }
  run(x) {
    if (this.D === 1) return Float32Array.from(x);
    const out = new Float32Array(Math.ceil(x.length / this.D) + 1); let k = 0;
    const { h, N, buf } = this;
    for (let i = 0; i < x.length; i++) {
      buf[this.pos] = buf[this.pos + N] = x[i]; this.pos = (this.pos + 1) % N;
      if (++this.ph >= this.D) { this.ph = 0; let s = 0; for (let j = 0; j < N; j++) s += h[j] * buf[this.pos + j]; out[k++] = s; }
    }
    return out.subarray(0, k);
  }
}

// ---------------------------------------------------------------- live receiver
// Microphone: a Receiver fed in chunks, with a 3 s ring for the waterfall
// and scope. After a picture, or 40 s with no VIS, it starts over, so
// memory stays bounded.
class LiveRx {
  constructor(fs, crt, onVis) {
    this.fs = fs; this.crt = crt; this.onVis = onVis; this.ring = new Float32Array(Math.round(fs * 3)); this.n = 0; this.wall = 0;
    this.fresh();
  }
  fresh() {
    this.rx = new Receiver({ fs: this.fs, mode: null,
      onVis: (v) => { if (v.mode && this.rx.mode) { this.crt.setPicture(this.rx.mode.W, this.rx.mode.H, this.rx.mode.aspect); if (this.onVis) this.onVis(v); } },
      onLine: (k, rows) => this.crt.paintRows(this.rx.img, rows, this.wall),
      onDone: (R) => { if (R.img) this.crt.paintAll(R.img); this.doneAt = this.rx.raw; },
    });
    this.doneAt = null;
  }
  push(x, wall) {
    this.wall = wall;
    for (let i = 0; i < x.length; i++) this.ring[(this.n + i) % this.ring.length] = x[i];
    this.n += x.length;
    this.rx.push(x);
    if (this.rx.state === 'vis' && this.rx.n > this.fs * 40) this.fresh();
    if (this.rx.state === 'done' && this.rx.raw - this.doneAt > this.fs * 1) this.fresh();
  }
  // contiguous copy of the last n samples (for the scope and waterfall)
  tail(n) { const out = new Float32Array(n), L = this.ring.length; for (let i = 0; i < n; i++) { const j = this.n - n + i; out[i] = j >= 0 ? this.ring[((j % L) + L) % L] : 0; } return out; }
}

// ---------------------------------------------------------------- receiver
class Finale {
  constructor() {
    this.cv = $('#rxCv'); this.g = this.cv.getContext('2d'); this.side = $('#rxSide'); this.sg = this.side.getContext('2d');
    this.crt = new CRT(); this.wf = new Waterfall(FS, { N: 512, rows: 300, cols: 200, f0: 1000, f1: 2500 });
    this.mode = 'r36'; this.cardId = 'planet'; this.custom = null; this.snr = Infinity; this.clock = 0; this.slant = true;
    this.speed = 1; this.muted = false; this.vol = 0.15; this.playing = false; this.t = 0; this.kind = 'tx'; this.visible = false; this.hop = 0;
    this.T = 0;
    this.bind();
    this.build();
    new IntersectionObserver((e) => { this.visible = e[0].isIntersecting; }, { rootMargin: '200px' }).observe(this.cv);
  }
  msg(s) { const m = $('#rxMsg'); if (m) m.textContent = s; }
  bind() {
    const sel = $('#rxMode');
    sel.innerHTML = MODES.map(m => `<option value="${m.id}"${m.id === this.mode ? ' selected' : ''}>${m.name} · ${m.W}×${m.H} · ${fmtTime(totalMs(m))}</option>`).join('');
    sel.addEventListener('change', () => { this.mode = sel.value; this.reset(); });
    const seg = (id, fn) => $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; for (const x of $(id).querySelectorAll('button')) x.classList.toggle('on', x === b); fn(b.dataset.v); });
    seg('#rxCard', (v) => { this.cardId = v; this.custom = null; this.reset(); });
    seg('#rxPh', (v) => this.crt.setPhosphor(v));
    seg('#rxSpeed', (v) => { const was = this.playing; if (was) this.pause(); this.speed = +v; if (was) this.play(); });
    $('#rxPlay').addEventListener('click', () => (this.playing ? this.pause() : this.play()));
    $('#rxMute').addEventListener('click', () => { this.muted = !this.muted; const b = $('#rxMute'); b.setAttribute('aria-pressed', this.muted); b.classList.toggle('on', this.muted); b.textContent = this.muted ? 'Muted' : 'Sound on'; this.applyGain(); });
    $('#rxVol').addEventListener('input', (e) => { this.vol = +e.target.value; this.applyGain(); });
    $('#rxSnr').addEventListener('input', (e) => { const v = +e.target.value; this.snr = v > 40 ? Infinity : v; $('#rxSnrO').textContent = v > 40 ? 'clean' : `${v} dB`; this.reset(); });
    $('#rxClock').addEventListener('input', (e) => { this.clock = +e.target.value; $('#rxClockO').textContent = FMT.clock(this.clock); this.reset(); });
    $('#rxSlant').addEventListener('click', () => { this.slant = !this.slant; const b = $('#rxSlant'); b.setAttribute('aria-pressed', this.slant); b.classList.toggle('on', this.slant); this.reset(); });
    $('#rxFile').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) this.loadImage(f); e.target.value = ''; });
    $('#rxCam').addEventListener('click', () => this.camera());
    $('#rxWav').addEventListener('click', () => this.saveWav());
    $('#rxPng').addEventListener('click', () => this.savePng());
    $('#rxAudio').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) this.loadAudio(f); e.target.value = ''; });
    $('#rxMic').addEventListener('click', () => (this.kind === 'mic' ? this.stopMic() : this.startMic()));
  }
  source(m) {
    if (!this.custom) return cardFor(this.cardId, m);
    const c = document.createElement('canvas'); c.width = m.W; c.height = m.H;
    const g = c.getContext('2d'), s = this.custom, sa = s.width / s.height, da = m.aspect;
    let sw = s.width, sh = s.height, sx = 0, sy = 0;
    if (sa > da) { sw = s.height * da; sx = (s.width - sw) / 2; } else { sh = s.width / da; sy = (s.height - sh) / 2; }
    g.imageSmoothingQuality = 'high'; g.drawImage(s, sx, sy, sw, sh, 0, 0, m.W, m.H);
    return { w: m.W, h: m.H, data: g.getImageData(0, 0, m.W, m.H).data };
  }
  build() {
    const m = byId(this.mode);
    this.sess = new Session({ mode: m, img: this.source(m), fs: FS, snr: this.snr, clock: this.clock / 100, slant: this.slant, crt: this.crt, seed: (Math.random() * 1e9) | 0 });
    this.t = 0; this.audioBuf = null; this.wf.clear(); this.kind = 'tx';
    this.readouts(true);
  }
  reset() { if (this.kind === 'mic') this.stopMic(); this.pause(); this.build(); this.msg('Ready. Press Play to send the picture.'); }
  applyGain() { if (audio) audio.gain.gain.setTargetAtTime(this.muted || this.speed > 4 ? 0 : this.vol, audio.ctx.currentTime, 0.02); }
  makeBuffer() {
    if (this.audioBuf) return this.audioBuf;
    const A = audio, x = this.sess.x, fs = this.sess.fs;
    try { const b = A.ctx.createBuffer(1, x.length, fs); b.copyToChannel ? b.copyToChannel(x, 0) : b.getChannelData(0).set(x); this.audioBuf = b; }
    catch (e) {
      const sr = A.ctx.sampleRate, r = sr / fs, n = Math.floor(x.length * r), b = A.ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) { const p = i / r, j = Math.floor(p), u = p - j; d[i] = (x[j] || 0) * (1 - u) + (x[j + 1] || 0) * u; }
      this.audioBuf = b;
    }
    return this.audioBuf;
  }
  play() {
    if (this.kind === 'mic') return;
    if (this.sess.done || this.t >= this.sess.dur - 0.01) { if (this.kind === 'file') { this.rebuildFile(); } else this.build(); }
    stopTone();
    const A = getAudio();
    if (A) { A.ctx.resume(); this.applyGain(); }
    this.t0 = this.t; this.wall0 = performance.now(); this.playing = true;
    if (A && this.speed <= 4) {
      const src = A.ctx.createBufferSource(); src.buffer = this.makeBuffer(); src.playbackRate.value = this.speed;
      src.connect(A.gain); src.start(0, this.t); this.src = src;
    }
    const b = $('#rxPlay'); b.textContent = 'Pause'; b.classList.add('on'); b.setAttribute('aria-label', 'Pause');
    this.msg(this.speed > 4 ? `Receiving at ${this.speed}×, audio muted above 4×.` : `Receiving at ${this.speed}× real time.`);
  }
  pause() {
    if (this.playing) this.t = Math.min(this.sess.dur, this.t0 + (performance.now() - this.wall0) / 1000 * this.speed);
    this.playing = false;
    if (this.src) { try { this.src.stop(); } catch (e) { /* ok */ } this.src.disconnect(); this.src = null; }
    const b = $('#rxPlay'); b.textContent = 'Play'; b.classList.remove('on'); b.setAttribute('aria-label', 'Play');
  }
  frame(now) {
    if (!this.visible) return;
    const dt = Math.min(0.1, this.lastNow ? (now - this.lastNow) / 1000 : 0.016); this.lastNow = now; this.T += dt;
    let sig, at;
    if (this.kind === 'mic') {
      const L = this.live; sig = L ? L.tail(Math.round(L.fs * 0.6)) : new Float32Array(1); at = sig.length;
      if (L) { this.hop += dt; let k = 0; while (this.hop > 0.025 && k++ < 4) { this.hop -= 0.025; this.wf.add(sig, sig.length - Math.round(this.hop * L.fs)); } }
    } else {
      if (this.playing) {
        this.t = this.t0 + (now - this.wall0) / 1000 * this.speed;
        if (this.t >= this.sess.dur) { this.t = this.sess.dur; this.sess.advance(this.t, this.T); this.pause(); this.msg('Picture received. Download the PNG, or press Play to send it again.'); }
        else this.sess.advance(this.t, this.T);
        this.hop += dt * this.speed;
        let k = 0;
        while (this.hop > 0.025 && k++ < 8) { this.hop -= 0.025; this.wf.add(this.sess.x, Math.round((this.t - this.hop) * this.sess.fs)); }
        if (this.hop > 0.2) this.hop = 0;
      }
      sig = this.sess.x; at = Math.round(this.t * this.sess.fs);
    }
    this.renderCrt(); this.renderSide(sig, at);
    if (((this.T * 10) | 0) !== this.lastRead) { this.lastRead = (this.T * 10) | 0; this.readouts(); }
  }
  renderCrt() {
    const w = this.cv.clientWidth, narrow = w < 640, h = narrow ? Math.round(w * 0.98) : Math.round(Math.min(620, Math.max(360, w * 0.78)));
    const dpr = DPR();
    if (this.cv.width !== Math.round(w * dpr) || this.cv.height !== Math.round(h * dpr)) { this.cv.style.height = `${h}px`; this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr); }
    // The side canvas gets an explicit CSS height: a canvas with only a
    // flex size takes its height from its pixel buffer and grows each frame.
    const rd = $('#rxRead'), sh = narrow ? 240 : Math.max(220, h - (rd ? rd.offsetHeight : 90) - 10);
    if (this.sideH !== sh) { this.sideH = sh; this.side.style.height = `${sh}px`; }
    const g = this.g; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    let beam = null, snow = 0.25, read = ['', ''], led = false;
    if (this.kind === 'mic') {
      const L = this.live, R = L && L.rx;
      if (R && R.mode && R.state !== 'vis') { beam = beamAt(R.mode, R, R.n, null); read = [R.mode.name, R.state === 'done' ? 'done' : `line ${R.k}/${R.mode.lines}`]; snow = 0; led = true; }
      else { read = ['listening', 'waiting for VIS']; snow = 0.7; led = (this.T * 2 | 0) % 2 === 0; }
    } else {
      const s = this.sess, st = s.status(), m = s.m;
      if (st.phase === 'image' && this.playing) beam = s.beam();
      snow = st.phase === 'idle' || st.phase === 'vis' ? (this.playing ? 0.6 : 0.2) : 0;
      read = [m ? m.name : 'unknown mode', st.phase === 'done' ? 'received' : st.phase === 'image' ? `line ${st.line}/${m.lines}` : this.playing ? 'VIS…' : 'ready'];
      led = this.playing;
    }
    if (beam && beam.x == null) beam = null;
    this.crt.render(g, { box: { x: 0, y: 0, w, h }, dpr, t: this.T, beam, snow, readout: read, led, knob: this.vol });
  }
  renderSide(sig, at) {
    const c = this.side, w = c.clientWidth, h = c.clientHeight, dpr = DPR();
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = this.sg; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#030507'; g.fillRect(0, 0, w, h);
    const sh = Math.max(60, h * 0.24), wh = h - sh - 46;
    g.font = '400 11px Inter, system-ui, sans-serif'; g.fillStyle = PAL.dim; g.textAlign = 'left';
    g.fillText('waterfall', 8, 14);
    this.wf.draw(g, 8, 20, w - 16, wh - 26, { font: 9 });
    g.fillStyle = PAL.dim; g.textAlign = 'left'; g.fillText('oscilloscope · 8 ms', 8, wh + 22);
    drawScope(g, 8, wh + 28, w - 16, sh, sig, at, Math.round((this.kind === 'mic' && this.live ? this.live.fs : FS) * 0.008));
  }
  readouts(force) {
    const set = (id, s) => { const e = document.getElementById(id); if (e && e.textContent !== s) e.textContent = s; };
    if (this.kind === 'mic') {
      const R = this.live && this.live.rx;
      set('rdMode', R && R.mode ? R.mode.name : 'listening'); set('rdLine', R && R.mode ? `${R.k} / ${R.mode.lines}` : '–');
      set('rdTime', this.live ? `${(this.live.n / this.live.fs).toFixed(0)} s` : '–'); set('rdFit', R && R.fit && R.mode ? `${(R.clockError() * 100).toFixed(3)} %` : '–');
      return;
    }
    const s = this.sess, m = s.m, st = s.status();
    set('rdMode', m ? `${m.name}${s.visInfo && s.visInfo.mode ? ` · VIS ${s.visInfo.code}` : ''}` : 'no VIS yet');
    set('rdLine', st.phase === 'image' || st.phase === 'done' ? `${Math.min(st.line, m.lines)} / ${m.lines}` : '–');
    set('rdTime', `${this.t.toFixed(1)} / ${s.dur.toFixed(1)} s`);
    set('rdFit', st.clock != null ? `${st.clock >= 0 ? '+' : ''}${(st.clock * 100).toFixed(3)} %` : '–');
  }
  async loadImage(file) {
    try {
      const bmp = await createImageBitmap(file);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
      this.custom = c; for (const x of document.querySelectorAll('#rxCard button')) x.classList.remove('on');
      this.reset(); this.msg(`Your picture, ${bmp.width}×${bmp.height}, cropped to ${byId(this.mode).W}×${byId(this.mode).H}. Press Play.`);
    } catch (e) { this.msg('That file could not be read as a picture.'); }
  }
  async camera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.msg('No camera access in this browser. Use Upload instead.'); return; }
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } });
      this.camStream = st;
      const v = $('#rxVideo'); v.srcObject = st; await v.play();
      await new Promise(r => setTimeout(r, 700));
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
      st.getTracks().forEach(t => t.stop()); v.srcObject = null; this.camStream = null;
      this.custom = c; for (const x of document.querySelectorAll('#rxCard button')) x.classList.remove('on');
      this.reset(); this.msg('Camera picture taken. Press Play to send it.');
    } catch (e) { this.msg('The camera did not start (no permission or no camera).'); }
  }
  download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  saveWav() {
    if (this.kind === 'mic') { this.msg('Stop listening first: the WAV is the transmission of the picture.'); return; }
    const m = this.sess.m;
    this.download(new Blob([wavBytes(this.sess.x, Math.round(this.sess.fs))], { type: 'audio/wav' }), `sstv-${m ? m.id : 'file'}.wav`);
  }
  savePng() {
    const R = this.kind === 'mic' ? this.live && this.live.rx : this.sess.rx;
    if (!R || !R.img) { this.msg('Nothing received yet.'); return; }
    const m = R.mode, c = document.createElement('canvas'); c.width = m.W; c.height = m.H;
    const g = c.getContext('2d'), d = g.createImageData(m.W, m.H); d.data.set(R.img); g.putImageData(d, 0, 0);
    c.toBlob((b) => b && this.download(b, `sstv-received-${m.id}.png`), 'image/png');
  }
  async loadAudio(file) {
    const A = getAudio(); if (!A) { this.msg('No WebAudio in this browser.'); return; }
    if (this.kind === 'mic') this.stopMic();
    this.pause();
    try {
      const ab = await A.ctx.decodeAudioData(await file.arrayBuffer());
      const n = ab.length, mix = new Float32Array(n);
      for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) mix[i] += d[i] / ab.numberOfChannels; }
      const D = new Decim(ab.sampleRate), x = D.run(mix);
      this.fileSrc = { x, fs: D.fs, ab };
      this.rebuildFile();
      this.msg(`Loaded ${file.name}, ${(n / ab.sampleRate).toFixed(1)} s. Press Play: the mode comes from the VIS header.`);
    } catch (e) { this.msg('That file could not be decoded as audio.'); }
  }
  rebuildFile() {
    const F = this.fileSrc;
    this.crt.clearPicture();
    this.sess = new Session({ samples: F.x, fs: F.fs, mode: null, slant: this.slant, crt: this.crt, onNoVis: () => this.msg('No VIS header found in this file.') });
    this.audioBuf = F.ab; this.t = 0; this.wf.clear(); this.kind = 'file';
  }
  async startMic() {
    const A = getAudio();
    if (!A || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.msg('No microphone access in this browser.'); return; }
    this.pause(); stopTone();
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      A.ctx.resume();
      this.micStream = st;
      const src = A.ctx.createMediaStreamSource(st), proc = A.ctx.createScriptProcessor(4096, 1, 1), D = new Decim(A.ctx.sampleRate);
      const mute = A.ctx.createGain(); mute.gain.value = 0;
      this.live = new LiveRx(D.fs, this.crt, (v) => this.msg(`VIS ${v.code}: ${byId(v.mode).name}. Receiving.`));
      this.crt.clearPicture();
      proc.onaudioprocess = (e) => { if (this.live) this.live.push(D.run(e.inputBuffer.getChannelData(0)), this.T); };
      src.connect(proc); proc.connect(mute); mute.connect(A.ctx.destination);
      this.mic = { src, proc, mute };
      this.kind = 'mic'; this.wf.clear();
      const b = $('#rxMic'); b.setAttribute('aria-pressed', 'true'); b.classList.add('on'); b.textContent = 'Stop listening';
      this.msg('Listening. Play an SSTV signal near the microphone; the picture starts at its VIS header.');
    } catch (e) { this.msg('The microphone did not start (no permission or no device).'); }
  }
  stopMic() {
    if (this.mic) { try { this.mic.src.disconnect(); this.mic.proc.disconnect(); this.mic.mute.disconnect(); } catch (e) { /* ok */ } this.mic.proc.onaudioprocess = null; this.mic = null; }
    if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; }
    const b = $('#rxMic'); if (b) { b.setAttribute('aria-pressed', 'false'); b.classList.remove('on'); b.textContent = 'Listen (microphone)'; }
    if (this.kind === 'mic') { this.kind = 'tx'; this.live = null; this.build(); }
  }
  stopAll() {
    this.pause(); this.stopMic();
    if (this.camStream) { this.camStream.getTracks().forEach(t => t.stop()); this.camStream = null; }
  }
}

// ---------------------------------------------------------------- start
let fin = null;
function cleanup() {
  cancelAnimationFrame(raf); raf = 0;
  stopTone();
  if (fin) fin.stopAll();
  if (audio) { try { audio.ctx.close(); } catch (e) { /* ok */ } audio = null; }
}
function start() {
  for (const el of document.querySelectorAll('figure[data-scene]')) mount(el);
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) { const F = figs.find(f => f.el === e.target); if (F) F.on = e.isIntersecting; }
  }, { rootMargin: '300px 0px' });
  for (const F of figs) io.observe(F.el);
  modeTable(); initChips(); initTone();
  try { fin = new Finale(); } catch (e) { console.error('sstv receiver', e); }
  typesetAll(document, [['f_0', 'm3'], ['f_s', 'm3'], ['Y', 'm5'], ['z', 'm1'], ['P', 'm2'], ['L', 'm4'], ['b_i', 'm6'], ['b_7', 'm6']]);
  window.addEventListener('pagehide', cleanup);
  window.addEventListener('pageshow', (e) => { if (e.persisted && !raf) { raf = requestAnimationFrame(loop); } });
  raf = requestAnimationFrame(loop);
}
start();

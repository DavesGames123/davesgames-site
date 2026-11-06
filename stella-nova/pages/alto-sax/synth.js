// ============================================================================
//  ALTO SAX MECHANISM  ·  synth.js — a small reed-like voice (Web Audio)
// ----------------------------------------------------------------------------
//  createSynth() -> { play(hz, seconds), stop(), get ready }
//  The voice is a sawtooth and a square wave a few cents apart, through a
//  low-pass filter with an envelope, plus a little band-pass noise for
//  breath, and a slow vibrato that starts after the attack. It is a sketch
//  of the sound, not a model of a reed.
//  The AudioContext starts at the first play(), which must come from a user
//  gesture (browser autoplay rule). In node, play() does nothing.
//
//  GREP MAP
//    export function createSynth ... the voice
//    export function envelope ...... the gain envelope times (pure)
// ============================================================================

export function envelope(seconds) {
  const d = Math.max(0.25, Math.min(4, seconds || 1.2));
  return { attack: 0.045, decay: 0.12, sustain: 0.72, release: 0.28, hold: d };
}

export function createSynth() {
  let ctx = null, master = null, last = null;
  function ensure() {
    if (typeof window === 'undefined') return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.2; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function stop() {
    if (!last || !ctx) return;
    const t = ctx.currentTime, v = last; last = null;
    try { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 0.05); for (const o of v.osc) o.stop(t + 0.3); } catch (e) { /* stopped */ }
  }
  function play(hz, seconds = 1.2) {
    const c = ensure(); if (!c || !(hz > 0)) return;
    stop();
    const e = envelope(seconds), t = c.currentTime + 0.01;
    const g = c.createGain(); g.gain.value = 0;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(Math.min(9000, hz * 3), t);
    f.frequency.linearRampToValueAtTime(Math.min(12000, hz * 9), t + e.attack);
    f.frequency.setTargetAtTime(Math.min(9000, hz * 5.5), t + e.attack, 0.15);
    const o1 = c.createOscillator(), o2 = c.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'square';
    o1.frequency.value = hz; o2.frequency.value = hz; o2.detune.value = 4;
    const m2 = c.createGain(); m2.gain.value = 0.35;
    // vibrato
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 5.2; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(hz * 0.0035, t + 0.5);
    lfo.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency);
    // breath noise
    const len = Math.floor(c.sampleRate * 0.5), buf = c.createBuffer(1, len, c.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const nz = c.createBufferSource(); nz.buffer = buf; nz.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.8;
    const ng = c.createGain(); ng.gain.value = 0.05;
    o1.connect(f); o2.connect(m2); m2.connect(f); nz.connect(bp); bp.connect(ng); ng.connect(g);
    f.connect(g); g.connect(master);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + e.attack);
    g.gain.linearRampToValueAtTime(e.sustain, t + e.attack + e.decay);
    g.gain.setValueAtTime(e.sustain, t + e.hold);
    g.gain.linearRampToValueAtTime(0, t + e.hold + e.release);
    const end = t + e.hold + e.release + 0.05, osc = [o1, o2, lfo, nz];
    for (const o of osc) { o.start(t); o.stop(end); }
    last = { g, osc };
  }
  return { play, stop, get ready() { return !!ctx; } };
}

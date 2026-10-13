// ============================================================================
//  BREADBOARD LAB  ·  ui/audio.js — what the bench sounds like
// ----------------------------------------------------------------------------
//  WebAudio, made on the first user gesture (browsers block audio before
//  one). One voice per sounding part: a buzzer or speaker whose frame has
//  vis.freq and vis.amp (CONTRACT 3.8) plays that pitch. An active buzzer
//  is a square wave near its own resonance; a passive buzzer and a speaker
//  follow the drive frequency, so tone(8, 440) is an A. The DMM continuity
//  beep, the click of a relay that changes state and a hiss when a part
//  smokes are short one-shot sounds.
//
//  The sim may run slower than real time; the pitch is the simulated
//  frequency (a slowed-down tone would be below hearing), and the voice is
//  silent while the sim is paused.
//
//  GREP MAP
//    createAudio ........ the export
//    unlock ............. make the AudioContext on a gesture
//    voice / update ..... per-part oscillators from a frame
//    beep / click / hiss  one-shots
//    setMuted / close ... the sound toggle; pagehide
// ============================================================================

export function createAudio() {
  let ctx = null, master = null, muted = false;
  const voices = new Map();         // partId -> { osc, gain, kind }
  const relay = new Map();          // partId -> last on
  let beepV = null;
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.35; master.connect(ctx.destination);
    } catch (e) { ctx = null; }
  }
  function voice(id, kind) {
    let v = voices.get(id);
    if (v) return v;
    const osc = ctx.createOscillator(), gain = ctx.createGain(), lp = ctx.createBiquadFilter();
    osc.type = kind === 'speaker' ? 'triangle' : 'square';
    lp.type = 'lowpass'; lp.frequency.value = kind === 'speaker' ? 6000 : 4500;
    gain.gain.value = 0;
    osc.connect(lp); lp.connect(gain); gain.connect(master);
    osc.start();
    v = { osc, gain, kind };
    voices.set(id, v);
    return v;
  }
  // frame: CONTRACT Frame; kinds: partId -> 'buzzer' | 'speaker' | 'relay'
  function update(frame, kinds, running) {
    if (!ctx || !frame) return;
    const t = ctx.currentTime;
    const live = new Set();
    for (const [id, kind] of kinds) {
      const p = frame.parts && frame.parts[id];
      const vis = p && p.vis;
      if (kind === 'relay') {
        const on = !!(vis && vis.on);
        if (relay.has(id) && relay.get(id) !== on) click();
        relay.set(id, on);
        continue;
      }
      if (!vis || !running || p.damaged) continue;
      const f = vis.freq || 0, a = Math.max(0, Math.min(1, vis.amp || 0));
      if (f < 20 || f > 20000 || a < 0.02) continue;
      const v = voice(id, kind);
      v.osc.frequency.setTargetAtTime(f, t, 0.01);
      v.gain.gain.setTargetAtTime(a * (kind === 'speaker' ? 0.5 : 0.22), t, 0.01);
      live.add(id);
    }
    for (const [id, v] of voices) if (!live.has(id)) v.gain.gain.setTargetAtTime(0, t, 0.02);
  }
  function beep(on) {
    if (!ctx) return;
    if (on && !beepV) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 2730; g.gain.value = 0.12;
      o.connect(g); g.connect(master); o.start();
      beepV = { o, g };
    } else if (!on && beepV) { try { beepV.o.stop(); } catch (e) { /* ignore */ } beepV = null; }
  }
  function noise(dur, filterHz, level) {
    if (!ctx) return;
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = filterHz; f.Q.value = 0.8; g.gain.value = level;
    src.connect(f); f.connect(g); g.connect(master); src.start();
  }
  const click = () => noise(0.012, 3200, 0.9);
  const hiss = () => noise(0.7, 1800, 0.35);
  return {
    unlock, update, beep, click, hiss,
    get ready() { return !!ctx; },
    setMuted(m) { muted = !!m; if (master) master.gain.value = muted ? 0 : 0.35; },
    get muted() { return muted; },
    silence() { if (!ctx) return; for (const v of voices.values()) v.gain.gain.value = 0; beep(false); },
    close() {
      for (const v of voices.values()) { try { v.osc.stop(); } catch (e) { /* ignore */ } }
      voices.clear(); beep(false);
      if (ctx) { try { ctx.close(); } catch (e) { /* ignore */ } }
      ctx = null;
    }
  };
}

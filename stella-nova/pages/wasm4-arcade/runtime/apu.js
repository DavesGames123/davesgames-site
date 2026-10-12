// ============================================================================
//  WASM-4 ARCADE  ·  runtime/apu.js — Web Audio side of the sound chip
// ----------------------------------------------------------------------------
//  After runtimes/web/src/apu.ts of WASM-4 (ISC, see runtime/LICENSE.txt).
//  The page makes one APU, and it makes no AudioContext until unlock() runs
//  inside a user gesture (a tap, a key, a click), so the browser never
//  blocks audio and the page never plays sound on its own.
//
//    tone(...)   forwards a cart's tone() call to the worklet (or drops it
//                while audio is locked or muted)
//    tick()      one 60 Hz frame, for the note envelopes
//    unlock()    make or resume the AudioContext (call from a gesture)
//    pause()     suspend it (page hidden, saver)
//    setMuted(b) gain 0 or 1
//
//  The worklet is apu-worklet.js. When audioWorklet is missing or fails,
//  the same source runs on a ScriptProcessorNode with a small polyfill,
//  as upstream does.
//
//  grep -n targets  "export class APU"  "  async unlock("  "  tone("
// ============================================================================
const WORKLET_URL = new URL('./apu-worklet.js', import.meta.url);

export class APU {
  constructor() { this.ctx = null; this.port = null; this.proc = null; this.gain = null; this.muted = false; this.ready = null; }

  async unlock() {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    if (!this.ctx) {
      try { this.ctx = new AC({ sampleRate: 44100 }); } catch (e) { this.ctx = new AC(); }
      this.gain = this.ctx.createGain(); this.gain.gain.value = this.muted ? 0 : 1;
      this.gain.connect(this.ctx.destination);
      this.ready = this.build();
    }
    if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (e) { /* ignore */ } }
    try { await this.ready; } catch (e) { return false; }
    return this.ctx.state === 'running';
  }

  async build() {
    const ctx = this.ctx;
    try {
      if (!ctx.audioWorklet) throw new Error('no audioWorklet');
      await ctx.audioWorklet.addModule(WORKLET_URL);
      const node = new AudioWorkletNode(ctx, 'wasm4-apu', { outputChannelCount: [2] });
      node.connect(this.gain);
      this.port = node.port;
    } catch (e) {
      const src = await (await fetch(WORKLET_URL)).text();
      let Proc = null;
      new Function('registerProcessor', 'AudioWorkletProcessor', src)((n, p) => { Proc = p; }, class {});
      this.proc = new Proc();
      const sp = ctx.createScriptProcessor(1024, 0, 2);
      sp.onaudioprocess = ev => this.proc.process(null, [[ev.outputBuffer.getChannelData(0), ev.outputBuffer.getChannelData(1)]]);
      sp.connect(this.gain);
    }
  }

  get running() { return !!(this.ctx && this.ctx.state === 'running' && (this.port || this.proc)); }

  tone(f, d, v, flags) {
    if (!this.running || this.muted) return;
    if (this.port) this.port.postMessage([f, d, v, flags]); else this.proc.tone(f, d, v, flags);
  }

  tick() {
    if (!this.running) return;
    if (this.port) this.port.postMessage('tick'); else this.proc.tick();
  }

  pause() { if (this.ctx && this.ctx.state === 'running') { try { this.ctx.suspend(); } catch (e) { /* ignore */ } } }

  setMuted(m) { this.muted = !!m; if (this.gain) this.gain.gain.value = this.muted ? 0 : 1; }
}

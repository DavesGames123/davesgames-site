// ============================================================================
//  WASM-4 ARCADE  ·  runtime/apu-worklet.js — the 4-channel sound chip
// ----------------------------------------------------------------------------
//  A JavaScript port of runtimes/web/src/apu-worklet.ts of WASM-4
//  (https://github.com/aduros/wasm4, ISC licence, Copyright (c) Bruno
//  Garcia, see runtime/LICENSE.txt). Only the TypeScript types are removed.
//
//  Channels: 0 and 1 pulse (duty 12.5, 25 or 50 %), 2 triangle, 3 noise.
//  tone(frequency, duration, volume, flags) packs:
//    frequency  freq1 | freq2 << 16 (a slide), or MIDI notes in note mode
//    duration   sustain | release << 8 | decay << 16 | attack << 24 (frames)
//    volume     sustain | peak << 8 (0..100)
//    flags      channel (2 bits) | mode << 2 | pan << 4 | note mode 0x40
//
//  This file is an AudioWorklet module: it has no import and no export.
//  apu.js loads it with audioWorklet.addModule, or, when that fails, runs
//  the same source with a small polyfill on a ScriptProcessorNode. The node
//  tests run it the same way (tests.mjs "apu.").
//
//  grep -n targets   "  tone("   "  process("   "class Channel"
// ============================================================================
'use strict';
const SAMPLE_RATE = 44100;
const MAX_VOLUME = 0.15;
// The triangle channel sounds quieter than the others, so it gets more amplitude.
const MAX_VOLUME_TRIANGLE = 0.25;
// A 1 ms release on the triangle channel stops pops on hard stops.
const RELEASE_TIME_TRIANGLE = Math.floor(SAMPLE_RATE / 1000);

class Channel {
  constructor() {
    this.freq1 = 0; this.freq2 = 0;
    this.startTime = 0; this.attackTime = 0; this.decayTime = 0; this.sustainTime = 0; this.releaseTime = 0;
    this.endTick = 0; this.sustainVolume = 0; this.peakVolume = 0;
    this.phase = 0; this.pan = 0; this.pulseDutyCycle = 0;
    this.noiseSeed = 0x0001; this.noiseLastRandom = 0;
  }
}

function lerp(a, b, t) { return a + t * (b - a); }

function polyblep(phase, phaseInc) {
  if (phase < phaseInc) { const t = phase / phaseInc; return t + t - t * t; }
  else if (phase > 1 - phaseInc) { const t = (phase - (1 - phaseInc)) / phaseInc; return 1 - (t + t - t * t); }
  return 1;
}

function midiFreq(note, bend) { return Math.pow(2, (note - 69 + bend / 256) / 12) * 440; }

class APUProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.time = 0; this.ticks = 0;
    this.channels = [new Channel(), new Channel(), new Channel(), new Channel()];
    if (this.port != null) {
      this.port.onmessage = (event) => {
        if (event.data === 'tick') this.tick();
        else this.tone(...event.data);
      };
    }
  }

  ramp(v1, v2, t1, t2) {
    if (this.time >= t2) return v2;
    return lerp(v1, v2, (this.time - t1) / (t2 - t1));
  }

  getCurrentFrequency(c) {
    return c.freq2 > 0 ? this.ramp(c.freq1, c.freq2, c.startTime, c.releaseTime) : c.freq1;
  }

  getCurrentVolume(c) {
    const time = this.time;
    if (time >= c.sustainTime && (c.releaseTime - c.sustainTime) > RELEASE_TIME_TRIANGLE) return this.ramp(c.sustainVolume, 0, c.sustainTime, c.releaseTime);
    else if (time >= c.decayTime) return c.sustainVolume;
    else if (time >= c.attackTime) return this.ramp(c.peakVolume, c.sustainVolume, c.attackTime, c.decayTime);
    return this.ramp(0, c.peakVolume, c.startTime, c.attackTime);
  }

  tick() { this.ticks++; }

  tone(frequency, duration, volume, flags) {
    const freq1 = frequency & 0xffff;
    const freq2 = (frequency >> 16) & 0xffff;
    const sustain = duration & 0xff;
    const release = (duration >> 8) & 0xff;
    const decay = (duration >> 16) & 0xff;
    const attack = (duration >> 24) & 0xff;
    const sustainVolume = Math.min(volume & 0xff, 100);
    const peakVolume = Math.min((volume >> 8) & 0xff, 100);
    const channelIdx = flags & 0x3;
    const mode = (flags >> 2) & 0x3;
    const pan = (flags >> 4) & 0x3;
    const noteMode = flags & 0x40;
    const c = this.channels[channelIdx];
    // Restart the phase if this channel was not already playing.
    if (this.time > c.releaseTime && this.ticks != c.endTick) c.phase = (channelIdx == 2) ? 0.25 : 0;
    if (noteMode) {
      c.freq1 = midiFreq(freq1 & 0xff, freq1 >> 8);
      c.freq2 = (freq2 == 0) ? 0 : midiFreq(freq2 & 0xff, freq2 >> 8);
    } else { c.freq1 = freq1; c.freq2 = freq2; }
    c.startTime = this.time;
    c.attackTime = c.startTime + ((SAMPLE_RATE * attack / 60) >>> 0);
    c.decayTime = c.attackTime + ((SAMPLE_RATE * decay / 60) >>> 0);
    c.sustainTime = c.decayTime + ((SAMPLE_RATE * sustain / 60) >>> 0);
    c.releaseTime = c.sustainTime + ((SAMPLE_RATE * release / 60) >>> 0);
    c.endTick = this.ticks + attack + decay + sustain + release;
    c.pan = pan;
    const maxVolume = (channelIdx == 2) ? MAX_VOLUME_TRIANGLE : MAX_VOLUME;
    c.sustainVolume = maxVolume * sustainVolume / 100;
    c.peakVolume = peakVolume ? maxVolume * peakVolume / 100 : maxVolume;
    if (channelIdx == 0 || channelIdx == 1) {
      c.pulseDutyCycle = mode === 0 ? 0.125 : mode === 2 ? 0.5 : 0.25;
    } else if (channelIdx == 2) {
      if (release == 0) c.releaseTime += RELEASE_TIME_TRIANGLE;
    }
  }

  process(_inputs, outputs) {
    const outputLeft = outputs[0][0], outputRight = outputs[0][1] || outputs[0][0];
    for (let ii = 0, frames = outputLeft.length; ii < frames; ++ii, ++this.time) {
      let mixLeft = 0, mixRight = 0;
      for (let channelIdx = 0; channelIdx < 4; ++channelIdx) {
        const c = this.channels[channelIdx];
        if (this.time < c.releaseTime || this.ticks == c.endTick) {
          const freq = this.getCurrentFrequency(c);
          const volume = this.getCurrentVolume(c);
          let sample;
          if (channelIdx == 3) {
            // Noise channel
            c.phase += freq * freq / (1000000 / 44100 * SAMPLE_RATE);
            while (c.phase > 0) {
              c.phase--;
              let s = c.noiseSeed;
              s ^= s >> 7; s ^= s << 9; s ^= s >> 13;
              c.noiseSeed = s;
              c.noiseLastRandom = ((s & 0x1) << 1) - 1;
            }
            sample = volume * c.noiseLastRandom;
          } else {
            const phaseInc = freq / SAMPLE_RATE;
            let phase = c.phase + phaseInc;
            if (phase >= 1) phase--;
            c.phase = phase;
            if (channelIdx == 2) {
              sample = volume * (2 * Math.abs(2 * c.phase - 1) - 1);
            } else {
              let dutyPhase, dutyPhaseInc, multiplier;
              const d = c.pulseDutyCycle;
              if (phase < d) { dutyPhase = phase / d; dutyPhaseInc = phaseInc / d; multiplier = volume; }
              else { dutyPhase = (phase - d) / (1 - d); dutyPhaseInc = phaseInc / (1 - d); multiplier = -volume; }
              sample = multiplier * polyblep(dutyPhase, dutyPhaseInc);
            }
          }
          if (c.pan != 1) mixRight += sample;
          if (c.pan != 2) mixLeft += sample;
        }
      }
      outputLeft[ii] = mixLeft;
      if (outputRight !== outputLeft) outputRight[ii] = mixRight;
    }
    return true;
  }
}

registerProcessor('wasm4-apu', APUProcessor);

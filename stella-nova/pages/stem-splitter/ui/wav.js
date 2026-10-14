// ============================================================================
//  STEM SPLITTER  ·  ui/wav.js — 16-bit PCM WAV write and read
// ----------------------------------------------------------------------------
//  Pure functions, no DOM. The page writes each stem as a 44 100 Hz stereo
//  16-bit PCM WAV file (CONTRACT 2.6).
//
//  Clip rule. Before the write, rescaleClip applies the Demucs default
//  "rescale" rule to the whole file: wav / max(1.01 * max|wav|, 1). It
//  follows demucs/audio.py prevent_clip, mode "rescale" (Demucs, MIT,
//  Copyright (c) Meta Platforms, Inc. and affiliates). A file with a peak
//  under 1 / 1.01 does not change.
//
//  Sample code. int16 = round(clamp(x, -1, 1) * 32767). decodeWav16 divides
//  by 32767, so a round trip has an error of at most 0.5 / 32767.
//
//  GREP MAP
//    peakAbs ........... max |x| over channels
//    rescaleClip ....... the Demucs "rescale" rule, new arrays
//    wavHeader ......... the 44-byte RIFF/WAVE header
//    encodeWav16 ....... [L, R] -> Uint8Array (no rescale)
//    stemToWav ......... rescaleClip + encodeWav16
//    decodeWav16 ....... Uint8Array -> { sampleRate, channels, data[] } (tests)
// ============================================================================

export const WAV_RATE = 44100;

export function peakAbs(channels) {
  let p = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > p) p = a; }
  return p;
}

// Returns { channels: Float32Array[], scale }. scale = 1 / max(1.01 * peak, 1).
export function rescaleClip(channels) {
  const scale = 1 / Math.max(1.01 * peakAbs(channels), 1);
  const out = channels.map(ch => {
    const o = new Float32Array(ch.length);
    if (scale === 1) o.set(ch); else for (let i = 0; i < ch.length; i++) o[i] = ch[i] * scale;
    return o;
  });
  return { channels: out, scale };
}

export function wavHeader(frames, channels = 2, sampleRate = WAV_RATE) {
  const blockAlign = channels * 2, dataBytes = frames * blockAlign;
  const b = new Uint8Array(44), v = new DataView(b.buffer);
  const tag = (o, s) => { for (let i = 0; i < 4; i++) b[o + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, dataBytes, true);
  return b;
}

export function encodeWav16(channels, sampleRate = WAV_RATE) {
  const nc = channels.length, frames = channels[0].length;
  const out = new Uint8Array(44 + frames * nc * 2);
  out.set(wavHeader(frames, nc, sampleRate), 0);
  const pcm = new DataView(out.buffer, 44);
  let o = 0;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nc; c++) {
      let x = channels[c][i];
      x = x > 1 ? 1 : x < -1 ? -1 : (x || 0);
      pcm.setInt16(o, Math.round(x * 32767), true); o += 2;
    }
  }
  return out;
}

export function stemToWav(channels, sampleRate = WAV_RATE) {
  return encodeWav16(rescaleClip(channels).channels, sampleRate);
}

// Reads the files that encodeWav16 writes (PCM 16, 44-byte header).
export function decodeWav16(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = o => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' || tag(36) !== 'data') throw new Error('not a 44-byte PCM WAV');
  if (v.getUint16(20, true) !== 1 || v.getUint16(34, true) !== 16) throw new Error('not PCM 16');
  const nc = v.getUint16(22, true), sampleRate = v.getUint32(24, true), dataBytes = v.getUint32(40, true);
  const frames = dataBytes / (2 * nc);
  const data = Array.from({ length: nc }, () => new Float32Array(frames));
  let o = 44;
  for (let i = 0; i < frames; i++) for (let c = 0; c < nc; c++) { data[c][i] = v.getInt16(o, true) / 32767; o += 2; }
  return { sampleRate, channels: nc, frames, data };
}

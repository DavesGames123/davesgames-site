// ============================================================================
//  STEM SPLITTER  ·  ui/audio-io.js — decode a song file, make AudioBuffers
// ----------------------------------------------------------------------------
//  CONTRACT 2.6. The browser decodes the file with
//  new OfflineAudioContext(2, 1, 44100).decodeAudioData(arrayBuffer), so it
//  also resamples to 44 100 Hz. There is no JS resampler.
//
//  Channels follow demucs/audio.py convert_audio_channels (Demucs, MIT,
//  Copyright (c) Meta Platforms, Inc. and affiliates): 1 channel -> copy to
//  L and R; 2 -> as is; more than 2 -> the first two.
//
//  Length limit (CONTRACT 2.4): 20 min, or 8 min on a phone (coarse pointer
//  and a viewport under 700 px wide). The memory for the output stems grows
//  with the song length.
//
//  GREP MAP
//    SAMPLE_RATE ....... 44100
//    toStereo .......... AudioBuffer-like -> [L, R] (new arrays)
//    decodeSong ........ File or ArrayBuffer -> { left, right, duration, ... }
//    isPhoneLimit ...... coarse pointer and width < 700
//    lengthLimit ....... seconds allowed
//    checkLength ....... null or the refusal message
//    makeAudioBuffer ... [L, R] -> AudioBuffer of a context
//    DecodeError ....... error with code 'decode'
// ============================================================================

export const SAMPLE_RATE = 44100;
export const LIMIT_S = 20 * 60;
export const PHONE_LIMIT_S = 8 * 60;

export class DecodeError extends Error {
  constructor(msg) { super(msg); this.code = 'decode'; }
}

export function toStereo(buf) {
  const n = buf.length, nc = buf.numberOfChannels;
  if (nc < 1) throw new DecodeError('the file has no audio channel');
  const L = new Float32Array(n), R = new Float32Array(n);
  L.set(buf.getChannelData(0));
  R.set(buf.getChannelData(nc >= 2 ? 1 : 0));
  return [L, R];
}

function offlineCtor(win) {
  return win.OfflineAudioContext || win.webkitOfflineAudioContext || null;
}

// Promise and callback forms (old Safari has only the callback form).
function decodeWith(ctx, ab) {
  return new Promise((resolve, reject) => {
    let done = false;
    const ok = b => { if (!done) { done = true; resolve(b); } };
    const bad = e => { if (!done) { done = true; reject(e || new Error('decode failed')); } };
    try {
      const p = ctx.decodeAudioData(ab, ok, bad);
      if (p && typeof p.then === 'function') p.then(ok, bad);
    } catch (e) { bad(e); }
  });
}

// source: File / Blob (has arrayBuffer()) or ArrayBuffer.
export async function decodeSong(source, { win = globalThis } = {}) {
  const Ctor = offlineCtor(win);
  if (!Ctor) throw new DecodeError('this browser has no Web Audio decoder');
  const ab = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  let buf;
  try {
    buf = await decodeWith(new Ctor(2, 1, SAMPLE_RATE), ab);
  } catch (e) {
    throw new DecodeError((e && e.message) || 'decode failed');
  }
  if (!buf || !buf.length) throw new DecodeError('the file has no audio');
  const [left, right] = toStereo(buf);
  return {
    left, right,
    sampleRate: SAMPLE_RATE,
    decodedRate: buf.sampleRate,
    channels: buf.numberOfChannels,
    frames: buf.length,
    duration: buf.length / SAMPLE_RATE,
  };
}

export function isPhoneLimit(win = globalThis) {
  try {
    const coarse = !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches);
    return coarse && (win.innerWidth || 1e9) < 700;
  } catch (e) { return false; }
}

export const lengthLimit = phone => (phone ? PHONE_LIMIT_S : LIMIT_S);

export function checkLength(seconds, phone) {
  const lim = lengthLimit(phone);
  if (seconds <= lim) return null;
  return phone
    ? `This song is longer than 8 minutes. On a phone the page takes songs up to 8 minutes, because the stems need a lot of memory.`
    : `This song is longer than 20 minutes. The page takes songs up to 20 minutes, because the stems need a lot of memory.`;
}

export function makeAudioBuffer(ctx, channels) {
  const n = channels[0].length;
  const b = ctx.createBuffer(channels.length, Math.max(1, n), SAMPLE_RATE);
  channels.forEach((ch, c) => {
    if (b.copyToChannel) b.copyToChannel(ch, c); else b.getChannelData(c).set(ch);
  });
  return b;
}

// ============================================================================
//  SYNTH  ·  stem-splitter/engine/synth.js — the synth-v1 test signal
// ----------------------------------------------------------------------------
//  The only audio the tests use (CONTRACT 3.5). It is our own signal, so it
//  has no copyright: a kick, a bass sine, a vibrato "voice" and two noise
//  hats. tools/stem-splitter/synth.py (MODEL) computes the same values in
//  numpy; vectors.json holds its first 256 samples per channel.
//  Computed in float64, stored as float32.
//
//  GREP MAP
//    PRNG ........... "export function mulberry32"
//    signal ......... "export function synthV1"
// ============================================================================

export function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synthV1(seconds, sampleRate = 44100) {
  const n = Math.round(seconds * sampleRate);
  const L = new Float32Array(n), R = new Float32Array(n);
  const rng = mulberry32(20261014);
  const TAU = 2 * Math.PI;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const nL = rng() - 0.5, nR = rng() - 0.5;
    const pm = t % 0.5;   // t >= 0: % is the exact fmod, as numpy and Python give
    const kick = Math.exp(-30 * pm) * Math.sin(TAU * 55 * pm);
    const bass = 0.25 * Math.sin(TAU * 82.41 * t);
    const voice = 0.2 * Math.sin(TAU * 440 * t + 2 * Math.sin(TAU * 5 * t)) * (0.6 + 0.4 * Math.sin(TAU * 0.5 * t));
    const env = Math.exp(-60 * ((t + 0.25) % 0.5));
    L[i] = 0.5 * kick + bass + 0.8 * voice + 0.05 * nL * env;
    R[i] = 0.5 * kick + 0.8 * bass + voice + 0.05 * nR * env;
  }
  return [L, R];
}

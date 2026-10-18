// ============================================================================
//  GALAXY  ·  encounter.js — read a recorded encounter at a time (no DOM)
// ----------------------------------------------------------------------------
//  model.js tidalEncounter records an interacting pair: K keyframes of every
//  test star (half floats) and 4 (K-1) + 1 samples of the two host centres.
//  buildGalaxy puts that record on built.enc. This module is the CPU mirror
//  of what stars.wgsl does with it (the same Catmull-Rom curve), so the
//  camera can see the stars that the GPU draws, with no GPU readback.
//
//  Time t is in Myr from the start of the record, 0 .. enc.tEnd.
//
//  EXPORTS (grep -n "^export" encounter.js)
//    catmull(p0, p1, p2, p3, f)     one coordinate of the Catmull-Rom curve
//    coresAt(enc, t)                [[x, y, z], [x, y, z]] the host centres
//    starAt(enc, i, t, out)         test star i at t (kpc)
//    sampleAt(enc, t, opts)         a subsample for lib/action-camera.js:
//                                   { pos, vel, mass, count, stride, cores,
//                                   sep, nStars } (the two hosts are the
//                                   last two bodies, with their light share)
//    phaseAt(enc, t)                { phase, sep, close, after }: approach,
//                                   peri, tails or merger, from the measured
//                                   separation and the recorded events
//    phaseStart(enc, phase)         the first time of that phase (Myr)
//    keyU(enc, t)                   the keyframe coordinate for the shader
// ============================================================================
import { fromHalf } from './model.js';

export function catmull(p0, p1, p2, p3, f) {
  const f2 = f * f, f3 = f2 * f;
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
}

// The four keys round u in 0 .. N-1, clamped at the ends.
function keys(u, N) {
  u = Math.max(0, Math.min(N - 1, u));
  const k1 = Math.min(N - 2, Math.floor(u)), f = u - k1;
  return [Math.max(0, k1 - 1), k1, k1 + 1, Math.min(N - 1, k1 + 2), f];
}

export const keyU = (enc, t) => Math.max(0, Math.min(enc.K - 1, t / enc.dtK));

export function coresAt(enc, t) {
  const [a, b, c, d, f] = keys(t / enc.dtC, enc.NC), C = enc.cores;
  const out = [[0, 0, 0], [0, 0, 0]];
  for (let g = 0; g < 2; g++) for (let k = 0; k < 3; k++) { const o = g * 3 + k; out[g][k] = catmull(C[a * 6 + o], C[b * 6 + o], C[c * 6 + o], C[d * 6 + o], f); }
  return out;
}

function keyPos(enc, k, i, out, o) {
  const q = (k * enc.n + i) * 2, w = enc.track[q];
  out[o] = fromHalf(w & 0xffff); out[o + 1] = fromHalf(w >>> 16); out[o + 2] = fromHalf(enc.track[q + 1] & 0xffff);
}
const tmp = new Float64Array(12);
export function starAt(enc, i, t, out = [0, 0, 0], o = 0) {
  const [a, b, c, d, f] = keys(keyU(enc, t), enc.K);
  keyPos(enc, a, i, tmp, 0); keyPos(enc, b, i, tmp, 3); keyPos(enc, c, i, tmp, 6); keyPos(enc, d, i, tmp, 9);
  for (let k = 0; k < 3; k++) out[o + k] = catmull(tmp[k], tmp[3 + k], tmp[6 + k], tmp[9 + k], f);
  return out;
}

// A subsample of about `count` test stars, plus the two hosts as heavy
// bodies. Each star weighs (1 - coreShare) / m; host g weighs coreShare
// times its light share (1 : 0.7). vel is a central difference over h Myr.
export function sampleAt(enc, t, { count = 1200, h = 2, out = null } = {}) {
  const stride = Math.max(1, Math.floor(enc.n / count)), m = Math.floor((enc.n - 1) / stride) + 1, N = m + 2;
  const s = out && out.pos.length >= N * 3 ? out : { pos: new Float64Array(N * 3), vel: new Float64Array(N * 3), mass: new Float64Array(N) };
  const t0 = Math.max(0, t - h), t1 = Math.min(enc.tEnd, t + h), dt = Math.max(1e-6, t1 - t0);
  const a = [0, 0, 0], b = [0, 0, 0];
  const cs = enc.coreShare ?? 0.8, wStar = (1 - cs) / m;
  for (let j = 0; j < m; j++) {
    const i = j * stride, o = j * 3;
    starAt(enc, i, t, s.pos, o); starAt(enc, i, t0, a); starAt(enc, i, t1, b);
    for (let k = 0; k < 3; k++) s.vel[o + k] = (b[k] - a[k]) / dt;
    s.mass[j] = wStar;
  }
  const c = coresAt(enc, t), c0 = coresAt(enc, t0), c1 = coresAt(enc, t1);
  for (let g = 0; g < 2; g++) {
    const o = (m + g) * 3;
    for (let k = 0; k < 3; k++) { s.pos[o + k] = c[g][k]; s.vel[o + k] = (c1[g][k] - c0[g][k]) / dt; }
    s.mass[m + g] = cs * (g ? 0.7 : 1) / 1.7;
  }
  s.count = N; s.stride = 3; s.nStars = m; s.cores = c;
  s.sep = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]);
  return s;
}

// The phase, measured from the run:
//   approach  before the first pericentre, the hosts apart
//   peri      the hosts closer than `close` (1.6 x the first pericentre
//             distance), before the merger: the cores and the bridge
//   tails     after the first pericentre, the hosts apart again
//   merger    from the merger time on (the separation stays small)
export function phaseAt(enc, t) {
  const c = coresAt(enc, t);
  const sep = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]);
  const close = 1.6 * enc.sepPeri, after = enc.peri.length > 0 && t > enc.peri[0];
  let phase;
  if (t >= enc.tMerge) phase = 'merger';
  else if (sep < close) phase = 'peri';
  else phase = after ? 'tails' : 'approach';
  return { phase, sep, close, after };
}

export function phaseStart(enc, phase) {
  if (phase === 'approach') return 0;
  if (phase === 'merger') return Math.min(enc.tEnd, enc.tMerge);
  const N = 200;
  for (let i = 0; i <= N; i++) { const t = enc.tEnd * i / N; if (phaseAt(enc, t).phase === phase) return t; }
  return 0;
}

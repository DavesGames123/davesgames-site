// ============================================================================
//  POOL CAUSTICS 3D  ·  tests.mjs — node tests of pool3d.js (no GPU)
// ----------------------------------------------------------------------------
//  Run from the repo root:  node stella-nova/pages/photon-caustics-3d/tests.mjs
//  1. Cauchy index: the split from 400 nm to 700 nm is dn, n at 589.3 nm.
//  2. camera: the orbit target shows at the NDC shift, the eye is at the
//     orbit distance.
//  3. waveSteps: K = 2 s^2, the step rate 120 T, the defaults of main.js
//     give a fifth of the old ripple speed or less.
//  4. the wave step on the CPU (the same sums as SIM_FS): a ring from a
//     drop goes sqrt(K / 4) cells a step, so wave speed s = 0.3 makes it
//     0.3 times as fast; the damping keeps the ring height at the same
//     distance.
// ============================================================================
import { indexAt, camera, waveSteps, WAVE_V0 } from './pool3d.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } };
const near = (a, b, e) => Math.abs(a - b) <= e;

// 1
ok(near(indexAt(1.333, 0.02, 400) - indexAt(1.333, 0.02, 700), 0.02, 1e-9), 'Cauchy split 400..700 nm');
ok(near(indexAt(1.333, 0.02, 589.3), 1.333, 1e-12), 'Cauchy index at 589.3 nm');
// 2
{
  const cam = { yaw: 0.6, pitch: 0.85, dist: 2.8, ty: -0.35 }, shift = [0.3, -0.2];
  const c = camera(cam, 1.6, shift), M = c.vp, p = [0, -0.35, 0, 1], q = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) q[r] += M[k * 4 + r] * p[k];
  ok(near(q[0] / q[3], 0.3, 1e-6) && near(q[1] / q[3], -0.2, 1e-6), `camera: target at NDC ${(q[0] / q[3]).toFixed(4)}, ${(q[1] / q[3]).toFixed(4)}`);
  ok(near(Math.hypot(c.eye[0], c.eye[1] + 0.35, c.eye[2]), 2.8, 1e-9), 'camera: eye at the orbit distance');
}

// 3
{
  const a = waveSteps(1, 1, 'rain'), b = waveSteps(0.3, 0.6, 'rain');
  ok(a.k === 2 && near(a.damp, 0.993, 1e-12) && a.rate === 120 && near(a.v, WAVE_V0, 1e-12), 'waveSteps at s = 1, T = 1 is the old step');
  ok(near(b.k, 0.18, 1e-12) && near(b.rate, 72, 1e-9) && near(b.v / a.v, 0.18, 1e-9), `waveSteps defaults: ${(b.v / a.v).toFixed(3)} of the old ripple speed`);
  ok(waveSteps(0.02, 0.02, 'swell').v < 0.001, 'waveSteps: near still at the low ends');
}
// 4
{
  const N = 160;
  // one run: a cosine drop in the middle, then steps; returns the radius of
  // the ring peak along +x, and its height, after 'steps' steps
  const run = (s, steps) => {
    const W = waveSteps(s, 1, 'rain');
    let h = new Float64Array(N * N), v = new Float64Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const r = Math.hypot(i - N / 2, j - N / 2) / 4;
      if (r < 1) h[j * N + i] = 0.5 - 0.5 * Math.cos((1 - r) * Math.PI);
    }
    const at = (i, j) => h[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
    for (let t = 0; t < steps; t++) {
      const h2 = new Float64Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i, avg = 0.25 * (at(i + 1, j) + at(i - 1, j) + at(i, j + 1) + at(i, j - 1));
        v[k] = (v[k] + (avg - h[k]) * W.k) * W.damp;
        h2[k] = (h[k] + v[k]) * 0.9995;
      }
      h = h2;
    }
    let best = 0, bi = 0;
    for (let i = N / 2 + 2; i < N; i++) { const q = Math.abs(h[(N / 2) * N + i]); if (q > best) { best = q; bi = i - N / 2; } }
    return { r: bi, a: best };
  };
  const fast = run(1, 60), slow = run(0.3, 200);
  const cFast = fast.r / 60, cSlow = slow.r / 200;
  ok(near(cFast, Math.sqrt(2 / 4), 0.12), `wave step: ring speed ${cFast.toFixed(3)} cells a step at s = 1 (sqrt(K/4) = 0.707)`);
  ok(near(cSlow / cFast, 0.3, 0.05), `wave step: s = 0.3 gives ${(cSlow / cFast).toFixed(3)} of the speed`);
  ok(Math.abs(slow.r - fast.r) <= 6 && near(slow.a / fast.a, 1, 0.2), `wave step: at r = ${fast.r}, ${slow.r} cells the ring heights are ${fast.a.toFixed(4)}, ${slow.a.toFixed(4)}`);
}

console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);

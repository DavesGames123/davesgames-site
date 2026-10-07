// ============================================================================
//  POOL CAUSTICS 3D  ·  tests.mjs — node tests of pool3d.js (no GPU)
// ----------------------------------------------------------------------------
//  Run from the repo root:  node stella-nova/pages/photon-caustics-3d/tests.mjs
//  1. Cauchy index: the split from 400 nm to 700 nm is dn, n at 589.3 nm.
//  2. camera: the orbit target shows at the NDC shift, the eye is at the
//     orbit distance.
// ============================================================================
import { indexAt, camera } from './pool3d.js';

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

console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);

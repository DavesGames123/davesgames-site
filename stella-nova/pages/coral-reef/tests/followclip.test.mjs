// ============================================================================
//  CORAL REEF  ·  tests/followclip.test.mjs  ·  the follow eye and the ROV
//    node tests/followclip.test.mjs        (CAM=<path> tests another camera.js)
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "when ROV's turn quickly they turn the camera
//  into the rov". camera.js follow mode on a scripted ROV, 60 steps a s:
//    open .... flat floor 20 m down; the ROV turns 180 deg in 0.5 s
//    wall .... a wall 1.6 m behind the ROV, then the 180 deg turn
//    cave .... a roof 1.3 m over the ROV and a wall 1.3 m behind it (the
//              boom is short and pickBoom swings it), then the turn
//    tunnel .. walls 1.6 m to each side, floor and roof near, the turn
//  Checks for each: the eye never comes into the ROV body + BODY_MARGIN
//  (bodySdf), and the view direction changes smoothly: the peak angular
//  acceleration of the view stays under 12 rad/s2.
// ============================================================================
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const C = await import(process.env.CAM ? pathToFileURL(path.resolve(process.env.CAM)).href : pathToFileURL(path.join(HERE, '../camera.js')).href);
const { createExploreCamera } = C;
const BODY_HALF = [0.72, 0.46, 0.5], MARGIN = 0.3;
function bodySdf(p, c, yaw) {
  const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2], cy = Math.cos(yaw), sy = Math.sin(yaw);
  const qx = Math.abs(dx * cy + dz * sy) - BODY_HALF[0], qy = Math.abs(dy) - BODY_HALF[1], qz = Math.abs(-dx * sy + dz * cy) - BODY_HALF[2];
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
}
let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) { pass++; console.log(`ok   ${name}  ${info}`); } else { fail++; console.log(`FAIL ${name}  ${info}`); } };

const SDF = {
  open: (x, y, z) => y + 20,
  wall: (x, y, z) => Math.min(y + 20, x + 1.6),
  cave: (x, y, z) => Math.min(y + 20, 1.3 - y, x + 1.3),
  tunnel: (x, y, z) => Math.min(y + 1.4, 1.5 - y, 1.6 - Math.abs(z)),
};
function run(sdf) {
  const rock = { sdfAll: sdf, sdfScale: 1, lipschitz: 1 };
  const v = { pos: [0, 0, 0], yaw: 0 };
  const cam = createExploreCamera({ rock, R: Infinity, maxDist: 120, eye: [-3, 1, 0], look: [0, 0, 0] });
  cam.follow(1, { snap: true });
  const ctx = { getVehicle: () => v };
  const dt = 1 / 60;
  let minBody = Infinity, prevD = null, prevW = null, maxAcc = 0, t = 0;
  for (let i = 0; i < 60 * 6; i++) {
    t = i * dt;
    // 2 s straight, then 180 deg in 0.5 s, then straight on
    v.yaw = t < 2 ? 0 : t < 2.5 ? Math.PI * (t - 2) / 0.5 : Math.PI;
    cam.update(dt, ctx);
    minBody = Math.min(minBody, bodySdf(cam.eye, v.pos, v.yaw));
    const d = [cam.look[0] - cam.eye[0], cam.look[1] - cam.eye[1], cam.look[2] - cam.eye[2]], l = Math.hypot(...d);
    const u = d.map(x => x / l);
    if (prevD && i > 30) {
      const w = Math.acos(Math.min(1, u[0] * prevD[0] + u[1] * prevD[1] + u[2] * prevD[2])) / dt;
      if (prevW != null) maxAcc = Math.max(maxAcc, Math.abs(w - prevW) / dt);
      prevW = w;
    }
    prevD = u;
  }
  return { minBody, maxAcc };
}
for (const name of Object.keys(SDF)) {
  const r = run(SDF[name]);
  ok(r.minBody >= MARGIN - 0.01, `${name}: 180 deg in 0.5 s, the eye stays out of the ROV body + ${MARGIN} m`, `nearest ${r.minBody.toFixed(2)} m`);
  ok(r.maxAcc < 12, `${name}: the view turns smoothly (peak angular acceleration < 12 rad/s2)`, `${r.maxAcc.toFixed(1)} rad/s2`);
}
console.log(`followclip: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

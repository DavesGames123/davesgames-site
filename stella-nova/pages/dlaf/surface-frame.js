// ============================================================================
//  DLAF PAGE  ·  surface-frame.js — the lights, ground and maps of a frame
// ----------------------------------------------------------------------------
//  DOM-free. main.js calls surfaceFrame() each frame and hands the result
//  to surface-render.js draw(). tests.mjs checks it.
//
//  3D: world up is +y. The key light follows the orbit camera: up and to
//  the left of the eye, so the lit side faces the viewer at every yaw. The
//  floor sits under the lowest particle (minUp) by one maximum radius and
//  fades into the backdrop.
//  2D: the relief. The cluster lies in z = 0, world up is +z (to the
//  viewer), the view is orthographic from above. The slab is at
//  z = -0.75 rTip, so the tip tubes stand on it and the thick trunks sink
//  into it, as in a cast relief. The key light comes from the upper left
//  at 31 degrees: low enough to rake the relief, and far from the mirror
//  angle of the flat slab, so the slab shows no flat key highlight.
//
//  grep -n targets
//    frame ................. "export function surfaceFrame"
// ============================================================================
import { orbitEye, lightMatrix, belowMatrix } from './camera.js';
import { rigFor } from './surface-shaders.js';

const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// p = { dim, mat, cam, center, radius, minUp, opts, material, w, h,
//   max, floor, gamma, count, k, glowN, glowStr }
//   center  [x, y, z] of the cluster, radius its bounding radius
//   minUp   the lowest particle coordinate along up (3D: y)
export function surfaceFrame(p) {
  const rig = rigFor(p.material), o = p.opts;
  const r = p.radius + o.rMax + 1;
  let L, up, eye, viewDir, ortho, groundH, corners, fade, light, below, range, center;
  if (p.dim === 3) {
    up = [0, 1, 0];
    const e = orbitEye(p.cam);
    eye = e.eye; viewDir = e.back; ortho = false;
    L = nrm([-0.55 * e.right[0] + 0.5 * e.back[0], 0.95, -0.55 * e.right[2] + 0.5 * e.back[2]]);
    center = p.center;
    groundH = Math.min(p.minUp, center[1] - p.radius * 0.6) - o.rMax * 1.15 - 0.3;
    const H = r * 7, gy = groundH, cx = center[0], cz = center[2];
    corners = new Float32Array([cx - H, gy, cz - H, cx + H, gy, cz - H, cx - H, gy, cz + H, cx + H, gy, cz + H]);
    fade = [r * 0.8, r * 2.6];
    const gDist = (center[1] - groundH) / Math.max(0.25, L[1]);
    light = lightMatrix(center, r, L, up, gDist + r);
    range = Math.max(6, r * 0.7);
    below = belowMatrix(center, up, groundH, r * 1.35, range);
  } else {
    up = [0, 0, 1];
    eye = [0, 0, 1e4]; viewDir = [0, 0, 1]; ortho = true;
    L = nrm([-0.6, 0.7, 0.56]);
    center = [p.center[0], p.center[1], 0];
    groundH = -0.75 * o.rTip;
    const H = r * 40, cx = center[0], cy = center[1], gz = groundH;
    corners = new Float32Array([cx - H, cy - H, gz, cx + H, cy - H, gz, cx - H, cy + H, gz, cx + H, cy + H, gz]);
    fade = [r * 2.5, r * 9];
    light = lightMatrix(center, r, L, [0, 1, 0], o.rMax * 4 + 2);
    range = o.rMax * 2 + 1.5;
    below = belowMatrix(center, up, groundH, r, range);
  }
  return {
    mat: p.mat, light, below, L, up, eye, viewDir, ortho,
    keyCol: rig.key, skyCol: rig.sky, gndCol: rig.gnd, exposure: rig.exposure,
    bgTop: rig.bgTop, bgBot: rig.bgBot, bg: rig.bgBot,
    material: p.material, dim: p.dim, k: p.k ?? 1e9, count: p.count, max: p.max, floor: p.floor, gamma: p.gamma,
    glowN: p.glowN ?? 0, glowStr: p.glowStr ?? 0,
    ground: { corners, center, fade, range, contact: p.dim === 3 ? 0.75 : 0.85, contactR: p.dim === 3 ? 0.07 : 0.012, height: groundH },
    w: p.w, h: p.h,
  };
}

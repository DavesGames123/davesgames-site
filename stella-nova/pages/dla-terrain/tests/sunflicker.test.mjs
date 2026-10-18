// ============================================================================
//  DLA TERRAIN  ·  tests/sunflicker.test.mjs — the sun disc keeps its energy
//  from frame to frame (node, f32 twins, no GPU)
//  Run: node stella-nova/pages/dla-terrain/tests/sunflicker.test.mjs
// ----------------------------------------------------------------------------
//  Why (2026-10-18, the user): "the way the sun is rendered flickers
//  wildly". Two causes, both in f32:
//    1 the view ray: viewRay(uv) was normalize(worldFromDepth(uv, 1) -
//      camPos), a point on the near plane (0.1 .. 0.5 m) minus a camera
//      some km from the origin. The f32 step of a world coordinate near
//      8 km is about 1 mm, so the ray direction moved by up to about
//      1e-2 rad from frame to frame: two sun radii.
//    2 the disc: acos of a dot near 1 lost the centre, and a disc of a
//      few pixels (a reduced render) has a soft edge that does not keep
//      its area as the jitter moves it.
//  The check: a camera 12 km from the origin looks at the sun; 120 frames
//  with the TAA jitter (Halton 2, 3) and 120 frames with no jitter while
//  the sun moves at the day speed (TAA off). The sum of the sun radiance
//  over the pixels round the disc is worked out per frame with the old
//  and the new shader code, in f32 (Math.fround after each operation).
//  The new code must keep the energy within ENERGY_BOUND (relative peak
//  to peak), at 3 render scales.
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sunDiscPixel, SUN_DISC_K } from '../render/sky.js';
import { SUN_RADIUS, SUN_ILLUM } from '../sky-state.js';

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, '..');
let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   sunflicker: ' + name); }
  catch (e) { fail++; console.log('  FAIL sunflicker: ' + name + '\n       ' + (e && e.message)); }
}
const ENERGY_BOUND = 0.03;
const f = Math.fround;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const ss = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

// column-major 4x4 (camera.js layout)
function lookAt(eye, fwd, up) {
  const n = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const z = n(fwd.map((x) => -x)), x = n(cr(up, z)), y = cr(z, x);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}
function perspRZ(fovY, aspect, near) {
  const t = 1 / Math.tan(fovY / 2);
  return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, 0, -1, 0, 0, near, 0];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function invert(m) {
  // Gauss-Jordan on a row-major copy
  const a = [], inv = [];
  for (let r = 0; r < 4; r++) { a.push([0, 1, 2, 3].map((c) => m[c * 4 + r])); inv.push([0, 1, 2, 3].map((c) => (c === r ? 1 : 0))); }
  for (let c = 0; c < 4; c++) {
    let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]]; [inv[c], inv[p]] = [inv[p], inv[c]];
    const d = a[c][c];
    for (let k = 0; k < 4; k++) { a[c][k] /= d; inv[c][k] /= d; }
    for (let r = 0; r < 4; r++) if (r !== c) { const g = a[r][c]; for (let k = 0; k < 4; k++) { a[r][k] -= g * a[c][k]; inv[r][k] -= g * inv[c][k]; } }
  }
  const o = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[c * 4 + r] = inv[r][c];
  return o;
}
const F32 = (m) => m.map(f);
// f32 mat4 x vec4 (WGSL order: sum of the columns)
function mv(m, v) {
  const o = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) { let s = 0; for (let c = 0; c < 4; c++) s = f(s + f(m[c * 4 + r] * v[c])); o[r] = s; }
  return o;
}
const norm3 = (v) => { const l = f(Math.sqrt(f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2])))); return v.map((x) => f(x / l)); };
const dot3 = (a, b) => f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));

// the old common.wgsl viewRay: worldFromDepth(uv, 1) - camPos, in f32
function rayOld(G, uv) {
  const w = mv(G.inv, [f(uv[0] * 2 - 1), f(1 - uv[1] * 2), 1, 1]);
  const p = [f(w[0] / w[3]), f(w[1] / w[3]), f(w[2] / w[3])];
  return norm3([f(p[0] - G.cam[0]), f(p[1] - G.cam[1]), f(p[2] - G.cam[2])]);
}
// the new viewRay: the view-space ray turned by the view rotation
function rayNew(G, uv) {
  const nx = f(uv[0] * 2 - 1), ny = f(1 - uv[1] * 2);
  const v = [f(f(nx + G.proj[8]) / G.proj[0]), f(f(ny + G.proj[9]) / G.proj[5]), -1];
  const V = G.view;
  return norm3([dot3([V[0], V[1], V[2]], v), dot3([V[4], V[5], V[6]], v), dot3([V[8], V[9], V[10]], v)]);
}
// the old sk_sunDisc (no granulation)
function discOld(d, s, pxAng) {
  const r = SUN_RADIUS;
  const ang = f(Math.acos(clamp(dot3(d, s), -1, 1)));
  const w = Math.max(pxAng * 0.7, r * 0.05);
  const cov = 1 - ss(r - w, r + w, ang);
  if (cov <= 0) return 0;
  const x = Math.min(ang / r, 1), mu = Math.sqrt(Math.max(1 - x * x, 0));
  return (SUN_ILLUM / (Math.PI * r * r * (1 - 0.6 / 3))) * SUN_DISC_K * (1 - 0.6 * (1 - mu)) * cov;
}
// the new sk_sunDisc: atan2 of the cross and the dot, sunDiscPixel
function discNew(d, s, pxAng) {
  const c = [f(f(d[1] * s[2]) - f(d[2] * s[1])), f(f(d[2] * s[0]) - f(d[0] * s[2])), f(f(d[0] * s[1]) - f(d[1] * s[0]))];
  const ang = f(Math.atan2(f(Math.hypot(...c)), dot3(d, s)));
  return sunDiscPixel(ang, pxAng, SUN_ILLUM);
}
const halton = (i, b) => { let r = 0, k = 1 / b; while (i > 0) { r += k * (i % b); i = Math.floor(i / b); k /= b; } return r; };

// one run: W x H render, the sun at elevation el; mode 'jitter' or 'drift'
function run(W, H, mode, ray, disc) {
  const cam = [8000, 1500, -9000];
  const el = 0.35, az = 0.7;
  const fov = 50 * Math.PI / 180, aspect = W / H;
  const pxAng = 2 / (1 / Math.tan(fov / 2) * H);
  const fwd = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  const view = lookAt(cam, fwd, [0, 1, 0]);
  const E = [];
  for (let fr = 0; fr < 120; fr++) {
    const j = mode === 'jitter' ? [halton(fr + 1, 2) - 0.5, halton(fr + 1, 3) - 0.5] : [0, 0];
    const proj = perspRZ(fov, aspect, 0.1);
    proj[8] = -(2 * j[0] / W); proj[9] = -(2 * j[1] / H);
    // the sun moves at the day speed (27 real minutes a day) in drift mode
    const t = mode === 'drift' ? fr / 60 : 0;
    const sa = az + 0.3 * pxAng + (2 * Math.PI / 1620) * t * 0.6, se = el + 0.2 * pxAng + (2 * Math.PI / 1620) * t * 0.4;
    const s = norm3([Math.cos(se) * Math.cos(sa), Math.sin(se), Math.cos(se) * Math.sin(sa)].map(f));
    const G = { inv: F32(invert(mul(proj, view))), proj: F32(proj), view: F32(view), cam: cam.map(f) };
    // the pixels round the screen centre (the sun is there)
    let sum = 0;
    const R = Math.ceil(SUN_RADIUS / pxAng) + 4;
    for (let y = Math.floor(H / 2) - R; y <= Math.floor(H / 2) + R; y++) {
      for (let x = Math.floor(W / 2) - R; x <= Math.floor(W / 2) + R; x++) {
        const d = ray(G, [(x + 0.5) / W, (y + 0.5) / H]);
        sum += disc(d, s, pxAng);
      }
    }
    E.push(sum * pxAng * pxAng);
  }
  const mean = E.reduce((a, b) => a + b, 0) / E.length;
  const p2p = (Math.max(...E) - Math.min(...E)) / Math.max(mean, 1e-12);
  return { mean, p2p };
}

const want = SUN_DISC_K * SUN_ILLUM;
const rows = [];
for (const [W, H, tag] of [[1280, 800, 'full'], [512, 320, '40 %'], [256, 160, 'phone low']]) {
  for (const mode of ['jitter', 'drift']) {
    const o = run(W, H, mode, rayOld, discOld);
    const n = run(W, H, mode, rayNew, discNew);
    rows.push({ tag, mode, oldP2P: o.p2p, newP2P: n.p2p, oldE: o.mean / want, newE: n.mean / want });
    check(`${tag} (${W} x ${H}), ${mode === 'jitter' ? 'TAA jitter' : 'no jitter, sun at the day speed'}: energy peak to peak ${(100 * n.p2p).toFixed(2)} % (old ${(100 * o.p2p).toFixed(1)} %) under ${100 * ENERGY_BOUND} %`, () => {
      assert.ok(n.p2p < ENERGY_BOUND, 'p2p ' + n.p2p);
    });
    check(`${tag}, ${mode}: the mean energy is the disc energy within 5 % (${(100 * n.mean / want).toFixed(1)} %)`, () => {
      assert.ok(Math.abs(n.mean / want - 1) < 0.05, 'mean ' + n.mean / want);
    });
  }
}
console.log('# sun energy, relative peak to peak over 120 frames (old -> new): ' + rows.map((r) => `${r.tag} ${r.mode} ${(100 * r.oldP2P).toFixed(1)} % -> ${(100 * r.newP2P).toFixed(2)} %`).join('; '));

check('common.wgsl viewRay uses the view rotation, not the near plane minus the camera', () => {
  const common = readFileSync(join(page, 'shaders/common.wgsl'), 'utf8');
  const m = /fn viewRay\(uv: vec2f\) -> vec3f \{([\s\S]*?)\n\}/.exec(common);
  assert.ok(m && /G\.view\[0\]/.test(m[1]) && !/worldFromDepth/.test(m[1]), m ? m[1] : 'no viewRay');
});
check('sky.wgsl sk_sunDisc: atan2 angle, the minimum radius, the energy factor', () => {
  const sky = readFileSync(join(page, 'shaders/sky.wgsl'), 'utf8');
  const m = /fn sk_sunDisc\(d[\s\S]*?\n\}/.exec(sky)[0];
  assert.ok(/atan2\(length\(cross\(d, s\)\), dot\(d, s\)\)/.test(m) && /SUN_MIN_PX \* px/.test(m) && /\(r \* r\) \/ \(re \* re\)/.test(m) && !/acos/.test(m));
});
console.log(`sunflicker: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

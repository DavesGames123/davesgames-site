// ============================================================================
//  DLA TERRAIN  ·  tests/fog.test.mjs — the near-ground fog is still on a
//  still camera, and it lies on the ground (node, JS twins, no GPU)
//  Run: node stella-nova/pages/dla-terrain/tests/fog.test.mjs
// ----------------------------------------------------------------------------
//  Why (2026-10-18, the user): "the geometry of the near-ground fog is
//  flickering considerably". The froxel inject (shaders/weather.wgsl) read
//  the medium at one jittered point per froxel: a thin ground layer in a
//  slice of tens of m gave a new value each frame, points inside a hill
//  took the full ground density, and the history was read half a slice
//  off. The new inject takes the mean medium of the slice segment
//  (vol_mediumSeg; render/weather.js volMediumSegJS is the twin), no
//  medium under the ground, and the history at the froxel centre.
//  The check runs the froxel pipeline (inject with the 0.88 history,
//  integrate, apply at the pixel depth) in JS on a still camera 25 m over
//  rolling ground, 90 frames, old and new. The light is a low sun with
//  the ground's own shadow (a point under the ground is dark) at the
//  jittered light point, plus a sky part. Metric: the mean temporal
//  standard deviation of the fog in-scatter per pixel (frames 30 to 89)
//  over the mean in-scatter. The new one must be FLICKER_FACTOR times
//  lower. Also: no medium under the ground, the valley fog pools in a
//  synthetic valley and not on the ridge, and the WGSL has the pieces.
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { volMediumSegJS, volAvgExp, HAZE_DEEP_MAX } from '../render/weather.js';

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, '..');
let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   fog: ' + name); }
  catch (e) { fail++; console.log('  FAIL fog: ' + name + '\n       ' + (e && e.message)); }
}
const FLICKER_FACTOR = 5;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const ss = (e0, e1, x) => { const u = clamp((x - e0) / (e1 - e0), 0, 1); return u * u * (3 - 2 * u); };
const fract = (x) => x - Math.floor(x);
const ign = (x, y) => fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y));

// the ground: rolling hills on a slope, a valley along z
const ground = (x, z) => 60 * Math.sin(x / 300) * Math.cos(z / 420) + 0.06 * z + 25 * Math.cos(x / 90 + z / 130);
const O = { sea: -200, haze: 4e-4, valleyK: 0.0026, top: 40, bank: 0.6 };

// the old vol_medium at one point (the same terms as volMediumSegJS)
function mediumOld(p) {
  const r = [5.8e-3, 13.5e-3, 33.1e-3, 8], mi = [3.996e-3, 1.2];
  const hSea = Math.max(p[1] - O.sea, 0), hKm = hSea * 0.001;
  const sR = r.slice(0, 3).map((v) => v * 0.001 * Math.exp(-hKm / r[3]));
  const sM = mi[0] * 0.001 * Math.exp(-hKm / mi[1]);
  const hG = Math.max(p[1] - ground(p[0], p[2]), 0);
  const deep = Math.min(O.haze, HAZE_DEEP_MAX);
  const haze = (O.haze * 0.45 * Math.exp(-hG / 140) + deep * 0.55 * Math.exp(-hSea / 1700)) * (0.55 + 0.6 * O.bank);
  const valley = O.valleyK * ss(O.top + 20, O.top - 60, p[1]) * (0.5 + 0.8 * O.bank) * ss(-2, 6, hG);
  const sF = haze + valley;
  return sR[0] * 0.2126 + sR[1] * 0.7152 + sR[2] * 0.0722 + sM * 1.11 + sF;
}

// the sun shadow of the ground: a point under the ground is dark, and a
// short march toward a low sun (12 deg) finds the hills in front of it
const SUN = (() => { const e = 0.21, a = 2.4; return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)]; })();
function sunVis(p) {
  if (p[1] < ground(p[0], p[2])) return 0;
  let t = 4;
  for (let i = 0; i < 10; i++) {
    const q = [p[0] + SUN[0] * t, p[1] + SUN[1] * t, p[2] + SUN[2] * t];
    if (q[1] < ground(q[0], q[2])) return 0;
    t *= 1.8;
  }
  return 1;
}

// the camera and the froxel grid
const GX = 64, GY = 36, GZ = 64, NEAR = 1, FAR = 24000;
const sliceDist = (s) => NEAR * Math.pow(FAR / NEAR, s / GZ);
const distSlice = (d) => Math.log(Math.max(d, NEAR) / NEAR) / Math.log(FAR / NEAR) * GZ;
const cam = [40, ground(40, 0) + 25, 0];
const fov = 50 * Math.PI / 180, asp = 16 / 9, tY = Math.tan(fov / 2), pitch = -0.1;
function ray(u, v) {
  const x = (u * 2 - 1) * tY * asp, y = (1 - v * 2) * tY;
  // forward +z, pitched down
  const c = Math.cos(pitch), s = Math.sin(pitch);
  const d = [x, y * c + s, -y * s + c];
  const l = Math.hypot(...d);
  return d.map((q) => q / l);
}
// the pixels: their ground distance (a fine ray march, once)
const PW = 192, PH = 108;
const pix = [];
for (let j = 0; j < PH; j++) for (let i = 0; i < PW; i++) {
  const u = (i + 0.5) / PW, v = (j + 0.5) / PH, d = ray(u, v);
  let t = 0.5, hit = -1;
  for (let k = 0; k < 4000 && t < 20000; k++) {
    const p = [cam[0] + d[0] * t, cam[1] + d[1] * t, cam[2] + d[2] * t];
    if (p[1] < ground(p[0], p[2])) { hit = t; break; }
    t += Math.max(0.5, t * 0.01);
  }
  pix.push({ u, v, dist: hit });
}

function run(mode) {
  const N = GX * GY * GZ;
  let hist = new Float32Array(N * 2), cur = new Float32Array(N * 2);
  const vol = new Float32Array(N * 2);
  const rays = [];
  for (let y = 0; y < GY; y++) for (let x = 0; x < GX; x++) rays.push(ray((x + 0.5) / GX, (y + 0.5) / GY));
  const series = pix.map(() => []);
  for (let fr = 0; fr < 90; fr++) {
    const jit = (fr * 0.618034) % 1;
    for (let y = 0; y < GY; y++) for (let x = 0; x < GX; x++) {
      const rd = rays[y * GX + x];
      for (let z = 0; z < GZ; z++) {
        const jz = fract(jit + 0.25 * ign(x + z * 3.1, y));
        let ext, hz, lightD = 0;
        if (mode === 'old') {
          const d = sliceDist(z + jz);
          ext = mediumOld([cam[0] + rd[0] * d, cam[1] + rd[1] * d, cam[2] + rd[2] * d]);
          hz = z + jz - 0.5;   // the history read at the jittered point
        } else {
          const d0 = sliceDist(z), d1 = sliceDist(z + 1);
          const p0 = [cam[0] + rd[0] * d0, cam[1] + rd[1] * d0, cam[2] + rd[2] * d0];
          const p1 = [cam[0] + rd[0] * d1, cam[1] + rd[1] * d1, cam[2] + rd[2] * d1];
          const m = volMediumSegJS(p0, p1, ground(p0[0], p0[2]), ground(p1[0], p1[2]), O);
          ext = m.ext;
          // the light point: jittered inside the part over the ground
          lightD = d0 + (d1 - d0) * (m.ua + (m.ub - m.ua) * jz);
          hz = z;              // the froxel centre
        }
        // in-scatter: the sun (visibility at the light point, as the
        // WGSL sunShadow there) plus a sky part
        const dl = mode === 'old' ? sliceDist(z + jz) : lightD;
        const pl = [cam[0] + rd[0] * dl, cam[1] + rd[1] * dl, cam[2] + rd[2] * dl];
        let ls = ext * (0.3 + sunVis(pl)), ex = ext;
        const k = (y * GX + x) * GZ + z;
        if (fr > 0) {
          const z0 = clamp(Math.floor(hz), 0, GZ - 1), z1 = clamp(z0 + 1, 0, GZ - 1), f = clamp(hz - Math.floor(hz), 0, 1);
          const b0 = (y * GX + x) * GZ;
          const hl = hist[(b0 + z0) * 2] * (1 - f) + hist[(b0 + z1) * 2] * f;
          const he = hist[(b0 + z0) * 2 + 1] * (1 - f) + hist[(b0 + z1) * 2 + 1] * f;
          ls = ls + (hl - ls) * 0.88; ex = ex + (he - ex) * 0.88;
        }
        cur[k * 2] = ls; cur[k * 2 + 1] = ex;
      }
      // integrate
      let L = 0, T = 1, dPrev = 0;
      for (let z = 0; z < GZ; z++) {
        const k = (y * GX + x) * GZ + z;
        const v = cur[k * 2], e = Math.max(cur[k * 2 + 1], 1e-9);
        const dEnd = sliceDist(z + 1), dt = dEnd - dPrev; dPrev = dEnd;
        const Ts = Math.exp(-e * dt);
        L += T * (v - v * Ts) / e; T *= Ts;
        vol[k * 2] = L; vol[k * 2 + 1] = T;
      }
    }
    [hist, cur] = [cur, hist];
    // apply at the pixels (bilinear in xy, linear in z)
    for (let q = 0; q < pix.length; q++) {
      const P = pix[q];
      if (P.dist < 0) continue;
      const zt = clamp(distSlice(P.dist) - 1, 0, GZ - 1);
      const fx = clamp(P.u * GX - 0.5, 0, GX - 1), fy = clamp(P.v * GY - 0.5, 0, GY - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(zt);
      let L = 0;
      for (const [xx, wx] of [[x0, 1 - (fx - x0)], [Math.min(x0 + 1, GX - 1), fx - x0]])
        for (const [yy, wy] of [[y0, 1 - (fy - y0)], [Math.min(y0 + 1, GY - 1), fy - y0]])
          for (const [zz, wz] of [[z0, 1 - (zt - z0)], [Math.min(z0 + 1, GZ - 1), zt - z0]])
            L += vol[((yy * GX + xx) * GZ + zz) * 2] * wx * wy * wz;
      series[q].push(L);
    }
  }
  let sd = 0, mean = 0, n = 0, worst = 0;
  for (const s of series) {
    if (!s.length) continue;
    const w = s.slice(30);
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    const v = w.reduce((a, b) => a + (b - m) * (b - m), 0) / w.length;
    sd += Math.sqrt(v); mean += m; n++;
    worst = Math.max(worst, Math.sqrt(v) / Math.max(m, 1e-9));
  }
  return { metric: sd / Math.max(mean, 1e-12), worst, mean: mean / n };
}

const old = run('old'), neu = run('new');
console.log(`# fog temporal metric (mean per-pixel sd / mean in-scatter, 60 frames, still camera): old ${old.metric.toExponential(3)} -> new ${neu.metric.toExponential(3)} (x ${(old.metric / Math.max(neu.metric, 1e-12)).toFixed(1)} lower); worst pixel ${(100 * old.worst).toFixed(2)} % -> ${(100 * neu.worst).toFixed(2)} %; mean in-scatter ${old.mean.toFixed(4)} -> ${neu.mean.toFixed(4)}`);
check(`the fog flicker metric drops by ${FLICKER_FACTOR} x or more (${(old.metric / Math.max(neu.metric, 1e-12)).toFixed(1)} x)`, () => {
  assert.ok(old.metric / Math.max(neu.metric, 1e-12) >= FLICKER_FACTOR, `${old.metric} -> ${neu.metric}`);
});
check('the mean fog stays within 35 % of the old mean (the same medium, no medium inside hills)', () => {
  assert.ok(Math.abs(neu.mean / old.mean - 1) < 0.35, `${old.mean} -> ${neu.mean}`);
});
check('vol_avgExp: the closed form equals a fine sum', () => {
  for (const [a, b, H] of [[0, 300, 140], [50, 5, 140], [10, 10.01, 140], [0, 2000, 1700]]) {
    let s = 0; const n = 20000;
    for (let i = 0; i < n; i++) s += Math.exp(-(a + (b - a) * (i + 0.5) / n) / H);
    assert.ok(Math.abs(volAvgExp(a, b, H) / (s / n) - 1) < 1e-4, `${a} ${b} ${H}`);
  }
});
check('no medium under the ground; the share over the ground for a crossing slice', () => {
  const m0 = volMediumSegJS([0, 10, 0], [0, 12, 10], 20, 30, O);
  assert.equal(m0.ext, 0);
  const m1 = volMediumSegJS([0, 30, 0], [0, 10, 10], 20, 20, O);
  assert.ok(Math.abs(m1.ub - 0.5) < 1e-9 && m1.ua === 0 && m1.ext > 0);
});
check('the valley fog pools in a synthetic valley (floor 0 m, top 40 m) and not on a ridge at 300 m', () => {
  const seg = (y, g) => volMediumSegJS([0, y, 0], [5, y, 0], g, g, { ...O, haze: 0 });
  const floor = seg(5, 0).sF, mid = seg(30, 0).sF, ridge = seg(305, 300).sF;
  assert.ok(floor > 1e-3 && mid > 0 && ridge === 0 && floor > mid, `floor ${floor} mid ${mid} ridge ${ridge}`);
});
check('weather.wgsl: the inject takes the slice mean, two ground reads, the history at the centre', () => {
  const w = readFileSync(join(page, 'shaders/weather.wgsl'), 'utf8');
  const inj = /fn csFroxInject\([\s\S]*?\n\}/.exec(w)[0];
  assert.ok(/vol_mediumSeg\(p0, p1, terrainHeight\(p0\.xz\), terrainHeight\(p1\.xz\)\)/.test(inj), 'vol_mediumSeg');
  assert.ok(/let pcen = G\.camPos\.xyz \+ rd \* vol_sliceDist\(f32\(id\.z\) \+ 0\.5\)/.test(inj), 'history at the centre');
  assert.ok(!/vol_medium\(p\)/.test(w), 'the old point medium is gone');
  assert.ok(/fn vol_avgExp/.test(w) && /for \(var k = 0; k < 3; k\+\+\)/.test(w), 'closed form and a constant 3-point loop');
});
console.log(`fog: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

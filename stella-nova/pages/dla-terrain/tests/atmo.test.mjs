// ============================================================================
//  DLA TERRAIN  ·  tests/atmo.test.mjs — the sky maths of the SKY package
//  (node only, no GPU, no browser).
//  Run: node pages/dla-terrain/tests/atmo.test.mjs
// ----------------------------------------------------------------------------
//  1 LUT maths: the transmittance LUT mapping (transUV, uvTrans: JS twins
//    of sk_transUV and sk_uvTrans) goes there and back; the sky-view LUT
//    puts the horizon at v = 0.5, the zenith at 0, the nadir at 1; the
//    WGSL text of the two mappings has the same formulas as the twins.
//  2 the sun disc: 0.533 deg across (SUN_RADIUS), the radiance x the solid
//    angle is SUN_DISC_K x the irradiance (limb law 1 - 0.6 (1 - mu)), the
//    peak fits in fp16, and the WGSL uses S.sun.x and the same constant.
//  3 the exposure: exposureStep (twin of fs_expo) stays in [minExp, maxExp]
//    and adapts slowly (an eye, not a light switch).
//  4 the loop caps of the clouds: CL_STEPS_MAX and CL_LIGHT_MAX are WGSL
//    constants, the march steps of every quality and profile are under them.
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SUN_RADIUS, SUN_ILLUM, ATMO } from '../sky-state.js';
import { transUV, uvTrans, skyViewV, sunDiscRadiance, SUN_DISC_K, cloudSteps, CLOUD_STEPS_MAX, lutSizes } from '../render/sky.js';
import { exposureStep, POST_DEFAULTS } from '../render/post.js';
import { PROFILES } from '../gpu/budget.js';

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, '..');
const sky = readFileSync(join(page, 'shaders/sky.wgsl'), 'utf8');
const clouds = readFileSync(join(page, 'shaders/clouds.wgsl'), 'utf8');
const post = readFileSync(join(page, 'shaders/post.wgsl'), 'utf8');
let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   atmo: ' + name); }
  catch (e) { fail++; console.log('  FAIL atmo: ' + name + '\n       ' + (e && e.message)); }
}
const fnBody = (src, name) => { const i = src.indexOf('fn ' + name + '('); assert.ok(i >= 0, 'no fn ' + name); return src.slice(i, src.indexOf('\n}', i)); };

// ── 1 LUT maths
check('transmittance LUT: uv -> (r, mu) -> uv round trip within 1e-6', () => {
  let worst = 0;
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
    const u = i / 20, v = 0.01 + 0.98 * j / 20;
    const [r, mu] = uvTrans(u, v);
    const [u2, v2] = transUV(r, mu);
    worst = Math.max(worst, Math.abs(u2 - u), Math.abs(v2 - v));
  }
  assert.ok(worst < 1e-6, 'worst ' + worst);
});
check('transmittance LUT: the ground (v 0) and the top (v 1) rows', () => {
  assert.ok(Math.abs(uvTrans(0.5, 0)[0] - ATMO.bottom) < 1e-9);
  assert.ok(Math.abs(uvTrans(0.5, 1)[0] - ATMO.top) < 1e-9);
  // u 0 looks straight up (mu 1)
  assert.ok(Math.abs(uvTrans(0, 0.3)[1] - 1) < 1e-9);
});
check('sky-view LUT: zenith v 0, horizon v 0.5, nadir v 1', () => {
  const r = ATMO.bottom + 0.002;
  assert.ok(Math.abs(skyViewV(r, 1)) < 1e-6);
  const vh = Math.sqrt(r * r - ATMO.bottom * ATMO.bottom), horizon = -vh / r;   // cos of the zenith angle of the horizon
  assert.ok(Math.abs(skyViewV(r, horizon) - 0.5) < 1e-6, 'horizon ' + skyViewV(r, horizon));
  assert.ok(Math.abs(skyViewV(r, -1) - 1) < 1e-6);
  // dense at the horizon: half of the v range is in the 2 deg over it
  assert.ok(skyViewV(r, Math.sin(2 * Math.PI / 180)) > 0.38, 'v at 2 deg up ' + skyViewV(r, Math.sin(2 * Math.PI / 180)));
});
check('the WGSL mappings have the formulas of the twins', () => {
  const t = fnBody(sky, 'sk_transUV');
  for (const k of ['r * r * (mu * mu - 1.0) + top * top', '-r * mu + sqrt', 'rho + H', 'top - r']) assert.ok(t.includes(k), 'sk_transUV: ' + k);
  const v = fnBody(sky, 'sk_skyViewUV');
  for (const k of ['SK_PI - beta', '1.0 - sqrt(max(1.0 - c, 0.0))', 'c * 0.5 + 0.5', 'sqrt(clamp(0.5 - 0.5 * cosAz']) assert.ok(v.includes(k), 'sk_skyViewUV: ' + k);
});
check('LUT sizes: smaller on a phone profile, multi 32 x 32 everywhere', () => {
  const d = lutSizes(PROFILES.desktop), p = lutSizes(PROFILES.phone), m = lutSizes(PROFILES['phone-min']);
  assert.deepEqual(d, { trans: [256, 64], multi: [32, 32], view: [192, 108] });
  for (const x of [p, m]) {
    assert.ok(x.trans[0] * x.trans[1] < d.trans[0] * d.trans[1] && x.view[0] * x.view[1] < d.view[0] * d.view[1]);
    assert.ok(x.trans[0] % 8 === 0 && x.trans[1] % 8 === 0, 'trans size is whole workgroups');
  }
});

// ── 2 the sun disc
check('the sun disc is 0.533 deg across', () => {
  const across = 2 * SUN_RADIUS * 180 / Math.PI;
  assert.ok(Math.abs(across - 0.533) < 0.002, across.toFixed(4));
  assert.ok(/fn sk_sunDisc[\s\S]*?let r = S\.sun\.x;/.test(sky), 'sk_sunDisc reads S.sun.x');
  assert.ok(new RegExp('const SUN_DISC_K: f32 = ' + SUN_DISC_K.toFixed(1).replace('.', '\\.') + ';').test(sky), 'WGSL SUN_DISC_K = ' + SUN_DISC_K);
});
check('the disc radiance x solid angle = SUN_DISC_K x the irradiance (limb darkened)', () => {
  // integrate over the disc in rings
  let sum = 0;
  const N = 4000, r = SUN_RADIUS;
  for (let i = 0; i < N; i++) {
    const a = (i + 0.5) / N * r;
    sum += sunDiscRadiance(a, SUN_ILLUM) * 2 * Math.PI * Math.sin(a) * (r / N);
  }
  const want = SUN_DISC_K * SUN_ILLUM;
  assert.ok(Math.abs(sum / want - 1) < 0.01, `${sum} vs ${want}`);
  // limb: the edge is 40 % of the centre
  assert.ok(Math.abs(sunDiscRadiance(r * 0.999999, 1) / sunDiscRadiance(0, 1) - 0.4) < 0.01);
});
check('the sun disc peak fits in fp16 (65504) and is far over the sky', () => {
  const peak = sunDiscRadiance(0, SUN_ILLUM);
  assert.ok(peak < 65504 && peak > 1e4, 'peak ' + peak.toFixed(0));
});

// ── 3 the exposure
check('exposure: always inside [minExp, maxExp]', () => {
  const s = POST_DEFAULTS;
  let e = 0;
  for (const avg of [-30, -12, -4, 0, 4, 12, 30]) {
    e = exposureStep(0, avg, 1 / 60, s);
    assert.ok(e >= s.minExp - 1e-12 && e <= s.maxExp + 1e-12, `avg ${avg}: ${e}`);
    for (let i = 0; i < 600; i++) e = exposureStep(e, -avg, 1 / 60, s);
    assert.ok(e >= s.minExp - 1e-12 && e <= s.maxExp + 1e-12, `adapted from ${avg}: ${e}`);
  }
  // CORE's per-frame cap (maxExp from skyState().exposureHint) also holds
  const night = { ...s, maxExp: 3 };
  assert.ok(exposureStep(0, -16, 1 / 60, night) <= 3);
  assert.ok(post.includes('clamp(P.p0.z / exp2(avg), P.p2.z, P.p2.w)'), 'fs_expo clamps to the uniform limits');
});
check('exposure: slow adaptation (a 10 x brighter scene: under 80 % of the way after 1 s, over 95 % after 6 s)', () => {
  const s = POST_DEFAULTS, avg0 = Math.log2(0.5), avg1 = avg0 + Math.log2(10);
  const e0 = exposureStep(0, avg0, 1, s), eT = exposureStep(0, avg1, 1, s);
  let e = e0;
  const frac = () => Math.log(e / e0) / Math.log(eT / e0);
  for (let i = 0; i < 60; i++) e = exposureStep(e, avg1, 1 / 60, s);
  assert.ok(frac() < 0.8, '1 s: ' + frac().toFixed(3));
  for (let i = 0; i < 300; i++) e = exposureStep(e, avg1, 1 / 60, s);
  assert.ok(frac() > 0.95, '6 s: ' + frac().toFixed(3));
  // frame-rate independent
  let a = e0, b = e0;
  for (let i = 0; i < 30; i++) a = exposureStep(a, avg1, 1 / 30, s);
  for (let i = 0; i < 144; i++) b = exposureStep(b, avg1, 1 / 144, s);
  assert.ok(Math.abs(Math.log(a / b)) < 1e-9, `${a} vs ${b}`);
});
check('bloom: the soft clamp works in exposed units (BLOOM_KNEE), not at a fixed 60', () => {
  assert.ok(/const BLOOM_KNEE: f32 = \d+/.test(post) && post.includes('cm_luminance(o) * P.p6.y'), 'fs_bdown uses the exposure');
  assert.ok(!post.includes('cm_luminance(o) - 60.0'), 'the old fixed clamp is gone');
});

// ── 4 loop caps of the clouds
check('cloud loop caps: WGSL constants, and every step plan is under them', () => {
  const m = /const CL_STEPS_MAX: i32 = (\d+);/.exec(clouds), l = /const CL_LIGHT_MAX: i32 = (\d+);/.exec(clouds);
  assert.ok(m && +m[1] === CLOUD_STEPS_MAX, 'CL_STEPS_MAX = CLOUD_STEPS_MAX');
  assert.ok(l && +l[1] <= 8, 'CL_LIGHT_MAX');
  assert.ok(/for \(var i = 0; i < CL_STEPS_MAX; i\+\+\)/.test(clouds) && /for \(var i = 0; i < CL_LIGHT_MAX; i\+\+\)/.test(clouds), 'the loops compare with the constants');
  for (const p of [null, ...Object.values(PROFILES)]) for (let q = 0; q <= 1.0001; q += 0.05) {
    const n = cloudSteps(q, p);
    assert.ok(n >= 8 && n <= CLOUD_STEPS_MAX, `${p && p.id} q ${q}: ${n}`);
    if (p && p.cloudNoise) assert.ok(n <= 56, `phone ${p.id}: ${n}`);
  }
});

console.log(`atmo: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

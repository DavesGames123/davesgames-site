// ============================================================================
//  DLA TERRAIN  ·  tests/night.test.mjs — a night that reads as night
//  (node, the sky state and the post twins, no GPU)
//  Run: node stella-nova/pages/dla-terrain/tests/night.test.mjs
// ----------------------------------------------------------------------------
//  Why (2026-10-18, the user): "make nighttime actually make sense". The
//  exposure hint of sky-state.js let the auto exposure lift a moonlit night
//  to about half of the day brightness. The checks:
//    1 the exposed scene luminance before the tone map (a grey ground under
//      the ambient, the sun and the moon, the auto exposure of
//      render/post.js exposureStep with the main.js cap from the hint) at
//      noon, at midnight with a full moon and with a new moon: the day is
//      DAY_OVER_FULL x the full moon or more, DAY_OVER_NEW x the new moon
//      or more, and the full moon is brighter than the new moon
//    2 no sun at night: with the sun under the horizon the sun colour, the
//      sun part of the ambient (ground bounce) and the sun scale are 0
//    3 nightLights (CELESTIAL's light list): lights[0] is the moon of the
//      globals, an eclipse dims the sun, a gas giant night is brighter
//    4 the scotopic shift (render/post.js scotopicMix, the twin of
//      post.wgsl fs_composite): none by day, grey and a little blue at a
//      night exposure
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as SS from '../sky-state.js';
import * as PP from '../render/post.js';

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, '..');
let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   night: ' + name); }
  catch (e) { fail++; console.log('  FAIL night: ' + name + '\n       ' + (e && e.message)); }
}
const DAY_OVER_FULL = 6, DAY_OVER_NEW = 25;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// the exposed luminance of a grey ground (albedo 0.18, normal up)
function exposed(s) {
  const E = lum(s.ambient) + lum(s.sunColor) * Math.max(s.sunDir[1], 0) + s.moonScale * 0.62 * Math.max(s.moonDir[1], 0);
  const L = 0.18 * E / Math.PI;
  const day = clamp((s.sunDir[1] + 0.05) / 0.15, 0, 1);
  const maxExp = clamp(s.exposureHint * (1.5 + 4.5 * day), 0.05, 40);   // main.js
  const set = { ...PP.POST_DEFAULTS, maxExp };
  let e = 0;
  for (let i = 0; i < 600; i++) e = PP.exposureStep(e, Math.log2(L), 1 / 30, set);
  return { L, e, out: e * L };
}
// the seasons with a new and a full moon high at midnight
let sNew = 0, sFull = 0, bNew = 9, bFull = -9;
for (let k = 0; k < 2000; k++) {
  const season = k / 2000, m = SS.moonPosition(0, season, 46);
  if (m.lit < bNew) { bNew = m.lit; sNew = season; }
  if (m.dir[1] > 0.4 && m.lit > bFull) { bFull = m.lit; sFull = season; }
}
const at = (tod, season) => SS.skyState(tod, 'clear', season, 46, 100);
const noon = exposed(at(0.5, sFull)), full = exposed(at(0, sFull)), nw = exposed(at(0, sNew));

check(`1 the night stays night: day / full moon >= ${DAY_OVER_FULL}, day / new moon >= ${DAY_OVER_NEW}, full > new`, () => {
  console.log(`# exposed ground luminance: noon ${noon.out.toFixed(4)} (exposure ${noon.e.toFixed(2)}), full moon ${full.out.toFixed(4)} (exposure ${full.e.toFixed(2)}, lit ${bFull.toFixed(2)}), new moon ${nw.out.toFixed(5)} (exposure ${nw.e.toFixed(2)}); day / full ${(noon.out / full.out).toFixed(1)}, day / new ${(noon.out / nw.out).toFixed(1)}`);
  assert.ok(noon.out / full.out >= DAY_OVER_FULL, 'day / full ' + (noon.out / full.out));
  assert.ok(noon.out / nw.out >= DAY_OVER_NEW, 'day / new ' + (noon.out / nw.out));
  assert.ok(full.out > nw.out * 1.5, 'full ' + full.out + ' new ' + nw.out);
});
check('2 no sun term with the sun under the horizon', () => {
  for (const tod of [0, 0.1, 0.9, 0.95]) {
    const s = at(tod, sFull);
    if (s.sunDir[1] > -0.02) continue;
    assert.ok(lum(s.sunColor) === 0 && s.sunScale >= 0, `tod ${tod}: sun colour ${s.sunColor}`);
  }
  const clouds = readFileSync(join(page, 'shaders/clouds.wgsl'), 'utf8');
  assert.ok(/let sunUp = sk_ss\(-0\.12, -0\.02, G\.sunDir\.y\);/.test(clouds) && /l\.dir = S\.moon\.xyz;/.test(clouds), 'the clouds take the moon');
  const w = readFileSync(join(page, 'shaders/weather.wgsl'), 'utf8');
  assert.ok(/let lit = sk_ss\(-0\.04, 0\.03, G\.sunDir\.y\);/.test(w), 'the shafts fade out with the sun');
});
check('3 nightLights: the brightest light is the globals moon, an eclipse dims the sun, a giant night is brighter', () => {
  assert.ok(typeof SS.nightLights === 'function', 'sky-state.js nightLights');
  const s = at(0, sNew);
  const moon = { id: 'm1', kind: 'moon', dir: [0.3, 0.8, 0.2], irradiance: 0.06, color: [1, 1, 1], phase: 1 };
  const giant = { id: 'g', kind: 'giant', dir: [-0.4, 0.6, 0.1], irradiance: 0.5, color: [1.1, 0.95, 0.8], phase: 0.8 };
  const a = SS.nightLights(s, { lights: [moon], eclipse: 0 });
  assert.ok(a.moonDir[1] > 0.7 && Math.abs(a.moonScale - 0.06) < 0.02, 'moon ' + a.moonScale);
  const b = SS.nightLights(s, { lights: [giant, moon], eclipse: 0 });
  assert.ok(lum(b.ambient) > lum(a.ambient) && b.moonDir[1] > 0.5, 'giant night');
  assert.ok(exposed(b).out > exposed(a).out && noon.out / exposed(b).out >= 3, 'a giant night is brighter, still under the day');
  const d = at(0.5, sFull), e = SS.nightLights(d, { lights: [], eclipse: 0.6 });
  assert.ok(Math.abs(lum(e.sunColor) / lum(d.sunColor) - 0.4) < 1e-6, 'eclipse');
  const none = SS.nightLights(s, null);
  assert.equal(none, s, 'no celestial: the state as it is');
});
check('4 the scotopic shift: none by day, grey and a little blue at night', () => {
  assert.ok(typeof PP.scotopicMix === 'function', 'render/post.js scotopicMix');
  const c = [0.3, 0.12, 0.05];
  const dayC = PP.scotopicMix(c, noon.e), nightC = PP.scotopicMix(c, 12);
  assert.deepEqual(dayC.map((v) => +v.toFixed(6)), c);
  const sat = (q) => (Math.max(...q) - Math.min(...q)) / Math.max(...q);
  assert.ok(sat(nightC) < sat(c) * 0.5 && nightC[2] > nightC[0] * 0.7, JSON.stringify(nightC));
  const post = readFileSync(join(page, 'shaders/post.wgsl'), 'utf8');
  assert.ok(/fn scotopic\(/.test(post) && /c = scotopic\(c, ke0\);/.test(post), 'fs_composite applies it');
});
console.log(`night: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

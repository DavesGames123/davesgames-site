// ============================================================================
//  DLA TERRAIN  ·  tests/nearfield.test.mjs — the near field (package NEAR)
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/dla-terrain/tests/nearfield.test.mjs
//  (tests.mjs also runs every file in tests/). Exit code 1 on a fail.
//    SHADOWS   gpu/shadows.js: the near-field split scheme, the texel of
//              cascade 0, texel snap under camera moves and turns, a
//              stable radius under small field of view changes, the bias
//              and the packed CascadeInfo, the PCSS loop caps.
//  grep -n targets: "── shadows"
// ============================================================================
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nearSplits, computeCascades, stableRadius, FIRST_SPLIT, ONE_CASCADE } from '../gpu/shadows.js';
import { packCascades, CASCADE_FLOATS } from '../gpu/globals.js';
import { project } from '../gpu/mat.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0, passes = 0;
function check(name, ok, info = '') {
  if (ok) { passes++; console.log('  ok   ' + name + (info ? '  (' + info + ')' : '')); }
  else { fails++; console.log('  FAIL ' + name + (info ? '  (' + info + ')' : '')); }
}
const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };

// ── shadows
{
  for (const [far, count] of [[2500, 3], [5000, 3], [9000, 4], [14000, 4], [2500, 2]]) {
    const s = nearSplits(far, count);
    const rising = s.every((v, i) => i === 0 || v > s[i - 1]);
    check(`splits rise to far (${count} cascades, ${far} m)`, rising && s.length === count && Math.abs(s[count - 1] - far) < 1e-6, s.map((v) => v.toFixed(1)).join(' '));
    check(`cascade 0 is the near field (${count}, ${far} m)`, Math.abs(s[0] - FIRST_SPLIT[count]) < 1e-6, s[0].toFixed(1) + ' m');
  }
  check('one cascade covers the near field only', nearSplits(9000, 1)[0] === ONE_CASCADE && nearSplits(150, 1)[0] === 150);

  const sun = norm([0.4, 0.35, -0.69]);
  const bounds = { min: [-10000, -50, -10000], max: [10000, 3600, 10000] };
  const cam = { pos: [120, 540, -300], forward: norm([0.7, -0.05, -0.7]), fovY: 1.0, aspect: 16 / 9, near: 0.1 };
  for (const size of [2048, 4096]) {
    const c = computeCascades(cam, sun, { count: 4, size, far: 9000, bounds });
    check(`cascade 0 texel at ${size} is under 2 cm`, c.texel[0] < 0.02, (c.texel[0] * 100).toFixed(2) + ' cm');
    check(`cascade 1 texel at ${size} is under 16 cm`, c.texel[1] < 0.16, (c.texel[1] * 100).toFixed(2) + ' cm');
  }
  const opt = { count: 4, size: 2048, far: 9000, bounds };
  const base = computeCascades(cam, sun, opt);
  // texel snap: a world point keeps its sub-texel position under camera
  // moves (translation) and turns (yaw, pitch); only whole texels change
  const P = [140, 535, -320];
  let worst = 0, radiiSame = true;
  for (let k = 0; k < 60; k++) {
    const a = k * 0.37, m = 0.013 * k;
    const fw = norm([Math.sin(0.78 + a * 0.05), -0.05 + 0.01 * Math.sin(a), -Math.cos(0.78 + a * 0.05)]);
    const c2 = computeCascades({ ...cam, pos: [cam.pos[0] + m * 3.1, cam.pos[1] + m, cam.pos[2] - m * 1.7], forward: fw }, sun, opt);
    for (let i = 0; i < 4; i++) {
      if (c2.radii[i] !== base.radii[i]) radiiSame = false;
      const q1 = project(base.mats[i], P), q2 = project(c2.mats[i], P);
      for (const ax of [0, 1]) {
        const d = (q1[ax] - q2[ax]) * size2(opt.size);
        worst = Math.max(worst, Math.abs(d - Math.round(d)));
      }
    }
  }
  function size2(s) { return s / 2; }
  check('a world point keeps its sub-texel place in every cascade (60 moves and turns)', worst < 2e-3, 'worst ' + worst.toExponential(2) + ' texel');
  check('the cascade radii do not change when the camera moves or turns', radiiSame);
  let fovSteps = 0;
  for (let k = 0; k < 40; k++) {
    const a = computeCascades({ ...cam, fovY: 0.9 + k * 0.004 }, sun, opt), b = computeCascades({ ...cam, fovY: 0.9 + (k + 1) * 0.004 }, sun, opt);
    if (a.radii.some((r, i) => r !== b.radii[i])) fovSteps++;
  }
  check('small field of view changes seldom change a radius (stable steps)', fovSteps <= 16, fovSteps + ' of 40 steps of 0.004 rad');
  check('stableRadius rounds up in steps of 1/16 of the power of two', stableRadius(17.3) === 18 && stableRadius(16) === 16 && [3.3, 77, 1000, 15270].every((r) => stableRadius(r) >= r && stableRadius(r) <= r * 1.0625));
  // the bias: a few cm of clip depth, the receiver bias per cascade on the GPU
  check('constant depth bias is under 5 cm of the light box', base.depthBias * base.depthRange < 0.05, (base.depthBias * base.depthRange * 100).toFixed(1) + ' cm');
  const f = packCascades(new Float32Array(CASCADE_FLOATS), base);
  check('CascadeInfo packs depth range and sun size', CASCADE_FLOATS === 80 && Math.abs(f[76] - base.depthRange) < 1 && f[77] > 0.002 && f[77] < 0.05);
  check('the old practical split is still there on request', computeCascades(cam, sun, { ...opt, lambda: 0.82 }).splits[0] > 100);
  // PCSS: constant loop caps and parentheses (Tint) in common.wgsl
  const common = readFileSync(join(DIR, 'shaders/common.wgsl'), 'utf8');
  const soft = common.slice(common.indexOf('fn sunShadowSoftAt'), common.indexOf('fn sunShadowSoft('));
  check('PCSS loops have constant bounds', /i < SOFT_SEARCH/.test(soft) && /i < SOFT_TAPS/.test(soft) && /const SOFT_SEARCH: i32 = \d+;/.test(common) && /const SOFT_TAPS: i32 = \d+;/.test(common));
  check('PCSS early-out when no blocker', /if \(bN < 0\.5\) \{ return 1\.0; \}/.test(soft));
  const g = readFileSync(join(DIR, 'shaders/ground.wgsl'), 'utf8'), p = readFileSync(join(DIR, 'shaders/props.wgsl'), 'utf8');
  check('ground and plants use the soft shadow', /sunShadowSoft\(pW, nGeo/.test(g) && /sunShadowSoft\(wp, n, fc\)/.test(p));
}

console.log(`nearfield: ${passes} passed, ${fails} failed`);
if (fails) process.exit(1);

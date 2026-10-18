// tests/shafts.test.mjs — SKY light shafts: plan, uniforms, caps (node, no GPU).
// Run alone: node stella-nova/pages/dla-terrain/tests/shafts.test.mjs
// CORE's tests.mjs also runs it with every other file in tests/.
//
// What it checks: render/weather.js shaftPlan (the mode by user setting,
// quality, device profile and governor level; the step cap), shaftUniforms
// (golden hour mist over noon mist, the range cap, the history reset), the
// WGSL of the march (constant caps equal the JS caps, the froxel drops its
// near sun term, fsHaze reads binding 17), the draw layout of render/sky.js,
// the frame graph hook, the GPU memory model and the view panel controls.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shaftPlan, shaftUniforms, SHAFT_STEPS_MAX, SHAFT_RANGE_MAX, SHAFT_MODES } from '../render/weather.js';
import { PROFILES, estimate } from '../gpu/budget.js';

const here = p => fileURLToPath(new URL('../' + p, import.meta.url));
let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} shafts: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} shafts: ${name} ${extra}`); }
}

// ── plan
const D = PROFILES.desktop, P = PROFILES.phone, PM = PROFILES['phone-min'];
{
  const a = shaftPlan('auto', 1, D, 0);
  ok(a.mode === 1 && a.steps > 0 && a.steps <= SHAFT_STEPS_MAX && a.k === 0.5, `desktop Ultra auto: volumetric, ${a.steps} steps, half size`);
  const m = shaftPlan('auto', 0.5, D, 0);
  ok(m.mode === 1 && m.k === 0.25, 'desktop Medium auto: volumetric at quarter size');
  ok(shaftPlan('auto', 0.25, D, 0).mode === 2, 'desktop Low auto: the screen fallback');
  ok(shaftPlan('auto', 1, P, 0).mode === 2, 'phone auto: the screen fallback');
  ok(shaftPlan('volume', 1, P, 0).mode === 2, 'phone: a volumetric pick is capped to screen');
  ok(shaftPlan('auto', 1, PM, 0).mode === 0 && shaftPlan('screen', 1, PM, 0).mode === 0, 'low-memory phone: off');
  ok(shaftPlan('off', 1, D, 0).mode === 0, 'user off: off');
  ok(shaftPlan('volume', 0.25, D, 0).mode === 1, 'desktop Low, user volumetric: volumetric');
  ok(shaftPlan('auto', 1, D, 3).mode === 2 && shaftPlan('auto', 1, D, 5).mode === 0, 'governor level 3: screen, level 5: off');
  ok(shaftPlan('nonsense', 1, D, 0).mode === 1, 'an unknown setting reads as auto');
  let worst = 0;
  for (const q of [0, 0.25, 0.5, 0.75, 0.95, 1, 5]) for (const u of SHAFT_MODES) worst = Math.max(worst, shaftPlan(u, q, D, 0).steps);
  ok(worst <= SHAFT_STEPS_MAX, `steps never over the cap (${worst} <= ${SHAFT_STEPS_MAX})`);
}

// ── uniforms
{
  const plan = shaftPlan('auto', 1, D, 0);
  const gold = shaftUniforms(plan, { sunY: 0.08, k: 1, shadowDistance: 14000, frameIndex: 7, fullW: 1280, fullH: 800 });
  const noon = shaftUniforms(plan, { sunY: 0.9, k: 1, shadowDistance: 14000 });
  ok(gold.length === 16, 'ShaftU is 16 floats (4 vec4)');
  ok(gold[0] <= SHAFT_RANGE_MAX && gold[0] >= 500, `range capped: ${gold[0]} m (cascade far 14000)`);
  ok(gold[2] > noon[2] * 2.5, `golden hour mist ${gold[2].toExponential(2)} over 2.5 x noon ${noon[2].toExponential(2)}`);
  ok(gold[3] > noon[3], 'golden hour mist layer is deeper');
  ok(gold[11] > noon[11], 'the screen fallback is stronger at golden hour');
  const off = shaftUniforms(plan, { sunY: 0.08, k: 0 });
  ok(off[2] === 0, 'strength 0: no mist');
  const night = shaftUniforms(plan, { sunY: -0.3, k: 1 });
  ok(night[2] < gold[2] * 0.3, 'night: little mist');
  ok(shaftUniforms(plan, { reset: true })[12] === 0 && gold[12] > 0.5, 'a reset drops the history (weight 0)');
  ok(shaftUniforms(plan, { k: 99 })[2] <= shaftUniforms(plan, { k: 3 })[2] + 1e-12, 'strength capped at 3');
}

// ── WGSL and wiring
{
  const w = readFileSync(here('shaders/weather.wgsl'), 'utf8');
  const cap = /const SHAFT_MAX: i32 = (\d+);/.exec(w);
  ok(cap && +cap[1] === SHAFT_STEPS_MAX, 'weather.wgsl SHAFT_MAX = render/weather.js SHAFT_STEPS_MAX');
  ok(/const SHAFT_RADIAL: i32 = \d+;/.test(w) && /i < SHAFT_RADIAL/.test(w) && /i < SHAFT_MAX/.test(w), 'the march and the radial loops run to constants');
  ok(/let far = 1\.0 - shaftNear\(d\);/.test(w) && /sunAll \* \(vis \* far\)/.test(w), 'the froxel inject drops its near sun term (no light counted two times)');
  ok(/@group\(1\) @binding\(17\) var tShaft/.test(w) && /shaftAt\(ij, dz\)/.test(w), 'fsHaze reads the shaft target (binding 17)');
  ok(/fn shaftPhase[^\n]*sk_hg\(c, 0\.8\)/.test(w), 'the mist phase has a strong forward lobe (Henyey-Greenstein g 0.8)');
  const sky = readFileSync(here('render/sky.js'), 'utf8');
  ok(/tex\(17\)/.test(sky) && /\[17, vb\.shaftView\]/.test(sky) && /volumetricPrep\(enc, frame, ctx\)/.test(sky), 'render/sky.js: draw layout 17, the bind group, volumetricPrep');
  const fr = readFileSync(here('gpu/frame.js'), 'utf8');
  ok(/m\.volumetricPrep\(enc, frame,/.test(fr), 'gpu/frame.js calls volumetricPrep before the volumetric pass');
  const html = readFileSync(here('index.html'), 'utf8');
  ok(['auto', 'off', 'screen', 'volume'].every(m => html.includes(`data-shafts="${m}"`)) && html.includes('id="shaftK"'), 'the view panel has the four shaft modes and the strength slider');
}

// ── memory model
{
  const view = { cssW: 1280, cssH: 800, dpr: 2, qualityIndex: 3 };
  const d = estimate(D, view), p = estimate(P, { ...view, qualityIndex: 1 }), pm = estimate(PM, view);
  ok(d.parts.shafts > 0 && d.parts.shafts < 64 * 1048576, `desktop Ultra shafts ${(d.parts.shafts / 1048576).toFixed(1)} MB`);
  ok(p.parts.shafts < d.parts.shafts / 4 && pm.parts.shafts <= 8, `phone ${(p.parts.shafts / 1048576).toFixed(2)} MB, low-memory phone ${pm.parts.shafts} B`);
  ok(p.total < p.budget, `phone total ${(p.total / 1048576).toFixed(0)} MB under the ${(p.budget / 1048576).toFixed(0)} MB budget`);
}

if (fail) { console.log(`# shafts: ${pass} pass, ${fail} fail`); process.exit(1); }
console.log(`# shafts: ${pass} pass, 0 fail`);

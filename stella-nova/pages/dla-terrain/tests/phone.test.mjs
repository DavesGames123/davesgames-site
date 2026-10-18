// tests/phone.test.mjs — phone GPU safety checks (node, no browser).
// Run alone: node stella-nova/pages/dla-terrain/tests/phone.test.mjs
// With PHONE_DENO=1 it also runs gpu/mem-tally.mjs in Deno (a phone at
// 390 x 844 and 10 regenerations) and checks that the live textures and
// buffers do not grow; that run takes some minutes and needs deno.
//
// What it checks:
//   gpu/budget.js  the estimate of each profile stays under its budget (a
//                  phone at Low and at a forced Ultra, a low-memory phone);
//                  390 x 844 coarse picks the phone profile; desktop sizes
//                  do not change; lostPolicy restarts one time, one step
//                  lower; pressureStep steps down
//   gpu/device.js  createGPU on a mock adapter: a phone asks for no raised
//                  limits, a desktop does; a device loss makes the next
//                  createGPU one profile lower, a second loss stops it; an
//                  out-of-memory error steps the profile and calls onPressure
//   gpu/shadows.js the shadow map has one layer per cascade, capped by the
//                  profile
//   gpu/governor.js governorStep: 2 s of slow frames at the scale floor
//                  (0.5 on a phone) take the level up, fast frames take it
//                  down step by step

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PROFILES, detectProfile, profileFor, stepDown, estimate, resolveSizes, lostPolicy, pressureStep, MB,
} from '../gpu/budget.js';

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} phone: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} phone: ${name} ${extra}`); }
}
const mb = x => (x / MB).toFixed(0) + ' MB';

// ── budget model
const phoneView = { cssW: 390, cssH: 844, dpr: 3, n: 512 };
for (const qi of [0, 1, 2, 3]) {
  const e = estimate(profileFor('phone'), { ...phoneView, qualityIndex: qi });
  ok(e.total < e.budget && e.peak < e.budget, `phone q${qi} estimate ${mb(e.total)} (peak ${mb(e.peak)}) under ${mb(e.budget)}`);
}
{
  const e = estimate(profileFor('phone-min'), { cssW: 360, cssH: 740, dpr: 2, n: 512, qualityIndex: 0 });
  ok(e.peak < e.budget, `phone-min estimate ${mb(e.total)} (peak ${mb(e.peak)}) under ${mb(e.budget)}`);
}
{
  // the same phone with no caps (the state before gpu/budget.js)
  const raw = { ...profileFor('desktop'), id: 'raw' };
  const before = estimate(raw, { ...phoneView, dpr: 1, qualityIndex: 0 });
  const after = estimate(profileFor('phone'), { ...phoneView, qualityIndex: 0 });
  console.log(`# phone 390x844 Low: uncapped model ${mb(before.total)} (peak ${mb(before.peak)}), phone profile ${mb(after.total)} (peak ${mb(after.peak)})`);
  ok(after.peak < before.peak / 2, 'the phone profile halves the peak at least');
  const d = estimate(profileFor('desktop'), { cssW: 1280, cssH: 800, dpr: 1, n: 1024, qualityIndex: 2 });
  console.log(`# desktop 1280x800 High model ${mb(d.total)} (peak ${mb(d.peak)})`);
  const s = resolveSizes(profileFor('desktop'), { cssW: 1280, cssH: 800, dpr: 2, n: 1024, qualityIndex: 3 });
  ok(s.shadowSize === 4096 && s.cascades === 4 && s.taa && s.froxel.join() === '160,90,64' && s.veg.impFrame === 256 && s.dpr === 2,
    'desktop Ultra sizes are not capped', JSON.stringify(s).slice(0, 200));
  const sp = resolveSizes(profileFor('phone'), { ...phoneView, qualityIndex: 3, n: 1024 });
  ok(sp.n === 512 && sp.shadowSize === 1024 && sp.cascades === 2 && !sp.taa && sp.dpr === 1.5 && sp.froxel.join() === '64,36,32' && sp.veg.grassCap <= 40000,
    'a phone forced to Ultra keeps the phone caps', JSON.stringify(sp).slice(0, 240));
}

// ── profile choice
ok(detectProfile({ w: 390, h: 844, coarse: true }) === 'phone', '390x844 coarse -> phone');
ok(detectProfile({ w: 844, h: 390, coarse: true }) === 'phone', '844x390 coarse (landscape) -> phone');
ok(detectProfile({ w: 1440, h: 900, coarse: false, deviceMemory: 8 }) === 'desktop', '1440x900 mouse -> desktop');
ok(detectProfile({ w: 1024, h: 1366, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', maxTouchPoints: 5 }) === 'phone', 'iPad (desktop UA, touch) -> phone');
ok(detectProfile({ w: 390, h: 844, coarse: true, deviceMemory: 2 }) === 'phone-min', 'deviceMemory 2 -> phone-min');
ok(detectProfile({ w: 1440, h: 900, deviceMemory: 4 }) === 'phone', 'deviceMemory 4 -> phone');
ok(detectProfile({ w: 320, h: 568, coarse: true }) === 'phone-min', '320x568 -> phone-min');
ok(stepDown('desktop') === 'phone' && stepDown('phone') === 'phone-min' && stepDown('phone-min') === null, 'stepDown ladder');

// ── loss and pressure policy
{
  const st = {};
  ok(lostPolicy(st, { reason: 'destroyed' }, 'phone').restart === false && !st.losses, 'a destroyed device (page release) does not restart');
  const a = lostPolicy(st, { reason: 'unknown' }, 'phone');
  ok(a.restart && a.profile === 'phone-min', 'first loss restarts one step lower', JSON.stringify(a));
  const b = lostPolicy(st, { reason: 'unknown' }, 'phone-min');
  ok(!b.restart, 'second loss does not restart', JSON.stringify(b));
  const p = {};
  ok(pressureStep(p, 'phone', 0) === 'phone-min' && pressureStep(p, 'phone-min', 500) === 'phone-min' && p.oom === 1, 'pressureStep: one step, then a 2 s hold');
}

// ── device.js on a mock adapter
const BIG = {
  maxStorageBuffersPerShaderStage: 31, maxSampledTexturesPerShaderStage: 128, maxStorageTexturesPerShaderStage: 128,
  maxBufferSize: 2 ** 34, maxStorageBufferBindingSize: 2 ** 32 - 4, maxTextureDimension2D: 16384, maxBindGroups: 8,
  maxInterStageShaderVariables: 31, maxComputeWorkgroupStorageSize: 32768, maxTextureArrayLayers: 2048,
};
let requested = [];
const textures = [];
function mockDevice() {
  let loseFn = null;
  const dev = {
    limits: { ...BIG, maxTextureDimension2D: 8192 }, listeners: {},
    lost: new Promise(r => { loseFn = r; }),
    queue: { writeBuffer() {}, writeTexture() {}, submit() {} },
    createBindGroupLayout: d => ({ d }), createBuffer: d => ({ d, destroy() {} }), createSampler: d => ({ d }),
    createBindGroup: d => ({ d }),
    createTexture: d => { const t = { d, destroyed: false, destroy() { this.destroyed = true; }, createView: v => ({ v }) }; textures.push(t); return t; },
    addEventListener(k, f) { (dev.listeners[k] = dev.listeners[k] || []).push(f); },
    lose: info => loseFn(info),
  };
  return dev;
}
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUBufferUsage = { UNIFORM: 64, COPY_DST: 8, STORAGE: 128, VERTEX: 32, INDEX: 16, INDIRECT: 256, MAP_READ: 1, COPY_SRC: 4 };
globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4, COPY_SRC: 1, COPY_DST: 2, STORAGE_BINDING: 8 };
let lastDevice = null;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  gpu: {
    requestAdapter: async () => ({
      features: new Set(['float32-filterable']), limits: BIG,
      requestDevice: async d => { requested.push(d); lastDevice = mockDevice(); return lastDevice; },
    }),
    getPreferredCanvasFormat: () => 'bgra8unorm',
  },
  userAgent: 'node', maxTouchPoints: 0,
} });
globalThis.innerWidth = 1440; globalThis.innerHeight = 900;
const { createGPU, recovery, phoneLimits, NEED } = await import('../gpu/device.js');
const { createShadowMaps } = await import('../gpu/shadows.js');
const { createGovernor, governorStep } = await import('../gpu/governor.js');
const tick = () => new Promise(r => setTimeout(r, 0));
{
  const g = await createGPU(null, { qualityIndex: 0, coarse: true });
  const lim = requested.at(-1).requiredLimits;
  ok(g.profileId === 'phone', 'createGPU with coarse -> phone profile', g.profileId);
  ok(Object.keys(lim).length === Object.keys(NEED).length && !('maxBufferSize' in lim) && !('maxStorageBufferBindingSize' in lim),
    'phone: no raised limits (no maxBufferSize, no maxStorageBufferBindingSize)', JSON.stringify(lim));
  ok(Object.keys(phoneLimits(BIG)).every(k => k in NEED), 'phoneLimits asks only for NEED');
  ok(g.shadowSize === 1024 && g.shadowCascades === 2, 'phone shadow caps on the gpu object', `${g.shadowSize} x ${g.shadowCascades}`);
  // shadows: one layer per cascade
  textures.length = 0;
  const sh = createShadowMaps(g);
  ok(textures[0] && textures[0].d.size[2] === 2 && textures[0].d.size[0] === 1024, 'shadow map: 1024 x 1024 x 2 layers', JSON.stringify(textures[0] && textures[0].d.size));
  sh.resize(4096, 4);
  ok(sh.size === 1024 && sh.count === 2 && textures[0].destroyed === false, 'a quality change on a phone keeps the shadow caps');
  sh.resize(1024, 1);
  ok(textures[0].destroyed && textures.at(-1).d.size[2] === 1 && sh.layerViews.length === 1 && sh.passBindGroups.length === 1, 'resize to 1 cascade frees the old map');
  // out of memory
  let pressed = null;
  g.onPressure(id => { pressed = id; });
  for (const f of lastDevice.listeners.uncapturederror || []) f({ error: { message: 'Out of memory' } });
  ok(g.profileId === 'phone-min' && pressed === 'phone-min', 'an out-of-memory error steps the profile and calls onPressure', g.profileId);
  for (const f of lastDevice.listeners.uncapturederror || []) f({ error: { message: 'a validation error' } });
  ok(g.profileId === 'phone-min' && recovery.oom === 1, 'a validation error does not step the profile');
  // loss: one restart one step lower, then stop
  const g0 = g;
  g0.profileId = 'phone';
  lastDevice.lose({ reason: 'unknown', message: 'test' });
  await tick(); await tick();
  ok(recovery.next === 'phone-min', 'after a loss the next profile is phone-min', recovery.next);
  const g1 = await createGPU(null, { qualityIndex: 0, coarse: true });
  ok(g1.profileId === 'phone-min', 'the restart runs at phone-min', g1.profileId);
  lastDevice.lose({ reason: 'unknown', message: 'test 2' });
  await tick(); await tick();
  let threw = false;
  try { await createGPU(null, { qualityIndex: 0, coarse: true }); } catch { threw = true; }
  ok(threw && recovery.blocked, 'a second loss: createGPU throws, no restart loop');
  // a desktop asks for the raised limits
  recovery.blocked = false; recovery.next = null; recovery.losses = 0;
  const gd = await createGPU(null, { qualityIndex: 2, coarse: false });
  const dl = requested.at(-1).requiredLimits;
  ok(gd.profileId === 'desktop' && dl.maxBufferSize === 2 ** 30 && dl.maxStorageBuffersPerShaderStage === 31, 'desktop keeps the raised limits', gd.profileId);
  ok(gd.shadowSize === 2048 && gd.shadowCascades === 4, 'desktop High shadow sizes do not change');
  // a destroyed device (lib/gpu-guard.js on pagehide) does not count as a loss
  lastDevice.lose({ reason: 'destroyed', message: '' });
  await tick(); await tick();
  ok(!recovery.next && !recovery.blocked && recovery.losses === 0, 'destroy() (page release) is not a loss');
}

// ── governor
{
  const cfg = { budget: 33.3, maxScale: 0.6, floor: 0.5 };
  const st = createGovernor(0.5, 0);
  let downs = 0;
  for (let i = 0; i < 70; i++) { const r = governorStep(st, { ms: 50 }, cfg); if (r && r.what === 'level') downs++; }   // 3.5 s at 20 fps
  ok(st.level === 1 && downs === 1, '3.5 s of 50 ms frames at the scale floor: level 1', `level ${st.level}`);
  const st2 = createGovernor(0.6, 0);
  for (let i = 0; i < 20; i++) governorStep(st2, { ms: 50 }, cfg);   // 1 s: a scale step only
  ok(st2.level === 0 && st2.scale === 0.5, 'slow frames above the scale floor lower the scale, not the level', `scale ${st2.scale} level ${st2.level}`);
  for (let i = 0; i < 600; i++) governorStep(st, { ms: 15 }, cfg);   // 9 s at 66 fps
  ok(st.level === 0, '9 s of fast frames: level back to 0', `level ${st.level}`);
  const ss = createGovernor(0.6, 0);
  for (let i = 0; i < 100; i++) governorStep(ss, { ms: 50 }, cfg);
  ok(ss.scale === 0.5, 'the slow-frame path stops the scale at the phone floor 0.5', String(ss.scale));
}

// ── Deno: no leak across 10 regenerations (opt-in)
if (process.env.PHONE_DENO === '1') {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const steps = 'steps=ready;pump10;eval:__memLine();seed:2;eval:__memLine();seed:3;seed:4;seed:5;seed:6;seed:7;seed:8;seed:9;seed:10;seed:11;pump30;eval:__memLine()';
  const r = spawnSync('deno', ['run', '-A', 'stella-nova/pages/dla-terrain/gpu/mem-tally.mjs', 'coarse=1', 'w=390', 'h=844', steps], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  const lines = (r.stdout || '').split('\n').filter(l => l.includes('MEMAT live'));
  for (const l of lines) console.log('# ' + l.slice(l.indexOf('MEMAT')));
  const nums = lines.map(l => { const m = /live ([\d.]+) MB .* textures (\d+) buffers (\d+)/.exec(l); return m ? { mb: +m[1], tex: +m[2], buf: +m[3] } : null; }).filter(Boolean);
  ok(nums.length === 3, 'deno run gave 3 tally lines', (r.stderr || '').slice(-300));
  if (nums.length === 3) {
    ok(nums[2].tex <= nums[1].tex && nums[2].buf <= nums[1].buf + 2, `textures ${nums[1].tex} -> ${nums[2].tex}, buffers ${nums[1].buf} -> ${nums[2].buf} after 9 more regenerations`);
    ok(nums[2].mb <= nums[1].mb * 1.05 + 2, `live ${nums[1].mb} MB -> ${nums[2].mb} MB after 9 more regenerations`);
  }
} else console.log('# skip: Deno leak run (set PHONE_DENO=1)');

console.log(`# phone: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

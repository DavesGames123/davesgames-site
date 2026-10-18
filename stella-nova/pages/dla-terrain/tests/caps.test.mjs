// tests/caps.test.mjs — the hang caps (node, no GPU, no browser).
// Run alone: node stella-nova/pages/dla-terrain/tests/caps.test.mjs
// CORE's tests.mjs also runs it with every other file in tests/.
//
// Why: a full zoom on the ground took the whole computer down (2026-10-17).
// A GPU frame that does not end, or that takes seconds, stalls the window
// server of the OS. These checks keep every cause capped:
//   1 every WGSL loop has a constant upper bound: a for loop compares its
//     counter with a literal, a const, or a let that is min() or clamp()
//     to a literal or a const; a decreasing loop starts at a constant;
//     a loop {} carries a "bounded:" comment; no while loop
//   2 the camera: the orbit stops at MIN_DIST and the eye stays CLEAR over
//     the ground in orbit, fly and drone, at a full zoom and with NaN input
//   3 the CDLOD selection at distance 0 (the eye on the ground): the node
//     count stays under the instance cap and the levels are finite
//   4 the frame graph: at most MAX_IN_FLIGHT frames on the GPU queue; a
//     heavy frame (GPU time over HEAVY_MS) cuts the scale at once and then
//     steps the governor level, also for frames over 250 ms
//   5 the close-up cost caps: POM steps at distance 0 and grazing view are
//     at most POM_MAX, the governor turns off the close-up rock effects

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(new URL('../tests.mjs', import.meta.url)));
const LIB = join(DIR, '../../lib');
let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} caps: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} caps: ${name} ${extra}`); }
}
const walk = (d, ext, out = []) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== 'node_modules' && !f.startsWith('.')) walk(p, ext, out); }
    else if (f.endsWith(ext)) out.push(p);
  }
  return out;
};

// ── 1 WGSL loop bounds
const NUM = /^-?[0-9][0-9.]*[uif]?$/;
export function loopProblems(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = code.split('\n');
  const consts = new Set();
  const capped = new Set();
  for (const ln of lines) {
    const s = ln.replace(/\/\/.*$/, '');
    let m = /\bconst\s+([A-Za-z_]\w*)\s*(?::[^=]+)?=/.exec(s);
    if (m) consts.add(m[1]);
    m = /\blet\s+([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*(.+);/.exec(s);
    if (m) {
      const rhs = m[2].trim();
      const isConst = t => NUM.test(t) || consts.has(t);
      if (NUM.test(rhs)) capped.add(m[1]);
      // min(x, C) or min(C, x); clamp(x, a, C); select(C1, C2, c)
      let k = /^min\((.+),\s*([^,()]+)\)$/.exec(rhs);
      if (k && isConst(k[2].trim())) capped.add(m[1]);
      k = /^clamp\((.+),\s*([^,()]+),\s*([^,()]+)\)$/.exec(rhs);
      if (k && isConst(k[3].trim())) capped.add(m[1]);
      k = /^select\(\s*([^,()]+),\s*([^,()]+),/.exec(rhs);
      if (k && isConst(k[1].trim()) && isConst(k[2].trim())) capped.add(m[1]);
    }
  }
  const isBound = t => { t = t.trim().replace(/^\(|\)$/g, ''); return NUM.test(t) || consts.has(t) || capped.has(t); };
  const out = [];
  lines.forEach((raw, i) => {
    const s = raw.replace(/\/\/.*$/, '');
    if (/\bwhile\s*\(/.test(s)) out.push(`line ${i + 1}: while loop`);
    if (/\bloop\s*\{/.test(s) && !/bounded:/.test(raw) && !/bounded:/.test(lines[i - 1] || '')) out.push(`line ${i + 1}: loop {} with no "bounded:" note`);
    const m = /\bfor\s*\(\s*var\s+(\w+)\s*(?::\s*\w+)?\s*=\s*([^;]+);\s*([^;]+);\s*([^)]*)\)/.exec(s);
    if (!m) { if (/\bfor\s*\(/.test(s)) out.push(`line ${i + 1}: a for header the check cannot read`); return; }
    const [, v, init, cond, upd] = m;
    const c = new RegExp('^' + v + '\\s*(<=|<|>=|>)\\s*(.+)$').exec(cond.trim());
    if (!c) { out.push(`line ${i + 1}: condition "${cond.trim()}"`); return; }
    const down = /--|-=/.test(upd);
    if (down) {
      if (!isBound(init)) out.push(`line ${i + 1}: a decreasing loop from "${init.trim()}"`);
      if (!isBound(c[2])) out.push(`line ${i + 1}: a decreasing loop to "${c[2].trim()}"`);
    } else if (!isBound(c[2])) out.push(`line ${i + 1}: bound "${c[2].trim()}" is not a constant`);
  });
  return out;
}

const wgsl = walk(DIR, '.wgsl').concat([join(LIB, 'dla-terrain-detail.wgsl')]);
for (const f of wgsl) {
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  const p = loopProblems(src);
  ok(p.length === 0, 'constant loop bounds in ' + relative(DIR, f), p.join('; '));
}
// the check itself finds the bad forms
{
  const bad = loopProblems('fn f(n: u32) {\n  for (var i = 0u; i < n; i++) { }\n  loop { }\n  while (true) { }\n}\n');
  ok(bad.length === 3, 'the loop check finds an open bound, a bare loop and a while', bad.join('; '));
  const good = loopProblems('const M: i32 = 8;\nfn f(n: i32) {\n  let k = min(n, 12);\n  for (var i = 0; i < M; i++) { }\n  for (var j = 0; j < k; j++) { }\n  // bounded: s halves from 32\n  loop { }\n}\n');
  ok(good.length === 0, 'the loop check passes const, capped let and a noted loop', good.join('; '));
}

// ── 2 the camera at a full zoom
const { createCamera, CLEAR, MIN_DIST } = await import('../camera.js');
{
  const hAt = (x, z) => 400 + 120 * Math.sin(x / 300) * Math.cos(z / 250) + 30 * Math.sin(x / 7 + z / 9);
  const w = { heightAt: hAt, size: 8000, seaLevel: 0 };
  const cam = createCamera();
  cam.update(0.6, {}, w);
  let minClear = Infinity, minDist = Infinity, finite = true;
  for (let k = 0; k < 120; k++) {
    cam.orbitZoomAt(0, -0.1, 6, w);
    for (let f = 0; f < 4; f++) {
      cam.update(1 / 60, {}, w);
      minClear = Math.min(minClear, cam.pos[1] - hAt(cam.pos[0], cam.pos[2]));
      finite = finite && cam.pos.every(Number.isFinite);
    }
    minDist = Math.min(minDist, cam.orbit.dist);
  }
  ok(finite && minClear >= CLEAR - 1e-6, `orbit full zoom: the eye stays ${minClear.toFixed(2)} m over the ground (CLEAR ${CLEAR})`);
  ok(minDist >= MIN_DIST - 0.5, `orbit full zoom: the distance stops at ${minDist.toFixed(2)} m (MIN_DIST ${MIN_DIST})`);
  // fly straight down into the ground for 10 s
  cam.setMode('fly', w);
  cam.fly.pitch = -1.5;
  let flyMin = Infinity;
  for (let f = 0; f < 600; f++) {
    cam.update(1 / 60, { move: [0, -1, 1], boost: true }, w);
    flyMin = Math.min(flyMin, cam.pos[1] - hAt(cam.pos[0], cam.pos[2]));
  }
  ok(flyMin >= CLEAR - 1e-6, `fly dive: the eye stays ${flyMin.toFixed(2)} m over the ground`);
  const m = cam.matrices(640, 400, {});
  ok(m.near >= 0.1 - 1e-9 && m.near <= 0.5 + 1e-9, `near plane at the ground ${m.near.toFixed(3)} m (0.1 .. 0.5)`);
  // a NaN height and a NaN input: the pose stays finite
  const wNaN = { heightAt: () => NaN, size: 8000, seaLevel: NaN };
  cam.update(1 / 60, { move: [0, -1, 1] }, wNaN);
  cam.update(NaN, { move: [NaN, NaN, NaN], look: [NaN, 0] }, w);
  cam.update(1 / 60, {}, w);
  const m2 = cam.matrices(640, 400, {});
  ok(cam.pos.every(Number.isFinite) && Array.from(m2.viewProj).every(Number.isFinite), 'a NaN height or input leaves a finite pose and matrices');
}

// ── 3 the CDLOD selection at distance 0
const G = await import('../render/ground.js');
{
  const W = 65536, n = 257, origin = -W / 2;
  const height = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) height[j * n + i] = 300 * Math.sin(i / 9) * Math.cos(j / 11) + 500;
  const mm = G.buildMinMax(height, n);
  for (const q of [0.25, 0.8, 1]) {
    const cfg = G.lodConfig(W, q);
    let worst = 0, finite = cfg.levels <= 14;
    for (const cam of [[0, 500, 0], [0.001, 200, -0.001], [origin, 800, origin], [W / 2 - 1, 0, W / 2 - 1], [12.5, 500.0001, -7.25]]) {
      const s = G.selectNodes({ cfg, cam, origin, mm, pad: 12, planes: null });
      worst = Math.max(worst, s.count);
      finite = finite && s.count > 0;
    }
    ok(finite && worst <= 6144, `CDLOD q=${q}: eye on the ground, ${cfg.levels} levels (cap 14), at most ${worst} nodes (cap 6144)`);
  }
}

// ── 4 the frame graph HANG GUARD
const F = await import('../gpu/frame.js');
{
  const st = { scale: 1, level: 0, cool: 0 };
  let r = F.heavyStep(st, 60);
  ok(!r.changed, 'heavyStep: a 60 ms frame changes nothing');
  r = F.heavyStep(st, 200);
  ok(r.changed && r.scale === 0.7 && r.level === 0, `heavyStep: a 200 ms frame cuts the scale at once to ${r.scale}`);
  r = F.heavyStep(st, 200);
  ok(!r.changed, 'heavyStep: the frames in flight do not count two times (cool down)');
  for (let k = 0; k < 40; k++) F.heavyStep(st, 300);
  ok(st.scale === F.HEAVY_FLOOR && st.level === F.MAX_LEVEL, `heavyStep: sustained heavy frames go to scale ${st.scale} and level ${st.level}`);
  const s2 = { scale: 1, level: 0, cool: 0 };
  r = F.heavyStep(s2, 2000);
  ok(r.scale === 0.7 && r.level === 1, 'heavyStep: a 2 s frame cuts the scale and takes a governor level at once');
  ok(F.MAX_IN_FLIGHT >= 1 && F.MAX_IN_FLIGHT <= 3, `at most ${F.MAX_IN_FLIGHT} frames on the GPU queue`);
  // the frame graph with a fake device: the third frame is skipped while two are not done
  globalThis.GPUTextureUsage ??= { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4, COPY_SRC: 1, COPY_DST: 2 };
  const resolvers = [];
  const dev = {
    createTexture: () => ({ createView: () => ({}), destroy() {} }),
    createCommandEncoder: () => ({ beginRenderPass: () => ({ setBindGroup() {}, end() {} }), copyTextureToTexture() {}, finish: () => ({}) }),
    queue: { submit() {}, onSubmittedWorkDone: () => new Promise(res => resolvers.push(res)) },
  };
  const gpu = { device: dev, qualityPreset: { scale: 1 }, hdrFormat: 'rgba16float', depthFormat: 'depth32float', globalsBindGroup: {}, context: { getCurrentTexture: () => ({ createView: () => ({}) }) } };
  const parts = {
    terrain: { compute() {} }, post: { resize() {}, run() {}, afterSubmit() {}, settings: {} },
    shadows: { info: null, count: 1, layerViews: [{}], sampleBindGroup: {}, passBindGroups: [{}], size: 1024, resize() {} },
  };
  const fg = F.createFrameGraph(gpu, parts);
  fg.resize(640, 400, 1);
  const a = fg.render({}), b = fg.render({}), c = fg.render({});
  ok(a === true && b === true && c === false && fg.stalls === 1, `fake device: frames 1, 2 drawn, frame 3 skipped (stalls ${fg.stalls})`);
  // each frame makes two done promises: the GPU TIME probe, then the frame
  const nProm = resolvers.length;
  resolvers.shift()(); resolvers.shift()();
  await new Promise(r0 => setTimeout(r0, 0));
  ok(nProm === 4, 'fake device: a probe and a done promise per drawn frame', String(nProm));
  ok(fg.inFlight === 1 && fg.render({}) === true, 'fake device: a done frame frees a slot');
  // tick: a 400 ms GPU frame counts, a 400 ms CPU gap alone does not
  const fg2 = F.createFrameGraph(gpu, parts);
  fg2.resize(640, 400, 1);
  for (let k = 0; k < 20; k++) fg2.tick(400);
  const s0 = fg2.dyn.scale;
  fg2.gpuMs = 400;
  for (let k = 0; k < 20; k++) fg2.tick(400);
  ok(s0 === 1 && fg2.dyn.scale < 1, `tick: a 400 ms page stall is dropped (scale ${s0}), 400 ms GPU frames lower it (${fg2.dyn.scale})`);
}

// ── 5 the close-up cost caps
{
  let worst = 0;
  for (const d of [0, 0.01, 1, 10, 40]) for (const ndv of [0, 0.001, 0.2, 1]) worst = Math.max(worst, G.pomSteps(d, ndv, [1, 1, 60, 50]));
  ok(worst <= G.POM_MAX && G.POM_MAX <= 16, `POM steps at distance 0 and grazing view: at most ${worst} (POM_MAX ${G.POM_MAX})`);
  const src = readFileSync(join(DIR, 'render/ground.js'), 'utf8');
  ok(/effectUniforms\(quality,[^\n]*govLevel/.test(src), 'GROUND: the governor level turns off POM and the vertex relief');
  const gw = readFileSync(join(DIR, 'shaders/ground.wgsl'), 'utf8');
  ok(/const POM_MAX: i32 = (\d+);/.test(gw) && +/const POM_MAX: i32 = (\d+);/.exec(gw)[1] === G.POM_MAX, 'ground.wgsl POM_MAX = ground.js POM_MAX');
}

if (fail) { console.log(`caps: ${pass} passed, ${fail} FAILED`); process.exit(1); }
console.log(`caps: ${pass} passed`);

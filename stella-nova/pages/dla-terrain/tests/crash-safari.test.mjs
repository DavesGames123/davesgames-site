// ============================================================================
//  DLA TERRAIN  ·  tests/crash-safari.test.mjs — the Safari crash guard (CORE)
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/dla-terrain/tests/crash-safari.test.mjs
//  (tests.mjs runs it too). Exit code 1 on a fail. No browser, no GPU.
//
//  The user (2026-10-18, Safari on a Mac): "let's make sure we stop crashing
//  my computer when we're zoomed all the way in". The checks:
//    A  pixelCap: Safari at dpr 2 and 2000 x 1260 CSS px (10 Mpx of device
//       pixels) renders under 3.5 Mpx, under 1.6 Mpx near the ground; the
//       desktop sizes do not change; the safe profile is smaller again.
//    B  detectProfile: Safari and an Apple GPU take 'safari'; Chrome on a
//       PC, an iPad and a phone do not. The step ladder.
//    C  the crash guard flag (budget.js guardRead / guardMark / guardClean)
//       with a fake store, a store that throws, a stale and a bad flag.
//    D  trackDevice: bytes in, bytes out, one free per destroy().
//    E  the frame graph on a fake device with a fake clock and fake GPU
//       times (cost per pixel, 2 x near the ground) and fake modules that
//       make new targets on resize, driven by the real camera: 200 zoom
//       steps in and out. No byte growth, few target builds (hysteresis),
//       at most 1 frame in flight on Safari, the first heavy frame cuts
//       the scale at once, the GPU is idle for part of the time.
//    F  the memory budget relief, a stuck frame (no done promise), the
//       safe profile level floor.
//    G  (jsdom, else skipped and named) the real main.js and the real
//       modules on a byte-counting mock device: 200 zoom steps of the page
//       camera, no growth of the live GPU bytes, no allocation per frame,
//       the crash flag is written while zoomed and the next boot after an
//       unclean end is in the safe profile with a notice.
// ============================================================================
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  pixelCap, profileFor, detectProfile, stepDown, isSafari, isAppleGPU, trackDevice, texBytes,
  guardRead, guardMark, guardClean, guardProfile, GUARD_KEY, MB, estimate,
} from '../gpu/budget.js';

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} crash: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} crash: ${name} ${extra}`); }
}

const UA = {
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

// ── A pixel caps
{
  const v = { cssW: 2000, cssH: 1260, dpr: 2 };
  ok(2000 * 2 * 1260 * 2 > 10e6, 'the test view is 10 Mpx of device pixels', String(2000 * 2 * 1260 * 2));
  let worst = 0, worstNear = 0;
  for (let qi = 0; qi < 4; qi++) {
    const a = pixelCap(profileFor('safari'), { ...v, qualityIndex: qi, scale: 1 });
    const n = pixelCap(profileFor('safari'), { ...v, qualityIndex: qi, scale: 1, near: true });
    worst = Math.max(worst, a.outW * a.outH, a.w * a.h);
    worstNear = Math.max(worstNear, n.w * n.h);
  }
  ok(worst <= 3.5e6, 'Safari dpr 2 at 2000 x 1260: swap chain and render under 3.5 Mpx at every quality', `${(worst / 1e6).toFixed(2)} Mpx`);
  ok(worstNear <= 1.6e6, 'Safari near the ground: render under 1.6 Mpx', `${(worstNear / 1e6).toFixed(2)} Mpx`);
  const u = pixelCap(profileFor('safari'), { ...v, qualityIndex: 3, scale: 1 });
  ok(Math.abs(u.outW / u.outH - 2000 / 1260) < 0.01, 'the cap keeps the aspect', `${u.outW} x ${u.outH}`);
  const s = pixelCap(profileFor('safe'), { ...v, qualityIndex: 3, scale: 1 });
  const sn = pixelCap(profileFor('safe'), { ...v, qualityIndex: 3, scale: 1, near: true });
  ok(s.outW * s.outH <= 2.0e6 && sn.w * sn.h <= 1.0e6, 'safe: 2 Mpx, 1 Mpx near', `${s.outW}x${s.outH}, near ${sn.w}x${sn.h}`);
  const d = pixelCap(profileFor('desktop'), { ...v, qualityIndex: 3, scale: 1 });
  const d2 = pixelCap(profileFor('desktop'), { cssW: 1280, cssH: 800, dpr: 2, qualityIndex: 2, scale: 1 });
  ok(d.outW * d.outH <= 8.3e6 && d.outW * d.outH > 8.0e6 && d2.outW === 1920 && d2.outH === 1200, 'desktop sizes do not change (8.3 Mpx cap, High 1.5x)', `${d.outW}x${d.outH} ${d2.outW}x${d2.outH}`);
  const dn = pixelCap(profileFor('desktop'), { cssW: 1280, cssH: 800, dpr: 2, qualityIndex: 2, scale: 1, near: true });
  ok(dn.w === d2.w && dn.h === d2.h, 'desktop has no near cap');
  const pr = pixelCap(profileFor('safari'), { ...v, qualityIndex: 3, scale: 1, pressure: 1 });
  ok(pr.dpr === 1, 'a memory relief takes the pixel ratio to 1');
  const es = estimate(profileFor('safari'), { cssW: 2000, cssH: 1260, dpr: 2, qualityIndex: 3, n: 1024 });
  const ed = estimate(profileFor('desktop'), { cssW: 2000, cssH: 1260, dpr: 2, qualityIndex: 3, n: 1024 });
  console.log(`# model Ultra 2000x1260 dpr 2: desktop ${(ed.total / MB).toFixed(0)} MB, safari ${(es.total / MB).toFixed(0)} MB (budget ${(es.budget / MB).toFixed(0)} MB)`);
  ok(es.total < ed.total - 300 * MB && es.total < es.budget && es.peak < es.budget * 1.25, 'the Safari model at Ultra is 300 MB under desktop, under its budget, the peak under 1.25 x', `${(es.total / MB).toFixed(0)} MB`);
}

// ── B profiles
{
  ok(isSafari({ ua: UA.safari }) && !isSafari({ ua: UA.chromeMac }) && !isSafari({ ua: UA.edge }) && !isSafari({ ua: UA.chromeWin }), 'isSafari: Safari yes, Chrome and Edge no');
  ok(detectProfile({ w: 1512, h: 945, ua: UA.safari, maxTouchPoints: 0 }) === 'safari', 'Safari on a Mac -> safari');
  ok(detectProfile({ w: 1512, h: 945, ua: UA.chromeWin }) === 'desktop', 'Chrome on a PC -> desktop');
  ok(detectProfile({ w: 1512, h: 945, ua: UA.chromeMac, adapterInfo: { vendor: 'apple', architecture: 'metal-3' } }) === 'safari', 'an Apple GPU (adapter info) -> safari');
  ok(detectProfile({ w: 1512, h: 945, ua: UA.chromeMac, adapterInfo: { vendor: 'nvidia' } }) === 'desktop', 'another GPU -> desktop');
  ok(detectProfile({ w: 1024, h: 1366, ua: UA.safari, maxTouchPoints: 5 }) === 'phone', 'an iPad (Safari UA, touch) -> phone');
  ok(detectProfile({ w: 390, h: 844, ua: UA.iphone, coarse: true }) === 'phone', 'an iPhone -> phone');
  ok(!isAppleGPU(undefined) && !isAppleGPU({}), 'isAppleGPU: no info is no');
  ok(stepDown('safari') === 'safe' && stepDown('safe') === 'phone' && stepDown('desktop') === 'phone', 'ladder: safari -> safe -> phone, desktop -> phone');
  const sp = profileFor('safari');
  ok(sp.maxInFlight === 1 && sp.heavyMs < 120 && sp.shadowSize <= 2048 && sp.cascades <= 3 && sp.memGuard && !profileFor('desktop').memGuard, 'safari: 1 in flight, earlier heavy limit, 2048 x 3 shadows, a hard memory budget (desktop: none)');
}

// ── C crash guard
{
  const mk = () => { const m = new Map(); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  const st = mk();
  ok(!guardRead(st).unclean, 'no flag: a clean start');
  ok(guardMark(st, { zoomed: true, profile: 'safari', agl: 4.6 }, 1000) && st.m.has(GUARD_KEY), 'mark writes the flag');
  const r = guardRead(st, 5000);
  ok(r.unclean && r.zoomed && r.profile === 'safari' && r.agl === 5, 'a flag left by a zoomed session: unclean and zoomed', JSON.stringify(r));
  ok(guardProfile('safari', r) === 'safe' && guardProfile('desktop', r) === 'safe', 'unclean + zoomed -> the safe profile');
  ok(guardProfile('phone', r) === 'phone', 'a phone keeps its own profile');
  guardMark(st, { zoomed: false }, 2000);
  ok(guardProfile('safari', guardRead(st, 3000)) === 'safari', 'unclean but not zoomed -> no change');
  guardClean(st);
  ok(!guardRead(st).unclean, 'a clean unload clears the flag');
  guardMark(st, { zoomed: true }, 0);
  ok(!guardRead(st, 8 * 24 * 3600e3).unclean, 'a flag older than 7 days is stale');
  st.setItem(GUARD_KEY, '{not json');
  ok(!guardRead(st).unclean, 'a bad flag is no flag');
  const bad = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); }, removeItem() { throw new Error('x'); } };
  let threw = false;
  try { guardRead(bad); guardMark(bad, { zoomed: true }); guardClean(bad); guardRead(null); guardMark(null, {}); guardClean(null); } catch { threw = true; }
  ok(!threw && guardMark(bad, {}) === false, 'a store that throws (private window) never throws out');
}

// ── D the tally
{
  const dev = { createBuffer: d => ({ d, destroy() { this.dead = true; } }), createTexture: d => ({ d, destroy() {} }) };
  const mem = trackDevice(dev, {});
  const b = dev.createBuffer({ size: 1024, label: 'b' });
  const t = dev.createTexture({ size: [256, 256, 2], format: 'rgba16float', mipLevelCount: 1, label: 't' });
  ok(mem.live === 1024 + 256 * 256 * 2 * 8 && mem.count === 2, 'trackDevice counts buffer and texture bytes', String(mem.live));
  b.destroy(); b.destroy();
  ok(mem.live === 256 * 256 * 2 * 8 && mem.count === 1 && b.dead, 'destroy frees one time and calls the real destroy');
  t.destroy();
  ok(mem.live === 0 && mem.peak === 1024 + 256 * 256 * 16, 'all freed, the peak stays');
  ok(texBytes({ size: [64, 64, 64], dimension: '3d', format: 'rgba16float' }) === 64 ** 3 * 8, 'texBytes of a 3D texture');
  ok(texBytes({ size: { width: 8, height: 8 }, format: 'rgba8unorm', mipLevelCount: 4 }) === (64 + 16 + 4 + 1) * 4, 'texBytes with mips');
}

// ── E the frame graph, a fake device and the real camera
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUBufferUsage = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256 };
globalThis.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
let clock = 0;
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock } });
const { createFrameGraph, NEAR_IN, NEAR_OUT, STUCK_MS, MEM_CHECK } = await import('../gpu/frame.js');
const { createCamera, MIN_DIST, CLEAR } = await import('../camera.js');

// the fake GPU: a frame costs msPerMpx per Mpx of render size (x2 near the
// ground: POM, close rock); frames run one after another
function fakeGPU(profileId, opt = {}) {
  const jobs = [];   // { end, resolve }
  let gpuFree = 0, busy = 0, writes = 0;
  const cur = { px: 0, near: false };
  const pass = () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, drawIndexed() {}, end() {}, setVertexBuffer() {}, setIndexBuffer() {} });
  const device = {
    limits: { maxTextureDimension2D: 8192 },
    createBuffer: d => ({ d, destroy() {} }),
    createTexture: d => ({ d, destroy() {}, createView: () => ({}) }),
    createBindGroup: d => ({ d }), createCommandEncoder: () => ({ beginRenderPass: pass, beginComputePass: pass, copyTextureToTexture() {}, finish: () => ({}) }),
    queue: {
      writeBuffer() { writes++; },
      submit() {
        const cost = (cur.px / 1e6) * (opt.msPerMpx ?? 40) * (cur.near ? 2 : 1);
        const start = Math.max(clock, gpuFree);
        gpuFree = start + cost; busy += cost;
        cur.pending = gpuFree;
      },
      onSubmittedWorkDone() {
        if (opt.lose && opt.lose()) return new Promise(() => {});   // never done
        return new Promise(r => jobs.push({ end: cur.pending, r }));
      },
    },
  };
  const mem = trackDevice(device, {});
  const gpu = {
    device, queue: device.queue, mem, profile: profileFor(profileId), profileId,
    qualityIndex: opt.qi ?? 3, qualityPreset: { scale: 1 }, hdrFormat: 'rgba16float', depthFormat: 'depth32float',
    globalsBindGroup: {}, context: { getCurrentTexture: () => ({ createView: () => ({}) }) },
  };
  // a module with screen-size targets (as post, sky, weather): new ones on
  // each resize, the old ones destroyed
  const mod = {
    role: 'ground', T: [],
    resize(w, h) { for (const t of mod.T) t.destroy(); mod.T = [device.createTexture({ size: [w, h], format: 'rgba16float', label: 'mod a' }), device.createTexture({ size: [w >> 1, h >> 1], format: 'rgba16float', label: 'mod b' })]; },
    drawOpaque() {}, drawShadow() {},
  };
  let postT = [];
  const post = {
    settings: { taa: true },
    resize(w, h, ow, oh) { for (const t of postT) t.destroy(); postT = [device.createTexture({ size: [w, h], format: 'rgba16float', label: 'taa a' }), device.createTexture({ size: [w, h], format: 'rgba16float', label: 'taa b' }), device.createTexture({ size: [ow, oh], format: 'rgba8unorm', label: 'ldr' })]; },
    run() {}, afterSubmit() {},
  };
  const shadows = { info: { count: 3 }, count: 3, size: 2048, layerViews: [{}, {}, {}, {}], passBindGroups: [{}, {}, {}, {}], sampleBindGroup: {}, resize(s, c) { shadows.count = c; shadows.info.count = c; } };
  const terrain = { compute() {} };
  const fg = createFrameGraph(gpu, { terrain, post, shadows });
  fg.modules = [mod];
  return {
    gpu, fg, mem, mod, shadows,
    setCur(px, near) { cur.px = px; cur.near = near; },
    // the clock moves dt ms; done frames resolve
    async advance(dt) {
      clock += dt;
      for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].end <= clock) { jobs[i].r(); jobs.splice(i, 1); }
      await Promise.resolve(); await Promise.resolve();
    },
    get busy() { return busy; }, get writes() { return writes; },
  };
}

// a world with hills; the camera zooms to the ground at the image centre
const world = { heightAt: (x, z) => 40 * Math.sin(x / 700) * Math.cos(z / 900), size: 16000, seaLevel: -50, midH: 0 };
const ground = (x, z) => Math.max(world.heightAt(x, z), world.seaLevel);
async function zoomRun(profileId, opt = {}) {
  const F = fakeGPU(profileId, opt);
  const { fg } = F;
  fg.resize(2000, 1260, 2);
  const cam = createCamera();
  cam.orbit = { target: [300, ground(300, -200), -200], yaw: 0.6, pitch: -0.45, dist: 3000 };
  cam.update(1, {}, world);
  const rec = { maxInFlight: 0, minAgl: Infinity, live: [], builds0: 0, firstHeavyAt: -1, firstHeavyScale: null, scaleAfter: null, frames: 0, drawn: 0, t0: clock, nearPx: 0 };
  const steps = opt.steps ?? 200;
  let heavySeen = false;
  for (let step = 0; step < steps; step++) {
    // 5 wheel steps in, then 5 out: 10 cycles of 20 steps
    const dir = Math.floor(step / 10) % 2 === 0 ? 1 : -1;
    cam.orbitZoomAt(0, 0, dir * 4, world);
    for (let f = 0; f < 6; f++) {
      cam.update(1 / 60, {}, world);
      cam.matrices(fg.w, fg.h);
      const agl = cam.pos[1] - ground(cam.pos[0], cam.pos[2]);
      rec.minAgl = Math.min(rec.minAgl, agl);
      fg.setNear(agl);
      F.setCur(fg.w * fg.h, agl < 30);
      if (fg.near) rec.nearPx = Math.max(rec.nearPx, fg.w * fg.h);
      rec.frames++;
      const hv0 = fg.heavy;
      if (fg.render({ dt: 1 / 60, outView: {} }) !== false) rec.drawn++;
      rec.maxInFlight = Math.max(rec.maxInFlight, fg.inFlight);
      fg.tick(1000 / 60);
      await F.advance(1000 / 60);
      if (!heavySeen && fg.heavy > hv0) { heavySeen = true; rec.firstHeavyAt = rec.frames; }
      if (!heavySeen && fg.gpuMs > (F.gpu.profile.heavyMs || 120)) { rec.firstHeavyScale = fg.scale; }
    }
    if (step % 20 === 19) rec.live.push(F.mem.live);
  }
  rec.elapsed = clock - rec.t0;
  return { F, rec, cam };
}

{
  const { F, rec } = await zoomRun('safari');
  const fg = F.fg;
  ok(rec.minAgl < NEAR_IN && rec.minAgl >= CLEAR, 'the loop goes all the way in (eye height under NEAR_IN, over CLEAR)', `min ${rec.minAgl.toFixed(1)} m, MIN_DIST ${MIN_DIST} m`);
  const first = rec.live[0], grow = rec.live.map(v => v - first);
  ok(rec.live.length === 10 && Math.max(...rec.live) <= Math.max(first, rec.live[1]) && rec.live.at(-1) <= first, 'Safari: no GPU byte growth over 200 zoom steps', rec.live.map(v => (v / MB).toFixed(1)).join(' '));
  ok(F.mem.count <= 4 + 2 + 3, 'Safari: the live object count stays at the target set', String(F.mem.count));
  ok(fg.targetBuilds <= 40, 'Safari: few target builds in 200 zoom steps (near hysteresis, scale steps)', String(fg.targetBuilds));
  ok(rec.maxInFlight <= 1, 'Safari: at most 1 frame in flight', String(rec.maxInFlight));
  ok(rec.nearPx > 0 && rec.nearPx <= 1.6e6, 'Safari: near the ground the render is under 1.6 Mpx', String(rec.nearPx));
  const duty = F.busy / rec.elapsed;
  ok(duty < 0.8, 'Safari: the GPU is idle for part of the time (duty under 80%)', (duty * 100).toFixed(0) + '%');
  ok(fg.level >= 0 && fg.scale <= 1, 'Safari: the governor state is in range', `scale ${fg.scale} level ${fg.level}`);
  console.log(`# safari zoom loop: ${rec.frames} frames, ${rec.drawn} drawn, ${fg.heavy} heavy steps, ${fg.targetBuilds} target builds, duty ${(duty * 100).toFixed(0)}%, live ${(F.mem.live / MB).toFixed(1)} MB peak ${(F.mem.peak / MB).toFixed(1)} MB`);
}
{
  // the first heavy frame: a slow GPU (200 ms per Mpx) at the home view
  const F = fakeGPU('safari', { msPerMpx: 200 });
  F.fg.resize(2000, 1260, 2);
  const s0 = F.fg.scale;
  F.setCur(F.fg.w * F.fg.h, false);
  F.fg.render({ dt: 1 / 60, outView: {} });
  let n = 0;
  while (F.fg.inFlight && n < 200) { await F.advance(16); n++; }
  ok(F.fg.heavy === 1 && F.fg.scale < s0, 'the first heavy frame cuts the scale at once (no wait for the 1 s budget step)', `scale ${s0} -> ${F.fg.scale}, heavy ${F.fg.heavy}`);
  ok(!F.fg.ready() && F.fg.readyAt > performance.now(), 'after a heavy frame the GPU gets an idle gap (dutyIdle)', `${F.fg.readyAt} > ${performance.now()}`);
}
{
  // desktop: the same loop; no near cap, 2 frames in flight while fast
  const { F, rec } = await zoomRun('desktop', { msPerMpx: 2 });
  ok(rec.live.at(-1) <= rec.live[0] && F.fg.targetBuilds <= 4, 'desktop: no growth and no target builds from the zoom', `${F.fg.targetBuilds} builds`);
  ok(rec.maxInFlight === 2, 'desktop: 2 frames in flight while the GPU is fast', String(rec.maxInFlight));
}

// ── F memory relief, a stuck frame, the safe level floor
{
  const F = fakeGPU('safari', { msPerMpx: 1 });
  F.fg.resize(2000, 1260, 2);
  const out0 = F.fg.outW;
  F.mem.live += 2000 * MB;   // a module over the budget
  for (let i = 0; i < MEM_CHECK * 3; i++) { F.setCur(F.fg.w * F.fg.h, false); F.fg.render({ dt: 1 / 60, outView: {} }); await F.advance(40); }
  ok(F.fg.memOver >= 1 && F.fg.relieved === 1 && F.fg.outW < out0 && F.fg.level >= 2, 'over the memory budget: one relief (pixel ratio 1, level 2)', `memOver ${F.fg.memOver} relieved ${F.fg.relieved} out ${out0} -> ${F.fg.outW} level ${F.fg.level}`);
  // nothing more to lower: no second relief, however long it stays over
  for (let i = 0; i < MEM_CHECK * 12; i++) { F.setCur(F.fg.w * F.fg.h, false); F.fg.render({ dt: 1 / 60, outView: {} }); await F.advance(40); }
  ok(F.fg.relieved === 1, 'no relief loop while the memory stays over (nothing left to lower)', `relieved ${F.fg.relieved}, memOver ${F.fg.memOver}`);
  F.mem.live -= 2000 * MB;
}
{
  let lost = true;
  const F = fakeGPU('safari', { msPerMpx: 1, lose: () => lost });
  F.fg.resize(1280, 800, 1);
  F.setCur(F.fg.w * F.fg.h, false);
  F.fg.render({ dt: 1 / 60, outView: {} });
  lost = false;
  ok(F.fg.inFlight === 1 && !F.fg.ready(), 'a frame with no done promise holds the queue');
  await F.advance(STUCK_MS + 10);
  const r = F.fg.ready();
  ok(F.fg.stuck === 1 && F.fg.inFlight === 0 && F.fg.level >= 1, 'after STUCK_MS the slot frees and the frame counts as heavy', `stuck ${F.fg.stuck} level ${F.fg.level} ready ${r}`);
}
{
  const F = fakeGPU('safe', { msPerMpx: 1 });
  F.fg.resize(1280, 800, 1);
  ok(F.fg.level === 1 && F.shadows.count === 1, 'safe: the governor starts at level 1 (no POM, one cascade)', `level ${F.fg.level}`);
  F.fg.setLevel(0);
  ok(F.fg.level === 1, 'safe: the level does not go under govMin');
}

// ── G the real page (jsdom)
let JSDOM = null, VirtualConsole = null;
try {
  const d = process.env.JSDOM_DIR;
  if (d && existsSync(d + '/node_modules/jsdom')) ({ JSDOM, VirtualConsole } = await import(pathToFileURL(d + '/node_modules/jsdom/lib/api.js').href));
  else if (process.env.NODE_PATH) ({ JSDOM, VirtualConsole } = createRequire(process.env.NODE_PATH.split(':')[0] + '/')('jsdom'));
} catch { JSDOM = null; }
if (!JSDOM) console.log('# crash: jsdom not found (set NODE_PATH or JSDOM_DIR): the page checks (G) are skipped');
else await pageChecks();

async function pageChecks() {
  const PAGE = fileURLToPath(new URL('../', import.meta.url));
  const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
  // the byte-counting mock: plain objects for buffers and textures (so the
  // tally of device.js wraps destroy), a proxy for the rest
  const counts = { buf: 0, tex: 0, writes: 0, last: [] };
  function mock(over = {}) {
    const f = function () {};
    return new Proxy(f, {
      get(t, k) {
        if (k in over) return over[k];
        if (k === 'then') return undefined;
        if (k === Symbol.toPrimitive) return () => 0;
        if (k === Symbol.iterator) return function* () {};
        if (typeof k === 'symbol') return undefined;
        if (!t.__m) t.__m = {};
        if (!(k in t.__m)) t.__m[k] = mock();
        return t.__m[k];
      },
      // a set wins over the defaults (device.js trackDevice wraps createX)
      set(t, k, v) { over[k] = v; return true; },
      apply() { return mock(); },
    });
  }
  const pass_ = () => mock();
  const limits = new Proxy({}, { get: (t, k) => (typeof k === 'string' ? 8192 : undefined) });
  const queue = mock({ writeTexture() { counts.writes++; }, writeBuffer() { counts.writes++; }, submit() {}, onSubmittedWorkDone: () => Promise.resolve(), copyExternalImageToTexture() {} });
  const mkDevice = () => mock({
    limits, features: new Set(), queue, lost: new Promise(() => {}),
    addEventListener() {}, pushErrorScope() {}, popErrorScope: () => Promise.resolve(null),
    createRenderPipelineAsync: () => Promise.resolve(mock()), createComputePipelineAsync: () => Promise.resolve(mock()),
    createShaderModule: () => mock({ getCompilationInfo: () => Promise.resolve({ messages: [] }) }),
    createCommandEncoder: () => mock({ beginRenderPass: () => pass_(), beginComputePass: () => pass_(), finish: () => mock() }),
    createBuffer: o => { counts.buf++; counts.last.push(o.label || '?'); return { size: o.size, label: o.label, getMappedRange: () => new ArrayBuffer(o.size || 16), mapAsync: () => Promise.resolve(), unmap() {}, destroy() {} }; },
    createTexture: o => { counts.tex++; counts.last.push(o.label || '?'); return { width: (o.size && o.size[0]) || (o.size && o.size.width) || 1, height: (o.size && o.size[1]) || 1, format: o.format, label: o.label, createView: () => mock(), destroy() {} }; },
  });
  let device = null;
  const adapter = mock({ features: new Set(), limits, requestDevice: () => Promise.resolve(device = mkDevice()), info: { vendor: 'apple', architecture: 'metal-3' } });
  function fileFor(url) { const u = new URL(url); return u.protocol === 'file:' ? fileURLToPath(u) : REPO + decodeURIComponent(u.pathname).replace(/^\//, ''); }
  async function fakeFetch(url) {
    const s = String(url && url.url ? url.url : url), path = fileFor(s);
    // no nature assets (no image decode in node): the modules use their own layers
    if (/\/assets\/nature\//.test(s) || !existsSync(path)) return { ok: false, status: 404, text: async () => '', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0), blob: async () => new Blob([]) };
    const buf = readFileSync(path);
    return { ok: true, status: 200, text: async () => buf.toString('utf8'), json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), blob: async () => new Blob([buf]) };
  }
  const html = readFileSync(PAGE + 'index.html', 'utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/stella-nova/pages/dla-terrain/index.html', virtualConsole: new VirtualConsole() });
  const win = dom.window;
  const rafQ = [];
  const G = globalThis;
  // an unclean end of a zoomed session (the last visit "crashed")
  win.localStorage.setItem(GUARD_KEY, JSON.stringify({ t: Date.now() - 60e3, zoomed: true, profile: 'safari', agl: 5 }));
  const defs = {
    window: G, document: win.document, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, Event: win.Event,
    CustomEvent: win.CustomEvent, KeyboardEvent: win.KeyboardEvent, PointerEvent: win.PointerEvent || win.MouseEvent, MouseEvent: win.MouseEvent,
    getComputedStyle: win.getComputedStyle.bind(win), location: win.location, history: win.history, localStorage: win.localStorage,
    innerWidth: 2000, innerHeight: 1260, devicePixelRatio: 2, fetch: fakeFetch,
    requestAnimationFrame: cb => { rafQ.push(cb); return rafQ.length; }, cancelAnimationFrame() {},
    matchMedia: q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    addEventListener: win.addEventListener.bind(win), removeEventListener: win.removeEventListener.bind(win), dispatchEvent: win.dispatchEvent.bind(win),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    GPUMapMode: { READ: 1, WRITE: 2 },
    ImageData: class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } },
  };
  for (const [k, v] of Object.entries(defs)) Object.defineProperty(G, k, { value: v, configurable: true, writable: true });
  // the page clock: performance.now follows the rAF time
  let t = 0;
  Object.defineProperty(G, 'performance', { configurable: true, value: { now: () => t } });
  win.ImageData = G.ImageData;
  Object.defineProperty(G, 'navigator', { value: { gpu: { requestAdapter: () => Promise.resolve(adapter), getPreferredCanvasFormat: () => 'rgba8unorm', wgslLanguageFeatures: new Set() }, userAgent: UA.safari, clipboard: null, maxTouchPoints: 0 }, configurable: true });
  win.HTMLCanvasElement.prototype.getContext = function (type) {
    if (type === 'webgpu') return mock({ configure() {}, getCurrentTexture: () => mock({ width: this.width, height: this.height }) });
    return mock();
  };
  G.Worker = class {
    constructor() { this.onmessage = null; }
    postMessage(m) {
      if (!m || m.type !== 'generate') return;
      const n = 64, height = new Float32Array(n * n).map((_, i) => 30 + 20 * Math.sin(i / 50));
      setTimeout(() => this.onmessage && this.onmessage({ data: { type: 'progress', id: m.id, stage: 'dla', label: 'Growing', frac: 0.05, stageFrac: 0.2, snapshot: { n, height, worldSize: 16000, seaLevel: 0, dla: { pos: new Float32Array([0, 0, 100, 0]), parent: new Int32Array([-1, 0]), count: 2 } } } }), 5);
    }
    terminate() {}
  };
  const errors = [];
  const warn0 = console.warn;
  console.warn = (...a) => { errors.push(a.map(x => (x && x.message) || String(x)).join(' ')); };
  async function pump(n) {
    for (let i = 0; i < n; i++) {
      const q = rafQ.splice(0); t += 1000 / 60;
      for (const cb of q) { try { cb(t); } catch (e) { errors.push('raf: ' + e.message); } }
      await new Promise(r => setTimeout(r, 1));
    }
  }
  let app = null;
  try {
    await import(pathToFileURL(PAGE + 'main.js').href);
    for (let i = 0; i < 400 && !(G.__dlaTerrain && G.__dlaTerrain.fg && rafQ.length); i++) await new Promise(r => setTimeout(r, 5));
    app = G.__dlaTerrain;
  } catch (e) { ok(false, 'page: main.js imports in jsdom', e.stack); }
  if (!app || !app.fg) { ok(false, 'page: the frame graph is up', errors.slice(0, 3).join(' | ')); console.warn = warn0; return; }
  const gpu = app.gpu, fg = app.fg;
  ok(gpu.profileId === 'safe' && /crash guard/.test(gpu.profileWhy || ''), 'page: an unclean zoomed end -> the next boot is in the safe profile', `${gpu.profileId} (${gpu.profileWhy})`);
  const nt = win.document.getElementById('notice');
  ok(nt && !nt.hidden && /safe GPU profile/.test(nt.textContent), 'page: a notice says so', nt && nt.textContent);
  ok(fg.outW * fg.outH <= 2.0e6, 'page: safe at 2000 x 1260 dpr 2 renders under 2 Mpx', `${fg.outW} x ${fg.outH}`);
  ok(gpu.mem && gpu.mem.live > 0, 'page: gpu.mem counts the allocations', gpu.mem && String(gpu.mem.live));
  // the modules plug in
  for (let i = 0; i < 300 && app.loading && app.loading.pending.size; i++) await pump(1);
  await pump(30);
  const roles = fg.modules.map(m => m.role).filter(r => r !== 'build');
  ok(roles.length >= 3, 'page: the package modules plug in', JSON.stringify(roles));
  // zoom: 200 steps in and out with the page camera
  const cam = app.cam, world = app.world;
  cam.mode = 'orbit';
  const tx = 200, tz = -300;
  cam.orbit = { target: [tx, Math.max(world.heightAt(tx, tz), world.seaLevel), tz], yaw: 0.6, pitch: -0.45, dist: 3000 };
  await pump(10);
  const live = [], alloc = [], labels = new Map();
  let minAgl = Infinity, flagZoomed = false;
  for (let step = 0; step < 200; step++) {
    const dir = Math.floor(step / 10) % 2 === 0 ? 1 : -1;
    const a0 = counts.buf + counts.tex, b0 = fg.targetBuilds, l0 = counts.last.length;
    cam.orbitZoomAt(0, 0, dir * 4, world);
    await pump(4);
    // the allocations of a step with no target build (a build is a resize)
    if (fg.targetBuilds === b0) {
      alloc.push(counts.buf + counts.tex - a0);
      if (step >= 40) for (const l of counts.last.slice(l0)) labels.set(l, (labels.get(l) || 0) + 1);
    }
    minAgl = Math.min(minAgl, cam.pos[1] - Math.max(world.heightAt(cam.pos[0], cam.pos[2]), world.seaLevel));
    if (fg.near) { const g = guardRead(win.localStorage); if (g.unclean && g.zoomed) flagZoomed = true; }
    if (step % 20 === 19) live.push(gpu.mem.live);
  }
  ok(minAgl < NEAR_IN, 'page: the zoom loop goes near the ground', minAgl.toFixed(1) + ' m');
  ok(flagZoomed, 'page: the crash flag is written (zoomed) while near the ground');
  console.log(`# page zoom: live MB at the end of each cycle: ${live.map(v => (v / MB).toFixed(1)).join(' ')} (peak ${(gpu.mem.peak / MB).toFixed(1)} MB)`);
  const first = live[1];
  ok(live.length === 10 && live.slice(2).every(v => v <= first + 1 * MB), 'page: no GPU byte growth over 200 zoom steps (real modules)', live.map(v => (v / MB).toFixed(1)).join(' '));
  const steady = alloc.slice(30);
  const perStep = steady.reduce((a, b) => a + b, 0) / Math.max(1, steady.length);
  console.log(`# page zoom: ${steady.length} steps with no target build: ${perStep.toFixed(2)} allocations a step (4 frames), labels ${JSON.stringify([...labels])}; target builds ${fg.targetBuilds}`);
  ok(steady.length > 50 && perStep === 0, 'page: no allocation per frame while zooming (outside a target build)', perStep.toFixed(2) + ' ' + JSON.stringify([...labels]));
  ok(fg.targetBuilds <= 2 * 10 + 4, 'page: at most 2 target builds per zoom cycle (in and out of the near cap)', String(fg.targetBuilds));
  // a clean unload clears the flag
  win.dispatchEvent(new win.Event('pagehide'));
  ok(!guardRead(win.localStorage).unclean, 'page: pagehide clears the crash flag');
  ok(!errors.some(e => /^raf:/.test(e)), 'page: no frame threw', errors.filter(e => /^raf:/.test(e)).slice(0, 2).join(' | '));
  console.warn = warn0;
}

console.log(`# crash: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

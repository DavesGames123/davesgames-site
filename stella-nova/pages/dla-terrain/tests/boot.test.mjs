// tests/boot.test.mjs — the page draws before the modules and assets load
// (node + jsdom, a mock WebGPU, no browser, no GPU).
// Run alone: JSDOM_DIR=<a folder with node_modules/jsdom> node stella-nova/pages/dla-terrain/tests/boot.test.mjs
// Without jsdom the checks are skipped and the skip is named.
//
// The user said (2026-10-17): "DLA terrain page currently renders nothing
// to start which looks really bad." main.js used to await every module
// create (GROUND and VEG fetch about 40 MB of textures and models) before
// the first frame. This test boots the real main.js and index.html with:
//   - a mock WebGPU (every call returns a mock; the frame graph runs),
//   - fetch from the repo files, but every file under assets/nature/
//     (except manifest.json) is held until the test lets it go,
//   - window.__dlaTerrainGate: each module create is held too,
//   - a fake worker that sends one DLA snapshot.
// It checks that, while all of that is held, the frame loop runs, the
// fallback ground and sky draw, the terrain snapshot reaches the GPU
// textures and the load line shows; then that the modules plug in after
// the gate opens, in MODULES order, while the frames go on.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const PAGE = fileURLToPath(new URL('../', import.meta.url));
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} boot: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} boot: ${name} ${extra}`); }
}

let JSDOM = null, VirtualConsole = null;
try {
  const d = process.env.JSDOM_DIR;
  if (d && existsSync(d + '/node_modules/jsdom')) ({ JSDOM, VirtualConsole } = await import(pathToFileURL(d + '/node_modules/jsdom/lib/api.js').href));
  else if (process.env.NODE_PATH) ({ JSDOM, VirtualConsole } = createRequire(process.env.NODE_PATH.split(':')[0] + '/')('jsdom'));
} catch { JSDOM = null; }
if (!JSDOM) {
  console.log('# boot: jsdom not found (set JSDOM_DIR): the boot checks are skipped');
  console.log(`# boot: ${pass} passed, ${fail} failed`);
  process.exit(0);
}

// ── a mock WebGPU: any property is a callable mock, numbers read as 0
const calls = { draws: 0, passes: 0, writeTexture: 0, writeBuffer: 0 };
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
    set(t, k, v) { (t.__m || (t.__m = {}))[k] = v; return true; },
    apply() { return mock(); },
  });
}
const pass_ = () => mock({ draw() { calls.draws++; }, drawIndexed() { calls.draws++; }, drawIndirect() { calls.draws++; }, drawIndexedIndirect() { calls.draws++; } });
const limits = new Proxy({}, { get: (t, k) => (typeof k === 'string' ? 8192 : undefined) });
const queue = mock({
  writeTexture() { calls.writeTexture++; }, writeBuffer() { calls.writeBuffer++; },
  submit() {}, onSubmittedWorkDone: () => Promise.resolve(), copyExternalImageToTexture() {},
});
const device = mock({
  limits, features: new Set(), queue, lost: new Promise(() => {}),
  addEventListener() {}, pushErrorScope() {}, popErrorScope: () => Promise.resolve(null),
  createRenderPipelineAsync: () => Promise.resolve(mock()),
  createComputePipelineAsync: () => Promise.resolve(mock()),
  createShaderModule: () => mock({ getCompilationInfo: () => Promise.resolve({ messages: [] }) }),
  createCommandEncoder: () => mock({ beginRenderPass: () => { calls.passes++; return pass_(); }, beginComputePass: () => pass_(), finish: () => mock() }),
  createBuffer: o => mock({ size: o.size, getMappedRange: () => new ArrayBuffer(o.size || 16), mapAsync: () => Promise.resolve(), unmap() {}, destroy() {} }),
  createTexture: o => mock({ width: (o.size && o.size[0]) || o.size.width || 1, height: (o.size && o.size[1]) || 1, format: o.format, destroy() {} }),
});
const adapter = mock({ features: new Set(), limits, requestDevice: () => Promise.resolve(device), info: {} });

// ── fetch from the repo; assets/nature/ files wait for the test
const held = [];
let release = false;
function fileFor(url) {
  const u = new URL(url);
  if (u.protocol === 'file:') return fileURLToPath(u);
  return REPO + decodeURIComponent(u.pathname).replace(/^\//, '');
}
function respond(path) {
  if (!existsSync(path)) return { ok: false, status: 404, text: async () => '', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0), blob: async () => new Blob([]) };
  const buf = readFileSync(path);
  return { ok: true, status: 200, text: async () => buf.toString('utf8'), json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), blob: async () => new Blob([buf]) };
}
async function fakeFetch(url) {
  const s = String(url && url.url ? url.url : url);
  const path = fileFor(s);
  if (/\/assets\/nature\//.test(s) && !/manifest\.json$/.test(s)) {
    if (!release) await new Promise(r => held.push(r));
  }
  return respond(path);
}

// ── the page in jsdom
const html = readFileSync(PAGE + 'index.html', 'utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/stella-nova/pages/dla-terrain/index.html', pretendToBeVisual: false, virtualConsole: new VirtualConsole() });
const win = dom.window;
const rafQ = [];
const G = globalThis;
const defs = {
  window: G, document: win.document, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, Event: win.Event,
  CustomEvent: win.CustomEvent, KeyboardEvent: win.KeyboardEvent, PointerEvent: win.PointerEvent || win.MouseEvent, MouseEvent: win.MouseEvent,
  getComputedStyle: win.getComputedStyle.bind(win), location: win.location, history: win.history, localStorage: win.localStorage,
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, fetch: fakeFetch,
  requestAnimationFrame: cb => { rafQ.push(cb); return rafQ.length; }, cancelAnimationFrame() {},
  matchMedia: q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  addEventListener: win.addEventListener.bind(win), removeEventListener: win.removeEventListener.bind(win), dispatchEvent: win.dispatchEvent.bind(win),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  GPUBufferUsage: { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 },
  GPUTextureUsage: { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 },
  GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }, GPUMapMode: { READ: 1, WRITE: 2 },
  ImageData: class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } },
};
for (const [k, v] of Object.entries(defs)) Object.defineProperty(G, k, { value: v, configurable: true, writable: true });
win.ImageData = G.ImageData;
Object.defineProperty(G, 'navigator', { value: { gpu: { requestAdapter: () => Promise.resolve(adapter), getPreferredCanvasFormat: () => 'rgba8unorm', wgslLanguageFeatures: new Set() }, userAgent: 'node', clipboard: null, maxTouchPoints: 0 }, configurable: true });
win.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === 'webgpu') return mock({ configure() {}, getCurrentTexture: () => mock({ width: this.width, height: this.height }) });
  return mock();
};
// the fake worker: one DLA snapshot of a small tree, then nothing
let genMsgs = 0, lastGenOpts = null;
G.Worker = class {
  constructor() { this.onmessage = null; }
  postMessage(m) {
    if (!m || m.type !== 'generate') return;
    genMsgs++; lastGenOpts = m.opts;
    const n = 32, height = new Float32Array(n * n).map((_, i) => (i % 7) * 3);
    setTimeout(() => this.onmessage && this.onmessage({ data: { type: 'progress', id: m.id, stage: 'dla', label: 'Growing DLA ridges, level 1 of 4', frac: 0.05, stageFrac: 0.2, snapshot: { n, height, worldSize: 16000, seaLevel: 0, dla: { pos: new Float32Array([0, 0, 100, 0]), parent: new Int32Array([-1, 0]), count: 2 } } } }), 5);
  }
  terminate() {}
};
// hold every module create until the test opens the gate
let openGate = null;
const gate = new Promise(r => { openGate = r; });
const gated = [];
G.__dlaTerrainGate = role => { gated.push(role); return gate; };

const errors = [];
const warn0 = console.warn;
console.warn = (...a) => { errors.push(a.map(x => (x && x.message) || String(x)).join(' ')); };
let t = 0;
async function pump(n) {
  for (let i = 0; i < n; i++) {
    const q = rafQ.splice(0); t += 1000 / 30;
    for (const cb of q) { try { cb(t); } catch (e) { errors.push('raf: ' + e.message); } }
    await new Promise(r => setTimeout(r, 2));
  }
}

let app = null;
try {
  await import(pathToFileURL(PAGE + (process.env.BOOT_MAIN || 'main.js')).href);
  for (let i = 0; i < 400 && !(G.__dlaTerrain && G.__dlaTerrain.fg && rafQ.length); i++) await new Promise(r => setTimeout(r, 5));
  app = G.__dlaTerrain;
} catch (e) { ok(false, 'main.js imports in jsdom', e.stack); }

if (app && !app.fg) ok(false, 'the frame graph is up while the module creates are held', errors.slice(0, 4).join(' | ').slice(0, 600));
if (app && app.fg) {
  ok(true, 'the frame graph is up while the module creates are held');
  // wrap the fallback draws to count them
  let fbGround = 0, fbSky = 0;
  const fgr = app.fg.fallbacks.ground, fsk = app.fg.fallbacks.sky;
  if (fgr && fgr.drawOpaque) { const d = fgr.drawOpaque; fgr.drawOpaque = (...a) => { fbGround++; return d.apply(fgr, a); }; }
  if (fsk) for (const k of ['drawSky', 'drawOpaque']) if (fsk[k]) { const d = fsk[k]; fsk[k] = (...a) => { fbSky++; return d.apply(fsk, a); }; }
  const f0 = app.frames || 0;
  await pump(30);
  const f1 = app.frames || 0;
  ok(gated.length === 4, 'all four module creates wait on the gate', JSON.stringify(gated));
  ok(app.fg.modules.filter(m => m.role !== 'build').length === 0, 'no package module is in before the gate opens', String(app.fg.modules.length));
  ok(f1 - f0 >= 25, 'the frame loop runs before the modules and assets load', `${f0} -> ${f1}`);
  ok(fbGround >= 25, 'the fallback ground draws every frame meanwhile', String(fbGround));
  ok(fbSky >= 25, 'the fallback sky draws every frame meanwhile', String(fbSky));
  ok(calls.passes > 0 && calls.draws > 0, 'render passes and draws reach the device', `${calls.passes} passes, ${calls.draws} draws`);
  ok(genMsgs >= 1, 'generate() goes to the worker before the modules load', String(genMsgs));
  // REVEAL (reveal.js, 2026-10-18, the user: "dla doesn't need to show
  // everything as it loads"): the canvas waits under the veil, and the
  // DLA snapshots do not go to the terrain textures meanwhile
  const cv = G.document.getElementById('view');
  ok(app.reveal && app.reveal.hiding && parseFloat(cv.style.opacity) === 0 && app.reveal.veil, 'the canvas waits under the loading veil while the world is made', app.reveal && `${app.reveal.state.phase} ${cv.style.opacity}`);
  ok(app.tg && app.tg.stage !== 'dla', 'no DLA snapshot goes to the terrain textures under the veil', app.tg && `${app.tg.stage} ${app.tg.cpuN}`);
  const ll = win.document.getElementById('loadLine');
  ok(ll && !ll.hidden && /Loading/.test(ll.textContent), 'the load line shows while the modules load', ll && ll.textContent);
  // open the gate: the modules plug in, the assets are still held
  openGate();
  for (let i = 0; i < 200 && app.loading && app.loading.pending.size; i++) await pump(1);
  const roles = app.fg.modules.map(m => m.role).filter(r => r !== 'build');
  ok(app.loading && app.loading.pending.size === 0, 'every module create settles after the gate opens', JSON.stringify(app.loading && [...app.loading.pending]));
  console.log('# boot: plugged', JSON.stringify(roles));
  ok(roles.length > 0, 'package modules plug in after the gate opens', JSON.stringify(roles) + ' ' + errors.filter(e => /failed|did not load/.test(e)).slice(0, 3).join(' | ').slice(0, 300));
  const order = ['ground', 'vegetation', 'sky', 'water'];
  ok(roles.every((r, i) => i === 0 || order.indexOf(roles[i - 1]) < order.indexOf(r)), 'the plugged modules keep the MODULES draw order', JSON.stringify(roles));
  const f2 = app.frames;
  await pump(10);
  ok(app.frames - f2 >= 9, 'the frames go on after the modules plug in', `${f2} -> ${app.frames}`);
  ok(held.length > 0 || release, 'asset fetches are still held after the modules plugged in (no create waits on them)', String(held.length));
  ok(!ll.hidden, 'the load line stays while the assets are held', ll.textContent);
  release = true; held.splice(0).forEach(r => r());
  // PHONE requests: the grid cap, TAA off and the quality note on a phone profile
  const g = app.gpu, saved = { profile: g.profile, profileId: g.profileId };
  g.profile = { ...(g.profile || {}), maxN: 512, taa: false, label: 'Phone' }; g.profileId = 'phone';
  app.opts.n = 2048; app.generate();
  ok(lastGenOpts && lastGenOpts.n === 512, 'a phone profile caps the grid n at gpu.profile.maxN', lastGenOpts && String(lastGenOpts.n));
  app.setQuality(3);
  const nt = win.document.getElementById('notice');
  ok(nt && !nt.hidden && /Phone quality: Phone caps the sizes/.test(nt.textContent), 'High or Ultra on a phone shows the Phone quality note', nt && nt.textContent);
  ok(app.post && app.post.settings.taa === false, 'TAA stays off on a phone profile', app.post && String(app.post.settings.taa));
  g.profile = saved.profile; g.profileId = saved.profileId;
  // CAMERA requests: the camera ground includes LIB's detailHeight, and
  // the trunk query of VEG reaches the camera world
  const lib = await import(pathToFileURL(PAGE + '../../lib/dla-terrain.js').href);
  const tt = await lib.generateTerrain({ ...lib.PRESETS.alpine.opts, seed: 3, n: 128 });
  const cpu0 = app.tg.cpu; app.tg.cpu = tt;
  let same = true, differs = false;
  for (const [x, z] of [[100, 200], [-3000, 1500], [2500, -2500]]) {
    const a = app.world.heightAt(x, z), b = lib.terrainHeightAt(tt, x, z);
    if (Math.abs(a - b) > 1e-6) same = false;
    if (Math.abs(a - lib.sampleHeight(tt, x, z)) > 1e-3) differs = true;
  }
  ok(same && differs, 'world.heightAt is the rendered ground (sampleHeight + detailHeight) on a final terrain');
  app.tg.cpu = cpu0;
  const fakeVeg = { role: 'vegetation', trunkAt: (x, z) => ({ x: x + 1, z, r: 0.3 }) };
  const mods0 = app.fg.modules;
  app.fg.modules = mods0.filter(m => m.role !== 'vegetation').concat(fakeVeg);
  const tr = app.world.trunkAt(5, 6);
  ok(tr && tr.x === 6 && tr.r === 0.3, 'world.trunkAt passes the VEG trunk query to the camera');
  app.fg.modules = mods0;
  await pump(5);
  ok(!errors.some(e => /^raf:/.test(e)), 'no frame threw', errors.filter(e => /^raf:/.test(e)).slice(0, 2).join(' | '));
}
console.warn = warn0;
console.log(`# boot: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

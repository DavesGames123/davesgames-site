// ============================================================================
//  HUMAN SKELETON  ·  tests-dom.mjs — the page in jsdom, no browser
// ────────────────────────────────────────────────────────────────────────────
//  The user asked: "clicking a bone on the skeleton page should isolate it"
//  and "or at least move the camera to it". This file boots main.js in
//  jsdom with the real three.js r160 and the real shipped meshes. Only the
//  WebGL renderer and the PMREM generator are stand-ins (no GL in node), so
//  nothing is drawn; the state, the DOM, the camera and the picks are real.
//    node tests-dom.mjs            runs the desktop and the phone boot, each
//                                  in its own child process
//    node tests-dom.mjs desktop    one boot (main.js keeps module state)
//  jsdom is not in the repo. JSDOM_DIR names the jsdom folder, or a folder
//  whose node_modules holds jsdom; NODE_PATH also works.
//
//  GREP MAP
//    function loadJsdom / function boot              jsdom, globals, three shim
//    function press / tap / drag                     pointer input
//    async function desktop / async function phone   the checks
// ============================================================================
import { createRequire, register } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const SN = join(ROOT, 'stella-nova');
const T160 = pathToFileURL(join(SN, 'vendor/three@0.160.0/build/three.module.js')).href;
const ADDONS = pathToFileURL(join(SN, 'vendor/three@0.160.0/examples/jsm/')).href;

const mode = process.argv[2];
if (!mode) {
  let failed = 0;
  for (const m of ['desktop', 'phone']) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), m], { encoding: 'utf8', env: process.env, timeout: 240000 });
    process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
    if (r.status !== 0) failed++;
  }
  process.exit(failed ? 1 : 0);
}

let pass = 0, fail = 0;
const ok = (cond, name, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  [${mode}] ${name}${info !== '' ? '  ' + info : ''}`); };

function loadJsdom() {
  const tries = [];
  const dir = process.env.JSDOM_DIR;
  if (dir) { tries.push(() => createRequire(join(dir, 'x.js'))(dir)); tries.push(() => createRequire(join(dir, 'x.js'))('jsdom')); }
  tries.push(() => createRequire(import.meta.url)('jsdom'));
  for (const t of tries) { try { return t().JSDOM; } catch (e) { /* next */ } }
  return null;
}

// the three shim: the real r160 with a renderer and a PMREM stand-in
const SHIM = `import * as T from ${JSON.stringify(T160)};
export * from ${JSON.stringify(T160)};
export class WebGLRenderer {
  constructor(o = {}) {
    this.domElement = o.canvas; this.capabilities = { isWebGL2: true }; this.pr = 1; this.size = [0, 0];
    this.shadowMap = { enabled: false, type: 0, autoUpdate: true, needsUpdate: false };
    this.outputColorSpace = ''; this.toneMapping = 0; this.toneMappingExposure = 1; this.renders = 0;
    this.xr = { enabled: false, isPresenting: false, addEventListener() {}, removeEventListener() {}, getController: () => new T.Group(), getControllerGrip: () => new T.Group(), getHand: () => new T.Group(), setReferenceSpaceType() {}, getCamera: () => new T.PerspectiveCamera() };
  }
  setPixelRatio(p) { this.pr = p; } getPixelRatio() { return this.pr; }
  setSize(w, h) { this.size = [w, h]; } getSize(v) { return v.set(this.size[0], this.size[1]); }
  getDrawingBufferSize(v) { return v.set(this.size[0] * this.pr, this.size[1] * this.pr); }
  setClearColor() {} getClearColor(c) { return c; } getClearAlpha() { return 0; } setClearAlpha() {} clear() {}
  setRenderTarget() {} getRenderTarget() { return null; } readRenderTargetPixels() {}
  setAnimationLoop() {} compile() {}
  render(scene, camera) { this.renders++; scene.updateMatrixWorld(); if (camera.parent === null) camera.updateMatrixWorld(); }
  getContext() { return { isContextLost: () => false }; }
  dispose() {} forceContextLoss() {}
}
export class PMREMGenerator { constructor() {} fromScene() { return { texture: new T.Texture(), dispose() {} }; } compileEquirectangularShader() {} dispose() {} }
`;

async function boot({ W, H, phone }) {
  const JSDOM = loadJsdom();
  if (!JSDOM) { console.log(`SKIP  [${mode}] jsdom not found (set JSDOM_DIR or NODE_PATH)`); process.exit(2); }
  register('data:text/javascript,' + encodeURIComponent(`
    const SHIM = ${JSON.stringify('data:text/javascript,' + encodeURIComponent(SHIM))};
    export async function resolve(s, c, n) {
      if (s === 'three') return { url: SHIM, shortCircuit: true };
      if (s.startsWith('three/addons/')) return { url: ${JSON.stringify(ADDONS)} + s.slice(13), shortCircuit: true };
      return n(s, c);
    }`));
  const html = readFileSync(join(HERE, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const url = 'http://localhost/stella-nova/pages/human-skeleton/index.html';
  const dom = new JSDOM(html, { url, pretendToBeVisual: false });
  const win = dom.window, doc = win.document, G = globalThis;
  // media queries: a desktop with a mouse, or a phone with touch
  const mq = q => {
    let m = false;
    if (/reduced-motion/.test(q)) m = false;
    else if (/hover:hover/.test(q)) m = !phone;
    else if (/pointer:\s*coarse/.test(q) && !/max-width|max-height/.test(q)) m = phone;
    else if (/max-width:768px/.test(q)) m = phone;
    else if (/orientation:landscape/.test(q)) m = W > H;
    return { matches: m, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  };
  win.matchMedia = mq;
  for (const [k, v] of [['innerWidth', W], ['innerHeight', H], ['devicePixelRatio', phone ? 3 : 2]]) Object.defineProperty(win, k, { value: v, configurable: true, writable: true });
  // the 2D context: the backdrop and the pool texture only fill gradients
  const grad = { addColorStop() {} };
  win.HTMLCanvasElement.prototype.getContext = function (k) {
    if (k !== '2d') return null;
    return new Proxy({}, { get: (t, p) => (p === 'canvas' ? this : p in t ? t[p] : (p === 'createRadialGradient' || p === 'createLinearGradient') ? () => grad : p === 'measureText' ? s => ({ width: String(s).length * 6 }) : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
  };
  // layout: the canvas fills the stage; other boxes come from RECTS
  const top = phone ? 46 : 52, stageH = H - top - (phone ? 66 : 0);
  const RECTS = new Map();
  const rect = (x, y, w, h) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON() {} });
  win.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'view') return rect(0, top, W, stageH);
    const f = RECTS.get(this.id);
    return f ? f(this) : rect(0, 0, 0, 0);
  };
  for (const k of ['clientWidth', 'clientHeight']) Object.defineProperty(win.HTMLElement.prototype, k, { configurable: true, get() { return this.id === 'view' ? (k === 'clientWidth' ? W : stageH) : 0; } });
  win.Element.prototype.setPointerCapture = function () {}; win.Element.prototype.releasePointerCapture = function () {};
  win.Element.prototype.hasPointerCapture = () => false;
  win.Element.prototype.scrollIntoView = function () {};
  // the clock and the frame queue
  let clock = 1000, rafQ = [], rafId = 0;
  Object.defineProperty(G, 'performance', { value: { now: () => clock, mark() {}, measure() {}, timeOrigin: 0 }, configurable: true, writable: true });
  win.requestAnimationFrame = cb => { rafQ.push([++rafId, cb]); return rafId; };
  win.cancelAnimationFrame = id => { rafQ = rafQ.filter(x => x[0] !== id); };
  // fetch: files under the repo root
  const fetchFile = async u => {
    const p = new URL(String(u), url).pathname;
    const f = join(ROOT, decodeURIComponent(p));
    if (!existsSync(f)) return new Response('missing', { status: 404 });
    return new Response(readFileSync(f));
  };
  win.fetch = fetchFile;
  const keys = ['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLCanvasElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent', 'getComputedStyle', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'self', 'DOMParser', 'Image', 'HTMLImageElement', 'ResizeObserver'];
  for (const k of keys) {
    const v = k === 'window' || k === 'self' ? win : win[k];
    if (v === undefined) continue;
    Object.defineProperty(G, k, { value: typeof v === 'function' && /^[a-z]/.test(k) ? v.bind(win) : v, configurable: true, writable: true });
  }
  G.fetch = fetchFile;
  G.addEventListener = win.addEventListener.bind(win); G.removeEventListener = win.removeEventListener.bind(win);
  G.dispatchEvent = win.dispatchEvent.bind(win);
  const errors = [];
  win.addEventListener('error', e => errors.push(String(e.message || e)));
  const origErr = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ')); };
  await import(pathToFileURL(join(HERE, 'main.js')).href);
  console.error = origErr;
  const step = (ms = 16.7) => { clock += ms; const q = rafQ; rafQ = []; for (const [, cb] of q) cb(clock); };
  const settle = async (pred, max = 4000) => { for (let k = 0; k < max; k++) { if (pred()) return true; await new Promise(r => setTimeout(r, 0)); step(); } return pred(); };
  return { win, doc, step, settle, RECTS, rect, errors, top, stageH, W, H, tick: ms => { clock += ms; } };
}

// ── pointer input ───────────────────────────────────────────────────────────
let pid = 1;
function pev(env, type, x, y, o = {}) {
  const C = env.win.PointerEvent || env.win.MouseEvent;
  const e = new C(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: o.button ?? 0, buttons: o.buttons ?? 0 });
  for (const [k, v] of [['pointerId', o.id ?? 1], ['pointerType', o.type || 'mouse'], ['isPrimary', true]]) Object.defineProperty(e, k, { value: v });
  return e;
}
function press(env, x, y, o = {}) { const cv = env.doc.getElementById('view'); cv.dispatchEvent(pev(env, 'pointerdown', x, y, { ...o, buttons: 1 })); }
function release(env, x, y, o = {}) { const cv = env.doc.getElementById('view'); cv.dispatchEvent(pev(env, 'pointerup', x, y, o)); }
function move(env, x, y, o = {}) { const cv = env.doc.getElementById('view'); cv.dispatchEvent(pev(env, 'pointermove', x, y, o)); }
function tap(env, x, y, o = {}) { const id = pid++; press(env, x, y, { ...o, id }); env.tick(90); release(env, x, y, { ...o, id }); }
function drag(env, x, y, dx, dy, back = false, o = {}) {
  const id = pid++;
  press(env, x, y, { ...o, id });
  for (let k = 1; k <= 8; k++) { env.tick(16); move(env, x + dx * k / 8, y + dy * k / 8, { ...o, id, buttons: 1 }); env.step(); }
  if (back) for (let k = 7; k >= 0; k--) { env.tick(16); move(env, x + dx * k / 8, y + dy * k / 8, { ...o, id, buttons: 1 }); env.step(); }
  const ex = back ? x : x + dx, ey = back ? y : y + dy;
  release(env, ex, ey, { ...o, id });
}

// ── desktop ─────────────────────────────────────────────────────────────────
async function desktop() {
  const env = await boot({ W: 1440, H: 900, phone: false });
  const hs = env.win.__hs, S = hs.S;
  const loaded = await env.settle(() => hs.T.allBones > 0 && !hs.busy());
  ok(loaded && S.groups.size === 8, 'boot: main.js loads the eight body groups in jsdom', `${S.groups.size} groups, ${env.errors.length} errors${env.errors.length ? ': ' + env.errors.slice(0, 2).join(' | ') : ''}`);
  const byId = id => S.P.byId.get(id).i;
  const pickN = S.bones.filter(b => S.loaded[b.i]).length;
  ok(S.pick.filter(Boolean).length === pickN && pickN > 200, 'boot: every loaded bone has a pick mesh', `${S.pick.filter(Boolean).length}/${pickN}`);

  // pick: a click on the shaft of a long bone picks that bone
  const longs = ['femur-l', 'femur-r', 'tibia-l', 'humerus-r', 'radius-l'];
  const got = longs.map(id => { const p = hs.screenOf(id); return S.bones[hs.pickAt(p.x, p.y)]?.id; });
  ok(got.every((g, k) => g === longs[k]), 'pick: the canvas point of a long bone picks that bone on its mesh', got.join(', '));
  const p0 = hs.screenOf('femur-l');
  ok(hs.pickAt(p0.x + 300, env.top + 30) === -1, 'pick: a point in the empty room picks nothing');

  // drag: an orbit never selects, also a drag that comes back to its start
  const cam0 = hs.camera.position.clone();
  drag(env, p0.x, p0.y, 160, 30);
  for (let k = 0; k < 30; k++) env.step();
  const turned = hs.camera.position.distanceTo(cam0);
  ok(S.sel === -1 && S.iso === -1 && turned > 0.05, 'drag: an orbit drag that starts on a bone does not select it', `sel ${S.sel}, camera moved ${turned.toFixed(2)} m`);
  hs.fitView(true); env.step();

  // WebXR: the controller ray pick runs the same mesh pick in scene space
  const xr = await import(pathToFileURL(join(HERE, 'app/xr.js')).href);
  const THREE = await import(T160);
  const c = hs.camera.position.clone(), f = new THREE.Vector3(...S.bones[byId('femur-r')].c);
  const xi = xr.pickRay(new THREE.Ray(c, f.clone().sub(c).normalize()));
  ok(S.bones[xi]?.id === 'femur-r', 'xr: the controller ray at the femur picks it on the mesh', S.bones[xi]?.id || 'none');
  return env;
}

// ── phone ───────────────────────────────────────────────────────────────────
async function phone() {
  const env = await boot({ W: 390, H: 844, phone: true });
  const hs = env.win.__hs, S = hs.S;
  const loaded = await env.settle(() => hs.T.allBones > 0 && !hs.busy());
  ok(loaded, 'boot: the phone page loads', `${S.groups.size} groups, ${env.errors.length} errors`);
  const p = hs.screenOf('femur-l');
  const id = S.bones[hs.pickAt(p.x + 9, p.y)]?.id, bare = hs.pickAt(p.x + 9, p.y, 0);
  ok(id === 'femur-l' && bare === -1, 'pick: a touch 9 px off the femur shaft misses the mesh but picks it with the touch tolerance', `${id || 'none'}, no tolerance: ${bare}`);
  return env;
}

const env = mode === 'desktop' ? await desktop() : await phone();
console.log(`[${mode}] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

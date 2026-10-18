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
  const p1 = hs.screenOf('femur-l');
  drag(env, p1.x, p1.y, 60, 0, true);
  for (let k = 0; k < 30; k++) env.step();
  ok(S.sel === -1 && S.iso === -1, 'drag: a drag that comes back to its start does not select', `sel ${S.sel}`);
  hs.fitView(true); env.step();

  // frame: isolate flies the camera to frame the bone
  env.RECTS.set('panel', () => env.rect(0, env.top, 340, env.stageH));
  env.RECTS.set('card', el => el.hidden ? env.rect(0, 0, 0, 0) : env.rect(env.W - 348, env.top + 14, 332, 600));
  const THREE = await import(T160);
  const frameCheck = async (id, name) => {
    const i = byId(id);
    const start = hs.camera.position.clone(), t0 = performance.now();
    hs.isolate(i);
    const goal = hs.boneGoal(i);
    const path = [hs.camera.position.clone()];
    let frames = 0;
    while (S.fly && frames < 400) { env.step(); frames++; path.push(hs.camera.position.clone()); }
    for (let k = 0; k < 40; k++) env.step();
    const secs = (performance.now() - t0) / 1000 - 40 * 0.0167;
    const c = hs.boneCentre(i), tgtErr = hs.controls.target.distanceTo(c);
    const dist = hs.camera.position.distanceTo(hs.controls.target);
    const cr = hs.clearRect(), fy = Math.tan(THREE.MathUtils.degToRad(hs.camera.fov) / 2);
    const short = Math.min(cr.x1 - cr.x0, cr.y1 - cr.y0);
    const rpx = Math.tan(Math.asin(S.bones[i].r / dist)) / fy * cr.h / 2;
    const p = c.clone().project(hs.camera), px = (p.x + 1) / 2 * cr.w, py = (1 - p.y) / 2 * cr.h;
    const off = Math.hypot(px - (cr.x0 + cr.x1) / 2, py - (cr.y0 + cr.y1) / 2);
    const steps = path.slice(1).map((q, k) => q.distanceTo(path[k]));
    const mean = steps.reduce((a, b) => a + b, 0) / Math.max(1, steps.length), peak = Math.max(...steps);
    ok(tgtErr < 1e-6 && Math.abs(2 * rpx / short - 0.6) < 0.01 && off < 1.5, `frame ${name}: the orbit target is the bone centre and its sphere fills 0.6 of the clear short side`,
      `target off ${tgtErr.toExponential(1)} m, fill ${(2 * rpx / short).toFixed(3)}, centre off ${off.toFixed(2)} px, clear ${cr.x0.toFixed(0)}..${cr.x1.toFixed(0)} x ${cr.y0.toFixed(0)}..${cr.y1.toFixed(0)}`);
    ok(secs > 0.8 && secs < 1.2 && peak / mean < 2, `frame ${name}: the glide takes 0.8 to 1.2 s with no lunge`, `${secs.toFixed(2)} s, ${frames} frames, peak step ${(peak / mean).toFixed(2)} x the mean, moved ${start.distanceTo(hs.camera.position).toFixed(2)} m`);
    return goal;
  };
  await frameCheck('femur-l', 'femur');
  const g6 = await frameCheck('t6', 'T6 (behind the ribs)');
  ok(g6.los === 0, 'frame T6: the camera takes a direction with no bone on the line of sight', `los ${g6.los}, path ${g6.path}`);
  await frameCheck('dpt5-r', 'distal phalanx of the little toe');
  hs.exitIsolate(true);
  for (let k = 0; k < 90; k++) env.step();
  hs.fitView(true); env.step();
  await isoChecks(env, hs, S, byId);
  await clickChecks(env, hs, S, byId);

  // WebXR: the controller ray pick runs the same mesh pick in scene space
  const xr = await import(pathToFileURL(join(HERE, 'app/xr.js')).href);
  const c = hs.camera.position.clone(), f = new THREE.Vector3(...S.bones[byId('femur-r')].c);
  const xi = xr.pickRay(new THREE.Ray(c, f.clone().sub(c).normalize()));
  ok(S.bones[xi]?.id === 'femur-r', 'xr: the controller ray at the femur picks it on the mesh', S.bones[xi]?.id || 'none');

  // the saver: no isolation UI. enter() ends an isolation and closes the
  // card; the saver CSS hides every child of #stage but the canvas
  const chip = env.doc.getElementById('isoChip');
  hs.isolate(byId('femur-l')); runFrames(env, 70);
  const shown = !chip.hidden;
  env.win.snSaver.enter({ seed: 3, label: () => {} });
  runFrames(env, 120);
  const css = [...env.doc.head.querySelectorAll('style')].map(s => s.textContent).join('');
  ok(shown && S.iso === -1 && chip.hidden && env.doc.getElementById('card').hidden && /#stage>\*:not\(#view\)\{?/.test(css.replace(/\s/g, '')) && chip.matches('#stage>*:not(#view)'),
    'saver: enter() ends the isolation; the chip is hidden and its saver rule hides it', `iso ${S.iso}, chip hidden ${chip.hidden}`);
  const pf = hs.screenOf('femur-r');
  tap(env, pf.x, pf.y); env.tick(500); runFrames(env, 5);
  env.win.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'i', bubbles: true }));
  hs.isolate(byId('femur-r')); runFrames(env, 5);
  ok(S.iso === -1 && S.sel === -1 && chip.hidden, 'saver: a tap, the i key or isolate() bring no isolation in the saver', `iso ${S.iso}, sel ${S.sel}`);
  return env;
}

// ── isolation: the chip, ghost / hide, step, Esc, the list, exact restore ──
const flag = (S, i) => S.state.get(2, i, 3);
const runFrames = (env, n) => { for (let k = 0; k < n; k++) env.step(); };
async function isoChecks(env, hs, S, byId) {
  const doc = env.doc, chip = doc.getElementById('isoChip');
  env.RECTS.set('isoChip', el => el.hidden ? env.rect(0, 0, 0, 0) : env.rect(358, env.top + env.stageH - 60, 560, 44));
  const fem = byId('femur-l');
  // the state before: the femur selected, not isolated
  hs.select(fem); runFrames(env, 60);
  doc.getElementById('view').dispatchEvent(new env.win.Event('pointerleave'));
  runFrames(env, 2);
  const before = { data: S.state.data.slice(), ghosts: [...S.groups.values()].map(g => g.ghost.visible), mats: [...S.groups.values()].map(g => g.mesh.material === S.mats.bone && g.ghost.material === S.mats.ghost) };
  const camBefore = { t: hs.controls.target.clone(), p: hs.camera.position.clone() };
  // the list row does the same as a click: isolate and frame
  const row = doc.querySelector(`#list .br[data-i="${fem}"]`);
  row.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
  runFrames(env, 80);
  const others = S.bones.filter(b => b.i !== fem && S.vis[b.i]).map(b => b.i);
  ok(S.iso === fem && !chip.hidden && /Isolated:\s*Femur/.test(chip.textContent) && /Left/.test(doc.getElementById('isoName').textContent),
    'list: a row isolates its bone and the chip names it', `iso ${S.bones[S.iso]?.id}, chip "${chip.textContent.replace(/\s+/g, ' ').trim()}"`);
  ok(hs.controls.target.distanceTo(hs.boneCentre(fem)) < 1e-6 && !S.fly, 'list: the row glides the camera to the bone, the orbit target at its centre');
  ok(flag(S, fem) === 0 && others.every(i => flag(S, i) === 2) && [...S.groups.values()].every(g => g.ghost.visible),
    'isolate: the bone stays solid, every other shown bone is a ghost', `${others.length} ghosts`);
  ok(S.state.get(3, fem, 0) > 0 && S.state.get(3, fem, 0) < 1, 'isolate: the bone has a soft rim glow, not the full selection glow', S.state.get(3, fem, 0).toFixed(2));
  const card = doc.getElementById('card');
  ok(!card.hidden && /Femur/.test(card.querySelector('.c-name').textContent) && doc.querySelector('#list .br.sel')?.dataset.i === String(fem), 'isolate: the card and the list row are in sync');
  // the chip does not cover the bone: it is in the clear part
  const cr = hs.clearRect();
  const c = hs.boneCentre(fem), dist = hs.camera.position.distanceTo(c), THREE = await import(T160);
  const fy = Math.tan(THREE.MathUtils.degToRad(hs.camera.fov) / 2), rpx = Math.tan(Math.asin(S.bones[fem].r / dist)) / fy * cr.h / 2;
  const py = (1 - c.clone().project(hs.camera).y) / 2 * cr.h;
  const chipTop = env.stageH - 60;
  ok(cr.o.b >= 60 && py + rpx <= chipTop + 0.5, 'chip: the framed bone sphere stays above the chip', `bottom inset ${cr.o.b.toFixed(0)} px, sphere bottom ${(py + rpx).toFixed(0)} px, chip top ${chipTop} px`);
  // Hide, then Ghost
  chip.querySelector('[data-act="hide"]').click(); runFrames(env, 2);
  ok(S.isoHide && others.every(i => flag(S, i) === 1) && flag(S, fem) === 0 && [...S.groups.values()].every(g => !g.ghost.visible),
    'chip: Hide hides every other bone and the ghost meshes');
  const sk = hs.screenOf('humerus-l');
  ok(S.bones[hs.pickAt(sk.x, sk.y)]?.id !== 'humerus-l', 'pick: a hidden bone never picks (the humerus point gives no humerus)', String(hs.pickAt(sk.x, sk.y)));
  chip.querySelector('[data-act="ghost"]').click(); runFrames(env, 2);
  ok(!S.isoHide && others.every(i => flag(S, i) === 2), 'chip: Ghost turns them back to ghosts');
  // next / previous in the region
  const reg = S.bones.filter(b => b.region === S.bones[fem].region && S.vis[b.i]).map(b => b.i);
  const k = reg.indexOf(fem), nx = reg[(k + 1) % reg.length];
  chip.querySelector('[data-act="next"]').click(); runFrames(env, 80);
  ok(S.iso === nx && S.sel === nx && flag(S, fem) === 2 && flag(S, nx) === 0 && card.querySelector('.c-name').textContent.includes(S.bones[nx].name),
    'chip: Next isolates the next bone of the region and frames it', `${S.bones[fem].id} -> ${S.bones[S.iso].id}, target off ${hs.controls.target.distanceTo(hs.boneCentre(nx)).toExponential(1)} m`);
  chip.querySelector('[data-act="prev"]').click(); runFrames(env, 80);
  ok(S.iso === fem, 'chip: Previous comes back', S.bones[S.iso]?.id);
  // Esc: show all, the camera goes back, every material as it was
  env.win.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  runFrames(env, 90);
  doc.getElementById('view').dispatchEvent(new env.win.Event('pointerleave'));
  runFrames(env, 2);
  const after = { data: S.state.data, ghosts: [...S.groups.values()].map(g => g.ghost.visible), mats: [...S.groups.values()].map(g => g.mesh.material === S.mats.bone && g.ghost.material === S.mats.ghost) };
  let diff = 0;
  for (let q = 0; q < after.data.length; q++) if (after.data[q] !== before.data[q]) diff++;
  ok(S.iso === -1 && chip.hidden && diff === 0 && after.ghosts.join() === before.ghosts.join() && after.mats.every(Boolean),
    'Esc: Show all restores the bone state texture and the materials bit for bit', `${diff} of ${after.data.length} floats differ, chip hidden ${chip.hidden}`);
  ok(hs.controls.target.distanceTo(camBefore.t) < 1e-6 && hs.camera.position.distanceTo(camBefore.p) < 1e-4, 'Esc: the camera goes back to the view from before the isolation',
    `target off ${hs.controls.target.distanceTo(camBefore.t).toExponential(1)} m, eye off ${hs.camera.position.distanceTo(camBefore.p).toExponential(1)} m`);
  env.win.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(S.sel === -1 && card.hidden, 'Esc: a second Esc closes the selection');
  // Show all button
  hs.isolate(fem); runFrames(env, 70);
  chip.querySelector('[data-act="all"]').click(); runFrames(env, 70);
  ok(S.iso === -1 && chip.hidden && S.bones.every(b => flag(S, b.i) === (S.vis[b.i] ? 0 : 1)), 'chip: Show all shows every bone');
  hs.clearSelection(); hs.fitView(true); runFrames(env, 2);
}

// ── click: isolate, toggle, double click, ghost, empty space, hover ──────────
// a page point on the mesh of bone i: the vertex nearest its centre,
// moved as the shader moves it, through the camera
async function onBone(env, hs, S, i) {
  const THREE = await import(T160), F = await import(pathToFileURL(join(HERE, 'focus.js')).href);
  const mi = S.pick[i], b = S.bones[i];
  let best = 0, bd = Infinity;
  for (let v = mi.v0; v < mi.v0 + mi.nv; v++) { const d = Math.hypot(mi.pos[v * 3] - mi.mid[0], mi.pos[v * 3 + 1] - mi.mid[1], mi.pos[v * 3 + 2] - mi.mid[2]); if (d < bd) { bd = d; best = v; } }
  const o = S.cur.off, q = [S.cur.q[i * 4], S.cur.q[i * 4 + 1], S.cur.q[i * 4 + 2], S.cur.q[i * 4 + 3]];
  const r = F.qrot(q, [mi.pos[best * 3] - b.c[0], mi.pos[best * 3 + 1] - b.c[1], mi.pos[best * 3 + 2] - b.c[2]]);
  const w = new THREE.Vector3(r[0] + b.c[0] + o[i * 3], r[1] + b.c[1] + o[i * 3 + 1], r[2] + b.c[2] + o[i * 3 + 2]).project(hs.camera);
  return { x: (w.x + 1) / 2 * env.W, y: env.top + (1 - w.y) / 2 * env.stageH };
}
// a page point with no bone under it (and no near miss)
function empty(env, hs) {
  for (let y = env.top + 30; y < env.top + env.stageH - 90; y += 37) for (let x = 400; x < 1060; x += 41) if (hs.pickAt(x, y, 12) === -1) return { x, y };
  return { x: 1080, y: env.top + 20 };
}
async function clickChecks(env, hs, S, byId) {
  const doc = env.doc, chip = doc.getElementById('isoChip'), fem = byId('femur-l');
  hs.fitView(true); runFrames(env, 2);
  const home = { t: hs.controls.target.clone(), p: hs.camera.position.clone() };
  let p = hs.screenOf('femur-l');
  tap(env, p.x, p.y); env.tick(500); runFrames(env, 80);
  ok(S.iso === fem && S.sel === fem && !chip.hidden && hs.controls.target.distanceTo(hs.boneCentre(fem)) < 1e-6,
    'click: a click on a bone isolates it and glides the camera to it', `iso ${S.bones[S.iso]?.id}, target off ${hs.controls.target.distanceTo(hs.boneCentre(fem)).toExponential(1)} m`);
  // a drag in isolation orbits round the bone (no drag out, no select)
  p = hs.screenOf('femur-l');
  const eye0 = hs.camera.position.clone();
  drag(env, p.x, p.y, 120, 20); runFrames(env, 240);
  const dOff = Math.hypot(S.dOff[fem * 3], S.dOff[fem * 3 + 1], S.dOff[fem * 3 + 2]);
  const r0 = eye0.distanceTo(hs.boneCentre(fem)), r1 = hs.camera.position.distanceTo(hs.controls.target);
  ok(S.iso === fem && dOff === 0 && hs.camera.position.distanceTo(eye0) > 0.05 && hs.controls.target.distanceTo(hs.boneCentre(fem)) < 1e-6 && Math.abs(r1 - r0) < 1e-3,
    'click: a drag on the isolated bone orbits round it (target stays, same distance)', `eye moved ${hs.camera.position.distanceTo(eye0).toFixed(2)} m, distance ${r0.toFixed(3)} -> ${r1.toFixed(3)} m`);
  // a second click on the same bone shows all; the camera stays
  p = await onBone(env, hs, S, fem);
  const eye1 = hs.camera.position.clone();
  tap(env, p.x, p.y); env.tick(500); runFrames(env, 60);
  ok(S.iso === -1 && S.sel === fem && chip.hidden && hs.camera.position.distanceTo(eye1) < 1e-6, 'click: a second click on the same bone shows all, keeps it selected, the camera stays', `iso ${S.iso}, sel ${S.sel}, eye moved ${hs.camera.position.distanceTo(eye1).toExponential(1)} m`);
  const home2 = { t: hs.controls.target.clone(), p: hs.camera.position.clone() };
  tap(env, p.x, p.y); env.tick(500); runFrames(env, 60);
  ok(S.iso === fem, 'click: a third click isolates it again (a toggle)');
  // a ghost: a direct hit on a ghost moves the isolation to it
  let ghostHit = null;
  for (const b of S.bones) {
    if (b.i === fem || !S.vis[b.i]) continue;
    const q = hs.screenOf(b.i);
    if (q.x < 360 || q.x > 1080 || q.y < env.top + 10 || q.y > env.top + env.stageH - 80) continue;
    const h = hs.pickInfo(q.x, q.y);
    if (h && h.ghost && h.i === b.i) { ghostHit = { i: b.i, q }; break; }
  }
  if (ghostHit) {
    tap(env, ghostHit.q.x, ghostHit.q.y); env.tick(500); runFrames(env, 80);
    ok(S.iso === ghostHit.i && hs.controls.target.distanceTo(hs.boneCentre(ghostHit.i)) < 1e-6, 'click: a click right on a ghost moves the isolation to that bone', `${S.bones[fem].id} -> ${S.bones[S.iso]?.id}`);
  } else ok(false, 'click: a ghost under the cursor to click', 'none found on screen');
  // empty space: show all, and the camera goes back to the first view
  // (back to the view from before this isolation: the third click)
  let e = empty(env, hs);
  tap(env, e.x, e.y); env.tick(500); runFrames(env, 80);
  ok(S.iso === -1 && chip.hidden && hs.controls.target.distanceTo(home2.t) < 1e-6 && hs.camera.position.distanceTo(home2.p) < 1e-4,
    'click: a click on empty space shows all and flies back', `target off ${hs.controls.target.distanceTo(home2.t).toExponential(1)} m`);
  e = empty(env, hs);
  tap(env, e.x, e.y); env.tick(500); runFrames(env, 5);
  ok(S.sel === -1, 'click: a second click on empty space closes the card');
  // a double click acts once: the bone ends isolated
  p = hs.screenOf('humerus-r');
  const hum = byId('humerus-r');
  tap(env, p.x, p.y); env.tick(120); tap(env, p.x, p.y); env.tick(500); runFrames(env, 80);
  ok(S.iso === hum, 'click: a double click on a bone isolates it (not on and off)', `iso ${S.bones[S.iso]?.id}`);
  tap(env, p.x, p.y); env.tick(500);
  env.win.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  runFrames(env, 80);
  // hover: the name in the tip
  hs.fitView(true); runFrames(env, 2);
  p = hs.screenOf('femur-l');
  move(env, p.x, p.y); runFrames(env, 2);
  const tip = doc.getElementById('tip');
  ok(tip.classList.contains('show') && /Femur/.test(tip.textContent) && S.hov === fem, 'hover: the mouse over a bone shows its name', tip.textContent.replace(/\s+/g, ' ').trim());
  doc.getElementById('view').dispatchEvent(new env.win.Event('pointerleave')); runFrames(env, 2);
  ok(!tip.classList.contains('show') && S.hov === -1, 'hover: the tip goes when the mouse leaves');
  hs.clearSelection(); hs.fitView(true); runFrames(env, 2);
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
  const doc = env.doc, tip = doc.getElementById('tip'), chip = doc.getElementById('isoChip'), fem = S.P.byId.get('femur-l').i;
  const T = { type: 'touch' };
  // a long press shows the name and does not select
  let q = hs.screenOf('femur-l');
  const id1 = pid++;
  press(env, q.x, q.y, { ...T, id: id1 });
  for (let k = 0; k < 36; k++) env.step();
  const longShown = tip.classList.contains('show') && /Femur/.test(tip.textContent);
  release(env, q.x, q.y, { ...T, id: id1 }); runFrames(env, 4);
  ok(longShown && S.sel === -1 && S.iso === -1, 'phone: a long press shows the bone name and does not select', tip.textContent.replace(/\s+/g, ' ').trim());
  // a one-finger turn is not a tap
  drag(env, q.x, q.y, 80, 0, false, T); runFrames(env, 30);
  ok(S.iso === -1 && S.sel === -1, 'phone: a one-finger turn does not select');
  hs.fitView(true); runFrames(env, 2);
  // a tap isolates and shows the name; the card at the top and the chip
  // at the base are both out of the framed part
  env.RECTS.set('card', el => el.hidden ? env.rect(0, 0, 0, 0) : env.rect(8, env.top + 8, env.W - 16, 300));
  env.RECTS.set('isoChip', el => el.hidden ? env.rect(0, 0, 0, 0) : env.rect(8, env.top + env.stageH - 8 - 96, env.W - 16, 96));
  q = hs.screenOf('femur-l');
  tap(env, q.x, q.y, T); env.tick(500);
  const tapShown = tip.classList.contains('show') && /Femur/.test(tip.textContent);
  runFrames(env, 90);
  const cr = hs.clearRect(), THREE = await import(T160), c = hs.boneCentre(fem);
  const pr = c.clone().project(hs.camera), py = (1 - pr.y) / 2 * cr.h, px = (pr.x + 1) / 2 * cr.w;
  const fy = Math.tan(THREE.MathUtils.degToRad(hs.camera.fov) / 2), rpx = Math.tan(Math.asin(S.bones[fem].r / hs.camera.position.distanceTo(c))) / fy * cr.h / 2;
  ok(S.iso === fem && !chip.hidden && tapShown, 'phone: a tap isolates the bone and shows its name', `iso ${S.bones[S.iso]?.id}`);
  ok(cr.o.t >= 300 && cr.o.b >= 96 && py - rpx >= cr.y0 - 0.5 && py + rpx <= cr.y1 + 0.5 && px - rpx >= -0.5 && px + rpx <= cr.w + 0.5,
    'phone: the framed bone sits between the card and the chip', `clear y ${cr.y0.toFixed(0)}..${cr.y1.toFixed(0)}, sphere y ${(py - rpx).toFixed(0)}..${(py + rpx).toFixed(0)}`);
  // 44 px targets: the chip buttons on a coarse pointer
  const css = readFileSync(join(HERE, 'style.css'), 'utf8').replace(/\s+/g, ' ');
  const coarse = [...css.matchAll(/@media \(pointer:coarse\)\{(.*?)\}\s*\}/g)].map(m => m[1]).join(' ');
  ok(/#isoChip button\{height:44px;min-width:44px/.test(coarse), 'phone: the chip buttons are 44 px on a coarse pointer');
  return env;
}

const env = mode === 'desktop' ? await desktop() : await phone();
console.log(`[${mode}] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

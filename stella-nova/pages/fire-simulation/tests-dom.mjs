// ============================================================================
//  FIRE SIMULATION  ·  jsdom boot check:  node tests-dom.mjs desktop|phone
// ----------------------------------------------------------------------------
//  Needs jsdom 24 (npm i jsdom@24.1.3 in a scratch folder; give it as
//  JSDOM_DIR or NODE_PATH). tests.mjs runs this file once per viewport in
//  a child process (one page per process). No browser.
//  It loads index.html in jsdom, runs the credit kit (kit.js) in the
//  window, gives #view and #overlay a recording 2D context (jsdom has no
//  canvas, no WebGL, no WebGPU, so the page takes the CPU path), imports
//  main.js and runs 90 frames by hand. Then a new scene, a governor level
//  change, and the screensaver (enter, 6 cuts, exit).
//  The last line is "DOM OK ..." or "DOM FAIL ...".
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { fakeCtx } from '../../widgets/sim-kit/test/stubs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let JSDOM, VirtualConsole;
try {
  const dirs = [process.env.JSDOM_DIR && path.dirname(process.env.JSDOM_DIR), process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
  ({ JSDOM, VirtualConsole } = require(require.resolve('jsdom', { paths: dirs })));
} catch (e) { console.log('DOM FAIL jsdom not found (set JSDOM_DIR or NODE_PATH)'); process.exit(1); }

const VIEW = process.argv[2] === 'phone' ? { w: 390, h: 844, coarse: true, dpr: 3 } : { w: 1440, h: 900, coarse: false, dpr: 2 };
const errors = [];
function mediaFor(w, h, coarse) {
  const feat = f => {
    const [k, v] = f.trim().replace(/^\(+|\)+$/g, '').split(':').map(s => s.trim()), n = parseFloat(v);
    if (k === 'max-width') return w <= n; if (k === 'min-width') return w >= n;
    if (k === 'max-height') return h <= n; if (k === 'min-height') return h >= n;
    if (k === 'pointer') return (v === 'coarse') === coarse; if (k === 'hover') return (v === 'hover') === !coarse;
    if (k === 'prefers-reduced-motion') return false;
    return false;
  };
  return q => ({ matches: q.split(',').some(part => part.split(/\band\b/).every(feat)), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdom: ' + (e && e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: pathToFileURL(path.join(HERE, 'index.html')).href, pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc });
const win = dom.window;
Object.defineProperty(win, 'innerWidth', { value: VIEW.w, configurable: true });
Object.defineProperty(win, 'innerHeight', { value: VIEW.h, configurable: true });
Object.defineProperty(win, 'devicePixelRatio', { value: VIEW.dpr, configurable: true });
win.matchMedia = mediaFor(VIEW.w, VIEW.h, VIEW.coarse);
const ctxs = [];
win.HTMLCanvasElement.prototype.getContext = function (type) { if (type !== '2d') return null; if (!this._c) { this._c = fakeCtx(this.width, this.height); ctxs.push(this._c); } return this._c; };
win.eval(fs.readFileSync(path.join(HERE, '../../widgets/ten-minute-physics/kit.js'), 'utf8'));
const raf = [];
win.requestAnimationFrame = f => { raf.push(f); return raf.length; };
win.cancelAnimationFrame = () => {};
const G = globalThis;
for (const k of ['window', 'document', 'navigator', 'location', 'history', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent', 'TMP', 'snSaver']) {
  const v = k === 'window' ? win : (typeof win[k] === 'function' && /^[a-z]/.test(k) ? win[k].bind(win) : win[k]);
  Object.defineProperty(G, k, { value: v, configurable: true, writable: true });
}
G.matchMedia = win.matchMedia; G.addEventListener = win.addEventListener.bind(win); G.removeEventListener = win.removeEventListener.bind(win);
G.devicePixelRatio = VIEW.dpr; G.innerWidth = VIEW.w; G.innerHeight = VIEW.h;
process.on('uncaughtException', e => errors.push('uncaught: ' + e.stack));
process.on('unhandledRejection', e => errors.push('unhandled: ' + (e && e.stack)));
const cerr = console.error; console.error = (...a) => errors.push('console.error: ' + a.join(' '));
let t = 0;
const frames = n => { for (let k = 0; k < n; k++) { const q = raf.splice(0); t += 16.7; for (const f of q) f(t); } };
const say = (good, msg) => { console.error = cerr; console.log(`${good ? 'DOM OK' : 'DOM FAIL'} ${VIEW.w}x${VIEW.h}: ${msg}`); process.exit(good ? 0 : 1); };
try {
  await import(pathToFileURL(path.join(HERE, 'main.js')).href);
  const P = win.__fire;
  frames(90);
  const f0 = P.S.frame, phone = P.kit.phone, bootCells = P.kit.state.cells, bootGrid = P.S.f.numCells, iters = P.kit.state.iters;
  P.kit.newScene(); frames(10);
  const cells1 = P.kit.state.cells, grid1 = P.S.f.numCells;
  P.gov.level = 3; P.applyLevel(); frames(10);
  const low = P.S.f.numCells;
  P.gov.level = 0; P.applyLevel(); frames(10);
  await win.snSaver.enter({ seed: 4, label() {} });
  for (let k = 0; k < 6; k++) { win.snSaver.cut(); frames(5); }
  const shots = win.snSaver.debug().hist.map(x => x.shot).join(' ');
  win.snSaver.exit(); frames(5);
  const badCtx = ctxs.reduce((a, c) => a + c.bad, 0), calls = ctxs.reduce((a, c) => a + c.calls, 0);
  // the boot scene is random; phone ranges are 16k..28k cells, desktop 36k..64k
  const range = phone ? [16000, 28000] : [36000, 64000];
  const good = !errors.length && P.engine === 'cpu' && f0 >= 80 && badCtx === 0 && calls > 100 && phone === VIEW.coarse
    && bootCells >= range[0] && bootCells <= range[1] && Math.abs(bootGrid / bootCells - 1) < 0.2 && Math.abs(grid1 / cells1 - 1) < 0.2
    && low < grid1 * 0.6 && P.S.f.numCells === grid1 && iters === (phone ? 1 : 2)
    && !win.document.documentElement.classList.contains('sk-saver');
  say(good, `engine ${P.engine}, phone ${phone}, ${f0} frames, boot cells ${bootCells} -> ${bootGrid}, new scene ${cells1} -> ${grid1}, governor level 3 -> ${low} and back ${P.S.f.numCells}, V-cycles ${iters}, saver ${shots}, canvas calls ${calls} (bad ${badCtx}), errors ${errors.length}${errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''}`);
} catch (e) { say(false, (e && e.stack) + ' | ' + errors.slice(0, 2).join(' | ')); }

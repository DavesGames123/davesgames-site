// ============================================================================
//  CORAL REEF  ·  tests/page-harness.mjs  ·  main.js in jsdom with a fake GL
// ----------------------------------------------------------------------------
//  Boots the real index.html and main.js in jsdom 24, with the recording
//  WebGL2 of tests/fake-gl.mjs on #view, so createScene, the rock, the reef
//  (on the main thread: jsdom has no Worker), the ROVs and the saver run.
//  It needs jsdom (JSDOM_DIR or NODE_PATH); loadJsdom() gives null if not.
//
//    const P = await bootPage({ w, h, coarse, dpr, search, gl: { ...fakeCanvas opts }, tag,
//                               session: { key: value }, worker: a Worker class or undefined })
//    P.win, P.doc, P.fake (fake-gl), P.errors (console.error lines)
//    await P.run(ms)       runs rAF frames (16 ms) and timers for ms of wall time
//    P.frames(n)           n rAF frames now
//    P.close()             restore console and the globals
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { installThree, fakeCanvas } from './fake-gl.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, '..');
const require = createRequire(import.meta.url);
installThree();

export function loadJsdom() {
  try {
    const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
    return require(require.resolve('jsdom', { paths: dirs.length ? dirs : undefined })).JSDOM;
  } catch (e) { return null; }
}

function mediaFor(w, h, coarse) {
  const feat = f => {
    const m = f.trim().replace(/^\(|\)$/g, '').split(':').map(s => s.trim());
    const [k, v] = m, n = parseFloat(v);
    if (k === 'max-width') return w <= n;
    if (k === 'min-width') return w >= n;
    if (k === 'max-height') return h <= n;
    if (k === 'min-height') return h >= n;
    if (k === 'pointer') return (v === 'coarse') === coarse;
    if (k === 'orientation') return (v === 'landscape') === (w > h);
    return false;
  };
  return q => ({ matches: q.split(',').some(part => part.split(/\band\b/).every(feat)), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}

let run = 0;
export async function bootPage({ w = 1280, h = 720, coarse = false, dpr = 2, search = '', gl = {}, tag = '', session = {}, worker } = {}) {
  const JSDOM = loadJsdom();
  if (!JSDOM) return null;
  const html = fs.readFileSync(path.join(PAGE, 'index.html'), 'utf8');
  const dom = new JSDOM(html.replace(/<script type="module"[^>]*><\/script>/, '').replace(/<script src="[^"]*"><\/script>/g, ''), { url: 'http://localhost:8963/stella-nova/pages/coral-reef/index.html' + search, pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  Object.defineProperty(win, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: h, configurable: true });
  win.matchMedia = mediaFor(w, h, coarse);
  const view = doc.getElementById('view');
  for (const [k, v] of [['clientWidth', w], ['clientHeight', h]]) Object.defineProperty(view, k, { value: v, configurable: true });
  const fake = fakeCanvas(Object.assign({ w, h }, gl, { canvas: view }));
  win.HTMLCanvasElement.prototype.getContext = function (kind) { return this === view && kind === 'webgl2' ? fake.gl : null; };
  const rafQ = [];
  win.requestAnimationFrame = f => { rafQ.push(f); return rafQ.length; };
  const G = globalThis, saved = {};
  const keys = ['window', 'document', 'navigator', 'getComputedStyle', 'requestAnimationFrame', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'matchMedia', 'addEventListener', 'removeEventListener', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'sessionStorage', 'location', 'Worker', 'HTMLCanvasElement'];
  for (const k of keys) saved[k] = Object.getOwnPropertyDescriptor(G, k);
  const val = k => (k === 'window' ? win : k === 'devicePixelRatio' ? dpr : k === 'innerWidth' ? w : k === 'innerHeight' ? h : k === 'Worker' ? worker : (typeof win[k] === 'function' && /^[a-z]/.test(k) ? win[k].bind(win) : win[k]));
  for (const k of keys) Object.defineProperty(G, k, { value: val(k), configurable: true, writable: true });
  win.devicePixelRatio = dpr;
  for (const [k, v] of Object.entries(session)) win.sessionStorage.setItem(k, v);
  const errors = [], cerr = console.error, cwarn = console.warn, warns = [];
  console.error = (...a) => { const s = a.map(x => (x && x.stack) || String(x)).join(' '); if (!/^THREE\.WebGLRenderer|UniformsUtils/.test(s)) errors.push(s); };
  console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
  let t = 0;
  const P = {
    win, doc, fake, errors, warns, tag, rafQ,
    frames(n = 1) {
      for (let i = 0; i < n; i++) {
        t += 16;
        const q = rafQ.splice(0);
        for (const f of q) { try { f(performance.now()); } catch (e) { errors.push('frame: ' + (e && e.stack || e)); } }
      }
    },
    async run(ms) {
      const end = Date.now() + ms;
      while (Date.now() < end) { P.frames(1); await new Promise(r => setTimeout(r, 4)); }
    },
    close() {
      console.error = cerr; console.warn = cwarn;
      for (const k of keys) { if (saved[k]) Object.defineProperty(G, k, saved[k]); else delete G[k]; }
      try { if (win.snSaver && win.__coralStop) win.__coralStop(); } catch (e) { /* gone */ }
      win.close();
    },
  };
  try { await import(pathToFileURL(path.join(PAGE, 'main.js')).href + `?harness=${run++}`); }
  catch (e) { errors.push('import: ' + (e && e.stack || e)); }
  return P;
}

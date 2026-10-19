// ============================================================================
//  POOL PHYSICS  ·  tests/harness.mjs — the page in jsdom (no browser)
// ----------------------------------------------------------------------------
//  Boots the real index.html and main.js in jsdom 24 with
//    - the recording WebGL2 of ../coral-reef/tests/fake-gl.mjs on #c3d, so
//      three r160 builds and "renders" the whole 3D table
//    - a recording 2D context on #c2d and #saverCanvas (counts the calls,
//      counts any argument that is not a finite number, keeps the last
//      fillText strings in __st.texts)
//    - a manual requestAnimationFrame clock (P.frames(n, dtMs))
//  jsdom comes from JSDOM_DIR or NODE_PATH; bootPage() gives null without it.
//
//    const P = await bootPage({ w, h, coarse, dpr, hash })
//    P.win  P.doc  P.pool (window.__pool)  P.ctx2d  P.errors
//    P.frames(n, dtMs = 1000/60)   P.close()
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { installThree, fakeCanvas } from '../../coral-reef/tests/fake-gl.mjs';

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
    if (k === 'prefers-reduced-motion') return false;
    return false;
  };
  return q => ({ matches: q.split(',').some(part => part.split(/\band\b/).every(feat)), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}

export function fake2d(name) {
  const st = { calls: 0, bad: 0, name, ops: {}, badOps: {}, texts: [] };
  const props = { canvas: null };
  const ctx = new Proxy({}, {
    get(_, p) {
      if (p === '__st') return st;
      if (p in props) return props[p];
      if (p === 'measureText') return s => ({ width: String(s).length * 7 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (p === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (p === 'getImageData') return (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      return (...a) => {
        st.calls++; st.ops[p] = (st.ops[p] || 0) + 1; for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) { st.bad++; st.badOps[p] = (st.badOps[p] || 0) + 1; }
        // the last 4000 drawn strings (the saver chalkboard check reads them)
        if (p === 'fillText') { st.texts.push(String(a[0])); if (st.texts.length > 4000) st.texts.splice(0, 1000); }
      };
    },
    set(_, p, v) { props[p] = v; return true; },
  });
  return ctx;
}

let run = 0;
export async function bootPage({ w = 1280, h = 800, coarse = false, dpr = 2, hash = '#seed=7&game=8' } = {}) {
  const JSDOM = loadJsdom();
  if (!JSDOM) return null;
  const html = fs.readFileSync(path.join(PAGE, 'index.html'), 'utf8')
    .replace(/<script type="module"[^>]*><\/script>/g, '').replace(/<script src="[^"]*"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost:8963/stella-nova/pages/billiard/index.html' + hash, pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  Object.defineProperty(win, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: h, configurable: true });
  win.matchMedia = mediaFor(w, h, coarse);
  const phone = w <= 768;
  const paneW = phone ? w - 16 : (w - 300) / 2 - 14, paneH = phone ? (h - 200) / 2 : h * 0.5;
  for (const id of ['pane2d', 'pane3d']) {
    const el = doc.getElementById(id);
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: paneW, height: paneH, right: paneW, bottom: paneH, x: 0, y: 0 });
  }
  const c3d = doc.getElementById('c3d');
  for (const [k, v] of [['clientWidth', paneW], ['clientHeight', paneH]]) Object.defineProperty(c3d, k, { value: v, configurable: true });
  const c2dEl = doc.getElementById('c2d');
  c2dEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: paneW, height: paneH, right: paneW, bottom: paneH, x: 0, y: 0 });
  c3d.getBoundingClientRect = c2dEl.getBoundingClientRect;
  const fake = fakeCanvas({ w: paneW, h: paneH, canvas: c3d });
  const ctx2d = fake2d('c2d'), ctxSaver = fake2d('saver');
  win.HTMLCanvasElement.prototype.getContext = function (kind) {
    if (this === c3d) return kind === 'webgl2' ? fake.gl : null;
    if (kind !== '2d') return null;
    if (this.id === 'c2d') return ctx2d;
    if (this.id === 'saverCanvas') return ctxSaver;
    return null;   // texture canvases: the scene falls back to plain colours
  };
  const rafQ = [];
  win.requestAnimationFrame = f => { rafQ.push(f); return rafQ.length; };
  win.cancelAnimationFrame = () => {};
  const G = globalThis, saved = {};
  const keys = ['window', 'document', 'navigator', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'matchMedia', 'addEventListener', 'removeEventListener', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'location', 'history', 'HTMLCanvasElement', 'localStorage', 'self'];
  for (const k of keys) saved[k] = Object.getOwnPropertyDescriptor(G, k);
  const val = k => (k === 'window' || k === 'self' ? win : k === 'devicePixelRatio' ? dpr : k === 'innerWidth' ? w : k === 'innerHeight' ? h : (typeof win[k] === 'function' && /^[a-z]/.test(k) ? win[k].bind(win) : win[k]));
  for (const k of keys) Object.defineProperty(G, k, { value: val(k), configurable: true, writable: true });
  win.devicePixelRatio = dpr;
  const errors = [], cerr = console.error, cwarn = console.warn;
  console.error = (...a) => { const s = a.map(x => (x && x.stack) || String(x)).join(' '); if (!/^THREE\./.test(s)) errors.push(s); };
  console.warn = (...a) => { const s = a.map(String).join(' '); if (!/^THREE\./.test(s)) errors.push('warn: ' + s); };
  let clock = 1000;
  const P = {
    win, doc, fake, ctx2d, ctxSaver, errors, rafQ,
    frames(n = 1, dtMs = 1000 / 60) {
      for (let i = 0; i < n; i++) {
        clock += dtMs;
        const q = rafQ.splice(0);
        for (const f of q) { try { f(clock); } catch (e) { errors.push('frame: ' + (e && e.stack || e)); } }
      }
    },
    close() {
      console.error = cerr; console.warn = cwarn;
      for (const k of keys) { if (saved[k]) Object.defineProperty(G, k, saved[k]); else delete G[k]; }
      win.close();
    },
  };
  try { await import(pathToFileURL(path.join(PAGE, 'main.js')).href + `?boot=${run++}`); }
  catch (e) { errors.push('import: ' + (e && e.stack || e)); }
  P.pool = win.__pool;
  if (P.pool) await P.pool.ready;
  return P;
}

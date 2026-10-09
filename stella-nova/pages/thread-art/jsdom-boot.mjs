// ============================================================================
//  THREAD ART  ·  jsdom-boot.mjs — boot the page in jsdom with a 2D stub
// ----------------------------------------------------------------------------
//  No browser. tests.mjs runs this file in a child process (main.js keeps
//  module state, so one boot per process):
//    node jsdom-boot.mjs <check> <dpr> [w h]   prints one JSON line
//  jsdom is not in the repo. JSDOM_DIR names a folder whose node_modules
//  holds jsdom; without it the script prints { skip }.
//
//  The 2D context is a recording stub: every call with a number argument
//  that is NaN or infinite counts as a bad call, and each drawImage is
//  kept (source size, destination size) so a check can find a model grid
//  drawn scaled up.
//
//  Checks:
//    hires   the page runs 40 frames, then 40 with the error view on; every
//            canvas in the document has a backing store of at least its CSS
//            size x DPR; no res x res canvas is drawn larger than res
//
//  grep -n: "function ctxStub"  "export async function boot"  "async function hiresCheck"
// ============================================================================
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A recording CanvasRenderingContext2D stub. */
export function ctxStub(canvas, log) {
  const state = { lineWidth: 1, globalAlpha: 1, font: '10px sans-serif' };
  const grad = { addColorStop(o) { if (!Number.isFinite(o)) log.bad.push('addColorStop'); } };
  const fns = {
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => grad, createRadialGradient: () => grad, createConicGradient: () => grad,
    createPattern: () => ({}),
    measureText: s => ({ width: String(s).length * 6, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 }),
    isPointInPath: () => false,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  return new Proxy(state, {
    get(t, k) {
      if (k === 'canvas') return canvas;
      if (k in fns) return (...a) => { log.calls++; return fns[k](...a); };
      if (k in t) return t[k];
      if (typeof k === 'symbol') return undefined;
      return (...a) => {
        log.calls++;
        for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) { log.bad.push(k + '(' + a.map(q => typeof q === 'number' ? q : typeof q).join(',') + ')'); break; }
        if (k === 'drawImage' && a[0]) {
          const s = a[0], sw = a.length >= 9 ? a[3] : s.width, dw = a.length >= 9 ? a[7] : a.length === 5 ? a[3] : s.width;
          log.draws.push({ sw: s.width, sh: s.height, srcW: sw, dstW: dw, tag: s.__tag || '' });
        }
        if (k === 'fillText' && a.length > 1) log.texts++;
      };
    },
    set(t, k, v) {
      if (typeof v === 'number' && !Number.isFinite(v)) log.bad.push('set ' + String(k));
      t[k] = v; return true;
    },
  });
}

export async function boot({ dpr = 2, w = 1280, h = 800 } = {}) {
  const dir = process.env.JSDOM_DIR;
  if (!dir) return { skip: 'JSDOM_DIR not set (a folder whose node_modules holds jsdom)' };
  let JSDOM;
  try { JSDOM = createRequire(join(dir, 'x.js'))('jsdom').JSDOM; } catch (e) { return { skip: 'jsdom not found in JSDOM_DIR' }; }
  const html = readFileSync(join(HERE, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/stella-nova/pages/thread-art/index.html', pretendToBeVisual: true });
  const win = dom.window, log = { calls: 0, bad: [], draws: [], texts: 0, errors: [] };
  for (const [k, v] of [['innerWidth', w], ['innerHeight', h], ['devicePixelRatio', dpr]]) Object.defineProperty(win, k, { value: v, configurable: true, writable: true });
  win.HTMLCanvasElement.prototype.getContext = function () { return this.__ctx || (this.__ctx = ctxStub(this, log)); };
  win.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  let rafQ = [], now = performance.now() + 1000;
  const G = globalThis;
  class ImageDataStub { constructor(d, w2, h2) { if (typeof d === 'number') { this.width = d; this.height = w2; this.data = new Uint8ClampedArray(d * w2 * 4); } else { this.data = d; this.width = w2; this.height = h2 ?? d.length / 4 / w2; } } }
  const defs = {
    window: win, document: win.document, matchMedia: win.matchMedia, getComputedStyle: win.getComputedStyle.bind(win),
    innerWidth: w, innerHeight: h, devicePixelRatio: dpr, ImageData: ImageDataStub,
    HTMLElement: win.HTMLElement, Node: win.Node,
    addEventListener: win.addEventListener.bind(win), removeEventListener: win.removeEventListener.bind(win),
    requestAnimationFrame: cb => { rafQ.push(cb); return rafQ.length; }, cancelAnimationFrame() {},
    createImageBitmap: async () => ({ width: 1200, height: 1200, close() {}, __tag: 'bitmap' }),
    fetch: async url => {
      const p = String(url).startsWith('file:') ? fileURLToPath(String(url)) : null;
      const buf = p ? readFileSync(p) : Buffer.alloc(0);
      return { ok: !!p, status: p ? 200 : 404, blob: async () => ({ type: 'image/jpeg', size: buf.length }), text: async () => buf.toString('utf8') };
    },
  };
  for (const [k, v] of Object.entries(defs)) Object.defineProperty(G, k, { value: v, configurable: true, writable: true });
  win.addEventListener('error', e => log.errors.push(String(e.message)));
  const origWarn = console.warn; console.warn = (...a) => log.errors.push('warn ' + a.join(' ').slice(0, 160));
  await import(pathToFileURL(join(HERE, 'main.js')).href);
  console.warn = origWarn;
  const ta = win.__ta || G.window.__ta;
  const frames = (n, dt = 16.7) => { for (let i = 0; i < n; i++) { const q = rafQ; rafQ = []; now += dt; for (const cb of q) { try { cb(now); } catch (e) { log.errors.push(String(e && e.stack || e).slice(0, 300)); } } } };
  // performance.now drives budgets and dt: tie it to the fake clock.
  const pnow = () => now; Object.defineProperty(G.performance, 'now', { value: pnow, configurable: true });
  return { win, doc: win.document, ta, log, frames, get now() { return now; } };
}

async function hiresCheck(dpr, w, h) {
  const b = await boot({ dpr, w, h });
  if (b.skip) return b;
  for (let i = 0; i < 20 && !b.ta.ready; i++) { b.frames(1); await new Promise(r => setTimeout(r, 5)); }
  b.frames(40);
  b.ta.S.showErr = true;
  b.frames(40);
  const res = b.ta.S.res, out = { dpr, w, h, ready: !!b.ta.ready, canvases: [], low: [], upscaledGrid: 0 };
  for (const c of b.doc.querySelectorAll('canvas')) {
    const need = [Math.round(w * dpr), Math.round(h * dpr)];
    out.canvases.push({ id: c.id, w: c.width, h: c.height, need });
    if (c.width < need[0] || c.height < need[1]) out.low.push(c.id || 'canvas');
  }
  out.upscaledGrid = b.log.draws.filter(d => d.sw === res && d.sh === res && d.dstW > d.srcW + 0.5).length;
  out.errCanvas = b.ta.errCanvas ? [b.ta.errCanvas.width, b.ta.errCanvas.height] : null;
  out.bad = b.log.bad.slice(0, 5); out.nBad = b.log.bad.length; out.calls = b.log.calls; out.errors = b.log.errors.slice(0, 5);
  out.lines = b.ta.run ? b.ta.run.lines.length : 0;
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [check, dpr = '2', w = '1280', h = '800'] = process.argv.slice(2);
  let out;
  try {
    if (check === 'hires') out = await hiresCheck(+dpr, +w, +h);
    else out = { error: 'unknown check ' + check };
  } catch (e) { out = { error: String(e && e.stack || e).slice(0, 600) }; }
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
}

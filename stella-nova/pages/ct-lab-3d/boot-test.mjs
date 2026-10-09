// ============================================================================
//  CT LAB 3D  ·  boot-test.mjs — boot the real page in jsdom (no browser)
// ----------------------------------------------------------------------------
//  Run: NODE_PATH=<dir with jsdom> node stella-nova/pages/ct-lab-3d/boot-test.mjs
//  Prints SKIP when jsdom is not found. The page boots on its CPU path (no
//  navigator.gpu): it loads the object list, builds the gallery, scans the
//  first object, runs FDK, draws the slices; then a second object, a
//  settings change, the difference view, a measurement, the exports, and
//  the screensaver's 2D shots (enter, frames, exit). Canvas 2D is a stub
//  that records calls, so this proves the wiring, not the pixels.
// ============================================================================
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
let JSDOM;
try { JSDOM = createRequire(import.meta.url)('jsdom').JSDOM; } catch (e) {
  try { JSDOM = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH.split(':')[0] + '/' : import.meta.url)('jsdom').JSDOM; } catch (e2) { console.log('SKIP  boot: jsdom not found (set NODE_PATH)'); process.exit(0); }
}
let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

const html = readFileSync(new URL('index.html', here), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: new URL('index.html', here).href, pretendToBeVisual: true });
const w = dom.window;
// Canvas 2D stub: records calls; createImageData gives real arrays
const calls = { put: 0, draw: 0, fill: 0 };
const ctx2d = (cv) => new Proxy({
  canvas: cv,
  createImageData: (a, b) => ({ width: a, height: b, data: new Uint8ClampedArray(a * b * 4) }),
  putImageData: (img) => { calls.put++; if (img.data.some((x) => Number.isNaN(x))) calls.nan = true; },
  drawImage: () => { calls.draw++; }, fillRect: () => { calls.fill++; },
  createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }),
}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
w.HTMLCanvasElement.prototype.getContext = function (kind) { return kind === '2d' ? (this._c2 ||= ctx2d(this)) : null; };
w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(['png'])); };
w.HTMLCanvasElement.prototype.setPointerCapture = () => {};
w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
const frames = [];
w.requestAnimationFrame = (f) => { frames.push(f); return frames.length; };
w.cancelAnimationFrame = () => {};
let saved = 0;
// a file:// page may not replaceState in jsdom: record the calls instead
const hashes = [];
w.history.replaceState = (a, b, u) => { hashes.push(String(u)); };
// main.js runs in node's realm, so its URL and Blob are node's: stub node's URL too
for (const U of [w.URL, globalThis.URL]) { U.createObjectURL = () => { saved++; return 'blob:x'; }; U.revokeObjectURL = () => {}; }
w.HTMLAnchorElement.prototype.click = function () {};
w.fetch = async (u) => {
  const p = fileURLToPath(new URL(String(u)));
  const b = readFileSync(p);
  return { ok: true, status: 200, json: async () => JSON.parse(b.toString('utf8')), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLCanvasElement', 'Node', 'Event', 'CustomEvent', 'EventTarget', 'getComputedStyle', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'location', 'history', 'Blob', 'ImageData', 'addEventListener', 'removeEventListener', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'fetch', 'URL', 'performance']) {
  if (!(k in globalThis) || ['window', 'document', 'navigator', 'location', 'history', 'addEventListener', 'removeEventListener', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'fetch', 'innerWidth', 'innerHeight', 'getComputedStyle'].includes(k)) {
    try { Object.defineProperty(globalThis, k, { value: w[k] && typeof w[k] === 'function' && !/^[A-Z]/.test(k) ? w[k].bind(w) : w[k], configurable: true, writable: true }); } catch (e) { /* read-only */ }
  }
}
globalThis.ImageData = class { constructor(d, a, b) { this.data = d; this.width = a; this.height = b; } };

const errors = [];
process.on('unhandledRejection', (e) => errors.push(String(e && e.stack || e)));
await import(new URL('main.js', here).href);
const P = w.__ct3d;
const pump = async (n, until) => { for (let i = 0; i < n; i++) { const f = frames.splice(0); for (const fn of f) { try { fn(performance.now()); } catch (e) { errors.push(String(e.stack || e)); } } await new Promise((r) => setTimeout(r, 0)); if (until && until()) return true; } return until ? until() : true; };
const $ = (id) => w.document.getElementById(id);

await pump(400, () => P && P.S.session);
ok(!!P && $('objList').children.length === 8, 'boot: the gallery lists 8 objects', `${$('objList').children.length}`);
ok(P.S.entry && P.S.entry.id === 'walnut' && P.S.truth && P.S.truth.nx === 64, 'boot: no WebGPU -> the walnut scans on the CPU at 64^3', `${P.S.entry && P.S.entry.id} ${P.S.truth && P.S.truth.nx}`);
const done = await pump(3000, () => P.S.phase === 'look');
ok(done && P.S.recon && P.S.metrics && P.S.metrics.psnr > 15, 'boot: scan and CPU FDK finish, the reconstruction is measured', `phase ${P.S.phase}, PSNR ${P.S.metrics && P.S.metrics.psnr.toFixed(1)}`);
ok(calls.put >= 8 && !calls.nan, 'boot: the slice views and the 2D preview draw', `${calls.put} putImageData`);
ok(/HU/.test($('readout').textContent) && /PSNR/.test($('metrics').textContent), 'boot: HU readout and metrics show', $('readout').textContent);
ok(hashes.some((h) => /obj=walnut&views=180/.test(h)), 'boot: the settings are in the link', hashes[hashes.length - 1]);
// second object, settings, views
$('objList').children[2].click();
await pump(400, () => P.S.entry.id === 'skull' && P.S.session);
const r = $('sViews'); r.value = '60'; r.dispatchEvent(new w.Event('input'));
await new Promise((res) => setTimeout(res, 450));
ok(P.S.session.total === 60, 'settings: 60 views rescans', `${P.S.session.total}`);
const d2 = await pump(3000, () => P.S.phase === 'look');
ok(d2, 'settings: the skull finishes', P.S.phase);
w.document.querySelector('#segSource [data-src="diff"]').click();
ok(P.S.source === 'diff', 'explore: the difference view');
$('btnMeasure').click();
const cv = $('slAxial'); cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 64, height: 64 });
for (const [x, y] of [[10, 10], [40, 50]]) cv.dispatchEvent(new w.MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
ok(P.S.measure && P.S.measure.b && P.S.measure.cm > 0, 'explore: a measurement in cm', P.S.measure && P.S.measure.cm.toFixed(2));
saved = 0; $('exSlices').click(); $('exVolume').click();
ok(saved === 6, 'export: 4 slice PNGs, the volume and its JSON', `${saved} files`);
// screensaver: 2D shots only (no WebGPU)
const labels = [];
const sv = w.snSaver.enter({ seed: 3, label: (p) => labels.push(p) });
ok(sv && sv.canvas && w.document.body.contains(sv.canvas), 'saver: enter returns a canvas in the document');
// shots last 6-12 s of real time; cut them to see several in a row
for (let k = 0; k < 6; k++) { await pump(40); w.snSaver.cut(); }
await pump(40);
const dbg = w.snSaver.debug();
ok(dbg && dbg.history.length >= 6 && dbg.history.every((k) => k === 'sweep2d' || k === 'triptych') && dbg.history.every((k, i) => !i || k !== dbg.history[i - 1]), 'saver: 2D shots cut with no repeats', dbg && dbg.history.join(' '));
ok(labels.length > 0 && labels.every((l) => l.title && l.tex && !('code' in l)), 'saver: the plate has a title and TeX, no code', `${labels.length} plates`);
w.snSaver.exit();
ok(!w.document.getElementById('c3SaverCv') && P.S.saver === false, 'saver: exit removes its canvas and resumes the page');
ok(errors.length === 0, 'no uncaught errors', errors.slice(0, 2).join(' | ').slice(0, 300));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

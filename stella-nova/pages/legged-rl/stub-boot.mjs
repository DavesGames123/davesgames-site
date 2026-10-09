// ============================================================================
//  LEGGED ROBOT GYM  ·  stub-boot.mjs — boot main.js in node, no browser
// ----------------------------------------------------------------------------
//  tests.mjs calls boot(). It maps 'three' to vendor/three@0.160.0 with a
//  module hook, puts small DOM stand-ins on globalThis, gives main.js a
//  stand-in WebGL renderer (window.__lrlRenderer), and runs frames.
//  It shows that the import graph links, that the page boots, loads
//  MuJoCo and a robot, steps it and fills the panels without a throw.
//  It cannot show layout, CSS, WebGL output or touch behaviour.
//
//  GREP MAP
//    function el ............. the element stand-in
//    class FakeRenderer ...... the WebGL renderer stand-in
//    export async function boot
// ============================================================================
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../../', import.meta.url);
const hook = `
const T = ${JSON.stringify(new URL('vendor/three@0.160.0/', ROOT).href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: T + 'build/three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: T + 'examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`;

const noop = () => {};
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (t[k] = typeof k === 'string' && /^(fillStyle|strokeStyle|font|textAlign|lineWidth|globalAlpha)$/.test(k) ? '' : noop)), set: (t, k, v) => { t[k] = v; return true; } });
const all = new Map();
function el(id = '', tag = 'div') {
  const cls = new Set(), L = {};
  const e = {
    id, tagName: tag.toUpperCase(), style: {}, dataset: {}, hidden: false, value: '0', textContent: '', _html: '', width: 300, height: 150,
    clientWidth: 800, clientHeight: 600, offsetParent: {}, scrollTop: 0, children: [], parentNode: null,
    classList: { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)), toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; v ? cls.add(c) : cls.delete(c); return v; }, contains: c => cls.has(c) },
    addEventListener: (t, f) => { (L[t] = L[t] || []).push(f); }, removeEventListener: noop, dispatch: (t, ev) => (L[t] || []).forEach(f => f(ev)),
    setAttribute: noop, getAttribute: () => null, setPointerCapture: noop, releasePointerCapture: noop, focus: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }),
    querySelectorAll: () => [], querySelector: () => null, closest: () => null, appendChild: c => { c.parentNode = e; e.children.push(c); return c; },
    getContext: () => ctx2d, getRootNode: () => globalThis.document, ownerDocument: null,
    get innerHTML() { return e._html; }, set innerHTML(v) { e._html = v; },
  };
  return e;
}
class FakeRenderer {
  constructor(o) { this.domElement = o.canvas; this.shadowMap = {}; this.autoClear = true; this.renders = 0; this.p = 1; }
  setPixelRatio(p) { this.p = p; } getPixelRatio() { return this.p; } setClearColor() {} setSize() {} clearDepth() {}
  render(scene, cam) { scene.updateMatrixWorld(); cam.updateMatrixWorld(); this.renders++; }
  dispose() {} forceContextLoss() {}
}

export async function boot({ frames = 240, hash = '' } = {}) {
  register('data:text/javascript,' + encodeURIComponent(hook));
  const doc = {
    getElementById: id => { if (!all.has(id)) all.set(id, el(id)); return all.get(id); },
    createElement: t => el('', t), querySelectorAll: () => [], querySelector: () => null,
    documentElement: el('html'), body: el('body'), head: el('head'), addEventListener: noop,
  };
  const win = {
    document: doc, devicePixelRatio: 1, innerWidth: 800, innerHeight: 600, location: { hash, href: 'http://x/' }, history: { replaceState: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop }), getComputedStyle: () => ({ position: 'fixed' }),
    addEventListener: noop, removeEventListener: noop, __lrlRenderer: FakeRenderer, top: null,
  };
  win.top = win; win.window = win;
  const raf = [];
  Object.assign(globalThis, { document: doc, window: win, matchMedia: win.matchMedia, getComputedStyle: win.getComputedStyle, location: win.location, history: win.history, devicePixelRatio: 1, addEventListener: noop });
  globalThis.requestAnimationFrame = f => { raf.push(f); return raf.length; };
  globalThis.cancelAnimationFrame = noop;
  globalThis.fetch = async u => { const b = await readFile(new URL(String(u))); return { ok: true, status: 200, text: async () => b.toString(), json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
  const errors = [];
  const onErr = e => errors.push(String(e && e.stack || e));
  process.on('unhandledRejection', onErr);
  const origErr = console.error; console.error = (...a) => errors.push(a.map(String).join(' '));
  await import('./main.js');
  const G = win.__lrl;
  // wait for the robot
  for (let i = 0; i < 400 && (!G.S || G.loading); i++) await new Promise(r => setTimeout(r, 25));
  let t = performance.now();
  for (let i = 0; i < frames; i++) { t += 1000 / 60; const f = raf.shift(); if (f) f(t); }
  console.error = origErr;
  process.off('unhandledRejection', onErr);
  return { G, win, doc, errors, raf, get: id => all.get(id), step: async n => { for (let i = 0; i < n; i++) { t += 1000 / 60; const f = raf.shift(); if (f) f(t); } } };
}

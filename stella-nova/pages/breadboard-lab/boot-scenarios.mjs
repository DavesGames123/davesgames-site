// ============================================================================
//  BREADBOARD LAB  ·  boot-scenarios.mjs — one page boot per process (tests)
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/breadboard-lab/boot-scenarios.mjs <name>
//  main.js runs once per process (an ES module), so tests.mjs starts this
//  file once per scenario. Each scenario boots main.js on ui/fakedom.mjs
//  with its own URL and storage, acts, and prints ONE line of JSON:
//  { ok, measured }. Exit 0 always; tests.mjs grades the JSON.
//
//  SCENARIOS (grep "SCENARIO:")
//    saver-restore ...... the saver gives back the user's bench, its undo
//                         history and the paused run state at speed 0.1,
//                         and the autosave after exit is the user's
//    pagehide-flush ..... an edit 300 ms before pagehide reaches the autosave
//    link-once .......... a #d= share link loads once; the hash is cleared,
//                         so a reload opens the autosave
//    example-once ....... the same for ?example=
//    nogl-text .......... without WebGL the #nogl text of index.html stays
//    custom-autosave .... a custom part on a board, from the autosave, has
//                         its pins on the board strips
//    jsdom-desktop ...... main.js on a real jsdom (JSDOM_DIR) at 1440 x 900
//    jsdom-phone ........ the same at 390 x 844 with a coarse pointer: the
//                         dock, the sheet tabs, every button has a name
//
//  GREP MAP
//    boot ............... fake DOM, ids from index.html, fetch, location,
//                         history, storage preset, then import main.js
//    bootJsdom .......... index.html in jsdom, a matchMedia for the size
//    THREE_HOOK ......... the loader hook for the 'three' importmap names
//    SCENARIOS .......... the table of scenario functions
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SN = path.resolve(DIR, '../..');
const THREE_URL = pathToFileURL(path.join(SN, 'vendor/three@0.160.0/build/three.module.js')).href;
const ADDONS_URL = pathToFileURL(path.join(SN, 'vendor/three@0.160.0/examples/jsm/')).href;
const THREE_HOOK = `export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(THREE_URL)}, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: new URL(spec.slice(13), ${JSON.stringify(ADDONS_URL)}).href, shortCircuit: true };
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(THREE_HOOK));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const exampleDoc = k => JSON.parse(fs.readFileSync(path.join(DIR, 'examples', k + '.json'), 'utf8')).doc;

async function boot({ hash = '', search = '', autosave = null } = {}) {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const { installDom } = await import('./ui/fakedom.mjs');
  installDom({ width: 1400, height: 900 });
  if (autosave) localStorage.setItem('bblab:autosave', JSON.stringify({ t: 1, doc: autosave }));
  const byId = {};
  for (const [, tag, id, rest, text] of html.matchAll(/<(main|header|aside|div|footer|nav|canvas)\s+id="([^"]+)"([^>]*)>([^<]*)/g)) {
    const el = document.createElement(tag);
    el.id = id;
    if (/\shidden/.test(rest)) el.hidden = true;
    if (text && text.trim()) el.textContent = text.trim();
    byId[id] = el;
    (id === 'gl' ? byId.stage : document.body).appendChild(el);
  }
  const listeners = {};
  globalThis.addEventListener = (t, fn) => { (listeners[t] || (listeners[t] = [])).push(fn); };
  globalThis.removeEventListener = () => {};
  const base = pathToFileURL(path.join(DIR, 'index.html')).href;
  const loc = { search, hash, pathname: fileURLToPath(base), href: base + search + hash, reload() {} };
  globalThis.location = loc;
  const replaced = [];
  globalThis.history = {
    replaceState(state, title, url) {
      replaced.push(String(url));
      const u = new URL(String(url), base);
      loc.search = u.search; loc.hash = u.hash; loc.href = base + u.search + u.hash;
    },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => {
    const u = String(url);
    if (!u.startsWith('file:')) return realFetch(url, o);
    try { const text = fs.readFileSync(fileURLToPath(u), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text }; }
    catch (e) { return { ok: false, status: 404, json: async () => null, text: async () => '' }; }
  };
  console.warn = () => {}; console.info = () => {};
  await import('./main.js');
  return { B: globalThis.bblab, listeners, byId, replaced, loc };
}
// main.js on jsdom (no WebGL there: the stub view). The jsdom package comes
// from JSDOM_DIR (it is not vendored); without it the scenario fails.
function mediaMatches(q, { width, height, coarse }) {
  const one = part => part.split(/\s+and\s+/).every(c => {
    const m = /\(\s*([\w-]+)\s*(?::\s*([^)]+))?\)/.exec(c);
    if (!m) return /^\s*(all|screen)\s*$/.test(c);
    const [, f, v0] = m, v = (v0 || '').trim();
    if (f === 'max-width') return width <= parseFloat(v);
    if (f === 'min-width') return width >= parseFloat(v);
    if (f === 'max-height') return height <= parseFloat(v);
    if (f === 'min-height') return height >= parseFloat(v);
    if (f === 'orientation') return v === (width > height ? 'landscape' : 'portrait');
    if (f === 'pointer' || f === 'any-pointer') return v === (coarse ? 'coarse' : 'fine');
    if (f === 'hover' || f === 'any-hover') return v === (coarse ? 'none' : 'hover');
    if (f === 'prefers-reduced-motion') return v === 'no-preference';
    if (f === 'prefers-color-scheme') return v === 'dark';
    return false;
  });
  return q.split(',').some(one);
}
async function bootJsdom(size) {
  const dir = process.env.JSDOM_DIR;
  if (!dir) throw new Error('JSDOM_DIR is not set (export JSDOM_DIR=<node_modules>/jsdom)');
  const { createRequire } = await import('node:module');
  const { JSDOM, VirtualConsole } = createRequire(import.meta.url)(dir);
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented/.test(String(e && e.message))) errors.push(String(e && e.message)); });
  const dom = new JSDOM(html, { url: 'http://localhost/stella-nova/pages/breadboard-lab/index.html', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  Object.defineProperty(w, 'innerWidth', { value: size.width, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: size.height, configurable: true });
  // jsdom has no canvas: a 2D context that takes every call (as ui/fakedom.mjs
  // does), and no WebGL, so main.js makes the stub view
  w.HTMLCanvasElement.prototype.getContext = function (type) {
    if (type !== '2d') return null;
    const canvas = this;
    const t = { canvas, measureText: x => ({ width: String(x).length * 6 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), getImageData: () => ({ data: new Uint8ClampedArray(4) }), createImageData: () => ({ data: new Uint8ClampedArray(4) }) };
    return new Proxy(t, { get(o, k) { if (k in o) return o[k]; return typeof k === 'string' && /^[a-z]/.test(k) ? () => {} : undefined; }, set(o, k, v) { o[k] = v; return true; } });
  };
  w.matchMedia = q => ({ matches: mediaMatches(q, size), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const put = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  put('window', w); put('document', w.document); put('navigator', w.navigator);
  for (const k of ['HTMLElement', 'Element', 'Node', 'KeyboardEvent', 'MouseEvent', 'CustomEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'sessionStorage', 'location', 'history', 'matchMedia', 'innerWidth', 'innerHeight', 'DOMParser', 'HTMLCanvasElement']) put(k, typeof w[k] === 'function' && /^[a-z]/.test(k) ? w[k].bind(w) : w[k]);
  put('addEventListener', w.addEventListener.bind(w)); put('removeEventListener', w.removeEventListener.bind(w));
  put('devicePixelRatio', 2);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => {
    let u = String(url);
    if (u.startsWith('http://localhost/')) u = pathToFileURL(path.join(SN, '..', u.slice('http://localhost/'.length).split(/[?#]/)[0])).href;
    if (!u.startsWith('file:')) return realFetch(url, o);
    try { const text = fs.readFileSync(fileURLToPath(u), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text }; }
    catch (e) { return { ok: false, status: 404, json: async () => null, text: async () => '' }; }
  };
  const logged = [];
  console.error = (...a) => logged.push(a.map(String).join(' '));
  console.warn = () => {}; console.info = () => {};
  await import('./main.js');
  await sleep(900);
  const d = w.document;
  const buttons = [...d.querySelectorAll('button')];
  const nameOf = b => (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim();
  const nameless = buttons.filter(b => !nameOf(b));
  const out = {
    B: w.bblab || globalThis.bblab, d, errors,
    // three logs this when jsdom gives no WebGL context (the stub view follows)
    logged: logged.filter(m => !/Error creating WebGL context/.test(m)),
    phone: d.body.classList.contains('phone'),
    bar: d.querySelectorAll('#bar button').length,
    barIconNoName: [...d.querySelectorAll('#bar .btn')].filter(b => !b.querySelector('span') && !b.getAttribute('aria-label')).length,
    dock: d.querySelectorAll('#dock button').length,
    buttons: buttons.length, nameless: nameless.map(b => b.className || b.outerHTML.slice(0, 40)),
    nogl: d.getElementById('nogl') && !d.getElementById('nogl').hidden,
    css: [...d.querySelectorAll('link[rel="stylesheet"]')].map(l => l.getAttribute('href')),
  };
  for (const fn of [...(w._pagehide || [])]) fn();
  w.dispatchEvent(new w.Event('pagehide'));
  return out;
}

const autosaved = () => { try { const a = JSON.parse(localStorage.getItem('bblab:autosave')); return a && a.doc; } catch (e) { return null; } };

// ── SCENARIO: the table ────────────────────────────────────────────────────
const SCENARIOS = {
  // SCENARIO: saver-restore
  async 'saver-restore'() {
    const { B } = await boot();
    let running = null, speed = null;
    B.bus.on('sim:state', st => { if (typeof st.running === 'boolean') running = st.running; if (typeof st.speed === 'number') speed = st.speed; });
    B.store.apply({ op: 'meta', title: 'MY BENCH' });
    const undo0 = B.store.history().undo;
    B.sim.setSpeed(0.1); B.sim.pause();
    await sleep(1700);
    const before = (autosaved() || {}).title;
    window.snSaver.enter({ seed: 3 });
    await sleep(1500);
    const during = B.store.doc.title;
    window.snSaver.exit();
    const title = B.store.doc.title, undo1 = B.store.history().undo;
    await sleep(2000);
    const after = (autosaved() || {}).title;
    const ok = before === 'MY BENCH' && during !== 'MY BENCH' && title === 'MY BENCH' && undo1 === undo0 && after === 'MY BENCH' && running === false && speed === 0.1;
    return { ok, measured: `before "${before}", during "${during}", after exit "${title}" (undo ${undo0} → ${undo1}), autosave 2 s after exit "${after}"; sim after exit: running ${running}, speed ${speed}` };
  },
  // SCENARIO: pagehide-flush
  async 'pagehide-flush'() {
    const { B, listeners } = await boot();
    await sleep(1700);
    B.store.apply({ op: 'meta', title: 'EDIT JUST BEFORE CLOSE' });
    await sleep(300);
    for (const fn of listeners.pagehide || []) fn({ persisted: false });
    await sleep(2000);
    const t = (autosaved() || {}).title;
    return { ok: t === 'EDIT JUST BEFORE CLOSE', measured: `autosave after pagehide: "${t}"` };
  },
  // SCENARIO: link-once
  async 'link-once'() {
    const { encodeDoc } = await import('./ui/share.js');
    const shared = exampleDoc('blink-555'); shared.title = 'SHARED';
    const own = exampleDoc('first-led'); own.title = 'MY NEWER EDITS';
    const enc = await encodeDoc(shared);
    const { B, loc, replaced } = await boot({ hash: '#' + enc.replace(/^#/, ''), autosave: own });
    return { ok: B.store.doc.title === 'SHARED' && loc.hash === '' && replaced.length === 1, measured: `loaded "${B.store.doc.title}", hash after load "${loc.hash.slice(0, 12)}", replaceState calls ${replaced.length}` };
  },
  // SCENARIO: example-once
  async 'example-once'() {
    const own = exampleDoc('first-led'); own.title = 'MY NEWER EDITS';
    const { B, loc } = await boot({ search: '?example=blink-555', autosave: own });
    const ex = JSON.parse(fs.readFileSync(path.join(DIR, 'examples/blink-555.json'), 'utf8'));
    return { ok: B.store.doc.title === ex.meta.title && loc.search === '', measured: `loaded "${B.store.doc.title}", search after load "${loc.search}"` };
  },
  // SCENARIO: nogl-text
  async 'nogl-text'() {
    const { byId } = await boot();
    const t = byId.nogl.textContent;
    return { ok: !byId.nogl.hidden && /panels still work/.test(t), measured: `#nogl hidden ${byId.nogl.hidden}: "${t.slice(0, 80)}"` };
  },
  // SCENARIO: custom-autosave
  async 'custom-autosave'() {
    const geo = await import('./parts/geometry.js');
    const cr = { id: 'cp-r', name: 'My R', category: 'custom', mount: 'board', desc: '', params: [],
      pins: [{ name: '1', x: 0, z: 0 }, { name: '2', x: 4, z: 0 }],
      electrical: [{ id: 'main', type: 'resistor', nodes: { a: '1', b: '2' }, params: { r: 1000 } }],
      slots: [{ key: 'body', label: 'Body', default: 'abs-black' }], model: { template: 'box', w: 10, d: 3, h: 3 } };
    const h = geo.holeLocal('bb400', 'a10');
    const doc = { format: 'breadboard-lab', version: 1, title: 'CUSTOM', boards: [{ id: 'b1', type: 'bb400', x: 0, z: 0, rot: 0 }], customParts: [cr], probes: [], materials: [], programs: {},
      parts: [{ id: 'p1', def: 'cp-r', place: { on: 'b1', x: h.x, z: h.z, rot: 0 }, params: {} }], wires: [], nextId: 5 };
    const { B } = await boot({ autosave: doc });
    const nl = B.netlist;
    const pins = nl ? Object.fromEntries(Object.entries(nl.pinNode).filter(([k]) => k.startsWith('p1.'))) : {};
    const ok = B.store.doc.title === 'CUSTOM' && Object.keys(pins).length === 2 && Object.values(pins).every(n => n != null && n > 0);
    return { ok, measured: `loaded "${B.store.doc.title}", pins ${JSON.stringify(pins)}, issues ${nl ? nl.issues.map(i => i.code).join(',') || 'none' : '-'}` };
  },
  // SCENARIO: jsdom-desktop
  async 'jsdom-desktop'() {
    const r = await bootJsdom({ width: 1440, height: 900, coarse: false });
    const ok = !!r.B && !r.phone && r.bar >= 20 && r.barIconNoName === 0 && r.nameless.length === 0 && r.errors.length === 0 && r.logged.length === 0 && r.nogl && r.css.includes('style.css');
    return { ok, measured: `booted ${!!r.B}, body.phone ${r.phone}, ${r.bar} bar buttons (${r.barIconNoName} icon-only without a name), ${r.buttons} buttons, ${r.nameless.length} without a name${r.nameless.length ? ' ' + r.nameless.slice(0, 3).join(' ') : ''}, #nogl shown ${r.nogl}, errors ${r.errors.length + r.logged.length}${r.errors.concat(r.logged).slice(0, 1).map(e => ': ' + e.slice(0, 80)).join('')}` };
  },
  // SCENARIO: jsdom-phone
  async 'jsdom-phone'() {
    const r = await bootJsdom({ width: 390, height: 844, coarse: true });
    const tabs = r.d.querySelectorAll('#sheet .sheet-tabs button').length;
    const ok = !!r.B && r.phone && r.dock === 5 && r.nameless.length === 0 && r.errors.length === 0 && r.logged.length === 0;
    return { ok, measured: `booted ${!!r.B}, body.phone ${r.phone}, ${r.dock} dock buttons, ${tabs} sheet tabs, ${r.buttons} buttons, ${r.nameless.length} without a name${r.nameless.length ? ' ' + r.nameless.slice(0, 3).join(' ') : ''}, errors ${r.errors.length + r.logged.length}${r.errors.concat(r.logged).slice(0, 1).map(e => ': ' + e.slice(0, 80)).join('')}` };
  },
};

const name = process.argv[2];
let out;
try {
  if (!SCENARIOS[name]) out = { ok: false, measured: `unknown scenario "${name}"` };
  else out = await SCENARIOS[name]();
} catch (e) { out = { ok: false, measured: `threw ${e && e.name}: ${e && e.message}` }; }
process.stdout.write('\n' + JSON.stringify(out) + '\n');
process.exit(0);

// lab/boot-test.mjs - boots main.js against a small stub DOM in node and drives the
// window.__ctlab API: every preset, scan to the end, the iterative and compare jobs
// (main-thread fallback, no Worker in node), parameter changes, export sheet, focus.
// It finds runtime errors that node --check and the import check cannot see.
// It does not test layout, CSS or real pixels. Run: node stella-nova/pages/ct-lab/lab/boot-test.mjs
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };
const errors = [];

const ctx2d = () => new Proxy({ canvas: null }, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
    if (k === 'getImageData') return (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; },
});

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.attrs = {};
    this.dataset = {}; this.style = { setProperty() {}, removeProperty() {} }; this._l = {};
    this.hidden = false; this._text = ''; this.value = ''; this.checked = false; this.width = 300; this.height = 150;
    const cls = new Set();
    this.classList = { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; on ? cls.add(c) : cls.delete(c); return on; }, contains: (c) => cls.has(c) };
    this._cls = cls;
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => this._cls.add(c)); }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = v; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  set innerHTML(v) { this._text = String(v).replace(/<[^>]+>/g, ''); this.children = []; }
  get innerHTML() { return this._text; }
  get firstElementChild() { return this.children[0] || null; }
  append(...n) { for (const c of n) { if (typeof c === 'string') { this._text += c; continue; } c.parentNode = this; this.children.push(c); } }
  appendChild(c) { this.append(c); return c; }
  prepend(...n) { this.append(...n); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = v; if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(v); if (k === 'class') this.className = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  toggleAttribute(k, f) { if (f ?? !(k in this.attrs)) this.attrs[k] = ''; else delete this.attrs[k]; }
  addEventListener(t, f) { (this._l[t] ||= []).push(f); }
  removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter((x) => x !== f); }
  dispatchEvent(e) { (this._l[e.type] || []).forEach((f) => f.call(this, e)); return true; }
  click() { this.dispatchEvent({ type: 'click', target: this, preventDefault() {} }); }
  focus() {} blur() {} scrollIntoView() {} setPointerCapture() {} releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400 }; }
  get clientWidth() { return 300; } get clientHeight() { return 300; }
  closest(sel) { let e = this; while (e) { if (match(e, sel)) return e; e = e.parentNode; } return null; }
  matches(sel) { return match(this, sel); }
  getContext() { const c = ctx2d(); c.canvas = this; return c; }
  toBlob(cb) { cb({ size: 1 }); }
  querySelectorAll(sel) { const out = []; const walk = (e) => { for (const c of e.children) { if (matchChain(c, sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  insertBefore(n) { this.append(n); return n; }
  get options() { return this.children; }
}
function match(e, sel) {
  return sel.split(',').some((s0) => {
    const s = s0.trim();
    let m;
    if ((m = /^#([\w-]+)$/.exec(s))) return e.id === m[1];
    if ((m = /^\.([\w-]+)$/.exec(s))) return e.classList.contains(m[1]);
    if ((m = /^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/.exec(s))) return m[2] === undefined ? m[1] in e.attrs || m[1].replace(/^data-/, '') in e.dataset : e.attrs[m[1]] === m[2];
    if ((m = /^(\w+)\.([\w-]+)$/.exec(s))) return e.tagName === m[1].toUpperCase() && e.classList.contains(m[2]);
    if (/^\w+$/.test(s)) return e.tagName === s.toUpperCase();
    return false;
  });
}
function matchChain(e, sel) {
  return sel.split(',').some((one) => {
    const parts = one.trim().split(/\s+/);
    if (!match(e, parts[parts.length - 1])) return false;
    let p = e.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) { while (p && !match(p, parts[i])) p = p.parentNode; if (!p) return false; p = p.parentNode; }
    return true;
  });
}

// Build the element tree from index.html: tags with ids, classes and data-* attributes.
const body = new El('body'), root = new El('html');
root.append(body);
{
  const stack = [body];
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  const bodyHtml = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  const voids = new Set(['input', 'br', 'img', 'meta', 'link', 'source']);
  let m;
  while ((m = re.exec(bodyHtml))) {
    const [, close, tag, attrs] = m;
    if (tag === 'script') continue;
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const el = new El(tag);
    for (const a of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) el.setAttribute(a[1], a[2] ?? '');
    if ('hidden' in el.attrs) el.hidden = true;
    stack[stack.length - 1].append(el);
    if (!voids.has(tag) && !m[4]) stack.push(el);
  }
}
const byId = (id) => { const f = (e) => { if (e.id === id) return e; for (const c of e.children) { const r = f(c); if (r) return r; } return null; }; return f(root); };

const rafQ = [];
const g = globalThis;
g.document = {
  documentElement: root, body, activeElement: null,
  getElementById: byId,
  createElement: (t) => new El(t),
  querySelector: (s) => root.querySelector(s), querySelectorAll: (s) => root.querySelectorAll(s),
  addEventListener() {},
};
g.window = g;
g.devicePixelRatio = 2; g.innerWidth = 1280; g.innerHeight = 800;
g.matchMedia = () => ({ matches: false, addEventListener() {} });
g.requestAnimationFrame = (f) => { rafQ.push(f); return rafQ.length; };
g.cancelAnimationFrame = () => {};
g.ResizeObserver = class { observe() {} disconnect() {} };
g.history = { replaceState(a, b, u) { g.location.hash = u; } };
g.location = { hash: '#preset=metal-mar' };
g.CustomEvent = class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } };
g.addEventListener = () => {};
g.URL.createObjectURL = () => 'blob:x'; g.URL.revokeObjectURL = () => {};
g.requestIdleCallback = (f) => setTimeout(f, 0);
const origErr = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ')); origErr('console.error:', ...a); };
process.on('unhandledRejection', (e) => { errors.push('unhandled: ' + (e && e.stack || e)); });

let t = 0;
const pump = (n = 1) => { for (let i = 0; i < n; i++) { const q = rafQ.splice(0); t += 16.7; for (const f of q) f(t); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await import('../main.js');
const api = g.__ctlab;
ok(!!api, 'main.js puts __ctlab on window');
await Promise.race([api.ready, sleep(20000)]);
ok(api.state().preset === 'metal-mar', `#preset=metal-mar loads that preset (${api.state().preset})`);
ok(byId('presetList').querySelectorAll('button').length === api.presets().length, 'the gallery has a button per preset');
ok(byId('controls').querySelectorAll('select').length >= 8, 'controls are built');

async function runToEnd(maxMs = 60000) {
  const t0 = Date.now();
  while (api.state().phase !== 'done' && Date.now() - t0 < maxMs) { pump(5); await sleep(5); }
  return api.state();
}
const seen = new Set();
const off = api.on('phase', (d) => seen.add(d.phase));
let st = await runToEnd();
ok(st.phase === 'done' && seen.has('mar'), `metal-mar runs scan -> mar -> done (${[...seen].join(', ')})`);

for (const p of api.presets()) {
  if (p.id === 'metal-mar') continue;
  await api.load(p.id);
  await api.set({ n: Math.min(api.params().n, 128) });
  api.setSpeed(2000);
  st = await runToEnd();
  ok(st.phase === 'done' && st.view === st.views && Number.isFinite(st.psnr), `${p.id}: done, ${st.views} views, PSNR ${st.psnr.toFixed(1)}${st.iters ? `, ${st.iter}/${st.iters} iterations` : ''}`);
}
off();

// step control: load paused, step 5 views
await api.load('sparse-36', { autoplay: false });
pump(10);
ok(api.state().view === 0, 'autoplay false holds at view 0');
api.step(5);
ok(api.state().view === 5 && !api.state().playing, 'step(5) acquires five views and stays paused');
// iterative pause + step
await api.load('tv-sparse');
await api.set({ n: 96, iters: 10 });
api.setSpeed(5000);
for (let i = 0; i < 400 && api.state().phase !== 'iterate'; i++) { pump(2); await sleep(2); }
api.pause();
await sleep(150);
const i0 = api.state().iter;
api.step(2);
await sleep(600);
const i1 = api.state().iter;
ok(i1 === i0 + 2, `iterative step(2) runs two iterations (${i0} -> ${i1})`);
api.play();
st = await runToEnd();
ok(st.iter === 10 && st.residuals.length === 10, 'play finishes the iterations');

// recon-only change keeps the scan
const before = api.state().views;
await api.set({ algo: 'fbp', filter: 'hann' });
ok(api.state().phase === 'done' && api.state().views === before, 'a filter change reconstructs without a rescan');
await api.set({ window: 'auto', cmap: 'magma' });
api.setColormap('viridis', { reverse: true });
ok(api.params().cmap === 'viridis' && api.params().cmapReverse === true, 'setColormap sets the map');
await api.setWindow({ level: 0.5, width: 0.4 });
ok(typeof api.params().window === 'object', 'setWindow takes a level and width');
const sheet = api.snapshot();
ok(sheet && sheet.width > 2000, `snapshot makes a ${sheet.width} x ${sheet.height} sheet`);
byId('controls'); // export buttons
for (const b of document.querySelectorAll('[data-export]')) b.click();
ok(true, 'export buttons run');
api.focusPanel('recon');
ok(byId('panels').classList.contains('focus'), 'focusPanel sets focus mode');
api.focusPanel(null);
api.setChrome(false);
ok(root.classList.contains('ct-bare'), 'setChrome(false) adds html.ct-bare');
api.setChrome(true);
const pn = api.panels();
ok(['phantom', 'sinogram', 'recon', 'diff'].every((k) => pn[k] && pn[k].tagName === 'CANVAS'), 'panels() gives four canvases');
api.stop();
ok(!api.state().playing, 'stop() stops');
// custom drawing: a drag on the phantom panel adds a shape
await api.load('custom');
const cv = pn.phantom;
const ev = (type, x, y) => cv.dispatchEvent({ type, clientX: x, clientY: y, pointerId: 1, preventDefault() {} });
ev('pointerdown', 300, 200); ev('pointermove', 340, 200); ev('pointerup', 340, 200);
st = await runToEnd();
ok(st.phase === 'done', 'a drawn shape rescans the custom phantom');

ok(errors.length === 0, `no console errors (${errors.length})${errors.length ? ': ' + errors[0].slice(0, 300) : ''}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

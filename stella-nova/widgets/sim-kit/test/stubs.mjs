// ============================================================================
//  SIM KIT TEST STUBS  ·  widgets/sim-kit/test/stubs.mjs
// ----------------------------------------------------------------------------
//  Small stand-ins for node tests (no browser):
//    installDom()     a DOM good enough for ui.js mount() and saver.js:
//                     elements with attributes, classes, style properties,
//                     children, listeners; document, location, history,
//                     matchMedia, requestAnimationFrame (manual)
//    fakeCtx(w, h)    a Canvas 2D context that records calls and counts
//                     non-finite numbers (ctx.bad), for render tests
//    makeCanvas(w, h) an offscreen canvas object with fakeCtx
//  grep -n targets: "export function installDom", "export function fakeCtx"
// ============================================================================

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.attrs = {}; this.listeners = {};
    this._cls = new Set(); this._style = {}; this.textContent = ''; this._html = ''; this.value = ''; this.hidden = false;
    const self = this;
    this.classList = {
      add: (...c) => c.forEach(x => self._cls.add(x)), remove: (...c) => c.forEach(x => self._cls.delete(x)),
      toggle: (c, on) => { const v = on === undefined ? !self._cls.has(c) : !!on; if (v) self._cls.add(c); else self._cls.delete(c); return v; },
      contains: c => self._cls.has(c),
    };
    this.style = new Proxy(this._style, { get: (o, k) => (k === 'setProperty' ? (n, v) => { o[n] = v; } : k === 'removeProperty' ? n => { delete o[n]; } : o[k] ?? ''), set: (o, k, v) => { o[k] = v; return true; } });
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get offsetHeight() { return 0; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { if (c.parentNode) c.parentNode.children = c.parentNode.children.filter(x => x !== c); this.children.push(c); c.parentNode = this; return c; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); this.parentNode = null; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
  dispatch(t, e = {}) { for (const f of this.listeners[t] || []) f(Object.assign({ target: this, preventDefault() {}, stopPropagation() {} }, e)); }
  click() { this.dispatch('click'); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }; }
  setPointerCapture() {}
  getContext() { return this._ctx || (this._ctx = fakeCtx(this.width || 300, this.height || 150)); }
  *walk() { yield this; for (const c of this.children) yield* c.walk(); }
  find(pred) { for (const e of this.walk()) if (pred(e)) return e; return null; }
  findAll(pred) { const o = []; for (const e of this.walk()) if (pred(e)) o.push(e); return o; }
  querySelector(sel) { return this.find(matcher(sel)); }
  querySelectorAll(sel) { return this.findAll(matcher(sel)); }
}
function matcher(sel) {
  if (sel[0] === '#') return e => e.id === sel.slice(1);
  if (sel[0] === '.') return e => e._cls.has(sel.slice(1));
  return e => e.tagName === sel.toUpperCase();
}
export function createTextNode(t) { const e = new El('#text'); e.textContent = t; return e; }

export function installDom(o = {}) {
  const g = globalThis;
  const html = new El('html'), body = new El('body'), head = new El('head');
  html.appendChild(head); html.appendChild(body);
  const raf = [];
  const listeners = {};
  g.document = {
    documentElement: html, body, head,
    createElement: t => new El(t), createTextNode,
    getElementById: id => html.find(e => e.id === id),
    querySelector: s => html.querySelector(s), querySelectorAll: s => html.querySelectorAll(s),
    addEventListener() {}, removeEventListener() {},
  };
  g.location = { hash: o.hash || '', href: 'https://example.test/page/' + (o.hash || ''), pathname: '/page/' };
  g.history = { replaceState: (a, b, h) => { g.location.hash = h; } };
  g.matchMedia = q => ({ matches: !!o.phone && /max-width/.test(q), addEventListener() {} });
  g.innerWidth = o.w || 1280; g.innerHeight = o.h || 800; g.devicePixelRatio = 1;
  g.addEventListener = (t, f) => { (listeners[t] = listeners[t] || []).push(f); };
  g.removeEventListener = (t, f) => { listeners[t] = (listeners[t] || []).filter(x => x !== f); };
  g.dispatch = (t, e = {}) => { for (const f of listeners[t] || []) f(Object.assign({ preventDefault() {} }, e)); };
  g.requestAnimationFrame = f => { raf.push(f); return raf.length; };
  g.cancelAnimationFrame = () => {};
  if (!g.navigator) g.navigator = {};
  g.window = g;
  g.runRaf = (n = 1, dtMs = 16.7) => { let t = g.__rafT || 0; for (let k = 0; k < n; k++) { const q = raf.splice(0); t += dtMs; for (const f of q) f(t); } g.__rafT = t; };
  return { html, body, raf, listeners };
}

// A Canvas 2D context that records calls and checks numbers.
export function fakeCtx(w = 300, h = 150) {
  const c = { canvas: { width: w, height: h }, calls: 0, bad: 0, fills: 0, strokes: 0, images: 0 };
  const chk = args => { c.calls++; for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) c.bad++; };
  const grad = { addColorStop() {} };
  const ops = ['setTransform', 'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'rect', 'save', 'restore', 'translate', 'rotate', 'scale', 'clip', 'fillText', 'strokeText', 'setLineDash', 'roundRect'];
  for (const k of ops) c[k] = (...a) => chk(a);
  c.fill = (...a) => { chk(a); c.fills++; };
  c.stroke = (...a) => { chk(a); c.strokes++; };
  c.drawImage = (...a) => { chk(a); c.images++; };
  c.createLinearGradient = (...a) => { chk(a); return grad; };
  c.createRadialGradient = (...a) => { chk(a); return grad; };
  c.createImageData = (W, H) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) });
  c.putImageData = (img) => { c.lastImage = img; chk([]); };
  c.measureText = t => ({ width: String(t).length * 7 });
  return c;
}
export function makeCanvas(w, h) { return { width: w, height: h, getContext() { return this._c || (this._c = fakeCtx(w, h)); } }; }

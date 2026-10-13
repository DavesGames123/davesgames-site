// ============================================================================
//  BREADBOARD LAB  ·  ui/fakedom.mjs — a small DOM for node tests (no browser)
// ----------------------------------------------------------------------------
//  Enough of the DOM for createUI to build, render and take clicks and keys:
//  elements with children, classes, attributes, dataset, style, hidden,
//  events with bubbling, a selector engine for the selectors the UI uses
//  (tag, #id, .class, [attr], [attr="v"], descendant spaces, commas), and a
//  2D canvas context that accepts every call. innerHTML stores the text; it
//  does not parse markup. animate() is absent, so unfold() is instant.
//
//  GREP MAP
//    FakeElement ........ the element
//    matches / query .... the selector engine
//    ctx2d .............. the canvas context stub
//    installDom ......... sets globalThis.document, window and friends
// ============================================================================

function ctx2d(canvas) {
  const target = {
    canvas, measureText: t => ({ width: String(t).length * 6 }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }), drawImage() {}
  };
  return new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; return typeof k === 'string' && /^[a-z]/.test(k) && !['fillStyle', 'strokeStyle', 'font', 'lineWidth', 'textAlign', 'textBaseline', 'shadowColor', 'shadowBlur', 'globalAlpha'].includes(k) ? () => {} : undefined; },
    set(t, k, v) { t[k] = v; return true; }
  });
}

class FakeText {
  constructor(text) { this.nodeType = 3; this._text = String(text); this.parentNode = null; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}

let doc;
class FakeElement {
  constructor(tag, ns = null) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.localName = tag.toLowerCase(); this.namespaceURI = ns;
    this.childNodes = []; this.parentNode = null; this.attrs = new Map(); this.listeners = new Map();
    this._classes = new Set(); this.dataset = {}; this._html = null;
    const self = this;
    this.style = new Proxy({ _p: {} }, {
      get(t, k) { if (k === 'setProperty') return (n, v) => { t._p[n] = v; }; if (k === 'removeProperty') return n => { delete t._p[n]; }; if (k === 'getPropertyValue') return n => t._p[n] || ''; return t._p[k] ?? ''; },
      set(t, k, v) { t._p[k] = v; return true; }
    });
    this.classList = {
      add: (...c) => c.forEach(x => self._classes.add(x)), remove: (...c) => c.forEach(x => self._classes.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !self._classes.has(c) : !!f; if (on) self._classes.add(c); else self._classes.delete(c); return on; },
      contains: c => self._classes.has(c)
    };
    this.hidden = false; this.disabled = false; this.value = ''; this.scrollTop = 0; this.scrollLeft = 0; this.width = 300; this.height = 150;
    this.selectionStart = 0; this.selectionEnd = 0; this.checked = false;
  }
  get id() { return this.attrs.get('id') || ''; }
  set id(v) { this.attrs.set('id', String(v)); }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc.documentElement; }
  get options() { return this.children.filter(c => c.tagName === 'OPTION'); }
  get offsetWidth() { return this.hidden ? 0 : 200; } get offsetHeight() { return this.hidden ? 0 : 100; }
  get clientWidth() { return 300; } get clientHeight() { return 150; } get scrollHeight() { return 400; }
  get textContent() { if (this._html !== null) return this._html.replace(/<[^>]*>/g, ''); return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; this._html = null; if (v !== '' && v !== null && v !== undefined) this.appendChild(new FakeText(v)); }
  get innerHTML() { return this._html ?? this.textContent; }
  set innerHTML(v) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; this._html = String(v) || null; }
  get type() { return this.attrs.get('type') || (this.tagName === 'INPUT' ? 'text' : ''); }
  set type(v) { this.attrs.set('type', v); }
  get isContentEditable() { return false; }
  setAttribute(k, v) {
    v = String(v);
    if (k === 'class') { this.className = v; return; }
    if (k === 'hidden') { this.hidden = true; return; }
    if (k === 'value') this.value = v;
    if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = v;
    this.attrs.set(k, v);
  }
  getAttribute(k) { if (k === 'class') return this.className; return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); if (k === 'hidden') this.hidden = false; }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); this._html = null; this.childNodes.push(n); n.parentNode = this; if (this.tagName === 'SELECT' && n.tagName === 'OPTION' && this.options.length === 1 && !this.value) this.value = n.getAttribute('value') ?? ''; return n; }
  append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? new FakeText(n) : n); }
  insertBefore(n, ref) { if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode.removeChild(n); const i = this.childNodes.indexOf(ref); this.childNodes.splice(i, 0, n); n.parentNode = this; return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  replaceChild(n, old) { const i = this.childNodes.indexOf(old); if (n.parentNode) n.parentNode.removeChild(n); this.childNodes[i] = n; n.parentNode = this; old.parentNode = null; return old; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  cloneNode(deep) { const c = new FakeElement(this.localName); for (const [k, v] of this.attrs) c.setAttribute(k, v); c.className = this.className; c.value = this.value; if (deep) for (const n of this.childNodes) c.appendChild(n.nodeType === 1 ? n.cloneNode(true) : new FakeText(n.textContent)); return c; }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  addEventListener(t, fn) { if (!this.listeners.has(t)) this.listeners.set(t, []); this.listeners.get(t).push(fn); }
  removeEventListener(t, fn) { const L = this.listeners.get(t); if (L) { const i = L.indexOf(fn); if (i >= 0) L.splice(i, 1); } }
  dispatchEvent(ev) {
    if (!ev.target || ev.target === null) try { Object.defineProperty(ev, 'target', { value: this, configurable: true }); } catch (e) { ev.target = this; }
    let n = this;
    while (n && !ev._stop) {
      const L = n.listeners && n.listeners.get(ev.type);
      if (L) for (const fn of L.slice()) fn.call(n, ev);
      n = ev.bubbles === false ? null : n.parentNode;
    }
    if (!ev._stop && ev.bubbles !== false && doc && doc._listeners.get(ev.type)) for (const fn of doc._listeners.get(ev.type).slice()) fn(ev);
    return !ev.defaultPrevented;
  }
  click() { this.dispatchEvent(mkEvent('click')); }
  focus() { doc.activeElement = this; }
  blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
  select() {} setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  setRangeText(t, a, b) { this.value = this.value.slice(0, a) + t + this.value.slice(b); this.selectionStart = this.selectionEnd = a + t.length; }
  scrollIntoView() {} setPointerCapture() {} releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 300, bottom: 150, width: 300, height: 150, x: 0, y: 0 }; }
  getContext() { return this._ctx || (this._ctx = ctx2d(this)); }
  matches(sel) { return sel.split(',').some(s => matchChain(this, s.trim().split(/\s+/))); }
  closest(sel) { let n = this; while (n && n.nodeType === 1) { if (n.matches(sel)) return n; n = n.parentNode; } return null; }
  querySelectorAll(sel) { const out = []; walk(this, n => { if (n !== this && n.matches(sel)) out.push(n); }); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function walk(n, fn) { for (const c of n.childNodes) if (c.nodeType === 1) { fn(c); walk(c, fn); } }
function matchSimple(el, s) {
  const m = /^([a-z0-9*-]+)?/i.exec(s);
  if (m[1] && m[1] !== '*' && el.localName !== m[1].toLowerCase()) return false;
  const rest = s.slice(m[0].length);
  for (const t of rest.match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g) || []) {
    if (t[0] === '#' && el.id !== t.slice(1)) return false;
    if (t[0] === '.' && !el._classes.has(t.slice(1))) return false;
    if (t[0] === '[') {
      const a = /^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/.exec(t);
      if (!a) return false;
      const v = el.getAttribute(a[1]) ?? (a[1].startsWith('data-') ? el.dataset[a[1].slice(5).replace(/-([a-z])/g, (q, c) => c.toUpperCase())] : null);
      if (v === null || v === undefined) return false;
      if (a[2] !== undefined && String(v) !== a[2]) return false;
    }
  }
  return true;
}
function matchChain(el, parts) {
  if (!matchSimple(el, parts[parts.length - 1])) return false;
  if (parts.length === 1) return true;
  let p = el.parentNode;
  while (p && p.nodeType === 1) { if (matchChain(p, parts.slice(0, -1))) return true; p = p.parentNode; }
  return false;
}
export function mkEvent(type, props = {}) {
  const ev = { type, bubbles: true, defaultPrevented: false, _stop: false, target: null, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stop = true; }, ...props };
  return ev;
}

export function installDom({ phone = false, width = 1400, height = 900 } = {}) {
  const html = new FakeElement('html'), body = new FakeElement('body'), head = new FakeElement('head');
  html.appendChild(head); html.appendChild(body);
  doc = {
    documentElement: html, body, head, activeElement: body, _listeners: new Map(),
    createElement: t => new FakeElement(t), createElementNS: (ns, t) => new FakeElement(t, ns), createTextNode: t => new FakeText(t),
    getElementById: id => { let r = null; walk(html, n => { if (!r && n.id === id) r = n; }); return r; },
    querySelectorAll: sel => html.querySelectorAll(sel), querySelector: sel => html.querySelector(sel),
    addEventListener(t, fn) { if (!this._listeners.has(t)) this._listeners.set(t, []); this._listeners.get(t).push(fn); },
    removeEventListener(t, fn) { const L = this._listeners.get(t); if (L) { const i = L.indexOf(fn); if (i >= 0) L.splice(i, 1); } },
    dispatchEvent(ev) { for (const fn of (this._listeners.get(ev.type) || []).slice()) fn(ev); }
  };
  const store = new Map();
  const g = globalThis;
  g.document = doc;
  g.window = g;
  g.Node = FakeElement; g.HTMLElement = FakeElement;
  g.innerWidth = width; g.innerHeight = height; g.devicePixelRatio = 1;
  g.matchMedia = q => ({ matches: phone ? /max-width|pointer: coarse/.test(q) && !/orientation: landscape/.test(q) : false, media: q, addEventListener() {}, removeEventListener() {} });
  g.requestAnimationFrame = fn => setTimeout(() => fn(performance.now()), 0);
  g.cancelAnimationFrame = id => clearTimeout(id);
  try { Object.defineProperty(g, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) } }); } catch (e) { /* ignore */ }
  g.addEventListener = g.addEventListener || (() => {});
  g.removeEventListener = g.removeEventListener || (() => {});
  return doc;
}

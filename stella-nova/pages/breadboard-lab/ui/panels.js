// ============================================================================
//  BREADBOARD LAB  ·  ui/panels.js — the squircle widget kit
// ----------------------------------------------------------------------------
//  Every panel, button, chip, well and toast is a `.sq` plate (lib/forge-ui.
//  css): the superellipse corner of Forge, drawn on ::before so the shape
//  does not clip the content. Panels unfold out of the button that opened
//  them and fold back into it (lib/forge-ui.js unfold).
//
//  A VALUE WELL is one control with two gestures, as in the SDF lab: drag
//  sideways to scrub (Shift fine, Alt coarse), click to type. Typing accepts
//  SI text ("4k7", "100n"). A well with an E-series scrubs one series value
//  per step and snaps typed values to the series. One scrub is one undo step:
//  every change carries the same merge key (store.apply(op, { merge })).
//
//  Nothing here touches the DOM at import time (node imports this file).
//
//  GREP MAP
//    h .................. element builder: h('div.sq.panel#id', {attrs}, kids)
//    icon / ICONS ....... the stroke icons of the bar and the dock
//    makePanel .......... a squircle panel: header, title, close, body
//    btn / chip ......... squircle buttons
//    seg ................ a segmented control
//    toggle ............. an on/off switch row
//    well ............... the value well (scrub + type, E-series, log scale)
//    row / sec / note ... layout helpers
//    menu ............... a context menu that unfolds from a point
//    PanelManager ....... open / close / toggle with unfold, phone sheet aware
// ============================================================================
import { unfold, reducedMotion } from '../../../lib/forge-ui.js';
import { si, siParts, parseSI, snapE, stepE, clamp } from './format.js';

// h('button.sq.btn#run', { title: 'Run', onclick }, 'RUN')
export function h(spec, attrs = {}, ...kids) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
  const el = document.createElement(m[1] || 'div');
  for (const p of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (p[0] === '.') el.classList.add(p.slice(1)); else el.id = p.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = {}; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

// stroke icons (24 box, currentColor)
export const ICONS = {
  play: 'M8 5v14l11-7z', pause: 'M7 5h3v14H7zM14 5h3v14h-3z', step: 'M6 5v14l9-7zM17 5h2v14h-2z', reset: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5',
  select: 'M5 3l12 9-5.5 1L15 20l-2.5 1-3-7L5 18z', wire: 'M4 18c4 0 4-12 8-12s4 12 8 12', probe: 'M14 3l7 7-9 9H5v-7z M9 15l-4 6',
  del: 'M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3', undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  lib: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z', inspect: 'M4 6h16M4 12h10M4 18h7', checks: 'M4 12l5 5L20 6', code: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4', share: 'M12 3v12M7 8l5-5 5 5M5 14v6h14v-6', mat: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-3 1-2 3-2h2a3 3 0 0 0 3-3c0-4.5-4-8-9-8z',
  parts: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5', examples: 'M5 4h11l3 3v13H5zM9 9h6M9 13h6M9 17h4', instr: 'M3 6h18v12H3zM6 15l3-5 3 3 3-6 3 8',
  close: 'M6 6l12 12M18 6L6 18', top: 'M4 4h16v16H4zM4 12h16M12 4v16', orbit: 'M12 5c5 0 9 3 9 7s-4 7-9 7-9-3-9-7 4-7 9-7zM12 9v6', flow: 'M3 12h4m3 0h4m3 0h4M15 8l4 4-4 4',
  more: 'M5 12h.01M12 12h.01M19 12h.01', tools: 'M14 6l4 4-8 8H6v-4zM16 4l4 4', light: 'M12 3a6 6 0 0 1 3 11v3H9v-3a6 6 0 0 1 3-11zM9 21h6'
};
export function icon(name, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.more);
  s.appendChild(p);
  return s;
}

export function makePanel({ id, title, cls = '', onClose = null, wide = false }) {
  const close = h('button.ph-x', { type: 'button', 'aria-label': `Close ${title}`, title: 'Close' }, icon('close', 14));
  const titleEl = h('h2', {}, title);
  const tools = h('div.ph-tools');
  const head = h('div.ph', {}, titleEl, tools, close);
  const body = h('div.pb');
  const el = h(`section.sq.panel${cls ? '.' + cls : ''}#${id}`, { 'aria-label': title, hidden: true }, head, body);
  if (wide) el.classList.add('wide');
  close.addEventListener('click', () => onClose && onClose());
  return { el, head, body, tools, setTitle: t => { titleEl.textContent = t; } };
}

export function btn(label, { cls = '', title, onClick, ico, pressed } = {}) {
  const b = h(`button.sq.btn${cls ? '.' + cls : ''}`, { type: 'button', title: title || (typeof label === 'string' ? label : undefined) });
  if (ico) b.appendChild(icon(ico, 16));
  if (label) b.appendChild(h('span', {}, label));
  if (pressed !== undefined) b.setAttribute('aria-pressed', String(!!pressed));
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
export const chip = (label, opts = {}) => btn(label, { ...opts, cls: 'chip' + (opts.cls ? '.' + opts.cls : '') });

// options: [{ value, label, title? }]
export function seg(options, value, onChange, { cls = '' } = {}) {
  const el = h(`div.seg${cls ? '.' + cls : ''}`, { role: 'radiogroup' });
  const btns = options.map(o => {
    const b = h('button.sq', { type: 'button', role: 'radio', title: o.title || o.label, dataset: { v: String(o.value) } }, o.label);
    b.addEventListener('click', () => { set(o.value); onChange && onChange(o.value); });
    el.appendChild(b);
    return [o.value, b];
  });
  function set(v) { value = v; for (const [k, b] of btns) { const on = String(k) === String(v); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); } }
  set(value);
  return { el, set, get value() { return value; } };
}

export function toggle(label, on, onChange) {
  const el = h('button.tog', { type: 'button', role: 'switch' }, h('span', {}, label));
  const set = v => { on = !!v; el.classList.toggle('on', on); el.setAttribute('aria-checked', String(on)); };
  el.addEventListener('click', () => { set(!on); onChange && onChange(on); });
  set(on);
  return { el, set };
}

export const row = (label, control, extra) => h('div.rowv', {}, h('label', {}, label), control, extra || null);
export const sec = (title, right) => h('div.sec', {}, h('span', {}, title), right ? h('span.r', {}, right) : null);
export const note = text => h('p.note', {}, text);

// The value well.
//   opts: { value, unit, min, max, step, scale:'lin'|'log', series, digits,
//           int, format(v) -> text, onChange(v, { final, merge }) }
let wellSeq = 0;
export function well(opts) {
  let { value } = opts;
  const { unit = '', min = -Infinity, max = Infinity, scale = 'lin', series = null, int = false, digits = 3 } = opts;
  const fmt = opts.format || (v => (unit ? si(v, unit, digits) : (int ? String(Math.round(v)) : Number(v.toPrecision(digits)).toString())));
  const el = h('div.sq.num', { tabindex: '0', role: 'spinbutton', title: 'Drag to change, click to type' });
  const txt = h('span.v');
  el.appendChild(txt);
  const fix = v => {
    if (!Number.isFinite(v)) return value;
    if (series) v = snapE(v, series);
    if (int) v = Math.round(v);
    return clamp(v, min, max);
  };
  const set = v => { value = v; txt.textContent = fmt(v); el.setAttribute('aria-valuenow', String(v)); };
  set(value);
  let merge = null;
  const emit = (v, final) => {
    v = fix(v);
    if (v === value && !final) return;
    set(v);
    opts.onChange && opts.onChange(v, { final, merge });
  };
  // drag to scrub
  let down = null;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || el.querySelector('input')) return;
    down = { x: e.clientX, v: value, moved: false, id: e.pointerId };
    merge = 'well' + (++wellSeq);
    try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
  });
  el.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - down.x;
    if (!down.moved && Math.abs(dx) < 3) return;
    down.moved = true; el.classList.add('hot');
    const k = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
    let v;
    if (series) {
      let s = down.v; const n = Math.trunc(dx / 10 * k);
      for (let i = 0; i < Math.abs(n); i++) s = stepE(s, Math.sign(n), series);
      v = s;
    } else if (scale === 'log' && down.v > 0) v = down.v * Math.pow(10, dx / 200 * k);
    else {
      const span = Number.isFinite(max - min) ? (max - min) : Math.max(1, Math.abs(down.v) * 2);
      const st = opts.step || span / 200;
      v = down.v + Math.round(dx / 2 * k) * st;
    }
    emit(v, false);
  });
  const end = e => {
    if (!down) return;
    const moved = down.moved; down = null; el.classList.remove('hot');
    if (moved) { opts.onChange && opts.onChange(value, { final: true, merge }); merge = null; return; }
    edit();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => { down = null; el.classList.remove('hot'); });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); edit(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const d = e.key === 'ArrowUp' ? 1 : -1;
      let v;
      if (series) v = stepE(value, d, series);
      else if (scale === 'log' && value > 0) v = value * Math.pow(10, d * 0.05 * (e.shiftKey ? 0.2 : 1));
      else v = value + d * (opts.step || 1) * (e.shiftKey ? 0.1 : 1);
      merge = merge || 'well' + (++wellSeq);
      emit(v, true);
    }
  });
  function edit() {
    const inp = h('input', { type: 'text', inputmode: 'decimal', value: unit ? `${siParts(value).num}${siParts(value).prefix}` : String(value), 'aria-label': 'Type a value' });
    el.appendChild(inp);
    inp.focus(); inp.select();
    let done = false;
    const commit = ok => {
      if (done) return; done = true;
      const v = parseSI(inp.value);
      inp.remove();
      if (ok && Number.isFinite(v)) { merge = 'well' + (++wellSeq); emit(v, true); merge = null; }
    };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); });
    inp.addEventListener('blur', () => commit(true));
  }
  return { el, set, get value() { return value; } };
}

// a context menu at client (x, y): items [{ label, kbd?, onClick, danger? }]
export function menu(x, y, items, { host = document.body } = {}) {
  const m = h('div.sq.menu', { role: 'menu' });
  for (const it of items) {
    if (it === '-') { m.appendChild(h('div.menu-sep')); continue; }
    const b = h('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger' : null }, h('span', {}, it.label), it.kbd ? h('kbd', {}, it.kbd) : null);
    b.addEventListener('click', () => { close(); it.onClick && it.onClick(); });
    m.appendChild(b);
  }
  host.appendChild(m);
  const W = innerWidth, H = innerHeight, r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(W - r.width - 8, x)) + 'px';
  m.style.top = Math.max(8, Math.min(H - r.height - 8, y)) + 'px';
  unfold(m, { open: true, from: { left: x, right: x + 1, top: y, bottom: y + 1, width: 1, height: 1 }, radius: 12, content: null });
  const away = e => { if (!m.contains(e.target)) close(); };
  const key = e => { if (e.key === 'Escape') close(); };
  setTimeout(() => { document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true); }, 0);
  function close() {
    document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true);
    unfold(m, { open: false, from: { left: x, right: x + 1, top: y, bottom: y + 1, width: 1, height: 1 }, radius: 12, content: null }).then(() => m.remove());
  }
  return { el: m, close };
}

// Opens panels in their column on a desktop, or as the one sheet tab on a
// phone. Each panel unfolds from the element that asked for it.
export class PanelManager {
  constructor({ phone = () => false, sheetBody = null, onChange = () => {} } = {}) {
    this.panels = new Map();      // key -> { el, col, opener }
    this.phone = phone; this.sheetBody = sheetBody; this.onChange = onChange;
    this.sheetKey = null;
  }
  add(key, el, col) { this.panels.set(key, { el, col, opener: null }); col.appendChild(el); }
  isOpen(key) { const p = this.panels.get(key); return !!p && !p.el.hidden && !p.el._closing; }
  open(key, from = null) {
    const p = this.panels.get(key); if (!p) return Promise.resolve();
    if (from) p.opener = from;
    if (this.phone()) {
      for (const [k, q] of this.panels) if (k !== key && q.col !== null && !q.el.hidden && q.el.parentNode === this.sheetBody) { q.el.hidden = true; q.el.classList.remove('is-open'); }
      if (this.sheetBody && p.el.parentNode !== this.sheetBody) this.sheetBody.appendChild(p.el);
      this.sheetKey = key;
    } else if (p.el.parentNode !== p.col) p.col.appendChild(p.el);
    const pr = unfold(p.el, { open: true, from: p.opener, radius: 14 });
    this.onChange(key, true);
    return pr;
  }
  close(key) {
    const p = this.panels.get(key); if (!p || p.el.hidden) return Promise.resolve();
    const pr = unfold(p.el, { open: false, from: this.phone() ? null : p.opener, radius: 14 });
    this.onChange(key, false);
    return pr;
  }
  toggle(key, from) { return this.isOpen(key) ? this.close(key) : this.open(key, from); }
  // move every panel to its desktop column (or into the sheet) after a layout change
  relayout() {
    for (const [k, p] of this.panels) {
      if (this.phone()) { if (this.sheetBody && p.el.parentNode !== this.sheetBody) { this.sheetBody.appendChild(p.el); if (k !== this.sheetKey) p.el.hidden = true; } }
      else if (p.el.parentNode !== p.col) p.col.appendChild(p.el);
    }
  }
}
export { unfold, reducedMotion };

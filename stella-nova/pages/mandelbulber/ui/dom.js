// ui/dom.js — Mandelbulber page: the fixed page elements and the small DOM helpers.
//
// The element refs come from index.html. The helpers make elements, panel sections,
// number text and color text. The module has no state and no listeners.
//
// grep: const $  const stage  const canvas  const panel  const pbody  const picker  const exSheet  const root
//       function el  function section  function fmt  const rgbToHex  const hexToRgb  const clamp  const px  function download

import { quantizeColor } from '../fract.js';

export const $ = (id) => document.getElementById(id);
export const stage = $('stage');
export const canvas = $('gl');
export const panel = $('panel');
export const pbody = $('pbody');
export const hud = $('hud');
export const picker = $('picker');
export const exSheet = $('exSheet');
export const root = document.documentElement;

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k !== null && k !== undefined) e.append(k);
  return e;
}

export function section(id, title, open, ...kids) {
  const s = el('section', { class: open ? '' : 'closed', 'data-g': id });
  const h = el('h2', {}, el('button', { type: 'button', onclick: () => s.classList.toggle('closed') }, title));
  s.append(h, el('div', { class: 'body' }, ...kids));
  return s;
}

export function fmt(v) {
  if (typeof v !== 'number') return String(v);
  if (!Number.isFinite(v)) return '0';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toPrecision(3);
  return String(+v.toFixed(a >= 100 ? 1 : a >= 10 ? 2 : 4));
}

const hex2 = (x) => Math.round(Math.min(Math.max(x, 0), 1) * 255).toString(16).padStart(2, '0');
export const rgbToHex = (c) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
export const hexToRgb = (h) => quantizeColor({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
export const px = (v) => `${Math.round(v)}px`;

export function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

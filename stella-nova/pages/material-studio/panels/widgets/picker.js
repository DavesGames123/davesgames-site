// ============================================================================
//  MATERIAL STUDIO  ·  panels/widgets/picker.js — the shared color picker popover
// ────────────────────────────────────────────────────────────────────────────
//  One popover for the page, made on first use: SV square, hue bar, hex,
//  RGB and HSV fields, EyeDropper when the browser has it, and the
//  recent colors from localStorage. openPicker(anchor, hex, cb) shows it
//  next to the anchor. A click outside or Escape closes it.
//
//  GREP TARGETS
//      picker getPicker pushRecentColor openPicker closePicker
// ============================================================================
import { lsGet, lsSet, clamp } from '../util.js';
import { hexToRgb, rgbToHex, rgbToHsv, hsvToRgb } from '../color.js';
import { capture, h, ibtn } from '../dom.js';
import { numField } from './number.js';

let picker = null;
function getPicker() {
  if (picker) return picker;
  const sv = h('canvas', { class: 'pk-sv', width: 220, height: 140 });
  const hue = h('canvas', { class: 'pk-hue', width: 220, height: 12 });
  const svDot = h('div', { class: 'pk-dot' }), hueDot = h('div', { class: 'pk-hdot' });
  const hex = h('input', { class: 'pn-hex', type: 'text', spellcheck: 'false', maxlength: '7', 'aria-label': 'Hex' });
  const prev = h('div', { class: 'pk-prev' }), prevOld = h('div', { class: 'pk-prev old', title: 'Original color (click to restore)' });
  const fields = {};
  const mk = (k, mx) => { const f = numField(0, { step: 1, int: true, min: 0, max: mx, sens: mx / 200 }, (x, final) => fromField(k, x, final)); fields[k] = f; return h('label', { class: 'pk-f' }, h('span', null, k.toUpperCase()), f.el); };
  const recent = h('div', { class: 'pk-recent' });
  const eye = window.EyeDropper ? ibtn('drop', 'Pick a color from the screen', async () => {
    try { const r = await new window.EyeDropper().open(); setHex(r.sRGBHex, true); } catch (e) { /* cancelled */ }
  }) : null;
  const el = h('div', { class: 'pn-picker', role: 'dialog', 'aria-label': 'Color picker', hidden: true },
    h('div', { class: 'pk-svwrap' }, sv, svDot),
    h('div', { class: 'pk-huewrap' }, hue, hueDot),
    h('div', { class: 'pk-row' }, prevOld, prev, hex, eye),
    h('div', { class: 'pk-grid' }, mk('r', 255), mk('g', 255), mk('b', 255), mk('h', 360), mk('s', 100), mk('v', 100)),
    recent);
  document.body.appendChild(el);
  const P = picker = { el, hsv: [0, 0, 0.5], cb: null, orig: '#808080', anchor: null };
  const drawHue = () => {
    const c = hue.getContext('2d'), g = c.createLinearGradient(0, 0, hue.width, 0);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, rgbToHex(hsvToRgb([i / 6 % 1, 1, 1])));
    c.fillStyle = g; c.fillRect(0, 0, hue.width, hue.height);
  };
  const drawSV = () => {
    const c = sv.getContext('2d'), w = sv.width, hh = sv.height;
    c.fillStyle = rgbToHex(hsvToRgb([P.hsv[0], 1, 1])); c.fillRect(0, 0, w, hh);
    const g1 = c.createLinearGradient(0, 0, w, 0); g1.addColorStop(0, '#fff'); g1.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g1; c.fillRect(0, 0, w, hh);
    const g2 = c.createLinearGradient(0, 0, 0, hh); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, '#000');
    c.fillStyle = g2; c.fillRect(0, 0, w, hh);
  };
  drawHue();
  const sync = (skip) => {
    const rgb = hsvToRgb(P.hsv), hx = rgbToHex(rgb);
    drawSV();
    svDot.style.left = (P.hsv[1] * 100) + '%'; svDot.style.top = ((1 - P.hsv[2]) * 100) + '%';
    hueDot.style.left = (P.hsv[0] * 100) + '%';
    prev.style.background = hx;
    if (skip !== 'hex' && document.activeElement !== hex) hex.value = hx;
    if (skip !== 'rgb') { fields.r.set(Math.round(rgb[0] * 255)); fields.g.set(Math.round(rgb[1] * 255)); fields.b.set(Math.round(rgb[2] * 255)); }
    if (skip !== 'hsv') { fields.h.set(Math.round(P.hsv[0] * 360)); fields.s.set(Math.round(P.hsv[1] * 100)); fields.v.set(Math.round(P.hsv[2] * 100)); }
    return hx;
  };
  const emitC = (final, skip) => { const hx = sync(skip); P.cb && P.cb(hx, final); if (final) pushRecentColor(hx); };
  const setHex = (hx, final) => { const rgb = hexToRgb(hx); const hsv = rgbToHsv(rgb); if (hsv[1] === 0 || hsv[2] === 0) hsv[0] = P.hsv[0]; P.hsv = hsv; emitC(final, 'hex'); };
  P.setHex = setHex;
  function fromField(k, x, final) {
    if ('rgb'.includes(k)) {
      const rgb = hsvToRgb(P.hsv); rgb['rgb'.indexOf(k)] = x / 255;
      const hsv = rgbToHsv(rgb); if (hsv[1] === 0) hsv[0] = P.hsv[0]; P.hsv = hsv; emitC(final, 'rgb');
    } else { P.hsv['hsv'.indexOf(k)] = k === 'h' ? (x % 360) / 360 : x / 100; emitC(final, 'hsv'); }
  }
  const drag = (cv, fn) => cv.addEventListener('pointerdown', e => {
    e.preventDefault(); capture(cv, e);
    const r = cv.getBoundingClientRect();
    const at = ev => fn(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
    at(e); emitC(false);
    const mv = ev => { at(ev); emitC(false); };
    const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); emitC(true); };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  });
  drag(sv, (x, y) => { P.hsv[1] = x; P.hsv[2] = 1 - y; });
  drag(hue, x => { P.hsv[0] = Math.min(x, 0.9999); });
  hex.addEventListener('keydown', e => { if (e.key === 'Enter') hex.blur(); });
  hex.addEventListener('blur', () => { if (/^#?[0-9a-f]{6}$/i.test(hex.value.trim())) setHex('#' + hex.value.trim().replace('#', ''), true); else hex.value = rgbToHex(hsvToRgb(P.hsv)); });
  prevOld.addEventListener('click', () => setHex(P.orig, true));
  const renderRecent = () => recent.replaceChildren(...lsGet('recentColors', []).map(c => h('button', { type: 'button', class: 'pk-sw', style: { background: c }, title: c, onclick: () => setHex(c, true) })));
  P.renderRecent = renderRecent;
  P.sync = sync;
  document.addEventListener('pointerdown', e => { if (!el.hidden && !el.contains(e.target) && e.target !== P.anchor && !P.anchor?.contains(e.target)) closePicker(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.hidden) { closePicker(); e.stopPropagation(); } }, true);
  return P;
}
function pushRecentColor(hx) {
  const r = lsGet('recentColors', []).filter(c => c !== hx); r.unshift(hx); lsSet('recentColors', r.slice(0, 16));
  picker?.renderRecent();
}
export function openPicker(anchor, hx, cb) {
  const P = getPicker();
  P.cb = null; P.anchor = anchor; P.orig = hx;
  P.el.querySelector('.pk-prev.old').style.background = hx;
  const hsv = rgbToHsv(hexToRgb(hx)); P.hsv = hsv; P.sync(); P.renderRecent();
  P.cb = cb;
  P.el.hidden = false;
  const r = anchor.getBoundingClientRect(), pw = P.el.offsetWidth, ph = P.el.offsetHeight;
  let x = r.left - pw - 8, y = r.top - 20;
  if (x < 8) x = Math.min(window.innerWidth - pw - 8, r.left);
  if (x !== r.left - pw - 8) y = r.bottom + 6;
  y = clamp(y, 8, window.innerHeight - ph - 8);
  P.el.style.left = Math.max(8, x) + 'px'; P.el.style.top = y + 'px';
}
export function closePicker() { if (picker) { picker.el.hidden = true; picker.cb = null; picker.anchor = null; } }

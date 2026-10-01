// ============================================================================
//  MATERIAL STUDIO  ·  panels/widgets/gradient.js — gradient param widget
// ────────────────────────────────────────────────────────────────────────────
//  A gradient value is [{t, color}] sorted by t. The bar adds a stop on
//  click, a stop drag moves it, and a drag down deletes it. The preview
//  interpolates in linear space.
//
//  GREP TARGETS
//      wGradient normStops
// ============================================================================
import { clamp } from '../util.js';
import { hexToRgb, rgbToHex, toLin, toSrgb, colorToHex, hexLike } from '../color.js';
import { capture, h, ibtn } from '../dom.js';
import { numField } from './number.js';
import { wColor } from './color.js';

/** Gradient value: [{t, color}] sorted by t; color is an sRGB hex (or linear array). */
export function wGradient(p, value, onChange) {
  let stops = normStops(value ?? p.default);
  let selIdx = 0;
  const like = (Array.isArray(value) && value[0]) ? value[0].color : '#000000';
  const cv = h('canvas', { class: 'pn-grad-cv', width: 256, height: 1 });
  const bar = h('div', { class: 'pn-grad-bar', title: 'Click to add a stop' }, cv);
  const lane = h('div', { class: 'pn-grad-lane' });
  const posF = numField(0, { step: 0.001, min: 0, max: 1 }, (x, final) => { if (stops[selIdx]) { stops[selIdx].t = x; resort(); emit(final); } });
  const colW = wColor({ label: 'Stop' }, '#000000', (c, final) => { if (stops[selIdx]) { stops[selIdx].color = colorToHex(c); draw(); emit(final); } });
  const del = ibtn('trash', 'Delete the stop', () => { if (stops.length > 2) { stops.splice(selIdx, 1); selIdx = Math.max(0, selIdx - 1); draw(); emit(true); } });
  const tools = h('div', { class: 'pn-grad-tools' },
    h('button', { type: 'button', class: 'pn-mini', onclick: () => { stops = stops.map(s => ({ ...s, t: 1 - s.t })).reverse(); selIdx = stops.length - 1 - selIdx; draw(); emit(true); } }, 'Reverse'),
    h('button', { type: 'button', class: 'pn-mini', onclick: () => { stops.forEach((s, i) => { s.t = stops.length > 1 ? i / (stops.length - 1) : 0; }); draw(); emit(true); } }, 'Distribute'));
  const edit = h('div', { class: 'pn-grad-edit' }, h('span', { class: 'pn-sub' }, 'Stop'), colW.el, h('span', { class: 'pn-sub' }, 'at'), posF.el, del);
  function emit(final) { onChange(stops.map(s => ({ t: +s.t.toFixed(4), color: hexLike(s.color, like) })), final); }
  function resort() { const cur = stops[selIdx]; stops.sort((a, b) => a.t - b.t); selIdx = stops.indexOf(cur); draw(); }
  function sampleAt(t) {
    if (t <= stops[0].t) return hexToRgb(stops[0].color).map(toLin);
    for (let i = 1; i < stops.length; i++) if (t <= stops[i].t) {
      const a = stops[i - 1], b = stops[i], k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      const ca = hexToRgb(a.color).map(toLin), cb = hexToRgb(b.color).map(toLin);
      return ca.map((x, j) => x + (cb[j] - x) * k);
    }
    return hexToRgb(stops[stops.length - 1].color).map(toLin);
  }
  function draw() {
    const c = cv.getContext('2d'), img = c.createImageData(256, 1);
    for (let x = 0; x < 256; x++) { const rgb = sampleAt(x / 255); for (let j = 0; j < 3; j++) img.data[x * 4 + j] = Math.round(toSrgb(clamp(rgb[j], 0, 1)) * 255); img.data[x * 4 + 3] = 255; }
    c.putImageData(img, 0, 0);
    lane.replaceChildren(...stops.map((s, i) => {
      const k = h('div', { class: 'pn-grad-stop' + (i === selIdx ? ' on' : ''), style: { left: (s.t * 100) + '%', background: s.color }, tabindex: '0', title: `${s.color} at ${s.t.toFixed(3)} (drag down to delete)` });
      k.addEventListener('pointerdown', e => dragStop(e, i, k));
      k.addEventListener('keydown', e => {
        if (e.key === 'Delete' || e.key === 'Backspace') { if (stops.length > 2) { stops.splice(i, 1); selIdx = 0; draw(); emit(true); } }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { s.t = clamp(s.t + (e.key === 'ArrowLeft' ? -0.01 : 0.01), 0, 1); selIdx = i; resort(); emit(true); }
      });
      return k;
    }));
    const s = stops[selIdx];
    if (s) { posF.set(s.t); colW.set(s.color); }
  }
  function dragStop(e, i, k) {
    e.preventDefault(); e.stopPropagation(); selIdx = i; draw();
    const knob = lane.children[i]; capture(knob, e);
    const r = lane.getBoundingClientRect(), y0 = e.clientY; let gone = false, moved = false;
    const mv = ev => {
      moved = true;
      const s = stops[selIdx]; if (!s) return;
      gone = stops.length > 2 && ev.clientY - y0 > 28;
      knob.classList.toggle('gone', gone);
      s.t = clamp((ev.clientX - r.left) / r.width, 0, 1);
      knob.style.left = (s.t * 100) + '%';
      const cur = s; stops.sort((a, b) => a.t - b.t); selIdx = stops.indexOf(cur);
      const c = cv.getContext('2d'); void c; drawBarOnly(); posF.set(s.t);
      emit(false);
    };
    const up = () => {
      knob.removeEventListener('pointermove', mv); knob.removeEventListener('pointerup', up); knob.removeEventListener('pointercancel', up);
      if (gone) { stops.splice(selIdx, 1); selIdx = 0; }
      draw(); if (moved) emit(true);
    };
    knob.addEventListener('pointermove', mv); knob.addEventListener('pointerup', up); knob.addEventListener('pointercancel', up);
  }
  function drawBarOnly() {
    const c = cv.getContext('2d'), img = c.createImageData(256, 1);
    for (let x = 0; x < 256; x++) { const rgb = sampleAt(x / 255); for (let j = 0; j < 3; j++) img.data[x * 4 + j] = Math.round(toSrgb(clamp(rgb[j], 0, 1)) * 255); img.data[x * 4 + 3] = 255; }
    c.putImageData(img, 0, 0);
  }
  bar.addEventListener('pointerdown', e => {
    const r = bar.getBoundingClientRect(), t = clamp((e.clientX - r.left) / r.width, 0, 1);
    const rgb = sampleAt(t).map(x => toSrgb(clamp(x, 0, 1)));
    stops.push({ t, color: rgbToHex(rgb) }); stops.sort((a, b) => a.t - b.t);
    selIdx = stops.findIndex(s => s.t === t); draw(); emit(true);
  });
  draw();
  return { el: h('div', { class: 'pn-grad' }, bar, lane, edit, tools), set: v => { stops = normStops(v); selIdx = Math.min(selIdx, stops.length - 1); draw(); } };
}
export function normStops(v) {
  const a = Array.isArray(v) && v.length ? v : [{ t: 0, color: '#000000' }, { t: 1, color: '#ffffff' }];
  const s = a.map(x => Array.isArray(x) ? { t: +x[0] || 0, color: colorToHex(x.slice(1)) } : { t: +x.t || 0, color: colorToHex(x.color) });
  if (s.length === 1) s.push({ t: 1, color: s[0].color });
  return s.sort((p, q) => p.t - q.t);
}

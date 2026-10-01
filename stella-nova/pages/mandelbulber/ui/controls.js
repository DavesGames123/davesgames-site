// ui/controls.js — Mandelbulber page: the control rows of the panel and their bindings.
//
// ctl(spec, bind) makes one row: a switch, a color, a list, a vector, a text field, or a
// slider with a number field. bind = { get(), set(v), def }. Each row adds a refresher;
// refreshAll runs all of them after a change, and a row that left the page removes its
// own. A double click on the label resets the value. On a touch screen a tap on the
// label shows the tip popup (showTip).
//
// grep: const refreshers  function ctl  function scrub  const refreshAll  function mainBind  function slotBind
//       const kindOf  function showTip  function hideTip  function initTip

import { $, pbody, el, fmt, rgbToHex, hexToRgb, clamp } from './dom.js';
import { P, mainSpec } from './data.js';
import { scene, touchUI } from './state.js';
import { setMain, setSlot } from './scene.js';

// bind = { get(), set(v), def } ; spec = { label, kind, min, max, step, log, options, tip }
export const refreshers = new Set();

export function ctl(spec, bind) {
  const kind = spec.kind;
  const row = el('div', { class: kind === 'vect3' || kind === 'vect4' ? 'ctl vrow' : 'ctl', title: `${spec.tip ? `${spec.tip}\n` : ''}${spec.name || ''}${spec.name ? '\n' : ''}Double-click the label to reset.` });
  const label = el('span', { class: 'k' }, spec.label);
  row.append(label);
  let set;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  if (kind === 'bool') {
    const b = el('button', { type: 'button', class: 'sw', 'aria-label': spec.label });
    b.addEventListener('click', () => { bind.set(!bind.get()); });
    row.append(b);
    set = (v) => { b.classList.toggle('on', !!v); b.textContent = v ? 'on' : 'off'; };
  } else if (kind === 'rgb') {
    const c = el('input', { type: 'color', 'aria-label': spec.label });
    c.addEventListener('input', () => bind.set(hexToRgb(c.value)));
    row.append(c);
    set = (v) => { c.value = rgbToHex(v); };
  } else if (kind === 'list') {
    const s = el('select', { 'aria-label': spec.label });
    (spec.options || []).forEach((o, i) => s.append(el('option', { value: i }, String(o))));
    s.addEventListener('change', () => bind.set(Number(s.value)));
    row.append(s);
    set = (v) => { s.value = String(v); };
  } else if (kind === 'vect3' || kind === 'vect4') {
    const comps = kind === 'vect3' ? ['x', 'y', 'z'] : ['x', 'y', 'z', 'w'];
    const box = el('div', { class: 'vec' });
    const ins = comps.map((c) => {
      const i = el('input', { class: 'num', type: 'text', inputmode: 'decimal', 'aria-label': `${spec.label} ${c}` });
      i.addEventListener('change', () => {
        const n = Number(i.value.replace(',', '.'));
        if (Number.isFinite(n)) bind.set({ ...bind.get(), [c]: n }); else set(bind.get());
      });
      scrub(i, () => bind.get()[c], (n) => bind.set({ ...bind.get(), [c]: n }), spec);
      box.append(el('label', { class: 'vc' }, el('i', {}, c), i));
      return i;
    });
    row.append(box);
    set = (v) => ins.forEach((i, k) => { if (document.activeElement !== i) i.value = fmt(v[comps[k]]); });
  } else if (kind === 'string') {
    const i = el('input', { class: 'field', type: 'text', 'aria-label': spec.label });
    i.addEventListener('change', () => bind.set(i.value));
    row.append(i);
    set = (v) => { i.value = v; };
  } else {                                           // double, int
    const isInt = kind === 'int';
    let lo = spec.min ?? 0, hi = spec.max ?? 1;
    if (!(hi > lo)) hi = lo + 1;
    const log = !!spec.log && lo > 0;
    const range = el('input', { type: 'range', min: 0, max: 1000, step: 1, 'aria-label': spec.label });
    const toR = (v) => Math.round(1000 * (log ? Math.log(clamp(v, lo, hi) / lo) / Math.log(hi / lo) : (clamp(v, lo, hi) - lo) / (hi - lo)));
    const fromR = (r) => { const t = r / 1000; let v = log ? lo * Math.pow(hi / lo, t) : lo + t * (hi - lo); if (isInt) v = Math.round(v); else v = +v.toPrecision(5); return v; };
    const num = el('input', { class: 'num', type: 'text', inputmode: 'decimal', 'aria-label': `${spec.label} value` });
    range.addEventListener('input', () => bind.set(fromR(Number(range.value))));
    num.addEventListener('change', () => {
      let n = Number(num.value.replace(',', '.'));
      if (!Number.isFinite(n)) return set(bind.get());
      if (isInt) n = Math.round(n);
      bind.set(n);
    });
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') num.blur(); });
    row.append(range, num);
    set = (v) => { range.value = toR(Number(v)); if (document.activeElement !== num) num.value = fmt(v); };
  }
  label.addEventListener('dblclick', () => bind.set(structuredClone(bind.def)));
  label.addEventListener('click', () => { if (touchUI()) showTip(label, spec, bind); });
  const refresh = () => {
    if (row.isConnected) row._seen = true;
    else if (row._seen) { refreshers.delete(refresh); return; }
    const v = bind.get();
    set(v);
    row.classList.toggle('changed', !same(v, bind.def));
    if (spec.dimIf) row.classList.toggle('dim', spec.dimIf());
  };
  refreshers.add(refresh);
  refresh();
  row._refresh = refresh;
  return row;
}

// Drag horizontally on a vector field to change it; a click still edits.
function scrub(input, get, setv, spec) {
  let x0 = null, v0 = 0, moved = false;
  input.addEventListener('pointerdown', (e) => { if (document.activeElement === input || e.pointerType === 'touch') return; x0 = e.clientX; v0 = get(); moved = false; input.setPointerCapture(e.pointerId); });
  input.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    if (!moved && Math.abs(dx) < 3) return;
    moved = true;
    const span = (spec.max ?? 1) - (spec.min ?? 0);
    setv(+(v0 + dx * span / 400 * (e.shiftKey ? 0.1 : 1)).toPrecision(5));
  });
  input.addEventListener('pointerup', () => { if (!moved && x0 !== null) { input.focus(); input.select(); } x0 = null; });
  input.addEventListener('click', (e) => { if (moved) e.preventDefault(); });
}

export const refreshAll = () => refreshers.forEach((r) => r());

// Bind a main param (optionally one vector component).
export function mainBind(name, c) {
  const d = mainSpec(name);
  if (!d) return null;
  if (c) return { get: () => scene.main[name][c], set: (v) => setMain(name, { ...scene.main[name], [c]: v }), def: d.default[c] };
  return { get: () => scene.main[name], set: (v) => setMain(name, v), def: d.default };
}

export function slotBind(s, name) {
  const d = P.fractal[name];
  if (!d) return null;
  return { get: () => scene.fractal[s][name], set: (v) => setSlot(s, name, v), def: d.default };
}

export const kindOf = (type) => ({ double: 'double', int: 'int', bool: 'bool', vect3: 'vect3', vect4: 'vect4', rgb: 'rgb', string: 'string' }[type] || 'double');

// A tapped control label shows its full text, the tip and a reset button.
const tipEl = $('tip');
let tipTimer = 0;
export function showTip(anchor, spec, bind) {
  tipEl.replaceChildren(el('b', {}, spec.label), spec.tip ? el('span', {}, spec.tip) : null, spec.name ? el('small', {}, spec.name) : null,
    el('button', { type: 'button', onclick: () => { bind.set(structuredClone(bind.def)); hideTip(); } }, 'Reset to default'));
  tipEl.hidden = false;
  const r = anchor.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  tipEl.style.left = `${clamp(r.left, 12, innerWidth - w - 12)}px`;
  tipEl.style.top = `${r.bottom + h + 8 < innerHeight ? r.bottom + 4 : Math.max(8, r.top - h - 4)}px`;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(hideTip, 6000);
}

export function hideTip() { tipEl.hidden = true; }

export function initTip() {
  pbody.addEventListener('scroll', () => { if (!tipEl.hidden) hideTip(); }, { passive: true });
}

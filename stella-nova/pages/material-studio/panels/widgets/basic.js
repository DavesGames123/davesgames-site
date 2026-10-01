// ============================================================================
//  MATERIAL STUDIO  ·  panels/widgets/basic.js — enum, bool, vec2 and text param widgets
// ────────────────────────────────────────────────────────────────────────────
//  Small widgets with no canvas: a segment row or a select for enum,
//  a switch for bool, two numFields for vec2, and a textarea for text.
//
//  GREP TARGETS
//      enumOptions wEnum wBool wVec2 wText
// ============================================================================
import { h } from '../dom.js';
import { numField } from './number.js';

export function enumOptions(p) { return (p.options || []).map(o => typeof o === 'object' ? { value: String(o.value), label: o.label ?? String(o.value) } : { value: String(o), label: String(o) }); }
export function wEnum(p, value, onChange) {
  const opts = enumOptions(p);
  let v = String(value ?? p.default);
  const short = opts.length <= 4 && opts.every(o => o.label.length <= 9);
  if (short) {
    const btns = opts.map(o => h('button', { type: 'button', class: 'pn-seg-b', dataset: { v: o.value }, onclick: () => { v = o.value; show(); onChange(v, true); } }, o.label));
    const show = () => btns.forEach(b => b.classList.toggle('on', b.dataset.v === v));
    show();
    return { el: h('div', { class: 'pn-seg', role: 'radiogroup', 'aria-label': p.label }, btns), set: x => { v = String(x); show(); } };
  }
  const sel = h('select', { class: 'pn-sel', 'aria-label': p.label }, opts.map(o => h('option', { value: o.value }, o.label)));
  sel.value = v;
  sel.addEventListener('change', () => { v = sel.value; onChange(v, true); });
  return { el: sel, set: x => { v = String(x); sel.value = v; } };
}

export function wBool(p, value, onChange) {
  let v = !!value;
  const b = h('button', { type: 'button', class: 'pn-tog', role: 'switch', 'aria-label': p.label }, h('span'));
  const show = () => { b.classList.toggle('on', v); b.setAttribute('aria-checked', v); };
  b.addEventListener('click', () => { v = !v; show(); onChange(v, true); });
  show();
  return { el: b, set: x => { v = !!x; show(); } };
}

export function wVec2(p, value, onChange) {
  let v = Array.isArray(value) ? [...value] : [0, 0];
  const step = p.step ?? 0.01;
  const mk = i => numField(v[i], { step, min: p.min ?? -Infinity, max: p.max ?? Infinity }, (x, final) => { v[i] = x; onChange([...v], final); });
  const fx = mk(0), fy = mk(1);
  return {
    el: h('div', { class: 'pn-vec' }, h('label', null, h('span', null, 'X'), fx.el), h('label', null, h('span', null, 'Y'), fy.el)),
    set: x => { v = Array.isArray(x) ? [...x] : [0, 0]; fx.set(v[0]); fy.set(v[1]); },
  };
}

export function wText(p, value, onChange) {
  let v = String(value ?? p.default ?? '');
  const ta = h('textarea', { class: 'pn-text', spellcheck: 'false', rows: String(Math.min(14, Math.max(3, v.split('\n').length + 1))), 'aria-label': p.label });
  ta.value = v;
  const commit = () => { if (ta.value !== v) { v = ta.value; onChange(v, true); } };
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
    else if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); }
  });
  return { el: h('div', { class: 'pn-textw' }, ta, h('span', { class: 'pn-sub' }, 'Ctrl+Enter or blur to apply')), set: x => { v = String(x ?? ''); if (document.activeElement !== ta) ta.value = v; } };
}

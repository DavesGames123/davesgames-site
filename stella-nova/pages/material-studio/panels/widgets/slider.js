// ============================================================================
//  MATERIAL STUDIO  ·  panels/widgets/slider.js — slider and int param widget
// ────────────────────────────────────────────────────────────────────────────
//  A bar with a default tick plus a numField. Shift+drag on the bar is
//  a fine adjust relative to the start value.
//
//  GREP TARGETS
//      wSlider
// ============================================================================
import { clamp, decimals } from '../util.js';
import { capture, h } from '../dom.js';
import { numField } from './number.js';

export function wSlider(p, value, onChange) {
  const int = p.kind === 'int';
  const min = p.min ?? 0, max = p.max ?? (int ? 16 : 1);
  const step = p.step ?? (int ? 1 : Math.max(1e-4, (max - min) / 1000));
  let v = Number(value); if (!Number.isFinite(v)) v = Number(p.default) || 0;
  const fill = h('div', { class: 'pn-bar-fill' });
  const tick = h('div', { class: 'pn-bar-def' });
  const bar = h('div', { class: 'pn-bar', role: 'slider', tabindex: '0', 'aria-label': p.label, 'aria-valuemin': min, 'aria-valuemax': max }, fill, tick);
  const num = numField(v, { step, int, sens: (max - min) / 300 }, (x, final) => { v = x; show(); onChange(v, final); });
  const show = () => {
    const t = clamp((v - min) / (max - min || 1), 0, 1);
    fill.style.width = (t * 100).toFixed(2) + '%';
    bar.setAttribute('aria-valuenow', v);
    bar.classList.toggle('over', v < min || v > max);
  };
  const dt = clamp(((Number(p.default) || 0) - min) / (max - min || 1), 0, 1);
  tick.style.left = (dt * 100).toFixed(2) + '%';
  const q = x => { x = int ? Math.round(x) : Math.round(x / step) * step; return +x.toFixed(decimals(step) + 2); };
  const setV = (x, final) => { x = q(x); if (x === v && !final) return; v = x; show(); num.set(v); onChange(v, final); };
  bar.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); bar.focus({ preventScroll: true });
    capture(bar, e);
    const r = bar.getBoundingClientRect();
    const fine = e.shiftKey;
    const v0 = v, x0 = e.clientX;
    const at = ev => fine
      ? clamp(v0 + ((ev.clientX - x0) / r.width) * (max - min) * 0.1, min, max)
      : min + clamp((ev.clientX - r.left) / r.width, 0, 1) * (max - min);
    setV(at(e), false);
    const mv = ev => setV(at(ev), false);
    const up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); onChange(v, true); };
    bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
  });
  bar.addEventListener('keydown', e => {
    const k = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[e.key];
    if (k) { e.preventDefault(); setV(clamp(v + k * step * (e.shiftKey ? 10 : 1), min, max), true); }
    else if (e.key === 'Home') { e.preventDefault(); setV(min, true); }
    else if (e.key === 'End') { e.preventDefault(); setV(max, true); }
  });
  show();
  const el = h('div', { class: 'pn-slider' }, bar, num.el);
  return { el, set: x => { v = Number(x) || 0; show(); num.set(v); } };
}

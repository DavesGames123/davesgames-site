// ============================================================================
//  MATERIAL STUDIO  ·  panels/widgets/number.js — scrub drag and the typed number field
// ────────────────────────────────────────────────────────────────────────────
//  numField is the text field that every number control uses. A
//  horizontal drag scrubs the value (Shift fine, Alt or Ctrl coarse),
//  arrow keys step it, and typed text goes through evalNum.
//
//  GREP TARGETS
//      scrub numField
// ============================================================================
import { clamp, decimals, fmt, evalNum } from '../util.js';
import { capture, h } from '../dom.js';

/** Horizontal drag on `el` changes a number. Returns nothing; calls cb(dxPx, ev, phase). */
function scrub(el, cb) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (document.activeElement === el) return; // typing mode
    e.preventDefault();
    let x0 = e.clientX, moved = false;
    capture(el, e);
    const mv = ev => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;
      if (!moved) { moved = true; document.body.classList.add('pn-scrubbing'); }
      x0 = ev.clientX; cb(dx, ev, 'move');
    };
    const up = ev => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      document.body.classList.remove('pn-scrubbing');
      if (moved) cb(0, ev, 'end');
      else if (el.tagName === 'INPUT') { el.focus(); el.select(); }
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
}

export function numField(value, { step = 0.01, min = -Infinity, max = Infinity, sens, int = false } = {}, onChange) {
  let v = Number(value) || 0;
  const inp = h('input', { class: 'pn-num', type: 'text', inputmode: 'decimal', spellcheck: 'false', autocomplete: 'off' });
  const q = x => { x = int ? Math.round(x) : Math.round(x / step) * step; return +x.toFixed(decimals(step) + 2); };
  const show = () => { if (document.activeElement !== inp) inp.value = fmt(v, int ? 1 : step); };
  const setV = (x, final) => { x = clamp(q(x), min, max); if (x === v && !final) return; v = x; show(); onChange(v, final); };
  const s = sens || (int ? 0.15 : step * 2);
  let acc = 0;
  scrub(inp, (dx, ev, phase) => {
    if (phase === 'end') { onChange(v, true); acc = 0; return; }
    const k = ev.shiftKey ? 0.1 : (ev.altKey || ev.ctrlKey) ? 10 : 1;
    if (int) { acc += dx * s * k; const st = Math.trunc(acc); if (st) { acc -= st; setV(v + st, false); } }
    else setV(v + dx * s * k, false);
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { inp.blur(); }
    else if (e.key === 'Escape') { inp.value = fmt(v, step); inp.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const k = (e.shiftKey ? 10 : 1) * (e.altKey ? 0.1 : 1) * (int ? 1 : step) * (e.key === 'ArrowUp' ? 1 : -1);
      setV(v + k, true); inp.value = fmt(v, step); inp.select();
    }
  });
  const commit = () => {
    const x = evalNum(inp.value);
    if (Number.isFinite(x)) { if (x !== v) setV(x, true); } else show();
  };
  inp.addEventListener('change', commit);
  inp.addEventListener('blur', commit);
  show();
  return { el: inp, set: x => { v = Number(x) || 0; show(); }, get: () => v };
}

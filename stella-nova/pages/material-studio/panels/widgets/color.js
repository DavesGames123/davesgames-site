// ============================================================================
//  MATERIAL STUDIO  ·  panels/widgets/color.js — color param widget
// ────────────────────────────────────────────────────────────────────────────
//  Swatch, hex field and the linear readout. The swatch opens the shared
//  picker. The widget gives back the value in the form it got (hex or
//  linear array).
//
//  GREP TARGETS
//      wColor
// ============================================================================
import { hexToRgb, rgbToHex, toLin, colorToHex, hexLike } from '../color.js';
import { h } from '../dom.js';
import { openPicker } from './picker.js';

export function wColor(p, value, onChange) {
  const like = value ?? p.default;
  let hx = colorToHex(value ?? p.default);
  const sw = h('button', { type: 'button', class: 'pn-swatch', title: 'Open the color picker', 'aria-label': (p.label || 'Color') + ' color' });
  const txt = h('input', { class: 'pn-hex', type: 'text', spellcheck: 'false', maxlength: '7', 'aria-label': 'Hex' });
  const lin = h('span', { class: 'pn-lin', title: 'Linear RGB value the graph uses' });
  const show = () => {
    sw.style.background = hx;
    if (document.activeElement !== txt) txt.value = hx;
    lin.textContent = hexToRgb(hx).map(c => toLin(c).toFixed(2)).join(' ');
  };
  const setHx = (x, final) => { hx = x; show(); onChange(hexLike(hx, like), final); };
  sw.addEventListener('click', () => openPicker(sw, hx, (x, final) => setHx(x, final)));
  txt.addEventListener('keydown', e => { if (e.key === 'Enter') txt.blur(); });
  txt.addEventListener('blur', () => {
    const s = txt.value.trim().replace('#', '');
    if (/^[0-9a-f]{6}$/i.test(s) || /^[0-9a-f]{3}$/i.test(s)) setHx(rgbToHex(hexToRgb(s)), true); else show();
  });
  show();
  return { el: h('div', { class: 'pn-color' }, sw, txt, lin), set: v => { hx = colorToHex(v); show(); } };
}

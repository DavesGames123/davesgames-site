// ui/gradient.js — Mandelbulber page: the editor of the surface color gradient (mat1_surface_color_gradient).
//
// The param is upstream gradient text: stops of a position (0 to GRADIENT_MAX) and a
// color. The editor shows the stops on a bar. A click on the bar adds a stop with the
// color of the nearest stop, a drag moves a stop, and the fields set the color and the
// position of the selected stop. Each edit writes the param through setMain.
//
// grep: function gradientEditor

import { parseGradient, serialiseGradient, GRADIENT_MAX } from '../fract.js';
import { el, clamp } from './dom.js';
import { mainSpec } from './data.js';
import { scene } from './state.js';
import { setMain } from './scene.js';
import { refreshers } from './controls.js';

export function gradientEditor(name) {
  const box = el('div', { class: 'grad', title: 'Surface color gradient. Click the bar to add a stop, drag a stop to move it.' });
  const bar = el('div', { class: 'bar' });
  const color = el('input', { type: 'color', 'aria-label': 'Stop color' });
  const pos = el('input', { class: 'num', type: 'text', inputmode: 'numeric', 'aria-label': 'Stop position 0 to 9999' });
  const del = el('button', { type: 'button', title: 'Remove the selected stop' }, 'Remove');
  const rst = el('button', { type: 'button', title: 'Back to the default gradient' }, 'Reset');
  box.append(el('div', { class: 'k', style: 'font-size:12px;color:var(--frost-dim);margin-bottom:5px' }, 'Surface gradient'), bar,
    el('div', { class: 'row' }, 'Stop', color, pos, del, rst));
  let sel = 0;
  const stops = () => parseGradient(scene.main[name]);
  const commit = (list, keep) => { const s = [...list]; const pick = keep ? s[keep] : null; setMain(name, serialiseGradient(s)); if (pick) sel = stops().findIndex((x) => x.pos === Math.round(pick.pos) && x.color === pick.color); };
  const draw = () => {
    if (!box.isConnected && bar.childElementCount) { refreshers.delete(draw); return; }
    const s = stops();
    sel = clamp(sel, 0, s.length - 1);
    bar.style.background = s.length > 1 ? `linear-gradient(90deg, ${s.map((x) => `${x.color} ${x.pos / GRADIENT_MAX * 100}%`).join(', ')})` : s[0].color;
    bar.replaceChildren(...s.map((x, i) => {
      const h = el('div', { class: `stop${i === sel ? ' sel' : ''}`, style: `left:${x.pos / GRADIENT_MAX * 100}%;background:${x.color}`, title: `${x.pos} ${x.color}` });
      h.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); sel = i; h.setPointerCapture(e.pointerId);
        const list = stops();
        const move = (ev) => {
          const r = bar.getBoundingClientRect();
          list[i] = { ...list[i], pos: Math.round(clamp((ev.clientX - r.left) / r.width, 0, 1) * GRADIENT_MAX) };
          commit(list, i);
        };
        h.addEventListener('pointermove', move);
        h.addEventListener('pointerup', () => h.removeEventListener('pointermove', move), { once: true });
        draw();
      });
      return h;
    }));
    color.value = s[sel].color;
    if (document.activeElement !== pos) pos.value = s[sel].pos;
    del.disabled = s.length < 2;
  };
  bar.addEventListener('pointerdown', (e) => {
    const r = bar.getBoundingClientRect();
    const p = Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * GRADIENT_MAX);
    const s = stops();
    const near = s.reduce((a, b) => (Math.abs(b.pos - p) < Math.abs(a.pos - p) ? b : a));
    s.push({ pos: p, color: near.color });
    commit(s, s.length - 1);
  });
  color.addEventListener('input', () => { const s = stops(); s[sel] = { ...s[sel], color: color.value }; commit(s, sel); });
  pos.addEventListener('change', () => { const s = stops(); const n = Number(pos.value); if (Number.isFinite(n)) { s[sel] = { ...s[sel], pos: clamp(Math.round(n), 0, GRADIENT_MAX) }; commit(s, sel); } });
  del.addEventListener('click', () => { const s = stops(); if (s.length > 1) { s.splice(sel, 1); sel = Math.max(0, sel - 1); commit(s); } });
  rst.addEventListener('click', () => { sel = 0; setMain(name, mainSpec(name).default); });
  refreshers.add(draw);
  requestAnimationFrame(draw);
  return box;
}

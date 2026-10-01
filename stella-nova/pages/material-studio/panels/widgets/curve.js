// ============================================================================
//  MATERIAL STUDIO  ·  panels/widgets/curve.js — curve param widget
// ────────────────────────────────────────────────────────────────────────────
//  A curve value is [[x, y]] sorted by x. The preview is a monotone cubic
//  (Fritsch-Carlson). Click adds a point, a drag out of the canvas or a
//  double-click deletes it.
//
//  GREP TARGETS
//      monotone CURVE_PRESETS wCurve normPts
// ============================================================================
import { clamp, clone } from '../util.js';
import { capture, h } from '../dom.js';

/** Monotone cubic (Fritsch-Carlson) through sorted points; used for the curve preview. */
export function monotone(pts) {
  const n = pts.length; const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  if (n < 2) return () => ys[0] ?? 0;
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return x => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
    const hh = xs[i + 1] - xs[i], t = (x - xs[i]) / hh, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1];
  };
}
const CURVE_PRESETS = {
  Linear: [[0, 0], [1, 1]], Invert: [[0, 1], [1, 0]], 'Ease': [[0, 0], [0.5, 0.2], [1, 1]],
  'S': [[0, 0], [0.25, 0.08], [0.75, 0.92], [1, 1]], 'Lift': [[0, 0.2], [1, 1]], 'Bump': [[0, 0], [0.5, 1], [1, 0]],
};
export function wCurve(p, value, onChange) {
  let pts = normPts(value ?? p.default);
  let sel = -1;
  const W = 240, H = 130;
  const cv = h('canvas', { class: 'pn-curve-cv', width: W * 2, height: H * 2, tabindex: '0', 'aria-label': (p.label || 'Curve') + ' curve editor' });
  const coords = h('span', { class: 'pn-sub pn-curve-xy' });
  const presets = h('div', { class: 'pn-grad-tools' }, Object.entries(CURVE_PRESETS).map(([k, v]) => h('button', { type: 'button', class: 'pn-mini', onclick: () => { pts = clone(v); sel = -1; draw(); emit(true); } }, k)), coords);
  function emit(final) { onChange(pts.map(q => [+q[0].toFixed(4), +q[1].toFixed(4)]), final); }
  const toPx = q => [6 + q[0] * (W * 2 - 12), (H * 2 - 6) - q[1] * (H * 2 - 12)];
  const fromPx = (x, y) => [clamp((x - 6) / (W * 2 - 12), 0, 1), clamp(((H * 2 - 6) - y) / (H * 2 - 12), 0, 1)];
  function draw() {
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#0b0e15'; c.fillRect(0, 0, cv.width, cv.height);
    c.strokeStyle = 'rgba(150,200,255,0.08)'; c.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const [x] = toPx([i / 4, 0]), [, y] = toPx([0, i / 4]); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, cv.height); c.moveTo(0, y); c.lineTo(cv.width, y); c.stroke(); }
    c.strokeStyle = 'rgba(150,200,255,0.18)'; c.beginPath(); c.moveTo(...toPx([0, 0])); c.lineTo(...toPx([1, 1])); c.stroke();
    const f = monotone(pts);
    c.strokeStyle = '#ffc832'; c.lineWidth = 2.5; c.beginPath();
    for (let i = 0; i <= 120; i++) { const x = i / 120, q = toPx([x, clamp(f(x), 0, 1)]); i ? c.lineTo(...q) : c.moveTo(...q); }
    c.stroke();
    pts.forEach((q, i) => { const [x, y] = toPx(q); c.fillStyle = i === sel ? '#ffc832' : '#0b0e15'; c.strokeStyle = '#ffc832'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fill(); c.stroke(); });
    coords.textContent = sel >= 0 && pts[sel] ? `${pts[sel][0].toFixed(3)}, ${pts[sel][1].toFixed(3)}` : `${pts.length} points`;
  }
  const evPx = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)]; };
  const hit = (x, y) => { const tol = matchMedia('(pointer:coarse)').matches ? 30 : 16; let best = -1, bd = tol * tol; pts.forEach((q, i) => { const [px, py] = toPx(q); const d = (px - x) ** 2 + (py - y) ** 2; if (d < bd) { bd = d; best = i; } }); return best; };
  cv.addEventListener('pointerdown', e => {
    e.preventDefault(); cv.focus({ preventScroll: true });
    const [x, y] = evPx(e);
    let i = hit(x, y);
    if (i < 0) { const q = fromPx(x, y); pts.push(q); pts.sort((a, b) => a[0] - b[0]); i = pts.indexOf(q); }
    sel = i; draw();
    capture(cv, e);
    let gone = false, moved = false;
    const mv = ev => {
      moved = true;
      const [mx, my] = evPx(ev); const q = fromPx(mx, my);
      const lo = sel > 0 ? pts[sel - 1][0] + 0.001 : 0, hi = sel < pts.length - 1 ? pts[sel + 1][0] - 0.001 : 1;
      pts[sel] = [clamp(q[0], lo, hi), q[1]];
      gone = pts.length > 2 && (my < -30 || my > cv.height + 30 || mx < -30 || mx > cv.width + 30);
      draw(); emit(false);
    };
    const up = () => {
      cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up);
      if (gone) { pts.splice(sel, 1); sel = -1; }
      draw(); emit(true); void moved;
    };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  });
  cv.addEventListener('dblclick', e => { const [x, y] = evPx(e); const i = hit(x, y); if (i >= 0 && pts.length > 2) { pts.splice(i, 1); sel = -1; draw(); emit(true); } });
  cv.addEventListener('keydown', e => {
    if (sel < 0) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && pts.length > 2) { pts.splice(sel, 1); sel = -1; draw(); emit(true); e.preventDefault(); return; }
    const d = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    if (d) { e.preventDefault(); const k = e.shiftKey ? 0.05 : 0.01; pts[sel] = [clamp(pts[sel][0] + d[0] * k, 0, 1), clamp(pts[sel][1] + d[1] * k, 0, 1)]; pts.sort((a, b) => a[0] - b[0]); draw(); emit(true); }
  });
  draw();
  return { el: h('div', { class: 'pn-curve' }, cv, presets), set: v => { pts = normPts(v); sel = -1; draw(); } };
}
export function normPts(v) {
  const a = Array.isArray(v) && v.length >= 2 ? v : [[0, 0], [1, 1]];
  return a.map(q => Array.isArray(q) ? [+q[0] || 0, +q[1] || 0] : [+q.x || 0, +q.y || 0]).sort((p, q) => p[0] - q[0]);
}

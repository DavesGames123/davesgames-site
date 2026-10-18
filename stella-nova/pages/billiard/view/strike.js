// ============================================================================
//  POOL PHYSICS  ·  view/strike.js — where the cue tip hits the cue ball
// ----------------------------------------------------------------------------
//  The cue ball face as the shooter sees it: a drag or a tap puts the tip.
//  a (right +) and b (top +) are fractions of R; the dashed ring is the
//  miscue limit (0.5 R). The words under it name the spin: follow, draw,
//  stun, left or right english.
//
//  createStrike(host, { onChange }) -> { set(a, b), value, el }
// ============================================================================
import { MAX_TIP } from '../core/physics.js';

const NS = 'http://www.w3.org/2000/svg';
export function spinWords(a, b) {
  const v = b > 0.08 ? 'follow' : b < -0.08 ? 'draw' : 'stun';
  const s = a > 0.08 ? 'right english' : a < -0.08 ? 'left english' : '';
  return s ? `${v}, ${s}` : v;
}

export function createStrike(host, { onChange = () => {}, size = 112 } = {}) {
  const doc = host.ownerDocument;
  const wrap = doc.createElement('div'); wrap.className = 'strike';
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-60 -60 120 120'); svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'slider'); svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', 'Cue tip position on the cue ball. Arrow keys move it.');
  const mk = (tag, attrs) => { const e = doc.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); svg.appendChild(e); return e; };
  mk('circle', { cx: 0, cy: 0, r: 50, fill: '#f4f1e8', stroke: 'rgba(0,0,0,0.4)', 'stroke-width': 1 });
  mk('circle', { cx: 0, cy: 0, r: 50 * MAX_TIP, fill: 'none', stroke: 'rgba(0,0,0,0.35)', 'stroke-width': 1, 'stroke-dasharray': '3 3' });
  mk('line', { x1: -50, y1: 0, x2: 50, y2: 0, stroke: 'rgba(0,0,0,0.25)', 'stroke-width': 1 });
  mk('line', { x1: 0, y1: -50, x2: 0, y2: 50, stroke: 'rgba(0,0,0,0.25)', 'stroke-width': 1 });
  mk('circle', { cx: 0, cy: -20, r: 2, fill: 'rgba(0,0,0,0.3)' });   // natural roll, 0.4 R
  const dot = mk('circle', { cx: 0, cy: 0, r: 6.5, fill: '#2f5fa8', stroke: '#fff', 'stroke-width': 1.5 });
  const words = doc.createElement('div'); words.className = 'strike-words';
  wrap.append(svg, words);
  host.appendChild(wrap);
  const W = { el: wrap, value: { a: 0, b: 0 } };
  const paint = () => {
    dot.setAttribute('cx', String(W.value.a * 50)); dot.setAttribute('cy', String(-W.value.b * 50));
    words.textContent = `${spinWords(W.value.a, W.value.b)} · a ${W.value.a.toFixed(2)}R, b ${W.value.b.toFixed(2)}R`;
    svg.setAttribute('aria-valuetext', words.textContent);
  };
  W.set = (a, b, fire = false) => {
    const r = Math.hypot(a, b); if (r > MAX_TIP) { a *= MAX_TIP / r; b *= MAX_TIP / r; }
    W.value = { a, b }; paint();
    if (fire) onChange(W.value);
  };
  const at = e => {
    const r = svg.getBoundingClientRect(), k = 120 / Math.max(1, r.width);
    const x = (e.clientX - r.left) * k - 60, y = (e.clientY - r.top) * k - 60;
    W.set(x / 50, -y / 50, true);
  };
  let drag = false;
  svg.addEventListener('pointerdown', e => { drag = true; try { svg.setPointerCapture(e.pointerId); } catch (x) { /* old */ } at(e); e.preventDefault(); });
  svg.addEventListener('pointermove', e => { if (drag) at(e); });
  svg.addEventListener('pointerup', () => { drag = false; });
  svg.addEventListener('pointercancel', () => { drag = false; });
  svg.addEventListener('keydown', e => {
    const s = 0.05, m = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] }[e.key];
    if (!m) return;
    e.preventDefault(); W.set(W.value.a + m[0], W.value.b + m[1], true);
  });
  paint();
  return W;
}

// ============================================================================
//  AUTOREGRESSIVE VIEW MODEL  ·  lab.js — drawing the lab figure
// ----------------------------------------------------------------------------
//  Canvas 2D. drawMap: the floor plan, the path, every camera by role, and
//  the rays of the current targets (imagined rays in pink). drawNow: the
//  target views of the chunk as strips over the true strips. drawFilm: all
//  generated views so far, one row per view. ctxBar: the context sequence.
//
//  grep -n: "export function drawMap"  "export function drawNow"
//           "export function drawFilm"  "export function ctxBar"  "export function fit"
// ============================================================================
import { SEGS, WORLD, FOV, COLS, truthColor } from './world.js';

const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#fff';
let COL = null;
const cols = () => COL || (COL = { sink: css('--m6'), rtr: css('--m3'), mot: css('--m2'), tgt: css('--m1'), pre: css('--m5'), img: css('--m4') });

export function fit(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth || 300, h = cv.clientHeight || 150;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [c, w, h];
}
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

function frustum(c, s, p, color, lw, len = 1.1, fill = false) {
  const [x, y] = s(p.x, p.y);
  const a0 = p.yaw - FOV / 2, a1 = p.yaw + FOV / 2;
  const [x0, y0] = s(p.x + Math.cos(a0) * len, p.y + Math.sin(a0) * len), [x1, y1] = s(p.x + Math.cos(a1) * len, p.y + Math.sin(a1) * len);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x0, y0); c.lineTo(x1, y1); c.closePath();
  if (fill) { c.globalAlpha = 0.25; c.fillStyle = color; c.fill(); c.globalAlpha = 1; }
  c.strokeStyle = color; c.lineWidth = lw; c.stroke();
}

export function drawMap(cv, st, path, ci) {
  const [c, w, h] = fit(cv), C = cols();
  const sc = Math.min((w - 16) / WORLD.w, (h - 16) / WORLD.h), ox = (w - WORLD.w * sc) / 2, oy = (h - WORLD.h * sc) / 2;
  const s = (x, y) => [ox + x * sc, oy + (WORLD.h - y) * sc];
  c.fillStyle = '#05070a'; c.fillRect(0, 0, w, h);
  // the path ahead
  c.strokeStyle = 'rgba(200,210,225,0.18)'; c.lineWidth = 1; c.setLineDash([3, 4]); c.beginPath();
  path.forEach((p, i) => { const [x, y] = s(p.x, p.y); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); c.setLineDash([]);
  // walls in their true colours
  c.lineCap = 'round'; c.lineWidth = Math.max(2.5, sc * 0.16);
  for (const g of SEGS) { const [a, b] = s(g.x0, g.y0), [d, e] = s(g.x1, g.y1); const t = truthColor(g.id * 1000 + 1); c.strokeStyle = rgb(t); c.beginPath(); c.moveTo(a, b); c.lineTo(d, e); c.stroke(); }
  if (!st) return;
  // history cameras
  c.fillStyle = 'rgba(180,190,205,0.35)';
  for (const v of st.history) { const [x, y] = s(v.pose.x, v.pose.y); c.fillRect(x - 1, y - 1, 2, 2); }
  for (const v of st.pool) if (v.kind === 'prefill') frustum(c, s, v.pose, C.pre, 1.2, 0.9);
  const ch = st.chunks[ci];
  if (!ch) return;
  // rays of the targets: reconstructed faint, imagined pink
  for (const v of ch.targets) {
    const [x, y] = s(v.pose.x, v.pose.y);
    v.cols.forEach((col, k) => {
      if (k % 2) return;
      const [hx, hy] = s(col.hx, col.hy);
      c.strokeStyle = v.src[k] === 2 ? C.img : 'rgba(134,220,124,0.22)'; c.globalAlpha = v.src[k] === 2 ? 0.7 : 1; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(hx, hy); c.stroke(); c.globalAlpha = 1;
    });
  }
  for (const v of ch.sink) frustum(c, s, v.pose, C.sink, 2, 1.0, true);
  for (const v of ch.retrieved) frustum(c, s, v.pose, C.rtr, 2, 1.0, true);
  for (const v of ch.motion) frustum(c, s, v.pose, C.mot, 2, 1.0, true);
  for (const v of ch.targets) frustum(c, s, v.pose, C.tgt, 2.2, 1.25, true);
}

export function drawNow(cv, ch) {
  const [c, w, h] = fit(cv), C = cols();
  c.fillStyle = '#05070a'; c.fillRect(0, 0, w, h);
  if (!ch) return;
  const n = ch.targets.length, gw = (w - 8 * (n - 1)) / n, cw = gw / COLS;
  ch.targets.forEach((v, i) => {
    const x0 = i * (gw + 8);
    v.cols.forEach((col, k) => {
      const x = x0 + k * cw;
      const shown = col.key >= 0 ? v.obs.get(col.key) : [10, 12, 16];
      const tr = col.key >= 0 ? truthColor(col.key) : [10, 12, 16];
      const wallH = Math.min(1, 1.6 / Math.max(0.3, col.dist));
      c.fillStyle = rgb(shown); c.fillRect(x, (h * 0.42) * (1 - wallH) / 2 + 2, cw + 0.5, h * 0.42 * wallH);
      c.fillStyle = rgb(tr); c.fillRect(x, h * 0.5 + (h * 0.42) * (1 - wallH) / 2 + 2, cw + 0.5, h * 0.42 * wallH);
      if (v.src[k] === 2) { c.fillStyle = C.img; c.fillRect(x, h * 0.46, cw + 0.5, 3); }
    });
  });
}

export function drawFilm(cv, st) {
  const [c, w, h] = fit(cv);
  c.fillStyle = '#05070a'; c.fillRect(0, 0, w, h);
  if (!st || !st.history.length) return;
  const n = st.history.length, rh = Math.max(1, Math.min(3, h / Math.max(n, 50))), cw = w / COLS / 2;
  const start = Math.max(0, n - Math.floor(h / rh));
  for (let i = start; i < n; i++) {
    const v = st.history[i], y = (i - start) * rh;
    v.cols.forEach((col, k) => {
      if (col.key < 0) return;
      c.fillStyle = rgb(v.obs.get(col.key)); c.fillRect(k * cw, y, cw + 0.4, rh);
      c.fillStyle = rgb(truthColor(col.key)); c.fillRect(w / 2 + k * cw, y, cw + 0.4, rh);
    });
  }
  c.fillStyle = 'rgba(5,7,10,0.8)'; c.fillRect(w / 2 - 1, 0, 2, h);
  c.font = '10px ui-monospace, Menlo, monospace'; c.fillStyle = 'rgba(230,235,241,0.75)'; c.textBaseline = 'bottom';
  c.fillText('generated', 4, h - 3); c.fillText('true scene', w / 2 + 4, h - 3);
}

export function ctxBar(el, ch, Lsin) {
  if (!ch) { el.innerHTML = '<span class="k-none">press Play or Step</span>'; return; }
  const parts = [];
  const add = (cls, n, lab) => { for (let i = 0; i < n; i++) parts.push(`<span class="${cls}" title="${lab}">${i === 0 ? lab : ''}</span>`); };
  add('k-sink', ch.sink.length, 'sink'); if (!ch.sink.length && Lsin) parts.push('<span class="k-none">no sink</span>');
  add('k-rtr', ch.retrieved.length, 'rtr'); if (!ch.retrieved.length) parts.push('<span class="k-none">0 rtr</span>');
  add('k-mot', ch.motion.length, 'mot'); add('k-tgt', ch.targets.length, 'target');
  el.innerHTML = parts.join('');
}

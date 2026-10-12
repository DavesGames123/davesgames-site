// ============================================================================
//  PERIODIC TABLE  ·  saver-fx.js  ·  the screensaver light layer (no DOM)
// ----------------------------------------------------------------------------
//  Canvas 2D drawing for saver.js. Every function takes a context in CSS
//  px (the caller sets the dpr transform) and draws vector shapes or
//  gradients at their true size. Nothing here scales a cached raster.
//
//    drawSky        a slow star field in three depth layers. The layers
//                   move against the camera (parallax) and twinkle. It
//                   goes under the tiles (saver.js wraps Table.drawBg).
//    drawLight      a soft coloured light under a subject
//    drawHalo       a ring of bloom around a tile ('lighter')
//    drawStreaks    light trails behind the tiles while they fly
//    drawBurst      an expanding ring and a flash (a new discovery)
//    drawScan       a bright scan line that wipes across the frame
//    drawVeil       the dark veil under the atom close-up
//    drawCounter    a large year counter and a caption
//    drawIEPanel    the ionization staircase of one element
//    drawIsoPanel   the natural isotopes of one element
//
//  The unit-radius gradients are made once per colour and reused through
//  translate and scale, so a glow costs one fillRect.
//
//  GREP MAP
//    grep -n "export function drawSky"
//    grep -n "export function drawStreaks"
//    grep -n "export function drawIEPanel"
//    grep -n "function glowFill"        the cached unit gradients
// ============================================================================
import { hexA, hexRGB } from './atom.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const FONT = 'Inter, system-ui, sans-serif';

// ── cached unit gradients ──────────────────────────────────────────────────
// key: context + colour + kind. A gradient belongs to the context that
// made it, so the cache is per context.
const GRADS = new WeakMap();
function glowFill(g, col, kind) {
  let m = GRADS.get(g);
  if (!m) { m = new Map(); GRADS.set(g, m); }
  const key = col + kind;
  let gr = m.get(key);
  if (gr) return gr;
  const [r, gg, b] = hexRGB(col);
  const c = a => `rgba(${r},${gg},${b},${a})`;
  gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  if (kind === 'ring') {
    gr.addColorStop(0, c(0)); gr.addColorStop(0.42, c(0)); gr.addColorStop(0.56, c(0.55));
    gr.addColorStop(0.7, c(0.18)); gr.addColorStop(1, c(0));
  } else {
    gr.addColorStop(0, c(1)); gr.addColorStop(0.25, c(0.42)); gr.addColorStop(0.6, c(0.1)); gr.addColorStop(1, c(0));
  }
  m.set(key, gr);
  return gr;
}
function blob(g, x, y, r, fill) {
  g.save(); g.translate(x, y); g.scale(r, r); g.fillStyle = fill; g.fillRect(-1, -1, 2, 2); g.restore();
}

// ── star field ─────────────────────────────────────────────────────────────
// Stars in unit coordinates; built once from a fixed seed.
let STARS = null;
function stars() {
  if (STARS) return STARS;
  let s = 987654321;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  STARS = [];
  for (let i = 0; i < 260; i++) {
    const layer = i < 150 ? 0 : i < 230 ? 1 : 2;
    STARS.push({ x: rnd(), y: rnd(), layer, m: rnd(), ph: rnd() * TAU, hue: rnd() });
  }
  return STARS;
}
export const SKY_LAYERS = [0.012, 0.035, 0.09];   // parallax per layer
// cam: { x, y, z } the camera pan in screen px and its zoom; t in s. A
// push-in spreads the near layers from the centre a little (depth).
export function drawSky(g, W, H, cam, t, alpha = 1) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  const lz = Math.log(Math.max(0.2, cam.z || 1));
  for (const st of stars()) {
    const par = SKY_LAYERS[st.layer], sp = 1 + lz * par * 3;
    let x = (W / 2 + (st.x * W - W / 2) * sp - cam.x * par + t * (2 + 4 * st.layer)) % W; if (x < 0) x += W;
    let y = (H / 2 + (st.y * H - H / 2) * sp - cam.y * par) % H; if (y < 0) y += H;
    const tw = 0.55 + 0.45 * Math.sin(t * (0.6 + st.m) + st.ph);
    const a = alpha * (0.12 + 0.5 * st.m * st.m) * tw * (0.6 + 0.4 * st.layer);
    if (a < 0.02) continue;
    const r = 0.45 + st.layer * 0.45 + st.m * 0.5;
    g.fillStyle = st.hue < 0.7 ? `rgba(205,222,255,${a})` : st.hue < 0.88 ? `rgba(255,214,170,${a})` : `rgba(170,190,255,${a})`;
    if (st.layer === 2 && st.m > 0.6) {
      // a brighter star: a small soft disc and a faint cross
      blob(g, x, y, r * 4.5, glowFill(g, '#bcd2ff', 'soft'));
      g.fillRect(x - r * 5, y - 0.35, r * 10, 0.7); g.fillRect(x - 0.35, y - r * 5, 0.7, r * 10);
    } else g.fillRect(x - r / 2, y - r / 2, r, r);
  }
  g.restore();
}

// A soft light under a subject.
export function drawLight(g, x, y, r, col, a) {
  if (a < 0.01 || r < 1) return;
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = clamp(a, 0, 1);
  blob(g, x, y, r, glowFill(g, col, 'soft'));
  g.restore();
}
// A ring of bloom around a tile of side s.
export function drawHalo(g, x, y, s, col, a) {
  if (a < 0.01 || s < 2) return;
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = clamp(a, 0, 1);
  blob(g, x, y, s * 1.25, glowFill(g, col, 'ring'));
  g.restore();
}

// Light trails. hist: Float32Array of [x, y] per element per frame (len
// frames), head: the newest frame. cols: a colour per element. s: tile
// sides. A trail draws only where a tile moves fast.
export function drawStreaks(g, hist, frames, head, n, cols, sides, a) {
  if (a < 0.01) return;
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  const at = (i, f) => { const o = (((head - f) % frames + frames) % frames) * n * 2 + i * 2; return [hist[o], hist[o + 1]]; };
  for (let i = 0; i < n; i++) {
    const [x0, y0] = at(i, 0), [x1, y1] = at(i, frames - 1);
    const d = Math.hypot(x0 - x1, y0 - y1), s = sides[i];
    if (!(d > s * 0.6) || !(s > 2) || !isFinite(d)) continue;
    // the trail ends at the back edge of the tile
    const ux = (x0 - x1) / d, uy = (y0 - y1) / d;
    const ex = x0 - ux * s * 0.45, ey = y0 - uy * s * 0.45;
    const sx = ex - ux * Math.min(d * 1.6, s * 7), sy = ey - uy * Math.min(d * 1.6, s * 7);
    const k = clamp(d / (s * 3), 0, 1) * a;
    const gr = g.createLinearGradient(sx, sy, ex, ey);
    gr.addColorStop(0, hexA(cols[i], 0)); gr.addColorStop(1, hexA(cols[i], 0.5 * k));
    g.strokeStyle = gr; g.lineWidth = s * 0.5;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
  }
  g.restore();
}

// An expanding ring and a flash; u 0..1 is the age of the burst.
export function drawBurst(g, x, y, s, col, u) {
  if (u <= 0 || u >= 1) return;
  g.save(); g.globalCompositeOperation = 'lighter';
  g.globalAlpha = (1 - u) * (1 - u);
  blob(g, x, y, s * (1.2 + 1.6 * u), glowFill(g, col, 'soft'));
  g.strokeStyle = hexA(col, 0.9 * (1 - u)); g.lineWidth = Math.max(1, s * 0.05 * (1 - u));
  g.beginPath(); g.arc(x, y, s * (0.6 + 2.2 * Math.sqrt(u)), 0, TAU); g.stroke();
  g.restore();
}

// A vertical scan line at x across the frame f, with a soft wake.
export function drawScan(g, f, x, col, a) {
  if (a < 0.01) return;
  g.save(); g.globalCompositeOperation = 'lighter';
  const wake = Math.max(40, f.w * 0.12);
  const gr = g.createLinearGradient(x - wake, 0, x + 6, 0);
  gr.addColorStop(0, hexA(col, 0)); gr.addColorStop(0.9, hexA(col, 0.16 * a)); gr.addColorStop(1, hexA(col, 0));
  g.fillStyle = gr; g.fillRect(x - wake, f.y, wake + 6, f.h);
  g.fillStyle = hexA('#ffffff', 0.7 * a); g.fillRect(x - 0.75, f.y, 1.5, f.h);
  g.restore();
}

// The dark veil over the table under the atom close-up.
export function drawVeil(g, W, H, a) {
  if (a < 0.005) return;
  g.save(); g.fillStyle = `rgba(3,5,11,${0.86 * clamp(a, 0, 1)})`; g.fillRect(0, 0, W, H); g.restore();
}

// A large counter (the year) at the right of box b, a caption under it.
export function drawCounter(g, b, big, cap, a = 1, col = '#f4f1ea') {
  if (a < 0.01) return;
  const fs = clamp(Math.min(b.w * 0.36, b.h * 0.22), 22, 120);
  g.save(); g.globalAlpha = a;
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = `200 ${fs}px ${FONT}`; g.fillStyle = col;
  g.shadowColor = 'rgba(140,180,255,0.55)'; g.shadowBlur = fs * 0.25;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  g.fillText(big, cx, cy);
  g.shadowBlur = 0;
  g.font = `500 ${clamp(fs * 0.16, 10, 16)}px ${FONT}`; g.fillStyle = 'rgba(200,212,232,0.85)';
  g.fillText(cap, cx, cy + clamp(fs * 0.34, 16, 36));
  g.restore();
}

// ── atom panels ────────────────────────────────────────────────────────────
// The ionization staircase in box b: one bar per removed electron, log
// height, coloured by shell; a jump (a new inner shell) has a bright bar.
export function drawIEPanel(g, b, steps, col, a = 1) {
  if (a < 0.01 || steps.length < 2 || b.w < 60 || b.h < 50) return;
  g.save(); g.globalAlpha = a;
  const fs = clamp(b.h * 0.075, 10, 14);
  g.font = `600 ${fs}px ${FONT}`; g.fillStyle = 'rgba(232,238,248,0.95)'; g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText('Ionization energies', b.x, b.y);
  g.font = `400 ${fs * 0.85}px ${FONT}`; g.fillStyle = 'rgba(190,203,226,0.8)';
  g.fillText('eV, log scale, one bar per electron', b.x, b.y + fs * 1.35);
  const top = b.y + fs * 3.1, bot = b.y + b.h - fs * 1.4, h = Math.max(10, bot - top);
  const lo = Math.log(Math.max(1, Math.min(...steps.map(s => s.eV))) * 0.6), hi = Math.log(Math.max(...steps.map(s => s.eV)) * 1.1);
  const n = steps.length, gap = Math.max(1.5, b.w * 0.012), bw = (b.w - gap * (n - 1)) / n;
  g.strokeStyle = 'rgba(160,185,225,0.35)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(b.x, bot + 0.5); g.lineTo(b.x + b.w, bot + 0.5); g.stroke();
  g.textAlign = 'center';
  for (let k = 0; k < n; k++) {
    const st = steps[k];
    const t = clamp((Math.log(st.eV) - lo) / (hi - lo), 0.02, 1);
    const x = b.x + k * (bw + gap), y = bot - t * h;
    const c = st.jump ? '#ffffff' : col;
    const gr = g.createLinearGradient(0, y, 0, bot);
    gr.addColorStop(0, hexA(c === '#ffffff' ? '#fff3c4' : c, 0.95)); gr.addColorStop(1, hexA(c === '#ffffff' ? '#ffb54a' : c, 0.25));
    g.fillStyle = gr; g.fillRect(x, y, bw, bot - y);
    if (bw >= fs * 1.1) {
      g.fillStyle = 'rgba(200,212,232,0.8)'; g.font = `500 ${fs * 0.8}px ${FONT}`;
      g.fillText(st.shell, x + bw / 2, bot + 3);
    }
    if (st.jump && bw > 4) {
      g.fillStyle = 'rgba(255,240,200,0.95)'; g.font = `500 ${fs * 0.8}px ${FONT}`; g.textBaseline = 'bottom';
      g.fillText(Math.round(st.eV) + ' eV', clamp(x + bw / 2, b.x + fs * 2, b.x + b.w - fs * 2), y - 3);
      g.textBaseline = 'top';
    }
  }
  g.restore();
}
// The natural isotopes in box b: a bar per isotope, its percent.
export function drawIsoPanel(g, b, bars, col, a = 1) {
  if (a < 0.01 || !bars.length || b.w < 60 || b.h < 40) return;
  g.save(); g.globalAlpha = a;
  const fs = clamp(b.h * 0.1, 10, 14);
  g.font = `600 ${fs}px ${FONT}`; g.fillStyle = 'rgba(232,238,248,0.95)'; g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText('Natural isotopes', b.x, b.y);
  const top = b.y + fs * 1.8, row = Math.min(fs * 1.7, (b.y + b.h - top) / bars.length);
  const lab = fs * 3.2, w = b.w - lab - fs * 4;
  g.textBaseline = 'middle';
  bars.forEach((it, k) => {
    const y = top + k * row + row / 2;
    g.fillStyle = 'rgba(205,218,240,0.85)'; g.font = `500 ${fs * 0.9}px ${FONT}`; g.textAlign = 'left';
    g.fillText(String(it.A), b.x, y);
    const bw = Math.max(1.5, w * it.pct / 100);
    g.fillStyle = hexA(col, 0.85); g.fillRect(b.x + lab, y - row * 0.28, bw, row * 0.56);
    g.fillStyle = 'rgba(205,218,240,0.75)'; g.font = `400 ${fs * 0.85}px ${FONT}`;
    g.fillText(it.pct >= 1 ? it.pct.toFixed(1) + ' %' : it.pct.toPrecision(2) + ' %', b.x + lab + bw + 6, y);
  });
  g.restore();
}

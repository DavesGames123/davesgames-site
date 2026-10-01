// engine-cpu.js - the CPU fallback engine, for browsers with no WebGPU.
//
// It has the same API as engine-gpu.js, on a small world, and it draws with
// Canvas 2D. stepDense() from life.js does each generation, so the rule is
// the same code as the tests use. cellColour() must stay the same as
// cell_colour() in render.wgsl.
import { TRAIL, stepDense, diffStats } from './life.js';

const BG = [0.027, 0.035, 0.051], PLAIN = [0.914, 0.937, 0.902], NEWBORN = [1.0, 0.84, 0.43];
const YOUNG = [0.72, 0.94, 0.48], MATURE = [0.27, 0.82, 0.69], OLD = [0.29, 0.53, 0.91], GHOST = [0.76, 0.29, 0.43];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function cellColour(v, mode, trails) {
  const age = v & 0xff;
  if (age) {
    if (mode === 'plain') return PLAIN;
    if (age === 1) return NEWBORN;
    const f = Math.min(1, Math.max(0, Math.log2(age - 1) / 6));
    return f < 0.5 ? mix(YOUNG, MATURE, f * 2) : mix(MATURE, OLD, f * 2 - 1);
  }
  const t = (v >> 8) & 0xff;
  if (!trails || t <= 0) return BG;
  const k = t / TRAIL;
  return mix(BG, GHOST, 0.36 * k * k);
}

export function createCpuEngine(canvas) {
  const g = canvas.getContext('2d');
  const off = document.createElement('canvas'), og = off.getContext('2d');
  const e = { kind: 'cpu', lost: false, stats: { pop: 0, births: 0, deaths: 0, gen: 0 }, onStats: null, onLost: null };
  let W = 0, H = 0, wrap = true, birth = 1 << 3, survive = 12, A = null, B = null, gen = 0, img = null;
  let pw = 1, ph = 1;
  const emit = () => { if (typeof e.onStats === 'function') e.onStats(e.stats); };

  e.setWorld = (w, h) => {
    W = w; H = h; gen = 0;
    A = new Uint32Array(W * H); B = new Uint32Array(W * H);
    off.width = W; off.height = H; img = og.createImageData(W, H);
    e.stats = { pop: 0, births: 0, deaths: 0, gen: 0 };
  };
  e.size = () => ({ W, H });
  e.setRule = (b, s) => { birth = b; survive = s; };
  e.setWrap = on => { wrap = !!on; };
  e.clear = () => { A.fill(0); B.fill(0); };
  e.write = data => { A.set(data); };
  e.paint = edits => { for (let i = 0; i < edits.length; i += 2) A[edits[i]] = edits[i + 1]; };
  e.step = n => {
    for (let k = 0; k < n; k++) {
      stepDense(A, W, H, birth, survive, wrap, B);
      if (k === n - 1) { const s = diffStats(A, B); gen += n; e.stats = { ...s, gen, step: true }; }
      [A, B] = [B, A];
    }
    emit();
  };
  e.count = () => {
    let pop = 0;
    for (let i = 0; i < A.length; i++) if (A[i] & 0xff) pop++;
    e.stats = { pop, births: 0, deaths: 0, gen, step: false };
    emit();
    return true;
  };
  e.readCell = async (x, y) => A[y * W + x];
  e.read = async () => A.slice();
  e.resize = (w, h) => { pw = Math.max(1, w | 0); ph = Math.max(1, h | 0); if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; } };

  e.render = v => {
    const d = img.data;
    for (let i = 0; i < W * H; i++) {
      const c = cellColour(A[i], v.mode, v.trails);
      d[i * 4] = c[0] * 255; d[i * 4 + 1] = c[1] * 255; d[i * 4 + 2] = c[2] * 255; d[i * 4 + 3] = 255;
    }
    og.putImageData(img, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = 'rgb(3,4,5)';
    g.fillRect(0, 0, pw, ph);
    const x0 = pw / 2 + (v.ox || 0) - v.cx * v.cell, y0 = ph / 2 + (v.oy || 0) - v.cy * v.cell;
    g.imageSmoothingEnabled = v.cell < 1;
    g.drawImage(off, x0, y0, W * v.cell, H * v.cell);
    g.strokeStyle = 'rgb(51,61,77)'; g.lineWidth = 1;
    g.strokeRect(x0 - 0.5, y0 - 0.5, W * v.cell + 1, H * v.cell + 1);
    if (v.grid && v.cell >= 6) {
      const a = Math.min(1, Math.max(0, (v.cell - 6) / 6 + 0.5));
      const cx0 = Math.max(0, Math.floor(-x0 / v.cell)), cx1 = Math.min(W, Math.ceil((pw - x0) / v.cell));
      const cy0 = Math.max(0, Math.floor(-y0 / v.cell)), cy1 = Math.min(H, Math.ceil((ph - y0) / v.cell));
      for (const major of [false, true]) {
        g.strokeStyle = `rgba(140,158,184,${(major ? 0.2 : 0.09) * a})`;
        g.beginPath();
        for (let x = cx0; x <= cx1; x++) if ((x % 10 === 0) === major) { const X = Math.round(x0 + x * v.cell) + 0.5; g.moveTo(X, Math.max(0, y0)); g.lineTo(X, Math.min(ph, y0 + H * v.cell)); }
        for (let y = cy0; y <= cy1; y++) if ((y % 10 === 0) === major) { const Y = Math.round(y0 + y * v.cell) + 0.5; g.moveTo(Math.max(0, x0), Y); g.lineTo(Math.min(pw, x0 + W * v.cell), Y); }
        g.stroke();
      }
    }
  };
  e.destroy = () => {};
  return e;
}

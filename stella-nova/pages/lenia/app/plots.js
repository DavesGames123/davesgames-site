// ============================================================================
//  LENIA  ·  app/plots.js — the kernel and growth plots
// ----------------------------------------------------------------------------
//  The #plots canvas: the kernel disc in the current palette at left, and
//  G(u) with the growth center m at right.
//
//  GREP MAP
//    grep -n 'function drawPlots'  draw both plots
//    grep -n '// Kernel disc.'     the kernel disc
//    grep -n '// Growth curve.'    the G(u) curve
// ============================================================================
import { kernelShell, GROWTH } from '../engine.js';
import { lut } from './catalog.js';
import { $, S } from './state.js';

// Left: the kernel as a disc in the current palette. Right: G(u) for u from 0
// to past m + 4 s, with the growth center m marked.
export function drawPlots() {
  const cv = $('plots'), c = S.c;
  if (!c) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 260, h = cv.clientHeight || 120;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  // Kernel disc.
  const side = h - 16, n = 64;
  const img = g.createImageData(n, n), L = lut(S.view.palette);
  let kmax = 0;
  const vals = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
    const v = kernelShell(r, c.b, c.kn);
    vals[y * n + x] = v; kmax = Math.max(kmax, v);
  }
  for (let i = 0; i < n * n; i++) {
    const k = Math.round(vals[i] / (kmax || 1) * 255);
    img.data[i * 4] = L[k * 3]; img.data[i * 4 + 1] = L[k * 3 + 1]; img.data[i * 4 + 2] = L[k * 3 + 2]; img.data[i * 4 + 3] = 255;
  }
  const tmp = document.createElement('canvas'); tmp.width = n; tmp.height = n;
  tmp.getContext('2d').putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(tmp, 8, 8, side, side);

  // Growth curve.
  const { m, s } = S.rule;
  const x0 = side + 24, x1 = w - 8, y0 = 10, y1 = h - 12;
  const umax = Math.min(1, Math.max(m * 2, m + 5 * s));
  const X = u => x0 + (u / umax) * (x1 - x0);
  const Y = v => y0 + (1 - (v + 1) / 2) * (y1 - y0);
  g.strokeStyle = 'rgba(140,200,230,0.18)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x0, Y(0)); g.lineTo(x1, Y(0)); g.stroke();
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, y1); g.stroke();
  g.setLineDash([3, 3]);
  g.beginPath(); g.moveTo(X(m), y0); g.lineTo(X(m), y1); g.stroke();
  g.setLineDash([]);
  const f = GROWTH[c.gn - 1];
  g.strokeStyle = '#7ad7f0'; g.lineWidth = 1.6;
  g.beginPath();
  for (let i = 0; i <= 200; i++) {
    const u = umax * i / 200, px = X(u), py = Y(f(u, m, s));
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.stroke();
  g.fillStyle = 'rgba(211,221,224,0.65)';
  g.font = '10px ui-monospace, Menlo, monospace';
  g.fillText('+1', x0 + 3, y0 + 8);
  g.fillText('−1', x0 + 3, y1 - 2);
  g.fillText('m', X(m) + 3, y1 - 2);
  g.textAlign = 'right';
  g.fillText(umax.toFixed(2), x1, y1 + 10);
  g.textAlign = 'left';
}

// ============================================================================
//  DARK MATTER HALO  ·  draw-maps.js — the density maps (2D canvas)
// ----------------------------------------------------------------------------
//  drawMeridional: a slice through the Galaxy that contains the rotation
//  axis (the R-z plane). The left half shows the visible matter, the right
//  half the dark matter, on one log colour scale, so the two compare
//  directly. Mode 'share' shows the dark share of the local density.
//
//  drawFaceOn: the disc seen from above inside the projected halo. The
//  star positions and the spiral arms are illustrative; the disc scale
//  length, the halo column density and the orbital speeds come from the
//  model. Stars turn at the speed of the total rotation curve.
//
//  The images are built at grid size into a small canvas, then scaled up
//  with smoothing. A cache keyed on the grid arrays skips the rebuild when
//  only the overlay changes.
//
//  grep -n targets
//    colour scales ......... "export function lutDensity"
//    colour bar ............ "export function drawColorbar"
//    R-z slice ............. "export function drawMeridional"
//    face-on view .......... "export function drawFaceOn"
// ============================================================================
import { PAL } from './draw-charts.js';

const FONT = (px, w = 400) => `${w} ${px}px Inter, system-ui, -apple-system, sans-serif`;
export const LOG_RANGE = Object.freeze([-6, 1.5]);   // log10 Msun/pc^3

function mkCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
const mix = (a, b, t) => a + (b - a) * t;
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i;
  return [0, 1, 2].map(k => mix(stops[i][k], stops[i + 1][k], f));
}
// A dark-to-bright scale: black, indigo, violet, rose, amber, near white.
const DENS = [[3, 4, 10], [28, 16, 68], [86, 40, 140], [168, 64, 150], [232, 112, 98], [252, 196, 96], [255, 246, 220]];
// Dark share: gold (visible) - grey - violet (dark).
const SHARE = [[255, 214, 102], [150, 130, 90], [40, 38, 52], [110, 100, 200], [190, 184, 255]];

export function lutDensity(logRho) { return ramp(DENS, (logRho - LOG_RANGE[0]) / (LOG_RANGE[1] - LOG_RANGE[0])); }
export function lutShare(f) { return ramp(SHARE, f); }

// A horizontal colour bar in box {x, y, w, h}, with labels under it.
export function drawColorbar(g, box, mode, fs = 11) {
  const n = Math.max(2, Math.round(box.w));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), c = mode === 'share' ? lutShare(t) : lutDensity(LOG_RANGE[0] + t * (LOG_RANGE[1] - LOG_RANGE[0]));
    g.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; g.fillRect(box.x + i, box.y, 1.5, box.h);
  }
  g.font = FONT(fs); g.fillStyle = PAL.ink2; g.textBaseline = 'top';
  const lab = mode === 'share'
    ? [[0, 'all visible'], [0.5, 'half dark'], [1, 'all dark']]
    : [[0, '10⁻⁶'], [0.4, '10⁻³'], [0.8, '10⁰'], [1, 'Msun/pc³']];
  for (const [t, s] of lab) { g.textAlign = t === 0 ? 'left' : t === 1 ? 'right' : 'center'; g.fillText(s, box.x + t * box.w, box.y + box.h + 4); }
}

const cache = new WeakMap();
function sliceImage(o) {
  const key = o.gridH, hit = cache.get(key);
  if (hit && hit.gridB === o.gridB && hit.mode === o.mode) return hit.cv;
  const { nx, nz } = o, cv = mkCanvas(2 * nx, nz), g = cv.getContext('2d'), img = g.createImageData(2 * nx, nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const lh = o.gridH[j * nx + i], lb = o.gridB[j * nx + i];
    let cl, cr;
    if (o.mode === 'share') { const f = 1 / (1 + Math.pow(10, lb - lh)); cl = cr = lutShare(f); }
    else { cl = lutDensity(lb); cr = lutDensity(lh); }
    let p = 4 * (j * 2 * nx + (nx - 1 - i));
    img.data[p] = cl[0]; img.data[p + 1] = cl[1]; img.data[p + 2] = cl[2]; img.data[p + 3] = 255;
    p = 4 * (j * 2 * nx + nx + i);
    img.data[p] = cr[0]; img.data[p + 1] = cr[1]; img.data[p + 2] = cr[2]; img.data[p + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  cache.set(key, { gridB: o.gridB, mode: o.mode, cv });
  return cv;
}

// o: { gridH, gridB, nx, nz, Rmax, zmax, mode, R0, fs, labels (default true),
// zoom (1 = whole slice), colorbar (default true) }. Returns the image box.
export function drawMeridional(g, w, h, o) {
  const fs = o.fs || (w < 520 ? 11 : 12), cb = o.colorbar !== false;
  const padB = cb ? fs * 4.2 : fs * 2.2, padT = fs * 2;
  const aspect = (2 * o.Rmax) / (2 * o.zmax);
  let bw = w - 16, bh = bw / aspect;
  if (bh > h - padT - padB) { bh = h - padT - padB; bw = bh * aspect; }
  const z = o.zoom || 1;
  const box = { x: (w - bw) / 2, y: padT + (h - padT - padB - bh) / 2, w: bw, h: bh };
  const img = sliceImage(o);
  g.save();
  g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  g.translate(cx, cy); g.scale(z, z); g.translate(-cx, -cy);
  g.drawImage(img, box.x, box.y, box.w, box.h);
  const kx = box.w / (2 * o.Rmax), X = R => cx + R * kx, Y = zz => cy - zz * kx;
  // Rings of constant r (dashed) at 10 and 20 kpc: the halo is round.
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.setLineDash([3, 5]); g.lineWidth = 1 / z;
  for (const r of [10, 20, 30, 40, 50]) if (r < o.Rmax * 1.5) { g.beginPath(); g.arc(cx, cy, r * kx, 0, Math.PI * 2); g.stroke(); }
  g.setLineDash([]);
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.beginPath(); g.moveTo(cx + 0.5, box.y); g.lineTo(cx + 0.5, box.y + box.h); g.stroke();
  // Sun on both sides.
  for (const s of [-1, 1]) { g.fillStyle = PAL.sun; g.beginPath(); g.arc(X(s * o.R0), Y(0), 3.2 / z, 0, Math.PI * 2); g.fill(); }
  g.restore();
  if (o.labels !== false) {
    g.font = FONT(fs, 500); g.textBaseline = 'bottom';
    g.fillStyle = PAL.baryons; g.textAlign = 'left';
    g.fillText(o.mode === 'share' ? 'dark share (mirrored)' : 'visible matter', box.x, box.y - 4);
    g.fillStyle = PAL.halo; g.textAlign = 'right';
    g.fillText(o.mode === 'share' ? 'dark share' : 'dark matter', box.x + box.w, box.y - 4);
    g.fillStyle = PAL.sun; g.textAlign = 'center'; g.textBaseline = 'top';
    const sx = box.x + box.w / 2 + o.R0 * (box.w / (2 * o.Rmax)) * z;
    if (sx < box.x + box.w - 10) g.fillText('Sun', sx, box.y + box.h / 2 + 6);
    g.font = FONT(fs); g.fillStyle = PAL.dim; g.textAlign = 'center';
    g.fillText(`${(o.Rmax / z).toFixed(0)} kpc  ←  axis  →  ${(o.Rmax / z).toFixed(0)} kpc · height ±${(o.zmax / z).toFixed(0)} kpc`, w / 2, box.y + box.h + 4);
  }
  if (cb) drawColorbar(g, { x: box.x + box.w * 0.15, y: box.y + box.h + fs * 1.7, w: box.w * 0.7, h: 8 }, o.mode, fs);
  return box;
}

// Projected halo glow, cached on the column table.
const glowCache = new WeakMap();
function glowImage(col, size, view) {
  const hit = glowCache.get(col);
  if (hit && hit.size === size && hit.view === view) return hit.cv;
  const cv = mkCanvas(size, size), g = cv.getContext('2d'), img = g.createImageData(size, size);
  const lmax = Math.log10(col.sigma[0] || 1), lmin = lmax - 3;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = ((i + 0.5) / size * 2 - 1) * view, y = ((j + 0.5) / size * 2 - 1) * view, R = Math.hypot(x, y);
    const k = Math.min(col.R.length - 1, Math.floor(R / col.dR));
    const s = col.sigma[k], t = Math.max(0, Math.min(1, (Math.log10(s) - lmin) / (lmax - lmin)));
    const p = 4 * (j * size + i), a = t * t;
    img.data[p] = 30 + 120 * a; img.data[p + 1] = 22 + 100 * a; img.data[p + 2] = 60 + 190 * a; img.data[p + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  glowCache.set(col, { size, view, cv });
  return cv;
}

// o: { stars, curve, t (Myr), col {R, dR, sigma}, view (kpc half-width),
// R0, fs, rv (virial radius, kpc), labels, spin (rad, the camera turn) }.
export function drawFaceOn(g, w, h, o) {
  const fs = o.fs || (w < 520 ? 11 : 12), view = o.view || 30;
  const s = Math.min(w, h) / 2 - 6, cx = w / 2, cy = h / 2, k = s / view;
  g.save();
  g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
  g.beginPath(); g.arc(cx, cy, s, 0, Math.PI * 2); g.clip();
  g.drawImage(glowImage(o.col, 220, view), cx - s, cy - s, 2 * s, 2 * s);
  // Rings every 10 kpc.
  g.strokeStyle = 'rgba(255,255,255,0.14)'; g.setLineDash([2, 5]); g.lineWidth = 1;
  for (let r = 10; r < view; r += 10) { g.beginPath(); g.arc(cx, cy, r * k, 0, Math.PI * 2); g.stroke(); }
  g.setLineDash([]);
  // Stars: angle phi + omega(R) t, omega = v / R (km/s per kpc -> rad/Myr).
  const c = o.curve, R = c.R, v = c.v.total, KM = 1.0227e-3;
  g.globalCompositeOperation = 'lighter';
  const sz = Math.max(1, k * 0.12);
  let j = 0;
  for (const st of o.stars) {
    while (j > 0 && R[j] > st.R) j--;
    while (j < R.length - 1 && R[j + 1] < st.R) j++;
    const vv = v[j] + (v[Math.min(j + 1, R.length - 1)] - v[j]) * Math.max(0, Math.min(1, (st.R - R[j]) / ((R[j + 1] ?? R[j] + 1) - R[j])));
    const ph = st.phi + (o.spin || 0) + vv / Math.max(st.R, 0.05) * KM * o.t;
    const x = cx + st.R * Math.cos(ph) * k, y = cy - st.R * Math.sin(ph) * k;
    g.fillStyle = st.gas ? 'rgba(120,200,255,0.55)' : `rgba(255,${200 + 40 * st.m | 0},${150 + 60 * st.m | 0},${0.35 + 0.5 * st.m})`;
    g.fillRect(x - sz / 2, y - sz / 2, sz, sz);
  }
  g.globalCompositeOperation = 'source-over';
  // The Sun turns with the disc.
  const v0 = v[R.findIndex(r => r >= o.R0)], ps = (o.spin || 0) + v0 / o.R0 * KM * o.t;
  const sx = cx + o.R0 * Math.cos(ps) * k, sy = cy - o.R0 * Math.sin(ps) * k;
  g.strokeStyle = PAL.sun; g.lineWidth = 1.6; g.beginPath(); g.arc(sx, sy, 5, 0, Math.PI * 2); g.stroke();
  g.fillStyle = PAL.sun; g.beginPath(); g.arc(sx, sy, 1.6, 0, Math.PI * 2); g.fill();
  g.restore();
  g.strokeStyle = 'rgba(168,164,255,0.35)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, s, 0, Math.PI * 2); g.stroke();
  if (o.labels !== false) {
    g.font = FONT(fs, 500); g.fillStyle = PAL.sun; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('Sun', sx + 9, sy);
    g.font = FONT(fs); g.fillStyle = PAL.ink2; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(`${view} kpc to the edge of this view`, 8, 8);
    if (o.rv) { g.fillStyle = PAL.halo; g.fillText(`the halo goes on to about ${o.rv.toFixed(0)} kpc`, 8, 8 + fs + 4); }
    g.fillStyle = PAL.dim; g.textBaseline = 'bottom';
    g.fillText(`${o.t.toFixed(0)} million years`, 8, h - 8);
  }
  return { x: cx, y: cy, r: s };
}

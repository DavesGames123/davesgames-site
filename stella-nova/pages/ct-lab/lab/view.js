// lab/view.js - drawing helpers for the CT lab: HU conversion, display windows, colour
// mapping of images and sinograms, the schematic gantry overlay, the residual plot and
// the export sheet. Canvas code takes a 2D context; the pixel code is pure (node tests).
//
// The gantry is schematic. The source and the detector sit on a ring around the image.
// The fan keeps its real width at the rotation axis. Each drawn ray is as bright as the
// photons that reach its detector element: exp(-p).
//
// grep handles:
//   MU_WATER, huOf, muOf, windowRange, paintImage, paintSigned, drawGantry, drawResidual,
//   drawSheet, formatValue

import { muAt } from '../engine/index.js';
import { WINDOWS } from './presets.js';
import * as CM from '../colormaps/maps.js';

export const MU_WATER = muAt('water', 70);
export const huOf = (mu) => (1000 * (mu - MU_WATER)) / MU_WATER;
export const muOf = (hu) => MU_WATER * (1 + hu / 1000);

// Display window in data units (mu). hu: the phantom is in 1/cm. truth: { lo, hi } of the phantom.
export function windowRange(win, hu, truth) {
  let w = typeof win === 'string' ? WINDOWS.find((x) => x.id === win) : win;
  if (!w || w.auto || (w.hu !== undefined && w.hu !== hu)) {
    const lo = Math.min(0, truth.lo), hi = truth.hi > lo ? truth.hi : lo + 1;
    return { lo, hi, level: hu ? huOf((lo + hi) / 2) : (lo + hi) / 2, width: hu ? huOf(hi) - huOf(lo) : hi - lo, id: 'auto' };
  }
  const L = w.level, W = Math.max(1e-6, w.width);
  if (hu) return { lo: muOf(L - W / 2), hi: muOf(L + W / 2), level: L, width: W, id: w.id ?? 'custom' };
  return { lo: L - W / 2, hi: L + W / 2, level: L, width: W, id: w.id ?? 'custom' };
}

export function formatValue(mu, hu) {
  if (!Number.isFinite(mu)) return '-';
  if (hu) return `${Math.round(huOf(mu))} HU`;
  return `${mu.toFixed(3)}`;
}

// Float image -> RGBA bytes through a colour map. out: Uint8ClampedArray (ImageData.data).
export function paintImage(data, lo, hi, out, cmap = 'grey', opts = {}) {
  CM.apply(cmap, data, lo, hi, out, opts);
  return out;
}

// Signed image (a - b) -> RGBA with a diverging map, symmetric window +-span.
export function paintSigned(a, b, span, out, cmap = 'coolwarm', tmp) {
  const n = a.length, d = tmp && tmp.length === n ? tmp : new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = a[i] - b[i];
  CM.apply(cmap, d, -span, span, out);
  return d;
}

const TAU = Math.PI * 2;

// Schematic gantry over the phantom panel.
// box: { cx, cy, R } screen centre and ring radius (px). scale: px per world unit, so the
// rays keep their real offsets at the rotation axis. geom: the scan geometry; a: the view
// index; sino: the measured sinogram; pmax: its max. The fan detector is drawn as an arc
// (curved) or a chord (flat) about the source, which sits on the ring.
export function drawGantry(ctx, box, scale, geom, a, sino, pmax, o = {}) {
  const { cx, cy, R } = box;
  const av = Math.max(0, Math.min(geom.nAngles - 1, a));
  const b = geom.angles[av];
  const dX = -Math.sin(b), dY = Math.cos(b), nX = Math.cos(b), nY = Math.sin(b);
  const S = (x, y) => [cx + x, cy - y];             // screen from ring-space px (y up)
  const fan = geom.type === 'fan';
  const nDet = geom.nDet, row = av * nDet;
  const rSrc = R * 0.97, rDet = R * 0.86, Rf = R * 1.6;
  // lateral offset of element i at the rotation axis, in px
  const uAxis = (i) => ((i - (nDet - 1) / 2) * geom.du + (geom.offset ?? 0)) * (fan ? geom.sod / geom.sdd : 1) * scale;
  const gMax = fan ? Math.atan(Math.max(Math.abs(uAxis(0)), Math.abs(uAxis(nDet - 1))) / rSrc) : 0;
  const srcX = -rSrc * dX, srcY = -rSrc * dY;
  // detector point of element i, and its outward unit normal
  const detPt = (i) => {
    const u = uAxis(i);
    if (!fan) return [rDet * dX + u * nX, rDet * dY + u * nY, dX, dY];
    const g = Math.atan(u / rSrc), cg = Math.cos(g), sg = Math.sin(g);
    const ux = cg * dX + sg * nX, uy = cg * dY + sg * nY;
    if (geom.detector === 'arc') return [srcX + Rf * ux, srcY + Rf * uy, ux, uy];
    const L = (Rf * Math.cos(gMax)) / cg;
    return [srcX + L * ux, srcY + L * uy, dX, dY];
  };
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.lineWidth = Math.max(1, R * 0.012);
  ctx.strokeStyle = 'rgba(150,180,210,0.22)';
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(150,180,210,0.07)';
  ctx.lineWidth = R * 0.05;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.065, 0, TAU); ctx.stroke();
  // rays, each as bright as the photons that reach its element
  const nRays = Math.min(nDet, o.rays ?? 41);
  ctx.lineWidth = Math.max(0.6, R * 0.0045);
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < nRays; k++) {
    const i = Math.round((k / (nRays - 1)) * (nDet - 1));
    const p = sino ? sino.data[row + i] : 0;
    const t = Math.exp(-Math.max(0, p) * (o.raysGain ?? 1));
    const [ax, ay] = fan ? S(srcX, srcY) : S(srcX + uAxis(i) * nX, srcY + uAxis(i) * nY);
    const dp = detPt(i);
    const [bx, by] = S(dp[0], dp[1]);
    const g = ctx.createLinearGradient(ax, ay, bx, by);
    g.addColorStop(0, 'rgba(120,210,255,0.34)');
    g.addColorStop(0.5, `rgba(120,210,255,${0.05 + 0.2 * t})`);
    g.addColorStop(1, `rgba(255,196,120,${0.05 + 0.55 * t})`);
    ctx.strokeStyle = g;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  // detector and the projection profile on it
  const step = Math.max(1, Math.floor(nDet / 180));
  ctx.lineWidth = Math.max(2, R * 0.022);
  ctx.strokeStyle = 'rgba(255,186,104,0.92)';
  ctx.beginPath();
  for (let i = 0; i < nDet; i += step) { const q = detPt(i); const [x, y] = S(q[0], q[1]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  { const q = detPt(nDet - 1); const [x, y] = S(q[0], q[1]); ctx.lineTo(x, y); }
  ctx.stroke();
  if (sino && pmax > 0) {
    const H = R * 0.13;
    ctx.beginPath();
    for (let i = 0; i < nDet; i += step) {
      const q = detPt(i), h = R * 0.03 + (H * Math.max(0, sino.data[row + i])) / pmax;
      const [x, y] = S(q[0] + h * q[2], q[1] + h * q[3]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineWidth = Math.max(1, R * 0.008);
    ctx.strokeStyle = 'rgba(255,220,160,0.95)';
    ctx.stroke();
  }
  // source
  const [sx, sy] = S(srcX, srcY);
  if (fan) {
    const gl = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 0.1);
    gl.addColorStop(0, 'rgba(220,245,255,1)'); gl.addColorStop(0.3, 'rgba(110,200,255,0.55)'); gl.addColorStop(1, 'rgba(110,200,255,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(sx, sy, R * 0.1, 0, TAU); ctx.fill();
  } else {
    const [a1x, a1y] = S(srcX + uAxis(0) * nX, srcY + uAxis(0) * nY);
    const [a2x, a2y] = S(srcX + uAxis(nDet - 1) * nX, srcY + uAxis(nDet - 1) * nY);
    ctx.lineWidth = Math.max(2, R * 0.03);
    ctx.strokeStyle = 'rgba(140,215,255,0.85)';
    ctx.beginPath(); ctx.moveTo(a1x, a1y); ctx.lineTo(a2x, a2y); ctx.stroke();
  }
  ctx.restore();
}

// Residual history, log scale. box in px.
export function drawResidual(ctx, x, y, w, h, residuals, iters, o = {}) {
  ctx.save();
  ctx.fillStyle = o.bg ?? 'rgba(8,12,18,0.72)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(160,180,200,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (residuals.length) {
    let lo = Infinity, hi = -Infinity;
    for (const r of residuals) { if (r > 0) { lo = Math.min(lo, r); hi = Math.max(hi, r); } }
    if (!(hi > lo)) { hi = lo * 1.1 + 1e-12; lo = lo * 0.9; }
    const L0 = Math.log(lo), L1 = Math.log(hi), N = Math.max(iters, residuals.length, 2);
    const pad = 6;
    ctx.beginPath();
    residuals.forEach((r, k) => {
      const px = x + pad + ((w - 2 * pad) * k) / (N - 1);
      const py = y + pad + (h - 2 * pad) * (1 - (Math.log(Math.max(r, lo)) - L0) / (L1 - L0));
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = o.color ?? '#7cc4ff';
    ctx.lineWidth = o.lineWidth ?? 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

// Composite sheet of the panels with labels. panels: [{ canvas, label }]. Returns a canvas.
export function drawSheet(doc, panels, title, sub) {
  const S = 512, pad = 24, head = 64;
  const c = doc.createElement('canvas');
  c.width = pad + panels.length * (S + pad);
  c.height = head + S + pad + 28;
  const g = c.getContext('2d');
  g.fillStyle = '#05080c'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#e8eef4'; g.font = '600 22px Inter, system-ui, sans-serif';
  g.fillText(title, pad, 34);
  g.fillStyle = '#8b99a8'; g.font = '14px Inter, system-ui, sans-serif';
  g.fillText(sub, pad, 54);
  panels.forEach((p, k) => {
    const x = pad + k * (S + pad);
    g.imageSmoothingQuality = 'high';
    g.drawImage(p.canvas, x, head, S, S);
    g.fillStyle = '#c9d4de'; g.font = '14px Inter, system-ui, sans-serif';
    g.fillText(p.label, x, head + S + 20);
  });
  g.fillStyle = '#5d6b78'; g.font = '12px Inter, system-ui, sans-serif';
  g.textAlign = 'right';
  g.fillText('davesgames.io CT lab, after the ASTRA Toolbox', c.width - pad, head + S + 20);
  return c;
}

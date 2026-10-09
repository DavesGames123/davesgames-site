// view3d/fallback.js - Canvas 2D view of a volume for browsers without WebGPU.
// Draws an axial, a coronal and a sagittal slice and a MIP side by side.
//
// grep handles: drawSlices2D, sliceOf

import * as CM from '../colormaps/maps.js';

// axis 'z' (axial), 'y' (coronal), 'x' (sagittal), or 'mip' (max along y). f in 0..1.
export function sliceOf(vol, axis, f = 0.5) {
  const { nx, ny, nz, data } = vol;
  if (axis === 'z') {
    const iz = Math.min(nz - 1, Math.max(0, Math.round(f * (nz - 1))));
    return { w: nx, h: ny, data: data.subarray(iz * nx * ny, (iz + 1) * nx * ny) };
  }
  if (axis === 'y') { // rows = z from top (high z) to bottom
    const iy = Math.min(ny - 1, Math.max(0, Math.round(f * (ny - 1)))), out = new Float32Array(nx * nz);
    for (let r = 0; r < nz; r++) for (let ix = 0; ix < nx; ix++) out[r * nx + ix] = data[((nz - 1 - r) * ny + iy) * nx + ix];
    return { w: nx, h: nz, data: out };
  }
  if (axis === 'x') {
    const ix = Math.min(nx - 1, Math.max(0, Math.round(f * (nx - 1)))), out = new Float32Array(ny * nz);
    for (let r = 0; r < nz; r++) for (let iy = 0; iy < ny; iy++) out[r * ny + iy] = data[((nz - 1 - r) * ny + iy) * nx + ix];
    return { w: ny, h: nz, data: out };
  }
  const out = new Float32Array(nx * nz).fill(-Infinity);
  for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const v = data[(iz * ny + iy) * nx + ix], k = (nz - 1 - iz) * nx + ix;
    if (v > out[k]) out[k] = v;
  }
  return { w: nx, h: nz, data: out };
}

// ctx: CanvasRenderingContext2D. o: { slices: {x,y,z}, window: [lo,hi], colormap }.
export function drawSlices2D(ctx, vol, o = {}) {
  const s = o.slices ?? { x: 0.5, y: 0.5, z: 0.5 };
  let lo = o.window?.[0], hi = o.window?.[1];
  if (lo === undefined) { lo = 0; hi = 0; for (const v of vol.data) if (v > hi) hi = v; }
  const parts = [sliceOf(vol, 'z', s.z), sliceOf(vol, 'y', s.y), sliceOf(vol, 'x', s.x), sliceOf(vol, 'mip')];
  const cw = ctx.canvas.width, ch = ctx.canvas.height, gap = 6;
  const cell = Math.min((cw - 3 * gap) / 4, ch);
  ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, cw, ch);
  parts.forEach((p, i) => {
    const img = new ImageData(p.w, p.h);
    CM.apply(o.colormap ?? 'bone', p.data, lo, hi, img.data);
    const tmp = new OffscreenCanvas(p.w, p.h);
    tmp.getContext('2d').putImageData(img, 0, 0);
    const sc = cell / Math.max(p.w, p.h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, i * (cell + gap) + (cell - p.w * sc) / 2, (ch - p.h * sc) / 2, p.w * sc, p.h * sc);
  });
  return parts;
}

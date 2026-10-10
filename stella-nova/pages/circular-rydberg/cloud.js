// ============================================================================
//  CIRCULAR RYDBERG  ·  cloud.js — glowing point clouds on a 2D canvas
// ----------------------------------------------------------------------------
//  The orbital is drawn as many sample points of |psi|^2 (physics.js
//  sampleCircular / sampleState). Each point adds light into a float
//  buffer (a small 3x3 splat), then a tone map writes the buffer to an
//  ImageData, with a soft glow (two box blurs at half size, added back). No WebGL or WebGPU: the same code runs on the page, in the
//  saver and in node for the tests and the thumbnail.
//
//  Colour is the phase of psi, m*phi - w*t, on a cyclic palette, so the
//  colours turn round the ring as the state evolves. The packet option
//  brightens a wave packet of width dphi that goes round the ring.
//
//  createCloud(w, h) -> { resize, render(g, pts, view) }
//    pts   Float32Array [x, y, z, phi, ...] in atomic units
//    view  { yaw, pitch, scale (px per a.u.), cx, cy, m, phase, packet,
//            exposure, mix: { pts2, k } (morph), count,
//            colour: 'density' (default, one ramp) | 'phase' (m*phi - w*t),
//            cycles: colour turns round the ring (default m; the page uses
//            min(|m|, 8), since dozens of turns blur to grey),
//            lut: optional 768-byte RGB table (256 steps) for the density
//            colour, in place of the built-in ramp (pages/exotic-atoms
//            passes a ct-lab colour map here),
//            weights: optional Float32Array, one brightness factor per
//            point (importance weights of a superposition) }
//  The exposure is automatic: a high percentile of the buffer maps to a
//  fixed brightness, so a spread cloud and a thin ring both read.
//
//  GREP MAP
//    export const PHASE ........ the cyclic palette
//    export function createCloud
//    export function project ... the camera, for overlays (ring, scale)
// ============================================================================

// cyclic palette: violet -> blue -> cyan -> gold -> rose -> violet
export const PHASE = [[150, 110, 255], [70, 150, 255], [70, 230, 240], [255, 205, 110], [255, 110, 170]];
const PAL = new Float32Array(256 * 3);
for (let i = 0; i < 256; i++) {
  const u = i / 256 * PHASE.length, a = Math.floor(u), f = u - a;
  const p = PHASE[a % PHASE.length], q = PHASE[(a + 1) % PHASE.length];
  for (let c = 0; c < 3; c++) PAL[i * 3 + c] = (p[c] + (q[c] - p[c]) * (f * f * (3 - 2 * f))) / 255;
}

// density ramp: deep blue -> cyan -> white, with a violet rim
const RAMP = [[8, 10, 40], [60, 40, 150], [40, 140, 255], [120, 230, 255], [255, 250, 240]];
const RAMP_T = new Float32Array(256 * 3);
for (let i = 0; i < 256; i++) {
  const u = i / 255 * (RAMP.length - 1), a = Math.min(RAMP.length - 2, Math.floor(u)), f = u - a;
  for (let c = 0; c < 3; c++) RAMP_T[i * 3 + c] = RAMP[a][c] + (RAMP[a + 1][c] - RAMP[a][c]) * f;
}

// running-sum box blurs of a float buffer with C channels (stride C),
// horizontal and vertical
function boxH(src, dst, W, H, r, C) {
  const k = 1 / (2 * r + 1), s = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let c = 0; c < C; c++) { let t = 0; for (let x = -r; x <= r; x++) t += src[(row + Math.min(W - 1, Math.max(0, x))) * C + c]; s[c] = t; }
    for (let x = 0; x < W; x++) {
      const o = (row + x) * C, add = (row + Math.min(W - 1, x + r + 1)) * C, sub = (row + Math.max(0, x - r)) * C;
      for (let c = 0; c < C; c++) { dst[o + c] = s[c] * k; s[c] += src[add + c] - src[sub + c]; }
    }
  }
}
// row by row with a running sum per column, so every read is in order
const colSum = { buf: new Float32Array(0) };
function boxV(src, dst, W, H, r, C) {
  const k = 1 / (2 * r + 1), RW = W * C;
  if (colSum.buf.length < RW) colSum.buf = new Float32Array(RW);
  const s = colSum.buf; s.fill(0, 0, RW);
  for (let y = -r; y <= r; y++) { const o = Math.min(H - 1, Math.max(0, y)) * RW; for (let j = 0; j < RW; j++) s[j] += src[o + j]; }
  for (let y = 0; y < H; y++) {
    const o = y * RW, add = Math.min(H - 1, y + r + 1) * RW, sub = Math.max(0, y - r) * RW;
    for (let j = 0; j < RW; j++) { dst[o + j] = s[j] * k; s[j] += src[add + j] - src[sub + j]; }
  }
}

// 1 - exp(-x) for x in [0, XMAX), in XN steps: the tone map reads this
// table, not Math.exp, once per pixel and channel
const XMAX = 12, XN = 4096, XS = XN / XMAX, EXPT = new Float32Array(XN + 1);
for (let i = 0; i <= XN; i++) EXPT[i] = 1 - Math.exp(-i / XS);
const ex1 = x => x >= XMAX ? 1 : EXPT[(x * XS) | 0];

// view -> screen: turn about z (yaw), then tilt about x (pitch).
export function project(view, x, y, z) {
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const X = cy * x - sy * y, Y = sy * x + cy * y;
  const Yp = cp * Y - sp * z, Z = sp * Y + cp * z;
  return [view.cx + X * view.scale, view.cy - Z * view.scale, Yp];
}

export function createCloud(w = 1, h = 1) {
  // acc: the splat buffer at full size, C channels (1 for density, 3 for
  // phase). The glow is computed at half size (hw x hh) and added back
  // with a bilinear read. A soft glow loses nothing at half size, and the
  // blur then costs a quarter.
  let W = 0, H = 0, hw = 0, hh = 0, acc = null, img = null, u32 = null, half = null, tmp = null, dens = null, densKey = '';
  let XA, XB, FX, YA, YB, FY;
  // the centre of pixel x is at (x + 0.5) / 2 - 0.5 in the half grid:
  // lower cell, upper cell and the fraction between them, per pixel
  const axis = (n, hn) => {
    const A = new Int32Array(n), B = new Int32Array(n), F = new Float32Array(n);
    for (let x = 0; x < n; x++) {
      const gx = Math.max(0, Math.min(hn - 1, (x + 0.5) * 0.5 - 0.5)), a = Math.min(Math.max(0, hn - 2), gx | 0);
      A[x] = a; B[x] = Math.min(hn - 1, a + 1); F[x] = Math.min(1, gx - a);
    }
    return [A, B, F];
  };
  const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  function resize(w2, h2) {
    w2 = Math.max(1, Math.round(w2)); h2 = Math.max(1, Math.round(h2));
    if (w2 === W && h2 === H) return;
    W = w2; H = h2; hw = (W + 1) >> 1; hh = (H + 1) >> 1;
    acc = new Float32Array(W * H * 3); half = new Float32Array(hw * hh * 3); tmp = new Float32Array(hw * hh * 3);
    [XA, XB, FX] = axis(W, hw); [YA, YB, FY] = axis(H, hh);
    img = null;
  }
  resize(w, h);
  function render(g, pts, view) {
    const phaseMode = view.colour === 'phase', C = phaseMode ? 3 : 1;
    acc.fill(0, 0, W * H * C);
    const n = Math.min(view.count || Infinity, pts.length / 4);
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const sc = view.scale, ox = view.cx, oy = view.cy, m = view.cycles != null ? view.cycles : (view.m || 0), ph0 = view.phase || 0;
    const pk = view.packet, mix = view.mix, k = mix ? mix.k : 0, p2 = mix ? mix.pts2 : null;
    const gain = 1, wts = view.weights || null, hl = 0.12, WC = W * C;
    for (let i = 0; i < n; i++) {
      let x = pts[i * 4], y = pts[i * 4 + 1], z = pts[i * 4 + 2], phi = pts[i * 4 + 3];
      if (p2 && k > 0) {
        const s = k * k * (3 - 2 * k);
        x += (p2[i * 4] - x) * s; y += (p2[i * 4 + 1] - y) * s; z += (p2[i * 4 + 2] - z) * s;
        phi = Math.atan2(y, x);
      }
      const X = cy * x - sy * y, Y = sy * x + cy * y;
      const Z = sp * Y + cp * z;
      const px = ox + X * sc, py = oy - Z * sc;
      if (px < 1 || py < 1 || px >= W - 2 || py >= H - 2) continue;
      let wgt = wts ? gain * wts[i] : gain;
      if (!(wgt > 0)) continue;
      if (pk) {
        let d = phi - pk.phi; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
        wgt *= 0.4 + 1.6 * Math.exp(-d * d / (2 * pk.width * pk.width));
      }
      const ix = px | 0, iy = py | 0, fx = px - ix, fy = py - iy;
      // a 2x2 bilinear splat plus a soft halo
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const o = (iy * W + ix) * C;
      if (C === 1) {
        acc[o] += wgt * w00; acc[o + 1] += wgt * w10; acc[o + W] += wgt * w01; acc[o + W + 1] += wgt * w11;
        const hv = wgt * hl;
        acc[o - W] += hv; acc[o + 2 * W] += hv; acc[o - 1] += hv; acc[o + 2] += hv;
      } else {
        let t = ((m * phi - ph0) / (2 * Math.PI)) % 1; if (t < 0) t += 1;
        const ci = (t * 256 | 0) * 3, r = PAL[ci] * wgt, gg = PAL[ci + 1] * wgt, b = PAL[ci + 2] * wgt;
        let q = o;
        acc[q] += r * w00; acc[q + 1] += gg * w00; acc[q + 2] += b * w00;
        acc[q + 3] += r * w10; acc[q + 4] += gg * w10; acc[q + 5] += b * w10;
        q += WC;
        acc[q] += r * w01; acc[q + 1] += gg * w01; acc[q + 2] += b * w01;
        acc[q + 3] += r * w11; acc[q + 4] += gg * w11; acc[q + 5] += b * w11;
        const rh = r * hl, gh = gg * hl, bh = b * hl;
        q = o - WC; acc[q] += rh; acc[q + 1] += gh; acc[q + 2] += bh;
        q = o + 2 * WC; acc[q] += rh; acc[q + 1] += gh; acc[q + 2] += bh;
        q = o - 3; acc[q] += rh; acc[q + 1] += gh; acc[q + 2] += bh;
        q = o + 6; acc[q] += rh; acc[q + 1] += gh; acc[q + 2] += bh;
      }
    }
    if (!img) { img = g.createImageData(W, H); u32 = new Uint32Array(img.data.buffer, img.data.byteOffset, W * H); }
    // glow: a 2x2 box down to half size, a two-pass box blur there, then
    // the glow is added back at the old weights (0.55 sharp + 1.6 glow),
    // so sparse points read as a soft cloud at any resolution
    for (let y = 0; y < hh; y++) {
      const y0 = 2 * y, y1 = Math.min(H - 1, y0 + 1);
      for (let x = 0; x < hw; x++) {
        const x0 = 2 * x, x1 = Math.min(W - 1, x0 + 1), o = (y * hw + x) * C;
        for (let c = 0; c < C; c++) half[o + c] = 0.25 * (acc[(y0 * W + x0) * C + c] + acc[(y0 * W + x1) * C + c] + acc[(y1 * W + x0) * C + c] + acc[(y1 * W + x1) * C + c]);
      }
    }
    const rad = Math.max(1, Math.round(Math.max(2, Math.round(Math.min(W, H) / 220)) / 2));
    boxH(half, tmp, hw, hh, rad, C); boxV(tmp, half, hw, hh, rad, C);
    boxH(half, tmp, hw, hh, rad, C); boxV(tmp, half, hw, hh, rad, C);
    // the lit value of pixel i, channel c: the sharp splats at 0.55 plus
    // a bilinear read of the half-size glow at 1.6 (tables from resize)
    const lit = (x, y, c) => {
      const ra = YA[y] * hw, rb = YB[y] * hw, xa = XA[x], xb = XB[x], fx = FX[x];
      const a0 = (ra + xa) * C + c, a1 = (ra + xb) * C + c, b0 = (rb + xa) * C + c, b1 = (rb + xb) * C + c;
      const top = half[a0] + (half[a1] - half[a0]) * fx, bot = half[b0] + (half[b1] - half[b0]) * fx;
      return acc[(y * W + x) * C + c] * 0.55 + (top + (bot - top) * FY[y]) * 1.6;
    };
    // automatic exposure: the 99.3rd percentile of lit pixels -> 1.6
    const samp = [], N = W * H;
    for (let k2 = 0; k2 < 6000; k2++) {
      const p = (k2 * 7919 + 13) % N, x = p % W, y = (p / W) | 0;
      let v = lit(x, y, 0); if (C === 3) v += lit(x, y, 1) + lit(x, y, 2);
      if (v > 0) samp.push(v);
    }
    samp.sort((x, y) => x - y);
    const ref = samp.length ? samp[Math.min(samp.length - 1, Math.floor(samp.length * 0.993))] : 1;
    const ex = 1.6 / Math.max(1e-6, ref) * (view.exposure || 1);
    const bg = view.bg || [3, 4, 10], LUT = view.lut || RAMP_T;
    const pack = (r, gg, b) => LE ? ((255 << 24) | (b << 16) | (gg << 8) | r) >>> 0 : ((r << 24) | (gg << 16) | (b << 8) | 255) >>> 0;
    if (phaseMode) {
      const s0 = 0.55 * ex, s1 = 1.6 * ex, b0 = bg[0], b1 = bg[1], b2 = bg[2];
      for (let y = 0; y < H; y++) {
        const ra = YA[y] * hw, rb = YB[y] * hw, fy = FY[y];
        for (let x = 0; x < W; x++) {
          const a00 = (ra + XA[x]) * 3, a10 = (ra + XB[x]) * 3, a01 = (rb + XA[x]) * 3, a11 = (rb + XB[x]) * 3, fx = FX[x], i = y * W + x, j = i * 3;
          let t0 = half[a00] + (half[a10] - half[a00]) * fx, u0 = half[a01] + (half[a11] - half[a01]) * fx;
          const r = acc[j] * s0 + (t0 + (u0 - t0) * fy) * s1;
          t0 = half[a00 + 1] + (half[a10 + 1] - half[a00 + 1]) * fx; u0 = half[a01 + 1] + (half[a11 + 1] - half[a01 + 1]) * fx;
          const gg = acc[j + 1] * s0 + (t0 + (u0 - t0) * fy) * s1;
          t0 = half[a00 + 2] + (half[a10 + 2] - half[a00 + 2]) * fx; u0 = half[a01 + 2] + (half[a11 + 2] - half[a01 + 2]) * fx;
          const b = acc[j + 2] * s0 + (t0 + (u0 - t0) * fy) * s1;
          if (r + gg + b <= 0) { u32[i] = pack(b0, b1, b2); continue; }
          const L = (r + gg + b) / 3, wh = L > 1.2 ? Math.min(1, (L - 1.2) * 0.25) : 0, nw = 1 - wh;
          u32[i] = pack(
            b0 + (255 - b0) * Math.min(1, ex1(r) * nw + wh) | 0,
            b1 + (255 - b1) * Math.min(1, ex1(gg) * nw + wh) | 0,
            b2 + (255 - b2) * Math.min(1, ex1(b) * nw + wh) | 0);
        }
      }
    } else {
      // the density tone map depends on the lit value * ex only: one
      // packed colour per table step, built again when the colour table
      // or the background changes
      if (!dens || dens.lut !== LUT || densKey !== bg.join(',')) {
        dens = new Uint32Array(XN + 1); dens.lut = LUT; densKey = bg.join(',');
        for (let q = 0; q <= XN; q++) {
          const v = EXPT[q], a = v * v * (3 - 2 * v) * 0.35 + v * 0.65;
          const ci = Math.min(255, (a * 255) | 0) * 3, s2 = Math.min(1, v * 1.4);
          dens[q] = pack(bg[0] + (LUT[ci] - bg[0]) * s2 | 0, bg[1] + (LUT[ci + 1] - bg[1]) * s2 | 0, bg[2] + (LUT[ci + 2] - bg[2]) * s2 | 0);
        }
      }
      const e2 = ex * 0.9 * XS, s0 = 0.55 * e2, s1 = 1.6 * e2;
      for (let y = 0; y < H; y++) {
        const ra = YA[y] * hw, rb = YB[y] * hw, fy = FY[y], o = y * W;
        for (let x = 0; x < W; x++) {
          const xa = XA[x], xb = XB[x], fx = FX[x];
          const top = half[ra + xa] + (half[ra + xb] - half[ra + xa]) * fx, bot = half[rb + xa] + (half[rb + xb] - half[rb + xa]) * fx;
          const q = acc[o + x] * s0 + (top + (bot - top) * fy) * s1;
          u32[o + x] = dens[q >= XN ? XN : q | 0];
        }
      }
    }
    g.putImageData(img, 0, 0);
  }
  return { resize, render, get size() { return [W, H]; } };
}

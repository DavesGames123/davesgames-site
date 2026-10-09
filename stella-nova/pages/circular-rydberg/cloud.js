// ============================================================================
//  CIRCULAR RYDBERG  ·  cloud.js — glowing point clouds on a 2D canvas
// ----------------------------------------------------------------------------
//  The orbital is drawn as many sample points of |psi|^2 (physics.js
//  sampleCircular / sampleState). Each point adds light into a float
//  buffer (a small 3x3 splat), then a tone map writes the buffer to an
//  ImageData, with a soft glow (two box blurs added back). No WebGL or WebGPU: the same code runs on the page, in the
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
//            min(|m|, 8), since dozens of turns blur to grey) }
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

// running-sum box blurs of an RGB float buffer, horizontal and vertical
function boxH(src, dst, W, H, r) {
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) {
    let s = 0; const row = y * W;
    for (let x = -r; x <= r; x++) s += src[(row + Math.min(W - 1, Math.max(0, x))) * 3 + c];
    for (let x = 0; x < W; x++) {
      dst[(row + x) * 3 + c] = s * k;
      s += src[(row + Math.min(W - 1, x + r + 1)) * 3 + c] - src[(row + Math.max(0, x - r)) * 3 + c];
    }
  }
}
function boxV(src, dst, W, H, r) {
  const k = 1 / (2 * r + 1);
  for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += src[(Math.min(H - 1, Math.max(0, y)) * W + x) * 3 + c];
    for (let y = 0; y < H; y++) {
      dst[(y * W + x) * 3 + c] = s * k;
      s += src[(Math.min(H - 1, y + r + 1) * W + x) * 3 + c] - src[(Math.max(0, y - r) * W + x) * 3 + c];
    }
  }
}

// view -> screen: turn about z (yaw), then tilt about x (pitch).
export function project(view, x, y, z) {
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const X = cy * x - sy * y, Y = sy * x + cy * y;
  const Yp = cp * Y - sp * z, Z = sp * Y + cp * z;
  return [view.cx + X * view.scale, view.cy - Z * view.scale, Yp];
}

export function createCloud(w = 1, h = 1) {
  let W = 0, H = 0, acc = null, img = null, blur = null, tmp = null;
  function resize(w2, h2) {
    w2 = Math.max(1, Math.round(w2)); h2 = Math.max(1, Math.round(h2));
    if (w2 === W && h2 === H) return;
    W = w2; H = h2; acc = new Float32Array(W * H * 3); img = null;
  }
  resize(w, h);
  function render(g, pts, view) {
    acc.fill(0);
    const n = Math.min(view.count || Infinity, pts.length / 4);
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const sc = view.scale, ox = view.cx, oy = view.cy, m = view.cycles != null ? view.cycles : (view.m || 0), ph0 = view.phase || 0;
    const pk = view.packet, mix = view.mix, k = mix ? mix.k : 0, p2 = mix ? mix.pts2 : null;
    const gain = 1, phaseMode = view.colour === 'phase';
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
      if (px < 1 || py < 1 || px >= W - 1 || py >= H - 1) continue;
      let wgt = gain;
      if (pk) {
        let d = phi - pk.phi; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
        wgt *= 0.4 + 1.6 * Math.exp(-d * d / (2 * pk.width * pk.width));
      }
      let r = wgt, gg = 0, b = 0;
      if (phaseMode) {
        let t = ((m * phi - ph0) / (2 * Math.PI)) % 1; if (t < 0) t += 1;
        const ci = (t * 256 | 0) * 3; r = PAL[ci] * wgt; gg = PAL[ci + 1] * wgt; b = PAL[ci + 2] * wgt;
      }
      const ix = px | 0, iy = py | 0, fx = px - ix, fy = py - iy;
      // a 2x2 bilinear splat plus a soft halo
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      let o = (iy * W + ix) * 3;
      acc[o] += r * w00; acc[o + 1] += gg * w00; acc[o + 2] += b * w00;
      acc[o + 3] += r * w10; acc[o + 4] += gg * w10; acc[o + 5] += b * w10;
      o += W * 3;
      acc[o] += r * w01; acc[o + 1] += gg * w01; acc[o + 2] += b * w01;
      acc[o + 3] += r * w11; acc[o + 4] += gg * w11; acc[o + 5] += b * w11;
      const hh = 0.12;
      o = ((iy - 1) * W + ix) * 3; acc[o] += r * hh; acc[o + 1] += gg * hh; acc[o + 2] += b * hh;
      o = ((iy + 2) * W + ix) * 3; acc[o] += r * hh; acc[o + 1] += gg * hh; acc[o + 2] += b * hh;
      o = (iy * W + ix - 1) * 3; acc[o] += r * hh; acc[o + 1] += gg * hh; acc[o + 2] += b * hh;
      o = (iy * W + ix + 2) * 3; acc[o] += r * hh; acc[o + 1] += gg * hh; acc[o + 2] += b * hh;
    }
    if (!img) img = g.createImageData(W, H);
    // glow: a two-pass box blur of the buffer, added back at half weight,
    // so sparse points read as a soft cloud at any resolution
    const rad = Math.max(2, Math.round(Math.min(W, H) / 220));
    if (!blur || blur.length !== acc.length) { blur = new Float32Array(acc.length); tmp = new Float32Array(acc.length); }
    boxH(acc, tmp, W, H, rad); boxV(tmp, blur, W, H, rad);
    boxH(blur, tmp, W, H, rad); boxV(tmp, blur, W, H, rad);
    for (let i = 0; i < acc.length; i++) acc[i] = acc[i] * 0.55 + blur[i] * 1.6;
    // automatic exposure: the 99.3rd percentile of lit pixels -> 1.6
    let samp = [];
    for (let k2 = 0, N = W * H; k2 < 6000; k2++) { const j = ((k2 * 7919 + 13) % N) * 3, v = acc[j] + acc[j + 1] + acc[j + 2]; if (v > 0) samp.push(v); }
    samp.sort((x, y) => x - y);
    const ref = samp.length ? samp[Math.min(samp.length - 1, Math.floor(samp.length * 0.993))] : 1;
    const ex = 1.6 / Math.max(1e-6, ref) * (view.exposure || 1);
    const d = img.data, bg = view.bg || [3, 4, 10];
    for (let i = 0, j = 0; i < W * H; i++, j += 3) {
      if (phaseMode) {
        const r = acc[j] * ex, gg = acc[j + 1] * ex, b = acc[j + 2] * ex;
        const L = (r + gg + b) / 3, wh = L > 1.2 ? Math.min(1, (L - 1.2) * 0.25) : 0;
        d[i * 4] = bg[0] + (255 - bg[0]) * Math.min(1, (1 - Math.exp(-r)) * (1 - wh) + wh);
        d[i * 4 + 1] = bg[1] + (255 - bg[1]) * Math.min(1, (1 - Math.exp(-gg)) * (1 - wh) + wh);
        d[i * 4 + 2] = bg[2] + (255 - bg[2]) * Math.min(1, (1 - Math.exp(-b)) * (1 - wh) + wh);
      } else {
        const v = 1 - Math.exp(-acc[j] * ex * 0.9), a = v * v * (3 - 2 * v) * 0.35 + v * 0.65;
        const ci = Math.min(255, (a * 255) | 0) * 3, s2 = Math.min(1, v * 1.4);
        d[i * 4] = bg[0] + (RAMP_T[ci] - bg[0]) * s2;
        d[i * 4 + 1] = bg[1] + (RAMP_T[ci + 1] - bg[1]) * s2;
        d[i * 4 + 2] = bg[2] + (RAMP_T[ci + 2] - bg[2]) * s2;
      }
      d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  return { resize, render, get size() { return [W, H]; } };
}

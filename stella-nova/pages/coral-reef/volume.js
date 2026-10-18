// ============================================================================
//  CORAL REEF  ·  volume.js  ·  the volume pass helpers (DOM-free)
// ----------------------------------------------------------------------------
//  The volume pass (scene.js makePasses, shaders.js VOL_FS, VOL_TAA_FS and
//  COMP_FS) has three steps:
//    1. march .... VOL_FS at vol.scale of the frame. The start of each ray
//                  has a blue-noise jitter (blueNoise below, 64 x 64,
//                  made once at load) that moves by the golden ratio each
//                  frame. Output: rgb in-scatter, a = the linear view
//                  depth (m) of the pixel.
//    2. history .. VOL_TAA_FS: reproject each pixel with the view-
//                  projection of the last frame (from its depth), clip the
//                  history to the 3 x 3 neighbourhood of this frame (mean
//                  +- 1.25 sd, inside min and max), and blend 1 / 10 new.
//                  A history pixel whose depth does not agree (more than
//                  10 %), or that is off the screen, starts again.
//    3. upsample . COMP_FS: a joint bilateral upsample of the history to
//                  the full frame. The 2 x 2 low-res texels round a pixel
//                  get the bilinear weight times exp(-r^2), r = the depth
//                  difference / (4 % of the depth + 2 cm). Across a depth
//                  edge the weight is about 0, so the cones stop sharp at
//                  the ROV and the rock (no halo). When no texel agrees,
//                  the texel of the nearest depth gives the value.
//  The JS functions here are copies of the shader maths for the tests
//  (tests/volume.test.mjs) and the cost model.
//
//  EXPORTS
//    blueNoise(n = 64, seed)  -> Uint8Array n*n (ranks 0..255), void and
//                                cluster (Ulichney 1993), toroidal
//    reproject(p, prevVP)     -> [u, v, w] the uv of world p in the last
//                                frame and its view depth (clip w)
//    historyClip(hist, nb, g) -> the history colour clipped to the
//                                neighbourhood box (nb: 9 rgb samples)
//    taaBlend(cur, hist, nb, ok, a) the history step for one pixel
//    bilateral(f, zFull, zLow[4]) -> 4 weights (sum 1), or the nearest
//    linZ(z, near, far)       the linear depth of a depth buffer value
//    volCost(profile, w, h, o) the texture taps and spot evaluations of
//                                one frame (before and after the change)
//
//  grep -n targets: "export function blueNoise", "export function reproject",
//  "export function bilateral", "export function volCost", "export const VOL_K"
// ============================================================================

// The constants of the shaders (shaders.js reads them, the tests too).
export const VOL_K = {
  blend: 0.1,          // the weight of the new frame in the history
  clipSd: 1.25,        // the neighbourhood box: mean +- clipSd x sd
  depthReject: 0.1,    // relative depth difference that drops the history
  sigmaRel: 0.04,      // the bilateral depth scale: sigmaRel x depth + sigmaAbs
  sigmaAbs: 0.02,
  scatter: 0.4,        // the in-scatter level (was 1): see NOTES.md 2026-10-18
  nearLamp: 1.0,       // m: the in-scatter fades in over this distance from a lamp
};

// ── blue noise ─────────────────────────────────────────────────────────────
// Void and cluster on a torus with a Gaussian of sigma 1.5. About 35 ms for
// 64 x 64 in node. Returns ranks scaled to 0..255.
export function blueNoise(n = 64, seed = 7) {
  const N = n * n, sigma = 1.5;
  // the kernel by toroidal offset
  const K = new Float32Array(N);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = Math.min(x, n - x), dy = Math.min(y, n - y);
    K[y * n + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
  }
  const E = new Float32Array(N), on = new Uint8Array(N);
  const splat = (i, s) => {
    const ix = i % n, iy = (i / n) | 0;
    for (let y = 0; y < n; y++) {
      const ky = ((y - iy + n) % n) * n, row = y * n;
      for (let x = 0; x < n; x++) E[row + x] += s * K[ky + ((x - ix + n) % n)];
    }
  };
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const m = Math.max(1, Math.round(N * 0.1));
  let ones = 0;
  while (ones < m) { const i = Math.floor(rnd() * N); if (!on[i]) { on[i] = 1; splat(i, 1); ones++; } }
  const tight = () => { let b = -1, v = -Infinity; for (let i = 0; i < N; i++) if (on[i] && E[i] > v) { v = E[i]; b = i; } return b; };
  const voidAt = () => { let b = -1, v = Infinity; for (let i = 0; i < N; i++) if (!on[i] && E[i] < v) { v = E[i]; b = i; } return b; };
  // spread the first pattern: move the tightest one into the largest void
  for (let it = 0; it < N; it++) {
    const a = tight(); on[a] = 0; splat(a, -1);
    const b = voidAt();
    if (b === a) { on[a] = 1; splat(a, 1); break; }
    on[b] = 1; splat(b, 1);
  }
  const rank = new Int32Array(N).fill(-1);
  // phase 1: rank the first ones, tightest last
  const on0 = on.slice(), E0 = E.slice();
  for (let r = m - 1; r >= 0; r--) { const a = tight(); on[a] = 0; splat(a, -1); rank[a] = r; }
  on.set(on0); E.set(E0);
  // phase 2 and 3: fill the largest void next
  for (let r = m; r < N; r++) { const b = voidAt(); on[b] = 1; splat(b, 1); rank[b] = r; }
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = Math.floor(rank[i] * 256 / N);
  return out;
}

// ── reprojection (VOL_TAA_FS) ───────────────────────────────────────────────
// prevVP: a column-major 4 x 4 (THREE.Matrix4.elements). Returns the uv of
// world p in the last frame and the clip w (the view depth for a
// perspective camera).
export function reproject(p, prevVP) {
  const e = prevVP, x = p[0], y = p[1], z = p[2];
  const cx = e[0] * x + e[4] * y + e[8] * z + e[12];
  const cy = e[1] * x + e[5] * y + e[9] * z + e[13];
  const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
  return [cx / cw * 0.5 + 0.5, cy / cw * 0.5 + 0.5, cw];
}
// The neighbourhood clip: box = mean +- g sd, inside min and max.
export function historyClip(hist, nb, g = VOL_K.clipSd) {
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let m1 = 0, m2 = 0, mn = Infinity, mx = -Infinity;
    for (const s of nb) { m1 += s[c]; m2 += s[c] * s[c]; mn = Math.min(mn, s[c]); mx = Math.max(mx, s[c]); }
    m1 /= nb.length; m2 /= nb.length;
    const sd = Math.sqrt(Math.max(m2 - m1 * m1, 0));
    const lo = Math.max(mn, m1 - g * sd), hi = Math.min(mx, m1 + g * sd);
    out[c] = Math.min(hi, Math.max(lo, hist[c]));
  }
  return out;
}
export function taaBlend(cur, hist, nb, ok, a = VOL_K.blend) {
  if (!ok) return cur.slice(0, 3);
  const h = historyClip(hist, nb);
  return [0, 1, 2].map(c => h[c] + (cur[c] - h[c]) * a);
}

// ── the bilateral upsample (COMP_FS) ────────────────────────────────────────
export function linZ(z, near, far) { return near * far / (far - z * (far - near)); }
// f: [fx, fy] the bilinear fractions; zLow: the depths of the texels
// (0,0), (1,0), (0,1), (1,1). -> { w: [4], nearest: index or -1 }
export function bilateral(f, zFull, zLow) {
  const bw = [(1 - f[0]) * (1 - f[1]), f[0] * (1 - f[1]), (1 - f[0]) * f[1], f[0] * f[1]];
  const sig = VOL_K.sigmaRel * zFull + VOL_K.sigmaAbs;
  const w = zLow.map((z, i) => { const r = (z - zFull) / sig; return bw[i] * Math.exp(-r * r); });
  const sum = w[0] + w[1] + w[2] + w[3];
  if (sum < 1e-4) {
    let b = 0; for (let i = 1; i < 4; i++) if (Math.abs(zLow[i] - zFull) < Math.abs(zLow[b] - zFull)) b = i;
    return { w: [0, 1, 2, 3].map(i => (i === b ? 1 : 0)), nearest: b };
  }
  return { w: w.map(x => x / sum), nearest: -1 };
}

// ── cost model ──────────────────────────────────────────────────────────────
// The texture taps and the spot evaluations of one frame at w x h device
// pixels. spots: the lamps (4 at most), shadows: the lamps with a map.
// march: per vol pixel 1 depth (+1 blue noise now) and per step: 1 shadow
// tap per mapped spot, 3 caustic taps (causticAt). old composite: 9 vol
// taps per pixel (the tent); new: 4 + 1 depth, and the history: 9 + 1.
export function volCost(p, w, h, o = {}) {
  const spots = o.spots ?? 4, shadows = o.shadows ?? Math.min(spots, (p.shadowExtra ? 3 : 1));
  const before = o.before || { scale: p.vol.scale, steps: p.vol.steps };
  const one = (scale, steps, taa) => {
    const vw = Math.max(1, Math.round(w * scale)), vh = Math.max(1, Math.round(h * scale)), vpx = vw * vh, px = w * h;
    const march = vpx * ((taa ? 2 : 1) + steps * (shadows + 3));
    const hist = taa ? vpx * 10 : 0;
    const comp = px * (taa ? 5 : 9) + px;           // + the scene tap
    return { vw, vh, steps, spotEvals: vpx * steps * spots, march, hist, comp, taps: march + hist + comp };
  };
  return { before: one(before.scale, before.steps, false), after: one(p.vol.scale, p.vol.steps, true) };
}

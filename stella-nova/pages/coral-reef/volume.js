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
//    2. history .. VOL_TAA_FS (taaFrame below is the CPU copy): a 5 x 5
//                  joint bilateral blur of this frame (depth weight, with
//                  a floor for thin coral), the variance box of the same
//                  taps (mean +- 1.25 sd, 4x wider when the view and the
//                  lamps are still), and two history candidates: the
//                  surface point moved by the camera, and the ray point
//                  nearest to a lamp axis moved with that lamp (this one
//                  wins in a cone). Each history fetch is a 2 x 2
//                  bilateral (texels of another depth get a low weight),
//                  so a thin coral branch keeps a history. Blend 8 % new
//                  (35 % for a weak match). No candidate: the blur.
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
//    beamPhase(c)             the phase of the lamp in-scatter (BEAM_PHASE)
//    snowLight(o)             the lamp light on one flake (SNOW_LIGHT)
//    taaFrame(cur, hist, W, H, ctx) one history frame (VOL_TAA_FS)
//    lampPx(now, prev, fy)    the largest screen move of a lamp (uLampPx)
//
//  grep -n targets: "export function taaFrame", "export function snowLight",
//  "export function blueNoise", "export function reproject",
//  "export function bilateral", "export function volCost", "export const VOL_K"
// ============================================================================

// The constants of the shaders (shaders.js reads them, the tests too).
export const VOL_K = {
  blend: 0.08,         // the weight of the new frame in the history
  blendLo: 0.35,       // the weight of the new frame for a weak history match
  depthFloor: 0.25,    // the least weight of a history texel at another depth
  blurFloor: 0.15,     // the least weight of a blur tap at another depth (thin coral)
  clipSd: 1.25,        // the neighbourhood box: mean +- clipSd x sd
  clipStill: 4,        // the box is this much wider for a still view and still lamps (0.02 .. 0.2 px)
  depthReject: 0.1,    // relative depth difference that drops the history
  sigmaRel: 0.04,      // the bilateral depth scale: sigmaRel x depth + sigmaAbs
  sigmaAbs: 0.02,
  scatter: 0.4,        // the in-scatter level (was 1): see NOTES.md 2026-10-18
  nearLamp: 1.0,       // m: the in-scatter fades in over this distance from a lamp
  snowBeam: 0.25,      // the snow: lamp radiance x beamPhase x this (shaders.js SNOW_LIGHT)
  snowGlint: 0.6,      // the snow: the glint near the cone axis
  snowSky: 0.08,       // the snow: the light from above out of the cones (was 0.6)
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

// ── the beam phase and the snow light (shaders.js BEAM_PHASE, SNOW_LIGHT) ──
export function beamPhase(c) { const g = 0.55; return 0.08 + 0.25 * (1 - g * g) / Math.pow(1 + g * g - 2 * g * c, 1.5); }
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// o: { rad (the spot radiance at p, a number), shadow, dl (m to the lamp),
// cosV (dot(-L, V)), cosAx (dot(-L, D)), cosIn (the inner cone cos),
// sky (the light from above at p), skyPhase } -> the flake light
export function snowLight(o) {
  const ax = sstep(o.cosIn, 1, o.cosAx);
  const lamp = o.rad * o.shadow * sstep(0, VOL_K.nearLamp, o.dl) * (beamPhase(o.cosV) * VOL_K.snowBeam + VOL_K.snowGlint * ax ** 4);
  return lamp + (o.sky || 0) * (o.skyPhase ?? 1) * VOL_K.snowSky;
}

// ── one history frame (VOL_TAA_FS), on one channel ─────────────────────────
// cur, hist: Float32Array W*H*2 (value, view depth a); hist null = reset.
// ctx: { eye: [3], surface(x, y, a) -> the render-space point of pixel
// (x, y) at view depth a, prevUv(p) -> [u, v, w] or null, spots: [{ P, D,
// cosO }], prev: [{ P, D }] (the last frame), lampPx (the largest screen
// move of a lamp since the last frame, px) }.
// -> { out: Float32Array W*H*2, w: Float32Array W*H (the history weight,
// 0 = no history: the pixel starts again) }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.max(Math.hypot(a[0], a[1], a[2]), 1e-12));
export function turn(a, b, v) {
  const k = cross(a, b), c = dot(a, b);
  if (c < -0.999) return mul(v, -1);
  return add(add(mul(v, c), cross(k, v)), mul(k, dot(k, v) / (1 + c)));
}
const BIN5 = [1, 4, 6, 4, 1];
export function taaFrame(cur, hist, W, H, ctx, K = VOL_K) {
  const out = new Float32Array(W * H * 2), wOut = new Float32Array(W * H);
  const at = (x, y) => (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 2;
  const histAt = (u, v, wz) => {
    const st = [u * W - 0.5, v * H - 0.5], i0 = [Math.floor(st[0]), Math.floor(st[1])], f = [st[0] - i0[0], st[1] - i0[1]];
    const tol = K.depthReject * Math.max(wz, 0.1);
    let acc = 0, w = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const qx = i0[0] + i, qy = i0[1] + j;
      if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const h = (qy * W + qx) * 2, r = (hist[h + 1] - wz) / tol;
      const k = (i ? f[0] : 1 - f[0]) * (j ? f[1] : 1 - f[1]) * Math.max(Math.exp(-r * r), K.depthFloor);
      acc += hist[h] * k; w += k;
    }
    return [w > 1e-4 ? acc / w : 0, w];
  };
  const onScreen = (u) => u && u[2] > 0 && u[0] >= 0 && u[0] <= 1 && u[1] >= 0 && u[1] <= 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = at(x, y), ca = cur[c + 1], sig = K.sigmaRel * ca + K.sigmaAbs;
    let s1 = 0, s2 = 0, ws = 0;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const s = at(x + i, y + j), r = (cur[s + 1] - ca) / sig;
      const k = BIN5[i + 2] * BIN5[j + 2] * Math.max(Math.exp(-r * r), K.blurFloor);
      s1 += cur[s] * k; s2 += cur[s] * cur[s] * k; ws += k;
    }
    const f = s1 / ws, sd = Math.sqrt(Math.max(s2 / ws - f * f, 0));
    let hb = f, wb = 0, db = Infinity, mv = 1e9;
    if (hist) {
      const pw = ctx.surface(x, y, ca), rd = norm(sub(pw, ctx.eye)), tS = Math.hypot(...sub(pw, ctx.eye));
      const ua = ctx.prevUv(pw);
      if (onScreen(ua)) {
        mv = Math.max(Math.hypot((ua[0] - (x + 0.5) / W) * W, (ua[1] - (y + 0.5) / H) * H), ctx.lampPx || 0);
        const [h, w] = histAt(ua[0], ua[1], ua[2]); if (w > 0.02) { hb = h; wb = w; db = Math.abs(h - f); }
      }
      let bi = -1, bs = -2, bt = 0;
      (ctx.spots || []).forEach((sp, i) => {
        const w0 = sub(ctx.eye, sp.P), b = dot(rd, sp.D), d = dot(rd, w0), e = dot(sp.D, w0), den = 1 - b * b;
        let t = den > 1e-4 ? (b * e - d) / den : -d;
        t = Math.min(tS, Math.max(0, t));
        const q = add(ctx.eye, mul(rd, t)), sc = dot(norm(add(sub(q, sp.P), mul(sp.D, 1e-3))), sp.D);
        if (sc > bs) { bs = sc; bi = i; bt = t; }
      });
      if (bi >= 0 && bs > ctx.spots[bi].cosO - 0.05) {
        const sp = ctx.spots[bi], pv = ctx.prev[bi], q = add(ctx.eye, mul(rd, bt));
        const uq = ctx.prevUv(add(pv.P, turn(sp.D, pv.D, sub(q, sp.P))));
        const us = ctx.prevUv(add(pv.P, turn(sp.D, pv.D, sub(pw, sp.P))));
        if (onScreen(uq) && us && us[2] > 0) {
          const [h, w] = histAt(uq[0], uq[1], us[2]), dd = Math.abs(h - f);
          if (w > 0.02) { hb = h; wb = w; db = dd; }
        }
      }
    }
    // a still view and still lamps: a wide box (the box adds noise)
    const g = K.clipSd * (1 + (K.clipStill - 1) * (1 - sstep(0.02, 0.2, mv)));
    const lo = Math.max(f - g * sd, 0), hi = f + g * sd;
    const a = wb > 0.02 ? K.blendLo + (K.blend - K.blendLo) * sstep(K.depthFloor, 0.7, wb) : 1;
    const o = Math.min(hi, Math.max(lo, hb)) * (1 - a) + f * a;
    out[(y * W + x) * 2] = o; out[(y * W + x) * 2 + 1] = ca; wOut[y * W + x] = wb;
  }
  return { out, w: wOut };
}
// The largest screen move of a lamp since the last frame (px): the turn of
// its axis plus its shift at 5 m, times fy (px per unit of tan, that is
// the frame height / (2 tan(fov / 2))). scene.js sets uLampPx with it.
export function lampPx(now, prev, fy) {
  let m = 0;
  for (let i = 0; i < now.length; i++) {
    const a = now[i], b = prev[i];
    if (!a || !b) continue;
    const c = Math.min(1, Math.max(-1, a.D[0] * b.D[0] + a.D[1] * b.D[1] + a.D[2] * b.D[2]));
    const s = Math.hypot(a.P[0] - b.P[0], a.P[1] - b.P[1], a.P[2] - b.P[2]);
    m = Math.max(m, (Math.acos(c) + s / 5) * fy);
  }
  return m;
}

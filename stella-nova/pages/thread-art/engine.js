// ============================================================================
//  THREAD ART  ·  engine.js — the CPU model, the greedy step and the exports
// ----------------------------------------------------------------------------
//  This module has no DOM. main.js, the Deno GPU check, tests.mjs and the
//  thumbnail script import it. gpu.js runs the same step in WGSL
//  (thread.wgsl), and the two give the same integers.
//
//  MODEL. The frame holds P pegs. One or more threads go from peg to peg in
//  straight lines. A thread line multiplies the light of each pixel under it
//  by (1 - a + a c), where a is the thread opacity and c the thread colour.
//  In optical density (D = -ln V) a multiply is an addition, so each line
//  adds a fixed density delta_k per channel. A dark page uses the inverse
//  image (1 - V), and the display composites with "screen".
//
//  RESIDUAL. r = target density - laid density, per pixel and channel, in
//  integer units of 1/Q. The squared error is E = sum r^2. A line L of thread
//  k decreases E by
//      gain = sum_ch delta_ch * (2 * R_ch - n * delta_ch),  R_ch = sum_{p in L} r_ch(p)
//  where n is the pixel count of L. The greedy step scores every line from
//  the current peg of every thread, takes the largest gain (ties: the
//  lowest k * P + j), subtracts delta along the line, and moves that thread
//  to peg j. It stops when no gain is positive. The residual has a floor
//  (RFLOOR); the floor can only make E smaller, so E falls on each step.
//
//  LINES. Pegs sit on integer pixels. A line steps one pixel along its
//  major axis, and rounds the minor axis with integer division (rdiv), so
//  each pixel of a line is distinct and the CPU and the GPU walk the same
//  pixels. All sums are i32-safe for res <= 512 (see MAX_RES).
//
//  grep -n: "export const"  "function rdiv"  "export function makePegs"
//           "export function targetFrom"  "export function threadDeltas"
//           "export function createRun"  "export function scoreLine"
//           "export function stepRun"  "export function shapeImage"
//           "export function imagePalette"  "export function toJSON"
//           "export function fromJSON"  "export function toText"
//           "export function toSVG"  "export function renderRGBA"
// ============================================================================

export const Q = 100;            // integer units per unit of optical density
export const RFLOOR = -1024;     // the residual floor (over-laid density)
export const MAX_RES = 512;      // the largest model resolution (i32 bound)
export const MAX_THREADS = 8;
export const DELTA_MAX = 250;    // the largest delta per channel (Q units)
export const SHAPES = ['circle', 'square', 'hexagon'];
export const NO_GAIN = -2147483647;

/** Thread palettes. light: the page is paper; dark: the page is black. */
export const PALETTES = {
  mono:  { name: 'Mono', light: [[0, 0, 0]], dark: [[1, 1, 1]] },
  cmyk:  { name: 'CMY + K', light: [[0, 0.68, 0.94], [0.92, 0.1, 0.55], [1, 0.9, 0.05], [0, 0, 0]],
           dark: [[0, 0.68, 0.94], [0.92, 0.1, 0.55], [1, 0.9, 0.05], [1, 1, 1]] },
  rgbw:  { name: 'RGB + W', light: [[0.85, 0.1, 0.1], [0.1, 0.6, 0.2], [0.1, 0.25, 0.85], [0, 0, 0]],
           dark: [[1, 0.15, 0.12], [0.15, 0.9, 0.3], [0.2, 0.4, 1], [1, 1, 1]] },
};

/** Seeded PRNG (mulberry32). */
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Round a / m to the nearest integer (halves away from zero), m > 0. Same as thread.wgsl rdiv. */
export function rdiv(a, m) {
  return Math.trunc((2 * a + Math.sign(a) * m) / (2 * m));
}

// ── pegs ───────────────────────────────────────────────────────────────────
/**
 * P pegs on the frame, clockwise from the top, on integer pixels of a
 * res x res grid. side[i] is the polygon edge of peg i (-1 for the circle);
 * a line between two pegs of one edge would run along the frame, so the
 * step skips it.
 */
export function makePegs(shape, P, res) {
  const x = new Int32Array(P), y = new Int32Array(P), side = new Int32Array(P);
  const c = (res - 1) / 2;
  if (shape === 'circle') {
    for (let i = 0; i < P; i++) {
      const t = (2 * Math.PI * i) / P - Math.PI / 2;
      x[i] = Math.round(c + c * Math.cos(t));
      y[i] = Math.round(c + c * Math.sin(t));
      side[i] = -1;
    }
    return { shape, P, res, x, y, side };
  }
  // A polygon: square (corners of the grid) or a hexagon (point up).
  let V;
  if (shape === 'square') V = [[0, 0], [res - 1, 0], [res - 1, res - 1], [0, res - 1]];
  else {
    V = [];
    for (let i = 0; i < 6; i++) { const t = -Math.PI / 2 + (i * Math.PI) / 3; V.push([c + c * Math.cos(t), c + c * Math.sin(t)]); }
  }
  // The square starts at the middle of the top edge so peg 0 is at the top, like the others.
  const E = V.length, len = [];
  let L = 0;
  for (let e = 0; e < E; e++) { const a = V[e], b = V[(e + 1) % E]; len.push(Math.hypot(b[0] - a[0], b[1] - a[1])); L += len[e]; }
  const off = shape === 'square' ? len[0] / 2 : 0;
  for (let i = 0; i < P; i++) {
    let s = (off + (i * L) / P) % L, e = 0;
    while (s >= len[e] && e < E - 1) { s -= len[e]; e++; }
    const a = V[e], b = V[(e + 1) % E], f = Math.min(1, s / len[e]);
    x[i] = Math.round(a[0] + (b[0] - a[0]) * f);
    y[i] = Math.round(a[1] + (b[1] - a[1]) * f);
    side[i] = e;
  }
  return { shape, P, res, x, y, side };
}

/** 1 inside the frame shape, else 0 (pixel centres). */
export function frameMask(shape, res) {
  const m = new Uint8Array(res * res), c = (res - 1) / 2;
  for (let py = 0; py < res; py++) for (let px = 0; px < res; px++) {
    let inside = true;
    const dx = px - c, dy = py - c;
    if (shape === 'circle') inside = dx * dx + dy * dy <= (c + 0.5) * (c + 0.5);
    else if (shape === 'hexagon') {
      // Point-up hexagon of circumradius c: |x| <= c*sqrt(3)/2 and |x|/sqrt(3) + |y|... (flat sides left/right)
      const ax = Math.abs(dx), ay = Math.abs(dy), h = c * Math.sqrt(3) / 2;
      inside = ax <= h + 0.5 && ax * 0.5 + ay * (Math.sqrt(3) / 2) <= h + 0.5;
    }
    m[py * res + px] = inside ? 1 : 0;
  }
  return m;
}

// ── target and threads ─────────────────────────────────────────────────────
/**
 * The target density from an RGBA image of res x res.
 * opts: { color: bool, dark: bool (black page), contrast: gamma > 0, vmin }
 * Returns Int32Array of C planes (C = 3 in colour, 1 in mono), Q units.
 * Pixels outside the frame mask get 0 (no line wants them).
 */
export function targetFrom(rgba, res, opts = {}) {
  const C = opts.color ? 3 : 1, N = res * res;
  const g = opts.contrast || 1, vmin = opts.vmin ?? 0.12;
  const dmax = -Math.log(vmin);
  const T = new Int32Array(C * N);
  const mask = opts.mask || null;
  const dens = v => {
    v = Math.pow(Math.min(1, Math.max(0, v)), g);
    if (opts.dark) v = 1 - v;
    return Math.round(Math.min(dmax, -Math.log(Math.max(vmin, v))) * Q);
  };
  for (let i = 0; i < N; i++) {
    if (mask && !mask[i]) continue;
    const r = rgba[4 * i] / 255, gg = rgba[4 * i + 1] / 255, b = rgba[4 * i + 2] / 255;
    if (C === 1) T[i] = dens(0.2126 * r + 0.7152 * gg + 0.0722 * b);
    else { T[i] = dens(r); T[N + i] = dens(gg); T[2 * N + i] = dens(b); }
  }
  return T;
}

/** The density each line of each thread adds, Int32Array K x 3 (Q units; mono uses [0]). */
export function threadDeltas(colors, alpha, opts = {}) {
  const K = colors.length, d = new Int32Array(K * 3);
  for (let k = 0; k < K; k++) {
    const c = colors[k];
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const chans = opts.color ? c : [lum, lum, lum];
    for (let ch = 0; ch < 3; ch++) {
      // light page: V *= 1 - a + a c;  dark page: (1 - V) *= 1 - a c
      const f = opts.dark ? 1 - alpha * chans[ch] : 1 - alpha + alpha * chans[ch];
      d[3 * k + ch] = Math.min(DELTA_MAX, Math.max(0, Math.round(-Math.log(Math.max(1e-4, f)) * Q)));
    }
    if (!opts.color) { d[3 * k + 1] = 0; d[3 * k + 2] = 0; }
  }
  return d;
}

// ── the run ────────────────────────────────────────────────────────────────
/**
 * A run: everything the greedy step needs, and the lines it chose.
 * cfg: { res, shape, P, colors: [[r,g,b]..], alpha, color, dark, gap, seed, maxLines }
 * target: from targetFrom (C planes).
 */
export function createRun(cfg, target) {
  const res = cfg.res, C = cfg.color ? 3 : 1, K = cfg.colors.length;
  if (res > MAX_RES) throw new Error('res > ' + MAX_RES);
  if (K < 1 || K > MAX_THREADS) throw new Error('thread count ' + K);
  const pegs = makePegs(cfg.shape, cfg.P, res);
  const delta = threadDeltas(cfg.colors, cfg.alpha, cfg);
  const r = rng(cfg.seed >>> 0);
  const cur = new Int32Array(K);
  for (let k = 0; k < K; k++) cur[k] = Math.floor(r() * cfg.P);
  return {
    cfg, res, C, K, P: cfg.P, pegs, delta,
    gap: Math.max(1, cfg.gap ?? Math.max(1, Math.round(cfg.P / 30))),
    residual: Int32Array.from(target), target,
    start: Int32Array.from(cur), cur,
    lines: [],                 // { k, a, b } in order: thread k from peg a to peg b
    done: false,
    E0: sumSq(target),
  };
}

export function sumSq(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return s; }

/** Is peg j a legal next peg for a thread at peg i? */
export function validPair(run, i, j) {
  if (i === j) return false;
  const P = run.P, s = run.pegs.side;
  const d = Math.abs(i - j), cd = Math.min(d, P - d);
  if (cd < run.gap) return false;
  if (s[i] >= 0 && s[i] === s[j]) return false;
  const dx = run.pegs.x[j] - run.pegs.x[i], dy = run.pegs.y[j] - run.pegs.y[i];
  return dx !== 0 || dy !== 0;
}

/** Visit the pixels of the line from peg a to peg b: fn(index, i). Returns n. */
export function walkLine(pegs, res, a, b, fn) {
  const x0 = pegs.x[a], y0 = pegs.y[a], dx = pegs.x[b] - x0, dy = pegs.y[b] - y0;
  const ax = Math.abs(dx), ay = Math.abs(dy), m = Math.max(ax, ay);
  if (ax >= ay) { const sx = Math.sign(dx); for (let i = 0; i <= m; i++) fn((y0 + rdiv(dy * i, m)) * res + x0 + sx * i, i); }
  else { const sy = Math.sign(dy); for (let i = 0; i <= m; i++) fn((y0 + sy * i) * res + x0 + rdiv(dx * i, m), i); }
  return m + 1;
}

/** The gain of thread k from its peg to peg j (NO_GAIN if not legal). */
export function scoreLine(run, k, j) {
  const a = run.cur[k];
  if (!validPair(run, a, j)) return NO_GAIN;
  const N = run.res * run.res, R = run.residual, C = run.C;
  let R0 = 0, R1 = 0, R2 = 0;
  const n = walkLine(run.pegs, run.res, a, j, C === 1
    ? p => { R0 += R[p]; }
    : p => { R0 += R[p]; R1 += R[N + p]; R2 += R[2 * N + p]; });
  const d = run.delta;
  let g = d[3 * k] * (2 * R0 - n * d[3 * k]);
  if (C === 3) g += d[3 * k + 1] * (2 * R1 - n * d[3 * k + 1]) + d[3 * k + 2] * (2 * R2 - n * d[3 * k + 2]);
  return g;
}

/** Score all candidates; returns { k, j, gain } of the best (lowest k*P+j on a tie). */
export function bestLine(run) {
  let best = { k: -1, j: -1, gain: NO_GAIN };
  for (let k = 0; k < run.K; k++) for (let j = 0; j < run.P; j++) {
    const g = scoreLine(run, k, j);
    if (g > best.gain) best = { k, j, gain: g };
  }
  return best;
}

/** Subtract a line of thread k from its peg to peg j, and move the thread. */
export function applyLine(run, k, j) {
  const N = run.res * run.res, R = run.residual, C = run.C, d = run.delta;
  const a = run.cur[k];
  walkLine(run.pegs, run.res, a, j, p => {
    for (let ch = 0; ch < C; ch++) { const q = ch * N + p; R[q] = Math.max(RFLOOR, R[q] - d[3 * k + ch]); }
  });
  run.lines.push({ k, a, b: j });
  run.cur[k] = j;
}

/** One greedy step. Returns the line, or null when no line has a positive gain. */
export function stepRun(run) {
  if (run.done) return null;
  if (run.cfg.maxLines && run.lines.length >= run.cfg.maxLines) { run.done = true; return null; }
  const b = bestLine(run);
  if (b.gain <= 0) { run.done = true; return null; }
  applyLine(run, b.k, b.j);
  return run.lines[run.lines.length - 1];
}

/** The error now, as a fraction of the error before the first line. */
export function errorFraction(run) { return run.E0 > 0 ? sumSq(run.residual) / run.E0 : 0; }

// ── built-in shapes (our own test images) ─────────────────────────────────
/** A res x res RGBA test image of this page. name: rings | star | moon | eye */
export function shapeImage(name, res) {
  const out = new Uint8ClampedArray(res * res * 4);
  const c = (res - 1) / 2;
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let py = 0; py < res; py++) for (let px = 0; px < res; px++) {
    const u = (px - c) / c, v = (py - c) / c, rr = Math.hypot(u, v), a = Math.atan2(v, u);
    let rgb = [1, 1, 1];
    if (name === 'rings') {
      const k = 0.5 + 0.5 * Math.cos(rr * 22);
      const dark = smooth(0.92, 0.85, rr) * k;
      rgb = [1 - 0.9 * dark, 1 - 0.75 * dark, 1 - 0.35 * dark];
    } else if (name === 'star') {
      const R = 0.42 + 0.36 * Math.pow(0.5 + 0.5 * Math.cos(5 * (a + Math.PI / 2)), 2.2);
      const ink = smooth(R + 0.02, R - 0.02, rr);
      const glow = 0.35 * smooth(0.95, 0.2, rr);
      rgb = [1 - 0.15 * ink - glow * 0.2, 1 - 0.55 * ink - glow * 0.5, 1 - 0.95 * ink - glow * 0.9];
    } else if (name === 'moon') {
      const disc = smooth(0.74, 0.7, rr);
      const bite = smooth(0.62, 0.66, Math.hypot(u - 0.32, v + 0.12));
      const shade = disc * bite * (0.55 + 0.45 * (0.5 - 0.5 * u));
      rgb = [1 - 0.8 * shade, 1 - 0.8 * shade, 1 - 0.7 * shade];
    } else {   // eye
      const lid = Math.abs(v) - 0.42 * (1 - u * u);
      const white = smooth(0.02, -0.02, lid) * (Math.abs(u) < 1 ? 1 : 0);
      const iris = smooth(0.36, 0.32, rr), pupil = smooth(0.15, 0.12, rr);
      const line = smooth(0.06, 0.0, Math.abs(lid)) * (Math.abs(u) < 1 ? 1 : 0);
      const brow = smooth(0.05, 0.0, Math.abs(v + 0.62 - 0.18 * u * u)) * smooth(0.95, 0.8, Math.abs(u));
      let L = 1 - 0.25 * (1 - white) * smooth(1, 0.5, rr);
      let col = [L, L, L];
      if (iris * white > 0) { const m = iris * white; col = col.map((q, i) => q * (1 - m) + m * [0.2, 0.45, 0.55][i] * (0.6 + 0.4 * Math.cos(a * 18) * 0.5)); }
      const dk = Math.max(pupil * white, line, brow);
      rgb = col.map(q => q * (1 - 0.95 * dk));
    }
    const o = 4 * (py * res + px);
    out[o] = Math.round(255 * rgb[0]); out[o + 1] = Math.round(255 * rgb[1]); out[o + 2] = Math.round(255 * rgb[2]); out[o + 3] = 255;
  }
  return out;
}

// ── a thread palette from the image ────────────────────────────────────────
/**
 * n thread colours from the image: k-means (seeded) over sampled pixels,
 * then the n - 1 clusters with the most density, plus black (light page)
 * or white (dark page).
 */
export function imagePalette(rgba, res, n, opts = {}) {
  const r = rng(opts.seed ?? 7), pts = [];
  for (let i = 0; i < 3000; i++) {
    const p = Math.floor(r() * res * res) * 4;
    if (opts.mask && !opts.mask[p / 4]) continue;
    pts.push([rgba[p] / 255, rgba[p + 1] / 255, rgba[p + 2] / 255]);
  }
  if (!pts.length) pts.push([0.5, 0.5, 0.5]);
  const k = Math.max(2, n + 2);
  let cen = Array.from({ length: k }, () => pts[Math.floor(r() * pts.length)].slice());
  const lab = new Int32Array(pts.length);
  for (let it = 0; it < 12; it++) {
    for (let i = 0; i < pts.length; i++) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < k; j++) { const d = (pts[i][0] - cen[j][0]) ** 2 + (pts[i][1] - cen[j][1]) ** 2 + (pts[i][2] - cen[j][2]) ** 2; if (d < bd) { bd = d; bi = j; } }
      lab[i] = bi;
    }
    const sum = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) { const s = sum[lab[i]]; s[0] += pts[i][0]; s[1] += pts[i][1]; s[2] += pts[i][2]; s[3]++; }
    cen = cen.map((c, j) => sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : c);
  }
  const count = new Int32Array(k); for (let i = 0; i < pts.length; i++) count[lab[i]]++;
  // Weight: how much a cluster differs from the page, times how often it occurs.
  const page = opts.dark ? [0, 0, 0] : [1, 1, 1];
  const chroma = c => Math.max(...c) - Math.min(...c);
  const scored = cen.map((c, j) => ({ c, w: count[j] * (0.3 + chroma(c)) * Math.hypot(c[0] - page[0], c[1] - page[1], c[2] - page[2]) }))
    .sort((a, b) => b.w - a.w);
  const out = [];
  for (const s of scored) {
    if (out.length >= n - 1) break;
    if (out.some(o => Math.hypot(o[0] - s.c[0], o[1] - s.c[1], o[2] - s.c[2]) < 0.18)) continue;
    // Push the colour to full strength: a thread is a dye, not a mix.
    const mx = Math.max(...s.c), mn = Math.min(...s.c), sp = Math.max(0.2, mx - mn);
    out.push(s.c.map(v => Math.round(1000 * Math.min(1, Math.max(0, (v - mn) / sp))) / 1000));
  }
  out.push(opts.dark ? [1, 1, 1] : [0, 0, 0]);
  return out;
}

// ── exports ────────────────────────────────────────────────────────────────
export const hex = c => '#' + c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
export const unhex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

/**
 * The maker's record: peg positions (unit frame, 0..1), each thread's colour,
 * its start peg and its peg list, and the global order of the lines.
 */
export function toJSON(run, extra = {}) {
  const cfg = run.cfg, P = run.P, s = run.res - 1;
  const threads = cfg.colors.map((c, k) => ({ color: hex(c), opacity: cfg.alpha, pegs: [run.start[k]] }));
  const order = [];
  for (const l of run.lines) { threads[l.k].pegs.push(l.b); order.push([l.k, l.b]); }
  return {
    format: 'davesgames.io/thread-art/1',
    frame: cfg.shape, pegs: P, resolution: run.res, seed: cfg.seed >>> 0,
    page: cfg.dark ? 'dark' : 'light', mode: cfg.color ? 'colour' : 'mono', gap: run.gap,
    pegNumbering: 'peg 0 at the top, numbers increase clockwise',
    pegPositions: Array.from({ length: P }, (_, i) => [+(run.pegs.x[i] / s).toFixed(5), +(run.pegs.y[i] / s).toFixed(5)]),
    lines: run.lines.length,
    threads,
    order,
    ...extra,
  };
}

/** Lines back from a toJSON record: [{ k, a, b }]. Throws on a bad record. */
export function fromJSON(obj) {
  const o = typeof obj === 'string' ? JSON.parse(obj) : obj;
  if (!o || !/thread-art\/1$/.test(o.format || '')) throw new Error('not a thread-art/1 record');
  const at = o.threads.map(t => t.pegs[0]);
  const idx = o.threads.map(() => 1);
  const lines = [];
  for (const [k, b] of o.order) {
    if (o.threads[k].pegs[idx[k]] !== b) throw new Error('order and thread pegs disagree at line ' + lines.length);
    idx[k]++;
    lines.push({ k, a: at[k], b });
    at[k] = b;
  }
  return { lines, start: o.threads.map(t => t.pegs[0]), colors: o.threads.map(t => unhex(t.color)), pegs: o.pegs, frame: o.frame };
}

/** A plain-text build sheet: one block per thread, pegs in groups of ten. */
export function toText(run) {
  const j = toJSON(run);
  const out = [
    'Thread art build sheet  ·  davesgames.io/thread-art',
    `Frame: ${j.frame}, ${j.pegs} pegs. ${j.pegNumbering}.`,
    `Lines: ${j.lines}. Seed: ${j.seed}. Page: ${j.page}. Thread opacity: ${run.cfg.alpha}.`,
    '',
  ];
  if (j.threads.length > 1) {
    out.push('Order of threads (the colour of each line, in sequence):');
    const ks = j.order.map(o => o[0] + 1).join(' ');
    out.push(ks.replace(/((?:\d+ ){40})/g, '$1\n').trim(), '');
  }
  j.threads.forEach((t, k) => {
    out.push(`Thread ${k + 1}  ${t.color}  (${t.pegs.length - 1} lines)`);
    for (let i = 0; i < t.pegs.length; i += 10) out.push(String(i).padStart(5) + ':  ' + t.pegs.slice(i, i + 10).join(' '));
    out.push('');
  });
  return out.join('\n');
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** An SVG of the piece: page, frame, one <g> per thread, a <line> per line, optional pegs. */
export function toSVG(run, opts = {}) {
  const cfg = run.cfg, size = opts.size || 1000, s = size / (run.res - 1 || 1);
  const pad = Math.round(size * 0.03), W = size + 2 * pad;
  const width = ((opts.width || 1) * size) / run.res;
  const page = cfg.dark ? '#000000' : '#ffffff', blend = cfg.dark ? 'screen' : 'multiply';
  const X = i => (pad + run.pegs.x[i] * s).toFixed(2), Y = i => (pad + run.pegs.y[i] * s).toFixed(2);
  const parts = [`<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">`,
    `<title>${esc(opts.title || 'Thread art')}</title>`,
    `<desc>${esc(`${cfg.shape} frame, ${run.P} pegs, ${run.lines.length} lines, seed ${cfg.seed >>> 0}. davesgames.io thread-art.`)}</desc>`,
    `<rect width="${W}" height="${W}" fill="${cfg.dark ? '#000000' : '#ffffff'}"/>`];
  const groups = cfg.colors.map((c, k) => [`<g stroke="${hex(c)}" stroke-opacity="${cfg.alpha}" stroke-width="${width.toFixed(3)}" stroke-linecap="round" style="mix-blend-mode:${blend}" data-thread="${k + 1}">`]);
  // Lines go in their build order; a group per thread keeps the file small.
  // Order matters for the look only when the blend is not commutative; multiply and screen are.
  for (const l of run.lines) groups[l.k].push(`<line x1="${X(l.a)}" y1="${Y(l.a)}" x2="${X(l.b)}" y2="${Y(l.b)}"/>`);
  for (const g of groups) { g.push('</g>'); parts.push(g.join('')); }
  if (opts.pegs !== false) {
    const pr = Math.max(1, size / 400);
    const peg = [`<g fill="${cfg.dark ? '#888888' : '#555555'}">`];
    for (let i = 0; i < run.P; i++) peg.push(`<circle cx="${X(i)}" cy="${Y(i)}" r="${pr.toFixed(2)}"/>`);
    peg.push('</g>');
    parts.push(peg.join(''));
  }
  void page;
  parts.push('</svg>');
  return parts.join('\n');
}

// ── raster render (node: tests and thumbnails) ─────────────────────────────
/**
 * Draw the lines into an RGBA buffer of size x size with the model's
 * composite: multiply on a light page, screen on a dark page. width is in
 * model pixels (1 = one model pixel). Anti-aliased by pixel coverage.
 * opts: { size, width, lines (count), frame (bool) }
 */
export function renderRGBA(run, opts = {}) {
  const size = opts.size || 512, cfg = run.cfg, sc = size / run.res;
  const n = Math.min(run.lines.length, opts.lines ?? run.lines.length);
  const V = new Float32Array(size * size * 3).fill(cfg.dark ? 0 : 1);
  const hw = Math.max(0.5, ((opts.width || 1) * sc) / 2);
  const cx = run.pegs.x, cy = run.pegs.y;
  const mul = cfg.colors.map(c => {
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return cfg.color ? c : [lum, lum, lum];
  });
  for (let li = 0; li < n; li++) {
    const l = run.lines[li], col = mul[l.k], a = cfg.alpha;
    const x0 = (cx[l.a] + 0.5) * sc, y0 = (cy[l.a] + 0.5) * sc, x1 = (cx[l.b] + 0.5) * sc, y1 = (cy[l.b] + 0.5) * sc;
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
    const xa = Math.max(0, Math.floor(Math.min(x0, x1) - hw - 1)), xb = Math.min(size - 1, Math.ceil(Math.max(x0, x1) + hw + 1));
    const ya = Math.max(0, Math.floor(Math.min(y0, y1) - hw - 1)), yb = Math.min(size - 1, Math.ceil(Math.max(y0, y1) + hw + 1));
    const steep = Math.abs(dy) > Math.abs(dx);
    // Walk the major axis and touch only a band around the line.
    const lo = steep ? ya : xa, hi = steep ? yb : xb;
    for (let q = lo; q <= hi; q++) {
      const c = q + 0.5, t = steep ? (c - y0) / dy : (c - x0) / dx;
      const m = steep ? x0 + t * dx : y0 + t * dy;
      const band = hw * Math.sqrt(L2) / Math.abs(steep ? dy : dx) + 1.5;
      for (let p = Math.max(steep ? xa : ya, Math.floor(m - band)); p <= Math.min(steep ? xb : yb, Math.ceil(m + band)); p++) {
        const px = steep ? p + 0.5 : c, py = steep ? c : p + 0.5;
        let u = ((px - x0) * dx + (py - y0) * dy) / L2; u = Math.min(1, Math.max(0, u));
        const d = Math.hypot(px - (x0 + u * dx), py - (y0 + u * dy));
        const cov = Math.min(1, Math.max(0, hw + 0.5 - d));
        if (cov <= 0) continue;
        const o = 3 * ((steep ? q : p) * size + (steep ? p : q));
        for (let ch = 0; ch < 3; ch++) {
          if (cfg.dark) V[o + ch] = 1 - (1 - V[o + ch]) * (1 - a * cov * col[ch]);
          else V[o + ch] *= 1 - a * cov * (1 - col[ch]);
        }
      }
    }
  }
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[4 * i] = 255 * V[3 * i]; out[4 * i + 1] = 255 * V[3 * i + 1]; out[4 * i + 2] = 255 * V[3 * i + 2]; out[4 * i + 3] = 255;
  }
  return out;
}

/** The error image: what each pixel still lacks, as the colour it would show. RGBA res x res. */
export function residualRGBA(residual, res, C, dark, mask) {
  const N = res * res, out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    for (let ch = 0; ch < 3; ch++) {
      const r = residual[(C === 3 ? ch : 0) * N + i];
      let v = Math.exp(-Math.max(0, r) / Q);
      if (dark) v = 1 - v;
      out[4 * i + ch] = 255 * v;
    }
    // Over-laid density (r < 0) shows as a red tint.
    const neg = C === 3 ? Math.min(residual[i], residual[N + i], residual[2 * N + i]) : residual[i];
    if (neg < 0) { const t = Math.min(1, -neg / 150); out[4 * i] = out[4 * i] * (1 - t) + 230 * t; out[4 * i + 1] *= 1 - 0.7 * t; out[4 * i + 2] *= 1 - 0.7 * t; }
    out[4 * i + 3] = mask && !mask[i] ? 0 : 255;
  }
  return out;
}

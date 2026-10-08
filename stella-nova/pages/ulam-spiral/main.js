// ============================================================================
//  ULAM SPIRAL  ·  main.js — state, camera, input, overlay, panel, readouts
// ----------------------------------------------------------------------------
//  Data path: worker.js sieves the odd numbers (bitset) -> render.js
//  uploads it as a texture -> each frame, frameState() turns S into the
//  renderer state and render.js draws it. The overlay canvas (#ov) gets
//  the labels, the diagonal lines and the cursor ring from the same
//  camera. Regions past the sieve (or past the arithmetic table) get a
//  CPU tile from the worker (Miller-Rabin), uploaded as a texture.
//
//  CAMERA. 2D: cam = { x, y, z }: the world point at the centre of the
//  clear area and the CSS px per world unit (one lattice cell = 1 unit).
//  3D: cam3 = { yaw, pitch, dist, tx, ty, tz }, orbit around (tx, ty, tz).
//  The clear area is the canvas minus the overlays (function occlusion);
//  in the saver also minus the shell label plate (lib/saver-clear.js).
//
//  GREP MAP
//    grep -n 'const S = '              the page state
//    grep -n 'function frameState'     S -> renderer state, one frame
//    grep -n 'function tileCheck'      when and where to ask for a CPU tile
//    grep -n 'function startMorph'     the shape-to-shape flight
//    grep -n 'function drawOverlay'    labels, diagonals, rings
//    grep -n 'function hoverAt'        the number under a screen point
//    grep -n 'function showReadout'    the readout card
//    grep -n 'function buildUI'        the panel
//    grep -n 'function renderThumbs'   the gallery thumbnails
//    grep -n 'function selfTest'       GPU maps against layouts.js
//    grep -n 'function boxTest'        zoomed-out density against a count
//    grep -n 'function pyrRegion'      the cells the density pyramid holds
//    grep -n 'function loop'           the frame loop
// ============================================================================
import * as T from './numtheory.js';
import * as L from './layouts.js';
import { createRenderer } from './render.js';
import { densestRays, cellFamilies } from './diagonals.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeIO = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

// --- palettes and backgrounds -------------------------------------------------
// Five stops, dark to bright. pal(0.78) is the prime colour; the top stop
// marks the special primes (twins, Sophie Germain, ...).
export const PALETTES = {
  aurora: { name: 'Aurora', stops: ['#121a44', '#2b4aa0', '#3fb0d4', '#9cf2d2', '#f6fff6'], quad: '#ffbf66' },
  ember: { name: 'Ember', stops: ['#1c0812', '#701634', '#e04e2c', '#ffb24a', '#fff4d6'], quad: '#7fd8ff' },
  orchid: { name: 'Orchid', stops: ['#1a0c30', '#5a2d8e', '#b456cf', '#ff9fd6', '#fff1fa'], quad: '#9ef0c4' },
  ice: { name: 'Ice', stops: ['#0a1226', '#1e4382', '#5096e6', '#aee0ff', '#f3fbff'], quad: '#ffb36b' },
  spectral: { name: 'Spectral', stops: ['#3d2c92', '#2d8fc4', '#58c987', '#f2d34c', '#ff7a48'], quad: '#ffffff' },
  gold: { name: 'Gold leaf', stops: ['#161006', '#5c3f10', '#c48d2e', '#f5d071', '#fffaf0'], quad: '#8fb8ff' },
  mono: { name: 'Silver', stops: ['#16181e', '#3c4250', '#8c96a8', '#d7dde8', '#ffffff'], quad: '#ffb057' },
};
export const BGS = {
  night: { name: 'Night', c: ['#0d1224', '#020307'] },
  ink: { name: 'Ink', c: ['#060607', '#000000'] },
  deep: { name: 'Deep blue', c: ['#0b1838', '#01030b'] },
  plum: { name: 'Plum', c: ['#1c0e28', '#050209'] },
  ember: { name: 'Ember', c: ['#211510', '#060303'] },
};
const palArr = key => new Float32Array(PALETTES[key].stops.flatMap(rgb));

// --- highlight modes -----------------------------------------------------------
const M = T.MODE;
export const MODES = [
  { id: M.primes, key: 'primes', name: 'Primes', note: 'Each prime lights up. Watch the diagonals.' },
  { id: M.twin, key: 'twin', name: 'Twin primes', note: 'Bright: p with p − 2 or p + 2 also prime. Dim: the other primes.' },
  { id: M.cousin, key: 'cousin', name: 'Cousin primes', note: 'Bright: p with p ± 4 also prime.' },
  { id: M.sexy, key: 'sexy', name: 'Sexy primes', note: 'Bright: p with p ± 6 also prime (sex is Latin for six).' },
  { id: M.sophie, key: 'sophie', name: 'Sophie Germain & safe', note: 'Top colour: 2p + 1 is prime (Sophie Germain). Middle: (p − 1)/2 is prime (safe). White: both.' },
  { id: M.gauss, key: 'gauss', name: 'Gaussian primes', note: 'On the lattice of a + bi: primes of ℤ[i]. a² + b² is prime, or a or b is 0 and the other is ±p with p ≡ 3 mod 4.' },
  { id: M.eisen, key: 'eisen', name: 'Eisenstein primes', note: 'On the lattice of a + bω: norm a² − ab + b² prime, or a unit times p with p ≡ 2 mod 3.' },
  { id: M.divisors, key: 'divisors', name: 'Divisor count', note: 'Heat map of d(n), the number of divisors. Primes (d = 2) stay dark; highly composite numbers glow.' },
  { id: M.spf, key: 'spf', name: 'Smallest factor', note: 'Colour by the smallest prime factor: even numbers darkest, primes (their own factor) brightest.' },
  { id: M.totient, key: 'totient', name: 'Totient ratio', note: 'φ(n)/n = ∏(1 − 1/p): near 1 for primes, low for numbers with many small factors.' },
  { id: M.figurate, key: 'figurate', name: 'Squares · triangles · Fibonacci', note: 'Squares, triangular numbers and Fibonacci numbers; primes faint behind them.' },
];
const QUAD_PRESETS = [[1, 1, 41], [1, -79, 1601], [4, 4, 59], [2, 0, 29], [1, 0, 1], [4, -2, 41], [6, 6, 31], [1, 1, 17]];

// --- state ---------------------------------------------------------------------
const S = {
  shape: L.SHAPE.square, P: { ...L.DEFAULT_P }, mode: M.primes,
  quad: { on: false, a: 1, b: 1, c: 41, max: null },
  style: 2, dotR: 0.36, compA: 0.06, bloom: 0.9, pal: 'aurora', bg: 'night',
  labels: true, path: false, diag: false, mini: true, morphOn: true,
  cam: { x: 0, y: 0, z: 4 }, cam3: null,
  limit: 0, wantLimit: 1e8, bits: null, blocks: null,
  tile: { have: null, pending: 0, want: null, id: 0 }, tileOn: false,
  morph: null, walk: null, fly: null, sweep: null, palB: null, walkRate: 1,
  hover: null, sel: null, rays: [], marks: [], dirty: true, saver: false,
  overlayHook: null, frameHook: null,
};
const PT_CAP = () => (PHONE_Q.matches ? 1200000 : 4000000);
const TILE_MAX = () => (PHONE_Q.matches ? 320 : 512);

// --- boot ------------------------------------------------------------------------
const cv = $('gl'), ov = $('ov'), oc = ov.getContext('2d'), miniCtx = $('mini').getContext('2d');
let R = null;
try { R = createRenderer(cv); } catch (e) { console.error(e); }
if (!R) { $('nogl').hidden = false; }
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, PHONE_Q.matches ? 2 : 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
  ov.width = cv.width; ov.height = cv.height;
  S.dirty = true;
}
addEventListener('resize', resize);
resize();

// --- the clear area ---------------------------------------------------------------
const OVERLAYS = ['panel', 'dock', 'status', 'readout'].map($).filter(Boolean);
let plateBandFn = null, band = null, bandAt = -1e9;
import('../../lib/saver-clear.js').then(m => { plateBandFn = m.plateBand; }).catch(() => { /* no shell: no plate */ });
function occlusion(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  if (!S.saver) {
    for (const el of OVERLAYS) {
      const q = el.getBoundingClientRect();
      const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right), y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
      if (x1 - x0 < 1 || y1 - y0 < 1 || getComputedStyle(el).display === 'none') continue;
      const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
      if (fw >= fh) { if (fw < 0.5) continue; if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1); }
      else { if (fh < 0.5) continue; if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0); }
    }
  } else if (plateBandFn) {
    const now = performance.now();
    if (now - bandAt > 250) { bandAt = now; band = plateBandFn(h); }
    if (band) {
      let t = band.t, b = band.b; const k = (t + b) / (0.65 * h);
      if (k > 1) { t /= k; b /= k; }
      o.t = t; o.b = b;
    }
  }
  return o;
}
let VW = null;
function view() {
  const w = cv.clientWidth, h = cv.clientHeight, o = occlusion(w, h);
  return (VW = { w, h, o, cx: o.l + (w - o.l - o.r) / 2, cy: o.t + (h - o.t - o.b) / 2, cw: Math.max(40, w - o.l - o.r), ch: Math.max(40, h - o.t - o.b) });
}
const toWorld = (sx, sy, v = VW, c = S.cam) => [c.x + (sx - v.cx) / c.z, c.y - (sy - v.cy) / c.z];
const toScreen = (wx, wy, v = VW, c = S.cam) => [v.cx + (wx - c.x) * c.z, v.cy - (wy - c.y) * c.z];
const is3D = s => s.kind === '3d';
const startOf = () => L.startOf(S.shape, S.P);

// --- numbers ----------------------------------------------------------------------
const primeCache = new Map();
function isPrimeN(n) {
  if (S.bits && n <= S.limit) return T.bitPrime(S.bits, n);
  if (n < 2) return false;
  let v = primeCache.get(n);
  if (v === undefined) { v = T.isPrime(n); if (primeCache.size > 50000) primeCache.clear(); primeCache.set(n, v); }
  return v;
}
export function fmt(n) {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e16) return n.toExponential(3).replace('e+', '×10^');
  return Math.round(n).toLocaleString('en-US');
}
const fmtS = n => (n >= 1e6 ? (n / 10 ** Math.floor(Math.log10(n))).toFixed(2) + '×10' + String(Math.floor(Math.log10(n))).split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]).join('') : fmt(n));

// --- framing ------------------------------------------------------------------------
// The world bounding box of n in [n0, n1], from samples.
function bboxOf(shape, n0, n1, samples = 600) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = n => {
    const p = L.posOf(shape, n, S.P); if (!p) return;
    const [x, y] = L.isLattice(shape) ? L.worldOf(shape, p[0], p[1]) : p;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  };
  const span = Math.max(1, n1 - n0);
  for (let i = 0; i <= samples; i++) add(n0 + Math.round(span * Math.sqrt(i / samples)));
  for (let i = 0; i < 64; i++) add(n1 - i);
  return [x0, y0, x1, y1];
}
// A 2D camera that fits the box in the clear area (fill: fraction used).
function fitCam(b, fill = 0.9, v = VW || view()) {
  const w = Math.max(1, b[2] - b[0] + 1), h = Math.max(1, b[3] - b[1] + 1);
  return { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, z: clamp(fill * Math.min(v.cw / w, v.ch / h), 1e-4, 400) };
}
export function homeCount(shape) {
  if (shape.key === 'rows' || shape.key === 'snake') return S.P.w * Math.max(40, Math.round(S.P.w * 0.75));
  if (shape.key === 'hilbert' || shape.key === 'zorder') return 65536;
  if (shape.key === 'cantor') return 20000;
  if (shape.kind === 'pt') return shape.key === 'archi' ? S.P.w * 60 : 40000;
  return 40000;
}
function homeCam(shape = S.shape) {
  const st = L.startOf(shape, S.P);
  return fitCam(bboxOf(shape, st, st + homeCount(shape)), 0.92);
}
function home3(shape = S.shape) {
  if (shape.key === 'helix') { const Hh = 120; return { yaw: -0.6, pitch: 0.25, dist: Hh * 1.25, tx: 0, ty: 0, tz: Hh / 2 }; }
  if (shape.key === 'pyramid') return { yaw: -0.8, pitch: 0.62, dist: 230, tx: 0, ty: 0, tz: -25 };
  return { yaw: -0.8, pitch: 0.55, dist: 300, tx: 0, ty: 0, tz: -60 };
}
function n3Count(shape, c3) {
  if (shape.key === 'helix') return Math.min(1500000, Math.round(S.P.w * c3.dist * 1.6));
  if (shape.key === 'pyramid') return Math.min(1500000, Math.round((c3.dist * 0.9) ** 2));
  return Math.min(1500000, Math.round((c3.dist * 0.75) ** 2));
}

// --- 3D matrices ---------------------------------------------------------------------
function mul4(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}
const FOV = 0.8;
function cam3Mats(c3, v) {
  const cp = Math.cos(c3.pitch), eye = [c3.tx + c3.dist * cp * Math.cos(c3.yaw), c3.ty + c3.dist * cp * Math.sin(c3.yaw), c3.tz + c3.dist * Math.sin(c3.pitch)];
  const f = [c3.tx - eye[0], c3.ty - eye[1], c3.tz - eye[2]], fl = Math.hypot(...f); f.forEach((_, i) => { f[i] /= fl; });
  let s = [f[1] * 1 - f[2] * 0, f[2] * 0 - f[0] * 1, 0]; const sl = Math.hypot(...s) || 1; s = s.map(x => x / sl);
  const u = [s[1] * f[2] - s[2] * f[1], s[2] * f[0] - s[0] * f[2], s[0] * f[1] - s[1] * f[0]];
  const V = new Float32Array([s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0,
    -(s[0] * eye[0] + s[1] * eye[1] + s[2] * eye[2]), -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]), f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2], 1]);
  const near = Math.max(0.05, c3.dist * 0.01), far = c3.dist * 30 + 1000, t = 1 / Math.tan(FOV / 2), asp = v.w / v.h;
  const Pm = new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
  const ox = 2 * v.cx / v.w - 1, oy = 1 - 2 * v.cy / v.h;
  const O = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ox, oy, 0, 1]);
  const mvp = mul4(O, mul4(Pm, V));
  return { mvp, focal: v.h * dpr / (2 * Math.tan(FOV / 2)) };
}
function project3(mvp, p, v) {
  const x = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12], y = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
  const w = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
  if (w <= 0) return null;
  return [(x / w * 0.5 + 0.5) * v.w, (0.5 - y / w * 0.5) * v.h, w];
}

// --- the visible region ----------------------------------------------------------------
// The world rectangle of the canvas (2D).
function worldRect(v = VW, c = S.cam) {
  const [x0, y1] = toWorld(0, 0, v, c), [x1, y0] = toWorld(v.w, v.h, v, c);
  return [x0, y0, x1, y1];
}
// The lattice cells under the canvas: [i0, j0, i1, j1] (axial for hex).
function cellRect(shape, r) {
  if (shape.kind !== 'hex') return [Math.floor(r[0] - 0.5), Math.floor(r[1] - 0.5), Math.ceil(r[2] + 0.5), Math.ceil(r[3] + 0.5)];
  const rr0 = Math.floor(r[1] / L.SQ3) - 1, rr1 = Math.ceil(r[3] / L.SQ3) + 1;
  const q0 = Math.floor(r[0] - rr1 / 2) - 1, q1 = Math.ceil(r[2] - rr0 / 2) + 1;
  return [q0, rr0, q1, rr1];
}
// The largest and smallest n in the view, from a grid of samples.
function nSpan(shape = S.shape, v = VW, c = S.cam) {
  const r = worldRect(v, c);
  let lo = Infinity, hi = -Infinity, far = 0;
  const G = 14;
  for (let i = 0; i <= G; i++) for (let j = 0; j <= G; j++) {
    const wx = lerp(r[0], r[2], i / G), wy = lerp(r[1], r[3], j / G);
    const [cx, cy] = L.cellAt(shape, wx, wy);
    far = Math.max(far, Math.abs(cx), Math.abs(cy));
    const n = L.nAt(shape, S.P, cx, cy);
    if (n >= 0) { lo = Math.min(lo, n); hi = Math.max(hi, n); }
  }
  return { lo, hi, far };
}

// --- CPU tiles ----------------------------------------------------------------------------
// The GPU classifies n up to its cover (the bitset, or the arithmetic
// table). Past that, or past 23000 cells from the origin, the field
// pass reads a CPU tile.
function gpuCover() {
  if (!S.bits) return 0;
  if (S.mode >= M.divisors && S.mode <= M.totient) return R.arith.mode === S.mode ? R.arith.N - 1 : 0;
  if (S.mode === M.sophie) return (S.limit - 1) / 2;
  if (S.mode >= M.twin && S.mode <= M.sexy) return S.limit - 6;
  return S.limit;
}
function tileKey() { return `${S.shape.key}|${JSON.stringify(S.P)}|${S.mode}|${S.quad.on ? [S.quad.a, S.quad.b, S.quad.c, S.quad.max].join(',') : ''}`; }
function tileCheck(v) {
  const sh = S.shape;
  if (!L.isLattice(sh) || !S.bits) return false;
  const sp = nSpan(sh, v);
  let need = sp.hi > gpuCover() || sp.far > 22000;
  if (sh.lattice === 'gauss') need = need || 2 * sp.far * sp.far > S.limit;
  if (sh.lattice === 'eisen') need = need || 3 * sp.far * sp.far > S.limit;
  if (!need) return false;
  const cr = cellRect(sh, worldRect(v));
  const arith = S.mode >= M.divisors && S.mode <= M.totient;
  const cap = arith ? (PHONE_Q.matches ? 160 : 256) : TILE_MAX();
  const cx = (cr[0] + cr[2]) / 2, cy = (cr[1] + cr[3]) / 2;
  const w = Math.min(cap, Math.ceil((cr[2] - cr[0]) * 1.3) + 4), h = Math.min(cap, Math.ceil((cr[3] - cr[1]) * 1.3) + 4);
  // a view wider than one tile: no tile (the GPU marks what it can)
  if (cr[2] - cr[0] > cap || cr[3] - cr[1] > cap) return false;
  const want = { key: tileKey(), x0: Math.floor(cx - w / 2), y0: Math.floor(cy - h / 2), w, h };
  const have = S.tile.have, inner = [Math.max(cr[0], Math.floor(cx - cap / 2)), Math.max(cr[1], Math.floor(cy - cap / 2)), Math.min(cr[2], Math.floor(cx + cap / 2)), Math.min(cr[3], Math.floor(cy + cap / 2))];
  const covers = t => t && t.key === want.key && t.x0 <= inner[0] && t.y0 <= inner[1] && t.x0 + t.w > inner[2] && t.y0 + t.h > inner[3];
  if (!covers(have) && !covers(S.tile.pend)) {
    if (S.tile.pending) S.tile.want = want;
    else sendTile(want);
  }
  return true;
}
function sendTile(want) {
  const id = ++S.tile.id;
  S.tile.pending = id; S.tile.pend = want; S.tile.want = null;
  worker.postMessage({ type: 'tile', id, key: S.shape.key, P: S.P, mode: S.mode, quad: S.quad.on ? { on: true, a: S.quad.a, b: S.quad.b, c: S.quad.c, max: S.quad.max } : null, x0: want.x0, y0: want.y0, w: want.w, h: want.h });
}

// --- worker messages ---------------------------------------------------------------------
worker.onmessage = e => {
  const m = e.data;
  if (m.type === 'progress') { $('sieveBar').style.width = (100 * m.done / m.total).toFixed(1) + '%'; return; }
  if (m.type === 'primes') {
    S.bits = m.bits; S.limit = m.limit; S.blocks = T.prefixCounts(m.bits);
    primeCache.clear();
    if (R) R.setPrimes(m.bits, m.limit);
    $('sieveBar').style.width = '100%';
    $('sieveNote').textContent = `${fmt(T.piFrom(S.bits, S.blocks, S.limit))} primes below ${fmtS(S.limit)}, sieved in ${m.ms} ms. Past ${fmtS(S.limit)}: Miller–Rabin tiles.`;
    S.tile.have = null;
    afterNumbers();
    return;
  }
  if (m.type === 'arith') { if (R) R.setArith(m.bytes, m.mode); S.tile.have = null; S.dirty = true; thumbsDirty = true; return; }
  if (m.type === 'tile') {
    const want = S.tile.pend;
    S.tile.pending = 0; S.tile.pend = null;
    if (want && R) { R.setTile(m.data, [m.x0, m.y0], [m.w, m.h]); S.tile.have = { ...want }; S.tile.ms = m.ms; }
    if (S.tile.want) sendTile(S.tile.want);
    S.dirty = true;
  }
};
function startSieve(limit) {
  S.wantLimit = limit;
  $('sieveBar').style.width = '0%';
  $('sieveNote').textContent = `Sieving to ${fmtS(limit)} …`;
  worker.postMessage({ type: 'sieve', limit });
}
function afterNumbers() {
  computeRays(); updateQuad(); thumbsDirty = true; S.dirty = true;
}

// --- the pyramid region ---------------------------------------------------------------
// The lattice cells (x0, y0, x1, y1) that hold the numbers the sieve
// knows (n <= S.limit), with a margin; null before the sieve. Outside it
// every cell is unknown or empty, and the shader samples them directly.
const pyrBoxes = new Map();
function pyrRegion(sh) {
  if (!S.bits) return null;
  const key = `${sh.key}|${JSON.stringify(S.P)}|${S.limit}`;
  if (pyrBoxes.has(key)) return pyrBoxes.get(key);
  let box = null;
  const st = L.startOf(sh, S.P);
  if (sh.lattice) {
    const r = Math.ceil(1.16 * Math.sqrt(S.limit)) + 2;
    box = [-r, -r, r, r];
  } else if (st <= S.limit) {
    const b = bboxOf(sh, st, Math.min(S.limit, 4294967295), 2000);
    // world -> lattice (hex: axial q = x - r / 2, r = y / SQ3)
    const pts = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(([x, y]) => sh.kind === 'hex' ? [x - y / (2 * L.SQ3), y / L.SQ3] : [x, y]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const m = 0.02 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 2;
    box = [Math.floor(Math.min(...xs) - m), Math.floor(Math.min(...ys) - m), Math.ceil(Math.max(...xs) + m), Math.ceil(Math.max(...ys) + m)];
  }
  if (box) box = box.map(v => clamp(v, -23001, 23001));
  if (pyrBoxes.size > 40) pyrBoxes.clear();
  pyrBoxes.set(key, box);
  return box;
}

// --- frame state --------------------------------------------------------------------------
function frameState(v, opts = {}) {
  const sh = opts.shape || S.shape, cam = opts.cam || S.cam;
  const pal = palArr(S.pal);
  const s = {
    shape: sh, P: S.P, mode: opts.mode != null ? opts.mode : S.mode, quad: S.quad,
    palA: pal, palB: S.palB ? palArr(S.palB) : pal, quadCol: rgb(PALETTES[S.pal].quad),
    compA: S.compA * clamp(((opts.cam || S.cam).z - 2) / 8, 0, 1), gain: 1, sweep: S.sweep ? [S.sweep.x, S.sweep.y, S.sweep.r] : null, sweepW: S.sweep ? S.sweep.w : 1,
    walk: S.walk ? S.walk.k : null, ignite: S.walk ? Math.max(6, S.walk.k * 0.04) : 30,
    style: S.style, dotR: S.dotR, ptSize: S.dotR * 2, bg: BGS[S.bg].c.map(rgb), bloom: S.bloom, exposure: 1,
    dpr: opts.dpr || dpr, cam, center: [v.cx * (opts.dpr || dpr), (v.h - v.cy) * (opts.dpr || dpr)],
    renderer: 'none', points: null, path: null, cam3: null, tileOn: false, boxMax: opts.thumb ? 3 : PHONE_Q.matches ? 4 : 6,
  };
  if (opts.walk !== undefined) s.walk = opts.walk;
  const pxW = 1 / (cam.z * s.dpr);
  if (S.morph && !opts.shape) {
    const mo = S.morph;
    s.points = { shapeA: mo.a.id, shapeB: mo.b.id, morph: mo.e, n0: mo.n0, count: mo.count, stagger: 0.55 };
    s.ptSize = Math.max(S.dotR * 2, 0.5);
    if (mo.c3) s.cam3 = cam3Mats(mo.c3, v);
    return s;
  }
  if (is3D(sh)) {
    const c3 = opts.cam3 || S.cam3 || home3(sh);
    s.cam3 = cam3Mats(c3, v);
    const st = L.startOf(sh, S.P);
    s.points = { shapeA: sh.id, n0: st, count: n3Count(sh, c3) };
    s.ptSize = S.dotR * 2.2;
    return s;
  }
  if (L.isLattice(sh)) {
    s.renderer = 'field';
    const [bx, by] = L.cellAt(sh, cam.x, cam.y), [wx, wy] = L.worldOf(sh, bx, by);
    s.base = { x: bx, y: by, wx, wy };
    s.tileOn = opts.tileOn != null ? opts.tileOn : S.tileOn;
    s.gain = 0.9;
    // the density pyramid (render.js): its region, and only the main view
    // builds it (the thumbnails of other shapes would rebuild it each time)
    const box = pyrRegion(sh);
    if (box) {
      s.pyr = { box, alpha: s.mode <= M.eisen, cap: PHONE_Q.matches ? 1024 : 2048 };
      s.pyrBuild = !opts.thumb; s.pyrBudget = PHONE_Q.matches ? 1e7 : 4e7;
    }
    // Zoomed out the field is a density map: a soft, high-floor bloom only.
    const zo = clamp((pxW - 0.3) / 1.2, 0, 1);
    s.bloomT = 0.3 * zo * zo * (3 - 2 * zo); s.bloom = S.bloom * lerp(1, 0.35, zo);
    if (S.path && !opts.thumb && cam.z * s.dpr > 2.5) {
      const sp = nSpan(sh, v, cam);
      if (sp.hi >= sp.lo && sp.hi - sp.lo < 400000) s.path = { shapeA: sh.id, n0: sp.lo, count: sp.hi - sp.lo + 1 };
    }
    return s;
  }
  // point shapes: the n range of the annulus under the canvas
  const r = worldRect(v, cam);
  const ox = clamp(0, r[0], r[2]), oy = clamp(0, r[1], r[3]);
  const rmin = Math.hypot(ox, oy), rmax = Math.max(...[[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]].map(([x, y]) => Math.hypot(x, y)));
  let [lo, hi] = L.nRange(sh, S.P, rmin - 2, rmax + 2);
  hi = Math.min(hi, lo + (opts.cap || PT_CAP()));
  if (hi > 4294967295) hi = 4294967295;
  if (S.bits) hi = Math.min(hi, Math.max(lo, S.limit + 7));
  s.points = { shapeA: sh.id, n0: lo, count: Math.max(0, hi - lo + 1) };
  s.ptSize = S.dotR * 2.6;
  if (S.path && !opts.thumb && hi - lo < 400000 && cam.z * s.dpr > 1.5) s.path = { shapeA: sh.id, n0: lo, count: hi - lo + 1 };
  return s;
}

// --- morph -------------------------------------------------------------------------------
// The numbers fly from their place in shape a to their place in shape b.
// Each n starts a little later than the one before (stagger), so the
// centre moves first. The camera eases from the view of a to a view of
// the same numbers in b.
export function startMorph(b, dur = 2.8, opts = {}) {
  const a = S.shape, v = VW || view();
  if (a === b) return;
  const stA = L.startOf(a, S.P), stB = L.startOf(b, S.P), st = Math.max(stA, stB);
  let count;
  if (is3D(a)) count = n3Count(a, S.cam3 || home3(a));
  else { const sp = L.isLattice(a) ? nSpan(a, v) : null; count = sp && sp.hi > 0 ? sp.hi - st + 1 : Math.max(2000, frameState(v).points ? frameState(v).points.count : 40000); }
  count = clamp(count || 40000, 400, opts.count || (PHONE_Q.matches ? 300000 : 800000));
  if (S.bits) count = Math.min(count, Math.max(400, S.limit - st));
  const camA = { ...S.cam };
  const camB = is3D(b) ? null : fitCam(bboxOf(b, st, st + count), 0.9, v);
  const c3 = is3D(a) || is3D(b);
  const flat = c => ({ yaw: -Math.PI / 2, pitch: 1.5697, dist: v.ch / (2 * c.z * Math.tan(FOV / 2)), tx: c.x, ty: c.y, tz: 0 });
  const c3A = is3D(a) ? { ...(S.cam3 || home3(a)) } : c3 ? flat(camA) : null;
  const c3B = is3D(b) ? home3(b) : c3 ? flat(camB) : null;
  S.walk = null;
  S.morph = { a, b, t: 0, dur, e: 0, n0: st, count, camA, camB, c3A, c3B, c3: c3A ? { ...c3A } : null, onDone: opts.onDone };
}
function stepMorph(dt) {
  const mo = S.morph;
  mo.t += dt; const u = clamp(mo.t / mo.dur, 0, 1);
  mo.e = u;
  const ce = easeIO(u);
  if (mo.c3) {
    for (const k of ['yaw', 'pitch', 'tx', 'ty', 'tz']) mo.c3[k] = lerp(mo.c3A[k], mo.c3B[k], ce);
    mo.c3.dist = Math.exp(lerp(Math.log(mo.c3A.dist), Math.log(mo.c3B.dist), ce));
  } else {
    S.cam.x = lerp(mo.camA.x, mo.camB.x, ce); S.cam.y = lerp(mo.camA.y, mo.camB.y, ce);
    S.cam.z = Math.exp(lerp(Math.log(mo.camA.z), Math.log(mo.camB.z), ce));
  }
  if (u >= 1) {
    S.morph = null;
    S.shape = mo.b;
    if (is3D(mo.b)) S.cam3 = { ...mo.c3B }; else { S.cam = { ...mo.camB }; S.cam3 = null; }
    shapeChanged();
    if (mo.onDone) mo.onDone();
  }
}

// --- walk --------------------------------------------------------------------------------
// The spiral counts out from its start. Speed grows with k, so the first
// cells come one by one and the millionth in a few seconds.
export function startWalk(opts = {}) {
  S.walk = { k: opts.k0 || 0, max: opts.max || (is3D(S.shape) ? n3Count(S.shape, S.cam3 || home3(S.shape)) : 400000), follow: opts.follow !== false, rate: opts.rate || S.walkRate, onDone: opts.onDone };
  S.morph = null;
  $('walkBtn').classList.add('on'); $('dockWalk').classList.add('on');
}
function stopWalk() { S.walk = null; $('walkBtn').classList.remove('on'); $('dockWalk').classList.remove('on'); S.dirty = true; }
function stepWalk(dt, v) {
  const w = S.walk;
  w.k += dt * w.rate * Math.max(2.2, 3 * Math.sqrt(w.k) + 0.28 * w.k);
  if (w.follow && !is3D(S.shape)) {
    const st = startOf(), b = bboxOf(S.shape, st, st + Math.max(9, Math.ceil(w.k * 1.15)), 120);
    const c = fitCam(b, 0.78, v);
    c.z = Math.min(c.z, 70);
    const a = 1 - Math.exp(-dt * 2.4);
    S.cam.x = lerp(S.cam.x, c.x, a); S.cam.y = lerp(S.cam.y, c.y, a);
    S.cam.z = Math.exp(lerp(Math.log(S.cam.z), Math.log(c.z), a));
  }
  if (w.k > w.max) { const done = w.onDone; stopWalk(); if (done) done(); }
}

// --- camera flights ------------------------------------------------------------------------
// A flight zooms out on the way and in again (the further the jump, the
// further out), so a far target never streaks past.
export function flyTo(to, dur = 1.6) {
  const from = { ...S.cam }, v = VW || view();
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const zmin = Math.min(from.z, to.z, Math.max(1e-4, 0.6 * Math.min(v.cw, v.ch) / Math.max(1, dist)));
  S.fly = { from, to, t: 0, dur, dip: Math.max(0, Math.log(Math.min(from.z, to.z) / zmin)) };
}
function stepFly(dt) {
  const f = S.fly; f.t += dt;
  const u = clamp(f.t / f.dur, 0, 1), e = easeIO(u);
  S.cam.x = lerp(f.from.x, f.to.x, e); S.cam.y = lerp(f.from.y, f.to.y, e);
  S.cam.z = Math.exp(lerp(Math.log(f.from.z), Math.log(f.to.z), e) - f.dip * Math.sin(Math.PI * e));
  if (u >= 1) S.fly = null;
}

// --- overlay ---------------------------------------------------------------------------------
const labelText = n => String(n);
function drawOverlay(v, ctx = oc, scale = dpr) {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, v.w, v.h);
  const sh = S.shape;
  if (S.morph || is3D(sh)) { if (S.overlayHook) S.overlayHook(ctx, v); return; }
  const c = S.cam;
  // diagonals
  if (S.diag && S.rays.length && (sh.key === 'square' || sh.key === 'klauber')) drawRays(ctx, v);
  // labels
  const cellPx = c.z * (sh.kind === 'hex' ? 1 : 1);
  if (S.labels && L.isLattice(sh) && cellPx >= 24) {
    const cr = cellRect(sh, worldRect(v));
    const count = (cr[2] - cr[0] + 1) * (cr[3] - cr[1] + 1);
    if (count < 6000) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const st = startOf();
      for (let j = cr[1]; j <= cr[3]; j++) for (let i = cr[0]; i <= cr[2]; i++) {
        const n = L.nAt(sh, S.P, i, j);
        if (n < 0) continue;
        if (S.walk && n - st > S.walk.k) continue;
        const [wx, wy] = L.worldOf(sh, i, j), [sx, sy] = toScreen(wx, wy, v);
        if (sx < -cellPx || sy < -cellPx || sx > v.w + cellPx || sy > v.h + cellPx) continue;
        let txt;
        if (sh.lattice) { const [a, b] = L.latticeNumber(sh, i, j); txt = sh.lattice === 'gauss' ? gaussText(a, b) : eisenText(a, b); }
        else txt = labelText(n);
        const prime = sh.lattice ? false : isPrimeN(n);
        const fs = Math.min(cellPx * 0.34, cellPx * 0.86 / (0.58 * Math.max(2, txt.length)));
        if (fs < 5.5) continue;
        ctx.font = `${prime ? 600 : 400} ${fs.toFixed(1)}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = prime ? 'rgba(6,10,22,0.92)' : 'rgba(205,214,232,0.5)';
        if (prime && S.style !== 0) ctx.fillStyle = 'rgba(255,255,255,0.96)';
        ctx.fillText(txt, sx, sy + (S.style === 0 ? 0 : S.dotR * cellPx + fs * 0.75) * (S.style === 0 ? 0 : 1));
      }
    }
  }
  if (S.labels && sh.kind === 'pt' && c.z >= 22) {
    const fsx = frameState(v);
    if (fsx.points && fsx.points.count < 5000) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let n = fsx.points.n0; n < fsx.points.n0 + fsx.points.count; n++) {
        if (S.walk && n - startOf() > S.walk.k) continue;
        const p = L.posOf(sh, n, S.P); if (!p) continue;
        const [sx, sy] = toScreen(p[0], p[1], v);
        if (sx < -20 || sy < -20 || sx > v.w + 20 || sy > v.h + 20) continue;
        const prime = isPrimeN(n), fs = Math.min(13, c.z * 0.28);
        ctx.font = `${prime ? 600 : 400} ${fs.toFixed(1)}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = prime ? 'rgba(255,255,255,0.92)' : 'rgba(205,214,232,0.42)';
        ctx.fillText(String(n), sx, sy + S.dotR * c.z + 2);
      }
    }
  }
  // hover and selection rings
  for (const h of [S.hover, S.sel]) {
    if (!h || h.n < 0 || !h.w) continue;
    const [sx, sy] = toScreen(h.w[0], h.w[1], v), r = Math.max(7, c.z * 0.62);
    ctx.strokeStyle = h === S.sel ? 'rgba(255,196,107,0.95)' : 'rgba(220,228,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
  }
  if (S.overlayHook) S.overlayHook(ctx, v);
}
const gaussText = (a, b) => (b === 0 ? `${a}` : a === 0 ? `${b === 1 ? '' : b === -1 ? '−' : b}i` : `${a}${b < 0 ? '−' : '+'}${Math.abs(b) === 1 ? '' : Math.abs(b)}i`).replace(/-/g, '−');
const eisenText = (a, b) => (b === 0 ? `${a}` : a === 0 ? `${b === 1 ? '' : b === -1 ? '−' : b}ω` : `${a}${b < 0 ? '−' : '+'}${Math.abs(b) === 1 ? '' : Math.abs(b)}ω`).replace(/-/g, '−');
// The densest half-lines: a glowing line and its quadratic.
function drawRays(ctx, v) {
  const sh = S.shape, c = S.cam;
  ctx.save();
  ctx.lineCap = 'round';
  S.rays.forEach((r, i) => {
    const steps = Math.min(r.steps + r.t0, 4000);
    const p = q => (sh.key === 'square' ? L.orient(q[0], q[1], S.P) : q);
    const a = p(r.start), b = p([r.start[0] + r.d[0] * steps, r.start[1] + r.d[1] * steps]);
    const [ax, ay] = toScreen(a[0], a[1], v), [bx, by] = toScreen(b[0], b[1], v);
    const hue = i === 0 ? '255,196,107' : '190,200,255';
    const g = ctx.createLinearGradient(ax, ay, bx, by);
    g.addColorStop(0, `rgba(${hue},0.75)`); g.addColorStop(1, `rgba(${hue},0.05)`);
    ctx.strokeStyle = g; ctx.lineWidth = Math.max(1.2, Math.min(5, c.z * 0.18));
    ctx.shadowColor = `rgba(${hue},0.8)`; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    // label inside the view, along the line
    const t = clamp(((v.cx - ax) * (bx - ax) + (v.cy - ay) * (by - ay)) / Math.max(1, (bx - ax) ** 2 + (by - ay) ** 2), 0.04, 0.8);
    const lx = lerp(ax, bx, t), ly = lerp(ay, by, t);
    if (lx > 10 && ly > 10 && lx < v.w - 10 && ly < v.h - 10) {
      ctx.shadowBlur = 0;
      ctx.font = '500 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      const txt = `${T.quadText(r.a, r.b, r.c0, 'm')}   ${r.ratio.toFixed(2)}×`;
      ctx.fillStyle = 'rgba(3,4,10,0.7)'; const tw = ctx.measureText(txt).width;
      ctx.fillRect(lx + 6, ly - 19, tw + 10, 18);
      ctx.fillStyle = `rgba(${hue},1)`; ctx.fillText(txt, lx + 11, ly - 4);
    }
  });
  ctx.restore();
}
function computeRays() {
  S.rays = [];
  if (!S.bits || !(S.shape.key === 'square' || S.shape.key === 'klauber')) return;
  S.rays = densestRays({ C: 60, M: 700, start: S.P.start, prime: isPrimeN, shape: S.shape.key, top: 7 });
}

// --- hover and readout ------------------------------------------------------------------------
// The number under the screen point (sx, sy): { n, w (world xy), cell }.
function hoverAt(sx, sy, v = VW) {
  const sh = S.shape;
  if (S.morph) return null;
  if (is3D(sh)) {
    const fs = frameState(v), c3 = cam3Mats(S.cam3 || home3(sh), v);
    if (!fs.points || fs.points.count > 200000) return null;
    let best = null, bd = 14 * 14;
    for (let n = fs.points.n0; n < fs.points.n0 + fs.points.count; n++) {
      const p = L.posOf(sh, n, S.P), q = p && project3(c3.mvp, p, v);
      if (!q) continue;
      const d = (q[0] - sx) ** 2 + (q[1] - sy) ** 2;
      if (d < bd) { bd = d; best = { n, w: null, scr: q }; }
    }
    return best;
  }
  const [wx, wy] = toWorld(sx, sy, v);
  if (L.isLattice(sh)) {
    const cell = L.cellAt(sh, wx, wy), n = L.nAt(sh, S.P, cell[0], cell[1]);
    return { n, w: L.worldOf(sh, cell[0], cell[1]), cell };
  }
  const n = L.nAt(sh, S.P, wx, wy, 0, Math.max(0.9, 10 / S.cam.z));
  if (n < 0) return { n: -1 };
  const p = L.posOf(sh, n, S.P);
  return { n, w: [p[0], p[1]] };
}
function showReadout(h) {
  const el = $('readout');
  if (!h || h.n < 0) { el.innerHTML = PHONE_Q.matches ? '' : ''; return; }
  const sh = S.shape, n = h.n;
  let html = '';
  if (sh.lattice && h.cell) {
    const [a, b] = L.latticeNumber(sh, h.cell[0], h.cell[1]);
    const gp = sh.lattice === 'gauss' ? T.gaussPrime(a, b, isPrimeN) : T.eisensteinPrime(a, b, isPrimeN);
    const N = sh.lattice === 'gauss' ? a * a + b * b : a * a - a * b + b * b;
    html = `<div class="n${gp ? ' p' : ''}">${sh.lattice === 'gauss' ? gaussText(a, b) : eisenText(a, b)}</div><div class="f">norm ${fmt(N)} = ${N > 1 ? T.factorText(N) : N}</div>`
      + `<div class="k">${gp ? `<b>${sh.lattice === 'gauss' ? 'Gaussian' : 'Eisenstein'} prime</b>` : 'not prime in this ring'} · index ${fmt(n)}</div>`;
    el.innerHTML = html; return;
  }
  const pr = isPrimeN(n);
  const f = n > 1 && n < 2 ** 53 ? T.factor(n) : [];
  const fact = n < 2 ? String(n) : pr ? 'prime' : T.factorText(n);
  const lines = [];
  if (n > 1 && !pr) lines.push(`d(n) <b>${T.divisorsOf(f)}</b> · φ(n)/n <b>${(T.totientOf(n, f) / n).toFixed(3)}</b>`);
  if (pr) {
    const tw = [2, 4, 6].filter(g => isPrimeN(n - g) || isPrimeN(n + g)).map(g => ({ 2: 'twin', 4: 'cousin', 6: 'sexy' })[g]);
    const sg = isPrimeN(2 * n + 1), sf = n > 2 && isPrimeN((n - 1) / 2);
    const tags = [...tw, sg ? 'Sophie Germain' : '', sf ? 'safe' : ''].filter(Boolean);
    lines.push(tags.length ? tags.join(' · ') : 'isolated prime');
  }
  if (sh.key === 'square' && h.cell) {
    const [cx, cy] = L.unorient(h.cell[0], h.cell[1], S.P);
    const fam = cellFamilies(cx, cy, S.P.start);
    for (const q of fam) lines.push(`<span class="q">${T.quadText(q.a, q.b, q.c, 'm')}</span>, m = ${q.m}`);
  }
  if (S.quad.on) {
    const k = quadIndex(n);
    if (k >= 0) lines.push(`<span class="q">f(${k}) = n</span>`);
  }
  html = `<div class="n${pr ? ' p' : ''}">${fmt(n)}</div><div class="f">${fact}</div><div class="k">${lines.join('<br>')}</div>`;
  el.innerHTML = html;
}
function quadIndex(n) {
  const { a, b, c } = S.quad;
  let k0;
  if (a === 0) { if (b === 0) return n === c ? 0 : -1; k0 = (n - c) / b; }
  else { const D = b * b - 4 * a * (c - n); if (D < 0) return -1; k0 = (-b + Math.sqrt(D)) / (2 * a); }
  const k = Math.round(k0);
  for (let kk = k - 1; kk <= k + 1; kk++) if (kk >= 0 && a * kk * kk + b * kk + c === n) return kk;
  return -1;
}

// --- prime count and quadratic readouts -------------------------------------------------------
let piAt = -1;
function updatePi(v) {
  if (!S.bits) return;
  let N;
  if (is3D(S.shape)) N = startOf() + n3Count(S.shape, S.cam3 || home3(S.shape));
  else if (L.isLattice(S.shape)) N = nSpan(S.shape, v).hi;
  else { const fs = frameState(v); N = fs.points ? fs.points.n0 + fs.points.count - 1 : 0; }
  if (!(N > 2)) return;
  const cap = Math.min(N, S.limit);
  if (cap === piAt) return;
  piAt = cap;
  const pi = T.piFrom(S.bits, S.blocks, cap), nl = cap / Math.log(cap), li = T.li(cap) - T.li(2);
  $('piRead').innerHTML = `<tr><td>N${N > S.limit ? ' (sieve end)' : ''}</td><td>${fmt(cap)}</td></tr>`
    + `<tr><td>π(N)</td><td class="big">${fmt(pi)}</td></tr>`
    + `<tr><td>N / ln N</td><td>${fmt(nl)} <small>(${(pi / nl).toFixed(4)})</small></td></tr>`
    + `<tr><td>li(N)</td><td>${fmt(li)} <small>(${(pi / li).toFixed(5)})</small></td></tr>`;
  S.piInfo = { N: cap, pi, nl, li };
}
function updateQuad() {
  const q = S.quad, el = $('quadRead');
  if (!S.bits) { el.innerHTML = ''; return; }
  const info = T.quadConstant(q.a, q.b, q.c);
  const N = 10000;
  const d = T.quadDensity(q.a, q.b, q.c, N, isPrimeN, info);
  let note = '';
  if (q.a < 0) note = 'a < 0: the values turn negative.';
  else if (d.reducible) note = 'f factors over the integers: only finitely many primes.';
  else if (d.fixed) note = `every f(n) is divisible by ${d.fixed}.`;
  el.innerHTML = `<tr><td>f(n)</td><td>${T.quadText(q.a, q.b, q.c)}</td></tr>`
    + `<tr><td>C(f)</td><td class="big">${d.C.toFixed(4)}</td></tr>`
    + `<tr><td>primes, n &lt; ${fmt(N)}</td><td>${fmt(d.observed)}</td></tr>`
    + `<tr><td>expected</td><td>${fmt(d.expected)}</td></tr>`
    + `<tr><td>observed / expected</td><td>${d.ratio.toFixed(3)}</td></tr>`
    + (note ? `<tr><td colspan="2" style="text-align:left;color:var(--warm)">${note}</td></tr>` : '');
  S.quadInfo = d;
}

// --- shape and mode changes -----------------------------------------------------------------
export function setShape(b, opts = {}) {
  if (b === S.shape && !S.morph) return;
  if (b.lattice === 'gauss') S.mode = M.gauss; else if (b.lattice === 'eisen') S.mode = M.eisen;
  else if (S.mode === M.gauss || S.mode === M.eisen) S.mode = M.primes;
  syncModeUI();
  const animate = opts.morph != null ? opts.morph : S.morphOn;
  if (animate && R) startMorph(b, opts.dur, opts);
  else {
    S.morph = null; S.shape = b;
    if (is3D(b)) S.cam3 = home3(b); else { S.cam = homeCam(b); S.cam3 = null; }
    shapeChanged();
  }
  syncShapeUI(b);
}
function shapeChanged() {
  S.tile.have = null; S.hover = null; S.sel = null; piAt = -1; showReadout(null);
  computeRays(); thumbsDirty = true; miniAt = 0; S.dirty = true;
  updateStatus();
}
export function setMode(id) {
  const m = MODES.find(x => x.id === id);
  if (id === M.gauss && S.shape.lattice !== 'gauss') { S.mode = id; setShape(L.SHAPE.gauss); return; }
  if (id === M.eisen && S.shape.lattice !== 'eisen') { S.mode = id; setShape(L.SHAPE.eisen); return; }
  if ((S.shape.lattice === 'gauss' && id !== M.gauss) || (S.shape.lattice === 'eisen' && id !== M.eisen)) { /* index-numbered lattice: allowed */ }
  S.mode = id;
  if (id >= M.divisors && id <= M.totient && R && R.arith.mode !== id) worker.postMessage({ type: 'arith', mode: id });
  S.tile.have = null; thumbsDirty = true; S.dirty = true; miniAt = 0;
  syncModeUI(); updateStatus();
  if (m) $('dockMode').textContent = m.name.split(' ')[0];
}

// --- input --------------------------------------------------------------------------------------
const ptrs = new Map();
let pinch = null, dragMoved = false, lastTap = 0;
function zoomAt(sx, sy, f) {
  const v = VW || view();
  if (is3D(S.shape)) { const c = S.cam3 || (S.cam3 = home3(S.shape)); c.dist = clamp(c.dist / f, 3, 6000); S.dirty = true; return; }
  const [wx, wy] = toWorld(sx, sy, v);
  S.cam.z = clamp(S.cam.z * f, 0.002, 400);
  const [nx, ny] = toWorld(sx, sy, v);
  S.cam.x += wx - nx; S.cam.y += wy - ny;
  S.dirty = true;
}
function userMoved() { S.fly = null; if (S.walk) S.walk.follow = false; }
cv.addEventListener('wheel', e => {
  e.preventDefault(); userMoved();
  const k = e.deltaMode === 1 ? 0.05 : 0.0018;
  zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * k));
}, { passive: false });
cv.addEventListener('pointerdown', e => {
  try { cv.setPointerCapture(e.pointerId); } catch (x) { /* a synthetic pointer */ }
  ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  dragMoved = false;
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
});
cv.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (!p) {
    if (e.pointerType === 'mouse') { const h = hoverAt(e.offsetX, e.offsetY); if (!h || !S.hover || h.n !== S.hover.n) { S.hover = h; showReadout(h); S.overlayDirty = true; } }
    return;
  }
  const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
  p.x = e.offsetX; p.y = e.offsetY;
  if (Math.abs(dx) + Math.abs(dy) > 0) { if (!dragMoved && Math.hypot(dx, dy) < 2) return; dragMoved = true; userMoved(); }
  if (ptrs.size === 2 && pinch) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (is3D(S.shape)) { zoomAt(mx, my, d / pinch.d); }
    else { zoomAt(mx, my, d / pinch.d); S.cam.x -= (mx - pinch.mx) / S.cam.z; S.cam.y += (my - pinch.my) / S.cam.z; }
    pinch = { d, mx, my }; S.dirty = true; return;
  }
  if (ptrs.size !== 1) return;
  if (is3D(S.shape)) {
    const c = S.cam3 || (S.cam3 = home3(S.shape));
    c.yaw -= dx * 0.006; c.pitch = clamp(c.pitch + dy * 0.006, -1.45, 1.55);
  } else { S.cam.x -= dx / S.cam.z; S.cam.y += dy / S.cam.z; }
  S.dirty = true;
});
const endPtr = e => {
  const had = ptrs.has(e.pointerId);
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (had && !dragMoved && e.type === 'pointerup') {
    const now = performance.now();
    if (now - lastTap < 300) { userMoved(); zoomAt(e.offsetX, e.offsetY, 2.2); lastTap = 0; }
    else {
      lastTap = now;
      const h = hoverAt(e.offsetX, e.offsetY);
      S.sel = h && h.n >= 0 ? h : null; showReadout(S.sel); S.overlayDirty = true;
    }
  }
};
cv.addEventListener('pointerup', endPtr);
cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !ptrs.size) { S.hover = null; showReadout(S.sel); S.overlayDirty = true; } });
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const v = VW || view();
  if (e.key === '+' || e.key === '=') zoomAt(v.cx, v.cy, 1.5);
  else if (e.key === '-' || e.key === '_') zoomAt(v.cx, v.cy, 1 / 1.5);
  else if (e.key === 'h' || e.key === 'H') goHome();
  else if (e.key === 'w' || e.key === 'W') toggleWalk();
  else if (e.key.startsWith('Arrow')) { const d = 80 / S.cam.z; if (e.key === 'ArrowLeft') S.cam.x -= d; if (e.key === 'ArrowRight') S.cam.x += d; if (e.key === 'ArrowUp') S.cam.y += d; if (e.key === 'ArrowDown') S.cam.y -= d; }
  else return;
  userMoved(); S.dirty = true;
});
function goHome() { stopWalk(); if (is3D(S.shape)) { S.cam3 = home3(S.shape); S.dirty = true; } else flyTo(homeCam(), 1.2); }
function toggleWalk() {
  if (S.walk) { stopWalk(); return; }
  if (!is3D(S.shape)) { const st = startOf(); S.cam = { ...S.cam, ...fitCam(bboxOf(S.shape, st, st + 9, 20), 0.6) }; S.cam.z = Math.min(S.cam.z, 60); }
  startWalk();
}
export function gotoNumber(txt) {
  let n;
  try {
    const t = String(txt).trim().replace(/[, _]/g, '');
    const m = /^(\d+(?:\.\d+)?)e(\d+)([+-]\d+)?$/i.exec(t);
    n = m ? Math.round(+m[1] * 10 ** +m[2]) + (m[3] ? +m[3] : 0) : /^\d+$/.test(t) ? Number(t) : NaN;
  } catch (e) { n = NaN; }
  if (!Number.isSafeInteger(n) || n < 0) { toast('Enter a whole number up to 9×10¹⁵'); return; }
  const sh = S.shape;
  if (n < startOf()) { toast(`This shape starts at ${startOf()}`); return; }
  const p = L.posOf(sh, n, S.P);
  if (!p) return;
  if (is3D(sh)) { const c = S.cam3 || home3(sh); S.cam3 = { ...c, tx: p[0], ty: p[1], tz: p[2], dist: 40 }; S.dirty = true; }
  else {
    const [wx, wy] = L.isLattice(sh) ? L.worldOf(sh, p[0], p[1]) : p;
    // close enough that the label of n fits its cell (labels need 5.5 px type)
    flyTo({ x: wx, y: wy, z: Math.max(46, 0.58 * String(n).length * 7 / 0.86) }, 2.2);
    S.sel = { n, w: [wx, wy], cell: L.isLattice(sh) ? p : null };
    showReadout(S.sel);
  }
  if (n > S.limit) toast(`${fmt(n)} is past the sieve: Miller–Rabin tiles`);
}
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }

// --- panel ----------------------------------------------------------------------------------------
const panel = $('panel');
function setOpen(o) {
  panel.classList.toggle('open', o); document.body.classList.toggle('panel-closed', !o);
  if (!o) panel.classList.remove('full');
  S.dirty = true;
}
// The 2D contexts of the thumbnails and the minimap, taken once when each
// canvas is made. The shell (index.html releaseFrame) calls
// getContext('webgpu') on every canvas of a released page; a canvas with
// no context yet would then give null for '2d'.
const thumbCtx = {};
function buildUI() {
  // gallery
  const gal = $('gallery');
  for (const sh of L.SHAPES) {
    const b = document.createElement('button');
    b.dataset.key = sh.key; b.title = sh.name; b.setAttribute('role', 'option');
    const c = document.createElement('canvas'); c.width = c.height = THUMB;
    thumbCtx[sh.key] = c.getContext('2d');
    b.append(c); const sp = document.createElement('span'); sp.textContent = sh.name; b.append(sp);
    b.addEventListener('click', () => { stopWalk(); setShape(sh); if (PHONE_Q.matches) panel.classList.remove('full'); });
    gal.append(b);
  }
  // modes
  const md = $('modes');
  for (const m of MODES) {
    const b = document.createElement('button'); b.textContent = m.name; b.dataset.id = m.id;
    b.addEventListener('click', () => setMode(m.id));
    md.append(b);
  }
  // quadratic
  const qin = () => {
    S.quad.a = Math.round(+$('qa').value || 0); S.quad.b = Math.round(+$('qb').value || 0); S.quad.c = Math.round(+$('qc').value || 0);
    S.quad.on = $('quadOn').checked; S.tile.have = null; updateQuad(); S.dirty = true; thumbsDirty = true;
  };
  ['qa', 'qb', 'qc'].forEach(id => $(id).addEventListener('input', qin));
  $('quadOn').addEventListener('change', qin);
  for (const [a, b, c] of QUAD_PRESETS) {
    const bt = document.createElement('button'); bt.textContent = T.quadText(a, b, c);
    bt.addEventListener('click', () => {
      $('qa').value = a; $('qb').value = b; $('qc').value = c; $('quadOn').checked = true; qin();
      if (a === 1 && b === 1 && c === 41 && S.shape.key === 'square' && S.P.start !== 41) toast('Tip: set the start to 41 and the line runs through the centre');
    });
    $('quadPresets').append(bt);
  }
  // drawing
  segBind('styleSeg', () => S.style, v => { S.style = +v; S.dirty = true; thumbsDirty = true; });
  for (const [k, p] of Object.entries(PALETTES)) {
    const b = document.createElement('button'); b.title = p.name; b.dataset.k = k;
    b.style.background = `linear-gradient(90deg,${p.stops.slice(1).join(',')})`;
    b.addEventListener('click', () => { S.pal = k; S.dirty = true; thumbsDirty = true; miniAt = 0; syncSwatches(); renderLegend(); });
    $('palettes').append(b);
  }
  for (const [k, p] of Object.entries(BGS)) {
    const b = document.createElement('button'); b.title = p.name; b.dataset.k = k;
    b.style.background = `radial-gradient(${p.c[0]},${p.c[1]})`;
    b.addEventListener('click', () => { S.bg = k; S.dirty = true; thumbsDirty = true; miniAt = 0; syncSwatches(); });
    $('bgs').append(b);
  }
  rangeBind('dotR', v => { S.dotR = v; }, v => v.toFixed(2));
  rangeBind('compA', v => { S.compA = v; }, v => v.toFixed(2));
  rangeBind('bloom', v => { S.bloom = v; }, v => v.toFixed(2));
  rangeBind('walkRate', v => { S.walkRate = v; if (S.walk) S.walk.rate = v; }, v => v.toFixed(2) + '×');
  checkBind('labelsOn', v => { S.labels = v; });
  checkBind('pathOn', v => { S.path = v; });
  checkBind('diagOn', v => { S.diag = v; if (v) computeRays(); });
  checkBind('miniOn', v => { S.mini = v; $('mini').classList.toggle('off', !v); });
  checkBind('morphOn', v => { S.morphOn = v; });
  $('gotoBtn').addEventListener('click', () => gotoNumber($('gotoN').value));
  $('gotoN').addEventListener('keydown', e => { if (e.key === 'Enter') gotoNumber($('gotoN').value); });
  $('walkBtn').addEventListener('click', toggleWalk);
  $('homeBtn').addEventListener('click', goHome);
  segBind('limitSeg', () => S.wantLimit, v => { if (+v > 1e8 && PHONE_Q.matches) toast('10⁹ needs about 60 MB: it may be slow on a phone'); startSieve(+v); });
  // panel open / close, dock
  $('gear').addEventListener('click', () => setOpen(true));
  $('panelClose').addEventListener('click', () => setOpen(false));
  $('dockPanel').addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  $('dockShapes').addEventListener('click', () => { setOpen(true); $('gallery').scrollIntoView({ block: 'start' }); });
  $('dockMode').addEventListener('click', () => {
    const cyc = MODES.filter(m => m.id !== M.gauss && m.id !== M.eisen);
    const i = cyc.findIndex(m => m.id === S.mode);
    setMode(cyc[(i + 1) % cyc.length].id); toast(MODES.find(m => m.id === S.mode).name);
  });
  $('dockWalk').addEventListener('click', toggleWalk);
  $('dockHome').addEventListener('click', goHome);
  const grip = $('sheetGrip'); let gripY = null;
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browsers */ } });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return;
    const dy = e.clientY - gripY; gripY = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });
  // minimap
  const mini = $('mini');
  const miniGo = e => {
    if (!S.miniCam || is3D(S.shape)) return;
    const r = mini.getBoundingClientRect(), mc = S.miniCam;
    const x = mc.x + ((e.clientX - r.left) / r.width - 0.5) * mc.span, y = mc.y - ((e.clientY - r.top) / r.height - 0.5) * mc.span;
    S.cam.x = x; S.cam.y = y; userMoved(); S.dirty = true;
  };
  let miniDown = false;
  mini.addEventListener('pointerdown', e => { miniDown = true; try { mini.setPointerCapture(e.pointerId); } catch (x) { /* synthetic */ } miniGo(e); });
  mini.addEventListener('pointermove', e => { if (miniDown) miniGo(e); });
  mini.addEventListener('pointerup', () => { miniDown = false; });
  syncSwatches(); syncModeUI(); syncShapeUI(S.shape); renderLegend();
  if (PHONE_Q.matches) setOpen(false);
}
function segBind(id, get, set) {
  const el = $(id);
  const sync = () => el.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(get()) === b.dataset.v));
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { set(b.dataset.v); sync(); }));
  sync(); el._sync = sync;
}
function rangeBind(id, set, f) {
  const inp = $(id), out = $(id + 'V');
  const show = () => { set(+inp.value); if (out) out.textContent = f(+inp.value); S.dirty = true; };
  inp.addEventListener('input', () => { show(); thumbsDirty = true; });
  show();
}
function checkBind(id, set) { const el = $(id); el.addEventListener('change', () => { set(el.checked); S.dirty = true; S.overlayDirty = true; }); set(el.checked); }
function syncSwatches() {
  $('palettes').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === S.pal));
  $('bgs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === S.bg));
}
function syncModeUI() {
  $('modes').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.id === S.mode));
  const m = MODES.find(x => x.id === S.mode);
  $('modeNote').textContent = m ? m.note : '';
  $('dockMode').textContent = m ? m.name.split(' ')[0] : '';
  renderLegend();
}
function renderLegend() {
  const st = PALETTES[S.pal].stops, q = PALETTES[S.pal].quad, el = $('legend');
  const dot = (c, t) => `<span><i style="background:${c};color:${c}"></i>${t}</span>`;
  const m = S.mode;
  const mix = (a, t) => { const x = rgb(a); return `rgb(${x.map(v => Math.round((v + (1 - v) * t) * 255)).join(',')})`; };
  let h = '';
  if (m === M.primes || m === M.gauss || m === M.eisen) h = dot(st[3], 'prime');
  else if (m >= M.twin && m <= M.sexy) h = dot(mix(st[4], 0.15), ['', 'twin', 'cousin', 'sexy'][m]) + dot(st[1], 'other primes');
  else if (m === M.sophie) h = dot(mix(st[4], 0.15), 'Sophie Germain') + dot(st[3], 'safe') + dot('#fff8e6', 'both');
  else if (m === M.figurate) h = dot(st[3], 'square') + dot(st[2], 'triangular') + dot(mix(st[4], 0.35), 'Fibonacci') + dot('#fff', 'square & triangular');
  else {
    const lab = { [M.divisors]: ['d(n) = 1, 2', 'd(n) ≥ 64'], [M.spf]: ['2', 'prime'], [M.totient]: ['φ/n → 0', 'φ/n → 1'] }[m];
    h = `<span class="bar" style="background:linear-gradient(90deg,${st.join(',')})"></span><span class="ends"><span>${lab[0]}</span><span>${lab[1]}</span></span>`;
  }
  if (S.quad.on) h += dot(q, 'f(n)');
  el.innerHTML = h;
}
function syncShapeUI(sh) {
  $('gallery').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.key === sh.key));
  $('shapeName').textContent = sh.name;
  $('shapeNote').textContent = sh.note;
  const box = $('shapeParams'); box.innerHTML = '';
  for (const p of sh.params) box.append(paramControl(p));
  updateStatus();
}
// One control per shape parameter. A change redraws at once (no morph).
function paramControl(key) {
  const wrap = document.createElement('div');
  const changed = () => { S.tile.have = null; computeRays(); updateQuad(); thumbsDirty = true; miniAt = 0; piAt = -1; S.dirty = true; S.overlayDirty = true; };
  const range = (label, min, max, step, get, set, f) => {
    wrap.className = 'row';
    wrap.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}"><span class="val"></span>`;
    const inp = wrap.querySelector('input'), out = wrap.querySelector('.val');
    inp.value = get(); out.textContent = f(get());
    inp.addEventListener('input', () => { set(+inp.value); out.textContent = f(+inp.value); changed(); });
  };
  const seg = (opts, get, set) => {
    wrap.className = 'seg';
    for (const [v, t] of opts) {
      const b = document.createElement('button'); b.textContent = t; b.dataset.v = v;
      b.addEventListener('click', () => { set(v); wrap.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === String(get()))); changed(); });
      b.classList.toggle('on', String(get()) === String(v));
      wrap.append(b);
    }
  };
  switch (key) {
    case 'start': {
      wrap.className = 'row';
      wrap.innerHTML = '<label>Start number</label><input type="number" min="0" step="1">';
      const inp = wrap.querySelector('input'); inp.value = S.P.start;
      inp.addEventListener('change', () => { const v = Math.max(0, Math.floor(+inp.value || 0)); if (Number.isSafeInteger(v)) { S.P.start = v; changed(); } });
      break;
    }
    case 'cw': seg([['false', 'Counter-clockwise'], ['true', 'Clockwise']], () => String(S.P.cw), v => { S.P.cw = v === 'true'; }); break;
    case 'rot': seg([['0', 'Start →'], ['1', '↑'], ['2', '←'], ['3', '↓']], () => String(S.P.rot), v => { S.P.rot = +v; }); break;
    case 'w': range('Width w', 2, 420, 1, () => S.P.w, v => { S.P.w = v; }, v => String(v)); break;
    case 'L': range('Core length L', 1, 80, 1, () => S.P.L, v => { S.P.L = v; }, v => String(v)); break;
    case 'cut': range('Corner cut', 0, 8, 1, () => S.P.cut, v => { S.P.cut = v; }, v => `${v}/8`); break;
    case 'K': range('Turns per square', 0.25, 4, 0.05, () => S.P.K, v => { S.P.K = v; }, v => v.toFixed(2)); break;
    case 'ang': range('Angle (degrees)', 90, 180, 0.01, () => S.P.ang, v => { S.P.ang = v; }, v => v.toFixed(2) + '°'); break;
    case 'g': range('Growth per turn g', 1.1, 12, 0.05, () => S.P.g, v => { S.P.g = v; }, v => v.toFixed(2)); break;
  }
  return wrap;
}
function updateStatus() {
  const m = MODES.find(x => x.id === S.mode);
  $('stShape').textContent = `${S.shape.name} · ${m ? m.name : ''}${S.quad.on ? ' · f(n) = ' + T.quadText(S.quad.a, S.quad.b, S.quad.c) : ''}`;
}

// --- thumbnails and minimap ------------------------------------------------------------------
const THUMB = 112;
let thumbsDirty = true, thumbQ = [];
function thumbCam(sh) {
  const st = L.startOf(sh, S.P), n = sh.kind === 'pt' ? (sh.key === 'archi' ? S.P.w * 22 : 5000) : sh.key === 'rows' || sh.key === 'snake' ? S.P.w * Math.min(60, S.P.w) : sh.key === 'hilbert' || sh.key === 'zorder' ? 4096 : 2600;
  return fitCam(bboxOf(sh, st, st + n, 300), 0.94, { cw: THUMB, ch: THUMB });
}
function renderThumbs(budget = 3) {
  if (!R || !S.bits) return;
  if (thumbsDirty) { thumbQ = L.SHAPES.slice(); thumbsDirty = false; }
  const v = { w: THUMB, h: THUMB, cx: THUMB / 2, cy: THUMB / 2, cw: THUMB, ch: THUMB };
  while (budget-- > 0 && thumbQ.length) {
    const sh = thumbQ.shift();
    const mode = sh.lattice === 'gauss' ? M.gauss : sh.lattice === 'eisen' ? M.eisen : (S.mode === M.gauss || S.mode === M.eisen) ? M.primes : S.mode;
    const opts = { shape: sh, mode, dpr: 1, thumb: true, tileOn: false, walk: null, cap: 200000 };
    if (is3D(sh)) { const c3 = home3(sh); c3.dist *= sh.key === 'helix' ? 0.55 : 0.55; opts.cam3 = c3; opts.cam = S.cam; }
    else opts.cam = thumbCam(sh);
    const fs = frameState(v, opts);
    fs.bloom = Math.min(0.6, S.bloom); fs.style = S.style === 0 && sh.kind !== 'pt' && !is3D(sh) ? 0 : 2;
    fs.dotR = 0.42; fs.ptSize = sh.kind === 'pt' ? 0.9 : 0.9;
    if (is3D(sh)) { fs.cam3 = cam3Mats(opts.cam3, v); fs.points.count = Math.min(fs.points.count, 30000); }
    const px = R.renderMini(fs, THUMB, THUMB);
    putFlipped(thumbCtx[sh.key], px, THUMB, THUMB);
  }
}
function putFlipped(ctx, px, w, h) {
  if (!ctx || !px) return;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  ctx.putImageData(img, 0, 0);
}
let miniAt = 0;
const MINI = 160;
function renderMini(v) {
  if (!R || !S.bits || !S.mini || is3D(S.shape) || S.saver || S.morph) return;
  const now = performance.now();
  if (now - miniAt < 300) return;
  miniAt = now;
  const st = startOf(), b = bboxOf(S.shape, st, st + homeCount(S.shape) * 4, 300);
  const span0 = Math.max(b[2] - b[0], b[3] - b[1]) * 1.1, viewSpan = Math.max(v.w, v.h) / S.cam.z * 2.5;
  const span = Math.max(span0, viewSpan);
  const inside = Math.abs(S.cam.x - (b[0] + b[2]) / 2) < span / 2 && Math.abs(S.cam.y - (b[1] + b[3]) / 2) < span / 2;
  const mc = inside && span === span0 ? { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, span } : { x: S.cam.x, y: S.cam.y, span };
  const key = `${S.shape.key}|${JSON.stringify(S.P)}|${S.mode}|${S.pal}|${S.bg}|${mc.x.toFixed(1)}|${mc.y.toFixed(1)}|${mc.span.toPrecision(3)}|${S.quad.on}`;
  S.miniCam = mc;
  const mini = $('mini'), ctx = miniCtx;
  if (!ctx) return;
  if (key !== S.miniKey) {
    S.miniKey = key;
    const vv = { w: MINI, h: MINI, cx: MINI / 2, cy: MINI / 2, cw: MINI, ch: MINI };
    const fs = frameState(vv, { cam: { x: mc.x, y: mc.y, z: MINI / mc.span }, dpr: 1, thumb: true, tileOn: false, walk: null, cap: 300000 });
    fs.style = 2; fs.bloom = 0.4;
    S.miniPx = R.renderMini(fs, MINI, MINI);
  }
  if (mini.width !== MINI) { mini.width = MINI; mini.height = MINI; }
  putFlipped(ctx, S.miniPx, MINI, MINI);
  // the view rectangle
  const r = worldRect(v), k = MINI / mc.span;
  const x0 = MINI / 2 + (r[0] - mc.x) * k, x1 = MINI / 2 + (r[2] - mc.x) * k, y0 = MINI / 2 - (r[3] - mc.y) * k, y1 = MINI / 2 - (r[1] - mc.y) * k;
  ctx.strokeStyle = 'rgba(255,196,107,0.95)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(Math.max(-2, x0), Math.max(-2, y0), Math.max(2, Math.min(MINI + 4, x1) - Math.max(-2, x0)), Math.max(2, Math.min(MINI + 4, y1) - Math.max(-2, y0)));
}

// --- the frame loop ----------------------------------------------------------------------------
let last = 0, frames = 0, lastState = null, glLost = false;
// The shell released the page (lib/gpu-guard.js), or the GL context is
// lost: draw nothing more. The guard also stops requestAnimationFrame,
// but a frame queued before the release still runs once.
const released = () => glLost || !!(window.__snGuardStats && window.__snGuardStats().released);
cv.addEventListener('webglcontextlost', e => { glLost = true; e.preventDefault(); });
cv.addEventListener('webglcontextrestored', () => { location.reload(); });
function loop(now) {
  requestAnimationFrame(loop);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
  if (!R || !oc || released()) return;
  const v = view();
  if (S.frameHook) S.frameHook(dt, v);
  let anim = !!(S.morph || S.walk || S.fly || S.sweep || S.animating);
  if (S.morph) stepMorph(dt);
  if (S.walk) stepWalk(dt, v);
  if (S.fly) stepFly(dt);
  if (!S.dirty && !anim && !S.overlayDirty) { renderThumbs(2); return; }
  S.tileOn = !S.morph && tileCheck(v);
  const fs = frameState(v);
  R.draw(fs);
  lastState = fs; frames++;
  drawOverlay(v);
  S.dirty = R.pyrBusy(); S.overlayDirty = false;
  if (!S.saver) { updatePi(v); renderMini(v); if (now - (S.statusAt || 0) > 200) { S.statusAt = now; statusRight(v); } }
  if (S.saverComposite) S.saverComposite();
}
function statusRight(v) {
  let t = '';
  if (L.isLattice(S.shape) && !S.morph) { const sp = nSpan(S.shape, v); if (sp.hi >= 0) t = `n ${fmtS(Math.max(0, sp.lo))} – ${fmtS(sp.hi)}`; if (S.tileOn) t += S.tile.pending ? ' · Miller–Rabin …' : ' · Miller–Rabin tile'; }
  else if (lastState && lastState.points) t = `${fmt(lastState.points.count)} numbers`;
  $('stRight').textContent = t + (S.bits ? ` · sieve ${fmtS(S.limit)}` : ' · sieving …');
}

// --- self-test (CDP) ---------------------------------------------------------------------------
// 1. gPos (glsl.js) against posOf (layouts.js) for every shape: n from
//    the start, and spread to 10^6.  2. the debug index pass against nAt
//    for every lattice shape.  3. the class pass against classify().
//    4. boxTest: the zoomed-out density against an exact count.
async function selfTest() {
  const out = { pos: {}, idx: {}, cls: {}, box: {}, ok: true };
  const v = { w: 96, h: 96, cx: 48, cy: 48, cw: 96, ch: 96 };
  const P0 = { ...S.P };
  for (const sh of L.SHAPES) {
    const st = L.startOf(sh, S.P);
    let worst = 0;
    for (const [n0, step] of [[st, 1], [st + 1000, 997]]) {
      const cnt = 1000, got = R.tfPositions(frameState(v), sh.id, n0, step, cnt);
      for (let i = 0; i < cnt; i++) {
        const n = n0 + i * step, p = L.posOf(sh, n, S.P), w = L.isLattice(sh) ? [...L.worldOf(sh, p[0], p[1]), 0] : p;
        const e = Math.hypot(got[3 * i] - w[0], got[3 * i + 1] - w[1], got[3 * i + 2] - (w[2] || 0)) / (1 + Math.hypot(...w) * 1e-3);
        worst = Math.max(worst, e);
      }
    }
    out.pos[sh.key] = +worst.toExponential(2);
    if (!(worst < 0.02)) out.ok = false;
  }
  for (const sh of L.SHAPES.filter(L.isLattice)) {
    let bad = 0, tot = 0;
    for (const [cx, cy, z] of [[0.3, 0.2, 6], [37.4, -21.6, 3], [-140.2, 95.7, 2]]) {
      const cam = { x: cx + (sh.key === 'rows' || sh.key === 'snake' ? 10 : 0), y: sh.key === 'rows' || sh.key === 'snake' ? -Math.abs(cy) : cy, z };
      if (['hilbert', 'zorder', 'cantor'].includes(sh.key)) { cam.x = Math.abs(cam.x) + 50; cam.y = Math.abs(cam.y) + 50; }
      const fs = frameState(v, { shape: sh, cam, dpr: 1, tileOn: false, walk: null });
      const k = R.readIndex(fs, v.w, v.h);
      for (let py = 0; py < v.h; py += 3) for (let px = 0; px < v.w; px += 3) {
        // the pixel centre, as the shader sees it (y from the bottom)
        const sx = px + 0.5, sy = py + 0.5;
        const wl = [cam.x - fs.base.wx + (sx - fs.center[0]) / z, cam.y - fs.base.wy + (sy - fs.center[1]) / z];
        // the same cell rounding as cellOf, from the local offset
        const cl = L.cellAt(sh, fs.base.wx + wl[0], fs.base.wy + wl[1]);
        const want = L.nAt(sh, S.P, cl[0], cl[1]);
        const wk = want < 0 ? -1 : want - L.startOf(sh, S.P);
        tot++; if (k[py * v.w + px] !== wk) bad++;
      }
    }
    out.idx[sh.key] = `${bad}/${tot}`;
    if (bad > tot * 0.002) out.ok = false;
  }
  if (S.bits) {
    for (const mode of [M.primes, M.twin, M.sophie, M.figurate, M.gauss]) {
      const sh = mode === M.gauss ? L.SHAPE.gauss : L.SHAPE.square;
      const cam = { x: 120.3, y: -64.2, z: 4 };
      const fs = frameState(v, { shape: sh, cam, dpr: 1, tileOn: false, walk: null, mode });
      const px = R.readClass(fs, v.w, v.h);
      let bad = 0, tot = 0;
      for (let py = 1; py < v.h; py += 4) for (let pxx = 1; pxx < v.w; pxx += 4) {
        const sx = pxx + 0.5, sy = py + 0.5;
        const cl = L.cellAt(sh, cam.x + (sx - fs.center[0]) / cam.z, cam.y + (sy - fs.center[1]) / cam.z);
        const n = L.nAt(sh, S.P, cl[0], cl[1]);
        const [a, b] = sh.lattice ? L.latticeNumber(sh, cl[0], cl[1]) : [0, 0];
        const want = T.classify(mode, n, isPrimeN, a, b);
        tot++; if (px[4 * (py * v.w + pxx)] !== want) bad++;
      }
      out.cls[MODES.find(m => m.id === mode).key] = `${bad}/${tot}`;
      if (bad > tot * 0.002) out.ok = false;
    }
  }
  if (S.bits) {
    const bt = boxTest();
    out.box = bt.res;
    if (!bt.ok) out.ok = false;
  }
  S.P = P0;
  S.dirty = true;
  return out;
}
// The density d = (mean light) ln(n) gain of the field pass (debug 3, G =
// d / 16) against an exact box count on the CPU: the light of each cell
// (1 for 1 and the primes, 0 else) times the area it shares with the
// pixel footprint (hex: in axial q, r, a footprint pxW by pxW / SQ3). Up
// to boxMax the GPU loops the cells (exact but for 8-bit rounding); past
// it, it reads the pyramid (exact block sums, partial blocks spread
// evenly). Where a block is more than half the footprint (pxW < 2 B0, on
// phones B0 = 8), the pyramid is coarser than the pixel: the mean stays
// exact, the pixels are softer, so that tier checks the bias only.
// pxW 16 and 32 were the old strides of 2 and 4 cells per sample (one
// parity of the checkerboard). pan: the mean d at pxW 16 for camera
// shifts of 0, 0.5, 1 and 1.5 cells (old: 1.8, 0, 0, 1.8).
function boxTest() {
  const res = {}, v = { w: 64, h: 64, cx: 32, cy: 32, cw: 64, ch: 64 };
  let ok = true;
  const run = (sh, pxW, cx, cy) => {
    const cam = { x: cx, y: cy, z: 1 / pxW };
    const fs = frameState(v, { shape: sh, cam, dpr: 1, tileOn: false, walk: null, mode: M.primes });
    fs.debug = 3;
    R.pyrEnsure(fs, Infinity);
    const px = R.readClass(fs, v.w, v.h);
    const hex = sh.kind === 'hex', hx = pxW / 2, hy = hex ? pxW / (2 * L.SQ3) : pxW / 2;
    let sg = 0, sw = 0, se = 0;
    for (let py = 0; py < v.h; py++) for (let qx = 0; qx < v.w; qx++) {
      const wx = cx + (qx + 0.5 - fs.center[0]) * pxW, wy = cy + (py + 0.5 - fs.center[1]) * pxW;
      const r = hex ? wy / L.SQ3 : wy, q = hex ? wx - r / 2 : wx;
      let acc = 0;
      for (let y = Math.round(r - hy); y <= Math.round(r + hy); y++) {
        const oy = Math.min(r + hy, y + 0.5) - Math.max(r - hy, y - 0.5); if (oy <= 0) continue;
        for (let x = Math.round(q - hx); x <= Math.round(q + hx); x++) {
          const ox = Math.min(q + hx, x + 0.5) - Math.max(q - hx, x - 0.5); if (ox <= 0) continue;
          const n = L.nAt(sh, S.P, x, y);
          if (n === 1 || (n > 1 && isPrimeN(n))) acc += ox * oy;
        }
      }
      const c0 = L.cellAt(sh, wx, wy), nC = Math.max(L.nAt(sh, S.P, c0[0], c0[1]), 3);
      const want = acc / (4 * hx * hy) * Math.log(nC) * fs.gain, got = 16 * px[4 * (py * v.w + qx) + 1] / 255;
      sg += got; sw += want; se += Math.abs(got - want);
    }
    const tier = pxW <= fs.boxMax ? 'cells' : pxW >= 2 * R.pyrInfo().B0 ? 'pyramid' : 'coarse';
    return { mean: sg / (v.w * v.h), bias: (sg - sw) / sw, err: se / sw, tier };
  };
  for (const [key, cx, cy, list] of [['square', 1500.3, -900.7, [1.5, 2, 4, 6, 16, 32]], ['hex', 1200.3, 700.6, [2, 5, 16]]]) {
    for (const pxW of list) {
      const r = run(L.SHAPE[key], pxW, cx, cy);
      const pass = Math.abs(r.bias) < (r.tier === 'cells' ? 0.01 : 0.03) && r.err < (r.tier === 'cells' ? 0.05 : r.tier === 'pyramid' ? 0.15 : 1);
      res[`${key} ${pxW}`] = `${r.tier}: bias ${r.bias.toFixed(3)} err ${r.err.toFixed(3)}${pass ? '' : ' FAIL'}`;
      if (!pass) ok = false;
    }
  }
  const pan = [0, 0.5, 1, 1.5].map(dx => run(L.SHAPE.square, 16, 1500 + dx, -900).mean);
  const spread = (Math.max(...pan) - Math.min(...pan)) / (pan.reduce((a, b) => a + b) / pan.length);
  res.pan16 = `${pan.map(m => m.toFixed(3)).join(' ')} spread ${spread.toFixed(3)}${spread < 0.03 ? '' : ' FAIL'}`;
  if (!(spread < 0.03)) ok = false;
  return { res, ok };
}

// --- boot ------------------------------------------------------------------------------------------
const app = {
  S, R: () => R, L, T, MODES, PALETTES, BGS, view, toScreen, toWorld, frameState, setShape, setMode, startMorph, startWalk, stopWalk,
  flyTo, homeCam, home3, n3Count, fitCam, bboxOf, cam3Mats, project3, nSpan, isPrimeN, fmt, fmtS, setOpen, drawOverlay, computeRays,
  updateQuad, worker, get dpr() { return dpr; }, gl: cv, ov, is3D, PHONE_Q, homeCount, shapeChanged,
};
window.__ulam = { S, app, selfTest, gotoNumber, setShape, setMode, L, T, frames: () => frames, ready: () => !!(S.bits && R) };
buildUI();
S.cam = homeCam(); S.cam.z = Math.max(S.cam.z, 2.2);
startSieve(PHONE_Q.matches ? 1e8 : 1e8);
installSaver(app);
requestAnimationFrame(loop);

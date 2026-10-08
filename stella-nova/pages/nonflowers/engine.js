// ============================================================================
//  NONFLOWERS  ·  engine.js — the shim around the upstream main.js
// ----------------------------------------------------------------------------
//  Nonflowers by Lingdong Huang, 2018 (MIT, see LICENSE-nonflowers.txt).
//  https://github.com/LingDong-/nonflowers, commit 03b653d. The file
//  upstream/main.js is a byte-for-byte copy of the upstream file. tests.mjs
//  checks its sha256. This module is our own code. It does not change the
//  upstream file.
//
//  THE PROBLEM. upstream/main.js is a browser script for one page load. It
//  changes shared state of the realm:
//    - Object.defineProperty(Array.prototype, "x" | "y" | "z" | "-1".."-3")
//      with getters. These are not configurable, so a second run throws.
//    - Math.random = Prng.next (a seeded generator), Math.seed, Math.oldRandom.
//    - implicit globals: SEED, CTX, PAPER_COL0, PAPER_COL1, context, v3,
//      vtxlist0, vtxlist1, vtxlist (and p in v3.normalize, never called).
//  It reads window.btoa and window.location.href (the seed comes from
//  "?seed="), it calls document.createElement("canvas" | "div" | "a") and
//  document.getElementById("summary"), and console.log(PAR) in genParams().
//  vizParams() builds a DOM summary table that we do not show.
//
//  THE SHIM. makeEngine() puts the source text in the body of
//    new Function('window', 'document', 'Object', 'Math', 'console', ...)
//  with a header and a footer. The source is not changed.
//    header   `var SEED, CTX, ...;` so that the implicit globals are local
//             to this engine and do not touch the realm.
//    Object   Object.create(Object) whose defineProperty() skips a property
//             that already exists. The Array.prototype getters are made once
//             per realm (worker or page) and the next engine reuses them.
//    Math     Object.create(Math). The upstream Math.random = ... line sets
//             an own property of this object, so the real Math.random
//             stays as it was.
//    window   { btoa, location: { href: 'nonflowers?seed=' + token } }
//    document createElement('canvas') -> env.canvas() (an OffscreenCanvas in
//             a worker, a real canvas on the main thread, a recorder in
//             node). Any other element and getElementById -> an inert stub
//             (a Proxy: a get returns the stub, a set does nothing, a call
//             returns the stub, innerHTML reads '').
//    console  log() keeps the PAR object (it has flowerChance); the rest of
//             the upstream log lines are dropped.
//    footer   returns the upstream functions and accessors for CTX, SEED
//             and the paper colours.
//
//  THE SEED. Upstream parseArgs() does not decode the URL value, so the
//  upstream SEED is the raw token after "?seed=". seedToken(seed) gives
//  that token: encodeURIComponent(seed). Thus our seed s paints the same
//  plant as upstream index.html?seed=<seedToken(s)>. A plain word or a
//  number is its own token. Prng.hash() overflows to Infinity for a token
//  of more than about 108 characters (then every random number is NaN), so
//  cleanSeed() cuts a seed to 48 characters and its token to 96.
//
//  THE ORDER. paint() makes the upstream load() order:
//    1. makeBG(): paper({col: PAPER_COL0, tex: 10, spr: 0}). It fills the
//       Perlin table and uses random numbers, so it must come first.
//    2. our copy of upstream generate(): CTX = Layer.empty(); a white fill;
//       paper({col: PAPER_COL1}) in 512 px tiles; then
//       Math.random() <= 0.5 ? woody(...) : herbal(...); Layer.border().
//  So paint() also knows the plant type (woody or herbal). It also wraps
//  Layer.blit (same call, same pixels) to keep the petal layer for
//  flowerFocus(). genParams()
//  runs inside woody() or herbal(); the console shim keeps its PAR.
//
//  NO DOM. The worker (worker.js), the main-thread fallback (pool.js) and
//  tests.mjs (with the recorder canvas) import this module.
//
//  MAIN-THREAD FALLBACK. On the main thread the Array.prototype getters
//  ("x", "y", "z", "-1", "-2", "-3") stay on the page realm. They are not
//  enumerable, so for..in and JSON do not see them. Math.random and the
//  implicit globals stay local, as in a worker.
//
//  GREP MAP
//    grep -n 'export const UPSTREAM'        name, author, commit, sha256
//    grep -n 'export function seedToken'    seed -> upstream URL token
//    grep -n 'export function cleanSeed'    trim and cut a typed seed
//    grep -n 'export function makeEngine'   the new Function() shim
//    grep -n 'function stubElement'         the inert DOM stub
//    grep -n 'export function paint'        upstream load() order
//    grep -n 'export function inkFocus'     where the petals / leaves are (saver)
//    grep -n 'export function plainPAR'     PAR -> plain data
//    grep -n 'export function hsvToRgb'     the upstream hsv(), as numbers
//    grep -n 'export function recorderCanvas' the node canvas (tests)
//    grep -n 'export function rgbaHash'     pixel hash for the parity check
//    grep -n 'export function randomSeed'   a fresh seed word
// ============================================================================

export const UPSTREAM = {
  name: 'Nonflowers', author: 'Lingdong Huang', year: 2018, licence: 'MIT',
  url: 'https://github.com/LingDong-/nonflowers', site: 'https://lingdong-.github.io/nonflowers/',
  commit: '03b653d',
  sha256: '538ff945687ceb521122bebe9fc1b96b250d854a13f90043b0d335475436ba14',
};
export const CREDIT = 'Nonflowers by Lingdong Huang (MIT) · github.com/LingDong-/nonflowers';
export const SIZE = 600;     // the painting, as upstream Layer.empty()
export const TILE = 512;     // the paper tile, as upstream paper()

// The implicit globals of upstream/main.js (found with tests.mjs
// 'no global leaks'). The header declares them local.
const LOCALS = ['SEED', 'CTX', 'PAPER_COL0', 'PAPER_COL1', 'context', 'v3', 'vtxlist0', 'vtxlist1', 'vtxlist', 'p'];
const EXPORTS = ['paper', 'woody', 'herbal', 'genParams', 'Layer', 'Filter', 'Noise', 'Prng', 'squircle', 'hsv', 'leaf', 'stem', 'branch'];
const MAX_SEED = 48, MAX_TOKEN = 96;

// Trim, cut to MAX_SEED characters, then cut more until the URL token is
// at most MAX_TOKEN long (whole code points, so no broken surrogate).
export function cleanSeed(s) {
  let cp = Array.from(String(s == null ? '' : s).trim()).slice(0, MAX_SEED);
  while (cp.length && encodeURIComponent(cp.join('')).length > MAX_TOKEN) cp.pop();
  return cp.join('').trim();
}
export function seedToken(seed) { return encodeURIComponent(cleanSeed(seed)); }

// A seed word for a new plant: a number like the upstream default (it uses
// the time in ms), but from the given random source.
export function randomSeed(rnd = Math.random) {
  return String(Math.floor(1e9 + rnd() * 9e9));
}

// An element stub for every non-canvas DOM call of upstream (vizParams,
// makeDownload, toggle). A get returns the stub, a set is ignored, a call
// returns the stub. innerHTML and string conversion give ''.
function stubElement() {
  const target = function () {};
  let proxy;
  const h = {
    get(_, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'innerHTML' || k === 'textContent' || k === 'value') return '';
      if (k === 'toString' || k === 'valueOf') return () => '';
      if (k === 'then') return undefined;
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; },
    construct() { return proxy; },
    has() { return true; },
    deleteProperty() { return true; },
    defineProperty() { return true; },
  };
  proxy = new Proxy(target, h);
  return proxy;
}

// ── makeEngine ──────────────────────────────────────────────────────────────
// src: the text of upstream/main.js. seed: our seed string. env.canvas():
// a new canvas-like object with width, height and getContext('2d').
// Returns the upstream functions plus the accessors and a log of PAR.
export function makeEngine(src, seed, env) {
  const token = seedToken(seed);
  if (!token) throw new Error('empty seed');
  const stub = stubElement();
  const doc = {
    createElement: tag => (String(tag).toLowerCase() === 'canvas' ? env.canvas() : stub),
    getElementById: () => stub,
    body: stub,
  };
  const win = {
    btoa: s => btoa(s),
    location: { href: 'nonflowers?seed=' + token },
  };
  const ObjectShim = Object.create(Object);
  ObjectShim.defineProperty = (o, k, d) => (Object.getOwnPropertyDescriptor(o, k) ? o : Object.defineProperty(o, k, d));
  const MathShim = Object.create(Math);
  const pars = [];
  const con = {
    log: v => { if (v && typeof v === 'object' && !Array.isArray(v) && 'flowerChance' in v) pars.push(v); },
    warn() {}, error() {}, info() {},
  };
  const header = 'var ' + LOCALS.join(', ') + ';\n';
  const footer = '\n;return {' + EXPORTS.join(',') +
    ',random:function(){return Math.random()}' +
    ',getCTX:function(){return CTX},setCTX:function(c){CTX=c}' +
    ',getSEED:function(){return SEED}' +
    ',paperCols:function(){return [PAPER_COL0,PAPER_COL1]}};';
  // eslint-disable-next-line no-new-func
  const run = new Function('window', 'document', 'Object', 'Math', 'console', header + src + footer);
  const E = run(win, doc, ObjectShim, MathShim, con);
  E.pars = pars;
  E.token = token;
  return E;
}

// ── paint ───────────────────────────────────────────────────────────────────
// The upstream load() order for one seed (see THE ORDER above).
// Returns { E, ctx, bg, blank, type, PAR, blits, base, ms }. ctx is the 600 px
// painting context, bg the 512 px paper canvas of the page background,
// blank the bare sheet before the plant (with the same border), blits the
// two plant layers (see flowerFocus), base the root in painting px.
// onStage(name) is called before each step (for a progress line).
export function paint(src, seed, env, onStage = () => {}) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  onStage('engine');
  const E = makeEngine(src, seed, env);
  const [PAPER_COL0, PAPER_COL1] = E.paperCols();
  onStage('background paper');
  const bg = E.paper({ col: PAPER_COL0, tex: 10, spr: 0 });     // makeBG()
  const t1 = now();
  // generate(), as upstream:
  onStage('painting paper');
  const ctx = E.Layer.empty();
  E.setCTX(ctx);
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const ppr = E.paper({ col: PAPER_COL1 });
  for (let i = 0; i < ctx.canvas.width; i += TILE) {
    for (let j = 0; j < ctx.canvas.height; j += TILE) ctx.drawImage(ppr, i, j);
  }
  // Record the two blits of woody() / herbal() (lay0 multiply, lay1 normal)
  // for flowerFocus(). The wrapper calls the upstream blit unchanged.
  const blits = [], blit0 = E.Layer.blit;
  E.Layer.blit = function (c0, c1, a) { blits.push({ ctx: c1, ble: a && a.ble, xof: a && a.xof, yof: a && a.yof }); return blit0.apply(this, arguments); };
  // A copy of the bare sheet (white and paper, no plant) for the saver
  // brush wipe. Copying and Layer.border use no random numbers.
  const blank = E.Layer.empty();
  blank.drawImage(ctx.canvas, 0, 0);
  const type = E.random() <= 0.5 ? 'woody' : 'herbal';
  onStage(type);
  if (type === 'woody') E.woody({ ctx, xof: 300, yof: 550 });
  else E.herbal({ ctx, xof: 300, yof: 600 });
  onStage('border');
  E.Layer.border(ctx, E.squircle(0.98, 3));
  E.Layer.border(blank, E.squircle(0.98, 3));
  const t2 = now();
  const PAR = E.pars[E.pars.length - 1] || null;
  E.Layer.blit = blit0;
  return { E, ctx, bg, blank: blank.canvas, type, PAR, blits, base: type === 'woody' ? [300, 550] : [300, 600], ms: { bg: t1 - t0, plant: t2 - t1, total: t2 - t0 } };
}

// ── inkFocus / flowerFocus ──────────────────────────────────────────────────
// Where the ink of one layer is. woody() and herbal() draw the petals on
// their own layer (lay1, blit with blend "normal") and the stems, branches
// and leaves on lay0 (blend "multiply"). inkFocus() sums the alpha of the
// layer with blend `ble` in cells of CELL painting px, then finds the
// WIN x WIN cell window with the most ink. A window whose centre is nearer
// than avoid.d to avoid.{x, y} is skipped. Returns { x, y, r, ink } in
// painting px (r: half the window size; ink: the share of all the layer
// alpha in the window), or null when the layer is (almost) empty: a woody
// plant can have no flower.
export function inkFocus(blits, ble, { size = SIZE, CELL = 20, WIN = 6, avoid = null } = {}) {
  const b = blits.find(q => q.ble === ble);
  if (!b || !b.ctx || !b.ctx.getImageData) return null;
  const W = b.ctx.canvas.width, H = b.ctx.canvas.height, d = b.ctx.getImageData(0, 0, W, H).data;
  if (!d.length) return null;
  const n = Math.ceil(size / CELL), acc = new Float64Array(n * n);
  let total = 0;
  const xo = Math.round(b.xof), yo = Math.round(b.yof);
  for (let y = 0; y < H; y++) {
    const py = y + yo;
    if (py < 0 || py >= size) continue;
    const row = Math.floor(py / CELL) * n;
    for (let x = 0; x < W; x++) {
      const a = d[(y * W + x) * 4 + 3];
      if (!a) continue;
      const px = x + xo;
      if (px < 0 || px >= size) continue;
      acc[row + Math.floor(px / CELL)] += a; total += a;
    }
  }
  if (total < 255 * 40) return null;
  let best = -1, bi = 0, bj = 0;
  for (let j = 0; j + WIN <= n; j++) for (let i = 0; i + WIN <= n; i++) {
    const cx = (i + WIN / 2) * CELL, cy = (j + WIN / 2) * CELL;
    if (avoid && Math.hypot(cx - avoid.x, cy - avoid.y) < avoid.d) continue;
    let s = 0;
    for (let v = 0; v < WIN; v++) for (let u = 0; u < WIN; u++) s += acc[(j + v) * n + i + u];
    if (s > best) { best = s; bi = i; bj = j; }
  }
  if (best <= 0) return null;
  return { x: (bi + WIN / 2) * CELL, y: (bj + WIN / 2) * CELL, r: WIN * CELL / 2, ink: best / total };
}
// The petal window, then the stem and leaf window away from it.
export function flowerFocus(blits) { return inkFocus(blits, 'normal'); }
export function plantFoci(blits) {
  const flower = flowerFocus(blits);
  const leaf = inkFocus(blits, 'multiply', { avoid: flower ? { x: flower.x, y: flower.y, d: 150 } : null });
  return { flower, leaf };
}

// ── PAR as plain data ───────────────────────────────────────────────────────
// Numbers and arrays stay. A colour {min, max} of [h, s, v, a] stays. A
// function is sampled at n points on [0, 1) with op = 0.5, as upstream
// vizParams() plots it. Returns { key: { kind, value } } in upstream order.
export function plainPAR(PAR, n = 100) {
  const out = {};
  if (!PAR) return out;
  for (const k of Object.keys(PAR)) {
    const v = PAR[k];
    if (typeof v === 'number') out[k] = { kind: 'number', value: v };
    else if (typeof v === 'function') {
      const ys = new Array(n);
      for (let i = 0; i < n; i++) { const y = v(i / n, 0.5); ys[i] = Number.isFinite(y) ? y : 0; }
      out[k] = { kind: 'curve', value: ys };
    } else if (v && typeof v === 'object' && Array.isArray(v.min)) {
      out[k] = { kind: 'colour', value: { min: v.min.slice(), max: v.max.slice() } };
    } else if (Array.isArray(v)) out[k] = { kind: 'list', value: v.slice() };
    else out[k] = { kind: 'other', value: String(v) };
  }
  return out;
}

// The upstream hsv() (h in degrees, s and v 0..1) as [r, g, b] 0..255,
// with the same floor. Used for the swatches of the summary.
export function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60)] || [0, 0, 0];
  return t.map(q => Math.floor((q + m) * 255));
}

// ── recorderCanvas (node) ───────────────────────────────────────────────────
// A canvas-like object for node tests. It draws nothing. It hashes each
// call and its numeric arguments (FNV-1a) so that a test can compare two
// runs. getImageData gives an empty pixel array, so the filter, bound and
// border loops do no work; they use no random numbers, so the random
// stream is the same as in a browser.
export function recorderCanvas(log) {
  const c = { width: 300, height: 150 };
  const rec = (name, args) => {
    let h = log.h >>> 0;
    const s = name + ':' + Array.prototype.map.call(args, a => (typeof a === 'number' ? a.toFixed(4) : typeof a === 'string' ? a : '#')).join(',');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    log.h = h; log.n++;
  };
  const ctx = new Proxy({ canvas: c }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'getImageData') return (x, y, w, hh) => { rec('gid', [w, hh]); return { data: new Uint8ClampedArray(0), width: w, height: hh }; };
      return function () { rec(String(k), arguments); };
    },
    set(t, k, v) { t[k] = v; rec('set ' + String(k), [v]); return true; },
  });
  c.getContext = () => ctx;
  return c;
}

// FNV-1a 32 bit over a byte array (RGBA pixels), as 8 hex digits.
export function rgbaHash(data) {
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) { h ^= data[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

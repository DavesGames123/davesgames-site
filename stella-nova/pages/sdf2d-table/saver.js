// ============================================================================
//  SDF 2D TABLE  ·  saver.js — the build-up screensaver, in 2D
// ----------------------------------------------------------------------------
//  The table engine's own saver drew one calm cell for the whole dwell, so a
//  run showed one still field ("Signed field" for 73 s). This saver builds
//  shapes instead, and makes the distance field the picture. Each RECIPE is
//  an ordered op list for the interpreter in shaders/saver.wgsl: primitives
//  join (smooth union, grown in by scale), cutters slide in and carve
//  (max(d, -d_i)), and modifiers ease in (onion, round, swirl, grid). One op
//  animates at a time, about 1.2 s at calm 0.7. Then the shape shows its
//  field: either a sphere-tracing demo (circles of radius d(p) step along a
//  ray to the edge) or a grid repetition that tiles it out. A new shape of
//  a seeded order comes every 8 to 10 s, in a seeded palette, band spacing,
//  flow speed and gradient colour.
//  The table cells and their shaders do not change: the saver has its own
//  pipeline on the device that the engine gives PAGE.init.
//
//  WIRING
//    main.js wraps PAGE.init to call setCtx(ctx), then calls install() after
//    bootTable, so this window.snSaver replaces the engine's one-cell hook.
//
//  GREP MAP
//    const RECIPES ...... the shapes, op by op, with plate captions
//    const PALETTES ..... inside, outside, zero line, accent, backdrop
//    function packOp .... op -> 4 vec4 (the WGSL Op layout)
//    function extent .... the box of the shape built so far (camera fit)
//    function plate ..... opts.label: shape, step, formula, live values
//    export const SAVER . setCtx, install, and the JS port for saver-test.mjs
// ============================================================================

const D2R = Math.PI / 180;
const T = { circle: 0, box: 1, capsule: 2, ring: 3, poly: 4, star: 5, half: 6, ellipse: 7, onion: 20, round: 21, swirl: 22, grid: 23 };
const C = { union: 0, sub: 1, inter: 2 };
const MAX_OPS = 24;

// ---------------------------------------------------------------- recipes
// op fields: t type, c combine, b params, pos, turn (degrees), rep and repR
// (polar copies), slide (the cutter offset at progress 0), lerp L (ease the
// distance in from L, no slide; L is about half the cutter depth, or for
// an intersector the largest d_i over the shape, so the change grows
// through the step; saver-test.mjs "spread" checks it), k, at (timeline step; default the list index),
// cap (plate sub). Units: a shape sits within radius about 1.2.
const IN = [0, 3.5];
const RECIPES = [
  { name: 'Gear', note: 'Sixteen teeth, a bore and a keyway', ops: [
    { t: 'circle', c: 'union', b: [0.8], cap: 'A disc' },
    { t: 'box', c: 'union', b: [0.12, 0.1, 0.02], rep: 16, repR: 0.86, k: 0.03, cap: 'Sixteen teeth by polar repetition' },
    { t: 'circle', c: 'sub', b: [0.25], slide: IN, cap: 'Boring the centre' },
    { t: 'circle', c: 'sub', b: [0.1], rep: 5, repR: 0.52, slide: IN, cap: 'Five lightening holes' },
    { t: 'box', c: 'sub', b: [0.06, 0.05, 0], pos: [0.27, 0], slide: [3.5, 0], cap: 'Cutting the keyway' },
    { t: 'round', b: [0.02], cap: 'Rounding every corner' },
  ] },
  { name: 'Heart', note: 'A square and two circles', ops: [
    { t: 'box', c: 'union', b: [0.5, 0.5, 0.04], pos: [0, -0.15], turn: 45, cap: 'A square, turned 45°' },
    { t: 'circle', c: 'union', b: [0.5], pos: [-0.354, 0.204], k: 0.05, cap: 'A circle on the left edge' },
    { t: 'circle', c: 'union', b: [0.5], pos: [0.354, 0.204], k: 0.05, cap: 'A circle on the right edge' },
    { t: 'onion', b: [0.07], cap: 'Outlining it' },
    { t: 'circle', c: 'union', b: [0.16], pos: [0, 0.05], k: 0.1, cap: 'A small heart of the heart' },
  ] },
  { name: 'Snowflake', note: 'Six arms, six stars, a hexagon', ops: [
    { t: 'capsule', c: 'union', b: [0.55, 0.06], rep: 6, repR: 0.55, cap: 'Six arms by polar repetition' },
    { t: 'star', c: 'union', b: [6, 0.18, 0.07], rep: 6, repR: 0.78, k: 0.02, cap: 'A small star on each arm' },
    { t: 'poly', c: 'union', b: [6, 0.2, 0.02], k: 0.05, cap: 'A hexagon at the centre' },
    { t: 'poly', c: 'sub', b: [6, 0.09, 0], lerp: 0.045, cap: 'Cutting a hexagonal hole' },
    { t: 'round', b: [0.015], cap: 'Rounding every corner' },
  ] },
  { name: 'Flower', note: 'Seven petals, swirled', ops: [
    { t: 'swirl', b: [0.9], at: 4, cap: 'Swirling it' },
    { t: 'circle', c: 'union', b: [0.3], at: 0, cap: 'The disc' },
    { t: 'ellipse', c: 'union', b: [0.34, 0.14], rep: 7, repR: 0.52, k: 0.08, at: 1, cap: 'Seven petals by polar repetition' },
    { t: 'ring', c: 'sub', b: [0.2, 0.025], lerp: 0.0125, at: 2, cap: 'Cutting a ring in the disc' },
    { t: 'circle', c: 'union', b: [0.08], k: 0.02, at: 3, cap: 'A seed at the centre' },
  ] },
  { name: 'Wrench', note: 'Handle, head, jaw and hole', ops: [
    { t: 'capsule', c: 'union', b: [0.72, 0.1], pos: [0.2, 0], cap: 'The handle' },
    { t: 'circle', c: 'union', b: [0.32], pos: [-0.72, 0], k: 0.12, cap: 'The head' },
    { t: 'box', c: 'sub', b: [0.18, 0.12, 0], pos: [-0.92, 0], slide: [-3.5, 0], cap: 'Cutting the jaw' },
    { t: 'circle', c: 'sub', b: [0.06], pos: [0.82, 0], lerp: 0.03, cap: 'A hanging hole' },
    { t: 'round', b: [0.012], cap: 'Rounding every corner' },
  ] },
  { name: 'Crescent and star', note: 'One disc cut by another', ops: [
    { t: 'circle', c: 'union', b: [0.72], cap: 'A full disc' },
    { t: 'circle', c: 'sub', b: [0.62], pos: [0.3, 0.14], slide: [3.5, 1], cap: 'A second disc carves the crescent' },
    { t: 'star', c: 'union', b: [5, 0.26, 0.11], pos: [0.36, 0.06], turn: 18, cap: 'A five-point star' },
    { t: 'round', b: [0.01], cap: 'Rounding every corner' },
  ] },
  { name: 'Chain mail', note: 'Two rings, repeated on a grid', ops: [
    { t: 'grid', b: [0.66, 2, 2], at: 2, cap: 'Tiling it on a grid' },
    { t: 'ring', c: 'union', b: [0.24, 0.065], at: 0, cap: 'A ring' },
    { t: 'ring', c: 'union', b: [0.24, 0.065], pos: [0.33, 0], k: 0.01, at: 1, cap: 'A second ring overlaps it' },
    { t: 'onion', b: [0.02], at: 3, cap: 'Splitting every wire in two' },
  ] },
  { name: 'Hex nut', note: 'A hexagon, chamfered and tapped', ops: [
    { t: 'poly', c: 'union', b: [6, 0.7, 0.03], cap: 'A hexagon' },
    { t: 'circle', c: 'inter', b: [0.78], lerp: 0.03, k: 0.02, cap: 'Chamfering the corners' },
    { t: 'circle', c: 'sub', b: [0.36], slide: IN, cap: 'Tapping the hole' },
    { t: 'ring', c: 'sub', b: [0.45, 0.012], lerp: 0.006, cap: 'Facing a ring on the bearing face' },
  ] },
];

const KIND = {
  union: { tex: String.raw`d \leftarrow \operatorname{smin}(d,\,d_i,\,k),\quad \operatorname{smin}=\min(a,b)-\tfrac{k}{4}h^2`, eq: 'd ← smin(d, dᵢ, k)' },
  sub: { tex: String.raw`d \leftarrow \max(d,\,-d_i)`, eq: 'd ← max(d, −dᵢ)' },
  inter: { tex: String.raw`d \leftarrow \max(d,\,d_i)`, eq: 'd ← max(d, dᵢ)' },
  onion: { tex: String.raw`d \leftarrow \bigl|d\bigr| - t`, eq: 'd ← |d| − t' },
  round: { tex: String.raw`d \leftarrow d - r`, eq: 'd ← d − r' },
  swirl: { tex: String.raw`p \leftarrow R\bigl(a\,\|p\|\bigr)\,p`, eq: 'p ← R(a·|p|) p' },
  grid: { tex: String.raw`p \leftarrow p - s\,\operatorname{clamp}\!\bigl(\operatorname{round}(p/s),\,-n,\,n\bigr)`, eq: 'p ← p − s·clamp(round(p/s), −n, n)' },
};
const PRIM = {
  circle: String.raw`d_i = \|p\| - r`,
  box: String.raw`d_i = \bigl\|\max(|p|-b,\,0)\bigr\| + \min\bigl(\max(|p_x|-b_x,\,|p_y|-b_y),\,0\bigr) - r`,
  capsule: String.raw`d_i = \bigl\|p - (\operatorname{clamp}(p_x,-h,h),\,0)\bigr\| - r`,
  ring: String.raw`d_i = \bigl|\,\|p\| - R\,\bigr| - w`,
  poly: String.raw`d_i = \pm\operatorname{dist}\bigl(p',\ \text{edge}\bigr),\quad p' = \operatorname{fold}_{2\pi/n}(p)`,
  star: String.raw`d_i = \pm\operatorname{dist}\bigl(p',\ \overline{t\,v}\bigr),\quad p' = \operatorname{fold}_{2\pi/n}(p)`,
  half: String.raw`d_i = h - p_y`,
  ellipse: String.raw`d_i \approx k_0(k_0-1)/k_1,\quad k_0=\|p/r\|,\ k_1=\|p/r^2\|`,
};
const REP = String.raw`\theta \leftarrow \theta - \tfrac{2\pi}{n}\operatorname{round}\!\bigl(\tfrac{n\,\theta}{2\pi}\bigr)`;
const RAY = { tex: String.raw`p_{n+1} = p_n + d(p_n)\,\hat r,\quad \text{stop when } d(p_n) < \varepsilon`, eq: 'pₙ₊₁ = pₙ + d(pₙ) r̂' };
const BANDS = String.raw`c = \cos\!\Bigl(2\pi\bigl(\tfrac{d}{s} - v\,t\bigr)\Bigr),\qquad \|\nabla d\| = 1`;

// [inside, outside, zero line, accent, backdrop], linear
const PALETTES = [
  [[0.85, 0.55, 0.2], [0.18, 0.32, 0.75], [1.0, 0.95, 0.85], [0.4, 0.9, 1.0], [0.01, 0.012, 0.03]],
  [[0.9, 0.25, 0.35], [0.12, 0.45, 0.4], [1.0, 0.9, 0.9], [1.0, 0.8, 0.3], [0.012, 0.02, 0.02]],
  [[0.35, 0.8, 0.55], [0.45, 0.2, 0.6], [0.95, 1.0, 0.9], [1.0, 0.45, 0.8], [0.015, 0.01, 0.025]],
  [[0.95, 0.85, 0.6], [0.6, 0.25, 0.12], [1.0, 1.0, 1.0], [0.5, 0.75, 1.0], [0.02, 0.012, 0.01]],
  [[0.3, 0.5, 1.0], [0.75, 0.55, 0.15], [0.9, 0.95, 1.0], [1.0, 0.5, 0.3], [0.01, 0.01, 0.02]],
  [[0.75, 0.75, 0.8], [0.15, 0.55, 0.85], [1.0, 1.0, 1.0], [1.0, 0.85, 0.35], [0.008, 0.012, 0.022]],
];

// ---------------------------------------------------------------- packing
const ease = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
function prep(op, i) {
  const b = [0, 0, 0, 0]; (op.b || []).forEach((v, j) => { b[j] = v; });
  return { ...op, ti: T[op.t], ci: C[op.c] ?? 0, b, pos: op.pos || [0, 0], turn: (op.turn || 0) * D2R, rep: op.rep || 0, repR: op.repR || 0,
    slide: op.slide || [0, 0], lerp: +op.lerp || 0, k: op.k || 0, at: op.at ?? i, pr: 0 };
}
function packOp(o, f, at) {
  f.set([o.ti, o.ci, o.pr, o.k, ...o.b, o.pos[0], o.pos[1], o.turn, o.rep, o.slide[0], o.slide[1], o.repR, o.lerp], at);
}

// ---------------------------------------------------------------- JS port
// The same walk as mapM in shaders/saver.wgsl, for saver-test.mjs.
function seg(qx, qy, ax, ay, bx, by) {
  const px = qx - ax, py = qy - ay, ux = bx - ax, uy = by - ay, h = Math.min(1, Math.max(0, (px * ux + py * uy) / (ux * ux + uy * uy)));
  return Math.hypot(px - ux * h, py - uy * h);
}
const fold = (x, y, n) => { const sec = 2 * Math.PI / n, a = Math.atan2(y, x), a2 = a - sec * Math.round(a / sec), r = Math.hypot(x, y); return [r * Math.cos(a2), Math.abs(r * Math.sin(a2))]; };
function prim(t, q, b) {
  const [x, y] = q;
  switch (t) {
    case 0: return Math.hypot(x, y) - b[0];
    case 1: { const dx = Math.abs(x) - b[0] + b[2], dy = Math.abs(y) - b[1] + b[2]; return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - b[2]; }
    case 2: { const xx = Math.min(b[0], Math.max(-b[0], x)); return Math.hypot(x - xx, y) - b[1]; }
    case 3: return Math.abs(Math.hypot(x, y) - b[0]) - b[1];
    case 4: { const [wx, wy] = fold(x, y, b[0]), half = b[1] * Math.tan(Math.PI / b[0]), e = seg(wx, wy, b[1], -half, b[1], half); return (wx > b[1] ? e : -e) - b[2]; }
    case 5: { const [wx, wy] = fold(x, y, b[0]), sec = 2 * Math.PI / b[0], ix = b[2] * Math.cos(sec / 2), iy = b[2] * Math.sin(sec / 2), e = seg(wx, wy, b[1], 0, ix, iy);
      const side = (ix - b[1]) * wy - iy * (wx - b[1]); return side > 0 ? -e : e; }
    case 6: return b[0] - y;
    case 7: { const k0 = Math.hypot(x / b[0], y / b[1]), k1 = Math.hypot(x / (b[0] * b[0]), y / (b[1] * b[1])); return k0 * (k0 - 1) / Math.max(k1, 1e-5); }
    default: return 1e5;
  }
}
const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
function opDist(o, p) {
  const pr = o.pr;
  let qx = p[0] - (o.pos[0] + o.slide[0] * (1 - pr)), qy = p[1] - (o.pos[1] + o.slide[1] * (1 - pr));
  const cs = Math.cos(o.turn), sn = Math.sin(o.turn);
  [qx, qy] = [cs * qx + sn * qy, -sn * qx + cs * qy];
  if (o.rep > 0.5) { const sec = 2 * Math.PI / o.rep, a = Math.atan2(qy, qx), a2 = a - sec * Math.round(a / sec), r = Math.hypot(qx, qy); qx = r * Math.cos(a2) - o.repR; qy = r * Math.sin(a2); }
  let d;
  if (o.ci === 0) { const sc = Math.max(pr, 1e-3); d = prim(o.ti, [qx / sc, qy / sc], o.b) * sc; }
  else d = prim(o.ti, [qx, qy], o.b);
  if (o.lerp) { const L = o.lerp; if (o.ci === 1) d = L + (d - L) * pr; if (o.ci === 2) d = -L + (d + L) * pr; }
  return d;
}
function mapM(ops, p0) {
  let p = p0.slice(), d = 1e5;
  for (const o of ops) {
    const pr = o.pr;
    if (pr <= 0) continue;
    if (o.ti >= 20) {
      if (o.ti === 20) d = d + (Math.abs(d) - o.b[0] - d) * pr;
      if (o.ti === 21) d = d - o.b[0] * pr;
      if (o.ti === 22) { const an = o.b[0] * pr * Math.hypot(p[0], p[1]), cs = Math.cos(an), sn = Math.sin(an); p = [cs * p[0] - sn * p[1], sn * p[0] + cs * p[1]]; }
      if (o.ti === 23) { const sp = 40 + (o.b[0] - 40) * pr, cl = (v, n) => Math.min(n, Math.max(-n, Math.round(v / sp))); p = [p[0] - sp * cl(p[0], o.b[1]), p[1] - sp * cl(p[1], o.b[2])]; }
      continue;
    }
    const dp = opDist(o, p);
    if (o.ci === 0) d = smin(d, dp, o.k * pr);
    else if (o.ci === 1) d = smax(d, -dp, o.k);
    else d = smax(d, dp, o.k);
  }
  return d;
}

// ---------------------------------------------------------------- timeline
function steps(ops) { return [...new Set(ops.map(o => o.at))].sort((a, b) => a - b); }
function timeline(ops, order, clock, T) {
  const s = Math.floor(clock / T), f = ease((clock - s * T) / T);
  for (const o of ops) { const k = order.indexOf(o.at); o.pr = k < s ? 1 : k === s ? f : 0; }
  return { step: Math.min(s, order.length - 1), f };
}
// The box of the shape built so far: the joined ops up to step s (all when
// s < 0), each as its position plus a radius from its size; a grid op that
// has started widens it by its copies.
function extent(ops, ord, s) {
  const lo = [1e9, 1e9], hi = [-1e9, -1e9];
  let grid = null;
  for (const o of ops) {
    const k = ord.indexOf(o.at);
    if (s >= 0 && k > s) continue;
    if (o.ti === 23) { grid = o; continue; }
    if (o.ti >= 20 || o.ci !== 0) continue;
    const b = o.b, r = (o.ti === 2 || o.ti === 3 ? b[0] + b[1] : o.ti === 4 || o.ti === 5 ? b[1] / Math.cos(Math.PI / Math.max(3, b[0])) : Math.max(b[0], b[1])) + o.repR;
    for (let j = 0; j < 2; j++) { lo[j] = Math.min(lo[j], o.pos[j] - r); hi[j] = Math.max(hi[j], o.pos[j] + r); }
  }
  if (lo[0] > hi[0]) return { c: [0, 0], r: 0.6 };
  if (grid) { lo[0] -= grid.b[0] * grid.b[1]; hi[0] += grid.b[0] * grid.b[1]; lo[1] -= grid.b[0] * grid.b[2]; hi[1] += grid.b[0] * grid.b[2]; }
  return { c: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2], r: Math.max(0.35, 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1])) };
}

// ---------------------------------------------------------------- the hook
let CTX = null, ctxWait = [];
function setCtx(ctx) { CTX = ctx; ctxWait.forEach(f => f(ctx)); ctxWait = []; }
const getCtx = () => CTX ? Promise.resolve(CTX) : new Promise(r => ctxWait.push(r));
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61); return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }
let CODE = '';
function codeExtract(src) {
  const a = src.indexOf('    let c = i32(o.a.y);'), b = src.indexOf('  return d;\n}', a);
  return a > 0 && b > a ? src.slice(a, b).replace(/^ {4}/gm, '').trimEnd() : '';
}

let run = null;
async function enter(opts = {}) {
  const ctx = await Promise.race([getCtx(), new Promise((_, no) => setTimeout(() => no(new Error('no GPU device')), 12000))]);
  const { device, format } = ctx;
  const src = await (await fetch(new URL('shaders/saver.wgsl', import.meta.url))).text();
  CODE = codeExtract(src);
  const module = device.createShaderModule({ code: src });
  const bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
  const pipe = await device.createRenderPipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_saver', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
  const HEAD = 40, FLOATS = HEAD + MAX_OPS * 16, buf = device.createBuffer({ size: FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const data = new Float32Array(FLOATS), bind = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: buf } }] });

  const style = document.createElement('style');
  style.textContent = `html.sdf2-saver, html.sdf2-saver body { background: #000 !important; overflow: hidden !important; cursor: none !important; }
html.sdf2-saver body > :not(.sdf2-saver-canvas) { display: none !important; }
.sdf2-saver-canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; z-index: 2147483647; background: #000; }`;
  document.head.appendChild(style);
  const canvas = document.createElement('canvas'); canvas.className = 'sdf2-saver-canvas';
  document.body.appendChild(canvas); document.documentElement.classList.add('sdf2-saver');
  const gpu = canvas.getContext('webgpu'); gpu.configure({ device, format, alphaMode: 'opaque' });

  const calm = Math.min(1, Math.max(0, opts.calm ?? 0.7)), R = rng(opts.seed);
  const order = RECIPES.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const STEP = 0.75 + 0.6 * calm, SHOW = 2.6, FADE = 0.5, RAYN = 14;
  const label = typeof opts.label === 'function' && opts.labels !== false ? opts.label : null;
  let ri = -1, rec = null, ops = null, ord = null, nBuild = 0, clock = 0, pal = null, look = null, view = null, last = 0, labAt = 0, labKey = '', raf = 0, mode = 'ray', ray = null;

  // A new shape: the next recipe, a palette and a field look. The end show is
  // a sphere-tracing demo, or (half the time, when the recipe has no grid of
  // its own) a grid op added as the last step, which tiles the shape out.
  const next = () => {
    ri++; rec = RECIPES[order[ri % order.length]];
    ops = rec.ops.map(prep); nBuild = steps(ops).length;
    const ownGrid = ops.some(o => o.ti === 23);
    mode = !ownGrid && R() < 0.5 ? 'tile' : 'ray';
    if (mode === 'tile') {
      const ex = extent(ops, steps(ops), -1);
      ops.unshift(prep({ t: 'grid', b: [1.9 * ex.r, 1, 1], at: 99, cap: 'Tiling it out on a grid' }, 0));
    }
    ord = steps(ops); clock = 0;
    pal = PALETTES[Math.floor(R() * PALETTES.length)];
    look = { sp: 0.07 + 0.12 * R(), flow: (0.12 + 0.3 * R()) * (1 - 0.4 * calm), grad: R() < 0.45 ? 0.6 + 0.4 * R() : 0, glint: R() * 6.28 };
    const ex = extent(ops, ord, 0);
    view = { c: ex.c.slice(), r: ex.r, from: null, to: null, t: 1, step: null };
    const a = R() * Math.PI * 2;
    ray = { a, off: (R() - 0.5) * 0.5 };
    labKey = '';
  };
  const frame = now => {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
    const dpr = Math.min(1.5, devicePixelRatio || 1), w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    clock += dt;
    const buildT = nBuild * STEP, tileT = mode === 'tile' ? STEP * 1.6 : 0, total = buildT + tileT + SHOW;
    if (clock > total + FADE) next();
    // build steps, then (tile mode) the grid step, then the show
    let step, f;
    if (clock < buildT) ({ step, f } = timeline(ops, ord, clock, STEP));
    else if (mode === 'tile' && clock < buildT + tileT) { for (const o of ops) o.pr = o.at === 99 ? ease((clock - buildT) / tileT) : 1; step = ord.length - 1; f = ease((clock - buildT) / tileT); }
    else { for (const o of ops) o.pr = 1; step = -1; f = 1; }
    const showing = step < 0;
    // view: fit the shape built so far; the ray demo pulls back a little
    const vs = showing ? -1 : step;
    if (vs !== view.step) {
      view.step = vs;
      const ex = extent(ops, ord, vs);
      view.from = { c: view.c.slice(), r: view.r }; view.to = { c: ex.c, r: ex.r * (showing && mode === 'ray' ? 1.3 : 1) }; view.t = 0;
    }
    view.t = Math.min(1, view.t + dt / 0.9);
    const e = ease(view.t);
    view.c = view.from.c.map((v, j) => v + (view.to.c[j] - v) * e); view.r = view.from.r + (view.to.r - view.from.r) * e;
    const asp = w / h, hh = Math.max(view.r / 0.42, view.r / (0.85 * asp)), lift = asp >= 1 ? 0.05 : 0.12;
    // the sphere-tracing demo ray: from outside the shape, aimed near its centre
    const ex = extent(ops, ord, -1), rd = ray.a + Math.PI + ray.off, rr = ex.r * 1.15;
    const ro = [ex.c[0] + Math.cos(ray.a) * rr, ex.c[1] + Math.sin(ray.a) * rr];
    const rayOn = showing && mode === 'ray', shown = rayOn ? Math.min(RAYN, (clock - buildT) / (SHOW * 0.7) * RAYN) : 0;
    const op = !showing ? ops.find(q => q.at === ord[step]) : null;
    const act = op && op.ti < 20 && op.ci !== 0 ? ops.indexOf(op) : -1, ghost = act >= 0 ? Math.sin(Math.PI * Math.min(1, f * 1.1)) : 0;
    look.glint += dt * 0.9;
    data.set([w, h, clock, Math.min(1, clock / FADE, Math.max(0, (total + FADE - clock) / FADE)),
      view.c[0], view.c[1], hh, lift,
      look.sp, look.flow, look.grad, ((look.glint + Math.PI) % (2 * Math.PI)) - Math.PI,
      act, ghost, shown, 0.7,
      ro[0], ro[1], rd, rayOn ? Math.min(1, (clock - buildT) / 0.4) : 0,
      ...pal[0], 0, ...pal[1], 0, ...pal[2], 0, ...pal[3], 0, ...pal[4], ops.length], 0);
    ops.forEach((o, j) => packOp(o, data, HEAD + j * 16));
    device.queue.writeBuffer(buf, 0, data);
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: gpu.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
    device.queue.submit([enc.finish()]);
    // the plate: at once for a new op, else twice a second for live values
    const key = rec.name + (showing ? 'show' : step);
    if (key !== labKey || now - labAt > 500) { labKey = key; labAt = now; plate(op, step, f, rayOn ? shown : -1, hh); }
  };
  const plate = (op, step, f, shown, hh) => {
    if (!label) return;
    const done = !op;
    const params = [{ sym: 'i', name: 'step', value: done ? 'done' : `${step + 1} of ${ord.length}` }];
    let sub, tex, eq, lines;
    if (done) {
      sub = shown >= 0 ? 'Sphere tracing the field to its edge' : `${rec.note}: tiled`;
      tex = shown >= 0 ? [RAY.tex, BANDS] : [KIND.grid.tex, BANDS];
      eq = shown >= 0 ? [RAY.eq] : [KIND.grid.eq];
      if (shown >= 0) params.push({ sym: 'n', name: 'march steps', value: `${Math.floor(shown)} of ${RAYN}` });
      lines = [shown >= 0 ? 'Each circle has radius d(p): no edge is closer, so the step is safe.' : 'One shape, many copies: the grid folds space.'];
    } else {
      const kind = op.ti >= 20 ? KIND[op.t] : KIND[op.c];
      sub = op.cap;
      tex = [kind.tex].concat(op.ti < 20 ? [PRIM[op.t]] : []).concat(op.rep ? [REP] : []);
      eq = [kind.eq];
      params.push({ sym: 'u', name: 'progress', value: `${Math.round(100 * f)}%` });
      if (op.ti < 20) params.push({ sym: 'k', name: op.c === 'union' ? 'blend radius' : 'edge blend', value: (op.c === 'union' ? op.k * op.pr : op.k).toFixed(3) });
      if (op.rep) params.push({ sym: 'n', name: 'polar copies', value: String(op.rep) });
      if (op.ti >= 20) params.push({ sym: op.t === 'swirl' ? 'a' : op.t === 'grid' ? 's' : op.t === 'onion' ? 't' : 'r', name: op.t === 'swirl' ? 'swirl, rad per unit' : op.t === 'grid' ? 'spacing' : op.t === 'onion' ? 'line width' : 'corner radius',
        value: (op.t === 'grid' ? 40 + (op.b[0] - 40) * op.pr : op.b[0] * op.pr).toFixed(3) });
      lines = [`${op.ti >= 20 ? 'Modifier' : op.c === 'union' ? 'Join' : op.c === 'sub' ? 'Carve' : 'Intersect'}: ${op.cap.toLowerCase()}`];
    }
    params.push({ sym: 's', name: 'band spacing', value: look.sp.toFixed(3) });
    const info = { title: rec.name, sub, params, tex, eq, lines,
      code: CODE ? { lang: 'WGSL', name: 'fn mapM · saver.wgsl', text: CODE } : undefined };
    try { label(info); } catch (_) {}
  };
  next();
  raf = requestAnimationFrame(frame);
  run = { canvas, style, stop: () => cancelAnimationFrame(raf), buf };
  return { canvas, warmupMs: 1000 };
}
function exit() {
  if (!run) return;
  run.stop(); run.canvas.remove(); run.style.remove(); run.buf.destroy();
  document.documentElement.classList.remove('sdf2-saver'); run = null;
}
function install() { window.snSaver = { enter, exit }; }

export const SAVER = { setCtx, install, RECIPES, prep, steps, timeline, extent, mapM, opDist, MAX_OPS };

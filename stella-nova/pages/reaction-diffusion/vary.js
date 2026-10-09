// ============================================================================
//  REACTION-DIFFUSION  ·  vary.js — seeded variation of the start state
// ----------------------------------------------------------------------------
//  The presets come from Ready with one fixed start geometry: the crystal
//  always grew from one small disc at the exact centre, a Gray-Scott seed
//  was always the same square in the middle. Only the noise inside changed
//  with the seed. The user found the starts not random enough.
//
//  varyInit(preset, seed) returns a new init list (shadergen.js
//  buildInitState applies it). From the seed (its own stream, so the noise
//  stream does not change):
//    - one similarity transform for the whole geometry (move, scale 0.75 to
//      1.35, a turn of 0/90/180/270 degrees, a mirror), so a shape made of
//      several regions (a U-skate glider, an O-ring) keeps its form;
//    - for a "seed" preset (a uniform background plus small seed shapes),
//      1 to 5 copies of the seed shapes, each with its own transform, at
//      places that do not overlap;
//    - sine phases at random.
//  The geometry stays inside the grid with a margin.
//  FIXED presets keep their start: where the place is the point of the
//  demo (the parameter maps, the two slits, the spiral and wave set-ups,
//  the interpolation demos, a front on one edge).
//  varyParams(preset, rnd) gives seeded values for the PARAMS table: only
//  shape parameters with a safe range (the crystal: its orientation, its
//  anisotropy strength and its latent heat).
//
//  GREP MAP
//    export const FIXED ......... presets that keep their start
//    export const PARAMS ........ per preset, the parameters to vary
//    export function isSeedPreset  background + small seed shapes
//    export function varyInit .... the varied init list
//    export function varyParams .. the varied parameter values
// ============================================================================

export const FIXED = new Set([
  'schrodinger-two-slit', 'schrodinger-reflect', 'oregonator', 'heat-interpolation',
  'biharmonic-interpolation', 'shallow-water', 'kobayashi-laplacian-growth', 'fhn-ising',
]);
export const PARAMS = {
  'kobayashi-crystal': { rotate: [0, 0.2], delta: [0.006, 0.014], k: [1.5, 2.0] },
};

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The box [x0, y0, x1, y1] of one op's geometry, or null when the op has
// none (a full-grid fill or noise).
function boxOf(op) {
  const r = op.region;
  if (r) {
    if (r.rect) return r.rect.slice();
    if (r.circle) { const [x, y, q] = r.circle; return [x - q, y - q, x + q, y + q]; }
    if (r.ring) { const [x, y, , q] = r.ring; return [x - q, y - q, x + q, y + q]; }
    return null;   // a half plane: no box
  }
  if (op.op === 'gauss') { const [x, y] = op.center || [0.5, 0.5], s = 2 * (op.sigma || 0.05); return [x - s, y - s, x + s, y + s]; }
  return null;
}
const union = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);

// A seed preset: every op either covers the whole grid with one value
// (fill) or has a box, the boxes together are small, and no op is a half
// plane or a linear ramp. Its seed shapes can be copied.
export function isSeedPreset(preset) {
  if (FIXED.has(preset.id) || preset.paramMap) return false;
  let box = null, local = 0;
  for (const op of preset.init || []) {
    if (op.region && op.region.halfplane) return false;
    if (op.op === 'linear' || op.op === 'sine' || (op.op === 'copy' && !op.region)) return false;
    const b = boxOf(op);
    if (b) { box = union(box, b); local++; }
    else if (!['fill', 'set', 'add', 'noise'].includes(op.op)) return false;
  }
  if (!box || !local) return false;
  return (box[2] - box[0]) * (box[3] - box[1]) <= 0.12;
}

// Map a point by the transform T = { cx, cy, s, rot (0..3), mirror, tx, ty }:
// about the centre (cx, cy), mirror x, turn rot x 90 degrees, scale s,
// then move to (tx, ty).
function mapPt(T, x, y) {
  let dx = (x - T.cx) * (T.mirror ? -1 : 1), dy = y - T.cy;
  for (let k = 0; k < T.rot; k++) { const t = dx; dx = -dy; dy = t; }
  return [T.tx + dx * T.s, T.ty + dy * T.s];
}
function mapOp(op, T) {
  const o = JSON.parse(JSON.stringify(op));
  const r = o.region;
  if (r && r.rect) {
    const [x0, y0, x1, y1] = r.rect, a = mapPt(T, x0, y0), b = mapPt(T, x1, y1);
    r.rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  } else if (r && r.circle) {
    const [x, y, q] = r.circle, p = mapPt(T, x, y); r.circle = [p[0], p[1], q * T.s];
  } else if (r && r.ring) {
    const [x, y, q0, q1] = r.ring, p = mapPt(T, x, y); r.ring = [p[0], p[1], q0 * T.s, q1 * T.s];
  }
  if (o.op === 'gauss') { const [x, y] = o.center || [0.5, 0.5], p = mapPt(T, x, y); o.center = p; o.sigma = (o.sigma || 0.05) * T.s; }
  return o;
}

// A transform that puts box b (scaled by s) inside [m, 1 - m] at a random
// place; s shrinks when the box would not fit.
function placeIn(rnd, b, m, sRange) {
  const w = b[2] - b[0], h = b[3] - b[1], cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  const rot = Math.floor(rnd() * 4), mirror = rnd() < 0.5;
  const ww = rot % 2 ? h : w, hh = rot % 2 ? w : h;
  let s = sRange[0] + (sRange[1] - sRange[0]) * rnd();
  s = Math.min(s, (1 - 2 * m) / Math.max(ww, 1e-6), (1 - 2 * m) / Math.max(hh, 1e-6));
  const hx = ww * s / 2, hy = hh * s / 2;
  const tx = m + hx + (1 - 2 * m - 2 * hx) * rnd(), ty = m + hy + (1 - 2 * m - 2 * hy) * rnd();
  return { cx, cy, s, rot, mirror, tx, ty, hx, hy };
}

export function varyInit(preset, seed = 1) {
  const init = preset.init || [];
  if (FIXED.has(preset.id) || preset.paramMap) return init;
  const rnd = mulberry32((seed ^ 0x51ed270b) >>> 0);
  let box = null;
  for (const op of init) box = union(box, boxOf(op));
  // sine phases at random (the waves start anywhere)
  const phased = op => (op.op === 'sine' ? Object.assign(JSON.parse(JSON.stringify(op)), { phase: (op.phase || 0) + 2 * Math.PI * rnd() }) : op);
  if (!box) return init.map(phased);
  const m = 0.04;
  if (!isSeedPreset(preset)) {
    const T = placeIn(rnd, box, m, [0.85, 1.15]);
    return init.map(op => (boxOf(op) ? mapOp(op, T) : phased(op)));
  }
  // a seed preset: the background ops once, then 1-5 copies of the seed ops
  const bg = init.filter(op => !boxOf(op)), seedOps = init.filter(op => boxOf(op));
  const n = 1 + Math.floor(rnd() * 5), placed = [], out = bg.map(phased);
  for (let c = 0; c < n; c++) {
    let T = null;
    for (let tries = 0; tries < 24 && !T; tries++) {
      const t = placeIn(rnd, box, m, [0.75, 1.35]);
      if (placed.every(p => Math.abs(p.tx - t.tx) > p.hx + t.hx + 0.03 || Math.abs(p.ty - t.ty) > p.hy + t.hy + 0.03)) T = t;
    }
    if (!T) break;
    placed.push(T);
    for (const op of seedOps) out.push(mapOp(op, T));
  }
  return out;
}

export function varyParams(preset, rnd) {
  const P = PARAMS[preset.id], out = {};
  if (!P) return out;
  const known = new Set((preset.params || []).map(q => q.name));
  for (const [name, [lo, hi]] of Object.entries(P)) if (known.has(name)) out[name] = +(lo + (hi - lo) * rnd()).toFixed(5);
  return out;
}

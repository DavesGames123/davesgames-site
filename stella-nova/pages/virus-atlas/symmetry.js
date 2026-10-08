// ============================================================================
//  VIRUS ATLAS  ·  symmetry.js — operators, axes, animation timing, layout
// ----------------------------------------------------------------------------
//  No DOM and no three.js: tests.mjs runs this file in Node. Lengths are
//  in nm. An operator set is a Float32Array of 3x4 rows (format.js).
//
//  ROTATIONS   det3, orthoError, axesOf (the n-fold axes of an operator set)
//  UNITS       unitCentroids: one unit = one chain of one copy. The GPU
//              moves a unit as one block in the assembly, peel and
//              explode animations.
//  TIMING      assemblyDelays (0..1 per unit), explodeDirs, ease functions,
//              unitProgress (the same curve the vertex shader uses)
//  ENVELOPE    envelopeOps: spikes on a membrane sphere (an illustration)
//  LADDER      LADDER_MARKS, ladderX, lineupLayout, ladderView
//  RULER       niceRuler
//  SAVER       makeRng (seeded), shotSeconds (5..12 s)
//
//  grep -n targets: "export function axesOf", "export function assemblyDelays",
//    "export function explodeDirs", "export function unitProgress",
//    "export function envelopeOps", "export function ladderView",
//    "export function niceRuler", "export function shotSeconds"
// ============================================================================

export const TAU = Math.PI * 2;
export const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
export const easeInOut = t => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const easeOut = t => 1 - Math.pow(1 - clamp01(t), 3);
export const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };

// ── rotations ──────────────────────────────────────────────────────────────
export function det3(ops, k) {
  const o = 12 * k;
  const a = ops[o], b = ops[o + 1], c = ops[o + 2], d = ops[o + 4], e = ops[o + 5], f = ops[o + 6], g = ops[o + 8], h = ops[o + 9], i = ops[o + 10];
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}
// The largest |R R^T - I| entry.
export function orthoError(ops, k) {
  const o = 12 * k; let worst = 0;
  for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) {
    let v = 0;
    for (let j = 0; j < 3; j++) v += ops[o + 4 * r + j] * ops[o + 4 * s + j];
    worst = Math.max(worst, Math.abs(v - (r === s ? 1 : 0)));
  }
  return worst;
}
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The rotation axis and angle of operator k.
export function axisAngle(ops, k) {
  const o = 12 * k, R = i => ops[o + 4 * Math.floor(i / 3) + (i % 3)];
  const tr = R(0) + R(4) + R(8);
  const ang = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
  let ax;
  if (ang < 1e-6) ax = [0, 1, 0];
  else if (Math.PI - ang > 0.05) ax = norm([R(7) - R(5), R(2) - R(6), R(3) - R(1)]);
  else {
    // a half turn (or near it): R + I ~ 2 a a^T; take its longest column,
    // with the sign of the antisymmetric part
    const cols = [0, 1, 2].map(c => [R(c) + (c === 0), R(3 + c) + (c === 1), R(6 + c) + (c === 2)]);
    cols.sort((p, q) => Math.hypot(...q) - Math.hypot(...p));
    ax = norm(cols[0]);
    const w = [R(7) - R(5), R(2) - R(6), R(3) - R(1)];
    if (dot(ax, w) < 0) ax = [-ax[0], -ax[1], -ax[2]];
  }
  return { axis: ax, angle: ang };
}

// The symmetry axes: each line through the origin that an operator turns
// about, with the highest order found on it. A line counts once (a and -a
// are one line); dir is the half with y >= 0 (ties broken on x, then z).
export function axesOf(ops, tolDeg = 2) {
  const m = ops.length / 12, cosT = Math.cos(tolDeg * Math.PI / 180), out = [];
  for (let k = 0; k < m; k++) {
    const { axis, angle } = axisAngle(ops, k);
    if (angle < 1e-3) continue;
    const order = Math.round(TAU / angle);
    if (order < 2 || Math.abs(TAU / order - angle) > 0.02) continue;
    let d = axis;
    if (d[1] < -1e-6 || (Math.abs(d[1]) <= 1e-6 && (d[0] < -1e-6 || (Math.abs(d[0]) <= 1e-6 && d[2] < 0)))) d = [-d[0], -d[1], -d[2]];
    const hit = out.find(a => Math.abs(dot(a.dir, d)) > cosT);
    if (hit) hit.order = Math.max(hit.order, order);
    else out.push({ order, dir: d });
  }
  return out.sort((a, b) => b.order - a.order || b.dir[1] - a.dir[1]);
}
export function axisCounts(axes) {
  const c = {};
  for (const a of axes) c[a.order] = (c[a.order] || 0) + 1;
  return c;
}

// ── units ──────────────────────────────────────────────────────────────────
// The centroid of each unit (copy k, chain c) -> index k * nChains + c.
export function unitCentroids(d, ops) {
  const nc = d.info.chains.length, m = ops.length / 12;
  const sum = new Float64Array(4 * nc);
  for (let i = 0; i < d.n; i++) {
    const c = d.chain[i];
    sum[4 * c] += d.pos[3 * i]; sum[4 * c + 1] += d.pos[3 * i + 1]; sum[4 * c + 2] += d.pos[3 * i + 2]; sum[4 * c + 3]++;
  }
  const out = new Float32Array(3 * nc * m);
  for (let k = 0; k < m; k++) for (let c = 0; c < nc; c++) {
    const w = sum[4 * c + 3] || 1, x = sum[4 * c] / w, y = sum[4 * c + 1] / w, z = sum[4 * c + 2] / w, o = 12 * k, u = 3 * (k * nc + c);
    out[u] = ops[o] * x + ops[o + 1] * y + ops[o + 2] * z + ops[o + 3];
    out[u + 1] = ops[o + 4] * x + ops[o + 5] * y + ops[o + 6] * z + ops[o + 7];
    out[u + 2] = ops[o + 8] * x + ops[o + 9] * y + ops[o + 10] * z + ops[o + 11];
  }
  return out;
}

// The largest bead distance from the origin over all copies (nm), and the
// extent along each axis. step skips beads (a quick estimate for big sets).
export function bounds(d, ops, step = 1) {
  const m = ops.length / 12;
  let r = 0; const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < m; k++) {
    const o = 12 * k;
    for (let i = 0; i < d.n; i += step) {
      const x = d.pos[3 * i], y = d.pos[3 * i + 1], z = d.pos[3 * i + 2];
      const X = ops[o] * x + ops[o + 1] * y + ops[o + 2] * z + ops[o + 3];
      const Y = ops[o + 4] * x + ops[o + 5] * y + ops[o + 6] * z + ops[o + 7];
      const Z = ops[o + 8] * x + ops[o + 9] * y + ops[o + 10] * z + ops[o + 11];
      r = Math.max(r, X * X + Y * Y + Z * Z);
      if (X < lo[0]) lo[0] = X; if (Y < lo[1]) lo[1] = Y; if (Z < lo[2]) lo[2] = Z;
      if (X > hi[0]) hi[0] = X; if (Y > hi[1]) hi[1] = Y; if (Z > hi[2]) hi[2] = Z;
    }
  }
  return { r: Math.sqrt(r), size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], lo, hi };
}

// ── animation timing ───────────────────────────────────────────────────────
// The start of each unit in the assembly, 0..1.
//   icosa   one pentamer region at a time: the 5-fold axes from the top
//           down, and around each axis by azimuth
//   helix   a rod (TMV) grows both ways from an origin near one end, faster
//           toward the long end; a fibril grows from a seed in the middle
//           out to both ends
//   other   cyclic copies one by one; one-copy models chain by chain, by
//           height (the HIV cone grows from its narrow end)
export function assemblyDelays(kind, cent, nChains, opts = {}) {
  const U = cent.length / 3, out = new Float32Array(U);
  if (kind === 'icosa') {
    const fives = (opts.axes || []).filter(a => a.order === 5).map(a => a.dir);
    const both = [];
    for (const d of fives) { both.push(d); both.push([-d[0], -d[1], -d[2]]); }
    both.sort((a, b) => b[1] - a[1] || Math.atan2(a[2], a[0]) - Math.atan2(b[2], b[0]));
    const G = both.length || 1;
    for (let u = 0; u < U; u++) {
      const p = norm([cent[3 * u], cent[3 * u + 1], cent[3 * u + 2]]);
      let g = 0, best = -2;
      both.forEach((a, i) => { const c = dot(a, p); if (c > best) { best = c; g = i; } });
      const a = both[g] || [0, 1, 0];
      // azimuth of p around the axis a
      const ref = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const e1 = norm([ref[1] * a[2] - ref[2] * a[1], ref[2] * a[0] - ref[0] * a[2], ref[0] * a[1] - ref[1] * a[0]]);
      const e2 = [a[1] * e1[2] - a[2] * e1[1], a[2] * e1[0] - a[0] * e1[2], a[0] * e1[1] - a[1] * e1[0]];
      const az = (Math.atan2(dot(p, e2), dot(p, e1)) + Math.PI) / TAU;
      out[u] = Math.min(0.999, (g + 0.85 * az) / G);
    }
    return out;
  }
  if (kind === 'helix') {
    const layers = U / nChains;
    const o = opts.fibril ? (layers - 1) / 2 : Math.round((layers - 1) * 0.16);
    for (let u = 0; u < U; u++) {
      const k = Math.floor(u / nChains);
      let t;
      if (opts.fibril) t = Math.abs(k - o) / Math.max(1, o);
      else t = k >= o ? (k - o) / Math.max(1, layers - 1 - o) : (o - k) / Math.max(1, o);
      out[u] = Math.min(0.999, t);
    }
    return out;
  }
  if (kind === 'cyclic') {
    const m = U / nChains;
    for (let u = 0; u < U; u++) out[u] = (Math.floor(u / nChains) + 0.5 * (u % nChains) / nChains) / m;
    return out;
  }
  // one copy: by height
  let lo = Infinity, hi = -Infinity;
  for (let u = 0; u < U; u++) { lo = Math.min(lo, cent[3 * u + 1]); hi = Math.max(hi, cent[3 * u + 1]); }
  for (let u = 0; u < U; u++) out[u] = Math.min(0.999, (cent[3 * u + 1] - lo) / Math.max(1e-6, hi - lo));
  return out;
}

// The direction each unit flies in the assembly and the explode.
//   icosa  its nearest 5-fold axis, so a pentamer region moves as a block
//   rod    out from the axis; a fibril layer along the axis, away from the
//          middle (so the fibril stretches into its layers)
//   other  out from the centre
export function explodeDirs(kind, cent, opts = {}) {
  const U = cent.length / 3, out = new Float32Array(3 * U);
  const fives = (opts.axes || []).filter(a => a.order === 5).map(a => a.dir);
  for (let u = 0; u < U; u++) {
    const c = [cent[3 * u], cent[3 * u + 1], cent[3 * u + 2]];
    let d;
    if (kind === 'icosa' && fives.length) {
      const p = norm(c); let best = -2; d = [0, 1, 0];
      for (const a of fives) { const v = dot(a, p); if (Math.abs(v) > best) { best = Math.abs(v); d = v >= 0 ? a : [-a[0], -a[1], -a[2]]; } }
      d = norm([d[0] * 0.8 + p[0] * 0.2, d[1] * 0.8 + p[1] * 0.2, d[2] * 0.8 + p[2] * 0.2]);
    } else if (kind === 'helix' && opts.fibril) d = [0, c[1] >= 0 ? 1 : -1, 0];
    else if (kind === 'helix') d = norm([c[0], 0, c[2]]);
    else d = Math.hypot(...c) > 1e-6 ? norm(c) : [0, 1, 0];
    out.set(d, 3 * u);
  }
  return out;
}

// The arrival of one unit, as the vertex shader computes it:
// p = easeInOut((t - delay * spread) / (1 - spread)), t in 0..1.
export const ASM_SPREAD = 0.78;
export function unitProgress(t, delay, spread = ASM_SPREAD) {
  return easeInOut((t - delay * spread) / (1 - spread));
}

// ── envelope (illustration) ────────────────────────────────────────────────
// Points spread evenly on a unit sphere.
export function fibonacciSphere(n) {
  const out = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * g;
    out.push([r * Math.cos(a), y, r * Math.sin(a)]);
  }
  return out;
}
// Rotation (3x3 rows) that takes +y to n, then turns by spin about n.
function frameY(n, spin) {
  const v = [n[2], 0, -n[0]], s = Math.hypot(v[0], v[2]), c = n[1];
  let R;
  if (s < 1e-9) R = c > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, 0, 0, 0, -1];
  else {
    const k = [v[0] / s, 0, v[2] / s], a = Math.atan2(s, c), ca = Math.cos(a), sa = Math.sin(a);
    // Rodrigues about k (k is in the xz plane)
    R = [ca + k[0] * k[0] * (1 - ca), -k[2] * sa, k[0] * k[2] * (1 - ca),
      k[2] * sa, ca, -k[0] * sa,
      k[2] * k[0] * (1 - ca), k[0] * sa, ca + k[2] * k[2] * (1 - ca)];
  }
  // spin about the local y first: R * Ry(spin)
  const cs = Math.cos(spin), sn = Math.sin(spin), S = [cs, 0, sn, 0, 1, 0, -sn, 0, cs], o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) for (let j = 0; j < 3; j++) o[3 * r + q] += R[3 * r + j] * S[3 * j + q];
  return o;
}
// spec: { R (membrane radius, nm), parts: [{ count, base (nm, the lowest
// y of the protein), stalk (nm) }], tilt (rad) }
// -> { ops: [Float32Array per part], stalks: [[x0,y0,z0,x1,y1,z1] ...],
//      phase: [Float32Array per part] }
// A spike stands on the sphere: its local +y goes along the (tilted)
// normal, and its base sits at the top of a stalk that starts on the
// membrane.
export function envelopeOps(spec, rng) {
  const total = spec.parts.reduce((a, p) => a + p.count, 0);
  const pts = fibonacciSphere(total);
  const owner = [];
  spec.parts.forEach((p, i) => { for (let k = 0; k < p.count; k++) owner.push(i); });
  for (let i = owner.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [owner[i], owner[j]] = [owner[j], owner[i]]; }
  const ops = spec.parts.map(p => new Float32Array(12 * p.count)), phase = spec.parts.map(p => new Float32Array(p.count));
  const fill = spec.parts.map(() => 0), stalks = [];
  const jit = Math.PI / Math.sqrt(total) * 0.35;
  pts.forEach((p0, i) => {
    const w = owner[i], part = spec.parts[w];
    // a small jitter keeps the lattice from looking regular
    const n0 = norm([p0[0] + (rng() - 0.5) * jit, p0[1] + (rng() - 0.5) * jit, p0[2] + (rng() - 0.5) * jit]);
    const tl = (spec.tilt || 0) * Math.sqrt(rng()), ta = rng() * TAU;
    const t1 = norm(Math.abs(n0[1]) < 0.9 ? [n0[2], 0, -n0[0]] : [1, 0, 0]);
    const t2 = [n0[1] * t1[2] - n0[2] * t1[1], n0[2] * t1[0] - n0[0] * t1[2], n0[0] * t1[1] - n0[1] * t1[0]];
    const n = norm([n0[0] + Math.tan(tl) * (Math.cos(ta) * t1[0] + Math.sin(ta) * t2[0]),
      n0[1] + Math.tan(tl) * (Math.cos(ta) * t1[1] + Math.sin(ta) * t2[1]),
      n0[2] + Math.tan(tl) * (Math.cos(ta) * t1[2] + Math.sin(ta) * t2[2])]);
    const R = frameY(n, rng() * TAU);
    const foot = [n0[0] * spec.R, n0[1] * spec.R, n0[2] * spec.R];
    const top = [foot[0] + n[0] * part.stalk, foot[1] + n[1] * part.stalk, foot[2] + n[2] * part.stalk];
    // bead y = base goes to top: t = top - R (0, base, 0)
    const t = [top[0] - R[1] * part.base, top[1] - R[4] * part.base, top[2] - R[7] * part.base];
    const k = fill[w]++;
    ops[w].set([R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2]], 12 * k);
    phase[w][k] = rng() * TAU;
    if (part.stalk > 0) stalks.push([...foot, ...top]);
  });
  return { ops, stalks, phase };
}

// ── the scale ladder ───────────────────────────────────────────────────────
// Marks on a log scale from 0.1 nm to 10 um. nm values. A mark with
// 'entry' is a structure on this page; the rest are labels for scale.
export const LADDER_MARKS = [
  { nm: 0.154, label: 'C–C bond' },
  { nm: 0.48, label: 'cross-β layer spacing' },
  { nm: 2, label: 'DNA helix width' },
  { nm: 10, label: 'antibody (IgG)' },
  { nm: 200, label: 'light microscope limit' },
  { nm: 2000, label: 'E. coli bacterium' },
  { nm: 7500, label: 'red blood cell' },
];
export const LADDER_LO = 0.1, LADDER_HI = 10000;
export function ladderX(nm, lo = LADDER_LO, hi = LADDER_HI) {
  return clamp01(Math.log(nm / lo) / Math.log(hi / lo));
}

// items [{ key, size (nm, the largest extent) }] in size order. Each item
// gets a centre x; the gap to the next one grows with its size.
export function lineupLayout(items) {
  const out = []; let x = 0;
  items.forEach((it, i) => {
    if (i > 0) x += items[i - 1].size / 2 + Math.max(2, 0.45 * it.size) + it.size / 2;
    out.push({ key: it.key, size: it.size, x });
  });
  return out;
}
// The camera of the ladder zoom at u in 0..1: the view width w (nm) grows
// on a log scale from the first item to the last, and x follows the item
// whose size fits that width.
export const LADDER_FIT = 2.4;
export function ladderView(u, layout) {
  const n = layout.length;
  const lw = layout.map(it => Math.log(it.size * LADDER_FIT));
  const L = lw[0] + (lw[n - 1] - lw[0]) * clamp01(u);
  let i = 0;
  while (i < n - 2 && L > lw[i + 1]) i++;
  const t = n > 1 ? clamp01((L - lw[i]) / Math.max(1e-9, lw[i + 1] - lw[i])) : 0;
  const s = smooth(t);
  const x = n > 1 ? layout[i].x + (layout[i + 1].x - layout[i].x) * s : layout[0].x;
  return { width: Math.exp(L), x, i, t };
}

// ── ruler ──────────────────────────────────────────────────────────────────
// The longest 1-2-5 length (nm) that fits in maxPx at nmPerPx.
export function niceRuler(nmPerPx, maxPx = 120) {
  const maxNm = nmPerPx * maxPx;
  let p = Math.pow(10, Math.floor(Math.log10(maxNm))), nm = p;
  for (const m of [5, 2, 1]) if (m * p <= maxNm) { nm = m * p; break; }
  const label = nm >= 1000 ? (nm / 1000) + ' µm' : nm >= 1 ? nm + ' nm' : (Math.round(nm * 100) / 10) + ' Å';
  return { nm, px: nm / nmPerPx, label };
}

// ── saver ──────────────────────────────────────────────────────────────────
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next, range: (lo, hi) => lo + (hi - lo) * next(), int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    shuffle(arr) { const b = arr.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; },
  };
}
// The length of one saver shot: 5 to 12 s; calm 1 gives the long end.
export function shotSeconds(calm, r, weight = 1) {
  const c = clamp01(calm), base = 5 + 7 * (0.55 * c + 0.45 * clamp01(r));
  return Math.max(5, Math.min(12, base * weight));
}

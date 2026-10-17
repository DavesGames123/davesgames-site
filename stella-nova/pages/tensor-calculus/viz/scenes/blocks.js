// ============================================================================
//  TENSOR CALCULUS  ·  viz/scenes/blocks.js  ·  components as blocks  (VIZ)
// ----------------------------------------------------------------------------
//  A Components object ({ shape, variance, data }) is drawn as a block of
//  cubes, one per component: the cube size goes with sqrt|value|, warm for
//  a positive value and cool for a negative one. Slot layout: a rank-1
//  upper tensor is a column, a rank-1 lower tensor a row. Rank 2: slot 0
//  down the rows, slot 1 along the columns. Rank 3: slot 2 into the depth.
//  Rank 4: a grid of small grids. Each slot has a rail in the colour of its
//  index: an arrow rail for an upper slot, a rail of small planes for a
//  lower slot (the same language as the vector and covector glyphs).
//
//  outer-product  u^i w_j -> T^i_j: each cell lights up when the beams
//      from u^i and w_j meet.
//  contraction  A block collapses along two matched slots: the cells off
//      the diagonal fade, the diagonal cells slide together and add up.
//      Modes: trace (T^i_i), matvec (A^i_j v^j as product then contract),
//      rank3 (A^i_ij... -> B_k). With a step, the slots are found from the
//      numbers (findContraction).
//  rank3-cube  A 3x3x3 cube (epsilon, Christoffel symbols of spherical
//      coordinates, or random) with a slab that sweeps through it and
//      lifts one slice out as a matrix.
//  levi-civita  The epsilon cube beside a parallelepiped a, b, c: its
//      signed volume is eps_ijk a^i b^j c^k, and its colour turns when c
//      passes through the plane of a and b. The cross product
//      (a x b)_i = eps_ijk a^j b^k is the arrow.
//  components  Any step: the input blocks morph into the output block.
//
//  DOM-free helpers for tests: grep -n "export function"
// ============================================================================
import { LOOK, tn, num, ic, signColor } from '../look.js';
import { AX } from './basis.js';
import { add, sub, scl, dot, cross, len, unit, wave, seg, ease, clamp, lerp3, rng, mat3Det } from '../vmath.js';

const SP = 0.62;

// ---- Components helpers -------------------------------------------------------
export function comp(shape, variance, data) { return { shape: shape.slice(), variance: variance.slice(), data: Float64Array.from(data) }; }
export function strides(shape) { const s = []; let k = 1; for (let i = shape.length - 1; i >= 0; i--) { s[i] = k; k *= shape[i]; } return s; }
export function* tuples(shape) {
  const n = shape.reduce((a, b) => a * b, 1), idx = shape.map(() => 0);
  for (let k = 0; k < n; k++) { yield idx.slice(); for (let d = shape.length - 1; d >= 0; d--) { if (++idx[d] < shape[d]) break; idx[d] = 0; } }
}
export function at(c, idx) { const s = strides(c.shape); let o = 0; for (let i = 0; i < idx.length; i++) o += idx[i] * s[i]; return c.data[o]; }
export function outer(a, b) {
  const out = comp(a.shape.concat(b.shape), a.variance.concat(b.variance), new Float64Array(a.data.length * b.data.length));
  for (let i = 0; i < a.data.length; i++) for (let j = 0; j < b.data.length; j++) out.data[i * b.data.length + j] = a.data[i] * b.data[j];
  return out;
}
export function contractC(c, a, b) {
  const keep = c.shape.map((_, k) => k).filter(k => k !== a && k !== b);
  const out = comp(keep.map(k => c.shape[k]), keep.map(k => c.variance[k]), new Float64Array(Math.max(1, keep.reduce((s, k) => s * c.shape[k], 1))));
  const full = new Array(c.shape.length);
  let o = 0;
  for (const idx of tuples(out.shape)) {
    keep.forEach((k, q) => { full[k] = idx[q]; });
    let s = 0;
    for (let m = 0; m < c.shape[a]; m++) { full[a] = m; full[b] = m; s += at(c, full); }
    out.data[o++] = s;
  }
  return out;
}
// The pair of slots (a, b) whose contraction gives out, or null.
export function findContraction(input, out) {
  const r = input.shape.length;
  let best = null;
  for (let a = 0; a < r; a++) for (let b = a + 1; b < r; b++) {
    if (input.shape[a] !== input.shape[b]) continue;
    const c = contractC(input, a, b);
    if (c.data.length !== out.data.length) continue;
    let err = 0;
    for (let i = 0; i < c.data.length; i++) err += Math.abs(c.data[i] - out.data[i]);
    const opp = input.variance[a] !== input.variance[b] ? 0 : 1e-9;
    if (err < 1e-6 * (1 + c.data.length) && (!best || err + opp < best.err)) best = { a, b, err: err + opp };
  }
  return best ? [best.a, best.b] : null;
}
// Index syms of a named factor in a TensorExpr (or null).
export function factorSyms(expr, name) {
  if (!expr || !expr.terms) return null;
  for (const t of expr.terms) for (const f of t.factors || []) if (f.name === name || f.tex === name) return (f.indices || []).map(i => i.sym);
  return null;
}
const DEFAULT_SYMS = ['i', 'j', 'k', 'l'];

// The position of a cell in a block laid out at centre c0.
export function cellPos(shape, variance, idx, c0 = [0, 0, 0], sp = SP) {
  const r = shape.length, h = n => (n - 1) / 2;
  if (r === 0) return c0.slice();
  if (r === 1) return variance[0] === 'u' ? add(c0, [0, -(idx[0] - h(shape[0])) * sp, 0]) : add(c0, [(idx[0] - h(shape[0])) * sp, 0, 0]);
  if (r === 2) return add(c0, [(idx[1] - h(shape[1])) * sp, -(idx[0] - h(shape[0])) * sp, 0]);
  if (r === 3) return add(c0, [(idx[1] - h(shape[1])) * sp, -(idx[0] - h(shape[0])) * sp, -(idx[2] - h(shape[2])) * sp]);
  // Rank 4 and up: slots nest on y (even slots, rows) and x (odd slots,
  // columns). A slot steps by the span of the deeper slots on its axis.
  let x = 0, y = 0;
  for (let k = 0; k < r; k++) {
    const d = (idx[k] - h(shape[k])) * slotStride(shape, k, sp);
    if (k % 2) x += d; else y -= d;
  }
  return add(c0, [x, y, 0]);
}
// The step of slot k for rank 4 and up: sp times the padded size of each
// deeper slot on the same axis (rank 4 gives the old big and small steps).
function slotStride(shape, k, sp = SP) {
  if (shape.length < 4) return sp;
  let st = sp;
  for (let t = k + 2; t < shape.length; t += 2) st *= shape[t] + 0.8;
  return st;
}
// The direction of slot s in the layout (unit), for the rails.
function slotDir(shape, variance, s) {
  const r = shape.length;
  if (r === 1) return variance[0] === 'u' ? [0, -1, 0] : [1, 0, 0];
  if (r >= 4) return s % 2 ? [1, 0, 0] : [0, -1, 0];
  return [[0, -1, 0], [1, 0, 0], [0, 0, -1], [1, 0, 0]][s];
}
const maxAbs = c => { let m = 0; for (const v of c.data) m = Math.max(m, Math.abs(v)); return m || 1; };

// Draw a block. o: { c0, name, syms, a, scale (0..1 grows the cubes),
// labels (true), m (value for the full colour), hide(idx) -> alpha factor,
// glow(idx) -> 0..1 }
export function drawBlock(dl, C, o = {}) {
  const c0 = o.c0 || [0, 0, 0], syms = o.syms || DEFAULT_SYMS, a = o.a ?? 1, sc = o.scale ?? 1, m = o.m ?? maxAbs(C);
  const sp = o.sp ?? SP;
  const n = C.data.length;
  let k = 0;
  for (const idx of tuples(C.shape)) {
    const v = C.data[k++];
    const f = o.hide ? o.hide(idx) : 1;
    if (f * a < 0.01) continue;
    const p = cellPos(C.shape, C.variance, idx, c0, sp);
    const s = sp * 0.42 * sc * Math.max(0.12, Math.sqrt(Math.min(1, Math.abs(v) / m)));
    const g = o.glow ? o.glow(idx) : 0;
    const col = signColor(v, m);
    const cc = g > 0 ? [col[0] + (1 - col[0]) * g * 0.5, col[1] + (1 - col[1]) * g * 0.5, col[2] + (1 - col[2]) * g * 0.5] : col;
    dl.box(p, [s, s, s], cc, { a: a * f, edge: true, edgeC: cc, edgeA: 0.6 * a * f, edgeW: 1 });
    // a faint frame of the full cell
    dl.box(p, [sp * 0.45, sp * 0.45, sp * 0.45], LOOK.gridDim, { a: 0.0, edge: o.frame !== false, edgeA: 0.12 * a * f, edgeW: 1 });
    if (o.labels !== false && n <= 27 && f * a > 0.3) dl.label(add(p, [0, 0, sp * 0.5]), num(v, Math.abs(v) >= 10 ? 0 : 1), { c: LOOK.ink, size: 11, a: 0.85 * a * f });
  }
  // rails
  const r = C.shape.length;
  for (let s = 0; s < r; s++) {
    const d = slotDir(C.shape, C.variance, s), len0 = (C.shape[s] - 1) * slotStride(C.shape, s, sp) + sp;
    const sym = syms[s] || DEFAULT_SYMS[s];
    // place the rail on the outside: rows on the left, columns on top, depth at the right base
    const side = r === 1 ? (C.variance[0] === 'u' ? [-1, 0, 0] : [0, 1, 0]) : [[-1, 0, 0], [0, 1, 0], [1, -1, 0], [0, -1, 0]][s % 4];
    const ext = halfExtent(C, sp);
    const base = add(c0, [side[0] * (ext[0] + sp * 0.45), side[1] * (ext[1] + sp * 0.45), 0]);
    const A = sub(base, scl(d, len0 / 2)), B = add(base, scl(d, len0 / 2));
    const col = ic(sym);
    if (C.variance[s] === 'u') dl.arrow(A, sub(B, A), col, { r: 0.018, a: a, sym });
    else {
      dl.seg(A, B, col, { w: 2, a: a, sym });
      const nT = Math.max(2, C.shape[s] * 2);
      const pu = Math.abs(d[1]) > 0.5 ? [0.09, 0, 0] : [0, 0.09, 0];
      for (let t = 0; t <= nT; t++) dl.quad(lerp3(A, B, t / nT), pu, [0, 0, 0.09], col, { a: 0.35 * a, sym, edge: true, edgeA: 0.8 * a, edgeW: 1 });
    }
    const up = C.variance[s] === 'u';
    dl.label(add(B, scl(d, 0.22)), `<span style="font-size:.8em;opacity:.8">${up ? 'upper' : 'lower'}</span> ${tn('', up ? [sym] : [], up ? [] : [sym])}`.replace('<i></i>', ''), { c: col, size: 15, a, sym });
  }
  if (o.name) {
    const ext = halfExtent(C, sp);
    dl.label(add(c0, [0, -(ext[1] + sp * 1.1), 0]), o.name, { c: LOOK.ink, size: 17, a });
  }
}
function halfExtent(C, sp) {
  const r = C.shape.length;
  let x = 0, y = 0;
  for (const idx of [C.shape.map(() => 0), C.shape.map(n => n - 1)]) {
    const p = cellPos(C.shape, C.variance, idx, [0, 0, 0], sp);
    x = Math.max(x, Math.abs(p[0])); y = Math.max(y, Math.abs(p[1]));
  }
  if (r === 0) return [0, 0];
  return [x, y];
}

// A smooth random component field: data that drifts with time, seeded.
function drift(n, time, seed, period = 14) {
  const k = Math.floor(time / period), u = ease((time % period) / period * 3 - 1.6);
  const A = rng(seed + k * 7919), B = rng(seed + (k + 1) * 7919);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) { const a = Math.round((A() * 2 - 1) * 9) / 3, b = Math.round((B() * 2 - 1) * 9) / 3; out[i] = a + (b - a) * u; }
  return out;
}

// ---- outer product ------------------------------------------------------------
export const outerProduct = {
  id: 'outer-product',
  label: 'Tensor product',
  blurb: 'u^i w_j = T^i_j: every component of one meets every component of the other.',
  params: [{ key: 'n', label: 'dimension', min: 2, max: 4, step: 1, def: 3 }],
  camera: { pos: [1.3, 1.6, 7.0], target: [-0.45, 0.45, 0], fov: 40 },
  fog: 0.03,
  frame(dl, S) {
    const T = S.time, n = S.p.n ?? 3;
    let u, w, names = ['u', 'w'], syms = ['i', 'j'];
    const num0 = S.step && S.step.numeric;
    if (num0 && num0.inputs) {
      const ins = Object.entries(num0.inputs);
      if (ins.length >= 2) {
        [names[0], u] = ins[0]; [names[1], w] = ins[1];
        const s0 = factorSyms(S.step.before, names[0]), s1 = factorSyms(S.step.before, names[1]);
        syms = [...(s0 || ['i']), ...(s1 || ['j'])];
      }
    }
    if (!u || u.shape.length !== 1 || w.shape.length !== 1) {
      u = comp([n], ['u'], drift(n, T, 11)); w = comp([n], ['d'], drift(n, T, 23));
    }
    const P = outer(u, w);
    const prog = S.t != null ? S.t : seg(T % 14, 0.5, 9);
    const nn = P.data.length;
    const c0 = [0, 0, 0];
    const ext = [(P.shape[1] - 1) * SP / 2, (P.shape[0] - 1) * SP / 2];
    const uc = [-ext[0] - 1.6, 0, 0], wc = [0, ext[1] + 1.4, 0];
    drawBlock(dl, u, { c0: uc, syms: [syms[0]], name: tn(names[0], [syms[0]]), labels: true });
    drawBlock(dl, w, { c0: wc, syms: [syms[1]], name: '', labels: true });
    dl.label(add(wc, [ext[0] + 0.9, 0.25, 0]), tn(names[1], [], [syms[1]]), { c: LOOK.ink, size: 17 });
    // cells appear in reading order, with beams from u^i and w_j
    const m = maxAbs(P);
    let k = 0;
    for (const idx of tuples(P.shape)) {
      const t0 = (k / nn) * 0.8, f = seg(prog, t0, t0 + 0.2);
      const p = cellPos(P.shape, P.variance, idx, c0);
      if (f > 0.01 && f < 0.999) {
        const pu = cellPos(u.shape, u.variance, [idx[0]], uc), pw = cellPos(w.shape, w.variance, [idx[1]], wc);
        dl.seg(pu, p, ic(syms[0]), { w: 2, a: 0.8 * (1 - f) + 0.2, sym: syms[0] });
        dl.seg(pw, p, ic(syms[1]), { w: 2, a: 0.8 * (1 - f) + 0.2, sym: syms[1] });
      }
      k++;
    }
    drawBlock(dl, P, { c0, syms, m, scale: 1, hide: idx => { const kk = idx[0] * P.shape[1] + idx[1]; return seg(prog, (kk / nn) * 0.8, (kk / nn) * 0.8 + 0.2); } });
    dl.label(null, `${tn('T', [syms[0]], [syms[1]])} = ${tn(names[0], [syms[0]])} ${tn(names[1], [], [syms[1]])}`, { screen: [0.5, 0.06], size: 18, c: LOOK.ink });
    dl.read('progress', prog); dl.read('cells', nn);
  },
};

// ---- contraction ----------------------------------------------------------------
export const contraction = {
  id: 'contraction',
  label: 'Contraction',
  blurb: 'Pair an upper with a lower index and sum: the block collapses along the matched axes.',
  params: [{ key: 'mode', label: 'example', options: ['trace', 'matvec', 'rank3'], def: null }],
  camera: { pos: [2.0, 2.3, 7.0], target: [0.8, -0.1, -0.3], fov: 40 },
  fog: 0.03,
  frame(dl, S) {
    const T = S.time, cyc = Math.floor(T / 14);
    let mode = S.p.mode ?? ['matvec', 'trace', 'rank3'][cyc % 3];
    let X, pair, syms, name = 'A', outName = 'B', title;
    const nm = S.step && S.step.numeric;
    if (nm && nm.output && nm.inputs) {
      const ins = Object.entries(nm.inputs);
      let Xin = ins.length === 1 ? ins[0][1] : ins.length >= 2 ? outer(ins[0][1], ins[1][1]) : null;
      if (Xin) {
        const pr = findContraction(Xin, nm.output);
        if (pr) {
          X = Xin; pair = pr; name = ins.map(e => e[0]).join('');
          const ss = ins.flatMap(([nmn, c]) => factorSyms(S.step.before, nmn) || c.shape.map((_, q) => DEFAULT_SYMS[q]));
          syms = ss.length === X.shape.length ? ss : X.shape.map((_, q) => DEFAULT_SYMS[q]);
          title = S.step.label || '';
          mode = 'step';
        }
      }
    }
    if (!X) {
      if (mode === 'trace') { X = comp([3, 3], ['u', 'd'], drift(9, T, 5)); pair = [0, 1]; syms = ['i', 'i']; title = `${tn('A', ['i'], ['i'])} = trace`; }
      else if (mode === 'rank3') { X = comp([3, 3, 3], ['u', 'd', 'd'], drift(27, T, 9)); pair = [0, 1]; syms = ['i', 'i', 'k']; title = `${tn('B', [], ['k'])} = ${tn('A', ['i'], ['i', 'k'])}`; }
      else { X = outer(comp([3, 3], ['u', 'd'], drift(9, T, 3)), comp([3], ['u'], drift(3, T, 7))); pair = [1, 2]; syms = ['i', 'j', 'j']; title = `${tn('w', ['i'])} = ${tn('A', ['i'], ['j'])}${tn('v', ['j'])}`; }
    }
    const out = contractC(X, pair[0], pair[1]);
    const prog = S.t != null ? S.t : seg(T % 14, 0.5, 11);
    const m = Math.max(maxAbs(X), maxAbs(out) * 0.6);
    const c0 = [-0.9, 0, 0];
    const outC = [2.6, 0, 0];
    const keep = X.shape.map((_, k) => k).filter(k => k !== pair[0] && k !== pair[1]);
    const p1 = seg(prog, 0, 0.3), p2 = seg(prog, 0.3, 0.75), p3 = seg(prog, 0.7, 1);
    // the block: off-diagonal cells fade, diagonal cells glow then slide
    drawBlock(dl, X, { c0, syms, m, hide: idx => idx[pair[0]] === idx[pair[1]] ? 1 - p2 : 1 - 0.85 * p1 - 0.15 * p2,
      glow: idx => idx[pair[0]] === idx[pair[1]] ? p1 : 0, labels: X.data.length <= 27 });
    // moving diagonal cells
    if (p2 > 0 && p3 < 1) {
      for (const idx of tuples(X.shape)) {
        if (idx[pair[0]] !== idx[pair[1]]) continue;
        const v = at(X, idx);
        const from = cellPos(X.shape, X.variance, idx, c0);
        const oi = keep.map(k => idx[k]);
        const to = cellPos(out.shape, out.variance, oi, outC);
        const pos = lerp3(from, to, p2);
        const s = SP * 0.42 * Math.max(0.12, Math.sqrt(Math.min(1, Math.abs(v) / m)));
        dl.box(add(pos, [0, Math.sin(Math.PI * p2) * 0.4 * (idx[pair[0]] - 1), 0]), [s, s, s], signColor(v, m), { a: 1 - p3, edge: true, edgeA: 0.5 });
      }
    }
    // the sum block
    const sym0 = syms[pair[0]];
    drawBlock(dl, out, { c0: outC, syms: keep.map(k => syms[k]), m, scale: p3, a: Math.max(0.15, p3), name: '' });
    // the matched index: a bright bracket between the two rails
    dl.label(add(c0, [0, -1.6, 0]), `Σ over ${tn('', [sym0], [sym0]).replace('<i></i>', '')}`, { c: ic(sym0), size: 16, sym: sym0, a: 0.4 + 0.6 * p1 });
    dl.label(null, title, { screen: [0.5, 0.06], size: 18, c: LOOK.ink });
    if (out.data.length === 1) dl.label(add(outC, [0, 0.55, 0]), `= ${num(out.data[0])}`, { c: LOOK.gold, size: 18, a: p3 });
    dl.read('pairA', pair[0]); dl.read('pairB', pair[1]); dl.read('progress', prog);
    dl.read('sum0', out.data[0]);
  },
};

// ---- rank-3 cube ----------------------------------------------------------------
export function sphericalGamma(r, th) {
  // Gamma^k_ij of spherical coordinates (r, th, ph), as a [3,3,3] u,d,d block
  const G = new Float64Array(27), s = (k, i, j, v) => { G[k * 9 + i * 3 + j] = v; G[k * 9 + j * 3 + i] = v; };
  s(0, 1, 1, -r); s(0, 2, 2, -r * Math.sin(th) ** 2);
  s(1, 0, 1, 1 / r); s(1, 2, 2, -Math.sin(th) * Math.cos(th));
  s(2, 0, 2, 1 / r); s(2, 1, 2, Math.cos(th) / Math.sin(th));
  return comp([3, 3, 3], ['u', 'd', 'd'], G);
}
export function epsilon3() {
  const e = new Float64Array(27);
  for (const [i, j, k, s] of [[0, 1, 2, 1], [1, 2, 0, 1], [2, 0, 1, 1], [0, 2, 1, -1], [2, 1, 0, -1], [1, 0, 2, -1]]) e[i * 9 + j * 3 + k] = s;
  return comp([3, 3, 3], ['d', 'd', 'd'], e);
}

export const rank3Cube = {
  id: 'rank3-cube',
  label: 'A rank-3 component cube',
  blurb: 'Three indices, three axes: a slab sweeps through the cube and lifts out one slice.',
  params: [
    { key: 'tensor', label: 'tensor', options: ['christoffel', 'epsilon', 'random'], def: null },
    { key: 'axis', label: 'slice axis', min: 0, max: 2, step: 1, def: null },
  ],
  camera: { pos: [2.2, 2.6, 6.6], target: [1.0, 0, 0], fov: 40 },
  fog: 0.035,
  frame(dl, S) {
    const T = S.time, cyc = Math.floor(T / 27);
    const kind = S.p.tensor ?? ['christoffel', 'epsilon', 'random'][cyc % 3];
    let C, name, syms;
    if (kind === 'epsilon') { C = epsilon3(); name = 'ε'; syms = ['i', 'j', 'k']; }
    else if (kind === 'random') { C = comp([3, 3, 3], ['u', 'd', 'u'], drift(27, T, 31, 27)); name = 'Q'; syms = ['i', 'j', 'k']; }
    else { C = sphericalGamma(1.5, 0.9 + 0.3 * Math.sin(T * 0.2)); name = 'Γ'; syms = ['k', 'i', 'j']; }
    const axis = S.p.axis ?? Math.floor(T / 9) % 3;
    const u = S.t != null ? S.t : (T % 9) / 9;
    const which = Math.min(2, Math.floor(u * 3));
    const lift = Math.sin(Math.PI * ((u * 3) % 1));
    const c0 = [-0.6, 0, 0];
    drawBlock(dl, C, { c0, syms, hide: idx => idx[axis] === which ? 1 - 0.75 * lift : 0.55, glow: idx => idx[axis] === which ? 0.6 : 0, labels: false });
    // the slab
    const pc = cellPos(C.shape, C.variance, [1, 1, 1].map((v, k) => k === axis ? which : 1), c0);
    const half = [SP * 1.55, SP * 1.55, SP * 1.55]; half[[1, 0, 2][axis]] = SP * 0.5;
    dl.box(pc, half, ic(syms[axis]), { a: 0.08, edge: true, edgeA: 0.6, edgeW: 1.4, sym: syms[axis] });
    // the slice, lifted out as a matrix
    const rest = [0, 1, 2].filter(k => k !== axis);
    const sl = comp([3, 3], rest.map(k => C.variance[k]), new Float64Array(9));
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { const idx = [0, 0, 0]; idx[axis] = which; idx[rest[0]] = a; idx[rest[1]] = b; sl.data[a * 3 + b] = at(C, idx); }
    const outC = [2.9, 0.2, 0.6];
    drawBlock(dl, sl, { c0: outC, syms: rest.map(k => syms[k]), m: maxAbs(C), a: 0.3 + 0.7 * lift, labels: true });
    const fixed = C.variance[axis] === 'u' ? [String(which + 1)] : [];
    const up = rest.filter(k => C.variance[k] === 'u').map(k => syms[k]), dn = rest.filter(k => C.variance[k] === 'd').map(k => syms[k]);
    const slName = tn(name, C.variance[axis] === 'u' ? [String(which + 1), ...up] : up, C.variance[axis] === 'd' ? [String(which + 1), ...dn] : dn);
    dl.label(add(outC, [0, -1.45, 0]), `${slName}`, { c: ic(syms[axis]), size: 18, a: 0.4 + 0.6 * lift });
    const full = tn(name, C.variance.map((v, k) => v === 'u' ? syms[k] : null).filter(Boolean), C.variance.map((v, k) => v === 'd' ? syms[k] : null).filter(Boolean));
    const what = { christoffel: 'Christoffel symbols of spherical coordinates', epsilon: 'the Levi-Civita symbol', random: 'a general rank-3 tensor' }[kind];
    dl.label(null, `${full}: ${what}`, { screen: [0.5, 0.06], size: 17, c: LOOK.ink });
    void fixed;
    dl.read('axis', axis); dl.read('slice', which);
  },
};

// ---- Levi-Civita orientation cube ------------------------------------------------
export function tripleEps(a, b, c) {
  const E = epsilon3();
  let s = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) s += E.data[i * 9 + j * 3 + k] * a[i] * b[j] * c[k];
  return s;
}

export const leviCivita = {
  id: 'levi-civita',
  label: 'Levi-Civita and orientation',
  blurb: 'ε_ijk a^i b^j c^k is the signed volume; it flips sign when c passes through the plane of a and b.',
  params: [{ key: 'tilt', label: 'tilt of c', min: -1, max: 1, step: 0.01, def: null }],
  camera: { pos: [1.2, 2.6, 6.0], target: [0.1, 0.2, 0], fov: 42 },
  fog: 0.03,
  frame(dl, S) {
    const T = S.time;
    const tilt = S.p.tilt ?? (S.t != null ? 1 - 2 * S.t : Math.cos(T * 0.35));
    const E = epsilon3();
    // vectors in index space (x^1, x^2, x^3) -> world (x, y, -z) is a
    // reflection, so use world = (x^1, x^3, -x^2)? Keep it a rotation:
    // world (x, y, z) = (x^1, x^3, x^2) is a reflection too. Use (x^2, x^3, x^1),
    // an even permutation, a rotation.
    const W = v => [v[1], v[2], v[0]];
    const a = [1.5, 0.15, 0.1], b = [0.25, 1.4, 0.05];
    const c = [0.35 * Math.sin(T * 0.21), 0.3 * Math.cos(T * 0.17), 1.4 * tilt];
    const vol = tripleEps(a, b, c);
    const axb = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const O = [1.3, -0.3, 0.2];
    // the parallelepiped
    const A = W(a), B = W(b), Cc = W(c);
    const col = vol >= 0 ? LOOK.pos : LOOK.neg;
    const faces = [[[0, 0, 0], A, B], [Cc, A, B], [[0, 0, 0], A, Cc], [B, A, Cc], [[0, 0, 0], B, Cc], [A, B, Cc]];
    for (const [o, u, v] of faces) {
      const p0 = add(O, o);
      dl.tri(p0, add(p0, u), add(add(p0, u), v), col, { a: 0.16 }); dl.tri(p0, add(add(p0, u), v), add(p0, v), col, { a: 0.16 });
      dl.poly([p0, add(p0, u), add(add(p0, u), v), add(p0, v)], col, { w: 1.2, a: 0.6, closed: true });
    }
    dl.arrow(O, A, AX[0], { r: 0.035, sym: 'i' }); dl.arrow(O, B, AX[1], { r: 0.035, sym: 'j' }); dl.arrow(O, Cc, AX[2], { r: 0.035, sym: 'k' });
    dl.label(add(add(O, A), [0.1, 0.12, 0]), tn('a', ['i']), { c: AX[0], size: 16, sym: 'i' });
    dl.label(add(add(O, B), [0.1, 0.12, 0]), tn('b', ['j']), { c: AX[1], size: 16, sym: 'j' });
    dl.label(add(add(O, Cc), [0.12, 0.1, 0]), tn('c', ['k']), { c: AX[2], size: 16, sym: 'k' });
    // a x b
    const X = W(axb);
    dl.arrow(O, scl(X, 0.6), LOOK.gold, { r: 0.022, a: 0.85 });
    dl.label(add(O, scl(X, 0.68)), `(a×b)<sub>${'i'}</sub> = ${tn('ε', [], ['i', 'j', 'k'])}${tn('a', ['j'])}${tn('b', ['k'])}`, { c: LOOK.gold, size: 13, anchor: 'l' });
    // the plane of a and b, faint
    dl.quad(add(O, scl(add(A, B), 0.5)), scl(A, 0.8), scl(B, 0.8), LOOK.ink, { a: 0.03, edge: true, edgeA: 0.15 });
    // the epsilon cube: each cell glows with its term a^i b^j c^k
    const c0 = [-2.2, 0.4, 0];
    const terms = [];
    drawBlock(dl, E, { c0, syms: ['i', 'j', 'k'], labels: false, frame: true,
      glow: idx => { const v = E.data[idx[0] * 9 + idx[1] * 3 + idx[2]]; if (!v) return 0; const t = Math.abs(a[idx[0]] * b[idx[1]] * c[idx[2]]); terms.push(t); return Math.min(1, t * 1.2); } });
    dl.label(add(c0, [0, -1.55, 0]), `${tn('ε', [], ['i', 'j', 'k'])}: +1 even, −1 odd, 0 repeated`, { c: LOOK.ink, size: 14 });
    dl.label(null, `${tn('ε', [], ['i', 'j', 'k'])}${tn('a', ['i'])}${tn('b', ['j'])}${tn('c', ['k'])} = det[a b c] = <b>${num(vol)}</b> &nbsp;(${vol >= 0 ? 'right-handed' : 'left-handed'})`, { screen: [0.5, 0.06], size: 17, c: col });
    dl.read('volume', vol); dl.read('det', mat3Det([[a[0], b[0], c[0]], [a[1], b[1], c[1]], [a[2], b[2], c[2]]]));
  },
};

// ---- generic components morph -----------------------------------------------------
export const components = {
  id: 'components',
  label: 'Components of a step',
  blurb: 'The numbers of a step: the input blocks turn into the output block.',
  params: [],
  camera: { pos: [1.4, 1.6, 7.2], target: [0.4, 0, 0], fov: 40 },
  fog: 0.03,
  frame(dl, S) {
    const T = S.time, nm = S.step && S.step.numeric;
    let ins = nm && nm.inputs ? Object.entries(nm.inputs) : [];
    let out = nm && nm.output;
    let title = S.step ? (S.step.label || S.step.kind) : 'symmetrise: S_(ij) = ½(T_ij + T_ji)';
    if (!out) {
      const Tm = comp([3, 3], ['d', 'd'], drift(9, T, 41));
      const Sm = comp([3, 3], ['d', 'd'], new Float64Array(9));
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Sm.data[i * 3 + j] = 0.5 * (Tm.data[i * 3 + j] + Tm.data[j * 3 + i]);
      ins = [['T', Tm]]; out = Sm;
    }
    const u = S.t != null ? S.t : seg(T % 12, 1, 9);
    const m = Math.max(maxAbs(out), ...ins.map(([, c]) => maxAbs(c)));
    const outSyms = (S.step && S.step.after && S.step.after.free ? S.step.after.free.map(i => i.sym) : null) || out.shape.map((_, k) => DEFAULT_SYMS[k]);
    if (ins.length === 1 && ins[0][1].data.length === out.data.length && ins[0][1].shape.join() === out.shape.join()) {
      // same shape: morph the values in place
      const A = ins[0][1], M = comp(out.shape, out.variance, A.data.map((v, i) => v + (out.data[i] - v) * ease(u)));
      const syms = factorSyms(S.step && S.step.before, ins[0][0]) || outSyms;
      drawBlock(dl, M, { c0: [0, 0, 0], syms, m });
    } else {
      let x = -2.4;
      for (const [name, c] of ins) {
        const syms = factorSyms(S.step && S.step.before, name) || c.shape.map((_, k) => DEFAULT_SYMS[k]);
        drawBlock(dl, c, { c0: [x, 0, 0], syms, m, a: 1 - 0.6 * ease(u), name: name });
        x += 1.2 + c.shape.reduce((s, n, k) => k === 1 ? s + n * SP : s, 0);
      }
      drawBlock(dl, out, { c0: [Math.max(x, 1.4) + 0.6, 0, 0], syms: outSyms, m, scale: ease(u), a: 0.2 + 0.8 * ease(u) });
    }
    dl.label(null, title, { screen: [0.5, 0.06], size: 17, c: LOOK.ink });
    dl.read('progress', u);
  },
};

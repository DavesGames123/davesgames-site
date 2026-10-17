// ============================================================================
//  TENSOR CALCULUS  ·  viz/scenes/basis.js  ·  upper vs lower, dual basis
// ----------------------------------------------------------------------------
//  upper-lower  The key scene. A vector v (an arrow) and a covector w (a
//      stack of sheets, its level sets w(x) = n) are fixed in space. The
//      basis e_1, e_2 stretches. The components of v are the numbers of
//      e_i that fit in v, so they shrink when e_i grows (contravariant).
//      The components of w are the numbers of sheets that each e_i
//      pierces, so they grow with e_i (covariant). The pairing w(v) =
//      w_i v^i, the number of sheets that v pierces, does not change.
//      The ground grid is the dual basis: the lines x^1 = n are the level
//      sets of e^1, the lines x^2 = n those of e^2. With the metric on,
//      the arrow v turns into its own sheet stack v_i = g_ij v^j (lower)
//      and back (raise). Readouts: v1 v2 w1 w2 pair g11 g12 g22 vl1 vl2.
//  dual-basis  A skew 3D basis e_1 e_2 e_3 and its dual basis e^1 e^2 e^3
//      as three families of planes: e^i(e_j) = delta^i_j, so each e_j
//      crosses one plane of its own family and lies along the planes of
//      the other two. Thin arrows are the reciprocal vectors g^ij e_j,
//      at right angles to the planes. The metric g_ij = e_i . e_j and its
//      inverse are shown as matrices.
//
//  The maths is in basisState(params) and dualState(E) (DOM-free, tested):
//  grep -n "export function basisState\|export function dualState"
// ============================================================================
import { LOOK, tn, num, idx } from '../look.js';
import { wave, dwell, seg, ease, solve2, mat3Inv, mat3T, mat3Mul, dot, cross, scl, add, sub, len, unit, rotAxis, mat3Vec, clamp } from '../vmath.js';

// The axis colours of basis numbers 1, 2, 3 (not index letters).
export const AX = ['#ff7d6e', '#86e07c', '#78a8ff'];

// 2D vectors (a, b) live on the ground plane: world (a, H, -b).
const H = 0.42;           // height of the glyphs above the grid
const SHEET = 0.7;       // height of a covector sheet
const W3 = (a, b, y = H) => [a, y, -b];

// The numbers of the scene for one basis (DOM-free).
//   s     the stretch of e_1 (e_2 gets s ** p.both)
//   skew  the angle of e_2 from the vertical, radians
export function basisState(p) {
  const s = p.s, s2 = Math.pow(s, p.both ?? 0) * (p.e2 ?? 1);
  const e1 = [s, 0], e2 = [s2 * Math.sin(p.skew ?? 0.3), s2 * Math.cos(p.skew ?? 0.3)];
  const v = p.v || [2.2, 1.5], w = p.w || [0.85, 0.6];
  // v = v^1 e_1 + v^2 e_2
  const [v1, v2] = solve2(e1[0], e2[0], e1[1], e2[1], v[0], v[1]);
  // w_i = w(e_i)
  const w1 = w[0] * e1[0] + w[1] * e1[1], w2 = w[0] * e2[0] + w[1] * e2[1];
  const g11 = e1[0] * e1[0] + e1[1] * e1[1], g12 = e1[0] * e2[0] + e1[1] * e2[1], g22 = e2[0] * e2[0] + e2[1] * e2[1];
  const det = g11 * g22 - g12 * g12;
  // the dual basis as world covectors: rows of E^-1
  const E = [[e1[0], e2[0]], [e1[1], e2[1]]], dE = E[0][0] * E[1][1] - E[0][1] * E[1][0];
  const d1 = [E[1][1] / dE, -E[0][1] / dE], d2 = [-E[1][0] / dE, E[0][0] / dE];
  // v lowered: v_i = g_ij v^j; as a world covector it is v itself (Euclidean)
  const vl1 = g11 * v1 + g12 * v2, vl2 = g12 * v1 + g22 * v2;
  return {
    e1, e2, v, w, v1, v2, w1, w2, d1, d2, g: [[g11, g12], [g12, g22]], gInv: [[g22 / det, -g12 / det], [-g12 / det, g11 / det]],
    pair: w1 * v1 + w2 * v2, pairWorld: w[0] * v[0] + w[1] * v[1], vl1, vl2,
  };
}

// Draw the level sheets of a world covector c (c(x) = n) that cross the
// disc of radius R about the centre m. Returns the n values drawn.
function sheets(dl, c, m, R, col, o = {}) {
  const cl = Math.hypot(c[0], c[1]);
  if (cl < 1e-6) return [];
  const nrm = [c[0] / cl, c[1] / cl], dir = [-nrm[1], nrm[0]];
  const cm = c[0] * m[0] + c[1] * m[1];
  const nLo = Math.ceil(cm - R * cl), nHi = Math.floor(cm + R * cl), drawn = [];
  for (let n = nLo; n <= nHi; n++) {
    const off = (n - cm) / cl;                       // signed distance from m
    const half = Math.sqrt(Math.max(0, R * R - off * off));
    if (half < 0.05) continue;
    const q = [m[0] + nrm[0] * off, m[1] + nrm[1] * off];
    const hi = o.hiN && o.hiN(n);
    const a = (o.a ?? 0.15) * (hi ? 1.9 : 1) * (o.fade ? o.fade(off / R) : 1);
    const h = o.h ?? SHEET, y0 = o.y0 ?? 0.02;
    const P = W3(q[0], q[1], y0 + h / 2), U = [dir[0] * half, 0, -dir[1] * half], Vv = [0, h / 2, 0];
    dl.quad(P, U, Vv, col, { a, sym: o.sym, edge: false });
    // the top and the base edges, brighter, so the stack reads as lines
    const A = W3(q[0] - dir[0] * half, q[1] - dir[1] * half, y0 + h), B = W3(q[0] + dir[0] * half, q[1] + dir[1] * half, y0 + h);
    dl.seg(A, B, col, { w: hi ? 2.4 : 1.4, a: Math.min(1, a * 4.5), sym: o.sym });
    const A0 = W3(q[0] - dir[0] * half, q[1] - dir[1] * half, y0), B0 = W3(q[0] + dir[0] * half, q[1] + dir[1] * half, y0);
    dl.seg(A0, B0, col, { w: 1, a: Math.min(1, a * 2.5), sym: o.sym });
    if (o.labelN && n === o.labelN) dl.label(B, o.labelHtml, { c: col, size: 13, sym: o.sym, anchor: 'l' });
    drawn.push(n);
  }
  return drawn;
}

// The points where the segment from 0 to x crosses the sheets of c.
function pierce(c, x) {
  const t = c[0] * x[0] + c[1] * x[1], out = [];
  const n0 = t >= 0 ? 1 : -1;
  for (let n = n0; Math.abs(n) <= Math.abs(t) + 1e-9; n += n0) out.push([x[0] * n / t, x[1] * n / t]);
  return out;
}

function grid(dl, st, R, a = 1) {
  // the lattice x^1 = n (lines along e_2) and x^2 = n (lines along e_1):
  // the level sets of the dual basis e^1 and e^2
  const m = [0.9, 0.6];
  for (const [k, cv, along] of [[0, st.d1, st.e2], [1, st.d2, st.e1]]) {
    const cl = Math.hypot(cv[0], cv[1]), nrm = [cv[0] / cl, cv[1] / cl], dir = [-nrm[1], nrm[0]];
    const cm = cv[0] * m[0] + cv[1] * m[1];
    for (let n = Math.ceil(cm - R * cl); n <= Math.floor(cm + R * cl); n++) {
      const off = (n - cm) / cl, half = Math.sqrt(Math.max(0, R * R - off * off));
      const q = [m[0] + nrm[0] * off, m[1] + nrm[1] * off];
      const fade = 1 - Math.abs(off) / R;
      dl.seg(W3(q[0] - dir[0] * half, q[1] - dir[1] * half, 0), W3(q[0] + dir[0] * half, q[1] + dir[1] * half, 0),
        n === 0 ? AX[k] : LOOK.grid, { w: n === 0 ? 1.5 : 1, a: a * (n === 0 ? 0.55 : 0.16 + 0.22 * fade), sym: 'i' });
    }
  }
  // a faint outer ring
  const ring = [];
  for (let i = 0; i <= 96; i++) { const t = (2 * Math.PI * i) / 96; ring.push(W3(m[0] + R * Math.cos(t), m[1] + R * Math.sin(t), 0)); }
  dl.poly(ring, LOOK.gridDim, { w: 1, a: 0.35 * a });
}

const fmtM2 = (name, up, M) => `<div class="tc-mat"><span class="tc-mat-n">${name}</span><span class="tc-br">(</span><span class="tc-grid2">` +
  `<span>${num(M[0][0])}</span><span>${num(M[0][1])}</span><span>${num(M[1][0])}</span><span>${num(M[1][1])}</span></span><span class="tc-br">)</span></div>`;

export const upperLower = {
  id: 'upper-lower',
  label: 'Upper vs lower indices',
  blurb: 'Stretch the basis: vector components shrink, covector components grow, the pairing stays.',
  params: [
    { key: 's', label: 'stretch of e₁', min: 0.45, max: 2.2, step: 0.01, def: null },
    { key: 'skew', label: 'skew of e₂', min: -0.8, max: 0.8, step: 0.01, def: 0.32 },
    { key: 'both', label: 'stretch e₂ too', min: 0, max: 1, step: 1, def: 0 },
    { key: 'metric', label: 'metric (lower v)', min: 0, max: 1, step: 0.01, def: null },
    { key: 'covector', label: 'show covector', min: 0, max: 1, step: 1, def: 1 },
  ],
  camera: { pos: [1.0, 3.7, 5.2], target: [1.05, 0.25, -0.8], fov: 42 },
  fog: 0.035,
  frame(dl, S) {
    const p = S.p, T = S.time;
    // free mode: the stretch breathes between 0.55 and 1.95, geometric
    let s = p.s;
    if (s == null) s = 0.55 * Math.pow(1.95 / 0.55, S.t != null && S.stepKind === 'transform' ? S.t : wave(T, 16));
    let mAmt = p.metric;
    if (mAmt == null) {
      if (S.stepKind === 'lower') mAmt = ease(S.t);
      else if (S.stepKind === 'raise') mAmt = 1 - ease(S.t);
      else { const u = ((T % 40) + 40) % 40; mAmt = u < 26 ? 0 : u < 29 ? seg(u, 26, 29) : u < 37 ? 1 : 1 - seg(u, 37, 40); }
    }
    const st = basisState({ s, skew: p.skew, both: p.both });
    const R = 3.0, m = [0.9, 0.6];
    grid(dl, st, R, 1);

    const cov = (p.covector ?? 1) * (1 - 0.8 * mAmt);
    const O = W3(0, 0);
    // ---- basis e_1, e_2 (arrows: contravariant), sym 'i'
    const e1 = [st.e1[0], 0, -st.e1[1]], e2 = [st.e2[0], 0, -st.e2[1]];
    dl.arrow(O, e1, AX[0], { r: 0.05, sym: 'i' });
    dl.arrow(O, e2, AX[1], { r: 0.05, sym: 'i' });
    dl.label(add(add(O, e1), [0.08, 0.05, 0.22]), tn('e', [], ['1'], {}) , { c: AX[0], size: 16, sym: 'i', anchor: 'l' });
    dl.label(add(add(O, e2), [-0.1, 0.12, -0.05]), tn('e', [], ['2']), { c: AX[1], size: 16, sym: 'i', anchor: 'r' });
    // ---- the vector v = v^1 e_1 + v^2 e_2
    const v = W3(st.v[0], st.v[1]), vA = 1 - 0.65 * mAmt;
    dl.arrow(W3(0, 0), sub(v, W3(0, 0)), LOOK.vec, { r: 0.055, a: 1, sym: 'v' });
    dl.label(add(v, [0.12, 0.1, -0.05]), tn('v'), { c: LOOK.vec, size: 18, anchor: 'l', sym: 'v' });
    // the components as a chain of e_1 copies, then e_2 copies
    const c1 = W3(st.v1 * st.e1[0], st.v1 * st.e1[1]);
    for (let k = 1; k <= Math.floor(st.v1 + 1e-9); k++) dl.ball(W3(k * st.e1[0], k * st.e1[1]), 0.045, AX[0], { sym: 'i' });
    dl.seg(W3(0, 0), c1, AX[0], { w: 4, a: 0.55 * vA, sym: 'i' });
    dl.dashed(c1, v, AX[1], { w: 2, a: 0.7 * vA, sym: 'i', dash: 0.1, gap: 0.07 });
    const c2 = W3(st.v2 * st.e2[0], st.v2 * st.e2[1]);
    dl.dashed(c2, v, AX[0], { w: 1.4, a: 0.45 * vA, sym: 'i', dash: 0.1, gap: 0.07 });
    dl.seg(W3(0, 0), c2, AX[1], { w: 4, a: 0.4 * vA, sym: 'i' });
    for (let k = 1; k <= Math.floor(st.v2 + 1e-9); k++) dl.ball(W3(k * st.e2[0], k * st.e2[1]), 0.04, AX[1], { sym: 'i' });
    dl.label(add(scl(add(c1, W3(0, 0)), 0.5), [0, -0.15, 0.38]), `${tn('v', ['1'])} = ${num(st.v1)}`, { c: AX[0], size: 15, sym: 'i', a: vA });
    dl.label(add(lerpP(c1, v, 0.5), [0.32, 0, 0.05]), `${tn('v', ['2'])} = ${num(st.v2)}`, { c: AX[1], size: 15, sym: 'i', a: vA, anchor: 'l' });

    // ---- the covector w: its sheets w(x) = n, fixed in space
    const pierceV = pierce(st.w, st.v);
    if (cov > 0.01) {
      sheets(dl, st.w, m, R, LOOK.cov, { a: 0.075 * cov, sym: 'w', hiN: n => n >= 1 && n <= st.pairWorld,
        fade: x => 1 - 0.5 * x * x, labelN: 1, labelHtml: `${tn('ω')}(x) = 1` });
      // the sheets that e_1 and e_2 pierce: w_1 and w_2
      for (const [k, e, wk] of [[0, st.e1, st.w1], [1, st.e2, st.w2]]) {
        for (const q of pierce(st.w, e)) dl.ball(W3(q[0], q[1]), 0.07, AX[k], { a: cov, sym: 'i' });
        const tip = W3(e[0], e[1]);
        const ed = unit([e[0], 0, -e[1]]);
        dl.label(add(add(tip, scl(ed, 0.3)), [0, 0.22, 0]), `${tn('ω', [], [String(k + 1)])} = ${num(wk)}`, { c: LOOK.cov, size: 15, sym: 'i', a: cov, anchor: k ? 'r' : 'l' });
      }
      // where v pierces the sheets: gold beads, the pairing
      for (const q of pierceV) dl.ball(W3(q[0], q[1]), 0.095, LOOK.gold, { a: cov });
    }

    // ---- the metric: v lowered to its own sheet stack v_i = g_ij v^j
    if (mAmt > 0.01) {
      // the sheets of v-flat: x . v = n, spacing 1/|v|; they grow out of v
      const vl = st.v, vlen = Math.hypot(vl[0], vl[1]);
      sheets(dl, vl, scl3(vl, 0.5), Math.max(0.2, 1.4 + 2.2 * mAmt), LOOK.vec, { a: 0.16 * mAmt, sym: 'v', h: SHEET * mAmt,
        hiN: n => n >= 1 && n <= vlen * vlen });
      for (const q of pierce(vl, st.v)) dl.ball(W3(q[0], q[1]), 0.06, LOOK.vec, { a: mAmt });
      dl.label(W3(-1.9, 2.9, 1.2), `${tn('v', [], ['i'])} = ${tn('g', [], ['i', 'j'])}${tn('v', ['j'])}`, { c: LOOK.metric, size: 17, a: mAmt });
    }

    // ---- readouts (screen labels)
    const pairHtml = `${tn('ω', [], ['i'])}${tn('v', ['i'])} = ${num(st.w1)}·${num(st.v1)} + ${num(st.w2)}·${num(st.v2)} = <b>${num(st.pair)}</b>`;
    dl.label(null, pairHtml, { screen: [0.5, 0.06], size: 17, c: LOOK.gold, a: cov > 0.05 ? 1 : 0.4 });
    dl.label(null, fmtM2(tn('g', [], ['i', 'j']), false, st.g), { screen: [0.04, 0.12], size: 14, c: LOOK.metric, anchor: 'l', a: 0.6 + 0.4 * mAmt });
    if (mAmt > 0.01) dl.label(null, `${tn('v', [], ['1'])} = ${num(st.vl1)} &nbsp; ${tn('v', [], ['2'])} = ${num(st.vl2)}`, { screen: [0.04, 0.24], size: 15, c: LOOK.vec, anchor: 'l', a: mAmt });
    dl.read('s', s); dl.read('v1', st.v1); dl.read('v2', st.v2); dl.read('w1', st.w1); dl.read('w2', st.w2);
    dl.read('pair', st.pair); dl.read('metric', mAmt);
    dl.read('g11', st.g[0][0]); dl.read('g12', st.g[0][1]); dl.read('g22', st.g[1][1]); dl.read('vl1', st.vl1); dl.read('vl2', st.vl2);
  },
};

function lerpP(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function scl3(v2, s) { return [v2[0] * s, v2[1] * s]; }

// ---- dual basis in 3D -------------------------------------------------------
// E: columns are e_1 e_2 e_3 (world). Returns the dual covectors (rows of
// E^-1), the metric and its inverse, and the reciprocal vectors.
export function dualState(E) {
  const Ei = mat3Inv(E), cols = [0, 1, 2].map(j => [E[0][j], E[1][j], E[2][j]]);
  const g = [0, 1, 2].map(i => [0, 1, 2].map(j => dot(cols[i], cols[j])));
  const gInv = mat3Inv(g);
  const dual = [0, 1, 2].map(i => Ei[i].slice());
  // reciprocal vectors g^ij e_j: in a Euclidean world they equal the dual rows
  const recip = [0, 1, 2].map(i => [0, 1, 2].reduce((acc, j) => add(acc, scl(cols[j], gInv[i][j])), [0, 0, 0]));
  const delta = [0, 1, 2].map(i => [0, 1, 2].map(j => dot(dual[i], cols[j])));
  return { cols, dual, g, gInv, recip, delta };
}

const fmtM3 = (name, M) => `<div class="tc-mat"><span class="tc-mat-n">${name}</span><span class="tc-br">(</span><span class="tc-grid3">` +
  M.flat().map(x => `<span>${num(x)}</span>`).join('') + `</span><span class="tc-br">)</span></div>`;

export const dualBasis = {
  id: 'dual-basis',
  label: 'Basis and dual basis',
  blurb: 'Each e_j crosses one plane of its own dual family and none of the others: e^i(e_j) = δ^i_j.',
  params: [
    { key: 'shear', label: 'shear', min: 0, max: 1, step: 0.01, def: null },
    { key: 'focus', label: 'focus on i', min: 0, max: 3, step: 1, def: null },
  ],
  camera: { pos: [4.6, 3.4, 5.6], target: [1.05, 0.95, 0.95], fov: 40 },
  fog: 0.04,
  frame(dl, S) {
    const p = S.p, T = S.time;
    const sh = p.shear ?? (S.t != null ? S.t : wave(T, 18));
    const R = rotAxis([0, 1, 0], 0.15 * Math.sin(T * 0.11));
    const base = [[1.25, 0.5 * sh, 0.15 + 0.3 * sh], [0.05, 1.15, 0.45 * sh], [0.1 + 0.35 * sh, -0.1, 1.2]];
    // columns e_j = R base_col
    const E = mat3Mul(R, base);
    const st = dualState(E);
    const focus = p.focus ?? ((Math.floor(T / 6) % 4)); // 0 = all, 1..3
    const lvl = 2;
    for (let i = 0; i < 3; i++) {
      const on = focus === 0 || focus === i + 1, a = on ? 1 : 0.25;
      const u = st.cols[(i + 1) % 3], v = st.cols[(i + 2) % 3];
      for (let n = 0; n <= lvl; n++) {
        const P = add(scl(st.cols[i], n), scl(add(u, v), lvl / 2));
        dl.quad(P, scl(u, lvl / 2), scl(v, lvl / 2), AX[i], { a: (n === 1 ? 0.2 : 0.11) * a, edge: true, edgeA: 0.75 * a, edgeW: n === 1 ? 2 : 1.2, sym: 'i' });
      }
      // the basis vector, and its plane count
      dl.arrow([0, 0, 0], st.cols[i], AX[i], { r: 0.05, sym: 'i', a: 1 });
      dl.label(add(st.cols[i], scl(unit(st.cols[i]), 0.22)), tn('e', [], [String(i + 1)]), { c: AX[i], size: 17, sym: 'i' });
      // the reciprocal vector, normal to its planes, length 1 / spacing
      const rv = st.recip[i];
      dl.arrow([0, 0, 0], rv, AX[i], { r: 0.022, a: 0.55 * a, sym: 'i' });
      dl.label(add(add(rv, scl(unit(rv), 0.2)), [0, 0.1, 0]), `${tn('g', ['i', 'j'])}${tn('e', [], ['j'])}`, { c: AX[i], size: 12, a: 0.6 * a, sym: 'i' });
      // label the family on the far plane
      const far = add(scl(st.cols[i], lvl), add(scl(u, lvl), scl(v, lvl)));
      dl.label(far, `${tn('e', [String(i + 1)])} = n`, { c: AX[i], size: 14, a: 0.85 * a, sym: 'i' });
    }
    // the unit cell, outlined
    const c = st.cols;
    for (const [a0, d] of [[[0, 0, 0], c[0]], [[0, 0, 0], c[1]], [[0, 0, 0], c[2]], [c[0], c[1]], [c[0], c[2]], [c[1], c[0]], [c[1], c[2]], [c[2], c[0]], [c[2], c[1]],
      [add(c[0], c[1]), c[2]], [add(c[0], c[2]), c[1]], [add(c[1], c[2]), c[0]]]) dl.seg(a0, add(a0, d), LOOK.ink, { w: 1.2, a: 0.35 });
    if (focus > 0) {
      const i = focus - 1;
      dl.label(null, `${tn('e', [String(i + 1)])}(${tn('e', [], ['j'])}) = ${tn('δ', [String(i + 1)], ['j'])} = (${st.delta[i].map(x => num(x, 0)).join(', ')})`, { screen: [0.5, 0.06], size: 17, c: AX[i] });
    } else dl.label(null, `${tn('e', ['i'])}(${tn('e', [], ['j'])}) = ${tn('δ', ['i'], ['j'])}`, { screen: [0.5, 0.06], size: 17, c: LOOK.ink });
    dl.label(null, fmtM3(tn('g', [], ['i', 'j']), st.g), { screen: [0.04, 0.12], size: 13, c: LOOK.metric, anchor: 'l' });
    dl.label(null, fmtM3(tn('g', ['i', 'j']), st.gInv), { screen: [0.04, 0.3], size: 13, c: LOOK.metric, anchor: 'l' });
    // a floor shadow grid
    for (let k = 0; k <= 11; k++) {
      const x = -2 + k * 0.5;
      dl.seg([x, -0.3, -1.5], [x, -0.3, 3.5], LOOK.gridDim, { w: 1, a: 0.16 });
      dl.seg([-2, -0.3, x + 0.5], [3.5, -0.3, x + 0.5], LOOK.gridDim, { w: 1, a: 0.16 });
    }
    dl.read('shear', sh); dl.read('focus', focus);
    dl.read('delta', st.delta.flat().reduce((a, x, k) => a + Math.abs(x - (k % 4 === 0 ? 1 : 0)), 0));
  },
};

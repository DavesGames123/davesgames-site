// ============================================================================
//  TENSOR CALCULUS  ·  viz/scenes/continuum.js  ·  rank-2 tensors in 3D  (VIZ)
// ----------------------------------------------------------------------------
//  transform-rank2  A symmetric covariant tensor Q_ij is drawn as its level
//      set Q_ij x^i x^j = 1, an ellipsoid (a covariant object is a level
//      set). The change of coordinates x' = J x gives the new components
//      Q'_ab = (J^-1)^i_a (J^-1)^j_b Q_ij. Passive mode: the basis turns and
//      stretches (e'_a = columns of J^-1) and the ellipsoid stays; the
//      components change. Active mode: the space moves by J, so the
//      ellipsoid moves, with the same new components.
//  stress-cube  Cauchy stress sigma_ij on a small cube. The traction on a
//      face with normal n is t_i = sigma_ij n_j: an arrow, split into its
//      normal and shear parts. A cut plane turns through the cube and shows
//      the traction on any plane. The cube strains (exaggerated) with the
//      load.
//  inertia  A rigid body spins with no torque (Euler equations). Its
//      angular velocity omega^j (a vector) and its angular momentum
//      L_i = I_ij omega^j (a covector: the level planes of L). Poinsot: the
//      energy ellipsoid omega^T I omega = 2E rolls on the fixed plane
//      L . x = 2E at the point omega. Near the middle axis the body flips
//      again and again (the Dzhanibekov effect).
//
//  DOM-free maths for tests: grep -n "export function"
// ============================================================================
import { LOOK, tn, num, ic } from '../look.js';
import { AX } from './basis.js';
import { add, sub, scl, dot, cross, len, unit, wave, seg, ease, clamp, lerp3, mat3Mul, mat3T, mat3Inv, mat3Vec, mat3Det,
  rotAxis, eigSym3, eulerStep, I3 } from '../vmath.js';

const fmt3 = (name, M, d = 2) => `<div class="tc-mat"><span class="tc-mat-n">${name} =</span><span class="tc-br">(</span><span class="tc-grid3">` +
  M.flat().map(x => `<span>${num(x, d)}</span>`).join('') + `</span><span class="tc-br">)</span></div>`;

// ---- transform of a rank-2 tensor ------------------------------------------------
// Q' = J^-T Q J^-1: the law for two lower indices.
export function transformLower2(Q, J) {
  const Ji = mat3Inv(J);
  return mat3Mul(mat3T(Ji), mat3Mul(Q, Ji));
}
// The ellipsoid of a positive definite Q: semi-axis vectors v_k / sqrt(l_k).
export function quadricAxes(Q) {
  const { values, vectors } = eigSym3(Q);
  return vectors.map((v, k) => scl(v, 1 / Math.sqrt(Math.max(1e-6, values[k]))));
}
export function baseQuadric() {
  const R0 = mat3Mul(rotAxis([0, 1, 0], 0.5), rotAxis([1, 0, 0], 0.35));
  const D = [[1 / 2.4, 0, 0], [0, 1 / 1.1, 0], [0, 0, 1 / 0.45]];
  return mat3Mul(R0, mat3Mul(D, mat3T(R0)));
}
export function jacobianAt(u, mode) {
  // a turn about a tilted axis and a stretch, from the identity at u = 0
  const R = rotAxis([0.3, 1, 0.2], 1.1 * u);
  const S = [[1 + 0.5 * u, 0, 0], [0, 1 - 0.3 * u, 0], [0, 0.35 * u, 1]];
  return mode === 'rotate' ? R : mat3Mul(S, R);
}

export const transformRank2 = {
  id: 'transform-rank2',
  label: 'Transforming a rank-2 tensor',
  blurb: 'Q′_ab = (J⁻¹)^i_a (J⁻¹)^j_b Q_ij: the basis moves, the ellipsoid stays, the components change.',
  params: [
    { key: 'mode', label: 'view', options: ['passive', 'active'], def: null },
    { key: 'kind', label: 'change', options: ['rotate', 'general'], def: 'general' },
    { key: 'u', label: 'amount', min: 0, max: 1, step: 0.01, def: null },
  ],
  camera: { pos: [3.6, 2.4, 5.0], target: [0.55, 0.1, 0], fov: 40 },
  fog: 0.035,
  frame(dl, S) {
    const T = S.time, p = S.p, cyc = Math.floor(T / 16);
    const mode = p.mode ?? (cyc % 2 ? 'active' : 'passive');
    const u = p.u ?? (S.t != null ? ease(S.t) : (() => { const q = T % 16; return q < 2 ? 0 : q < 8 ? seg(q, 2, 8) : q < 12 ? 1 : 1 - seg(q, 12, 15.5); })());
    let Q = baseQuadric(), J = jacobianAt(u, p.kind ?? 'general');
    // with a step: Q from the input, J from an input called J or Lambda
    const nm = S.step && S.step.numeric;
    if (nm && nm.inputs) {
      for (const [name, c] of Object.entries(nm.inputs)) {
        if (c.shape.length === 2 && c.shape[0] === 3 && c.shape[1] === 3) {
          const M = [[c.data[0], c.data[1], c.data[2]], [c.data[3], c.data[4], c.data[5]], [c.data[6], c.data[7], c.data[8]]];
          if (/^(J|Lambda|\\Lambda|L)$/.test(name)) { const I = I3(); J = I.map((r, i) => r.map((v, j) => v + (M[i][j] - v) * ease(S.t ?? 1))); }
          else if (M[0][1] === M[1][0] && M[0][2] === M[2][0] && M[1][2] === M[2][1] && eigSym3(M).values[2] > 0) Q = M;
        }
      }
    }
    const Qn = transformLower2(Q, J);
    const Ji = mat3Inv(J);
    const C = [0, 0.15, 0];
    // the ellipsoid: fixed (passive) or moved by J (active)
    const axes = quadricAxes(mode === 'active' ? Qn : Q);
    dl.ellipsoid(C, axes, LOOK.metric, { a: 0.35, nu: 48, nv: 28, wire: { nu: 16, nv: 10, c: '#d9c2ff', a: 0.25, w: 1 } });
    // principal axes, thin
    for (let k = 0; k < 3; k++) dl.seg(sub(C, axes[k]), add(C, axes[k]), '#d9c2ff', { w: 1.2, a: 0.5 });
    // the basis: in passive mode the new basis e'_a = columns of J^-1; in
    // active mode the old basis, fixed
    for (let a = 0; a < 3; a++) {
      const e = mode === 'passive' ? [Ji[0][a], Ji[1][a], Ji[2][a]] : [a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0];
      const w = [e[0], e[1], e[2]];
      dl.arrow(C, scl(w, 1.25), AX[a], { r: 0.035, sym: 'a' });
      dl.label(add(C, scl(w, 1.42)), mode === 'passive' ? `${tn('e', [], [String(a + 1)])}′` : tn('e', [], [String(a + 1)]), { c: AX[a], size: 16, sym: 'a' });
      if (mode === 'passive') dl.arrow(C, [a === 0 ? 1.25 : 0, a === 1 ? 1.25 : 0, a === 2 ? 1.25 : 0], AX[a], { r: 0.012, a: 0.3 });
    }
    // the components as a block beside it, and as a matrix
    dl.label(null, fmt3(`${tn('Q', [], ['a', 'b'])}′`, Qn), { screen: [0.04, 0.16], size: 14, c: LOOK.metric, anchor: 'l' });
    dl.label(null, fmt3(tn('J', ['a'], ['i']), J), { screen: [0.04, 0.34], size: 13, c: LOOK.dim, anchor: 'l' });
    dl.label(null, `${tn('Q', [], ['a', 'b'])}′ = ${tn('(J⁻¹)', ['i'], ['a'])} ${tn('(J⁻¹)', ['j'], ['b'])} ${tn('Q', [], ['i', 'j'])} &nbsp; <span class="tc-note">${mode === 'passive' ? 'the basis moves; the ellipsoid stays' : 'the space moves; the basis stays'}</span>`, { screen: [0.5, 0.06], size: 17, c: LOOK.ink });
    dl.label(add(C, scl(axes[0], 1.15)), `${tn('Q', [], ['i', 'j'])}${tn('x', ['i'])}${tn('x', ['j'])} = 1`, { c: LOOK.metric, size: 14 });
    // a floor grid, deformed by J in active mode
    for (let k = -4; k <= 4; k++) {
      const g = (x, z) => { const q = [x, -1.3, z]; if (mode !== 'active') return q; const m = mat3Vec(J, [x, 0, z]); return [m[0], -1.3 + 0 * m[1], m[2]]; };
      const a0 = [], b0 = [];
      for (let i = -4; i <= 4; i++) { a0.push(g(k * 0.5, i * 0.5)); b0.push(g(i * 0.5, k * 0.5)); }
      dl.poly(a0, LOOK.gridDim, { w: 1, a: 0.3 }); dl.poly(b0, LOOK.gridDim, { w: 1, a: 0.3 });
    }
    dl.read('u', u); dl.read('Q11', Qn[0][0]); dl.read('Q12', Qn[0][1]); dl.read('detJ', mat3Det(J));
  },
};

// ---- stress cube ---------------------------------------------------------------------
const CASES = [
  { name: 'uniaxial tension', s: [[1.2, 0, 0], [0, 0, 0], [0, 0, 0]] },
  { name: 'pure shear', s: [[0, 0.9, 0], [0.9, 0, 0], [0, 0, 0]] },
  { name: 'hydrostatic pressure', s: [[-0.7, 0, 0], [0, -0.7, 0], [0, 0, -0.7]] },
  { name: 'a general state', s: [[0.8, 0.4, -0.2], [0.4, -0.3, 0.5], [-0.2, 0.5, 0.4]] },
];
export function traction(sig, n) { return mat3Vec(sig, n); }
export function stressAt(T) {
  const k = Math.floor(T / 10), u = seg(T % 10, 6.5, 9.5);
  const A = CASES[k % 4], B = CASES[(k + 1) % 4];
  return { sig: A.s.map((r, i) => r.map((v, j) => v + (B.s[i][j] - v) * u)), name: u < 0.5 ? A.name : B.name };
}

export const stressCube = {
  id: 'stress-cube',
  label: 'Stress and traction',
  blurb: 'The traction on a plane with normal n is t_i = σ_ij n_j.',
  params: [{ key: 'case', label: 'load', min: 0, max: 3, step: 1, def: null }],
  camera: { pos: [3.4, 2.7, 4.4], target: [0, 0, 0], fov: 40 },
  fog: 0.04,
  frame(dl, S) {
    const T = S.time, p = S.p;
    const st = p.case != null ? { sig: CASES[p.case].s, name: CASES[p.case].name } : stressAt(T);
    const sig = st.sig, h = 0.75, k = 0.12;
    const def = x => add(x, scl(mat3Vec(sig, x), k));   // small strain, exaggerated
    // the cube faces
    const n6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const n of n6) {
      const a = Math.abs(n[0]) ? [0, 1, 0] : [1, 0, 0], b = cross(n, a);
      const c = scl(n, h);
      const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => def(add(c, add(scl(a, s * h), scl(b, t * h)))));
      dl.tri(q[0], q[1], q[2], '#3a4766', { a: 0.55 }); dl.tri(q[0], q[2], q[3], '#3a4766', { a: 0.55 });
      dl.poly(q, '#9fb0d8', { w: 1.3, a: 0.7, closed: true });
      // traction on the face
      const t = traction(sig, n), tn0 = dot(t, n), tN = scl(n, tn0), tS = sub(t, tN);
      const P = def(c);
      if (len(t) > 1e-3) {
        dl.arrow(P, scl(t, 0.9), ic('i'), { r: 0.03, sym: 'i' });
        if (len(tS) > 0.05 && len(tN) > 0.05) { dl.dashed(add(P, scl(tN, 0.9)), add(P, scl(t, 0.9)), '#d58cff', { w: 1.4, a: 0.7 }); dl.arrow(P, scl(tN, 0.9), tn0 > 0 ? LOOK.pos : LOOK.neg, { r: 0.016, a: 0.7 }); }
      }
      dl.arrow(P, scl(n, 0.35), ic('j'), { r: 0.012, a: 0.6, sym: 'j' });
    }
    // the turning cut plane through the centre
    const nC = unit([Math.cos(T * 0.37), 0.6 * Math.sin(T * 0.23), Math.sin(T * 0.37)]);
    const a = unit(cross(nC, [0, 1, 0.01])), b = cross(nC, a);
    const disk = [];
    for (let i = 0; i <= 48; i++) { const t = (2 * Math.PI * i) / 48; disk.push(add(scl(a, Math.cos(t) * 1.05), scl(b, Math.sin(t) * 1.05))); }
    for (let i = 0; i < 48; i++) dl.tri([0, 0, 0], disk[i], disk[i + 1], LOOK.gold, { a: 0.12 });
    dl.poly(disk, LOOK.gold, { w: 1.6, a: 0.7 });
    const tC = traction(sig, nC);
    dl.arrow([0, 0, 0], scl(nC, 0.6), ic('j'), { r: 0.02, sym: 'j' });
    dl.arrow([0, 0, 0], scl(tC, 1.0), LOOK.gold, { r: 0.035, sym: 'i' });
    dl.label(scl(nC, 0.75), tn('n', [], ['j']), { c: ic('j'), size: 16, sym: 'j' });
    dl.label(add(scl(tC, 1.0), scl(unit(tC), 0.2)), tn('t', [], ['i']), { c: LOOK.gold, size: 17, sym: 'i' });
    const ev = eigSym3(sig).values;
    dl.label(null, `${tn('t', [], ['i'])} = ${tn('σ', [], ['i', 'j'])} ${tn('n', [], ['j'])} &nbsp; <span class="tc-note">${st.name}</span>`, { screen: [0.5, 0.06], size: 18, c: LOOK.ink });
    dl.label(null, fmt3(tn('σ', [], ['i', 'j']), sig), { screen: [0.04, 0.16], size: 14, c: LOOK.ink, anchor: 'l' });
    dl.label(null, `principal: ${ev.map(v => num(v)).join(', ')}`, { screen: [0.5, 0.94], size: 14, c: LOOK.dim });
    dl.read('tn', dot(tC, nC)); dl.read('trace', sig[0][0] + sig[1][1] + sig[2][2]);
  },
};

// ---- inertia (Poinsot) ------------------------------------------------------------------
// The body: boxes { c: centre, h: half sizes, m: mass } in body coordinates.
const BODY = [
  { c: [0, 0, 0], h: [0.75, 0.16, 0.16], m: 1.0 },
  { c: [0.5, 0, 0], h: [0.1, 0.62, 0.12], m: 0.8 },
  { c: [-0.62, 0, 0], h: [0.14, 0.26, 0.42], m: 0.8 },
];
export function inertiaTensor(boxes = BODY) {
  const I = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let M = 0, com = [0, 0, 0];
  for (const b of boxes) { M += b.m; com = add(com, scl(b.c, b.m)); }
  com = scl(com, 1 / M);
  for (const b of boxes) {
    const [a, bb, c] = b.h.map(x => 2 * x), m = b.m;
    const Ic = [m * (bb * bb + c * c) / 12, m * (a * a + c * c) / 12, m * (a * a + bb * bb) / 12];
    const d = sub(b.c, com), d2 = dot(d, d);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i][j] += (i === j ? Ic[i] : 0) + m * ((i === j ? d2 : 0) - d[i] * d[j]);
  }
  return { I, com, M };
}
const INER = (() => {
  const { I, com } = inertiaTensor();
  const e = eigSym3(I);
  // order the principal moments ascending: 1 smallest, 2 middle, 3 largest
  const idx = [2, 1, 0];
  const Ib = idx.map(k => e.values[k]);
  const P = [0, 1, 2].map(r => idx.map(k => e.vectors[k][r]));   // columns: principal axes in body coords
  if (mat3Det(P) < 0) for (let r = 0; r < 3; r++) P[r][2] *= -1;
  return { I, com, Ib, P };
})();
let cache = { t: 0, st: null };
export function inertiaState(time, dt = 1 / 240) {
  if (!cache.st || time < cache.t - 1e-9) cache = { t: 0, st: { w: [0.03, 2.2, 0.04], R: I3() }, hist: [] };
  let n = 0;
  while (cache.t + dt <= time && n < 200000) { cache.st = eulerStep(cache.st, INER.Ib, dt); cache.t += dt; n++; }
  return cache.st;
}
export const INERTIA = INER;

export const inertia = {
  id: 'inertia',
  label: 'The inertia tensor',
  blurb: 'L_i = I_ij ω^j: momentum and spin point different ways; the energy ellipsoid rolls on the plane of L.',
  params: [],
  camera: { pos: [3.6, 2.2, 4.4], target: [0, 0.1, 0], fov: 40 },
  fog: 0.04,
  frame(dl, S) {
    const T = S.time;
    const st = inertiaState(T);
    const { Ib, P, com } = INER;
    // world from principal frame: R; world from body coords: R P^T
    const R = st.R, RP = mat3Mul(R, mat3T(P));
    const BS = 0.7;
    const toW = x => scl(mat3Vec(RP, sub(x, com)), BS);
    // the body
    for (const b of BODY) {
      const ax = [[b.h[0], 0, 0], [0, b.h[1], 0], [0, 0, b.h[2]]].map(v => scl(mat3Vec(RP, v), BS));
      dl.box(toW(b.c), null, '#c9b48a', { axes: ax, edge: true, edgeC: '#ffe9b0', edgeA: 0.5 });
    }
    // omega and L in the world
    const wW = mat3Vec(R, st.w), LW = mat3Vec(R, st.w.map((v, i) => v * Ib[i]));
    const E2 = dot(st.w, st.w.map((v, i) => v * Ib[i]));   // 2E
    const s = 1.5 / Math.sqrt(E2 / Ib[0]);
    // energy ellipsoid in omega space: x^T I_w x = 2E; semi axes sqrt(2E / I_k) along the principal axes
    const axes = [0, 1, 2].map(k => scl([R[0][k], R[1][k], R[2][k]], s * Math.sqrt(E2 / Ib[k])));
    dl.ellipsoid([0, 0, 0], axes, LOOK.metric, { a: 0.18, nu: 48, nv: 28, wire: { nu: 16, nv: 10, c: '#d9c2ff', a: 0.18, w: 1 } });
    // the invariable plane L . x = 2E (scaled), and its neighbours: the level sets of L
    const Ln = unit(LW), d0 = E2 / len(LW) * s;
    const pa = unit(cross(Ln, [0.3, 0.1, 1])), pb = cross(Ln, pa);
    for (const k of [-2, -1, 0, 1]) {
      const c = scl(Ln, d0 * (1 + 0.35 * k));
      dl.quad(c, scl(pa, 1.5), scl(pb, 1.5), LOOK.cov, { a: k === 0 ? 0.12 : 0.04, edge: true, edgeA: k === 0 ? 0.7 : 0.2, sym: 'i' });
    }
    // herpolhode: omega tip on the plane, a trail
    if (!cache.hist) cache.hist = [];
    const tip = scl(wW, s);
    const h = cache.hist;
    if (!h.length || len(sub(h[h.length - 1], tip)) > 0.01) { h.push(tip); if (h.length > 600) h.shift(); }
    dl.poly(h, LOOK.gold, { w: 1.4, a: 0.6 });
    dl.arrow([0, 0, 0], tip, LOOK.vec, { r: 0.03, sym: 'j' });
    dl.arrow([0, 0, 0], scl(Ln, 1.7), LOOK.cov, { r: 0.03, sym: 'i' });
    dl.label(add(tip, scl(unit(tip), 0.18)), tn('ω', ['j']), { c: LOOK.vec, size: 17, sym: 'j' });
    dl.label(scl(Ln, 1.9), tn('L', [], ['i']), { c: LOOK.cov, size: 17, sym: 'i' });
    const ang = Math.acos(clamp(dot(unit(wW), Ln), -1, 1));
    dl.label(null, `${tn('L', [], ['i'])} = ${tn('I', [], ['i', 'j'])} ${tn('ω', ['j'])} &nbsp; <span class="tc-note">angle between ω and L: ${num(ang * 180 / Math.PI, 1)}°</span>`, { screen: [0.5, 0.06], size: 18, c: LOOK.ink });
    dl.label(null, `principal moments ${Ib.map(v => num(v, 3)).join(', ')} &nbsp; |L| = ${num(len(LW), 3)} (constant)`, { screen: [0.5, 0.94], size: 14, c: LOOK.dim });
    dl.read('L', len(LW)); dl.read('E2', E2); dl.read('angle', ang); dl.read('w2', st.w[1]);
  },
};

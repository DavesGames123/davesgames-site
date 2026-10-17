// ============================================================================
//  TENSOR CALCULUS  ·  viz/scenes/spacetime.js  ·  relativity  (VIZ)
// ----------------------------------------------------------------------------
//  lorentz  A 2+1 spacetime diagram (time up). A boost of speed beta along
//      x tilts the worldlines x' = const (the vector e'_0 leans toward the
//      cone) and the planes of simultaneity t' = const (the level sets of
//      the covector dt', which lean the other way). The light cone does not
//      move: events on it slide along it. The tip of e'_0 stays on the
//      hyperbola t^2 - x^2 = 1. Beside it, F_{mu nu} of a field E, B in
//      the new frame: F'_{mu nu} = (L^-1)^a_mu (L^-1)^b_nu F_ab, with the
//      invariants E^2 - B^2 and E . B.
//  flamm  Flamm's paraboloid: the equator slice t = const of the
//      Schwarzschild metric, embedded as z = 2 sqrt(rs (r - rs)). Rings at
//      equal steps of r; beads at equal steps of proper radial distance
//      (they crowd near the throat: g_rr = 1 / (1 - rs/r) grows). A test
//      particle orbit (Binet equation with the 3 M u^2 term) precesses.
//      With 'bridge' on, the lower sheet (Einstein-Rosen bridge).
//
//  DOM-free maths for tests: grep -n "export function"
// ============================================================================
import { LOOK, tn, num, ic } from '../look.js';
import { AX } from './basis.js';
import { add, sub, scl, dot, cross, len, unit, wave, seg, ease, clamp, lerp3, boostX, mat4Vec, fieldTensor, fieldEB, boostF,
  interval, flammZ, properRadial, orbitSchw } from '../vmath.js';

const K = 1.0;   // world units per spacetime unit
// spacetime (t, x, y) -> world (x, t, -y)
const ST = (t, x, y) => [x * K, t * K, -y * K];
// boosted-frame coordinates (t', x', y') -> lab (t, x, y)
export function fromPrimed(beta, tp, xp, yp) {
  const L = boostX(-beta), v = mat4Vec(L, [tp, xp, yp, 0]);
  return [v[0], v[1], v[2]];
}

const fmt4 = (name, M) => `<div class="tc-mat"><span class="tc-mat-n">${name} =</span><span class="tc-br">(</span><span class="tc-grid4">` +
  M.flat().map(x => `<span>${num(x)}</span>`).join('') + `</span><span class="tc-br">)</span></div>`;

export const lorentz = {
  id: 'lorentz',
  label: 'Lorentz boost',
  blurb: 'A boost tilts time and space toward the light cone; the cone itself stays.',
  params: [{ key: 'beta', label: 'speed β', min: -0.85, max: 0.85, step: 0.01, def: null }],
  camera: { pos: [2.2, 1.7, 6.9], target: [0.55, 0.2, 0], fov: 42 },
  fog: 0.03,
  frame(dl, S) {
    const T = S.time;
    const beta = S.p.beta ?? (S.t != null ? 0.75 * ease(S.t) : 0.75 * Math.sin(T * 0.25));
    const g = 1 / Math.sqrt(1 - beta * beta);
    // the light cone, both nappes, up to |t| = 2
    for (const sgn of [1, -1]) {
      dl.surface((u, v) => { const t = 2 * v * sgn, a = 2 * Math.PI * u; return ST(t, Math.abs(t) * Math.cos(a), Math.abs(t) * Math.sin(a)); }, 64, 12, LOOK.light,
        { a: 0.06, closeU: true, wire: { nu: 24, nv: 4, c: LOOK.light, a: 0.2, w: 1 } });
    }
    // lab frame: faint axes
    dl.seg(ST(-2.2, 0, 0), ST(2.2, 0, 0), LOOK.dim, { w: 1, a: 0.35 });
    dl.seg(ST(0, -2.2, 0), ST(0, 2.2, 0), LOOK.dim, { w: 1, a: 0.35 });
    dl.seg(ST(0, 0, -2.2), ST(0, 0, 2.2), LOOK.dim, { w: 1, a: 0.2 });
    dl.label(ST(2.35, 0, 0), 't', { c: LOOK.dim, size: 15 });
    dl.label(ST(0, 2.35, 0), 'x', { c: LOOK.dim, size: 15 });
    // worldlines x' = k of the moving frame (contravariant: along e'_0)
    for (let k = -2; k <= 2; k++) for (const yp of [-1, 0, 1]) {
      const pts = [];
      for (let i = 0; i <= 20; i++) { const tp = -1.6 + 3.2 * i / 20, q = fromPrimed(beta, tp, k * 0.6, yp * 0.8); if (Math.abs(q[0]) < 2.1 && Math.abs(q[1]) < 2.6) pts.push(ST(...q)); }
      dl.poly(pts, ic('mu'), { w: yp === 0 ? 1.8 : 1, a: yp === 0 ? 0.75 : 0.3, sym: 'mu' });
    }
    // simultaneity planes t' = n (covector dt' level sets)
    for (let n = -1; n <= 2; n++) {
      const c = fromPrimed(beta, n * 0.6, 0, 0), ex = fromPrimed(beta, 0, 1.5, 0), ey = [0, 0, 1.4];
      dl.quad(ST(...c), ST(...ex), ST(...ey), ic('nu'), { a: n === 0 ? 0.13 : 0.06, edge: true, edgeA: n === 0 ? 0.8 : 0.35, sym: 'nu' });
    }
    // e'_0 and e'_1, and the hyperbola t^2 - x^2 = 1
    const e0 = fromPrimed(beta, 1, 0, 0), e1 = fromPrimed(beta, 0, 1, 0);
    const hyp = [], hyp2 = [];
    for (let i = 0; i <= 60; i++) { const r = -1.3 + 2.6 * i / 60; hyp.push(ST(Math.cosh(r), Math.sinh(r), 0)); hyp2.push(ST(Math.sinh(r), Math.cosh(r), 0)); }
    dl.poly(hyp, LOOK.gold, { w: 1.4, a: 0.6 }); dl.poly(hyp2, LOOK.gold, { w: 1.4, a: 0.35 });
    dl.arrow(ST(0, 0, 0), ST(...e0), ic('mu'), { r: 0.04, sym: 'mu' });
    dl.arrow(ST(0, 0, 0), ST(...e1), ic('mu'), { r: 0.03, a: 0.8, sym: 'mu' });
    dl.label(add(ST(...e0), [0.1, 0.18, 0]), `${tn('e', [], ['0'])}′`, { c: ic('mu'), size: 16, sym: 'mu' });
    dl.label(add(ST(...e1), [0.2, 0.05, 0]), `${tn('e', [], ['1'])}′`, { c: ic('mu'), size: 16, sym: 'mu' });
    // events on the cone of the moving frame: they stay on the lab cone
    for (let i = 0; i < 12; i++) {
      const a = (2 * Math.PI * i) / 12, q = fromPrimed(beta, 1.2, 1.2 * Math.cos(a), 1.2 * Math.sin(a));
      if (Math.abs(q[0]) < 2.2) dl.ball(ST(...q), 0.045, LOOK.light);
    }
    // the field tensor in the moving frame, and E', B' in a small inset
    const F = fieldTensor([0, 0.8, 0], [0, 0, 0.5]), Fp = boostF(F, beta), eb = fieldEB(Fp);
    const O = [2.5, 1.3, 0.2];
    dl.arrow(O, scl(eb.E, 0.9), LOOK.pos, { r: 0.03 });
    dl.arrow(O, scl(eb.B, 0.9), LOOK.neg, { r: 0.03 });
    dl.label(add(O, scl(eb.E, 1.05)), `E′ = (${eb.E.map(v => num(v)).join(', ')})`, { c: LOOK.pos, size: 13, anchor: 'l' });
    dl.label(add(O, add(scl(eb.B, 1.05), [0, -0.12, 0])), `B′ = (${eb.B.map(v => num(v)).join(', ')})`, { c: LOOK.neg, size: 13, anchor: 'l' });
    for (const ax of [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]]) dl.seg(O, add(O, ax), LOOK.dim, { w: 1, a: 0.4 });
    const E2B2 = dot(eb.E, eb.E) - dot(eb.B, eb.B), EB = dot(eb.E, eb.B);
    dl.label(null, `β = ${num(beta)}, γ = ${num(g, 3)} &nbsp; ${tn('F', [], ['μ', 'ν'])}′ = ${tn('Λ', ['α'], ['μ'])}${tn('Λ', ['β'], ['ν'])}${tn('F', [], ['α', 'β'])} &nbsp; <span class="tc-note">(Λ here is the inverse boost)</span>`, { screen: [0.5, 0.06], size: 16, c: LOOK.ink });
    dl.label(null, fmt4(`${tn('F', [], ['μ', 'ν'])}′`, Fp), { screen: [0.03, 0.2], size: 12, c: LOOK.ink, anchor: 'l' });
    dl.label(null, `E² − B² = ${num(E2B2, 3)} &nbsp; E·B = ${num(EB, 3)} &nbsp; (the same in every frame)`, { screen: [0.5, 0.94], size: 14, c: LOOK.gold });
    dl.read('beta', beta); dl.read('E2B2', E2B2); dl.read('EB', EB);
    dl.read('e0interval', -interval([e0[0], e0[1], e0[2], 0]));
  },
};

// ---- Flamm's paraboloid ----------------------------------------------------------
const RS = 1, SC = 0.42, RMAX = 9;
const fy = r => (flammZ(r, RS) - flammZ(RMAX, RS)) * SC;   // rim at y = 0, throat below
const FP = (r, ph, sheet = 1) => [r * Math.cos(ph) * SC, sheet > 0 ? fy(r) : -fy(r) - 2 * flammZ(RMAX, RS) * SC, r * Math.sin(ph) * SC];
const ORBIT = orbitSchw(RS / 2, 8, 2.0, 12000, 0.01);

export const flamm = {
  id: 'flamm',
  label: "Flamm's paraboloid",
  blurb: 'The space around a black hole: equal steps of r are longer and longer near the throat.',
  params: [{ key: 'bridge', label: 'Einstein-Rosen bridge', min: 0, max: 1, step: 1, def: 0 }],
  camera: { pos: [3.6, 2.0, 4.6], target: [0, -1.0, 0], fov: 42 },
  fog: 0.03,
  frame(dl, S) {
    const T = S.time, bridge = !!S.p.bridge;
    const sheets = bridge ? [1, -1] : [1];
    for (const sh of sheets) {
      dl.surface((u, v) => FP(RS + (RMAX - RS) * v * v, 2 * Math.PI * u, sh), 72, 28, (u, v) => {
        const r = RS + (RMAX - RS) * v * v, k = Math.min(1, Math.sqrt(RS / r));
        return [0.08 + 0.25 * k * k, 0.1 + 0.08 * k, 0.24 - 0.04 * k];
      }, { closeU: true, a: 1, wire: { nu: 24, nv: 0.0001, c: '#8ea2d8', a: 0.18, w: 1, lift: 0.004 } });
      // rings at equal steps of r
      for (let r = 1.5; r <= RMAX; r += 0.5) {
        const ring = [];
        for (let i = 0; i <= 96; i++) ring.push(add(FP(r, (2 * Math.PI * i) / 96, sh), [0, 0.006, 0]));
        dl.poly(ring, '#8ea2d8', { w: Number.isInteger(r) ? 1.4 : 1, a: Number.isInteger(r) ? 0.4 : 0.18 });
      }
    }
    // equal proper distance beads along one meridian: g_rr = 1 / (1 - rs/r)
    const ph0 = -0.6;
    for (let k = 0; k <= 14; k++) {
      const target = k * 0.6;
      let lo = RS, hi = RMAX;
      for (let it = 0; it < 50; it++) { const mid = (lo + hi) / 2; if (properRadial(mid, RS) < target) lo = mid; else hi = mid; }
      if (hi >= RMAX - 1e-3) break;
      dl.ball(add(FP(hi, ph0), [0, 0.02, 0]), 0.035, LOOK.gold);
    }
    const mer = [];
    for (let i = 0; i <= 60; i++) mer.push(add(FP(RS + (RMAX - RS) * (i / 60) ** 2, ph0), [0, 0.01, 0]));
    dl.poly(mer, LOOK.gold, { w: 1.4, a: 0.5 });
    // the orbit: a trail and the particle
    const steps = ORBIT.length, k = Math.floor((T * 40) % steps);
    const tail = Math.max(0, k - 2200), pts = [];
    for (let i = tail; i <= k; i += 4) pts.push(add(FP(ORBIT[i][0], ORBIT[i][1]), [0, 0.03, 0]));
    dl.poly(pts, ic('mu'), { w: 1.8, a: 0.85, sym: 'mu' });
    const P = add(FP(ORBIT[k][0], ORBIT[k][1]), [0, 0.04, 0]);
    dl.ball(P, 0.07, ic('mu'), { sym: 'mu' });
    // the photon sphere r = 1.5 rs and the throat r = rs
    dl.label(add(FP(RS, 0.4), [0, -0.15, 0]), `throat r = r<sub>s</sub>`, { c: LOOK.dim, size: 13 });
    dl.label(add(FP(RMAX, ph0), [0.2, 0.15, 0]), 'equal proper distance', { c: LOOK.gold, size: 13, anchor: 'l' });
    dl.label(null, `d<i>s</i>² = −(1 − r<sub>s</sub>/r) d<i>t</i>² + d<i>r</i>² / (1 − r<sub>s</sub>/r) + r² dΩ²`, { screen: [0.5, 0.06], size: 17, c: LOOK.ink });
    dl.label(null, `${tn('g', [], ['r', 'r'])} = ${num(1 / (1 - RS / ORBIT[k][0]), 3)} at the particle (r = ${num(ORBIT[k][0] / RS)} r<sub>s</sub>)`, { screen: [0.5, 0.94], size: 14, c: ic('mu') });
    dl.read('r', ORBIT[k][0]); dl.read('grr', 1 / (1 - RS / ORBIT[k][0]));
  },
};

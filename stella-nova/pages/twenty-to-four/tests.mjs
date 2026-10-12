// ============================================================================
//  TWENTY TO FOUR  ·  tests.mjs — node stella-nova/pages/twenty-to-four/tests.mjs
// ----------------------------------------------------------------------------
//  FIELD (field.js)
//    falloff     near field |E| r³ constant, far field |E| r constant,
//                the three terms equal at kr = 1
//    pattern     radiated power per solid angle ∝ sin²θ
//    laws        ∇·B = 0, ∇·E = 0, ∇×E = −∂B/∂t, ∇×B = ∂E/∂t away from
//                the source (c = 1)
//    potentials  E = −∇φ − ∂A/∂t, B = ∇×A, Lorenz condition
//    gauge       A + ∇χ, φ − ∂χ/∂t give the same E and B
//    lines       E is tangent to the level lines of Q
//    reduction   the three written-out curl lines equal the ε_ijk vector
//                curl and the loop circulation over area; the three
//                ∂_iF_i terms equal the cube's face-pair fluxes over volume
//    forms       dF = 0 and d⋆F = 0 in all four components, and each
//                component equals the vector law it names
//  The page tests (story, equations, shaders) are added with the layout.
// ============================================================================
import * as f from './field.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);
const norm = v => Math.hypot(...v);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const k = f.kOf(1);   // λ = 1

// Sample points off the axis and off the source, in general position.
const PTS = [[0.55, 0.12, 0.35], [-0.3, 0.7, -0.4], [1.3, -0.9, 0.6], [0.2, 0.05, -0.25], [2.4, 1.1, -1.7]];
const TS = [0, 0.137, 0.61];

// ── falloff ───────────────────────────────────────────────────────────────
{
  const r0 = 0.002, a = f.ampE(r0, Math.PI / 2, k) * r0 ** 3, b = f.ampE(2 * r0, Math.PI / 2, k) * (2 * r0) ** 3;
  ok(rel(a, b) < 0.01, 'falloff: near field |E| r³ is constant (kr ≪ 1)', `ratio ${(a / b).toFixed(5)}`);
  const R = 60, c = f.ampE(R, Math.PI / 2, k) * R, d = f.ampE(2 * R, Math.PI / 2, k) * 2 * R;
  ok(rel(c, d) < 0.01, 'falloff: far field |E| r is constant (kr ≫ 1)', `ratio ${(c / d).toFixed(5)}`);
  // Log slope of |E| between two radii: −3 near, −1 far.
  const slope = (r1, r2) => Math.log(f.ampE(r2, Math.PI / 2, k) / f.ampE(r1, Math.PI / 2, k)) / Math.log(r2 / r1);
  const sn = slope(0.001, 0.002), sf = slope(40, 80);
  ok(Math.abs(sn + 3) < 0.02 && Math.abs(sf + 1) < 0.02, 'falloff: log slope −3 near, −1 far', `near ${sn.toFixed(3)}, far ${sf.toFixed(3)}`);
  const t = f.termAmps(1);
  ok(t[0] === 1 && t[1] === 1 && t[2] === 1, 'falloff: the three terms are equal at kr = 1');
}

// ── pattern ───────────────────────────────────────────────────────────────
{
  const R = 80, p90 = f.powerPattern(R, Math.PI / 2, k);
  let worst = 0;
  for (const th of [0.3, 0.6, 0.9, 1.2, 2.0, 2.6]) worst = Math.max(worst, rel(f.powerPattern(R, th, k) / p90, Math.sin(th) ** 2));
  ok(worst < 0.01 && p90 > 0, 'pattern: radiated power per solid angle is ∝ sin²θ', `worst relative error ${worst.toExponential(2)}`);
  ok(Math.abs(f.powerPattern(R, 1e-4, k) / p90) < 1e-6, 'pattern: no power along the axis');
}

// ── laws ──────────────────────────────────────────────────────────────────
{
  let dB = 0, dE = 0, far = 0, amp = 0;
  const E = [0, 0, 0], B = [0, 0, 0], Et = [0, 0, 0], Bt = [0, 0, 0];
  for (const P of PTS) for (const t of TS) {
    const FE = f.fieldFn('E', t, k), FB = f.fieldFn('B', t, k);
    const sc = f.ampE(norm(P), Math.acos(P[2] / norm(P)), k) * k;   // a natural size for a derivative here
    dB = Math.max(dB, Math.abs(f.divFD(FB, P, 1e-4)) / sc);
    dE = Math.max(dE, Math.abs(f.divFD(FE, P, 1e-4)) / sc);
    f.dEdt(P[0], P[1], P[2], t, k, Et, Bt);
    far = Math.max(far, norm(f.curlFD(FE, P, 1e-4).map((v, i) => v + Bt[i])) / sc);
    amp = Math.max(amp, norm(f.curlFD(FB, P, 1e-4).map((v, i) => v - Et[i])) / sc);
    f.EB(P[0], P[1], P[2], t, k, E, B);
  }
  ok(dB < 1e-6, 'laws: ∇·B = 0', `max ${dB.toExponential(2)}`);
  ok(dE < 1e-6, 'laws: ∇·E = 0 away from the source', `max ${dE.toExponential(2)}`);
  ok(far < 1e-6, 'laws: ∇×E = −∂B/∂t (Faraday)', `max ${far.toExponential(2)}`);
  ok(amp < 1e-6, 'laws: ∇×B = ∂E/∂t (Ampère–Maxwell in vacuum, c = 1)', `max ${amp.toExponential(2)}`);
  // The closed-form time derivative agrees with a finite difference in t.
  const P = PTS[0], h = 1e-6, a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], d = [0, 0, 0];
  f.EB(...P, 0.3 + h, k, a, c); f.EB(...P, 0.3 - h, k, b, d); f.dEdt(...P, 0.3, k, Et, Bt);
  ok(rel(norm(Et), norm(a.map((v, i) => (v - b[i]) / (2 * h)))) < 1e-6, 'laws: closed-form ∂E/∂t agrees with a finite difference');
}

// ── potentials ────────────────────────────────────────────────────────────
function fromPotentials(P, t, pot) {
  const h = 1e-5, g = [0, 0, 0], Ab = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let j = 0; j < 3; j++) {
    const p = P.slice(), m = P.slice(); p[j] += h; m[j] -= h;
    const a = pot(...p, t), b = pot(...m, t);
    g[j] = (a[0] - b[0]) / (2 * h);
    for (let i = 0; i < 3; i++) Ab[i][j] = (a[i + 1] - b[i + 1]) / (2 * h);
  }
  const ap = pot(...P, t + h), am = pot(...P, t - h);
  const dA = [1, 2, 3].map(i => (ap[i] - am[i]) / (2 * h));
  const dphi = (ap[0] - am[0]) / (2 * h);
  const E = [0, 1, 2].map(i => -g[i] - dA[i]);
  const B = [Ab[2][1] - Ab[1][2], Ab[0][2] - Ab[2][0], Ab[1][0] - Ab[0][1]];
  return { E, B, lorenz: Ab[0][0] + Ab[1][1] + Ab[2][2] + dphi };
}
{
  let eE = 0, eB = 0, eL = 0;
  const E = [0, 0, 0], B = [0, 0, 0];
  for (const P of PTS) for (const t of TS) {
    const r = fromPotentials(P, t, (x, y, z, tt) => f.potentials(x, y, z, tt, k));
    f.EB(...P, t, k, E, B);
    const s = Math.max(norm(E), 1e-3);
    eE = Math.max(eE, norm(sub(r.E, E)) / s); eB = Math.max(eB, norm(sub(r.B, B)) / s); eL = Math.max(eL, Math.abs(r.lorenz) / (s * k));
  }
  ok(eE < 1e-5, 'potentials: E = −∇φ − ∂A/∂t', `max ${eE.toExponential(2)}`);
  ok(eB < 1e-5, 'potentials: B = ∇×A', `max ${eB.toExponential(2)}`);
  ok(eL < 1e-5, 'potentials: Lorenz condition ∇·A + ∂φ/∂t = 0', `max ${eL.toExponential(2)}`);
}

// ── gauge ─────────────────────────────────────────────────────────────────
{
  let worst = 0, moved = 0;
  const c = [0.6, 0, 0.3], w = 0.35, g = 0.8;
  for (const P of [[0.55, 0.05, 0.35], [0.8, -0.1, 0.1], [0.4, 0.2, 0.5]]) for (const t of TS) {
    const plain = fromPotentials(P, t, (x, y, z, tt) => f.potentials(x, y, z, tt, k));
    const gauged = fromPotentials(P, t, (x, y, z, tt) => {
      const p = f.potentials(x, y, z, tt, k), G = f.gauge(x, y, z, tt, k, g, c, w);
      return [p[0] - G[4], p[1] + G[1], p[2] + G[2], p[3] + G[3]];
    });
    const s = Math.max(norm(plain.E), 1e-3);
    worst = Math.max(worst, norm(sub(gauged.E, plain.E)) / s, norm(sub(gauged.B, plain.B)) / s);
    const G = f.gauge(...P, t, k, g, c, w);
    moved = Math.max(moved, Math.hypot(G[1], G[2], G[3]));
  }
  ok(moved > 0.5, 'gauge: the blob changes A a lot', `max |∇χ| ${moved.toFixed(2)}`);
  ok(worst < 1e-5, 'gauge: E and B do not change', `max ${worst.toExponential(2)}`);
}

// ── lines ─────────────────────────────────────────────────────────────────
{
  let worst = 0;
  const E = [0, 0, 0], B = [0, 0, 0], h = 1e-6;
  for (const [x, z] of [[0.4, 0.3], [0.9, -0.6], [0.15, 0.05], [1.7, 1.2], [0.33, 0]]) for (const t of TS) {
    f.EB(x, 0, z, t, k, E, B);
    const gx = (f.fluxQ(x + h, z, t, k) - f.fluxQ(x - h, z, t, k)) / (2 * h), gz = (f.fluxQ(x, z + h, t, k) - f.fluxQ(x, z - h, t, k)) / (2 * h);
    const c = Math.abs(E[0] * gx + E[2] * gz) / (Math.hypot(E[0], E[2]) * Math.hypot(gx, gz) + 1e-300);
    worst = Math.max(worst, c);
  }
  ok(worst < 1e-6, 'lines: E is tangent to the level lines of Q (|cos| of E with ∇Q)', `max ${worst.toExponential(2)}`);
  // B_φ = ∂Q/∂t / ρ
  const x = 0.7, z = 0.2, t = 0.25, ht = 1e-6;
  f.EB(x, 0, z, t, k, E, B);
  const dQ = (f.fluxQ(x, z, t + ht, k) - f.fluxQ(x, z, t - ht, k)) / (2 * ht);
  ok(rel(dQ / x, B[1]) < 1e-6, 'lines: B_φ = (∂Q/∂t)/ρ');
}

// ── reduction ─────────────────────────────────────────────────────────────
{
  let c1 = 0, c2 = 0, d1 = 0;
  for (const P of PTS) for (const which of ['E', 'B']) {
    const F = f.fieldFn(which, 0.2, k);
    const lines = f.curlFD(F, P, 1e-5), vec = f.curlLC(F, P, 1e-5);
    const s = Math.max(norm(lines), 1e-6);
    c1 = Math.max(c1, norm(sub(lines, vec)) / s);
    const h = 2e-3, loop = [0, 1, 2].map(a => f.circulation(F, P, a, h) / (h * h));
    c2 = Math.max(c2, norm(sub(lines, loop)) / s);
    const J = f.jacobian(F, P, 1e-5), fl = f.faceFlux(F, P, h);
    const pairs = [0, 1, 2].map(a => (fl[2 * a] + fl[2 * a + 1]) / h ** 3);
    const sc = Math.max(Math.abs(J[0][0]), Math.abs(J[1][1]), Math.abs(J[2][2]), 1e-6);
    d1 = Math.max(d1, ...[0, 1, 2].map(a => Math.abs(pairs[a] - J[a][a]) / sc));
  }
  ok(c1 < 1e-9, 'reduction: three curl lines = ε_ijk ∂_j F_k', `max ${c1.toExponential(2)}`);
  ok(c2 < 1e-3, 'reduction: loop circulation / area = curl component, three planes', `max ${c2.toExponential(2)}`);
  ok(d1 < 1e-3, 'reduction: face-pair flux / volume = ∂_i F_i, three axes', `max ${d1.toExponential(2)}`);
  ok(f.eps3(0, 1, 2) === 1 && f.eps3(1, 0, 2) === -1 && f.eps3(0, 0, 2) === 0, 'reduction: Levi-Civita signs');
}

// ── forms ─────────────────────────────────────────────────────────────────
{
  let w1 = 0, w2 = 0;
  for (const P of PTS.slice(0, 3)) for (const t of TS) {
    const s = f.ampE(norm(P), Math.acos(P[2] / norm(P)), k) * k;
    const a = f.dF(...P, t, k), b = f.dStarF(...P, t, k);
    w1 = Math.max(w1, ...a.map(v => Math.abs(v) / s)); w2 = Math.max(w2, ...b.map(v => Math.abs(v) / s));
  }
  ok(w1 < 1e-6, 'forms: dF = 0 in all four components', `max ${w1.toExponential(2)}`);
  ok(w2 < 1e-6, 'forms: d⋆F = 0 in all four components (vacuum)', `max ${w2.toExponential(2)}`);
  // Each component is one written-out law. Fields that break one law at a
  // time must show up in exactly that slot of dF or d⋆F.
  //   dF slots:  (x y z) ∇·B,  (t y z) (∂tB + ∇×E)_x,  (t z x) _y,  (t x y) _z
  //   d⋆F slots: t −∇·E,  x, y, z (∂tE − ∇×B)_x, _y, _z
  const P = [0.3, -0.2, 0.5], z4 = [0, 0, 0];
  const cases = [
    ['B = (x,0,0): ∇·B = 1', () => f.dF(...P, 0, k, 1e-5, (t, x) => [z4, [x, 0, 0]]), [1, 0, 0, 0]],
    ['E = (0,0,x): (∇×E)_y = −1', () => f.dF(...P, 0, k, 1e-5, (t, x) => [[0, 0, x], z4]), [0, 0, -1, 0]],
    ['B = (0,0,t): (∂tB)_z = 1', () => f.dF(...P, 0, k, 1e-5, (t) => [z4, [0, 0, t]]), [0, 0, 0, 1]],
    ['E = (y,0,0): ∇·E = 0, (∇×E)_z = −1', () => f.dF(...P, 0, k, 1e-5, (t, x, y) => [[y, 0, 0], z4]), [0, 0, 0, -1]],
    ['E = (x,0,0): d⋆F_t = −∇·E = −1', () => f.dStarF(...P, 0, k, 1e-5, (t, x) => [[x, 0, 0], z4]), [-1, 0, 0, 0]],
    ['B = (0,x,0): −(∇×B)_z = −1', () => f.dStarF(...P, 0, k, 1e-5, (t, x) => [z4, [0, x, 0]]), [0, 0, 0, -1]],
    ['E = (0,t,0): (∂tE)_y = 1', () => f.dStarF(...P, 0, k, 1e-5, (t) => [[0, t, 0], z4]), [0, 0, 1, 0]],
  ];
  for (const [name, run, want] of cases) {
    const got = run();
    ok(got.every((v, i) => Math.abs(v - want[i]) < 1e-6), 'forms: slot of ' + name, `[${got.map(v => v.toFixed(3)).join(', ')}]`);
  }
  // F is antisymmetric with six independent entries: three E, three B.
  const F = f.tensorF([1, 2, 3], [4, 5, 6]);
  ok(F.every((row, a) => row.every((v, b) => v === -F[b][a])), 'forms: F_{μν} is antisymmetric');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

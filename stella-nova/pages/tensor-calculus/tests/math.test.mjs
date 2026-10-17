// ============================================================================
//  TENSOR CALCULUS  ·  tests/math.test.mjs  (MATH)
// ----------------------------------------------------------------------------
//  node stella-nova/pages/tensor-calculus/tests/math.test.mjs
//  Checks the DOM-free engine tensor/*.js against closed forms: curvature
//  of the sphere, torus, Schwarzschild and FLRW, Christoffel symbols in
//  polar and spherical coordinates, holonomy on the sphere, geodesics,
//  the transformation laws, epsilon-delta identities, einsum against
//  loops, the index TeX parser (40 round trips), the Bianchi identities,
//  numeric evaluation, the written-out sums and every trace builder.
//
//  SECTIONS   (grep -n "^section(" tests/math.test.mjs)
// ============================================================================
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(join(ROOT, 'tensor/index.js'));
const T0 = Date.now();

let pass = 0, fail = 0, current = '';
function section(name) { current = name; }
function check(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${current} :: ${name}\n     ${String(e && e.stack || e).split('\n').slice(0, 3).join('\n     ')}`); }
}
function near(a, b, tol, what = '') {
  if (!(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)))) throw new Error(`${what} ${a} is not ${b} (tol ${tol})`);
}
function ok(c, msg) { if (!c) throw new Error(msg || 'check failed'); }
function eqT(a, b, tol, what = '') {
  a = M.Tensor.from(a); b = M.Tensor.from(b);
  ok(a.data.length === b.data.length, `${what} sizes ${a.data.length} and ${b.data.length}`);
  for (let i = 0; i < a.data.length; i++) near(a.data[i], b.data[i], tol, `${what}[${i}]`);
}
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 * 2 - 1; };
const randT = (shape, variance) => { const t = new M.Tensor(shape, variance); for (let i = 0; i < t.data.length; i++) t.data[i] = rnd(); return t; };

// ---------------------------------------------------------------------------
section('closed-form curvature');
check('sphere of radius r has R = 2/r^2', () => {
  for (const R of [0.5, 1, 2.5]) for (const th of [0.4, 1.0, 2.2]) near(M.scalarCurvature('sphere', [th, 0.3], { R }), 2 / (R * R), 1e-12, `R=${R}`);
});
check('sphere Einstein tensor is zero (2D)', () => { ok(M.einsteinTensor('sphere', [0.9, 0.1], { R: 3 }).maxAbs() < 1e-12); });
check('polar Gamma^r_tt = -r, Gamma^t_rt = 1/r', () => {
  for (const r of [0.5, 2, 7]) {
    const G = M.christoffel('polar', [r, 0.3]);
    near(G.get(0, 1, 1), -r, 1e-13); near(G.get(1, 0, 1), 1 / r, 1e-13); near(G.get(1, 1, 0), 1 / r, 1e-13);
    near(G.get(0, 0, 0), 0, 1e-15); near(G.get(0, 0, 1), 0, 1e-15); near(G.get(1, 1, 1), 0, 1e-15); near(G.get(1, 0, 0), 0, 1e-15);
  }
});
check('spherical Christoffel symbols', () => {
  const [r, th] = [1.7, 0.8], G = M.christoffel('spherical', [r, th, 0.2]);
  near(G.get(0, 1, 1), -r, 1e-13); near(G.get(0, 2, 2), -r * Math.sin(th) ** 2, 1e-13);
  near(G.get(1, 2, 2), -Math.sin(th) * Math.cos(th), 1e-13); near(G.get(2, 1, 2), Math.cos(th) / Math.sin(th), 1e-13);
  near(G.get(1, 0, 1), 1 / r, 1e-13); near(G.get(2, 0, 2), 1 / r, 1e-13);
});
check('flat metrics in curved coordinates have zero Riemann', () => {
  for (const [id, x] of [['polar', [1.3, 0.4]], ['cylindrical', [1.1, 0.5, 0.2]], ['spherical', [1.4, 0.9, 0.3]], ['euclid3', [0.1, 0.2, 0.3]], ['euclid2', [1, 2]]])
    ok(M.riemann(id, x).maxAbs() < 1e-12, id);
});
check('Minkowski is flat: Gamma = 0 and Riemann = 0', () => {
  ok(M.christoffel('minkowski', [0.3, 1, 2, 3]).maxAbs() === 0);
  ok(M.riemann('minkowski', [0.3, 1, 2, 3]).maxAbs() === 0);
  near(M.scalarCurvature('minkowski', [0, 0, 0, 0]), 0, 0);
});
check('Schwarzschild vacuum: Ricci = 0 to 1e-8 at several points', () => {
  for (const [M0, r, th] of [[1, 3, 0.7], [1, 6, 1.2], [2, 4.5, 2.0], [0.5, 1.5, 0.4], [1, 50, 1.5]]) {
    const c = M.curvatureAt('schwarzschild', [0.2, r, th, 0.1], { M: M0 });
    ok(c.Ricci.maxAbs() < 1e-8, `Ricci ${c.Ricci.maxAbs()} at r=${r}`);
    near(c.R, 0, 1e-8);
    ok(c.Riemann.maxAbs() > 1e-4, 'Riemann is not zero');
  }
});
check('Schwarzschild Kretschmann scalar = 48 M^2 / r^6', () => {
  const [M0, r] = [1.3, 5.2], c = M.curvatureAt('schwarzschild', [0, r, 1.0, 0], { M: M0 });
  const up = M.raise(M.raise(M.raise(c.RiemannDown, 0, c.gInv), 1, c.gInv), 2, c.gInv);
  const up4 = M.raise(up, 3, c.gInv);
  let K = 0; for (let i = 0; i < c.RiemannDown.data.length; i++) K += c.RiemannDown.data[i] * up4.data[i];
  near(K, 48 * M0 * M0 / r ** 6, 1e-10);
});
check('torus: R = 2K with K = cos v / (a (R + a cos v))', () => {
  for (const [Rm, a] of [[2, 0.7], [3, 1], [1.2, 0.5]]) for (const v of [0, 0.9, Math.PI / 2, 2.5, Math.PI]) {
    const K = Math.cos(v) / (a * (Rm + a * Math.cos(v)));
    near(M.scalarCurvature('torus', [0.4, v], { R: Rm, a }), 2 * K, 1e-11, `v=${v}`);
  }
});
check('FLRW: R = 6 (a"/a + (a\'/a)^2 + k/a^2) and Weyl = 0', () => {
  for (const k of [-1, 0, 1]) for (const p of [2 / 3, 0.5]) {
    const t = 1.7, a = t ** p, ad = p * t ** (p - 1), add = p * (p - 1) * t ** (p - 2);
    const c = M.curvatureAt('flrw', [t, 0.3, 1.1, 0.2], { k, p });
    near(c.R, 6 * (add / a + (ad / a) ** 2 + k / (a * a)), 1e-10, `k=${k} p=${p}`);
    ok(c.Weyl.maxAbs() < 1e-10, `Weyl ${c.Weyl.maxAbs()}`);
  }
});
check('Weyl: equals Riemann in vacuum, zero in 3D', () => {
  const c = M.curvatureAt('schwarzschild', [0, 4, 1, 0], { M: 1 });
  eqT(c.Weyl, c.RiemannDown, 1e-9, 'Weyl');
  ok(M.weyl('spherical', [1, 1, 1]).maxAbs() < 1e-12);
});
check('Riemann symmetries R_abcd = -R_bacd = -R_abdc = R_cdab', () => {
  const c = M.curvatureAt('schwarzschild', [0, 3.3, 0.8, 0], { M: 1 });
  const R = c.RiemannDown, n = 4;
  for (const [a, b, cc, d] of M.indexTuples([n, n, n, n])) {
    const v = R.get(a, b, cc, d);
    near(v, -R.get(b, a, cc, d), 1e-10); near(v, -R.get(a, b, d, cc), 1e-10); near(v, R.get(cc, d, a, b), 1e-10);
  }
});

// ---------------------------------------------------------------------------
section('Bianchi identities');
check('first Bianchi: R^r_[smn] = 0', () => {
  for (const [id, x, p] of [['schwarzschild', [0, 4, 1, 0], { M: 1 }], ['flrw', [1.5, 0.4, 1, 0.2], { k: 1, p: 0.6 }], ['torus', [0.3, 0.8], {}]]) {
    const R = M.riemann(id, x, p), n = R.shape[0];
    for (const [r, s, m, q] of M.indexTuples([n, n, n, n])) near(R.get(r, s, m, q) + R.get(r, m, q, s) + R.get(r, q, s, m), 0, 1e-10, id);
  }
});
check('second Bianchi: nabla_[l R_rs]mn = 0 (Schwarzschild, numeric)', () => {
  const p = { M: 1 }, x = [0, 3.5, 1.1, 0.4];
  const D = M.covariantDerivative('schwarzschild', y => M.curvatureAt('schwarzschild', y, p).RiemannDown, x, { params: p, h: 2e-3 });
  let worst = 0, scale = 0;
  for (const [r, s, m, q, l] of M.indexTuples([4, 4, 4, 4, 4])) {
    worst = Math.max(worst, Math.abs(D.get(r, s, m, q, l) + D.get(r, s, q, l, m) + D.get(r, s, l, m, q)));
    scale = Math.max(scale, Math.abs(D.get(r, s, m, q, l)));
  }
  ok(scale > 1e-3, 'derivative is not trivial');
  ok(worst < 1e-8, `cyclic sum ${worst}`);
});
check('contracted Bianchi: nabla_m G^m_n = 0 (FLRW, numeric)', () => {
  const p = { k: 1, p: 0.6 }, x = [1.4, 0.35, 1.0, 0.3];
  const field = y => { const c = M.curvatureAt('flrw', y, p); return M.raise(c.Einstein, 0, c.gInv); };
  const D = M.covariantDerivative('flrw', field, x, { params: p, h: 1e-3 });
  const div = M.contract(D, 0, 2);
  ok(field(x).maxAbs() > 1e-2);
  ok(div.maxAbs() < 1e-7, `divergence ${div.maxAbs()}`);
});

// ---------------------------------------------------------------------------
section('transport and geodesics');
check('holonomy around a colatitude circle = 2 pi (1 - cos theta0)', () => {
  for (const th0 of [0.3, 0.8, 1.2, Math.PI / 2]) {
    const tr = M.parallelTransport('sphere', s => [th0, 2 * Math.PI * s], [1, 0], { steps: 600 });
    const ang = M.angleBetween('sphere', [th0, 0], [1, 0], tr.final);
    let want = 2 * Math.PI * (1 - Math.cos(th0));
    want = Math.atan2(Math.sin(want), Math.cos(want));
    near(ang, want, 1e-8, `theta0=${th0}`);
    near(M.inner('sphere', [th0, 0], tr.final, tr.final), 1, 1e-9, 'length kept');
  }
});
check('trace builder reports the same holonomy', () => {
  const tr = M.traceParallelTransport('sphere', s => [1.0, 2 * Math.PI * s], [1, 0]);
  near(tr.holonomy, 2 * Math.PI * (1 - Math.cos(1.0)), 1e-8);
});
check('sphere geodesic stays on a great circle and keeps its speed', () => {
  const x0 = [1.0, 0.2], v0 = [0.3, 0.9];
  const gd = M.geodesic('sphere', x0, v0, { steps: 800, length: 6 });
  const E = M.METRICS.sphere.embed, p = { R: 1 };
  const a = E(gd.x[0], p), b = E(gd.x[5], p);
  const nrm = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (const x of gd.x) { const q = E(x, p); near(q[0] * nrm[0] + q[1] * nrm[1] + q[2] * nrm[2], 0, 1e-8, 'plane'); }
  const sp0 = M.inner('sphere', x0, v0, v0);
  near(M.inner('sphere', gd.final.x, gd.final.v, gd.final.v), sp0, 1e-9, 'speed');
});
check('polar-coordinate geodesic is a straight line', () => {
  const gd = M.geodesic('polar', [1, 0], [0, 1], { steps: 400, length: 2 });
  for (const [r, t] of gd.x) near(r * Math.cos(t), 1, 1e-9, 'x = 1');
  near(gd.final.x[0] * Math.sin(gd.final.x[1]), 2, 1e-9, 'y = s');
});
check('Schwarzschild circular orbit at r = 6M stays circular', () => {
  const Mm = 1, r = 6, w = Math.sqrt(Mm / r ** 3), f = 1 - 2 * Mm / r;
  const ut = 1 / Math.sqrt(f - r * r * w * w);
  const gd = M.geodesic('schwarzschild', [0, r, Math.PI / 2, 0], [ut, 0, 0, ut * w], { steps: 2000, length: 200 });
  for (const x of gd.x) near(x[1], r, 1e-6, 'r');
});

// ---------------------------------------------------------------------------
section('algebra and transformations');
check('transform round trip with J then J^-1', () => {
  const J = [[2, 1, 0], [0.5, 1, 0.3], [0, -1, 1.5]];
  const Ji = M.matInverse(J);
  for (const v of [['u'], ['d'], ['u', 'd'], ['d', 'd'], ['u', 'u', 'd']]) {
    const t = randT(v.map(() => 3), v);
    eqT(M.transform(M.transform(t, J), Ji), t, 1e-12, v.join(''));
  }
});
check('contraction V^a W_a is invariant under a transform', () => {
  const J = [[1.2, 0.4], [-0.3, 0.9]];
  const V = randT([2], ['u']), W = randT([2], ['d']);
  const before = M.einsum('a,a->', V, W).data[0];
  const after = M.einsum('a,a->', M.transform(V, J), M.transform(W, J)).data[0];
  near(after, before, 1e-12);
});
check('Cartesian metric transformed to polar gives diag(1, r^2)', () => {
  const r = 1.8, th = 0.6, X = [r * Math.cos(th), r * Math.sin(th)];
  const { J } = M.jacobianOf(M.COORD_MAPS.cartesianToPolar.f, X); // new (r, theta) by old (x, y)
  const g = M.transform(M.Tensor.fromNested([[1, 0], [0, 1]], 'dd'), J);
  eqT(g, [[1, 0], [0, r * r]], 1e-12, 'g');
  eqT(M.Tensor.fromNested(M.metricAt('polar', [r, th])), g, 1e-12, 'metricAt');
});
check('spherical metric from the Cartesian one by the inverse Jacobian', () => {
  const x = [1.3, 0.7, 0.4];
  const { J } = M.jacobianOf(M.COORD_MAPS.sphericalToCartesian.f, x); // d(x,y,z)/d(r,th,ph): old by new
  const g = M.transform(M.Tensor.fromNested([[1, 0, 0], [0, 1, 0], [0, 0, 1]], 'dd'), M.matInverse(J));
  eqT(g, M.metricAt('spherical', x), 1e-12);
});
check('Lorentz boost keeps eta and E^2 - B^2', () => {
  const L = M.lorentzBoost(0.6, 1), eta = M.Tensor.fromNested(M.metricAt('minkowski', [0, 0, 0, 0]), 'dd');
  eqT(M.transform(eta, M.matInverse(L)), eta, 1e-12, 'eta');
  const E = [0.3, -0.5, 0.8], B = [0.2, 0.7, -0.1];
  const F = M.Tensor.fromNested([[0, -E[0], -E[1], -E[2]], [E[0], 0, -B[2], B[1]], [E[1], B[2], 0, -B[0]], [E[2], -B[1], B[0], 0]], 'uu');
  const inv = t => { const Fd = M.lower(M.lower(t, 0, eta), 1, eta); let s = 0; for (let i = 0; i < 16; i++) s += Fd.data[i] * t.data[i]; return s; };
  near(inv(M.transform(F, L)), inv(F), 1e-12);
  near(inv(F), 2 * (B.reduce((a, b) => a + b * b, 0) - E.reduce((a, b) => a + b * b, 0)), 1e-12, 'F F = 2(B^2 - E^2)');
});
check('raise then lower is the identity', () => {
  const g = M.metricAt('spherical', [1.5, 0.8, 0.3]), gi = M.matInverse(g);
  const t = randT([3, 3, 3], ['d', 'u', 'd']);
  eqT(M.lower(M.raise(t, 0, gi), 0, g), t, 1e-12, 'slot 0');
  eqT(M.raise(M.lower(t, 1, g), 1, gi), t, 1e-12, 'slot 1');
});
check('contraction of delta gives the dimension', () => {
  for (const n of [2, 3, 4, 7]) near(M.contract(M.kroneckerDelta(n), 0, 1).data[0], n, 0);
});
check('contract refuses two lower slots with a clear message', () => {
  let msg = '';
  try { M.contract(randT([3, 3], ['d', 'd']), 0, 1); } catch (e) { msg = e.message; }
  ok(/both lower/.test(msg) && /metric/.test(msg), msg);
});
check('epsilon identities', () => {
  const e3 = M.leviCivita(3), d = M.kroneckerDelta(3, ['d', 'd']);
  const lhs = M.einsum('ijk,imn->jkmn', e3, e3);
  const rhs = M.einsum('jm,kn->jkmn', d, d).sub(M.einsum('jn,km->jkmn', d, d));
  eqT(lhs, rhs, 0, 'eps eps = dd - dd');
  near(M.einsum('ijk,ijk->', e3, e3).data[0], 6, 0);
  eqT(M.einsum('ijk,ijn->kn', e3, e3), M.kroneckerDelta(3).scale(2), 0, 'eps_ijk eps_ijn = 2 delta');
  const e4 = M.leviCivita(4);
  near(M.einsum('abcd,abcd->', e4, e4).data[0], 24, 0);
});
check('determinant through epsilon equals matDet', () => {
  const A = [[2, 1, 0.5], [0.3, -1, 2], [1, 0, 1]];
  const e3 = M.leviCivita(3);
  near(M.einsum('ijk,i,j,k->', e3, A.map(r => r[0]), A.map(r => r[1]), A.map(r => r[2])).data[0], M.matDet(A), 1e-12);
});
check('einsum equals manual loops', () => {
  const A = randT([3, 4], 'ud'), B = randT([4, 2], 'ud'), C = randT([3, 4, 2], 'udd'), S = randT([3, 3], 'ud');
  const mm = M.einsum('ij,jk->ik', A, B);
  for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) { let s = 0; for (let j = 0; j < 4; j++) s += A.get(i, j) * B.get(j, k); near(mm.get(i, k), s, 1e-14); }
  let tr = 0; for (let i = 0; i < 3; i++) tr += S.get(i, i);
  near(M.einsum('ii', S).data[0], tr, 1e-14, 'implicit trace');
  const o = M.einsum('i,j->ij', [1, 2], [3, 4, 5]);
  near(o.get(1, 2), 10, 0);
  const t3 = M.einsum('ijk,jk->i', C, M.einsum('ij,jk->ik', randT([4, 4], 'ud'), B));
  ok(t3.shape.length === 1 && t3.shape[0] === 3);
  const imp = M.einsum('ijk,ja', C, randT([4, 5], 'ud'));
  ok(imp.shape.join() === '5,3,2', `implicit output shape ${imp.shape}`);
  const Dm = randT([3, 4, 2], 'udd'), E = randT([2, 4], 'uu');
  const r = M.einsum('ijk,kj->i', Dm, E);
  for (let i = 0; i < 3; i++) { let s = 0; for (let j = 0; j < 4; j++) for (let k = 0; k < 2; k++) s += Dm.get(i, j, k) * E.get(k, j); near(r.get(i), s, 1e-14); }
  ok(r.variance[0] === 'u');
});
check('symmetrize and antisymmetrize split a rank-2 tensor', () => {
  const t = randT([3, 3], 'dd');
  eqT(M.symmetrize(t).add(M.antisymmetrize(t)), t, 1e-15);
  eqT(M.symmetrize(M.symmetrize(t)), M.symmetrize(t), 1e-15, 'idempotent');
  const a3 = M.antisymmetrize(randT([3, 3, 3], 'ddd'));
  for (const [i, j, k] of M.indexTuples([3, 3, 3])) near(a3.get(i, j, k), -a3.get(j, i, k), 1e-15);
});
check('trace with a metric and transpose', () => {
  const t = M.Tensor.fromNested([[1, 2], [3, 4]], 'dd');
  near(M.trace(t, 0, 1, [[1, 0], [0, 0.5]]).data[0], 1 + 2, 1e-15);
  eqT(M.transpose(t, 0, 1), [[1, 3], [2, 4]], 0);
});
check('product shape and variance', () => {
  const p = M.product(randT([2], 'u'), randT([3, 2], 'dd'));
  ok(p.shape.join() === '2,3,2' && p.variance.join('') === 'udd');
});
check('plain metric g(x) works through finite differences', () => {
  const plain = { id: 'p', dim: 2, g: x => [[4, 0], [0, 4 * Math.sin(x[0]) ** 2]] };
  near(M.scalarCurvature(plain, [1.1, 0.2]), 0.5, 1e-6);
});

// ---------------------------------------------------------------------------
section('index TeX parser');
const ROUND = [
  'R^{\\rho}{}_{\\sigma\\mu\\nu}', 'g_{\\mu\\nu}', '\\partial_\\mu \\phi', '\\nabla_\\mu V^\\nu', '\\Gamma^\\lambda_{\\mu\\nu}',
  '\\delta^a_b', '\\epsilon_{ijk}', 'A_\\mu B^\\mu', 'T_{(ab)}', 'T_{[ab]}',
  'G_{\\mu\\nu} + \\Lambda g_{\\mu\\nu} = \\frac{8\\pi G}{c^4} T_{\\mu\\nu}', 'R_{\\mu\\nu} - \\frac{1}{2} R g_{\\mu\\nu} = 8\\pi T_{\\mu\\nu}',
  'C_i = \\epsilon_{ijk} A^j B^k', '\\nabla_\\mu T^{\\mu\\nu} = 0', 'F_{\\mu\\nu} = \\partial_\\mu A_\\nu - \\partial_\\nu A_\\mu',
  '\\partial_{[\\lambda} F_{\\mu\\nu]} = 0', 'A_{\\mu,\\nu} - A_{\\nu,\\mu}', 'T^{\\mu\\nu}{}_{;\\nu} = 0', 'R^{\\rho}{}_{[\\sigma\\mu\\nu]} = 0',
  '\\ddot{x}^\\mu + \\Gamma^\\mu_{\\nu\\lambda} \\dot{x}^\\nu \\dot{x}^\\lambda = 0', 'ds^2 = g_{\\mu\\nu} dx^\\mu dx^\\nu',
  'T^{\\mu\\nu} = (\\rho + p) u^\\mu u^\\nu + p g^{\\mu\\nu}', 't_i = \\sigma_{ij} n^j', '\\sigma_{ij} = C_{ijkl} \\varepsilon^{kl}',
  'I_{ij} = m (r^2 \\delta_{ij} - r_i r_j)', '\\nabla_\\mu \\xi_\\nu + \\nabla_\\nu \\xi_\\mu = 0', "T'^{a}{}_{b} = J^{a}{}_{c} (J^{-1})^{d}{}_{b} T^{c}{}_{d}",
  'g^{\\mu\\alpha} g_{\\alpha\\nu} = \\delta^\\mu_\\nu', 'x^{\\mu\'} = \\Lambda^{\\mu\'}{}_{\\nu} x^\\nu', 'h_{ij} = Q_{ij} - \\frac{1}{3} \\delta_{ij} Q',
  '\\operatorname{tr} A = A^i{}_i', 'A^{0}', 'g_{01} + g_{10}', '2 A^a - 3 B^a', '-R', '\\frac{1}{2}(T_{ab} + T_{ba})',
  'S = Q^{i}{}_{j} K^{j}{}_{i}', 'R = g^{\\mu\\nu} R_{\\mu\\nu}', '\\nabla_\\mu \\nabla_\\nu \\phi', 'E^{\\mu}{}_{\\nu} = \\frac{1}{4} F^{\\mu\\alpha} F_{\\nu\\alpha}',
];
check(`${ROUND.length} strings parse and print back to the same structure`, () => {
  ok(ROUND.length >= 40, 'at least 40 strings');
  for (const s of ROUND) {
    const e = M.parseIndexTex(s);
    const back = M.parseIndexTex(M.toTex(e, { colors: false }));
    ok(M.exprKey(back) === M.exprKey(e), `round trip of ${s}: ${M.toTex(e, { colors: false })}`);
    const colored = M.toTex(e).replace(/\\class\{i\d\}\{((?:[^{}]|\{[^{}]*\})*)\}/g, '$1');
    ok(M.exprKey(M.parseIndexTex(colored)) === M.exprKey(e), `coloured round trip of ${s}`);
  }
});
check('slot order, kinds and staggering', () => {
  const e = M.parseIndexTex('R^{\\rho}{}_{\\sigma\\mu\\nu}');
  const f = e.terms[0].factors[0];
  ok(f.indices.map(i => (i.up ? '^' : '_') + i.sym).join('') === '^rho_sigma_mu_nu');
  ok(M.parseIndexTex('g^{ab}').terms[0].factors[0].kind === 'inverseMetric');
  ok(M.parseIndexTex('\\Gamma^a_{bc}').terms[0].factors[0].kind === 'christoffel');
  ok(M.parseIndexTex('\\epsilon_{ijk}').terms[0].factors[0].kind === 'epsilon');
  const d = M.parseIndexTex('\\nabla_\\mu V^\\nu').terms[0].factors[0];
  ok(d.deriv[0].sym === 'mu' && d.derivKind === 'nabla' && d.name === 'V');
  const sc = M.parseIndexTex('T^{\\mu\\nu}{}_{;\\nu}').terms[0].factors[0];
  ok(sc.deriv[0].sym === 'nu' && sc.derivStyle === 'semicolon');
  const sy = M.parseIndexTex('T_{a(bc)}').terms[0].factors[0];
  ok(sy.sym[0].type === 'sym' && sy.sym[0].slots.join() === '1,2');
});
check('free indices keep written order; derivative bindings put the derivative last', () => {
  const e = M.parseIndexTex('\\nabla_\\mu V^\\nu');
  ok(e.free.map(i => i.sym).join() === 'mu,nu');
  const D = randT([3, 3], 'ud'); // [nu][mu], derivative slot last
  const r = M.evaluateExpr(e, { 'nabla:V': D });
  eqT(r, M.transpose(D, [1, 0]), 0, 'written order');
  ok(r.variance.join('') === 'du');
  ok(M.validate(M.parseIndexTex("T'^{a}{}_{b} = J^{a}{}_{c} (J^{-1})^{d}{}_{b} T^{c}{}_{d}")).ok);
});
check('free and dummy indices', () => {
  const e = M.parseIndexTex('\\Gamma^\\lambda_{\\mu\\nu} A^\\mu B^\\nu');
  ok(e.free.length === 1 && e.free[0].sym === 'lambda' && e.free[0].up);
  ok(e.dummies.sort().join() === 'mu,nu');
});
check('index colours by first appearance, stable', () => {
  const tex = M.toTex(M.parseIndexTex('A^{b}{}_{a} B^{a}'));
  ok(tex === 'A^{\\class{i0}{b}}{}_{\\class{i1}{a}} B^{\\class{i1}{a}}', tex);
  const map = M.indexColorMap(M.parseIndexTex('\\nabla_\\mu T^{\\mu\\nu}'));
  ok(map.get('mu') === 0 && map.get('nu') === 1);
});
check('parse errors say where and what', () => {
  for (const [s, re] of [['A_{\\mu', /\}/], ['A_\\mu +', /empty/], ['\\sum_i A_i B^i', /sum sign/], ['A^\\mu = = B', /one =/], ['A_{(ab}', /match/], ['A * B', /frac/], ['A_\\mu @', /character/]]) {
    let err = null;
    try { M.parseIndexTex(s); } catch (e) { err = e; }
    ok(err && err.name === 'TexParseError' && re.test(err.message), `${s}: ${err && err.message}`);
  }
});
check('validate: Einstein rule, free indices, friendly messages', () => {
  const v1 = M.validate(M.parseIndexTex('A_\\mu B_\\mu'));
  ok(!v1.ok && /twice as a lower/.test(v1.errors[0].msg) && /metric/.test(v1.errors[0].msg));
  ok(M.validate(M.parseIndexTex('A_\\mu B_\\mu'), { euclidean: true }).ok);
  const v2 = M.validate(M.parseIndexTex('A_\\mu B^\\mu C_\\mu'));
  ok(!v2.ok && /3 times/.test(v2.errors[0].msg));
  const v3 = M.validate(M.parseIndexTex('A_\\mu + B_\\nu'));
  ok(!v3.ok && /same free indices/.test(v3.errors[0].msg));
  const v4 = M.validate(M.parseIndexTex('A_\\mu = B^\\mu'));
  ok(!v4.ok && /same height/.test(v4.errors[0].msg));
  const v5 = M.validate(M.parseIndexTex('R^{\\rho}{}_{\\sigma\\mu\\nu} A^{\\sigma}'));
  ok(v5.ok && v5.rank.up === 1 && v5.rank.down === 2);
  ok(M.validate(M.parseIndexTex('\\nabla_\\mu T^{\\mu\\nu} = 0')).ok, 'a bare 0 matches');
  ok(!M.validate(M.parseIndexTex('\\epsilon_{ij}'), { dim: 3 }).ok);
  ok(M.validate(M.parseIndexTex('\\delta_{ab}')).warnings.length === 1);
  ok(!M.validate(M.parseIndexTex('T_{(a}{}^{b)}')).ok, 'mixed bracket');
});

// ---------------------------------------------------------------------------
section('numeric evaluation');
check('evaluateExpr matches einsum and raises with the metric', () => {
  const G = randT([3, 3, 3], 'udd'), A = randT([3], 'u'), B = randT([3], 'u');
  eqT(M.evaluateExpr(M.parseIndexTex('\\Gamma^{a}_{bc} A^{b} B^{c}'), { Gamma: G, A, B }), M.einsum('abc,b,c->a', G, A, B), 1e-14);
  const g = [[1, 0, 0], [0, 4, 0], [0, 0, 9]];
  const r = M.evaluateExpr(M.parseIndexTex('A_{a}'), { A, g });
  eqT(r, [A.data[0], 4 * A.data[1], 9 * A.data[2]], 1e-14, 'lowered');
  near(M.evaluateExpr(M.parseIndexTex('A_{a} B^{a}'), { A, B, g }).data[0], A.data[0] * B.data[0] + 4 * A.data[1] * B.data[1] + 9 * A.data[2] * B.data[2], 1e-14);
});
check('evaluateExpr: Einstein tensor from Ricci, R and g', () => {
  const c = M.curvatureAt('flrw', [1.5, 0.3, 1, 0.2], { k: 1, p: 0.6 });
  const e = M.parseIndexTex('G_{\\mu\\nu} = R_{\\mu\\nu} - \\frac{1}{2} R g_{\\mu\\nu}');
  const out = M.evaluateExpr(e, { G: c.Einstein, R: c.Ricci, 'scalar:R': c.R, g: c.g });
  near(out.residual, 0, 1e-12, 'residual');
  const e2 = M.parseIndexTex('S_{\\mu\\nu} - \\frac{1}{2} R g_{\\mu\\nu}');
  eqT(M.evaluateExpr(e2, { S: c.Ricci, R: c.R, g: c.g }), c.Einstein, 1e-12, 'G');
});
check('evaluateExpr: digit indices, symmetrization marks, equations', () => {
  const t = M.Tensor.fromNested([[1, 2], [3, 4]], 'dd');
  near(M.evaluateExpr(M.parseIndexTex('T_{01}'), { T: t }).data[0], 2, 0);
  eqT(M.evaluateExpr(M.parseIndexTex('T_{(ab)}'), { T: t }), [[1, 2.5], [2.5, 4]], 1e-15);
  const r = M.evaluateExpr(M.parseIndexTex('T_{(ab)} = \\frac{1}{2}(T_{ab} + T_{ba})'), { T: t });
  near(r.residual, 0, 1e-15);
  near(M.evaluateExpr(M.parseIndexTex('\\delta^{a}_{a}'), {}, { dim: 4 }).data[0], 4, 0);
});
check('expandToComponents writes the sum out with numbers', () => {
  const G = randT([2, 2, 2], 'udd'), A = randT([2], 'u');
  const e = M.parseIndexTex('\\Gamma^{a}_{bc} A^{b} A^{c}');
  const x = M.expandToComponents(e, { bindings: { Gamma: G, A }, values: { a: 1 }, coords: ['r', '\\theta'] });
  ok(x.lines[0].terms.length === 4);
  near(x.lines[0].value, M.evaluateExpr(e, { Gamma: G, A }).get(1), 1e-14);
  ok(/\\class\{i0\}\{\\theta\}/.test(x.lines[0].tex), x.lines[0].tex);
  const all = M.expandToComponents(e, { dim: 2, all: true, colors: false });
  ok(all.lines.length === 2 && all.lines[1].tex.startsWith('\\Gamma^{1}_{00} A^{0} A^{0}'), all.lines[1].tex);
  const nz = M.expandToComponents(M.parseIndexTex('\\epsilon_{ijk} A^{j} B^{k}'), { bindings: { A: [1, 0, 0], B: [0, 1, 0] }, dim: 3, values: { i: 2 }, skipZero: true });
  ok(nz.lines[0].terms.length === 1 && nz.lines[0].value === 1);
});

// ---------------------------------------------------------------------------
section('trace builders');
const KINDS = new Set(['product', 'contract', 'raise', 'lower', 'transform', 'symmetrize', 'antisymmetrize', 'partial', 'covariant', 'christoffel', 'trace', 'expandSum', 'substitute', 'relabel', 'evaluate']);
function checkTrace(tr, what) {
  ok(tr.steps.length >= 1 && tr.dim > 0, what);
  const ids = new Set();
  for (const s of tr.steps) {
    ok(KINDS.has(s.kind), `${what}: kind ${s.kind}`);
    ok(typeof s.label === 'string' && s.label.length > 10 && !/\$[^$]*$/.test(s.label.replace(/\$[^$]*\$/g, '')), `${what}: label ${s.label}`);
    ok(s.before && s.before.terms && s.after && s.after.terms && typeof s.after.tex === 'string', `${what}: exprs`);
    ok(Array.isArray(s.focus) && Array.isArray(s.sums) && s.ms > 0 && !ids.has(s.id), `${what}: fields`);
    ids.add(s.id);
    if (s.numeric) {
      const o = s.numeric.output;
      ok(o && Array.isArray(o.shape) && Array.isArray(o.variance) && o.data instanceof Float64Array && o.data.length === o.shape.reduce((a, b) => a * b, 1), `${what}: numeric output`);
      for (const v of Object.values(s.numeric.inputs)) ok(v.data instanceof Float64Array, `${what}: input`);
    }
  }
}
check('every builder gives a well-formed OpTrace with correct numbers', () => {
  const A = randT([3, 3], 'ud'), V = randT([3], 'u'), W = randT([3], 'd'), g = M.metricAt('spherical', [1.2, 0.8, 0.1]);
  let tr;
  tr = M.traceEinstein('C^{a} = A^{a}{}_{b} V^{b}', { A, V }); checkTrace(tr, 'einstein'); eqT(tr.result, M.einsum('ab,b->a', A, V), 1e-14);
  ok(tr.steps.map(s => s.kind).join() === 'contract,expandSum,evaluate,relabel');
  tr = M.traceProduct(V, W); checkTrace(tr, 'product'); eqT(tr.result, M.product(V, W), 0);
  tr = M.traceContract(A, 0, 1); checkTrace(tr, 'contract'); near(tr.result.data[0], A.get(0, 0) + A.get(1, 1) + A.get(2, 2), 1e-14);
  tr = M.traceRaise(W, 0, g); checkTrace(tr, 'raise'); eqT(tr.result, M.raise(W, 0, M.matInverse(g)), 1e-14); ok(tr.steps[0].kind === 'raise');
  tr = M.traceLower(V, 0, g); checkTrace(tr, 'lower'); eqT(tr.result, M.lower(V, 0, g), 1e-14);
  tr = M.traceTranspose(randT([2, 3], 'dd'), [1, 0]); checkTrace(tr, 'transpose');
  const S = randT([3, 3], 'dd');
  tr = M.traceSymmetrize(S); checkTrace(tr, 'sym'); eqT(tr.result, M.symmetrize(S), 0);
  tr = M.traceAntisymmetrize(S); checkTrace(tr, 'anti'); eqT(tr.result, M.antisymmetrize(S), 0);
  tr = M.traceTrace(A); checkTrace(tr, 'trace'); ok(tr.steps[0].kind === 'trace');
  tr = M.traceTrace(S, { metric: g }); checkTrace(tr, 'trace g'); near(tr.result.data[0], M.trace(S, 0, 1, M.matInverse(g)).data[0], 1e-13);
  tr = M.traceEinsum('ij,jk->ik', A, A); checkTrace(tr, 'einsum'); eqT(tr.result, M.einsum('ij,jk->ik', A, A), 1e-14);
  tr = M.traceLeviCivita([1, 2, 3], [-1, 0, 2]); checkTrace(tr, 'levi'); eqT(tr.result, [4, -5, 2], 1e-14);
  const J = [[1, 0.5, 0], [0, 2, 0], [0.3, 0, 1]];
  tr = M.traceTransform(A, J); checkTrace(tr, 'transform'); eqT(tr.result, M.transform(A, J), 1e-13);
  near(tr.steps[tr.steps.length - 1].invariant.after, tr.steps[tr.steps.length - 1].invariant.before, 1e-12, 'trace kept');
  tr = M.traceChristoffel('polar', [2, 0.3]); checkTrace(tr, 'christoffel'); eqT(tr.result, M.christoffel('polar', [2, 0.3]), 0);
  ok(tr.steps[tr.steps.length - 1].display.nonzero.length === 3);
  tr = M.traceCovariant('polar', [2, 0.3], x => [Math.cos(x[1]), -Math.sin(x[1]) / x[0]]); checkTrace(tr, 'covariant');
  ok(tr.result.maxAbs() < 1e-9, 'a constant Cartesian field has zero covariant derivative');
  tr = M.traceRiemann('sphere', [1, 0.2], { R: 2 }); checkTrace(tr, 'riemann'); near(tr.curvature.R, 0.5, 1e-12);
  tr = M.traceRicci('schwarzschild', [0, 5, 1, 0]); checkTrace(tr, 'ricci'); ok(tr.result.maxAbs() < 1e-8);
  tr = M.traceEinsteinTensor('flrw', [1.5, 0.3, 1, 0.2]); checkTrace(tr, 'einstein tensor'); ok(tr.result.shape.join() === '4,4');
  tr = M.traceParallelTransport('sphere', s => [0.8, 2 * Math.PI * s], [0, 1]); checkTrace(tr, 'transport');
  tr = M.traceGeodesic('sphere', [Math.PI / 2, 0], [0, 1], { length: Math.PI }); checkTrace(tr, 'geodesic'); near(tr.result.data[1], Math.PI, 1e-9);
});
check('the written-out step shows the products and their sum', () => {
  const A = M.Tensor.fromNested([[1, 2], [3, 4]], 'ud'), V = M.Tensor.fromNested([1, -1], 'u');
  const tr = M.traceEinstein('A^{a}{}_{b} V^{b}', { A, V }, { values: { a: 1 } });
  const ex = tr.steps[1];
  ok(ex.kind === 'expandSum' && ex.numeric.output.data.length === 2);
  ok(ex.display.numeric === '(3)(1) + (4)(-1)', ex.display.numeric);
  ok(ex.after.tex === 'A^{1}{}_{0} V^{0} + A^{1}{}_{1} V^{1}', ex.after.tex);
  ok(/: -1\.$/.test(tr.steps[2].label), tr.steps[2].label);
});

// ---------------------------------------------------------------------------
section('metrics');
check('every metric evaluates at its sample point and has its fields', () => {
  for (const m of Object.values(M.METRICS)) {
    ok(m.coords.length === m.dim && m.coordTex.length === m.dim && m.sample.length === m.dim && typeof m.line === 'string', m.id);
    const g = M.metricAt(m, m.sample);
    ok(g.length === m.dim && g.every(r => r.every(Number.isFinite)), m.id);
    const c = M.curvatureAt(m, m.sample);
    ok(Number.isFinite(c.R), m.id);
  }
});
check('engine is DOM-free', () => {
  ok(typeof globalThis.document === 'undefined');
});

const ms = Date.now() - T0;
check('the suite runs in under 10 s', () => ok(ms < 10000, `${ms} ms`));
console.log(`math: ${pass} checks pass, ${fail} fail, ${ms} ms`);
process.exit(fail ? 1 : 0);

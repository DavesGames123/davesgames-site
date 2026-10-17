// ============================================================================
//  library/entries-continuum.js  ·  continuum mechanics: stress, strain,
//  elasticity, momentum balance
// ----------------------------------------------------------------------------
//  Cartesian coordinates with an orthonormal basis: the metric is delta_ij,
//  so an index moves up or down with no change of value. The entries still
//  write each index in its natural place (stress up, gradients down) so the
//  same formulas hold in curvilinear coordinates.
//
//  ENTRIES   (grep -n "id: '<id>'" entries-continuum.js)
//      cauchy-traction  principal-stress  strain-tensor  hooke-isotropic
//      cauchy-momentum
// ============================================================================
import * as M from './math.js';
import { step, trace, check, P, num, vecTex, matTex, wp, MALVERN, LL7 } from './kit.js';

const r = String.raw;
const deg = d => d * Math.PI / 180;
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// Symmetric 3x3 eigenvalues by Jacobi rotations (sorted, largest first).
export function symEigen(A) {
  const a = A.map(r0 => r0.slice()), n = 3, V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(th), s = Math.sin(th);
      for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  const out = [0, 1, 2].map(i => ({ value: a[i][i], vector: [V[0][i], V[1][i], V[2][i]] }));
  return out.sort((x, y) => y.value - x.value);
}

const stressOf = p => [[p.sxx, p.sxy, 0], [p.sxy, p.syy, 0], [0, 0, p.szz ?? 0]];

export const CONTINUUM = [
  // --------------------------------------------------------------------------
  {
    id: 'cauchy-traction', title: 'Cauchy stress and traction', field: 'continuum',
    tex: r`t^{i} = \sigma^{ij}\,n_{j}, \qquad \sigma^{ij} = \sigma^{ji}`,
    itex: r`t^{i} = \sigma^{ij} n_{j}`,
    shape: { rank: 2, variance: 'uu', symmetries: 'symmetric (balance of angular momentum)', independent: 6 },
    story: [
      r`Cut a stressed body with a small plane of unit normal $n$. The material on one side pulls on the other with a force per unit area, the traction $t$. Cauchy's theorem says that $t$ depends linearly on $n$, and the linear map is the stress tensor: $t^{i} = \sigma^{ij}n_{j}$. Nine numbers at a point give the force on every possible cut.`,
      r`The normal is naturally a covector, $n_{j}$, because a plane is the level set of a function and its normal is that function's gradient. The traction is a force, a vector, $t^{i}$. So stress has two upper indices: one for the direction of the force, one for the orientation of the face it acts on. $\sigma^{xy}$ is the $x$ force on a face whose normal points along $y$.`,
      r`Balance of angular momentum on a tiny cube makes $\sigma$ symmetric, so 6 numbers are independent: three normal stresses on the diagonal and three shear stresses off it. Split the traction into a part along $n$ (normal stress, positive in tension) and a part in the plane (shear), and you have the quantities that decide whether a material yields or cracks along that plane.`,
      r`Rotate the cut and watch the traction arrow sweep: it is parallel to $n$ only for the three principal directions, which the next entry finds.`,
    ],
    vocab: [
      { term: 'traction', meaning: 't = sigma n: force per unit area on a cut with normal n.' },
      { term: 'normal stress', meaning: 't . n: tension or compression across the cut.' },
      { term: 'shear stress', meaning: 'The part of the traction in the plane of the cut.' },
    ],
    params: [
      { key: 'sxx', label: 'sigma_xx', min: -3, max: 3, step: 0.05, def: 2 },
      { key: 'syy', label: 'sigma_yy', min: -3, max: 3, step: 0.05, def: -1 },
      { key: 'sxy', label: 'sigma_xy', min: -3, max: 3, step: 0.05, def: 0.8 },
      { key: 'angle', label: 'Normal angle in the xy plane (deg)', min: 0, max: 180, step: 1, def: 30 },
    ],
    trace(params) {
      const p = P(this.params, params), a = deg(p.angle), n = [Math.cos(a), Math.sin(a), 0];
      const S = M.T(stressOf(p), ['u', 'u']), N = M.T(n, ['d']), t = M.einsum('ij,j->i', S, N);
      const tn = dot([...t.data], n), shear = Math.hypot(...[...t.data].map((v, i) => v - tn * n[i]));
      const c = Math.cos(a), s = Math.sin(a);
      return trace([
        step('product', 'Put the stress next to the normal of the cut.', r`\sigma^{ij}`, r`\sigma^{ij} n_{k}`, { focus: ['k'], viz: { scene: 'stress-cube', params: { sigma: stressOf(p), normal: n } } }),
        step('contract', 'Contract the face index with the normal: the traction.', r`\sigma^{ij} n_{k}`, r`t^{i} = \sigma^{ij} n_{j}`, { focus: ['j'], sums: [{ sym: 'j', range: [0, 3] }], numeric: { inputs: { sigma: S, n: N }, output: t } }),
        step('evaluate', 'Split it into normal and shear parts.', r`t^{i}`, r`t^{i} = ${vecTex([...t.data])},\; t^{i} n_{i} = ${num(tn)},\; |t_{\parallel}| = ${num(shear)}`, { focus: [] }),
      ], {
        checks: [
          check('normal stress = sxx c^2 + 2 sxy s c + syy s^2', tn, p.sxx * c * c + 2 * p.sxy * s * c + p.syy * s * s, 1e-12),
          check('shear = |(syy - sxx) s c + sxy (c^2 - s^2)|', shear, Math.abs((p.syy - p.sxx) * s * c + p.sxy * (c * c - s * s)), 1e-12),
        ],
        values: { normal: tn, shear },
      });
    },
    viz: { scene: 'stress-cube', params: { sigma: [[2, 0.8, 0], [0.8, -1, 0], [0, 0, 0]], normal: [0.87, 0.5, 0] } },
    diagram: { style: 'penrose', order: ['\\sigma', 'n'], note: 'The normal covector closes the second leg of sigma.' },
    refs: [wp('Cauchy_stress_tensor'), MALVERN, LL7],
  },
  // --------------------------------------------------------------------------
  {
    id: 'principal-stress', title: 'Principal stresses and invariants', field: 'continuum',
    tex: r`\sigma^{i}{}_{j}\,v^{j} = \lambda\,v^{i}, \qquad I_{1} = \sigma^{i}{}_{i}, \quad I_{2} = \tfrac12\left(\sigma^{i}{}_{i}\sigma^{j}{}_{j} - \sigma^{i}{}_{j}\sigma^{j}{}_{i}\right), \quad I_{3} = \det\sigma`,
    itex: r`\sigma^{i}{}_{j} v^{j} = \lambda v^{i}`,
    shape: { rank: 2, variance: 'ud (one index lowered with delta)', symmetries: 'symmetric', independent: '3 eigenvalues + 3 angles' },
    story: [
      r`Every symmetric stress has three perpendicular directions where the traction is parallel to the normal: no shear at all. They are the eigenvectors of $\sigma^{i}{}_{j}$, and the eigenvalues are the principal stresses. In that frame the stress tensor is diagonal, and the six numbers become three magnitudes plus three angles of orientation.`,
      r`An eigenvalue problem needs a map from vectors to vectors, a $(1,1)$ tensor, so one index of $\sigma^{ij}$ is lowered with the metric. In Cartesian coordinates that changes no numbers, but it explains why the invariants are built from up-down contractions.`,
      r`The invariants $I_{1}, I_{2}, I_{3}$ are the coefficients of the characteristic polynomial $\lambda^{3} - I_{1}\lambda^{2} + I_{2}\lambda - I_{3}$. They are full contractions, so every observer agrees on them: $I_{1}$ is three times the mean pressure (with a minus sign), and the von Mises stress, built from $I_{1}$ and $I_{2}$, predicts when a ductile metal yields.`,
      r`In the 3D view the stress is an ellipsoid whose axes are the principal directions; Mohr's circle is the same information drawn in the plane.`,
    ],
    vocab: [
      { term: 'principal stress', meaning: 'An eigenvalue of the stress tensor.' },
      { term: 'stress invariants', meaning: 'I1, I2, I3: coefficients of the characteristic polynomial.' },
      { term: 'von Mises stress', meaning: 'sqrt(I1^2 - 3 I2): the yield measure of ductile metals.' },
    ],
    params: [
      { key: 'sxx', label: 'sigma_xx', min: -3, max: 3, step: 0.05, def: 2 },
      { key: 'syy', label: 'sigma_yy', min: -3, max: 3, step: 0.05, def: 0.5 },
      { key: 'sxy', label: 'sigma_xy', min: -3, max: 3, step: 0.05, def: 1 },
      { key: 'szz', label: 'sigma_zz', min: -3, max: 3, step: 0.05, def: -0.7 },
    ],
    trace(params) {
      const p = P(this.params, params), Sm = stressOf(p), S = M.T(Sm, ['u', 'd']);
      const ev = symEigen(Sm), I1 = M.einsum('ii->', S).data[0], I2 = 0.5 * (I1 * I1 - M.einsum('ij,ji->', S, S).data[0]), I3 = M.matDet(Sm);
      const m = (p.sxx + p.syy) / 2, rr = Math.hypot((p.sxx - p.syy) / 2, p.sxy);
      const want = [m + rr, m - rr, p.szz].sort((a, b) => b - a);
      const v1 = ev[0].vector, Sv = M.einsum('ij,j->i', S, M.T(v1, ['u']));
      const vm = Math.sqrt(I1 * I1 - 3 * I2);
      return trace([
        step('contract', 'Feed an eigenvector: the stress returns it scaled.', r`\sigma^{i}{}_{j} v^{k}`, r`\sigma^{i}{}_{j} v^{j} = \lambda v^{i}`, { focus: ['j'], sums: [{ sym: 'j', range: [0, 3] }], numeric: { inputs: { sigma: S, v: M.T(v1, ['u']) }, output: Sv }, viz: { scene: 'stress-cube', params: { sigma: Sm, normal: v1 } } }),
        step('trace', 'The first invariant is the trace.', r`\sigma^{i}{}_{j}`, r`I_{1} = \sigma^{i}{}_{i}`, { focus: ['i'], sums: [{ sym: 'i', range: [0, 3] }] }),
        step('evaluate', 'Its value.', r`I_{1}`, r`I_{1} = ${num(I1)}`, { focus: [] }),
        step('contract', 'The second invariant from the full contraction of sigma with itself.', r`\sigma^{i}{}_{j} \sigma^{k}{}_{l}`, r`\sigma^{i}{}_{j} \sigma^{j}{}_{i}`, { focus: ['i', 'j'], sums: [{ sym: 'i', range: [0, 3] }, { sym: 'j', range: [0, 3] }] }),
        step('evaluate', 'Principal stresses and the von Mises stress.', r`\lambda`, r`\lambda = ${vecTex(ev.map(e => e.value))},\; \sigma_{\text{vM}} = ${num(vm)}`, { focus: [], viz: { scene: 'inertia-ellipsoid', params: { I: Sm, show: 'stress' } } }),
      ], {
        checks: [
          check('largest principal stress', ev[0].value, want[0], 1e-10),
          check('smallest principal stress', ev[2].value, want[2], 1e-10),
          check('I1 = sum of eigenvalues', I1, ev.reduce((s, e) => s + e.value, 0), 1e-10),
          check('I3 = product of eigenvalues', I3, ev.reduce((s, e) => s * e.value, 1), 1e-10),
          check('sigma v = lambda v (largest error)', Math.max(...[0, 1, 2].map(i => Math.abs(Sv.data[i] - ev[0].value * v1[i]))), 0, 1e-10),
        ],
        values: { principal: ev.map(e => e.value), vonMises: vm },
      });
    },
    viz: { scene: 'stress-cube', params: { sigma: [[2, 1, 0], [1, 0.5, 0], [0, 0, -0.7]] } },
    diagram: { style: 'penrose', order: ['\\sigma', 'v'], note: 'v hangs on the down leg of sigma; the result is a scaled v.' },
    refs: [wp('Cauchy_stress_tensor'), wp('Von_Mises_yield_criterion'), MALVERN],
  },
  // --------------------------------------------------------------------------
  {
    id: 'strain-tensor', title: 'Strain tensor', field: 'continuum',
    tex: r`\varepsilon_{ij} = \tfrac12\left(\partial_{i}u_{j} + \partial_{j}u_{i}\right), \qquad \omega_{ij} = \tfrac12\left(\partial_{i}u_{j} - \partial_{j}u_{i}\right)`,
    itex: r`\varepsilon_{ij} = \frac{1}{2} \partial_{i} u_{j} + \frac{1}{2} \partial_{j} u_{i}`,
    shape: { rank: 2, variance: 'dd', symmetries: 'symmetric', independent: 6 },
    story: [
      r`Deform a body so that the point at $x$ moves by $u(x)$. The displacement gradient $\partial_{i}u_{j}$ holds everything about the local change, but part of it is just a rotation, which stretches nothing. Split it: the symmetric part $\varepsilon_{ij}$ is the strain, the antisymmetric part $\omega_{ij}$ is the small rotation.`,
      r`The strain measures change of length: a small segment $dx$ changes its squared length by $2\varepsilon_{ij}dx^{i}dx^{j}$. That is why it has two lower indices, like a metric; in fact $\varepsilon$ is half the change of the metric of the material. Its trace $\varepsilon_{ii}$ is the relative change of volume.`,
      r`Simple shear $u = (\gamma y, 0, 0)$ is the clearest example: it looks like a pure slide, but it is half strain ($\varepsilon_{xy} = \gamma/2$) and half rotation ($\omega_{xy} = -\gamma/2$). The strain part alone stretches the diagonal $x = y$ and shortens the other diagonal.`,
      r`This is the small-strain (linear) tensor. For large deformations the Green-Lagrange strain adds the term $\frac12\partial_{i}u_{k}\partial_{j}u_{k}$, still symmetric and still built from the change of the metric.`,
    ],
    vocab: [
      { term: 'displacement', meaning: 'u(x): how far each material point moves.' },
      { term: 'strain', meaning: 'The symmetric part of grad u: stretching and shearing.' },
      { term: 'infinitesimal rotation', meaning: 'The antisymmetric part of grad u: turning with no stretch.' },
      { term: 'dilatation', meaning: 'epsilon_ii, the relative change of volume.' },
    ],
    params: [
      { key: 'shear', label: 'Shear gamma', min: -1, max: 1, step: 0.01, def: 0.4 },
      { key: 'stretch', label: 'Stretch along x', min: -0.5, max: 0.5, step: 0.01, def: 0.1 },
    ],
    trace(params) {
      const p = P(this.params, params);
      const u = x => M.T([p.stretch * x[0] + p.shear * x[1], 0, 0], ['d']);
      const { dT } = M.partialDerivative(u, [0.3, -0.2, 0.1]); // [j ; i] = d_i u_j
      const grad = M.transpose(dT, [1, 0]);
      const eps = M.symmetrize(grad, [0, 1]), om = M.antisymmetrize(grad, [0, 1]);
      return trace([
        step('partial', 'The displacement gradient.', r`u_{j}`, r`\partial_{i} u_{j}`, { focus: ['i'], numeric: { inputs: {}, output: grad }, viz: { scene: 'rank2-transform', params: { matrix: M.toNested(grad) } } }),
        step('symmetrize', 'Its symmetric part: the strain.', r`\partial_{i} u_{j}`, r`\varepsilon_{ij} = \frac{1}{2} \partial_{i} u_{j} + \frac{1}{2} \partial_{j} u_{i}`, { focus: ['i', 'j'], numeric: { inputs: { grad }, output: eps } }),
        step('antisymmetrize', 'Its antisymmetric part: a small rotation.', r`\partial_{i} u_{j}`, r`\omega_{ij} = \frac{1}{2} \partial_{i} u_{j} - \frac{1}{2} \partial_{j} u_{i}`, { focus: ['i', 'j'], numeric: { inputs: { grad }, output: om } }),
        step('evaluate', 'The strain components.', r`\varepsilon_{ij}`, r`\varepsilon_{ij} = ${matTex(M.toNested(eps))}`, { focus: [] }),
      ], {
        checks: [
          check('eps_xy = gamma / 2', eps.get(0, 1), p.shear / 2, 1e-9),
          check('omega_xy = -gamma / 2 (d_x u_y - d_y u_x) / 2', om.get(0, 1), -p.shear / 2, 1e-9),
          check('trace = volume change = stretch', eps.get(0, 0) + eps.get(1, 1) + eps.get(2, 2), p.stretch, 1e-9),
        ],
        values: { exy: eps.get(0, 1) },
      });
    },
    viz: { scene: 'rank2-transform', params: { matrix: [[0.1, 0.4, 0], [0, 0, 0], [0, 0, 0]] } },
    diagram: { style: 'penrose', order: ['\\partial', 'u'], note: 'A derivative box round u, with a wavy symmetrisation bar over both down legs.' },
    refs: [wp('Infinitesimal_strain_theory'), MALVERN, LL7],
  },
  // --------------------------------------------------------------------------
  {
    id: 'hooke-isotropic', title: "Hooke's law and the elasticity tensor", field: 'continuum',
    tex: r`\sigma^{ij} = C^{ijkl}\,\varepsilon_{kl}, \qquad C^{ijkl} = \lambda\,\delta^{ij}\delta^{kl} + \mu\left(\delta^{ik}\delta^{jl} + \delta^{il}\delta^{jk}\right)`,
    itex: r`\sigma^{ij} = C^{ijkl} \varepsilon_{kl}`,
    shape: { rank: 4, variance: 'uuuu', symmetries: 'C^{ijkl} = C^{jikl} = C^{ijlk} = C^{klij}', independent: '81 -> 21 (general) -> 2 (isotropic)' },
    story: [
      r`Linear elasticity says stress is a linear function of strain. A linear map from symmetric rank-2 tensors to symmetric rank-2 tensors is a rank-4 tensor, $C^{ijkl}$, with $3^{4} = 81$ components. Its two lower partners $kl$ eat the strain; its two upper indices $ij$ give the stress.`,
      r`Symmetries cut the count. Stress and strain are symmetric, so $C$ is symmetric in $ij$ and in $kl$: 36 left. An elastic energy $\frac12 C^{ijkl}\varepsilon_{ij}\varepsilon_{kl}$ exists, so $C$ is symmetric under swapping the pairs: 21 left, the most general anisotropic crystal. Cubic crystals have 3, and an isotropic material, the same in every direction, has only 2: the Lame constants $\lambda$ and $\mu$.`,
      r`For an isotropic material the only rank-4 tensors that do not change under rotation are products of deltas, which gives the formula above. Contract it with a strain and it becomes $\sigma = \lambda\,(\operatorname{tr}\varepsilon)\,\delta + 2\mu\,\varepsilon$: the trace part responds to volume change, the rest to shape change.`,
      r`The trace pulls a bar with stress $s$ along $x$: the strain is $s/E$ along the bar and $-\nu s/E$ across it (Poisson's ratio), and the full contraction with $C$ gives back a stress with only the $xx$ component. That is a real test of the 81-component contraction.`,
    ],
    vocab: [
      { term: 'stiffness tensor', meaning: 'C^ijkl: the linear map from strain to stress.' },
      { term: 'Lame constants', meaning: 'lambda and mu, the two numbers of an isotropic solid; mu is the shear modulus.' },
      { term: "Young's modulus and Poisson's ratio", meaning: 'E = stress / strain along a bar; nu = sideways shrink / stretch.' },
    ],
    params: [
      { key: 'E', label: "Young's modulus E", min: 0.5, max: 5, step: 0.05, def: 2 },
      { key: 'nu', label: "Poisson's ratio nu", min: 0, max: 0.49, step: 0.01, def: 0.3 },
      { key: 's', label: 'Applied stress s', min: -2, max: 2, step: 0.05, def: 1 },
    ],
    trace(params) {
      const p = P(this.params, params), lam = p.E * p.nu / ((1 + p.nu) * (1 - 2 * p.nu)), mu = p.E / (2 * (1 + p.nu));
      const d = M.kroneckerDelta(3, ['u', 'u']);
      const dd = M.einsum('ij,kl->ijkl', d, d), dik = M.einsum('ik,jl->ijkl', d, d), dil = M.einsum('il,jk->ijkl', d, d);
      const C = M.T({ shape: [3, 3, 3, 3], variance: ['u', 'u', 'u', 'u'], data: dd.data.map((v, i) => lam * v + mu * (dik.data[i] + dil.data[i])) });
      const eps = M.T([[p.s / p.E, 0, 0], [0, -p.nu * p.s / p.E, 0], [0, 0, -p.nu * p.s / p.E]], ['d', 'd']);
      const sig = M.einsum('ijkl,kl->ij', C, eps);
      let pairSym = 0; for (const [i, j, k, l] of M.indexTuples([3, 3, 3, 3])) pairSym = Math.max(pairSym, Math.abs(C.get(i, j, k, l) - C.get(k, l, i, j)), Math.abs(C.get(i, j, k, l) - C.get(j, i, k, l)));
      return trace([
        step('product', 'Build C from products of deltas: 81 numbers, 2 constants.', r`\delta^{ij}`, r`C^{ijkl} = \lambda \delta^{ij} \delta^{kl} + \mu \delta^{ik} \delta^{jl} + \mu \delta^{il} \delta^{jk}`, { focus: ['i', 'j', 'k', 'l'], numeric: { inputs: {}, output: C }, viz: { scene: 'component-cube', params: { tensor: 'elasticity' } } }),
        step('evaluate', 'The strain of a bar pulled along x.', r`\varepsilon_{kl}`, r`\varepsilon_{kl} = ${matTex(M.toNested(eps), 4)}`, { focus: [] }),
        step('contract', 'Contract C with the strain over both k and l.', r`C^{ijkl} \varepsilon_{mn}`, r`\sigma^{ij} = C^{ijkl} \varepsilon_{kl}`, { focus: ['k', 'l'], sums: [{ sym: 'k', range: [0, 3] }, { sym: 'l', range: [0, 3] }], numeric: { inputs: { C, epsilon: eps }, output: sig }, viz: { scene: 'contraction-block', params: { shape: [3, 3, 3, 3], axes: [2, 3] } } }),
        step('evaluate', 'Only the pulled direction carries stress.', r`\sigma^{ij}`, r`\sigma^{ij} = ${matTex(M.toNested(sig), 4)}`, { focus: [], viz: { scene: 'stress-cube', params: { sigma: M.toNested(sig) } } }),
      ], {
        checks: [
          check('sigma_xx = s', sig.get(0, 0), p.s, 1e-12),
          check('sigma_yy = 0 (free sides)', sig.get(1, 1), 0, 1e-12),
          check('sigma = lambda tr(eps) delta + 2 mu eps (xx)', sig.get(0, 0), lam * (eps.get(0, 0) + eps.get(1, 1) + eps.get(2, 2)) + 2 * mu * eps.get(0, 0), 1e-12),
          check('C has its pair and minor symmetries (largest error)', pairSym, 0, 1e-12),
        ],
        values: { lambda: lam, mu },
      });
    },
    viz: { scene: 'component-cube', params: { tensor: 'elasticity' } },
    diagram: { style: 'penrose', order: ['C', '\\varepsilon'], note: 'Two legs of C join the two legs of epsilon; two legs stay free.' },
    refs: [wp('Hooke%27s_law'), wp('Linear_elasticity'), LL7, MALVERN],
  },
  // --------------------------------------------------------------------------
  {
    id: 'cauchy-momentum', title: 'Cauchy momentum equation', field: 'continuum',
    tex: r`\rho\,a^{i} = \partial_{j}\sigma^{ij} + f^{i}`,
    itex: r`\rho a^{i} = \partial_{j} \sigma^{ij} + f^{i}`,
    shape: { rank: 1, variance: 'u', symmetries: '-', independent: '3 equations' },
    story: [
      r`Newton's second law for a continuum: the mass per volume times acceleration equals the net force per volume. The net contact force is not the stress but its divergence, $\partial_{j}\sigma^{ij}$: a uniform stress pulls equally on opposite faces of a small cube and gives no net force. Only a stress that changes across the cube pushes it.`,
      r`The derivative index $j$ is contracted with the face index of $\sigma^{ij}$, the one that took the normal in the traction formula. This is the divergence theorem at work: the total traction on the surface of a small volume is the integral of $\partial_{j}\sigma^{ij}$ inside it.`,
      r`For a fluid at rest $\sigma^{ij} = -p\,\delta^{ij}$, and the equation becomes hydrostatics: $\nabla p = \rho\mathbf g$. Water pressure growing with depth is a stress gradient that holds up the weight of the water above. For a moving Newtonian fluid, adding viscous stress turns this equation into Navier-Stokes.`,
    ],
    vocab: [
      { term: 'body force', meaning: 'f: force per unit volume, such as gravity rho g.' },
      { term: 'hydrostatic stress', meaning: 'sigma = -p delta: pressure, the same in every direction.' },
    ],
    params: [
      { key: 'rho', label: 'Density rho', min: 0.5, max: 3, step: 0.05, def: 1 },
      { key: 'g', label: 'Gravity g', min: 0, max: 20, step: 0.1, def: 9.8 },
      { key: 'h', label: 'Depth of the surface h', min: 0, max: 5, step: 0.1, def: 2 },
    ],
    trace(params) {
      const p = P(this.params, params);
      const sigma = x => { const pr = 1 + p.rho * p.g * (p.h - x[2]); return M.T([[-pr, 0, 0], [0, -pr, 0], [0, 0, -pr]], ['u', 'u']); };
      const { dT } = M.partialDerivative(sigma, [0.2, 0.1, 0.5]); // [i, j ; k]
      const div = M.einsum('ijj->i', dT), f = [0, 0, -p.rho * p.g], acc = [...div.data].map((v, i) => (v + f[i]) / p.rho);
      return trace([
        step('partial', 'The stress changes with depth.', r`\sigma^{ij}`, r`\partial_{k} \sigma^{ij}`, { focus: ['k'], numeric: { inputs: {}, output: dT }, viz: { scene: 'stress-cube', params: { sigma: M.toNested(sigma([0, 0, 0.5])) } } }),
        step('contract', 'Its divergence is the net contact force per volume.', r`\partial_{k} \sigma^{ij}`, r`\partial_{j} \sigma^{ij}`, { focus: ['j'], sums: [{ sym: 'j', range: [0, 3] }], numeric: { inputs: { dSigma: dT }, output: div } }),
        step('evaluate', 'It balances gravity: the fluid does not accelerate.', r`\rho a^{i}`, r`a^{i} = ${vecTex(acc)}`, { focus: [] }),
      ], {
        checks: [
          check('d_j sigma^zj = rho g', div.get(2), p.rho * p.g, 1e-8),
          check('acceleration = 0 (largest component)', Math.max(...acc.map(Math.abs)), 0, 1e-8),
        ],
        values: { divergence: [...div.data] },
      });
    },
    viz: { scene: 'stress-cube', params: { show: 'gradient' } },
    diagram: { style: 'penrose', order: ['\\partial', '\\sigma', 'f'], note: 'The derivative leg joins the second up leg of sigma.' },
    refs: [wp('Cauchy_momentum_equation'), MALVERN],
  },
];
